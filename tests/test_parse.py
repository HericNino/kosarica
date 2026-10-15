from kosarica.parse import parse, parse_csv, sniff_delimiter


def test_semicolon_cp1250():
    data = "Naziv;Šifra;MPC\nČokolada 100 g;7;1,49\n".encode("cp1250")
    parsed = parse_csv(data)
    assert parsed.rows[0]["name"] == "Čokolada 100 g"
    assert parsed.rows[0]["price"] == "1,49"


def test_tab_and_bom():
    data = "﻿NAZIV\tŠIFRA\tMALOPRODAJNA CIJENA\nKruh\t9\t0,99\n".encode()
    assert parse_csv(data).rows[0]["product_id"] == "9"


def test_quoted_commas():
    data = 'NAZIV,ŠIFRA,MALOPRODAJNA_CIJENA\n"Mlijeko 2,8%",1,"1,19"\n'.encode()
    row = parse_csv(data).rows[0]
    assert (row["name"], row["price"]) == ("Mlijeko 2,8%", "1,19")


def test_rows_without_id_or_price_are_skipped():
    data = "Naziv;Šifra;MPC\nA;1;1,00\nB;;2,00\nC;3;\n;;\n".encode()
    parsed = parse_csv(data)
    assert [r["name"] for r in parsed.rows] == ["A"]
    assert parsed.skipped_rows == 2


def test_missing_required_column_makes_file_unusable():
    parsed = parse_csv(b"Naziv;Kolicina\nMlijeko;1\n")
    assert not parsed.usable
    assert parsed.rows == []


def test_xml_with_namespace():
    data = b"""<?xml version="1.0"?><x:Lista xmlns:x="urn:t"><x:Artikl><x:Naziv>Sir</x:Naziv>
    <x:Sifra>5</x:Sifra><x:MaloprodajnaCijena>3,99</x:MaloprodajnaCijena></x:Artikl></x:Lista>"""
    assert parse("a.xml", data).rows[0]["price"] == "3,99"


def test_sniff_delimiter():
    assert sniff_delimiter("a;b;c") == ";"
    assert sniff_delimiter("a\tb") == "\t"
    assert sniff_delimiter("abc") == ","
