import unittest
from pathlib import Path
from src.compositor.ass_generator import generate_ass_subtitles, hex_to_ass_color

class TestAssGenerator(unittest.TestCase):
    def test_hex_conversion(self):
        # White #FFFFFF -> &H00FFFFFF
        self.assertEqual(hex_to_ass_color("#FFFFFF"), "&H00FFFFFF")
        # Yellow #FACC15 -> &H0015CCFA (BBGGRR)
        self.assertEqual(hex_to_ass_color("#FACC15"), "&H0015CCFA")

    def test_ass_file_generation(self):
        words = [
            {"word": "HELLO", "start": 1.0, "end": 1.4},
            {"word": "WORLD", "start": 1.4, "end": 1.8},
        ]
        out_path = Path("tmp/test_sub.ass")
        tpl = {
            "subtitles": {
                "font": "Arial",
                "size": 60,
                "position": {"x": 0.5, "y": 0.8, "max_width": 0.85}
            }
        }
        res = generate_ass_subtitles(words, out_path, tpl, time_offset=0.0)
        self.assertTrue(res.exists())
        content = res.read_text(encoding="utf-8")
        self.assertIn("PlayResX: 1080", content)
        self.assertIn("PlayResY: 1920", content)
        self.assertIn("\\an5\\pos(540,1536)", content)
        if res.exists():
            res.unlink()

if __name__ == "__main__":
    unittest.main()

