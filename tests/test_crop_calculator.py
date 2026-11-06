import asyncio
import unittest
from src.compositor.crop_calculator import build_crop_filter, calculate_crop_box


class TestCropCalculator(unittest.TestCase):
    def test_normalized_crop_math(self):
        # Facecam at bottom-left: 0% x, 58% y, 32% w, 42% h
        template = {
            "layout": {
                "type": "facecam_top_gameplay_bottom",
                "top_crop": {
                    "normalized_x": 0.0,
                    "normalized_y": 0.58,
                    "normalized_w": 0.32,
                    "normalized_h": 0.42,
                    "target_h": 730
                },
                "bottom_crop": {
                    "normalized_x": 0.20,
                    "normalized_y": 0.0,
                    "normalized_w": 0.60,
                    "normalized_h": 1.0,
                    "target_h": 1190
                }
            }
        }
        res = build_crop_filter(template, 1920, 1080)
        # Expected top crop: x=0, y=round(0.58*1080)=626, w=round(0.32*1920)=614, h=round(0.42*1080)=454
        self.assertEqual(res["top"]["x"], 0)
        self.assertEqual(res["top"]["y"], 626)
        self.assertEqual(res["top"]["w"], 614)
        self.assertEqual(res["top"]["h"], 454)
        self.assertIn("crop=614:454:0:626", res["top"]["crop_filter"])

    def test_even_dimension_clamping(self):
        # Odd dimensions must be rounded to even numbers for YUV420p
        x, y, w, h = calculate_crop_box({"source_x": 5, "source_y": 7, "source_w": 333, "source_h": 555}, 1920, 1080)
        self.assertEqual(x % 2, 0)
        self.assertEqual(y % 2, 0)
        self.assertEqual(w % 2, 0)
        self.assertEqual(h % 2, 0)


if __name__ == "__main__":
    unittest.main()

