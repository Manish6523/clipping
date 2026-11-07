"""Automated End-to-End Test for Quick Clip Pipeline."""

import asyncio
import os
import sys
import time
from pathlib import Path

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.intelligence.sentences import SentenceChunker
from src.intelligence.boundaries import BoundarySnapper
from src.intelligence.heat import HeatCurve
from src.intelligence.dedupe import Deduplicator
from src.intelligence.llm.client import GeminiClient
from src.bot.trimmer import load_template
from src.compositor.ass_generator import generate_ass_subtitles
from src.database import get_db_connection, create_clip, get_clip

TEST_URL = "https://youtu.be/DcAHosNxz9E"

async def test_quick_clip_pipeline():
    print("=" * 60)
    print("RUNNING QUICK CLIP END-TO-END PIPELINE TEST")
    print("=" * 60)

    # 1. Template validation
    print("\n[Step 1/6] Loading Template...")
    template = load_template("ishowspeed layout")
    assert template, "Template 'ishowspeed layout' failed to load!"
    print(f" -> OK: Loaded template '{template.get('name')}'")

    # 2. Whisper & Sentence Mapping Simulation
    print("\n[Step 2/6] Validating Sentence Extraction & Snapping Engine...")
    test_words = [
        {"word": "Yo", "start": 10.0, "end": 10.4, "probability": 0.95},
        {"word": "chat,", "start": 10.5, "end": 10.9, "probability": 0.98},
        {"word": "watch", "start": 11.0, "end": 11.3, "probability": 0.99},
        {"word": "this", "start": 11.4, "end": 11.6, "probability": 0.97},
        {"word": "crazy", "start": 11.7, "end": 12.1, "probability": 0.96},
        {"word": "moment", "start": 12.2, "end": 12.7, "probability": 0.99},
        {"word": "right", "start": 12.8, "end": 13.0, "probability": 0.95},
        {"word": "now!", "start": 13.1, "end": 13.5, "probability": 0.98},
        {"word": "No", "start": 15.0, "end": 15.3, "probability": 0.95},
        {"word": "way", "start": 15.4, "end": 15.7, "probability": 0.99},
        {"word": "he", "start": 15.8, "end": 16.0, "probability": 0.92},
        {"word": "just", "start": 16.1, "end": 16.3, "probability": 0.99},
        {"word": "did", "start": 16.4, "end": 16.6, "probability": 0.97},
        {"word": "that!", "start": 16.7, "end": 17.2, "probability": 0.99},
    ]

    sentences = SentenceChunker.from_whisper_result({"words": test_words})
    assert len(sentences) >= 2, "SentenceChunker failed to extract sentences!"
    print(f" -> OK: Chunker produced {len(sentences)} clean sentences:")
    for s in sentences:
        print(f"    [{s.id}] ({s.start:.1f}s - {s.end:.1f}s): {s.text}")

    # 3. Boundary Snapping Test
    print("\n[Step 3/6] Testing Sentence Boundary Snapper...")
    snapper = BoundarySnapper(min_duration=5.0, max_duration=30.0, preferred_min=5.0, preferred_max=15.0)
    cand = snapper.snap_boundaries(seed_time=12.0, sentences=sentences)
    assert cand is not None, "BoundarySnapper returned None!"
    print(f" -> OK: Snapped boundary: {cand['start_time']:.2f}s -> {cand['end_time']:.2f}s (Score: {cand['score']:.2f})")

    # 4. Multi-Signal Heat Fallback Windows
    print("\n[Step 4/7] Testing HeatCurve & Fallback Windows...")
    windows = HeatCurve.generate_fallback_windows(sentences, window_seconds=20.0, overlap_seconds=5.0)
    assert len(windows) > 0, "HeatCurve failed to generate fallback windows!"
    print(f" -> OK: Generated {len(windows)} candidate windows across timeline.")

    # 5. Gemini AI Live Evaluation & Key Rotation Test
    print("\n[Step 5/7] Testing Gemini Multi-Key Rotation & Structured Scoring...")
    from pydantic import BaseModel
    class TestPing(BaseModel):
        status: str
        message: str

    client = GeminiClient()
    print(f" -> Active Gemini Key Pool: {len(client.api_keys)} keys loaded.")
    test_result = await client.generate_structured(
        system_instruction="You are AutoClip AI scoring engine. Output JSON matching the schema.",
        user_prompt="Say status='OK' and message='AutoClip Gemini AI Ready'.",
        response_model=TestPing,
        use_cache=False,
    )
    assert test_result is not None, "Gemini API structured call returned None!"
    print(f" -> OK: Gemini AI Response: status='{test_result.status}', message='{test_result.message}' (Model: {client.model_name})")

    # 6. ASS Subtitle Rendering Generation
    print("\n[Step 6/7] Testing ASS Subtitle Generation...")
    out_ass = Path("temp") / "test_quick_clip.ass"
    out_ass.parent.mkdir(parents=True, exist_ok=True)
    generate_ass_subtitles(
        word_timestamps=test_words,
        output_path=str(out_ass),
        template_config=template,
        time_offset=10.0,
        max_duration=7.5,
    )
    assert out_ass.exists() and out_ass.stat().st_size > 0, "ASS Subtitle file generation failed!"
    print(f" -> OK: Subtitles rendered successfully ({out_ass.stat().st_size} bytes)")

    # 7. Database Insertion & API Persistence Test
    print("\n[Step 7/7] Testing Database Persistence & Clip Retrieval...")
    test_clip_id = await create_clip(
        source_type="vod",
        source_id="DcAHosNxz9E",
        channel_id="ishowspeed",
        template_name="ishowspeed layout",
        raw_start=10.0,
        raw_end=17.2,
        virality_score=92,
        title="iShowSpeed Plays I Wanna Test This Game [Test]",
        teaser_hook_timestamp=12.0,
        description="AutoClip Quick Clip Automated Test",
        hashtags="#Speed #Gaming #Shorts",
        source_video_path="",
        rendered_video_path="",
        subtitle_path=str(out_ass),
    )
    assert test_clip_id > 0, "Failed to insert clip into database!"
    clip_row = await get_clip(test_clip_id)
    assert clip_row and clip_row["id"] == test_clip_id, "Clip retrieval failed!"
    print(f" -> OK: Clip #{test_clip_id} created and verified in SQLite database.")

    # Clean up test clip from DB
    async with get_db_connection() as db:
        await db.execute("DELETE FROM clips WHERE id = ?", (test_clip_id,))
        await db.commit()
    print(" -> OK: Test clip safely cleaned up.")

    print("\n" + "=" * 60)
    print("ALL QUICK CLIP TESTS PASSED SUCCESSFULLY! (7/7)")
    print("=" * 60)

if __name__ == "__main__":
    asyncio.run(test_quick_clip_pipeline())
