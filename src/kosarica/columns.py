"""Mapping price list headers to one schema.

Every chain publishes the same legally required fields (NN 75/2025), but each spells
the headers its own way: "MPC (EUR)", "MALOPRODAJNA_CIJENA", "Maloprodajna cijena",
"MaloprodajnaCijena". Instead of a hand-written map per chain, headers are normalized
and matched by the words they contain, so a renamed column usually keeps working and
an unrecognized one shows up in the run report instead of being silently dropped.
"""

from __future__ import annotations

import re
import unicodedata

FIELDS = (
    "product_id",
    "barcode",
    "name",
    "brand",
    "category",
    "quantity",
    "unit",
    "price",
    "unit_price",
    "special_price",
    "best_price_30",
    "anchor_price",
)

# a file without these can't be used at all
REQUIRED = ("product_id", "name", "price")

# columns that exist in some files and are deliberately not kept
IGNORED = ("sale_type", "available")


def normalize_header(header: str) -> str:
    """'MPC_ZA_VRIJEME_POSEBNOG_OBLIKA_PRODAJE (EUR)' -> 'mpc za vrijeme posebnog oblika prodaje'."""
    text = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", header.strip())  # CamelCase from XML tags
    text = unicodedata.normalize("NFKD", text.replace("đ", "d").replace("Đ", "D"))
    text = "".join(c for c in text if not unicodedata.combining(c)).lower()
    text = re.sub(r"\((eur|kn|€)\)|€", " ", text)
    text = re.sub(r"[^a-z0-9]+", " ", text)
    return " ".join(text.split())


def canonical(header: str) -> str | None:
    """The schema field a header holds, or None if it isn't recognized."""
    h = normalize_header(header)
    words = set(h.split())
    if not h:
        return None
    # order matters: the price columns all contain "cijena", so the specific ones go first
    if "sidrena" in words:
        return "anchor_price"
    if "najniza" in words:
        return "best_price_30"
    if "naziv posebnog" in h or h in ("poseban oblik prodaje", "vrsta akcije"):
        return "sale_type"
    if "posebnog oblika" in h or "akcija" in words or "akcijska" in words:
        return "special_price"
    if ("cijena" in words or "cijene" in words) and ("jedinic" in h or "jm" in words or "jmj" in words):
        return "unit_price"
    if "maloprodajna cijena" in h or h in ("mpc", "cijena"):
        return "price"
    if "barkod" in words or "ean" in words or "barcode" in words:
        return "barcode"
    if "sifra" in words:
        return "product_id"
    if "dostupno" in words:
        return "available"
    if "naziv" in words:
        return "name"
    if "marka" in words:
        return "brand"
    if "neto" in words and ("kolicina" in words or "kol" in words):
        return "quantity"
    if "jedinica mjere" in h or h in ("jm", "jmj"):
        return "unit"
    # Kaufland labels the category column "WG" (Warengruppe) in some stores
    if "kategorija" in words or "kategorije" in words or h == "wg":
        return "category"
    return None


class HeaderMap:
    """Positions of schema fields in one file's header row."""

    def __init__(self, headers: list[str]):
        self.headers = headers
        self.positions: dict[str, int] = {}
        self.unknown: list[str] = []
        for i, header in enumerate(headers):
            field = canonical(header)
            if field is None:
                if header.strip():
                    self.unknown.append(header.strip())
            elif field in FIELDS and field not in self.positions:
                self.positions[field] = i

    @property
    def missing(self) -> list[str]:
        return [f for f in REQUIRED if f not in self.positions]

    def row(self, values: list[str]) -> dict[str, str | None]:
        out: dict[str, str | None] = {}
        for field in FIELDS:
            i = self.positions.get(field)
            value = values[i].strip() if i is not None and i < len(values) else ""
            out[field] = value or None
        return out
