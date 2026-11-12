"""Profanity detection & censoring (audio bleep/mute/SFX + masked captions + titles).

Flow used by every render path:

    words, cfg = await prepare_censor(transcript_words, template)
    generate_ass_subtitles(words, ..., censor_cfg=cfg)          # masks caption text
    await renderer.render_clip(..., censor_words=words, censor_cfg=cfg,
                               words_time_offset=...)             # bleeps / mutes audio

Words get two extra keys:
    profanity: "slur" | "strong" | "mild" | None   (auto-detected tier)
    censored:  bool                                (final decision)

A word may also carry an explicit user override ``censor: true|false`` (set in the
editor's transcript panel); that always wins over auto-detection.
"""

from __future__ import annotations

import json
import logging
import re
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Sequence, Tuple

logger = logging.getLogger(__name__)

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
WORDLIST_PATH = PROJECT_ROOT / "config" / "profanity.json"
BUILTIN_SFX_DIR = PROJECT_ROOT / "assets" / "sfx"

SETTINGS_KEY = "censor_config"

AUDIO_MODES = ("off", "mute", "bleep", "sfx")
CAPTION_STYLES = ("none", "vowels", "middle", "first", "full", "grawlix")

DEFAULT_CENSOR_CONFIG: Dict[str, Any] = {
    "enabled": True,
    "audio_mode": "bleep",         # off | mute | bleep | sfx
    "caption_style": "vowels",     # none | vowels (F*CK) | middle (F**K) | first (F***) | full (****) | grawlix (#$@!)
    "censor_mild": False,          # also censor damn / hell / ass / crap ...
    "censor_titles": True,         # mask profanity in titles & descriptions
    "slur_action": "review",       # review = censor + flag clip for human review; censor = censor only
    "duck_volume": 0.05,           # original-audio level during a censored word (0 = full silence)
    "bleep_frequency": 1000,
    "bleep_volume": 0.35,
    "sfx_file": "boop.wav",        # file name inside assets/sfx or data/sfx, or an absolute path
    "sfx_volume": 0.9,
    "sfx_max_seconds": 1.5,
    "pad_before_ms": 60,           # Whisper word timings drift; widen each window slightly
    "pad_after_ms": 100,
    "highlight_censored": True,    # draw masked words in a separate color
    "censored_color": "#FF3B3B",
    "custom_words": [],            # extra words to always censor (strong tier)
    "allow_words": [],             # words that must never be censored
}

_TOKEN_STRIP_RE = re.compile(r"^[^a-z0-9*']+|[^a-z0-9*']+$")
_TITLE_WORD_RE = re.compile(r"[A-Za-z0-9*']+")
_VOWELS = set("aeiouAEIOU")


# ---------------------------------------------------------------------------
# Word lists
# ---------------------------------------------------------------------------

@lru_cache(maxsize=1)
def _load_wordlists() -> Dict[str, Any]:
    try:
        raw = json.loads(WORDLIST_PATH.read_text(encoding="utf-8"))
    except Exception as e:  # pragma: no cover - only hit with a broken install
        logger.error("Could not load profanity word list %s: %s", WORDLIST_PATH, e)
        raw = {}

    def compile_tier(patterns: Iterable[str]) -> Optional[re.Pattern]:
        pats = [p for p in patterns if p]
        if not pats:
            return None
        return re.compile(r"^(?:" + "|".join(f"(?:{p})" for p in pats) + r")$")

    return {
        "slur": compile_tier(raw.get("slur", [])),
        "strong": compile_tier(raw.get("strong", [])),
        "mild": compile_tier(raw.get("mild", [])),
        "allow": {w.lower() for w in raw.get("allow", [])},
    }


def normalize_token(text: str) -> str:
    """Lowercase and strip surrounding punctuation (keeps inner * and ')."""
    t = (text or "").strip().lower().replace("’", "'")
    return _TOKEN_STRIP_RE.sub("", t)


def classify_word(text: str, cfg: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """Return the profanity tier of a single word, or None if it is clean."""
    cfg = cfg or DEFAULT_CENSOR_CONFIG
    token = normalize_token(text)
    if not token:
        return None

    lists = _load_wordlists()
    allow = lists["allow"] | {normalize_token(w) for w in cfg.get("allow_words") or []}
    if token in allow:
        return None

    custom = {normalize_token(w) for w in cfg.get("custom_words") or [] if w}
    if token in custom:
        return "strong"

    for tier in ("slur", "strong", "mild"):
        rx = lists[tier]
        if rx is not None and rx.match(token):
            return tier
    return None


def _tier_is_censored(tier: Optional[str], cfg: Dict[str, Any]) -> bool:
    if tier in ("slur", "strong"):
        return True
    if tier == "mild":
        return bool(cfg.get("censor_mild"))
    return False


def annotate_words(words: Sequence[Dict[str, Any]], cfg: Optional[Dict[str, Any]] = None) -> List[Dict[str, Any]]:
    """Return copies of ``words`` with ``profanity`` and ``censored`` keys set."""
    cfg = cfg or DEFAULT_CENSOR_CONFIG
    enabled = bool(cfg.get("enabled", True))
    out: List[Dict[str, Any]] = []
    for w in words or []:
        item = dict(w)
        text = item.get("word") or item.get("text") or ""
        tier = classify_word(text, cfg)
        item["profanity"] = tier
        override = item.get("censor")
        if isinstance(override, bool):
            item["censored"] = override
        else:
            item["censored"] = enabled and _tier_is_censored(tier, cfg)
        out.append(item)
    return out


# ---------------------------------------------------------------------------
# Text masking (captions & titles)
# ---------------------------------------------------------------------------

def mask_word(text: str, style: str = "vowels") -> str:
    """Mask a single word, keeping surrounding punctuation. 'fucking!' -> 'f*ck*ng!'."""
    if not text or style == "none":
        return text
    m = re.match(r"^([^A-Za-z0-9]*)(.*?)([^A-Za-z0-9*]*)$", text, re.S)
    lead, core, trail = (m.group(1), m.group(2), m.group(3)) if m else ("", text, "")
    if not core:
        return text
    if "*" in core:  # already masked by the transcriber
        return text

    n = len(core)
    if style == "full":
        masked = "*" * n
    elif style == "grawlix":
        masked = ("#$@!" * ((n // 4) + 1))[:max(n, 4)]
    elif style == "first":
        masked = core[0] + "*" * (n - 1)
    elif style == "middle":
        masked = core if n <= 2 else core[0] + "*" * (n - 2) + core[-1]
    else:  # vowels
        chars = list(core)
        changed = False
        for i in range(1, n):
            if chars[i] in _VOWELS:
                chars[i] = "*"
                changed = True
        if not changed:  # e.g. "fck" -> fall back to middle style
            return lead + mask_word(core, "middle") + trail
        masked = "".join(chars)
    return lead + masked + trail


def censor_text(text: str, cfg: Optional[Dict[str, Any]] = None) -> str:
    """Mask profanity inside free text (titles, descriptions, captions)."""
    cfg = cfg or DEFAULT_CENSOR_CONFIG
    if not text or not cfg.get("enabled", True) or not cfg.get("censor_titles", True):
        return text
    style = cfg.get("caption_style") or "vowels"
    if style == "none":
        style = "vowels"

    def repl(m: re.Match) -> str:
        tok = m.group(0)
        tier = classify_word(tok, cfg)
        return mask_word(tok, style) if _tier_is_censored(tier, cfg) else tok

    return _TITLE_WORD_RE.sub(repl, text)


def display_word(word: Dict[str, Any], cfg: Optional[Dict[str, Any]]) -> str:
    text = word.get("word") or word.get("text") or ""
    if cfg and word.get("censored") and cfg.get("enabled", True):
        return mask_word(text.strip(), cfg.get("caption_style") or "vowels")
    return text


# ---------------------------------------------------------------------------
# Audio windows & FFmpeg graph
# ---------------------------------------------------------------------------

def compute_windows(
    words: Sequence[Dict[str, Any]],
    time_offset: float,
    duration: float,
    cfg: Optional[Dict[str, Any]] = None,
    merge_gap: float = 0.05,
) -> List[Tuple[float, float]]:
    """Censor windows in seconds relative to the render input (word.start - time_offset)."""
    cfg = cfg or DEFAULT_CENSOR_CONFIG
    pad_b = max(0.0, float(cfg.get("pad_before_ms", 60))) / 1000.0
    pad_a = max(0.0, float(cfg.get("pad_after_ms", 100))) / 1000.0

    raw: List[Tuple[float, float]] = []
    for w in words or []:
        if not w.get("censored") or w.get("deleted"):
            continue
        try:
            s = float(w.get("start", 0.0)) - time_offset - pad_b
            e = float(w.get("end", 0.0)) - time_offset + pad_a
        except (TypeError, ValueError):
            continue
        if e <= s:
            e = s + 0.25 + pad_b + pad_a
        s, e = max(0.0, s), min(float(duration), e)
        if e - s > 0.01:
            raw.append((s, e))

    raw.sort()
    merged: List[Tuple[float, float]] = []
    for s, e in raw:
        if merged and s <= merged[-1][1] + merge_gap:
            merged[-1] = (merged[-1][0], max(merged[-1][1], e))
        else:
            merged.append((s, e))
    return [(round(s, 3), round(e, 3)) for s, e in merged]


def resolve_sfx_path(cfg: Dict[str, Any]) -> Optional[Path]:
    name = (cfg.get("sfx_file") or "").strip()
    if not name:
        return None
    p = Path(name)
    candidates = [p] if p.is_absolute() else []
    try:
        from config.settings import DATA_DIR
        candidates.append(Path(DATA_DIR) / "sfx" / p.name)
    except Exception:
        pass
    candidates.append(BUILTIN_SFX_DIR / p.name)
    for c in candidates:
        if c.is_file():
            return c
    return None


def build_censor_audio_graph(
    windows: Sequence[Tuple[float, float]],
    cfg: Dict[str, Any],
    audio_in: str = "0:a",
    sfx_input_index: Optional[int] = None,
    tail_filters: Sequence[str] = (),
    out_label: str = "aout",
) -> Optional[str]:
    """Build an FFmpeg filter_complex fragment that censors ``windows`` of ``audio_in``.

    All times are in input time (before any atempo), so tail filters such as
    ``atempo=1.02`` are applied after the mix and keep everything in sync.
    Returns None when nothing needs to change.
    """
    mode = cfg.get("audio_mode", "bleep")
    if not windows or mode == "off" or not cfg.get("enabled", True):
        return None
    if mode == "sfx" and sfx_input_index is None:
        mode = "bleep"  # sfx file missing -> fall back to a bleep

    duck = min(max(float(cfg.get("duck_volume", 0.05)), 0.0), 1.0)
    enable_expr = "+".join(f"between(t,{s:.3f},{e:.3f})" for s, e in windows)

    parts: List[str] = [
        f"[{audio_in}]aresample=48000,aformat=channel_layouts=stereo,"
        f"volume=volume={duck:.3f}:enable='{enable_expr}'[cz_main]"
    ]
    mix_inputs = ["[cz_main]"]

    if mode == "bleep":
        freq = int(cfg.get("bleep_frequency", 1000))
        # FFmpeg's sine source peaks at 1/8 full scale, so scale up to make bleep_volume an absolute level.
        vol = float(cfg.get("bleep_volume", 0.35)) * 8.0
        for i, (s, e) in enumerate(windows):
            parts.append(
                f"sine=frequency={freq}:sample_rate=48000:duration={e - s:.3f},"
                f"afade=t=in:d=0.01,afade=t=out:st={max(0.0, e - s - 0.01):.3f}:d=0.01,"
                f"volume={vol:.3f},aformat=channel_layouts=stereo,adelay={int(round(s * 1000))}:all=1[cz_b{i}]"
            )
            mix_inputs.append(f"[cz_b{i}]")
    elif mode == "sfx":
        n = len(windows)
        vol = float(cfg.get("sfx_volume", 0.9))
        max_len = float(cfg.get("sfx_max_seconds", 1.5))
        split_labels = "".join(f"[cz_sraw{i}]" for i in range(n))
        sfx_head = f"[{sfx_input_index}:a]aresample=48000,aformat=channel_layouts=stereo"
        parts.append(f"{sfx_head},asplit={n}{split_labels}" if n > 1 else f"{sfx_head}[cz_sraw0]")
        for i, (s, _e) in enumerate(windows):
            parts.append(
                f"[cz_sraw{i}]atrim=0:{max_len:.3f},asetpts=PTS-STARTPTS,"
                f"volume={vol:.3f},adelay={int(round(s * 1000))}:all=1[cz_s{i}]"
            )
            mix_inputs.append(f"[cz_s{i}]")

    tail = ",".join(tail_filters)
    if len(mix_inputs) > 1:
        mix = (
            f"{''.join(mix_inputs)}amix=inputs={len(mix_inputs)}:normalize=0:"
            f"duration=first:dropout_transition=0"
        )
        parts.append(f"{mix},{tail}[{out_label}]" if tail else f"{mix}[{out_label}]")
    else:
        parts.append(f"[cz_main]{tail}[{out_label}]" if tail else f"[cz_main]anull[{out_label}]")
    return ";".join(parts)


# ---------------------------------------------------------------------------
# Config & summaries
# ---------------------------------------------------------------------------

def merge_config(*layers: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    cfg = dict(DEFAULT_CENSOR_CONFIG)
    for layer in layers:
        if isinstance(layer, dict):
            cfg.update({k: v for k, v in layer.items() if v is not None})
    if cfg.get("audio_mode") not in AUDIO_MODES:
        cfg["audio_mode"] = DEFAULT_CENSOR_CONFIG["audio_mode"]
    if cfg.get("caption_style") not in CAPTION_STYLES:
        cfg["caption_style"] = DEFAULT_CENSOR_CONFIG["caption_style"]
    return cfg


async def load_global_config() -> Dict[str, Any]:
    """Global censor settings stored in system_settings (editable from the Settings page)."""
    try:
        from src.database import get_system_setting
        raw = await get_system_setting(SETTINGS_KEY)
        return json.loads(raw) if raw else {}
    except Exception as e:
        logger.debug("Censor settings unavailable, using defaults: %s", e)
        return {}


async def load_censor_config(template: Optional[Dict[str, Any]] = None) -> Dict[str, Any]:
    """Defaults <- global Settings page values <- per-template ``censor`` overrides."""
    global_cfg = await load_global_config()
    tpl_cfg = (template or {}).get("censor") if isinstance(template, dict) else None
    return merge_config(global_cfg, tpl_cfg)


async def prepare_censor(
    words: Sequence[Dict[str, Any]],
    template: Optional[Dict[str, Any]] = None,
) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    cfg = await load_censor_config(template)
    return annotate_words(words, cfg), cfg


def summarize(
    words: Sequence[Dict[str, Any]],
    time_offset: float = 0.0,
    duration: Optional[float] = None,
) -> Dict[str, Any]:
    """Count censored words inside the clip range."""
    censored = 0
    slurs = 0
    detected = 0
    for w in words or []:
        if w.get("deleted"):
            continue
        rel = float(w.get("start", 0.0)) - time_offset
        if rel < -0.5 or (duration is not None and rel > duration):
            continue
        if w.get("profanity"):
            detected += 1
        if w.get("censored"):
            censored += 1
            if w.get("profanity") == "slur":
                slurs += 1
    return {"censored": censored, "slurs": slurs, "detected": detected}


def merge_flags(existing_json: Optional[str], summary: Dict[str, Any], cfg: Dict[str, Any]) -> Optional[str]:
    """Add profanity flags to a clip's JSON flags list."""
    try:
        flags = json.loads(existing_json) if existing_json else []
        if not isinstance(flags, list):
            flags = []
    except Exception:
        flags = []
    flags = [f for f in flags if not (isinstance(f, dict) and f.get("type") in ("profanity_censored", "slur_detected"))]
    if summary.get("censored"):
        flags.append({
            "type": "profanity_censored",
            "severity": "low",
            "count": summary["censored"],
            "note": f"{summary['censored']} word(s) censored ({cfg.get('audio_mode')})",
        })
    if summary.get("slurs") and cfg.get("slur_action", "review") == "review":
        flags.append({
            "type": "slur_detected",
            "severity": "high",
            "count": summary["slurs"],
            "note": "Slur detected and censored - review before posting",
        })
    return json.dumps(flags) if flags else existing_json
