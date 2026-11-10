"""Configuration constants and scoring weights for webcam detection and scene classification.

All weights, thresholds, and plausibility ranges are centralized here to allow
systematic evaluation and tuning without code modifications.
"""

from dataclasses import dataclass
from typing import Dict, Any

# ==============================================================================
# SCENE CLASSES
# ==============================================================================
SCENE_OVERLAY_CAM = "overlay_cam"       # Distinct Picture-in-Picture webcam overlay
SCENE_FULLSCREEN_CAM = "fullscreen_cam" # Full-frame camera (IRL / Just Chatting / Sleeping)
SCENE_GAME_ONLY = "game_only"           # Gameplay only (may have in-game character faces)
SCENE_MULTI_CAM = "multi_cam"           # Multiple distinct camera overlays
SCENE_NO_FACE = "no_face"               # No human or character faces found
SCENE_UNKNOWN = "unknown"               # Indeterminate

# ==============================================================================
# OVERLAY DECISION THRESHOLDS
# ==============================================================================
OVERLAY_MIN = 0.55          # Minimum overlay_score required to declare a person box
UNCERTAIN_LOW = 0.35        # Below this: definitely not an overlay
UNCERTAIN_HIGH = 0.55       # Above this: confident overlay; [0.35, 0.55] triggers optional Gemini check

# ==============================================================================
# OVERLAY SCORING WEIGHTS (Total sum = 1.0)
# ==============================================================================
WEIGHT_BORDER_EVIDENCE = 0.40       # Crisp edge/gradient discontinuity on box perimeter
WEIGHT_INTERIOR_EXTERIOR = 0.25     # Color histogram & texture/sharpness distance
WEIGHT_CORNER_PRIOR = 0.15          # Soft proximity bonus for frame corners & edges
WEIGHT_SIZE_PLAUSIBILITY = 0.10     # Plausible webcam face width ratio (2% - 25%)
WEIGHT_TEMPORAL_STABILITY = 0.10    # Position persistence across frames in video/multi-image

# ==============================================================================
# BORDER & GRADIENT MEASUREMENT SETTINGS
# ==============================================================================
BORDER_PROBE_BAND = 4               # Probe width in pixels (3-6 px) inside and outside candidate box
BORDER_MIN_STRAIGHT_SIDES = 2       # Must show clear straight gradient discontinuity on at least 2 sides
BORDER_ENERGY_RATIO_MIN = 1.25      # Perimeter gradient must be >= 1.25x background sample gradient

# ==============================================================================
# SPATIAL SOFT PRIORS
# ==============================================================================
# Corners get a soft bonus (+0.15), edges get mild (+0.08), center gets mild penalty (-0.10)
CORNER_NORM_DIST_MAX = 0.45         # Normalized distance from corner threshold

# ==============================================================================
# SIZE PLAUSIBILITY RANGES (Normalized to frame width/height)
# ==============================================================================
FACE_WIDTH_MIN = 0.02               # 2% of frame width
FACE_WIDTH_MAX = 0.28               # 28% of frame width for PiP webcam
FULLSCREEN_FACE_WIDTH_MIN = 0.25    # Faces >= 25% often indicate full-frame IRL / close-up camera

# ==============================================================================
# ADAPTIVE PERSON SLOT MATH (Destination: 1080 x 1920)
# ==============================================================================
CANVAS_WIDTH = 1080
CANVAS_HEIGHT = 1920
SLOT_H_MIN = int(0.25 * CANVAS_HEIGHT)  # 480 px (25%)
SLOT_H_MAX = int(0.45 * CANVAS_HEIGHT)  # 864 px (45%)

# ==============================================================================
# BORDERLESS GREEN-SCREEN CUTOUT MARGINS (in Face-Box Units)
# ==============================================================================
CUTOUT_MARGIN_LEFT = 1.0
CUTOUT_MARGIN_RIGHT = 1.0
CUTOUT_MARGIN_TOP = 1.3             # Extra room for hat, hair, headphones
CUTOUT_MARGIN_BOTTOM = 1.8          # Extra room for shoulders / chest
CUTOUT_FACE_CENTRAL_MIN = 0.20      # Face center must be between 20% and 80% of crop (central 60%)
CUTOUT_FACE_CENTRAL_MAX = 0.80
CUTOUT_FACE_H_RATIO_MIN = 0.12      # Face height must be 12% to 55% of crop height
CUTOUT_FACE_H_RATIO_MAX = 0.55

# ==============================================================================
# BORDER-ALIGNED PADDING
# ==============================================================================
BORDER_PADDING_PERCENT = 0.03       # 3% extra padding if face is within 2% of webcam edge

# ==============================================================================
# GEMINI UNCERTAINTY CALL TOGGLE
# ==============================================================================
ENABLE_GEMINI_FALLBACK = True       # Whether to call Gemini Flash-Lite in uncertain band [0.35, 0.65]
