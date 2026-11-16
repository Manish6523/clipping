"""Dynamic Streamer Attribution Badge Generator.

Generates high-contrast streamer attribution badges (platform logo + styled uppercase handle/name)
ready to be overlaid by FFmpeg or previewed in web canvas.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Optional, Tuple
from PIL import Image, ImageDraw, ImageFont

BADGE_DIR = Path("data/watermarks/badges")
BADGE_DIR.mkdir(parents=True, exist_ok=True)

FONTS_DIR = Path("assets/fonts")

# Standard vibrant platform brand colors
COLORS = {
    "youtube": (255, 0, 0, 255),       # #FF0000
    "twitch": (145, 70, 255, 255),     # #9146FF
    "kick": (83, 252, 24, 255),        # #53FC18
    "default": (255, 255, 255, 255)
}


def _get_font(font_size: int) -> ImageFont.FreeTypeFont | ImageFont.ImageFont:
    """Load Montserrat-Black or fallback bold font."""
    candidates = [
        FONTS_DIR / "Montserrat-Black.ttf",
        FONTS_DIR / "Montserrat-ExtraBold.ttf",
        FONTS_DIR / "anton-400.ttf",
        FONTS_DIR / "bebas-neue-400.ttf"
    ]
    for p in candidates:
        if p.exists():
            try:
                return ImageFont.truetype(str(p), font_size)
            except Exception:
                pass
    return ImageFont.load_default()


def _draw_platform_icon(draw: ImageDraw.ImageDraw, platform: str, x: int, y: int, size: int) -> None:
    """Draw a clean platform vector badge (YouTube play pill or Twitch glitch)."""
    p = (platform or "youtube").lower()
    if p == "youtube":
        # Rounded red pill rectangle
        w, h = size, int(size * 0.70)
        pill_y = y + (size - h) // 2
        r = int(h * 0.35)
        draw.rounded_rectangle([x, pill_y, x + w, pill_y + h], radius=r, fill=COLORS["youtube"])
        # White centered play triangle
        pw = int(w * 0.28)
        ph = int(h * 0.40)
        px = x + (w - pw) // 2 + 1
        py = pill_y + (h - ph) // 2
        draw.polygon([(px, py), (px + pw, py + ph // 2), (px, py + ph)], fill=(255, 255, 255, 255))
    elif p == "twitch":
        # Purple Twitch chat bubble shape
        w, h = int(size * 0.90), int(size * 0.95)
        tw_y = y + (size - h) // 2
        r = max(2, int(w * 0.15))
        draw.rounded_rectangle([x, tw_y, x + w, tw_y + h], radius=r, fill=COLORS["twitch"])
        # Cutout eyes
        ew = max(2, int(w * 0.12))
        eh = max(3, int(h * 0.30))
        ey = tw_y + int(h * 0.28)
        draw.rectangle([x + int(w * 0.30), ey, x + int(w * 0.30) + ew, ey + eh], fill=(255, 255, 255, 255))
        draw.rectangle([x + int(w * 0.58), ey, x + int(w * 0.58) + ew, ey + eh], fill=(255, 255, 255, 255))
    else:
        # Default circular accent dot
        r = size // 2
        draw.ellipse([x, y, x + size, y + size], fill=COLORS.get(p, COLORS["default"]))


def generate_streamer_badge(
    channel_name: str,
    platform: str = "youtube",
    target_width: int = 320,
    force_refresh: bool = False
) -> str:
    """Generate high-contrast attribution badge PNG and return the absolute path."""
    clean_name = (channel_name or "STREAMER").strip().lstrip("@").upper()
    platform = (platform or "youtube").lower()

    out_file = BADGE_DIR / f"badge_{platform}_{clean_name}_{target_width}.png"
    if out_file.exists() and not force_refresh:
        return str(out_file.resolve())

    # We generate at 2x resolution for retina/anti-aliased downscaling
    scale = 2
    canvas_w = target_width * scale
    
    # Calculate font size roughly proportional to target width & name length
    # Base font size: roughly 38px at 320w
    approx_chars = max(4, len(clean_name))
    font_size = int((canvas_w * 0.65) / approx_chars)
    font_size = max(28, min(80, font_size))
    
    font = _get_font(font_size)
    
    # Measure text bounding box
    dummy_img = Image.new("RGBA", (1, 1), (0, 0, 0, 0))
    dummy_draw = ImageDraw.Draw(dummy_img)
    bbox = dummy_draw.textbbox((0, 0), clean_name, font=font)
    text_w = bbox[2] - bbox[0]
    text_h = bbox[3] - bbox[1]

    icon_size = int(text_h * 1.05)
    gap = int(font_size * 0.35)
    padding_x = int(font_size * 0.5)
    padding_y = int(font_size * 0.35)

    total_w = padding_x * 2 + icon_size + gap + text_w
    total_h = padding_y * 2 + max(icon_size, text_h)

    # Create RGBA transparent image
    img = Image.new("RGBA", (total_w, total_h), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)

    # 1. Subtle dark backdrop pill with soft border
    pill_radius = int(total_h * 0.28)
    draw.rounded_rectangle(
        [0, 0, total_w, total_h],
        radius=pill_radius,
        fill=(0, 0, 0, 160),
        outline=(255, 255, 255, 45),
        width=max(1, int(1.5 * scale))
    )

    # 2. Draw platform icon
    icon_x = padding_x
    icon_y = (total_h - icon_size) // 2
    _draw_platform_icon(draw, platform, icon_x, icon_y, icon_size)

    # 3. Draw text with thick black outline stroke and solid white fill
    text_x = icon_x + icon_size + gap
    text_y = (total_h - text_h) // 2 - bbox[1]
    stroke_width = max(2, int(font_size * 0.08))

    draw.text(
        (text_x, text_y),
        clean_name,
        font=font,
        fill=(255, 255, 255, 255),
        stroke_width=stroke_width,
        stroke_fill=(0, 0, 0, 255)
    )

    # Downscale smoothly to requested target_width
    final_w = target_width
    final_h = int(total_h * (target_width / total_w))
    img_resized = img.resize((final_w, final_h), resample=Image.Resampling.LANCZOS)

    img_resized.save(out_file, format="PNG")
    return str(out_file.resolve())
