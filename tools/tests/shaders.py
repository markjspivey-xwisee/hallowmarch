"""Compile every material at high, medium and low quality, outdoors and at night; print any shader errors."""
import asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        msgs = []
        page.on('console', lambda m: msgs.append(m.text) if m.type in ('error', 'warning') else None)
        for q in ['high', 'medium', 'low']:
            await page.evaluate(f"__hm.fn.setQuality('{q}')")
            if q == 'high': await page.evaluate("__hm.start({realm:0, cls:'warrior', level:15})")
            for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        # [late2] the standard of your name planted before you: its pole (the building shader) and its flag drawn at every quality (10l_late.js)
        await page.evaluate("(() => { const L = __hm.late, P = __hm.GAME.player; L.LATE2.std.made = true; L.LATE2.std.at = { x: P.x + Math.sin(P.yaw) * 4, z: P.z + Math.cos(P.yaw) * 4 }; L.late2StdShow(); return 0; })()")
        for q in ['low', 'medium', 'high']:
            await page.evaluate(f"__hm.fn.setQuality('{q}')")
            for _ in range(2): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        await page.evaluate("__hm.setTod(2.1)")
        for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        # [water2] under the water (the surface from below, the shafts, the fish, the finds), a boat and its jetty, and
        # prints and drifts in the snow: their programs at every quality, by day and by night
        for q in ['high', 'medium', 'low']:
            await page.evaluate(f"__hm.fn.setQuality('{q}')")
            for tp in (0.45, 2.1):
                await page.evaluate("""((tp) => { const H = __hm, Wt = H.water, P = H.GAME.player, L = H.dbg.LAKES[0]; H.setTod(tp);
                  if (Wt.boats.BOATS.list.some((b) => b.rider === P.id)) Wt.boats.leave();
                  let s = null; for (let r = 0; r < 30 && !s; r += 0.5) for (let a = 0; a < 12 && !s; a++) { const x = L.x + Math.cos(a * 0.52) * r, z = L.z + Math.sin(a * 0.52) * r, w = Wt.waterAt(x, z); if (w && w.depth > 2.8) s = { x, z, y: w.y }; }
                  H.farm.setSeason(0.42); H.seasons.seasonSettle(); H.teleport(s.x, s.z); P.y = s.y - 1.3; H.simulate(0.3); P.breath = 1; Wt.dive.start(); H.CAM.pitch = 1.1; H.INPUT.keys.add('KeyW'); H.simulate(1.0); H.INPUT.keys.delete('KeyW'); H.CAM.pitch = 0.1; return 0; })(%f)""" % tp)
                for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
                await page.evaluate("""(() => { const H = __hm, Wt = H.water, P = H.GAME.player; Wt.dive.end(); const J = Wt.boats.jetties()[0]; const i = Wt.boats.list().findIndex((b) => b.home && b.realm === J.realm); Wt.boats.restore(i); H.teleport(J.land.x, J.land.z); Wt.boats.board(i); H.INPUT.keys.add('KeyS'); H.simulate(1.0); H.INPUT.keys.delete('KeyS'); return 0; })()""")
                for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
                await page.evaluate("""(() => { const H = __hm, Wt = H.water, P = H.GAME.player; Wt.boats.leave(); H.farm.setSeason(0.875); H.seasons.seasonSettle(); const R = H.REALMS[2]; H.teleport(R.town.x + 34, R.town.z + 30); H.simulate(0.2); for (let k = 0; k < 8; k++) Wt.tracks.lay(P.x + k * 0.4, P.z + 1, 0, k % 5, 0.3, 1, k % 3); return 0; })()""")
                for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        await page.evaluate("(() => { __hm.farm.setSeason(0.42); __hm.seasons.seasonSettle(); return 0; })()")
        print('console:', [m[:400] for m in msgs][:6])
        print('errors', await page.evaluate("__hm.errors"))
        print('programs', await page.evaluate("__hm.renderInfo().programs"))
        print('bad programs', await page.evaluate("__hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || '') + (p.diagnostics.vertexShader.log || '')).map(s => s.slice(0, 300))"))
        await b.close()
asyncio.run(main())
