"""Face tracking: smoothed crop motion that follows the streamer's face.

Two users:
- Schema v2 layers with ``tracking: {"mode": "face", "smooth": 0..1}``: the layer's source crop
  moves (inside a search region around where it was drawn) so the face stays framed.
- The legacy ``dynamic_face_track`` layout (one 9:16 crop over the whole frame).

Pipeline: ffmpeg decodes a 960x540, 5 fps letterboxed proxy (same geometry as the renderer's
1920x1080 normalisation, so coordinates map by a factor of 2) -> YuNet (falls back to the Haar
cascade) -> pick the face nearest the previous one -> median filter -> dead zone -> ease ->
0.5 s keyframes of (dx, dy) offsets in 1920x1080 layout space -> ffmpeg crop expressions.
"""

import hashlib
import logging
import math
import subprocess
import urllib.request
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

try:
    import cv2
    import numpy as np
    HAS_OPENCV = True
except ImportError:  # pragma: no cover
    HAS_OPENCV = False

LAYOUT_W, LAYOUT_H = 1920, 1080
PROXY_W, PROXY_H = 960, 540            # layout = proxy * 2
SAMPLE_FPS = 5.0
KEYFRAME_S = 0.5
SEARCH_PAD = 0.35                      # search region = crop grown by 35 % per side
DEAD_ZONE = 0.08                       # ignore drift under 8 % of the crop size
HEADROOM = 0.42                        # face centre sits 42 % down the crop
MIN_MOTION_PX = 6.0                    # less total motion than this -> keep the static crop

YUNET_FILE = "face_detection_yunet_2023mar.onnx"
YUNET_URL = "https://github.com/opencv/opencv_zoo/raw/main/models/face_detection_yunet/" + YUNET_FILE
YUNET_SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
MODELS_DIR = Path(__file__).resolve().parents[2] / "config" / "models"

Keyframe = Tuple[float, float, float]   # (t seconds from clip start, dx, dy) in layout px


# ---------------------------------------------------------------- detection

def yunet_model_path(download: bool = True) -> Optional[Path]:
    path = MODELS_DIR / YUNET_FILE
    if path.exists():
        return path
    if not download:
        return None
    try:
        MODELS_DIR.mkdir(parents=True, exist_ok=True)
        tmp = path.with_suffix(".part")
        urllib.request.urlretrieve(YUNET_URL, tmp)
        if hashlib.sha256(tmp.read_bytes()).hexdigest() != YUNET_SHA256:
            tmp.unlink(missing_ok=True)
            logger.warning("YuNet model checksum mismatch; using the Haar cascade.")
            return None
        tmp.replace(path)
        return path
    except Exception as e:
        logger.info("YuNet model unavailable (%s); using the Haar cascade.", e)
        return None


class _Detector:
    """Returns faces as (cx, cy, w, h, confidence) in the image it is given."""

    def __init__(self):
        self.yunet = None
        self.haar = None
        if not HAS_OPENCV:
            return
        model = yunet_model_path()
        if model and hasattr(cv2, "FaceDetectorYN"):
            try:
                self.yunet = cv2.FaceDetectorYN.create(str(model), "", (320, 320), 0.6, 0.3, 50)
            except Exception as e:
                logger.info("YuNet init failed (%s); using the Haar cascade.", e)
        if self.yunet is None:
            cascade_cls = getattr(cv2, "CascadeClassifier", None)
            if cascade_cls and hasattr(cv2, "data"):
                self.haar = cascade_cls(cv2.data.haarcascades + "haarcascade_frontalface_default.xml")

    @property
    def available(self) -> bool:
        return self.yunet is not None or self.haar is not None

    def detect(self, img) -> List[Tuple[float, float, float, float, float]]:
        h, w = img.shape[:2]
        if w < 16 or h < 16:
            return []
        if self.yunet is not None:
            self.yunet.setInputSize((w, h))
            _, faces = self.yunet.detect(img)
            if faces is None:
                return []
            return [(float(f[0] + f[2] / 2), float(f[1] + f[3] / 2), float(f[2]), float(f[3]), float(f[14])) for f in faces]
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        found = self.haar.detectMultiScale(gray, scaleFactor=1.1, minNeighbors=5, minSize=(16, 16))
        return [(x + fw / 2.0, y + fh / 2.0, float(fw), float(fh), 0.7) for (x, y, fw, fh) in found]


def iter_proxy_frames(video_path: str, start: float, duration: float, fps: float = SAMPLE_FPS):
    """Yield (t, bgr_frame) of a 960x540 letterboxed proxy, t from 0."""
    cmd = [
        "ffmpeg", "-loglevel", "error", "-ss", f"{max(0.0, start):.3f}", "-t", f"{max(0.1, duration):.3f}",
        "-i", str(video_path),
        "-vf", f"fps={fps},scale={PROXY_W}:{PROXY_H}:force_original_aspect_ratio=decrease,"
               f"pad={PROXY_W}:{PROXY_H}:(ow-iw)/2:(oh-ih)/2",
        "-f", "rawvideo", "-pix_fmt", "bgr24", "-an", "-",
    ]
    frame_bytes = PROXY_W * PROXY_H * 3
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
    try:
        i = 0
        while True:
            buf = proc.stdout.read(frame_bytes)
            if len(buf) < frame_bytes:
                break
            yield i / fps, np.frombuffer(buf, dtype=np.uint8).reshape(PROXY_H, PROXY_W, 3)
            i += 1
    finally:
        proc.stdout.close()
        proc.kill()
        proc.wait()


# ---------------------------------------------------------------- pure maths (unit-tested)

def search_region(crop: Tuple[float, float, float, float], pad: float = SEARCH_PAD,
                  bounds: Tuple[float, float] = (LAYOUT_W, LAYOUT_H)) -> Tuple[float, float, float, float]:
    x, y, w, h = crop
    x0, y0 = max(0.0, x - pad * w), max(0.0, y - pad * h)
    x1, y1 = min(bounds[0], x + w + pad * w), min(bounds[1], y + h + pad * h)
    return x0, y0, x1 - x0, y1 - y0


def pick_face(faces: Sequence[Tuple[float, float, float, float, float]], prev: Optional[Tuple[float, float]],
              scale: float) -> Optional[Tuple[float, float, float]]:
    """Biggest confident face, preferring the one closest to where the face was before."""
    best, best_score = None, -1e9
    for cx, cy, fw, fh, conf in faces:
        size = math.sqrt(max(1.0, fw * fh))
        score = conf * size
        if prev is not None:
            # jumping a whole crop-width away costs ~ a face 0.6x the crop's size: stay on the tracked face
            score -= 0.6 * math.hypot(cx - prev[0], cy - prev[1])
        if score > best_score:
            best, best_score = (cx, cy, size), score
    return best


def median_filter(values: Sequence[float], k: int = 5) -> List[float]:
    half = k // 2
    out = []
    for i in range(len(values)):
        win = sorted(values[max(0, i - half): i + half + 1])
        out.append(win[len(win) // 2])
    return out


def camera_path(targets: Sequence[float], dead_zone: float, alpha: float) -> List[float]:
    """A calm virtual camera: it only re-aims when the target leaves the dead zone, then eases
    towards it (exponential smoothing, alpha per sample)."""
    if not targets:
        return []
    cam = aim = targets[0]
    out = []
    for t in targets:
        if abs(t - aim) > dead_zone:
            aim = t
        elif abs(t - cam) <= dead_zone * 0.25:
            aim = cam                     # settled: stop micro-chasing
        cam += alpha * (aim - cam)
        out.append(cam)
    return out


def clamp_offsets(dx: float, dy: float, crop: Tuple[float, float, float, float],
                  pad: float = SEARCH_PAD, bounds: Tuple[float, float] = (LAYOUT_W, LAYOUT_H)) -> Tuple[float, float]:
    x, y, w, h = crop
    dx = max(-pad * w, min(pad * w, dx))
    dy = max(-pad * h, min(pad * h, dy))
    dx = max(-x, min(bounds[0] - w - x, dx))       # crop must stay inside the frame
    dy = max(-y, min(bounds[1] - h - y, dy))
    return dx, dy


def to_keyframes(times: Sequence[float], xs: Sequence[float], ys: Sequence[float], step: float = KEYFRAME_S) -> List[Keyframe]:
    if not times:
        return []
    kfs: List[Keyframe] = []
    next_t = 0.0
    for t, x, y in zip(times, xs, ys):
        if t + 1e-6 >= next_t:
            kfs.append((round(t, 3), round(x, 1), round(y, 1)))
            next_t = t + step
    if kfs[-1][0] < times[-1]:
        kfs.append((round(times[-1], 3), round(xs[-1], 1), round(ys[-1], 1)))
    return kfs


def motion_expr(base: int, kfs: Sequence[Keyframe], axis: int, lo: int, hi: int) -> str:
    """ffmpeg expression for `base + offset(t)`, piecewise-linear between keyframes, clamped.
    axis: 1 = dx, 2 = dy. Commas are fine: the caller single-quotes the value."""
    if not kfs:
        return str(base)
    terms = []
    for (t0, *o0), (t1, *o1) in zip(kfs, kfs[1:]):
        a, b = o0[axis - 1], o1[axis - 1]
        if t1 <= t0:
            continue
        if abs(b - a) < 0.05:
            terms.append(f"gte(t,{t0})*lt(t,{t1})*{a:.1f}")
        else:
            terms.append(f"gte(t,{t0})*lt(t,{t1})*({a:.1f}+{(b - a) / (t1 - t0):.3f}*(t-{t0}))")
    last_t, *last = kfs[-1]
    terms.append(f"gte(t,{last_t})*{last[axis - 1]:.1f}")
    first = kfs[0][axis]
    terms.append(f"lt(t,{kfs[0][0]})*{first:.1f}")
    return f"clip({base}+{'+'.join(terms)},{lo},{hi})"


# ---------------------------------------------------------------- tracking

def track_crop(video_path: str, start: float, duration: float, crop: Tuple[int, int, int, int],
               smooth: float = 0.8, pad: float = SEARCH_PAD, headroom: float = HEADROOM,
               detector: Optional[_Detector] = None, view_aspect: Optional[float] = None) -> List[Keyframe]:
    """Keyframes of (dx, dy) that keep the face framed in `crop` (layout px) for [start, start+duration].
    `view_aspect` (w/h of the output box, cover fit) = only a centred band of the crop is visible;
    the face is framed inside that band. Returns [] when nothing useful was found."""
    if not HAS_OPENCV:
        return []
    detector = detector or _Detector()
    if not detector.available:
        return []
    cx0, cy0, cw, ch = crop
    rx, ry, rw, rh = search_region(crop, pad)
    k = LAYOUT_W / PROXY_W
    px0, py0 = int(rx / k), int(ry / k)
    px1, py1 = int(math.ceil((rx + rw) / k)), int(math.ceil((ry + rh) / k))

    times: List[float] = []
    raw_x: List[Optional[float]] = []
    raw_y: List[Optional[float]] = []
    prev = None
    for t, frame in iter_proxy_frames(video_path, start, duration):
        roi = frame[py0:py1, px0:px1]
        # upscale small regions so a 50 px facecam face is still detectable
        up = 2.0 if roi.shape[1] < 360 else 1.0
        img = cv2.resize(roi, None, fx=up, fy=up, interpolation=cv2.INTER_LINEAR) if up != 1.0 else roi
        faces = [((fx / up + px0) * k, (fy / up + py0) * k, fw / up * k, fh / up * k, c)
                 for fx, fy, fw, fh, c in detector.detect(np.ascontiguousarray(img))]
        face = pick_face(faces, prev, cw)
        times.append(t)
        if face:
            prev = (face[0], face[1])
            raw_x.append(face[0])
            raw_y.append(face[1])
        else:
            raw_x.append(None)
            raw_y.append(None)

    seen = [i for i, v in enumerate(raw_x) if v is not None]
    if len(seen) < max(3, len(times) * 0.2):
        return []                        # face rarely visible: don't guess
    # hold last value through gaps, back-fill the start
    first = seen[0]
    for i in range(first):
        raw_x[i], raw_y[i] = raw_x[first], raw_y[first]
    for i in range(1, len(raw_x)):
        if raw_x[i] is None:
            raw_x[i], raw_y[i] = raw_x[i - 1], raw_y[i - 1]

    # desired offsets of the crop so the face sits centred horizontally, `headroom` down
    vis_h = min(1.0, (cw / view_aspect) / ch) if view_aspect else 1.0     # visible fraction of the crop height
    face_row = cy0 + ch * (1.0 - vis_h) / 2.0 + ch * vis_h * headroom
    want_x = [fx - (cx0 + cw / 2.0) for fx in raw_x]
    want_y = [fy - face_row for fy in raw_y]
    alpha = max(0.05, min(0.6, 0.6 - 0.5 * float(smooth)))   # smooth 0.8 -> 0.2 per sample (~1 s settle)
    xs = camera_path(median_filter(want_x), DEAD_ZONE * cw, alpha)
    ys = camera_path(median_filter(want_y), DEAD_ZONE * ch, alpha)
    clamped = [clamp_offsets(x, y, crop, pad) for x, y in zip(xs, ys)]
    xs, ys = [c[0] for c in clamped], [c[1] for c in clamped]
    if max(map(abs, xs + ys), default=0.0) < MIN_MOTION_PX:
        return []
    return to_keyframes(times, xs, ys)


def crop_filter(crop: Tuple[int, int, int, int], kfs: Sequence[Keyframe]) -> str:
    """`crop=` filter for a (possibly) moving crop in layout space."""
    x, y, w, h = crop
    if not kfs:
        return f"crop={w}:{h}:{x}:{y}"
    xe = motion_expr(x, kfs, 1, 0, LAYOUT_W - w)
    ye = motion_expr(y, kfs, 2, 0, LAYOUT_H - h)
    return f"crop=w={w}:h={h}:x='{xe}':y='{ye}'"


class FaceTracker:
    """Legacy `dynamic_face_track` layout: one 9:16 crop over the full frame that follows the face."""

    def full_frame_crop(self, aspect_w: int = 9, aspect_h: int = 16) -> Tuple[int, int, int, int]:
        ch = LAYOUT_H
        cw = int(ch * aspect_w / aspect_h) // 2 * 2
        return ((LAYOUT_W - cw) // 2, 0, cw, ch)

    def track_full_frame(self, video_path: str, start: float, duration: float) -> Tuple[Tuple[int, int, int, int], List[Keyframe]]:
        crop = self.full_frame_crop()
        # whole-frame search: the pad covers the frame width from a centred 608 px crop
        kfs = track_crop(video_path, start, duration, crop, smooth=0.85, pad=1.2, headroom=0.4)
        return crop, kfs

    # Kept for callers that only need one stable window (server preview endpoint).
    def get_static_average_crop(self, video_path: str, *_a, **_k) -> Tuple[int, int, int, int]:
        crop, kfs = self.track_full_frame(video_path, 0.0, 30.0)
        if not kfs:
            return crop
        dx = sum(k[1] for k in kfs) / len(kfs)
        x = int(max(0, min(LAYOUT_W - crop[2], crop[0] + dx))) // 2 * 2
        return (x, crop[1], crop[2], crop[3])

    def analyze_video_crops(self, video_path: str, *_a, **_k) -> List[Tuple[int, int, int, int]]:
        crop, kfs = self.track_full_frame(video_path, 0.0, 60.0)
        if not kfs:
            return [crop]
        return [(int(max(0, min(LAYOUT_W - crop[2], crop[0] + k[1]))), crop[1], crop[2], crop[3]) for k in kfs]
