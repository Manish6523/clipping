"""Clip Lab end to end: upload a video, run transcription, loudness, chat, face tracking and a render.
Uses the real lab backend (sandboxed in data/lab/, never creates clips). AI-judge steps are skipped
here because they spend Gemini quota.
Run: uvx --with playwright==1.49.1 python tests/e2e_clip_lab.py <video.mp4>   (server on :8080)"""
import sys
from playwright.sync_api import sync_playwright

BASE = "http://localhost:8080"
VIDEO = sys.argv[1] if len(sys.argv) > 1 else "data/sources/sample.mp4"
SHOT = "/tmp/lab_"


def run_card(pg, card, timeout=240_000):
    pg.click(f"[data-testid={card}-run]")
    pg.wait_for_selector(f"[data-testid={card}] [data-testid=job-status][data-status=done], "
                         f"[data-testid={card}] [data-testid=job-status][data-status=failed]", timeout=timeout)
    st = pg.get_attribute(f"[data-testid={card}] [data-testid=job-status]", "data-status")
    if st == "failed":
        raise AssertionError(f"{card} failed: {pg.inner_text(f'[data-testid={card}] [data-testid=job-status]')}")


with sync_playwright() as p:
    b = p.chromium.launch(executable_path="/usr/bin/google-chrome-stable")
    for name, kw in (("desktop", dict(viewport={"width": 1440, "height": 900})),
                     ("phone", dict(viewport={"width": 390, "height": 844}, has_touch=True, is_mobile=True))):
        ctx = b.new_context(**kw)
        pg = ctx.new_page(); errs = []
        pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.goto(BASE + "/lab", wait_until="load"); pg.wait_for_timeout(1000)
        if name == "desktop":
            pg.set_input_files("[data-testid=lab-file]", VIDEO)
            pg.wait_for_selector("[data-testid=lab-source]", timeout=180_000)
            run_card(pg, "card-transcribe")
            assert pg.locator("[data-testid=transcribe-result]").count() == 1
            run_card(pg, "card-audio")
            pg.click("[data-testid=card-chat] button:has-text('Load sample')")
            run_card(pg, "card-chat")
            assert "laugh" in pg.inner_text("[data-testid=chat-result]")
            # face: drag the box a little, then run
            box = pg.locator("[data-testid=crop-box]").bounding_box()
            pg.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            pg.mouse.down(); pg.mouse.move(box["x"] + box["width"] / 2 + 10, box["y"] + box["height"] / 2 + 5, steps=4); pg.mouse.up()
            run_card(pg, "card-face")
            assert pg.locator("[data-testid=face-debug]").count() == 1 and pg.locator("[data-testid=face-compare]").count() == 1
            print("face:", pg.inner_text("[data-testid=face-result]")[:160].replace("\n", " | "))
            # render with follow face on the facecam layer of the first template that has one
            run_card(pg, "card-render", timeout=400_000)
            dims = pg.evaluate("""async()=>{const v=document.querySelector('[data-testid=render-video]');
                await new Promise(r=>{if(v.readyState>=1)r();else v.onloadedmetadata=r;setTimeout(r,8000)});return [v.videoWidth,v.videoHeight,v.duration]}""")
            print("render video:", dims)
            assert dims[0] == 1080 and dims[1] == 1920
            pg.screenshot(path=SHOT + "desktop.png", full_page=True)
        else:
            pg.click("[data-testid=lab-sessions] li button >> nth=0")
            pg.wait_for_selector("[data-testid=lab-source]")
            pg.wait_for_selector("[data-testid=face-result]")       # previous results load with the session
            over = pg.evaluate("document.documentElement.scrollWidth - innerWidth")
            small = pg.evaluate("""()=>[...document.querySelectorAll('main button, main input, main select')]
                .filter(e=>e.offsetParent&&!e.closest('[data-testid=crop-picker]')).map(e=>e.getBoundingClientRect()).filter(r=>r.height<30).length""")
            print("phone h-overflow", over, "small controls", small)
            pg.screenshot(path=SHOT + "phone.png", full_page=True)
            assert over <= 0
        print(name, "errs", errs)
        assert not errs
        ctx.close()
    b.close()
print("OK")
