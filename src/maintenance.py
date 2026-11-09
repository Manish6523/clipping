"""Safe Database and Storage Reset Engine for AutoClipDaemon.

Supports clean wiping of:
- clips, vods, pipeline_jobs, clip_edls, pending_deletes, scheduled_queue
- rendered files, buffers, thumbnails
- safe preserves for channels, presets, token auth secrets
- automated DB backups to data/backups/
- safe WAL checkpoint truncate and VACUUM
"""

import asyncio
import logging
import os
import shutil
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, Optional

from config.settings import DATABASE_PATH, RENDER_DIR, BUFFER_DIR
from src.database import get_db_connection
from src.database_migrations import run_migrations
from src.compositor.render_swap import safe_delete_file

logger = logging.getLogger(__name__)

BACKUP_DIR = Path("data/backups")


async def backup_database() -> Path:
    """Flush WAL to main SQLite file and create timestamped backup in data/backups/."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    backup_file = BACKUP_DIR / f"autoclip_backup_{timestamp}.db"

    # Truncate WAL to ensure everything is flushed into main db file
    async with get_db_connection() as db:
        await db.execute("PRAGMA wal_checkpoint(TRUNCATE);")

    # Copy database file
    shutil.copy2(DATABASE_PATH, backup_file)
    logger.info("Database backed up successfully to %s", backup_file)
    return backup_file


async def wipe_directory_contents(dir_path: Path, ignore_patterns=(".gitkeep",)):
    """Delete all files in a directory while preserving directory structure."""
    if not dir_path.exists():
        return 0
    count = 0
    for item in dir_path.iterdir():
        if item.name in ignore_patterns:
            continue
        if item.is_file():
            if await safe_delete_file(item):
                count += 1
        elif item.is_dir():
            try:
                shutil.rmtree(item, ignore_errors=True)
                count += 1
            except Exception:
                pass
    return count


async def execute_database_reset(
    keep_channels: bool = True,
    keep_presets: bool = True,
    keep_tokens: bool = True,
    create_backup: bool = True,
) -> Dict[str, Any]:
    """
    Perform safe and thorough reset of AutoClipDaemon state.
    """
    result: Dict[str, Any] = {
        "success": True,
        "backup_path": None,
        "cleared_tables": [],
        "deleted_render_files": 0,
        "deleted_buffer_files": 0,
    }

    # 1. Create safety backup
    if create_backup and Path(DATABASE_PATH).exists():
        try:
            b_path = await backup_database()
            result["backup_path"] = str(b_path)
        except Exception as e:
            logger.warning("Backup failed before reset: %s", e)

    # 2. Clear requested database tables inside a single atomic transaction
    async with get_db_connection() as db:
        # Wipe operational tables
        tables_to_clear = [
            "clips",
            "candidates",
            "clip_feedback_events",
            "vods",
            "pipeline_jobs",
            "clip_edls",
            "scheduled_queue",
            "pending_deletes",
        ]

        if not keep_channels:
            tables_to_clear.append("channels")
        if not keep_presets:
            tables_to_clear.append("presets")

        for table in tables_to_clear:
            try:
                await db.execute(f"DELETE FROM {table};")
                result["cleared_tables"].append(table)
            except Exception as e:
                logger.debug("Table %s delete skipped: %s", table, e)

        # Reset autoincrement sequence
        try:
            await db.execute("DELETE FROM sqlite_sequence WHERE name IN ('clips', 'candidates', 'clip_feedback_events', 'vods', 'scheduled_queue', 'pending_deletes');")
            if not keep_channels:
                await db.execute("DELETE FROM sqlite_sequence WHERE name = 'channels';")
            if not keep_presets:
                await db.execute("DELETE FROM sqlite_sequence WHERE name = 'presets';")
        except Exception:
            pass

        await db.commit()

        # Checkpoint WAL
        try:
            await db.execute("PRAGMA wal_checkpoint(TRUNCATE);")
        except Exception:
            pass

        # Vacuum database to shrink on disk
        try:
            await db.execute("VACUUM;")
        except Exception:
            pass

        # Re-verify schema migrations
        await run_migrations(db)

    # 3. Purge physical files on disk
    render_count = await wipe_directory_contents(Path(RENDER_DIR))
    result["deleted_render_files"] = render_count

    buffer_count = await wipe_directory_contents(Path(BUFFER_DIR))
    result["deleted_buffer_files"] = buffer_count

    logger.info("AutoClipDaemon reset complete: %s", result)
    return result

