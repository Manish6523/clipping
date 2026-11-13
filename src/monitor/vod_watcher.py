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


class VODWatcher:
    """Monitors YouTube and Twitch channels for newly published VODs and processes retention peaks."""

    def __init__(
        self,
        on_vod_clip_ready: Optional[Callable[[str, Dict[str, Any]], Any]] = None,
    ):
        self.on_vod_clip_ready = on_vod_clip_ready
        self.is_running = False
        self.last_error: Optional[str] = None  # explained yt-dlp error of the last section download

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

    async def download_audio_first(self, video_url: str, output_dir: Path) -> str:
        """Download the audio track (first 3 hours) for transcription.

        Native format (m4a/opus) - the transcriber converts it to 16 kHz mono itself; a full-length
        WAV would be ~600 MB/hour. Raises RuntimeError with yt-dlp's explained error on failure
        (previously it returned None and the URL was then treated as a file path).
        """
        output_dir.mkdir(parents=True, exist_ok=True)
        for old in output_dir.glob("audio_extract.*"):
            old.unlink(missing_ok=True)
        rc, _out, err = await ytdlp.run([
            "-f", "ba/b",
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

        try:
            # 1. Parse heatmap peaks
            peaks = await self.fetch_heatmap_peaks(video_url)

            # 2. Download audio-only
            audio_path = await self.download_audio_first(video_url, work_dir)

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

