"""Auto template: look at a raw stream video and propose 9:16 templates for it.

1. Sample ~24 frames across the video (960x540, letterboxed exactly like the renderer).
2. Find the streamer's face in every frame (YuNet). A face that sits in the same place in most
   frames = a webcam overlay; a big face = the camera IS the video (IRL / just chatting); no face =
   gameplay only.
3. Webcam box: start from a box around the face (typical webcam proportions), then snap each side
   to the strongest *persistent* straight edge nearby. Overlay borders stay put while gameplay
   edges average out over many frames, so the averaged edge map shows the overlay frame.
4. Optional: Gemini looks at one frame and returns the webcam / gameplay / chat boxes; used when
   it agrees with the face (the face must be inside its webcam box).
5. Build layout variants (stacked, split, bubble, full-frame follow, gameplay only) as schema-2
   templates, based on an existing template for captions/pacing.

All boxes are in the renderer's 1920x1080 layout space unless noted.
"""

import copy
import logging
import math
import subprocess
from typing import Any, Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

try:
    import cv2
    import numpy as np
    HAS_CV = True
except ImportError:  # pragma: no cover
    HAS_CV = False

LW, LH = 1920, 1080
PW, PH = 960, 540          # proxy frame size (layout = proxy * 2)
Box = Tuple[float, float, float, float]   # x, y, w, h (layout px)


# ------------------------------------------------------------------ sampling

def sample_frames(video: str, duration: float, n: int = 24) -> List[Tuple[float, Any]]:
    """n evenly spaced frames (skipping the first/last 3 %), as 960x540 BGR arrays."""
    frames = []
    lo, hi = duration * 0.03, duration * 0.97
    times = [lo + (hi - lo) * (i + 0.5) / n for i in range(n)] if duration > 1 else [0.0]
    for t in times:
        cmd = ["ffmpeg", "-loglevel", "error", "-ss", f"{t:.2f}", "-i", str(video), "-frames:v", "1",
               "-vf", f"scale={PW}:{PH}:force_original_aspect_ratio=decrease,pad={PW}:{PH}:(ow-iw)/2:(oh-ih)/2",
               "-f", "rawvideo", "-pix_fmt", "bgr24", "-"]
        out = subprocess.run(cmd, capture_output=True, timeout=60).stdout
        if len(out) >= PW * PH * 3:
            frames.append((t, np.frombuffer(out[: PW * PH * 3], dtype=np.uint8).reshape(PH, PW, 3)))
    return frames


# ------------------------------------------------------------------ faces

def face_summary(per_frame: Sequence[Sequence[Tuple[float, float, float, float, float]]]) -> Optional[Dict[str, Any]]:
    """per_frame: faces (cx, cy, w, h, conf) in layout px for each frame. Returns the face that sits in
    the SAME place in the most frames (a webcam face stays put; faces in gameplay move around)."""
    allf = [(i, f) for i, fs in enumerate(per_frame) for f in fs if f[4] >= 0.72]
    if not allf:
        return None
    best, best_key = None, None
    for _, c in allf:
        r = max(40.0, min(140.0, 1.2 * c[2]))
        hits = {}
        for i, f in allf:
            dist = math.hypot(f[0] - c[0], f[1] - c[1])
            if dist <= r and (i not in hits or dist < hits[i][0]):
                hits[i] = (dist, f)
        near = [f for _, f in hits.values()]
        spread = max(max(f[0] for f in near) - min(f[0] for f in near), max(f[1] for f in near) - min(f[1] for f in near))
        key = (len(near), -spread)
        if best_key is None or key > best_key:
            best_key, best = key, near
    xs, ys = sorted(f[0] for f in best), sorted(f[1] for f in best)
    ws, hs = sorted(f[2] for f in best), sorted(f[3] for f in best)
    all_x = [f[0] for _, f in allf]
    return {"cx": xs[len(xs) // 2], "cy": ys[len(ys) // 2], "w": ws[len(ws) // 2], "h": hs[len(hs) // 2],
            "ratio": len(best) / max(1, len(per_frame)), "frames_with_face": len(best),
            "spread": max(xs[-1] - xs[0], ys[-1] - ys[0]), "other_faces": len(allf) - len(best),
            "all_spread": max(all_x) - min(all_x)}


def decide(kind: str, face: Optional[Dict[str, Any]], edge_sides: int, gemini_kind: Optional[str]) -> Tuple[str, str]:
    """Final layout kind + confidence ('high' | 'medium' | 'low') from the face finding, how many webcam
    sides snapped to a real border, and Gemini's reading (if any)."""
    overlay_proven = kind == "facecam" and edge_sides >= 2
    if gemini_kind == "camera_only" and not overlay_proven:
        return "camera", "high" if kind != "facecam" else "medium"
    if gemini_kind == "gameplay_only" and kind == "facecam" and not overlay_proven:
        return "gameplay_only", "medium"
    if kind == "facecam" and not overlay_proven and face and face["ratio"] < 0.6 and face.get("all_spread", 0) > 0.4 * LW:
        return "camera", "low"                        # faces everywhere, no overlay border: it's camera footage
    if kind == "facecam":
        agree = gemini_kind in (None, "gaming_with_facecam")
        return "facecam", "high" if overlay_proven and agree else ("medium" if overlay_proven or agree else "low")
    return kind, "medium" if gemini_kind is None else ("high" if (gemini_kind == "camera_only") == (kind == "camera") else "low")


def classify(face: Optional[Dict[str, Any]]) -> str:
    """'gameplay_only' | 'camera' (the camera is the whole video) | 'facecam' (overlay)."""
    if not face or face["ratio"] < 0.25:
        return "gameplay_only"
    if face["w"] >= 0.09 * LW:
        return "camera"
    return "facecam"


# ------------------------------------------------------------------ webcam box

def persistent_edges(frames: Sequence[Any]) -> Tuple[Any, Any]:
    """Average |d/dx| and |d/dy| over frames (960x540). Static overlay borders survive, gameplay doesn't."""
    ex = np.zeros((PH, PW), np.float32)
    ey = np.zeros((PH, PW), np.float32)
    for f in frames:
        g = cv2.cvtColor(f, cv2.COLOR_BGR2GRAY).astype(np.float32)
        ex += np.abs(cv2.Sobel(g, cv2.CV_32F, 1, 0, ksize=3))
        ey += np.abs(cv2.Sobel(g, cv2.CV_32F, 0, 1, ksize=3))
    n = max(1, len(frames))
    return ex / n, ey / n


def heuristic_cam_box(face: Dict[str, Any]) -> Box:
    """Typical webcam framing: ~4.2 face-widths wide, 16:9-ish, face slightly above centre."""
    w = min(LW * 0.5, face["w"] * 4.2)
    h = min(LH * 0.6, w * 9 / 16 * 1.1)
    x = face["cx"] - w / 2
    y = face["cy"] - h * 0.45
    return clip_box((x, y, w, h))


def clip_box(b: Box) -> Box:
    x, y, w, h = b
    x, y = max(0.0, min(LW - 16, x)), max(0.0, min(LH - 16, y))
    return (x, y, max(16.0, min(LW - x, w)), max(16.0, min(LH - y, h)))


def snap_box(box: Box, ex: Any, ey: Any, face: Dict[str, Any], search: float = 0.35) -> Tuple[Box, Dict[str, float]]:
    """Move each side to the strongest persistent straight edge near it (or the frame edge).
    A side never moves inside the face. Returns the box and a 0..1 confidence per side."""
    x, y, w, h = [v / 2 for v in box]                 # to proxy px
    fx0, fx1 = (face["cx"] - face["w"] * 0.8) / 2, (face["cx"] + face["w"] * 0.8) / 2
    fy0, fy1 = (face["cy"] - face["h"] * 0.9) / 2, (face["cy"] + face["h"] * 0.9) / 2
    rows = slice(int(max(0, y + h * 0.15)), int(min(PH, y + h * 0.85)))
    cols = slice(int(max(0, x + w * 0.15)), int(min(PW, x + w * 0.85)))
    col_score = ex[rows, :].mean(axis=0) if rows.stop > rows.start else np.zeros(PW)
    row_score = ey[:, cols].mean(axis=1) if cols.stop > cols.start else np.zeros(PH)
    base_c = float(np.median(col_score)) + 1e-3
    base_r = float(np.median(row_score)) + 1e-3

    def pick(scores, lo, hi, base, edge_value):
        lo, hi = int(max(0, lo)), int(min(len(scores) - 1, hi))
        if hi <= lo:
            return edge_value, 0.0
        seg = scores[lo:hi + 1]
        i = int(np.argmax(seg))
        strength = float(seg[i]) / base
        if strength < 2.2:                            # nothing line-like: keep the frame edge if close, else heuristic
            return edge_value, 0.0
        return float(lo + i), min(1.0, (strength - 2.2) / 4)

    sx, sy = search * w, search * h
    left, cl = pick(col_score, x - sx, min(fx0 - 2, x + sx), base_c, x)
    right, cr = pick(col_score, max(fx1 + 2, x + w - sx), x + w + sx, base_c, x + w)
    top, ct = pick(row_score, y - sy, min(fy0 - 2, y + sy), base_r, y)
    bottom, cb = pick(row_score, max(fy1 + 2, y + h - sy), y + h + sy, base_r, y + h)
    # a side within 2 % of the frame edge snaps to it (most webcams sit in a corner)
    if left < PW * 0.02: left = 0.0
    if top < PH * 0.02: top = 0.0
    if right > PW * 0.98: right = float(PW)
    if bottom > PH * 0.98: bottom = float(PH)
    snapped = clip_box((left * 2, top * 2, (right - left) * 2, (bottom - top) * 2))
    return snapped, {"left": cl, "right": cr, "top": ct, "bottom": cb}


def box_contains(b: Box, px: float, py: float) -> bool:
    return b[0] <= px <= b[0] + b[2] and b[1] <= py <= b[1] + b[3]


def from_gemini_box(box_2d: Sequence[float]) -> Box:
    """Gemini's [ymin, xmin, ymax, xmax] in 0..1000 -> layout box."""
    y0, x0, y1, x1 = [float(v) for v in box_2d]
    return clip_box((x0 / 1000 * LW, y0 / 1000 * LH, (x1 - x0) / 1000 * LW, (y1 - y0) / 1000 * LH))


# ------------------------------------------------------------------ templates

LAYER_STYLE = {"radius": 0, "shape": "rect", "border": {"w": 0, "color": "#FFFFFF"},
               "shadow": {"blur": 0, "opacity": 0, "dx": 0, "dy": 0}, "opacity": 1, "mirror": False}


def layer(lid: str, name: str, color: str, src: Box, dst: Dict[str, float], fit: str = "cover",
          follow: bool = False, style: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    x, y, w, h = src
    return {"id": lid, "name": name, "color": color, "visible": True, "locked": False,
            "src": {"x": round(x / LW, 4), "y": round(y / LH, 4), "w": round(w / LW, 4), "h": round(h / LH, 4)},
            "dst": {k: round(v, 4) for k, v in dst.items()}, "fit": fit, "aspect_lock": True,
            "style": copy.deepcopy(style or LAYER_STYLE),
            "tracking": {"mode": "face" if follow else "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []}, "visible_range": None}


def crop_for_aspect(aspect: float, center_x: float, avoid: Optional[Box] = None) -> Box:
    """Full-height crop with w/h = aspect (in px), centred on center_x, nudged away from `avoid`."""
    w = min(LW, LH * aspect)
    x = center_x - w / 2
    if avoid:
        ax0, ax1 = avoid[0], avoid[0] + avoid[2]
        overlap = max(0.0, min(x + w, ax1) - max(x, ax0))
        if overlap > 0.25 * w and avoid[2] < LW * 0.5:   # shift towards the side away from the webcam
            x = ax1 if (ax0 + ax1) / 2 < LW / 2 else ax0 - w
    x = max(0.0, min(LW - w, x))
    return (x, 0.0, w, float(LH))


def build_variants(kind: str, cam: Optional[Box], face: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Layout options for what was found. Each: {id, title, hint, layout}."""
    canvas, out = {"w": 1080, "h": 1920}, []
    solid = {"type": "solid", "source_layer": None, "blur": 0, "dim": 0, "color": "#000000"}
    blur = {"type": "blur", "source_layer": None, "blur": 40, "dim": 0.35, "color": "#000000"}

    def lay(ltype, layers, bg=solid):
        return {"schema": 2, "type": ltype, "canvas": canvas, "background": bg, "layers": layers}

    if kind == "facecam" and cam:
        game_px_aspect = 1080 / (1920 * 0.62)
        g = crop_for_aspect(game_px_aspect, LW / 2, cam)
        out.append({"id": "stacked", "title": "Facecam top, gameplay bottom", "hint": "The classic: 38 % cam, 62 % game",
                    "layout": lay("facecam_top_gameplay_bottom", [
                        layer("l_game", "Gameplay", "#22D3EE", g, {"x": 0, "y": 0.38, "w": 1, "h": 0.62}),
                        layer("l_face", "Facecam", "#FFB020", cam, {"x": 0, "y": 0, "w": 1, "h": 0.38}, follow=True)])})
        g2 = crop_for_aspect(1080 / 960, LW / 2, cam)
        out.append({"id": "split", "title": "50 / 50 split", "hint": "Equal space for reaction and game",
                    "layout": lay("split_screen_50_50", [
                        layer("l_game", "Gameplay", "#22D3EE", g2, {"x": 0, "y": 0.5, "w": 1, "h": 0.5}),
                        layer("l_face", "Facecam", "#FFB020", cam, {"x": 0, "y": 0, "w": 1, "h": 0.5}, follow=True)])})
        g3 = crop_for_aspect(1080 / 1920, LW / 2, cam)
        cam_aspect = cam[2] / max(1.0, cam[3])
        bw = 0.46
        bh = bw * 1080 / cam_aspect / 1920
        bubble_style = {**LAYER_STYLE, "radius": 28, "border": {"w": 4, "color": "#FFFFFF"}}
        out.append({"id": "bubble", "title": "Full gameplay + cam bubble", "hint": "Game fills the screen, small cam on top",
                    "layout": lay("single_crop_9_16", [
                        layer("l_game", "Gameplay", "#22D3EE", g3, {"x": 0, "y": 0, "w": 1, "h": 1}),
                        layer("l_face", "Facecam", "#FFB020", cam, {"x": 0.04, "y": 0.06, "w": bw, "h": round(bh, 4)},
                              follow=True, style=bubble_style)])})
    if kind == "camera" and face:
        c = crop_for_aspect(1080 / 1920, face["cx"])
        out.append({"id": "follow", "title": "Full-screen camera, follows the face", "hint": "For IRL / just chatting",
                    "layout": lay("dynamic_face_track", [
                        layer("l_main", "Camera", "#FFB020", c, {"x": 0, "y": 0, "w": 1, "h": 1}, follow=True)])})
    # always offer a no-cam option
    out.append({"id": "gameplay", "title": "Whole video on a blurred background", "hint": "Nothing cut off; works for anything",
                "layout": lay("blurred_bg_center", [
                    layer("l_main", "Video", "#22D3EE", (0, 0, LW, LH), {"x": 0, "y": 0.3, "w": 1, "h": 0.4}, fit="contain")], bg=blur)})
    return out


def make_template(base: Dict[str, Any], layout: Dict[str, Any], name: str, description: str) -> Dict[str, Any]:
    t = copy.deepcopy(base)
    for k in ("_migrated_from_legacy", "_legacy_layout"):
        t.pop(k, None)
    t["name"] = name
    t["description"] = description
    t["layout"] = copy.deepcopy(layout)
    return t


def draw_debug(frame: Any, face: Optional[Dict[str, Any]], cam: Optional[Box], gem: Optional[Box],
               heur: Optional[Box], out_path: str) -> None:
    img = frame.copy()

    def rect(b, color, t=2):
        x, y, w, h = [int(v / 2) for v in b]
        cv2.rectangle(img, (x, y), (x + w, y + h), color, t)
    if heur:
        rect(heur, (160, 160, 160), 1)
    if gem:
        rect(gem, (255, 0, 255), 2)
    if cam:
        rect(cam, (94, 197, 34), 3)
    if face:
        cv2.circle(img, (int(face["cx"] / 2), int(face["cy"] / 2)), int(face["w"] / 4) + 2, (0, 215, 255), 2)
    cv2.imwrite(out_path, img, [cv2.IMWRITE_JPEG_QUALITY, 85])


# ------------------------------------------------------------------ whole analysis

async def analyse(src: str, dur: float, n: int = 24, use_gemini: bool = True, log=None) -> Dict[str, Any]:
    """Read a video's layout: what kind it is, where the webcam is, where the face is.
    Shared by Clip Lab (step 7) and Quick Clip's "auto template" option."""
    import asyncio
    import numpy as np
    import cv2
    from typing import List as _L, Literal, Optional as _O
    from pydantic import BaseModel, Field
    from src.compositor.face_tracker import _Detector
    log = log or (lambda msg: logger.info("Auto template: %s", msg))

    log(f"Sampling {n} frames across the video…")
    frames = await asyncio.to_thread(sample_frames, src, dur, n)
    if not frames:
        raise RuntimeError("Could not read frames from the video")
    det = _Detector()
    if not det.available:
        raise RuntimeError("No face detector available (OpenCV missing)")
    log(f"Looking for faces in {len(frames)} frames ({'YuNet' if det.yunet is not None else 'Haar'})…")

    def detect_all():
        out = []
        for _, f in frames:
            faces = det.detect(np.ascontiguousarray(f))
            out.append([(cx * 2, cy * 2, w * 2, h * 2, c) for cx, cy, w, h, c in faces])
        return out
    per_frame = await asyncio.to_thread(detect_all)
    face = face_summary(per_frame)
    kind = classify(face)
    log(f"Found: {kind.replace('_', ' ')}" + (f" (face in {face['frames_with_face']}/{len(frames)} frames)" if face else ""))

    cam, heur, gem_box, source, sides, gemini = None, None, None, None, {}, None
    best_i = max(range(len(frames)), key=lambda i: max((f[2] * f[3] * f[4] for f in per_frame[i]), default=0))
    if kind == "facecam":
        heur = heuristic_cam_box(face)
        ex, ey = await asyncio.to_thread(persistent_edges, [f for _, f in frames])
        cam, sides = snap_box(heur, ex, ey, face)
        source = "edges" if any(v > 0 for v in sides.values()) else "face size"

    if use_gemini:
        class Box2D(BaseModel):
            box_2d: _L[int] = Field(..., description="[ymin, xmin, ymax, xmax] normalised to 0-1000")

        class LayoutRead(BaseModel):
            kind: Literal["gaming_with_facecam", "camera_only", "gameplay_only", "other"]
            webcam: _O[Box2D] = Field(None, description="The streamer's webcam overlay rectangle, if any")
            gameplay: _O[Box2D] = Field(None, description="The main game / screen content area")
            chat: _O[Box2D] = Field(None, description="On-screen chat overlay, if any")
            notes: str = Field("", description="One short sentence about the layout")
        try:
            from src.intelligence.llm.client import GeminiClient
            from config.settings import GEMINI_API_KEY
            client = GeminiClient(api_key=GEMINI_API_KEY)
            await client._sync_keys_from_db()
            if client._client is not None:
                log("Asking Gemini to read the layout from one frame…")
                ok, jpg = cv2.imencode(".jpg", frames[best_i][1], [cv2.IMWRITE_JPEG_QUALITY, 88])
                res = await client.generate_structured_media(
                    system_instruction="You read livestream screenshots. Return exact bounding boxes of overlay regions.",
                    user_prompt=("Find the streamer's webcam overlay (a rectangle showing a real person's camera), the gameplay "
                                 "or main screen area, and an on-screen chat box if present. If the whole frame is a real camera, "
                                 "kind is camera_only. Boxes as [ymin, xmin, ymax, xmax] in 0-1000."),
                    media=jpg.tobytes(), mime_type="image/jpeg", response_model=LayoutRead)
                if res:
                    gemini = res.model_dump()
                    if res.webcam and len(res.webcam.box_2d) == 4:
                        gem_box = from_gemini_box(res.webcam.box_2d)
            else:
                log("No Gemini key: using computer vision only")
        except Exception as e:
            log(f"Gemini check skipped: {e}")

    edge_sides = sum(1 for v in sides.values() if v > 0)
    if gem_box and face and box_contains(gem_box, face["cx"], face["cy"]) and kind in ("facecam", "gameplay_only") \
            and (gemini or {}).get("kind") in (None, "gaming_with_facecam"):
        snapped, sides2 = snap_box(gem_box, *(await asyncio.to_thread(persistent_edges, [f for _, f in frames])), face, search=0.12)
        cam, sides, source, kind = snapped, sides2, "gemini + edges", "facecam"
    elif gem_box and kind == "facecam" and not box_contains(gem_box, face["cx"], face["cy"]):
        log("Gemini's webcam box doesn't contain the detected face: ignoring it")

    edge_sides = max(edge_sides, sum(1 for v in sides.values() if v > 0))
    final, confidence = decide(kind, face, edge_sides, (gemini or {}).get("kind"))
    if final != kind:
        log(f"Changed the reading from {kind} to {final} (edges on {edge_sides} sides, Gemini: {(gemini or {}).get('kind', 'not asked')})")
    kind = final
    if kind != "facecam":
        cam, source = None, None
    if kind == "camera" and not face:
        face = {"cx": LW / 2, "cy": LH / 2, "w": 200, "h": 220, "ratio": 0, "frames_with_face": 0, "spread": 0}
    return {"kind": kind, "confidence": confidence, "edge_sides": edge_sides, "face": face, "cam": cam,
            "heur": heur, "gem_box": gem_box, "source": source, "sides": sides, "gemini": gemini,
            "frames": frames, "best_i": best_i}
