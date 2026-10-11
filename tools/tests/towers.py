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
[keeps] (version 11) every tower of every keep: the Logres gate drums, the Eriu gate drums under thatch, the Thule
corner and gate shafts of logs. For all 28: the floors of every room carry a body with no crack, no grass inside, the
old solid tower stood down, no curtain collider through a room, the furniture clear of the doors, the ladders' feet
and the hatches. A tour of each kind: in at the courtyard door, up every ladder (pushing each hatch open with E), out
through every door at the walks' height onto the walk; the camera inside; names not through the walls. Every
garrison archer's post (the gate towers' tops first) reached by walking from the courtyard, climbing the ladders.
Fighting on a ladder (04m_ladders.js): a climber held by a foe at the hatch strikes from the rungs (body action 18,
weaker blows), a heavy blow, a stun and a parry's stun knock it off and the fall harms it by the height, no bow or
two-handed spell on the rungs, no block; a foe standing on a shut hatch holds it against a climber below (who heaves,
and sometimes throws it open), the player slams the hatch on a foe coming up through it (E), an archer of the garrison
steps onto a shut hatch while foes climb beneath it; an enemy who breaks into a tower climbs after the archers and
fights at the hatch; nobody is seen or struck through a floor or a shut hatch. Screenshots of each new tower from the
courtyard and inside each room, by day and at night, at high and low quality (tower_<kind>_*.png), and a fight on a
ladder.
usage: python3 tools/tests/towers.py [noshots] [quality] [only=v10,floors,tour,posts,fight,fire,shots] [small] [shots=tc_outside,lg_night,...]"""
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
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT['only'].split(',') if 'only' in OPT else None
def want(k): return ONLY is None or k in ONLY
T_Y = "T.yG + "
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
    if 'shots' in OPT and name.replace('tower_', '') not in OPT['shots'].split(','): return # [keeps] shots=tc_outside,...: only these
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
  // [keeps] one tower of each new kind
  kinds() { const L = __hm.towers.TOWER.list, f = (q) => L.find(q); return { lg: f((T) => T.look === 'stone' && T.role === 'gate' && T.sx === 1), eg: f((T) => T.look === 'rath' && T.role === 'gate' && T.sx === 1), egl: f((T) => T.look === 'rath' && T.role === 'gate' && T.sx === -1), el: f((T) => T.role === 'lookout' && T.sx === 1), tc: f((T) => T.look === 'timber' && T.role === 'corner' && T.sx === 1 && T.sz === 1), tb: f((T) => T.look === 'timber' && T.role === 'corner' && T.sx === -1 && T.sz === -1), tg: f((T) => T.look === 'timber' && T.role === 'gate' && T.sx === -1) }; },
  tl(T, a, r, off = 0) { return { x: T.cx + Math.sin(a) * r + Math.cos(a) * off, z: T.cz + Math.cos(a) * r - Math.sin(a) * off }; },
  loc(S, x, z) { const c = Math.cos(S.yaw), s = Math.sin(S.yaw), dx = x - S.x, dz = z - S.z; return { x: dx * c - dz * s, z: dx * s + dz * c }; },
  inRoom(T, x, z, pad = 0) { const l = this.loc(T.S, x, z), dx = l.x - T.cx, dz = l.z - T.cz; return T.kind === 'drum' ? Math.hypot(dx, dz) < T.RI + pad : Math.abs(dx) < T.HI + pad && Math.abs(dz) < T.HI + pad; },
  // a fresh body of a realm at a site point, kept to itself
  body(S, realm, cls, lx, lz, ly, role = 'guard') { const F = this.F, p = F.siteToWorld(S, lx, lz), e = F.spawnRealmUnit(realm, cls, 30, role, p.x, p.z, {}); e.y = S.y + ly; e.ai.post = { x: p.x, z: p.z, leash: 0.5 }; e.testFoe = true; return e; },
  // the keep of S without its garrison, its lord or anyone else, and none coming
  empty(S) { const H = this.H, F = this.F, K = S.keepRef; for (const id of [...K.guards]) { const g = F.getEnt(id); if (g) F.removeEnt(g); } K.guards.clear(); const Lo = F.getEnt(K.lord); if (Lo) F.removeEnt(Lo); K.lord = null; K.nextGuardAt = 1e9; for (const e of H.ENT) if (e !== H.GAME.player && e.alive && e.kind === 'humanoid' && Math.hypot(e.x - S.x, e.z - S.z) < 45) F.removeEnt(e); },
  clear(S, r = 40) { const H = this.H, P = H.GAME.player; for (const e of H.ENT) if (e !== P && e.alive && e.kind === 'humanoid' && Math.hypot(e.x - S.x, e.z - S.z) < r && (e.testFoe || e.role === 'soldier')) { this.F.removeEnt(e); } },
};
"""

async def main():
    async with async_playwright() as p:
        small = 'small' in ARGS # [keeps] 'small': the pictures drawn at 800x450 (a loaded machine), saved at 960x540
        b, page, logs = await setup(p, w=(800 if small else 960) if SHOTS else 640, h=(450 if small else 540) if SHOTS else 360)
        print('booted', f'[{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'archer', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.42); __hm.simulate(0.5); TT.quiet(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.next = 1e9; return 0; })()")

        if want('v10'): await v10(page)
        if want('floors'): await floors(page)
        if want('tour'): await tours(page)
        if want('posts'): await posts(page)
        if want('fight'): await fights(page)
        if want('fire'): await fire(page)
        if want('shots') and SHOTS: await kshots(page)

        r = await ev(page, 'errors', "(() => __hm.errors.slice(0, 6))()")
        check(len(r) == 0, '__hm.errors is empty')
        await b.close()
    print('ALL PASSED' if not FAILS else 'FAILED', FAILS, f'[{time.time() - T0:.0f}s]', flush=True)

async def v10(page):
        r = await ev(page, 'towers', """(() => { const tw = __hm.towers.TOWER, out = { n: tw.list.length, ok: true, drums: 0, rings: 0 };
          for (const T of tw.list.filter((q) => q.look === 'stone' && q.role === 'corner')) { if (T.doors.length !== 3 || T.ladders.length !== 2 || T.hatches.length !== 2) out.ok = false; out.rings += T.colls.length; }
          for (const S of __hm.REALMS[0].keepSites) for (const c of S.colliders) if (c.tag === 'tower' && c.r > 3) out.drums += c.active ? 1 : 0;
          out.realms = [...new Set(tw.list.map((T) => T.S.realm))]; return out; })()""")
        check(r['n'] == 32 and r['ok'] and sorted(r['realms']) == [0, 1, 2], 'every tower of every keep is hollow (32); every corner tower of the stone keeps has 3 doors, 2 ladders, 2 hatches')
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
        check(r['ladders'] >= 2 and r['climbed'] and abs(r['y'] - 10.5) < 0.3 and r['d'] < 1.2, 'a new archer walks from the courtyard up through the tower, climbs the ladder and takes its post on the top')

        if SHOTS:
            await shot(page, 'tower_climb', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1), L = T.ladders[0], P = __hm.GAME.player;
              TT.put(S, L.foot.x, L.foot.z, T.yG); __hm.towers.towerClimb(P, L, 1); __hm.simulate(2.2, 0.02);
              TT.cam(S, T, T.aIn + Math.PI + 1.1, 1.6, 3.4, T.aIn + Math.PI, 1.6, 2.4); __hm.frame(0.05); return +(P.y - S.y).toFixed(2); })()""")
            await page.evaluate("(() => { const P = __hm.GAME.player; P.motion = null; P.anim.act = 0; return 0; })()")
            await shot(page, 'tower_night', """(() => { const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.setTod(0.97); __hm.simulate(0.2, 0.05); TT.put(S, 30, 0, 0); TT.cam(S, T, T.aIn, 0.6, 1.65, T.aIn + Math.PI, 1.8, 1.4); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()""")
            await shot(page, 'tower_low', """(() => { __hm.fn.setQuality('low'); const S = TT.keep(0, 0).site, T = TT.tower(S, 1, 1); __hm.setTod(0.42); __hm.simulate(0.2, 0.05); TT.cam(S, T, T.aIn, 0.6, 1.65, T.aIn + Math.PI, 1.8, 1.4); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()""")
            await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")

# ---------------------------------------------------------------- [keeps] every tower of every keep
async def floors(page):
    r = await ev(page, 'all floors', """(() => { const F = __hm.fn, W = F.W, out = { towers: 0, cracks: [], stood: 0, cut: 0, props: [], grass: 0, holes: 0, n: {} };
      for (const T of __hm.towers.TOWER.list) {
        out.towers++; const S = T.S, key = T.look + '-' + T.role; out.n[key] = (out.n[key] || 0) + 1;
        // the old solid tower stood down
        for (const c of S.colliders) if (c.tag === 'tower' && c.active) { const l = TT.loc(S, c.x, c.z); if (Math.hypot(l.x - T.cx, l.z - T.cz) < 1.0) out.stood++; }
        const lim = T.kind === 'drum' ? T.RI - 0.05 : T.HI - 0.05;
        for (const y of T.levels) {
          const top = y === T.levels[T.levels.length - 1], ext = top ? (T.kind === 'drum' ? T.RO - 0.6 : T.HO - 0.25) : lim;
          // the hatch above this floor's ladder, left open in the floor
          const holes = T.ladders.filter((L) => Math.abs(L.yt - y) < 0.01);
          let bad = 0;
          for (let i = -32; i <= 32; i++) for (let j = -32; j <= 32; j++) {
            const dx = i * 0.1, dz = j * 0.1; if (T.kind === 'drum' ? Math.hypot(dx, dz) > ext : Math.max(Math.abs(dx), Math.abs(dz)) > ext) continue;
            let inHole = false;
            for (const L of holes) { const ux = Math.cos(L.a), uz = -Math.sin(L.a), vx = Math.sin(L.a), vz = Math.cos(L.a), u = dx * ux + dz * uz, v = dx * vx + dz * vz; if (Math.abs(u) < T.ld.HW + 0.06 && v > T.ld.R0 - 0.1 && v < T.ld.R1 + 0.1) inHole = true; }
            if (inHole) continue;
            const p = F.siteToWorld(S, T.cx + dx, T.cz + dz); if (Math.abs(F.floorAt(p.x, p.z, S.y + y + 0.05) - (S.y + y)) > 0.02) bad++;
          }
          if (bad) out.cracks.push([S.name, key, T.sx, T.sz, y, bad]);
        }
        // no curtain wall's collider runs through a room
        const near = []; F.castles && null;
        for (const c of __hm.build.COLL.boxes) {
          if (!c.active || c.tag !== 'wall' || c.tower || Math.hypot(c.x - T.wx, c.z - T.wz) > 12) continue;
          for (const [dx, dz] of [[0, 0], [0.8, 0], [-0.8, 0], [0, 0.8], [0, -0.8]]) { const p = F.siteToWorld(S, T.cx + dx, T.cz + dz), ex = p.x - c.x, ez = p.z - c.z, lx = ex * c.cos - ez * c.sin, lz = ex * c.sin + ez * c.cos; if (Math.abs(lx) < c.hx && Math.abs(lz) < c.hz) { out.cut++; break; } }
        }
        // the furniture: clear of the ladders' feet and tops, the doors and the hatches
        for (const c of T.props) {
          const y = c.y0 - S.y;
          for (const L of T.ladders) {
            for (const [px, pz, py] of [[L.fx, L.fz, L.yb], [L.ox, L.oz, L.yt], [L.lx, L.lz, L.yb]]) if (Math.abs(py - y) < 0.5 && Math.hypot(c.x - px, c.z - pz) < c.r + 0.42) out.props.push([S.name, key, 'ladder', +y.toFixed(1), +Math.hypot(c.x - px, c.z - pz).toFixed(2), c.r]);
            if (L.hatch && Math.abs(L.yt - y) < 0.5 && Math.hypot(c.x - L.hatch.cx, c.z - L.hatch.cz) < c.r + 0.35) out.props.push([S.name, key, 'hatch', +y.toFixed(1)]);
          }
          for (const D of T.doors) { const q = TT.tl(T, D.a, T.RI - 0.55, D.off || 0), p = F.siteToWorld(S, q.x, q.z); if (Math.abs(D.y - y) < 0.5 && Math.hypot(c.x - p.x, c.z - p.z) < c.r + 0.42) out.props.push([S.name, key, 'door', +y.toFixed(1)]); }
        }
        // no grass in the rooms (the 2 m mask at the middle)
        const k = Math.round((T.wz + 512) / 2) * 513 + Math.round((T.wx + 512) / 2); if (W.grass && W.grass[k] > 0) out.grass++;
        // with its hatch open, the hole drops to the floor below
        for (const L of T.ladders) { const Hh = L.hatch; if (!Hh) continue; Hh.floor.active = false; const y = F.floorAt(Hh.cx, Hh.cz, S.y + L.yt + 0.05) - S.y; Hh.floor.active = Hh.k < 0.25; if (y > L.yt - 1.0) out.holes++; }
      }
      return out; })()""")
    check(r['towers'] == 32 and r['n'].get('stone-gate') == 4 and r['n'].get('rath-gate') == 4 and r['n'].get('rath-lookout') == 4 and r['n'].get('timber-corner') == 8 and r['n'].get('timber-gate') == 4, 'every tower is listed: 8 + 4 stone (corner, gate), 4 + 4 rath drums (gate, lookout), 8 + 4 timber shafts')
    check(not r['cracks'], 'every floor of every tower carries a body with no crack between its boards, flags or slabs')
    check(r['stood'] == 0 and r['cut'] == 0, 'the old solid towers stand down, and no curtain collider runs through a room')
    check(not r['props'], 'the furniture stands clear of the ladders\' feet and tops, the hatches and the doors')
    check(r['grass'] == 0 and r['holes'] == 0, 'no grass in the rooms; an open hatch leaves a hole to the floor below')

TOUR = r"""((key) => {
  const H = TT.H, F = TT.F, T = TT.kinds()[key], S = T.S, P = H.GAME.player, out = { key, steps: [] };
  const D0 = T.doors[0], o = TT.tl(T, D0.a, T.RO + 1.3, D0.off || 0), i = TT.tl(T, D0.a, T.RI - 0.7, D0.off || 0);
  TT.put(S, o.x, o.z, 0); P.faction = S.keepRef.realm; H.simulate(0.3, 0.02); // (as one of the keep's own: its garrison is calm)
  const w = TT.walkTo(S, i.x, i.z, 8);
  out.steps.push(['in', TT.inRoom(T, P.x, P.z), +(P.y - S.y).toFixed(2), +D0.k.toFixed(2)]);
  for (const L of T.ladders.slice().sort((p, q) => p.yb - q.yb)) {
    // walking to its foot may already walk the player into the ladder (it climbs); else E pushes the hatch open
    TT.walkTo(S, L.foot.x, L.foot.z, 3);
    let lab = P.motion ? 'walked in' : TT.offer();
    if (lab === 'Push the hatch open') { TT.use(); H.simulate(1.0, 0.02); lab = TT.offer(); }
    // (from the foot, walking along the ladder's line into it)
    if (!P.motion) { P.x = P.prevX = L.fx; P.z = P.prevZ = L.fz; H.simulate(0.05, 0.02); }
    const m = P.motion ? P.motion.kind : TT.push(L.lx + (L.lx - L.fx) * 4, L.lz + (L.lz - L.fz) * 4, 0.35) || (TT.use() && P.motion ? P.motion.kind : null);
    const secs = TT.until(16);
    out.steps.push(['climb', +L.yb.toFixed(2), +L.yt.toFixed(2), m, lab, +(P.y - S.y).toFixed(2), secs]);
  }
  // out through each door at a walk's height, onto the walk
  for (const D of T.doors.filter((q) => q.y > 1)) {
    const a = TT.tl(T, D.a, T.RI - 0.7, D.off || 0), b = TT.tl(T, D.a, T.RO + 1.4, D.off || 0);
    TT.put(S, a.x, a.z, D.y); P.faction = S.keepRef.realm; H.simulate(0.2, 0.02);
    const r2 = TT.walkTo(S, b.x, b.z, 8);
    out.steps.push(['out', +D.y.toFixed(2), +(P.y - S.y).toFixed(2), TT.inRoom(T, P.x, P.z, 0.2), +Math.hypot(r2.lx - b.x, r2.lz - b.z).toFixed(2), +D.k.toFixed(2)]);
  }
  return out; })"""

async def tours(page):
    await page.evaluate("(() => { const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; TT.quiet(); return 0; })()")
    for key, name in (('lg', 'a Logres gate tower'), ('eg', 'an Eriu gate tower'), ('el', 'an Eriu lookout'), ('tc', 'a Thule front corner tower'), ('tb', 'a Thule back corner tower'), ('tg', 'a Thule gate tower')):
        r = await ev(page, 'tour ' + key, "(" + TOUR + ")('" + key + "')")
        st = r['steps']
        inn = st[0]; climbs = [q for q in st if q[0] == 'climb']; outs = [q for q in st if q[0] == 'out']
        check(inn[1] and inn[2] < 0.4 and inn[3] > 0.5, f'{name}: the courtyard door swings open and the player walks into its store room ({inn})')
        check(climbs and all(q[3] == 'ladder' and abs(q[5] - q[2]) < 0.08 and q[6] < 14 for q in climbs), f'{name}: every ladder climbed (each hatch pushed open with E) to the floor above ({climbs})')
        check(all(abs(q[2] - q[1]) < 0.15 and not q[3] and q[4] < 0.8 for q in outs), f'{name}: out through every door at the walks\' height onto the walk ({outs})')
    # the camera inside a Thule room and an Eriu store; names not through the walls
    r = await ev(page, 'camera and names', """(() => { const H = TT.H, F = TT.F, K = TT.kinds(), out = {};
      for (const key of ['tc', 'eg', 'lg']) { const T = K[key], S = T.S;
        TT.put(S, T.cx, T.cz, T.yG); H.CAM.mode = 'play'; H.UI.modal = null; H.CAM.yaw = S.yaw + T.aIn; H.CAM.pitch = 0.3; H.CAM.targetDist = H.CAM.dist = 7;
        for (let i = 0; i < 6; i++) H.frame(0.05);
        out[key] = { inside: TT.inRoom(T, H.camera.position.x, H.camera.position.z, 0.05), y: +(H.camera.position.y - S.y).toFixed(2) };
        const p = TT.tl(T, T.aIn + Math.PI, 0.8), e = TT.body(S, 1, 'warrior', p.x, p.z, T.yG); e.ai.post.leash = 0;
        const q = TT.tl(T, T.aIn + Math.PI, T.RO + 14); TT.put(S, q.x, q.z, 0); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const c = F.siteToWorld(S, q.x, q.z), t = F.siteToWorld(S, T.cx, T.cz); H.camera.position.set(c.x, S.y + 1.8, c.z); H.camera.lookAt(t.x, S.y + 1.2, t.z); H.camera.updateMatrixWorld(); H.frame(0.05);
        out[key].outside = H.towers.seen(e);
        const ci = F.siteToWorld(S, TT.tl(T, T.aIn, 0.9).x, TT.tl(T, T.aIn, 0.9).z); H.camera.position.set(ci.x, S.y + T.yG + 1.7, ci.z); H.camera.lookAt(e.x, e.y + 1.0, e.z); H.camera.updateMatrixWorld(); H.frame(0.05);
        out[key].seenIn = H.towers.seen(e); F.removeEnt(e); H.CAM.mode = 'play'; H.UI.modal = null; }
      return out; })()""")
    check(all(r[k]['inside'] for k in ('tc', 'eg', 'lg')), f'the camera stays inside the rooms of a Thule shaft, an Eriu drum and a Logres gate drum ({r})')
    check(all(r[k]['outside'] is False and r[k]['seenIn'] is True for k in ('tc', 'eg', 'lg')), 'a body in a store room is not named through the walls, and is named from inside')

async def posts(page):
    r = await ev(page, 'posts', """(() => { const H = TT.H, F = TT.F, out = [];
      TT.quiet();
      for (const C of F.castles()) { if (C.kind === 'temple') continue; const K = C.S.keepRef;
        for (let i = 0; i < 3; i++) {
          const Rt = F.castleRoute(K, i), end = Rt[Rt.length - 1], st = Rt[0], post = C.posts[i].pos;
          const e = F.spawnRealmUnit(K.realm, 'archer', 30, 'guard', st.x, st.z, {}); e.y = F.floorAt(st.x, st.z, st.y);
          e.ai.route = Rt; e.ai.ri = 0; e.ai.post = { x: end.x, z: end.z, leash: 0 }; e.ai.wall = true; e.testFoe = true;
          const seen = new Set(); let t = 0;
          while (t < 110) { H.simulate(0.25, 0.05); t += 0.25; if (e.motion && e.motion.kind === 'ladder') seen.add(e.motion.L.id); if (!e.ai.route && !e.motion && Math.abs(e.y - (C.S.y + post[1])) < 0.35) break; }
          out.push([C.S.name, C.kind, i, new Set(Rt.filter((q) => q.ladder).map((q) => q.ladder.id)).size, seen.size, +t.toFixed(1), +(e.y - C.S.y).toFixed(2), post[1], +Math.hypot(e.x - end.x, e.z - end.z).toFixed(2)]);
          F.removeEnt(e);
        } }
      return out; })()""")
    bad = [q for q in r if not (abs(q[6] - q[7]) < 0.35 and q[8] < 1.3 and q[4] >= q[3])]
    check(len(r) == 18 and not bad, f'every archer of every garrison walks from the courtyard to its post (the gate towers\' tops first), climbing every ladder on the way ({bad or r[:3]})')
    gates = [q for q in r if q[2] < 2]
    check(all(q[3] >= 1 for q in gates), 'the first two posts of every keep are on its gate towers\' tops, reached by the ladders')

async def fights(page):
    await page.evaluate("(() => { TT.quiet(); const P = TT.H.GAME.player; P.hp = P.maxHp = 1e6; return 0; })()")
    # 1. one hand on the rungs: weaker blows, no bow, no two-handed spell, no shield
    r = await ev(page, 'one hand', """(() => { const H = TT.H, F = TT.F, K = TT.kinds(), T = K.lg, S = T.S, L = T.ladders[0], out = {};
      TT.empty(S);
      const w = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb), a = TT.body(S, 1, 'archer', L.foot.x, L.foot.z, L.yb), m = TT.body(S, 1, 'mage', L.foot.x, L.foot.z, L.yb);
      for (const e of [w, a, m]) { e.x = L.fx; e.z = L.fz; e.y = L.wyb; H.towers.towerClimb(e, L, 1); }
      H.simulate(1.2, 0.02);
      out.on = [w, a, m].map((e) => __hm.ladders.onLadder(e));
      out.slash = __hm.ladders.ladderAllows(w, H.ABILITIES.slash);
      out.charge = __hm.ladders.ladderAllows(w, H.ABILITIES.charge);
      out.shot = __hm.ladders.ladderAllows(a, H.ABILITIES.quickshot);
      out.fire = __hm.ladders.ladderAllows(m, H.ABILITIES.firebolt);
      out.frost = __hm.ladders.ladderAllows(m, H.ABILITIES.frost);
      __hm.cls.setBlock(w, true); out.block = !!(w.cs && w.cs.blockOn); __hm.cls.setBlock(w, false);
      for (const e of [w, a, m]) F.removeEnt(e);
      return out; })()""")
    check(all(r['on']) and r['slash'] is None and r['frost'] is None, f'on the rungs a warrior may still cut and a mage cast an instant one-handed spell ({r})')
    check(r['charge'] == 'ladder' and r['shot'] == 'ladder' and r['fire'] == 'ladder' and not r['block'], 'but nobody charges, draws a bow, casts a two-handed spell or raises a shield on a ladder')
    r = await ev(page, 'weaker', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().lg, S = T.S, L = T.ladders[0];
      const w = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb), t = TT.body(S, 0, 'warrior', 0, 0, 0); t.ai.post.leash = 0; t.hp = t.maxHp = 1e6;
      const cdm = (n) => { let s = 0; for (let i = 0; i < n; i++) s += __hm.ladders.computeDamage(w, t, 1).d; return s / n; };
      const stand = cdm(3000); H.towers.towerClimb(w, L, 1); H.simulate(1.0, 0.02); const rung = cdm(3000);
      F.removeEnt(w); F.removeEnt(t); return { stand: +stand.toFixed(1), rung: +rung.toFixed(1), k: +(rung / stand).toFixed(2) }; })()""")
    check(abs(r['k'] - 0.6) < 0.05, f'a blow struck from the rungs is about 0.6 of the same blow standing ({r})')
    # 2. a climber held by a foe at the hatch fights from the rungs; a heavy blow, a stun, a parry's stun knock it off
    r = await ev(page, 'hold and strike', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().lg, S = T.S, L = T.ladders[1], Hh = L.hatch, LD = __hm.ladders, out = {};
      TT.empty(S); Hh.held = true; H.simulate(1.0, 0.02);
      // the defender (the player, with no target and no shield raised) only stands there while we watch the climber
      const dp = TT.tl(T, L.a + 0.95, 1.0), d = H.GAME.player; TT.put(S, dp.x, dp.z, L.yt); d.faction = 0; d.target = null; d.hp = d.maxHp = 1e6;
      const c = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.hp = c.maxHp = 1e5; c.ai.post = null;
      const calm = () => { d.target = null; d.casting = null; };
      H.towers.towerClimb(c, L, 1); const b0 = LD.LADDER.stats.blows, h0 = d.hp; let acts = new Set(), held = 0;
      for (let i = 0; i < 40; i++) { calm(); H.simulate(0.15, 0.03); if (c.motion && c.motion.kind === 'ladder') acts.add(c.anim.act); if (c.motion && c.motion.st === 1 && c.motion.foe === d.id) held++; }
      out.y = +(c.y - S.y).toFixed(2); out.held = held; out.blows = LD.LADDER.stats.blows - b0; out.hurt = +(h0 - d.hp).toFixed(0); out.acts = [...acts]; out.st = c.motion ? c.motion.st : null;
      // a heavy blow knocks it off: it falls to the floor below (and, a soldier, starts up again)
      F.dealDamage(d, c, c.maxHp * 0.6, { kind: 'melee' }); out.knocked = c.motion ? c.motion.st : null; const f0 = LD.LADDER.stats.falls; H.simulate(1.0, 0.02); out.landed = { falls: LD.LADDER.stats.falls - f0, y: +(c.y - S.y).toFixed(2) };
      // a stun: climbing again, struck by a stun
      c.x = L.fx; c.z = L.fz; c.y = L.wyb; c.motion = null; c.buffs.length = 0; H.towers.towerClimb(c, L, 1); calm(); H.simulate(1.2, 0.02); F.addBuff(c, 'stun', 1, 1.2, d.id); out.stun = c.motion ? c.motion.st : null; H.simulate(1.5, 0.02);
      // a parry's stun: its blow parried by a warrior who has just raised his shield at the hatch
      TT.put(S, 30, 0, 0); const w = TT.body(S, 0, 'warrior', dp.x, dp.z, L.yt); w.hp = w.maxHp = 1e5; w.ai.post.leash = 0;
      c.x = L.fx; c.z = L.fz; c.y = L.wyb; c.motion = null; c.buffs.length = 0; c.ccdr = null; H.towers.towerClimb(c, L, 1);
      for (let i = 0; i < 30 && !(c.motion && c.motion.st === 1 && c.y > L.wyt - 1.8); i++) { w.swingAt = 1e9; w.ai.nextAbility = 1e9; H.simulate(0.1, 0.02); }
      // [keeps] (a climber the war's own business turned about is set on the rungs below the open hatch, as it would be)
      if (!(c.motion && c.motion.st === 1 && c.y > L.wyt - 1.8)) { c.motion = null; c.buffs.length = 0; H.towers.towerClimb(c, L, 1); c.motion.st = 1; c.motion.t = 0; c.motion.y = L.wyt - 1.75; c.x = L.lx; c.z = L.lz; c.y = c.motion.y; Hh.held = true; w.swingAt = 1e9; w.ai.nextAbility = 1e9; H.simulate(0.1, 0.02); }
      w.yaw = Math.atan2(c.x - w.x, c.z - w.z); if (w.cs) { w.cs.blockOn = false; w.cs.blockAt = -9; } __hm.cls.setBlock(w, true); out.blockOn = !!(w.cs && w.cs.blockOn); out.cy = +(c.y - S.y).toFixed(2);
      F.dealDamage(c, w, 50, { kind: 'melee' }); out.parry = c.motion ? c.motion.st : null; __hm.cls.setBlock(w, false); H.simulate(1.5, 0.02);
      F.removeEnt(c); F.removeEnt(w); Hh.held = false; return out; })()""")
    check(r['held'] > 10 and r['blows'] >= 2 and 18 in r['acts'], f'a climber held by a foe at the hatch strikes it from the rungs (body action 18) ({r})')
    check(r['knocked'] == 3 and r['landed']['falls'] == 1 and 6.9 < r['landed']['y'] < 9.2, f"a heavy blow knocks the climber off: it falls to the floor below ({r['landed']})")
    check(r['stun'] == 3 and r['parry'] == 3, f"a stun knocks a climber off, and so does a parry's stun ({r['stun']}, {r['parry']}, shield {r['blockOn']}, at {r['cy']})")
    r = await ev(page, 'fall harm', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().tc, S = T.S, L = T.ladders[0], out = {};
      TT.empty(S); const c = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.ai.post = null; c.hp = c.maxHp;
      H.towers.towerClimb(c, L, 1); let t = 0; while (c.y - L.wyb < 3.9 && t < 8) { H.simulate(0.1, 0.02); t += 0.1; }
      const y0 = c.y - S.y, hp0 = c.hp; __hm.ladders.ladderKnockOff(c, null); let stun = false;
      for (let i = 0; i < 20; i++) { H.simulate(0.1, 0.02); stun = stun || F.hasBuff(c, 'stun'); }
      out.h = +(y0 - (c.y - S.y)).toFixed(2); out.lost = +((hp0 - c.hp) / c.maxHp).toFixed(3); out.want = +Math.min(0.65, (out.h - 1.6) * 0.075).toFixed(3); out.stun = stun;
      F.removeEnt(c); return out; })()""")
    check(r['h'] > 3.5 and abs(r['lost'] - r['want']) < 0.01 and r['stun'], f'the fall harms by the height (none below 1.6 m, then 7.5% of health a metre) and winds the body ({r})')
    # 3. the hatch: held by a foe standing on it, heaved at from below and sometimes thrown open
    r = await ev(page, 'hatch held', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().tc, S = T.S, L = T.ladders[1], Hh = L.hatch, LD = __hm.ladders.LADDER, out = {};
      TT.empty(S); Hh.held = false; Hh.until = 0; H.simulate(1.0, 0.02);
      const hl = TT.loc(S, Hh.cx, Hh.cz), h = TT.body(S, 1, 'warrior', hl.x, hl.z, L.yt); h.ai.post.leash = 0; h.hp = h.maxHp = 1e5;
      const c = TT.body(S, 0, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.ai.post = null; c.hp = c.maxHp = 1e5;
      const k0 = LD.push.npc; LD.push.npc = 0; const he0 = LD.stats.heaves;
      H.towers.towerClimb(c, L, 1); let maxK = 0; for (let i = 0; i < 40; i++) { H.simulate(0.2, 0.02); maxK = Math.max(maxK, Hh.k); }
      out.heaves = LD.stats.heaves - he0; out.y = +(c.y - S.y).toFixed(2); out.maxK = +maxK.toFixed(2); out.on = __hm.ladders.ladderLidStanders(Hh).length;
      LD.push.npc = 1; const b0 = LD.stats.burst, hx = h.x, hz = h.z; for (let i = 0; i < 100 && LD.stats.burst === b0; i++) H.simulate(0.04, 0.02);
      out.burst = LD.stats.burst - b0; out.thrown = __hm.ladders.ladderLidStanders(Hh).includes(h) ? 'still on it' : 'off'; out.moved = +Math.hypot(h.x - hx, h.z - hz).toFixed(2);
      for (let i = 0; i < 30 && c.motion; i++) H.simulate(0.2, 0.02); out.through = +(c.y - S.y).toFixed(2);
      LD.push.npc = k0; F.removeEnt(c); F.removeEnt(h); return out; })()""")
    check(r['heaves'] >= 2 and r['maxK'] < 0.3 and r['y'] < 9 - 1.8, f'a foe standing on a shut hatch holds it: the climber below heaves at it in vain ({r})')
    check(r['burst'] == 1 and r['thrown'] == 'off', f'when a heave throws the lid open, whoever stood on it is thrown aside ({r})')
    # 4. the player slams the hatch on a foe coming up; an archer of the garrison steps onto a shut hatch
    r = await ev(page, 'slam', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().lg, S = T.S, L = T.ladders[1], Hh = L.hatch, P = H.GAME.player, out = {};
      TT.empty(S); Hh.held = true; H.simulate(1.0, 0.02);
      const pl = TT.tl(T, L.a + 1.2, 0.95); TT.put(S, pl.x, pl.z, L.yt); P.faction = 0; P.hp = P.maxHp;
      const c = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.ai.post = null; c.hp = c.maxHp = 3000;
      H.towers.towerClimb(c, L, 1); let lab = null;
      for (let i = 0; i < 40 && !lab; i++) { H.simulate(0.1, 0.02); const o = TT.offer(); if (o && o.startsWith('Slam')) lab = o; }
      out.lab = lab; out.hp0 = c.hp; out.used = TT.use(); H.simulate(0.2, 0.02); out.st = c.motion ? c.motion.st : null; out.hurt = +(out.hp0 - c.hp).toFixed(0);
      H.simulate(1.6, 0.02); out.k = +Hh.k.toFixed(2); out.cy = +(c.y - S.y).toFixed(2);
      F.removeEnt(c); TT.put(S, 30, 0, 0); return out; })()""")
    check(r['lab'] == 'Slam the hatch on them' and r['used'] == r['lab'] and r['st'] == 3 and r['hurt'] > 0 and r['k'] < 0.1 and abs(r['cy'] - 7) < 0.3, f'E slams the hatch on a foe coming up through it: it is struck, knocked off and falls ({r})')
    r = await ev(page, 'archer holds', """(() => { const H = TT.H, F = TT.F, K = TT.keep(0, 0), C = F.castleOf(K.site), T = TT.kinds().lg, S = T.S, L = T.ladders[1], Hh = L.hatch, out = {};
      TT.empty(S); Hh.held = false; Hh.until = 0; H.simulate(1.0, 0.02);
      const pp = C.posts[1].pos, a = TT.body(S, 0, 'archer', pp[0], pp[2], pp[1]); a.ai.wall = true; a.ai.post.leash = 0; a.tweak = { rangedRange: 36, dmg: 0.55, swing: 3.0 }; F.setupStats(a);
      const c = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.ai.post = null; c.hp = c.maxHp = 1e5;
      H.towers.towerClimb(c, L, 1); let on = false; for (let i = 0; i < 40 && !on; i++) { H.simulate(0.25, 0.02); on = __hm.ladders.ladderLidStanders(Hh).includes(a); }
      out.on = on; out.hold = !!a.ai.hatch; out.k = +Hh.k.toFixed(2); out.cy = +(c.y - S.y).toFixed(2);
      // nobody sees or strikes through the shut hatch
      out.sight = __hm.ladders.towerSightBlocked(a, c);
      c.alive = false; F.removeEnt(c); let t2 = 0; for (; t2 < 10 && a.ai.hatch; t2 += 0.25) H.simulate(0.25, 0.02); const pw = F.siteToWorld(S, pp[0], pp[2]);
      out.back = !a.ai.hatch && Math.hypot(a.ai.post.x - pw.x, a.ai.post.z - pw.z) < 0.2; out.t2 = t2; out.postD = +Math.hypot(a.ai.post.x - pw.x, a.ai.post.z - pw.z).toFixed(2);
      F.removeEnt(a); return out; })()""")
    check(r['on'] and r['hold'] and r['k'] < 0.3 and r['sight'], f'an archer of the garrison steps onto the shut hatch while a foe climbs beneath it; nobody is seen through it ({r})')
    check(r['back'], 'and goes back to its post once nobody climbs beneath it')
    # 5. an enemy who breaks into a gate tower climbs after the archers and fights at the hatch
    r = await ev(page, 'storming', """(() => { const H = TT.H, F = TT.F, K = TT.keep(0, 0), S = K.site, T = TT.kinds().lg, out = {};
      TT.empty(S); TT.put(S, 0, 80, 0);
      // an archer of the garrison on the right gate tower's top, and a foe at the tower's courtyard door
      const pp = F.castleOf(S).posts[1].pos, a = TT.body(S, 0, 'archer', pp[0], pp[2], pp[1]); a.ai.wall = true; a.ai.post.leash = 0; a.hp = a.maxHp = 1e6; a.tweak = { rangedRange: 36, dmg: 0.02, swing: 3.0 }; F.setupStats(a);
      const p = TT.tl(T, Math.PI, T.RO + 2.0), e = TT.body(S, 1, 'warrior', p.x, p.z, 0); e.ai.post.leash = 40; e.tweak = { hp: 30 }; F.setupStats(e); e.target = a.id;
      const b0 = __hm.ladders.LADDER.stats.blows, ids = new Set(); let maxY = 0, inT = false, t = 0, hurt = a.hp;
      while (t < 60 && e.alive) { H.simulate(0.5, 0.05); t += 0.5; maxY = Math.max(maxY, e.y - S.y); if (e.motion && e.motion.kind === 'ladder') ids.add(e.motion.L.id); if (TT.inRoom(T, e.x, e.z)) inT = true; if (maxY > 10.4) break; }
      out.maxY = +maxY.toFixed(2); out.ladders = ids.size; out.inTower = inT; out.alive = e.alive; out.blows = __hm.ladders.LADDER.stats.blows - b0; out.archerHurt = +(hurt - a.hp).toFixed(0); out.t = t;
      F.removeEnt(e); F.removeEnt(a); return out; })()""")
    check(r['inTower'] and r['ladders'] == 2 and r['maxY'] > 8.5 and (r['blows'] > 0 or r['maxY'] > 10.4), f'an enemy who breaks into a gate tower climbs both ladders after the archer on its top and fights at the hatch ({r})')

async def fire(page):
    r = await ev(page, 'tower fire', """(() => { const H = TT.H, F = TT.F, TF = __hm.towerfire, T = TT.kinds().tc, S = T.S, K = S.keepRef, out = {}, W = __hm.dbg.WEATHER;
      TT.empty(S); W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; TT.put(S, 0, 60, 0);
      // the garrison's own fire spares its towers; a foe's lights them
      const own = F.spawnRealmUnit(K.realm, 'mage', 30, 'guard', T.wx + 9, T.wz, {}), foe = F.spawnRealmUnit((K.realm + 1) % 3, 'mage', 30, 'guard', T.wx + 9, T.wz + 2, {});
      F.fireLandsAt(T.wx, S.y + 4, T.wz, 1.2, own); out.ownLit = !!T.burn;
      F.fireLandsAt(T.wx, S.y + 4, T.wz, 1.2, foe); out.lit = !!T.burn; F.removeEnt(own); F.removeEnt(foe);
      // someone in its store room is burnt; the fire climbs, the logs char
      const st = TT.tl(T, T.aIn, 0.3), e = TT.body(S, K.realm, 'warrior', st.x, st.z, T.yG); e.hp = e.maxHp = 1e4; e.ai.post.leash = 0;
      const tr = []; let maxFires = 0;
      for (let t = 0; t < 30; t += 1) { H.simulate(1, 0.05); maxFires = Math.max(maxFires, T.burn ? T.burn.fires.filter((f) => f.until > H.GAME.t).length : 0); if (t % 6 === 0) tr.push([t, T.burn ? +T.burn.heat.toFixed(2) : null, +(T.char || 0).toFixed(2)]); }
      out.tr = tr; out.maxFires = maxFires; out.hurt = +(1 - e.hp / e.maxHp).toFixed(3); F.removeEnt(e);
      const C = T.C, U3 = C.towerU, i = TF.list().filter((q) => q.C === C).indexOf(T); out.uni = [+U3.uTA.value[i].w.toFixed(2), +U3.uTB.value[i].y.toFixed(2)];
      // it falls in: the gallery and its ladder stand down, the heap shows, whoever stood up there falls
      // (someone stands in the gallery just before it goes: up there all the while, the fire would have killed them)
      if (T.burn) T.burn.t = Math.max(T.burn.t, TF.TFIRE.burn - 1.5);
      const gp = TT.tl(T, T.aIn + Math.PI, 0.9), g = TT.body(S, K.realm, 'archer', gp.x, gp.z, T.TT); g.hp = g.maxHp = 1e4; g.ai.post.leash = 0;
      for (let t = 0; t < 50 && !T.fallen; t += 0.25) H.simulate(0.25, 0.05);
      const top = T.ladders.find((L) => Math.abs(L.yt - T.TT) < 0.01);
      out.fallen = !!T.fallen; out.floors = T.topFloors.filter((f) => f.active).length; out.colls = T.topColls.filter((c) => c.active).length; out.gone = !!top.gone; out.heap = T.heap.visible; out.cut = +(U3.uTB.value[i].x - S.y).toFixed(2);
      H.simulate(2, 0.05); out.fell = +(g.y - S.y).toFixed(2); F.removeEnt(g);
      // the keep quiet, it is built again
      K.lastEnemyNear = -999; for (let t = 0; t < 200 && T.fallen; t += 2) { K.lastEnemyNear = -999; H.simulate(2, 0.1); }
      out.rebuilt = !T.fallen && !top.gone && T.topFloors.every((f) => f.active) && !T.heap.visible; out.char = +(T.char || 0).toFixed(2); out.stats = { ...TF.TFIRE.stats };
      // rain puts out a young fire
      W.kind = 'rain'; W.raining = 1; W.wet = 1; __hm.dbg.U.uWet.value = 1; const T2 = TT.kinds().tg; TF.towerIgnite(T2, 3);
      for (let t = 0; t < 30 && T2.burn; t += 1) { __hm.dbg.U.uWet.value = 1; W.raining = 1; H.simulate(1, 0.05); }
      out.rainOut = !T2.burn && !T2.fallen; W.kind = 'clear'; W.raining = 0; W.wet = 0;
      return out; })()""")
    check(not r['ownLit'] and r['lit'], f"a timber tower is not set alight by its own garrison's fire, and is by a foe's ({r['ownLit']}, {r['lit']})")
    check(r['maxFires'] >= 4 and r['tr'][-1][2] > 0.3 and r['hurt'] > 0.05 and r['uni'][0] > 0.3, f"it burns: flames climb it, its logs char and whoever is inside is burnt ({r['tr']}, flames {r['maxFires']}, hurt {r['hurt']}, char {r['uni']})")
    check(r['fallen'] and r['floors'] == 0 and r['colls'] == 0 and r['gone'] and r['heap'] and abs(r['cut'] - 8.8) < 0.3, f"after the fire its gallery and roof fall in: their floor, breastwork and ladder stand down and the charred timbers lie below ({r})")
    check(5.3 < r['fell'] < 5.7, f"whoever stood in the gallery falls into the room below ({r['fell']})")
    check(r['rebuilt'] and r['char'] < 0.05, f"the keep quiet, the tower is built again ({r['rebuilt']}, char {r['char']}, {r['stats']})")
    check(r['rainOut'], 'rain puts out a young fire in a timber tower')

async def kshots(page):
    # each new tower from the courtyard, inside its rooms by day and at night, at high and low quality
    await page.evaluate("(() => { TT.quiet(); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; __hm.setTod(0.42); __hm.simulate(0.3, 0.05); TT.put(TT.kinds().lg.S, 0, 90, 0); return 0; })()")
    views = {
        'lg': [('outside', "T.aIn", 13, 3.2, "T.aIn", 0, 6.5), ('store', "T.aIn", 0.7, T_Y + "1.65", "0", 1.0, T_Y + "1.2"), ('room', "Math.PI + 0.4", 0.9, "T.H + 1.7", "0.3", 1.0, "T.H + 0.9"), ('top', "Math.PI", 0.6, "T.TT + 2.4", "0", 1.4, "T.TT + 0.3")],
        'eg': [('outside', "Math.PI", 12, 3.0, "Math.PI", 0, 5.5), ('top', "-1.2", 0.4, "T.TT + 1.7", "1.84", 2.0, "T.TT + 0.8")],
        'el': [('outside', "T.aIn", 11, 3.0, "T.aIn", 0, 5.0)],
        'tc': [('outside', "T.aIn + 0.6 * T.sx", 13, 4.0, "T.aIn", 0, 6.0), ('store', "T.aIn", 1.3, T_Y + "1.65", "T.aIn + Math.PI", 1.3, T_Y + "1.0"), ('room', "T.aIn", 1.3, "T.H + 1.65", "T.aIn + Math.PI", 1.4, "T.H + 0.9"), ('top', "T.aIn", 1.6, "T.TT + 1.75", "T.aIn + Math.PI", 2.0, "T.TT + 0.9")],
        'tg': [('outside', "Math.PI", 11, 3.0, "Math.PI", 0, 6.0)],
    }
    for key, vs in views.items():
        for (nm, a, r, y, ta, tr, ty) in vs:
            js = f"(() => {{ const T = TT.kinds()['{key}'], S = T.S; TT.cam(S, T, {a}, {r}, {y}, {ta}, {tr}, {ty}); for (let i = 0; i < 2; i++) __hm.frame(0.05); return 0; }})()"
            await shot(page, f'tower_{key}_{nm}', js)
    await shot(page, 'tower_tc_night', "(() => { __hm.setTod(0.97); __hm.simulate(0.2, 0.05); const T = TT.kinds().tc, S = T.S; TT.cam(S, T, T.aIn, 1.3, T.yG + 1.65, T.aIn + Math.PI, 1.3, T.yG + 1.0); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()")
    await shot(page, 'tower_lg_night', "(() => { const T = TT.kinds().lg, S = T.S; TT.cam(S, T, Math.PI + 0.4, 0.9, T.H + 1.7, 0.3, 1.0, T.H + 0.9); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()")
    await page.evaluate("(() => { __hm.setTod(0.42); __hm.fn.setQuality('low'); __hm.simulate(0.2, 0.05); return 0; })()")
    for key, (a, r, y, ta, tr, ty) in {'lg': ("T.aIn", 13, 3.2, "T.aIn", 0, 6.5), 'tc': ("T.aIn + 0.6 * T.sx", 13, 4.0, "T.aIn", 0, 6.0)}.items():
        await shot(page, f'tower_{key}_low', f"(() => {{ const T = TT.kinds()['{key}'], S = T.S; TT.cam(S, T, {a}, {r}, {y}, {ta}, {tr}, {ty}); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; }})()")
    await shot(page, 'tower_tc_room_low', "(() => { const T = TT.kinds().tc, S = T.S; TT.cam(S, T, T.aIn, 1.3, T.H + 1.65, T.aIn + Math.PI, 1.4, T.H + 0.9); for (let i = 0; i < 3; i++) __hm.frame(0.05); return 0; })()")
    await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
    # a timber tower on fire, and fallen in
    await shot(page, 'tower_tc_fire', """(() => { const H = TT.H, T = TT.kinds().tc, S = T.S, W = __hm.dbg.WEATHER; W.kind = 'clear'; W.raining = 0; W.wet = 0; __hm.setTod(0.85); __hm.towerfire.towerIgnite(T, 2); H.simulate(18, 0.1); TT.cam(S, T, T.aIn + 0.6 * T.sx, 15, 4.0, T.aIn, 0, 7.0); for (let i = 0; i < 3; i++) H.frame(0.05); return T.burn ? +T.burn.heat.toFixed(2) : null; })()""")
    await shot(page, 'tower_tc_fallen', """(() => { const H = TT.H, T = TT.kinds().tc, S = T.S; __hm.setTod(0.42); if (T.burn) T.burn.t = 1e3; H.simulate(3, 0.1); TT.cam(S, T, T.aIn + 0.6 * T.sx, 15, 6.0, T.aIn, 0, 6.0); for (let i = 0; i < 3; i++) H.frame(0.05); return !!T.fallen; })()""")
    await page.evaluate("(() => { const T = TT.kinds().tc; if (T.fallen) __hm.towerfire.towerRebuilt(T); return 0; })()")
    # a fight on a ladder: a climber holding below the hatch, striking at a warrior beside it
    await shot(page, 'tower_ladder_fight', """(() => { const H = TT.H, F = TT.F, T = TT.kinds().lg, S = T.S, L = T.ladders[1], Hh = L.hatch;
      TT.empty(S); Hh.held = true; H.simulate(1.0, 0.02);
      const d = TT.body(S, 0, 'warrior', TT.tl(T, L.a + 0.95, 1.0).x, TT.tl(T, L.a + 0.95, 1.0).z, L.yt); d.hp = d.maxHp = 1e5;
      const c = TT.body(S, 1, 'warrior', L.foot.x, L.foot.z, L.yb, 'soldier'); c.hp = c.maxHp = 1e5; c.ai.post = null;
      H.towers.towerClimb(c, L, 1); for (let i = 0; i < 90; i++) { H.simulate(0.1, 0.02); if (c.anim.act === 18 && c.anim.actT > 0.2) break; }
      TT.cam(S, T, L.a - 1.5, 1.25, T.TT + 2.1, L.a, 0.85, T.TT - 0.7); return { act: c.anim.act, y: +(c.y - S.y).toFixed(2) }; })()""")

asyncio.run(main())
