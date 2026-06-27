"""Square catalog CSV export."""

from __future__ import annotations

import csv
import io
from typing import Any

from app.config import square_category_for
from app.services.production import price_for_combo
from app.services.variations import (
    sku_for_variation,
    variation_combos,
    variation_name,
)

# Square item library import columns (blank template order).
# Token left empty for new items. Modifiers map to Option Name/Value columns.
SQUARE_COLUMNS = [
    "Token",
    "Item Name",
    "Variation Name",
    "SKU",
    "Description",
    "Reporting Category",
    "Category",
    "Price",
    "Option Name 1",
    "Option Value 1",
    "Option Name 2",
    "Option Value 2",
    "Option Name 3",
    "Option Value 3",
]


def _format_price(price: float | None) -> str:
    if price is None:
        return ""
    return f"{price:.2f}"


def _format_tags(tags: list[str]) -> str:
    return ", ".join(tags) if tags else ""


def _category_name(category_id: str) -> str:
    return square_category_for(category_id)


def item_to_rows(item: dict[str, Any]) -> list[dict[str, str]]:
    """Convert one item into one or more Square CSV rows (variations)."""
    item_name = item.get("shop_title") or item.get("etsy_title") or item.get("item_name") or "Untitled"
    description = item.get("description") or ""
    tags = item.get("tags") or []
    if tags:
        description = f"{description}\n\nTags: {_format_tags(tags)}".strip()

    category = _category_name(item.get("category", ""))
    base_sku = item.get("sku") or ""
    combos = variation_combos(item.get("modifiers") or [])

    rows: list[dict[str, str]] = []
    for index, combo in enumerate(combos):
        row = {col: "" for col in SQUARE_COLUMNS}
        row["Item Name"] = item_name if index == 0 else item_name
        row["Variation Name"] = variation_name(combo)
        row["SKU"] = sku_for_variation(base_sku, combo, index)
        row["Description"] = description if index == 0 else ""
        row["Reporting Category"] = category
        row["Category"] = category
        row["Price"] = _format_price(price_for_combo(item, combo))

        for opt_index, (name, value) in enumerate(combo[:3]):
            row[f"Option Name {opt_index + 1}"] = name
            row[f"Option Value {opt_index + 1}"] = value

        rows.append(row)

    return rows


def export_items_to_csv(items: list[dict[str, Any]]) -> str:
    """Generate Square-compatible CSV string for the given items."""
    buffer = io.StringIO()
    writer = csv.DictWriter(buffer, fieldnames=SQUARE_COLUMNS, lineterminator="\n")
    writer.writeheader()

    for item in items:
        for row in item_to_rows(item):
            writer.writerow(row)

    return buffer.getvalue()
