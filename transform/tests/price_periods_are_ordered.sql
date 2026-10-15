select * from {{ ref('stg_price_history') }} where valid_to < valid_from
