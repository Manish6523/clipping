"""Quick Clip layout options: auto template picks the layout for the clip, face tracking follows the face.
The video analysis is faked - nothing is decoded and no template file is touched."""
import asyncio

from src.compositor import auto_template as at
from src.compositor import quick_layout as ql

TEMPLATE = {
    "name": "temp", "caption": {"font": "Anton"},
    "layout": {"schema": 2, "canvas": {"w": 1080, "h": 1920}, "layers": [
        {"id": "game", "name": "Gameplay", "src": {"x": 0.3, "y": 0, "w": 0.4, "h": 1}, "dst": {"x": 0, "y": 0.3, "w": 1, "h": 0.7},
         "tracking": {"mode": "off", "smooth": 0.8}},
        {"id": "cam", "name": "Cam", "src": {"x": 0, "y": 0.2, "w": 0.25, "h": 0.45}, "dst": {"x": 0, "y": 0, "w": 1, "h": 0.3}},
    ]},
}
FACE = {"cx": 0.1 * at.LW, "cy": 0.4 * at.LH, "w": 120, "h": 140, "ratio": 0.9, "frames_with_face": 12, "spread": 10}


def run(coro):
    return asyncio.run(coro)


def test_off_by_default_returns_the_same_template():
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30))
    assert t is TEMPLATE and note is None


def test_face_tracking_turns_on_only_the_layer_showing_the_face(monkeypatch):
    async def face(*a, **k):
        return FACE
    monkeypatch.setattr(ql, "find_face", face)
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30, face_track=True))
    modes = {l["id"]: l["tracking"]["mode"] for l in t["layout"]["layers"]}
    assert modes == {"game": "off", "cam": "face"} and note == "Face tracking on"
    assert t["layout"]["layers"][1]["tracking"]["smooth"] == 0.8
    assert "tracking" not in TEMPLATE["layout"]["layers"][1]          # user's template untouched


def test_face_tracking_without_a_face_says_so(monkeypatch):
    async def none(*a, **k):
        return None
    monkeypatch.setattr(ql, "find_face", none)
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30, face_track=True))
    assert note == "Face tracking: no face found"
    assert all(l["tracking"]["mode"] == "off" for l in t["layout"]["layers"])


def _fake_analyse(kind, cam=None, face=FACE):
    async def analyse(src, dur, n=24, use_gemini=True, log=None):
        return {"kind": kind, "confidence": "high", "cam": cam, "face": face}
    return analyse


def test_auto_template_facecam_uses_stacked_and_keeps_captions(monkeypatch):
    monkeypatch.setattr(at, "analyse", _fake_analyse("facecam", cam=(0, 200, 480, 480)))
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30, auto_template=True, face_track=True))
    assert t["layout"]["type"] == "facecam_top_gameplay_bottom"
    assert t["caption"] == {"font": "Anton"} and t["name"] == "temp"
    assert {l["name"]: l["tracking"]["mode"] for l in t["layout"]["layers"]} == {"Gameplay": "off", "Facecam": "face"}
    assert note.startswith("Auto layout: Facecam top, gameplay bottom") and "face tracking on" in note


def test_auto_template_without_face_tracking_never_follows(monkeypatch):
    monkeypatch.setattr(at, "analyse", _fake_analyse("camera"))
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30, auto_template=True))
    assert t["layout"]["type"] == "dynamic_face_track"
    assert all(l["tracking"]["mode"] == "off" for l in t["layout"]["layers"])


def test_auto_template_gameplay_only(monkeypatch):
    monkeypatch.setattr(at, "analyse", _fake_analyse("gameplay_only", face=None))
    t, _ = run(ql.adapt(TEMPLATE, "x.mp4", 30, auto_template=True, face_track=True))
    assert t["layout"]["type"] == "blurred_bg_center"


def test_analysis_failure_keeps_the_users_template(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("no frames")
    monkeypatch.setattr(at, "analyse", boom)
    t, note = run(ql.adapt(TEMPLATE, "x.mp4", 30, auto_template=True))
    assert t is TEMPLATE and note is None
