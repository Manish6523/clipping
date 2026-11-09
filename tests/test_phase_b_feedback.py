import unittest
import asyncio
import os
import aiosqlite
import json
from src.database_migrations import run_migrations

DB_PATH = "data/test_feedback.db"

class TestPhaseBFeedback(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)
        async with aiosqlite.connect(DB_PATH) as db:
            await run_migrations(db)

    async def asyncTearDown(self):
        if os.path.exists(DB_PATH):
            os.remove(DB_PATH)

    async def test_feedback_event_logging(self):
        # Insert test clip
        async with aiosqlite.connect(DB_PATH) as db:
            await db.execute(
                """INSERT INTO clips (id, channel_id, source_type, source_id, title, template_name, raw_start, raw_end, adjusted_start, adjusted_end, virality_score, status) 
                   VALUES (1, 'streamer_a', 'live', 'src_1', 'Test Clip', 'default', 0.0, 30.0, 0.0, 30.0, 85, 'pending_approval')"""
            )
            # Insert feedback event
            await db.execute(
                "INSERT INTO clip_feedback_events (clip_id, event, channel_id, payload_json) VALUES (?, ?, ?, ?)",
                (1, "rejected", "streamer_a", json.dumps({"reason": "boring", "source": "test"}))
            )
            # Insert reason_tagged event
            await db.execute(
                "INSERT INTO clip_feedback_events (clip_id, event, channel_id, payload_json) VALUES (?, ?, ?, ?)",
                (1, "reason_tagged", "streamer_a", json.dumps({"reason": "bad_start", "source": "retro_tagging_ui"}))
            )
            await db.commit()

            # Query with subquery matching routes_clips.py
            query = """
                SELECT c.id, 
                       (SELECT json_extract(f.payload_json, '$.reason') 
                        FROM clip_feedback_events f 
                        WHERE f.clip_id = c.id AND f.event IN ('rejected', 'reason_tagged') 
                          AND json_extract(f.payload_json, '$.reason') IS NOT NULL 
                        ORDER BY f.id DESC LIMIT 1) as rejection_reason,
                       (SELECT f.event 
                        FROM clip_feedback_events f 
                        WHERE f.clip_id = c.id 
                        ORDER BY f.id DESC LIMIT 1) as last_feedback_event
                FROM clips c WHERE c.id = 1
            """
            cursor = await db.execute(query)
            row = await cursor.fetchone()
            self.assertEqual(row[0], 1)
            self.assertEqual(row[1], "bad_start")
            self.assertEqual(row[2], "reason_tagged")

if __name__ == "__main__":
    unittest.main()
