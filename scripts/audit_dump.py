#!/usr/bin/env python3
"""AutoClip Read-Only Audit Data Extraction Script.

Extracts real clip records and computes scoring statistics from autoclip.db.
Outputs:
- data/audit/candidates_sample.json
- data/audit/score_stats.json

Self-contained, safe, read-only: does not modify or delete any database rows.
"""

import json
import math
import os
import sqlite3
import sys
from collections import Counter
from pathlib import Path

def resolve_db_path() -> str:
    """Find the best available database (vps replica or local production)."""
    candidates = [
        "data/autoclip_vps.db",
        "data/autoclip.db",
        "/home/ubuntu/apps/clipping/data/autoclip.db",
    ]
    for p in candidates:
        if os.path.exists(p):
            return p
    print("ERROR: No database file found.", file=sys.stderr)
    sys.exit(1)

def run_audit(db_path: str):
    conn = sqlite3.connect(db_path)
    conn.row_factory = sqlite3.Row
    c = conn.cursor()

    # Verify tables
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()]
    print(f"[Audit] Connected to: {db_path}")
    print(f"[Audit] Existing tables: {len(tables)}")

    # 1. Fetch all clips
    clips_rows = c.execute("SELECT * FROM clips ORDER BY id DESC").fetchall()
    clips = [dict(r) for r in clips_rows]
    print(f"[Audit] Total clips found: {len(clips)}")

    # 2. Fetch candidates if table exists and has rows
    candidates = []
    if "candidates" in tables:
        cand_rows = c.execute("SELECT * FROM candidates ORDER BY created_at DESC").fetchall()
        candidates = [dict(r) for r in cand_rows]
    print(f"[Audit] Total candidates found: {len(candidates)}")

    # 3. Fetch feedback events if table exists
    feedback_events = []
    if "clip_feedback_events" in tables:
        fb_rows = c.execute("SELECT * FROM clip_feedback_events ORDER BY created_at DESC").fetchall()
        feedback_events = [dict(r) for r in fb_rows]
    print(f"[Audit] Total feedback events found: {len(feedback_events)}")

    # 4. Compute Score Statistics
    # Collect all scores
    virality_scores = [c["virality_score"] for c in clips if c.get("virality_score") is not None]
    final_scores = [c["final_score"] for c in clips if c.get("final_score") is not None]
    
    # Histograms in bins of 10: [0-9, 10-19, ..., 90-100]
    def make_histogram(vals):
        bins = {f"{i*10}-{(i*10)+9 if i < 10 else 100}": 0 for i in range(11)}
        for v in vals:
            v_int = int(round(v))
            bin_idx = min(10, v_int // 10)
            key = f"{bin_idx*10}-{(bin_idx*10)+9 if bin_idx < 10 else 100}"
            bins[key] += 1
        return bins

    def compute_summary_stats(vals):
        if not vals:
            return {"count": 0, "min": None, "mean": None, "median": None, "p90": None, "max": None}
        sorted_vals = sorted(vals)
        n = len(sorted_vals)
        mean_val = sum(sorted_vals) / n
        median_val = sorted_vals[n // 2] if n % 2 != 0 else (sorted_vals[(n//2)-1] + sorted_vals[n//2]) / 2.0
        p90_idx = int(math.ceil(0.90 * n)) - 1
        p90_val = sorted_vals[max(0, min(n - 1, p90_idx))]
        return {
            "count": n,
            "min": round(sorted_vals[0], 2),
            "mean": round(mean_val, 2),
            "median": round(median_val, 2),
            "p90": round(p90_val, 2),
            "max": round(sorted_vals[-1], 2),
        }

    virality_stats = compute_summary_stats(virality_scores)
    
    # % of clips with final/virality score >= 80
    high_virality_count = sum(1 for v in virality_scores if v >= 80)
    pct_virality_ge_80 = round((high_virality_count / len(virality_scores) * 100.0), 2) if virality_scores else 0.0

    # Distinct values
    distinct_virality = sorted(list(set(virality_scores)))
    
    # Status breakdown
    status_counts = Counter(c.get("status") for c in clips)

    # Per channel breakdown
    channel_counts = Counter(c.get("channel_id") for c in clips)
    channel_status = {}
    for c_rec in clips:
        ch = c_rec.get("channel_id", "unknown")
        st = c_rec.get("status", "unknown")
        if ch not in channel_status:
            channel_status[ch] = {}
        channel_status[ch][st] = channel_status[ch].get(st, 0) + 1

    stats_output = {
        "database_inspected": db_path,
        "total_clips_recorded": len(clips),
        "total_unselected_candidates_recorded": len(candidates),
        "note_on_unselected_candidates": (
            "Unselected candidates are NOT stored in the active system. In main.py (_on_live_moment & _on_vod_event), "
            "Gemini returns candidates via ViralScorer.analyze_transcript; only candidates[0] is created as a clip. "
            "Non-selected candidates and below-threshold moments are discarded immediately."
        ),
        "status_distribution": dict(status_counts),
        "channel_distribution": dict(channel_counts),
        "channel_status_breakdown": channel_status,
        "virality_score_distribution_hist_bins_of_10": make_histogram(virality_scores),
        "virality_score_summary": virality_stats,
        "pct_clips_virality_ge_80": pct_virality_ge_80,
        "distinct_virality_scores": distinct_virality,
        "distinct_virality_score_counts": dict(Counter(virality_scores)),
        "final_score_column_note": (
            "The final_score column in the clips table contains default 0.0 for all clips because the running "
            "service executes main.py (using ViralScorer -> virality_score) rather than intelligence.pipeline "
            "(BestClipsPipeline -> final_score). Therefore virality_score is the active operational score."
        ),
    }

    # 5. Format candidates sample (Last 50 clips)
    sample_clips = []
    for c_rec in clips[:50]:
        dur = 0.0
        r_start = c_rec.get("raw_start")
        r_end = c_rec.get("raw_end")
        if r_start is not None and r_end is not None:
            dur = round(r_end - r_start, 2)

        sample_clips.append({
            "id": c_rec.get("id"),
            "channel_id": c_rec.get("channel_id"),
            "source_type": c_rec.get("source_type"),
            "source_id": c_rec.get("source_id"),
            "status": c_rec.get("status"),
            "template_name": c_rec.get("template_name"),
            "start_time": r_start,
            "end_time": r_end,
            "duration_seconds": dur,
            "virality_score": c_rec.get("virality_score"),
            "final_score": c_rec.get("final_score"),
            "title": c_rec.get("title"),
            "description_or_hook_summary": c_rec.get("description"),
            "hashtags": c_rec.get("hashtags"),
            "teaser_hook_timestamp": c_rec.get("teaser_hook_timestamp"),
            "prompt_version": c_rec.get("prompt_version"),
            "score_breakdown": c_rec.get("score_breakdown"),
            "flags": c_rec.get("flags"),
            "created_at": str(c_rec.get("created_at")),
            "rendered_video_path": c_rec.get("rendered_video_path"),
        })

    candidates_sample_output = {
        "database_inspected": db_path,
        "sample_count": len(sample_clips),
        "total_clips_in_db": len(clips),
        "unselected_candidates_count": len(candidates),
        "clips": sample_clips,
        "rejected_candidates": candidates[:20],
    }

    # 6. Save deliverables
    out_dir = Path("data/audit")
    out_dir.mkdir(parents=True, exist_ok=True)

    cand_path = out_dir / "candidates_sample.json"
    with open(cand_path, "w", encoding="utf-8") as f:
        json.dump(candidates_sample_output, f, indent=2)
    print(f"[Audit] Wrote sample to: {cand_path}")

    stats_path = out_dir / "score_stats.json"
    with open(stats_path, "w", encoding="utf-8") as f:
        json.dump(stats_output, f, indent=2)
    print(f"[Audit] Wrote stats to: {stats_path}")

if __name__ == "__main__":
    db = resolve_db_path()
    run_audit(db)

