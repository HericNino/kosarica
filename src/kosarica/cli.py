"""kosarica command line.

kosarica ingest   download a day's price lists into lake/silver (one Parquet file per chain)
kosarica state    fold a day of silver into the price history in lake/state
kosarica report   run the dbt models and tests, write data/report.json
kosarica run      all three, for one day
kosarica probe    list a chain's files for a day and show how their columns are read
"""

from __future__ import annotations

import argparse
import json
import logging
import sys
from datetime import date, datetime
from pathlib import Path
from zoneinfo import ZoneInfo

from . import report, state
from .chains import CHAINS, make_client

log = logging.getLogger("kosarica")


def today() -> date:
    return datetime.now(ZoneInfo("Europe/Zagreb")).date()


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="kosarica", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["ingest", "state", "report", "run", "probe"])
    parser.add_argument("--day", type=date.fromisoformat, default=None, help="YYYY-MM-DD (default: today in Zagreb)")
    parser.add_argument("--chains", default=",".join(CHAINS), help=f"comma separated, from: {', '.join(CHAINS)}")
    parser.add_argument("--area", default="zagreb", choices=["zagreb", "all"], help="which stores to keep (default: zagreb)")
    parser.add_argument("--lake", type=Path, default=Path("lake"))
    parser.add_argument("--data", type=Path, default=Path("data"), help="where report.json and run reports go")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")

    day = args.day or today()
    chains = [c.strip() for c in args.chains.split(",") if c.strip()]
    unknown = [c for c in chains if c not in CHAINS]
    if unknown:
        parser.error(f"unknown chain(s): {', '.join(unknown)}")

    if args.command == "probe":
        return probe(day, chains)

    exit_code = 0
    if args.command in ("ingest", "run"):
        exit_code = ingest(day, chains, args.area, args.lake, args.data)
    if args.command in ("state", "run"):
        applied = state.apply_day(args.lake, day)
        log.info("state: applied %s", applied or "nothing")
    if args.command in ("report", "run"):
        result = report.build(args.lake)
        args.data.mkdir(parents=True, exist_ok=True)
        (args.data / "report.json").write_text(json.dumps(result, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
        log.info("report: %s prices as of %s", result["summary"]["prices"], result["summary"]["as_of"])
    return exit_code


def ingest(day: date, chains: list[str], area: str, lake: Path, data: Path) -> int:
    from .ingest import ingest as run_ingest

    with make_client() as client:
        reports = run_ingest(day, lake, chains, area, client)
    runs = data / "runs"
    runs.mkdir(parents=True, exist_ok=True)
    (runs / f"{day}.json").write_text(json.dumps([r.to_dict() for r in reports], indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    if all(r.status != "ok" for r in reports):
        log.error("no chain produced data for %s", day)
        return 1
    return 0


def probe(day: date, chains: list[str]) -> int:
    """For checking a chain by hand: what files exist, and how the first one's columns map."""
    from .ingest import price_lists
    from .parse import parse

    with make_client() as client:
        for chain in chains:
            try:
                remotes = CHAINS[chain](client, day)
            except Exception as error:
                print(json.dumps({"chain": chain, "error": str(error)}, ensure_ascii=False))
                continue
            sample = None
            if remotes:
                for store, name, data in price_lists(client, remotes[0], "all"):
                    parsed = parse(name, data)
                    sample = {
                        "file": name,
                        "store": store.__dict__,
                        "unknown_columns": parsed.unknown_columns,
                        "missing_columns": parsed.missing_columns,
                        "rows": len(parsed.rows),
                        "first_row": parsed.rows[0] if parsed.rows else None,
                        "head": data[:400].decode("utf-8", errors="replace"),
                    }
                    break
            print(
                json.dumps(
                    {"chain": chain, "files": len(remotes), "names": [r.name for r in remotes[:5]], "sample": sample}, ensure_ascii=False
                )
            )
    return 0


if __name__ == "__main__":
    sys.exit(main())
