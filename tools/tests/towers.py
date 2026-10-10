"""[land] Towers you can go into: the corner towers of the stone keeps, end to end through window.__hm.
Every corner tower is hollow: a door from the courtyard into a store room, a ladder up through a hatch into the guard
room at the height of the wall walks (a door onto each walk), a ladder up through a hatch onto the fighting top.
Checks: the towers, ladders, hatches and doors are there and the old solid drum stands down; the floors (store, guard
room, top) carry a body at their heights with no crack between their boards; the player walks in at the courtyard door
(it swings open and its collider stands down), climbs the ladder by walking into it (body action 14, at the climbing
speed), finds the hatch above shut and pushes it open with E, climbs onto the top, shuts the hatch and stands on it,
opens it again and climbs down by walking into the hole, and goes out onto a wall walk through the guard room's door;
the camera stays inside the drum; a body in the store room is not named through the masonry; a new archer of the
garrison walks from the courtyard up through a tower to its post on the top, climbing the ladder; an enemy in the
courtyard still climbs after the archers; no runtime errors. Screenshots (unless noshots): the tower from the
courtyard, the store room, the guard room with its ladder and hatch, the climb, the top with the hatch open, the
store room by torchlight at night, the store room at low quality.
usage: python3 tools/tests/towers.py [noshots] [quality]   (quality: high, medium or low; default medium)"""
import json, asyncio, sys, pathlib, time, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

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
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

async def shot(page, name, js):
    # the frame is drawn here and read off the canvas (a page screenshot waits on the page's own frames, slow under
    # SwiftShader on a busy machine)
    if not SHOTS: return
    info = await page.evaluate(js)
    url = await page.evaluate("(() => { __hm.frame(1/30); __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').resize((960, 540), Image.LANCZOS).save(OUT + name + '.png')
    else: pathlib.Path(OUT + name + '.png').write_bytes(data)
    print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.TT = {
  H: __hm, F: __hm.fn,
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  tower(S, sx, sz) { return __hm.towers.TOWER.list.find((T) => T.S === S && T.sx === sx && T.sz === sz); },
  tp(T, a, r) { return this.F.siteToWorld(T.S, T.cx + Math.sin(a) * r, T.cz + Math.cos(a) * r); },
  where(S) { const P = this.H.GAME.player, c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = P.x - S.x, dz = P.z - S.z; return { lx: +(dx * c - dz * s).toFixed(2), lz: +(dx * s + dz * c).toFixed(2), y: +(P.y - S.y).toFixed(2), m: P.motion ? P.motion.kind : null }; },
  put(S, lx, lz, ly = 0) { const H = this.H, P = H.GAME.player, p = this.F.siteToWorld(S, lx, lz); P.x = P.prevX = p.x; P.z = P.prevZ = p.z; P.y = S.y + ly; P.onGround = true; P.vy = 0; P.hp = P.maxHp = 1e6; P.motion = null; P.faction = 0; H.UI.modal = null; return this.where(S); },
  // walk the player with W held toward a site-local point, steering the camera
  walkTo(S, lx, lz, maxSec = 12) {
    const H = this.H, P = H.GAME.player, p = this.F.siteToWorld(S, lx, lz);
    H.UI.modal = null; H.INPUT.keys.add('KeyW');
    let t = 0;
    while (t < maxSec) {
      const d = Math.hypot(p.x - P.x, p.z - P.z);
      if (d < 0.3 && !P.motion) break;
      if (!P.motion) H.CAM.yaw = Math.atan2(p.x - P.x, p.z - P.z);
      H.simulate(0.1, 0.02); t += 0.1;
    }
    H.INPUT.keys.delete('KeyW');
    H.simulate(0.2, 0.02);
    return this.where(S);
  },
  // walk on into something (a ladder, a hole) for a moment
  push(x, z, sec = 0.4) { const H = this.H, P = H.GAME.player; H.INPUT.keys.add('KeyW'); H.CAM.yaw = Math.atan2(x - P.x, z - P.z); H.simulate(sec, 0.02); H.INPUT.keys.delete('KeyW'); return P.motion ? P.motion.kind : null; },
  until(sec) { const H = this.H, P = H.GAME.player; let t = 0; while (P.motion && t < sec) { H.simulate(0.25, 0.02); t += 0.25; } H.simulate(0.2, 0.02); return +t.toFixed(2); },
  offer() { const it = this.F.currentInteraction(); return it ? it.label : null; },
  use() { const it = this.F.currentInteraction(); if (it) it.act(); return it ? it.label : null; },
  cam(S, T, a, r, y, ta, tr, ty) { const H = this.H, p = this.tp(T, a, r), q = this.tp(T, ta, tr); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(p.x, S.y + y, p.z); H.camera.lookAt(q.x, S.y + ty, q.z); H.camera.updateMatrixWorld(); },
  quiet() { for (const w of __hm.WAR.warbands) w.dead = true; __hm.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; }); },
};
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if SHOTS else 640, h=540 if SHOTS else 360)
        print('booted', f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'archer', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.42); __hm.simulate(0.5); TT.quiet(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.next = 1e9; return 0; })()")

        r = await ev(page, 'towers', """(() => { const tw = __hm.towers.TOWER, out = { n: tw.list.length, ok: true, drums: 0, rings: 0 };
          for (const T of tw.list) { if (T.doors.length !== 3 || T.ladders.length !== 2 || T.hatches.length !== 2) out.ok = false; out.rings += T.colls.length; }
          for (const S of __hm.REALMS[0].keepSites) for (const c of S.colliders) if (c.tag === 'tower' && c.r > 3) out.drums += c.active ? 1 : 0;
          out.realms = [...new Set(tw.list.map((T) => T.S.realm))]; return out; })()""")
        check(r['n'] == 8 and r['ok'] and r['realms'] == [0], 'every corner tower of both stone keeps is hollow: 3 doors, 2 ladders, 2 hatches each')
        check(r['drums'] == 0 and r['rings'] >= 8 * 16, 'the old solid drums stand down; rings of masonry take their place')

        r = await ev(page, 'floors', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), F = __hm.fn, out = { at: [], cracks: 0 };
          for (const [a, rr] of [[0, 0], [1.1, 1.0], [2.5, 2.2], [4.0, 1.6], [5.5, 0.6]]) { const p = TT.tp(T, a, rr); out.at.push([F.floorAt(p.x, p.z, S.y + T.yG + 0.1), F.floorAt(p.x, p.z, S.y + 7.1), F.floorAt(p.x, p.z, S.y + 10.6)].map((v) => +(v - S.y).toFixed(2))); }
          // a fine sweep across each floor away from its hatch: no point drops to the floor below
          for (const [y, L] of [[T.yG, null], [7, T.ladders[0]], [10.5, T.ladders[1]]]) for (let i = -24; i <= 24; i++) for (let j = -24; j <= 24; j++) {
            const lx = i * 0.1, lz = j * 0.1, r = Math.hypot(lx, lz); if (r > 2.4) continue;
            if (L) { const ux = Math.cos(L.a), uz = -Math.sin(L.a), vx = Math.sin(L.a), vz = Math.cos(L.a), u = lx * ux + lz * uz, v = lx * vx + lz * vz; if (Math.abs(u) < 0.56 && v > 1.15 && v < 2.4) continue; }
            const p = F.siteToWorld(S, T.cx + lx, T.cz + lz); if (Math.abs(F.floorAt(p.x, p.z, S.y + y + 0.05) - (S.y + y)) > 0.02) out.cracks++; }
          return out; })()""")
        check(all(abs(q[0] - 0.1) < 0.12 and abs(q[1] - 7) < 0.02 and abs(q[2] - 10.5) < 0.02 for q in r['at']), 'the store room, the guard room (7 m) and the top (10.5 m) carry a body at their heights')
        check(r['cracks'] == 0, 'no crack between the boards or flags anywhere on the three floors')

        r = await ev(page, 'enter', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), D = T.doors[0], out = {};
          out.shut = { k: D.k, coll: D.coll.active };
          TT.put(S, 10.6, 10.6, 0);
          const p = TT.tp(T, T.aIn, 0.9), l = __hm.fn.siteLocal ? null : null;
          const c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = p.x - S.x, dz = p.z - S.z;
          out.in = TT.walkTo(S, dx * c - dz * s, dx * s + dz * c, 8);
          out.open = { k: +D.k.toFixed(2), coll: D.coll.active };
          const P = __hm.GAME.player, cc = TT.tp(T, 0, 0); out.r = +Math.hypot(P.x - cc.x, P.z - cc.z).toFixed(2);
          return out; })()""")
        check(r['shut']['k'] == 0 and r['shut']['coll'], 'the courtyard door is shut and blocks while nobody is near')
        check(r['open']['k'] > 0.9 and not r['open']['coll'] and r['r'] < 1.5 and abs(r['in']['y'] - 0.1) < 0.15, 'it swings open for the player, who walks into the store room')

        if SHOTS:
            await shot(page, 'tower_store', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); TT.put(S, 30, 0, 0); TT.cam(S, T, T.aIn, 0.6, 1.65, T.aIn + Math.PI, 1.8, 1.4); __hm.frame(0.05); return 0; })()""")
            await shot(page, 'tower_outside', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); TT.cam(S, T, T.aIn, 11, 2.2, T.aIn, 0, 5.5); __hm.frame(0.05); return 0; })()""")
            await page.evaluate("(() => { __hm.CAM.mode = 'play'; __hm.UI.modal = null; return 0; })()")

        r = await ev(page, 'climb up', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), L = T.ladders[0], out = {}; const P = __hm.GAME.player;
          TT.put(S, T.cx + Math.sin(T.aIn) * 0.9, T.cz + Math.cos(T.aIn) * 0.9, T.yG);
          out.foot = TT.walkTo(S, L.foot.x, L.foot.z, 6);
          const t0 = __hm.GAME.t; out.started = TT.push(L.lx, L.lz, 0.3); out.act = P.anim.act;
          const ys = []; let maxT = 0; while (P.motion && maxT < 15) { __hm.simulate(0.5, 0.02); maxT += 0.5; ys.push(+(P.y - S.y).toFixed(2)); }
          out.ys = ys; out.secs = +(__hm.GAME.t - t0).toFixed(1); out.after = TT.where(S); out.act2 = P.anim.act; return out; })()""")
        check(r['started'] == 'ladder' and r['act'] == 14, 'walking into the foot of the ladder starts the climb (body action 14)')
        check(abs(r['after']['y'] - 7) < 0.05 and 4.5 < r['secs'] < 8.5 and r['act2'] == 0, 'the player climbs hand over hand into the guard room (y = 7) at a climbing pace')

        if SHOTS:
            await shot(page, 'tower_guardroom', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.UI.modal = 'menu'; TT.cam(S, T, T.aIn + Math.PI + 0.5, 2.1, 8.7, T.aIn, 1.6, 7.6); __hm.frame(0.05); return 0; })()""")
            await page.evaluate("(() => { __hm.CAM.mode = 'play'; __hm.UI.modal = null; return 0; })()")

        r = await ev(page, 'hatch', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), L = T.ladders[1], Hh = L.hatch, out = {}; const P = __hm.GAME.player;
          out.foot = TT.walkTo(S, L.foot.x, L.foot.z, 6);
          out.shut = { k: Hh.k, floor: Hh.floor.active };
          out.offer = TT.offer(); out.used = TT.use(); __hm.simulate(1.0, 0.02);
          out.open = { k: +Hh.k.toFixed(2), floor: Hh.floor.active };
          out.offer2 = TT.offer(); out.used2 = TT.use();
          out.m = P.motion ? P.motion.kind : null; out.secs = TT.until(12); out.top = TT.where(S);
          return out; })()""")
        check(r['shut']['k'] == 0 and r['shut']['floor'] and r['offer'] == 'Push the hatch open', 'the hatch to the top is shut (a floor); E at the ladder offers to push it open')
        check(r['open']['k'] > 0.95 and not r['open']['floor'] and r['offer2'] == 'Climb the ladder', 'E opens the hatch, then offers the climb')
        check(r['m'] == 'ladder' and abs(r['top']['y'] - 10.5) < 0.05, 'the player climbs up through the hatch onto the fighting top (y = 10.5)')

        if SHOTS:
            await shot(page, 'tower_top', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.UI.modal = 'menu'; TT.cam(S, T, T.aIn + Math.PI, 2.4, 12.4, T.aIn, 1.6, 10.3); __hm.frame(0.05); return 0; })()""")
            await page.evaluate("(() => { __hm.CAM.mode = 'play'; __hm.UI.modal = null; return 0; })()")

        r = await ev(page, 'shut and down', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), L = T.ladders[1], Hh = L.hatch, out = {}; const P = __hm.GAME.player;
          // step back from the hatch, shut it, stand on it
          TT.put(S, T.cx + Math.sin(T.aIn + 1.05) * 1.9, T.cz + Math.cos(T.aIn + 1.05) * 1.9, 10.5);
          out.offer = TT.offer(); out.used = TT.use(); __hm.simulate(1.2, 0.02); out.k = +Hh.k.toFixed(2); out.floor = Hh.floor.active;
          const c = TT.tp(T, L.a, 1.75); out.on = +(__hm.fn.floorAt(c.x, c.z, S.y + 10.55) - S.y).toFixed(2);
          // open it again and walk into the hole beside the ladder's top: down to the guard room
          TT.put(S, L.off.x, L.off.z, 10.5);
          out.offer2 = TT.offer(); out.used2 = TT.use(); __hm.simulate(1.0, 0.02);
          out.down = TT.push(L.lx, L.lz, 0.3); out.secs = TT.until(12); out.after = TT.where(S);
          return out; })()""")
        check(r['used'] == 'Shut the hatch' and r['k'] == 0 and r['floor'] and abs(r['on'] - 10.5) < 0.05, 'E shuts the hatch from the top, and it carries a body')
        check(r['used2'] == 'Open the hatch' and r['down'] == 'ladder' and abs(r['after']['y'] - 7) < 0.05, 'opened again, walking into the hole takes the player down the ladder to the guard room')

        r = await ev(page, 'out onto the walk', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), D = T.doors[1], out = {};
          TT.put(S, T.cx, T.cz, 7);
          const p = TT.tp(T, T.aSide, 4.6), c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = p.x - S.x, dz = p.z - S.z;
          out.walk = TT.walkTo(S, dx * c - dz * s, dx * s + dz * c, 8); out.k = +D.k.toFixed(2);
          // and the camera, back inside the store room, stays inside the drum
          TT.put(S, T.cx + Math.sin(T.aIn + Math.PI) * 0.5, T.cz + Math.cos(T.aIn + Math.PI) * 0.5, T.yG);
          __hm.CAM.mode = 'play'; __hm.UI.modal = null; __hm.CAM.yaw = T.S.yaw + T.aIn; __hm.CAM.pitch = 0.3; __hm.CAM.targetDist = __hm.CAM.dist = 7;
          for (let i = 0; i < 6; i++) __hm.frame(0.05);
          const cc = TT.tp(T, 0, 0), cp = __hm.camera.position; out.camR = +Math.hypot(cp.x - cc.x, cp.z - cc.z).toFixed(2); out.camY = +(cp.y - S.y).toFixed(2);
          return out; })()""")
        check(abs(r['walk']['y'] - 7) < 0.1 and r['walk']['lz'] < 11.0 and r['k'] > 0.5, 'the guard room door swings open onto the side walk, and the player walks out along it')
        check(r['camR'] < 2.5 and r['camY'] < 6.5, 'the camera stays inside the drum (and under the guard room floor) in the store room')

        r = await ev(page, 'names', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), F = __hm.fn;
          const p = TT.tp(T, T.aIn + Math.PI, 1.0), e = F.spawnRealmUnit(0, 'warrior', 30, 'guard', p.x, p.z, {}); e.ai.post = { x: p.x, z: p.z, leash: 2 }; e.y = S.y + T.yG; e.testFoe = true;
          const out = {}; TT.cam(S, T, T.aIn + Math.PI, 16, 2.0, T.aIn + Math.PI, 1.0, 1.0); __hm.frame(0.05); out.outside = __hm.towers.seen(e);
          TT.cam(S, T, T.aIn, 1.0, 1.7, T.aIn + Math.PI, 1.0, 1.0); __hm.frame(0.05); out.inside = __hm.towers.seen(e);
          F.removeEnt(e); __hm.CAM.mode = 'play'; __hm.UI.modal = null; return out; })()""")
        check(r['outside'] is False and r['inside'] is True, 'a body in the store room is not named through the masonry, and is named from inside')

        r = await ev(page, 'garrison', """(() => { const K = TT.keep(0, 0), S = K.site, F = __hm.fn, out = {};
          const Rt = F.castleRoute(K, 1); out.ladders = Rt.filter((q) => q.ladder).length;
          const g = siteW = F.siteToWorld(S, 0, 6); const e = F.spawnRealmUnit(0, 'archer', 30, 'guard', g.x, g.z, {});
          e.ai.route = Rt; e.ai.ri = 0; e.ai.post = { x: Rt[Rt.length - 1].x, z: Rt[Rt.length - 1].z, leash: 2 };
          let climbed = false, maxY = 0, t = 0;
          while (t < 90) { __hm.simulate(0.5, 0.05); t += 0.5; if (e.motion && e.motion.kind === 'ladder') climbed = true; maxY = Math.max(maxY, e.y - S.y); if (!e.ai.route && Math.abs(e.y - S.y - 10.5) < 0.3) break; }
          out.t = t; out.climbed = climbed; out.y = +(e.y - S.y).toFixed(2); out.d = +Math.hypot(e.x - Rt[Rt.length - 1].x, e.z - Rt[Rt.length - 1].z).toFixed(2); out.route = !!e.ai.route;
          F.removeEnt(e); return out; })()""")
        check(r['ladders'] == 2 and r['climbed'] and abs(r['y'] - 10.5) < 0.3 and r['d'] < 1.2, 'a new archer walks from the courtyard up through the tower, climbs the ladder and takes its post on the top')

        if SHOTS:
            await shot(page, 'tower_climb', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), L = T.ladders[0], P = __hm.GAME.player;
              TT.put(S, L.foot.x, L.foot.z, T.yG); __hm.towers.towerClimb(P, L, 1); __hm.simulate(2.2, 0.02);
              TT.cam(S, T, T.aIn + Math.PI + 1.1, 1.6, 3.4, T.aIn + Math.PI, 1.6, 2.4); __hm.frame(0.05); return +(P.y - S.y).toFixed(2); })()""")
            await page.evaluate("(() => { const P = __hm.GAME.player; P.motion = null; P.anim.act = 0; return 0; })()")
            await shot(page, 'tower_night', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.setTod(0.97); __hm.simulate(0.2, 0.05); TT.put(S, 30, 0, 0); TT.cam(S, T, T.aIn, 0.6, 1.65, T.aIn + Math.PI, 1.8, 1.4); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()""")
            await shot(page, 'tower_low', """(() => { __hm.fn.setQuality('low'); const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.setTod(0.42); __hm.simulate(0.2, 0.05); TT.cam(S, T, T.aIn, 0.6, 1.65, T.aIn + Math.PI, 1.8, 1.4); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()""")
            await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")

        r = await ev(page, 'errors', "(() => __hm.errors.slice(0, 6))()")
        check(len(r) == 0, '__hm.errors is empty')
        await b.close()
    print('ALL PASSED' if not FAILS else 'FAILED', FAILS, f'[{time.time() - T0:.0f}s]', flush=True)

asyncio.run(main())
