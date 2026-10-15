-- Today's price of every product in every store that is still publishing price lists.
with as_of as (select max(day) as day from {{ ref('stg_loads') }})
select
    h.chain,
    h.store_key,
    h.product_id,
    p.gtin,
    p.name,
    p.brand,
    p.category,
    h.price,
    h.special_price,
    h.paid_price,
    h.on_offer,
    h.unit_price,
    h.valid_from
from {{ ref('stg_price_history') }} as h
join {{ ref('stg_stores') }} as s using (chain, store_key)
join {{ ref('stg_products') }} as p using (chain, product_id)
where h.is_current
  and s.last_seen >= (select day from as_of) - {{ var('store_grace_days') }}
