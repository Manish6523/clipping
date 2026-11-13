"""Source-footage retention for published clips + Telegram problem alerts."""

import asyncio
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import src.database as database  # noqa: E402
from src.monitor import storage_gc, ytdlp  # noqa: E402
from src.notify import alerts  # noqa: E402


class FakeTelegram:
    def __init__(self):
        self.sent = []

    async def send_message(self, chat_id, text, **kw):
        self.sent.append((chat_id, text))


class FakeBot:
    def __init__(self):
        self.bot = FakeTelegram()
        self.admin_id = 42


@pytest.fixture
def bot():
    alerts.reset()
    b = FakeBot()
    alerts.configure(b)
    yield b
    alerts.configure(None)
    alerts.reset()


@pytest.fixture
def db(tmp_path, monkeypatch):
    monkeypatch.setattr(database, "DATABASE_PATH", tmp_path / "t.db")
    asyncio.run(database.init_db())
    return tmp_path


def make_clip(tmp, name, status, published_days_ago=None, pending=False):
    src = tmp / f"{name}.mp4"
    src.write_bytes(b"x" * 1000)
    (tmp / f"{name}.h264preview.mp4").write_bytes(b"p")
    rendered = tmp / f"{name}_final.mp4"
    rendered.write_bytes(b"r")

    async def go():
        cid = await database.create_clip(
            source_type="live", source_id="s", channel_id="c", template_name="Bottom Left",
            raw_start=0, raw_end=10, virality_score=50, title=name,
            source_video_path=str(src), rendered_video_path=str(rendered))
        async with database.get_db_connection() as c:
            when = (datetime.now(timezone.utc) - timedelta(days=published_days_ago or 0)).isoformat()
            await c.execute("UPDATE clips SET status = ?, published_at = ? WHERE id = ?",
                            (status, when if status == "published" else None, cid))
            if pending:
                await c.execute("INSERT INTO scheduled_queue (clip_id, scheduled_for, yt_status, ig_status) "
                                "VALUES (?, ?, 'pending', 'skipped')", (cid, when))
            await c.commit()
        return cid
    return asyncio.run(go()), src, rendered


def test_retention_deletes_only_old_published_sources(db):
    old, old_src, old_render = make_clip(db, "old", "published", published_days_ago=4)
    new, new_src, _ = make_clip(db, "new", "published", published_days_ago=1)
    review, review_src, _ = make_clip(db, "review", "pending_approval")
    partly, partly_src, _ = make_clip(db, "partly", "published", published_days_ago=5, pending=True)

    res = asyncio.run(storage_gc.purge_published_sources(3))
    assert res["clips"] == 1 and res["files"] == 2
    assert not old_src.exists() and not (db / "old.h264preview.mp4").exists()
    assert old_render.exists()                                   # finished video kept
    assert new_src.exists() and review_src.exists() and partly_src.exists()
    # idempotent, and a re-run doesn't touch it again
    assert asyncio.run(storage_gc.purge_published_sources(3))["clips"] == 0
    assert asyncio.run(storage_gc.purge_published_sources(0))["clips"] == 0   # 0 = keep forever


def test_retention_never_deletes_rendered_when_source_is_render(db):
    cid, src, rendered = make_clip(db, "same", "published", published_days_ago=10)

    async def point_at_render():
        async with database.get_db_connection() as c:
            await c.execute("UPDATE clips SET source_video_path = rendered_video_path WHERE id = ?", (cid,))
            await c.commit()
    asyncio.run(point_at_render())
    asyncio.run(storage_gc.purge_published_sources(3))
    assert rendered.exists()


def test_published_at_set_once(db):
    cid, _, _ = make_clip(db, "p", "approved")
    asyncio.run(database.update_clip_status(cid, "published"))
    first = asyncio.run(database.get_clip(cid))["published_at"]
    assert first
    asyncio.run(database.update_clip_status(cid, "published"))
    assert asyncio.run(database.get_clip(cid))["published_at"] == first


def test_retention_setting(db):
    assert asyncio.run(storage_gc.get_retention_days()) == 3
    asyncio.run(database.set_system_setting("source_retention_days", "2"))
    assert asyncio.run(storage_gc.get_retention_days()) == 2


def test_alert_dedupes_and_escapes(bot):
    assert asyncio.run(alerts.alert("upload", "fail <b>x</b>", key="k"))
    assert not asyncio.run(alerts.alert("upload", "fail again", key="k"))      # cooldown
    assert len(bot.bot.sent) == 1 and "&lt;b&gt;" in bot.bot.sent[0][1] and bot.bot.sent[0][0] == 42


def test_alert_without_bot_never_raises():
    alerts.reset()
    alerts.configure(None)
    assert asyncio.run(alerts.alert("disk", "x")) is False


def test_download_alerts(bot, tmp_path, monkeypatch):
    monkeypatch.delenv("YTDLP_COOKIES", raising=False)
    monkeypatch.setattr(ytdlp, "DEFAULT_COOKIES", tmp_path / "c.txt")
    asyncio.run(alerts.download_failed("ERROR: Private video"))                 # bad link: no alert
    assert bot.bot.sent == []
    asyncio.run(alerts.download_failed("ERROR: Sign in to confirm you're not a bot"))
    assert "blocked" in bot.bot.sent[-1][1]
    (tmp_path / "c.txt").write_text("# Netscape\n.youtube.com\tTRUE\t/\tTRUE\t0\tSID\tx\n")
    asyncio.run(alerts.download_failed("ERROR: Sign in to confirm you're not a bot"))
    assert "expired" in bot.bot.sent[-1][1]


def test_cookie_expiry_and_health_alert(bot, tmp_path, monkeypatch):
    soon = int(time.time() + 86400)
    later = int(time.time() + 300 * 86400)
    f = tmp_path / "c.txt"
    f.write_text("# Netscape HTTP Cookie File\n"
                 f".youtube.com\tTRUE\t/\tTRUE\t{later}\tPREF\tx\n"
                 f"#HttpOnly_.youtube.com\tTRUE\t/\tTRUE\t{soon}\t__Secure-3PSID\tx\n"
                 f".youtube.com\tTRUE\t/\tTRUE\t{later}\tSID\tx\n")
    assert ytdlp.cookies_expiry(f) == soon
    monkeypatch.delenv("YTDLP_COOKIES", raising=False)
    monkeypatch.setattr(ytdlp, "DEFAULT_COOKIES", f)
    monkeypatch.setattr(storage_gc, "disk_status", lambda p: {"low": True, "free": 2 * 1024 ** 3, "free_fraction": 0.03})
    asyncio.run(storage_gc.check_health_alerts())
    texts = " ".join(t for _, t in bot.bot.sent)
    assert "Disk nearly full" in texts and "expires in" in texts


def test_scheduler_alerts_on_permanent_upload_failure(bot, db, monkeypatch):
    import src.publisher.scheduler as scheduler

    class Failing:
        def __init__(self, key):
            pass

        async def upload_short(self, *a, **k):
            return {"success": False, "error": "invalid_grant: Token has been expired or revoked."}
    monkeypatch.setattr(scheduler, "YouTubeShortsPublisher", Failing)
    monkeypatch.setattr(scheduler, "token_project_key", lambda key: "p")

    async def go():
        async with database.get_db_connection() as c:
            await c.execute("INSERT INTO youtube_accounts (account_key, channel_title) VALUES ('a', 'A')")
            await c.execute("INSERT INTO streamer_yt_mappings (streamer_handle, account_key) VALUES ('c', 'a')")
            await c.commit()
        cid = await database.create_clip(source_type="live", source_id="s", channel_id="c", template_name="Bottom Left",
                                         raw_start=0, raw_end=10, virality_score=50, title="t", rendered_video_path=__file__)
        from src.publisher.slots import schedule_clip
        await schedule_clip(cid)
        async with database.get_db_connection() as c:
            await c.execute("UPDATE scheduled_queue SET scheduled_for = ?",
                            ((datetime.now(timezone.utc) - timedelta(minutes=1)).isoformat(),))
            await c.commit()
        s = scheduler.DripScheduler()
        for item in await database.get_due_queue_items():
            await s._process_due_item(item)
    asyncio.run(go())
    assert any("reconnect" in t for _, t in bot.bot.sent)
