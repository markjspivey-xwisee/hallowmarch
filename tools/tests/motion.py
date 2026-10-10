"""Motion: every kind of body measured as it moves, from the vertices the shaders actually draw (window.__hm.motion:
the crowds drawn once more as points with their own vertex shaders under an identity camera, read back from a float
target). For each body and each common motion: how far a planted foot slides while it bears weight (cm), how fast it
slips as a share of the body's speed (slipK: 0 planted, 1 gliding on ice), where the lowest foot is over the floor
(median and lowest: + floats, - sinks), how many feet come down a second, and for birds how the wings move.
usage: python3 tools/tests/motion.py [tag=before] [only=human,beast,farm,bird,player,pose,dragon,shots] [q=low]
(shots: pictures of a pheasant and a mallard taking off and flying, Cinderwing rearing, springing, flying and landing,
a runner and a kneeling priest, at 960x540 in tools/out/motion_*.png)
Writes tools/out/motion_<tag>.json and prints a table; checks the limits at the end (a planted foot slides < 4 cm,
slipK < 0.15, the lowest foot within 4 cm of the floor) and lists the worst offenders."""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
TAG = OPT.get('tag', 'run')
ONLY = OPT.get('only', 'human,beast,farm,bird,player,pose,dragon').split(',')
if 'shots' in ARGS and 'shots' not in ONLY: ONLY.append('shots')
SHOTS = 'shots' in ARGS
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HELP = r"""
window.MO = {
  H: __hm, F: __hm.fn, M: __hm.motion, made: [],
  clear() { for (const e of this.made) { if (e.mount) e.mount = null; this.F.removeEnt(e); } this.made = []; },
  calm() { const H = this.H, P = H.GAME.player; P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.target = null; },
  quiet() {
    const H = this.H;
    for (const w of H.WAR.warbands) w.dead = true;
    for (const C of H.WAR.commanders || []) { C.nextThink = 1e9; C.nextSpawn = 1e9; }
    const W = H.dbg.WEATHER; if (W) { W.mode = 'clear'; W.kind = 'clear'; W.nextBolt = 1e9; }
  },
  // an open, nearly flat stretch: n lanes 3 m apart, L long, near (cx, cz)
  lane(cx, cz, L, n) {
    const F = this.F;
    for (let r = 0; r < 160; r += 6) for (let k = 0; k < 16; k++) {
      const a = k / 16 * Math.PI * 2, x0 = cx + Math.sin(a) * r, z0 = cz + Math.cos(a) * r;
      for (const yaw of [0, 0.8, 1.6, 2.4]) {
        const ux = Math.sin(yaw), uz = Math.cos(yaw), sx = uz, sz = -ux;
        let ok = true, hmin = 1e9, hmax = -1e9;
        for (let i = 0; i <= n && ok; i++) for (let j = 0; j <= L; j += 1.5) {
          const x = x0 + ux * (j - L / 2) + sx * (i - n / 2) * 3, z = z0 + uz * (j - L / 2) + sz * (i - n / 2) * 3;
          if (!F.isWalkable(x, z)) { ok = false; break; }
          const h = F.heightAt(x, z); hmin = Math.min(hmin, h); hmax = Math.max(hmax, h);
          if (hmax - hmin > 0.6 || __hm.water.waterAt(x, z)) { ok = false; break; }
        }
        if (ok) return { x: x0, z: z0, ux, uz, sx, sz, L };
      }
    }
    return null;
  },
  body(kind, x, z, yaw) {
    const F = this.F;
    let e;
    if (kind === 'human') e = F.spawnRealmUnit(0, 'warrior', 10, 'test', x, z);
    else {
      const cols = { sheep: [[0.86, 0.84, 0.78], [0.3, 0.28, 0.26]], hen: [[0.62, 0.42, 0.2], [0.4, 0.25, 0.12]], pheasant: [[0.62, 0.28, 0.09], [0.05, 0.19, 0.12]], duck: [[0.52, 0.5, 0.46], [0.03, 0.22, 0.09]] }[kind] || [[0.45, 0.43, 0.4], [0.3, 0.28, 0.26]];
      e = F.makeEnt({ kind, faction: 4, role: 'test', name: 'motion ' + kind, level: 5, x, z, y: F.heightAt(x, z), radius: 0.4, look: { colA: cols[0], colB: cols[1] }, scale: 1 });
    }
    e.yaw = yaw; e.prevX = e.x; e.prevZ = e.z; e.testMo = true;
    this.made.push(e);
    return e;
  },
  // the camera high over the lanes so every body is in view
  over(Ln, h = 26) {
    const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    H.camera.position.set(Ln.x - Ln.ux * 2 + Ln.sx * 0.1, this.F.heightAt(Ln.x, Ln.z) + h, Ln.z - Ln.uz * 2);
    H.camera.lookAt(Ln.x, this.F.heightAt(Ln.x, Ln.z), Ln.z); H.camera.updateMatrixWorld();
  },
  // speed over time: a ramp up, a steady stretch
  ramp(v, t, up = 0.35) { return v * Math.min(1, t / up); },
  // bodies of one kind moving straight at each speed, side by side; returns the measures for each
  straight(kind, vs, sec = 3, opts = {}) {
    const P = this.H.GAME.player;
    const Ln = this.lane(this.cx, this.cz, Math.max(...vs) * sec + 4, vs.length);
    if (!Ln) return { err: 'no lane' };
    P.x = P.prevX = Ln.x - Ln.sx * (vs.length / 2 + 4) * 3; P.z = P.prevZ = Ln.z - Ln.sz * (vs.length / 2 + 4) * 3; P.y = this.F.heightAt(P.x, P.z);
    const ents = vs.map((v, i) => {
      const off = (i - (vs.length - 1) / 2) * 3, L0 = v * sec / 2;
      const x = Ln.x + Ln.sx * off - Ln.ux * L0, z = Ln.z + Ln.sz * off - Ln.uz * L0;
      const e = this.body(kind, x, z, Math.atan2(Ln.ux, Ln.uz));
      if (opts.setup) opts.setup(e);
      const self = this;
      return { e, kind: kind === 'human' ? 'human' : 'beast', which: opts.which || ['feet'], drive(e, t, dt) { const s = self.ramp(v, t) * dt; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = opts.turn ? Math.atan2(Ln.ux, Ln.uz) + opts.turn * t : Math.atan2(Ln.ux, Ln.uz); } };
    });
    this.over(Ln, Math.max(14, Math.max(...vs) * sec * 0.9));
    const rec = this.M.motionRun(ents, sec, 1 / 60);
    const out = vs.map((v, i) => ({ v, ...this.M.motionMeasure(rec[i], { skip: opts.skip ?? 0.6 }) }));
    this.clear();
    return out;
  },
  // the player walked by the keys toward a list of points (site-local or world), measured on the way
  playerPath(pts, sec, opts = {}) {
    const H = this.H, P = H.GAME.player;
    H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); if (opts.sprint) H.INPUT.keys.add('ShiftLeft');
    let k = 0;
    const self = this;
    const E = { e: P, kind: 'human', which: opts.which || ['feet'], drive(e) { while (k < pts.length - 1 && Math.hypot(pts[k].x - e.x, pts[k].z - e.z) < 0.45) k++; H.CAM.yaw = Math.atan2(pts[k].x - e.x, pts[k].z - e.z); } };
    const ents = [E];
    if (opts.horse) ents.push({ e: P, kind: 'beast', which: ['feet'] });
    const rec = this.M.motionRun(ents, sec, 1 / 60, { cam: () => { H.UI.modal = null; self.chase(P); } });
    H.INPUT.keys.clear();
    return ents.map((x, i) => ({ ...this.M.motionMeasure(rec[i], { skip: opts.skip ?? 0.8, steady: opts.steady }), y0: +(rec[i][0].y).toFixed(2), y1: +(rec[i][rec[i].length - 1].y).toFixed(2) }));
  },
  chase(P) { const H = this.H; H.CAM.mode = 'fixed'; H.camera.position.set(P.x - Math.sin(P.yaw) * 6, P.y + 4, P.z - Math.cos(P.yaw) * 6); H.camera.lookAt(P.x, P.y + 1, P.z); H.camera.updateMatrixWorld(); },
  // a still body in a pose (an action held): where its feet and knees are over the floor
  pose(act, sec = 2) {
    const P = this.H.GAME.player, Ln = this.lane(this.cx, this.cz, 4, 1);
    const e = this.body('human', Ln.x, Ln.z, 0);
    P.x = P.prevX = Ln.x + 8; P.z = P.prevZ = Ln.z + 8;
    this.over(Ln, 8);
    this.M.motionRun([{ e, kind: 'human', which: ['feet', 'knees'] }], 0.05, 1 / 60);
    e.anim.act = act; e.anim.actT = 0; e.anim.actDur = sec + 1;
    const rec2 = this.M.motionRun([{ e, kind: 'human', which: ['feet', 'knees'] }], sec, 1 / 60);
    const last = rec2[rec2.length - 1] ? rec2[0][rec2[0].length - 1] : null;
    const L = last && last.L, g = (p) => p ? +((p[3] - this.M.motionFloor(p[0], p[2], last.y)) * 100).toFixed(1) : null;
    this.clear();
    return L ? { feet: L.feet.map(g), knees: (L.knees || []).map(g) } : { err: 'not seen' };
  },
};
0;
"""

SHOTJS = r"""
window.MS = {
  H: __hm, F: __hm.fn,
  cam(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  // the camera beside a body, d metres off its flank, looking at its middle
  side(e, d, up, h = 0.3, back = 0) { const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw); this.cam(e.x + fz * d - fx * back, e.y + up, e.z - fx * d - fz * back, e.x, e.y + h, e.z); },
  bird(kind) { const D = __hm.depth; return D.DEPTH.birds.find((q) => q.kind === kind && q.alive && !q.removed && !q.bird.fly && (kind !== 'duck' || q.bird.water)); },
  flush(e, t) { const P = this.H.GAME.player; this.H.teleport(e.x + 40, e.z + 40); MO.calm(); __hm.depth.dpFlush(e, e.x - 2, e.z - 1); for (let k = 0; k < Math.round(t * 60); k++) this.H.simulate(1 / 60, 1 / 60); return e; },
  more(t) { for (let k = 0; k < Math.round(t * 60); k++) this.H.simulate(1 / 60, 1 / 60); },
  dragon(how, t) { const D = __hm.dbg.DRAGON; __hm.motion.motionDragon(how, t); return D.e; },
  dragonUntil(cond, max) { const D = __hm.dbg.DRAGON; for (let k = 0; k < max * 30 && !cond(D); k++) { MO.H.simulate(1 / 30, 1 / 30); __hm.fn.dragonAnimate(1 / 30); D.lastFoe = __hm.GAME.t; } return D.e; },
};
0;
"""

async def shot(page, name, js):
    await page.evaluate(js)
    await page.evaluate("__hm.frame(0.033); 0")
    data = await page.evaluate("(() => { __hm.frame(0.033); return document.querySelector('canvas').toDataURL('image/png'); })()")
    import base64
    pathlib.Path(OUT + name + '.png').write_bytes(base64.b64decode(data.split(',')[1]))
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

def fmt(r):
    if 'err' in r: return f"{r.get('err')} (n={r.get('n')})"
    return (f"v {r['v']:5.2f}  slide {r['slideMax']:5.1f} cm (mean {r['slideMean']:4.1f})  slipK {r['slipK'] if r['slipK'] is not None else '-':>5}  "
            f"lift {r['lift']:5.1f} cm  lowest foot: p5 {r['low5']:5.1f} cm, min {r['lowMin']:5.1f}  stance {r['stanceShare']:4.2f}  steps/s {r['steps']:5.2f}  pivot {r['pivot']:4.2f}")

ROWS = []
def score(r):
    return max(r['slideMax'] / 4, (r['slipK'] or 0) / 0.15, max(0, r['low5']) / 3, max(0, -r['lowMin']) / 4)
def report(label, rs, vs):
    for v, r in zip(vs, rs):
        print(f'  {label:10s} at {v:4.1f} m/s: {fmt(r)}', flush=True)
        ROWS.append({'case': label, 'want': v, **r})

async def ev(page, js):
    return await page.evaluate(js)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await ev(page, f"__hm.fn.setQuality('{OPT.get('q', 'low')}'); 0")
        await ev(page, "__hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.setTod(0.45); 0")
        await ev(page, HELP)
        await ev(page, "(() => { MO.quiet(); MO.calm(); const R = __hm.REALMS[0], S = R.musterSite, a = Math.atan2(S.x, S.z); MO.cx = S.x + Math.sin(a) * 40; MO.cz = S.z + Math.cos(a) * 40; __hm.simulate(1); return 0; })()")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        res = {}
        if 'human' in ONLY:
            vs = [0.4, 1.0, 1.6, 3.2, 5.0, 7.0]
            r = await ev(page, f"MO.straight('human', {vs}, 3)")
            report('person', r, vs); res['human'] = r
            # turning on the spot (2.5 rad/s): the feet should step round, not pivot on the ground
            r = await ev(page, "MO.straight('human', [0], 2.5, { setup: (e) => { e._turnMo = true; } , turn: 2.5 })")
            report('turning', r, [0]); res['turn'] = r
        if 'beast' in ONLY:
            for kind, vs in (('wolf', [0.6, 1.5, 3.2, 7.5]), ('boar', [0.5, 1.4, 3.0, 6.0]), ('bear', [0.6, 1.5, 3.2, 6.5]), ('deer', [0.6, 1.5, 3.6, 8.5]), ('horse', [0.8, 1.8, 4.5, 11.0])):
                r = await ev(page, f"MO.straight('{kind}', {vs}, 2.6)")
                report(kind, r, vs); res[kind] = r
        if 'farm' in ONLY:
            for kind, vs in (('sheep', [0.4, 1.1, 2.6, 5.0]), ('cattle', [0.4, 1.0, 2.2, 4.5]), ('pig', [0.4, 1.0, 2.4, 4.5]), ('hound', [0.6, 1.5, 3.6, 7.5]), ('hen', [0.15, 0.4, 0.9, 2.0])):
                r = await ev(page, f"MO.straight('{kind}', {vs}, 2.6)")
                report(kind, r, vs); res[kind] = r
        if 'bird' in ONLY:
            for kind, vs in (('pheasant', [0.3, 0.9, 2.2]), ('duck', [0.3, 0.9, 1.6])):
                r = await ev(page, f"MO.straight('{kind}', {vs}, 2.6)")
                report(kind, r, vs); res[kind] = r
        if 'player' in ONLY:
            # the player by the keys: across the muster ground walking and sprinting, up a keep's stair onto the wall walk
            r = await ev(page, "(() => { const P = __hm.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 30, 1); P.x = P.prevX = Ln.x - Ln.ux * 14; P.z = P.prevZ = Ln.z - Ln.uz * 14; P.y = MO.F.heightAt(P.x, P.z); P.yaw = Math.atan2(Ln.ux, Ln.uz); return MO.playerPath([{ x: Ln.x + Ln.ux * 14, z: Ln.z + Ln.uz * 14 }], 3.2, { steady: true }); })()")
            report('player run', r, [0]); res['player_run'] = r
            # (a sprint covers 10 m a second: the lane is long enough that the runner never reaches its end and turns)
            r = await ev(page, "(() => { const P = __hm.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 40, 1); P.x = P.prevX = Ln.x - Ln.ux * 19; P.z = P.prevZ = Ln.z - Ln.uz * 19; P.y = MO.F.heightAt(P.x, P.z); P.yaw = Math.atan2(Ln.ux, Ln.uz); P.endurance = 100; return MO.playerPath([{ x: Ln.x + Ln.ux * 19, z: Ln.z + Ln.uz * 19 }], 2.8, { sprint: true, steady: true }); })()")
            report('sprint', r, [0]); res['player_sprint'] = r
            r = await ev(page, "(() => { const H = __hm, K = H.WAR.keeps.find((K) => K.orig === 0 && K.site === H.REALMS[0].keepSites[0]), S = K.site, P = H.GAME.player, w = (lx, lz) => H.fn.siteToWorld(S, lx, lz); const a = w(10.6, -7.6); P.x = P.prevX = a.x; P.z = P.prevZ = a.z; P.y = S.y; P.faction = 0; P.onGround = true; P.vy = 0; H.simulate(0.3, 1/60); const pts = [w(13.0, -6.6), w(13.0, 3.4), w(13.0, 4.1)]; const r = MO.playerPath(pts, 4.5, { skip: 0.5 }); return r.map((q) => ({ ...q, rise: +(q.y1 - S.y).toFixed(2) })); })()")
            report('stairs', r, [0]); res['player_stairs'] = r
            # running round a bend: the body leans into the turn (the head toward the inside), the feet stay planted
            r = await ev(page, "(() => { const H = __hm, P = H.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 30, 1); P.x = P.prevX = Ln.x - Ln.ux * 6; P.z = P.prevZ = Ln.z - Ln.uz * 6; P.y = MO.F.heightAt(P.x, P.z); P.yaw = Math.atan2(Ln.ux, Ln.uz); H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); let yaw0 = P.yaw; const E = { e: P, kind: 'human', which: ['feet', 'head'], drive(e, t) { H.CAM.yaw = yaw0 + 0.9 * t; } }; const rec = MO.M.motionRun([E], 2.4, 1 / 60, { cam: () => { H.UI.modal = null; MO.chase(P); } }); H.INPUT.keys.clear(); const S = rec[0].filter((q) => q.t > 1.0 && q.L && q.L.head && q.L.head[0]); const side = S.map((q) => { const h = q.L.head[0], rx = Math.cos(q.yaw), rz = -Math.sin(q.yaw); return ((h[0] - q.x) * rx + (h[2] - q.z) * rz) / Math.max(0.5, h[1] - q.y); }); const m = side.reduce((a, b) => a + b, 0) / Math.max(1, side.length); return { ...MO.M.motionMeasure(rec[0], { skip: 1.0 }), leanDeg: +(Math.atan(m) * 180 / Math.PI).toFixed(1), animLean: +((P.anim.lean || 0) * 180 / Math.PI).toFixed(1) }; })()")
            print(f"  bend       {fmt(r)}  lean {r.get('leanDeg')} deg (anim {r.get('animLean')})", flush=True); res['player_bend'] = r
            check(abs(r.get('leanDeg', 0)) > 4, f"a runner leans into a bend ({r.get('leanDeg')} degrees)")
            # riding round a bend: the horse leans in with its rider (whole turns on the horse's yaw, beastLeanYaw)
            r = await ev(page, "(() => { const H = __hm, P = H.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 40, 1); P.x = P.prevX = Ln.x - Ln.ux * 6; P.z = P.prevZ = Ln.z - Ln.uz * 6; P.y = MO.F.heightAt(P.x, P.z); P.yaw = Math.atan2(Ln.ux, Ln.uz); MO.F.mountUp(P, true); H.simulate(0.3, 1/60); H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); const yaw0 = P.yaw; let best = 0; for (let k = 0; k < 120; k++) { H.CAM.yaw = yaw0 + 0.8 * k / 60; H.simulate(1 / 60, 1 / 60); if (k % 10) continue; MO.chase(P); MO.M.motionDraw(); const hit = MO.M.motionFind(P).find((q) => q.kind !== 'human'); if (hit) { const w = hit.crowd.attrs[0].array[hit.idx * 4 + 3]; best = Math.max(best, Math.abs(Math.round(w / (2 * Math.PI)))); } } H.INPUT.keys.clear(); MO.F.dismount(P); return { horseLeanDeg: +(best * 0.04 * 180 / Math.PI).toFixed(1), riderLeanDeg: +((P.anim.lean || 0) * 180 / Math.PI).toFixed(1) }; })()")
            print('  ride bend ', json.dumps(r), flush=True); res['ride_bend'] = r
            check(r.get('horseLeanDeg', 0) > 3, f"a horse leans into a bend with its rider ({r.get('horseLeanDeg')} degrees)")
            # riding: the horse's feet under the player at a canter and a gallop
            r = await ev(page, "(() => { const H = __hm, P = H.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 40, 1); P.x = P.prevX = Ln.x - Ln.ux * 19; P.z = P.prevZ = Ln.z - Ln.uz * 19; P.y = MO.F.heightAt(P.x, P.z); P.yaw = Math.atan2(Ln.ux, Ln.uz); MO.F.mountUp(P, true); H.simulate(0.3, 1/60); const r = MO.playerPath([{ x: Ln.x + Ln.ux * 19, z: Ln.z + Ln.uz * 19 }], 3.0, { horse: true, sprint: true, steady: true }); MO.F.dismount(P); return r; })()")
            report('ridden', r, [0, 0]); res['player_ride'] = r
            # swimming: strokes against speed (how far a stroke carries the body)
            r = await ev(page, "(() => { const H = __hm, P = H.GAME.player, W = H.water; let best = null; for (const L of H.dbg.LAKES) { if (L.x > 900) continue; const w = W.waterAt(L.x, L.z); if (w && w.depth > 2.5 && (!best || L.r > best.r)) best = L; } if (!best) return { err: 'no lake' }; P.x = P.prevX = best.x; P.z = P.prevZ = best.z; P.y = W.waterAt(best.x, best.z).y - 1.2; H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.keys.add('KeyW'); H.simulate(1.5, 1/60); const ph0 = P.swimPh, x0 = P.x, z0 = P.z; H.simulate(3, 1/60); const d = Math.hypot(P.x - x0, P.z - z0), strokes = (P.swimPh - ph0) / (2 * Math.PI); H.INPUT.keys.clear(); return { v: +(d / 3).toFixed(2), strokesPerS: +(strokes / 3).toFixed(2), perStroke: +(d / Math.max(strokes, 0.01)).toFixed(2), swim: !!P.swim }; })()")
            print('  swimmer   ', json.dumps(r), flush=True); res['swim'] = r
        if 'pose' in ONLY:
            for act, name in ((12, 'kneel'), (13, 'crouch')):
                r = await ev(page, f"MO.pose({act}, 1.6)")
                print(f'  {name:10s} feet over the floor (cm) {r.get("feet")}  knees {r.get("knees")}', flush=True); res[name] = r
        if 'dragon' in ONLY:
            # Cinderwing: on its circuit, taking off from a perch, coming in to land (its bones read directly)
            for how, sec in (('fly', 14), ('takeoff', 7), ('land', 13)):
                r = await ev(page, f"(() => {{ const r = __hm.motion.motionDragon('{how}', {sec}); return r; }})()")
                tr = r.pop('trace', [])
                print(f'  dragon {how:8s}', json.dumps(r), flush=True)
                print('     trace (t, state, y, speed, left tip y):', json.dumps(tr[::2])[:900], flush=True)
                res['dragon_' + how] = {**r, 'trace': tr}
            d = res['dragon_fly']
            check(d['beatsPerS'] > 0.2 and d['tipTravel'] > 1.5, f"Cinderwing beats its wings in flight ({d['beatsPerS']} beats/s, a tip travels {d['tipTravel']} m)")
            check(d['head'] > 0.3 and d['tail'] > 0.3, f"its head and tail move as it flies (head {d['head']} m, tail tip {d['tail']} m)")
            for how in ('takeoff', 'land'):
                d = res['dragon_' + how]
                check(d['maxAcc'] < 12, f"{how}: no jump in its airspeed (hardest change {d['maxAcc']} m/s each second)")
            d = res['dragon_land']
            check(d['feetLow'] is not None and d['feetLow'] > -0.15 and d['feetHigh'] < 0.25, f"landed, its feet stand on the ground (lowest {d['feetLow']} m, highest of the lowest {d['feetHigh']} m)")
        if 'shots' in ONLY:
            await page.set_viewport_size({'width': 960, 'height': 540})
            await ev(page, SHOTJS)
            await ev(page, "(() => { __hm.setTod(0.42); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.snowing = 0; W.snow = 0; W.overcast = 0; W.target = 0; MO.calm(); return 0; })()")
            # a cock pheasant bursting up, then on set wings
            await shot(page, 'motion_pheasant_rise', "(() => { const e = MS.bird('pheasant'); MS.ph = e.id; MS.flush(e, 0.45); MS.side(e, 2.4, 1.2, 0.2, 1.2); return 0; })()")
            await shot(page, 'motion_pheasant_beat', "(() => { const e = MS.F.getEnt(MS.ph); MS.more(0.4); MS.side(e, 1.8, 1.9, 0.0, 2.2); return 0; })()")
            await shot(page, 'motion_pheasant_glide', "(() => { const e = MS.F.getEnt(MS.ph); for (let k = 0; k < 400 && !(e.bird.fly && e.bird.fly.mode === 'glide' && e.bird.fly.mt > 0.4); k++) MS.more(1 / 60); MS.side(e, 1.6, 2.0, 0.0, 2.4); return 0; })()")
            # a mallard running across the water to take off
            await shot(page, 'motion_duck_run', "(() => { const e = MS.bird('duck'); if (!e) return 0; MS.dk = e.id; MS.flush(e, 0.3); MS.side(e, 2.0, 1.4, 0.1, 1.6); return 0; })()")
            await shot(page, 'motion_duck_beat', "(() => { const e = MS.F.getEnt(MS.dk); if (!e) return 0; MS.more(0.9); MS.side(e, 1.8, 1.9, 0.0, 2.2); return 0; })()")
            # Cinderwing rearing to take off, springing on the first downstroke, flying, legs reaching to land
            await shot(page, 'motion_dragon_rear', "(() => { const e = MS.dragon('takeoff', 0.4); MS.side(e, 17, 3.5, 3.0, 4); return 0; })()")
            await shot(page, 'motion_dragon_spring', "(() => { const D = __hm.dbg.DRAGON; const e = MS.dragonUntil((D) => D.stateT > 0.85, 3); MS.side(e, 19, 3.5, 3.5, 5); return 0; })()")
            await shot(page, 'motion_dragon_fly', "(() => { const e = MS.dragon('fly', 3.2); MS.side(e, 24, 2, 2.5, 6); return 0; })()")
            await shot(page, 'motion_dragon_land', "(() => { MS.dragon('land', 0.1); const e = MS.dragonUntil((D) => D.state === 'descend' && D.stateT > 3.0, 30); MS.side(e, 19, 2.5, 3.0, 4); return 0; })()")
            # a runner mid-stride and a kneeling priest
            await shot(page, 'motion_runner', "(() => { const Ln = MO.lane(MO.cx, MO.cz, 20, 1); const e = MO.body('human', Ln.x - Ln.ux * 8, Ln.z - Ln.uz * 8, Math.atan2(Ln.ux, Ln.uz)); MO.M.motionRun([{ e, kind: 'human', drive(e, t, dt) { e.x += Ln.ux * 5 * dt; e.z += Ln.uz * 5 * dt; } }], 1.1, 1 / 60); MS.side(e, 3.0, 0.9, 0.8, 0.2); MS.run = e.id; return 0; })()")
            await shot(page, 'motion_kneel', "(() => { MO.clear(); const Ln = MO.lane(MO.cx, MO.cz, 4, 1); const e = MO.body('human', Ln.x, Ln.z, 0.6); e.anim.act = 12; e.anim.actT = 0.6; e.anim.actDur = 3; MO.M.motionRun([{ e, kind: 'human' }], 0.4, 1 / 60); MS.side(e, 2.6, 0.7, 0.5, -0.6); return 0; })()")
            await ev(page, "MO.clear(); 0")
        pathlib.Path(OUT + f'motion_{TAG}.json').write_text(json.dumps({'rows': ROWS, 'res': res}, indent=1))
        # the worst offenders
        bad = sorted([r for r in ROWS if 'err' not in r], key=lambda r: -score(r))
        print('worst:', flush=True)
        for r in bad[:14]: print(f"  {r['case']:10s} {r['want']:4.1f} m/s  slide {r['slideMax']} cm  slipK {r['slipK']}  lift {r['lift']} cm  lowest foot p5 {r['low5']} cm (min {r['lowMin']})  steps/s {r['steps']}", flush=True)
        errs = await ev(page, "__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l for l in logs), 'every shader compiles ' + str([l for l in logs if 'Shader Error' in l][:1])[:300])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
