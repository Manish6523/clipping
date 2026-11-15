"""LLM Worker for Story Seed Confirmation.

Batches pending staged snippets from seed_staging every 2-3 minutes,
calls Gemini to verify narrative setups (promise, bet, challenge, prediction, running_gag, hot_take),
verifies quote accuracy (fuzzy matching), and promotes confirmed seeds to story_seeds.

Output schema:
{
  "confirmed": true|false,
  "kind": "promise"|"bet"|"challenge"|"prediction"|"running_gag"|"hot_take",
  "quote": "exact or near exact quote",
  "summary": "1-sentence summary of the setup"
}
"""

import asyncio
import json
import logging
import os
import shutil
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, Field

from config.settings import STORY_SEEDS_DIR
from src.database import get_db_connection
from src.intelligence.llm.client import GeminiClient
from src.intelligence.session_storyline import (
    confirm_staged_seed,
    purge_expired_staging,
)
from src.intelligence.transcriber import Transcriber

logger = logging.getLogger(__name__)


class SeedConfirmationItem(BaseModel):
    staging_id: int
    confirmed: bool = Field(description="True if this is a genuine narrative setup/promise/bet/challenge")
    kind: str = Field(default="promise", description="promise, bet, challenge, prediction, running_gag, or hot_take")
    quote: str = Field(description="The exact words setting up the promise/challenge/running gag")
    summary: str = Field(description="Crisp 1-sentence summary of the setup")


class BatchSeedConfirmationResponse(BaseModel):
    results: List[SeedConfirmationItem] = Field(default_factory=list)


def fuzzy_quote_match(quote: str, transcript: str, threshold: float = 0.65) -> bool:
    """Fuzzy verify that the LLM-extracted quote exists in the source transcript."""
    if not quote or not transcript:
        return False
    q_clean = quote.lower().strip()
    t_clean = transcript.lower().strip()

    if q_clean in t_clean:
        return True

    # Check best substring ratio
    q_len = len(q_clean)
    words = t_clean.split()
    q_words_len = len(q_clean.split())
    for i in range(len(words) - q_words_len + 1):
        window = " ".join(words[i:i + q_words_len + 3])
        ratio = SequenceMatcher(None, q_clean, window).ratio()
        if ratio >= threshold:
            return True

    return SequenceMatcher(None, q_clean, t_clean).ratio() >= threshold


SYSTEM_CONFIRM_PROMPT = """You are an expert stream editor evaluating setup moments in a live stream.
Analyze the following candidate setup snippets transcribed from audio.
A valid narrative setup is a clear commitment, promise, bet, challenge, prediction, or running joke
that establishes an expectation of a future payoff (e.g. "Every time I die I'll do 10 pushups", "I bet $100 we win this", "If I lose this round I'll quit").
Casual comments or non-committal chatter ("every time you go to the store") are NOT valid setups.

For each snippet, indicate whether it is confirmed, its kind, the exact quote spoken, and a 1-sentence summary.
"""


class SeedConfirmWorker:
    """Processes staged seed snippets in batches with Gemini."""

    def __init__(self):
        self.llm = GeminiClient()
        self.transcriber = Transcriber(model_size="tiny.en")

    async def get_pending_staging_items(self, limit: int = 10) -> List[Dict[str, Any]]:
        async with get_db_connection() as db:
            cur = await db.execute(
                """SELECT id, session_id, channel_id, path, regex_pattern, transcript_snippet, created_at, expires_at
                   FROM seed_staging
                   WHERE status = 'pending'
                   ORDER BY created_at ASC
                   LIMIT ?""",
                (limit,)
            )
            rows = await cur.fetchall()
            return [dict(r) for r in rows]

    async def run_batch_confirmation(self) -> int:
        """Execute one batch confirmation pass. Returns number of confirmed seeds."""
        # 1. Purge expired staging items
        await purge_expired_staging()

        # 2. Fetch pending items
        pending = await self.get_pending_staging_items(limit=8)
        if not pending:
            return 0

        # Construct batch prompt
        items_text = []
        for item in pending:
            items_text.append(
                f"[Snippet ID: {item['id']}]\n"
                f"Pattern matched: {item['regex_pattern']}\n"
                f"Transcript: \"{item['transcript_snippet']}\"\n"
            )

        user_prompt = "Evaluate these candidates:\n\n" + "\n---\n".join(items_text)

        confirmed_count = 0
        try:
            resp, _, _ = await self.llm.generate_structured(
                system_instruction=SYSTEM_CONFIRM_PROMPT,
                user_prompt=user_prompt,
                response_model=BatchSeedConfirmationResponse,
            )
            eval_map = {res.staging_id: res for res in resp.results} if resp else {}

            for item in pending:
                stg_id = item["id"]
                stg_path = Path(item["path"])
                eval_res = eval_map.get(stg_id)

                if not eval_res or not eval_res.confirmed:
                    # Unconfirmed: mark rejected in staging
                    async with get_db_connection() as db:
                        await db.execute("UPDATE seed_staging SET status = 'rejected' WHERE id = ?", (stg_id,))
                        await db.commit()
                    continue

                # Verify quote matches transcript snippet
                if not fuzzy_quote_match(eval_res.quote, item["transcript_snippet"]):
                    logger.warning(
                        "Seed quote fuzzy verification failed for staging #%d: '%s' not in '%s'",
                        stg_id, eval_res.quote, item["transcript_snippet"]
                    )
                    async with get_db_connection() as db:
                        await db.execute("UPDATE seed_staging SET status = 'rejected' WHERE id = ?", (stg_id,))
                        await db.commit()
                    continue

                # Promote confirmed seed:
                # Transcribe staged video chunk to get high-precision word timestamps relative to snippet start
                transcription = {}
                try:
                    transcription = await self.transcriber.transcribe(str(stg_path))
                except Exception as e:
                    logger.warning("Failed detailed transcription for seed snippet %s: %s", stg_path, e)

                session_dir = STORY_SEEDS_DIR / item["session_id"]
                session_dir.mkdir(parents=True, exist_ok=True)
                final_mp4 = session_dir / f"seed_{stg_id}.mp4"
                final_json = session_dir / f"seed_{stg_id}.json"

                # Move video from staging to session root
                if stg_path.exists():
                    shutil.move(str(stg_path), str(final_mp4))

                # Save JSON with word timestamps relative to snippet start
                with open(final_json, "w", encoding="utf-8") as f:
                    json.dump(transcription, f, indent=2)

                duration = transcription.get("duration", 15.0)
                stream_epoch = os.path.getmtime(final_mp4) if final_mp4.exists() else 0.0

                seed_id = await confirm_staged_seed(
                    staging_id=stg_id,
                    session_id=item["session_id"],
                    channel_id=item["channel_id"],
                    kind=eval_res.kind,
                    quote=eval_res.quote,
                    summary=eval_res.summary,
                    final_snippet_path=str(final_mp4),
                    transcript_json=json.dumps(transcription),
                    stream_epoch_start=stream_epoch,
                    duration=duration,
                    regex_pattern=item["regex_pattern"],
                )
                logger.info(
                    "🎉 Promoted confirmed narrative seed #%d (%s): '%s' -> %s",
                    seed_id, eval_res.kind, eval_res.quote, final_mp4
                )
                confirmed_count += 1

        except Exception as e:
            logger.error("Seed confirmation batch failed: %s", e)

        return confirmed_count

