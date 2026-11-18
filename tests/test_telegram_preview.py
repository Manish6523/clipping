"""Clips over Telegram's 50 MB bot limit get a smaller preview; small clips are sent as-is."""
import asyncio
import subprocess

import config.settings as cfg
from src.bot import telegram_bot as tb


def test_big_clip_gets_preview_under_limit(tmp_path, monkeypatch):
    monkeypatch.setattr(cfg, "RENDER_DIR", tmp_path / "renders")
    clip = tmp_path / "clip_final.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc2=size=1080x1920:rate=30",
                    "-f", "lavfi", "-i", "sine", "-t", "6", "-c:v", "libx264", "-b:v", "8M", "-c:a", "aac",
                    "-shortest", str(clip)], check=True)
    assert asyncio.run(tb.telegram_video_file(str(clip))) == str(clip)          # under the limit: untouched
    size = clip.stat().st_size
    monkeypatch.setattr(tb, "TELEGRAM_VIDEO_LIMIT", size // 2)                 # pretend the clip is too big
    monkeypatch.setattr(tb, "TELEGRAM_PREVIEW_TARGET", size // 3)
    out = asyncio.run(tb.telegram_video_file(str(clip)))
    assert out != str(clip) and (tmp_path / "renders" / "telegram").exists()
    from pathlib import Path
    assert Path(out).stat().st_size <= size // 2 and clip.stat().st_size == size
    assert asyncio.run(tb.telegram_video_file(str(clip))) == out                # cached
