"""Candidate Selection with Maximal Marginal Relevance (MMR) and Hard Filters."""

import math
from typing import Any, Dict, List, Optional
from src.intelligence.dedupe import Deduplicator


class CandidateSelector:
    """Ranks and selects diverse, high-scoring clips while enforcing safety and minimum gaps."""

    def __init__(self, min_gap_seconds: float = 60.0, mmr_lambda: float = 0.30):
        self.min_gap_seconds = min_gap_seconds
        self.mmr_lambda = mmr_lambda
        self.dedup = Deduplicator()

    def filter_and_select(
        self,
        candidates: List[Dict[str, Any]],
        target_count: int = 5,
        min_final_score: float = 65.0,
        profanity_policy: str = "allow",  # 'allow', 'bleep', 'reject'
    ) -> List[Dict[str, Any]]:
        """Applies hard filters and runs MMR diverse selection."""
        valid_pool: List[Dict[str, Any]] = []

        for c in candidates:
            # 1. Score check
            score = float(c.get("final_score", c.get("predicted_score", 0.0)))
            if score < min_final_score:
                continue

            # 2. Duration check
            dur = float(c.get("duration", c.get("end_time", 0.0) - c.get("start_time", 0.0)))
            if dur < 12.0 or dur > 65.0:
                continue

            # 3. Profanity / Content Safety check
            flags = c.get("flags", [])
            has_high_severity = any(
                f.get("severity") == "high" for f in flags if isinstance(f, dict)
            )
            if has_high_severity:
                continue

            if profanity_policy == "reject":
                has_profanity = any(
                    f.get("type") == "profanity" for f in flags if isinstance(f, dict)
                )
                if has_profanity:
                    continue

            valid_pool.append(c)

        if not valid_pool:
            return []

        # Sort highest score first
        valid_pool.sort(key=lambda x: float(x.get("final_score", 0.0)), reverse=True)

        selected: List[Dict[str, Any]] = []

        # Pick the absolute best first
        selected.append(valid_pool.pop(0))

        # Iteratively pick items maximizing MMR: Score - (lambda * SimilarityToSelected)
        while valid_pool and len(selected) < target_count:
            best_mmr = -9999.0
            best_idx = -1

            for idx, cand in enumerate(valid_pool):
                c_start = float(cand.get("start_time", 0.0))
                c_end = float(cand.get("end_time", 0.0))
                c_text = str(cand.get("text", cand.get("description", "")))
                c_score = float(cand.get("final_score", 0.0))

                # Check minimum time gap from already selected clips
                violates_gap = False
                for sel in selected:
                    s_start = float(sel.get("start_time", 0.0))
                    s_end = float(sel.get("end_time", 0.0))
                    # Distance between intervals
                    gap = max(0.0, max(c_start - s_end, s_start - c_end))
                    if gap < self.min_gap_seconds:
                        violates_gap = True
                        break

                if violates_gap:
                    continue

                # Compute maximum similarity to already selected clips
                max_sim = 0.0
                for sel in selected:
                    s_text = str(sel.get("text", sel.get("description", "")))
                    sim = self.dedup.calculate_content_similarity(c_text, s_text)
                    if sim > max_sim:
                        max_sim = sim

                mmr = c_score - (self.mmr_lambda * max_sim * 100.0)
                if mmr > best_mmr:
                    best_mmr = mmr
                    best_idx = idx

            if best_idx >= 0:
                selected.append(valid_pool.pop(best_idx))
            else:
                # No more candidates meet the gap requirement
                break

        # Return sorted chronologically for consistent pipeline processing
        return sorted(selected, key=lambda x: float(x.get("start_time", 0.0)))

