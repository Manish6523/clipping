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
import signal
import sys
import tempfile
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
_direct_blocked_until = 0.0


def direct_blocked() -> bool:
    """True while YouTube is blocking this server (downloads go through free proxies)."""
    return proxy_fallback_enabled() and time.time() < _direct_blocked_until and not os.getenv("YTDLP_PROXY", "").strip()


def proxy_fallback_enabled() -> bool:
    return os.getenv("YTDLP_PROXY_FALLBACK", "1").strip().lower() not in ("0", "false", "no", "off")


def is_proxy_failure(stderr: str) -> bool:
    """The proxy itself is useless (dead, slow, blocked by YouTube too) - drop it and try another."""
    low = (stderr or "").lower()
    return is_blocked(stderr) or any(s in low for s in (
        "unable to connect to proxy", "proxyerror", "tunnel connection failed", "timed out", "connection reset",
        "remote end closed", "connection refused", "certificate verify failed", "unable to download api page",
        "unable to download webpage", "http error 403", "ffmpeg exited with code", "error opening input", "incomplete download",
        "unable to download video data"))


def _kill_tree(proc) -> None:
    """Kill yt-dlp and its ffmpeg children (section downloads run ffmpeg, which would otherwise
    keep downloading through the proxy after yt-dlp is gone)."""
    try:
        os.killpg(proc.pid, signal.SIGKILL)
    except (ProcessLookupError, PermissionError, OSError):
        try:
            proc.kill()
        except ProcessLookupError:
            pass


async def _exec(cmd: Sequence[str], timeout: Optional[float]) -> Tuple[int, bytes, str]:
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                                                start_new_session=True)
    try:
        out, err = await asyncio.wait_for(proc.communicate(), timeout=timeout)
    except asyncio.TimeoutError:
        _kill_tree(proc)
        await proc.communicate()
        return 124, b"", f"yt-dlp timed out after {timeout:.0f}s"
    except asyncio.CancelledError:          # lost a proxy race / caller gave up: don't leave yt-dlp running
        if proc.returncode is None:
            _kill_tree(proc)
            try:                            # reap it, or asyncio complains once the loop closes
                await asyncio.wait_for(asyncio.shield(proc.wait()), 5)
            except BaseException:
                pass
        raise
    return proc.returncode or 0, out or b"", (err or b"").decode(errors="ignore")


INFO_FLAGS = ("--simulate", "-s", "--skip-download", "--dump-json", "-j", "--dump-single-json", "-J")
RACE_WIDTH = 6                 # proxies tried at once (most free proxies are dead, slow or blocked by YouTube)
DOWNLOAD_RACE_WIDTH = 5        # parallel downloads (each a full copy of the section, so a little narrower)
RACE_ROUNDS = 6                # fresh batches of proxies while the time budget lasts


def _is_info_only(args: Sequence[str]) -> bool:
    return any(a in INFO_FLAGS for a in args) and "--download-sections" not in args


def _url_of(args: Sequence[str]) -> Optional[str]:
    return next((a for a in reversed(list(args)) if str(a).startswith(("http://", "https://"))), None)


def _proxy_cmd(proxy: str, args: Sequence[str]) -> List[str]:
    return base_args(use_cookies=False) + ["--proxy", proxy, "--socket-timeout", "20"] + list(args)


OUTPUT_FLAGS = ("-o", "--output")


def _output_of(args: Sequence[str]) -> Optional[int]:
    """Index of the output template value in args, if any."""
    args = list(args)
    for i, a in enumerate(args[:-1]):
        if a in OUTPUT_FLAGS:
            return i + 1
    return None


def _isolated(args: Sequence[str], workdir: Path) -> List[str]:
    """Same command, but writing into `workdir` (each racing proxy gets its own, so two downloads
    of the same file never write over each other)."""
    args = list(args)
    i = _output_of(args)
    if i is not None:
        args[i] = str(workdir / Path(args[i]).name)
    return args


def _adopt(workdir: Path, dest_dir: Path) -> None:
    """Move the winner's finished files into place (skipping yt-dlp's leftovers)."""
    for f in workdir.iterdir():
        if f.is_file() and f.name != DURATION_FILE and f.suffix not in (".part", ".ytdl") and not f.name.endswith((".part", ".temp")):
            os.replace(f, dest_dir / f.name)


DURATION_FILE = ".source_duration"
MEDIA_SKIP = (".part", ".ytdl", ".json", ".vtt", ".srt", ".txt")


def _expected_seconds(args: Sequence[str], workdir: Path) -> Optional[float]:
    """How long the download should be: the requested section (capped at the video's length,
    which yt-dlp wrote to DURATION_FILE), or the whole video. None when unknown (live, odd specs)."""
    try:
        total = float((workdir / DURATION_FILE).read_text().split()[0])
    except (OSError, ValueError, IndexError):
        total = None
    args = list(args)
    if "--download-sections" in args:
        spec = str(args[args.index("--download-sections") + 1]).lstrip("*")
        try:
            a, b = (float(x) for x in spec.split("-", 1))
        except ValueError:
            return None
        if total is None:
            return None                      # live / unknown length: can't tell short from complete
        return max(0.0, min(b, total) - a)
    return total


async def _media_seconds(path: Path) -> Optional[float]:
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL)
        out, _ = await asyncio.wait_for(proc.communicate(), 30)
        return float(out.decode().strip())
    except Exception:
        return None


async def _check_complete(args: Sequence[str], workdir: Path) -> Optional[str]:
    """An error if the proxy dropped mid-download: ffmpeg treats a dropped connection as the end
    of the stream and exits 0, leaving e.g. 56 s of a 67-min video's audio (seen on the VPS)."""
    expected = _expected_seconds(args, workdir)
    files = [f for f in workdir.iterdir() if f.is_file() and f.name != DURATION_FILE and not f.name.endswith(MEDIA_SKIP)]
    if not expected or expected < 5 or not files:
        return None
    got = await _media_seconds(max(files, key=lambda f: f.stat().st_size))
    if got is not None and got < expected * 0.9 - 2:
        return f"ERROR: incomplete download through proxy (got {got:.0f}s of {expected:.0f}s)"
    return None


async def _race(pool, args: Sequence[str], timeout: float, width: int = 0) -> Tuple[Optional[str], Tuple[int, bytes, str]]:
    """Run `args` through several proxies at once; first success wins, the rest are killed.
    Returns (winning proxy, result) or (None, last failure). A non-proxy error (private video,
    bad link) is returned straight away - every proxy would say the same.

    Downloads race too (measured on the VPS: a single free proxy finishes a download well under
    half the time, and which one will is unpredictable). Each runs into its own temp folder; the
    winner's files are moved to the real output path."""
    width = width or RACE_WIDTH
    proxies = pool.candidates(width)
    if not proxies:
        return None, (1, b"", "")
    out_i = _output_of(args)
    dest_dir = Path(list(args)[out_i]).parent if out_i is not None else None
    workdirs: dict = {}
    tasks: dict = {}
    tried: set = set()
    verify = dest_dir is not None and "--skip-download" not in args
    deadline = time.time() + timeout

    def launch(p: str) -> None:
        tried.add(p)
        a = list(args)
        if dest_dir is not None:
            dest_dir.mkdir(parents=True, exist_ok=True)
            workdirs[p] = Path(tempfile.mkdtemp(prefix=f".proxyrace{len(tried)}_", dir=dest_dir))
            a = _isolated(args, workdirs[p])
            if verify:
                a = ["--print-to-file", "%(duration)s", str(workdirs[p] / DURATION_FILE)] + a
        tasks[asyncio.ensure_future(_exec(_proxy_cmd(p, a), max(1.0, deadline - time.time())))] = p

    for p in proxies:
        launch(p)
    last: Tuple[int, bytes, str] = (1, b"", "")
    try:
        while tasks:
            done, _ = await asyncio.wait(list(tasks), return_when=asyncio.FIRST_COMPLETED)
            for t in sorted(done, key=lambda t: t.result()[0] == 0):    # book failures before a winner returns
                proxy = tasks.pop(t)
                res = t.result()
                if res[0] == 0 and verify and proxy in workdirs:
                    problem = await _check_complete(args, workdirs[proxy])
                    if problem:
                        logger.warning("Proxy %s: %s - discarding it.", proxy, problem)
                        res = (1, res[1], problem)
                if res[0] == 0:
                    if proxy in workdirs:
                        _adopt(workdirs[proxy], dest_dir)
                    return proxy, res
                last = res
                if is_proxy_failure(res[2]):
                    pool.mark_bad(proxy)
                    # keep the race full: a dead proxy is replaced at once, so one slow survivor
                    # isn't left to carry a long download alone
                    nxt = next((q for q in pool.candidates(len(tried) + width + RACE_WIDTH) if q not in tried), None)
                    if nxt and deadline - time.time() > 30:
                        launch(nxt)
                else:
                    return proxy, res
    finally:
        for t in tasks:
            t.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        for d in workdirs.values():
            shutil.rmtree(d, ignore_errors=True)
    return None, last


async def run(args: Sequence[str], timeout: Optional[float] = None) -> Tuple[int, bytes, str]:
    """Run yt-dlp with the shared arguments. Returns (returncode, stdout, stderr-text).

    Direct first; if YouTube blocks this server, go through proxies from the pool: lookups and
    downloads race several proxies at once (last-known-good first) and keep the first that finishes. Login cookies are never sent through a free proxy (anyone running one could log them)."""
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
    budget_end = time.time() + max(120.0, (timeout or 900) * 1.5)
    last_err = direct_err
    info_only = _is_info_only(args)
    url = _url_of(args)
    for _round in range(RACE_ROUNDS + 1):
        remaining = budget_end - time.time()
        if remaining < 20:
            break
        try:
            await POOL.ensure()
        except Exception as e:                   # proxy list sources unreachable etc.
            logger.warning("Proxy pool refresh failed: %s", e)
        proxy, (rc, out, err) = await _race(POOL, args, min(timeout or remaining, remaining),
                                            width=RACE_WIDTH if info_only or not url else DOWNLOAD_RACE_WIDTH)
        if proxy and rc == 0:
            POOL.mark_good(proxy)
            logger.info("yt-dlp succeeded through proxy %s.", proxy)
            return rc, out, err
        if not proxy and not err:
            break                                # pool empty
        last_err = err or last_err
        if proxy and is_proxy_failure(err):
            POOL.mark_bad(proxy)
            continue
        if proxy:
            return rc, out, err                  # a real answer (private video, bad link...)
    if not last_err or last_err == direct_err:
        last_err = (direct_err + "\n" if direct_err else "") + "ERROR: no working proxy found in the free proxy pool"
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
