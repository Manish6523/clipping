"""Hook title card styles + template default styles."""

import asyncio
import json
import shutil
import subprocess
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from src.compositor import caption_styles as cs  # noqa: E402
from src.compositor import hook_styles as hs  # noqa: E402

TEMPLATE = {"subtitles": {"font_name": "Montserrat ExtraBold", "font_size": 60, "position": {"x": 0.5, "y": 0.7}}}


@pytest.mark.parametrize("sid", list(hs.HOOK_STYLES))
def test_each_hook_style_builds(sid):
    styles, events = hs.build_hook_events("He did not expect this to happen", sid, 0.7)
    assert events and all(e.startswith("Dialogue:") for e in events)
    assert any(s.startswith(f"Style: Hook_{sid},{hs.HOOK_STYLES[sid]['font']},") for s in styles)
    spec = hs.HOOK_STYLES[sid]
    if spec.get("bg"):
        assert any("\\p1" in e for e in events)                     # drawn background
    if spec.get("gradient"):
        assert sum("\\clip(" in e for e in events) >= 12            # gradient strips
    if spec.get("tag"):
        assert any(spec["tag"]["text"] in e for e in events)


def test_hook_position_avoids_captions():
    _, low = hs.build_hook_events("hello there friend", "tiktok", 0.2)    # captions up top -> hook low
    _, high = hs.build_hook_events("hello there friend", "tiktok", 0.8)
    y = lambda evs: float(evs[-1].split("\\pos(")[1].split(",")[1].split(")")[0])  # noqa: E731
    assert y(low) > 1000 > y(high)


def test_wrap_respects_width():
    lines = hs.wrap("this is a fairly long hook line that must wrap onto several lines", "Montserrat Black", 108, 880)
    assert 2 <= len(lines) <= 3
    assert all(hs.text_width(ln, "Montserrat Black", 108) <= 880 for ln in lines[:-1])


def test_empty_text_draws_nothing(tmp_path):
    ass = tmp_path / "a.ass"
    ass.write_text("[V4+ Styles]\nStyle: KineticCaption,x\n[Events]\n")
    assert hs.render_hook_card(ass, "   ", "pill", 0.7) is False


def test_apply_styles_precedence():
    tpl = {**TEMPLATE, "caption_style": "neon", "hook_style": "pill"}
    t = cs.apply_styles(tpl)                                   # template defaults
    assert t["subtitles"]["font_name"] == "Russo One" and t["hook_style"] == "pill"
    t = cs.apply_styles(tpl, "karaoke", "question")            # per-clip override wins
    assert t["subtitles"]["caption_style"] == "karaoke" and t["hook_style"] == "question"
    t = cs.apply_styles(tpl, "template", "template")           # "template" = template defaults
    assert t["subtitles"]["caption_style"] == "neon" and t["hook_style"] == "pill"
    assert cs.apply_styles(TEMPLATE) is TEMPLATE               # nothing set -> untouched
    assert "hook_style" not in tpl["subtitles"] and tpl["subtitles"]["font_name"] == "Montserrat ExtraBold"


def test_hook_restyle_refuses_clip_without_hook(tmp_path, monkeypatch):
    import src.database as database
    from src.web import routes_clips
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    asyncio.run(database.init_db())
    src = tmp_path / "s.mp4"
    src.write_bytes(b"x")
    cid = asyncio.run(database.create_clip(source_type="live", source_id="s", channel_id="c", template_name="t",
                                           raw_start=0, raw_end=5, virality_score=1, title="t",
                                           source_video_path=str(src), rendered_video_path=str(src)))

    class Req:
        match_info = {"id": str(cid)}

        async def json(self):
            return {"style": "pill"}
    resp = asyncio.run(routes_clips.hook_style_clip(Req()))
    assert resp.status == 409 and b"NO_HOOK_CARD" in resp.body
    Req.json = lambda self: _coro({"style": "bogus"})
    assert asyncio.run(routes_clips.hook_style_clip(Req())).status == 400


async def _coro(v):
    return v


def test_hook_renders_with_libass(tmp_path):
    if not shutil.which("ffmpeg"):
        pytest.skip("ffmpeg missing")
    ass = tmp_path / "h.ass"
    ass.write_text("[Script Info]\nScriptType: v4.00+\nPlayResX: 1080\nPlayResY: 1920\n\n[V4+ Styles]\n"
                   "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, "
                   "Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, "
                   "MarginR, MarginV, Encoding\nStyle: KineticCaption,Inter,60,&H00FFFFFF,&H000000FF,&H00000000,&H80000000,"
                   "-1,0,0,0,100,100,0,0,1,4,2,5,40,40,0,1\n\n[Events]\n"
                   "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\n")
    assert hs.render_hook_card(ass, "Would you survive this?", "pill", 0.7)
    r = subprocess.run(["ffmpeg", "-v", "error", "-y", "-f", "lavfi", "-i", "color=c=gray:s=1080x1920:d=1",
                        "-vf", f"subtitles='{ass}'{cs.fonts_dir_arg()}", "-ss", "0.5", "-frames:v", "1",
                        str(tmp_path / "f.png")], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr[-400:]
