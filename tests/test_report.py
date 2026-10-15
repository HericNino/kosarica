from fakeweb import FakeWeb

from kosarica.ingest import ingest
from kosarica.report import build
from kosarica.state import apply_day

CHAINS = ["spar", "lidl", "studenac", "plodine"]


def test_report_over_two_days(tmp_path):
    lake = tmp_path / "lake"
    with FakeWeb().client() as client:
        for day in (FakeWeb.DAY1, FakeWeb.DAY2):
            ingest(day, lake, CHAINS, "zagreb", client)
            apply_day(lake, day)
    report = build(lake)  # runs every dbt model and data test

    summary = report["summary"]
    assert summary["as_of"] == "2026-10-15"
    assert summary["chains"] == 3
    assert summary["days_collected"] == 2

    # milk (3850102123452) is the only product all three chains sell
    basket = {row["chain"]: row for row in report["basket"]}
    assert {c: (b["items"], b["total"]) for c, b in basket.items()} == {
        "lidl": (1, 1.09),
        "studenac": (1, 1.25),
        "spar": (1, 1.24),  # median of 1.29 (store 1, day 2) and 1.19 (store 2 kept from day 1)
    }
    assert basket["lidl"]["above_cheapest"] == 0

    changes = {(r["day"], r["chain"]): r for r in report["daily_changes"]}
    assert changes[("2026-10-15", "spar")]["increases"] == 1  # milk
    assert changes[("2026-10-15", "spar")]["decreases"] == 1  # coffee on offer

    chains = {row["chain"]: row for row in report["chains"]}
    assert chains["spar"]["stores"] == 2
    assert chains["lidl"]["median_change_since_anchor"] == round(1.09 / 0.99 - 1, 4)
