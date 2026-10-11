/* ================================================================== */
/* [motion] the game birds' own bodies and flight: wings that fold and */
/* spread, a pheasant's whirring take-off and long glides, a mallard's */
/* run across the water, legs tucked in the air and reaching to land   */
/* ================================================================== */
// Bones: 0 body, 2 neck and head, 15 tail, 3 and 6 the left and right arm of the wing (shoulder to wrist), 4 and 7 the
// hands (the primaries, about the wrist), 5 and 8 the coverts that lie along the flank when the wing is folded, 9 and
// 12 the legs. The wings are built spread; the shader folds them back into the flank on the ground.
// Flight travels in the instance attributes (drawActors packs e.anim): the action is 17 (BIRD_ACT) with the wings'
// spread as its progress, iAnim.x the wingbeat's phase, iAnim.y 3 + the beat's strength, iAnim.w 2 + pitch + 64 bank
// + 4096 legs + 65536 patter (each quantised: birdPack).
const BIRD_ACT = 17;
const BIRD_DIM = {
  pheasant: { sh: [0.058, 0.335, 0.075], arm: 0.15, prim: [0.12, 0.17], chord: 0.12, legTop: 0.2, hip: [0.04, 0.2, 0.0], centre: [0, 0.29, 0.0], k: 0, stride: [0.11, 0.28] },
  duck: { sh: [0.066, 0.255, 0.06], arm: 0.16, prim: [0.17, 0.22], chord: 0.105, legTop: 0.15, hip: [0.05, 0.15, -0.03], centre: [0, 0.23, 0.0], k: 1, stride: [0.09, 0.2] },
};
// the bird's body, head, tail and legs (as 09u_depth.js drew them), with real wings
function birdBuild(kind, lod) {
  const K = new SkinKit(), hi = lod === 0, mat = AM, RS = hi ? 12 : 7, D = BIRD_DIM[kind];
  const duck = kind === 'duck';
  const body = duck
    ? [[-0.2, 0.25, 0.02, 0.02], [-0.16, 0.24, 0.07, 0.055], [-0.08, 0.22, 0.11, 0.075], [0.02, 0.215, 0.118, 0.08], [0.1, 0.225, 0.1, 0.075], [0.15, 0.24, 0.065, 0.06], [0.18, 0.26, 0.03, 0.035]]
    : [[-0.2, 0.33, 0.025, 0.025], [-0.15, 0.315, 0.07, 0.07], [-0.07, 0.29, 0.095, 0.098], [0.02, 0.28, 0.1, 0.104], [0.09, 0.29, 0.085, 0.09], [0.14, 0.31, 0.055, 0.062], [0.17, 0.335, 0.03, 0.035]];
  kitTube(K, crResample(body, hi ? 12 : 6).map(([z, y, rx, ry]) => ({ c: [0, y, z], rx, rz: ry })), RS, {
    front: [0, 1, 0], side: [1, 0, 0], cap0: 'dome', cap1: 'dome',
    attr: (i, th, p) => ({ bone: 0, w: 1, mat: mat.fur, ao: 0.6 + 0.4 * sstepJ(-0.9, 0.3, Math.cos(th)), u: th / TAU, v: p[2] * 3 }),
  });
  const neck = duck ? [{ c: [0, 0.25, 0.13], rx: 0.045, rz: 0.05 }, { c: [0, 0.31, 0.15], rx: 0.033, rz: 0.035 }, { c: [0, 0.35, 0.16], rx: 0.03, rz: 0.032 }]
    : [{ c: [0, 0.32, 0.12], rx: 0.045, rz: 0.05 }, { c: [0, 0.39, 0.145], rx: 0.032, rz: 0.034 }, { c: [0, 0.45, 0.16], rx: 0.028, rz: 0.03 }];
  kitTube(K, neck, RS, { front: [0, 0, 1], attr: (i) => ({ bone: 2, w: 0.3 + 0.35 * i, mat: mat.furDark, ao: 0.85 }) });
  const hy = duck ? 0.37 : 0.47, hz = duck ? 0.17 : 0.165;
  kitBlob(K, [0, hy, hz], hi ? 12 : 7, hi ? 8 : 5, { r: duck ? [0.033, 0.034, 0.046] : [0.028, 0.03, 0.038], attr: () => ({ bone: 2, w: 1, mat: mat.furDark, ao: 0.95 }) });
  if (duck) {
    kitBlob(K, [0, hy - 0.012, hz + 0.058], 8, 4, { r: [0.019, 0.008, 0.03], attr: () => ({ bone: 2, w: 1, mat: FMAT.beak, ao: 1 }) });
    kitTube(K, [{ c: [0, 0.272, 0.138], rx: 0.044, rz: 0.047 }, { c: [0, 0.282, 0.142], rx: 0.042, rz: 0.045 }], RS, { front: [0, 0, 1], attr: () => ({ bone: 2, w: 0.35, mat: mat.ivory, ao: 1 }) });
  } else {
    kitGeo(K, new THREE.ConeGeometry(0.011, 0.034, hi ? 7 : 5), M4([0, hy - 0.005, hz + 0.044], [Math.PI / 2 + 0.2, 0, 0], [1, 1, 0.75]), { bone: 2, mat: FMAT.beak });
    for (const s of [1, -1]) kitBlob(K, [s * 0.021, hy + 0.003, hz + 0.008], 6, 4, { r: [0.009, 0.016, 0.019], attr: () => ({ bone: 2, w: 1, mat: mat.mouth, ao: 1 }) });
    if (hi) for (const s of [1, -1]) kitBlob(K, [s * 0.012, hy + 0.03, hz - 0.012], 4, 3, { r: [0.006, 0.012, 0.006], attr: () => ({ bone: 2, w: 1, mat: mat.furDark, ao: 0.9 }) });
  }
  if (hi) for (const s of [1, -1]) kitBlob(K, [s * (duck ? 0.03 : 0.026), hy + 0.008, hz + 0.014], 6, 4, { r: [0.0055, 0.006, 0.006], attr: () => ({ bone: 2, w: 1, mat: mat.eye, ao: 1 }) });
  if (duck) {
    kitGeo(K, new THREE.SphereGeometry(1, hi ? 8 : 5, hi ? 5 : 3), M4([0, 0.27, -0.2], [-0.5, 0, 0], [0.03, 0.025, 0.05]), { bone: 15, w: 1, mat: mat.furDark, ao: 0.8 });
  } else {
    for (const [a, L, up] of [[0, 0.46, 0.18], [0.1, 0.36, 0.14], [-0.1, 0.36, 0.14], [0.2, 0.25, 0.1], [-0.2, 0.25, 0.1]]) {
      const pts = [];
      for (let k = 0; k <= 4; k++) { const t = k / 4; pts.push({ c: [Math.sin(a) * L * t, 0.33 + up * t - 0.05 * t * t, -0.16 - Math.cos(a) * L * t], rx: 0.016 * (1 - 0.7 * t) + 0.002, rz: 0.004 }); }
      kitTube(K, pts, hi ? 5 : 3, { front: [0, 1, 0], cap1: 'dome', attr: (i) => ({ bone: 15, w: 1, mat: FMAT.horn, ao: 0.85, u: 0, v: i / 4 }) });
    }
  }
  // the coverts along the flank: the folded wing seen from outside (they draw in as the wing spreads)
  for (const s of [1, -1]) kitBlob(K, [s * (duck ? 0.1 : 0.088), duck ? 0.245 : 0.31, -0.03], hi ? 10 : 6, hi ? 6 : 4, { shape: (d) => [d[0] * 0.02, d[1] * (duck ? 0.045 : 0.055) - 0.01 * d[2], d[2] * (duck ? 0.13 : 0.12)], attr: (d) => ({ bone: s > 0 ? 5 : 8, w: 1, mat: mat.fur, ao: 0.7 + 0.3 * Math.max(0, d[1]) }) });
  // the wings, built spread: the arm (coverts over the secondaries) from the shoulder to the wrist, the hand's primaries
  // fanned from the wrist; every feather a thin vane (u across it, v from its root to its tip)
  const feather = (s, bone, root, len, wid, yaw, m, droop = 0) => {
    const from = K.n;
    kitBlob(K, [len / 2, 0, 0], hi ? 7 : 5, hi ? 3 : 2, { shape: (d) => [d[0] * len / 2, d[1] * 0.0035 + 0.006 * (1 - d[0] * d[0]) * 0.5, d[2] * wid / 2 * (0.55 + 0.45 * Math.sqrt(Math.max(0, 1 - Math.pow((d[0] + 1) / 2, 6))))], attr: (d) => ({ bone, w: 1, mat: m, ao: 0.82 + 0.18 * d[1], u: d[2], v: (d[0] + 1) / 2 }) });
    kitMove(K, from, new THREE.Matrix4().compose(new THREE.Vector3(root[0], root[1], root[2]), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, s > 0 ? yaw : Math.PI - yaw, s * droop, 'YXZ')), new THREE.Vector3(1, 1, 1)));
  };
  for (const s of [1, -1]) {
    const sh = [s * D.sh[0], D.sh[1], D.sh[2]], wr = [s * (D.sh[0] + D.arm), D.sh[1] + 0.004, D.sh[2] - 0.012];
    const arm = s > 0 ? 3 : 6, hand = s > 0 ? 4 : 7;
    // the arm's covert panel
    kitBlob(K, [(sh[0] + wr[0]) / 2, D.sh[1] + 0.004, D.sh[2] - D.chord * 0.32], hi ? 10 : 6, hi ? 4 : 3, { shape: (d) => [d[0] * D.arm * 0.56, d[1] * 0.012 + 0.004, d[2] * D.chord * 0.42], attr: (d) => ({ bone: arm, w: 1, mat: mat.fur, ao: 0.78 + 0.22 * Math.max(0, d[1]), u: d[2], v: (d[0] + 1) / 2 }) });
    // the secondaries along its trailing edge (a mallard's are its speculum)
    const ns = hi ? 6 : 4;
    for (let i = 0; i < ns; i++) {
      const t = (i + 0.5) / ns, x = sh[0] + (wr[0] - sh[0]) * (0.12 + 0.86 * t);
      feather(s, arm, [x, D.sh[1] + 0.001, D.sh[2] - D.chord * 0.42], D.chord * (duck ? 0.85 : 0.95), D.arm / ns * 1.6, -Math.PI / 2 + s * 0.12 * t * s, duck ? 35 : 34);
    }
    // the hand's coverts and its primaries, fanned from straight out to swept back
    kitBlob(K, [wr[0] + s * 0.035, wr[1], wr[2] - 0.02], hi ? 8 : 5, 3, { shape: (d) => [d[0] * 0.045, d[1] * 0.009 + 0.003, d[2] * 0.035], attr: (d) => ({ bone: hand, w: 1, mat: mat.fur, ao: 0.85, u: d[2], v: 0.5 }) });
    const np = hi ? 6 : 4;
    for (let i = 0; i < np; i++) {
      const t = i / (np - 1), len = D.prim[0] + (D.prim[1] - D.prim[0]) * Math.sin(t * Math.PI * (duck ? 0.62 : 0.5));
      feather(s, hand, [wr[0] + s * 0.012 * t, wr[1] - 0.001 * i, wr[2] - 0.006 - 0.022 * (1 - t)], len, duck ? 0.034 : 0.04, -(duck ? 0.62 : 0.85) * (1 - t) + 0.02, 34, -0.02 * t);
    }
  }
  // legs: shank and foot (the duck's webbed); they swing at the hip, tuck in the air
  for (const s of [1, -1]) {
    const b = s > 0 ? 9 : 12, x = s * (duck ? 0.05 : 0.04), top = D.legTop;
    kitTube(K, [{ c: [x, top, 0.0], rx: 0.009, rz: 0.009 }, { c: [x, top * 0.5, 0.008], rx: 0.007, rz: 0.007 }, { c: [x, 0.015, 0.01], rx: 0.006, rz: 0.006 }], hi ? 6 : 4, { front: [0, 0, 1], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.8 }) });
    if (duck) kitBlob(K, [x, 0.008, 0.04], 6, 3, { r: [0.03, 0.005, 0.034], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.75 }) });
    else for (const [ta, tl] of [[-0.4, 0.045], [0, 0.05], [0.4, 0.045], [Math.PI, 0.025]]) kitTube(K, [{ c: [x, 0.01, 0.01], rx: 0.0045, rz: 0.0045 }, { c: [x + Math.sin(ta) * tl, 0.004, 0.01 + Math.cos(ta) * tl], rx: 0.0028, rz: 0.0028 }], 4, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ bone: b, w: 1, mat: FMAT.beak, ao: 0.75 }) });
  }
  return K.build();
}

/* ---- the bird's vertex shader: walking and pecking as the hen, wings that fold, beat and glide ---- */
function birdVS(depth) {
  return /* glsl */`
  ${GLSL_COMMON}
  ${ACTOR_COMMON}
  uniform float uTime;
  uniform vec4 uGait;   // walk and run strides, leg length
  uniform vec3 uShoulder, uWrist, uHip, uBodyC; // the left shoulder and wrist (spread), the left hip, the body's centre
  uniform vec4 uBirdK;  // x 0 pheasant, 1 mallard
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
    float atype = floor(iAnim.z + 1e-4), at = clamp(fract(iAnim.z), 0.0, 1.0);
    bool fly = atype > 16.5 && atype < 17.5 && iAnim.w > 1.5; // (a bird shot down falls with its death value)
    float ph = iAnim.x, amtW = fly ? 0.0 : clamp(iAnim.y, 0.0, 2.2), death = fly ? 0.0 : clamp(iAnim.w, 0.0, 1.0);
    float t = uTime + iPos.x * 0.37 + iPos.z * 0.23;
    float k = clamp(amtW * 2.2, 0.0, 1.0), idle = 1.0 - k;
    // the flight's numbers
    float unfold = 0.0, flapA = 0.0, pitch = 0.0, bank = 0.0, legsX = 0.0, patter = 0.0;
    if (fly) {
      unfold = at; flapA = clamp(iAnim.y - 3.0, 0.0, 1.0);
      float q = max(iAnim.w - 2.0, 0.0);
      pitch = (mod(q, 64.0) / 63.0) * 3.2 - 1.6;
      bank = (mod(floor(q / 64.0), 64.0) / 63.0) * 2.4 - 1.2;
      legsX = mod(floor(q / 4096.0), 16.0) / 15.0;
      patter = floor(q / 65536.0);
    }
    // walking: the head holds still in space, then jerks forward with each step; the body sways
    float stepF = fract(ph / 3.14159);
    float headZ = (0.03 - 0.06 * smoothstep(0.0, 0.25, stepF)) * k;
    float headX = 0.12 * sin(t * 0.7) * sin(t * 0.31) * idle, headY = 0.5 * sin(t * 0.43) * sin(t * 0.17 + 1.0) * idle;
    float sway = 0.06 * sin(ph) * k, bob = abs(sin(ph)) * 0.01 * k;
    float tailX = 0.05 * sin(t * 1.3) * idle - 0.08 * k, peck = 0.0, tip = 0.0;
    // the wings on the ground: folded, a shuffle now and then
    float beat = 0.0, sweep = 0.0, hBeat = 0.0, hSweep = 0.0;
    if (atype > 6.5 && atype < 7.5) {
      float g = smoothstep(0.0, 0.15, at) * (1.0 - smoothstep(0.85, 1.0, at));
      peck = g; tip = 0.42 * g;
      headX += (1.15 + 0.25 * smoothstep(0.4, 1.0, sin(t * 13.0))) * g; headY *= 1.0 - g; tailX -= 0.25 * g;
    } else if (atype > 4.5 && atype < 5.5) {
      // startled: wings half open and beating, the head up
      float g = sin(at * 3.1416);
      unfold = max(unfold, 0.6 * g); flapA = max(flapA, 0.8 * g); headX -= 0.25 * g;
    }
    if (fly) {
      // the beat: down hard and fast, up with the hand flexed back; in a glide the wings are held out a little bowed
      float s1 = sin(ph), c1 = cos(ph);
      beat = flapA * (0.12 + 0.95 * c1) + (1.0 - flapA) * (uBirdK.x < 0.5 ? -0.07 : 0.06) + (1.0 - flapA) * 0.035 * sin(t * 1.9);
      hBeat = flapA * 0.55 * cos(ph - 0.7) + (1.0 - flapA) * (uBirdK.x < 0.5 ? -0.1 : 0.02);
      hSweep = flapA * 0.6 * max(0.0, s1) + (1.0 - flapA) * 0.12;
      sweep = -0.12 * s1 * flapA + (1.0 - flapA) * 0.1 + 0.25 * legsX; // landing: the wings swing forward to brake
      // the head reaches forward and stays level; the tail streams behind, fans to brake when landing
      headX += pitch * 0.85 - 0.18; headY *= 0.2; headZ = 0.03;
      tailX = -0.15 + 0.4 * legsX;
      sway = 0.0; bob = 0.0;
    }
    if (death > 0.0) { float d1 = smoothstep(0.0, 0.5, death); headX = mix(headX, 0.9, d1); sway = 0.0; bob = 0.0; unfold = max(unfold, 0.45 * d1); beat = mix(beat, -0.5, d1); hBeat = mix(hBeat, -0.4, d1); sweep = mix(sweep, 0.3, d1); }
    bool isLeg = b == 9 || b == 12;
    bool arm = b == 3 || b == 6, hand = b == 4 || b == 7, cov = b == 5 || b == 8;
    if (b == 2) { P.z += (headZ + 0.03 * peck) * w; P.y -= 0.06 * peck * w; rotP(rotY(headY * w) * rotX(headX * w), vec3(0.0, uShoulder.y, 0.11)); P.y -= 0.1 * peck * w; P.z += 0.04 * peck * w; b = 0; }
    if (b == 15) { rotP(rotX(tailX), vec3(0.0, uShoulder.y - 0.01, -0.16)); b = 0; }
    if (arm || hand || cov) {
      float sg = (b == 3 || b == 4 || b == 5) ? 1.0 : -1.0;
      vec3 Sh = vec3(sg * uShoulder.x, uShoulder.y, uShoulder.z), Wr = vec3(sg * uWrist.x, uWrist.y, uWrist.z);
      if (cov) {
        // the flank's coverts draw in as the wing comes out
        vec3 cc = vec3(sg * (uShoulder.x + 0.03), uShoulder.y - 0.02, -0.03);
        P = cc + (P - cc) * mix(1.0, 0.5, unfold);
      } else {
        if (hand) rotP(rotY(sg * hSweep) * rotZ(sg * hBeat), Wr);
        // folded, the spread wing lies drawn back into the flank under the coverts
        float fs = mix(0.03, 1.0, smoothstep(0.0, 0.75, unfold));
        P = Sh + (P - Sh) * vec3(fs, mix(0.4, 1.0, fs), fs);
        rotP(rotZ(sg * beat) * rotY(sg * (sweep + (1.0 - unfold) * 1.3)), Sh);
      }
      b = 0;
    }
    if (isLeg) {
      vec3 hip = b == 9 ? uHip : vec3(-uHip.x, uHip.y, uHip.z);
      // each foot is planted while it is down and swings forward through the air; the pace as beastStride gives it
      float amtS = amtW, bsc = max(mod(iColA.w, 4.0), 0.2), vSpd = amtS * 4.3, fC = sqrt(1.06 / max(uGait.z * bsc, 0.05));
      float strideM = clamp(mix(uGait.x, uGait.y, smoothstep(0.7, 1.4, amtS)), vSpd / (4.0 * fC * bsc), max(vSpd / (1.6 * fC * bsc), 0.02));
      float c = (patter > 0.5 ? ph * 1.0 : ph) + (b == 9 ? 0.0 : 3.1416);
      float u = fract(c * 0.159155), duty = 0.6, reach = strideM * duty, fx, lift;
      if (patter > 0.5) reach = 0.07;
      if (u < duty) { fx = reach * (1.0 - 2.0 * u / duty); lift = 0.0; }
      else { float wv = (u - duty) / (1.0 - duty), q = 1.0 - wv; fx = reach * (2.0 * (wv * wv * (3.0 - 2.0 * wv) - (1.0 - duty) / duty * (wv * q * q * q * q - q * wv * wv * wv * wv)) - 1.0); lift = sin(3.14159 * wv); } // [motion3] (the foot leaves and meets the ground still going back under the body at the stance's pace: it moved with the body at both ends of the swing)
      float sw = asin(clamp(fx / uGait.z, -0.95, 0.95));
      float liftK = smoothstep(0.0, 0.03, amtS) + patter;
      if (fly && patter < 0.5) {
        // in the air the legs are drawn up and back under the tail; to land they reach down and forward
        sw = mix(-1.35, 0.42, legsX); lift = mix(1.0, 0.15, legsX); liftK = 1.0;
      }
      if (P.y < uGait.z * 0.62) rotP(rotX(0.9 * lift * min(liftK, 1.0)), vec3(hip.x, uGait.z * 0.6, 0.0));
      rotP(rotX(-sw * w), hip);
      if (death > 0.0) rotP(rotX(0.8 * smoothstep(0.0, 0.5, death)), hip);
      b = 0;
    }
    rotP(rotX(tip), vec3(0.0, uGait.z, 0.0));
    rotP(rotZ(sway), vec3(0.0, 0.0, 0.0));
    P.y += bob;
    if (fly) {
      // the body rides the beat (lifted on the downstroke), pitches and banks about its middle
      P.y += 0.012 * flapA * sin(ph + 1.2);
      rotP(rotZ(bank) * rotX(-pitch), uBodyC);
    }
    ${depth ? '' : 'vNo = Nn;'}
    if (death > 0.0) { rotP(rotZ(1.45 * smoothstep(0.15, 1.0, death)), vec3(0.0)); P.y += 0.06 * smoothstep(0.15, 1.0, death); }
    P *= mod(iColA.w, 4.0);
    float cy = cos(iPos.w), sy = sin(iPos.w);
    vec3 wp = iPos.xyz + vec3(P.x * cy + P.z * sy, P.y, -P.x * sy + P.z * cy);
    ${depth ? '' : 'vW = wp; vN = vec3(Nn.x * cy + Nn.z * sy, Nn.y, -Nn.x * sy + Nn.z * cy);'}
    gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
  }`;
}
// the feathers' colours, patched into the farm beasts' fragment shader: flight feathers (34) with a dark shaft, pale
// edges and, on a pheasant, buff bars; a mallard's speculum (35), violet-blue between white bars
function birdFS(fs) {
  let s = fs;
  if (!s.includes('uniform float uWoolLen;') || !s.includes('else if (m == 13) {')) { reportError(new Error('[motion] bird shader anchors missing')); return s; }
  s = s.replace('uniform float uWoolLen;', 'uniform float uWoolLen; uniform vec4 uBirdK;');
  s = s.replace('else if (m == 13) {', `else if (m == 34 || m == 35) {
        float ac = abs(vUV.x), al = clamp(vUV.y, 0.0, 1.0);
        vec3 fb = uBirdK.x < 0.5 ? mix(vec3(0.4, 0.29, 0.17), vFur * 0.75, 0.25) : mix(vec3(0.37, 0.34, 0.31), vFur * 0.7, 0.2);
        if (uBirdK.x < 0.5) fb = mix(fb, vec3(0.78, 0.66, 0.46), smoothstep(0.55, 0.75, sin(al * 34.0 + ac * 2.0)) * 0.55 * (1.0 - smoothstep(0.85, 1.0, al)));
        fb *= mix(1.0, 0.62, smoothstep(0.7, 1.0, al));
        if (m == 35) { fb = mix(vec3(0.16, 0.2, 0.62), vec3(0.32, 0.18, 0.55), smoothstep(0.2, 0.8, ac)); fb = mix(fb, vec3(0.92), smoothstep(0.8, 0.86, al) + 1.0 - smoothstep(0.08, 0.14, al)); rough = 0.35; }
        fb = mix(fb, fb * 0.5, 1.0 - smoothstep(0.02, 0.07, ac));
        fb = mix(fb, min(fb * 1.35 + 0.05, vec3(1.0)), smoothstep(0.82, 0.98, ac));
        alb = fb; if (m != 35) rough = 0.72; sss = 0.2;
      } else if (m == 13) {`);
  return s;
}
// the uniforms of one bird kind
function birdUniforms(kind) {
  const D = BIRD_DIM[kind], v = (p) => new THREE.Vector3(p[0], p[1], p[2]);
  return {
    uGait: { value: new THREE.Vector4(D.stride[0], D.stride[1], D.legTop, D.legTop) },
    uShoulder: { value: v(D.sh) }, uWrist: { value: v([D.sh[0] + D.arm, D.sh[1] + 0.004, D.sh[2] - 0.012]) },
    uHip: { value: v(D.hip) }, uBodyC: { value: v(D.centre) }, uBirdK: { value: new THREE.Vector4(D.k, 0, 0, 0) },
  };
}

/* ---- flight ---- */
// what the shader needs, packed into e.anim (drawActors sends phase, amt, the action and the death value)
function birdPack(e, F) {
  const q = (x, lo, hi, n) => Math.round(clamp((x - lo) / (hi - lo), 0, 1) * n);
  e.anim.phase = F.wph;
  e.anim.amt = 3 + Math.min(0.999, Math.max(0, F.flap));
  e.anim.act = BIRD_ACT; e.anim.actDur = 1e6; e.anim.actT = Math.min(0.999, Math.max(0, F.unfold)) * 1e6;
  e.anim.death = 2 + q(F.pitch, -1.6, 1.6, 63) + 64 * q(F.bank, -1.2, 1.2, 63) + 4096 * q(F.legs, 0, 1, 15) + (F.patter ? 65536 : 0);
}
function birdLanded(e) {
  e.anim.act = 0; e.anim.actDur = 0; e.anim.actT = 0; e.anim.amt = 0; e.anim.death = 0;
}
// the ground or the water under a bird
function birdFloor(x, z) { const w = waterAt(x, z); return w ? Math.max(w.y, heightAt(x, z)) : heightAt(x, z); }
// one step of a bird in the air. Take-off: a pheasant rockets up on whirring wings, a mallard runs across the water
// pattering and beating before it lifts. Then a straight flight with a little weave: the pheasant sets its wings and
// glides between bursts of beats, the mallard beats steadily. Coming down it glides in, flares nose up with its legs
// reaching and a few braking beats, touches down and folds its wings.
function birdFly(e, B, dt) {
  const F = B.fly, duck = e.kind === 'duck';
  if (F.mode === undefined) {
    F.mode = duck && B.water ? 'patter' : 'up'; F.mt = 0; F.wph = Math.random() * TAU; F.flap = 1; F.unfold = 0; F.pitch = 0; F.bank = 0;
    F.legs = 0.4; F.patter = false; F.hd = Math.atan2(F.ux, F.uz); F.v = 0; F.vy = 0; F.weave = Math.random() * 10; F.glideAt = 1.6 + Math.random();
    F.cruise = duck ? 13 + Math.random() * 2 : 10 + Math.random() * 2;
  }
  F.t += dt; F.mt += dt;
  const g0 = birdFloor(e.x, e.z), y = e.fixedY ?? e.y;
  const freq = duck ? 7.5 : (F.mode === 'up' ? 11 : 9);
  let want = F.cruise, wantFlap = 1, wantPitch = 0, wantLegs = 0, vyWant = 0;
  F.patter = false;
  if (F.mode === 'patter') {
    // a mallard's run: wings beating, feet slapping the water, the body tipped up
    want = 6; wantPitch = 0.42; wantLegs = 1; F.patter = true; vyWant = 0;
    if (Math.random() < dt * 14) { splashAt(e.x - Math.sin(F.hd) * 0.2, e.z - Math.cos(F.hd) * 0.2, 0.22, { up: 0.6 }); rippleDrop(e.x, e.z, 0.3, 0.2); }
    // (only over open water: with the shore ahead it springs straight up, never patters onto the land)
    if (F.mt > 0.65 || !waterAt(e.x + Math.sin(F.hd) * 1.2, e.z + Math.cos(F.hd) * 1.2)) { F.mode = 'up'; F.mt = 0; }
  } else if (F.mode === 'up') {
    // straight up off the ground at first, levelling out as it climbs
    want = F.cruise * Math.min(1, 0.35 + F.mt * 0.9); wantPitch = duck ? 0.35 : 0.85 - 0.5 * Math.min(1, F.mt / 0.8);
    vyWant = duck ? 2.6 : 4.2 * (1 - Math.min(1, F.mt / 1.1)) + 1; wantLegs = Math.max(0, 0.5 - F.mt * 2);
    if (F.mt > (duck ? 1.0 : 1.1)) { F.mode = 'fly'; F.mt = 0; }
  } else if (F.mode === 'fly' || F.mode === 'glide') {
    const top = Math.max(g0, F.y0) + F.top;
    vyWant = clamp((top - y) * 0.9, -2.2, 2.2);
    if (!duck) {
      // a pheasant: bursts of beats, then a long glide on set wings, sinking gently
      if (F.mode === 'fly' && F.mt > F.glideAt) { F.mode = 'glide'; F.mt = 0; F.glideFor = 2 + Math.random() * 2.5; }
      else if (F.mode === 'glide' && F.mt > F.glideFor) { F.mode = 'fly'; F.mt = 0; F.glideAt = 0.7 + Math.random() * 0.8; }
      if (F.mode === 'glide') { wantFlap = 0; vyWant = Math.min(vyWant, -0.6); want = F.cruise * 0.92; }
    }
    wantPitch = clamp(vyWant * 0.08, -0.25, 0.25);
    if (F.gone > F.far) { F.mode = 'down'; F.mt = 0; }
  } else if (F.mode === 'down') {
    // glide in toward the ground, then flare
    const h = y - g0;
    const flare = h < 1.6;
    wantFlap = flare ? 0.85 : 0.08; want = flare ? 1.6 : F.cruise * 0.75;
    vyWant = flare ? -Math.max(0.9, h * 0.9) : -2.6;
    wantPitch = flare ? 0.55 : -0.12; wantLegs = h < 2.6 ? 1 : 0.2;
  }
  // steering: a gentle weave on the way out, back home when lost, round at the edge of the world
  const weave = (F.mode === 'fly' || F.mode === 'glide') ? Math.sin(F.t * 0.7 + F.weave) * 0.22 : 0;
  const wantHd = Math.atan2(F.ux, F.uz) + weave;
  const turn = clamp(angDiff(F.hd, wantHd), -1.4 * dt, 1.4 * dt);
  F.hd += turn;
  F.v += clamp(want - F.v, -9 * dt, (F.mode === 'up' || F.mode === 'patter' ? 9 : 4) * dt);
  F.vy += clamp(vyWant - F.vy, -6 * dt, 8 * dt);
  const sx = Math.sin(F.hd), sz = Math.cos(F.hd);
  e.x += sx * F.v * dt; e.z += sz * F.v * dt; e.yaw = F.hd;
  F.gone += F.v * dt;
  let ny = y + F.vy * dt;
  if (F.mode !== 'patter' && F.mode !== 'down') ny = Math.max(ny, birdFloor(e.x, e.z) + (F.mode === 'up' ? 0.05 + F.mt * 0.5 : 1.2));
  if (F.mode === 'patter') ny = waterAt(e.x, e.z) ? waterAt(e.x, e.z).y - 0.1 : g0;
  e.fixedY = ny; e.y = ny;
  // the wings: their beat, how hard, how far spread; the body's pitch and its bank into the turn
  F.flap += (wantFlap - F.flap) * (1 - Math.exp(-dt * 7));
  F.wph = (F.wph + dt * TAU * freq * (0.6 + 0.4 * Math.max(F.flap, 0.2))) % (TAU * 64);
  F.unfold = Math.min(1, F.unfold + dt * 7);
  F.pitch += (wantPitch - F.pitch) * (1 - Math.exp(-dt * 6));
  F.bank += (clamp(-turn / Math.max(dt, 1e-4) * F.v * 0.09, -0.9, 0.9) - F.bank) * (1 - Math.exp(-dt * 4));
  F.legs += (wantLegs - F.legs) * (1 - Math.exp(-dt * 5));
  // landing: over water a mallard comes down on it, a pheasant only on dry walkable ground
  if (F.mode === 'down') {
    const w = waterAt(e.x, e.z), ok = B.water ? w && w.depth > 0.5 : isWalkable(e.x, e.z) && !w;
    if (!ok) {
      if (F.gone > F.far + 160) { const h = B.home; F.ux = h.x - e.x; F.uz = h.z - e.z; const d = Math.hypot(F.ux, F.uz) || 1; F.ux /= d; F.uz /= d; F.far = F.gone + d; F.mode = 'fly'; }
      else if (y - g0 < 2.5) { F.mode = 'fly'; F.mt = 0; F.far = F.gone + 15; F.vy = Math.max(F.vy, 1.5); }
    } else if (y - (w ? w.y : g0) < 0.06 || ny <= (w ? w.y - 0.1 : g0)) {
      // down: the wings fold, a mallard skis to a stop on the water
      B.fly = null; B.mode = 'idle'; B.until = GAME.t + 2;
      e.fixedY = w ? w.y - 0.13 : g0; e.y = e.fixedY;
      if (w) { splashAt(e.x, e.z, 0.45); rippleDrop(e.x, e.z, 0.4, 0.3); } else FX.dust(e.x, g0, e.z, 3);
      if (dist(e.x, e.z, B.home.x, B.home.z) > 60) B.home = { ...B.home, x: e.x, z: e.z };
      B.settle = { left: 0.35, dur: 0.35, wph: F.wph, pitch: F.pitch }; birdPack(e, { ...F, flap: 0, unfold: 1, legs: 1, patter: false });
      return;
    }
  }
  if (Math.abs(e.x) > HALF - 30 || Math.abs(e.z) > HALF - 30) { F.ux = -F.ux; F.uz = -F.uz; }
  birdPack(e, F);
}
// after landing the wings fold back into the flank over a moment, the legs take the weight
function birdSettle(e, B, dt) {
  const S = B.settle;
  S.left -= dt;
  if (S.left <= 0) { B.settle = null; birdLanded(e); return; }
  const k = S.left / S.dur;
  birdPack(e, { wph: S.wph, flap: 0, unfold: k, pitch: S.pitch * k, bank: 0, legs: 1, patter: false });
}
if (window.__hm) window.__hm.birds = { BIRD_DIM, birdBuild, birdVS, birdFS, birdFly, birdPack, birdUniforms };
