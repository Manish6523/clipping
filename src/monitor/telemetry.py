"""Live telemetry for the /telemetry page.

Three things live here, all in memory (cheap enough for a small VPS):
  * a registry of running LiveStreamWatchers - each one reports its own snapshot
    (stream info, recording health, chat + hype-engine state, 2-second samples);
  * the life of every hype moment: triggered -> buffering -> sliced -> queued ->
    transcribing -> judging -> rendering -> clip (or rejected / dropped / error);
  * server health (load, memory, disk) and the processing queue.
Finished moments are also stored in the live_hypes table, so history survives restarts.
"""

from __future__ import annotations

import os
import shutil
import time
from collections import OrderedDict
from typing import Any, Callable, Dict, List, Optional

_WATCHERS: Dict[str, Any] = {}
_MOMENTS: "OrderedDict[str, Dict[str, Any]]" = OrderedDict()
MAX_MOMENTS = 150
_queue_provider: Optional[Callable[[], Dict[str, Any]]] = None
_STARTED = time.time()

# Stage -> (order in the pipeline, final?)
STAGES = {
    "triggered": (1, False), "buffering": (2, False), "sliced": (3, False), "queued": (4, False),
    "transcribing": (5, False), "judging": (6, False), "rendering": (7, False),
    "clip": (8, True), "rejected": (8, True), "dropped": (8, True), "replaced": (8, True), "error": (8, True),
}


# ---------------------------------------------------------------------------
# Registry
# ---------------------------------------------------------------------------

def register_watcher(watcher: Any) -> None:
    _WATCHERS[str(watcher.channel_id).lower()] = watcher


def unregister_watcher(watcher: Any) -> None:
    key = str(watcher.channel_id).lower()
    if _WATCHERS.get(key) is watcher:
        _WATCHERS.pop(key, None)


def set_queue_provider(fn: Callable[[], Dict[str, Any]]) -> None:
    global _queue_provider
    _queue_provider = fn


# ---------------------------------------------------------------------------
# Moments
# ---------------------------------------------------------------------------

def moment_event(moment_id: Optional[str], stage: str, channel_id: Optional[str] = None,
                 note: str = "", **fields: Any) -> None:
    """Record a stage of a hype moment. Never raises."""
    if not moment_id:
        return
    try:
        now = time.time()
        m = _MOMENTS.get(moment_id)
        if m is None:
            m = {"id": moment_id, "channel_id": channel_id, "created_at": now, "stage": stage,
                 "stages": [], "final": False}
            _MOMENTS[moment_id] = m
            while len(_MOMENTS) > MAX_MOMENTS:
                _MOMENTS.popitem(last=False)
        if channel_id and not m.get("channel_id"):
            m["channel_id"] = channel_id
        m["stage"] = stage
        m["updated_at"] = now
        m["final"] = STAGES.get(stage, (0, False))[1]
        m["stages"].append({"stage": stage, "t": now, "note": note})
        for k, v in fields.items():
            if v is not None:
                m[k] = v
    except Exception:
        pass


def get_moments(channel_id: Optional[str] = None, limit: int = 60) -> List[Dict[str, Any]]:
    items = [m for m in reversed(_MOMENTS.values())
             if not channel_id or (m.get("channel_id") or "").lower() == channel_id.lower()]
    return items[:limit]


# ---------------------------------------------------------------------------
# Server health
# ---------------------------------------------------------------------------

def _meminfo() -> Dict[str, int]:
    out: Dict[str, int] = {}
    try:
        with open("/proc/meminfo", encoding="utf-8") as f:
            for line in f:
                k, v = line.split(":", 1)
                out[k] = int(v.strip().split()[0]) * 1024
    except Exception:
        pass
    return out


def _proc_rss() -> Optional[int]:
    try:
        with open("/proc/self/status", encoding="utf-8") as f:
            for line in f:
                if line.startswith("VmRSS:"):
                    return int(line.split()[1]) * 1024
    except Exception:
        return None
    return None


def system_snapshot() -> Dict[str, Any]:
    cpus = os.cpu_count() or 1
    try:
        load1, load5, load15 = os.getloadavg()
    except Exception:
        load1 = load5 = load15 = 0.0
    mem = _meminfo()
    total = mem.get("MemTotal", 0)
    avail = mem.get("MemAvailable", 0)
    swap_total = mem.get("SwapTotal", 0)
    swap_free = mem.get("SwapFree", 0)
    try:
        du = shutil.disk_usage(".")
        disk = {"total": du.total, "used": du.used, "free": du.free}
    except Exception:
        disk = {}
    whisper = {}
    try:
        import config.settings as s
        from src.intelligence import transcriber as tr
        slots = tr._whisper_slots()
        limit = max(1, int(getattr(s, "WHISPER_CONCURRENCY", 1) or 1))
        whisper = {
            "model": getattr(s, "WHISPER_MODEL", None),
            "live_model": getattr(s, "LIVE_WHISPER_MODEL", None),
            "busy": limit - slots._value,
            "slots": limit,
        }
    except Exception:
        pass
    return {
        "cpus": cpus,
        "load": [round(load1, 2), round(load5, 2), round(load15, 2)],
        "load_pct": round(min(100.0, load1 / cpus * 100), 1),
        "mem_total": total, "mem_available": avail,
        "mem_used_pct": round((1 - avail / total) * 100, 1) if total else None,
        "swap_used": max(0, swap_total - swap_free),
        "app_rss": _proc_rss(),
        "disk": disk,
        "whisper": whisper,
        "app_uptime_s": round(time.time() - _STARTED),
    }


# ---------------------------------------------------------------------------
# Snapshot
# ---------------------------------------------------------------------------

def snapshot(series_seconds: int = 1800) -> Dict[str, Any]:
    streamers = []
    for key, w in list(_WATCHERS.items()):
        try:
            streamers.append(w.telemetry_snapshot(series_seconds=series_seconds))
        except Exception as e:  # a broken watcher must not break the page
            streamers.append({"channel_id": key, "error": str(e)})
    try:
        queue = _queue_provider() if _queue_provider else {}
    except Exception:
        queue = {}
    return {
        "server_time": time.time(),
        "streamers": streamers,
        "moments": get_moments(limit=80),
        "queue": queue,
        "system": system_snapshot(),
    }
