"""PUT /api/clips/{id}/edit-plan re-renders the clip with exactly that plan, on a throwaway
database and a generated test video (no real clip touched)."""
import asyncio
import json
import subprocess

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from src import database
from src.web import routes_clips as rc


def setup_dir(clip):
    return clip["rendered_video_path"]


def _make_video(path):
    subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-f", "lavfi", "-i", "testsrc2=size=1920x1080:rate=30:duration=8",
                    "-f", "lavfi", "-i", "sine=frequency=330:duration=8", "-shortest", "-c:v", "libx264", "-preset", "ultrafast",
                    "-c:a", "aac", str(path)], check=True)


@pytest.fixture
def setup(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    import src.bot.trimmer as trimmer
    monkeypatch.setattr(trimmer, "RENDER_DIR", str(tmp_path / "renders"))
    import src.compositor.render_swap as swap
    monkeypatch.setattr(swap, "OUTPUT_DIR", str(tmp_path / "out"))          # never the real output/clips
    monkeypatch.setattr(swap, "RENDER_DIR", str(tmp_path / "renders"))
    (tmp_path / "renders").mkdir()
    (tmp_path / "out").mkdir()
    import shutil
    from src.compositor import auto_edit
    sfx = tmp_path / "sfx"                                                  # bundled sounds only, not the user's own
    sfx.mkdir()
    for f in ("whoosh.wav", "boom.wav", "pop.wav", "boop.wav"):
        shutil.copy(auto_edit.SFX_DIR / f, sfx / f)
    monkeypatch.setattr(auto_edit, "SFX_DIR", sfx)
    src = tmp_path / "src.mp4"
    _make_video(src)
    tpl = {"name": "t", "layout": {"schema": 2, "canvas": {"w": 1080, "h": 1920}, "layers": [
        {"id": "l_game", "name": "Gameplay", "src": {"x": 0.3, "y": 0, "w": 0.4, "h": 1}, "dst": {"x": 0, "y": 0.38, "w": 1, "h": 0.62}, "fit": "cover"},
        {"id": "l_face", "name": "Facecam", "src": {"x": 0, "y": 0, "w": 0.3, "h": 0.4}, "dst": {"x": 0, "y": 0, "w": 1, "h": 0.38}, "fit": "cover"}]},
        "anti_shadowban": {"speed_multiplier": 1.0}, "subtitles": {}}
    monkeypatch.setattr(trimmer, "load_template", lambda name: json.loads(json.dumps(tpl)))
    monkeypatch.setattr("src.bot.trimmer.load_template", lambda name: json.loads(json.dumps(tpl)))

    async def seed():
        await database.init_db()
        cid = await database.create_clip(source_type="vod", source_id="v", channel_id="kai", template_name="t", raw_start=0, raw_end=8,
                                         virality_score=80, title="Test clip", source_video_path=str(src),
                                         rendered_video_path=str(tmp_path / "renders" / "old.mp4"),
                                         flags=json.dumps([{"type": "auto_edited", "style": "punchy"}]))
        return cid
    return asyncio.run(seed())


def test_put_plan_rerenders_with_that_plan(setup):
    cid = setup
    plan = {"zoom_target": {"layer": "l_face", "name": "Facecam"},
            "zooms": [{"id": "z1", "t": 3.0, "amount": 0.2, "on": False, "by": "auto"}, {"id": "z9", "t": 5.0, "amount": 0.3, "on": True, "by": "user"}],
            "emphasis": [], "sfx": [{"id": "s9", "t": 5.0, "cat": "pop", "vol": 0.3, "on": True, "by": "user"}],
            "cold_open": {"on": False}, "hook": {"on": True, "text": "Watch this"}}

    async def go():
        app = web.Application()
        rc.register_clips_routes(app)
        async with TestClient(TestServer(app)) as c:
            g = await (await c.get(f"/api/clips/{cid}/edit-plan")).json()
            assert g["plan"] is None and g["auto_edited"] and [l["id"] for l in g["layers"]] == ["l_game", "l_face"]
            r = await c.put(f"/api/clips/{cid}/edit-plan", json={"plan": plan})
            body = await r.json()
            assert r.status == 200, body
            return body
    body = asyncio.run(go())
    stored = asyncio.run(database.get_clip(cid))
    saved = json.loads(stored["edit_plan"])
    assert [(z["id"], z["on"]) for z in saved["zooms"]] == [("z1", False), ("z9", True)]
    assert saved["sfx"][0]["file"] == "pop.wav"                         # the exact sound is remembered
    assert saved["hook"] == {"on": True, "text": "Watch this"}
    assert body["video_url"].startswith(f"/api/clips/{cid}/video?v=")
    assert stored["render_version"] and str(setup_dir(stored)).startswith("/tmp")
