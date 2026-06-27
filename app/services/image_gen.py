"""OpenAI image generation for studio product photos."""

from __future__ import annotations

import base64
import io
import os
from pathlib import Path

from openai import OpenAI
from PIL import Image

from app.config import (
    category_supports_styled_image,
    pick_styled_plant,
    studio_image_prompt_for,
    styled_image_prompt_for,
)
from app.db import resolve_project_path
from app.services.openai_auth import resolve_openai_api_key

GENERATED_DIR = resolve_project_path(os.getenv("GENERATED_DIR", "data/generated"))
IMAGE_MODEL = os.getenv("OPENAI_IMAGE_MODEL", "gpt-image-1")
IMAGE_QUALITY = os.getenv("OPENAI_IMAGE_QUALITY", "high")


def is_configured(*, api_key: str | None = None) -> bool:
    return resolve_openai_api_key(form_key=api_key) is not None


def _client(api_key: str | None = None) -> OpenAI:
    key = resolve_openai_api_key(form_key=api_key)
    if not key:
        raise RuntimeError(
            "OpenAI API key is missing. Paste your key on the New Item form or set OPENAI_API_KEY in .env."
        )
    return OpenAI(api_key=key)


def _is_gpt_image_model(model: str) -> bool:
    return model.startswith("gpt-image") or model.startswith("chatgpt-image")


def _prepare_edit_image(original_path: Path) -> io.BytesIO:
    """Convert upload to PNG bytes suitable for the Images edit API."""
    with Image.open(original_path) as img:
        img = img.convert("RGBA")
        max_size = 1024
        if max(img.size) > max_size:
            img.thumbnail((max_size, max_size), Image.Resampling.LANCZOS)

        png_buffer = io.BytesIO()
        img.save(png_buffer, format="PNG")
        png_buffer.seek(0)
        png_buffer.name = "product.png"
        return png_buffer


def _call_images_edit(client: OpenAI, *, png_buffer: io.BytesIO, prompt: str, model: str):
    """Call images.edit with parameters appropriate for the model."""
    if _is_gpt_image_model(model):
        return client.images.edit(
            model=model,
            image=png_buffer,
            prompt=prompt,
            size="1024x1024",
            quality=IMAGE_QUALITY,
            background="opaque",
        )

    return client.images.edit(
        model="dall-e-2",
        image=png_buffer,
        prompt=prompt[:1000],
        size="1024x1024",
        response_format="b64_json",
    )


def _generate_edited_image(
    original_path: Path,
    output_filename: str,
    prompt: str,
    *,
    api_key: str | None = None,
) -> Path:
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    output_path = GENERATED_DIR / output_filename
    model = IMAGE_MODEL

    client = _client(api_key)
    png_buffer = _prepare_edit_image(original_path)

    try:
        response = _call_images_edit(client, png_buffer=png_buffer, prompt=prompt, model=model)
    except TypeError as exc:
        if "quality" not in str(exc) and "background" not in str(exc):
            raise
        png_buffer.seek(0)
        response = client.images.edit(
            model=model if not _is_gpt_image_model(model) else "dall-e-2",
            image=png_buffer,
            prompt=prompt[:1000],
            size="1024x1024",
            response_format="b64_json",
        )

    image_b64 = response.data[0].b64_json
    if not image_b64:
        raise RuntimeError("Image generation returned no data")

    output_path.write_bytes(base64.b64decode(image_b64))
    return output_path


def generate_studio_image(
    original_path: Path,
    output_filename: str,
    *,
    category: str,
    item_name: str | None = None,
    api_key: str | None = None,
) -> Path:
    """Generate a category-aware studio version of a product photo."""
    prompt = studio_image_prompt_for(category, item_name=item_name)
    return _generate_edited_image(
        original_path,
        output_filename,
        prompt,
        api_key=api_key,
    )


def generate_styled_image(
    original_path: Path,
    output_filename: str,
    *,
    category: str,
    plant_choice: str | None = None,
    exclude_plant: str | None = None,
    item_name: str | None = None,
    api_key: str | None = None,
) -> tuple[Path, str]:
    """Generate a white-background lifestyle shot with a plant or flowers in the vessel."""
    if not category_supports_styled_image(category):
        raise ValueError(f"Category does not support styled images: {category}")

    choice = plant_choice or pick_styled_plant(category, exclude=exclude_plant)
    prompt = styled_image_prompt_for(category, plant_choice=choice, item_name=item_name)
    path = _generate_edited_image(
        original_path,
        output_filename,
        prompt,
        api_key=api_key,
    )
    return path, choice
