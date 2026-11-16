"""Build the real setup + payoff video for a narrative-storyline match.

The matcher decides *whether* a hype moment pays off an earlier setup; this module makes the video:
the setup snippet (3-7 s, sentence-snapped) becomes the opening hook and the payoff window follows it.
Everything is fail-closed: any problem raises ``StitchError`` and the caller renders the normal clip.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

MIN_SETUP_S = 1.5   # a setup shorter than this carries no context worth a stitch


class StitchError(RuntimeError):
    pass


def _word_text(w: Dict[str, Any]) -> str:
    return str(w.get("word", w.get("text", "")))


def window_words(words: Sequence[Dict[str, Any]], start: float, end: float, shift: float) -> List[Dict[str, Any]]:
    """Words overlapping [start, end] re-timed by ``shift`` (new_time = old_time - start + shift), clamped to the window."""
    out: List[Dict[str, Any]] = []
    for w in words:
        ws, we = float(w.get("start", 0.0)), float(w.get("end", 0.0))
        if we <= start or ws >= end:
            continue
        nw = dict(w)
        nw["start"] = round(max(ws, start) - start + shift, 3)
        nw["end"] = round(min(we, end) - start + shift, 3)
        out.append(nw)
    return out


def stitch_words(
    setup_words: Sequence[Dict[str, Any]], payoff_words: Sequence[Dict[str, Any]],
    setup_in: float, setup_out: float, clip_start: float, clip_end: float,
) -> Tuple[List[Dict[str, Any]], float, float]:
    """Combined word timeline of [setup | payoff]. Returns (words, setup_duration, total_duration)."""
    setup_dur = max(0.0, setup_out - setup_in)
    total = setup_dur + max(0.0, clip_end - clip_start)
    words = window_words(setup_words, setup_in, setup_out, 0.0) + window_words(payoff_words, clip_start, clip_end, setup_dur)
    return words, setup_dur, total


def snap_setup_range(
    words: Sequence[Dict[str, Any]], setup_in: float, setup_out: float, max_duration: float = 7.0,
) -> Tuple[float, float]:
    """Pull ``setup_out`` back to a word boundary so the setup never ends mid-word (and stays <= max_duration)."""
    limit = min(setup_out, setup_in + max_duration)
    ends = [float(w.get("end", 0.0)) for w in words if setup_in < float(w.get("end", 0.0)) <= limit + 0.25]
    return setup_in, (max(ends) if ends else limit)


async def build_stitched_source(
    match: Dict[str, Any], payoff_source: str | Path, clip_start: float, clip_end: float,
    out_path: str | Path,
) -> Dict[str, Any]:
    """Concatenate the setup snippet and the payoff window into ``out_path``.

    Returns {"source", "setup_duration", "duration", "setup_words", "setup_in", "setup_out"}.
    """
    from src.compositor.auto_edit import cut_multi_source_segments

    seed = match.get("seed") or {}
    snippet = Path(str(seed.get("snippet_path") or ""))
    if not snippet.exists():
        raise StitchError(f"setup snippet missing: {snippet}")
    if not Path(payoff_source).exists():
        raise StitchError("payoff source missing")

    setup_in = float(match.get("setup_src_in", 0.0))
    setup_out = float(match.get("setup_src_out", setup_in + 4.0))
    if setup_out - setup_in < MIN_SETUP_S:
        raise StitchError("setup range too short")

    segments = [
        {"source_id": "setup", "start": setup_in, "end": setup_out},
        {"source_id": "payoff", "start": clip_start, "end": clip_end},
    ]
    try:
        await cut_multi_source_segments({"setup": snippet, "payoff": payoff_source}, segments, out_path)
    except Exception as e:
        raise StitchError(str(e)) from e
    if not Path(out_path).exists() or Path(out_path).stat().st_size < 1000:
        raise StitchError("stitched file was not produced")

    import json
    try:
        transcript = json.loads(seed.get("transcript_json") or "{}")
    except Exception:
        transcript = {}
    return {
        "source": str(out_path),
        "setup_in": setup_in, "setup_out": setup_out,
        "setup_duration": setup_out - setup_in,
        "duration": (setup_out - setup_in) + (clip_end - clip_start),
        "setup_words": transcript.get("words") or [],
    }
