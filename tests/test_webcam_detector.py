"""Unit test suite for webcam detection, border scoring, adaptive slots, and regression."""

import unittest
import numpy as np
import cv2
from pathlib import Path

from src.compositor.detector_config import (
    SCENE_OVERLAY_CAM,
    SCENE_FULLSCREEN_CAM,
    SCENE_GAME_ONLY,
    SCENE_NO_FACE,
    OVERLAY_MIN,
)
from src.compositor.overlay_evidence import (
    compute_gradient_magnitude,
    analyze_border_evidence,
    compute_soft_corner_prior,
    compute_size_plausibility,
)
from src.compositor.layout_engine import calculate_adaptive_slot, determine_layout_recommendation
from src.compositor.webcam_detector import WebcamDetector


class TestWebcamDetectorSuite(unittest.TestCase):

    def setUp(self):
        self.detector = WebcamDetector()

    def test_border_evidence_drawn_rect_vs_plain(self):
        """Border evidence on drawn rectangle with high contrast perimeter vs plain image."""
        w, h = 640, 360
        # Image with high contrast rectangle border
        bordered_img = np.zeros((h, w), dtype=np.uint8)
        bx, by, bw, bh = 40, 40, 160, 120
        cv2.rectangle(bordered_img, (bx, by), (bx + bw, by + bh), 255, 3)
        grad_mag_bordered = compute_gradient_magnitude(bordered_img)
        score_border, sides_border, ratio_border = analyze_border_evidence(
            grad_mag_bordered, (bx, by, bw, bh), w, h
        )

        # Plain image with no border
        plain_img = np.full((h, w), 128, dtype=np.uint8)
        grad_mag_plain = compute_gradient_magnitude(plain_img)
        score_plain, sides_plain, ratio_plain = analyze_border_evidence(
            grad_mag_plain, (bx, by, bw, bh), w, h
        )

        self.assertGreater(score_border, score_plain)
        self.assertGreaterEqual(sides_border, 2)

    def test_soft_corner_prior(self):
        """Corner locations receive bonus; center locations receive lower score without hard reject."""
        corner_score = compute_soft_corner_prior(0.08, 0.08)
        center_score = compute_soft_corner_prior(0.50, 0.50)
        self.assertGreater(corner_score, center_score)
        self.assertGreater(center_score, 0.0)  # Never hard-zero / reject

    def test_adaptive_slot_math(self):
        """Square webcam receives taller slot; wide 16:9 webcam receives shorter slot."""
        # Square cam (aspect 1:1)
        sq_box = {"x": 0.05, "y": 0.05, "w": 0.20, "h": 0.355} # ~1:1 in 16:9 frame
        sq_slot = calculate_adaptive_slot(sq_box, 1920, 1080)

        # Wide cam (aspect 16:9)
        wide_box = {"x": 0.05, "y": 0.05, "w": 0.355, "h": 0.20} # ~16:9 in 16:9 frame
        wide_slot = calculate_adaptive_slot(wide_box, 1920, 1080)

        self.assertGreater(sq_slot["person_slot_h"], wide_slot["person_slot_h"])
        # Both must remain within [25% (480), 45% (864)] bounds
        self.assertGreaterEqual(sq_slot["person_slot_h"], 480)
        self.assertLessEqual(sq_slot["person_slot_h"], 864)

    def test_permanent_regression_sleeping_bed(self):
        """Kai Cenat sleeping on a bed must NOT be classified as an overlay and person must be None."""
        sleep_path = r"C:\Users\krish\.gemini\antigravity\brain\0eb2895a-5227-44a3-8191-614718622948\.user_uploaded\media_1794305906951_d74a36d3.jpg"
        if Path(sleep_path).exists():
            img = cv2.imread(sleep_path)
            res = self.detector.process_image(img)
            self.assertFalse(res["has_webcam"])
            self.assertIsNone(res["person"])
            self.assertNotEqual(res["layout_recommendation"]["mode"], "stack")

    def test_deterministic_layout_recommendation(self):
        """Layout engine returns non-split fallbacks for non-overlay classes."""
        rec_game = determine_layout_recommendation(SCENE_GAME_ONLY, [], None)
        self.assertEqual(rec_game["mode"], "single_content_crop")

        rec_fullscreen = determine_layout_recommendation(SCENE_FULLSCREEN_CAM, [], None)
        self.assertIn(rec_fullscreen["mode"], ["single_follow", "single_blur_backdrop"])


if __name__ == "__main__":
    unittest.main()
