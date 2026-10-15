-- Same product, same or lower price, but a higher price per kilo or litre: the
-- package probably got smaller. Listed per product, not per store.
select
    c.chain,
    c.product_id,
    p.name,
    p.brand,
    c.day,
    median(c.previous_price) as previous_price,
    median(c.new_price) as new_price,
    median(c.previous_unit_price) as previous_unit_price,
    median(c.new_unit_price) as new_unit_price,
    count(distinct c.store_key) as stores
from {{ ref('int_price_changes') }} as c
join {{ ref('stg_products') }} as p using (chain, product_id)
where not c.on_offer
  and not c.previous_on_offer
  and c.new_price <= c.previous_price
  and c.new_unit_price > c.previous_unit_price * 1.05
group by all
order by c.day desc, c.chain, p.name
