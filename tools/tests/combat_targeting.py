"""Actual game target selection and tower-name occlusion; local synthetic world only."""
import asyncio, json, pathlib, sys
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, human_play, OUT
from playwright.async_api import async_playwright

FAILS = []
def check(ok, label):
    print(('PASS ' if ok else 'FAIL ') + label, flush=True)
    if not ok: FAILS.append(label)

SCENE = r"""(() => {
  const H=__hm,F=H.fn,P=H.GAME.player;
  const T=H.towers.list().find(t=>t.kind==='drum'&&t.role==='corner');
  for(const e of H.ENT.slice())if(e!==P&&Math.hypot(e.x-T.wx,e.z-T.wz)<70)F.removeEnt(e);
  P.x=P.prevX=T.wx;P.z=P.prevZ=T.wz-.7;P.y=T.S.y+T.yG;
  P.target=null;P.hp=P.maxHp;P.yaw=H.CAM.yaw=0;P.swingAt=1e9;
  const spawn=(name,x,z,y)=>{const e=F.spawnRealmUnit(1,'warrior',1,'soldier',x,z,{});
    e.name=name;e.y=y;e.fixedY=y;e.role='dummy';e.swingAt=1e9;return e;};
  const hidden=spawn('Hidden upstairs sentry',T.wx,T.wz+.5,T.S.y+T.H);
  const visible=spawn('Visible downstairs sentry',T.wx+.6,T.wz+1.5,P.y);
  for(const L of T.ladders)if(L.hatch){L.hatch.k=0;L.hatch.held=false;}
  H.UI.modal=null;H.CAM.mode='fixed';
  H.camera.position.set(T.wx,T.S.y+T.yG+2.1,T.wz-1.4);
  H.camera.lookAt(visible.x,visible.y+1.7,visible.z);H.camera.updateMatrixWorld();
  window.__targetTest={T,hidden,visible};return {tower:T.look};
})()"""

async def main():
    async with async_playwright() as p:
        for touch,w,h in [(False,1280,720),(True,390,780)]:
            b,page,logs=await setup(p,touch=touch,w=w,h=h)
            try:
                await page.evaluate("__hm.start({realm:0,cls:'warrior',level:1})")
                await page.evaluate(SCENE)
                await human_play(page)
                result=await page.evaluate("""(() => {
                  const H=__hm,F=H.fn,P=H.GAME.player,{hidden,visible}=__targetTest;
                  // Keep the real human-play lease eligible while this fixed-camera frame refreshes the HUD.
                  H.simulate(.05);H.UI.modal=null;H.CAM.mode='fixed';
                  hidden._losT=visible._losT=-1;
                  const blocked=H.ladders.towerSightBlocked(P,hidden);
                  const visibleBlocked=H.ladders.towerSightBlocked(P,visible);
                  const seenHidden=H.towers.seen(hidden),seenVisible=H.towers.seen(visible);
                  P.target=null;F.cycleTarget();const forward=P.target;
                  P.target=null;F.cycleTarget(true);const reverse=P.target;
                  P.target=hidden.id;
                  // This frame must refresh each name; ignore any pool left by an intervening RAF.
                  for(const e of H.UI.npPool)e.style.display='none';
                  H.frame(1/30);
                  const names=H.UI.npPool.filter(e=>e.style.display!=='none').map(e=>e._txt);
                  return {blocked,visibleBlocked,seenHidden,seenVisible,forward,reverse,
                    hidden:hidden.id,visible:visible.id,names,errors:H.errors.slice()};
                })()""")
                print(json.dumps(result),flush=True)
                label=f'{w}x{h}'
                check(result['blocked'] and not result['visibleBlocked'],label+' real closed tower floor separates the two sentries')
                check(not result['seenHidden'] and result['seenVisible'],label+' real visibility hides upstairs body and keeps downstairs body visible')
                check(result['forward']==result['visible'] and result['reverse']==result['visible'],label+' both target directions select only the visible sentry')
                check('Hidden upstairs sentry' not in result['names'],label+' even a retained selected name cannot reveal an upstairs sentry')
                check('Visible downstairs sentry' in result['names'],label+' visible body retains its nameplate')
                check(not result['errors'] and not logs,label+' no game or browser errors')
                await page.screenshot(path=OUT+f'combat_targeting_{w}.png',timeout=300000)
            finally:
                await b.close()
    if FAILS: raise SystemExit(str(len(FAILS))+' failures: '+', '.join(FAILS))

asyncio.run(main())
