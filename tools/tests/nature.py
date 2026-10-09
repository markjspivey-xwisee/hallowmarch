"""A living landscape, end to end through window.__hm:
a tree is chopped down with the axe (notch, fall away from the axe, stump and log colliders), the log is split into
firewood and lit as a campfire; a whirlwind cuts the grass round the warrior (the cut map) and it grows back; a grass
fire is lit, spreads, burns out to ash and greens over again; a tree is set alight, chars and drops its leaves;
a meteor leaves a crater (heightAt drops, the terrain mesh follows). Screenshots of each.
usage: python3 tools/tests/nature.py [noshots] [only=chop,cut,...] [final] [quality]   (final: 960x540; quality: high, medium or low; default low)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)  # only=chop,cut: just these screenshots
FINAL = 'final' in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'low')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1200], flush=True)
    return r

async def frames(page, n=1):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name, js):
    if not SHOTS or (ONLY and name not in ONLY): return
    await page.evaluate(js)
    await page.evaluate("__hm.frame(1/60)")
    await frames(page, 1)
    await page.screenshot(path=OUT + 'nature_' + name + '.png', timeout=300000)
    print('  shot', 'nature_' + name, f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, N: __hm.nature,
  // a standing tree in open meadow, well away from towns, keeps and roads
  findTree(minGrass, skip) {
    const W = this.F.W, H = this.H;
    let best = null, bs = -1;
    for (const t of W.trees) {
      if (t.felled || t.state !== 'stand' || (skip && skip.includes(t.i))) continue;
      const r = Math.hypot(t.x, t.z);
      if (r < 290 || r > 440) continue;
      if (H.REALMS.some((R) => Math.hypot(t.x - R.town.x, t.z - R.town.z) < 80)) continue;
      let g = 0, near = 0;
      for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; g += this.F.sampleGrid(W.grass, t.x + Math.sin(a) * 6, t.z + Math.cos(a) * 6); }
      for (const o of W.trees) if (o !== t && Math.abs(o.x - t.x) < 9 && Math.abs(o.z - t.z) < 9) near++;
      const sc = g / 8 - near * 0.08 - Math.abs(this.F.heightAt(t.x + 4, t.z) - this.F.heightAt(t.x - 4, t.z)) * 0.1;
      if (g / 8 > minGrass && sc > bs) { bs = sc; best = t; }
    }
    return best;
  },
  // open grass, no trees close by
  findMeadow(cx, cz) {
    const W = this.F.W;
    for (let k = 0; k < 4000; k++) {
      const a = k * 2.4, r = 6 + k * 0.08, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!this.F.isWalkable(x, z)) continue;
      if (this.F.sampleGrid(W.grass, x, z) < 0.7 || this.F.sampleGrid(W.road, x, z) > 0.05) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < 12 && Math.abs(t.z - z) < 12)) continue;
      if (this.H.REALMS.some((R) => Math.hypot(x - R.town.x, z - R.town.z) < 70)) continue;
      return { x, z };
    }
    return null;
  },
  cam(x, y, z, tx, ty, tz) {
    const H = this.H;
    y = Math.max(y, this.F.heightAt(x, z) + 1.6); // never under a slope
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  dry() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; this.H.dbg.U.uWet.value = 0; this.H.dbg.U.uSnowCover.value = 0; },
  sim(sec) { this.dry(); return this.H.simulate(sec); },
  burnt(x, z, r) { let n = 0; for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) if (this.N.burntAt(x + i, z + j) > 0.3) n++; return n; },
};
"""

async def main():
    async with async_playwright() as p:
        w, h = (960, 540) if FINAL else (640, 360)
        b, page, logs = await setup(p, w=w, h=h)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        page.on('console', lambda m: print('  console:', m.text[:300], flush=True) if m.type == 'error' else None)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30})")
        await page.evaluate(HELPERS + '\n;0') # (return nothing: T holds the whole game)
        print(f'started [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("document.getElementById('hud').hidden = true; __hm.setTod(0.55); T.dry()")

        # ---- the trees know their colliders and their far-forest instances ----
        r = await ev(page, 'trees', """(() => { const L = T.F.W.trees; return { n: L.length, coll: L.filter((t) => t.coll).length, chunk: L.filter((t) => t.chunk).length, built: T.N.NATURE.built }; })()""")
        check(r['built'] and r['coll'] == r['n'] and r['chunk'] == r['n'], 'every tree is matched to its collider and its far instance')

        # ---- chop a tree down ----
        r = await ev(page, 'pick tree', """(() => { const t = T.findTree(0.45); const P = T.H.GAME.player;
          const a = 0.7; T.H.teleport(t.x - Math.sin(a) * 1.5, t.z - Math.cos(a) * 1.5); P.yaw = a;
          T.H.simulate(0.1); const it = T.F.currentInteraction();
          return { i: t.i, kind: t.kind, s: t.s0, x: t.x, z: t.z, label: it && it.label }; })()""")
        ti = r['i']
        check(bool(r['label']) and r['label'].startswith('Chop down the'), 'standing by a tree offers "Chop down the tree"')
        await page.evaluate("(() => { const it = T.F.currentInteraction(); it.act(); })()")
        r = await ev(page, 'chop 2.2s', f"(() => {{ T.sim(2.2); const t = T.F.W.trees[{ti}]; return {{ notch: t.notch, felled: !!t.felled, act: T.H.GAME.player.anim.act, job: !!T.N.NATURE.job }}; }})()")
        check(r['notch'] > 0.15 and not r['felled'] and r['job'], 'each axe blow cuts the notch deeper')
        await shot(page, 'chop', f"(() => {{ const t = T.F.W.trees[{ti}], P = T.H.GAME.player; const sx = Math.cos(P.yaw), sz = -Math.sin(P.yaw); T.cam(t.x - Math.sin(P.yaw) * 4.5 + sx * 3.2, t.y + 2.0, t.z - Math.cos(P.yaw) * 4.5 + sz * 3.2, t.x, t.y + 1.1, t.z); }})()")
        await page.evaluate("T.play()")
        # keep chopping until it goes over, then catch it in the air
        r = await ev(page, 'until it falls', f"""(() => {{ const t = T.F.W.trees[{ti}]; let n = 0;
          while (!t.felled && n++ < 200) T.sim(0.1);
          let m = 0; while (t.fall && t.fall.ang < 0.75 && m++ < 100) T.sim(0.05);
          return {{ felled: !!t.felled, ang: t.fall && t.fall.ang, stop: t.fall && t.fall.stop, ux: t.fall && t.fall.ux, uz: t.fall && t.fall.uz, px: T.H.GAME.player.x, pz: T.H.GAME.player.z }}; }})()""")
        check(r['felled'], 'the tree comes down after the last blow')
        tr = await page.evaluate(f"T.N.tree({ti})")
        away = (tr['x'] - r['px']) * r['ux'] + (tr['z'] - r['pz']) * r['uz']
        check(away > 0, 'it falls away from the axe')
        await shot(page, 'falling', f"(() => {{ const t = T.F.W.trees[{ti}], F = t.fall; const sx = F.uz, sz = -F.ux; T.cam(t.x + F.ux * 3 + sx * 12, t.y + 3.2, t.z + F.uz * 3 + sz * 12, t.x + F.ux * 3, t.y + 2.4, t.z + F.uz * 3); }})()")
        await page.evaluate("T.play()")
        r = await ev(page, 'settled', f"(() => {{ T.sim(4); return T.N.tree({ti}); }})()")
        check(r['fall']['done'] and abs(r['fall']['ang'] - r['fall']['stop']) < 0.01 and r['fall']['ang'] > 1.2, 'it bounces and settles lying on the ground')
        check(r['coll']['r'] < 0.8 and r['coll']['h'] < 1.2 and r['coll']['active'], 'the tree collider becomes a stump')
        check(r['log'] and r['logColl'] and r['logColl']['active'] and r['logColl']['hz'] > 1, 'the fallen trunk gets a log collider')
        await shot(page, 'fallen', f"(() => {{ const t = T.F.W.trees[{ti}], F = t.fall; const sx = F.uz, sz = -F.ux; T.cam(t.x - F.ux * 3.5 + sx * 4, t.y + 2.4, t.z - F.uz * 3.5 + sz * 4, t.x + F.ux * 2.5, t.y + 0.3, t.z + F.uz * 2.5); }})()")
        await page.evaluate("T.play()")

        # ---- split the log, light the firewood ----
        r = await ev(page, 'split', f"""(() => {{ const t = T.F.W.trees[{ti}], F = t.fall, P = T.H.GAME.player;
          const x = t.x + F.ux * 1.6 + F.uz * 1.3, z = t.z + F.uz * 1.6 - F.ux * 1.3; T.H.teleport(x, z); T.sim(0.1);
          const it = T.F.currentInteraction(); const label = it && it.label; if (it && label.startsWith('Cut')) it.act();
          T.sim(4.5); const pile = T.N.NATURE.piles[0];
          const it2 = T.F.currentInteraction();
          return {{ label, log: !!t.log, logColl: t.logColl, pile: !!pile, next: it2 && it2.label }}; }})()""")
        check(r['label'] == 'Cut the log into firewood', 'beside the log: "Cut the log into firewood"')
        check(not r['log'] and r['pile'], 'the log is split into a pile of firewood')
        check(r['next'] == 'Light a campfire', 'the firewood offers "Light a campfire"')
        await page.evaluate("(() => { const it = T.F.currentInteraction(); if (it) it.act(); T.sim(1.5); })()")
        r = await ev(page, 'campfire', "(() => { const p = T.N.NATURE.piles[0]; return { lit: p && p.lit, fires: T.H.dbg.FIRES.filter((f) => Math.hypot(f.x - p.x, f.z - p.z) < 1).length }; })()")
        check(r['lit'] and r['fires'] >= 1, 'the campfire burns')
        await shot(page, 'campfire', f"(() => {{ const t = T.F.W.trees[{ti}], p = T.N.NATURE.piles[0]; T.H.setTod(1.3); T.H.frame(0.5); T.cam(p.x + 3.2, p.y + 1.8, p.z + 2.6, (p.x + t.x) / 2, p.y + 0.3, (p.z + t.z) / 2); }})()")
        await page.evaluate("T.play(); __hm.setTod(0.55)")

        # ---- the whirlwind cuts the grass ----
        r = await ev(page, 'whirlwind', """(() => { const P = T.H.GAME.player; const m = T.findMeadow(P.x + 40, P.z); T.H.teleport(m.x, m.z); T.sim(0.2);
          const before = T.N.cutAt(P.x + 2.5, P.z);
          P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0;
          const res = T.F.useAbility(P, 'whirl', null); T.sim(1.2);
          let ring = 0; for (let k = 0; k < 12; k++) { const a = k * Math.PI / 6; if (T.N.cutAt(P.x + Math.sin(a) * 2.6, P.z + Math.cos(a) * 2.6) > 0.5) ring++; }
          window.T.cutSpot = { x: P.x, z: P.z };
          return { res, before, ring, far: T.N.cutAt(P.x + 9, P.z), x: P.x, z: P.z }; })()""")
        check(r['res'] is True and r['before'] < 0.1 and r['ring'] >= 10 and r['far'] < 0.1, 'the whirlwind cuts a ring of grass round the warrior, and only there')
        await shot(page, 'cut', "(() => { const c = T.cutSpot; T.sim(2); T.H.frame(1.5); T.H.teleport(c.x + 7, c.z + 7); T.cam(c.x + 5.5, T.F.heightAt(c.x, c.z) + 3.2, c.z + 5.5, c.x, T.F.heightAt(c.x, c.z), c.z); })()")
        await page.evaluate("T.play()")

        # ---- a grass fire: lit, spreading, burnt out, regrown ----
        r = await ev(page, 'ignite', """(() => { const P = T.H.GAME.player; const m = T.findMeadow(P.x - 60, P.z + 30); window.T.fireSpot = m;
          T.H.teleport(m.x + 30, m.z + 30); T.dry(); const n = T.N.igniteGrass(m.x, m.z, 1.5, 6); T.sim(8);
          return { n, fires: T.N.fires(), burning: T.N.fireAt(m.x, m.z) }; })()""")
        check(r['n'] > 0 and r['fires'] > 10, 'grass catches and the fire takes hold')
        r = await ev(page, 'spreading', """(() => { const m = T.fireSpot; T.sim(14); return { fires: T.N.fires(), burnt: T.burnt(m.x, m.z, 14) }; })()""")
        check(r['fires'] > 20 and r['burnt'] > 15, 'the fire spreads through the grass and leaves ash behind it')
        await shot(page, 'grassfire', "(() => { const m = T.fireSpot; const y = T.F.heightAt(m.x, m.z); T.cam(m.x + 13, y + 6, m.z + 13, m.x, y, m.z); })()")
        await page.evaluate("T.play()")
        r = await ev(page, 'burns out', """(() => { const m = T.fireSpot; let n = 0; while (T.N.fires() > 0 && n++ < 60) T.sim(5); return { fires: T.N.fires(), t: n * 5, burnt: T.burnt(m.x, m.z, 20), here: T.N.burntAt(m.x, m.z) }; })()""")
        check(r['fires'] == 0 and r['here'] > 0.4 and r['burnt'] > 100, 'the fire burns itself out and leaves black ground')
        await shot(page, 'burnt', "(() => { const m = T.fireSpot; const y = T.F.heightAt(m.x, m.z); T.cam(m.x + 13, y + 6, m.z + 13, m.x, y, m.z); })()")
        await page.evaluate("T.play()")
        r = await ev(page, 'regrow', """(() => { const m = T.fireSpot, c = T.cutSpot; T.N.NATURE.speed = 40; T.sim(16); T.N.NATURE.speed = 1;
          return { burnt: T.N.burntAt(m.x, m.z), cut: T.N.cutAt(c.x + 2.6, c.z) }; })()""")
        check(r['burnt'] < 0.15 and r['cut'] < 0.1, 'cut and burnt grass grows back over time')

        # ---- a tree set alight ----
        r = await ev(page, 'burn tree', f"""(() => {{ const t = T.findTree(0.3, [{ti}]); window.T.bt = t.i; const P = T.H.GAME.player; T.H.teleport(t.x + 12, t.z + 12);
          const ok = T.N.igniteTree(t.i); T.sim(9); return {{ ok, i: t.i, fire: t.fire, char: t.char, leaf: t.leaf }}; }})()""")
        check(r['ok'] and r['fire'] > 0.5 and r['char'] > 0.05, 'igniteTree sets the crown alight')
        await shot(page, 'treefire', "(() => { const t = T.F.W.trees[T.bt]; T.H.setTod(1.3); T.H.frame(0.5); T.cam(t.x + 7, t.y + 4, t.z + 7, t.x, t.y + 3.5, t.z); })()")
        await page.evaluate("T.play(); __hm.setTod(0.55)")
        r = await ev(page, 'burnt tree', "(() => { const t = T.F.W.trees[T.bt]; let n = 0; while (t.fire > 0 && n++ < 40) T.sim(2); return { fire: t.fire, char: t.char, leaf: t.leaf, felled: !!t.felled }; })()")
        check(r['fire'] == 0 and r['char'] > 0.6 and r['leaf'] < 0.2, 'it burns out charred black with its leaves gone')
        await shot(page, 'snag', "(() => { const t = T.F.W.trees[T.bt]; T.cam(t.x + 7, t.y + 3, t.z + 7, t.x, t.y + 2.5, t.z); })()")
        await page.evaluate("T.play()")

        # ---- a meteor craters the ground ----
        r = await ev(page, 'meteor', """(() => { const P = T.H.GAME.player; const m = T.findMeadow(P.x + 50, P.z - 50); window.T.met = m;
          T.H.teleport(m.x + 14, m.z); T.sim(0.2);
          const foe = T.F.spawnMob(T.H.CAMPS[0]); // a real camp, so its death is booked as usual
          foe.x = foe.prevX = m.x; foe.z = foe.prevZ = m.z; foe.y = T.F.heightAt(m.x, m.z); T.F.addBuff(foe, 'stun', 1, 20); T.F.addBuff(foe, 'root', 1, 20);
          const before = T.F.heightAt(m.x, m.z);
          P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0; P.target = foe.id;
          const res = T.F.useAbility(P, 'meteor', foe);
          // a warrior's rage ebbs while casting: keep it topped up so the cast completes
          for (let k = 0; k < 40; k++) { P.power = P.maxPower; T.sim(0.1); }
          const C = T.N.NATURE.craters[T.N.NATURE.craters.length - 1];
          const after = T.F.heightAt(m.x, m.z);
          return { res, before, after, drop: before - after, earth: T.N.earthAt(m.x, m.z), craters: T.N.NATURE.craters.length, at: C && [C.x, C.z], foe: [foe.x, foe.z] }; })()""")
        check(r['res'] is True and r['drop'] > 0.8 and r['earth'] > 0.5 and r['craters'] >= 1, 'a meteor leaves a crater: heightAt drops and the earth is thrown')
        r = await ev(page, 'walk into crater', """(() => { const m = T.met, P = T.H.GAME.player; T.H.teleport(m.x + 6, m.z); P.yaw = -Math.PI / 2; T.H.CAM.yaw = P.yaw; T.H.UI.modal = null;
          T.H.INPUT.keys.add('KeyW'); T.sim(1.0); T.H.INPUT.keys.delete('KeyW'); return { y: P.y, ground: T.F.heightAt(P.x, P.z), d: Math.hypot(P.x - m.x, P.z - m.z) }; })()""")
        check(abs(r['y'] - r['ground']) < 0.3, 'units walk down into the crater')
        await shot(page, 'crater', "(() => { const m = T.met; const y = T.F.heightAt(m.x, m.z); T.H.teleport(m.x + 16, m.z + 16); T.cam(m.x + 8.5, y + 5.5, m.z + 8.5, m.x, y + 0.4, m.z); })()")
        await page.evaluate("T.play()")

        errs = await page.evaluate("__hm.errors")
        check(len(errs) == 0, 'no runtime errors: ' + json.dumps(errs)[:300])
        check(not logs, 'no page errors: ' + json.dumps(logs)[:300])
        await b.close()
    print('FAILS:', FAILS if FAILS else 'none', f'[{time.time() - T0:.0f}s]')

asyncio.run(main())
