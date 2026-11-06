"""System Health, Metrics, and Diagnostics REST API Router.

Includes:
- GET /api/health (DB latency, queue depth, disk free, memory, uptime)
"""

import asyncio
import logging
import os
import shutil
import time
from pathlib import Path
from aiohttp import web

from config.settings import DATABASE_PATH, DATA_DIR, RENDER_DIR
from src.database import get_db_connection

logger = logging.getLogger(__name__)

SERVER_START_TIME = time.time()


async def get_system_health(request: web.Request) -> web.Response:
    """Return comprehensive system health and resource metrics."""
    # Measure DB latency
    db_start = time.perf_counter()
    db_ok = True
    db_latency_ms = 0.0
    queue_depth = 0
    active_jobs = 0

    try:
        async with get_db_connection() as db:
            cur = await db.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status = 'pending'")
            row = await cur.fetchone()
            queue_depth = row[0] if row else 0

            cur2 = await db.execute("SELECT COUNT(*) FROM pipeline_jobs WHERE status = 'running'")
            row2 = await cur2.fetchone()
            active_jobs = row2[0] if row2 else 0
        db_latency_ms = (time.perf_counter() - db_start) * 1000
    except Exception as e:
        db_ok = False
        db_latency_ms = (time.perf_counter() - db_start) * 1000
        logger.error("Health check DB query failed: %s", e)

    # Disk usage
    total, used, free = shutil.disk_usage(str(DATA_DIR))
    disk_free_gb = round(free / (1024 ** 3), 2)
    disk_total_gb = round(total / (1024 ** 3), 2)

    # Process Memory
    import sys
    mem_mb = 0.0
    try:
        import psutil
        mem_mb = round(psutil.Process().memory_info().rss / (1024 ** 2), 1)
    except ImportError:
        pass

    uptime_s = round(time.time() - SERVER_START_TIME, 1)

    return web.json_response({
        "status": "healthy" if db_ok else "degraded",
        "uptime_seconds": uptime_s,
        "database": {
            "status": "ok" if db_ok else "error",
            "latency_ms": round(db_latency_ms, 2),
            "journal_mode": "WAL",
        },
        "pipeline": {
            "queue_depth": queue_depth,
            "active_jobs": active_jobs,
        },
        "disk": {
            "free_gb": disk_free_gb,
            "total_gb": disk_total_gb,
            "renders_dir": str(RENDER_DIR),
        },
        "memory_mb": mem_mb,
    })


def register_health_routes(app: web.Application):
    app.router.add_get("/api/health", get_system_health)

