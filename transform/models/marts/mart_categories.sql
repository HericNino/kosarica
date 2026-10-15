-- A price index per category and chain: how a chain's prices compare with the average
-- of the chains that sell the same product, over products sold by at least three
-- chains. Geometric mean, so a product twice as expensive and one half as expensive
-- cancel out. -0.05 means 5% cheaper than the average chain for that kind of product.
with relative as (
    select
        category,
        chain,
        gtin,
        price / avg(price) over (partition by gtin) as relative_price,
        count(*) over (partition by gtin) as chains,
        above_cheapest
    from {{ ref('mart_products') }}
)

select
    category,
    chain,
    count(*) as products,
    exp(avg(ln(relative_price))) - 1 as index_vs_average,
    avg((above_cheapest = 0)::int) as cheapest_share
from relative
where chains >= 3
group by category, chain
order by category, chain
