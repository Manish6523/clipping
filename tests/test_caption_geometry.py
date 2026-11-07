import json
import unittest
from pathlib import Path
from src.compositor.caption_geometry import caption_geometry, get_quick_placement_pos

class TestCaptionGeometry(unittest.TestCase):
    def test_golden_vectors(self):
        vectors_path = Path(__file__).resolve().parent.parent / "shared" / "caption_vectors.json"
        with open(vectors_path, "r", encoding="utf-8") as f:
            data = json.load(f)

        for tc in data["test_cases"]:
            res = caption_geometry(
                pos_x=tc["input"]["pos_x"],
                pos_y=tc["input"]["pos_y"],
                max_w=tc["input"]["max_w"],
                canvas_w=tc["input"]["canvas_w"],
                canvas_h=tc["input"]["canvas_h"],
            )
            for k, expected_val in tc["expected"].items():
                self.assertEqual(res[k], expected_val, f"Mismatch in {tc['name']} for key {k}")

    def test_default_position(self):
        geom = caption_geometry(0.5, 0.5, 0.8, 1080, 1920)
        self.assertEqual(geom["x"], 540)
        self.assertEqual(geom["y"], 960)
        self.assertEqual(geom["max_width"], 864)

    def test_seam_position(self):
        pos = get_quick_placement_pos("on_seam", seam_ratio=0.38)
        geom = caption_geometry(pos["x"], pos["y"], 0.85, 1080, 1920)
        self.assertEqual(geom["x"], 540)
        self.assertEqual(geom["y"], round(0.38 * 1920))

    def test_clamping(self):
        geom = caption_geometry(-0.2, 1.5, 2.0, 1080, 1920)
        self.assertEqual(geom["x"], 0)
        self.assertEqual(geom["y"], 1920)
        self.assertEqual(geom["max_width"], 1080)

if __name__ == "__main__":
    unittest.main()
