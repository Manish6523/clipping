"""Channel Supervisor & Lifecycle Manager.

Manages per-channel monitor tasks, state transitions (idle -> starting -> running -> pausing -> paused),
and process isolation with graceful termination.
"""

import asyncio
from datetime import datetime, timezone
import logging
from typing import Any, Callable, Dict, Optional

from src.database import get_db_connection
from src.bot.trimmer import load_template

logger = logging.getLogger(__name__)


class ChannelSupervisor:
    """Supervises a single monitored channel's live watcher, ingestion pipelines, and state transitions."""

    def __init__(
        self,
        channel_id: str,
        platform: str,
        template_name: str,
        on_moment_detected: Optional[Callable] = None,
        on_status_change: Optional[Callable] = None,
    ):
        self.channel_id = channel_id
        self.platform = platform.lower()
        self.template_name = template_name
        self.on_moment_detected = on_moment_detected
        self.on_status_change = on_status_change

        self.state = "idle"  # idle | starting | running | pausing | paused
        self.watcher = None
        self._task: Optional[asyncio.Task] = None
        self._lock = asyncio.Lock()
        self.settings: Dict[str, Any] = {}

    async def initialize(self) -> None:
        """Load initial state and settings from database."""
        async with get_db_connection() as db:
            cur = await db.execute(
                "SELECT enabled, paused_at, pause_reason, template_name, settings_json FROM channels WHERE channel_id_or_handle = ?",
                (self.channel_id,)
            )
            row = await cur.fetchone()
            if row:
                enabled = row[0] if isinstance(row, (list, tuple)) else row["enabled"]
                t_name = row[3] if isinstance(row, (list, tuple)) else row["template_name"]
                if t_name:
                    self.template_name = t_name
                import json
                s_json = row[4] if isinstance(row, (list, tuple)) else row["settings_json"]
                if s_json:
                    try:
                        self.settings = json.loads(s_json)
                    except Exception:
                        pass
                if enabled == 0:
                    self.state = "paused"
                else:
                    self.state = "idle"

    async def start(self) -> bool:
        """Transition from idle/paused to running state."""
        async with self._lock:
            if self.state in ("running", "starting"):
                return True

            self.state = "starting"
            logger.info("Supervisor starting monitoring for %s...", self.channel_id)

            from src.monitor.live_watcher import LiveStreamWatcher
            template = load_template(self.template_name)
            self.watcher = LiveStreamWatcher(
                channel_id=self.channel_id,
                platform=self.platform,
                template_config=template,
                on_viral_moment_detected=self.on_moment_detected,
            )

            self.state = "running"
            self._task = asyncio.create_task(self.watcher.run())

            # Update DB enabled=1
            async with get_db_connection() as db:
                await db.execute(
                    "UPDATE channels SET enabled = 1, paused_at = NULL, pause_reason = NULL WHERE channel_id_or_handle = ?",
                    (self.channel_id,)
                )
                await db.commit()

            if self.on_status_change:
                await self.on_status_change(self.channel_id, "running")
            return True

    async def pause(self, reason: str = "User paused", stop_immediate: bool = False) -> bool:
        """Transition from running to paused state with clean process teardown."""
        async with self._lock:
            if self.state == "paused":
                return True

            self.state = "pausing"
            logger.info("Supervisor pausing channel %s (immediate: %s, reason: %s)...", self.channel_id, stop_immediate, reason)

            if self.watcher:
                self.watcher.is_running = False
                await self.watcher.stop_pipeline()

            if self._task and not self._task.done():
                self._task.cancel()
                try:
                    await asyncio.wait_for(asyncio.shield(self._task), timeout=2.0)
                except (asyncio.CancelledError, asyncio.TimeoutError):
                    pass

            self.state = "paused"

            # Update DB enabled=0
            now_str = datetime.now(timezone.utc).isoformat()
            async with get_db_connection() as db:
                await db.execute(
                    "UPDATE channels SET enabled = 0, paused_at = ?, pause_reason = ? WHERE channel_id_or_handle = ?",
                    (now_str, reason, self.channel_id)
                )
                await db.commit()

            if self.on_status_change:
                await self.on_status_change(self.channel_id, "paused")
            return True

    async def update_settings(self, new_settings: Dict[str, Any], new_template: Optional[str] = None) -> None:
        """Hot-reload channel settings and template configuration."""
        async with self._lock:
            self.settings = new_settings
            if new_template:
                self.template_name = new_template
            if self.watcher and self.state == "running":
                # Reload template
                new_t = load_template(self.template_name)
                self.watcher.template = new_t
                self.watcher.hype_keywords = [k.upper() for k in new_t.get("hype_keywords", [])]
                self.watcher.spike_multiplier = new_t.get("chat_spike_multiplier", 2.5)
                logger.info("Hot-reloaded watcher configuration for %s with template '%s'", self.channel_id, self.template_name)

