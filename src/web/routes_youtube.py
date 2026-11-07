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

        # Redirect user back to Frontend Accounts page
        frontend_url = f"http://localhost:5173/accounts?connected={urllib.parse.quote(account_key)}"
        raise web.HTTPFound(frontend_url)

    except web.HTTPFound:
        raise
    except Exception as e:
        logger.error("OAuth token exchange failed: %s", e)
        return web.Response(
            text=f"<h3>Authentication Failed</h3><p>{str(e)}</p><p><a href='http://localhost:5173/accounts'>Return to App</a></p>",
            content_type="text/html",
            status=500,
        )


async def list_accounts_handler(request: web.Request) -> web.Response:
    """List all connected YouTube accounts with token verification status."""
    accounts = await get_all_youtube_accounts()
    result = []
    for acc in accounts:
        key = acc["account_key"]
        token_path = TOKENS_DIR / f"yt_{key}.json"
        has_token = token_path.exists()
        result.append({
            **acc,
            "has_token_file": has_token,
            "status": "connected" if has_token else "token_missing",
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
    """Update auto-upload rules and score thresholds for an account."""
    key = request.match_info["key"]
    data = await request.json()

    auto_upload = bool(data.get("auto_upload", False))
    min_score = int(data.get("min_score_threshold", 75))
    drip_delay = int(data.get("drip_delay_hours", 4))
    privacy = str(data.get("privacy_status", "public"))
    tags = str(data.get("tag_override", "#Shorts #Viral #Gaming"))

    await update_youtube_account_config(
        account_key=key,
        auto_upload=auto_upload,
        min_score_threshold=min_score,
        drip_delay_hours=drip_delay,
        privacy_status=privacy,
        tag_override=tags,
    )
    return web.json_response({"success": True, "account_key": key})


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

