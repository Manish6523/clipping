"""Presets REST API Router.

Includes:
- GET /api/presets (list presets filtered by channel or global)
- POST /api/presets (create new preset)
- GET /api/presets/{id}
- PATCH /api/presets/{id}
- DELETE /api/presets/{id}
- POST /api/presets/{id}/apply (apply preset to clip or all pending streamer clips)
"""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional
from aiohttp import web

from config.settings import TEMPLATES_DIR
from src.database import get_db_connection, get_clip, save_clip_edl
from src.web.ws_manager import ws_manager

logger = logging.getLogger(__name__)


def make_json_error(code: str, message: str, status: int = 400) -> web.Response:
    return web.json_response({"error": {"code": code, "message": message}}, status=status)


async def seed_presets_from_templates(db):
    """Seed DB presets table from templates/*.json files if empty."""
    cur = await db.execute("SELECT COUNT(*) FROM presets")
    count = (await cur.fetchone())[0]
    if count == 0:
        t_dir = Path(TEMPLATES_DIR)
        if t_dir.exists():
            for t_file in t_dir.glob("*.json"):
                try:
                    with open(t_file, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        name = data.get("name", t_file.stem)
                        await db.execute(
                            """
                            INSERT INTO presets (name, scope, data, is_default)
                            VALUES (?, 'global', ?, 1)
                            """,
                            (name, json.dumps(data)),
                        )
                except Exception as e:
                    logger.debug("Failed seeding preset from %s: %s", t_file, e)
            await db.commit()


async def list_presets(request: web.Request) -> web.Response:
    """Return all presets, with optional channel_id filter."""
    channel_id = request.query.get("channel_id")
    async with get_db_connection() as db:
        await seed_presets_from_templates(db)
        if channel_id:
            cur = await db.execute(
                """
                SELECT * FROM presets
                WHERE scope = 'global' OR channel_id = ?
                ORDER BY is_default DESC, id DESC
                """,
                (channel_id,),
            )
        else:
            cur = await db.execute("SELECT * FROM presets ORDER BY is_default DESC, id DESC")

        rows = await cur.fetchall()
        result = []
        for r in rows:
            item = dict(r)
            try:
                item["data"] = json.loads(item["data"])
            except Exception:
                pass
            result.append(item)
        return web.json_response(result)


async def create_preset(request: web.Request) -> web.Response:
    """Create a new visual styling preset."""
    try:
        body = await request.json()
    except Exception:
        return make_json_error("INVALID_JSON", "Request body must be valid JSON")

    name = str(body.get("name", "")).strip()
    if not name:
        return make_json_error("VALIDATION_ERROR", "Preset name is required")

    scope = body.get("scope", "global")
    channel_id = body.get("channel_id")
    data = body.get("data", {})
    is_default = 1 if body.get("is_default") else 0

    async with get_db_connection() as db:
        cur = await db.execute(
            """
            INSERT INTO presets (name, scope, channel_id, data, is_default)
            VALUES (?, ?, ?, ?, ?)
            """,
            (name, scope, channel_id, json.dumps(data), is_default),
        )
        preset_id = cur.lastrowid
        await db.commit()

        cur2 = await db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,))
        row = await cur2.fetchone()
        res = dict(row)
        res["data"] = data
        return web.json_response(res, status=201)


async def update_preset(request: web.Request) -> web.Response:
    """Update existing preset."""
    preset_id = int(request.match_info["id"])
    body = await request.json()

    updates = []
    params = []
    if "name" in body:
        updates.append("name = ?")
        params.append(str(body["name"]).strip())
    if "scope" in body:
        updates.append("scope = ?")
        params.append(body["scope"])
    if "channel_id" in body:
        updates.append("channel_id = ?")
        params.append(body["channel_id"])
    if "data" in body:
        updates.append("data = ?")
        params.append(json.dumps(body["data"]))
    if "is_default" in body:
        updates.append("is_default = ?")
        params.append(1 if body["is_default"] else 0)

    if not updates:
        return make_json_error("NO_CHANGES", "No fields to update")

    params.append(preset_id)
    async with get_db_connection() as db:
        await db.execute(f"UPDATE presets SET {', '.join(updates)}, updated_at = CURRENT_TIMESTAMP WHERE id = ?", tuple(params))
        await db.commit()

        cur = await db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,))
        row = await cur.fetchone()
        if not row:
            return make_json_error("NOT_FOUND", "Preset not found", status=404)
        res = dict(row)
        try:
            res["data"] = json.loads(res["data"])
        except Exception:
            pass
        return web.json_response(res)


async def delete_preset(request: web.Request) -> web.Response:
    """Delete a preset."""
    preset_id = int(request.match_info["id"])
    async with get_db_connection() as db:
        await db.execute("DELETE FROM presets WHERE id = ?", (preset_id,))
        await db.commit()
    return web.json_response({"success": True})


async def apply_preset(request: web.Request) -> web.Response:
    """
    Apply preset settings to a specific clip or to all pending clips for streamer.
    """
    preset_id = int(request.match_info["id"])
    body = await request.json()
    clip_id = body.get("clip_id")
    apply_to_streamer = body.get("apply_to_streamer", False)

    async with get_db_connection() as db:
        cur = await db.execute("SELECT * FROM presets WHERE id = ?", (preset_id,))
        row = await cur.fetchone()
        if not row:
            return make_json_error("NOT_FOUND", "Preset not found", status=404)
        preset_data = json.loads(row["data"])

        target_clip_ids = []
        if clip_id:
            target_clip_ids.append(int(clip_id))

        if apply_to_streamer and clip_id:
            c = await get_clip(int(clip_id))
            if c and c.get("channel_id"):
                c_cur = await db.execute(
                    "SELECT id FROM clips WHERE channel_id = ? AND status = 'pending_approval' AND id != ?",
                    (c["channel_id"], clip_id),
                )
                rows = await c_cur.fetchall()
                target_clip_ids.extend([r["id"] for r in rows])

        for cid in target_clip_ids:
            cur_edl_row = await db.execute("SELECT edl_json, version FROM clip_edls WHERE clip_id = ?", (cid,))
            edl_row = await cur_edl_row.fetchone()
            if edl_row:
                edl = json.loads(edl_row["edl_json"])
            else:
                edl = {"clip_id": cid}

            # Merge layout and captions from preset
            if "layout" in preset_data:
                edl["layout"] = preset_data["layout"]
            if "subtitles" in preset_data:
                edl["captions"] = preset_data["subtitles"]
            elif "captions" in preset_data:
                edl["captions"] = preset_data["captions"]

            await save_clip_edl(cid, edl)

        return web.json_response({
            "success": True,
            "applied_count": len(target_clip_ids),
            "preset_data": preset_data,
        })


def register_presets_routes(app: web.Application):
    app.router.add_get("/api/presets", list_presets)
    app.router.add_post("/api/presets", create_preset)
    app.router.add_patch("/api/presets/{id}", update_preset)
    app.router.add_delete("/api/presets/{id}", delete_preset)
    app.router.add_post("/api/presets/{id}/apply", apply_preset)

