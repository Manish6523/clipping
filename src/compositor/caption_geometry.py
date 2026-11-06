"""Single source of truth for subtitle coordinates and geometry across Frontend & Backend.

Coordinates:
- Normalized space: x in [0.0, 1.0], y in [0.0, 1.0]
- PlayResX = 1080, PlayResY = 1920 (Standard 9:16 Canvas)
- Alignment = 5 (Center-Center anchor in ASS)

Formulas:
- canvas_x = round(normalized_x * 1080)
- canvas_y = round(normalized_y * 1920)
- max_pixel_width = round(normalized_max_w * 1080)
"""

from typing import Any, Dict, List, Tuple


# Quick placement preset anchors (normalized x, y)
QUICK_PLACEMENTS: Dict[str, Dict[str, float]] = {
    "top": {"x": 0.5, "y": 0.15},
    "upper_third": {"x": 0.5, "y": 0.33},
    "middle": {"x": 0.5, "y": 0.50},
    "lower_third": {"x": 0.5, "y": 0.67},
    "bottom": {"x": 0.5, "y": 0.82},
    "on_seam": {"x": 0.5, "y": 0.38}, # Seam between 38% top and 62% bottom
}


def caption_geometry(
    pos_x: float = 0.5,
    pos_y: float = 0.76,
    max_w: float = 0.85,
    canvas_w: int = 1080,
    canvas_h: int = 1920,
) -> Dict[str, int]:
    """
    Calculate exact pixel positions, margins, and clipping bounds for rendering.
    
    Returns:
    - x: int (ASS \\pos X coordinate)
    - y: int (ASS \\pos Y coordinate)
    - max_width: int (maximum bounding box width in pixels)
    - margin_left: int
    - margin_right: int
    - clip_x1, clip_y1, clip_x2, clip_y2: bounding rectangle
    """
    # Clamp inputs
    px = max(0.0, min(1.0, float(pos_x)))
    py = max(0.0, min(1.0, float(pos_y)))
    pw = max(0.2, min(1.0, float(max_w)))

    center_x = round(px * canvas_w)
    center_y = round(py * canvas_h)
    max_px_width = round(pw * canvas_w)

    half_w = max_px_width // 2
    x1 = max(0, center_x - half_w)
    x2 = min(canvas_w, center_x + half_w)

    margin_l = x1
    margin_r = canvas_w - x2

    return {
        "x": center_x,
        "y": center_y,
        "max_width": max_px_width,
        "margin_l": margin_l,
        "margin_r": margin_r,
        "clip_x1": x1,
        "clip_y1": max(0, center_y - 200),
        "clip_x2": x2,
        "clip_y2": min(canvas_h, center_y + 200),
    }


def get_quick_placement_pos(placement_key: str, seam_ratio: float = 0.38) -> Dict[str, float]:
    """Return normalized (x, y) for quick placement button."""
    if placement_key == "on_seam":
        return {"x": 0.5, "y": seam_ratio}
    return QUICK_PLACEMENTS.get(placement_key, {"x": 0.5, "y": 0.76})

