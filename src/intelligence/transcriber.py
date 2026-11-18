"""Audio transcription and word-level timestamp generator powered by faster-whisper.

All imports placed at the top of the file according to standards.
"""

import asyncio
import time
import sys
import json
import logging
import os
import subprocess
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    import av
    _orig_av_open = av.open
    def _safe_av_open(*args, **kwargs):
        kwargs.pop("metadata_errors", None)
        return _orig_av_open(*args, **kwargs)
    av.open = _safe_av_open
except Exception:
    pass

try:
    from faster_whisper import WhisperModel
    HAS_FASTER_WHISPER = True
except ImportError:
    WhisperModel = None
    HAS_FASTER_WHISPER = False

logger = logging.getLogger(__name__)

_WHISPER_SLOTS: Optional[asyncio.Semaphore] = None


def _whisper_slots() -> asyncio.Semaphore:
    """One Whisper job at a time by default: on a small CPU, parallel jobs only thrash."""
    global _WHISPER_SLOTS
    if _WHISPER_SLOTS is None:
        import config.settings as s
        _WHISPER_SLOTS = asyncio.Semaphore(max(1, int(getattr(s, "WHISPER_CONCURRENCY", 1) or 1)))
    return _WHISPER_SLOTS


class TranscriptionTimeout(RuntimeError):
    pass


class WhisperBusy(RuntimeError):
    """Raised when slot_wait is given and no Whisper slot frees up in time (low-priority callers skip)."""


# One worker process per (model, device, compute) shared by every Transcriber instance.
WORKER_CMD = [sys.executable, "-m", "src.intelligence.whisper_worker"]
MODEL_LOAD_TIMEOUT_S = 900          # first use may download the model
IDLE_SHUTDOWN_S = 900               # free the RAM of models nobody used for 15 min
_SPEED = {"tiny": 0.8, "base": 1.0, "small": 2.0, "medium": 4.0, "large": 8.0, "distil": 2.0, "turbo": 3.0}


def transcribe_timeout(audio_path: str, model_size: str) -> float:
    """Generous ceiling for one job: 2 min + (audio seconds x a per-model factor). A real run is far
    below this; only a hang reaches it. WHISPER_TIMEOUT_FACTOR scales it (slow machines)."""
    try:
        seconds = max(1.0, (os.path.getsize(audio_path) - 44) / 32000.0)     # 16 kHz mono s16 wav
    except OSError:
        seconds = 600.0
    key = next((k for k in _SPEED if k in (model_size or "")), "small")
    factor = float(os.getenv("WHISPER_TIMEOUT_FACTOR", "1") or 1)
    return 120.0 + seconds * _SPEED[key] * 1.5 * factor


class _WhisperProcess:
    def __init__(self, model_size: str, device: str, compute: str):
        self.key = (model_size, device, compute)
        self.proc: Optional[asyncio.subprocess.Process] = None
        self.lock = asyncio.Lock()
        self.next_id = 0
        self.last_used = time.time()

    async def _start(self) -> None:
        model_size, device, compute = self.key
        logger.info("Starting Whisper worker process for '%s' (%s/%s)...", model_size, device, compute)
        self.proc = await asyncio.create_subprocess_exec(
            *WORKER_CMD, model_size, device, compute,
            stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE, stderr=None,
            cwd=str(Path(__file__).resolve().parents[2]), limit=256 * 1024 * 1024,
        )
        try:
            line = await asyncio.wait_for(self.proc.stdout.readline(), timeout=MODEL_LOAD_TIMEOUT_S)
        except asyncio.TimeoutError:
            await self.kill("model load timed out")
            raise RuntimeError(f"Whisper model '{model_size}' did not load within {MODEL_LOAD_TIMEOUT_S}s")
        msg = json.loads(line or b"{}") if line else {}
        if not msg.get("ready"):
            await self.kill("model load failed")
            raise RuntimeError(f"Whisper model '{model_size}' could not be loaded: {msg.get('load_error') or 'worker exited'}")

    async def kill(self, why: str) -> None:
        p, self.proc = self.proc, None
        if p and p.returncode is None:
            logger.warning("Killing Whisper worker '%s': %s", self.key[0], why)
            try:
                p.kill()
                await asyncio.wait_for(p.wait(), timeout=10)
            except Exception:
                pass

    async def run(self, audio_path: str, beam: int, timeout: float) -> Dict[str, Any]:
        async with self.lock:
            if self.proc is None or self.proc.returncode is not None:
                await self._start()
            self.next_id += 1
            job_id = self.next_id
            self.last_used = time.time()
            try:
                self.proc.stdin.write((json.dumps({"id": job_id, "audio": audio_path, "beam": beam}) + "\n").encode())
                await self.proc.stdin.drain()
                while True:
                    line = await asyncio.wait_for(self.proc.stdout.readline(), timeout=timeout)
                    if not line:
                        raise RuntimeError("Whisper worker exited during transcription (out of memory?)")
                    msg = json.loads(line)
                    if msg.get("id") == job_id:
                        break
            except asyncio.TimeoutError:
                await self.kill(f"no result after {timeout:.0f}s")
                raise TranscriptionTimeout(f"Whisper '{self.key[0]}' gave no result within {timeout:.0f}s (worker restarted)")
            except asyncio.CancelledError:
                await self.kill("caller cancelled")       # a half-finished job must not answer the next one
                raise
            except Exception:
                await self.kill("protocol error")
                raise
            finally:
                self.last_used = time.time()
            if "error" in msg:
                raise RuntimeError(f"Whisper failed: {msg['error']}")
            return msg["ok"]


_WORKERS: Dict[tuple, _WhisperProcess] = {}


def _worker_for(model_size: str, device: str, compute: str) -> _WhisperProcess:
    now = time.time()
    for k, w in list(_WORKERS.items()):          # retire idle models
        if k != (model_size, device, compute) and not w.lock.locked() and w.proc and now - w.last_used > IDLE_SHUTDOWN_S:
            asyncio.ensure_future(w.kill("idle"))
            _WORKERS.pop(k, None)
    key = (model_size, device, compute)
    if key not in _WORKERS:
        _WORKERS[key] = _WhisperProcess(*key)
    return _WORKERS[key]


def whisper_status() -> List[Dict[str, Any]]:
    return [{"model": k[0], "running": bool(w.proc and w.proc.returncode is None), "busy": w.lock.locked(),
             "idle_s": round(time.time() - w.last_used)} for k, w in _WORKERS.items()]


class Transcriber:
    """Extracts high-precision word timestamps using faster-whisper."""

    def __init__(self, model_size: Optional[str] = None, device: str = "auto", compute_type: str = "auto",
                 model_setting: str = "WHISPER_MODEL", beam_size: int = 5):
        # model_size=None follows config.settings.<model_setting> (changeable at runtime from Settings).
        self._fixed_model_size = model_size
        self._model_setting = model_setting
        self.beam_size = max(1, int(beam_size))
        self.device = device
        self.compute_type = compute_type
        self._model = None
        self._loaded_size: Optional[str] = None

    @property
    def model_size(self) -> str:
        if self._fixed_model_size:
            return self._fixed_model_size
        import config.settings as s
        return getattr(s, self._model_setting, None) or getattr(s, "WHISPER_MODEL", "small") or "small"

    def _get_model(self):
        """Lazy loader for faster-whisper WhisperModel with cached instance."""
        if self._model is not None and self._model != "fallback" and self._loaded_size != self.model_size:
            logger.info("Whisper model changed %s -> %s; reloading.", self._loaded_size, self.model_size)
            self._model = None
        if self._model is None:
            self._loaded_size = self.model_size
            if not HAS_FASTER_WHISPER or WhisperModel is None:
                logger.warning("faster-whisper not installed. Falling back to basic extractor.")
                self._model = "fallback"
                return self._model

            dev = self.device
            comp = self.compute_type
            if dev == "auto":
                dev = "cpu"
                comp = "int8"
            logger.info("Loading faster-whisper model '%s' on %s (%s)...", self.model_size, dev, comp)
            try:
                self._model = WhisperModel(self.model_size, device=dev, compute_type=comp)
            except Exception as e:
                logger.error("Failed to load faster-whisper model: %s", e)
                self._model = "fallback"

        return self._model

    async def extract_audio_wav(self, video_path: str, output_wav: Optional[str] = None) -> str:
        """Extract 16kHz mono PCM audio from video file using FFmpeg."""
        if "://" in str(video_path):
            raise RuntimeError(f"Expected a downloaded media file, got a URL: {video_path}")
        v_path = Path(video_path)
        if not v_path.is_file():
            raise RuntimeError(f"Media file not found for transcription: {v_path}")
        if output_wav is None:
            output_wav = str(v_path.parent / f"{v_path.stem}_audio.wav")

        cmd = [
            "ffmpeg", "-y",
            "-i", str(v_path),
            "-vn",
            "-acodec", "pcm_s16le",
            "-ar", "16000",
            "-ac", "1",
            str(output_wav),
        ]

        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _out, err = await proc.communicate()
        if proc.returncode != 0 or not Path(output_wav).is_file() or Path(output_wav).stat().st_size == 0:
            tail = (err or b"").decode(errors="ignore").strip().splitlines()[-1:] or ["no output"]
            raise RuntimeError(f"Audio extraction failed for {v_path.name}: {tail[0][:200]}")
        return output_wav

    async def transcribe(self, audio_or_video_path: str, slot_wait: Optional[float] = None) -> Dict[str, Any]:
        """
        Transcribe media and return structured word-level timestamps.

        The Whisper slot is taken here and nowhere else (callers must not hold one: nesting deadlocks).
        slot_wait: give up with WhisperBusy if no slot frees within this many seconds (None = wait).
        """
        path = str(audio_or_video_path)
        if not path.endswith(".wav"):
            audio_path = await self.extract_audio_wav(path)
        else:
            audio_path = path

        if not HAS_FASTER_WHISPER:
            raise RuntimeError("faster-whisper is not installed on this server")
        dev, comp = self.device, self.compute_type
        if dev == "auto":
            dev, comp = "cpu", "int8"
        size = self.model_size
        timeout = transcribe_timeout(audio_path, size)
        worker = _worker_for(size, dev, comp)
        slots = _whisper_slots()
        if slot_wait is None:
            await slots.acquire()
        else:
            try:
                await asyncio.wait_for(slots.acquire(), timeout=slot_wait)
            except asyncio.TimeoutError:
                raise WhisperBusy("all Whisper slots are busy")
        try:
            result = await worker.run(audio_path, self.beam_size, timeout)
        finally:
            slots.release()
        self._loaded_size = size

        # Persist full transcript words to data/transcripts/{source_id}.json
        try:
            from config.settings import DATA_DIR
            transcripts_dir = Path(DATA_DIR) / "transcripts"
            transcripts_dir.mkdir(parents=True, exist_ok=True)
            stem_name = Path(audio_or_video_path).stem
            out_path = transcripts_dir / f"{stem_name}.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(result, f, indent=2)
        except Exception as e:
            logger.warning("Failed to persist transcript json: %s", e)

        if audio_path != path and os.path.exists(audio_path):
            try:
                os.unlink(audio_path)
            except Exception:
                pass

        return result
