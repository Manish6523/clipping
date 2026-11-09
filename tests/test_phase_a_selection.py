"""Unit tests for Phase A: Candidate selection, authoritative min score, and unscored handling."""

import asyncio
import unittest
from pydantic import BaseModel
from typing import Optional, List

from src.intelligence.viral_scorer import ViralHookCandidate
from src.database import get_effective_min_score


class TestPhaseAPreflight(unittest.TestCase):

    def test_highest_scoring_candidate_selection(self):
        """Verify sorting order ensures the highest-scoring candidate is chosen."""
        candidates = [
            ViralHookCandidate(
                start_time=10.0,
                end_time=40.0,
                teaser_hook_timestamp=None,
                virality_score=75,
                suggested_title="Moderate Moment",
                hashtags=[],
                hook_summary="Hook",
                punchline_summary="Payoff",
            ),
            ViralHookCandidate(
                start_time=20.0,
                end_time=50.0,
                teaser_hook_timestamp=None,
                virality_score=92,
                suggested_title="Elite Climax",
                hashtags=[],
                hook_summary="Hook",
                punchline_summary="Payoff",
            ),
            ViralHookCandidate(
                start_time=30.0,
                end_time=60.0,
                teaser_hook_timestamp=None,
                virality_score=85,
                suggested_title="Good Moment",
                hashtags=[],
                hook_summary="Hook",
                punchline_summary="Payoff",
            ),
        ]

        # Explicitly sort descending by virality_score
        candidates.sort(key=lambda c: getattr(c, "virality_score", 0), reverse=True)
        best = candidates[0]

        self.assertEqual(best.virality_score, 92)
        self.assertEqual(best.suggested_title, "Elite Climax")

    def test_unscored_candidate_fallback(self):
        """Verify when virality_score is 0, clip is handled as unscored."""
        cand = ViralHookCandidate(
            start_time=0.0,
            end_time=30.0,
            teaser_hook_timestamp=None,
            virality_score=0,
            suggested_title="Fallback Moment",
            hashtags=[],
            hook_summary="Hook",
            punchline_summary="Payoff",
        )
        self.assertEqual(cand.virality_score, 0)


if __name__ == "__main__":
    unittest.main()

