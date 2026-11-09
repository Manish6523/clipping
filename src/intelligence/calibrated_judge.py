"""Autonomous AI Judge for AutoClip moments (Phase D).

Features:
- Calls Gemini with ContextPackBuilder context
- Validates sentence boundary mapping and timestamps
- Evaluates 1-5 rubric scores and applies hard caps
- Calculates final score: 0.70 * predicted + 0.30 * signal
"""

import json
import logging
from typing import Any, Dict, List, Optional
from config.settings import GEMINI_JUDGE_MODEL, GEMINI_API_KEY, GEMINI_API_KEYS
from src.intelligence.llm.client import GeminiClient
from src.intelligence.llm.context_pack import ContextPackBuilder
from src.intelligence.llm.judge_prompts import PROMPT_VERSION, JUDGE_SYSTEM_PROMPT, JUDGE_USER_TEMPLATE
from src.intelligence.llm.judge_schemas import JudgeEvaluationResponse, JudgeClipEvaluation
from src.intelligence.scoring_calculator import calculate_predicted_score, calculate_final_score

logger = logging.getLogger(__name__)


class CalibratedJudge:
    """Evaluates stream moments using the calibrated 1-5 rubric and context pack."""

    def __init__(self, model_name: str = GEMINI_JUDGE_MODEL):
        self.model_name = model_name
        self.client = GeminiClient(api_keys=list(GEMINI_API_KEYS) or ([GEMINI_API_KEY] if GEMINI_API_KEY else []), model_name=model_name)

    async def evaluate_moment(
        self,
        channel_id: str,
        sentences: List[Any],
        trigger_context: Optional[Dict[str, Any]] = None,
        chat_features: Optional[Dict[str, Any]] = None,
        stream_metadata: Optional[Dict[str, Any]] = None,
        min_score: int = 70,
    ) -> List[Dict[str, Any]]:
        """Run full Phase D evaluation on a moment."""
        context_pack = await ContextPackBuilder.build_context_pack(
            channel_id=channel_id,
            sentences=sentences,
            trigger_context=trigger_context,
            chat_features=chat_features,
            stream_metadata=stream_metadata,
        )

        creator_profile = context_pack["creator_profile"]
        trigger_sig = context_pack["trigger_signal"]
        chat_reac = context_pack["chat_reactions"]
        few_shot = context_pack["few_shot_feedback"]

        # Format chat sample
        chat_lines = [f"- {m}" for m in (chat_reac.get("top_messages") or [])[:15]]
        chat_str = "\n".join(chat_lines) if chat_lines else "None recorded."

        # Format top emotes
        emotes_list = [f"{t['token']} (x{t['count']})" for t in (chat_reac.get("top_tokens") or [])[:6]]
        emotes_str = ", ".join(emotes_list) if emotes_list else "None recorded."

        # Format feedback sample
        fb_lines = []
        if few_shot.get("approved_clips"):
            fb_lines.append("Approved Clips:")
            for a in few_shot["approved_clips"]:
                fb_lines.append(f"  * #{a['clip_id']} \"{a['title']}\" (Score: {a['score']})")
        if few_shot.get("rejected_clips"):
            fb_lines.append("Rejected Clips (Avoid repeating):")
            for r in few_shot["rejected_clips"]:
                fb_lines.append(f"  * #{r['clip_id']} \"{r['title']}\" (Reason: {r['rejection_reason']})")
        fb_str = "\n".join(fb_lines) if fb_lines else "No human reviews logged yet for this streamer."

        # Format numbered sentences
        s_lines = []
        for s in context_pack["sentences"][:60]:
            s_lines.append(f"[{s['id']}] ({s['start']:.1f}s - {s['end']:.1f}s): {s['text']}")
        s_str = "\n".join(s_lines)

        user_prompt = JUDGE_USER_TEMPLATE.format(
            creator_name=creator_profile["display_name"],
            group=creator_profile["group"],
            persona=creator_profile["persona"],
            good_clip_notes=creator_profile["good_clip_notes"],
            avoid_notes=creator_profile["avoid_notes"],
            inside_jokes=creator_profile["inside_jokes"],
            trigger_type=trigger_sig.get("type", "normal"),
            trigger_details=json.dumps(trigger_sig),
            top_emotes=emotes_str,
            chat_sample=chat_str,
            feedback_sample=fb_str,
            transcript_sentences=s_str,
        )

        try:
            resp: Optional[JudgeEvaluationResponse] = await self.client.generate_structured(
                system_instruction=JUDGE_SYSTEM_PROMPT,
                user_prompt=user_prompt,
                response_model=JudgeEvaluationResponse,
            )
        except Exception as e:
            logger.error("CalibratedJudge evaluation failed: %s", e)
            return []

        if not resp or not resp.candidates:
            return []

        # Map sentence IDs to timestamps
        sent_map = {
            (getattr(s, "id", None) or s.get("id")): s
            for s in sentences
        }

        # Derive signal score from trigger context if available
        signal_score = None
        if trigger_sig:
            if trigger_sig.get("type") in ("chat_spike", "keyword_hit"):
                # Ratio 2.5x -> 75, ratio 4x -> 90
                ratio = trigger_sig.get("ratio", 2.0)
                signal_score = min(100.0, max(50.0, 50.0 + (ratio * 10.0)))
            elif trigger_sig.get("type") == "audio_peak":
                # Peak -6dB -> 80
                peak = trigger_sig.get("peak_db", -10.0)
                signal_score = min(100.0, max(50.0, 100.0 + (peak * 3.0)))

        candidates = []
        for cand in resp.candidates:
            s_start = sent_map.get(cand.boundaries.start_sentence_id)
            s_end = sent_map.get(cand.boundaries.end_sentence_id)

            if not s_start or not s_end:
                logger.warning("Judge candidate %s boundaries invalid (%s, %s). Skipping.", cand.candidate_id, cand.boundaries.start_sentence_id, cand.boundaries.end_sentence_id)
                continue

            t_start = getattr(s_start, "start", None) or s_start.get("start", 0.0)
            t_end = getattr(s_end, "end", None) or s_end.get("end", 0.0)

            # Calculate predicted & final scores
            predicted = calculate_predicted_score(cand.scores, would_post=cand.would_post)
            final = calculate_final_score(predicted, signal_score)

            # Teaser timestamp if specified
            teaser_ts = None
            if cand.teaser_hook_sentence_id and cand.teaser_hook_sentence_id in sent_map:
                teaser_sent = sent_map[cand.teaser_hook_sentence_id]
                teaser_ts = getattr(teaser_sent, "start", None) or teaser_sent.get("start")

            cand_dict = {
                "id": cand.candidate_id,
                "would_post": cand.would_post,
                "reject_reason": cand.reject_reason,
                "title": cand.title,
                "title_alts": cand.title_alts,
                "hook_text": cand.hook_text,
                "description": cand.description,
                "hashtags": cand.hashtags,
                "start_time": t_start,
                "end_time": t_end,
                "teaser_hook_timestamp": teaser_ts,
                "predicted_score": predicted,
                "final_score": final,
                "virality_score": int(round(final)),
                "scores": cand.scores.model_dump(),
                "evidence": cand.evidence.model_dump(),
                "flags": [f.model_dump() for f in cand.flags],
                "editorial_reason": cand.editorial_reason,
                "prompt_version": PROMPT_VERSION,
                "model": self.model_name,
            }

            if final >= min_score and cand.would_post:
                candidates.append(cand_dict)

        candidates.sort(key=lambda c: c["final_score"], reverse=True)
        return candidates

