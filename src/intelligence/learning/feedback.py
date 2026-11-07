"""Feedback event recorder and online learning module for AutoClip.

Tracks user reviews (approve, reject, trim) and updates:
- boundary_bias: rolling median offset of human boundary trims
- channel weights: shrinkage toward defaults
"""

import json
import logging
from typing import Any, Dict, List, Optional
from src.database import get_db_connection

logger = logging.getLogger(__name__)


class FeedbackLearner:
    """Records human editor feedback and calibrates boundary biases & scoring weights."""

    DEFAULT_WEIGHTS = {
        "w_llm": 0.55,
        "w_signal": 0.30,
        "w_hist": 0.15,
    }

    @classmethod
    async def log_feedback(
        cls,
        clip_id: int,
        channel_id: str,
        event: str,
        payload: Optional[Dict[str, Any]] = None,
        candidate_id: Optional[str] = None,
    ):
        """Records an approval, rejection, trim, or edit event."""
        payload_str = json.dumps(payload or {})
        async with get_db_connection() as db:
            await db.execute(
                """
                INSERT INTO clip_feedback_events (clip_id, candidate_id, channel_id, event, payload_json)
                VALUES (?, ?, ?, ?, ?)
                """,
                (clip_id, candidate_id, channel_id, event, payload_str)
            )
            await db.commit()

        # Update boundary bias if this was a trim
        if event == "trimmed" and payload:
            await cls._update_boundary_bias(channel_id, payload)

    @classmethod
    async def _update_boundary_bias(cls, channel_id: str, trim_payload: Dict[str, Any]):
        """Updates rolling median of (human_start - ai_start) and (human_end - ai_end)."""
        delta_start = float(trim_payload.get("start_delta", 0.0))
        delta_end = float(trim_payload.get("end_delta", 0.0))

        async with get_db_connection() as db:
            cur = await db.execute("SELECT boundary_bias_json FROM channel_learning WHERE channel_id = ?", (channel_id,))
            row = await cur.fetchone()

            bias = {"start_bias": 0.0, "end_bias": 0.0, "count": 0}
            if row:
                try:
                    data = json.loads(row["boundary_bias_json"] if isinstance(row, dict) else row[0])
                    bias.update(data)
                except Exception:
                    pass

            count = bias.get("count", 0) + 1
            # Exponential rolling update
            alpha = 0.20
            new_start = round(bias.get("start_bias", 0.0) * (1 - alpha) + delta_start * alpha, 3)
            new_end = round(bias.get("end_bias", 0.0) * (1 - alpha) + delta_end * alpha, 3)

            # Clamp to +/- 3.0 seconds
            bias["start_bias"] = max(-3.0, min(3.0, new_start))
            bias["end_bias"] = max(-3.0, min(3.0, new_end))
            bias["count"] = count

            await db.execute(
                """
                INSERT INTO channel_learning (channel_id, weights_json, boundary_bias_json, stats_json)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(channel_id) DO UPDATE SET
                    boundary_bias_json = excluded.boundary_bias_json,
                    updated_at = CURRENT_TIMESTAMP
                """,
                (
                    channel_id,
                    json.dumps(cls.DEFAULT_WEIGHTS),
                    json.dumps(bias),
                    json.dumps({"labels_count": count}),
                )
            )
            await db.commit()

    @classmethod
    async def get_channel_learning(cls, channel_id: str) -> Dict[str, Any]:
        """Retrieves learned weights, biases, and review stats for a channel."""
        async with get_db_connection() as db:
            cur = await db.execute(
                "SELECT weights_json, boundary_bias_json, stats_json, is_paused FROM channel_learning WHERE channel_id = ?",
                (channel_id,)
            )
            row = await cur.fetchone()
            if not row:
                return {
                    "channel_id": channel_id,
                    "weights": cls.DEFAULT_WEIGHTS,
                    "boundary_bias": {"start_bias": 0.0, "end_bias": 0.0, "count": 0},
                    "stats": {"labels_count": 0, "approval_rate": 0.85},
                    "is_paused": False,
                }

            r_dict = dict(row)
            return {
                "channel_id": channel_id,
                "weights": json.loads(r_dict.get("weights_json") or "{}") or cls.DEFAULT_WEIGHTS,
                "boundary_bias": json.loads(r_dict.get("boundary_bias_json") or "{}"),
                "stats": json.loads(r_dict.get("stats_json") or "{}"),
                "is_paused": bool(r_dict.get("is_paused", 0)),
            }

