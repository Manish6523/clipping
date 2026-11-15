import asyncio
import aiosqlite
import pytest
from config.settings import DATABASE_PATH

@pytest.mark.asyncio
async def test_foreign_keys_and_stitched_trigger():
    async with aiosqlite.connect(DATABASE_PATH) as db:
        await db.execute("PRAGMA foreign_keys = ON;")
        
        # 1. Foreign keys test
        cur = await db.execute("PRAGMA foreign_keys;")
        row = await cur.fetchone()
        assert row[0] == 1, "Foreign keys pragma must be active"

        # 2. Insert dummy channel
        await db.execute(
            "INSERT OR IGNORE INTO channels (platform, channel_id_or_handle, template_name, display_name) VALUES (?, ?, ?, ?)",
            ("twitch", "test_story_channel", "default", "Story Test Channel")
        )
        await db.commit()
        cur = await db.execute("SELECT id FROM channels WHERE channel_id_or_handle = ?", ("test_story_channel",))
        row = await cur.fetchone()
        channel_id = row[0]

        # 3. Insert stream session
        await db.execute(
            "INSERT INTO stream_sessions (id, channel_id, is_active) VALUES (?, ?, 1)",
            ("sess_test_123", str(channel_id))
        )

        # 4. Insert story seed
        await db.execute(
            """INSERT INTO story_seeds (session_id, channel_id, kind, quote, summary, snippet_path, transcript_json, stream_epoch_start, duration)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            ("sess_test_123", str(channel_id), "promise", "I will do 10 pushups", "Will do 10 pushups", "/path/test.mp4", "{}", 1000.0, 5.0)
        )
        cur = await db.execute("SELECT last_insert_rowid()")
        seed_id = (await cur.fetchone())[0]

        # 5. Insert stitched clip
        await db.execute(
            """INSERT INTO clips (
                source_type, source_id, channel_id, template_name,
                raw_start, raw_end, adjusted_start, adjusted_end,
                virality_score, title, status, stitched
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                "live", "stream_001", str(channel_id), "default",
                100.0, 130.0, 100.0, 130.0,
                85, "Test Stitched Clip", "pending_approval", 1
            )
        )
        cur = await db.execute("SELECT last_insert_rowid()")
        clip_id = (await cur.fetchone())[0]

        # 6. Insert clip_story_links
        await db.execute(
            """INSERT INTO clip_story_links (clip_id, seed_id, relation, confidence, quotes_json, standalone_score, stitched_score, stitched)
               VALUES (?, ?, ?, ?, ?, ?, ?, 1)""",
            (clip_id, seed_id, "payoff", 0.95, "{}", 6.0, 8.5)
        )

        # 7. Test trigger blocks approval without feedback event
        with pytest.raises(Exception) as excinfo:
            await db.execute("UPDATE clips SET status = 'approved' WHERE id = ?", (clip_id,))
        assert "Stitched clips require an explicit human approval event" in str(excinfo.value)

        # 8. Test trigger blocks direct change to 'queued' or 'publishing'
        with pytest.raises(Exception):
            await db.execute("UPDATE clips SET status = 'queued' WHERE id = ?", (clip_id,))

        with pytest.raises(Exception):
            await db.execute("UPDATE clips SET status = 'publishing' WHERE id = ?", (clip_id,))

        # 9. Insert human approval event
        await db.execute(
            "INSERT INTO clip_feedback_events (clip_id, event, channel_id, payload_json) VALUES (?, 'approved', ?, '{}')",
            (clip_id, str(channel_id))
        )
        # Status change to approved should now succeed
        await db.execute("UPDATE clips SET status = 'approved' WHERE id = ?", (clip_id,))
        cur = await db.execute("SELECT status FROM clips WHERE id = ?", (clip_id,))
        assert (await cur.fetchone())[0] == "approved"

        # 10. Test ON DELETE SET NULL on seed_id
        await db.execute("DELETE FROM story_seeds WHERE id = ?", (seed_id,))
        cur = await db.execute("SELECT seed_id FROM clip_story_links WHERE clip_id = ?", (clip_id,))
        link_seed_id = (await cur.fetchone())[0]
        assert link_seed_id is None, "seed_id in clip_story_links must be SET NULL on seed deletion"

        # Cleanup
        await db.execute("DELETE FROM clip_feedback_events WHERE clip_id = ?", (clip_id,))
        await db.execute("DELETE FROM clip_story_links WHERE clip_id = ?", (clip_id,))
        await db.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
        await db.execute("DELETE FROM stream_sessions WHERE id = ?", ("sess_test_123",))
        await db.execute("DELETE FROM channels WHERE id = ?", (channel_id,))
        await db.commit()
