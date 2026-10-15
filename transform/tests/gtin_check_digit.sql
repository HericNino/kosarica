-- The barcode macro against known values: two real EAN-13s, an in-store code, a typo.
with cases as (
    select * from (values
        ('5449000000996', true),   -- Coca-Cola 0.33 l
        ('4006381333931', true),   -- Stabilo pen, the usual textbook example
        ('96385074', true),        -- valid EAN-8
        ('2001234000007', false),  -- in-store code (starts with 2)
        ('5449000000997', false),  -- wrong check digit
        ('12345', false)
    ) as t(barcode, expected)
)
select * from cases where ({{ gtin('barcode') }} is not null) <> expected
