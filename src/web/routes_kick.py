"""Kick: app credentials (for official live status + chat) and the signed chat webhook."""

import logging

from aiohttp import web

from src.monitor import kick

logger = logging.getLogger(__name__)


def _webhook_url(request: web.Request) -> str:
    proto = request.headers.get("X-Forwarded-Proto", request.scheme)
    host = request.headers.get("X-Forwarded-Host", request.host)
    return f"{proto}://{host}/api/kick/webhook"


async def kick_get_config(request: web.Request) -> web.Response:
    cfg = await kick.app_config()
    return web.json_response({"client_id": cfg["client_id"], "has_secret": bool(cfg["client_secret"]),
                              "webhook_url": _webhook_url(request)})


async def kick_save_config(request: web.Request) -> web.Response:
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "Invalid JSON"}, status=400)
    client_id = (data.get("client_id") or "").strip()
    if not client_id:
        return web.json_response({"error": "Client ID is required"}, status=400)
    await kick.save_app_config(client_id, data.get("client_secret"))
    # prove the credentials work right away
    import aiohttp
    async with aiohttp.ClientSession() as s:
        ok = bool(await kick.app_token(s))
    if not ok:
        return web.json_response({"success": False, "error": "Saved, but Kick rejected these credentials."}, status=400)
    return web.json_response({"success": True, "webhook_url": _webhook_url(request)})


async def kick_webhook(request: web.Request) -> web.Response:
    body = await request.read()
    try:
        status = await kick.handle_webhook(request.headers, body)
    except Exception as e:
        logger.warning("Kick webhook error: %s", e)
        status = 500
    return web.Response(status=status)


def register_kick_routes(app: web.Application) -> None:
    app.router.add_get("/api/kick/app-config", kick_get_config)
    app.router.add_put("/api/kick/app-config", kick_save_config)
    app.router.add_post("/api/kick/webhook", kick_webhook)
