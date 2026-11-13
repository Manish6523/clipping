"""
FFmpeg Filter Graph Builder for Schema v2 Multi-Layer Layouts.
Constructs complex filtergraphs:
1. Base background: solid color, blurred source, or blurred layer crop.
2. Visible layers in z-order: crop -> scale (cover/contain/stretch) -> mirror -> shape mask/border -> overlay at dst.
3. Audio pacing/normalization and Subtitle burning (ASS).
"""

from src.compositor.caption_styles import fonts_dir_arg
import os
from typing import Dict, Any, List, Optional
from src.compositor.layout_math import calculate_layer_geometry, to_even
from src.compositor.template_migration import migrate_layout_to_v2


def build_filter_graph(
    layout_data: Dict[str, Any],
    src_w: int = 1920,
    src_h: int = 1080,
    input_tag: str = "0:v",
    ass_path: Optional[str] = None,
    watermark_path: Optional[str] = None,
    speed_multiplier: float = 1.0,
    contrast: float = 1.0,
    saturation: float = 1.0,
) -> Dict[str, Any]:
    """
    Builds the complete FFmpeg filter_complex string for a Schema v2 layout.
    Returns:
      {
        "filter_complex": str,
        "output_tag": "[vout]",
        "layer_geometries": [...]
      }
    """
    # Normalize to schema 2 if legacy structure provided
    v2_layout = migrate_layout_to_v2({"layout": layout_data}) if layout_data.get("schema") != 2 else layout_data

    canvas = v2_layout.get("canvas", {"w": 1080, "h": 1920})
    canvas_w = canvas.get("w", 1080)
    canvas_h = canvas.get("h", 1920)

    bg_cfg = v2_layout.get("background", {"type": "solid", "color": "#000000"})
    bg_type = bg_cfg.get("type", "solid")

    layers = [l for l in v2_layout.get("layers", []) if l.get("visible", True)]

    filters: List[str] = []
    layer_geos = []

    # 1. Base Canvas / Background Pipeline
    if bg_type == "blur":
        blur_rad = int(bg_cfg.get("blur", 40))
        dim = float(bg_cfg.get("dim", 0.35))
        # Scale source to fill canvas and apply boxblur + brightness dimming
        filters.append(
            f"[{input_tag}]scale={canvas_w}:{canvas_h}:force_original_aspect_ratio=increase,"
            f"crop={canvas_w}:{canvas_h},boxblur={blur_rad}:5,eq=brightness=-{dim:.2f}[base_bg]"
        )
        current_base = "[base_bg]"
    else:
        # Solid color base canvas
        bg_color = bg_cfg.get("color", "#000000").replace("#", "0x")
        filters.append(f"color=c={bg_color}:s={canvas_w}x{canvas_h}[base_bg]")
        current_base = "[base_bg]"

    # 2. Iterate each visible layer in z-order (array order = bottom to top)
    for idx, layer in enumerate(layers):
        geo = calculate_layer_geometry(layer, src_w, src_h, canvas_w, canvas_h)
        layer_geos.append({"id": layer.get("id", f"l_{idx}"), "geo": geo})

        src_c = geo["src_crop"]
        dst_r = geo["dst_rect"]
        scale_sz = geo["scale_size"]
        fit = geo["fit"]

        style = layer.get("style", {})
        mirror = style.get("mirror", False)
        radius = float(style.get("radius", 0.0))
        shape = style.get("shape", "rect")
        border = style.get("border", {})
        border_w = int(border.get("w", 0))
        border_col = border.get("color", "#FFFFFF").replace("#", "0x")
        opacity = float(style.get("opacity", 1.0))

        # Crop from source video
        pipe_steps = [f"crop={src_c['w']}:{src_c['h']}:{src_c['x']}:{src_c['y']}"]

        # Scale according to fit mode
        pipe_steps.append(f"scale={scale_sz['w']}:{scale_sz['h']}")

        # Cover fit inner crop (if scale exceeds destination)
        if fit == "cover" and "inner_crop" in geo:
            ic = geo["inner_crop"]
            pipe_steps.append(f"crop={ic['w']}:{ic['h']}:{ic['x']}:{ic['y']}")

        # Mirror (horizontal flip)
        if mirror:
            pipe_steps.append("hflip")

        # Opacity adjustment
        if opacity < 0.999:
            pipe_steps.append(f"format=rgba,colorchannelmixer=aa={opacity:.2f}")

        # Border overlay via drawbox if requested
        if border_w > 0:
            pipe_steps.append(f"drawbox=x=0:y=0:w=iw:h=ih:color={border_col}:t={border_w}")

        layer_tag = f"[l_{idx}_proc]"
        filters.append(f"[{input_tag}]{','.join(pipe_steps)}{layer_tag}")

        # Position on canvas
        overlay_x = dst_r["x"]
        overlay_y = dst_r["y"]

        if fit == "contain" and "letterbox_offset" in geo:
            lo = geo["letterbox_offset"]
            overlay_x += lo["dx"]
            overlay_y += lo["dy"]

        next_base = f"[comp_{idx}]"
        filters.append(
            f"{current_base}{layer_tag}overlay={overlay_x}:{overlay_y}:shortest=1{next_base}"
        )
        current_base = next_base

    # 3. Color Grading (anti-shadowban). The speed change is applied LAST, after captions are
    # burned: caption times are in source time, so burning after setpts made them drift late.
    graded_tag = "[graded]"
    filters.append(
        f"{current_base}eq=contrast={contrast:.2f}:saturation={saturation:.2f}{graded_tag}"
    )
    last_v = graded_tag

    # 4. Optional Watermark
    if watermark_path and os.path.exists(watermark_path):
        escaped_wm = watermark_path.replace("\\", "/").replace(":", "\\:")
        filters.append(f"movie='{escaped_wm}'[wm];{last_v}[wm]overlay=W-w-30:40[with_wm]")
        last_v = "[with_wm]"

    # 5. Burn Subtitles (ASS)
    if ass_path and os.path.exists(ass_path):
        escaped_ass = ass_path.replace("\\", "/").replace(":", "\\:")
        filters.append(f"{last_v}subtitles='{escaped_ass}'{fonts_dir_arg()}[subbed]")
        last_v = "[subbed]"

    # 6. Anti-shadowban speed change (audio gets the matching atempo)
    filters.append(f"{last_v}setpts=PTS/{speed_multiplier:.4f}[vout]")

    return {
        "filter_complex": ";".join(filters),
        "output_tag": "[vout]",
        "layer_geometries": layer_geos,
    }

