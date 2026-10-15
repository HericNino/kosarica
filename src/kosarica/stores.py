"""Store details from price list file names.

Chains put the store into the file name, each in its own format:

    Supermarket 104_Ulica Dr. Franje Tuđmana_30_10450_Jastrebarsko_1_24.09.2026_7.15h.csv
    SUPERMARKET_ULICA_FRANJE_TUDJMANA_83A_10450_JASTREBARSKO_063_2_16052025020937.csv
    hipermarket_zadar_bleiburskih_zrtava_18_8701_interspar_zadar_0017_20250518_0330.csv

What they share: the date comes after everything that identifies the store. So the
part before the date is a stable key for the store, and a five digit number in it is
almost always the postal code, with the city next to it.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

DATE = re.compile(r"(\d{4}-\d{2}-\d{2}|\d{2}[._-]\d{2}[._-]\d{4}|\d{14}|(?<!\d)\d{8}(?!\d))")
STORE_TYPES = {"supermarket", "hipermarket", "market", "minimarket", "diskont", "trgovina", "prodavaonica", "superstore"}


@dataclass(frozen=True)
class Store:
    key: str  # stable across days, unique within a chain
    store_type: str | None
    postal_code: str | None
    city: str | None
    label: str  # readable name for reports

    def in_area(self, area: str) -> bool:
        if area == "all":
            return True
        if area == "zagreb":
            # Zagreb and its surroundings: postal codes 10xxx, or chains that only name the city
            return (self.postal_code or "").startswith("10") or "zagreb" in self.key.lower()
        raise ValueError(f"unknown area {area!r}")


def from_filename(filename: str) -> Store:
    stem = filename.rsplit("/", 1)[-1]
    stem = re.sub(r"\.(csv|xml|txt)$", "", stem, flags=re.IGNORECASE)
    match = DATE.search(stem)
    key = (stem[: match.start()] if match else stem).strip(" _-.")
    tokens = [t for t in re.split(r"[_\s\-,]+", key) if t]

    store_type = tokens[0].lower() if tokens and tokens[0].lower() in STORE_TYPES else None
    postal_code = city = None
    for i, token in enumerate(tokens):
        if re.fullmatch(r"\d{5}", token) and 10000 <= int(token) <= 53999:
            postal_code = token
            after = _words(tokens[i + 1 :])
            before = _words(reversed(tokens[:i]))[::-1]
            city = " ".join(after or before) or None
            break
    return Store(
        key=key,
        store_type=store_type,
        postal_code=postal_code,
        city=city.title() if city else None,
        label=" ".join(tokens),
    )


def _words(tokens) -> list[str]:
    """Leading alphabetic tokens, e.g. ['SLAVONSKI', 'BROD', '022'] -> ['SLAVONSKI', 'BROD']."""
    words = []
    for token in tokens:
        if not token.replace(".", "").isalpha():
            break
        words.append(token)
    return words
