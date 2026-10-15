-- The latest day's silver rows, for the fields the history doesn't keep: the
-- lowest price in the last 30 days and the anchor price of 2 May 2025.
with latest as (select max(day) as day from {{ ref('stg_loads') }})
select
    p.chain,
    p.store_key,
    p.product_id,
    p.price,
    p.special_price,
    p.best_price_30,
    p.anchor_price
from read_parquet('{{ var("lake") }}/silver/prices/*/*/data.parquet', hive_partitioning = true) as p
where p.day = (select day from latest)
