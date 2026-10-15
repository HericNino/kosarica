{# Lower case, no diacritics, only letters, digits and %: what the category rules match against. #}
{% macro search_text(col) %}
    trim(regexp_replace(lower(strip_accents(replace(replace({{ col }}, 'đ', 'd'), 'Đ', 'D'))), '[^a-z0-9%]+', ' ', 'g'))
{% endmacro %}
