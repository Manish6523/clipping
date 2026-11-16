"""Session Storyline DAO and lifecycle operations.

Handles:
- Stream session tracking (open, close with 35m grace period)
- Seed snippet staging and confirmation
- Pattern performance logging and auto-pruning (<20% confirm after 50 hits)
- Staged snippets cleanup / expiration
"""

import os
import json
import logging
from datetime import datetime, timezone, timedelta
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from config.settings import (
    STORY_SEEDS_DIR,
)
import config.settings as _cfg  # read at call time (Settings page changes them live)
from src.database import get_db_connection

logger = logging.getLogger(__name__)


async def get_or_create_active_session(channel_id: str) -> Optional[Dict[str, Any]]:
    """Retrieve existing active session for channel or create a new one.
    
    If the session recently ended within STORY_SESSION_GRACE_MINUTES (default 35),
    it is reopened to handle brief stream disconnects seamlessly.
    """
    async with get_db_connection() as db:
        # Check active session
        cur = await db.execute(
            """SELECT id, channel_id, started_at, ended_at, is_active
               FROM stream_sessions
               WHERE channel_id = ? AND is_active = 1
               ORDER BY started_at DESC LIMIT 1""",
            (str(channel_id),)
        )
        row = await cur.fetchone()
        if row:
            session_dict = dict(row)
            # Ensure session staging and seeds directories exist
            session_dir = STORY_SEEDS_DIR / session_dict["id"]
            (session_dir / "staging").mkdir(parents=True, exist_ok=True)
            return session_dict

        # Check for recently ended session within grace period
        cur = await db.execute(
            """SELECT id, channel_id, started_at, ended_at, is_active
               FROM stream_sessions
               WHERE channel_id = ? AND is_active = 0 AND ended_at IS NOT NULL
               ORDER BY ended_at DESC LIMIT 1""",
            (str(channel_id),)
        )
        row = await cur.fetchone()
        if row:
            sess = dict(row)
            try:
                ended_at = datetime.fromisoformat(sess["ended_at"].replace("Z", "+00:00"))
                if ended_at.tzinfo is None:
                    ended_at = ended_at.replace(tzinfo=timezone.utc)
                now = datetime.now(timezone.utc)
                if (now - ended_at) <= timedelta(minutes=_cfg.STORY_SESSION_GRACE_MINUTES):
                    logger.info("Reopening session %s within %d min grace period", sess["id"], _cfg.STORY_SESSION_GRACE_MINUTES)
                    await db.execute(
                        "UPDATE stream_sessions SET is_active = 1, ended_at = NULL WHERE id = ?",
                        (sess["id"],)
                    )
                    await db.commit()
                    sess["is_active"] = 1
                    sess["ended_at"] = None
                    session_dir = STORY_SEEDS_DIR / sess["id"]
                    (session_dir / "staging").mkdir(parents=True, exist_ok=True)
                    return sess
            except Exception as e:
                logger.warning("Failed parsing ended_at timestamp for session %s: %s", sess["id"], e)

        # Create new session
        new_id = f"sess_{datetime.now(timezone.utc).strftime('%Y%m%d_%H%M%S')}_{str(channel_id)[:8]}"
        await db.execute(
            "INSERT INTO stream_sessions (id, channel_id, is_active) VALUES (?, ?, 1)",
            (new_id, str(channel_id))
        )
        await db.commit()
        logger.info("Created new stream session %s for channel %s", new_id, channel_id)

        session_dir = STORY_SEEDS_DIR / new_id
        (session_dir / "staging").mkdir(parents=True, exist_ok=True)
        return {
            "id": new_id,
            "channel_id": str(channel_id),
            "started_at": datetime.now(timezone.utc).isoformat(),
            "ended_at": None,
            "is_active": 1,
        }


async def close_stream_session(session_id: str) -> None:
    """Mark session as inactive with ended_at timestamp."""
    async with get_db_connection() as db:
        await db.execute(
            "UPDATE stream_sessions SET is_active = 0, ended_at = CURRENT_TIMESTAMP WHERE id = ?",
            (session_id,)
        )
        await db.commit()
        logger.info("Marked stream session %s as ended (grace period active)", session_id)


async def stage_seed_snippet(
    session_id: str,
    channel_id: str,
    snippet_path: str,
    regex_pattern: str,
    transcript_snippet: str,
    expiry_minutes: int = 20,
) -> int:
    """Record a staged seed snippet in seed_staging table."""
    now = datetime.now(timezone.utc)
    expires_at = (now + timedelta(minutes=expiry_minutes)).isoformat()
    async with get_db_connection() as db:
        # Record hit in pattern stats
        await db.execute(
            """INSERT INTO story_pattern_stats (pattern_name, hits, confirmed, is_active, updated_at)
               VALUES (?, 1, 0, 1, CURRENT_TIMESTAMP)
               ON CONFLICT(pattern_name) DO UPDATE SET
                   hits = hits + 1,
                   updated_at = CURRENT_TIMESTAMP""",
            (regex_pattern,)
        )

        cur = await db.execute(
            """INSERT INTO seed_staging (
                session_id, channel_id, path, regex_pattern, transcript_snippet, expires_at, status
            ) VALUES (?, ?, ?, ?, ?, ?, 'pending')""",
            (session_id, str(channel_id), str(snippet_path), regex_pattern, transcript_snippet, expires_at)
        )
        await db.commit()
        return cur.lastrowid


async def confirm_staged_seed(
    staging_id: int,
    session_id: str,
    channel_id: str,
    kind: str,
    quote: str,
    summary: str,
    final_snippet_path: str,
    transcript_json: str,
    stream_epoch_start: float,
    duration: float,
    regex_pattern: Optional[str] = None,
) -> int:
    """Promote staged seed to confirmed story_seeds table and update stats."""
    async with get_db_connection() as db:
        # Update pattern confirmed count if pattern known
        if regex_pattern:
            await db.execute(
                """UPDATE story_pattern_stats
                   SET confirmed = confirmed + 1, updated_at = CURRENT_TIMESTAMP
                   WHERE pattern_name = ?""",
                (regex_pattern,)
            )

        # Mark staging as confirmed
        await db.execute(
            "UPDATE seed_staging SET status = 'confirmed' WHERE id = ?",
            (staging_id,)
        )

        # Insert confirmed story seed
        cur = await db.execute(
            """INSERT INTO story_seeds (
                session_id, channel_id, kind, quote, summary, snippet_path,
                transcript_json, stream_epoch_start, duration
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                session_id,
                str(channel_id),
                kind,
                quote,
                summary,
                str(final_snippet_path),
                transcript_json,
                float(stream_epoch_start),
                float(duration),
            )
        )
        await db.commit()
        return cur.lastrowid


async def get_active_seeds_for_session(session_id: str, limit: int = 30) -> List[Dict[str, Any]]:
    """Retrieve confirmed seeds for session, capped at limit (default 30)."""
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT id, session_id, channel_id, kind, quote, summary, snippet_path,
                      transcript_json, stream_epoch_start, duration, created_at
               FROM story_seeds
               WHERE session_id = ?
               ORDER BY created_at DESC
               LIMIT ?""",
            (session_id, limit)
        )
        rows = await cur.fetchall()
        return [dict(r) for r in rows]


async def purge_expired_staging(session_id: Optional[str] = None) -> int:
    """Delete staging files and database entries that have expired."""
    purged_count = 0
    now_iso = datetime.now(timezone.utc).isoformat()
    async with get_db_connection() as db:
        if session_id:
            cur = await db.execute(
                "SELECT id, path FROM seed_staging WHERE session_id = ? AND status = 'pending' AND expires_at < ?",
                (session_id, now_iso)
            )
        else:
            cur = await db.execute(
                "SELECT id, path FROM seed_staging WHERE status = 'pending' AND expires_at < ?",
                (now_iso,)
            )
        rows = await cur.fetchall()
        for r in rows:
            stg_id, path_str = r[0], r[1]
            try:
                p = Path(path_str)
                if p.exists():
                    p.unlink()
            except Exception as e:
                logger.warning("Failed removing expired staging file %s: %s", path_str, e)
            await db.execute("UPDATE seed_staging SET status = 'expired' WHERE id = ?", (stg_id,))
            purged_count += 1
        await db.commit()
    return purged_count


async def get_pattern_stats() -> List[Dict[str, Any]]:
    """Get hit and confirm rates for all regex patterns with auto-prune active status."""
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT pattern_name, hits, confirmed, is_active, updated_at
               FROM story_pattern_stats
               ORDER BY hits DESC"""
        )
        rows = await cur.fetchall()
        stats = []
        for r in rows:
            d = dict(r)
            hits = d.get("hits", 0)
            conf = d.get("confirmed", 0)
            rate = (conf / hits) if hits > 0 else 0.0
            d["confirm_rate"] = round(rate, 4)
            # Self-prune rule: if hits >= 50 and rate < 0.20, disable pattern
            if hits >= 50 and rate < 0.20 and d.get("is_active") == 1:
                await db.execute(
                    "UPDATE story_pattern_stats SET is_active = 0 WHERE pattern_name = ?",
                    (d["pattern_name"],)
                )
                d["is_active"] = 0
                logger.warning(
                    "Auto-disabled pattern '%s': confirm rate %.2f%% below 20%% threshold after %d hits",
                    d["pattern_name"], rate * 100, hits
                )
            stats.append(d)
        await db.commit()
        return stats

