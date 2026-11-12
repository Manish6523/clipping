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
    },
    # Polished: tight cuts, gentle occasional zooms, hook card, no SFX
    "clean": {
        "tighten": True, "jump_cuts": True, "remove_fillers": True, "hook_card": True, "zooms": True,
        "sfx": False, "word_pop": True, "loudnorm": True,
        "max_gap": 0.5, "zoom_amount": 0.07, "zoom_every": 8.0, "hook_snap": False,
    },
    # Just trims dead air + loudness
    "minimal": {
        "tighten": True, "jump_cuts": True, "remove_fillers": False, "hook_card": False, "zooms": False,
        "sfx": False, "word_pop": False, "loudnorm": True,
        "max_gap": 0.85, "zoom_amount": 0.0, "zoom_every": 99.0, "hook_snap": False,
    },
}
FEATURE_KEYS = ("tighten", "jump_cuts", "remove_fillers", "hook_card", "zooms", "sfx", "word_pop", "loudnorm")


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


def zoom_expression(punches: Sequence[float], cfg: Dict[str, Any]) -> Optional[str]:
    """zoompan z(t): eased punch-ins (0.10s in, 0.55s hold, 0.35s out) + optional opening snap."""
    amt = float(cfg.get("zoom_amount", 0.1))
    terms = []
    for a in punches:
        b = a + 0.10 + 0.55 + 0.35
        terms.append(f"{amt:.3f}*clip((it-{a:.2f})/0.10,0,1)*clip(({b:.2f}-it)/0.35,0,1)")
    if cfg.get("hook_snap"):
        terms.append("0.07*clip((0.6-it)/0.6,0,1)")
    if not terms:
        return None
    return "1+" + "+".join(terms)


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
        f"Style: HookCard,{font},80,&H00FFFFFF,&H000000FF,&H00000000,&H90000000,-1,0,0,0,100,100,0,0,1,7,3,8,60,60,0,1"
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
) -> None:
    """Zooms + captions/hook card + SFX + loudness on the rendered 1080x1920 base."""
    fps = await probe_fps(base)
    audio = await has_audio(base)
    vf = []
    z = zoom_expression(punches, cfg)
    if z:
        vf.append(
            f"zoompan=z='{z}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=1080x1920:fps={fps:.3f}"
        )
    if ass_path and os.path.exists(ass_path):
        esc = str(Path(ass_path).resolve()).replace("\\", "/").replace(":", "\\:")
        vf.append(f"subtitles='{esc}'")
    graph = [f"[0:v]{','.join(vf) if vf else 'null'}[vout]"]

    inputs = ["-i", str(base)]
    if audio:
        mix = ["[0:a]aresample=48000,aformat=channel_layouts=stereo[a0]"]
        labels = ["[a0]"]
        sfx = []
        if cfg.get("sfx"):
            if hook_card and (SFX_DIR / "whoosh.wav").is_file():
                sfx.append(("whoosh.wav", 0.0, 0.35))
            if punches and (SFX_DIR / "boom.wav").is_file():
                sfx.append(("boom.wav", max(0.0, punches[0] - 0.02), 0.45))
            for p in punches[1:]:
                if (SFX_DIR / "pop.wav").is_file():
                    sfx.append(("pop.wav", max(0.0, p - 0.02), 0.3))
        for i, (name, at, vol) in enumerate(sfx, start=1):
            inputs += ["-i", str(SFX_DIR / name)]
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
) -> Dict[str, Any]:
    """Edit one clip. ``words`` are annotated (censor) and in ``source`` time (0..duration).

    Returns {"video", "source", "words", "duration", "summary"} where source/words describe the
    tightened source so the editor & re-renders keep working.
    """
    from src.compositor.ass_generator import generate_ass_subtitles

    work = Path(work_dir)
    work.mkdir(parents=True, exist_ok=True)

    # 1. Tighten (only quiet gaps are cut, judged from the source's measured loudness)
    src_energy = await audio_energy(source)
    segments = plan_segments(words, duration, cfg, energy=src_energy)
    if segments == [(0.0, round(duration, 3))]:
        tight_src, tight_words, tight_dur = Path(source), list(words), duration
    else:
        tight_src = work / f"{tag}_tight.mp4"
        await cut_segments(source, segments, tight_src)
        tight_words = remap_words(words, segments)
        tight_dur = sum(e - s for s, e in segments)
    removed = max(0.0, duration - tight_dur)

    # 2. Layout render (no captions yet; bleeps + template + speed)
    anti = template.get("anti_shadowban", {}) or {}
    speed = float(anti.get("speed_multiplier", 1.02) or 1.0)
    base = work / f"{tag}_base.mp4"
    await renderer.render_clip(
        source_path=str(tight_src), start_time=0.0, end_time=tight_dur, output_path=str(base),
        template=template, ass_path=None, teaser_timestamp=None, include_teaser=False,
        censor_words=tight_words, censor_cfg=censor_cfg, words_time_offset=0.0, intermediate=True,
    )

    # 3. Finish (all times now in output time = tight time / speed)
    out_dur = tight_dur / speed
    out_words = []
    for w in tight_words:
        ow = {**w, "start": round(w["start"] / speed, 3), "end": round(w["end"] / speed, 3)}
        if cfg.get("word_pop") and not ow.get("censored") and _is_hype_word(ow):
            ow["color"] = ow.get("color") or "#FF4D6D"
        out_words.append(ow)

    ass_path = work / f"{tag}_auto.ass"
    sub_cfg = template.get("subtitles") or template.get("captions") or {}
    generate_ass_subtitles(
        word_timestamps=out_words, output_path=ass_path, template_config=template,
        time_offset=0.0, max_duration=out_dur, censor_cfg=censor_cfg,
    )
    hook_used = bool(cfg.get("hook_card") and hook_text and hook_text.strip())
    if hook_used:
        from src.compositor.profanity import censor_text
        add_hook_card(
            ass_path, censor_text(hook_text, censor_cfg) if censor_cfg else hook_text,
            font=sub_cfg.get("font_name") or sub_cfg.get("font") or "Montserrat ExtraBold",
            caption_y=float((sub_cfg.get("position") or {}).get("y", 0.76)),
        )

    energy = await audio_energy(base)
    punches = pick_punches(out_words, energy, out_dur, cfg)
    await finish_clip(base, out_path, ass_path, punches, cfg, hook_card=hook_used)
    await make_thumbnail(out_path, at=min(1.0, out_dur / 3))
    try:
        base.unlink(missing_ok=True)
    except Exception:
        pass

    summary = {
        "style": cfg.get("style"),
        "cuts": max(0, len(segments) - 1),
        "removed_seconds": round(removed, 1),
        "zooms": len(punches),
        "zoom_times": list(punches),
        "hook_card": hook_used,
        "sfx": bool(cfg.get("sfx")),
    }
    logger.info("Auto-edited %s: %s", tag, summary)
    return {"video": str(out_path), "source": str(tight_src), "words": tight_words,
            "duration": tight_dur, "summary": summary}


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
