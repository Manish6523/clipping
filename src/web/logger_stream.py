"""Central In-Memory Log Buffer & Live Pipeline Event Tracker for AutoClipDaemon."""

import logging
import time
from collections import deque
from typing import Any, Dict, List, Optional

# Structured log store (retaining last 300 logs)
MAX_LOGS = 300
_log_buffer: deque = deque(maxlen=MAX_LOGS)
_log_counter = 0

# Active Pipeline Generation State Tracker
_active_pipeline: Dict[str, Any] = {
    "status": "idle",  # "idle" | "triggered" | "processing" | "completed" | "error"
    "channel_id": None,
    "trigger_reason": None,
    "current_step": 0,
    "total_steps": 5,
    "step_name": "Idle - Awaiting Stream Moments",
    "started_at": 0.0,
    "clip_id": None,
    "error_message": None,
}

# Live Streamers Status Cache
_streamer_statuses: Dict[str, Dict[str, Any]] = {}


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
    """Update global live progress state for Web UI display."""
    global _active_pipeline
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


def get_pipeline_state() -> Dict[str, Any]:
    """Get active pipeline status for dashboard banner."""
    return dict(_active_pipeline)


def update_streamer_status(channel_id: str, platform: str, is_live: bool, current_mps: float = 0.0, chunks_count: int = 0) -> None:
    """Update live streaming presence and buffer metrics."""
    _streamer_statuses[channel_id.lower()] = {
        "channel_id": channel_id,
        "platform": platform,
        "is_live": is_live,
        "current_mps": round(current_mps, 2),
        "chunks_count": chunks_count,
        "last_checked": time.strftime("%H:%M:%S", time.localtime()),
    }


def get_all_streamer_statuses() -> Dict[str, Dict[str, Any]]:
    """Get all cached live streamer statuses."""
    return dict(_streamer_statuses)

