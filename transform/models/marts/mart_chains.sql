-- One row per chain: size, how much is on offer, and how prices moved since the
-- anchor date (2 May 2025), which the law makes every chain publish.
with current as (
    select
        chain,
        count(distinct store_key) as stores,
        count(distinct product_id) as products,
        avg(on_offer::int) as offer_share
    from {{ ref('int_current_prices') }}
    group by chain
),

since_anchor as (
    select
        chain,
        count(*) as compared,
        median(price / anchor_price - 1) as median_change_since_anchor,
        avg((price > anchor_price)::int) as share_up_since_anchor,
        avg((price < anchor_price)::int) as share_down_since_anchor
    from {{ ref('stg_latest_prices') }}
    where anchor_price > 0 and price > 0
    group by chain
),

loads as (
    select chain, max(day) as last_day, count(*) as days from {{ ref('stg_loads') }} group by chain
)

select
    c.chain,
    l.last_day,
    l.days,
    c.stores,
    c.products,
    c.offer_share,
    a.compared,
    a.median_change_since_anchor,
    a.share_up_since_anchor,
    a.share_down_since_anchor
from current as c
join loads as l using (chain)
left join since_anchor as a using (chain)
order by c.chain
