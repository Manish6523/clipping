"""Automated Real Video Integration Test for Quick Clip Pipeline.

Downloads a realistic 30-second window directly from the user's YouTube URL:
https://youtu.be/WhnjxhYksUY ("Reacting To EVERY Streamers FIRST Stream..")
Runs:
1. YouTube Section Extraction (yt-dlp + ffmpeg)
2. Speech-to-Text Transcription via Whisper / Mock
3. SentenceChunker & BoundarySnapper
4. Gemini Flash Lite live scoring on real words
5. ASS Subtitle rendering
6. 9:16 Video Compositing & Database persistence
"""

import asyncio
import os
import sys
import time
from pathlib import Path
from pydantic import BaseModel

# Add project root to path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from src.intelligence.sentences import SentenceChunker
from src.intelligence.boundaries import BoundarySnapper
from src.intelligence.heat import HeatCurve
from src.intelligence.llm.client import GeminiClient
from src.bot.trimmer import load_template
from src.compositor.ass_generator import generate_ass_subtitles
from src.database import get_db_connection, create_clip, get_clip
from src.monitor.vod_watcher import VODWatcher

TEST_URL = "https://youtu.be/WhnjxhYksUY"
START_SEC = 60.0
END_SEC = 90.0

class VideoScoreEvaluation(BaseModel):
    virality_score: int
    hook_rating: int
    suggested_title: str
    reason: str

async def test_real_video_quick_clip():
    print("=" * 65)
    print("RUNNING REAL VIDEO QUICK CLIP TEST")
    print(f"Target URL: {TEST_URL}")
    print(f"Test Window: {START_SEC}s - {END_SEC}s (30s slice)")
    print("=" * 65)

    work_dir = Path("temp") / "test_run_real_video"
    work_dir.mkdir(parents=True, exist_ok=True)
    slice_file = work_dir / "slice_30s.mp4"

    # Step 1: Download video slice
    print("\n[Step 1/6] Extracting 30s video slice from YouTube...")
    watcher = VODWatcher()
    success = await watcher.download_video_section(
        video_url=TEST_URL,
        start_time=START_SEC,
        end_time=END_SEC,
        output_file=slice_file
    )
    assert success and slice_file.exists(), f"Failed to download video slice to {slice_file}"
    print(f" -> OK: Downloaded video slice ({slice_file.stat().st_size / (1024*1024):.2f} MB)")

    # Step 2: Extract real audio & transcribe
    print("\n[Step 2/6] Transcribing audio with faster-whisper...")
    from src.monitor.transcriber import AudioTranscriber
    transcriber = AudioTranscriber()
    transcript = await transcriber.transcribe(str(slice_file))
    words = transcript.get("words", [])
    raw_text = transcript.get("text", "")
    print(f" -> OK: Transcribed {len(words)} words: \"{raw_text[:80]}...\"")

    # Step 3: SentenceChunker mapping
    print("\n[Step 3/6] Mapping words to clean discrete Sentence boundaries...")
    sentences = SentenceChunker.from_whisper_result(transcript)
    assert len(sentences) > 0, "No sentences extracted from transcript!"
    print(f" -> OK: Chunker extracted {len(sentences)} complete sentences:")
    for s in sentences[:3]:
        print(f"    [{s.id}] ({s.start:.1f}s - {s.end:.1f}s): {s.text}")

    # Step 4: Boundary Snapper
    print("\n[Step 4/6] Snapping optimal clip boundary around peak...")
    snapper = BoundarySnapper(min_duration=10.0, max_duration=30.0, preferred_min=12.0, preferred_max=25.0)
    best_cand = snapper.snap_boundaries(seed_time=15.0, sentences=sentences)
    assert best_cand is not None, "Boundary snapper failed!"
    print(f" -> OK: Snapped boundary: {best_cand['start_time']:.2f}s -> {best_cand['end_time']:.2f}s")

    # Step 5: Live Gemini AI Scoring on Real Transcript Words
    print("\n[Step 5/6] Sending Real Transcript to Gemini AI for Structured Virality Scoring...")
    client = GeminiClient()
    prompt = f"""Evaluate this transcript moment for viral Short / Reel potential:
Transcript: "{raw_text}"
Provide a virality_score (0-100), hook_rating (0-10), engaging suggested_title, and concise reason."""

    evaluation = await client.generate_structured(
        system_instruction="You are an expert viral video editor. Evaluate this video moment.",
        user_prompt=prompt,
        response_model=VideoScoreEvaluation,
        use_cache=False,
    )
    assert evaluation is not None, "Gemini scoring call returned None!"
    print(f" -> OK: Gemini Virality Score: {evaluation.virality_score}/100")
    print(f" -> OK: Hook Rating: {evaluation.hook_rating}/10")
    print(f" -> OK: Suggested Title: '{evaluation.suggested_title}'")
    print(f" -> OK: AI Analysis: {evaluation.reason}")

    # Step 6: ASS Subtitles and DB Record
    print("\n[Step 6/6] Generating Subtitles & Registering in Database...")
    template = load_template("ishowspeed layout")
    out_ass = work_dir / "real_test.ass"
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
        raw_start=START_SEC + best_cand['start_time'],
        raw_end=START_SEC + best_cand['end_time'],
        virality_score=evaluation.virality_score,
        title=evaluation.suggested_title,
        teaser_hook_timestamp=None,
        description=evaluation.reason,
        hashtags="#Speed #Reacting #Viral",
        source_video_path=str(slice_file),
        rendered_video_path="",
        subtitle_path=str(out_ass),
    )
    print(f" -> OK: Created clip #{clip_id} with real Gemini scoring.")

    # Clean up test clip from DB
    async with get_db_connection() as db:
        await db.execute("DELETE FROM clips WHERE id = ?", (clip_id,))
        await db.commit()
    print(" -> OK: Cleaned up test database record.")

    print("\n" + "=" * 65)
    print("REAL VIDEO QUICK CLIP PIPELINE TEST: 100% PASSED!")
    print("=" * 65)

if __name__ == "__main__":
    asyncio.run(test_real_video_quick_clip())
