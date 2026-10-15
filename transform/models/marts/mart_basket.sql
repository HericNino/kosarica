-- What the same basket costs in each chain: the sum of mart_basket_items.
select
    chain,
    count(*) as items,
    sum(price) as total,
    sum(price) / min(sum(price)) over () - 1 as above_cheapest
from {{ ref('mart_basket_items') }}
group by chain
order by total
