"""TikTok publisher (official Content Posting API v2).

- OAuth (Login Kit v2) with the app's client key/secret (stored like YouTube's: oauth app config
  provider "tiktok"). Tokens live in config/tokens/tt_<key>.json; access tokens last 24 h and are
  refreshed automatically with the 365-day refresh token.
- Upload: FILE_UPLOAD in chunks, then poll status.
  * mode "inbox" (default): the video lands in the creator's TikTok inbox/drafts and they tap
    Post in the app. Works for apps that have not passed TikTok's audit.
  * mode "direct": posts straight away (needs the video.publish scope; unaudited apps may only
    post SELF_ONLY / private videos).

Account metadata (display name, avatar, mode, privacy, mapped streamers) is a JSON list in the
system setting `tiktok_accounts`.
"""

import asyncio
import json
import logging
import time
from pathlib import Path
from typing import Any, Dict, List, Optional

import aiohttp

from config.settings import TOKENS_DIR

logger = logging.getLogger(__name__)

API = "https://open.tiktokapis.com"
AUTHORIZE_URL = "https://www.tiktok.com/v2/auth/authorize/"
TOKEN_URL = f"{API}/v2/oauth/token/"
SCOPES_INBOX = ["user.info.basic", "video.upload"]
SCOPES_DIRECT = SCOPES_INBOX + ["video.publish"]

MIN_CHUNK = 5 * 1024 * 1024
DEFAULT_CHUNK = 10 * 1024 * 1024
MAX_CHUNK = 64 * 1024 * 1024
STATUS_POLL_S = 5
STATUS_TIMEOUT_S = 300


class TikTokError(RuntimeError):
    pass


# ------------------------------------------------------------------ accounts + tokens

def token_path(account_key: str) -> Path:
    return Path(TOKENS_DIR) / f"tt_{account_key}.json"


def load_token(account_key: str) -> Dict[str, Any]:
    p = token_path(account_key)
    if not p.exists():
        raise TikTokError(f"TikTok account '{account_key}' is not connected (no token file)")
    return json.loads(p.read_text(encoding="utf-8"))


def save_token(account_key: str, data: Dict[str, Any]) -> None:
    Path(TOKENS_DIR).mkdir(parents=True, exist_ok=True)
    p = token_path(account_key)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        p.chmod(0o600)
    except OSError:
        pass


def token_from_response(resp: Dict[str, Any], now: Optional[float] = None) -> Dict[str, Any]:
    now = now or time.time()
    return {
        "open_id": resp.get("open_id"),
        "access_token": resp["access_token"],
        "refresh_token": resp.get("refresh_token"),
        "scope": resp.get("scope", ""),
        "expires_at": now + float(resp.get("expires_in", 86400)) - 120,
        "refresh_expires_at": now + float(resp.get("refresh_expires_in", 31536000)) - 3600,
    }


async def get_accounts() -> List[Dict[str, Any]]:
    from src.database import get_system_setting
    raw = await get_system_setting("tiktok_accounts", "[]")
    try:
        data = json.loads(raw or "[]")
        return [a for a in data if isinstance(a, dict) and a.get("key")]
    except Exception:
        return []


async def save_accounts(accounts: List[Dict[str, Any]]) -> None:
    from src.database import set_system_setting
    await set_system_setting("tiktok_accounts", json.dumps(accounts), category="publishing",
                             description="Connected TikTok accounts (metadata only; tokens are in config/tokens)")


async def upsert_account(account: Dict[str, Any]) -> None:
    accounts = await get_accounts()
    for i, a in enumerate(accounts):
        if a["key"] == account["key"]:
            accounts[i] = {**a, **account}
            break
    else:
        accounts.append({"mode": "inbox", "privacy": "SELF_ONLY", "streamers": [], **account})
    await save_accounts(accounts)


async def account_for_streamer(channel_id: str) -> Optional[str]:
    """The TikTok account mapped to a streamer (case/@-insensitive); '*' maps every streamer."""
    want = (channel_id or "").lower().lstrip("@")
    fallback = None
    for a in await get_accounts():
        names = [str(s).lower().lstrip("@") for s in a.get("streamers") or []]
        if want and want in names:
            return a["key"]
        if "*" in names and fallback is None:
            fallback = a["key"]
    return fallback


async def app_credentials() -> Dict[str, str]:
    import os
    from src.database import get_oauth_app_config
    cfg = await get_oauth_app_config("tiktok")
    if cfg and cfg.get("client_id"):
        return {"client_key": cfg["client_id"], "client_secret": cfg.get("client_secret") or ""}
    return {"client_key": os.getenv("TIKTOK_CLIENT_KEY", ""), "client_secret": os.getenv("TIKTOK_CLIENT_SECRET", "")}


async def exchange_code(code: str, redirect_uri: str, code_verifier: Optional[str] = None) -> Dict[str, Any]:
    creds = await app_credentials()
    form = {"client_key": creds["client_key"], "client_secret": creds["client_secret"], "code": code,
            "grant_type": "authorization_code", "redirect_uri": redirect_uri}
    if code_verifier:
        form["code_verifier"] = code_verifier
    async with aiohttp.ClientSession() as s:
        async with s.post(TOKEN_URL, data=form, timeout=aiohttp.ClientTimeout(total=30)) as r:
            data = await r.json(content_type=None)
    if "access_token" not in data:
        raise TikTokError(f"Token exchange failed: {data.get('error_description') or data.get('error') or data}")
    return token_from_response(data)


async def refresh_if_needed(account_key: str, session: aiohttp.ClientSession) -> str:
    tok = load_token(account_key)
    if tok.get("expires_at", 0) > time.time() + 60:
        return tok["access_token"]
    if not tok.get("refresh_token") or tok.get("refresh_expires_at", 0) < time.time():
        raise TikTokError(f"TikTok login for '{account_key}' expired - reconnect the account")
    creds = await app_credentials()
    form = {"client_key": creds["client_key"], "client_secret": creds["client_secret"],
            "grant_type": "refresh_token", "refresh_token": tok["refresh_token"]}
    async with session.post(TOKEN_URL, data=form, timeout=aiohttp.ClientTimeout(total=30)) as r:
        data = await r.json(content_type=None)
    if "access_token" not in data:
        raise TikTokError(f"TikTok token refresh failed: {data.get('error_description') or data.get('error') or data}")
    new = {**tok, **token_from_response(data)}
    save_token(account_key, new)
    return new["access_token"]


# ------------------------------------------------------------------ upload

def chunk_plan(size: int, chunk: int = DEFAULT_CHUNK) -> Dict[str, Any]:
    """TikTok's rules: chunks of 5-64 MB; files under 5 MB go as one chunk; the LAST chunk takes
    the remainder (so total = floor(size / chunk))."""
    if size <= 0:
        raise TikTokError("Empty video file")
    if size < MIN_CHUNK:
        return {"chunk_size": size, "total_chunk_count": 1, "ranges": [(0, size - 1)]}
    chunk = max(MIN_CHUNK, min(MAX_CHUNK, chunk))
    count = max(1, size // chunk)
    ranges = []
    for i in range(count):
        start = i * chunk
        end = size - 1 if i == count - 1 else start + chunk - 1
        ranges.append((start, end))
    return {"chunk_size": chunk, "total_chunk_count": count, "ranges": ranges}


def build_caption(title: str, hashtags: Optional[List[str]]) -> str:
    tags = " ".join(t if t.startswith("#") else f"#{t}" for t in (hashtags or []) if t and t.lower() != "#shorts")
    return f"{title} {tags}".strip()[:2200]


class TikTokPublisher:
    def __init__(self, account_key: str, mode: Optional[str] = None, privacy: Optional[str] = None):
        self.account_key = account_key
        self.mode = mode
        self.privacy = privacy

    async def _api(self, session, method: str, path: str, token: str, payload: Optional[dict] = None) -> Dict[str, Any]:
        async with session.request(method, f"{API}{path}", json=payload or {},
                                   headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json; charset=UTF-8"},
                                   timeout=aiohttp.ClientTimeout(total=60)) as r:
            data = await r.json(content_type=None)
        err = (data or {}).get("error") or {}
        if err.get("code") not in (None, "ok"):
            raise TikTokError(f"{err.get('code')}: {err.get('message') or 'TikTok API error'}")
        return data.get("data") or {}

    async def upload(self, video_path: str, title: str, hashtags: Optional[List[str]] = None) -> Dict[str, Any]:
        path = Path(video_path)
        if not path.exists():
            return {"success": False, "error": f"Video file not found: {video_path}", "account_key": self.account_key}
        meta = next((a for a in await get_accounts() if a["key"] == self.account_key), {})
        mode = self.mode or meta.get("mode") or "inbox"
        privacy = self.privacy or meta.get("privacy") or "SELF_ONLY"
        size = path.stat().st_size
        plan = chunk_plan(size)
        source = {"source": "FILE_UPLOAD", "video_size": size, "chunk_size": plan["chunk_size"],
                  "total_chunk_count": plan["total_chunk_count"]}
        try:
            async with aiohttp.ClientSession() as session:
                token = await refresh_if_needed(self.account_key, session)
                if mode == "direct":
                    info = await self._api(session, "POST", "/v2/post/publish/creator_info/query/", token)
                    options = info.get("privacy_level_options") or ["SELF_ONLY"]
                    level = privacy if privacy in options else ("SELF_ONLY" if "SELF_ONLY" in options else options[0])
                    init = await self._api(session, "POST", "/v2/post/publish/video/init/", token, {
                        "post_info": {"title": build_caption(title, hashtags), "privacy_level": level,
                                      "disable_duet": False, "disable_comment": False, "disable_stitch": False},
                        "source_info": source,
                    })
                else:
                    init = await self._api(session, "POST", "/v2/post/publish/inbox/video/init/", token, {"source_info": source})
                publish_id, upload_url = init.get("publish_id"), init.get("upload_url")
                if not publish_id or not upload_url:
                    raise TikTokError(f"TikTok init returned no upload URL: {init}")

                with open(path, "rb") as f:
                    for start, end in plan["ranges"]:
                        f.seek(start)
                        body = f.read(end - start + 1)
                        async with session.put(upload_url, data=body, headers={
                            "Content-Type": "video/mp4", "Content-Length": str(len(body)),
                            "Content-Range": f"bytes {start}-{end}/{size}",
                        }, timeout=aiohttp.ClientTimeout(total=600)) as r:
                            if r.status not in (200, 201, 206):
                                raise TikTokError(f"Chunk upload failed (HTTP {r.status}): {(await r.text())[:200]}")

                status = await self._wait(session, token, publish_id)
        except TikTokError as e:
            logger.error("TikTok upload failed for %s: %s", self.account_key, e)
            return {"success": False, "error": str(e), "account_key": self.account_key}
        except Exception as e:
            logger.error("TikTok upload error for %s: %s", self.account_key, e)
            return {"success": False, "error": f"TikTok upload error: {e}", "account_key": self.account_key}

        ok = status.get("status") in ("SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "PROCESSING_DOWNLOAD", "PROCESSING_UPLOAD")
        res = {"success": ok, "publish_id": publish_id, "status": status.get("status"), "mode": mode,
               "account_key": self.account_key,
               "note": "Sent to your TikTok inbox - open TikTok to post it." if mode == "inbox" else None}
        if not ok:
            res["error"] = f"TikTok rejected the video: {status.get('fail_reason') or status.get('status')}"
        ids = status.get("publicaly_available_post_id") or status.get("publicly_available_post_id") or []
        if ids:
            res["url"] = f"https://www.tiktok.com/@{meta.get('username') or ''}/video/{ids[0]}".replace("/@/", "/")
        logger.info("TikTok upload for %s: %s (%s)", self.account_key, res.get("status"), mode)
        return res

    async def _wait(self, session, token: str, publish_id: str) -> Dict[str, Any]:
        deadline = time.time() + STATUS_TIMEOUT_S
        last: Dict[str, Any] = {}
        while time.time() < deadline:
            last = await self._api(session, "POST", "/v2/post/publish/status/fetch/", token, {"publish_id": publish_id})
            if last.get("status") in ("SEND_TO_USER_INBOX", "PUBLISH_COMPLETE", "FAILED"):
                return last
            await asyncio.sleep(STATUS_POLL_S)
        return last or {"status": "PROCESSING_UPLOAD"}
