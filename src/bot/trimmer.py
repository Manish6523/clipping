"""Fast trimming and re-rendering engine for interactive Telegram controls."""

import json
import logging
from pathlib import Path
from typing import Any, Dict, Optional

from config.settings import TEMPLATES_DIR, RENDER_DIR
from src.database import (
    get_clip,
    update_clip_trim,
    toggle_clip_teaser,
    update_clip_rendered_path,
)
from src.compositor.ass_generator import generate_ass_subtitles
from src.compositor.ffmpeg_renderer import FFmpegRenderer

logger = logging.getLogger(__name__)


def load_template(template_name: str) -> Dict[str, Any]:
    """Load JSON template configuration with safe fallbacks."""
    t_path = Path(TEMPLATES_DIR) / f"{template_name}.json"
    if not t_path.exists():
        # Look for any available json template in directory
        available = list(Path(TEMPLATES_DIR).glob("*.json"))
        if available:
            t_path = available[0]
            logger.warning("Template '%s' not found, falling back to '%s'", template_name, t_path.stem)
        else:
            raise FileNotFoundError(f"No templates found in {TEMPLATES_DIR}")
    with open(t_path, "r", encoding="utf-8") as f:
        return json.load(f)


class ClipTrimmer:
    """Handles fast re-rendering when users trim timestamps or toggle teaser hook in Telegram."""

    def __init__(self):
        self.renderer = FFmpegRenderer()

    async def trim_and_rerender(
        self,
        clip_id: int,
        delta_start: float = 0.0,
        delta_end: float = 0.0,
        toggle_teaser: bool = False,
        custom_template: Optional[Dict[str, Any]] = None,
    ) -> Optional[Dict[str, Any]]:
        """
        Adjust boundaries or teaser status, re-render the vertical MP4, and update DB.
        """
        if toggle_teaser:
            clip = await toggle_clip_teaser(clip_id)
        else:
            clip = await update_clip_trim(clip_id, delta_start, delta_end)

        if not clip:
            logger.error("Clip ID %d not found for trimming.", clip_id)
            return None

        source_video = clip.get("source_video_path")
        if not source_video or not Path(source_video).exists():
            logger.error("Source video missing for clip %d: %s", clip_id, source_video)
            return None

        template_name = clip.get("template_name", "ishowspeed_gaming")
        template = custom_template if custom_template else load_template(template_name)

        start_time = clip["adjusted_start"]
        end_time = clip["adjusted_end"]
        duration = max(5.0, end_time - start_time)
        has_teaser = bool(clip.get("has_teaser", 1))
        teaser_ts = clip.get("teaser_hook_timestamp")

        out_video_name = f"clip_{clip_id}_trimmed_{int(start_time)}_{int(end_time)}.mp4"
        out_video_path = str(Path(RENDER_DIR) / out_video_name)
        out_ass_path = str(Path(RENDER_DIR) / f"sub_{clip_id}_{int(start_time)}_{int(end_time)}.ass")

        # Re-generate subtitles for the adjusted segment
        subtitle_data = []
        if clip.get("subtitle_path") and Path(clip["subtitle_path"]).exists():
            # If word timestamps cache exists, reuse; else generate basic kinetic subs
            sub_cache_path = Path(clip["subtitle_path"]).with_suffix(".json")
            if sub_cache_path.exists():
                try:
                    with open(sub_cache_path, "r", encoding="utf-8") as f:
                        subtitle_data = json.load(f)
                except Exception:
                    pass

        if subtitle_data:
            generate_ass_subtitles(
                word_timestamps=subtitle_data,
                output_path=out_ass_path,
                template_config=template,
                time_offset=start_time,
                max_duration=duration,
            )
        else:
            out_ass_path = None

        logger.info(
            "Re-rendering clip %d: [%.1fs - %.1fs] (Teaser: %s)",
            clip_id, start_time, end_time, has_teaser
        )

        # Render to unique temporary file for safe swap
        import uuid
        tmp_id = uuid.uuid4().hex[:8]
        temp_video_path = Path(RENDER_DIR) / f"render_tmp_{clip_id}_{tmp_id}.mp4"
        temp_thumb_path = Path(RENDER_DIR) / f"render_tmp_{clip_id}_{tmp_id}_thumb.jpg"

        rendered_mp4 = await self.renderer.render_clip(
            source_path=source_video,
            start_time=start_time,
            end_time=end_time,
            output_path=str(temp_video_path),
            template=template,
            ass_path=out_ass_path,
            teaser_timestamp=teaser_ts if has_teaser else None,
            include_teaser=has_teaser,
        )

        from src.compositor.render_swap import SafeRenderManager, compute_edl_hash
        edl_hash = compute_edl_hash(template)
        from src.web.ws_manager import ws_manager

        # Atomically validate, swap via os.replace, update DB transaction, and delete old render
        updated_clip = await SafeRenderManager.commit_render_swap(
            clip_id=clip_id,
            temp_video_path=Path(rendered_mp4),
            temp_thumb_path=temp_thumb_path if temp_thumb_path.exists() else None,
            edl_hash=edl_hash,
            broadcast_fn=ws_manager.broadcast,
        )
        return updated_clip

