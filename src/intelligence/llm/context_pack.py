"""Context Pack Builder for AutoClip Gemini Judge.

Constructs rich, compact prompt context (target <= 3,500 tokens):
- Creator persona, niche, good-clip notes, avoid notes, inside jokes
- Signal telemetry (trigger type, chat velocity ratio, audio peak dB)
- Word-level transcript with discrete Sentence IDs [s01, s02, ...]
- Top 25 chat reactions & top emotes
- Recent few-shot approved & rejected clips with human reason tags
"""

import json
import logging
from typing import Any, Dict, List, Optional
from src.database import get_db_connection

logger = logging.getLogger(__name__)


class ContextPackBuilder:
    """Builds self-contained, high-signal prompt packs for Gemini AI Judge."""

    @classmethod
    async def build_context_pack(
        cls,
        channel_id: str,
        sentences: List[Any],
        trigger_context: Optional[Dict[str, Any]] = None,
        chat_features: Optional[Dict[str, Any]] = None,
        stream_metadata: Optional[Dict[str, Any]] = None,
        max_few_shot: int = 3,
    ) -> Dict[str, Any]:
        """Assemble structured context pack."""
        # 1. Fetch channel persona & settings
        channel_info = await cls._get_channel_context(channel_id)

        # 2. Fetch few-shot approved & rejected examples for this streamer
        few_shots = await cls._get_few_shot_examples(channel_id, limit=max_few_shot)

        # 3. Format sentences with clean ID tokens
        formatted_sentences = []
        for s in sentences:
            s_id = getattr(s, "id", None) or s.get("id")
            s_start = getattr(s, "start", None) or s.get("start", 0.0)
            s_end = getattr(s, "end", None) or s.get("end", 0.0)
            s_text = getattr(s, "text", None) or s.get("text", "")
            formatted_sentences.append({
                "id": s_id,
                "start": round(s_start, 2),
                "end": round(s_end, 2),
                "text": s_text.strip(),
            })

        return {
            "channel_id": channel_id,
            "creator_profile": channel_info,
            "stream_context": stream_metadata or {},
            "trigger_signal": trigger_context or {},
            "chat_reactions": chat_features or {},
            "sentences": formatted_sentences,
            "few_shot_feedback": few_shots,
        }

    @classmethod
    async def _get_channel_context(cls, channel_id: str) -> Dict[str, Any]:
        async with get_db_connection() as db:
            cur = await db.execute("SELECT display_name, group_tag, notes, settings_json FROM channels WHERE channel_id_or_handle = ?", (channel_id,))
            row = await cur.fetchone()
            if not row:
                return {
                    "display_name": channel_id,
                    "group": "General",
                    "persona": "High energy livestream gaming and entertainment.",
                    "good_clip_notes": "Unexpected moments, funny reactions, intense clutch plays, punchlines.",
                    "avoid_notes": "Dead air, monotone inventory management, unprompted rambling.",
                    "inside_jokes": "",
                }

            r = dict(row)
            settings = {}
            if r.get("settings_json"):
                try:
                    settings = json.loads(r["settings_json"]) if isinstance(r["settings_json"], str) else r["settings_json"]
                except Exception:
                    pass

            ai_cfg = settings.get("ai", {})
            return {
                "display_name": r.get("display_name") or channel_id,
                "group": r.get("group_tag") or "General",
                "notes": r.get("notes") or "",
                "persona": ai_cfg.get("persona") or ai_cfg.get("gemini_context") or "High energy streamer moments.",
                "good_clip_notes": ai_cfg.get("good_clip_notes") or "Clutches, funny voice cracks, rare achievements, witty jokes.",
                "avoid_notes": ai_cfg.get("avoid_notes") or "Quiet setup, boring chatter, mid-story interruptions.",
                "inside_jokes": ai_cfg.get("inside_jokes") or "",
            }

    @classmethod
    async def _get_few_shot_examples(cls, channel_id: str, limit: int = 3) -> Dict[str, List[Dict[str, Any]]]:
        """Fetch real approved and rejected examples with human feedback tags."""
        approved = []
        rejected = []
        async with get_db_connection() as db:
            # Query approved
            cur_app = await db.execute("""
                SELECT c.id, c.title, c.virality_score, c.raw_start, c.raw_end
                FROM clips c
                WHERE c.channel_id = ? AND c.status IN ('approved', 'published', 'queued')
                ORDER BY c.id DESC LIMIT ?
            """, (channel_id, limit))
            for r in await cur_app.fetchall():
                approved.append({
                    "clip_id": r[0],
                    "title": r[1],
                    "score": r[2],
                    "duration": round(r[4] - r[3], 1),
                })

            # Query rejected with human reason tag
            cur_rej = await db.execute("""
                SELECT c.id, c.title, c.virality_score,
                       (SELECT json_extract(f.payload_json, '$.reason') 
                        FROM clip_feedback_events f 
                        WHERE f.clip_id = c.id AND f.event IN ('rejected', 'reason_tagged') 
                          AND json_extract(f.payload_json, '$.reason') IS NOT NULL 
                        ORDER BY f.id DESC LIMIT 1) as reason
                FROM clips c
                WHERE c.channel_id = ? AND c.status = 'rejected'
                ORDER BY c.id DESC LIMIT ?
            """, (channel_id, limit))
            for r in await cur_rej.fetchall():
                rejected.append({
                    "clip_id": r[0],
                    "title": r[1],
                    "score": r[2],
                    "rejection_reason": r[3] or "unspecified",
                })

        return {"approved_clips": approved, "rejected_clips": rejected}
