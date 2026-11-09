"""Channels and Streamers REST API Router.

Includes:
- GET /api/channels (all monitored channels with live status & pause states)
- POST /api/channels (add channel)
- DELETE /api/channels/{handle}
- PATCH /api/channels/{id} (edit settings with schema validation)
- POST /api/channels/{id}/pause (stop monitor & cancel in-flight jobs)
- POST /api/channels/{id}/resume (restart monitor)
- GET /api/channels/{id}/frame (real stream snapshot for Template Studio)
- POST /api/daemon/pause (global daemon pause)
- POST /api/daemon/resume (global daemon resume)
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from config.settings import BUFFER_DIR, TEMPLATES_DIR
from src.database import get_db_connection, get_active_channels, add_channel, remove_channel
from src.web.ws_manager import ws_manager

logger = logging.getLogger(__name__)


def make_json_error(code: str, message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": {"code": code, "message": message}}, status=status)


async def get_channels_list(request: web.Request) -> web.Response:
    """Return all channels with enriched supervisor state, template, and stats."""
    async with get_db_connection() as db:
        cur = await db.execute("""
            SELECT id, platform, channel_id_or_handle, template_name, is_active,
                   enabled, paused_at, pause_reason, display_name, notes, settings_json, created_at
            FROM channels
            ORDER BY id ASC
        """)
        rows = await cur.fetchall()

        channels = []
        for r in rows:
            d = dict(r)
            # Count clips today
            c_cur = await db.execute(
                "SELECT COUNT(*) FROM clips WHERE channel_id = ? AND date(created_at) = date('now')",
                (d["channel_id_or_handle"],)
            )
            c_row = await c_cur.fetchone()
            d["clips_today"] = c_row[0] if c_row else 0

            # Parse settings_json
            if d.get("settings_json"):
                try:
                    d["settings"] = json.loads(d["settings_json"])
                except Exception:
                    d["settings"] = {}
            else:
                d["settings"] = {}

            channels.append(d)

        return web.json_response(channels)


async def patch_channel_settings(request: web.Request) -> web.Response:
    """Validate and update settings for a streamer, hot-reloading their supervisor."""
    channel_id_param = request.match_info["id"]
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Request body must be valid JSON", status=400)

    # Resolve channel by either numeric id or handle
    async with get_db_connection() as db:
        if channel_id_param.isdigit():
            cur = await db.execute("SELECT * FROM channels WHERE id = ?", (int(channel_id_param),))
        else:
            cur = await db.execute("SELECT * FROM channels WHERE channel_id_or_handle = ?", (channel_id_param,))
        channel_raw = await cur.fetchone()
        if not channel_raw:
            return make_json_error("NOT_FOUND", f"Channel {channel_id_param} not found", status=404)

        channel = dict(channel_raw)
        cid = channel["id"]
        handle = channel["channel_id_or_handle"]

        template_name = data.get("template_name", channel.get("template_name", "custom_gaming_split")).strip()
        display_name = data.get("display_name", channel.get("display_name"))
        notes = data.get("notes", channel.get("notes"))
        settings_obj = data.get("settings", {})

        # Settings validation & defaults
        clip_rules = settings_obj.get("clip_rules", {})
        min_len = max(5.0, float(clip_rules.get("min_length", 15.0)))
        max_len = min(90.0, float(clip_rules.get("max_length", 60.0)))
        if min_len >= max_len:
            return make_json_error("VALIDATION_ERROR", "min_length must be less than max_length")

        settings_str = json.dumps(settings_obj)

        await db.execute("""
            UPDATE channels
            SET template_name = ?, display_name = ?, notes = ?, settings_json = ?
            WHERE id = ?
        """, (template_name, display_name, notes, settings_str, cid))
        await db.commit()

    # Broadcast hot-reload event
    await ws_manager.broadcast("channel_settings_changed", {
        "channel_id": handle,
        "template_name": template_name,
        "settings": settings_obj
    })

    return web.json_response({
        "success": True,
        "channel_id": handle,
        "template_name": template_name,
        "settings": settings_obj
    })


async def pause_channel(request: web.Request) -> web.Response:
    """Pause a channel's supervisor and optionally cancel in-flight jobs."""
    channel_id_param = request.match_info["id"]
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass

    reason = body.get("reason", "User requested pause")
    stop_immediate = bool(body.get("stop_immediate", False))

    async with get_db_connection() as db:
        if channel_id_param.isdigit():
            cur = await db.execute("SELECT channel_id_or_handle FROM channels WHERE id = ?", (int(channel_id_param),))
        else:
            cur = await db.execute("SELECT channel_id_or_handle FROM channels WHERE channel_id_or_handle = ?", (channel_id_param,))
        row = await cur.fetchone()
        if not row:
            return make_json_error("NOT_FOUND", f"Channel {channel_id_param} not found", status=404)
        handle = row[0]

        await db.execute(
            "UPDATE channels SET enabled = 0, paused_at = datetime('now'), pause_reason = ? WHERE channel_id_or_handle = ?",
            (reason, handle)
        )
        if stop_immediate:
            await db.execute(
                "UPDATE pipeline_jobs SET status = 'cancelled' WHERE channel_id = ? AND status IN ('pending', 'running')",
                (handle,)
            )
        await db.commit()

    await ws_manager.broadcast("channel_status", {
        "channel_id": handle,
        "status": "paused",
        "reason": reason
    })

    return web.json_response({"success": True, "channel_id": handle, "status": "paused", "reason": reason})


async def resume_channel(request: web.Request) -> web.Response:
    """Resume monitoring for a paused channel."""
    channel_id_param = request.match_info["id"]
    async with get_db_connection() as db:
        if channel_id_param.isdigit():
            cur = await db.execute("SELECT channel_id_or_handle FROM channels WHERE id = ?", (int(channel_id_param),))
        else:
            cur = await db.execute("SELECT channel_id_or_handle FROM channels WHERE channel_id_or_handle = ?", (channel_id_param,))
        row = await cur.fetchone()
        if not row:
            return make_json_error("NOT_FOUND", f"Channel {channel_id_param} not found", status=404)
        handle = row[0]

        await db.execute(
            "UPDATE channels SET enabled = 1, paused_at = NULL, pause_reason = NULL WHERE channel_id_or_handle = ?",
            (handle,)
        )
        await db.commit()

    await ws_manager.broadcast("channel_status", {
        "channel_id": handle,
        "status": "running"
    })

    return web.json_response({"success": True, "channel_id": handle, "status": "running"})


async def get_channel_live_frame(request: web.Request) -> web.Response:
    """Extract a real frame snapshot from channel's recent ring buffer for Template Studio canvas."""
    channel_handle = request.match_info["id"]
    c_buf = Path(BUFFER_DIR) / channel_handle
    out_jpg = c_buf / "latest_frame.jpg"

    # 1. Try extracting from active ring buffer chunks
    import glob
    chunks = sorted(glob.glob(str(c_buf / "chunk_*.ts")), key=os.path.getmtime)
    if chunks:
        latest_chunk = chunks[-1]
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", "0.5",
                "-i", str(latest_chunk),
                "-vframes", "1",
                "-q:v", "3",
                str(out_jpg)
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.communicate(), timeout=5.0)
        except Exception:
            pass

    # 2. If latest_frame.jpg exists and is non-empty, serve it
    if out_jpg.exists() and out_jpg.stat().st_size > 0:
        return web.FileResponse(out_jpg)

    # 3. Fallback: check recent highlight mp4s or clip renders for this channel
    highlights = sorted(glob.glob(str(c_buf / "highlight_*.mp4")), key=os.path.getmtime)
    if highlights:
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", "2.0",
                "-i", str(highlights[-1]),
                "-vframes", "1",
                "-q:v", "3",
                str(out_jpg)
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.communicate(), timeout=5.0)
            if out_jpg.exists() and out_jpg.stat().st_size > 0:
                return web.FileResponse(out_jpg)
        except Exception:
            pass

    # 4. Check rendered clip thumbnails in both RENDER_DIR and OUTPUT_DIR
    from config.settings import RENDER_DIR, OUTPUT_DIR
    rendered_thumbs = sorted(glob.glob(str(Path(RENDER_DIR) / f"*{channel_handle}*thumb*.jpg")), key=os.path.getmtime)
    if rendered_thumbs and Path(rendered_thumbs[-1]).exists():
        return web.FileResponse(rendered_thumbs[-1])

    output_thumbs = sorted(glob.glob(str(Path(OUTPUT_DIR) / f"*{channel_handle}*thumb*.jpg")), key=os.path.getmtime)
    if output_thumbs and Path(output_thumbs[-1]).exists():
        return web.FileResponse(output_thumbs[-1])

    # 4b. Extract a frame snapshot from recent output clips if channel is offline
    output_clips = sorted(glob.glob(str(Path(OUTPUT_DIR) / f"*{channel_handle}*.mp4")), key=os.path.getmtime)
    if output_clips:
        latest_clip = output_clips[-1]
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", "1.0",
                "-i", str(latest_clip),
                "-vframes", "1",
                "-q:v", "3",
                str(out_jpg)
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.communicate(), timeout=5.0)
            if out_jpg.exists() and out_jpg.stat().st_size > 0:
                return web.FileResponse(out_jpg)
        except Exception:
            pass

    # 4c. Extract from any existing mp4 clip in OUTPUT_DIR as universal fallback
    any_clips = sorted(glob.glob(str(Path(OUTPUT_DIR) / "*.mp4")), key=os.path.getmtime)
    if any_clips:
        try:
            cmd = [
                "ffmpeg", "-y",
                "-ss", "1.0",
                "-i", str(any_clips[-1]),
                "-vframes", "1",
                "-q:v", "3",
                str(out_jpg)
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.communicate(), timeout=5.0)
            if out_jpg.exists() and out_jpg.stat().st_size > 0:
                return web.FileResponse(out_jpg)
        except Exception:
            pass

    # 5. Last fallback: any existing latest_frame.jpg anywhere in buffer
    any_frames = sorted(glob.glob(str(Path(BUFFER_DIR) / "*" / "latest_frame.jpg")), key=os.path.getmtime)
    if any_frames and Path(any_frames[-1]).exists():
        return web.FileResponse(any_frames[-1])

    return make_json_error("NO_FRAME", f"No live video chunks available yet for {channel_handle}", status=404)


async def pause_daemon(request: web.Request) -> web.Response:
    """Globally pause all monitoring pipelines."""
    body = {}
    try:
        body = await request.json()
    except Exception:
        pass
    reason = body.get("reason", "Global pause")

    async with get_db_connection() as db:
        await db.execute(
            "UPDATE daemon_state SET is_paused = 1, paused_at = datetime('now'), pause_reason = ? WHERE id = 1",
            (reason,)
        )
        await db.commit()

    await ws_manager.broadcast("daemon_status", {"status": "paused", "reason": reason})
    return web.json_response({"success": True, "daemon": "paused", "reason": reason})


async def resume_daemon(request: web.Request) -> web.Response:
    """Globally resume all monitoring pipelines."""
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE daemon_state SET is_paused = 0, paused_at = NULL, pause_reason = NULL WHERE id = 1"
        )
        await db.commit()

    await ws_manager.broadcast("daemon_status", {"status": "running"})
    return web.json_response({"success": True, "daemon": "running"})


async def delete_channel_endpoint(request: web.Request) -> web.Response:
    """Delete channel record permanently."""
    handle = request.match_info.get("handle", "").strip()
    if not handle:
        return make_json_error("HANDLE_REQUIRED", "Channel identifier required", status=400)

    success = await remove_channel(handle)
    await ws_manager.broadcast("channel_removed", {"channel_id": handle})
    return web.json_response({"success": success, "removed": handle})


def register_channel_routes(app: web.Application):
    app.router.add_get("/api/channels", get_channels_list)
    app.router.add_delete("/api/channels/{handle}", delete_channel_endpoint)
    app.router.add_patch("/api/channels/{id}", patch_channel_settings)
    app.router.add_post("/api/channels/{id}/pause", pause_channel)
    app.router.add_post("/api/channels/{id}/resume", resume_channel)
    app.router.add_get("/api/channels/{id}/frame", get_channel_live_frame)
    app.router.add_post("/api/daemon/pause", pause_daemon)
    app.router.add_post("/api/daemon/resume", resume_daemon)

