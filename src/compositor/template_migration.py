"""
Template & Layout Migration to Schema v2.
Converts old templates (Facecam / Gameplay crops, layout enums) into Schema v2 multi-layer format.
"""

import os
import json
import logging
import shutil
from pathlib import Path
from typing import Dict, Any, List

logger = logging.getLogger(__name__)


def migrate_layout_to_v2(template: Dict[str, Any]) -> Dict[str, Any]:
    """
    Given a template dict (either legacy Schema v1 or already Schema v2),
    returns a normalized Schema v2 layout structure.
    """
    layout = template.get("layout", {})

    # Already schema 2?
    if layout.get("schema") == 2 and "layers" in layout:
        return layout

    layout_type = layout.get("type", "facecam_top_gameplay_bottom")
    top_c = layout.get("top_crop", {})
    bot_c = layout.get("bottom_crop", {})

    # Extract normalized coordinates with robust fallbacks
    def get_norm(c: Dict[str, Any], default_x: float, default_y: float, default_w: float, default_h: float) -> Dict[str, float]:
        if not c:
            return {"x": default_x, "y": default_y, "w": default_w, "h": default_h}
        x = c.get("normalized_x")
        y = c.get("normalized_y")
        w = c.get("normalized_w")
        h = c.get("normalized_h")
        if x is None and "source_x" in c:
            x = c["source_x"] / 1920.0
        if y is None and "source_y" in c:
            y = c["source_y"] / 1080.0
        if w is None and "source_w" in c:
            w = c["source_w"] / 1920.0
        if h is None and "source_h" in c:
            h = c["source_h"] / 1080.0
        return {
            "x": round(float(x if x is not None else default_x), 4),
            "y": round(float(y if y is not None else default_y), 4),
            "w": round(float(w if w is not None else default_w), 4),
            "h": round(float(h if h is not None else default_h), 4),
        }

    layers: List[Dict[str, Any]] = []

    if layout_type == "single_crop_9_16" or layout_type == "full_9_16":
        layers.append({
            "id": "l_action",
            "name": "Action 9:16",
            "color": "#00F0FF",
            "visible": True,
            "locked": False,
            "src": get_norm(bot_c, 0.342, 0.0, 0.316, 1.0),
            "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        bg = {"type": "solid", "source_layer": None, "blur": 0, "dim": 0.0, "color": "#000000"}

    elif layout_type == "dynamic_face_track":
        layers.append({
            "id": "l_facetrack",
            "name": "Auto Face Tracker",
            "color": "#A855F7",
            "visible": True,
            "locked": False,
            "src": get_norm(top_c, 0.342, 0.0, 0.316, 1.0),
            "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "face", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        bg = {"type": "solid", "source_layer": None, "blur": 0, "dim": 0.0, "color": "#000000"}

    elif layout_type == "blurred_bg_center":
        layers.append({
            "id": "l_center",
            "name": "16:9 Center Stream",
            "color": "#3B82F6",
            "visible": True,
            "locked": False,
            "src": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 1.0},
            "dst": {"x": 0.0, "y": 0.342, "w": 1.0, "h": 0.316},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        bg = {"type": "blur", "source_layer": None, "blur": 40, "dim": 0.4, "color": "#000000"}

    elif layout_type == "split_screen_50_50":
        # Top 50%
        layers.append({
            "id": "l_top",
            "name": "Speaker 1 (Top)",
            "color": "#FFB020",
            "visible": True,
            "locked": False,
            "src": get_norm(top_c, 0.0, 0.58, 0.32, 0.42),
            "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.50},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        # Bottom 50%
        layers.append({
            "id": "l_bot",
            "name": "Speaker 2 (Bottom)",
            "color": "#00F0FF",
            "visible": True,
            "locked": False,
            "src": get_norm(bot_c, 0.20, 0.0, 0.60, 1.0),
            "dst": {"x": 0.0, "y": 0.50, "w": 1.0, "h": 0.50},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        bg = {"type": "solid", "source_layer": None, "blur": 0, "dim": 0.0, "color": "#000000"}

    else:
        # Default: facecam_top_gameplay_bottom (38% top, 62% bottom)
        layers.append({
            "id": "l_game",
            "name": "Gameplay",
            "color": "#00F0FF",
            "visible": True,
            "locked": False,
            "src": get_norm(bot_c, 0.20, 0.0, 0.60, 1.0),
            "dst": {"x": 0.0, "y": 0.38, "w": 1.0, "h": 0.62},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        layers.append({
            "id": "l_face",
            "name": "Facecam",
            "color": "#FFB020",
            "visible": True,
            "locked": False,
            "src": get_norm(top_c, 0.0, 0.58, 0.32, 0.42),
            "dst": {"x": 0.0, "y": 0.0, "w": 1.0, "h": 0.38},
            "fit": "cover",
            "aspect_lock": True,
            "style": {
                "radius": 0.0,
                "shape": "rect",
                "border": {"w": 0, "color": "#FFFFFF"},
                "shadow": {"blur": 0, "opacity": 0.0, "dx": 0, "dy": 0},
                "opacity": 1.0,
                "mirror": False,
            },
            "tracking": {"mode": "off", "smooth": 0.8},
            "keyframes": {"src": [], "dst": []},
            "visible_range": None,
        })
        bg = {"type": "solid", "source_layer": None, "blur": 0, "dim": 0.0, "color": "#000000"}

    return {
        "schema": 2,
        "type": layout_type,
        "canvas": {"w": 1080, "h": 1920},
        "background": bg,
        "layers": layers,
        # Preserve legacy top_crop and bottom_crop for backward compatibility with external scripts
        "top_crop": top_c,
        "bottom_crop": bot_c,
    }


def migrate_all_templates(templates_dir: str) -> None:
    """Migrate all JSON templates in templates_dir to Schema v2 with backups."""
    t_path = Path(templates_dir)
    if not t_path.exists():
        return

    backup_dir = t_path / "backups_v1"
    backup_dir.mkdir(exist_ok=True)

    for json_file in t_path.glob("*.json"):
        try:
            with open(json_file, "r", encoding="utf-8") as f:
                data = json.load(f)

            if data.get("layout", {}).get("schema") == 2:
                continue

            # Backup original
            shutil.copy2(json_file, backup_dir / json_file.name)

            # Migrate layout
            data["layout"] = migrate_layout_to_v2(data)

            with open(json_file, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)

            logger.info("Migrated template '%s' to Schema v2", json_file.name)
        except Exception as e:
            logger.error("Failed to migrate template '%s': %s", json_file.name, e)



CLIENT_ONLY_KEYS = ("_migrated_from_legacy", "legacy_layout")


def is_legacy_layout(template: Dict[str, Any]) -> bool:
    layout = template.get("layout") or {}
    return not (isinstance(layout, dict) and layout.get("schema") == 2 and isinstance(layout.get("layers"), list))


def normalize_template_for_client(template: Dict[str, Any]) -> Dict[str, Any]:
    """Template as the dashboard should see it: always a schema-2 layout with real layers.

    Old-format templates (``layout.type`` + ``top_crop`` / ``bottom_crop``, no ``layers``) are converted with the
    SAME function the renderer uses, so what you edit is exactly what gets rendered. The file on disk is not touched
    until the user saves. ``legacy_layout`` keeps the original so the editor can offer "Repair from legacy fields".
    """
    if not is_legacy_layout(template):
        return template
    out = dict(template)
    out["legacy_layout"] = template.get("layout") or {}
    out["layout"] = migrate_layout_to_v2(template)
    out["_migrated_from_legacy"] = True
    return out


def strip_client_only_keys(template: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in template.items() if k not in CLIENT_ONLY_KEYS}
