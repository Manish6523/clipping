"""Calibrated Scoring Calculator for Phase D Judge.

Translates 1-5 rubric scores into a continuous 0-100 predicted score:
    predicted = 100 * sum(w_i * (score_i - 1) / 4)

Weights:
    hook_2s:       0.25
    stands_alone:  0.20
    payoff:        0.20
    emotion:       0.15
    shareability:  0.10
    pacing:        0.05
    clarity:       0.05

Hard caps:
    If stands_alone <= 2: capped at 55
    If would_post is False: capped at 50

Final Score:
    final = 0.70 * predicted + 0.30 * signal
"""

from typing import Any, Dict, Optional
from src.intelligence.llm.judge_schemas import RubricScores1to5

RUBRIC_WEIGHTS = {
    "hook_2s": 0.25,
    "stands_alone": 0.20,
    "payoff": 0.20,
    "emotion": 0.15,
    "shareability": 0.10,
    "pacing": 0.05,
    "clarity": 0.05,
}


def calculate_predicted_score(scores: RubricScores1to5, would_post: bool = True) -> float:
    """Calculate normalized predicted virality score (0.0 to 100.0) from 1-5 rubric."""
    # Linear mapping: score 1 -> 0.0, score 5 -> 1.0
    s_dict = scores.model_dump() if hasattr(scores, "model_dump") else scores

    raw_sum = 0.0
    for dim, weight in RUBRIC_WEIGHTS.items():
        val = float(s_dict.get(dim, 3))
        # Clamp val between 1 and 5
        clamped = max(1.0, min(5.0, val))
        normalized = (clamped - 1.0) / 4.0
        raw_sum += weight * normalized

    predicted = raw_sum * 100.0

    # Deterministic hard caps
    if float(s_dict.get("stands_alone", 3)) <= 2:
        predicted = min(predicted, 55.0)

    if not would_post:
        predicted = min(predicted, 50.0)

    return round(max(0.0, min(100.0, predicted)), 1)


def calculate_final_score(predicted_score: float, signal_score: Optional[float] = None) -> float:
    """Combine predicted LLM score with real stream signal telemetry.
    If no signal score is provided, predicted score is used directly.
    """
    if signal_score is None:
        return predicted_score

    # final = 0.70 * predicted + 0.30 * signal
    final = 0.70 * predicted_score + 0.30 * float(signal_score)
    return round(max(0.0, min(100.0, final)), 1)
