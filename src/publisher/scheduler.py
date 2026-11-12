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
from src.publisher.youtube_shorts import YouTubeShortsPublisher
from src.publisher.instagram_reels import InstagramReelsPublisher

logger = logging.getLogger(__name__)


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
        """Execute parallel publishing for YouTube Shorts and Instagram Reels."""
        queue_id = item["id"]
        clip_id = item["clip_id"]
        template_name = item.get("template_name", "ishowspeed_gaming")
        video_path = item.get("rendered_video_path")
        title = item.get("title", "Stream Highlight")
        description = item.get("description", "")
        hashtags_raw = item.get("hashtags", "")
        hashtags = [h.strip() for h in hashtags_raw.split() if h.strip()]

        destinations = load_template_destinations(template_name)
        channel_id = item.get("channel_id") or ""
        
        # Check mapped YouTube accounts for streamer
        from src.database import get_accounts_for_streamer
        mapped_yt_keys = await get_accounts_for_streamer(channel_id)
        if not mapped_yt_keys and channel_id.startswith("@"):
            mapped_yt_keys = await get_accounts_for_streamer(channel_id[1:])
        elif not mapped_yt_keys:
            mapped_yt_keys = await get_accounts_for_streamer(f"@{channel_id}")

        if not mapped_yt_keys and destinations.get("youtube_account_key"):
            mapped_yt_keys = [destinations.get("youtube_account_key")]

        ig_key = destinations.get("instagram_account_key")

        logger.info("Executing scheduled upload for queue #%d (Clip #%d, Streamer: %s, Mapped YT: %s)...", 
                    queue_id, clip_id, channel_id, mapped_yt_keys)
        await update_clip_status(clip_id, "publishing")

        yt_res = {"success": False, "error": "No YT account configured"}
        ig_res = {"success": False, "error": "No IG account configured"}

        # 1. Multi-account YouTube Shorts Upload
        if mapped_yt_keys and item.get("yt_status") == "pending":
            yt_upload_tasks = []
            for yk in mapped_yt_keys:
                pub = YouTubeShortsPublisher(yk)
                yt_upload_tasks.append(pub.upload_short(video_path, title, description, hashtags))
            yt_results = await asyncio.gather(*yt_upload_tasks, return_exceptions=True)
            
            # Select first successful or last result
            for res in yt_results:
                if not isinstance(res, Exception) and res.get("success"):
                    yt_res = res
                    break
            if not yt_res.get("success") and yt_results:
                first = yt_results[0]
                yt_res = first if not isinstance(first, Exception) else {"success": False, "error": str(first)}

        # 2. Instagram Reels Upload
        if ig_key and item.get("ig_status") == "pending":
            try:
                ig_pub = InstagramReelsPublisher(ig_key)
                ig_res = await ig_pub.upload_reel(video_path, title, hashtags)
            except Exception as e:
                ig_res = {"success": False, "error": str(e)}

        # Update database statuses
        yt_status = "uploaded" if yt_res.get("success") else "failed"
        ig_status = "uploaded" if ig_res.get("success") else "failed"

        await update_queue_status(
            queue_id=queue_id,
            yt_status=yt_status,
            ig_status=ig_status,
            yt_video_id=yt_res.get("video_id"),
            ig_media_id=ig_res.get("media_id"),
            last_error=f"YT: {yt_res.get('error')} | IG: {ig_res.get('error')}" if (not yt_res.get("success") or not ig_res.get("success")) else None,
        )

        # A failed upload is not a rejection: keep the clip approved so it can be retried
        # (error details are stored on the queue row and sent in the publish notification).
        overall_status = "published" if (yt_res.get("success") or ig_res.get("success")) else "approved"
        if overall_status == "approved":
            logger.warning("Upload failed for clip #%d; kept as approved for retry. YT: %s | IG: %s",
                           clip_id, yt_res.get("error"), ig_res.get("error"))
        await update_clip_status(clip_id, overall_status)

        # Notify via callback if registered
        if self.on_post_published:
            summary = {
                "clip_id": clip_id,
                "title": title,
                "yt_url": yt_res.get("url"),
                "ig_url": ig_res.get("url"),
                "yt_success": yt_res.get("success"),
                "ig_success": ig_res.get("success"),
                "errors": f"YT: {yt_res.get('error')} | IG: {ig_res.get('error')}",
            }
            asyncio.create_task(self.on_post_published(summary))

    @staticmethod
    def calculate_next_slot(hours_offset: int = DRIP_INTERVAL_HOURS) -> str:
        """Calculate next available drip interval slot timestamp in UTC."""
        next_time = datetime.now(timezone.utc) + timedelta(hours=hours_offset)
        return next_time.isoformat()

