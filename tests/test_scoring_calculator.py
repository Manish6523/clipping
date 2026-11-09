import unittest
from src.intelligence.llm.judge_schemas import RubricScores1to5
from src.intelligence.scoring_calculator import calculate_predicted_score, calculate_final_score

class TestScoringCalculator(unittest.TestCase):
    def test_all_fives_returns_100(self):
        scores = RubricScores1to5(
            hook_2s=5, stands_alone=5, payoff=5, emotion=5,
            shareability=5, pacing=5, clarity=5
        )
        pred = calculate_predicted_score(scores, would_post=True)
        self.assertEqual(pred, 100.0)

    def test_all_ones_returns_zero(self):
        scores = RubricScores1to5(
            hook_2s=1, stands_alone=1, payoff=1, emotion=1,
            shareability=1, pacing=1, clarity=1
        )
        pred = calculate_predicted_score(scores, would_post=False)
        self.assertEqual(pred, 0.0)

    def test_stands_alone_cap_at_55(self):
        # High scores elsewhere, but stands_alone is 2
        scores = RubricScores1to5(
            hook_2s=5, stands_alone=2, payoff=5, emotion=5,
            shareability=5, pacing=5, clarity=5
        )
        pred = calculate_predicted_score(scores, would_post=True)
        # Without cap, would be > 80. Cap should force <= 55.0
        self.assertLessEqual(pred, 55.0)

    def test_would_post_false_cap_at_50(self):
        scores = RubricScores1to5(
            hook_2s=5, stands_alone=5, payoff=5, emotion=5,
            shareability=5, pacing=5, clarity=5
        )
        pred = calculate_predicted_score(scores, would_post=False)
        self.assertLessEqual(pred, 50.0)

    def test_final_score_formula(self):
        # 0.70 * 80 + 0.30 * 90 = 56 + 27 = 83.0
        final = calculate_final_score(predicted_score=80.0, signal_score=90.0)
        self.assertEqual(final, 83.0)

if __name__ == "__main__":
    unittest.main()

