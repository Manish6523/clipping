"""Shared yt-dlp runner.

Why this exists: on a VPS, YouTube downloads fail in ways that don't happen at home:
  * YouTube's player challenges need a JavaScript runtime. yt-dlp only enables Deno by
    default; servers often have Node.js (or Bun) instead -> we enable whichever exists.
  * Datacenter IPs get "Sign in to confirm you're not a bot" -> a cookies.txt exported from
    a logged-in browser can fix it. Put it at config/tokens/youtube_cookies.txt (or set
    YTDLP_COOKIES) - the Settings page can upload it.
  * When YouTube still blocks the server's IP, the call is retried through free public proxies
    (src/monitor/proxy_pool.py). After a block, calls go through a proxy first for a while.
    YTDLP_PROXY pins one proxy instead; YTDLP_PROXY_FALLBACK=0 turns the pool off.
Every call returns yt-dlp's stderr so failures can be explained instead of swallowed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
import time
from pathlib import Path
from typing import List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_COOKIES = PROJECT_ROOT / "config" / "tokens" / "youtube_cookies.txt"


def cookies_path() -> Optional[Path]:
    env = os.getenv("YTDLP_COOKIES", "").strip()
    for candidate in ([Path(env)] if env else []) + [DEFAULT_COOKIES]:
        try:
            if candidate.is_file() and candidate.stat().st_size > 0:
                return candidate
        except OSError:
            continue
    return None


AUTH_COOKIES = {"SID", "HSID", "SSID", "APISID", "SAPISID", "__Secure-1PSID", "__Secure-3PSID", "LOGIN_INFO"}


def cookies_expiry(path: Optional[Path] = None) -> Optional[float]:
    """Earliest expiry (unix time) of the YouTube login cookies in cookies.txt, if any."""
    path = path or cookies_path()
    if not path:
        return None
    earliest = None
    try:
        for line in path.read_text(errors="ignore").splitlines():
            if line.startswith("#HttpOnly_"):
                line = line[len("#HttpOnly_"):]
            elif line.startswith("#") or not line.strip():
                continue
            parts = line.split("\t")
            if len(parts) < 7 or parts[5] not in AUTH_COOKIES:
                continue
            try:
                exp = float(parts[4])
            except ValueError:
                continue
            if exp > 0 and (earliest is None or exp < earliest):
                earliest = exp
    except OSError:
        return None
    return earliest


def is_bot_check(stderr: str) -> bool:
    low = (stderr or "").lower()
    return ("confirm you" in low and "bot" in low) or "sign in to confirm" in low


def is_blocked(stderr: str) -> bool:
    """Server-side problems (IP block, rate limit, missing runtime) - not a bad link."""
    low = (stderr or "").lower()
    return is_bot_check(stderr) or "http error 429" in low or "too many requests" in low \
        or "challenge solving failed" in low or "javascript runtime" in low or "requested format is not available" in low \
        or "no working proxy found" in low


def js_runtime_args() -> List[str]:
    """yt-dlp enables Deno by default; if Deno is missing, enable Node.js or Bun instead."""
    if shutil.which("deno"):
        return []
    for name in ("node", "bun"):
        path = shutil.which(name)
        if path:
            return ["--js-runtimes", f"{name}:{path}"]
    return []


def base_args(use_cookies: bool = True) -> List[str]:
    args = [
        sys.executable, "-m", "yt_dlp", "--no-warnings",
        "--force-ipv4",
        "--remote-components", "ejs:github",
    ]
    cookies = cookies_path() if use_cookies else None
    if cookies:
        args += ["--cookies", str(cookies)]
    args += js_runtime_args()
    return args


# ---------------------------------------------------------------- proxy fallback
DIRECT_BLOCK_COOLDOWN_S = 30 * 60      # after a block, go through a proxy first for this long
PROXY_ATTEMPTS = 4
_direct_blocked_until = 0.0


def proxy_fallback_enabled() -> bool:
    return os.getenv("YTDLP_PROXY_FALLBACK", "1").strip().lower() not in ("0", "false", "no", "off")


def is_proxy_failure(stderr: str) -> bool:
    """The proxy itself is useless (dead, slow, blocked by YouTube too) - drop it and try another."""
    low = (stderr or "").lower()
    return is_blocked(stderr) or any(s in low for s in (
        "unable to connect to proxy", "proxyerror", "tunnel connection failed", "timed out", "connection reset",
        "remote end closed", "connection refused", "certificate verify failed", "unable to download api page",
        "unable to download webpage", "http error 403"))


async def _exec(cmd: Sequence[str], timeout: Optional[float]) -> Tuple[int, bytes, str]:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return 124, b"", f"yt-dlp timed out after {timeout:.0f}s"
    return proc.returncode or 0, out or b"", (err or b"").decode(errors="ignore")


async def run(args: Sequence[str], timeout: Optional[float] = None) -> Tuple[int, bytes, str]:
    """Run yt-dlp with the shared arguments. Returns (returncode, stdout, stderr-text).

    Direct first; if YouTube blocks this server, retry through proxies from the pool. Login cookies
    are never sent through a free proxy (anyone running one could log them)."""
    global _direct_blocked_until
    pinned = os.getenv("YTDLP_PROXY", "").strip()
    if pinned:
        return await _exec(base_args() + ["--proxy", pinned] + list(args), timeout)

    use_pool = proxy_fallback_enabled()
    direct_err = ""
    if not use_pool or time.time() >= _direct_blocked_until:
        rc, out, err = await _exec(base_args() + list(args), timeout)
        if rc == 0 or not use_pool or not is_blocked(err):
            return rc, out, err
        direct_err = err
        _direct_blocked_until = time.time() + DIRECT_BLOCK_COOLDOWN_S
        logger.warning("YouTube blocked this server's IP (%s); retrying through a proxy.", explain(err)[:120])

    from src.monitor.proxy_pool import POOL
    try:
        await POOL.ensure()
    except Exception as e:                       # sources unreachable etc.
        logger.warning("Proxy pool refresh failed: %s", e)
    budget_end = time.time() + (timeout or 900) * 1.5
    last_err = direct_err
    tried = 0
    for proxy in POOL.candidates(PROXY_ATTEMPTS):
        remaining = budget_end - time.time()
        if remaining < 20:
            break
        tried += 1
        rc, out, err = await _exec(base_args(use_cookies=False) + ["--proxy", proxy, "--socket-timeout", "20"] + list(args),
                                   min(timeout, remaining) if timeout else remaining)
        if rc == 0:
            POOL.mark_good(proxy)
            logger.info("yt-dlp succeeded through proxy %s.", proxy)
            return rc, out, err
        last_err = err
        if is_proxy_failure(err):
            POOL.mark_bad(proxy)
            continue
        return rc, out, err                      # a real answer (private video, bad link...) - no point retrying
    if not tried:
        last_err = (last_err + "\n" if last_err else "") + "ERROR: no working proxy found in the free proxy pool"
    elif direct_err and not is_blocked(last_err):
        last_err = direct_err + "\n" + last_err
    return 1, b"", last_err


def explain(stderr: str) -> str:
    """Turn yt-dlp's stderr into an actionable one-liner for the dashboard / logs."""
    text = stderr or ""
    low = text.lower()
    if "no working proxy found" in low:
        return ("YouTube is blocking this server's IP and none of the free proxies got through right now. "
                "Try again in a few minutes (the proxy list refreshes), or upload fresh cookies in Settings.")
    if is_bot_check(text):
        return ("YouTube is blocking this server's IP ('confirm you're not a bot') and the proxies tried were "
                "blocked too. Try again shortly, or upload a cookies.txt in Settings → YouTube downloads.")
    if "javascript runtime" in low or "js runtime" in low or "challenge solving failed" in low \
            or "n challenge" in low or "only images are available" in low:
        return ("yt-dlp couldn't solve YouTube's player challenge: install Deno (or Node.js) on the server "
                "and run: pip install -U 'yt-dlp[default]'.")
    if "requested format is not available" in low:
        return ("YouTube returned no usable formats - usually an outdated yt-dlp or a blocked IP. Run "
                "pip install -U 'yt-dlp[default]' and, if it persists, add cookies in Settings.")
    if "private video" in low or "members-only" in low or "join this channel" in low:
        return "This video is private or members-only."
    if "video unavailable" in low or "has been removed" in low:
        return "YouTube says this video is unavailable."
    if "age" in low and ("restricted" in low or "confirm your age" in low):
        return "This video is age-restricted: add cookies from a logged-in browser in Settings."
    if "http error 429" in low or "too many requests" in low:
        return "YouTube is rate-limiting this server (HTTP 429). Wait a while or add cookies in Settings."
    if "unsupported url" in low:
        return "That link isn't a supported video URL."
    if "timed out" in low:
        return "The download timed out."
    lines = [ln.strip() for ln in text.splitlines() if "ERROR" in ln or "error" in ln.lower()]
    return (lines[-1] if lines else text.strip().splitlines()[-1] if text.strip() else "yt-dlp failed")[:300]


def status() -> dict:
    """For the Settings page."""
    c = cookies_path()
    runtime = "deno" if shutil.which("deno") else next((n for n in ("node", "bun") if shutil.which(n)), None)
    try:
        import yt_dlp.version as v
        version = v.__version__
    except Exception:
        version = None
    try:
        import yt_dlp_ejs  # noqa: F401  (challenge solver scripts shipped with yt-dlp[default])
        ejs = True
    except Exception:
        ejs = False

    from src.monitor.proxy_pool import POOL
    proxies = {"enabled": bool(os.getenv("YTDLP_PROXY", "").strip()) or proxy_fallback_enabled(),
               "pinned": bool(os.getenv("YTDLP_PROXY", "").strip()),
               "direct_blocked": time.time() < _direct_blocked_until, **POOL.status()}

    return {
        "yt_dlp_version": version,
        "js_runtime": runtime,
        "challenge_solver_installed": ejs,
        "proxy": proxies,
        "cookies": {"present": bool(c), "path": str(c) if c else None,
                    "updated": c.stat().st_mtime if c else None,
                    "expires": cookies_expiry(c) if c else None},
    }
