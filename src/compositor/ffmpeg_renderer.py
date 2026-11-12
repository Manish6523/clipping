"""Template-driven FFmpeg compositor with VAAPI hardware acceleration & libx264 CPU fallback."""

import asyncio
import os
import shutil
from pathlib import Path
from typing import Any, Dict, List, Optional
import logging

from config.settings import USE_VAAPI, VAAPI_DEVICE, RENDER_DIR
from src.compositor.face_tracker import FaceTracker
from src.compositor.filter_graph_builder import build_filter_graph
from src.compositor.crop_calculator import build_crop_filter
from src.compositor.profanity import build_censor_audio_graph, compute_windows, resolve_sfx_path

logger = logging.getLogger(__name__)


async def has_audio_stream(path: str | Path) -> bool:
    """Return True when the media file contains at least one audio stream."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-select_streams", "a",
            "-show_entries", "stream=index", "-of", "csv=p=0", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        return bool(out.strip())
    except Exception:
        return False


async def build_censored_audio(
    source_path: str | Path,
    censor_words: Optional[List[Dict[str, Any]]],
    censor_cfg: Optional[Dict[str, Any]],
    words_time_offset: float,
    duration: float,
    tail_filters: List[str],
    sfx_input_index: int = 1,
) -> Optional[Dict[str, Any]]:
    """Return {"graph", "extra_inputs", "windows"} for censored audio, or None if nothing to do."""
    if not censor_words or not censor_cfg or not censor_cfg.get("enabled", True):
        return None
    if censor_cfg.get("audio_mode", "bleep") == "off":
        return None
    windows = compute_windows(censor_words, words_time_offset, duration, censor_cfg)
    if not windows or not await has_audio_stream(source_path):
        return None

    extra_inputs: List[str] = []
    sfx_idx: Optional[int] = None
    if censor_cfg.get("audio_mode") == "sfx":
        sfx_path = resolve_sfx_path(censor_cfg)
        if sfx_path:
            extra_inputs = ["-i", str(sfx_path)]
            sfx_idx = sfx_input_index
        else:
            logger.warning("Censor SFX file '%s' not found; falling back to bleep.", censor_cfg.get("sfx_file"))

    graph = build_censor_audio_graph(
        windows, censor_cfg, audio_in="0:a", sfx_input_index=sfx_idx, tail_filters=tail_filters
    )
    if not graph:
        return None
    return {"graph": graph, "extra_inputs": extra_inputs, "windows": windows}


async def probe_video_size(path: str | Path) -> Optional[tuple]:
    """Return (width, height) of the first video stream, or None."""
    try:
        proc = await asyncio.create_subprocess_exec(
            "ffprobe", "-v", "error", "-select_streams", "v:0",
            "-show_entries", "stream=width,height", "-of", "csv=p=0:s=x", str(path),
            stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.DEVNULL,
        )
        out, _ = await proc.communicate()
        w, h = out.decode().strip().splitlines()[0].split("x")[:2]
        return int(w), int(h)
    except Exception:
        return None


CANVAS_SRC_W, CANVAS_SRC_H = 1920, 1080


def normalize_source_input(filter_complex: str, size: Optional[tuple]) -> str:
    """All layout/crop math assumes a 1920x1080 source. When the real source differs
    (e.g. a 720p YouTube download), scale+pad it to 1920x1080 first and feed every
    former [0:v] consumer from a split of the normalized stream."""
    if not size or size == (CANVAS_SRC_W, CANVAS_SRC_H):
        return filter_complex
    uses = filter_complex.count("[0:v]")
    if uses == 0:
        return filter_complex
    norm = (
        f"[0:v]scale={CANVAS_SRC_W}:{CANVAS_SRC_H}:force_original_aspect_ratio=decrease,"
        f"pad={CANVAS_SRC_W}:{CANVAS_SRC_H}:(ow-iw)/2:(oh-ih)/2,setsar=1"
    )
    labels = [f"[srcn{i}]" for i in range(uses)]
    norm += (f",split={uses}" if uses > 1 else "") + "".join(labels)
    parts = filter_complex.split("[0:v]")
    rebuilt = parts[0] + "".join(labels[i] + parts[i + 1] for i in range(uses))
    return f"{norm};{rebuilt}"


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
        src_size: Optional[tuple] = None,
    ) -> str:
        """
        Build the video filter_complex pipeline according to the template layout.
        
        Outputs are labelled [vout].
        """
        layout = template.get("layout", {})
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        contrast = anti.get("contrast", 1.03)
        saturation = anti.get("saturation", 1.05)

        # If layout has schema 2 or multi-layer definitions, use modern filter graph builder
        if layout.get("schema") == 2 or "layers" in layout:
            graph_res = build_filter_graph(
                layout_data=layout,
                src_w=1920,
                src_h=1080,
                input_tag="0:v",
                ass_path=ass_path,
                watermark_path=watermark_path if has_watermark else None,
                speed_multiplier=speed,
                contrast=contrast,
                saturation=saturation,
            )
            return graph_res["filter_complex"]

        l_type = layout.get("type", "facecam_top_gameplay_bottom")
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
            if src_size and tuple(src_size) != (CANVAS_SRC_W, CANVAS_SRC_H):
                # Face crop is in real source pixels; map it into the normalized 1920x1080 frame.
                k = min(CANVAS_SRC_W / src_size[0], CANVAS_SRC_H / src_size[1])
                ox = (CANVAS_SRC_W - src_size[0] * k) / 2
                oy = (CANVAS_SRC_H - src_size[1] * k) / 2
                cx, cy = int(cx * k + ox), int(cy * k + oy)
                cw, ch = int(cw * k) // 2 * 2, int(ch * k) // 2 * 2
            filters.append(
                f"[0:v]crop={cw}:{ch}:{cx}:{cy},scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2[tracked]"
            )
            last_v = "[tracked]"

        elif l_type == "single_crop_9_16" or l_type == "full_9_16":
            # Single custom 9:16 crop without facecam (fill completely without black bars)
            crop_res = build_crop_filter(template, 1920, 1080)
            bot = crop_res.get("bottom", {})
            bx, by, bw, bh = bot.get("x", 656), bot.get("y", 0), bot.get("w", 608), bot.get("h", 1080)
            filters.append(
                f"[0:v]crop={bw}:{bh}:{bx}:{by},scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920[single_crop]"
            )
            last_v = "[single_crop]"

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

        # Anti-shadowban color grading (speed is applied last, after captions — see below)
        filters.append(
            f"{last_v}eq=contrast={contrast}:saturation={saturation}[graded]"
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
            filters.append(f"{last_v}subtitles='{escaped_ass}'[subbed]")
            last_v = "[subbed]"

        # Speed change LAST: caption times are source times, so burning them after setpts
        # made captions drift progressively late (~1s by 50s at 1.02x).
        filters.append(f"{last_v}setpts=PTS/{speed}[vout]")

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
        censor_words: Optional[List[Dict[str, Any]]] = None,
        censor_cfg: Optional[Dict[str, Any]] = None,
        words_time_offset: Optional[float] = None,
        intermediate: bool = False,
    ) -> str:
        """
        Execute full FFmpeg render pipeline for vertical clip.

        ``intermediate=True`` encodes near-lossless (the auto-edit finishing pass re-encodes it).

        ``censor_words`` are word dicts annotated by ``profanity.annotate_words``; their
        timestamps are in the same time base as ``words_time_offset`` (defaults to
        ``start_time``, i.e. word times are source times).
        """
        out_p = Path(output_path)
        out_p.parent.mkdir(parents=True, exist_ok=True)

        duration = max(5.0, end_time - start_time)
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        wm_path = anti.get("watermark_path")
        has_wm = bool(wm_path and os.path.exists(wm_path))

        src_size = await probe_video_size(source_path)
        filter_complex = self.build_layout_filter(
            template=template,
            source_path=source_path,
            ass_path=ass_path,
            has_watermark=has_wm,
            watermark_path=wm_path,
            src_size=src_size,
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

        if src_size and src_size != (CANVAS_SRC_W, CANVAS_SRC_H):
            logger.info("Source is %dx%d; normalizing to %dx%d for layout math.", *src_size, CANVAS_SRC_W, CANVAS_SRC_H)
        filter_complex = normalize_source_input(filter_complex, src_size)

        offset = start_time if words_time_offset is None else words_time_offset
        censored_audio = await build_censored_audio(
            source_path, censor_words, censor_cfg, offset, duration, audio_filters
        )
        if censored_audio:
            logger.info("Censoring %d audio window(s): %s", len(censored_audio["windows"]), censored_audio["windows"])
            filter_complex = f"{filter_complex};{censored_audio['graph']}"

        # Base FFmpeg command
        cmd = ["ffmpeg", "-y", "-threads", "2"]

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
        ])
        if censored_audio:
            cmd.extend(censored_audio["extra_inputs"])
            cmd.extend(["-filter_complex", filter_complex, "-map", "[vout]", "-map", "[aout]"])
        else:
            cmd.extend([
                "-filter_complex", filter_complex,
                "-map", "[vout]",
                "-map", "0:a:0?",
                "-af", a_filter_str,
            ])

        # Encoding codec selection
        if self.use_vaapi:
            cmd.extend(["-c:v", "h264_vaapi", "-qp", "24"])
        else:
            # -preset veryfast with -threads 2 prevents maxing out 100% CPU on 2-vCPU instances
            if intermediate:
                cmd.extend(["-c:v", "libx264", "-preset", "veryfast", "-threads", "2", "-crf", "14"])
            else:
                cmd.extend(["-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-crf", "25", "-maxrate", "4M", "-bufsize", "8M"])

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
                    censor_words=censor_words,
                    censor_cfg=censor_cfg,
                    words_time_offset=words_time_offset,
                )
            raise RuntimeError(f"FFmpeg failed with exit code {process.returncode}: {err_msg[:400]}")

        # If teaser hook requested and available, prepend it
        if include_teaser and teaser_timestamp is not None and pacing.get("teaser_preroll", True):
            teaser_output = await self._prepend_teaser_hook(
                base_rendered_path=str(out_p),
                source_path=source_path,
                teaser_timestamp=teaser_timestamp,
                template=template,
                censor_words=censor_words,
                censor_cfg=censor_cfg,
                words_time_offset=offset + (teaser_timestamp - start_time),
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
        censor_words: Optional[List[Dict[str, Any]]] = None,
        censor_cfg: Optional[Dict[str, Any]] = None,
        words_time_offset: Optional[float] = None,
    ) -> str:
        """Extract a 1.5s teaser climax, apply flash transition, and concatenate before main clip."""
        teaser_tmp = Path(RENDER_DIR) / f"teaser_{os.path.basename(base_rendered_path)}"
        final_concat = Path(RENDER_DIR) / f"final_{os.path.basename(base_rendered_path)}"

        # Render 1.5s teaser in same vertical layout
        anti = template.get("anti_shadowban", {})
        speed = anti.get("speed_multiplier", 1.02)
        teaser_src_size = await probe_video_size(source_path)
        filter_complex = self.build_layout_filter(
            template=template,
            source_path=source_path,
            ass_path=None,
            has_watermark=False,
            src_size=teaser_src_size,
        )
        filter_complex = normalize_source_input(filter_complex, teaser_src_size)
        # Add white flash at the end of teaser (st=1.3 d=0.2)
        flash_filter = f"{filter_complex};[vout]fade=t=out:st=1.3:d=0.2:color=white[v_flashed]"

        teaser_audio = await build_censored_audio(
            source_path, censor_words, censor_cfg,
            teaser_timestamp if words_time_offset is None else words_time_offset,
            1.5, [],
        )
        if teaser_audio:
            flash_filter = f"{flash_filter};{teaser_audio['graph']}"
            audio_map = ["-map", "[aout]"]
        else:
            audio_map = ["-map", "0:a:0?"]

        cmd_teaser = [
            "ffmpeg", "-y", "-threads", "2",
            "-ss", f"{teaser_timestamp:.3f}",
            "-t", "1.500",
            "-i", str(source_path),
            *(teaser_audio["extra_inputs"] if teaser_audio else []),
            "-filter_complex", flash_filter,
            "-map", "[v_flashed]",
            *audio_map,
            "-c:v", "libx264", "-preset", "ultrafast", "-threads", "2", "-crf", "25",
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
        teaser_posix = Path(teaser_tmp).resolve().as_posix()
        base_posix = Path(base_rendered_path).resolve().as_posix()
        with open(concat_txt, "w", encoding="utf-8") as f:
            f.write(f"file '{teaser_posix}'\n")
            f.write(f"file '{base_posix}'\n")

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

