"""Where each chain publishes its daily price lists.

This is the only chain-specific code: finding the files for a day. Reading them is
shared (`parse.py`), and so is working out the store (`stores.py`).

Chains are required to publish these lists (Odluka o objavi cjenika, NN 75/2025), but
the pages change without notice, so every function here is small and fails loudly.
"""

from __future__ import annotations

import html
import json
import re
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date
from urllib.parse import parse_qs, quote, unquote, urljoin, urlparse

import httpx


@dataclass(frozen=True)
class RemoteFile:
    chain: str
    name: str  # used to work out the store; for archives, the archive name
    url: str
    archive: bool = False  # a zip with one price list per store


def tags(page: str, name: str) -> list[dict[str, str]]:
    """Attributes of every tag with that name, e.g. tags(page, "a") -> [{'href': '/x.csv', 'format': 'csv'}]."""
    found = []
    for tag in re.findall(rf"<{name}\b([^>]*)>", page, flags=re.IGNORECASE):
        attributes = re.findall(r"""([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')""", tag)
        found.append({attr.lower(): html.unescape(double or single) for attr, double, single in attributes})
    return found


def links(page: str, base: str, **wanted: str) -> list[str]:
    """Absolute hrefs of links, optionally only those with the given attributes."""
    urls = []
    for a in tags(page, "a"):
        href = a.get("href")
        if href and all(a.get(k) == v for k, v in wanted.items()):
            # hrefs sometimes contain raw spaces and diacritics
            urls.append(urljoin(base, quote(unquote(href), safe="/:?&=%#+,;@")))
    return list(dict.fromkeys(urls))


def basename(url: str) -> str:
    return unquote(urlparse(url).path.rsplit("/", 1)[-1])


def spar(client: httpx.Client, day: date) -> list[RemoteFile]:
    """A JSON index per day lists one CSV per store."""
    response = client.get(f"https://www.spar.hr/datoteke_cjenici/Cjenik{day:%Y%m%d}.json")
    response.raise_for_status()
    files = json.loads(response.text).get("files") or []
    return [RemoteFile("spar", f["name"], f["URL"]) for f in files if f.get("name") and f.get("URL")]


def konzum(client: httpx.Client, day: date, max_pages: int = 100) -> list[RemoteFile]:
    """A paginated page per day; each CSV link carries the store in a `title` parameter."""
    found: dict[str, RemoteFile] = {}
    for page in range(1, max_pages + 1):
        url = f"https://www.konzum.hr/cjenici?date={day:%Y-%m-%d}&page={page}"
        response = client.get(url)
        response.raise_for_status()
        new = 0
        for link in links(response.text, url, format="csv"):
            title = parse_qs(urlparse(link).query).get("title", [basename(link)])[0]
            if link not in found:
                found[link] = RemoteFile("konzum", f"{title}.csv", link)
                new += 1
        if new == 0:
            break
    return list(found.values())


def kaufland(client: httpx.Client, day: date) -> list[RemoteFile]:
    """The page embeds a component whose settings point to a JSON list of CSV files, one per store."""
    base = "https://www.kaufland.hr"
    response = client.get(f"{base}/akcije-novosti/popis-mpc.html")
    response.raise_for_status()
    component = next((d for d in tags(response.text, "div") if d.get("data-component") == "AssetList"), None)
    if component is None or "data-props" not in component:
        raise ValueError("price list component not found on the page")
    assets = json.loads(component["data-props"])["settings"]["dataUrlAssets"]
    listing = client.get(urljoin(base, assets))
    listing.raise_for_status()
    stamps = (f"_{day:%d_%m_%Y}_", f"_{day:%d%m%Y}_")
    return [
        RemoteFile("kaufland", item["label"], urljoin(base, item["path"]))
        for item in listing.json()
        if item.get("label") and item.get("path") and any(stamp in item["label"] for stamp in stamps)
    ]


def lidl(client: httpx.Client, day: date) -> list[RemoteFile]:
    """One page listing a CSV per store for roughly the last 30 days; the date is in the file name."""
    url = "https://www.lidl.hr/c/cijene/s10073252"
    response = client.get(url)
    response.raise_for_status()
    stamp = f"{day:%d.%m.%Y}"
    files = []
    for link in links(response.text, url):
        name = basename(link)
        if name.lower().endswith(".zip") and (stamp in name or f"{day:%d_%m_%Y}" in name):
            files.append(RemoteFile("lidl", name, link, archive=True))
        elif name.lower().endswith(".csv") and stamp in name:
            files.append(RemoteFile("lidl", name, link))
    return files


def plodine(client: httpx.Client, day: date) -> list[RemoteFile]:
    """One zip per day with a CSV per store, linked from an index page."""
    url = "https://www.plodine.hr/info-o-cijenama"
    response = client.get(url)
    response.raise_for_status()
    stamp = f"cjenici_{day:%d_%m_%Y}"
    return [RemoteFile("plodine", basename(link), link, archive=True) for link in links(response.text, url) if stamp in link.lower()][:1]


def studenac(client: httpx.Client, day: date) -> list[RemoteFile]:
    """One zip per day at a predictable address, with an XML file per store."""
    url = f"https://www.studenac.hr/cjenici/PROIZVODI-{day:%Y-%m-%d}.zip"
    return [RemoteFile("studenac", basename(url), url, archive=True)]


CHAINS: dict[str, Callable[[httpx.Client, date], list[RemoteFile]]] = {
    "kaufland": kaufland,
    "konzum": konzum,
    "lidl": lidl,
    "plodine": plodine,
    "spar": spar,
    "studenac": studenac,
}


def make_client() -> httpx.Client:
    return httpx.Client(
        timeout=httpx.Timeout(60.0, connect=15.0),
        follow_redirects=True,
        headers={"User-Agent": "kosarica/0.1 (price research; https://github.com/HericNino/kosarica)"},
    )
