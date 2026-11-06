"""WebSocket Manager for Real-Time Event Streaming.

Broadcasts events:
  - clip_created
  - clip_updated
  - job_progress
  - channel_status
  - log_message
"""

import asyncio
import json
import logging
from typing import Any, Dict, Set
from aiohttp import web

logger = logging.getLogger(__name__)


class WebSocketManager:
    """Manages active browser WebSocket connections and broadcasts JSON events."""

    def __init__(self):
        self._connections: Set[web.WebSocketResponse] = set()
        self._lock = asyncio.Lock()

    async def handle_ws(self, request: web.Request) -> web.WebSocketResponse:
        """Handle incoming WebSocket connection from frontend."""
        ws = web.WebSocketResponse(heartbeat=25.0)
        await ws.prepare(request)

        async with self._lock:
            self._connections.add(ws)
            logger.info("New WebSocket client connected (total: %d)", len(self._connections))

        try:
            async for msg in ws:
                if msg.type == web.WSMsgType.TEXT:
                    if msg.data == "ping":
                        await ws.send_str("pong")
                elif msg.type == web.WSMsgType.ERROR:
                    logger.debug("WebSocket connection closed with error: %s", ws.exception())
        finally:
            async with self._lock:
                self._connections.discard(ws)
                logger.info("WebSocket client disconnected (remaining: %d)", len(self._connections))

        return ws

    async def broadcast(self, event_type: str, data: Dict[str, Any]) -> None:
        """Broadcast event to all connected UI clients."""
        if not self._connections:
            return

        payload = json.dumps({"event": event_type, "data": data})
        async with self._lock:
            dead = set()
            for ws in self._connections:
                try:
                    await ws.send_str(payload)
                except Exception:
                    dead.add(ws)
            for ws in dead:
                self._connections.discard(ws)


ws_manager = WebSocketManager()

