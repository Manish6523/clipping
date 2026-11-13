"""Central In-Memory Log Buffer & Live Pipeline Event Tracker for AutoClipDaemon."""

import logging
import time
from collections import deque
from typing import Any, Dict, List, Optional

# Structured log store (retaining last 300 logs)
MAX_LOGS = 300
_log_buffer: deque = deque(maxlen=MAX_LOGS)
_log_counter = 0

# Active Pipeline Generation State Tracker (dictionary mapping channel_id -> progress state)
_active_pipelines: Dict[str, Dict[str, Any]] = {}
_active_pipeline: Dict[str, Any] = {
    "status": "idle",
    "channel_id": None,
    "trigger_reason": None,
    "current_step": 0,
    "total_steps": 5,
    "step_name": "Idle - Awaiting Stream Moments",
    "started_at": 0.0,
    "clip_id": None,
    "error_message": None,
}

# Live Streamers Status & Real-Time Telemetry Cache
_streamer_statuses: Dict[str, Dict[str, Any]] = {}
_streamer_telemetry: Dict[str, deque] = {}  # channel -> deque of {t, mps, baseline_mps, audio_db, is_spike}


class WebLogHandler(logging.Handler):
    """Custom logging handler feeding structured logs into the Web UI buffer."""

    def emit(self, record: logging.LogRecord) -> None:
        global _log_counter
        try:
            msg = self.format(record)
            _log_counter += 1

            # Extract clean component tag
            logger_name = record.name
            if "live_watcher" in logger_name:
                component = "LIVE"
            elif "vod_watcher" in logger_name:
                component = "VOD"
            elif "viral_scorer" in logger_name or "transcriber" in logger_name or "intelligence" in logger_name:
                component = "AI"
            elif "renderer" in logger_name or "ass_generator" in logger_name or "compositor" in logger_name:
                component = "RENDER"
            elif "bot" in logger_name:
                component = "BOT"
            elif "scheduler" in logger_name or "publisher" in logger_name:
                component = "PUBLISH"
            elif "server" in logger_name or "web" in logger_name:
                component = "WEB"
            else:
                component = "CORE"

            level = record.levelname
            t_str = time.strftime("%H:%M:%S", time.localtime(record.created))

            _log_buffer.append({
                "id": _log_counter,
                "time": t_str,
                "level": level,
                "component": component,
                "message": record.getMessage(),
            })
        except Exception:
            self.handleError(record)


def get_recent_logs(since_id: int = 0) -> List[Dict[str, Any]]:
    """Retrieve logs newer than since_id."""
    if since_id == 0:
        return list(_log_buffer)
    return [entry for entry in _log_buffer if entry["id"] > since_id]


def update_pipeline_progress(
    status: str,
    channel_id: Optional[str] = None,
    step: int = 0,
    step_name: str = "",
    trigger_reason: Optional[str] = None,
    clip_id: Optional[int] = None,
    error: Optional[str] = None,
) -> None:
    """Update global and per-channel live progress state for Web UI display."""
    global _active_pipeline, _active_pipelines
    _active_pipeline["status"] = status
    if channel_id is not None:
        _active_pipeline["channel_id"] = channel_id
    if trigger_reason is not None:
        _active_pipeline["trigger_reason"] = trigger_reason
    _active_pipeline["current_step"] = step
    _active_pipeline["step_name"] = step_name
    if status == "triggered":
        _active_pipeline["started_at"] = time.time()
    if clip_id is not None:
        _active_pipeline["clip_id"] = clip_id
    if error is not None:
        _active_pipeline["error_message"] = error

    # Also update per-channel pipeline tracking
    if channel_id:
        c_key = channel_id.lower()
        if status in ("idle", "completed") and step == 0:
            _active_pipelines.pop(c_key, None)
        else:
            _active_pipelines[c_key] = {
                "channel_id": channel_id,
                "status": status,
                "current_step": step,
                "step_name": step_name,
                "trigger_reason": trigger_reason,
                "error_message": error,
                "updated_at": time.time(),
            }


def get_pipeline_state() -> Dict[str, Any]:
    """Get active pipeline status for dashboard banner along with all active pipelines."""
    now = time.time()
    # Prune stale pipelines older than 5 minutes
    active_list = [
        p for p in _active_pipelines.values()
        if (now - p.get("updated_at", now)) < 300
    ]
    state = dict(_active_pipeline)
    state["active_pipelines"] = active_list
    return state


def update_streamer_status(
    channel_id: str,
    platform: str,
    is_live: bool,
    current_mps: float = 0.0,
    chunks_count: int = 0,
    audio_peak_db: Optional[float] = None,
    recent_mps: Optional[float] = None,
    is_spike: bool = False,
) -> None:
    """Update live streaming presence and buffer metrics with rolling telemetry."""
    cid = channel_id.lower()
    now_t = time.time()
    t_clock = time.strftime("%H:%M:%S", time.localtime(now_t))

    _streamer_statuses[cid] = {
        "channel_id": channel_id,
        "platform": platform,
        "is_live": is_live,
        "current_mps": round(current_mps, 2),
        "recent_mps": round(recent_mps if recent_mps is not None else current_mps, 2),
        "audio_peak_db": round(audio_peak_db, 2) if audio_peak_db is not None else None,
        "chunks_count": chunks_count,
        "last_checked": t_clock,
    }

    if cid not in _streamer_telemetry:
        _streamer_telemetry[cid] = deque(maxlen=60)  # Keep last 60 points (5-10 mins history)

    _streamer_telemetry[cid].append({
        "time": t_clock,
        "timestamp": now_t,
        "mps": round(recent_mps if recent_mps is not None else current_mps, 2),
        "baseline_mps": round(current_mps, 2),
        "audio_db": round(audio_peak_db, 1) if audio_peak_db is not None else -45.0,
        "is_spike": is_spike,
    })


def get_all_streamer_statuses() -> Dict[str, Dict[str, Any]]:
    """Get all cached live streamer statuses along with rolling telemetry history."""
    res = {}
    for cid, stat in _streamer_statuses.items():
        res[cid] = {
            **stat,
            "telemetry": list(_streamer_telemetry.get(cid, [])),
        }
    return res

