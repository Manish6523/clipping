"""Home fetch helper, end to end: real server endpoints + the real helper class on a local port.
Only yt-dlp itself is faked (the helper's subprocess call)."""
import asyncio
import importlib.util
import socket
import subprocess
import threading
import time
from pathlib import Path

import pytest
from aiohttp import web

from src.monitor import remote_fetch as rf
from src.monitor import ytdlp

spec = importlib.util.spec_from_file_location("fetch_helper", Path(__file__).parent.parent / "tools" / "fetch_helper.py")
helper_mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper_mod)

TOKEN = "t0ken"


def test_allowlists_match_and_refuse_dangerous_jobs():
    assert helper_mod.ALLOWED_VALUE_OPTS == rf.ALLOWED_VALUE_OPTS and helper_mod.ALLOWED_FLAGS == rf.ALLOWED_FLAGS
    ok = ["-f", "ba", "--download-sections", "*0-60", "--force-keyframes-at-cuts", "--output", "audio_chunk_001.%(ext)s",
          "https://www.youtube.com/watch?v=x"]
    for check in (rf.check_args, helper_mod.check_args):
        assert check(ok) is None
        assert "not allowed" in check(["--exec", "rm -rf ~", "https://youtu.be/x"])
        assert "not allowed" in check(["--config-location", "/etc/x", "https://youtu.be/x"])
        assert "bare file name" in check(["-o", "../../.bashrc", "https://youtu.be/x"])
        assert "bare file name" in check(["-o", "/tmp/x", "https://youtu.be/x"])
        assert "one http" in check(["--simulate"])
        assert "not allowed" in check(["https://youtu.be/x", "file:///etc/passwd"])


def _free_port():
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


@pytest.fixture
def server(monkeypatch):
    from src.web.server import WebUIServer
    fetcher = rf.RemoteFetcher()
    monkeypatch.setattr(rf, "FETCHER", fetcher)

    async def tok(create=True):
        return TOKEN
    monkeypatch.setattr(rf, "get_token", tok)
    srv = WebUIServer.__new__(WebUIServer)
    return srv, fetcher


def _fake_yt_dlp(monkeypatch, refuse_url=None):
    seen = []

    def fake_run(cmd, cwd, capture_output, timeout):
        seen.append(cmd)
        args = cmd[cmd.index("--paths") + 2:]
        if refuse_url and refuse_url in args:
            return subprocess.CompletedProcess(cmd, 1, b"", b"ERROR: [youtube] x: Video unavailable. This video is private")
        if "--output" in args:
            name = args[args.index("--output") + 1].replace("%(ext)s", "webm")
            (Path(cwd) / name).write_bytes(b"audio" * 1000)
            (Path(cwd) / (name + ".part")).write_bytes(b"junk")
        return subprocess.CompletedProcess(cmd, 0, b'{"duration": 3600}', b"")
    monkeypatch.setattr(helper_mod.subprocess, "run", fake_run)
    return seen


async def _with_app(srv, body):
    app = web.Application()
    app.router.add_get("/api/fetcher/next", srv.handle_fetcher_next)
    app.router.add_post("/api/fetcher/result/{job_id}", srv.handle_fetcher_result)
    runner = web.AppRunner(app, shutdown_timeout=0.5)
    await runner.setup()
    port = _free_port()
    await web.TCPSite(runner, "127.0.0.1", port).start()
    try:
        return await body(f"http://127.0.0.1:{port}")
    finally:
        await runner.cleanup()


def _start_helper(url, token=TOKEN):
    h = helper_mod.Helper(url, token, workers=2, name="test-pc")
    threading.Thread(target=h.loop, daemon=True).start()
    return h


def test_jobs_run_on_the_helper_and_files_land_in_place(server, monkeypatch, tmp_path):
    srv, fetcher = server
    seen = _fake_yt_dlp(monkeypatch, refuse_url="https://youtu.be/private")
    monkeypatch.setattr(ytdlp, "_exec", lambda *a, **k: pytest.fail("server must not run yt-dlp itself"))

    async def body(url):
        _start_helper(url)
        for _ in range(100):
            if fetcher.online():
                break
            await asyncio.sleep(0.05)
        assert fetcher.online() and fetcher.info["name"] == "test-pc"
        dest = tmp_path / "vods" / "manual_1"
        rc, out, err = await ytdlp.run(["-f", "ba", "--download-sections", "*0-10800",
                                        "--output", str(dest / "audio_extract.%(ext)s"), "https://youtu.be/x"], timeout=60)
        assert rc == 0 and sorted(p.name for p in dest.iterdir()) == ["audio_extract.webm"]
        rc, out, _ = await ytdlp.run(["--dump-json", "--skip-download", "https://youtu.be/x"], timeout=60)
        assert rc == 0 and out == b'{"duration": 3600}'
        rc, _, err = await ytdlp.run(["--simulate", "https://youtu.be/private"], timeout=60)
        assert rc == 1 and "private" in err                       # a real answer is returned, not retried
        return True
    assert asyncio.run(asyncio.wait_for(_with_app(srv, body), 20))
    assert all("--cookies" not in c and "--paths" in c for c in seen)
    assert fetcher.status()["done"] == 2 and fetcher.status()["failed"] == 1


def test_wrong_token_never_gets_jobs_and_server_falls_back(server, monkeypatch):
    srv, fetcher = server
    _fake_yt_dlp(monkeypatch)
    direct = []

    async def fake_exec(cmd, timeout):
        direct.append(cmd)
        return 0, b"direct", ""
    monkeypatch.setattr(ytdlp, "_exec", fake_exec)
    real_sleep = time.sleep
    monkeypatch.setattr(helper_mod.time, "sleep", lambda s: real_sleep(min(s, 0.05)))

    async def body(url):
        _start_helper(url, token="wrong")
        await asyncio.sleep(0.5)
        assert not fetcher.online()
        return await ytdlp.run(["--simulate", "https://youtu.be/x"], timeout=10)
    rc, out, _ = asyncio.run(asyncio.wait_for(_with_app(srv, body), 20))
    assert rc == 0 and out == b"direct" and len(direct) == 1
