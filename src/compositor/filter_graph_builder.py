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
    watermark_config: Optional[Dict[str, Any]] = None,
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
        dim_val = float(bg_cfg.get("dim", 0.35))
        # High-quality cinematic ambient Gaussian blur matching Template Studio & modern social apps:
        # Downscale -> Gaussian blur (gblur) -> Bicubic upscale back to canvas + slight dimming & saturation
        # This completely eliminates rectangular streaks/box artifacts and dissolves UI text into smooth glow.
        eq_filter = f"eq=brightness={-dim_val * 0.4:.3f}:saturation=1.2" if dim_val > 0 else "eq=saturation=1.2"
        filters.append(
            f"[{input_tag}]scale=270:480:force_original_aspect_ratio=increase,"
            f"crop=270:480,gblur=sigma=18:steps=2,"
            f"scale={canvas_w}:{canvas_h}:flags=bicubic,{eq_filter}[base_bg]"
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
    wm_config = watermark_config if isinstance(watermark_config, dict) else {}
    if not wm_config:
        raw_layout_wm = v2_layout.get("watermark")
        if isinstance(raw_layout_wm, dict):
            wm_config = raw_layout_wm
    wm_file = watermark_path or wm_config.get("watermark_path")
    if wm_file and os.path.exists(wm_file):
        escaped_wm = wm_file.replace("\\", "/").replace(":", "\\:")
        pos = (wm_config.get("watermark_position") or "top_right").lower()
        opacity = float(wm_config.get("watermark_opacity", 0.85))
        scale_w = int(wm_config.get("watermark_width", 220))

        # Overlay positioning calculations
        if pos == "top_left":
            overlay_expr = "40:50"
        elif pos == "top_center":
            overlay_expr = "(W-w)/2:50"
        elif pos == "bottom_left":
            overlay_expr = "40:H-h-60"
        elif pos == "bottom_right":
            overlay_expr = "W-w-40:H-h-60"
        elif pos == "bottom_center":
            overlay_expr = "(W-w)/2:H-h-60"
        else: # top_right default
            overlay_expr = "W-w-40:50"

        # Apply scaling and opacity to watermark movie
        wm_filters = f"movie='{escaped_wm}',scale={scale_w}:-1"
        if opacity < 1.0:
            wm_filters += f",format=rgba,colorchannelmixer=aa={opacity:.2f}"
        filters.append(f"{wm_filters}[wm];{last_v}[wm]overlay={overlay_expr}[with_wm]")
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

