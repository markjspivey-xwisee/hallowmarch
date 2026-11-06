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
    paw: 'paw', eye: [0.82, 0.55, 0.12], stride: [0.5, 1.35], deadLift: 0.135, /* [anim2] lying dead on its side its flank 7.5 cm in the ground at 0.06 (anim2.py dead) */ fangs: true,
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
    paw: 'hoof', tusks: true, crest: true, eye: [0.12, 0.07, 0.04], stride: [0.36, 1.0], deadLift: 0.1,
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
    paw: 'bear', eye: [0.08, 0.05, 0.03], stride: [0.68, 1.7], rears: true, deadLift: 0.33, /* [anim2] 14 cm of its side in the ground at 0.2 */ fangs: true,
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
    paw: 'hoof', eye: [0.06, 0.04, 0.03], stride: [0.72, 2.0], deadLift: 0.08, grazes: true,
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
  paw: 'horse', eye: [0.05, 0.035, 0.025], stride: [0.85, 2.5], /* [motion5] (2.7: a gallop of 2.2 strides a second at 11 m/s, as a horse's) */ deadLift: 0.3, mane: true, hairTail: true, tack: true, darkCoat: true,
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
      // [motion4] the foot set so its sole stands on the ground (y 0) as built, wherever the rig's foot point is: a wolf's
      // or a hound's pads stood 1.3 to 1.6 cm over it, a deer's hooves 0.9, a boar's 0.7 and the cattle's 1.7 cm in it
      const rf = r[4], sole = S.paw === 'paw' ? 0.55 * rf : S.paw === 'bear' ? 0.5 * rf : S.paw === 'horse' ? 0.01 + 0.9 * rf : 0.004 + 0.95 * rf;
      const fb = b0 + 2, F0 = [pts[3][0], sole, pts[3][2]];
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

// [polish] The gait and the body over its legs, shared by the beast shader and (for the horse under a rider) the
// humanoid shader, so the saddle rides exactly as the horse's back moves. K holds GLSL expressions for the rig's joints
// (FT FM FL front top, middle and low joint; BT BM BL the hind ones; SP the spine's pivot: vec3s) and the gait (G: walk
// and gallop strides, front and hind leg length). The legs reach their low joints by IK with the hoof or paw kept level
// (beastVS); before that the body comes down as far as its planted legs need to reach their places on the ground (the
// vault: the forequarters over the front legs, the hindquarters over the hind ones), and every turn of the body (the
// back's flex, the pitch, the bob, the vault, the lean) is undone along the leg, so a planted foot stays put however the
// body moves above it (they rode up and down and slid with them: 8 cm a stride at a gallop, 23 cm at a bear's trot).
// [motion3] a foot rises its first BB_LIFT metres (once the beast is moving) still standing where it stood, in the last
// BB_CLEAR of the stance, and comes down its last ones onto its landing place in the first BB_CLEAR of the next (bbFoot)
const BB_CLEAR = 0.15, BB_LIFT = 0.055;
function beastBodyGLSL(K) {
  return /* glsl */`
  vec2 bbRot(vec2 p, vec2 c, float a){ vec2 d = p - c; float cs = cos(a), sn = sin(a); return c + vec2(d.x * cs + d.y * sn, d.y * cs - d.x * sn); } // (z, y) as rotX(a) turns them
  // the gait at this amount and scale: when each leg swings, the share of the cycle a foot is down, how far it reaches
  // ahead of its rest place (beastStride's stride), how far a swing folds the leg
  void bbGait(float amtRaw, float bsc, out vec4 off, out float duty, out float reachB, out float fold, out float trot, out float gal, out float hb){
    float amt = clamp(amtRaw, 0.0, 1.6), k = clamp(amt * 2.2, 0.0, 1.0);
    trot = smoothstep(0.55, 0.95, amt); gal = smoothstep(1.05, 1.4, amt);
    float amtS = clamp(amtRaw, 0.0, 2.2), vSpd = amtS * 4.3, fC = sqrt(1.06 / max(${K.G}.z * bsc, 0.05));
    float strideM = clamp(mix(${K.G}.x, ${K.G}.y, smoothstep(0.7, 1.4, amtS)), vSpd / (4.0 * fC * bsc), max(vSpd / (1.6 * fC * bsc), 0.02));
    float reachL = min(${K.G}.z, ${K.G}.w) / strideM;
    duty = mix(mix(0.64, 0.46, trot), 0.3, gal);
    duty = min(duty, mix(mix(0.42, 0.5, trot), 0.58, gal) * reachL); // a long stride: the feet stay down only as long as the legs reach
    // [motion5] at a gallop the legs reach 0.58 of their length either side, at a trot 0.5 (0.46 and 0.42: at 11 m/s each
    // foot was down a sixth of the stride and the leap took half of it, where a horse's takes about a quarter; a trot at
    // 4.5 m/s was off the ground three fifths of the time)
    // [motion3] when each leg comes down. The walk in four even beats, each hind foot followed by the fore on its own side
    // (hind left, fore left, hind right, fore right: it was the diagonal sequence); the trot in diagonal pairs; the gallop
    // the hind feet one after the other (right, left), then the fore (right, left), the fore right down before the hind
    // left lifts (no leap with the legs flung fore and aft, as a rocking horse is carved), then all four gathered under
    // the body in the air until the hind right comes down again. Offsets are where each leg is in its cycle when the
    // hind left comes down, each a turn ahead per cycle it came down earlier (the gallop's spread by its own duty)
    float dG = min(0.3, 0.58 * reachL), gp = 0.14, gq = clamp(0.8 * dG, 0.1, 0.24); // [motion5] (0.26, 0.46; 0.12; 0.22)
    off = mix(mix(vec4(0.0, 3.1416, 1.5708, 4.7124), vec4(0.0, 3.1416, 3.1416, 6.2832), trot), vec4(0.5 - gp - gq, 0.5 - gq, 0.5, 0.5 + gp) * 6.28318, gal);
    reachB = duty * strideM;
    fold = (mix(0.55, 0.8, trot) + 0.4 * gal) * k;
    // [motion5] at a trot and a gallop the hind feet come down further under the body and leave the ground less far behind
    // it (a hind leg reaches back only about 0.4 of its length): their stance moved on by what the reach asks past that
    hb = trot * max(0.0, reachB - 0.4 * ${K.G}.w);
  }
  // a foot at its leg's phase c: how far ahead of its rest place (x), its arch over the swing (y: 0 while it is down) and
  // [motion3] its clearance (z, 0..1): the first few centimetres it rises still standing where it stood, in the last of
  // the stance, and the last few it comes down onto the place where it lands, in the first of the next (BB_CLEAR, a
  // share of the stance at each end), so no foot moves over the ground while it is near it (a foot that left the ground
  // already moving forward, or landed still moving, skated 2 to 5 cm over it at a walk or a trot). In the swing the foot
  // leaves and meets that height still going back under the body at the stance's own pace (the retraction kept to the
  // ends of the swing)
  vec3 bbFoot(float c, float duty, float reachB){
    float u = fract((c - 1.5708) * 0.159155), ad = ${BB_CLEAR.toFixed(3)} * duty;
    // Keep one initialized result across both phases. Multiple early returns
    // produce uninitialized-return diagnostics and slow FXC fallback compilation
    // on some D3D11 drivers even though both branches are complete in GLSL.
    vec3 foot = vec3(0.0);
    if (u < duty) {
      foot = vec3(reachB * (1.0 - 2.0 * u / duty), 0.0, max(1.0 - smoothstep(0.0, ad, u), smoothstep(duty - ad, duty, u)));
    } else {
      float wv = (u - duty) / (1.0 - duty), q = 1.0 - wv;
      float e = wv * wv * (3.0 - 2.0 * wv) - (1.0 - duty) / max(duty, 0.05) * (wv * pow(q, 4.0) - q * pow(wv, 4.0)); // [polish] (q^7: the retraction died away within a frame at a canter, 3 cm of skating at each end)
      foot = vec3(reachB * (2.0 * e - 1.0), pow(sin(3.14159 * wv), 0.5), 1.0);
    }
    return foot;
  }
  // the hoof's or paw's turn in the air (0 while it is down: it stands level)
  float bbTuck(bool fr, vec3 f, float fold){ return (fr ? 0.8 : -0.7) * f.y * fold; }
  // how high the low joint is lifted for a foot at f: the swing's arch, and [motion3] the clearance it rises and comes down
  // through in place (BB_LIFT m once the beast is moving at all)
  float bbLift(bool fr, vec3 f, float fold, float trot){ return f.y * fold * (fr ? ${K.G}.z : ${K.G}.w) * (0.16 + 0.06 * trot) + f.z * ${BB_LIFT.toFixed(3)} * min(1.0, fold * 8.0); }
  // where the low joint goes for a foot at f: the foot's rest place moved on (a swing raised), and the low joint above it
  // as the hoof or paw hangs (level on the ground, tucked in the air)
  vec2 bbTarget(bool fr, vec3 f, float fold, float trot){
    vec2 Fo = (fr ? ${K.FF} : ${K.BF}).zy, Lo = (fr ? ${K.FL} : ${K.BL}).zy;
    return Fo + vec2(f.x, bbLift(fr, f, fold, trot)) - bbRot(Fo - Lo, vec2(0.0), bbTuck(fr, f, fold));
  }
  // the body's own turns before the vault: the back's flex about the spine, then the pitch
  vec2 bbBodyFwd(vec2 p, bool fr, float spine, float pitch){ return bbRot(bbRot(p, ${K.SP}.zy, fr ? spine : -spine), vec2(${K.SP}.z, ${K.FT}.y), pitch); }
  // how far a leg's top must come down for its low joint to reach tgt with the leg a little short of straight (over what
  // standing needs, so a beast at rest stands as it was built)
  float bbNeed(vec3 T, vec3 M, vec3 L, vec2 tgt, bool fr, float spine, float pitch, float bob, float lungeZ){
    float R = (length(M.zy - T.zy) + length(L.zy - M.zy)) * 0.985;
    vec2 d = tgt - vec2(lungeZ, bob) - bbBodyFwd(T.zy, fr, spine, pitch);
    float rest = max(0.0, (T.y - L.y) - sqrt(max(R * R - (L.z - T.z) * (L.z - T.z), 0.0)));
    return max(0.0, -d.y - sqrt(max(R * R - d.x * d.x, 0.0)) - rest);
  }
  // the vault: how far the forequarters (x) and the hindquarters (y) come down, the most either of their legs needs.
  // [polish] A swinging leg asks what its foot would need on the ground below it, not raised: a raised foot asked less,
  // so the body rose as a leg lifted and the straight leg swung its foot forward along the ground (4 to 6 cm at a trot)
  vec2 bbVault(float ph, vec4 off, float duty, float reachB, float fold, float trot, float spine, float pitch, float bob, float lungeZ, vec4 dh, vec4 dz, float hb){ // (dh: the floor under each foot over the body's own; [motion3] dz: how far the foot lock holds each foot along the body from the gait's place, so a foot held back as the body sets off is reached too)
    const vec3 GR = vec3(1.0, 0.0, 0.0);
    float n0 = bbNeed(${K.FT}, ${K.FM}, ${K.FL}, bbTarget(true, bbFoot(ph + off.x, duty, reachB) * GR, fold, trot) + vec2(dz.x, dh.x), true, spine, pitch, bob, lungeZ);
    float n1 = bbNeed(${K.FT}, ${K.FM}, ${K.FL}, bbTarget(true, bbFoot(ph + off.y, duty, reachB) * GR, fold, trot) + vec2(dz.y, dh.y), true, spine, pitch, bob, lungeZ);
    float n2 = bbNeed(${K.BT}, ${K.BM}, ${K.BL}, bbTarget(false, bbFoot(ph + off.z, duty, reachB) * GR + vec3(hb, 0.0, 0.0), fold, trot) + vec2(dz.z, dh.z), false, spine, pitch, bob, lungeZ);
    float n3 = bbNeed(${K.BT}, ${K.BM}, ${K.BL}, bbTarget(false, bbFoot(ph + off.w, duty, reachB) * GR + vec3(hb, 0.0, 0.0), fold, trot) + vec2(dz.w, dh.w), false, spine, pitch, bob, lungeZ);
    return min(vec2(max(n0, n1), max(n2, n3)), vec2(0.3 * min(${K.G}.z, ${K.G}.w)));
  }
  // the vault as a turn about the hindquarters' top (forequarters down x, hindquarters y) and a drop: its angle and pivot
  float bbVaultA(vec2 s){ return atan((s.x - s.y) / (${K.FT}.z - ${K.BT}.z)); }
  vec2 bbVaultPiv(){ return vec2(${K.BT}.z, 0.5 * (${K.FT}.y + ${K.BT}.y)); }
  `;
}
/* the rig in the vertex shader (depth = true for the shadow pass) */
function beastVS(depth) {
  return /* glsl */`
  ${GLSL_COMMON}
  ${ACTOR_COMMON}
  uniform float uTime;
  uniform vec3 uFT, uFM, uFL, uBT, uBM, uBL, uNeck, uJaw, uTail, uSpine;
  uniform vec3 uFF, uBF; // [motion] the front and hind feet at rest, for the legs' IK
  uniform vec4 uBeastK; // x rears up to strike, y hooks with tusks, z lift when lying dead, w unused
  uniform vec4 uGait;   // half-cycle stride walking and galloping (beastStride), front and hind leg length
  attribute float aBone; attribute float aW; attribute float aMat; attribute vec2 aUV; attribute float aAO;
  attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iColA; attribute vec4 iColB;
  ${depth ? '' : 'varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vFur; varying vec3 vFur2; varying float vFlash; varying vec2 vWx;'}
  vec3 P; vec3 Nn;
  void rotP(mat3 R, vec3 pv){ P = pv + R * (P - pv); Nn = R * Nn; }
  ${beastBodyGLSL({ FT: 'uFT', FM: 'uFM', FL: 'uFL', FF: 'uFF', BT: 'uBT', BM: 'uBM', BL: 'uBL', BF: 'uBF', SP: 'uSpine', G: 'uGait' })}
  ${FOOT_LOCK_GLSL}
  // [motion] two-bone IK in the leg's side plane (z forward, y up): from the top joint T through the middle joint M to
  // the foot F, the foot moved fx forward and ly up. Returns the turns about x of the upper bone and of the lower one
  // relative to it (as rotX takes them), bending the middle joint the way it bends at rest
  float bAng(vec2 v){ return atan(v.y + 1e-6, v.x); }
  float bWrap(float a){ return a - 6.28318 * floor((a + 3.14159) / 6.28318); }
  vec2 beastLegIK(vec2 T, vec2 M, vec2 F, float fx, float ly){
    vec2 u0 = M - T, l0 = F - M, f0 = F - T, t = f0 + vec2(fx, ly);
    float a = length(u0), b = length(l0);
    float d = clamp(length(t), abs(a - b) + 1e-3, a + b - 1e-3);
    float side = f0.x * u0.y - f0.y * u0.x >= 0.0 ? 1.0 : -1.0;
    float g = acos(clamp((a * a + d * d - b * b) / (2.0 * a * d), -1.0, 1.0));
    float upNew = bAng(t) + side * g, du = bWrap(upNew - bAng(u0));
    vec2 Mn = a * vec2(cos(upNew), sin(upNew));
    float dl = bWrap(bAng(t - Mn) - bAng(l0));
    return vec2(du, -(dl - du));
  }
  void main(){
    ${depth ? '' : 'vMat = aMat; vFur = iColA.rgb; vFur2 = iColB.rgb; vFlash = fract(iColB.w); vWx = vec2(mod(floor(iColB.w + 1e-3), 16.0), mod(floor((iColB.w + 1e-3) / 16.0), 16.0)) / 15.0; vUV = aUV; vAO = aAO; vO = position;'}
    P = position; Nn = normal;
    int b = int(aBone + 0.5);
    float w = aW;
    float ph = iAnim.x, amt = clamp(iAnim.y, 0.0, 1.6), death = clamp(iAnim.w, 0.0, 1.0);
    float atype = floor(iAnim.z + 1e-4), at = clamp(fract(iAnim.z), 0.0, 1.0);
    float t = uTime + iPos.x * 0.31 + iPos.z * 0.17;
    float k = clamp(amt * 2.2, 0.0, 1.0), idle = 1.0 - k;
    // when each leg swings: walk (lateral sequence), trot (diagonal pairs), gallop (rotary); each foot is planted while it
    // is down (it goes back under the body at the ground's pace) and swings through in the air; [motion] the stride
    // (beastStride): its walk and gallop lengths, the pace held between the slowest and quickest steps a leg of its
    // length takes (no slow-motion legs at a crawl, no frantic ones at a trot); [polish] in bbGait (beastBodyGLSL)
    float bsc = max(mod(iColA.w, 4.0), 0.2), trot, gal, duty, reachB, fold; vec4 off;
    float hb; bbGait(iAnim.y, bsc, off, duty, reachB, fold, trot, gal, hb); // [motion5] (hb: the hind feet's stance moved on at a gallop)
    float spine = 0.1 * sin(ph + 0.9) * gal;
    float bob = (abs(sin(ph)) * (0.01 + 0.016 * trot) * (1.0 - gal) + (0.5 + 0.5 * sin(ph + 2.6)) * 0.07 * gal) * k;
    float pitch = 0.05 * sin(ph + 1.4) * gal;
    float headX = (0.035 * sin(ph * 2.0) * (1.0 - gal) + 0.09 * sin(ph + 0.4) * gal) * k + (0.05 * sin(t * 0.37) + 0.1 * smoothstep(0.6, 1.0, sin(t * 0.11))) * idle;
    float headY = 0.4 * sin(t * 0.21) * sin(t * 0.13 + 1.0) * idle;
    float jaw = 0.04 * idle * smoothstep(0.3, 1.0, sin(t * 0.6));
    float tailX = -0.12 * k - 0.22 * gal + 0.05 * sin(t * 1.1);
    float tailY = (0.1 + 0.22 * idle) * sin(t * (1.5 + 3.0 * k));
    float frontReach = 0.0, hindPush = 0.0, lungeZ = 0.0, rear = 0.0, tuck = 0.0;
    float rearA = 0.0, rear20 = 0.0, paw20 = 0.0, crouch22 = 0.0; // [late4] how far the body rears (rad), the wind-ups' own (actions 20, 22)
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
    } else if (atype > 19.5 && atype < 20.5) {
      // [late4] body action 20, a risen bear's wind-up (10o_late4.js): it rears up onto its hind legs (they stay where they
      // stand, their hocks bending as the hips sink), paws the air with its forelegs in turn and roars, its head brought
      // down to its foe, then crashes down onto its forepaws as the blow lands (the action's end: the wrath at 0.9)
      rear20 = smoothstep(0.0, 0.3, at) * (1.0 - smoothstep(0.76, 0.89, at));
      rearA = 1.08 * rear20; // (rear itself stays 0: the strike's own front-paw tilt is left out, so the paws leave and meet the ground level)
      paw20 = sin(at * 33.0) * rear20 * (1.0 - smoothstep(0.62, 0.76, at));
      frontReach = 1.05 * rear20 * smoothstep(0.1, 0.45, rear20); // (none while the forepaws are still near the ground: they leave it and come down where they stood)
      hindPush = -rearA;
      headX += 0.62 * rear20 + 0.25 * smoothstep(0.86, 0.92, at) * (1.0 - smoothstep(0.93, 1.0, at)); headY *= 1.0 - rear20;
      jaw = max(jaw, 0.7 * rear20 * smoothstep(0.25, 0.45, at));
      tailX += 0.3 * rear20;
      bob -= 0.1 * uGait.w * rear20; // the hips sink as the body rises over them
    } else if (atype > 21.5 && atype < 22.5) {
      // [late4] body action 22, a risen wolf's or boar's wind-up (10o_late4.js): it crouches to spring, forequarters low,
      // haunches bunched, head low and forward, its feet planted where they stand, quivering; it springs as the blow lands
      float cr = smoothstep(0.0, 0.38, at) * (1.0 - smoothstep(0.82, 0.92, at));
      float spr = smoothstep(0.84, 0.9, at) * (1.0 - smoothstep(0.92, 1.0, at));
      crouch22 = cr;
      bob -= (0.24 * uGait.z * cr) * (1.0 - 0.15 * sin(t * 43.0) * smoothstep(0.35, 0.5, at)) - 0.06 * uGait.z * spr;
      pitch += 0.17 * cr - 0.14 * spr;
      headX += 0.34 * cr - 0.3 * spr; headY *= 1.0 - cr; jaw = max(jaw, 0.18 * cr + 0.65 * spr);
      tailX += 0.35 * cr; tailY *= 1.0 - 0.8 * cr;
      lungeZ += 0.3 * spr * uGait.z; spine += 0.06 * cr;
    }
    if (rearA == 0.0) rearA = 0.62 * rear; // [late4] (a bear's own strike rears as it did)
    // [water] swimming (iAnim.w < 0, 07b_swim.js): nose up, back awash, tail trailing, the legs paddling in turn
    float swimK = clamp(-iAnim.w, 0.0, 1.0);
    if (swimK > 0.001) {
      pitch = mix(pitch, -0.12, swimK); headX = mix(headX, -0.32 + 0.04 * sin(t * 1.3), swimK); headY *= 1.0 - 0.7 * swimK;
      tailX = mix(tailX, -0.42, swimK); tailY = mix(tailY, 0.22 * sin(t * 2.2), swimK); spine *= 1.0 - swimK;
      bob = mix(bob, 0.025 * sin(ph * 2.0), swimK); lungeZ *= 1.0 - swimK; jaw = mix(jaw, 0.06, swimK);
    }
    float d1 = smoothstep(0.0, 0.5, death), d2 = smoothstep(0.15, 1.0, death);
    if (death > 0.0) { headX = mix(headX, 0.3, d1); headY *= 1.0 - d1; jaw = mix(jaw, 0.25, d1); tailX = mix(tailX, 0.35, d1); tailY *= 1.0 - d1; spine *= 1.0 - d1; bob *= 1.0 - d1; }
    // [polish] the vault: the body comes down as far as its planted legs need to reach the ground (beastBodyGLSL); not
    // in the water, in the air or dying
    // [motion] the lean into a turn as whole turns on the yaw (beastLeanYaw, 13r_motion.js); [polish] the body's row of
    // planted feet (footLockStep) above its weather in iColB.w
    float kT = floor(iPos.w * 0.159155 + 0.5), slopeS = floor((kT + 5.0) / 11.0 + 1e-3), leanN = kT - 11.0 * slopeS, leanA = leanN * 0.04, flSlot = floor(iColB.w / 256.0 + 1e-3);
    float bSlope = slopeS * 0.05; // [polish] the ground's rise along the body (beastLeanYaw): the beast stands tilted with it
    float vaultK = (1.0 - swimK) * (1.0 - d1) * (1.0 - tuck) * (1.0 - rear20); // [late4] (not reared up on its hind legs)
    vec4 lkA = footLock4(flSlot, 0), lkB = footLock4(flSlot, 1), lkC = footLock4(flSlot, 2), lkD = footLock4(flSlot, 3); // [polish] the floor under each foot; [motion3] and where the lock holds it along the body
    vec4 dh4 = vec4(lkA.z, lkB.z, lkC.z, lkD.z) / bsc, dz4 = vec4(lkA.y, lkB.y, lkC.y, lkD.y) / bsc;
    vec2 sink = vaultK > 0.001 ? bbVault(ph, off, duty, reachB, fold, trot, spine, pitch, bob, lungeZ, dh4, dz4, hb) * vaultK : vec2(0.0);
    float thV = bbVaultA(sink); vec2 vPiv = bbVaultPiv();
    // child joints first, then their parents
    if (b == 16) { rotP(rotX(jaw * w), uJaw); b = 2; w = 1.0; }
    if (b == 2) { rotP(rotY(headY * w) * rotX(headX * w), uNeck); b = 1; w = 1.0; }
    if (b == 15) { rotP(rotY(tailY * w) * rotX(tailX * w), uTail); b = 0; w = 1.0; }
    if (b >= 3 && b <= 14) {
      // This branch only admits the twelve leg bones (3..14). Keep the
      // quotient/remainder in that exact float range rather than asking FXC
      // to lower signed integer division and its sign-correction instructions.
      float boneOffset = float(b) - 3.0, legNumber = floor(boneOffset / 3.0);
      int leg = int(legNumber), rel = int(boneOffset - legNumber * 3.0);
      bool fr = leg < 2;
      float o = leg == 0 ? off.x : (leg == 1 ? off.y : (leg == 2 ? off.z : off.w));
      vec3 fp = bbFoot(ph + o, duty, reachB);
      if (!fr) fp.x += hb; // [motion5]
      float lift = fp.y * fold;
      // [polish] a planted foot stays where it came down however the body moves over it (shoved, sliding by a wall, turning)
      vec4 lk4 = footLock4(flSlot, leg); vec2 lk = lk4.xy / bsc; fp.x += lk.y; float dxM = lk.x;
      // [motion] the leg reaches by IK, so a planted foot stays on the ground all through the stance; in the air the foot
      // rises and the hoof or paw tucks up. [polish] The IK reaches the low joint with the hoof or paw level under it,
      // and its target is where the ground place lies in the leg's own frame: every turn and drop of the body above
      // (the lean, the bob and lunge, the vault, the pitch, the back's flex) undone along the leg
      vec2 tg = bbTarget(fr, fp, fold, trot);
      tg.y += lk4.z / bsc; // [polish] the floor under this foot (a bump, a tread), over what the slope's tilt gives
      float legX = (leg == 0 || leg == 2 ? 1.0 : -1.0) * (fr ? uFF.x : uBF.x);
      tg.y = (tg.y - legX * sin(leanA)) / cos(leanA);
      tg -= vec2(lungeZ, bob);
      tg.y += sink.y; tg = bbRot(tg, vPiv, -thV);
      tg = bbRot(tg, vec2(uSpine.z, uFT.y), -pitch);
      // Select a constant sign before multiplying: FXC can emit an invalid
      // negated source operand for the equivalent signed-value conditional.
      tg = bbRot(tg, uSpine.zy, spine * (fr ? -1.0 : 1.0));
      vec3 Lr = fr ? uFL : uBL, Tr = fr ? uFT : uBT;
      // [polish] a foot to the side of the leg's plane: the leg swings out about its top (the feet do not cross), reaching
      // as far down, and the hoof or paw rolls back level. [motion3] The turn is the one that sets the low joint (the
      // hock, the fetlock) over the foot's place, since all below it hangs straight (worked out from the top, the hind
      // feet went half as far as the lock asked and the fore four fifths: a horse shoved at a trot slid 15 cm); and a
      // foot may step in under the body, short of the middle (8.5 tenths of the way: 6 cm before)
      float abd = atan(clamp(dxM, legX > 0.0 ? -0.85 * legX : -0.45, legX > 0.0 ? 0.45 : -0.85 * legX) / max(Tr.y - tg.y, 0.1));
      tg.y = Tr.y + (tg.y - Tr.y) / cos(abd);
      vec2 ik = beastLegIK(Tr.zy, fr ? uFM.zy : uBM.zy, Lr.zy, tg.x - Lr.z, tg.y - Lr.y);
      float sw = ik.x + (fr ? frontReach : hindPush);
      float midA = ik.y + (fr ? -0.1 : 0.2) * lift;
      // [polish] the hoof or paw stays level (its rest angle) whatever the leg and the body above it do, then tucks in the air
      float lowA = sw - midA - ((fr ? spine : -spine) + pitch + thV) + bbTuck(fr, fp, fold);
      if (fr) lowA += 0.35 * rear + 1.6 * tuck;
      if (fr && rear20 > 0.0) { float pw = leg == 0 ? paw20 : -paw20, up = smoothstep(0.2, 0.6, rear20); midA += (0.5 * rear20 + 0.4 * pw) * up; sw += 0.22 * pw * up; lowA += (0.8 * rear20 - 0.3 * pw) * up; } // [late4] the forepaws raised and pawing the air in turn (action 20), level near the ground
      if (!fr) lowA += rearA; // [late4] a hind paw stays flat on the ground as the body rears over it (it tipped by the rear's angle)
      if (fr) { midA -= 0.25 * tuck; sw += 0.5 * tuck; } else { lowA -= 0.3 * tuck; sw -= 0.55 * tuck; }
      if (death > 0.0) { sw = mix(sw, fr ? 0.35 : -0.3, d1); midA *= 1.0 - d1; lowA = mix(lowA, fr ? 0.25 : -0.15, d1); }
      if (swimK > 0.001) {
        // [water] a paddle: each leg reaches forward folded and sweeps back straight, diagonal pairs together
        float pc = ph + ((leg == 0 || leg == 3) ? 0.0 : 3.1416);
        float pw = sin(pc), rec = max(0.0, cos(pc));
        sw = mix(sw, fr ? 0.2 + 0.62 * pw : -0.15 + 0.5 * pw, swimK);
        midA = mix(midA, fr ? -0.3 * rec : 0.45 * rec, swimK);
        lowA = mix(lowA, fr ? 1.25 * rec : -0.85 * rec, swimK);
      }
      vec3 T = fr ? uFT : uBT, M = fr ? uFM : uBM, L = fr ? uFL : uBL;
      if (rel == 2) rotP(rotX(lowA * w) * rotZ(-abd * w), L);
      if (rel >= 1) rotP(rotX(midA * (rel == 1 ? w : 1.0)), M);
      rotP(rotZ(abd * (rel == 0 ? w : 1.0)) * rotX(-sw * (rel == 0 ? w : 1.0)), T);
      b = fr ? 1 : 0; w = 1.0;
    }
    rotP(rotX((b == 1 ? spine : -spine) * w), uSpine);
    if (rearA > 0.0) rotP(rotX(-rearA), uBT); // [late4] (by rearA: a bear's strike 0.62 rad, its wind-up's rear 1.08)
    rotP(rotX(pitch), vec3(0.0, uFT.y, uSpine.z));
    if (sink.x + sink.y > 0.0) { rotP(rotX(thV), vec3(0.0, vPiv.y, vPiv.x)); P.y -= sink.y; } // [polish] the vault
    P.y += bob; P.z += lungeZ;
    ${depth ? '' : 'vNo = Nn;'}
    if (death > 0.0) { rotP(rotZ(1.45 * d2), vec3(0.0)); P.y += uBeastK.z * d2; }
    if (bSlope != 0.0 && death < 0.5) rotP(rotX(-atan(bSlope)), vec3(0.0)); // [polish] on a slope, its feet on the ground under them
    // [motion] leaning into a turn, about the feet (whole turns on the yaw: beastLeanYaw, 13r_motion.js)
    if (leanN != 0.0) rotP(rotZ(leanA), vec3(0.0));
    P *= iColA.w;
    float yawR = iPos.w - 6.2831853 * kT;
    float c = cos(yawR), s = sin(yawR);
    vec3 wp = iPos.xyz + vec3(P.x * c + P.z * s, P.y, -P.x * s + P.z * c);
    ${depth ? '' : 'vW = wp; vN = vec3(Nn.x * c + Nn.z * s, Nn.y, -Nn.x * s + Nn.z * c);'}
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
}
const beastMat = mat({
  uniforms: {
    uFT: { value: new THREE.Vector3() }, uFM: { value: new THREE.Vector3() }, uFL: { value: new THREE.Vector3() },
    uBT: { value: new THREE.Vector3() }, uBM: { value: new THREE.Vector3() }, uBL: { value: new THREE.Vector3() },
    uFF: { value: new THREE.Vector3() }, uBF: { value: new THREE.Vector3() }, // [motion]
    uNeck: { value: new THREE.Vector3() }, uJaw: { value: new THREE.Vector3() }, uTail: { value: new THREE.Vector3() }, uSpine: { value: new THREE.Vector3() },
    uBeastK: { value: new THREE.Vector4() }, uFurK: { value: new THREE.Vector4() }, uDarkCoat: { value: 0 }, uEye: { value: new THREE.Vector3() }, uEyeAt: { value: new THREE.Vector3() }, uLegH: { value: 0.5 }, uTailZ: { value: -0.5 },
    uGait: { value: new THREE.Vector4(1, 2, 1, 1) },
    uFootLock: { value: FOOT_LOCK.tex }, // [polish]
  },
  vertexShader: beastVS(false),
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_ACTOR_LIGHT}
    ${GLSL_ROOFS} // [look2] underRoof: a beast in a room is lit by the room, as a person is
    ${LOOK3_FUR_GLSL} // [look3] a coat lit from behind by a fire glows along its outline (04d_look3.js)
    uniform vec4 uFurK;   // saddle, belly, socks, strand scale
    uniform float uDarkCoat;
    uniform vec3 uEye, uEyeAt;
    uniform vec4 uBeastK;
    uniform float uLegH, uTailZ;
    uniform float uWet, uSnowCover; // feature/weather
    ${GLSL_WEATHER}
    varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vFur; varying vec3 vFur2; varying float vFlash;
    varying vec2 vWx; // visual pass: this beast's own wetness and snow (05h_wear.js), packed with the hit flash
    ${L3_DEVICE_GLSL /* [late3] a veteran's barding (04_l3device.js, 10n_veteran.js) */}
    void main(){
      float bWet = clamp(vWx.x, 0.0, 1.0), bSnow = clamp(vWx.y, 0.0, 1.0);
      // [late4] a risen champion of the beasts: 4 above its second colour's green (10o_late4.js); fur2 is that colour
      float l4ris = floor(vFur2.g / 4.0 + 1e-3);
      vec3 fur2 = vec3(vFur2.r, vFur2.g - 4.0 * l4ris, vFur2.b);
      vec3 n = safeNormalize(vN);
      vec3 no = safeNormalize(vNo);
      vec3 V = safeNormalize(cameraPosition - vW);
      int m = int(vMat + 0.5);
      vec3 alb; float rough = 0.82, metal = 0.0, sss = 0.32;
      float ao = vAO;
      if (m == 11 || m == 12) {
        vec3 light = min(vFur * 1.55 + 0.07, vec3(0.95));
        vec3 dark = uDarkCoat > 0.5 ? vFur * 0.22 + 0.01 : fur2 * mix(1.0, 0.62, uFurK.x);
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
      else if (m == 7) { alb = (uDarkCoat > 0.5 ? vFur * mix(0.26, 0.9, step(0.55, dot(vFur, vec3(0.33)))) : fur2) * (0.75 + 0.5 * fineMix(vnoise(vec2(vUV.x * 40.0, vO.y * 60.0)), 0.5, vec2(vUV.x * 40.0, vO.y * 60.0))); rough = 0.55; sss = 0.1; }
      else if (m == 10) {
        // the saddle cloth: woven, with the rider's colours
        // [late3] a veteran's barding: the device of the name worn above the cloth's red, 4 x (device + 1) (10n_veteran.js)
        float bdev = floor(fur2.r / 4.0);
        vec3 clo = vec3(fur2.r - bdev * 4.0, fur2.g, fur2.b);
        alb = clo * (0.86 + 0.14 * fineMix(0.5 + 0.5 * sin(vO.x * 700.0) * sin(vO.z * 700.0), 0.5, vO.xz * 110.0));
        if (bdev > 0.5) {
          // on each flank in gold, upright and facing the head, and a gilt band above the fringe
          float th = abs(vUV.x);
          float dm = l3DeviceMask(vec2((vUV.x < 0.0 ? -1.0 : 1.0) * vUV.y / 0.27, (1.42 - th) / 0.6), int(bdev) - 1);
          alb = mix(alb, vec3(0.9, 0.72, 0.3) * 0.88, dm);
          alb = mix(alb, vec3(0.85, 0.66, 0.3), smoothstep(1.6, 1.64, th) * (1.0 - smoothstep(1.72, 1.76, th)) * 0.85);
        }
        rough = 0.9; sss = 0.2;
      }
      else if (m == 3) { alb = vec3(0.24, 0.14, 0.08) * (0.85 + 0.25 * vnoise(vO.xz * 40.0)); rough = 0.45; sss = 0.05; }
      else if (m == 15) { alb = vec3(0.85, 0.66, 0.3); rough = 0.25; metal = 0.9; sss = 0.0; }
      else if (m == 6) { alb = vec3(0.62, 0.63, 0.66); rough = 0.3; metal = 0.85; sss = 0.0; }
      else alb = vFur;
      // [late4] a risen champion's old wounds (10o_late4.js): long scars raked across its flanks, pale and hairless, their
      // edges puckered; and its coat singed dark along the back where the embers run
      float l4scar = 0.0, l4vein = 0.0;
      if (l4ris > 0.5 && (m == 11 || m == 12)) {
        vec2 fl = vec2(vO.z, vO.y) * 1.0;
        float sd = 1.0;
        for (int i = 0; i < 3; i++) {
          float fi = float(i);
          vec2 c = vec2(0.12 - 0.22 * fi, uLegH * (1.35 + 0.22 * fi));
          vec2 dir = normalize(vec2(1.0, 0.55 - 0.35 * fi));
          vec2 d = fl - c; float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
          sd = min(sd, max(abs(across) - 0.006 * (1.0 + sin(along * 60.0) * 0.3), abs(along) - 0.13));
        }
        l4scar = (1.0 - smoothstep(0.0, 0.01, sd)) * step(0.02, abs(vO.x)) * (1.0 - smoothstep(0.55, 0.9, abs(no.y)));
        alb = mix(alb, mix(vec3(0.55, 0.42, 0.38), alb, 0.25), clamp(l4scar, 0.0, 1.0) * 0.85);
        vec3 q = vO * 5.5;
        float vn = abs(vnoise(q.zx + q.y * 0.8) - 0.5) + 0.5 * abs(vnoise(q.zy * 2.3 + 1.7) - 0.5);
        l4vein = fineMix(1.0 - smoothstep(0.018, 0.07, vn), 0.06, q.zx) * (0.25 + 0.75 * smoothstep(-0.3, 0.5, no.y));
        alb *= 1.0 - 0.45 * l4vein;
      }
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
      // [look2] a beast in a room (a hound by the hearth, a hen in a shed) is lit by the room as a person is (05a_rig.js):
      // no sun or moon through the roof, less of the sky, a warm fill; it was lit as out of doors, blue by the moon
      gRoom = underRoof(vW) ? 1.0 : 0.0;
      sh *= 1.0 - gRoom;
      vec3 col = actorLight(alb, n, V, rough, metal, ao * (1.0 - 0.4 * gRoom), sh, sss);
      col += alb * vec3(0.2, 0.12, 0.055) * gRoom * (0.45 + 0.55 * uNight) * ao;
      col += alb * pointLights(vW, n) * (0.4 + 0.6 * ao);
      if (m == 11 || m == 12) col += look3FurGlow(vW, n, V, alb) * (0.5 + 0.5 * ao) + alb * vec3(0.12, 0.075, 0.04) * gRoom * (0.3 + 0.7 * uNight) * (0.6 + 0.4 * ao); // [look3] the fire through the coat's outline, the room's warm light given back
      col += wetSheen(vW, n, V, bWet * 0.75, 0.75, sh) * ao; // feature/weather: a rain-slick coat (its own, visual pass)
      // soft back-lit fringe along the silhouette
      float rim = pow(1.0 - max(dot(n, V), 0.0), 2.5);
      col += (uLightColor * 0.22 * sh * max(0.0, dot(-V, uLightDir) * 0.5 + 0.5) + uAmbient * 0.1) * rim * (m == 11 || m == 12 ? 1.0 : 0.0) * alb * 2.0;
      // [late4] the embers of a risen champion: they burn in the veins of its coat, its eyes and its outline, bright enough to
      // read by day as by night (and bloom), pulsing as a fire's coals do
      if (l4ris > 0.5) {
        vec3 ec = vec3(2.6, 0.82, 0.18);
        float pulse = 0.72 + 0.28 * sin(uTime * 2.1 + vO.z * 5.0) * sin(uTime * 1.3 + vO.y * 3.0);
        if (m == 14) col += ec * 1.9;
        else if (m == 11 || m == 12) {
          float rimE = pow(1.0 - max(dot(n, V), 0.0), 3.0);
          col += ec * (l4vein * (0.9 + 0.8 * pulse) + rimE * 0.45 * pulse + l4scar * 0.12);
        } else if (m == 25 || m == 13) col += ec * 0.25 * pulse; // (its mouth and teeth lit from within)
      }
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
    uFF: { value: v(S.front.foot) }, uBF: { value: v(S.back.foot) }, // [motion] the feet, for the legs' IK
    uNeck: { value: v([0, S.neck[0][1], S.neck[0][0]]) }, uJaw: { value: v([0, j[1] + j[3] * 0.8, j[0] - 0.03]) },
    uTail: { value: v([0, S.tail.pts[0][1], S.tail.pts[0][0]]) }, uSpine: { value: v([0, (S.body[4][1] + S.body[4][2]) / 2, S.spineZ]) },
    uBeastK: { value: new THREE.Vector4(S.rears ? 1 : 0, S.tusks ? 1 : 0, S.deadLift, 0) },
    uFurK: { value: new THREE.Vector4(S.fur.saddle, S.fur.belly, S.fur.sock, S.fur.strand) }, uDarkCoat: { value: S.darkCoat ? 1 : 0 },
    uEye: { value: v(S.eye) }, uEyeAt: { value: v(S.eyes.at) }, uLegH: { value: legH }, uTailZ: { value: S.tail.pts[S.tail.pts.length - 1][0] },
    uGait: { value: new THREE.Vector4(S.stride[0], S.stride[1], S.front.top[1] - S.front.foot[1], S.back.top[1] - S.back.foot[1]) },
  };
}
// how far the animal travels per half gait cycle (walk, gallop), used for the phase rate; in the world, at its scale.
// [motion] The pace (half cycles a second) is held between the slowest and the quickest a leg of its length takes
// (about 1.6 and 4 at a horse's leg, quicker for shorter legs), as the beast shader does
function beastStride(kind, amt, sc = 1) {
  const S = BEASTS[kind];
  if (!S) return 1.5 * sc;
  const base = lerp(S.stride[0], S.stride[1], sstepJ(0.7, 1.4, amt)) * sc;
  const L = Math.max((S.legH ?? (S.front ? S.front.top[1] - S.front.foot[1] : 0.2)) * Math.max(sc, 0.2), 0.05), v = clamp(amt, 0, 2.2) * 4.3, f = Math.sqrt(1.06 / L);
  return clamp(base, v / (4.0 * f), Math.max(v / (1.6 * f), 0.02 * Math.max(sc, 0.2)));
}
// [polish] the horse's back under a rider (humanVS, 05a_rig.js): the horse's own gait, body and vault as its shader moves
// them (beastBodyGLSL with the horse's joints), so the saddle and the rider in it rise, fall and tip together; then the
// humanoid shader is built again with it (nothing has compiled it yet)
HORSE_SEAT_GLSL = (() => {
  const S = BEASTS.horse, f = (x) => x.toFixed(4), v = (p) => `vec3(${p.map(f).join(', ')})`;
  const K = { FT: v(S.front.top), FM: v(S.front.mid), FL: v(S.front.low), FF: v(S.front.foot), BT: v(S.back.top), BM: v(S.back.mid), BL: v(S.back.low), BF: v(S.back.foot), SP: v([0, (S.body[4][1] + S.body[4][2]) / 2, S.spineZ]), G: `vec4(${[S.stride[0], S.stride[1], S.front.top[1] - S.front.foot[1], S.back.top[1] - S.back.foot[1]].map(f).join(', ')})` };
  return beastBodyGLSL(K) + /* glsl */`
  // the saddle under a rider: how far it has moved from its rest place (x along, y up) and its turn (z), as beastVS
  // moves the horse's forequarters at this phase and amount (the gait's flex, pitch and bob, and the vault)
  vec3 horseSeat(float ph, float amtRaw, bool air){
    vec4 off; float duty, reachB, fold, trot, gal;
    float hb; bbGait(amtRaw, 1.0, off, duty, reachB, fold, trot, gal, hb);
    float amt = clamp(amtRaw, 0.0, 1.6), k = clamp(amt * 2.2, 0.0, 1.0);
    float spine = 0.1 * sin(ph + 0.9) * gal, pitch = 0.05 * sin(ph + 1.4) * gal - (air ? 0.12 : 0.0);
    float bob = (abs(sin(ph)) * (0.01 + 0.016 * trot) * (1.0 - gal) + (0.5 + 0.5 * sin(ph + 2.6)) * 0.07 * gal) * k;
    vec2 sink = air ? vec2(0.0) : bbVault(ph, off, duty, reachB, fold, trot, spine, pitch, bob, 0.0, vec4(0.0), vec4(0.0), hb);
    float thV = bbVaultA(sink);
    vec2 s0 = vec2(${f(0.04)}, ${f(HORSE_SEAT - 0.06)}), s = bbRot(bbBodyFwd(s0, true, spine, pitch), bbVaultPiv(), thV);
    s.y += bob - sink.y;
    return vec3(s - s0, spine + pitch + thV);
  }`;
})();
humanoidMat.vertexShader = humanVS(false);
humanoidMat.uniforms.uFootLock = { value: FOOT_LOCK.tex }; // [polish] planted feet (13s_footlock.js)

