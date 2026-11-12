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
from typing import Any, Dict, List, Optional

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
    OUTPUT_DIR,
    WEB_HOST,
    WEB_PORT,
    MAX_CONCURRENT_JOBS,
)
from src.database import (
    init_db,
    get_db_connection,
    get_active_channels,
    get_channel,
    create_clip,
    get_clip,
    update_clip_rendered_path,
)
from src.bot.telegram_bot import AutoClipBot
from src.bot.trimmer import load_template
from src.compositor.ass_generator import generate_ass_subtitles
from src.compositor.ffmpeg_renderer import FFmpegRenderer
from src.compositor.profanity import prepare_censor, censor_text, summarize as summarize_censor, merge_flags
from src.intelligence.transcriber import Transcriber
from src.intelligence.viral_scorer import ViralScorer
from src.intelligence.calibrated_judge import CalibratedJudge
from src.intelligence.sentences import SentenceChunker
from src.monitor.live_watcher import LiveStreamWatcher
from src.monitor.vod_watcher import VODWatcher
from src.monitor.storage_gc import run_storage_gc_loop
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
        self.transcriber = Transcriber()  # follows WHISPER_MODEL setting
        self.scorer = ViralScorer()
        self.calibrated_judge = CalibratedJudge()
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
        concurrency = max(1, MAX_CONCURRENT_JOBS)
        self._clip_semaphore = asyncio.Semaphore(concurrency)
        logger.info("Pipeline concurrency limit initialized: %d parallel job(s)", concurrency)

    @staticmethod
    def _cache_words(ass_path: str, words: list, shift: float = 0.0) -> None:
        """Persist word timestamps next to the .ass file so trims/editor re-renders keep captions & censoring."""
        try:
            shifted = [
                {**w, "start": round(float(w.get("start", 0.0)) - shift, 3), "end": round(float(w.get("end", 0.0)) - shift, 3)}
                for w in words
            ] if shift else list(words)
            with open(Path(ass_path).with_suffix(".json"), "w", encoding="utf-8") as f:
                json.dump(shifted, f)
        except Exception as e:
            logger.warning("Could not cache word timestamps for %s: %s", ass_path, e)

    async def initialize(self) -> None:
        """Initialize database and verify configuration."""
        logger.info("Initializing AutoClipDaemon database schema...")
        await init_db()
        # Nothing can still be running right after startup: close out runs orphaned by a crash/restart
        try:
            from src.database import get_db_connection
            async with get_db_connection() as db:
                cur = await db.execute(
                    "UPDATE pipeline_runs SET status = 'failed', "
                    "error_message = COALESCE(error_message, 'Interrupted: server restarted while this run was in progress') "
                    "WHERE status = 'running'"
                )
                await db.commit()
                if cur.rowcount:
                    logger.info("Marked %d interrupted pipeline run(s) as failed.", cur.rowcount)
        except Exception as e:
            logger.debug("Could not close stale pipeline runs: %s", e)
        try:
            from src.database import get_system_setting
            import config.settings as s
            saved_model = await get_system_setting("whisper_model")
            if saved_model:
                s.WHISPER_MODEL = saved_model
        except Exception as e:
            logger.debug("No saved whisper_model setting: %s", e)
        logger.info("AutoClipDaemon initialized successfully.")

    async def _on_manual_clip(
        self, url: str, template_name: str, time_range: Optional[str] = None,
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Handle manual URL clip triggered from Web UI or Telegram (/clip)."""
        logger.info("Processing manual clip for URL: %s (Template: %s, TimeRange: %s)", url, template_name, time_range)
        
        # Guard: Check if any AI quota exists before downloading or starting heavy operations
        from src.database import has_available_ai_quota
        if not await has_available_ai_quota() and not time_range:
            logger.warning("⛔ All Gemini API keys are quota-exhausted. Refusing to start pipeline.")
            update_pipeline_progress("error", channel_id="manual", error="All Gemini API keys are quota-exhausted. Add active keys in Settings.")
            return
        timestamp_id = int(time.time())
        fake_vod_id = f"manual_{timestamp_id}"
        work_dir = Path(RENDER_DIR) / "manual" / fake_vod_id
        work_dir.mkdir(parents=True, exist_ok=True)
        template = load_template(template_name)

        run_id = f"run_{fake_vod_id}"
        run_start_time = time.time()

        # Record in pipeline_runs so it displays in the dedicated Pipelines page
        from src.database import get_db_connection
        async with get_db_connection() as db:
            await db.execute(
                """
                INSERT INTO pipeline_runs (id, source_id, channel_id, stage, status, candidates_count, latency_seconds, prompt_version)
                VALUES (?, ?, 'manual', 'downloading', 'running', 1, 0.0, 'v2.0_best_clips')
                """,
                (run_id, url[:80])
            )
            await db.commit()

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
                    async with get_db_connection() as db:
                        await db.execute("UPDATE pipeline_runs SET status = 'failed', error_message = 'Download failed' WHERE id = ?", (run_id,))
                        await db.commit()
                    return

                update_pipeline_progress("processing", channel_id="manual", step=3, step_name="Transcribing words with faster-whisper...")
                transcription = await self.transcriber.transcribe(str(slice_source))
                ass_path = str(work_dir / f"{fake_vod_id}_sub.ass")

                words, censor_cfg = await prepare_censor(transcription.get("words", []), template)
                self._cache_words(ass_path, words)
                generate_ass_subtitles(
                    word_timestamps=words,
                    output_path=ass_path,
                    template_config=template,
                    time_offset=0.0,
                    max_duration=clip_dur,
                    censor_cfg=censor_cfg,
                )

                update_pipeline_progress("processing", channel_id="manual", step=4, step_name=f"Compositing 9:16 vertical layout ({template_name})...")
                rendered_mp4 = str(Path(OUTPUT_DIR) / f"{fake_vod_id}_vertical.mp4")
                await self.renderer.render_clip(
                    source_path=str(slice_source),
                    start_time=0.0,
                    end_time=clip_dur,
                    output_path=rendered_mp4,
                    template=template,
                    ass_path=ass_path,
                    teaser_timestamp=None,
                    include_teaser=False,
                    censor_words=words,
                    censor_cfg=censor_cfg,
                    words_time_offset=0.0,
                )
                manual_flags = merge_flags(
                    json.dumps([{"type": "unscored", "severity": "low", "note": "Manual Quick Clip with user-specified time range"}]),
                    summarize_censor(words, 0.0, clip_dur),
                    censor_cfg,
                )

                clip_id = await create_clip(
                    source_type="vod",
                    source_id=fake_vod_id,
                    channel_id="manual",
                    template_name=template_name,
                    # Times are relative to the downloaded slice (source_video_path), which starts at start_sec.
                    raw_start=0.0,
                    raw_end=clip_dur,
                    trigger_json=json.dumps({"type": "manual", "source_url": url, "source_start": start_sec, "source_end": end_sec}),
                    virality_score=0,
                    final_score=None,
                    flags=manual_flags,
                    title=f"Manual Highlight ({template_name})",
                    teaser_hook_timestamp=None,
                    description=censor_text(transcription.get("text", "")[:100], censor_cfg),
                    hashtags="#Shorts #Reels #Viral",
                    source_video_path=str(slice_source),
                    rendered_video_path=rendered_mp4,
                    subtitle_path=ass_path,
                )

                update_pipeline_progress("completed", channel_id="manual", step=5, step_name=f"Clip #{clip_id} Ready! Sent to Telegram.", clip_id=clip_id)

                elapsed_latency = round(time.time() - run_start_time, 2)
                async with get_db_connection() as db:
                    await db.execute(
                        """
                        UPDATE pipeline_runs SET
                            stage = 'completed',
                            status = 'completed',
                            candidates_count = 1,
                            latency_seconds = ?
                        WHERE id = ?
                        """,
                        (elapsed_latency, run_id)
                    )
                    await db.commit()

                from src.web.ws_manager import ws_manager
                await ws_manager.broadcast("clip_created", {
                    "id": clip_id,
                    "clip_id": clip_id,
                    "channel_id": "manual",
                    "title": f"Manual Highlight ({template_name})",
                    "virality_score": 0,
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
                options=options or {},
            )

        except Exception as e:
            logger.error("Manual clip processing failed: %s", e, exc_info=True)
            # Surface the failure to the Quick Clip page / pipeline monitor instead of failing silently.
            short_err = str(e).splitlines()[0][:200] if str(e) else type(e).__name__
            update_pipeline_progress("error", channel_id="manual", error=f"Quick clip failed: {short_err}")
            try:
                async with get_db_connection() as db:
                    await db.execute(
                        "UPDATE pipeline_runs SET status = 'failed', error_message = ? WHERE id = ?",
                        (short_err, f"run_{fake_vod_id}"),
                    )
                    await db.commit()
            except Exception:
                pass
            update_pipeline_progress("error", channel_id="manual", error=str(e))

    async def _on_live_moment(self, video_path: str, metadata: Dict[str, Any]) -> None:
        """Handler triggered when LiveStreamWatcher detects a chat velocity or audio peak spike."""
        channel_id = metadata.get("channel_id", "unknown")
        reason = metadata.get("trigger_reason", "hype")

        # Serialized pipeline lock: Prevent multiple live channels from transcribing/rendering simultaneously
        if self._clip_semaphore.locked():
            logger.info("⏳ Processing pipeline is busy. Queueing live moment for %s...", channel_id)

        async with self._clip_semaphore:
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
                from src.database import get_effective_min_score
                min_score = await get_effective_min_score(channel_id, template)
                logger.info("Effective min_score for creator '%s': %d (Channel > Template > System)", channel_id, min_score)

                # Check if channel configured skip_unscored
                channel_record = await get_channel(channel_id)
                skip_unscored = False
                if channel_record and channel_record.get("settings_json"):
                    try:
                        s_cfg = json.loads(channel_record["settings_json"]) if isinstance(channel_record["settings_json"], str) else channel_record["settings_json"]
                        skip_unscored = bool(s_cfg.get("clip_rules", {}).get("skip_unscored", False))
                    except Exception:
                        pass

                update_pipeline_progress(
                    "processing",
                    channel_id=channel_id,
                    step=3,
                    step_name="Evaluating viral hooks with Gemini AI...",
                )

                chat_features = metadata.get("chat_features", {})
                trigger_ctx = metadata.get("trigger_context", {})
                chat_spikes_list = [trigger_ctx] if trigger_ctx.get("type") in ("chat_spike", "keyword_hit") else []
                audio_peaks_list = [trigger_ctx] if trigger_ctx.get("type") == "audio_peak" else []

                from config.settings import PIPELINE_MODE
                sentences = SentenceChunker.from_whisper_result(transcription)

                calibrated_candidates = []
                # Execute CalibratedJudge if in 'new' or 'shadow' mode
                if PIPELINE_MODE in ("new", "shadow"):
                    try:
                        calibrated_candidates = await self.calibrated_judge.evaluate_moment(
                            channel_id=channel_id,
                            sentences=sentences,
                            trigger_context=trigger_ctx,
                            chat_features=chat_features,
                            min_score=min_score,
                        )
                        logger.info("CalibratedJudge evaluated %d candidates in '%s' mode.", len(calibrated_candidates), PIPELINE_MODE)
                    except Exception as e:
                        logger.warning("CalibratedJudge execution error: %s", e)

                # Legacy Scorer execution (active in 'legacy' or 'shadow')
                candidates = []
                if PIPELINE_MODE in ("legacy", "shadow"):
                    candidates = await self.scorer.analyze_transcript(
                        transcript_data=transcription,
                        min_score=min_score,
                        chat_spikes=chat_spikes_list,
                        audio_peaks=audio_peaks_list,
                    )

                # Choose best candidate based on active pipeline mode
                best_candidate = None
                chosen_from_new = False

                if PIPELINE_MODE == "new" and calibrated_candidates:
                    best_candidate = calibrated_candidates[0]
                    chosen_from_new = True
                elif candidates:
                    candidates.sort(key=lambda c: getattr(c, "virality_score", 0), reverse=True)
                    best_candidate = candidates[0]
                elif calibrated_candidates:
                    # Fallback to calibrated candidate if legacy returned nothing
                    best_candidate = calibrated_candidates[0]
                    chosen_from_new = True

                if not best_candidate:
                    rej_reason = f"Candidate score below creator threshold ({min_score})"
                    reasons = []
                    score_val = 0
                    rubric_dict = {}
                    if calibrated_candidates:
                        c_cand = calibrated_candidates[0]
                        score_val = c_cand.get("virality_score", 0)
                        rubric_dict = c_cand.get("scores", {})
                        if c_cand.get("flags"):
                            reasons = [f.get("note", f.get("type")) for f in c_cand.get("flags", [])]
                    elif candidates:
                        score_val = getattr(candidates[0], "virality_score", 0)

                    if reasons:
                        rej_reason = f"Rejected: {'; '.join(reasons)} (Score: {score_val} < {min_score})"
                    else:
                        rej_reason = f"Score {score_val} below threshold {min_score}"

                    logger.info("No candidates passed min_virality_score threshold (%d). Discarding (%s).", min_score, rej_reason)
                    update_pipeline_progress("idle", channel_id=channel_id, step=0, step_name=f"Rejected: {rej_reason}")

                    # Persist rejected live hype to DB for transparency & inspection
                    try:
                        async with get_db_connection() as db:
                            await db.execute("""
                                INSERT INTO live_hypes (channel_id, trigger_type, trigger_value, threshold_value, video_slice_path, status, gate_failed, rejection_reason, virality_score, rubric_json, transcript_text)
                                VALUES (?, ?, ?, ?, ?, 'rejected', 'gate_4_ai_judge', ?, ?, ?, ?)
                            """, (
                                channel_id,
                                trigger_ctx.get("type", "chat_spike"),
                                float(trigger_ctx.get("current_velocity") or trigger_ctx.get("peak_db") or 0.0),
                                float(min_score),
                                video_path,
                                rej_reason,
                                score_val,
                                json.dumps(rubric_dict),
                                transcription.get("text", "")[:300]
                            ))
                            await db.commit()
                    except Exception as db_err:
                        logger.debug("Failed saving rejected live_hype: %s", db_err)

                    # Auto-reset banner after 10s
                    async def _clear_banner():
                        await asyncio.sleep(10)
                        update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
                    asyncio.create_task(_clear_banner())
                    return

                # Extract candidate fields cleanly
                if chosen_from_new:
                    cand_score = best_candidate["virality_score"]
                    final_score_val = best_candidate.get("final_score")
                    clip_start = best_candidate["start_time"]
                    clip_end = best_candidate["end_time"]
                    teaser_ts = best_candidate.get("teaser_hook_timestamp")
                    suggested_title = best_candidate["title"]
                    description_text = best_candidate.get("description", "")
                    hashtags_text = " ".join(best_candidate.get("hashtags", []))
                    score_breakdown_json = json.dumps(best_candidate.get("scores", {}))
                    flags_json = json.dumps(best_candidate.get("flags", []))
                    formula_ver = "v3.0_calibrated_0.7llm_0.3sig"
                    prompt_ver = best_candidate.get("prompt_version", "v3.0_calibrated_judge")
                    model_used = best_candidate.get("model", "gemini-flash-lite-latest")
                else:
                    cand_score = getattr(best_candidate, "virality_score", 0)
                    final_score_val = float(cand_score) if cand_score > 0 else None
                    clip_start = best_candidate.start_time
                    clip_end = best_candidate.end_time
                    teaser_ts = best_candidate.teaser_hook_timestamp
                    suggested_title = best_candidate.suggested_title
                    description_text = best_candidate.hook_summary
                    hashtags_text = " ".join(best_candidate.hashtags)
                    score_breakdown_json = None
                    flags_json = None
                    formula_ver = "legacy_single_call"
                    prompt_ver = "legacy"
                    model_used = getattr(self.scorer, "model_name", "gemini-flash-lite-latest")

                if cand_score <= 0 and skip_unscored:
                    logger.info("Best candidate is unscored and skip_unscored=True for %s. Skipping clip creation.", channel_id)
                    update_pipeline_progress("idle", channel_id=channel_id, step=0, step_name="Moment unscored (skipped).")
                    return

                logger.info("Selected viral candidate: '%s' (Score: %d/100, Mode: %s)", suggested_title, cand_score, PIPELINE_MODE)

                clip_dur = clip_end - clip_start

                timestamp_id = int(metadata.get("timestamp", 0))
                ass_path = str(Path(RENDER_DIR) / f"live_{channel_id}_{timestamp_id}.ass")
                ass_json_cache = Path(ass_path).with_suffix(".json")

                words, censor_cfg = await prepare_censor(transcription.get("words", []), template)
                with open(ass_json_cache, "w", encoding="utf-8") as f:
                    json.dump(words, f)

                generate_ass_subtitles(
                    word_timestamps=words,
                    output_path=ass_path,
                    template_config=template,
                    time_offset=clip_start,
                    max_duration=clip_dur,
                    censor_cfg=censor_cfg,
                )

                update_pipeline_progress(
                    "processing",
                    channel_id=channel_id,
                    step=4,
                    step_name=f"Rendering 9:16 layout ({template_name}) & burning kinetic captions...",
                )

                rendered_mp4 = str(Path(OUTPUT_DIR) / f"live_{channel_id}_{timestamp_id}_final.mp4")

                # Method 1: Permanently preserve 16:9 source footage in SOURCES_DIR so it can never be deleted by buffer rotation
                from config.settings import SOURCES_DIR
                import shutil
                permanent_source_path = str(Path(SOURCES_DIR) / f"live_{channel_id}_{timestamp_id}_source.mp4")
                try:
                    if Path(video_path).exists():
                        shutil.copy2(video_path, permanent_source_path)
                        logger.info("Preserved permanent 16:9 raw source video to: %s", permanent_source_path)
                    else:
                        permanent_source_path = video_path
                except Exception as cp_err:
                    logger.warning("Could not copy source footage to permanent storage: %s", cp_err)
                    permanent_source_path = video_path

                await self.renderer.render_clip(
                    source_path=permanent_source_path,
                    start_time=clip_start,
                    end_time=clip_end,
                    output_path=rendered_mp4,
                    template=template,
                    ass_path=ass_path,
                    teaser_timestamp=teaser_ts,
                    include_teaser=bool(template.get("pacing", {}).get("teaser_preroll", True)),
                    censor_words=words,
                    censor_cfg=censor_cfg,
                )
                flags_json = merge_flags(flags_json, summarize_censor(words, clip_start, clip_dur), censor_cfg)
                suggested_title = censor_text(suggested_title, censor_cfg)

                clip_id = await create_clip(
                    source_type="live",
                    source_id=str(timestamp_id),
                    channel_id=channel_id,
                    template_name=template_name,
                    raw_start=clip_start,
                    raw_end=clip_end,
                    virality_score=cand_score,
                    final_score=final_score_val,
                    score_breakdown=score_breakdown_json,
                    flags=flags_json,
                    prompt_version=prompt_ver,
                    formula_version=formula_ver,
                    title=suggested_title,
                    teaser_hook_timestamp=teaser_ts,
                    description=description_text,
                    hashtags=hashtags_text,
                    source_video_path=permanent_source_path,
                    rendered_video_path=rendered_mp4,
                    subtitle_path=ass_path,
                    trigger_json=json.dumps(trigger_ctx) if trigger_ctx else None,
                    model=model_used,
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
                    "title": suggested_title,
                    "virality_score": cand_score,
                    "final_score": final_score_val,
                    "template_name": template_name,
                    "rendered_video_path": rendered_mp4,
                    "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
                })

                clip_record = await get_clip(clip_id)
                if clip_record and self.bot:
                    try:
                        await self.bot.send_clip_card(clip_record)
                    except Exception as bot_err:
                        logger.warning("Telegram notification timed out or failed (clip is safe in Web UI): %s", bot_err)

                # Persist passed live hype to DB
                try:
                    async with get_db_connection() as db:
                        await db.execute("""
                            INSERT INTO live_hypes (channel_id, trigger_type, trigger_value, threshold_value, video_slice_path, status, gate_failed, rejection_reason, virality_score, rubric_json, transcript_text, clip_id)
                            VALUES (?, ?, ?, ?, ?, 'passed', NULL, NULL, ?, ?, ?, ?)
                        """, (
                            channel_id,
                            trigger_ctx.get("type", "chat_spike"),
                            float(trigger_ctx.get("current_velocity") or trigger_ctx.get("peak_db") or 0.0),
                            float(min_score),
                            video_path,
                            cand_score,
                            score_breakdown_json,
                            transcription.get("text", "")[:300],
                            clip_id
                        ))
                        await db.commit()
                except Exception as db_err:
                    logger.debug("Failed saving passed live_hype: %s", db_err)

                async def _reset():
                    await asyncio.sleep(20)
                    update_pipeline_progress("idle", step_name="Idle - Awaiting Stream Moments")
                asyncio.create_task(_reset())

            except Exception as e:
                logger.error("Error processing live highlight: %s", e, exc_info=True)
                update_pipeline_progress("error", channel_id=channel_id, error=str(e))

    @staticmethod
    def _clip_options(metadata: Dict[str, Any], channel_record: Optional[Dict[str, Any]]) -> Dict[str, Any]:
        """Clip count/length/focus: Quick Clip request > streamer clip rules > defaults."""
        rules: Dict[str, Any] = {}
        if channel_record and channel_record.get("settings_json"):
            try:
                cfg = channel_record["settings_json"]
                cfg = json.loads(cfg) if isinstance(cfg, str) else cfg
                rules = (cfg or {}).get("clip_rules", {}) or {}
            except Exception:
                rules = {}

        def num(*vals, default):
            for v in vals:
                try:
                    if v is not None and float(v) > 0:
                        return float(v)
                except (TypeError, ValueError):
                    continue
            return default

        min_len = num(metadata.get("min_len"), rules.get("min_length"), rules.get("min_len"), default=25.0)
        max_len = num(metadata.get("max_len"), rules.get("max_length"), rules.get("max_len"), default=60.0)
        if max_len < min_len + 5:
            max_len = min_len + 5
        max_clips = int(num(metadata.get("max_clips"), rules.get("max_clips_per_vod"), default=5))
        return {
            "max_clips": max(1, min(max_clips, 30)),
            "min_len": max(5.0, min_len),
            "max_len": min(180.0, max_len),
            "focus": (metadata.get("focus") or rules.get("focus") or "").strip() or None,
        }

    def _normalise_candidate(self, c: Any, from_new: bool) -> Dict[str, Any]:
        """One shape for both judges (legacy returns Pydantic objects, calibrated returns dicts)."""
        if from_new:
            return {
                "start": float(c["start_time"]), "end": float(c["end_time"]),
                "score": int(c.get("virality_score") or 0), "final_score": c.get("final_score"),
                "title": c.get("title") or "Stream Highlight", "description": c.get("description", ""),
                "hashtags": " ".join(c.get("hashtags", [])),
                "score_breakdown": json.dumps(c.get("scores", {})), "flags": json.dumps(c.get("flags", [])),
                "formula": "v3.0_calibrated_0.7llm_0.3sig",
                "prompt": c.get("prompt_version", "v3.0_calibrated_judge"),
                "model": c.get("model", "gemini-flash-lite-latest"),
            }
        score = int(getattr(c, "virality_score", 0) or 0)
        return {
            "start": float(c.start_time), "end": float(c.end_time), "score": score,
            "final_score": float(score) if score > 0 else None,
            "title": c.suggested_title, "description": c.hook_summary, "hashtags": " ".join(c.hashtags),
            "score_breakdown": None, "flags": None, "formula": "legacy_windowed",
            "prompt": "legacy_v2_windowed", "model": getattr(self.scorer, "model_name", "gemini-flash-lite-latest"),
        }

    async def _render_vod_candidate(
        self, cand: Dict[str, Any], idx: int, vod_id: str, channel_id: str, template_name: str,
        template: Dict[str, Any], video_url: str, work_dir: Path, words_all: list, censor_cfg: Dict[str, Any],
    ) -> Optional[int]:
        """Download, caption, render and register ONE candidate of a VOD."""
        clip_start, clip_end = cand["start"], cand["end"]
        clip_dur = clip_end - clip_start
        tag = f"{vod_id}_c{idx:02d}"
        slice_source = work_dir / f"{tag}_slice.mp4"

        downloaded = await self.vod_watcher.download_video_section(
            video_url=video_url, start_time=clip_start, end_time=clip_end, output_file=slice_source,
        )
        if not downloaded or not slice_source.exists():
            logger.error("Failed to download section %.1f-%.1fs for VOD %s", clip_start, clip_end, vod_id)
            return None

        ass_path = str(work_dir / f"{tag}_sub.ass")
        # Cache words in clip-relative time: the stored source video is the slice, not the full VOD.
        self._cache_words(ass_path, words_all, shift=clip_start)
        generate_ass_subtitles(
            word_timestamps=words_all, output_path=ass_path, template_config=template,
            time_offset=clip_start, max_duration=clip_dur, censor_cfg=censor_cfg,
        )

        rendered_mp4 = str(Path(OUTPUT_DIR) / f"{tag}_vertical.mp4")
        await self.renderer.render_clip(
            source_path=str(slice_source), start_time=0.0, end_time=clip_dur, output_path=rendered_mp4,
            template=template, ass_path=ass_path, teaser_timestamp=None, include_teaser=False,
            censor_words=words_all, censor_cfg=censor_cfg, words_time_offset=clip_start,
        )
        flags_json = merge_flags(cand["flags"], summarize_censor(words_all, clip_start, clip_dur), censor_cfg)
        title = censor_text(cand["title"], censor_cfg)

        clip_id = await create_clip(
            source_type="vod", source_id=vod_id, channel_id=channel_id, template_name=template_name,
            raw_start=0.0, raw_end=clip_dur,  # relative to the downloaded slice (source_video_path)
            virality_score=cand["score"], final_score=cand["final_score"],
            score_breakdown=cand["score_breakdown"], flags=flags_json,
            prompt_version=cand["prompt"], formula_version=cand["formula"],
            title=title, teaser_hook_timestamp=None, description=censor_text(cand["description"], censor_cfg),
            hashtags=cand["hashtags"], source_video_path=str(slice_source), rendered_video_path=rendered_mp4,
            subtitle_path=ass_path,
            trigger_json=json.dumps({"type": "vod_heatmap", "vod_start": clip_start, "vod_end": clip_end, "rank": idx}),
            model=cand["model"],
        )

        from src.web.ws_manager import ws_manager
        await ws_manager.broadcast("clip_created", {
            "id": clip_id, "clip_id": clip_id, "channel_id": channel_id, "title": title,
            "virality_score": cand["score"], "template_name": template_name,
            "rendered_video_path": rendered_mp4, "created_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        })
        clip_record = await get_clip(clip_id)
        if clip_record and self.bot:
            try:
                await self.bot.send_clip_card(clip_record)
            except Exception as bot_err:
                logger.warning("Telegram notification failed (clip is safe in Web UI): %s", bot_err)
        return clip_id

    async def _on_vod_event(self, audio_or_url: str, metadata: Dict[str, Any]) -> None:
        """Handler triggered when VODWatcher discovers and extracts candidate VOD."""
        vod_id = metadata.get("vod_id", "unknown")
        channel_id = metadata.get("channel_id", "unknown")
        template_name = metadata.get("template_name", "podcast_split")
        video_url = metadata.get("video_url")
        template = load_template(template_name)
        from src.database import get_effective_min_score
        min_score = await get_effective_min_score(channel_id, template)

        # Check if channel configured skip_unscored
        channel_record = await get_channel(channel_id)
        skip_unscored = False
        if channel_record and channel_record.get("settings_json"):
            try:
                s_cfg = json.loads(channel_record["settings_json"]) if isinstance(channel_record["settings_json"], str) else channel_record["settings_json"]
                skip_unscored = bool(s_cfg.get("clip_rules", {}).get("skip_unscored", False))
            except Exception:
                pass

        logger.info("Evaluating VOD '%s' (%s) with template '%s'...", vod_id, channel_id, template_name)
        update_pipeline_progress("processing", channel_id=channel_id, step=2, step_name=f"Transcribing VOD audio ({vod_id})...")

        try:
            transcription = await self.transcriber.transcribe(audio_or_url)

            update_pipeline_progress("processing", channel_id=channel_id, step=3, step_name="Evaluating retention peaks with Gemini AI...")
            
            from config.settings import PIPELINE_MODE
            sentences = SentenceChunker.from_whisper_result(transcription)

            calibrated_candidates = []
            if PIPELINE_MODE in ("new", "shadow"):
                try:
                    calibrated_candidates = await self.calibrated_judge.evaluate_moment(
                        channel_id=channel_id,
                        sentences=sentences,
                        trigger_context={"type": "vod_heatmap", "peaks": metadata.get("heatmap_peaks", [])},
                        min_score=min_score,
                    )
                except Exception as e:
                    logger.warning("VOD CalibratedJudge evaluation error: %s", e)

            opts = self._clip_options(metadata, channel_record)
            candidates = []
            if PIPELINE_MODE in ("legacy", "shadow"):
                candidates = await self.scorer.analyze_transcript(
                    transcript_data=transcription,
                    min_score=min_score,
                    heatmap_peaks=metadata.get("heatmap_peaks", []),
                    max_clips=opts["max_clips"],
                    min_len=opts["min_len"],
                    max_len=opts["max_len"],
                    focus=opts["focus"],
                )

            # Normalise both judge outputs into one shape (the calibrated judge returns dicts)
            picked = [self._normalise_candidate(c, from_new=False) for c in candidates]
            if PIPELINE_MODE == "new" or not picked:
                picked = [self._normalise_candidate(c, from_new=True) for c in calibrated_candidates] or picked
            picked.sort(key=lambda c: c["score"], reverse=True)
            if skip_unscored:
                picked = [c for c in picked if c["score"] > 0]
            picked = picked[: opts["max_clips"]]

            if not picked:
                logger.info("No candidates above threshold for VOD %s.", vod_id)
                update_pipeline_progress("idle", step_name="VOD processed - No clips above threshold.")
                async with get_db_connection() as db:
                    await db.execute("UPDATE pipeline_runs SET stage = 'completed', status = 'completed', candidates_count = 0 WHERE id = ?", (f"run_{vod_id}",))
                    await db.commit()
                return

            work_dir = Path(metadata.get("work_dir", RENDER_DIR))
            words_all, censor_cfg = await prepare_censor(transcription.get("words", []), template)
            made: List[int] = []
            for idx, cand in enumerate(picked, start=1):
                update_pipeline_progress(
                    "processing", channel_id=channel_id, step=4,
                    step_name=f"Rendering clip {idx}/{len(picked)}: {cand['title'][:50]}",
                )
                try:
                    clip_id = await self._render_vod_candidate(
                        cand, idx, vod_id, channel_id, template_name, template, video_url,
                        work_dir, words_all, censor_cfg,
                    )
                except Exception as clip_err:
                    logger.error("Clip %d/%d of VOD %s failed: %s", idx, len(picked), vod_id, clip_err, exc_info=True)
                    continue
                if clip_id:
                    made.append(clip_id)

            async with get_db_connection() as db:
                await db.execute(
                    "UPDATE pipeline_runs SET stage = 'completed', status = ?, candidates_count = ? WHERE id = ?",
                    ("completed" if made else "failed", len(made), f"run_{vod_id}"),
                )
                await db.commit()

            if not made:
                update_pipeline_progress("error", channel_id=channel_id, error="All clip renders failed - see Live Logs")
                return

            update_pipeline_progress(
                "completed", channel_id=channel_id, step=5,
                step_name=f"{len(made)} clip(s) ready from this video", clip_id=made[0],
            )

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

        # Start Storage Garbage Collector loop (auto-cleans temp files and caps buffer at 1.5GB)
        gc_dirs = [Path("temp"), Path(RENDER_DIR), Path("tmp")]
        gc_task = asyncio.create_task(run_storage_gc_loop(gc_dirs, interval_seconds=120))

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

        # Start Telegram Bot polling if token configured and polling is explicitly enabled
        from config.settings import TELEGRAM_POLLING_ENABLED
        if self.bot.bot and TELEGRAM_POLLING_ENABLED:
            logger.info("🤖 Starting Telegram Bot polling (TELEGRAM_POLLING_ENABLED=true)...")
            backoff_s = 5.0
            while self.running:
                try:
                    await self.bot.dp.start_polling(self.bot.bot)
                    break
                except Exception as poll_err:
                    err_msg = str(poll_err)
                    if "conflict" in err_msg.lower() or "terminated by other getupdates" in err_msg.lower():
                        logger.warning(
                            "⚠️ TelegramConflictError detected (another instance is polling this bot token). "
                            "Backing off for %.1fs without crash-looping...", backoff_s
                        )
                        await asyncio.sleep(backoff_s)
                        backoff_s = min(60.0, backoff_s * 1.5)
                    else:
                        logger.error("Telegram polling error: %s", poll_err)
                        await asyncio.sleep(5)
            self.running = False
            scheduler_task.cancel()
            gc_task.cancel()
            sync_task.cancel()
            vod_task.cancel()
        elif self.bot.bot and not TELEGRAM_POLLING_ENABLED:
            logger.warning(
                "⚠️ TELEGRAM_POLLING_ENABLED is false. Bot will send outgoing notifications but will NOT poll "
                "getUpdates (safe single-instance guard to prevent TelegramConflictError with cloud server)."
            )
            while self.running:
                await asyncio.sleep(1)
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
