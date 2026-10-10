"""Temples and paved ground: the hallow-wardens stand on top of the temple dais (not sunk into it), anyone can
walk up its two steps, no grass or flowers grow through the dais, keep courtyards, town plazas or stair
treads, and people on a rune circle stand on it. Screenshots of a temple dais and a keep courtyard.
usage: python3 tools/tests/temple.py [noshots] [quality]   (quality: high, medium or low; default medium)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1400], flush=True)
    return r

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn,
  local(S, x, z) { const c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = x - S.x, dz = z - S.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; },
  // each warden: how far its feet are above the site floor, and the dais top under it
  wardens() {
    const out = [];
    for (const T of __hm.WAR.temples) {
      const S = T.site;
      for (const id of T.guardians) {
        const g = __hm.fn.getEnt(id); if (!g || !g.alive) continue;
        const l = this.local(S, g.x, g.z), r = Math.hypot(l.x, l.z);
        const top = r <= 6.4 ? 0.76 : r <= 7.6 ? 0.38 : 0;
        out.push({ realm: T.realm, r: +r.toFixed(1), y: +(g.y - S.y).toFixed(2), top });
      }
    }
    return out;
  },
  // the grass mask at points over a disc (2 m texels: the same lookup the blades use, bilinear)
  grassAt(x, z) {
    const W = this.F.W, HN = 513, fx = (x + 512) / 2, fz = (z + 512) / 2, i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j;
    const g = (a, b) => W.grass[Math.min(HN - 1, Math.max(0, b)) * HN + Math.min(HN - 1, Math.max(0, a))];
    return (g(i, j) * (1 - u) + g(i + 1, j) * u) * (1 - v) + (g(i, j + 1) * (1 - u) + g(i + 1, j + 1) * u) * v;
  },
  maxGrass(S, pts) { let m = 0; for (const [lx, lz] of pts) { const p = this.F.siteToWorld(S, lx, lz); m = Math.max(m, this.grassAt(p.x, p.z)); } return +m.toFixed(3); },
  ring(r, n = 24) { const out = []; for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2; out.push([Math.sin(a) * r, Math.cos(a) * r]); } return out; },
  // walk the player with W held toward a site-local point
  walkTo(S, lx, lz, maxSec = 14) {
    const H = this.H, P = H.GAME.player, p = this.F.siteToWorld(S, lx, lz);
    H.UI.modal = null; H.INPUT.keys.add('KeyW');
    let t = 0, hi = -9;
    while (t < maxSec) {
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < 0.4) break;
      H.CAM.yaw = Math.atan2(p.x - P.x, p.z - P.z);
      H.simulate(0.1, 0.02); t += 0.1; hi = Math.max(hi, P.y - S.y);
    }
    H.INPUT.keys.delete('KeyW');
    H.simulate(0.2, 0.02);
    const l = this.local(S, P.x, P.z);
    return { lx: +l.x.toFixed(2), lz: +l.z.toFixed(2), y: +(P.y - S.y).toFixed(2), hi: +hi.toFixed(2), t: +t.toFixed(1) };
  },
};
0
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960, h=540)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({ realm: 0, cls: 'mage', level: 24 })")
        await page.evaluate(HELPERS)
        r = await ev(page, 'wardens at the start', "T.wardens()")
        check(len(r) >= 6 and all(abs(w['y'] - w['top']) < 0.06 for w in r), 'every warden stands on the dais top under its feet')
        await page.evaluate("__hm.simulate(30); 0")
        r = await ev(page, 'wardens after 30 s', "T.wardens()")
        check(len(r) >= 6 and all(w['y'] >= w['top'] - 0.06 for w in r), 'after half a minute no warden is inside the dais')
        # the player walks in through the gate and up both steps to the altar
        r = await ev(page, 'walk to the altar', """(() => { const H = __hm, S = H.REALMS[0].templeSite, P = H.GAME.player;
          const g = H.fn.siteToWorld(S, 0, 21); P.x = P.prevX = g.x; P.z = P.prevZ = g.z; P.y = H.fn.heightAt(g.x, g.z); P.onGround = true; P.vy = 0;
          return [T.walkTo(S, 0, 9.5), T.walkTo(S, 0, 7.0), T.walkTo(S, 0, 3.2)]; })()""")
        check(abs(r[1]['y'] - 0.38) < 0.05 and abs(r[2]['y'] - 0.76) < 0.05 and r[2]['lz'] < 4.2, 'the player walks up both dais steps to the altar')
        r = await ev(page, 'walk back down', """(() => { const S = __hm.REALMS[0].templeSite; return T.walkTo(S, 0, 11); })()""")
        check(abs(r['y']) < 0.05 and r['lz'] > 10.4, 'and back down onto the temple floor')
        # no blades: the dais of every temple, the courtyards of every keep, the plazas, the stair treads
        r = await ev(page, 'grass masks', """(() => { const H = __hm, out = {};
          out.dais = H.REALMS.map((R) => T.maxGrass(R.templeSite, [[0, 0], ...T.ring(3), ...T.ring(6.4), ...T.ring(7.6, 48)]));
          out.temple_lawn = H.REALMS.map((R) => T.maxGrass(R.templeSite, T.ring(12.5)));
          out.courtyards = H.REALMS.map((R) => R.keepSites.map((S) => T.maxGrass(S, [[0, 6], [-8, 2], [8, 2], [0, 12], [-11, -2], [11, -2]])));
          out.plazas = H.REALMS.map((R) => [T.maxGrass(R.town, [[0, 0], ...T.ring(2.6), ...T.ring(8)]), T.maxGrass(R.musterSite, [[0, 0], ...T.ring(2.6), ...T.ring(8)])]);
          const stairs = []; for (const C of H.fn.castles()) for (const f of C.floors) if (f.tag === 'stair' && Math.min(f.ya, f.yb) - H.fn.heightAt(f.x, f.z) < 1.2) stairs.push(+T.grassAt(f.x, f.z).toFixed(3));
          out.stairs = [stairs.length, Math.max(...stairs)];
          return out; })()""")
        check(max(r['dais']) == 0, 'no grass on any temple dais')
        check(min(r['temple_lawn']) > 0.1, 'the temple lawn beyond the dais still grows grass')
        check(max(max(x) for x in r['courtyards']) == 0, 'no grass in any keep courtyard')
        check(max(max(x) for x in r['plazas']) == 0, 'no grass on the town plazas, muster grounds or their rune circles')
        check(r['stairs'][0] >= 8 and r['stairs'][1] == 0, 'no grass under any stair that comes down to the ground')
        r = await ev(page, 'rune circle', """(() => { const H = __hm, S = H.REALMS[0].town, P = H.GAME.player;
          P.x = P.prevX = S.x + 4; P.z = P.prevZ = S.z; P.y = H.fn.heightAt(P.x, P.z); H.simulate(0.2, 0.02);
          const out = [T.walkTo(S, 0, 0.3)]; const p = H.fn.siteToWorld(S, 0.6, 0.6);
          const e = H.fn.spawnRealmUnit(0, 'warrior', 10, 'soldier', p.x, p.z); out.push(+(e.y - S.y).toFixed(2)); H.fn.removeEnt(e);
          return out; })()""")
        check(abs(r[0]['y'] - 0.25) < 0.05 and abs(r[1] - 0.25) < 0.05, 'people on a rune circle stand on top of it')
        if SHOTS:
            # the view from the user's report: inside the gate, looking over the dais to the altar, at dusk
            await page.evaluate("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].templeSite; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.setTod(0.8);
              const W = H.dbg.WEATHER; if (W) { W.mode = 'clear'; W.kind = 'clear'; W.nextBolt = 1e9; }
              const P = H.GAME.player, g = F.siteToWorld(S, 1.5, 13.6); P.x = P.prevX = g.x; P.z = P.prevZ = g.z; P.y = F.heightAt(g.x, g.z);
              const c = F.siteToWorld(S, 0.6, 18.5); H.camera.position.set(c.x, S.y + 3.4, c.z); const t = F.siteToWorld(S, 0, -2); H.camera.lookAt(t.x, S.y + 0.8, t.z); })()""")
            for _ in range(4): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'temple_dais.png', timeout=300000)
            print('  shot temple_dais', f'[{time.time() - T0:.0f}s]', flush=True)
            await page.evaluate("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].templeSite; H.setTod(0.45);
              const c = F.siteToWorld(S, -5.5, 6.5); H.camera.position.set(c.x, S.y + 1.9, c.z); const t = F.siteToWorld(S, 3.2, 2.5); H.camera.lookAt(t.x, S.y + 0.9, t.z); })()""")
            for _ in range(4): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'temple_warden.png', timeout=300000)
            print('  shot temple_warden', f'[{time.time() - T0:.0f}s]', flush=True)
            await page.evaluate("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].keepSites[1]; H.setTod(0.45);
              const c = F.siteToWorld(S, 6, 11); H.camera.position.set(c.x, S.y + 2.2, c.z); const t = F.siteToWorld(S, -1, -2); H.camera.lookAt(t.x, S.y + 1.6, t.z); })()""")
            for _ in range(4): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'keep_courtyard.png', timeout=300000)
            print('  shot keep_courtyard', f'[{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
