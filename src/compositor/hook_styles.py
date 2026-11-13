"""Hook title card styles (the big title in the first ~2.4 s of an auto-edited clip).

Rendered entirely in ASS so it goes through the same libass pass as the captions:
boxes, pills, banners, bubble tails and badges are vector drawings (\\p1) sized by
measuring the text with the bundled font files, gradients are clipped colour strips.
Mirrors frontend/src/lib/hookStyles.js (preview) - keep the ids in sync.
"""

from __future__ import annotations

import logging
import re
import struct
from functools import lru_cache
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.compositor.caption_styles import FONTS_DIR

logger = logging.getLogger(__name__)

DEFAULT_HOOK_STYLE = "classic"

FONT_FILES = {
    "Montserrat Black": "Montserrat-Black.ttf",
    "Montserrat ExtraBold": "Montserrat-ExtraBold.ttf",
    "Anton": "anton-400.ttf",
    "Bangers": "bangers-400.ttf",
    "Bebas Neue": "bebas-neue-400.ttf",
    "Inter": "inter-700.ttf",
    "Poppins ExtraBold": "poppins-800.ttf",
    "Russo One": "russo-one-400.ttf",
    "Luckiest Guy": "luckiest-guy-400.ttf",
    "Permanent Marker": "permanent-marker-400.ttf",
}

# Sizes are in the 1080x1920 video space.
HOOK_STYLES: Dict[str, Dict[str, Any]] = {
    "classic": {"label": "Classic", "hint": "Big outlined uppercase, yellow key word",
                "font": "Montserrat Black", "size": 108, "color": "#FFFFFF", "key_color": "#FACC15",
                "outline": 7, "shadow": 3, "upper": True},
    "tiktok": {"label": "TikTok Box", "hint": "White rounded boxes, black text",
               "font": "Inter", "size": 81, "color": "#111111", "upper": False,
               "bg": "line", "bg_color": "#FFFFFF", "radius": 30, "pad": (38, 16), "line_gap": 2},
    "dark": {"label": "Dark Box", "hint": "Dark card, blue key word",
             "font": "Montserrat ExtraBold", "size": 84, "color": "#FFFFFF", "key_color": "#38BDF8", "upper": False,
             "bg": "block", "bg_color": "#0A0A0E", "bg_alpha": 0.82, "radius": 54, "pad": (68, 46)},
    "red_banner": {"label": "Red Banner", "hint": "Tilted red banner, hard shadow",
                   "font": "Anton", "size": 135, "color": "#FFFFFF", "upper": True,
                   "bg": "block", "bg_color": "#E11D48", "radius": 0, "pad": (68, 30), "bg_shadow": 24, "rotate": 3},
    "highlighter": {"label": "Highlighter", "hint": "White strips, yellow key word",
                    "font": "Montserrat Black", "size": 100, "color": "#111111", "upper": True,
                    "bg": "line", "bg_color": "#FFFFFF", "radius": 0, "pad": (32, 11), "line_gap": 16,
                    "key_bg": "#FDE047"},
    "breaking": {"label": "Breaking News", "hint": "Red BREAKING tag + headline bar",
                 "font": "Poppins ExtraBold", "size": 86, "color": "#FFFFFF", "upper": False, "align": "left",
                 "bg": "block", "bg_color": "#000000", "bg_alpha": 0.85, "radius": 0, "pad": (54, 35),
                 "stripe": ("#DC2626", 18), "max_width": 860,
                 "tag": {"text": "BREAKING", "font": "Montserrat Black", "size": 59, "color": "#FFFFFF",
                         "bg": "#DC2626", "pad": (35, 14), "where": "left"}},
    "bubble": {"label": "Speech Bubble", "hint": "Comic bubble quoting the best line",
               "font": "Bangers", "size": 130, "color": "#111111", "key_color": "#E11D48", "upper": True,
               "spacing": 2, "quote": True, "bg": "block", "bg_color": "#FFFFFF", "radius": 94, "pad": (76, 40),
               "bg_border": (10, "#000000"), "bg_shadow": 19, "tail": True},
    "neon": {"label": "Neon Sign", "hint": "Pink + cyan glow",
             "font": "Russo One", "size": 124, "color": "#FFE4F3", "key_color": "#E0FFFF", "upper": True,
             "outline": 3, "outline_color": "#1A0510", "glow": ("#EC4899", "#22D3EE")},
    "pill": {"label": "Gradient Pill", "hint": "Purple-pink pill, white text",
             "font": "Poppins ExtraBold", "size": 84, "color": "#FFFFFF", "upper": False,
             "bg": "block", "gradient": ("#7C3AED", "#EC4899"), "radius": 999, "pad": (86, 38)},
    "pov": {"label": "POV", "hint": "Yellow POV tag + hand-written line",
            "font": "Permanent Marker", "size": 108, "color": "#FFFFFF", "upper": False,
            "outline": 3, "shadow": 6,
            "tag": {"text": "POV:", "font": "Montserrat Black", "size": 62, "color": "#111111",
                    "bg": "#FACC15", "pad": (38, 14), "where": "center", "rotate": 2}},
    "cinematic": {"label": "Cinematic", "hint": "Tall spaced title with an underline",
                  "font": "Bebas Neue", "size": 176, "color": "#FFFFFF", "upper": True, "spacing": 10,
                  "outline": 2, "shadow": 6, "underline": ("#FACC15", 170, 9)},
    "question": {"label": "Question", "hint": "Yellow card with a ? badge",
                 "font": "Montserrat Black", "size": 94, "color": "#111111", "upper": True,
                 "bg": "block", "bg_color": "#FACC15", "radius": 54, "pad": (65, 40),
                 "bg_border": (10, "#111111"), "badge": True},
}


def valid(style_id: Optional[str]) -> bool:
    return style_id in HOOK_STYLES


def list_styles() -> List[Dict[str, Any]]:
    return [{"id": k, "label": v["label"], "hint": v["hint"], "font": v["font"]} for k, v in HOOK_STYLES.items()]


# ---------------------------------------------------------------------------
# Text measurement (libass-compatible)
# ---------------------------------------------------------------------------

@lru_cache(maxsize=32)
def _em_scale(font_file: str) -> float:
    """libass sizes a font so usWinAscent+usWinDescent == font size; return em_px / size."""
    data = Path(font_file).read_bytes()
    num_tables = struct.unpack(">H", data[4:6])[0]
    tables = {}
    for i in range(num_tables):
        rec = data[12 + 16 * i: 28 + 16 * i]
        tables[rec[:4].decode("latin-1")] = struct.unpack(">I", rec[8:12])[0]
    upem = struct.unpack(">H", data[tables["head"] + 18: tables["head"] + 20])[0]
    os2 = tables.get("OS/2")
    if os2 is not None:
        win_asc, win_desc = struct.unpack(">HH", data[os2 + 74: os2 + 78])
        total = win_asc + win_desc
    else:
        hhea = tables["hhea"]
        asc, desc = struct.unpack(">hh", data[hhea + 4: hhea + 8])
        total = asc - desc
    return upem / total if total else 1.0


@lru_cache(maxsize=32)
def _pil_font(font_file: str, px: int):
    from PIL import ImageFont
    return ImageFont.truetype(font_file, px)


def text_width(text: str, font: str, size: float, spacing: float = 0.0) -> float:
    path = FONTS_DIR / FONT_FILES.get(font, "Montserrat-Black.ttf")
    try:
        em = max(4, int(round(size * _em_scale(str(path)))))
        w = _pil_font(str(path), em).getlength(text)
    except Exception:
        w = len(text) * size * 0.55
    return w + spacing * max(0, len(text) - 1)


def wrap(text: str, font: str, size: float, max_width: float, spacing: float = 0.0, max_lines: int = 3) -> List[str]:
    words = [w for w in re.sub(r"\s+", " ", text or "").strip().split(" ") if w]
    lines: List[str] = []
    cur = ""
    for w in words:
        trial = f"{cur} {w}" if cur else w
        if cur and text_width(trial, font, size, spacing) > max_width:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    if len(lines) > max_lines:
        lines = lines[:max_lines]
        lines[-1] = lines[-1].rstrip(".,!?") + "…"
    return lines


# ---------------------------------------------------------------------------
# ASS helpers
# ---------------------------------------------------------------------------

def _c(hex_color: str) -> str:
    s = hex_color.lstrip("#")
    return f"&H{s[4:6]}{s[2:4]}{s[0:2]}&".upper()


def _a(alpha: float) -> str:
    """Opacity 0..1 -> ASS alpha (00 = opaque)."""
    return f"&H{int(round((1 - max(0.0, min(1.0, alpha))) * 255)):02X}&"


def _esc(text: str) -> str:
    return text.replace("\\", "").replace("{", "(").replace("}", ")")


def _rrect(w: float, h: float, r: float, x0: float = 0.0, y0: float = 0.0) -> str:
    r = max(0.0, min(r, w / 2, h / 2))
    if r < 0.5:
        return f"m {x0:.0f} {y0:.0f} l {x0 + w:.0f} {y0:.0f} {x0 + w:.0f} {y0 + h:.0f} {x0:.0f} {y0 + h:.0f}"
    k = 0.5523 * r
    x1, y1 = x0 + w, y0 + h
    p = [
        f"m {x0 + r:.1f} {y0:.1f}", f"l {x1 - r:.1f} {y0:.1f}",
        f"b {x1 - r + k:.1f} {y0:.1f} {x1:.1f} {y0 + r - k:.1f} {x1:.1f} {y0 + r:.1f}",
        f"l {x1:.1f} {y1 - r:.1f}",
        f"b {x1:.1f} {y1 - r + k:.1f} {x1 - r + k:.1f} {y1:.1f} {x1 - r:.1f} {y1:.1f}",
        f"l {x0 + r:.1f} {y1:.1f}",
        f"b {x0 + r - k:.1f} {y1:.1f} {x0:.1f} {y1 - r + k:.1f} {x0:.1f} {y1 - r:.1f}",
        f"l {x0:.1f} {y0 + r:.1f}",
        f"b {x0:.1f} {y0 + r - k:.1f} {x0 + r - k:.1f} {y0:.1f} {x0 + r:.1f} {y0:.1f}",
    ]
    return " ".join(p)


def _mix(c1: str, c2: str, t: float) -> str:
    a = [int(c1.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    b = [int(c2.lstrip("#")[i:i + 2], 16) for i in (0, 2, 4)]
    return "#" + "".join(f"{round(x + (y - x) * t):02X}" for x, y in zip(a, b))


def pick_key_word(lines: List[str]) -> Optional[str]:
    words = " ".join(lines).split(" ")
    if not words:
        return None
    return max(words, key=lambda w: len(re.sub(r"[^A-Za-z0-9]", "", w)))


class _Card:
    """Collects ASS events for one hook card."""

    def __init__(self, end: str, org: Tuple[float, float], rotate: float, intro: str):
        self.end = end
        self.org = org
        self.rotate = rotate
        self.intro = intro
        self.events: List[str] = []

    def _common(self) -> str:
        rot = f"\\org({self.org[0]:.0f},{self.org[1]:.0f})\\frz{self.rotate:g}" if self.rotate else ""
        return rot + self.intro

    def shape(self, layer: int, path: str, color: str, alpha: float = 1.0, an: int = 7,
              pos: Tuple[float, float] = (0, 0), extra: str = "") -> None:
        self.events.append(
            f"Dialogue: {layer},0:00:00.00,{self.end},HookShape,,0,0,0,,"
            f"{{\\an{an}\\pos({pos[0]:.0f},{pos[1]:.0f}){self._common()}\\bord0\\shad0"
            f"\\1c{_c(color)}\\1a{_a(alpha)}{extra}\\p1}}{path}{{\\p0}}"
        )

    def text(self, layer: int, style: str, body: str, an: int, pos: Tuple[float, float], extra: str = "") -> None:
        self.events.append(
            f"Dialogue: {layer},0:00:00.00,{self.end},{style},,0,0,0,,"
            f"{{\\an{an}\\pos({pos[0]:.0f},{pos[1]:.0f}){self._common()}{extra}}}{body}"
        )


def _sc(hex_color: str) -> str:
    s = hex_color.lstrip("#")
    return f"&H00{s[4:6]}{s[2:4]}{s[0:2]}".upper()


def _style_line(name: str, font: str, size: float, color: str, outline: float, outline_color: str,
                shadow: float, spacing: float = 0.0) -> str:
    return (f"Style: {name},{font},{size:g},{_sc(color)},&H000000FF,{_sc(outline_color)},&H96000000,"
            f"-1,0,0,0,100,100,{spacing:g},0,1,{outline:g},{shadow:g},5,40,40,0,1")


def build_hook_events(text: str, style_id: str, caption_y: float, show_until: float = 2.4,
                      font_override: Optional[str] = None) -> Tuple[List[str], List[str]]:
    """Return (style lines, dialogue lines) for the hook card."""
    st = HOOK_STYLES.get(style_id) or HOOK_STYLES[DEFAULT_HOOK_STYLE]
    font = st["font"]
    if style_id == DEFAULT_HOOK_STYLE and font_override and font_override in FONT_FILES:
        font = font_override
    size = float(st["size"])
    spacing = float(st.get("spacing", 0))
    raw = re.sub(r"\s+", " ", text or "").strip()
    if not raw:
        return [], []
    if st.get("quote"):
        raw = f"“{raw.strip(chr(34))}”"
    if st.get("upper"):
        raw = raw.upper()

    pad_x, pad_y = st.get("pad", (0, 0))
    max_w = float(st.get("max_width", 880)) - (2 * pad_x if st.get("bg") else 0)
    lines = wrap(raw, font, size, max_w, spacing)
    if not lines:
        return [], []
    key = pick_key_word(lines) if (st.get("key_color") or st.get("key_bg")) else None

    widths = [text_width(ln, font, size, spacing) for ln in lines]
    line_h = size * 1.08
    gap = float(st.get("line_gap", 0))
    per_line_bg = st.get("bg") == "line"
    row_h = line_h + (2 * pad_y if per_line_bg else 0)
    text_h = len(lines) * row_h + (len(lines) - 1) * gap
    block_h = text_h + (2 * pad_y if st.get("bg") == "block" else 0)
    left_align = st.get("align") == "left"

    top = 300.0 if caption_y >= 0.4 else 1250.0
    tag = st.get("tag")
    tag_h = 0.0
    if tag:
        tag_h = tag["size"] * 1.08 + 2 * tag["pad"][1]
        top += tag_h - (10 if tag["where"] == "left" else -14)
    cx = 540.0
    block_w = max(widths) + 2 * pad_x
    if left_align:
        stripe_w = (st.get("stripe") or ("#000", 0))[1]
        block_w = max(widths) + 2 * pad_x + stripe_w
        block_left = 60.0
    else:
        block_left = cx - block_w / 2
    center_y = top + block_h / 2

    end = f"0:00:{show_until:05.2f}"
    intro = ("\\fad(90,220)" if st.get("gradient") else
             "\\fscx82\\fscy82\\t(0,140,\\fscx106\\fscy106)\\t(140,240,\\fscx100\\fscy100)\\fad(60,220)")
    card = _Card(end, (cx if not left_align else block_left + block_w / 2, center_y), float(st.get("rotate", 0)), intro)

    styles = [_style_line("HookShape", "Arial", 20, "#FFFFFF", 0, "#000000", 0)]
    tstyle = f"Hook_{style_id}"
    styles.append(_style_line(tstyle, font, size, st["color"], float(st.get("outline", 0)),
                              st.get("outline_color", "#000000"), float(st.get("shadow", 0)), spacing))

    # ---- block background (shadow, border, fill / gradient) --------------------
    if st.get("bg") == "block":
        bw, bh, r = block_w, block_h, float(st.get("radius", 0))
        if r >= 999:
            r = bh / 2
        bcx = block_left + bw / 2
        if st.get("bg_shadow"):
            o = st["bg_shadow"]
            card.shape(10, _rrect(bw, bh, r), "#000000", 1.0, 5, (bcx + o, center_y + o))
        if st.get("bg_border"):
            b, bc = st["bg_border"]
            card.shape(11, _rrect(bw + 2 * b, bh + 2 * b, r + b), bc, 1.0, 5, (bcx, center_y))
            if st.get("tail"):
                tail = f"m 0 0 l {70 + 2 * b} 0 {10} {74 + b}"
                card.shape(11, tail, bc, 1.0, 7, (block_left + 70 - b, top + bh - 6))
        if st.get("gradient"):
            c1, c2 = st["gradient"]
            clip = _rrect(bw, bh, r, block_left, top)
            strips = 24
            sw = bw / strips
            for i in range(strips):
                col = _mix(c1, c2, i / (strips - 1))
                card.shape(12, _rrect(sw + 2, bh, 0), col, 1.0, 7, (block_left + i * sw, top), f"\\clip({clip})")
        else:
            card.shape(12, _rrect(bw, bh, r), st.get("bg_color", "#000000"), float(st.get("bg_alpha", 1.0)), 5,
                       (bcx, center_y))
        if st.get("tail"):
            card.shape(12, "m 0 0 l 70 0 10 62", st.get("bg_color", "#FFFFFF"), 1.0, 7, (block_left + 70, top + bh - 8))
        if st.get("stripe"):
            sc, sw_ = st["stripe"]
            card.shape(13, _rrect(sw_, bh, 0), sc, 1.0, 7, (block_left, top))
        if st.get("badge"):
            d = 140.0
            bx, by = block_left + bw - 10, top + 6
            card.shape(14, _rrect(d, d, d / 2), "#111111", 1.0, 5, (bx, by))
            styles.append(_style_line("HookBadge", "Montserrat Black", 100, "#FACC15", 0, "#000000", 0))
            card.text(15, "HookBadge", "?", 5, (bx, by + 2))

    # ---- tag chip (BREAKING / POV:) -------------------------------------------
    if tag:
        tw = text_width(tag["text"], tag["font"], tag["size"]) + 2 * tag["pad"][0]
        th = tag_h
        ty = top - th - (0 if tag["where"] == "left" else 14)
        tx = block_left if tag["where"] == "left" else cx - tw / 2
        extra = f"\\frz{tag.get('rotate', 0)}" if tag.get("rotate") else ""
        card.shape(16, _rrect(tw, th, 10 if tag["where"] != "left" else 0), tag["bg"], 1.0, 5,
                   (tx + tw / 2, ty + th / 2), extra)
        styles.append(_style_line("HookTag", tag["font"], tag["size"], tag["color"], 0, "#000000", 0, 1))
        card.text(17, "HookTag", _esc(tag["text"]), 5, (tx + tw / 2, ty + th / 2), extra)

    # ---- per-line rows ------------------------------------------------------------
    y = top + (pad_y if st.get("bg") == "block" else 0)
    for ln, w in zip(lines, widths):
        row_cy = y + row_h / 2
        if left_align:
            stripe_w = (st.get("stripe") or ("#000", 0))[1]
            tx, an = block_left + stripe_w + pad_x - 10, 4
            line_left = tx
        else:
            tx, an = cx, 5
            line_left = cx - w / 2
        if per_line_bg:
            card.shape(12, _rrect(w + 2 * pad_x, row_h, float(st.get("radius", 0))), st["bg_color"], 1.0, 5,
                       (cx, row_cy))
        words = ln.split(" ")
        if key and st.get("key_bg") and key in words:
            idx = words.index(key)
            pre = " ".join(words[:idx]) + (" " if idx else "")
            kx = line_left + text_width(pre, font, size, spacing)
            kw = text_width(key, font, size, spacing)
            card.shape(13, _rrect(kw + 16, line_h + 4, 0), st["key_bg"], 1.0, 5, (kx + kw / 2, row_cy))
        body_parts = []
        for wd in words:
            if key and wd == key and st.get("key_color"):
                body_parts.append(f"{{\\c{_c(st['key_color'])}}}{_esc(wd)}{{\\c{_c(st['color'])}}}")
            else:
                body_parts.append(_esc(wd))
        body = " ".join(body_parts)
        if st.get("glow"):
            g, kg = st["glow"]
            glow_parts = []
            for wd in words:
                col = kg if (key and wd == key) else g
                glow_parts.append(f"{{\\3c{_c(col)}}}{_esc(wd)}")
            card.text(18, tstyle, " ".join(glow_parts), an, (tx, row_cy),
                      f"\\bord{size * 0.16:.0f}\\blur{size * 0.14:.0f}\\shad0\\1a&HFF&")
        card.text(19, tstyle, body, an, (tx, row_cy))
        y += row_h + gap

    if st.get("underline"):
        uc, uw, uh = st["underline"]
        card.shape(19, _rrect(uw, uh, uh / 2), uc, 1.0, 5, (cx, y + 16))

    return styles, card.events


def render_hook_card(ass_path: str | Path, text: str, style_id: Optional[str], caption_y: float,
                     show_until: float = 2.4, font_override: Optional[str] = None) -> bool:
    """Append the hook card to an existing .ass file. Returns False if there was nothing to draw."""
    styles, events = build_hook_events(text, style_id or DEFAULT_HOOK_STYLE, caption_y, show_until, font_override)
    if not events:
        return False
    p = Path(ass_path)
    out: List[str] = []
    for line in p.read_text(encoding="utf-8").splitlines():
        out.append(line)
        if line.startswith("Style: KineticCaption,"):
            out.extend(styles)
    out.extend(events)
    p.write_text("\n".join(out) + "\n", encoding="utf-8")
    return True
