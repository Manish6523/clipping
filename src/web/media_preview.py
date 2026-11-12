"""Phone-playable video previews.

YouTube downloads are often AV1 (or VP9). Desktop Chrome decodes those in software, but most
phone browsers can't (iPhones only from the 15 Pro), so the clip editor's source preview stays
black on mobile. ``browser_playable`` returns an H.264 copy made once and cached next to the
original. Timing is untouched, so editor timestamps map 1:1 onto the source.
"""

import asyncio
import logging
import os
from pathlib import Path
from typing import Dict

logger = logging.getLogger(__name__)

PREVIEW_SUFFIX = ".h264preview.mp4"
_locks: Dict[str, asyncio.Lock] = {}


async def probe_video_codec(path: Path) -> str:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=codec_name", "-of", "csv=p=0", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        return out.decode().strip().lower()
    except Exception:
        return ""


def _fresh(preview: Path, src: Path) -> bool:
    return preview.exists() and preview.stat().st_size > 0 and preview.stat().st_mtime >= src.stat().st_mtime


async def browser_playable(src: Path) -> Path:
    """Return ``src`` if it is already H.264, otherwise a cached H.264 preview of it."""
    if src.name.endswith(PREVIEW_SUFFIX):
        return src
    codec = await probe_video_codec(src)
    if codec in ("h264", ""):
        return src
    preview = src.with_name(src.stem + PREVIEW_SUFFIX)
    if _fresh(preview, src):
        return preview
    lock = _locks.setdefault(str(src), asyncio.Lock())
    async with lock:
        if _fresh(preview, src):
            return preview
        tmp = src.with_name(src.stem + ".h264preview.part.mp4")
        logger.info("Making phone-playable H.264 preview of %s (source codec: %s)...", src.name, codec)
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-v", "error", "-i", str(src),
            "-map", "0:v:0", "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "23", "-pix_fmt", "yuv420p",
            "-c:a", "aac", "-b:a", "128k", "-movflags", "+faststart", str(tmp),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        if proc.returncode == 0 and tmp.exists():
            os.replace(tmp, preview)
            return preview
        logger.warning("H.264 preview failed for %s: %s", src.name, err.decode(errors="ignore")[-300:])
        tmp.unlink(missing_ok=True)
        return src
