from decimal import Decimal

import duckdb
import pytest

from kosarica.ingest import MONEY_MACROS


@pytest.mark.parametrize(
    "text, value",
    [
        ("1,99", "1.99"),
        ("1.99", "1.99"),
        (",75", "0.75"),  # Plodine drops the leading zero
        ("       9,39", "9.39"),  # Kaufland pads with spaces
        ("1.234,56", "1234.56"),
        ("€ 2,50", "2.50"),
        ("MPC 2.5.2025=7,99€", "7.99"),  # Kaufland's anchor price column
        ("0,00", None),
        ("", None),
        (None, None),
        ("nema", None),
    ],
)
def test_money(text, value):
    con = duckdb.connect()
    con.execute(MONEY_MACROS)
    result = con.execute("select money(?)", [text]).fetchone()[0]
    assert result == (Decimal(value) if value else None)
