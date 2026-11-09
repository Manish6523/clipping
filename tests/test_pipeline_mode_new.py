import os
import unittest
from unittest.mock import AsyncMock, patch, MagicMock
from src.database import init_db
from src.intelligence.sentences import SentenceChunker
from src.intelligence.calibrated_judge import CalibratedJudge


class TestNewPipelineMode(unittest.IsolatedAsyncioTestCase):
    async def asyncSetUp(self):
        os.environ["DATABASE_PATH"] = ":memory:"
        os.environ["PIPELINE_MODE"] = "new"
        await init_db()

    async def test_calibrated_judge_new_pipeline_mode(self):
        judge = CalibratedJudge(model_name="gemini-flash-lite-latest")
        
        # Fake whisper result with clear sentence
        transcription = {
            "text": "Look at him right behind the corner! Oh my god he got me!",
            "segments": [
                {
                    "start": 10.0,
                    "end": 15.0,
                    "text": "Look at him right behind the corner! Oh my god he got me!",
                    "words": [
                        {"word": "Look", "start": 10.0, "end": 10.5},
                        {"word": "at", "start": 10.5, "end": 10.7},
                        {"word": "him", "start": 10.7, "end": 11.0},
                        {"word": "right", "start": 11.0, "end": 11.3},
                        {"word": "behind", "start": 11.3, "end": 11.8},
                        {"word": "the", "start": 11.8, "end": 12.0},
                        {"word": "corner!", "start": 12.0, "end": 12.5},
                        {"word": "Oh", "start": 12.6, "end": 12.8},
                        {"word": "my", "start": 12.8, "end": 13.0},
                        {"word": "god", "start": 13.0, "end": 13.5},
                        {"word": "he", "start": 13.5, "end": 13.7},
                        {"word": "got", "start": 13.7, "end": 14.0},
                        {"word": "me!", "start": 14.0, "end": 14.5},
                    ]
                }
            ]
        }
        sentences = SentenceChunker.from_whisper_result(transcription)
        self.assertGreater(len(sentences), 0)

        # Mock the Gemini call in evaluate_moment
        from src.intelligence.llm.judge_schemas import (
            JudgeEvaluationResponse,
            JudgeClipEvaluation,
            RubricScores1to5,
            JudgeCandidateEvidence,
            SentenceSelection,
        )

        mock_candidate = JudgeClipEvaluation(
            candidate_id="c01",
            would_post=True,
            reject_reason=None,
            scores=RubricScores1to5(
                hook_2s=5,
                stands_alone=5,
                payoff=5,
                emotion=5,
                shareability=5,
                pacing=4,
                clarity=5,
            ),
            evidence=JudgeCandidateEvidence(
                hook_quote="Look at him",
                payoff_quote="he got me",
            ),
            boundaries=SentenceSelection(
                start_sentence_id=sentences[0].id,
                end_sentence_id=sentences[-1].id,
            ),
            teaser_hook_sentence_id=None,
            title="Unexpected Jump Scare!",
            title_alts=["Bro Ambushed Me", "Instant Screams"],
            hook_text="HE SPAWNED BEHIND ME!",
            description="Streamer ambushed near corner",
            hashtags=["#EldenRing", "#JumpScare"],
            flags=[],
            editorial_reason="High energy hook with clear standalone reaction",
        )
        mock_response = JudgeEvaluationResponse(candidates=[mock_candidate])

        with patch.object(judge.client, "generate_structured", new_callable=AsyncMock) as mock_gen:
            mock_gen.return_value = mock_response
            results = await judge.evaluate_moment(
                channel_id="kaicenat",
                sentences=sentences,
                trigger_context={"type": "chat_spike", "current_velocity": 2.5, "baseline_velocity": 1.0},
                chat_features={"rolling_mps": 2.5, "top_emotes": ["W", "LMAO"]},
                min_score=65
            )

            self.assertEqual(len(results), 1)
            best = results[0]
            self.assertGreaterEqual(best["virality_score"], 65)
            self.assertEqual(best["title"], "Unexpected Jump Scare!")
            self.assertEqual(best["scores"]["hook_2s"], 5)
            self.assertIn("final_score", best)


if __name__ == "__main__":
    unittest.main()
