"""Kick (kick.com) streamers: live status, avatars, and chat via Kick's official API.

- Live status: the official Channels API when a Kick app is configured (client id + secret,
  from KICK_CLIENT_ID / KICK_CLIENT_SECRET or Settings), otherwise Kick's public channel JSON,
  otherwise the watcher's streamlink probe. Recording uses streamlink (it has a Kick plugin).
- Chat: Kick's official event subscriptions. We subscribe to `chat.message.sent` for each
  watched broadcaster; Kick POSTs every message to /api/kick/webhook (the app's webhook URL must
  be set to https://<this server>/api/kick/webhook in the Kick developer portal). Each request is
  verified with Kick's RSA public key before it reaches the chat-spike detector.
"""

from __future__ import annotations

import base64
import json
import logging
import time
from typing import Any, Awaitable, Callable, Dict, Optional

import aiohttp

logger = logging.getLogger(__name__)

API = "https://api.kick.com/public/v1"
TOKEN_URL = "https://id.kick.com/oauth/token"
PUBLIC_CHANNEL = "https://kick.com/api/v2/channels/{slug}"
SETTING = "kick_app"
UA = {"User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AutoClip/1.0", "Accept": "application/json"}

_token: Dict[str, Any] = {}
_public_key: Dict[str, Any] = {}
_listeners: Dict[str, Callable[[str, Optional[str]], Awaitable[None]]] = {}   # slug -> on_message(text, user)
_seen_ids: Dict[str, float] = {}
_subscribed: Dict[int, float] = {}


def slug_of(handle: str) -> str:
    h = (handle or "").strip().lstrip("@")
    if "kick.com/" in h:
        h = h.split("kick.com/", 1)[1]
    return h.split("/")[0].split("?")[0].lower()


async def app_config() -> Dict[str, str]:
    import os
    cid, secret = os.getenv("KICK_CLIENT_ID", ""), os.getenv("KICK_CLIENT_SECRET", "")
    if not (cid and secret):
        try:
            from src.database import get_system_setting
            saved = json.loads(await get_system_setting(SETTING, "") or "{}")
            cid, secret = saved.get("client_id", ""), saved.get("client_secret", "")
        except Exception:
            pass
    return {"client_id": cid or "", "client_secret": secret or ""}


async def save_app_config(client_id: str, client_secret: Optional[str]) -> None:
    from src.database import get_system_setting, set_system_setting
    old = json.loads(await get_system_setting(SETTING, "") or "{}")
    await set_system_setting(SETTING, json.dumps({
        "client_id": client_id.strip(),
        "client_secret": (client_secret or "").strip() or old.get("client_secret", ""),
    }), category="kick")
    _token.clear()
    _subscribed.clear()


async def app_token(session: aiohttp.ClientSession) -> Optional[str]:
    if _token.get("expires_at", 0) > time.time() + 60:
        return _token["token"]
    cfg = await app_config()
    if not (cfg["client_id"] and cfg["client_secret"]):
        return None
    async with session.post(TOKEN_URL, data={"grant_type": "client_credentials", **cfg},
                            timeout=aiohttp.ClientTimeout(total=10)) as resp:
        if resp.status != 200:
            logger.warning("Kick app token failed: HTTP %s", resp.status)
            return None
        data = await resp.json()
    _token.update(token=data.get("access_token"), expires_at=time.time() + float(data.get("expires_in") or 3600))
    return _token["token"]


async def _api(method: str, path: str, **kw) -> Optional[Any]:
    async with aiohttp.ClientSession() as session:
        token = await app_token(session)
        if not token:
            return None
        async with session.request(method, f"{API}{path}", headers={"Authorization": f"Bearer {token}", **UA},
                                   timeout=aiohttp.ClientTimeout(total=10), **kw) as resp:
            if resp.status == 401:
                _token.clear()
            if resp.status == 204:
                return {}
            if resp.status >= 300:
                logger.debug("Kick API %s %s -> HTTP %s", method, path, resp.status)
                return None
            return await resp.json()


def info_from_official(item: Dict[str, Any]) -> Dict[str, Any]:
    stream = item.get("stream") or {}
    return {
        "is_live": bool(stream.get("is_live")),
        "broadcaster_user_id": item.get("broadcaster_user_id"),
        "title": item.get("stream_title") or "",
        "category": (item.get("category") or {}).get("name") or "",
        "viewers": stream.get("viewer_count") or 0,
        "started_at": stream.get("start_time"),
        "preview": stream.get("thumbnail"),
        "avatar": None,
    }


def info_from_public(d: Dict[str, Any]) -> Dict[str, Any]:
    ls = d.get("livestream") or {}
    cats = ls.get("categories") or []
    user = d.get("user") or {}
    return {
        "is_live": bool(ls) and bool(ls.get("is_live", True)),
        "broadcaster_user_id": d.get("user_id") or user.get("id"),
        "display_name": user.get("username"),
        "title": ls.get("session_title") or "",
        "category": (cats[0] or {}).get("name") if cats else "",
        "viewers": ls.get("viewer_count") or 0,
        "started_at": ls.get("created_at") or ls.get("start_time"),
        "preview": ((ls.get("thumbnail") or {}).get("url") if isinstance(ls.get("thumbnail"), dict) else ls.get("thumbnail")),
        "avatar": user.get("profile_pic"),
    }


async def channel_info(handle: str) -> Optional[Dict[str, Any]]:
    """Live status + stream details for a Kick channel, or None if it can't be determined."""
    slug = slug_of(handle)
    try:
        data = await _api("GET", "/channels", params={"slug": slug})
        items = (data or {}).get("data") or []
        if items:
            return info_from_official(items[0])
    except Exception as e:
        logger.debug("Kick official channel lookup failed for %s: %s", slug, e)
    try:
        async with aiohttp.ClientSession(headers=UA) as session:
            async with session.get(PUBLIC_CHANNEL.format(slug=slug), timeout=aiohttp.ClientTimeout(total=8)) as resp:
                if resp.status == 200:
                    return info_from_public(await resp.json(content_type=None))
                logger.debug("Kick public channel %s -> HTTP %s", slug, resp.status)
    except Exception as e:
        logger.debug("Kick public channel lookup failed for %s: %s", slug, e)
    return None


async def avatar(handle: str) -> str:
    info = await channel_info(handle)
    if info and info.get("avatar"):
        return info["avatar"]
    return ""


# ----------------------------------------------------------------------------- chat via webhooks
async def subscribe_chat(broadcaster_user_id: int) -> bool:
    """Make sure Kick sends this broadcaster's chat to our webhook (idempotent, cached 6 h)."""
    if not broadcaster_user_id:
        return False
    bid = int(broadcaster_user_id)
    if _subscribed.get(bid, 0) > time.time() - 6 * 3600:
        return True
    existing = await _api("GET", "/events/subscriptions", params={"broadcaster_user_id": str(bid)})
    if existing is None:
        return False
    if any(s.get("event") == "chat.message.sent" for s in existing.get("data") or []):
        _subscribed[bid] = time.time()
        return True
    res = await _api("POST", "/events/subscriptions", json={
        "broadcaster_user_id": bid, "events": [{"name": "chat.message.sent", "version": 1}], "method": "webhook"})
    items = (res or {}).get("data") or []
    ok = bool(items) and not any(i.get("error") for i in items)
    if ok:
        _subscribed[bid] = time.time()
        logger.info("Kick chat subscription active for broadcaster %s.", bid)
    else:
        logger.warning("Kick chat subscription failed for %s: %s", bid, items or res)
    return ok


def register_listener(slug: str, fn: Callable[[str, Optional[str]], Awaitable[None]]) -> None:
    _listeners[slug_of(slug)] = fn


def unregister_listener(slug: str) -> None:
    _listeners.pop(slug_of(slug), None)


async def _get_public_key(force: bool = False):
    from cryptography.hazmat.primitives import serialization
    if not force and _public_key.get("key") and _public_key.get("at", 0) > time.time() - 86400:
        return _public_key["key"]
    async with aiohttp.ClientSession(headers=UA) as session:
        async with session.get(f"{API}/public-key", timeout=aiohttp.ClientTimeout(total=8)) as resp:
            data = await resp.json(content_type=None)
    pem = ((data or {}).get("data") or {}).get("public_key") or ""
    key = serialization.load_pem_public_key(pem.encode())
    _public_key.update(key=key, at=time.time())
    return key


def verify_signature(public_key, message_id: str, timestamp: str, body: bytes, signature_b64: str) -> bool:
    from cryptography.exceptions import InvalidSignature
    from cryptography.hazmat.primitives import hashes
    from cryptography.hazmat.primitives.asymmetric import padding
    try:
        sig = base64.b64decode(signature_b64 or "")
        public_key.verify(sig, f"{message_id}.{timestamp}.".encode() + body, padding.PKCS1v15(), hashes.SHA256())
        return True
    except (InvalidSignature, ValueError, TypeError):
        return False


async def handle_webhook(headers: Any, body: bytes, public_key=None) -> int:
    """Verify + dispatch one Kick webhook. Returns the HTTP status to answer with."""
    mid = headers.get("Kick-Event-Message-Id", "")
    ts = headers.get("Kick-Event-Message-Timestamp", "")
    sig = headers.get("Kick-Event-Signature", "")
    if not (mid and ts and sig):
        return 400
    key = public_key or await _get_public_key()
    if not verify_signature(key, mid, ts, body, sig):
        if public_key is None:                       # key may have rotated: refetch once
            key = await _get_public_key(force=True)
            if not verify_signature(key, mid, ts, body, sig):
                return 401
        else:
            return 401
    now = time.time()
    if mid in _seen_ids:
        return 200                                   # retries are idempotent
    _seen_ids[mid] = now
    if len(_seen_ids) > 5000:
        for k in [k for k, t in _seen_ids.items() if t < now - 600]:
            _seen_ids.pop(k, None)
    if headers.get("Kick-Event-Type") != "chat.message.sent":
        return 200
    try:
        payload = json.loads(body)
    except ValueError:
        return 400
    slug = slug_of(((payload.get("broadcaster") or {}).get("channel_slug") or (payload.get("broadcaster") or {}).get("username") or ""))
    fn = _listeners.get(slug)
    if fn:
        user = (payload.get("sender") or {}).get("username")
        try:
            await fn(payload.get("content") or "", user)
        except Exception as e:
            logger.debug("Kick chat listener error for %s: %s", slug, e)
    return 200
