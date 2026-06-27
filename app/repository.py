"""Data access layer for items and images."""

from __future__ import annotations

import json
from typing import Any

from app.db import get_db, new_id, row_to_image, row_to_item, utc_now


def create_item(
    *,
    item_name: str,
    category: str,
    modifiers: list[dict[str, Any]],
    price: float | None,
    sku: str | None,
    status: str = "draft",
) -> dict[str, Any]:
    item_id = new_id()
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO items (
                id, item_name, category, modifiers, price, sku,
                etsy_title, description, tags, shop_title,
                status, primary_image_id, production, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, '[]', NULL, ?, NULL, '{}', ?, ?)
            """,
            (
                item_id,
                item_name,
                category,
                json.dumps(modifiers),
                price,
                sku,
                status,
                now,
                now,
            ),
        )
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row)


def get_item(item_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row) if row else None


def get_item_with_images(item_id: str) -> dict[str, Any] | None:
    item = get_item(item_id)
    if not item:
        return None
    item["images"] = list_images(item_id)
    return item


def list_items(
    *,
    category: str | None = None,
    status: str | None = None,
    search: str | None = None,
) -> list[dict[str, Any]]:
    query = "SELECT * FROM items WHERE 1=1"
    params: list[Any] = []

    if category:
        query += " AND category = ?"
        params.append(category)
    if status:
        query += " AND status = ?"
        params.append(status)
    if search:
        query += " AND (item_name LIKE ? OR etsy_title LIKE ? OR shop_title LIKE ? OR sku LIKE ?)"
        term = f"%{search}%"
        params.extend([term, term, term, term])

    query += " ORDER BY updated_at DESC"

    with get_db() as conn:
        rows = conn.execute(query, params).fetchall()

    items = [row_to_item(row) for row in rows]
    for item in items:
        item["images"] = list_images(item["id"])
    return items


def update_item(item_id: str, **fields: Any) -> dict[str, Any] | None:
    allowed = {
        "item_name",
        "category",
        "modifiers",
        "price",
        "sku",
        "etsy_title",
        "description",
        "tags",
        "shop_title",
        "status",
        "primary_image_id",
        "production",
    }
    updates: dict[str, Any] = {k: v for k, v in fields.items() if k in allowed}
    if not updates:
        return get_item(item_id)

    if "modifiers" in updates:
        updates["modifiers"] = json.dumps(updates["modifiers"])
    if "tags" in updates:
        updates["tags"] = json.dumps(updates["tags"])
    if "production" in updates:
        updates["production"] = json.dumps(updates["production"])

    updates["updated_at"] = utc_now()
    set_clause = ", ".join(f"{key} = ?" for key in updates)
    values = list(updates.values()) + [item_id]

    with get_db() as conn:
        conn.execute(f"UPDATE items SET {set_clause} WHERE id = ?", values)
        row = conn.execute("SELECT * FROM items WHERE id = ?", (item_id,)).fetchone()

    return row_to_item(row) if row else None


def add_image(
    *,
    item_id: str,
    image_type: str,
    file_path: str,
    sort_order: int = 0,
    styled_subject: str | None = None,
) -> dict[str, Any]:
    image_id = new_id()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO images (id, item_id, type, file_path, sort_order, styled_subject)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (image_id, item_id, image_type, file_path, sort_order, styled_subject),
        )
        row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
    return row_to_image(row)


def list_images(item_id: str) -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM images WHERE item_id = ? ORDER BY sort_order, id",
            (item_id,),
        ).fetchall()
    return [row_to_image(row) for row in rows]


def get_image(image_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM images WHERE id = ?", (image_id,)).fetchone()
    return row_to_image(row) if row else None


def delete_image(image_id: str) -> None:
    with get_db() as conn:
        conn.execute("DELETE FROM images WHERE id = ?", (image_id,))


def get_items_by_ids(item_ids: list[str]) -> list[dict[str, Any]]:
    if not item_ids:
        return []
    placeholders = ",".join("?" * len(item_ids))
    with get_db() as conn:
        rows = conn.execute(
            f"SELECT * FROM items WHERE id IN ({placeholders}) ORDER BY updated_at DESC",
            item_ids,
        ).fetchall()
    items = [row_to_item(row) for row in rows]
    for item in items:
        item["images"] = list_images(item["id"])
    return items


def delete_items(item_ids: list[str]) -> int:
    """Delete items, their image records, and files on disk."""
    if not item_ids:
        return 0

    from app.db import resolve_project_path

    items = get_items_by_ids(item_ids)
    for item in items:
        for img in item.get("images", []):
            file_path = resolve_project_path(img["file_path"])
            if file_path.is_file():
                file_path.unlink()

    placeholders = ",".join("?" * len(item_ids))
    with get_db() as conn:
        conn.execute(f"DELETE FROM items WHERE id IN ({placeholders})", item_ids)

    return len(item_ids)

