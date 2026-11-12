"""Integration tests: per-channel slots, quota guard, retries, double-upload guard, auto-approve trial.

Runs against a throwaway SQLite DB with the real migrations; YouTube uploads are faked.
"""

import asyncio
import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.database as database  # noqa: E402
import src.publisher.scheduler as scheduler  # noqa: E402
from src.publisher.slots import quota_day  # noqa: E402


class FakeUploader:
    calls = []
    mode = "ok"   # ok | transient | permanent

    def __init__(self, key):
        self.key = key

    async def upload_short(self, video_path, title, description="", hashtags=None, privacy_status="public"):
        FakeUploader.calls.append((self.key, privacy_status))
        await asyncio.sleep(0.05)
        if FakeUploader.mode == "transient":
            return {"success": False, "error": "HttpError 503 backendError", "account_key": self.key}
        if FakeUploader.mode == "permanent":
            return {"success": False, "error": "OAuth2 token file not found for YouTube account key", "account_key": self.key}
        return {"success": True, "video_id": f"vid_{self.key}_{len(FakeUploader.calls)}", "url": "u", "account_key": self.key}


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    monkeypatch.setattr(scheduler, "YouTubeShortsPublisher", FakeUploader)
    monkeypatch.setattr(scheduler, "token_project_key", lambda key: "project-A")
    FakeUploader.calls, FakeUploader.mode = [], "ok"

    async def setup():
        await database.init_db()
        async with database.get_db_connection() as c:
            await c.executescript("""
                INSERT INTO youtube_accounts (account_key, channel_title, daily_cap, publish_slots, timezone, privacy_status, auto_mode, min_score_threshold)
                VALUES ('chaos', 'Chaos Live', 2, '["12:30","17:30","21:30"]', 'Asia/Kolkata', 'unlisted', 'trial', 85),
                       ('clutch', 'Clutch Mode', 3, '["09:00"]', 'Asia/Kolkata', 'public', 'on', 80);
                INSERT INTO streamer_yt_mappings (streamer_handle, account_key) VALUES ('caseoh_', 'chaos'), ('caseoh_', 'clutch'),
                                                                                     ('jynxzi', 'chaos');
            """)
            await c.commit()
    asyncio.run(setup())
    return tmp_path


def make_clip(channel="caseoh_", score=50):
    return asyncio.run(database.create_clip(
        source_type="live", source_id="s", channel_id=channel, template_name="Bottom Left",
        raw_start=0, raw_end=10, virality_score=score, title="t", rendered_video_path=__file__,
    ))


async def rows(sql, *args):
    async with database.get_db_connection() as c:
        cur = await c.execute(sql, args)
        return [dict(r) for r in await cur.fetchall()]


def test_schedule_one_row_per_channel_and_idempotent(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip()
    created = asyncio.run(schedule_clip(cid))
    assert sorted(c["account_key"] for c in created) == ["chaos", "clutch"]
    q = asyncio.run(rows("SELECT account_key, ig_status FROM scheduled_queue WHERE clip_id = ? ORDER BY id", cid))
    assert [r["ig_status"] for r in q] == ["pending", "skipped"]          # Instagram only once per clip
    assert asyncio.run(schedule_clip(cid)) == []                           # no duplicates
    assert asyncio.run(rows("SELECT status FROM clips WHERE id = ?", cid))[0]["status"] == "queued"


def test_daily_cap_pushes_to_next_day(db):
    from src.publisher.slots import schedule_clip, to_utc
    from zoneinfo import ZoneInfo
    times = []
    for _ in range(5):
        cid = make_clip("jynxzi")
        times.append(to_utc(asyncio.run(schedule_clip(cid))[0]["scheduled_for"]))
    days = [t.astimezone(ZoneInfo("Asia/Kolkata")).date() for t in times]
    assert times == sorted(times) and len(set(times)) == 5                # ordered, never the same slot twice
    assert max(days.count(d) for d in days) <= 2                          # cap 2/day, whatever the time now
    assert all(t > datetime.now(timezone.utc) for t in times)


def due_now(clip_id):
    async def go():
        async with database.get_db_connection() as c:
            await c.execute("UPDATE scheduled_queue SET scheduled_for = ? WHERE clip_id = ?",
                            ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(), clip_id))
            await c.commit()
    asyncio.run(go())


def run_scheduler_once():
    async def go():
        s = scheduler.DripScheduler()
        for item in await database.get_due_queue_items():
            await s._process_due_item(item)
    asyncio.run(go())


def test_upload_uses_account_privacy_and_records_quota(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip("jynxzi")
    asyncio.run(schedule_clip(cid))
    due_now(cid)
    run_scheduler_once()
    assert FakeUploader.calls == [("chaos", "unlisted")]
    q = asyncio.run(rows("SELECT yt_status, yt_video_id FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert q["yt_status"] == "uploaded" and q["yt_video_id"]
    use = asyncio.run(rows("SELECT SUM(units) AS u FROM youtube_api_usage WHERE quota_day = ?", quota_day()))[0]["u"]
    assert use == 1600
    assert asyncio.run(rows("SELECT status FROM clips WHERE id = ?", cid))[0]["status"] == "published"


def test_quota_exhausted_defers_instead_of_failing(db):
    from src.publisher.slots import schedule_clip
    async def burn():
        async with database.get_db_connection() as c:
            await c.execute("UPDATE youtube_accounts SET quota_units_per_day = 3200 WHERE account_key = 'chaos'")
            for _ in range(2):
                await c.execute("INSERT INTO youtube_api_usage (account_key, project_key, operation, units, quota_day) VALUES ('x', 'project-A', 'videos.insert', 1600, ?)", (quota_day(),))
            await c.commit()
    asyncio.run(burn())
    cid = make_clip("jynxzi")
    asyncio.run(schedule_clip(cid))
    due_now(cid)
    run_scheduler_once()
    assert FakeUploader.calls == []
    q = asyncio.run(rows("SELECT yt_status, scheduled_for, last_error FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert q["yt_status"] == "pending" and "quota" in q["last_error"].lower()
    assert datetime.fromisoformat(q["scheduled_for"]) > datetime.now(timezone.utc)


def test_transient_failure_retries_permanent_does_not(db):
    from src.publisher.slots import schedule_clip
    FakeUploader.mode = "transient"
    cid = make_clip("jynxzi")
    asyncio.run(schedule_clip(cid))
    due_now(cid)
    run_scheduler_once()
    q = asyncio.run(rows("SELECT yt_status, attempts, last_error FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert q["yt_status"] == "pending" and q["attempts"] == 1 and "retry" in q["last_error"]

    FakeUploader.mode = "permanent"
    cid2 = make_clip("jynxzi")
    asyncio.run(schedule_clip(cid2))
    due_now(cid2)
    run_scheduler_once()
    q2 = asyncio.run(rows("SELECT yt_status, attempts FROM scheduled_queue WHERE clip_id = ?", cid2))[0]
    assert q2["yt_status"] == "failed" and q2["attempts"] == 1
    assert asyncio.run(rows("SELECT status FROM clips WHERE id = ?", cid2))[0]["status"] == "approved"
    # a permanent failure (missing token) never reached YouTube -> no quota charged for it
    charged = asyncio.run(rows("SELECT COUNT(*) AS n FROM youtube_api_usage WHERE success = 0"))[0]["n"]
    assert charged == 1                                                    # only the transient (503) attempt


def test_post_now_and_scheduler_never_double_upload(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip("jynxzi")
    asyncio.run(schedule_clip(cid))
    due_now(cid)

    async def race():
        s = scheduler.DripScheduler()
        items = await database.get_due_queue_items()
        await asyncio.gather(scheduler.publish_clip_now(cid), *(s._process_due_item(i) for i in items))
    asyncio.run(race())
    assert len(FakeUploader.calls) == 1


def test_auto_approve_on_and_trial_agreement(db):
    cid = make_clip("caseoh_", score=90)          # clutch=on(80) queues; chaos=trial(85) only logs
    q = asyncio.run(rows("SELECT account_key FROM scheduled_queue WHERE clip_id = ?", cid))
    assert [r["account_key"] for r in q] == ["clutch"]
    d = asyncio.run(rows("SELECT account_key, mode, would_approve FROM auto_decisions WHERE clip_id = ? ORDER BY account_key", cid))
    assert d == [{"account_key": "chaos", "mode": "trial", "would_approve": 1},
                 {"account_key": "clutch", "mode": "on", "would_approve": 1}]

    from src.publisher.auto_approve import agreement_stats, record_human_decision
    low = make_clip("caseoh_", score=60)          # trial would skip
    asyncio.run(record_human_decision(cid, "reject"))   # you disagreed
    asyncio.run(record_human_decision(low, "reject"))   # you agreed
    stats = asyncio.run(agreement_stats())["chaos"]
    assert stats["decided"] == 2 and stats["agreed"] == 1 and stats["false_approvals"] == 1 and stats["agreement_pct"] == 50.0


def test_no_destination_is_reported_not_silently_failed(db):
    from src.publisher.slots import schedule_clip
    cid = make_clip("nobody_mapped")
    asyncio.run(schedule_clip(cid))
    due_now(cid)
    run_scheduler_once()
    q = asyncio.run(rows("SELECT yt_status, last_error FROM scheduled_queue WHERE clip_id = ?", cid))[0]
    assert q["yt_status"] == "skipped" and "No YouTube account mapped" in q["last_error"]


def test_metrics_windows_and_score():
    from src.publisher.analytics import due_windows, performance_score
    pub = datetime(2026, 11, 1, tzinfo=timezone.utc)
    assert due_windows(pub, [], pub + timedelta(hours=25)) == ["24h"]
    assert due_windows(pub, ["24h"], pub + timedelta(days=8)) == ["72h", "7d"]
    assert performance_score(0, None) == 0
    assert 99 <= performance_score(10_000_000, None) <= 100
    assert performance_score(1000, 80) > performance_score(1000, 20)


def test_collect_metrics_and_performance_examples(db, monkeypatch):
    import src.publisher.analytics as analytics
    from src.publisher.slots import schedule_clip
    calls = []

    def fake_fetch(account_key, ids):
        calls.append((account_key, tuple(ids)))
        return {vid: {"views": 1000 * (i + 1), "likes": 1, "comments": 0, "retention_pct": 50.0 + i}
                for i, vid in enumerate(ids)}
    monkeypatch.setattr(analytics, "_fetch_stats_blocking", fake_fetch)

    titles = ["Best one", "Good one", "Meh one", "Worst one"]
    for i, t in enumerate(titles):
        cid = asyncio.run(database.create_clip(source_type="live", source_id="s", channel_id="jynxzi",
                                               template_name="Bottom Left", raw_start=0, raw_end=10,
                                               virality_score=50, title=t, rendered_video_path=__file__))
        asyncio.run(schedule_clip(cid))

        async def mark(cid=cid, i=i):
            async with database.get_db_connection() as c:
                await c.execute("UPDATE scheduled_queue SET yt_status='uploaded', yt_video_id=?, scheduled_for=? WHERE clip_id=?",
                                (f"v{9 - i}", (datetime.now(timezone.utc) - timedelta(days=2)).isoformat(), cid))
                await c.commit()
        asyncio.run(mark())

    written = asyncio.run(analytics.collect_due_metrics())
    assert written == 4 and len(calls) == 1                  # one batched API call, 24h snapshots only
    assert asyncio.run(analytics.collect_due_metrics()) == 0  # never duplicated
    units = asyncio.run(rows("SELECT SUM(units) AS u FROM youtube_api_usage WHERE operation='videos.list'"))[0]["u"]
    assert units == 1
    text = asyncio.run(analytics.performance_examples("jynxzi"))
    assert text and text.index("BEST") < text.index("WORST")
    assert "4,000 views" in text.split("WORST")[0]           # highest views listed as best


def test_storage_gc_keeps_files_of_clips_under_review(db, tmp_path):
    import os, time as _t
    from src.monitor.storage_gc import clean_directory_by_age, get_protected_file_paths
    work = tmp_path / "renders"
    work.mkdir()
    src, ass, stray = work / "c_tight.mp4", work / "c_sub.ass", work / "leftover_part.mp4"
    for f in (src, ass, ass.with_suffix(".json"), work / "c_tight.h264preview.mp4", stray):
        f.write_text("x")
        os.utime(f, (_t.time() - 3600, _t.time() - 3600))   # an hour old
    asyncio.run(database.create_clip(source_type="vod", source_id="s", channel_id="nobody", template_name="t",
                                     raw_start=0, raw_end=5, virality_score=0, title="t",
                                     source_video_path=str(src), subtitle_path=str(ass), rendered_video_path=str(work / "r.mp4")))
    protected = asyncio.run(get_protected_file_paths())
    deleted = clean_directory_by_age(work, max_age_seconds=900, protected_paths=protected)
    assert deleted == 1 and not stray.exists()
    assert src.exists() and ass.exists() and ass.with_suffix(".json").exists() and (work / "c_tight.h264preview.mp4").exists()
