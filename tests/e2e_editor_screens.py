"""Clip editor on 9 screen sizes (phone..1920): overflow, clipped controls, 44px targets on touch, text >= 11px,
video playback, every tool panel. Needs Google Chrome (H.264) at /usr/bin/google-chrome-stable and the server on :8080.
All API writes are intercepted, so the clip is never changed. Run: uvx --with playwright==1.49.1 python tests/e2e_editor_screens.py"""
import json, re
from playwright.sync_api import sync_playwright
BASE="http://localhost:8080"; CLIP=48
SIZES=[("phone-s",360,640,True),("phone",390,844,True),("phone-l",412,915,True),("phone-land",844,390,True),
       ("tablet",768,1024,True),("tablet-land",1024,768,True),("laptop",1366,768,False),("desktop",1440,900,False),("full-hd",1920,1080,False)]
PANELS=["Script","Captions","Length","Publish","Layout","Audio","Presets","Overview"]
METRICS="""(touch)=>{
 const vw=innerWidth, vh=innerHeight, m={};
 m.scrollX=document.documentElement.scrollWidth-vw; m.scrollY=document.documentElement.scrollHeight-vh;
 const vis=e=>{const r=e.getBoundingClientRect();const s=getComputedStyle(e);return r.width>1&&r.height>1&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'};
 const lab=e=>(e.getAttribute('aria-label')||e.getAttribute('title')||e.innerText||e.tagName).trim().replace(/\\s+/g,' ').slice(0,26);
 const ctl=[...document.querySelectorAll('button,a[href],input:not([type=hidden]),select,textarea,[role=tab]')].filter(vis);
 m.controls=ctl.length;
 m.offscreen=[...new Set(ctl.filter(e=>{const r=e.getBoundingClientRect();return r.right>vw+1||r.bottom>vh+1||r.left<-1||r.top<-1}).map(lab))].slice(0,8);
 if(touch){const sm=ctl.filter(e=>{const r=e.getBoundingClientRect();if(['checkbox','radio','range','color'].includes(e.type))return false;return r.height<43.5||r.width<40});m.small=sm.length;m.smallEx=[...new Set(sm.map(e=>{const r=e.getBoundingClientRect();return lab(e)+' '+Math.round(r.width)+'x'+Math.round(r.height)}))].slice(0,10);}
 const tx=[...document.querySelectorAll('body *')].filter(e=>[...e.childNodes].some(n=>n.nodeType===3&&n.textContent.trim().length>1)&&vis(e)&&!e.closest('canvas'));
 const tiny=tx.filter(e=>parseFloat(getComputedStyle(e).fontSize)<11); m.tiny=tiny.length; m.tinyEx=[...new Set(tiny.map(e=>e.innerText.trim().slice(0,18)+'@'+getComputedStyle(e).fontSize))].slice(0,6);
 m.canvases=[...document.querySelectorAll('canvas')].filter(vis).map(c=>{const r=c.getBoundingClientRect();return [Math.round(r.width),Math.round(r.height),Math.round(r.y)]});
 const v=document.querySelector('video'); m.video=v?{ready:v.readyState,dur:Math.round(v.duration||0),src:!!(v.currentSrc||v.src)}:null;
 // overlapping fixed/absolute UI on the canvases (controls drawn on top of the picture)
 const cv=[...document.querySelectorAll('canvas')].filter(vis).map(c=>c.getBoundingClientRect());
 return m;
}"""
report={}
with sync_playwright() as p:
    b=p.chromium.launch(executable_path="/usr/bin/google-chrome-stable", args=["--autoplay-policy=no-user-gesture-required"])
    for name,w,h,touch in SIZES:
        ctx=b.new_context(viewport={"width":w,"height":h},has_touch=touch,is_mobile=touch and w<1024,device_scale_factor=2 if touch else 1)
        pg=ctx.new_page(); errs=[]; writes=[]
        pg.on("pageerror",lambda e:errs.append("PAGE "+str(e)[:140]))
        pg.on("console",lambda m:errs.append(m.text[:140]) if m.type=="error" else None)
        def guard(route,req):
            if req.method!="GET": writes.append(req.method+" "+req.url.split("8080")[-1][:50]); return route.fulfill(status=200,json={"success":True})
            route.continue_()
        pg.route(re.compile(r".*/api/.*"),guard)
        pg.goto(f"{BASE}/clips/{CLIP}/editor",wait_until="load",timeout=30000); pg.wait_for_timeout(3500)
        r={"layout":pg.evaluate("()=>document.querySelector('[class*=grid-cols-\\\\[1fr_320px\\\\]]')?'desktop-3col':(document.querySelector('nav')?.innerText||'').includes('Script')?'phone':'?'")}
        r.update(pg.evaluate(METRICS,touch))
        pg.screenshot(path=f"/tmp/editor_audit/{name}.png")
        # playback
        play=pg.locator("button[title*='Play'], button[aria-label*='Play'], button[aria-label*='play']").first
        if play.count():
            t0=pg.evaluate("document.querySelector('video')?.currentTime||0"); 
            try: play.click(timeout=3000); pg.wait_for_timeout(1500)
            except Exception as e: errs.append("play click: "+str(e)[:80])
            t1=pg.evaluate("document.querySelector('video')?.currentTime||0"); r["playAdvances"]=round(t1-t0,2)
            try: play.click(timeout=2000)
            except Exception: pass
        else: r["playAdvances"]="no play button"
        # panels
        opened={}
        for lab in PANELS:
            loc=pg.locator(f"button:visible:text-is('{lab}'), button:visible:has(span:text-is('{lab}'))").first
            if not loc.count():
                more=pg.locator("button:visible:text-is('More'), button:visible:has(span:text-is('More'))").first
                if more.count():
                    try: more.click(timeout=2000); pg.wait_for_timeout(300)
                    except Exception: pass
                    loc=pg.locator(f"button:visible:text-is('{lab}'), button:visible:has(span:text-is('{lab}'))").first
            if not loc.count(): opened[lab]="n/a"; continue
            try:
                loc.click(timeout=3000); pg.wait_for_timeout(500)
                mm=pg.evaluate(METRICS,touch)
                big=max([c[1] for c in mm["canvases"]] or [0])
                opened[lab]={"offscreen":mm["offscreen"][:4],"stageH":big,"scrollY":mm["scrollY"]}
                pg.screenshot(path=f"/tmp/editor_audit/{name}_{lab}.png")
                back=pg.locator("button[aria-label='Back to main tools']:visible").first
                if back.count(): back.click(); pg.wait_for_timeout(200)
            except Exception as e: opened[lab]="ERR "+str(e)[:80]
        r["panels"]=opened; r["errors"]=errs[:6]; r["writesBlocked"]=writes[:6]
        report[name]=r; ctx.close()
    b.close()
json.dump(report,open("/tmp/editor_audit/report.json","w"),indent=1)
for n,r in report.items():
    print(f"\n== {n} [{r['layout']}] scrollX {r['scrollX']} scrollY {r['scrollY']} | controls {r['controls']} small {r.get('small','-')} tiny {r['tiny']} | canvases {r['canvases']} | video {r['video']} | play +{r['playAdvances']}s")
    if r['offscreen']: print("   OFFSCREEN:",r['offscreen'])
    if r.get('smallEx'): print("   small:",r['smallEx'])
    if r['tinyEx']: print("   tiny:",r['tinyEx'])
    print("   panels:",{k:(v if isinstance(v,str) else f"stageH {v['stageH']}{' off:'+str(v['offscreen']) if v['offscreen'] else ''}{' scrollY '+str(v['scrollY']) if v['scrollY']>0 else ''}") for k,v in r['panels'].items()})
    if r['errors']: print("   ERRORS:",r['errors'])
    if r['writesBlocked']: print("   writes attempted (blocked):",r['writesBlocked'])
