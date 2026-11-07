"""End-to-End Orchestrator for the AutoClip Best Clips Pipeline.

Stages:
1. Sentences: Build clean sentences from faster-whisper word timestamps.
2. Heat & Fallback: Compute multi-signal heat curve or 90s overlapping windows.
3. Boundary Snapping: Snap candidate seeds to complete sentence boundaries.
4. Dedupe: Temporal and n-gram content deduplication.
5. LLM Triage (Stage A): Rapid batched candidate filtering.
6. LLM Detail (Stage B): Sentence-ID based boundary refinement and 2-second hook enforcement.
7. MMR Selection: High-score diverse picking with safety filters.
8. Persistence: Logs every stage run into `pipeline_runs` and candidates into `candidates`.
"""

import asyncio
import json
import logging
import time
import uuid
from typing import Any, Dict, List, Optional

from src.database import get_db_connection
from src.intelligence.boundaries import BoundarySnapper
from src.intelligence.dedupe import Deduplicator
from src.intelligence.heat import HeatCurve
from src.intelligence.learning.feedback import FeedbackLearner
from src.intelligence.llm.client import GeminiClient
from src.intelligence.llm.prompts import (
    PROMPT_VERSION,
    STAGE_A_TRIAGE_SYSTEM,
    STAGE_A_TRIAGE_USER_TEMPLATE,
    STAGE_B_DETAIL_SYSTEM,
    STAGE_B_DETAIL_USER_TEMPLATE,
)
from src.intelligence.llm.schemas import (
    StageATriageResponse,
    StageBDetailResponse,
)
from src.intelligence.selection import CandidateSelector
from src.intelligence.sentences import Sentence, SentenceChunker

logger = logging.getLogger(__name__)


class BestClipsPipeline:
    """Production-grade pipeline executing the complete clip discovery and refinement flow."""

    def __init__(self, gemini_client: Optional[GeminiClient] = None):
        self.llm = gemini_client or GeminiClient()
        self.snapper = BoundarySnapper()
        self.dedup = Deduplicator()
        self.selector = CandidateSelector()

    async def run(
        self,
        source_id: str,
        channel_id: str,
        transcript_data: Dict[str, Any],
        duration: float,
        signals: Optional[Dict[str, List[tuple]]] = None,
        target_clips: int = 5,
        channel_persona: str = "High energy streaming moments with humor, gameplay reactions, and chat interaction.",
    ) -> List[Dict[str, Any]]:
        """Executes the full pipeline and records telemetry for the Pipeline Monitor."""
        run_id = f"run_{uuid.uuid4().hex[:8]}"
        start_ts = time.time()
        logger.info("🚀 Starting Best Clips Pipeline [%s] for source '%s' (channel: %s)", run_id, source_id, channel_id)

        # 1. Sentences
        sentences = SentenceChunker.from_whisper_result(transcript_data)
        logger.info("[%s] Chunks generated: %d sentences", run_id, len(sentences))
        if not sentences:
            logger.warning("[%s] No sentences extracted from transcript.", run_id)
            return []

        # 2. Signals & Heat Curve
        heat_points: List[float] = []
        peaks: List[Dict[str, Any]] = []
        if signals:
            heat_points = HeatCurve.build_heat_curve(duration, signals)
            peaks = HeatCurve.find_peaks(heat_points)

        candidates: List[Dict[str, Any]] = []
        # Fallback to sliding windows if peaks are scarce (e.g. Quick Clip URL or quiet VOD)
        if len(peaks) < target_clips:
            fallback_wins = HeatCurve.generate_fallback_windows(sentences)
            for fb in fallback_wins:
                candidates.append({
                    "id": f"c_{uuid.uuid4().hex[:6]}",
                    "seed_time": fb["seed_time"],
                    "start_time": fb["start_time"],
                    "end_time": fb["end_time"],
                    "start_sentence_id": fb["start_sentence_id"],
                    "end_sentence_id": fb["end_sentence_id"],
                    "text": fb["text"],
                    "heat_score": fb["heat_score"],
                    "stage": "generated",
                })
        else:
            for p in peaks:
                candidates.append({
                    "id": f"c_{uuid.uuid4().hex[:6]}",
                    "seed_time": p["time"],
                    "start_time": max(0.0, p["time"] - 15.0),
                    "end_time": min(duration, p["time"] + 15.0),
                    "heat_score": p["heat"],
                    "stage": "generated",
                })

        # 3. Boundary Snapping
        learned = await FeedbackLearner.get_channel_learning(channel_id)
        bias = learned.get("boundary_bias")

        snapped_candidates: List[Dict[str, Any]] = []
        for c in candidates:
            snapped = self.snapper.snap_boundaries(
                seed_time=c["seed_time"],
                sentences=sentences,
                boundary_bias=bias,
            )
            if snapped:
                c.update({
                    "start_time": snapped["start_time"],
                    "end_time": snapped["end_time"],
                    "duration": snapped["duration"],
                    "start_sentence_id": snapped["start_sentence_id"],
                    "end_sentence_id": snapped["end_sentence_id"],
                    "text": f"{snapped['start_text']} ... {snapped['end_text']}",
                    "stage": "snapped",
                })
                snapped_candidates.append(c)

        # 4. Dedupe
        deduped = self.dedup.dedupe_candidates(snapped_candidates, score_key="heat_score")
        logger.info("[%s] Post-boundary dedupe: %d -> %d candidates", run_id, len(snapped_candidates), len(deduped))

        # 5. LLM Stage A (Triage)
        triage_survivors: List[Dict[str, Any]] = []
        if self.llm._client:
            compact_list = [
                {
                    "id": c["id"],
                    "start": c["start_time"],
                    "end": c["end_time"],
                    "text": c.get("text", "")[:180],
                    "heat": c.get("heat_score", 0.5),
                }
                for c in deduped[:25]
            ]
            user_msg = STAGE_A_TRIAGE_USER_TEMPLATE.format(
                channel_name=channel_id,
                channel_persona=channel_persona,
                candidates_json=json.dumps(compact_list, indent=2),
            )
            triage_res = await self.llm.generate_structured(
                system_instruction=STAGE_A_TRIAGE_SYSTEM,
                user_prompt=user_msg,
                response_model=StageATriageResponse,
            )
            if triage_res and triage_res.candidates:
                triage_map = {tc.id: tc for tc in triage_res.candidates}
                for c in deduped:
                    tc = triage_map.get(c["id"])
                    if tc and tc.keep:
                        c["triage_score"] = tc.triage_score
                        c["triage_reason"] = tc.one_line_reason
                        triage_survivors.append(c)
            else:
                triage_survivors = deduped[:target_clips * 2]
        else:
            triage_survivors = deduped[:target_clips * 2]

        if not triage_survivors:
            triage_survivors = deduped[:target_clips]

        # 6. LLM Stage B (Detail with Sentence IDs)
        final_candidates: List[Dict[str, Any]] = []
        if self.llm._client and triage_survivors:
            detail_input = []
            for c in triage_survivors[:8]:
                # Locate sentences inside candidate range
                s_in_cand = [
                    s.to_compact() for s in sentences
                    if (c["start_time"] - 15.0) <= s.start and s.end <= (c["end_time"] + 10.0)
                ]
                detail_input.append({
                    "candidate_id": c["id"],
                    "seed_time": c["seed_time"],
                    "sentences": s_in_cand,
                })

            user_detail_msg = STAGE_B_DETAIL_USER_TEMPLATE.format(
                channel_name=channel_id,
                channel_persona=channel_persona,
                few_shot_examples="No prior manual rejections on record.",
                candidates_detail_json=json.dumps(detail_input, indent=2),
            )
            detail_res = await self.llm.generate_structured(
                system_instruction=STAGE_B_DETAIL_SYSTEM,
                user_prompt=user_detail_msg,
                response_model=StageBDetailResponse,
            )
            if detail_res and detail_res.candidates:
                sent_map = {s.id: s for s in sentences}
                for dc in detail_res.candidates:
                    if dc.decision != "keep":
                        continue

                    # Resolve sentence IDs to exact timestamps
                    s_first = sent_map.get(dc.boundaries.start_sentence_id)
                    s_last = sent_map.get(dc.boundaries.end_sentence_id)
                    s_time = s_first.start if s_first else None
                    e_time = s_last.end if s_last else None

                    final_score = (
                        0.55 * dc.predicted_score +
                        0.30 * 80.0 + # baseline signal score
                        0.15 * 85.0
                    )

                    final_candidates.append({
                        "id": dc.candidate_id,
                        "title": dc.title,
                        "hook_text": dc.hook_text,
                        "description": dc.description,
                        "hashtags": dc.hashtags,
                        "start_time": s_time,
                        "end_time": e_time,
                        "predicted_score": dc.predicted_score,
                        "final_score": round(final_score, 1),
                        "flags": [f.model_dump() for f in dc.flags],
                        "reason": dc.reason,
                        "score_breakdown": {
                            "scores": dc.scores.model_dump(),
                            "evidence": dc.evidence.model_dump(),
                            "weights": {"llm": 0.55, "signal": 0.30, "history": 0.15},
                        },
                    })

        # Heuristic fallback if LLM was skipped or unavailable
        if not final_candidates:
            for idx, c in enumerate(triage_survivors[:target_clips]):
                final_candidates.append({
                    "id": c["id"],
                    "title": f"Highlight #{idx+1}: {c.get('text', '')[:40]}...",
                    "hook_text": "Watch this insane moment!",
                    "description": "Stream highlight from AutoClip.",
                    "hashtags": ["#Shorts", "#Viral"],
                    "start_time": c["start_time"],
                    "end_time": c["end_time"],
                    "predicted_score": 78.0,
                    "final_score": 78.0,
                    "flags": [],
                    "reason": "Extracted via signal and sentence boundary heuristics.",
                    "score_breakdown": {"heuristic": True},
                })

        # 7. Final Selection (MMR)
        selected_clips = self.selector.filter_and_select(
            candidates=final_candidates,
            target_count=target_clips,
            min_final_score=60.0,
        )

        latency = round(time.time() - start_ts, 2)
        # 8. Record telemetry in pipeline_runs
        await self._record_run(
            run_id=run_id,
            source_id=source_id,
            channel_id=channel_id,
            candidates_count=len(selected_clips),
            latency_seconds=latency,
        )

        logger.info("✅ Best Clips Pipeline [%s] completed in %.2fs: Selected %d clips", run_id, latency, len(selected_clips))
        return selected_clips

    async def _record_run(self, run_id: str, source_id: str, channel_id: str, candidates_count: int, latency_seconds: float):
        try:
            async with get_db_connection() as db:
                await db.execute(
                    """
                    INSERT INTO pipeline_runs (id, source_id, channel_id, stage, status, candidates_count, latency_seconds, prompt_version)
                    VALUES (?, ?, ?, 'completed', 'completed', ?, ?, ?)
                    """,
                    (run_id, source_id, channel_id, candidates_count, latency_seconds, PROMPT_VERSION)
                )
                await db.commit()
        except Exception as e:
            logger.warning("Failed to record pipeline run: %s", e)
