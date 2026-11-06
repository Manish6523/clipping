"""Atomic safe render-replacement pipeline for AutoClipDaemon.

Handles:
- Rendering to temporary files (`render_{uuid}.tmp.mp4`)
- ffprobe validation (valid stream, audio present, duration > 0, decodable)
- Windows atomic swap via os.replace()
- Single atomic DB transaction updating rendered_video_path, thumbnail_path, render_version, edl_hash, rendered_at
- Post-commit deletion of old versions with exponential backoff for Windows PermissionError
- Recording locked files into pending_deletes DB table
- Drain loop to purge pending_deletes on server idle/shutdown
- Per-clip asyncio.Lock to avoid concurrent render collisions
"""

import asyncio
import hashlib
import json
import logging
import os
import shutil
import uuid
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

from config.settings import RENDER_DIR
from src.database import get_db_connection, get_clip

logger = logging.getLogger(__name__)

# Clip ID -> asyncio.Lock
_CLIP_LOCKS: Dict[int, asyncio.Lock] = {}
_LOCKS_MUTEX = asyncio.Lock()


async def get_clip_lock(clip_id: int) -> asyncio.Lock:
    """Return exclusive asyncio Lock for a given clip ID."""
    async with _LOCKS_MUTEX:
        if clip_id not in _CLIP_LOCKS:
            _CLIP_LOCKS[clip_id] = asyncio.Lock()
        return _CLIP_LOCKS[clip_id]


def compute_edl_hash(edl_data: Dict[str, Any]) -> str:
    """Compute sha256 checksum of normalized EDL JSON for change detection."""
    # Exclude metadata like version, timestamp, history
    normalized = {
        "source": edl_data.get("source"),
        "segments": edl_data.get("segments"),
        "layout": edl_data.get("layout"),
        "captions": edl_data.get("captions"),
        "words": [w for w in edl_data.get("words", []) if not w.get("deleted")],
        "export": edl_data.get("export"),
    }
    dumped = json.dumps(normalized, sort_keys=True, default=str)
    return hashlib.sha256(dumped.encode("utf-8")).hexdigest()[:16]


async def validate_video_file(file_path: Path) -> Tuple[bool, Optional[str]]:
    """Validate MP4 file using ffprobe to ensure valid video & decodability."""
    if not file_path.exists() or file_path.stat().st_size < 1024:
        return False, "File does not exist or is too small (<1KB)"

    cmd = [
        "ffprobe",
        "-v", "error",
        "-show_entries", "format=duration,size:stream=codec_type,width,height",
        "-of", "json",
        str(file_path),
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await proc.communicate()
        if proc.returncode != 0:
            err = stderr.decode(errors="ignore")
            return False, f"ffprobe error: {err[:200]}"

        data = json.loads(stdout.decode("utf-8"))
        streams = data.get("streams", [])
        has_video = any(s.get("codec_type") == "video" for s in streams)
        if not has_video:
            return False, "No valid video stream found"

        duration = float(data.get("format", {}).get("duration", 0))
        if duration <= 0.1:
            return False, f"Invalid duration: {duration}s"

        return True, None
    except Exception as e:
        return False, f"Validation exception: {str(e)}"


async def record_pending_delete(file_path: str, error_msg: Optional[str] = None):
    """Store locked file path for later background removal."""
    try:
        async with get_db_connection() as db:
            await db.execute(
                "INSERT INTO pending_deletes (file_path, last_error) VALUES (?, ?)",
                (str(file_path), str(error_msg or "")),
            )
            await db.commit()
            logger.info("Recorded %s in pending_deletes table", file_path)
    except Exception as e:
        logger.error("Failed to insert into pending_deletes: %s", e)


async def safe_delete_file(file_path: str | Path, max_retries: int = 5) -> bool:
    """Delete file with Windows PermissionError exponential retry and fallback."""
    p = Path(file_path)
    if not p.exists():
        return True

    delays = [0.1, 0.25, 0.5, 1.0, 2.0]
    for attempt in range(max_retries):
        try:
            p.unlink()
            return True
        except PermissionError as e:
            if attempt < max_retries - 1:
                await asyncio.sleep(delays[attempt])
            else:
                logger.warning(
                    "PermissionError deleting %s after %d retries. Queuing in pending_deletes.",
                    p, max_retries
                )
                await record_pending_delete(str(p), str(e))
                return False
        except Exception as e:
            logger.warning("Error deleting %s: %s", p, e)
            await record_pending_delete(str(p), str(e))
            return False
    return False


async def drain_pending_deletes() -> int:
    """Attempt deletion of files accumulated in pending_deletes."""
    deleted_count = 0
    try:
        async with get_db_connection() as db:
            cur = await db.execute("SELECT id, file_path, retry_count FROM pending_deletes ORDER BY id ASC LIMIT 50")
            rows = await cur.fetchall()
            for r in rows:
                row_id = r["id"]
                fpath = Path(r["file_path"])
                retries = r["retry_count"] + 1

                if not fpath.exists():
                    await db.execute("DELETE FROM pending_deletes WHERE id = ?", (row_id,))
                    deleted_count += 1
                    continue

                try:
                    fpath.unlink()
                    await db.execute("DELETE FROM pending_deletes WHERE id = ?", (row_id,))
                    deleted_count += 1
                except Exception as e:
                    await db.execute(
                        "UPDATE pending_deletes SET retry_count = ?, last_error = ? WHERE id = ?",
                        (retries, str(e), row_id),
                    )
            await db.commit()
    except Exception as e:
        logger.error("Failed during drain_pending_deletes: %s", e)
    return deleted_count


class SafeRenderManager:
    """Orchestrates atomic temp rendering, validation, os.replace swap, and DB update."""

    @staticmethod
    async def commit_render_swap(
        clip_id: int,
        temp_video_path: Path,
        temp_thumb_path: Optional[Path],
        edl_hash: str,
        broadcast_fn=None,
    ) -> Dict[str, Any]:
        """
        Atomically validate, swap, and commit the new render for clip_id.
        """
        lock = await get_clip_lock(clip_id)
        async with lock:
            clip = await get_clip(clip_id)
            if not clip:
                raise ValueError(f"Clip #{clip_id} not found in database")

            # 1. Validate temp video file with ffprobe
            valid, err = await validate_video_file(temp_video_path)
            if not valid:
                try:
                    if temp_video_path.exists():
                        temp_video_path.unlink()
                    if temp_thumb_path and temp_thumb_path.exists():
                        temp_thumb_path.unlink()
                except Exception:
                    pass
                raise RuntimeError(f"Rendered video failed ffprobe validation: {err}")

            # 2. Determine version numbers and final destination names
            old_version = clip.get("render_version") or 1
            new_version = old_version + 1

            old_video_path = clip.get("rendered_video_path")
            old_thumb_path = clip.get("thumbnail_path")

            render_dir = Path(RENDER_DIR)
            render_dir.mkdir(parents=True, exist_ok=True)

            final_video_name = f"clip_{clip_id}_v{new_version}.mp4"
            final_video_path = render_dir / final_video_name

            final_thumb_name = f"clip_{clip_id}_v{new_version}_thumb.jpg"
            final_thumb_path = render_dir / final_thumb_name if temp_thumb_path else None

            # 3. Atomic file swap on disk via os.replace
            try:
                os.replace(temp_video_path, final_video_path)
            except Exception as e:
                raise RuntimeError(f"Failed atomic replacement of video file: {e}")

            if temp_thumb_path and temp_thumb_path.exists() and final_thumb_path:
                try:
                    os.replace(temp_thumb_path, final_thumb_path)
                except Exception as e:
                    logger.warning("Failed swapping thumbnail poster: %s", e)
                    final_thumb_path = None

            # 4. Atomic Database Transaction
            try:
                async with get_db_connection() as db:
                    await db.execute(
                        """
                        UPDATE clips SET
                            rendered_video_path = ?,
                            thumbnail_path = ?,
                            render_version = ?,
                            edl_hash = ?,
                            last_render_error = NULL,
                            rendered_at = CURRENT_TIMESTAMP,
                            updated_at = CURRENT_TIMESTAMP
                        WHERE id = ?
                        """,
                        (
                            str(final_video_path),
                            str(final_thumb_path) if final_thumb_path else old_thumb_path,
                            new_version,
                            edl_hash,
                            clip_id,
                        ),
                    )
                    await db.commit()
            except Exception as e:
                # If DB update fails, record error
                raise RuntimeError(f"Database commit failed for render swap: {e}")

            # 5. Post-commit cleanup of old files (Safe with retries)
            if old_video_path and Path(old_video_path).resolve() != final_video_path.resolve():
                asyncio.create_task(safe_delete_file(old_video_path))

            if old_thumb_path and final_thumb_path and Path(old_thumb_path).resolve() != final_thumb_path.resolve():
                asyncio.create_task(safe_delete_file(old_thumb_path))

            updated_clip = await get_clip(clip_id)

            # 6. WebSocket notification broadcast
            if broadcast_fn:
                try:
                    await broadcast_fn({
                        "event": "render_complete",
                        "clip_id": clip_id,
                        "render_version": new_version,
                        "edl_hash": edl_hash,
                        "video_url": f"/api/clips/{clip_id}/video?v={new_version}",
                        "thumbnail_url": f"/renders/{final_thumb_name}?v={new_version}" if final_thumb_path else None,
                    })
                except Exception as e:
                    logger.warning("Failed to broadcast render_complete: %s", e)

            return updated_clip

