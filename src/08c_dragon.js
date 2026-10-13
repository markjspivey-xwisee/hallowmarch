/* ================================================================== */
/* Cinderwing: a dragon that circles the frontier, lands to fight and     */
/* burns what stands before it. One of a kind, so it is skinned on the CPU */
/* ================================================================== */
const DRAGON_NAME = 'Cinderwing';
// bones: [name, parent, pivot] in the bind pose (metres; +Z forward, +X the dragon's left)
const DRAGON_BONES = [
  ['hips', -1, [0, 2.75, -0.3]],
  ['chest', 0, [0, 2.9, 0.7]],
  ['neck1', 1, [0, 3.2, 1.75]],
  ['neck2', 2, [0, 3.75, 2.55]],
  ['neck3', 3, [0, 4.25, 3.3]],
  ['head', 4, [0, 4.6, 4.0]],
  ['jaw', 5, [0, 4.56, 4.3]],
  ['tail1', 0, [0, 2.62, -2.4]],
  ['tail2', 7, [0, 2.3, -3.9]],
  ['tail3', 8, [0, 1.9, -5.4]],
  ['tail4', 9, [0, 1.45, -6.9]],
  ['flUp', 1, [1.05, 2.6, 1.0]], ['flLo', 11, [1.15, 1.45, 0.85]], ['flFt', 12, [1.15, 0.38, 1.05]],
  ['frUp', 1, [-1.05, 2.6, 1.0]], ['frLo', 14, [-1.15, 1.45, 0.85]], ['frFt', 15, [-1.15, 0.38, 1.05]],
  ['blUp', 0, [1.15, 2.5, -1.3]], ['blLo', 17, [1.25, 1.45, -0.8]], ['blFt', 18, [1.25, 0.5, -1.55]],
  ['brUp', 0, [-1.15, 2.5, -1.3]], ['brLo', 20, [-1.25, 1.45, -0.8]], ['brFt', 21, [-1.25, 0.5, -1.55]],
  ['wlArm', 1, [0.85, 3.45, 0.9]], ['wlHand', 23, [3.6, 4.1, 0.3]],
  ['wrArm', 1, [-0.85, 3.45, 0.9]], ['wrHand', 25, [-3.6, 4.1, 0.3]],
  ['wlF1', 24, [3.6, 4.1, 0.3]], ['wlF2', 24, [3.6, 4.1, 0.3]], ['wlF3', 24, [3.6, 4.1, 0.3]], ['wlF4', 24, [3.6, 4.1, 0.3]],
  ['wrF1', 26, [-3.6, 4.1, 0.3]], ['wrF2', 26, [-3.6, 4.1, 0.3]], ['wrF3', 26, [-3.6, 4.1, 0.3]], ['wrF4', 26, [-3.6, 4.1, 0.3]],
];
const DBI = {};
DRAGON_BONES.forEach(([n], i) => { DBI[n] = i; });
const DRAGON_FINGERS = [[8.3, 3.75, -0.35], [7.4, 3.25, -2.05], [5.6, 2.95, -3.05], [3.35, 2.95, -2.95]];
const DM = { scale: 0, belly: 1, membrane: 2, horn: 3, ivory: 4, eye: 5, spike: 6, mouth: 7 };

/* a kit like SkinKit, with up to four weighted bones per vertex */
class SkinKit4 {
  constructor() { this.pos = []; this.nrm = []; this.mat = []; this.uv = []; this.ao = []; this.bi = []; this.bw = []; this.idx = []; this.n = 0; }
  vert(p, n, o) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]);
    this.mat.push(o.mat ?? 0); this.uv.push(o.u ?? 0, o.v ?? 0); this.ao.push(o.ao ?? 1);
    let inf = o.bones;
    if (!inf) {
      const b = o.bone ?? 0, w = o.w ?? 1, par = DRAGON_BONES[b][1];
      inf = par >= 0 && w < 0.999 ? [[b, w], [par, 1 - w]] : [[b, 1]];
    }
    const tot = inf.reduce((a, q) => a + q[1], 0) || 1;
    for (let k = 0; k < 4; k++) { const q = inf[k]; this.bi.push(q ? q[0] : 0); this.bw.push(q ? q[1] / tot : 0); }
    return this.n++;
  }
  P(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  N(i) { return [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]]; }
  tri(a, b, c) {
    const f = V3.cross(V3.sub(this.P(b), this.P(a)), V3.sub(this.P(c), this.P(a)));
    const n = V3.add(V3.add(this.N(a), this.N(b)), this.N(c));
    if (V3.dot(f, n) < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
}

function buildDragonKit() {
  const K = new SkinKit4();
  const up = [0, 1, 0], side = [1, 0, 0];
  const between = (z, z0, z1) => sstepJ(z0, z1, z);
  /* body */
  const BODY = [[-2.55, 2.62, 0.55, 0.5], [-2.1, 2.68, 0.86, 0.76], [-1.5, 2.75, 1.05, 0.9], [-0.8, 2.78, 1.12, 0.98], [-0.1, 2.85, 1.15, 1.02], [0.6, 2.95, 1.12, 1.0], [1.2, 3.05, 0.98, 0.9], [1.7, 3.15, 0.76, 0.73], [2.05, 3.27, 0.56, 0.58]];
  kitTube(K, crResample(BODY, 20).map(([z, y, rx, rz]) => ({ c: [0, y, z], rx, rz })), 22, {
    front: up, side, n: 2.1,
    attr: (i, th, p) => {
      const belly = Math.cos(th) < -0.35;
      const w = between(p[2], -0.6, 0.5);
      return { bones: [[DBI.chest, w], [DBI.hips, 1 - w]], mat: belly ? DM.belly : DM.scale, ao: 0.6 + 0.4 * sstepJ(-1, 0.3, Math.cos(th)), u: th / TAU, v: p[2] * 0.9 };
    },
  });
  /* neck */
  const NECK = [[0, 3.05, 1.5, 0.62, 0.66], [0, 3.35, 2.0, 0.55, 0.58], [0, 3.75, 2.55, 0.48, 0.5], [0, 4.05, 3.0, 0.42, 0.44], [0, 4.3, 3.4, 0.38, 0.4], [0, 4.52, 3.8, 0.34, 0.36], [0, 4.62, 4.1, 0.32, 0.34]];
  const nb = (z) => (z < 2.15 ? [[DBI.neck1, between(z, 1.55, 2.1)], [DBI.chest, 1 - between(z, 1.55, 2.1)]] : z < 2.95 ? [[DBI.neck2, between(z, 2.35, 2.9)], [DBI.neck1, 1 - between(z, 2.35, 2.9)]] : z < 3.7 ? [[DBI.neck3, between(z, 3.1, 3.6)], [DBI.neck2, 1 - between(z, 3.1, 3.6)]] : [[DBI.head, between(z, 3.8, 4.05)], [DBI.neck3, 1 - between(z, 3.8, 4.05)]]);
  kitTube(K, crResample(NECK.map((r) => [r[0], r[1], r[2], r[3], r[4]]), 14).map(([x, y, z, rx, rz]) => ({ c: [x, y, z], rx, rz })), 16, {
    front: up, side, n: 2.1,
    attr: (i, th, p) => ({ bones: nb(p[2]), mat: Math.cos(th) < -0.4 ? DM.belly : DM.scale, ao: 0.7 + 0.3 * sstepJ(-1, 0.2, Math.cos(th)), u: th / TAU, v: p[2] * 1.4 }),
  });
  /* head: skull, snout, brow, horns, eyes; jaw on its own bone */
  const HB = [[DBI.head, 1]];
  kitBlob(K, [0, 4.78, 4.38], 18, 12, {
    shape: (d) => {
      const p = [d[0] * 0.36, d[1] * 0.32, d[2] * 0.5];
      p[1] += 0.08 * gauss((Math.abs(d[0]) - 0.55) / 0.3, (d[2] - 0.3) / 0.4) * Math.max(0, d[1]); // brow ridges
      if (d[1] < 0) p[1] *= 0.7;
      return p;
    },
    attr: (d) => ({ bones: HB, mat: DM.scale, ao: 0.75 + 0.25 * Math.max(0, d[1]), u: Math.atan2(d[0], d[2]) / TAU * 2, v: d[1] }),
  });
  kitTube(K, [[4.6, 4.72, 0.3, 0.24], [4.9, 4.68, 0.25, 0.2], [5.2, 4.6, 0.2, 0.16], [5.45, 4.52, 0.16, 0.13], [5.6, 4.47, 0.12, 0.1]].map(([z, y, rx, rz]) => ({ c: [0, y, z], rx, rz })), 14, {
    front: up, side, cap1: 'dome', n: 2.2,
    attr: (i, th, p) => ({ bones: HB, mat: Math.cos(th) < -0.6 ? DM.mouth : DM.scale, ao: 0.8, u: th / TAU, v: p[2] * 2 }),
  });
  kitTube(K, [[4.35, 4.48, 0.27, 0.11], [4.75, 4.4, 0.23, 0.09], [5.15, 4.34, 0.17, 0.07], [5.5, 4.31, 0.11, 0.05]].map(([z, y, rx, rz]) => ({ c: [0, y, z], rx, rz })), 12, {
    front: up, side, cap1: 'dome',
    attr: (i, th, p) => ({ bones: [[DBI.jaw, 1]], mat: Math.cos(th) > 0.5 ? DM.mouth : DM.belly, ao: 0.7, u: th / TAU, v: p[2] * 2 }),
  });
  for (const s of [1, -1]) {
    // eyes that glow like coals
    kitBlob(K, [s * 0.25, 4.88, 4.66], 10, 7, { r: [0.05, 0.045, 0.07], attr: () => ({ bones: HB, mat: DM.eye, ao: 1 }) });
    // horns sweeping back from the brow, and a row of smaller ones behind
    const horn = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; horn.push({ c: [s * (0.2 + 0.3 * t), 4.98 + 0.42 * t - 0.25 * t * t, 4.35 - 1.35 * t], rx: lerp(0.09, 0.012, t), rz: lerp(0.09, 0.012, t) }); }
    kitTube(K, horn, 8, { cap0: 'dome', cap1: 'dome', front: [0, 1, 0], attr: (i) => ({ bones: HB, mat: DM.horn, ao: 0.9, u: 0, v: i / 8 }) });
    for (let k = 0; k < 3; k++) {
      const g = new THREE.ConeGeometry(0.05, 0.28 - k * 0.05, 5);
      kitGeo(K, g, M4([s * (0.32 + 0.02 * k), 4.72 - 0.06 * k, 4.15 - k * 0.22], [-1.9, 0, s * 0.5]), { bones: HB, mat: DM.horn, ao: 0.9 });
    }
    // teeth along both jaws
    for (let k = 0; k < 7; k++) {
      const z = 4.75 + k * 0.12, rx = lerp(0.25, 0.13, k / 6);
      kitGeo(K, new THREE.ConeGeometry(0.022, 0.1, 4), M4([s * rx * 0.85, 4.47 - k * 0.012, z], [Math.PI, 0, 0]), { bones: HB, mat: DM.ivory });
      kitGeo(K, new THREE.ConeGeometry(0.02, 0.08, 4), M4([s * rx * 0.8, 4.43 - k * 0.012, z - 0.04]), { bones: [[DBI.jaw, 1]], mat: DM.ivory });
    }
    // cheek spines
    for (let k = 0; k < 3; k++) kitGeo(K, new THREE.ConeGeometry(0.035, 0.32, 5), M4([s * 0.3, 4.55 - k * 0.04, 4.35 - k * 0.18], [-1.6, 0, s * 1.1]), { bones: [[DBI.jaw, 1]], mat: DM.spike, ao: 0.9 });
    // nostrils
    kitBlob(K, [s * 0.08, 4.58, 5.55], 6, 4, { r: [0.03, 0.02, 0.025], attr: () => ({ bones: HB, mat: DM.mouth, ao: 0.4 }) });
  }
  /* tail with a spade at the end */
  const TAIL = [];
  for (let i = 0; i <= 18; i++) {
    const t = i / 18;
    TAIL.push([-2.45 - 7.0 * t, 2.62 - 1.7 * t * t - 0.2 * t, lerp(0.55, 0.07, Math.pow(t, 0.8)), lerp(0.5, 0.06, Math.pow(t, 0.8))]);
  }
  const tb = (z) => {
    const segs = [[-2.4, DBI.tail1, DBI.hips], [-3.9, DBI.tail2, DBI.tail1], [-5.4, DBI.tail3, DBI.tail2], [-6.9, DBI.tail4, DBI.tail3]];
    let out = [[DBI.hips, 1]];
    for (const [z0, b, p] of segs) if (z < z0 + 0.4) { const w = between(-z, -z0 - 0.4, -z0 + 0.4); out = [[b, w], [p, 1 - w]]; }
    return out;
  };
  kitTube(K, TAIL.map(([z, y, rx, rz]) => ({ c: [0, y, z], rx, rz })), 14, {
    front: up, side, cap1: 'dome',
    attr: (i, th, p) => ({ bones: tb(p[2]), mat: Math.cos(th) < -0.4 ? DM.belly : DM.scale, ao: 0.75 + 0.25 * sstepJ(-1, 0.2, Math.cos(th)), u: th / TAU, v: p[2] * 1.2 }), // [anim2] v toward the head, as on the body (the scales lap the same way)
  });
  {
    const spade = new THREE.ConeGeometry(0.42, 0.9, 4, 1);
    spade.scale(1, 1, 0.12);
    kitGeo(K, spade, M4([0, 0.85, -9.6], [-Math.PI / 2 - 0.18, Math.PI / 2, 0]), { bones: [[DBI.tail4, 1]], mat: DM.spike });
  }
  /* spines along the back, from the poll to the tail */
  for (let i = 0; i < 34; i++) {
    const t = i / 33;
    let pos, bones, h;
    if (t < 0.22) {
      const q = t / 0.22, z = lerp(4.0, 1.7, q);
      const r = crResample(NECK, 30).reduce((a, b) => (Math.abs(b[2] - z) < Math.abs(a[2] - z) ? b : a));
      pos = [0, r[1] + r[4] * 0.92, z]; bones = nb(z); h = 0.22 + 0.12 * q;
    } else if (t < 0.5) {
      const q = (t - 0.22) / 0.28, z = lerp(1.6, -2.3, q);
      const r = crResample(BODY, 40).reduce((a, b) => (Math.abs(b[0] - z) < Math.abs(a[0] - z) ? b : a));
      pos = [0, r[1] + r[3] * 0.95, z]; const w = between(z, -0.6, 0.5); bones = [[DBI.chest, w], [DBI.hips, 1 - w]]; h = 0.38 + 0.12 * Math.sin(q * Math.PI);
    } else {
      const q = (t - 0.5) / 0.5, z = lerp(-2.5, -8.8, q);
      const r = TAIL.reduce((a, b) => (Math.abs(b[0] - z) < Math.abs(a[0] - z) ? b : a));
      pos = [0, r[1] + r[3] * 0.9, z]; bones = tb(z); h = lerp(0.34, 0.08, q);
    }
    const g = new THREE.ConeGeometry(h * 0.32, h, 5);
    g.scale(0.45, 1, 1);
    kitGeo(K, g, M4([pos[0], pos[1] + h * 0.42, pos[2]], [-0.55, 0, 0]), { bones, mat: DM.spike, ao: 0.9 });
  }
  /* legs */
  const LEGS = [
    { pre: 'fl', s: 1, pts: [[1.0, 2.75, 1.05], [1.15, 1.45, 0.85], [1.15, 0.38, 1.05], [1.15, 0.1, 1.35]], r: [0.5, 0.36, 0.27, 0.2, 0.16] },
    { pre: 'fr', s: -1, pts: [[-1.0, 2.75, 1.05], [-1.15, 1.45, 0.85], [-1.15, 0.38, 1.05], [-1.15, 0.1, 1.35]], r: [0.5, 0.36, 0.27, 0.2, 0.16] },
    { pre: 'bl', s: 1, pts: [[1.05, 2.7, -1.3], [1.25, 1.45, -0.8], [1.25, 0.5, -1.55], [1.25, 0.1, -1.25]], r: [0.66, 0.44, 0.3, 0.2, 0.16] },
    { pre: 'br', s: -1, pts: [[-1.05, 2.7, -1.3], [-1.25, 1.45, -0.8], [-1.25, 0.5, -1.55], [-1.25, 0.1, -1.25]], r: [0.66, 0.44, 0.3, 0.2, 0.16] },
  ];
  for (const L of LEGS) {
    const bU = DBI[L.pre + 'Up'], bL = DBI[L.pre + 'Lo'], bF = DBI[L.pre + 'Ft'];
    const path = [];
    const segs = [[0, bU, 6], [1, bL, 6], [2, bF, 3]];
    for (const [g, b, n] of segs) {
      for (let i = 0; i < n; i++) {
        const t = i / n;
        const rr = lerp(L.r[g], L.r[g + 1], t) * (g === 0 ? 1 + 0.15 * Math.sin(Math.PI * t) : 1);
        const w = sstepJ(-0.2, 0.45, t);
        path.push({ c: V3.lerp(L.pts[g], L.pts[g + 1], t), rx: rr * 0.9, rz: rr, bones: g === 0 ? [[b, w], [DRAGON_BONES[b][1], 1 - w]] : [[b, w], [DRAGON_BONES[b][1], 1 - w]] });
      }
    }
    path.push({ c: L.pts[3], rx: L.r[4] * 0.9, rz: L.r[4], bones: [[bF, 1]] });
    kitTube(K, path.map((q) => ({ c: q.c, rx: q.rx, rz: q.rz })), 12, {
      cap0: 'dome', front: [0, 0, 1], side,
      attr: (i, th, p) => ({ bones: path[i].bones, mat: DM.scale, ao: 0.6 + 0.4 * sstepJ(0, 2.2, p[1]), u: th / TAU, v: p[1] * 1.5 }),
    });
    // a broad foot with three clawed toes
    const F = L.pts[2];
    kitBlob(K, V3.add(F, [0, -0.2, 0.18]), 10, 6, { r: [0.3, 0.16, 0.36], attr: () => ({ bones: [[bF, 1]], mat: DM.scale, ao: 0.7 }) });
    for (let k = -1; k <= 1; k++) {
      const a = k * 0.4, base = V3.add(F, [Math.sin(a) * 0.22, -0.25, 0.4 + Math.cos(a) * 0.12]);
      kitTube(K, [{ c: V3.add(base, [0, 0.02, -0.15]), rx: 0.08, rz: 0.08 }, { c: base, rx: 0.07, rz: 0.07 }, { c: V3.add(base, [Math.sin(a) * 0.1, -0.03, 0.14]), rx: 0.055, rz: 0.055 }], 6, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ bones: [[bF, 1]], mat: DM.scale, ao: 0.75 }) });
      kitGeo(K, new THREE.ConeGeometry(0.045, 0.2, 5), M4(V3.add(base, [Math.sin(a) * 0.17, -0.08, 0.28]), [Math.PI / 2 + 0.6, 0, -a * 0.5]), { bones: [[bF, 1]], mat: DM.ivory });
    }
    // shoulder and thigh muscle
    kitBlob(K, V3.add(L.pts[0], [L.s * 0.08, -0.25, 0.0]), 12, 8, { r: [0.42, 0.62, L.pre[0] === 'b' ? 0.7 : 0.55], attr: (d) => ({ bones: [[bU, 0.35], [DRAGON_BONES[bU][1], 0.65]], mat: d[1] < -0.5 ? DM.belly : DM.scale, ao: 0.8 }) });
  }
  /* wings: arm, hand, four fingers; membrane between fingers and down to the flank */
  for (const s of [1, -1]) {
    const L = s > 0 ? 'wl' : 'wr';
    const bA = DBI[L + 'Arm'], bH = DBI[L + 'Hand'], bF = [1, 2, 3, 4].map((k) => DBI[L + 'F' + k]);
    const S = [0.85 * s, 3.45, 0.9], E = [2.3 * s, 4.4, 0.85], Wr = [3.6 * s, 4.1, 0.3];
    const tips = DRAGON_FINGERS.map((p) => [p[0] * s, p[1], p[2]]);
    // the arm: shoulder to elbow to wrist
    const arm = [];
    for (let i = 0; i <= 8; i++) {
      const t = i / 8, p = t < 0.5 ? V3.lerp(S, E, t * 2) : V3.lerp(E, Wr, t * 2 - 1);
      arm.push({ c: p, rx: lerp(0.24, 0.1, t), rz: lerp(0.28, 0.12, t), bones: i === 0 ? [[bA, 0.6], [DBI.chest, 0.4]] : [[bA, 1]] });
    }
    kitTube(K, arm.map((q) => ({ c: q.c, rx: q.rx, rz: q.rz })), 9, { cap0: 'dome', cap1: 'dome', front: [0, 1, 0], attr: (i) => ({ bones: arm[i].bones, mat: DM.scale, ao: 0.85, u: 0, v: i / 8 }) });
    kitBlob(K, Wr, 8, 6, { r: [0.13, 0.12, 0.13], attr: () => ({ bones: [[bH, 1]], mat: DM.scale, ao: 0.85 }) });
    kitGeo(K, new THREE.ConeGeometry(0.06, 0.32, 5), M4(V3.add(Wr, [0.05 * s, 0.12, 0.18]), [0.9, 0, 0]), { bones: [[bH, 1]], mat: DM.ivory });
    // fingers taper to a point
    tips.forEach((tp, k) => {
      const pts = [];
      for (let i = 0; i <= 6; i++) { const t = i / 6; pts.push({ c: V3.lerp(Wr, tp, t), rx: lerp(0.075, 0.018, t), rz: lerp(0.075, 0.018, t) }); }
      kitTube(K, pts, 6, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ bones: [[bF[k], 1]], mat: DM.scale, ao: 0.9 }) });
    });
    // membrane between neighbouring fingers, scalloped between the tips
    const NU = 7, NT = 9;
    for (let k = 0; k < 3; k++) {
      const A = tips[k], B = tips[k + 1], rows = [];
      for (let i = 0; i <= NT; i++) {
        const t = i / NT, row = [];
        for (let j = 0; j <= NU; j++) {
          const u = j / NU;
          const tt = t * (1 - 0.2 * Math.sin(Math.PI * u) * t);
          const p = V3.lerp(V3.lerp(Wr, A, tt), V3.lerp(Wr, B, tt), u);
          p[1] -= 0.12 * Math.sin(Math.PI * u) * Math.sin(Math.PI * Math.min(1, t * 1.2));
          row.push({ p, o: { bones: [[bF[k], 1 - u], [bF[k + 1], u]], mat: DM.membrane, ao: 1, u: k + u, v: t } });
        }
        rows.push(row);
      }
      // both faces, so either side catches the light
      kitSurface(K, rows, false, () => [Wr[0], Wr[1] + 1, Wr[2]]);
      kitSurface(K, rows, false, () => [Wr[0], Wr[1] - 1, Wr[2]]);
    }
    // the inner membrane: from the arm and the last finger down to the flank
    {
      const H0 = [0.9 * s, 3.1, -1.9], rows = [];
      for (let i = 0; i <= 10; i++) {
        const t = i / 10, row = [];
        const wing = t < 0.45 ? V3.lerp(S, Wr, t / 0.45) : V3.lerp(Wr, tips[3], (t - 0.45) / 0.55);
        const body = V3.lerp([0.75 * s, 3.45, 0.85], H0, t);
        for (let j = 0; j <= 7; j++) {
          const u = j / 7;
          const p = V3.lerp(wing, body, u);
          p[1] -= 0.18 * Math.sin(Math.PI * u) * Math.sin(Math.PI * t);
          const wingB = t < 0.45 ? [[bA, 1]] : [[bA, 1 - sstepJ(0.45, 0.6, t)], [bF[3], sstepJ(0.45, 0.6, t)]];
          const bodyB = [[DBI.chest, 1 - t], [DBI.hips, t]];
          const bones = [...wingB.map(([b, w]) => [b, w * (1 - u)]), ...bodyB.map(([b, w]) => [b, w * u])].filter((q) => q[1] > 1e-4).sort((a, b) => b[1] - a[1]).slice(0, 4);
          row.push({ p, o: { bones, mat: DM.membrane, ao: 0.9, u: 3 + u, v: t } });
        }
        rows.push(row);
      }
      kitSurface(K, rows, false, () => [S[0], S[1] + 1, S[2]]);
      kitSurface(K, rows, false, () => [S[0], S[1] - 1, S[2]]);
    }
  }
  return K;
}

/* ---- skinning on the CPU ---- */
const DRAGON = {
  e: null, mesh: null, geo: null, kit: null, bindP: null, bindN: null, bi: null, bw: null,
  local: [], world: [], pose: null, target: null, state: 'fly', stateT: 0, flap: 0, glide: 0,
  circ: { ang: 0, r: 160, dir: 1 }, perches: [], perch: null, act: null, nextAct: 0, respawnAt: 0, halfDone: false, alt: 0, yaw: 0,
  walkPh: 0, idleT: 0, bob: 0, strafe: null, wingSnd: 0,
};
function dragonPoseZero() {
  return {
    bodyPitch: 0, bodyRoll: 0, bodyY: 0, chest: 0,
    neck: [0, 0, 0], neckYaw: [0, 0, 0], head: 0, headYaw: 0, jaw: 0,
    tail: [0, 0, 0, 0], tailYaw: [0, 0, 0, 0],
    fl: [0, 0, 0], fr: [0, 0, 0], bl: [0, 0, 0], br: [0, 0, 0], spread: 0,
    wl: [0, 0, 0, 0, 0, 0], wr: [0, 0, 0, 0, 0, 0], // armZ, armY, armX, handZ, handY, fold
  };
}
function buildDragon() {
  const K = buildDragonKit();
  DRAGON.kit = K;
  const n = K.n;
  DRAGON.bindP = new Float32Array(K.pos); DRAGON.bindN = new Float32Array(K.nrm);
  DRAGON.bi = new Uint8Array(K.bi); DRAGON.bw = new Float32Array(K.bw);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aMat', new THREE.Float32BufferAttribute(K.mat, 1));
  g.setAttribute('aUV', new THREE.Float32BufferAttribute(K.uv, 2));
  g.setAttribute('aAO', new THREE.Float32BufferAttribute(K.ao, 1));
  g.setIndex(n > 65535 ? new THREE.Uint32BufferAttribute(K.idx, 1) : new THREE.Uint16BufferAttribute(K.idx, 1));
  DRAGON.geo = g;
  DRAGON.mesh = new THREE.Mesh(g, dragonMat);
  DRAGON.mesh.frustumCulled = false;
  DRAGON.mesh.visible = false;
  DRAGON.mesh.renderOrder = 3;
  scene.add(DRAGON.mesh);
  shadowCaster(DRAGON.mesh, depthFrom(dragonMat));
  for (let i = 0; i < DRAGON_BONES.length; i++) { DRAGON.local.push(new THREE.Matrix4()); DRAGON.world.push(new THREE.Matrix4()); }
  DRAGON.pose = dragonPoseZero();
}
const _dq = new THREE.Quaternion(), _de = new THREE.Euler(), _dm = new THREE.Matrix4(), _dt1 = new THREE.Matrix4(), _dt2 = new THREE.Matrix4(), _dv = new THREE.Vector3();
function boneLocal(i, x, y, z, order = 'YXZ') {
  const pv = DRAGON_BONES[i][2];
  _de.set(x, y, z, order);
  _dm.makeRotationFromEuler(_de);
  _dt1.makeTranslation(pv[0], pv[1], pv[2]);
  _dt2.makeTranslation(-pv[0], -pv[1], -pv[2]);
  DRAGON.local[i].copy(_dt1).multiply(_dm).multiply(_dt2);
}
function poseDragonBones(rootM) {
  const P = DRAGON.pose, B = DBI;
  boneLocal(B.hips, P.bodyPitch, 0, P.bodyRoll);
  boneLocal(B.chest, P.chest, 0, 0);
  for (let k = 0; k < 3; k++) boneLocal(B['neck' + (k + 1)], P.neck[k], P.neckYaw[k], 0);
  boneLocal(B.head, P.head, P.headYaw, 0);
  boneLocal(B.jaw, P.jaw, 0, 0);
  for (let k = 0; k < 4; k++) boneLocal(B['tail' + (k + 1)], P.tail[k], P.tailYaw[k], 0);
  const leg = (pre, v, s) => { boneLocal(B[pre + 'Up'], v[0], 0, P.spread * s); boneLocal(B[pre + 'Lo'], v[1], 0, 0); boneLocal(B[pre + 'Ft'], v[2], 0, 0); };
  leg('fl', P.fl, 1); leg('fr', P.fr, -1); leg('bl', P.bl, 1); leg('br', P.br, -1);
  const FOLD = [0, 0.39, 0.88, 1.49];
  for (const s of [1, -1]) {
    const W = s > 0 ? P.wl : P.wr, L = s > 0 ? 'wl' : 'wr';
    boneLocal(B[L + 'Arm'], W[2], W[1] * s, W[0] * s, 'YZX');
    boneLocal(B[L + 'Hand'], 0, W[4] * s, W[3] * s, 'YZX');
    for (let k = 0; k < 4; k++) boneLocal(B[L + 'F' + (k + 1)], 0, -FOLD[k] * W[5] * s, 0);
  }
  for (let i = 0; i < DRAGON_BONES.length; i++) {
    const par = DRAGON_BONES[i][1];
    DRAGON.world[i].copy(par < 0 ? rootM : DRAGON.world[par]).multiply(DRAGON.local[i]);
  }
}
function skinDragon() {
  const n = DRAGON.kit.n, bp = DRAGON.bindP, bn = DRAGON.bindN, bi = DRAGON.bi, bw = DRAGON.bw;
  const out = DRAGON.geo.attributes.position.array, outN = DRAGON.geo.attributes.normal.array;
  const E = DRAGON.world.map((m) => m.elements);
  for (let v = 0; v < n; v++) {
    const x = bp[v * 3], y = bp[v * 3 + 1], z = bp[v * 3 + 2], nx = bn[v * 3], ny = bn[v * 3 + 1], nz = bn[v * 3 + 2];
    let px = 0, py = 0, pz = 0, qx = 0, qy = 0, qz = 0;
    for (let k = 0; k < 4; k++) {
      const w = bw[v * 4 + k];
      if (w <= 0) continue;
      const e = E[bi[v * 4 + k]];
      px += w * (e[0] * x + e[4] * y + e[8] * z + e[12]);
      py += w * (e[1] * x + e[5] * y + e[9] * z + e[13]);
      pz += w * (e[2] * x + e[6] * y + e[10] * z + e[14]);
      qx += w * (e[0] * nx + e[4] * ny + e[8] * nz);
      qy += w * (e[1] * nx + e[5] * ny + e[9] * nz);
      qz += w * (e[2] * nx + e[6] * ny + e[10] * nz);
    }
    out[v * 3] = px; out[v * 3 + 1] = py; out[v * 3 + 2] = pz;
    const l = Math.hypot(qx, qy, qz) || 1;
    outN[v * 3] = qx / l; outN[v * 3 + 1] = qy / l; outN[v * 3 + 2] = qz / l;
  }
  DRAGON.geo.attributes.position.needsUpdate = true;
  DRAGON.geo.attributes.normal.needsUpdate = true;
}
// a point on the dragon in world space (e.g. the mouth) through one bone
function dragonPoint(bone, p) { return _dv.set(p[0], p[1], p[2]).applyMatrix4(DRAGON.world[bone]); }

const dragonMat = mat({
  side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    attribute float aMat; attribute vec2 aUV; attribute float aAO;
    varying vec3 vW; varying vec3 vN; varying float vMat; varying vec2 vUV; varying float vAO;
    varying vec2 vCS; // [anim2] the way round a tube as a direction, so it has no seam
    void main(){ vW = position; vN = normal; vMat = aMat; vUV = aUV; vAO = aAO; vCS = vec2(cos(6.2831853 * aUV.x), sin(6.2831853 * aUV.x)); gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_ACTOR_LIGHT}
    uniform float uHurt, uBreath, uDead; // [anim2] uDead: the coals of its eyes go out as it dies
    varying vec3 vW; varying vec3 vN; varying float vMat; varying vec2 vUV; varying float vAO;
    varying vec2 vCS;
    ${A2_SCALES_GLSL}
    void main(){
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      if (!gl_FrontFacing) n = -n;
      int m = int(vMat + 0.5);
      vec3 alb; float rough = 0.55, metal = 0.0, sss = 0.1, ao = vAO; vec3 emit = vec3(0.0);
      if (m == 0) {
        // [anim2] overlapping scales (a2Scales, 14a_anim2.js): rows lapping toward the tail and down the legs, each scale
        // its own shade, rounded and lifted at its free edge, bumped through a frame of the surface's own (they were two
        // lattices of discs that read as a checker of blocks, bumped by the derivative of a step: 2x2 blocks along each edge)
        vec3 sn = n; float srim = 0.0, ssh = 0.0;
        float sc = a2Scales(vUV, vCS, vW, n, sn, srim, ssh);
        float blot = a2Blot(vUV, vCS);
        alb = mix(vec3(0.3, 0.06, 0.05), vec3(0.5, 0.12, 0.07), sc) * (0.86 + 0.28 * blot) * (0.9 + 0.2 * ssh);
        alb = mix(alb, vec3(0.12, 0.03, 0.03), srim * 0.65);
        n = sn;
        // bronze sheen on the scales
        metal = 0.25; rough = 0.42 + 0.12 * srim;
      } else if (m == 1) {
        float band = fract(vUV.y * 4.0);
        alb = vec3(0.78, 0.52, 0.28) * (0.8 + 0.2 * smoothstep(0.0, 0.5, band)) * mix(0.55, 1.0, fineMix(smoothstep(0.0, 0.08, band) * smoothstep(1.0, 0.92, band), 0.85, vec2(vUV.y * 40.0)));
        rough = 0.6; sss = 0.25;
      } else if (m == 2) {
        // wing membrane: veins, and the sun glowing through it
        float vein = 1.0 - smoothstep(0.0, 0.05, abs(fract(vUV.x) - 0.5) * 0.0 + min(fract(vUV.x), 1.0 - fract(vUV.x)));
        vein = max(vein, 1.0 - smoothstep(0.0, 0.03, abs(fract(vUV.y * 3.0 + vUV.x * 0.6) - 0.5) - 0.47));
        alb = mix(vec3(0.38, 0.07, 0.06), vec3(0.18, 0.03, 0.03), vein * 0.8);
        rough = 0.7; sss = 0.6;
        float back = max(0.0, dot(-V, uLightDir)) * max(0.0, dot(n, -uLightDir) * 0.5 + 0.5);
        emit += vec3(1.0, 0.32, 0.12) * uLightColor * spow(back, 2.0) * 0.9 * (1.0 - 0.6 * vein);
      } else if (m == 3) {
        alb = mix(vec3(0.72, 0.66, 0.55), vec3(0.16, 0.13, 0.12), smoothstep(0.4, 1.0, vUV.y)); rough = 0.35;
      } else if (m == 4) { alb = vec3(0.86, 0.82, 0.7); rough = 0.3; }
      else if (m == 5) { alb = vec3(0.1); emit = vec3(2.4, 1.4, 0.25) * (0.85 + 0.15 * sin(uTime * 3.0)) * (1.0 - uDead); } // [anim2] uDead
      else if (m == 6) { alb = vec3(0.16, 0.05, 0.05); rough = 0.4; }
      else { alb = vec3(0.3, 0.06, 0.06); rough = 0.4; emit = vec3(2.2, 0.8, 0.15) * uBreath; }
      float sh = shadowAt(vW, n);
      vec3 col = actorLight(alb, n, V, rough, metal, ao, sh, sss);
      col += alb * pointLights(vW, n) * (0.4 + 0.6 * ao);
      col += emit;
      col = mix(col, vec3(1.0, 0.85, 0.7) * 1.4, uHurt * 0.4);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
  uniforms: { uHurt: { value: 0 }, uBreath: { value: 0 }, uDead: { value: 0 } }, // [anim2] uDead
});
