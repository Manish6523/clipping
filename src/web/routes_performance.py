"""Performance page: what got watched, what the system learned from it, title tests and translations."""

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List

from aiohttp import web

logger = logging.getLogger(__name__)

WINDOW_ORDER = "CASE m.window WHEN '7d' THEN 0 WHEN '72h' THEN 1 ELSE 2 END"


async def _latest_metrics(db, since_iso: str) -> List[Dict[str, Any]]:
    """Latest snapshot per posted video (YouTube video / Instagram media) posted since `since_iso`."""
    cur = await db.execute(
        f"""SELECT m.clip_id, m.platform, m.window, m.views, m.likes, m.comments, m.retention_pct, m.video_id, m.account_key,
                   c.title, c.channel_id, c.template_name, c.thumbnail_path, c.final_score, c.virality_score,
                   (SELECT COALESCE(q.posted_at, q.scheduled_for) FROM scheduled_queue q WHERE q.clip_id = m.clip_id
                       AND (q.yt_status = 'uploaded' OR q.ig_status = 'uploaded') ORDER BY q.id LIMIT 1) AS posted_at
            FROM clip_metrics m JOIN clips c ON c.id = m.clip_id
            WHERE m.id = (SELECT m2.id FROM clip_metrics m2 WHERE m2.video_id = m.video_id
                          ORDER BY CASE m2.window WHEN '7d' THEN 0 WHEN '72h' THEN 1 ELSE 2 END LIMIT 1)""")
    rows = [dict(r) for r in await cur.fetchall()]
    return [r for r in rows if (r.get("posted_at") or "") >= since_iso]


def summarize(rows: List[Dict[str, Any]]) -> Dict[str, Any]:
    by_clip: Dict[int, Dict[str, Any]] = {}
    plat: Dict[str, Dict[str, Any]] = {}
    for r in rows:
        c = by_clip.setdefault(r["clip_id"], {
            "clip_id": r["clip_id"], "title": r["title"], "channel_id": r["channel_id"], "template": r["template_name"],
            "has_thumb": bool(r["thumbnail_path"]), "ai_score": r["final_score"] or r["virality_score"],
            "posted_at": r["posted_at"], "views": 0, "likes": 0, "platforms": {}, "retention": None})
        c["views"] += int(r["views"] or 0)
        c["likes"] += int(r["likes"] or 0)
        c["platforms"][r["platform"]] = {"views": int(r["views"] or 0), "window": r["window"], "video_id": r["video_id"]}
        if r["platform"] == "youtube" and r.get("retention_pct"):
            c["retention"] = round(float(r["retention_pct"]), 1)
        p = plat.setdefault(r["platform"], {"posts": 0, "views": 0})
        p["posts"] += 1
        p["views"] += int(r["views"] or 0)
    clips = sorted(by_clip.values(), key=lambda c: c["views"], reverse=True)
    ret = [c["retention"] for c in clips if c["retention"] is not None]
    # views per posting day (local date of the server's default timezone)
    from src.publisher.slots import get_tz, to_utc
    tz = get_tz(None)
    daily: Dict[str, Dict[str, int]] = {}
    for c in clips:
        at = to_utc(c["posted_at"])
        if not at:
            continue
        d = at.astimezone(tz).date().isoformat()
        e = daily.setdefault(d, {"date": d, "posts": 0, "views": 0})
        e["posts"] += 1
        e["views"] += c["views"]
    return {
        "totals": {"posts": len(clips), "views": sum(c["views"] for c in clips),
                   "likes": sum(c["likes"] for c in clips),
                   "avg_retention": round(sum(ret) / len(ret), 1) if ret else None,
                   "median_views": sorted(c["views"] for c in clips)[len(clips) // 2] if clips else 0},
        "platforms": plat,
        "top": clips[:10],
        "bottom": list(reversed(clips[-5:])) if len(clips) > 10 else [],
        "daily": sorted(daily.values(), key=lambda d: d["date"]),
    }


async def get_performance(request: web.Request) -> web.Response:
    from src.database import get_db_connection
    from src.intelligence.performance_learning import get_model, refresh_performance_model
    from src.publisher.growth import load_settings, variant_rates, LANG_NAMES

    try:
        days = max(1, min(365, int(request.query.get("days", "30"))))
    except ValueError:
        days = 30
    since = (datetime.now(timezone.utc) - timedelta(days=days)).isoformat()
    async with get_db_connection() as db:
        rows = await _latest_metrics(db, since)
        cur = await db.execute("SELECT * FROM title_tests ORDER BY id DESC LIMIT 30")
        tests = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute(
            """SELECT language, titles_status, captions_status, COUNT(*) n FROM video_translations
               GROUP BY language, titles_status, captions_status""")
        trans = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute("SELECT account_key, channel_title, smart_slots, timezone, publish_slots, daily_cap FROM youtube_accounts")
        accounts = [dict(r) for r in await cur.fetchall()]
        if tests:
            ids = ",".join(str(t["clip_id"]) for t in tests)
            cur = await db.execute(f"SELECT id, title, thumbnail_path FROM clips WHERE id IN ({ids})")
            clip_info = {r["id"]: dict(r) for r in await cur.fetchall()}
        else:
            clip_info = {}

    model = await get_model()
    if not model:
        model = await refresh_performance_model()

    out_tests = []
    for t in tests:
        variants = json.loads(t["variants_json"])
        rounds = json.loads(t["rounds_json"] or "[]")
        rates = variant_rates(rounds, len(variants))
        info = clip_info.get(t["clip_id"]) or {}
        out_tests.append({
            "id": t["id"], "clip_id": t["clip_id"], "video_id": t["video_id"], "account_key": t["account_key"],
            "status": t["status"], "current_idx": t["current_idx"], "winner_idx": t["winner_idx"], "note": t["note"],
            "next_switch_at": t["next_switch_at"], "window_hours": t["window_hours"], "rounds_done": sum(1 for r in rounds if r.get("views_end") is not None),
            "rounds_total": len(variants) * 2, "has_thumb": bool(info.get("thumbnail_path")),
            "variants": [{"title": v["title"], "thumb_t": v.get("thumb_t"), "views_per_hour": rates[i]} for i, v in enumerate(variants)],
            "created_at": t["created_at"],
        })

    trans_summary: Dict[str, Dict[str, Any]] = {}
    for r in trans:
        e = trans_summary.setdefault(r["language"], {"language": r["language"], "name": LANG_NAMES.get(r["language"], r["language"]),
                                                     "titles": 0, "captions": 0, "failed": 0})
        e["titles"] += r["n"] if r["titles_status"] == "done" else 0
        e["captions"] += r["n"] if r["captions_status"] == "done" else 0
        e["failed"] += r["n"] if "failed" in (r["titles_status"], r["captions_status"]) else 0

    from src.publisher.slots import parse_slots, slots_to_strings
    acc_out = []
    for a in accounts:
        key = a["account_key"]
        acc_out.append({
            "account_key": key, "title": a["channel_title"], "smart_slots": bool(a["smart_slots"]), "timezone": a["timezone"],
            "manual_slots": slots_to_strings(parse_slots(a["publish_slots"])), "daily_cap": a["daily_cap"] or 3,
            "best_hours": (model.get("best_hours") or {}).get(key), "hours": (model.get("hours") or {}).get(key) or [],
        })

    return web.json_response({
        "days": days,
        **summarize(rows),
        "learning": {
            "n": model.get("n", 0), "updated_at": model.get("updated_at"), "insights": model.get("insights") or [],
            "score_corr": model.get("score_corr"), "rubric_corr": model.get("rubric_corr") or {},
            "groups": model.get("groups") or {}, "hours": (model.get("hours") or {}).get("_all") or [],
            "best_hours": (model.get("best_hours") or {}).get("_all"),
        },
        "accounts": acc_out,
        "title_tests": out_tests,
        "translations": list(trans_summary.values()),
        "growth_settings": await load_settings(),
        "languages": LANG_NAMES,
    })


async def refresh_performance(request: web.Request) -> web.Response:
    from src.intelligence.performance_learning import refresh_performance_model
    from src.publisher.analytics import collect_due_metrics, collect_instagram_metrics
    written = 0
    for fn in (collect_due_metrics, collect_instagram_metrics):
        try:
            written += await fn()
        except Exception as e:
            logger.warning("Metrics refresh step failed: %s", e)
    model = await refresh_performance_model()
    return web.json_response({"success": True, "new_snapshots": written, "clips_learned_from": model.get("n", 0)})


async def get_growth_settings(request: web.Request) -> web.Response:
    from src.publisher.growth import load_settings, LANG_NAMES
    return web.json_response({**await load_settings(), "available_languages": LANG_NAMES})


async def put_growth_settings(request: web.Request) -> web.Response:
    from src.publisher.growth import save_settings
    try:
        data = await request.json()
        if not isinstance(data, dict):
            raise ValueError
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    try:
        return web.json_response(await save_settings(data))
    except (TypeError, ValueError) as e:
        return web.json_response({"error": str(e) or "Invalid value"}, status=400)


async def stop_title_test_handler(request: web.Request) -> web.Response:
    from src.publisher.growth import stop_title_test
    try:
        test_id = int(request.match_info["id"])
        data = await request.json() if request.can_read_body else {}
        keep = data.get("keep") if isinstance(data, dict) else None
        test = await stop_title_test(test_id, keep)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)
    except Exception as e:
        logger.warning("Stopping title test failed: %s", e)
        return web.json_response({"error": f"YouTube refused the change: {str(e)[:200]}"}, status=502)
    return web.json_response({"success": True, "current_idx": test["current_idx"]})


def register_performance_routes(app: web.Application) -> None:
    app.router.add_get("/api/performance", get_performance)
    app.router.add_post("/api/performance/refresh", refresh_performance)
    app.router.add_get("/api/growth/settings", get_growth_settings)
    app.router.add_put("/api/growth/settings", put_growth_settings)
    app.router.add_post("/api/title-tests/{id}/stop", stop_title_test_handler)
