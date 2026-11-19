"""Home fetch helper: yt-dlp runs on the user's own PC when YouTube blocks this server.

The helper (tools/fetch_helper.py) keeps a long-poll open to /api/fetcher/next. When the server
needs YouTube - a lookup, the audio, a clip section, chat - ytdlp.run() hands the job to it, the
helper runs yt-dlp on its home connection and uploads stdout/stderr and the files it made, and
they land exactly where the local yt-dlp would have written them.

Only the job's own yt-dlp options travel (never cookies or the server's paths), and the helper
accepts only an allowlist of options (see ALLOWED_* - kept in sync with tools/fetch_helper.py),
so a compromised server can't make the PC run anything but a plain yt-dlp download.
"""

from __future__ import annotations

import asyncio
import itertools
import logging
import os
import re
import secrets
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

ONLINE_WINDOW_S = 45          # helper counts as online if it polled this recently
PICKUP_TIMEOUT_S = 60         # a job nobody picks up in this long falls back to the server's own path
TOKEN_KEY = "fetcher_token"

# yt-dlp options a job may contain: value-taking and plain flags. Everything else is refused.
ALLOWED_VALUE_OPTS = {"-f", "--format", "--download-sections", "--output", "-o", "--merge-output-format",
                      "--sub-langs", "--print", "--playlist-items"}
ALLOWED_FLAGS = {"--skip-download", "--dump-json", "-j", "--dump-single-json", "-J", "--write-subs",
                 "--simulate", "-s", "--force-overwrites", "--force-keyframes-at-cuts", "--no-playlist"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9_. %()\[\]-]{1,200}$")


def check_args(args: Sequence[str]) -> Optional[str]:
    """None if the job is allowed, else why not. Used on both sides."""
    args = list(args)
    i, urls = 0, 0
    while i < len(args):
        a = str(args[i])
        if a in ALLOWED_VALUE_OPTS:
            if i + 1 >= len(args):
                return f"{a} needs a value"
            if a in ("-o", "--output"):
                name = str(args[i + 1])
                if "/" in name or "\\" in name or ".." in name or not SAFE_NAME.match(name):
                    return f"output must be a bare file name, got {name!r}"
            i += 2
            continue
        if a in ALLOWED_FLAGS:
            i += 1
            continue
        if a.startswith(("http://", "https://")) and not a.startswith("-"):
            urls += 1
            i += 1
            continue
        return f"option not allowed: {a!r}"
    if urls != 1:
        return "exactly one http(s) URL expected"
    return None


class Job:
    _ids = itertools.count(1)

    def __init__(self, args: List[str], dest_dir: Optional[Path]):
        self.id = f"j{next(self._ids)}_{secrets.token_hex(4)}"
        self.args = args
        self.dest_dir = dest_dir
        self.future: asyncio.Future = asyncio.get_running_loop().create_future()
        self.created = time.time()
        self.picked: Optional[float] = None


class RemoteFetcher:
    def __init__(self):
        self.last_seen = 0.0
        self.info: Dict[str, Any] = {}
        self._queue: Optional[asyncio.Queue] = None
        self._jobs: Dict[str, Job] = {}
        self.done = 0
        self.failed = 0

    @property
    def queue(self) -> asyncio.Queue:
        if self._queue is None:
            self._queue = asyncio.Queue()
        return self._queue

    def enabled(self) -> bool:
        return os.getenv("FETCH_HELPER", "1").strip().lower() not in ("0", "false", "no", "off")

    def online(self) -> bool:
        return self.enabled() and time.time() - self.last_seen < ONLINE_WINDOW_S

    # ------------------------------------------------------------ server side (ytdlp.run)
    async def submit(self, args: Sequence[str], timeout: Optional[float]) -> Optional[Tuple[int, bytes, str]]:
        """Run on the helper. None = helper unavailable / gave up (caller falls back)."""
        args = [str(a) for a in args]
        dest_dir = None
        for i, a in enumerate(args[:-1]):
            if a in ("-o", "--output"):
                p = Path(args[i + 1])
                dest_dir, args[i + 1] = p.parent, p.name
        problem = check_args(args)
        if problem:
            logger.info("Not sending to the fetch helper (%s).", problem)
            return None
        job = Job(args, dest_dir)
        self._jobs[job.id] = job
        await self.queue.put(job)
        deadline = time.time() + (timeout or 1800)
        try:
            while True:
                try:
                    return await asyncio.wait_for(asyncio.shield(job.future), 5)
                except asyncio.TimeoutError:
                    now = time.time()
                    if job.picked is None and now - job.created > PICKUP_TIMEOUT_S:
                        logger.warning("Fetch helper didn't pick up job %s in %ds; using the server's own route.",
                                       job.id, PICKUP_TIMEOUT_S)
                        return None
                    if not self.online():
                        logger.warning("Fetch helper went offline during job %s; using the server's own route.", job.id)
                        return None
                    if now > deadline:
                        return 124, b"", f"fetch helper timed out after {timeout or 1800:.0f}s"
        finally:
            self._jobs.pop(job.id, None)

    # ------------------------------------------------------------ helper side (HTTP handlers)
    async def next_job(self, wait: float, slots: int, info: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        self.last_seen = time.time()
        self.info = info
        if slots <= 0:                      # helper busy: just a heartbeat, ask again soon
            await asyncio.sleep(min(wait, 3))
            self.last_seen = time.time()
            return None
        end = time.time() + wait
        while True:
            try:
                job = await asyncio.wait_for(self.queue.get(), max(0.1, end - time.time()))
            except asyncio.TimeoutError:
                self.last_seen = time.time()
                return None
            self.last_seen = time.time()
            if job.id in self._jobs and not job.future.done():     # skip jobs the caller already gave up on
                job.picked = time.time()
                return {"id": job.id, "args": job.args}

    def job(self, job_id: str) -> Optional[Job]:
        return self._jobs.get(job_id)

    def finish(self, job_id: str, rc: int, stdout: bytes, stderr: str) -> None:
        job = self._jobs.get(job_id)
        self.last_seen = time.time()
        if rc == 0:
            self.done += 1
        else:
            self.failed += 1
        if job and not job.future.done():
            job.future.set_result((rc, stdout, stderr))

    def status(self) -> Dict[str, Any]:
        return {"enabled": self.enabled(), "online": self.online(),
                "last_seen": self.last_seen or None, "helper": self.info or None,
                "queued": self.queue.qsize() if self._queue else 0, "running": sum(1 for j in self._jobs.values() if j.picked),
                "done": self.done, "failed": self.failed}


FETCHER = RemoteFetcher()


async def get_token(create: bool = True) -> Optional[str]:
    from src.database import get_system_setting, set_system_setting
    tok = await get_system_setting(TOKEN_KEY)
    if not tok and create:
        tok = secrets.token_urlsafe(24)
        await set_system_setting(TOKEN_KEY, tok, category="youtube", description="Home fetch helper access token")
    return tok


def safe_file_name(name: str) -> Optional[str]:
    name = Path(name or "").name
    return name if name and SAFE_NAME.match(name) and ".." not in name else None
