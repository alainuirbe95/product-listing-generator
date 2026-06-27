"""OpenAI text generation for Etsy-style listings."""

from __future__ import annotations

import json
import os
from typing import Any

from openai import OpenAI

from app.config import example_listings_for_category, get_category, listing_prompt_for, load_brand, square_category_for

from app.services.openai_auth import resolve_openai_api_key

TEXT_MODEL = os.getenv("OPENAI_TEXT_MODEL", "gpt-4o-mini")


def _client(api_key: str | None = None) -> OpenAI:
    key = resolve_openai_api_key(form_key=api_key)
    if not key:
        raise RuntimeError(
            "OpenAI API key is missing. Paste your key on the New Item form or set OPENAI_API_KEY in .env."
        )
    return OpenAI(api_key=key)


def _format_modifiers(modifiers: list[dict[str, Any]]) -> str:
    enabled = [m for m in modifiers if m.get("enabled") and m.get("value")]
    if not enabled:
        return "None specified"
    return ", ".join(f"{m['label']}: {m['value']}" for m in enabled)


def _format_examples(examples: list[dict[str, Any]]) -> str:
    if not examples:
        return ""

    blocks: list[str] = []
    for ex in examples:
        blocks.append(
            "\n".join(
                [
                    f"Catalog name: {ex.get('item_name', '')}",
                    f"Square category: {ex.get('square_category', '')}",
                    f"Price: ${ex.get('price', '')}",
                    f"Description:\n{ex.get('description', '')[:900]}",
                ]
            )
        )
    return "\n\n---\n\n".join(blocks)


def _naming_rule(category_id: str, brand: dict[str, Any]) -> str:
    rules = brand.get("namingRules") or {}
    return rules.get(category_id, "Use a clear, descriptive product title matching the shop's style.")


def _etsy_title_keywords(brand: dict[str, Any]) -> str:
    keywords = brand.get("titleKeywords") or []
    if not keywords:
        return ""
    return ", ".join(keywords)


def generate_listing_copy(
    *,
    item_name: str,
    category: str,
    modifiers: list[dict[str, Any]],
    api_key: str | None = None,
) -> dict[str, Any]:
    """Return etsy_title (Etsy SEO), description, and tags."""
    client = _client(api_key)
    brand = load_brand()
    cat = get_category(category) or {}
    modifier_text = _format_modifiers(modifiers)
    examples = example_listings_for_category(category)
    example_text = _format_examples(examples)
    square_cat = square_category_for(category)
    naming = _naming_rule(category, brand)
    category_guidance = listing_prompt_for(category)
    etsy_guidance = brand.get("etsyTitleGuidance", "").strip()
    keyword_hints = _etsy_title_keywords(brand)

    bullets = brand.get("descriptionBullets") or []
    bullet_text = "\n".join(f"- {b}" for b in bullets)

    system_prompt = (
        f"You write product listings for {brand.get('businessName', 'Retro Minds Collective')}, "
        f"a shop selling {brand.get('productType', '3D printed plant accessories')}. "
        "Listings are used on Etsy, TikTok Shop, Meta Shop, and Square. "
        "Return valid JSON only with keys: etsy_title, description, tags.\n\n"
        "Rules:\n"
        f"- Short catalog listing title (handled separately): {naming}\n"
        f"- Category-specific guidance: {category_guidance or 'Write clear catalog copy for this product type.'}\n"
        "- etsy_title: Etsy shop listing title — keyword-rich SEO (max 140 chars) "
        "for what appears on your Etsy shop. Pack in searchable keywords while staying readable.\n"
        f"  - Etsy title guidance: {etsy_guidance or 'Front-load product name and keywords; include size when known.'}\n"
        f"  - Useful keyword themes to weave in naturally: {keyword_hints or '3d printed, planter, indoor plant'}\n"
        "  - Include sizes, opening diameters, or dimensions from attributes when provided.\n"
        "  - Do NOT copy the short catalog names from examples verbatim — those are Square names, not Etsy titles.\n"
        "  - Good pot example: \"Nori\" Plant Pot 3D Printed Planter Modern Indoor Succulent Pot with Drainage 4.5 5.5 inch\n"
        "  - Good trellis example: LEGO Inspired Plant Trellis 3D Printed Indoor Climbing Plant Support 12x6 Modern Decor\n"
        "- description: length and structure should match examples for this category\n"
        "- tags: exactly 13 lowercase tags, max 20 chars each, no hashtags\n"
        "- Do not invent dimensions unless provided in attributes\n\n"
        f"Brand tone: {brand.get('tone', '')}\n"
        f"Default bullets when relevant:\n{bullet_text}\n"
        f"Care: {brand.get('careNotes', '')}"
    )

    user_parts = [
        f"Working design name: {item_name}",
        f"Product type: {cat.get('name', category)} (Square category: {square_cat})",
        f"Selected attributes / variations: {modifier_text}",
        "",
        "Generate listing copy for this new 3D printed product.",
        "The etsy_title is only for Etsy — a keyword-rich shop listing title, not the short catalog name.",
    ]

    if example_text:
        user_parts.extend(
            [
                "",
                "Use these existing listings for voice and description style only — catalog names are short;",
                "your etsy_title should be a longer, keyword-rich Etsy SEO title:",
                example_text,
            ]
        )

    response = client.chat.completions.create(
        model=TEXT_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": "\n".join(user_parts)},
        ],
        response_format={"type": "json_object"},
        temperature=0.7,
    )

    content = response.choices[0].message.content or "{}"
    data = json.loads(content)

    tags = data.get("tags", [])
    if isinstance(tags, str):
        tags = [t.strip() for t in tags.split(",") if t.strip()]

    etsy_title = (data.get("etsy_title") or item_name)[:140]

    return {
        "etsy_title": etsy_title,
        "description": data.get("description") or "",
        "tags": [str(t).lower()[:20] for t in tags[:13]],
    }
