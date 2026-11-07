"""Templates REST API Router.

Includes:
- GET /api/templates
- POST /api/templates (save template with normalized coordinates)
- POST /api/templates/test-sample (render 3-second real sample using FFmpeg and return URL)
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from config.settings import TEMPLATES_DIR, RENDER_DIR
from src.compositor.crop_calculator import build_crop_filter
from src.compositor.filter_graph_builder import build_filter_graph
from src.compositor.template_migration import migrate_layout_to_v2
from src.compositor.ffmpeg_renderer import FFmpegRenderer

logger = logging.getLogger(__name__)


def make_json_error(code: str, message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": {"code": code, "message": message}}, status=status)


async def get_templates(request: web.Request) -> web.Response:
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


async def save_template(request: web.Request) -> web.Response:
    """Save or update visual template JSON."""
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Request body must be JSON")

    t_name = data.get("name", "").strip()
    if not t_name:
        return make_json_error("VALIDATION_ERROR", "Template name required")

    clean_filename = f"{t_name}.json"
    t_path = Path(TEMPLATES_DIR) / clean_filename

    # Ensure normalized crop coordinates and exact mathematical bounds
    build_crop_filter(data, 1920, 1080)

    with open(t_path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    logger.info("Saved visual template '%s' to %s", t_name, t_path)
    return web.json_response({"success": True, "template": data})


async def delete_template(request: web.Request) -> web.Response:
    """Delete a layout template JSON file."""
    t_name = request.match_info.get("name", "").strip()
    if not t_name:
        return make_json_error("NAME_REQUIRED", "Template name required", status=400)

    # Sanitize name
    clean_name = Path(t_name).stem
    t_path = Path(TEMPLATES_DIR) / f"{clean_name}.json"

    if not t_path.exists():
        return make_json_error("NOT_FOUND", f"Template '{clean_name}' not found", status=404)

    try:
        t_path.unlink()
        logger.info("Deleted template '%s' (%s)", clean_name, t_path)
        return web.json_response({"success": True, "deleted": clean_name})
    except Exception as e:
        logger.error("Failed to delete template '%s': %s", clean_name, e)
        return make_json_error("DELETE_FAILED", str(e), status=500)


async def render_test_sample(request: web.Request) -> web.Response:
    """Render a 3-second real FFmpeg proof clip of the template layout."""
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Request body must be JSON")

    template = data.get("template", {})
    source_url = data.get("source_video")

    # Find sample video
    sample_mp4 = None
    if source_url and Path(source_url).exists():
        sample_mp4 = Path(source_url)
    else:
        # Pick any existing render or buffer chunk
        existing_mp4s = list(Path(RENDER_DIR).glob("*.mp4"))
        if existing_mp4s:
            sample_mp4 = existing_mp4s[0]

    if not sample_mp4 or not sample_mp4.exists():
        return make_json_error("NO_SOURCE", "No source video available to render sample", status=404)

    out_name = f"sample_{int(asyncio.get_event_loop().time())}.mp4"
    out_path = Path(RENDER_DIR) / out_name

    renderer = FFmpegRenderer()
    try:
        await renderer.render_clip(
            source_path=str(sample_mp4),
            start_time=0.0,
            end_time=3.0,
            output_path=str(out_path),
            template=template,
            ass_path=None,
            include_teaser=False
        )
        return web.json_response({
            "success": True,
            "sample_url": f"/renders/{out_name}",
            "filename": out_name
        })
    except Exception as e:
        logger.error("Failed sample render: %s", e)
        return make_json_error("RENDER_FAILED", str(e), status=500)


async def render_preview_frame(request: web.Request) -> web.Response:
    """
    POST /api/layout/preview-frame
    Renders a single frame through the REAL FFmpeg filter graph to verify
    live canvas preview against true FFmpeg output.
    Body:
      {
        "channel_id": "...",
        "clip_id": 123,
        "time": 2.5,
        "layout": { ... schema v2 ... }
      }
    """
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Request body must be JSON")

    channel_id = data.get("channel_id")
    clip_id = data.get("clip_id")
    seek_time = float(data.get("time", 0.5))
    layout_data = data.get("layout", {})

    # Locate source video file
    source_file = None
    if clip_id:
        from src.database import get_clip
        clip = await get_clip(int(clip_id))
        if clip:
            source_file = clip.get("source_video_path") or clip.get("rendered_video_path")

    if not source_file or not Path(source_file).exists():
        if channel_id:
            from config.settings import BUFFER_DIR
            import glob
            c_buf = Path(BUFFER_DIR) / channel_id
            chunks = sorted(glob.glob(str(c_buf / "chunk_*.ts")), key=os.path.getmtime)
            if chunks:
                source_file = chunks[-1]
            else:
                hl = sorted(glob.glob(str(c_buf / "highlight_*.mp4")), key=os.path.getmtime)
                if hl:
                    source_file = hl[-1]

    if not source_file or not Path(source_file).exists():
        # Fallback to any render mp4
        existing_mp4s = list(Path(RENDER_DIR).glob("*.mp4"))
        if existing_mp4s:
            source_file = str(existing_mp4s[0])

    if not source_file or not Path(source_file).exists():
        return make_json_error("NO_SOURCE", "No source media found to render preview frame", status=404)

    graph_res = build_filter_graph(
        layout_data=layout_data,
        src_w=1920,
        src_h=1080,
        input_tag="0:v",
        speed_multiplier=1.0,
        contrast=1.0,
        saturation=1.0,
    )
    filter_complex = graph_res["filter_complex"]

    out_jpg = Path(RENDER_DIR) / f"preview_frame_{int(asyncio.get_event_loop().time() * 1000)}.jpg"
    cmd = [
        "ffmpeg", "-y",
        "-ss", str(seek_time),
        "-i", str(source_file),
        "-filter_complex", filter_complex,
        "-map", "[vout]",
        "-vframes", "1",
        "-q:v", "3",
        str(out_jpg)
    ]

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        _, stderr = await asyncio.wait_for(proc.communicate(), timeout=10.0)
        if proc.returncode != 0:
            logger.error("FFmpeg frame render failed: %s", stderr.decode("utf-8", errors="ignore"))
            return make_json_error("RENDER_ERROR", "FFmpeg failed to render preview frame", status=500)

        if out_jpg.exists():
            return web.FileResponse(out_jpg)
        return make_json_error("FILE_MISSING", "Rendered frame not produced", status=500)
    except Exception as e:
        logger.error("Preview frame exception: %s", e)
        return make_json_error("ERROR", str(e), status=500)


def register_template_routes(app: web.Application):
    app.router.add_get("/api/templates", get_templates)
    app.router.add_post("/api/templates", save_template)
    app.router.add_delete("/api/templates/{name}", delete_template)
    app.router.add_post("/api/templates/test-sample", render_test_sample)
    app.router.add_post("/api/layout/preview-frame", render_preview_frame)

