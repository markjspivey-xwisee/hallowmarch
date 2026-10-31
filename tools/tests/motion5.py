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
ONLY = OPT.get('only', 'birds,gallop,heel,hammer,jump,rubble,shove,dive').split(',')
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
  // [motion5] a person walking: the heel's rise while the toes are still on the ground (the sole's points heel to toe: the
  // highest over the lowest while the lowest is within 1.5 cm of the floor), the planted feet, the feet near the ground
  heel(v, sec = 2.6) {
    const M = __hm.motion, { rec } = this.run('human', v, sec, ['feet', 'soles']);
    const S = rec.filter((s) => s.t >= 0.6 && s.L && s.L.feet && s.L.soles);
    let rise = 0;
    for (const s of S) for (const p of s.L.feet) if (p) { const fl = M.motionFloor(p[0], p[2], s.y); if (p[3] - fl < 0.015) rise = Math.max(rise, p[4] - p[3]); }
    // the point each foot stands on (its lowest sole point, within 1 cm of the floor): how far it moves over the ground from
    // frame to frame while it stays down, summed over a stance (a foot rolling from heel to toe stands on its heel, then
    // its whole sole, then its toes: none of them should move while it bears the foot)
    let worst = 0, sumAll = 0, stances = 0;
    for (let f = 0; f < 2; f++) {
      let run = 0, on = false;
      for (let i = 1; i < S.length; i++) {
        const hs = S[i].L.soles.slice(f * 5, f * 5 + 5), hp = S[i - 1].L.soles.slice(f * 5, f * 5 + 5);
        let j = -1, lo = 9;
        hs.forEach((p, k) => { if (p) { const h = p[1] - M.motionFloor(p[0], p[2], S[i].y); if (h < lo) { lo = h; j = k; } } });
        const q = j >= 0 ? hp[j] : null, hq = q ? q[1] - M.motionFloor(q[0], q[2], S[i - 1].y) : 9;
        if (j >= 0 && lo < 0.01 && hq < 0.015) { run += Math.hypot(hs[j][0] - q[0], hs[j][2] - q[2]); on = true; }
        else if (on) { worst = Math.max(worst, run); sumAll += run; stances++; run = 0; on = false; }
      }
      if (on) { worst = Math.max(worst, run); sumAll += run; stances++; }
    }
    const m = M.motionMeasure(rec, { skip: 0.6 });
    return { v, heelRise: +(rise * 100).toFixed(1), contact: +(worst * 100).toFixed(2), contactMean: +(sumAll / Math.max(1, stances) * 100).toFixed(2), slide: m.slideMax, slip: m.slipK, low5: m.low5, lowMin: m.lowMin, skate: AC5.skate(rec, 0.6, sec) };
  },
  // [motion5] shoving a beached boat off (action 19): each hand's lowest point over the boat's hull under it (the highest of
  // the hull's points within 12 cm of it across), while the body drives
  // [motion5] every beached boat: her near end's gunwale (the cap's top at u = 0.95, 0.9 and 0.85 of the way to the end,
  // either side) as the shover at her end sees it (ahead of its root, up over its floor, across)
  shoveGeo() {
    const H = __hm, F = H.fn, Bt = H.water.boats, Bs = Bt.BOATS, out = [];
    const BL = 4.3, BB = 1.36, hb = (u) => Math.max(0.025, (BB / 2) * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.3)), 0.85)), sh = (u) => 0.36 + 0.24 * u * u;
    Bt.list().forEach((q, i) => {
      if (q.st !== 'beached') return;
      const B = Bs.list[i], E = Bt.shoveEnd(i), fy = F.floorAt(E.x, E.z, F.heightAt(E.x, E.z) + 1);
      const gx = B.x - E.x, gz = B.z - E.z, gl = Math.hypot(gx, gz), ux = gx / gl, uz = gz / gl;
      const near = (ux * Math.sin(B.yaw) + uz * Math.cos(B.yaw)) > 0 ? -1 : 1;
      B.root.updateMatrixWorld(true); const m = B.root.matrixWorld.elements, pts = [];
      for (const u of [0.95, 0.9, 0.85]) for (const side of [1, -1]) {
        const lu = near * u, x = side * hb(lu), y = sh(lu) + 0.03, z = lu * BL / 2;
        const wx = m[0] * x + m[4] * y + m[8] * z + m[12], wy = m[1] * x + m[5] * y + m[9] * z + m[13], wz = m[2] * x + m[6] * y + m[10] * z + m[14];
        pts.push({ u, side, ahead: +((wx - E.x) * ux + (wz - E.z) * uz).toFixed(3), up: +(wy - fy).toFixed(3), across: +((wx - E.x) * uz - (wz - E.z) * ux).toFixed(3) });
      }
      out.push({ i, slope: +((F.heightAt(E.x + ux, E.z + uz) - F.heightAt(E.x - ux, E.z - uz)) / 2).toFixed(3), pts });
    });
    return out;
  },
  shove() {
    const H = __hm, P = H.GAME.player, M = H.motion, Bt = H.water.boats, Bs = Bt.BOATS;
    const i = Bt.list().findIndex((q) => q.st === 'beached'); if (i < 0) return { err: 'no beached boat' };
    const B = Bs.list[i], E = Bt.shoveEnd(i); H.teleport(E.x, E.z); P.yaw = Math.atan2(B.x - P.x, B.z - P.z); H.CAM.yaw = P.yaw; H.UI.modal = null; H.simulate(0.3, 1 / 60);
    let act = 0;
    const G = [];
    const gwale = () => { const E2 = { x: P.x, z: P.z }, gx = B.x - E2.x, gz = B.z - E2.z, gl = Math.hypot(gx, gz) || 1, near = ((gx / gl) * Math.sin(B.yaw) + (gz / gl) * Math.cos(B.yaw)) > 0 ? -1 : 1, lu = near * 0.975, hb = Math.max(0.025, 0.68 * Math.pow(Math.max(0, 1 - Math.pow(0.975, 2.3)), 0.85)), y = 0.36 + 0.24 * 0.975 * 0.975 + 0.03, z = lu * 4.3 / 2; B.root.updateMatrixWorld(true); const m = B.root.matrixWorld.elements; return [1, -1].map((sd) => { const x = sd * hb; return [m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]; }); };
    const hull = () => { B.root.updateMatrixWorld(true); const a = B.mesh.geometry.attributes.position, m = B.mesh.matrixWorld.elements, out = []; for (let k = 0; k < a.count; k++) { const x = a.getX(k), y = a.getY(k), z = a.getZ(k); out.push([m[0] * x + m[4] * y + m[8] * z + m[12], m[1] * x + m[5] * y + m[9] * z + m[13], m[2] * x + m[6] * y + m[10] * z + m[14]]); } return out; };
    const rec = M.motionRun([{ e: P, kind: 'human', which: ['hands', 'feet'], drive: (e, t) => { if (t >= 0.1 && !act) { Bt.shoveOff(i); act = P.anim.act || -1; } } }], 1.4, 1 / 60, { cam: (t) => { H.UI.modal = null; MO.chase(P); G.push({ t, at: P.anim.actDur > 0 ? P.anim.actT / P.anim.actDur : 0, act: P.anim.act, hull: t > 0.3 ? (H.motion5.boatPose(i, 1 / 60), hull()) : null, gw: gwale(), m: B.root.matrixWorld.clone() }); } })[0];
    // (while she is in the arms' reach: from the hands' coming down onto her to her first 15 cm away, 0.15 to 0.5 of the
    // action; after that the arms straighten after her and come away)
    const gaps = [], bins = {};
    for (let k = 0; k < rec.length; k++) {
      const s = rec[k], g = G[k]; if (!g || !g.hull || g.act !== 19 || !s.L || !s.L.hands) continue;
      { const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), b = 'p' + (Math.floor(g.at * 10) / 10).toFixed(1); if (!bins[b] && g.gw) bins[b] = { hand: s.L.hands.map((h) => h && [+((h[0] - s.x) * fx + (h[2] - s.z) * fz).toFixed(2), +((h[0] - s.x) * fz - (h[2] - s.z) * fx).toFixed(2), +(h[3] - s.y).toFixed(2)]), gw: g.gw.map((q) => [+((q[0] - s.x) * fx + (q[2] - s.z) * fz).toFixed(2), +((q[0] - s.x) * fz - (q[2] - s.z) * fx).toFixed(2), +(q[1] - s.y).toFixed(2)]) }; }
      for (const h of s.L.hands) {
        if (!h) continue;
        // (the gunwale's cap under the hand: its top where the hand is along her, from her pose this step)
        const ap = (m, x, y, z) => { const e = m.elements; return { x: e[0] * x + e[4] * y + e[8] * z + e[12], y: e[1] * x + e[5] * y + e[9] * z + e[13], z: e[2] * x + e[6] * y + e[10] * z + e[14] }; };
        const mi = g.m.clone().invert(), lp = ap(mi, h[0], h[3], h[2]), u = Math.max(-1, Math.min(1, lp.z / 2.15));
        const capY = 0.36 + 0.24 * u * u + 0.0295, hbU = Math.max(0.025, 0.68 * Math.pow(Math.max(0, 1 - Math.pow(Math.abs(u), 2.3)), 0.85));
        if (Math.abs(Math.abs(lp.x) - hbU) > 0.06) { const b2 = 'off' + (Math.floor(g.at * 10) / 10).toFixed(1); bins[b2] = (bins[b2] || 0) + 1; if (g.at >= 0.15 && g.at <= 0.5) gaps.push(9); continue; }
        const top = ap(g.m, lp.x, capY, lp.z).y;
        const b = (Math.floor(g.at * 10) / 10).toFixed(1); (bins[b] = bins[b] || []).push(+((h[3] - top) * 100).toFixed(1));
        if (g.at >= 0.15 && g.at <= 0.5) gaps.push(h[3] - top);
      }
    }
    for (const b in bins) if (Array.isArray(bins[b])) { const a = bins[b].sort((x, y) => x - y); bins[b] = a[Math.floor(a.length / 2)]; }
    gaps.sort((a, b) => a - b);
    const q = (f) => gaps.length ? +(gaps[Math.min(gaps.length - 1, Math.floor(f * gaps.length))] * 100).toFixed(1) : null;
    // the boat's end before the shover at the shove's start (the hull's highest points about 0.5 m ahead), in its frame
    const g0 = G.find((g) => g.hull), s0 = rec[G.indexOf(g0)], fx = Math.sin(s0.yaw), fz = Math.cos(s0.yaw);
    let end = null; for (const q2 of g0.hull) { const a = (q2[0] - s0.x) * fx + (q2[2] - s0.z) * fz, c = (q2[0] - s0.x) * fz - (q2[2] - s0.z) * fx; if (a > 0 && a < 1.2 && Math.abs(c) < 0.5 && (!end || q2[1] > end.y)) end = { y: q2[1], a, c }; }
    const hd = s0.L && s0.L.hands ? s0.L.hands.map((h) => h && { a: +((h[0] - s0.x) * fx + (h[2] - s0.z) * fz).toFixed(2), y: +(h[3] - s0.y).toFixed(2) }) : null;
    return { act, n: gaps.length, p10: q(0.1), median: q(0.5), p90: q(0.9), bins, skate: AC5.skate(rec, 0.13, 1.4), end: end && { ahead: +end.a.toFixed(2), up: +(end.y - s0.y).toFixed(2), across: +end.c.toFixed(2) }, hands0: hd };
  },
  // [motion5] a diver swimming on under a lake (07d_dive.js): how far a stroke carries it, and the hands' sweep from overhead
  // to the thighs (the probe's fists along the body, from ahead of the head to behind the hips)
  dive() {
    const H = __hm, P = H.GAME.player, W = H.water, M = H.motion;
    // (a spot 3 m deep or more in a realm's lake, with no current, on a line out from its middle: water2.py's lakeSpot)
    let best = null;
    for (const L of H.dbg.LAKES) { if (best) break; for (let r = 0; r < 40 && !best; r += 0.5) for (let a = 0; a < 12; a++) { const x = L.x + Math.cos(a * 0.52) * r, z = L.z + Math.sin(a * 0.52) * r, w = W.waterAt(x, z); if (w && w.depth >= 3 && Math.hypot(w.fx, w.fz) < 0.05) { best = { x, z }; break; } } }
    if (!best) return { err: 'no lake' };
    const w = W.waterAt(best.x, best.z); P.x = P.prevX = best.x; P.z = P.prevZ = best.z; P.y = w.y - 1.3; P.breath = 1; P.hp = P.maxHp = 1e7;
    H.UI.modal = null; H.INPUT.keys.clear(); H.simulate(0.3, 1 / 60); W.dive.start(); H.CAM.pitch = 0.45; H.INPUT.keys.add('KeyW');
    H.simulate(1.5, 1 / 60);
    const ph0 = P.swimPh, x0 = P.x, z0 = P.z, y0 = P.y;
    const rec = M.motionRun([{ e: P, kind: 'human', which: ['hands'] }], 2.5, 1 / 60, { cam: () => { H.UI.modal = null; H.CAM.pitch = 0.45; H.camera.position.set(P.x + 3, P.y + 1.4, P.z + 3); H.camera.lookAt(P.x, P.y + 1.2, P.z); H.camera.updateMatrixWorld(); } })[0];
    const d = Math.hypot(P.x - x0, P.z - z0, P.y - y0), strokes = (P.swimPh - ph0) / (2 * Math.PI);
    // the fists along the way the body swims (from its root): the farthest ahead and behind each stroke
    let ah = -9, bh = 9;
    for (const s of rec) { if (!s.L || !s.L.hands) continue; const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw); for (const h of s.L.hands) if (h) { const a = (h[0] - s.x) * fx + (h[2] - s.z) * fz; ah = Math.max(ah, a); bh = Math.min(bh, a); } }
    H.INPUT.keys.clear(); W.dive.end(); H.simulate(0.5, 1 / 60);
    return { v: +(d / 2.5).toFixed(2), strokesPerS: +(strokes / 2.5).toFixed(2), perStroke: +(d / Math.max(strokes, 0.01)).toFixed(2), handsAhead: +ah.toFixed(2), handsBehind: +bh.toFixed(2), dive: !!P.dive };
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
    for (const o of H.ENT.slice()) if (o.alive && o.kind === 'humanoid' && o !== P && !o.testMo && Math.hypot(o.x - sp.x, o.z - sp.z) < 8) F.removeEnt(o); // (the townsfolk who come to work there would shoulder the measured body aside)
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
  // [motion5] a soldier on a stretch of a Logres keep's wall walk jumping down into the court as war2's leaders do (08j_war2.js:
  // the ladder fall's motion), its feet through the landing
  jump() {
    const H = __hm, F = H.fn, M = H.motion;
    // (a stretch of walk 3 m and more over its court, of each realm's keeps, until a jump from its inner edge comes down in
    // the court: a Logres walk's inner side may have its own parapet)
    const cands = [];
    for (const K of H.WAR.keeps) { const C = F.castleOf(K.site), S = K.site; for (const f of C.floors) if (f.active && f.tag === 'walk' && f.type === 'box' && f.ya === f.yb && f.ya > S.y + 3) cands.push({ f, S, K }); }
    let out = { err: 'no walk' };
    for (const { f, S } of cands.slice(0, 8)) {
      const ux0 = S.x - f.x, uz0 = S.z - f.z, ul = Math.hypot(ux0, uz0) || 1; let ex = f.x, ez = f.z;
      for (let k = 0; k < 60; k++) { const nx = ex + ux0 / ul * 0.05, nz = ez + uz0 / ul * 0.05; if (F.floorAt(nx, nz, f.ya + 0.1) < f.ya - 0.3) break; ex = nx; ez = nz; }
      ex -= ux0 / ul * 0.1; ez -= uz0 / ul * 0.1;
      const e = MO.body('human', ex, ez, 0); e.y = f.ya; e.fixedY = null; e.onGround = true; e.role = 'test';
      const P = H.GAME.player; P.x = P.prevX = S.x + 6; P.z = P.prevZ = S.z + 6;
      for (const o of H.ENT.slice()) if (o.alive && o !== P && o !== e && o.kind === 'humanoid' && Math.hypot(o.x - ex, o.z - ez) < 14) F.removeEnt(o); // (a guard of the court beside it shoulders it aside)
      H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(e.x + 5, e.y + 1, e.z + 5); H.camera.lookAt(e.x, e.y - 1, e.z); H.camera.updateMatrixWorld();
      M.motionRun([{ e, kind: 'human', which: ['feet'] }], 0.3, 1 / 60);
      const dx = S.x - e.x, dz = S.z - e.z, d = Math.hypot(dx, dz) || 1, y0 = e.y;
      e.yaw = Math.atan2(dx, dz);
      e.motion = { kind: 'ladder', L: H.blaze.BZ_FALL_L || { hatch: null, T: null }, st: 3, t: 0, vy: 2.2, y0: e.y, by: null, dx: (dx / d) * 3.6, dz: (dz / d) * 3.6, dir: 1 };
      e.anim.act = 6; e.anim.actT = 0; e.anim.actDur = 1.5;
      let tL = null;
      const acts = [];
      const rec = M.motionRun([{ e, kind: 'human', which: ['feet', 'knees'], drive(e, t) { if (tL === null && !e.motion) tL = t; acts.push(e.anim.act); } }], 2.0, 1 / 60, { cam: () => { H.camera.position.set(e.x + 4, e.y + 1.4, e.z + 4); H.camera.lookAt(e.x, e.y + 0.6, e.z); H.camera.updateMatrixWorld(); } })[0];
      const near = rec.filter((s) => tL !== null && s.t >= tL - 0.05 && s.t <= tL + 0.9 && s.L && s.L.feet);
      const hs = near.flatMap((s) => s.L.feet.filter(Boolean).map((p) => p[3] - M.motionFloor(p[0], p[2], s.y))).sort((a, b) => a - b);
      const trace = near.filter((s) => s.t - tL < 0.12).map((s) => [+(s.t - tL).toFixed(3), +((s.y - M.motionFloor(s.x, s.z, s.y)) * 100).toFixed(1), ...s.L.feet.map((p) => p ? +((p[3] - M.motionFloor(p[0], p[2], s.y)) * 100).toFixed(1) : null), acts[Math.round(s.t * 60)]]);
      out = { fell: +(y0 - e.y).toFixed(2), landT: tL, n: hs.length, lowest: hs.length ? +(hs[0] * 100).toFixed(1) : null, p50: hs.length ? +(hs[Math.floor(hs.length / 2)] * 100).toFixed(1) : null, skate: AC5.skate(rec, (tL ?? 9) + 0.05, (tL ?? 9) + 0.9), acts: [...new Set(acts)], hp: +(e.hp / e.maxHp).toFixed(2), trace };
      MO.clear();
      if (out.fell > 2) break;
    }
    return out;
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
        await ev(page, "(async () => { window.requestAnimationFrame = () => 0; __hm.fn.setQuality('" + OPT.get('q', 'low') + "'); await __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.setTod(0.45); return 0; })()")
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
        if 'shove' in ONLY:
            g = await ev(page, "M5.shoveGeo()")
            for row in g:
                print(f"  beached boat {row['i']} (the beach's fall {row['slope']} a metre): " + ', '.join(f"u {q['u']} side {q['side']}: ahead {q['ahead']} up {q['up']} across {q['across']}" for q in row['pts']), flush=True)
            r = await ev(page, "M5.shove()")
            res['shove'] = r
            print(f"  shoving a boat off: each hand's lowest point over the hull under it (cm): {json.dumps(r)}", flush=True)
            check(r.get('n', 0) > 20 and r['median'] is not None and -3 <= r['median'] <= 3 and r['p90'] <= 6 and r['skate'] <= 2, f"shoving a boat off, the hands are on her gunwale while the body drives (median {r.get('median')} cm over the hull under them, 10% {r.get('p10')}, 90% {r.get('p90')}) and the feet stand ({r.get('skate')} cm)")
        if 'dive' in ONLY:
            r = await ev(page, "M5.dive()")
            res['dive'] = r
            print(f"  a diver under a lake: {json.dumps(r)}", flush=True)
            check(r.get('perStroke') is not None and 1.6 <= r['perStroke'] <= 2.8, f"under the water a stroke carries the diver about 2.2 m, as at the surface ({r.get('perStroke')} m a stroke at {r.get('v')} m/s, {r.get('strokesPerS')} strokes a second; the hands from {r.get('handsAhead')} m ahead of its root to {r.get('handsBehind')} m)")
        if 'heel' in ONLY:
            for v in (0.6, 1.4, 3.2, 5.0):
                r = await ev(page, f"M5.heel({v})")
                res[f'heel_{v}'] = r
                print(f"  a person at {v} m/s: the heel rises {r['heelRise']} cm before the toes leave the ground; the point it stands on moves {r['contact']} cm in the worst stance (mean {r['contactMean']}); the sole's middle (motion.py's measure) {r['slide']} cm (slipK {r['slip']}), skate {r['skate']} cm, lowest foot p5 {r['low5']} (min {r['lowMin']})", flush=True)
                check(r['contact'] <= 1.0 and r['lowMin'] >= -1.0, f"a person at {v} m/s: the point each foot stands on holds while it bears the foot ({r['contact']} cm) and no sole is in the ground ({r['lowMin']} cm)")
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
        if 'jump' in ONLY:
            r = await ev(page, "M5.jump()")
            res['jump'] = r
            print(f"  a soldier jumping down from a keep's walk: {json.dumps(r)}", flush=True)
            check(r.get('fell', 0) > 2 and r.get('lowest') is not None and r['lowest'] >= -2.5 and r['skate'] <= 2, f"jumping down from a wall walk ({r.get('fell')} m), it lands on its feet and gives at the knees: no foot in the ground (the lowest {r.get('lowest')} cm) and none sliding once down ({r.get('skate')} cm)")
        if 'rubble' in ONLY:
            r = await ev(page, "M5.breach()")
            print(f"  a Logres corner tower brought down: {r}", flush=True)
            for name, joy in (('walk', 0.45), ('run', 1.0)):
                for off in (True, False):
                    r = await ev(page, f"M5.rubble({joy}, {'true' if off else 'false'})")
                    res[f'rubble_{name}_{"ramp" if off else "stones"}'] = r
                    print(f"  over the rubble at a {name}, the feet on {'the ramps (as before)' if off else 'the stones'}: planted feet over the stone drawn under them (cm): p5 {r['p5']}, median {r['p50']}, p95 {r['p95']}, lowest {r['lowest']}, highest {r['highest']}; in a stone {r['inStone']}, in the air {r['inAir']} (n {r['n']}, rose {r['rise']} m, arrived {r['arrived']})", flush=True)
                    if not off:
                        check(r['n'] > (6 if name == 'walk' else 2) and r['inStone'] * r['n'] <= max(1, 0.05 * r['n']) and r['inAir'] * r['n'] <= max(1, 0.1 * r['n']), f"over the rubble at a {name}: each planted foot on the stone drawn under it (in a stone {r['inStone']}, in the air {r['inAir']} of {r['n']} frames; p5 {r['p5']} cm, p95 {r['p95']} cm)")
        if 'shots' in ARGS:
            await page.set_viewport_size({'width': 960, 'height': 540})
            await ev(page, "(() => { __hm.setTod(0.42); const W = __hm.dbg.WEATHER; W.mode = 'fixed'; W.kind = 'clear'; W.raining = 0; W.wet = 0; W.snowing = 0; W.snow = 0; W.overcast = 0; W.target = 0; MO.calm(); const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; return 0; })()")
            CAM = "const cam = (x, y, z, tx, ty, tz) => { const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); };"
            async def shot(name, js):
                info = await ev(page, js)
                url = await ev(page, "(() => { __hm.frame(1 / 30); __hm.frame(1 / 30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
                import base64
                pathlib.Path(OUT + 'm5_' + name + '.png').write_bytes(base64.b64decode(url.split(',', 1)[1]))
                print('  shot', name, json.dumps(info), f'[{time.time() - T0:.0f}s]', flush=True)
            # a hen and a pheasant walking, from beside, a foot planted and one lifted
            for kind, v, d, up in (('hen', 0.5, 1.1, 0.35), ('pheasant', 0.6, 1.2, 0.35), ('duck', 0.5, 1.1, 0.3)):
                await shot(f'{kind}_walk', "(() => { " + CAM + f" MO.clear(); const H = __hm, Ln = MO.lane(MO.cx, MO.cz, 12, 1); for (let j = -8; j <= 8; j += 1) H.nature.natureCut(Ln.x + Ln.ux * j, Ln.z + Ln.uz * j, 2.0, 1, false); const e = MO.body('{kind}', Ln.x - Ln.ux * 2, Ln.z - Ln.uz * 2, Math.atan2(Ln.ux, Ln.uz)); MO.over(Ln, 8); for (let k = 0; k < 75; k++) {{ const s = MO.ramp({v}, k / 60) / 60; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); __hm.motion.motionRun([], 1 / 60, 1 / 60); }} cam(e.x + Ln.sx * {d}, e.y + {up}, e.z + Ln.sz * {d}, e.x, e.y + 0.15, e.z); return {{ ph: +e.anim.phase.toFixed(2) }}; }})()")
            # a horse at a gallop, from beside
            await shot('gallop', "(() => { " + CAM + " MO.clear(); const H = __hm, Ln = MO.lane(MO.cx, MO.cz, 40, 1); for (let j = -20; j <= 20; j += 1) H.nature.natureCut(Ln.x + Ln.ux * j, Ln.z + Ln.uz * j, 2.2, 1, false); const e = MO.body('horse', Ln.x - Ln.ux * 14, Ln.z - Ln.uz * 14, Math.atan2(Ln.ux, Ln.uz)); MO.over(Ln, 14); for (let k = 0; k < 80; k++) { const s = MO.ramp(11, k / 60) / 60; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); __hm.motion.motionRun([], 1 / 60, 1 / 60); } cam(e.x + Ln.sx * 4.6, e.y + 1.1, e.z + Ln.sz * 4.6, e.x, e.y + 0.6, e.z); return 0; })()")
            # a walker's heel rising before its toes leave the ground
            await shot('heel', "(() => { " + CAM + " MO.clear(); const H = __hm, Ln = MO.lane(MO.cx, MO.cz, 12, 1); for (let j = -8; j <= 8; j += 1) H.nature.natureCut(Ln.x + Ln.ux * j, Ln.z + Ln.uz * j, 2.0, 1, false); const e = MO.body('human', Ln.x - Ln.ux * 3, Ln.z - Ln.uz * 3, Math.atan2(Ln.ux, Ln.uz)); MO.over(Ln, 8); let k = 0; for (; k < 200; k++) { const s = MO.ramp(1.4, k / 60) / 60; e.x += Ln.ux * s; e.z += Ln.uz * s; e.yaw = Math.atan2(Ln.ux, Ln.uz); __hm.motion.motionRun([], 1 / 60, 1 / 60); const u = (((e.anim.phase - Math.PI / 2) / (Math.PI * 2)) % 1 + 1) % 1; if (k > 70 && u > 0.5 && u < 0.53) break; } cam(e.x + Ln.sx * 2.2, e.y + 0.6, e.z + Ln.sz * 2.2, e.x, e.y + 0.45, e.z); return k; })()")
            # a builder hammering at a house being built back, the mallet at the wall
            await shot('hammer', "(() => { " + CAM + " const H = __hm, F = H.fn, Rb = H.rubble, S = H.REALMS[0].town, hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'scaffold'); const Hh = hs[0]; if (!Hh) return null; const sp = Rb.houseScafWorkSpot(Hh, 1), yaw = Math.atan2(sp.fx - sp.x, sp.fz - sp.z), fx = Math.sin(yaw), fz = Math.cos(yaw); const e = MO.body('human', sp.x, sp.z, yaw); e.y = F.floorAt(e.x, e.z, e.y + 1); e._hamUntil = 1e9; e.anim.act = 23; e.anim.actT = 0; e.anim.actDur = 1.05; for (let k = 0; k < 44; k++) { e.yaw = yaw; e._hamUntil = 1e9; __hm.motion.motionRun([], 1 / 60, 1 / 60); } for (const o of H.ENT.slice()) if (o.alive && o !== e && o.kind === 'humanoid' && o !== H.GAME.player && Math.hypot(o.x - e.x, o.z - e.z) < 6) F.removeEnt(o); cam(e.x + fz * 2.1 + fx * 0.15, e.y + 1.5, e.z - fx * 2.1 + fz * 0.15, e.x + fx * 0.45, e.y + 1.2, e.z + fz * 0.45); return +(e.anim.actT / e.anim.actDur).toFixed(2); })()")
            # the heap of a fallen tower with a stormer on it
            await shot('rubble', "(() => { " + CAM + " MO.clear(); const H = __hm, F = H.fn, W = M5.W; if (!W) return null; const Rt = H.siege2.siegeStormRoute(W), a = Rt[0], b = Rt[1]; const e = MO.body('human', a.x + (b.x - a.x) * 0.75, a.z + (b.z - a.z) * 0.75, Math.atan2(b.x - a.x, b.z - a.z)); e.y = F.floorAt(e.x, e.z, 50); M5.K.lastEnemyNear = H.GAME.t; for (let k = 0; k < 30; k++) { const s = 0.9 / 60; e.x += (b.x - a.x) / Math.hypot(b.x - a.x, b.z - a.z) * s; e.z += (b.z - a.z) / Math.hypot(b.x - a.x, b.z - a.z) * s; e.y = F.floorAt(e.x, e.z, e.y + 0.5); __hm.motion.motionRun([], 1 / 60, 1 / 60); } const dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz); cam(e.x + dz / L * 3.6 - dx / L * 2, e.y + 1.6, e.z - dx / L * 3.6 - dz / L * 2, e.x + dx / L * 0.8, e.y + 0.3, e.z + dz / L * 0.8); return 0; })()")
        pathlib.Path(OUT + f'motion5_{TAG}.json').write_text(json.dumps(res, indent=1))
        errs = await ev(page, "__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        check(not any('Shader Error' in l or 'ERROR' in l for l in logs), 'every shader compiles ' + str([l for l in logs if 'Shader Error' in l or 'ERROR' in l][:1])[:400])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()
asyncio.run(main())
