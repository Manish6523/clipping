"""Whisper worker process: loads one faster-whisper model and transcribes jobs sent as JSON lines.

Runs as `python -m src.intelligence.whisper_worker <model> <device> <compute_type>`.
Protocol (one JSON object per line):
  -> {"id": n, "audio": "/path.wav", "beam": 1}
  <- {"ready": true} once after the model loaded, or {"load_error": "..."} (then exits)
  <- {"id": n, "ok": {...result...}} or {"id": n, "error": "..."}

Living in its own process means a hung transcription (CTranslate2/OpenMP deadlocks, stuck model
downloads) can be killed by the parent without taking the app's worker threads or Whisper slots
with it, and two different models never share one process's thread pools.
"""

import json
import sys
from typing import Any, Dict, List


def transcribe_with(model: Any, audio_path: str, beam_size: int) -> Dict[str, Any]:
    segments_generator, info = model.transcribe(
        audio_path,
        word_timestamps=True,
        beam_size=beam_size,
        vad_filter=True,
        vad_parameters=dict(min_silence_duration_ms=400),
    )
    full_text: List[str] = []
    all_words: List[Dict[str, Any]] = []
    segment_list: List[Dict[str, Any]] = []
    for seg in segments_generator:
        segment_list.append({"start": seg.start, "end": seg.end, "text": seg.text.strip()})
        full_text.append(seg.text.strip())
        for w in seg.words or []:
            all_words.append({"word": w.word.strip(), "start": w.start, "end": w.end,
                              "probability": getattr(w, "probability", 1.0)})
    return {"text": " ".join(full_text), "words": all_words, "segments": segment_list,
            "language": info.language, "duration": info.duration}


def main() -> None:
    model_size, device, compute = sys.argv[1], sys.argv[2], sys.argv[3]
    out = sys.stdout
    sys.stdout = sys.stderr            # stray prints from libraries must not corrupt the protocol
    try:
        import av                       # same compatibility shim as src/intelligence/transcriber.py
        _orig = av.open

        def _safe_open(*a, **k):
            k.pop("metadata_errors", None)
            return _orig(*a, **k)
        av.open = _safe_open
    except Exception:
        pass
    try:
        from faster_whisper import WhisperModel
        model = WhisperModel(model_size, device=device, compute_type=compute)
    except Exception as e:
        out.write(json.dumps({"load_error": f"{type(e).__name__}: {e}"}) + "\n")
        out.flush()
        return
    out.write(json.dumps({"ready": True}) + "\n")
    out.flush()
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            job = json.loads(line)
        except ValueError:
            continue
        try:
            res = {"id": job.get("id"), "ok": transcribe_with(model, job["audio"], int(job.get("beam", 1)))}
        except Exception as e:
            res = {"id": job.get("id"), "error": f"{type(e).__name__}: {e}"}
        out.write(json.dumps(res) + "\n")
        out.flush()


if __name__ == "__main__":
    main()
