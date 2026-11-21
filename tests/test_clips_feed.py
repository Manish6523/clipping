"""Clips page feed: filters, search, sort, paging, per-status counts; download names; hashtag cleanup.
Runs against a throwaway database."""
import asyncio

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

from src import database
from src.web import routes_clips as rc


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    asyncio.run(database.init_db())
    video = tmp_path / "v.mp4"
    video.write_bytes(b"\x00" * 64)

    async def seed():
        ids = []
        rows = [("kaicenat", "Kai robs Waffle House", 91, "pending_approval", "kaicenat funny"),
                ("kaicenat", "Kai bathtub secret", 73, "pending_approval", "#kai"),
                ("ishowspeed", "Speed backflip", 85, "queued", "#speed #backflip"),
                ("ishowspeed", "Speed mom slap", 60, "published", ""),
                ("sypherpk", "Sypher clutch", 88, "pending_approval", "#fortnite")]
        for ch, title, score, status, tags in rows:
            cid = await database.create_clip(source_type="live", source_id="s", channel_id=ch, template_name="temp",
                                             raw_start=0, raw_end=30, virality_score=score, final_score=score, title=title,
                                             description=f"{title} - full story", hashtags=tags,
                                             rendered_video_path=str(video) if ch != "sypherpk" else None)
            async with database.get_db_connection() as c:
                await c.execute("UPDATE clips SET status = ? WHERE id = ?", (status, cid))
                await c.commit()
            ids.append(cid)
        return ids
    return asyncio.run(seed())


async def _get(path):
    app = web.Application()
    rc.register_clips_routes(app)
    async with TestClient(TestServer(app)) as c:
        r = await c.get(path)
        return r.status, (await r.json() if r.content_type == "application/json" else await r.read()), dict(r.headers)


def test_feed_defaults_to_review_queue_with_counts_and_details(db):
    status, body, _ = asyncio.run(_get("/api/clips/feed"))
    assert status == 200
    assert [c["title"] for c in body["clips"]] == ["Sypher clutch", "Kai bathtub secret", "Kai robs Waffle House"]
    assert body["counts"] == {"pending_approval": 3, "approved": 0, "queued": 1, "published": 1, "rejected": 0, "all": 5}
    c = body["clips"][2]
    assert c["description"] == "Kai robs Waffle House - full story" and c["hashtags"] == "#kaicenat #funny"
    assert c["video_url"].startswith(f"/api/clips/{c['id']}/video") and c["download_url"] == f"/api/clips/{c['id']}/download"
    assert body["clips"][0]["video_url"] is None and body["clips"][0]["download_url"] is None     # nothing rendered
    assert "rendered_video_path" not in c and "source_video_path" not in c
    assert {x["id"] for x in body["channels"]} == {"kaicenat", "ishowspeed", "sypherpk"}


def test_filters_sort_search_and_paging(db):
    _, body, _ = asyncio.run(_get("/api/clips/feed?status=all&sort=score&min_score=80"))
    assert [c["final_score"] for c in body["clips"]] == [91, 88, 85]
    _, body, _ = asyncio.run(_get("/api/clips/feed?status=all&channel=ishowspeed"))
    assert {c["title"] for c in body["clips"]} == {"Speed backflip", "Speed mom slap"}
    assert body["counts"]["all"] == 2 and body["counts"]["queued"] == 1        # counts follow the other filters
    _, body, _ = asyncio.run(_get("/api/clips/feed?status=all&q=BACKFLIP"))
    assert [c["title"] for c in body["clips"]] == ["Speed backflip"]
    _, body, _ = asyncio.run(_get("/api/clips/feed?status=all&q=%23fortnite"))     # hashtag search
    assert [c["title"] for c in body["clips"]] == ["Sypher clutch"]
    _, p1, _ = asyncio.run(_get("/api/clips/feed?status=all&limit=2"))
    _, p2, _ = asyncio.run(_get(f"/api/clips/feed?status=all&limit=2&cursor={p1['next_cursor']}"))
    _, p3, _ = asyncio.run(_get(f"/api/clips/feed?status=all&limit=2&cursor={p2['next_cursor']}"))
    seen = [c["id"] for c in p1["clips"] + p2["clips"] + p3["clips"]]
    assert len(seen) == 5 == len(set(seen)) and p3["next_cursor"] is None


def test_download_has_a_title_based_filename(db):
    status, body, headers = asyncio.run(_get(f"/api/clips/{db[0]}/download"))
    assert status == 200 and len(body) == 64
    assert headers["Content-Disposition"] == f'attachment; filename="Kai_robs_Waffle_House_{db[0]}.mp4"'
    status, _, _ = asyncio.run(_get(f"/api/clips/{db[4]}/download"))
    assert status == 404
