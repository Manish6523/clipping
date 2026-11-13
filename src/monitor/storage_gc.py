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

from datetime import datetime, timedelta, timezone

from src.database import get_db_connection, get_system_setting

logger = logging.getLogger(__name__)

# Max disk usage allowed for buffer directory (1.5 GB)
MAX_BUFFER_BYTES = 1500 * 1024 * 1024
# Max age for intermediate temporary files (15 minutes)
MAX_TEMP_FILE_AGE_SECONDS = 900


def _with_siblings(path_str: str) -> List[str]:
    """A clip file plus the side files the editor/renderer derive from it."""
    p = Path(path_str)
    return [
        str(p),
        str(p.with_suffix(".json")),                         # word-timing cache next to .ass
        str(p.with_name(f"{p.stem}_thumb.jpg")),             # poster frame
        str(p.with_name(f"{p.stem}.h264preview.mp4")),       # phone-playable source preview
    ]


async def get_protected_file_paths() -> Set[str]:
    """Normalized paths that must NEVER be deleted.

    Every file a live clip depends on: source footage (editor, trims, re-templates), render,
    captions + word cache, thumbnail and H.264 preview - for every clip that isn't rejected.
    Previously only queued renders were protected, so the source and word cache of every clip
    awaiting review were deleted after 15 minutes and the editor broke for them.
    """
    protected: Set[str] = set()
    try:
        async with get_db_connection() as db:
            cursor = await db.execute(
                """
                SELECT c.source_video_path, c.rendered_video_path, c.subtitle_path, c.thumbnail_path
                FROM clips c
                LEFT JOIN scheduled_queue q ON q.clip_id = c.id
                WHERE c.status != 'rejected'
                   OR q.yt_status = 'pending' OR q.ig_status = 'pending'
                """
            )
            rows = await cursor.fetchall()
            for r in rows:
                for value in tuple(r):
                    if not value:
                        continue
                    for path_str in _with_siblings(value):
                        try:
                            protected.add(str(Path(path_str).resolve()).lower())
                        except Exception:
                            protected.add(path_str.lower())
    except Exception as e:
        # If we can't tell what's in use, protect everything this round rather than guess.
        logger.warning("Failed to query protected clip paths (%s); skipping cleanup this round.", e)
        raise
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


DEFAULT_RETENTION_DAYS = 3
# Disk alert: less than 10% or less than 5 GB free on the data volume
DISK_ALERT_FREE_FRACTION = 0.10
DISK_ALERT_FREE_BYTES = 5 * 1024 ** 3


async def get_retention_days() -> float:
    """Days to keep the source footage of a published clip (0 = keep forever)."""
    try:
        raw = await get_system_setting("source_retention_days", str(DEFAULT_RETENTION_DAYS))
        return max(0.0, float(raw))
    except Exception:
        return float(DEFAULT_RETENTION_DAYS)


async def purge_published_sources(days: float, now: datetime = None) -> dict:
    """Delete the source footage (+ its H.264 preview) of clips published more than `days` ago.

    The rendered video, thumbnail and captions are kept, so the clip can still be watched and
    re-posted; only trimming / re-templating need the source, and those stop making sense once
    a clip is live. Clips that still have a pending upload on another channel are skipped.
    """
    result = {"clips": 0, "files": 0, "bytes": 0}
    if days <= 0:
        return result
    now = now or datetime.now(timezone.utc)
    cutoff = (now - timedelta(days=days)).isoformat()
    async with get_db_connection() as db:
        cur = await db.execute(
            """
            SELECT c.id, c.source_video_path, c.rendered_video_path FROM clips c
            WHERE c.status = 'published' AND c.source_purged_at IS NULL
              AND c.source_video_path IS NOT NULL
              AND COALESCE(c.published_at, c.updated_at) < ?
              AND NOT EXISTS (SELECT 1 FROM scheduled_queue q WHERE q.clip_id = c.id
                              AND (q.yt_status = 'pending' OR q.ig_status = 'pending'))
            """,
            (cutoff,),
        )
        rows = await cur.fetchall()
        for row in rows:
            clip_id, source, rendered = row[0], row[1], row[2]
            src = Path(source)
            # Never delete the published file itself (clips without a separate source point at it)
            same_as_render = False
            try:
                same_as_render = bool(rendered) and src.resolve() == Path(rendered).resolve()
            except Exception:
                pass
            if not same_as_render:
                for f in (src, src.with_name(f"{src.stem}.h264preview.mp4")):
                    try:
                        if f.is_file():
                            result["bytes"] += f.stat().st_size
                            f.unlink()
                            result["files"] += 1
                    except OSError as e:
                        logger.warning("Retention: could not delete %s: %s", f, e)
            await db.execute("UPDATE clips SET source_purged_at = ? WHERE id = ?", (now.isoformat(), clip_id))
            result["clips"] += 1
        if rows:
            await db.commit()
    if result["files"]:
        logger.info("🧹 Retention: removed source footage of %d published clip(s), freed %.1f MB",
                    result["clips"], result["bytes"] / 1024 / 1024)
    return result


def disk_status(path: Path = Path(".")) -> dict:
    usage = shutil.disk_usage(path)
    free_frac = usage.free / usage.total if usage.total else 1.0
    return {
        "total": usage.total, "used": usage.used, "free": usage.free,
        "free_fraction": round(free_frac, 4),
        "low": free_frac < DISK_ALERT_FREE_FRACTION or usage.free < DISK_ALERT_FREE_BYTES,
    }


async def check_health_alerts(path: Path = Path(".")) -> None:
    """Disk nearly full / YouTube cookies about to expire -> Telegram alert (deduplicated)."""
    from src.notify import alerts
    try:
        d = disk_status(path)
        if d["low"]:
            await alerts.alert("disk", f"Disk nearly full on the server: {d['free'] / 1024 ** 3:.1f} GB free "
                                       f"({d['free_fraction'] * 100:.0f}%). Lower the source retention days in "
                                       f"Settings or delete old clips.", key="disk:low")
    except Exception as e:
        logger.debug("disk check failed: %s", e)
    try:
        from src.monitor import ytdlp
        exp = ytdlp.cookies_expiry()
        if exp is not None:
            left = exp - time.time()
            if left < 0:
                await alerts.alert("cookies", "Your YouTube cookies.txt has expired - downloads on the server will "
                                              "start failing. Export a fresh one and upload it in Settings → YouTube downloads.",
                                   key="cookies:expired")
            elif left < 3 * 86400:
                await alerts.alert("cookies", f"Your YouTube cookies.txt expires in {left / 86400:.1f} days. Export a fresh "
                                              f"one and upload it in Settings → YouTube downloads.", key="cookies:expiring")
    except Exception as e:
        logger.debug("cookie check failed: %s", e)


async def run_storage_gc_loop(base_dirs: List[Path], interval_seconds: int = 120):
    """Periodic background worker running garbage collection every 2 minutes."""
    while True:
        try:
            await purge_published_sources(await get_retention_days())
        except Exception as e:
            logger.error("Source retention error: %s", e)
        await check_health_alerts()
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

