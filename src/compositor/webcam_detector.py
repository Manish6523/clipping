"""Webcam / Facecam Detection Engine for Stream Frames.

Provides lightweight, VPS-safe detection of streamer webcams on 16:9 stream frames:
1. Primary: YuNet ONNX (FaceDetectorYN in OpenCV) for fast local CPU detection (<15ms, 230KB model).
2. Secondary/Fallback: Gemini Flash-Lite Vision API for semantic livestream overlay detection.
3. Fallback logic: If no face/webcam is found, signals has_webcam=False for automatic 9:16 blurred background crop.
"""

import json
import logging
import os
from pathlib import Path
from typing import Any, Dict, Optional, Tuple

logger = logging.getLogger(__name__)

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False

YUNET_MODEL_PATH = Path(__file__).resolve().parent.parent.parent / "assets" / "models" / "face_detection_yunet_2023mar.onnx"


class WebcamDetector:
    """Detects streamer facecam overlays on 16:9 livestream frames."""

    def __init__(self):
        self.yunet_detector = None
        if HAS_OPENCV and YUNET_MODEL_PATH.exists():
            try:
                # YuNet detector initialized with dummy size, updated on each inference
                self.yunet_detector = cv2.FaceDetectorYN_create(
                    str(YUNET_MODEL_PATH),
                    "",
                    (320, 180),
                    score_threshold=0.55,
                    nms_threshold=0.3,
                    top_k=5,
                )
            except Exception as e:
                logger.warning("Could not initialize YuNet face detector: %s", e)
                self.yunet_detector = None

    def detect_local(self, image_bytes: bytes) -> Optional[Dict[str, Any]]:
        """Run fast local YuNet face detection on CPU."""
        if not HAS_OPENCV or self.yunet_detector is None:
            return None

        try:
            nparr = np.frombuffer(image_bytes, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return None

            img_h, img_w, _ = img.shape
            self.yunet_detector.setInputSize((img_w, img_h))
            _, faces = self.yunet_detector.detect(img)

            if faces is None or len(faces) == 0:
                return None

            # Sort faces by confidence score (column index 14)
            best_face = sorted(faces, key=lambda f: f[-1], reverse=True)[0]
            conf = float(best_face[-1])
            if conf < 0.55:
                return None

            fx, fy, fw, fh = best_face[0:4]

            # In the 9:16 layout, the Facecam Top slot is 1080w x 730h (~1.48:1 aspect ratio).
            # If the crop box is tall and narrow, it will stretch or zoom excessively and cut off the streamer's shoulders.
            dest_aspect_ratio = 1080.0 / 730.0  # ~1.48

            # Calculate proper vertical span covering head + shoulders
            # If the streamer sits anchored at the bottom (e.g. Speed, Jynxzi), extend down to the bottom
            head_top = max(0, fy - (fh * 0.9))
            if (fy + fh) > (img_h * 0.65):
                box_h = img_h - head_top
                box_y = head_top
            else:
                # Floating corner webcam (e.g. CaseOh, xQc)
                box_h = max(fh * 2.2, img_h * 0.22)
                box_y = max(0, fy - (fh * 0.6))

            # Derive width from destination aspect ratio so there is ZERO distortion
            box_w = min(img_w, box_h * dest_aspect_ratio * (img_h / img_w))
            face_cx = fx + (fw / 2.0)

            # Anchor intelligently based on corner position
            if face_cx < (img_w * 0.35):
                # Streamer is on the left
                box_x = max(0, face_cx - (box_w * 0.45))
                if box_x < (img_w * 0.08):
                    box_x = 0
            elif face_cx > (img_w * 0.65):
                # Streamer is on the right
                box_x = max(0, min(img_w - box_w, face_cx - (box_w * 0.55)))
                if box_x > (img_w - box_w - (img_w * 0.08)):
                    box_x = img_w - box_w
            else:
                box_x = max(0, min(img_w - box_w, face_cx - (box_w / 2.0)))

            norm_box = {
                "x": round(float(box_x) / img_w, 3),
                "y": round(float(box_y) / img_h, 3),
                "w": round(float(box_w) / img_w, 3),
                "h": round(float(box_h) / img_h, 3),
            }

            return {
                "has_webcam": True,
                "box": norm_box,
                "confidence": round(conf, 2),
                "method": "yunet_local",
                "description": f"Detected face with {int(conf * 100)}% confidence and framed webcam overlay",
            }
        except Exception as e:
            logger.warning("Local YuNet detection failed: %s", e)
            return None

    async def detect_gemini(self, image_bytes: bytes) -> Dict[str, Any]:
        """Fallback to Gemini Flash Vision for semantic overlay boundary detection."""
        try:
            from config.settings import GEMINI_API_KEY
            from google import genai
            from google.genai import types

            if not GEMINI_API_KEY:
                return {"has_webcam": False, "box": None, "confidence": 0.0, "description": "No Gemini API Key"}

            client = genai.Client(api_key=GEMINI_API_KEY)
            prompt = """Analyze this livestream video frame screenshot.
Is there a streamer facecam or webcam overlay present?
If yes: identify the bounding box of the streamer's webcam or facecam window in normalized coordinates (between 0.0 and 1.0) where:
- x: top-left x normalized (0.0 to 1.0)
- y: top-left y normalized (0.0 to 1.0)
- w: width normalized (0.0 to 1.0)
- h: height normalized (0.0 to 1.0)
Return JSON format:
{"has_webcam": true, "box": {"x": 0.0, "y": 0.0, "w": 0.35, "h": 0.35}, "confidence": 0.95, "description": "Streamer seated in webcam overlay"}

If there is NO webcam/facecam overlay (or if it's pure gameplay without any streamer camera), return:
{"has_webcam": false, "box": null, "confidence": 0.90, "description": "Full gameplay only, no webcam detected"}
Return ONLY valid JSON.
"""
            resp = client.models.generate_content(
                model="gemini-flash-lite-latest",
                contents=[
                    types.Part.from_bytes(data=image_bytes, mime_type="image/jpeg"),
                    prompt,
                ],
                config=types.GenerateContentConfig(response_mime_type="application/json"),
            )
            raw_text = resp.text.strip()
            data = json.loads(raw_text)
            data["method"] = "gemini_vision"
            return data
        except Exception as e:
            logger.warning("Gemini vision detection failed: %s", e)
            return {"has_webcam": False, "box": None, "confidence": 0.0, "error": str(e)}

    async def detect(self, image_bytes: bytes) -> Dict[str, Any]:
        """Unified detector: tries fast local CPU first, falls back to Gemini Vision."""
        # 1. Try local CPU YuNet detector (<15ms)
        local_result = self.detect_local(image_bytes)
        if local_result and local_result.get("has_webcam"):
            return local_result

        # 2. Try Gemini Vision fallback
        gemini_result = await self.detect_gemini(image_bytes)
        if gemini_result and gemini_result.get("has_webcam"):
            return gemini_result

        # 3. Definite No Webcam
        return {
            "has_webcam": False,
            "box": None,
            "confidence": 0.90,
            "method": "fallback",
            "description": "No streamer facecam or webcam overlay detected in frame",
        }

