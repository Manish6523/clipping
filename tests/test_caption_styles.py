"""Caption style presets: frontend/backend in sync, fonts bundled, ASS modes rendered."""

import re
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.compositor import caption_styles as cs  # noqa: E402
from src.compositor.ass_generator import generate_ass_subtitles  # noqa: E402

TEMPLATE = {"subtitles": {"font_name": "Montserrat ExtraBold", "font_size": 60, "position": {"x": 0.5, "y": 0.3, "max_width": 0.8}}}
WORDS = [{"word": w, "start": i * 0.5, "end": i * 0.5 + 0.45} for i, w in enumerate("bro he did not just".split())]


def test_frontend_ids_match_backend():
    js = (ROOT / "frontend" / "src" / "lib" / "captionStyles.js").read_text()
    ids = re.findall(r"\{ id: '([a-z_]+)'", js)
    assert ids[0] == cs.DEFAULT_STYLE
    assert ids[1:] == list(cs.STYLES)


@pytest.mark.skipif(not shutil.which("fc-scan"), reason="fontconfig not installed")
def test_every_style_font_is_bundled():
    names = set()
    for f in cs.FONTS_DIR.glob("*.ttf"):
        out = subprocess.run(["fc-scan", "--format", "%{family}|%{fullname}\n", str(f)], capture_output=True, text=True).stdout
        for part in out.replace("|", ",").split(","):
            names.add(part.strip())
    for sid, st in cs.STYLES.items():
        assert st["font_name"] in names, f"{sid}: font {st['font_name']!r} not in assets/fonts"


def test_apply_keeps_template_position_and_original():
    t = cs.apply_caption_style(TEMPLATE, "neon")
    assert t["subtitles"]["position"] == TEMPLATE["subtitles"]["position"]
    assert t["subtitles"]["font_name"] == "Russo One"
    assert TEMPLATE["subtitles"]["font_name"] == "Montserrat ExtraBold"      # not mutated
    assert cs.style_of(t) == "neon" and cs.style_of(TEMPLATE) is None
    assert cs.apply_caption_style(TEMPLATE, "template") is TEMPLATE
    assert cs.apply_caption_style(TEMPLATE, "nope") is TEMPLATE


@pytest.mark.parametrize("sid", list(cs.STYLES))
def test_each_style_generates_ass(tmp_path, sid):
    out = generate_ass_subtitles(WORDS, tmp_path / "a.ass", cs.apply_caption_style(TEMPLATE, sid))
    text = out.read_text()
    st = cs.STYLES[sid]
    assert f"Style: KineticCaption,{st['font_name']}," in text
    lines = [ln for ln in text.splitlines() if ln.startswith("Dialogue:")]
    text_lines = [ln for ln in lines if ln.startswith("Dialogue: 1,")]
    assert len(text_lines) == len(WORDS)
    if st["mode"] == "box":
        assert sum(",CaptionBox," in ln for ln in lines) == len(WORDS)
    if st["mode"] == "glow":
        assert any("\\blur" in ln for ln in lines if ln.startswith("Dialogue: 0,"))
    if st["words_per_line"] == 1:
        assert all(ln.count("{\\r}") == 1 for ln in text_lines)


def test_progressive_keeps_spoken_words_coloured(tmp_path):
    t = cs.apply_caption_style(TEMPLATE, "karaoke")
    text = generate_ass_subtitles(WORDS, tmp_path / "k.ass", t).read_text()
    third = [ln for ln in text.splitlines() if ln.startswith("Dialogue: 1,")][2]   # "did" active
    green = "&H0080DE4A"
    assert third.count(green) == 3                                               # bro, he spoken + did active


def test_fonts_dir_arg():
    assert "fontsdir=" in cs.fonts_dir_arg()


def test_render_with_bundled_fonts(tmp_path):
    """libass actually renders a styled frame with the bundled fonts (no missing-font fallback)."""
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg missing")
    ass = generate_ass_subtitles(WORDS, tmp_path / "b.ass", cs.apply_caption_style(TEMPLATE, "boxed"))
    r = subprocess.run(["ffmpeg", "-v", "verbose", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920:d=1",
                        "-vf", f"subtitles='{ass}'{cs.fonts_dir_arg()}", "-ss", "0.6", "-frames:v", "1",
                        str(tmp_path / "f.png")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-500:]
    assert "fontselect: (Montserrat Black" in r.stderr and "Montserrat-Black.ttf" in r.stderr
