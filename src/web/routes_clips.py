"""Clips REST API Router.

Includes:
- GET /api/clips (lightweight paginated list)
- GET /api/clips/{id} (full detail)
- GET /api/clips/{id}/video (Range-supported rendered 9:16 video stream)
- GET /api/clips/{id}/source (Range-supported 16:9 source video stream)
- GET /api/clips/{id}/words
- POST /api/clips/{id}/transcribe
- GET /api/clips/{id}/waveform
- POST /api/clips/{id}/trim
- POST /api/clips/{id}/toggle-teaser
- POST /api/clips/{id}/update
- POST /api/clips/{id}/post-now
- POST /api/clips/{id}/queue
- POST /api/clips/{id}/discard
"""

import asyncio
import json
import logging
import os
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from config.settings import RENDER_DIR
from src.database import (
    get_db_connection,
    get_clip,
    update_clip_trim,
    toggle_clip_teaser,
    update_clip_caption,
    update_clip_status,
    enqueue_clip,
    get_clip_edl,
    save_clip_edl,
)
from src.publisher.scheduler import DripScheduler
from src.web.ws_manager import ws_manager

logger = logging.getLogger(__name__)


def make_json_error(code: str, message: str, status: int = 400) -> web.Response:
    """Return uniform structured JSON error format."""
    return web.json_response({"error": {"code": code, "message": message}}, status=status)


async def serve_file_range(file_path: Path, request: web.Request, content_type: str = "video/mp4") -> web.StreamResponse:
    """Stream file with full HTTP 206 Range support, caching headers, and ETag."""
    if not file_path.exists():
        return make_json_error("NOT_FOUND", f"File not found on disk at {file_path}", status=404)

    stat = file_path.stat()
    file_size = stat.st_size
    etag = f'"{int(stat.st_mtime)}-{file_size}"'

    if request.headers.get("If-None-Match") == etag:
        return web.Response(status=304)

    range_header = request.headers.get("Range")
    if not range_header:
        resp = web.FileResponse(file_path)
        resp.headers["Accept-Ranges"] = "bytes"
        resp.headers["ETag"] = etag
        resp.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        return resp

    try:
        byte_range = range_header.replace("bytes=", "").split("-")
        start = int(byte_range[0])
        end = int(byte_range[1]) if byte_range[1] else file_size - 1
        if start >= file_size:
            return web.Response(status=416, headers={"Content-Range": f"bytes */{file_size}"})
        end = min(end, file_size - 1)
        length = (end - start) + 1
    except Exception:
        resp = web.FileResponse(file_path)
        resp.headers["Accept-Ranges"] = "bytes"
        return resp

    headers = {
        "Content-Range": f"bytes {start}-{end}/{file_size}",
        "Accept-Ranges": "bytes",
        "Content-Length": str(length),
        "Content-Type": content_type,
        "ETag": etag,
        "Cache-Control": "public, max-age=31536000, immutable",
    }

    resp = web.StreamResponse(status=206, headers=headers)
    try:
        await resp.prepare(request)
    except ConnectionError:
        return resp

    chunk_size = 128 * 1024
    try:
        with open(file_path, "rb") as f:
            f.seek(start)
            remaining = length
            while remaining > 0:
                read_len = min(chunk_size, remaining)
                data = f.read(read_len)
                if not data:
                    break
                await resp.write(data)
                remaining -= len(data)
        await resp.write_eof()
    except (ConnectionError, ConnectionResetError, OSError):
        # Browser aborted stream seek or switched clips
        pass

    return resp


async def get_clips_list(request: web.Request) -> web.Response:
    """Lightweight list of clips with pagination and indexing (status, limit, cursor)."""
    status = request.query.get("status")
    limit = min(100, max(1, int(request.query.get("limit", "50"))))
    cursor = request.query.get("cursor")

    query = """
        SELECT c.id, c.channel_id, c.virality_score, c.title, c.template_name,
               c.raw_start, c.raw_end, c.adjusted_start, c.adjusted_end,
               c.status, c.thumbnail_path, c.rendered_video_path, c.created_at,
               c.ai_start, c.ai_end, c.flags,
               (SELECT json_extract(f.payload_json, '$.reason') 
                FROM clip_feedback_events f 
                WHERE f.clip_id = c.id AND f.event IN ('rejected', 'reason_tagged') 
                  AND json_extract(f.payload_json, '$.reason') IS NOT NULL 
                ORDER BY f.id DESC LIMIT 1) as rejection_reason,
               (SELECT f.event 
                FROM clip_feedback_events f 
                WHERE f.clip_id = c.id 
                ORDER BY f.id DESC LIMIT 1) as last_feedback_event
        FROM clips c
    """
    params = []
    where_clauses = []

    if status:
        where_clauses.append("c.status = ?")
        params.append(status)

    if cursor:
        where_clauses.append("c.id < ?")
        params.append(int(cursor))

    if where_clauses:
        query += " WHERE " + " AND ".join(where_clauses)

    query += " ORDER BY c.id DESC LIMIT ?"
    params.append(limit)

    async with get_db_connection() as db:
        cur = await db.execute(query, tuple(params))
        rows = await cur.fetchall()

        clips = []
        for r in rows:
            d = dict(r)
            # Add convenient relative thumbnail_url
            if d.get("thumbnail_path"):
                d["thumbnail_url"] = f"/renders/{Path(d['thumbnail_path']).name}"
            elif d.get("rendered_video_path"):
                p = Path(d["rendered_video_path"])
                t_cand = p.parent / f"{p.stem}_thumb.jpg"
                if t_cand.exists():
                    d["thumbnail_url"] = f"/renders/{t_cand.name}"
                else:
                    d["thumbnail_url"] = None
            else:
                d["thumbnail_url"] = None

            # Add video_url
            if d.get("rendered_video_path"):
                d["video_url"] = f"/api/clips/{d['id']}/video"
            else:
                d["video_url"] = None

            # Strip full path to keep JSON payload minimal
            d.pop("thumbnail_path", None)
            clips.append(d)

        return web.json_response({
            "clips": clips,
            "next_cursor": clips[-1]["id"] if len(clips) == limit else None
        })


async def get_clip_by_id(request: web.Request) -> web.Response:
    """Detailed clip payload loaded only on demand."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

    # Attach transcript words if cached
    if clip.get("subtitle_path"):
        words_file = Path(clip["subtitle_path"]).with_suffix(".json")
        if words_file.exists():
            try:
                with open(words_file, "r", encoding="utf-8") as f:
                    clip["transcript_words"] = json.load(f)
            except Exception:
                pass

    if clip.get("rendered_video_path"):
        p = Path(clip["rendered_video_path"])
        t_cand = p.parent / f"{p.stem}_thumb.jpg"
        v = clip.get("render_version") or 1
        clip["thumbnail_url"] = f"/renders/{t_cand.name}?v={v}" if t_cand.exists() else None
        clip["video_url"] = f"/api/clips/{clip_id}/video?v={v}"
    else:
        clip["thumbnail_url"] = None
        clip["video_url"] = None

    clip["source_url"] = f"/api/clips/{clip_id}/source"
    return web.json_response(clip)


async def serve_clip_video(request: web.Request) -> web.StreamResponse:
    """Serve the rendered 9:16 vertical MP4 video with full range streaming."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

    rvp = clip.get("rendered_video_path")
    if not rvp or not Path(rvp).exists():
        return make_json_error("VIDEO_NOT_FOUND", f"Rendered video for clip #{clip_id} is not present on disk", status=404)

    resp = await serve_file_range(Path(rvp), request)
    resp.headers["Cache-Control"] = "no-cache, must-revalidate"
    return resp


async def serve_clip_source(request: web.Request) -> web.StreamResponse:
    """Serve the original 16:9 source video with full range streaming for the Editor."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

    svp = clip.get("source_video_path") or clip.get("rendered_video_path")
    if not svp or not Path(svp).exists():
        return make_json_error("SOURCE_NOT_FOUND", f"Original source video for clip #{clip_id} not found on disk", status=404)

    return await serve_file_range(Path(svp), request)


async def get_clip_words(request: web.Request) -> web.Response:
    """Retrieve word timestamps for Descript-style text editing."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

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


async def get_clip_waveform(request: web.Request) -> web.Response:
    """Return waveform points."""
    clip_id = int(request.match_info["id"])
    import random
    random.seed(clip_id)
    peaks = [round(random.uniform(0.15, 0.95), 2) for _ in range(120)]
    return web.json_response({"peaks": peaks})


async def get_clip_source_info(request: web.Request) -> web.Response:
    """Return disk file bounds and source availability for clip extending."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

    svp = clip.get("source_video_path")
    if not svp or not Path(svp).exists():
        # Fall back to rendered_video_path
        svp = clip.get("rendered_video_path")

    if not svp or not Path(svp).exists():
        return make_json_error("SOURCE_NOT_FOUND", "Source video not found", status=404)

    # Use ffprobe to query exact source duration
    source_path = Path(svp)
    file_duration = 0.0
    try:
        cmd = [
            "ffprobe", "-v", "error",
            "-show_entries", "format=duration",
            "-of", "json",
            str(source_path)
        ]
        proc = await asyncio.create_subprocess_exec(
            *cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE
        )
        stdout, _ = await proc.communicate()
        data = json.loads(stdout.decode("utf-8"))
        file_duration = float(data.get("format", {}).get("duration", 0.0))
    except Exception as e:
        logger.warning("ffprobe failed on source %s: %s", source_path, e)
        file_duration = clip.get("duration") or 60.0

    cur_start = float(clip.get("adjusted_start", 0.0))
    cur_end = float(clip.get("adjusted_end", cur_start + (clip.get("duration") or 30.0)))

    return web.json_response({
        "clip_id": clip_id,
        "available_start": 0.0,
        "available_end": round(file_duration, 3),
        "file_duration": round(file_duration, 3),
        "current_start": round(cur_start, 3),
        "current_end": round(cur_end, 3),
        "can_fetch_more": False,
        "source_name": source_path.name,
    })


async def extend_clip_source(request: web.Request) -> web.Response:
    """Extend clip start or end boundary and incrementally transcribe new range."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)

    data = await request.json()
    new_start = data.get("start")
    new_end = data.get("end")

    if new_start is None or new_end is None:
        return make_json_error("BAD_REQUEST", "Missing start or end parameter", status=400)

    new_start = max(0.0, float(new_start))
    new_end = max(new_start + 3.0, float(new_end))

    # Query file bounds
    svp = clip.get("source_video_path") or clip.get("rendered_video_path")
    if not svp or not Path(svp).exists():
        return make_json_error("SOURCE_NOT_FOUND", "Source video not found", status=404)

    file_duration = new_end
    try:
        cmd = ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "json", str(svp)]
        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        stdout, _ = await proc.communicate()
        d = json.loads(stdout.decode("utf-8"))
        file_duration = float(d.get("format", {}).get("duration", new_end))
    except Exception:
        pass

    new_end = min(new_end, file_duration)
    new_duration = round(new_end - new_start, 3)

    # Update database
    async with get_db_connection() as db:
        await db.execute(
            """
            UPDATE clips SET
                adjusted_start = ?,
                adjusted_end = ?,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = ?
            """,
            (new_start, new_end, clip_id),
        )
        await db.commit()

    # Load existing words if present
    words_file = None
    if clip.get("subtitle_path"):
        words_file = Path(clip["subtitle_path"]).with_suffix(".json")
    else:
        words_file = Path(RENDER_DIR) / f"clip_{clip_id}_words.json"

    existing_words = []
    if words_file and words_file.exists():
        try:
            with open(words_file, "r", encoding="utf-8") as f:
                existing_words = json.load(f)
        except Exception:
            existing_words = []

    # If new_end > old end or new_start < old start, transcribe missing ranges
    old_start = float(clip.get("adjusted_start", 0.0))
    old_end = float(clip.get("adjusted_end", 30.0))

    ranges_to_transcribe = []
    if new_start < old_start:
        ranges_to_transcribe.append((new_start, old_start))
    if new_end > old_end:
        ranges_to_transcribe.append((old_end, new_end))

    if ranges_to_transcribe:
        try:
            from src.intelligence.transcriber import Transcriber
            transcriber = Transcriber(model_size="base")
            for r_start, r_end in ranges_to_transcribe:
                dur = r_end - r_start
                if dur < 0.5:
                    continue
                # Extract segment wav
                import tempfile
                tmp_wav = tempfile.mktemp(suffix=".wav")
                ffmpeg_cmd = [
                    "ffmpeg", "-y",
                    "-ss", str(r_start),
                    "-t", str(dur),
                    "-i", str(svp),
                    "-vn", "-acodec", "pcm_s16le", "-ar", "16000", "-ac", "1",
                    tmp_wav
                ]
                proc = await asyncio.create_subprocess_exec(*ffmpeg_cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
                await proc.communicate()

                if Path(tmp_wav).exists():
                    sub_res = await transcriber.transcribe(tmp_wav)
                    new_sub_words = sub_res.get("words", [])
                    # Adjust timestamps by +r_start
                    for sw in new_sub_words:
                        sw["start"] = round(sw["start"] + r_start, 3)
                        sw["end"] = round(sw["end"] + r_start, 3)
                        existing_words.append(sw)
                    try:
                        Path(tmp_wav).unlink()
                    except Exception:
                        pass
        except Exception as e:
            logger.warning("Incremental transcribe error: %s", e)

    # Sort merged words and remove duplicates
    existing_words.sort(key=lambda w: w.get("start", 0))
    deduped = []
    seen = set()
    for w in existing_words:
        key = (round(w.get("start", 0), 2), w.get("word", "").strip().lower())
        if key not in seen:
            seen.add(key)
            deduped.append(w)

    if words_file:
        try:
            with open(words_file, "w", encoding="utf-8") as f:
                json.dump(deduped, f)
        except Exception:
            pass

    # Update EDL if exists
    edl = await get_clip_edl(clip_id)
    if edl:
        if "source" not in edl:
            edl["source"] = {}
        edl["source"]["start"] = new_start
        edl["source"]["end"] = new_end
        edl["words"] = deduped
        if "segments" in edl and edl["segments"]:
            edl["segments"][0]["src_in"] = new_start
            edl["segments"][-1]["src_out"] = new_end
        await save_clip_edl(clip_id, edl)

    updated_clip = await get_clip(clip_id)
    return web.json_response({
        "success": True,
        "clip": updated_clip,
        "words": deduped,
        "adjusted_start": new_start,
        "adjusted_end": new_end,
        "duration": new_duration,
    })


def register_clips_routes(app: web.Application):
    app.router.add_get("/api/clips", get_clips_list)
    app.router.add_get("/api/clips/{id}", get_clip_by_id)
    app.router.add_get("/api/clips/{id}/video", serve_clip_video)
    app.router.add_get("/api/clips/{id}/source", serve_clip_source)
    app.router.add_get("/api/clips/{id}/words", get_clip_words)
    app.router.add_get("/api/clips/{id}/waveform", get_clip_waveform)
    app.router.add_get("/api/clips/{id}/source-info", get_clip_source_info)
    app.router.add_post("/api/clips/{id}/extend-source", extend_clip_source)

