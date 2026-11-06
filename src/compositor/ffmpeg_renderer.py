"""Template-driven FFmpeg compositor with VAAPI hardware acceleration & libx264 CPU fallback."""

import asyncio
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging

from config.settings import USE_VAAPI, VAAPI_DEVICE, RENDER_DIR
from src.compositor.face_tracker import FaceTracker
from src.compositor.crop_calculator import build_crop_filter

logger = logging.getLogger(__name__)


def escape_ffmpeg_path(path: str | Path) -> str:
    """Format file path for safe usage inside FFmpeg filtergraph strings."""
    raw = str(Path(path).resolve()).replace("\\", "/")
    # Escape colon for Windows drive letters like C:/
    if len(raw) > 1 and raw[1] == ":":
        raw = raw[0] + "\\:" + raw[2:]
    return raw


class FFmpegRenderer:
    """Renders 9:16 vertical social clips with kinetic subtitles, layout templates, and anti-shadowban."""

    def __init__(self, use_vaapi: bool = USE_VAAPI, vaapi_device: str = VAAPI_DEVICE):
        self.use_vaapi = use_vaapi and os.path.exists(vaapi_device)
        self.vaapi_device = vaapi_device
        self.face_tracker = FaceTracker()

    def build_layout_filter(
        self,
        template: Dict[str, Any],
        source_path: str,
        ass_path: Optional[str] = None,
        has_watermark: bool = False,
        watermark_path: Optional[str] = None,
    ) -> str:
        """
        Build the video filter_complex pipeline according to the template layout.
        
        Outputs are labelled [vout].
        """
        layout = template.get("layout", {})
        l_type = layout.get("type", "facecam_top_gameplay_bottom")
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        contrast = anti.get("contrast", 1.03)
        saturation = anti.get("saturation", 1.05)

        filters: List[str] = []

        if l_type == "facecam_top_gameplay_bottom":
            crop_res = build_crop_filter(template, 1920, 1080)
            filters.append(f"[0:v]{crop_res['top']['scale_filter']}[top_cam]")
            filters.append(f"[0:v]{crop_res['bottom']['scale_filter']}[bot_game]")
            filters.append("[top_cam][bot_game]vstack=inputs=2[stacked]")
            last_v = "[stacked]"

        elif l_type == "split_screen_50_50":
            crop_res = build_crop_filter(template, 1920, 1080)
            filters.append(f"[0:v]{crop_res['top']['scale_filter']}[spk1]")
            filters.append(f"[0:v]{crop_res['bottom']['scale_filter']}[spk2]")
            filters.append("[spk1][spk2]vstack=inputs=2[stacked]")
            last_v = "[stacked]"

        elif l_type == "dynamic_face_track":
            # Single 9:16 crop centered on active speaker face
            crop_box = self.face_tracker.get_static_average_crop(source_path)
            cx, cy, cw, ch = crop_box
            filters.append(
                f"[0:v]crop={cw}:{ch}:{cx}:{cy},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[tracked]"
            )
            last_v = "[tracked]"

        elif l_type == "blurred_bg_center":
            # Blurred 9:16 background with sharp centered 16:9 foreground
            filters.append(
                "[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,boxblur=25:5[bg]"
            )
            filters.append(
                "[0:v]scale=1080:608:force_original_aspect_ratio=decrease[fg]"
            )
            filters.append("[bg][fg]overlay=0:(H-h)/2[stacked]")
            last_v = "[stacked]"

        else:
            # Fallback 1080x1920 crop
            filters.append("[0:v]crop=608:1080:656:0,scale=1080:1920[stacked]")
            last_v = "[stacked]"

        # Anti-shadowban video adjustments (speed + color grading)
        filters.append(
            f"{last_v}setpts=PTS/{speed},eq=contrast={contrast}:saturation={saturation}[graded]"
        )
        last_v = "[graded]"

        # Watermark overlay (if provided and valid)
        if has_watermark and watermark_path and os.path.exists(watermark_path):
            escaped_wm = escape_ffmpeg_path(watermark_path)
            # Default to top-right
            filters.append(f"movie='{escaped_wm}'[wm];{last_v}[wm]overlay=W-w-30:40[with_wm]")
            last_v = "[with_wm]"

        # Subtitle burning (.ass)
        if ass_path and os.path.exists(ass_path):
            escaped_ass = escape_ffmpeg_path(ass_path)
            filters.append(f"{last_v}subtitles='{escaped_ass}'[vout]")
        else:
            filters.append(f"{last_v}null[vout]")

        return ";".join(filters)

    async def render_clip(
        self,
        source_path: str,
        start_time: float,
        end_time: float,
        output_path: str,
        template: Dict[str, Any],
        ass_path: Optional[str] = None,
        teaser_timestamp: Optional[float] = None,
        include_teaser: bool = True,
    ) -> str:
        """
        Execute full FFmpeg render pipeline for vertical clip.
        """
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)

        duration = max(5.0, end_time - start_time)
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        wm_path = anti.get("watermark_path")
        has_wm = bool(wm_path and os.path.exists(wm_path))

        filter_complex = self.build_layout_filter(
            template=template,
            source_path=source_path,
            ass_path=ass_path,
            has_watermark=has_wm,
            watermark_path=wm_path,
        )

        # Audio filter: atempo to match video speed, plus optional silence removal
        audio_filters = [f"atempo={speed}"]
        pacing = template.get("pacing", {})
        if pacing.get("strip_silences", False):
            silence_ms = pacing.get("silence_threshold_ms", 350)
            silence_sec = silence_ms / 1000.0
            noise_db = pacing.get("silence_noise_db", -35.0)
            audio_filters.append(f"silenceremove=stop_periods=-1:stop_duration={silence_sec}:stop_threshold={noise_db}dB")

        a_filter_str = ",".join(audio_filters)

        # Base FFmpeg command
        cmd = ["ffmpeg", "-y"]

        # Hardware acceleration flags if enabled
        if self.use_vaapi:
            cmd.extend([
                "-vaapi_device", self.vaapi_device,
                "-hwaccel", "vaapi",
                "-hwaccel_output_format", "vaapi"
            ])

        # Precise seeking inputs
        cmd.extend([
            "-ss", f"{start_time:.3f}",
            "-t", f"{duration:.3f}",
            "-i", str(source_path),
            "-filter_complex", filter_complex,
            "-map", "[vout]",
            "-map", "0:a:0?",
            "-af", a_filter_str,
        ])

        # Encoding codec selection
        if self.use_vaapi:
            cmd.extend(["-c:v", "h264_vaapi", "-qp", "22"])
        else:
            cmd.extend(["-c:v", "libx264", "-preset", "fast", "-crf", "21"])

        cmd.extend([
            "-c:a", "aac",
            "-b:a", "192k",
            "-movflags", "+faststart",
            str(out_p),
        ])

        logger.info("Executing FFmpeg render: %s", " ".join(cmd))
        process = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )

        stdout, stderr = await process.communicate()
        if process.returncode != 0:
            err_msg = stderr.decode(errors="ignore")
            logger.error("FFmpeg render failed:\n%s", err_msg)
            # If VAAPI failed, retry with CPU libx264
            if self.use_vaapi:
                logger.warning("Retrying render with CPU libx264 fallback...")
                self.use_vaapi = False
                return await self.render_clip(
                    source_path=source_path,
                    start_time=start_time,
                    end_time=end_time,
                    output_path=output_path,
                    template=template,
                    ass_path=ass_path,
                    teaser_timestamp=teaser_timestamp,
                    include_teaser=include_teaser,
                )
            raise RuntimeError(f"FFmpeg failed with exit code {process.returncode}: {err_msg[:400]}")

        # If teaser hook requested and available, prepend it
        if include_teaser and teaser_timestamp is not None and pacing.get("teaser_preroll", True):
            teaser_output = await self._prepend_teaser_hook(
                base_rendered_path=str(out_p),
                source_path=source_path,
                teaser_timestamp=teaser_timestamp,
                template=template,
            )
            return teaser_output

        # Generate JPEG thumbnail poster at 1.0s
        final_mp4 = str(out_p)
        thumb_path = out_p.parent / f"{out_p.stem}_thumb.jpg"
        try:
            t_cmd = [
                "ffmpeg", "-y",
                "-ss", "1.0",
                "-i", final_mp4,
                "-vframes", "1",
                "-vf", "scale=540:960:force_original_aspect_ratio=decrease",
                "-q:v", "3",
                str(thumb_path)
            ]
            t_proc = await asyncio.create_subprocess_exec(
                *t_cmd, stdout=asyncio.subprocess.DEVNULL, stderr=asyncio.subprocess.DEVNULL
            )
            await t_proc.communicate()
        except Exception as e:
            logger.debug("Poster extraction skipped: %s", e)

        return final_mp4

    async def _prepend_teaser_hook(
        self,
        base_rendered_path: str,
        source_path: str,
        teaser_timestamp: float,
        template: Dict[str, Any],
    ) -> str:
        """Extract a 1.5s teaser climax, apply flash transition, and concatenate before main clip."""
        teaser_tmp = Path(RENDER_DIR) / f"teaser_{os.path.basename(base_rendered_path)}"
        final_concat = Path(RENDER_DIR) / f"final_{os.path.basename(base_rendered_path)}"

        # Render 1.5s teaser in same vertical layout
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        filter_complex = self.build_layout_filter(
            template=template,
            source_path=source_path,
            ass_path=None,
            has_watermark=False,
        )
        # Add white flash at the end of teaser (st=1.3 d=0.2)
        flash_filter = f"{filter_complex};[vout]fade=t=out:st=1.3:d=0.2:color=white[v_flashed]"

        cmd_teaser = [
            "ffmpeg", "-y",
            "-ss", f"{teaser_timestamp:.3f}",
            "-t", "1.500",
            "-i", str(source_path),
            "-filter_complex", flash_filter,
            "-map", "[v_flashed]",
            "-map", "0:a:0?",
            "-c:v", "libx264", "-preset", "veryfast", "-crf", "22",
            "-c:a", "aac", "-b:a", "192k",
            str(teaser_tmp),
        ]

        p = await asyncio.create_subprocess_exec(*cmd_teaser, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await p.communicate()

        if p.returncode != 0:
            logger.warning("Teaser hook generation failed, proceeding with original render.")
            return base_rendered_path

        # Concatenate teaser + main clip
        concat_txt = Path(RENDER_DIR) / f"concat_{os.path.basename(base_rendered_path)}.txt"
        with open(concat_txt, "w", encoding="utf-8") as f:
            f.write(f"file '{str(Path(teaser_tmp).resolve()).replace('\\', '/')}'\n")
            f.write(f"file '{str(Path(base_rendered_path).resolve()).replace('\\', '/')}'\n")

        cmd_concat = [
            "ffmpeg", "-y",
            "-f", "concat", "-safe", "0",
            "-i", str(concat_txt),
            "-c", "copy",
            str(final_concat),
        ]

        p2 = await asyncio.create_subprocess_exec(*cmd_concat, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE)
        await p2.communicate()

        # Clean up temp teaser
        try:
            if teaser_tmp.exists():
                teaser_tmp.unlink()
            if concat_txt.exists():
                concat_txt.unlink()
        except Exception:
            pass

        if p2.returncode == 0 and final_concat.exists():
            # Replace base rendered with final
            shutil.move(str(final_concat), base_rendered_path)
            return base_rendered_path

        return base_rendered_path

