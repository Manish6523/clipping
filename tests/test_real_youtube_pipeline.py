"""Real Video End-to-End Pipeline Verification with Gemini AI."""

import asyncio
import os
import sys
from pathlib import Path
from pydantic import BaseModel

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.intelligence.sentences import SentenceChunker
from src.intelligence.boundaries import BoundarySnapper
from src.intelligence.heat import HeatCurve
from src.intelligence.llm.client import GeminiClient
from src.bot.trimmer import load_template
from src.compositor.ass_generator import generate_ass_subtitles
from src.database import get_db_connection, create_clip, get_clip
from src.intelligence.transcriber import Transcriber

TEST_URL = "https://youtu.be/WhnjxhYksUY"
AUDIO_FILE = Path("temp") / "test_audio.m4a"

class VideoScoreEvaluation(BaseModel):
    virality_score: int
    hook_rating: int
    suggested_title: str
    hook_summary: str
    reason: str

async def run_pipeline_on_real_audio():
    print("=" * 65)
    print("REAL YOUTUBE AUDIO PIPELINE & GEMINI AI EVALUATION")
    print(f"Source Video: {TEST_URL}")
    print(f"Downloaded Audio Track: {AUDIO_FILE} ({AUDIO_FILE.stat().st_size / 1024:.1f} KB)")
    print("=" * 65)

    # 1. Transcribe real audio with faster-whisper
    print("\n[Stage 1/5] Transcribing Real YouTube Audio Slice...")
    transcriber = Transcriber()
    transcript = await transcriber.transcribe(str(AUDIO_FILE))
    words = transcript.get("words", [])
    raw_text = transcript.get("text", "")
    print(f" -> OK: Transcribed {len(words)} words across 30 seconds.")
    print(f" -> Speech snippet: \"{raw_text.strip()}\"")

    # 2. Sentence Mapping
    print("\n[Stage 2/5] Mapping Words to Discrete Sentence IDs...")
    sentences = SentenceChunker.from_whisper_result(transcript)
    assert len(sentences) > 0, "No sentences extracted!"
    print(f" -> OK: Formed {len(sentences)} clean sentences:")
    for s in sentences:
        print(f"    [{s.id}] ({s.start:.2f}s - {s.end:.2f}s): {s.text}")

    # 3. Boundary Snapper
    print("\n[Stage 3/5] Boundary Snapper Alignment...")
    snapper = BoundarySnapper(min_duration=10.0, max_duration=30.0, preferred_min=12.0, preferred_max=25.0)
    best_cand = snapper.snap_boundaries(seed_time=15.0, sentences=sentences)
    assert best_cand is not None, "Boundary snapper failed!"
    print(f" -> OK: Optimal Hook-Aligned Window: {best_cand['start_time']:.2f}s -> {best_cand['end_time']:.2f}s (Duration: {best_cand['end_time'] - best_cand['start_time']:.1f}s)")

    # 4. Live Gemini AI Structured Scoring
    print("\n[Stage 4/5] Sending Real Speech to Gemini AI for Viral Scoring...")
    client = GeminiClient()
    print(f" -> Connecting to Gemini API (Model: {client.model_name})...")

    prompt = f"""Evaluate this real video speech moment for viral Short / Reel potential:
"{raw_text}"

Score strictly following viral video guidelines:
- virality_score (0-100)
- hook_rating (0-10)
- suggested_title (catchy, high CTR title)
- hook_summary (what happens in the first 2 seconds)
- reason (why this moment works or doesn't work as a short)"""

    evaluation = await client.generate_structured(
        system_instruction="You are an expert Short-form video editor specialized in YouTube Shorts & TikTok virality.",
        user_prompt=prompt,
        response_model=VideoScoreEvaluation,
        use_cache=False,
    )
    assert evaluation is not None, "Gemini call failed!"
    print(f" -> OK: Gemini Virality Score: {evaluation.virality_score}/100")
    print(f" -> OK: Hook Rating: {evaluation.hook_rating}/10")
    print(f" -> OK: Suggested Title: '{evaluation.suggested_title}'")
    print(f" -> OK: Hook Summary: '{evaluation.hook_summary}'")
    print(f" -> OK: AI Analysis: {evaluation.reason}")

    # 5. ASS Subtitle Rendering & Database Persistence
    print("\n[Stage 5/5] Generating Subtitles and SQLite Registration...")
    template = load_template("ishowspeed layout")
    out_ass = Path("temp") / "real_video_clip.ass"
    generate_ass_subtitles(
        word_timestamps=words,
        output_path=str(out_ass),
        template_config=template,
        time_offset=best_cand['start_time'],
        max_duration=best_cand['end_time'] - best_cand['start_time'],
    )
    assert out_ass.exists(), "ASS generation failed!"

    clip_id = await create_clip(
        source_type="vod",
        source_id="WhnjxhYksUY",
        channel_id="ishowspeed",
        template_name="ishowspeed layout",
        raw_start=60.0 + best_cand['start_time'],
        raw_end=60.0 + best_cand['end_time'],
        virality_score=evaluation.virality_score,
        title=evaluation.suggested_title,
        teaser_hook_timestamp=None,
        description=evaluation.hook_summary,
        hashtags="#Shorts #Speed #Reacting",
        source_video_path=str(AUDIO_FILE),
        rendered_video_path="",
        subtitle_path=str(out_ass),
    )
    print(f" -> OK: Clip #{clip_id} registered successfully in database.")

    # Clean up test database row
    async with get_db_connection() as db:
        await db.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
        await db.commit()
    print(" -> OK: Test clip record cleaned up.")

    print("\n" + "=" * 65)
    print("COMPLETE REAL VIDEO + GEMINI AI TEST PASSED WITH 100% SUCCESS!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(run_pipeline_on_real_audio())
