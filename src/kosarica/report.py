"""Gold: run the dbt models over the state and shape the marts into data/report.json."""

from __future__ import annotations

import json
import os
import tempfile
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

import duckdb

TRANSFORM_DIR = Path(os.environ.get("KOSARICA_TRANSFORM_DIR", Path(__file__).resolve().parents[2] / "transform"))


class DbtError(RuntimeError):
    pass


def run_dbt(lake: Path, warehouse: Path) -> None:
    """`dbt build`: models and data tests. A failing test stops the report."""
    from dbt.cli.main import dbtRunner  # slow to import

    work = warehouse.parent / "dbt"
    args = [
        "build",
        "--project-dir",
        str(TRANSFORM_DIR),
        "--profiles-dir",
        str(TRANSFORM_DIR),
        "--target-path",
        str(work / "target"),
        "--log-path",
        str(work / "logs"),
        "--vars",
        json.dumps({"lake": str(lake.resolve())}),
        "--quiet",
    ]
    previous = os.environ.get("KOSARICA_WAREHOUSE")
    os.environ["KOSARICA_WAREHOUSE"] = str(warehouse)
    try:
        result = dbtRunner().invoke(args)
    finally:
        if previous is None:
            os.environ.pop("KOSARICA_WAREHOUSE", None)
        else:
            os.environ["KOSARICA_WAREHOUSE"] = previous
    if not result.success:
        raise DbtError(f"dbt build failed: {result.exception or 'see the dbt output above'}")


def build(lake: Path) -> dict:
    with tempfile.TemporaryDirectory() as tmp:
        warehouse = Path(tmp) / "warehouse.duckdb"
        run_dbt(lake, warehouse)
        with duckdb.connect(str(warehouse)) as db:
            return assemble(db)


def rows(db: duckdb.DuckDBPyConnection, sql: str) -> list[dict]:
    cursor = db.execute(sql)
    names = [d[0] for d in cursor.description]
    return [{k: _plain(v) for k, v in zip(names, row, strict=True)} for row in cursor.fetchall()]


def _plain(value):
    if isinstance(value, Decimal):
        return float(value)
    if isinstance(value, float):
        return round(value, 4)
    if isinstance(value, date):
        return value.isoformat()
    return value


def assemble(db: duckdb.DuckDBPyConnection) -> dict:
    return {
        "generated_at": datetime.now(UTC).replace(microsecond=0).isoformat(),
        "summary": rows(db, "select * from mart_summary")[0],
        "chains": rows(db, "select * from mart_chains"),
        "basket": rows(db, "select * from mart_basket"),
        "cheapest": rows(db, "select * from mart_cheapest"),
        "daily_changes": rows(db, "select * from mart_daily_changes where day >= current_date - 90"),
        "shrinkflation": rows(db, "select * from mart_shrinkflation limit 100"),
    }
