"""The world remembers, end to end through window.__hm:
fells trees (a chopped log, a split log with a lit firewood pile, a stump grown back to a sapling, a burning tree),
cuts and burns grass, makes a crater (with loot that must settle into it), sets one house burning and leaves others
in ruins and under scaffolding, breaches one wall, has another rebuilding and a third worn; checks the woodcutter's axe
is in hand while chopping. Saves (saveNow), reloads the page with the same localStorage and checks that everything
came back: positions, colliders, heights, the nature map, timers. Then strips the land from the save (an old save)
and checks it loads into an untouched world and the character continues. Prints the save sizes.
usage: python3 tools/tests/worldstate.py [noshots]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

SHOTS = 'noshots' not in sys.argv[1:]
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, N: __hm.nature,
  findTree(skip) {
    const W = this.F.W, H = this.H;
    let best = null, bs = -1;
    for (const t of W.trees) {
      if (t.felled || t.state !== 'stand' || skip.includes(t.i)) continue;
      const r = Math.hypot(t.x, t.z);
      if (r < 300 || r > 430) continue;
      if (H.REALMS.some((R) => Math.hypot(t.x - R.town.x, t.z - R.town.z) < 90)) continue;
      if (skip.length && Math.hypot(t.x - W.trees[skip[0]].x, t.z - W.trees[skip[0]].z) > 60) continue;
      let near = 0;
      for (const o of W.trees) if (o !== t && Math.abs(o.x - t.x) < 7 && Math.abs(o.z - t.z) < 7) near++;
      const sc = this.F.sampleGrid(W.grass, t.x, t.z) - near * 0.15 - Math.abs(this.F.heightAt(t.x + 4, t.z) - this.F.heightAt(t.x - 4, t.z)) * 0.1;
      if (sc > bs) { bs = sc; best = t; }
    }
    return best;
  },
  findMeadow(cx, cz, avoid) {
    const W = this.F.W;
    for (let k = 0; k < 6000; k++) {
      const a = k * 2.4, r = 10 + k * 0.06, x = cx + Math.sin(a) * r, z = cz + Math.cos(a) * r;
      if (!this.F.isWalkable(x, z) || Math.hypot(x, z) > 440) continue;
      if (this.F.sampleGrid(W.grass, x, z) < 0.6 || this.F.sampleGrid(W.road, x, z) > 0.05) continue;
      const hh = this.F.heightAt;
      if (Math.abs(hh(x + 6, z) - hh(x - 6, z)) + Math.abs(hh(x, z + 6) - hh(x, z - 6)) > 1.6) continue;
      if (W.trees.some((t) => Math.abs(t.x - x) < 10 && Math.abs(t.z - z) < 10)) continue;
      if (this.H.REALMS.some((R) => Math.hypot(x - R.town.x, z - R.town.z) < 80)) continue;
      if (avoid.some((p) => Math.hypot(p.x - x, p.z - z) < 16)) continue;
      return { x, z };
    }
    return null;
  },
  cam(x, y, z, tx, ty, tz) {
    const H = this.H;
    y = Math.max(y, this.F.heightAt(x, z) + 1.6);
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  dry() { const Wt = this.H.dbg.WEATHER; Wt.mode = 'fixed'; Wt.kind = 'clear'; Wt.raining = 0; Wt.wet = 0; Wt.snowing = 0; Wt.snow = 0; Wt.overcast = 0; Wt.target = 0; Wt.w = 0; this.H.dbg.U.uWet.value = 0; this.H.dbg.U.uSnowCover.value = 0; },
  sim(sec) { this.dry(); return this.H.simulate(sec); },
  // everything the land should remember, as plain numbers
  snap(P) {
    const W = this.F.W, N = this.N.NATURE, H = this.H, F = this.F, r3 = (v) => Math.round(v * 1000) / 1000;
    const tree = (i) => { const t = W.trees[i]; return { i, felled: !!t.felled, log: !!t.log, chopped: !!t.chopped, grow: r3(t.grow), char: r3(t.char), leaf: r3(t.leaf), fire: r3(t.fire), y: r3(t.y),
      fall: t.fall ? { ux: r3(t.fall.ux), uz: r3(t.fall.uz), ang: r3(t.fall.ang), done: !!t.fall.done } : null,
      coll: t.coll ? { r: r3(t.coll.r), h: r3(t.coll.h), active: !!t.coll.active } : null,
      logColl: t.logColl ? { x: r3(t.logColl.x), z: r3(t.logColl.z), hx: r3(t.logColl.hx), hz: r3(t.logColl.hz), active: !!t.logColl.active } : null,
      regrow: t.regrowAt ? r3(t.regrowAt - H.GAME.t) : null, inFelled: N.felled.includes(t), inDyn: N.dyn.includes(t), growing: !!(N.growing && N.growing.includes(t)) }; };
    const out = { t: r3(H.GAME.t), trees: P.trees.map(tree), heights: P.hpts.map((p) => r3(F.heightAt(p[0], p[1]))),
      nat: P.npts.map((p) => [r3(this.N.cutAt(p[0], p[1])), r3(this.N.burntAt(p[0], p[1])), r3(this.N.earthAt(p[0], p[1]))]),
      fires: this.N.fires(), craters: N.craters.length, piles: N.piles.map((p) => ({ x: r3(p.x), z: r3(p.z), lit: !!p.lit, left: p.lit ? r3(p.until - H.GAME.t) : null, coll: !!(p.coll && p.coll.active) })),
      houses: H.HOUSES.filter((h) => h.state !== 'whole').map((h) => ({ num: h.num, state: h.state, stT: r3(h.stT), char: r3(h.char), R: h.burn ? r3(h.burn.R) : null })),
      walls: [] };
    F.castles().forEach((C, ci) => (C.sections || []).forEach((Wl, k) => { if (Wl.state !== 'whole' || Wl.wear > 0) out.walls.push({ ci, k, state: Wl.state, t: r3(Wl.t), wear: r3(Wl.wear), coll: Wl.coll ? { active: !!Wl.coll.active, h: r3(Wl.coll.h) } : null, floors: Wl.floors.map((f) => !!f.active).join(''), rubble: Wl.rubbleFloors.map((f) => !!f.active).join(''), wreck: Wl.wreck.visible, scaffold: Wl.scaffold.visible }); }));
    return out;
  },
};
"""

def close(a, b, tol):
    return a is not None and b is not None and abs(a - b) <= tol

async def boot_again(page):
    await page.goto('http://hm.test/', wait_until='commit', timeout=300000)
    await page.wait_for_function("window.__hm && window.__hm.ready && ((window.__hm.UI.modal = 'menu'), true)", timeout=240000, polling='raf')
    await page.evaluate("__hm.fn.setQuality('low')")
    await page.evaluate(HELPERS + '\n;0')

async def shot(page, name, js):
    if not SHOTS: return
    await page.evaluate(js)
    for _ in range(3): await page.evaluate("__hm.frame(1/30)")
    await page.screenshot(path=OUT + 'worldstate_' + name + '.png', timeout=300000)
    print('  shot', 'worldstate_' + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=800, h=450)
        page.on('console', lambda m: print('  console:', m.text[:300], flush=True) if m.type == 'error' else None)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("try { localStorage.removeItem('hallowmarch.save.v1') } catch (e) {}")
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:35})")
        await page.evaluate(HELPERS + '\n;0')
        await page.evaluate("document.getElementById('hud').hidden = true; __hm.setTod(0.55); T.dry()")
        r = await ev(page, 'untouched save', "(() => { const s = __hm.fn.buildSave(); return { all: JSON.stringify(s).length, land: s.world.land ? JSON.stringify(s.world.land).length : 0 }; })()")
        size0 = r['all']

        # ---- houses: two in ruins (one now under scaffolding) and one burning ----
        r = await ev(page, 'houses', """(() => { if (T.H.war2) T.H.war2.HCREW.off = true; /* [war2] left to burn: nobody beats these fires out */ const HS = T.H.HOUSES.filter((h) => h.state === 'whole' && Math.hypot(h.x - T.H.REALMS[0].town.x, h.z - T.H.REALMS[0].town.z) < 120);
          const far = (list, from) => list.slice().sort((a, b) => Math.min(...from.map((f) => Math.hypot(b.x - f.x, b.z - f.z))) - Math.min(...from.map((f) => Math.hypot(a.x - f.x, a.z - f.z))))[0];
          const ha = HS[0], hb = far(HS, [ha]), hc = far(HS, [ha, hb]);
          window.T.houses = [ha.num, hb.num, hc.num];
          T.F.igniteHouse(hb); T.F.igniteHouse(hc); let n = 0; while ((hb.state === 'burning' || hc.state === 'burning') && n++ < 80) T.sim(1);
          return { b: [hb.num, hb.state, hb.stT], c: [hc.num, hc.state, hc.stT] }; })()""")
        check(r['b'][1] == 'ruin' and r['c'][1] == 'ruin', 'two houses burnt down to ruins')

        # ---- walls: one breached, one rebuilding, one worn ----
        r = await ev(page, 'walls', """(() => { const CS = T.F.castles(); const withS = CS.map((C, i) => [C, i]).filter(([C]) => C.sections && C.sections.length && C.S.keepRef);
          const [A, ai] = withS[0], [B, bi] = withS[1], [C3, ci] = withS[2];
          A.S.keepRef.lastEnemyNear = 1e9;
          T.F.castleBreach(A.sections[0]);
          T.F.castleBreach(B.sections[0]); for (let k = 0; k < 12; k++) { B.S.keepRef.lastEnemyNear = -1e9; T.sim(1); } B.S.keepRef.lastEnemyNear = 1e9;
          const W3 = C3.sections[0]; T.F.castleSiegeHit(null, W3.wx, W3.wz, 2, 4);
          window.T.walls = [ai, bi, ci];
          return { a: A.sections[0].state, b: [B.sections[0].state, B.sections[0].t], c: [W3.state, W3.wear] }; })()""")
        check(r['a'] == 'breach' and r['b'][0] == 'repair' and r['b'][1] > 0 and r['c'][1] > 0, 'a wall breached, one rebuilding, one worn')

        # ---- the woodcutter's axe, and the first tree: chopped down, lying as a log ----
        r = await ev(page, 'axe', """(() => { const t = T.findTree([]), P = T.H.GAME.player, WB = T.F.WB; window.T.t1 = t.i;
          const a = 0.7; T.H.teleport(t.x - Math.sin(a) * 1.4, t.z - Math.cos(a) * 1.4); P.yaw = a; T.sim(0.1);
          if (T.H.INV.eq.weapon) { T.H.INV.eq.weapon.vis = 'sword'; T.F.applyGear(); } // a sword in hand to begin with
          const before = P.look.mask; T.N.natureStartJob('chop', t); T.sim(0.5);
          const during = P.look.mask; return { before, during, axe: !!(during & WB.axe), sword: !!(during & WB.sword), hadSword: !!(before & WB.sword), job: !!T.N.NATURE.job }; })()""")
        check(r['job'] and r['axe'] and not r['sword'] and r['hadSword'], "while chopping the woodcutter's axe is in hand, not the sword")
        before_mask = r['before']
        await shot(page, 'axe', """(() => { const P = T.H.GAME.player; const sx = Math.cos(P.yaw), sz = -Math.sin(P.yaw); T.cam(P.x + sx * 2.6 + Math.sin(P.yaw) * 1.6, P.y + 1.7, P.z + sz * 2.6 + Math.cos(P.yaw) * 1.6, P.x, P.y + 1.1, P.z); })()""")
        await page.evaluate("T.play()")
        r = await ev(page, 'chopped', """(() => { const t = T.F.W.trees[T.t1]; let n = 0; while (!t.felled && n++ < 300) T.sim(0.1); T.sim(6); const P = T.H.GAME.player;
          return { felled: !!t.felled, log: !!t.log, job: !!T.N.NATURE.job, mask: P.look.mask }; })()""")
        check(r['felled'] and r['log'] and not r['job'], 'the first tree is chopped down and lies as a log')
        check(r['mask'] == before_mask, 'the class weapon is back in hand after the work')

        # ---- a second tree: split into firewood, the pile lit, the stump grown back to a sapling ----
        r = await ev(page, 'split + sapling', """(() => { const t = T.findTree([T.t1]); window.T.t2 = t.i;
          T.N.fellTree(t, 1, 0.3, 80, false); T.sim(7);
          const F = t.fall; T.H.teleport(t.x + F.ux * 1.6 + F.uz * 1.3, t.z + F.uz * 1.6 - F.ux * 1.3); T.sim(0.1);
          T.N.natureStartJob('split', t); T.sim(4.5);
          const pile = T.N.NATURE.piles[T.N.NATURE.piles.length - 1]; if (pile) T.N.natureLightPile(pile);
          t.regrowAt = T.H.GAME.t; T.sim(3);
          return { log: !!t.log, felled: !!t.felled, grow: t.grow, piles: T.N.NATURE.piles.length, lit: !!(pile && pile.lit) }; })()""")
        check(not r['felled'] and 0.1 < r['grow'] < 0.2 and r['piles'] >= 1 and r['lit'], 'the second tree is split, its firewood lit, its stump a sapling again')
        # ---- a third tree knocked down (a log, not chopped) ----
        r = await ev(page, 'knocked', """(() => { const t3 = T.findTree([T.t1, T.t2]); window.T.t3 = t3.i; T.N.fellTree(t3, -0.4, 1, 120, false); T.sim(7);
          const t4 = T.findTree([T.t1, T.t2, T.t3]); window.T.t4 = t4.i; return { t3: T.N.tree(T.t3).log }; })()""")
        check(r['t3'], 'a third tree lies knocked down')

        # ---- the ground: cut grass, a grass fire, a crater with loot in it ----
        r = await ev(page, 'ground', """(() => { const t1 = T.F.W.trees[T.t1]; const avoid = [T.t1, T.t2, T.t3, T.t4].map((i) => T.F.W.trees[i]);
          const m1 = T.findMeadow(t1.x, t1.z, avoid); avoid.push(m1); const m2 = T.findMeadow(t1.x, t1.z, avoid); avoid.push(m2); const m3 = T.findMeadow(t1.x, t1.z, avoid);
          window.T.m = [m1, m2, m3];
          T.N.natureCut(m1.x, m1.z, 3.2, 1, false);
          // loot on level ground, then the ground opens under it
          const it = T.F.makeItem({ cls: 'warrior', realm: 0, lvl: 30, q: 2, slot: 'chest' }); const L = T.F.dropItem(it, m3.x, m3.z); T.sim(2.5);
          L.x = m3.x + 0.4; L.z = m3.z + 0.3; L.y = T.F.heightAt(L.x, L.z); const y0 = L.y;
          T.N.natureCrater(m3.x, m3.z, 3.2, 1.6); const g1 = T.F.heightAt(L.x, L.z); T.sim(1.2);
          window.T.loot = L;
          // last, so they still burn when the world is saved: a tree alight and a grass fire
          const t4 = T.F.W.trees[T.t4]; T.N.igniteTree(t4); T.N.igniteGrass(m2.x, m2.z, 1.6, 8, 1.4);
          // and in the town: one ruin goes up on scaffolding, a third house catches fire
          const [ha, hb, hc] = T.houses.map((n) => T.H.HOUSES[n]); hc.stT = 109.8; T.F.igniteHouse(ha);
          T.sim(6);
          return { y0, g1, ly: L.y, landed: L.landed, fires: T.N.fires(), cut: T.N.cutAt(m1.x, m1.z), t4fire: t4.fire, t4char: t4.char, houses: [ha.state, hb.state, hc.state] }; })()""")
        check(r['t4fire'] > 0.2 and r['t4char'] > 0, 'a fourth tree burns')
        check(r['houses'] == ['burning', 'ruin', 'scaffold'], f"a house burning, one in ruins, one rebuilding: {r['houses']}")
        check(r['g1'] < r['y0'] - 0.5 and abs(r['ly'] - r['g1']) < 0.05 and r['landed'], 'loot on the ground drops into a crater opening under it and settles')
        check(r['fires'] > 5 and r['cut'] > 0.5, 'grass cut in one meadow, burning in another')

        # what to compare after the reload
        pts = await ev(page, 'points', """(() => { const [m1, m2, m3] = T.m; const hp = [[m3.x, m3.z], [m3.x + 1.5, m3.z], [m3.x, m3.z - 3.4], [m3.x + 4.8, m3.z + 1.2]];
          const np = [[m1.x, m1.z], [m1.x + 1.2, m1.z - 1.1], [m2.x, m2.z], [m2.x + 2, m2.z + 2], [m3.x, m3.z], [m3.x + 4, m3.z]];
          window.T.P = { trees: [T.t1, T.t2, T.t3, T.t4], hpts: hp, npts: np }; return T.P; })()""")
        snap0 = await ev(page, 'snapshot', "T.snap(T.P)")
        r = await ev(page, 'busy save', """(() => { const s = __hm.fn.buildSave(); const L = s.world.land; return { all: JSON.stringify(s).length, land: JSON.stringify(L).length, parts: Object.fromEntries(Object.entries(L).map(([k, v]) => [k, JSON.stringify(v).length])), key: __hm.land.landKey(L) }; })()""")
        size1, land1, parts = r['all'], r['land'], r['parts']

        # before shots: the felled trees and the crater, the town, the breached wall
        VIEW_LAND = """(() => { const t = T.F.W.trees[T.t1], F = t.fall, m3 = T.m[2]; const lx = t.x + F.ux * 3, lz = t.z + F.uz * 3; const dx = m3.x - lx, dz = m3.z - lz, d = Math.hypot(dx, dz) || 1;
          const cx = lx + dx * 0.35, cz = lz + dz * 0.35; T.cam(cx - dz / d * 15 - dx / d * 9, T.F.heightAt(cx, cz) + 8, cz + dx / d * 15 - dz / d * 9, cx, T.F.heightAt(cx, cz) + 0.5, cz); })()"""
        VIEW_TOWN = """(() => { const hs = T.houses.map((n) => T.H.HOUSES[n]); const cx = (hs[0].x + hs[1].x + hs[2].x) / 3, cz = (hs[0].z + hs[1].z + hs[2].z) / 3;
          const R = Math.max(...hs.map((h) => Math.hypot(h.x - cx, h.z - cz))) + 14; T.cam(cx + R * 0.7, T.F.heightAt(cx, cz) + R * 0.75, cz + R * 0.7, cx, T.F.heightAt(cx, cz) + 1, cz); })()"""
        VIEW_WALL = """(() => { const C = T.F.castles()[T.walls[0]], Wl = C.sections[0]; let ox = Wl.wx - C.S.x, oz = Wl.wz - C.S.z; const d = Math.hypot(ox, oz) || 1; ox /= d; oz /= d;
          T.cam(Wl.wx + ox * 24 + Wl.wax * 7, C.S.y + 10, Wl.wz + oz * 24 + Wl.waz * 7, Wl.wx, C.S.y + 2.5, Wl.wz); })()"""
        await page.evaluate("T.H.UI.modal = 'menu'")  # the world stays still from the snapshot to the save

        # ---- save, reload with the same storage ----
        keep = await page.evaluate("({ P: T.P, t1: T.t1, t2: T.t2, t3: T.t3, t4: T.t4, m: T.m, houses: T.houses, walls: T.walls })")
        await page.evaluate("__hm.fn.saveNow()")
        stored = await page.evaluate("(localStorage.getItem('hallowmarch.save.v1') || '').length")
        print(f'stored {stored} bytes; untouched {size0}; busy {size1} (land {land1})', parts, flush=True)
        check(stored > 0 and land1 < 40000, f'the busy land is compact ({land1} bytes)')
        await boot_again(page)
        await page.evaluate("Object.assign(window.T, " + json.dumps(keep) + ");0")
        print(f'reloaded [{time.time() - T0:.0f}s]', flush=True)
        r = await ev(page, 'restored', "(() => ({ got: __hm.land.LAND.restored, errors: __hm.errors.slice(0, 4), t: __hm.GAME.t }))()")
        got = r['got'] or {}
        check(not r['errors'], 'no errors on loading the busy save')
        check(got.get('felled', 0) >= 2 and got.get('grow') == 1 and got.get('dyn', 0) >= 1 and got.get('craters', 0) >= 1 and got.get('houses', 0) >= 3 and got.get('walls', 0) >= 3 and got.get('piles') == 1 and got.get('fire', 0) > 5, 'every kind of change is read back')  # [war2] walls: three set here, and any the running war wore meanwhile (each compared below)
        dt = r['t'] - got.get('t', 0)
        snap1 = await ev(page, 'snapshot after', "T.snap(T.P)")
        # trees
        for a, b2 in zip(snap0['trees'], snap1['trees']):
            i = a['i']
            if a['felled']:
                ok = b2['felled'] and b2['log'] == a['log'] and close(a['fall']['ux'], b2['fall']['ux'], 0.01) and close(a['fall']['uz'], b2['fall']['uz'], 0.01) and close(a['fall']['ang'], b2['fall']['ang'], 0.011)
                check(ok, f'tree {i}: still felled, lying the same way')
                check(b2['coll'] and close(a['coll']['r'], b2['coll']['r'], 0.01) and close(a['coll']['h'], b2['coll']['h'], 0.01) and b2['coll']['active'], f'tree {i}: the stump collider is back')
                if a['logColl']:
                    lc, lc2 = a['logColl'], b2['logColl']
                    check(lc2 and lc2['active'] and all(close(lc[k], lc2[k], 0.06) for k in ('x', 'z', 'hx', 'hz')), f'tree {i}: the log collider is back where it was')
                check(close(a['regrow'], b2['regrow'] + dt, 1.6), f"tree {i}: regrowth clock ({a['regrow']} s left, {b2['regrow'] + dt:.1f} after)")
                check(close(a['char'], b2['char'], 0.011) and close(a['leaf'], b2['leaf'], 0.03), f'tree {i}: char and leaves')
            elif a['growing']:
                check(b2['growing'] and close(a['grow'], b2['grow'], 0.004) and b2['coll']['active'] and close(a['coll']['r'], b2['coll']['r'], 0.02), f'tree {i}: the sapling grows on from {a["grow"]}')
            else:
                check(b2['inDyn'] and close(a['char'], b2['char'], 0.02) and (b2['fire'] > 0.05) == (a['fire'] > 0.05), f'tree {i}: charred and burning as it was')
        check(all(close(h0, h1, 0.03) for h0, h1 in zip(snap0['heights'], snap1['heights'])), f"the crater's heights are back: {snap0['heights']} vs {snap1['heights']}")
        # (points 2 and 3 are in the grass fire, which burns on after the reload: there the ground may only get more burnt)
        nat_ok = all(all(close(x, y, 0.08) if not (k in (2, 3) and c == 1) else y >= x - 0.08 for c, (x, y) in enumerate(zip(a, b2))) for k, (a, b2) in enumerate(zip(snap0['nat'], snap1['nat'])))
        check(nat_ok, f"cut, burnt and dug ground: {snap0['nat']} vs {snap1['nat']}")
        check(snap1['fires'] > 3, f"the grass fire burns on ({snap1['fires']} cells)")
        check(len(snap1['piles']) == len(snap0['piles']) and all(close(a['x'], b2['x'], 0.06) and close(a['z'], b2['z'], 0.06) and a['lit'] == b2['lit'] and b2['coll'] for a, b2 in zip(snap0['piles'], snap1['piles'])), 'the firewood pile is where it was, still lit')
        hs0 = {h['num']: h for h in snap0['houses']}; hs1 = {h['num']: h for h in snap1['houses']}
        for n, h in hs0.items():
            h1 = hs1.get(n)
            check(h1 and h1['state'] == h['state'] and close(h['stT'], h1['stT'] - dt, 1.2), f"house {n}: {h['state']} at {h['stT']} s, after {h1 and h1['state']} at {h1 and h1['stT'] - dt:.1f}")
        ws0 = {(w['ci'], w['k']): w for w in snap0['walls']}; ws1 = {(w['ci'], w['k']): w for w in snap1['walls']}
        for key, w in ws0.items():
            w1 = ws1.get(key)
            same = w1 and w1['state'] == w['state'] and w1['floors'] == w['floors'] and w1['rubble'] == w['rubble'] and w1['wreck'] == w['wreck'] and w1['scaffold'] == w['scaffold'] and (w['coll'] is None or w1['coll']['active'] == w['coll']['active'])
            check(same and close(w['t'], w1['t'], 0.012) and close(w['wear'], w1['wear'], 0.012), f"wall {key}: {w['state']} t {w['t']} wear {w['wear']}, after {w1 and (w1['state'], w1['t'], w1['wear'])}")
        await page.evaluate("document.getElementById('hud').hidden = true; __hm.setTod(0.55); T.dry()")
        await shot(page, 'land_after', VIEW_LAND)
        await shot(page, 'town_after', VIEW_TOWN)
        await shot(page, 'wall_after', VIEW_WALL)
        # the character continues from the save ([heights] the camera is set to play in the same call as the click: a frame
        # drawn between two calls found the camera playing and no player yet, and updateCamera threw)
        r = await ev(page, 'continue', "(() => { T.play(); document.getElementById('btn-continue').click(); return { started: __hm.GAME.started, lvl: __hm.GAME.prog && __hm.GAME.prog.level, errors: __hm.errors.slice(0, 3) }; })()")
        check(r['started'] and r['lvl'] == 35 and not r['errors'], 'the character continues in the remembered world')
        r = await ev(page, 'runs on', "(() => { const s = T.sim(20); return { errors: s.errors, nonFinite: s.nonFinite }; })()")
        check(not r['errors'] and r['nonFinite'] == 0, 'twenty seconds on: no errors, nothing non-finite')

        # ---- an old save (no land, no gift) loads into an untouched world ----
        await page.evaluate("""(() => { __hm.SAVE.wiping = true; const s = JSON.parse(localStorage.getItem('hallowmarch.save.v1')); delete s.world.land; if (s.char) delete s.char.gift; localStorage.setItem('hallowmarch.save.v1', JSON.stringify(s)); })()""")
        await boot_again(page)
        r = await ev(page, 'old save', """(() => { const N = __hm.nature.NATURE; return { errors: __hm.errors.slice(0, 4), restored: __hm.land.LAND.restored, felled: N.felled.length, craters: N.craters.length, fires: N.fire.size, tiles: N.tileKeys.length,
          houses: __hm.HOUSES.filter((h) => h.state !== 'whole').length, walls: __hm.fn.castles().reduce((a, C) => a + (C.sections || []).filter((w) => w.state !== 'whole' || w.wear > 0).length, 0), char: !!(__hm.SAVE.loaded && __hm.SAVE.loaded.char) }; })()""")
        check(not r['errors'] and r['restored'] is None and r['felled'] == 0 and r['craters'] == 0 and r['fires'] == 0 and r['tiles'] == 0 and r['houses'] == 0 and r['walls'] == 0, 'an old save loads into an untouched world')
        r = await ev(page, 'old continue', "(() => { document.getElementById('btn-continue').click(); const s = __hm.simulate(5); return { started: __hm.GAME.started, errors: s.errors }; })()")
        check(r['started'] and not r['errors'], 'and its character plays on')
        # a land record from the future (or damaged) is dropped, not trusted
        await page.evaluate("""(() => { __hm.SAVE.wiping = true; const s = JSON.parse(localStorage.getItem('hallowmarch.save.v1') || '{}'); s.world = s.world || {}; s.world.keeps = s.world.keeps || [0,0,1,1,2,2]; s.world.land = { v: 1, fel: [[999999, 3, 'x', null]], cr: [[1, 2, 3]], map: { t: [5], d: '!!!' }, hs: [[-4, 9]], ws: [[99, 99, 1]] }; localStorage.setItem('hallowmarch.save.v1', JSON.stringify(s)); })()""")
        await boot_again(page)
        r = await ev(page, 'damaged land', "(() => ({ errors: __hm.errors.slice(0, 4), restored: __hm.land.LAND.restored, felled: __hm.nature.NATURE.felled.length, ready: __hm.ready }))()")
        check(r['ready'] and r['felled'] == 0 and not r['errors'], f"a damaged land record does not stop the world loading (errors: {r['errors']})")

        print(f'SAVE SIZES: untouched world {size0} bytes; busy world {size1} bytes (land {land1}: {parts}); stored {stored}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS)
        await b.close()

asyncio.run(main())
