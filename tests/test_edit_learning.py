"""Auto-edit learning: tracks your switched-off edits, compares outcomes, tunes only on enough evidence."""
import asyncio
import json

import pytest

from src import database
from src.compositor import auto_edit as ae
from src.intelligence import edit_learning as el


def test_plan_changes_counts_switched_off_and_added():
    old = {"zooms": [{"id": "z1", "on": True, "by": "auto"}, {"id": "z2", "on": True, "by": "ai"}],
           "sfx": [{"id": "s1", "on": True, "by": "auto"}], "emphasis": [],
           "cold_open": {"on": True}, "hook": {"on": True}}
    new = {"zooms": [{"id": "z1", "on": False, "by": "auto"}, {"id": "z2", "on": True, "by": "ai"}, {"id": "zu", "on": True, "by": "user"}],
           "sfx": [], "emphasis": [], "cold_open": {"on": False}, "hook": {"on": True}}
    c = el.plan_changes(old, new)
    assert c["zooms_off"] == 1 and c["zooms_added"] == 1 and c["zooms_auto"] == 2
    assert c["sfx_off"] == 1 and c["cold_open_off"] == 1 and "hook_off" not in c


def _row(i, cold, decision, views=None, by="auto", changes=None):
    return {"clip_id": i, "style": "punchy", "plan_by": by, "duration": 30, "zooms": 4, "emphasis": 2, "sfx": 5,
            "cold_open": cold, "hook": 1, "decision": decision, "views": views, "user_changes": json.dumps(changes) if changes else None}


def test_recommend_needs_enough_evidence():
    few = [_row(i, 1, "rejected") for i in range(5)] + [_row(10 + i, 0, "approved") for i in range(5)]
    tune, why = el.recommend(el.compare(few), el.off_rates(few), ae.STYLES["punchy"])
    assert tune == {} and why == []


def test_recommend_turns_off_cold_open_when_it_loses():
    rows = [_row(i, 1, "approved" if i < 5 else "rejected") for i in range(20)] + \
           [_row(100 + i, 0, "approved" if i < 15 else "rejected") for i in range(20)]
    tune, why = el.recommend(el.compare(rows), el.off_rates(rows), ae.STYLES["punchy"])
    assert tune["cold_open"] is False and "Cold opens are off" in why[0]


def test_recommend_from_what_you_switch_off():
    ch = {"edited": 1, "zooms_auto": 4, "zooms_off": 3, "sfx_auto": 5, "sfx_off": 4, "emphasis_auto": 2, "emphasis_off": 0}
    rows = [_row(i, 0, None, changes=ch) for i in range(12)]
    tune, why = el.recommend(el.compare(rows), el.off_rates(rows), ae.STYLES["punchy"])
    assert tune["zoom_every"] == round(4.5 * 1.4, 2) and tune["sfx_words"] is False and tune["sfx_cuts"] is False
    assert "emphasis_every" not in tune


def test_tuning_is_applied_and_bounded(monkeypatch):
    monkeypatch.setattr(ae, "TUNING", {"punchy": {"cold_open": False, "zoom_every": 99, "nonsense": 1}})
    cfg = ae.resolve_config({"enabled": True, "style": "punchy"})
    assert cfg["cold_open"] is False and cfg["zoom_every"] == 8.0 and "nonsense" not in cfg
    assert ae.resolve_config({"enabled": True, "style": "punchy", "cold_open": True})["cold_open"] is True   # explicit wins


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    monkeypatch.setattr(ae, "TUNING", {})
    asyncio.run(database.init_db())


def test_end_to_end_snapshot_decisions_and_tuning(db):
    async def go():
        ids = []
        for i in range(40):
            cold = i < 20
            flags = json.dumps([{"type": "auto_edited", "style": "punchy", "zooms": 3, "emphasis": 2, "sfx_count": 4,
                                 "cold_open": cold, "hook_card": True, "plan_by": "auto"}])
            cid = await database.create_clip(source_type="live", source_id=str(i), channel_id="kai", template_name="t",
                                             raw_start=0, raw_end=30, virality_score=80, title=f"c{i}", flags=flags)
            ids.append(cid)
            approved = (i < 20 and i < 5) or (i >= 20 and i < 35)
            async with database.get_db_connection() as c:
                await c.execute("INSERT INTO clip_feedback_events (clip_id, channel_id, event) VALUES (?, 'kai', ?)",
                                (cid, "approved" if approved else "rejected"))
                await c.commit()
        await database.delete_clip_completely(ids[0])          # deleted clips still count
        res = await el.analyze(apply=True)
        stored = json.loads(await database.get_system_setting(el.SETTING))
        return res, stored
    res, stored = asyncio.run(go())
    assert res["clips"] == 40 and res["decided"] == 40
    assert res["styles"]["punchy"]["cold_open"] is False and ae.TUNING["punchy"]["cold_open"] is False
    assert stored["insights"]["punchy"]["reasons"]
    asyncio.run(el.reset())
    assert ae.TUNING == {}
