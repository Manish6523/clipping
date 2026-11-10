"""Production Webcam Detection & Scene Classification Engine.

Implements:
1. Scene classification: overlay_cam, fullscreen_cam, game_only, multi_cam, no_face, unknown.
2. Overlay score per face candidate using border energy, color/texture discontinuity, soft priors.
3. Strict rule: person box is returned ONLY when overlay_score >= OVERLAY_MIN (0.60).
   Otherwise returns person: null and populates in_scene_faces with rejection reasons.
4. Deterministic layout recommendations (stack, single_follow, single_content_crop, single_blur_backdrop).
5. Adaptive person slot math for square, 16:9, and extreme aspect ratio cameras.
6. Borderless green-screen cutout margin calculations with validation.
7. Multi-image temporal stability and scene_switch detection.
8. Optional Gemini Flash-Lite check when overlay_score is in uncertain band [0.35, 0.65].
"""

import json
import logging
import os
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import numpy as np

import src.compositor.detector_config as cfg
from src.compositor.overlay_evidence import (
    compute_gradient_magnitude,
    analyze_border_evidence,
    analyze_interior_exterior_discontinuity,
    compute_soft_corner_prior,
    compute_size_plausibility,
)
from src.compositor.layout_engine import (
    determine_layout_recommendation,
    calculate_adaptive_slot,
)

logger = logging.getLogger(__name__)

YUNET_MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "models" / "face_detection_yunet_2023mar.onnx"


class WebcamDetector:
    """Classifies video frames and detects webcam overlays with false-positive suppression."""

    def __init__(self):
        self.yunet = None
        if YUNET_MODEL_PATH.exists():
            try:
                self.yunet = cv2.FaceDetectorYN_create(
                    str(YUNET_MODEL_PATH),
                    "",
                    (320, 180),
                    score_threshold=0.50,
                    nms_threshold=0.3,
                    top_k=8,
                )
            except Exception as e:
                logger.warning("Could not initialize YuNet face detector: %s", e)
                self.yunet = None

    def _detect_faces_raw(self, img: np.ndarray) -> List[Dict[str, Any]]:
        """Run YuNet on image and return list of detected faces."""
        if self.yunet is None:
            return []

        h, w, _ = img.shape
        self.yunet.setInputSize((w, h))
        _, faces = self.yunet.detect(img)
        if faces is None or len(faces) == 0:
            return []

        results = []
        for f in faces:
            box = f[0:4]
            conf = float(f[-1])
            results.append({
                "x_px": float(box[0]),
                "y_px": float(box[1]),
                "w_px": float(box[2]),
                "h_px": float(box[3]),
                "x": round(float(box[0]) / w, 3),
                "y": round(float(box[1]) / h, 3),
                "w": round(float(box[2]) / w, 3),
                "h": round(float(box[3]) / h, 3),
                "confidence": round(conf, 3),
            })
        return sorted(results, key=lambda x: x["confidence"], reverse=True)

    def _estimate_webcam_box(
        self,
        face: Dict[str, Any],
        img_w: int,
        img_h: int,
        gray_img: Optional[np.ndarray] = None,
        grad_mag: Optional[np.ndarray] = None
    ) -> Tuple[int, int, int, int]:
        """
        Estimate candidate webcam crop box around face:
        1. First checks for real rectangular window border contours enclosing the face (xQc, CaseOh, etc.).
        2. If no border contour found, falls back to calibrated face-unit margins (cutout style).
        3. If near border, adds 3% padding to avoid clipping headphones/hats.
        """
        fx = face["x_px"]
        fy = face["y_px"]
        fw = face["w_px"]
        fh = face["h_px"]

        # 1. Search for real webcam window border rectangle around face
        if gray_img is not None:
            pad = int(max(fw, fh) * 2.2)
            sx1 = max(0, int(fx - pad))
            sy1 = max(0, int(fy - pad))
            sx2 = min(img_w, int(fx + fw + pad))
            sy2 = min(img_h, int(fy + fh + pad))

            sub = gray_img[sy1:sy2, sx1:sx2]
            edges = cv2.Canny(sub, 40, 120)
            contours, _ = cv2.findContours(edges, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

            if grad_mag is None:
                grad_mag = compute_gradient_magnitude(gray_img)

            best_rect = None
            best_score = -1.0
            # Test candidate contours that enclose the face
            for c in contours:
                rx, ry, rw, rh = cv2.boundingRect(c)
                gx, gy = sx1 + rx, sy1 + ry
                # Must enclose face
                if gx <= fx and gy <= fy and (gx + rw) >= (fx + fw) and (gy + rh) >= (fy + fh):
                    aspect = rw / max(1, rh)
                    if 0.7 <= aspect <= 2.4:
                        # Prefer contours with strong perimeter border discontinuity
                        c_score, sides, _ = analyze_border_evidence(
                            grad_mag, (gx, gy, rw, rh), img_w, img_h
                        )
                        # We weight sides count and border score heavily over raw bounding area
                        quality = c_score + (sides * 0.25)
                        if quality > best_score:
                            best_score = quality
                            best_rect = (gx, gy, rw, rh)

            if best_rect and best_score >= 0.5:
                bx, by, bw, bh = best_rect
                # Add 3% padding if face is within 2% of edge
                if (fx - bx) < (bw * 0.02) or ((bx + bw) - (fx + fw)) < (bw * 0.02):
                    bx = max(0, int(bx - bw * cfg.BORDER_PADDING_PERCENT))
                    bw = min(img_w - bx, int(bw * (1.0 + cfg.BORDER_PADDING_PERCENT * 2)))
                if (fy - by) < (bh * 0.02):
                    by = max(0, int(by - bh * cfg.BORDER_PADDING_PERCENT))
                    bh = min(img_h - by, int(bh * (1.0 + cfg.BORDER_PADDING_PERCENT * 2)))
                return (bx, by, bw, bh)

        # 2. Borderless cutout style margins in face units
        ml = fw * cfg.CUTOUT_MARGIN_LEFT
        mr = fw * cfg.CUTOUT_MARGIN_RIGHT
        mt = fh * cfg.CUTOUT_MARGIN_TOP
        mb = fh * cfg.CUTOUT_MARGIN_BOTTOM

        # Check if seated near bottom border
        if (fy + fh) > (img_h * 0.65):
            mb = img_h - (fy + fh)

        bx = max(0, int(fx - ml))
        by = max(0, int(fy - mt))
        bw = min(img_w - bx, int(fw + ml + mr))
        bh = min(img_h - by, int(fh + mt + mb))

        # Check for edge padding
        if (fx - bx) < (bw * 0.02):
            bx = max(0, int(bx - bw * cfg.BORDER_PADDING_PERCENT))
            bw = min(img_w - bx, int(bw * (1.0 + cfg.BORDER_PADDING_PERCENT)))

        return (bx, by, bw, bh)

    def _score_face_candidate(
        self,
        face: Dict[str, Any],
        img: np.ndarray,
        grad_mag: np.ndarray,
        hsv_img: np.ndarray,
        gray_img: np.ndarray,
        temporal_stability: Optional[float] = None
    ) -> Dict[str, Any]:
        """
        Compute overlay evidence and overlay_score for a single face candidate.
        """
        img_h, img_w, _ = img.shape
        cand_box_px = self._estimate_webcam_box(face, img_w, img_h, gray_img=gray_img, grad_mag=grad_mag)

        # 1. Border Evidence
        border_score, straight_sides, energy_ratio = analyze_border_evidence(
            grad_mag, cand_box_px, img_w, img_h
        )

        # 2. Interior / Exterior Discontinuity
        interior_exterior_dist = analyze_interior_exterior_discontinuity(
            hsv_img, gray_img, cand_box_px, img_w, img_h
        )

        # 3. Soft Spatial Prior (Corners/Edges vs Center)
        face_cx = face["x"] + (face["w"] / 2.0)
        face_cy = face["y"] + (face["h"] / 2.0)
        corner_prior = compute_soft_corner_prior(face_cx, face_cy)

        # 4. Size Plausibility
        size_plausible = compute_size_plausibility(face["w"])

        # 5. Temporal stability (if provided from multi-frame sequence)
        temp_score = temporal_stability if temporal_stability is not None else 0.50

        # Weighted combination
        overlay_score = (
            cfg.WEIGHT_BORDER_EVIDENCE * border_score +
            cfg.WEIGHT_INTERIOR_EXTERIOR * interior_exterior_dist +
            cfg.WEIGHT_CORNER_PRIOR * corner_prior +
            cfg.WEIGHT_SIZE_PLAUSIBILITY * size_plausible +
            cfg.WEIGHT_TEMPORAL_STABILITY * temp_score
        )
        overlay_score = round(float(np.clip(overlay_score, 0.0, 1.0)), 3)

        # Format normalized box
        norm_box = {
            "x": round(cand_box_px[0] / img_w, 3),
            "y": round(cand_box_px[1] / img_h, 3),
            "w": round(cand_box_px[2] / img_w, 3),
            "h": round(cand_box_px[3] / img_h, 3),
        }

        evidence = {
            "border_sides": straight_sides,
            "border_contrast": round(energy_ratio, 2),
            "interior_exterior_distance": interior_exterior_dist,
            "corner_prior": corner_prior,
            "size_plausible": size_plausible,
            "temporal_stability": temporal_stability,
        }

        # Determine rejection reason if not an overlay
        rejection_reason = None
        if overlay_score < cfg.OVERLAY_MIN:
            if straight_sides < cfg.BORDER_MIN_STRAIGHT_SIDES and interior_exterior_dist < 0.35:
                rejection_reason = "No border or color discontinuity found (in-scene face)"
            elif corner_prior < 0.25 and size_plausible > 0.5:
                rejection_reason = "Inside center gameplay area without overlay boundaries"
            elif face["w"] > cfg.FULLSCREEN_FACE_WIDTH_MIN:
                rejection_reason = "Full-frame camera (dominant face covering scene)"
            else:
                rejection_reason = f"Low overlay confidence ({int(overlay_score*100)}% < {int(cfg.OVERLAY_MIN*100)}%)"

        return {
            "face": face,
            "box": norm_box,
            "box_px": cand_box_px,
            "overlay_score": overlay_score,
            "evidence": evidence,
            "rejection_reason": rejection_reason,
        }

    async def _query_gemini_uncertain(self, image_bytes: bytes) -> Optional[Dict[str, Any]]:
        """Call Gemini Flash-Lite only when candidate is in the uncertain band [0.35, 0.65]."""
        if not cfg.ENABLE_GEMINI_FALLBACK:
            return None

        try:
            from config.settings import GEMINI_API_KEY
            from google import genai
            from google.genai import types

            if not GEMINI_API_KEY:
                return None

            client = genai.Client(api_key=GEMINI_API_KEY)
            prompt = """Analyze this livestream video frame screenshot.
Is this scene:
1. "game" with a separate streamer webcam overlay box?
2. "irl_fullscreen" (a camera feed of a room, bedroom, or person with NO separate webcam overlay)?
3. "just_chatting" (fullscreen camera with side chat)?
4. "game_only" (only video game, no streamer camera at all)?

Return JSON:
{
  "scene_type": "game" | "irl_fullscreen" | "just_chatting" | "game_only" | "other",
  "has_separate_webcam_overlay": true | false,
  "overlay_box": {"x": 0.0, "y": 0.0, "w": 0.3, "h": 0.3} | null,
  "confidence": 0.95
}
Do NOT identify persons by name. Return ONLY valid JSON."""

            resp = client.models.generate_content(
                model="gemini-flash-lite-latest",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            data = json.loads(resp.text.strip())
            return data
        except Exception as e:
            logger.warning("Gemini uncertain check failed: %s", e)
            return None

    def process_image(
        self,
        img: np.ndarray,
        temporal_stability: Optional[float] = None,
        image_bytes: Optional[bytes] = None
    ) -> Dict[str, Any]:
        """
        Process single frame synchronously:
        Classifies scene, scores candidates, suppresses false positives, recommends layout.
        """
        t0 = time.perf_counter()
        img_h, img_w, _ = img.shape

        # Precompute gradient and color representations once
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        grad_mag = compute_gradient_magnitude(gray)

        # Detect faces with YuNet
        faces = self._detect_faces_raw(img)

        # Initial scene classification based on face presence
        if len(faces) == 0:
            elapsed = round((time.perf_counter() - t0) * 1000, 1)
            rec = determine_layout_recommendation(cfg.SCENE_NO_FACE, [], None, img_w, img_h)
            return {
                "scene_class": cfg.SCENE_NO_FACE,
                "has_webcam": False,
                "person": None,
                "box": None,
                "confidence": 0.95,
                "overlay_score": 0.0,
                "overlay_evidence": None,
                "in_scene_faces": [],
                "layout_recommendation": rec,
                "person_slot_ratio": rec.get("person_slot_ratio", 0.0),
                "uncertain": False,
                "elapsed_ms": elapsed,
            }

        # Score all candidate faces
        scored_candidates = []
        for f in faces:
            scored = self._score_face_candidate(
                f, img, grad_mag, hsv, gray, temporal_stability=temporal_stability
            )
            scored_candidates.append(scored)

        # Sort by overlay_score descending
        scored_candidates.sort(key=lambda c: c["overlay_score"], reverse=True)
        best = scored_candidates[0]

        # Scene Classification Logic:
        # Check if dominant face covers most of frame or is in-room camera
        is_fullscreen_cam = False
        dominant_face = best["face"]

        # If best face has low border evidence AND low interior/exterior distance AND sits in center/room
        if best["evidence"]["border_sides"] <= 1 and best["evidence"]["interior_exterior_distance"] < 0.28:
            is_fullscreen_cam = True

        # Check uncertain band [0.35, 0.65]
        is_uncertain = (cfg.UNCERTAIN_LOW <= best["overlay_score"] <= cfg.UNCERTAIN_HIGH)

        # Assign Scene Class
        if best["overlay_score"] >= cfg.OVERLAY_MIN and not is_fullscreen_cam:
            confirmed_overlays = [c for c in scored_candidates if c["overlay_score"] >= cfg.OVERLAY_MIN]
            if len(confirmed_overlays) > 1:
                scene_class = cfg.SCENE_MULTI_CAM
            else:
                scene_class = cfg.SCENE_OVERLAY_CAM
        elif is_fullscreen_cam:
            scene_class = cfg.SCENE_FULLSCREEN_CAM
        else:
            scene_class = cfg.SCENE_GAME_ONLY

        # Populate person box according to the strict rule:
        # DO NOT return a person box unless overlay_score >= OVERLAY_MIN (0.60)
        person_box = None
        has_webcam = False
        in_scene_faces = []

        if scene_class in (cfg.SCENE_OVERLAY_CAM, cfg.SCENE_MULTI_CAM) and best["overlay_score"] >= cfg.OVERLAY_MIN:
            person_box = best["box"]
            has_webcam = True
            for cand in scored_candidates[1:]:
                in_scene_faces.append({
                    "face": cand["face"],
                    "box": cand["box"],
                    "overlay_score": cand["overlay_score"],
                    "reason": cand["rejection_reason"] or "Lower scored face",
                })
        else:
            person_box = None
            has_webcam = False
            for cand in scored_candidates:
                in_scene_faces.append({
                    "face": cand["face"],
                    "box": cand["box"],
                    "overlay_score": cand["overlay_score"],
                    "reason": cand["rejection_reason"] or "Classified as in-scene / fullscreen camera",
                })

        # Calculate adaptive slot and layout recommendation
        layout_rec = determine_layout_recommendation(
            scene_class, faces, person_box, img_w, img_h
        )

        elapsed = round((time.perf_counter() - t0) * 1000, 1)

        return {
            "scene_class": scene_class,
            "has_webcam": has_webcam,
            "person": person_box,
            "box": person_box,  # Backward compatibility
            "confidence": best["overlay_score"] if has_webcam else (1.0 - best["overlay_score"]),
            "overlay_score": best["overlay_score"],
            "overlay_evidence": best["evidence"],
            "in_scene_faces": in_scene_faces,
            "layout_recommendation": layout_rec,
            "person_slot_ratio": layout_rec.get("person_slot_ratio", 0.0),
            "uncertain": is_uncertain,
            "elapsed_ms": elapsed,
        }

    async def detect(self, image_bytes: bytes) -> Dict[str, Any]:
        """
        Unified detection entry point with optional Gemini uncertain-band check.
        """
        nparr = np.frombuffer(image_bytes, np.uint8)
        img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        if img is None:
            return {"error": "Invalid image data", "scene_class": cfg.SCENE_UNKNOWN, "has_webcam": False}

        result = self.process_image(img, image_bytes=image_bytes)

        # If uncertain and Gemini is enabled, verify with Gemini Flash-Lite
        if result.get("uncertain") and cfg.ENABLE_GEMINI_FALLBACK:
            gemini_check = await self._query_gemini_uncertain(image_bytes)
            if gemini_check:
                result["gemini_verification"] = gemini_check
                st = gemini_check.get("scene_type", "")
                has_sep = gemini_check.get("has_separate_webcam_overlay", False)

                if not has_sep or st in ("irl_fullscreen", "just_chatting", "game_only"):
                    result["scene_class"] = cfg.SCENE_FULLSCREEN_CAM if "irl" in st or "chatting" in st else cfg.SCENE_GAME_ONLY
                    result["has_webcam"] = False
                    result["person"] = None
                    result["box"] = None
                    result["uncertain"] = False
                    result["layout_recommendation"] = determine_layout_recommendation(
                        result["scene_class"], [], None, img.shape[1], img.shape[0]
                    )

        return result

    def detect_multi_image(self, images: List[np.ndarray]) -> Dict[str, Any]:
        """
        Multi-image/clip sequence mode:
        Measures face center stability and persistent perimeter edges across frames.
        Reports per_image results, majority_class, and scene_switch flag.
        """
        if not images:
            return {"error": "No images provided"}

        per_image_results = []
        face_centers = []

        for img in images:
            faces = self._detect_faces_raw(img)
            if faces:
                primary = faces[0]
                face_centers.append((primary["x"], primary["y"]))
            else:
                face_centers.append(None)

        valid_centers = [c for c in face_centers if c is not None]
        temporal_stability = 0.5
        if len(valid_centers) >= 2:
            xs = [c[0] for c in valid_centers]
            ys = [c[1] for c in valid_centers]
            var_pos = np.var(xs) + np.var(ys)
            temporal_stability = float(np.clip(1.0 - (var_pos / 0.02), 0.1, 1.0))

        classes = []
        for img in images:
            res = self.process_image(img, temporal_stability=temporal_stability)
            per_image_results.append(res)
            classes.append(res["scene_class"])

        from collections import Counter
        class_counts = Counter(classes)
        majority_class = class_counts.most_common(1)[0][0]
        scene_switch = len(set(classes)) > 1

        return {
            "majority_class": majority_class,
            "scene_switch": scene_switch,
            "temporal_stability": round(temporal_stability, 3),
            "per_image": per_image_results,
        }
