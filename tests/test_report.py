from fakeweb import FakeWeb

from kosarica.ingest import ingest
from kosarica.report import build
from kosarica.state import apply_day

CHAINS = ["spar", "lidl", "studenac", "plodine", "kaufland"]


def test_report_over_two_days(tmp_path):
    lake = tmp_path / "lake"
    with FakeWeb().client() as client:
        for day in (FakeWeb.DAY1, FakeWeb.DAY2):
            ingest(day, lake, CHAINS, "zagreb", client)
            apply_day(lake, day)
    report, catalog = build(lake)  # runs every dbt model and data test

    summary = report["summary"]
    assert summary["as_of"] == "2026-10-15"
    assert summary["chains"] == 4
    assert summary["days_collected"] == 2

    # milk (3850102123452) is the only product all four chains sell
    basket = {row["chain"]: row for row in report["basket"]}
    assert {c: (b["items"], b["total"]) for c, b in basket.items()} == {
        "lidl": (1, 1.09),
        "kaufland": (1, 1.15),
        "studenac": (1, 1.25),
        "spar": (1, 1.24),  # median of 1.29 (store 1, day 2) and 1.19 (store 2 kept from day 1)
    }
    assert basket["lidl"]["above_cheapest"] == 0
    assert report["basket_items"] == [
        {
            "gtin": "03850102123452",
            "name": "Mlijeko 2,8% 1 l",  # Kaufland's spelling is preferred
            "prices": {"kaufland": 1.15, "lidl": 1.09, "spar": 1.24, "studenac": 1.25},
        }
    ]

    changes = {(r["day"], r["chain"]): r for r in report["daily_changes"]}
    assert changes[("2026-10-15", "spar")]["increases"] == 1  # milk
    assert changes[("2026-10-15", "spar")]["decreases"] == 1  # coffee on offer

    chains = {row["chain"]: row for row in report["chains"]}
    assert chains["spar"]["stores"] == 2
    assert chains["kaufland"]["offer_share"] == 0.5  # coffee on offer, milk not; the unavailable cheese doesn't count
    # anchors read out of "MPC 2.5.2025=1,09€" and "=3,99€"; the cheese has none
    assert chains["kaufland"]["compared"] == 2
    assert chains["kaufland"]["median_change_since_anchor"] == round(((1.15 / 1.09 - 1) + (3.79 / 3.99 - 1)) / 2, 4)
    assert chains["lidl"]["median_change_since_anchor"] == round(1.09 / 0.99 - 1, 4)

    # the catalog: products in at least two chains, one price slot per chain
    assert catalog["chains"] == ["kaufland", "lidl", "spar", "studenac"]
    by_name = {p[1]: p for p in catalog["products"]}
    milk = by_name["Mlijeko 2,8% 1 l"]
    assert catalog["categories"][milk[2]] == "Mlijeko i mliječni"
    assert milk[3] == [1.15, 1.09, 1.24, 1.25]
    assert milk[4] == [1.09, 0.99, 1.09, 1.05]  # anchor prices
    assert milk[5] == [1.0, "l"]  # package size from the name
    coffee = by_name["Kava 250 g"]  # Kaufland and Spar
    assert coffee[3][1] is None and coffee[3][0] == 3.79
    categories = {(c["category"], c["chain"]): c for c in report["categories"]}
    # milk is in all four chains; Lidl's 1.09 is below the four-chain average of 1.1825
    assert categories[("Mlijeko i mliječni", "lidl")]["index_vs_average"] < -0.07
    assert categories[("Mlijeko i mliječni", "lidl")]["cheapest_share"] == 1
