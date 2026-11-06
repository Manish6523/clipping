"""AutoClipDaemon - Autonomous Live & VOD Social Media Clipping Engine.

Async entrypoint orchestrating database, stream watchers, AI intelligence pipeline,
compositor rendering, Telegram bot control plane, Web UI dashboard, and drip scheduler.

All imports placed at the top of the file according to standards.
"""

import asyncio
import json
import logging
import signal
import sys
import time
from pathlib import Path
from typing import Any, Dict, Optional

# Ensure standard output can handle UTF-8 symbols & emojis without cp1252 charmap crashes
if hasattr(sys.stdout, "reconfigure"):
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
if hasattr(sys.stderr, "reconfigure"):
    sys.stderr.reconfigure(encoding="utf-8", errors="replace")

from config.settings import (
    TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID,
    TEMPLATES_DIR,
    RENDER_DIR,
    WEB_HOST,
    WEB_PORT,
)
from src.database import (
    init_db,
    get_active_channels,
    create_clip,
    get_clip,
    update_clip_rendered_path,
)
from src.bot.telegram_bot import AutoClipBot
from src.bot.trimmer import load_template
from src.compositor.ass_generator import generate_ass_subtitles
from src.compositor.ffmpeg_renderer import FFmpegRenderer
from src.intelligence.transcriber import Transcriber
from src.intelligence.viral_scorer import ViralScorer
from src.monitor.live_watcher import LiveStreamWatcher
from src.monitor.vod_watcher import VODWatcher
from src.publisher.scheduler import DripScheduler
from src.web.server import WebUIServer
from src.web.logger_stream import update_pipeline_progress, WebLogHandler

# Setup unified logging for terminal and Web UI
root_logger = logging.getLogger()
root_logger.setLevel(logging.INFO)

# Clear existing handlers
root_logger.handlers.clear()

log_formatter = logging.Formatter(
    "%(asctime)s [%(levelname)-5s] [%(name)s] %(message)s",
    datefmt="%H:%M:%S"
)

console_handler = logging.StreamHandler(sys.stdout)
console_handler.setFormatter(log_formatter)
root_logger.addHandler(console_handler)

web_handler = WebLogHandler()
web_handler.setFormatter(log_formatter)
root_logger.addHandler(web_handler)

logger = logging.getLogger("AutoClipDaemon")


class AutoClipEngine:
    """Master engine orchestrating ingestion, intelligence, composition, web UI, and publishing."""

    def __init__(self):
        self.bot = AutoClipBot(
            token=TELEGRAM_BOT_TOKEN,
            admin_id=ADMIN_CHAT_ID,
            on_manual_clip=self._on_manual_clip,
        )
        self.transcriber = Transcriber(model_size="base")
        self.scorer = ViralScorer()
        self.renderer = FFmpegRenderer()
        self.scheduler = DripScheduler(on_post_published=self._on_drip_post_published)
        self.vod_watcher = VODWatcher(on_vod_clip_ready=self._on_vod_event)
        self.web_server = WebUIServer(
            host=WEB_HOST,
            port=WEB_PORT,
            on_manual_clip=self._on_manual_clip,
        )
        self.active_live_watchers: Dict[str, LiveStreamWatcher] = {}
        self.running = False

    async def initialize(self) -> None:
        """Initialize database and verify configuration."""
        logger.info("Initializing AutoClipDaemon database schema...")
        await init_db()
        logger.info("AutoClipDaemon initialized successfully.")

    async def _on_manual_clip(self, url: str, template_name: str, time_range: Optional[str] = None) -> None:
        """Handle manual URL clip triggered from Web UI or Telegram (/clip)."""
        logger.info("Processing manual clip for URL: %s (Template: %s, TimeRange: %s)", url, template_name, time_range)
        timestamp_id = int(time.time())
        fake_vod_id = f"manual_{timestamp_id}"
        work_dir = Path(RENDER_DIR) / "manual" / fake_vod_id
        work_dir.mkdir(parents=True, exist_ok=True)
        template = load_template(template_name)

        update_pipeline_progress(
            "processing",
            channel_id="manual",
            step=1,
            step_name=f"Manual Clip Started ({template_name})",
            trigger_reason="manual_url",
        )

        try:
            if time_range and "-" in time_range:
                parts = time_range.split("-")
                start_sec = float(parts[0].strip())
                end_sec = float(parts[1].strip())
                clip_dur = max(5.0, end_sec - start_sec)

                update_pipeline_progress("processing", channel_id="manual", step=2, step_name=f"Downloading section {start_sec:.1f}s - {end_sec:.1f}s...")
                slice_source = work_dir / f"{fake_vod_id}_slice.mp4"
                downloaded = await self.vod_watcher.download_video_section(
                    video_url=url,
                    start_time=start_sec,
                    end_time=end_sec,
                    output_file=slice_source,
                )

                if not downloaded or not slice_source.exists():
                    logger.error("Failed to download targeted manual section.")
                    update_pipeline_progress("error", channel_id="manual", error="Download failed")
                    return

                update_pipeline_progress("processing", channel_id="manual", step=3, step_name="Transcribing words with faster-whisper...")
                transcription = await self.transcriber.transcribe(str(slice_source))
                ass_path = str(work_dir / f"{fake_vod_id}_sub.ass")

                generate_ass_subtitles(
                    word_timestamps=transcription.get("words", []),
                    output_path=ass_path,
                    template_config=template,
                    time_offset=0.0,
                    max_duration=clip_dur,
                )

                update_pipeline_progress("processing", channel_id="manual", step=4, step_name=f"Compositing 9:16 vertical layout ({template_name})...")
                rendered_mp4 = str(work_dir / f"{fake_vod_id}_vertical.mp4")
                await self.renderer.render_clip(
                    source_path=str(slice_source),
                    start_time=0.0,
                    end_time=clip_dur,
                    output_path=rendered_mp4,
                    template=template,
                    ass_path=ass_path,
                    teaser_timestamp=None,
                    include_teaser=False,
                )

                clip_id = await create_clip(
                    source_type="vod",
                    source_id=fake_vod_id,
                    channel_id="manual",
                    template_name=template_name,
                    raw_start=start_sec,
                    raw_end=end_sec,
                    virality_score=85,
                    title=f"Manual Highlight ({template_name})",
                    teaser_hook_timestamp=None,
                    description=transcription.get("text", "")[:100],
                    hashtags="#Shorts #Reels #Viral",
                    source_video_path=str(slice_source),
                    rendered_video_path=rendered_mp4,
                    subtitle_path=ass_path,
                )

                update_pipeline_progress("completed", channel_id="manual", step=5, step_name=f"Clip #{clip_id} Ready! Sent to Telegram.", clip_id=clip_id)

                from src.web.ws_manager import ws_manager
                await ws_manager.broadcast("clip_created", {
                    "id": clip_id,
                    "clip_id": clip_id,
                    "channel_id": "manual",
                    "title": f"Manual Highlight ({template_name})",
                    "virality_score": 85,
                    "template_name": template_name,
                    "rendered_video_path": rendered_mp4,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                })

                clip_record = await get_clip(clip_id)
                if clip_record:
                    await self.bot.send_clip_card(clip_record)

                async def _reset():
                    await asyncio.sleep(20)
                    update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
                asyncio.create_task(_reset())
                return

            # Automated hook discovery
            await self.vod_watcher.process_vod(
                platform="youtube" if "youtu" in url else "twitch",
                channel_id="manual",
                vod_id=fake_vod_id,
                title=f"Manual Clip ({template_name})",
                video_url=url,
                template_name=template_name,
            )

        except Exception as e:
            logger.error("Manual clip processing failed: %s", e, exc_info=True)
            update_pipeline_progress("error", channel_id="manual", error=str(e))

    async def _on_live_moment(self, video_path: str, metadata: Dict[str, Any]) -> None:
        """Handler triggered when LiveStreamWatcher detects a chat velocity or audio peak spike."""
        channel_id = metadata.get("channel_id", "unknown")
        reason = metadata.get("trigger_reason", "hype")
        logger.info("Processing live highlight for creator '%s': %s", channel_id, video_path)

        update_pipeline_progress(
            "processing",
            channel_id=channel_id,
            step=2,
            step_name=f"Transcribing 75s audio with faster-whisper ({reason})...",
            trigger_reason=reason,
        )

        try:
            transcription = await self.transcriber.transcribe(video_path)

            template_name = metadata.get("template_name")
            if not template_name:
                # Query channel's assigned template from DB
                from src.database import get_db_connection
                async with get_db_connection() as db:
                    cur = await db.execute("SELECT template_name FROM channels WHERE channel_id_or_handle = ?", (channel_id,))
                    row = await cur.fetchone()
                    if row and row[0]:
                        template_name = row[0]
            if not template_name:
                template_name = "Bottom Left"

            template = load_template(template_name)
            min_score = template.get("min_virality_score", 70)

            update_pipeline_progress(
                "processing",
                channel_id=channel_id,
                step=3,
                step_name="Evaluating viral hooks with Gemini AI...",
            )

            candidates = await self.scorer.analyze_transcript(
                transcript_data=transcription,
                min_score=min_score,
            )

            if not candidates:
                logger.info("No candidates passed min_virality_score threshold (%d). Discarding.", min_score)
                update_pipeline_progress("idle", channel_id=channel_id, step=0, step_name=f"No clips above score {min_score}. Returning to live watch.")
                # Auto-reset banner after 10s
                async def _clear_banner():
                    await asyncio.sleep(10)
                    update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
                asyncio.create_task(_clear_banner())
                return

            best_candidate = candidates[0]
            logger.info("Selected viral candidate: '%s' (Score: %d/100)", best_candidate.suggested_title, best_candidate.virality_score)

            clip_start = best_candidate.start_time
            clip_end = best_candidate.end_time
            clip_dur = clip_end - clip_start

            timestamp_id = int(metadata.get("timestamp", 0))
            ass_path = str(Path(RENDER_DIR) / f"live_{channel_id}_{timestamp_id}.ass")
            ass_json_cache = Path(ass_path).with_suffix(".json")

            with open(ass_json_cache, "w", encoding="utf-8") as f:
                json.dump(transcription.get("words", []), f)

            generate_ass_subtitles(
                word_timestamps=transcription.get("words", []),
                output_path=ass_path,
                template_config=template,
                time_offset=clip_start,
                max_duration=clip_dur,
            )

            update_pipeline_progress(
                "processing",
                channel_id=channel_id,
                step=4,
                step_name=f"Rendering 9:16 layout ({template_name}) & burning kinetic captions...",
            )

            rendered_mp4 = str(Path(RENDER_DIR) / f"live_{channel_id}_{timestamp_id}_final.mp4")
            await self.renderer.render_clip(
                source_path=video_path,
                start_time=clip_start,
                end_time=clip_end,
                output_path=rendered_mp4,
                template=template,
                ass_path=ass_path,
                teaser_timestamp=best_candidate.teaser_hook_timestamp,
                include_teaser=bool(template.get("pacing", {}).get("teaser_preroll", True)),
            )

            clip_id = await create_clip(
                source_type="live",
                source_id=str(timestamp_id),
                channel_id=channel_id,
                template_name=template_name,
                raw_start=clip_start,
                raw_end=clip_end,
                virality_score=best_candidate.virality_score,
                title=best_candidate.suggested_title,
                teaser_hook_timestamp=best_candidate.teaser_hook_timestamp,
                description=best_candidate.hook_summary,
                hashtags=" ".join(best_candidate.hashtags),
                source_video_path=video_path,
                rendered_video_path=rendered_mp4,
                subtitle_path=ass_path,
            )

            update_pipeline_progress(
                "completed",
                channel_id=channel_id,
                step=5,
                step_name=f"Viral Clip #{clip_id} Ready! Sent to Telegram.",
                clip_id=clip_id,
            )

            # Broadcast clip_created event to real-time Web UI
            from src.web.ws_manager import ws_manager
            await ws_manager.broadcast("clip_created", {
                "id": clip_id,
                "clip_id": clip_id,
                "channel_id": channel_id,
                "title": best_candidate.suggested_title,
                "virality_score": best_candidate.virality_score,
                "template_name": template_name,
                "rendered_video_path": rendered_mp4,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            })

            clip_record = await get_clip(clip_id)
            if clip_record:
                await self.bot.send_clip_card(clip_record)

            async def _reset():
                await asyncio.sleep(20)
                update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
            asyncio.create_task(_reset())

        except Exception as e:
            logger.error("Error processing live highlight: %s", e, exc_info=True)
            update_pipeline_progress("error", channel_id=channel_id, error=str(e))

    async def _on_vod_event(self, audio_or_url: str, metadata: Dict[str, Any]) -> None:
        """Handler triggered when VODWatcher discovers and extracts candidate VOD."""
        vod_id = metadata.get("vod_id", "unknown")
        channel_id = metadata.get("channel_id", "unknown")
        template_name = metadata.get("template_name", "podcast_split")
        video_url = metadata.get("video_url")
        template = load_template(template_name)
        min_score = template.get("min_virality_score", 70)

        logger.info("Evaluating VOD '%s' (%s) with template '%s'...", vod_id, channel_id, template_name)
        update_pipeline_progress("processing", channel_id=channel_id, step=2, step_name=f"Transcribing VOD audio ({vod_id})...")

        try:
            transcription = await self.transcriber.transcribe(audio_or_url)

            update_pipeline_progress("processing", channel_id=channel_id, step=3, step_name="Evaluating retention peaks with Gemini AI...")
            candidates = await self.scorer.analyze_transcript(
                transcript_data=transcription,
                min_score=min_score,
                heatmap_peaks=metadata.get("heatmap_peaks", []),
            )

            if not candidates:
                logger.info("No candidates above threshold for VOD %s.", vod_id)
                update_pipeline_progress("idle", step_name="VOD processed - No clips above threshold.")
                return

            best_candidate = candidates[0]
            work_dir = Path(metadata.get("work_dir", RENDER_DIR))
            slice_source = work_dir / f"{vod_id}_slice.mp4"

            update_pipeline_progress("processing", channel_id=channel_id, step=4, step_name="Downloading exact video section and rendering 9:16 layout...")
            downloaded = await self.vod_watcher.download_video_section(
                video_url=video_url,
                start_time=best_candidate.start_time,
                end_time=best_candidate.end_time,
                output_file=slice_source,
            )

            if not downloaded or not slice_source.exists():
                logger.error("Failed to download video section for VOD %s", vod_id)
                update_pipeline_progress("error", channel_id=channel_id, error="Section download failed")
                return

            clip_dur = best_candidate.end_time - best_candidate.start_time
            ass_path = str(work_dir / f"{vod_id}_sub.ass")

            generate_ass_subtitles(
                word_timestamps=transcription.get("words", []),
                output_path=ass_path,
                template_config=template,
                time_offset=best_candidate.start_time,
                max_duration=clip_dur,
            )

            rendered_mp4 = str(work_dir / f"{vod_id}_vertical.mp4")
            await self.renderer.render_clip(
                source_path=str(slice_source),
                start_time=0.0,
                end_time=clip_dur,
                output_path=rendered_mp4,
                template=template,
                ass_path=ass_path,
                teaser_timestamp=None,
                include_teaser=False,
            )

            clip_id = await create_clip(
                source_type="vod",
                source_id=vod_id,
                channel_id=channel_id,
                template_name=template_name,
                raw_start=best_candidate.start_time,
                raw_end=best_candidate.end_time,
                virality_score=best_candidate.virality_score,
                title=best_candidate.suggested_title,
                teaser_hook_timestamp=None,
                description=best_candidate.hook_summary,
                hashtags=" ".join(best_candidate.hashtags),
                source_video_path=str(slice_source),
                rendered_video_path=rendered_mp4,
                subtitle_path=ass_path,
            )

            update_pipeline_progress("completed", channel_id=channel_id, step=5, step_name=f"VOD Clip #{clip_id} Ready! Sent to Telegram.", clip_id=clip_id)

            from src.web.ws_manager import ws_manager
            await ws_manager.broadcast("clip_created", {
                "id": clip_id,
                "clip_id": clip_id,
                "channel_id": channel_id,
                "title": best_candidate.suggested_title,
                "virality_score": best_candidate.virality_score,
                "template_name": template_name,
                "rendered_video_path": rendered_mp4,
                "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
            })

            clip_record = await get_clip(clip_id)
            if clip_record:
                await self.bot.send_clip_card(clip_record)

            async def _reset():
                await asyncio.sleep(20)
                update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
            asyncio.create_task(_reset())

        except Exception as e:
            logger.error("Error processing VOD %s: %s", vod_id, e, exc_info=True)
            update_pipeline_progress("error", channel_id=channel_id, error=str(e))

    async def _on_drip_post_published(self, summary: Dict[str, Any]) -> None:
        """Notification callback when DripScheduler publishes a scheduled clip."""
        if not self.bot.bot or not self.bot.admin_id:
            return

        msg = (
            f"🎉 <b>Drip Queue Item Published!</b>\n\n"
            f"• <b>Clip #{summary['clip_id']}:</b> {summary['title']}\n"
        )
        if summary.get("yt_url"):
            msg += f"• 🔴 <b>YouTube Shorts:</b> <a href=\"{summary['yt_url']}\">Watch Here</a>\n"
        if summary.get("ig_url"):
            msg += f"• 📸 <b>Instagram Reels:</b> <a href=\"{summary['ig_url']}\">Watch Here</a>\n"
        if not summary.get("yt_success") and not summary.get("ig_success"):
            msg += f"⚠️ <b>Errors:</b> <code>{summary.get('errors')}</code>"

        try:
            await self.bot.bot.send_message(
                chat_id=self.bot.admin_id,
                text=msg,
                parse_mode="HTML",
                disable_web_page_preview=False,
            )
        except Exception as e:
            logger.error("Failed to notify admin of drip publish: %s", e)

    async def sync_channel_monitors(self) -> None:
        """Synchronize active channels from DB with running LiveStreamWatcher instances."""
        active_channels = await get_active_channels()
        active_handles = {c["channel_id_or_handle"]: c for c in active_channels}

        for handle, watcher in list(self.active_live_watchers.items()):
            if handle not in active_handles:
                logger.info("Stopping watcher for deactivated channel: %s", handle)
                watcher.is_running = False
                await watcher.stop_pipeline()
                del self.active_live_watchers[handle]

        for handle, c_info in active_handles.items():
            if handle not in self.active_live_watchers:
                template = load_template(c_info["template_name"])
                watcher = LiveStreamWatcher(
                    channel_id=handle,
                    platform=c_info["platform"],
                    template_config=template,
                    on_viral_moment_detected=self._on_live_moment,
                )
                self.active_live_watchers[handle] = watcher
                asyncio.create_task(watcher.run())

    async def run(self) -> None:
        """Launch background workers, Web UI, and Telegram polling."""
        self.running = True
        await self.initialize()

        # Start Web UI Dashboard
        await self.web_server.start()

        # Start Scheduler loop
        scheduler_task = asyncio.create_task(self.scheduler.run())

        # Start Channel Monitor synchronizer loop
        async def _channel_sync_loop():
            while self.running:
                try:
                    await self.sync_channel_monitors()
                except Exception as e:
                    logger.error("Channel sync error: %s", e)
                await asyncio.sleep(20)

        sync_task = asyncio.create_task(_channel_sync_loop())

        # Start VOD Poller background loop (runs every 5 minutes to auto-clip offline uploads)
        async def _vod_poll_loop():
            await asyncio.sleep(5)  # initial brief delay
            while self.running:
                try:
                    channels = await get_active_channels()
                    for c in channels:
                        if not self.running:
                            break
                        await self.vod_watcher.poll_channel_vods(
                            platform=c["platform"],
                            channel_id=c["channel_id_or_handle"],
                            template_name=c["template_name"],
                        )
                except Exception as e:
                    logger.error("VOD poll loop error: %s", e)
                await asyncio.sleep(300)

        vod_task = asyncio.create_task(_vod_poll_loop())

        logger.info("AutoClipDaemon running. Web UI at http://localhost:%d | Telegram active.", WEB_PORT)

        # Start Telegram Bot polling if token configured
        if self.bot.bot:
            try:
                await self.bot.dp.start_polling(self.bot.bot)
            finally:
                self.running = False
                scheduler_task.cancel()
                sync_task.cancel()
                vod_task.cancel()
        else:
            logger.warning("TELEGRAM_BOT_TOKEN not provided. Running in web-only mode.")
            while self.running:
                await asyncio.sleep(1)


async def main():
    engine = AutoClipEngine()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, lambda: asyncio.create_task(_shutdown(engine)))
        except (NotImplementedError, RuntimeError):
            pass

    try:
        await engine.run()
    except (asyncio.CancelledError, KeyboardInterrupt):
        logger.info("Shutdown initiated by user.")


async def _shutdown(engine: AutoClipEngine):
    logger.info("Gracefully stopping AutoClipDaemon...")
    engine.running = False
    for watcher in engine.active_live_watchers.values():
        await watcher.stop_pipeline()


if __name__ == "__main__":
    asyncio.run(main())
