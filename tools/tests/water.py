"""Water: rivers, ponds and lakes that work, wading and swimming for the player, a soldier and a wolf, the current
carrying a swimmer, the camera above the surface, fire put out, drinking and filling a waterskin, the walk mask and
the world check (every river course has water, no dry pond beds, no road through deep water); then screenshots.
usage: python3 tools/tests/water.py [shots] [medium]"""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

SHOTS = 'shots' in sys.argv[1:]
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

WORLD = """(() => { const H = __hm, Wt = H.water, F = H.fn, W = F.W, HN = 513, G = Wt.WATERGRID;
  const out = { rivers: [], lakes: H.dbg.LAKES.length, cells: Wt.meshes().cells, meshes: Wt.meshes().n };
  for (const Rv of Wt.RIVERS) {
    let dry = 0, shallow = 0, n = 0, bedAbove = 0;
    for (const p of Rv.pts) { n++; const w = Wt.waterAt(p.x, p.z); if (!w) { dry++; continue; } if (w.depth < 0.25) shallow++; if (F.heightAt(p.x, p.z) > p.surf - 0.1) bedAbove++; }
    const bad = Rv.pts.map((p, i) => { const w = Wt.waterAt(p.x, p.z); return [i, +p.x.toFixed(1), +p.z.toFixed(1), +p.surf.toFixed(2), +F.heightAt(p.x, p.z).toFixed(2), w ? +w.depth.toFixed(2) : null]; }).filter((q) => q[5] === null || q[5] < 0.25 || q[4] > q[3] - 0.1);
    out.rivers.push({ realm: Rv.realm, len: Math.round(Rv.len), n, dry, shallow, bedAbove, top: +Rv.pts[0].surf.toFixed(2), mouth: +Rv.pts[Rv.pts.length - 1].surf.toFixed(2), bad });
  }
  // water texels, deep texels, and connected bodies of water
  let water = 0, deep = 0; const lab = new Int32Array(HN * HN).fill(-1), sizes = [];
  for (let k = 0; k < HN * HN; k++) { if (!isNaN(G.surf[k])) water++; if (W.walk[k] === 2) deep++; }
  for (let k = 0; k < HN * HN; k++) {
    if (isNaN(G.surf[k]) || lab[k] >= 0) continue;
    const id = sizes.length; let sz = 0; const st = [k]; lab[k] = id;
    while (st.length) { const q = st.pop(); sz++; const i = q % HN, j = (q / HN) | 0;
      for (const [di, dj] of [[1,0],[-1,0],[0,1],[0,-1]]) { const ii = i + di, jj = j + dj; if (ii < 0 || jj < 0 || ii >= HN || jj >= HN) continue; const r = jj * HN + ii; if (!isNaN(G.surf[r]) && lab[r] < 0) { lab[r] = id; st.push(r); } } }
    sizes.push(sz);
  }
  out.water = water; out.deep = deep; out.bodies = sizes.length; out.bodySizes = sizes.slice().sort((a, b) => b - a).slice(0, 12);
  // dry pond beds: closed hollows in the ground deeper than 0.6 m with no water in them
  let hollows = 0; const hol = [];
  for (let j = 4; j < HN - 4; j += 2) for (let i = 4; i < HN - 4; i += 2) {
    const k = j * HN + i, h = W.H[k], x = -512 + i * 2, z = -512 + j * 2;
    if (!isNaN(G.surf[k]) || Math.hypot(x, z) > 470 || x > 500) continue;
    let rim = Infinity;
    for (let a = 0; a < 12; a++) { const aa = a / 12 * Math.PI * 2; let m = -Infinity; for (let r = 2; r <= 10; r += 2) m = Math.max(m, F.heightAt(x + Math.cos(aa) * r, z + Math.sin(aa) * r)); rim = Math.min(rim, m); }
    if (rim - h > 0.6) { hollows++; if (hol.length < 8) hol.push([x, z, +(rim - h).toFixed(2)]); }
  }
  out.dryHollows = hollows; out.hollowAt = hol;
  // roads that would make a soldier swim, and sites standing in water
  let roadDeep = 0; for (const S of W.roads) for (let t = 0; t <= 1; t += 0.02) { const x = S.ax + (S.bx - S.ax) * t, z = S.az + (S.bz - S.az) * t; if (Wt.deepWaterAt(x, z)) roadDeep++; }
  out.roadDeep = roadDeep; out.ponds = H.water.PONDS ? H.water.PONDS.map((p) => [Math.round(p.x), Math.round(p.z), +p.y.toFixed(2), p.n, +p.depth.toFixed(2)]) : null; out.filled = H.water.PONDS ? H.water.PONDS.filled : null;
  let navDeep = 0; return out; })()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if SHOTS else 640, h=540 if SHOTS else 360)
        r = await page.evaluate("(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); return { errors: __hm.errors.slice(0, 3), programs: __hm.renderInfo().programs }; })()")
        print('boot', json.dumps(r))
        check(not r['errors'], 'boots without errors')
        w = await page.evaluate(WORLD)
        print('world', json.dumps(w))
        check(len(w['rivers']) == 3, 'a river in every realm')
        check(all(rv['dry'] == 0 for rv in w['rivers']), 'every point of every river course has water')
        check(all(rv['bedAbove'] == 0 for rv in w['rivers']), 'no river bed rises above its water')
        check(all(rv['top'] > rv['mouth'] + 1 for rv in w['rivers']), 'the rivers fall toward their lakes')
        check(w['roadDeep'] == 0, 'no road runs through deep water')
        check(w['dryHollows'] == 0, 'no dry pond beds (closed hollows without water)')
        check(w['cells'] > 1000, 'the water mesh covers the water (%d cells)' % w['cells'])

        # ---- the player wading and swimming ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          // a line from the lake's middle outward: find depths
          const out = { samples: [] };
          const dir = [Math.cos(0.7), Math.sin(0.7)];
          let spots = {};
          for (let r = 0; r < 60; r += 0.2) { const x = L.x + dir[0] * r, z = L.z + dir[1] * r, w = Wt.waterAt(x, z); const d = w ? w.depth : 0;
            if (!spots.deep && d > 2.0) spots.deep = [x, z]; if (d < 1.05 && d > 0.8 && !spots.waist) spots.waist = [x, z]; if (d < 0.65 && d > 0.35 && !spots.knee) spots.knee = [x, z]; if (!w && !spots.dry) spots.dry = [x + dir[0] * 3, z + dir[1] * 3]; }
          out.spots = spots;
          const meas = (s) => { H.teleport(s[0], s[1]); H.simulate(0.6); const st = Wt.state(P.id); return { ...st, surf: (Wt.waterAt(P.x, P.z) || {}).y ?? null, ground: F.heightAt(P.x, P.z) }; };
          out.dry = meas(spots.dry); out.knee = meas(spots.knee); out.waist = meas(spots.waist); out.deep = meas(spots.deep);
          out.errors = H.errors.slice(0, 3); return out; })()""")
        print('player', json.dumps(r))
        dry, knee, waist, deep = r['dry'], r['knee'], r['waist'], r['deep']
        check(not dry['swim'] and dry['speed'] > knee['speed'] > waist['speed'], 'wading slows the player as the water deepens (%.2f > %.2f > %.2f)' % (dry['speed'], knee['speed'], waist['speed']))
        check(not knee['swim'] and not waist['swim'], 'knee- and waist-deep water is waded')
        check(deep['swim'] and deep['speed'] < waist['speed'], 'chest-deep water is swum, slowly (%.2f)' % deep['speed'])
        check(deep['swim'] and abs(deep['y'] - (deep['surf'] - 1.3)) < 0.06, 'the swimmer floats with head and shoulders out (feet %.2f below the surface)' % (deep['surf'] - deep['y']))
        check(waist['wl'] > 0.7 and knee['wl'] > 0.35, 'gear soaks up to the waterline (knee %.2f, waist %.2f)' % (knee['wl'], waist['wl']))
        check(deep['wet'] > 0.9, 'a swimmer is soaked through')

        # ---- moving: swim across, the camera above water, no casting ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          H.teleport(L.x, L.z); H.simulate(0.5);
          H.CAM.yaw = 0.5; H.INPUT.keys.add('KeyW'); const x0 = P.x, z0 = P.z; H.simulate(3); H.INPUT.keys.delete('KeyW');
          const moved = Math.hypot(P.x - x0, P.z - z0); const st = Wt.state(P.id);
          H.CAM.mode = 'play'; H.CAM.pitch = -0.25; H.CAM.targetDist = H.CAM.dist = 8; for (let i = 0; i < 4; i++) H.frame(0.05);
          const cam = H.camera.position, ws = Wt.waterAt(cam.x, cam.z);
          const fb = F.useAbility(P, 'taunt', null);
          return { moved, st, camY: cam.y, surfAtCam: ws ? ws.y : null, ground: F.heightAt(cam.x, cam.z), errors: H.errors.slice(0, 3) }; })()""")
        print('swim', json.dumps(r))
        check(r['st']['swim'] and 6 < r['moved'] < 11, 'the player swims forward at about 2.9 m/s (%.1f m in 3 s)' % r['moved'])
        check(r['surfAtCam'] is None or r['camY'] > r['surfAtCam'] + 0.3, 'the camera stays above the water (cam %.2f, surface %s)' % (r['camY'], r['surfAtCam']))
        r = await page.evaluate("""(() => { const H = __hm, F = H.fn, P = H.GAME.player; P.power = P.maxPower; P.level = 20;
          const cls = H.CLASSES; const res = {};
          for (const id of ['firebolt', 'quickshot', 'smite', 'meteor']) res[id] = F.useAbility(P, id, P) ;
          return res; })()""")
        print('abilities while swimming', json.dumps(r))
        check(all(v == 'swimming' for v in r.values()), 'no casting or shooting while swimming')

        # ---- the current carries a swimmer ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player;
          let best = null;
          for (const Rv of Wt.RIVERS) for (const p of Rv.pts) { const w = Wt.waterAt(p.x, p.z); if (w && w.depth > 1.5 && Math.hypot(w.fx, w.fz) > 0.5 && (!best || Math.hypot(w.fx, w.fz) > best.f)) best = { x: p.x, z: p.z, f: Math.hypot(w.fx, w.fz), fx: w.fx, fz: w.fz, depth: w.depth }; }
          if (!best) return { none: true };
          H.teleport(best.x, best.z); H.simulate(0.3); const x0 = P.x, z0 = P.z; H.simulate(3);
          const dx = P.x - x0, dz = P.z - z0, along = (dx * best.fx + dz * best.fz) / best.f;
          return { best, along, swim: Wt.state(P.id).swim, errors: H.errors.slice(0, 3) }; })()""")
        print('current', json.dumps(r))
        check(not r.get('none') and r['along'] > 1.5, 'a river carries a swimmer downstream (%.1f m in 3 s)' % r.get('along', 0))

        # ---- a rider's horse will not go deep ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          H.teleport(L.x + 70, L.z + 70); H.simulate(0.3); F.mountUp(P, true); const before = !!P.mount;
          H.teleport(L.x, L.z); H.simulate(0.5); const st = Wt.state(P.id);
          return { before, after: !!P.mount, swim: st.swim, errors: H.errors.slice(0, 3) }; })()""")
        print('mount', json.dumps(r))
        check(r['before'] and not r['after'] and r['swim'], 'a rider slides off the horse in deep water and swims')

        # ---- fire goes out in water; a burning brand too ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          H.teleport(L.x + 60, L.z + 60); H.simulate(0.5);
          F.addBuff(P, 'burn', 1, 20, P); const before = F.hasBuff(P, 'burn');
          H.teleport(L.x, L.z); H.simulate(0.5); const after = F.hasBuff(P, 'burn');
          return { before, after, errors: H.errors.slice(0, 3) }; })()""")
        print('fire', json.dumps(r))
        check(r['before'] and not r['after'], 'jumping in the lake puts out the flames on you')

        # ---- a soldier and a wolf follow the player into the water and swim ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          // a foe on the shore, chasing; the player swims 10 m out
          let sx = L.x, sz = L.z; for (let r = 0; r < 60; r += 0.5) { const x = L.x + r, w = Wt.waterAt(x, L.z); if (!w) { sx = x + 1; break; } }
          const px = sx - 12, pz = L.z;
          H.teleport(px, pz); H.simulate(0.3);
          const foe = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', sx, L.z);
          foe.ai.post = { x: sx, z: L.z }; foe.target = P.id; foe.threat = new Map([[P.id, 100]]);
          const M = H.MOBS; const wolf = F.makeEnt({ kind: 'wolf', faction: H.FACTION_MONSTER, role: 'mob', mobType: 'wolf', name: 'wolf', level: 20, x: sx, z: L.z + 1.5, y: F.heightAt(sx, L.z + 1.5), look: { colA: [0.4, 0.4, 0.4], colB: [0.3, 0.3, 0.3] }, home: { x: sx, z: L.z + 1.5, r: 30 } });
          F.setupStats(wolf); wolf.target = P.id; wolf.threat = new Map([[P.id, 100]]); wolf.ai.state = 'chase';
          P.hp = P.maxHp * 50; P.maxHp *= 50; P.hp = P.maxHp;
          const track = [];
          for (let i = 0; i < 16; i++) { H.simulate(0.5); P.x = px; P.z = pz; const a = Wt.state(foe.id), b = Wt.state(wolf.id); track.push([+a.x.toFixed(1), +a.wd.toFixed(2), a.swim, +b.x.toFixed(1), +b.wd.toFixed(2), b.swim]); }
          const fs = Wt.state(foe.id), ws = Wt.state(wolf.id);
          const fsurf = (Wt.waterAt(foe.x, foe.z) || {}).y, wsurf = (Wt.waterAt(wolf.x, wolf.z) || {}).y;
          const pw = Wt.waterAt(px, pz);
          return { pdepth: pw ? pw.depth : null, track, foe: fs, wolf: ws, foeFloat: fsurf - foe.y, wolfFloat: wsurf - wolf.y, dims: [Wt.swimDims(foe.id), Wt.swimDims(wolf.id)], errors: H.errors.slice(0, 3) }; })()""")
        print('npc', json.dumps(r))
        check(r['foe']['swim'], 'a soldier chasing the player swims out after them')
        check(r['wolf']['swim'], 'a wolf chasing the player swims out after them')
        check(r['foe']['swim'] and abs(r['foeFloat'] - 1.3) < 0.1, 'the soldier floats at its swimming depth (%.2f)' % r['foeFloat'])
        check(r['wolf']['swim'] and 0.4 < r['wolfFloat'] < 1.0, 'the wolf swims with its back awash (%.2f)' % r['wolfFloat'])

        # ---- townsfolk keep out of deep water ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn; const v = H.ENT.find((e) => e.role === 'villager');
          return { ok: v ? !Wt.swimAllowed(v) : null }; })()""")
        check(r['ok'] is not False, 'townsfolk keep out of deep water')

        # ---- drinking and the waterskin ----
        r = await page.evaluate("""(() => { const H = __hm, Wt = H.water, F = H.fn, P = H.GAME.player, L = H.dbg.LAKES[0];
          for (const s of Object.keys(H.INV.eq)) { const it = H.INV.eq[s]; if (it) { delete it.dirt; delete it.blood; } } P.dirt = 0; P.blood = 0;
          // stand on the shore just out of the water, facing it
          let sx = L.x; for (let r = 0; r < 60; r += 0.25) { const w = Wt.waterAt(L.x + r, L.z); if (!w) { sx = L.x + r + 0.6; break; } }
          H.teleport(sx, L.z); P.yaw = -Math.PI / 2; H.simulate(0.2);
          const skins0 = F.goodsCount('waterskin_empty'), water0 = F.goodsCount('water');
          const it = (() => { const near = Wt.waterNear(P); let best = null; Wt.waterOffers(P, (d, range, label, act) => { if (d < range) best = { label, act }; }); return { near, best }; })();
          const label = it.best ? it.best.label : null; if (it.best) it.best.act();
          return { label, near: it.near, skins0, water0, skins1: F.goodsCount('waterskin_empty'), water1: F.goodsCount('water'), errors: H.errors.slice(0, 3) }; })()""")
        print('drink', json.dumps(r))
        check(r['label'] and r['label'].startswith('Drink'), "at the water's edge E offers a drink (%s)" % r['label'])
        check(r['skins0'] >= 1 and r['water1'] == r['water0'] + 1, 'the issued waterskin is filled with water')

        print('errors', json.dumps(await page.evaluate("__hm.errors.slice(0, 5)")))
        check(not await page.evaluate("__hm.errors.length"), 'no runtime errors')
        if SHOTS:
            await shots(page)
        await b.close()
    print('FAILS', FAILS)

SPOTS = """(() => { const H = __hm, Wt = H.water, F = H.fn;
  const L = H.dbg.LAKES[0], out = {};
  // a shore of the first lake: walk out from its middle until the ground comes out of the water
  let best = null;
  for (let a = 0; a < 24; a++) { const ang = a / 24 * Math.PI * 2, dx = Math.cos(ang), dz = Math.sin(ang);
    let shore = null; for (let r = 4; r < 70; r += 0.25) { const x = L.x + dx * r, z = L.z + dz * r; if (!Wt.waterAt(x, z)) { shore = r; break; } }
    if (!shore) continue; const x = L.x + dx * (shore + 5), z = L.z + dz * (shore + 5); const slope = Math.abs(F.heightAt(x, z) - F.heightAt(L.x + dx * shore, L.z + dz * shore));
    if (shore > 40 || Wt.riverAt(L.x + dx * shore, L.z + dz * shore, 10)) continue;
    if (!best || slope < best.slope) best = { ang, shore, slope, dx, dz }; }
  out.lake = { x: L.x, z: L.z, ...best };
  // the fastest, whitest stretch of a river
  let rv = null;
  for (const Rv of Wt.RIVERS) for (let i = 2; i < Rv.pts.length - 2; i++) { const p = Rv.pts[i]; if (!rv || p.speed > rv.speed) rv = { x: p.x, z: p.z, ux: p.ux, uz: p.uz, speed: p.speed, hw: p.hw, surf: p.surf, realm: Rv.realm }; }
  out.river = rv; return out; })()"""

async def snap(page, name):
    # one frame drawn by hand (the page's own loop is held for the shots, so the screenshot does not wait on more)
    await page.evaluate("(() => { __hm.frame(1/30); })()")
    await page.wait_for_timeout(1000)
    await page.screenshot(path=OUT + name, timeout=300000)
    print('  shot', OUT + name, flush=True)

async def run_frames(page, n, dt=1/30, keys=None):
    # the simulation and the ripples advance together without drawing the world each step (the menu pauses the frame's own simulation)
    # (the menu also blocks the keys, so it is lifted while the player moves)
    await page.evaluate("""((n, dt, keys) => { const H = __hm, m = H.UI.modal; H.UI.modal = null; for (let i = 0; i < n; i++) { if (keys) for (const k of keys) H.INPUT.keys.add(k); H.simulate(dt, dt); H.water.tickWater(dt); } if (keys) for (const k of keys) H.INPUT.keys.delete(k); H.UI.modal = m; })(%d, %f, %s)""" % (n, dt, json.dumps(keys)))

async def shots(page):
    await page.evaluate("(() => { window.requestAnimationFrame = () => 0; })()")
    S = await page.evaluate(SPOTS)
    print('spots', json.dumps(S))
    # clear the lake of the foes from the checks above
    await page.evaluate("""(() => { const H = __hm, P = H.GAME.player, L = H.dbg.LAKES[0]; for (const e of H.ENT.slice()) if (e !== P && e.kind !== 'door' && Math.hypot(e.x - L.x, e.z - L.z) < 90) H.fn.removeEnt(e); P.target = null; })()""")
    for q in (['high', 'medium'] if 'medium' in sys.argv[1:] else ['high']):
        await page.evaluate("__hm.fn.setQuality('%s')" % q)
        await page.evaluate("__hm.setTod(0.45); __hm.dbg.WEATHER.mode = 'clear'")
        lk = S['lake']
        # 1. a lake shore: looking down through the shallows at the bed
        await page.evaluate("""((lk) => { const H = __hm, F = H.fn, P = H.GAME.player; H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
          H.teleport(lk.x + lk.dx * (lk.shore + 14), lk.z + lk.dz * (lk.shore + 14));
          const cx = lk.x + lk.dx * (lk.shore + 3.5), cz = lk.z + lk.dz * (lk.shore + 3.5);
          H.camera.position.set(cx, F.heightAt(cx, cz) + 2.6, cz); H.camera.lookAt(lk.x + lk.dx * (lk.shore - 7), -3.6, lk.z + lk.dz * (lk.shore - 7)); })(%s)""" % json.dumps(lk))
        await run_frames(page, 20)
        await snap(page, 'water_%s_shore.png' % q)
        # 2. the river: flow and white water, from its bank
        rv = S['river']
        await page.evaluate("""((rv) => { const H = __hm, F = H.fn; const sx = -rv.uz, sz = rv.ux;
          const cx = rv.x + sx * (rv.hw + 7) - rv.ux * 6, cz = rv.z + sz * (rv.hw + 7) - rv.uz * 6;
          H.teleport(cx + sx * 6, cz + sz * 6);
          H.camera.position.set(cx, Math.max(F.heightAt(cx, cz), rv.surf) + 3.2, cz); H.camera.lookAt(rv.x + rv.ux * 4, rv.surf, rv.z + rv.uz * 4); })(%s)""" % json.dumps(rv))
        await run_frames(page, 20)
        await snap(page, 'water_%s_river.png' % q)
        # 3. the player swimming in the lake, seen from behind and above
        await page.evaluate("""((lk) => { const H = __hm, F = H.fn, P = H.GAME.player; const x = lk.x + lk.dx * (lk.shore - 10), z = lk.z + lk.dz * (lk.shore - 10);
          H.teleport(x, z); P.yaw = Math.atan2(-lk.dx, -lk.dz); H.CAM.yaw = P.yaw; H.simulate(0.4); })(%s)""" % json.dumps(lk))
        await run_frames(page, 24, keys=['KeyW'])
        await page.evaluate("""(() => { const H = __hm, P = H.GAME.player; const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
          H.camera.position.set(P.x - fx * 4.2 + fz * 1.5, P.y + 2.9, P.z - fz * 4.2 - fx * 1.5); H.camera.lookAt(P.x + fx * 0.6, P.y + 1.15, P.z + fz * 0.6); })()""")
        await run_frames(page, 3, keys=['KeyW'])
        await page.evaluate("""(() => { const H = __hm, P = H.GAME.player; const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
          H.camera.position.set(P.x - fx * 2.2 + fz * 3.6, P.y + 2.2, P.z - fz * 2.2 - fx * 3.6); H.camera.lookAt(P.x + fx * 0.5, P.y + 1.1, P.z + fz * 0.5); })()""")
        await snap(page, 'water_%s_swim.png' % q)
        # 4. the wake behind the swimmer, from higher up
        await page.evaluate("""(() => { const H = __hm, P = H.GAME.player; const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
          H.camera.position.set(P.x - fx * 9 + fz * 4, P.y + 9, P.z - fz * 9 - fx * 4); H.camera.lookAt(P.x - fx * 2, P.y + 1.2, P.z - fz * 2); H.frame(1/30); })()""")
        await snap(page, 'water_%s_wake.png' % q)
        # 5. wading in the shallows, with splashes
        await page.evaluate("""((lk) => { const H = __hm, F = H.fn, P = H.GAME.player, Wt = H.water;
          let r = lk.shore; for (; r > 0; r -= 0.25) { const w = Wt.waterAt(lk.x + lk.dx * r, lk.z + lk.dz * r); if (w && w.depth > 0.55) break; }
          const ang = lk.ang + Math.PI / 2, tx = Math.cos(ang), tz = Math.sin(ang);
          const x = lk.x + lk.dx * r - tx * 4, z = lk.z + lk.dz * r - tz * 4; H.teleport(x, z); P.yaw = Math.atan2(tx, tz); H.CAM.yaw = P.yaw; H.simulate(0.3); })(%s)""" % json.dumps(lk))
        await run_frames(page, 18, keys=['KeyW'])
        await page.evaluate("""(() => { const H = __hm, P = H.GAME.player; const fx = Math.sin(P.yaw), fz = Math.cos(P.yaw);
          H.camera.position.set(P.x + fz * 4.5 + fx * 2.5, P.y + 1.9, P.z - fx * 4.5 + fz * 2.5); H.camera.lookAt(P.x + fx * 0.8, P.y + 0.7, P.z + fz * 0.8); H.frame(1/30); })()""")
        await snap(page, 'water_%s_wade.png' % q)
    print('shot errors', json.dumps(await page.evaluate("__hm.errors.slice(0, 3)")))

asyncio.run(main())
