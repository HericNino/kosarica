-- Products (by barcode) that every chain sells, with each chain's median price across
-- its stores. Only identical products are compared, so the difference is price, not
-- what's in the basket.
with by_chain as (
    select chain, gtin, mode(name) as name, median(paid_price) as price, count(distinct store_key) as stores
    from {{ ref('int_current_prices') }}
    where gtin is not null
    group by chain, gtin
),

common as (
    select gtin
    from by_chain
    group by gtin
    having count(distinct chain) = (select count(distinct chain) from by_chain)
),

-- one readable name per product: chains differ ("MLIJEKO DUKAT 2,8% 1L" vs "Dukat mlijeko 2,8% 1 l")
named as (
    select gtin, arg_min(name, case chain when 'kaufland' then 1 when 'spar' then 2 when 'lidl' then 3 when 'konzum' then 4 else 5 end) as name
    from by_chain
    join common using (gtin)
    group by gtin
)

select b.gtin, n.name, b.chain, b.price, b.stores
from by_chain as b
join common using (gtin)
join named as n using (gtin)
order by n.name, b.chain
