"""Print queue for tracking items through in-queue and printing stages."""

from __future__ import annotations

from typing import Any

from app.db import get_db, new_id, utc_now

STAGES = ("in_queue", "printing")


def row_to_item(row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "item_name": row["item_name"],
        "order_name": row["order_name"],
        "stage": row["stage"],
        "sort_order": row["sort_order"],
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def list_print_queue() -> list[dict[str, Any]]:
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT * FROM print_queue
            ORDER BY
              CASE stage WHEN 'in_queue' THEN 0 WHEN 'printing' THEN 1 ELSE 2 END,
              sort_order ASC,
              created_at ASC
            """
        ).fetchall()
    return [row_to_item(row) for row in rows]


def get_print_queue_item(item_id: str) -> dict[str, Any] | None:
    with get_db() as conn:
        row = conn.execute("SELECT * FROM print_queue WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row) if row else None


def _next_sort_order(conn, stage: str) -> int:
    row = conn.execute(
        "SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM print_queue WHERE stage = ?",
        (stage,),
    ).fetchone()
    return int(row["next_order"])


def add_print_queue_item(item_name: str, order_name: str = "") -> dict[str, Any]:
    name = item_name.strip()
    if not name:
        raise ValueError("Item name is required")

    order = order_name.strip()
    now = utc_now()
    item_id = new_id()

    with get_db() as conn:
        sort_order = _next_sort_order(conn, "in_queue")
        conn.execute(
            """
            INSERT INTO print_queue
              (id, item_name, order_name, stage, sort_order, created_at, updated_at)
            VALUES (?, ?, ?, 'in_queue', ?, ?, ?)
            """,
            (item_id, name, order, sort_order, now, now),
        )
        row = conn.execute("SELECT * FROM print_queue WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row)


def update_print_queue_item(
    item_id: str,
    *,
    item_name: str | None = None,
    order_name: str | None = None,
    stage: str | None = None,
) -> dict[str, Any] | None:
    item = get_print_queue_item(item_id)
    if not item:
        return None

    updates: dict[str, Any] = {}
    if item_name is not None:
        name = item_name.strip()
        if not name:
            raise ValueError("Item name is required")
        updates["item_name"] = name

    if order_name is not None:
        updates["order_name"] = order_name.strip()

    if stage is not None:
        if stage not in STAGES:
            raise ValueError(f"Stage must be one of: {', '.join(STAGES)}")
        if stage != item["stage"]:
            with get_db() as conn:
                updates["sort_order"] = _next_sort_order(conn, stage)
            updates["stage"] = stage

    if not updates:
        return item

    updates["updated_at"] = utc_now()
    set_clause = ", ".join(f"{col} = ?" for col in updates)
    values = list(updates.values()) + [item_id]

    with get_db() as conn:
        conn.execute(f"UPDATE print_queue SET {set_clause} WHERE id = ?", values)
        row = conn.execute("SELECT * FROM print_queue WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row)


def move_print_queue_item(item_id: str, direction: str) -> dict[str, Any] | None:
    if direction not in ("up", "down"):
        raise ValueError("direction must be 'up' or 'down'")

    item = get_print_queue_item(item_id)
    if not item:
        return None

    with get_db() as conn:
        siblings = conn.execute(
            """
            SELECT id, sort_order FROM print_queue
            WHERE stage = ?
            ORDER BY sort_order ASC, created_at ASC
            """,
            (item["stage"],),
        ).fetchall()

    idx = next((i for i, row in enumerate(siblings) if row["id"] == item_id), -1)
    if idx < 0:
        return item

    swap_idx = idx - 1 if direction == "up" else idx + 1
    if swap_idx < 0 or swap_idx >= len(siblings):
        return item

    other = siblings[swap_idx]
    now = utc_now()
    with get_db() as conn:
        conn.execute(
            "UPDATE print_queue SET sort_order = ?, updated_at = ? WHERE id = ?",
            (other["sort_order"], now, item_id),
        )
        conn.execute(
            "UPDATE print_queue SET sort_order = ?, updated_at = ? WHERE id = ?",
            (item["sort_order"], now, other["id"]),
        )
        row = conn.execute("SELECT * FROM print_queue WHERE id = ?", (item_id,)).fetchone()
    return row_to_item(row)


def delete_print_queue_item(item_id: str) -> bool:
    with get_db() as conn:
        cursor = conn.execute("DELETE FROM print_queue WHERE id = ?", (item_id,))
    return cursor.rowcount > 0
