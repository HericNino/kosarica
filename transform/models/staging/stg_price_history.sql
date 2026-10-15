-- One row per price period of a product in a store (SCD type 2), from the state the
-- pipeline keeps between runs. valid_to is null for the current price.
select
    chain,
    store_key,
    product_id,
    price,
    special_price,
    unit_price,
    -- what a shopper pays: the offer price when there is one and it is lower
    case
        when special_price is not null and (price is null or special_price < price) then special_price
        else coalesce(price, special_price)
    end as paid_price,
    -- an offer price, or a chain's own offer flag (Plodine and Kaufland put the offer
    -- price in the normal price column and mark it)
    on_offer,
    available,
    valid_from,
    valid_to,
    valid_to is null as is_current
from read_parquet('{{ var("lake") }}/state/price_history.parquet')
