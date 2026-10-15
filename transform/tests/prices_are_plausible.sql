-- Retail prices between 1 cent and 10,000 euros; anything else is a parsing error.
select * from {{ ref('stg_price_history') }}
where paid_price <= 0 or paid_price > 10000
