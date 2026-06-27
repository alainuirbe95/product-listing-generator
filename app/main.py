"""FastAPI application and API routes."""

from __future__ import annotations

import json
import os
import shutil
import uuid
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse, HTMLResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import (
    category_prompts_for,
    category_supports_styled_image,
    catalog_listing_title,
    default_modifiers_for_category,
    default_price_for_category,
    get_category,
    load_brand,
    load_categories,
    load_options,
    load_square_examples,
)
from app.db import BASE_DIR, init_db, resolve_project_path, store_relative_path
from app.repository import (
    add_image,
    create_item,
    delete_image,
    delete_items,
    get_image,
    get_item_with_images,
    get_items_by_ids,
    list_items,
    update_item,
)
from app.repository_filament import (
    add_filament_spools,
    adjust_filament_spool,
    delete_filament_spool,
    list_filament_spools,
    update_filament_color_name,
)
from app.services.openai_auth import is_openai_configured, resolve_openai_api_key
from app.services.image_gen import generate_studio_image, generate_styled_image
from app.services.production import (
    build_analyzer_rows,
    default_group_label,
    item_variation_rows,
    load_production_settings,
    save_production_settings,
)
from app.services.square_export import export_items_to_csv
from app.services.square_import import import_square_csv
from app.services.text_gen import generate_listing_copy

load_dotenv(BASE_DIR / ".env")

UPLOAD_DIR = resolve_project_path(os.getenv("UPLOAD_DIR", "data/uploads"))
GENERATED_DIR = resolve_project_path(os.getenv("GENERATED_DIR", "data/generated"))

app = FastAPI(title="Retro Minds Listing Generator", version="1.0.0")

STATIC_DIR = BASE_DIR / "static"
TEMPLATES_DIR = BASE_DIR / "templates"


class DevNoCacheMiddleware(BaseHTTPMiddleware):
    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        path = request.url.path
        if path == "/" or path.startswith("/static/"):
            response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
            response.headers["Pragma"] = "no-cache"
        return response


app.add_middleware(DevNoCacheMiddleware)
app.mount("/static", StaticFiles(directory=str(STATIC_DIR)), name="static")


@app.on_event("startup")
def on_startup() -> None:
    UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    GENERATED_DIR.mkdir(parents=True, exist_ok=True)
    init_db()


@app.get("/", response_class=HTMLResponse)
def index() -> HTMLResponse:
    html = (TEMPLATES_DIR / "index.html").read_text(encoding="utf-8")
    return HTMLResponse(html)


@app.get("/api/health")
def health() -> dict[str, Any]:
    examples = load_square_examples()
    env_configured = is_openai_configured()
    return {
        "ok": True,
        "openai_configured": env_configured,
        "openai_env_configured": env_configured,
        "brand": load_brand().get("businessName"),
        "square_examples": len(examples.get("items") or []),
    }


def _openai_key(
    *,
    header_key: str | None = None,
    form_key: str | None = None,
) -> str:
    cleaned_form = form_key.strip() if form_key else None
    cleaned_header = header_key.strip() if header_key else None
    key = resolve_openai_api_key(header_key=cleaned_header, form_key=cleaned_form)
    if not key:
        raise HTTPException(
            status_code=503,
            detail="OpenAI API key required. Paste your key in the API Key field on the New Item form.",
        )
    return key


@app.get("/api/brand")
def brand() -> dict[str, Any]:
    return load_brand()


@app.get("/api/square/examples")
def square_examples() -> dict[str, Any]:
    return load_square_examples()


@app.post("/api/square/import")
async def square_import(file: UploadFile = File(...)) -> dict[str, Any]:
    content = (await file.read()).decode("utf-8-sig")
    result = import_square_csv(content, source_file=file.filename)
    return {
        "imported": len(result.get("items") or []),
        "imported_at": result.get("imported_at"),
        "source_file": result.get("source_file"),
    }


@app.get("/api/categories")
def categories() -> list[dict[str, Any]]:
    options = load_options()
    result: list[dict[str, Any]] = []
    for category in load_categories():
        cat = {**category, "defaultModifiers": []}
        for mod in category.get("defaultModifiers", []):
            entry = dict(mod)
            option_set = entry.get("optionSet")
            if option_set:
                entry["options"] = list(options.get(option_set, []))
            cat["defaultModifiers"].append(entry)
        result.append(cat)
    return result


@app.get("/api/categories/{category_id}/modifiers")
def category_modifiers(category_id: str) -> list[dict[str, Any]]:
    return default_modifiers_for_category(category_id)


@app.get("/api/categories/{category_id}/defaults")
def category_defaults(category_id: str) -> dict[str, Any]:
    cat = get_category(category_id)
    if not cat:
        raise HTTPException(status_code=404, detail="Category not found")
    return {
        "defaultPrice": default_price_for_category(category_id),
        "itemNamePlaceholder": cat.get("itemNamePlaceholder", ""),
        "titleSuffix": cat.get("titleSuffix", ""),
        "squareCategory": cat.get("squareCategory", ""),
        **category_prompts_for(category_id),
    }


@app.get("/api/items")
def api_list_items(
    category: str | None = None,
    status: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    return list_items(category=category, status=status, search=search)


@app.get("/api/items/{item_id}")
def api_get_item(item_id: str) -> dict[str, Any]:
    item = get_item_with_images(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return item


@app.post("/api/items/generate")
async def api_generate_item(
    request: Request,
    item_name: str = Form(...),
    category: str = Form(...),
    modifiers: str = Form("[]"),
    price: str = Form(""),
    sku: str = Form(""),
    openai_api_key: str = Form(""),
    images: list[UploadFile] = File(...),
) -> dict[str, Any]:
    if not images:
        raise HTTPException(status_code=400, detail="At least one image is required")

    header = request.headers.get("x-openai-api-key") or request.headers.get("X-OpenAI-API-Key")
    api_key = _openai_key(header_key=header, form_key=openai_api_key)

    try:
        modifier_list: list[dict[str, Any]] = json.loads(modifiers)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid modifiers JSON") from exc

    parsed_price = float(price) if price.strip() else None

    item = create_item(
        item_name=item_name.strip(),
        category=category,
        modifiers=modifier_list,
        price=parsed_price,
        sku=sku.strip() or None,
        status="generating",
    )

    item_id = item["id"]
    saved_originals: list[dict[str, Any]] = []

    try:
        for index, upload in enumerate(images):
            ext = Path(upload.filename or "photo.jpg").suffix or ".jpg"
            original_name = f"{item_id}-orig-{index}{ext}"
            original_path = UPLOAD_DIR / original_name

            with original_path.open("wb") as f:
                shutil.copyfileobj(upload.file, f)

            original_record = add_image(
                item_id=item_id,
                image_type="original",
                file_path=store_relative_path(original_path),
                sort_order=index,
            )
            saved_originals.append(original_record)

            generated_name = f"{item_id}-gen-{index}.png"
            generated_path = generate_studio_image(
                original_path,
                generated_name,
                category=category,
                item_name=item_name.strip(),
                api_key=api_key,
            )

            add_image(
                item_id=item_id,
                image_type="generated",
                file_path=store_relative_path(generated_path),
                sort_order=index,
            )

            if category_supports_styled_image(category):
                styled_name = f"{item_id}-styled-{index}.png"
                styled_path, plant_choice = generate_styled_image(
                    original_path,
                    styled_name,
                    category=category,
                    item_name=item_name.strip(),
                    api_key=api_key,
                )
                add_image(
                    item_id=item_id,
                    image_type="generated_styled",
                    file_path=store_relative_path(styled_path),
                    sort_order=index,
                    styled_subject=plant_choice,
                )

        listing = generate_listing_copy(
            item_name=item_name.strip(),
            category=category,
            modifiers=modifier_list,
            api_key=api_key,
        )

        generated_images = [
            img for img in get_item_with_images(item_id)["images"] if img["type"] == "generated"
        ]
        primary_image_id = generated_images[0]["id"] if generated_images else None

        item = update_item(
            item_id,
            etsy_title=listing["etsy_title"],
            description=listing["description"],
            tags=listing["tags"],
            shop_title=catalog_listing_title(item_name.strip(), category),
            status="ready",
            primary_image_id=primary_image_id,
        )
    except Exception as exc:
        update_item(item_id, status="draft")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    result = get_item_with_images(item_id)
    assert result is not None
    return result


@app.put("/api/items/{item_id}")
async def api_update_item(item_id: str, request: Request) -> dict[str, Any]:
    payload: dict[str, Any] = await request.json()
    existing = get_item_with_images(item_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")

    item = update_item(item_id, **payload)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    return get_item_with_images(item_id)  # type: ignore[return-value]


@app.delete("/api/items/{item_id}")
def api_delete_item(item_id: str) -> dict[str, int]:
    existing = get_item_with_images(item_id)
    if not existing:
        raise HTTPException(status_code=404, detail="Item not found")
    delete_items([item_id])
    return {"deleted": 1}


@app.post("/api/items/delete")
async def api_delete_items(request: Request) -> dict[str, int]:
    payload: dict[str, Any] = await request.json()
    item_ids = payload.get("item_ids") or []
    if not item_ids:
        raise HTTPException(status_code=400, detail="No items selected")
    deleted = delete_items(item_ids)
    if not deleted:
        raise HTTPException(status_code=404, detail="No matching items found")
    return {"deleted": deleted}


@app.post("/api/items/{item_id}/regenerate-image")
async def api_regenerate_image(
    item_id: str,
    request: Request,
    image_id: str = Form(...),
    openai_api_key: str = Form(""),
) -> dict[str, Any]:
    header = request.headers.get("x-openai-api-key") or request.headers.get("X-OpenAI-API-Key")
    api_key = _openai_key(header_key=header, form_key=openai_api_key)

    item = get_item_with_images(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    target = get_image(image_id)
    if not target or target["item_id"] != item_id:
        raise HTTPException(status_code=404, detail="Image not found")

    original = None
    for img in item["images"]:
        if img["type"] == "original" and img["sort_order"] == target["sort_order"]:
            original = img
            break

    if not original:
        raise HTTPException(status_code=400, detail="Original image not found for regeneration")

    original_path = resolve_project_path(original["file_path"])
    generated_name = f"{item_id}-gen-{uuid.uuid4().hex[:8]}.png"

    try:
        generated_path = generate_studio_image(
            original_path,
            generated_name,
            category=item["category"],
            item_name=item.get("item_name"),
            api_key=api_key,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    new_image = add_image(
        item_id=item_id,
        image_type="generated",
        file_path=store_relative_path(generated_path),
        sort_order=target["sort_order"],
    )

    update_item(item_id, primary_image_id=new_image["id"])
    result = get_item_with_images(item_id)
    assert result is not None
    return result


@app.post("/api/items/{item_id}/regenerate-styled-image")
async def api_regenerate_styled_image(
    item_id: str,
    request: Request,
    image_id: str = Form(...),
    openai_api_key: str = Form(""),
) -> dict[str, Any]:
    header = request.headers.get("x-openai-api-key") or request.headers.get("X-OpenAI-API-Key")
    api_key = _openai_key(header_key=header, form_key=openai_api_key)

    item = get_item_with_images(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not category_supports_styled_image(item["category"]):
        raise HTTPException(status_code=400, detail="Styled images are only available for pots and vases")

    target = get_image(image_id)
    if not target or target["item_id"] != item_id or target["type"] != "generated_styled":
        raise HTTPException(status_code=404, detail="Styled image not found")

    original = None
    for img in item["images"]:
        if img["type"] == "original" and img["sort_order"] == target["sort_order"]:
            original = img
            break

    if not original:
        raise HTTPException(status_code=400, detail="Original image not found for regeneration")

    original_path = resolve_project_path(original["file_path"])
    styled_name = f"{item_id}-styled-{uuid.uuid4().hex[:8]}.png"
    old_file = resolve_project_path(target["file_path"])
    was_primary = item.get("primary_image_id") == target["id"]

    try:
        styled_path, plant_choice = generate_styled_image(
            original_path,
            styled_name,
            category=item["category"],
            item_name=item.get("item_name"),
            exclude_plant=target.get("styled_subject"),
            api_key=api_key,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    delete_image(target["id"])
    if old_file.is_file():
        old_file.unlink()

    new_image = add_image(
        item_id=item_id,
        image_type="generated_styled",
        file_path=store_relative_path(styled_path),
        sort_order=target["sort_order"],
        styled_subject=plant_choice,
    )

    if was_primary:
        update_item(item_id, primary_image_id=new_image["id"])

    result = get_item_with_images(item_id)
    assert result is not None
    return result


def _source_image_for_styled(item: dict[str, Any], sort_order: int) -> dict[str, Any] | None:
    """Prefer the original upload; fall back to the studio image for legacy items."""
    for image_type in ("original", "generated"):
        for img in item["images"]:
            if img["type"] == image_type and img["sort_order"] == sort_order:
                return img
    return None


@app.post("/api/items/{item_id}/generate-styled-image")
async def api_generate_styled_image(
    item_id: str,
    request: Request,
    sort_order: int = Form(0),
    openai_api_key: str = Form(""),
) -> dict[str, Any]:
    header = request.headers.get("x-openai-api-key") or request.headers.get("X-OpenAI-API-Key")
    api_key = _openai_key(header_key=header, form_key=openai_api_key)

    item = get_item_with_images(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")

    if not category_supports_styled_image(item["category"]):
        raise HTTPException(status_code=400, detail="Styled images are only available for pots and vases")

    has_styled = any(
        img["type"] == "generated_styled" and img["sort_order"] == sort_order
        for img in item["images"]
    )
    if has_styled:
        raise HTTPException(status_code=400, detail="Styled image already exists for this photo")

    source = _source_image_for_styled(item, sort_order)
    if not source:
        raise HTTPException(status_code=400, detail="No source image found to generate from")

    source_path = resolve_project_path(source["file_path"])
    styled_name = f"{item_id}-styled-{uuid.uuid4().hex[:8]}.png"

    try:
        styled_path, plant_choice = generate_styled_image(
            source_path,
            styled_name,
            category=item["category"],
            item_name=item.get("item_name"),
            api_key=api_key,
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    add_image(
        item_id=item_id,
        image_type="generated_styled",
        file_path=store_relative_path(styled_path),
        sort_order=sort_order,
        styled_subject=plant_choice,
    )

    result = get_item_with_images(item_id)
    assert result is not None
    return result


@app.post("/api/export")
async def api_export(request: Request) -> Response:
    payload: dict[str, Any] = await request.json()
    item_ids = payload.get("item_ids") or []
    if not item_ids:
        raise HTTPException(status_code=400, detail="No items selected")

    items = get_items_by_ids(item_ids)
    if not items:
        raise HTTPException(status_code=404, detail="No matching items found")

    csv_content = export_items_to_csv(items)
    return Response(
        content=csv_content,
        media_type="text/csv",
        headers={"Content-Disposition": 'attachment; filename="square-catalog-export.csv"'},
    )


@app.get("/api/production/settings")
def api_production_settings() -> dict[str, float]:
    return load_production_settings()


@app.put("/api/production/settings")
async def api_update_production_settings(request: Request) -> dict[str, float]:
    payload: dict[str, Any] = await request.json()
    return save_production_settings(payload)


@app.get("/api/production/analyzer")
def api_production_analyzer(
    category: str | None = None,
    tracked_only: bool = False,
    search: str | None = None,
) -> dict[str, Any]:
    items = list_items(category=category, search=search)
    settings = load_production_settings()
    rows = build_analyzer_rows(items, settings)
    if tracked_only:
        rows = [row for row in rows if row.get("tracked")]
    return {"settings": settings, "rows": rows}


@app.get("/api/items/{item_id}/production")
def api_item_production(item_id: str, group_by: str | None = None) -> dict[str, Any]:
    item = get_item_with_images(item_id)
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    settings = load_production_settings()
    group_label = group_by if group_by else default_group_label(item.get("category", ""))
    if group_by == "all":
        group_label = None
    return {
        "item_id": item_id,
        "item_label": item.get("shop_title") or item.get("item_name") or item.get("etsy_title") or "Untitled",
        "category": item.get("category"),
        "group_by_label": group_label,
        "settings": settings,
        "variations": item_variation_rows(item, settings, group_by_label=group_label),
    }


@app.get("/api/options")
def api_options() -> dict[str, Any]:
    return load_options()


@app.get("/api/filament/spools")
def api_list_filament_spools() -> dict[str, Any]:
    spools = list_filament_spools()
    total = sum(s["quantity"] for s in spools)
    return {"spools": spools, "total_spools": total}


@app.post("/api/filament/spools")
async def api_add_filament_spools(request: Request) -> dict[str, Any]:
    payload: dict[str, Any] = await request.json()
    color_name = str(payload.get("color_name") or "").strip()
    quantity = int(payload.get("quantity") or 1)
    try:
        spool = add_filament_spools(color_name, quantity)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return spool


@app.post("/api/filament/spools/{spool_id}/adjust")
async def api_adjust_filament_spool(spool_id: str, request: Request) -> dict[str, Any]:
    payload: dict[str, Any] = await request.json()
    delta = int(payload.get("delta", 0))
    if delta == 0:
        raise HTTPException(status_code=400, detail="delta must not be zero")
    try:
        spool = adjust_filament_spool(spool_id, delta)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    return spool


@app.patch("/api/filament/spools/{spool_id}")
async def api_update_filament_spool(spool_id: str, request: Request) -> dict[str, Any]:
    payload: dict[str, Any] = await request.json()
    color_name = str(payload.get("color_name") or "").strip()
    try:
        spool = update_filament_color_name(spool_id, color_name)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if not spool:
        raise HTTPException(status_code=404, detail="Spool not found")
    return spool


@app.delete("/api/filament/spools/{spool_id}")
def api_delete_filament_spool(spool_id: str) -> dict[str, bool]:
    if not delete_filament_spool(spool_id):
        raise HTTPException(status_code=404, detail="Spool not found")
    return {"deleted": True}


@app.get("/media/{file_path:path}")
def serve_media(file_path: str) -> FileResponse:
    full_path = resolve_project_path(file_path)
    base = BASE_DIR.resolve()
    if not str(full_path).startswith(str(base)):
        raise HTTPException(status_code=403, detail="Access denied")
    if not full_path.exists():
        raise HTTPException(status_code=404, detail="File not found")
    return FileResponse(full_path)
