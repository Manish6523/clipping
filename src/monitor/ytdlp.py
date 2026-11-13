"""Shared yt-dlp runner.

Why this exists: on a VPS, YouTube downloads fail in ways that don't happen at home:
  * YouTube's player challenges need a JavaScript runtime. yt-dlp only enables Deno by
    default; servers often have Node.js (or Bun) instead -> we enable whichever exists.
  * Datacenter IPs get "Sign in to confirm you're not a bot" -> a cookies.txt exported from
    a logged-in browser fixes it. Put it at config/tokens/youtube_cookies.txt (or set
    YTDLP_COOKIES) - the Settings page can upload it.
Every call returns yt-dlp's stderr so failures can be explained instead of swallowed.
"""

from __future__ import annotations

import asyncio
import logging
import os
import shutil
import sys
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


def js_runtime_args() -> List[str]:
    """yt-dlp enables Deno by default; if Deno is missing, enable Node.js or Bun instead."""
    if shutil.which("deno"):
        return []
    for name in ("node", "bun"):
        path = shutil.which(name)
        if path:
            return ["--js-runtimes", f"{name}:{path}"]
    return []


def base_args() -> List[str]:
    args = [sys.executable, "-m", "yt_dlp", "--no-warnings"]
    args += js_runtime_args()
    cookies = cookies_path()
    if cookies:
        args += ["--cookies", str(cookies)]
    return args


async def run(args: Sequence[str], timeout: Optional[float] = None) -> Tuple[int, bytes, str]:
    """Run yt-dlp with the shared arguments. Returns (returncode, stdout, stderr-text)."""
    cmd = base_args() + list(args)
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        proc.kill()
        await proc.communicate()
        return 124, b"", f"yt-dlp timed out after {timeout:.0f}s"
    return proc.returncode or 0, out or b"", (err or b"").decode(errors="ignore")


def explain(stderr: str) -> str:
    """Turn yt-dlp's stderr into an actionable one-liner for the dashboard / logs."""
    text = stderr or ""
    low = text.lower()
    if "confirm you" in low and "bot" in low or "sign in to confirm" in low:
        return ("YouTube is blocking this server's IP ('confirm you're not a bot'). Upload a cookies.txt "
                "from a logged-in browser in Settings → YouTube downloads.")
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
    return {
        "yt_dlp_version": version,
        "js_runtime": runtime,
        "challenge_solver_installed": ejs,
        "cookies": {"present": bool(c), "path": str(c) if c else None,
                    "updated": c.stat().st_mtime if c else None},
    }
