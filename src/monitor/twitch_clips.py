"""Twitch community clips as a signal: if viewers bothered to clip a moment, it is almost
certainly good.

- Live: every minute, new clips of a live channel (Helix `clips`, created in the last few
  minutes) trigger a capture from the ring buffer around the clip's time - even when chat and
  audio stayed calm. Several viewers clipping the same moment counts as a stronger signal.
- VOD: clips made during a past broadcast carry `vod_offset`, so their windows are known.
  The judge is told about them, and candidates overlapping a community clip get a boost.

Needs TWITCH_CLIENT_ID / TWITCH_CLIENT_SECRET (an app access token). Without them it does nothing.
"""

from __future__ import annotations

import logging
import math
import re
import time
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

import aiohttp

logger = logging.getLogger(__name__)

HELIX = "https://api.twitch.tv/helix"
GROUP_GAP_S = 40.0           # clips created this close together are the same moment
LIVE_LOOKBACK_S = 180        # the ring buffer holds 4 minutes; older clips can't be cut any more
MAX_BOOST = 10.0

_token: Dict[str, Any] = {}
_ids: Dict[str, str] = {}


def _creds() -> Tuple[str, str]:
    from config.settings import TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET
    return TWITCH_CLIENT_ID or "", TWITCH_CLIENT_SECRET or ""


def enabled() -> bool:
    cid, secret = _creds()
    return bool(cid and secret)


async def _app_token(session: aiohttp.ClientSession) -> Optional[str]:
    if _token.get("expires_at", 0) > time.time() + 60:
        return _token["token"]
    cid, secret = _creds()
    if not cid or not secret:
        return None
    async with session.post("https://id.twitch.tv/oauth2/token",
                            data={"client_id": cid, "client_secret": secret, "grant_type": "client_credentials"},
                            timeout=aiohttp.ClientTimeout(total=8)) as resp:
        if resp.status != 200:
            logger.debug("Twitch app token failed: HTTP %s", resp.status)
            return None
        data = await resp.json()
    _token.update(token=data.get("access_token"), expires_at=time.time() + float(data.get("expires_in") or 3600))
    return _token["token"]


async def helix(path: str, params: Any) -> Optional[Dict[str, Any]]:
    """GET a Helix endpoint (None when not configured or on any error)."""
    if not enabled():
        return None
    try:
        async with aiohttp.ClientSession() as session:
            token = await _app_token(session)
            if not token:
                return None
            headers = {"Client-Id": _creds()[0], "Authorization": f"Bearer {token}"}
            async with session.get(f"{HELIX}/{path}", params=params, headers=headers,
                                   timeout=aiohttp.ClientTimeout(total=10)) as resp:
                if resp.status == 401:
                    _token.clear()
                if resp.status != 200:
                    logger.debug("Helix %s -> HTTP %s", path, resp.status)
                    return None
                return await resp.json()
    except Exception as e:
        logger.debug("Helix %s failed: %s", path, e)
        return None


async def broadcaster_id(login: str) -> Optional[str]:
    login = (login or "").strip().lstrip("@").lower()
    if login in _ids:
        return _ids[login]
    data = await helix("users", {"login": login})
    users = (data or {}).get("data") or []
    if users:
        _ids[login] = users[0]["id"]
        return _ids[login]
    return None


def rfc3339(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(s: Optional[str]) -> Optional[datetime]:
    if not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


def parse_twitch_duration(s: Optional[str]) -> Optional[float]:
    """'3h2m1s' -> 10921.0"""
    if not s:
        return None
    m = re.fullmatch(r"(?:(\d+)h)?(?:(\d+)m)?(?:(\d+)s)?", s.strip())
    if not m or not any(m.groups()):
        return None
    h, mi, se = (int(x or 0) for x in m.groups())
    return float(h * 3600 + mi * 60 + se)


async def clips_between(login: str, start: datetime, end: datetime, max_pages: int = 5) -> List[Dict[str, Any]]:
    bid = await broadcaster_id(login)
    if not bid:
        return []
    out: List[Dict[str, Any]] = []
    cursor = None
    for _ in range(max_pages):
        params = {"broadcaster_id": bid, "started_at": rfc3339(start), "ended_at": rfc3339(end), "first": "100"}
        if cursor:
            params["after"] = cursor
        data = await helix("clips", params)
        if not data:
            break
        out.extend(data.get("data") or [])
        cursor = (data.get("pagination") or {}).get("cursor")
        if not cursor:
            break
    return out


# ----------------------------------------------------------------------------- pure helpers
def group_moments(clips: Sequence[Dict[str, Any]], gap: float = GROUP_GAP_S) -> List[Dict[str, Any]]:
    """Clips made close together (by creation time) are one moment: count, views, titles."""
    items = sorted((c for c in clips if parse_time(c.get("created_at"))), key=lambda c: c["created_at"])
    groups: List[Dict[str, Any]] = []
    for c in items:
        t = parse_time(c["created_at"])
        if groups and (t - groups[-1]["last"]).total_seconds() <= gap:
            g = groups[-1]
            g["clips"].append(c)
            g["last"] = t
        else:
            groups.append({"first": t, "last": t, "clips": [c]})
    out = []
    for g in groups:
        out.append({
            "created_at": g["last"], "first_at": g["first"], "count": len(g["clips"]),
            "views": sum(int(c.get("view_count") or 0) for c in g["clips"]),
            "titles": [c.get("title") for c in g["clips"] if c.get("title")][:3],
            "ids": [c.get("id") for c in g["clips"]],
            "duration": max(float(c.get("duration") or 30) for c in g["clips"]),
        })
    return out


def vod_clips(clips: Sequence[Dict[str, Any]], vod_id: str) -> List[Dict[str, Any]]:
    """Clips of one VOD with a known position: [{offset, duration, views, title}] sorted by offset."""
    out = []
    for c in clips:
        if str(c.get("video_id") or "") != str(vod_id) or c.get("vod_offset") in (None, ""):
            continue
        out.append({"offset": float(c["vod_offset"]), "duration": float(c.get("duration") or 30),
                    "views": int(c.get("view_count") or 0), "title": c.get("title") or ""})
    return sorted(out, key=lambda x: x["offset"])


def community_clip_windows(clips: Optional[Sequence[Dict[str, Any]]]) -> List[Tuple[float, float, int]]:
    """(start, end, views) windows on the source timeline (VOD clips with offsets only)."""
    out = []
    for c in clips or []:
        try:
            s = float(c["offset"])
            out.append((s, s + float(c.get("duration") or 30), int(c.get("views") or 0)))
        except (KeyError, TypeError, ValueError):
            continue
    return out


def community_boost(start: float, end: float, windows: Sequence[Tuple[float, float, int]]) -> Tuple[float, List[str]]:
    """Points for a candidate that overlaps viewer-made clips: 5 + up to 3 for their views + 1 per
    extra clip, capped at MAX_BOOST. Overlap must cover 8 s or 40% of the candidate."""
    if not windows or end <= start:
        return 0.0, []
    hits = []
    for ws, we, views in windows:
        overlap = min(end, we) - max(start, ws)
        if overlap >= min(8.0, 0.4 * (end - start)):
            hits.append(views)
    if not hits:
        return 0.0, []
    pts = 5.0 + min(3.0, math.log10(max(hits) + 1)) + (len(hits) - 1)
    pts = round(min(MAX_BOOST, pts), 1)
    word = "clip" if len(hits) == 1 else "clips"
    return pts, [f"Viewers made {len(hits)} Twitch {word} of this moment ({sum(hits):,} views)"]


def describe_community_clips(clips: Optional[Sequence[Dict[str, Any]]], limit: int = 8) -> str:
    """Prompt text: what viewers clipped (VOD offsets) or how many clipped this live moment."""
    if not clips:
        return ""
    if isinstance(clips, dict):           # live trigger context
        n = clips.get("count") or 0
        titles = "; ".join(f'"{t}"' for t in (clips.get("titles") or [])[:3])
        return (f"Community signal: {n} viewer(s) made a Twitch clip of this moment" + (f" ({titles})" if titles else "")
                + ". Viewers clipping it is strong evidence it is good - pick the part they reacted to.")
    top = sorted(clips, key=lambda c: c.get("views") or 0, reverse=True)[:limit]
    lines = [f"- {int(c['offset']) // 60}:{int(c['offset']) % 60:02d} ({c.get('views', 0):,} views) \"{c.get('title', '')[:80]}\""
             for c in sorted(top, key=lambda c: c["offset"])]
    return ("Viewers made Twitch clips at these points of the broadcast (time = position in the source; clips cover "
            "about the 30 s before it). Strongly favour moments that overlap them:\n" + "\n".join(lines))


# ----------------------------------------------------------------------------- VOD
async def fetch_vod_community_clips(login: str, vod_id: str) -> List[Dict[str, Any]]:
    """All community clips with a position in this Twitch VOD (best-effort, [] on any problem)."""
    data = await helix("videos", {"id": str(vod_id)})
    vids = (data or {}).get("data") or []
    if not vids:
        return []
    created = parse_time(vids[0].get("created_at"))
    dur = parse_twitch_duration(vids[0].get("duration")) or 12 * 3600
    if not created:
        return []
    raw = await clips_between(login, created - timedelta(minutes=5), created + timedelta(seconds=dur) + timedelta(hours=2))
    found = vod_clips(raw, vod_id)
    # the most-watched 40 are plenty of signal and keep the judge prompt small
    found = sorted(sorted(found, key=lambda c: c["views"], reverse=True)[:40], key=lambda c: c["offset"])
    if found:
        logger.info("Twitch VOD %s: %d community clip(s) found as signal.", vod_id, len(found))
    return found


async def recent_moments(login: str, since_s: float = LIVE_LOOKBACK_S, now: Optional[datetime] = None) -> List[Dict[str, Any]]:
    now = now or datetime.now(timezone.utc)
    return group_moments(await clips_between(login, now - timedelta(seconds=since_s), now, max_pages=1))
