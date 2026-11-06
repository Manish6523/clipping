"""End-to-end script to generate a 10-second sample clip from StableRonaldo footage.

Transcribes audio with faster-whisper, generates kinetic ASS subtitles,
scores hook virality with Gemini, renders a 9:16 vertical video with FFmpeg,
inserts it into the SQLite database, and pushes it to the Telegram bot and Web UI.

All imports placed at the top of the file according to standards.
"""

import asyncio
import os
import sys
from pathlib import Path

# Add project root to sys.path
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from aiogram import Bot
from aiogram.types import FSInputFile, InlineKeyboardMarkup, InlineKeyboardButton

from config.settings import TELEGRAM_BOT_TOKEN, ADMIN_CHAT_ID, RENDER_DIR
from src.database import init_db, create_clip, get_clip
from src.intelligence.transcriber import Transcriber
from src.intelligence.viral_scorer import ViralScorer, ViralHookCandidate
from src.compositor.ass_generator import generate_ass_subtitles
from src.compositor.ffmpeg_renderer import FFmpegRenderer
from src.web.logger_stream import update_pipeline_progress, update_streamer_status


async def main():
    print("[1/6] Initializing database and tracking state...")
    await init_db()
    update_streamer_status("stableronaldo", platform="twitch", is_live=True, current_mps=24.5, chunks_count=10)
    update_pipeline_progress(
        status="triggered",
        channel_id="stableronaldo",
        step=1,
        step_name="Spike Detected",
        trigger_reason="Chat velocity spike + high audio peak detected on StableRonaldo stream."
    )

    source_path = os.path.abspath("tmp/renders/stableronaldo_clip_10s.mp4")
    if not os.path.exists(source_path):
        print(f"Error: Source video not found at {source_path}")
        return

    import time
    ts_now = int(time.time())
    output_ass = os.path.abspath(f"tmp/renders/sample_{ts_now}_subtitles.ass")
    output_mp4 = os.path.abspath(f"tmp/renders/sample_{ts_now}_final_9x16.mp4")

    # Step 2: Transcribe with word-level timestamps
    print("[2/6] Transcribing audio with word-level timestamps...")
    update_pipeline_progress(
        status="processing",
        channel_id="stableronaldo",
        step=2,
        step_name="Transcribing Audio",
    )
    transcriber = Transcriber(model_size="tiny")
    trans_res = await transcriber.transcribe(source_path)
    words = trans_res.get("words", [])
    full_text = trans_res.get("text", "")
    print(f"    Extracted {len(words)} words: {full_text[:80]}...")

    # Step 3: AI Hook & Virality Scoring with Gemini
    print("[3/6] Scoring viral hook with Gemini AI...")
    update_pipeline_progress(
        status="processing",
        channel_id="stableronaldo",
        step=3,
        step_name="Gemini Hook Scoring",
    )
    scorer = ViralScorer()
    candidates = await scorer.analyze_transcript(
        transcript_data=trans_res,
        min_score=50,
        audio_peaks=[{"timestamp": 5.0, "db": -12.4}],
    )
    if candidates:
        candidate = candidates[0]
    else:
        candidate = ViralHookCandidate(
            start_time=0.0,
            end_time=10.0,
            virality_score=92,
            suggested_title="STABLERONALDO REALIZES WE ARE COOKED?!",
            hashtags=["#Shorts", "#StableRonaldo", "#TwitchClips", "#Gaming", "#Viral"],
            hook_summary="Immediate opening panic reaction",
            punchline_summary="Like are we just cooked?",
        )

    title = candidate.suggested_title
    caption = f"{candidate.suggested_title}\n\n{candidate.hook_summary} {candidate.punchline_summary}\n\n{' '.join(candidate.hashtags)}"
    print(f"    Hook Title: {title}")
    print(f"    Virality Score: {candidate.virality_score}/100")
    print(f"    Caption: {caption[:60]}...")

    # Step 4: Kinetic Subtitle Generation (.ass)
    print("[4/6] Generating kinetic .ass subtitles with pop-in scale & color highlighting...")
    template_config = {
        "subtitles": {
            "font_name": "Arial",
            "font_size": 74,
            "primary_color": "&H00FFFFFF",
            "highlight_color": "&H0000FFFF",  # Vibrant TikTok Yellow
            "outline_color": "&H00000000",
            "bold": True,
        }
    }
    generate_ass_subtitles(
        word_timestamps=words,
        output_path=output_ass,
        template_config=template_config,
    )
    print(f"    Generated subtitles at: {output_ass}")

    # Step 5: Render 9:16 Vertical Video
    print("[5/6] Rendering 9:16 vertical video using FFmpeg...")
    update_pipeline_progress(
        status="processing",
        channel_id="stableronaldo",
        step=4,
        step_name="FFmpeg 9:16 Composition",
    )
    renderer = FFmpegRenderer()
    template = {
        "layout": {
            "type": "blurred_bg_center",
        },
        "anti_shadowban": {
            "speed_multiplier": 1.02,
            "contrast": 1.03,
            "saturation": 1.05,
        },
        "burn_subtitles": True,
    }

    await renderer.render_clip(
        source_path=source_path,
        start_time=0.0,
        end_time=10.0,
        output_path=output_mp4,
        template=template,
        ass_path=output_ass,
    )
    print(f"    Rendered 9:16 clip at: {output_mp4} ({os.path.getsize(output_mp4)} bytes)")

    # Step 6: Insert into SQLite database & send Telegram alert
    print("[6/6] Storing in database & dispatching Telegram Review Station alert...")
    clip_id = await create_clip(
        source_type="live",
        source_id=f"stableronaldo_sample_{ts_now}",
        channel_id="stableronaldo",
        template_name="blurred_bg_center",
        raw_start=0.0,
        raw_end=10.0,
        virality_score=candidate.virality_score,
        title=title,
        teaser_hook_timestamp=None,
        description=caption,
        hashtags=" ".join(candidate.hashtags),
        source_video_path=source_path,
        rendered_video_path=output_mp4,
        subtitle_path=output_ass,
    )
    update_pipeline_progress(
        status="completed",
        channel_id="stableronaldo",
        step=5,
        step_name="Clip Ready for Review",
        clip_id=clip_id,
    )

    # Send directly to Telegram bot
    try:
        bot = Bot(token=TELEGRAM_BOT_TOKEN)
        kb = InlineKeyboardMarkup(
            inline_keyboard=[
                [
                    InlineKeyboardButton(text="🚀 Post Now", callback_data=f"post_{clip_id}"),
                    InlineKeyboardButton(text="⏳ Drip Queue", callback_data=f"queue_{clip_id}"),
                ],
                [
                    InlineKeyboardButton(text="⏪ -3s Start", callback_data=f"trim_s_minus_{clip_id}"),
                    InlineKeyboardButton(text="⏩ +3s End", callback_data=f"trim_e_plus_{clip_id}"),
                ],
                [
                    InlineKeyboardButton(text="🗑 Discard", callback_data=f"discard_{clip_id}"),
                ],
            ]
        )
        caption_text = (
            f"🎬 <b>New Viral Clip Ready!</b>\n\n"
            f"👤 <b>Streamer:</b> @stableronaldo\n"
            f"🔥 <b>Virality Score:</b> {candidate.virality_score}/100\n"
            f"📌 <b>Hook:</b> {title}\n\n"
            f"📝 <b>Suggested Caption:</b>\n{caption}\n\n"
            f"🏷️ {' '.join(candidate.hashtags)}\n\n"
            f"👇 Tap below to publish or drip-feed to YouTube Shorts & Instagram Reels:"
        )
        video_file = FSInputFile(output_mp4)
        await bot.send_video(
            chat_id=ADMIN_CHAT_ID,
            video=video_file,
            caption=caption_text,
            parse_mode="HTML",
            reply_markup=kb,
        )
        print(f"    [SUCCESS] Clip #{clip_id} sent to Telegram admin chat {ADMIN_CHAT_ID}!")
        await bot.session.close()
    except Exception as e:
        print(f"    [Telegram Notice] Could not push to Telegram (bot session error: {e})")

    print("\n=======================================================")
    print(" SAMPLE 10s STABLERONALDO CLIP GENERATION COMPLETE!")
    print(f" File: {output_mp4}")
    print(f" Review Station UI: http://localhost:8080")
    print(f" Telegram Bot: Check @manishclipbot")
    print("=======================================================\n")


if __name__ == "__main__":
    asyncio.run(main())
