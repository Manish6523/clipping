"""Boundary Snapping Engine for Professional Viral Clips.

Takes a seed timestamp (e.g. from a heatmap peak or energy spike) and searches
all valid sentence starts and ends to find the optimal [start, end] window.

Scoring factors:
1. Heat captured across the peak
2. Duration prior (preferred 20-45s via Gaussian penalty, hard min/max clamped)
3. Hook strength in the first 2 seconds (speech density)
4. Context penalty: penalizes starting with conjunctions/pronouns ("and", "so", "but", "he", "they")
5. Lead-in (0.3s - 0.8s) and Tail extension
6. Learned boundary bias from human editor trims
"""

import math
import re
from typing import Any, Callable, Dict, List, Optional, Tuple
from src.intelligence.sentences import Sentence


class BoundarySnapper:
    """Finds high-retention, sentence-aligned clip boundaries around peak seeds."""

    CONJUNCTION_START_PENALTY = re.compile(r"^(and|so|but|or|because|then|he|she|they|it)\b", re.IGNORECASE)

    def __init__(
        self,
        min_duration: float = 15.0,
        max_duration: float = 58.0,
        preferred_min: float = 22.0,
        preferred_max: float = 45.0,
    ):
        self.min_duration = min_duration
        self.max_duration = max_duration
        self.preferred_min = preferred_min
        self.preferred_max = preferred_max

    def snap_boundaries(
        self,
        seed_time: float,
        sentences: List[Sentence],
        heat_function: Optional[Callable[[float], float]] = None,
        boundary_bias: Optional[Dict[str, float]] = None,
    ) -> Optional[Dict[str, Any]]:
        """Searches sentence starts in [seed-35s, seed-3s] and ends in [seed+3s, seed+30s]."""
        if not sentences:
            return None

        # Learned bias offsets (e.g. editor consistently adds +0.5s or trims -1.0s)
        bias_start = 0.0
        bias_end = 0.0
        if boundary_bias:
            bias_start = max(-3.0, min(3.0, float(boundary_bias.get("start_bias", 0.0))))
            bias_end = max(-3.0, min(3.0, float(boundary_bias.get("end_bias", 0.0))))

        # Filter candidate starts and ends
        start_min_search = max(0.0, seed_time - 38.0)
        start_max_search = max(0.0, seed_time - 2.0)
        end_min_search = seed_time + 2.0
        end_max_search = seed_time + 35.0

        valid_starts = [
            s for s in sentences
            if start_min_search <= s.start <= start_max_search
        ]
        valid_ends = [
            s for s in sentences
            if end_min_search <= s.end <= end_max_search
        ]

        # If too strict or near file boundaries, expand candidates
        if not valid_starts:
            valid_starts = [s for s in sentences if s.start <= seed_time]
            if valid_starts:
                valid_starts = valid_starts[-3:]
        if not valid_ends:
            valid_ends = [s for s in sentences if s.end >= seed_time]
            if valid_ends:
                valid_ends = valid_ends[:3]

        if not valid_starts or not valid_ends:
            return None

        best_score = -9999.0
        best_pair: Optional[Tuple[Sentence, Sentence]] = None

        for s_start in valid_starts:
            for s_end in valid_ends:
                if s_end.end <= s_start.start:
                    continue

                duration = s_end.end - s_start.start
                if duration < self.min_duration or duration > self.max_duration:
                    continue

                # 1. Duration score: smooth bell curve peaking around preferred range
                dur_center = (self.preferred_min + self.preferred_max) / 2.0
                dur_score = 10.0 - abs(duration - dur_center) * 0.25

                # 2. Peak capture: check if seed falls naturally in middle/late portion
                rel_peak_pos = (seed_time - s_start.start) / duration
                # Best clips place the climax in the 40% - 85% range
                if 0.35 <= rel_peak_pos <= 0.85:
                    peak_score = 15.0
                elif 0.15 <= rel_peak_pos <= 0.95:
                    peak_score = 8.0
                else:
                    peak_score = 0.0

                # 3. Context penalty: check if opening sentence starts with dangling pronouns/conjunctions
                context_penalty = 0.0
                if self.CONJUNCTION_START_PENALTY.search(s_start.text.strip()):
                    context_penalty = 6.0

                # 4. Opening hook speech density in the first 2 seconds
                hook_window = s_start.start + 2.5
                hook_words = [w for w in s_start.text.split()]
                hook_score = min(8.0, len(hook_words) * 1.5)

                # 5. Integrated heat curve if provided
                heat_val = 0.0
                if heat_function:
                    try:
                        heat_val = float(heat_function((s_start.start + s_end.end) / 2.0)) * 10.0
                    except Exception:
                        pass

                total_score = dur_score + peak_score + hook_score + heat_val - context_penalty
                if total_score > best_score:
                    best_score = total_score
                    best_pair = (s_start, s_end)

        if not best_pair:
            # Fallback to nearest enclosing sentence bounds
            s_first = valid_starts[0]
            s_last = valid_ends[-1]
            best_pair = (s_first, s_last)

        s_first, s_last = best_pair
        # Add slight lead-in (0.4s) and tail buffer (0.5s)
        lead_in = 0.40
        tail = 0.50

        final_start = max(0.0, s_first.start - lead_in + bias_start)
        final_end = s_last.end + tail + bias_end

        return {
            "start_time": round(final_start, 3),
            "end_time": round(final_end, 3),
            "duration": round(final_end - final_start, 3),
            "start_sentence_id": s_first.id,
            "end_sentence_id": s_last.id,
            "start_text": s_first.text,
            "end_text": s_last.text,
            "score": round(best_score, 2),
        }

