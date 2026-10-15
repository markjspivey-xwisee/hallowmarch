"""Real two-finger running jumps; a second touch must not depend on click synthesis."""
import asyncio, json, pathlib, sys, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from playwright.async_api import async_playwright
from hmlib import setup, OUT
import mobile_hud as hud
from mobile_ergonomics import wait_for_viewport

FAILS=[]
def check(ok, message, state=None):
    print(('PASS ' if ok else 'FAIL ')+message+(' '+json.dumps(state) if state is not None else ''),flush=True)
    if not ok: FAILS.append(message)

INIT="""window.__testPause=false;const raf=requestAnimationFrame.bind(window);
requestAnimationFrame=cb=>raf(t=>{if(window.__testPause)requestAnimationFrame(cb);else cb(t)});"""
STATE="""()=>{const H=__hm,P=H.GAME.player;return{x:P.x,z:P.z,y:P.y,vy:P.vy,ground:P.onGround,
joy:H.INPUT.joy?{...H.INPUT.joy}:null,keys:H.INPUT.keys.size,look:!!H.INPUT.look,pointers:H.INPUT.pointers.size,
modal:H.UI.modal,downs:window.jumpAudit.slice()}}"""

async def main():
    async with async_playwright() as p:
        browser,page,logs=await setup(p,touch=True,w=393,h=668,init=INIT)
        page.set_default_timeout(30000)
        try:
            await page.evaluate('window.__testPause=true;0')
            await page.evaluate(hud.HELP)
            await page.evaluate("MH.scene('warrior',1);__hm.quality.scale=.5;0")
            spot=await page.evaluate("""()=>{const H=__hm,P=H.GAME.player;
              for(let d=0;d<80;d+=4)for(let a=0;a<6.28;a+=.5){const x=P.x+Math.sin(a)*d,z=P.z+Math.cos(a)*d,y=H.fn.heightAt(x,z);
                if([0,1,2,3,4,5,6,7,8].every(k=>H.fn.isWalkable(x,z+k)&&Math.abs(H.fn.heightAt(x,z+k)-y)<.12))return{x,z};}
              throw Error('No flat running lane');}""")
            await page.evaluate("""()=>{window.jumpAudit=[];document.getElementById('t-jump').addEventListener('pointerdown',e=>
              jumpAudit.push({trusted:e.isTrusted,primary:e.isPrimary,id:e.pointerId}));}""")
            cdp=await page.context.new_cdp_session(page)
            for w,h,hand,release_jump_first in [(393,668,'right',True),(393,668,'left',False),(852,393,'right',False),(852,393,'left',True)]:
                tag=f'{w}x{h} {hand}'
                await page.set_viewport_size({'width':w,'height':h})
                await wait_for_viewport(page)
                await page.evaluate("""({spot,hand})=>{const H=__hm,P=H.GAME.player;H.mobile.applyPrefs({hand},false);
                  H.teleport(spot.x,spot.z);P.y=H.fn.heightAt(P.x,P.z);P.vy=0;P.onGround=true;P.buffs=[];P.motion=null;
                  H.CAM.yaw=0;H.UI.modal=null;jumpAudit.length=0;MH.lay();H.frame(1/60);}""",{'spot':spot,'hand':hand})
                before=await page.evaluate(STATE)
                box=await page.locator('#t-jump').evaluate("e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width/2,y:r.y+r.height/2}}")
                stick={'x':64 if hand=='right' else w-64,'y':round(h*.65),'id':11}
                check(await page.evaluate("p=>document.elementFromPoint(p.x,p.y).id==='scene'",stick),tag+': movement finger lands on the world')
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[stick]})
                stick={**stick,'y':stick['y']-56}
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchMove','touchPoints':[stick]})
                running=await page.evaluate(STATE)
                check(bool(running['joy']) and running['joy']['dy']<-.97,tag+': movement finger holds full sprint',running)
                jump={**box,'id':22}
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[stick,jump]})
                down=await page.evaluate(STATE)
                check(down['vy']>6 and not down['ground'] and bool(down['joy']) and down['joy']['id']==running['joy']['id'],tag+': second finger jumps immediately without releasing sprint',down)
                check(len(down['downs'])==1 and down['downs'][0]['trusted'] and not down['downs'][0]['primary'],tag+': actual secondary pointer activates Jump',down['downs'])
                await page.evaluate('__hm.simulate(.15);0')
                airborne=await page.evaluate(STATE)
                check(airborne['y']>before['y']+.15 and airborne['z']>before['z']+.1,tag+': character rises and moves forward through the air',airborne)
                # CDP names the departing finger for a partial touchEnd.
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[jump if release_jump_first else stick]})
                released=await page.evaluate(STATE)
                check(bool(released['joy'])==release_jump_first,tag+': releasing either finger preserves the other action',released)
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[]})
                await page.evaluate('__hm.simulate(1);0')
                end=await page.evaluate(STATE)
                check(end['ground'] and not end['joy'] and not end['look'] and not end['pointers'] and not end['keys'],tag+': both fingers release cleanly and the jump lands',end)
            # A primary finger can hold Jump until after landing. Its eventual
            # compatibility click must not launch a second jump (or toggle Dive).
            blocked=await page.evaluate('__hm.mobile.touchNoZoom.blocked')
            base=time.time()
            for i in range(2):
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchStart','touchPoints':[jump],'timestamp':base+i*.10})
                check((await page.evaluate(STATE))['vy']>6,f'primary tap {i+1}: Jump activates on pointer-down')
                await page.evaluate('__hm.simulate(1);0')
                await cdp.send('Input.dispatchTouchEvent',{'type':'touchEnd','touchPoints':[],'timestamp':base+i*.10+.04})
                check((await page.evaluate(STATE))['ground'],f'primary tap {i+1}: releasing Jump after landing does not jump twice')
            check(await page.evaluate('__hm.mobile.touchNoZoom.blocked')==blocked+1,
                  'rapid Jump taps exercise zoom prevention without a duplicate activation')
            await page.locator('#t-jump').focus()
            await page.keyboard.press('Enter')
            check((await page.evaluate(STATE))['vy']>6,'keyboard activation of the Jump button still works')
            errors=await page.evaluate('__hm.errors')
            check(not errors and not logs,'no game/browser errors',{'game':errors,'browser':logs})
        finally:
            await browser.close()
            pathlib.Path(OUT,'mobile_multitouch.json').write_text(json.dumps({'failures':FAILS},indent=2))
    print(f'{len(FAILS)} failures',flush=True)
    if FAILS: sys.exit(1)

if __name__=='__main__': asyncio.run(main())
