"""Deterministic layout recommendation and adaptive person slot math for 9:16 vertical shorts.

Canvas target: 1080 x 1920 (9:16).
Adaptive person slot:
    person_slot_h = clamp(1080 / cam_aspect, 0.25*1920, 0.45*1920)
    content_slot_h = 1920 - person_slot_h
"""

from typing import Dict, Any, Tuple, Optional
import src.compositor.detector_config as cfg


def calculate_adaptive_slot(cam_box: Dict[str, float], frame_w: int = 1920, frame_h: int = 1080) -> Dict[str, Any]:
    """
    Calculate adaptive height and layout for 9:16 destination canvas based on webcam aspect ratio.
    Square cams get taller slot; 16:9 wide cams get shorter slot.
    """
    # cam_box has normalized x, y, w, h
    bw_px = max(10, cam_box["w"] * frame_w)
    bh_px = max(10, cam_box["h"] * frame_h)
    cam_aspect = bw_px / bh_px

    canvas_w = cfg.CANVAS_WIDTH   # 1080
    canvas_h = cfg.CANVAS_HEIGHT  # 1920

    # Calculate person slot height clamped to [25% (480px), 45% (864px)]
    raw_slot_h = canvas_w / max(0.5, cam_aspect)
    person_slot_h = int(max(cfg.SLOT_H_MIN, min(cfg.SLOT_H_MAX, raw_slot_h)))
    content_slot_h = canvas_h - person_slot_h

    # Extreme aspect ratio check (very tall/narrow cam < 0.8 or very wide > 2.4)
    fit_mode = "cover"
    if cam_aspect < 0.8 or cam_aspect > 2.4:
        fit_mode = "contain_blur"

    person_slot_ratio = round(person_slot_h / float(canvas_h), 3)

    return {
        "person_slot_h": person_slot_h,
        "content_slot_h": content_slot_h,
        "person_slot_ratio": person_slot_ratio,
        "cam_aspect": round(cam_aspect, 3),
        "fit_mode": fit_mode,
        "layers_v2": [
            {
                "id": "person_cam",
                "name": "Streamer Camera",
                "type": "video",
                "src": cam_box,
                "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": person_slot_ratio},
                "fit": fit_mode,
                "z_index": 2,
            },
            {
                "id": "content_game",
                "name": "Game Content",
                "type": "video",
                "src": {"x": 0.15, "y": 0.0, "w": 0.70, "h": 1.0},
                "dst": {"x": 0.0, "y": person_slot_ratio, "w": 1.0, "h": round(1.0 - person_slot_ratio, 3)},
                "fit": "cover",
                "z_index": 1,
            }
        ]
    }


def determine_layout_recommendation(
    scene_class: str,
    faces: list,
    cam_box: Optional[Dict[str, float]],
    frame_w: int = 1920,
    frame_h: int = 1080
) -> Dict[str, Any]:
    """
    Produce deterministic layout recommendation:
    - overlay_cam -> stack (person slot + content slot)
    - fullscreen_cam -> single_follow (if face fits 9:16 crop window) else single_blur_backdrop
    - game_only / no_face / unknown -> single_content_crop or single_blur_backdrop
    Never produces a split showing the same region twice!
    """
    if scene_class == cfg.SCENE_OVERLAY_CAM and cam_box:
        slot_data = calculate_adaptive_slot(cam_box, frame_w, frame_h)
        return {
            "mode": "stack",
            "reason": f"Webcam overlay confirmed (aspect {slot_data['cam_aspect']}:1). Stack layout with adaptive {int(slot_data['person_slot_ratio']*100)}% person slot.",
            "person_slot_ratio": slot_data["person_slot_ratio"],
            "person_slot_h": slot_data["person_slot_h"],
            "content_slot_h": slot_data["content_slot_h"],
            "fit_mode": slot_data["fit_mode"],
            "layers_v2": slot_data["layers_v2"],
        }

    if scene_class == cfg.SCENE_FULLSCREEN_CAM:
        # Check if the dominant face fits nicely inside a 9:16 crop window of the 16:9 frame
        # 9:16 window on 16:9 frame has width: (1080 / 1920) * (9/16) * 1920 ...
        # normalized width of 9:16 on 16:9: (9/16) * (1080/1920) = 0.3164 of frame width
        target_crop_w_norm = 0.3164

        if faces and len(faces) > 0:
            primary_face = faces[0]
            fx_norm = primary_face.get("x", 0.5)
            fw_norm = primary_face.get("w", 0.1)
            face_cx = fx_norm + (fw_norm / 2.0)

            # Center 9:16 window on face
            crop_x = max(0.0, min(1.0 - target_crop_w_norm, face_cx - (target_crop_w_norm / 2.0)))
            return {
                "mode": "single_follow",
                "reason": "Full-frame camera stream detected (IRL / Just Chatting). Following speaker in single 9:16 crop without splitting.",
                "crop_window": {"x": round(crop_x, 3), "y": 0.0, "w": round(target_crop_w_norm, 3), "h": 1.0},
                "person_slot_ratio": 1.0,
            }

        return {
            "mode": "single_blur_backdrop",
            "reason": "Full-frame camera with wide scene. Using centered 16:9 presentation with blurred backdrop fill.",
            "person_slot_ratio": 1.0,
        }

    if scene_class in (cfg.SCENE_GAME_ONLY, cfg.SCENE_NO_FACE, cfg.SCENE_UNKNOWN):
        return {
            "mode": "single_content_crop",
            "reason": f"Scene classified as '{scene_class}' without streamer overlay. Preserving gameplay in centered vertical crop.",
            "crop_window": {"x": 0.20, "y": 0.0, "w": 0.60, "h": 1.0},
            "person_slot_ratio": 0.0,
        }

    # Default fallback
    return {
        "mode": "single_blur_backdrop",
        "reason": f"Default fallback for scene class '{scene_class}'.",
        "person_slot_ratio": 0.0,
    }
