"""[motion3] Gaits as living bodies move them, checked by number (the full table is tools/tests/motion.py):
the footfalls of a horse's walk (four even beats, each hind foot followed by the fore on its own side), trot (diagonal
pairs together) and gallop (hind right, hind left, fore right, fore left, the fore right down before the hind left
lifts, then the one suspension, gathered); no foot moving over the ground while it is near it, at the lift-off and
the touchdown as in the stance (every beast at a walk and a trot, people walking and running); a person up a keep's
stair with no foot in a tread or a riser, swinging or standing; shoves and cuts held run after run; and the foot lock
for a crowd: every body near the camera gets its row, past the 256 of version 11, and what it costs.
usage: python3 tools/tests/gaits.py [only=feet,falls,stair,shove,crowd] [reps=3]"""
import json, asyncio, sys, pathlib, time, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT.get('only', 'falls,feet,stair,shove,crowd').split(',')
REPS = int(OPT.get('reps', 3))
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

# the helpers of motion.py (MO: lanes, bodies, straight runs, shoves, cuts)
SRC = (pathlib.Path(__file__).parent / 'motion.py').read_text()
HELP = re.search(r'HELP = r"""(.*?)"""', SRC, re.S).group(1)

GJS = r"""
window.GT = {
  // a body driven straight at v: per frame each foot's [x, height over the floor, z] (from what the shader draws)
  trace(kind, v, sec = 2.6) {
    const M = __hm.motion, P = __hm.GAME.player, Ln = MO.lane(MO.cx, MO.cz, v * sec + 4, 1);
    P.x = P.prevX = Ln.x - Ln.sx * 12; P.z = P.prevZ = Ln.z - Ln.sz * 12;
    const L0 = v * sec / 2, e = MO.body(kind, Ln.x - Ln.ux * L0, Ln.z - Ln.uz * L0, Math.atan2(Ln.ux, Ln.uz));
    MO.over(Ln, 14);
    const rec = M.motionRun([{ e, kind: kind === 'human' ? 'human' : 'beast', which: ['feet'], drive(e, t, dt) { const s = MO.ramp(v, t) * dt; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); } }], sec, 1 / 60)[0];
    MO.clear();
    return rec.filter((s) => s.t >= 0.6 && s.L && s.L.feet).map((s) => ({ t: s.t, x: s.x, z: s.z, feet: s.L.feet.map((p) => p ? [p[0], p[3] - M.motionFloor(p[0], p[2], s.y), p[2]] : null) }));
  },
  // the order the feet come down in and what bears the body, over whole cycles (a foot is down within 1.5 cm of its floor
  // above its lowest: hooves and paws sit a little over or into it at rest)
  falls(kind, v) {
    const S = this.trace(kind, v, 3.2), nf = S[0].feet.length, base = [];
    for (let f = 0; f < nf; f++) base.push(Math.min(...S.map((s) => s.feet[f] ? s.feet[f][1] : 9)));
    const down = S.map((s) => s.feet.map((p, f) => p && p[1] < base[f] + 0.015));
    const order = [];
    for (let i = 1; i < down.length; i++) for (let f = 0; f < nf; f++) if (down[i][f] && !down[i - 1][f]) order.push([+S[i].t.toFixed(3), f]);
    return { order, down: down.map((d) => d.map((x) => (x ? 1 : 0)).join('')), dt: 1 / 60 };
  },
  // a foot near the ground (within 4 cm) and not in its stance: how far it moves over the ground (a skate at lift-off or
  // touchdown), and the largest such move
  skate(kind, v) {
    const S = this.trace(kind, v, 2.6), nf = S[0].feet.length;
    let worst = 0, sum = 0, n = 0;
    for (let f = 0; f < nf; f++) {
      // (near its own floor: within 4 cm of where it stands, a hoof that sits into the ground or a paw over it at rest
      // counted from there)
      const base = Math.min(...S.map((s) => s.feet[f] ? s.feet[f][1] : 9));
      let run = [];
      const close = () => { if (run.length >= 2) { const a = run[0], b = run[run.length - 1], d = Math.hypot(b[0] - a[0], b[2] - a[2]); worst = Math.max(worst, d); sum += d; n++; } run = []; };
      for (let i = 1; i < S.length; i++) {
        const p = S[i].feet[f], q = S[i - 1].feet[f];
        if (!p || !q) { close(); continue; }
        if (p[1] < base + 0.04) run.push(p); else close();
      }
      close();
    }
    return { worst: +(worst * 100).toFixed(1), mean: +(n ? sum / n * 100 : 0).toFixed(2), n };
  },
};
0;
"""

async def ev(page, js):
    return await page.evaluate(js)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text[:300]}') if m.type == 'error' else None)
        await ev(page, "window.requestAnimationFrame = () => 0; __hm.fn.setQuality('low'); __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.setTod(0.45); 0")
        await ev(page, HELP)
        await ev(page, GJS)
        await ev(page, "(() => { MO.quiet(); MO.calm(); const R = __hm.REALMS[0], S = R.musterSite, a = Math.atan2(S.x, S.z); MO.cx = S.x + Math.sin(a) * 40; MO.cz = S.z + Math.cos(a) * 40; __hm.simulate(1); return 0; })()")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        if 'falls' in ONLY:
            names = ['FL', 'FR', 'HL', 'HR']
            # the walk: four beats, each hind foot followed by the fore on its own side, about a quarter cycle apart
            r = await ev(page, "GT.falls('horse', 1.8)")
            seq = [names[f] for t, f in r['order']]
            print('  walk footfalls', seq, flush=True)
            pairs = list(zip(seq, seq[1:]))
            check(len(seq) >= 4 and all(b == {'HL': 'FL', 'FL': 'HR', 'HR': 'FR', 'FR': 'HL'}[a] for a, b in pairs), f"a horse's walk is the lateral sequence, hind left, fore left, hind right, fore right ({' '.join(seq)})")
            ts = [t for t, f in r['order']]
            gaps = [round(b - a, 3) for a, b in zip(ts, ts[1:])]
            check(gaps and max(gaps) < 1.6 * min(gaps), f"its four beats are even (between footfalls {gaps} s)")
            # the trot: diagonal pairs come down together
            r = await ev(page, "GT.falls('horse', 4.5)")
            byT = {}
            for t, f in r['order']: byT.setdefault(round(t * 60), []).append(names[f])
            groups = [sorted(v) for k, v in sorted(byT.items())]
            print('  trot footfalls', groups, flush=True)
            check(groups and all(g in (['FL', 'HR'], ['FR', 'HL']) for g in groups), f"a horse's trot comes down in diagonal pairs ({groups})")
            # the gallop: hind right, hind left, fore right, fore left; the fore right down before the hind left lifts;
            # then all four in the air once a stride (the gathered leap), never between the hind and the fore
            r = await ev(page, "GT.falls('horse', 11)")
            seq = [names[f] for t, f in r['order']]
            print('  gallop footfalls', seq, flush=True)
            cyc = 'HR HL FR FL'.split()
            i0 = seq.index('HR') if 'HR' in seq else 0
            ok = len(seq) >= 8 and all(seq[i0 + k] == cyc[k % 4] for k in range(min(8, len(seq) - i0)))
            check(ok, f"a horse's gallop comes down hind right, hind left, fore right, fore left ({' '.join(seq)})")
            D = r['down']
            # suspensions: runs of '0000'; each must come after a fore foot lifts (the fore left), not after the hind left
            sus, prev = [], None
            for i, d in enumerate(D):
                if d == '0000' and (i == 0 or D[i - 1] != '0000'): sus.append(i)
            after = [D[i - 1] for i in sus if i > 0]
            print('  gallop: frames before each leap', after, flush=True)
            check(sus and all(a[2] == '0' and a[3] == '0' and (a[0] == '1' or a[1] == '1') for a in after), f"its one leap a stride follows the fore feet, the hind feet already up (no leap between the hind and the fore: {after})")
        if 'feet' in ONLY:
            # no foot moves over the ground while it is near it: the lift-off and the touchdown included (a walker's toe
            # skims low through the swing as a real one does: people at a run only; a walker's planted feet are
            # motion.py's)
            worst = []
            for kind, vs in (('horse', [1.8, 4.5, 11]), ('wolf', [1.5, 3.2]), ('deer', [1.5]), ('sheep', [1.1, 2.6]), ('cattle', [1.0, 2.2]), ('pig', [2.4, 4.5]), ('boar', [3.0]), ('bear', [1.5, 3.2]), ('hound', [3.6]), ('human', [3.2, 5.0])):
                for v in vs:
                    r = await ev(page, f"GT.skate('{kind}', {v})")
                    worst.append((r['worst'], kind, v))
                    print(f"  {kind:7s} {v:4.1f} m/s: a foot near the ground moves at most {r['worst']} cm (mean {r['mean']} cm, {r['n']} spans)", flush=True)
            worst.sort(reverse=True)
            check(worst[0][0] <= 1.5, f"no foot near the ground skates (the worst: {worst[0][1]} at {worst[0][2]} m/s, {worst[0][0]} cm)")
        if 'stair' in ONLY:
            # up a keep's stair at a walk and at a run: every foot over the tread under it, swinging or standing
            for name, joy in (('walk', 0.4), ('run', 1.0)):
                r = await ev(page, f"""(() => {{
                  const H = __hm, M = H.motion, K = H.WAR.keeps.find((K) => K.orig === 0 && K.site === H.REALMS[0].keepSites[0]), S = K.site, P = H.GAME.player, w = (lx, lz) => H.fn.siteToWorld(S, lx, lz);
                  const a = w(10.6, -7.6); P.x = P.prevX = a.x; P.z = P.prevZ = a.z; P.y = S.y; P.faction = 0; P.onGround = true; P.vy = 0; H.simulate(0.3, 1 / 60);
                  const pts = [w(13.0, -6.6), w(13.0, 3.4)]; H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.joy = {{ dx: 0, dy: -{joy} }};
                  let k = 0; const E = {{ e: P, kind: 'human', which: ['feet'], drive(e) {{ while (k < pts.length - 1 && Math.hypot(pts[k].x - e.x, pts[k].z - e.z) < 0.45) k++; H.CAM.yaw = Math.atan2(pts[k].x - e.x, pts[k].z - e.z); }} }};
                  const rec = M.motionRun([E], {6.0 if joy < 1 else 3.0}, 1 / 60, {{ cam: () => {{ H.UI.modal = null; MO.chase(P); }} }})[0];
                  H.INPUT.joy = null;
                  // the tread under a point, worked out from the flights themselves (as motion_tread.js does)
                  const flights = []; for (const C of H.fn.castles()) for (const f of C.floors || []) if (f.flight && f.type === 'box' && f.yb !== f.ya) flights.push(f);
                  const tread = (x, z, y) => {{ const g = M.motionFloor(x, z, y); for (const f of flights) {{ const dx = x - f.x, dz = z - f.z, lx = dx * f.cos - dz * f.sin, lz = dx * f.sin + dz * f.cos; if (lx < -f.hx || lx > f.hx || lz < -f.hz || lz > f.hz) continue; const frac = (lz + f.hz) / (2 * f.hz), t = f.ya + (f.yb - f.ya) * frac; if (g < t - 0.02 || g > t + 0.3) continue; const n = Math.max(2, Math.round((f.flight.y1 - f.flight.y0) / 0.27)); return f.ya + (f.yb - f.ya) * Math.min(n, Math.floor(frac * n + 1e-6) + 1) / n; }} return g; }};
                  const y0 = rec[0].y, hs = [];
                  for (const s of rec) {{ if (s.t < 0.4 || !s.L || !s.L.feet || s.y > y0 + 6.1) continue; for (const p of s.L.feet) if (p) hs.push(p[3] - tread(p[0], p[2], s.y)); }}
                  hs.sort((a, b) => a - b);
                  return {{ n: hs.length, rise: +(rec[rec.length - 1].y - y0).toFixed(2), lowest: +(hs[0] * 100).toFixed(1), p1: +(hs[Math.floor(hs.length * 0.01)] * 100).toFixed(1), p5: +(hs[Math.floor(hs.length * 0.05)] * 100).toFixed(1) }};
                }})()""")
                print(f"  stair {name}: {json.dumps(r)}", flush=True)
                check(r['n'] > 50 and r['rise'] > 5 and r['lowest'] > -2.0, f"up a keep's stair at a {name} no foot is in a tread or a riser (the lowest {r['lowest']} cm under its tread, 1% {r['p1']} cm; {r['rise']} m climbed)")
        if 'shove' in ONLY:
            # shoves and cuts, run after run: the worst stance of every run
            for name, js, lim in (("a horse trotting shoved sideways", "MO.shove('horse', 3.0, 0.8)", 4.0), ("a wolf trotting shoved sideways", "MO.shove('wolf', 3.0, 0.8)", 4.0),
                                  ("a person walking shoved sideways", "MO.shove('human', 1.4, 0.8)", 7.0), ("a person standing shoved sideways", "MO.shove('human', 0, 0.6)", 2.0),
                                  ("the player cutting 46 degrees at a sprint", "MO.cut(0.8, true)", 6.0), ("the player cutting 92 degrees at a sprint", "MO.cut(1.6, true)", 8.0), ("the player cutting 46 degrees at a run", "MO.cut(0.8, false)", 6.0)):
                vals = []
                for k in range(REPS):
                    r = await ev(page, js)
                    vals.append(r.get('slideMax', 99))
                print(f"  {name}: worst stance {vals} cm", flush=True)
                check(max(vals) <= lim, f"{name}: every run's worst stance under {lim} cm ({vals})")
        if 'crowd' in ONLY:
            # the foot lock for a crowd: 400 soldiers walking about within 40 m of the camera, all of them drawn with their
            # feet held (version 11 held 256), and what it costs a step and a frame
            r = await ev(page, """(() => {
              const H = __hm, F = H.fn, M = H.motion, P = H.GAME.player, Ln = MO.lane(MO.cx, MO.cz, 30, 1), made = [];
              for (let i = 0; i < 400; i++) { const a = i * 2.39996, d = 3 + Math.sqrt(i) * 1.9; const e = F.spawnRealmUnit(0, 'warrior', 10, 'test', Ln.x + Math.sin(a) * d, Ln.z + Math.cos(a) * d); e.role = 'test'; e.yaw = a; made.push(e); }
              H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(Ln.x, F.heightAt(Ln.x, Ln.z) + 60, Ln.z - 1); H.camera.lookAt(Ln.x, F.heightAt(Ln.x, Ln.z), Ln.z); H.camera.updateMatrixWorld();
              const FL = H.footLock.FOOT_LOCK; let rows = 0, steps = 0, draws = 0, ts = 0, td = 0;
              for (let k = 0; k < 90; k++) {
                for (const e of made) { e.x += Math.sin(e.yaw) * 1.3 / 60; e.z += Math.cos(e.yaw) * 1.3 / 60; }
                let t0 = performance.now(); H.simulate(1 / 60, 1 / 60); ts += performance.now() - t0;
                t0 = performance.now(); M.motionDraw(); td += performance.now() - t0;
                rows = Math.max(rows, FL.n);
              }
              const near = made.filter((e) => Math.hypot(e.x - H.camera.position.x, e.z - H.camera.position.z) < 75).length;
              // the lock's own share: footLockStep for every one of them, and footLockSlot as drawn
              let t0 = performance.now(); for (let k = 0; k < 20; k++) for (const e of made) H.footLock.footLockStep(e, 1 / 60); const tStep = (performance.now() - t0) / 20;
              for (const e of made) F.removeEnt(e);
              return { made: made.length, near, rows, H: FL.H, stepMs: +(ts / 90).toFixed(1), drawMs: +(td / 90).toFixed(1), lockStepMs: +tStep.toFixed(2) };
            })()""")
            print(f"  crowd: {json.dumps(r)}", flush=True)
            check(r['rows'] > 256 and r['rows'] < r['H'], f"every body near the camera that needs it has its feet held ({r['rows']} rows a frame for {r['near']} bodies within reach of {r['made']}, of {r['H']}: a body walking straight on needs none; version 11 stopped at 256)")
            check(r['lockStepMs'] < 6, f"the lock for 400 bodies costs {r['lockStepMs']} ms a step of JS here (the whole step {r['stepMs']} ms, the crowds' fill {r['drawMs']} ms)")
        errs = await ev(page, "__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l for l in logs), 'every shader compiles')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
