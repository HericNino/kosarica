select chain, store_key, store_type, postal_code, city, label, first_seen, last_seen
from read_parquet('{{ var("lake") }}/state/stores.parquet')
