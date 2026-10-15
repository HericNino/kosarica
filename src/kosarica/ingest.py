"""Bronze to silver: download a day's price lists and write them as typed Parquet.

Raw files only live for the length of a run (a full day is gigabytes); what is kept is
the silver layer, one Parquet file per chain and day:

    lake/silver/prices/day=2026-10-15/chain=konzum/data.parquet
    lake/silver/stores/day=2026-10-15/chain=konzum/data.parquet

A chain that fails or returns nothing writes nothing, so a broken source can never look
like a day on which every product disappeared.
"""

from __future__ import annotations

import csv
import io
import logging
import tempfile
import time
import zipfile
from collections import Counter
from dataclasses import asdict, dataclass, field
from datetime import date
from pathlib import Path
from xml.etree.ElementTree import ParseError

import duckdb
import httpx

from .chains import CHAINS, RemoteFile
from .columns import FIELDS
from .parse import parse
from .stores import Store, from_filename

log = logging.getLogger("kosarica")

PRICE_LIST_SUFFIXES = (".csv", ".xml")
RETRY_BASE_SECONDS = 2.0
PASSES = 2
PASS_PAUSE_SECONDS = 30.0


@dataclass
class ChainReport:
    chain: str
    status: str = "ok"  # ok | empty | failed
    error: str | None = None
    files_listed: int = 0
    files_in_area: int = 0
    files_failed: int = 0
    files_rejected: int = 0  # missing a required column, or unreadable
    stores: int = 0
    rows: int = 0
    rows_skipped: int = 0  # no product id or no usable price
    rows_duplicate: int = 0  # the same product listed again in the same store (Lidl lists one per barcode)
    unknown_columns: list[str] = field(default_factory=list)
    rejected: dict[str, list[str]] = field(default_factory=dict)  # file -> missing columns, or why it couldn't be read
    seconds: float = 0.0

    def to_dict(self) -> dict:
        return asdict(self)


def download(client: httpx.Client, url: str, attempts: int = 3) -> bytes:
    for attempt in range(1, attempts + 1):
        try:
            response = client.get(url)
            response.raise_for_status()
            return response.content
        except httpx.HTTPError:
            if attempt == attempts:
                raise
            time.sleep(RETRY_BASE_SECONDS * 2 ** (attempt - 1))
    raise AssertionError("unreachable")


def price_lists(client: httpx.Client, remote: RemoteFile, area: str):
    """(store, file name, bytes) for each store's price list in the area."""
    if not remote.archive:
        store = from_filename(remote.name)
        if store.in_area(area):
            yield store, remote.name, download(client, remote.url)
        return
    with zipfile.ZipFile(io.BytesIO(download(client, remote.url))) as archive:
        for member in archive.namelist():
            name = member.rsplit("/", 1)[-1]
            if not name.lower().endswith(PRICE_LIST_SUFFIXES):
                continue
            store = from_filename(name)
            if store.in_area(area):
                yield store, name, archive.read(member)


def ingest_chain(client: httpx.Client, chain: str, day: date, area: str, lake: Path) -> ChainReport:
    report = ChainReport(chain)
    started = time.monotonic()
    try:
        remotes = CHAINS[chain](client, day)
    except Exception as error:  # one broken chain shouldn't stop the others
        report.status, report.error = "failed", f"listing files: {error}"
        log.error("%s: %s", chain, report.error)
        return report
    report.files_listed = len(remotes)

    unknown: Counter[str] = Counter()
    stores: dict[str, Store] = {}
    with tempfile.TemporaryDirectory() as tmp:
        rows_path = Path(tmp) / "rows.csv"
        with rows_path.open("w", newline="", encoding="utf-8") as out:
            writer = csv.writer(out)
            writer.writerow(["store_key", *FIELDS])
            # Some sites (Konzum) fail requests at random rather than per file, so what helps
            # is a second, later pass over the files that failed, not more retries in a row.
            pending = remotes
            for attempt in range(1, PASSES + 1):
                failed = []
                for remote in pending:
                    try:
                        # downloads complete before anything is yielded, so a failed file adds no rows
                        for store, name, data in price_lists(client, remote, area):
                            report.files_in_area += 1
                            try:
                                parsed = parse(name, data)
                            except (ParseError, csv.Error, ValueError) as error:  # one broken file shouldn't stop the chain
                                report.files_rejected += 1
                                report.rejected[name] = [f"unreadable: {error}"]
                                continue
                            unknown.update(parsed.unknown_columns)
                            if not parsed.usable:
                                report.files_rejected += 1
                                report.rejected[name] = parsed.missing_columns
                                continue
                            stores[store.key] = store
                            report.rows_skipped += parsed.skipped_rows
                            for row in parsed.rows:
                                writer.writerow([store.key, *(row[f] or "" for f in FIELDS)])
                    except (httpx.HTTPError, zipfile.BadZipFile) as error:
                        failed.append(remote)
                        log.warning("%s: %s failed (pass %d): %s", chain, remote.name, attempt, error)
                if not failed:
                    break
                pending = failed
                if attempt < PASSES:
                    time.sleep(PASS_PAUSE_SECONDS)
            report.files_failed = len(failed)

        report.unknown_columns = sorted(unknown)
        if stores:
            kept, no_price, duplicates = write_silver(rows_path, list(stores.values()), lake, chain, day)
            report.rows, report.rows_skipped, report.rows_duplicate = kept, report.rows_skipped + no_price, duplicates
            report.stores = len(stores)
        else:
            report.status = "empty" if report.files_failed == 0 else "failed"
            report.error = report.error or ("no price lists in the area" if report.files_failed == 0 else "every download failed")

    report.seconds = round(time.monotonic() - started, 1)
    log.info("%s: %d stores, %d rows, %d skipped (%s)", chain, report.stores, report.rows, report.rows_skipped, report.status)
    return report


# Prices arrive as "1,99", "1.99", ",75", "1.234,56", "   9,39" or "MPC 2.5.2025=7,99€" (the
# last number counts). Zero means "not on offer".
MONEY_MACROS = """
create or replace macro money_text(s) as regexp_extract(coalesce(s, ''), '([0-9.,]*[0-9])[^0-9]*$', 1);
create or replace macro money_value(v) as try_cast(
    case when contains(v, ',') and contains(v, '.') then replace(replace(v, '.', ''), ',', '.')
         else replace(v, ',', '.') end
    as decimal(10, 2));
create or replace macro money(s) as nullif(money_value(money_text(s)), 0);
"""


def write_silver(rows_path: Path, stores: list[Store], lake: Path, chain: str, day: date) -> tuple[int, int, int]:
    """Types and de-duplicates the rows; returns (rows kept, rows without a price, duplicates)."""
    prices_dir = lake / "silver" / "prices" / f"day={day}" / f"chain={chain}"
    stores_dir = lake / "silver" / "stores" / f"day={day}" / f"chain={chain}"
    prices_dir.mkdir(parents=True, exist_ok=True)
    stores_dir.mkdir(parents=True, exist_ok=True)

    con = duckdb.connect()
    con.execute(MONEY_MACROS)
    con.execute(
        # single-threaded: product names can contain line breaks inside quotes, which the
        # parallel reader can't split on
        "create table raw as select * from read_csv(?, header = true, all_varchar = true, delim = ',', quote = '\"', parallel = false)",
        [str(rows_path)],
    )
    con.execute(
        """
        create table typed as
        select
            store_key,
            product_id,
            nullif(regexp_replace(coalesce(barcode, ''), '[^0-9]', '', 'g'), '') as barcode,
            name, brand, category, quantity, unit,
            money(price) as price,
            money(unit_price) as unit_price,
            money(special_price) as special_price,
            money(best_price_30) as best_price_30,
            money(anchor_price) as anchor_price,
            -- some chains mark offers with a flag ("DA", "A", the offer's name) and put the
            -- offer price in the normal price column
            money(special_price) is not null
                or coalesce(upper(trim(offer)) not in ('', 'NE', 'N', '0', 'FALSE'), false) as on_offer,
            -- "DOSTUPNO" / "NEDOSTUPNO", "Dostupan" / "Nedostupan"; no column means available
            coalesce(not regexp_matches(upper(trim(available)), '^(NE|N$|0$|FALSE)'), true) as available
        from raw
        where money(price) is not null or money(special_price) is not null
        """
    )
    priced = con.execute("select count(*) from typed").fetchone()[0]
    con.execute(
        """
        create table deduplicated as
        select * from typed
        qualify row_number() over (partition by store_key, product_id order by available desc, price nulls last) = 1
        """
    )
    total = con.execute("select count(*) from raw").fetchone()[0]
    kept = con.execute("select count(*) from deduplicated").fetchone()[0]
    con.execute(f"copy deduplicated to '{prices_dir / 'data.parquet'}' (format parquet, compression zstd)")

    con.execute("create table stores (store_key varchar, store_type varchar, postal_code varchar, city varchar, label varchar)")
    con.executemany("insert into stores values (?, ?, ?, ?, ?)", [(s.key, s.store_type, s.postal_code, s.city, s.label) for s in stores])
    con.execute(f"copy stores to '{stores_dir / 'data.parquet'}' (format parquet)")
    con.close()
    return kept, total - priced, priced - kept


def ingest(day: date, lake: Path, chains: list[str], area: str, client: httpx.Client) -> list[ChainReport]:
    return [ingest_chain(client, chain, day, area, lake) for chain in chains]
