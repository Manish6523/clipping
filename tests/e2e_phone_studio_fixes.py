"""Phone Studio (tabbed Crop / Layout): reference picker, one interactive stage per tab, toolbar never covers a stage,
no control on top of a picture, edge handles grabbable, one-tap slots, match-crop-shape, layer chips.
Run: uvx --with playwright==1.49.1 python tests/e2e_phone_studio_fixes.py   (server on :8080)"""
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
SHOT = "/tmp/studio_tabs_"

PICS_AND_CONTROLS = """()=>{
  const pics=[...document.querySelectorAll('[data-testid=stage-source],[data-testid=stage-output],[data-testid=preview-output]')]
    .map(s=>s.firstElementChild.getBoundingClientRect());
  const ctl=[...document.querySelectorAll('[data-testid=phone-studio] button')]
    .filter(b=>!b.closest('[data-testid=studio-sheet]')&&b.offsetParent!==null)
    .map(b=>[b.getAttribute('aria-label')||b.textContent.trim(),b.getBoundingClientRect()]);
  const inter=(a,b)=>a.x<b.right-1&&b.x<a.right-1&&a.y<b.bottom-1&&b.y<a.bottom-1;
  return ctl.filter(([n,r])=>pics.some(p=>inter(r,p))).map(([n])=>n);
}"""


def box(pg, sel):
    return pg.evaluate("s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}}", sel)


def pic(pg, stage):
    return pg.evaluate("s=>{const e=document.querySelector(s);if(!e)return null;const r=e.firstElementChild.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height,b:r.bottom,r:r.right}}", f"[data-testid={stage}]")


def sel_rect(pg, stage):
    return pg.evaluate("s=>{const e=document.querySelector(s+' [data-testid=gizmo-selected]');if(!e)return null;const r=e.getBoundingClientRect();return [r.x,r.y,r.width,r.height]}", f"[data-testid={stage}]")


def tpts(cdp, typ, pts):
    cdp.send("Input.dispatchTouchEvent", {"type": typ, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})


def no_overflow(pg):
    return pg.evaluate("()=>{const t=document.querySelector('[data-testid=object-toolbar]');return !t||t.scrollWidth<=t.clientWidth+1}")


with sync_playwright() as p:
    b = p.chromium.launch()
    for (w, h) in ((390, 844), (358, 800), (360, 640)):
        ctx = b.new_context(viewport={"width": w, "height": h}, has_touch=True, is_mobile=True, device_scale_factor=2)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        cdp = ctx.new_cdp_session(pg)
        pg.goto(BASE + "/templates/tempo"); pg.wait_for_selector("[data-testid=phone-studio]"); pg.wait_for_timeout(1200)

        # ---- reference picker (lives in the stage bar, never on the picture)
        pg.click("[data-testid=reference-chip]"); pg.wait_for_timeout(300)
        assert pg.locator("[data-testid=ref-channel]").count() >= 1 and pg.locator("[data-testid=ref-upload]").count() == 1
        pg.click("[data-testid=ref-placeholder]"); pg.wait_for_timeout(1000)
        assert "Sample" in pg.inner_text("[data-testid=reference-chip]")

        # ---- LAYOUT tab: only the 9:16 stage is interactive, chips select layers
        pg.click("[data-testid=tab-layout]"); pg.wait_for_timeout(300)
        assert pg.locator("[data-testid=stage-output]").count() == 1 and pg.locator("[data-testid=stage-source]").count() == 0
        chips = [t.strip() for t in pg.locator("[data-testid=layer-chip]").all_inner_texts()]
        assert "Captions" in chips and len(chips) >= 3, chips
        pg.click("[data-testid=layer-chip]:has-text('Gameplay')"); pg.wait_for_timeout(400)
        if pg.locator("[aria-label='Close panel']").count():
            pg.click("[aria-label='Close panel']"); pg.wait_for_timeout(300)
        tb = box(pg, "[data-testid=object-toolbar]"); out = pic(pg, "stage-output")
        assert tb and (tb["y"] >= out["b"] - 0.5), f"toolbar overlaps the stage: {tb} vs {out}"
        assert no_overflow(pg), "toolbar overflows"
        hits = pg.evaluate(PICS_AND_CONTROLS)
        assert not hits, f"controls on top of a stage: {hits}"

        # one-tap slot: Gameplay -> Top fills the top 38 % of the output
        pg.click("[aria-label='Place in a slot']"); pg.wait_for_timeout(150)
        assert no_overflow(pg), "place toolbar overflows"
        pg.click("[data-testid=slot-top]"); pg.wait_for_timeout(300)
        r = sel_rect(pg, "stage-output")
        assert abs(r[1] - out["y"]) < 4 and abs(r[3] - out["h"] * 0.38) < 4, f"slot not applied: {r} in {out}"
        pg.click("[data-testid=slot-bottom]"); pg.click("[aria-label='Done placing']"); pg.wait_for_timeout(200)

        # move mode nudges, then the OUTER half of a corner handle (in the padding) resizes
        pg.click("[aria-label='Move precisely']"); pg.wait_for_timeout(150)
        assert pg.locator("[aria-label='Nudge left']").count() == 1 and no_overflow(pg)
        pg.click("[aria-label='Done moving']")
        before = sel_rect(pg, "stage-output")
        hx, hy = pg.evaluate("()=>{const g=document.querySelector('[data-testid=stage-output] [data-testid=gizmo-selected]');const hh=[...g.querySelectorAll('span.rounded-full')];const c=hh[0].getBoundingClientRect();return [c.x+c.width/2-4,c.y+c.height/2-4]}")
        tpts(cdp, "touchStart", [(hx, hy)])
        for i in range(1, 6): tpts(cdp, "touchMove", [(hx + i * 5, hy + i * 5)])
        tpts(cdp, "touchEnd", []); pg.wait_for_timeout(300)
        after = sel_rect(pg, "stage-output")
        assert after != before, "corner handle drag did nothing"
        pg.screenshot(path=f"{SHOT}{w}x{h}_layout.png")

        # ---- CROP tab: 16:9 is interactive, the result preview is passive (no boxes, no gestures)
        pg.click("[data-testid=tab-crop]"); pg.wait_for_timeout(400)
        assert pg.locator("[data-testid=stage-source]").count() == 1 and pg.locator("[data-testid=stage-output]").count() == 0
        chips = [t.strip() for t in pg.locator("[data-testid=layer-chip]").all_inner_texts()]
        assert "Captions" not in chips, "captions do not exist on the source"
        if pg.locator("[data-testid=preview-output]").count():
            assert pg.locator("[data-testid=preview-output] [data-testid=gizmo-selected]").count() == 0
            assert pg.evaluate("()=>getComputedStyle(document.querySelector('[data-testid=preview-output]')).pointerEvents") == "none"
        hits = pg.evaluate(PICS_AND_CONTROLS)
        assert not hits, f"controls on top of a stage (crop): {hits}"
        src_before = sel_rect(pg, "stage-source")
        pg.click("[aria-label='Match output shape']"); pg.wait_for_timeout(300)
        src_after = sel_rect(pg, "stage-source")
        dst = (1080 * 1.0) / (1920 * 0.62)                      # Gameplay output box: full width, bottom 62 %
        ratio = src_after[2] / src_after[3]
        print(w, h, "crop box before/after match", [round(v) for v in src_before], [round(v) for v in src_after], "ratio", round(ratio, 3), "target", round(dst, 3))
        assert abs(ratio - dst) < 0.06, "crop not matched to the output shape"
        pg.screenshot(path=f"{SHOT}{w}x{h}_crop.png")
        assert not errs, errs
        ctx.close()
    b.close()
print("OK")
