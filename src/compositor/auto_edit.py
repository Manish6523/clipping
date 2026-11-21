"""Auto Edit: turns a raw clip into an edited Short (Quick Clip only).

Pipeline per clip
    1. TIGHTEN   plan_segments()  - hook-first start, payoff end, jump-cut dead air & filler
                 cut_segments()   - frame-accurate trim/concat with 12 ms audio fades (no clicks)
    2. LAYOUT    FFmpegRenderer.render_clip() on the tightened source (template, bleeps, speed)
    3. FINISH    finish_clip()    - zoom punch-ins, hook title card, word-pop captions,
                                    whoosh/boom SFX, -14 LUFS loudness

All timing decisions are made from Whisper word timestamps + measured audio energy, so the
edit follows what is actually said and how loudly - no AI call needed (the AI title is only
used as hook-card text when available).
"""

from __future__ import annotations

import asyncio
import logging

from src.compositor.caption_styles import fonts_dir_arg
import os
import re
import statistics
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
SFX_DIR = PROJECT_ROOT / "assets" / "sfx"

FILLERS = {"um", "umm", "uh", "uhh", "uhm", "erm", "er", "hmm", "hm", "mm", "mmm", "ah", "ahh"}
HYPE_WORDS = {
    "no", "what", "wait", "bro", "yo", "insane", "crazy", "wtf", "omg", "lets", "let's", "go", "yes",
    "oh", "god", "dude", "bruh", "nah", "clip", "holy", "huge", "w", "dead", "unreal", "impossible",
}

STYLES: Dict[str, Dict[str, Any]] = {
    # Fast, meme-y: tight cuts, frequent zooms, SFX
    "punchy": {
        "tighten": True, "jump_cuts": True, "remove_fillers": True, "hook_card": True, "zooms": True,
        "sfx": True, "word_pop": True, "loudnorm": True,
        "max_gap": 0.32, "zoom_amount": 0.14, "zoom_every": 4.5, "hook_snap": True,
        "box_zoom_amount": 0.22, "sfx_cuts": True, "sfx_words": True, "cold_open": True, "ai_director": True,
    },
    # Polished: tight cuts, gentle occasional zooms, hook card, no SFX
    "clean": {
        "tighten": True, "jump_cuts": True, "remove_fillers": True, "hook_card": True, "zooms": True,
        "sfx": False, "word_pop": True, "loudnorm": True,
        "max_gap": 0.5, "zoom_amount": 0.07, "zoom_every": 8.0, "hook_snap": False,
        "box_zoom_amount": 0.12, "sfx_cuts": False, "sfx_words": False, "cold_open": False, "ai_director": True,
    },
    # Just trims dead air + loudness
    "minimal": {
        "tighten": True, "jump_cuts": True, "remove_fillers": False, "hook_card": False, "zooms": False,
        "sfx": False, "word_pop": False, "loudnorm": True,
        "max_gap": 0.85, "zoom_amount": 0.0, "zoom_every": 99.0, "hook_snap": False,
    },
}
FEATURE_KEYS = ("tighten", "jump_cuts", "remove_fillers", "hook_card", "zooms", "sfx", "word_pop", "loudnorm", "cold_open", "ai_director")


def resolve_config(opts: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Merge a style preset with explicit per-feature toggles. None/disabled -> None."""
    if not opts or opts is False or (isinstance(opts, dict) and opts.get("enabled") is False):
        return None
    opts = opts if isinstance(opts, dict) else {}
    style = opts.get("style") if opts.get("style") in STYLES else "punchy"
    cfg = dict(STYLES[style])
    cfg["style"] = style
    for k in FEATURE_KEYS:
        if isinstance(opts.get(k), bool):
            cfg[k] = opts[k]
    return cfg


async def effective_auto_edit(explicit: Optional[Dict[str, Any]] = None) -> Optional[Dict[str, Any]]:
    """Auto-edit config for a clip, honouring (in order) an explicit per-request choice, then the Settings default.

    ``explicit`` present (a dict, including ``{"enabled": False}``) always wins; absent/None falls back to the
    dashboard Settings (``auto_edit_enabled`` / ``auto_edit_style`` / ``auto_edit_hook_card``). Used by every
    stream-clip path (live, VOD, manual) so one switch controls them all.
    """
    if isinstance(explicit, dict):
        return resolve_config(explicit)
    from config.settings import AUTO_EDIT_ENABLED, AUTO_EDIT_HOOK_CARD, AUTO_EDIT_STYLE
    from src.database import get_system_setting
    enabled = str(await get_system_setting("auto_edit_enabled", str(AUTO_EDIT_ENABLED))).lower() in ("true", "1", "yes")
    if not enabled:
        return None
    style = await get_system_setting("auto_edit_style", AUTO_EDIT_STYLE)
    hook = str(await get_system_setting("auto_edit_hook_card", str(AUTO_EDIT_HOOK_CARD))).lower() in ("true", "1", "yes")
    return resolve_config({"enabled": True, "style": style, "hook_card": hook})


# ---------------------------------------------------------------------------
# 1. Tighten: plan which source ranges to keep
# ---------------------------------------------------------------------------

def _token(w: Dict[str, Any]) -> str:
    return re.sub(r"[^a-z0-9']", "", (w.get("word") or w.get("text") or "").lower())


def _clean_words(words: Sequence[Dict[str, Any]], dur: float) -> List[Dict[str, Any]]:
    out = []
    for w in words or []:
        if w.get("deleted"):
            continue
        try:
            s, e = float(w.get("start", 0.0)), float(w.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        if e <= 0 or s >= dur:
            continue
        out.append({**w, "start": max(0.0, s), "end": min(dur, max(e, s + 0.05))})
    out.sort(key=lambda w: w["start"])
    return out


def speech_level(energy: Sequence[Tuple[float, float]], words: Sequence[Dict[str, Any]]) -> Optional[float]:
    """Median RMS while words are being spoken (fallback: whole clip)."""
    vals = []
    for w in words or []:
        a, b = float(w["start"]), float(w["end"])
        vals += [v for t, v in energy if a <= t <= b and v > -85]
    vals = vals or [v for _, v in energy if v > -85]
    return statistics.median(vals) if vals else None


def activity_islands(
    energy: Sequence[Tuple[float, float]],
    a: float,
    b: float,
    level: Optional[float],
    join_gap: float,
    pad: float = 0.1,
    window: float = 0.1,
) -> List[Tuple[float, float]]:
    """Ranges inside [a, b] with real sound (>= speech level - 8 dB): a filler, a gunshot, a scream.

    Everything between them is silence/room tone that can be cut. Without energy data the whole
    range is treated as active (never cut blind).
    """
    if b - a <= 0:
        return []
    if not energy or level is None:
        return [(a, b)]
    thr = level - 8.0
    islands: List[Tuple[float, float]] = []
    for t, v in energy:
        if t + window < a or t > b or v < thr:
            continue
        s0, e0 = max(a, t - pad), min(b, t + window + pad)
        if islands and s0 - islands[-1][1] <= join_gap:
            islands[-1] = (islands[-1][0], max(islands[-1][1], e0))
        else:
            islands.append((s0, e0))
    return islands


def plan_segments(
    words: Sequence[Dict[str, Any]],
    dur: float,
    cfg: Dict[str, Any],
    energy: Optional[Sequence[Tuple[float, float]]] = None,
    pad_pre: float = 0.08,
    pad_post: float = 0.14,
    lead_in: float = 0.12,
    tail: float = 0.45,
    min_keep_total: float = 5.0,
) -> List[Tuple[float, float]]:
    """Return (start, end) ranges of the source to keep, in source seconds.

    Keeps every word (minus fillers) plus any non-speech moment that is actually loud, and cuts
    the quiet stretches between them that are longer than ``max_gap``.
    """
    ws = _clean_words(words, dur)
    full = [(0.0, round(dur, 3))]
    if not ws or not (cfg.get("tighten") or cfg.get("jump_cuts")):
        return full

    speech = [w for w in ws if not (cfg.get("remove_fillers") and _token(w) in FILLERS)] or ws
    max_gap = float(cfg.get("max_gap", 0.4)) if cfg.get("jump_cuts") else 1e9
    level = speech_level(energy, speech) if energy else None

    first = max(0.0, speech[0]["start"] - lead_in)
    last = min(dur, speech[-1]["end"] + tail)

    # word ranges
    pieces: List[Tuple[float, float]] = [(max(0.0, w["start"] - pad_pre), min(dur, w["end"] + pad_post)) for w in speech]
    pieces[0] = (min(pieces[0][0], first), pieces[0][1])
    pieces[-1] = (pieces[-1][0], max(pieces[-1][1], last))

    # loud non-speech moments in the intro / pauses / outro
    if cfg.get("tighten"):
        pieces += activity_islands(energy, 0.0, first, level, max_gap) if energy else []
        pieces += activity_islands(energy, last, dur, level, max_gap) if energy else []
    else:
        pieces += [(0.0, first), (last, dur)]
    ordered = sorted(pieces)
    for (s0, e0), (s1, _e1) in zip(ordered, ordered[1:]):
        if s1 - e0 > max_gap:
            pieces += activity_islands(energy, e0, s1, level, max_gap) if energy else [(e0, s1)]

    # merge anything closer than max_gap
    segs: List[Tuple[float, float]] = []
    for s0, e0 in sorted(p for p in pieces if p[1] - p[0] > 0):
        if segs and s0 - segs[-1][1] <= max_gap:
            segs[-1] = (segs[-1][0], max(segs[-1][1], e0))
        else:
            segs.append((s0, e0))
    # absorb slivers (< 0.3s) into the previous segment so cuts never flash
    merged: List[Tuple[float, float]] = []
    for s0, e0 in segs:
        if merged and e0 - s0 < 0.3:
            merged[-1] = (merged[-1][0], e0)
        else:
            merged.append((s0, e0))
    segs = merged

    total = sum(e - s for s, e in segs)
    if total < min(min_keep_total, dur * 0.5):
        return full  # something is off with the transcript; never butcher the clip
    return [(round(s, 3), round(e, 3)) for s, e in segs]


def remap_time(t: float, segments: Sequence[Tuple[float, float]]) -> Optional[float]:
    """Source time -> tightened time (None if t was cut out)."""
    acc = 0.0
    for s, e in segments:
        if s <= t <= e:
            return acc + (t - s)
        acc += e - s
    return None


def remap_words(words: Sequence[Dict[str, Any]], segments: Sequence[Tuple[float, float]]) -> List[Dict[str, Any]]:
    out = []
    for w in words or []:
        try:
            s, e = float(w.get("start", 0.0)), float(w.get("end", 0.0))
        except (TypeError, ValueError):
            continue
        ns = remap_time(s, segments)
        if ns is None:
            continue
        # end: clamp into the segment containing the start
        seg_end_new = None
        acc = 0.0
        for a, b in segments:
            if a <= s <= b:
                seg_end_new = acc + (b - a)
                ne = acc + (min(e, b) - a)
                break
            acc += b - a
        ne = max(ns + 0.05, min(ne, seg_end_new)) if seg_end_new is not None else ns + max(0.05, e - s)
        out.append({**w, "start": round(ns, 3), "end": round(ne, 3)})
    return out


async def has_audio(path: str | Path) -> bool:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    return bool(out.strip())


async def _video_size(path: str | Path) -> Tuple[int, int]:
    """(width, height) of the first video stream, even-rounded; falls back to 1080x1920."""
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        w, h = (int(x) for x in out.decode().strip().split("x")[:2])
        return max(2, w // 2 * 2), max(2, h // 2 * 2)
    except Exception:
        return 1080, 1920


async def cut_multi_source_segments(
    sources_map: Dict[str, str | Path],
    segments: Sequence[Dict[str, Any]],
    out: str | Path,
) -> None:
    """Frame-accurate trim + concat across multiple video source files.
    
    Each segment dict must provide:
      - source_id: key into sources_map (or uses 'default')
      - start: float start time relative to that source's file
      - end: float end time relative to that source's file
    
    12ms audio fades hide all joins seamlessly.
    """
    # Map sources to input indices
    source_keys = list(sources_map.keys())
    input_args = []
    has_audio_map = {}
    for idx, key in enumerate(source_keys):
        src_path = sources_map[key]
        input_args.extend(["-i", str(src_path)])
        has_audio_map[key] = await has_audio(src_path)

    # concat needs identical frame size / SAR / rate: conform every segment to the first source
    width, height = await _video_size(sources_map[source_keys[0]])
    conform = f"scale={width}:{height}:force_original_aspect_ratio=decrease,pad={width}:{height}:(ow-iw)/2:(oh-ih)/2,setsar=1,fps=30,format=yuv420p"

    parts, labels = [], ""
    for i, seg in enumerate(segments):
        sid = seg.get("source_id", source_keys[0])
        s_idx = source_keys.index(sid) if sid in source_keys else 0
        s = float(seg.get("start", 0.0))
        e = float(seg.get("end", s + 1.0))
        d = max(0.05, e - s)

        parts.append(f"[{s_idx}:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS,{conform}[v{i}]")
        labels += f"[v{i}]"

        audio = has_audio_map.get(sid, False)
        if not audio:
            # keep audio on every segment so concat(a=1) lines up: silence for a source with no audio track
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=duration={d:.3f},asetpts=PTS-STARTPTS[a{i}]")
            labels += f"[a{i}]"
        if audio:
            fade = min(0.012, d / 4)
            parts.append(
                f"[{s_idx}:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,"
                f"afade=t=in:d={fade:.3f},afade=t=out:st={max(0.0, d - fade):.3f}:d={fade:.3f}[a{i}]"
            )
            labels += f"[a{i}]"

    n = len(segments)
    all_have_audio = True   # silence is synthesised for audio-less segments above
    parts.append(f"{labels}concat=n={n}:v=1:a={1 if all_have_audio else 0}[vc]" + ("[ac]" if all_have_audio else ""))
    cmd = ["ffmpeg", "-y", "-v", "error", *input_args, "-filter_complex", ";".join(parts), "-map", "[vc]"]
    if all_have_audio:
        cmd += ["-map", "[ac]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(out)]

    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Multi-source auto-edit cut failed: {err.decode(errors='ignore')[-300:]}")


async def cut_segments(src: str | Path, segments: Sequence[Tuple[float, float]], out: str | Path) -> None:
    """Frame-accurate trim + concat of the kept ranges (12 ms audio fades hide the joins)."""
    audio = await has_audio(src)
    parts, labels = [], ""
    for i, (s, e) in enumerate(segments):
        d = max(0.05, e - s)
        parts.append(f"[0:v]trim=start={s:.3f}:end={e:.3f},setpts=PTS-STARTPTS[v{i}]")
        labels += f"[v{i}]"
        if audio:
            fade = min(0.012, d / 4)
            parts.append(
                f"[0:a]atrim=start={s:.3f}:end={e:.3f},asetpts=PTS-STARTPTS,"
                f"afade=t=in:d={fade:.3f},afade=t=out:st={max(0.0, d - fade):.3f}:d={fade:.3f}[a{i}]"
            )
            labels += f"[a{i}]"
    n = len(segments)
    parts.append(f"{labels}concat=n={n}:v=1:a={1 if audio else 0}[vc]" + ("[ac]" if audio else ""))
    cmd = ["ffmpeg", "-y", "-v", "error", "-i", str(src), "-filter_complex", ";".join(parts), "-map", "[vc]"]
    if audio:
        cmd += ["-map", "[ac]", "-c:a", "aac", "-b:a", "192k"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "18", "-pix_fmt", "yuv420p", str(out)]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Auto-edit cut failed: {err.decode(errors='ignore')[-300:]}")


# ---------------------------------------------------------------------------
# 3. Finish: emphasis detection, zooms, hook card, SFX, loudness
# ---------------------------------------------------------------------------

async def audio_energy(path: str | Path, window: float = 0.1) -> List[Tuple[float, float]]:
    """RMS level (dBFS) per `window` seconds."""
    if not await has_audio(path):
        return []
    samples = int(48000 * window)
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-v", "error", "-i", str(path), "-vn",
        "-af", f"aresample=48000,asetnsamples=n={samples}:p=0,astats=metadata=1:reset=1,"
               "ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-",
        "-f", "null", "-",
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    series, t = [], None
    for line in out.decode(errors="ignore").splitlines():
        m = re.search(r"pts_time:([\d.]+)", line)
        if m:
            t = float(m.group(1))
            continue
        m = re.search(r"RMS_level=(-?[\d.]+|-inf)", line)
        if m and t is not None:
            v = m.group(1)
            series.append((t, -90.0 if v == "-inf" else float(v)))
    return series


def _is_hype_word(w: Dict[str, Any]) -> bool:
    raw = (w.get("word") or w.get("text") or "").strip()
    tok = _token(w)
    letters = re.sub(r"[^A-Za-z]", "", raw)
    return ("!" in raw) or (len(letters) >= 3 and letters.isupper()) or tok in HYPE_WORDS


def moment_scores(words: Sequence[Dict[str, Any]], energy: Sequence[Tuple[float, float]]) -> List[Tuple[float, float]]:
    """(time, strength) of punchy moments: sudden loudness rises and hype words."""
    scored: List[Tuple[float, float]] = []
    if energy:
        levels = [v for _, v in energy if v > -80]
        if levels:
            med = statistics.median(levels)
            for i, (t, v) in enumerate(energy):
                prev_v = energy[i - 1][1] if i else v
                # sudden rise well above the clip's typical level
                if v > -32 and v - med >= 6 and v - prev_v >= 2.5:
                    scored.append((t, (v - med) + (v - prev_v)))
    for w in words or []:
        if _is_hype_word(w):
            scored.append((float(w["start"]), 7.0 + (4.0 if "!" in (w.get("word") or "") else 0.0)))
    return scored


def pick_punches(
    words: Sequence[Dict[str, Any]],
    energy: Sequence[Tuple[float, float]],
    dur: float,
    cfg: Dict[str, Any],
    hook_end: float = 2.2,
) -> List[float]:
    """Choose zoom punch-in times (output seconds) at the loudest / most hype moments."""
    if not cfg.get("zooms") or dur < 4:
        return []
    every = float(cfg.get("zoom_every", 6.0))
    max_n = max(1, int(dur / every))
    scored = moment_scores(words, energy)


    scored.sort(key=lambda x: x[1], reverse=True)
    chosen: List[float] = []
    for t, _score in scored:
        if t < hook_end or t > dur - 1.0:
            continue
        if any(abs(t - c) < every * 0.7 for c in chosen):
            continue
        chosen.append(round(t, 2))
        if len(chosen) >= max_n:
            break
    return sorted(chosen)


def _face_center_blocking(path: str, samples: int = 10) -> Optional[Tuple[float, float]]:
    """Average centre (0-1) of the largest face across sampled frames, or None."""
    try:
        import cv2
    except ImportError:
        return None
    cascade_path = os.path.join(cv2.data.haarcascades, "haarcascade_frontalface_default.xml")
    cascade = cv2.CascadeClassifier(cascade_path)
    if cascade.empty():
        return None
    cap = cv2.VideoCapture(str(path))
    try:
        total = int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0)
        if total <= 0:
            return None
        pts = []
        for i in range(samples):
            cap.set(cv2.CAP_PROP_POS_FRAMES, int(total * (i + 0.5) / samples))
            ok, frame = cap.read()
            if not ok:
                continue
            h, w = frame.shape[:2]
            scale = 480.0 / max(h, w)
            small = cv2.resize(frame, (int(w * scale), int(h * scale)))
            gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
            faces = cascade.detectMultiScale(gray, scaleFactor=1.15, minNeighbors=6, minSize=(24, 24))
            if len(faces):
                x, y, fw, fh = max(faces, key=lambda f: f[2] * f[3])
                pts.append(((x + fw / 2) / small.shape[1], (y + fh / 2) / small.shape[0]))
        if len(pts) < max(2, samples // 4):   # not a consistent face -> keep centred zooms
            return None
        return (statistics.median(p[0] for p in pts), statistics.median(p[1] for p in pts))
    finally:
        cap.release()


async def face_center(path: str | Path) -> Optional[Tuple[float, float]]:
    """Optional enhancement: any OpenCV problem just means centred zooms, never a failed render."""
    try:
        return await asyncio.get_running_loop().run_in_executor(None, _face_center_blocking, str(path))
    except Exception as e:
        logger.info("Face targeting unavailable (%s); using centred zooms.", e)
        return None


def zoom_xy(center: Optional[Tuple[float, float]]) -> Tuple[str, str]:
    """zoompan x/y keeping the zoom aimed at ``center`` (0-1) but always inside the frame."""
    if not center:
        return "iw/2-(iw/zoom/2)", "ih/2-(ih/zoom/2)"
    cx, cy = max(0.0, min(1.0, center[0])), max(0.0, min(1.0, center[1]))
    return (f"max(0,min(iw-iw/zoom,{cx:.4f}*iw-iw/zoom/2))",
            f"max(0,min(ih-ih/zoom,{cy:.4f}*ih-ih/zoom/2))")


def zoom_expression(punches: Sequence[float], cfg: Dict[str, Any]) -> Optional[str]:
    """zoompan z(t) for whole-frame zooms: the same smooth punch as box zooms."""
    from src.compositor.edit_plan import zoom_expression as smooth
    amt = float(cfg.get("zoom_amount", 0.1))
    return smooth([{"t": a, "amount": amt} for a in punches], hook_snap=bool(cfg.get("hook_snap")))


def _ass_escape(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def hook_text_lines(text: str, max_chars: int = 20, max_lines: int = 3) -> List[str]:
    words = [w for w in re.sub(r"\s+", " ", text or "").strip().split(" ") if w]
    lines: List[str] = []
    cur = ""
    for w in words:
        if len(cur) + len(w) + (1 if cur else 0) > max_chars and cur:
            lines.append(cur)
            cur = w
        else:
            cur = f"{cur} {w}" if cur else w
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(".,!?") + "…"
    return lines


def add_hook_card(ass_path: str | Path, text: str, font: str, caption_y: float, show_until: float = 2.4) -> None:
    """Append a big pop-in title card (top third, or lower third if captions sit up top)."""
    from src.compositor.caption_styles import resolve_font_name
    lines = hook_text_lines(text.upper())
    if not lines:
        return
    # emphasise the longest word in yellow
    words = " ".join(lines).split(" ")
    key = max(words, key=lambda w: len(re.sub(r"[^A-Z0-9]", "", w))) if words else ""
    body = "\\N".join(
        " ".join(
            ("{\\c&H0015CCFA&}" + _ass_escape(w) + "{\\c&H00FFFFFF&}") if w == key else _ass_escape(w)
            for w in line.split(" ")
        )
        for line in lines
    )
    y = 300 if caption_y >= 0.4 else 1250
    style = (
        f"Style: HookCard,{resolve_font_name(font)},80,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,7,3,8,60,60,0,1"
    )
    event = (
        f"Dialogue: 1,0:00:00.00,0:00:{show_until:05.2f},HookCard,,0,0,0,,"
        f"{{\\an8\\pos(540,{y})\\fscx70\\fscy70\\t(0,140,\\fscx108\\fscy108)\\t(140,240,\\fscx100\\fscy100)\\fad(0,220)}}{body}"
    )
    p = Path(ass_path)
    content = p.read_text(encoding="utf-8")
    lines_out = []
    for line in content.splitlines():
        lines_out.append(line)
        if line.startswith("Style: KineticCaption"):
            lines_out.append(style)
    lines_out.append(event)
    p.write_text("\n".join(lines_out) + "\n", encoding="utf-8")


async def _duration(path: str | Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path),
        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
    out, _ = await proc.communicate()
    try:
        return float(out.decode().strip())
    except ValueError:
        return 0.0


def _layout_layers(template: Dict[str, Any]) -> List[Dict[str, Any]]:
    layout = (template or {}).get("layout") or {}
    if not (layout.get("schema") == 2 or "layers" in layout):
        return []                                      # legacy layouts: whole-frame zoom
    return [l for l in layout.get("layers", []) if l.get("visible", True) and l.get("src")]


async def pick_zoom_layer(template: Dict[str, Any], source: str | Path) -> Optional[Tuple[str, str]]:
    """The box that punches in: a layer that follows the face, else the (smallest) layer whose
    source area shows the face, else the only layer. (layer id, name) or None = zoom the frame."""
    layers = _layout_layers(template)
    if not layers:
        return None
    area = lambda l: float(l["src"].get("w", 1)) * float(l["src"].get("h", 1))
    named = lambda l: (l.get("id") or f"l_{layers.index(l)}", l.get("name") or l.get("id") or "box")
    following = [l for l in layers if (l.get("tracking") or {}).get("mode") == "face"]
    if following:
        return named(min(following, key=area))
    center = None
    try:                                   # YuNet over the clip (same reader as auto template), then Haar
        from src.compositor.quick_layout import find_face
        from src.compositor import auto_template as _at
        dur = await _duration(source)
        face = await find_face(str(source), dur, n=10) if dur else None
        if face:
            center = (face["cx"] / _at.LW, face["cy"] / _at.LH)
    except Exception as e:                 # noqa: BLE001 - optional enhancement
        logger.info("Face finder for box zoom unavailable (%s).", e)
    center = center or await face_center(source)
    if center:
        fx, fy = center
        hits = [l for l in layers if l["src"].get("x", 0) <= fx <= l["src"].get("x", 0) + l["src"].get("w", 1)
                and l["src"].get("y", 0) <= fy <= l["src"].get("y", 0) + l["src"].get("h", 1)]
        if hits:
            return named(min(hits, key=area))
    if len(layers) == 1:
        return named(layers[0])
    return None


# Sound effects: SFX_DIR/<category>/*.wav|mp3 (your own sounds, one picked per use so clips don't
# all sound the same), falling back to the bundled file for that category.
SFX_FALLBACK = {"whoosh": "whoosh.wav", "swish": "whoosh.wav", "hit": "boom.wav", "pop": "pop.wav", "ding": "boop.wav"}


def sfx_file(category: str, seed: int = 0) -> Optional[Path]:
    folder = SFX_DIR / category
    if folder.is_dir():
        files = sorted(f for f in folder.iterdir() if f.suffix.lower() in (".wav", ".mp3", ".ogg", ".m4a"))
        if files:
            return files[seed % len(files)]
    fb = SFX_FALLBACK.get(category)
    return SFX_DIR / fb if fb and (SFX_DIR / fb).is_file() else None


def plan_sfx(punches: Sequence[float], cfg: Dict[str, Any], hook_card: bool, cut_times: Sequence[float] = (),
             words: Sequence[Dict[str, Any]] = (), dur: float = 0.0, seed: int = 0) -> List[Tuple[Path, float, float]]:
    """(file, at seconds, volume) for every sound effect of a clip, all in output time."""
    if not cfg.get("sfx"):
        return []
    out: List[Tuple[Path, float, float]] = []
    taken: List[float] = []

    def add(cat, at, vol, gap=0.5, i=0):
        f = sfx_file(cat, seed + i)
        if f and at >= 0 and (not dur or at < dur - 0.2) and all(abs(at - t) >= gap for t in taken):
            out.append((f, round(at, 3), vol))
            taken.append(at)

    if hook_card:
        add("whoosh", 0.0, 0.35)
    for i, p in enumerate(punches):
        add("hit" if i == 0 else "pop", max(0.0, p - 0.02), 0.45 if i == 0 else 0.3, i=i)
    if cfg.get("sfx_cuts"):
        for i, t in enumerate([t for t in cut_times if t > 0.4][:6]):
            add("swish", max(0.0, t - 0.08), 0.16, gap=0.8, i=i)
    if cfg.get("sfx_words"):
        hype = [w for w in words if _is_hype_word(w) and not w.get("censored")]
        for i, w in enumerate(hype[:3]):
            add("ding", float(w["start"]), 0.22, gap=1.2, i=i)
    return sorted(out, key=lambda x: x[1])


async def probe_fps(path: str | Path) -> float:
    proc = await asyncio.create_subprocess_exec(
        "ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=r_frame_rate",
        "-of", "csv=p=0", str(path), stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
    )
    out, _ = await proc.communicate()
    try:
        num, den = out.decode().strip().split("/")
        fps = float(num) / float(den)
        return fps if 1 <= fps <= 120 else 30.0
    except Exception:
        return 30.0


async def finish_clip(
    base: str | Path,
    out: str | Path,
    ass_path: Optional[str | Path],
    punches: Sequence[float],
    cfg: Dict[str, Any],
    hook_card: bool,
    zoom_center: Optional[Tuple[float, float]] = None,
    frame_zoom: bool = True,
    sfx: Optional[Sequence[Tuple[Path, float, float]]] = None,
) -> None:
    """Zooms + captions/hook card + SFX + loudness on the rendered 1080x1920 base.
    ``frame_zoom=False``: the punches were already applied to one box in the layout render."""
    fps = await probe_fps(base)
    audio = await has_audio(base)
    vf = []
    z = zoom_expression(punches, cfg) if frame_zoom else None
    if z:
        zx, zy = zoom_xy(zoom_center)
        vf.append(f"zoompan=z='{z}':x='{zx}':y='{zy}':d=1:s=1080x1920:fps={fps:.3f}")
    if ass_path and os.path.exists(ass_path):
        esc = str(Path(ass_path).resolve()).replace("\\", "/").replace(":", "\\:")
        vf.append(f"subtitles='{esc}'{fonts_dir_arg()}")
    graph = [f"[0:v]{','.join(vf) if vf else 'null'}[vout]"]

    inputs = ["-i", str(base)]
    if audio:
        mix = ["[0:a]aresample=48000,aformat=channel_layouts=stereo[a0]"]
        labels = ["[a0]"]
        if sfx is None:
            sfx = plan_sfx(punches, cfg, hook_card)
        for i, (path, at, vol) in enumerate(sfx, start=1):
            inputs += ["-i", str(path)]
            mix.append(
                f"[{i}:a]aresample=48000,aformat=channel_layouts=stereo,volume={vol:.2f},"
                f"adelay={int(at * 1000)}:all=1[s{i}]"
            )
            labels.append(f"[s{i}]")
        tail = "loudnorm=I=-14:TP=-1.5:LRA=11" if cfg.get("loudnorm") else "anull"
        if len(labels) > 1:
            mix.append(f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0:duration=first:dropout_transition=0,{tail}[aout]")
        else:
            mix.append(f"[a0]{tail}[aout]")
        graph += mix

    cmd = ["ffmpeg", "-y", "-v", "error", *inputs, "-filter_complex", ";".join(graph), "-map", "[vout]"]
    if audio:
        cmd += ["-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-ar", "48000"]
    cmd += ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", "-pix_fmt", "yuv420p",
            "-movflags", "+faststart", str(out)]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
    _, err = await proc.communicate()
    if proc.returncode != 0:
        raise RuntimeError(f"Auto-edit finishing failed: {err.decode(errors='ignore')[-400:]}")


async def make_thumbnail(video: str | Path, at: float = 1.0) -> None:
    v = Path(video)
    thumb = v.parent / f"{v.stem}_thumb.jpg"
    proc = await asyncio.create_subprocess_exec(
        "ffmpeg", "-y", "-v", "error", "-ss", f"{at:.2f}", "-i", str(v), "-vframes", "1",
        "-vf", "scale=540:960:force_original_aspect_ratio=decrease", "-q:v", "3", str(thumb),
        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
    )
    await proc.communicate()


# ---------------------------------------------------------------------------
# Orchestrator
# ---------------------------------------------------------------------------

async def auto_edit_clip(
    renderer: Any,
    source: str | Path,
    words: Sequence[Dict[str, Any]],
    duration: float,
    template: Dict[str, Any],
    cfg: Dict[str, Any],
    censor_cfg: Optional[Dict[str, Any]],
    out_path: str | Path,
    work_dir: str | Path,
    tag: str,
    hook_text: Optional[str] = None,
    channel_name: Optional[str] = None,
    platform: Optional[str] = None,
    plan: Optional[Dict[str, Any]] = None,
    plan_offset: float = 0.0,
    director: Optional[Any] = None,
) -> Dict[str, Any]:
    """Edit one clip. ``words`` are annotated (censor) and in ``source`` time (0..duration).

    Without ``plan``: tighten, then decide every edit (the automatic plan, or ``director``'s - the
    AI edit director - when given) and render it. With ``plan`` (a stored edit plan, times in the
    clip's source timeline; ``plan_offset`` = where ``source`` starts in it): no re-guessing, the
    render repeats exactly that plan - this is how undo / the editor / re-renders stay faithful.

    Returns {"video", "source", "words", "duration", "summary", "plan"}; ``plan`` is in the clip's
    source timeline (the tightened source when this call tightened).
    """
    from src.compositor import edit_plan as ep
    from src.compositor.ass_generator import generate_ass_subtitles

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)
    anti = template.get("anti_shadowban", {}) or {}
    speed = float(anti.get("speed_multiplier", 1.02) or 1.0)

    # 1. Tighten (only quiet gaps are cut, judged from the source's measured loudness)
    src_energy = await audio_energy(source)
    segments = plan_segments(words, duration, cfg, energy=src_energy) if plan is None else [(0.0, round(duration, 3))]
    if segments == [(0.0, round(duration, 3))]:
        tight_src, tight_words, tight_dur = Path(source), list(words), duration
        t_energy = src_energy
    else:
        tight_src = work / f"{tag}_tight.mp4"
        await cut_segments(source, segments, tight_src)
        tight_words = remap_words(words, segments)
        tight_dur = sum(e - s for s, e in segments)
        t_energy = await audio_energy(tight_src)
    removed = max(0.0, duration - tight_dur)
    cut_times, acc = [], 0.0
    for seg_s, seg_e in segments[:-1]:
        acc += seg_e - seg_s
        cut_times.append(round(acc, 3))

    # 2. The plan (local = this render's timeline, 0..tight_dur)
    layers = _layout_layers(template)
    layer_ids = {(l.get("id") or f"l_{i}") for i, l in enumerate(layers)}
    if plan is None:
        target = None
        if cfg.get("zooms") and cfg.get("zoom_mode", "box") == "box":
            box = await pick_zoom_layer(template, tight_src)
            target = {"layer": box[0], "name": box[1]} if box else None
        punches = pick_punches(tight_words, t_energy, tight_dur, cfg, hook_end=2.2 * speed)
        local = ep.build_plan(cfg, tight_words, tight_dur, punches, moment_scores(tight_words, t_energy),
                              cut_times, target, hook_text, _is_hype_word)
        if director is None and cfg.get("ai_director"):
            from src.intelligence import edit_director
            if await edit_director.enabled():
                director = edit_director.direct
        if director is not None:
            try:
                local = await director(local, tight_words, tight_dur, t_energy, cfg, hook_text) or local
            except Exception as e:                       # noqa: BLE001 - the automatic plan still works
                logger.warning("AI edit director failed for %s (%s); using the automatic plan.", tag, e)
        plan_abs = ep.shift(local, plan_offset)
    else:
        plan_abs = plan
        local = ep.window(plan, plan_offset, plan_offset + tight_dur)
    # the template may have changed since: keep a valid zoom box
    tgt = local.get("zoom_target") or None
    if tgt and tgt.get("layer") not in layer_ids:
        box = await pick_zoom_layer(template, tight_src)
        tgt = {"layer": box[0], "name": box[1]} if box else None
        local["zoom_target"] = plan_abs["zoom_target"] = tgt

    # 3. Cold open: the payoff plays first, then the clip from the start
    co = local.get("cold_open") or {}
    lead = 0.0
    render_src, render_words, render_dur = tight_src, list(tight_words), tight_dur
    if co.get("on"):
        a_, b_ = float(co["start"]), float(co["end"])
        lead = b_ - a_
        render_src = work / f"{tag}_cold.mp4"
        await cut_segments(tight_src, [(a_, b_), (0.0, tight_dur)], render_src)
        teaser = [{**w, "start": round(float(w["start"]) - a_, 3), "end": round(float(w["end"]) - a_, 3)}
                  for w in tight_words if float(w["end"]) > a_ and float(w["start"]) < b_]
        render_words = teaser + [{**w, "start": round(float(w["start"]) + lead, 3), "end": round(float(w["end"]) + lead, 3)}
                                 for w in tight_words]
        render_dur = tight_dur + lead
    at = lambda t: float(t) + lead                         # local -> render-input time

    # 4. Layout render with the smooth zoom on one box (or none -> whole-frame zoom below)
    zooms = [{**z, "t": at(z["t"])} for z in local.get("zooms") or [] if z.get("on", True)]
    layer_zoom = None
    if zooms and tgt:
        z = ep.zoom_expression(zooms, hook_snap=bool(cfg.get("hook_snap")))
        if z:
            layer_zoom = {tgt["layer"]: {"z": z, "fps": await probe_fps(render_src)}}
    base = work / f"{tag}_base.mp4"
    await renderer.render_clip(
        source_path=str(render_src), start_time=0.0, end_time=render_dur, output_path=str(base),
        template=template, ass_path=None, teaser_timestamp=None, include_teaser=False,
        censor_words=render_words, censor_cfg=censor_cfg, words_time_offset=0.0, intermediate=True,
        channel_name=channel_name, platform=platform, layer_zoom=layer_zoom,
    )

    # 5. Captions (emphasis words bigger + coloured), hook card - all in output time
    out_dur = render_dur / speed
    emph = [at(e["t"]) for e in local.get("emphasis") or [] if e.get("on", True)]
    out_words = []
    for w in render_words:
        ow = {**w, "start": round(w["start"] / speed, 3), "end": round(w["end"] / speed, 3)}
        if not ow.get("censored") and any(abs(float(w["start"]) - t) < 0.06 for t in emph):
            ow["emphasis"] = True
        out_words.append(ow)
    ass_path = work / f"{tag}_auto.ass"
    sub_cfg = template.get("subtitles") or template.get("captions") or {}
    generate_ass_subtitles(
        word_timestamps=out_words, output_path=ass_path, template_config=template,
        time_offset=0.0, max_duration=out_dur, censor_cfg=censor_cfg,
    )
    hook = local.get("hook") or {}
    hook_line = (hook.get("text") or "").strip() if hook.get("on") else ""
    hook_used = bool(hook_line)
    hook_style = template.get("hook_style") or "classic"
    if hook_used:
        from src.compositor.profanity import censor_text
        from src.compositor.hook_styles import render_hook_card
        hook_used = render_hook_card(
            ass_path, censor_text(hook_line, censor_cfg) if censor_cfg else hook_line, hook_style,
            caption_y=float((sub_cfg.get("position") or {}).get("y", 0.76)),
            font_override=sub_cfg.get("font_name") or sub_cfg.get("font"),
        )

    # 6. Sound effects from the plan (+ hook whoosh, cold-open rewind / riser)
    seed = sum(ord(ch) for ch in str(tag))
    sfx: List[Tuple[Path, float, float]] = []
    if cfg.get("sfx") or any(x.get("by") == "user" for x in local.get("sfx") or []):
        if hook_used and (f := sfx_file("whoosh", seed)):
            sfx.append((f, 0.0, 0.35))
        if lead and (f := sfx_file("rewind", seed) or sfx_file("whoosh", seed + 1)):
            sfx.append((f, max(0.0, (lead - 0.25) / speed), 0.4))
        if lead and (f := sfx_file("riser", seed)) and float(co["start"]) > 1.6:
            sfx.append((f, at(float(co["start"]) - 1.4) / speed, 0.3))
        for i, it in enumerate(local.get("sfx") or []):
            if not it.get("on", True):
                continue
            f = (SFX_DIR / it["file"]) if it.get("file") and (SFX_DIR / it["file"]).is_file() else sfx_file(it["cat"], seed + i)
            if f:
                sfx.append((f, round(at(it["t"]) / speed, 3), float(it.get("vol", 0.3))))
                for orig in plan_abs.get("sfx") or []:        # remember the exact sound for faithful re-renders
                    if orig.get("id") == it.get("id") and not orig.get("file"):
                        orig["file"] = str(f.relative_to(SFX_DIR)) if f.is_relative_to(SFX_DIR) else f.name
    sfx.sort(key=lambda x: x[1])

    punches_out = [round(z["t"] / speed, 2) for z in zooms]
    center = await face_center(base) if punches_out and not layer_zoom else None
    frame_cfg = {**cfg, "zoom_amount": (zooms[0].get("amount") if zooms else cfg.get("zoom_amount", 0.14))}
    await finish_clip(base, out_path, ass_path, punches_out, frame_cfg, hook_card=hook_used, zoom_center=center,
                      frame_zoom=not layer_zoom, sfx=sfx)
    await make_thumbnail(out_path, at=min(1.0, out_dur / 3))
    for tmp in (base, work / f"{tag}_cold.mp4"):
        try:
            tmp.unlink(missing_ok=True)
        except Exception:
            pass

    counts = ep.summary(local)
    summary = {
        "style": cfg.get("style"),
        "cuts": max(0, len(segments) - 1),
        "removed_seconds": round(removed, 1),
        "zooms": len(zooms),
        "zoom_times": punches_out,
        "zoom_target": f"box: {tgt['name']}" if layer_zoom else ("face" if center else "centre"),
        "emphasis": counts["emphasis"],
        "sfx_count": len(sfx),
        "cold_open": bool(lead),
        "hook_card": hook_used,
        "hook_style": hook_style if hook_used else None,
        "sfx": bool(sfx),
        "plan_by": plan_abs.get("by"),
    }
    logger.info("Auto-edited %s: %s", tag, summary)
    # The same plan on the input's own timeline (callers that keep the UNtightened source, e.g. live)
    plan_input = plan_abs
    if plan is None and len(segments) > 1:
        def back(t: float) -> float:
            acc2 = 0.0
            for s0, e0 in segments:
                if t <= acc2 + (e0 - s0) + 1e-6:
                    return round(s0 + (t - acc2), 3)
                acc2 += e0 - s0
            return round(segments[-1][1], 3)
        plan_input = ep.shift(local, 0.0)
        for key in ("zooms", "emphasis", "sfx"):
            for it in plan_input.get(key) or []:
                it["t"] = round(back(it["t"]) + plan_offset, 3)
        co_in = plan_input.get("cold_open") or {}
        if co_in.get("start") is not None:
            co_in["start"], co_in["end"] = round(back(co_in["start"]) + plan_offset, 3), round(back(co_in["end"]) + plan_offset, 3)
        for orig, mapped in zip(plan_abs.get("sfx") or [], plan_input.get("sfx") or []):
            if orig.get("file"):
                mapped["file"] = orig["file"]
    return {"video": str(out_path), "source": str(tight_src), "words": tight_words,
            "duration": tight_dur, "summary": summary, "plan": plan_abs, "plan_input": plan_input}


def summary_flag(summary: Dict[str, Any]) -> Dict[str, Any]:
    bits = []
    if summary.get("removed_seconds"):
        bits.append(f"-{summary['removed_seconds']}s dead air")
    if summary.get("cuts"):
        bits.append(f"{summary['cuts']} cuts")
    if summary.get("zooms"):
        bits.append(f"{summary['zooms']} zooms")
    if summary.get("hook_card"):
        bits.append("hook card")
    return {"type": "auto_edited", "severity": "low", "note": f"Auto edit ({summary.get('style')}): " + ", ".join(bits or ["polish"]), **summary}


def pick_hook_text(words: Sequence[Dict[str, Any]], max_words: int = 9) -> Optional[str]:
    """Best short line from the transcript to use as the hook card / title when no AI title exists."""
    sentences: List[List[Dict[str, Any]]] = []
    cur: List[Dict[str, Any]] = []
    for w in words or []:
        if w.get("deleted"):
            continue
        cur.append(w)
        raw = (w.get("word") or "").strip()
        if raw.endswith((".", "!", "?")) or len(cur) >= max_words + 4:
            sentences.append(cur)
            cur = []
    if cur:
        sentences.append(cur)

    best, best_score = None, 0.0
    for sent in sentences:
        toks = [(w.get("word") or "").strip() for w in sent]
        toks = [t for t in toks if t and _token({"word": t}) not in FILLERS]
        if not 3 <= len(toks) <= max_words:
            continue
        score = sum(2.0 for w in sent if _is_hype_word(w)) + sum(1.5 for t in toks if "!" in t or "?" in t)
        score += 1.0 if 4 <= len(toks) <= 7 else 0.0
        if score > best_score:
            best, best_score = " ".join(toks), score
    if not best:
        return None
    return best.rstrip(".,").strip()
