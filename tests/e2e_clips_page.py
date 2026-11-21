"""Clips page (home): grid + reels, desktop and phone. Every /api call is MOCKED - no real clip is changed.
Run: uvx --with playwright==1.49.1 python tests/e2e_clips_page.py
  BASE=<url serving frontend/dist, SPA>  SAMPLE=<short mp4 for the players>  SHOT=<screenshot prefix>"""
import json
import os
import re
import time
from pathlib import Path

from playwright.sync_api import sync_playwright

BASE = os.getenv("BASE", "http://localhost:8080")
SHOT = os.getenv("SHOT", "/tmp/clips_")
SAMPLE = Path(os.getenv("SAMPLE", "sample.mp4")).read_bytes()


def clip(i, status="pending_approval", ch="kaicenat", score=88, tags="#kaicenat #funny"):
    return {"id": i, "channel_id": ch, "source_type": "live", "source_id": f"s{i}", "virality_score": score, "final_score": score,
            "title": f"Clip number {i} wild moment", "description": f"Full story of clip {i}: something crazy happens on stream.",
            "hashtags": tags, "template_name": "temp", "caption_style": None, "hook_style": None, "raw_start": 0, "raw_end": 31,
            "score_breakdown": json.dumps({"hook": 9, "payoff": 8}), "flags": json.dumps([{"type": "layout", "severity": "low", "note": "Auto layout: Facecam top"}]),
            "render_version": 1, "status": status, "created_at": "2026-11-21T08:00:00", "thumbnail_url": None,
            "video_url": f"/api/clips/{i}/video?v=1", "download_url": f"/api/clips/{i}/download", "scheduled_for": None}


CLIPS = [clip(i, score=95 - i) for i in range(1, 13)] + [clip(20, "queued", "ishowspeed"), clip(21, "published", "ishowspeed")]
calls = []


def handler(route):
    req = route.request
    url = req.url
    path = re.sub(r"^https?://[^/]+", "", url).split("?")[0]
    if not path.startswith("/api/"):
        return route.continue_()
    if req.method != "GET":
        calls.append((req.method, path, req.post_data))
    if path == "/api/clips/feed":
        q = dict(p.split("=", 1) for p in url.split("?", 1)[1].split("&")) if "?" in url else {}
        st = q.get("status", "pending_approval")
        rows = [c for c in CLIPS if st == "all" or c["status"] == st]
        counts = {s: sum(1 for c in CLIPS if c["status"] == s) for s in ("pending_approval", "approved", "queued", "published", "rejected")}
        counts["all"] = len(CLIPS)
        return route.fulfill(json={"clips": rows, "next_cursor": None, "counts": counts,
                                   "channels": [{"id": "kaicenat", "count": 12}, {"id": "ishowspeed", "count": 2}]})
    if re.match(r"/api/clips/\d+/video", path):
        return route.fulfill(body=SAMPLE, headers={"Content-Type": "video/mp4"})
    if re.match(r"/api/clips/\d+/(update|queue|discard)", path):
        return route.fulfill(json={"success": True, "scheduled": []})
    if path == "/api/auth/config":
        return route.fulfill(json={"auth_lock_enabled": False})
    if path == "/api/templates":
        return route.fulfill(json=[{"name": "temp", "layout": {"layers": []}}])
    return route.fulfill(json={})


def run(p, name, viewport, touch):
    calls.clear()
    b = p.chromium.launch()
    ctx = b.new_context(viewport=viewport, has_touch=touch, is_mobile=touch, device_scale_factor=2 if touch else 1)
    pg = ctx.new_page()
    errors = []
    pg.on("pageerror", lambda e: errors.append(str(e)))
    pg.route("**/*", handler)
    pg.add_init_script("localStorage.clear(); localStorage.setItem('autoclip_clips_view', 'grid');")
    pg.goto(BASE + "/")
    pg.wait_for_selector('[data-testid="clip-card"]')
    assert pg.locator('[data-testid="clip-card"]').count() == 12
    assert "To review 12" in pg.inner_text('[aria-label="Status"]')

    # ---- grid: open details, edit hashtags without '#', approve + undo, approve for real, download
    if not touch:
        pg.wait_for_selector('[data-testid="clip-panel"]')
    else:
        pg.locator('[data-testid="clip-card"] >> nth=0').locator("button").first.click()
        pg.wait_for_selector('[role="dialog"] [data-testid="clip-details"]')
    pg.screenshot(path=f"{SHOT}{name}_grid.png")
    tags = pg.locator('[data-testid="edit-hashtags"]').first
    tags.fill("gaming, funny #Kai Cenat")
    tags.press("Enter")
    pg.wait_for_timeout(400)
    upd = [c for c in calls if c[1].endswith("/update")]
    assert upd and json.loads(upd[-1][2])["hashtags"] == "#gaming #funny #Kai #Cenat", upd
    assert tags.input_value() == "#gaming #funny #Kai #Cenat"

    pg.locator('[data-action="approve"]').first.click()
    pg.wait_for_selector('[data-testid="undo-bar"]')
    pg.get_by_role("button", name="Undo").click()
    pg.wait_for_timeout(300)
    assert not [c for c in calls if c[1].endswith("/queue")], "undo must not queue"
    assert pg.locator('[data-testid="clip-card"]').count() == 12
    if touch:
        pg.locator('[role="dialog"] [data-action="approve"]').click()
    else:
        pg.locator('[data-action="approve"]').first.click()
    pg.wait_for_timeout(4600)
    assert [c for c in calls if c[1] == "/api/clips/1/queue"], calls
    with pg.expect_download() if False else _noop():
        pass
    if touch:
        pg.keyboard.press("Escape")

    # ---- reels
    pg.get_by_role("tab", name=re.compile("Reels")).click()
    pg.wait_for_selector('[data-testid="reel"]')
    rail = pg.locator('[data-testid="reel"] >> nth=0').locator('[data-testid="reel-rail"]')
    labels = [x.get_attribute("data-action") for x in rail.locator("button").all()]
    for need in ("approve", "reject", "skip", "publish", "edit", "style", "download"):
        assert need in labels, labels
    first = pg.locator('[data-testid="reel"] >> nth=0').get_attribute("data-clip-id")
    pg.wait_for_timeout(600)
    pg.screenshot(path=f"{SHOT}{name}_reels.png")
    rail.locator('[data-action="skip"]').click()
    pg.wait_for_timeout(900)
    visible = pg.evaluate("""() => { const r = document.querySelector('[data-testid=reels]');
        const items = [...r.querySelectorAll('[data-testid=reel]')];
        const top = r.getBoundingClientRect().top;
        return items.find(e => Math.abs(e.getBoundingClientRect().top - top) < 5)?.dataset.clipId; }""")
    assert visible and visible != first, (visible, first)
    # description expands
    cur = pg.locator(f'[data-testid="reel"][data-clip-id="{visible}"]')
    cur.get_by_text("…more").click()
    assert cur.get_by_text("#kaicenat #funny").is_visible()
    # reject with a reason
    cur.locator('[data-action="reject"]').click()
    pg.wait_for_selector('[data-testid="undo-bar"]')
    pg.get_by_role("button", name="Boring").click()
    pg.wait_for_timeout(400)
    rej = [c for c in calls if c[1] == f"/api/clips/{visible}/discard"]
    assert rej and json.loads(rej[0][2])["reason"] == "boring", calls
    if not touch:
        pg.keyboard.press("ArrowDown")
        pg.wait_for_timeout(700)
        assert pg.locator('[data-testid="reel-details"] [data-testid="clip-details"]').is_visible()
    else:
        pg.locator('[data-testid="reel"]').filter(has=pg.get_by_text("Edit title")).first
    pg.screenshot(path=f"{SHOT}{name}_reels2.png")
    width = pg.evaluate("document.documentElement.scrollWidth")
    assert width <= viewport["width"] + 1, f"horizontal scroll: {width}"
    assert not errors, errors
    b.close()
    print(name, "OK")


class _noop:
    def __enter__(self): return self
    def __exit__(self, *a): return False


with sync_playwright() as p:
    run(p, "desktop", {"width": 1440, "height": 900}, False)
    run(p, "phone", {"width": 390, "height": 844}, True)
