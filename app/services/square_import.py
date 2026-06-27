"""Parse Square item library CSV exports into listing examples."""

from __future__ import annotations

import csv
import io
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from app.db import BASE_DIR

EXAMPLES_PATH = BASE_DIR / "config" / "square_examples.json"

OPTION_COLUMNS = [
    ("Option Name 1", "Option Value 1"),
    ("Option Name 2", "Option Value 2"),
    ("Option Name 3", "Option Value 3"),
]


def _normalize_header(header: str) -> str:
    return header.strip().lstrip("\ufeff")


def _parse_price(value: str) -> float | None:
    cleaned = value.strip().replace("$", "").replace(",", "")
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _infer_category_id(item_name: str, square_category: str) -> str:
    name = item_name.lower()
    cat = square_category.lower()

    if "trellis" in name or cat == "trellises":
        return "trellis"
    if "wall planter" in name or "wall mount" in name:
        return "wall_planter"
    if "vase" in name or cat == "vases":
        return "vase"
    if "watering" in name or cat == "watering cans":
        return "watering_can"
    if "lamp" in name or cat == "table lamps":
        return "table_lamp"
    if "tray" in name or "container" in cat:
        return "containers_trays"
    if "pot" in name or "planter" in name or cat == "pots":
        return "pot"
    return "home_decor"


def _extract_modifiers(rows: list[dict[str, str]]) -> list[dict[str, Any]]:
    """Build modifier list from variation rows."""
    modifiers: dict[str, set[str]] = {}
    for row in rows:
        for name_col, value_col in OPTION_COLUMNS:
            name = row.get(name_col, "").strip()
            value = row.get(value_col, "").strip()
            if name and value:
                modifiers.setdefault(name, set()).add(value)

    return [
        {
            "key": re.sub(r"[^a-z0-9]+", "_", label.lower()).strip("_"),
            "label": label,
            "value": ", ".join(sorted(values)),
            "enabled": True,
        }
        for label, values in modifiers.items()
    ]


def parse_square_csv(content: str) -> list[dict[str, Any]]:
    """Parse a Square export CSV into grouped item records."""
    reader = csv.DictReader(io.StringIO(content))
    if not reader.fieldnames:
        return []

    # Normalize headers (Square exports may include BOM or extra whitespace)
    field_map = {_normalize_header(h): h for h in reader.fieldnames}

    def get(row: dict[str, str], key: str) -> str:
        original = field_map.get(key, key)
        return (row.get(original) or "").strip()

    grouped: dict[str, list[dict[str, str]]] = {}
    for raw_row in reader:
        row = {_normalize_header(k): v for k, v in raw_row.items()}
        item_name = get(row, "Item Name")
        if not item_name:
            continue
        grouped.setdefault(item_name, []).append(row)

    items: list[dict[str, Any]] = []
    for item_name, rows in grouped.items():
        first = rows[0]
        square_category = get(first, "Category") or get(first, "Reporting Category")
        price = _parse_price(get(first, "Price"))
        if price is None:
            for row in rows:
                price = _parse_price(get(row, "Price"))
                if price is not None:
                    break

        variations = [
            {
                "variation_name": get(row, "Variation Name") or "Regular",
                "sku": get(row, "SKU"),
                "price": _parse_price(get(row, "Price")),
            }
            for row in rows
        ]

        items.append(
            {
                "item_name": item_name,
                "category_id": _infer_category_id(item_name, square_category),
                "square_category": square_category,
                "description": get(first, "Description"),
                "sku": get(first, "SKU"),
                "price": price,
                "modifiers": _extract_modifiers(rows),
                "variations": variations,
            }
        )

    return items


def load_examples() -> dict[str, Any]:
    if not EXAMPLES_PATH.exists():
        return {"imported_at": None, "source_file": None, "items": []}
    with EXAMPLES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def save_examples(items: list[dict[str, Any]], source_file: str | None = None) -> dict[str, Any]:
    payload = {
        "imported_at": datetime.now(timezone.utc).isoformat(),
        "source_file": source_file,
        "items": items,
    }
    EXAMPLES_PATH.parent.mkdir(parents=True, exist_ok=True)
    with EXAMPLES_PATH.open("w", encoding="utf-8") as f:
        json.dump(payload, f, indent=2)
    return payload


def import_square_csv(content: str, source_file: str | None = None) -> dict[str, Any]:
    items = parse_square_csv(content)
    return save_examples(items, source_file)
