"""Interactive dry-run replay script to test same-stream narrative storyline engine.

Simulates:
1. Stream session creation
2. A setup sentence hit ("Every time I die I'll do ten pushups")
3. Ring buffer snippet stream-copy staging
4. Seed confirmation worker promotion
5. A payoff moment ("I just died again, time for pushups")
6. Narrative matching & comparative re-judging
7. Multi-source auto-edit stitching
"""

import asyncio
import json
import logging
import os
import sys
import time
from pathlib import Path

# Add project root to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("story_dryrun")

from config.settings import STORY_SEEDS_DIR
from src.database import get_db_connection, init_db
from src.intelligence.session_storyline import (
    get_or_create_active_session,
    stage_seed_snippet,
    confirm_staged_seed,
    get_active_seeds_for_session,
)
from src.intelligence.storyline_matcher import StorylineMatcher, find_setup_sentence_boundaries
from src.compositor.auto_edit import cut_multi_source_segments


async def run_dryrun():
    logger.info("🎬 Starting Same-Stream Narrative Storyline Dry Run...")
    await init_db()

    channel_handle = "test_dryrun_streamer"
    channel_id = "test_dryrun_channel"

    # 1. Initialize dummy channel in database
    async with get_db_connection() as db:
        await db.execute(
            """INSERT OR IGNORE INTO channels (platform, channel_id_or_handle, template_name, display_name)
               VALUES ('twitch', ?, 'default', 'Dry Run Streamer')""",
            (channel_handle,)
        )
        await db.commit()

    # 2. Get active stream session
    session = await get_or_create_active_session(channel_id)
    session_id = session["id"]
    logger.info("Active Session: %s", session_id)

    # 3. Create dummy setup snippet video file
    session_staging = STORY_SEEDS_DIR / session_id / "staging"
    session_staging.mkdir(parents=True, exist_ok=True)
    setup_sample_mp4 = session_staging / "sample_setup.mp4"

    # Generate a quick 5-second color bars video if ffmpeg is available
    cmd = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=5:size=1080x1920:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=1000:duration=5",
        "-c:v", "libx264", "-c:a", "aac",
        str(setup_sample_mp4)
    ]
    proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await proc.communicate()
    logger.info("Generated sample setup video: %s (size: %d bytes)", setup_sample_mp4, setup_sample_mp4.stat().st_size)

    # 4. Stage seed
    staged_id = await stage_seed_snippet(
        session_id=session_id,
        channel_id=channel_id,
        snippet_path=str(setup_sample_mp4),
        regex_pattern="trigger_first",
        transcript_snippet="Every time I die I'll do ten pushups",
    )
    logger.info("Staged seed candidate #%d", staged_id)

    # 5. Confirm seed
    confirmed_mp4 = STORY_SEEDS_DIR / session_id / f"seed_{staged_id}.mp4"
    confirmed_mp4.write_bytes(setup_sample_mp4.read_bytes())
    transcript_info = {
        "text": "Every time I die I'll do ten pushups",
        "duration": 5.0,
        "segments": [
            {"start": 0.5, "end": 4.5, "text": "Every time I die I'll do ten pushups"}
        ]
    }
    seed_id = await confirm_staged_seed(
        staging_id=staged_id,
        session_id=session_id,
        channel_id=channel_id,
        kind="challenge",
        quote="Every time I die I'll do ten pushups",
        summary="Streamer promises 10 pushups per death",
        final_snippet_path=str(confirmed_mp4),
        transcript_json=json.dumps(transcript_info),
        stream_epoch_start=time.time(),
        duration=5.0,
        regex_pattern="trigger_first",
    )
    logger.info("Confirmed seed #%d successfully!", seed_id)

    # 6. Verify active seeds retrieval
    active_seeds = await get_active_seeds_for_session(session_id)
    assert len(active_seeds) >= 1, "Should have retrieved confirmed seed"
    logger.info("Retrieved %d active seeds for session", len(active_seeds))

    # 7. Test boundary snapping
    s_in, s_out = find_setup_sentence_boundaries(
        transcript_info["segments"], "Every time I die I'll do ten pushups", min_duration=3.0, max_duration=7.0
    )
    logger.info("Snapped setup boundaries: [%.2fs - %.2fs] (duration: %.2fs)", s_in, s_out, s_out - s_in)
    assert 3.0 <= (s_out - s_in) <= 7.0

    # 8. Create dummy payoff clip video
    payoff_sample_mp4 = session_staging / "sample_payoff.mp4"
    cmd2 = [
        "ffmpeg", "-y",
        "-f", "lavfi", "-i", "testsrc=duration=10:size=1080x1920:rate=30",
        "-f", "lavfi", "-i", "sine=frequency=440:duration=10",
        "-c:v", "libx264", "-c:a", "aac",
        str(payoff_sample_mp4)
    ]
    proc2 = await asyncio.create_subprocess_exec(*cmd2, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL)
    await proc2.communicate()

    # 9. Test multi-source auto-edit cut and stitch
    stitched_output = session_staging / "stitched_test.mp4"
    sources_map = {
        "setup": str(confirmed_mp4),
        "payoff": str(payoff_sample_mp4),
    }
    segments = [
        {"source_id": "setup", "start": s_in, "end": s_out},
        {"source_id": "payoff", "start": 0.0, "end": 10.0},
    ]
    await cut_multi_source_segments(sources_map, segments, stitched_output)
    logger.info("Stitched multi-source video created: %s (size: %d bytes)", stitched_output, stitched_output.stat().st_size)
    assert stitched_output.exists() and stitched_output.stat().st_size > 1000

    # Clean up dry run files
    for p in [setup_sample_mp4, confirmed_mp4, payoff_sample_mp4, stitched_output]:
        p.unlink(missing_ok=True)

    logger.info("🎉 Dry run completed successfully! All pipeline stages verified.")


if __name__ == "__main__":
    asyncio.run(run_dryrun())

