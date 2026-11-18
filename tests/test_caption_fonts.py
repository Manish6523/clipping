"""Every font the editors offer must render with a bundled font on a bare server (it fell back to FreeSans/Noto:
templates saved browser aliases like 'AC Anton', and bare 'Montserrat' didn't match the bundled files)."""
import re
import subprocess
from pathlib import Path

import pytest

from src.compositor.caption_styles import FONTS_DIR, resolve_font_name

FRONT = Path(__file__).resolve().parents[1] / "frontend" / "src"


def offered_fonts():
    names = set()
    for f in ("components/TemplateStudio.jsx", "components/editor/ContextualInspector.jsx"):
        names |= set(re.findall(r'<option value="([^"]+)">', (FRONT / f).read_text()))
    names = {n for n in names if n[0].isupper() and not n.isdigit()}
    js = (FRONT / "lib/captionStyles.js").read_text()
    names |= set(re.findall(r"family: \"'([^']+)'\"", js))          # @font-face aliases old presets saved
    return sorted(names)


def bundled_files():
    return {p.name for p in FONTS_DIR.glob("*.ttf")}


@pytest.mark.parametrize("name", offered_fonts())
def test_font_renders_from_bundle(name, tmp_path):
    fn = resolve_font_name(name)
    ass = tmp_path / "t.ass"
    ass.write_text(f"""[Script Info]
PlayResX: 1080
PlayResY: 1920
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: S,{fn},80,&H00FFFFFF,&H000000FF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,4,0,5,10,10,10,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
Dialogue: 0,0:00:00.00,0:00:01.00,S,,0,0,0,,HELLO
""")
    r = subprocess.run(["ffmpeg", "-v", "verbose", "-f", "lavfi", "-i", "color=s=1080x1920:d=0.1", "-vf",
                        f"subtitles={ass}:fontsdir={FONTS_DIR}", "-frames:v", "1", "-f", "null", "-"],
                       capture_output=True, text=True)
    sel = [l.split("->")[-1] for l in r.stderr.splitlines() if "fontselect" in l]
    assert sel, r.stderr[-300:]
    assert "/" not in sel[0], f"{name!r} -> {fn!r} fell back to a system font: {sel[0].strip()}"
