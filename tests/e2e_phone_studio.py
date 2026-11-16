"""Phone Template Studio gesture suite (needs the server on :8080 and `uvx --with playwright==1.49.1`).
Run: uvx --with playwright==1.49.1 python tests/e2e_phone_studio.py"""
import json
from playwright.sync_api import sync_playwright
BASE="http://localhost:8080"
def rect(pg,sel):
    return pg.evaluate("s=>{const e=document.querySelector(s);if(!e)return null;const r=e.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height}}",sel)
def tpts(cdp,typ,pts): cdp.send("Input.dispatchTouchEvent",{"type":typ,"touchPoints":[{"x":x,"y":y,"id":i} for i,(x,y) in enumerate(pts)]})
def drag(cdp,a,b,steps=8):
    tpts(cdp,"touchStart",[a])
    for i in range(1,steps+1): tpts(cdp,"touchMove",[(a[0]+(b[0]-a[0])*i/steps,a[1]+(b[1]-a[1])*i/steps)])
    tpts(cdp,"touchEnd",[])
def state(pg): return pg.evaluate("()=>{const s=window.__tes?.getState?.();return s?{h:s.history.length,l:s.layout.layers.map(l=>[l.name,l.dst])}:null}")
with sync_playwright() as p:
    b=p.chromium.launch()
    ctx=b.new_context(viewport={"width":390,"height":844},has_touch=True,is_mobile=True,device_scale_factor=2)
    pg=ctx.new_page(); errs=[]
    pg.on("pageerror",lambda e:errs.append(str(e)))
    cdp=ctx.new_cdp_session(pg)
    pg.goto(BASE+"/templates/casoh_layout"); pg.wait_for_timeout(1500)
    out=rect(pg,'[data-testid=stage-output]')
    pg.touchscreen.tap(out['x']+out['w']/2,out['y']+out['h']*0.7); pg.wait_for_timeout(300)   # select gameplay
    undo=lambda: pg.is_enabled('[aria-label=Undo]')
    print("undo enabled before",undo())
    out=rect(pg,'[data-testid=stage-output]')
    drag(cdp,(out['x']+out['w']/2,out['y']+out['h']*0.7),(out['x']+out['w']/2+30,out['y']+out['h']*0.7-40)); pg.wait_for_timeout(300)
    print("after drag undo enabled",undo(),"dirty dot",pg.locator('[aria-label="Unsaved changes"]').count())
    pg.click('[aria-label=Undo]'); pg.wait_for_timeout(200)
    print("after ONE undo, undo enabled (expect False):",undo())
    # pinch zoom on output
    c=(out['x']+out['w']/2,out['y']+out['h']/2)
    tpts(cdp,"touchStart",[(c[0]-30,c[1]),(c[0]+30,c[1])])
    for i in range(1,9): tpts(cdp,"touchMove",[(c[0]-30-i*8,c[1]),(c[0]+30+i*8,c[1])])
    tpts(cdp,"touchEnd",[]); pg.wait_for_timeout(300)
    print("zoom scale",pg.get_attribute('[data-testid=stage-output]','data-view-scale'),"reset btn",pg.locator('[aria-label="Reset zoom"]').count())
    pg.click('[aria-label="Reset zoom"]'); pg.wait_for_timeout(200)
    print("zoom after reset",pg.get_attribute('[data-testid=stage-output]','data-view-scale'))
    # nudge
    pg.click('[aria-label="Nudge right"]'); pg.click('[aria-label="Nudge right"]'); pg.wait_for_timeout(200)
    # sheet drag handle up to full
    h=rect(pg,'[data-testid=sheet-handle]'); 
    drag(cdp,(h['x']+h['w']/2,h['y']+20),(h['x']+h['w']/2,h['y']-400),10); pg.wait_for_timeout(500)
    print("snap after drag up",pg.get_attribute('[data-testid=studio-sheet]','data-snap'),rect(pg,'[data-testid=studio-sheet]'))
    pg.screenshot(path="/tmp/studio_g_full.png")
    # swipe down to close
    h=rect(pg,'[data-testid=sheet-handle]')
    drag(cdp,(h['x']+h['w']/2,h['y']+20),(h['x']+h['w']/2,h['y']+700),10); pg.wait_for_timeout(500)
    print("snap after swipe down",pg.get_attribute('[data-testid=studio-sheet]','data-snap'))
    # layers sheet, reorder via long press
    pg.click('[aria-label=Layers]'); pg.wait_for_timeout(500)
    rows=pg.locator('[data-testid=layer-row]'); print("rows",rows.count(),[rows.nth(i).inner_text().split('\n')[0] for i in range(rows.count())])
    hd=rect(pg,'[data-testid=layer-row]:nth-child(1) [data-testid=layer-handle]') or rect(pg,'[data-testid=layer-handle]')
    r2=pg.locator('[data-testid=layer-row]').nth(1).bounding_box()
    tpts(cdp,"touchStart",[(hd['x']+15,hd['y']+20)]); pg.wait_for_timeout(450)
    for i in range(1,9): tpts(cdp,"touchMove",[(hd['x']+15,hd['y']+20+(r2['y']+r2['height']-hd['y'])*i/8)])
    tpts(cdp,"touchEnd",[]); pg.wait_for_timeout(400)
    rows=pg.locator('[data-testid=layer-row]'); print("after reorder",[rows.nth(i).inner_text().split('\n')[0] for i in range(rows.count())])
    pg.screenshot(path="/tmp/studio_g_layers.png")
    # back gesture closes sheet
    pg.go_back(); pg.wait_for_timeout(500)
    print("after back: url",pg.url.split('8080')[1],"snap",pg.get_attribute('[data-testid=studio-sheet]','data-snap'))
    print('errs',errs[:3]); assert not errs
    b.close()
