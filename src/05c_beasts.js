/* ================================================================== */
/* beasts: wolves, boars and bears on a three-joint leg rig             */
/* ================================================================== */
// bones: 0 hindquarters, 1 forequarters, 2 head, 3-5 front left (upper, lower, foot), 6-8 front right,
// 9-11 back left, 12-14 back right, 15 tail, 16 jaw
const BB = { hind: 0, fore: 1, head: 2, tail: 15, jaw: 16 };
// body rings are [z, top, bottom, half width]; neck rings [z, y, half width, half height]; points are [x, y, z] for the left side
const BEASTS = {
  wolf: {
    body: [[-0.54, 0.735, 0.605, 0.055], [-0.48, 0.775, 0.55, 0.1], [-0.39, 0.792, 0.53, 0.118], [-0.26, 0.786, 0.556, 0.106], [-0.11, 0.79, 0.53, 0.113], [0.03, 0.8, 0.478, 0.124], [0.16, 0.815, 0.446, 0.129], [0.28, 0.83, 0.456, 0.118], [0.37, 0.838, 0.52, 0.1], [0.43, 0.845, 0.6, 0.075]],
    spineZ: -0.04,
    neck: [[0.25, 0.71, 0.09, 0.1], [0.34, 0.758, 0.094, 0.112], [0.44, 0.81, 0.086, 0.104], [0.53, 0.855, 0.072, 0.086], [0.6, 0.884, 0.064, 0.073]],
    skull: [0, 0.902, 0.645], skullR: [0.078, 0.074, 0.09],
    muzzle: [[0.675, 0.889, 0.052, 0.052], [0.73, 0.874, 0.043, 0.043], [0.78, 0.862, 0.034, 0.035], [0.818, 0.855, 0.026, 0.028]],
    jaw: [[0.665, 0.842, 0.044, 0.024], [0.73, 0.833, 0.033, 0.019], [0.79, 0.829, 0.022, 0.013]],
    cheek: [0.048, 0.868, 0.605, 0.03, 0.042, 0.046],
    ears: { at: [0.044, 0.952, 0.612], h: 0.09, w: 0.036, tilt: 0.2, back: 0.15 },
    eyes: { at: [0.043, 0.921, 0.712], r: 0.0115 },
    front: { top: [0.085, 0.69, 0.26], mid: [0.09, 0.46, 0.2], low: [0.09, 0.145, 0.235], foot: [0.09, 0.028, 0.262], r: [0.07, 0.048, 0.036, 0.029, 0.027] },
    back: { top: [0.08, 0.69, -0.37], mid: [0.093, 0.44, -0.26], low: [0.095, 0.175, -0.425], foot: [0.095, 0.028, -0.385], r: [0.085, 0.056, 0.038, 0.027, 0.026] },
    shoulderMass: [0.075, 0.63, 0.24, 0.062, 0.13, 0.095],
    haunch: [0.068, 0.645, -0.37, 0.07, 0.13, 0.12],
    tail: { pts: [[-0.52, 0.715], [-0.6, 0.67], [-0.69, 0.585], [-0.77, 0.47], [-0.82, 0.37], [-0.84, 0.32]], r: [0.04, 0.058, 0.066, 0.06, 0.042, 0.012] },
    fur: { shag: 0.007, ruff: 0.018, saddle: 0.78, belly: 0.62, sock: 0.08, strand: 1.0 },
    paw: 'paw', eye: [0.82, 0.55, 0.12], stride: [0.62, 1.35], deadLift: 0.06, fangs: true,
  },
  boar: {
    body: [[-0.49, 0.57, 0.43, 0.06], [-0.44, 0.665, 0.335, 0.145], [-0.32, 0.72, 0.302, 0.18], [-0.14, 0.748, 0.29, 0.19], [0.04, 0.785, 0.29, 0.198], [0.18, 0.815, 0.31, 0.192], [0.3, 0.808, 0.345, 0.17], [0.39, 0.76, 0.39, 0.135], [0.44, 0.7, 0.44, 0.09]],
    spineZ: -0.04,
    neck: [[0.24, 0.6, 0.15, 0.18], [0.33, 0.6, 0.152, 0.19], [0.41, 0.572, 0.13, 0.163], [0.48, 0.547, 0.112, 0.135]],
    skull: [0, 0.53, 0.53], skullR: [0.098, 0.104, 0.118],
    muzzle: [[0.6, 0.495, 0.074, 0.074], [0.68, 0.462, 0.057, 0.057], [0.75, 0.437, 0.047, 0.046], [0.8, 0.424, 0.043, 0.042]],
    jaw: [[0.59, 0.44, 0.062, 0.03], [0.68, 0.413, 0.045, 0.022], [0.75, 0.403, 0.033, 0.016]],
    cheek: null,
    ears: { at: [0.062, 0.6, 0.5], h: 0.075, w: 0.04, tilt: 0.75, back: 0.35 },
    eyes: { at: [0.07, 0.555, 0.6], r: 0.009 },
    front: { top: [0.098, 0.5, 0.25], mid: [0.104, 0.3, 0.215], low: [0.104, 0.11, 0.255], foot: [0.104, 0.024, 0.27], r: [0.08, 0.05, 0.035, 0.029, 0.028] },
    back: { top: [0.095, 0.52, -0.33], mid: [0.104, 0.33, -0.25], low: [0.104, 0.13, -0.345], foot: [0.104, 0.024, -0.315], r: [0.092, 0.058, 0.038, 0.029, 0.028] },
    shoulderMass: [0.09, 0.5, 0.24, 0.072, 0.15, 0.11],
    haunch: [0.08, 0.52, -0.33, 0.07, 0.13, 0.115],
    tail: { pts: [[-0.48, 0.55], [-0.52, 0.5], [-0.545, 0.43], [-0.553, 0.37], [-0.555, 0.33]], r: [0.018, 0.015, 0.012, 0.016, 0.006] },
    fur: { shag: 0.006, ruff: 0.0, saddle: 0.45, belly: 0.18, sock: 0.55, strand: 1.4 },
    paw: 'hoof', tusks: true, crest: true, eye: [0.12, 0.07, 0.04], stride: [0.42, 1.0], deadLift: 0.1,
  },
  bear: {
    body: [[-0.77, 0.99, 0.75, 0.11], [-0.7, 1.12, 0.63, 0.24], [-0.52, 1.215, 0.58, 0.295], [-0.28, 1.225, 0.585, 0.29], [-0.04, 1.27, 0.575, 0.3], [0.18, 1.355, 0.6, 0.318], [0.36, 1.37, 0.66, 0.29], [0.5, 1.3, 0.735, 0.225], [0.58, 1.2, 0.81, 0.15]],
    spineZ: -0.1,
    neck: [[0.36, 1.03, 0.2, 0.22], [0.46, 1.05, 0.23, 0.26], [0.58, 1.04, 0.2, 0.22], [0.7, 1.017, 0.17, 0.182], [0.78, 1.003, 0.152, 0.158]],
    skull: [0, 1.015, 0.83], skullR: [0.158, 0.14, 0.148],
    muzzle: [[0.92, 0.978, 0.096, 0.088], [0.985, 0.955, 0.078, 0.071], [1.035, 0.942, 0.064, 0.058], [1.065, 0.936, 0.055, 0.05]],
    jaw: [[0.91, 0.905, 0.08, 0.038], [0.98, 0.89, 0.062, 0.03], [1.04, 0.885, 0.046, 0.022]],
    cheek: [0.1, 0.96, 0.8, 0.065, 0.075, 0.08],
    ears: { at: [0.105, 1.125, 0.79], h: 0.07, w: 0.055, tilt: 0.25, back: 0.1, round: true },
    eyes: { at: [0.074, 1.04, 0.945], r: 0.012 },
    front: { top: [0.165, 0.92, 0.37], mid: [0.178, 0.56, 0.31], low: [0.18, 0.15, 0.37], foot: [0.18, 0.05, 0.42], r: [0.145, 0.118, 0.1, 0.088, 0.084] },
    back: { top: [0.158, 0.93, -0.5], mid: [0.172, 0.56, -0.38], low: [0.176, 0.15, -0.52], foot: [0.176, 0.05, -0.43], r: [0.16, 0.122, 0.098, 0.085, 0.08] },
    shoulderMass: [0.14, 0.98, 0.33, 0.1, 0.24, 0.17],
    haunch: [0.14, 0.95, -0.5, 0.1, 0.21, 0.18],
    tail: { pts: [[-0.76, 0.9], [-0.81, 0.87], [-0.845, 0.82]], r: [0.05, 0.048, 0.02] },
    fur: { shag: 0.014, ruff: 0.016, saddle: 0.18, belly: 0.12, sock: 0.5, strand: 0.75 },
    paw: 'bear', eye: [0.08, 0.05, 0.03], stride: [0.85, 1.7], rears: true, deadLift: 0.2, fangs: true,
  },
  deer: {
    body: [[-0.55, 0.99, 0.85, 0.05], [-0.5, 1.04, 0.77, 0.1], [-0.4, 1.06, 0.72, 0.12], [-0.25, 1.04, 0.74, 0.112], [-0.08, 1.04, 0.71, 0.117], [0.08, 1.06, 0.68, 0.126], [0.22, 1.09, 0.69, 0.126], [0.33, 1.1, 0.75, 0.11], [0.4, 1.08, 0.84, 0.085]],
    spineZ: -0.06,
    neck: [[0.26, 0.98, 0.085, 0.11], [0.35, 1.07, 0.078, 0.1], [0.43, 1.2, 0.062, 0.083], [0.49, 1.33, 0.05, 0.066], [0.53, 1.44, 0.046, 0.058]],
    skull: [0, 1.5, 0.585], skullR: [0.055, 0.058, 0.074],
    muzzle: [[0.63, 1.48, 0.04, 0.042], [0.69, 1.458, 0.032, 0.034], [0.735, 1.445, 0.026, 0.028]],
    jaw: [[0.62, 1.448, 0.034, 0.018], [0.685, 1.433, 0.026, 0.014], [0.73, 1.428, 0.018, 0.01]],
    cheek: null,
    ears: { at: [0.046, 1.56, 0.56], h: 0.12, w: 0.042, tilt: 1.0, back: 0.35 },
    eyes: { at: [0.046, 1.528, 0.615], r: 0.012 },
    front: { top: [0.07, 0.94, 0.26], mid: [0.076, 0.6, 0.23], low: [0.078, 0.18, 0.25], foot: [0.078, 0.028, 0.26], r: [0.055, 0.034, 0.021, 0.017, 0.016] },
    back: { top: [0.072, 0.95, -0.4], mid: [0.082, 0.62, -0.3], low: [0.082, 0.25, -0.46], foot: [0.082, 0.028, -0.43], r: [0.074, 0.044, 0.023, 0.017, 0.016] },
    shoulderMass: [0.058, 0.9, 0.24, 0.05, 0.12, 0.085],
    haunch: [0.058, 0.93, -0.4, 0.062, 0.12, 0.1],
    tail: { pts: [[-0.54, 0.98], [-0.6, 0.95], [-0.63, 0.89]], r: [0.03, 0.036, 0.014] },
    fur: { shag: 0.0, ruff: 0, saddle: 0.4, belly: 0.8, sock: 0.2, strand: 1.6 },
    paw: 'hoof', eye: [0.06, 0.04, 0.03], stride: [0.8, 2.0], deadLift: 0.08, grazes: true,
  },
};
BEASTS.stag = { ...BEASTS.deer, antlers: true };
BEASTS.horse = {
  body: [[-0.96, 1.4, 1.16, 0.09], [-0.88, 1.53, 1.02, 0.21], [-0.72, 1.6, 0.95, 0.27], [-0.5, 1.56, 0.9, 0.285], [-0.26, 1.5, 0.86, 0.29], [0.0, 1.5, 0.84, 0.295], [0.24, 1.55, 0.86, 0.28], [0.44, 1.62, 0.92, 0.25], [0.6, 1.6, 1.0, 0.21], [0.72, 1.5, 1.1, 0.16]],
  spineZ: -0.2,
  neck: [[0.5, 1.36, 0.17, 0.27], [0.65, 1.54, 0.14, 0.23], [0.78, 1.72, 0.115, 0.18], [0.89, 1.86, 0.095, 0.14], [0.96, 1.97, 0.08, 0.11]],
  skull: [0, 2.0, 1.03], skullR: [0.085, 0.1, 0.11],
  muzzle: [[1.1, 1.92, 0.082, 0.1], [1.2, 1.83, 0.075, 0.088], [1.3, 1.74, 0.07, 0.078], [1.38, 1.67, 0.066, 0.07], [1.43, 1.62, 0.06, 0.062]],
  jaw: [[1.06, 1.85, 0.075, 0.07], [1.18, 1.76, 0.06, 0.05], [1.3, 1.67, 0.052, 0.035], [1.38, 1.61, 0.045, 0.025]],
  cheek: [0.065, 1.89, 1.06, 0.03, 0.075, 0.085],
  ears: { at: [0.05, 2.08, 0.98], h: 0.14, w: 0.038, tilt: 0.12, back: -0.1 },
  eyes: { at: [0.079, 2.0, 1.07], r: 0.017 },
  front: { top: [0.14, 1.12, 0.48], mid: [0.15, 0.56, 0.47], low: [0.15, 0.2, 0.5], foot: [0.15, 0.06, 0.53], r: [0.12, 0.062, 0.046, 0.042, 0.052] },
  back: { top: [0.14, 1.14, -0.62], mid: [0.16, 0.86, -0.5], low: [0.16, 0.56, -0.8], foot: [0.16, 0.06, -0.73], r: [0.15, 0.09, 0.052, 0.044, 0.052] },
  shoulderMass: [0.13, 1.22, 0.48, 0.11, 0.28, 0.18],
  haunch: [0.13, 1.3, -0.68, 0.13, 0.3, 0.22],
  tail: { pts: [[-0.95, 1.43], [-1.04, 1.36], [-1.12, 1.15], [-1.16, 0.9], [-1.17, 0.66]], r: [0.06, 0.085, 0.1, 0.085, 0.035] },
  fur: { shag: 0, ruff: 0, saddle: 0.08, belly: 0.08, sock: 0.85, strand: 2.4 },
  paw: 'horse', eye: [0.05, 0.035, 0.025], stride: [1.15, 2.7], deadLift: 0.3, mane: true, hairTail: true, tack: true, darkCoat: true,
};
const HORSE_SEAT = 1.62; // saddle height (m) the rider sits on

// Catmull-Rom through rows of numbers (n output rows)
function crResample(rows, n) {
  const out = [], m = rows.length;
  for (let k = 0; k < n; k++) {
    const t = (k / (n - 1)) * (m - 1);
    const i = Math.min(m - 2, Math.floor(t)), f = t - i;
    const p0 = rows[Math.max(0, i - 1)], p1 = rows[i], p2 = rows[i + 1], p3 = rows[Math.min(m - 1, i + 2)];
    out.push(p1.map((_, c) => {
      const a = p0[c], b = p1[c], cc = p2[c], d = p3[c];
      return 0.5 * (2 * b + (-a + cc) * f + (2 * a - 5 * b + 4 * cc - d) * f * f + (-a + 3 * b - 3 * cc + d) * f * f * f);
    }));
  }
  return out;
}
const fhash = (x) => { const s = Math.sin(x * 127.1 + 311.7) * 43758.5453; return s - Math.floor(s); };
// tufted fur: a radial offset along the ring (smooth clumps plus a little per-vertex scatter)
const furTuft = (amp, i, th, salt = 0) => amp * (0.55 + 0.3 * Math.sin(th * 9 + i * 2.1 + salt) * Math.sin(th * 5 - i * 1.3 + salt * 2) + 0.35 * (fhash(i * 37.1 + Math.round(th * 40) + salt) - 0.5));

function buildBeast(kind, lod) {
  const K = new SkinKit(), S = BEASTS[kind], hi = lod === 0, mat = AM, F = S.fur;
  const RS = hi ? 18 : 9, LS = hi ? 11 : 6;
  const up = [0, 1, 0], side = [1, 0, 0];
  const spineZ = S.spineZ;
  const bodyBone = (z) => (z > spineZ ? { bone: BB.fore, w: sstepJ(spineZ, spineZ + 0.32, z) } : { bone: BB.hind, w: sstepJ(spineZ, spineZ - 0.32, z) });

  /* --- body: a deep chest, tucked loin and a rump --- */
  const rows = crResample(S.body, hi ? 22 : 9);
  const bodyPath = rows.map(([z, top, bot, hw]) => ({ c: [0, (top + bot) / 2, z], rx: hw, rz: (top - bot) / 2 }));
  kitTube(K, bodyPath, RS, {
    front: up, side, n: 2.1, cap0: 'dome', cap1: 'dome',
    shape: hi && F.shag ? (i, th) => {
      const top = Math.cos(th);
      // a shaggier fringe under the chest and belly, and a mane over the withers
      const z = rows[Math.min(rows.length - 1, i)][0];
      let a = F.shag * (1 + 0.8 * sstepJ(-0.2, -0.9, top));
      if (F.ruff) a += F.ruff * sstepJ(0.0, 0.25, z - (rows[rows.length - 1][0] - 0.25)) * sstepJ(-0.5, 0.6, top);
      const r = furTuft(a, i, th);
      return [r * Math.sin(th), r * top];
    } : null,
    attr: (i, th, p) => {
      const top = Math.cos(th);
      return { ...bodyBone(p[2]), mat: mat.fur, ao: 0.58 + 0.42 * sstepJ(-0.98, 0.15, top), u: th / TAU, v: p[2] * 1.6 };
    },
  });
  /* --- bristle crest along the spine (boar) --- */
  if (S.crest) {
    const topAt = (z) => {
      // body top line near z, rising onto the neck
      const r = rows.reduce((a, q) => (Math.abs(q[0] - z) < Math.abs(a[0] - z) ? q : a), rows[0]);
      return z > S.neck[1][0] ? lerp(r[1], S.neck[S.neck.length - 1][1] + S.neck[S.neck.length - 1][3] * 0.8, sstepJ(S.neck[1][0], S.neck[S.neck.length - 1][0], z)) : r[1];
    };
    const n = hi ? 26 : 8;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1), z = lerp(0.47, -0.25, t);
      const h = (0.045 + 0.03 * Math.sin(Math.PI * Math.min(1, t * 1.5))) * (1 - 0.55 * t) * (0.8 + 0.4 * fhash(i * 3.7));
      for (const side2 of hi ? [-1, 1] : [0]) {
        const g = new THREE.ConeGeometry(hi ? 0.013 : 0.02, h, hi ? 5 : 4);
        const y = topAt(z) - 0.004;
        kitGeo(K, g, M4([side2 * 0.009, y + h * 0.4, z], [-0.75 + 0.2 * fhash(i * 9.1 + side2), 0, side2 * 0.18]), { ...bodyBone(z), ...(z > 0.42 ? { bone: BB.head, w: 0.3 } : {}), mat: mat.furDark, ao: 0.85 });
      }
    }
  }
  /* --- shoulder and haunch masses ride a little with the legs --- */
  for (const s of [1, -1]) {
    const m1 = S.shoulderMass, m2 = S.haunch;
    kitBlob(K, [m1[0] * s * 0.88, m1[1], m1[2]], hi ? 14 : 8, hi ? 9 : 5, { r: [m1[3], m1[4], m1[5]], attr: (d) => ({ bone: s > 0 ? 3 : 6, w: 0.25, mat: mat.fur, ao: 0.9 + 0.1 * sstepJ(-0.8, 0.5, d[1]) }) });
    kitBlob(K, [m2[0] * s * 0.9, m2[1], m2[2]], hi ? 14 : 8, hi ? 9 : 5, { r: [m2[3], m2[4], m2[5]], attr: (d) => ({ bone: s > 0 ? 9 : 12, w: 0.3, mat: mat.fur, ao: 0.9 + 0.1 * sstepJ(-0.8, 0.5, d[1]) }) });
  }

  /* --- neck and head --- */
  const nk = S.neck, nz0 = nk[0][0], nz1 = nk[nk.length - 1][0];
  kitTube(K, crResample(nk, hi ? 7 : 3).map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), RS, {
    front: up, side, n: 2.1,
    shape: hi && (F.ruff || F.shag) ? (i, th) => { const r = furTuft((F.ruff || F.shag) * (0.6 + 0.6 * sstepJ(-0.3, -1, Math.cos(th))), i, th, 3.3); return [r * Math.sin(th), r * Math.cos(th)]; } : null,
    attr: (i, th, p) => ({ bone: BB.head, w: 0.12 + 0.88 * sstepJ(nz0, nz1 + 0.04, p[2]), mat: mat.fur, ao: 0.72 + 0.28 * sstepJ(-0.8, 0.3, Math.cos(th)), u: th / TAU, v: p[2] * 1.6 }),
  });
  const SKl = S.skull, R = S.skullR;
  kitBlob(K, SKl, hi ? 18 : 9, hi ? 12 : 6, {
    shape: (d) => {
      const p = [d[0] * R[0], d[1] * R[1], d[2] * R[2]];
      // brow ridge and a flatter forehead; cheekbones
      p[1] += 0.008 * gauss(d[0] / 0.6, (d[2] - 0.7) / 0.3) * Math.max(0, d[1]);
      p[0] += 0.006 * Math.sign(d[0]) * gauss((Math.abs(d[0]) - 0.7) / 0.3, (d[1] + 0.1) / 0.4);
      return p;
    },
    attr: (d) => ({ bone: BB.head, w: 1, mat: mat.fur, ao: 0.82 + 0.18 * Math.max(0, d[1]) }),
  });
  const mz = S.muzzle;
  kitTube(K, mz.map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), hi ? 14 : 7, {
    front: up, side, cap1: 'dome', n: 2.2,
    attr: (i, th, p) => ({ bone: BB.head, w: 1, mat: mat.fur, ao: 0.85 + 0.15 * Math.cos(th), u: th / TAU, v: p[2] }),
  });
  // lower jaw on its own bone, with a dark mouth lining
  kitTube(K, S.jaw.map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), hi ? 12 : 6, { front: up, side, cap1: 'dome', attr: (i, th, p) => ({ bone: BB.jaw, w: 1, mat: mat.fur, ao: 0.72, u: th / TAU, v: p[2] }) });
  if (hi) {
    kitTube(K, S.jaw.map(([z, y, rx, ry]) => ({ c: [0, y + ry * 0.45, z - 0.006], rx: rx * 0.7, rz: ry * 0.45 })), 8, { front: up, side, cap1: 'dome', attr: () => ({ bone: BB.jaw, w: 1, mat: mat.mouth, ao: 0.6 }) });
    kitTube(K, mz.map(([z, y, rx, ry]) => ({ c: [0, y - ry * 0.55, z - 0.006], rx: rx * 0.72, rz: ry * 0.3 })), 8, { front: up, side, cap1: 'dome', attr: () => ({ bone: BB.head, w: 1, mat: mat.mouth, ao: 0.6 }) });
  }
  // nose
  {
    const m0 = mz[mz.length - 1];
    if (kind === 'boar') kitBlob(K, [0, m0[1] + 0.003, m0[0] + 0.026], hi ? 14 : 6, hi ? 6 : 3, { r: [m0[2] * 0.96, m0[3] * 0.92, 0.014], attr: (d) => ({ bone: BB.head, w: 1, mat: mat.nose, ao: d[2] > 0.5 && Math.hypot(d[0] - 0.35, d[1]) < 0.22 || d[2] > 0.5 && Math.hypot(d[0] + 0.35, d[1]) < 0.22 ? 0.3 : 1 }) });
    else kitBlob(K, [0, m0[1] + m0[3] * 0.42, m0[0] + 0.012], hi ? 10 : 6, hi ? 6 : 3, { shape: (d) => [d[0] * m0[2] * 0.95, d[1] * m0[3] * 0.62 - 0.004 * d[2], d[2] * m0[3] * 0.72], attr: () => ({ bone: BB.head, w: 1, mat: mat.nose, ao: 1 }) });
  }
  // cheek fur
  if (S.cheek) for (const s of [1, -1]) {
    const c = S.cheek;
    kitBlob(K, [c[0] * s, c[1], c[2]], hi ? 10 : 6, hi ? 7 : 4, {
      shape: (d) => { const t = hi ? furTuft(0.006, Math.round(d[1] * 6), Math.atan2(d[0], d[2]), s) : 0; return [d[0] * (c[3] + t), d[1] * (c[4] + t), d[2] * (c[5] + t) - 0.012 * Math.max(0, -d[2])]; },
      attr: () => ({ bone: BB.head, w: 1, mat: mat.fur, ao: 0.88 }),
    });
  }
  if (hi) {
    for (const s of [1, -1]) {
      const E = S.eyes;
      kitBlob(K, [E.at[0] * s, E.at[1], E.at[2]], 10, 7, { r: [E.r * 0.75, E.r * 0.85, E.r], attr: () => ({ bone: BB.head, w: 1, mat: mat.eye, ao: 1 }) });
      // a lid crease above the eye
      kitTube(K, [-0.7, -0.35, 0, 0.35, 0.7].map((a) => ({ c: [E.at[0] * s + Math.sin(a) * E.r * 0.95 * s * 0.6, E.at[1] + E.r * 0.72 * Math.cos(a), E.at[2] + Math.sin(a) * E.r * 0.8], rx: E.r * 0.3, rz: E.r * 0.3 })), 5, { front: [0, 0, 1], attr: () => ({ bone: BB.head, w: 1, mat: mat.furDark, ao: 0.7 }) });
      // fangs and incisors
      const j = S.jaw, m1 = mz[1];
      if (S.fangs) {
        kitGeo(K, new THREE.ConeGeometry(m1[2] * 0.14, m1[3] * 0.8, 6), M4([s * m1[2] * 0.5, m1[1] - m1[3] * 1.0, m1[0] + 0.012], [Math.PI, 0, 0]), { bone: BB.head, mat: mat.ivory });
        kitGeo(K, new THREE.ConeGeometry(j[1][2] * 0.15, j[1][3] * 1.25, 6), M4([s * j[1][2] * 0.5, j[1][1] + j[1][3] * 1.0, j[1][0] + 0.025], [0, 0, 0]), { bone: BB.jaw, mat: mat.ivory });
      }
    }
  }
  // ears
  for (const s of [1, -1]) {
    const E = S.ears;
    if (E.round) {
      kitBlob(K, [E.at[0] * s, E.at[1] + E.h * 0.3, E.at[2]], hi ? 10 : 6, hi ? 6 : 3, { shape: (d) => [d[0] * E.w * 0.7, d[1] * E.h * 0.62, d[2] * E.w * 0.42 - (d[2] > 0 ? 0.012 * (1 - Math.abs(d[1])) : 0)], attr: (d) => ({ bone: BB.head, w: 1, mat: d[2] > 0.3 ? mat.furDark : mat.fur, ao: d[2] > 0.3 ? 0.6 : 0.95 }) });
    } else {
      // a pointed ear, flattened, with a darker hollow on its face
      const rot = [-E.back, s * 0.25, -E.tilt * s];
      const g = new THREE.ConeGeometry(E.w, E.h, hi ? 10 : 5);
      g.scale(1, 1, 0.42);
      kitGeo(K, g, M4([E.at[0] * s, E.at[1] + E.h * 0.42, E.at[2]], rot), { bone: BB.head, mat: mat.fur, ao: 0.92 });
      if (hi) {
        const g2 = new THREE.ConeGeometry(E.w * 0.72, E.h * 0.8, 8);
        g2.scale(1, 1, 0.3);
        const m2 = M4([E.at[0] * s, E.at[1] + E.h * 0.4, E.at[2]], rot).multiply(M4([0, -E.h * 0.02, E.w * 0.16]));
        kitGeo(K, g2, m2, { bone: BB.head, mat: mat.furDark, ao: 0.4 });
      }
    }
  }
  // tusks: curving up and out from the lower jaw
  if (S.tusks) {
    for (const s of [1, -1]) {
      const pts = [];
      const j = S.jaw[1];
      for (let i = 0; i <= 6; i++) {
        const t = i / 6;
        pts.push({ c: [s * (j[2] * 0.95 + 0.04 * t), j[1] + 0.012 + 0.085 * t - 0.015 * t * t, j[0] + 0.01 + 0.03 * t - 0.04 * t * t], rx: 0.012 * (1 - t) + 0.0025, rz: 0.014 * (1 - t) + 0.0025 });
      }
      kitTube(K, pts, hi ? 7 : 4, { front: [0, 0, 1], cap1: 'dome', attr: () => ({ bone: BB.jaw, w: 1, mat: mat.ivory, ao: 1 }) });
    }
  }

  /* --- legs: upper, lower and foot bones; joints ease over a short span --- */
  for (const [front, LG] of [[1, S.front], [0, S.back]]) {
    for (const s of [1, -1]) {
      const b0 = front ? (s > 0 ? 3 : 6) : (s > 0 ? 9 : 12);
      const P = (p) => [p[0] * s, p[1], p[2]];
      const pts = [P(LG.top), P(LG.mid), P(LG.low), P(LG.foot)];
      const r = LG.r;
      const segs = hi ? [6, 7, 3] : [2, 3, 1];
      const path = [{ c: V3.add(pts[0], [0, 0.07, 0]), r: r[0] * 0.85, rel: 0, w: 0 }];
      for (let g = 0; g < 3; g++) {
        for (let i = 0; i < segs[g]; i++) {
          const t = i / segs[g];
          let rr;
          if (g === 0) rr = lerp(r[0], r[1], t) + (front ? 0.1 : 0.18) * r[0] * Math.sin(Math.PI * t) * (1 - t);
          else if (g === 1) rr = t < 0.5 ? lerp(r[1], r[2], t * 2) : lerp(r[2], r[3], t * 2 - 1);
          else rr = lerp(r[3], r[4], t);
          const w = g === 0 ? sstepJ(-0.15, 0.55, t) : sstepJ(-0.35, 0.42, t);
          path.push({ c: V3.lerp(pts[g], pts[g + 1], t), r: rr, rel: g, w });
        }
      }
      path.push({ c: pts[3], r: r[4], rel: 2, w: 1 });
      kitTube(K, path.map((q) => ({ c: q.c, rx: q.r * (q.rel ? 0.8 : 0.9), rz: q.r })), LS, {
        front: [0, 0, 1], side,
        shape: hi && F.shag ? (i, th) => { const a = furTuft(F.shag * (path[i].rel ? 0.45 : 1), i, th, b0); return [a * Math.sin(th), a * Math.cos(th)]; } : null,
        attr: (i, th, p) => ({ bone: b0 + path[i].rel, w: path[i].w, mat: mat.fur, ao: 0.62 + 0.38 * sstepJ(0.0, 0.7, p[1] / LG.top[1]) * (0.75 + 0.25 * Math.abs(Math.sin(th))), u: th / TAU, v: p[1] * 1.6 }),
      });
      const fb = b0 + 2, F0 = pts[3], rf = r[4];
      if (S.paw === 'paw') {
        // a padded paw with four toes and claws
        kitBlob(K, V3.add(F0, [0, 0.0, rf * 0.45]), hi ? 12 : 6, hi ? 7 : 3, { shape: (d) => [d[0] * rf * 1.25, d[1] * rf * (d[1] < 0 ? 0.55 : 0.85), d[2] * rf * 1.55], attr: (d) => ({ bone: fb, w: 1, mat: mat.fur, ao: d[1] < -0.4 ? 0.45 : 0.85 }) });
        if (hi) for (let tI = 0; tI < 4; tI++) {
          const tx = (tI - 1.5) * rf * 0.55, tz = rf * (1.55 - 0.18 * Math.abs(tI - 1.5));
          kitBlob(K, V3.add(F0, [tx, -rf * 0.08, tz]), 7, 4, { r: [rf * 0.33, rf * 0.36, rf * 0.42], attr: (d) => ({ bone: fb, w: 1, mat: mat.fur, ao: d[1] < -0.3 ? 0.4 : 0.8 }) });
          kitGeo(K, new THREE.ConeGeometry(rf * 0.1, rf * 0.42, 4), M4(V3.add(F0, [tx, -rf * 0.18, tz + rf * 0.42]), [Math.PI / 2 + 0.5, 0, 0]), { bone: fb, mat: mat.hoof });
        }
      } else if (S.paw === 'bear') {
        // broad pads; long claws in front; the hind foot is flat and long
        const L = front ? 1.0 : 1.55;
        kitBlob(K, V3.add(F0, [0, 0.0, rf * 0.35 * L]), hi ? 12 : 6, hi ? 7 : 3, { shape: (d) => [d[0] * rf * 1.18, d[1] * rf * (d[1] < 0 ? 0.5 : 0.8), d[2] * rf * 1.3 * L], attr: (d) => ({ bone: fb, w: 1, mat: mat.fur, ao: d[1] < -0.4 ? 0.45 : 0.85 }) });
        if (hi) for (let tI = 0; tI < 5; tI++) {
          const tx = (tI - 2) * rf * 0.42, tz = rf * (1.3 * L + 0.1 - 0.12 * Math.abs(tI - 2));
          kitGeo(K, new THREE.ConeGeometry(rf * 0.07, rf * (front ? 0.75 : 0.45), 5), M4(V3.add(F0, [tx, -rf * 0.12, tz + rf * 0.25]), [Math.PI / 2 + 0.75, 0, 0]), { bone: fb, mat: mat.ivory });
        }
      } else if (S.paw === 'horse') {
        kitBlob(K, V3.add(F0, [0, -0.01, rf * 0.25]), hi ? 12 : 6, hi ? 6 : 3, { shape: (d) => [d[0] * rf * 1.05, d[1] * rf * 0.9 + (d[1] > 0 ? -0.2 * rf * (1 - Math.abs(d[2])) : 0), d[2] * rf * 1.15], attr: () => ({ bone: fb, w: 1, mat: mat.hoof, ao: 0.85 }) });
      } else {
        // cloven hooves with dewclaws
        for (const cx of [-1, 1]) kitBlob(K, V3.add(F0, [cx * rf * 0.48, -0.004, rf * 0.45]), hi ? 8 : 5, hi ? 5 : 3, { shape: (d) => [d[0] * rf * 0.52, d[1] * rf * 0.95, d[2] * rf * (d[2] > 0 ? 1.15 : 0.8)], attr: () => ({ bone: fb, w: 1, mat: mat.hoof, ao: 0.85 }) });
        if (hi) for (const cx of [-1, 1]) kitBlob(K, V3.add(F0, [cx * rf * 0.7, rf * 1.2, -rf * 0.55]), 5, 3, { r: [rf * 0.22, rf * 0.3, rf * 0.25], attr: () => ({ bone: fb, w: 1, mat: mat.hoof, ao: 0.8 }) });
      }
    }
  }

  /* --- antlers: a beam sweeping up and back with tines along it --- */
  if (S.antlers) {
    for (const s of [1, -1]) {
      const base = [s * 0.032, S.skull[1] + S.skullR[1] * 0.75, S.skull[2] - 0.01];
      const beamPts = [];
      for (let i = 0; i <= 8; i++) {
        const t = i / 8;
        beamPts.push([base[0] + s * (0.05 + 0.2 * t - 0.06 * t * t), base[1] + 0.06 + 0.38 * t - 0.05 * t * t, base[2] - 0.08 * t - 0.12 * t * t + 0.1 * t * t * t]);
      }
      kitTube(K, beamPts.map((c, i) => ({ c, rx: lerp(0.014, 0.006, i / 8), rz: lerp(0.014, 0.006, i / 8) })), hi ? 6 : 4, { cap1: 'dome', front: [0, 0, 1], attr: () => ({ bone: BB.head, w: 1, mat: mat.ivory, ao: 0.85 }) });
      kitBlob(K, base, 6, 4, { r: [0.02, 0.016, 0.02], attr: () => ({ bone: BB.head, w: 1, mat: mat.furDark, ao: 0.7 }) });
      if (hi) {
        // brow tine forward, then two tines up along the beam
        for (const [k, dir, len] of [[1, [s * 0.15, 0.2, 1], 0.1], [4, [s * 0.1, 1, 0.45], 0.12], [6, [s * 0.15, 1, 0.1], 0.1]]) {
          const p0 = beamPts[k], d = V3.norm(dir);
          const pts = [0, 0.5, 1].map((t) => ({ c: V3.add(p0, V3.mul(d, len * t)), rx: lerp(0.009, 0.004, t), rz: lerp(0.009, 0.004, t) }));
          kitTube(K, pts, 5, { cap1: 'dome', front: [1, 0, 0], attr: () => ({ bone: BB.head, w: 1, mat: mat.ivory, ao: 0.9 }) });
        }
      }
    }
  }
  /* --- tail: the weight grows toward the tip so it bends along its length --- */
  {
    const T = S.tail;
    const rowsT = crResample(T.pts.map((p, i) => [p[0], p[1], T.r[i]]), hi ? 12 : 4);
    const path = rowsT.map(([z, y, rr], i) => ({ c: [0, y, z], rx: Math.max(0.003, rr), rz: Math.max(0.003, rr), w: i / (rowsT.length - 1) }));
    kitTube(K, path, hi ? 10 : 5, {
      cap1: 'dome', front: up, side,
      shape: hi && F.shag ? (i, th) => { const a = furTuft(F.shag * 1.6 * Math.sin(Math.PI * Math.min(1, path[i].w * 1.2)), i, th, 9.1); return [a * Math.sin(th), a * Math.cos(th)]; } : null,
      attr: (i) => ({ bone: BB.tail, w: 0.15 + 0.85 * path[i].w, mat: S.hairTail && i > 1 ? mat.hair : mat.fur, ao: 0.9 }),
    });
  }
  /* --- a mane along the crest of the neck --- */
  if (S.mane) {
    const nkr = crResample(S.neck, 9);
    const crest = nkr.map(([z, y, rx, ry], i) => {
      const t = i / (nkr.length - 1);
      return { c: [0, y + ry * 0.86, z - ry * 0.25], rx: 0.03 + 0.012 * Math.sin(t * Math.PI), rz: 0.05 + 0.05 * Math.sin(t * Math.PI), t };
    });
    crest.push({ c: [0, S.skull[1] + S.skullR[1] * 0.9, S.skull[2] - 0.02], rx: 0.025, rz: 0.04, t: 1 });
    kitTube(K, crest, hi ? 8 : 5, {
      cap0: 'dome', cap1: 'dome', front: [0, 1, 0], side,
      shape: hi ? (i, th) => { const a = 0.01 * Math.sin(th * 7 + i * 1.3) * Math.max(0, Math.cos(th)); return [a, a * 0.5]; } : null,
      attr: (i, th, p) => ({ bone: BB.head, w: 0.15 + 0.85 * sstepJ(S.neck[0][0], S.neck[S.neck.length - 1][0] + 0.04, p[2]), mat: mat.hair, ao: 0.85 }),
    });
    // a forelock between the ears
    kitBlob(K, [0, S.skull[1] + S.skullR[1] * 0.7, S.skull[2] + S.skullR[2] * 0.55], hi ? 8 : 5, 4, { r: [0.04, 0.025, 0.07], attr: () => ({ bone: BB.head, w: 1, mat: mat.hair, ao: 0.85 }) });
  }
  /* --- tack: saddle, saddle cloth in the rider's colours, bridle and reins --- */
  if (S.tack) {
    const seatY = HORSE_SEAT - 0.06, seatZ = 0.04;
    // a long cloth draped over the back and down the flanks
    const cloth = [];
    for (let i = 0; i <= (hi ? 8 : 4); i++) {
      const t = i / (hi ? 8 : 4), z = lerp(-0.42, 0.42, t);
      const r = crResample(S.body, 40).reduce((a, q) => (Math.abs(q[0] - z) < Math.abs(a[0] - z) ? q : a));
      cloth.push({ c: [0, (r[1] + r[2]) / 2, z], rx: r[3] * 1.05 + 0.01, rz: (r[1] - r[2]) / 2 * 1.04 + 0.012 });
    }
    kitTube(K, cloth, hi ? 18 : 10, {
      th0: -2.05, th1: 2.05, front: up, side, n: 2.1,
      shape: (i, th) => { const lo = sstepJ(1.2, 2.05, Math.abs(th)); return [Math.sin(th) * 0.03 * lo, -0.02 * lo]; },
      attr: (i, th, p) => ({ bone: p[2] > S.spineZ ? BB.fore : BB.hind, w: 1, mat: Math.abs(th) > 1.82 || i === 0 || i === cloth.length - 1 ? mat.gold : mat.cloth, ao: 0.8 + 0.2 * Math.cos(th * 0.5), u: th, v: p[2] }),
    });
    // the saddle: seat, pommel and cantle
    kitBlob(K, [0, seatY, seatZ], hi ? 14 : 8, hi ? 6 : 4, { shape: (d) => [d[0] * 0.2, d[1] * (d[1] > 0 ? 0.05 : 0.02) - 0.07 * d[0] * d[0], d[2] * 0.27], attr: () => ({ bone: BB.fore, w: 1, mat: mat.leather, ao: 0.9 }) });
    kitBlob(K, [0, seatY + 0.06, seatZ + 0.25], 8, 5, { r: [0.1, 0.07, 0.05], attr: () => ({ bone: BB.fore, w: 1, mat: mat.leather, ao: 0.9 }) });
    kitBlob(K, [0, seatY + 0.08, seatZ - 0.25], 8, 5, { r: [0.15, 0.08, 0.04], attr: () => ({ bone: BB.fore, w: 1, mat: mat.leather, ao: 0.9 }) });
    for (const s of [1, -1]) {
      // stirrup leathers and irons
      kitTube(K, [{ c: [s * 0.2, seatY - 0.02, seatZ], rx: 0.012, rz: 0.03 }, { c: [s * 0.33, seatY - 0.45, seatZ + 0.02], rx: 0.012, rz: 0.028 }, { c: [s * 0.36, seatY - 0.68, seatZ + 0.04], rx: 0.01, rz: 0.025 }], 4, { front: [0, 0, 1], attr: () => ({ bone: BB.fore, w: 1, mat: mat.leather, ao: 0.8 }) });
      if (hi) kitGeo(K, new THREE.TorusGeometry(0.05, 0.009, 5, 10), M4([s * 0.365, seatY - 0.73, seatZ + 0.04], [0, Math.PI / 2, 0]), { bone: BB.fore, mat: mat.steel });
      // bridle: cheek strap, noseband, reins to the pommel
      const m1 = S.muzzle[1], m3 = S.muzzle[3];
      kitTube(K, [{ c: [s * 0.088, S.skull[1] + 0.06, S.skull[2] - 0.02], rx: 0.008, rz: 0.012 }, { c: [s * 0.08, m1[1] - 0.02, m1[0] - 0.02], rx: 0.008, rz: 0.012 }, { c: [s * 0.07, m3[1] - 0.02, m3[0] - 0.04], rx: 0.008, rz: 0.012 }], 4, { front: [1, 0, 0], attr: () => ({ bone: BB.head, w: 1, mat: mat.leather, ao: 0.8 }) });
      kitGeo(K, new THREE.SphereGeometry(0.018, 6, 4), M4([s * 0.072, m3[1] - 0.03, m3[0] - 0.03]), { bone: BB.head, mat: mat.gold });
      const rein = [];
      const r0 = [s * 0.072, m3[1] - 0.03, m3[0] - 0.03], r1 = [s * 0.12, seatY + 0.07, seatZ + 0.32];
      for (let i = 0; i <= 6; i++) { const t = i / 6; const p = V3.lerp(r0, r1, t); p[1] -= Math.sin(t * Math.PI) * 0.1; rein.push({ c: p, rx: 0.007, rz: 0.012 }); }
      kitTube(K, rein, 4, { front: [1, 0, 0], attr: (i) => ({ bone: i < 4 ? BB.head : BB.fore, w: 1, mat: mat.leather, ao: 0.85 }) });
    }
    const m2 = S.muzzle[2];
    kitTube(K, [0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => { const a = (i / 8) * TAU; return { c: [Math.sin(a) * (m2[2] + 0.006), m2[1] + Math.cos(a) * (m2[3] + 0.006), m2[0]], rx: 0.009, rz: 0.009 }; }), 4, { front: [0, 0, 1], attr: () => ({ bone: BB.head, w: 1, mat: mat.leather, ao: 0.8 }) });
  }
  return K.build();
}

/* the rig in the vertex shader (depth = true for the shadow pass) */
function beastVS(depth) {
  return /* glsl */`
  ${GLSL_COMMON}
  ${ACTOR_COMMON}
  uniform float uTime;
  uniform vec3 uFT, uFM, uFL, uBT, uBM, uBL, uNeck, uJaw, uTail, uSpine;
  uniform vec4 uBeastK; // x rears up to strike, y hooks with tusks, z lift when lying dead, w unused
  attribute float aBone; attribute float aW; attribute float aMat; attribute vec2 aUV; attribute float aAO;
  attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iColA; attribute vec4 iColB;
  ${depth ? '' : 'varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vFur; varying vec3 vFur2; varying float vFlash; varying vec2 vWx;'}
  vec3 P; vec3 Nn;
  void rotP(mat3 R, vec3 pv){ P = pv + R * (P - pv); Nn = R * Nn; }
  void main(){
    ${depth ? '' : 'vMat = aMat; vFur = iColA.rgb; vFur2 = iColB.rgb; vFlash = fract(iColB.w); vWx = vec2(mod(floor(iColB.w + 1e-3), 16.0), floor((iColB.w + 1e-3) / 16.0)) / 15.0; vUV = aUV; vAO = aAO; vO = position;'}
    P = position; Nn = normal;
    int b = int(aBone + 0.5);
    float w = aW;
    float ph = iAnim.x, amt = clamp(iAnim.y, 0.0, 1.6), death = clamp(iAnim.w, 0.0, 1.0);
    float atype = floor(iAnim.z + 1e-4), at = clamp(fract(iAnim.z), 0.0, 1.0);
    float t = uTime + iPos.x * 0.31 + iPos.z * 0.17;
    float k = clamp(amt * 2.2, 0.0, 1.0), idle = 1.0 - k;
    float trot = smoothstep(0.55, 0.95, amt), gal = smoothstep(1.05, 1.4, amt);
    // when each leg swings: walk (lateral sequence), trot (diagonal pairs), gallop (rotary)
    vec4 off = mix(mix(vec4(1.5708, 4.7124, 0.0, 3.1416), vec4(0.0, 3.1416, 3.1416, 0.0), trot), vec4(3.5, 4.1, 0.0, 0.6), gal);
    float amp = (mix(0.3, 0.4, trot) + 0.32 * gal) * k;
    float fold = (mix(0.55, 0.8, trot) + 0.4 * gal) * k;
    float spine = 0.1 * sin(ph + 0.9) * gal;
    float bob = (abs(sin(ph)) * (0.01 + 0.016 * trot) * (1.0 - gal) + (0.5 + 0.5 * sin(ph + 2.6)) * 0.07 * gal) * k;
    float pitch = 0.05 * sin(ph + 1.4) * gal;
    float headX = (0.035 * sin(ph * 2.0) * (1.0 - gal) + 0.09 * sin(ph + 0.4) * gal) * k + (0.05 * sin(t * 0.37) + 0.1 * smoothstep(0.6, 1.0, sin(t * 0.11))) * idle;
    float headY = 0.4 * sin(t * 0.21) * sin(t * 0.13 + 1.0) * idle;
    float jaw = 0.04 * idle * smoothstep(0.3, 1.0, sin(t * 0.6));
    float tailX = -0.12 * k - 0.22 * gal + 0.05 * sin(t * 1.1);
    float tailY = (0.1 + 0.22 * idle) * sin(t * (1.5 + 3.0 * k));
    float frontReach = 0.0, hindPush = 0.0, lungeZ = 0.0, rear = 0.0, tuck = 0.0;
    if (atype > 0.5 && atype < 1.5) {
      float lunge = sin(at * 3.1416);
      if (uBeastK.x > 0.5) {
        // rear up on the hind legs and come down with the forepaws
        rear = smoothstep(0.0, 0.45, at) * (1.0 - smoothstep(0.55, 0.95, at));
        frontReach = 0.7 * rear + 0.5 * smoothstep(0.5, 0.7, at) * (1.0 - smoothstep(0.75, 1.0, at)); headX -= 0.25 * rear; jaw = max(jaw, 0.55 * rear);
        hindPush = -0.62 * rear;
      } else if (uBeastK.y > 0.5) {
        // dip the head, then hook upward with the tusks
        float dip = smoothstep(0.0, 0.35, at) * (1.0 - smoothstep(0.35, 0.55, at));
        float toss = smoothstep(0.35, 0.55, at) * (1.0 - smoothstep(0.7, 1.0, at));
        headX += 0.35 * dip - 0.5 * toss; lungeZ = 0.2 * lunge; frontReach = 0.18 * lunge; hindPush = -0.28 * lunge;
      } else {
        float bite = smoothstep(0.3, 0.5, at) * (1.0 - smoothstep(0.6, 0.85, at));
        headX += 0.1 * lunge - 0.22 * bite; lungeZ = 0.22 * lunge; jaw = max(jaw, 0.7 * bite);
        frontReach = 0.38 * lunge; hindPush = -0.32 * lunge; spine -= 0.08 * lunge;
      }
    } else if (atype > 5.5 && atype < 6.5) {
      // a leap: forelegs folded up, hind legs stretched back, nose up
      tuck = 1.0; pitch -= 0.12; headX -= 0.15; tailX -= 0.3;
    } else if (atype > 6.5 && atype < 7.5) {
      // grazing: the head goes down to the grass, the jaw works
      float g = smoothstep(0.0, 0.12, at) * (1.0 - smoothstep(0.88, 1.0, at));
      headX += 1.95 * g; headY *= 1.0 - g; pitch += 0.06 * g;
      jaw = max(jaw, 0.07 * g * max(0.0, sin(t * 9.0)));
      tailY *= 1.0 - 0.6 * g;
    } else if (atype > 4.5 && atype < 5.5) {
      // alert: head high, still
      float g = sin(at * 3.1416);
      headX -= 0.3 * g; headY *= 1.0 - g; tailX -= 0.3 * g;
    } else if (atype > 3.5 && atype < 4.5) {
      float kk = sin(at * 3.1416); pitch -= 0.08 * kk; headX -= 0.28 * kk; jaw = max(jaw, 0.3 * kk); lungeZ = -0.07 * kk;
    }
    float d1 = smoothstep(0.0, 0.5, death), d2 = smoothstep(0.15, 1.0, death);
    if (death > 0.0) { headX = mix(headX, 0.3, d1); headY *= 1.0 - d1; jaw = mix(jaw, 0.25, d1); tailX = mix(tailX, 0.35, d1); tailY *= 1.0 - d1; spine *= 1.0 - d1; bob *= 1.0 - d1; }
    // child joints first, then their parents
    if (b == 16) { rotP(rotX(jaw * w), uJaw); b = 2; w = 1.0; }
    if (b == 2) { rotP(rotY(headY * w) * rotX(headX * w), uNeck); b = 1; w = 1.0; }
    if (b == 15) { rotP(rotY(tailY * w) * rotX(tailX * w), uTail); b = 0; w = 1.0; }
    if (b >= 3 && b <= 14) {
      int leg = (b - 3) / 3;
      int rel = b - 3 - leg * 3;
      bool fr = leg < 2;
      float o = leg == 0 ? off.x : (leg == 1 ? off.y : (leg == 2 ? off.z : off.w));
      float c = ph + o;
      float sw = sin(c) * amp + (fr ? frontReach : hindPush);
      float lift = max(0.0, cos(c)) * fold;
      float midA = fr ? -0.25 * lift : 0.55 * lift;
      float lowA = fr ? 1.05 * lift : -0.95 * lift;
      if (fr) lowA += 0.35 * rear + 1.6 * tuck;
      if (fr) { midA -= 0.25 * tuck; sw += 0.5 * tuck; } else { lowA -= 0.3 * tuck; sw -= 0.55 * tuck; }
      if (death > 0.0) { sw = mix(sw, fr ? 0.35 : -0.3, d1); midA *= 1.0 - d1; lowA = mix(lowA, fr ? 0.25 : -0.15, d1); }
      vec3 T = fr ? uFT : uBT, M = fr ? uFM : uBM, L = fr ? uFL : uBL;
      if (rel == 2) rotP(rotX(lowA * w), L);
      if (rel >= 1) rotP(rotX(midA * (rel == 1 ? w : 1.0)), M);
      rotP(rotX(-sw * (rel == 0 ? w : 1.0)), T);
      b = fr ? 1 : 0; w = 1.0;
    }
    rotP(rotX((b == 1 ? spine : -spine) * w), uSpine);
    if (rear > 0.0) rotP(rotX(-0.62 * rear), uBT);
    rotP(rotX(pitch), vec3(0.0, uFT.y, uSpine.z));
    P.y += bob; P.z += lungeZ;
    ${depth ? '' : 'vNo = Nn;'}
    if (death > 0.0) { rotP(rotZ(1.45 * d2), vec3(0.0)); P.y += uBeastK.z * d2; }
    P *= iColA.w;
    float c = cos(iPos.w), s = sin(iPos.w);
    vec3 wp = iPos.xyz + vec3(P.x * c + P.z * s, P.y, -P.x * s + P.z * c);
    ${depth ? '' : 'vW = wp; vN = vec3(Nn.x * c + Nn.z * s, Nn.y, -Nn.x * s + Nn.z * c);'}
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
}
const beastMat = mat({
  uniforms: {
    uFT: { value: new THREE.Vector3() }, uFM: { value: new THREE.Vector3() }, uFL: { value: new THREE.Vector3() },
    uBT: { value: new THREE.Vector3() }, uBM: { value: new THREE.Vector3() }, uBL: { value: new THREE.Vector3() },
    uNeck: { value: new THREE.Vector3() }, uJaw: { value: new THREE.Vector3() }, uTail: { value: new THREE.Vector3() }, uSpine: { value: new THREE.Vector3() },
    uBeastK: { value: new THREE.Vector4() }, uFurK: { value: new THREE.Vector4() }, uDarkCoat: { value: 0 }, uEye: { value: new THREE.Vector3() }, uEyeAt: { value: new THREE.Vector3() }, uLegH: { value: 0.5 }, uTailZ: { value: -0.5 },
  },
  vertexShader: beastVS(false),
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_ACTOR_LIGHT}
    uniform vec4 uFurK;   // saddle, belly, socks, strand scale
    uniform float uDarkCoat;
    uniform vec3 uEye, uEyeAt;
    uniform vec4 uBeastK;
    uniform float uLegH, uTailZ;
    uniform float uWet, uSnowCover; // feature/weather
    ${GLSL_WEATHER}
    varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vFur; varying vec3 vFur2; varying float vFlash;
    varying vec2 vWx; // visual pass: this beast's own wetness and snow (05h_wear.js), packed with the hit flash
    void main(){
      float bWet = clamp(vWx.x, 0.0, 1.0), bSnow = clamp(vWx.y, 0.0, 1.0);
      vec3 n = safeNormalize(vN);
      vec3 no = safeNormalize(vNo);
      vec3 V = safeNormalize(cameraPosition - vW);
      int m = int(vMat + 0.5);
      vec3 alb; float rough = 0.82, metal = 0.0, sss = 0.32;
      float ao = vAO;
      if (m == 11 || m == 12) {
        vec3 light = min(vFur * 1.55 + 0.07, vec3(0.95));
        vec3 dark = uDarkCoat > 0.5 ? vFur * 0.22 + 0.01 : vFur2 * mix(1.0, 0.62, uFurK.x);
        // countershading: a darker saddle, a pale belly and throat, darker lower legs, a dark tail tip
        float legs = 1.0 - smoothstep(uLegH * 0.95, uLegH * 1.25, vO.y);
        float saddle = smoothstep(0.15, 0.85, no.y) * (1.0 - legs) * uFurK.x;
        float belly = (smoothstep(-0.1, -0.75, no.y) * (1.0 - legs) + legs * 0.55 * smoothstep(uLegH, uLegH * 0.35, vO.y) * (1.0 - uFurK.z)) * uFurK.y;
        float sock = smoothstep(uLegH * 0.75, 0.0, vO.y) * uFurK.z;
        float tip = smoothstep(uTailZ + 0.16, uTailZ, vO.z) * 0.85;
        alb = vFur;
        alb = mix(alb, dark, clamp(saddle + sock + tip, 0.0, 1.0));
        alb = mix(alb, light, clamp(belly, 0.0, 1.0) * (1.0 - tip));
        if (m == 12) alb = mix(alb, dark * 0.8, 0.75);
        // strands along the lie of the fur, and clumps
        vec2 g = vec2(vUV.x * 150.0, vUV.y * 9.0) * uFurK.w;
        float strands = fineMix(vnoise(g) * 0.6 + vnoise(g * vec2(2.3, 1.7) + 3.1) * 0.4, 0.5, g);
        float clump = vnoise(vO.xz * 9.0 + vO.y * 6.0);
        alb *= 0.72 + 0.56 * strands;
        alb *= 0.93 + 0.14 * clump;
        vec3 q = vO * 46.0 * uFurK.w;
        vec3 jit = vec3(vnoise(q.yz), vnoise(q.zx + 7.0), vnoise(q.xy + 13.0)) - 0.5;
        n = safeNormalize(n + jit * fineMix(0.5, 0.0, q.xy));
        ao *= 0.86 + 0.14 * strands;
      } else if (m == 13) { alb = vec3(0.86, 0.82, 0.7); rough = 0.3; sss = 0.1; }
      else if (m == 14) {
        // a glossy eye: iris ring, dark pupil, dark rim
        vec3 d = safeNormalize(vO - vec3(sign(vO.x) * uEyeAt.x, uEyeAt.y, uEyeAt.z));
        float f = dot(d, safeNormalize(vec3(sign(vO.x) * 0.42, 0.05, 0.9)));
        alb = mix(vec3(0.02), uEye, smoothstep(0.35, 0.55, f));
        alb = mix(alb, vec3(0.012), smoothstep(0.86, 0.9, f));
        rough = 0.03; sss = 0.0; ao = 1.0;
      }
      else if (m == 25) { alb = (uBeastK.y > 0.5 ? vec3(0.2, 0.13, 0.12) : vec3(0.05, 0.045, 0.045)) * mix(0.25, 1.0, vAO); rough = 0.28; sss = 0.0; ao = 1.0; }
      else if (m == 27) { alb = vec3(0.1, 0.085, 0.07); rough = 0.4; sss = 0.0; }
      else if (m == 28) { alb = vec3(0.3, 0.07, 0.08); rough = 0.3; sss = 0.4; }
      else if (m == 7) { alb = (uDarkCoat > 0.5 ? vFur * mix(0.26, 0.9, step(0.55, dot(vFur, vec3(0.33)))) : vFur2) * (0.75 + 0.5 * fineMix(vnoise(vec2(vUV.x * 40.0, vO.y * 60.0)), 0.5, vec2(vUV.x * 40.0, vO.y * 60.0))); rough = 0.55; sss = 0.1; }
      else if (m == 10) {
        // the saddle cloth: woven, with the rider's colours
        alb = vFur2 * (0.86 + 0.14 * fineMix(0.5 + 0.5 * sin(vO.x * 700.0) * sin(vO.z * 700.0), 0.5, vO.xz * 110.0));
        rough = 0.9; sss = 0.2;
      }
      else if (m == 3) { alb = vec3(0.24, 0.14, 0.08) * (0.85 + 0.25 * vnoise(vO.xz * 40.0)); rough = 0.45; sss = 0.05; }
      else if (m == 15) { alb = vec3(0.85, 0.66, 0.3); rough = 0.25; metal = 0.9; sss = 0.0; }
      else if (m == 6) { alb = vec3(0.62, 0.63, 0.66); rough = 0.3; metal = 0.85; sss = 0.0; }
      else alb = vFur;
      /* ---- weather (feature/weather): a soaked coat darkens and shines, snow settles along the back and the head ---- */
      if (bWet > 0.01) {
        // a soaked coat clumps into dark wet locks
        float por = (m == 6 || m == 15) ? 0.1 : 1.0;
        float lock = (m == 11 || m == 12) ? 0.8 + 0.4 * vnoise(vO.xz * 24.0 + vO.y * 17.0) : 1.0;
        alb *= 1.0 - bWet * 0.36 * por * lock; rough = mix(rough, min(rough, 0.38), bWet * 0.8);
      }
      if (bSnow > 0.01) {
        float sk = smoothstep(0.4, 0.85, n.y + (vnoise(vO.xz * 30.0 + vO.y * 11.0) - 0.5) * 0.4) * smoothstep(0.05, 0.6, bSnow);
        alb = mix(alb, vec3(0.88, 0.9, 0.95), sk); rough = mix(rough, 0.85, sk); metal *= 1.0 - sk;
      }
      float sh = shadowAt(vW, n);
      vec3 col = actorLight(alb, n, V, rough, metal, ao, sh, sss);
      col += alb * pointLights(vW, n) * (0.4 + 0.6 * ao);
      col += wetSheen(vW, n, V, bWet * 0.75, 0.75, sh) * ao; // feature/weather: a rain-slick coat (its own, visual pass)
      // soft back-lit fringe along the silhouette
      float rim = pow(1.0 - max(dot(n, V), 0.0), 2.5);
      col += (uLightColor * 0.22 * sh * max(0.0, dot(-V, uLightDir) * 0.5 + 0.5) + uAmbient * 0.1) * rim * (m == 11 || m == 12 ? 1.0 : 0.0) * alb * 2.0;
      col = mix(col, vec3(1.0, 0.95, 0.85) * 1.4, clamp(vFlash, 0.0, 1.0) * 0.55);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
function beastUniforms(kind) {
  const S = BEASTS[kind];
  const v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  const j = S.jaw[0];
  const legH = S.front.mid[1];
  return {
    uFT: { value: v(S.front.top) }, uFM: { value: v(S.front.mid) }, uFL: { value: v(S.front.low) },
    uBT: { value: v(S.back.top) }, uBM: { value: v(S.back.mid) }, uBL: { value: v(S.back.low) },
    uNeck: { value: v([0, S.neck[0][1], S.neck[0][0]]) }, uJaw: { value: v([0, j[1] + j[3] * 0.8, j[0] - 0.03]) },
    uTail: { value: v([0, S.tail.pts[0][1], S.tail.pts[0][0]]) }, uSpine: { value: v([0, (S.body[4][1] + S.body[4][2]) / 2, S.spineZ]) },
    uBeastK: { value: new THREE.Vector4(S.rears ? 1 : 0, S.tusks ? 1 : 0, S.deadLift, 0) },
    uFurK: { value: new THREE.Vector4(S.fur.saddle, S.fur.belly, S.fur.sock, S.fur.strand) }, uDarkCoat: { value: S.darkCoat ? 1 : 0 },
    uEye: { value: v(S.eye) }, uEyeAt: { value: v(S.eyes.at) }, uLegH: { value: legH }, uTailZ: { value: S.tail.pts[S.tail.pts.length - 1][0] },
  };
}
// how far the animal travels per half gait cycle (walk, gallop), used for the phase rate
function beastStride(kind, amt) {
  const S = BEASTS[kind];
  return S ? lerp(S.stride[0], S.stride[1], sstepJ(0.7, 1.4, amt)) : 1.5;
}
