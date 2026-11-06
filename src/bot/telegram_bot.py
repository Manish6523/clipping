"""Telegram Control Plane & Interactive 1-Tap Approval Bot built with aiogram v3 (HTML formatted).

All imports placed at the top of the file according to standards.
"""

import asyncio
import html
import json
import logging
import os
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional

from aiogram import Bot, Dispatcher, F, types
from aiogram.filters import Command, CommandObject
from aiogram.types import (
    InlineKeyboardButton,
    InlineKeyboardMarkup,
    FSInputFile,
    InputMediaVideo,
)

from config.settings import (
    TELEGRAM_BOT_TOKEN,
    ADMIN_CHAT_ID,
    TEMPLATES_DIR,
    DRIP_INTERVAL_HOURS,
)
from src.database import (
    add_channel,
    remove_channel,
    get_active_channels,
    get_channel,
    get_clip,
    get_clip_by_message_id,
    update_clip_telegram_info,
    update_clip_caption,
    update_clip_status,
    enqueue_clip,
    get_upcoming_queue,
)
from src.bot.trimmer import ClipTrimmer, load_template
from src.publisher.youtube_shorts import YouTubeShortsPublisher
from src.publisher.instagram_reels import InstagramReelsPublisher
from src.publisher.scheduler import DripScheduler, load_template_destinations

logger = logging.getLogger(__name__)


def build_approval_keyboard(clip_id: int, has_teaser: bool = True) -> InlineKeyboardMarkup:
    """Construct interactive inline approval keyboard for 1-tap mobile actions."""
    teaser_label = "🎬 Teaser: ON" if has_teaser else "🎬 Teaser: OFF"

    keyboard = [
        [
            InlineKeyboardButton(text="✅ Post Now (YT + IG)", callback_data=f"post_now:{clip_id}"),
            InlineKeyboardButton(text="🗓️ Add to Drip Queue", callback_data=f"queue:{clip_id}"),
        ],
        [
            InlineKeyboardButton(text="⏪ -3s Start", callback_data=f"trim:{clip_id}:s:-3"),
            InlineKeyboardButton(text="⏩ +3s Start", callback_data=f"trim:{clip_id}:s:3"),
        ],
        [
            InlineKeyboardButton(text="⏪ -3s End", callback_data=f"trim:{clip_id}:e:-3"),
            InlineKeyboardButton(text="⏩ +3s End", callback_data=f"trim:{clip_id}:e:3"),
        ],
        [
            InlineKeyboardButton(text=teaser_label, callback_data=f"teaser:{clip_id}"),
            InlineKeyboardButton(text="❌ Discard", callback_data=f"discard:{clip_id}"),
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)


def format_clip_caption_html(clip: Dict[str, Any]) -> str:
    """Format HTML caption card to prevent parse entity errors with underscores."""
    tags = html.escape(clip.get("hashtags", "") or "")
    duration = clip["adjusted_end"] - clip["adjusted_start"]
    teaser_status = "Enabled" if clip.get("has_teaser", 1) else "Disabled"
    channel_id = html.escape(str(clip.get("channel_id", "Unknown")))
    template_name = html.escape(str(clip.get("template_name", "default")))
    title = html.escape(str(clip.get("title", "Highlight")))

    caption = (
        f"🔥 <b>Viral Candidate #{clip['id']}</b>\n\n"
        f"📺 <b>Channel:</b> <code>{channel_id}</code>\n"
        f"🎨 <b>Template:</b> <code>{template_name}</code>\n"
        f"📈 <b>Virality Score:</b> <code>{clip.get('virality_score', 0)}/100</code>\n"
        f"⏱️ <b>Duration:</b> <code>{duration:.1f}s</code> ({clip['adjusted_start']:.1f}s - {clip['adjusted_end']:.1f}s)\n"
        f"🎬 <b>Teaser Pre-Roll:</b> <code>{teaser_status}</code>\n\n"
        f"📝 <b>Title:</b> {title}\n"
        f"🏷️ <b>Tags:</b> {tags}\n\n"
        f"💡 <i>Reply to this message with text to edit the title/caption.</i>"
    )
    return caption


class AutoClipBot:
    """Controls pipeline execution, notifications, and review cards via Telegram."""

    def __init__(
        self,
        token: str = TELEGRAM_BOT_TOKEN,
        admin_id: int = ADMIN_CHAT_ID,
        on_manual_clip: Optional[Callable[[str, str, Optional[str]], Any]] = None,
    ):
        self.token = token
        self.admin_id = admin_id
        self.on_manual_clip = on_manual_clip
        self.bot = Bot(token=self.token) if self.token else None
        self.dp = Dispatcher()
        self.trimmer = ClipTrimmer()
        self._register_handlers()

    def _is_admin(self, user_id: int) -> bool:
        """Verify message sender matches ADMIN_CHAT_ID."""
        return self.admin_id == 0 or user_id == self.admin_id

    def _register_handlers(self) -> None:
        """Register aiogram routers, commands, and callback queries."""

        # ----------------------------------------------------
        # Commands
        # ----------------------------------------------------

        @self.dp.message(Command("start"))
        async def cmd_start(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return
            await message.reply(
                "🚀 <b>AutoClipDaemon Active</b>\n\n"
                "Autonomous Live &amp; VOD social clipping engine.\n\n"
                "<b>Available Commands:</b>\n"
                "• <code>/add &lt;platform&gt; &lt;channel&gt; &lt;template&gt;</code> — Monitor creator\n"
                "• <code>/remove &lt;channel&gt;</code> — Stop monitoring\n"
                "• <code>/clip &lt;url&gt; &lt;template&gt; [start-end]</code> — Force manual clip\n"
                "• <code>/templates</code> — View layouts &amp; mapped accounts\n"
                "• <code>/queue</code> — View scheduled drip uploads\n\n"
                "🌐 <b>Web UI Dashboard:</b> http://localhost:8080",
                parse_mode="HTML",
            )

        @self.dp.message(Command("add"))
        async def cmd_add(message: types.Message, command: CommandObject):
            if not self._is_admin(message.from_user.id):
                return

            args = (command.args or "").split()
            if len(args) < 3:
                await message.reply("Usage: <code>/add &lt;twitch|youtube&gt; &lt;channel_or_handle&gt; &lt;template_name&gt;</code>", parse_mode="HTML")
                return

            platform, channel, template = args[0].lower(), args[1], args[2]
            if platform not in ("twitch", "youtube"):
                await message.reply("Error: Platform must be <code>twitch</code> or <code>youtube</code>.", parse_mode="HTML")
                return

            t_path = Path(TEMPLATES_DIR) / f"{template}.json"
            if not t_path.exists():
                await message.reply(f"⚠️ Template <code>{html.escape(template)}</code> not found in templates directory.", parse_mode="HTML")
                return

            await add_channel(platform, channel, template)
            await message.reply(
                f"✅ Successfully added <code>{html.escape(channel)}</code> ({platform}) with template <code>{html.escape(template)}</code>.",
                parse_mode="HTML",
            )

        @self.dp.message(Command("remove"))
        async def cmd_remove(message: types.Message, command: CommandObject):
            if not self._is_admin(message.from_user.id):
                return

            channel = (command.args or "").strip()
            if not channel:
                await message.reply("Usage: <code>/remove &lt;channel_or_handle&gt;</code>", parse_mode="HTML")
                return

            removed = await remove_channel(channel)
            if removed:
                await message.reply(f"🗑️ Channel <code>{html.escape(channel)}</code> removed from active monitoring.", parse_mode="HTML")
            else:
                await message.reply(f"❌ Channel <code>{html.escape(channel)}</code> not found in active list.", parse_mode="HTML")

        @self.dp.message(Command("clip"))
        async def cmd_clip(message: types.Message, command: CommandObject):
            if not self._is_admin(message.from_user.id):
                return

            args = (command.args or "").split()
            if len(args) < 2:
                await message.reply("Usage: <code>/clip &lt;video_url&gt; &lt;template_name&gt; [optional_start-end]</code>", parse_mode="HTML")
                return

            url = args[0]
            template = args[1]
            time_range = args[2] if len(args) > 2 else None

            t_path = Path(TEMPLATES_DIR) / f"{template}.json"
            if not t_path.exists():
                await message.reply(f"⚠️ Template <code>{html.escape(template)}</code> not found.", parse_mode="HTML")
                return

            await message.reply(
                f"⏳ <b>Manual Clipping Initiated!</b>\n\n"
                f"• URL: <code>{html.escape(url)}</code>\n"
                f"• Template: <code>{html.escape(template)}</code>\n"
                f"Processing transcript, viral hooks, and 9:16 layout. The approval card will arrive here shortly.",
                parse_mode="HTML",
            )

            if self.on_manual_clip:
                asyncio.create_task(self.on_manual_clip(url, template, time_range))

        @self.dp.message(Command("templates"))
        async def cmd_templates(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return

            t_files = list(Path(TEMPLATES_DIR).glob("*.json"))
            if not t_files:
                await message.reply("No templates found in <code>templates/</code> folder.", parse_mode="HTML")
                return

            lines = ["📋 <b>Available Creator Templates:</b>\n"]
            for tf in t_files:
                try:
                    with open(tf, "r", encoding="utf-8") as f:
                        data = json.load(f)
                    name = html.escape(str(data.get("name", tf.stem)))
                    layout = html.escape(str(data.get("layout", {}).get("type", "unknown")))
                    dests = data.get("destinations", {})
                    yt = html.escape(str(dests.get("youtube_account_key", "None")))
                    ig = html.escape(str(dests.get("instagram_account_key", "None")))
                    lines.append(f"• <b>{name}</b> ({layout})\n  YT: <code>{yt}</code> | IG: <code>{ig}</code>")
                except Exception:
                    pass

            await message.reply("\n".join(lines), parse_mode="HTML")

        @self.dp.message(Command("queue"))
        async def cmd_queue(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return

            queue = await get_upcoming_queue(limit=10)
            if not queue:
                await message.reply("📭 Drip Queue is currently empty.", parse_mode="HTML")
                return

            lines = ["🗓️ <b>Upcoming Drip Queue:</b>\n"]
            for item in queue:
                title_esc = html.escape(str(item.get("title", "")[:30]))
                lines.append(
                    f"• Clip #{item['clip_id']} (<code>{title_esc}</code>)\n"
                    f"  ⏰ <code>{item['scheduled_for']}</code> | YT: <code>{item['yt_status']}</code> | IG: <code>{item['ig_status']}</code>"
                )

            await message.reply("\n".join(lines), parse_mode="HTML")

        # ----------------------------------------------------
        # Reply to Edit Caption
        # ----------------------------------------------------

        @self.dp.message(F.reply_to_message)
        async def handle_reply_edit(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return

            reply_msg_id = message.reply_to_message.message_id
            clip = await get_clip_by_message_id(reply_msg_id)
            if not clip:
                return

            new_title = message.text.strip()
            await update_clip_caption(clip["id"], title=new_title)
            updated_clip = await get_clip(clip["id"])

            new_caption = format_clip_caption_html(updated_clip)
            kb = build_approval_keyboard(clip["id"], has_teaser=bool(updated_clip.get("has_teaser", 1)))

            try:
                await self.bot.edit_message_caption(
                    chat_id=message.chat.id,
                    message_id=reply_msg_id,
                    caption=new_caption,
                    reply_markup=kb,
                    parse_mode="HTML",
                )
                await message.reply(f"✏️ Clip #{clip['id']} title updated to: <b>{html.escape(new_title)}</b>", parse_mode="HTML")
            except Exception as e:
                logger.error("Failed to edit caption in Telegram: %s", e)

        # ----------------------------------------------------
        # Callback Queries (Approval, Trimming, Queue, Discard)
        # ----------------------------------------------------

        @self.dp.callback_query()
        async def handle_callbacks(callback: types.CallbackQuery):
            if not self._is_admin(callback.from_user.id):
                await callback.answer("Unauthorized.", show_alert=True)
                return

            data = callback.data or ""
            parts = data.split(":")
            action = parts[0]
            clip_id = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0

            if not clip_id:
                await callback.answer("Invalid request.")
                return

            if action == "discard":
                await update_clip_status(clip_id, "rejected")
                clip = await get_clip(clip_id)
                if clip and clip.get("rendered_video_path"):
                    try:
                        p = Path(clip["rendered_video_path"])
                        if p.exists():
                            p.unlink()
                    except Exception:
                        pass
                await callback.message.edit_caption(
                    caption=f"❌ <b>Clip #{clip_id} Discarded &amp; Deleted.</b>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                await callback.answer("Clip discarded.")
                return

            if action == "post_now":
                await callback.answer("Publishing to YouTube & Instagram...")
                await callback.message.edit_caption(
                    caption=f"⏳ <b>Publishing Clip #{clip_id} to YouTube Shorts &amp; Instagram Reels...</b>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                asyncio.create_task(self._execute_post_now(callback.message, clip_id))
                return

            if action == "queue":
                next_slot = DripScheduler.calculate_next_slot(DRIP_INTERVAL_HOURS)
                await enqueue_clip(clip_id, next_slot)
                await callback.message.edit_caption(
                    caption=f"🗓️ <b>Clip #{clip_id} Added to Drip Queue!</b>\nScheduled for: <code>{next_slot}</code>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                await callback.answer("Added to Drip Queue.")
                return

            if action == "trim" and len(parts) >= 4:
                bound_type = parts[2]
                delta = float(parts[3])
                await callback.answer(f"Trimming {bound_type.upper()} by {delta:+.0f}s. Re-rendering...")

                delta_start = delta if bound_type == "s" else 0.0
                delta_end = delta if bound_type == "e" else 0.0

                updated_clip = await self.trimmer.trim_and_rerender(
                    clip_id=clip_id,
                    delta_start=delta_start,
                    delta_end=delta_end,
                )
                if updated_clip:
                    await self._update_telegram_card(callback.message, updated_clip)
                return

            if action == "teaser":
                await callback.answer("Toggling teaser hook & re-rendering...")
                updated_clip = await self.trimmer.trim_and_rerender(
                    clip_id=clip_id,
                    toggle_teaser=True,
                )
                if updated_clip:
                    await self._update_telegram_card(callback.message, updated_clip)
                return

    async def _update_telegram_card(self, message: types.Message, clip: Dict[str, Any]) -> None:
        """Update Telegram media and caption after trimming or teaser toggle."""
        video_path = clip.get("rendered_video_path")
        if not video_path or not Path(video_path).exists():
            return

        caption = format_clip_caption_html(clip)
        has_teaser = bool(clip.get("has_teaser", 1))
        kb = build_approval_keyboard(clip["id"], has_teaser=has_teaser)

        try:
            new_media = InputMediaVideo(
                media=FSInputFile(video_path),
                caption=caption,
                parse_mode="HTML",
            )
            await message.edit_media(media=new_media, reply_markup=kb)
        except Exception as e:
            logger.error("Failed to edit Telegram message media: %s", e)
            try:
                await message.edit_caption(caption=caption, reply_markup=kb, parse_mode="HTML")
            except Exception:
                pass

    async def _execute_post_now(self, message: types.Message, clip_id: int) -> None:
        """Publish immediately to mapped YouTube and Instagram accounts."""
        clip = await get_clip(clip_id)
        if not clip:
            return

        template_name = clip.get("template_name", "ishowspeed_gaming")
        video_path = clip.get("rendered_video_path")
        title = clip.get("title", "Stream Highlight")
        description = clip.get("description", "")
        hashtags = [h.strip() for h in (clip.get("hashtags") or "").split() if h.strip()]

        dests = load_template_destinations(template_name)
        yt_key = dests.get("youtube_account_key")
        ig_key = dests.get("instagram_account_key")

        yt_res = {"success": False, "error": "Not configured"}
        ig_res = {"success": False, "error": "Not configured"}

        tasks = []
        if yt_key:
            yt_pub = YouTubeShortsPublisher(yt_key)
            tasks.append(yt_pub.upload_short(video_path, title, description, hashtags))
        if ig_key:
            ig_pub = InstagramReelsPublisher(ig_key)
            tasks.append(ig_pub.upload_reel(video_path, title, hashtags))

        results = await asyncio.gather(*tasks, return_exceptions=True)

        idx = 0
        if yt_key:
            yt_res = results[idx] if not isinstance(results[idx], Exception) else {"success": False, "error": str(results[idx])}
            idx += 1
        if ig_key:
            ig_res = results[idx] if not isinstance(results[idx], Exception) else {"success": False, "error": str(results[idx])}

        yt_url = yt_res.get("url") if yt_res.get("success") else None
        ig_url = ig_res.get("url") if ig_res.get("success") else None

        status_lines = [f"🚀 <b>Clip #{clip_id} Published!</b>"]
        if yt_url:
            status_lines.append(f"• 🔴 <b>YouTube Shorts:</b> <a href=\"{yt_url}\">Watch Here</a>")
        elif yt_key:
            status_lines.append(f"• 🔴 YouTube Failed: <code>{html.escape(str(yt_res.get('error')))}</code>")

        if ig_url:
            status_lines.append(f"• 📸 <b>Instagram Reels:</b> <a href=\"{ig_url}\">Watch Here</a>")
        elif ig_key:
            status_lines.append(f"• 📸 Instagram Failed: <code>{html.escape(str(ig_res.get('error')))}</code>")

        await update_clip_status(clip_id, "published")
        await message.edit_caption(
            caption="\n\n".join(status_lines),
            reply_markup=None,
            parse_mode="HTML",
            disable_web_page_preview=False,
        )

    async def send_clip_card(self, clip: Dict[str, Any]) -> None:
        """Send freshly rendered clip with 1-tap approval card to admin Telegram chat."""
        if not self.bot or not self.admin_id:
            logger.warning("Telegram Bot or ADMIN_CHAT_ID not configured; cannot deliver clip card.")
            return

        video_path = clip.get("rendered_video_path")
        if not video_path or not Path(video_path).exists():
            logger.error("Rendered video path invalid for clip %d: %s", clip["id"], video_path)
            return

        caption = format_clip_caption_html(clip)
        kb = build_approval_keyboard(clip["id"], has_teaser=bool(clip.get("has_teaser", 1)))

        video_input = FSInputFile(video_path)
        msg = await self.bot.send_video(
            chat_id=self.admin_id,
            video=video_input,
            caption=caption,
            reply_markup=kb,
            parse_mode="HTML",
        )

        await update_clip_telegram_info(clip["id"], self.admin_id, msg.message_id)
