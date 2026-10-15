-- Price increases and decreases per chain and day.
select
    day,
    chain,
    count(*) filter (where change > 0) as increases,
    count(*) filter (where change < 0) as decreases,
    median(change) filter (where change > 0) as median_increase,
    median(change) filter (where change < 0) as median_decrease
from {{ ref('int_price_changes') }}
group by day, chain
order by day, chain
