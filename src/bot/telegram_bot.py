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
    delete_clip_completely,
    create_auth_pin,
    get_active_sessions,
    revoke_all_sessions,
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
            InlineKeyboardButton(text="⭐ Great", callback_data=f"great:{clip_id}"),
            InlineKeyboardButton(text="✅ Approve / Queue", callback_data=f"queue:{clip_id}"),
            InlineKeyboardButton(text="🚀 Post Now", callback_data=f"post_now:{clip_id}"),
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
            InlineKeyboardButton(text="❌ Reject", callback_data=f"reject_prompt:{clip_id}"),
        ],
    ]
    return InlineKeyboardMarkup(inline_keyboard=keyboard)


def build_rejection_reasons_keyboard(clip_id: int) -> InlineKeyboardMarkup:
    """Construct 1-tap rejection reason chips for mobile feedback."""
    reasons = [
        ("Boring", "boring"),
        ("No context", "no_context"),
        ("Bad start", "bad_start"),
        ("Bad end", "bad_end"),
        ("Off-topic", "off_topic"),
        ("Unsafe", "unsafe"),
        ("Duplicate", "duplicate"),
        ("Bad crop", "bad_crop"),
        ("Bad captions", "bad_captions"),
        ("Audio", "audio"),
        ("Other", "other"),
    ]
    rows = []
    current_row = []
    for label, code in reasons:
        current_row.append(InlineKeyboardButton(text=label, callback_data=f"reject_reason:{clip_id}:{code}"))
        if len(current_row) == 3:
            rows.append(current_row)
            current_row = []
    if current_row:
        rows.append(current_row)

    rows.append([
        InlineKeyboardButton(text="⏩ Skip Reason", callback_data=f"reject_reason:{clip_id}:none"),
        InlineKeyboardButton(text="↩️ Cancel", callback_data=f"cancel_reject:{clip_id}"),
    ])
    return InlineKeyboardMarkup(inline_keyboard=rows)


def format_clip_caption_html(clip: Dict[str, Any]) -> str:
    """Format HTML caption card to prevent parse entity errors with underscores."""
    tags = html.escape(clip.get("hashtags", "") or "")
    duration = clip["adjusted_end"] - clip["adjusted_start"]
    teaser_status = "Enabled" if clip.get("has_teaser", 1) else "Disabled"
    channel_id = html.escape(str(clip.get("channel_id", "Unknown")))
    template_name = html.escape(str(clip.get("template_name", "default")))
    title = html.escape(str(clip.get("title", "Highlight")))

    v_score = clip.get("virality_score", 0)
    flags_raw = clip.get("flags") or ""
    is_unscored = v_score == 0 or "unscored" in flags_raw
    score_display = "unscored" if is_unscored else f"{v_score}/100"

    censor_line = ""
    try:
        flag_list = json.loads(flags_raw) if flags_raw else []
    except Exception:
        flag_list = []
    for f in flag_list if isinstance(flag_list, list) else []:
        if not isinstance(f, dict):
            continue
        if f.get("type") == "profanity_censored":
            censor_line += f"🔇 <b>Censored:</b> <code>{int(f.get('count', 0))} word(s)</code>\n"
        elif f.get("type") == "slur_detected":
            censor_line += "⚠️ <b>Slur detected</b> - censored, review before posting\n"

    caption = (
        f"🔥 <b>Viral Candidate #{clip['id']}</b>\n\n"
        f"📺 <b>Channel:</b> <code>{channel_id}</code>\n"
        f"🎨 <b>Template:</b> <code>{template_name}</code>\n"
        f"📈 <b>Virality Score:</b> <code>{score_display}</code>\n"
        f"⏱️ <b>Duration:</b> <code>{duration:.1f}s</code> ({clip['adjusted_start']:.1f}s - {clip['adjusted_end']:.1f}s)\n"
        f"🎬 <b>Teaser Pre-Roll:</b> <code>{teaser_status}</code>\n"
        f"{censor_line}\n"
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
                "🎬 <b>AutoClip Suite • Telegram Control Center</b>\n\n"
                "Here are all available commands:\n\n"
                "🔐 <b>Authentication & Web Access:</b>\n"
                "• <code>/pin [duration]</code> — Generate web access PIN. E.g.:\n"
                "   › <code>/pin</code> (Default 30 days)\n"
                "   › <code>/pin 11min</code> or <code>/pin 120min</code>\n"
                "   › <code>/pin 2h</code> or <code>/pin 24h</code>\n"
                "   › <code>/pin 7d</code> or <code>/pin 30d</code>\n"
                "• <code>/sessions</code> — List active logged-in web sessions\n"
                "• <code>/logout_all</code> — Revoke all sessions & lock the dashboard\n\n"
                "📹 <b>Stream Monitoring:</b>\n"
                "• <code>/add &lt;platform&gt; &lt;channel&gt; &lt;template&gt;</code> — Start monitoring streamer\n"
                "• <code>/remove &lt;channel&gt;</code> — Stop monitoring streamer\n"
                "• <code>/clip &lt;url&gt; &lt;template&gt; [start-end]</code> — Force manual clip from URL\n\n"
                "📋 <b>Templates & Publishing Queue:</b>\n"
                "• <code>/templates</code> — View all visual templates & accounts\n"
                "• <code>/queue</code> — View upcoming scheduled drip uploads\n\n"
                "🌐 <b>Web Dashboard:</b> https://clip.manish.casa",
                parse_mode="HTML",
            )

        @self.dp.message(Command("pin"))
        async def cmd_pin(message: types.Message, command: CommandObject):
            if not self._is_admin(message.from_user.id):
                return

            import re
            import random

            # Parse duration from argument (e.g., '11min', '120min', '2h', '24h', '7d', '30m')
            raw_dur = (command.args or "").strip().lower()
            duration_seconds = 30 * 86400  # Default 30 days
            display_label = "30 Days"

            if raw_dur:
                # Minutes: e.g. 11min, 120min, 15m
                m_min = re.match(r"^(\d+)\s*(?:min|mins|m)$", raw_dur)
                # Hours: e.g. 2h, 24hours
                m_hr = re.match(r"^(\d+)\s*(?:hour|hours|hr|hrs|h)$", raw_dur)
                # Days: e.g. 1d, 7days
                m_day = re.match(r"^(\d+)\s*(?:day|days|d)$", raw_dur)

                if m_min:
                    mins = int(m_min.group(1))
                    duration_seconds = max(60, mins * 60)
                    display_label = f"{mins} Minute{'s' if mins != 1 else ''}"
                elif m_hr:
                    hrs = int(m_hr.group(1))
                    duration_seconds = max(60, hrs * 3600)
                    display_label = f"{hrs} Hour{'s' if hrs != 1 else ''}"
                elif m_day:
                    days = int(m_day.group(1))
                    duration_seconds = max(60, days * 86400)
                    display_label = f"{days} Day{'s' if days != 1 else ''}"
                elif raw_dur.isdigit():
                    # If just digits, treat as minutes if <= 180, otherwise hours
                    val = int(raw_dur)
                    if val <= 180:
                        duration_seconds = val * 60
                        display_label = f"{val} Minutes"
                    else:
                        duration_seconds = val * 3600
                        display_label = f"{val} Hours"
                else:
                    await message.reply(
                        "⚠️ <b>Invalid duration format!</b>\n"
                        "Examples: <code>/pin 11min</code>, <code>/pin 120min</code>, <code>/pin 2h</code>, <code>/pin 24h</code>, <code>/pin 7d</code>",
                        parse_mode="HTML"
                    )
                    return

            # Generate random 6-digit PIN
            pin_code = f"{random.randint(100000, 999999)}"
            await create_auth_pin(pin_code, session_duration_seconds=duration_seconds, pin_valid_seconds=900)

            formatted_pin = f"{pin_code[:3]}-{pin_code[3:]}"
            await message.reply(
                f"🔐 <b>AutoClip Web Access PIN:</b>\n\n"
                f"<code>{pin_code}</code> (or <code>{formatted_pin}</code>)\n\n"
                f"⏱️ <b>Session Validity:</b> <b>{display_label}</b>\n"
                f"⏳ <b>PIN Expiry:</b> Enter within 15 minutes\n\n"
                f"🌐 Login at: https://clip.manish.casa",
                parse_mode="HTML"
            )

        @self.dp.message(Command("sessions"))
        async def cmd_sessions(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return

            sessions = await get_active_sessions()
            if not sessions:
                await message.reply("🔒 No active web sessions found.", parse_mode="HTML")
                return

            lines = ["📱 <b>Active Web Dashboard Sessions:</b>\n"]
            for i, s in enumerate(sessions, 1):
                token_preview = s['token'][:6] + "..."
                exp = s.get('expires_at', '').replace("T", " ")[:19]
                lines.append(f"{i}. <code>{token_preview}</code> — Expires: <code>{exp} UTC</code>")

            lines.append("\n💡 <i>To log out all devices, send /logout_all</i>")
            await message.reply("\n".join(lines), parse_mode="HTML")

        @self.dp.message(Command("logout_all"))
        async def cmd_logout_all(message: types.Message):
            if not self._is_admin(message.from_user.id):
                return

            count = await revoke_all_sessions()
            await message.reply(
                f"🚪 <b>All Sessions Revoked!</b>\n"
                f"Logged out {count} active device(s). The Web Dashboard is now locked.",
                parse_mode="HTML"
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

            # Helper for non-blocking feedback event logging
            async def _safe_log_feedback(evt: str, payload: dict):
                try:
                    c_rec = await get_clip(clip_id)
                    ch_id = (c_rec.get("channel_id") if c_rec else None) or "unknown"
                    from src.intelligence.learning.feedback import FeedbackLearner
                    await FeedbackLearner.log_feedback(
                        clip_id=clip_id,
                        channel_id=ch_id,
                        event=evt,
                        payload=payload,
                        candidate_id=c_rec.get("candidate_id") if c_rec else None,
                    )
                except Exception as log_err:
                    logger.warning("Feedback logging failed for clip #%d: %s", clip_id, log_err)

            if action == "great":
                from src.publisher.slots import schedule_clip
                created = await schedule_clip(clip_id)  # one row per mapped channel, in its own slots
                from src.publisher.auto_approve import record_human_decision
                await record_human_decision(clip_id, "approve")
                next_slot = ", ".join(
                    f"{c['account_key'] or 'drip'} @ {c['scheduled_for'][:16].replace('T', ' ')} UTC" for c in created
                ) or "already queued"
                await _safe_log_feedback("marked_great", {"source": "telegram_button"})
                await callback.message.edit_caption(
                    caption=f"⭐ <b>Clip #{clip_id} Marked GREAT &amp; Queued!</b>\nScheduled for: <code>{next_slot}</code>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                await callback.answer("Marked as Great & Queued!")
                return

            if action == "reject_prompt":
                kb = build_rejection_reasons_keyboard(clip_id)
                await callback.message.edit_caption(
                    caption=f"❌ <b>Reject Clip #{clip_id}</b>\n\nWhy did you reject this moment? (Tap a reason or skip):",
                    reply_markup=kb,
                    parse_mode="HTML",
                )
                await callback.answer()
                return

            if action == "reject_reason":
                reason_code = parts[2] if len(parts) > 2 else "none"
                reason_val = None if reason_code == "none" else reason_code
                await update_clip_status(clip_id, "rejected")
                from src.publisher.auto_approve import record_human_decision
                await record_human_decision(clip_id, "reject")
                await _safe_log_feedback("rejected", {"reason": reason_val, "source": "telegram_chip"})
                if reason_val:
                    await _safe_log_feedback("reason_tagged", {"reason": reason_val, "source": "telegram_chip"})

                reason_label = f"Reason: <i>{reason_code.replace('_', ' ').capitalize()}</i>" if reason_val else "<i>No reason given</i>"
                await callback.message.edit_caption(
                    caption=f"❌ <b>Clip #{clip_id} Rejected.</b>\n{reason_label}",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                await callback.answer("Rejection logged.")
                return

            if action == "cancel_reject":
                c_rec = await get_clip(clip_id)
                if c_rec:
                    cap = format_clip_caption_html(c_rec)
                    kb = build_approval_keyboard(clip_id, has_teaser=bool(c_rec.get("has_teaser", 1)))
                    await callback.message.edit_caption(caption=cap, reply_markup=kb, parse_mode="HTML")
                await callback.answer("Cancelled.")
                return

            if action == "discard":
                await update_clip_status(clip_id, "rejected")
                from src.publisher.auto_approve import record_human_decision
                await record_human_decision(clip_id, "reject")
                await _safe_log_feedback("rejected", {"source": "telegram_discard"})
                await delete_clip_completely(clip_id)
                await callback.message.edit_caption(
                    caption=f"❌ <b>Clip #{clip_id} Discarded &amp; Purged.</b>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                await callback.answer("Clip and all instances deleted.")
                return

            if action == "post_now":
                await _safe_log_feedback("approved", {"source": "telegram_post_now"})
                await callback.answer("Publishing to YouTube & Instagram...")
                await callback.message.edit_caption(
                    caption=f"⏳ <b>Publishing Clip #{clip_id} to YouTube Shorts &amp; Instagram Reels...</b>",
                    reply_markup=None,
                    parse_mode="HTML",
                )
                from src.publisher.auto_approve import record_human_decision
                await record_human_decision(clip_id, "approve")
                asyncio.create_task(self._execute_post_now(callback.message, clip_id))
                return

            if action == "queue":
                from src.publisher.slots import schedule_clip
                created = await schedule_clip(clip_id)  # one row per mapped channel, in its own slots
                from src.publisher.auto_approve import record_human_decision
                await record_human_decision(clip_id, "approve")
                next_slot = ", ".join(
                    f"{c['account_key'] or 'drip'} @ {c['scheduled_for'][:16].replace('T', ' ')} UTC" for c in created
                ) or "already queued"
                await _safe_log_feedback("approved", {"source": "telegram_queue"})
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

                c_rec_before = await get_clip(clip_id)
                updated_clip = await self.trimmer.trim_and_rerender(
                    clip_id=clip_id,
                    delta_start=delta_start,
                    delta_end=delta_end,
                )
                if updated_clip:
                    # Log trim feedback with deltas relative to AI boundaries if available
                    ai_s = updated_clip.get("ai_start") or updated_clip.get("raw_start")
                    ai_e = updated_clip.get("ai_end") or updated_clip.get("raw_end")
                    trim_payload = {
                        "delta_start": delta_start,
                        "delta_end": delta_end,
                        "start_delta": (updated_clip["adjusted_start"] - ai_s) if ai_s is not None else delta_start,
                        "end_delta": (updated_clip["adjusted_end"] - ai_e) if ai_e is not None else delta_end,
                        "source": "telegram_trim",
                    }
                    await _safe_log_feedback("trimmed", trim_payload)
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

        # Same path as scheduled uploads: per-channel privacy, quota guard, retries, IG once per clip
        from src.publisher.scheduler import publish_clip_now
        result = await publish_clip_now(clip_id)

        if result["success"]:
            lines = [f"🚀 <b>Clip #{clip_id} Published!</b>"]
        else:
            lines = [f"⚠️ <b>Clip #{clip_id} was not uploaded</b>"]
        for url in result["videos"]:
            lines.append(f"• 🔴 <b>YouTube Shorts:</b> <a href=\"{html.escape(url)}\">Watch here</a>")
        for err in result["errors"]:
            lines.append(f"• <code>{html.escape(err[:300])}</code>")
        if not result["results"]:
            lines.append("• No YouTube channel is mapped to this streamer (Distribution → Mappings).")

        if result["success"]:
            try:
                from src.intelligence.learning.feedback import FeedbackLearner
                await FeedbackLearner.log_feedback(
                    clip_id=clip_id,
                    channel_id=clip.get("channel_id", "default"),
                    event="published",
                    payload={"source": "telegram_post_now"},
                    candidate_id=clip.get("candidate_id"),
                )
            except Exception as fb_err:
                logger.warning("Feedback logging failed on publish: %s", fb_err)

        try:
            await message.edit_caption(
                caption="\n\n".join(lines)[:1024],  # Telegram caption limit
                reply_markup=None,
                parse_mode="HTML",
            )
        except Exception as tg_err:
            logger.warning("Could not update Telegram card for clip %d: %s", clip_id, tg_err)

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
        logger.info("Sending clip #%d to Telegram chat %s (%s)...", clip["id"], self.admin_id, video_path)
        try:
            msg = await self.bot.send_video(
                chat_id=self.admin_id,
                video=video_input,
                caption=caption,
                reply_markup=kb,
                parse_mode="HTML",
                request_timeout=180,
            )
            await update_clip_telegram_info(clip["id"], self.admin_id, msg.message_id)
            logger.info("Successfully delivered clip #%d to Telegram (msg_id: %d)", clip["id"], msg.message_id)
        except Exception as e:
            logger.error("Failed delivering video to Telegram for clip #%d: %s. Sending text fallback alert.", clip["id"], e)
            # Send notification card so user is still alerted immediately with action buttons
            fallback_text = (
                f"⚠️ <b>Clip #{clip['id']} Ready!</b> (Video upload to Telegram timed out)\n\n"
                f"{caption}\n\n"
                f"🔗 <b>Watch in Web UI:</b> http://localhost:8080"
            )
            try:
                msg = await self.bot.send_message(
                    chat_id=self.admin_id,
                    text=fallback_text,
                    reply_markup=kb,
                    parse_mode="HTML",
                    request_timeout=30,
                )
                await update_clip_telegram_info(clip["id"], self.admin_id, msg.message_id)
            except Exception:
                pass
            raise e
