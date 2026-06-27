"""Resolve OpenAI API keys from request, form, or environment."""

from __future__ import annotations

import os


def _is_placeholder(key: str) -> bool:
    lowered = key.strip().lower()
    return lowered in {"", "sk-your-key-here", "sk-your-key"} or lowered.startswith("sk-your-")


def resolve_openai_api_key(
    *,
    header_key: str | None = None,
    form_key: str | None = None,
) -> str | None:
    for candidate in (form_key, header_key, os.getenv("OPENAI_API_KEY")):
        if candidate is None:
            continue
        cleaned = candidate.strip()
        if cleaned and not _is_placeholder(cleaned):
            return cleaned
    return None


def is_openai_configured(
    *,
    header_key: str | None = None,
    form_key: str | None = None,
) -> bool:
    return resolve_openai_api_key(header_key=header_key, form_key=form_key) is not None
