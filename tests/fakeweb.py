"""A pretend internet with price lists in the formats the chains use, for tests.

The files are made up but shaped like the real ones: Spar's JSON index with
semicolon CSVs, Studenac's zip of XML files, Lidl's Windows-1250 CSVs with
upper-case headers, and Plodine's zip of CSVs with a failing store.
"""

from __future__ import annotations

import io
import json
import zipfile
from datetime import date

import httpx

SPAR_HEADER = ";".join(
    [
        "naziv",
        "šifra",
        "marka",
        "neto količina",
        "jedinica mjere",
        "MPC (EUR)",
        "cijena za jedinicu mjere (EUR)",
        "MPC za vrijeme posebnog oblika prodaje (EUR)",
        "Najniža cijena u posljednjih 30 dana (EUR)",
        "sidrena cijena na 2.5.2025. (EUR)",
        "barkod",
        "kategorija proizvoda",
    ]
)
LIDL_HEADER = ",".join(
    [
        "NAZIV",
        "ŠIFRA",
        "MARKA",
        "NETO_KOLIČINA",
        "JEDINICA_MJERE",
        "MALOPRODAJNA_CIJENA",
        "CIJENA_ZA_JEDINICU_MJERE",
        "MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE",
        "NAJNIZA_CIJENA_U_POSLJ._30_DANA",
        "Sidrena_cijena_na_02.05.2025",
        "BARKOD",
        "KATEGORIJA_PROIZVODA",
    ]
)


def spar_csv(milk: str, bread: str | None, coffee_special: str = "") -> bytes:
    lines = [SPAR_HEADER, f"Mlijeko 2,8% 1 l;1001;Dukat;1;l;{milk};{milk};;1,19;1,09;3850102123452;Mlijeko"]
    if bread is not None:
        lines.append(f"Kruh bijeli 500 g;1002;Spar;0,5;kg;{bread};{bread};;0,99;0,95;;Kruh")
    lines.append(f"Kava mljevena 250 g;1003;Franck;0,25;kg;4,49;17,96;{coffee_special};4,29;3,99;3850104004001;Kava")
    lines.append(";;;;;;;;;;;")  # blank line
    lines.append("Bez cijene;1004;X;1;kom;;;;;;;Ostalo")  # no price: skipped
    return "\n".join(lines).encode("utf-8")


def lidl_csv(milk: str) -> bytes:
    rows = [
        LIDL_HEADER,
        f'"Mlijeko 2,8%",501,Pilos,1,l,"{milk}","{milk}",,"1,05","0,99",3850102123452,Mlijeko',
        f'"Mlijeko 2,8%",501,Pilos,1,l,"{milk}","{milk}",,"1,05","0,99",20501000,Mlijeko',  # same product, second barcode
        '"Svijeća\nmirisna",502,Lidl,1,kom,"2,99","2,99",,,,,Dom',  # a line break inside a quoted name
    ]
    return "\r\n".join(rows).encode("cp1250")


def kaufland_csv(milk: str) -> bytes:
    """Tab separated, abbreviated headers, padded prices, the offer as an "A" flag."""
    columns = ["naziv proizvoda", "šifra proizvoda", "marka proizvoda", "neto količina(KG)", "jedinica mjere"]
    columns += ["maloprod.cijena(EUR)", "akc.cijena, A=akcija", "cijena jed.mj.(EUR)", "MPC poseb.oblik prod"]
    columns += ["Sidrena cijena", "barkod", "WG", "Dostupan/Nedostupan"]
    rows = [
        [
            "Mlijeko 2,8% 1 l",
            "9001",
            "Dukat",
            "1",
            "l",
            f"    {milk}",
            "",
            milk,
            "",
            "MPC 2.5.2025=1,09€",
            "3850102123452",
            "Mlijeko",
            "Dostupan",
        ],
        [
            "Kava 250 g",
            "9002",
            "Franck",
            "0.250",
            "KOM",
            "    3,79",
            "A",
            "15,16",
            "",
            "MPC 2.5.2025=3,99€",
            "3850104004001",
            "Kava",
            "Dostupan",
        ],
        ["Sir 1 kg", "9003", "Kaufland", "1", "KOM", "    7,99", "", "7,99", "", "", "3850999000003", "Sir", "Nedostupan"],
    ]
    return "\n".join("\t".join(r) for r in [columns, *rows]).encode()


def studenac_xml(milk: str) -> bytes:
    return f"""<?xml version="1.0" encoding="UTF-8"?>
<Proizvodi>
  <ProdajniObjekt>Studenac Zagreb</ProdajniObjekt>
  <Proizvod>
    <NazivProizvoda>Mlijeko 2,8% 1l</NazivProizvoda><SifraProizvoda>S-1</SifraProizvoda><MarkaProizvoda>Dukat</MarkaProizvoda>
    <NetoKolicina>1</NetoKolicina><JedinicaMjere>l</JedinicaMjere><MaloprodajnaCijena>{milk}</MaloprodajnaCijena>
    <CijenaZaJedinicuMjere>{milk}</CijenaZaJedinicuMjere><MaloprodajnaCijenaAkcija></MaloprodajnaCijenaAkcija>
    <NajnizaCijena>1,15</NajnizaCijena><SidrenaCijena>1,05</SidrenaCijena><Barkod>3850102123452</Barkod>
    <KategorijeProizvoda>Mlijeko</KategorijeProizvoda>
  </Proizvod>
</Proizvodi>""".encode()


def zip_of(files: dict[str, bytes]) -> bytes:
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as z:
        for name, data in files.items():
            z.writestr(name, data)
    return buffer.getvalue()


class FakeWeb:
    """Day 1 and day 2 of four chains. Day 2: milk goes up at Spar, bread is delisted,
    coffee goes on offer, and one Spar store's download fails."""

    DAY1 = date(2026, 10, 14)
    DAY2 = date(2026, 10, 15)

    def __init__(self):
        self.requests: list[str] = []

    def handler(self, request: httpx.Request) -> httpx.Response:
        url = str(request.url)
        self.requests.append(url)
        day = self.DAY2 if ("20261015" in url or "2026-10-15" in url or "15_10_2026" in url) else self.DAY1
        second = day == self.DAY2

        if url.startswith("https://www.spar.hr/datoteke_cjenici/Cjenik"):
            stamp = f"{day:%Y%m%d}"
            files = [
                {
                    "name": f"supermarket_zagreb_ilica_1_0101_spar_zagreb_0001_{stamp}_0330.csv",
                    "URL": f"https://www.spar.hr/f/zg1_{stamp}.csv",
                },
                {
                    "name": f"hipermarket_zagreb_avenija_dubrava_2_0202_interspar_zagreb_0002_{stamp}_0330.csv",
                    "URL": f"https://www.spar.hr/f/zg2_{stamp}.csv",
                },
                {
                    "name": f"supermarket_split_poljicka_3_0303_spar_split_0003_{stamp}_0330.csv",
                    "URL": f"https://www.spar.hr/f/st3_{stamp}.csv",
                },
            ]
            return httpx.Response(200, json={"files": files})
        if url.startswith("https://www.spar.hr/f/zg1_"):
            return httpx.Response(200, content=spar_csv("1,29" if second else "1,19", None if second else "0,99", "3,99" if second else ""))
        if url.startswith("https://www.spar.hr/f/zg2_"):
            if second:
                return httpx.Response(503)
            return httpx.Response(200, content=spar_csv("1,19", "0,99"))
        if url.startswith("https://www.spar.hr/f/st3_"):
            raise AssertionError("stores outside the area must not be downloaded")

        if url == "https://www.lidl.hr/c/cijene/s10073252":
            names = [
                "Supermarket 104_Ilica_200_10000_Zagreb_1_14.10.2026_7.15h.csv",
                "Supermarket 104_Ilica_200_10000_Zagreb_1_15.10.2026_7.15h.csv",
                "Supermarket 220_Vukovarska_5_21000_Split_1_15.10.2026_7.15h.csv",
            ]
            page = "".join(f'<a href="/files/{n}">{n}</a>' for n in names)
            return httpx.Response(200, text=f"<html><body>{page}</body></html>")
        if url.startswith("https://www.lidl.hr/files/"):
            # day 2 fails a whole pass of retries, like Konzum does at random, then works
            if "15.10.2026" in url and self.requests.count(url) <= 3:
                return httpx.Response(404)
            return httpx.Response(200, content=lidl_csv("1,09"))

        if url.startswith("https://www.studenac.hr/cjenici/PROIZVODI-"):
            return httpx.Response(
                200,
                content=zip_of(
                    {
                        f"T123_Ulica_grada_Vukovara_10_10000_Zagreb_{day:%d%m%Y}.xml": studenac_xml("1,25"),
                        f"T456_Riva_1_21000_Split_{day:%d%m%Y}.xml": studenac_xml("1,35"),
                    }
                ),
            )

        if url == "https://www.plodine.hr/info-o-cijenama":
            return httpx.Response(200, text='<a href="/cjenici/cjenici_14_10_2026_07_00_00.zip">zip</a>')
        if url.startswith("https://www.plodine.hr/cjenici/cjenici_14_10_2026"):
            bad = b"Naziv;Kolicina\nMlijeko;1\n"
            return httpx.Response(200, content=zip_of({"SUPERMARKET_ILICA_5_10000_ZAGREB_001_1_14102026070000.csv": bad}))

        if url == "https://www.kaufland.hr/akcije-novosti/popis-mpc.html":
            props = json.dumps({"settings": {"dataUrlAssets": "/data/assets.json"}}).replace('"', "&quot;")
            return httpx.Response(200, text=f'<div class="x" data-component="AssetList" data-props="{props}"></div>')
        if url == "https://www.kaufland.hr/data/assets.json":
            items = [
                {"label": f"Hipermarket_Zagreb_Jankomir_31_4050_{d:%d_%m_%Y}_7_30.csv", "path": f"/f/zg_{d:%d%m}.csv"}
                for d in (self.DAY1, self.DAY2)
            ] + [{"label": f"Supermarket_Put_Gaceleza_1D_Vodice_6730_{self.DAY2:%d_%m_%Y}_7_30.csv", "path": "/f/vodice.csv"}]
            return httpx.Response(200, json=items)
        if url.startswith("https://www.kaufland.hr/f/zg_"):
            return httpx.Response(200, content=kaufland_csv("1,15"))

        return httpx.Response(404)

    def client(self) -> httpx.Client:
        return httpx.Client(transport=httpx.MockTransport(self.handler))
