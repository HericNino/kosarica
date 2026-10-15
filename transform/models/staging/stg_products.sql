select
    chain,
    product_id,
    barcode,
    {{ gtin('barcode') }} as gtin,
    name,
    brand,
    category,
    quantity,
    unit,
    first_seen,
    last_seen
from read_parquet('{{ var("lake") }}/state/products.parquet')
