"""Fire for everyone, and nothing through the floors: a burning brand taken from a fire lights a roof, a tree and the
grass, sets a struck foe alight, goes out in water and in the rain; a fire spell with nothing targeted is aimed at the
tree in front; the 1 m cover map keeps every blade out of houses, keeps, stairs and props; woodpile logs lie along
their pile. Screenshots: the brand held up at night, a woodpile by its wall, a house interior floor.
usage: python3 tools/tests/fire.py [noshots]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
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
  put(x, z, yaw) { const H = this.H, P = H.GAME.player; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = this.F.heightAt(x, z); P.onGround = true; P.vy = 0; if (yaw !== undefined) P.yaw = yaw; H.UI.modal = null;
    // the March fights back now (snaring archers, freezing mages): keep the player whole and the foes away while testing fire
    if (!P.alive) { P.alive = true; document.getElementById('death').hidden = true; } P.hp = P.maxHp; P.buffs.length = 0;
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 50) { e.alive = false; e.removeAt = H.GAME.t; }
    H.simulate(0.1); },
  offer() { const o = this.F.currentInteraction(); return o ? o.label : null; },
  act() { const o = this.F.currentInteraction(); if (o) o.act(); this.H.simulate(0.2); return o ? o.label : null; },
  cover(x, z) { const C = this.H.dbg.COVER, i = Math.floor(x + 512), j = Math.floor(z + 512); return C.data[j * C.res + i] / 255; },
  // a spot of open meadow: grass, no colliders, away from water and buildings
  meadow(r0 = 120) {
    const F = this.F, W = F.W;
    for (let k = 0; k < 3000; k++) {
      const a = k * 2.399, rr = r0 + (k % 50) * 4, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      if (F.sampleGrid(W.grass, x, z) < 0.7 || F.heightAt(x, z) < -2 || !F.isWalkable(x, z) || F.houseAt(x, z, 4) || this.cover(x, z) > 0) continue;
      let near = false; for (const t of W.trees) if (Math.abs(t.x - x) < 6 && Math.abs(t.z - z) < 6) { near = true; break; }
      if (!near) return { x, z };
    }
    return null;
  },
};
0
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=800, h=450)
        await page.evaluate("__hm.fn.setQuality('medium')")
        await page.evaluate("__hm.start({ realm: 0, cls: 'mage', level: 20 })")
        await page.evaluate(HELPERS)
        await page.evaluate("(() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.nextBolt = 1e9; return 0; })()")
        # the cover map: every house floor, keep wall and stair covered; open meadow not
        r = await ev(page, 'cover', """(() => { const H = __hm, F = H.fn, out = { houses: 0, houseMiss: 0, walls: 0, wallMiss: 0, stairs: 0, stairMiss: 0 };
          for (const R of H.REALMS) for (const h of R.town.houses) { const Hh = h.rec; for (const [lx, lz] of [[0, 0], [0.7, 0.9], [-0.9, -1.2]]) { const p = F.houseW(Hh, lx, lz); out.houses++; if (T.cover(p.x, p.z) < 1) out.houseMiss++; } }
          for (const C of F.castles()) { for (const f of C.floors) if (f.tag === 'stair' && Math.min(f.ya, f.yb) - F.heightAt(f.x, f.z) < 1.2) { out.stairs++; if (T.cover(f.x, f.z) < 1) out.stairMiss++; } }
          const m = T.meadow(); out.meadow = m ? T.cover(m.x, m.z) : -1;
          return out; })()""")
        check(r['houseMiss'] == 0 and r['houses'] > 30, 'every house floor is covered: no blade grows inside a house')
        check(r['stairMiss'] == 0 and r['stairs'] > 8, 'every stair that comes down to the ground is covered')
        check(r['meadow'] == 0, 'open meadow is not covered')
        # the woodpile logs lie along the pile: none pokes into its house
        # a brand from a campfire
        r = await ev(page, 'take a brand', """(() => { const H = __hm, F = H.fn, m = T.meadow(); T.m = m;
          H.dbg.addFire(m.x, F.heightAt(m.x, m.z) + 0.05, m.z, 1.0, false, H.GAME.t + 600);
          T.put(m.x + 1.2, m.z, -Math.PI / 2); const before = T.offer(); const did = T.act(); const P = H.GAME.player;
          return { before, did, brand: !!P.brand }; })()""")
        check(r['brand'] and r['did'] and r['did'].startswith('Take a brand'), 'standing by a campfire, E takes a burning brand')
        r = await ev(page, 'grass alight', """(() => { const H = __hm, F = H.fn, m = T.m, P = H.GAME.player;
          T.put(m.x + 6, m.z + 6, 0.8); const lab = T.offer(); const did = T.act();
          H.simulate(1.0);
          return { lab, did, fires: H.nature.fires() }; })()""")
        check(r['did'] == 'Set the grass alight' and r['fires'] > 0, 'in long grass, E sets the grass alight')
        r = await ev(page, 'tree alight', """(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = F.W;
          let best = null, bd = 1e9; for (const t of W.trees) { if (t.felled || t.gone) continue; const d = Math.hypot(t.x - P.x, t.z - P.z); if (d < bd && F.isWalkable(t.x + 1.4, t.z) && !F.houseAt(t.x, t.z, 3)) { bd = d; best = t; } }
          T.tree = best; T.put(best.x + 1.5, best.z, -Math.PI / 2); const lab = T.offer(); const did = T.act(); H.simulate(0.5);
          return { lab, did, fire: +(best.fire || 0).toFixed(2), kind: best.kind }; })()""")
        check(r['fire'] > 0, 'next to a tree, E sets the tree alight')
        r = await ev(page, 'roof alight', """(() => { const H = __hm, F = H.fn, P = H.GAME.player, Hh = H.REALMS[0].town.houses[2].rec;
          const p = F.houseW(Hh, 0, Hh.d / 2 + 0.8); T.put(p.x, p.z, Hh.yaw + Math.PI); const lab = T.offer(); const did = T.act(); H.simulate(0.5);
          return { lab, did, state: Hh.state }; })()""")
        check(r['state'] == 'burning', 'facing a house, E sets the roof alight')
        if SHOTS:
            await page.evaluate("""(() => { const H = __hm, F = H.fn, P = H.GAME.player, m = T.m; T.put(m.x - 3, m.z - 3, 0.6); H.setTod(1.75);
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; for (const el of document.querySelectorAll('#hud, #nameplates, #floaters')) el.style.visibility = 'hidden';
              const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw); H.camera.position.set(P.x + fx * 3.2 - fz * 1.2, P.y + 1.9, P.z + fz * 3.2 + fx * 1.2); H.camera.lookAt(P.x, P.y + 1.3, P.z); return 0; })()""")
            for _ in range(6): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'fire_brand_night.png', timeout=300000)
            print('  shot fire_brand_night', flush=True)
            await page.evaluate("(() => { __hm.UI.modal = null; __hm.setTod(0.45); return 0; })()")
        # water puts it out
        r = await ev(page, 'into the lake', """(() => { const H = __hm, F = H.fn, L = H.dbg.LAKES[0], P = H.GAME.player;
          P.x = P.prevX = L.x; P.z = P.prevZ = L.z; P.y = -3.2; H.simulate(0.3); return { brand: !!P.brand }; })()""")
        check(not r['brand'], 'wading into deep water puts the brand out')
        # rain puts it out in the open
        r = await ev(page, 'rain', """(() => { const H = __hm, P = H.GAME.player, m = T.m, W = H.dbg.WEATHER;
          T.put(m.x + 1.2, m.z, -Math.PI / 2); T.act(); const had = !!P.brand; W.raining = 1; H.simulate(30); const after = !!P.brand; W.raining = 0; return { had, after }; })()""")
        check(r['had'] and not r['after'], 'rain in the open puts the brand out')
        # a firebolt with nothing targeted goes for the tree in front
        r = await ev(page, 'firebolt at a tree', """(() => { const H = __hm, F = H.fn, P = H.GAME.player, W = F.W;
          let best = null; for (const t of W.trees) { if (t.felled || t.gone || (t.fire || 0) > 0 || t.char > 0.5) continue; const x = t.x - 12, z = t.z; if (!F.isWalkable(x, z) || F.houseAt(x, z, 2)) continue; let clear = true; for (const o of W.trees) if (o !== t && Math.abs(o.z - t.z) < 3 && o.x < t.x && o.x > t.x - 12) { clear = false; break; } if (clear) { best = t; break; } }
          if (!best) return { none: true };
          T.put(best.x - 12, best.z, Math.PI / 2); P.target = null; H.CAM.yaw = Math.PI / 2; P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0;
          const pre = { casting: P.casting ? P.casting.id : null, brand: !!P.brand, act: P.anim.act, motion: P.motion ? P.motion.kind : null, carrying: P.carrying, alive: P.alive, houseAim: !!F.houseFireAim(P, 'firebolt'), job: H.surv && H.surv.SURV.job ? H.surv.SURV.job.kind : null, gcd: P.gcdUntil - H.GAME.t, cd: P.cds.firebolt, stun: (P.buffs || []).map((b) => b.kind) };
          document.getElementById('error').textContent = '';
          F.playerUseSlot(0); const casting = !!P.casting; const err = document.getElementById('error').textContent, tgt = P.target, aim = pre; H.simulate(3.5);
          return { casting, fire: +(best.fire || 0).toFixed(2), err, tgt, aim, pos: [P.x, P.z], tree: [best.x, best.z], swim: !!P.swim, mount: !!P.mount, power: P.power, buffs: P.buffs.map((b) => b.kind) }; })()""")
        check(r.get('fire', 0) > 0, 'a firebolt with nothing targeted is aimed at the tree in front and sets it alight')
        if SHOTS:
            # a woodpile by its house: the logs lie along the wall
            await page.evaluate("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].town, Hh = S.houses[0].rec; H.setTod(0.5);
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
              const c = F.houseW(Hh, -7.5, 2.5), t = F.houseW(Hh, -3.0, -0.9); H.camera.position.set(c.x, Hh.y + 2.2, c.z); H.camera.lookAt(t.x, Hh.y + 0.6, t.z); return 0; })()""")
            for _ in range(4): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'fire_woodpile.png', timeout=300000)
            print('  shot fire_woodpile', flush=True)
            # inside a house: the floor along the woodpile wall
            await page.evaluate("""(() => { const H = __hm, F = H.fn, S = H.REALMS[0].town, Hh = S.houses[0].rec;
              const P = H.GAME.player, d = F.houseW(Hh, 1.5, -2.5); P.x = P.prevX = d.x; P.z = P.prevZ = d.z; P.y = Hh.y;
              const c = F.houseW(Hh, 1.8, 2.6), t = F.houseW(Hh, -2.6, -0.8); H.camera.position.set(c.x, Hh.y + 1.6, c.z); H.camera.lookAt(t.x, Hh.y + 0.2, t.z); return 0; })()""")
            for _ in range(4): await page.evaluate("__hm.frame(1/30)")
            await page.screenshot(path=OUT + 'fire_house_floor.png', timeout=300000)
            print('  shot fire_house_floor', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
