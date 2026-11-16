"""Dynamic Streamer Attribution Badge Generator.

Generates pixel-perfect transparent streamer attribution badges matching the exact reference:
- Completely TRANSPARENT background (NO solid black / grey box)
- Direct platform icon (YouTube red pill or Twitch purple icon)
- Font: Heavy condensed bold (Bebas Neue / Anton / Montserrat)
- Text styling: Solid white fill with a clean, thick black outline stroke (floating directly on video)
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional
from PIL import Image, ImageDraw, ImageFont

BADGE_DIR = Path("data/watermarks/badges")
BADGE_DIR.mkdir(parents=True, exist_ok=True)

FONTS_DIR = Path("assets/fonts")

COLORS = {
    "youtube": (255, 0, 0, 255),
    "twitch": (145, 70, 255, 255),
    "kick": (83, 252, 24, 255),
}


def _get_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load bold condensed font matching reference."""
    candidates = [
        FONTS_DIR / "anton-400.ttf",
        FONTS_DIR / "bebas-neue-400.ttf",
        FONTS_DIR / "Montserrat-Black.ttf",
        FONTS_DIR / "Montserrat-ExtraBold.ttf"
    ]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), font_size)
            except Exception:
                pass
    return ImageFont.load_default()


def _draw_platform_icon(draw: ImageDraw.ImageDraw, platform: str, x: int, y: int, h: int) -> int:
    """Draw clean platform icon with outline and return its rendered width."""
    p = (platform or "youtube").lower()
    
    if p == "youtube":
        # Rounded red pill rectangle with black outline
        pill_w = int(h * 1.40)
        pill_h = h
        r = int(pill_h * 0.35)
        outline_w = max(2, int(h * 0.08))

        # Outer black stroke
        draw.rounded_rectangle(
            [x, y, x + pill_w, y + pill_h],
            radius=r,
            fill=COLORS["youtube"],
            outline=(0, 0, 0, 255),
            width=outline_w
        )

        # Centered white play triangle
        pw = int(pill_w * 0.32)
        ph = int(pill_h * 0.44)
        px = x + (pill_w - pw) // 2 + max(1, int(h * 0.04))
        py = y + (pill_h - ph) // 2
        draw.polygon([(px, py), (px + pw, py + ph // 2), (px, py + ph)], fill=(255, 255, 255, 255))
        return pill_w
    elif p == "twitch":
        tw_w = int(h * 1.1)
        tw_h = h
        r = max(2, int(tw_w * 0.16))
        outline_w = max(2, int(h * 0.08))

        draw.rounded_rectangle(
            [x, y, x + tw_w, y + tw_h],
            radius=r,
            fill=COLORS["twitch"],
            outline=(0, 0, 0, 255),
            width=outline_w
        )
        # Twitch cutout eyes
        ew = max(2, int(tw_w * 0.14))
        eh = max(3, int(tw_h * 0.32))
        ey = y + int(tw_h * 0.28)
        draw.rectangle([x + int(tw_w * 0.28), ey, x + int(tw_w * 0.28) + ew, ey + eh], fill=(255, 255, 255, 255))
        draw.rectangle([x + int(tw_w * 0.58), ey, x + int(tw_w * 0.58) + ew, ey + eh], fill=(255, 255, 255, 255))
        return tw_w
    else:
        r = h // 2
        draw.ellipse([x, y, x + h, y + h], fill=COLORS.get(p, (255, 255, 255, 255)), outline=(0, 0, 0, 255), width=2)
        return h


def generate_streamer_badge(
    channel_name: str,
    platform: str = "youtube",
    target_width: int = 280,
    force_refresh: bool = True
) -> str:
    """Generate floating transparent badge (NO background pill) with heavy black stroke."""
    clean_name = (channel_name or "STREAMER").strip().lstrip("@").upper()
    platform = (platform or "youtube").lower()

    out_file = BADGE_DIR / f"badge_{platform}_{clean_name}_{target_width}.png"
    if out_file.exists() and not force_refresh:
        return str(out_file.resolve())

    # Super-sampled scale (3x) for ultra-sharp crisp edges
    scale = 3
    base_font_size = 56 * scale
    font = _get_font(base_font_size)

    # Measure text metrics
    dummy = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    dummy_draw = ImageDraw.Draw(dummy)
    bbox = dummy_draw.textbbox((0, 0), clean_name, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    stroke_w = max(4, int(base_font_size * 0.12))  # Thick black outline
    icon_h = int(text_h * 0.95)
    gap = int(base_font_size * 0.22)
    margin = stroke_w + 12

    icon_w = int(icon_h * 1.40) if platform == "youtube" else int(icon_h * 1.1)
    total_w = margin * 2 + icon_w + gap + text_w
    total_h = margin * 2 + max(icon_h, text_h)

    # 100% Transparent Image Canvas
    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Platform Icon
    icon_x = margin
    icon_y = margin + (max(icon_h, text_h) - icon_h) // 2
    _draw_platform_icon(draw, platform, icon_x, icon_y, icon_h)

    # 2. Text with heavy solid black stroke and solid white fill
    text_x = icon_x + icon_w + gap
    text_y = margin + (max(icon_h, text_h) - text_h) // 2 - bbox[1]

    draw.text(
        (text_x, text_y),
        clean_name,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=stroke_w,
        stroke_fill=(0, 0, 0, 255)
    )

    # Downscale smoothly to requested target_width
    final_w = target_width
    final_h = max(1, int(total_h * (target_width / total_w)))
    img_resized = img.resize((final_w, final_h), resample=Image.Resampling.LANCZOS)

    img_resized.save(out_file, format="PNG")
    return str(out_file.resolve())
