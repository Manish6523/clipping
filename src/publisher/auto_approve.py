"""Per-channel auto-approve with a trial mode.

Modes (youtube_accounts.auto_mode):
    off   - every clip waits for a human
    trial - the decision ("would auto-approve?") is logged but nothing is queued; when you
            approve/reject the clip yourself, that's recorded so the dashboard can show how
            often the AI agreed with you before you switch to "on"
    on    - clips scoring >= the channel's threshold are queued into its next slot
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

MODES = ("off", "trial", "on")


async def evaluate_new_clip(clip_id: int, channel_id: str, score: int) -> List[Dict[str, Any]]:
    """Run auto-approve for every active channel mapped to the clip's streamer."""
    from src.database import get_db_connection
    from src.publisher.slots import schedule_clip

    handle = (channel_id or "").strip()
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT a.account_key, COALESCE(a.auto_mode, 'off') AS auto_mode, COALESCE(a.min_score_threshold, 75) AS threshold
               FROM youtube_accounts a JOIN streamer_yt_mappings m ON a.account_key = m.account_key
               WHERE a.is_active = 1 AND lower(m.streamer_handle) IN (lower(?), lower(?), lower(?))""",
            (handle, handle.lstrip("@"), "@" + handle.lstrip("@")),
        )
        accounts = [dict(r) for r in await cur.fetchall()]

        decisions = []
        for acc in accounts:
            mode = acc["auto_mode"] if acc["auto_mode"] in MODES else "off"
            if mode == "off":
                continue
            would = int(score or 0) >= int(acc["threshold"])
            await db.execute(
                """INSERT OR IGNORE INTO auto_decisions (clip_id, account_key, mode, score, threshold, would_approve)
                   VALUES (?, ?, ?, ?, ?, ?)""",
                (clip_id, acc["account_key"], mode, int(score or 0), int(acc["threshold"]), 1 if would else 0),
            )
            decisions.append({"account_key": acc["account_key"], "mode": mode, "would_approve": would})
        await db.commit()

    to_queue = [d["account_key"] for d in decisions if d["mode"] == "on" and d["would_approve"]]
    if to_queue:
        created = await schedule_clip(clip_id, to_queue)
        logger.info("Auto-approved clip #%d (score %s) -> %s", clip_id, score, created)
    for d in decisions:
        if d["mode"] == "trial":
            logger.info("Trial auto-approve for clip #%d on %s: would %s (score %s)",
                        clip_id, d["account_key"], "APPROVE" if d["would_approve"] else "skip", score)
    return decisions


async def record_human_decision(clip_id: int, decision: str) -> None:
    """decision: 'approve' | 'reject'. Only fills rows not yet decided."""
    if decision not in ("approve", "reject"):
        return
    from src.database import get_db_connection
    try:
        async with get_db_connection() as db:
            await db.execute(
                "UPDATE auto_decisions SET human_decision = ?, decided_at = CURRENT_TIMESTAMP "
                "WHERE clip_id = ? AND human_decision IS NULL",
                (decision, clip_id),
            )
            await db.commit()
    except Exception as e:  # never block the user's action on bookkeeping
        logger.debug("Could not record human decision for clip %d: %s", clip_id, e)


async def agreement_stats(account_key: Optional[str] = None) -> Dict[str, Dict[str, Any]]:
    """Per account: how often trial decisions matched what you did."""
    from src.database import get_db_connection
    async with get_db_connection() as db:
        cur = await db.execute(
            """SELECT account_key,
                      COUNT(*) AS total,
                      SUM(CASE WHEN human_decision IS NOT NULL THEN 1 ELSE 0 END) AS decided,
                      SUM(CASE WHEN (would_approve = 1 AND human_decision = 'approve')
                                 OR (would_approve = 0 AND human_decision = 'reject') THEN 1 ELSE 0 END) AS agreed,
                      SUM(CASE WHEN would_approve = 1 AND human_decision = 'reject' THEN 1 ELSE 0 END) AS false_approvals,
                      SUM(CASE WHEN would_approve = 0 AND human_decision = 'approve' THEN 1 ELSE 0 END) AS missed
               FROM auto_decisions
               WHERE mode = 'trial' AND (? IS NULL OR account_key = ?)
               GROUP BY account_key""",
            (account_key, account_key),
        )
        out = {}
        for r in await cur.fetchall():
            decided = r["decided"] or 0
            out[r["account_key"]] = {
                "total": r["total"], "decided": decided, "agreed": r["agreed"] or 0,
                "false_approvals": r["false_approvals"] or 0, "missed": r["missed"] or 0,
                "agreement_pct": round(100.0 * (r["agreed"] or 0) / decided, 1) if decided else None,
            }
        return out
