from datetime import date

import duckdb
import pytest
from fakeweb import FakeWeb

from kosarica.ingest import ingest
from kosarica.state import OutOfOrder, apply_day

CHAINS = ["spar", "lidl", "studenac", "plodine", "kaufland"]


def history(lake):
    con = duckdb.connect()
    rows = con.execute(
        f"""
        select chain, store_key, product_id, price, special_price, valid_from, valid_to
        from read_parquet('{lake}/state/price_history.parquet') order by chain, store_key, product_id, valid_from
        """
    ).fetchall()
    return rows


@pytest.fixture
def two_days(tmp_path):
    web = FakeWeb()
    lake = tmp_path / "lake"
    with web.client() as client:
        day1 = {r.chain: r for r in ingest(FakeWeb.DAY1, lake, CHAINS, "zagreb", client)}
        apply_day(lake, FakeWeb.DAY1)
        after_day1 = history(lake)
        day2 = {r.chain: r for r in ingest(FakeWeb.DAY2, lake, CHAINS, "zagreb", client)}
        apply_day(lake, FakeWeb.DAY2)
    return lake, web, day1, day2, after_day1


def test_day_one_reports(two_days):
    _, web, day1, _, _ = two_days
    assert day1["spar"].status == "ok"
    assert day1["spar"].files_listed == 3
    assert day1["spar"].files_in_area == 2  # Split is skipped before downloading
    assert day1["spar"].rows == 6  # 3 products x 2 stores; blank and price-less lines dropped
    assert day1["spar"].rows_skipped == 2
    assert day1["lidl"].rows == 2  # only the Zagreb file for the day, cp1250 decoded
    assert day1["lidl"].rows_duplicate == 1  # the same product under a second barcode
    assert day1["studenac"].stores == 1  # Split XML filtered out of the zip
    assert (day1["kaufland"].files_listed, day1["kaufland"].rows) == (1, 3)
    assert day1["kaufland"].unknown_columns == []
    # a file without the required columns is rejected and reported, not guessed at
    assert day1["plodine"].status == "empty"
    assert day1["plodine"].files_rejected == 1
    assert set(next(iter(day1["plodine"].rejected.values()))) == {"product_id", "price"}
    assert not any("split" in url and "spar.hr/f/" in url for url in web.requests)


def test_history_after_day_one(two_days):
    *_, after_day1 = two_days
    assert len(after_day1) == 12  # 6 Spar + 2 Lidl + 1 Studenac + 3 Kaufland
    assert all(row[-1] is None for row in after_day1)  # all current


def test_day_two_changes(two_days):
    lake, _, _, day2, _ = two_days
    assert day2["spar"].files_failed == 1  # store 2 returned 503 on both passes
    assert (day2["lidl"].files_failed, day2["lidl"].stores) == (0, 1)  # failed the first pass, worked on the second
    rows = history(lake)
    spar1 = [r for r in rows if r[0] == "spar" and "0101" in r[1]]
    milk = [r for r in spar1 if r[2] == "1001"]
    assert [(str(r[3]), r[5], r[6]) for r in milk] == [
        ("1.19", date(2026, 10, 14), date(2026, 10, 14)),
        ("1.29", date(2026, 10, 15), None),
    ]
    bread = [r for r in spar1 if r[2] == "1002"]
    assert [(r[5], r[6]) for r in bread] == [(date(2026, 10, 14), date(2026, 10, 14))]  # delisted
    coffee = [r for r in spar1 if r[2] == "1003"]
    assert [str(r[4]) if r[4] else None for r in coffee] == [None, "3.99"]  # went on offer


def test_failed_store_keeps_its_prices(two_days):
    lake, *_ = two_days
    spar2 = [r for r in history(lake) if r[0] == "spar" and "0202" in r[1]]
    assert len(spar2) == 3 and all(r[-1] is None for r in spar2)


def test_unchanged_prices_stay_one_period(two_days):
    lake, *_ = two_days
    lidl = [r for r in history(lake) if r[0] == "lidl"]  # same prices on both days
    assert len(lidl) == 2 and all(r[-1] is None for r in lidl)


def test_rerun_is_a_no_op(two_days):
    lake, *_ = two_days
    before = history(lake)
    assert apply_day(lake, FakeWeb.DAY2) == {}
    assert history(lake) == before


def test_older_day_is_refused(two_days):
    lake, *_ = two_days
    # a Lidl partition for a day before the last one applied
    src = lake / "silver" / "prices" / "day=2026-10-14" / "chain=lidl"
    dst = lake / "silver" / "prices" / "day=2026-10-13" / "chain=lidl"
    dst.mkdir(parents=True)
    (dst / "data.parquet").write_bytes((src / "data.parquet").read_bytes())
    with pytest.raises(OutOfOrder):
        apply_day(lake, date(2026, 10, 13))


def test_offer_flags_and_availability(two_days):
    lake, *_ = two_days
    con = duckdb.connect()
    rows = con.execute(
        f"""
        select product_id, price, on_offer, available
        from read_parquet('{lake}/state/price_history.parquet') where chain = 'kaufland' order by product_id
        """
    ).fetchall()
    assert [(r[0], str(r[1]), r[2], r[3]) for r in rows] == [
        ("9001", "1.15", False, True),
        ("9002", "3.79", True, True),  # "A" flag: the offer price is in the normal column
        ("9003", "7.99", False, False),  # "Nedostupan"
    ]
