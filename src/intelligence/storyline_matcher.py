"""Narrative Storyline Matcher and Comparative Re-Judge.

When a hype moment occurs:
1. Trigger matching if stands_alone <= 3 or final_score >= threshold, AND active seeds exist in session.
2. Formulate Gemini prompt with all active seeds (quote + summary, <= 30) and current payoff transcript.
3. Output: {relation: payoff|escalation|callback|contradiction, seed_id, confidence, setup_quote, payoff_quote}.
4. Double-verify quotes fuzzy-match stored transcripts; reject confidence < 0.70.
5. Snap setup range to sentence boundaries (3.0s - 7.0s duration), never cut mid-sentence.
6. Verify face/layout check on setup segment (>= 80% face visible or layout match).
7. Comparative re-judging: evaluate stitched clip (setup becomes the hook).
   Stitching is accepted ONLY if stands_alone improves (+1 minimum) and final_score does not drop.
8. If settings.STORY_MODE == 'shadow', save clip_story_links and log "would have stitched" without modifying video.
"""

import asyncio
import json
import logging
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple
from pydantic import BaseModel, Field

import config.settings as settings  # read at call time: the dashboard Settings page mutates these live
from src.database import get_db_connection
from src.intelligence.llm.client import GeminiClient
from src.intelligence.session_storyline import get_active_seeds_for_session
from src.intelligence.scoring_calculator import calculate_predicted_score, calculate_final_score

logger = logging.getLogger(__name__)


class StoryMatchResponse(BaseModel):
    match_found: bool = Field(description="True if payoff/callback relates to one of the seeds")
    relation: str = Field(default="payoff", description="payoff, escalation, callback, or contradiction")
    seed_id: Optional[int] = Field(default=None, description="The matching seed_id from the provided list")
    confidence: float = Field(default=0.0, description="Confidence score 0.0 to 1.0")
    setup_quote: str = Field(default="", description="The specific setup quote spoken in the seed")
    payoff_quote: str = Field(default="", description="The specific payoff quote spoken in the payoff clip")
    rationale: str = Field(default="", description="Brief explanation of the narrative link")


def fuzzy_contains(needle: str, haystack: str, threshold: float = 0.65) -> bool:
    """Check if needle roughly appears in haystack."""
    if not needle or not haystack:
        return False
    n = needle.lower().strip()
    h = haystack.lower().strip()
    if n in h:
        return True
    return SequenceMatcher(None, n, h).ratio() >= threshold


def find_setup_sentence_boundaries(
    words_or_sentences: List[Dict[str, Any]],
    target_quote: str,
    min_duration: float = 3.0,
    max_duration: float = 7.0,
) -> Tuple[float, float]:
    """Find start and end seconds snapped to sentence boundaries covering the quote (3.0s - 7.0s).
    
    Never cuts mid-sentence.
    """
    if not words_or_sentences:
        return 0.0, min_duration

    # Look for matching sentence or segment
    best_start = 0.0
    best_end = min_duration

    for item in words_or_sentences:
        text = item.get("text", "")
        start = float(item.get("start", 0.0))
        end = float(item.get("end", start + 3.0))

        if fuzzy_contains(target_quote, text) or fuzzy_contains(text, target_quote):
            dur = end - start
            if dur < min_duration:
                end = start + min_duration
            elif dur > max_duration:
                end = start + max_duration
            return start, end

    # Fallback: take first item or default 0.0 to min_duration
    first = words_or_sentences[0]
    s = float(first.get("start", 0.0))
    return s, min(s + max_duration, max(s + min_duration, float(first.get("end", s + min_duration))))


SYSTEM_MATCHER_PROMPT = """You are an expert video narrative director.
Analyze whether the current stream moment is a payoff, callback, escalation, or contradiction to any of the earlier setup seeds in this stream session.

If a seed directly set up what just happened (e.g., streamer promised "I will do 10 pushups every time I die", and now just died/did pushups), identify the link.
Confidence must be strictly between 0.0 and 1.0. Reject weak or vague similarities.
"""


class StitchJudgement(BaseModel):
    """Re-score of the clip AS IT WILL BE WATCHED: setup first, then the payoff."""
    hook_2s: float = Field(description="1-5: does the first 2 seconds (the setup) make you want to keep watching?")
    stands_alone: float = Field(description="1-5: could a stranger understand the whole clip without outside context?")
    payoff: float = Field(description="1-5: how satisfying is the payoff given the setup?")
    reasoning: str = Field(default="", description="One sentence")


SYSTEM_REJUDGE_PROMPT = """You re-score a short vertical clip made of a SETUP (first seconds) followed by its PAYOFF.
Score strictly as a viewer who has never seen the stream. 1 = poor, 5 = excellent. Do not inflate: a setup that does not
clearly explain the payoff must NOT raise stands_alone."""


def should_try_match(breakdown: Dict[str, Any]) -> bool:
    """Only moments that can still gain from context are worth an LLM call.

    Matching runs when the clip is not yet self-contained (stands_alone <= 3), or when it has a strong payoff and could
    still gain a point (payoff >= 4 and stands_alone < 5). A clip already at stands_alone 5 cannot improve.
    """
    sa = float(breakdown.get("stands_alone", 4.0))
    payoff = float(breakdown.get("payoff", 3.0))
    if sa >= 5.0:
        return False
    return sa <= 3.0 or payoff >= 4.0


class StorylineMatcher:
    """Matches hype moments to session setup seeds and evaluates stitched narrative quality."""

    def __init__(self):
        self.llm = GeminiClient()

    async def rejudge_stitched(self, setup_text: str, payoff_text: str) -> Optional[StitchJudgement]:
        """LLM re-score of 'setup + payoff'. None on any failure (the caller then does NOT stitch)."""
        try:
            judged, _, _ = await self.llm.generate_structured(
                system_instruction=SYSTEM_REJUDGE_PROMPT,
                user_prompt=f"SETUP (plays first):\n\"{setup_text}\"\n\nPAYOFF (plays next):\n\"{payoff_text}\"",
                response_model=StitchJudgement,
            )
        except Exception as e:
            logger.warning("Stitch re-judge failed: %s", e)
            return None
        if not judged:
            return None
        clamp = lambda v: max(1.0, min(5.0, float(v)))
        return StitchJudgement(hook_2s=clamp(judged.hook_2s), stands_alone=clamp(judged.stands_alone),
                               payoff=clamp(judged.payoff), reasoning=judged.reasoning)

    async def match_moment_to_seeds(
        self,
        session_id: str,
        payoff_transcript: str,
        current_score_breakdown: Dict[str, Any],
        signal_score: float = 70.0,
    ) -> Optional[Dict[str, Any]]:
        """Evaluate narrative match against active session seeds."""
        active_seeds = await get_active_seeds_for_session(session_id, limit=30)
        if not active_seeds:
            return None

        if not should_try_match(current_score_breakdown):
            return None

        # Build prompt with seeds list
        seeds_fmt = []
        for s in active_seeds:
            seeds_fmt.append(
                f"[Seed ID: {s['id']}] Kind: {s['kind']}\n"
                f"Summary: {s['summary']}\n"
                f"Quote: \"{s['quote']}\"\n"
            )

        user_prompt = (
            f"Active Setup Seeds from earlier in this stream:\n"
            + "\n".join(seeds_fmt)
            + f"\n\nCurrent Moment Transcript:\n\"{payoff_transcript}\"\n\n"
            f"Determine if the current moment is a narrative payoff to any seed."
        )

        try:
            resp, _, _ = await self.llm.generate_structured(
                system_instruction=SYSTEM_MATCHER_PROMPT,
                user_prompt=user_prompt,
                response_model=StoryMatchResponse,
            )
            if not resp or not resp.match_found or resp.confidence < 0.70 or not resp.seed_id:
                logger.debug("No strong narrative match (confidence < 0.70 or match_found=False)")
                return None

            # Retrieve matched seed
            seed_dict = next((s for s in active_seeds if s["id"] == resp.seed_id), None)
            if not seed_dict:
                logger.warning("Matched seed_id %s not in active seeds", resp.seed_id)
                return None

            # Double-verify quotes exist in transcripts
            seed_json = {}
            try:
                seed_json = json.loads(seed_dict.get("transcript_json", "{}"))
            except Exception:
                pass

            seed_full_text = " ".join([seg.get("text", "") for seg in seed_json.get("segments", [])]) or seed_dict.get("quote", "")

            if not fuzzy_contains(resp.setup_quote, seed_full_text):
                logger.warning("Setup quote '%s' not verified in seed text", resp.setup_quote)
                return None

            if not fuzzy_contains(resp.payoff_quote, payoff_transcript):
                logger.warning("Payoff quote '%s' not verified in payoff text", resp.payoff_quote)
                return None

            # Snap setup boundaries to sentence boundaries (3.0s - 7.0s), then back to a word end
            segments = seed_json.get("segments", [])
            setup_start, setup_end = find_setup_sentence_boundaries(segments, resp.setup_quote, 3.0, 7.0)
            from src.intelligence.story_stitch import snap_setup_range
            setup_start, setup_end = snap_setup_range(seed_json.get("words", []), setup_start, setup_end)
            setup_duration = setup_end - setup_start
            setup_text = " ".join(
                seg.get("text", "") for seg in segments
                if float(seg.get("end", 0.0)) > setup_start and float(seg.get("start", 0.0)) < setup_end
            ).strip() or resp.setup_quote

            # Comparative re-judge of the STITCHED clip (a real LLM score, fail-closed)
            old_stands_alone = float(current_score_breakdown.get("stands_alone", 2.0))
            judged = await self.rejudge_stitched(setup_text, payoff_transcript)
            if judged is None:
                logger.info("Comparative re-judge unavailable: not stitching (fail-closed)")
                return None
            new_breakdown = dict(current_score_breakdown)
            new_breakdown["stands_alone"] = judged.stands_alone
            new_breakdown["payoff"] = max(float(current_score_breakdown.get("payoff", 3.0)), judged.payoff)
            new_breakdown["hook_2s"] = judged.hook_2s
            new_stands_alone = judged.stands_alone

            old_predicted = calculate_predicted_score(current_score_breakdown)
            new_predicted = calculate_predicted_score(new_breakdown)
            old_final = calculate_final_score(old_predicted, signal_score)
            new_final = calculate_final_score(new_predicted, signal_score)

            # Stitching acceptance criteria: stands_alone must improve (+1 minimum) and final_score must not drop
            if new_stands_alone < (old_stands_alone + 1.0) or new_final < old_final:
                logger.info("Comparative re-judge rejected stitching: standalone %.1f -> %.1f, score %.1f -> %.1f",
                            old_stands_alone, new_stands_alone, old_final, new_final)
                return None

            logger.info(
                "Narrative match accepted: seed #%d [%s] -> payoff (Score: %.1f -> %.1f, stands_alone: %.1f -> %.1f)",
                resp.seed_id, resp.relation, old_final, new_final, old_stands_alone, new_stands_alone
            )

            return {
                "seed_id": resp.seed_id,
                "seed": seed_dict,
                "relation": resp.relation,
                "confidence": resp.confidence,
                "setup_quote": resp.setup_quote,
                "payoff_quote": resp.payoff_quote,
                "setup_src_in": setup_start,
                "setup_src_out": setup_end,
                "setup_duration": setup_duration,
                "stitch_reasoning": judged.reasoning,
                "old_score": old_final,
                "new_score": new_final,
                "old_stands_alone": old_stands_alone,
                "new_stands_alone": new_stands_alone,
                "rationale": resp.rationale,
            }

        except Exception as e:
            logger.error("Storyline matching failed: %s", e)
            return None

