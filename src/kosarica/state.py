"""Silver to state: price history as intervals (slowly changing dimension, type 2).

A full copy of every price every day would be millions of rows a day, and almost all of
them the same as yesterday. The history keeps one row per price *period* instead:

    chain   store_key  product_id  price  special_price  valid_from  valid_to
    konzum  ...0601    123456      1.99   null           2026-10-01  2026-10-14
    konzum  ...0601    123456      2.19   null           2026-10-15  null        <- current

Each day's snapshot closes the periods that changed or disappeared and opens new ones.
Three rules keep that honest:

- Only stores that are in today's snapshot can lose products. A store whose file failed
  to download keeps its current prices instead of looking like it emptied overnight.
- A chain/day is applied once (`loads`), so re-running a day changes nothing.
- Days are applied in order. An older day than the last one loaded is refused, since it
  would rewrite periods that later days already closed; that needs a rebuild.
"""

from __future__ import annotations

import logging
from datetime import date
from pathlib import Path

import duckdb

log = logging.getLogger("kosarica")

KEY = ("chain", "store_key", "product_id")
TRACKED = ("price", "special_price", "unit_price", "on_offer", "available")

SCHEMAS = {
    "price_history": """
        chain varchar, store_key varchar, product_id varchar,
        price decimal(10, 2), special_price decimal(10, 2), unit_price decimal(10, 2),
        on_offer boolean, available boolean, valid_from date, valid_to date
    """,
    "products": """
        chain varchar, product_id varchar, barcode varchar, name varchar, brand varchar,
        category varchar, quantity varchar, unit varchar, first_seen date, last_seen date
    """,
    "stores": """
        chain varchar, store_key varchar, store_type varchar, postal_code varchar, city varchar,
        label varchar, first_seen date, last_seen date
    """,
    "loads": "chain varchar, day date, rows bigint, changed bigint",
}


class OutOfOrder(Exception):
    pass


def state_dir(lake: Path) -> Path:
    return lake / "state"


def _open(lake: Path) -> duckdb.DuckDBPyConnection:
    con = duckdb.connect()
    for name, schema in SCHEMAS.items():
        con.execute(f"create table {name} ({schema})")
        path = state_dir(lake) / f"{name}.parquet"
        if path.exists():
            con.execute(f"insert into {name} by name select * from read_parquet('{path}')")
    return con


def _save(con: duckdb.DuckDBPyConnection, lake: Path) -> None:
    out = state_dir(lake)
    out.mkdir(parents=True, exist_ok=True)
    order = {"price_history": "chain, store_key, product_id, valid_from", "products": "chain, product_id", "stores": "chain, store_key"}
    for name in SCHEMAS:
        by = order.get(name, "chain, day")
        tmp = out / f"{name}.parquet.tmp"
        con.execute(f"copy (select * from {name} order by {by}) to '{tmp}' (format parquet, compression zstd)")
        tmp.replace(out / f"{name}.parquet")  # never leave a half-written state file


def apply_day(lake: Path, day: date) -> dict[str, int]:
    """Folds one day of silver into the state. Returns changed periods per chain applied."""
    silver = lake / "silver" / "prices" / f"day={day}"
    chains = sorted(p.name.removeprefix("chain=") for p in silver.glob("chain=*") if (p / "data.parquet").exists())
    if not chains:
        log.info("state: no silver data for %s", day)
        return {}

    con = _open(lake)
    applied: dict[str, int] = {}
    for chain in chains:
        last = con.execute("select max(day) from loads where chain = ?", [chain]).fetchone()[0]
        if last is not None and day == last:
            log.info("state: %s %s already applied", chain, day)
            continue
        if last is not None and day < last:
            raise OutOfOrder(f"{chain}: {day} is before the last applied day {last}; rebuild the state to backfill")
        applied[chain] = _apply_chain(con, lake, chain, day)

    if applied:
        _save(con, lake)
    con.close()
    return applied


def _apply_chain(con: duckdb.DuckDBPyConnection, lake: Path, chain: str, day: date) -> int:
    prices = lake / "silver" / "prices" / f"day={day}" / f"chain={chain}" / "data.parquet"
    stores = lake / "silver" / "stores" / f"day={day}" / f"chain={chain}" / "data.parquet"
    con.execute(f"create or replace temp table snap as select ? as chain, * from read_parquet('{prices}')", [chain])
    con.execute(f"create or replace temp table snap_stores as select ? as chain, * from read_parquet('{stores}')", [chain])

    same_key = " and ".join(f"s.{k} = h.{k}" for k in KEY)
    same_values = " and ".join(f"s.{c} is not distinct from h.{c}" for c in TRACKED)

    # 1. close current periods that changed or disappeared, but only in stores seen today
    closed = con.execute(
        f"""
        update price_history h set valid_to = ?::date - 1
        where h.valid_to is null and h.chain = ?
          and exists (select 1 from snap_stores st where st.chain = h.chain and st.store_key = h.store_key)
          and not exists (select 1 from snap s where {same_key} and {same_values})
        """,
        [day, chain],
    ).fetchone()[0]

    # 2. open periods for prices that have no matching current period
    opened = con.execute(
        f"""
        insert into price_history
        select s.chain, s.store_key, s.product_id, s.price, s.special_price, s.unit_price, s.on_offer, s.available, ?::date, null
        from snap s
        where not exists (select 1 from price_history h where h.valid_to is null and {same_key} and {same_values})
        """,
        [day],
    ).fetchone()[0]

    # 3. latest attributes of products and stores
    con.execute(
        """
        create or replace temp table todays_products as
        select chain, product_id,
               mode(barcode) as barcode, mode(name) as name, mode(brand) as brand, mode(category) as category,
               mode(quantity) as quantity, mode(unit) as unit
        from snap group by all
        """
    )
    con.execute(
        """
        create or replace temp table merged_products as
        select t.chain, t.product_id, t.barcode, t.name, t.brand, t.category, t.quantity, t.unit,
               coalesce(p.first_seen, ?::date) as first_seen, ?::date as last_seen
        from todays_products t left join products p using (chain, product_id)
        """,
        [day, day],
    )
    con.execute("delete from products where (chain, product_id) in (select (chain, product_id) from merged_products)")
    con.execute("insert into products select * from merged_products")

    con.execute(
        """
        create or replace temp table merged_stores as
        select t.chain, t.store_key, t.store_type, t.postal_code, t.city, t.label,
               coalesce(p.first_seen, ?::date) as first_seen, ?::date as last_seen
        from snap_stores t left join stores p using (chain, store_key)
        """,
        [day, day],
    )
    con.execute("delete from stores where (chain, store_key) in (select (chain, store_key) from merged_stores)")
    con.execute("insert into stores select * from merged_stores")

    rows = con.execute("select count(*) from snap").fetchone()[0]
    con.execute("insert into loads values (?, ?, ?, ?)", [chain, day, rows, opened])
    log.info("state: %s %s: %d rows, %d periods closed, %d opened", chain, day, rows, closed, opened)
    return opened
