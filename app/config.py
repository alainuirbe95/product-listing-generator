"""Category, brand, and Square example configuration."""

from __future__ import annotations

import json
import secrets
from functools import lru_cache
from pathlib import Path
from typing import Any

CONFIG_DIR = Path(__file__).resolve().parent.parent / "config"
CATEGORIES_PATH = CONFIG_DIR / "categories.json"
BRAND_PATH = CONFIG_DIR / "brand.json"
EXAMPLES_PATH = CONFIG_DIR / "square_examples.json"
OPTIONS_PATH = CONFIG_DIR / "options.json"
STYLED_PLANTS_PATH = CONFIG_DIR / "styled-plants.json"

STYLED_IMAGE_CATEGORIES = frozenset({"pot", "vase"})


@lru_cache
def load_categories() -> list[dict[str, Any]]:
    with CATEGORIES_PATH.open(encoding="utf-8") as f:
        data = json.load(f)
    return data["categories"]


@lru_cache
def load_options() -> dict[str, Any]:
    if not OPTIONS_PATH.exists():
        return {}
    with OPTIONS_PATH.open(encoding="utf-8") as f:
        return json.load(f)


@lru_cache
def load_brand() -> dict[str, Any]:
    if not BRAND_PATH.exists():
        return {}
    with BRAND_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def load_square_examples() -> dict[str, Any]:
    if not EXAMPLES_PATH.exists():
        return {"imported_at": None, "source_file": None, "items": []}
    with EXAMPLES_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def get_category(category_id: str) -> dict[str, Any] | None:
    for cat in load_categories():
        if cat["id"] == category_id:
            return cat
    return None


def square_category_for(category_id: str) -> str:
    cat = get_category(category_id)
    if cat and cat.get("squareCategory"):
        return cat["squareCategory"]
    return "Home"


def default_price_for_category(category_id: str) -> float | None:
    cat = get_category(category_id)
    if cat and cat.get("defaultPrice") is not None:
        return float(cat["defaultPrice"])
    return None


def _resolve_option_value(mod: dict[str, Any]) -> str:
    option_set = mod.get("optionSet")
    if not option_set:
        return mod.get("defaultValue", "")

    options = load_options()
    values = options.get(option_set)
    if isinstance(values, list):
        return ", ".join(values)
    return mod.get("defaultValue", "")


def default_modifiers_for_category(category_id: str) -> list[dict[str, Any]]:
    category = get_category(category_id)
    if not category:
        return []
    return [
        {
            "key": mod["key"],
            "label": mod["label"],
            "value": _resolve_option_value(mod),
            "enabled": mod.get("enabled", False),
        }
        for mod in category.get("defaultModifiers", [])
    ]


def example_listings_for_category(category_id: str, limit: int = 3) -> list[dict[str, Any]]:
    """Return Square-imported or website examples matching a category."""
    data = load_square_examples()
    items = data.get("items") or []
    matched = [i for i in items if i.get("category_id") == category_id]
    if not matched:
        matched = items
    return matched[:limit]


STUDIO_IMAGE_BASE = (
    "Create a hyperrealistic studio product photograph on a pure white background (#FFFFFF). "
    "Professional e-commerce lighting, sharp focus, no shadows on the background, centered "
    "composition, subtle 3D-print layer texture. Preserve the exact shape, color, and design "
    "from the input image. Do not add text, logos, watermarks, or props unless they appear "
    "in the original photo."
)


def studio_image_prompt_for(category_id: str, *, item_name: str | None = None) -> str:
    cat = get_category(category_id) or {}
    specific = cat.get("studioImagePrompt", "").strip()
    if not specific:
        specific = (
            "This is a 3D printed home decor product. Photograph the exact object clearly "
            "for an e-commerce catalog."
        )
    parts = [STUDIO_IMAGE_BASE, specific]
    if item_name:
        parts.append(f"Product name for context: {item_name}")
    return " ".join(parts)


@lru_cache
def load_styled_plants() -> dict[str, list[str]]:
    if not STYLED_PLANTS_PATH.exists():
        return {"pot": [], "vase": []}
    with STYLED_PLANTS_PATH.open(encoding="utf-8") as f:
        return json.load(f)


def category_supports_styled_image(category_id: str) -> bool:
    return category_id in STYLED_IMAGE_CATEGORIES


def pick_styled_plant(category_id: str, *, exclude: str | None = None) -> str:
    pools = load_styled_plants()
    choices = list(pools.get(category_id) or [])
    if not choices:
        raise RuntimeError(f"No styled plant options configured for category: {category_id}")

    if exclude and len(choices) > 1:
        filtered = [choice for choice in choices if choice.casefold() != exclude.casefold()]
        if filtered:
            choices = filtered

    return secrets.choice(choices)


def styled_image_prompt_for(
    category_id: str,
    *,
    plant_choice: str,
    item_name: str | None = None,
) -> str:
    if category_id == "pot":
        specific = (
            f"Add a healthy, cute {plant_choice} planted inside the pot with visible potting soil. "
            f"The plant must be {plant_choice} — do not substitute a different variety. "
            "The plant should look proportional, realistic, and catalog-ready. "
            "Preserve the exact pot shape, color, and design from the input image. "
            "Do not add dried flowers, cut stems without soil, or vase-style arrangements."
        )
    else:
        specific = (
            f"Add a cute arrangement of {plant_choice} inside the vase. "
            f"The arrangement must be {plant_choice} — do not substitute a different variety. "
            "Show stems or flowers emerging naturally from the vase opening. "
            "No soil, no rooted potted plant. "
            "Preserve the exact vase shape, color, and design from the input image."
        )
    parts = [STUDIO_IMAGE_BASE, specific]
    if item_name:
        parts.append(f"Product name for context: {item_name}")
    return " ".join(parts)


def listing_prompt_for(category_id: str) -> str:
    cat = get_category(category_id) or {}
    return cat.get("listingPrompt", "").strip()


def catalog_listing_title(item_name: str, category_id: str) -> str:
    """Short catalog title, e.g. \"Nori\" Pot or \"Lunor\" Vase."""
    name = item_name.strip()
    if not name:
        return "Untitled"
    cat = get_category(category_id) or {}
    suffix = (cat.get("titleSuffix") or "").strip()
    if suffix:
        core = name.strip().strip('"').strip()
        return f'"{core}" {suffix}'
    return name


def category_prompts_for(category_id: str) -> dict[str, str]:
    cat = get_category(category_id) or {}
    return {
        "studioImagePrompt": cat.get("studioImagePrompt", "").strip(),
        "listingPrompt": cat.get("listingPrompt", "").strip(),
    }
