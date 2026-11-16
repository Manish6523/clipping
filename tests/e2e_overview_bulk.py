"""Overview + bulk template change (phone and desktop). Bulk endpoints are mocked so no real clip is re-rendered.
Run: uvx --with playwright==1.49.1 python tests/e2e_overview_bulk.py   (server on :8080)"""
import json
import re
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
state = {}


def mock(route, request):
    url, method = request.url, request.method
    if url.endswith("/api/clips/bulk-retemplate") and method == "POST":
        ids = json.loads(request.post_data)["clip_ids"]
        state["ids"] = ids
        items = [{"clip_id": i, "status": "queued", "error": None, "video_url": None} for i in ids]
        return route.fulfill(json={"success": True, "batch_id": "b1", "template": "T", "total": len(ids),
                                   "counts": {"queued": len(ids), "rendering": 0, "done": 0, "failed": 0, "cancelled": 0},
                                   "finished": False, "cancelled": False, "items": items})
    if "/api/clips/bulk-retemplate/b1" in url and method == "GET":
        ids = state["ids"]
        items = [{"clip_id": i, "status": "done" if n else "failed", "error": None if n else "source missing", "video_url": "/v"}
                 for n, i in enumerate(ids)]
        return route.fulfill(json={"batch_id": "b1", "template": "T", "total": len(ids),
                                   "counts": {"queued": 0, "rendering": 0, "done": len(ids) - 1, "failed": 1, "cancelled": 0},
                                   "finished": True, "cancelled": False, "items": items})
    route.continue_()


with sync_playwright() as p:
    b = p.chromium.launch()
    for name, kw in (("phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True)),
                     ("desktop", dict(viewport={"width": 1440, "height": 900}))):
        ctx = b.new_context(**kw)
        pg = ctx.new_page()
        errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route(re.compile(r".*/api/clips/bulk-retemplate.*"), mock)
        pg.goto(BASE + "/")
        pg.wait_for_selector("[data-testid=overview-stats]", timeout=8000)
        pg.wait_for_timeout(1200)
        tiles = pg.locator("[data-testid=clip-tile]")
        n = tiles.count()
        over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        print(name, "tiles", n, "sections", pg.locator("[data-testid=overview-section]").count(), "h-overflow", over)
        pg.screenshot(path=f"/tmp/overview_{name}.png")
        assert over <= 0 and n >= 2
        pg.click('button:has-text("Select")')
        tiles.nth(0).locator("button[aria-pressed]").click()
        tiles.nth(1).locator("button[aria-pressed]").click()
        assert pg.locator("[data-testid=bulk-bar]").count() == 1
        pg.click('[data-testid=bulk-bar] button:has-text("Template")')
        pg.wait_for_timeout(600)
        pg.locator("[role=radio]").first.click()
        pg.click('button:has-text("Re-render 2 with")')
        pg.wait_for_selector("[data-testid=bulk-progress]")
        pg.wait_for_timeout(3500)
        st = [pg.locator("[data-testid=bulk-progress] li").nth(i).get_attribute("data-status") for i in range(2)]
        print(name, "bulk statuses", st, "retry visible", pg.locator('button:has-text("Retry failed")').count())
        pg.screenshot(path=f"/tmp/overview_{name}_bulk.png")
        assert st == ["failed", "done"]
        print(name, "errs", errs)
        assert not errs
        ctx.close()
    b.close()
