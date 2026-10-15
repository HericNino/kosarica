# kosarica

How much does the same shopping basket cost in Konzum, Lidl, Kaufland, Spar, Plodine and Studenac, and how are prices moving? Since May 2025 every supermarket chain in Croatia has to publish its full price list every day, per store (Odluka o objavi cjenika, NN 75/2025). kosarica collects those lists for stores in the Zagreb area and turns them into a price history.

It's built as a small lakehouse, the way the same job would be done on Azure or Databricks, but running on DuckDB and GitHub Actions for free.

## How it works

```
GitHub Actions, daily
  └─ kosarica run
       ├─ ingest   find each chain's files for the day, download, read    (bronze → silver)
       │           CSV in three encodings and four delimiters, zips, XML
       │           → lake/silver/prices/day=…/chain=…/data.parquet
       ├─ state    fold the day into the price history (SCD type 2)       (silver → state)
       │           → lake/state/price_history.parquet, products, stores, loads
       └─ report   dbt build on DuckDB: models + data tests               (state → gold)
                   → data/report.json
  └─ save state and the day's silver to GitHub releases, commit the report
```

**One schema for every chain.** Each chain spells the legally required columns its own way: `MPC (EUR)`, `MALOPRODAJNA_CIJENA`, `Maloprodajna cijena`, `MaloprodajnaCijena`. Instead of a hand-written mapping per chain, `columns.py` normalizes headers (case, diacritics, CamelCase, units) and recognizes fields by the words they contain. The only chain-specific code is finding the day's files (`chains.py`).

**Schema drift is reported, not guessed.** A file without a product code, name or price is rejected and listed in the day's run report (`data/runs/<day>.json`) with the columns it was missing. Columns that aren't recognized are listed too, so a chain renaming a header shows up the next morning instead of quietly turning into empty values.

**History as periods, not copies.** A full copy of the day is millions of rows that are almost all the same as yesterday. `state.py` keeps one row per price period (`valid_from`, `valid_to`), closing the periods that changed and opening new ones, with three rules:

- Only stores in today's data can lose products. If a store's file fails to download, its prices stay current instead of looking like the store emptied overnight.
- A chain and day are applied once, so re-running a day changes nothing.
- Days are applied in order; an older day is refused, because it would rewrite periods later days already closed. Backfilling means rebuilding from the silver files.

This is what a dbt snapshot does, written by hand because dbt snapshots stamp periods with the time of the run, and a backfill needs the date of the data.

**Quality gates.** dbt data tests check that price periods never overlap, that each product has at most one current price, that prices are plausible, and that the barcode logic matches known EAN values. If one fails, the run stops before the state is uploaded, so bad data never replaces the good state.

**Comparing like with like.** Products are matched across chains by barcode, after checking the check digit and dropping in-store codes (prefix 2, used for weighed goods). The basket comparison only uses products that every chain sells, each at its median price across the chain's stores.

## What it computes

| Mart | Question |
|---|---|
| `mart_basket` | What does the same basket of identical products cost in each chain? |
| `mart_cheapest` | Among products sold by at least two chains, how often is each chain the cheapest? |
| `mart_chains` | How many stores and products, what share is on offer, and how have prices moved since the anchor date of 2 May 2025? |
| `mart_daily_changes` | How many prices went up or down each day, and by how much? |
| `mart_shrinkflation` | Which products got more expensive per kilo or litre while the price stayed the same? |

## First numbers

On 15 October 2026, in 153 stores in the Zagreb area (postal codes 10xxx), 765 products with the same barcode were on sale in all five chains that published that day. That basket cost:

| Chain | Basket | Above the cheapest |
|---|---|---|
| Lidl | 2,818.73 € | |
| Plodine | 3,224.42 € | +14.4% |
| Spar | 3,298.72 € | +17.0% |
| Konzum | 3,344.27 € | +18.6% |
| Kaufland | 3,346.54 € | +18.7% |

One day of data says nothing yet about trends; `data/report.json` is updated every morning.

## What the real data showed

The first runs against the live sites turned up things no sample file would have:

- **Offers without an offer price.** Plodine and Kaufland put the offer price in the normal price column and mark it with a flag (`DA`, `A`), so reading only the offer price column showed 0% on offer. Flags are now kept and tracked.
- **Out-of-stock products.** Plodine lists products it doesn't have, marked `NEDOSTUPNO`. They stay in the history but don't count as current prices.
- **The same product many times.** Lidl lists a product once per barcode, about 200,000 extra rows a day. They are counted separately from rows without a price, so the run report still shows real data loss.
- **A street name is not a city.** A Plodine store on Zagrebačka ulica in Zadar was counted as Zagreb. The postal code now decides when the file name has one.
- **Prices written as sentences.** Kaufland's anchor price column holds `MPC 2.5.2025=7,99€`, Plodine writes `,75`. Prices are read as the last number in the cell.
- **Line breaks inside product names.** DuckDB's parallel CSV reader refused one day's combined file, and the run stopped before saving anything, which is what the quality gate is for.
- **Random failures.** Konzum answers some requests with 404 and the same file a minute later. Files that fail get a second pass at the end instead of more retries in a row.
- **Partial days.** Studenac's daily archive held 20 stores, none in Zagreb. Stores missing from a day keep their prices, so a partial publication doesn't look like closed stores.

## Running locally

Requires [uv](https://docs.astral.sh/uv/).

```bash
uv sync
uv run kosarica run                          # today's prices, Zagreb area
uv run kosarica run --day 2026-10-15 --chains lidl,spar
uv run kosarica probe --chains konzum        # what a chain publishes and how its columns are read

uv run pytest
uv run ruff check . && uv run ruff format --check .
```

The tests run the whole pipeline, dbt included, against a fake set of chain websites (`tests/fakeweb.py`): two days, a price rise, a product delisted, an offer, a store whose download fails, a file with missing columns, Windows-1250 encoding and a zip of XML files.

## Where the data lives

| Layer | Where | Why |
|---|---|---|
| Raw files | only during a run | a full day is gigabytes; the chains keep them online |
| Silver | release `silver-YYYY-MM`, one Parquet file per chain and day | to rebuild the history or backfill |
| State | release `state` | rewritten daily, too big and too churny for git |
| Report | `data/report.json` in git | small, and each day's commit is a readable diff |

On Azure the same layout maps directly: releases become a Data Lake container, the GitHub Actions schedule becomes a Data Factory pipeline, and the dbt project runs unchanged against Synapse or Databricks with a different adapter.

## Layout

```
src/kosarica/
  chains.py   where each chain publishes its files
  columns.py  header normalization and field recognition
  parse.py    CSV (encoding, delimiter) and XML reading
  stores.py   store, postal code and city from file names
  ingest.py   bronze → silver, with the run report
  state.py    price history as SCD type 2 periods
  report.py   runs dbt, writes report.json
transform/    dbt project: staging, marts, data tests, the barcode macro
tests/        pytest, with a fake web of chain sites
```

## License

MIT
