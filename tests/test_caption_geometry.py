import unittest
from src.compositor.caption_geometry import caption_geometry, get_quick_placement_pos

class TestCaptionGeometry(TestCase := unittest.TestCase):
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

