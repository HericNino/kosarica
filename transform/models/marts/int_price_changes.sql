-- Every time a store's price for a product moved from one day to the next.
with ordered as (
    select
        *,
        lag(paid_price) over w as previous_price,
        lag(unit_price) over w as previous_unit_price,
        lag(valid_to) over w as previous_valid_to,
        lag(on_offer) over w as previous_on_offer
    from {{ ref('stg_price_history') }}
    window w as (partition by chain, store_key, product_id order by valid_from)
)
select
    chain,
    store_key,
    product_id,
    valid_from as day,
    previous_price,
    paid_price as new_price,
    previous_unit_price,
    unit_price as new_unit_price,
    previous_on_offer,
    on_offer,
    paid_price / previous_price - 1 as change
from ordered
-- only back-to-back periods: a product that was gone for a while didn't "change price"
where previous_valid_to = valid_from - 1
  and previous_price is not null
  and paid_price is not null
