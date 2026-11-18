"""Distribution page: destinations, routing board, settings sheet, connect + app setup sheets, desktop and phone.
Every /api call this page makes is MOCKED (no account, mapping or credential is changed).
Run: uvx --with playwright==1.49.1 python tests/e2e_distribution.py   (server on :8080)
Optional: DIST_FIXTURES=<dir with youtube_accounts.json, youtube_mappings.json, channels.json, ...> to use real data."""
import json
import os
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.getenv("BASE", "http://localhost:8080")
SHOT = os.getenv("SHOT", "/tmp/dist_")
FX = os.getenv("DIST_FIXTURES")


def fixtures():
    if FX:
        d = Path(FX)
        load = lambda n, default: json.loads((d / n).read_text()) if (d / n).exists() else default
        data = {
            "youtube/accounts": load("youtube_accounts.json", []), "youtube/mappings": load("youtube_mappings.json", []),
            "youtube/app-config": load("youtube_app-config.json", {}), "tiktok/accounts": load("tiktok_accounts.json", {"accounts": []}),
            "tiktok/app-config": load("tiktok_app-config.json", {}), "channels": load("channels.json", []),
        }
    else:
        acc = lambda k, t, mode, slots: {"account_key": k, "channel_title": t, "custom_url": f"@{k}", "thumbnail_url": "", "status": "connected",
                                         "has_token_file": True, "auto_mode": mode, "min_score_threshold": 85, "publish_slots": slots, "daily_cap": 4,
                                         "timezone": "Asia/Kolkata", "privacy_status": "public", "upcoming_posts": 2,
                                         "quota": {"project": "p1", "used": 1600, "limit": 10000, "uploads_left_today": 5}}
        data = {
            "youtube/accounts": [acc("gaming_main", "Gaming Main", "on", ["13:00", "21:30"]), acc("irl_clips", "IRL Clips", "off", ["18:00"])],
            "youtube/mappings": [{"streamer_handle": "xqc", "account_key": "gaming_main"}],
            "youtube/app-config": {"client_id": "x.apps.googleusercontent.com", "has_secret": True},
            "tiktok/accounts": {"accounts": []}, "tiktok/app-config": {"client_key": "", "has_secret": False, "redirect_uri": "https://x/cb"},
            "channels": [{"channel_id_or_handle": h, "display_name": h, "platform": "twitch", "avatar_url": ""} for h in ("xqc", "caseoh_", "jynxzi")],
        }
    # a TikTok account so both platforms show
    data["tiktok/accounts"]["accounts"].append({"key": "tt_demo", "display_name": "Clips Daily", "username": "clipsdaily", "avatar": "",
                                                "connected": True, "mode": "inbox", "streamers": []})
    return data


DATA = fixtures()
writes = []


def handle(route, req):
    path = req.url.split("/api/", 1)[1].split("?")[0]
    if req.method == "GET" and path in DATA:
        return route.fulfill(json=DATA[path])
    if req.method != "GET":
        writes.append((req.method, path, req.post_data))
        return route.fulfill(json={"success": True})
    return route.continue_()


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome-stable")
    for name, kw in (("desktop", dict(viewport={"width": 1440, "height": 900})),
                     ("phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True))):
        ctx = b.new_context(**kw)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/api/**", handle)
        pg.goto(BASE + "/accounts", wait_until="networkidle"); pg.wait_for_timeout(800)
        n_dest = len(DATA["youtube/accounts"]) + len(DATA["tiktok/accounts"]["accounts"])
        assert pg.locator("[data-testid^=dest-]").count() == n_dest, pg.locator("[data-testid^=dest-]").count()
        pg.wait_for_selector("[data-testid=routing-board]")
        pg.screenshot(path=f"{SHOT}{name}.png", full_page=True)

        # routing: toggle the first streamer onto the TikTok account (optimistic + PATCH sent)
        h = sorted(DATA["channels"], key=lambda c: (c.get("display_name") or c["channel_id_or_handle"]))[0]["channel_id_or_handle"]
        before = len(writes)
        sel = f"[data-testid=route-row-{h}]" if name == "desktop" else f"[data-testid=route-card-{h}]"
        row = pg.locator(sel)
        btn = row.get_by_role("button", name="Clips Daily") if name == "phone" else row.locator("button[aria-label$='Clips Daily']")
        btn.click(); pg.wait_for_timeout(400)
        assert btn.get_attribute("aria-pressed") == "true"
        assert writes[before][0] == "PATCH" and "tt_demo" in writes[before][1] and h in writes[before][2], writes[before:]

        # settings sheet for a YouTube destination
        pg.locator("[data-testid^=dest-yt]").first.click()
        pg.wait_for_selector("[data-testid=dest-sheet]")
        assert pg.get_by_role("radiogroup", name="Approval mode").count() + pg.get_by_label("Approval mode").count() >= 1
        pg.screenshot(path=f"{SHOT}{name}_sheet.png")
        pg.keyboard.press("Escape")

        # connect flow: platform choice -> YouTube step; TikTok without an app -> setup prompt
        pg.click("[data-testid=connect-open]"); pg.wait_for_selector("[data-testid=connect-choose]")
        pg.locator("[data-testid=connect-choose] button", has_text="YouTube").click()
        assert pg.get_by_label("Channel name").count() == 1
        pg.screenshot(path=f"{SHOT}{name}_connect.png")
        pg.keyboard.press("Escape")
        pg.click("[data-testid=app-tiktok]")
        assert pg.get_by_role("dialog", name="TikTok app").count() == 1
        pg.keyboard.press("Escape")

        over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        print(name, "h-overflow", over, "writes", len(writes), "errs", errs)
        assert over <= 0 and not errs
        ctx.close()
    b.close()
print("OK")
