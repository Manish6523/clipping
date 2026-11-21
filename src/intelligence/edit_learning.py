"""Auto edit learns from results: which edit features your approved / rejected clips had, how the
published ones did on YouTube, and which automatic edits you switch off in the Edits panel - then
nudges the style defaults (within safe limits) and explains why.

Data: auto_edit_outcomes (one row per auto-edited clip, kept after the clip is deleted):
features at creation, what you turned off / added later, your decision, views / retention.
Tuning: system setting `auto_edit_tuning` = {"styles": {style: {key: value}}, "insights": [...], ...},
mirrored into compositor.auto_edit.TUNING (resolve_config applies it).
"""

from __future__ import annotations

import asyncio
import json
import logging
import statistics
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

SETTING = "auto_edit_tuning"
MIN_GROUP = 15            # clips needed on each side of a comparison
MIN_EDITS = 10            # clips you opened in the Edits panel before their "switched off" rates count
APPROVAL_GAP = 0.15       # 15 points of approval rate
VIEWS_RATIO = 1.3
OFF_RATE = 0.5            # you switch off at least half of this kind of edit
CATS = ("zooms", "emphasis", "sfx")


# ---------------------------------------------------------------------------- recording
async def record_created(db, clip_id: int, channel_id: Optional[str], flags_json: Optional[str], duration: float) -> None:
    """Snapshot of an auto-edited clip's edit (from its auto_edited flag). Called inside create_clip."""
    try:
        flags = json.loads(flags_json or "[]")
    except (TypeError, ValueError):
        return
    s = next((f for f in flags if isinstance(f, dict) and f.get("type") == "auto_edited"), None)
    if not s:
        return
    await db.execute(
        """INSERT OR REPLACE INTO auto_edit_outcomes (clip_id, channel_id, style, plan_by, duration, zooms, emphasis, sfx,
               cold_open, hook, quality_issues, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)""",
        (clip_id, channel_id, s.get("style"), s.get("plan_by") or "auto", float(duration or 0), int(s.get("zooms") or 0),
         int(s.get("emphasis") or 0), int(s.get("sfx_count") or 0), 1 if s.get("cold_open") else 0, 1 if s.get("hook_card") else 0,
         len((s.get("quality") or {}).get("issues") or [])))


def plan_changes(old: Optional[Dict[str, Any]], new: Dict[str, Any]) -> Dict[str, int]:
    """What the user switched off / added in the Edits panel, by kind (only automatic items count as 'off')."""
    out: Dict[str, int] = {}
    old = old or {}
    for cat in CATS:
        was = {i.get("id"): i for i in old.get(cat) or [] if i.get("on", True) and i.get("by") in ("auto", "ai")}
        now = {i.get("id"): i for i in new.get(cat) or []}
        off = sum(1 for k in was if k not in now or not now[k].get("on", True))
        added = sum(1 for i in new.get(cat) or [] if i.get("by") == "user" and i.get("id") not in {x.get("id") for x in old.get(cat) or []})
        if off:
            out[f"{cat}_off"] = off
        if added:
            out[f"{cat}_added"] = added
        out[f"{cat}_auto"] = len(was)
    if (old.get("cold_open") or {}).get("on") and not (new.get("cold_open") or {}).get("on"):
        out["cold_open_off"] = 1
    if not (old.get("cold_open") or {}).get("on") and (new.get("cold_open") or {}).get("on"):
        out["cold_open_added"] = 1
    if (old.get("hook") or {}).get("on") and not (new.get("hook") or {}).get("on"):
        out["hook_off"] = 1
    return out


async def record_user_changes(clip_id: int, old: Optional[Dict[str, Any]], new: Dict[str, Any]) -> None:
    from src.database import get_db_connection
    changes = plan_changes(old, new)
    try:
        async with get_db_connection() as db:
            cur = await db.execute("SELECT user_changes FROM auto_edit_outcomes WHERE clip_id = ?", (clip_id,))
            row = await cur.fetchone()
            if not row:
                return
            prev = json.loads(row[0] or "{}")
            # 'auto' counts are a snapshot, the rest add up across edits
            merged = {k: (v if k.endswith("_auto") else prev.get(k, 0) + v) for k, v in changes.items()}
            merged = {**prev, **merged, "edited": 1}
            await db.execute("UPDATE auto_edit_outcomes SET user_changes = ?, updated_at = CURRENT_TIMESTAMP WHERE clip_id = ?",
                             (json.dumps(merged), clip_id))
            await db.commit()
    except Exception as e:                      # never block the edit on bookkeeping
        logger.debug("Could not record edit changes for clip %d: %s", clip_id, e)


async def refresh_outcomes(db) -> None:
    """Pull decisions (feedback events survive deletion) and the latest views into the table."""
    await db.execute("""
        UPDATE auto_edit_outcomes SET decision = (
            SELECT CASE WHEN f.event IN ('approved', 'published', 'marked_great') THEN 'approved' ELSE 'rejected' END
            FROM clip_feedback_events f WHERE f.clip_id = auto_edit_outcomes.clip_id
              AND f.event IN ('approved', 'published', 'marked_great', 'rejected') ORDER BY f.id DESC LIMIT 1)
        WHERE EXISTS (SELECT 1 FROM clip_feedback_events f WHERE f.clip_id = auto_edit_outcomes.clip_id
                      AND f.event IN ('approved', 'published', 'marked_great', 'rejected'))""")
    await db.execute("""
        UPDATE auto_edit_outcomes SET
            views = (SELECT MAX(m.views) FROM clip_metrics m WHERE m.clip_id = auto_edit_outcomes.clip_id),
            retention = (SELECT MAX(m.retention_pct) FROM clip_metrics m WHERE m.clip_id = auto_edit_outcomes.clip_id)
        WHERE EXISTS (SELECT 1 FROM clip_metrics m WHERE m.clip_id = auto_edit_outcomes.clip_id)""")
    await db.commit()


# ---------------------------------------------------------------------------- analysis
FEATURES = {
    "cold_open": ("Cold open", lambda r: bool(r["cold_open"])),
    "ai_director": ("AI director", lambda r: r["plan_by"] == "ai"),
    "sounds": ("Sound effects", lambda r: (r["sfx"] or 0) > 0),
    "busy_zooms": ("Frequent zooms (1 per 6 s or more)", lambda r: r["duration"] and (r["zooms"] or 0) / r["duration"] >= 1 / 6),
    "key_words": ("3+ key words", lambda r: (r["emphasis"] or 0) >= 3),
}


def _rate(rows: List[Dict[str, Any]]) -> Optional[float]:
    d = [r for r in rows if r.get("decision")]
    return sum(1 for r in d if r["decision"] == "approved") / len(d) if d else None


def _views(rows: List[Dict[str, Any]]) -> Optional[float]:
    v = [r["views"] for r in rows if r.get("views") is not None]
    return statistics.median(v) if v else None


def compare(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    out = []
    for key, (label, has) in FEATURES.items():
        yes = [r for r in rows if has(r)]
        no = [r for r in rows if not has(r)]
        out.append({"feature": key, "label": label,
                    "with": {"n": len([r for r in yes if r.get("decision")]), "approval": _rate(yes), "views": _views(yes),
                             "views_n": len([r for r in yes if r.get("views") is not None])},
                    "without": {"n": len([r for r in no if r.get("decision")]), "approval": _rate(no), "views": _views(no),
                                "views_n": len([r for r in no if r.get("views") is not None])}})
    return out


def off_rates(rows: List[Dict[str, Any]]) -> Dict[str, Dict[str, Any]]:
    """Share of automatic edits you switched off, among clips you opened in the Edits panel."""
    edited = [json.loads(r["user_changes"]) for r in rows if r.get("user_changes")]
    edited = [c for c in edited if c.get("edited")]
    res: Dict[str, Dict[str, Any]] = {}
    for cat in CATS:
        auto = sum(c.get(f"{cat}_auto", 0) for c in edited)
        off = sum(c.get(f"{cat}_off", 0) for c in edited)
        res[cat] = {"clips": len(edited), "auto": auto, "off": off, "rate": (off / auto) if auto else None}
    co_clips = [c for c in edited if "cold_open_off" in c or "cold_open_added" in c] or []
    res["cold_open"] = {"clips": len(edited), "off": sum(c.get("cold_open_off", 0) for c in edited),
                        "rate": (sum(c.get("cold_open_off", 0) for c in edited) / len(edited)) if edited else None,
                        "added": sum(c.get("cold_open_added", 0) for c in co_clips)}
    return res


def recommend(comparison: List[Dict[str, Any]], offs: Dict[str, Dict[str, Any]], base: Dict[str, Any]) -> (Dict[str, Any], List[str]):
    """New tuning for one style (bounded) + plain-English reasons. Only acts on enough evidence."""
    tune: Dict[str, Any] = {}
    why: List[str] = []
    by = {c["feature"]: c for c in comparison}

    def clear_gap(c):
        w, wo = c["with"], c["without"]
        if w["n"] >= MIN_GROUP and wo["n"] >= MIN_GROUP and w["approval"] is not None and wo["approval"] is not None:
            return w["approval"] - wo["approval"]
        return None

    def views_ratio(c):
        w, wo = c["with"], c["without"]
        if w["views_n"] >= MIN_GROUP and wo["views_n"] >= MIN_GROUP and w["views"] and wo["views"]:
            return w["views"] / wo["views"]
        return None

    edited = offs.get("zooms", {}).get("clips", 0) >= MIN_EDITS
    # cold open
    gap, vr = clear_gap(by["cold_open"]), views_ratio(by["cold_open"])
    if (edited and (offs["cold_open"]["rate"] or 0) >= OFF_RATE) or (gap is not None and gap <= -APPROVAL_GAP) or (vr and vr <= 1 / VIEWS_RATIO):
        tune["cold_open"] = False
        why.append("Cold opens are off: clips with them were approved / watched less, or you kept switching them off.")
    elif (gap is not None and gap >= APPROVAL_GAP) or (vr and vr >= VIEWS_RATIO):
        tune["cold_open"] = True
        why.append("Cold opens are on: clips with them did clearly better.")
    # AI director
    gap = clear_gap(by["ai_director"])
    if gap is not None and gap <= -APPROVAL_GAP:
        tune["ai_director"] = False
        why.append(f"AI director is off: its clips were approved {abs(gap) * 100:.0f} points less often than the built-in rules.")
    # zooms
    z = offs.get("zooms", {})
    gap, vr = clear_gap(by["busy_zooms"]), views_ratio(by["busy_zooms"])
    every = float(base.get("zoom_every", 4.5))
    if edited and (z.get("rate") or 0) >= OFF_RATE:
        tune["zoom_every"] = round(min(8.0, every * 1.4), 2)
        why.append(f"Fewer zooms (one per {tune['zoom_every']:.1f} s): you switched off {z['rate'] * 100:.0f}% of automatic zooms.")
    elif (gap is not None and gap >= APPROVAL_GAP) or (vr and vr >= VIEWS_RATIO):
        tune["zoom_every"] = round(max(3.5, every * 0.85), 2)
        why.append(f"More zooms (one per {tune['zoom_every']:.1f} s): clips with frequent zooms did better.")
    elif (gap is not None and gap <= -APPROVAL_GAP) or (vr and vr <= 1 / VIEWS_RATIO):
        tune["zoom_every"] = round(min(8.0, every * 1.25), 2)
        why.append(f"Fewer zooms (one per {tune['zoom_every']:.1f} s): clips with frequent zooms did worse.")
    # sounds
    sx = offs.get("sfx", {})
    gap = clear_gap(by["sounds"])
    if (edited and (sx.get("rate") or 0) >= OFF_RATE) or (gap is not None and gap <= -APPROVAL_GAP):
        tune["sfx_words"] = False
        tune["sfx_cuts"] = False
        why.append("Fewer sounds (only on zooms): you muted most extra sounds, or clips with sounds were approved less.")
    # key words
    em = offs.get("emphasis", {})
    if edited and (em.get("rate") or 0) >= OFF_RATE:
        tune["emphasis_every"] = 6.0
        why.append(f"Fewer key words (one per 6 s): you switched off {em['rate'] * 100:.0f}% of them.")
    return tune, why


async def analyze(apply: bool = True) -> Dict[str, Any]:
    from src.database import get_db_connection, get_system_setting, set_system_setting
    from src.compositor import auto_edit as ae
    async with get_db_connection() as db:
        await refresh_outcomes(db)
        cur = await db.execute("SELECT * FROM auto_edit_outcomes")
        cols = [c[0] for c in cur.description]
        rows = [dict(zip(cols, r)) for r in await cur.fetchall()]
    result: Dict[str, Any] = {"updated": datetime.now(timezone.utc).isoformat(), "clips": len(rows),
                              "decided": len([r for r in rows if r.get("decision")]),
                              "with_views": len([r for r in rows if r.get("views") is not None]), "styles": {}, "insights": {}}
    for style in ae.STYLES:
        srows = [r for r in rows if r.get("style") == style]
        if not srows:
            continue
        comp, offs = compare(srows), off_rates(srows)
        tune, why = recommend(comp, offs, ae.STYLES[style])
        result["insights"][style] = {"clips": len(srows), "comparison": comp, "switched_off": offs, "reasons": why}
        if tune:
            result["styles"][style] = tune
    if apply:
        try:
            prev = json.loads(await get_system_setting(SETTING, "{}") or "{}")
        except (TypeError, ValueError):
            prev = {}
        if prev.get("paused"):
            result["paused"] = True
            result["styles"] = prev.get("styles", {})
        await set_system_setting(SETTING, json.dumps(result), category="compositor",
                                 description="What auto edit learned from approvals, views and your edits")
        ae.TUNING.clear()
        ae.TUNING.update(result["styles"])
    logger.info("Auto-edit learning: %d clips (%d decided, %d with views); tuning %s",
                result["clips"], result["decided"], result["with_views"], result["styles"] or "unchanged")
    return result


async def load() -> None:
    """Startup: apply the stored tuning."""
    from src.database import get_system_setting
    from src.compositor import auto_edit as ae
    try:
        data = json.loads(await get_system_setting(SETTING, "{}") or "{}")
        ae.TUNING.clear()
        ae.TUNING.update(data.get("styles") or {})
    except Exception as e:
        logger.debug("No auto-edit tuning loaded: %s", e)


async def reset() -> Dict[str, Any]:
    from src.database import set_system_setting
    from src.compositor import auto_edit as ae
    await set_system_setting(SETTING, json.dumps({"styles": {}, "reset": datetime.now(timezone.utc).isoformat()}), category="compositor",
                             description="What auto edit learned from approvals, views and your edits")
    ae.TUNING.clear()
    return {"styles": {}}


async def learning_loop(interval_s: int = 24 * 3600) -> None:
    await load()
    await asyncio.sleep(300)
    while True:
        try:
            await analyze(apply=True)
        except Exception as e:
            logger.warning("Auto-edit learning run failed: %s", e)
        await asyncio.sleep(interval_s)
