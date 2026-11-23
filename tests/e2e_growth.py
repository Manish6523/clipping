"""Performance page, queue week view (drag / tap-to-move), Kick (Settings card + Add streamer),
Instagram session-import errors. Desktop and phone. Every /api call is MOCKED.
Run: python tests/spa_server.py &  then  BASE=http://127.0.0.1:8799 uvx --with playwright==1.49.1 python tests/e2e_growth.py"""
import copy
import json
import os
from datetime import datetime, timedelta, timezone

from playwright.sync_api import sync_playwright

BASE = os.getenv("BASE", "http://127.0.0.1:8799")
SHOT = os.getenv("SHOT", "/tmp/growth_")


def local_iso(days, hour, minute=0):
    d = datetime.now().astimezone().replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(days=days)
    return d.astimezone(timezone.utc).isoformat()


PERF = {
    "days": 30,
    "totals": {"posts": 12, "views": 48200, "likes": 900, "avg_retention": 71.5, "median_views": 2100},
    "platforms": {"youtube": {"posts": 10, "views": 41000}, "instagram": {"posts": 2, "views": 7200}},
    "top": [{"clip_id": i, "title": f"Top clip {i}", "channel_id": "kaicenat", "template": "temp", "has_thumb": False,
             "ai_score": 90 - i, "posted_at": "2026-11-20T07:00:00+00:00", "views": 9000 - i * 500, "likes": 10,
             "platforms": {"youtube": {"views": 8000 - i * 500}, "instagram": {"views": 1000}}, "retention": 70} for i in range(1, 6)],
    "bottom": [],
    "daily": [{"date": (datetime(2026, 11, 1) + timedelta(days=i)).date().isoformat(), "posts": 1 + i % 3, "views": 500 + 300 * (i % 7)} for i in range(20)],
    "learning": {"n": 12, "updated_at": "2026-11-23T10:00:00+00:00",
                 "insights": ["Streamer: 'kaicenat' clips do best (median 4,000 views), 'xqc' worst (median 300).",
                              "The AI score somewhat predicts real views (correlation +0.34)."],
                 "score_corr": 0.34, "rubric_corr": {"payoff": 0.4},
                 "groups": {"streamer": {"kaicenat": {"n": 7, "lift": 0.4, "points": 4.0, "median_views": 4000},
                                         "xqc": {"n": 5, "lift": -0.3, "points": -3.0, "median_views": 300}},
                            "trigger": {"chat_spike": {"n": 8, "lift": 0.1, "points": 1.0, "median_views": 2000}}},
                 "hours": [{"hour": 13, "n": 4, "median_views": 5000, "lift": 0.4}, {"hour": 21, "n": 5, "median_views": 900, "lift": -0.2},
                           {"hour": 18, "n": 3, "median_views": 2500, "lift": 0.1}],
                 "best_hours": [13, 18]},
    "accounts": [{"account_key": "clip2k27", "title": "Clip 2k27", "smart_slots": False, "timezone": "Asia/Kolkata",
                  "manual_slots": ["12:30", "17:30"], "daily_cap": 2, "best_hours": [13, 18], "hours": []}],
    "title_tests": [{"id": 7, "clip_id": 3, "video_id": "abc", "account_key": "clip2k27", "status": "running", "current_idx": 1,
                     "winner_idx": None, "note": None, "next_switch_at": "2026-11-23T14:00:00+00:00", "window_hours": 4,
                     "rounds_done": 1, "rounds_total": 6, "has_thumb": False, "created_at": "2026-11-23T08:00:00",
                     "variants": [{"title": "He Actually Did It", "views_per_hour": 120.0}, {"title": "Nobody Expected This Ending", "views_per_hour": None},
                                  {"title": "Chat Lost It Here", "views_per_hour": None}]}],
    "translations": [{"language": "hi", "name": "Hindi", "titles": 3, "captions": 2, "failed": 0}],
    "growth_settings": {"ab_titles": True, "ab_thumbnails": False, "ab_window_hours": 4, "translate_titles": True,
                        "translate_captions": True, "languages": ["hi", "es"]},
    "languages": {"hi": "Hindi", "es": "Spanish", "pt": "Portuguese"},
}

QUEUE = [{"id": 101, "clip_id": 5, "title": "Queued clip one", "channel_id": "kaicenat", "template_name": "temp",
          "scheduled_for": local_iso(1, 12, 30), "yt_status": "pending", "ig_status": "skipped", "account_key": "clip2k27"},
         {"id": 102, "clip_id": 6, "title": "Queued clip two", "channel_id": "xqc", "template_name": "temp",
          "scheduled_for": local_iso(2, 17, 30), "yt_status": "pending", "ig_status": "pending", "account_key": "clip2k27"}]

BASEDATA = {
    "performance": PERF, "queue": QUEUE,
    "youtube/accounts": [{"account_key": "clip2k27", "channel_title": "Clip 2k27", "has_token_file": True, "can_edit_videos": False}],
    "kick/app-config": {"client_id": "", "has_secret": False, "webhook_url": "https://clip.example/api/kick/webhook"},
    "channels": [], "streamers": {}, "templates": [{"name": "temp"}],
    "youtube/app-config": {"client_id": "x", "has_secret": True}, "tiktok/app-config": {"client_key": "", "has_secret": False},
    "tiktok/accounts": {"accounts": []}, "instagram/accounts": {"accounts": []}, "youtube/mappings": [],
}


def run(p, name, kw):
    data = copy.deepcopy(BASEDATA)
    writes = []
    touch = kw.get("has_touch")

    def handle(route, req):
        path = req.url.split("/api/", 1)[1].split("?")[0]
        body = json.loads(req.post_data) if req.post_data else None
        if req.method == "GET":
            if path == "auth/config":
                return route.fulfill(json={"auth_lock_enabled": False})
            return route.fulfill(json=data.get(path, {}))
        writes.append((req.method, path, body))
        if path == "growth/settings":
            data["performance"]["growth_settings"].update(body)
            return route.fulfill(json=data["performance"]["growth_settings"])
        if path == "kick/app-config":
            data["kick/app-config"].update(client_id=body["client_id"], has_secret=True)
        if path.startswith("queue/") and path.endswith("/reschedule"):
            qid = int(path.split("/")[1])
            for q in data["queue"]:
                if q["id"] == qid:
                    q["scheduled_for"] = body["scheduled_for"]
        if path == "instagram/accounts/import":
            return route.fulfill(status=400, json={"success": False, "status": "session_expired", "error": "x",
                                                   "message": "This session is expired or logged out. Copy a fresh sessionid."})
        if path == "channels" and req.method == "POST":
            data["channels"].append({"id": 9, "channel_id_or_handle": body["channel"], "display_name": body["channel"], "platform": body["platform"],
                                     "template_name": "temp", "group_tag": "General", "enabled": 1, "avatar_url": "", "settings": {}})
        return route.fulfill(json={"success": True})

    b = p.chromium.launch()
    ctx = b.new_context(**kw)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/api/**", handle)

    # ---------------------------------------------------------------- Performance
    pg.goto(BASE + "/performance")
    pg.wait_for_selector("[data-testid=perf-stats]")
    assert pg.get_by_text("48k").first.is_visible()
    assert pg.locator("[data-testid=insights] li").count() == 2
    assert pg.locator("[data-testid=top-clip]").count() == 5
    assert pg.get_by_text("need to reconnect").count() + pg.get_by_text("needs to reconnect").count() == 1
    pg.get_by_role("button", name="Trigger").click()
    assert pg.get_by_text("Chat spike").is_visible()
    pg.screenshot(path=f"{SHOT}{name}_perf.png", full_page=True)
    # smart post times
    pg.locator("[data-testid=smart-times] [role=switch]").click()
    pg.wait_for_timeout(300)
    assert ("PATCH", "youtube/accounts/clip2k27", {"smart_slots": True}) in writes, writes
    assert pg.get_by_text("Posting at 13:00, 18:00").is_visible()
    # languages + title test controls
    pg.get_by_role("button", name="Portuguese").click()
    pg.wait_for_timeout(300)
    assert [w for w in writes if w[1] == "growth/settings"][-1][2] == {"languages": ["hi", "es", "pt"]}
    test = pg.locator("[data-testid=title-test]")
    assert test.get_by_text("Testing · window 2/6").is_visible()
    test.get_by_role("button", name="Use").first.click()
    pg.wait_for_timeout(300)
    assert ("POST", "title-tests/7/stop", {"keep": 0}) in writes, writes

    # ---------------------------------------------------------------- Queue week view
    pg.goto(BASE + "/queue")
    pg.get_by_role("tab", name="Week").click()
    pg.wait_for_selector("[data-testid=queue-week]")
    items = pg.locator("[data-testid=week-item]")
    assert items.count() == 2
    item = pg.locator("[data-testid=week-item][data-queue-id='101']")
    item.scroll_into_view_if_needed()
    col = pg.locator("[data-day-col='3']")
    cb = col.bounding_box()
    hour_px = 44
    if touch:
        item.tap()
        assert pg.get_by_role("status").get_by_text("tap the new time").is_visible()
        col.evaluate("(el, y) => el.closest('.overflow-y-auto').scrollTop = y", 15 * hour_px - 100)
        pg.wait_for_timeout(200)
        cb = col.bounding_box()
        pg.touchscreen.tap(cb["x"] + cb["width"] / 2, cb["y"] + 15 * hour_px + 10)
    else:
        ib = item.bounding_box()
        pg.mouse.move(ib["x"] + ib["width"] / 2, ib["y"] + ib["height"] / 2)
        pg.mouse.down()
        col.evaluate("(el, y) => el.closest('.overflow-y-auto').scrollTop = y", 15 * hour_px - 100)
        cb = col.bounding_box()
        pg.mouse.move(cb["x"] + cb["width"] / 2, cb["y"] + 15 * hour_px + 10, steps=8)
        pg.screenshot(path=f"{SHOT}{name}_drag.png")
        pg.mouse.up()
    pg.wait_for_timeout(500)
    moves = [w for w in writes if w[1] == "queue/101/reschedule"]
    assert moves, writes
    when = datetime.fromisoformat(moves[-1][2]["scheduled_for"].replace("Z", "+00:00")).astimezone()
    today = datetime.now().astimezone().date()
    assert (when.date() - today).days == 3 and (when.hour, when.minute) == (15, 0), when
    pg.screenshot(path=f"{SHOT}{name}_week.png")

    # ---------------------------------------------------------------- Kick: Settings card + Add streamer
    pg.goto(BASE + "/settings")
    pg.get_by_role("button", name="YouTube, Kick & Engine").first.click()
    card = pg.locator("[data-testid=kick-app]")
    card.wait_for()
    assert card.get_by_text("https://clip.example/api/kick/webhook").is_visible()
    card.get_by_label("Kick client ID").fill("01KTEST")
    card.get_by_label("Kick client secret").fill("s3cret")
    card.get_by_role("button", name="Save & test").click()
    pg.wait_for_timeout(300)
    assert ("PUT", "kick/app-config", {"client_id": "01KTEST", "client_secret": "s3cret"}) in writes, writes
    assert card.get_by_text("Connected", exact=True).is_visible()

    pg.goto(BASE + "/channels")
    pg.locator("[data-testid=add-open]").click()
    pg.get_by_label("Channel handle").fill("https://kick.com/Amouranth")
    assert pg.get_by_label("Platform").input_value() == "kick"
    pg.locator("[data-testid=add-next]").click()
    pg.locator("[data-testid=add-submit]").click()
    pg.wait_for_timeout(500)
    add = [w for w in writes if w[0] == "POST" and w[1] == "channels"][-1][2]
    assert add["platform"] == "kick" and add["channel"] == "Amouranth", add

    # ---------------------------------------------------------------- Instagram import error is readable
    pg.goto(BASE + "/accounts")
    pg.locator("[data-testid=connect-open]").click()
    pg.locator("[data-testid=connect-choose]").get_by_role("button", name="Instagram").click()
    pg.get_by_role("button", name="Import a browser session instead").click()
    pg.get_by_label("Instagram Username").fill("streamclip")
    pg.locator("textarea").fill("1234567890%3AabcdefghijKLMN%3A12")
    pg.get_by_role("button", name="Import Session").click()
    pg.wait_for_timeout(400)
    sent = [w for w in writes if w[1] == "instagram/accounts/import"][-1][2]
    assert sent["session_data"] == "1234567890%3AabcdefghijKLMN%3A12", sent
    assert pg.get_by_text("This session is expired or logged out").is_visible()
    pg.screenshot(path=f"{SHOT}{name}_ig.png")

    over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
    assert over <= 0, f"horizontal overflow {over}"
    assert not errs, errs
    b.close()
    print(name, "OK")


with sync_playwright() as p:
    run(p, "desktop", dict(viewport={"width": 1440, "height": 900}))
    run(p, "phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True))
