-- One row per product (barcode) across chains, with a readable name and a category.
-- Chains' own categories are inconsistent ("HRANA" for everything at Konzum, none at
-- Plodine), so the category comes from rules on the name (seeds/category_rules.csv),
-- with the chains' category words as extra context. Lower priority wins.
with products as (
    select
        gtin,
        -- prefer the chains that write names in normal case
        arg_min(name, case chain when 'kaufland' then 1 when 'spar' then 2 when 'lidl' then 3 when 'konzum' then 4 else 5 end) as name,
        mode(brand) as brand,
        string_agg(distinct coalesce(category, ''), ' ') as chain_categories
    from {{ ref('stg_products') }}
    where gtin is not null
    group by gtin
),

matched as (
    select p.gtin, r.category, r.priority
    from products as p
    join {{ ref('category_rules') }} as r
      on regexp_matches({{ search_text("p.name || ' ' || p.chain_categories") }}, r.pattern)
)

select
    p.gtin,
    p.name,
    p.brand,
    coalesce((select arg_min(m.category, m.priority) from matched as m where m.gtin = p.gtin), 'Ostalo') as category
from products as p
