"""Learn from what actually got watched.

Every posted clip with real numbers (YouTube views / retention, Instagram plays) becomes one
training row. For each simple feature - streamer, trigger type, chat mood, clip length, layout,
edit style, source - we measure how clips with that value did against the typical clip
(log-views, so 10x the views = +1). Small groups are shrunk toward "no effect", so one lucky clip
can't swing anything.

The result (system setting `performance_model`) is used three ways:
- `adjust(features)`: a bounded nudge (±MAX_ADJUST points) on the AI judge's score for new clips.
- `best_hours(account)`: the posting hours that historically got the most views (smart slots).
- The Performance page shows the same tables plus how well the AI score predicts real views.
"""

from __future__ import annotations

import json
import logging
import math
import statistics
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

SETTING = "performance_model"
SHRINK_K = 6.0          # pseudo-clips of "no effect" mixed into every group
MIN_GROUP = 2           # a value needs this many clips before it can move a score
MIN_ROWS = 6            # no adjustments at all before this many posted clips have numbers
MAX_ADJUST = 8.0        # score points, either way
POINTS_PER_LOG = 10.0   # 10x the typical views = +10 points before weighting / clamping
WEIGHTS = {"streamer": 1.0, "trigger": 0.5, "mood": 0.5, "length": 0.5, "layout": 0.4, "style": 0.4, "source": 0.3}
LABELS = {"streamer": "Streamer", "trigger": "Trigger", "mood": "Chat mood", "length": "Length",
          "layout": "Layout", "style": "Edit style", "source": "Source"}
RUBRIC = ("hook_2s", "stands_alone", "payoff", "emotion", "shareability", "pacing", "clarity")
WINDOW_RANK = {"7d": 0, "72h": 1, "24h": 2}

_MODEL: Dict[str, Any] = {}


# ----------------------------------------------------------------------------- features
def length_bucket(seconds: Optional[float]) -> Optional[str]:
    if seconds is None or seconds <= 0:
        return None
    if seconds < 25:
        return "under 25s"
    if seconds < 40:
        return "25-40s"
    if seconds < 60:
        return "40-60s"
    return "60s+"


def norm_handle(h: Optional[str]) -> str:
    return (h or "").strip().lstrip("@").lower()


def features_of(clip: Dict[str, Any]) -> Dict[str, Optional[str]]:
    """Feature values for a clip row (clips table columns) or a scoring-time dict with the same keys."""
    trig = clip.get("trigger_json") or clip.get("trigger") or {}
    if isinstance(trig, str):
        try:
            trig = json.loads(trig)
        except ValueError:
            trig = {}
    plan = clip.get("edit_plan") or {}
    if isinstance(plan, str):
        try:
            plan = json.loads(plan)
        except ValueError:
            plan = {}
    dur = clip.get("duration")
    if dur is None:
        try:
            s = float(clip.get("adjusted_start") if clip.get("adjusted_start") is not None else clip.get("raw_start"))
            e = float(clip.get("adjusted_end") if clip.get("adjusted_end") is not None else clip.get("raw_end"))
            dur = e - s
        except (TypeError, ValueError):
            dur = None
    trigger = (trig or {}).get("type") or None
    return {
        "streamer": norm_handle(clip.get("channel_id")) or None,
        "trigger": trigger,
        "mood": (trig or {}).get("mood") or None,
        "length": length_bucket(dur),
        "layout": clip.get("template_name") or None,
        "style": (plan or {}).get("style") or None,
        "source": clip.get("source_type") or None,
    }


# ----------------------------------------------------------------------------- maths
def outcome(views_by_platform: Dict[str, float], typical: Dict[str, float]) -> Optional[float]:
    """Log10 views above the platform's typical clip, averaged over the platforms it was posted to."""
    vals = [math.log10(max(0.0, v) + 1.0) - typical[p] for p, v in views_by_platform.items() if p in typical]
    return sum(vals) / len(vals) if vals else None


def group_lifts(rows: Sequence[Dict[str, Any]], feature: str) -> Dict[str, Dict[str, Any]]:
    """value -> {n, lift (shrunk mean outcome), points, median_views}."""
    buckets: Dict[str, List[Dict[str, Any]]] = {}
    for r in rows:
        v = r["features"].get(feature)
        if v:
            buckets.setdefault(v, []).append(r)
    out = {}
    for value, items in buckets.items():
        ys = [r["y"] for r in items]
        lift = sum(ys) / (len(ys) + SHRINK_K)
        views = [r["views"] for r in items if r.get("views") is not None]
        out[value] = {"n": len(items), "lift": round(lift, 4), "points": round(lift * POINTS_PER_LOG, 2),
                      "median_views": int(statistics.median(views)) if views else None}
    return out


def pearson(xs: Sequence[float], ys: Sequence[float]) -> Optional[float]:
    if len(xs) < 4:
        return None
    mx, my = statistics.fmean(xs), statistics.fmean(ys)
    sx = math.sqrt(sum((x - mx) ** 2 for x in xs))
    sy = math.sqrt(sum((y - my) ** 2 for y in ys))
    if sx == 0 or sy == 0:
        return None
    return round(sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / (sx * sy), 3)


def adjust_with(model: Dict[str, Any], features: Dict[str, Optional[str]]) -> Tuple[float, List[str]]:
    """Score nudge (points) + short reasons, from a model dict. 0 when there isn't enough data."""
    if not model or (model.get("n") or 0) < MIN_ROWS:
        return 0.0, []
    total, reasons = 0.0, []
    groups = model.get("groups") or {}
    for feat, weight in WEIGHTS.items():
        val = features.get(feat)
        if feat == "streamer":
            val = norm_handle(val) or None
        g = (groups.get(feat) or {}).get(val) if val else None
        if not g or g["n"] < MIN_GROUP:
            continue
        pts = g["points"] * weight
        if abs(pts) >= 0.5:
            total += pts
            word = "above" if pts > 0 else "below"
            reasons.append(f"{LABELS[feat]} '{val}' clips get views {word} average ({g['n']} posted)")
    total = max(-MAX_ADJUST, min(MAX_ADJUST, total))
    return round(total, 1), reasons[:3]


def best_hours_from(samples: Sequence[Tuple[int, float]], top: int, min_samples: int = 8) -> Optional[List[int]]:
    """Local posting hours ranked by shrunk mean outcome. samples = (hour 0-23, outcome)."""
    if len(samples) < min_samples or len({h for h, _ in samples}) < 3:
        return None
    by: Dict[int, List[float]] = {}
    for h, y in samples:
        by.setdefault(h, []).append(y)
    ranked = sorted(by, key=lambda h: sum(by[h]) / (len(by[h]) + 2.0), reverse=True)
    picked = [h for h in ranked if sum(by[h]) / (len(by[h]) + 2.0) > -0.05][:top]
    return sorted(picked) if picked else None


def hour_table(samples: Sequence[Tuple[int, float, int]]) -> List[Dict[str, Any]]:
    """Per local hour: clips posted, median views, shrunk lift. samples = (hour, outcome, views)."""
    by: Dict[int, List[Tuple[float, int]]] = {}
    for h, y, v in samples:
        by.setdefault(h, []).append((y, v))
    return [{"hour": h, "n": len(items), "median_views": int(statistics.median([v for _, v in items])),
             "lift": round(sum(y for y, _ in items) / (len(items) + 2.0), 3)} for h, items in sorted(by.items())]


# ----------------------------------------------------------------------------- data
async def load_rows(db) -> List[Dict[str, Any]]:
    """One row per posted clip with numbers: features, outcome y, views, rubric, AI score, post time."""
    cur = await db.execute(
        """SELECT m.clip_id, m.platform, m.window, m.views, m.retention_pct, m.account_key
           FROM clip_metrics m""")
    best: Dict[Tuple[int, str], Dict[str, Any]] = {}
    for r in await cur.fetchall():
        r = dict(r)
        k = (r["clip_id"], r["platform"])
        cur_best = best.get(k)
        # compare like with like: everyone has a 24h number first; use the most mature window per clip
        if cur_best is None or WINDOW_RANK.get(r["window"], 9) < WINDOW_RANK.get(cur_best["window"], 9):
            best[k] = r
    if not best:
        return []
    clip_ids = sorted({k[0] for k in best})
    marks = ",".join("?" * len(clip_ids))
    cur = await db.execute(
        f"""SELECT c.id, c.channel_id, c.template_name, c.source_type, c.raw_start, c.raw_end, c.adjusted_start,
                   c.adjusted_end, c.trigger_json, c.edit_plan, c.score_breakdown, c.final_score, c.virality_score,
                   c.title, c.thumbnail_path, c.published_at,
                   (SELECT COALESCE(q.posted_at, q.scheduled_for) FROM scheduled_queue q WHERE q.clip_id = c.id
                      AND (q.yt_status = 'uploaded' OR q.ig_status = 'uploaded') ORDER BY q.id LIMIT 1) AS posted_at,
                   (SELECT q.account_key FROM scheduled_queue q WHERE q.clip_id = c.id AND q.yt_status = 'uploaded'
                      ORDER BY q.id LIMIT 1) AS yt_account
            FROM clips c WHERE c.id IN ({marks})""", clip_ids)
    clips = {r["id"]: dict(r) for r in await cur.fetchall()}

    # typical log-views per platform *and window* so a 7d number isn't compared with a 24h one
    per_pw: Dict[Tuple[str, str], List[float]] = {}
    for (cid, p), r in best.items():
        per_pw.setdefault((p, r["window"]), []).append(math.log10(max(0, r["views"] or 0) + 1))
    typical_pw = {k: statistics.median(v) for k, v in per_pw.items()}

    rows = []
    for cid, clip in clips.items():
        ys, views, retention, plats = [], [], None, []
        for p in ("youtube", "instagram", "tiktok"):
            m = best.get((cid, p))
            if not m:
                continue
            plats.append(p)
            ys.append(math.log10(max(0, m["views"] or 0) + 1) - typical_pw[(p, m["window"])])
            views.append(int(m["views"] or 0))
            if p == "youtube" and m.get("retention_pct"):
                retention = float(m["retention_pct"])
        if not ys:
            continue
        try:
            rubric = json.loads(clip.get("score_breakdown") or "{}")
        except ValueError:
            rubric = {}
        rows.append({
            "clip_id": cid, "title": clip.get("title"), "features": features_of(clip),
            "y": sum(ys) / len(ys), "views": max(views), "retention": retention, "platforms": plats,
            "ai_score": clip.get("final_score") if clip.get("final_score") is not None else clip.get("virality_score"),
            "rubric": {k: rubric.get(k) for k in RUBRIC if isinstance(rubric.get(k), (int, float))},
            "posted_at": clip.get("posted_at") or clip.get("published_at"), "yt_account": clip.get("yt_account"),
            "has_thumb": bool(clip.get("thumbnail_path")),
        })
    return rows


async def _account_tz(db) -> Dict[str, str]:
    try:
        cur = await db.execute("SELECT account_key, timezone FROM youtube_accounts")
        return {r[0]: r[1] for r in await cur.fetchall()}
    except Exception:
        return {}


def build_model(rows: Sequence[Dict[str, Any]], tz_by_account: Dict[str, str], default_tz: str = "Asia/Kolkata",
                caps: Optional[Dict[str, int]] = None) -> Dict[str, Any]:
    from src.publisher.slots import get_tz, to_utc

    model: Dict[str, Any] = {"updated_at": datetime.now(timezone.utc).isoformat(), "n": len(rows), "groups": {},
                             "insights": [], "rubric_corr": {}, "score_corr": None, "best_hours": {}, "hours": {}}
    if not rows:
        return model
    for feat in WEIGHTS:
        model["groups"][feat] = group_lifts(rows, feat)

    scored = [r for r in rows if isinstance(r.get("ai_score"), (int, float))]
    model["score_corr"] = pearson([float(r["ai_score"]) for r in scored], [r["y"] for r in scored])
    for k in RUBRIC:
        have = [r for r in rows if k in r["rubric"]]
        model["rubric_corr"][k] = pearson([float(r["rubric"][k]) for r in have], [r["y"] for r in have])

    # posting hours, in each YouTube account's own timezone (Instagram-only rows use the default)
    per_acc: Dict[str, List[Tuple[int, float, int]]] = {}
    for r in rows:
        at = to_utc(r.get("posted_at"))
        if not at:
            continue
        acc = r.get("yt_account") or "_all"
        hour = at.astimezone(get_tz(tz_by_account.get(acc) or default_tz)).hour
        per_acc.setdefault(acc, []).append((hour, r["y"], r["views"]))
        if acc != "_all":
            per_acc.setdefault("_all", []).append((hour, r["y"], r["views"]))
    for acc, samples in per_acc.items():
        model["hours"][acc] = hour_table(samples)
        top = (caps or {}).get(acc, 3)
        hours = best_hours_from([(h, y) for h, y, _ in samples], top)
        if hours:
            model["best_hours"][acc] = hours

    model["insights"] = insights(model)
    return model


def insights(model: Dict[str, Any]) -> List[str]:
    out: List[str] = []
    if model["n"] < MIN_ROWS:
        out.append(f"Learning starts after {MIN_ROWS} posted clips have view numbers ({model['n']} so far). "
                   "Until then scores are the AI judge's alone.")
        return out
    for feat in ("streamer", "trigger", "length", "layout", "mood"):
        g = {k: v for k, v in (model["groups"].get(feat) or {}).items() if v["n"] >= MIN_GROUP}
        if len(g) < 2:
            continue
        top = max(g.items(), key=lambda kv: kv[1]["lift"])
        low = min(g.items(), key=lambda kv: kv[1]["lift"])
        if top[1]["lift"] - low[1]["lift"] >= 0.08:
            out.append(f"{LABELS[feat]}: '{top[0]}' clips do best (median {top[1]['median_views'] or 0:,} views), "
                       f"'{low[0]}' worst (median {low[1]['median_views'] or 0:,}).")
    sc = model.get("score_corr")
    if sc is not None:
        how = "strongly" if sc >= 0.5 else "somewhat" if sc >= 0.2 else "barely" if sc >= 0 else "doesn't"
        out.append(f"The AI score {how} predicts real views (correlation {sc:+.2f}).")
    rc = {k: v for k, v in (model.get("rubric_corr") or {}).items() if v is not None}
    if rc:
        k, v = max(rc.items(), key=lambda kv: kv[1])
        out.append(f"Of the judge's sub-scores, '{k.replace('_', ' ')}' tracks views best ({v:+.2f}).")
    return out


# ----------------------------------------------------------------------------- persistence / API
async def refresh_performance_model() -> Dict[str, Any]:
    global _MODEL
    from src.database import get_db_connection, set_system_setting

    async with get_db_connection() as db:
        rows = await load_rows(db)
        tz = await _account_tz(db)
        try:
            cur = await db.execute("SELECT account_key, daily_cap FROM youtube_accounts")
            caps = {r[0]: int(r[1] or 3) for r in await cur.fetchall()}
        except Exception:
            caps = {}
    model = build_model(rows, tz, caps=caps)
    _MODEL = model
    await set_system_setting(SETTING, json.dumps(model))
    return model


async def get_model() -> Dict[str, Any]:
    global _MODEL
    if _MODEL:
        return _MODEL
    try:
        from src.database import get_system_setting
        raw = await get_system_setting(SETTING, "")
        _MODEL = json.loads(raw) if raw else {}
    except Exception:
        _MODEL = {}
    return _MODEL


async def adjust(features: Dict[str, Optional[str]]) -> Tuple[float, List[str]]:
    return adjust_with(await get_model(), features)


async def best_hours(account_key: Optional[str]) -> Optional[List[int]]:
    model = await get_model()
    bh = model.get("best_hours") or {}
    return bh.get(account_key or "") or bh.get("_all")
