"""Temporal and Content Deduplication Engine for Candidates and Clips.

Prevents duplicate clips within a video and across past channel clips:
1. Temporal overlap: intersection / min(len_a, len_b) > threshold (default 0.25).
2. Content similarity: word-level character n-gram Jaccard index on transcripts.
"""

import re
from typing import Any, Dict, List, Set


class Deduplicator:
    """Filters duplicate candidates and recent channel clips."""

    def __init__(self, temporal_threshold: float = 0.25, content_threshold: float = 0.65):
        self.temporal_threshold = temporal_threshold
        self.content_threshold = content_threshold

    def calculate_temporal_overlap(self, a_start: float, a_end: float, b_start: float, b_end: float) -> float:
        """Computes overlap ratio: intersection / min(len_a, len_b)."""
        inter_start = max(a_start, b_start)
        inter_end = min(a_end, b_end)
        intersection = max(0.0, inter_end - inter_start)
        len_a = max(0.1, a_end - a_start)
        len_b = max(0.1, b_end - b_start)
        return intersection / min(len_a, len_b)

    @staticmethod
    def _text_to_ngrams(text: str, n: int = 3) -> Set[str]:
        cleaned = re.sub(r"[^\w\s]", "", text.lower()).strip()
        words = cleaned.split()
        if len(words) < n:
            return {" ".join(words)}
        return {" ".join(words[i:i+n]) for i in range(len(words) - n + 1)}

    def calculate_content_similarity(self, text_a: str, text_b: str) -> float:
        """Jaccard similarity on word 3-grams."""
        if not text_a or not text_b:
            return 0.0
        ngrams_a = self._text_to_ngrams(text_a)
        ngrams_b = self._text_to_ngrams(text_b)
        if not ngrams_a or not ngrams_b:
            return 0.0
        intersection = len(ngrams_a.intersection(ngrams_b))
        union = len(ngrams_a.union(ngrams_b))
        return intersection / union if union > 0 else 0.0

    def dedupe_candidates(self, candidates: List[Dict[str, Any]], score_key: str = "final_score") -> List[Dict[str, Any]]:
        """Deduplicates a candidate list by keeping the highest scoring item on overlap."""
        if not candidates:
            return []

        # Sort highest score first
        sorted_candidates = sorted(
            candidates,
            key=lambda c: float(c.get(score_key, c.get("predicted_score", c.get("heat_score", 0.0)))),
            reverse=True,
        )

        kept: List[Dict[str, Any]] = []
        for cand in sorted_candidates:
            s1 = float(cand.get("start_time", 0.0))
            e1 = float(cand.get("end_time", 0.0))
            t1 = str(cand.get("text", cand.get("description", "")))

            is_duplicate = False
            for existing in kept:
                s2 = float(existing.get("start_time", 0.0))
                e2 = float(existing.get("end_time", 0.0))
                t2 = str(existing.get("text", existing.get("description", "")))

                # Check temporal overlap
                temporal_ratio = self.calculate_temporal_overlap(s1, e1, s2, e2)
                if temporal_ratio > self.temporal_threshold:
                    is_duplicate = True
                    break

                # Check content duplicate
                if t1 and t2:
                    content_ratio = self.calculate_content_similarity(t1, t2)
                    if content_ratio > self.content_threshold:
                        is_duplicate = True
                        break

            if not is_duplicate:
                kept.append(cand)

        # Restore chronological order for the downstream pipeline
        return sorted(kept, key=lambda c: float(c.get("start_time", 0.0)))

