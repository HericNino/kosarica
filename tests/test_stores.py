import pytest

from kosarica.stores import from_filename


@pytest.mark.parametrize(
    "name, postal, city, area",
    [
        ("Supermarket 104_Ulica Dr. Franje Tuđmana_30_10450_Jastrebarsko_1_24.09.2026_7.15h.csv", "10450", "Jastrebarsko", True),
        ("SUPERMARKET_SJEVERNA_VEZNA_CESTA_31_35000_SLAVONSKI_BROD_022_6_20052025014212.csv", "35000", "Slavonski Brod", False),
        ("supermarket-Zvonarska_ulica_63-Vinkovci-32100-23.05.2025-7.30.csv", "32100", "Vinkovci", False),
        ("hipermarket_zagreb_avenija_dubrava_2_0202_interspar_zagreb_0002_20261015_0330.csv", None, None, True),
        ("SUPERMARKET,ILICA 1 10000 ZAGREB,0601,2026-10-15.csv", "10000", "Zagreb", True),
    ],
)
def test_from_filename(name, postal, city, area):
    store = from_filename(name)
    assert (store.postal_code, store.city, store.in_area("zagreb")) == (postal, city, area)


def test_key_is_stable_across_days():
    a = from_filename("Supermarket 104_Ilica_200_10000_Zagreb_1_14.10.2026_7.15h.csv")
    b = from_filename("Supermarket 104_Ilica_200_10000_Zagreb_1_15.10.2026_7.15h.csv")
    assert a.key == b.key
    assert a.store_type == "supermarket"
