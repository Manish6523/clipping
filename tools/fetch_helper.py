#!/usr/bin/env python3
"""AutoClip home fetch helper: runs YouTube downloads on THIS computer for the AutoClip server.

YouTube blocks most cloud servers ("confirm you're not a bot"). Your home internet isn't blocked,
so while this runs the server sends its yt-dlp jobs (video lookups, audio, clip sections, chat)
here; they're downloaded on your connection and uploaded back. When it's off, the server falls
back to its own (slow) routes - nothing breaks.

Setup (once):
    pip install -U requests "yt-dlp[default]"
Run (copy the exact command, with your token, from the server's Settings > YouTube downloads):
    python fetch_helper.py --server https://clip.example.com --token YOUR_TOKEN

Safety: only plain yt-dlp download options from a fixed allowlist are accepted, output always goes
to a temporary folder, and nothing else is ever executed - even a compromised server can't make
this computer run arbitrary commands. Your browser cookies are never read or sent.
"""

from __future__ import annotations

import argparse
import json
import os
import platform
import re
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

VERSION = "1.0"

# Keep in sync with src/monitor/remote_fetch.py (a test checks they match).
ALLOWED_VALUE_OPTS = {"-f", "--format", "--download-sections", "--output", "-o", "--merge-output-format",
                      "--sub-langs", "--print", "--playlist-items"}
ALLOWED_FLAGS = {"--skip-download", "--dump-json", "-j", "--dump-single-json", "-J", "--write-subs",
                 "--simulate", "-s", "--force-overwrites", "--force-keyframes-at-cuts", "--no-playlist"}
SAFE_NAME = re.compile(r"^[A-Za-z0-9_. %()\[\]-]{1,200}$")
JOB_TIMEOUT_S = 3600


def check_args(args):
    """None if the job is allowed, else why not."""
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


def log(msg):
    print(time.strftime("%H:%M:%S"), msg, flush=True)


def yt_dlp_version():
    try:
        import yt_dlp.version
        return yt_dlp.version.__version__
    except Exception:
        return "missing"


class Helper:
    def __init__(self, server, token, workers, name):
        import requests
        self.requests = requests
        self.server = server.rstrip("/")
        self.workers = max(1, workers)
        self.running = 0
        self.lock = threading.Lock()
        self.session = requests.Session()
        self.session.headers.update({"Authorization": f"Bearer {token}", "X-Helper-Name": name,
                                     "X-Helper-Version": VERSION, "X-Helper-YtDlp": yt_dlp_version()})

    def run_job(self, job):
        jid, args = job["id"], list(job["args"])
        work = Path(tempfile.mkdtemp(prefix="autoclip_fetch_"))
        rc, out, err = 1, b"", ""
        try:
            problem = check_args(args)
            if problem:
                log(f"REFUSED job {jid}: {problem}")
                rc, err = 1, f"ERROR: fetch helper refused the job: {problem}"
            else:
                url = next(a for a in args if a.startswith(("http://", "https://")))
                what = "lookup" if any(a in args for a in ("--dump-json", "--simulate", "-J", "--skip-download")) else "download"
                sec = args[args.index("--download-sections") + 1] if "--download-sections" in args else ""
                log(f"job {jid}: {what} {sec} {url}")
                t = time.time()
                cmd = [sys.executable, "-m", "yt_dlp", "--no-warnings", "--no-progress", "--paths", str(work)] + args
                p = subprocess.run(cmd, cwd=work, capture_output=True, timeout=JOB_TIMEOUT_S)
                rc, out, err = p.returncode, p.stdout, p.stderr.decode(errors="ignore")
                size = sum(f.stat().st_size for f in work.rglob("*") if f.is_file())
                log(f"job {jid}: {'ok' if rc == 0 else 'FAILED'} in {time.time() - t:.0f}s, {size / 1e6:.1f} MB"
                    + ("" if rc == 0 else f" - {(err.strip().splitlines() or [''])[-1][:160]}"))
        except subprocess.TimeoutExpired:
            rc, err = 124, f"fetch helper: yt-dlp timed out after {JOB_TIMEOUT_S}s"
        except Exception as e:
            rc, err = 1, f"fetch helper error: {e}"
        try:
            self.upload(jid, rc, out, err, work)
        finally:
            shutil.rmtree(work, ignore_errors=True)
            with self.lock:
                self.running -= 1

    def upload(self, jid, rc, out, err, work):
        files = [f for f in work.iterdir() if f.is_file() and not f.name.endswith((".part", ".ytdl", ".temp"))] if rc == 0 else []
        for attempt in range(5):
            handles = []
            try:
                parts = [("meta", ("meta.json", json.dumps({"rc": rc, "stderr": err[-20000:]}), "application/json")),
                         ("stdout", ("stdout", out, "application/octet-stream"))]
                for f in files:
                    fh = open(f, "rb")
                    handles.append(fh)
                    parts.append(("file", (f.name, fh, "application/octet-stream")))
                r = self.session.post(f"{self.server}/api/fetcher/result/{jid}", files=parts, timeout=600)
                if r.status_code in (200, 410):
                    return
                log(f"upload of {jid} got HTTP {r.status_code}; retrying")
            except Exception as e:
                log(f"upload of {jid} failed ({e}); retrying")
            finally:
                for fh in handles:
                    fh.close()
            time.sleep(3 * (attempt + 1))

    def loop(self):
        log(f"AutoClip fetch helper {VERSION} (yt-dlp {yt_dlp_version()}) -> {self.server}, {self.workers} at a time")
        backoff = 2
        announced = False
        while True:
            with self.lock:
                slots = self.workers - self.running
            try:
                r = self.session.get(f"{self.server}/api/fetcher/next", params={"wait": 25, "slots": slots}, timeout=60)
                if r.status_code == 401:
                    log("The server rejected the token. Copy the current command from Settings > YouTube downloads.")
                    time.sleep(30)
                    continue
                r.raise_for_status()
                if not announced:
                    log("Connected. Waiting for jobs (leave this running).")
                    announced = True
                backoff = 2
                job = r.json().get("job")
                if job:
                    with self.lock:
                        self.running += 1
                    threading.Thread(target=self.run_job, args=(job,), daemon=True).start()
            except self.requests.RequestException as e:
                log(f"server unreachable ({e.__class__.__name__}); retrying in {backoff}s")
                announced = False
                time.sleep(backoff)
                backoff = min(backoff * 2, 60)


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--server", default=os.getenv("AUTOCLIP_SERVER"), help="e.g. https://clip.example.com")
    ap.add_argument("--token", default=os.getenv("AUTOCLIP_FETCH_TOKEN"), help="from Settings > YouTube downloads")
    ap.add_argument("--workers", type=int, default=4, help="downloads at once (default 4)")
    ap.add_argument("--name", default=platform.node() or "home PC", help="shown on the server")
    a = ap.parse_args()
    if not a.server or not a.token:
        ap.error("--server and --token are required (or AUTOCLIP_SERVER / AUTOCLIP_FETCH_TOKEN)")
    if yt_dlp_version() == "missing":
        sys.exit('yt-dlp is not installed for this Python: pip install -U requests "yt-dlp[default]"')
    if not shutil.which("ffmpeg"):
        log("WARNING: ffmpeg not found - clip sections need it. Install ffmpeg and restart this helper.")
    try:
        Helper(a.server, a.token, a.workers, a.name).loop()
    except KeyboardInterrupt:
        log("stopped")


if __name__ == "__main__":
    main()
