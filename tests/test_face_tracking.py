"""Face-follow maths, ffmpeg crop expressions (validated by real ffmpeg), graph wiring, fail-safe."""
import subprocess

from src.compositor.face_tracker import (
    camera_path, clamp_offsets, crop_filter, median_filter, motion_expr, pick_face,
    search_region, to_keyframes, track_crop,
)
from src.compositor.filter_graph_builder import build_filter_graph


def test_search_region_clipped_to_frame():
    assert search_region((0, 100, 200, 200)) == (0.0, 30.0, 270.0, 340.0)
    x, y, w, h = search_region((1800, 900, 120, 180))
    assert x + w <= 1920 and y + h <= 1080


def test_pick_face_prefers_continuity():
    faces = [(100, 100, 40, 40, 0.9), (600, 100, 46, 46, 0.9)]
    assert pick_face(faces, None, 200)[0] == 600            # biggest when no history
    assert pick_face(faces, (110, 100), 200)[0] == 100      # but stay on the tracked face
    assert pick_face([], None, 200) is None


def test_camera_dead_zone_and_easing():
    jitter = [0, 3, -2, 4, -3, 2] * 5
    assert max(map(abs, camera_path(jitter, 10, 0.3))) < 1.0     # jitter inside the dead zone: camera stays put
    path = camera_path([0] * 3 + [100] * 20, 10, 0.3)
    assert path[3] < path[6] < path[-1] and 95 < path[-1] <= 100  # eases towards a real move
    assert median_filter([0, 0, 90, 0, 0]) == [0, 0, 0, 0, 0]     # one-frame glitch removed


def test_clamp_offsets():
    assert clamp_offsets(-500, 0, (100, 100, 200, 200)) == (-70.0, 0)     # 35 % pad limit
    assert clamp_offsets(-60, -500, (40, 10, 200, 200)) == (-40, -10)      # frame edge


def test_keyframes_and_expression_are_valid_ffmpeg(tmp_path):
    times = [i * 0.2 for i in range(30)]
    kfs = to_keyframes(times, [i * 2.0 for i in range(30)], [0.0] * 30)
    assert kfs[0][0] == 0.0 and kfs[-1][0] == round(times[-1], 3)
    expr = motion_expr(100, kfs, 1, 0, 1720)
    assert expr.startswith("clip(100+") and expr.endswith(",0,1720)")
    filt = crop_filter((100, 50, 200, 360), kfs)
    out = tmp_path / "o.mp4"
    r = subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1920x1080:rate=25",
                        "-t", "6", "-filter_complex", f"[0:v]{filt}[v]", "-map", "[v]", str(out)],
                       capture_output=True, text=True)
    assert r.returncode == 0, r.stderr
    probe = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "stream=width,height", "-of", "csv=p=0", str(out)],
                           capture_output=True, text=True).stdout.strip()
    assert probe == "200,360"


def test_static_crop_without_keyframes():
    assert crop_filter((10, 20, 300, 400), []) == "crop=300:400:10:20"


def test_graph_uses_motion_only_for_tracked_layer():
    layout = {"schema": 2, "canvas": {"w": 1080, "h": 1920}, "background": {"type": "solid", "color": "#000"},
              "layers": [
                  {"id": "game", "src": {"x": 0.2, "y": 0, "w": 0.6, "h": 1}, "dst": {"x": 0, "y": 0.38, "w": 1, "h": 0.62}},
                  {"id": "face", "src": {"x": 0, "y": 0.1, "w": 0.2, "h": 0.3}, "dst": {"x": 0, "y": 0, "w": 1, "h": 0.38},
                   "tracking": {"mode": "face"}},
              ]}
    g = build_filter_graph(layout, motion={"face": [(0.0, 5.0, 0.0), (1.0, 10.0, 2.0)]})["filter_complex"]
    assert g.count("crop=w=") == 1 and "x='clip(" in g


def test_no_face_returns_empty(tmp_path):
    src = tmp_path / "noface.mp4"
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=size=1280x720:rate=25",
                    "-t", "3", str(src)], check=True)
    assert track_crop(str(src), 0, 3, (100, 100, 300, 300)) == []
