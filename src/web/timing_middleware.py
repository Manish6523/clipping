"""Web Timing and Request Profiling Middleware.

Logs method, path, HTTP status, execution duration, and response size.
Flags any request taking >300ms as WARNING.
"""

import logging
import time
from aiohttp import web

logger = logging.getLogger("api.timing")


@web.middleware
async def request_timing_middleware(request: web.Request, handler):
    start_time = time.perf_counter()
    response = None
    try:
        response = await handler(request)
        return response
    finally:
        duration_ms = (time.perf_counter() - start_time) * 1000
        status = response.status if response else 500
        size = response.body_length if (response and hasattr(response, "body_length") and response.body_length) else 0

        msg = f"[{request.method}] {request.rel_url} -> {status} ({duration_ms:.1f}ms, {size} bytes)"
        if duration_ms > 300:
            logger.warning("SLOW REQUEST: %s", msg)
        else:
            logger.debug("%s", msg)

