import unittest
import json
from pathlib import Path
from src.compositor.layout_math import calculate_layer_geometry


class TestLayoutMath(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        v_path = Path(__file__).resolve().parent.parent / "shared" / "layout_vectors.json"
        with open(v_path, "r", encoding="utf-8") as f:
            cls.vector_data = json.load(f)

    def test_golden_vectors(self):
        for v in self.vector_data["vectors"]:
            with self.subTest(name=v["name"]):
                actual = calculate_layer_geometry(
                    layer=v["layer"],
                    src_w=v["src_w"],
                    src_h=v["src_h"],
                    canvas_w=v["canvas"]["w"],
                    canvas_h=v["canvas"]["h"],
                )
                exp = v["expected"]
                self.assertEqual(actual["src_crop"], exp["src_crop"], f"{v['name']} src_crop mismatch")
                self.assertEqual(actual["dst_rect"], exp["dst_rect"], f"{v['name']} dst_rect mismatch")
                self.assertEqual(actual["scale_size"], exp["scale_size"], f"{v['name']} scale_size mismatch")

                if "inner_crop" in exp:
                    self.assertEqual(actual.get("inner_crop"), exp["inner_crop"], f"{v['name']} inner_crop mismatch")
                if "letterbox_offset" in exp:
                    self.assertEqual(actual.get("letterbox_offset"), exp["letterbox_offset"], f"{v['name']} letterbox_offset mismatch")


if __name__ == "__main__":
    unittest.main()

