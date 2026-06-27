"""Production cost settings and per-variation cost analysis."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from app.db import BASE_DIR
from app.services.variations import variation_combos, variation_key, variation_name

PRODUCTION_CONFIG_PATH = BASE_DIR / "config" / "production.json"

DEFAULT_GROUP_LABELS: dict[str, str] = {
    "pot": "Opening Diameter",
    "vase": "Height",
}

DEFAULT_SETTINGS: dict[str, float] = {
    "filamentPricePerKg": 25.0,
    "laborRatePerHour": 0.0,
    "electricityRatePerHour": 0.0,
}


def load_production_settings() -> dict[str, float]:
    if not PRODUCTION_CONFIG_PATH.exists():
        return dict(DEFAULT_SETTINGS)
    data = json.loads(PRODUCTION_CONFIG_PATH.read_text(encoding="utf-8"))
    return {**DEFAULT_SETTINGS, **{k: float(v) for k, v in data.items() if k in DEFAULT_SETTINGS}}


def save_production_settings(settings: dict[str, Any]) -> dict[str, float]:
    merged = load_production_settings()
    for key in DEFAULT_SETTINGS:
        if key in settings and settings[key] is not None:
            merged[key] = float(settings[key])
    PRODUCTION_CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    PRODUCTION_CONFIG_PATH.write_text(json.dumps(merged, indent=2) + "\n", encoding="utf-8")
    return merged


def default_group_label(category: str) -> str | None:
    return DEFAULT_GROUP_LABELS.get(category)


def production_combos(
    modifiers: list[dict[str, Any]],
    group_by_label: str | None = None,
) -> list[list[tuple[str, str]]]:
    combos = variation_combos(modifiers)
    if not group_by_label:
        return combos

    seen: set[str] = set()
    grouped: list[list[tuple[str, str]]] = []
    for combo in combos:
        part = next(((label, value) for label, value in combo if label == group_by_label), None)
        if not part:
            continue
        if part[1] in seen:
            continue
        seen.add(part[1])
        grouped.append([part])
    return grouped or combos


def _spec_for_key(production: dict[str, Any], key: str) -> dict[str, Any]:
    raw = production.get(key) or {}
    return {
        "print_time_hrs": _optional_float(raw.get("print_time_hrs")),
        "filament_grams": _optional_float(raw.get("filament_grams")),
        "infill_method": str(raw.get("infill_method") or "").strip(),
        "price": _optional_float(raw.get("price")),
    }


def list_price_for_spec(spec: dict[str, Any], fallback: float | None) -> float | None:
    price = spec.get("price")
    return price if price is not None else fallback


def price_for_combo(item: dict[str, Any], combo: list[tuple[str, str]]) -> float | None:
    """Resolve list price for a variation combo from production data or item base price."""
    production = item.get("production") or {}
    key = variation_key(combo)
    spec = production.get(key) or {}
    price = list_price_for_spec(spec, None)
    if price is not None:
        return price

    group_label = default_group_label(item.get("category", ""))
    if group_label:
        part = next(((label, value) for label, value in combo if label == group_label), None)
        if part:
            size_key = variation_key([part])
            size_spec = production.get(size_key) or {}
            price = list_price_for_spec(size_spec, None)
            if price is not None:
                return price

    return item.get("price")


def _optional_float(value: Any) -> float | None:
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def compute_costs(
    spec: dict[str, Any],
    settings: dict[str, float],
    list_price: float | None,
) -> dict[str, float | None]:
    filament_grams = spec.get("filament_grams")
    print_time_hrs = spec.get("print_time_hrs")

    material_cost = None
    if filament_grams is not None:
        material_cost = round((filament_grams / 1000.0) * settings["filamentPricePerKg"], 2)

    labor_cost = None
    electricity_cost = None
    if print_time_hrs is not None:
        labor_rate = settings.get("laborRatePerHour", 0) or 0
        electricity_rate = settings.get("electricityRatePerHour", 0) or 0
        if labor_rate > 0:
            labor_cost = round(print_time_hrs * labor_rate, 2)
        if electricity_rate > 0:
            electricity_cost = round(print_time_hrs * electricity_rate, 2)

    material = material_cost or 0.0
    labor = labor_cost or 0.0
    electricity = electricity_cost or 0.0
    has_material = filament_grams is not None
    has_time = print_time_hrs is not None
    if has_material or (has_time and (labor_cost is not None or electricity_cost is not None)):
        total_cost = round(material + labor + electricity, 2)
    else:
        total_cost = None

    margin = None
    margin_pct = None
    if total_cost is not None and list_price is not None:
        margin = round(list_price - total_cost, 2)
        if list_price > 0:
            margin_pct = round((margin / list_price) * 100, 1)

    return {
        "material_cost": material_cost,
        "labor_cost": labor_cost,
        "electricity_cost": electricity_cost,
        "total_cost": total_cost,
        "margin": margin,
        "margin_pct": margin_pct,
    }


def item_variation_rows(
    item: dict[str, Any],
    settings: dict[str, float] | None = None,
    *,
    group_by_label: str | None = None,
) -> list[dict[str, Any]]:
    settings = settings or load_production_settings()
    production = item.get("production") or {}
    if group_by_label is None:
        group_by_label = default_group_label(item.get("category", ""))
    combos = production_combos(item.get("modifiers") or [], group_by_label)
    rows: list[dict[str, Any]] = []

    for index, combo in enumerate(combos):
        key = variation_key(combo)
        spec = _spec_for_key(production, key)
        list_price = list_price_for_spec(spec, item.get("price"))
        costs = compute_costs(spec, settings, list_price)
        rows.append(
            {
                "variation_key": key,
                "variation_name": variation_name(combo),
                "combo": [{"label": label, "value": value} for label, value in combo],
                "print_time_hrs": spec["print_time_hrs"],
                "filament_grams": spec["filament_grams"],
                "infill_method": spec["infill_method"],
                "list_price": list_price,
                "tracked": any(
                    spec[k] is not None and spec[k] != ""
                    for k in ("print_time_hrs", "filament_grams", "infill_method")
                ),
                **costs,
            }
        )

    return rows


def build_analyzer_rows(
    items: list[dict[str, Any]],
    settings: dict[str, float] | None = None,
    *,
    group_by_label: str | None = "auto",
) -> list[dict[str, Any]]:
    settings = settings or load_production_settings()
    rows: list[dict[str, Any]] = []

    for item in items:
        item_label = item.get("shop_title") or item.get("item_name") or item.get("etsy_title") or "Untitled"
        group_label = default_group_label(item.get("category", "")) if group_by_label == "auto" else group_by_label
        for row in item_variation_rows(item, settings, group_by_label=group_label):
            rows.append(
                {
                    "item_id": item["id"],
                    "item_name": item.get("item_name"),
                    "item_label": item_label,
                    "category": item.get("category"),
                    "sku": item.get("sku"),
                    **row,
                }
            )

    return rows
