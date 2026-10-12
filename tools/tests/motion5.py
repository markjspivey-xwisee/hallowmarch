"""[motion5] Bodies move like living things in what versions 14 and 15 added and in what was still off (version 16),
measured from what the shaders draw (13r_motion.js's probe):
  birds: a hen, a cock pheasant and a mallard walking and running: each planted foot holds (its worst stance, cm, by
    motion.py's own measure and by one scaled to a bird's leg: in contact within 1.5 cm), no foot moving over the ground
    while it is near it (within 1.2 cm), the feet on the ground (the lowest, p5 and least), how high a foot lifts, and the
    head-bob: the share of each step a hen's or a pheasant's beak holds still in the air (its speed along the way under a
    quarter of the body's) and how fast it thrusts
  gallop: a horse at 11 and 13 m/s: the share of the stride all four feet are off the ground (a real horse's gallop
    has one short suspension, about a fifth of the stride or less at a canter-gallop), the duty, the planted feet
usage: python3 tools/tests/motion5.py [only=birds,gallop,...] [tag=run] [q=low]
Writes tools/out/motion5_<tag>.json."""
import json, asyncio, sys, pathlib, time, re
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT.get('only', 'birds,gallop').split(',')
TAG = OPT.get('tag', 'run')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

SRC = (pathlib.Path(__file__).parent / 'motion.py').read_text()
HELP = re.search(r'HELP = r"""(.*?)"""', SRC, re.S).group(1)

M5JS = r"""
window.AC5 = {
  // each foot near the ground (within 4 cm of the floor under it): how far it moves over the ground while it stays that
  // near, the worst such stretch (cm) (actions.py's skate)
  skate(R, from = 0, to = 99) {
    const M = __hm.motion, S = R.filter((s) => s.t >= from && s.t <= to && s.L && s.L.feet); let worst = 0;
    for (let f = 0; f < 2; f++) {
      let run = [];
      const close = () => { if (run.length >= 2) { const a = run[0], b = run[run.length - 1]; worst = Math.max(worst, Math.hypot(b[0] - a[0], b[2] - a[2])); } run = []; };
      for (const s of S) { const p = s.L.feet[f]; if (!p) { close(); continue; } const h = p[3] - M.motionFloor(p[0], p[2], s.y); if (h < 0.04) run.push(p); else close(); }
      close();
    }
    return +(worst * 100).toFixed(1);
  },
};
window.M5 = {
  // a body driven straight at v (sec s): every frame, the parts asked for, from what the shader draws
  run(kind, v, sec = 2.6, which = ['feet']) {
    const M = __hm.motion, P = __hm.GAME.player, Ln = MO.lane(MO.cx, MO.cz, v * sec + 4, 1);
    P.x = P.prevX = Ln.x - Ln.sx * 12; P.z = P.prevZ = Ln.z - Ln.sz * 12;
    const L0 = v * sec / 2, e = MO.body(kind, Ln.x - Ln.ux * L0, Ln.z - Ln.uz * L0, Math.atan2(Ln.ux, Ln.uz));
    MO.over(Ln, 10);
    const rec = M.motionRun([{ e, kind: kind === 'human' ? 'human' : 'beast', which, drive(e, t, dt) { const s = MO.ramp(v, t) * dt; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); } }], sec, 1 / 60)[0];
    MO.clear();
    return { rec, Ln };
  },
  // a bird's walk: motion.py's measure (4 cm contact) and one scaled to its leg (1.5 cm); near-ground skating; the head
  bird(kind, v, sec = 2.6) {
    const M = __hm.motion, { rec, Ln } = this.run(kind, v, sec, ['feet', 'head']);
    const a = M.motionMeasure(rec, { skip: 0.6 }), b = M.motionMeasure(rec, { skip: 0.6, contact: 0.015 });
    const S = rec.filter((s) => s.t >= 0.6 && s.L && s.L.feet);
    // a foot within 1.2 cm of its lowest: how far it moves over the ground while it stays that near
    let worst = 0;
    for (let f = 0; f < 2; f++) {
      const hs = S.map((s) => (s.L.feet[f] ? s.L.feet[f][3] - M.motionFloor(s.L.feet[f][0], s.L.feet[f][2], s.y) : 9)), base = Math.min(...hs);
      let run = [];
      const close = () => { if (run.length >= 2) { const p = run[0], q = run[run.length - 1]; worst = Math.max(worst, Math.hypot(q[0] - p[0], q[2] - p[2])); } run = []; };
      for (let i = 0; i < S.length; i++) { if (hs[i] < base + 0.012) run.push(S[i].L.feet[f]); else close(); }
      close();
    }
    // the head along the way: its speed against the body's
    const hv = [];
    for (let i = 1; i < S.length; i++) { const h = S[i].L.head && S[i].L.head[0], g = S[i - 1].L.head && S[i - 1].L.head[0]; if (!h || !g) continue; hv.push(((h[0] - g[0]) * Ln.ux + (h[2] - g[2]) * Ln.uz) * 60 / Math.max(v, 0.01)); }
    hv.sort((x, y) => x - y);
    const hold = hv.length ? hv.filter((x) => x < 0.25).length / hv.length : null;
    return { v, slide4: a.slideMax, slide15: b.slideMax, slip15: b.slipK, skate12: +(worst * 100).toFixed(2), lift: a.lift, lift15: b.lift, low5: a.low5, lowMin: a.lowMin, steps: a.steps, stance15: b.stanceShare,
      headHold: hold === null ? null : +hold.toFixed(2), headMax: hv.length ? +hv[hv.length - 1].toFixed(2) : null, headMin: hv.length ? +hv[0].toFixed(2) : null };
  },
  // a beast's footfalls: per frame which feet are down (within 1.5 cm of their lowest), the share of the stride with none
  // down (the suspension), each foot's share down (the duty), its worst stance
  falls(kind, v, sec = 3.2) {
    const M = __hm.motion, { rec } = this.run(kind, v, sec, ['feet']);
    const S = rec.filter((s) => s.t >= 0.8 && s.L && s.L.feet), nf = S[0].L.feet.length, base = [];
    for (let f = 0; f < nf; f++) base.push(Math.min(...S.map((s) => (s.L.feet[f] ? s.L.feet[f][3] - M.motionFloor(s.L.feet[f][0], s.L.feet[f][2], s.y) : 9))));
    const down = S.map((s) => s.L.feet.map((p, f) => p && p[3] - M.motionFloor(p[0], p[2], s.y) < base[f] + 0.015));
    const none = down.filter((d) => !d.some((x) => x)).length / down.length;
    const duty = [0, 1, 2, 3].slice(0, nf).map((f) => +(down.filter((d) => d[f]).length / down.length).toFixed(2));
    // the longest run of frames with no foot down, in seconds and as a share of the stride (the stride from the hind
    // right's footfalls)
    let best = 0, cur = 0;
    for (const d of down) { if (!d.some((x) => x)) { cur++; best = Math.max(best, cur); } else cur = 0; }
    const fallsHR = []; for (let i = 1; i < down.length; i++) if (down[i][3] && !down[i - 1][3]) fallsHR.push(S[i].t);
    const stride = fallsHR.length > 1 ? (fallsHR[fallsHR.length - 1] - fallsHR[0]) / (fallsHR.length - 1) : null;
    const m = M.motionMeasure(rec, { skip: 0.8 });
    return { v, none: +none.toFixed(3), leap: +(best / 60).toFixed(3), stride: stride && +stride.toFixed(3), leapShare: stride ? +((best / 60) / stride).toFixed(2) : null, duty, slide: m.slideMax, low5: m.low5, lowMin: m.lowMin, lift: m.lift };
  },
  // [motion5] a Logres corner tower brought down (siege2.py's storm: no garrison, no lord), then the player walked (joy) from
  // the field over the rubble into the store room: each planted foot's lowest point against the stone drawn under it
  breach() {
    const H = __hm, F = H.fn, K = H.WAR.keeps.find((K) => K.orig === 0 && K.site === H.REALMS[0].keepSites[1]), C = F.castleOf(K.site);
    const W = C.sections.find((W) => W.kind === 'tower' && W.T.role === 'corner' && W.T.sx === -1 && W.T.sz === 1);
    for (const id of [...K.guards]) { const g = F.getEnt(id); if (g) F.removeEnt(g); } K.guards.clear(); K.nextGuardAt = 1e9;
    const Lr = F.getEnt(K.lord); if (Lr) F.removeEnt(Lr); K.lord = null;
    const T = W.T, src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', K.site.x + W.ox * 70, K.site.z + W.oz * 70, {}); src.role = 'dummy';
    for (let n = 0; n < 80 && W.state === 'whole'; n++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4);
    F.removeEnt(src); K.lastEnemyNear = H.GAME.t; H.simulate(0.5);
    this.W = W; this.K = K;
    return { state: W.state };
  },
  // [motion5] a builder at a house being built back (look4: a Logres house brought down by stones, behind its scaffold):
  // hammering (action 23) at its work spot, the mallet's head against the wall's face before it, the feet standing
  hammer(n = 0) {
    const H = __hm, F = H.fn, M = H.motion, Rb = H.rubble, sim = (s) => { const m = H.UI.modal; H.UI.modal = null; H.simulate(s); H.UI.modal = m; };
    const S = H.REALMS[0].town, hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && (h.state === 'whole' || h.state === 'scaffold'));
    hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z));
    const Hh = hs[n] || hs[0];
    if (Hh.state === 'whole') { H.batter.houseBreak(Hh, null); sim(0.5); Hh.stT = 1e4; sim(0.3); }
    Hh.stT = 70 * 0.3; sim(0.1);
    const sp = Rb.houseScafWorkSpot(Hh, 1); if (!sp) return { err: 'no spot', state: Hh.state };
    const yaw = Math.atan2(sp.fx - sp.x, sp.fz - sp.z), fx = Math.sin(yaw), fz = Math.cos(yaw);
    const P = H.GAME.player; P.x = P.prevX = sp.x + fz * 6; P.z = P.prevZ = sp.z - fx * 6;
    const e = MO.body('human', sp.x, sp.z, yaw); e.y = F.floorAt(e.x, e.z, e.y + 1); sim(0.1);
    const W = H.walls, wallAt = (y) => { const R = W.shotHit(e.x, e.y + y, e.z, e.x + fx * 3, e.y + y, e.z + fz * 3, { ground: false }); return R ? +(R.t * 3).toFixed(3) : null; };
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(e.x + fz * 4, e.y + 2, e.z - fx * 4); H.camera.lookAt(e.x, e.y + 1, e.z); H.camera.updateMatrixWorld();
    let n0 = 0;
    const rec = M.motionRun([{ e, kind: 'human', which: ['tool', 'feet', 'hands'], drive(e) { e.yaw = yaw; e._hamUntil = 1e9; if (!(e.anim.act === 23 && e.anim.actT < e.anim.actDur * 0.97)) { e.anim.act = 23; e.anim.actT = 0; e.anim.actDur = 1.05; n0++; } } }], 2.4, 1 / 60)[0];
    // the mallet's farthest point along the facing, each frame; the blow: the frame it is farthest
    let best = { d: -9 };
    for (const s of rec) { if (!s.L || !s.L.tool || s.t < 0.3) continue; for (const p of s.L.tool) if (p) { const d = (p[0] - e.x) * fx + (p[2] - e.z) * fz; if (d > best.d) best = { d, y: p[1] - e.y, t: s.t }; } }
    const wall = best.d > -9 ? wallAt(best.y) : null, wall12 = wallAt(1.2);
    const skate = AC5.skate(rec, 0.2, 2.4);
    MO.clear();
    return { house: Hh.style, spot: +Math.hypot(sp.x - sp.fx, sp.z - sp.fz).toFixed(2), blows: n0, reach: +best.d.toFixed(3), hitY: best.y !== undefined ? +best.y.toFixed(2) : null, wall, wall12, gap: wall !== null ? +((wall - best.d) * 100).toFixed(1) : null, skate, toolSeen: rec.filter((s) => s.L && s.L.tool && s.L.tool.some((p) => p)).length };
  },
  rubble(joy, off) {
    const H = __hm, F = H.fn, M = H.motion, P = H.GAME.player, W = this.W, R5 = H.motion5;
    R5.RUBHF.off = !!off; this.K.lastEnemyNear = H.GAME.t;
    const Rt = H.siege2.siegeStormRoute(W), pts = [Rt[0], Rt[1], Rt[2]];
    P.x = P.prevX = pts[0].x; P.z = P.prevZ = pts[0].z; P.y = F.floorAt(P.x, P.z, 50); P.onGround = true; P.vy = 0; P.faction = 0; P.hp = P.maxHp = 1e7; P.motion = null;
    H.simulate(0.3, 1 / 60);
    H.UI.modal = null; H.INPUT.keys.clear(); H.INPUT.joy = { dx: 0, dy: -joy };
    let k = 0, arrived = false, tA = 99;
    const E = { e: P, kind: 'human', which: ['feet'], drive(e, t) { while (k < pts.length - 1 && Math.hypot(pts[k].x - e.x, pts[k].z - e.z) < 0.5) k++; if (!arrived && k === pts.length - 1 && Math.hypot(pts[k].x - e.x, pts[k].z - e.z) < 0.6) { arrived = true; tA = t; H.INPUT.joy = null; } H.CAM.yaw = Math.atan2(pts[k].x - e.x, pts[k].z - e.z); } };
    const rec = M.motionRun([E], joy < 0.7 ? 7 : 4, 1 / 60, { cam: () => { H.UI.modal = null; MO.chase(P); } })[0];
    H.INPUT.joy = null;
    const dh = [];
    let onHeap = 0;
    for (let i = 1; i < rec.length; i++) {
      const s = rec[i], q = rec[i - 1];
      if (!s.L || !s.L.feet || !q.L || !q.L.feet || s.t > tA) continue; // (on the way: not standing at the end)
      for (let f = 0; f < 2; f++) {
        const p = s.L.feet[f], o = q.L.feet[f];
        if (!p || !o || Math.hypot(p[0] - o[0], p[3] - o[3], p[2] - o[2]) > 0.004) continue; // (planted: still this frame, not rising or coming down in place)
        if (R5.rubbleTopAt(p[0], p[2]) === null) continue;
        onHeap++;
        // (the stone under the sole: the highest under its heel, middle and toes, as the foot lock stands it: a foot on a
        // stone with its heel out over a gap is on the stone)
        const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw); let under = -1e9;
        for (const k of [-0.1, 0, 0.1]) { const u = R5.rubbleFootFloor(p[0] + fx * k, p[2] + fz * k, s.y + 0.25); if (u !== null && u > under) under = u; }
        dh.push(p[3] - under);
      }
    }
    dh.sort((a, b) => a - b);
    const q = (f) => dh.length ? +(dh[Math.min(dh.length - 1, Math.floor(f * dh.length))] * 100).toFixed(1) : null;
    R5.RUBHF.off = false;
    return { arrived, n: dh.length, rise: +(Math.max(...rec.map((s) => s.y)) - rec[0].y).toFixed(2), p5: q(0.05), p50: q(0.5), p95: q(0.95), lowest: q(0), highest: q(0.999), inStone: +(dh.filter((x) => x < -0.035).length / Math.max(1, dh.length)).toFixed(2), inAir: +(dh.filter((x) => x > 0.04).length / Math.max(1, dh.length)).toFixed(2), stats: { ...R5.RUBHF.stats } };
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
        await ev(page, "window.requestAnimationFrame = () => 0; __hm.fn.setQuality('" + OPT.get('q', 'low') + "'); __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.setTod(0.45); 0")
        await ev(page, HELP)
        await ev(page, M5JS)
        await ev(page, "(() => { MO.quiet(); MO.calm(); const R = __hm.REALMS[0], S = R.musterSite, a = Math.atan2(S.x, S.z); MO.cx = S.x + Math.sin(a) * 40; MO.cz = S.z + Math.cos(a) * 40; __hm.simulate(1); return 0; })()")
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        res = {}
        if 'birds' in ONLY:
            for kind, vs in (('hen', [0.15, 0.4, 0.9, 2.0]), ('pheasant', [0.3, 0.9, 2.2]), ('duck', [0.3, 0.9, 1.6])):
                rows = []
                for v in vs:
                    r = await ev(page, f"M5.bird('{kind}', {v})")
                    rows.append(r)
                    print(f"  {kind:8s} {v:4.2f} m/s: stance {r['slide4']} cm (1.5 cm contact: {r['slide15']} cm, slipK {r['slip15']}), skate {r['skate12']} cm, lift {r['lift']} / {r['lift15']} cm, lowest foot p5 {r['low5']} cm (min {r['lowMin']}), steps/s {r['steps']}, head holds {r['headHold']} of the time (its speed {r['headMin']}..{r['headMax']} x the body's)", flush=True)
                res[kind] = rows
                check(all(r['slide15'] <= 0.6 for r in rows), f"{kind}: every planted foot holds (worst stance {max(r['slide15'] for r in rows)} cm in contact within 1.5 cm; motion.py's old 4 cm, which counts a foot coming down as a stance, {max(r['slide4'] for r in rows)} cm)")
                check(all(r['skate12'] <= 0.8 for r in rows), f"{kind}: no foot moves over the ground while it is near it ({max(r['skate12'] for r in rows)} cm)")
                check(all(r['lowMin'] >= -0.6 and r['low5'] <= 1.0 for r in rows), f"{kind}: the feet stand on the ground (lowest {min(r['lowMin'] for r in rows)} cm, p5 up to {max(r['low5'] for r in rows)} cm)")
                if kind != 'duck':
                    walk = [r for r in rows if r['v'] <= 0.9 and r['v'] >= 0.3]
                    check(all(r['headHold'] is not None and r['headHold'] >= 0.4 for r in walk), f"{kind}: walking, the head holds still in the air most of each step ({[r['headHold'] for r in walk]})")
        if 'gallop' in ONLY:
            for v in (4.5, 8.0, 11.0, 13.0):
                r = await ev(page, f"M5.falls('horse', {v})")
                res[f'horse_{v}'] = r
                print(f"  horse {v:4.1f} m/s: no foot down {r['none']} of the time, the longest leap {r['leap']} s of a stride of {r['stride']} s ({r['leapShare']}), each foot down {r['duty']}, worst stance {r['slide']} cm, lowest foot p5 {r['low5']} (min {r['lowMin']}), lift {r['lift']}", flush=True)
        if 'hammer' in ONLY:
            for n in (0, 1, 2):
                r = await ev(page, f"M5.hammer({n})")
                res[f'hammer_{n}'] = r
                print(f"  hammering at a house being built back: {json.dumps(r)}", flush=True)
                if 'err' not in r:
                    check(r['wall'] is not None and abs(r['gap']) <= 6 and r['skate'] <= 2, f"a builder's mallet meets the wall's face at the blow ({r['gap']} cm short of it at {r['hitY']} m, the face {r['wall']} m off, its reach {r['reach']} m) and the feet stand ({r['skate']} cm)")
        if 'rubble' in ONLY:
            r = await ev(page, "M5.breach()")
            print(f"  a Logres corner tower brought down: {r}", flush=True)
            for name, joy in (('walk', 0.45), ('run', 1.0)):
                for off in (True, False):
                    r = await ev(page, f"M5.rubble({joy}, {'true' if off else 'false'})")
                    res[f'rubble_{name}_{"ramp" if off else "stones"}'] = r
                    print(f"  over the rubble at a {name}, the feet on {'the ramps (as before)' if off else 'the stones'}: planted feet over the stone drawn under them (cm): p5 {r['p5']}, median {r['p50']}, p95 {r['p95']}, lowest {r['lowest']}, highest {r['highest']}; in a stone {r['inStone']}, in the air {r['inAir']} (n {r['n']}, rose {r['rise']} m, arrived {r['arrived']})", flush=True)
                    if not off:
                        check(r['n'] > 6 and r['inStone'] <= 0.05 and r['inAir'] <= 0.1, f"over the rubble at a {name}: each planted foot on the stone drawn under it (in a stone {r['inStone']}, in the air {r['inAir']} of {r['n']} frames; p5 {r['p5']} cm, p95 {r['p95']} cm)")
        pathlib.Path(OUT + f'motion5_{TAG}.json').write_text(json.dumps(res, indent=1))
        errs = await ev(page, "__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l or 'ERROR' in l for l in logs), 'every shader compiles ' + str([l for l in logs if 'Shader Error' in l or 'ERROR' in l][:1])[:400])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
