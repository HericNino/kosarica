{#
  A barcode that identifies the same product in every chain: a valid EAN-8, UPC-A,
  EAN-13 or GTIN-14, padded to 14 digits so the different lengths compare equal.
  Codes starting with 2 are for in-store use (weighed goods, own labels) and mean
  different things in different chains, so they don't count.
#}
{% macro gtin(col) %}
    case
        when regexp_full_match({{ col }}, '\d{8}|\d{12,14}')
         and not starts_with(ltrim({{ col }}, '0'), '2')
         and ltrim({{ col }}, '0') <> ''
         and (10 - list_sum(list_transform(
                 range(1, length({{ col }})),
                 i -> cast(substr(reverse({{ col }}), i + 1, 1) as integer) * (case when i % 2 = 1 then 3 else 1 end)
             )) % 10) % 10 = cast(right({{ col }}, 1) as integer)
        then lpad({{ col }}, 14, '0')
    end
{% endmacro %}
