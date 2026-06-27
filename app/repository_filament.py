"""Filament spool inventory (1 kg rolls by color)."""

from __future__ import annotations

from typing import Any

from app.db import get_db, new_id, utc_now


def row_to_spool(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "color_name": row["color_name"],
        "quantity": row["quantity"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_filament_spools() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            "SELECT * FROM filament_spools ORDER BY color_name COLLATE NOCASE"
        ).fetchall()
    return [row_to_spool(row) for row in rows]


def get_filament_spool(spool_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM filament_spools WHERE id = ?", (spool_id,)).fetchone()
    return row_to_spool(row) if row else None


def find_filament_by_color(color_name: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute(
            "SELECT * FROM filament_spools WHERE color_name = ? COLLATE NOCASE",
            (color_name.strip(),),
        ).fetchone()
    return row_to_spool(row) if row else None


def add_filament_spools(color_name: str, quantity: int) -> dict[str, Any]:
    name = color_name.strip()
    if not name:
        raise ValueError("Color name is required")
    if quantity < 1:
        raise ValueError("Quantity must be at least 1")

    existing = find_filament_by_color(name)
    now = utc_now()
    if existing:
        new_qty = existing["quantity"] + quantity
        with get_db() as conn:
            conn.execute(
                "UPDATE filament_spools SET quantity = ?, updated_at = ? WHERE id = ?",
                (new_qty, now, existing["id"]),
            )
            row = conn.execute(
                "SELECT * FROM filament_spools WHERE id = ?", (existing["id"],)
            ).fetchone()
        return row_to_spool(row)

    spool_id = new_id()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO filament_spools (id, color_name, quantity, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (spool_id, name, quantity, now, now),
        )
        row = conn.execute("SELECT * FROM filament_spools WHERE id = ?", (spool_id,)).fetchone()
    return row_to_spool(row)


def adjust_filament_spool(spool_id: str, delta: int) -> dict[str, Any] | None:
    spool = get_filament_spool(spool_id)
    if not spool:
        return None

    new_qty = spool["quantity"] + delta
    if new_qty < 0:
        raise ValueError("Quantity cannot go below zero")

    now = utc_now()
    with get_db() as conn:
        conn.execute(
            "UPDATE filament_spools SET quantity = ?, updated_at = ? WHERE id = ?",
            (new_qty, now, spool_id),
        )
        row = conn.execute("SELECT * FROM filament_spools WHERE id = ?", (spool_id,)).fetchone()
    return row_to_spool(row)


def update_filament_color_name(spool_id: str, color_name: str) -> dict[str, Any] | None:
    name = color_name.strip()
    if not name:
        raise ValueError("Color name is required")

    spool = get_filament_spool(spool_id)
    if not spool:
        return None

    if name.lower() == spool["color_name"].lower():
        return spool

    existing = find_filament_by_color(name)
    if existing and existing["id"] != spool_id:
        raise ValueError(f"Color '{name}' is already in inventory")

    now = utc_now()
    with get_db() as conn:
        conn.execute(
            "UPDATE filament_spools SET color_name = ?, updated_at = ? WHERE id = ?",
            (name, now, spool_id),
        )
        row = conn.execute("SELECT * FROM filament_spools WHERE id = ?", (spool_id,)).fetchone()
    return row_to_spool(row)


def delete_filament_spool(spool_id: str) -> bool:
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM filament_spools WHERE id = ?", (spool_id,))
    return cursor.rowcount > 0
