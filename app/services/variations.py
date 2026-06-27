"""Shared variation combo logic for Square export and production tracking."""

from __future__ import annotations

import itertools
from typing import Any


def enabled_modifiers(modifiers: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [m for m in modifiers if m.get("enabled") and str(m.get("value", "")).strip()]


def parse_values(value: str) -> list[str]:
    parts = [v.strip() for v in value.split(",") if v.strip()]
    return parts or [value.strip()]


def variation_combos(modifiers: list[dict[str, Any]]) -> list[list[tuple[str, str]]]:
    enabled = enabled_modifiers(modifiers)
    if not enabled:
        return [[]]

    option_lists: list[list[tuple[str, str]]] = []
    for mod in enabled[:3]:
        values = parse_values(str(mod["value"]))
        option_lists.append([(mod["label"], v) for v in values])

    return [list(combo) for combo in itertools.product(*option_lists)]


def variation_name(combo: list[tuple[str, str]]) -> str:
    if not combo:
        return "Regular"
    return " / ".join(value for _, value in combo)


def variation_key(combo: list[tuple[str, str]]) -> str:
    if not combo:
        return "regular"
    return "|".join(f"{label}:{value}" for label, value in combo)


def sku_for_variation(base_sku: str | None, combo: list[tuple[str, str]], index: int) -> str:
    if not base_sku:
        return ""
    if not combo:
        return base_sku
    suffix = "-".join(v.replace(" ", "")[:8] for _, v in combo)
    return f"{base_sku}-{suffix}" if suffix else f"{base_sku}-{index + 1}"
