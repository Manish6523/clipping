"""Telegram alerts for problems that need you (deduplicated so they never spam).

alert(kind, text, key=...) sends one message per key per cooldown. Without a configured
bot it just logs. Sending never raises - an alert must not break the pipeline it reports on.
"""

from __future__ import annotations

import html
import logging
import time
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

ICONS = {
    "download": "📥", "cookies": "🍪", "quota": "📊", "upload": "📤", "disk": "💾",
    "auth": "🔑", "test": "🔔", "retention": "🧹",
}
DEFAULT_COOLDOWN = {
    "download": 3600, "cookies": 6 * 3600, "quota": 6 * 3600, "upload": 1800,
    "disk": 6 * 3600, "auth": 6 * 3600, "retention": 24 * 3600, "test": 0,
}

_bot: Any = None
_last_sent: Dict[str, float] = {}


def configure(bot: Any) -> None:
    """Called once at startup with the AutoClipBot instance."""
    global _bot
    _bot = bot


def _should_send(key: str, cooldown: float) -> bool:
    now = time.time()
    if cooldown and now - _last_sent.get(key, 0.0) < cooldown:
        return False
    _last_sent[key] = now
    return True


async def alert(kind: str, text: str, key: Optional[str] = None, cooldown: Optional[float] = None) -> bool:
    """Send an alert. Returns True if a Telegram message was sent."""
    key = key or f"{kind}:{text[:80]}"
    cooldown = DEFAULT_COOLDOWN.get(kind, 3600) if cooldown is None else cooldown
    if not _should_send(key, cooldown):
        return False
    logger.warning("ALERT [%s] %s", kind, text)
    bot = _bot
    if not bot or not getattr(bot, "bot", None) or not getattr(bot, "admin_id", 0):
        return False
    try:
        await bot.bot.send_message(
            chat_id=bot.admin_id,
            text=f"{ICONS.get(kind, '⚠️')} <b>AutoClip alert</b>\n{html.escape(text)[:3500]}",
            parse_mode="HTML",
            disable_web_page_preview=True,
        )
        return True
    except Exception as e:
        logger.warning("Could not send Telegram alert: %s", e)
        return False


async def download_failed(stderr: str, url: str = "") -> bool:
    """Alert when YouTube blocks the server (not for private/removed videos - that's the link)."""
    from src.monitor import ytdlp
    if not ytdlp.is_blocked(stderr):
        return False
    reason = ytdlp.explain(stderr)
    if ytdlp.is_bot_check(stderr) and ytdlp.cookies_path():
        return await alert("cookies", "YouTube is still asking the server to 'confirm you're not a bot' although "
                                      "cookies.txt is uploaded - the cookies have probably expired or been logged out. "
                                      "Export a fresh cookies.txt and upload it in Settings → YouTube downloads."
                                      + (f"\nVideo: {url}" if url else ""), key="cookies:rejected")
    return await alert("download", f"YouTube download blocked: {reason}" + (f"\nVideo: {url}" if url else ""),
                       key=f"download:{reason[:60]}")


def reset() -> None:
    """Tests only."""
    _last_sent.clear()
