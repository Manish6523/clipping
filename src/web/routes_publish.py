"""One-tap publishing + TikTok account connection.

- GET  /api/publish/targets?clip_id=      which platforms are set up for this clip's streamer
- POST /api/clips/{id}/publish            {platforms: [...], when: "now" | "slot" | ISO time}
- GET  /api/clips/{id}/publish-status     the clip's queue rows (poll after "now")
- TikTok: app-config, auth-url, oauth2callback, accounts (list / patch / delete)
"""

import asyncio
import json
import logging
import secrets
import time
import urllib.parse
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import aiohttp
from aiohttp import web

from src.publisher import tiktok

logger = logging.getLogger(__name__)

_TT_STATES: Dict[str, Dict[str, Any]] = {}       # state -> {key, mode, redirect_uri, ts}
_PUBLISH_TASKS: Dict[int, asyncio.Task] = {}


def _external_base(request: web.Request) -> str:
    """Public origin, honouring a reverse proxy / tunnel (TikTok only accepts https redirects)."""
    proto = request.headers.get("X-Forwarded-Proto") or ("https" if request.secure else "http")
    host = request.headers.get("X-Forwarded-Host") or request.headers.get("Host", "localhost:8080")
    return f"{proto.split(',')[0].strip()}://{host.split(',')[0].strip()}"


def parse_when(value: Any) -> Optional[datetime]:
    """'now' -> now (UTC); 'slot'/None -> None (next free slot); ISO string -> that time (UTC)."""
    if value in (None, "", "slot"):
        return None
    if value == "now":
        return datetime.now(timezone.utc)
    try:
        dt = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        raise ValueError("`when` must be 'now', 'slot' or an ISO date-time")
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


async def _queue_rows(clip_id: int) -> List[Dict[str, Any]]:
    from src.database import get_db_connection
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT id, account_key, scheduled_for, yt_status, ig_status, COALESCE(tt_status, 'skipped') AS tt_status,
                      yt_video_id, ig_media_id, tt_publish_id, tt_account_key, last_error, attempts
               FROM scheduled_queue WHERE clip_id = ? ORDER BY id""",
            (clip_id,),
        )
        return [dict(r) for r in await cur.fetchall()]


def summarize(rows: List[Dict[str, Any]], running: bool) -> Dict[str, Any]:
    def state(col: str) -> Optional[str]:
        vals = [r[col] for r in rows if r.get(col) and r[col] != "skipped"]
        if not vals:
            return None
        for s in ("uploaded", "failed", "pending"):
            if s in vals:
                return s if s != "pending" or not running else "uploading"
        return vals[0]
    return {
        "running": running,
        "youtube": state("yt_status"),
        "instagram": state("ig_status"),
        "tiktok": state("tt_status"),
        "youtube_urls": [f"https://youtube.com/shorts/{r['yt_video_id']}" for r in rows if r.get("yt_video_id")],
        "scheduled_for": min((r["scheduled_for"] for r in rows if "pending" in (r["yt_status"], r["ig_status"], r["tt_status"])), default=None),
        "errors": [r["last_error"] for r in rows if r.get("last_error")],
        "rows": rows,
    }


async def targets_handler(request: web.Request) -> web.Response:
    from src.database import get_clip, get_db_connection
    from src.publisher.scheduler import load_template_destinations
    try:
        clip_id = int(request.query.get("clip_id", "0"))
    except ValueError:
        return web.json_response({"error": "clip_id must be a number"}, status=400)
    clip = await get_clip(clip_id) if clip_id else None
    if clip_id and not clip:
        return web.json_response({"error": "Clip not found"}, status=404)
    channel = ((clip or {}).get("channel_id") or "").strip()

    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT DISTINCT a.account_key, a.channel_title FROM streamer_yt_mappings m
               JOIN youtube_accounts a ON a.account_key = m.account_key AND a.is_active = 1
               WHERE lower(m.streamer_handle) IN (lower(?), lower(?), lower(?))""",
            (channel, channel.lstrip("@"), "@" + channel.lstrip("@")),
        )
        yt = [{"key": r[0], "name": r[1] or r[0]} for r in await cur.fetchall()]
        cur = await db.execute("SELECT COUNT(*) FROM youtube_accounts WHERE is_active = 1")
        yt_total = (await cur.fetchone())[0]

    dest = load_template_destinations((clip or {}).get("template_name") or "") if clip else {}
    from src.publisher import instagram_accounts
    ig_accounts = await instagram_accounts.get_accounts()
    ig_key = await instagram_accounts.account_for_streamer(channel) or dest.get("instagram_account_key")
    ig_meta = next((a for a in ig_accounts if a["key"] == ig_key), None) if ig_key else None
    tt_accounts = await tiktok.get_accounts()
    tt_key = await tiktok.account_for_streamer(channel)
    tt_meta = next((a for a in tt_accounts if a["key"] == tt_key), None)
    creds = await tiktok.app_credentials()

    return web.json_response({
        "channel": channel,
        "youtube": {"ready": bool(yt), "accounts": yt,
                    "hint": None if yt else ("Map a YouTube account to this streamer in Accounts" if yt_total else "Connect a YouTube account in Accounts")},
        "instagram": {"ready": bool(ig_key), "account": ig_key,
                      "meta": ig_meta and {"key": ig_meta["key"], "username": ig_meta.get("username") or ig_meta["key"]},
                      "hint": None if ig_key else ("Connect Instagram in Accounts" if not ig_accounts else "Map an Instagram account to this streamer in Accounts")},
        "tiktok": {"ready": bool(tt_key), "account": tt_meta and {"key": tt_meta["key"], "name": tt_meta.get("display_name") or tt_meta["key"],
                                                                     "mode": tt_meta.get("mode", "inbox")},
                   "app_configured": bool(creds.get("client_key")),
                   "hint": None if tt_key else ("Connect TikTok in Accounts" if not tt_accounts else "Map a TikTok account to this streamer in Accounts")},
        "status": summarize(await _queue_rows(clip_id), clip_id in _PUBLISH_TASKS) if clip_id else None,
    })


async def publish_handler(request: web.Request) -> web.Response:
    from src.database import get_clip
    from src.publisher.slots import schedule_clip
    clip_id = int(request.match_info["id"])
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Body must be JSON"}, status=400)
    clip = await get_clip(clip_id)
    if not clip:
        return web.json_response({"error": "Clip not found"}, status=404)
    if not clip.get("rendered_video_path"):
        return web.json_response({"error": "This clip has no rendered video yet"}, status=409)
    if clip_id in _PUBLISH_TASKS:
        return web.json_response({"error": "This clip is already uploading"}, status=409)
    platforms = [p for p in (data.get("platforms") or []) if p in ("youtube", "instagram", "tiktok")]
    if not platforms:
        return web.json_response({"error": "Pick at least one platform"}, status=400)
    try:
        when = parse_when(data.get("when", "slot"))
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)

    from src.publisher.auto_approve import record_human_decision
    await record_human_decision(clip_id, "approve")
    try:
        created = await schedule_clip(clip_id, platforms=platforms, when=when, replace_pending=True)
    except ValueError as e:
        return web.json_response({"error": str(e)}, status=400)

    if not created:
        return web.json_response({"error": "Nothing new to publish: this clip is already uploaded or queued on the platforms you picked"},
                                 status=400)

    now = data.get("when") == "now"
    if now:
        async def _run():
            try:
                from src.publisher.scheduler import publish_clip_now
                result = await publish_clip_now(clip_id, schedule=False)
                try:
                    from src.web.ws_manager import ws_manager
                    await ws_manager.broadcast("clip_published", {"clip_id": clip_id, "success": result.get("success"),
                                                                  "errors": result.get("errors")})
                except Exception:
                    pass
            except Exception as e:
                logger.error("Publish now failed for clip #%d: %s", clip_id, e)
            finally:
                _PUBLISH_TASKS.pop(clip_id, None)
        _PUBLISH_TASKS[clip_id] = asyncio.create_task(_run())

    rows = await _queue_rows(clip_id)
    return web.json_response({"success": True, "now": now, "scheduled": created,
                              "status": summarize(rows, clip_id in _PUBLISH_TASKS)})


async def publish_status_handler(request: web.Request) -> web.Response:
    clip_id = int(request.match_info["id"])
    return web.json_response(summarize(await _queue_rows(clip_id), clip_id in _PUBLISH_TASKS))


# ------------------------------------------------------------------ TikTok connection

async def tt_get_app_config(request: web.Request) -> web.Response:
    creds = await tiktok.app_credentials()
    return web.json_response({"client_key": creds["client_key"], "has_secret": bool(creds["client_secret"]),
                              "redirect_uri": f"{_external_base(request)}/api/tiktok/oauth2callback"})


async def tt_save_app_config(request: web.Request) -> web.Response:
    from src.database import save_oauth_app_config
    data = await request.json()
    key, secret = (data.get("client_key") or "").strip(), (data.get("client_secret") or "").strip()
    if not secret:                                   # blank = keep the saved secret
        secret = (await tiktok.app_credentials()).get("client_secret", "")
    if not key or not secret:
        return web.json_response({"error": "client_key and client_secret are required"}, status=400)
    await save_oauth_app_config(key, secret, "tiktok")
    return web.json_response({"success": True})


async def tt_auth_url(request: web.Request) -> web.Response:
    creds = await tiktok.app_credentials()
    if not creds["client_key"] or not creds["client_secret"]:
        return web.json_response({"error": "Add your TikTok app's client key and secret first"}, status=400)
    mode = "direct" if request.query.get("mode") == "direct" else "inbox"
    redirect_uri = f"{_external_base(request)}/api/tiktok/oauth2callback"
    state = secrets.token_urlsafe(24)
    now = time.time()
    for k in [k for k, v in _TT_STATES.items() if now - v["ts"] > 900]:
        _TT_STATES.pop(k, None)
    _TT_STATES[state] = {"mode": mode, "redirect_uri": redirect_uri, "ts": now}
    scopes = tiktok.SCOPES_DIRECT if mode == "direct" else tiktok.SCOPES_INBOX
    q = urllib.parse.urlencode({"client_key": creds["client_key"], "scope": ",".join(scopes), "response_type": "code",
                                "redirect_uri": redirect_uri, "state": state})
    return web.json_response({"auth_url": f"{tiktok.AUTHORIZE_URL}?{q}", "redirect_uri": redirect_uri})


def _page(msg: str, ok: bool) -> web.Response:
    color = "#22c55e" if ok else "#ef4444"
    html = (f"<!doctype html><meta name=viewport content='width=device-width'><body style='font-family:system-ui;background:#0b0d12;color:#e5e7eb;"
            f"display:grid;place-items:center;height:100vh;margin:0'><div style='text-align:center;padding:24px'>"
            f"<h2 style='color:{color}'>{'Connected' if ok else 'TikTok connection failed'}</h2><p>{msg}</p>"
            f"<p><a style='color:#60a5fa' href='/accounts'>Back to Accounts</a></p></div></body>")
    return web.Response(text=html, content_type="text/html", status=200 if ok else 400)


async def tt_callback(request: web.Request) -> web.Response:
    import html as _html
    if request.query.get("error"):
        return _page(_html.escape(request.query.get("error_description") or request.query["error"]), False)
    st = _TT_STATES.pop(request.query.get("state", ""), None)
    code = request.query.get("code")
    if not st or not code:
        return _page("The login link expired or was opened twice. Start again from Accounts.", False)
    try:
        tok = await tiktok.exchange_code(code, st["redirect_uri"])
        key = tok.get("open_id") or secrets.token_hex(6)
        key = "".join(ch for ch in key if ch.isalnum() or ch in "-_")[:64]
        tiktok.save_token(key, tok)
        profile = {}
        try:
            async with aiohttp.ClientSession() as s:
                async with s.get(f"{tiktok.API}/v2/user/info/?fields=open_id,avatar_url,display_name,username",
                                 headers={"Authorization": f"Bearer {tok['access_token']}"},
                                 timeout=aiohttp.ClientTimeout(total=20)) as r:
                    profile = ((await r.json(content_type=None)).get("data") or {}).get("user") or {}
        except Exception as e:
            logger.info("TikTok profile lookup failed: %s", e)
        await tiktok.upsert_account({"key": key, "display_name": profile.get("display_name") or "TikTok account",
                                     "username": profile.get("username"), "avatar": profile.get("avatar_url"),
                                     "mode": st["mode"], "scope": tok.get("scope", "")})
        return _page(f"{_html.escape(profile.get('display_name') or 'Your TikTok account')} is connected. "
                     f"Map it to a streamer in Accounts to publish their clips.", True)
    except Exception as e:
        logger.error("TikTok OAuth callback failed: %s", e)
        return _page(_html.escape(str(e))[:300], False)


async def tt_list_accounts(request: web.Request) -> web.Response:
    accounts = await tiktok.get_accounts()
    out = []
    for a in accounts:
        try:
            t = tiktok.load_token(a["key"])
            connected = t.get("refresh_expires_at", 0) > time.time()
        except Exception:
            connected = False
        out.append({**a, "connected": connected})
    return web.json_response({"accounts": out})


async def tt_patch_account(request: web.Request) -> web.Response:
    key = request.match_info["key"]
    data = await request.json()
    accounts = await tiktok.get_accounts()
    acc = next((a for a in accounts if a["key"] == key), None)
    if not acc:
        return web.json_response({"error": "Unknown TikTok account"}, status=404)
    if "mode" in data:
        if data["mode"] not in ("inbox", "direct"):
            return web.json_response({"error": "mode must be inbox or direct"}, status=400)
        acc["mode"] = data["mode"]
    if "privacy" in data:
        if data["privacy"] not in ("PUBLIC_TO_EVERYONE", "MUTUAL_FOLLOW_FRIENDS", "FOLLOWER_OF_CREATOR", "SELF_ONLY"):
            return web.json_response({"error": "Unknown privacy level"}, status=400)
        acc["privacy"] = data["privacy"]
    if "streamers" in data:
        acc["streamers"] = [str(s).strip() for s in data["streamers"] if str(s).strip()][:50]
    await tiktok.save_accounts(accounts)
    return web.json_response({"success": True, "account": acc})


async def tt_delete_account(request: web.Request) -> web.Response:
    key = request.match_info["key"]
    accounts = [a for a in await tiktok.get_accounts() if a["key"] != key]
    await tiktok.save_accounts(accounts)
    tiktok.token_path(key).unlink(missing_ok=True)
    return web.json_response({"success": True})


def register_publish_routes(app: web.Application) -> None:
    app.router.add_get("/api/publish/targets", targets_handler)
    app.router.add_post("/api/clips/{id}/publish", publish_handler)
    app.router.add_get("/api/clips/{id}/publish-status", publish_status_handler)
    app.router.add_get("/api/tiktok/app-config", tt_get_app_config)
    app.router.add_post("/api/tiktok/app-config", tt_save_app_config)
    app.router.add_get("/api/tiktok/auth-url", tt_auth_url)
    app.router.add_get("/api/tiktok/oauth2callback", tt_callback)
    app.router.add_get("/api/tiktok/accounts", tt_list_accounts)
    app.router.add_patch("/api/tiktok/accounts/{key}", tt_patch_account)
    app.router.add_delete("/api/tiktok/accounts/{key}", tt_delete_account)
