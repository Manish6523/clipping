"""Whisper runs in a killable worker process: hangs time out, the slot is freed, the worker restarts."""
import asyncio
import os
import subprocess
import sys
import textwrap
from pathlib import Path

import pytest

from src.intelligence import transcriber as tr

FAKE = textwrap.dedent('''
    import json, sys, time
    mode = open(sys.argv[4]).read().strip() if len(sys.argv) > 4 else "ok"
    print(json.dumps({"ready": True}), flush=True)
    for line in sys.stdin:
        job = json.loads(line)
        mode = open(sys.argv[4]).read().strip()
        if mode == "hang":
            time.sleep(3600)
        if mode == "crash":
            sys.exit(3)
        print(json.dumps({"id": job["id"], "ok": {"text": "hi", "words": [], "segments": [], "language": "en", "duration": 1.0}}), flush=True)
''')


@pytest.fixture
def fake_worker(tmp_path, monkeypatch):
    script = tmp_path / "fake_worker.py"
    script.write_text(FAKE)
    mode = tmp_path / "mode"
    mode.write_text("ok")
    wav = tmp_path / "a.wav"
    wav.write_bytes(b"\0" * (44 + 32000))
    # extra argv after model/device/compute: the mode file
    monkeypatch.setattr(tr, "WORKER_CMD", [sys.executable, str(script)])
    monkeypatch.setattr(tr, "_WORKERS", {})
    monkeypatch.setattr(tr, "_WHISPER_SLOTS", None)
    orig_start = tr._WhisperProcess._start

    async def start(self):
        self.key = (self.key[0], self.key[1], f"{self.key[2]}")
        cmd = tr.WORKER_CMD
        self.proc = await asyncio.create_subprocess_exec(*cmd, *self.key, str(mode), stdin=asyncio.subprocess.PIPE,
                                                         stdout=asyncio.subprocess.PIPE)
        await self.proc.stdout.readline()
    monkeypatch.setattr(tr._WhisperProcess, "_start", start)
    return mode, wav


def test_hang_times_out_frees_slot_and_restarts(fake_worker):
    mode, wav = fake_worker

    async def go():
        w = tr._worker_for("tiny", "cpu", "int8")
        assert (await w.run(str(wav), 1, timeout=5))["text"] == "hi"
        first_pid = w.proc.pid
        mode.write_text("hang")
        with pytest.raises(tr.TranscriptionTimeout):
            await w.run(str(wav), 1, timeout=1)
        assert w.proc is None and not w.lock.locked()                 # killed, lock released
        mode.write_text("ok")
        assert (await w.run(str(wav), 1, timeout=5))["text"] == "hi"   # fresh worker
        assert w.proc.pid != first_pid
        mode.write_text("crash")
        with pytest.raises(RuntimeError, match="exited"):
            await w.run(str(wav), 1, timeout=5)
        await w.kill("test done")
    asyncio.run(go())


def test_cancel_kills_worker(fake_worker):
    mode, wav = fake_worker

    async def go():
        w = tr._worker_for("tiny", "cpu", "int8")
        mode.write_text("hang")
        task = asyncio.ensure_future(w.run(str(wav), 1, timeout=60))
        await asyncio.sleep(0.5)
        task.cancel()
        with pytest.raises(asyncio.CancelledError):
            await task
        assert w.proc is None and not w.lock.locked()
    asyncio.run(go())


def test_timeout_scales_with_audio_and_model(tmp_path):
    wav = tmp_path / "a.wav"
    wav.write_bytes(b"\0" * (44 + 32000 * 75))            # 75 s
    small = tr.transcribe_timeout(str(wav), "small")
    assert 300 < small < 400
    assert tr.transcribe_timeout(str(wav), "medium") > small > tr.transcribe_timeout(str(wav), "base")


SRC = Path("data/sources/live_caseoh__1794807785_source.mp4")


@pytest.mark.skipif(not SRC.exists(), reason="needs a real stream clip")
def test_real_worker_transcribes(tmp_path, monkeypatch):
    import config.settings as cfg
    monkeypatch.setattr(tr, "_WORKERS", {})
    monkeypatch.setattr(tr, "_WHISPER_SLOTS", None)
    monkeypatch.setattr(cfg, "DATA_DIR", tmp_path)          # transcripts are persisted under DATA_DIR
    clip = tmp_path / "c.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-ss", "10", "-t", "15", "-i", str(SRC), "-c", "copy", str(clip)], check=True)

    async def go():
        t = tr.Transcriber(model_size="base", beam_size=1)
        res = await t.transcribe(str(clip))
        for w in list(tr._WORKERS.values()):
            await w.kill("test done")
        return res
    res = asyncio.run(go())
    assert len(res["words"]) > 5 and res["language"] == "en"
