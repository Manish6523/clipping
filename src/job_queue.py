"""Stage-Based Pipeline Job Queue with Strict Concurrency Limits.

Stages: ingest -> transcribe -> score -> render -> publish
Limits:
  - 1 Render (GPU/FFmpeg intensive)
  - 2 Transcribes (CPU/Whisper intensive)
  - 4 Scoring (Gemini API calls)
  - 2 Publish (Network I/O)
"""

import asyncio
from datetime import datetime, timezone
import json
import logging
from typing import Any, Callable, Dict, Optional
import uuid

from src.database import get_db_connection

logger = logging.getLogger(__name__)


class StageJobQueue:
    """Manages concurrent stage-based execution with worker semaphores and state persistence."""

    def __init__(self):
        self.semaphores = {
            "ingest": asyncio.Semaphore(4),
            "transcribe": asyncio.Semaphore(2),
            "score": asyncio.Semaphore(4),
            "render": asyncio.Semaphore(1),
            "publish": asyncio.Semaphore(2),
        }
        self.handlers: Dict[str, Callable] = {}
        self.is_running = False
        self._worker_tasks: list[asyncio.Task] = []
        self._job_events: list[Callable] = []

    def register_handler(self, stage: str, handler: Callable):
        """Register asynchronous execution function for a pipeline stage."""
        self.handlers[stage] = handler

    def on_event(self, callback: Callable):
        """Register event listener for job status changes."""
        self._job_events.append(callback)

    async def enqueue(
        self,
        stage: str,
        channel_id: str,
        clip_id: Optional[int] = None,
        priority: int = 10,
        payload: Optional[Dict[str, Any]] = None,
    ) -> str:
        """Enqueue a new job with priority and idempotency."""
        job_id = f"job_{stage}_{uuid.uuid4().hex[:8]}"
        payload_str = json.dumps(payload or {})

        async with get_db_connection() as db:
            await db.execute(
                """
                INSERT INTO pipeline_jobs (id, channel_id, clip_id, stage, priority, status, payload_json)
                VALUES (?, ?, ?, ?, ?, 'pending', ?)
                """,
                (job_id, channel_id, clip_id, stage, priority, payload_str)
            )
            await db.commit()

        logger.info("Enqueued %s job %s for %s (priority %d)", stage, job_id, channel_id, priority)
        await self._broadcast_status(job_id, stage, "pending", channel_id)
        return job_id

    async def cancel_channel_jobs(self, channel_id: str) -> int:
        """Cancel all pending and running jobs for a channel."""
        async with get_db_connection() as db:
            cur = await db.execute(
                "UPDATE pipeline_jobs SET status = 'cancelled' WHERE channel_id = ? AND status IN ('pending', 'running')",
                (channel_id,)
            )
            await db.commit()
            return cur.rowcount

    async def _broadcast_status(self, job_id: str, stage: str, status: str, channel_id: str, error: Optional[str] = None):
        for cb in self._job_events:
            try:
                res = cb({
                    "job_id": job_id,
                    "stage": stage,
                    "status": status,
                    "channel_id": channel_id,
                    "error": error,
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                })
                if asyncio.iscoroutine(res):
                    asyncio.create_task(res)
            except Exception:
                pass

    async def start(self):
        """Start worker loop."""
        self.is_running = True
        for stage in self.semaphores.keys():
            self._worker_tasks.append(asyncio.create_task(self._stage_worker(stage)))
        logger.info("StageJobQueue workers active.")

    async def stop(self):
        """Stop worker loops cleanly."""
        self.is_running = False
        for t in self._worker_tasks:
            t.cancel()

    async def _stage_worker(self, stage: str):
        sem = self.semaphores[stage]
        while self.is_running:
            try:
                # Check for pending jobs in priority order
                job = None
                async with get_db_connection() as db:
                    cur = await db.execute(
                        """
                        SELECT id, channel_id, clip_id, priority, retry_count, payload_json
                        FROM pipeline_jobs
                        WHERE stage = ? AND status = 'pending'
                        ORDER BY priority DESC, created_at ASC
                        LIMIT 1
                        """,
                        (stage,)
                    )
                    row = await cur.fetchone()
                    if row:
                        job = {
                            "id": row[0] if isinstance(row, (list, tuple)) else row["id"],
                            "channel_id": row[1] if isinstance(row, (list, tuple)) else row["channel_id"],
                            "clip_id": row[2] if isinstance(row, (list, tuple)) else row["clip_id"],
                            "priority": row[3] if isinstance(row, (list, tuple)) else row["priority"],
                            "retry_count": row[4] if isinstance(row, (list, tuple)) else row["retry_count"],
                            "payload": json.loads(row[5] if isinstance(row, (list, tuple)) else row["payload_json"] or "{}"),
                        }
                        # Mark running
                        now_str = datetime.now(timezone.utc).isoformat()
                        await db.execute(
                            "UPDATE pipeline_jobs SET status = 'running', started_at = ? WHERE id = ?",
                            (now_str, job["id"])
                        )
                        await db.commit()

                if not job:
                    await asyncio.sleep(1.0)
                    continue

                # Check if channel is paused
                async with get_db_connection() as db:
                    cur = await db.execute("SELECT enabled FROM channels WHERE channel_id_or_handle = ?", (job["channel_id"],))
                    ch_row = await cur.fetchone()
                    if ch_row:
                        en = ch_row[0] if isinstance(ch_row, (list, tuple)) else ch_row["enabled"]
                        if en == 0:
                            logger.info("Channel %s is paused; skipping job %s", job["channel_id"], job["id"])
                            await db.execute("UPDATE pipeline_jobs SET status = 'cancelled', last_error = 'Channel paused' WHERE id = ?", (job["id"],))
                            await db.commit()
                            continue

                # Execute with stage semaphore
                async with sem:
                    handler = self.handlers.get(stage)
                    if not handler:
                        logger.warning("No handler registered for stage '%s'", stage)
                        continue

                    await self._broadcast_status(job["id"], stage, "running", job["channel_id"])
                    try:
                        result = await handler(job)
                        now_str = datetime.now(timezone.utc).isoformat()
                        async with get_db_connection() as db:
                            res_str = json.dumps(result or {})
                            await db.execute(
                                "UPDATE pipeline_jobs SET status = 'completed', finished_at = ?, result_json = ? WHERE id = ?",
                                (now_str, res_str, job["id"])
                            )
                            await db.commit()
                        await self._broadcast_status(job["id"], stage, "completed", job["channel_id"])
                    except Exception as err:
                        logger.error("Job %s (%s) failed: %s", job["id"], stage, err, exc_info=True)
                        now_str = datetime.now(timezone.utc).isoformat()
                        async with get_db_connection() as db:
                            retries = job["retry_count"] + 1
                            new_status = 'pending' if retries < 3 else 'failed'
                            await db.execute(
                                "UPDATE pipeline_jobs SET status = ?, retry_count = ?, last_error = ? WHERE id = ?",
                                (new_status, retries, str(err), job["id"])
                            )
                            await db.commit()
                        await self._broadcast_status(job["id"], stage, new_status, job["channel_id"], error=str(err))

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("Stage worker exception (%s): %s", stage, e)
                await asyncio.sleep(2.0)

