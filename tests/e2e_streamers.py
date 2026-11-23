"""Streamers page (channels + distribution in one): cards with "Posts to", the per-streamer sheet
(instant posting switches, saved rules), the two-step Add streamer flow, the Accounts tab and the
Google sign-in return. Desktop and phone. Every /api call is MOCKED (stateful in memory).
Run: python tests/spa_server.py &  then  BASE=http://127.0.0.1:8799 uvx --with playwright==1.49.1 python tests/e2e_streamers.py"""
import copy
import json
import os
import re

from playwright.sync_api import sync_playwright

BASE = os.getenv("BASE", "http://127.0.0.1:8799")
SHOT = os.getenv("SHOT", "/tmp/streamers_")


def chan(h, name, live=False, group="IRL", enabled=1):
    return {"id": hash(h) % 1000, "channel_id_or_handle": h, "display_name": name, "platform": "twitch", "template_name": "temp",
            "group_tag": group, "enabled": enabled, "avatar_url": "", "clips_today": 2,
            "settings": {"clip_rules": {"min_length": 15, "max_length": 60, "min_score": 70}, "ai": {"persona": "loud", "good_clip_notes": "rage"}}}


START = {
    "channels": [chan("kaicenat", "Kai Cenat", live=True), chan("ishowspeed", "IShowSpeed"), chan("xqc", "xQc", group="Reaction"),
                 chan("caseoh_", "CaseOh", enabled=0)],
    "streamers": {"kaicenat": {"is_live": True, "title": "GTA RP day 3", "current_mps": 12.5}},
    "templates": [{"name": "temp"}, {"name": "Bottom Left"}],
    "youtube/app-config": {"client_id": "x.apps.googleusercontent.com", "has_secret": True},
    "tiktok/app-config": {"client_key": "", "has_secret": False},
    "youtube/accounts": [{"account_key": "clip2k27", "channel_title": "clip2k27", "status": "connected", "has_token_file": True, "auto_mode": "on",
                          "publish_slots": ["13:00"], "daily_cap": 6, "quota": {"project": "p", "used": 3200, "limit": 10000, "uploads_left_today": 4}}],
    "youtube/mappings": [{"streamer_handle": "kaicenat", "account_key": "clip2k27"}, {"streamer_handle": "ishowspeed", "account_key": "clip2k27"},
                         {"streamer_handle": "caseoh_", "account_key": "clip2k27"}],
    "tiktok/accounts": {"accounts": []},
    "instagram/accounts": {"accounts": [{"key": "streamclip", "username": "streamclip", "display_name": "Stream Clip", "connected": True,
                                         "streamers": ["kaicenat", "ishowspeed", "caseoh_"]}]},
}


def run(p, name, kw):
    data = copy.deepcopy(START)
    writes = []

    def handle(route, req):
        path = req.url.split("/api/", 1)[1].split("?")[0]
        body = json.loads(req.post_data) if req.post_data else None
        if req.method == "GET":
            if path == "auth/config":
                return route.fulfill(json={"auth_lock_enabled": False})
            if path in data:
                return route.fulfill(json=data[path])
            return route.fulfill(json={})
        writes.append((req.method, path, body))
        if path == "channels" and req.method == "POST":
            data["channels"].append(chan(body["channel"], body["channel"], group=body.get("group_tag", "General")))
        if path == "youtube/mappings":
            data["youtube/mappings"] = [m for m in data["youtube/mappings"] if m["streamer_handle"] != body["streamer_handle"]] + \
                [{"streamer_handle": body["streamer_handle"], "account_key": k} for k in body["account_keys"]]
        m = re.match(r"instagram/accounts/(.+)", path)
        if m and req.method == "PATCH":
            for a in data["instagram/accounts"]["accounts"]:
                if a["key"] == m.group(1):
                    a["streamers"] = body["streamers"]
        m = re.match(r"channels/([^/]+)$", path)
        if m and req.method == "PATCH":
            for c in data["channels"]:
                if c["channel_id_or_handle"] == m.group(1):
                    c["settings"] = body.get("settings", c["settings"])
        return route.fulfill(json={"success": True})

    b = p.chromium.launch()
    ctx = b.new_context(**kw)
    pg = ctx.new_page()
    errs = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/api/**", handle)
    pg.goto(BASE + "/channels")
    pg.wait_for_selector("[data-testid=streamer-card]")
    cards = pg.locator("[data-testid=streamer-card]")
    assert cards.count() == 4
    assert cards.first.get_attribute("data-handle") == "kaicenat"                       # live first
    assert "1 live / 3" in pg.inner_text("[data-testid=sum-live]")
    assert "3/4 posting" in pg.inner_text("[data-testid=sum-routed]")
    xqc = pg.locator("[data-testid=streamer-card][data-handle=xqc]")
    assert "Not posting anywhere" in xqc.inner_text()
    pg.screenshot(path=f"{SHOT}{name}_grid.png", full_page=True)

    # "Not posting" filter
    pg.get_by_role("tab", name=re.compile("^Not posting")).click()
    assert cards.count() == 1 and cards.first.get_attribute("data-handle") == "xqc"

    # open xQc's posting, switch on Instagram + YouTube (instant saves)
    xqc.locator("[data-testid=posts-to]").click()
    pg.wait_for_selector("[data-testid=streamer-sheet] [data-testid=posting-picker]")
    assert "streamer=xqc" in pg.url and "s=posting" in pg.url                          # deep link
    pg.locator("[data-testid='post-ig:streamclip']").click()
    pg.locator("[data-testid='post-yt:clip2k27'] [role=switch]").click()
    pg.wait_for_timeout(500)
    ig = [w for w in writes if w[1] == "instagram/accounts/streamclip"][-1]
    assert sorted(ig[2]["streamers"]) == ["caseoh_", "ishowspeed", "kaicenat", "xqc"], ig
    yt = [w for w in writes if w[1] == "youtube/mappings"][-1]
    assert yt[2] == {"streamer_handle": "xqc", "account_keys": ["clip2k27"]}, yt
    assert pg.locator("[data-testid='post-ig:streamclip']").get_attribute("data-on") == "1"
    pg.screenshot(path=f"{SHOT}{name}_posting.png")

    # clip rules: change the min score, save - AI persona must be kept
    pg.get_by_role("tab", name="Clip rules").click()
    pg.get_by_label("Min score").fill("82")
    assert pg.get_by_text("Unsaved changes").is_visible()
    pg.locator("[data-testid=streamer-save]").click()
    pg.wait_for_timeout(400)
    patch = [w for w in writes if w[0] == "PATCH" and w[1] == "channels/xqc"][-1][2]
    assert patch["settings"]["clip_rules"]["min_score"] == 82 and patch["settings"]["ai"]["persona"] == "loud", patch
    pg.keyboard.press("Escape")
    pg.wait_for_timeout(300)
    assert "streamer=" not in pg.url

    # add a streamer from a pasted link; step 2 pre-selects the usual accounts
    pg.get_by_role("tab", name=re.compile("^All")).click()
    pg.locator("[data-testid=add-open]").click()
    pg.get_by_label("Channel handle").fill("https://www.twitch.tv/newguy")
    pg.locator("[data-testid=add-next]").click()
    pg.wait_for_selector("[data-testid=add-step2]")
    assert pg.locator("[data-testid='post-yt:clip2k27']").get_attribute("data-on") == "1"
    assert pg.locator("[data-testid='post-ig:streamclip']").get_attribute("data-on") == "1"
    pg.screenshot(path=f"{SHOT}{name}_add.png")
    pg.locator("[data-testid=add-submit]").click()
    pg.wait_for_selector("[data-testid=streamer-card][data-handle=newguy]")
    pg.wait_for_timeout(500)
    add = [w for w in writes if w[0] == "POST" and w[1] == "channels"][-1][2]
    assert add["channel"] == "newguy" and add["template"] == "temp", add
    ig = [w for w in writes if w[1] == "instagram/accounts/streamclip"][-1][2]
    assert "newguy" in ig["streamers"] and "xqc" in ig["streamers"], ig
    yt = [w for w in writes if w[1] == "youtube/mappings"][-1][2]
    assert yt == {"streamer_handle": "newguy", "account_keys": ["clip2k27"]}, yt

    # accounts tab + Google sign-in return
    pg.locator("[data-testid=tab-accounts]").click()
    pg.wait_for_selector("[data-testid^=dest-yt]")
    assert "tab=accounts" in pg.url and pg.locator("[data-testid=routing-board]").count() == 1
    pg.screenshot(path=f"{SHOT}{name}_accounts.png", full_page=True)
    pg.goto(BASE + "/accounts?connected=clip2k27")
    pg.wait_for_selector("[data-testid^=dest-yt]")
    assert pg.get_by_text('YouTube channel "clip2k27" connected').is_visible()

    over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
    assert over <= 0, f"horizontal overflow {over}"
    assert not errs, errs
    b.close()
    print(name, "OK")


with sync_playwright() as p:
    run(p, "desktop", dict(viewport={"width": 1440, "height": 900}))
    run(p, "phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True))
