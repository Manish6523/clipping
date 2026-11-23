"""Instagram account REST API routes."""

import logging
from aiohttp import web
from src.publisher import instagram_accounts

logger = logging.getLogger(__name__)


async def ig_list_accounts(request: web.Request) -> web.Response:
    accounts = await instagram_accounts.get_accounts()
    out = []
    for a in accounts:
        connected = False
        try:
            tok = instagram_accounts.load_token(a["key"])
            connected = bool(tok.get("settings") or tok.get("username"))
        except Exception:
            connected = False
        out.append({**a, "connected": connected})
    return web.json_response({"accounts": out})


async def ig_connect_account(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    username = (data.get("username") or "").strip().lstrip("@")
    password = data.get("password") or ""
    verification_code = data.get("verification_code") or None
    account_key = (data.get("account_key") or username).strip().lower()
    account_key = "".join(ch for ch in account_key if ch.isalnum() or ch in "_-")[:40]

    if not username:
        return web.json_response({"error": "Username is required"}, status=400)
    if not account_key:
        return web.json_response({"error": "Account key is required"}, status=400)

    res = await instagram_accounts.authenticate_account(
        account_key=account_key,
        username=username,
        password=password,
        verification_code=verification_code,
        proxy=data.get("proxy"),
    )

    if res.get("success"):
        user = res.get("user") or {}
        await instagram_accounts.upsert_account({
            "key": account_key,
            "username": user.get("username") or username,
            "display_name": user.get("full_name") or username,
            "avatar": user.get("profile_pic_url"),
            "user_id": user.get("pk"),
            "connected": True,
        })
        return web.json_response({
            "success": True,
            "account": {
                "key": account_key,
                "username": user.get("username") or username,
                "display_name": user.get("full_name") or username,
                "avatar": user.get("profile_pic_url"),
                "connected": True,
            },
        })

    return web.json_response(res, status=400 if res.get("status") in ("bad_password", "rate_limited", "error") else 200)


async def ig_import_account(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON body"}, status=400)

    username = (data.get("username") or "").strip().lstrip("@")
    session_data = data.get("session_data") or {}
    account_key = (data.get("account_key") or username).strip().lower()
    account_key = "".join(ch for ch in account_key if ch.isalnum() or ch in "_-")[:40]

    if not username:
        return web.json_response({"success": False, "status": "invalid", "message": "Enter the Instagram username.",
                                  "error": "Username is required"}, status=400)
    if not session_data:
        return web.json_response({"success": False, "status": "invalid_session", "message": "Paste your Instagram session first.",
                                  "error": "Session data is required"}, status=400)

    try:
        res = await instagram_accounts.import_session(
            account_key=account_key, username=username, session_data=session_data)
    except Exception as e:  # import_session reports its own errors; this is a last resort
        logger.exception("Instagram import crashed")
        res = {"success": False, "status": "error", "message": f"Import failed on the server: {e}"}

    if res.get("success"):
        user = res.get("user") or {}
        await instagram_accounts.upsert_account({
            "key": account_key,
            "username": user.get("username") or username,
            "display_name": user.get("full_name") or username,
            "avatar": user.get("profile_pic_url"),
            "user_id": user.get("pk"),
            "connected": True,
        })
        return web.json_response({
            "success": True,
            "account": {
                "key": account_key,
                "username": user.get("username") or username,
                "display_name": user.get("full_name") or username,
                "avatar": user.get("profile_pic_url"),
                "connected": True,
            },
        })

    return web.json_response({**res, "error": res.get("message")}, status=400)


async def ig_patch_account(request: web.Request) -> web.Response:
    key = request.match_info["key"]
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)

    accounts = await instagram_accounts.get_accounts()
    acc = next((a for a in accounts if a["key"] == key), None)
    if not acc:
        return web.json_response({"error": "Unknown Instagram account"}, status=404)

    if "streamers" in data:
        acc["streamers"] = [str(s).strip() for s in data["streamers"] if str(s).strip()][:50]
    if "display_name" in data:
        acc["display_name"] = str(data["display_name"]).strip()[:64]

    await instagram_accounts.save_accounts(accounts)
    return web.json_response({"success": True, "account": acc})


async def ig_delete_account(request: web.Request) -> web.Response:
    key = request.match_info["key"]
    accounts = [a for a in await instagram_accounts.get_accounts() if a["key"] != key]
    await instagram_accounts.save_accounts(accounts)
    instagram_accounts.token_path(key).unlink(missing_ok=True)
    return web.json_response({"success": True, "deleted": key})


def register_instagram_routes(app: web.Application) -> None:
    app.router.add_get("/api/instagram/accounts", ig_list_accounts)
    app.router.add_post("/api/instagram/accounts/connect", ig_connect_account)
    app.router.add_post("/api/instagram/accounts/import", ig_import_account)
    app.router.add_patch("/api/instagram/accounts/{key}", ig_patch_account)
    app.router.add_delete("/api/instagram/accounts/{key}", ig_delete_account)
