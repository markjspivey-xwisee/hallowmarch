/* ================================================================== */
/* farming, drawn: every crop, weed and herb is a model built in code  */
/* whose parts grow out of their stems as the plant grows (one         */
/* instanced mesh per kind, swaying in the wind); beds are furrowed    */
/* soil meshes that darken and shine in the rain, take snow on their   */
/* ridges and frost at night (state of each bed in a small texture)    */
/* ================================================================== */
const FARM_DRAW_R = { high: 52, medium: 38, low: 27 };
// near the camera the full model, further out the low one
const FARM_HI_R = { high: 18, medium: 14, low: 11 };
const FARM_CAP = { grain: 1400, flax: 900, cabbage: 900, turnip: 900, beans: 800, weed: 1500, grain_lo: 6500, flax_lo: 2500, cabbage_lo: 2500, turnip_lo: 2500, beans_lo: 2000 };
const FU = { uFarmFrost: { value: 0 }, uPlotTex: { value: null }, uDrawR: { value: 58 } };

/* ---- a small kit for building plants: ribbons (leaves, blades), tubes (stems), blobs (heads, roots, caps), stars (flowers) ---- */
const fv = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sc: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  nrm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  mix: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};
const fkNew = () => ({ p: [], n: [], a: [], o: [], c: [], r: [], i: [] });
function fkV(b, P, N, part, A, col, rip) {
  b.p.push(P[0], P[1], P[2]); b.n.push(N[0], N[1], N[2]); b.a.push(part[0], part[1], part[2], part[3]);
  b.o.push(A[0], A[1], A[2]); b.c.push(col[0], col[1], col[2]); b.r.push(rip[0], rip[1], rip[2]);
  return b.p.length / 3 - 1;
}
const fkCol = (c, t) => (typeof c === 'function' ? c(t) : c);
// a curve leaving `base` on bearing yaw at elevation elev, bending down by droop over its length
function fkArc(base, yaw, elev, len, droop, segs) {
  const pts = [base.slice()];
  let p = base.slice();
  for (let k = 1; k <= segs; k++) {
    const e = elev - (droop * (k - 0.5)) / segs;
    p = fv.add(p, fv.sc([Math.sin(yaw) * Math.cos(e), Math.sin(e), Math.cos(yaw) * Math.cos(e)], len / segs));
    pts.push(p);
  }
  return pts;
}
// a flat strip along a curve, wfn(t) wide; part = [kind, gIn, gFull]
function fkRibbon(b, pts, wfn, side, part, anc, col, rip) {
  const n = pts.length, base = b.p.length / 3;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), P = pts[k];
    const tan = fv.nrm(fv.sub(pts[Math.min(k + 1, n - 1)], pts[Math.max(k - 1, 0)]));
    const s = typeof side === 'function' ? side(t) : side;
    let N = fv.nrm(fv.cross(tan, s));
    if (N[1] < -0.2) N = fv.sc(N, -1);
    const w = wfn(t) / 2;
    fkV(b, fv.sub(P, fv.sc(s, w)), N, [part[0], t, part[1], part[2]], anc, fkCol(col, t), fkCol(rip, t));
    fkV(b, fv.add(P, fv.sc(s, w)), N, [part[0], t, part[1], part[2]], anc, fkCol(col, t), fkCol(rip, t));
  }
  for (let k = 0; k < n - 1; k++) { const a = base + k * 2; b.i.push(a, a + 1, a + 3, a, a + 3, a + 2); }
}
const fkSide = (yaw) => [Math.cos(yaw), 0, -Math.sin(yaw)];
// a tube of m sides along a curve, rfn(t) thick
function fkTube(b, pts, rfn, m, part, anc, col, rip) {
  const n = pts.length, base = b.p.length / 3;
  for (let k = 0; k < n; k++) {
    const t = k / (n - 1), P = pts[k];
    const tan = fv.nrm(fv.sub(pts[Math.min(k + 1, n - 1)], pts[Math.max(k - 1, 0)]));
    const u = fv.nrm(fv.cross(tan, Math.abs(tan[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = fv.cross(tan, u);
    for (let j = 0; j < m; j++) {
      const a = (j / m) * TAU, d = fv.add(fv.sc(u, Math.cos(a)), fv.sc(v, Math.sin(a)));
      fkV(b, fv.add(P, fv.sc(d, rfn(t))), d, [part[0], t, part[1], part[2]], anc, fkCol(col, t), fkCol(rip, t));
    }
  }
  for (let k = 0; k < n - 1; k++) for (let j = 0; j < m; j++) {
    const a = base + k * m + j, b2 = base + k * m + ((j + 1) % m), c = a + m, d = b2 + m;
    b.i.push(a, b2, d, a, d, c);
  }
}
// an ellipsoid (a head, a root, a cap); colFn(y) by height from -1 to 1; top only when half
function fkBlob(b, c, r, seg, ring, part, anc, col, rip, half = false, bump = null) {
  const base = b.p.length / 3;
  for (let i = 0; i <= ring; i++) {
    const ph = (half ? 0.5 + 0.5 * (i / ring) : i / ring) * Math.PI, y = -Math.cos(ph), rr = Math.sin(ph);
    for (let j = 0; j < seg; j++) {
      const a = (j / seg) * TAU;
      const d = [Math.cos(a) * rr, y, Math.sin(a) * rr];
      const k = bump ? bump(a, y) : 1;
      fkV(b, [c[0] + d[0] * r[0] * k, c[1] + d[1] * r[1] * k, c[2] + d[2] * r[2] * k], fv.nrm([d[0] / r[0], d[1] / r[1], d[2] / r[2]]), [part[0], (y + 1) / 2, part[1], part[2]], anc, fkCol(col, y), fkCol(rip, y));
    }
  }
  for (let i = 0; i < ring; i++) for (let j = 0; j < seg; j++) {
    const a = base + i * seg + j, b2 = base + i * seg + ((j + 1) % seg), cc = a + seg, d = b2 + seg;
    b.i.push(a, d, b2, a, cc, d);
  }
}
// a flower: petals round a centre facing `up`, cupped a little
function fkStar(b, c, up, R, petals, cup, part, anc, col, rip, inner = 0.42) {
  up = fv.nrm(up);
  const u = fv.nrm(fv.cross(up, Math.abs(up[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0])), v = fv.cross(up, u);
  const base = fkV(b, fv.add(c, fv.sc(up, R * 0.12)), up, [part[0], 0, part[1], part[2]], anc, fkCol(col, 0), fkCol(rip, 0));
  const n = petals * 2;
  for (let k = 0; k < n; k++) {
    const a = (k / n) * TAU, rad = k % 2 === 0 ? R : R * inner;
    const d = fv.add(fv.sc(u, Math.cos(a)), fv.sc(v, Math.sin(a)));
    fkV(b, fv.add(fv.add(c, fv.sc(d, rad)), fv.sc(up, cup * rad)), fv.nrm(fv.add(up, fv.sc(d, -cup))), [part[0], 1, part[1], part[2]], anc, fkCol(col, 1), fkCol(rip, 1));
  }
  for (let k = 0; k < n; k++) b.i.push(base, base + 1 + k, base + 1 + ((k + 1) % n));
}
const hexc = (h) => hex3(h);
// parts: 0 stem, 1 leaf, 2 head (ear, cabbage head, root, pod, cap), 3 flower, 4 glowing bits, 5 seed pods and bolls
const FK = { STEM: 0, LEAF: 1, HEAD: 2, FLOWER: 3, GLOW: 4, POD: 5 };

/* ---- the plants ---- */
const FARM_MODELS = {
  grain(b) {
    const r = mulberry(11), leaf = hexc('#3f6e22'), straw = hexc('#c7a85a'), stalk = hexc('#5a8a2c'), ear = hexc('#7a9a38'), earR = hexc('#d8b45a');
    for (let k = 0; k < 3; k++) {
      const yaw = (k / 3) * TAU + r() * 0.6;
      fkRibbon(b, fkArc([0, 0, 0], yaw, 1.15, 0.36 + r() * 0.1, 1.7, 2), (t) => 0.028 * (1 - Math.pow(t, 1.6)) + 0.002, fkSide(yaw), [FK.LEAF, 0.0, 0.32], [0, 0, 0], leaf, straw);
    }
    for (let k = 0; k < 5; k++) {
      const yaw = (k / 5) * TAU + 0.5 + r() * 0.5, lean = 0.1 + r() * 0.12, H = 0.78 + r() * 0.22;
      const top = [Math.sin(yaw) * Math.sin(lean) * H, H, Math.cos(yaw) * Math.sin(lean) * H];
      const pts = [[0, 0, 0], fv.mix([0, 0, 0], top, 0.5), top];
      fkRibbon(b, pts, (t) => 0.013 - 0.005 * t, fkSide(yaw + 1.2), [FK.STEM, 0.22, 0.68], [0, 0, 0], stalk, straw);
      // the flag leaf
      const at = fv.mix([0, 0, 0], top, 0.42);
      fkRibbon(b, fkArc(at, yaw + 2.2, 0.7, 0.22, 0.9, 1), (t) => 0.02 * (1 - t * t) + 0.002, fkSide(yaw + 2.2), [FK.LEAF, 0.28, 0.6], at, leaf, straw);
      // the ear: a spindle of grain on the top of the stalk, with its awns
      const dir = fv.nrm(fv.sub(top, at)), eb = top, et = fv.add(top, fv.sc(dir, 0.12));
      fkTube(b, [eb, fv.add(eb, fv.sc(dir, 0.035)), fv.add(eb, fv.sc(dir, 0.085)), et], (t) => (t < 0.01 || t > 0.99 ? 0.002 : 0.018 * Math.sin(Math.PI * (0.15 + 0.75 * t))), 3, [FK.HEAD, 0.48, 0.7], eb, ear, earR);
      fkRibbon(b, [fv.add(eb, fv.sc(dir, 0.05)), fv.add(et, fv.sc(dir, 0.07))], () => 0.012, fkSide(yaw), [FK.HEAD, 0.55, 0.74], eb, ear, earR);
    }
  },
  flax(b) {
    const r = mulberry(23), stem = hexc('#4f8a3a'), straw = hexc('#b39a5a'), leaf = hexc('#5c9442'), flower = hexc('#7fb0e8'), boll = hexc('#7a9a40'), bollR = hexc('#a07a3a');
    for (let k = 0; k < 2; k++) fkRibbon(b, fkArc([0, 0, 0], k * Math.PI + 0.3, 1.2, 0.09, 0.6, 2), (t) => 0.018 * (1 - t * t) + 0.003, fkSide(k * Math.PI + 0.3), [FK.LEAF, 0.0, 0.25], [0, 0, 0], leaf, straw);
    for (let k = 0; k < 7; k++) {
      const yaw = (k / 7) * TAU + r(), lean = 0.05 + r() * 0.12, H = 0.62 + r() * 0.2;
      const top = [Math.sin(yaw) * Math.sin(lean) * H, H, Math.cos(yaw) * Math.sin(lean) * H];
      fkRibbon(b, [[0, 0, 0], fv.mix([0, 0, 0], top, 0.5), top], () => 0.009, fkSide(yaw + 1.3), [FK.STEM, 0.15, 0.62], [0, 0, 0], stem, straw);
      for (let q = 0; q < 2; q++) { const at = fv.mix([0, 0, 0], top, 0.3 + q * 0.25), ya = yaw + q * 2.1; fkRibbon(b, [at, fv.add(at, [Math.sin(ya) * 0.06, 0.05, Math.cos(ya) * 0.06])], (t) => 0.012 * (1 - t), fkSide(ya), [FK.LEAF, 0.2, 0.5], at, leaf, straw); }
      fkStar(b, fv.add(top, [0, 0.01, 0]), [Math.sin(yaw) * 0.3, 1, Math.cos(yaw) * 0.3], 0.03, 5, 0.25, [FK.FLOWER, 0.66, 0.73], top, flower, flower, 0.55);
      fkBlob(b, fv.add(top, [0, 0.012, 0]), [0.012, 0.014, 0.012], 3, 2, [FK.POD, 0.78, 0.9], top, boll, bollR);
    }
  },
  cabbage(b) {
    const r = mulberry(31), outer = (t) => fv.mix(hexc('#2f5a46'), hexc('#5f8a6a'), t), wrap = (t) => fv.mix(hexc('#5a8a52'), hexc('#8fb878'), t);
    const head = (y) => fv.mix(hexc('#7fa862'), hexc('#a8cc84'), (y + 1) / 2);
    for (let k = 0; k < 8; k++) {
      const yaw = (k / 8) * TAU + r() * 0.35, len = 0.21 + r() * 0.07;
      // broad outer leaves spread low and cup up at the rim
      fkRibbon(b, fkArc([0, 0.02, 0], yaw, 0.55 + r() * 0.2, len, -0.7, 4), (t) => 0.05 + 0.16 * Math.sin(Math.PI * (0.18 + 0.72 * t)), fkSide(yaw), [FK.LEAF, k < 4 ? 0.0 : 0.12, k < 4 ? 0.32 : 0.5], [0, 0, 0], outer, outer);
    }
    for (let k = 0; k < 4; k++) {
      const yaw = (k / 4) * TAU + 0.4;
      // wrapper leaves curl up round the head
      fkRibbon(b, fkArc([Math.sin(yaw) * 0.04, 0.04, Math.cos(yaw) * 0.04], yaw, 1.15, 0.17, -1.1, 3), (t) => 0.08 + 0.1 * Math.sin(Math.PI * t), fkSide(yaw), [FK.LEAF, 0.35, 0.7], [0, 0.04, 0], wrap, wrap);
    }
    fkBlob(b, [0, 0.12, 0], [0.11, 0.1, 0.11], 9, 6, [FK.HEAD, 0.42, 0.98], [0, 0.05, 0], head, head, false, (a, y) => 1 + 0.07 * Math.sin(a * 4 + y * 5) * (1 - Math.abs(y)));
  },
  turnip(b) {
    const r = mulberry(47), leaf = hexc('#4a7a2a'), leafR = hexc('#5f7a30'), root = (y) => (y > 0.25 ? hexc('#d8d0c8') : hexc('#f0ece0'));
    for (let k = 0; k < 7; k++) {
      const yaw = (k / 7) * TAU + r() * 0.5;
      // lobed leaves: the width rises and falls along the leaf
      fkRibbon(b, fkArc([0, 0.05, 0], yaw, 1.2, 0.3 + r() * 0.08, 1.2, 5), (t) => (0.035 + 0.035 * Math.sin(Math.PI * t)) * (0.7 + 0.3 * Math.abs(Math.sin(t * 13))), fkSide(yaw), [FK.LEAF, 0.0, 0.4], [0, 0, 0], leaf, leafR);
    }
    // the root's shoulder shows above the soil, the rest is in the ground
    fkBlob(b, [0, -0.015, 0], [0.072, 0.06, 0.072], 7, 4, [FK.HEAD, 0.4, 1.0], [0, -0.03, 0], root, root, false, (a, y) => (y < -0.6 ? 0.6 : 1));
  },
  beans(b) {
    const r = mulberry(53), stem = hexc('#4f7a3a'), dry = hexc('#5a4a30'), leaf = hexc('#3f6a3a'), flower = hexc('#f0f0ea'), pod = hexc('#6a9a3a'), podR = hexc('#4a3a28');
    for (let k = 0; k < 2; k++) {
      const yaw = k * Math.PI + r() * 0.5, H = 0.6 + r() * 0.12, top = [Math.sin(yaw) * 0.05, H, Math.cos(yaw) * 0.05];
      fkTube(b, [[0, 0, 0], fv.mix([0, 0, 0], top, 0.5), top], (t) => 0.011 - 0.004 * t, 3, [FK.STEM, 0.1, 0.65], [0, 0, 0], stem, dry);
      for (let q = 0; q < 3; q++) {
        const at = fv.mix([0, 0, 0], top, 0.3 + q * 0.25);
        for (const sd of [-1, 1]) { const ya = yaw + sd * 1.4 + q; fkRibbon(b, fkArc(at, ya, 0.45, 0.13, 0.6, 2), (t) => 0.08 * Math.sin(Math.PI * (0.1 + 0.85 * t)), fkSide(ya), [FK.LEAF, 0.05 + q * 0.12, 0.35 + q * 0.12], at, leaf, dry); }
        fkStar(b, fv.add(at, [Math.sin(yaw + 1) * 0.03, 0.02, Math.cos(yaw + 1) * 0.03]), [Math.sin(yaw + 1), 0.4, Math.cos(yaw + 1)], 0.018, 4, 0.3, [FK.FLOWER, 0.6, 0.68], at, flower, flower, 0.6);
        if (q < 2) { const pd = fv.add(at, [Math.sin(yaw + 2.6) * 0.04, -0.02, Math.cos(yaw + 2.6) * 0.04]); fkTube(b, [pd, fv.add(pd, [0.01, -0.06, 0.01]), fv.add(pd, [0.02, -0.12, 0.02])], (t) => 0.004 + 0.012 * Math.sin(Math.PI * t), 3, [FK.POD, 0.72, 0.9], pd, pod, podR); }
      }
    }
  },
  weed(b) {
    const r = mulberry(61), leaf = hexc('#4a6e2a'), seed = hexc('#8a5a32');
    for (let k = 0; k < 5; k++) { const yaw = (k / 5) * TAU + r(); fkRibbon(b, fkArc([0, 0, 0], yaw, 0.7, 0.15 + r() * 0.06, 0.9, 2), (t) => 0.06 * Math.sin(Math.PI * (0.15 + 0.8 * t)), fkSide(yaw), [FK.LEAF, 0.0, 0.5], [0, 0, 0], leaf, leaf); }
    fkRibbon(b, [[0, 0, 0], [0.01, 0.22, 0], [0.02, 0.42, 0.01]], () => 0.008, [1, 0, 0], [FK.STEM, 0.45, 0.85], [0, 0, 0], leaf, seed);
    fkTube(b, [[0.02, 0.32, 0.01], [0.02, 0.38, 0.01], [0.025, 0.46, 0.012]], (t) => 0.004 + 0.012 * Math.sin(Math.PI * t), 3, [FK.POD, 0.6, 0.95], [0.02, 0.32, 0.01], seed, seed);
  },
  // far away: the same plants with a handful of faces
  grain_lo(b) {
    const leaf = hexc('#3f6e22'), straw = hexc('#c7a85a'), stalk = hexc('#5a8a2c'), ear = hexc('#7a9a38'), earR = hexc('#d8b45a');
    for (let k = 0; k < 4; k++) {
      const yaw = (k / 4) * TAU + 0.4, H = 0.84 + (k % 2) * 0.08, top = [Math.sin(yaw) * 0.12, H, Math.cos(yaw) * 0.12];
      fkRibbon(b, fkArc([0, 0, 0], yaw + 1, 1.1, 0.38, 1.4, 1), (t) => 0.05 * (1 - t), fkSide(yaw + 1), [FK.LEAF, 0.0, 0.32], [0, 0, 0], leaf, straw);
      fkRibbon(b, [[0, 0, 0], top], () => 0.016, fkSide(yaw + 1.2), [FK.STEM, 0.22, 0.68], [0, 0, 0], stalk, straw);
      fkRibbon(b, [top, fv.add(top, [Math.sin(yaw) * 0.02, 0.12, Math.cos(yaw) * 0.02])], (t) => 0.034 * Math.sin(Math.PI * (0.2 + 0.7 * t)), fkSide(yaw + 1.2), [FK.HEAD, 0.48, 0.7], top, ear, earR);
    }
  },
  flax_lo(b) {
    const stem = hexc('#4f8a3a'), straw = hexc('#b39a5a'), flower = hexc('#7fb0e8'), boll = hexc('#7a9a40'), bollR = hexc('#a07a3a');
    for (let k = 0; k < 6; k++) {
      const yaw = (k / 6) * TAU + 0.3, top = [Math.sin(yaw) * 0.1, 0.68 + (k % 3) * 0.04, Math.cos(yaw) * 0.1];
      fkRibbon(b, [[0, 0, 0], top], () => 0.014, fkSide(yaw + 1.3), [FK.STEM, 0.0, 0.62], [0, 0, 0], stem, straw);
      fkRibbon(b, [fv.add(top, [0, -0.02, 0]), fv.add(top, [0, 0.035, 0])], () => 0.05, fkSide(yaw + 1.3), [FK.FLOWER, 0.66, 0.73], top, flower, flower);
      fkRibbon(b, [fv.add(top, [0, -0.005, 0]), fv.add(top, [0, 0.025, 0])], () => 0.028, fkSide(yaw - 0.3), [FK.POD, 0.78, 0.9], top, boll, bollR);
    }
  },
  cabbage_lo(b) {
    const leaf = hexc('#3f6a52'), head = (y) => fv.mix(hexc('#7fa862'), hexc('#a8cc84'), (y + 1) / 2);
    for (let k = 0; k < 6; k++) { const yaw = (k / 6) * TAU; fkRibbon(b, fkArc([0, 0.02, 0], yaw, 0.6, 0.25, -0.6, 2), (t) => 0.08 + 0.12 * Math.sin(Math.PI * (0.2 + 0.7 * t)), fkSide(yaw), [FK.LEAF, 0.0, 0.45], [0, 0, 0], leaf, leaf); }
    fkBlob(b, [0, 0.12, 0], [0.11, 0.1, 0.11], 6, 3, [FK.HEAD, 0.42, 0.98], [0, 0.05, 0], head, head);
  },
  turnip_lo(b) {
    const leaf = hexc('#4a7a2a'), leafR = hexc('#5f7a30'), root = (y) => (y > 0.25 ? hexc('#d8d0c8') : hexc('#f0ece0'));
    for (let k = 0; k < 4; k++) { const yaw = (k / 4) * TAU + 0.2; fkRibbon(b, fkArc([0, 0.05, 0], yaw, 1.2, 0.32, 1.0, 1), (t) => 0.07 * Math.sin(Math.PI * (0.3 + 0.6 * t)), fkSide(yaw), [FK.LEAF, 0.0, 0.4], [0, 0, 0], leaf, leafR); }
    fkBlob(b, [0, -0.015, 0], [0.072, 0.06, 0.072], 4, 2, [FK.HEAD, 0.4, 1.0], [0, -0.03, 0], root, root);
  },
  beans_lo(b) {
    const stem = hexc('#4f7a3a'), dry = hexc('#5a4a30'), leaf = hexc('#3f6a3a'), pod = hexc('#6a9a3a'), podR = hexc('#4a3a28');
    for (let k = 0; k < 2; k++) {
      const yaw = k * Math.PI + 0.3, top = [Math.sin(yaw) * 0.05, 0.64, Math.cos(yaw) * 0.05];
      fkRibbon(b, [[0, 0, 0], top], () => 0.02, fkSide(yaw + 1), [FK.STEM, 0.1, 0.65], [0, 0, 0], stem, dry);
      fkRibbon(b, [fv.mix([0, 0, 0], top, 0.3), fv.add(fv.mix([0, 0, 0], top, 0.75), [Math.sin(yaw + 1.6) * 0.1, 0, Math.cos(yaw + 1.6) * 0.1])], () => 0.12, fkSide(yaw + 0.2), [FK.LEAF, 0.05, 0.45], [0, 0.2, 0], leaf, dry);
      fkRibbon(b, [fv.mix([0, 0, 0], top, 0.55), fv.add(fv.mix([0, 0, 0], top, 0.4), [0.03, 0, 0.03])], () => 0.03, fkSide(yaw + 2), [FK.POD, 0.72, 0.9], fv.mix([0, 0, 0], top, 0.55), pod, podR);
    }
  },
  herb_heal(b) {
    const leaf = hexc('#3f6a2a'), stem = hexc('#4a6a30'), fl = hexc('#c86a9a');
    fkTube(b, [[0, 0, 0], [0, 0.22, 0], [0, 0.44, 0]], () => 0.007, 4, [FK.STEM, 0.1, 0.6], [0, 0, 0], stem, stem);
    for (let q = 0; q < 3; q++) for (const sd of [0, Math.PI]) { const at = [0, 0.08 + q * 0.11, 0], ya = sd + q * 1.57; fkRibbon(b, fkArc(at, ya, 0.4, 0.1 - q * 0.015, 0.8, 2), (t) => 0.045 * Math.sin(Math.PI * (0.12 + 0.85 * t)), fkSide(ya), [FK.LEAF, 0.05 * q, 0.4 + 0.1 * q], at, leaf, leaf); }
    for (let w = 0; w < 3; w++) for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU + w, y = 0.38 + w * 0.045; fkStar(b, [Math.cos(a) * 0.022, y, Math.sin(a) * 0.022], [Math.cos(a), 0.6, Math.sin(a)], 0.016, 4, 0.3, [FK.FLOWER, 0.62, 0.72], [0, y, 0], fl, fl); }
  },
  herb_mana(b) {
    const leaf = hexc('#2f5a3a'), stem = hexc('#4a7a4a'), fl = hexc('#dce8ff');
    for (let k = 0; k < 6; k++) { const ya = (k / 6) * TAU; fkRibbon(b, fkArc([0, 0, 0], ya, 0.35, 0.13, 0.5, 2), (t) => 0.05 * Math.sin(Math.PI * (0.1 + 0.85 * t)), fkSide(ya), [FK.LEAF, 0.0, 0.4], [0, 0, 0], leaf, leaf); }
    for (let k = 0; k < 4; k++) { const ya = (k / 4) * TAU + 0.4, top = [Math.sin(ya) * 0.06, 0.16 + (k % 2) * 0.04, Math.cos(ya) * 0.06]; fkRibbon(b, [[0, 0, 0], top], () => 0.006, fkSide(ya + 1.5), [FK.STEM, 0.3, 0.6], [0, 0, 0], stem, stem); fkStar(b, top, [Math.sin(ya) * 0.4, 1, Math.cos(ya) * 0.4], 0.032, 5, 0.15, [FK.FLOWER, 0.55, 0.7], top, fl, fl, 0.35); }
  },
  herb_fire(b) {
    const stemC = hexc('#d8c8a8'), cap = (y) => fv.mix(hexc('#a8301a'), hexc('#ff5a22'), (y + 1) / 2);
    const spots = [[0, 0.14, 0.09], [0.07, 0.09, -0.04], [-0.06, 0.07, -0.05], [0.02, 0.05, 0.07]];
    spots.forEach(([x, h, z], k) => {
      const s = 0.6 + k * 0.12;
      fkTube(b, [[x, 0, z], [x, h * 0.5, z], [x, h, z]], () => 0.012 * s, 4, [FK.STEM, 0.05, 0.4], [x, 0, z], stemC, stemC);
      fkBlob(b, [x, h, z], [0.055 * s * 1.4, 0.035 * s * 1.4, 0.055 * s * 1.4], 7, 3, [FK.HEAD, 0.2, 0.6], [x, h, z], cap, cap, true);
      for (let q = 0; q < 3; q++) { const a = q * 2.1 + k; fkBlob(b, [x + Math.cos(a) * 0.03 * s, h + 0.03 * s, z + Math.sin(a) * 0.03 * s], [0.008, 0.005, 0.008], 4, 2, [FK.GLOW, 0.3, 0.6], [x, h, z], hexc('#ffc060'), hexc('#ffc060'), true); }
    });
  },
  herb_frost(b) {
    const leaf = (t) => fv.mix(hexc('#6a8a9a'), hexc('#d8eef4'), t * t), ice = hexc('#eaf6ff');
    for (let k = 0; k < 8; k++) { const ya = (k / 8) * TAU + (k % 2) * 0.3; fkRibbon(b, fkArc([0, 0, 0], ya, 0.9 - (k % 2) * 0.3, 0.17, 1.0, 3), (t) => 0.034 * Math.sin(Math.PI * (0.1 + 0.85 * t)), fkSide(ya), [FK.LEAF, 0.0, 0.45], [0, 0, 0], leaf, leaf); }
    for (let k = 0; k < 6; k++) { const a = (k / 6) * TAU + 0.2, at = [Math.cos(a) * 0.08, 0.09, Math.sin(a) * 0.08]; fkTube(b, [at, fv.add(at, [Math.cos(a) * 0.02, 0.05, Math.sin(a) * 0.02])], (t) => 0.007 * (1 - t), 3, [FK.GLOW, 0.4, 0.8], at, ice, ice); }
  },
  herb_storm(b) {
    const stem = hexc('#4a6a40'), leaf = hexc('#45683a'), head = hexc('#7a5ac8');
    fkTube(b, [[0, 0, 0], [0.01, 0.28, 0], [0, 0.52, 0.01]], (t) => 0.012 - 0.005 * t, 4, [FK.STEM, 0.1, 0.6], [0, 0, 0], stem, stem);
    for (let k = 0; k < 4; k++) { const ya = k * 1.57 + 0.3, at = [0, 0.08 + k * 0.08, 0]; fkRibbon(b, fkArc(at, ya, 0.5, 0.18 - k * 0.02, 0.6, 5), (t) => 0.05 * Math.sin(Math.PI * (0.1 + 0.85 * t)) * (0.45 + 0.55 * Math.abs(Math.sin(t * 15))), fkSide(ya), [FK.LEAF, 0.05 * k, 0.4 + 0.08 * k], at, leaf, leaf); }
    fkBlob(b, [0, 0.55, 0.01], [0.045, 0.04, 0.045], 8, 4, [FK.HEAD, 0.55, 0.75], [0, 0.52, 0.01], head, head, false, (a, y) => 1 + 0.25 * Math.max(0, Math.sin(a * 6)) * (1 - Math.abs(y)));
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU; fkRibbon(b, [[0, 0.56, 0.01], [Math.cos(a) * 0.07, 0.6 + (k % 2) * 0.02, 0.01 + Math.sin(a) * 0.07]], (t) => 0.006 * (1 - t), fkSide(a + 1.57), [FK.GLOW, 0.6, 0.78], [0, 0.56, 0.01], hexc('#c8b4ff'), hexc('#c8b4ff')); }
  },
  herb_marsh(b) {
    const leaf = hexc('#4a7a3a'), fl = hexc('#f0c63a');
    for (let k = 0; k < 6; k++) { const ya = (k / 6) * TAU + 0.2; fkRibbon(b, fkArc([0, 0, 0], ya, 1.35, 0.5, 0.5, 3), (t) => 0.03 * (1 - Math.pow(t, 2)) + 0.003, fkSide(ya), [FK.LEAF, 0.0, 0.5], [0, 0, 0], leaf, leaf); }
    for (const sd of [0.3, 3.4]) {
      const top = [Math.sin(sd) * 0.06, 0.55, Math.cos(sd) * 0.06];
      fkRibbon(b, [[0, 0, 0], fv.mix([0, 0, 0], top, 0.5), top], () => 0.008, fkSide(sd + 1.5), [FK.STEM, 0.3, 0.65], [0, 0, 0], leaf, leaf);
      for (let q = 0; q < 4; q++) { const a = q * 1.6 + sd; fkStar(b, fv.add(top, [Math.cos(a) * 0.03, (q % 2) * 0.02, Math.sin(a) * 0.03]), [Math.cos(a) * 0.5, 1, Math.sin(a) * 0.5], 0.026, 5, 0.25, [FK.FLOWER, 0.6, 0.72], top, fl, fl, 0.5); }
    }
  },
  herb_moon(b) {
    const frond = (t) => fv.mix(hexc('#4a7a64'), hexc('#b4e4d4'), t * 0.75);
    for (let k = 0; k < 7; k++) { const ya = (k / 7) * TAU + 0.3; fkRibbon(b, fkArc([0, 0, 0], ya, 1.25, 0.55, 1.7, 8), (t) => (0.012 + 0.07 * Math.sin(Math.PI * (0.08 + 0.9 * t))) * (0.25 + 0.75 * Math.abs(Math.sin(t * 22))), fkSide(ya), [k % 2 ? FK.LEAF : FK.GLOW, 0.0, 0.55], [0, 0, 0], frond, frond); }
  },
  herb_stone(b) {
    const moss = (y) => fv.mix(hexc('#4a5a32'), hexc('#7a8a4a'), (y + 1) / 2), fl = hexc('#f0b4c4');
    fkBlob(b, [0, 0, 0], [0.16, 0.07, 0.16], 9, 3, [FK.LEAF, 0.0, 0.5], [0, 0, 0], moss, moss, true, (a, y) => 1 + 0.08 * Math.sin(a * 7) * (1 - y));
    for (let k = 0; k < 9; k++) { const a = k * 2.4, rr = 0.03 + (k % 3) * 0.04, y = 0.07 * Math.sqrt(1 - (rr / 0.16) ** 2); fkStar(b, [Math.cos(a) * rr, y + 0.004, Math.sin(a) * rr], [Math.cos(a) * rr * 3, 1, Math.sin(a) * rr * 3], 0.014, 4, 0.1, [FK.FLOWER, 0.5, 0.7], [Math.cos(a) * rr, y, Math.sin(a) * rr], fl, fl, 0.5); }
  },
};
// colours of the colour trait: [unripe or flower at 0, at 1] and [ripe at 0, at 1]; glow: 1 flowers by night, 2 bits, 3 sparks in storms
const FARM_LOOK = {
  grain: { a: ['#7a9a38', '#7a9238'], b: ['#e2c46a', '#b8642e'], flowerEnd: 0.9 },
  flax: { a: ['#9cc8f4', '#9a7ae0'], b: ['#b08a48', '#9a7040'], flowerEnd: 0.8 },
  cabbage: { a: ['#8fb46e', '#7a4a8a'], b: ['#a8cc84', '#6a3a7a'], flowerEnd: 2 },
  turnip: { a: ['#f2eee4', '#b06aa8'], b: ['#f2eee4', '#8a3a8a'], flowerEnd: 2 },
  beans: { a: ['#f4f2ea', '#c49ae0'], b: ['#5a4a2e', '#3a2a24'], flowerEnd: 0.76 },
  grain_lo: null, flax_lo: null, cabbage_lo: null, turnip_lo: null, beans_lo: null,
  weed: { a: ['#8a6a3a', '#8a6a3a'], b: ['#8a5a32', '#8a5a32'], flowerEnd: 2 },
  herb_heal: { a: ['#e88ab8', '#8a3ab0'], b: ['#9a6a7a', '#6a3a6a'], flowerEnd: 2 },
  herb_mana: { a: ['#f4f6ff', '#a8c8ff'], b: ['#e4ecff', '#98b8f8'], flowerEnd: 2, glow: 1 },
  herb_fire: { a: ['#ff7a2a', '#c8201a'], b: ['#ff6a22', '#b01810'], flowerEnd: 2, glow: 2 },
  herb_frost: { a: ['#e8f4f8', '#c4e4ff'], b: ['#e8f4f8', '#c4e4ff'], flowerEnd: 2, glow: 2 },
  herb_storm: { a: ['#8a6ae0', '#4a6ae8'], b: ['#7a5ac8', '#3a4ac0'], flowerEnd: 2, glow: 3 },
  herb_marsh: { a: ['#f8e04a', '#e8a822'], b: ['#d8b03a', '#c88a1a'], flowerEnd: 2 },
  herb_moon: { a: ['#a8e8d8', '#a8d0f8'], b: ['#a8e8d8', '#a8d0f8'], flowerEnd: 2, glow: 1 },
  herb_stone: { a: ['#ffffff', '#f4a0b8'], b: ['#f0e8e0', '#e890a8'], flowerEnd: 2 },
};

/* ---- the plant shader ---- */
const FARM_PLANT_VS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  uniform vec2 uWindDir;
  uniform float uWind, uFlowerEnd, uDrawR;
  uniform vec3 uHueA0, uHueA1, uHueB0, uHueB1;
  attribute vec4 aPart;
  attribute vec3 aAnchor, aCol, aRip;
  attribute vec4 iP, iG, iT, iX;
  varying vec3 vW, vN, vCol;
  varying vec4 vInfo;
  varying float vFade;
  void main(){
    float g = clamp(iG.x, 0.0, 1.0), kind = aPart.x;
    // a part grows out of where it is joined on; flowers drop when their time is over
    float s = smoothstep(aPart.z, aPart.w, g);
    if (kind > 2.5 && kind < 3.5) s *= 1.0 - smoothstep(uFlowerEnd, uFlowerEnd + 0.05, g);
    vec3 p = aAnchor + (position - aAnchor) * s;
    // wilting and death: leaves hang, the whole plant slumps
    float wilt = clamp(iG.w + iT.w * 0.8, 0.0, 1.0);
    if (kind > 0.5 && kind < 1.5) { float L = length(position - aAnchor); p.y -= wilt * aPart.y * aPart.y * L * 0.75 * s; p.xz *= 1.0 + wilt * 0.15 * aPart.y; }
    p.y *= 1.0 - 0.35 * iT.w;
    // the plant as a whole: small when young, its height from its trait
    float hs = iT.y;
    p.y *= mix(0.3, 1.0, smoothstep(0.0, 0.55, g)) * hs;
    p.xz *= mix(0.45, 1.0, smoothstep(0.0, 0.45, g)) * mix(1.0, hs, 0.3);
    // ripe ears nod
    if (kind > 1.5 && kind < 2.5) p.xz += normalize(p.xz + vec2(1e-4)) * iG.z * 0.06 * aPart.y;
    // trampled or laid flat by a storm: the stems go over
    float trod = clamp(iX.x, 0.0, 1.0);
    float ta = iT.z * 6.2831;
    vec2 td = vec2(sin(ta), cos(ta));
    float lean = trod * 1.2, h0 = p.y;
    p.y = h0 * cos(lean);
    p.xz += td * h0 * sin(lean);
    // the wind: gusts running over the field, each plant with its own flutter, more at the top
    float gust = vnoise(iP.xz * 0.07 - uWindDir * uTime * 0.45);
    float fl = sin(uTime * (1.6 + iT.z * 1.3) + iT.z * 40.0 + iP.x * 0.4);
    vec2 bend = uWindDir * uWind * (0.03 + 0.11 * gust * gust) + vec2(-uWindDir.y, uWindDir.x) * fl * 0.02 * uWind;
    float hh = max(p.y, 0.0);
    p.xz += bend * (1.0 - trod * 0.8) * hh * hh * 1.8;
    p.y -= dot(bend, bend) * hh * hh * 0.6;
    float c = cos(iP.w), sn = sin(iP.w);
    vec3 w = iP.xyz + vec3(p.x * c + p.z * sn, p.y, -p.x * sn + p.z * c);
    vN = vec3(normal.x * c + normal.z * sn, normal.y, -normal.x * sn + normal.z * c);
    // colour: green to ripe, the colour trait on ears, flowers and fruit, sick plants yellow, dead ones brown
    float ripe = clamp(iG.z, 0.0, 1.0);
    vec3 col = mix(aCol, aRip, ripe);
    if (kind > 1.5 && kind < 3.5 || kind > 4.5) {
      vec3 hc = mix(mix(uHueA0, uHueA1, iT.x), mix(uHueB0, uHueB1, iT.x), ripe);
      col = mix(col, hc, kind > 2.5 && kind < 3.5 ? 1.0 : 0.8);
    }
    float hp = clamp(iG.y, 0.0, 1.0);
    vec3 sick = vec3(0.62, 0.55, 0.22) * (dot(col, vec3(0.33)) + 0.25);
    col = mix(col, sick, (1.0 - hp) * 0.7);
    col = mix(col, vec3(0.3, 0.22, 0.12), iT.w * 0.8);
    vCol = col;
    vInfo = vec4(kind, aPart.y, iX.y, iX.z);
    vFade = 1.0 - smoothstep(uDrawR * 0.82, uDrawR, distance(w.xz, cameraPosition.xz));
    vW = w;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const FARM_PLANT_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_WORLD}
  ${GLSL_SHADOW}
  ${GLSL_PLIGHT}
  ${GLSL_LIGHT}
  ${GLSL_WEATHER}
  uniform float uWet, uSnowCover, uFarmFrost, uGlowK;
  uniform float uStorm;
  varying vec3 vW, vN, vCol;
  varying vec4 vInfo;
  varying float vFade;
  void main(){
    if (vFade < 0.999 && vFade < bayer4(gl_FragCoord.xy)) discard;
    vec3 n = safeNormalize(vN);
    if (!gl_FrontFacing) n = -n;
    vec3 V = safeNormalize(cameraPosition - vW);
    gSh = shadowAt(vW, n);
    gPL = pointLights(vW, n);
    float kind = vInfo.x, t = vInfo.y;
    vec3 alb = vCol * (0.8 + 0.3 * t);
    // a fine vein and a paler midrib on the leaves
    if (kind > 0.5 && kind < 1.5) alb *= 0.94 + 0.08 * smoothstep(0.3, 0.9, vnoise(vW.xz * 40.0 + vW.y * 30.0));
    float canopy = canopyAt(vW.xz);
    float wet = uWet * (1.0 - 0.8 * canopy);
    alb = wetAlbedo(alb, wet, 0.3);
    // frost: rime on the edges and tips on a cold night, worst on a frost-bitten plant
    float rime = clamp(uFarmFrost * (0.5 + 0.5 * vInfo.w), 0.0, 1.0) * smoothstep(0.2, 0.9, t + 0.25 * vnoise(vW.xz * 31.0));
    alb = mix(alb, vec3(0.8, 0.86, 0.94), rime * 0.75);
    float snow = snowAmount(vW, n, uSnowCover * (1.0 - 0.7 * canopy), gPL);
    alb = mix(alb, snowAlbedo(vW), snow * 0.9);
    // burnt to black stubs
    alb = mix(alb, vec3(0.03, 0.026, 0.022) * (0.6 + 0.5 * vnoise(vW.xz * 20.0)), vInfo.z);
    float ndl = dot(n, uLightDir);
    float wrap = clamp(ndl * 0.55 + 0.45, 0.0, 1.0);
    // sunlight through thin leaves and petals from behind
    float back = spow(clamp(dot(-V, uLightDir), 0.0, 1.0), 4.0) * (kind < 1.5 || (kind > 2.5 && kind < 3.5) ? 0.55 : 0.12);
    float ao = mix(0.55, 1.0, smoothstep(0.0, 0.7, t));
    vec3 col = alb * (uAmbient * (0.5 + 0.3 * clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * ao + uLightColor * (0.72 * wrap + back) * mix(0.25, 1.0, gSh) + gPL);
    vec3 H = safeNormalize(uLightDir + V);
    col += uLightColor * spow(max(dot(n, H), 0.0), 36.0) * (0.03 + 0.45 * wet) * gSh;
    col += wetSheen(vW, n, V, wet * 0.5, 0.35, gSh) * 0.6;
    col += vec3(snowSparkle(vW, V, gSh)) * (snow + rime * 0.6) * uLightColor * 0.8;
    // herbs of the night: a glow of their own after dark; thunder thistle crackles in a storm
    if (uGlowK > 0.5) {
      float glowPart = (uGlowK < 1.5 ? step(2.5, kind) * step(kind, 4.5) : step(3.5, kind) * step(kind, 4.5)) * (1.0 - vInfo.z);
      float k = uGlowK > 2.5 ? uStorm * step(0.6, fract(uTime * 3.0 + vW.x * 7.0)) * 2.0 : uNight * (0.7 + 0.3 * sin(uTime * 1.3 + vW.x * 3.0));
      col += vCol * glowPart * k * 1.4;
    }
    gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
  }`;
const farmPlantMat = mat({
  side: THREE.DoubleSide,
  uniforms: {
    ...FU, uFlowerEnd: { value: 2 }, uGlowK: { value: 0 }, uStorm: { value: 0 },
    uHueA0: { value: new THREE.Vector3() }, uHueA1: { value: new THREE.Vector3() }, uHueB0: { value: new THREE.Vector3() }, uHueB1: { value: new THREE.Vector3() },
  },
  vertexShader: FARM_PLANT_VS, fragmentShader: FARM_PLANT_FS,
});
const FARM_SPECIES = {};
const FARM_STORM = { value: 0 };
function farmSpecies(id, cap) {
  const b = fkNew();
  FARM_MODELS[id](b);
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(b.p, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(b.n, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(b.a, 4));
  g.setAttribute('aAnchor', new THREE.Float32BufferAttribute(b.o, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(b.c, 3));
  g.setAttribute('aRip', new THREE.Float32BufferAttribute(b.r, 3));
  g.setIndex(b.i);
  const arr = {};
  for (const k of ['iP', 'iG', 'iT', 'iX']) { arr[k] = new Float32Array(cap * 4); g.setAttribute(k, new THREE.InstancedBufferAttribute(arr[k], 4).setUsage(THREE.DynamicDrawUsage)); }
  g.instanceCount = 0;
  const L = FARM_LOOK[id] || FARM_LOOK[id.replace('_lo', '')];
  const v3 = (h) => new THREE.Vector3(...hex3(h));
  const m = shareMat(farmPlantMat, {
    uHueA0: { value: v3(L.a[0]) }, uHueA1: { value: v3(L.a[1]) }, uHueB0: { value: v3(L.b[0]) }, uHueB1: { value: v3(L.b[1]) },
    uFlowerEnd: { value: L.flowerEnd }, uGlowK: { value: L.glow || 0 }, uStorm: FARM_STORM,
  });
  const mesh = new THREE.Mesh(g, m);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  scene.add(mesh);
  const proxy = shadowCaster(mesh, depthFrom(m));
  const S = { id, mesh, g, arr, cap, n: 0, tris: b.i.length / 3, proxy };
  FARM_SPECIES[id] = S;
  return S;
}
function farmPush(S, x, y, z, yaw, g, hp, ripe, wilt, hue, hs, seed, dead, trod, char, bite) {
  if (!S || S.n >= S.cap) return;
  const o = S.n * 4, A = S.arr;
  A.iP[o] = x; A.iP[o + 1] = y; A.iP[o + 2] = z; A.iP[o + 3] = yaw;
  A.iG[o] = g; A.iG[o + 1] = hp; A.iG[o + 2] = ripe; A.iG[o + 3] = wilt;
  A.iT[o] = hue; A.iT[o + 1] = hs; A.iT[o + 2] = seed; A.iT[o + 3] = dead;
  A.iX[o] = trod; A.iX[o + 1] = char; A.iX[o + 2] = bite; A.iX[o + 3] = 0;
  S.n++;
}
function farmFlush(S) {
  S.g.instanceCount = S.n;
  for (const k of ['iP', 'iG', 'iT', 'iX']) {
    const at = S.g.attributes[k];
    if (at.clearUpdateRanges) { at.clearUpdateRanges(); at.addUpdateRange(0, Math.max(4, S.n * 4)); }
    at.needsUpdate = true;
  }
}

/* ---- the soil: furrowed beds, one merged mesh; each bed's state in a texture row ---- */
const FARM_TEXW = 256;
const farmPlotData = new Uint8Array(FARM_TEXW * 4 * 4);
const farmPlotTex = new THREE.DataTexture(farmPlotData, FARM_TEXW, 4, THREE.RGBAFormat, THREE.UnsignedByteType);
farmPlotTex.minFilter = THREE.NearestFilter; farmPlotTex.magFilter = THREE.NearestFilter; farmPlotTex.generateMipmaps = false;
farmPlotTex.needsUpdate = true;
FU.uPlotTex.value = farmPlotTex;
const FARM_SOIL_VS = /* glsl */`
  uniform sampler2D uPlotTex;
  attribute vec4 aS, aR;
  varying vec3 vW, vN;
  varying vec4 vS, vR, vP0, vP1, vP2;
  void main(){
    float row = (aS.w + 0.5) / ${FARM_TEXW.toFixed(1)};
    vec4 p0 = textureLod(uPlotTex, vec2(row, 0.125), 0.0), p1 = textureLod(uPlotTex, vec2(row, 0.375), 0.0), p2 = textureLod(uPlotTex, vec2(row, 0.625), 0.0);
    vec3 p = position;
    // ground not yet tilled (a strip ahead of the plough, a bed gone back to rest) lies flatter
    float tilled = step(aR.y, p0.a + 0.001) * p2.r;
    p.y -= aR.x * 0.075 * aS.z * (1.0 - tilled);
    vW = p; vN = normal; vS = aS; vR = vec4(aR.x, tilled, aR.y, aR.w); vP0 = p0; vP1 = p1; vP2 = p2;
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
  }`;
const FARM_SOIL_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_WORLD}
  ${GLSL_SHADOW}
  ${GLSL_PLIGHT}
  ${GLSL_LIGHT}
  ${GLSL_WEATHER}
  uniform float uWet, uSnowCover, uFarmFrost, uDrawR;
  varying vec3 vW, vN;
  varying vec4 vS, vR, vP0, vP1, vP2;
  // the lumps of the turned earth (two octaves), and their slope by small differences: a bump without screen-space seams
  float clodH(vec2 p, float fine){ return vnoise(p * 3.6) * 0.62 + vnoise(p * 8.5 + 3.0) * 0.38 * (0.4 + 0.6 * fine); }
  void main(){
    vec3 n = safeNormalize(vN);
    float d = distance(vW, cameraPosition);
    float fine = 1.0 - smoothstep(8.0, 36.0, d);
    float ridge = vR.x, tilled = vR.y;
    float moist = vP0.r, manure = vP0.g, charK = vP0.b;
    // lumps of turned earth, a finer crumb on them, a pebble here and there
    float clod = clodH(vW.xz, fine);
    float crumb = vnoise(vW.xz * 21.0) * fine;
    float stone = smoothstep(0.86, 0.93, vnoise(vW.xz * 10.0 + 7.7)) * fine;
    if (fine > 0.01) {
      const float E = 0.04;
      float gx = (clodH(vW.xz + vec2(E, 0.0), fine) - clod) / E, gz = (clodH(vW.xz + vec2(0.0, E), fine) - clod) / E;
      n = safeNormalize(n + vec3(-gx, 0.0, -gz) * 0.07 * fine);
    }
    gSh = shadowAt(vW, n);
    gPL = pointLights(vW, n);
    // freshly turned loam on the ridges, darker and damper down in the furrows
    vec3 loam = mix(vec3(0.19, 0.135, 0.09), vec3(0.37, 0.28, 0.19), smoothstep(0.15, 0.85, clod));
    loam *= (0.93 + 0.12 * crumb) * mix(0.8, 1.06, ridge);
    loam = mix(loam, vec3(0.44, 0.42, 0.38), stone * 0.75);
    // settled ground and stubble where it has not been tilled again
    vec2 cq = vW.xz * 9.0, cc = floor(cq), cf = fract(cq) - 0.5;
    float ca = hash12(cc) * 6.2831;
    vec2 cd = vec2(cos(ca), sin(ca));
    float stroke = (1.0 - smoothstep(0.03, 0.08, abs(dot(cf, vec2(-cd.y, cd.x))))) * (1.0 - smoothstep(0.2, 0.36, abs(dot(cf, cd)))) * step(0.45, hash12(cc + 5.1));
    vec3 settled = mix(vec3(0.3, 0.25, 0.18), vec3(0.36, 0.31, 0.22), clod);
    settled = mix(settled, vec3(0.7, 0.6, 0.34), stroke * vP2.g * fine);
    loam = mix(settled, loam, tilled);
    // the stubble left behind the harvesters as they work along the strip
    loam = mix(loam, vec3(0.72, 0.62, 0.36), stroke * step(vR.z, vP2.a) * fine * 0.9);
    // manure: darker, with straw in it
    loam = mix(loam, vec3(0.13, 0.09, 0.06) + stroke * vec3(0.3, 0.24, 0.1) * fine, manure * 0.7);
    // damp from below: darker; rain on it: dark and shining, water standing in the furrows
    float canopy = canopyAt(vW.xz);
    float rainWet = uWet * (1.0 - 0.8 * canopy);
    float damp = max(moist * 0.75, rainWet);
    loam = wetAlbedo(loam, damp, 0.8);
    // a parched bed pales and cracks
    float parch = (1.0 - smoothstep(0.03, 0.15, moist)) * (1.0 - rainWet);
    float crack = 1.0 - smoothstep(0.02, 0.06, abs(vnoise(vW.xz * 6.0) - 0.5)) ;
    loam = mix(loam, vec3(0.5, 0.42, 0.32) * (1.0 - 0.6 * crack * fine), parch * 0.55);
    // ash after a fire
    loam = mix(loam, vec3(0.05, 0.045, 0.04) + vec3(0.18) * smoothstep(0.6, 0.85, vnoise(vW.xz * 5.0)), charK * 0.85);
    vec3 col = lightSurface(loam, n, mix(0.55, 1.0, ridge));
    vec3 V = safeNormalize(cameraPosition - vW);
    float puddle = smoothstep(0.55, 0.95, rainWet) * (1.0 - smoothstep(0.05, 0.32, ridge)) * smoothstep(0.52, 0.68, vnoise(vW.xz * 1.1 + 2.0));
    col += wetSheen(vW, n, V, rainWet * 0.55, 0.75, gSh) * 0.8;
    if (puddle > 0.001) {
      vec3 Rr = reflect(-V, vec3(0.0, 1.0, 0.0));
      vec3 sky = skyBase(safeNormalize(vec3(Rr.x, max(Rr.y, 0.03), Rr.z)));
      float fres = 0.04 + 0.96 * spow(1.0 - max(V.y, 0.0), 5.0);
      col = mix(col, sky * 0.6 + gPL * 0.3, puddle * (0.25 + 0.5 * fres));
    }
    // frost on the ridges on a cold night, snow lying in the furrows' lee
    float rime = uFarmFrost * smoothstep(0.35, 0.9, ridge + 0.3 * clod) * (1.0 - canopy * 0.6);
    col = mix(col, lightSurface(vec3(0.78, 0.82, 0.88), n, 1.0), rime * 0.7);
    col += vec3(snowSparkle(vW, V, gSh)) * rime * uLightColor;
    float sn = snowAmount(vW, vec3(0.0, 1.0, 0.0), uSnowCover * (1.0 - 0.7 * canopy) * (0.75 + 0.5 * ridge), gPL);
    col = mix(col, lightSurface(snowAlbedo(vW), vec3(0.0, 1.0, 0.0), 1.0), sn);
    // seen from afar, a sown bed takes the colour of its crop
    float far = smoothstep(uDrawR * 0.6, uDrawR, d) * vP1.a;
    col = mix(col, lightSurface(vP1.rgb, vec3(0.0, 1.0, 0.0), 1.0) * (0.85 + 0.25 * vnoise(vW.xz * 0.9)), far);
    // the edge of the bed sinks into the turf
    col *= mix(0.72, 1.0, smoothstep(0.0, 0.6, vS.z));
    col *= 1.0 - 0.3 * groundAO(vW.xz);
    gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
  }`;
const farmSoilMat = mat({ uniforms: { ...FU }, vertexShader: FARM_SOIL_VS, fragmentShader: FARM_SOIL_FS, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -6 });
let farmSoilMesh = null;
// the furrowed ground of every bed: ridges along the furrows with the plants on their crests, sinking into the turf at the edges
function farmBuildSoil() {
  const pos = [], nrm = [], aS = [], aR = [], idx = [];
  for (const P of FARM.plots) {
    const du = 0.15, dv = 0.5;
    const nu = Math.ceil((2 * P.hw) / du) + 1, nv = Math.ceil((2 * P.hd) / dv) + 1;
    const base = pos.length / 3;
    const ok = new Uint8Array(nu * nv);
    for (let jv = 0; jv < nv; jv++) {
      const v = -P.hd + (jv * 2 * P.hd) / (nv - 1);
      for (let iu = 0; iu < nu; iu++) {
        const u = -P.hw + (iu * 2 * P.hw) / (nu - 1);
        const w = plotWorld(P, u, v);
        let e = sstep(0, 0.35, Math.min(P.hw - Math.abs(u), P.hd - Math.abs(v)));
        let valid = 1;
        if (P.valid) {
          const vs = (s) => P.valid[s] === 1;
          const s = plotSlotAt(P, w.x, w.z);
          valid = vs(s) ? 1 : 0;
          // ease down beside a gap in the strip
          if (valid) for (const [a, c] of [[0.35, 0], [-0.35, 0], [0, 0.35], [0, -0.35]]) { const q = plotWorld(P, u + a, v + c); if (!vs(plotSlotAt(P, q.x, q.z))) { e = Math.min(e, 0.3); break; } }
        }
        ok[jv * nu + iu] = valid;
        const ridge = 0.5 + 0.5 * Math.cos(TAU * ((u + P.hw) / FARM_SP - 0.5));
        const y = heightAt(w.x, w.z) + 0.012 + 0.03 * e + 0.075 * ridge * e;
        pos.push(w.x, y, w.z);
        aS.push(u, v, e, P.idx);
        aR.push(ridge, (v + P.hd) / (2 * P.hd), P.own === 't' ? 1 : 0, hash2(P.id, iu * 31 + jv));
      }
    }
    // normals from the grid
    for (let jv = 0; jv < nv; jv++) for (let iu = 0; iu < nu; iu++) {
      const k = (base + jv * nu + iu) * 3;
      const kx0 = (base + jv * nu + Math.max(0, iu - 1)) * 3, kx1 = (base + jv * nu + Math.min(nu - 1, iu + 1)) * 3;
      const kz0 = (base + Math.max(0, jv - 1) * nu + iu) * 3, kz1 = (base + Math.min(nv - 1, jv + 1) * nu + iu) * 3;
      const ta = [pos[kx1] - pos[kx0], pos[kx1 + 1] - pos[kx0 + 1], pos[kx1 + 2] - pos[kx0 + 2]], tb = [pos[kz1] - pos[kz0], pos[kz1 + 1] - pos[kz0 + 1], pos[kz1 + 2] - pos[kz0 + 2]];
      let N = fv.nrm(fv.cross(tb, ta));
      if (N[1] < 0) N = fv.sc(N, -1);
      nrm[k] = N[0]; nrm[k + 1] = N[1]; nrm[k + 2] = N[2];
    }
    for (let jv = 0; jv < nv - 1; jv++) for (let iu = 0; iu < nu - 1; iu++) {
      const a = jv * nu + iu, b2 = a + 1, c = a + nu, d = c + 1;
      if (!(ok[a] && ok[b2] && ok[c] && ok[d])) continue;
      idx.push(base + a, base + c, base + d, base + a, base + d, base + b2);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aS', new THREE.Float32BufferAttribute(aS, 4));
  g.setAttribute('aR', new THREE.Float32BufferAttribute(aR, 4));
  g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1));
  g.computeBoundingSphere();
  if (!farmSoilMesh) {
    farmSoilMesh = new THREE.Mesh(g, farmSoilMat);
    farmSoilMesh.renderOrder = 1;
    farmSoilMesh.frustumCulled = false;
    scene.add(farmSoilMesh);
  } else { farmSoilMesh.geometry.dispose(); farmSoilMesh.geometry = g; }
  FARM.soilDirty = false;
}
// each bed's state for the soil shader: water, manure, ash, how far it is tilled; its crop's colour from afar; ridges, stubble
function farmPlotTexUpdate() {
  const D = farmPlotData, W4 = FARM_TEXW * 4;
  FARM.plots.forEach((P, i) => {
    if (i >= FARM_TEXW) return;
    const o = i * 4;
    const T = P.stand;
    let front = 1, ridge = clamp(P.till, 0, 1), stub = 0, cut = 0;
    if (T) {
      if (T.task === 'till') { front = T.p; ridge = 1; }
      else if (T.task === 'harvest') cut = T.p;
      else if (T.phase === 'stubble' || T.phase === 'fallow') { front = 0; ridge = 1; stub = T.phase === 'stubble' ? 1 : 0.4; }
    }
    D[o] = Math.round(P.moist * 255); D[o + 1] = Math.round(clamp(P.manure, 0, 1) * 255); D[o + 2] = Math.round(clamp(P.char, 0, 1) * 255); D[o + 3] = Math.round(clamp(front, 0, 1) * 255);
    // the crop's colour and how thickly it covers the bed
    let cov = 0, rgb = [0.3, 0.45, 0.2];
    if (P.plants) {
      let n = 0, g = 0, crop = null;
      for (const q of P.plants) if (q && !q.dead) { n++; g += q.g; crop = q.crop; }
      if (n && crop) { const C = FARM_CROPS[crop]; g /= n; cov = (n / P.plants.length) * sstep(0.15, 0.6, g) * 0.8; rgb = fv.mix(C.cover, C.ripeCover, sstep(0.84, 1, g)); }
    } else if (T && T.phase === 'sown' && !T.dead) {
      const C = FARM_CROPS[T.crop]; cov = sstep(0.15, 0.6, T.g) * (T.task === 'harvest' ? 1 - T.p : 1) * 0.85; rgb = fv.mix(C.cover, C.ripeCover, sstep(0.84, 1, T.g));
    }
    D[W4 + o] = Math.round(clamp(rgb[0], 0, 1) * 255); D[W4 + o + 1] = Math.round(clamp(rgb[1], 0, 1) * 255); D[W4 + o + 2] = Math.round(clamp(rgb[2], 0, 1) * 255); D[W4 + o + 3] = Math.round(cov * 255);
    D[2 * W4 + o] = Math.round(ridge * 255); D[2 * W4 + o + 1] = Math.round(stub * 255); D[2 * W4 + o + 2] = Math.round(P.weeds * 255); D[2 * W4 + o + 3] = Math.round(clamp(cut, 0, 1) * 255);
  });
  farmPlotTex.needsUpdate = true;
}

/* ---- the outline of a bed about to be tilled ---- */
let farmOutline = null;
const farmOutlineMat = mat({
  transparent: true, depthWrite: false,
  uniforms: { uOk: { value: 1 } },
  vertexShader: /* glsl */`attribute float aL; varying float vL; varying vec3 vW; void main(){ vL = aL; vW = position; gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform float uOk;
    varying float vL; varying vec3 vW;
    void main(){
      float dash = step(0.45, fract(vL * 2.2 - uTime * 0.8));
      vec3 c = uOk > 0.5 ? vec3(0.95, 0.85, 0.45) : vec3(1.0, 0.4, 0.3);
      gl_FragColor = vec4(c * (0.8 + 0.4 * sin(uTime * 4.0)), (0.35 + 0.45 * dash) * 0.85);
    }`,
});
function farmUpdateOutline(T) {
  if (!farmOutline) {
    const n = 4 * 12;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 2 * 3), 3));
    g.setAttribute('aL', new THREE.Float32BufferAttribute(new Float32Array(n * 2), 1));
    const idx = [];
    for (let k = 0; k < n; k++) { const a = k * 2, b = ((k + 1) % n) * 2; idx.push(a, a + 1, b + 1, a, b + 1, b); }
    g.setIndex(idx);
    farmOutline = new THREE.Mesh(g, farmOutlineMat);
    farmOutline.frustumCulled = false; farmOutline.renderOrder = 6;
    scene.add(farmOutline);
  }
  if (!T) { farmOutline.visible = false; return; }
  farmOutline.visible = true;
  farmOutlineMat.uniforms.uOk.value = T.why ? 0 : 1;
  const ax = Math.sin(T.ang), az = Math.cos(T.ang), bx = Math.cos(T.ang), bz = -Math.sin(T.ang);
  const corners = [[-T.hw, -T.hd], [T.hw, -T.hd], [T.hw, T.hd], [-T.hw, T.hd]];
  const pos = farmOutline.geometry.attributes.position.array, L = farmOutline.geometry.attributes.aL.array;
  let k = 0, len = 0;
  for (let c = 0; c < 4; c++) {
    const [u0, v0] = corners[c], [u1, v1] = corners[(c + 1) % 4];
    for (let s = 0; s < 12; s++) {
      const t = s / 12, u = lerp(u0, u1, t), v = lerp(v0, v1, t);
      const x = T.x + u * bx + v * ax, z = T.z + u * bz + v * az;
      // a band 8 cm wide on the ground, inside the line
      const ix = -Math.sign(u) * (Math.abs(u) >= T.hw - 1e-3 ? 1 : 0), iz = -Math.sign(v) * (Math.abs(v) >= T.hd - 1e-3 ? 1 : 0);
      const ox = (ix * bx + iz * ax) * 0.08, oz = (ix * bz + iz * az) * 0.08;
      const y = heightAt(x, z) + 0.07;
      pos.set([x, y, z, x + ox, heightAt(x + ox, z + oz) + 0.07, z + oz], k * 6);
      L[k * 2] = len; L[k * 2 + 1] = len;
      len += (c % 2 ? 2 * T.hd : 2 * T.hw) / 12;
      k++;
    }
  }
  farmOutline.geometry.attributes.position.needsUpdate = true;
  farmOutline.geometry.attributes.aL.needsUpdate = true;
}

/* ---- building and drawing ---- */
function farmBuildDraw() {
  for (const id of ['grain', 'flax', 'cabbage', 'turnip', 'beans', 'weed', 'grain_lo', 'flax_lo', 'cabbage_lo', 'turnip_lo', 'beans_lo']) farmSpecies(id, FARM_CAP[id]);
  for (const id of FARM_HERB_IDS) farmSpecies(id, 900);
  farmBuildSoil();
  farmPlotTexUpdate();
}
// every plant near the camera into its kind's instances
function farmFill() {
  for (const k in FARM_SPECIES) FARM_SPECIES[k].n = 0;
  const R = FARM_DRAW_R[quality.level] || 50, R2 = R * R, HR2 = (FARM_HI_R[quality.level] || 12) ** 2;
  const SP = (id, d2) => (d2 < HR2 || !FARM_SPECIES[id + '_lo'] ? FARM_SPECIES[id] : FARM_SPECIES[id + '_lo']);
  const cx = camera.position.x, cz = camera.position.z;
  FU.uDrawR.value = R;
  if (INDOOR.on) { for (const k in FARM_SPECIES) farmFlush(FARM_SPECIES[k]); return; }
  const plots = FARM.plots.filter((P) => dist2(P.x, P.z, cx, cz) < (R + P.rad) ** 2).sort((a, b) => dist2(a.x, a.z, cx, cz) - dist2(b.x, b.z, cx, cz));
  const SW = FARM_SPECIES.weed;
  for (const P of plots) {
    const lc = plotLocal(P, cx, cz);
    const i0 = clamp(Math.floor((lc.u - R + P.hw) / FARM_SP), 0, P.cols - 1), i1 = clamp(Math.ceil((lc.u + R + P.hw) / FARM_SP), 0, P.cols - 1);
    const j0 = clamp(Math.floor((lc.v - R + P.hd) / FARM_SP), 0, P.rows - 1), j1 = clamp(Math.ceil((lc.v + R + P.hd) / FARM_SP), 0, P.rows - 1);
    const T = P.stand;
    const C = T ? FARM_CROPS[T.crop] : null;
    const show = T && T.phase === 'sown' && T.task !== 'sow' ? 1 : T && T.task === 'sow' ? 2 : 0;
    const wk = P.weeds * 0.55;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const s = j * P.cols + i;
      if (P.valid && !P.valid[s]) continue;
      const p = slotPos(P, s), d2 = dist2(p.x, p.z, cx, cz);
      if (d2 > R2) continue;
      const y = heightAt(p.x, p.z) + 0.1;
      const h1 = hash2(P.id * 131 + s, 7), h2 = hash2(P.id * 71 + s, 19);
      // a weed in the furrow beside the slot
      if (h1 < wk && SW && d2 < HR2 * 2.5) { const q = plotWorld(P, slotUV(P, s)[0] + FARM_SP * 0.5, slotUV(P, s)[1] + (h2 - 0.5) * 0.3); farmPush(SW, q.x, heightAt(q.x, q.z) + 0.03, q.z, h2 * TAU, clamp(P.weeds * 1.3, 0.1, 1), 1, sstep(0.7, 1, P.weeds), 0, 0.5, 0.85 + h2 * 0.4, h1, 0, 0, P.char > 0.5 ? 1 : 0, 0); }
      if (P.plants) {
        const pl = P.plants[s];
        if (!pl) continue;
        const Sp = SP(pl.crop, d2);
        if (!Sp) continue;
        const ripe = sstep(0.84, 1, pl.g) + (pl.ripeT > 700 ? 0.15 : 0);
        farmPush(Sp, p.x, y, p.z, h1 * TAU, pl.char ? 0.6 : pl.g, pl.hp, ripe, pl.wilt, pl.tr.c, trHeight(pl.tr) * (0.9 + 0.2 * h2), h2, pl.dead ? 1 : 0, pl.trod, pl.char, pl.bite);
      } else if (show && C) {
        const S = SP(T.crop, d2);
        const frac = (j + 0.5) / P.rows;
        if (show === 2 && frac > T.p) continue;
        if (T.task === 'harvest' && frac < T.p) continue;
        const dmg = P.dmg[s];
        const g = clamp(T.g - h1 * 0.05, 0, 1);
        if (g < 0.06 && dmg < 2) continue;
        farmPush(S, p.x, y, p.z, h1 * TAU, dmg === 2 ? 0.5 : g, T.hp, sstep(0.84, 1, g), 0, (C.base[4] + (h2 - 0.5) * 0.2), 0.9 + 0.2 * h2, h2, T.dead || dmg === 2 ? 1 : 0, dmg === 1 ? 0.85 : 0, dmg === 2 ? 1 : 0, 0);
      }
    }
  }
  for (const H of FARM.herbs) {
    if (H.gone > 0 || dist2(H.x, H.z, cx, cz) > R2) continue;
    const g = farmHerbGrowth(H);
    if (g < 0.05) continue;
    farmPush(FARM_SPECIES[H.k], H.x, H.y, H.z, H.seed * TAU, g, 1, sstep(0.88, 1, g), 0, H.seed, H.s, H.seed, 0, 0, 0, 0);
  }
  for (const k in FARM_SPECIES) farmFlush(FARM_SPECIES[k]);
}
function drawFarming(dt) {
  if (!FARM.built) return;
  // the plants cast shadows only at high quality (they are many)
  const cast = quality.level === 'high';
  if (cast !== FARM.casting) {
    FARM.casting = cast;
    for (const k in FARM_SPECIES) { const px = FARM_SPECIES[k].proxy; if (!px) continue; if (cast) SHADOW.scene.add(px); else SHADOW.scene.remove(px); }
  }
  const C = FARM.clock;
  if (FARM.soilDirty) farmBuildSoil();
  const PL = GAME.player;
  FU.uFarmFrost.value = clamp((0.5 - farmTempAt(camera.position.x, camera.position.z)) / 4, 0, 1) * (INDOOR.on ? 0 : 1);
  FARM_STORM.value = WEATHER.storm || 0;
  C.draw -= dt;
  const moved = Math.abs(camera.position.x - (FARM.camX ?? 1e9)) + Math.abs(camera.position.z - (FARM.camZ ?? 1e9)) > 3;
  if (C.draw <= 0 || FARM.drawDirty || moved) {
    C.draw = 0.5;
    FARM.drawDirty = false; FARM.camX = camera.position.x; FARM.camZ = camera.position.z;
    farmFill();
    farmPlotTexUpdate();
  }
  farmUpdateCard(dt);
  const ctx = FARM.ctx;
  farmUpdateOutline(ctx && ctx.type === 'till' && GAME.started && !UI.modal && PL && PL.alive ? ctx.T : null);
}
// the farms on the maps: beds and strips as small patches in their crop's colour
function drawFarmMap(ctx, toXY, k) {
  for (const P of FARM.plots) {
    const [x, y] = toXY(P.x, P.z);
    const T = P.stand;
    let c = '#6a4a30';
    if (T && T.phase === 'sown' && !T.dead) c = T.g > 0.9 ? '#c8a44a' : '#5f8a34';
    else if (P.plants && P.plants.some((q) => q && !q.dead)) c = P.plants.some((q) => q && q.g >= 1) ? '#d8b04a' : '#6fa040';
    ctx.save(); ctx.translate(x, y); ctx.rotate(-P.ang);
    ctx.fillStyle = c; ctx.globalAlpha = 0.85;
    ctx.fillRect(-P.hw * k, -P.hd * k, Math.max(1.5, 2 * P.hw * k), Math.max(1.5, 2 * P.hd * k));
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}
function farmMapSide() {
  const P = GAME.player, t = P ? farmTempAt(P.x, P.z) : SEASON.temp;
  const own = FARM.plots.filter((Q) => Q.own === 'p');
  const ripe = own.filter((Q) => Q.plants.some((q) => q && !q.dead && q.g >= 1)).length;
  return `<p class="farmside"><b>${esc(seasonLabel())}</b> · ${Math.round(t)}°C${own.length ? ` · ${own.length} bed${own.length === 1 ? '' : 's'}${ripe ? `, ${ripe} ripe` : ''}` : ''}</p>`;
}
