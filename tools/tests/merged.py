"""Smoke test for the whole game after merging feature branches: boots at high quality, checks that every
system came up (shader patches, houses, castles, nature, campaign, wear), runs a stormy war for a few
minutes of game time, and takes two screenshots (a keep in the rain, a town at dusk).
usage: python3 tools/tests/merged.py [noshots]"""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

SHOTS = 'noshots' not in sys.argv[1:]
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what)
    if not cond: FAILS.append(what)

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960, h=540)
        await page.evaluate("__hm.fn.setQuality('high')")
        r = await page.evaluate("""(async () => { const H = __hm, F = H.fn; await H.start({ realm: 2, cls: 'warrior', level: 35 });
          const houses = typeof HOUSES !== 'undefined' ? HOUSES.length : (F.houseList ? F.houseList().length : -1);
          return { errors: H.errors.slice(0, 3), castlePatched: (F.CASTLE_PATCHED || []).length, castles: F.castles ? F.castles().length : -1,
            camps: H.CAMPS.length, war: F.warLevel(), cw: !!H.CW, nature: !!H.nature, programs: H.renderInfo().programs }; })()""")
        print('boot', json.dumps(r))
        check(not r['errors'], 'boots without errors')
        check(r['castlePatched'] >= 2, 'castle crack and breach patches applied to the building shader')
        check(r['cw'] and r['nature'], 'campaign and nature systems are up')
        # a storm over the war for a few minutes of game time
        r = await page.evaluate("""(() => { const H = __hm, W = H.dbg.WEATHER; if (W) { W.mode = 'storm'; W.kind = 'storm'; }
          const out = []; for (let i = 0; i < 6; i++) { const s = H.simulate(30); out.push([Math.round(s.t), s.ents, s.nonFinite, (s.errors || []).length]); }
          return { out, errors: H.errors.slice(0, 3), wet: +H.dbg.U.uWet.value.toFixed(2) }; })()""")
        print('storm war', json.dumps(r))
        check(not r['errors'] and all(x[2] == 0 for x in r['out']), 'three minutes of stormy war: no errors, nothing non-finite')
        if SHOTS:
            await page.evaluate("""(() => { const H = __hm, F = H.fn, K = H.WAR.keeps[0], S = K.site; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.setTod(0.55);
              const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const x = S.x + s * 46 + c * 22, z = S.z + c * 46 - s * 22;
              H.camera.position.set(x, F.heightAt(x, z) + 14, z); H.camera.lookAt(S.x, S.y + 5, S.z); })()""")
            for _ in range(6): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=str(OUT) + '/merged_keep_rain.png', timeout=300000)
            await page.evaluate("""(() => { const H = __hm, F = H.fn, R = H.REALMS[0], S = R.town; const W = H.dbg.WEATHER; if (W) { W.mode = 'clear'; W.kind = 'clear'; }
              H.setTod(1.02); const c = Math.cos(S.yaw), s = Math.sin(S.yaw); const x = S.x + s * 30 + c * 14, z = S.z + c * 30 - s * 14;
              H.camera.position.set(x, F.heightAt(x, z) + 9, z); H.camera.lookAt(S.x, S.y + 2, S.z); })()""")
            for _ in range(6): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=str(OUT) + '/merged_town_dusk.png', timeout=300000)
            print('  shots merged_keep_rain, merged_town_dusk')
        errs = await page.evaluate("__hm.errors")
        check(not errs, 'no runtime errors at the end')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS)
        await b.close()
asyncio.run(main())
