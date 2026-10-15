"""Turning one downloaded price list (CSV or XML bytes) into rows of the common schema."""

from __future__ import annotations

import csv
import io
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field

from .columns import HeaderMap

Row = dict[str, str | None]


@dataclass
class Parsed:
    rows: list[Row] = field(default_factory=list)
    unknown_columns: list[str] = field(default_factory=list)
    missing_columns: list[str] = field(default_factory=list)
    skipped_rows: int = 0  # rows without a product id or any price

    @property
    def usable(self) -> bool:
        return not self.missing_columns


def decode(data: bytes) -> str:
    """Chains publish UTF-8 (with or without BOM) or Windows-1250; try them in that order."""
    for encoding in ("utf-8-sig", "cp1250"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    return data.decode("utf-8", errors="replace")


def sniff_delimiter(header_line: str) -> str:
    counts = {d: header_line.count(d) for d in (";", "\t", ",", "|")}
    return max(counts, key=lambda d: counts[d]) if any(counts.values()) else ","


def parse_csv(data: bytes) -> Parsed:
    text = decode(data)
    lines = text.splitlines()
    if not lines:
        return Parsed(missing_columns=["(empty file)"])
    reader = csv.reader(io.StringIO(text), delimiter=sniff_delimiter(lines[0]))
    header_map = HeaderMap(next(reader, []))
    return _collect(header_map, reader)


def parse_xml(data: bytes) -> Parsed:
    """XML price lists have one element per product, with a child element per field.

    The product element is found by shape rather than name: the elements whose
    children are mostly leaf fields that map to the schema.
    """
    root = ET.fromstring(data)
    products = [el for el in root.iter() if len(el) >= 3 and all(len(child) == 0 for child in el)]
    if not products:
        return Parsed(missing_columns=["(no product elements)"])
    tags = list(dict.fromkeys(_local(child.tag) for el in products[:50] for child in el))
    header_map = HeaderMap(tags)

    def values(el: ET.Element) -> list[str]:
        fields = {_local(child.tag): child.text or "" for child in el}
        return [fields.get(tag, "") for tag in tags]

    return _collect(header_map, (values(el) for el in products))


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _collect(header_map: HeaderMap, records) -> Parsed:
    parsed = Parsed(unknown_columns=header_map.unknown, missing_columns=header_map.missing)
    if not parsed.usable:
        return parsed
    for values in records:
        if not any(v.strip() for v in values):
            continue
        row = header_map.row(values)
        if not row["product_id"] or not (row["price"] or row["special_price"]):
            parsed.skipped_rows += 1
            continue
        parsed.rows.append(row)
    return parsed


def parse(filename: str, data: bytes) -> Parsed:
    if filename.lower().endswith(".xml") or data.lstrip()[:5] == b"<?xml":
        return parse_xml(data)
    return parse_csv(data)
