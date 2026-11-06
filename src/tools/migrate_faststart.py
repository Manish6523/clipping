"""One-off FastStart & Thumbnail Remux Migration Script.

Re-muxes all rendered MP4 clips with -c copy -movflags +faststart for instant playback
and extracts a crisp JPEG poster/thumbnail stored on disk and referenced in the database.
"""

import asyncio
import os
import shutil
import subprocess
from pathlib import Path

from config.settings import RENDER_DIR
from src.database import get_db_connection


async def remux_and_generate_posters():
    print(f"Scanning renders in {RENDER_DIR}...")
    render_dir = Path(RENDER_DIR)
    if not render_dir.exists():
        print("Render dir does not exist.")
        return

    mp4_files = list(render_dir.glob("*.mp4"))
    print(f"Found {len(mp4_files)} MP4 files to process.")

    for mp4 in mp4_files:
        if mp4.stat().st_size == 0 or "_faststart_tmp" in mp4.name:
            continue

        base_name = mp4.stem
        thumb_path = render_dir / f"{base_name}_thumb.jpg"

        # 1. Generate JPEG thumbnail poster at 1.0s (or 0.0s)
        if not thumb_path.exists():
            thumb_cmd = [
                "ffmpeg", "-y",
                "-ss", "1.0",
                "-i", str(mp4),
                "-vframes", "1",
                "-vf", "scale=540:960:force_original_aspect_ratio=decrease",
                "-q:v", "3",
                str(thumb_path)
            ]
            try:
                proc = await asyncio.create_subprocess_exec(
                    *thumb_cmd,
                    stdout=asyncio.subprocess.DEVNULL,
                    stderr=asyncio.subprocess.DEVNULL
                )
                await proc.communicate()
                if thumb_path.exists():
                    print(f"Generated thumbnail: {thumb_path.name}")
            except Exception as e:
                print(f"Failed thumb generation for {mp4.name}: {e}")

        # 2. Check and re-mux with -movflags +faststart
        # Fast remux to a temporary file, then atomic rename
        tmp_mp4 = render_dir / f"{base_name}_faststart_tmp.mp4"
        remux_cmd = [
            "ffmpeg", "-y",
            "-i", str(mp4),
            "-c", "copy",
            "-movflags", "+faststart",
            str(tmp_mp4)
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *remux_cmd,
                stdout=asyncio.subprocess.DEVNULL,
                stderr=asyncio.subprocess.DEVNULL
            )
            await proc.communicate()
            if tmp_mp4.exists() and tmp_mp4.stat().st_size > 0:
                # Replace original
                shutil.move(str(tmp_mp4), str(mp4))
                print(f"Successfully re-muxed with faststart: {mp4.name}")
            elif tmp_mp4.exists():
                tmp_mp4.unlink()
        except Exception as e:
            print(f"Remux failed for {mp4.name}: {e}")
            if tmp_mp4.exists():
                try:
                    tmp_mp4.unlink()
                except Exception:
                    pass

    # 3. Update database thumbnail_path references
    print("Updating database clip thumbnail paths...")
    async with get_db_connection() as db:
        cur = await db.execute("SELECT id, rendered_video_path FROM clips WHERE rendered_video_path IS NOT NULL")
        clips = await cur.fetchall()
        for c in clips:
            cid = c[0] if isinstance(c, (list, tuple)) else c["id"]
            rvp = c[1] if isinstance(c, (list, tuple)) else c["rendered_video_path"]
            if rvp and os.path.exists(rvp):
                p = Path(rvp)
                t_cand = p.parent / f"{p.stem}_thumb.jpg"
                if t_cand.exists():
                    await db.execute(
                        "UPDATE clips SET thumbnail_path = ? WHERE id = ?",
                        (str(t_cand), cid)
                    )
        await db.commit()
    print("FastStart and Poster migration complete!")


if __name__ == "__main__":
    asyncio.run(remux_and_generate_posters())

