"""Clip Lab auto template card: detect layout, pick a layout, render the test window with it, save (save is MOCKED,
so no template file is written). Needs a lab session (upload one with tests/e2e_clip_lab.py first).
Run: uvx --with playwright==1.49.1 python tests/e2e_auto_template.py   (server on :8080)"""
import json
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"

with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome-stable")
    for name, kw in (("desktop", dict(viewport={"width": 1440, "height": 900})),
                     ("phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True))):
        ctx = b.new_context(**kw)
        pg = ctx.new_page(); errs = []; saved = []
        pg.on("pageerror", lambda e: errs.append(str(e)))

        def guard(route, req):
            if req.url.rstrip("/").endswith("/api/templates") and req.method == "POST":
                saved.append(json.loads(req.post_data))
                return route.fulfill(json={"success": True})
            return route.continue_()
        pg.route("**/api/templates", guard)
        pg.goto(BASE + "/lab", wait_until="load"); pg.wait_for_timeout(800)
        pg.click("[data-testid=lab-sessions] li button >> nth=0")
        pg.wait_for_selector("[data-testid=card-auto]")
        if name == "desktop":
            pg.click("[data-testid=card-auto-run]")
            pg.wait_for_selector("[data-testid=card-auto] [data-testid=job-status][data-status=done]", timeout=180_000)
        pg.wait_for_selector("[data-testid=auto-result]")
        txt = pg.inner_text("[data-testid=auto-result]")
        print(name, "detected:", txt[:140].replace("\n", " | "))
        assert pg.locator("[data-testid^=variant-]").count() >= 2
        imgs_ok = pg.evaluate("()=>[...document.querySelectorAll('[data-testid^=variant-] img')].every(i=>i.complete&&i.naturalWidth>0)")
        assert imgs_ok, "a layout preview image did not load"
        pg.locator("[data-testid^=variant-]").first.click()
        if name == "desktop":
            pg.click("[data-testid=card-auto] button:has-text('Render the test window with it')")
            pg.wait_for_selector("[data-testid=auto-render-video]", timeout=400_000)
            dims = pg.evaluate("""async()=>{const v=document.querySelector('[data-testid=auto-render-video]');
                await new Promise(r=>{if(v.readyState>=1)r();else v.onloadedmetadata=r;setTimeout(r,8000)});return [v.videoWidth,v.videoHeight]}""")
            print("render", dims); assert dims == [1080, 1920]
        nm = pg.input_value("[aria-label='Template name']")
        pg.fill("[aria-label='Template name']", nm + " e2e")
        pg.click("[data-testid=auto-save]"); pg.wait_for_timeout(500)
        assert saved and saved[-1]["name"].endswith(" e2e") and saved[-1]["layout"]["schema"] == 2
        assert pg.locator("text=Open in Studio").count() == 1
        over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
        pg.screenshot(path=f"/tmp/auto_{name}.png", full_page=False)
        pg.locator("[data-testid=card-auto]").screenshot(path=f"/tmp/auto_card_{name}.png")
        print(name, "h-overflow", over, "errs", errs)
        assert over <= 0 and not errs
        ctx.close()
    b.close()
print("OK")
