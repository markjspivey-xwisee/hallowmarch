/* ================================================================== */
/* characters: smooth skinned humanoids and beasts, built in code      */
/* ================================================================== */
// bones of the humanoid rig (each vertex follows one bone; aW eases the bend at that bone's joint)
const HB = { pelvis: 0, chest: 1, head: 2, uarmL: 3, farmL: 4, uarmR: 5, farmR: 6, thighL: 7, shinL: 8, thighR: 9, shinR: 10, cape: 11 };
// surface materials; torso/arms/legs/hands are body layers that the shader dresses per outfit
const AM = {
  skin: 0, tabard: 1, mail: 2, leather: 3, boots: 4, wood: 5, steel: 6, hair: 7, cape: 8, glow: 9, cloth: 10,
  fur: 11, furDark: 12, ivory: 13, eye: 14, gold: 15, robe: 16, plate: 17, string: 18, shieldFace: 19,
  torso: 20, arms: 21, legs: 22, hands: 23, fletch: 24, nose: 25, mane: 26, hoof: 27, mouth: 28, armor: 2,
};
// optional parts: one visibility bit each (iMisc.y holds the mask)
const WB = {
  sword: 1 << 0, mace: 1 << 1, staff: 1 << 2, axe: 1 << 3, cape: 1 << 4, shield: 1 << 5, bow: 1 << 6, quiver: 1 << 7,
  helmet: 1 << 8, hood: 1 << 9, pauldron: 1 << 10, robe: 1 << 11, tabard: 1 << 12, hairShort: 1 << 13, hairLong: 1 << 14,
  beard: 1 << 15, shieldRound: 1 << 16, skirt: 1 << 17, belt: 1 << 18, circlet: 1 << 19,
};
const WBIT = {};
for (const k in WB) WBIT[k] = Math.round(Math.log2(WB[k]));
// how the body layers are dressed (iStyle.x)
const OUTFIT = { warrior: 0, archer: 1, mage: 2, priest: 3, villager: 4, bandit: 5, skeleton: 6, draugr: 7, troll: 8, herald: 9, lord: 10 };

// bind-pose skeleton in model space (metres; +Y up, +Z forward, +X is the character's left)
const SK = {
  spine: [0, 1.04, -0.01], neck: [0, 1.535, -0.012], headC: [0, 1.672, 0.012],
  shoulder: [0.19, 1.435, -0.02], elbow: [0.226, 1.162, -0.042], wrist: [0.24, 0.927, -0.012], fist: [0.244, 0.868, 0.004],
  hip: [0.093, 0.94, 0.0], knee: [0.1, 0.52, 0.016], ankle: [0.104, 0.095, -0.018], capeTop: [0, 1.455, -0.13],
};
const glv = (p) => `vec3(${p.map((v) => (+v).toFixed(4)).join(', ')})`;

/* ------------------------------------------------------------------ */
/* vector helpers on plain arrays                                      */
/* ------------------------------------------------------------------ */
const V3 = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, k) => [a[0] * k, a[1] * k, a[2] * k],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: (a) => Math.hypot(a[0], a[1], a[2]),
  norm: (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
  perp: (v, t) => { const d = v[0] * t[0] + v[1] * t[1] + v[2] * t[2]; return [v[0] - t[0] * d, v[1] - t[1] * d, v[2] - t[2] * d]; },
};
const gauss = (x, y) => Math.exp(-(x * x + y * y));
const sstepJ = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const spow = (x, e) => Math.sign(x) * Math.pow(Math.abs(x), e);

/* ------------------------------------------------------------------ */
/* the builder: vertices carry bone, joint weight, material, bit, uv, ao */
/* ------------------------------------------------------------------ */
class SkinKit {
  constructor() { this.pos = []; this.nrm = []; this.bone = []; this.w = []; this.mat = []; this.bit = []; this.uv = []; this.ao = []; this.idx = []; this.n = 0; }
  vert(p, n, o) {
    this.pos.push(p[0], p[1], p[2]); this.nrm.push(n[0], n[1], n[2]);
    this.bone.push(o.bone ?? 0); this.w.push(o.w ?? 1); this.mat.push(o.mat ?? 0); this.bit.push(o.bit ?? -1);
    this.uv.push(o.u ?? 0, o.v ?? 0); this.ao.push(o.ao ?? 1);
    return this.n++;
  }
  P(i) { return [this.pos[i * 3], this.pos[i * 3 + 1], this.pos[i * 3 + 2]]; }
  N(i) { return [this.nrm[i * 3], this.nrm[i * 3 + 1], this.nrm[i * 3 + 2]]; }
  // triangle wound so its face agrees with the vertex normals (front faces are counter-clockwise)
  tri(a, b, c) {
    const f = V3.cross(V3.sub(this.P(b), this.P(a)), V3.sub(this.P(c), this.P(a)));
    const n = V3.add(V3.add(this.N(a), this.N(b)), this.N(c));
    if (V3.dot(f, n) < 0) this.idx.push(a, c, b); else this.idx.push(a, b, c);
  }
  quad(a, b, c, d) { this.tri(a, b, c); this.tri(a, c, d); }
  build() {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('aBone', new THREE.Float32BufferAttribute(this.bone, 1));
    g.setAttribute('aW', new THREE.Float32BufferAttribute(this.w, 1));
    g.setAttribute('aMat', new THREE.Float32BufferAttribute(this.mat, 1));
    g.setAttribute('aBit', new THREE.Float32BufferAttribute(this.bit, 1));
    g.setAttribute('aUV', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setAttribute('aAO', new THREE.Float32BufferAttribute(this.ao, 1));
    g.setIndex(this.n > 65535 ? new THREE.Uint32BufferAttribute(this.idx, 1) : new THREE.Uint16BufferAttribute(this.idx, 1));
    g.instanceCount = 0;
    return g;
  }
}

/* a grid of points -> smooth surface. rows[i][j] = { p, o, keep }; ctr(i, j) gives an inside point for orienting
   normals outwards; a row may carry pole: n to force its normal */
function kitSurface(kit, rows, closed, ctr, flip = false) {
  const R = rows.length, C = rows[0].length;
  const ids = [];
  for (let i = 0; i < R; i++) {
    ids.push([]);
    for (let j = 0; j < C; j++) {
      const pt = rows[i][j];
      if (pt.keep === false) { ids[i].push(-1); continue; }
      let n;
      if (rows[i].pole) n = rows[i].pole;
      else {
        const jp = closed ? (j + 1) % C : Math.min(C - 1, j + 1), jm = closed ? (j - 1 + C) % C : Math.max(0, j - 1);
        const ip = Math.min(R - 1, i + 1), im = Math.max(0, i - 1);
        n = V3.cross(V3.sub(rows[i][jp].p, rows[i][jm].p), V3.sub(rows[ip][j].p, rows[im][j].p));
        if (V3.len(n) < 1e-10) n = V3.sub(pt.p, ctr(i, j));
        n = V3.norm(n);
        if (V3.dot(n, V3.sub(pt.p, ctr(i, j))) < 0) n = V3.mul(n, -1);
      }
      if (flip) n = V3.mul(n, -1);
      ids[i].push(kit.vert(pt.p, n, pt.o));
    }
  }
  for (let i = 0; i < R - 1; i++) {
    for (let j = 0; j < (closed ? C : C - 1); j++) {
      const j1 = (j + 1) % C;
      const a = ids[i][j], b = ids[i][j1], c = ids[i + 1][j1], d = ids[i + 1][j];
      if (a < 0 || b < 0 || c < 0 || d < 0) continue;
      kit.quad(a, b, c, d);
    }
  }
  return ids;
}

/* tube through rings: path = [{ c, rx, rz }], seg points per ring.
   o: { attr(i, theta, p) -> vertex attrs, n (superellipse), cap0/cap1 ('dome'), front, side, th0, th1, shape(i, theta) -> [dx, dz] } */
function kitTube(kit, path, seg, o = {}) {
  const N = path.length, ex = o.n || 2, closed = o.th0 === undefined;
  const th0 = o.th0 ?? 0, th1 = o.th1 ?? TAU;
  const cols = closed ? seg : seg + 1;
  const frames = [];
  for (let i = 0; i < N; i++) {
    const t = V3.norm(V3.sub(path[Math.min(N - 1, i + 1)].c, path[Math.max(0, i - 1)].c));
    let e2 = V3.perp(o.front || [0, 0, 1], t);
    if (V3.len(e2) < 0.2) e2 = V3.perp([0, 1, 0], t);
    e2 = V3.norm(e2);
    let e1 = V3.perp(o.side || [1, 0, 0], t);
    e1 = V3.sub(e1, V3.mul(e2, V3.dot(e1, e2)));
    e1 = V3.len(e1) < 0.2 ? V3.norm(V3.cross(t, e2)) : V3.norm(e1);
    frames.push({ t, e1, e2 });
  }
  let vacc = 0;
  const vs = [];
  for (let i = 0; i < N; i++) { if (i) vacc += V3.len(V3.sub(path[i].c, path[i - 1].c)); vs.push(vacc); }
  const ring = (c, rx, rz, f, i, scale = 1, pole = null) => {
    const row = [];
    for (let j = 0; j < cols; j++) {
      const th = closed ? (j / seg) * TAU : th0 + (th1 - th0) * (j / seg);
      const cs = spow(Math.cos(th), 2 / ex), sn = spow(Math.sin(th), 2 / ex);
      const sh = o.shape ? o.shape(i, th) : null;
      const a = (rz * cs + (sh ? sh[1] : 0)) * scale, b = (rx * sn + (sh ? sh[0] : 0)) * scale;
      const p = V3.add(V3.add(c, V3.mul(f.e2, a)), V3.mul(f.e1, b));
      const attrs = o.attr(Math.min(N - 1, Math.max(0, i)), th, p);
      row.push({ p, o: { ...attrs, u: attrs.u ?? th / TAU, v: attrs.v ?? vs[Math.min(N - 1, Math.max(0, i))] } });
    }
    if (pole) row.pole = pole;
    return row;
  };
  const rows = [];
  if (o.cap0 === 'dome') {
    const f = frames[0], c0 = path[0].c, L = Math.min(path[0].rx, path[0].rz) * 0.9;
    rows.push(ring(V3.sub(c0, V3.mul(f.t, L)), path[0].rx, path[0].rz, f, 0, 0.001, V3.mul(f.t, -1)));
    rows.push(ring(V3.sub(c0, V3.mul(f.t, L * 0.72)), path[0].rx, path[0].rz, f, 0, 0.7));
  }
  for (let i = 0; i < N; i++) rows.push(ring(path[i].c, path[i].rx, path[i].rz, frames[i], i));
  if (o.cap1 === 'dome') {
    const f = frames[N - 1], c1 = path[N - 1].c, L = Math.min(path[N - 1].rx, path[N - 1].rz) * 0.9;
    rows.push(ring(V3.add(c1, V3.mul(f.t, L * 0.72)), path[N - 1].rx, path[N - 1].rz, f, N - 1, 0.7));
    rows.push(ring(V3.add(c1, V3.mul(f.t, L)), path[N - 1].rx, path[N - 1].rz, f, N - 1, 0.001, f.t));
  }
  const offs = o.cap0 === 'dome' ? 2 : 0;
  const centres = rows.map((r, i) => {
    const k = clamp(i - offs, 0, N - 1);
    return path[k].c;
  });
  return kitSurface(kit, rows, closed, (i) => centres[i], o.flip);
}

/* sculpted ellipsoid: o.shape(d) -> offset from c for unit direction d; o.keep(d); o.attr(d, p) */
function kitBlob(kit, c, segU, segV, o) {
  const rows = [];
  for (let i = 0; i <= segV; i++) {
    const ph = -Math.PI / 2 + (i / segV) * Math.PI;
    const row = [];
    for (let j = 0; j < segU; j++) {
      const th = (j / segU) * TAU;
      const d = [Math.cos(ph) * Math.sin(th), Math.sin(ph), Math.cos(ph) * Math.cos(th)];
      const off = o.shape ? o.shape(d) : [d[0] * o.r[0], d[1] * o.r[1], d[2] * o.r[2]];
      const p = V3.add(c, off);
      const at = o.attr(d, p);
      row.push({ p, keep: o.keep ? o.keep(d) : true, o: { ...at, u: at.u ?? th / TAU, v: at.v ?? (i / segV) } });
    }
    if (i === 0) row.pole = [0, -1, 0];
    if (i === segV) row.pole = [0, 1, 0];
    rows.push(row);
  }
  return kitSurface(kit, rows, true, () => c, o.flip);
}

/* import a three.js geometry with a transform; o: { bone, w, mat | matFn(p, n), bit, uvScale, ao } */
function kitGeo(kit, geo, m4, o) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, nr = g.attributes.normal, uv = g.attributes.uv;
  const nm = new THREE.Matrix3().getNormalMatrix(m4);
  const flip = m4.determinant() < 0;
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (let i = 0; i < p.count; i += 3) {
    const ids = [];
    for (let k = 0; k < 3; k++) {
      v.fromBufferAttribute(p, i + k).applyMatrix4(m4);
      nv.fromBufferAttribute(nr, i + k).applyMatrix3(nm).normalize();
      const P = [v.x, v.y, v.z], Nn = [nv.x, nv.y, nv.z];
      const us = o.uvScale || 1;
      ids.push(kit.vert(P, Nn, {
        bone: o.bone, w: o.w ?? 1, bit: o.bit ?? -1, ao: o.ao ?? 1,
        mat: o.matFn ? o.matFn(P, Nn) : o.mat,
        u: uv ? uv.getX(i + k) * us : 0, v: uv ? uv.getY(i + k) * us : 0,
      }));
    }
    if (flip) kit.idx.push(ids[0], ids[2], ids[1]); else kit.idx.push(ids[0], ids[1], ids[2]);
  }
}
function kitMove(kit, from, m4) {
  const nm = new THREE.Matrix3().getNormalMatrix(m4), v = new THREE.Vector3();
  for (let i = from; i < kit.n; i++) {
    v.set(kit.pos[i * 3], kit.pos[i * 3 + 1], kit.pos[i * 3 + 2]).applyMatrix4(m4);
    kit.pos[i * 3] = v.x; kit.pos[i * 3 + 1] = v.y; kit.pos[i * 3 + 2] = v.z;
    v.set(kit.nrm[i * 3], kit.nrm[i * 3 + 1], kit.nrm[i * 3 + 2]).applyMatrix3(nm).normalize();
    kit.nrm[i * 3] = v.x; kit.nrm[i * 3 + 1] = v.y; kit.nrm[i * 3 + 2] = v.z;
  }
}
const M4 = (pos, rot = [0, 0, 0], scl = [1, 1, 1], order = 'XYZ') => new THREE.Matrix4().compose(new THREE.Vector3(...pos), new THREE.Quaternion().setFromEuler(new THREE.Euler(rot[0], rot[1], rot[2], order)), new THREE.Vector3(...scl));

/* ------------------------------------------------------------------ */
/* the humanoid                                                        */
/* ------------------------------------------------------------------ */
// the head's sculpted shape (shared by the head, hair, beard, hood and helmet so they sit on it)
const HEAD_R = [0.079, 0.112, 0.099];
function headShape(d, detail = 1) {
  let sx = 1, sz = 1;
  const [dx, dy, dz] = d;
  if (dy < 0) { const t = -dy; sx *= 1 - 0.3 * t * t; if (dz < 0) sz *= 1 - 0.12 * t; }
  if (dz < 0) sz *= 1 + 0.07 * (1 - Math.abs(dy));
  if (dz > 0) sz *= 1 - 0.06 * dz * (1 - Math.abs(dx));
  const p = [dx * HEAD_R[0] * sx, dy * HEAD_R[1], dz * HEAD_R[2] * sz];
  if (detail && dz > 0) {
    const front = sstepJ(0.2, 0.75, dz);
    p[2] += 0.013 * gauss(dx / 0.3, (dy + 0.84) / 0.16) * front;            // chin
    p[2] += 0.026 * gauss(dx / 0.1, (dy + 0.1) / 0.17) * sstepJ(0.6, 0.9, dz); // nose
    p[1] -= 0.004 * gauss(dx / 0.1, (dy + 0.24) / 0.06) * sstepJ(0.6, 0.9, dz); // nostrils tuck
    p[2] += 0.008 * gauss(dx / 0.6, (dy - 0.24) / 0.07) * front;            // brow
    p[2] -= 0.009 * (gauss((dx - 0.37) / 0.15, (dy - 0.1) / 0.1) + gauss((dx + 0.37) / 0.15, (dy - 0.1) / 0.1)) * front; // eye sockets
    p[2] += 0.004 * gauss(dx / 0.25, (dy + 0.5) / 0.06) * front;            // lips
    p[0] += 0.006 * Math.sign(dx) * gauss((Math.abs(dx) - 0.78) / 0.2, dy / 0.22) * front; // cheekbones
  }
  return p;
}
// unit outward direction of the head surface near d (for shells)
function headNormal(d) { return V3.norm([d[0] / HEAD_R[0], d[1] / HEAD_R[1], d[2] / HEAD_R[2]]); }

function buildHumanoid(lod) {
  const K = new SkinKit();
  const hi = lod === 0;
  const RS = hi ? 16 : 9, LS = hi ? 12 : 7, HU = hi ? 26 : 12, HV = hi ? 18 : 8;
  const B = HB, mat = AM;
  const headBone = (y) => ({ bone: B.head, w: 1 });

  /* --- torso: one continuous body from the crotch to the neck --- */
  const TORSO = [
    [0.84, 0.115, 0.082, -0.006], [0.875, 0.152, 0.098, -0.01], [0.93, 0.17, 0.107, -0.012], [0.99, 0.166, 0.104, -0.008],
    [1.05, 0.152, 0.098, -0.002], [1.11, 0.148, 0.1, 0.004], [1.17, 0.155, 0.106, 0.01], [1.23, 0.166, 0.112, 0.016],
    [1.29, 0.174, 0.116, 0.018], [1.35, 0.176, 0.112, 0.012], [1.4, 0.167, 0.103, 0.003], [1.44, 0.138, 0.088, -0.005],
    [1.475, 0.088, 0.066, -0.01], [1.5, 0.062, 0.056, -0.012],
  ];
  const torsoPath = (hi ? TORSO : TORSO.filter((_, i) => i % 2 === 0 || i === TORSO.length - 1)).map(([y, rx, rz, zc]) => ({ c: [0, y, zc], rx, rz }));
  const torsoBone = (y) => (y < 1.0 ? { bone: B.pelvis, w: 1 } : { bone: B.chest, w: sstepJ(1.0, 1.15, y) });
  kitTube(K, torsoPath, RS, {
    n: 2.4, cap0: 'dome',
    attr: (i, th, p) => {
      const side = Math.abs(Math.sin(th));
      let ao = 1;
      ao *= 1 - 0.28 * sstepJ(0.6, 1, side) * sstepJ(1.18, 1.3, p[1]) * (1 - sstepJ(1.38, 1.44, p[1])); // under the arms
      ao *= 1 - 0.3 * (1 - sstepJ(0.84, 0.95, p[1]));                                                 // crotch
      ao *= 1 - 0.18 * sstepJ(1.45, 1.5, p[1]);                                                      // under the jaw
      return { ...torsoBone(p[1]), mat: mat.torso, ao, u: th / TAU, v: p[1] };
    },
  });
  /* --- neck --- */
  kitTube(K, [[1.45, 0.06, 0.056], [1.5, 0.058, 0.054], [1.55, 0.054, 0.052], [1.6, 0.05, 0.05], [1.635, 0.046, 0.046]].map(([y, rx, rz]) => ({ c: [0, y, -0.012 + (y - 1.45) * 0.1], rx, rz })), hi ? 12 : 7, {
    attr: (i, th, p) => ({ bone: B.head, w: sstepJ(1.5, 1.6, p[1]), mat: mat.skin, ao: 0.8 + 0.2 * sstepJ(1.48, 1.58, p[1]), u: th / TAU, v: p[1] }),
  });
  /* --- head --- */
  const HC = SK.headC;
  kitBlob(K, HC, HU, HV, {
    shape: (d) => headShape(d, hi ? 1 : 0),
    attr: (d) => ({ ...headBone(), mat: mat.skin, ao: 1 - 0.3 * sstepJ(-0.7, -1, d[1]) * (1 - sstepJ(0.3, 0.8, d[2])), u: Math.atan2(d[0], d[2]) / TAU, v: d[1] }),
  });
  if (hi) {
    // eyes, ears
    for (const s of [1, -1]) {
      kitBlob(K, [0.031 * s, HC[1] + 0.012, HC[2] + 0.084], 8, 6, { r: [0.0125, 0.0085, 0.006], attr: () => ({ ...headBone(), mat: mat.eye }) });
      kitBlob(K, [0.079 * s, HC[1] - 0.002, HC[2] - 0.006], 8, 6, { shape: (d) => [d[0] * 0.012, d[1] * 0.03, d[2] * 0.019 - 0.004 * d[1]], attr: () => ({ ...headBone(), mat: mat.skin, ao: 0.8 }) });
    }
  }
  /* --- hair and beard: shells on the head --- */
  const hairline = (d) => lerp(-0.62, 0.36, sstepJ(-0.55, 0.72, d[2]));
  const shell = (bit, keep, off, matId, extra = 0) => kitBlob(K, HC, HU, HV, {
    shape: (d) => { const p = headShape(d, 0); const n = headNormal(d); const o = off(d); return V3.add(p, V3.mul(n, o)); },
    keep, attr: (d) => ({ ...headBone(), mat: matId, bit: WBIT[bit], ao: 0.85 + 0.15 * sstepJ(-0.3, 0.6, d[1]), u: Math.atan2(d[0], d[2]) / TAU, v: d[1] }),
  });
  shell('hairShort', (d) => d[1] > hairline(d) && !(Math.abs(d[0]) > 0.86 && d[1] < 0.05 && d[1] > -0.4), (d) => 0.006 + 0.013 * Math.max(0, d[1]) + 0.004 * Math.max(0, -d[2]), mat.hair);
  shell('hairLong', (d) => d[1] > Math.min(hairline(d), d[2] < -0.2 ? -1.1 : 9) && !(Math.abs(d[0]) > 0.86 && d[1] < 0.05 && d[1] > -0.4 && d[2] > -0.2), (d) => 0.008 + 0.016 * Math.max(0, d[1]) + 0.01 * Math.max(0, -d[2]), mat.hair);
  {
    // long hair falls to the shoulder blades
    const fall = [];
    for (let i = 0; i <= (hi ? 6 : 3); i++) {
      const t = i / (hi ? 6 : 3);
      fall.push({ c: [0, lerp(1.69, 1.36, t), lerp(-0.085, -0.122, t)], rx: lerp(0.078, 0.06, t), rz: lerp(0.045, 0.018, t) });
    }
    kitTube(K, fall, hi ? 10 : 6, { cap1: 'dome', attr: (i, th, p) => ({ bone: p[1] > 1.56 ? B.head : B.chest, w: 1, mat: mat.hair, bit: WBIT.hairLong, ao: 0.8, u: th / TAU, v: p[1] }) });
  }
  shell('beard', (d) => d[2] > 0.1 && d[1] < -0.18 && Math.abs(d[0]) < 0.97 && !(d[1] > -0.45 && Math.abs(d[0]) < 0.32 && d[1] < -0.3), (d) => 0.007 + 0.016 * sstepJ(-0.3, -1, d[1]), mat.hair);

  /* --- arms: shoulder to fist, one tube with an easing elbow --- */
  for (const s of [1, -1]) {
    const sh = [SK.shoulder[0] * s, SK.shoulder[1], SK.shoulder[2]], el = [SK.elbow[0] * s, SK.elbow[1], SK.elbow[2]], wr = [SK.wrist[0] * s, SK.wrist[1], SK.wrist[2]];
    const up = s > 0 ? B.uarmL : B.uarmR, fo = s > 0 ? B.farmL : B.farmR;
    const n1 = hi ? 7 : 3, n2 = hi ? 7 : 3, path = [];
    const top = V3.add(sh, [-0.012 * s, 0.03, 0.004]);
    path.push({ c: top, rx: 0.05, rz: 0.054, bone: up, w: 0 });
    for (let i = 0; i <= n1; i++) {
      const t = i / n1;
      const r = lerp(0.059, 0.042, Math.pow(t, 1.3)) + 0.006 * Math.sin(t * Math.PI) * (1 - t);
      path.push({ c: V3.lerp(sh, el, t), rx: r * 0.94, rz: r, bone: up, w: sstepJ(-0.1, 0.4, t) });
    }
    for (let i = 1; i <= n2; i++) {
      const t = i / n2;
      const r = lerp(0.044, 0.031, t) + 0.006 * Math.sin(Math.min(1, t * 2.2) * Math.PI) * (1 - t);
      path.push({ c: V3.lerp(el, wr, t), rx: r * 0.9, rz: r * 1.08, bone: fo, w: sstepJ(-0.12, 0.3, t) });
    }
    kitTube(K, path, LS, {
      cap0: 'dome', cap1: 'dome',
      attr: (i, th, p) => {
        const inner = Math.max(0, -Math.sin(th) * s); // faces the body
        return { bone: path[i].bone, w: path[i].w, mat: mat.arms, ao: 1 - 0.22 * inner * (1 - sstepJ(1.0, 1.3, p[1]) * 0.5), u: th / TAU, v: p[1] };
      },
    });
    // fist and thumb
    const F = [SK.fist[0] * s, SK.fist[1], SK.fist[2]];
    kitBlob(K, F, hi ? 10 : 6, hi ? 8 : 4, { shape: (d) => [d[0] * 0.029, d[1] * 0.046 - 0.006 * d[2] * d[2], d[2] * 0.041 + 0.004 * Math.max(0, d[1])], attr: (d) => ({ bone: fo, w: 1, mat: mat.hands, ao: 0.82 + 0.18 * Math.max(0, d[0] * s) }) });
    if (hi) kitBlob(K, V3.add(F, [-0.012 * s, 0.012, 0.034]), 7, 5, { r: [0.014, 0.022, 0.014], attr: () => ({ bone: fo, w: 1, mat: mat.hands, ao: 0.9 }) });
    // wide robe sleeves
    const sl = [];
    for (let i = 0; i <= (hi ? 4 : 2); i++) { const t = i / (hi ? 4 : 2); sl.push({ c: V3.lerp(V3.lerp(el, wr, -0.08), V3.lerp(el, wr, 0.92), t), rx: lerp(0.052, 0.078, t * t), rz: lerp(0.056, 0.085, t * t) }); }
    kitTube(K, sl, LS, { attr: (i, th, p) => ({ bone: fo, w: 1, mat: mat.robe, bit: WBIT.robe, ao: 0.9, u: th / TAU, v: p[1] }) });
    kitTube(K, sl.map((r) => ({ ...r, rx: r.rx - 0.006, rz: r.rz - 0.006 })), LS, { flip: true, attr: (i, th, p) => ({ bone: fo, w: 1, mat: mat.robe, bit: WBIT.robe, ao: 0.55, u: th / TAU, v: p[1] }) });
    // pauldrons: two lames over each shoulder
    for (const [dy, r, bw] of [[0.035, [0.088, 0.062, 0.094], 0.35], [-0.03, [0.083, 0.04, 0.089], 0.6]]) {
      kitBlob(K, V3.add(sh, [0.012 * s, dy, 0.0]), hi ? 14 : 8, hi ? 8 : 4, {
        shape: (d) => [d[0] * r[0], d[1] * r[1], d[2] * r[2]],
        keep: (d) => d[1] > -0.2 && d[0] * s > -0.55,
        attr: (d) => ({ bone: up, w: bw, mat: mat.plate, bit: WBIT.pauldron, ao: 0.75 + 0.25 * sstepJ(-0.2, 0.6, d[1]) }),
      });
    }
  }

  /* --- legs: hip to ankle, easing at the hip and knee --- */
  for (const s of [1, -1]) {
    const hp = [SK.hip[0] * s, SK.hip[1], SK.hip[2]], kn = [SK.knee[0] * s, SK.knee[1], SK.knee[2]], an = [SK.ankle[0] * s, SK.ankle[1], SK.ankle[2]];
    const th = s > 0 ? B.thighL : B.thighR, sb = s > 0 ? B.shinL : B.shinR;
    const n1 = hi ? 8 : 3, n2 = hi ? 8 : 3, path = [];
    path.push({ c: V3.add(hp, [0, 0.07, -0.005]), rx: 0.085, rz: 0.095, bone: th, w: 0 });
    for (let i = 0; i <= n1; i++) {
      const t = i / n1;
      const r = lerp(0.09, 0.056, Math.pow(t, 1.15));
      path.push({ c: V3.lerp(hp, kn, t), rx: r * (1 - 0.06 * t), rz: r * 1.04, bone: th, w: sstepJ(-0.08, 0.3, t) });
    }
    for (let i = 1; i <= n2; i++) {
      const t = i / n2;
      const calf = 0.012 * Math.sin(Math.min(1, t * 1.9) * Math.PI) * (1 - t);
      const r = lerp(0.053, 0.037, t) + calf;
      path.push({ c: V3.add(V3.lerp(kn, an, t), [0, 0, -calf * 0.6]), rx: r * 0.92, rz: r * 1.06, bone: sb, w: sstepJ(-0.08, 0.22, t) });
    }
    kitTube(K, path, LS, {
      cap0: 'dome',
      attr: (i, a, p) => {
        const inner = Math.max(0, -Math.sin(a) * s);
        return { bone: path[i].bone, w: path[i].w, mat: mat.legs, ao: (1 - 0.25 * inner * (1 - sstepJ(0.55, 0.9, p[1]) * 0.6)) * (1 - 0.25 * (1 - sstepJ(0.86, 0.96, p[1]))), u: a / TAU, v: p[1] };
      },
    });
    /* boots: shaft with a turned cuff, and a shaped foot */
    const bs = [];
    for (let i = 0; i <= (hi ? 5 : 2); i++) {
      const t = i / (hi ? 5 : 2);
      const y = lerp(0.06, 0.34, t);
      const lt = (SK.knee[1] - y) / (SK.knee[1] - SK.ankle[1]);
      const c = V3.lerp(kn, an, lt);
      const r = lerp(0.05, 0.06, t) + (t > 0.85 ? 0.008 : 0) + (lt > 0.1 && lt < 0.6 ? 0.006 : 0);
      bs.push({ c, rx: r * 0.95, rz: r * 1.06 });
    }
    kitTube(K, bs, LS, { attr: (i, a, p) => ({ bone: sb, w: 1, mat: mat.boots, ao: 0.9, u: a / TAU, v: p[1] }) });
    const fc = [an[0], 0.05, an[2] + 0.06];
    kitBlob(K, fc, hi ? 14 : 8, hi ? 8 : 4, {
      shape: (d) => {
        const front = sstepJ(-0.2, 1, d[2]);
        const x = d[0] * 0.05 * (1 - 0.18 * front), z = d[2] * (d[2] > 0 ? 0.125 : 0.075);
        let y = d[1] * 0.05 * (1 - 0.35 * front);
        if (d[1] < 0) y = d[1] * 0.05 * 0.98;
        return [x, y + (d[1] < 0 ? 0 : 0.004), z];
      },
      attr: (d) => ({ bone: sb, w: 1, mat: mat.boots, ao: d[1] < -0.6 ? 0.5 : 0.92 }),
    });
  }

  /* --- belt with a buckle --- */
  kitTube(K, [{ c: [0, 0.985, -0.006], rx: 0.174, rz: 0.112 }, { c: [0, 1.005, -0.006], rx: 0.176, rz: 0.114 }, { c: [0, 1.03, -0.005], rx: 0.172, rz: 0.112 }], RS, {
    n: 2.4, attr: (i, th, p) => ({ bone: B.pelvis, w: 1, mat: mat.leather, bit: WBIT.belt, ao: 0.85, u: th / TAU, v: p[1] }),
  });
  if (hi) kitGeo(K, new THREE.BoxGeometry(0.05, 0.038, 0.012), M4([0, 1.007, 0.108]), { bone: B.pelvis, mat: mat.gold, bit: WBIT.belt });

  /* --- tabard: front and back panels over the chest, falling past the belt --- */
  {
    const rows = [];
    const ys = hi ? [0.58, 0.66, 0.74, 0.82, 0.9, 0.98, 1.06, 1.14, 1.22, 1.3, 1.37, 1.43] : [0.58, 0.74, 0.9, 1.06, 1.22, 1.37, 1.43];
    for (const back of [0, 1]) {
      const path = ys.map((y) => {
        const k = TORSO.reduce((best, r) => (Math.abs(r[0] - y) < Math.abs(best[0] - y) ? r : best), TORSO[0]);
        const below = Math.max(0, 0.98 - y);
        return { c: [0, y, k[3]], rx: (y < 0.98 ? 0.178 + below * 0.25 : k[1] + 0.014), rz: (y < 0.98 ? 0.118 + below * 0.22 : k[2] + 0.014) };
      });
      const a0 = back ? Math.PI - 0.95 : -0.95, a1 = back ? Math.PI + 0.95 : 0.95;
      for (const flip of [false, true]) {
        kitTube(K, path, hi ? 10 : 5, {
          n: 2.4, th0: a0, th1: a1, flip,
          shape: flip ? (i, th) => [-0.004 * Math.sin(th), -0.004 * Math.cos(th)] : null,
          attr: (i, th, p) => {
            const y = p[1];
            let bone = B.pelvis, w = 1;
            if (y > 1.0) { bone = B.chest; w = sstepJ(1.0, 1.15, y); }
            else if (y < 0.97) { bone = p[0] > 0 ? B.thighL : B.thighR; w = 0.75 * sstepJ(0.97, 0.66, y) * sstepJ(0.02, 0.1, Math.abs(p[0])); }
            return { bone, w, mat: mat.tabard, bit: WBIT.tabard, ao: flip ? 0.5 : 0.95, u: (th - (back ? Math.PI : 0)) / TAU, v: y };
          },
        });
      }
    }
  }
  /* --- short skirt (tunic, loincloth) and the long robe --- */
  for (const [bit, yb, flare, matId] of [['skirt', 0.66, 0.05, mat.cloth], ['robe', 0.1, 0.22, mat.robe]]) {
    const n = hi ? (bit === 'robe' ? 9 : 5) : (bit === 'robe' ? 4 : 2), path = [];
    for (let i = 0; i <= n; i++) {
      const t = i / n, y = lerp(1.0, yb, t);
      path.push({ c: [0, y, -0.008 - 0.01 * t], rx: 0.172 + flare * Math.pow(t, 1.3) + 0.012, rz: 0.11 + flare * 0.85 * Math.pow(t, 1.3) + 0.012 });
    }
    for (const flip of [false, true]) {
      kitTube(K, path, hi ? 18 : 10, {
        n: 2.2, flip, shape: flip ? (i, th) => [-0.005 * Math.sin(th), -0.005 * Math.cos(th)] : null,
        attr: (i, th, p) => {
          const y = p[1], side = Math.sin(th);
          let bone = B.pelvis, w = 1;
          if (y < 0.97) { bone = side > 0 ? B.thighL : B.thighR; w = Math.min(1, Math.abs(side) * 1.25) * sstepJ(0.97, 0.6, y) * (bit === 'robe' ? 0.7 : 0.85); }
          return { bone, w, mat: matId, bit: WBIT[bit], ao: flip ? 0.45 : 0.9 + 0.1 * (y - yb) / (1 - yb), u: th / TAU, v: y };
        },
      });
    }
  }

  /* --- cape: a curved cloth from the shoulders --- */
  {
    const rows = [], rowsIn = [];
    const R = hi ? 11 : 5, C = hi ? 9 : 5;
    for (let i = 0; i <= R; i++) {
      const t = i / R, y = lerp(1.455, 0.4, t), hw = lerp(0.2, 0.29, t);
      const row = [], rowIn = [];
      for (let j = 0; j <= C; j++) {
        const u = j / C * 2 - 1, x = u * hw;
        const z = lerp(-0.128, -0.2, t) - 0.045 * (1 - u * u) * (0.4 + 0.6 * t) + 0.012 * Math.cos(u * Math.PI * 2.5) * t;
        const o = { bone: B.cape, w: 1, mat: mat.cape, bit: WBIT.cape, u: (u + 1) / 2, v: y };
        row.push({ p: [x, y, z], o: { ...o, ao: 0.95 } });
        rowIn.push({ p: [x, y, z + 0.004], o: { ...o, ao: 0.55 } });
      }
      rows.push(row); rowsIn.push(rowIn);
    }
    kitSurface(K, rows, false, (i, j) => [rows[i][j].p[0] * 0.5, rows[i][j].p[1], rows[i][j].p[2] + 0.2]);
    kitSurface(K, rowsIn, false, (i, j) => [rowsIn[i][j].p[0] * 0.5, rowsIn[i][j].p[1], rowsIn[i][j].p[2] + 0.2], true);
  }

  /* --- hood: a cowl around the face and a short shoulder drape --- */
  kitBlob(K, HC, HU, HV, {
    shape: (d) => {
      const p = headShape(d, 0), n = headNormal(d);
      let o = 0.022 + 0.012 * Math.max(0, -d[2]);
      const tip = sstepJ(0.2, 0.9, d[1]) * sstepJ(0.1, -0.8, d[2]);
      return V3.add(V3.add(p, V3.mul(n, o)), [0, 0.035 * tip, -0.05 * tip]);
    },
    keep: (d) => !(d[2] > 0.25 && Math.abs(d[0]) < 0.66 && d[1] < 0.5 && d[1] > -0.85) && d[1] > -0.75,
    attr: (d) => ({ bone: B.head, w: 1, mat: mat.cape, bit: WBIT.hood, ao: 0.75 + 0.25 * sstepJ(-0.2, 0.7, d[1]) }),
  });
  kitTube(K, [[1.56, 0.075, 0.07], [1.52, 0.11, 0.095], [1.47, 0.17, 0.12], [1.42, 0.215, 0.14]].map(([y, rx, rz]) => ({ c: [0, y, -0.012], rx, rz })), RS, {
    n: 2.2, attr: (i, th, p) => ({ bone: p[1] > 1.53 ? B.head : B.chest, w: p[1] > 1.53 ? 0.5 : 1, mat: mat.cape, bit: WBIT.hood, ao: 0.85, u: th / TAU, v: p[1] }),
  });

  /* --- nasal helm: dome, band and nose guard --- */
  kitBlob(K, HC, HU, HV, {
    shape: (d) => { const p = headShape(d, 0), n = headNormal(d); return V3.add(p, V3.mul(n, 0.016 + 0.006 * Math.max(0, d[1]))); },
    keep: (d) => d[1] > 0.12 || (d[2] < -0.25 && d[1] > -0.45) || (Math.abs(d[0]) > 0.75 && d[1] > -0.3 && d[2] < 0.4),
    attr: (d) => ({ bone: B.head, w: 1, mat: mat.plate, bit: WBIT.helmet, ao: 0.8 + 0.2 * Math.max(0, d[1]) }),
  });
  if (hi) {
    kitTube(K, [{ c: [0, HC[1] + 0.012, HC[2] - 0.004], rx: 0.094, rz: 0.113 }, { c: [0, HC[1] + 0.03, HC[2] - 0.006], rx: 0.094, rz: 0.113 }], RS + 4, { attr: (i, th, p) => ({ bone: B.head, w: 1, mat: mat.steel, bit: WBIT.helmet, ao: 0.85, u: th / TAU, v: p[1] }) });
    kitGeo(K, new THREE.BoxGeometry(0.016, 0.07, 0.01), M4([0, HC[1] - 0.01, HC[2] + 0.113], [-0.12, 0, 0]), { bone: B.head, mat: mat.steel, bit: WBIT.helmet });
    kitGeo(K, new THREE.ConeGeometry(0.012, 0.03, 6), M4([0, HC[1] + 0.135, HC[2] - 0.01]), { bone: B.head, mat: mat.steel, bit: WBIT.helmet });
    // a gold circlet for lords and heralds
    kitTube(K, [{ c: [0, HC[1] + 0.045, HC[2] - 0.004], rx: 0.088, rz: 0.106 }, { c: [0, HC[1] + 0.06, HC[2] - 0.006], rx: 0.087, rz: 0.105 }], 20, { attr: (i, th, p) => ({ bone: B.head, w: 1, mat: mat.gold, bit: WBIT.circlet, u: th / TAU, v: p[1] }) });
  }

  /* --- quiver on the back, with fletched arrows --- */
  {
    const q0 = [0.075, 1.04, -0.165], q1 = [-0.085, 1.47, -0.19];
    kitTube(K, [{ c: q0, rx: 0.038, rz: 0.042 }, { c: V3.lerp(q0, q1, 0.5), rx: 0.044, rz: 0.048 }, { c: q1, rx: 0.048, rz: 0.052 }], hi ? 10 : 6, {
      cap0: 'dome', front: [0, 0, 1], attr: (i, th, p) => ({ bone: B.chest, w: 1, mat: mat.leather, bit: WBIT.quiver, ao: 0.85, u: th / TAU, v: p[1] }),
    });
    if (hi) {
      const dir = V3.norm(V3.sub(q1, q0));
      for (let k = 0; k < 5; k++) {
        const off = [(k % 3 - 1) * 0.018, 0, (Math.floor(k / 3) - 0.5) * 0.02];
        const base = V3.add(q1, off), tip = V3.add(base, V3.mul(dir, 0.13));
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(...dir));
        const m = new THREE.Matrix4().compose(new THREE.Vector3(...V3.lerp(base, tip, 0.5)), q, new THREE.Vector3(1, 1, 1));
        kitGeo(K, new THREE.CylinderGeometry(0.004, 0.004, 0.13, 4), m, { bone: B.chest, mat: mat.wood, bit: WBIT.quiver });
        for (const r of [0, Math.PI / 2]) {
          const mf = new THREE.Matrix4().compose(new THREE.Vector3(...V3.add(tip, V3.mul(dir, -0.04))), q.clone().multiply(new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r, 0))), new THREE.Vector3(1, 1, 1));
          kitGeo(K, new THREE.BoxGeometry(0.026, 0.06, 0.002), mf, { bone: B.chest, mat: mat.fletch, bit: WBIT.quiver });
        }
      }
    }
  }

  /* --- weapons and shields, authored in grip space then placed in the fist --- */
  const gripR = [-SK.fist[0], SK.fist[1], SK.fist[2]], gripL = [SK.fist[0], SK.fist[1], SK.fist[2]];
  const inHand = (grip, tilt, m) => new THREE.Matrix4().compose(new THREE.Vector3(...grip), new THREE.Quaternion().setFromEuler(new THREE.Euler(tilt, 0, 0)), new THREE.Vector3(1, 1, 1)).multiply(m);
  const R = (geo, m, o) => kitGeo(K, geo, inHand(gripR, 1.85, m), { bone: B.farmR, w: 1, ...o }); // relaxed grip: point forward and a little down
  // sword: beveled blade, guard, wrapped grip, pommel
  {
    const sh = new THREE.Shape();
    sh.moveTo(-0.024, 0); sh.lineTo(-0.021, 0.6); sh.quadraticCurveTo(-0.014, 0.7, 0, 0.76); sh.quadraticCurveTo(0.014, 0.7, 0.021, 0.6); sh.lineTo(0.024, 0); sh.closePath();
    const blade = new THREE.ExtrudeGeometry(sh, { depth: 0.003, bevelEnabled: true, bevelThickness: 0.0045, bevelSize: 0.008, bevelSegments: 1, steps: 1, curveSegments: hi ? 6 : 2 });
    blade.translate(0, 0, -0.0015);
    R(blade, M4([0, 0.1, 0], [0, Math.PI / 2, 0]), { mat: mat.steel, bit: WBIT.sword });
    R(new THREE.BoxGeometry(0.03, 0.022, 0.18), M4([0, 0.095, 0]), { mat: mat.steel, bit: WBIT.sword });
    R(new THREE.CylinderGeometry(0.0135, 0.0145, 0.15, hi ? 8 : 5), M4([0, 0.01, 0]), { mat: mat.leather, bit: WBIT.sword });
    R(new THREE.SphereGeometry(0.022, hi ? 10 : 5, hi ? 6 : 3), M4([0, -0.075, 0]), { mat: mat.gold, bit: WBIT.sword });
  }
  // flanged mace
  R(new THREE.CylinderGeometry(0.015, 0.018, 0.62, hi ? 8 : 5), M4([0, 0.25, 0]), { mat: mat.wood, bit: WBIT.mace });
  R(new THREE.CylinderGeometry(0.035, 0.035, 0.14, hi ? 10 : 6), M4([0, 0.58, 0]), { mat: mat.steel, bit: WBIT.mace });
  for (let k = 0; k < (hi ? 7 : 4); k++) { const a = (k / (hi ? 7 : 4)) * TAU; R(new THREE.BoxGeometry(0.008, 0.12, 0.05), M4([Math.sin(a) * 0.045, 0.58, Math.cos(a) * 0.045], [0, a, 0]), { mat: mat.steel, bit: WBIT.mace }); }
  R(new THREE.ConeGeometry(0.02, 0.05, hi ? 8 : 4), M4([0, 0.675, 0]), { mat: mat.steel, bit: WBIT.mace });
  // bearded axe
  {
    R(new THREE.CylinderGeometry(0.016, 0.019, 0.78, hi ? 8 : 5), M4([0, 0.27, 0]), { mat: mat.wood, bit: WBIT.axe });
    const sh = new THREE.Shape();
    sh.moveTo(0.0, 0.565); sh.lineTo(0.035, 0.575); sh.quadraticCurveTo(0.11, 0.6, 0.165, 0.66); sh.quadraticCurveTo(0.195, 0.56, 0.17, 0.43); sh.quadraticCurveTo(0.12, 0.47, 0.075, 0.505); sh.lineTo(0.035, 0.52); sh.lineTo(0.0, 0.525); sh.closePath();
    const head = new THREE.ExtrudeGeometry(sh, { depth: 0.006, bevelEnabled: true, bevelThickness: 0.005, bevelSize: 0.006, bevelSegments: 1, curveSegments: hi ? 6 : 2 });
    head.translate(0, 0, -0.003);
    R(head, M4([0.005, 0, 0], [0, -Math.PI / 2, 0]), { mat: mat.steel, bit: WBIT.axe });
  }
  // staff: a gently crooked shaft, gold bands and a gem in a claw
  {
    const pts = [];
    for (let i = 0; i <= (hi ? 12 : 5); i++) {
      const t = i / (hi ? 12 : 5), y = lerp(-0.62, 1.12, t);
      pts.push({ c: [0.012 * Math.sin(t * 9.0), y, 0.01 * Math.cos(t * 7.0)], rx: lerp(0.021, 0.017, t), rz: lerp(0.021, 0.017, t) });
    }
    const base = K.n;
    kitTube(K, pts, hi ? 8 : 5, { cap0: 'dome', front: [0, 0, 1], attr: (i, th, p) => ({ bone: B.farmR, w: 1, mat: mat.wood, bit: WBIT.staff, u: th / TAU, v: p[1] * 3 }) });
    kitMove(K, base, inHand(gripR, 0.22, new THREE.Matrix4()));
    const S = (geo, mm, o) => kitGeo(K, geo, inHand(gripR, 0.22, mm), { bone: B.farmR, w: 1, bit: WBIT.staff, ...o });
    for (const y of [0.72, 1.02]) S(new THREE.CylinderGeometry(0.024, 0.024, 0.03, hi ? 10 : 5), M4([0.012 * Math.sin(((y + 0.62) / 1.74) * 9), y, 0]), { mat: mat.gold });
    for (let k = 0; k < 3; k++) { const a = (k / 3) * TAU; S(new THREE.ConeGeometry(0.008, 0.1, 4), M4([Math.sin(a) * 0.03, 1.17, Math.cos(a) * 0.03], [Math.cos(a) * -0.45, 0, Math.sin(a) * 0.45]), { mat: mat.wood }); }
    S(new THREE.OctahedronGeometry(0.042, hi ? 1 : 0), M4([0.0, 1.19, 0], [0, 0, 0], [0.8, 1.15, 0.8]), { mat: mat.glow });
  }
  // shields strapped to the left forearm: a heater with the realm's arms, or a round shield with a boss
  {
    const L = (geo, m, o) => kitGeo(K, geo, new THREE.Matrix4().compose(new THREE.Vector3(...gripL), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)).multiply(m), { bone: B.farmL, w: 1, ...o });
    const hs = new THREE.Shape();
    hs.moveTo(-0.25, 0.3); hs.lineTo(0.25, 0.3); hs.lineTo(0.25, 0.08); hs.quadraticCurveTo(0.23, -0.2, 0.0, -0.36); hs.quadraticCurveTo(-0.23, -0.2, -0.25, 0.08); hs.closePath();
    const heater = new THREE.ExtrudeGeometry(hs, { depth: 0.012, bevelEnabled: true, bevelThickness: 0.008, bevelSize: 0.012, bevelSegments: hi ? 2 : 1, curveSegments: hi ? 10 : 3 });
    // curve it around the arm
    const hp = heater.attributes.position;
    for (let i = 0; i < hp.count; i++) hp.setZ(i, hp.getZ(i) - 0.32 * hp.getX(i) * hp.getX(i));
    heater.computeVertexNormals();
    const hm = M4([0.075, 0.14, 0.015], [0, Math.PI / 2, 0]);
    L(heater, hm, { matFn: (p, n) => (n[0] > 0.6 ? mat.shieldFace : n[0] < -0.6 ? mat.wood : mat.steel), bit: WBIT.shield, uvScale: 1 });
    // round shield
    const disc = new THREE.CylinderGeometry(0.3, 0.3, 0.022, hi ? 32 : 14, 1);
    L(disc, M4([0.08, 0.13, 0.02], [0, 0, Math.PI / 2]), { matFn: (p, n) => (n[0] > 0.6 ? mat.shieldFace : n[0] < -0.6 ? mat.wood : mat.steel), bit: WBIT.shieldRound });
    L(new THREE.SphereGeometry(0.068, hi ? 14 : 7, hi ? 8 : 4, 0, TAU, 0, Math.PI / 2), M4([0.092, 0.13, 0.02], [0, 0, -Math.PI / 2]), { mat: mat.steel, bit: WBIT.shieldRound });
    L(new THREE.TorusGeometry(0.3, 0.012, hi ? 6 : 3, hi ? 40 : 14), M4([0.082, 0.13, 0.02], [0, Math.PI / 2, 0]), { mat: mat.steel, bit: WBIT.shieldRound });
    // bow: a recurved stave with a wrapped grip, and its string
    const arc = [];
    for (let i = 0; i <= (hi ? 16 : 6); i++) {
      const t = i / (hi ? 16 : 6) * 2 - 1, a = t * 0.9;
      const recurve = 0.035 * Math.pow(Math.abs(t), 6);
      arc.push({ c: [0.0, Math.sin(a) * 0.66, (Math.cos(a) - 1) * 0.66 + recurve], rx: lerp(0.016, 0.008, Math.abs(t)), rz: lerp(0.019, 0.009, Math.abs(t)) });
    }
    const bowBase = K.n;
    kitTube(K, arc, hi ? 6 : 4, { front: [0, 0, 1], side: [1, 0, 0], attr: (i, th, p) => ({ bone: B.farmL, w: 1, mat: Math.abs(p[1]) < 0.06 ? mat.leather : mat.wood, bit: WBIT.bow, u: th / TAU, v: p[1] }) });
    kitMove(K, bowBase, M4(V3.add(gripL, [0.005, 0, 0])));
    const tipY = Math.sin(0.9) * 0.66, tipZ = (Math.cos(0.9) - 1) * 0.66 + 0.035;
    L(new THREE.CylinderGeometry(0.0022, 0.0022, tipY * 2, 3), M4([0.005, 0, tipZ]), { mat: mat.string, bit: WBIT.bow });
  }
  return K.build();
}

/* ------------------------------------------------------------------ */
/* humanoid shaders                                                    */
/* ------------------------------------------------------------------ */
const ACTOR_COMMON = /* glsl */`
  mat3 rotX(float a){ float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }
  mat3 rotY(float a){ float c = cos(a), s = sin(a); return mat3(c, 0.0, -s, 0.0, 1.0, 0.0, s, 0.0, c); }
  mat3 rotZ(float a){ float c = cos(a), s = sin(a); return mat3(c, s, 0.0, -s, c, 0.0, 0.0, 0.0, 1.0); }
`;
const HSK = { // skeleton constants for GLSL
  SPINE: glv(SK.spine), NECK: glv(SK.neck), SHL: glv(SK.shoulder), SHR: glv([-SK.shoulder[0], SK.shoulder[1], SK.shoulder[2]]),
  ELL: glv(SK.elbow), ELR: glv([-SK.elbow[0], SK.elbow[1], SK.elbow[2]]), HIL: glv(SK.hip), HIR: glv([-SK.hip[0], SK.hip[1], SK.hip[2]]),
  KNL: glv(SK.knee), KNR: glv([-SK.knee[0], SK.knee[1], SK.knee[2]]), CAPE: glv(SK.capeTop),
};
function humanVS(depth) {
  return /* glsl */`
  ${GLSL_COMMON}
  ${ACTOR_COMMON}
  uniform float uTime;
  attribute float aBone; attribute float aW; attribute float aMat; attribute float aBit; attribute vec2 aUV; attribute float aAO;
  attribute vec4 iPos;   // x y z yaw
  attribute vec4 iAnim;  // walk phase, walk amount, action (type + progress), death
  attribute vec4 iColA;  // tabard rgb, scale
  attribute vec4 iColB;  // armour / robe rgb, flags (1 bone, 2 troll, 4 hunched)
  attribute vec4 iMisc;  // skin tone, part mask, hit flash, hair tone
  attribute vec4 iStyle; // outfit, emblem realm, female, bulk
  ${depth ? '' : 'varying vec3 vW; varying vec3 vN; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vTab; varying vec3 vArm; varying vec4 vMisc; varying vec4 vStyle; varying float vFlags; varying float vBit;'}
  vec3 P; vec3 Nn;
  void rotP(mat3 R, vec3 pv){ P = pv + R * (P - pv); Nn = R * Nn; }
  void main(){
    ${depth ? '' : 'vW = vec3(0.0); vN = vec3(0.0, 1.0, 0.0); vO = vec3(0.0); vUV = aUV; vMat = aMat; vAO = aAO; vTab = iColA.rgb; vArm = iColB.rgb; vMisc = iMisc; vStyle = iStyle; vFlags = iColB.w; vBit = aBit;'}
    if (aBit > -0.5) {
      int bit = int(aBit + 0.5);
      int mask = int(iMisc.y + 0.5);
      if (((mask >> bit) & 1) == 0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
    }
    P = position; Nn = normal;
    int bone = int(aBone + 0.5);
    int m = int(aMat + 0.5);
    float fem = iStyle.z, bulk = iStyle.w;
    bool gear = m == 5 || m == 6 || m == 9 || m == 15 || m == 18 || m == 19 || m == 24 || m == 14;
    bool torso = bone <= 1 || bone == 11;
    bool arm = bone >= 3 && bone <= 6;
    // body shape: female proportions, burly trolls, the lean dead
    if (fem > 0.5) {
      float y = P.y;
      if (torso) {
        float sx = mix(1.0, 0.86, smoothstep(1.27, 1.42, y)) * mix(1.0, 0.89, smoothstep(1.0, 1.08, y) * (1.0 - smoothstep(1.15, 1.24, y))) * mix(1.0, 1.07, smoothstep(0.86, 0.93, y) * (1.0 - smoothstep(0.98, 1.04, y)));
        P.x *= sx;
        P.z += 0.024 * smoothstep(1.19, 1.26, y) * (1.0 - smoothstep(1.32, 1.39, y)) * smoothstep(0.02, 0.07, P.z) * (1.0 - smoothstep(0.03, 0.1, abs(abs(P.x) - 0.072)));
      }
      if (arm) { P.x -= sign(P.x) * 0.022; if (!gear) P -= Nn * 0.004; }
      if (bone == 2 && !gear) P.x *= 0.95;
    }
    if (!gear && abs(bulk) > 0.01) {
      P += Nn * (bulk > 0.0 ? 0.03 : 0.022) * bulk;
      if (torso) P.x *= 1.0 + 0.1 * bulk * smoothstep(1.15, 1.42, P.y);
    }
    if (arm && bulk > 0.01) P.x += sign(P.x) * 0.035 * bulk;
    ${depth ? '' : 'vO = P;'}

    /* ------------------- animation ------------------- */
    float ph = iAnim.x, amt = clamp(iAnim.y, 0.0, 1.5), death = clamp(iAnim.w, 0.0, 1.0);
    float atype = floor(iAnim.z + 1e-4), at = clamp(fract(iAnim.z), 0.0, 1.0);
    float k = min(amt, 1.0), run = clamp((amt - 1.0) * 2.0, 0.0, 1.0), idle = 1.0 - k;
    float hunched = mod(floor(iColB.w / 4.0), 2.0);
    float t = uTime + iPos.x * 0.37 + iPos.z * 0.21;
    float s1 = sin(ph), c1 = cos(ph);
    // legs: swing, and knees that fold as each leg passes through
    float stride = (0.48 + 0.24 * run) * k;
    float thL = -s1 * stride, thR = s1 * stride;
    float shL = 0.05 + ((0.62 + 0.6 * run) * pow(max(0.0, c1), 1.6) + 0.14 * max(0.0, -s1)) * k;
    float shR = 0.05 + ((0.62 + 0.6 * run) * pow(max(0.0, -c1), 1.6) + 0.14 * max(0.0, s1)) * k;
    // arms swing against the legs; elbows bend more when running
    float uaL = s1 * (0.42 + 0.25 * run) * k, uaR = -s1 * (0.42 + 0.25 * run) * k;
    float faL = -0.16 - 0.18 * k - 1.05 * run - 0.12 * max(0.0, -uaL), faR = -0.16 - 0.18 * k - 1.05 * run - 0.12 * max(0.0, -uaR);
    float uaLz = 0.05 + 0.03 * run + 0.02 * idle * sin(t * 0.9), uaRz = -0.05 - 0.03 * run - 0.02 * idle * sin(t * 0.9 + 1.0);
    float chestX = 0.05 * k + 0.2 * run + hunched * 0.38 + 0.012 * sin(t * 1.7) * idle;
    float chestY = -0.11 * s1 * k;
    float headX = -hunched * 0.3 + 0.05 * sin(t * 0.33) * idle - 0.06 * run, headY = 0.28 * sin(t * 0.21) * idle + 0.09 * s1 * k;
    float pelvisY = 0.1 * s1 * k;
    float bob = (0.03 + 0.03 * run) * (0.55 - abs(s1)) * k;
    float swayX = 0.012 * sin(t * 0.45) * idle + 0.012 * s1 * k * (1.0 - run);
    float stepZ = 0.0;
    float capeX = 0.07 + 0.3 * k + 0.32 * run;
    if (atype > 0.5 && atype < 1.5) {
      // one-handed strike: wind up, cut across, recover
      float wind = smoothstep(0.0, 0.35, at), strike = smoothstep(0.35, 0.55, at), rec = smoothstep(0.62, 1.0, at);
      uaR = mix(mix(uaR, -2.45, wind), 0.2, strike); uaR = mix(uaR, -0.15, rec);
      uaRz = mix(mix(uaRz, -0.6, wind), 0.4, strike); uaRz = mix(uaRz, -0.06, rec);
      faR = mix(mix(faR, -1.25, wind), -0.12, strike); faR = mix(faR, -0.3, rec);
      chestY = mix(mix(chestY, -0.45, wind), 0.5, strike); chestY = mix(chestY, 0.0, rec);
      chestX += 0.16 * strike * (1.0 - rec);
      uaL = mix(uaL, -0.75, wind * (1.0 - rec)); faL = mix(faL, -0.95, wind * (1.0 - rec));
      stepZ = 0.1 * strike * (1.0 - rec);
      thL = mix(thL, -0.32, strike * (1.0 - rec)); shL = mix(shL, 0.32, strike * (1.0 - rec)); thR = mix(thR, 0.18, strike * (1.0 - rec));
    } else if (atype > 1.5 && atype < 2.5) {
      // bow: turn side-on, raise, draw to the cheek, loose
      float raise = smoothstep(0.0, 0.25, at), draw = smoothstep(0.2, 0.75, at), rel = smoothstep(0.82, 0.88, at), rec = smoothstep(0.88, 1.0, at);
      float hold = raise * (1.0 - rec);
      chestY = mix(chestY, -0.85, hold); headY = mix(headY, 0.78, hold); headX = mix(headX, 0.06, hold);
      uaL = mix(uaL, -0.72, hold); uaLz = mix(uaLz, 1.18, hold); faL = mix(faL, -0.05, hold);
      uaR = mix(uaR, -1.42, hold); uaRz = mix(uaRz, 0.55, hold); faR = mix(faR, -0.4 - 1.55 * draw * (1.0 - rel), hold);
      thL = mix(thL, -0.15, hold); thR = mix(thR, 0.15, hold);
    } else if (atype > 2.5 && atype < 3.5) {
      // spellcasting: hands gather the power, then push it out
      float raise = smoothstep(0.0, 0.3, at), rel = smoothstep(0.86, 1.0, at);
      float tremble = sin(uTime * 23.0) * 0.05 * (1.0 - rel);
      uaL = mix(uaL, -1.15 + tremble, raise); uaR = mix(uaR, -1.25 - tremble, raise);
      uaLz = mix(uaLz, -0.3, raise); uaRz = mix(uaRz, 0.3, raise);
      faL = mix(faL, -0.75, raise); faR = mix(faR, -0.75, raise);
      uaL = mix(uaL, -1.55, rel); uaR = mix(uaR, -1.55, rel); faL = mix(faL, -0.1, rel); faR = mix(faR, -0.1, rel);
      chestX -= 0.1 * raise * (1.0 - rel); chestX += 0.12 * rel; headX += 0.08 * raise;
      capeX += 0.15 * raise;
    } else if (atype > 3.5 && atype < 4.5) {
      float kk = sin(at * 3.1416);
      chestX -= 0.3 * kk; headX -= 0.28 * kk; uaL -= 0.25 * kk; uaR -= 0.25 * kk; stepZ = -0.06 * kk;
    } else if (atype > 4.5 && atype < 5.5) {
      float kk = smoothstep(0.0, 0.2, at) * (1.0 - smoothstep(0.8, 1.0, at));
      uaL = mix(uaL, -1.3, kk); faL = mix(faL, -0.95, kk); uaLz = mix(uaLz, -0.3, kk); chestX = mix(chestX, 0.12, kk);
      thL = mix(thL, -0.25, kk); shL = mix(shL, 0.3, kk); thR = mix(thR, 0.2, kk);
    } else if (atype > 5.5 && atype < 6.5) {
      thL = -0.85; thR = -0.45; shL = 1.3; shR = 0.95; uaL = -0.55; uaR = -0.55; uaLz = 0.55; uaRz = -0.55; capeX = 0.9;
    } else if (atype > 7.5 && atype < 8.5) {
      // overhead two-handed smash
      float wind = smoothstep(0.0, 0.4, at), strike = smoothstep(0.4, 0.6, at), rec = smoothstep(0.65, 1.0, at);
      float a = mix(mix(0.0, -2.9, wind), 0.18, strike); a = mix(a, -0.2, rec);
      uaR = a; uaL = a; faR = -0.35; faL = -0.35; uaLz = -0.22; uaRz = 0.22;
      chestX += 0.4 * strike * (1.0 - rec) - 0.25 * wind * (1.0 - strike);
      stepZ = 0.12 * strike * (1.0 - rec); thL = mix(thL, -0.4, strike * (1.0 - rec)); shL = mix(shL, 0.4, strike * (1.0 - rec));
    }
    // in the saddle: thighs forward and apart, shins down, hands on the reins, moving with the horse
    float mounted = mod(floor(iColB.w / 8.0), 2.0);
    float spreadL = 0.0, spreadR = 0.0;
    if (mounted > 0.5) {
      float hk = clamp(amt * 2.2, 0.0, 1.0), trot = smoothstep(0.55, 0.95, amt), gal = smoothstep(1.05, 1.4, amt);
      thL = -1.28; thR = -1.28; shL = 1.22; shR = 1.22; spreadL = 0.5; spreadR = -0.5;
      if (atype < 0.5 || atype > 5.5) { uaL = -0.45; uaR = -0.45; faL = -1.0; faR = -1.0; uaLz = -0.16; uaRz = 0.16; }
      chestX = 0.06 + 0.18 * gal + 0.03 * sin(ph * 2.0) * trot; chestY *= 0.3; pelvisY = 0.0;
      headX = -0.08 * gal + 0.02 * sin(t * 0.33); headY *= 0.5;
      bob = (abs(sin(ph)) * (0.012 + 0.03 * trot) * (1.0 - gal) + (0.5 + 0.5 * sin(ph + 2.6)) * 0.05 * gal) * hk;
      swayX = 0.0; stepZ = 0.0;
      capeX = 0.12 + 0.35 * hk + 0.5 * gal;
    }
    // dying: the knees go, then the body falls back
    float d1 = smoothstep(0.0, 0.45, death), d2 = smoothstep(0.2, 1.0, death);
    if (death > 0.0) {
      thL = mix(thL, -0.55, d1); thR = mix(thR, -0.35, d1); shL = mix(shL, 1.15, d1); shR = mix(shR, 0.9, d1);
      chestX = mix(mix(chestX, 0.4, d1), -0.15, d2); headX = mix(headX, -0.35, d2); headY = mix(headY, 0.4, d2);
      uaL = mix(uaL, -0.35, d2); uaR = mix(uaR, -0.95, d2); uaLz = mix(uaLz, 0.85, d2); uaRz = mix(uaRz, -0.65, d2); faL = mix(faL, -0.3, d2); faR = mix(faR, -0.6, d2);
      capeX = mix(capeX, -0.1, d2);
    }

    /* ------------------- skinning ------------------- */
    if (bone == 11) {
      // the cape hangs from the shoulders and trails with speed and wind
      float dn = clamp((${HSK.CAPE}.y - P.y) / 1.05, 0.0, 1.0);
      float wave = 0.06 * sin(t * 2.3 + P.y * 5.0) * dn * (0.35 + k) + 0.03 * sin(t * 1.3 + P.x * 9.0) * dn;
      rotP(rotZ(0.06 * sin(t * 1.1) * dn) * rotX((capeX + wave) * dn * (0.45 + 0.55 * dn)), ${HSK.CAPE});
    }
    if (bone == 6) rotP(rotX(faR * aW), ${HSK.ELR});
    if (bone == 5 || bone == 6) { float w = bone == 5 ? aW : 1.0; rotP(rotZ(uaRz * w) * rotX(uaR * w), ${HSK.SHR}); }
    if (bone == 4) rotP(rotX(faL * aW), ${HSK.ELL});
    if (bone == 3 || bone == 4) { float w = bone == 3 ? aW : 1.0; rotP(rotZ(uaLz * w) * rotX(uaL * w), ${HSK.SHL}); }
    if (bone == 2) rotP(rotY(headY * aW) * rotX(headX * aW), ${HSK.NECK});
    if ((bone >= 1 && bone <= 6) || bone == 11) { float w = bone == 1 ? aW : 1.0; rotP(rotY(chestY * w) * rotX(chestX * w), ${HSK.SPINE}); }
    if (bone == 8) rotP(rotX(shL * aW), ${HSK.KNL});
    if (bone == 7 || bone == 8) { float w = bone == 7 ? aW : 1.0; rotP(rotZ(spreadL * w) * rotX(thL * w), ${HSK.HIL}); }
    if (bone == 10) rotP(rotX(shR * aW), ${HSK.KNR});
    if (bone == 9 || bone == 10) { float w = bone == 9 ? aW : 1.0; rotP(rotZ(spreadR * w) * rotX(thR * w), ${HSK.HIR}); }
    rotP(rotY(pelvisY), vec3(0.0, 0.95, 0.0));
    P.y += bob - 0.2 * d1 * (1.0 - d2); P.x += swayX; P.z += stepZ;
    if (death > 0.0) { rotP(rotX(-1.5 * d2), vec3(0.0, 0.0, -0.12)); P.y += 0.14 * d2; }

    float sc = iColA.w;
    P *= sc;
    float c = cos(iPos.w), s = sin(iPos.w);
    vec3 w = iPos.xyz + vec3(P.x * c + P.z * s, P.y, -P.x * s + P.z * c);
    ${depth ? '' : 'vW = w; vN = vec3(Nn.x * c + Nn.z * s, Nn.y, -Nn.x * s + Nn.z * c);'}
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
}
/* shading shared by people and beasts */
const GLSL_ACTOR_LIGHT = /* glsl */`
  vec3 actorLight(vec3 alb, vec3 n, vec3 V, float rough, float metal, float ao, float sh, float sss){
    vec3 L = uLightDir;
    float ndl = dot(n, L);
    float diffW = clamp((ndl + sss) / (1.0 + sss), 0.0, 1.0);
    vec3 amb = mix(uAmbient * vec3(0.6, 0.56, 0.46), uAmbient * 1.06, n.y * 0.5 + 0.5);
    vec3 H = safeNormalize(L + V);
    float gloss = 1.0 - rough;
    float spw = exp2(1.0 + 10.5 * gloss);
    float spec = pow(max(dot(n, H), 0.0), spw) * (spw + 8.0) / 28.0;
    vec3 F0 = mix(vec3(0.04), alb, metal);
    vec3 F = F0 + (1.0 - F0) * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    vec3 col = alb * (1.0 - metal * 0.85) * (uLightColor * diffW * sh * 0.9 + amb * ao * 0.78);
    col += uLightColor * spec * F * sh * clamp(ndl * 3.0, 0.0, 1.0);
    vec3 R = reflect(-V, n);
    vec3 env = mix(uAmbient * vec3(0.5, 0.47, 0.4), mix(uHorizon, uZenith, clamp(R.y, 0.0, 1.0)) * 0.95, smoothstep(-0.25, 0.3, R.y));
    float fres = pow(1.0 - max(dot(n, V), 0.0), 5.0);
    col += env * ao * (metal * mix(F0, vec3(1.0), fres) * (0.3 + 0.7 * gloss) + (1.0 - metal) * 0.05 * fres * gloss);
    col += (uLightColor * 0.16 * sh + uAmbient * 0.22) * pow(1.0 - max(dot(n, V), 0.0), 3.0) * 0.3 * ao;
    return col;
  }
  // fade a fine procedural pattern to its average once it gets smaller than a pixel
  float fineMix(float pat, float avg, vec2 g){ vec2 fw = fwidth(g); return mix(pat, avg, clamp(max(fw.x, fw.y) * 0.9 - 0.15, 0.0, 1.0)); }
`;
const humanoidMat = mat({
  vertexShader: humanVS(false),
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_ACTOR_LIGHT}
    varying vec3 vW; varying vec3 vN; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vTab; varying vec3 vArm; varying vec4 vMisc; varying vec4 vStyle; varying float vFlags; varying float vBit;
    float sdBox2(vec2 p, vec2 b){ vec2 d = abs(p) - b; return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0); }
    float sdDiamond(vec2 p, float r){ return (abs(p.x) + abs(p.y)) * 0.7071 - r; }
    float emblemD(vec2 q, float realm){
      float d;
      if (realm < 0.5) {
        d = sdBox2(q - vec2(0.0, -0.45), vec2(0.62, 0.13));
        d = min(d, max(sdDiamond(q - vec2(0.0, -0.06), 0.34), -(q.y + 0.45)));
        d = min(d, max(sdDiamond(q - vec2(-0.44, -0.13), 0.26), -(q.y + 0.45)));
        d = min(d, max(sdDiamond(q - vec2(0.44, -0.13), 0.26), -(q.y + 0.45)));
        d = min(d, min(length(q - vec2(0.0, 0.42)) - 0.1, min(length(q - vec2(-0.44, 0.27)) - 0.085, length(q - vec2(0.44, 0.27)) - 0.085)));
      } else if (realm < 1.5) {
        d = abs(length(q) - 0.74) - 0.075;
        d = min(d, min(length(q - vec2(0.0, 0.3)) - 0.17, min(length(q - vec2(-0.27, -0.17)) - 0.17, length(q - vec2(0.27, -0.17)) - 0.17)));
      } else {
        d = min(sdBox2(q, vec2(0.08, 0.82)), sdBox2(q, vec2(0.82, 0.08)));
        vec2 r = vec2(q.x + q.y, q.y - q.x) * 0.7071;
        d = min(d, min(sdBox2(r, vec2(0.06, 0.58)), sdBox2(r, vec2(0.58, 0.06))));
        d = max(min(d, length(q) - 0.2), -(length(q) - 0.09));
      }
      return d;
    }
    float emblemMask(vec2 q, float realm){ float d = emblemD(q, realm); float fw = fwidth(d) + 1e-4; return 1.0 - smoothstep(-fw, fw, d); }
    void main(){
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      int src = int(vMat + 0.5), m = src;
      int outfit = int(vStyle.x + 0.5);
      float realm = vStyle.y;
      bool robed = outfit == 2 || outfit == 3 || outfit == 9;
      bool undead = outfit == 6 || outfit == 7;
      // dress the body layers for this outfit
      if (m == 20) m = (outfit == 0 || outfit == 7) ? 2 : (outfit == 1 || outfit == 5) ? 3 : robed ? 16 : outfit == 4 ? 10 : outfit == 10 ? 17 : 0;
      else if (m == 21) m = (outfit == 0 || outfit == 7) ? 2 : outfit == 10 ? 17 : robed ? 16 : (outfit == 6 || outfit == 8) ? 0 : 10;
      else if (m == 22) m = (outfit == 0 || outfit == 10) ? 2 : (outfit == 1 || outfit == 5) ? 3 : (outfit == 6 || outfit == 8) ? 0 : 10;
      else if (m == 23) m = (outfit == 0 || outfit == 1 || outfit == 7 || outfit == 10) ? 3 : 0;
      vec3 skin = mix(vec3(0.94, 0.75, 0.6), vec3(0.5, 0.33, 0.22), vMisc.x);
      if (outfit == 8) skin = vec3(0.42, 0.5, 0.36) * (0.85 + 0.3 * vnoise(vO.xy * 14.0));
      if (outfit == 6) skin = vec3(0.86, 0.83, 0.72);
      if (outfit == 7) skin = vec3(0.56, 0.62, 0.66);
      vec3 hair = mix(vec3(0.16, 0.1, 0.06), vec3(0.86, 0.72, 0.46), vMisc.w);
      vec3 alb = vArm; float rough = 0.7, metal = 0.0, sss = 0.0, emit = 0.0;
      float ao = vAO;
      if (m == 0) {
        alb = skin; rough = 0.55; sss = undead ? 0.0 : 0.45;
        alb *= 0.93 + 0.1 * vnoise(vO.xy * 40.0 + vO.z * 30.0);
        bool face = vO.y > 1.58 && vO.z > 0.04;
        if (face && !undead) {
          // lips, cheeks and brows
          float lips = (1.0 - smoothstep(0.012, 0.02, abs(vO.x) * 0.55 + abs(vO.y - 1.617) * 1.6)) * smoothstep(0.06, 0.09, vO.z);
          alb = mix(alb, alb * vec3(0.78, 0.48, 0.45), lips * 0.85);
          alb = mix(alb, alb * vec3(1.0, 0.82, 0.78), 0.25 * (1.0 - smoothstep(0.0, 0.02, length(vec2(abs(vO.x) - 0.045, vO.y - 1.655)))));
          float brow = (1.0 - smoothstep(0.0025, 0.0045, abs(vO.y - 1.703 + 0.25 * (abs(vO.x) - 0.032) * (abs(vO.x) - 0.032) * 40.0))) * (1.0 - smoothstep(0.045, 0.055, abs(vO.x))) * step(0.012, abs(vO.x));
          alb = mix(alb, hair * 0.7, brow * 0.9);
        }
        if (outfit == 6) {
          // bare bone: ribs, sockets
          float ribs = smoothstep(0.32, 0.46, abs(fract(vO.y * 17.0) - 0.5)) * step(1.08, vO.y) * (1.0 - step(1.4, vO.y)) * step(0.03, abs(vO.x));
          alb *= 1.0 - 0.6 * ribs * step(0.0, vO.z);
          float sock = 1.0 - smoothstep(0.016, 0.022, length(vec2(abs(vO.x) - 0.031, (vO.y - 1.684) * 0.9)));
          alb *= 1.0 - 0.9 * sock * step(0.04, vO.z);
          rough = 0.8;
        }
      } else if (m == 1) {
        // the realm's colours: woven cloth, gold trim and the arms on the chest
        float wv = fineMix(0.5 + 0.5 * sin(vO.x * 900.0) * sin(vO.y * 900.0), 0.5, vO.xy * 140.0);
        alb = vTab * (0.86 + 0.16 * wv) * (0.9 + 0.12 * sin(vO.x * 30.0 + vnoise(vO.xy * 6.0) * 4.0));
        vec3 trimC = realm < 0.5 ? vec3(0.95, 0.74, 0.32) : vec3(0.92, 0.88, 0.76);
        float trim = (1.0 - smoothstep(0.018, 0.026, vUV.y - 0.58)) + smoothstep(0.128, 0.136, abs(vUV.x));
        if (vO.z > 0.0 && vO.y > 1.12) {
          float em = emblemMask(vec2(vO.x, vO.y - 1.258) / 0.09, realm);
          alb = mix(alb, trimC * 1.05, em);
        }
        alb = mix(alb, trimC, clamp(trim, 0.0, 1.0) * 0.9);
        rough = 0.85;
      } else if (m == 2) {
        // riveted mail
        vec2 g = vec2(vO.x * 0.8 + vO.z, vO.y) * 95.0;
        vec2 cell = fract(g + vec2(0.5 * mod(floor(g.y), 2.0), 0.0)) - 0.5;
        float ring = smoothstep(0.17, 0.05, abs(length(cell) - 0.3));
        float r = fineMix(ring, 0.55, g);
        alb = vArm * (0.38 + 0.75 * r) * (outfit == 7 ? vec3(0.85, 0.72, 0.6) : vec3(1.0));
        rough = mix(0.62, 0.4, r); metal = 0.85;
        if (outfit == 7) alb = mix(alb, vec3(0.42, 0.3, 0.18), smoothstep(0.55, 0.85, vnoise(vO.xy * 22.0)) * 0.7);
      } else if (m == 3) {
        vec3 lc = (src == 20 && outfit == 1) ? vArm : vec3(0.3, 0.2, 0.12);
        alb = lc * (0.82 + 0.3 * vnoise(vO.xy * 70.0 + vO.z * 50.0)) * (0.95 + 0.08 * vnoise(vO.xy * 9.0));
        float seam = fineMix(1.0 - smoothstep(0.0, 0.004, abs(fract(vO.y * 6.0) - 0.5) - 0.47), 0.0, vO.xy * 220.0);
        alb *= 1.0 - 0.25 * seam;
        rough = 0.62;
      } else if (m == 4) {
        alb = vec3(0.17, 0.11, 0.07) * (0.85 + 0.25 * vnoise(vO.xy * 60.0)); rough = 0.5;
      } else if (m == 5) {
        alb = vec3(0.42, 0.28, 0.16) * (0.78 + 0.25 * sin(vUV.y * 120.0 + vnoise(vUV * 25.0) * 5.0)); rough = 0.65;
      } else if (m == 6) {
        alb = vec3(0.78, 0.8, 0.84) * (0.92 + 0.08 * vnoise(vec2(vUV.x * 3.0, vUV.y * 300.0))); rough = 0.22; metal = 1.0;
      } else if (m == 7) {
        float strands = fineMix(vnoise(vec2(vUV.x * 170.0, vUV.y * 7.0)), 0.5, vec2(vUV.x * 170.0, vUV.y * 7.0));
        alb = hair * (0.68 + 0.45 * strands); rough = 0.42; sss = 0.2;
        if (outfit == 6) alb = vec3(0.3, 0.3, 0.3);
      } else if (m == 8) {
        float folds = 0.84 + 0.16 * sin(vUV.x * 22.0 + vnoise(vUV * vec2(4.0, 3.0)) * 3.0);
        alb = vTab * 0.6 * folds * (0.95 + 0.08 * fineMix(sin(vO.x * 700.0) * sin(vO.y * 700.0), 0.0, vO.xy * 110.0));
        if (undead) alb = vec3(0.16, 0.16, 0.17) * folds;
        rough = 0.9; sss = 0.15;
      } else if (m == 9) {
        alb = mix(vec3(1.0), vTab, 0.55) * 1.4; emit = 1.3 + 0.4 * sin(vW.y * 3.0 + vMisc.y);
      } else if (m == 10) {
        vec3 wool = mix(vec3(0.42, 0.36, 0.28), vTab, outfit == 4 ? 0.75 : 0.22);
        alb = wool * (0.86 + 0.16 * fineMix(sin(vO.x * 800.0 + vO.z * 800.0) * sin(vO.y * 800.0), 0.0, vO.xy * 130.0)) * (0.92 + 0.1 * vnoise(vO.xy * 11.0));
        rough = 0.92; sss = 0.1;
      } else if (m == 13) {
        alb = vec3(0.92, 0.88, 0.76); rough = 0.4;
      } else if (m == 14) {
        alb = vec3(0.04); rough = 0.12;
        if (undead) { alb = vec3(0.45, 0.85, 1.0); emit = 2.2; }
        else {
          // a white with a dark iris toward the front
          float irisD = length(vec2(abs(vO.x) - 0.031, vO.y - 1.684) * vec2(1.0, 1.3));
          alb = mix(vec3(0.05, 0.04, 0.03), vec3(0.85, 0.83, 0.8), smoothstep(0.004, 0.006, irisD));
        }
      } else if (m == 15) {
        alb = vec3(1.0, 0.76, 0.34); rough = 0.3; metal = 1.0;
      } else if (m == 16) {
        // robes: fine weave, deep folds, an embroidered hem
        float folds = 0.82 + 0.18 * sin(atan(vO.x, vO.z) * 9.0 + vnoise(vO.xy * 5.0) * 2.5);
        alb = vArm * folds * (0.92 + 0.08 * fineMix(sin(vO.x * 900.0 + vO.z * 900.0) * sin(vO.y * 900.0), 0.0, vO.xy * 140.0));
        float hem = (1.0 - smoothstep(0.03, 0.045, vUV.y - 0.1)) * step(0.0, 0.3 - vUV.y);
        float cuff = src == 16 && vO.y < 1.0 && vO.y > 0.8 && abs(vO.x) > 0.21 ? 1.0 - smoothstep(0.015, 0.025, abs(vO.y - 0.895)) : 0.0;
        alb = mix(alb, vec3(0.93, 0.75, 0.36), clamp(hem + cuff, 0.0, 1.0) * 0.85);
        rough = 0.88; sss = 0.12;
      } else if (m == 17) {
        alb = vArm * 1.08 * (0.94 + 0.06 * vnoise(vO.xy * 30.0)); rough = 0.3; metal = 0.9;
        if (outfit == 7) alb = mix(alb, vec3(0.4, 0.28, 0.16), smoothstep(0.5, 0.8, vnoise(vO.xy * 20.0)) * 0.6);
      } else if (m == 18) {
        alb = vec3(0.85, 0.82, 0.7); rough = 0.8;
      } else if (m == 19) {
        // painted shield: the heater carries the arms, the round shield the realm's quarters
        vec3 field = vTab, charge = realm < 0.5 ? vec3(0.95, 0.75, 0.32) : vec3(0.93, 0.9, 0.8);
        if (vUV.x > 5.0) {
          vec2 q = (vUV - vec2(10.0, -0.02)) / 0.17;
          alb = mix(field, charge, emblemMask(q, realm));
        } else {
          vec2 q = vUV - 0.5;
          float sector = mod(floor((atan(q.y, q.x) + 3.1416) / 0.7854), 2.0);
          alb = mix(field, field * 0.45 + charge * 0.45, sector);
        }
        alb *= 0.85 + 0.2 * vnoise(vUV * 40.0);
        alb = mix(alb, alb * 0.6, smoothstep(0.6, 0.9, vnoise(vUV * 9.0)) * 0.4);
        rough = 0.7;
      } else if (m == 24) {
        alb = vec3(0.86, 0.84, 0.8); rough = 0.9;
      }
      float sh = shadowAt(vW, n);
      vec3 col = actorLight(alb, n, V, rough, metal, ao, sh, sss);
      col += alb * pointLights(vW, n) * (0.4 + 0.6 * ao);
      col += alb * emit;
      // enchanted weapons: a slow river of light along the blade or shaft
      int fl = int(vFlags + 0.5);
      int gk = (fl >> 4) & 7;
      int wb = int(vBit + 0.5);
      if (gk > 0 && vBit > -0.5 && (wb == 0 || wb == 1 || wb == 2 || wb == 3 || wb == 6)) {
        float gs = float((fl >> 7) & 3);
        vec3 gc = gk == 1 ? vec3(2.4, 0.95, 0.3) : gk == 2 ? vec3(0.55, 1.35, 2.4) : gk == 3 ? vec3(2.2, 1.85, 0.9) : gk == 4 ? vec3(1.45, 0.65, 2.4) : gk == 5 ? vec3(0.7, 2.1, 0.55) : vec3(1.0, 1.5, 2.6);
        float flow = 0.5 + 0.5 * sin(vO.y * 31.0 + vO.z * 17.0 - uTime * (2.6 + gs) + vnoise(vO.xy * 26.0 + uTime * 0.7) * 4.0);
        float rim = spow(1.0 - abs(dot(n, V)), 2.0);
        float core = (m == 6 || m == 9) ? 1.0 : m == 5 ? 0.32 : 0.5;
        col += gc * (0.07 + 0.16 * gs) * core * (0.35 + flow * flow + rim * 1.3) * (0.85 + 0.15 * sin(uTime * 5.0 + vO.y * 3.0));
      }
      col = mix(col, vec3(1.0, 0.95, 0.85) * 1.4, clamp(vMisc.z, 0.0, 1.0) * 0.55);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
