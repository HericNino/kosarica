import pytest

from kosarica.columns import HeaderMap, canonical, normalize_header


@pytest.mark.parametrize(
    "header, field",
    [
        # one field, as different chains spell it
        ("MPC (EUR)", "price"),
        ("MALOPRODAJNA_CIJENA", "price"),
        ("Maloprodajna cijena", "price"),
        ("MaloprodajnaCijena", "price"),
        ("cijena za jedinicu mjere (EUR)", "unit_price"),
        ("CIJENA_ZA_JEDINICU_MJERE", "unit_price"),
        ("Cijena po JM", "unit_price"),
        ("MPC za vrijeme posebnog oblika prodaje (EUR)", "special_price"),
        ("MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE", "special_price"),
        ("MaloprodajnaCijenaAkcija", "special_price"),
        ("Najniža cijena u posljednjih 30 dana (EUR)", "best_price_30"),
        ("NAJNIZA_CIJENA_U_POSLJ._30_DANA", "best_price_30"),
        ("sidrena cijena na 2.5.2025. (EUR)", "anchor_price"),
        ("Sidrena_cijena_na_02.05.2025", "anchor_price"),
        ("šifra", "product_id"),
        ("ŠIFRA PROIZVODA", "product_id"),
        ("SifraProizvoda", "product_id"),
        ("barkod", "barcode"),
        ("naziv", "name"),
        ("NAZIV PROIZVODA", "name"),
        ("MarkaProizvoda", "brand"),
        ("neto količina", "quantity"),
        ("NETO_KOLIČINA", "quantity"),
        ("jedinica mjere", "unit"),
        ("KategorijeProizvoda", "category"),
        # present in some files, deliberately not kept
        ("Naziv posebnog oblika prodaje", "sale_type"),
        ("Dostupno nedostupno", "available"),
        ("Nešto sasvim novo", None),
    ],
)
def test_canonical(header, field):
    assert canonical(header) == field


def test_normalize_header():
    assert normalize_header("NETO_KOLIČINA (EUR)") == "neto kolicina"
    assert normalize_header("Đumbir") == "dumbir"


def test_header_map_reports_unknown_and_missing():
    m = HeaderMap(["Naziv", "Nova kolona", "MPC", ""])
    assert m.unknown == ["Nova kolona"]
    assert m.missing == ["product_id"]
    assert m.row(["Kruh", "x", "1,00"])["name"] == "Kruh"
