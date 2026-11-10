"""Fast, deterministic feature extraction for webcam candidate verification.

Extracts:
1. Border evidence (gradient energy on perimeter vs inner/outer bands & random controls).
2. Interior/exterior discontinuity (HSV color histogram distance & sharpness difference).
3. Soft spatial priors (smooth corner/edge proximity bonus without hard position rejection).
4. Size plausibility checks.
"""

import cv2
import numpy as np
from typing import Dict, Any, Tuple, Optional
import src.compositor.detector_config as cfg


def compute_gradient_magnitude(gray: np.ndarray) -> np.ndarray:
    """Compute normalized Sobel gradient magnitude image."""
    grad_x = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    grad_y = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = cv2.magnitude(grad_x, grad_y)
    return mag


def analyze_border_evidence(
    grad_mag: np.ndarray,
    box_px: Tuple[int, int, int, int],
    frame_w: int,
    frame_h: int
) -> Tuple[float, int, float]:
    """
    Compare gradient energy on the perimeter vs 3-6px inside and outside.
    Returns:
        (border_score [0..1], straight_sides_count [0..4], energy_ratio)
    """
    bx, by, bw, bh = box_px
    band = cfg.BORDER_PROBE_BAND

    # Clamp bounds with margin for outer probe
    x1 = max(band + 1, bx)
    y1 = max(band + 1, by)
    x2 = min(frame_w - band - 2, bx + bw)
    y2 = min(frame_h - band - 2, by + bh)

    if x2 <= x1 + 10 or y2 <= y1 + 10:
        return 0.0, 0, 1.0

    # Perimeter sides (Top, Bottom, Left, Right)
    # A real border line has thickness (1-4px) and transitions on its inner and outer boundaries.
    # We sample the perimeter band [-3..+3] around each edge to find the peak perimeter gradient,
    # and compare against the outer collar [coord-10..coord-4] and inner collar [coord+4..coord+10].
    sides_contrast = []

    # 1. Top edge: around y1
    top_on = float(np.max([np.mean(grad_mag[y, x1:x2]) for y in range(max(0, y1 - 3), min(frame_h, y1 + 4))]))
    top_out = float(np.mean(grad_mag[max(0, y1 - 10):max(1, y1 - 4), x1:x2])) if y1 > 4 else 0.0
    top_in = float(np.mean(grad_mag[min(frame_h - 2, y1 + 4):min(frame_h, y1 + 10), x1:x2])) if y1 + 10 < frame_h else 0.0
    top_contrast = top_on / max(1.0, (top_out + top_in) / 2.0)
    sides_contrast.append(top_contrast)

    # 2. Bottom edge: around y2
    bot_on = float(np.max([np.mean(grad_mag[y, x1:x2]) for y in range(max(0, y2 - 3), min(frame_h, y2 + 4))]))
    bot_out = float(np.mean(grad_mag[min(frame_h - 2, y2 + 4):min(frame_h, y2 + 10), x1:x2])) if y2 + 10 < frame_h else 0.0
    bot_in = float(np.mean(grad_mag[max(0, y2 - 10):max(1, y2 - 4), x1:x2])) if y2 > 4 else 0.0
    bot_contrast = bot_on / max(1.0, (bot_out + bot_in) / 2.0)
    sides_contrast.append(bot_contrast)

    # 3. Left edge: around x1
    left_on = float(np.max([np.mean(grad_mag[y1:y2, x]) for x in range(max(0, x1 - 3), min(frame_w, x1 + 4))]))
    left_out = float(np.mean(grad_mag[y1:y2, max(0, x1 - 10):max(1, x1 - 4)])) if x1 > 4 else 0.0
    left_in = float(np.mean(grad_mag[y1:y2, min(frame_w - 2, x1 + 4):min(frame_w, x1 + 10)])) if x1 + 10 < frame_w else 0.0
    left_contrast = left_on / max(1.0, (left_out + left_in) / 2.0)
    sides_contrast.append(left_contrast)

    # 4. Right edge: around x2
    right_on = float(np.max([np.mean(grad_mag[y1:y2, x]) for x in range(max(0, x2 - 3), min(frame_w, x2 + 4))]))
    right_out = float(np.mean(grad_mag[y1:y2, min(frame_w - 2, x2 + 4):min(frame_w, x2 + 10)])) if x2 + 10 < frame_w else 0.0
    right_in = float(np.mean(grad_mag[y1:y2, max(0, x2 - 10):max(1, x2 - 4)])) if x2 > 4 else 0.0
    right_contrast = right_on / max(1.0, (right_out + right_in) / 2.0)
    sides_contrast.append(right_contrast)

    # Count sides with noticeable straight discontinuity (> 1.25x ratio)
    straight_sides = sum(1 for c in sides_contrast if c >= cfg.BORDER_ENERGY_RATIO_MIN)

    # Average energy on perimeter
    avg_perimeter_energy = np.mean([top_on, bot_on, left_on, right_on])

    # Sample random background control rectangle of identical size
    # Avoid overlapping the candidate box
    max_rx = max(band + 1, frame_w - bw - band - 1)
    max_ry = max(band + 1, frame_h - bh - band - 1)
    rand_x = np.random.randint(band + 1, max_rx) if max_rx > band + 2 else 0
    rand_y = np.random.randint(band + 1, max_ry) if max_ry > band + 2 else 0

    rand_top = np.mean(grad_mag[rand_y, rand_x:rand_x + bw]) if rand_y < frame_h else 0.0
    rand_bot = np.mean(grad_mag[min(frame_h - 1, rand_y + bh), rand_x:rand_x + bw])
    rand_left = np.mean(grad_mag[rand_y:rand_y + bh, rand_x]) if rand_x < frame_w else 0.0
    rand_right = np.mean(grad_mag[rand_y:rand_y + bh, min(frame_w - 1, rand_x + bw)])
    rand_perimeter_energy = (rand_top + rand_bot + rand_left + rand_right) / 4.0

    energy_ratio = float(avg_perimeter_energy / max(1.0, rand_perimeter_energy))

    # Normalize border score
    # High score requires >= 2 straight sides and energy_ratio >= 1.2
    side_score = min(1.0, straight_sides / 4.0)
    ratio_score = float(np.clip((energy_ratio - 1.0) / 1.5, 0.0, 1.0))
    border_score = round(0.6 * side_score + 0.4 * ratio_score, 3)

    return border_score, straight_sides, round(energy_ratio, 2)


def analyze_interior_exterior_discontinuity(
    hsv_img: np.ndarray,
    gray_img: np.ndarray,
    box_px: Tuple[int, int, int, int],
    frame_w: int,
    frame_h: int
) -> float:
    """
    Measure color distribution (Bhattacharyya distance) and sharpness difference
    between inside the candidate box and the surrounding collar.
    """
    bx, by, bw, bh = box_px
    collar = max(10, int(min(bw, bh) * 0.2))

    # Inner region
    x1, y1 = max(0, bx), max(0, by)
    x2, y2 = min(frame_w, bx + bw), min(frame_h, by + bh)
    if x2 <= x1 + 5 or y2 <= y1 + 5:
        return 0.0

    inner_hsv = hsv_img[y1:y2, x1:x2]
    inner_gray = gray_img[y1:y2, x1:x2]

    # Outer collar mask
    ox1, oy1 = max(0, bx - collar), max(0, by - collar)
    ox2, oy2 = min(frame_w, bx + bw + collar), min(frame_h, by + bh + collar)

    outer_hsv = hsv_img[oy1:oy2, ox1:ox2]
    outer_gray = gray_img[oy1:oy2, ox1:ox2]

    # Color histogram distance (Hue & Saturation, 2D hist)
    hist_inner = cv2.calcHist([inner_hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
    hist_outer = cv2.calcHist([outer_hsv], [0, 1], None, [16, 16], [0, 180, 0, 256])
    cv2.normalize(hist_inner, hist_inner, 0, 1, cv2.NORM_MINMAX)
    cv2.normalize(hist_outer, hist_outer, 0, 1, cv2.NORM_MINMAX)

    # Bhattacharyya distance: 0 = identical, 1 = completely different
    bhat_dist = cv2.compareHist(hist_inner, hist_outer, cv2.HISTCMP_BHATTACHARYYA)
    if np.isnan(bhat_dist):
        bhat_dist = 0.0

    # Sharpness / Noise variance ratio (Laplacian variance)
    var_inner = cv2.Laplacian(inner_gray, cv2.CV_64F).var()
    var_outer = cv2.Laplacian(outer_gray, cv2.CV_64F).var()
    sharpness_diff = abs(var_inner - var_outer) / max(10.0, var_inner + var_outer)

    # Combined discontinuity score [0..1]
    discontinuity = float(np.clip(0.7 * bhat_dist + 0.3 * sharpness_diff, 0.0, 1.0))
    return round(discontinuity, 3)


def compute_soft_corner_prior(face_cx: float, face_cy: float) -> float:
    """
    Compute soft spatial prior [0..1].
    Corners get small bonus (+0.20), edges get mild (+0.10), dead center gets 0.0.
    NEVER hard-rejects by position.
    """
    # Normalized coordinates [0..1]
    # Distances to 4 corners: (0,0), (1,0), (0,1), (1,1)
    d_tl = np.hypot(face_cx, face_cy)
    d_tr = np.hypot(1.0 - face_cx, face_cy)
    d_bl = np.hypot(face_cx, 1.0 - face_cy)
    d_br = np.hypot(1.0 - face_cx, 1.0 - face_cy)
    min_corner_dist = min(d_tl, d_tr, d_bl, d_br)

    # If within corner zone (distance < 0.45)
    if min_corner_dist < cfg.CORNER_NORM_DIST_MAX:
        # Scale smoothly from 1.0 at corner to 0.4 at edge of corner zone
        return round(float(1.0 - 0.6 * (min_corner_dist / cfg.CORNER_NORM_DIST_MAX)), 3)

    # Edge proximity (distance to nearest outer border)
    min_edge_dist = min(face_cx, 1.0 - face_cx, face_cy, 1.0 - face_cy)
    if min_edge_dist < 0.15:
        return 0.55  # Mild edge bonus

    # Center zone (penalty)
    return 0.15


def compute_size_plausibility(face_w_norm: float, frame_w_norm: float = 1.0) -> float:
    """
    Verify face width fits standard PiP overlay expectations (2% to 25% of frame).
    """
    if cfg.FACE_WIDTH_MIN <= face_w_norm <= cfg.FACE_WIDTH_MAX:
        # Ideal overlay size range: 4% to 18% gets full 1.0
        if 0.04 <= face_w_norm <= 0.18:
            return 1.0
        return 0.75
    elif face_w_norm < cfg.FACE_WIDTH_MIN:
        # Tiny background face/noise
        return 0.20
    else:
        # Very large face covering > 28% of frame -> likely full-screen camera
        return 0.10
