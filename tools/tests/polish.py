"""[polish] Boats a body can push, a boat shoved off the shore, a drifting boat that comes to rest without shuddering,
tracks kept with the world (old and damaged saves too), the drifts' map that keeps grass out of them, and the planted
feet held by the foot lock (13s_footlock.js; the full measures are tools/tests/motion.py). Screenshots: footprints in
snow at high and at low quality, a boat being pushed by a swimmer, a drift against a wall with the grass round it.
usage: python3 tools/tests/polish.py [noshots] [shotsonly] [only=boats,tracks,drift,lock] [small]"""
import json, asyncio, sys, pathlib, time, base64
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
SHOTS = 'noshots' not in sys.argv
SHOTSONLY = 'shotsonly' in sys.argv
ONLY = [a[5:] for a in sys.argv if a.startswith('only=')]
def want(name): return not SHOTSONLY and (not ONLY or name in ONLY[0].split(','))

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

HELP = r"""
window.PL = {
  H: __hm, F: __hm.fn, Wt: __hm.water,
  safe() { const H = this.H, P = H.GAME.player; P.maxHp = Math.max(P.maxHp, 2000); P.hp = P.maxHp; P.combatUntil = -99;
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 90) { e.alive = false; e.removeAt = H.GAME.t; } },
  lakeSpot(realm, minD) { const L = this.H.dbg.LAKES.find((l) => l.realm === realm); for (let r = 0; r < 40; r += 0.5) for (let a = 0; a < 12; a++) { const x = L.x + Math.cos(a * 0.52) * r, z = L.z + Math.sin(a * 0.52) * r, w = this.Wt.waterAt(x, z); if (w && w.depth >= minD && Math.hypot(w.fx, w.fz) < 0.05) return { x, z, y: w.y }; } return null; },
  // is (x, z) inside boat i's hull (the ellipse bodies are kept out of), and how far in (q < 1)
  hullQ(B, x, z, r = 0.36) { const c = Math.cos(B.yaw), s = Math.sin(B.yaw), dx = x - B.x, dz = z - B.z, lx = dx * c - dz * s, lz = dx * s + dz * c, a = 0.68 + r, b = 2.15 + r; return (lx * lx) / (a * a) + (lz * lz) / (b * b); },
  cam(c, l) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; document.getElementById('hud').hidden = true; const cm = H.camera; cm.position.set(c[0], c[1], c[2]); cm.lookAt(l[0], l[1], l[2]); cm.updateMatrixWorld(); },
  play() { const H = this.H; H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; },
};
0
"""

async def snap(page, name):
    url = await page.evaluate("(() => { __hm.frame(1 / 30); __hm.frame(1 / 30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    pathlib.Path(OUT + name).write_bytes(base64.b64decode(url.split(',', 1)[1]))
    print('  shot', OUT + name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    async with async_playwright() as p:
        W, Hh = (960, 540) if SHOTS and 'small' not in sys.argv else (640, 360)
        b, page, logs = await setup(p, w=W, h=Hh)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await page.evaluate("__hm.start({ realm: 2, cls: 'warrior', level: 20 }); __hm.setTod(0.42); 0")
        await page.evaluate(HELP)
        await page.evaluate("(() => { const W = __hm.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; W.nextBolt = 1e9; PL.safe(); __hm.simulate(1); return 0; })()")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)

        if want('boats'):
            # 1. a swimmer pushes a boat lying free on a lake: she moves away from the push and turns a little (pushed off
            # her middle), the swimmer never inside her hull, her hull never over land
            r = await ev(page, 'push', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS, P = H.GAME.player; PL.safe();
              H.farm.setSeason(0.42); H.seasons.seasonSettle(); // (summer: no ice on the lakes)
              const sp = PL.lakeSpot(0, 2.6); const i = Bt.list().findIndex((q) => !q.home); const B = Bs.list[i];
              B.x = sp.x; B.z = sp.z; B.yaw = 0.3; B.st = 'free'; B.grounded = 0; B.vx = B.vz = B.wr = 0; B.still = false;
              const c = Math.cos(B.yaw), s = Math.sin(B.yaw);
              // the swimmer 1.6 m off her port side, a metre ahead of her middle, swimming straight at her
              const lx = 1.6, lz = 1.0, x0 = B.x + lx * c + lz * s, z0 = B.z - lx * s + lz * c;
              H.teleport(x0, z0); const w = PL.Wt.waterAt(x0, z0); P.y = w.y - 1.3; H.simulate(0.4);
              const yaw0 = B.yaw, bx0 = B.x, bz0 = B.z; let qMin = 9, land = 0;
              H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW');
              for (let k = 0; k < 180; k++) { H.CAM.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.simulate(1 / 60, 1 / 60); qMin = Math.min(qMin, PL.hullQ(B, P.x, P.z, 0.0)); const h = Bt.hit(i); if (h && h.why === 'shore') land++; }
              H.INPUT.keys.clear();
              const moved = Math.hypot(B.x - bx0, B.z - bz0), dir = ((B.x - bx0) * (bx0 - x0) + (B.z - bz0) * (bz0 - z0)) / Math.max(moved, 1e-6) / Math.hypot(bx0 - x0, bz0 - z0);
              window.__plB = i;
              return { i, moved: +moved.toFixed(2), away: +dir.toFixed(2), turned: +Math.abs(B.yaw - yaw0).toFixed(3), qMin: +qMin.toFixed(2), land, swim: !!P.swim, st: B.st }; })()""")
            check(r['moved'] > 0.4 and r['away'] > 0.3, f"a swimmer pushes a free boat away ({r['moved']} m, along the push {r['away']})")
            check(r['turned'] > 0.02, f"pushed off her middle she turns ({r['turned']} rad)")
            check(r['qMin'] > 0.85, f"the swimmer never gets inside her hull (least ellipse measure {r['qMin']})")
            check(r['land'] == 0, f"her hull never goes over land ({r['land']} steps)")
            # 2. a moored boat does not give
            r = await ev(page, 'moored', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS, P = H.GAME.player;
              const i = Bt.list().findIndex((q) => q.home && q.st === 'moored'); const B = Bs.list[i]; const x0 = B.x, z0 = B.z;
              Bt.pushed(B, P, 0.05, 0.0, B.x + 0.5, B.z, 1); for (let k = 0; k < 60; k++) H.simulate(1 / 60, 1 / 60);
              return { moved: +Math.hypot(B.x - x0, B.z - z0).toFixed(3), st: B.st }; })()""")
            check(r['moved'] < 0.01 and r['st'] == 'moored', f"a boat tied to the jetty does not give ({json.dumps(r)})")
            # 3. shoving a beached boat into the water: the offer at her shore end, the pose, and she floats free
            r = await ev(page, 'shove', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS, P = H.GAME.player; PL.safe();
              let i = Bt.list().findIndex((q) => q.st === 'beached'); if (i < 0) return null; const B = Bs.list[i];
              const E = Bt.shoveEnd(i); H.teleport(E.x, E.z); P.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.CAM.yaw = P.yaw; H.UI.modal = null; H.simulate(0.2);
              const label = H.surv.ci();
              const before = { x: B.x, z: B.z, hit: !!Bt.hit(i) };
              if (label === 'Shove the boat into the water') H.fn.playerInteract();
              const act = P.anim.act;
              let t = 0; for (; t < 8 && (B.launch || B.grounded > 0.5); t += 0.1) H.simulate(0.1, 1 / 60);
              for (let k = 0; k < 20; k++) H.simulate(0.1, 1 / 60);
              return { i, label, act, t: +t.toFixed(1), moved: +Math.hypot(B.x - before.x, B.z - before.z).toFixed(2), st: B.st, grounded: B.grounded, afloat: !Bt.hit(i), wasAground: before.hit }; })()""")
            check(r and r['label'] == 'Shove the boat into the water', f"at her shore end, Use offers to shove the beached boat off ({r and r['label']})")
            check(r and r['act'] == 19, f"you lean into her (body action 19: {r and r['act']})")
            check(r and r['afloat'] and r['grounded'] < 0.5 and r['st'] == 'free' and r['moved'] > 1.0, f"she slides off the shore and floats free ({json.dumps(r)})")
            # 4. a boat drifting in to the shore comes to rest against it without shuddering
            r = await ev(page, 'rest', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS; const i = window.__plB, B = Bs.list[i];
              // head her slowly for the nearest shore
              let best = null; for (let a = 0; a < 6.28; a += 0.2) { for (let d = 1; d < 60; d += 1) { if (!PL.Wt.waterAt(B.x + Math.sin(a) * d, B.z + Math.cos(a) * d)) { if (!best || d < best.d) best = { a, d }; break; } } }
              // (moved in to lie a couple of metres off that shore, bow first)
              let dd = best.d - 4.4; while (dd > 0 && Bt.hit(i, B.x + Math.sin(best.a) * dd, B.z + Math.cos(best.a) * dd, best.a)) dd -= 0.5;
              if (dd > 0) { B.x += Math.sin(best.a) * dd; B.z += Math.cos(best.a) * dd; } B.yaw = best.a;
              B.vx = Math.sin(best.a) * 0.6; B.vz = Math.cos(best.a) * 0.6; B.wr = 0; B.still = false; B.st = 'free'; B.grounded = 0;
              let t = 0; for (; t < 40 && !B.still && B.grounded < 0.5; t += 0.25) H.simulate(0.25, 1 / 60);
              for (let k = 0; k < 60; k++) H.simulate(1 / 60, 1 / 60);
              let dmax = 0, ymax = 0, px = B.x, pz = B.z, py = B.yaw; for (let k = 0; k < 120; k++) { H.simulate(1 / 60, 1 / 60); dmax = Math.max(dmax, Math.hypot(B.x - px, B.z - pz)); ymax = Math.max(ymax, Math.abs(B.yaw - py)); px = B.x; pz = B.z; py = B.yaw; }
              return { t, d: best.d, still: !!B.still, grounded: B.grounded, touched: !!Bt.hit(i, B.x + Math.sin(B.yaw) * 0.3, B.z + Math.cos(B.yaw) * 0.3), stepMax: +(dmax * 1000).toFixed(2), yawMax: +(ymax * 1000).toFixed(2) }; })()""")
            check((r['still'] or r['grounded'] > 0.5) and r['stepMax'] < 1.0 and r['yawMax'] < 1.0, f"drifted in, she lies still against the shore (largest step {r['stepMax']} mm, turn {r['yawMax']} mrad; {json.dumps(r)})")

        if want('tracks'):
            # tracks in the snow, saved with the world and laid again from the save; an old save and a damaged one
            r = await ev(page, 'walk', """(() => { const H = PL.H, T = PL.Wt.tracks, P = H.GAME.player; PL.safe(); if (P.boat) PL.Wt.boats.leave();
              H.farm.setSeason(0.875); H.seasons.seasonSettle();
              const R = H.REALMS[2]; let s = null; for (let k = 0; k < 60 && !s; k++) { const x = R.town.x + 46 + k * 2, z = R.town.z - 24; if (T.surface(x, z) === 0 && H.fn.isWalkable(x, z)) s = { x, z }; }
              H.teleport(s.x, s.z); H.simulate(0.2); const n0 = T.TRACKS.laid; H.UI.modal = null; H.CAM.yaw = 0.4;
              for (let k = 0; k < 60; k++) { H.INPUT.keys.add('KeyW'); H.simulate(0.05, 0.05); } H.INPUT.keys.clear();
              window.__plS = s; return { s, laid: T.TRACKS.laid - n0, near: T.prints(P.x, P.z, 20).length }; })()""")
            check(r['laid'] > 6, f"walking in the snow lays prints ({r['laid']})")
            r = await ev(page, 'save', """(() => { const H = PL.H, T = PL.Wt.tracks, TR = T.TRACKS, P = H.GAME.player;
              const d = T.save(); if (!d) return null; const json = JSON.stringify(d), n = d.p.length / 8;
              const before = T.prints(P.x, P.z, 20).map((q) => [q.x, q.z, q.kind, q.surf]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
              const shows0 = T.prints(P.x, P.z, 20).map((q) => T.shows(q.i)).sort();
              // the ring cleared, as a fresh page would have it, then the save laid again
              const A = TR.mesh.geometry.attributes; A.iK.array.fill(0); TR.n = 0; TR.head = 0; TR.cells.clear(); TR.cellOf.fill(-1);
              T.load(d);
              const after = T.prints(P.x, P.z, 20).map((q) => [q.x, q.z, q.kind, q.surf]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
              const shows1 = T.prints(P.x, P.z, 20).map((q) => T.shows(q.i)).sort();
              let err = 0; for (let k = 0; k < Math.min(before.length, after.length); k++) err = Math.max(err, Math.hypot(before[k][0] - after[k][0], before[k][1] - after[k][1]));
              let sErr = 0; for (let k = 0; k < Math.min(shows0.length, shows1.length); k++) sErr = Math.max(sErr, Math.abs(shows0[k] - shows1[k]));
              // the part's key does not change with every print
              const P2 = H.dbg && 0; const key = (x) => Math.floor(x.laid / 40);
              return { n, bytes: json.length, before: before.length, after: after.length, err: +err.toFixed(3), sErr: +sErr.toFixed(3), loaded: TR.loaded, keyStep: key({ laid: d.laid }) === key({ laid: d.laid + 1 }) || key({ laid: d.laid + 1 }) === key({ laid: d.laid + 2 }) }; })()""")
            check(r and r['n'] > 6 and r['after'] == r['before'] and r['err'] < 0.02, f"the prints come back from the save where they were ({json.dumps(r)})")
            check(r and r['sErr'] < 0.05, f"as filled or dried as they had become (largest difference {r and r['sErr']})")
            check(r and r['bytes'] < 16000, f"the part stays small ({r and r['bytes']} bytes for {r and r['n']} prints)")
            r = await ev(page, 'oldsave', """(() => { const T = PL.Wt.tracks, H = PL.H; const n0 = T.TRACKS.laid; let errs = 0;
              try { T.load(undefined); T.load(null); T.load({}); T.load({ v: 1, p: 'x' }); T.load({ p: [1, 2, 3] }); T.load({ p: ['a', NaN, null, 1e12, -5, 99, 0, 0, 1e9, 1e9, 1, 1, 0, 0, 0, 0] }); } catch (e) { errs++; }
              return { errs, laid: T.TRACKS.laid - n0, hmErrors: H.errors.length }; })()""")
            check(r['errs'] == 0 and r['laid'] == 0, f"an old save (no tracks) and a damaged one load without harm ({json.dumps(r)})")

        if want('drift'):
            r = await ev(page, 'driftmap', """(() => { const H = PL.H, T = PL.Wt.tracks, TR = T.TRACKS; const D = T.driftMap ? T.driftMap() : null; return { n: TR.drifts.length, map: D ? D.data.reduce((a, v) => a + (v > 0 ? 1 : 0), 0) : null }; })()""")
            check(r['map'] is None or r['map'] > 50, f"the drifts are in the grass's map of them ({json.dumps(r)})")

        if want('lock'):
            # a soldier walking while shoved sideways keeps its planted feet (the full table: motion.py)
            r = await ev(page, 'lock', """(() => { const H = PL.H, F = H.fn, P = H.GAME.player; const R = H.REALMS[2], S = R.musterSite; const e = F.spawnRealmUnit(2, 'warrior', 10, 'test', S.x + 8, S.z + 8); e.role = 'test';
              const L = []; for (let k = 0; k < 120; k++) { e.x += 0.8 / 60; e.z += 1.2 / 60; e.yaw = Math.atan2(0, 1); H.simulate(1 / 60, 1 / 60); if (e._fl) L.push(e._fl.map((o) => o.down ? 1 : 0).join('')); }
              const ok = !!e._fl && e._fl.some((o) => Math.abs(o.cx) > 0.02); F.removeEnt(e); return { tracked: L.length, held: ok }; })()""")
            check(r['tracked'] > 60 and r['held'], f"a shoved body's planted feet are held where they came down ({json.dumps(r)})")

        if SHOTS:
            await page.evaluate("(() => { window.requestAnimationFrame = () => 0; __hm.dbg.WEATHER.mode = 'clear'; __hm.dbg.WEATHER.wet = 0; __hm.dbg.U.uWet.value = 0; __hm.setTod(0.42); return 0; })()")
            for q in ('high', 'low'):
                await page.evaluate("__hm.fn.setQuality('%s'); 0" % q)
                await ev(page, f'shot-prints-{q}', """(() => { const H = PL.H, T = PL.Wt.tracks, P = H.GAME.player; PL.play(); PL.safe(); if (P.boat) PL.Wt.boats.leave();
                  H.farm.setSeason(0.875); H.seasons.seasonSettle(); H.dbg.WEATHER.snow = 0; H.dbg.WEATHER.snowing = 0;
                  const R = H.REALMS[2]; let s = null; for (let k = 0; k < 60 && !s; k++) { const x = R.town.x + 46 + k * 2, z = R.town.z - 26; if (T.surface(x, z) === 0 && H.fn.isWalkable(x, z)) s = { x, z }; }
                  H.teleport(s.x, s.z); H.simulate(0.2); H.UI.modal = null; H.CAM.yaw = 0.4; for (let k = 0; k < 70; k++) { H.INPUT.keys.add('KeyW'); H.simulate(0.05, 0.05); if (k === 30) H.CAM.yaw = -0.2; } H.INPUT.keys.clear();
                  // the camera where a player would have it, a few metres behind and above, looking back along the trail
                  const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), g = H.fn.heightAt(P.x, P.z);
                  PL.cam([P.x + fx * 4.5 + fz * 1.2, g + 3.2, P.z + fz * 4.5 - fx * 1.2], [s.x * 0.4 + P.x * 0.6, g, s.z * 0.4 + P.z * 0.6]); for (let i = 0; i < 6; i++) H.frame(1 / 30);
                  return { n: T.prints(P.x, P.z, 20).length }; })()""")
                await snap(page, f'polish_prints_{q}.png')
            await page.evaluate("__hm.fn.setQuality('high'); 0")
            await ev(page, 'shot-push', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS, P = H.GAME.player; PL.play(); PL.safe();
              H.farm.setSeason(0.42); H.seasons.seasonSettle();
              const sp = PL.lakeSpot(0, 2.6); const i = Bt.list().findIndex((q) => !q.home); const B = Bs.list[i];
              B.x = sp.x; B.z = sp.z; B.yaw = 0.3; B.st = 'free'; B.grounded = 0; B.vx = B.vz = B.wr = 0; B.still = false;
              const c = Math.cos(B.yaw), s = Math.sin(B.yaw), x0 = B.x + 1.5 * c + 0.4 * s, z0 = B.z - 1.5 * s + 0.4 * c;
              H.teleport(x0, z0); const w = PL.Wt.waterAt(x0, z0); P.y = w.y - 1.3; H.simulate(0.3);
              H.UI.modal = null; H.INPUT.keys.add('KeyW'); for (let k = 0; k < 70; k++) { H.CAM.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.simulate(1 / 60, 1 / 60); } H.INPUT.keys.clear();
              const fx = Math.sin(B.yaw), fz = Math.cos(B.yaw);
              PL.cam([B.x + fx * 5.5 + fz * 4.0, w.y + 2.6, B.z + fz * 5.5 - fx * 4.0], [B.x + c * 0.6, w.y + 0.2, B.z - s * 0.6]); for (let k = 0; k < 6; k++) H.frame(1 / 30);
              return { sp: Math.hypot(B.vx, B.vz) }; })()""")
            await snap(page, 'polish_boat_push.png')
            await ev(page, 'shot-shove', """(() => { const H = PL.H, Bt = PL.Wt.boats, Bs = Bt.BOATS, P = H.GAME.player; PL.play(); PL.safe();
              const i = Bt.list().findIndex((q) => q.st === 'beached'); if (i < 0) return null; const B = Bs.list[i];
              const E = Bt.shoveEnd(i); H.teleport(E.x, E.z); H.simulate(0.1); Bt.shoveOff(i); H.simulate(0.55, 1 / 60);
              const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw), g = H.fn.heightAt(P.x, P.z);
              PL.cam([P.x - fz * 3.6 - fx * 0.8, g + 1.7, P.z + fx * 3.6 - fz * 0.8], [P.x + fx * 1.2, g + 0.8, P.z + fz * 1.2]); for (let k = 0; k < 4; k++) H.frame(1 / 30);
              return { act: P.anim.act }; })()""")
            await snap(page, 'polish_boat_shove.png')
            await ev(page, 'shot-drift', """(() => { const H = PL.H, T = PL.Wt.tracks, P = H.GAME.player; PL.play(); PL.safe();
              H.farm.setSeason(0.82); H.seasons.seasonSettle(); H.dbg.WEATHER.snow = 0;
              const R = H.REALMS[2]; let best = null;
              for (const D of T.TRACKS.drifts) { const d = Math.hypot(D.x - R.town.x, D.z - R.town.z); if (d > 90) continue; if (!best || d < best.d) best = { D, d }; }
              if (!best) return null; const D = best.D, pos = D.m.geometry.attributes.position.array, ad = D.m.geometry.attributes.aD.array;
              let k = 0, bd = 1e9; for (let i = 0; i < pos.length / 3; i++) { if (ad[i * 4 + 1] !== 0) continue; const dd = Math.hypot(pos[i * 3] - D.x, pos[i * 3 + 2] - D.z); if (dd < bd) { bd = dd; k = i; } }
              const fx = pos[k * 3], fz = pos[k * 3 + 2], nx = ad[k * 4 + 2], nz = ad[k * 4 + 3], g = H.fn.heightAt(fx, fz);
              H.teleport(fx + nx * 9, fz + nz * 9); H.simulate(0.3);
              PL.cam([fx + nx * 5.5 - nz * 2.5, g + 1.6, fz + nz * 5.5 + nx * 2.5], [fx, g + 0.3, fz]); for (let i = 0; i < 10; i++) H.frame(1 / 30);
              return { lie: H.seasons.lie(fx, fz) }; })()""")
            await snap(page, 'polish_drift.png')

        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l or 'ERROR' in l for l in logs), 'every shader compiles ' + str([l for l in logs if 'Shader Error' in l or 'ERROR' in l][:1])[:300])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
