"""YouTube OAuth2 Authentication & Multi-Account Distribution Router.

Handles:
- GET /api/youtube/app-config (get configured client_id)
- POST /api/youtube/app-config (save client_id & client_secret)
- GET /api/youtube/auth-url (generate Google OAuth URL)
- GET /api/youtube/oauth2callback (OAuth callback from Google consent)
- GET /api/youtube/accounts (list connected accounts)
- DELETE /api/youtube/accounts/{key} (delete account & tokens)
- POST /api/youtube/accounts/import (manual json token upload)
- GET /api/youtube/mappings (streamer-to-account mappings)
- POST /api/youtube/mappings (save streamer-to-account mappings)
"""

import json
import logging
import os
import urllib.parse
from pathlib import Path
from typing import Any, Dict

from aiohttp import web
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from googleapiclient.discovery import build

from config.settings import TOKENS_DIR
from src.database import (
    get_all_youtube_accounts,
    get_youtube_account,
    upsert_youtube_account,
    delete_youtube_account,
    get_streamer_yt_mappings,
    set_streamer_yt_mappings,
    get_oauth_app_config,
    save_oauth_app_config,
    update_youtube_account_config,
)

logger = logging.getLogger(__name__)

YOUTUBE_SCOPES = [
    "https://www.googleapis.com/auth/youtube.upload",
    "https://www.googleapis.com/auth/youtube.readonly",
    # retention (average % viewed) for the learning loop; optional - uploads never depend on it
    "https://www.googleapis.com/auth/yt-analytics.readonly",
]


# In-memory verifier store: state -> code_verifier
OAUTH_FLOW_VERIFIERS: Dict[str, str] = {}


async def get_app_config_handler(request: web.Request) -> web.Response:
    """Return stored OAuth Client ID and whether Client Secret is set."""
    cfg = await get_oauth_app_config("youtube")
    if not cfg:
        # Check environment variables fallback
        env_id = os.getenv("YOUTUBE_CLIENT_ID", "")
        env_secret = os.getenv("YOUTUBE_CLIENT_SECRET", "")
        if env_id:
            return web.json_response({"client_id": env_id, "has_secret": bool(env_secret)})
        return web.json_response({"client_id": "", "has_secret": False})
    return web.json_response({
        "client_id": cfg["client_id"],
        "has_secret": bool(cfg["client_secret"]),
    })


async def save_app_config_handler(request: web.Request) -> web.Response:
    """Save Google OAuth Client ID and Secret."""
    data = await request.json()
    client_id = data.get("client_id", "").strip()
    client_secret = data.get("client_secret", "").strip()

    if not client_id or not client_secret:
        return web.json_response({"error": "client_id and client_secret are required"}, status=400)

    await save_oauth_app_config(client_id, client_secret, "youtube")
    return web.json_response({"success": True})


async def get_auth_url_handler(request: web.Request) -> web.Response:
    """Generate Google OAuth authorization consent URL."""
    account_key = request.query.get("account_key", "").strip()
    if not account_key:
        return web.json_response({"error": "account_key is required"}, status=400)

    cfg = await get_oauth_app_config("youtube")
    client_id = cfg["client_id"] if cfg else os.getenv("YOUTUBE_CLIENT_ID", "")
    client_secret = cfg["client_secret"] if cfg else os.getenv("YOUTUBE_CLIENT_SECRET", "")

    if not client_id or not client_secret:
        return web.json_response({
            "error": "Google OAuth Client ID & Secret not configured. Please set them first."
        }, status=400)

    # Detect redirect_uri based on Host header
    host = request.headers.get("Host", "localhost:8080")
    proto = "https" if request.secure else "http"
    redirect_uri = f"{proto}://{host}/api/youtube/oauth2callback"

    client_config = {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }

    flow = Flow.from_client_config(
        client_config=client_config,
        scopes=YOUTUBE_SCOPES,
        redirect_uri=redirect_uri,
    )

    auth_url, _ = flow.authorization_url(
        access_type="offline",
        include_granted_scopes="true",
        prompt="consent",
        state=account_key,
    )

    if flow.code_verifier:
        OAUTH_FLOW_VERIFIERS[account_key] = flow.code_verifier

    return web.json_response({"auth_url": auth_url, "account_key": account_key})


async def oauth2_callback_handler(request: web.Request) -> web.Response:
    """Handle callback from Google OAuth."""
    code = request.query.get("code")
    account_key = request.query.get("state")
    error = request.query.get("error")

    if error:
        return web.Response(
            text=f"<h3>OAuth Authorization Denied: {error}</h3><p><a href='/accounts'>Back to Accounts</a></p>",
            content_type="text/html",
            status=400,
        )

    if not code or not account_key:
        return web.Response(
            text="<h3>Invalid callback parameters</h3><p><a href='/accounts'>Back to Accounts</a></p>",
            content_type="text/html",
            status=400,
        )

    cfg = await get_oauth_app_config("youtube")
    client_id = cfg["client_id"] if cfg else os.getenv("YOUTUBE_CLIENT_ID", "")
    client_secret = cfg["client_secret"] if cfg else os.getenv("YOUTUBE_CLIENT_SECRET", "")

    host = request.headers.get("Host", "localhost:8080")
    proto = "https" if request.secure else "http"
    redirect_uri = f"{proto}://{host}/api/youtube/oauth2callback"

    client_config = {
        "web": {
            "client_id": client_id,
            "client_secret": client_secret,
            "auth_uri": "https://accounts.google.com/o/oauth2/auth",
            "token_uri": "https://oauth2.googleapis.com/token",
        }
    }

    try:
        flow = Flow.from_client_config(
            client_config=client_config,
            scopes=YOUTUBE_SCOPES,
            redirect_uri=redirect_uri,
        )
        saved_verifier = OAUTH_FLOW_VERIFIERS.pop(account_key, None)
        if saved_verifier:
            flow.code_verifier = saved_verifier
        flow.fetch_token(code=code)
        creds = flow.credentials

        token_data = {
            "client_id": client_id,
            "client_secret": client_secret,
            "token": creds.token,
            "refresh_token": creds.refresh_token,
            "token_uri": creds.token_uri,
            # what Google actually granted; refreshing with ungranted scopes would fail
            "scopes": list(getattr(creds, "granted_scopes", None) or creds.scopes or YOUTUBE_SCOPES),
        }

        # Save token file to config/tokens/yt_<account_key>.json
        TOKENS_DIR.mkdir(parents=True, exist_ok=True)
        token_path = TOKENS_DIR / f"yt_{account_key}.json"
        with open(token_path, "w", encoding="utf-8") as f:
            json.dump(token_data, f, indent=2)

        # Query channel profile via YouTube Data API
        channel_id = None
        channel_title = account_key
        custom_url = None
        thumbnail_url = None

        try:
            yt = build("youtube", "v3", credentials=creds)
            resp = yt.channels().list(part="snippet", mine=True).execute()
            items = resp.get("items", [])
            if items:
                snippet = items[0].get("snippet", {})
                channel_id = items[0].get("id")
                channel_title = snippet.get("title", account_key)
                custom_url = snippet.get("customUrl")
                thumbnail_url = snippet.get("thumbnails", {}).get("default", {}).get("url")
        except Exception as yt_err:
            logger.warning("Could not fetch YouTube channel details: %s", yt_err)

        await upsert_youtube_account(
            account_key=account_key,
            channel_id=channel_id,
            channel_title=channel_title,
            custom_url=custom_url,
            thumbnail_url=thumbnail_url,
        )

        # Redirect user back to Frontend Accounts page dynamically preserving scheme and host
        forwarded_proto = request.headers.get("X-Forwarded-Proto", "https" if request.secure else "http")
        frontend_url = f"{forwarded_proto}://{host}/accounts?connected={urllib.parse.quote(account_key)}"
        raise web.HTTPFound(frontend_url)

    except web.HTTPFound:
        raise
    except Exception as e:
        logger.error("OAuth token exchange failed: %s", e)
        return web.Response(
            text=f"<h3>Authentication Failed</h3><p>{str(e)}</p><p><a href='/accounts'>Return to App</a></p>",
            content_type="text/html",
            status=500,
        )


async def list_accounts_handler(request: web.Request) -> web.Response:
    """List all connected YouTube accounts with token verification status."""
    from src.database import get_db_connection
    from src.publisher.auto_approve import agreement_stats
    from src.publisher.slots import (
        DEFAULT_QUOTA_UNITS, UPLOAD_UNITS, account_taken_times, next_slot, parse_slots, slots_to_strings, units_used,
    )
    from src.publisher.youtube_shorts import token_project_key

    accounts = await get_all_youtube_accounts()
    stats = await agreement_stats()
    result = []
    async with get_db_connection() as db:
        for acc in accounts:
            key = acc["account_key"]
            has_token = (TOKENS_DIR / f"yt_{key}.json").exists()
            project = token_project_key(key)
            used = await units_used(db, project)
            limit = int(acc.get("quota_units_per_day") or DEFAULT_QUOTA_UNITS)
            taken = await account_taken_times(db, key)
            cur = await db.execute(
                "SELECT COUNT(*) FROM scheduled_queue WHERE account_key = ? AND yt_status = 'pending'", (key,)
            )
            upcoming = (await cur.fetchone())[0]
            cur = await db.execute(
                """SELECT COUNT(DISTINCT video_id), COALESCE(SUM(views), 0) FROM clip_metrics m
                   WHERE account_key = ? AND id IN (SELECT id FROM clip_metrics m2 WHERE m2.video_id = m.video_id
                       ORDER BY CASE m2.window WHEN '7d' THEN 0 WHEN '72h' THEN 1 ELSE 2 END LIMIT 1)""",
                (key,),
            )
            tracked, total_views = await cur.fetchone()
            result.append({
                **acc,
                "auto_mode": acc.get("auto_mode") or ("on" if acc.get("auto_upload") else "off"),
                "publish_slots": slots_to_strings(parse_slots(acc.get("publish_slots"))),
                "has_token_file": has_token,
                "status": "connected" if has_token else "token_missing",
                "quota": {
                    "project": project if project.startswith("account:") else project[:12] + "…",
                    "used": used, "limit": limit,
                    "uploads_left_today": max(0, (limit - used) // UPLOAD_UNITS),
                },
                "upcoming_posts": upcoming,
                "performance": {"tracked_shorts": tracked, "total_views": total_views},
                "next_free_slot": next_slot(acc, taken).isoformat(),
                "trial": stats.get(key),
            })
    return web.json_response(result)


async def delete_account_handler(request: web.Request) -> web.Response:
    """Disconnect and delete a YouTube account."""
    key = request.match_info["key"]
    token_path = TOKENS_DIR / f"yt_{key}.json"
    if token_path.exists():
        try:
            token_path.unlink()
        except Exception as e:
            logger.warning("Could not delete token file for %s: %s", key, e)

    await delete_youtube_account(key)
    return web.json_response({"success": True, "deleted": key})


async def import_account_handler(request: web.Request) -> web.Response:
    """Manually import a token JSON file for an account."""
    data = await request.json()
    account_key = data.get("account_key", "").strip()
    token_json = data.get("token_json")

    if not account_key or not token_json:
        return web.json_response({"error": "account_key and token_json required"}, status=400)

    token_dict = token_json if isinstance(token_json, dict) else json.loads(token_json)

    TOKENS_DIR.mkdir(parents=True, exist_ok=True)
    token_path = TOKENS_DIR / f"yt_{account_key}.json"
    with open(token_path, "w", encoding="utf-8") as f:
        json.dump(token_dict, f, indent=2)

    await upsert_youtube_account(
        account_key=account_key,
        channel_id=None,
        channel_title=account_key,
        custom_url=None,
        thumbnail_url=None,
    )
    return web.json_response({"success": True, "account_key": account_key})


async def get_mappings_handler(request: web.Request) -> web.Response:
    """Get all streamer-to-account mappings."""
    mappings = await get_streamer_yt_mappings()
    return web.json_response(mappings)


async def set_mappings_handler(request: web.Request) -> web.Response:
    """Save streamer-to-accounts mappings."""
    data = await request.json()
    streamer_handle = data.get("streamer_handle", "").strip()
    account_keys = data.get("account_keys", [])

    if not streamer_handle:
        return web.json_response({"error": "streamer_handle is required"}, status=400)

    await set_streamer_yt_mappings(streamer_handle, account_keys)
    return web.json_response({"success": True, "streamer_handle": streamer_handle, "account_keys": account_keys})


async def update_account_config_handler(request: web.Request) -> web.Response:
    """Partial update of a channel's publishing rules. Only fields present in the body change."""
    from zoneinfo import ZoneInfo
    from src.publisher.auto_approve import MODES
    from src.publisher.slots import parse_slots, slots_to_strings
    from src.publisher.youtube_shorts import VALID_PRIVACY

    key = request.match_info["key"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)
    if not isinstance(data, dict):
        return web.json_response({"error": "Body must be an object"}, status=400)

    changes = {}
    try:
        if "auto_mode" in data:
            if data["auto_mode"] not in MODES:
                raise ValueError(f"auto_mode must be one of {MODES}")
            changes["auto_mode"] = data["auto_mode"]
            changes["auto_upload"] = 1 if data["auto_mode"] == "on" else 0
        elif "auto_upload" in data:  # legacy toggle
            changes["auto_upload"] = 1 if data["auto_upload"] else 0
            changes["auto_mode"] = "on" if data["auto_upload"] else "off"
        if "min_score_threshold" in data:
            v = int(data["min_score_threshold"])
            if not 0 <= v <= 100:
                raise ValueError("min_score_threshold must be 0-100")
            changes["min_score_threshold"] = v
        if "drip_delay_hours" in data:
            changes["drip_delay_hours"] = max(1, min(int(data["drip_delay_hours"]), 72))
        if "privacy_status" in data:
            if data["privacy_status"] not in VALID_PRIVACY:
                raise ValueError(f"privacy_status must be one of {VALID_PRIVACY}")
            changes["privacy_status"] = data["privacy_status"]
        if "tag_override" in data:
            changes["tag_override"] = str(data["tag_override"])[:500]
        if "publish_slots" in data:
            raw = data["publish_slots"]
            slots = parse_slots(raw)
            if isinstance(raw, list) and raw and len(slots) == 0:
                raise ValueError("publish_slots must be HH:MM times")
            changes["publish_slots"] = json.dumps(slots_to_strings(slots))
        if "daily_cap" in data:
            v = int(data["daily_cap"])
            if not 1 <= v <= 50:
                raise ValueError("daily_cap must be 1-50")
            changes["daily_cap"] = v
        if "timezone" in data:
            ZoneInfo(str(data["timezone"]))  # raises for unknown zones
            changes["timezone"] = str(data["timezone"])
        if "quota_units_per_day" in data:
            v = int(data["quota_units_per_day"])
            if not 1600 <= v <= 10_000_000:
                raise ValueError("quota_units_per_day must be at least 1600 (one upload)")
            changes["quota_units_per_day"] = v
        if "is_active" in data:
            changes["is_active"] = 1 if data["is_active"] else 0
    except (TypeError, ValueError, KeyError) as e:
        return web.json_response({"error": str(e) or "Invalid value"}, status=400)
    except Exception as e:  # ZoneInfoNotFoundError
        return web.json_response({"error": f"Unknown timezone: {e}"}, status=400)

    await update_youtube_account_config(key, **changes)
    return web.json_response({"success": True, "account_key": key, "updated": sorted(changes)})


def register_youtube_routes(app: web.Application) -> None:
    """Register all YouTube OAuth & Multi-Account routes."""
    app.router.add_get("/api/youtube/app-config", get_app_config_handler)
    app.router.add_post("/api/youtube/app-config", save_app_config_handler)
    app.router.add_get("/api/youtube/auth-url", get_auth_url_handler)
    app.router.add_get("/api/youtube/oauth2callback", oauth2_callback_handler)
    app.router.add_get("/api/youtube/accounts", list_accounts_handler)
    app.router.add_patch("/api/youtube/accounts/{key}", update_account_config_handler)
    app.router.add_delete("/api/youtube/accounts/{key}", delete_account_handler)
    app.router.add_post("/api/youtube/accounts/import", import_account_handler)
    app.router.add_get("/api/youtube/mappings", get_mappings_handler)
    app.router.add_post("/api/youtube/mappings", set_mappings_handler)

