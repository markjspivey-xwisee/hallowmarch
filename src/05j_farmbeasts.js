/* ================================================================== */
/* farm beasts: sheep, cattle, pigs, hounds and hens, built in code     */
/* ================================================================== */
// [animals] The sheep, the cattle, the pig and the hound ride the beast rig (05c_beasts.js): the same bones, the same
// planted-foot gait (uGait), the same weather on the coat. Their own parts (fleece curls, horns, the udder, a collar,
// the pig's snout) are a second kit merged onto the rig's geometry, and their shader is the beast shader patched at
// anchors: a fleece, horn and udder material, a face colour, and coat patterns (patched, dappled, belted) chosen per
// animal. The hen has her own small rig: two planted legs, wings that flap, a head that bobs and pecks.
// Per-animal looks travel in iColA.w: scale + 4 * pattern + 16 * seed (FARM_VIS), decoded by the patched shaders.
const FMAT = { wool: 30, horn: 31, udder: 32, face: 33, beak: 29 };
BEASTS.sheep = {
  body: [[-0.52, 0.66, 0.5, 0.07], [-0.46, 0.77, 0.41, 0.19], [-0.33, 0.81, 0.37, 0.25], [-0.15, 0.82, 0.36, 0.27], [0.05, 0.83, 0.36, 0.27], [0.22, 0.84, 0.38, 0.25], [0.34, 0.83, 0.43, 0.21], [0.42, 0.79, 0.5, 0.14], [0.47, 0.73, 0.58, 0.07]],
  spineZ: -0.05,
  neck: [[0.3, 0.7, 0.13, 0.14], [0.4, 0.76, 0.11, 0.12], [0.48, 0.82, 0.085, 0.095], [0.54, 0.86, 0.07, 0.08]],
  skull: [0, 0.885, 0.6], skullR: [0.068, 0.072, 0.09],
  muzzle: [[0.665, 0.86, 0.052, 0.058], [0.72, 0.833, 0.044, 0.048], [0.765, 0.812, 0.035, 0.038]],
  jaw: [[0.655, 0.8, 0.04, 0.02], [0.71, 0.785, 0.03, 0.015], [0.75, 0.778, 0.02, 0.01]],
  cheek: null,
  ears: { at: [0.062, 0.9, 0.575], h: 0.095, w: 0.03, tilt: 1.35, back: 0.3 },
  eyes: { at: [0.056, 0.9, 0.638], r: 0.0105 },
  front: { top: [0.1, 0.56, 0.28], mid: [0.1, 0.31, 0.27], low: [0.1, 0.12, 0.28], foot: [0.1, 0.025, 0.29], r: [0.06, 0.034, 0.025, 0.021, 0.022] },
  back: { top: [0.1, 0.59, -0.33], mid: [0.1, 0.37, -0.27], low: [0.1, 0.15, -0.36], foot: [0.1, 0.025, -0.34], r: [0.07, 0.04, 0.026, 0.021, 0.022] },
  shoulderMass: [0.09, 0.6, 0.27, 0.07, 0.12, 0.09],
  haunch: [0.09, 0.62, -0.33, 0.08, 0.12, 0.1],
  tail: { pts: [[-0.5, 0.67], [-0.55, 0.61], [-0.58, 0.53], [-0.59, 0.47]], r: [0.04, 0.045, 0.04, 0.02] },
  fur: { shag: 0.026, ruff: 0, saddle: 0, belly: 0, sock: 0.9, strand: 0.7 },
  paw: 'hoof', eye: [0.62, 0.48, 0.18], stride: [0.3, 0.85], deadLift: 0.12, grazes: true,
  farm: { wool: 1, face: true },
};
BEASTS.sheepShorn = { ...BEASTS.sheep, body: BEASTS.sheep.body.map(([z, t, b, w]) => [z, t - 0.05, b + 0.03, w * 0.78]), fur: { ...BEASTS.sheep.fur, shag: 0.006 }, farm: { wool: 0.2, face: true } };
BEASTS.cattle = {
  body: [[-0.86, 1.25, 1.0, 0.1], [-0.8, 1.36, 0.82, 0.26], [-0.62, 1.4, 0.72, 0.33], [-0.35, 1.38, 0.66, 0.36], [-0.05, 1.37, 0.62, 0.38], [0.25, 1.4, 0.64, 0.36], [0.48, 1.42, 0.7, 0.31], [0.64, 1.36, 0.8, 0.24], [0.74, 1.24, 0.9, 0.14]],
  spineZ: -0.15,
  neck: [[0.5, 1.12, 0.22, 0.3], [0.68, 1.16, 0.19, 0.27], [0.84, 1.2, 0.15, 0.21], [0.95, 1.23, 0.12, 0.16]],
  skull: [0, 1.27, 1.02], skullR: [0.13, 0.13, 0.14],
  muzzle: [[1.12, 1.19, 0.11, 0.11], [1.22, 1.11, 0.1, 0.095], [1.3, 1.04, 0.095, 0.085], [1.35, 1.0, 0.09, 0.075]],
  jaw: [[1.1, 1.08, 0.09, 0.04], [1.2, 1.015, 0.075, 0.03], [1.29, 0.965, 0.06, 0.02]],
  cheek: [0.1, 1.16, 1.03, 0.05, 0.08, 0.09],
  ears: { at: [0.13, 1.3, 0.98], h: 0.13, w: 0.06, tilt: 1.45, back: 0.1 },
  eyes: { at: [0.118, 1.29, 1.085], r: 0.021 },
  front: { top: [0.2, 0.96, 0.5], mid: [0.2, 0.55, 0.47], low: [0.2, 0.2, 0.5], foot: [0.2, 0.04, 0.52], r: [0.13, 0.075, 0.055, 0.05, 0.056] },
  back: { top: [0.2, 1.0, -0.65], mid: [0.21, 0.68, -0.55], low: [0.21, 0.3, -0.75], foot: [0.21, 0.04, -0.7], r: [0.16, 0.09, 0.058, 0.05, 0.056] },
  shoulderMass: [0.17, 1.05, 0.5, 0.13, 0.28, 0.2],
  haunch: [0.17, 1.1, -0.65, 0.14, 0.3, 0.22],
  tail: { pts: [[-0.86, 1.3], [-0.92, 1.2], [-0.95, 0.97], [-0.96, 0.72], [-0.965, 0.52]], r: [0.05, 0.034, 0.027, 0.024, 0.05] },
  fur: { shag: 0.004, ruff: 0, saddle: 0, belly: 0.25, sock: 0, strand: 1.6 },
  paw: 'hoof', eye: [0.07, 0.045, 0.03], stride: [0.78, 2.1], deadLift: 0.38, grazes: true, hairTail: true,
  farm: { horns: 1, udder: true, face: false },
};
BEASTS.bull = { ...BEASTS.cattle, neck: BEASTS.cattle.neck.map(([z, y, w, h]) => [z, y + 0.02, w * 1.18, h * 1.12]), farm: { horns: 1.35, udder: false, face: false } };
BEASTS.pig = {
  ...BEASTS.boar, tusks: false, crest: false, cheek: null,
  body: BEASTS.boar.body.map(([z, t, b, w], i) => [z * 1.08, t - 0.02, b - 0.02 * Math.sin((i / 8) * Math.PI), w * 1.12]),
  ears: { at: [0.06, 0.6, 0.52], h: 0.1, w: 0.06, tilt: 0.75, back: -0.75 },
  tail: { pts: [[-0.5, 0.56], [-0.54, 0.58], [-0.56, 0.55], [-0.545, 0.52], [-0.55, 0.5]], r: [0.016, 0.014, 0.012, 0.011, 0.008] },
  fur: { shag: 0.0, ruff: 0, saddle: 0.05, belly: 0.25, sock: 0.05, strand: 3.2 },
  eye: [0.25, 0.16, 0.08], farm: { snout: true },
};
BEASTS.hound = { ...BEASTS.wolf, fur: { ...BEASTS.wolf.fur, shag: 0.004, ruff: 0.008, saddle: 0.55, belly: 0.5 }, eye: [0.45, 0.28, 0.1], farm: { collar: true } };
BEASTS.horseWild = { ...BEASTS.horse, tack: false };
BEASTS.horseTack = { ...BEASTS.horse };
BEASTS.hen = { stride: [0.075, 0.17] }; // the hen's own rig below; this is only her stride for the walk phase (beastStride)

// join two rig geometries built by SkinKits (same attributes)
function farmMergeGeo(a, b) {
  const g = new THREE.InstancedBufferGeometry();
  const na = a.attributes.position.count;
  for (const k of Object.keys(a.attributes)) {
    const A = a.attributes[k], B = b.attributes[k], sz = A.itemSize;
    const arr = new Float32Array((A.count + B.count) * sz);
    arr.set(A.array, 0); arr.set(B.array, A.count * sz);
    g.setAttribute(k, new THREE.Float32BufferAttribute(arr, sz));
  }
  const ia = a.index.array, ib = b.index.array, n = na + b.attributes.position.count;
  const idx = n > 65535 ? new Uint32Array(ia.length + ib.length) : new Uint16Array(ia.length + ib.length);
  idx.set(ia, 0);
  for (let i = 0; i < ib.length; i++) idx[ia.length + i] = ib[i] + na;
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  g.instanceCount = 0;
  return g;
}
// the parts the rig does not make for a farm animal
function farmExtras(kind, hi) {
  const S = BEASTS[kind], F = S.farm || {}, K = new SkinKit(), mat = AM;
  const spineZ = S.spineZ;
  const bodyBone = (z) => (z > spineZ ? { bone: BB.fore, w: sstepJ(spineZ, spineZ + 0.32, z) } : { bone: BB.hind, w: sstepJ(spineZ, spineZ - 0.32, z) });
  const rows = crResample(S.body, 24);
  const ringAt = (z) => rows.reduce((a, q) => (Math.abs(q[0] - z) < Math.abs(a[0] - z) ? q : a), rows[0]);
  if (F.wool && hi) {
    // the fleece: locks set over the back, the flanks and the rump, thicker along the top line
    const R = mulberry(kind === 'sheep' ? 31 : 37), n = F.wool > 0.5 ? 190 : 40;
    for (let i = 0; i < n; i++) {
      const z = lerp(S.body[0][0] + 0.06, S.body[S.body.length - 1][0] - 0.04, R());
      const th = (R() - 0.5) * Math.PI * 1.55; // round the barrel from flank to flank over the top
      const q = ringAt(z), cy = (q[1] + q[2]) / 2, ry = (q[1] - q[2]) / 2, rx = q[3];
      const sn = Math.sin(th), cs = Math.cos(th);
      // locks sit half sunk in the fleece, so the coat reads as one crimped mass rather than loose pebbles
      const r = (0.032 + 0.022 * R()) * F.wool * (0.8 + 0.4 * Math.max(0, cs));
      const p = [sn * (rx + r * 0.05), cy + cs * (ry + r * 0.05), z];
      // flattened along the surface: the lock's short axis points out of the body
      const nx = sn, ny = cs, w = r * 1.25, h = r * 0.55;
      kitBlob(K, p, 6, 4, { shape: (d) => { const out = d[0] * nx + d[1] * ny; const ox = d[0] - out * nx, oy = d[1] - out * ny; return [ox * w + out * nx * h, oy * w + out * ny * h, d[2] * w]; }, attr: (d) => ({ ...bodyBone(z), mat: FMAT.wool, ao: 0.66 + 0.34 * Math.max(0, d[1] * cs + d[0] * sn), u: d[0] * 3, v: d[2] * 3 + i }) });
    }
    // a woolly cap on the poll and the top of the neck
    for (let i = 0; i < 9; i++) {
      const t = i / 8, nk = S.neck, a = nk[Math.min(nk.length - 1, Math.floor(t * (nk.length - 1)))];
      kitBlob(K, [(R() - 0.5) * 0.04, a[1] + a[3] * 0.7, a[0] - 0.01], 6, 4, { r: [0.05, 0.035, 0.05], attr: () => ({ bone: BB.head, w: 0.2 + 0.7 * t, mat: FMAT.wool, ao: 0.8 }) });
    }
    kitBlob(K, [0, S.skull[1] + S.skullR[1] * 0.75, S.skull[2] - 0.02], 7, 4, { r: [0.055, 0.035, 0.055], attr: () => ({ bone: BB.head, w: 1, mat: FMAT.wool, ao: 0.85 }) });
  }
  if (F.horns) {
    // horns sweep out, forward and up from the poll, banded keratin darkening to the tip
    const H = F.horns;
    for (const s of [1, -1]) {
      const base = [s * S.skullR[0] * 0.8, S.skull[1] + S.skullR[1] * 0.55, S.skull[2] - S.skullR[2] * 0.25];
      const pts = [];
      for (let i = 0; i <= (hi ? 8 : 4); i++) {
        const t = i / (hi ? 8 : 4);
        pts.push({ c: [base[0] + s * (0.2 * t + 0.06 * t * t) * H, base[1] + (0.02 * t + 0.16 * t * t) * H, base[2] + (0.05 * t + 0.07 * t * t) * H], rx: lerp(0.035, 0.008, t) * Math.sqrt(H), rz: lerp(0.035, 0.008, t) * Math.sqrt(H), t });
      }
      kitTube(K, pts, hi ? 8 : 5, { cap1: 'dome', front: [0, 1, 0], attr: (i) => ({ bone: BB.head, w: 1, mat: FMAT.horn, ao: 0.9, u: 0, v: pts[i].t }) });
    }
  }
  if (F.udder) {
    const z = -0.42, y = 0.66;
    kitBlob(K, [0, y, z], hi ? 12 : 6, hi ? 6 : 3, { r: [0.13, 0.09, 0.16], attr: () => ({ ...bodyBone(z), mat: FMAT.udder, ao: 0.8 }) });
    if (hi) for (const sx of [-1, 1]) for (const sz of [-1, 1]) kitTube(K, [{ c: [sx * 0.05, y - 0.06, z + sz * 0.06], rx: 0.016, rz: 0.016 }, { c: [sx * 0.052, y - 0.13, z + sz * 0.064], rx: 0.011, rz: 0.011 }], 5, { cap1: 'dome', front: [0, 0, 1], attr: () => ({ ...bodyBone(z), mat: FMAT.udder, ao: 0.75 }) });
  }
  if (F.collar) {
    // a leather collar with an iron ring at the throat
    const nk = crResample(S.neck, 9), a = nk[3];
    const pts = [];
    for (let i = 0; i <= 10; i++) { const th = (i / 10) * TAU; pts.push({ c: [Math.sin(th) * (a[2] + 0.012), a[1] + Math.cos(th) * (a[3] + 0.012), a[0] + 0.004 * Math.cos(th)], rx: 0.012, rz: 0.02 }); }
    kitTube(K, pts, 5, { front: [0, 0, 1], attr: () => ({ bone: BB.head, w: 0.35, mat: mat.leather, ao: 0.8 }) });
    kitGeo(K, new THREE.TorusGeometry(0.018, 0.005, 5, 10), M4([0, a[1] - a[3] - 0.026, a[0] + 0.01], [0, 0, 0]), { bone: BB.head, w: 0.35, mat: mat.steel });
  }
  if (F.snout) {
    // the pig's flat snout disc with its two nostrils
    const m0 = S.muzzle[S.muzzle.length - 1];
    kitBlob(K, [0, m0[1] + 0.004, m0[0] + 0.03], hi ? 14 : 6, hi ? 6 : 3, { r: [m0[2] * 1.1, m0[3] * 1.05, 0.016], attr: (d) => ({ bone: BB.head, w: 1, mat: FMAT.udder, ao: d[2] > 0.5 && (Math.hypot(d[0] - 0.35, d[1]) < 0.22 || Math.hypot(d[0] + 0.35, d[1]) < 0.22) ? 0.25 : 0.95 }) });
  }
  if (!K.n) kitBlob(K, [0, S.body[4][1] - 0.05, S.body[4][0]], 3, 2, { r: [0.01, 0.01, 0.01], attr: () => ({ bone: BB.fore, w: 1, mat: mat.fur, ao: 1 }) });
  return K.build();
}
// the face and the lower legs of a sheep take the second colour (the fleece is the first)
function farmRemat(kind, g) {
  const F = BEASTS[kind].farm || {};
  if (!F.face && !F.wool) return g;
  const S = BEASTS[kind], bone = g.attributes.aBone.array, m = g.attributes.aMat.array, w = g.attributes.aW.array, pos = g.attributes.position.array;
  const legH = S.front.mid[1] + 0.1;
  for (let i = 0; i < m.length; i++) {
    if (m[i] !== AM.fur && m[i] !== AM.furDark) continue;
    const b = Math.round(bone[i]), y = pos[i * 3 + 1];
    if (b === BB.head || b === BB.jaw) m[i] = w[i] > 0.55 || b === BB.jaw ? FMAT.face : (F.wool ? FMAT.wool : m[i]);
    else if (b >= 3 && b <= 14) m[i] = y > legH && F.wool ? FMAT.wool : FMAT.face;
    else if (F.wool) m[i] = FMAT.wool;
  }
  return g;
}
function buildFarmBeast(kind, lod) {
  const base = farmRemat(kind, buildBeast(kind, lod));
  return farmMergeGeo(base, farmExtras(kind, lod === 0));
}

/* ---- the patched beast shaders: fleece, horn, udder, face, coat patterns ---- */
function farmPatch(src, anchor, add, before = true) {
  if (!src.includes(anchor)) { FARM_VIS.missing.push(anchor.slice(0, 40)); return src; }
  return src.replace(anchor, before ? add + anchor : anchor + add);
}
const FARM_VIS = { missing: [] };
function farmBeastVS(depth) {
  let s = beastVS(depth);
  if (!s.includes('P *= iColA.w;')) FARM_VIS.missing.push('P *= iColA.w;');
  s = s.replace('P *= iColA.w;', 'P *= mod(iColA.w, 4.0);');
  // lying down to rest (act 9): the legs fold under the body and it settles onto them, head low, tail still
  s = farmPatch(s, 'float frontReach = 0.0, hindPush = 0.0, lungeZ = 0.0, rear = 0.0, tuck = 0.0;', '\n    float rest = (atype > 8.5 && atype < 9.5) ? smoothstep(0.0, 0.18, at) * (1.0 - smoothstep(0.86, 1.0, at)) : 0.0;\n    headX += 0.22 * rest; headY *= 1.0 - 0.6 * rest; tailY *= 1.0 - 0.8 * rest; tailX += 0.15 * rest;', false);
  s = farmPatch(s, 'if (death > 0.0) { sw = mix(sw, fr ? 0.35 : -0.3, d1);', 'if (rest > 0.0) { if (fr) { sw -= 0.25 * rest; midA += 1.35 * rest; lowA += 1.55 * rest; } else { sw += 0.65 * rest; midA += 1.85 * rest; lowA -= 2.15 * rest; } }\n      ', true);
  s = farmPatch(s, 'P.y += bob; P.z += lungeZ;', '\n    P.y -= rest * uGait.z * 0.64;', false);
  if (!depth) {
    if (!s.includes('void main(){')) FARM_VIS.missing.push('void main(){');
    s = s.replace('void main(){', 'varying vec2 vPat;\n  void main(){\n    vPat = vec2(mod(floor(iColA.w / 4.0 + 1e-3), 4.0), floor(iColA.w / 16.0 + 1e-3));');
  }
  return s;
}
// the fur colour after countershading, with this animal's coat pattern laid over it
const FARM_FS_PATTERN = /* glsl */`
      // [animals] coat patterns (patched, dappled, belted) and the fleece, face, horn and udder materials
      // (a fleece only takes the patched pattern: belts and dapples are for short coats)
      if ((m == 11 || m == 33 || m == 30 && vPat.x < 1.5) && vPat.x > 0.5) {
        float lumA = dot(alb, vec3(0.333)) / max(dot(vFur, vec3(0.333)), 0.03);
        vec3 c2 = uDarkCoat > 0.5 ? vec3(0.9, 0.88, 0.84) : vFur2; // a horse's second colour is its pale patches (vFur2 is its saddle cloth)
        vec3 pq = vO * 2.4 + vec3(vPat.y * 1.37, vPat.y * 0.71, vPat.y * 2.13);
        if (vPat.x < 1.5) {
          // big patches of the second colour, edges a little ragged
          float nn = vnoise(pq.xy + pq.z * 1.3) * 0.62 + vnoise(pq.zy * 2.1 + 4.0) * 0.38;
          float k = smoothstep(0.5, 0.545, nn + 0.05 * vnoise(vO.xz * 40.0));
          alb = mix(alb, c2 * lumA, k);
        } else if (vPat.x < 2.5) {
          // dapples: rings of a lighter coat
          float sp = vnoise(vO.xz * 13.0 + vO.y * 9.0 + vPat.y);
          alb = mix(alb, mix(alb, c2 * lumA, 0.75), smoothstep(0.56, 0.64, sp) * (1.0 - smoothstep(0.78, 0.86, sp)) * (1.0 - smoothstep(-0.2, -0.7, no.y)));
        } else {
          // a pale belt round the middle and a blaze down the face
          float belt = 1.0 - smoothstep(0.16, 0.22, abs(vO.z + 0.06 * sin(vO.y * 7.0 + vPat.y)));
          float blaze = step(uTailZ * -0.9, vO.z) * (1.0 - smoothstep(0.02, 0.05, abs(vO.x))) * step(0.5, no.y + 0.6);
          alb = mix(alb, c2 * lumA, clamp(belt * step(uLegH, vO.y) + blaze, 0.0, 1.0));
        }
      }
`;
const FARM_FS_MATS = /* glsl */`else if (m == 30) {
        // fleece: crimped locks, matted and grubby toward the belly, sun-bleached at the tips
        vec3 q = vO * 34.0;
        float curl = fineMix(vnoise(q.xy + q.z * 0.7) * 0.6 + vnoise(q.yz * 2.1 + 5.0) * 0.4, 0.5, q.xy);
        float lock = vnoise(vO.xz * 8.0 + vO.y * 6.0);
        alb = vFur * (0.7 + 0.42 * curl) * (0.88 + 0.22 * lock);
        alb = mix(alb, alb * vec3(0.78, 0.72, 0.6), smoothstep(0.0, -0.8, no.y) * 0.7);
        alb = mix(alb, min(alb * 1.12 + 0.03, vec3(1.0)), smoothstep(0.4, 0.9, no.y) * 0.5);
        n = safeNormalize(n + (vec3(vnoise(q.yz), vnoise(q.zx + 3.0), vnoise(q.xy + 7.0)) - 0.5) * fineMix(0.9 * uWoolLen, 0.0, q.xy));
        ao *= 0.72 + 0.28 * curl;
        rough = 0.96; sss = 0.5;
      } else if (m == 33) {
        // short hair on the face and the legs
        vec2 g2 = vec2(vUV.x * 90.0, vO.y * 70.0);
        alb = vFur2 * (0.82 + 0.28 * fineMix(vnoise(g2), 0.5, g2));
        rough = 0.72; sss = 0.25;
      } else if (m == 31) {
        // horn: creamy at the root, dark at the tip, with growth rings
        float ring = 0.5 + 0.5 * sin(vUV.y * 70.0);
        alb = mix(vec3(0.8, 0.74, 0.6), vec3(0.16, 0.13, 0.1), smoothstep(0.45, 1.0, vUV.y)) * (0.86 + 0.14 * ring);
        rough = 0.32; sss = 0.08;
      } else if (m == 32) {
        // bare pink skin: udder and snout
        alb = vec3(0.86, 0.6, 0.55) * (0.9 + 0.1 * vnoise(vO.xz * 50.0)) * mix(0.5, 1.0, vAO);
        rough = 0.5; sss = 0.6;
      } else if (m == 29) {
        // a hen's beak and legs
        alb = vec3(0.86, 0.64, 0.22) * (0.85 + 0.2 * vnoise(vO.xy * 80.0)); rough = 0.4; sss = 0.15;
      } `;
function farmBeastFS() {
  let s = beastMat.fragmentShader;
  s = farmPatch(s, 'varying vec2 vWx;', 'varying vec2 vPat; uniform float uWoolLen;\n    ', true);
  s = farmPatch(s, 'else if (m == 13) {', FARM_FS_MATS, true);
  s = farmPatch(s, '/* ---- weather (feature/weather)', FARM_FS_PATTERN + '      ', true);
  // [depth] where the face meets the fleece (or the coat) one triangle carries two material ids, and the id between
  // them read as horn, bare skin, eyes or gold: a reddish zigzag round a sheep's neck. A blended id goes to the
  // nearer of the two it lies between; whole ids (horn, udder) are untouched.
  s = farmPatch(s, 'int m = int(vMat + 0.5);', '\n      { float fm = abs(vMat - floor(vMat + 0.5)); if (fm > 0.01 && vMat > 11.0) m = vMat > 31.5 ? 33 : vMat > 29.5 ? 30 : vMat > 22.0 ? 33 : 11; }', false);
  return s;
}
// the hen's rig: bones 0 body, 2 neck and head, 15 tail, 3 and 6 wings, 9 and 12 legs
const HEN = { neck: [0, 0.33, 0.09], wingL: [0.095, 0.33, 0.03], wingR: [-0.095, 0.33, 0.03], hipL: [0.045, 0.2, 0.0], hipR: [-0.045, 0.2, 0.0], tail: [0, 0.32, -0.15] };
function buildHen(lod) {
  const K = new SkinKit(), hi = lod === 0, mat = AM;
  const RS = hi ? 14 : 8;
  // body: a plump teardrop, breast forward, rump high
  const body = [[-0.17, 0.33, 0.03, 0.03], [-0.13, 0.31, 0.085, 0.085], [-0.06, 0.28, 0.112, 0.112], [0.02, 0.265, 0.115, 0.118], [0.08, 0.27, 0.098, 0.105], [0.13, 0.295, 0.066, 0.075], [0.16, 0.32, 0.035, 0.04]];
  kitTube(K, crResample(body, hi ? 12 : 6).map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), RS, {
    front: [0, 1, 0], side: [1, 0, 0], cap0: 'dome', cap1: 'dome',
    shape: hi ? (i, th) => { const a = 0.004 * Math.sin(th * 11 + i * 1.7); return [a * Math.sin(th), a * Math.cos(th)]; } : null,
    attr: (i, th, p) => ({ bone: 0, w: 1, mat: mat.fur, ao: 0.6 + 0.4 * sstepJ(-0.9, 0.3, Math.cos(th)), u: th / TAU, v: p[2] * 3 }),
  });
  // neck and head
  kitTube(K, [{ c: [0, 0.31, 0.1], rx: 0.055, rz: 0.06 }, { c: [0, 0.37, 0.13], rx: 0.042, rz: 0.045 }, { c: [0, 0.42, 0.145], rx: 0.036, rz: 0.038 }], RS, { front: [0, 0, 1], attr: (i) => ({ bone: 2, w: 0.3 + 0.35 * i, mat: mat.fur, ao: 0.85 }) });
  kitBlob(K, [0, 0.455, 0.155], hi ? 12 : 7, hi ? 8 : 5, { r: [0.034, 0.036, 0.042], attr: () => ({ bone: 2, w: 1, mat: mat.fur, ao: 0.95 }) });
  // beak, comb, wattles, eyes
  kitGeo(K, new THREE.ConeGeometry(0.013, 0.04, hi ? 8 : 5), M4([0, 0.45, 0.205], [Math.PI / 2 + 0.25, 0, 0], [1, 1, 0.7]), { bone: 2, mat: FMAT.beak });
  for (let i = 0; i < (hi ? 4 : 2); i++) kitBlob(K, [0, 0.49 + 0.006 * Math.sin(i * 1.3), 0.13 + i * (hi ? 0.016 : 0.03)], 6, 4, { r: [0.006, 0.017, 0.012], attr: () => ({ bone: 2, w: 1, mat: mat.mouth, ao: 1 }) });
  for (const s of [1, -1]) kitBlob(K, [s * 0.008, 0.415, 0.185], 5, 4, { r: [0.006, 0.014, 0.009], attr: () => ({ bone: 2, w: 1, mat: mat.mouth, ao: 0.9 }) });
  if (hi) for (const s of [1, -1]) kitBlob(K, [s * 0.03, 0.462, 0.172], 6, 4, { r: [0.006, 0.007, 0.007], attr: () => ({ bone: 2, w: 1, mat: mat.eye, ao: 1 }) });
  // tail: a fan of feathers cocked up behind
  for (let i = 0; i < (hi ? 5 : 3); i++) {
    const a = (i / ((hi ? 5 : 3) - 1) - 0.5) * 0.7;
    const g = new THREE.SphereGeometry(1, hi ? 8 : 5, hi ? 5 : 3);
    kitGeo(K, g, M4([Math.sin(a) * 0.03, 0.38, -0.17], [-0.9, a, 0], [0.012, 0.08, 0.04]), { bone: 15, w: 1, mat: mat.furDark, ao: 0.85 });
  }
  // wings folded along the sides
  for (const s of [1, -1]) kitBlob(K, [s * 0.098, 0.3, -0.02], hi ? 10 : 6, hi ? 6 : 4, { shape: (d) => [d[0] * 0.022, d[1] * 0.062 - 0.012 * d[2], d[2] * 0.115], attr: (d) => ({ bone: s > 0 ? 3 : 6, w: 1, mat: mat.fur, ao: 0.75 + 0.25 * Math.max(0, d[1]) }) });
  // legs: feathered thighs, scaly shanks, three toes forward and one back
  for (const s of [1, -1]) {
    const b = s > 0 ? 9 : 12, x = s * 0.045;
    kitBlob(K, [x, 0.21, 0.0], 7, 5, { r: [0.03, 0.045, 0.04], attr: () => ({ bone: b, w: 0.6, mat: mat.fur, ao: 0.7 }) });
    kitTube(K, [{ c: [x, 0.18, 0.005], rx: 0.009, rz: 0.009 }, { c: [x, 0.1, 0.01], rx: 0.008, rz: 0.008 }, { c: [x, 0.02, 0.012], rx: 0.0075, rz: 0.0075 }], hi ? 6 : 4, { front: [0, 0, 1], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.8 }) });
    for (const [ta, tl] of [[-0.45, 0.05], [0, 0.055], [0.45, 0.05], [Math.PI, 0.03]]) {
      kitTube(K, [{ c: [x, 0.012, 0.012], rx: 0.005, rz: 0.005 }, { c: [x + Math.sin(ta) * tl, 0.005, 0.012 + Math.cos(ta) * tl], rx: 0.003, rz: 0.003 }], 4, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.75 }) });
    }
  }
  return K.build();
}
function henVS(depth) {
  const v = (p) => `vec3(${p.map((x) => x.toFixed(4)).join(', ')})`;
  return /* glsl */`
  ${GLSL_COMMON}
  ${ACTOR_COMMON}
  uniform float uTime;
  uniform vec4 uGait; // [motion] walk and run strides, leg length
  attribute float aBone; attribute float aW; attribute float aMat; attribute vec2 aUV; attribute float aAO;
  attribute vec4 iPos; attribute vec4 iAnim; attribute vec4 iColA; attribute vec4 iColB;
  ${depth ? '' : 'varying vec3 vW; varying vec3 vN; varying vec3 vNo; varying vec3 vO; varying vec2 vUV; varying float vMat; varying float vAO; varying vec3 vFur; varying vec3 vFur2; varying float vFlash; varying vec2 vWx; varying vec2 vPat;'}
  vec3 P; vec3 Nn;
  void rotP(mat3 R, vec3 pv){ P = pv + R * (P - pv); Nn = R * Nn; }
  void main(){
    ${depth ? '' : 'vMat = aMat; vFur = iColA.rgb; vFur2 = iColB.rgb; vFlash = fract(iColB.w); vWx = vec2(mod(floor(iColB.w + 1e-3), 16.0), floor((iColB.w + 1e-3) / 16.0)) / 15.0; vUV = aUV; vAO = aAO; vO = position; vPat = vec2(mod(floor(iColA.w / 4.0 + 1e-3), 4.0), floor(iColA.w / 16.0 + 1e-3));'}
    P = position; Nn = normal;
    int b = int(aBone + 0.5);
    float w = aW;
    float ph = iAnim.x, amt = clamp(iAnim.y, 0.0, 1.6), death = clamp(iAnim.w, 0.0, 1.0);
    float atype = floor(iAnim.z + 1e-4), at = clamp(fract(iAnim.z), 0.0, 1.0);
    float t = uTime + iPos.x * 0.37 + iPos.z * 0.23;
    float k = clamp(amt * 2.2, 0.0, 1.0), idle = 1.0 - k;
    // walking: the head holds still in space, then jerks forward with each step; the body sways
    float stepF = fract(ph / 3.14159);
    float headZ = (0.03 - 0.06 * smoothstep(0.0, 0.25, stepF)) * k;
    float headX = 0.12 * sin(t * 0.7) * sin(t * 0.31) * idle, headY = 0.5 * sin(t * 0.43) * sin(t * 0.17 + 1.0) * idle;
    float sway = 0.07 * sin(ph) * k, bob = abs(sin(ph)) * 0.012 * k;
    float flap = 0.0, tailX = 0.05 * sin(t * 1.3) * idle - 0.1 * k, pitch = 0.0, peck = 0.0;
    if (atype > 6.5 && atype < 7.5) {
      // pecking at the ground: the body tips forward, the neck reaches down, a few quick stabs, up to look about
      float g = smoothstep(0.0, 0.15, at) * (1.0 - smoothstep(0.85, 1.0, at));
      peck = g; pitch = 0.42 * g;
      headX += (1.15 + 0.25 * smoothstep(0.4, 1.0, sin(t * 13.0))) * g; headY *= 1.0 - g; tailX -= 0.25 * g;
    } else if (atype > 4.5 && atype < 6.5) {
      // startled: wings beat, the head goes up
      flap = sin(t * 34.0) * 0.5 + 0.7; flap *= sin(at * 3.1416); headX -= 0.25 * sin(at * 3.1416);
    } else if (atype > 0.5 && atype < 1.5) { headX += 0.6 * sin(at * 3.1416); }
    flap = max(flap, (sin(t * 30.0) * 0.4 + 0.5) * smoothstep(1.0, 1.4, amt));
    if (death > 0.0) { float d1 = smoothstep(0.0, 0.5, death); headX = mix(headX, 0.9, d1); flap = 0.0; sway = 0.0; bob = 0.0; }
    bool isLeg = b == 9 || b == 12;
    if (b == 2) { P.z += (headZ + 0.03 * peck) * w; P.y -= 0.06 * peck * w; rotP(rotY(headY * w) * rotX(headX * w), ${v(HEN.neck)}); P.y -= 0.1 * peck * w; P.z += 0.04 * peck * w; b = 0; } // [depth] the neck stretches down so the beak meets the ground
    if (b == 15) { rotP(rotX(tailX), ${v(HEN.tail)}); b = 0; }
    if (b == 3) { rotP(rotZ(flap * 1.4), ${v(HEN.wingL)}); b = 0; }
    if (b == 6) { rotP(rotZ(-flap * 1.4), ${v(HEN.wingR)}); b = 0; }
    if (!isLeg) rotP(rotX(pitch), vec3(0.0, 0.2, 0.0));
    if (isLeg) {
      // each foot is planted while it is down and swings forward through the air
      float c = ph + (b == 9 ? 0.0 : 3.1416);
      // [motion] the stride as beastStride gives it (05c_beasts.js: uGait holds the walk and run strides and the leg length),
      // the pace kept between the slowest and quickest a leg this long takes
      float amtS = clamp(iAnim.y, 0.0, 2.2), bsc = max(mod(iColA.w, 4.0), 0.2), vSpd = amtS * 4.3, fC = sqrt(1.06 / max(uGait.z * bsc, 0.05));
      float strideM = clamp(mix(uGait.x, uGait.y, smoothstep(0.7, 1.4, amtS)), vSpd / (4.0 * fC * bsc), max(vSpd / (1.6 * fC * bsc), 0.02));
      float u = fract(c * 0.159155), duty = 0.6, reach = strideM * duty, fx, lift;
      if (u < duty) { fx = reach * (1.0 - 2.0 * u / duty); lift = 0.0; }
      else { float wv = (u - duty) / (1.0 - duty); fx = reach * (2.0 * wv * wv * (3.0 - 2.0 * wv) - 1.0); lift = sin(3.14159 * wv); }
      float sw = asin(clamp(fx / 0.19, -0.95, 0.95)); // [motion] the planted foot keeps pace at any speed
      vec3 hip = b == 9 ? ${v(HEN.hipL)} : ${v(HEN.hipR)};
      // the shank folds as the foot lifts
      if (P.y < 0.13) rotP(rotX(0.9 * lift * smoothstep(0.0, 0.03, amtS)), vec3(hip.x, 0.12, 0.0)); // [motion] the shank folds and the foot leaves the ground
      rotP(rotX(-sw * w), hip);
      if (death > 0.0) rotP(rotX(0.8 * smoothstep(0.0, 0.5, death)), hip);
      b = 0;
    }
    rotP(rotZ(sway), vec3(0.0, 0.0, 0.0));
    P.y += bob;
    ${depth ? '' : 'vNo = Nn;'}
    if (death > 0.0) { rotP(rotZ(1.45 * smoothstep(0.15, 1.0, death)), vec3(0.0)); P.y += 0.06 * smoothstep(0.15, 1.0, death); }
    P *= mod(iColA.w, 4.0);
    float c = cos(iPos.w), s = sin(iPos.w);
    vec3 wp = iPos.xyz + vec3(P.x * c + P.z * s, P.y, -P.x * s + P.z * c);
    ${depth ? '' : 'vW = wp; vN = vec3(Nn.x * c + Nn.z * s, Nn.y, -Nn.x * s + Nn.z * c);'}
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
}
// the crowds: [near, far] like every beast; registered in crowdBeast so drawActors fills them
const FARM_CROWDS = [['sheep', 'sheep', 70], ['sheepShorn', 'sheepShorn', 40], ['cattle', 'cattle', 40], ['bull', 'bull', 10], ['pig', 'pig', 24], ['hound', 'hound', 12], ['horseWild', 'horseWild', 24], ['horseTack', 'horseTack', 8]];
function buildFarmCrowds() {
  const fs = farmBeastFS();
  for (const [name, kind, n] of FARM_CROWDS) {
    const u = beastUniforms(kind);
    u.uWoolLen = { value: (BEASTS[kind].farm && BEASTS[kind].farm.wool) || 0 };
    const m = shareMat(beastMat, u);
    m.vertexShader = farmBeastVS(false);
    m.fragmentShader = fs;
    crowdBeast[name] = [new Crowd(buildFarmBeast(kind, 0), m, Math.ceil(n * 0.4), BEAST_ATTRS), new Crowd(buildFarmBeast(kind, 1), m, n, BEAST_ATTRS)];
    const bd = depthFrom(m, DEPTH_FS, farmBeastVS(true));
    for (const c of crowdBeast[name]) shadowCaster(c.mesh, bd);
  }
  // hens: their own rig, the same coat and weather shading
  const hu = beastUniforms('wolf');
  Object.assign(hu, { uGait: { value: new THREE.Vector4(0.075, 0.17, 0.2, 0.2) } /* [motion] her strides and leg length (henVS) */, uWoolLen: { value: 0 }, uFurK: { value: new THREE.Vector4(0.2, 0.35, 0.0, 2.6) }, uDarkCoat: { value: 0 }, uEye: { value: new THREE.Vector3(0.75, 0.45, 0.1) }, uEyeAt: { value: new THREE.Vector3(0.03, 0.462, 0.172) }, uLegH: { value: 0.16 }, uTailZ: { value: -0.2 }, uBeastK: { value: new THREE.Vector4(0, 0, 0.05, 0) } });
  const hm = shareMat(beastMat, hu);
  hm.vertexShader = henVS(false);
  hm.fragmentShader = fs;
  crowdBeast.hen = [new Crowd(buildHen(0), hm, 40, BEAST_ATTRS), new Crowd(buildHen(1), hm, 90, BEAST_ATTRS)];
  const hd = depthFrom(hm, DEPTH_FS, henVS(true));
  for (const c of crowdBeast.hen) shadowCaster(c.mesh, hd);
  if (FARM_VIS.missing.length) reportError(new Error('[animals] shader anchors missing: ' + FARM_VIS.missing.join(' | ')));
}
