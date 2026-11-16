"""One-tap publish: platform choice in the queue, TikTok upload (fake TikTok server), token refresh,
scheduler TikTok path, and the publish API. Throwaway DB + temp token dir; nothing is really posted."""

import asyncio
import json
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest
from aiohttp import web
from aiohttp.test_utils import TestClient, TestServer

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.database as database  # noqa: E402
import src.publisher.scheduler as scheduler  # noqa: E402
import src.publisher.tiktok as tiktok  # noqa: E402


class FakeYT:
    calls = []

    def __init__(self, key):
        self.key = key

    async def upload_short(self, video_path, title, description="", hashtags=None, privacy_status="public"):
        FakeYT.calls.append(self.key)
        return {"success": True, "video_id": f"yt_{self.key}", "url": "u", "account_key": self.key}


class FakeTT:
    calls = []
    ok = True

    def __init__(self, key, *a, **k):
        self.key = key

    async def upload(self, video_path, title, hashtags=None):
        FakeTT.calls.append(self.key)
        if FakeTT.ok:
            return {"success": True, "publish_id": "p_1", "status": "SEND_TO_USER_INBOX", "note": "inbox"}
        return {"success": False, "error": "spam_risk_too_many_posts"}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    monkeypatch.setattr(tiktok, "TOKENS_DIR", tmp_path / "tokens")
    monkeypatch.setattr(scheduler, "YouTubeShortsPublisher", FakeYT)
    monkeypatch.setattr(scheduler, "TikTokPublisher", FakeTT)
    monkeypatch.setattr(scheduler, "token_project_key", lambda key: "project-A")
    FakeYT.calls, FakeTT.calls, FakeTT.ok = [], [], True

    async def setup():
        await database.init_db()
        async with database.get_db_connection() as c:
            await c.executescript("""
                INSERT INTO youtube_accounts (account_key, channel_title, daily_cap, publish_slots, timezone, privacy_status)
                VALUES ('chaos', 'Chaos Live', 3, '["12:30","17:30"]', 'UTC', 'public');
                INSERT INTO streamer_yt_mappings (streamer_handle, account_key) VALUES ('caseoh_', 'chaos');
            """)
            await c.commit()
        await tiktok.save_accounts([{"key": "tt1", "display_name": "Case TT", "streamers": ["@CaseOh_"], "mode": "inbox"}])
    asyncio.run(setup())
    return tmp_path


def make_clip(channel="caseoh_"):
    return asyncio.run(database.create_clip(
        source_type="live", source_id="s", channel_id=channel, template_name="Bottom Left",
        raw_start=0, raw_end=10, virality_score=80, title="Big moment", rendered_video_path=__file__,
    ))


async def q(sql, *args):
    async with database.get_db_connection() as c:
        cur = await c.execute(sql, args)
        return [dict(r) for r in await cur.fetchall()]


# ------------------------------------------------------------------ pure helpers

def test_chunk_plan_follows_tiktok_rules():
    small = tiktok.chunk_plan(3 * 1024 * 1024)
    assert small["total_chunk_count"] == 1 and small["chunk_size"] == 3 * 1024 * 1024
    mb = 1024 * 1024
    p = tiktok.chunk_plan(25 * mb + 123)
    assert p["chunk_size"] == 10 * mb and p["total_chunk_count"] == 2            # remainder rides on the last chunk
    assert p["ranges"][-1] == (10 * mb, 25 * mb + 122)
    assert sum(e - s + 1 for s, e in p["ranges"]) == 25 * mb + 123
    with pytest.raises(tiktok.TikTokError):
        tiktok.chunk_plan(0)


def test_caption_and_when_parsing():
    from src.web.routes_publish import parse_when
    assert tiktok.build_caption("Clip", ["#Shorts", "gaming", "#fyp"]) == "Clip #gaming #fyp"
    assert parse_when("slot") is None and parse_when(None) is None
    assert abs((parse_when("now") - datetime.now(timezone.utc)).total_seconds()) < 2
    assert parse_when("2026-12-01T10:00:00").tzinfo is not None
    with pytest.raises(ValueError):
        parse_when("tomorrow-ish")


def test_streamer_mapping(db):
    assert asyncio.run(tiktok.account_for_streamer("caseoh_")) == "tt1"
    assert asyncio.run(tiktok.account_for_streamer("someone")) is None


# ------------------------------------------------------------------ queue + scheduler

def test_schedule_only_chosen_platforms(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip()
    created = asyncio.run(schedule_clip(cid, platforms=["tiktok"]))
    assert len(created) == 1 and created[0]["tiktok"] and not created[0]["youtube"]
    r = asyncio.run(q("SELECT yt_status, ig_status, tt_status, tt_account_key FROM scheduled_queue WHERE clip_id = ?", cid))
    assert r == [{"yt_status": "skipped", "ig_status": "skipped", "tt_status": "pending", "tt_account_key": "tt1"}]

    # change of mind: re-publish to YouTube + TikTok replaces the pending row
    created = asyncio.run(schedule_clip(cid, platforms=["youtube", "tiktok"], replace_pending=True))
    r = asyncio.run(q("SELECT account_key, yt_status, tt_status FROM scheduled_queue WHERE clip_id = ?", cid))
    assert r == [{"account_key": "chaos", "yt_status": "pending", "tt_status": "pending"}]

    with pytest.raises(ValueError):
        asyncio.run(schedule_clip(make_clip("nobody"), platforms=["tiktok"]))   # no TikTok account for them


def test_default_schedule_includes_mapped_tiktok_once(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip()
    asyncio.run(schedule_clip(cid))
    r = asyncio.run(q("SELECT tt_status FROM scheduled_queue WHERE clip_id = ?", cid))
    assert [x["tt_status"] for x in r] == ["pending"]


def test_publish_now_uploads_youtube_and_tiktok(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip()
    asyncio.run(schedule_clip(cid, platforms=["youtube", "tiktok"], when=datetime.now(timezone.utc)))
    res = asyncio.run(scheduler.publish_clip_now(cid, schedule=False))
    assert res["success"] and FakeYT.calls == ["chaos"] and FakeTT.calls == ["tt1"]
    r = asyncio.run(q("SELECT yt_status, tt_status, tt_publish_id FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert r == {"yt_status": "uploaded", "tt_status": "uploaded", "tt_publish_id": "p_1"}
    assert asyncio.run(q("SELECT status FROM clips WHERE id = ?", cid))[0]["status"] == "published"


def test_tiktok_permanent_failure_is_not_retried(db):
    from src.publisher.slots import schedule_clip
    FakeTT.ok = False
    cid = make_clip()
    asyncio.run(schedule_clip(cid, platforms=["tiktok"], when=datetime.now(timezone.utc) - timedelta(minutes=1)))
    asyncio.run(scheduler.publish_clip_now(cid, schedule=False))
    r = asyncio.run(q("SELECT tt_status, attempts, last_error FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert r["tt_status"] in ("failed", "pending") and "TikTok" in r["last_error"]


# ------------------------------------------------------------------ TikTok client against a fake TikTok

def fake_tiktok_app(state):
    app = web.Application(client_max_size=64 * 1024 * 1024)

    def auth_ok(req):
        return req.headers.get("Authorization") == f"Bearer {state['token']}"

    async def token(req):
        form = await req.post()
        state["token_calls"].append(dict(form))
        state["token"] = "fresh"
        return web.json_response({"access_token": "fresh", "refresh_token": "r2", "expires_in": 86400,
                                  "refresh_expires_in": 31536000, "open_id": "o1", "scope": "video.upload"})

    async def init(req):
        assert auth_ok(req)
        body = await req.json()
        state["init"] = body
        return web.json_response({"data": {"publish_id": "pub_9", "upload_url": str(req.url.with_path("/upload"))},
                                  "error": {"code": "ok"}})

    async def upload(req):
        data = await req.read()
        state["chunks"].append((req.headers["Content-Range"], len(data)))
        return web.Response(status=201)

    async def status(req):
        state["polls"] += 1
        st = "PROCESSING_UPLOAD" if state["polls"] < 2 else "SEND_TO_USER_INBOX"
        return web.json_response({"data": {"status": st}, "error": {"code": "ok"}})

    app.router.add_post("/v2/oauth/token/", token)
    app.router.add_post("/v2/post/publish/inbox/video/init/", init)
    app.router.add_put("/upload", upload)
    app.router.add_post("/v2/post/publish/status/fetch/", status)
    return app


def test_tiktok_upload_refreshes_token_and_chunks(db, tmp_path, monkeypatch):
    state = {"token": "old", "token_calls": [], "chunks": [], "polls": 0}
    video = tmp_path / "v.mp4"
    video.write_bytes(b"x" * (12 * 1024 * 1024 + 7))
    tiktok.save_token("tt1", {"access_token": "old", "refresh_token": "r1", "expires_at": time.time() - 10,
                              "refresh_expires_at": time.time() + 1000})
    monkeypatch.setattr(tiktok, "STATUS_POLL_S", 0)

    async def creds():
        return {"client_key": "ck", "client_secret": "cs"}
    monkeypatch.setattr(tiktok, "app_credentials", creds)

    async def go():
        server = TestServer(fake_tiktok_app(state))
        await server.start_server()
        base = str(server.make_url("")).rstrip("/")
        monkeypatch.setattr(tiktok, "API", base)
        monkeypatch.setattr(tiktok, "TOKEN_URL", f"{base}/v2/oauth/token/")
        try:
            return await tiktok.TikTokPublisher("tt1").upload(str(video), "Big moment", ["#gaming"])
        finally:
            await server.close()
    res = asyncio.run(go())
    assert res["success"] and res["status"] == "SEND_TO_USER_INBOX" and res["mode"] == "inbox", res
    assert state["token_calls"][0]["grant_type"] == "refresh_token"
    assert tiktok.load_token("tt1")["access_token"] == "fresh"              # refreshed token saved
    src = state["init"]["source_info"]
    assert src["total_chunk_count"] == 1 and src["video_size"] == 12 * 1024 * 1024 + 7
    assert state["chunks"] == [(f"bytes 0-{12 * 1024 * 1024 + 6}/{12 * 1024 * 1024 + 7}", 12 * 1024 * 1024 + 7)]


def test_expired_refresh_token_asks_to_reconnect(db):
    tiktok.save_token("tt1", {"access_token": "a", "refresh_token": "r", "expires_at": 0, "refresh_expires_at": 0})
    res = asyncio.run(tiktok.TikTokPublisher("tt1").upload(__file__, "t"))
    assert not res["success"] and "reconnect" in res["error"]


# ------------------------------------------------------------------ API

def test_publish_api(db, monkeypatch):
    from src.web.routes_publish import register_publish_routes

    async def no_decision(*a, **k):
        return None
    import src.publisher.auto_approve as aa
    monkeypatch.setattr(aa, "record_human_decision", no_decision)

    async def go():
        app = web.Application()
        register_publish_routes(app)
        async with TestClient(TestServer(app)) as client:
            cid = await database.create_clip(source_type="live", source_id="s", channel_id="caseoh_",
                                              template_name="Bottom Left", raw_start=0, raw_end=10,
                                              virality_score=80, title="t", rendered_video_path=__file__)
            t = await (await client.get(f"/api/publish/targets?clip_id={cid}")).json()
            assert t["youtube"]["ready"] and t["tiktok"]["ready"] and t["tiktok"]["account"]["name"] == "Case TT"
            assert not t["instagram"]["ready"] and t["instagram"]["hint"]

            bad = await client.post(f"/api/clips/{cid}/publish", json={"platforms": []})
            assert bad.status == 400

            r = await client.post(f"/api/clips/{cid}/publish", json={"platforms": ["youtube", "tiktok"], "when": "now"})
            body = await r.json()
            assert r.status == 200 and body["now"] and len(body["scheduled"]) == 1
            for _ in range(50):
                st = await (await client.get(f"/api/clips/{cid}/publish-status")).json()
                if not st["running"]:
                    break
                await asyncio.sleep(0.05)
            assert st["youtube"] == "uploaded" and st["tiktok"] == "uploaded"
            assert st["youtube_urls"] == ["https://youtube.com/shorts/yt_chaos"]

            later = await client.post(f"/api/clips/{cid}/publish", json={"platforms": ["tiktok"], "when": "2030-01-01T10:00:00Z"})
            assert later.status == 400        # TikTok already uploaded for this clip -> nothing new to schedule
    asyncio.run(go())
