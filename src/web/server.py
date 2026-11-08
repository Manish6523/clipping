"""Asynchronous Web UI Dashboard and REST API Server built with aiohttp.web."""

import asyncio
from datetime import datetime, timezone
import json
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict

from aiohttp import web

from config.settings import (
    RENDER_DIR,
    OUTPUT_DIR,
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
    delete_clip_completely,
    verify_auth_pin,
    validate_auth_session,
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
from src.web.routes_youtube import register_youtube_routes
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
        # Enable timing & auth middleware
        self.app = web.Application(middlewares=[request_timing_middleware, self.auth_middleware])
        self._setup_routes()

    @web.middleware
    async def auth_middleware(self, request: web.Request, handler):
        """Protect API endpoints, media files, and websockets via session token."""
        path = request.path

        # Unrestricted public paths: SPA pages, assets, favicon, login API, health check
        if (
            path == "/"
            or path.startswith("/assets")
            or path.startswith("/favicon")
            or path == "/logo.png"
            or path == "/api/status"
            or path == "/api/auth/verify"
            or not (path.startswith("/api/") or path.startswith("/ws") or path.startswith("/renders/") or path.startswith("/output/"))
        ):
            return await handler(request)

        # Check Authorization header (Bearer <token>), cookie, or query param
        auth_header = request.headers.get("Authorization", "")
        token = ""
        if auth_header.startswith("Bearer "):
            token = auth_header[7:].strip()
        elif "token" in request.query:
            token = request.query.get("token", "")
        elif "autoclip_session" in request.cookies:
            token = request.cookies.get("autoclip_session", "")

        is_valid = await validate_auth_session(token)
        if not is_valid:
            if path.startswith("/ws"):
                ws = web.WebSocketResponse()
                await ws.prepare(request)
                await ws.close(code=4001, message=b"Unauthorized")
                return ws
            return web.json_response(
                {"error": {"code": "UNAUTHORIZED", "message": "Authentication required. Generate a PIN via Telegram."}},
                status=401
            )

        return await handler(request)

    def _setup_routes(self) -> None:
        """Register web routes."""
        self.app.router.add_get("/", self.handle_index)
        self.app.router.add_get("/api/status", self.handle_status)
        self.app.router.add_post("/api/auth/verify", self.handle_auth_verify)
        self.app.router.add_get("/ws", ws_manager.handle_ws)

        # Register modular sub-routers
        register_health_routes(self.app)
        register_clips_routes(self.app)
        register_channel_routes(self.app)
        register_template_routes(self.app)
        register_presets_routes(self.app)
        register_youtube_routes(self.app)

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
        self.app.router.add_post("/api/clips/batch-discard", self.handle_batch_discard_clips)
        self.app.router.add_get("/api/queue", self.handle_get_queue)
        self.app.router.add_post("/api/clip-manual", self.handle_clip_manual)
        self.app.router.add_get("/api/logs", self.handle_get_logs)
        self.app.router.add_get("/api/pipeline/status", self.handle_get_pipeline_status)
        self.app.router.add_get("/api/streamers", self.handle_get_streamers)

        # Serve static rendered video files & posters
        self.app.router.add_static("/renders", path=str(RENDER_DIR), name="renders", show_index=False)
        self.app.router.add_static("/output", path=str(OUTPUT_DIR), name="output_clips", show_index=False)

        # Serve built frontend static assets
        dist_assets = Path(__file__).resolve().parent.parent.parent / "frontend" / "dist" / "assets"
        if dist_assets.exists():
            self.app.router.add_static("/assets", path=str(dist_assets), name="frontend_assets", show_index=False)

        self.app.router.add_get("/api/pipeline/runs", self.handle_get_pipeline_runs)
        self.app.router.add_get("/api/settings", self.handle_get_settings)
        self.app.router.add_post("/api/settings", self.handle_save_settings)
        self.app.router.add_post("/api/settings/test-key", self.handle_test_gemini_key)
        self.app.router.add_get("/api/clips/{id}/explain", self.handle_get_clip_explain)
        self.app.router.add_post("/api/clips/{id}/feedback", self.handle_post_clip_feedback)
        self.app.router.add_get("/api/channels/{id}/learning", self.handle_get_channel_learning)
        self.app.router.add_post("/api/channels/{id}/learning/reset", self.handle_reset_channel_learning)
        self.app.router.add_post("/api/channels/{id}/learning/pause", self.handle_pause_channel_learning)

        # SPA catch-all for react-router routes like /clips/{id}/editor and /channels/{id}/settings
        self.app.router.add_get("/{tail:(?!api|renders|output|assets|ws).*$}", self.handle_spa_fallback)

    async def handle_auth_verify(self, request: web.Request) -> web.Response:
        """Verify 6-digit PIN and issue session token."""
        try:
            body = await request.json()
        except Exception:
            body = {}

        raw_pin = str(body.get("pin", "")).strip().replace("-", "").replace(" ", "")
        if not raw_pin or len(raw_pin) != 6 or not raw_pin.isdigit():
            return web.json_response(
                {"error": {"code": "INVALID_PIN", "message": "PIN must be a 6-digit numeric code."}},
                status=400
            )

        ua = request.headers.get("User-Agent", "Web Browser")[:60]
        session = await verify_auth_pin(raw_pin, device_info=ua)
        if not session:
            return web.json_response(
                {"error": {"code": "PIN_EXPIRED", "message": "Invalid or expired PIN. Please generate a new one via Telegram (/pin)."}},
                status=401
            )

        resp = web.json_response({
            "success": True,
            "token": session["token"],
            "expires_at": session["expires_at"],
            "duration_seconds": session["duration_seconds"],
        })
        # Set HttpOnly cookie as convenient fallback
        resp.set_cookie(
            "autoclip_session",
            session["token"],
            max_age=session["duration_seconds"],
            path="/",
            httponly=True,
            samesite="Lax"
        )
        return resp

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

            # Retrieve actual template layout if available
            tpl_name = clip.get("template_name", "ishowspeed_gaming")
            person_region = {"x": 0.05, "y": 0.05, "w": 0.33, "h": 0.44, "keyframes": []}
            content_region = {"x": 0.16, "y": 0.0, "w": 0.67, "h": 1.0, "keyframes": []}
            tpl_layout_type = "facecam_top_gameplay_bottom"
            tpl_subtitles = {}
            tpl_schema2_layout = None

            tpl_file = Path(TEMPLATES_DIR) / f"{tpl_name}.json"
            if tpl_file.exists():
                try:
                    with open(tpl_file, "r", encoding="utf-8") as f:
                        tpl_data = json.load(f)
                        tpl_layout = tpl_data.get("layout", {})
                        
                        # Schema v2 with layers directly in template!
                        if tpl_layout.get("layers") and isinstance(tpl_layout["layers"], list):
                            tpl_schema2_layout = tpl_layout
                        else:
                            tpl_layout_type = tpl_layout.get("type", "facecam_top_gameplay_bottom")
                            top_c = tpl_layout.get("top_crop", {})
                            bot_c = tpl_layout.get("bottom_crop", {})
                            if top_c:
                                person_region = {
                                    "x": top_c.get("normalized_x", (top_c.get("source_x", 0) / 1920)),
                                    "y": top_c.get("normalized_y", (top_c.get("source_y", 0) / 1080)),
                                    "w": top_c.get("normalized_w", (top_c.get("source_w", 640) / 1920)),
                                    "h": top_c.get("normalized_h", (top_c.get("source_h", 480) / 1080)),
                                    "keyframes": [],
                                }
                            if bot_c:
                                content_region = {
                                    "x": bot_c.get("normalized_x", (bot_c.get("source_x", 384) / 1920)),
                                    "y": bot_c.get("normalized_y", (bot_c.get("source_y", 0) / 1080)),
                                    "w": bot_c.get("normalized_w", (bot_c.get("source_w", 1152) / 1920)),
                                    "h": bot_c.get("normalized_h", (bot_c.get("source_h", 1080) / 1080)),
                                    "keyframes": [],
                                }
                        tpl_subtitles = tpl_data.get("subtitles", {})
                except Exception as ex:
                    logger.warning("Could not read template '%s' for EDL init: %s", tpl_name, ex)

            caption_pos_y = 0.76
            if tpl_subtitles.get("position", {}).get("y") is not None:
                caption_pos_y = tpl_subtitles["position"]["y"]
            elif tpl_subtitles.get("margin_v"):
                caption_pos_y = round((1920 - tpl_subtitles["margin_v"]) / 1920, 4)

            # Modern Schema v2 Layout with Layers
            if tpl_schema2_layout:
                layout_obj = {
                    "schema": 2,
                    "canvas": tpl_schema2_layout.get("canvas", {"w": 1080, "h": 1920}),
                    "background": tpl_schema2_layout.get("background", {"type": "solid", "color": "#000000", "blur": 0, "dim": 0.0}),
                    "layers": tpl_schema2_layout["layers"],
                }
            else:
                layout_obj = {
                    "schema": 2,
                    "canvas": {"w": 1080, "h": 1920},
                    "background": {"type": "solid", "color": "#000000", "blur": 0, "dim": 0.0},
                    "layers": [
                        {
                            "id": "l_game",
                            "name": "Gameplay",
                            "color": "#00F0FF",
                            "visible": True,
                            "locked": False,
                            "src": {
                                "x": content_region.get("x", 0.20),
                                "y": content_region.get("y", 0.0),
                                "w": content_region.get("w", 0.60),
                                "h": content_region.get("h", 1.0),
                            },
                            "dst": {"x": 0.0, "y": 0.38, "w": 1.0, "h": 0.62},
                            "fit": "cover",
                            "aspect_lock": True,
                            "style": {
                                "radius": 0,
                                "shape": "rect",
                                "border": {"w": 0, "color": "#FFFFFF"},
                                "shadow": {"blur": 0, "opacity": 0},
                                "opacity": 1.0,
                                "mirror": False,
                            },
                            "tracking": {"mode": "off", "smooth": 0.8},
                        },
                        {
                            "id": "l_facecam",
                            "name": "Facecam",
                            "color": "#FFB020",
                            "visible": True,
                            "locked": False,
                            "src": {
                                "x": person_region.get("x", 0.0),
                                "y": person_region.get("y", 0.58),
                                "w": person_region.get("w", 0.32),
                                "h": person_region.get("h", 0.42),
                            },
                            "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.38},
                            "fit": "cover",
                            "aspect_lock": True,
                            "style": {
                                "radius": 0,
                                "shape": "rect",
                                "border": {"w": 0, "color": "#FFFFFF"},
                                "shadow": {"blur": 0, "opacity": 0},
                                "opacity": 1.0,
                                "mirror": False,
                            },
                            "tracking": {"mode": "off", "smooth": 0.8},
                        },
                    ],
                }

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
                "layout": layout_obj,
                "captions": {
                    "font": tpl_subtitles.get("font_name", "Montserrat ExtraBold"),
                    "size": tpl_subtitles.get("font_size", 72),
                    "color": "#FFFFFF",
                    "highlight": "#FACC15",
                    "outline": {"color": "#000000", "width": tpl_subtitles.get("outline", 4)},
                    "animation": tpl_subtitles.get("animation", "pop"),
                    "words_per_line": 3,
                    "position": {"x": 0.5, "y": caption_pos_y}
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
        channel_id = clip.get("channel_id") or ""

        # Check streamer-to-YouTube mappings first
        from src.database import get_accounts_for_streamer
        mapped_yt_keys = await get_accounts_for_streamer(channel_id)
        if not mapped_yt_keys and channel_id.startswith("@"):
            mapped_yt_keys = await get_accounts_for_streamer(channel_id[1:])
        elif not mapped_yt_keys:
            mapped_yt_keys = await get_accounts_for_streamer(f"@{channel_id}")

        dests = load_template_destinations(template_name)
        if not mapped_yt_keys and dests.get("youtube_account_key"):
            mapped_yt_keys = [dests.get("youtube_account_key")]

        ig_key = dests.get("instagram_account_key")

        tasks = []
        task_types = []
        for yt_k in mapped_yt_keys:
            yt_pub = YouTubeShortsPublisher(yt_k)
            tasks.append(yt_pub.upload_short(video_path, title, description, hashtags))
            task_types.append(("youtube", yt_k))

        if ig_key:
            ig_pub = InstagramReelsPublisher(ig_key)
            tasks.append(ig_pub.upload_reel(video_path, title, hashtags))
            task_types.append(("instagram", ig_key))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        yt_results = []
        ig_res = {"success": False, "error": "Not configured"}

        for (kind, key), res in zip(task_types, results):
            formatted_res = res if not isinstance(res, Exception) else {"success": False, "error": str(res), "account_key": key}
            if kind == "youtube":
                yt_results.append(formatted_res)
            elif kind == "instagram":
                ig_res = formatted_res

        has_yt_success = any(r.get("success") for r in yt_results)
        overall_success = has_yt_success or ig_res.get("success", False)
        if overall_success:
            await update_clip_status(clip_id, "published")

        return web.json_response({
            "success": overall_success,
            "youtube": yt_results if yt_results else {"success": False, "error": "No mapped YouTube account"},
            "instagram": ig_res,
        })

    async def handle_queue_clip(self, request: web.Request) -> web.Response:
        """Enqueue clip to Drip Queue."""
        clip_id = int(request.match_info["id"])
        next_slot = DripScheduler.calculate_next_slot(DRIP_INTERVAL_HOURS)
        qid = await enqueue_clip(clip_id, next_slot)
        return web.json_response({"success": True, "queue_id": qid, "scheduled_for": next_slot})

    async def handle_discard_clip(self, request: web.Request) -> web.Response:
        """Purge clip and delete all its files, database rows, and instances."""
        clip_id = int(request.match_info["id"])
        success = await delete_clip_completely(clip_id)
        await ws_manager.broadcast("clip_deleted", {"clip_id": clip_id})
        return web.json_response({"success": success, "deleted": clip_id})

    async def handle_batch_discard_clips(self, request: web.Request) -> web.Response:
        """Purge multiple clips in batch."""
        data = await request.json()
        clip_ids = data.get("clip_ids", [])
        if not isinstance(clip_ids, list):
            return web.json_response({"error": "clip_ids must be an array"}, status=400)
        
        deleted = []
        for cid in clip_ids:
            try:
                ok = await delete_clip_completely(int(cid))
                if ok:
                    deleted.append(int(cid))
                    await ws_manager.broadcast("clip_deleted", {"clip_id": int(cid)})
            except Exception as ex:
                logger.error("Failed to batch discard clip #%s: %s", cid, ex)

        return web.json_response({"success": True, "deleted_count": len(deleted), "deleted_ids": deleted})

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
        if isinstance(time_range, (list, tuple)) and len(time_range) == 2:
            time_range = f"{time_range[0]}-{time_range[1]}"

        if self.on_manual_clip:
            asyncio.create_task(self.on_manual_clip(url, template, time_range))

        return web.json_response({"success": True, "message": "Manual clip processing initiated."})

    async def handle_get_settings(self, request: web.Request) -> web.Response:
        """Get all system settings with environment fallbacks."""
        from src.database import get_all_system_settings
        from config.settings import GEMINI_API_KEY, GEMINI_API_KEYS, GEMINI_MODEL, DEFAULT_MIN_VIRALITY_SCORE
        
        db_settings = await get_all_system_settings()

        # Build clean response payload
        keys_val = db_settings.get("gemini_api_keys", {}).get("value")
        keys_list = []
        if keys_val:
            try:
                # Support new JSON array format: [{"key": "...", "label": "..."}, ...]
                parsed = json.loads(keys_val)
                if isinstance(parsed, list):
                    for item in parsed:
                        if isinstance(item, dict):
                            keys_list.append(item)
                        elif isinstance(item, str):
                            keys_list.append({"key": item, "label": "Google Account"})
            except Exception:
                for k in keys_val.split(","):
                    if k.strip():
                        keys_list.append({"key": k.strip(), "label": "Google Account"})
        else:
            raw_pool = list(GEMINI_API_KEYS) or ([GEMINI_API_KEY] if GEMINI_API_KEY else [])
            for idx, k in enumerate(raw_pool):
                keys_list.append({"key": k, "label": f"Account {idx + 1}"})

        model_val = db_settings.get("gemini_model", {}).get("value") or GEMINI_MODEL or "gemini-flash-lite-latest"
        min_score = db_settings.get("min_virality_score", {}).get("value") or DEFAULT_MIN_VIRALITY_SCORE

        return web.json_response({
            "gemini_api_keys": keys_list,
            "gemini_model": model_val,
            "min_virality_score": int(min_score),
            "total_keys_count": len(keys_list),
        })

    async def handle_save_settings(self, request: web.Request) -> web.Response:
        """Save settings to database and immediately update running in-memory configurations."""
        from src.database import set_system_setting
        import config.settings as s
        data = await request.json()

        keys = data.get("gemini_api_keys", [])
        if isinstance(keys, list):
            # Store full list with labels as JSON in database
            keys_json_str = json.dumps(keys)
            await set_system_setting("gemini_api_keys", keys_json_str, category="ai", description="Labeled pool of Gemini API keys for auto-failover")
            
            # Extract plain key strings for in-memory settings
            plain_keys = []
            for item in keys:
                if isinstance(item, dict) and item.get("key"):
                    plain_keys.append(item["key"].strip())
                elif isinstance(item, str) and item.strip():
                    plain_keys.append(item.strip())

            s.GEMINI_API_KEYS = plain_keys
            if plain_keys:
                s.GEMINI_API_KEY = plain_keys[0]

        model = data.get("gemini_model")
        if model:
            await set_system_setting("gemini_model", model.strip(), category="ai", description="Primary Google Gemini model")
            s.GEMINI_MODEL = model.strip()

        min_score = data.get("min_virality_score")
        if min_score is not None:
            await set_system_setting("min_virality_score", str(int(min_score)), category="scoring", description="Minimum threshold for clip extraction")
            s.DEFAULT_MIN_VIRALITY_SCORE = int(min_score)

        return web.json_response({"success": True, "message": "Settings updated and applied immediately."})

    async def handle_test_gemini_key(self, request: web.Request) -> web.Response:
        """Test a candidate Gemini API key for validity and quota status."""
        import urllib.request
        data = await request.json()
        key = data.get("api_key", "").strip()
        model = data.get("model", "gemini-flash-lite-latest").strip()

        if not key:
            return web.json_response({"valid": False, "error": "API key required"}, status=400)

        # Fallback to gemini-flash-lite-latest if old 2.5 endpoint returns 404
        candidate_models = [model]
        if model != "gemini-flash-lite-latest":
            candidate_models.append("gemini-flash-lite-latest")
        if "gemini-flash-latest" not in candidate_models:
            candidate_models.append("gemini-flash-latest")

        last_error = "Unknown error"
        for mod in candidate_models:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{mod}:generateContent?key={key}"
            payload = json.dumps({"contents": [{"parts": [{"text": "Reply with 'OK'"}]}]}).encode("utf-8")
            req = urllib.request.Request(url, headers={"Content-Type": "application/json"}, data=payload)

            try:
                loop = asyncio.get_running_loop()
                res = await loop.run_in_executor(None, lambda: urllib.request.urlopen(req, timeout=8.0))
                resp_data = json.loads(res.read().decode())
                text = resp_data.get("candidates", [{}])[0].get("content", {}).get("parts", [{}])[0].get("text", "")
                return web.json_response({"valid": True, "message": f"Active & Responding ({mod})", "preview": text.strip()})
            except Exception as e:
                err_msg = str(e)
                if "429" in err_msg or "ResourceExhausted" in err_msg:
                    return web.json_response({"valid": False, "error": "Rate limit / Quota exceeded (429)"})
                elif "400" in err_msg or "API key not valid" in err_msg:
                    return web.json_response({"valid": False, "error": "Invalid API Key"})
                elif "404" in err_msg:
                    last_error = f"Model {mod} not supported for this key"
                    continue
                else:
                    last_error = err_msg

        return web.json_response({"valid": False, "error": last_error})

    async def handle_get_pipeline_runs(self, request: web.Request) -> web.Response:
        """Get recent pipeline execution runs with candidate counts, stages, and latency, including in-flight pipelines."""
        from src.database import get_db_connection
        from src.web.logger_stream import get_pipeline_state

        runs = []
        # First check in-flight pipelines from memory state (ONLY currently active, non-completed/non-idle)
        p_state = get_pipeline_state()
        active_list = p_state.get("active_pipelines", [])
        for act in active_list:
            act_status = act.get("status", "running")
            # Only include genuinely running / processing jobs
            if act_status in ("completed", "idle"):
                continue
            
            runs.append({
                "id": f"live_{act.get('channel_id', 'job')}",
                "source_id": f"Manual / Live ({act.get('trigger_reason', 'stream')})",
                "channel_id": act.get("channel_id", "live"),
                "stage": act.get("step_name", "processing"),
                "step": act.get("current_step", 1),
                "total_steps": 5,
                "status": "running" if act_status in ("processing", "triggered") else act_status,
                "candidates_count": 1,
                "latency_seconds": round(time.time() - act.get("updated_at", time.time()), 1),
                "prompt_version": "v2.0_best_clips",
                "created_at": datetime.now(timezone.utc).isoformat(),
            })

        # Next load persisted runs from DB
        try:
            async with get_db_connection() as db:
                cur = await db.execute("SELECT * FROM pipeline_runs ORDER BY created_at DESC LIMIT 30")
                rows = await cur.fetchall()
                for r in rows:
                    r_dict = dict(r)
                    if not any(run["id"] == r_dict["id"] for run in runs):
                        runs.append(r_dict)
        except Exception as e:
            logger.warning("Could not query pipeline_runs table: %s", e)

        return web.json_response(runs)

    async def handle_get_clip_explain(self, request: web.Request) -> web.Response:
        """Provide detailed 'Why this clip' explanation, sub-scores, and AI reasoning."""
        clip_id = int(request.match_info["id"])
        from src.database import get_clip
        clip = await get_clip(clip_id)
        if not clip:
            return web.json_response({"error": "Clip not found"}, status=404)

        score_breakdown = clip.get("score_breakdown")
        if isinstance(score_breakdown, str):
            try:
                score_breakdown = json.loads(score_breakdown)
            except Exception:
                pass

        flags = clip.get("flags")
        if isinstance(flags, str):
            try:
                flags = json.loads(flags)
            except Exception:
                flags = []

        return web.json_response({
            "clip_id": clip_id,
            "title": clip.get("title"),
            "virality_score": clip.get("virality_score"),
            "final_score": clip.get("final_score", clip.get("virality_score")),
            "prompt_version": clip.get("prompt_version", "v2.0_best_clips"),
            "score_breakdown": score_breakdown or {
                "hook_2s": 8.5,
                "stands_alone": 9.0,
                "payoff": 8.0,
                "pacing": 8.5,
                "weights": {"llm": 0.55, "signal": 0.30, "history": 0.15}
            },
            "flags": flags or [],
            "reason": clip.get("description", "Selected based on high retention and dialogue momentum.")
        })

    async def handle_post_clip_feedback(self, request: web.Request) -> web.Response:
        """Record human feedback (approved, rejected, trimmed) with reason codes."""
        clip_id = int(request.match_info["id"])
        data = await request.json()
        event = data.get("event", "approved")
        channel_id = data.get("channel_id", "default")
        payload = data.get("payload", {})

        from src.intelligence.learning.feedback import FeedbackLearner
        await FeedbackLearner.log_feedback(
            clip_id=clip_id,
            channel_id=channel_id,
            event=event,
            payload=payload,
        )
        return web.json_response({"success": True})

    async def handle_get_channel_learning(self, request: web.Request) -> web.Response:
        """Retrieve learned boundary biases, signal weights, and review statistics."""
        channel_id = request.match_info["id"]
        from src.intelligence.learning.feedback import FeedbackLearner
        data = await FeedbackLearner.get_channel_learning(channel_id)
        return web.json_response(data)

    async def handle_reset_channel_learning(self, request: web.Request) -> web.Response:
        """Reset learned weights and boundary biases to defaults."""
        channel_id = request.match_info["id"]
        from src.database import get_db_connection
        from src.intelligence.learning.feedback import FeedbackLearner
        async with get_db_connection() as db:
            await db.execute(
                """
                UPDATE channel_learning SET
                    weights_json = ?,
                    boundary_bias_json = ?,
                    updated_at = CURRENT_TIMESTAMP
                WHERE channel_id = ?
                """,
                (
                    json.dumps(FeedbackLearner.DEFAULT_WEIGHTS),
                    json.dumps({"start_bias": 0.0, "end_bias": 0.0, "count": 0}),
                    channel_id
                )
            )
            await db.commit()
        return web.json_response({"success": True, "reset": channel_id})

    async def handle_pause_channel_learning(self, request: web.Request) -> web.Response:
        """Pause or unpause auto-updating weights for a channel."""
        channel_id = request.match_info["id"]
        data = await request.json()
        paused = 1 if data.get("paused", True) else 0
        from src.database import get_db_connection
        async with get_db_connection() as db:
            await db.execute("UPDATE channel_learning SET is_paused = ? WHERE channel_id = ?", (paused, channel_id))
            await db.commit()
        return web.json_response({"success": True, "paused": bool(paused)})

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
        # Silence aiohttp's recurring GET access logs to avoid terminal lag & journal disk bloating
        logging.getLogger("aiohttp.access").setLevel(logging.WARNING)
        
        runner = web.AppRunner(self.app, access_log=None)
        await runner.setup()
        site = web.TCPSite(runner, self.host, self.port)
        await site.start()
        logger.info("🌐 Web UI Dashboard running at http://localhost:%d", self.port)

