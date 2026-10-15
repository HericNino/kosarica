select chain, store_key, product_id, count(*) as current_periods
from {{ ref('stg_price_history') }}
where is_current
group by all
having count(*) > 1
