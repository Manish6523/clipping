"""Caption style presets (Quick Clip picker + swipe "Change caption style").

A style only changes how the words look - font, colours, outline, animation, words on screen.
The template keeps deciding the layout and where the captions sit.

Fonts are bundled in assets/fonts (SIL OFL / Apache 2.0) and passed to libass with
``fontsdir`` so the VPS renders the same as a desktop that happens to have them installed.
Mirrors frontend/src/lib/captionStyles.js (preview) - keep the ids in sync.
"""

from __future__ import annotations

import copy
from pathlib import Path
from typing import Any, Dict, List, Optional

FONTS_DIR = Path(__file__).resolve().parent.parent.parent / "assets" / "fonts"
DEFAULT_STYLE = "template"

# mode: highlight = active word recoloured | progressive = spoken words stay coloured (karaoke)
#       box = coloured box behind the active word | glow = neon halo
STYLES: Dict[str, Dict[str, Any]] = {
    "bold_pop": {
        "label": "Bold Pop", "hint": "Big uppercase, yellow active word (Hormozi look)",
        "font_name": "Montserrat Black", "font_size": 82, "primary_color": "#FFFFFF", "highlight_color": "#FACC15",
        "outline_color": "#000000", "outline_width": 9, "shadow_blur": 3, "uppercase": True, "words_per_line": 3,
        "animation": "pop", "mode": "highlight",
    },
    "karaoke": {
        "label": "Karaoke", "hint": "Whole line; words fill green as they're spoken",
        "font_name": "Montserrat ExtraBold", "font_size": 64, "primary_color": "#FFFFFF", "highlight_color": "#4ADE80",
        "outline_color": "#000000", "outline_width": 7, "shadow_blur": 2, "uppercase": True, "words_per_line": 5,
        "animation": "none", "mode": "progressive",
    },
    "boxed": {
        "label": "Boxed", "hint": "Purple box slides behind the active word",
        "font_name": "Montserrat Black", "font_size": 76, "primary_color": "#FFFFFF", "highlight_color": "#FFFFFF",
        "outline_color": "#000000", "outline_width": 6, "shadow_blur": 2, "uppercase": True, "words_per_line": 3,
        "animation": "none", "mode": "box", "box_color": "#7C3AED",
    },
    "neon": {
        "label": "Neon Gaming", "hint": "Cyan glow, pink glow on the active word",
        "font_name": "Russo One", "font_size": 78, "primary_color": "#E0FFFF", "highlight_color": "#FFE4F3",
        "outline_color": "#05202A", "outline_width": 3, "shadow_blur": 0, "uppercase": True, "words_per_line": 3,
        "animation": "pop", "mode": "glow", "glow_color": "#22D3EE", "active_glow_color": "#EC4899",
    },
    "beast": {
        "label": "Beast", "hint": "Chunky comic font, green pop, hard shadow (MrBeast look)",
        "font_name": "Luckiest Guy", "font_size": 88, "primary_color": "#FFFFFF", "highlight_color": "#22C55E",
        "outline_color": "#000000", "outline_width": 8, "shadow_blur": 6, "shadow_color": "#000000",
        "uppercase": True, "words_per_line": 2, "animation": "bounce", "mode": "highlight",
    },
    "one_word": {
        "label": "One Word", "hint": "One huge word at a time - max energy",
        "font_name": "Anton", "font_size": 128, "primary_color": "#FFFFFF", "highlight_color": "#FFFFFF",
        "outline_color": "#000000", "outline_width": 9, "shadow_blur": 4, "uppercase": True, "words_per_line": 1,
        "animation": "pop", "mode": "highlight",
    },
    "comic": {
        "label": "Comic", "hint": "Yellow comic-book letters, red active word",
        "font_name": "Bangers", "font_size": 92, "primary_color": "#FDE047", "highlight_color": "#EF4444",
        "outline_color": "#000000", "outline_width": 7, "shadow_blur": 5, "uppercase": True, "words_per_line": 3,
        "animation": "bounce", "mode": "highlight", "spacing": 2,
    },
    "red_alert": {
        "label": "Red Alert", "hint": "White with a red box on the active word",
        "font_name": "Poppins ExtraBold", "font_size": 70, "primary_color": "#FFFFFF", "highlight_color": "#FFFFFF",
        "outline_color": "#000000", "outline_width": 6, "shadow_blur": 2, "uppercase": True, "words_per_line": 3,
        "animation": "pop", "mode": "box", "box_color": "#E11D48",
    },
    "clean": {
        "label": "Clean", "hint": "Sentence case, soft shadow - talk / IRL",
        "font_name": "Inter", "font_size": 54, "primary_color": "#FFFFFF", "highlight_color": "#FDE68A",
        "outline_color": "#000000", "outline_width": 2.5, "shadow_blur": 3, "shadow_color": "#99000000",
        "uppercase": False, "words_per_line": 6, "animation": "none", "mode": "highlight",
    },
    "cinematic": {
        "label": "Cinematic", "hint": "Tall condensed letters, calm - podcasts & stories",
        "font_name": "Bebas Neue", "font_size": 84, "primary_color": "#F5F5F4", "highlight_color": "#FFFFFF",
        "outline_color": "#000000", "outline_width": 3, "shadow_blur": 4, "uppercase": True, "words_per_line": 4,
        "animation": "fade", "mode": "progressive", "spacing": 4,
    },
    "marker": {
        "label": "Marker", "hint": "Hand-drawn marker, orange active word",
        "font_name": "Permanent Marker", "font_size": 72, "primary_color": "#FFFFFF", "highlight_color": "#FB923C",
        "outline_color": "#000000", "outline_width": 6, "shadow_blur": 3, "uppercase": False, "words_per_line": 3,
        "animation": "pop", "mode": "highlight",
    },
}

STYLE_KEYS = ("font_name", "font_size", "primary_color", "highlight_color", "outline_color", "outline_width",
              "shadow_blur", "shadow_color", "uppercase", "words_per_line", "animation", "mode", "box_color",
              "glow_color", "active_glow_color", "spacing")


def valid(style_id: Optional[str]) -> bool:
    return style_id in STYLES or style_id == DEFAULT_STYLE


def list_styles() -> List[Dict[str, Any]]:
    out = [{"id": DEFAULT_STYLE, "label": "Template default", "hint": "Whatever the template uses"}]
    out += [{"id": k, "label": v["label"], "hint": v["hint"], "font": v["font_name"]} for k, v in STYLES.items()]
    return out


def apply_caption_style(template: Dict[str, Any], style_id: Optional[str]) -> Dict[str, Any]:
    """A copy of ``template`` whose captions use ``style_id`` (position stays the template's)."""
    if not style_id or style_id not in STYLES:
        return template
    t = copy.deepcopy(template)
    key = "subtitles" if "subtitles" in t or "captions" not in t else "captions"
    sub = dict(t.get(key) or {})
    for k in ("font", "size", "color", "highlight", "font_weight", "max_words_per_screen", "animation_tag", "italic"):
        sub.pop(k, None)
    sub.update({k: v for k, v in STYLES[style_id].items() if k in STYLE_KEYS})
    sub["font_weight"] = "900"
    sub["caption_style"] = style_id
    t[key] = sub
    return t


def style_of(template: Dict[str, Any]) -> Optional[str]:
    """The caption style applied to a template by apply_caption_style (None = template's own)."""
    sub = template.get("subtitles") or template.get("captions") or {}
    sid = sub.get("caption_style")
    return sid if sid in STYLES else None


def fonts_dir_arg() -> str:
    """`:fontsdir=...` suffix for ffmpeg's subtitles filter (empty when fonts aren't bundled)."""
    if not FONTS_DIR.is_dir():
        return ""
    p = str(FONTS_DIR).replace("\\", "/").replace(":", "\\:").replace("'", "\\'")
    return f":fontsdir='{p}'"
