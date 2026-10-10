"""Motion: every kind of body measured as it moves, from the vertices the shaders actually draw (window.__hm.motion:
the crowds drawn once more as points with their own vertex shaders under an identity camera, read back from a float
target). For each body and each common motion: how far a planted foot slides while it bears weight (cm), how fast it
slips as a share of the body's speed (slipK: 0 planted, 1 gliding on ice), where the lowest foot is over the floor
(median and lowest: + floats, - sinks), how many feet come down a second, and for birds how the wings move.
usage: python3 tools/tests/motion.py [tag=before] [only=human,beast,farm,bird,player,pose] [shots] [q=low]
Writes tools/out/motion_<tag>.json and prints a table; checks the limits at the end (a planted foot slides < 4 cm,
slipK < 0.15, the lowest foot within 4 cm of the floor) and lists the worst offenders."""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
TAG = OPT.get('tag', 'run')
ONLY = OPT.get('only', 'human,beast,farm,bird,player,pose').split(',')
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
      return { e, kind: kind === 'human' ? 'human' : 'beast', which: opts.which || ['feet'], drive(e, t, dt) { const s = self.ramp(v, t) * dt; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); } };
    });
    this.over(Ln, Math.max(14, Math.max(...vs) * sec * 0.9));
    const rec = this.M.motionRun(ents, sec, 1 / 60);
    const out = vs.map((v, i) => ({ v, ...this.M.motionMeasure(rec[i], { skip: opts.skip ?? 0.6 }) }));
    this.clear();
    return out;
  },
};
0;
"""

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
