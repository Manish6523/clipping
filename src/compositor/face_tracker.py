"""Face detection and active speaker tracking with spatial smoothing."""

import logging
from typing import List, Tuple, Optional

logger = logging.getLogger(__name__)

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:
    HAS_OPENCV = False


class FaceTracker:
    """Calculates smoothed 9:16 crop coordinates following the active speaker's face."""

    def __init__(self, smoothing_window: int = 30):
        self.smoothing_window = smoothing_window
        self.face_cascade = None
        if HAS_OPENCV:
            # Check if CascadeClassifier is available in this cv2 build
            cascade_cls = getattr(cv2, "CascadeClassifier", None)
            if cascade_cls and hasattr(cv2, "data") and hasattr(cv2.data, "haarcascades"):
                try:
                    cascade_path = cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
                    self.face_cascade = cascade_cls(cascade_path)
                except Exception:
                    self.face_cascade = None

    def analyze_video_crops(
        self,
        video_path: str,
        target_aspect_w: int = 9,
        target_aspect_h: int = 16,
        sample_step_frames: int = 2,
    ) -> List[Tuple[int, int, int, int]]:
        """
        Analyze video frames to produce smoothed (x, y, crop_w, crop_h) boxes.
        """
        if not HAS_OPENCV or self.face_cascade is None:
            return [(656, 0, 608, 1080)]

        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            return [(656, 0, 608, 1080)]

        frame_w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
        frame_h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))

        crop_h = frame_h
        crop_w = int(crop_h * (target_aspect_w / target_aspect_h))
        if crop_w > frame_w:
            crop_w = frame_w
            crop_h = int(crop_w * (target_aspect_h / target_aspect_w))

        raw_centers_x: List[float] = []
        default_center_x = frame_w / 2.0

        frame_idx = 0
        while True:
            ret, frame = cap.read()
            if not ret:
                break

            if frame_idx % sample_step_frames == 0:
                gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
                small_h, small_w = 360, int(360 * (frame_w / frame_h))
                small_gray = cv2.resize(gray, (small_w, small_h))
                scale_factor = frame_w / small_w

                faces = self.face_cascade.detectMultiScale(
                    small_gray,
                    scaleFactor=1.1,
                    minNeighbors=5,
                    minSize=(30, 30),
                )

                if len(faces) > 0:
                    largest_face = max(faces, key=lambda b: b[2] * b[3])
                    fx, fy, fw, fh = largest_face
                    center_x = (fx + fw / 2.0) * scale_factor
                    raw_centers_x.append(center_x)
                else:
                    last_val = raw_centers_x[-1] if raw_centers_x else default_center_x
                    raw_centers_x.append(last_val)

            frame_idx += 1

        cap.release()

        if not raw_centers_x:
            cx = int(frame_w / 2 - crop_w / 2)
            return [(max(0, cx), 0, crop_w, crop_h)]

        smoothed_centers: List[float] = []
        win = self.smoothing_window
        for i in range(len(raw_centers_x)):
            start_i = max(0, i - win // 2)
            end_i = min(len(raw_centers_x), i + win // 2 + 1)
            avg_x = sum(raw_centers_x[start_i:end_i]) / (end_i - start_i)
            smoothed_centers.append(avg_x)

        crop_boxes: List[Tuple[int, int, int, int]] = []
        half_crop_w = crop_w / 2.0
        for scx in smoothed_centers:
            x1 = int(scx - half_crop_w)
            x1 = max(0, min(frame_w - crop_w, x1))
            y1 = max(0, int((frame_h - crop_h) / 2))
            crop_boxes.append((x1, y1, crop_w, crop_h))

        return crop_boxes

    def get_static_average_crop(
        self,
        video_path: str,
        target_aspect_w: int = 9,
        target_aspect_h: int = 16,
    ) -> Tuple[int, int, int, int]:
        """Compute a single stable crop window based on average speaker position."""
        if not HAS_OPENCV or self.face_cascade is None:
            return (656, 0, 608, 1080)

        crops = self.analyze_video_crops(video_path, target_aspect_w, target_aspect_h, sample_step_frames=10)
        if not crops:
            return (656, 0, 608, 1080)

        avg_x = int(np.mean([b[0] for b in crops]))
        avg_y = int(np.mean([b[1] for b in crops]))
        w = crops[0][2]
        h = crops[0][3]
        return (avg_x, avg_y, w, h)
