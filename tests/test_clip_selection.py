"""Tests for whole-video windowing and multi-clip ranking (Opus-style multi clip output)."""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.intelligence.viral_scorer import (  # noqa: E402
    MAX_WINDOWS,
    ViralHookCandidate,
    WINDOW_SECONDS,
    build_windows,
    select_clips,
)


def seg(start, dur=5.0, text="words here"):
    return {"start": start, "end": start + dur, "text": text}


def cand(start, end, score, title="t"):
    return ViralHookCandidate(
        start_time=start, end_time=end, virality_score=score, suggested_title=title,
        hook_summary="h", punchline_summary="p",
    )


def test_windows_cover_whole_video_with_overlap():
    segments = [seg(t) for t in range(0, 3600, 5)]  # one hour
    windows = build_windows(segments)
    assert windows[0]["start"] == 0
    assert windows[-1]["end"] >= 3600 - 5          # reaches the end (old code stopped at ~segment 100)
    assert 6 <= len(windows) <= 8
    for a, b in zip(windows, windows[1:]):
        assert b["start"] < a["end"]                 # overlapping
        assert a["end"] - a["start"] <= WINDOW_SECONDS + 5
    assert "[3595.0s - 3600.0s]" in windows[-1]["text"]


def test_windows_capped_for_very_long_videos():
    segments = [seg(t) for t in range(0, 6 * 3600, 5)]
    assert len(build_windows(segments)) == MAX_WINDOWS


def test_short_video_single_window():
    windows = build_windows([seg(0), seg(5), seg(10)])
    assert len(windows) == 1 and windows[0]["end"] == 15


def test_select_ranks_filters_and_dedupes():
    cands = [
        cand(100, 140, 80, "a"),
        cand(105, 145, 92, "a-better-overlap"),   # overlaps a -> keep higher score only
        cand(300, 335, 70, "b"),
        cand(500, 510, 95, "too-short"),            # 10s < 25*0.8
        cand(700, 900, 99, "too-long"),             # 200s > 60*1.15
        cand(1000, 1040, 50, "low-score"),
        cand(1200, 1250, 85, "c"),
    ]
    out = select_clips(cands, min_score=60, min_len=25, max_len=60, max_clips=10)
    assert [c.suggested_title for c in out] == ["a-better-overlap", "c", "b"]


def test_select_respects_max_clips():
    cands = [cand(i * 100, i * 100 + 40, 90 - i) for i in range(10)]
    out = select_clips(cands, min_score=0, min_len=25, max_len=60, max_clips=4)
    assert len(out) == 4 and out[0].virality_score == 90
