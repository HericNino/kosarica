select
    (select max(day) from {{ ref('stg_loads') }}) as as_of,
    (select count(distinct chain) from {{ ref('int_current_prices') }}) as chains,
    (select count(distinct chain || '/' || store_key) from {{ ref('int_current_prices') }}) as stores,
    (select count(*) from {{ ref('int_current_prices') }}) as prices,
    (select count(distinct gtin) from {{ ref('int_current_prices') }}) as products_with_barcode,
    (select count(*) from (
        select gtin from {{ ref('int_current_prices') }} where gtin is not null
        group by gtin having count(distinct chain) >= 2
    )) as products_in_several_chains,
    (select count(*) from {{ ref('stg_price_history') }}) as price_periods,
    (select count(distinct day) from {{ ref('stg_loads') }}) as days_collected
