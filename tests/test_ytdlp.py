"""yt-dlp runner: VPS-specific failures are explained and never turn a URL into a 'file path'."""

import asyncio
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.monitor import ytdlp  # noqa: E402


@pytest.mark.parametrize("stderr,needle", [
    ("ERROR: [youtube] abc: Sign in to confirm you're not a bot. Use --cookies-from-browser", "cookies"),
    ("WARNING: [youtube] n challenge solving failed: Some formats may be missing", "Deno"),
    ("ERROR: [youtube] abc: Requested format is not available", "yt-dlp[default]"),
    ("ERROR: [youtube] abc: Private video. Sign in if you've been granted access", "private"),
    ("ERROR: [youtube] abc: Video unavailable", "unavailable"),
    ("ERROR: HTTP Error 429: Too Many Requests", "429"),
    ("ERROR: Unsupported URL: https://example.com", "isn't a supported"),
    ("ERROR: something new and strange happened", "something new and strange"),
])
def test_explain(stderr, needle):
    assert needle in ytdlp.explain(stderr)


def test_js_runtime_fallback(monkeypatch):
    paths = {"node": "/usr/bin/node"}
    monkeypatch.setattr(ytdlp.shutil, "which", lambda n: paths.get(n))
    assert ytdlp.js_runtime_args() == ["--js-runtimes", "node:/usr/bin/node"]     # no deno -> node
    paths["deno"] = "/usr/bin/deno"
    assert ytdlp.js_runtime_args() == []                                          # deno is yt-dlp's default
    paths.clear()
    assert ytdlp.js_runtime_args() == []


def test_cookies_used_when_present(tmp_path, monkeypatch):
    monkeypatch.setattr(ytdlp, "DEFAULT_COOKIES", tmp_path / "youtube_cookies.txt")
    monkeypatch.delenv("YTDLP_COOKIES", raising=False)
    assert "--cookies" not in ytdlp.base_args()
    (tmp_path / "youtube_cookies.txt").write_text("# Netscape HTTP Cookie File\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n")
    args = ytdlp.base_args()
    assert args[args.index("--cookies") + 1] == str(tmp_path / "youtube_cookies.txt")


def test_transcriber_refuses_url():
    from src.intelligence.transcriber import Transcriber
    with pytest.raises(RuntimeError, match="got a URL"):
        asyncio.run(Transcriber().extract_audio_wav("https://youtu.be/jJ-zWCw85qA?si=x"))


def test_failed_audio_download_stops_with_explained_error(tmp_path, monkeypatch):
    """The production bug: a failed download used to pass the URL on as if it were the audio file."""
    import src.database as database
    import src.monitor.vod_watcher as vw
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    monkeypatch.setattr(vw, "BUFFER_DIR", tmp_path)
    asyncio.run(database.init_db())

    async def fake_run(args, timeout=None):
        return 1, b"", "ERROR: [youtube] jJ-zWCw85qA: Sign in to confirm you're not a bot."
    monkeypatch.setattr(ytdlp, "run", fake_run)

    got = []
    errors = []
    import src.web.logger_stream as ls
    monkeypatch.setattr(ls, "update_pipeline_progress", lambda *a, **k: errors.append(k.get("error")))

    async def on_ready(audio, meta):
        got.append(audio)

    watcher = vw.VODWatcher(on_vod_clip_ready=on_ready)
    asyncio.run(watcher.process_vod("youtube", "manual", "vid1", "t", "https://youtu.be/jJ-zWCw85qA?si=x", "Bottom Left"))
    assert got == []                                    # never handed a URL to the transcriber
    assert errors and "confirm you're not a bot" in errors[-1]
