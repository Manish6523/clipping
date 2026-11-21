"""Quality check of a finished vertical clip (1080x1920), run right after auto edit renders it.

  * captions_over_face - the caption band sits on the streamer's face in most frames that show
    captions -> a better caption height is suggested (auto edit re-finishes with it)
  * audio_clipping     - peaks at 0 dBFS -> auto edit re-finishes with quieter sound effects
  * black_frames       - >= 0.4 s of black (bad crop, stream transition)
  * frozen_video       - >= 2 s without any change
  * too_quiet / silence - mean level very low / 2.5 s+ of silence

Every check fails open: a tool problem never fails the render.
"""

from __future__ import annotations

import asyncio
import logging
import re
import statistics
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

W, H = 1080, 1920
CAPTION_BAND = 150          # px half-height of the caption block around its centre line
SAFE_LOW, SAFE_HIGH = 0.84, 0.60


async def _ffmpeg_log(args: Sequence[str], timeout: float = 120) -> str:
    proc = await asyncio.create_subprocess_exec("ffmpeg", "-hide_banner", "-nostats", *args, "-f", "null", "-",
                                                stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    try:
        _, err = await asyncio.wait_for(proc.communicate(), timeout)
    except asyncio.TimeoutError:
        proc.kill()
        return ""
    return (err or b"").decode(errors="ignore")


def parse_black(log: str) -> List[Dict[str, float]]:
    return [{"start": float(a), "end": float(b), "dur": float(c)}
            for a, b, c in re.findall(r"black_start:([\d.]+) black_end:([\d.]+) black_duration:([\d.]+)", log)]


def parse_freeze(log: str) -> List[float]:
    return [float(x) for x in re.findall(r"freeze_duration: ([\d.]+)", log)]


def parse_volume(log: str) -> Dict[str, Optional[float]]:
    mx = re.search(r"max_volume: (-?[\d.]+) dB", log)
    mean = re.search(r"mean_volume: (-?[\d.]+) dB", log)
    return {"max": float(mx.group(1)) if mx else None, "mean": float(mean.group(1)) if mean else None}


def parse_silence(log: str) -> List[float]:
    return [float(x) for x in re.findall(r"silence_duration: ([\d.]+)", log)]


async def _frames(video: str, times: Sequence[float]) -> List[Any]:
    import numpy as np
    out = []
    for t in times:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1", "-vf", "scale=540:960",
            "-f", "rawvideo", "-pix_fmt", "bgr24", "-", stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        data, _ = await proc.communicate()
        if len(data) >= 540 * 960 * 3:
            out.append(np.frombuffer(data[: 540 * 960 * 3], dtype=np.uint8).reshape(960, 540, 3))
    return out


def caption_fix(faces_per_frame: Sequence[Sequence[Sequence[float]]], caption_y: float) -> Optional[float]:
    """faces as (cx, cy, w, h) in 1080x1920 px. A new caption y (0-1) if the band covers a face in
    most frames, else None."""
    band_c = caption_y * H
    hits, boxes = 0, []
    for faces in faces_per_frame:
        over = [f for f in faces if f[3] > 60 and abs(f[1] - band_c) < CAPTION_BAND + f[3] / 2]
        if over:
            hits += 1
            boxes.append(max(over, key=lambda f: f[2] * f[3]))
    if not faces_per_frame or hits < max(2, len(faces_per_frame) * 0.5):
        return None
    top = statistics.median(f[1] - f[3] / 2 for f in boxes) / H
    bottom = statistics.median(f[1] + f[3] / 2 for f in boxes) / H
    below = bottom + CAPTION_BAND / H + 0.02
    above = top - CAPTION_BAND / H - 0.02
    if below <= SAFE_LOW + 0.04:
        return round(min(SAFE_LOW, max(below, 0.5)), 3)
    if above >= 0.18:
        return round(max(0.18, min(above, SAFE_HIGH)), 3)
    return None


async def check(video: str | Path, caption_y: Optional[float] = None, caption_times: Sequence[float] = (),
                duration: Optional[float] = None) -> Dict[str, Any]:
    """{"issues": [{"code", "severity", "note", ...}], "caption_y": new y or None}"""
    video = str(video)
    issues: List[Dict[str, Any]] = []
    new_y = None
    try:
        vlog, alog = await asyncio.gather(
            _ffmpeg_log(["-i", video, "-vf", "blackdetect=d=0.4:pix_th=0.08,freezedetect=n=-60dB:d=2", "-an"]),
            _ffmpeg_log(["-i", video, "-af", "volumedetect,silencedetect=n=-45dB:d=2.5", "-vn"]))
        black = parse_black(vlog)
        if black:
            worst = max(black, key=lambda b: b["dur"])
            issues.append({"code": "black_frames", "severity": "medium",
                           "note": f"{worst['dur']:.1f}s of black at {worst['start']:.1f}s"})
        frozen = parse_freeze(vlog)
        if frozen:
            issues.append({"code": "frozen_video", "severity": "low", "note": f"picture frozen for {max(frozen):.1f}s"})
        vol = parse_volume(alog)
        if vol["max"] is not None and vol["max"] >= -0.3:
            issues.append({"code": "audio_clipping", "severity": "medium", "note": f"audio peaks at {vol['max']:.1f} dB (distortion)"})
        if vol["mean"] is not None and vol["mean"] < -38:
            issues.append({"code": "too_quiet", "severity": "medium", "note": f"very quiet (average {vol['mean']:.0f} dB)"})
        silence = parse_silence(alog)
        if silence:
            issues.append({"code": "silence", "severity": "low", "note": f"{max(silence):.1f}s of silence"})
    except Exception as e:                       # noqa: BLE001
        logger.info("Quality check (ffmpeg) skipped: %s", e)

    if caption_y is not None and caption_times:
        try:
            from src.compositor.face_tracker import _Detector
            det = _Detector()
            if det.available:
                ts = sorted(caption_times)
                pick = [ts[int(i * (len(ts) - 1) / 5)] for i in range(6)] if len(ts) >= 6 else ts
                frames = await _frames(video, pick)
                faces = []
                for f in frames:
                    found = await asyncio.to_thread(det.detect, f)
                    faces.append([(cx * 2, cy * 2, w * 2, h * 2) for cx, cy, w, h, c in found if c >= 0.75])
                new_y = caption_fix(faces, caption_y)
                if new_y is not None:
                    issues.append({"code": "captions_over_face", "severity": "medium",
                                   "note": f"captions covered the face; moved to {round(new_y * 100)}% height", "caption_y": new_y})
        except Exception as e:                   # noqa: BLE001
            logger.info("Quality check (faces) skipped: %s", e)
    return {"issues": issues, "caption_y": new_y}


def summarize(qc: Dict[str, Any], fixed: Sequence[str] = ()) -> Dict[str, Any]:
    left = [i for i in qc.get("issues", []) if i["code"] not in fixed]
    return {"fixed": list(fixed), "issues": [{k: v for k, v in i.items() if k in ("code", "severity", "note")} for i in left],
            "notes": [i["note"] for i in qc.get("issues", []) if i["code"] in fixed]}
