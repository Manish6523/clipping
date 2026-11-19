"""Chunked audio download (YouTube blocking the server): pieces fetched in parallel, a failed
piece retried on its own, joined in order. yt-dlp is faked with ffmpeg-generated tones."""
import asyncio
import subprocess
from pathlib import Path

from src.monitor import vod_watcher as vw, ytdlp


def _tone(path: Path, seconds: float, freq: int):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", f"sine=frequency={freq}:duration={seconds}",
                    "-c:a", "libopus", str(path)], check=True)


def test_audio_is_fetched_in_pieces_and_joined(monkeypatch, tmp_path):
    monkeypatch.setattr(vw, "AUDIO_CHUNK_S", 10)
    monkeypatch.setattr(vw, "BUFFER_DIR", str(tmp_path / "buf"))
    monkeypatch.setattr(ytdlp, "direct_blocked", lambda: True)
    calls, failed_once = [], set()

    async def fake_run(args, timeout=None):
        spec = args[args.index("--download-sections") + 1]
        a, b = (float(x) for x in spec.lstrip("*").split("-"))
        calls.append((a, b, "--force-keyframes-at-cuts" in args))
        if a == 10 and a not in failed_once:                  # second piece: proxy dies the first time
            failed_once.add(a)
            return 1, b"", "ERROR: Unable to connect to proxy"
        out = Path(args[args.index("--output") + 1].replace("%(ext)s", "webm"))
        _tone(out, b - a, 300 + int(a))
        return 0, b"", ""
    monkeypatch.setattr(ytdlp, "run", fake_run)
    out = asyncio.run(vw.VODWatcher().download_audio_first("https://youtu.be/x", tmp_path / "work", duration=25))
    dur = float(subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", out],
                               capture_output=True, text=True).stdout)
    assert abs(dur - 25) < 0.2
    assert sorted({(a, b) for a, b, _ in calls}) == [(0, 10), (10, 20), (20, 25)]
    assert sum(1 for a, _, _ in calls if a == 10) == 2 and all(k for _, _, k in calls)
    assert sorted(p.name for p in (tmp_path / "work").iterdir()) == ["audio_extract.ogg"]
    assert not vw.audio_piece_dir("https://youtu.be/x").exists()          # pieces dropped once joined


def test_short_video_or_direct_access_downloads_in_one_go(monkeypatch, tmp_path):
    monkeypatch.setattr(ytdlp, "direct_blocked", lambda: False)
    seen = []

    async def fake_run(args, timeout=None):
        seen.append(args[args.index("--download-sections") + 1])
        _tone(Path(args[args.index("--output") + 1].replace("%(ext)s", "webm")), 3, 440)
        return 0, b"", ""
    monkeypatch.setattr(ytdlp, "run", fake_run)
    asyncio.run(vw.VODWatcher().download_audio_first("https://youtu.be/x", tmp_path, duration=5000))
    assert seen == [f"*0-{vw.MAX_AUDIO_SECONDS}"]


def test_a_rerun_only_fetches_the_missing_pieces(monkeypatch, tmp_path):
    monkeypatch.setattr(vw, "AUDIO_CHUNK_S", 10)
    monkeypatch.setattr(vw, "AUDIO_CHUNK_TRIES", 1)
    monkeypatch.setattr(vw, "BUFFER_DIR", str(tmp_path / "buf"))
    monkeypatch.setattr(ytdlp, "direct_blocked", lambda: True)
    url = "https://www.youtube.com/live/VQTEruMn7zA?si=abc"
    calls, broken = [], {10.0}

    async def fake_run(args, timeout=None):
        a, b = (float(x) for x in args[args.index("--download-sections") + 1].lstrip("*").split("-"))
        calls.append(a)
        if a in broken:
            return 1, b"", "ERROR: incomplete download through proxy (got 3s of 10s)"
        _tone(Path(args[args.index("--output") + 1].replace("%(ext)s", "webm")), b - a, 400)
        return 0, b"", ""
    monkeypatch.setattr(ytdlp, "run", fake_run)
    monkeypatch.setattr("src.notify.alerts.download_failed", lambda *a, **k: asyncio.sleep(0))
    try:
        asyncio.run(vw.VODWatcher().download_audio_first(url, tmp_path / "w1", duration=30))
        raise AssertionError("should fail")
    except RuntimeError as e:
        assert "1 of 3 pieces failed" in str(e)
    assert vw.audio_piece_dir(url).name == "VQTEruMn7zA"
    calls.clear()
    broken.clear()
    asyncio.run(vw.VODWatcher().download_audio_first(url, tmp_path / "w2", duration=30))
    assert calls == [10.0]                                   # only the missing piece
