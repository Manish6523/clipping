"""Instagram account management and session utilities.

Stores account metadata in system setting `instagram_accounts` and session tokens
in `config/tokens/ig_<account_key>.json`.
"""

import asyncio
import json
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional

try:
    from instagrapi import Client
    from instagrapi.exceptions import (
        BadPassword,
        ChallengeRequired,
        RateLimitError,
        TwoFactorRequired,
    )
    HAS_INSTAGRAPI = True
except ImportError:
    Client = None
    BadPassword = Exception
    ChallengeRequired = Exception
    RateLimitError = Exception
    TwoFactorRequired = Exception
    HAS_INSTAGRAPI = False

from config.settings import TOKENS_DIR

logger = logging.getLogger(__name__)


def token_path(account_key: str) -> Path:
    return Path(TOKENS_DIR) / f"ig_{account_key}.json"


def load_token(account_key: str) -> Dict[str, Any]:
    p = token_path(account_key)
    if not p.exists():
        raise FileNotFoundError(f"Instagram token missing for account '{account_key}'")
    return json.loads(p.read_text(encoding="utf-8"))


def save_token(account_key: str, data: Dict[str, Any]) -> None:
    Path(TOKENS_DIR).mkdir(parents=True, exist_ok=True)
    p = token_path(account_key)
    p.write_text(json.dumps(data, indent=2), encoding="utf-8")
    try:
        p.chmod(0o600)
    except OSError:
        pass


async def get_accounts() -> List[Dict[str, Any]]:
    from src.database import get_system_setting
    raw = await get_system_setting("instagram_accounts", "[]")
    try:
        data = json.loads(raw or "[]")
        return [a for a in data if isinstance(a, dict) and a.get("key")]
    except Exception:
        return []


async def save_accounts(accounts: List[Dict[str, Any]]) -> None:
    from src.database import set_system_setting
    await set_system_setting(
        "instagram_accounts",
        json.dumps(accounts),
        category="publishing",
        description="Connected Instagram accounts (metadata only; sessions are in config/tokens)",
    )


async def upsert_account(account: Dict[str, Any]) -> None:
    accounts = await get_accounts()
    for i, a in enumerate(accounts):
        if a["key"] == account["key"]:
            accounts[i] = {**a, **account}
            break
    else:
        accounts.append({"streamers": [], **account})
    await save_accounts(accounts)


async def account_for_streamer(channel_id: str) -> Optional[str]:
    """The Instagram account mapped to a streamer (case/@-insensitive); '*' maps every streamer."""
    want = (channel_id or "").lower().lstrip("@")
    fallback = None
    for a in await get_accounts():
        names = [str(s).lower().lstrip("@") for s in a.get("streamers") or []]
        if want and want in names:
            return a["key"]
        if "*" in names and fallback is None:
            fallback = a["key"]
    return fallback


def _sync_login(
    account_key: str,
    username: str,
    password: Optional[str] = None,
    verification_code: Optional[str] = None,
    proxy: Optional[str] = None,
) -> Dict[str, Any]:
    """Synchronous worker that logs into Instagram or checks cached session."""
    if not HAS_INSTAGRAPI or Client is None:
        raise ImportError("instagrapi is not installed on this system.")

    client = Client()
    client.delay_range = [1, 3]
    if proxy:
        client.set_proxy(proxy)

    tok_file = token_path(account_key)
    data: Dict[str, Any] = {}
    if tok_file.exists():
        try:
            data = json.loads(tok_file.read_text(encoding="utf-8"))
        except Exception:
            data = {}

    session_settings = data.get("settings")
    # If no new password given and we have session settings, verify existing session
    if session_settings and not password and not verification_code:
        try:
            client.set_settings(session_settings)
            client.get_timeline_feed()
            user_info = client.user_info_by_username(username or data.get("username", account_key))
            return {
                "success": True,
                "status": "valid",
                "user": {
                    "pk": str(user_info.pk),
                    "username": user_info.username,
                    "full_name": user_info.full_name,
                    "profile_pic_url": str(user_info.profile_pic_url),
                },
            }
        except Exception as e:
            logger.warning("Session check failed for '%s': %s", account_key, e)

    # Perform fresh login with username & password
    if not password and not data.get("password"):
        raise ValueError("Password is required to authenticate with Instagram.")

    pwd = password or data.get("password")
    clean_username = username.strip().lstrip("@")

    try:
        if verification_code:
            # Completing 2FA
            client.login(clean_username, pwd, verification_code=verification_code)
        else:
            client.login(clean_username, pwd)

        # Login succeeded, extract settings and profile
        settings = client.get_settings()
        user_info = client.user_info_by_username(clean_username)

        save_token(
            account_key,
            {
                "username": clean_username,
                "settings": settings,
                "user_id": str(user_info.pk),
            },
        )

        return {
            "success": True,
            "status": "connected",
            "user": {
                "pk": str(user_info.pk),
                "username": user_info.username,
                "full_name": user_info.full_name,
                "profile_pic_url": str(user_info.profile_pic_url),
            },
        }
    except TwoFactorRequired:
        return {
            "success": False,
            "status": "two_factor_required",
            "message": "Two-Factor Authentication (2FA) is enabled. Please enter your 6-digit 2FA code.",
        }
    except ChallengeRequired as e:
        return {
            "success": False,
            "status": "challenge_required",
            "message": f"Instagram requires a verification challenge ({e}). Open the Instagram app to approve this login, or enter the code sent to your phone/email.",
        }
    except BadPassword:
        return {
            "success": False,
            "status": "bad_password",
            "message": "Incorrect username or password.",
        }
    except RateLimitError:
        return {
            "success": False,
            "status": "rate_limited",
            "message": "Too many login attempts. Please wait a few minutes before trying again.",
        }
    except Exception as e:
        return {
            "success": False,
            "status": "error",
            "message": str(e),
        }


async def authenticate_account(
    account_key: str,
    username: str,
    password: Optional[str] = None,
    verification_code: Optional[str] = None,
    proxy: Optional[str] = None,
) -> Dict[str, Any]:
    """Runs synchronous instagrapi login in a background thread."""
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        _sync_login,
        account_key,
        username,
        password,
        verification_code,
        proxy,
    )


def parse_session_input(raw: Any) -> Dict[str, Any]:
    """What people paste: a settings/session JSON (dict or text), a bare sessionid value, or a
    browser cookie line ("sessionid=...; csrftoken=..."). Returns a dict, or raises ValueError."""
    if isinstance(raw, dict):
        if not raw:
            raise ValueError("The session is empty.")
        return raw
    text = str(raw or "").strip()
    if not text:
        raise ValueError("Paste your Instagram session first.")
    if text.startswith("{"):
        try:
            data = json.loads(text)
        except ValueError:
            raise ValueError("That looks like JSON but it isn't valid - copy the whole file again.")
        if not isinstance(data, dict) or not data:
            raise ValueError("The session JSON is empty.")
        return data
    if "sessionid=" in text:                       # cookie header / document.cookie
        for part in text.split(";"):
            k, _, v = part.strip().partition("=")
            if k.strip() == "sessionid" and v.strip():
                return {"sessionid": v.strip().strip('"')}
        raise ValueError("The cookie text has no sessionid value.")
    token = text.strip('"').strip("'")
    if " " in token or len(token) < 20:
        raise ValueError("That doesn't look like an Instagram sessionid or session JSON.")
    return {"sessionid": token}


def _import_error(e: Exception) -> Dict[str, Any]:
    """Plain-English result for a failed session import (never raises)."""
    name = type(e).__name__
    text = str(e) or name
    low = text.lower()
    if isinstance(e, ImportError):
        return {"success": False, "status": "error", "message": "Instagram support isn't installed on the server (instagrapi missing)."}
    if isinstance(e, ValueError) and name == "ValueError":
        return {"success": False, "status": "invalid_session", "message": text}
    if isinstance(e, ChallengeRequired) or "challenge" in low or "checkpoint" in low:
        return {"success": False, "status": "challenge_required",
                "message": "Instagram wants to verify this login. Open the Instagram app, approve the login, then copy a fresh session and try again."}
    if isinstance(e, RateLimitError) or "wait a few minutes" in low or "please wait" in low or "429" in low:
        return {"success": False, "status": "rate_limited", "message": "Instagram is rate-limiting this server. Wait a few minutes and try again."}
    if name in ("LoginRequired", "ClientUnauthorizedError", "ClientForbiddenError") or "login_required" in low or "401" in low or "403" in low:
        return {"success": False, "status": "session_expired",
                "message": "This session is expired or logged out. Log in to Instagram in your browser again and copy a fresh sessionid."}
    if name in ("ClientConnectionError", "ConnectionError", "ReadTimeout", "Timeout") or "timed out" in low or "connection" in low:
        return {"success": False, "status": "network", "message": "Couldn't reach Instagram from the server. Try again in a minute."}
    return {"success": False, "status": "error", "message": f"Instagram didn't accept this session ({text[:160]})."}


def _sync_import_session(
    account_key: str,
    username: str,
    session_data: Any,
) -> Dict[str, Any]:
    """Import and validate a session (settings JSON, sessionid or cookie line). Never raises."""
    try:
        if not HAS_INSTAGRAPI or Client is None:
            raise ImportError("instagrapi is not installed on this system.")
        session = parse_session_input(session_data)

        client = Client()
        client.delay_range = [1, 3]
        clean_username = (username or session.get("username") or account_key).strip().lstrip("@")

        if "sessionid" in session and len(session) == 1:
            sid = str(session["sessionid"]).strip().strip('"').strip("'")
            logger.info("Logging in to Instagram via sessionid for '%s'...", clean_username)
            if not client.login_by_sessionid(sid):
                raise ValueError("Instagram didn't accept that sessionid. Copy a fresh one from a logged-in browser.")
        else:
            # either {"settings": {...}} or a raw settings dict
            settings = session.get("settings") if isinstance(session.get("settings"), dict) else session
            client.set_settings(settings)
            client.account_info()                 # proves the session works (raises LoginRequired when not)
    except Exception as e:
        logger.warning("Instagram session import for '%s' failed: %s: %s", account_key, type(e).__name__, e)
        return _import_error(e)

    try:
        user_info = client.user_info_by_username(clean_username)
        user_dict = {
            "pk": str(user_info.pk),
            "username": user_info.username,
            "full_name": user_info.full_name,
            "profile_pic_url": str(user_info.profile_pic_url),
        }
    except Exception as e:
        logger.warning("Could not fetch user profile for imported session '%s': %s", clean_username, e)
        user_dict = {
            "pk": str(session.get("user_id") or getattr(client, "user_id", "") or ""),
            "username": clean_username,
            "full_name": clean_username,
            "profile_pic_url": None,
        }

    try:
        save_token(account_key, {"username": clean_username, "settings": client.get_settings(), "user_id": user_dict["pk"]})
    except Exception as e:
        return {"success": False, "status": "error", "message": f"Session works but couldn't be saved on the server: {e}"}

    return {"success": True, "status": "connected", "user": user_dict}


async def import_session(
    account_key: str,
    username: str,
    session_data: Any,
) -> Dict[str, Any]:
    loop = asyncio.get_running_loop()
    return await loop.run_in_executor(
        None,
        _sync_import_session,
        account_key,
        username,
        session_data,
    )

