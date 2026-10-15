select chain, day from {{ ref('stg_loads') }} group by all having count(*) > 1
