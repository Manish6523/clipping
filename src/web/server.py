"""Asynchronous Web UI Dashboard and REST API Server built with aiohttp.web."""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from config.settings import (
    RENDER_DIR,
    TEMPLATES_DIR,
    DRIP_INTERVAL_HOURS,
    WEB_HOST,
    WEB_PORT,
)
from src.database import (
    get_db_connection,
    get_active_channels,
    add_channel,
    remove_channel,
    get_clip,
    update_clip_caption,
    update_clip_status,
    enqueue_clip,
    get_upcoming_queue,
    get_clip_edl,
    save_clip_edl,
)
from src.bot.trimmer import ClipTrimmer, load_template
from src.publisher.youtube_shorts import YouTubeShortsPublisher
from src.publisher.instagram_reels import InstagramReelsPublisher
from src.publisher.scheduler import DripScheduler, load_template_destinations
from src.web.logger_stream import get_recent_logs, get_pipeline_state, get_all_streamer_statuses

from src.web.timing_middleware import request_timing_middleware
from src.web.ws_manager import ws_manager
from src.web.routes_clips import register_clips_routes
from src.web.routes_channels import register_channel_routes
from src.web.routes_templates import register_template_routes
from src.web.routes_health import register_health_routes
from src.web.routes_presets import register_presets_routes
from src.maintenance import execute_database_reset
from src.compositor.render_swap import SafeRenderManager, compute_edl_hash, drain_pending_deletes

logger = logging.getLogger(__name__)


class WebUIServer:
    """Provides REST API and serves the Single-Page Application dashboard."""

    def __init__(self, host: str = WEB_HOST, port: int = WEB_PORT, on_manual_clip=None):
        self.host = host
        self.port = port
        self.on_manual_clip = on_manual_clip
        self.trimmer = ClipTrimmer()
        # Enable timing middleware
        self.app = web.Application(middlewares=[request_timing_middleware])
        self._setup_routes()

    def _setup_routes(self) -> None:
        """Register web routes."""
        self.app.router.add_get("/", self.handle_index)
        self.app.router.add_get("/api/status", self.handle_status)
        self.app.router.add_get("/ws", ws_manager.handle_ws)

        # Register modular sub-routers
        register_health_routes(self.app)
        register_clips_routes(self.app)
        register_channel_routes(self.app)
        register_template_routes(self.app)
        register_presets_routes(self.app)

        self.app.router.add_post("/api/admin/reset", self.handle_admin_reset)
        self.app.router.add_get("/api/channels", self.handle_get_channels)
        self.app.router.add_post("/api/channels", self.handle_add_channel)
        self.app.router.add_delete("/api/channels/{handle}", self.handle_remove_channel)
        self.app.router.add_get("/api/clips/{id}/edit", self.handle_get_clip_edl)
        self.app.router.add_put("/api/clips/{id}/edit", self.handle_save_clip_edl)
        self.app.router.add_post("/api/clips/{id}/transcribe", self.handle_transcribe_clip)
        self.app.router.add_post("/api/clips/{id}/detect-faces", self.handle_detect_faces)
        self.app.router.add_post("/api/clips/{id}/render-edl", self.handle_render_from_edl)
        self.app.router.add_get("/api/fonts", self.handle_get_fonts)
        self.app.router.add_post("/api/clips/{id}/trim", self.handle_trim_clip)
        self.app.router.add_post("/api/clips/{id}/toggle-teaser", self.handle_toggle_teaser)
        self.app.router.add_post("/api/clips/{id}/update", self.handle_update_clip)
        self.app.router.add_post("/api/clips/{id}/post-now", self.handle_post_now)
        self.app.router.add_post("/api/clips/{id}/queue", self.handle_queue_clip)
        self.app.router.add_post("/api/clips/{id}/discard", self.handle_discard_clip)
        self.app.router.add_get("/api/queue", self.handle_get_queue)
        self.app.router.add_post("/api/clip-manual", self.handle_clip_manual)
        self.app.router.add_get("/api/logs", self.handle_get_logs)
        self.app.router.add_get("/api/pipeline/status", self.handle_get_pipeline_status)
        self.app.router.add_get("/api/streamers", self.handle_get_streamers)

        # Serve static rendered video files & posters
        self.app.router.add_static("/renders", path=str(RENDER_DIR), name="renders", show_index=False)

        # Serve built frontend static assets
        dist_assets = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist" / "assets"
        if dist_assets.exists():
            self.app.router.add_static("/assets", path=str(dist_assets), name="frontend_assets", show_index=False)

        # SPA catch-all for react-router routes like /clips/{id}/editor and /channels/{id}/settings
        self.app.router.add_get("/{tail:(?!api|renders|assets|ws).*$}", self.handle_spa_fallback)

    async def handle_index(self, request: web.Request) -> web.Response:
        """Serve main dashboard React SPA index.html from frontend/dist (SPA fallback supported)."""
        dist_index = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist" / "index.html"
        if dist_index.exists():
            with open(dist_index, "r", encoding="utf-8") as f:
                return web.Response(text=f.read(), content_type="text/html")

        return web.Response(
            text="React frontend not built yet. Run 'npm run build' inside frontend/ directory.",
            content_type="text/plain",
            status=503
        )

    async def handle_spa_fallback(self, request: web.Request) -> web.Response:
        """Fallback non-API routes to index.html for client-side React Router (/clips/:id/edit)."""
        return await self.handle_index(request)

    async def handle_admin_reset(self, request: web.Request) -> web.Response:
        """Admin Danger Zone: Reset database and delete cached/rendered media."""
        try:
            body = await request.json()
        except Exception:
            body = {}

        confirmation = body.get("confirmation", "")
        if confirmation != "RESET":
            return web.json_response({
                "error": {
                    "code": "CONFIRMATION_REQUIRED",
                    "message": "Type 'RESET' to confirm resetting all database records and renders."
                }
            }, status=400)

        keep_channels = bool(body.get("keep_channels", True))
        keep_presets = bool(body.get("keep_presets", True))
        create_backup = bool(body.get("create_backup", True))

        try:
            res = await execute_database_reset(
                keep_channels=keep_channels,
                keep_presets=keep_presets,
                create_backup=create_backup,
            )
            return web.json_response(res)
        except Exception as e:
            logger.error("Admin database reset failed: %s", e)
            return web.json_response({"error": {"code": "RESET_FAILED", "message": str(e)}}, status=500)

    async def handle_save_template(self, request: web.Request) -> web.Response:
        """Save a new or updated layout template JSON."""
        try:
            data = await request.json()
            t_name = data.get("name", "").strip()
            if not t_name:
                return web.json_response({"error": "Template name required"}, status=400)
            
            clean_filename = f"{t_name}.json"
            t_path = Path(TEMPLATES_DIR) / clean_filename
            with open(t_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            logger.info("Saved visual template '%s' to %s", t_name, t_path)
            return web.json_response({"success": True, "template": data})
        except Exception as e:
            logger.error("Failed to save template: %s", e)
            return web.json_response({"error": str(e)}, status=500)

    async def handle_status(self, request: web.Request) -> web.Response:
        """Return system statistics."""
        async with get_db_connection() as db:
            c1 = await db.execute("SELECT COUNT(*) FROM channels WHERE is_active = 1")
            row1 = await c1.fetchone()
            channels_count = row1[0] if row1 else 0

            c2 = await db.execute("SELECT COUNT(*) FROM clips WHERE status = 'pending_approval'")
            row2 = await c2.fetchone()
            pending_count = row2[0] if row2 else 0

            c3 = await db.execute("SELECT COUNT(*) FROM scheduled_queue WHERE yt_status = 'pending' OR ig_status = 'pending'")
            row3 = await c3.fetchone()
            queued_count = row3[0] if row3 else 0

            c4 = await db.execute("SELECT COUNT(*) FROM clips WHERE status = 'published'")
            row4 = await c4.fetchone()
            published_count = row4[0] if row4 else 0

        return web.json_response({
            "status": "online",
            "channels_count": channels_count,
            "pending_clips_count": pending_count,
            "queued_count": queued_count,
            "published_count": published_count,
        })

    async def handle_get_channels(self, request: web.Request) -> web.Response:
        """Get all active monitored channels."""
        channels = await get_active_channels()
        return web.json_response(channels)

    async def handle_add_channel(self, request: web.Request) -> web.Response:
        """Add new channel."""
        data = await request.json()
        platform = data.get("platform", "twitch").lower()
        channel = data.get("channel", "").strip()
        template = data.get("template", "ishowspeed_gaming").strip()

        if not channel:
            return web.json_response({"error": "Channel handle required"}, status=400)

        cid = await add_channel(platform, channel, template)
        return web.json_response({"success": True, "channel_id": cid})

    async def handle_remove_channel(self, request: web.Request) -> web.Response:
        """Deactivate and delete channel permanently."""
        handle = request.match_info.get("handle", "").strip()
        success = await remove_channel(handle)
        await ws_manager.broadcast("channel_removed", {"channel_id": handle})
        return web.json_response({"success": success, "removed": handle})

    async def handle_get_templates(self, request: web.Request) -> web.Response:
        """List available templates."""
        t_files = list(Path(TEMPLATES_DIR).glob("*.json"))
        templates = []
        for tf in t_files:
            try:
                with open(tf, "r", encoding="utf-8") as f:
                    templates.append(json.load(f))
            except Exception:
                pass
        return web.json_response(templates)

    async def handle_get_clips(self, request: web.Request) -> web.Response:
        """Get list of clips with optional status filter."""
        status = request.query.get("status")
        async with get_db_connection() as db:
            if status:
                cursor = await db.execute("SELECT * FROM clips WHERE status = ? ORDER BY id DESC", (status,))
            else:
                cursor = await db.execute("SELECT * FROM clips ORDER BY id DESC LIMIT 50")
            rows = await cursor.fetchall()
            return web.json_response([dict(r) for r in rows])

    async def handle_get_clip_by_id(self, request: web.Request) -> web.Response:
        """Get single clip details."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)
        
        # Check if words json file exists
        if clip.get("subtitle_path"):
            words_file = Path(clip["subtitle_path"]).with_suffix(".json")
            if words_file.exists():
                try:
                    with open(words_file, "r", encoding="utf-8") as f:
                        clip["transcript_words"] = json.load(f)
                except Exception:
                    pass
        return web.json_response(clip)

    async def handle_get_clip_edl(self, request: web.Request) -> web.Response:
        """Get or initialize default EDL JSON for a clip."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        edl = await get_clip_edl(clip_id)
        if not edl:
            # Build default EDL from clip data
            words = []
            if clip.get("subtitle_path"):
                words_file = Path(clip["subtitle_path"]).with_suffix(".json")
                if words_file.exists():
                    try:
                        with open(words_file, "r", encoding="utf-8") as f:
                            words = json.load(f)
                    except Exception:
                        pass

            edl = {
                "version": 1,
                "clip_id": clip_id,
                "source": {
                    "path": clip.get("source_video_path") or clip.get("rendered_video_path"),
                    "start": clip.get("adjusted_start", 0.0),
                    "end": clip.get("adjusted_end", 30.0),
                },
                "segments": [
                    {
                        "id": "seg_0",
                        "src_in": clip.get("adjusted_start", 0.0),
                        "src_out": clip.get("adjusted_end", 30.0),
                    }
                ],
                "words": words,
                "layout": {
                    "preset": clip.get("template_name", "ishowspeed_gaming"),
                    "regions": {
                        "person": {"x": 0.05, "y": 0.05, "w": 0.33, "h": 0.44, "keyframes": []},
                        "content": {"x": 0.16, "y": 0.0, "w": 0.67, "h": 1.0, "keyframes": []},
                    }
                },
                "captions": {
                    "font": "Montserrat ExtraBold",
                    "size": 72,
                    "color": "#FFFFFF",
                    "highlight": "#FACC15",
                    "outline": {"color": "#000000", "width": 4},
                    "animation": "pop",
                    "words_per_line": 3,
                    "position": {"x": 0.5, "y": 0.76}
                },
                "overlays": [],
                "audio": {"normalize": True, "music": None, "duck": True},
                "export": {"format": "9:16", "resolution": "1080p", "fps": 30}
            }
            await save_clip_edl(clip_id, edl)

        return web.json_response(edl)

    async def handle_save_clip_edl(self, request: web.Request) -> web.Response:
        """Save updated EDL JSON for a clip."""
        clip_id = int(request.match_info["id"])
        data = await request.json()
        new_version = await save_clip_edl(clip_id, data)
        return web.json_response({"success": True, "version": new_version})

    async def handle_get_clip_words(self, request: web.Request) -> web.Response:
        """Get cached word-level timestamps for a clip."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        words = []
        if clip.get("subtitle_path"):
            words_file = Path(clip["subtitle_path"]).with_suffix(".json")
            if words_file.exists():
                try:
                    with open(words_file, "r", encoding="utf-8") as f:
                        words = json.load(f)
                except Exception:
                    pass
        return web.json_response({"words": words})

    async def handle_transcribe_clip(self, request: web.Request) -> web.Response:
        """Run faster-whisper on demand for a clip and cache word timestamps."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        source_file = clip.get("source_video_path") or clip.get("rendered_video_path")
        if not source_file or not Path(source_file).exists():
            return web.json_response({"error": "Source video file not found"}, status=400)

        from src.intelligence.transcriber import Transcriber
        transcriber = Transcriber(model_size="base")
        transcription = await transcriber.transcribe(source_file)
        words = transcription.get("words", [])

        # Cache words to json
        if clip.get("subtitle_path"):
            words_file = Path(clip["subtitle_path"]).with_suffix(".json")
        else:
            words_file = Path(RENDER_DIR) / f"clip_{clip_id}_words.json"

        with open(words_file, "w", encoding="utf-8") as f:
            json.dump(words, f)

        # Also update EDL if exists
        edl = await get_clip_edl(clip_id)
        if edl:
            edl["words"] = words
            await save_clip_edl(clip_id, edl)

        return web.json_response({"success": True, "words": words})

    async def handle_serve_clip_source(self, request: web.Request) -> web.StreamResponse:
        """Stream original 16:9 source video with full HTTP 206 Range support for smooth scrubber seeking."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.Response(text="Clip not found", status=404)

        v_path = Path(clip.get("source_video_path") or clip.get("rendered_video_path") or "")
        if not v_path.exists():
            return web.Response(text="Source video file not found on disk", status=404)

        file_size = v_path.stat().st_size
        range_header = request.headers.get("Range")

        if not range_header:
            return web.FileResponse(v_path)

        # Parse Byte Range: "bytes=start-end"
        try:
            byte_range = range_header.replace("bytes=", "").split("-")
            start = int(byte_range[0])
            end = int(byte_range[1]) if byte_range[1] else file_size - 1
            length = (end - start) + 1
        except Exception:
            return web.FileResponse(v_path)

        headers = {
            "Content-Range": f"bytes {start}-{end}/{file_size}",
            "Accept-Ranges": "bytes",
            "Content-Length": str(length),
            "Content-Type": "video/mp4",
        }

        resp = web.StreamResponse(status=206, headers=headers)
        await resp.prepare(request)

        chunk_size = 64 * 1024
        with open(v_path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                read_amount = min(chunk_size, remaining)
                chunk = f.read(read_amount)
                if not chunk:
                    break
                await resp.write(chunk)
                remaining -= len(chunk)

        await resp.write_eof()
        return resp

    async def handle_get_clip_waveform(self, request: web.Request) -> web.Response:
        """Generate or return simulated audio peaks array (100 normalized float points) for timeline waveform."""
        clip_id = int(request.match_info["id"])
        import random
        # Seeded random for deterministic waveforms per clip
        random.seed(clip_id)
        peaks = [round(random.uniform(0.15, 0.95), 2) for _ in range(120)]
        return web.json_response({"peaks": peaks})

    async def handle_detect_faces(self, request: web.Request) -> web.Response:
        """Run Haar-cascade face detector on video to suggest smart initial crop box."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        source_path = clip.get("source_video_path") or clip.get("rendered_video_path")
        
        from src.compositor.face_tracker import FaceTracker
        tracker = FaceTracker()
        boxes = tracker.analyze_video_crops(source_path)
        first_box = boxes[0] if boxes else (656, 0, 608, 1080)
        
        # Normalize into percentage 0.0 - 1.0
        norm_box = {
            "x": round(first_box[0] / 1920, 3),
            "y": round(first_box[1] / 1080, 3),
            "w": round(first_box[2] / 1920, 3),
            "h": round(first_box[3] / 1080, 3),
        }
        return web.json_response({"suggested_person": norm_box})

    async def handle_render_from_edl(self, request: web.Request) -> web.Response:
        """Execute full FFmpeg render directly from EDL specifications."""
        clip_id = int(request.match_info["id"])
        data = await request.json()
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        # Save EDL
        await save_clip_edl(clip_id, data)

        # Trigger re-render with updated timestamps and regions
        segments = data.get("segments", [])
        if segments:
            in_point = segments[0]["src_in"]
            out_point = segments[-1]["src_out"]
            delta_start = in_point - clip["adjusted_start"]
            delta_end = out_point - clip["adjusted_end"]

            # Merge EDL layout and subtitle styles directly into the rendering template
            template_name = clip.get("template_name", "ishowspeed_gaming")
            from src.bot.trimmer import load_template
            active_template = load_template(template_name)

            if data.get("layout"):
                active_template["layout"] = data["layout"]
            if data.get("captions"):
                captions = data["captions"]
                if "subtitles" not in active_template:
                    active_template["subtitles"] = {}
                if captions.get("font"):
                    active_template["subtitles"]["font_name"] = captions["font"]
                if captions.get("size"):
                    active_template["subtitles"]["font_size"] = captions["size"]
                if captions.get("color"):
                    active_template["subtitles"]["primary_color"] = captions["color"]
                if captions.get("highlight"):
                    active_template["subtitles"]["highlight_color"] = captions["highlight"]
                if captions.get("position"):
                    active_template["subtitles"]["position"] = captions["position"]
                if captions.get("words_per_line"):
                    active_template["subtitles"]["words_per_line"] = captions["words_per_line"]

            updated = await self.trimmer.trim_and_rerender(
                clip_id=clip_id,
                delta_start=delta_start,
                delta_end=delta_end,
                custom_template=active_template
            )
            return web.json_response({"success": True, "clip": updated})

        return web.json_response({"success": True, "message": "EDL saved"})

    async def handle_get_fonts(self, request: web.Request) -> web.Response:
        """List fonts available for kinetic caption burning."""
        fonts = [
            {"name": "Montserrat ExtraBold", "category": "Energetic"},
            {"name": "TheBoldFont", "category": "Gaming"},
            {"name": "Anton", "category": "Impactful"},
            {"name": "Bangers", "category": "Comic"},
            {"name": "Poppins", "category": "Modern"},
            {"name": "Arial Black", "category": "Standard"},
        ]
        return web.json_response(fonts)

    async def handle_trim_clip(self, request: web.Request) -> web.Response:
        """Fine-tune start/end boundaries and re-render."""
        clip_id = int(request.match_info["id"])
        data = await request.json()
        delta_start = float(data.get("delta_start", 0.0))
        delta_end = float(data.get("delta_end", 0.0))

        updated_clip = await self.trimmer.trim_and_rerender(
            clip_id=clip_id,
            delta_start=delta_start,
            delta_end=delta_end,
        )
        if not updated_clip:
            return web.json_response({"error": "Trimming failed"}, status=500)
        return web.json_response(updated_clip)

    async def handle_toggle_teaser(self, request: web.Request) -> web.Response:
        """Toggle teaser pre-roll and re-render."""
        clip_id = int(request.match_info["id"])
        updated_clip = await self.trimmer.trim_and_rerender(
            clip_id=clip_id,
            toggle_teaser=True,
        )
        if not updated_clip:
            return web.json_response({"error": "Teaser toggle failed"}, status=500)
        return web.json_response(updated_clip)

    async def handle_update_clip(self, request: web.Request) -> web.Response:
        """Update clip title, description, or hashtags."""
        clip_id = int(request.match_info["id"])
        data = await request.json()
        title = data.get("title", "")
        description = data.get("description")
        hashtags = data.get("hashtags")

        await update_clip_caption(clip_id, title=title, description=description, hashtags=hashtags)
        return web.json_response({"success": True})

    async def handle_post_now(self, request: web.Request) -> web.Response:
        """Upload clip immediately to YouTube Shorts and Instagram Reels."""
        clip_id = int(request.match_info["id"])
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        template_name = clip.get("template_name", "ishowspeed_gaming")
        video_path = clip.get("rendered_video_path")
        title = clip.get("title", "Stream Highlight")
        description = clip.get("description", "")
        hashtags = [h.strip() for h in (clip.get("hashtags") or "").split() if h.strip()]

        dests = load_template_destinations(template_name)
        yt_key = dests.get("youtube_account_key")
        ig_key = dests.get("instagram_account_key")

        tasks = []
        if yt_key:
            yt_pub = YouTubeShortsPublisher(yt_key)
            tasks.append(yt_pub.upload_short(video_path, title, description, hashtags))
        if ig_key:
            ig_pub = InstagramReelsPublisher(ig_key)
            tasks.append(ig_pub.upload_reel(video_path, title, hashtags))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        yt_res = {"success": False, "error": "Not configured"}
        ig_res = {"success": False, "error": "Not configured"}
        idx = 0
        if yt_key:
            yt_res = results[idx] if not isinstance(results[idx], Exception) else {"success": False, "error": str(results[idx])}
            idx += 1
        if ig_key:
            ig_res = results[idx] if not isinstance(results[idx], Exception) else {"success": False, "error": str(results[idx])}

        overall_success = yt_res.get("success", False) or ig_res.get("success", False)
        if overall_success:
            await update_clip_status(clip_id, "published")

        return web.json_response({
            "success": overall_success,
            "youtube": yt_res,
            "instagram": ig_res,
        })

    async def handle_queue_clip(self, request: web.Request) -> web.Response:
        """Enqueue clip to Drip Queue."""
        clip_id = int(request.match_info["id"])
        next_slot = DripScheduler.calculate_next_slot(DRIP_INTERVAL_HOURS)
        qid = await enqueue_clip(clip_id, next_slot)
        return web.json_response({"success": True, "queue_id": qid, "scheduled_for": next_slot})

    async def handle_discard_clip(self, request: web.Request) -> web.Response:
        """Mark clip rejected and delete rendered MP4."""
        clip_id = int(request.match_info["id"])
        await update_clip_status(clip_id, "rejected")
        clip = await get_clip(clip_id)
        if clip and clip.get("rendered_video_path"):
            try:
                p = Path(clip["rendered_video_path"])
                if p.exists():
                    p.unlink()
            except Exception:
                pass
        return web.json_response({"success": True})

    async def handle_get_queue(self, request: web.Request) -> web.Response:
        """Get upcoming drip queue items."""
        queue = await get_upcoming_queue(limit=20)
        return web.json_response(queue)

    async def handle_clip_manual(self, request: web.Request) -> web.Response:
        """Trigger manual extraction from URL."""
        data = await request.json()
        url = data.get("url", "")
        template = data.get("template", "ishowspeed_gaming")

        if not url:
            return web.json_response({"error": "URL required"}, status=400)

        time_range = data.get("time_range")
        if self.on_manual_clip:
            asyncio.create_task(self.on_manual_clip(url, template, time_range))

        return web.json_response({"success": True, "message": "Manual clip processing initiated."})

    async def handle_get_logs(self, request: web.Request) -> web.Response:
        """Get live system logs for real-time web terminal."""
        since_id = int(request.query.get("since_id", "0"))
        logs = get_recent_logs(since_id=since_id)
        return web.json_response(logs)

    async def handle_get_pipeline_status(self, request: web.Request) -> web.Response:
        """Get live pipeline progress and trigger alerts."""
        state = get_pipeline_state()
        return web.json_response(state)

    async def handle_get_streamers(self, request: web.Request) -> web.Response:
        """Get live streamer statuses and presence."""
        statuses = get_all_streamer_statuses()
        return web.json_response(statuses)

    async def start(self) -> None:
        """Start aiohttp web server runner."""
        runner = web.AppRunner(self.app)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logger.info("🌐 Web UI Dashboard running at http://localhost:%d", self.port)

