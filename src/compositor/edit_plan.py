"""Edit plan: every auto-edit decision of a clip, stored with the clip so it can be shown, undone
one by one, changed in the editor, or written by the AI director - and so a re-render repeats the
same edit instead of re-guessing it.

All times are in the clip's SOURCE time (its tightened source video, the same timeline as
adjusted_start / adjusted_end). Items carry an id, `on` (undo = off) and `by` (auto | ai | user).

{
  "version": 1, "style": "punchy", "by": "auto",
  "zoom_target": {"layer": "l_face", "name": "Facecam"} | null (whole frame),
  "zooms":    [{"id": "z1", "t": 4.1, "amount": 0.22, "on": true, "by": "auto"}],
  "emphasis": [{"id": "e1", "t": 6.3, "word": "NO", "on": true, "by": "auto"}],
  "sfx":      [{"id": "s1", "t": 4.08, "cat": "hit", "vol": 0.45, "on": true, "by": "auto", "file": "boom.wav"}],
  "cold_open": {"on": true, "start": 11.2, "end": 13.0, "by": "auto"},
  "hook": {"on": true, "text": "He did NOT see that coming"}
}
"""

from __future__ import annotations

import copy
import re
import statistics
from typing import Any, Dict, List, Optional, Sequence, Tuple

PLAN_VERSION = 1
SFX_CATEGORIES = ("whoosh", "swish", "hit", "pop", "ding", "rewind", "riser")

# Smooth punch: ease in 0.22 s, hold 0.5 s, ease out 0.45 s (smoothstep both ways)
ZOOM_IN, ZOOM_HOLD, ZOOM_OUT = 0.22, 0.5, 0.45
ZOOM_SPAN = ZOOM_IN + ZOOM_HOLD + ZOOM_OUT

COLD_OPEN_MIN_CLIP = 15.0      # shorter clips don't need a teaser
COLD_OPEN_BEFORE, COLD_OPEN_AFTER = 0.5, 1.3

_NUM = re.compile(r"\d")
SUPERLATIVES = {"never", "always", "biggest", "worst", "best", "insane", "crazy", "impossible", "literally",
                "million", "thousand", "hundred", "dollars", "free", "first", "last", "only", "dead", "killed",
                "won", "lost", "fired", "banned", "broke", "rich", "secret", "nobody", "everyone", "again"}


def _tok(w: Dict[str, Any]) -> str:
    return re.sub(r"[^a-z0-9']", "", (w.get("word") or w.get("text") or "").lower())


def _ids(prefix: str, items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for i, it in enumerate(items, start=1):
        it.setdefault("id", f"{prefix}{i}")
    return items


def emphasis_score(w: Dict[str, Any], is_hype) -> float:
    raw = (w.get("word") or w.get("text") or "").strip()
    tok = _tok(w)
    letters = re.sub(r"[^A-Za-z]", "", raw)
    s = 0.0
    if is_hype(w):
        s += 3
    if _NUM.search(raw) or "$" in raw:
        s += 2.5
    if tok in SUPERLATIVES:
        s += 2
    if len(letters) >= 3 and letters.isupper():
        s += 1.5
    if "!" in raw or "?" in raw:
        s += 0.5
    if len(tok) <= 2:
        s -= 3
    return s


def pick_emphasis(words: Sequence[Dict[str, Any]], dur: float, is_hype, min_gap: float = 1.4) -> List[Dict[str, Any]]:
    """Key words to show bigger / coloured: hype words, numbers & money, superlatives, shouted words.
    At most one every ~1.4 s and ~one per 4 s of clip, so it stays special."""
    cands = []
    for w in words or []:
        if w.get("censored"):
            continue
        sc = emphasis_score(w, is_hype)
        if sc >= 2:
            cands.append((sc, float(w["start"]), (w.get("word") or "").strip().strip(".,;:")))
    cands.sort(key=lambda c: (-c[0], c[1]))
    chosen: List[Tuple[float, str]] = []
    cap = max(1, int(dur / 4))
    for sc, t, word in cands:
        if any(abs(t - c[0]) < min_gap for c in chosen):
            continue
        chosen.append((t, word))
        if len(chosen) >= cap:
            break
    chosen.sort()
    return _ids("e", [{"t": round(t, 3), "word": word, "on": True, "by": "auto"} for t, word in chosen])


def pick_cold_open(punch_scores: Sequence[Tuple[float, float]], dur: float) -> Optional[Dict[str, Any]]:
    """The payoff to show first: the strongest moment in the back 2/3 of a 15 s+ clip."""
    if dur < COLD_OPEN_MIN_CLIP:
        return None
    late = [(t, s) for t, s in punch_scores if dur * 0.35 <= t <= dur - 1.5]
    if not late:
        return None
    t = max(late, key=lambda x: x[1])[0]
    a, b = max(0.0, t - COLD_OPEN_BEFORE), min(dur - 0.2, t + COLD_OPEN_AFTER)
    return {"on": True, "start": round(a, 3), "end": round(b, 3), "by": "auto"} if b - a >= 1.0 else None


def build_plan(cfg: Dict[str, Any], words: Sequence[Dict[str, Any]], dur: float, punches: Sequence[float],
               punch_scores: Sequence[Tuple[float, float]], cut_times: Sequence[float], zoom_target: Optional[Dict[str, str]],
               hook_text: Optional[str], is_hype) -> Dict[str, Any]:
    """The automatic plan (times in the given words' / punches' timeline)."""
    amount = float(cfg.get("box_zoom_amount", cfg.get("zoom_amount", 0.14)) if zoom_target else cfg.get("zoom_amount", 0.14))
    zooms = _ids("z", [{"t": round(p, 3), "amount": round(amount, 3), "on": True, "by": "auto"} for p in punches])
    emphasis = pick_emphasis(words, dur, is_hype) if cfg.get("word_pop") else []
    sfx: List[Dict[str, Any]] = []
    if cfg.get("sfx"):
        for i, z in enumerate(zooms):
            sfx.append({"t": round(max(0.0, z["t"] - 0.02), 3), "cat": "hit" if i == 0 else "pop",
                        "vol": 0.45 if i == 0 else 0.3, "on": True, "by": "auto"})
        if cfg.get("sfx_cuts"):
            for t in [t for t in cut_times if t > 0.4][:6]:
                if all(abs(t - s["t"]) >= 0.8 for s in sfx):
                    sfx.append({"t": round(max(0.0, t - 0.08), 3), "cat": "swish", "vol": 0.16, "on": True, "by": "auto"})
        if cfg.get("sfx_words"):
            for e in [e for e in emphasis if e["t"] >= 2.5][:3]:      # not under the hook card
                if all(abs(e["t"] - s["t"]) >= 1.2 for s in sfx):
                    sfx.append({"t": e["t"], "cat": "ding", "vol": 0.22, "on": True, "by": "auto"})
    sfx.sort(key=lambda s: s["t"])
    cold = pick_cold_open(punch_scores, dur) if cfg.get("cold_open") else None
    return {
        "version": PLAN_VERSION, "style": cfg.get("style"), "by": "auto",
        "zoom_target": zoom_target,
        "zooms": zooms, "emphasis": emphasis, "sfx": _ids("s", sfx),
        "cold_open": cold or {"on": False},
        "hook": {"on": bool(cfg.get("hook_card") and hook_text and hook_text.strip()), "text": (hook_text or "").strip()},
    }


def shift(plan: Dict[str, Any], delta: float) -> Dict[str, Any]:
    """Same plan with every time moved by delta (to/from a render window)."""
    p = copy.deepcopy(plan)
    for key in ("zooms", "emphasis", "sfx"):
        for it in p.get(key) or []:
            it["t"] = round(float(it["t"]) + delta, 3)
    co = p.get("cold_open") or {}
    if co.get("start") is not None:
        co["start"] = round(float(co["start"]) + delta, 3)
        co["end"] = round(float(co["end"]) + delta, 3)
    return p


def window(plan: Dict[str, Any], start: float, end: float) -> Dict[str, Any]:
    """The plan inside [start, end], re-timed to start at 0. Items outside are dropped from this
    render only (the stored plan keeps them)."""
    p = shift(plan, -start)
    dur = end - start
    for key in ("zooms", "emphasis", "sfx"):
        p[key] = [it for it in p.get(key) or [] if 0 <= it["t"] <= dur]
    co = p.get("cold_open") or {}
    if co.get("on") and not (0 <= co.get("start", -1) and co.get("end", dur + 1) <= dur):
        p["cold_open"] = {**co, "on": False, "outside": True}
    return p


def zoom_expression(zooms: Sequence[Dict[str, Any]], hook_snap: bool = False, var: str = "it") -> Optional[str]:
    """zoompan z(t): smooth punch-ins (smoothstep ease in / hold / ease out) for the enabled zooms."""
    terms = []
    for z in zooms:
        if not z.get("on", True):
            continue
        a, amt = float(z["t"]), float(z.get("amount", 0.14))
        b = a + ZOOM_SPAN
        u = f"clip(({var}-{a:.3f})/{ZOOM_IN},0,1)"
        v = f"clip(({b:.3f}-{var})/{ZOOM_OUT},0,1)"
        terms.append(f"{amt:.3f}*{u}*{u}*(3-2*{u})*{v}*{v}*(3-2*{v})")
    if hook_snap:
        terms.append(f"0.06*clip((0.6-{var})/0.6,0,1)")
    return "1+" + "+".join(terms) if terms else None


def summary(plan: Dict[str, Any]) -> Dict[str, int]:
    on = lambda key: sum(1 for it in plan.get(key) or [] if it.get("on", True))
    return {"zooms": on("zooms"), "emphasis": on("emphasis"), "sfx": on("sfx"),
            "cold_open": bool((plan.get("cold_open") or {}).get("on")), "hook": bool((plan.get("hook") or {}).get("on"))}


def validate(plan: Any, dur: Optional[float] = None) -> Dict[str, Any]:
    """Clean a plan that came from the editor or the AI: known keys, sane numbers, unique ids."""
    if not isinstance(plan, dict):
        raise ValueError("edit plan must be an object")
    out: Dict[str, Any] = {"version": PLAN_VERSION, "style": plan.get("style"), "by": plan.get("by") or "user",
                           "zoom_target": plan.get("zoom_target") if isinstance(plan.get("zoom_target"), dict) else None}
    limit = (lambda t: 0 <= t <= dur) if dur else (lambda t: t >= 0)

    def items(key, fields):
        res = []
        for it in plan.get(key) or []:
            if not isinstance(it, dict):
                continue
            try:
                t = round(float(it["t"]), 3)
            except (KeyError, TypeError, ValueError):
                continue
            if not limit(t):
                continue
            clean = {"t": t, "on": bool(it.get("on", True)), "by": str(it.get("by") or "user")[:8]}
            if it.get("id"):
                clean["id"] = str(it["id"])[:16]
            clean.update(fields(it))
            res.append(clean)
        res.sort(key=lambda x: x["t"])
        seen = set()
        for i, r in enumerate(res, start=1):
            if r.get("id") in seen or not r.get("id"):
                r["id"] = f"{key[0]}{i}_{int(r['t'] * 1000)}"
            seen.add(r["id"])
        return res

    out["zooms"] = items("zooms", lambda it: {"amount": round(min(0.6, max(0.02, float(it.get("amount", 0.18)))), 3)})
    out["emphasis"] = items("emphasis", lambda it: {"word": str(it.get("word") or "")[:40]})
    out["sfx"] = items("sfx", lambda it: {
        "cat": it.get("cat") if it.get("cat") in SFX_CATEGORIES else "pop",
        "vol": round(min(1.0, max(0.02, float(it.get("vol", 0.3)))), 2),
        **({"file": str(it["file"])[:80]} if it.get("file") else {})})
    co = plan.get("cold_open") or {}
    if co.get("on") and co.get("start") is not None and co.get("end") is not None:
        a, b = round(float(co["start"]), 3), round(float(co["end"]), 3)
        ok = 0 <= a < b and (b - a) <= 6 and (not dur or b <= dur)
        out["cold_open"] = {"on": ok, "start": a, "end": b, "by": str(co.get("by") or "user")[:8]}
    else:
        out["cold_open"] = {"on": False}
    hook = plan.get("hook") or {}
    out["hook"] = {"on": bool(hook.get("on")), "text": str(hook.get("text") or "")[:120]}
    if plan.get("caption_fix_off"):
        out["caption_fix_off"] = True              # user chose the template height: don't move captions again
    try:
        cy = plan.get("caption_y")
        if cy is not None and 0.15 <= float(cy) <= 0.92:
            out["caption_y"] = round(float(cy), 3)
    except (TypeError, ValueError):
        pass
    return out


def median_level(energy: Sequence[Tuple[float, float]]) -> float:
    lv = [v for _, v in energy if v > -80]
    return statistics.median(lv) if lv else -40.0
