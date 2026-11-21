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
import time
import uuid
from pathlib import Path
from typing import Any, Dict

from aiohttp import web

from config.settings import RENDER_DIR, OUTPUT_DIR


def media_url(file_path) -> "str | None":
    """Map a file on disk to the static route that serves it (/output or /renders)."""
    if not file_path:
        return None
    fp = Path(file_path).resolve()
    if not fp.exists():
        return None
    for base, prefix in ((Path(OUTPUT_DIR).resolve(), "/output"), (Path(RENDER_DIR).resolve(), "/renders")):
        try:
            return f"{prefix}/{fp.relative_to(base).as_posix()}"
        except ValueError:
            continue
    return None


def thumbnail_for(clip: dict) -> "str | None":
    if clip.get("thumbnail_path"):
        url = media_url(clip["thumbnail_path"])
        if url:
            return url
    if clip.get("rendered_video_path"):
        p = Path(clip["rendered_video_path"])
        url = media_url(p.parent / f"{p.stem}_thumb.jpg")
        if url:
            return url
        if p.exists() and clip.get("id") is not None:
            # No thumbnail on disk yet (live renders don't write one): generated on first request
            return f"/api/clips/{clip['id']}/thumbnail?v={clip.get('render_version') or 1}"
    return None


_THUMB_SEM = asyncio.Semaphore(2)


async def serve_clip_thumbnail(request: web.Request) -> web.Response:
    """Serve (and lazily create, next to the video) a small JPEG poster frame for a rendered clip."""
    try:
        clip_id = int(request.match_info["id"])
    except ValueError:
        return make_json_error("INVALID_ID", "Clip id must be an integer")
    clip = await get_clip(clip_id)
    video = Path(clip["rendered_video_path"]) if clip and clip.get("rendered_video_path") else None
    if not video or not video.exists():
        return make_json_error("NOT_FOUND", "No rendered video for this clip", status=404)
    thumb = video.parent / f"{video.stem}_thumb.jpg"
    if not thumb.exists():
        async with _THUMB_SEM:
            if not thumb.exists():
                tmp = thumb.with_suffix(".tmp.jpg")
                proc = await asyncio.create_subprocess_exec(
                    "ffmpeg", "-y", "-v", "error", "-ss", "1", "-i", str(video), "-frames:v", "1",
                    "-vf", "scale=360:-2", "-q:v", "4", str(tmp),
                    stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                )
                await proc.communicate()
                if proc.returncode == 0 and tmp.exists():
                    os.replace(tmp, thumb)
                else:                                    # clip shorter than 1 s: take the first frame
                    proc = await asyncio.create_subprocess_exec(
                        "ffmpeg", "-y", "-v", "error", "-i", str(video), "-frames:v", "1", "-vf", "scale=360:-2", "-q:v", "4", str(tmp),
                        stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL,
                    )
                    await proc.communicate()
                    if proc.returncode == 0 and tmp.exists():
                        os.replace(tmp, thumb)
    if not thumb.exists():
        return make_json_error("THUMB_FAILED", "Could not extract a thumbnail", status=500)
    return web.FileResponse(thumb, headers={"Cache-Control": "public, max-age=86400"})
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
        SELECT c.id, c.channel_id, c.virality_score, c.title, c.template_name, c.caption_style, c.hook_style,
               c.raw_start, c.raw_end, c.adjusted_start, c.adjusted_end, c.score_breakdown, c.render_version,
               c.status, c.thumbnail_path, c.source_video_path, c.rendered_video_path, c.created_at,
               c.ai_start, c.ai_end, c.flags, c.stitched,
               (SELECT json_object('relation', l.relation, 'confidence', l.confidence, 'setup_quote', json_extract(l.quotes_json, '$.setup_quote'), 'payoff_quote', json_extract(l.quotes_json, '$.payoff_quote'), 'seed_id', l.seed_id)
                FROM clip_story_links l WHERE l.clip_id = c.id LIMIT 1) as story_link,
               (SELECT json_extract(f.payload_json, '$.reason') 
                FROM clip_feedback_events f 
                WHERE f.clip_id = c.id AND f.event IN ('rejected', 'reason_tagged') 
                  AND json_extract(f.payload_json, '$.reason') IS NOT NULL 
                ORDER BY f.id DESC LIMIT 1) as rejection_reason,
               (SELECT f.event 
                FROM clip_feedback_events f 
                WHERE f.clip_id = c.id 
                ORDER BY f.id DESC LIMIT 1) as last_feedback_event,
               (SELECT SUM(m.views) FROM clip_metrics m WHERE m.clip_id = c.id AND m.id IN (
                    SELECT m2.id FROM clip_metrics m2 WHERE m2.video_id = m.video_id
                    ORDER BY CASE m2.window WHEN '7d' THEN 0 WHEN '72h' THEN 1 ELSE 2 END LIMIT 1)) as latest_views,
               (SELECT MAX(m.retention_pct) FROM clip_metrics m WHERE m.clip_id = c.id) as retention_pct
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
            # Thumbnails live in OUTPUT_DIR (pipeline renders) or RENDER_DIR (re-renders)
            d["thumbnail_url"] = thumbnail_for(d)

            # Add video_url
            if d.get("rendered_video_path"):
                # versioned so phones reload after a re-render instead of showing a cached copy
                d["video_url"] = f"/api/clips/{d['id']}/video?v={d.get('render_version') or 1}"
            else:
                d["video_url"] = None

            # Strip full path to keep JSON payload minimal, but expose boolean flag whether raw source video exists
            svp = d.get("source_video_path")
            d["has_raw_video"] = bool(svp and Path(svp).exists())
            d.pop("source_video_path", None)
            d.pop("thumbnail_path", None)
            clips.append(d)

        return web.json_response({
            "clips": clips,
            "next_cursor": clips[-1]["id"] if len(clips) == limit else None
        })


# ---------------------------------------------------------------------------- Clips page feed
FEED_STATUSES = ("pending_approval", "approved", "queued", "published", "rejected")
FEED_SORTS = {
    "new": "c.id DESC",
    "old": "c.id ASC",
    "score": "COALESCE(c.final_score, c.virality_score) DESC, c.id DESC",
}


def _feed_filters(q: Dict[str, str], with_status: bool):
    where, params = [], []
    status = (q.get("status") or "pending_approval").strip()
    if with_status and status != "all":
        where.append("c.status = ?")
        params.append(status)
    channel = (q.get("channel") or "").strip()
    if channel and channel != "all":
        where.append("c.channel_id = ?")
        params.append(channel)
    try:
        min_score = float(q.get("min_score") or 0)
    except ValueError:
        min_score = 0
    if min_score > 0:
        where.append("COALESCE(c.final_score, c.virality_score, 0) >= ?")
        params.append(min_score)
    text = (q.get("q") or "").strip()
    if text:
        like = f"%{text.lower()}%"
        where.append("(LOWER(c.title) LIKE ? OR LOWER(COALESCE(c.description,'')) LIKE ? OR LOWER(COALESCE(c.hashtags,'')) LIKE ?"
                     " OR LOWER(COALESCE(c.channel_id,'')) LIKE ? OR CAST(c.id AS TEXT) = ?)")
        params += [like, like, like, like, text.lstrip("#")]
    return where, params


async def get_clips_feed(request: web.Request) -> web.Response:
    """Everything the Clips page (grid + reels) shows, with filters, sort, paging and per-status counts.

    Query: status (pending_approval|approved|queued|published|rejected|all), channel, min_score,
    q (search title/description/hashtags/streamer/#id), sort (new|old|score), limit, cursor (offset).
    """
    q = request.query
    try:
        limit = min(100, max(1, int(q.get("limit", "30"))))
        offset = max(0, int(q.get("cursor") or 0))
    except ValueError:
        return make_json_error("BAD_REQUEST", "limit and cursor must be numbers", status=400)
    order = FEED_SORTS.get(q.get("sort", "new"), FEED_SORTS["new"])
    where, params = _feed_filters(q, with_status=True)
    sql = """
        SELECT c.id, c.channel_id, c.source_type, c.source_id, c.virality_score, c.final_score, c.title, c.description,
               c.hashtags, c.template_name, c.caption_style, c.hook_style, c.raw_start, c.raw_end, c.ai_start, c.ai_end,
               c.score_breakdown, c.flags, c.render_version, c.status, c.thumbnail_path, c.rendered_video_path,
               c.source_video_path, c.created_at, c.updated_at, c.published_at, c.stitched, c.last_render_error,
               (SELECT json_extract(f.payload_json, '$.reason') FROM clip_feedback_events f
                 WHERE f.clip_id = c.id AND f.event IN ('rejected', 'reason_tagged')
                   AND json_extract(f.payload_json, '$.reason') IS NOT NULL ORDER BY f.id DESC LIMIT 1) AS rejection_reason,
               (SELECT MIN(s.scheduled_for) FROM scheduled_queue s WHERE s.clip_id = c.id AND s.yt_status = 'pending') AS scheduled_for
        FROM clips c
    """ + (" WHERE " + " AND ".join(where) if where else "") + f" ORDER BY {order} LIMIT ? OFFSET ?"
    cwhere, cparams = _feed_filters(q, with_status=False)
    async with get_db_connection() as db:
        rows = await (await db.execute(sql, (*params, limit + 1, offset))).fetchall()
        counts_rows = await (await db.execute(
            "SELECT c.status, COUNT(*) FROM clips c" + (" WHERE " + " AND ".join(cwhere) if cwhere else "") + " GROUP BY c.status",
            tuple(cparams))).fetchall()
        channel_rows = await (await db.execute(
            "SELECT channel_id, COUNT(*) FROM clips WHERE channel_id IS NOT NULL AND channel_id != '' GROUP BY channel_id ORDER BY COUNT(*) DESC"
        )).fetchall()
    clips = []
    for r in rows[:limit]:
        d = dict(r)
        d["thumbnail_url"] = thumbnail_for(d)
        rvp = d.get("rendered_video_path")
        has_video = bool(rvp and Path(rvp).exists())
        d["video_url"] = f"/api/clips/{d['id']}/video?v={d.get('render_version') or 1}" if has_video else None
        d["download_url"] = f"/api/clips/{d['id']}/download" if has_video else None
        svp = d.get("source_video_path")
        d["has_raw_video"] = bool(svp and Path(svp).exists())
        for k in ("source_video_path", "thumbnail_path", "rendered_video_path"):
            d.pop(k, None)
        clips.append(d)
    counts = {s: 0 for s in FEED_STATUSES}
    for st, n in counts_rows:
        counts[st] = n
    counts["all"] = sum(n for _, n in counts_rows)
    return web.json_response({
        "clips": clips,
        "next_cursor": offset + limit if len(rows) > limit else None,
        "counts": counts,
        "channels": [{"id": c, "count": n} for c, n in channel_rows],
    })


def _download_name(clip: dict, ext: str) -> str:
    import re as _re
    base = _re.sub(r"[^A-Za-z0-9 _-]+", "", clip.get("title") or "").strip()
    base = _re.sub(r"\s+", "_", base)[:60] or "clip"
    return f"{base}_{clip['id']}{ext}"


async def download_clip(request: web.Request) -> web.StreamResponse:
    """The rendered clip as a file download (named after its title)."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)
    rvp = clip.get("rendered_video_path")
    if not rvp or not Path(rvp).exists():
        return make_json_error("VIDEO_NOT_FOUND", f"Rendered video for clip #{clip_id} is not present on disk", status=404)
    name = _download_name(clip, Path(rvp).suffix or ".mp4")
    return web.FileResponse(Path(rvp), headers={"Content-Disposition": f'attachment; filename="{name}"',
                                                 "Cache-Control": "no-cache"})


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
        v = clip.get("render_version") or 1
        thumb = thumbnail_for(clip)
        clip["thumbnail_url"] = (thumb if "?" in thumb else f"{thumb}?v={v}") if thumb else None
        clip["video_url"] = f"/api/clips/{clip_id}/video?v={v}"
    else:
        clip["thumbnail_url"] = None
        clip["video_url"] = None

    clip["source_url"] = f"/api/clips/{clip_id}/source"
    svp = clip.get("source_video_path")
    clip["has_raw_video"] = bool(svp and Path(svp).exists())

    # Attach narrative storyline link details if stitched
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT l.id, l.seed_id, l.relation, l.confidence, l.quotes_json,
                      l.standalone_score, l.stitched_score, s.quote as seed_quote,
                      s.summary as seed_summary, s.duration as seed_duration
               FROM clip_story_links l
               LEFT JOIN story_seeds s ON s.id = l.seed_id
               WHERE l.clip_id = ?
               LIMIT 1""",
            (clip_id,)
        )
        srow = await cur.fetchone()
        if srow:
            sdict = dict(srow)
            try:
                sdict["quotes"] = json.loads(sdict.get("quotes_json", "{}"))
            except Exception:
                sdict["quotes"] = {}
            clip["story_link"] = sdict
        else:
            clip["story_link"] = None

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

    svp = clip.get("source_video_path")
    # If original 16:9 source does not exist on disk, fall back to rendered_video_path so editor still loads video!
    if not svp or not Path(svp).exists():
        svp = clip.get("rendered_video_path")

    if not svp or not Path(svp).exists():
        return make_json_error("SOURCE_NOT_FOUND", f"Video for clip #{clip_id} not found on disk", status=404)

    from src.web.media_preview import browser_playable
    return await serve_file_range(await browser_playable(Path(svp)), request)


def resolve_template_file(name: str) -> "Path | None":
    """Template by file stem or by the "name" inside the JSON."""
    from config.settings import TEMPLATES_DIR
    name = (name or "").strip()
    if not name or "/" in name or "\\" in name or name.startswith("."):
        return None
    direct = Path(TEMPLATES_DIR) / f"{name}.json"
    if direct.is_file():
        return direct
    for f in Path(TEMPLATES_DIR).glob("*.json"):
        try:
            if json.loads(f.read_text(encoding="utf-8")).get("name") == name:
                return f
        except Exception:
            continue
    return None


class RetemplateError(Exception):
    def __init__(self, code: str, message: str, status: int = 400):
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


async def _retemplate_one(clip_id: int, t_file: "Path") -> Dict[str, Any]:
    """Re-render one clip with a template file (keeps words, bleeps and trims). Raises RetemplateError."""
    clip = await get_clip(clip_id)
    if not clip:
        raise RetemplateError("NOT_FOUND", f"Clip #{clip_id} not found", 404)

    template_name = t_file.stem
    template = json.loads(t_file.read_text(encoding="utf-8"))

    # Keep the editor in step: new layout + caption style, same words/bleeps/segments
    edl = await get_clip_edl(clip_id)
    old_edl = json.loads(json.dumps(edl)) if edl else None
    old_template_name = clip.get("template_name")
    words_override = None
    if edl:
        if template.get("layout"):
            edl["layout"] = template["layout"]
        subs = template.get("subtitles") or {}
        caps = dict(edl.get("captions") or {})
        for src_key, dst_key in (("font_name", "font"), ("font_size", "size"), ("primary_color", "color"),
                                 ("highlight_color", "highlight"), ("position", "position"), ("animation", "animation")):
            if subs.get(src_key) is not None:
                caps[dst_key] = subs[src_key]
        edl["captions"] = caps
        await save_clip_edl(clip_id, edl)
        words_override = edl.get("words") or None

    async with get_db_connection() as db:
        await db.execute("UPDATE clips SET template_name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
                         (template_name, clip_id))
        await db.commit()

    async def _rollback() -> None:
        """A failed render must not leave the clip labelled/edited with a template its video doesn't use."""
        try:
            if old_edl is not None:
                await save_clip_edl(clip_id, old_edl)
            async with get_db_connection() as db:
                await db.execute("UPDATE clips SET template_name = ? WHERE id = ?", (old_template_name, clip_id))
                await db.commit()
        except Exception as rb_err:
            logger.warning("Rollback after failed re-template of clip %d failed: %s", clip_id, rb_err)

    from src.bot.trimmer import ClipTrimmer
    try:
        updated = await ClipTrimmer().trim_and_rerender(
            clip_id=clip_id, delta_start=0.0, delta_end=0.0,
            custom_template=template, words_override=words_override,
        )
    except Exception as e:
        logger.error("Re-template of clip %d failed: %s", clip_id, e, exc_info=True)
        await _rollback()
        raise RetemplateError("RENDER_FAILED", f"Render failed: {str(e)[:200]}", 500)
    if not updated:
        await _rollback()
        raise RetemplateError("RENDER_FAILED", "Source video for this clip is missing", 409)
    v = updated.get("render_version") or 1
    return {"success": True, "clip_id": clip_id, "template_name": template_name,
            "video_url": f"/api/clips/{clip_id}/video?v={v}"}


async def retemplate_clip(request: web.Request) -> web.Response:
    """Re-render a clip with a different layout template (keeps words, bleeps and trims)."""
    clip_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Body must be JSON")
    t_file = resolve_template_file(str(data.get("template", "")))
    if not t_file:
        return make_json_error("TEMPLATE_NOT_FOUND", "Template not found", status=404)
    try:
        return web.json_response(await _retemplate_one(clip_id, t_file))
    except RetemplateError as e:
        return make_json_error(e.code, e.message, status=e.status)


# ---------------------------------------------------------------------------
# Bulk re-template: background batch with per-clip status (one failure never stops the rest)
# ---------------------------------------------------------------------------

BULK_MAX_CLIPS = 100
_BATCHES: Dict[str, Dict[str, Any]] = {}
_BATCH_TASKS: Dict[str, "asyncio.Task"] = {}


def _bulk_concurrency() -> int:
    try:
        return max(1, min(4, int(os.getenv("BULK_RETEMPLATE_CONCURRENCY", "1"))))
    except ValueError:
        return 1


def _prune_batches(keep: int = 20) -> None:
    done = [k for k, b in _BATCHES.items() if b["finished_at"]]
    for k in sorted(done, key=lambda k: _BATCHES[k]["finished_at"])[:-keep] if len(done) > keep else []:
        _BATCHES.pop(k, None)
        _BATCH_TASKS.pop(k, None)


def _batch_view(b: Dict[str, Any]) -> Dict[str, Any]:
    items = b["items"]
    counts = {s: sum(1 for i in items if i["status"] == s) for s in ("queued", "rendering", "done", "failed", "cancelled")}
    return {
        "batch_id": b["id"], "template": b["template"], "total": len(items), "counts": counts,
        "finished": b["finished_at"] is not None, "cancelled": b["cancelled"], "items": items,
    }


async def _run_batch(batch: Dict[str, Any], t_file: "Path") -> None:
    sem = asyncio.Semaphore(_bulk_concurrency())

    async def work(item: Dict[str, Any]) -> None:
        async with sem:
            if batch["cancelled"]:
                item["status"] = "cancelled"
                return
            item["status"] = "rendering"
            try:
                res = await _retemplate_one(item["clip_id"], t_file)
                item.update(status="done", video_url=res["video_url"], error=None)
            except RetemplateError as e:
                item.update(status="failed", error=e.message)
            except Exception as e:  # never let one clip kill the batch
                logger.error("Bulk re-template clip %s crashed: %s", item["clip_id"], e, exc_info=True)
                item.update(status="failed", error=str(e)[:200])

    try:
        await asyncio.gather(*(work(i) for i in batch["items"]))
    finally:
        batch["finished_at"] = time.time()


async def bulk_retemplate(request: web.Request) -> web.Response:
    """Start a background batch: {"clip_ids": [..], "template": "name"} -> {"batch_id": ...}."""
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Body must be JSON")
    raw_ids = data.get("clip_ids")
    if not isinstance(raw_ids, list) or not raw_ids:
        return make_json_error("INVALID_IDS", "clip_ids must be a non-empty list")
    try:
        ids = list(dict.fromkeys(int(i) for i in raw_ids))
    except (TypeError, ValueError):
        return make_json_error("INVALID_IDS", "clip_ids must be integers")
    if len(ids) > BULK_MAX_CLIPS:
        return make_json_error("TOO_MANY", f"At most {BULK_MAX_CLIPS} clips per batch")
    t_file = resolve_template_file(str(data.get("template", "")))
    if not t_file:
        return make_json_error("TEMPLATE_NOT_FOUND", "Template not found", status=404)
    if any(not b["finished_at"] for b in _BATCHES.values()):
        return make_json_error("BATCH_RUNNING", "Another bulk render is still running", status=409)

    batch = {
        "id": uuid.uuid4().hex[:10], "template": t_file.stem, "cancelled": False, "finished_at": None,
        "items": [{"clip_id": i, "status": "queued", "error": None, "video_url": None} for i in ids],
    }
    _prune_batches()
    _BATCHES[batch["id"]] = batch
    _BATCH_TASKS[batch["id"]] = asyncio.create_task(_run_batch(batch, t_file))
    return web.json_response({"success": True, **_batch_view(batch)})


async def get_bulk_retemplate(request: web.Request) -> web.Response:
    b = _BATCHES.get(request.match_info["batch_id"])
    if not b:
        return make_json_error("NOT_FOUND", "Batch not found", status=404)
    return web.json_response(_batch_view(b))


async def cancel_bulk_retemplate(request: web.Request) -> web.Response:
    """Stop starting new renders; clips already rendering finish, queued ones become cancelled."""
    b = _BATCHES.get(request.match_info["batch_id"])
    if not b:
        return make_json_error("NOT_FOUND", "Batch not found", status=404)
    b["cancelled"] = True
    return web.json_response(_batch_view(b))


async def list_caption_styles(request: web.Request) -> web.Response:
    from src.compositor.caption_styles import list_styles
    return web.json_response({"styles": list_styles()})


async def list_hook_styles(request: web.Request) -> web.Response:
    """Full specs, so the dashboard preview draws exactly what the renderer will."""
    from src.compositor.hook_styles import HOOK_STYLES
    return web.json_response({"styles": [{"id": k, **v} for k, v in HOOK_STYLES.items()]})


def _is_auto_edited(clip: Dict[str, Any]) -> bool:
    try:
        flags = json.loads(clip.get("flags") or "[]")
    except (TypeError, ValueError):
        return False
    return any(isinstance(f, dict) and f.get("type") == "auto_edited" for f in (flags if isinstance(flags, list) else []))


async def _restyle(request: web.Request, kind: str) -> web.Response:
    """Re-render a clip with another caption or hook style (same layout, words, bleeps and trims)."""
    from src.compositor import caption_styles, hook_styles
    clip_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Body must be JSON")
    style = str(data.get("style") or "")
    ok = caption_styles.valid(style) if kind == "caption" else (hook_styles.valid(style) or style == "template")
    if not ok:
        return make_json_error("BAD_STYLE", f"Unknown {kind} style '{style}'")
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)
    if kind == "hook" and not _is_auto_edited(clip):
        return make_json_error("NO_HOOK_CARD", "This clip has no hook card - hook cards are added by Quick Clip's auto edit.",
                               status=409)
    svp = clip.get("source_video_path")
    if not svp or not Path(svp).exists():
        return make_json_error("SOURCE_MISSING", "The source footage of this clip was deleted, so it can't be re-rendered.",
                               status=409)

    column = "caption_style" if kind == "caption" else "hook_style"
    previous = clip.get(column)
    value = None if style in ("template", caption_styles.DEFAULT_STYLE) else style

    async def store(v):
        async with get_db_connection() as db:
            await db.execute(f"UPDATE clips SET {column} = ? WHERE id = ?", (v, clip_id))
            await db.commit()

    await store(value)
    edl = await get_clip_edl(clip_id)
    from src.bot.trimmer import ClipTrimmer
    try:
        updated = await ClipTrimmer().trim_and_rerender(
            clip_id=clip_id, delta_start=0.0, delta_end=0.0,
            words_override=(edl or {}).get("words") or None,
        )
    except Exception as e:
        await store(previous)
        logger.error("%s restyle of clip %d failed: %s", kind, clip_id, e, exc_info=True)
        return make_json_error("RENDER_FAILED", f"Render failed: {str(e)[:200]}", status=500)
    if not updated:
        await store(previous)
        return make_json_error("RENDER_FAILED", "Source video for this clip is missing", status=409)
    v = updated.get("render_version") or 1
    return web.json_response({"success": True, "clip_id": clip_id, f"{kind}_style": style,
                              "video_url": f"/api/clips/{clip_id}/video?v={v}"})


# ---------------------------------------------------------------------------- auto-edit plan
def _plan_of(clip: Dict[str, Any]):
    try:
        p = json.loads(clip.get("edit_plan") or "null")
        return p if isinstance(p, dict) else None
    except (TypeError, ValueError):
        return None


def _sfx_library() -> Dict[str, list]:
    from src.compositor.auto_edit import SFX_DIR, SFX_FALLBACK
    from src.compositor.edit_plan import SFX_CATEGORIES
    lib = {}
    for cat in SFX_CATEGORIES:
        folder = SFX_DIR / cat
        files = sorted(f"{cat}/{f.name}" for f in folder.iterdir()
                       if f.suffix.lower() in (".wav", ".mp3", ".ogg", ".m4a")) if folder.is_dir() else []
        fb = SFX_FALLBACK.get(cat)
        if not files and fb and (SFX_DIR / fb).is_file():
            files = [fb]
        lib[cat] = files
    return lib


async def get_edit_plan(request: web.Request) -> web.Response:
    """The clip's auto-edit plan + what the editor needs to change it."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)
    from src.bot.trimmer import load_template
    from src.compositor.auto_edit import _layout_layers
    speed = 1.02
    try:
        tpl = load_template(clip.get("template_name") or "")
        layers = [{"id": l.get("id"), "name": l.get("name") or l.get("id")} for l in _layout_layers(tpl)]
        speed = float((tpl.get("anti_shadowban") or {}).get("speed_multiplier", 1.02) or 1.0)
    except Exception:
        layers = []
    return web.json_response({
        "clip_id": clip_id, "auto_edited": _is_auto_edited(clip), "plan": _plan_of(clip),
        "start": clip.get("adjusted_start") or 0.0, "end": clip.get("adjusted_end") or 0.0,
        "speed": speed, "layers": layers, "sfx_library": _sfx_library(),
        "source_available": bool(clip.get("source_video_path") and Path(clip["source_video_path"]).exists()),
    })


async def _rerender_with_plan(clip: Dict[str, Any], plan) -> web.Response:
    clip_id = clip["id"]
    from src.database import set_clip_edit_plan
    previous_plan, previous_flags = clip.get("edit_plan"), clip.get("flags")
    if not _is_auto_edited(clip):            # turn auto edit on for this clip
        flags = json.loads(clip.get("flags") or "[]") if clip.get("flags") else []
        flags.append({"type": "auto_edited", "severity": "low", "note": "Auto edit (editor)", "style": (plan or {}).get("style") or "punchy"})
        async with get_db_connection() as db:
            await db.execute("UPDATE clips SET flags = ? WHERE id = ?", (json.dumps(flags), clip_id))
            await db.commit()
    await set_clip_edit_plan(clip_id, plan)
    edl = await get_clip_edl(clip_id)
    from src.bot.trimmer import ClipTrimmer
    try:
        updated = await ClipTrimmer().trim_and_rerender(clip_id=clip_id, delta_start=0.0, delta_end=0.0,
                                                        words_override=(edl or {}).get("words") or None)
    except Exception as e:
        updated, err = None, e
    else:
        err = None
    if not updated:
        async with get_db_connection() as db:              # put everything back
            await db.execute("UPDATE clips SET edit_plan = ?, flags = ? WHERE id = ?", (previous_plan, previous_flags, clip_id))
            await db.commit()
        logger.error("Edit-plan render of clip %d failed: %s", clip_id, err)
        return make_json_error("RENDER_FAILED", f"Render failed: {str(err)[:200]}" if err else "Source video for this clip is missing", status=409 if not err else 500)
    fresh = await get_clip(clip_id)
    v = (fresh or {}).get("render_version") or 1
    return web.json_response({"success": True, "clip_id": clip_id, "plan": _plan_of(fresh or {}),
                              "video_url": f"/api/clips/{clip_id}/video?v={v}"})


async def put_edit_plan(request: web.Request) -> web.Response:
    """Save an edited plan (toggled / moved / added items) and re-render the clip with it."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)
    if not (clip.get("source_video_path") and Path(clip["source_video_path"]).exists()):
        return make_json_error("SOURCE_MISSING", "The source footage of this clip was deleted, so it can't be re-rendered.", status=409)
    try:
        body = await request.json()
        from src.compositor.edit_plan import validate
        plan = validate(body.get("plan") if isinstance(body, dict) and "plan" in body else body)
    except (ValueError, TypeError) as e:
        return make_json_error("BAD_PLAN", str(e))
    resp = await _rerender_with_plan(clip, plan)
    if resp.status == 200:                         # what you switched off / added teaches auto edit
        from src.intelligence.edit_learning import record_user_changes
        await record_user_changes(clip_id, _plan_of(clip), plan)
    return resp


async def get_edit_learning(request: web.Request) -> web.Response:
    from src.database import get_system_setting
    from src.compositor.auto_edit import TUNING
    try:
        data = json.loads(await get_system_setting("auto_edit_tuning", "{}") or "{}")
    except (TypeError, ValueError):
        data = {}
    return web.json_response({**data, "active": TUNING})


async def run_edit_learning(request: web.Request) -> web.Response:
    from src.intelligence.edit_learning import analyze
    return web.json_response(await analyze(apply=True))


async def reset_edit_learning(request: web.Request) -> web.Response:
    from src.intelligence.edit_learning import reset
    return web.json_response(await reset())


async def regenerate_edit_plan(request: web.Request) -> web.Response:
    """Drop the stored plan and let auto edit decide again (all user changes are lost)."""
    clip_id = int(request.match_info["id"])
    clip = await get_clip(clip_id)
    if not clip:
        return make_json_error("NOT_FOUND", f"Clip #{clip_id} not found", status=404)
    if not (clip.get("source_video_path") and Path(clip["source_video_path"]).exists()):
        return make_json_error("SOURCE_MISSING", "The source footage of this clip was deleted, so it can't be re-rendered.", status=409)
    return await _rerender_with_plan(clip, None)


async def caption_style_clip(request: web.Request) -> web.Response:
    return await _restyle(request, "caption")


async def hook_style_clip(request: web.Request) -> web.Response:
    return await _restyle(request, "hook")


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
    from src.compositor.profanity import prepare_censor
    words, _ = await prepare_censor(words)
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
            transcriber = Transcriber()
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
    from src.compositor.profanity import prepare_censor
    annotated_words, _ = await prepare_censor(deduped)
    return web.json_response({
        "success": True,
        "clip": updated_clip,
        "words": annotated_words,
        "adjusted_start": new_start,
        "adjusted_end": new_end,
        "duration": new_duration,
    })


async def get_clip_explanation(request: web.Request) -> web.Response:
    """Return AI scoring breakdown, 1-5 rubric scores, quotes, and trigger context for a clip."""
    clip_id = int(request.match_info["id"])
    async with get_db_connection() as db:
        cur = await db.execute("""
            SELECT id, channel_id, title, virality_score, final_score, score_breakdown,
                   flags, model, trigger_json, formula_version, prompt_version, created_at
            FROM clips WHERE id = ?
        """, (clip_id,))
        row = await cur.fetchone()
        if not row:
            return make_json_error("NOT_FOUND", "Clip not found", status=404)

        d = dict(row)
        score_breakdown = {}
        if d.get("score_breakdown"):
            try:
                score_breakdown = json.loads(d["score_breakdown"]) if isinstance(d["score_breakdown"], str) else d["score_breakdown"]
            except Exception:
                pass

        trigger_data = {}
        if d.get("trigger_json"):
            try:
                trigger_data = json.loads(d["trigger_json"]) if isinstance(d["trigger_json"], str) else d["trigger_json"]
            except Exception:
                pass

        flags_data = []
        if d.get("flags"):
            try:
                flags_data = json.loads(d["flags"]) if isinstance(d["flags"], str) else d["flags"]
            except Exception:
                pass

        return web.json_response({
            "clip_id": d["id"],
            "channel_id": d["channel_id"],
            "title": d["title"],
            "virality_score": d["virality_score"],
            "final_score": d["final_score"],
            "score_breakdown": score_breakdown,
            "flags": flags_data,
            "trigger": trigger_data,
            "model": d["model"],
            "formula_version": d["formula_version"],
            "prompt_version": d["prompt_version"],
            "created_at": d["created_at"],
        })


def register_clips_routes(app: web.Application):
    app.router.add_get("/api/clips", get_clips_list)
    app.router.add_get("/api/clips/feed", get_clips_feed)          # before /api/clips/{id}
    app.router.add_get("/api/clips/{id}/download", download_clip)
    app.router.add_get("/api/clips/{id}/edit-plan", get_edit_plan)
    app.router.add_put("/api/clips/{id}/edit-plan", put_edit_plan)
    app.router.add_post("/api/clips/{id}/edit-plan/regenerate", regenerate_edit_plan)
    app.router.add_get("/api/auto-edit/learning", get_edit_learning)
    app.router.add_post("/api/auto-edit/learning/run", run_edit_learning)
    app.router.add_post("/api/auto-edit/learning/reset", reset_edit_learning)
    app.router.add_get("/api/clips/{id}", get_clip_by_id)
    app.router.add_get("/api/clips/{id}/explain", get_clip_explanation)
    app.router.add_get("/api/clips/{id}/video", serve_clip_video)
    app.router.add_get("/api/clips/{id}/thumbnail", serve_clip_thumbnail)
    app.router.add_get("/api/clips/{id}/source", serve_clip_source)
    app.router.add_post("/api/clips/{id}/retemplate", retemplate_clip)
    app.router.add_post("/api/clips/bulk-retemplate", bulk_retemplate)
    app.router.add_get("/api/clips/bulk-retemplate/{batch_id}", get_bulk_retemplate)
    app.router.add_post("/api/clips/bulk-retemplate/{batch_id}/cancel", cancel_bulk_retemplate)
    app.router.add_post("/api/clips/{id}/caption-style", caption_style_clip)
    app.router.add_get("/api/caption-styles", list_caption_styles)
    app.router.add_post("/api/clips/{id}/hook-style", hook_style_clip)
    app.router.add_get("/api/hook-styles", list_hook_styles)
    app.router.add_get("/api/clips/{id}/words", get_clip_words)
    app.router.add_get("/api/clips/{id}/waveform", get_clip_waveform)
    app.router.add_get("/api/clips/{id}/source-info", get_clip_source_info)
    app.router.add_post("/api/clips/{id}/extend-source", extend_clip_source)

