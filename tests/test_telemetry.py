"""Live Pulse telemetry: moment lifecycle, watcher snapshot, API payload."""

import asyncio
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.monitor import telemetry  # noqa: E402
from src.monitor.live_watcher import LiveStreamWatcher  # noqa: E402


def setup_function():
    telemetry._MOMENTS.clear()
    telemetry._WATCHERS.clear()


def test_moment_lifecycle_and_limit():
    telemetry.moment_event("a:1", "triggered", "A", note="chat_spike 3x", trigger={"type": "chat_spike"})
    telemetry.moment_event("a:1", "transcribing", note="Whisper 'base'")
    telemetry.moment_event("a:1", "clip", clip_id=7, title="t")
    m = telemetry.get_moments()[0]
    assert m["stage"] == "clip" and m["final"] and m["clip_id"] == 7 and m["channel_id"] == "A"
    assert [x["stage"] for x in m["stages"]] == ["triggered", "transcribing", "clip"]
    telemetry.moment_event(None, "triggered")                      # ignored, no crash
    for i in range(telemetry.MAX_MOMENTS + 10):
        telemetry.moment_event(f"b:{i}", "triggered", "B")
    assert len(telemetry._MOMENTS) == telemetry.MAX_MOMENTS
    assert telemetry.get_moments("a") == []                        # oldest evicted
    assert telemetry.get_moments("b", limit=3)[0]["id"] == f"b:{telemetry.MAX_MOMENTS + 9}"


def test_watcher_snapshot_has_everything():
    w = LiveStreamWatcher(channel_id="Tester", platform="twitch", template_config={"hype_keywords": ["W"]})
    w._is_channel_live = True
    now = time.time()
    w._stream_info = {"title": "hello", "viewers": 10}
    w._series.extend([{"t": now - 4000, "mps": 1}, {"t": now - 10, "mps": 2}])
    asyncio.run(w._on_chat_message("W", user="bob"))
    telemetry.register_watcher(w)
    snap = telemetry.snapshot(series_seconds=600)
    s = snap["streamers"][0]
    assert s["stream"]["title"] == "hello" and s["is_live"]
    assert [p["mps"] for p in s["series"]] == [2]                  # window respected
    assert s["chat"]["feed"][-1]["user"] == "bob" and s["chat"]["feed"][-1]["keyword"]
    assert s["chat"]["active_chatters_5m"] == 1
    for key in ("recording", "engine"):
        assert key in s
    assert s["engine"]["keyword_min_hits"] >= 1 and "cooldown_left" in s["engine"]
    assert {"load", "mem_used_pct", "disk", "whisper"} <= set(snap["system"])
    telemetry.unregister_watcher(w)
    assert telemetry.snapshot()["streamers"] == []


def test_broken_watcher_does_not_break_page():
    class Bad:
        channel_id = "bad"

        def telemetry_snapshot(self, series_seconds):
            raise RuntimeError("boom")
    telemetry.register_watcher(Bad())
    assert telemetry.snapshot()["streamers"][0]["error"] == "boom"


def test_api_payload(tmp_path, monkeypatch):
    import src.database as database
    from src.web.server import WebUIServer
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    asyncio.run(database.init_db())

    async def go():
        async with database.get_db_connection() as db:
            await db.execute("INSERT INTO live_hypes (channel_id, trigger_type, status, virality_score) VALUES ('a', 'chat_spike', 'rejected', 40)")
            await db.commit()

        class Req:
            query = {"minutes": "5"}
        return await WebUIServer.handle_telemetry(None, Req())
    import json
    resp = asyncio.run(go())
    data = json.loads(resp.body)
    assert data["history"][0]["channel_id"] == "a"
    assert data["today"]["a"]["rejected"] == 1
    assert {"streamers", "moments", "queue", "system"} <= set(data)
