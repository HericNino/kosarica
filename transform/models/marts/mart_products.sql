-- Products sold by at least two chains, with each chain's median price today and its
-- median anchor price (2 May 2025). This is what the product search on the site shows.
with prices as (
    select chain, gtin, median(paid_price) as price, count(distinct store_key) as stores, avg(on_offer::int) as offer_share
    from {{ ref('int_current_prices') }}
    where gtin is not null
    group by chain, gtin
),

anchors as (
    select l.chain, p.gtin, median(l.anchor_price) as anchor_price
    from {{ ref('stg_latest_prices') }} as l
    join {{ ref('stg_products') }} as p using (chain, product_id)
    where p.gtin is not null and l.anchor_price > 0
    group by l.chain, p.gtin
),

comparable as (
    select gtin from prices group by gtin having count(*) >= 2
)

select
    c.gtin,
    c.name,
    c.category,
    pr.chain,
    pr.price,
    a.anchor_price,
    pr.stores,
    pr.offer_share,
    pr.price / min(pr.price) over (partition by c.gtin) - 1 as above_cheapest
from prices as pr
join comparable using (gtin)
join {{ ref('int_product_catalog') }} as c using (gtin)
left join anchors as a using (chain, gtin)
