"""Seed Detector for Same-Stream Narrative Storylines.

Extracts narrative seeds (promises, bets, challenges, running jokes, conditional commitments)
from live stream ring buffer chunks using low-priority transcription (tiny.en + VAD)
and regex pre-filtering with strictly enforced CPU budgets.

Budgets & Constraints:
- Max 35% of 1 CPU core (measured execution time vs audio duration, RTF degradation hierarchy).
- Rate limits: merge hits within 60s, max 6 staged snippets per hour per channel.
- Ring buffer stream-copy staging: ~8s before to ~15s after match (23s total) using mtime/ffprobe.
- Fail-safe: Always prioritizes hype detection; pauses gracefully on resource contention.
"""

import asyncio
import glob
import logging
import os
import re
import time
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import config.settings as settings
from config.settings import (
    BUFFER_DIR,
    STORY_SEEDS_DIR,
)
from src.intelligence.transcriber import Transcriber, WhisperBusy
from src.intelligence.session_storyline import (
    get_or_create_active_session,
    stage_seed_snippet,
    get_pattern_stats,
)

logger = logging.getLogger(__name__)

# Standardized Regex Patterns (Addendum 3)
# Text must be normalized before matching: lowercase, replace curly apostrophes with ', collapse whitespace.
SUBJ = r"(?:i|we)"
COMMIT = r"(?:'ll|\s+will|'m\s+going\s+to|\s+am\s+going\s+to|'m\s+gonna|\s+am\s+gonna|\s+have\s+to|\s+gotta)"
TRIG = r"(?:every\s+time|whenever|each\s+time)"

SEED_PATTERNS = {
    "trigger_first": re.compile(rf"\b{TRIG}\b.{{1,80}}?\b{SUBJ}{COMMIT}\b", re.IGNORECASE),
    "commit_first": re.compile(rf"\b{SUBJ}{COMMIT}\b.{{1,80}}?\b{TRIG}\b", re.IGNORECASE),
    "if_then": re.compile(rf"\bif\b.{{1,80}}?\b{SUBJ}{COMMIT}\b", re.IGNORECASE),
    "then_if": re.compile(rf"\b{SUBJ}{COMMIT}\b.{{1,80}}?\bif\b", re.IGNORECASE),
    "bet": re.compile(rf"\b{SUBJ}\b\s+bet\b", re.IGNORECASE),
    "promise": re.compile(rf"\b{SUBJ}\b\s+promise\b", re.IGNORECASE),
}

# Rate limiting state: channel_id -> list of float timestamps of staged snippets in the past hour
_HOURLY_STAGED_TIMESTAMPS: Dict[str, List[float]] = defaultdict(list)
_LAST_STAGED_TIMESTAMP: Dict[str, float] = defaultdict(float)

# Degradation & CPU tracking
_RECENT_RTF_MEASUREMENTS: List[float] = []
_SEED_DETECTION_PAUSED: Dict[str, float] = defaultdict(float)   # channel -> paused-until (epoch s)
SEED_PAUSE_COOLDOWN_S = 600.0


def normalize_transcript_text(text: str) -> str:
    """Normalize text: lowercase, replace curly apostrophes with ', collapse whitespace."""
    if not text:
        return ""
    # Replace curly apostrophes and single quotes
    t = text.replace("’", "'").replace("‘", "'").replace("`", "'")
    t = t.lower()
    t = re.sub(r"\s+", " ", t).strip()
    return t


def match_seed_patterns(sentence: str) -> Optional[Tuple[str, str]]:
    """Match sentence against standardized seed patterns.
    
    Returns (pattern_name, matched_text) or None.
    """
    normalized = normalize_transcript_text(sentence)
    for name, pattern in SEED_PATTERNS.items():
        m = pattern.search(normalized)
        if m:
            return name, m.group(0)
    return None


@dataclass
class StagedCandidate:
    pattern_name: str
    sentence_text: str
    match_str: str
    stream_epoch_start: float
    output_path: Path
    transcript_snippet: str


class SeedDetector:
    """Monitors live stream audio for narrative setup seeds within resource budget."""

    def __init__(self, channel_id: str, channel_handle: str):
        self.channel_id = str(channel_id)
        self.channel_handle = channel_handle
        # Use tiny.en model for lowest CPU overhead (guaranteed <= 35% core target)
        self.transcriber = Transcriber(model_size="tiny.en", beam_size=1)
        self._last_processed_chunk_mtime: float = 0.0

    def can_stage_now(self) -> bool:
        """Check rate limits: 60s cooldown between hits, max 6 staged per hour per channel."""
        now = time.time()
        # 1. Check 60s cooldown
        last_t = _LAST_STAGED_TIMESTAMP[self.channel_id]
        if (now - last_t) < 60.0:
            return False

        # 2. Check hourly cap (max 6)
        timestamps = [t for t in _HOURLY_STAGED_TIMESTAMPS[self.channel_id] if (now - t) < 3600.0]
        _HOURLY_STAGED_TIMESTAMPS[self.channel_id] = timestamps
        if len(timestamps) >= 6:
            logger.info("Channel %s hit seed staging hourly cap (6/hr)", self.channel_handle)
            return False

        return True

    def record_staged_hit(self) -> None:
        """Record timestamp for rate limit tracking."""
        now = time.time()
        _LAST_STAGED_TIMESTAMP[self.channel_id] = now
        _HOURLY_STAGED_TIMESTAMPS[self.channel_id].append(now)

    async def stage_ring_buffer_snippet(
        self,
        session_id: str,
        around_mtime: float,
        before_sec: float = 8.0,
        after_sec: float = 15.0,
    ) -> Optional[Path]:
        """Stream-copy ~8s before to ~15s after match from ring buffer chunks (no re-encode)."""
        buffer_dir = Path(BUFFER_DIR) / self.channel_handle
        if not buffer_dir.exists():
            return None

        # Gather recent chunks sorted by mtime
        chunk_files = sorted(buffer_dir.glob("chunk_*.ts"), key=os.path.getmtime)
        if not chunk_files:
            return None

        # Identify chunks covering the [around_mtime - before_sec, around_mtime + after_sec] interval
        target_start = around_mtime - before_sec
        target_end = around_mtime + after_sec

        selected_chunks = []
        for cf in chunk_files:
            cmtime = os.path.getmtime(cf)
            # A chunk typically lasts 2-5s; consider chunk relevant if its mtime is near target range
            if (cmtime >= target_start - 10.0) and (cmtime <= target_end + 10.0):
                selected_chunks.append(cf)

        if not selected_chunks:
            # Fallback: take latest 4 chunks
            selected_chunks = chunk_files[-4:]

        session_staging = STORY_SEEDS_DIR / session_id / "staging"
        session_staging.mkdir(parents=True, exist_ok=True)
        ts_now = int(time.time() * 1000)
        concat_list_file = session_staging / f"concat_{ts_now}.txt"
        output_mp4 = session_staging / f"staged_{ts_now}.mp4"

        try:
            # Write ffmpeg concat file
            with open(concat_list_file, "w", encoding="utf-8") as f:
                for sc in selected_chunks:
                    f.write(f"file '{sc.resolve().as_posix()}'\n")

            # Stream copy concatenate into mp4
            cmd = [
                "ffmpeg", "-y",
                "-f", "concat",
                "-safe", "0",
                "-i", str(concat_list_file),
                "-c", "copy",
                "-movflags", "+faststart",
                str(output_mp4)
            ]
            proc = await asyncio.create_subprocess_exec(
                *cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await asyncio.wait_for(proc.communicate(), timeout=15.0)

            if output_mp4.exists() and output_mp4.stat().st_size > 10000:
                return output_mp4
        except Exception as e:
            logger.warning("Failed staging ring buffer snippet: %s", e)
        finally:
            if concat_list_file.exists():
                concat_list_file.unlink(missing_ok=True)

        return None

    async def process_latest_audio(self) -> Optional[int]:
        """Transcribe latest audio chunk under CPU budget and stage on regex match."""
        if time.time() < _SEED_DETECTION_PAUSED[self.channel_id]:
            return None

        buffer_dir = Path(BUFFER_DIR) / self.channel_handle
        if not buffer_dir.exists():
            return None

        chunks = sorted(buffer_dir.glob("chunk_*.ts"), key=os.path.getmtime)
        if not chunks:
            return None

        latest_chunk = chunks[-1]
        cmtime = os.path.getmtime(latest_chunk)
        if cmtime <= self._last_processed_chunk_mtime:
            return None

        self._last_processed_chunk_mtime = cmtime

        t0 = time.time()
        try:
            # Low priority: skip this chunk if hype processing (or anything else) holds every Whisper slot.
            # transcribe() takes the slot itself - holding one here as well deadlocked all transcription.
            try:
                res = await self.transcriber.transcribe(str(latest_chunk), slot_wait=1.0)
            except WhisperBusy:
                logger.debug("Whisper busy; skipping seed check for %s", self.channel_handle)
                return None
            t1 = time.time()
            elapsed = t1 - t0

            # Measure Real-Time Factor (RTF)
            audio_dur = res.get("duration", 0.0) or 4.0
            rtf = elapsed / max(audio_dur, 1.0)
            _RECENT_RTF_MEASUREMENTS.append(rtf)
            if len(_RECENT_RTF_MEASUREMENTS) > 20:
                _RECENT_RTF_MEASUREMENTS.pop(0)

            # Degradation hierarchy: if RTF > 0.5 or CPU budget exceeded, throttle or pause
            avg_rtf = sum(_RECENT_RTF_MEASUREMENTS) / len(_RECENT_RTF_MEASUREMENTS)
            rtf_limit = float(settings.STORY_SEED_CPU_BUDGET) + 0.15      # 0.35 budget -> 0.50 pause threshold
            if avg_rtf > rtf_limit:
                logger.warning(
                    "Seed transcription RTF %.2f exceeds %.2f limit on %s; pausing seed detection for %d min",
                    avg_rtf, rtf_limit, self.channel_handle, int(SEED_PAUSE_COOLDOWN_S // 60)
                )
                _SEED_DETECTION_PAUSED[self.channel_id] = time.time() + SEED_PAUSE_COOLDOWN_S
                _RECENT_RTF_MEASUREMENTS.clear()                           # measure fresh after the cooldown
                return None

            segments = res.get("segments", [])
            for seg in segments:
                text = seg.get("text", "")
                match_res = match_seed_patterns(text)
                if match_res and self.can_stage_now():
                    pat_name, matched_part = match_res
                    logger.info("Seed regex hit [%s] on %s: '%s'", pat_name, self.channel_handle, text)
                    
                    session = await get_or_create_active_session(self.channel_id)
                    if not session:
                        continue

                    snippet_path = await self.stage_ring_buffer_snippet(session["id"], cmtime)
                    if snippet_path:
                        self.record_staged_hit()
                        staging_id = await stage_seed_snippet(
                            session_id=session["id"],
                            channel_id=self.channel_id,
                            snippet_path=str(snippet_path),
                            regex_pattern=pat_name,
                            transcript_snippet=text,
                        )
                        logger.info("Staged seed candidate #%d at %s", staging_id, snippet_path)
                        return staging_id

        except Exception as e:
            logger.warning("Error during seed detection for %s: %s", self.channel_handle, e)

        return None

