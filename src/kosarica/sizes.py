"""Package size from a product name.

Names carry the size, written every way a till printer allows: "1240 g", "0,75L",
"VRHNJE 3x200 g", "kvasac 5x7g", "Brašno 5kg_OC", "mango1L TETRA", "Somat 75/1".
The size is returned in a base unit so packages can be sorted and priced per unit:
kilograms, litres, or pieces.
"""

from __future__ import annotations

import re

UNITS = {"kg": ("kg", 1.0), "g": ("kg", 0.001), "l": ("l", 1.0), "dl": ("l", 0.1), "cl": ("l", 0.01), "ml": ("l", 0.001)}

_NUMBER = r"(\d+(?:[.,]\d+)?)"
_UNIT = r"(kg|g|ml|cl|dl|l)(?![a-z])"  # "5kg_OC" counts, "10 lampica" does not
MULTIPACK = re.compile(rf"(\d+)\s*[x×]\s*{_NUMBER}\s*{_UNIT}")
SINGLE = re.compile(rf"{_NUMBER}\s*{_UNIT}")
PIECES = re.compile(r"(?<![\d.,])(\d+)\s*/\s*1(?!\d)|(\d+)\s*(?:kom|komada)(?![a-z])")


# litres on these are capacity, not contents: "VREĆE ZA SMEĆE 60L 20/1" is a pack of 20
CAPACITY = re.compile(r"vre[cć]")


def package_size(name: str) -> tuple[float, str] | None:
    """(amount, unit) with unit "kg", "l" or "kom", or None when the name doesn't say."""
    text = name.lower()
    if CAPACITY.search(text) and (m := PIECES.search(text)):
        return float(m.group(1) or m.group(2)), "kom"
    if m := MULTIPACK.search(text):
        count, amount, unit = int(m.group(1)), _number(m.group(2)), m.group(3)
        base, factor = UNITS[unit]
        return _round(count * amount * factor), base
    if m := SINGLE.search(text):
        amount, unit = _number(m.group(1)), m.group(2)
        base, factor = UNITS[unit]
        if amount > 0:
            return _round(amount * factor), base
    if m := PIECES.search(text):
        return float(m.group(1) or m.group(2)), "kom"
    return None


def _number(text: str) -> float:
    return float(text.replace(",", "."))


def _round(value: float) -> float:
    return round(value, 4)
