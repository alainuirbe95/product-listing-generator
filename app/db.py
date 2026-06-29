"""SQLite database setup and helpers."""

from __future__ import annotations

import json
import os
import sqlite3
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Generator

BASE_DIR = Path(__file__).resolve().parent.parent
DEFAULT_DB_PATH = BASE_DIR / "data" / "db.sqlite"


def resolve_project_path(path: str | Path) -> Path:
    """Resolve config/env paths relative to the project root."""
    p = Path(path).expanduser()
    if p.is_absolute():
        return p.resolve()
    return (BASE_DIR / p).resolve()


def store_relative_path(path: Path) -> str:
    """Store a path relative to BASE_DIR for portability."""
    return str(path.resolve().relative_to(BASE_DIR.resolve()))


def get_db_path() -> Path:
    env_path = os.getenv("DATABASE_PATH")
    if env_path:
        return resolve_project_path(env_path)
    return DEFAULT_DB_PATH


def _connect() -> sqlite3.Connection:
    db_path = get_db_path()
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(db_path))
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


@contextmanager
def get_db() -> Generator[sqlite3.Connection, None, None]:
    conn = _connect()
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def init_db() -> None:
    with get_db() as conn:
        conn.executescript(
            """
            CREATE TABLE IF NOT EXISTS items (
                id TEXT PRIMARY KEY,
                item_name TEXT NOT NULL,
                category TEXT NOT NULL,
                modifiers TEXT NOT NULL DEFAULT '[]',
                price REAL,
                sku TEXT,
                etsy_title TEXT,
                description TEXT,
                tags TEXT NOT NULL DEFAULT '[]',
                shop_title TEXT,
                status TEXT NOT NULL DEFAULT 'draft',
                primary_image_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS images (
                id TEXT PRIMARY KEY,
                item_id TEXT NOT NULL,
                type TEXT NOT NULL CHECK(type IN ('original', 'generated', 'generated_styled')),
                file_path TEXT NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                styled_subject TEXT,
                FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_items_status ON items(status);
            CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
            CREATE INDEX IF NOT EXISTS idx_images_item_id ON images(item_id);
            """
        )
        _migrate_schema(conn)


def _migrate_schema(conn: sqlite3.Connection) -> None:
    columns = {row[1] for row in conn.execute("PRAGMA table_info(items)").fetchall()}
    if "production" not in columns:
        conn.execute("ALTER TABLE items ADD COLUMN production TEXT NOT NULL DEFAULT '{}'")
    for col in ("uploaded_etsy", "uploaded_meta", "uploaded_tiktok", "uploaded_website"):
        if col not in columns:
            conn.execute(f"ALTER TABLE items ADD COLUMN {col} INTEGER NOT NULL DEFAULT 0")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS filament_spools (
            id TEXT PRIMARY KEY,
            color_name TEXT NOT NULL COLLATE NOCASE UNIQUE,
            quantity INTEGER NOT NULL DEFAULT 0 CHECK(quantity >= 0),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS print_queue (
            id TEXT PRIMARY KEY,
            item_name TEXT NOT NULL,
            order_name TEXT NOT NULL DEFAULT '',
            stage TEXT NOT NULL DEFAULT 'in_queue'
                CHECK(stage IN ('in_queue', 'printing')),
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        )
        """
    )

    _migrate_images_table(conn)


def _migrate_images_table(conn: sqlite3.Connection) -> None:
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='images'"
    ).fetchone()
    if not row or not row[0]:
        return

    table_sql = row[0]
    needs_rebuild = "generated_styled" not in table_sql

    columns = {col[1] for col in conn.execute("PRAGMA table_info(images)").fetchall()}
    if not needs_rebuild and "styled_subject" in columns:
        return

    conn.executescript(
        """
        CREATE TABLE images_new (
            id TEXT PRIMARY KEY,
            item_id TEXT NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('original', 'generated', 'generated_styled')),
            file_path TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            styled_subject TEXT,
            FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
        );
        INSERT INTO images_new (id, item_id, type, file_path, sort_order, styled_subject)
        SELECT id, item_id, type, file_path, sort_order, NULL FROM images;
        DROP TABLE images;
        ALTER TABLE images_new RENAME TO images;
        CREATE INDEX IF NOT EXISTS idx_images_item_id ON images(item_id);
        """
    )


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def new_id() -> str:
    return str(uuid.uuid4())


def _row_bool(row: sqlite3.Row, key: str) -> bool:
    return bool(row[key]) if key in row.keys() else False


def row_to_item(row: sqlite3.Row) -> dict[str, Any]:
    return {
        "id": row["id"],
        "item_name": row["item_name"],
        "category": row["category"],
        "modifiers": json.loads(row["modifiers"]),
        "price": row["price"],
        "sku": row["sku"],
        "etsy_title": row["etsy_title"],
        "description": row["description"],
        "tags": json.loads(row["tags"]),
        "shop_title": row["shop_title"],
        "status": row["status"],
        "primary_image_id": row["primary_image_id"],
        "production": json.loads(row["production"]) if "production" in row.keys() else {},
        "uploaded_etsy": _row_bool(row, "uploaded_etsy"),
        "uploaded_meta": _row_bool(row, "uploaded_meta"),
        "uploaded_tiktok": _row_bool(row, "uploaded_tiktok"),
        "uploaded_website": _row_bool(row, "uploaded_website"),
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
    }


def row_to_image(row: sqlite3.Row) -> dict[str, Any]:
    keys = row.keys()
    return {
        "id": row["id"],
        "item_id": row["item_id"],
        "type": row["type"],
        "file_path": row["file_path"],
        "sort_order": row["sort_order"],
        "styled_subject": row["styled_subject"] if "styled_subject" in keys else None,
    }
