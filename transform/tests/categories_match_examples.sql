-- The category rules against names as the chains write them, abbreviations included.
with cases as (
    select * from (values
        ('MLIJEKO TRAJNO 2,8% 1L DOLINE', 'Mlijeko i mliječni'),
        ('ČOK.KNOPPERS NUTBAR 120 g', 'Slatkiši i grickalice'),
        ('NAPOL.MANNER NARANČA 185 g', 'Slatkiši i grickalice'),
        ('HRANA ZA MAČKE SHEBA PILE.85 g', 'Kućni ljubimci'),
        ('Pampers Pelene Premium care vel.2 88/1', 'Djeca i bebe'),
        ('ZAČIN PAPAR CRVENI ZRNO 25 g', 'Osnovne namirnice'),
        ('Kotanyi paprika s aromom dima 50 g', 'Osnovne namirnice'),
        ('LABELLO 4,8 G MED REPAIR', 'Higijena i kozmetika'),
        ('Finish sol za perilicu posuđa 1,5 kg', 'Kućanstvo'),
        ('KAVA JUBILARNA MLJEVENA 300 G FRANCK', 'Kava i čaj'),
        ('VINO GRAŠ GOLDBERG 0.75L VINA BELJE', 'Pića'),
        ('SLADOLED KONTIKI LEDO 4x75 ml', 'Smrznuto'),
        ('KRUH DOMAĆI MIJEŠANI 400G DON DON', 'Kruh i pekarski'),
        ('LASAGNE ŠPINAT/RICOTA 400 g', 'Gotova jela'),
        ('PILEĆA KRILA PIKANTNA 450 g', 'Meso i riba'),
        ('TJES.FLAVIO PIPE RIGATE 500 g', 'Osnovne namirnice'),
        ('Češnjak domaći 200g', 'Voće i povrće'),
        ('Dolcela Vanilin šećer 8g', 'Osnovne namirnice')
    ) as t(name, expected)
),

matched as (
    select c.name, c.expected, arg_min(r.category, r.priority) as category
    from cases as c
    left join {{ ref('category_rules') }} as r on regexp_matches({{ search_text('c.name') }}, r.pattern)
    group by all
)

select * from matched where category is distinct from expected
