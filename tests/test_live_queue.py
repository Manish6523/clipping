"""Live moments on a small VPS: strict triggers, GC-proof queue, newest-per-streamer, stale drop."""

import asyncio
import sys
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import config.settings as settings  # noqa: E402
from src.monitor import live_watcher as lw  # noqa: E402


class Clock:
    def __init__(self, t=1_000_000.0):
        self.t = t

    def __call__(self):
        return self.t


def make_watcher(monkeypatch, clock):
    monkeypatch.setattr(lw.time, "time", clock)
    w = lw.LiveStreamWatcher(channel_id="t_streamer", platform="twitch",
                             template_config={"hype_keywords": ["W", "LMAO", "CLIP IT"]})
    w._is_channel_live = True
    fired = []

    async def fake_handle(reason, trigger_context=None, chat_features=None):
        fired.append(trigger_context)
    monkeypatch.setattr(w, "_handle_hype_event", fake_handle)
    return w, fired


async def chat(w, clock, n, per_sec, text="just chatting"):
    for _ in range(n):
        clock.t += 1.0 / per_sec
        await w._on_chat_message(text)
    await asyncio.sleep(0)


def test_single_keyword_in_normal_chat_does_not_trigger(monkeypatch):
    clock = Clock()
    w, fired = make_watcher(monkeypatch, clock)

    async def go():
        await chat(w, clock, 300, 2)                    # 150 s of steady 2 msg/s -> baseline
        await chat(w, clock, 10, 2, "W")                # keywords, but chat is NOT faster than usual
        await chat(w, clock, 20, 2)
    asyncio.run(go())
    assert fired == []


def test_keyword_burst_with_faster_chat_triggers(monkeypatch):
    clock = Clock()
    w, fired = make_watcher(monkeypatch, clock)

    async def go():
        await chat(w, clock, 300, 2)
        await chat(w, clock, 15, 4, "W W W")            # 2x faster + many keyword msgs
    asyncio.run(go())
    assert len(fired) == 1 and fired[0]["type"] == "keyword_hit" and fired[0]["keyword_hits_5s"] >= 3


def test_velocity_spike_triggers_and_cooldown_holds(monkeypatch):
    clock = Clock()
    w, fired = make_watcher(monkeypatch, clock)

    async def go():
        await chat(w, clock, 300, 2)
        await chat(w, clock, 40, 8)                     # 4x baseline, no keywords
        clock.t += 60
        await chat(w, clock, 40, 8)                     # still inside the cooldown
    asyncio.run(go())
    assert len(fired) == 1 and fired[0]["type"] == "chat_spike"
    assert w.cooldown_seconds == settings.LIVE_TRIGGER_COOLDOWN_S


# ---------------------------------------------------------------------------
# Queue
# ---------------------------------------------------------------------------

@pytest.fixture
def engine(tmp_path, monkeypatch):
    import main
    monkeypatch.setattr(settings, "LIVE_QUEUE_DIR", tmp_path / "queue")
    (tmp_path / "queue").mkdir()
    eng = main.AutoClipEngine.__new__(main.AutoClipEngine)   # no heavy init (models, bot, web)
    eng._live_pending = {}
    eng._live_wakeup = asyncio.Event()
    eng._live_worker_task = None
    eng._live_busy = False
    eng.running = True
    eng.processed = []
    return eng


def highlight(tmp_path, name):
    buf = tmp_path / "tmp" / "live_buffer"
    buf.mkdir(parents=True, exist_ok=True)
    f = buf / name
    f.write_bytes(b"video")
    return f


def test_moment_is_moved_out_of_gc_reach_and_newest_wins(engine, tmp_path):
    async def go():
        gate = asyncio.Event()

        async def process(path, meta):
            engine.processed.append((Path(path).name, Path(path).exists()))
            await gate.wait()
        engine._process_live_moment = process

        a1 = highlight(tmp_path, "highlight_1.mp4")
        await engine._on_live_moment(str(a1), {"channel_id": "a", "timestamp": time.time()})
        await asyncio.sleep(0.01)                                   # a1 is being processed (busy)
        assert not a1.exists()                                      # moved out of tmp/
        b1 = highlight(tmp_path, "highlight_2.mp4")
        b2 = highlight(tmp_path, "highlight_3.mp4")
        await engine._on_live_moment(str(b1), {"channel_id": "b", "timestamp": time.time()})
        await engine._on_live_moment(str(b2), {"channel_id": "b", "timestamp": time.time()})
        queue = tmp_path / "queue"
        assert not (queue / "b_highlight_2.mp4").exists()           # replaced by the newer one
        assert (queue / "b_highlight_3.mp4").exists()
        gate.set()
        await asyncio.sleep(0.05)
        engine.running = False
        engine._live_wakeup.set()
        await asyncio.sleep(0.01)
        return [n for n, _ in engine.processed], all(e for _, e in engine.processed)

    names, existed = asyncio.run(go())
    assert names == ["a_highlight_1.mp4", "b_highlight_3.mp4"] and existed
    assert list((tmp_path / "queue").glob("*.mp4")) == []           # cleaned up after processing


def test_stale_moment_is_dropped(engine, tmp_path, monkeypatch):
    monkeypatch.setattr(settings, "LIVE_MAX_MOMENT_AGE_S", 600)

    async def go():
        async def process(path, meta):
            engine.processed.append(path)
        engine._process_live_moment = process
        f = highlight(tmp_path, "highlight_old.mp4")
        await engine._on_live_moment(str(f), {"channel_id": "a", "timestamp": time.time() - 1200})
        await asyncio.sleep(0.05)
        engine.running = False
        engine._live_wakeup.set()
        await asyncio.sleep(0.01)
    asyncio.run(go())
    assert engine.processed == []
    assert list((tmp_path / "queue").glob("*.mp4")) == []


def test_kept_source_is_not_deleted(engine, tmp_path):
    async def go():
        async def process(path, meta):
            meta["_keep_file"] = True                               # clip points at the queued file
        engine._process_live_moment = process
        f = highlight(tmp_path, "highlight_keep.mp4")
        await engine._on_live_moment(str(f), {"channel_id": "a", "timestamp": time.time()})
        await asyncio.sleep(0.05)
        engine.running = False
        engine._live_wakeup.set()
        await asyncio.sleep(0.01)
    asyncio.run(go())
    assert (tmp_path / "queue" / "a_highlight_keep.mp4").exists()


def test_live_transcriber_uses_live_model(monkeypatch):
    from src.intelligence.transcriber import Transcriber
    monkeypatch.setattr(settings, "LIVE_WHISPER_MODEL", "tiny")
    monkeypatch.setattr(settings, "WHISPER_MODEL", "small")
    live = Transcriber(model_setting="LIVE_WHISPER_MODEL", beam_size=1)
    assert live.model_size == "tiny" and live.beam_size == 1
    assert Transcriber().model_size == "small"
