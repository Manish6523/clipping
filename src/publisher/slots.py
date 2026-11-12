"""Per-channel publishing slots, daily caps and YouTube API quota accounting.

Every queue row targets ONE YouTube account and is placed in that account's next free
posting slot (e.g. 12:30 / 17:30 / 21:30 Asia/Kolkata) without exceeding its daily cap.
YouTube Data API quota (10,000 units/day per Google Cloud project; an upload costs 1,600)
resets at midnight Pacific Time, so usage is bucketed by the Pacific date.
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, time, timedelta, timezone
from typing import Any, Dict, Iterable, List, Optional, Sequence
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

logger = logging.getLogger(__name__)

DEFAULT_SLOTS = ["12:30", "17:30", "21:30"]
DEFAULT_TZ = "Asia/Kolkata"
DEFAULT_DAILY_CAP = 3
DEFAULT_QUOTA_UNITS = 10000
UPLOAD_UNITS = 1600
PACIFIC = ZoneInfo("America/Los_Angeles")
MIN_LEAD = timedelta(minutes=2)       # never schedule a slot that starts right now
SLOT_TOLERANCE = timedelta(minutes=1)  # two items closer than this occupy the same slot
SEARCH_DAYS = 60


def parse_slots(raw: Any) -> List[time]:
    """'["12:30","17:30"]' / list / '12:30, 17:30' -> sorted unique times. Invalid -> defaults."""
    items: Iterable[Any]
    if isinstance(raw, str):
        try:
            items = json.loads(raw)
        except (ValueError, TypeError):
            items = raw.split(",")
    elif isinstance(raw, (list, tuple)):
        items = raw
    else:
        items = []
    out = set()
    for it in items:
        try:
            hh, mm = str(it).strip().split(":")[:2]
            h, m = int(hh), int(mm)
            if 0 <= h <= 23 and 0 <= m <= 59:
                out.add(time(h, m))
        except (ValueError, AttributeError):
            continue
    return sorted(out) or [time(*map(int, s.split(":"))) for s in DEFAULT_SLOTS]


def slots_to_strings(slots: Sequence[time]) -> List[str]:
    return [f"{t.hour:02d}:{t.minute:02d}" for t in slots]


def get_tz(name: Optional[str]) -> ZoneInfo:
    try:
        return ZoneInfo(name or DEFAULT_TZ)
    except (ZoneInfoNotFoundError, ValueError):
        return ZoneInfo(DEFAULT_TZ)


def to_utc(dt: Any) -> Optional[datetime]:
    """Parse stored timestamps (ISO with/without offset, or SQLite 'YYYY-MM-DD HH:MM:SS' = UTC)."""
    if isinstance(dt, datetime):
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
    if not dt:
        return None
    try:
        parsed = datetime.fromisoformat(str(dt).replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=timezone.utc)


def next_slot(
    account: Dict[str, Any],
    taken: Sequence[datetime],
    now: Optional[datetime] = None,
) -> datetime:
    """Earliest free slot (UTC) for ``account`` given its already-scheduled times ``taken``."""
    now = (now or datetime.now(timezone.utc)).astimezone(timezone.utc)
    tz = get_tz(account.get("timezone"))
    slots = parse_slots(account.get("publish_slots"))
    try:
        cap = max(1, int(account.get("daily_cap") or DEFAULT_DAILY_CAP))
    except (TypeError, ValueError):
        cap = DEFAULT_DAILY_CAP

    taken_utc = [t.astimezone(timezone.utc) for t in (to_utc(x) for x in taken) if t]
    per_day: Dict[Any, int] = {}
    for t in taken_utc:
        d = t.astimezone(tz).date()
        per_day[d] = per_day.get(d, 0) + 1

    local_now = now.astimezone(tz)
    for offset in range(SEARCH_DAYS):
        day = local_now.date() + timedelta(days=offset)
        if per_day.get(day, 0) >= cap:
            continue
        for slot in slots:
            candidate = datetime.combine(day, slot, tzinfo=tz).astimezone(timezone.utc)
            if candidate < now + MIN_LEAD:
                continue
            if any(abs(candidate - t) < SLOT_TOLERANCE for t in taken_utc):
                continue
            return candidate
    # Fully booked for 60 days: append after the last item
    return max(taken_utc + [now]) + timedelta(hours=4)


def quota_day(at: Optional[datetime] = None) -> str:
    """YouTube quota resets at midnight Pacific Time."""
    return (at or datetime.now(timezone.utc)).astimezone(PACIFIC).date().isoformat()


def next_quota_reset(at: Optional[datetime] = None) -> datetime:
    local = (at or datetime.now(timezone.utc)).astimezone(PACIFIC)
    midnight = datetime.combine(local.date() + timedelta(days=1), time(0, 5), tzinfo=PACIFIC)
    return midnight.astimezone(timezone.utc)


# ---------------------------------------------------------------------------
# DB-backed helpers
# ---------------------------------------------------------------------------

async def account_taken_times(db, account_key: str) -> List[datetime]:
    cur = await db.execute(
        "SELECT scheduled_for FROM scheduled_queue WHERE account_key = ? AND yt_status IN ('pending', 'uploaded')",
        (account_key,),
    )
    rows = await cur.fetchall()
    return [t for t in (to_utc(r[0]) for r in rows) if t]


async def units_used(db, project_key: str, day: Optional[str] = None) -> int:
    cur = await db.execute(
        "SELECT COALESCE(SUM(units), 0) FROM youtube_api_usage WHERE project_key = ? AND quota_day = ?",
        (project_key, day or quota_day()),
    )
    row = await cur.fetchone()
    return int(row[0] or 0)


async def record_usage(db, account_key: str, project_key: str, operation: str, units: int, success: bool) -> None:
    await db.execute(
        "INSERT INTO youtube_api_usage (account_key, project_key, operation, units, quota_day, success) VALUES (?, ?, ?, ?, ?, ?)",
        (account_key, project_key, operation, int(units), quota_day(), 1 if success else 0),
    )


async def schedule_clip(clip_id: int, account_keys: Optional[Sequence[str]] = None) -> List[Dict[str, Any]]:
    """Queue a clip for each destination YouTube account in that account's next free slot.

    ``account_keys`` defaults to the accounts mapped to the clip's streamer. Clips with no
    mapped account get a single legacy row (account_key NULL) at the drip interval.
    Instagram (if configured on the template) is handled once, on the first row only.
    Idempotent: an account that already has a pending/uploaded row for this clip is skipped.
    """
    from src.database import get_db_connection
    from config.settings import DRIP_INTERVAL_HOURS

    async with get_db_connection() as db:
        cur = await db.execute("SELECT id, channel_id FROM clips WHERE id = ?", (clip_id,))
        clip = await cur.fetchone()
        if not clip:
            raise ValueError(f"Clip #{clip_id} not found")
        channel = (clip["channel_id"] or "").strip()

        if account_keys is None:
            cur = await db.execute(
                """SELECT DISTINCT m.account_key FROM streamer_yt_mappings m
                   JOIN youtube_accounts a ON a.account_key = m.account_key AND a.is_active = 1
                   WHERE lower(m.streamer_handle) IN (lower(?), lower(?), lower(?))""",
                (channel, channel.lstrip("@"), "@" + channel.lstrip("@")),
            )
            account_keys = [r[0] for r in await cur.fetchall()]

        cur = await db.execute(
            "SELECT account_key FROM scheduled_queue WHERE clip_id = ? AND yt_status IN ('pending', 'uploaded')",
            (clip_id,),
        )
        already = {r[0] for r in await cur.fetchall()}

        created: List[Dict[str, Any]] = []
        targets = [k for k in account_keys if k not in already] if account_keys else ([] if already else [None])
        for i, key in enumerate(targets):
            if key is None:
                when = datetime.now(timezone.utc) + timedelta(hours=DRIP_INTERVAL_HOURS)
            else:
                cur = await db.execute("SELECT * FROM youtube_accounts WHERE account_key = ?", (key,))
                acc = await cur.fetchone()
                when = next_slot(dict(acc) if acc else {}, await account_taken_times(db, key))
            ig_status = "pending" if (i == 0 and not already) else "skipped"
            cur = await db.execute(
                "INSERT INTO scheduled_queue (clip_id, account_key, scheduled_for, yt_status, ig_status) VALUES (?, ?, ?, 'pending', ?)",
                (clip_id, key, when.isoformat(), ig_status),
            )
            created.append({"queue_id": cur.lastrowid, "account_key": key, "scheduled_for": when.isoformat()})

        if created or already:
            await db.execute("UPDATE clips SET status = 'queued', updated_at = CURRENT_TIMESTAMP WHERE id = ?", (clip_id,))
        await db.commit()
        return created
