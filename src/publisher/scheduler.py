"""Drip-Feed Queue Scheduler: Periodically publishes queued clips spaced by X hours."""

import asyncio
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Callable, Dict, Optional

from config.settings import DRIP_INTERVAL_HOURS, TEMPLATES_DIR
from src.database import (
    get_due_queue_items,
    get_upcoming_queue,
    update_queue_status,
    update_clip_status,
)
from src.publisher.youtube_shorts import YouTubeShortsPublisher, token_project_key
from src.publisher.instagram_reels import InstagramReelsPublisher
from src.publisher.slots import DEFAULT_QUOTA_UNITS, UPLOAD_UNITS, next_quota_reset, record_usage, units_used

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 3
RETRY_DELAY = timedelta(minutes=30)
PERMANENT_ERROR_HINTS = (
    "token file not found", "video file not found", "invalid_grant", "forbidden", "uploadlimitexceeded",
    "quotaexceeded", "youtubesignuprequired", "invalid title", "unauthorized",
)


_IN_FLIGHT: set = set()  # queue ids being uploaded right now (scheduler loop vs. "Post now")


def _is_permanent(error: Optional[str]) -> bool:
    """Errors a retry in 30 minutes can't fix (re-login, missing file, account limits)."""
    e = (error or "").lower().replace(" ", "")
    return any(h.replace(" ", "") in e for h in PERMANENT_ERROR_HINTS)


async def _alert_upload_failure(clip_id: int, title: str, errors: list) -> None:
    from src.notify import alerts
    text = " | ".join(errors)
    low = text.lower()
    if any(h in low for h in ("invalid_grant", "token file not found", "unauthorized", "token has been expired")):
        await alerts.alert("auth", f"YouTube login expired for an account - reconnect it in Channels. "
                                   f"Clip #{clip_id} \"{title}\" was not uploaded: {text}", key="auth:" + low[:60])
    elif "quotaexceeded" in low.replace(" ", "") or "uploadlimitexceeded" in low.replace(" ", ""):
        await alerts.alert("quota", f"YouTube refused clip #{clip_id} \"{title}\": daily limit reached. {text}",
                           key="quota:refused:" + datetime.now(timezone.utc).date().isoformat())
    else:
        await alerts.alert("upload", f"Upload failed for clip #{clip_id} \"{title}\": {text}. "
                                     f"It's back in Approved - use Post now to retry.", key=f"upload:{clip_id}")


def load_template_destinations(template_name: str) -> Dict[str, str]:
    """Retrieve destination account keys for a given template."""
    t_path = Path(TEMPLATES_DIR) / f"{template_name}.json"
    if t_path.exists():
        with open(t_path, "r", encoding="utf-8") as f:
            data = json.load(f)
            return data.get("destinations", {})
    return {}


class DripScheduler:
    """Monitors scheduled_queue table and dispatches multi-platform social media uploads."""

    def __init__(self, on_post_published: Optional[Callable[[Dict[str, Any]], Any]] = None):
        self.on_post_published = on_post_published
        self.is_running = False

    async def run(self) -> None:
        """Main loop: evaluate due items every 60 seconds."""
        self.is_running = True
        logger.info("Drip-feed queue scheduler started (Check interval: 60s, Default drip: %dh).", DRIP_INTERVAL_HOURS)

        while self.is_running:
            try:
                due_items = await get_due_queue_items()
                for item in due_items:
                    await self._process_due_item(item)
            except Exception as e:
                logger.error("Error in drip scheduler loop: %s", e)

            await asyncio.sleep(60)

    async def _process_due_item(self, item: Dict[str, Any]) -> None:
        """Claim the row so the loop and "Post now" can never upload it twice."""
        queue_id = item["id"]
        if queue_id in _IN_FLIGHT:
            return
        _IN_FLIGHT.add(queue_id)
        try:
            await self._process_claimed(item)
        finally:
            _IN_FLIGHT.discard(queue_id)

    async def _process_claimed(self, item: Dict[str, Any]) -> None:
        """Upload one queue row: ONE YouTube account (its own slot/privacy/quota) + Instagram once per clip."""
        queue_id = item["id"]
        clip_id = item["clip_id"]
        account_key = item.get("account_key")
        template_name = item.get("template_name", "ishowspeed_gaming")
        video_path = item.get("rendered_video_path")
        title = item.get("title", "Stream Highlight")
        description = item.get("description", "")
        hashtags = [h.strip() for h in (item.get("hashtags") or "").split() if h.strip()]
        attempts = int(item.get("attempts") or 0)

        destinations = load_template_destinations(template_name)
        channel_id = item.get("channel_id") or ""

        # YouTube target: the row's own account; legacy rows (no account) fall back to mappings
        if account_key:
            yt_keys = [account_key]
        else:
            from src.database import get_accounts_for_streamer
            yt_keys = await get_accounts_for_streamer(channel_id)
            if not yt_keys:
                yt_keys = await get_accounts_for_streamer(channel_id[1:] if channel_id.startswith("@") else f"@{channel_id}")
            if not yt_keys and destinations.get("youtube_account_key"):
                yt_keys = [destinations["youtube_account_key"]]
        ig_key = destinations.get("instagram_account_key")

        account = await self._account(yt_keys[0]) if yt_keys else None
        yt_wanted = bool(yt_keys) and item.get("yt_status") == "pending"
        ig_wanted = bool(ig_key) and item.get("ig_status") == "pending"

        if not yt_wanted and not ig_wanted:
            from src.database import get_db_connection
            msg = f"No YouTube account mapped to @{channel_id} (Distribution > Mappings) and no Instagram destination"
            logger.warning("Queue #%d: %s", queue_id, msg)
            async with get_db_connection() as db:
                await db.execute(
                    "UPDATE scheduled_queue SET yt_status = CASE WHEN yt_status = 'pending' THEN 'skipped' ELSE yt_status END, "
                    "ig_status = CASE WHEN ig_status = 'pending' THEN 'skipped' ELSE ig_status END, last_error = ? WHERE id = ?",
                    (msg, queue_id),
                )
                await db.commit()
            await update_clip_status(clip_id, "approved")
            return

        # Quota guard: never start an upload the Google project can't afford today
        if yt_wanted:
            blocked = await self._quota_blocked(yt_keys[0], account)
            if blocked:
                await self._defer(queue_id, blocked["until"], blocked["reason"])
                from src.notify import alerts
                await alerts.alert("quota", f"YouTube quota is used up for today on @{channel_id} "
                                            f"({account_key or yt_keys[0]}): {blocked['reason']}. Uploads continue "
                                            f"automatically after the reset.",
                                   key=f"quota:{token_project_key(yt_keys[0])}:{blocked['until'].date()}")
                return

        logger.info("Publishing queue #%d (clip #%d, @%s) -> YT %s%s", queue_id, clip_id, channel_id,
                    yt_keys or "none", f" + IG {ig_key}" if ig_wanted else "")
        await update_clip_status(clip_id, "publishing")

        yt_res: Dict[str, Any] = {"success": False, "error": "No YouTube account mapped", "skipped": True}
        ig_res: Dict[str, Any] = {"success": False, "error": "No Instagram account configured", "skipped": True}

        if yt_wanted:
            privacy = (account or {}).get("privacy_status") or "public"
            results = await asyncio.gather(
                *(YouTubeShortsPublisher(k).upload_short(video_path, title, description, hashtags, privacy_status=privacy)
                  for k in yt_keys),
                return_exceptions=True,
            )
            for k, res in zip(yt_keys, results):
                res = res if isinstance(res, dict) else {"success": False, "error": str(res)}
                await self._record_upload_usage(k, res)
                if res.get("success") and not yt_res.get("success"):
                    yt_res = res
                elif not yt_res.get("success"):
                    yt_res = res

        if ig_wanted:
            try:
                ig_res = await InstagramReelsPublisher(ig_key).upload_reel(video_path, title, hashtags)
            except Exception as e:
                ig_res = {"success": False, "error": str(e)}

        def status_for(res: Dict[str, Any], wanted: bool, current: str) -> str:
            if not wanted:
                return current if current in ("uploaded", "skipped") else "skipped"
            return "uploaded" if res.get("success") else "failed"

        yt_status = status_for(yt_res, yt_wanted, item.get("yt_status") or "pending")
        ig_status = status_for(ig_res, ig_wanted, item.get("ig_status") or "pending")
        errors = [f"{name}: {r.get('error')}" for name, r, w in (("YT", yt_res, yt_wanted), ("IG", ig_res, ig_wanted))
                  if w and not r.get("success")]

        # Retry transient failures (network / 5xx) up to 3 attempts, 30 min apart
        retry = errors and attempts + 1 < MAX_ATTEMPTS and not any(_is_permanent(r.get("error")) for r, w in
                                                                      ((yt_res, yt_wanted), (ig_res, ig_wanted)) if w and not r.get("success"))
        from src.database import get_db_connection
        async with get_db_connection() as db:
            if retry:
                when = (datetime.now(timezone.utc) + RETRY_DELAY).isoformat()
                await db.execute(
                    """UPDATE scheduled_queue SET attempts = ?, scheduled_for = ?, last_error = ?,
                       yt_status = CASE WHEN ? = 'failed' THEN 'pending' ELSE ? END,
                       ig_status = CASE WHEN ? = 'failed' THEN 'pending' ELSE ? END,
                       yt_video_id = COALESCE(?, yt_video_id), ig_media_id = COALESCE(?, ig_media_id)
                       WHERE id = ?""",
                    (attempts + 1, when, " | ".join(errors) + f" (retry {attempts + 1}/{MAX_ATTEMPTS - 1})",
                     yt_status, yt_status, ig_status, ig_status, yt_res.get("video_id"), ig_res.get("media_id"), queue_id),
                )
            else:
                await db.execute(
                    """UPDATE scheduled_queue SET attempts = ?, yt_status = ?, ig_status = ?,
                       yt_video_id = COALESCE(?, yt_video_id), ig_media_id = COALESCE(?, ig_media_id), last_error = ?
                       WHERE id = ?""",
                    (attempts + 1, yt_status, ig_status, yt_res.get("video_id"), ig_res.get("media_id"),
                     " | ".join(errors) or None, queue_id),
                )
            await db.commit()

        if yt_res.get("success") or ig_res.get("success"):
            await update_clip_status(clip_id, "published")
        elif retry:
            await update_clip_status(clip_id, "queued")
        else:
            # A failed upload is not a rejection: keep the clip approved so it can be retried by hand.
            logger.warning("Upload failed for clip #%d (queue #%d): %s", clip_id, queue_id, "; ".join(errors))
            await update_clip_status(clip_id, "approved")
            await _alert_upload_failure(clip_id, title, errors)

        if self.on_post_published and (yt_wanted or ig_wanted) and not retry:
            summary = {
                "clip_id": clip_id,
                "title": title,
                "account_key": account_key,
                "yt_url": yt_res.get("url"),
                "ig_url": ig_res.get("url"),
                "yt_success": yt_res.get("success"),
                "ig_success": ig_res.get("success"),
                "errors": " | ".join(errors),
            }
            asyncio.create_task(self.on_post_published(summary))

    @staticmethod
    async def _account(account_key: str) -> Optional[Dict[str, Any]]:
        from src.database import get_youtube_account
        try:
            return await get_youtube_account(account_key)
        except Exception:
            return None

    @staticmethod
    async def _quota_blocked(account_key: str, account: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
        from src.database import get_db_connection
        project = token_project_key(account_key)
        limit = int((account or {}).get("quota_units_per_day") or DEFAULT_QUOTA_UNITS)
        async with get_db_connection() as db:
            used = await units_used(db, project)
        if used + UPLOAD_UNITS <= limit:
            return None
        until = next_quota_reset()
        return {
            "until": until,
            "reason": f"YouTube API quota used up today ({used}/{limit} units for this Google project); "
                      f"moved to after the reset at {until.isoformat()}",
        }

    @staticmethod
    async def _defer(queue_id: int, until: datetime, reason: str) -> None:
        from src.database import get_db_connection
        logger.warning("Queue #%d deferred: %s", queue_id, reason)
        async with get_db_connection() as db:
            await db.execute("UPDATE scheduled_queue SET scheduled_for = ?, last_error = ? WHERE id = ?",
                             (until.isoformat(), reason, queue_id))
            await db.commit()

    @staticmethod
    async def _record_upload_usage(account_key: str, res: Dict[str, Any]) -> None:
        """An upload request that reached YouTube costs quota even when it fails."""
        err = str(res.get("error") or "")
        if not res.get("success") and ("not found" in err.lower() and ("token" in err.lower() or "file" in err.lower())):
            return  # failed locally before calling YouTube
        from src.database import get_db_connection
        async with get_db_connection() as db:
            await record_usage(db, account_key, token_project_key(account_key), "videos.insert",
                               UPLOAD_UNITS, bool(res.get("success")))
            await db.commit()

    @staticmethod
    def calculate_next_slot(hours_offset: int = DRIP_INTERVAL_HOURS) -> str:
        """Calculate next available drip interval slot timestamp in UTC."""
        next_time = datetime.now(timezone.utc) + timedelta(hours=hours_offset)
        return next_time.isoformat()


async def publish_clip_now(clip_id: int, notify: Optional[Callable[[Dict[str, Any]], Any]] = None) -> Dict[str, Any]:
    """"Post now": same path as scheduled uploads (privacy, quota guard, retries, IG once),
    just due immediately. Reuses the clip's existing queue rows when it was already queued."""
    from src.database import get_db_connection
    from src.publisher.slots import schedule_clip

    await schedule_clip(clip_id)  # idempotent: creates rows for mapped channels not yet queued
    now = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE scheduled_queue SET scheduled_for = ? WHERE clip_id = ? AND (yt_status = 'pending' OR ig_status = 'pending')",
            (now, clip_id),
        )
        await db.commit()
        cur = await db.execute(
            """SELECT q.*, c.template_name, c.rendered_video_path, c.title, c.description, c.hashtags, c.channel_id
               FROM scheduled_queue q JOIN clips c ON q.clip_id = c.id
               WHERE q.clip_id = ? AND (q.yt_status = 'pending' OR q.ig_status = 'pending')""",
            (clip_id,),
        )
        rows = [dict(r) for r in await cur.fetchall()]

    runner = DripScheduler(on_post_published=notify)
    for row in rows:
        await runner._process_due_item(row)

    async with get_db_connection() as db:
        cur = await db.execute(
            "SELECT id, account_key, scheduled_for, yt_status, ig_status, yt_video_id, last_error FROM scheduled_queue WHERE clip_id = ?",
            (clip_id,),
        )
        results = [dict(r) for r in await cur.fetchall()]
    uploaded = [r for r in results if r["yt_status"] == "uploaded" or r["ig_status"] == "uploaded"]
    return {
        "success": bool(uploaded),
        "results": results,
        "videos": [f"https://youtube.com/shorts/{r['yt_video_id']}" for r in results if r.get("yt_video_id")],
        "errors": [f"{r['account_key'] or 'default'}: {r['last_error']}" for r in results if r.get("last_error")],
    }

