-- The same basket in every chain: products (by barcode) that every chain sells,
-- each at its median price across the chain's stores. Only identical products are
-- compared, so the difference is price, not what's in the basket.
with by_chain as (
    select chain, gtin, any_value(name) as name, median(paid_price) as price
    from {{ ref('int_current_prices') }}
    where gtin is not null
    group by chain, gtin
),

common as (
    select gtin
    from by_chain
    group by gtin
    having count(distinct chain) = (select count(distinct chain) from by_chain)
)

select
    chain,
    count(*) as items,
    sum(price) as total,
    sum(price) / min(sum(price)) over () - 1 as above_cheapest
from by_chain
join common using (gtin)
group by chain
order by total
