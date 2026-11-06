"""Centralized Crop Filter Calculator.

Single source of truth for normalized and pixel-based FFmpeg crop calculations
across Template Studio preview, clip rendering, and testing.
"""

from typing import Any, Dict, Tuple


def clamp_and_even(val: float | int, max_val: int) -> int:
    """Clamp integer to [0, max_val] and round down to even integer for FFmpeg compatibility."""
    rounded = int(round(val))
    clamped = max(0, min(rounded, max_val))
    # FFmpeg crop requires even dimensions for YUV420p
    return clamped - (clamped % 2)


def calculate_crop_box(
    crop_def: Dict[str, Any],
    src_w: int = 1920,
    src_h: int = 1080
) -> Tuple[int, int, int, int]:
    """
    Extract (x, y, w, h) in pixels from either normalized fractions (0.0 - 1.0)
    or standard absolute pixel values.

    Returns:
        (x, y, w, h) clamped and rounded to even integers.
    """
    # Check normalized first: x, y, w, h (0.0 to 1.0)
    if "normalized_x" in crop_def:
        nx = float(crop_def["normalized_x"])
        ny = float(crop_def["normalized_y"])
        nw = float(crop_def["normalized_w"])
        nh = float(crop_def["normalized_h"])
        x = round(nx * src_w)
        y = round(ny * src_h)
        w = round(nw * src_w)
        h = round(nh * src_h)
    else:
        # Check source_x, source_y, source_w, source_h
        raw_x = float(crop_def.get("source_x", 0))
        raw_y = float(crop_def.get("source_y", 0))
        raw_w = float(crop_def.get("source_w", src_w))
        raw_h = float(crop_def.get("source_h", src_h))

        # Check if values are passed as 0.0-1.0 floats in source_*
        if raw_w <= 1.0 and raw_h <= 1.0 and (raw_x > 0 or raw_y > 0 or raw_w > 0):
            x = round(raw_x * src_w)
            y = round(raw_y * src_h)
            w = round(raw_w * src_w)
            h = round(raw_h * src_h)
        else:
            x = round(raw_x)
            y = round(raw_y)
            w = round(raw_w)
            h = round(raw_h)

    # Ensure w and h don't exceed source bounds
    w = max(2, min(w, src_w))
    h = max(2, min(h, src_h))

    # Clamp x and y so box stays fully inside source frame
    if x + w > src_w:
        x = src_w - w
    if y + h > src_h:
        y = src_h - h

    even_x = clamp_and_even(x, src_w - 2)
    even_y = clamp_and_even(y, src_h - 2)
    even_w = clamp_and_even(w, src_w - even_x)
    even_h = clamp_and_even(h, src_h - even_y)

    return even_x, even_y, even_w, even_h


def build_crop_filter(
    template: Dict[str, Any],
    src_w: int = 1920,
    src_h: int = 1080
) -> Dict[str, Any]:
    """
    Build structured crop commands and FFmpeg filter strings for a given template layout.
    
    Supports:
      - facecam_top_gameplay_bottom
      - split_screen_50_50
      - dynamic_face_track
      - blurred_bg_center
    """
    layout = template.get("layout", {})
    l_type = layout.get("type", "facecam_top_gameplay_bottom")

    # Support either template format (top_crop/bottom_crop) or editor EDL format (regions.person/regions.content)
    regions = layout.get("regions", {})
    if "person" in regions or "content" in regions:
        top_def = regions.get("person", {})
        bot_def = regions.get("content", {})
    else:
        top_def = layout.get("top_crop", {})
        bot_def = layout.get("bottom_crop", {})

    # Support normalized x,y,w,h directly
    if "x" in top_def and "normalized_x" not in top_def:
        top_def["normalized_x"] = top_def["x"]
        top_def["normalized_y"] = top_def["y"]
        top_def["normalized_w"] = top_def["w"]
        top_def["normalized_h"] = top_def["h"]

    if "x" in bot_def and "normalized_x" not in bot_def:
        bot_def["normalized_x"] = bot_def["x"]
        bot_def["normalized_y"] = bot_def["y"]
        bot_def["normalized_w"] = bot_def["w"]
        bot_def["normalized_h"] = bot_def["h"]

    tx, ty, tw, th = calculate_crop_box(top_def, src_w, src_h)
    bx, by, bw, bh = calculate_crop_box(bot_def, src_w, src_h)

    # Determine vertical target partition (defaults 730 top / 1190 bottom or 960/960)
    target_top_h = top_def.get("target_h", 730 if l_type == "facecam_top_gameplay_bottom" else 960)
    target_bot_h = bot_def.get("target_h", 1190 if l_type == "facecam_top_gameplay_bottom" else 960)

    top_crop_str = f"crop={tw}:{th}:{tx}:{ty}"
    bot_crop_str = f"crop={bw}:{bh}:{bx}:{by}"

    return {
        "layout_type": l_type,
        "src_width": src_w,
        "src_height": src_h,
        "top": {
            "x": tx, "y": ty, "w": tw, "h": th,
            "target_w": 1080, "target_h": target_top_h,
            "crop_filter": top_crop_str,
            "scale_filter": f"{top_crop_str},scale=1080:{target_top_h}:force_original_aspect_ratio=decrease,pad=1080:{target_top_h}:(ow-iw)/2:(oh-ih)/2",
        },
        "bottom": {
            "x": bx, "y": by, "w": bw, "h": bh,
            "target_w": 1080, "target_h": target_bot_h,
            "crop_filter": bot_crop_str,
            "scale_filter": f"{bot_crop_str},scale=1080:{target_bot_h}:force_original_aspect_ratio=decrease,pad=1080:{target_bot_h}:(ow-iw)/2:(oh-ih)/2",
        }
    }

