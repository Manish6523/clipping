"""Publish sheet (Clips page: phone reels + desktop grid) and the TikTok accounts tab.
Publish endpoints are mocked and every other write is blocked, so nothing is really posted or changed.
Run: uvx --with playwright==1.49.1 python tests/e2e_publish_sheet.py   (server on :8080)"""
import json
import re
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
SHOT = "/tmp/publish_"
TARGETS = {
    "channel": "caseoh_",
    "youtube": {"ready": True, "accounts": [{"key": "chaos", "name": "Chaos Live"}], "hint": None},
    "instagram": {"ready": False, "account": None, "hint": "Set an Instagram account on this clip's template"},
    "tiktok": {"ready": True, "account": {"key": "tt1", "name": "Case TT", "mode": "inbox"}, "app_configured": True, "hint": None},
    "status": None,
}


def install_mocks(pg, seen):
    polls = {"n": 0}

    def handle(route, req):
        url, m = req.url, req.method
        if "/api/publish/targets" in url:
            return route.fulfill(json=TARGETS)
        if re.search(r"/api/clips/\d+/publish$", url) and m == "POST":
            body = json.loads(req.post_data)
            seen.append(body)
            st = {"running": body["when"] == "now", "youtube": "uploading" if body["when"] == "now" else "pending",
                  "tiktok": "uploading" if body["when"] == "now" else "pending", "instagram": None,
                  "youtube_urls": [], "scheduled_for": "2030-01-01T10:00:00+00:00", "errors": [], "rows": []}
            return route.fulfill(json={"success": True, "now": body["when"] == "now", "scheduled": [{"queue_id": 1}], "status": st})
        if re.search(r"/api/clips/\d+/publish-status$", url):
            polls["n"] += 1
            done = polls["n"] >= 2
            return route.fulfill(json={"running": not done, "youtube": "uploaded" if done else "uploading",
                                       "tiktok": "uploaded" if done else "uploading", "instagram": None,
                                       "youtube_urls": ["https://youtube.com/shorts/x"] if done else [],
                                       "scheduled_for": None, "errors": [], "rows": []})
        if m in ("POST", "PUT", "PATCH", "DELETE"):
            return route.fulfill(status=403, json={"error": "blocked in test"})
        return route.continue_()
    pg.route("**/api/**", handle)


with sync_playwright() as p:
    b = p.chromium.launch()

    # ---------------- phone: Clips reels -> Publish -> post now
    ctx = b.new_context(viewport={"width": 360, "height": 740}, has_touch=True, is_mobile=True)
    pg = ctx.new_page(); errs = []; seen = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    install_mocks(pg, seen)
    ctx.add_init_script("localStorage.setItem('autoclip_clips_view', 'reels')")
    pg.goto(BASE + "/", wait_until="load"); pg.wait_for_timeout(2500)
    pg.locator("[data-testid=reel] [data-action=publish]").first.click(); pg.wait_for_selector("[data-testid=publish-sheet]")
    pg.wait_for_selector("[data-testid=platform-youtube]")
    assert pg.locator("[data-testid=platform-instagram] input").is_disabled()
    assert pg.locator("[data-testid=platform-youtube] input").is_checked() and pg.locator("[data-testid=platform-tiktok] input").is_checked()
    over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
    pg.screenshot(path=SHOT + "phone_sheet.png")
    pg.click("[data-testid=publish-submit]")
    pg.wait_for_selector("[data-testid=publish-progress] [data-status=uploaded]", timeout=8000)
    assert seen[-1] == {"platforms": ["youtube", "tiktok"], "when": "now"}, seen
    pg.screenshot(path=SHOT + "phone_done.png")
    print("phone ok; h-overflow", over, "errs", errs)
    assert over <= 0 and not errs
    ctx.close()

    # ---------------- desktop: Clips grid side panel -> Publish -> pick a time, TikTok only
    ctx = b.new_context(viewport={"width": 1440, "height": 900})
    pg = ctx.new_page(); errs = []; seen = []
    pg.on("pageerror", lambda e: errs.append(str(e)))
    install_mocks(pg, seen)
    ctx.add_init_script("localStorage.setItem('autoclip_clips_view', 'grid')")
    pg.goto(BASE + "/", wait_until="load"); pg.wait_for_timeout(3000)
    pg.locator("[data-testid=clip-panel] [data-action=publish]").click(); pg.wait_for_selector("[data-testid=platform-youtube]")
    pg.locator("[data-testid=platform-youtube] input").uncheck()
    pg.click("[data-testid=when-pick]")
    assert pg.locator("input[type=datetime-local]").count() == 1
    pg.click("[data-testid=publish-submit]"); pg.wait_for_timeout(500)
    assert seen[-1]["platforms"] == ["tiktok"] and seen[-1]["when"].endswith("Z"), seen
    pg.screenshot(path=SHOT + "desktop.png")
    print("desktop ok; errs", errs)
    assert not errs

    # ---------------- distribution: TikTok app setup opens (no app configured yet)
    pg.goto(BASE + "/accounts", wait_until="load"); pg.wait_for_timeout(1500)
    pg.click("[data-testid=app-tiktok]")
    assert pg.get_by_role("dialog", name="TikTok app").count() == 1
    pg.screenshot(path=SHOT + "accounts_tiktok.png")
    print("accounts ok; errs", errs)
    assert not errs
    ctx.close()
    b.close()
print("OK")
