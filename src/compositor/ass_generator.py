"""Dynamic Word-by-Word Kinetic ASS Subtitle Generator with Direct Positioning.

Generates Advanced SubStation Alpha (.ass) subtitle files featuring:
- Accurate pixel \\pos(x, y) with anchor \\an5 (center-center)
- Dynamic word-by-word pop-in / bounce / fade animations
- Active word highlighting & per-word style overrides
- Wrapping respecting max_width and words_per_line
- PlayResX = 1080, PlayResY = 1920 single source of truth
"""

import math
from pathlib import Path
from typing import Any, Dict, List, Optional
from src.compositor.caption_geometry import caption_geometry


def seconds_to_ass_time(seconds: float) -> str:
    """Convert floating point seconds into ASS timestamp format: H:MM:SS.cc"""
    if seconds < 0:
        seconds = 0.0
    hrs = int(seconds // 3600)
    mins = int((seconds % 3600) // 60)
    secs = int(seconds % 60)
    centis = int(round((seconds - math.floor(seconds)) * 100))
    if centis >= 100:
        centis = 99
    return f"{hrs:d}:{mins:02d}:{secs:02d}.{centis:02d}"


def clean_word(word: str) -> str:
    """Escape ASS special characters and strip excessive whitespaces."""
    cleaned = word.strip()
    cleaned = cleaned.replace("\\", "\\\\").replace("{", "\\{").replace("}", "\\}")
    return cleaned


def hex_to_ass_color(hex_str: str, default: str = "&H00FFFFFF") -> str:
    """Convert #RRGGBB or #AARRGGBB to ASS &HAABBGGRR format."""
    if not hex_str:
        return default
    s = hex_str.strip()
    if s.startswith("&H"):
        return s
    if s.startswith("#"):
        s = s[1:]
    if len(s) == 6:
        # RRGGBB -> &H00BBGGRR
        r = s[0:2]
        g = s[2:4]
        b = s[4:6]
        return f"&H00{b}{g}{r}".upper()
    elif len(s) == 8:
        # AARRGGBB -> &HAABBGGRR
        a = s[0:2]
        r = s[2:4]
        g = s[4:6]
        b = s[6:8]
        return f"&H{a}{b}{g}{r}".upper()
    return default


def generate_ass_subtitles(
    word_timestamps: List[Dict[str, Any]],
    output_path: str | Path,
    template_config: Dict[str, Any],
    time_offset: float = 0.0,
    max_duration: Optional[float] = None,
) -> Path:
    """
    Generate kinetic word-level .ass subtitle file with exact geometry alignment.
    """
    sub_cfg = template_config.get("subtitles") or template_config.get("captions") or {}
    font_name = sub_cfg.get("font_name") or sub_cfg.get("font", "Montserrat ExtraBold")
    font_size = int(sub_cfg.get("font_size") or sub_cfg.get("size", 60))

    primary_raw = sub_cfg.get("primary_color") or sub_cfg.get("color", "#FFFFFF")
    highlight_raw = sub_cfg.get("highlight_color") or sub_cfg.get("highlight", "#FACC15")
    outline_raw = sub_cfg.get("outline_color", "#000000")
    shadow_raw = sub_cfg.get("shadow_color", "#000000")

    primary_color = hex_to_ass_color(primary_raw, "&H00FFFFFF")
    highlight_color = hex_to_ass_color(highlight_raw, "&H0015CCFA")
    outline_color = hex_to_ass_color(outline_raw, "&H00000000")
    back_color = hex_to_ass_color(shadow_raw, "&H80000000")

    bold = -1 if sub_cfg.get("font_weight", "900") in ["bold", "700", "800", "900", "ExtraBold", "Black"] else 0
    italic = -1 if sub_cfg.get("italic") else 0
    outline_width = float(sub_cfg.get("outline_width", 5.0))
    shadow_depth = float(sub_cfg.get("shadow_blur", 2.0))

    # Geometry calculation from position
    pos_data = sub_cfg.get("position", {})
    pos_x = float(pos_data.get("x", 0.5))
    pos_y = float(pos_data.get("y", 0.76))
    max_w = float(pos_data.get("max_width", sub_cfg.get("max_width", 0.85)))

    geom = caption_geometry(pos_x, pos_y, max_w, 1080, 1920)
    target_x = geom["x"]
    target_y = geom["y"]

    max_words_per_screen = max(1, int(sub_cfg.get("words_per_line", sub_cfg.get("max_words_per_screen", 3))))
    
    # Animation tags
    anim_mode = sub_cfg.get("animation", "pop")
    if anim_mode == "pop":
        animation_tag = "{\\t(0,100,\\fscx118\\fscy118)\\t(100,200,\\fscx100\\fscy100)}"
    elif anim_mode == "bounce":
        animation_tag = "{\\t(0,120,\\fscx122\\fscy122)\\t(120,240,\\fscx100\\fscy100)}"
    elif anim_mode == "fade":
        animation_tag = "{\\fad(80,0)}"
    elif anim_mode == "none":
        animation_tag = ""
    else:
        animation_tag = sub_cfg.get("animation_tag", "{\\t(0,70,\\fscx115\\fscy115)}")

    is_uppercase = sub_cfg.get("uppercase", True)

    out_file = Path(output_path)
    out_file.parent.mkdir(parents=True, exist_ok=True)

    # Filter and offset words
    valid_words = []
    for item in word_timestamps:
        if item.get("deleted", False):
            continue
        w_start = item.get("start", 0.0) - time_offset
        w_end = item.get("end", 0.0) - time_offset
        text = clean_word(item.get("word") or item.get("text", ""))

        if not text:
            continue
        if w_start < 0 and w_end <= 0:
            continue
        w_start = max(0.0, w_start)

        if max_duration and w_start >= max_duration:
            break

        rendered_text = text.upper() if is_uppercase else text
        valid_words.append({
            "word": rendered_text,
            "start": w_start,
            "end": w_end if not max_duration else min(w_end, max_duration),
            "highlight": item.get("highlight", False),
            "color": item.get("color"),
        })

    # Group words into chunks of max_words_per_screen
    chunks: List[List[Dict[str, Any]]] = []
    current_chunk: List[Dict[str, Any]] = []

    for word_info in valid_words:
        current_chunk.append(word_info)
        if len(current_chunk) >= max_words_per_screen:
            chunks.append(current_chunk)
            current_chunk = []
    if current_chunk:
        chunks.append(current_chunk)

    # Build ASS content with explicit anchor \an5 and \pos(x, y)
    header = f"""[Script Info]
ScriptType: v4.00+
PlayResX: 1080
PlayResY: 1920
ScaledBorderAndShadow: yes

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: KineticCaption,{font_name},{font_size},{primary_color},&H000000FF,{outline_color},{back_color},{bold},{italic},0,0,100,100,0,0,1,{outline_width},{shadow_depth},5,{geom['margin_l']},{geom['margin_r']},0,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
"""

    dialogue_lines: List[str] = []

    for chunk in chunks:
        if not chunk:
            continue

        chunk_start = chunk[0]["start"]
        chunk_end = chunk[-1]["end"]
        if chunk_end <= chunk_start:
            chunk_end = chunk_start + 0.3

        # For each word in chunk, emit dialogue state when it's actively spoken
        for i, active_word_info in enumerate(chunk):
            w_start = active_word_info["start"]
            w_end = active_word_info["end"]
            if w_end <= w_start:
                w_end = w_start + 0.25

            start_str = seconds_to_ass_time(w_start)
            end_str = seconds_to_ass_time(w_end)

            words_rendered = []
            for j, w in enumerate(chunk):
                custom_word_color = hex_to_ass_color(w.get("color")) if w.get("color") else None
                if i == j:
                    # Active word: animation + highlight color
                    hl_col = custom_word_color or highlight_color
                    words_rendered.append(
                        f"{animation_tag}{{\\c{hl_col}\\b1}}{w['word']}{{\\r}}"
                    )
                else:
                    # Inactive word
                    base_col = custom_word_color or primary_color
                    words_rendered.append(
                        f"{{\\c{base_col}}}{w['word']}{{\\r}}"
                    )

            line_text = " ".join(words_rendered)
            pos_override = f"{{\\an5\\pos({target_x},{target_y})}}"
            dialogue_lines.append(
                f"Dialogue: 0,{start_str},{end_str},KineticCaption,,0,0,0,,{pos_override}{line_text}"
            )

    full_content = header + "\n".join(dialogue_lines) + "\n"

    with open(out_file, "w", encoding="utf-8") as f:
        f.write(full_content)

    return out_file
