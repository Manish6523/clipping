"""AI edit director: Gemini reads a clip's transcript + loud moments and writes its edit plan -
where to zoom (and how hard), which words to emphasise, extra sound cues, whether to open cold on
the payoff, and the hook line. Everything it says is checked against the clip before use; any
failure means the automatic plan is used unchanged.

Plug-in for compositor.auto_edit.auto_edit_clip(director=...): it receives the automatic plan
(times in the render's local timeline) and returns the plan to use.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any, Dict, List, Literal, Optional, Sequence, Tuple

from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

SETTING_KEY = "auto_edit_ai_director"
TIMEOUT_S = 45
STRENGTH = {"subtle": 0.1, "medium": 0.18, "strong": 0.25}
FRAME_FACTOR = 0.6                    # whole-frame zooms read stronger than a small box
SOUND_VOL = {"hit": 0.45, "pop": 0.3, "ding": 0.22, "whoosh": 0.3, "riser": 0.3}
MIN_ZOOM_GAP = 2.2


class DZoom(BaseModel):
    t: float = Field(..., description="Seconds into the clip where the punch-in starts")
    strength: Literal["subtle", "medium", "strong"] = "medium"
    reason: str = Field("", description="Very short reason")


class DSound(BaseModel):
    t: float
    type: Literal["hit", "pop", "ding", "whoosh", "riser"]


class DColdOpen(BaseModel):
    use: bool = False
    start: float = 0.0
    end: float = 0.0


class DirectorPlan(BaseModel):
    zooms: List[DZoom] = Field(default_factory=list)
    emphasis_word_indexes: List[int] = Field(default_factory=list, description="Indexes [n] of key words to show bigger")
    sounds: List[DSound] = Field(default_factory=list, description="Extra sound cues (zoom hits are added automatically)")
    cold_open: DColdOpen = Field(default_factory=DColdOpen)
    hook: str = Field("", description="Hook title shown in the first 2 s, max 8 words, no emoji")
    notes: str = ""


SYSTEM = (
    "You are a short-form video editor for livestream clips (YouTube Shorts / TikTok). You decide where the "
    "camera punches in, which words to pop on screen, light sound design, and the hook. Be selective: edits "
    "must land on real beats (a reaction, a punchline, a shout), never on filler. Fewer, better edits beat many. "
    "No emoji anywhere."
)


def transcript_lines(words: Sequence[Dict[str, Any]], max_words: int = 900) -> str:
    """'[12] 4.32 word' lines, one per word (index = the number the model refers to)."""
    out = []
    for i, w in enumerate(words[:max_words]):
        out.append(f"[{i}] {float(w['start']):.2f} {(w.get('word') or '').strip()}")
    return "\n".join(out)


def build_prompt(words, dur: float, moments: Sequence[Tuple[float, float]], zoom_what: str, hook: Optional[str]) -> str:
    loud = ", ".join(f"{t:.1f}s" for t, _ in sorted(moments, key=lambda m: -m[1])[:12]) or "none found"
    return f"""Clip length: {dur:.1f} s. The zoom punches into {zoom_what}.
Loudest / most sudden moments (from the audio): {loud}

Transcript, one word per line as [index] start_seconds word:
{transcript_lines(words)}

Decide:
- zooms: at most {max(1, int(dur / 4.5))}, at least {MIN_ZOOM_GAP:.1f} s apart, none before 2.2 s or in the last 1 s. Put each on the exact
  start of the beat (reaction, punchline, shout). strength: subtle | medium | strong (strong only for the biggest moment).
- emphasis_word_indexes: at most {max(1, int(dur / 4))} key words (names, numbers, money, the punchline word, shouted words). Never filler.
- sounds: optional extra cues (ding on a key word, riser before a payoff, whoosh on a scene change). At most 3. Do not add sounds for zooms.
- cold_open: use only if there is a clear payoff in the later part that makes a viewer stay; start/end = 1.0-2.5 s around it.
- hook: a short curiosity line for the first 2 s (max 8 words, no emoji){f'. Current hook: "{hook}"' if hook else ''}."""


def _apply(auto: Dict[str, Any], ai: DirectorPlan, words: Sequence[Dict[str, Any]], dur: float, cfg: Dict[str, Any]) -> Dict[str, Any]:
    """Validated merge of the model's plan into the automatic plan's shape (items by='ai')."""
    from src.compositor.auto_edit import _is_hype_word  # noqa: F401 - same rules as auto
    plan = {**auto, "by": "ai"}
    box = bool(auto.get("zoom_target"))
    # zooms
    zooms: List[Dict[str, Any]] = []
    for z in sorted(ai.zooms, key=lambda z: z.t):
        t = round(float(z.t), 3)
        if t < 2.2 or t > dur - 1.0 or any(abs(t - x["t"]) < MIN_ZOOM_GAP for x in zooms):
            continue
        amt = STRENGTH.get(z.strength, 0.18) * (1.0 if box else FRAME_FACTOR)
        zooms.append({"id": f"z{len(zooms) + 1}", "t": t, "amount": round(amt, 3), "on": True, "by": "ai"})
        if len(zooms) >= max(1, int(dur / 4.5)):
            break
    if ai.zooms and not zooms:
        zooms = auto.get("zooms") or []                        # nothing usable: keep the automatic zooms
    plan["zooms"] = zooms
    # emphasis
    emph: List[Dict[str, Any]] = []
    for i in sorted(set(ai.emphasis_word_indexes)):
        if not 0 <= i < len(words):
            continue
        w = words[i]
        word = (w.get("word") or "").strip()
        if w.get("censored") or len(word.strip(".,!?'\"")) < 2:
            continue
        t = round(float(w["start"]), 3)
        if any(abs(t - e["t"]) < 1.0 for e in emph):
            continue
        emph.append({"id": f"e{len(emph) + 1}", "t": t, "word": word, "on": True, "by": "ai"})
        if len(emph) >= max(1, int(dur / 4)):
            break
    plan["emphasis"] = emph if (emph or not cfg.get("word_pop")) else (auto.get("emphasis") or [])
    # sounds: zoom hits follow the zooms, jump-cut swishes are kept, + the model's cues
    sfx: List[Dict[str, Any]] = []
    if cfg.get("sfx"):
        for i, z in enumerate(zooms):
            sfx.append({"t": round(max(0.0, z["t"] - 0.02), 3), "cat": "hit" if i == 0 else "pop",
                        "vol": 0.45 if i == 0 else 0.3, "on": True, "by": "ai"})
        sfx += [dict(s) for s in auto.get("sfx") or [] if s.get("cat") == "swish"]
        for s in ai.sounds[:3]:
            t = round(float(s.t), 3)
            if 0 <= t <= dur - 0.3 and all(abs(t - x["t"]) >= 0.6 for x in sfx):
                sfx.append({"t": t, "cat": s.type, "vol": SOUND_VOL.get(s.type, 0.3), "on": True, "by": "ai"})
    sfx.sort(key=lambda s: s["t"])
    for i, s in enumerate(sfx, start=1):
        s["id"] = f"s{i}"
    plan["sfx"] = sfx
    # cold open
    co = ai.cold_open
    a, b = round(float(co.start), 3), round(float(co.end), 3)
    if cfg.get("cold_open") and co.use and dur >= 12 and dur * 0.3 <= a < b <= dur - 0.2 and 1.0 <= b - a <= 2.6:
        plan["cold_open"] = {"on": True, "start": a, "end": b, "by": "ai"}
    elif cfg.get("cold_open") and not co.use:
        plan["cold_open"] = {"on": False}
    # hook
    hook = " ".join((ai.hook or "").split())
    if hook and len(hook) <= 70 and len(hook.split()) <= 9 and (auto.get("hook") or {}).get("on") is not None:
        plan["hook"] = {"on": bool((auto.get("hook") or {}).get("on") or cfg.get("hook_card")), "text": hook}
    plan["director_notes"] = (ai.notes or "")[:300]
    return plan


async def enabled() -> bool:
    try:
        from src.database import get_system_setting, has_available_ai_quota
        val = (await get_system_setting(SETTING_KEY, "true") or "true").lower()
        return val in ("true", "1", "yes") and await has_available_ai_quota()
    except Exception:
        return False


async def direct(auto: Dict[str, Any], words: Sequence[Dict[str, Any]], dur: float,
                 energy: Sequence[Tuple[float, float]], cfg: Dict[str, Any], hook: Optional[str]) -> Optional[Dict[str, Any]]:
    """The AI plan, or None (caller keeps the automatic plan)."""
    if not words or dur < 5:
        return None
    from src.compositor.auto_edit import moment_scores
    from src.intelligence.llm.client import GeminiClient
    from config.settings import GEMINI_API_KEY
    target = auto.get("zoom_target") or {}
    prompt = build_prompt(words, dur, moment_scores(words, energy), f"the {target.get('name', 'facecam')} box" if target else "the whole frame", hook)
    client = GeminiClient(api_key=GEMINI_API_KEY)
    res = await asyncio.wait_for(client.generate_structured(system_instruction=SYSTEM, user_prompt=prompt,
                                                            response_model=DirectorPlan), TIMEOUT_S)
    if not res:
        return None
    plan = _apply(auto, res, words, dur, cfg)
    logger.info("AI edit director: %d zooms, %d words, %d sounds, cold open %s (%s)", len(plan["zooms"]),
                len(plan["emphasis"]), len(plan["sfx"]), plan["cold_open"].get("on"), plan.get("director_notes", "")[:80])
    return plan
