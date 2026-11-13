"""Live Stream Watcher: Streamlink HLS Ring Buffer + Chat Velocity Spike + Audio Peak Detector.

All imports placed at the top of the file according to standards.
"""

import asyncio
import glob
import logging
import os
import subprocess
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import aiohttp

from config.settings import BUFFER_DIR, CHAT_SPIKE_MULTIPLIER, AUDIO_PEAK_DB_THRESHOLD
from src.compositor.ffmpeg_renderer import escape_ffmpeg_path
from src.web.logger_stream import update_streamer_status, update_pipeline_progress

logger = logging.getLogger(__name__)

BASELINE_WINDOW_S = 600.0   # chat-rate baseline lookback
BASELINE_EXCLUDE_S = 10.0   # recent seconds excluded from the baseline (that's where spikes are)
BASELINE_WARMUP_S = 30.0    # need this much history before velocity triggers fire


class LiveStreamWatcher:
    """Manages live stream ingestion, 4-minute ring buffer, and multi-modal hype detection."""

    def __init__(
        self,
        channel_id: str,
        platform: str,
        template_config: Dict[str, Any],
        on_viral_moment_detected: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
    ):
        self.channel_id = channel_id
        self.platform = platform.lower()
        self.template = template_config
        self.on_viral_moment_detected = on_viral_moment_detected

        self.buffer_path = Path(BUFFER_DIR) / self.channel_id
        self.buffer_path.mkdir(parents=True, exist_ok=True)

        self.is_running = False
        self._is_channel_live = False
        self._stream_proc: Optional[subprocess.Popen] = None
        self._ffmpeg_proc: Optional[subprocess.Popen] = None

        # Chat velocity tracking
        self.chat_messages_timestamps: deque = deque()
        self.chat_history_buffer: deque = deque(maxlen=300)  # Rolling 90s chat buffer (timestamp, message)
        self.chat_baseline_mps = 1.0
        self.hype_keywords = [
            k.upper() for k in self.template.get("hype_keywords", ["CLIP IT", "WTF", "LMAO", "W SPEED"])
        ]
        self.spike_multiplier = self.template.get("chat_spike_multiplier", CHAT_SPIKE_MULTIPLIER)

        # Trigger cooldown to avoid duplicate triggers for the same event
        self.last_trigger_time = 0.0
        self.cooldown_seconds = 90.0

    def _get_live_url(self) -> str:
        """Resolve correct live stream URL for platform (handles YouTube handles with @)."""
        if self.platform == "twitch":
            return f"https://www.twitch.tv/{self.channel_id}"
        cid = self.channel_id.strip()
        if not cid.startswith("@") and not cid.startswith("UC") and not cid.startswith("http"):
            cid = f"@{cid}"
        if cid.startswith("http"):
            return cid
        return f"https://www.youtube.com/{cid}/live"

    async def is_channel_live(self) -> bool:
        """Probe whether the channel is currently broadcasting live using lightweight HTTP/GQL queries."""
        if self.platform == "twitch":
            try:
                # Fast Twitch GraphQL check (0.05s, 0% CPU, no subprocess)
                async with aiohttp.ClientSession() as session:
                    headers = {
                        "Client-ID": "kimne78kx3ncx6brgo4mv6wki5h1ko",
                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
                    }
                    payload = {
                        "query": f'query {{ user(login: "{self.channel_id.lower()}") {{ stream {{ id type title game {{ name }} }} }} }}'
                    }
                    async with session.post("https://gql.twitch.tv/gql", json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=4)) as resp:
                        if resp.status == 200:
                            data = await resp.json()
                            user_data = data.get("data", {}).get("user")
                            if user_data:
                                stream = user_data.get("stream")
                                is_live = stream is not None and stream.get("type") == "live"
                                if is_live and stream:
                                    self._stream_title = stream.get("title") or ""
                                    self._stream_category = (stream.get("game") or {}).get("name") or ""
                                return is_live
            except Exception as e:
                logger.debug("Fast Twitch live check failed for %s (%s), falling back...", self.channel_id, e)

        # Fallback probe using streamlink --json
        url = self._get_live_url()
        cmd = [sys.executable, "-m", "streamlink", "--json", url]
        try:
            loop = asyncio.get_running_loop()
            proc = await loop.run_in_executor(
                None,
                lambda: subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
            )
            return proc.returncode == 0 and '"streams":' in proc.stdout
        except Exception as e:
            logger.debug("Live check failed for %s: %s", self.channel_id, e)
            return False

    async def start_ingestion_pipeline(self) -> None:
        """Start Streamlink piped into FFmpeg 4-minute ring buffer segmenter using OS pipes."""
        stream_url = self._get_live_url()

        chunk_pattern = str(self.buffer_path / "chunk_%03d.ts")

        # Streamlink command: python -m streamlink --stdout <url> best
        streamlink_cmd = [
            sys.executable,
            "-m",
            "streamlink",
            "--stdout",
            stream_url,
            "best",
        ]

        # FFmpeg segmenter: 10s chunks, wrapping at 24 chunks (4 minutes total buffer)
        ffmpeg_cmd = [
            "ffmpeg", "-y",
            "-i", "-",
            "-c", "copy",
            "-f", "segment",
            "-segment_time", "10",
            "-segment_wrap", "24",
            "-reset_timestamps", "1",
            chunk_pattern,
        ]

        logger.info("Launching ring-buffer ingestion pipeline for %s...", self.channel_id)

        # Use standard subprocess.Popen for robust cross-platform pipe between processes
        self._stream_proc = subprocess.Popen(
            streamlink_cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
        )

        self._ffmpeg_proc = subprocess.Popen(
            ffmpeg_cmd,
            stdin=self._stream_proc.stdout,
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )

        # Allow stream_proc to receive SIGPIPE if ffmpeg exits
        if self._stream_proc.stdout:
            self._stream_proc.stdout.close()

    async def run(self) -> None:
        """Main lifecycle loop: poll stream status, monitor chat, and detect peaks."""
        self.is_running = True
        logger.info("Live watcher initialized for channel '%s' (%s)", self.channel_id, self.platform)

        chat_task = asyncio.create_task(self._listen_to_chat())
        audio_task = asyncio.create_task(self._monitor_audio_peaks())

        try:
            while self.is_running:
                is_live = await self.is_channel_live()
                self._is_channel_live = is_live
                chunks = glob.glob(str(self.buffer_path / "chunk_*.ts"))
                update_streamer_status(self.channel_id, self.platform, is_live, self.chat_baseline_mps, len(chunks))
                if is_live and (self._stream_proc is None or self._stream_proc.poll() is not None):
                    await self.start_ingestion_pipeline()
                elif not is_live and self._stream_proc is not None:
                    await self.stop_pipeline()

                # Poll every 20s if live, or 45s if offline to save resources
                sleep_sec = 20 if is_live else 45
                await asyncio.sleep(sleep_sec)
        finally:
            chat_task.cancel()
            audio_task.cancel()
            await self.stop_pipeline()

    async def stop_pipeline(self) -> None:
        """Safely terminate subprocesses."""
        if self._ffmpeg_proc:
            try:
                self._ffmpeg_proc.terminate()
                self._ffmpeg_proc.kill()
            except Exception:
                pass
            self._ffmpeg_proc = None

        if self._stream_proc:
            try:
                self._stream_proc.terminate()
                self._stream_proc.kill()
            except Exception:
                pass
            self._stream_proc = None

    # ==========================================
    # Trigger 1: Chat Velocity & Keyword Spike
    # ==========================================

    async def _listen_to_chat(self) -> None:
        """Connect to Twitch IRC or public chat to monitor message velocity."""
        if self.platform != "twitch":
            return

        while self.is_running:
            try:
                reader, writer = await asyncio.open_connection("irc.chat.twitch.tv", 6667)
                writer.write(b"PASS oauth:anonymous\r\n")
                writer.write(b"NICK justinfan12345\r\n")
                writer.write(f"JOIN #{self.channel_id.lower()}\r\n".encode())
                await writer.drain()

                logger.info("Connected to Twitch IRC for channel #%s", self.channel_id)

                while self.is_running:
                    line = await reader.readline()
                    if not line:
                        break

                    decoded = line.decode(errors="ignore")
                    if decoded.startswith("PING"):
                        writer.write(b"PONG :tmi.twitch.tv\r\n")
                        await writer.drain()
                        continue

                    if "PRIVMSG" in decoded:
                        msg_body = decoded.split("PRIVMSG", 1)[1]
                        if ":" in msg_body:
                            text = msg_body.split(":", 1)[1].strip()
                            await self._on_chat_message(text)

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.warning("Twitch IRC connection drop for %s: %s. Reconnecting in 10s...", self.channel_id, e)
                await asyncio.sleep(10)

    def _extract_chat_features(self) -> Dict[str, Any]:
        """Extract deduplicated, spam-filtered chat messages and top tokens/emotes from rolling history."""
        from collections import Counter
        import re

        now = time.time()
        # Keep last 90 seconds
        recent = [msg for (ts, msg) in self.chat_history_buffer if ts >= now - 90.0]
        if not recent:
            return {"top_messages": [], "top_tokens": []}

        # Deduplicate & filter spam: keep unique messages with character repetition collapsing
        seen = set()
        deduped = []
        token_counter = Counter()

        for m in reversed(recent): # most recent first
            clean_m = m.strip()
            # Collapse excessive repeats (e.g. Wwwwwwwwwww -> Www)
            collapsed = re.sub(r'(.)\1{3,}', r'\1\1', clean_m)
            norm = collapsed.lower()
            if norm not in seen:
                seen.add(norm)
                deduped.append(collapsed)
            
            # Count tokens
            for word in collapsed.split():
                clean_word = word.strip(".,!?\"'()[]{}")
                if len(clean_word) >= 2:
                    token_counter[clean_word] += 1

        top_messages = deduped[:25]
        top_tokens = [{"token": t, "count": c} for t, c in token_counter.most_common(8)]

        return {
            "top_messages": top_messages,
            "top_tokens": top_tokens,
            "total_messages_90s": len(recent),
        }

    async def _on_chat_message(self, message: str) -> None:
        """Record message and check for hype velocity or keyword spikes."""
        # Only process chat hype if the streamer is actually live broadcasting
        if not getattr(self, "_is_channel_live", False):
            return

        now = time.time()
        self.chat_messages_timestamps.append(now)
        self.chat_history_buffer.append((now, message))

        # Baseline = chat rate over the previous 10 minutes, EXCLUDING the last 10s. The old 60s
        # window included the spike itself, so a burst raised its own baseline and hid itself.
        # Per-second buckets keep this O(600) per message even for 100+ msg/s chats.
        if not getattr(self, "_chat_first_seen", None):
            self._chat_first_seen = now
            self._chat_buckets = deque()  # [second, count]
        sec = int(now)
        if self._chat_buckets and self._chat_buckets[-1][0] == sec:
            self._chat_buckets[-1][1] += 1
        else:
            self._chat_buckets.append([sec, 1])
        while self._chat_buckets and self._chat_buckets[0][0] < now - BASELINE_WINDOW_S:
            self._chat_buckets.popleft()
        while self.chat_messages_timestamps and self.chat_messages_timestamps[0] < now - 10.0:
            self.chat_messages_timestamps.popleft()

        recent_5s = sum(1 for t in self.chat_messages_timestamps if t >= now - 5.0)
        baseline_count = sum(c for s_, c in self._chat_buckets if s_ < now - BASELINE_EXCLUDE_S)
        span = min(BASELINE_WINDOW_S, now - self._chat_first_seen) - BASELINE_EXCLUDE_S
        warmed_up = span >= BASELINE_WARMUP_S
        if warmed_up:
            self.chat_baseline_mps = max(0.5, baseline_count / span)
        current_5s_mps = recent_5s / 5.0

        msg_upper = message.upper()
        # Word-boundary or clean matching for short tokens like 'W' or 'L' to avoid false positives inside regular words
        keyword_hit = False
        words = msg_upper.split()
        for kw in self.hype_keywords:
            if " " in kw:
                if kw in msg_upper:
                    keyword_hit = True
                    break
            else:
                if kw in words or (len(kw) > 2 and kw in msg_upper):
                    keyword_hit = True
                    break

        velocity_spike = warmed_up and current_5s_mps >= (self.chat_baseline_mps * self.spike_multiplier) and recent_5s >= 10

        # Require meaningful chat velocity for keyword triggers to avoid low-activity false triggers
        should_trigger = velocity_spike or (keyword_hit and recent_5s >= 6)

        # Enforce minimum cooldown of 90s between live triggers to let previous pipeline finish
        cooldown = max(90.0, getattr(self, "cooldown_seconds", 60.0))
        if should_trigger and (now - self.last_trigger_time > cooldown):
            trigger_context = {
                "type": "chat_spike" if velocity_spike else "keyword_hit",
                "mps_recent": round(current_5s_mps, 2),
                "mps_baseline": round(self.chat_baseline_mps, 2),
                "ratio": round(current_5s_mps / max(0.1, self.chat_baseline_mps), 2),
                "recent_5s_count": recent_5s,
                "keyword": keyword_hit,
                "t_trigger": now,
            }
            chat_features = self._extract_chat_features()
            logger.info(
                "Hype Triggered on %s! (Velocity: %.2f MPS vs baseline %.2f MPS | Keyword: %s)",
                self.channel_id, current_5s_mps, self.chat_baseline_mps, keyword_hit
            )
            self.last_trigger_time = now
            asyncio.create_task(self._handle_hype_event(
                reason="chat_spike",
                trigger_context=trigger_context,
                chat_features=chat_features
            ))

    # ==========================================
    # Trigger 2: Audio dB Peak / Scream Detector
    # ==========================================

    async def _monitor_audio_peaks(self) -> None:
        """Inspect newly generated .ts chunks for loud screams/explosions."""
        processed_chunks = set()

        while self.is_running:
            await asyncio.sleep(5)
            if not getattr(self, "_is_channel_live", False):
                continue
            chunks = sorted(glob.glob(str(self.buffer_path / "chunk_*.ts")), key=os.path.getmtime)
            if not chunks:
                continue

            latest_chunk = chunks[-1]
            if latest_chunk in processed_chunks:
                continue
            processed_chunks.add(latest_chunk)
            if len(processed_chunks) > 50:
                processed_chunks.clear()

            peak_db = await self._analyze_chunk_audio_db(latest_chunk)
            if peak_db is not None and peak_db >= AUDIO_PEAK_DB_THRESHOLD:
                now = time.time()
                if now - self.last_trigger_time > self.cooldown_seconds:
                    logger.info("Audio Peak Triggered on %s! (dB: %.2f >= %.2f)", self.channel_id, peak_db, AUDIO_PEAK_DB_THRESHOLD)
                    self.last_trigger_time = now
                    trigger_context = {
                        "type": "audio_peak",
                        "peak_db": round(peak_db, 2),
                        "threshold_db": AUDIO_PEAK_DB_THRESHOLD,
                        "t_trigger": now,
                    }
                    chat_features = self._extract_chat_features()
                    asyncio.create_task(self._handle_hype_event(
                        reason=f"audio_peak_{peak_db:.1f}dB",
                        trigger_context=trigger_context,
                        chat_features=chat_features
                    ))

    async def _analyze_chunk_audio_db(self, chunk_path: str) -> Optional[float]:
        """Run FFmpeg astats filter to extract max peak audio level in dB."""
        cmd = [
            "ffmpeg", "-y", "-threads", "1",
            "-i", chunk_path,
            "-af", "astats=metadata=1:reset=1",
            "-vn", "-f", "null", "-",
        ]
        try:
            proc = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, stderr = await proc.communicate()
            err_str = stderr.decode(errors="ignore")

            for line in err_str.splitlines():
                if "Peak level dB" in line or "Peak dB" in line:
                    parts = line.split(":")
                    if len(parts) >= 2:
                        val_str = parts[1].strip().split()[0]
                        return float(val_str)
        except Exception:
            pass
        return None

    # ==========================================
    # Hype Event Slicing
    # ==========================================

    async def _handle_hype_event(
        self,
        reason: str,
        trigger_context: Optional[Dict[str, Any]] = None,
        chat_features: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Wait 20s for moment to conclude, concatenate surrounding 75s of .ts chunks into an MP4."""
        logger.info("🔥 Hype moment triggered on %s (%s). Waiting 20 seconds for conclusion...", self.channel_id, reason)
        update_pipeline_progress("triggered", channel_id=self.channel_id, step=1, step_name=f"Hype Moment Triggered ({reason})! Buffering event...", trigger_reason=reason)
        await asyncio.sleep(20)

        update_pipeline_progress("processing", channel_id=self.channel_id, step=2, step_name="Slicing and concatenating 75s ring buffer chunks...", trigger_reason=reason)
        chunks = sorted(glob.glob(str(self.buffer_path / "chunk_*.ts")), key=os.path.getmtime)
        if len(chunks) < 3:
            logger.warning("Not enough ring-buffer chunks on %s to create clip (chunks: %d).", self.channel_id, len(chunks))
            update_pipeline_progress("idle", channel_id=self.channel_id, step=0, step_name="Idle - Awaiting Stream Moments")
            return

        selected_chunks = chunks[-8:]
        timestamp_id = int(time.time())
        concat_list_file = self.buffer_path / f"concat_{timestamp_id}.txt"
        target_mp4 = self.buffer_path / f"highlight_{timestamp_id}.mp4"

        with open(concat_list_file, "w", encoding="utf-8") as f:
            for c in selected_chunks:
                clean_path = str(Path(c).resolve()).replace("\\", "/")
                f.write(f"file '{clean_path}'\n")

        cmd = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_list_file),
            "-c", "copy",
            str(target_mp4),
        ]

        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        _, stderr_bytes = await proc.communicate()

        try:
            if concat_list_file.exists():
                concat_list_file.unlink()
        except Exception:
            pass

        if target_mp4.exists() and proc.returncode == 0:
            logger.info("Successfully sliced live highlight: %s (%s)", target_mp4, reason)
            if self.on_viral_moment_detected:
                metadata = {
                    "source_type": "live",
                    "channel_id": self.channel_id,
                    "platform": self.platform,
                    "trigger_reason": reason,
                    "trigger_context": trigger_context or {},
                    "chat_features": chat_features or {},
                    "stream_title": getattr(self, "_stream_title", ""),
                    "stream_category": getattr(self, "_stream_category", ""),
                    "timestamp": timestamp_id,
                }
                asyncio.create_task(self.on_viral_moment_detected(str(target_mp4), metadata))
        else:
            err_msg = stderr_bytes.decode('utf-8', errors='replace') if stderr_bytes else 'Unknown FFmpeg error'
            logger.error("FFmpeg concat failed for %s (exit code %d): %s", self.channel_id, proc.returncode, err_msg)
            update_pipeline_progress("error", channel_id=self.channel_id, error=f"Ring buffer concat failed (exit code {proc.returncode})")
            async def _reset_err():
                await asyncio.sleep(10)
                update_pipeline_progress("idle", channel_id=self.channel_id, step=0, step_name="Idle - Awaiting Stream Moments")
            asyncio.create_task(_reset_err())
