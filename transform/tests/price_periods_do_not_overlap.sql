-- Two periods of the same store and product must never cover the same day.
select a.chain, a.store_key, a.product_id, a.valid_from, b.valid_from
from {{ ref('stg_price_history') }} as a
join {{ ref('stg_price_history') }} as b
  on a.chain = b.chain and a.store_key = b.store_key and a.product_id = b.product_id
 and a.valid_from < b.valid_from
 and b.valid_from <= coalesce(a.valid_to, date '9999-12-31')
