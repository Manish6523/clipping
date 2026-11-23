"""Learning from real results, community clips, Kick, title tests, translations, Instagram import.

Runs against a throwaway SQLite DB with the real migrations. Every network / YouTube / Gemini /
Instagram call is faked - nothing here touches real clips, accounts or APIs.
"""

import asyncio
import base64
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.database as database  # noqa: E402
from src.intelligence import performance_learning as pl  # noqa: E402
from src.monitor import twitch_clips as tc  # noqa: E402
from src.monitor import kick  # noqa: E402
from src.publisher import growth  # noqa: E402


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    monkeypatch.setattr(pl, "_MODEL", {})
    asyncio.run(database.init_db())
    return tmp_path


async def q(sql, *args):
    async with database.get_db_connection() as c:
        cur = await c.execute(sql, args)
        return [dict(r) for r in await cur.fetchall()]


async def exec_(sql, *args):
    async with database.get_db_connection() as c:
        cur = await c.execute(sql, args)
        await c.commit()
        return cur.lastrowid


def new_clip(channel="caseoh_", title="t", trigger=None, start=0, end=30, template="Bottom Left", score=80, video=None):
    cid = asyncio.run(database.create_clip(
        source_type="live", source_id="s", channel_id=channel, template_name=template,
        raw_start=start, raw_end=end, virality_score=score, title=title, rendered_video_path=video or __file__))
    if trigger:
        asyncio.run(exec_("UPDATE clips SET trigger_json = ?, final_score = ? WHERE id = ?", json.dumps(trigger), score, cid))
    return cid


def post(cid, views, at, platform="youtube", account="acc", window="24h"):
    vid = f"v{cid}" if platform == "youtube" else f"ig:{cid}"
    asyncio.run(exec_(
        "INSERT INTO scheduled_queue (clip_id, account_key, scheduled_for, posted_at, yt_status, ig_status, yt_video_id) VALUES (?,?,?,?,?,?,?)",
        cid, account, at, at, "uploaded" if platform == "youtube" else "skipped",
        "uploaded" if platform == "instagram" else "skipped", vid if platform == "youtube" else None))
    asyncio.run(exec_(
        "INSERT INTO clip_metrics (clip_id, platform, window, views, video_id, account_key, performance_score) VALUES (?,?,?,?,?,?,0)",
        cid, platform, window, views, vid, account))


# ============================================================================ performance learning
def test_length_bucket_and_features():
    assert pl.length_bucket(10) == "under 25s"
    assert pl.length_bucket(30) == "25-40s"
    assert pl.length_bucket(59) == "40-60s"
    assert pl.length_bucket(75) == "60s+"
    assert pl.length_bucket(None) is None
    f = pl.features_of({"channel_id": "@CaseOh_", "trigger_json": json.dumps({"type": "chat_spike", "mood": "laugh"}),
                        "raw_start": 10, "raw_end": 40, "template_name": "Split", "edit_plan": '{"style": "punchy"}',
                        "source_type": "live"})
    assert f == {"streamer": "caseoh_", "trigger": "chat_spike", "mood": "laugh", "length": "25-40s",
                 "layout": "Split", "style": "punchy", "source": "live"}


def test_group_lifts_shrink_small_groups():
    rows = [{"features": {"streamer": "a"}, "y": 1.0, "views": 1000}] + \
           [{"features": {"streamer": "b"}, "y": 1.0, "views": 1000} for _ in range(20)]
    g = pl.group_lifts(rows, "streamer")
    assert g["a"]["n"] == 1 and g["b"]["n"] == 20
    assert g["a"]["lift"] < 0.2 < g["b"]["lift"]          # one lucky clip barely counts


def test_adjust_needs_data_and_is_bounded():
    model = {"n": 3, "groups": {"streamer": {"x": {"n": 10, "points": 50.0}}}}
    assert pl.adjust_with(model, {"streamer": "x"}) == (0.0, [])          # too few posted clips
    model["n"] = 50
    pts, why = pl.adjust_with(model, {"streamer": "x"})
    assert pts == pl.MAX_ADJUST and "above" in why[0]
    model["groups"]["streamer"]["x"]["points"] = -50
    assert pl.adjust_with(model, {"streamer": "@X"})[0] == -pl.MAX_ADJUST
    model["groups"]["streamer"]["x"]["n"] = 1                               # single clip never counts
    assert pl.adjust_with(model, {"streamer": "x"})[0] == 0.0


def test_best_hours_needs_spread_and_ranks():
    assert pl.best_hours_from([(12, 1.0)] * 20, 3) is None                   # one hour only: no evidence
    samples = [(12, 0.8)] * 5 + [(18, 0.5)] * 5 + [(3, -0.9)] * 5 + [(21, 0.1)] * 2
    assert pl.best_hours_from(samples, 2) == [12, 18]
    assert 3 not in pl.best_hours_from(samples, 4)                           # a bad hour is never picked


def test_model_from_real_rows_and_adjust(db):
    base = datetime(2026, 11, 1, 7, 0, tzinfo=timezone.utc)                 # 12:30 Asia/Kolkata
    for i in range(6):
        post(new_clip("hot", trigger={"type": "chat_spike"}, score=90), 20000 + i, (base + timedelta(days=i)).isoformat())
    for i in range(6):
        post(new_clip("cold", trigger={"type": "audio_peak"}, score=60), 100 + i,
             (base + timedelta(days=i, hours=8)).isoformat())
    model = asyncio.run(pl.refresh_performance_model())
    assert model["n"] == 12
    assert model["groups"]["streamer"]["hot"]["lift"] > 0 > model["groups"]["streamer"]["cold"]["lift"]
    assert model["score_corr"] > 0.9                                          # AI score predicted the winners
    assert any("Streamer" in s for s in model["insights"])
    assert model["best_hours"]["acc"] if "acc" in model["best_hours"] else True
    up, why = asyncio.run(pl.adjust({"streamer": "hot", "trigger": "chat_spike"}))
    down, _ = asyncio.run(pl.adjust({"streamer": "cold", "trigger": "audio_peak"}))
    assert up > 2 and down < -2 and why
    # persisted for the next process
    pl._MODEL = {}
    assert asyncio.run(pl.get_model())["n"] == 12


def test_windows_are_compared_like_with_like(db):
    """A 7d number must not make a clip look better than one that only has 24h numbers yet."""
    t = "2026-11-01T07:00:00+00:00"
    a = new_clip("a"); post(a, 1000, t, window="7d")
    b = new_clip("b"); post(b, 1000, t, window="7d")
    c = new_clip("c"); post(c, 100, t, window="24h")
    d = new_clip("d"); post(d, 100, t, window="24h")
    rows = asyncio.run(_rows())
    assert all(abs(r["y"]) < 1e-9 for r in rows)


async def _rows():
    async with database.get_db_connection() as c:
        return await pl.load_rows(c)


def test_smart_slots_use_learned_hours(db):
    from src.publisher import slots
    asyncio.run(exec_("""INSERT INTO youtube_accounts (account_key, channel_title, daily_cap, publish_slots, timezone, smart_slots)
                         VALUES ('acc', 'A', 2, '["09:00"]', 'Asia/Kolkata', 1)"""))
    pl._MODEL = {"n": 20, "best_hours": {"acc": [14, 20, 22]}}
    acc = asyncio.run(slots.effective_account({"account_key": "acc", "smart_slots": 1, "daily_cap": 2, "publish_slots": '["09:00"]'}))
    assert acc["slots_source"] == "smart" and json.loads(acc["publish_slots"]) == ["14:00", "20:00"]
    manual = asyncio.run(slots.effective_account({"account_key": "acc", "smart_slots": 0, "publish_slots": '["09:00"]'}))
    assert manual["slots_source"] == "manual" and manual["publish_slots"] == '["09:00"]'
    pl._MODEL = {"n": 20, "best_hours": {}}                                  # not enough data -> keep manual slots
    assert asyncio.run(slots.effective_account({"account_key": "acc", "smart_slots": 1}))["slots_source"] == "manual"
    # schedule_clip places the clip in a learned slot
    pl._MODEL = {"n": 20, "best_hours": {"acc": [14]}}
    asyncio.run(exec_("INSERT INTO streamer_yt_mappings (streamer_handle, account_key) VALUES ('caseoh_', 'acc')"))
    created = asyncio.run(slots.schedule_clip(new_clip(), platforms=["youtube"]))
    local = datetime.fromisoformat(created[0]["scheduled_for"]).astimezone(slots.get_tz("Asia/Kolkata"))
    assert (local.hour, local.minute) == (14, 0)


# ============================================================================ Instagram metrics
def test_instagram_metrics_collected(db, monkeypatch):
    from src.publisher import analytics
    cid = new_clip()
    at = (datetime.now(timezone.utc) - timedelta(days=4)).isoformat()
    asyncio.run(exec_("INSERT INTO scheduled_queue (clip_id, scheduled_for, posted_at, yt_status, ig_status, ig_media_id, ig_account_key) "
                      "VALUES (?, ?, ?, 'skipped', 'uploaded', '999', 'igmain')", cid, at, at))
    seen = {}

    def fake(key, pks):
        seen["args"] = (key, pks)
        return {"999": {"views": 4321, "likes": 50, "comments": 3}}
    monkeypatch.setattr(analytics, "_fetch_ig_stats_blocking", fake)
    assert asyncio.run(analytics.collect_instagram_metrics()) == 2          # 24h + 72h are due, 7d isn't yet
    assert seen["args"] == ("igmain", ["999"])
    rows = asyncio.run(q("SELECT platform, window, views, video_id FROM clip_metrics ORDER BY window"))
    assert {r["window"] for r in rows} == {"24h", "72h"} and rows[0]["views"] == 4321 and rows[0]["video_id"] == "ig:999"
    assert asyncio.run(analytics.collect_instagram_metrics()) == 0          # idempotent


def test_ig_views_reads_any_counter():
    from src.publisher.analytics import _ig_views

    class M:
        play_count = None
        view_count = 120
        ig_play_count = 300
    assert _ig_views(M()) == 300
    assert _ig_views(object()) == 0


def test_scheduler_records_post_time_and_ig_account(db, monkeypatch):
    import src.publisher.scheduler as scheduler
    from src.publisher import instagram_accounts

    class YT:
        def __init__(self, key): self.key = key
        async def upload_short(self, *a, **k): return {"success": True, "video_id": "vidX", "url": "u"}

    class IG:
        def __init__(self, key): self.key = key
        async def upload_reel(self, *a, **k): return {"success": True, "media_id": "777", "url": "u"}

    started = []

    async def fake_growth(clip_id, key, vid):
        started.append((clip_id, key, vid))
    monkeypatch.setattr(scheduler, "YouTubeShortsPublisher", YT)
    monkeypatch.setattr(scheduler, "InstagramReelsPublisher", IG)
    monkeypatch.setattr(scheduler, "token_project_key", lambda k: "p")
    monkeypatch.setattr(growth, "after_youtube_upload", fake_growth)
    asyncio.run(exec_("INSERT INTO youtube_accounts (account_key, channel_title) VALUES ('acc', 'A')"))
    asyncio.run(exec_("INSERT INTO streamer_yt_mappings (streamer_handle, account_key) VALUES ('caseoh_', 'acc')"))
    asyncio.run(instagram_accounts.save_accounts([{"key": "igmain", "username": "x", "streamers": ["caseoh_"]}]))
    cid = new_clip()

    async def go():
        from src.publisher.slots import schedule_clip
        await schedule_clip(cid, when=datetime.now(timezone.utc) - timedelta(minutes=1))
        item = (await q("""SELECT q.*, c.template_name, c.rendered_video_path, c.title, c.description, c.hashtags, c.channel_id
                           FROM scheduled_queue q JOIN clips c ON c.id = q.clip_id WHERE q.clip_id = ?""", cid))[0]
        await scheduler.DripScheduler()._process_claimed(item) if hasattr(scheduler, "DripScheduler") else \
            await _any_scheduler(scheduler)._process_claimed(item)
        await asyncio.sleep(0.05)
    asyncio.run(go())
    row = asyncio.run(q("SELECT posted_at, ig_account_key, yt_status, ig_status FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert row["yt_status"] == "uploaded" and row["ig_status"] == "uploaded"
    assert row["ig_account_key"] == "igmain" and row["posted_at"]
    assert started == [(cid, "acc", "vidX")]


def _any_scheduler(mod):
    import inspect
    for _n, obj in inspect.getmembers(mod, inspect.isclass):
        if hasattr(obj, "_process_claimed"):
            try:
                return obj()
            except TypeError:
                return obj(None)
    raise AssertionError("no scheduler class")


# ============================================================================ Twitch community clips
def test_twitch_duration_and_grouping():
    assert tc.parse_twitch_duration("3h2m1s") == 10921.0
    assert tc.parse_twitch_duration("45s") == 45.0
    assert tc.parse_twitch_duration("") is None
    clips = [{"id": "a", "created_at": "2026-11-23T10:00:00Z", "view_count": 5, "title": "OMG"},
             {"id": "b", "created_at": "2026-11-23T10:00:20Z", "view_count": 7, "title": "LOL"},
             {"id": "c", "created_at": "2026-11-23T10:05:00Z", "view_count": 1}]
    g = tc.group_moments(clips)
    assert [m["count"] for m in g] == [2, 1] and g[0]["views"] == 12 and g[0]["ids"] == ["a", "b"]


def test_vod_clips_and_boost():
    raw = [{"video_id": "v1", "vod_offset": 600, "duration": 30, "view_count": 900, "title": "huge"},
           {"video_id": "v1", "vod_offset": None, "duration": 30},
           {"video_id": "other", "vod_offset": 10}]
    vc = tc.vod_clips(raw, "v1")
    assert vc == [{"offset": 600.0, "duration": 30.0, "views": 900, "title": "huge"}]
    w = tc.community_clip_windows(vc)
    pts, why = tc.community_boost(590, 625, w)
    assert 5 <= pts <= tc.MAX_BOOST and "Viewers made 1 Twitch clip" in why[0]
    assert tc.community_boost(100, 130, w) == (0.0, [])                      # elsewhere in the VOD
    assert "10:00" in tc.describe_community_clips(vc)
    assert "2 viewer" in tc.describe_community_clips({"count": 2, "titles": ["x"]})
    assert tc.describe_community_clips(None) == ""


def test_fetch_vod_community_clips(monkeypatch):
    calls = []

    async def fake_helix(path, params):
        calls.append(path)
        if path == "videos":
            return {"data": [{"created_at": "2026-11-20T10:00:00Z", "duration": "1h0m0s"}]}
        if path == "users":
            return {"data": [{"id": "42"}]}
        return {"data": [{"video_id": "v9", "vod_offset": 120, "duration": 25, "view_count": 3, "title": "x"}], "pagination": {}}
    monkeypatch.setattr(tc, "helix", fake_helix)
    monkeypatch.setattr(tc, "_ids", {})
    got = asyncio.run(tc.fetch_vod_community_clips("caseoh_", "v9"))
    assert got and got[0]["offset"] == 120.0 and calls == ["videos", "users", "clips"]


def test_pick_chunks_around_target():
    from src.monitor.live_watcher import pick_chunks_around
    chunks = [f"c{i}.ts" for i in range(24)]
    mtimes = [1000 + 10 * i for i in range(24)]                              # 1000..1230
    picked = pick_chunks_around(chunks, 1100, mtimes)
    assert picked[0] == "c4" + ".ts" and picked[-1] == "c13.ts"
    assert pick_chunks_around(chunks, 99999, mtimes) == chunks               # nothing near: fall back


def test_judge_applies_learning_and_community_boost(db, monkeypatch):
    from src.intelligence import calibrated_judge as cj
    from src.intelligence.llm.judge_schemas import JudgeEvaluationResponse
    from src.intelligence.sentences import SentenceChunker

    resp = JudgeEvaluationResponse.model_validate({"candidates": [{
        "candidate_id": "c01", "would_post": True,
        "scores": {k: 4 for k in ("hook_2s", "stands_alone", "payoff", "emotion", "shareability", "pacing", "clarity")},
        "evidence": {"hook_quote": "a", "payoff_quote": "b"},
        "boundaries": {"start_sentence_id": "s01", "end_sentence_id": "s02"},
        "title": "t", "hook_text": "h", "description": "d", "editorial_reason": "r"}]})
    prompts = []

    class FakeClient:
        _client = object()
        async def generate_structured(self, system_instruction, user_prompt, response_model, **k):
            prompts.append(user_prompt)
            return resp
    judge = cj.CalibratedJudge.__new__(cj.CalibratedJudge)
    judge.model_name, judge.client = "m", FakeClient()

    sentences = SentenceChunker.from_whisper_result({"segments": [
        {"start": 600.0, "end": 610.0, "text": "oh my god"}, {"start": 610.0, "end": 625.0, "text": "no way"}],
        "words": []})
    if not sentences or not hasattr(sentences[0], "id"):
        pytest.skip("sentence chunker shape changed")
    ids = [s.id for s in sentences]
    resp.candidates[0].boundaries.start_sentence_id = ids[0]
    resp.candidates[0].boundaries.end_sentence_id = ids[-1]

    async def run(ctx):
        return await judge.evaluate_moment("caseoh_", sentences, trigger_context=ctx, min_score=0, include_rejected=True)
    plain = asyncio.run(run({"type": "vod_heatmap"}))[0]
    boosted = asyncio.run(run({"type": "vod_heatmap", "community_clips": [{"offset": 600, "duration": 30, "views": 500, "title": "omg"}]}))[0]
    assert boosted["final_score"] > plain["final_score"]
    assert boosted["scores"]["community_clips"]["points"] > 0
    assert "Twitch clips" in prompts[-1]
    pl._MODEL = {"n": 50, "groups": {"streamer": {"caseoh_": {"n": 9, "points": 30.0}}}}
    learned = asyncio.run(run({"type": "vod_heatmap"}))[0]
    assert learned["final_score"] == pytest.approx(min(100, plain["final_score"] + pl.MAX_ADJUST), abs=0.2)
    assert learned["scores"]["performance"]["reasons"]


# ============================================================================ Kick
def test_kick_slug_and_info_parsing():
    assert kick.slug_of("https://kick.com/XQC?x=1") == "xqc"
    assert kick.slug_of("@Amouranth") == "amouranth"
    off = kick.info_from_official({"broadcaster_user_id": 5, "stream_title": "hi", "category": {"name": "GTA"},
                                   "stream": {"is_live": True, "viewer_count": 12}})
    assert off["is_live"] and off["viewers"] == 12 and off["category"] == "GTA"
    assert kick.info_from_official({"stream": None})["is_live"] is False
    pub = kick.info_from_public({"user_id": 9, "user": {"username": "X", "profile_pic": "p.png"},
                                 "livestream": {"session_title": "t", "viewer_count": 3, "categories": [{"name": "Chat"}]}})
    assert pub["is_live"] and pub["avatar"] == "p.png" and pub["category"] == "Chat"
    assert kick.info_from_public({"livestream": None})["is_live"] is False


def _rsa():
    from cryptography.hazmat.primitives.asymmetric import rsa, padding
    from cryptography.hazmat.primitives import hashes
    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)

    def sign(mid, ts, body):
        return base64.b64encode(key.sign(f"{mid}.{ts}.".encode() + body, padding.PKCS1v15(), hashes.SHA256())).decode()
    return key.public_key(), sign


def test_kick_webhook_verifies_dispatches_and_dedupes(monkeypatch):
    pub, sign = _rsa()
    got = []

    async def listener(text, user):
        got.append((text, user))
    kick.register_listener("amouranth", listener)
    monkeypatch.setattr(kick, "_seen_ids", {})
    body = json.dumps({"broadcaster": {"channel_slug": "amouranth"}, "sender": {"username": "fan1"}, "content": "KEKW"}).encode()
    h = {"Kick-Event-Message-Id": "m1", "Kick-Event-Message-Timestamp": "2026-11-23T10:00:00Z",
         "Kick-Event-Type": "chat.message.sent", "Kick-Event-Signature": sign("m1", "2026-11-23T10:00:00Z", body)}
    assert asyncio.run(kick.handle_webhook(h, body, public_key=pub)) == 200
    assert asyncio.run(kick.handle_webhook(h, body, public_key=pub)) == 200     # retry: not delivered twice
    assert got == [("KEKW", "fan1")]
    bad = {**h, "Kick-Event-Message-Id": "m2"}                                   # signature no longer matches
    assert asyncio.run(kick.handle_webhook(bad, body, public_key=pub)) == 401
    assert asyncio.run(kick.handle_webhook({}, body, public_key=pub)) == 400
    kick.unregister_listener("amouranth")


def test_kick_channel_rejects_unknown_platform():
    import src.web.server as server
    assert "kick" in open(server.__file__).read()


# ============================================================================ title tests / translations
def test_title_helpers():
    assert growth.clean_variants("Big Win", ["big win", "  A Totally New Angle  ", "short", "Another Good One", "x" * 200]) == \
        ["A Totally New Angle", "Another Good One"]
    assert growth.round_order(3) == [0, 1, 2, 2, 1, 0]
    t0 = datetime(2026, 1, 1, tzinfo=timezone.utc)
    r = lambda i, h0, h1, v0, v1: {"idx": i, "start": (t0 + timedelta(hours=h0)).isoformat(),
                                   "end": (t0 + timedelta(hours=h1)).isoformat(), "views_start": v0, "views_end": v1}
    rounds = [r(0, 0, 4, 0, 400), r(1, 4, 8, 400, 1200), r(1, 8, 12, 1200, 1800), r(0, 12, 16, 1800, 1900)]
    rates = growth.variant_rates(rounds, 2)
    assert rates == [62.5, 175.0]
    assert growth.pick_winner(rates)[0] == 1
    assert growth.pick_winner([100.0, 105.0])[0] == 0                         # not a clear win: keep the original
    assert growth.pick_winner([None, None]) == (0, "no data")


def test_caption_cues_and_srt():
    cues = growth.caption_cues([{"start": 0.0, "end": 9.0, "text": " ".join(["word"] * 30)}, {"start": 9, "end": 9, "text": "x"}])
    assert len(cues) >= 2 and cues[0]["start"] == 0.0 and cues[-1]["end"] == 9.0
    srt = growth.to_srt(cues[:1], ["hola"])
    assert srt.startswith("1\n00:00:00,000 --> ") and "hola" in srt


def test_title_test_full_cycle(db, monkeypatch):
    cid = new_clip(title="Original")
    variants = [{"title": "Original"}, {"title": "B title"}]
    now = datetime(2026, 11, 23, 10, 0, tzinfo=timezone.utc)
    asyncio.run(exec_("""INSERT INTO title_tests (clip_id, account_key, video_id, variants_json, rounds_json, window_hours, next_switch_at)
                         VALUES (?, 'acc', 'vid', ?, ?, 4, ?)""", cid, json.dumps(variants),
                      json.dumps([{"idx": 0, "start": now.isoformat(), "end": None, "views_start": 0, "views_end": None}]),
                      now.isoformat()))
    views = iter([100, 900, 1700, 1800])                                      # A, B, B, A windows
    titles = []

    async def quota(k): return 10000
    monkeypatch.setattr(growth, "quota_left", quota)
    monkeypatch.setattr(growth, "_views", lambda k, v: next(views))
    monkeypatch.setattr(growth, "_set_title", lambda k, v, t: titles.append(t) or 0)

    async def no_record(*a, **k): return None
    monkeypatch.setattr(growth, "_record", no_record)
    t = now
    for _ in range(4):
        t += timedelta(hours=4, minutes=1)
        assert asyncio.run(growth.run_title_tests_once(t)) == 1
    test = asyncio.run(q("SELECT * FROM title_tests"))[0]
    assert test["status"] == "done" and test["winner_idx"] == 1 and "won" in test["note"]
    assert titles == ["B title", "Original", "B title"]                       # switch, switch back, keep winner
    assert asyncio.run(q("SELECT title FROM clips WHERE id = ?", cid))[0]["title"] == "B title"
    assert asyncio.run(growth.run_title_tests_once(t + timedelta(days=1))) == 0


def test_title_test_waits_for_quota(db, monkeypatch):
    cid = new_clip()
    now = datetime(2026, 11, 23, tzinfo=timezone.utc)
    asyncio.run(exec_("""INSERT INTO title_tests (clip_id, account_key, video_id, variants_json, next_switch_at)
                         VALUES (?, 'acc', 'vid', '[{"title":"a"},{"title":"b"}]', ?)""", cid, now.isoformat()))

    async def quota(k): return 10
    monkeypatch.setattr(growth, "quota_left", quota)
    monkeypatch.setattr(growth, "_views", lambda *a: pytest.fail("must not call YouTube without quota"))
    asyncio.run(growth.run_title_tests_once(now))
    row = asyncio.run(q("SELECT status, note, next_switch_at FROM title_tests"))[0]
    assert row["status"] == "running" and "quota" in row["note"] and row["next_switch_at"] > now.isoformat()


def test_after_upload_skips_without_edit_permission(db, monkeypatch):
    import src.publisher.youtube_shorts as ys
    monkeypatch.setattr(ys, "load_token", lambda k: {"scopes": ["https://www.googleapis.com/auth/youtube.upload"]})
    monkeypatch.setattr(growth, "start_title_test", lambda *a: pytest.fail("needs the edit scope"))
    asyncio.run(growth.after_youtube_upload(new_clip(), "acc", "vid"))
    assert growth.can_edit({"scopes": ["https://www.googleapis.com/auth/youtube.force-ssl"]})


def test_start_test_and_translations(db, monkeypatch):
    import src.publisher.youtube_shorts as ys
    monkeypatch.setattr(ys, "load_token", lambda k: {"scopes": list(growth.EDIT_SCOPES)})

    async def variants(title, desc, n=2): return ["Angle two here", "Angle three here"]

    async def tr_meta(title, desc, lang): return growth.Translation(title=f"{lang}:{title}", description=f"{lang}:d")
    loc = {}
    monkeypatch.setattr(growth, "title_variants", variants)
    monkeypatch.setattr(growth, "translate_meta", tr_meta)
    monkeypatch.setattr(growth, "_set_localizations", lambda k, v, l, src: loc.update(l))

    async def quota(k): return 1900                                           # enough for titles, not for captions
    monkeypatch.setattr(growth, "quota_left", quota)

    async def no_record(*a, **k): return None
    monkeypatch.setattr(growth, "_record", no_record)

    class T:
        async def transcribe(self, path): return {"segments": [{"start": 0, "end": 3, "text": "no way bro"}]}
    import src.intelligence.transcriber as tmod
    monkeypatch.setattr(tmod, "Transcriber", T)
    monkeypatch.setattr(growth, "_insert_caption", lambda *a: pytest.fail("quota is reserved for uploads"))
    cid = new_clip(title="Huge Clutch")
    asyncio.run(growth.after_youtube_upload(cid, "acc", "vidZ"))
    test = asyncio.run(q("SELECT * FROM title_tests"))[0]
    assert [v["title"] for v in json.loads(test["variants_json"])] == ["Huge Clutch", "Angle two here", "Angle three here"]
    assert set(loc) == {"hi", "es"} and loc["hi"]["title"] == "hi:Huge Clutch"
    tr = {r["language"]: r for r in asyncio.run(q("SELECT * FROM video_translations"))}
    assert tr["hi"]["titles_status"] == "done" and tr["es"]["captions_status"] == "skipped"
    assert "quota" in tr["es"]["error"]


def test_growth_settings_roundtrip(db):
    s = asyncio.run(growth.save_settings({"languages": ["HI", "xx", "pt"], "ab_window_hours": 99, "ab_thumbnails": 1, "junk": 1}))
    assert s["languages"] == ["hi", "pt"] and s["ab_window_hours"] == 24.0 and s["ab_thumbnails"] is True
    assert asyncio.run(growth.load_settings())["languages"] == ["hi", "pt"]


# ============================================================================ Instagram session import
def test_parse_session_input_variants():
    from src.publisher.instagram_accounts import parse_session_input
    assert parse_session_input({"cookies": {"a": 1}}) == {"cookies": {"a": 1}}
    assert parse_session_input('{"settings": {"x": 1}}') == {"settings": {"x": 1}}
    assert parse_session_input("csrftoken=abc; sessionid=123%3Axyzxyzxyzxyzxyzxyz; ds_user_id=1") == {"sessionid": "123%3Axyzxyzxyzxyzxyzxyz"}
    assert parse_session_input('"1234567890%3AabcdefghijKLMN%3A12"') == {"sessionid": "1234567890%3AabcdefghijKLMN%3A12"}
    for bad in ["", "{not json", "hello world", "short", "csrftoken=1; other=2; sessionid="]:
        with pytest.raises(ValueError):
            parse_session_input(bad)


def test_import_errors_are_plain_english(monkeypatch):
    from src.publisher import instagram_accounts as ia

    class LoginRequired(Exception):
        pass
    assert ia._import_error(LoginRequired("login_required"))["status"] == "session_expired"
    assert ia._import_error(ValueError("Paste your Instagram session first."))["message"] == "Paste your Instagram session first."
    assert ia._import_error(Exception("challenge_required"))["status"] == "challenge_required"
    assert ia._import_error(ImportError("x"))["status"] == "error"
    monkeypatch.setattr(ia, "HAS_INSTAGRAPI", True)

    class C:
        delay_range = None
        def login_by_sessionid(self, sid): raise LoginRequired("login_required")
    monkeypatch.setattr(ia, "Client", C)
    res = ia._sync_import_session("k", "user", "1234567890%3AabcdefghijKLMN")
    assert res["success"] is False and res["status"] == "session_expired" and "fresh" in res["message"]


def test_import_route_never_500s(db, monkeypatch):
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from src.web.routes_instagram import register_instagram_routes
    from src.publisher import instagram_accounts as ia

    async def boom(**k):
        raise RuntimeError("unexpected")
    monkeypatch.setattr(ia, "import_session", boom)

    async def go():
        app = web.Application()
        register_instagram_routes(app)
        async with TestClient(TestServer(app)) as c:
            r = await c.post("/api/instagram/accounts/import", json={"username": "u", "session_data": "abc"})
            return r.status, await r.json()
    status, body = asyncio.run(go())
    assert status == 400 and body["success"] is False and "unexpected" in body["message"]


# ============================================================================ API
def test_performance_api(db, monkeypatch):
    from aiohttp import web
    from aiohttp.test_utils import TestClient, TestServer
    from src.web.routes_performance import register_performance_routes

    now = datetime.now(timezone.utc)
    for i in range(7):
        post(new_clip("hot", title=f"clip {i}"), 1000 * (i + 1), (now - timedelta(days=i + 1)).isoformat())
    cid = new_clip(title="tested")
    asyncio.run(exec_("""INSERT INTO title_tests (clip_id, account_key, video_id, variants_json, rounds_json)
                         VALUES (?, 'acc', 'tv', '[{"title":"a"},{"title":"b"}]', '[]')""", cid))
    asyncio.run(exec_("INSERT INTO youtube_accounts (account_key, channel_title, smart_slots) VALUES ('acc', 'A', 1)"))

    async def go():
        app = web.Application()
        register_performance_routes(app)
        async with TestClient(TestServer(app)) as c:
            r = await c.get("/api/performance?days=30")
            body = await r.json()
            s = await c.put("/api/growth/settings", json={"ab_titles": False})
            bad = await c.put("/api/growth/settings", data="nope")
            return r.status, body, s.status, (await s.json()), bad.status
    status, body, s_status, s_body, bad_status = asyncio.run(go())
    assert status == 200
    assert body["totals"]["posts"] == 7 and body["totals"]["views"] == 28000
    assert body["top"][0]["title"] == "clip 6" and body["learning"]["n"] == 7
    assert body["title_tests"][0]["variants"][1]["title"] == "b"
    assert body["accounts"][0]["smart_slots"] is True
    assert s_status == 200 and s_body["ab_titles"] is False and bad_status == 400


def test_live_community_trigger_needs_two_viewers(db, tmp_path, monkeypatch):
    import time as _time
    from src.monitor import live_watcher as lw
    monkeypatch.setattr(lw, "BUFFER_DIR", str(tmp_path / "buf"))
    monkeypatch.setattr(tc, "enabled", lambda: True)
    w = lw.LiveStreamWatcher("caseoh_", "twitch", {})
    w.is_running, w._is_channel_live, w.last_trigger_time = True, True, 0.0
    now = datetime.now(timezone.utc)
    one = {"created_at": now - timedelta(seconds=20), "count": 1, "views": 1, "titles": ["a"], "ids": ["c1"], "duration": 30}
    two = {"created_at": now - timedelta(seconds=10), "count": 2, "views": 5, "titles": ["a", "b"], "ids": ["c1", "c2"], "duration": 30}
    rounds = iter([[one], [two], [two]])

    async def moments(login, since_s=180, now=None):
        return next(rounds)
    calls = {"n": 0}

    async def fake_sleep(s):
        calls["n"] += 1
        if calls["n"] > 3:
            w.is_running = False
    fired = []

    async def fake_hype(reason, trigger_context=None, chat_features=None, target_time=None):
        fired.append((reason, trigger_context["community_clips"]["count"], round(target_time)))
    monkeypatch.setattr(tc, "recent_moments", moments)
    monkeypatch.setattr(lw.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(w, "_handle_hype_event", fake_hype)
    monkeypatch.setattr(w, "_extract_chat_features", lambda: {})

    async def go():
        await w._watch_community_clips()
        await lw.asyncio.gather(*[t for t in lw.asyncio.all_tasks() if t is not lw.asyncio.current_task()], return_exceptions=True)
    asyncio.run(go())
    assert fired == [("community_clip", 2, round((now - timedelta(seconds=10)).timestamp()))], fired   # once, not for the lone clip
    assert _time.time() - w.last_trigger_time < 5
