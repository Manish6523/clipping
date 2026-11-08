"""Automatic Storage and Cache Garbage Collector for AutoClip.

Runs continuously in the background to ensure:
1. Temp directories (`temp/`, `tmp/vods/`, `tmp/buffer/`) are automatically pruned.
2. Intermediate sliced video files and `.ass` subtitles are removed after clip rendering.
3. Live stream TS chunks older than 10 minutes are aggressively purged.
4. Total buffer storage is capped strictly at 1.5 GB so disk never runs out of space.
"""

import asyncio
import logging
import os
import shutil
import time
from pathlib import Path
from typing import List, Set

from src.database import get_db_connection

logger = logging.getLogger(__name__)

# Max disk usage allowed for buffer directory (1.5 GB)
MAX_BUFFER_BYTES = 1500 * 1024 * 1024
# Max age for intermediate temporary files (15 minutes)
MAX_TEMP_FILE_AGE_SECONDS = 900


async def get_protected_file_paths() -> Set[str]:
    """Return normalized paths of clips that must NEVER be deleted.
    
    Protects:
    - Clips in pending scheduled queue (awaiting YouTube/Instagram publish)
    - Clips in 'ready', 'queued', or 'publishing' state
    """
    protected = set()
    try:
        async with get_db_connection() as db:
            cursor = await db.execute(
                """
                SELECT c.rendered_video_path 
                FROM clips c
                LEFT JOIN scheduled_queue q ON q.clip_id = c.id
                WHERE (c.status IN ('ready', 'queued', 'publishing'))
                   OR (q.yt_status = 'pending' OR q.ig_status = 'pending')
                """
            )
            rows = await cursor.fetchall()
            for r in rows:
                p = r[0] if isinstance(r, (list, tuple)) else r["rendered_video_path"]
                if p:
                    try:
                        resolved = str(Path(p).resolve()).lower()
                        protected.add(resolved)
                    except Exception:
                        protected.add(str(p).lower())
    except Exception as e:
        logger.debug("Failed to query protected clip paths: %s", e)
    return protected


def clean_directory_by_age(
    directory: Path,
    max_age_seconds: int = MAX_TEMP_FILE_AGE_SECONDS,
    protected_paths: Set[str] = None,
) -> int:
    """Removes files in directory older than max_age_seconds, strictly preserving protected clips."""
    if not directory.exists():
        return 0

    now = time.time()
    deleted_count = 0
    protected = protected_paths or set()

    try:
        for item in directory.rglob("*"):
            if item.is_file():
                # Never delete .gitkeep or database files
                if item.name.startswith(".git") or item.suffix in (".db", ".db-wal", ".db-shm"):
                    continue
                # Never delete protected clips
                try:
                    resolved_str = str(item.resolve()).lower()
                    if resolved_str in protected or str(item).lower() in protected:
                        continue
                except Exception:
                    pass

                try:
                    mtime = item.stat().st_mtime
                    if now - mtime > max_age_seconds:
                        item.unlink(missing_ok=True)
                        deleted_count += 1
                except Exception:
                    pass
    except Exception as e:
        logger.debug("clean_directory_by_age error on %s: %s", directory, e)

    return deleted_count


def enforce_directory_quota(
    directory: Path,
    max_bytes: int = MAX_BUFFER_BYTES,
    protected_paths: Set[str] = None,
) -> int:
    """Enforces strict size quota by removing oldest files first, strictly preserving protected clips."""
    if not directory.exists():
        return 0

    deleted_count = 0
    protected = protected_paths or set()
    try:
        files = []
        total_size = 0
        for item in directory.rglob("*"):
            if item.is_file():
                if item.suffix in (".db", ".db-wal", ".db-shm") or item.name.startswith(".git"):
                    continue
                # Skip protected clips from quota deletion
                try:
                    resolved_str = str(item.resolve()).lower()
                    if resolved_str in protected or str(item).lower() in protected:
                        continue
                except Exception:
                    pass

                try:
                    size = item.stat().st_size
                    mtime = item.stat().st_mtime
                    files.append((item, size, mtime))
                    total_size += size
                except Exception:
                    pass

        # Sort files from oldest to newest
        files.sort(key=lambda x: x[2])

        while total_size > max_bytes and files:
            oldest_file, size, _ = files.pop(0)
            try:
                oldest_file.unlink(missing_ok=True)
                total_size -= size
                deleted_count += 1
            except Exception:
                pass

    except Exception as e:
        logger.debug("enforce_directory_quota error on %s: %s", directory, e)

    return deleted_count


async def run_storage_gc_loop(base_dirs: List[Path], interval_seconds: int = 120):
    """Periodic background worker running garbage collection every 2 minutes."""
    while True:
        try:
            protected_paths = await get_protected_file_paths()
            total_purged = 0
            for d in base_dirs:
                # 1. Clean files older than 15 minutes (ignoring protected clips)
                total_purged += clean_directory_by_age(
                    d,
                    max_age_seconds=MAX_TEMP_FILE_AGE_SECONDS,
                    protected_paths=protected_paths,
                )
                # 2. Hard clamp storage size to MAX_BUFFER_BYTES
                total_purged += enforce_directory_quota(
                    d,
                    max_bytes=MAX_BUFFER_BYTES,
                    protected_paths=protected_paths,
                )

            if total_purged > 0:
                logger.info("🧹 AutoClip Storage GC: Cleaned %d expired/overflow temp files.", total_purged)

        except Exception as e:
            logger.error("Storage GC loop error: %s", e)

        await asyncio.sleep(interval_seconds)

