"""Asynchronous SQLite database operations for AutoClipDaemon.

Supports native aiosqlite or standard library sqlite3 via async thread execution.
"""

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional
from config.settings import DATABASE_PATH

try:
    import aiosqlite
    HAS_AIOSQLITE = True
except ImportError:
    import sqlite3
    HAS_AIOSQLITE = False


class SqliteThreadWrapper:
    """Async adapter wrapping standard library sqlite3 for zero-dependency execution."""

    def __init__(self, db_path: Path):
        self.db_path = db_path
        self._conn = None

    async def __aenter__(self):
        def _connect():
            conn = sqlite3.connect(self.db_path, timeout=5.0, check_same_thread=False)
            conn.row_factory = sqlite3.Row
            conn.execute("PRAGMA journal_mode = WAL;")
            conn.execute("PRAGMA synchronous = NORMAL;")
            conn.execute("PRAGMA busy_timeout = 5000;")
            conn.execute("PRAGMA foreign_keys = ON;")
            return conn
        self._conn = await asyncio.to_thread(_connect)
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        if self._conn:
            await asyncio.to_thread(self._conn.close)

    async def executescript(self, sql: str):
        return await asyncio.to_thread(self._conn.executescript, sql)

    async def execute(self, sql: str, parameters=()):
        class CursorWrapper:
            def __init__(self, cursor):
                self._cur = cursor
                self.lastrowid = cursor.lastrowid
                self.rowcount = cursor.rowcount

            async def fetchone(self):
                return await asyncio.to_thread(self._cur.fetchone)

            async def fetchall(self):
                return await asyncio.to_thread(self._cur.fetchall)

        cur = await asyncio.to_thread(self._conn.execute, sql, parameters)
        return CursorWrapper(cur)

    async def commit(self):
        await asyncio.to_thread(self._conn.commit)


def get_db_connection():
    """Get async SQLite connection (aiosqlite if installed, else sqlite3 thread wrapper)."""
    if HAS_AIOSQLITE:
        class AioSqliteContext:
            async def __aenter__(self):
                self.conn = await aiosqlite.connect(DATABASE_PATH, timeout=5.0)
                self.conn.row_factory = aiosqlite.Row
                await self.conn.execute("PRAGMA journal_mode = WAL;")
                await self.conn.execute("PRAGMA synchronous = NORMAL;")
                await self.conn.execute("PRAGMA busy_timeout = 5000;")
                await self.conn.execute("PRAGMA foreign_keys = ON;")
                return self.conn

            async def __aexit__(self, exc_type, exc_val, exc_tb):
                await self.conn.close()

        return AioSqliteContext()
    else:
        return SqliteThreadWrapper(DATABASE_PATH)


async def init_db() -> None:
    """Initialize database tables and run migrations."""
    DATABASE_PATH.parent.mkdir(parents=True, exist_ok=True)
    from src.database_migrations import run_migrations
    async with get_db_connection() as db:
        await run_migrations(db)


# ==========================================
# Channels Management
# ==========================================

async def add_channel(platform: str, channel_id_or_handle: str, template_name: str) -> int:
    """Add or re-activate a channel to monitor."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            INSERT INTO channels (platform, channel_id_or_handle, template_name, is_active)
            VALUES (?, ?, ?, 1)
            ON CONFLICT(channel_id_or_handle) DO UPDATE SET
                platform = excluded.platform,
                template_name = excluded.template_name,
                is_active = 1
            """,
            (platform.lower(), channel_id_or_handle.strip(), template_name.strip()),
        )
        await db.commit()
        return cursor.lastrowid or 0


async def remove_channel(channel_id_or_handle: str) -> bool:
    """Deactivate or remove channel monitoring permanently from channels table."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            "DELETE FROM channels WHERE channel_id_or_handle = ? OR id = ?",
            (channel_id_or_handle.strip(), int(channel_id_or_handle) if channel_id_or_handle.isdigit() else -1),
        )
        await db.commit()
        return cursor.rowcount > 0


async def get_active_channels() -> List[Dict[str, Any]]:
    """Retrieve all active channels configured for monitoring."""
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT * FROM channels WHERE is_active = 1")
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_channel(channel_id_or_handle: str) -> Optional[Dict[str, Any]]:
    """Get channel record by id or handle."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            "SELECT * FROM channels WHERE channel_id_or_handle = ?",
            (channel_id_or_handle.strip(),),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_channel_last_checked(channel_id: str, last_stream_id: Optional[str] = None) -> None:
    """Update timestamp and stream id for last checked channel."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        if last_stream_id is not None:
            await db.execute(
                "UPDATE channels SET last_checked_at = ?, last_stream_id = ? WHERE channel_id_or_handle = ?",
                (now, last_stream_id, channel_id),
            )
        else:
            await db.execute(
                "UPDATE channels SET last_checked_at = ? WHERE channel_id_or_handle = ?",
                (now, channel_id),
            )
        await db.commit()


# ==========================================
# VOD Management
# ==========================================

async def record_vod(platform: str, channel_id: str, vod_id: str, title: str, published_at: Optional[str] = None) -> int:
    """Record discovered VOD."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            INSERT INTO vods (platform, channel_id, vod_id, title, published_at, status)
            VALUES (?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(vod_id) DO NOTHING
            """,
            (platform, channel_id, vod_id, title, published_at),
        )
        await db.commit()
        return cursor.lastrowid or 0


async def is_vod_processed(vod_id: str) -> bool:
    """Check if VOD has already been processed or is currently processing."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            "SELECT id FROM vods WHERE vod_id = ? AND status IN ('completed', 'processing')",
            (vod_id,),
        )
        row = await cursor.fetchone()
        return row is not None


async def update_vod_status(vod_id: str, status: str) -> None:
    """Update VOD processing status."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE vods SET status = ?, processed_at = ? WHERE vod_id = ?",
            (status, now, vod_id),
        )
        await db.commit()


# ==========================================
# Clip Management
# ==========================================

async def create_clip(
    source_type: str,
    source_id: str,
    channel_id: str,
    template_name: str,
    raw_start: float,
    raw_end: float,
    virality_score: int,
    title: str,
    teaser_hook_timestamp: Optional[float] = None,
    description: str = "",
    hashtags: str = "",
    source_video_path: Optional[str] = None,
    rendered_video_path: Optional[str] = None,
    subtitle_path: Optional[str] = None,
    thumbnail_path: Optional[str] = None,
) -> int:
    """Insert a newly detected candidate clip."""
    now = datetime.now(timezone.utc).isoformat()
    if not thumbnail_path and rendered_video_path:
        t_cand = Path(rendered_video_path).parent / f"{Path(rendered_video_path).stem}_thumb.jpg"
        if t_cand.exists():
            thumbnail_path = str(t_cand)

    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            INSERT INTO clips (
                source_type, source_id, channel_id, template_name,
                raw_start, raw_end, adjusted_start, adjusted_end,
                teaser_hook_timestamp, has_teaser, virality_score,
                title, description, hashtags, source_video_path,
                rendered_video_path, subtitle_path, thumbnail_path, status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_approval', ?, ?)
            """,
            (
                source_type,
                source_id,
                channel_id,
                template_name,
                raw_start,
                raw_end,
                raw_start,
                raw_end,
                teaser_hook_timestamp,
                virality_score,
                title,
                description,
                hashtags,
                source_video_path,
                rendered_video_path,
                subtitle_path,
                thumbnail_path,
                now,
                now,
            ),
        )
        await db.commit()
        return cursor.lastrowid or 0


async def get_clip(clip_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve clip by ID."""
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT * FROM clips WHERE id = ?", (clip_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


async def update_clip_trim(clip_id: int, delta_start: float, delta_end: float) -> Optional[Dict[str, Any]]:
    """Apply trimming offset to clip adjusted_start and adjusted_end."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT adjusted_start, adjusted_end FROM clips WHERE id = ?", (clip_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        new_start = max(0.0, row["adjusted_start"] + delta_start)
        new_end = max(new_start + 5.0, row["adjusted_end"] + delta_end)

        await db.execute(
            "UPDATE clips SET adjusted_start = ?, adjusted_end = ?, updated_at = ? WHERE id = ?",
            (new_start, new_end, now, clip_id),
        )
        await db.commit()
        return await get_clip(clip_id)


async def toggle_clip_teaser(clip_id: int) -> Optional[Dict[str, Any]]:
    """Toggle the teaser pre-roll flag for a clip."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT has_teaser FROM clips WHERE id = ?", (clip_id,))
        row = await cursor.fetchone()
        if not row:
            return None

        new_val = 0 if row["has_teaser"] == 1 else 1
        await db.execute(
            "UPDATE clips SET has_teaser = ?, updated_at = ? WHERE id = ?",
            (new_val, now, clip_id),
        )
        await db.commit()
        return await get_clip(clip_id)


async def update_clip_caption(clip_id: int, title: str, description: Optional[str] = None, hashtags: Optional[str] = None) -> None:
    """Update title, description, and hashtags for a clip."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        if description is not None and hashtags is not None:
            await db.execute(
                "UPDATE clips SET title = ?, description = ?, hashtags = ?, updated_at = ? WHERE id = ?",
                (title, description, hashtags, now, clip_id),
            )
        else:
            await db.execute(
                "UPDATE clips SET title = ?, updated_at = ? WHERE id = ?",
                (title, now, clip_id),
            )
        await db.commit()


async def update_clip_status(clip_id: int, status: str) -> None:
    """Update clip workflow status."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE clips SET status = ?, updated_at = ? WHERE id = ?",
            (status, now, clip_id),
        )
        await db.commit()


async def update_clip_rendered_path(clip_id: int, rendered_video_path: str, subtitle_path: Optional[str] = None) -> None:
    """Store paths to generated video and subtitle assets."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        if subtitle_path:
            await db.execute(
                "UPDATE clips SET rendered_video_path = ?, subtitle_path = ?, updated_at = ? WHERE id = ?",
                (rendered_video_path, subtitle_path, now, clip_id),
            )
        else:
            await db.execute(
                "UPDATE clips SET rendered_video_path = ?, updated_at = ? WHERE id = ?",
                (rendered_video_path, now, clip_id),
            )
        await db.commit()


async def update_clip_telegram_info(clip_id: int, chat_id: int, message_id: int) -> None:
    """Record Telegram message identifiers for interactive editing."""
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE clips SET telegram_chat_id = ?, telegram_message_id = ? WHERE id = ?",
            (chat_id, message_id, clip_id),
        )
        await db.commit()


async def get_clip_by_message_id(message_id: int) -> Optional[Dict[str, Any]]:
    """Find clip by associated Telegram message id."""
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT * FROM clips WHERE telegram_message_id = ?", (message_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None


# ==========================================
# Scheduled Queue Management
# ==========================================

async def enqueue_clip(clip_id: int, scheduled_for: str) -> int:
    """Schedule a clip for drip publishing."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            INSERT INTO scheduled_queue (clip_id, scheduled_for, yt_status, ig_status)
            VALUES (?, ?, 'pending', 'pending')
            """,
            (clip_id, scheduled_for),
        )
        await db.execute("UPDATE clips SET status = 'queued' WHERE id = ?", (clip_id,))
        await db.commit()
        return cursor.lastrowid or 0


async def get_due_queue_items() -> List[Dict[str, Any]]:
    """Retrieve queue items whose scheduled time has passed and still pending."""
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            SELECT q.*, c.template_name, c.rendered_video_path, c.title, c.description, c.hashtags, c.channel_id
            FROM scheduled_queue q
            JOIN clips c ON q.clip_id = c.id
            WHERE q.scheduled_for <= ? AND (q.yt_status = 'pending' OR q.ig_status = 'pending')
            ORDER BY q.scheduled_for ASC
            """,
            (now,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def get_upcoming_queue(limit: int = 10) -> List[Dict[str, Any]]:
    """Get upcoming scheduled queue entries."""
    async with get_db_connection() as db:
        cursor = await db.execute(
            """
            SELECT q.*, c.title, c.template_name, c.channel_id
            FROM scheduled_queue q
            JOIN clips c ON q.clip_id = c.id
            WHERE q.yt_status = 'pending' OR q.ig_status = 'pending'
            ORDER BY q.scheduled_for ASC
            LIMIT ?
            """,
            (limit,),
        )
        rows = await cursor.fetchall()
        return [dict(row) for row in rows]


async def update_queue_status(
    queue_id: int,
    yt_status: Optional[str] = None,
    ig_status: Optional[str] = None,
    yt_video_id: Optional[str] = None,
    ig_media_id: Optional[str] = None,
    last_error: Optional[str] = None,
) -> None:
    """Update publishing statuses for scheduled queue item."""
    updates = []
    params = []

    if yt_status is not None:
        updates.append("yt_status = ?")
        params.append(yt_status)
    if ig_status is not None:
        updates.append("ig_status = ?")
        params.append(ig_status)
    if yt_video_id is not None:
        updates.append("yt_video_id = ?")
        params.append(yt_video_id)
    if ig_media_id is not None:
        updates.append("ig_media_id = ?")
        params.append(ig_media_id)
    if last_error is not None:
        updates.append("last_error = ?")
        params.append(last_error)

    if not updates:
        return

    params.append(queue_id)
    query = f"UPDATE scheduled_queue SET {', '.join(updates)} WHERE id = ?"

    async with get_db_connection() as db:
        await db.execute(query, tuple(params))
        await db.commit()


# ==========================================
# Edit Decision List (EDL) Storage
# ==========================================

async def get_clip_edl(clip_id: int) -> Optional[Dict[str, Any]]:
    """Retrieve saved EDL JSON for a clip."""
    import json
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT edl_json, version FROM clip_edls WHERE clip_id = ?", (clip_id,))
        row = await cursor.fetchone()
        if not row:
            return None
        try:
            data = json.loads(row["edl_json"])
            data["version"] = row["version"]
            return data
        except Exception:
            return None


async def save_clip_edl(clip_id: int, edl_data: Dict[str, Any]) -> int:
    """Save or update EDL JSON, bumping version."""
    import json
    async with get_db_connection() as db:
        cursor = await db.execute("SELECT version FROM clip_edls WHERE clip_id = ?", (clip_id,))
        row = await cursor.fetchone()
        new_version = (row["version"] + 1) if row else 1
        edl_data["version"] = new_version
        edl_str = json.dumps(edl_data)

        await db.execute(
            """
            INSERT INTO clip_edls (clip_id, edl_json, version, updated_at)
            VALUES (?, ?, ?, CURRENT_TIMESTAMP)
            ON CONFLICT(clip_id) DO UPDATE SET
                edl_json = excluded.edl_json,
                version = excluded.version,
                updated_at = CURRENT_TIMESTAMP
            """,
            (clip_id, edl_str, new_version),
        )
        await db.commit()
        return new_version
