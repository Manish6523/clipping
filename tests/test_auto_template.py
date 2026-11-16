"""Auto template: steady-face clustering, webcam edge snapping, classification, layouts that really render."""
import subprocess

import numpy as np
import cv2

from src.compositor import auto_template as at
from src.compositor.filter_graph_builder import build_filter_graph


def test_face_summary_prefers_the_face_that_stays_put():
    frames = []
    for i in range(20):
        fs = [(190 + (i % 3), 290, 80, 90, 0.9)]                       # webcam face, almost still
        if i % 2 == 0:
            fs.append((600 + i * 60, 500, 120, 130, 0.95))             # bigger game NPC face, wanders
        frames.append(fs)
    f = at.face_summary(frames)
    assert 185 <= f["cx"] <= 195 and f["frames_with_face"] == 20 and f["ratio"] == 1.0
    assert at.classify(f) == "facecam"


def test_classify():
    assert at.classify(None) == "gameplay_only"
    assert at.classify({"ratio": 0.1, "w": 80, "spread": 0}) == "gameplay_only"
    assert at.classify({"ratio": 0.9, "w": 300, "spread": 0}) == "camera"
    assert at.classify({"ratio": 0.9, "w": 80, "spread": 10}) == "facecam"


def synthetic_frames(n=16, cam=(0, 136, 400, 300)):
    """Changing 'gameplay' noise with a fixed webcam rectangle (static room + border) in it."""
    rng = np.random.default_rng(1)
    room = rng.integers(20, 60, (at.PH, at.PW, 3), dtype=np.uint8)
    x, y, w, h = [v // 2 for v in cam]
    out = []
    for i in range(n):
        f = cv2.GaussianBlur(rng.integers(0, 255, (at.PH, at.PW, 3), dtype=np.uint8), (0, 0), 6)
        f[y:y + h, x:x + w] = room[y:y + h, x:x + w]
        cv2.rectangle(f, (x, y), (x + w - 1, y + h - 1), (230, 230, 230), 2)
        out.append(f)
    return out


def test_snap_box_finds_the_overlay_border():
    cam = (0, 136, 400, 300)
    frames = synthetic_frames(cam=cam)
    ex, ey = at.persistent_edges(frames)
    face = {"cx": 180, "cy": 280, "w": 70, "h": 80}
    guess = at.heuristic_cam_box(face)
    box, conf = at.snap_box(guess, ex, ey, face)
    for got, want in zip(box, cam):
        assert abs(got - want) <= 12, (box, cam)
    assert conf["right"] > 0 and conf["bottom"] > 0


def test_gemini_box_conversion():
    assert at.from_gemini_box([126, 0, 404, 211]) == (0.0, 136.08, 405.12, 300.24)
    assert at.box_contains((0, 136, 405, 300), 190, 290)


def test_variants_render_with_ffmpeg(tmp_path):
    src = tmp_path / "src.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25",
                    "-t", "2", str(src)], check=True)
    face = {"cx": 200, "cy": 290, "w": 80, "h": 90, "ratio": 1, "spread": 0}
    variants = at.build_variants("facecam", (0, 136, 400, 300), face)
    assert [v["id"] for v in variants] == ["stacked", "split", "bubble", "gameplay"]
    assert any(l["tracking"]["mode"] == "face" for l in variants[0]["layout"]["layers"])
    assert [v["id"] for v in at.build_variants("camera", None, {**face, "w": 400})] == ["follow", "gameplay"]
    for v in variants:
        from src.compositor.ffmpeg_renderer import normalize_source_input
        g = normalize_source_input(build_filter_graph(v["layout"])["filter_complex"], (1280, 720))
        out = tmp_path / f"{v['id']}.mp4"
        r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(src), "-filter_complex",
                            g, "-map", "[vout]", "-t", "1", "-pix_fmt", "yuv420p", str(out)],
                           capture_output=True, text=True)
        assert r.returncode == 0, (v["id"], r.stderr[-300:])
    tpl = at.make_template({"name": "base", "subtitles": {"font_size": 70}, "layout": {}}, variants[0]["layout"], "x stacked", "d")
    assert tpl["name"] == "x stacked" and tpl["subtitles"]["font_size"] == 70 and tpl["layout"]["schema"] == 2


def test_decide_combines_edges_faces_and_gemini():
    steady = {"ratio": 0.9, "w": 80, "spread": 10, "all_spread": 50}
    wandering = {"ratio": 0.4, "w": 80, "spread": 10, "all_spread": 1200}
    assert at.decide("facecam", steady, 4, None) == ("facecam", "high")
    assert at.decide("facecam", steady, 4, "camera_only") == ("facecam", "medium")     # a real border beats Gemini
    assert at.decide("facecam", wandering, 0, "camera_only") == ("camera", "medium")   # outdoor footage case
    assert at.decide("facecam", wandering, 0, None) == ("camera", "low")
    assert at.decide("facecam", steady, 0, "gameplay_only") == ("gameplay_only", "medium")
    assert at.decide("gameplay_only", None, 0, "camera_only") == ("camera", "high")
