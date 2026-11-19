"""Quick Clip layout options, applied per clip on the downloaded section:

* auto template - read the clip (webcam overlay? camera-only IRL? gameplay only?) with the same
  analysis as Clip Lab's "Auto template" step, and use the matching layout. Captions, hook and
  pacing still come from the template the user picked.
* face tracking - layers that show the streamer's face follow it (the crop moves with the face).

Both are off unless the request asks for them.
"""

from __future__ import annotations

import asyncio
import copy
import logging
from typing import Any, Dict, Optional, Tuple

from src.compositor import auto_template as at

logger = logging.getLogger(__name__)

# layout kind -> the variant Quick Clip uses (see auto_template.build_variants)
PREFERRED_VARIANT = {"facecam": "stacked", "camera": "follow", "gameplay_only": "gameplay"}


def _v2_layout(template: Dict[str, Any]) -> Dict[str, Any]:
    layout = template.get("layout") or {}
    if layout.get("schema") == 2 or "layers" in layout:
        return layout
    from src.compositor.template_migration import migrate_layout_to_v2
    return migrate_layout_to_v2(template)


def set_tracking(template: Dict[str, Any], face: Optional[Dict[str, Any]], on: bool) -> Tuple[Dict[str, Any], int]:
    """Copy of template where the layers whose source area contains the face follow it (on=True),
    or where nothing follows a face (on=False). Returns (template, number of following layers)."""
    t = copy.deepcopy(template)
    layout = _v2_layout(t)
    t["layout"] = layout
    following = 0
    for layer in layout.get("layers", []):
        src = layer.get("src") or {}
        follow = False
        if on and face:
            fx, fy = face["cx"] / at.LW, face["cy"] / at.LH
            follow = (src.get("x", 0) <= fx <= src.get("x", 0) + src.get("w", 1)
                      and src.get("y", 0) <= fy <= src.get("y", 0) + src.get("h", 1))
        layer["tracking"] = {"smooth": 0.8, **(layer.get("tracking") or {}), "mode": "face" if follow else "off"}
        following += follow
    return t, following


async def find_face(src: str, dur: float, n: int = 12) -> Optional[Dict[str, Any]]:
    """The face that stays put across the clip (layout px), or None."""
    from src.compositor.face_tracker import _Detector
    import numpy as np

    frames = await asyncio.to_thread(at.sample_frames, src, dur, n)
    det = _Detector()
    if not frames or not det.available:
        return None

    def detect_all():
        return [[(cx * 2, cy * 2, w * 2, h * 2, c) for cx, cy, w, h, c in det.detect(np.ascontiguousarray(f))]
                for _, f in frames]
    return at.face_summary(await asyncio.to_thread(detect_all))


async def adapt(template: Dict[str, Any], src: str, dur: float, *, auto_template: bool = False,
                face_track: bool = False, use_gemini: bool = True) -> Tuple[Dict[str, Any], Optional[str]]:
    """The template to render this clip with, and a short note for the clip's flags (None = unchanged).
    Never raises: on any problem the clip keeps the user's template."""
    if not (auto_template or face_track):
        return template, None
    try:
        if auto_template:
            r = await at.analyse(src, dur, n=16, use_gemini=use_gemini)
            variants = at.build_variants(r["kind"], r["cam"], r["face"])
            want = PREFERRED_VARIANT.get(r["kind"], "gameplay")
            v = next((x for x in variants if x["id"] == want), variants[-1])
            t = at.make_template(template, v["layout"], template.get("name", "auto"),
                                 f"Auto layout ({v['title']}) on '{template.get('name')}'")
            if face_track:
                # the variant already marks its camera layer to follow the face
                n = sum(1 for l in t["layout"].get("layers", []) if (l.get("tracking") or {}).get("mode") == "face")
            else:
                t, n = set_tracking(t, None, False)
            note = f"Auto layout: {v['title']} (read as {r['kind'].replace('_', ' ')}, {r['confidence']} confidence)"
            if face_track:
                note += ", face tracking on" if n else ", no face to track"
            logger.info("Quick Clip %s", note)
            return t, note
        face = await find_face(src, dur)
        t, n = set_tracking(template, face, True)
        note = ("Face tracking on" if n else
                "Face tracking: no face found" if not face else "Face tracking: no layer of this template shows the face")
        logger.info("Quick Clip %s (template '%s').", note.lower(), template.get("name"))
        return t, note
    except Exception as e:
        logger.warning("Quick Clip layout options failed, keeping template '%s': %s", template.get("name"), e, exc_info=True)
        return template, None
