select chain, day, rows, changed
from read_parquet('{{ var("lake") }}/state/loads.parquet')
