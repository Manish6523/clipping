"""
Shared Layout Geometry Engine (Python Twin).
Calculates pixel-precise rectangles and scaling parameters for layers across source and canvas dimensions.
Guarantees identical behavior between Python FFmpeg generator and JavaScript HTML5 Canvas renderer.
"""

from typing import Dict, Any, Tuple


def to_even(val: float, allow_zero: bool = True) -> int:
    """Round a float to the nearest even integer (required for FFmpeg yuv420p)."""
    rounded = int(round(val))
    if rounded % 2 != 0:
        rounded += 1 if val >= rounded else -1
    if allow_zero:
        return max(0, rounded)
    return max(2, rounded)


def clamp(val: float, min_val: float, max_val: float) -> float:
    return max(min_val, min(max_val, val))


def calculate_layer_geometry(
    layer: Dict[str, Any],
    src_w: int,
    src_h: int,
    canvas_w: int = 1080,
    canvas_h: int = 1920,
) -> Dict[str, Any]:
    """
    Computes exact pixel rectangles for a schema v2 layer:
    1. src_crop: {x, y, w, h} on the raw video source.
    2. dst_rect: {x, y, w, h} on the output 9:16 canvas.
    3. scale_size: {w, h} intermediate scaled dimensions according to fit mode.
    4. inner_crop or letterbox_offset for positioning inside dst_rect.
    """
    src = layer.get("src", {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    dst = layer.get("dst", {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0})
    fit = layer.get("fit", "cover").lower()

    # 1. Source Crop (clamped to 0..1 and normalized to source dimensions)
    sx_norm = clamp(src.get("x", 0.0), 0.0, 1.0)
    sy_norm = clamp(src.get("y", 0.0), 0.0, 1.0)
    sw_norm = clamp(src.get("w", 1.0), 0.02, 1.0 - sx_norm)
    sh_norm = clamp(src.get("h", 1.0), 0.02, 1.0 - sy_norm)

    crop_x = to_even(sx_norm * src_w, allow_zero=True)
    crop_y = to_even(sy_norm * src_h, allow_zero=True)
    crop_w = to_even(sw_norm * src_w, allow_zero=False)
    crop_h = to_even(sh_norm * src_h, allow_zero=False)

    # Ensure crop does not exceed source boundary
    if crop_x + crop_w > src_w:
        crop_w = to_even(src_w - crop_x, allow_zero=False)
    if crop_y + crop_h > src_h:
        crop_h = to_even(src_h - crop_y, allow_zero=False)

    # 2. Destination Placement Rect on Canvas
    dx_norm = clamp(dst.get("x", 0.0), 0.0, 1.0)
    dy_norm = clamp(dst.get("y", 0.0), 0.0, 1.0)
    dw_norm = clamp(dst.get("w", 1.0), 0.02, 1.0 - dx_norm)
    dh_norm = clamp(dst.get("h", 1.0), 0.02, 1.0 - dy_norm)

    dst_x = to_even(dx_norm * canvas_w, allow_zero=True)
    dst_y = to_even(dy_norm * canvas_h, allow_zero=True)
    dst_w = to_even(dw_norm * canvas_w, allow_zero=False)
    dst_h = to_even(dh_norm * canvas_h, allow_zero=False)

    if dst_x + dst_w > canvas_w:
        dst_w = to_even(canvas_w - dst_x, allow_zero=False)
    if dst_y + dst_h > canvas_h:
        dst_h = to_even(canvas_h - dst_y, allow_zero=False)

    # 3. Fit calculation
    crop_aspect = (crop_w / crop_h) if crop_h > 0 else 1.0
    dst_aspect = (dst_w / dst_h) if dst_h > 0 else 1.0

    res = {
        "src_crop": {"x": crop_x, "y": crop_y, "w": crop_w, "h": crop_h},
        "dst_rect": {"x": dst_x, "y": dst_y, "w": dst_w, "h": dst_h},
        "fit": fit,
    }

    if fit == "stretch":
        res["scale_size"] = {"w": dst_w, "h": dst_h}

    elif fit == "contain":
        # Scale to fit entirely inside dst_w x dst_h with letterboxing
        if crop_aspect > dst_aspect:
            scale_w = dst_w
            scale_h = to_even(dst_w / crop_aspect)
        else:
            scale_h = dst_h
            scale_w = to_even(dst_h * crop_aspect)

        off_x = to_even((dst_w - scale_w) / 2)
        off_y = to_even((dst_h - scale_h) / 2)

        res["scale_size"] = {"w": scale_w, "h": scale_h}
        res["letterbox_offset"] = {"dx": off_x, "dy": off_y}

    else:  # cover (default)
        # Scale to completely fill dst_w x dst_h, cropping overflow
        if crop_aspect > dst_aspect:
            scale_h = dst_h
            scale_w = to_even(dst_h * crop_aspect)
        else:
            scale_w = dst_w
            scale_h = to_even(dst_w / crop_aspect)

        inner_x = to_even((scale_w - dst_w) / 2)
        inner_y = to_even((scale_h - dst_h) / 2)

        res["scale_size"] = {"w": scale_w, "h": scale_h}
        res["inner_crop"] = {"x": inner_x, "y": inner_y, "w": dst_w, "h": dst_h}

    return res
