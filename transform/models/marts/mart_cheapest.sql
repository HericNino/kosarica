-- For products sold by at least two chains: how often each chain is the cheapest.
with by_chain as (
    select chain, gtin, median(paid_price) as price
    from {{ ref('int_current_prices') }}
    where gtin is not null
    group by chain, gtin
),

comparable as (
    select *, min(price) over (partition by gtin) as best, count(*) over (partition by gtin) as chains
    from by_chain
)

select
    chain,
    count(*) as comparable_products,
    count(*) filter (where price = best) as cheapest,
    avg((price = best)::int) as cheapest_share,
    median(price / best - 1) as median_above_best
from comparable
where chains >= 2
group by chain
order by cheapest_share desc
