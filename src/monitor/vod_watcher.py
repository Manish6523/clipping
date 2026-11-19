"""VOD Poller: RSS/API poller + yt-dlp heatmap parsing & audio-first slice extractor."""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import feedparser

from src.monitor import ytdlp
from config.settings import BUFFER_DIR
from src.database import is_vod_processed, record_vod, update_vod_status

logger = logging.getLogger(__name__)

MAX_AUDIO_SECONDS = 3 * 3600  # matches the scorer's ~3h window cap
AUDIO_FORMAT = "ba[abr<=72]/wa/ba/b"   # ~50 kbps is plenty for speech recognition, ~1/3 the size
# Through free proxies one long download crawls (often <30 KB/s) and dies: fetch the audio in
# pieces, several at once through different proxies, then join them.
AUDIO_CHUNK_S = 600
AUDIO_CHUNK_PARALLEL = 5
AUDIO_CHUNK_TRIES = 3
AUDIO_PIECE_KEEP_S = 2 * 24 * 3600   # finished pieces are kept per video so a re-run only fetches what's missing


def audio_piece_dir(video_url: str) -> Path:
    """Where a video's audio pieces live between runs (keyed by the YouTube id when there is one)."""
    import hashlib
    import re
    m = re.search(r"(?:v=|youtu\.be/|/live/|/shorts/)([A-Za-z0-9_-]{11})", video_url)
    key = m.group(1) if m else hashlib.sha1(video_url.encode()).hexdigest()[:16]
    return Path(BUFFER_DIR) / "audio_pieces" / key


class VODWatcher:
    """Monitors YouTube and Twitch channels for newly published VODs and processes retention peaks."""

    def __init__(
        self,
        on_vod_clip_ready: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
    ):
        self.on_vod_clip_ready = on_vod_clip_ready
        self.is_running = False
        self.last_error: Optional[str] = None  # explained yt-dlp error of the last section download
        self.durations: Dict[str, float] = {}   # video_url -> seconds (from the metadata lookup)

    async def poll_youtube_channel_rss(self, channel_id: str) -> List[Dict[str, str]]:
        """Fetch latest uploaded videos via public YouTube RSS feed."""
        # Clean channel ID or handle
        clean_id = channel_id.strip()
        if clean_id.startswith("@"):
            feed_url = f"https://www.youtube.com/feeds/videos.xml?user={clean_id.lstrip('@')}"
        elif clean_id.startswith("UC"):
            feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={clean_id}"
        else:
            feed_url = f"https://www.youtube.com/feeds/videos.xml?channel_id={clean_id}"

        loop = asyncio.get_running_loop()
        feed = await loop.run_in_executor(None, lambda: feedparser.parse(feed_url))

        videos: List[Dict[str, str]] = []
        for entry in feed.entries[:5]:
            vid_id = entry.get("yt_videoid")
            if not vid_id:
                # Fallback to link parse
                link = entry.get("link", "")
                if "v=" in link:
                    vid_id = link.split("v=")[1].split("&")[0]

            if vid_id:
                videos.append({
                    "video_id": vid_id,
                    "title": entry.get("title", ""),
                    "published": entry.get("published", ""),
                    "url": f"https://www.youtube.com/watch?v={vid_id}",
                })

        return videos

    async def fetch_heatmap_peaks(self, video_url: str, min_retention: float = 0.75) -> List[Dict[str, Any]]:
        """
        Extract YouTube 'Most Replayed' heatmap data using yt-dlp metadata.
        Returns list of peak intervals: [{'start_time': float, 'end_time': float, 'value': float}]
        """
        rc, stdout, err = await ytdlp.run(["--dump-json", "--skip-download", video_url], timeout=120)
        if rc != 0 or not stdout:
            # Not fatal (heatmap is only a hint) but worth knowing: usually the same cause as a failed download
            logger.warning("Heatmap lookup failed for %s: %s", video_url, ytdlp.explain(err))
            return []

        try:
            info = json.loads(stdout.decode(errors="ignore"))
            if info.get("duration"):
                self.durations[video_url] = float(info["duration"])
            heatmap = info.get("heatmap") or []
            peaks = []

            for point in heatmap:
                val = point.get("value", 0.0)
                if val >= min_retention:
                    peaks.append({
                        "start_time": point.get("start_time", 0.0),
                        "end_time": point.get("end_time", 0.0),
                        "value": val,
                    })
            return peaks
        except Exception as e:
            logger.warning("Could not parse heatmap for %s: %s", video_url, e)
            return []

    async def fetch_chat_peaks(self, video_url: str, work_dir: Path, timeout: float = 600) -> List[Dict[str, Any]]:
        """Chat-replay velocity spikes for a YouTube past live stream (yt-dlp `live_chat` subtitles).
        Anything else (Twitch, normal uploads, no replay, timeouts) -> []."""
        if "youtube.com" not in video_url and "youtu.be" not in video_url:
            return []
        out_tmpl = str(work_dir / "chat.%(ext)s")
        rc, _out, err = await ytdlp.run(
            ["--skip-download", "--write-subs", "--sub-langs", "live_chat", "-o", out_tmpl, video_url],
            timeout=timeout,
        )
        files = sorted(work_dir.glob("chat*.live_chat.json"))
        if not files:
            if rc != 0:
                logger.info("No chat replay for %s: %s", video_url, ytdlp.explain(err))
            return []
        comments = parse_live_chat_replay(files[0])
        from src.intelligence.chat_signals import spikes_from_replay
        peaks = spikes_from_replay(comments)
        logger.info("Chat replay: %d messages, %d spikes for %s", len(comments), len(peaks), video_url)
        return peaks

    async def download_audio_first(self, video_url: str, output_dir: Path, duration: Optional[float] = None) -> str:
        """Download the audio track (first 3 hours) for transcription.

        Native format (m4a/opus) - the transcriber converts it to 16 kHz mono itself; a full-length
        WAV would be ~600 MB/hour. Raises RuntimeError with yt-dlp's explained error on failure
        (previously it returned None and the URL was then treated as a file path).
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        for old in output_dir.glob("audio_extract.*"):
            old.unlink(missing_ok=True)
        duration = duration or getattr(self, "durations", {}).get(video_url)
        if duration and duration > AUDIO_CHUNK_S * 1.5 and ytdlp.direct_blocked():
            return await self._download_audio_chunked(video_url, output_dir, min(duration, MAX_AUDIO_SECONDS))
        rc, _out, err = await ytdlp.run([
            "-f", AUDIO_FORMAT,
            "--download-sections", f"*0-{MAX_AUDIO_SECONDS}",
            "--output", str(output_dir / "audio_extract.%(ext)s"),
            video_url,
        ], timeout=1800)
        files = sorted(f for f in output_dir.glob("audio_extract.*") if f.suffix not in (".part", ".ytdl") and f.stat().st_size > 0)
        if rc == 0 and files:
            return str(files[0])
        from src.notify import alerts
        await alerts.download_failed(err, video_url)
        raise RuntimeError(f"Could not download the video's audio: {ytdlp.explain(err)}")

    async def _download_audio_chunked(self, video_url: str, output_dir: Path, duration: float) -> str:
        """Audio in AUDIO_CHUNK_S pieces, AUDIO_CHUNK_PARALLEL at a time (each its own proxy race),
        joined into one file. A failed piece is retried on its own; finished pieces are kept per
        video (audio_piece_dir) so a re-run after a failure only downloads what's missing."""
        import shutil
        import time as _time
        pieces_dir = audio_piece_dir(video_url)
        pieces_dir.mkdir(parents=True, exist_ok=True)
        for old in pieces_dir.parent.iterdir():          # forget other videos' pieces after a while
            if old != pieces_dir and old.is_dir() and _time.time() - old.stat().st_mtime > AUDIO_PIECE_KEEP_S:
                shutil.rmtree(old, ignore_errors=True)
        bounds = []
        t = 0.0
        while t < duration - 1:
            bounds.append((t, min(duration, t + AUDIO_CHUNK_S)))
            t += AUDIO_CHUNK_S
        sem = asyncio.Semaphore(AUDIO_CHUNK_PARALLEL)
        errors: Dict[int, str] = {}

        def existing(i: int) -> List[Path]:
            return [f for f in pieces_dir.glob(f"audio_chunk_{i:03d}.*")
                    if f.suffix not in (".part", ".ytdl") and f.stat().st_size > 0]

        have = [i for i in range(len(bounds)) if existing(i)]
        logger.info("YouTube blocks this server: fetching %.0f min of audio in %d pieces through proxies%s.",
                    duration / 60, len(bounds), f" ({len(have)} already downloaded)" if have else "")

        async def piece(i: int, a: float, b: float) -> Optional[Path]:
            if existing(i):
                return existing(i)[0]
            async with sem:
                for attempt in range(1, AUDIO_CHUNK_TRIES + 1):
                    rc, _out, err = await ytdlp.run([
                        # exact cuts (re-encode at the boundaries): a stream-copy cut lands up to ~10 s
                        # off, which would shift every transcript timestamp after the join
                        "-f", AUDIO_FORMAT, "--download-sections", f"*{a:.0f}-{b:.0f}", "--force-keyframes-at-cuts",
                        "--force-overwrites",
                        "--output", str(pieces_dir / f"audio_chunk_{i:03d}.%(ext)s"), video_url,
                    ], timeout=900)
                    got = existing(i)
                    if rc == 0 and got:
                        logger.info("Audio piece %d/%d (%.0f-%.0fs) done.", i + 1, len(bounds), a, b)
                        return got[0]
                    errors[i] = err
                    logger.warning("Audio piece %d/%d failed (try %d/%d): %s", i + 1, len(bounds), attempt,
                                   AUDIO_CHUNK_TRIES, ytdlp.explain(err)[:160])
                    if err and not ytdlp.is_proxy_failure(err):
                        break                        # a real answer (private, removed...): retrying won't help
                return None

        parts = await asyncio.gather(*(piece(i, a, b) for i, (a, b) in enumerate(bounds)))
        if not all(parts):
            err = next(iter(errors.values()), "")
            from src.notify import alerts
            await alerts.download_failed(err, video_url)
            missing = sum(1 for p in parts if not p)
            raise RuntimeError(f"Could not download the video's audio ({missing} of {len(parts)} pieces failed - "
                               f"the rest are kept, so trying again only fetches those): {ytdlp.explain(err)}")
        out = output_dir / "audio_extract.ogg"
        listing = output_dir / "audio_chunks.txt"
        listing.write_text("".join(f"file '{p.resolve()}'\n" for p in parts))
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", str(listing),
            "-vn", "-ac", "1", "-c:a", "libopus", "-b:a", "40k", str(out),
            stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.PIPE)
        _o, e = await proc.communicate()
        listing.unlink(missing_ok=True)
        if proc.returncode != 0 or not out.exists():
            raise RuntimeError(f"Could not join the audio pieces: {(e or b'').decode(errors='ignore')[-300:]}")
        shutil.rmtree(pieces_dir, ignore_errors=True)
        return str(out)

    async def download_video_section(
        self,
        video_url: str,
        start_time: float,
        end_time: float,
        output_file: Path,
    ) -> bool:
        """Download exact slice using yt-dlp --download-sections with stream copy."""
        section_arg = f"*{start_time:.2f}-{end_time:.2f}"
        # Prefer direct MP4/M4A streams that allow instantaneous slice extraction without re-encoding
        cmd = [
            # Prefer H.264 (avc1): it plays in every phone browser and renders fast. YouTube otherwise
            # serves AV1/VP9, which most phones can't decode (the editor's source preview stays black).
            "-f", (
                "bestvideo[vcodec^=avc1][height<=1080]+bestaudio[ext=m4a]"
                "/best[vcodec^=avc1][height<=1080]"
                "/bestvideo[height<=1080][ext=mp4]+bestaudio[ext=m4a]"
                "/bestvideo[height<=1080]+bestaudio/best[height<=1080]/best"
            ),
            "--merge-output-format", "mp4",
            "--download-sections", section_arg,
            "--force-overwrites",
            "--output", str(output_file),
            video_url,
        ]

        self.last_error = None
        try:
            rc, _out, err = await ytdlp.run(cmd, timeout=900)
        except Exception as e:
            rc, err = 1, str(e)
        ok = rc == 0 and output_file.exists() and output_file.stat().st_size > 0
        if not ok:
            self.last_error = ytdlp.explain(err)
            logger.error("Section download %.1f-%.1fs failed for %s: %s", start_time, end_time, video_url, self.last_error)
            from src.notify import alerts
            await alerts.download_failed(err, video_url)
        return ok

    async def process_vod(
        self,
        platform: str,
        channel_id: str,
        vod_id: str,
        title: str,
        video_url: str,
        template_name: str,
        options: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Execute full VOD heatmap and audio extraction pipeline.

        ``options`` (max_clips, min_len, max_len, focus) are passed through to clip selection.
        """
        if await is_vod_processed(vod_id):
            return

        logger.info("Processing new VOD '%s' (%s) for channel %s...", title, vod_id, channel_id)
        await record_vod(platform, channel_id, vod_id, title)
        await update_vod_status(vod_id, "processing")

        work_dir = Path(BUFFER_DIR) / "vods" / vod_id
        work_dir.mkdir(parents=True, exist_ok=True)
        from src.monitor.storage_gc import in_use
        with in_use(work_dir):          # the 15-min temp sweep must not touch a VOD still being worked on
            await self._process_vod_in(platform, channel_id, vod_id, title, video_url, template_name, options, work_dir)

    async def _process_vod_in(self, platform, channel_id, vod_id, title, video_url, template_name, options, work_dir) -> None:
        try:
            # 1. Parse heatmap peaks
            peaks = await self.fetch_heatmap_peaks(video_url)

            # 2. Download audio-only (+ the chat replay in parallel, YouTube only; best-effort)
            chat_task = asyncio.create_task(self.fetch_chat_peaks(video_url, work_dir))
            try:
                audio_path = await self.download_audio_first(video_url, work_dir)
            except Exception:
                chat_task.cancel()
                raise
            try:
                chat_peaks = await chat_task
            except Exception:
                chat_peaks = []

            if self.on_vod_clip_ready:
                await self.on_vod_clip_ready(
                    audio_path,
                    {
                        "source_type": "vod",
                        "vod_id": vod_id,
                        "video_url": video_url,
                        "title": title,
                        "channel_id": channel_id,
                        "platform": platform,
                        "template_name": template_name,
                        "heatmap_peaks": peaks,
                        "chat_peaks": chat_peaks,
                        "work_dir": str(work_dir),
                        **(options or {}),
                    },
                )

            await update_vod_status(vod_id, "completed")
        except Exception as e:
            logger.error("Failed processing VOD %s: %s", vod_id, e)
            await update_vod_status(vod_id, "failed")
            try:
                from src.web.logger_stream import update_pipeline_progress
                update_pipeline_progress("error", channel_id=channel_id, error=f"VOD processing failed: {str(e)[:200]}")
            except Exception:
                pass

    async def poll_channel_vods(self, platform: str, channel_id: str, template_name: str) -> None:
        """Poll channel for newest uploaded videos or VODs and process unhandled ones."""
        if platform == "youtube":
            try:
                videos = await self.poll_youtube_channel_rss(channel_id)
                for v in videos[:2]:
                    vid_id = v["video_id"]
                    if not await is_vod_processed(vid_id):
                        await self.process_vod(
                            platform="youtube",
                            channel_id=channel_id,
                            vod_id=vid_id,
                            title=v["title"],
                            video_url=v["url"],
                            template_name=template_name,
                        )
            except Exception as e:
                logger.debug("Failed polling YouTube RSS for %s: %s", channel_id, e)

        elif platform == "twitch":
            url = f"https://www.twitch.tv/{channel_id}/videos?filter=archives&sort=time"
            try:
                rc, stdout, err = await ytdlp.run(["--dump-json", "--playlist-items", "1", "--skip-download", url], timeout=120)
                if rc != 0:
                    logger.warning("Twitch VOD lookup failed for %s: %s", channel_id, ytdlp.explain(err))
                if rc == 0 and stdout:
                    info = json.loads(stdout.decode(errors="ignore"))
                    vod_id = str(info.get("id"))
                    title = info.get("title", f"Twitch VOD {vod_id}")
                    web_url = info.get("webpage_url") or f"https://www.twitch.tv/videos/{vod_id}"
                    if vod_id and not await is_vod_processed(vod_id):
                        await self.process_vod(
                            platform="twitch",
                            channel_id=channel_id,
                            vod_id=vod_id,
                            title=title,
                            video_url=web_url,
                            template_name=template_name,
                        )
            except Exception as e:
                logger.debug("Failed checking Twitch VODs for %s: %s", channel_id, e)



def parse_live_chat_replay(path: Path) -> List[tuple]:
    """yt-dlp's live_chat.json (one JSON object per line) -> [(offset_seconds, text), ...]."""
    out: List[tuple] = []
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        for line in f:
            try:
                obj = json.loads(line)
            except Exception:
                continue
            replay = obj.get("replayChatItemAction") or {}
            try:
                offset = int(replay.get("videoOffsetTimeMsec") or obj.get("videoOffsetTimeMsec") or -1) / 1000.0
            except (TypeError, ValueError):
                continue
            if offset < 0:
                continue
            for action in replay.get("actions") or []:
                item = (action.get("addChatItemAction") or {}).get("item") or {}
                renderer = item.get("liveChatTextMessageRenderer") or item.get("liveChatPaidMessageRenderer")
                if not renderer:
                    continue
                parts = []
                for run in (renderer.get("message") or {}).get("runs") or []:
                    if "text" in run:
                        parts.append(run["text"])
                    elif "emoji" in run:
                        em = run["emoji"]
                        shortcut = (em.get("shortcuts") or [None])[0]
                        name = (shortcut or "").strip(":")
                        parts.append(name if em.get("isCustomEmoji") else (em.get("emojiId") or name))
                text = " ".join(p for p in parts if p).strip()
                if text:
                    out.append((offset, text))
    return out
