"""VOD Poller: RSS/API poller + yt-dlp heatmap parsing & audio-first slice extractor."""

import asyncio
import json
import logging
import os
import sys
from pathlib import Path
from typing import Any, Callable, Dict, List, Optional
import feedparser

from config.settings import BUFFER_DIR
from src.database import is_vod_processed, record_vod, update_vod_status

logger = logging.getLogger(__name__)


class VODWatcher:
    """Monitors YouTube and Twitch channels for newly published VODs and processes retention peaks."""

    def __init__(
        self,
        on_vod_clip_ready: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
    ):
        self.on_vod_clip_ready = on_vod_clip_ready
        self.is_running = False

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
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "--dump-json",
            "--skip-download",
            video_url,
        ]

        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, _ = await proc.communicate()

        if proc.returncode != 0 or not stdout:
            return []

        try:
            info = json.loads(stdout.decode(errors="ignore"))
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

    async def download_audio_first(self, video_url: str, output_dir: Path) -> Optional[str]:
        """Download fast audio-only stream (yt-dlp -f ba) for quick transcription."""
        out_template = str(output_dir / "audio_extract.%(ext)s")
        cmd = [
            sys.executable, "-m", "yt_dlp",
            "-f", "ba",
            "-x",
            "--audio-format", "wav",
            "--output", out_template,
            video_url,
        ]

        proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await proc.communicate()

        expected_wav = output_dir / "audio_extract.wav"
        if expected_wav.exists():
            return str(expected_wav)
        return None

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
            sys.executable, "-m", "yt_dlp",
            "-f", "bestvideo[height<=720][ext=mp4]+bestaudio[ext=m4a]/best[height<=720][ext=mp4]/bestvideo[height<=720]+bestaudio/best[height<=720]/best",
            "--download-sections", section_arg,
            "--no-warnings",
            "--output", str(output_file),
            video_url,
        ]

        try:
            proc = await asyncio.create_subprocess_exec(*cmd, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
            await proc.communicate()
        except Exception as e:
            logger.error("download_video_section subprocess error: %s", e)

        return output_file.exists() and output_file.stat().st_size > 0

    async def process_vod(
        self,
        platform: str,
        channel_id: str,
        vod_id: str,
        title: str,
        video_url: str,
        template_name: str,
    ) -> None:
        """Execute full VOD heatmap and audio extraction pipeline."""
        if await is_vod_processed(vod_id):
            return

        logger.info("Processing new VOD '%s' (%s) for channel %s...", title, vod_id, channel_id)
        await record_vod(platform, channel_id, vod_id, title)
        await update_vod_status(vod_id, "processing")

        work_dir = Path(BUFFER_DIR) / "vods" / vod_id
        work_dir.mkdir(parents=True, exist_ok=True)

        try:
            # 1. Parse heatmap peaks
            peaks = await self.fetch_heatmap_peaks(video_url)

            # 2. Download audio-only
            audio_path = await self.download_audio_first(video_url, work_dir)

            if self.on_vod_clip_ready:
                await self.on_vod_clip_ready(
                    audio_path or video_url,
                    {
                        "source_type": "vod",
                        "vod_id": vod_id,
                        "video_url": video_url,
                        "title": title,
                        "channel_id": channel_id,
                        "platform": platform,
                        "template_name": template_name,
                        "heatmap_peaks": peaks,
                        "work_dir": str(work_dir),
                    },
                )

            await update_vod_status(vod_id, "completed")
        except Exception as e:
            logger.error("Failed processing VOD %s: %s", vod_id, e)
            await update_vod_status(vod_id, "failed")

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
            cmd = [
                sys.executable, "-m", "yt_dlp",
                "--dump-json",
                "--playlist-items", "1",
                "--skip-download",
                url,
            ]
            try:
                proc = await asyncio.create_subprocess_exec(
                    *cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                )
                stdout, _ = await proc.communicate()
                if proc.returncode == 0 and stdout:
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

