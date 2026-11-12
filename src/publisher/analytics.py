"""Collect real YouTube performance for uploaded Shorts and turn it into scoring examples.

- Views / likes / comments come from the Data API (videos.list, 1 quota unit per 50 videos).
- Average % viewed comes from the YouTube Analytics API when the account granted
  yt-analytics.readonly (new logins do); otherwise retention is simply left empty.
- Snapshots are taken 24h, 72h and 7d after the upload.
- ``performance_examples`` feeds a streamer's best / worst Shorts back into the AI prompt.
"""

from __future__ import annotations

import asyncio
import logging
import math
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence

logger = logging.getLogger(__name__)

WINDOWS = {"24h": timedelta(hours=24), "72h": timedelta(hours=72), "7d": timedelta(days=7)}
WINDOW_PRIORITY = ("7d", "72h", "24h")
COLLECT_EVERY_S = 1800
MIN_EXAMPLES = 4


def performance_score(views: int, retention_pct: Optional[float]) -> float:
    """0-100: log-scaled reach (100 ≈ 10M views) blended with retention when known."""
    reach = min(100.0, math.log10(max(0, views) + 1) * 14.3)
    if retention_pct is None:
        return round(reach, 1)
    return round(0.5 * reach + 0.5 * max(0.0, min(100.0, float(retention_pct))), 1)


def due_windows(published: datetime, have: Sequence[str], now: Optional[datetime] = None) -> List[str]:
    now = now or datetime.now(timezone.utc)
    return [w for w, delta in WINDOWS.items() if w not in have and now >= published + delta]


def _fetch_stats_blocking(account_key: str, video_ids: List[str]) -> Dict[str, Dict[str, Any]]:
    from googleapiclient.discovery import build
    from src.publisher.youtube_shorts import credentials_from_token, load_token

    token = load_token(account_key)
    creds = credentials_from_token(token)
    yt = build("youtube", "v3", credentials=creds, cache_discovery=False)
    out: Dict[str, Dict[str, Any]] = {}
    for i in range(0, len(video_ids), 50):
        batch = video_ids[i:i + 50]
        resp = yt.videos().list(part="statistics", id=",".join(batch)).execute()
        for item in resp.get("items", []):
            st = item.get("statistics", {})
            out[item["id"]] = {
                "views": int(st.get("viewCount", 0) or 0),
                "likes": int(st.get("likeCount", 0) or 0),
                "comments": int(st.get("commentCount", 0) or 0),
            }

    scopes = token.get("scopes") or []
    if any("yt-analytics" in s for s in scopes) and out:
        try:
            ya = build("youtubeAnalytics", "v2", credentials=creds, cache_discovery=False)
            today = datetime.now(timezone.utc).date().isoformat()
            report = ya.reports().query(
                ids="channel==MINE", startDate="2020-01-01", endDate=today,
                metrics="averageViewDuration,averageViewPercentage,shares",
                dimensions="video", filters="video==" + ",".join(list(out)[:200]),
            ).execute()
            headers = [h["name"] for h in report.get("columnHeaders", [])]
            for row in report.get("rows", []) or []:
                rec = dict(zip(headers, row))
                vid = rec.get("video")
                if vid in out:
                    out[vid]["avg_view_duration"] = float(rec.get("averageViewDuration") or 0)
                    out[vid]["retention_pct"] = float(rec.get("averageViewPercentage") or 0)
                    out[vid]["shares"] = int(rec.get("shares") or 0)
        except Exception as e:  # analytics is optional
            logger.info("YouTube Analytics unavailable for %s (%s); storing views only.", account_key, e)
    return out


async def collect_due_metrics(now: Optional[datetime] = None) -> int:
    """Fetch snapshots that are due. Returns number of metric rows written."""
    from src.database import get_db_connection
    from src.publisher.slots import record_usage, to_utc
    from src.publisher.youtube_shorts import token_project_key

    now = now or datetime.now(timezone.utc)
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT q.clip_id, q.account_key, q.yt_video_id, q.scheduled_for
               FROM scheduled_queue q
               WHERE q.yt_status = 'uploaded' AND q.yt_video_id IS NOT NULL AND q.account_key IS NOT NULL"""
        )
        uploads = [dict(r) for r in await cur.fetchall()]
        cur = await db.execute("SELECT video_id, window FROM clip_metrics WHERE video_id IS NOT NULL")
        have: Dict[str, List[str]] = {}
        for r in await cur.fetchall():
            have.setdefault(r[0], []).append(r[1])

    todo: Dict[str, List[Dict[str, Any]]] = {}
    for u in uploads:
        published = to_utc(u["scheduled_for"])
        if not published or published < now - timedelta(days=30):
            continue
        wins = due_windows(published, have.get(u["yt_video_id"], []), now)
        if wins:
            todo.setdefault(u["account_key"], []).append({**u, "windows": wins})

    written = 0
    loop = asyncio.get_running_loop()
    for account_key, items in todo.items():
        ids = sorted({i["yt_video_id"] for i in items})
        try:
            stats = await loop.run_in_executor(None, _fetch_stats_blocking, account_key, ids)
        except FileNotFoundError:
            continue
        except Exception as e:
            logger.warning("Metrics fetch failed for %s: %s", account_key, e)
            continue
        async with get_db_connection() as db:
            await record_usage(db, account_key, token_project_key(account_key), "videos.list",
                               max(1, math.ceil(len(ids) / 50)), True)
            for it in items:
                st = stats.get(it["yt_video_id"])
                if not st:
                    continue
                for w in it["windows"]:
                    await db.execute(
                        """INSERT OR IGNORE INTO clip_metrics
                           (clip_id, platform, window, views, avg_view_duration, retention_pct, likes, comments, shares,
                            performance_score, video_id, account_key)
                           VALUES (?, 'youtube', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                        (it["clip_id"], w, st["views"], st.get("avg_view_duration", 0.0), st.get("retention_pct"),
                         st["likes"], st["comments"], st.get("shares", 0),
                         performance_score(st["views"], st.get("retention_pct")), it["yt_video_id"], account_key),
                    )
                    written += 1
            await db.commit()
    if written:
        logger.info("Collected %d YouTube metric snapshot(s).", written)
    return written


async def run_metrics_loop() -> None:
    while True:
        try:
            await collect_due_metrics()
        except Exception as e:
            logger.error("Metrics loop error: %s", e)
        await asyncio.sleep(COLLECT_EVERY_S)


async def performance_examples(channel_id: str, limit: int = 3) -> Optional[str]:
    """Prompt text with this streamer's best and worst Shorts (latest snapshot per video)."""
    from src.database import get_db_connection

    handle = (channel_id or "").strip()
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT c.title, m.views, m.retention_pct, m.performance_score, m.window
               FROM clip_metrics m JOIN clips c ON c.id = m.clip_id
               WHERE lower(c.channel_id) IN (lower(?), lower(?), lower(?)) AND m.platform = 'youtube'
               ORDER BY m.video_id, CASE m.window WHEN '7d' THEN 0 WHEN '72h' THEN 1 ELSE 2 END""",
            (handle, handle.lstrip("@"), "@" + handle.lstrip("@")),
        )
        rows = [dict(r) for r in await cur.fetchall()]
    latest: Dict[str, Dict[str, Any]] = {}
    for r in rows:  # first row per title is the best window (ordered by priority)
        latest.setdefault(r["title"], r)
    clips = sorted(latest.values(), key=lambda r: r["performance_score"] or 0, reverse=True)
    if len(clips) < MIN_EXAMPLES:
        return None

    def fmt(r):
        ret = f", {r['retention_pct']:.0f}% viewed" if r.get("retention_pct") else ""
        return f'"{r["title"]}" ({r["views"]:,} views{ret}, {r["window"]})'

    best = "; ".join(fmt(r) for r in clips[:limit])
    worst = "; ".join(fmt(r) for r in clips[-limit:])
    return (f"Their Shorts that performed BEST: {best}. Performed WORST: {worst}. "
            "Favour moments like the best ones; avoid the patterns of the worst.")
