/* ================================================================== */
/* nature: a living landscape. Trees are chopped, knocked down and     */
/* burnt, fall about their base and leave stumps and logs; grass is    */
/* cut and catches fire; meteors and heavy landings crater the ground. */
/* Grass and ground state is the NAT map (02b_nature_map.js).          */
/* ================================================================== */
const NATURE = {
  built: false, speed: 1,           // speed: a multiplier on regrowth (tests turn it up)
  dyn: [],                          // trees drawn by the nature sets: chopped, shaken, burning, falling, fallen, burnt
  felled: [],                       // trees with a stump (and maybe a log) waiting to regrow
  piles: [],                        // firewood piles
  fire: new Map(), fireList: [],    // burning grass cells: index -> cell
  tiles: new Map(), tileKeys: [], tileAt: 0, // 32 x 32 texel tiles that are regrowing
  craters: [],
  job: null,                        // the player's axe work
  clock: { fire: 0, regrow: 0, harm: 0, houses: 0, soften: 0, lights: 0 },
  lights: [],                       // fires (in FIRES) that light the nearest flames
  emit: { flame: 0, smoke: 0, ember: 0 },
  sets: {},
};
const TREE_DIM = {
  // trunk radius at the cut, the cut height, the trunk below the crown, the crown radius and the top (all before scale)
  oak: { r: 0.4, cut: 0.42, trunk: 3.1, crownY: 4.5, crown: 2.4, top: 6.9, hp: 130 },
  birch: { r: 0.19, cut: 0.36, trunk: 4.0, crownY: 5.0, crown: 1.4, top: 7.3, hp: 80 },
  pine: { r: 0.26, cut: 0.4, trunk: 6.3, crownY: 3.8, crown: 2.0, top: 7.7, hp: 105 },
};
const NAT_REGROW = { cut: 180, burnt: 420, earth: 900, felled: 300, grow: 360, snag: 600 };
const NAT_CAP = { full: 40, bark: 180, stumps: 600, piles: 40 };
const _natC = [];
const _natQ = new THREE.Quaternion(), _natAx = new THREE.Vector3();

/* ---- small helpers ---- */
const natIdx = (i, j) => j * NAT.res + i;
const natCell = (x) => Math.floor(x + 512);
function natGet(x, z, ch) {
  const i = natCell(x), j = natCell(z);
  if (i < 0 || j < 0 || i >= NAT.res || j >= NAT.res) return 0;
  return NAT.data[natIdx(i, j) * 4 + ch] / 255;
}
function natTouchRect(i0, j0, i1, j1) {
  for (let tj = Math.max(0, j0) >> 5; tj <= Math.min(NAT.res - 1, j1) >> 5; tj++) for (let ti = Math.max(0, i0) >> 5; ti <= Math.min(NAT.res - 1, i1) >> 5; ti++) natTouch(ti << 5, tj << 5);
}
function natTouch(i, j) {
  const k = (j >> 5) * 32 + (i >> 5);
  if (!NATURE.tiles.has(k)) { NATURE.tiles.set(k, GAME.t); NATURE.tileKeys.push(k); }
}
// fuel for a grass fire at a texel: thick grass and wheat burn, roads, rock and water do not
function natFuel(i, j) {
  if (i < 1 || j < 1 || i >= NAT.res - 1 || j >= NAT.res - 1) return 0;
  const gi = Math.min(HN - 1, i >> 1), gj = Math.min(HN - 1, j >> 1), k = gj * HN + gi;
  if (W.road[k] > 0.22 || W.rock[k] > 0.55 || W.H[k] < WATER_Y + 0.15) return 0;
  const g = W.grass[k] + W.field[k] * 0.6;
  if (g < 0.12) return 0;
  const o = natIdx(i, j) * 4;
  if (NAT.data[o + 1] > 90 || NAT.data[o + 2] > 0) return 0; // burnt already, or burning
  return Math.min(1, g) * (1 - 0.6 * NAT.data[o] / 255);
}
function natDry() {
  const wet = Math.max(U.uWet.value || 0, WEATHER.raining || 0, WEATHER.wet || 0);
  return clamp(1 - 0.92 * wet - 0.9 * (U.uSnowCover.value || 0), 0, 1);
}
function natSfx(name, x, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const d = Math.hypot(x - camera.position.x, z - camera.position.z);
  const v = clamp(1.15 - d / 60, 0, 1);
  if (v <= 0.02) return;
  const t = AUDIO.ctx.currentTime + 0.005;
  try {
    if (name === 'chop') { tone('triangle', 230, 120, t, 0.09, 0.22 * v); noiseBurst(t, 0.07, 0.2 * v, 'bandpass', 1500, 700, 2.2); }
    else if (name === 'creak') { tone('sawtooth', 70, 46, t, 0.9, 0.05 * v, 0.2); tone('square', 52, 38, t + 0.25, 0.8, 0.03 * v, 0.2); }
    else if (name === 'crash') { tone('sine', 80, 30, t, 0.6, 0.45 * v); noiseBurst(t, 0.8, 0.32 * v, 'lowpass', 1800, 260, 0.8, 0.01); noiseBurst(t + 0.05, 0.6, 0.18 * v, 'bandpass', 3200, 1400, 1.2); }
    else if (name === 'crackle') { for (let k = 0; k < 3; k++) noiseBurst(t + k * 0.05 + Math.random() * 0.04, 0.03, 0.08 * v, 'highpass', 2600, 2000, 1); }
    else if (name === 'split') { tone('triangle', 320, 160, t, 0.07, 0.2 * v); noiseBurst(t, 0.12, 0.16 * v, 'bandpass', 2200, 900, 1.6); }
  } catch (e) { /* audio is optional */ }
}

/* ------------------------------------------------------------------ */
/* Rendering: trees of the nature sets, stumps, cut ends, firewood     */
/* ------------------------------------------------------------------ */
const NAT_TREE_VS = /* glsl */`
  ${GLSL_COMMON}
  uniform float uTime, uWind;
  attribute float aPart; attribute float aAO; attribute vec2 aUV; attribute float aSeed;
  attribute vec4 iPos; attribute vec2 iRot; attribute vec4 iFall; attribute vec4 iSt; attribute vec4 iFx;
  varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying vec2 vUV; varying float vSeed; varying vec4 vSt; varying vec4 vFx;
  vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  void main(){
    float c = cos(iRot.x), s = sin(iRot.x), sc = iPos.w;
    vec3 p = position * sc;
    float up = step(0.9995, iFall.w);
    float sway = (sin(uTime * 0.9 + iPos.x * 0.21 + iPos.z * 0.13) * 0.06 + sin(uTime * 2.1 + iPos.x) * 0.015) * uWind * smoothstep(1.5, 6.0, position.y) * up * (0.4 + 0.6 * iSt.z);
    p.x += sway * p.y * 0.35; p.z += sway * p.y * 0.18;
    if (aPart > 0.5 && aPart < 2.5) {
      float f = sin(uTime * (3.0 + aSeed * 2.0) + aSeed * 40.0 + position.y) * 0.035 * uWind;
      p += vec3(f, f * 0.6, -f * 0.8) * sc;
    }
    // a blow, an axe or a landing shakes the crown
    float sh = iFx.x * smoothstep(0.8, 3.5, position.y);
    p.x += sin(uTime * 21.0 + position.y * 1.7 + aSeed * 6.0) * sh * 0.16 * sc;
    p.z += cos(uTime * 17.0 + position.y * 1.3 + aSeed * 4.0) * sh * 0.12 * sc;
    vec3 r = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
    vec3 n = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
    if (iSt.x > 0.0) {
      // felled: everything above the cut turns about the hinge at the cut
      float cut = iSt.x * sc;
      if (r.y < cut) { r.xz = safeNormalize2(r.xz) * min(length(r.xz), iFx.w * sc); r.y = cut; }
      vec3 piv = vec3(0.0, cut, 0.0);
      r = piv + qrot(iFall, r - piv);
      n = qrot(iFall, n);
    }
    vW = iPos.xyz + r; vN = n; vPart = aPart; vAO = aAO; vTint = iRot.y; vLocal = position; vUV = aUV; vSeed = aSeed; vSt = iSt; vFx = iFx;
    gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
  }`;
const natTreeMat = mat({
  alphaToCoverage: true, side: THREE.DoubleSide,
  uniforms: { uKindTint: { value: new THREE.Vector3(1, 1, 1) }, uBarkTint: { value: new THREE.Vector3(1, 1, 1) }, uBirch: { value: 0 }, uNeedle: { value: 0 } },
  vertexShader: NAT_TREE_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_FOLIAGE}
    ${GLSL_CLEARVIEW}
    ${GLSL_PLIGHT}
    uniform vec3 uLeaf, uBark, uKindTint, uBarkTint;
    uniform float uBirch, uFoliageCut, uNeedle, uSnowCover;
    varying vec3 vW; varying vec3 vN; varying float vPart; varying float vAO; varying float vTint; varying vec3 vLocal; varying vec2 vUV; varying float vSeed; varying vec4 vSt; varying vec4 vFx;
    void main(){
      if (bayer4(gl_FragCoord.xy + vec2(1.0, 2.0)) < viewBlock(vW)) discard;
      // leaves that have dropped are gone; the dark heart of the crown thins with them
      if (vPart > 0.5 && vPart < 2.5 && hash12(vec2(vSeed * 97.0, vSeed * 31.0 + 1.7)) > vSt.z) discard;
      if (vPart > 2.5 && bayer4(gl_FragCoord.xy) > vSt.z * 1.15 - 0.1) discard;
      vec3 n = safeNormalize(vN);
      vec3 V = safeNormalize(cameraPosition - vW);
      if (!gl_FrontFacing) n = -n;
      float sh = shadowAt(vW, n);
      float charK = vSt.y, fire = vSt.w;
      vec3 col, glow = vec3(0.0); float alpha = 1.0;
      if (vPart < 0.5) {
        float ang = atan(vLocal.z, vLocal.x + 1e-4);
        float fis = vnoise(vec2(ang * 5.0, vLocal.y * 1.4)) * 0.6 + vnoise(vec2(ang * 13.0, vLocal.y * 4.0)) * 0.4;
        vec3 alb = uBark * uBarkTint * (0.7 + 0.45 * fis);
        if (uBirch > 0.5) {
          alb = vec3(0.82, 0.8, 0.74) * (0.85 + 0.2 * fis);
          float mark = step(0.72, vnoise(vec2(ang * 3.0, vLocal.y * 9.0))) * step(0.3, fract(vLocal.y * 2.3 + ang));
          alb = mix(alb, vec3(0.08, 0.07, 0.07), mark);
        }
        alb *= mix(0.55, 1.0, smoothstep(0.3, 0.6, fis));
        // the axe's notch: fresh pale wood on the side the blows come from, growing deeper with each one
        if (vFx.y > 0.001) {
          float side = dot(safeNormalize2(vLocal.xz), vec2(sin(vFx.z), cos(vFx.z)));
          float hh = 0.04 + 0.13 * vFx.y;
          float band = 1.0 - smoothstep(hh * 0.75, hh, abs(vLocal.y - vFx.w));
          float notch = band * smoothstep(0.62 - 0.9 * vFx.y, 0.72 - 0.9 * vFx.y, side);
          vec3 wood = vec3(0.8, 0.66, 0.44) * (0.82 + 0.18 * sin(length(vLocal.xz) * 80.0));
          wood *= mix(0.62, 1.0, smoothstep(0.0, hh, abs(vLocal.y - vFx.w) + 0.5 * hh));
          alb = mix(alb, wood, notch);
        }
        // fire chars the bark black; embers glow in the fissures while it burns
        alb = mix(alb, vec3(0.034, 0.03, 0.027) * (0.7 + 0.7 * fis), charK);
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = alb * (0.4 + 0.75 * ndl * mix(0.3, 1.0, sh)) * vAO;
        glow = vec3(2.6, 0.82, 0.15) * fire * smoothstep(0.6, 0.3, fis) * (0.55 + 0.45 * sin(uTime * 6.0 + vLocal.y * 4.0 + ang * 3.0));
      } else if (vPart > 2.5) {
        float pat = uNeedle > 0.5 ? vnoise(vec2(atan(vLocal.z, vLocal.x + 1e-4) * 9.0, vLocal.y * 2.2)) * 0.7 + vnoise(vec2(atan(vLocal.z, vLocal.x + 1e-4) * 31.0, vLocal.y * 6.0)) * 0.3 : vnoise(vW.xz * 3.0 + vW.y * 2.0);
        vec3 alb = uLeaf * uKindTint * (0.8 + 0.3 * vTint) * (0.62 + 0.62 * pat);
        alb = mix(alb, mix(vec3(0.3, 0.17, 0.05), vec3(0.04, 0.03, 0.02), smoothstep(0.35, 0.9, charK)), smoothstep(0.0, 0.45, charK));
        float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
        col = alb * (0.3 + 0.35 * vAO + 0.35 * ndl * vAO * mix(0.3, 1.0, sh));
        glow = vec3(2.2, 0.75, 0.15) * fire * 0.5 * pat;
      } else {
        float a = vPart < 1.5 ? leafCluster(vUV, vSeed) : needleSpray(vUV);
        vec3 fn = safeNormalize(cross(dFdx(vW), dFdy(vW)));
        a *= smoothstep(0.08, 0.3, abs(dot(fn, V)));
        alpha = a;
        if (a < uFoliageCut * 0.5) discard;
        float vary = hash12(floor(vUV * 3.6 + vSeed * 17.0) + 3.0);
        vec3 alb = uLeaf * uKindTint * (0.72 + 0.5 * vTint) * (0.78 + 0.4 * vary);
        if (vPart > 1.5) alb *= 0.85;
        // scorched leaves go brown, then black, then fall
        alb = mix(alb, mix(vec3(0.45, 0.25, 0.07), vec3(0.05, 0.035, 0.025), smoothstep(0.35, 0.9, charK)) * (0.8 + 0.4 * vary), smoothstep(0.0, 0.4, charK + vary * 0.15));
        float ndl = clamp(dot(n, uLightDir) * 0.55 + 0.45, 0.0, 1.0);
        float back = spow(clamp(dot(-V, uLightDir), 0.0, 1.0), 3.0);
        col = alb * (0.26 + 0.42 * vAO + 0.6 * ndl * vAO * mix(0.22, 1.0, sh));
        col += alb * vec3(1.15, 1.25, 0.6) * back * 0.55 * vAO * sh * (1.0 - charK);
        vec3 H = safeNormalize(uLightDir + V);
        col += uLightColor * spow(dot(n, H), 24.0) * 0.08 * sh;
        float lick = step(0.5, hash12(floor(vUV * 3.0) + vSeed * 7.0 + floor(uTime * 9.0 + vSeed * 5.0)));
        glow = vec3(2.5, 0.9, 0.2) * fire * (0.25 + 0.75 * lick) * (1.0 - smoothstep(0.7, 1.0, charK));
      }
      col = mix(col, vec3(0.8, 0.83, 0.88) * (uAmbient * 0.75 + uLightColor * 0.45 * sh), uSnowCover * 0.65 * smoothstep(0.35, 0.85, n.y) * step(0.5, vPart) * (1.0 - fire));
      col += (vPart < 0.5 ? vec3(0.3, 0.22, 0.15) * uBarkTint : vec3(0.2, 0.3, 0.1) * uKindTint) * pointLights(vW, n) * vAO * (1.0 - 0.7 * charK);
      col = applyFog(col, vW) + glow;
      gl_FragColor = vec4(safeColor(col), uFoliageCut < 0.1 ? clamp((alpha - 0.3) / max(fwidth(alpha), 0.05) + 0.5, 0.0, 1.0) : 1.0);
      if (uFoliageCut >= 0.1 && alpha < uFoliageCut) discard;
    }`,
});
const NAT_TREE_DEPTH_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_FOLIAGE}
  varying float vPart; varying vec2 vUV; varying float vSeed; varying vec4 vSt;
  void main(){
    if (vPart > 0.5 && vPart < 2.5) {
      if (hash12(vec2(vSeed * 97.0, vSeed * 31.0 + 1.7)) > vSt.z) discard;
      if ((vPart < 1.5 ? leafCluster(vUV, vSeed) : needleSpray(vUV)) < 0.5) discard;
    }
    if (vPart > 2.5 && bayer4(gl_FragCoord.xy) > vSt.z * 1.15 - 0.1) discard;
    gl_FragColor = vec4(1.0);
  }`;
// stumps, the cut ends of logs and split firewood: bark round the side, rings on the cut faces
const NAT_WOOD_VS = /* glsl */`
  ${GLSL_COMMON}
  attribute float aEnd; attribute float aRing;
  attribute vec4 iP; attribute vec4 iQ; attribute vec4 iSc; attribute vec4 iW;
  varying vec3 vW; varying vec3 vN; varying vec3 vLocal; varying float vEnd; varying float vRing; varying vec4 vWd; varying float vGlow;
  vec3 qrot(vec4 q, vec3 v){ return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v); }
  void main(){
    vec3 p = position;
    // a stump that was broken, not cut, has a splintered top
    if (aEnd > 0.5 && position.y > 0.5) p.y += (hash12(vec2(floor(atan(position.z, position.x + 1e-4) * 2.6 + 9.0), iW.z * 31.0)) - 0.25) * 0.55 * iW.y * smoothstep(0.15, 0.9, aRing) / max(iSc.y, 0.05);
    vec3 w = iP.xyz + qrot(iQ, p * iSc.xyz);
    vW = w; vN = qrot(iQ, normal / max(iSc.xyz, vec3(1e-3))); vLocal = position; vEnd = aEnd; vRing = aRing; vWd = iW; vGlow = iSc.w;
    gl_Position = iP.w > 0.5 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
  }`;
const natWoodMat = mat({
  vertexShader: NAT_WOOD_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    uniform vec3 uBark;
    uniform float uSnowCover, uWet;
    varying vec3 vW; varying vec3 vN; varying vec3 vLocal; varying float vEnd; varying float vRing; varying vec4 vWd; varying float vGlow;
    void main(){
      vec3 n = safeNormalize(vN);
      float sh = shadowAt(vW, n);
      vec3 alb; float e = 0.0;
      if (vEnd > 0.5) {
        float r = clamp(vRing, 0.0, 1.0);
        float w = vnoise(vLocal.xz * 7.0 + vWd.z * 13.0);
        float rings = 0.5 + 0.5 * sin(r * (24.0 + 10.0 * vWd.z) + w * 2.2);
        alb = mix(vec3(0.6, 0.45, 0.27), vec3(0.8, 0.66, 0.45), rings);
        alb = mix(alb, vec3(0.32, 0.21, 0.12), 1.0 - smoothstep(0.03, 0.1, r));
        alb = mix(alb, vec3(0.24, 0.16, 0.1), smoothstep(0.85, 0.93, r));
        float ang = atan(vLocal.z, vLocal.x + 1e-4);
        alb *= 1.0 - 0.45 * step(0.9, vnoise(vec2(ang * 7.0, 3.0 + vWd.z * 9.0))) * smoothstep(0.15, 0.5, r) * (1.0 - smoothstep(0.8, 0.9, r));
        alb = mix(alb, alb * vec3(0.7, 0.62, 0.55), vWd.y * smoothstep(0.4, 0.8, vnoise(vLocal.xz * 22.0)));
        // fresh wood greys as it weathers
        alb = mix(alb, vec3(0.5, 0.47, 0.42) * (0.8 + 0.3 * rings), clamp(vWd.x * -1.0, 0.0, 0.7));
      } else {
        float ang = atan(vLocal.z, vLocal.x + 1e-4);
        float fis = vnoise(vec2(ang * 5.0, vLocal.y * 5.0)) * 0.6 + vnoise(vec2(ang * 13.0, vLocal.y * 13.0)) * 0.4;
        vec3 bark = vWd.w < 0.5 ? uBark * 1.05 : vWd.w < 1.5 ? vec3(0.82, 0.8, 0.74) : uBark * vec3(0.9, 0.85, 0.8);
        alb = bark * (0.7 + 0.45 * fis) * mix(0.55, 1.0, smoothstep(0.3, 0.6, fis));
        if (vWd.w > 0.5 && vWd.w < 1.5) alb = mix(alb, vec3(0.08, 0.07, 0.07), step(0.74, vnoise(vec2(ang * 3.0, vLocal.y * 9.0))));
        e = smoothstep(0.6, 0.3, fis);
      }
      float charK = clamp(vWd.x, 0.0, 1.0);
      alb = mix(alb, vec3(0.032, 0.029, 0.026) * (0.8 + 0.4 * vnoise(vLocal.xz * 11.0 + vLocal.y * 5.0)), charK);
      alb *= 1.0 - 0.25 * uWet;
      float ndl = clamp(dot(n, uLightDir) * 0.5 + 0.5, 0.0, 1.0);
      vec3 col = alb * (0.38 + 0.72 * ndl * mix(0.3, 1.0, sh));
      col = mix(col, vec3(0.82, 0.85, 0.9) * (uAmbient * 0.75 + uLightColor * 0.45 * sh), uSnowCover * 0.7 * smoothstep(0.5, 0.9, n.y));
      col += vec3(0.3, 0.22, 0.15) * pointLights(vW, n);
      col = applyFog(col, vW);
      col += vec3(2.4, 0.8, 0.16) * vGlow * (0.3 + 0.9 * e) * (0.6 + 0.4 * sin(uTime * 5.0 + vLocal.y * 9.0 + vLocal.x * 5.0));
      gl_FragColor = vec4(safeColor(col), 1.0);
    }`,
});
// geometry for the wood pieces, with the cut faces marked: aEnd 1 on a cut face, aRing the distance from its centre
function natWoodGeometry(pieces) {
  const P = [], N = [], E = [], R = [];
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  for (const pc of pieces) {
    const g = pc.geo.index ? pc.geo.toNonIndexed() : pc.geo;
    const p = g.attributes.position, nr = g.attributes.normal;
    const nm = new THREE.Matrix3().getNormalMatrix(pc.m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i); nv.fromBufferAttribute(nr, i);
      const end = Math.abs(nv.y) > 0.99 && (!pc.topOnly || nv.y > 0) ? 1 : 0;
      if (pc.skipBottom && nv.y < -0.99) continue;
      E.push(end); R.push(Math.hypot(v.x, v.z) / pc.r);
      v.applyMatrix4(pc.m); nv.applyMatrix3(nm).normalize();
      P.push(v.x, v.y, v.z); N.push(nv.x, nv.y, nv.z);
    }
  }
  // drop any whole triangle that lost a vertex (the skipped bottoms come in whole triangles)
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
  g.setAttribute('aEnd', new THREE.Float32BufferAttribute(E, 1));
  g.setAttribute('aRing', new THREE.Float32BufferAttribute(R, 1));
  g.instanceCount = 0;
  return g;
}
function natInstanced(g, cap, names) {
  const out = { geo: g, cap, n: 0, attrs: {} };
  for (const [name, size] of names) {
    const a = new THREE.InstancedBufferAttribute(new Float32Array(cap * size), size).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute(name, a);
    out.attrs[name] = a;
  }
  return out;
}
function natWoodSet(geo, cap) {
  const S = natInstanced(geo, cap, [['iP', 4], ['iQ', 4], ['iSc', 4], ['iW', 4]]);
  const m = new THREE.Mesh(geo, natWoodMat);
  m.frustumCulled = false; m.renderOrder = 2;
  scene.add(m);
  shadowCaster(m, depthFrom(natWoodMat));
  S.mesh = m;
  return S;
}
function natTreeSets() {
  for (const kind of Object.keys(TREE_KINDS)) {
    const K = TREE_KINDS[kind], base = NEAR_TREES.kinds[kind].mesh.geometry;
    const mk = (index, cap) => {
      const g = new THREE.InstancedBufferGeometry();
      for (const name of ['position', 'normal', 'aPart', 'aAO', 'aUV', 'aSeed']) g.setAttribute(name, base.attributes[name]);
      g.setIndex(index);
      g.instanceCount = 0;
      const S = natInstanced(g, cap, [['iPos', 4], ['iRot', 2], ['iFall', 4], ['iSt', 4], ['iFx', 4]]);
      const m = new THREE.Mesh(g, shareMat(natTreeMat, { uKindTint: { value: new THREE.Vector3(...K.tint) }, uBarkTint: { value: new THREE.Vector3(...K.bark) }, uBirch: { value: K.birch }, uNeedle: { value: kind === 'pine' ? 1 : 0 } }));
      m.frustumCulled = false; m.renderOrder = 2;
      scene.add(m);
      shadowCaster(m, depthFrom(m.material, NAT_TREE_DEPTH_FS));
      S.mesh = m;
      return S;
    };
    // a bare-wood copy of the geometry for burnt snags and stripped logs, so many of them stay cheap
    const part = base.attributes.aPart.array, src = base.index.array, bark = [];
    for (let i = 0; i < src.length; i += 3) if (part[src[i]] < 0.5 && part[src[i + 1]] < 0.5 && part[src[i + 2]] < 0.5) bark.push(src[i], src[i + 1], src[i + 2]);
    const barkIdx = bark.length / 3 > 65535 || base.attributes.position.count > 65535 ? new THREE.Uint32BufferAttribute(bark, 1) : new THREE.Uint16BufferAttribute(bark, 1);
    NATURE.sets[kind] = { full: mk(base.index, NAT_CAP.full), bark: mk(barkIdx, NAT_CAP.bark) };
  }
  // stumps: a flared trunk end with a cut top
  const stumpGeo = new THREE.CylinderGeometry(1, 1.2, 1, 14, 2, false);
  stumpGeo.translate(0, 0.5, 0);
  NATURE.sets.stump = natWoodSet(natWoodGeometry([{ geo: stumpGeo, m: new THREE.Matrix4(), r: 1, skipBottom: true }]), NAT_CAP.stumps);
  // the cut end of a fallen trunk: a disc facing down the trunk
  const disc = new THREE.CylinderGeometry(1, 1, 0.02, 14, 1, false);
  NATURE.sets.ends = natWoodSet(natWoodGeometry([{ geo: disc, m: new THREE.Matrix4(), r: 1, topOnly: true, skipBottom: true }]), NAT_CAP.full * 3 + 40);
  // firewood: split logs stacked four and three, each a wedge of a round
  const pieces = [];
  const rr = mulberry(77);
  const add = (x, y, z, a) => {
    const rad = 0.105 + rr() * 0.025;
    const g = new THREE.CylinderGeometry(rad, rad, 0.6 + rr() * 0.08, 8, 1, false);
    const m = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.PI / 2, a, 0, 'YXZ')), new THREE.Vector3(1, 1, 1));
    pieces.push({ geo: g, m, r: rad });
  };
  for (let k = 0; k < 4; k++) add(-0.36 + k * 0.24, 0.12, (rr() - 0.5) * 0.08, (rr() - 0.5) * 0.12);
  for (let k = 0; k < 3; k++) add(-0.24 + k * 0.24, 0.33, (rr() - 0.5) * 0.08, (rr() - 0.5) * 0.12);
  for (let k = 0; k < 2; k++) add(-0.12 + k * 0.24, 0.53, (rr() - 0.5) * 0.08, (rr() - 0.5) * 0.12);
  NATURE.sets.pile = natWoodSet(natWoodGeometry(pieces), NAT_CAP.piles);
}

/* ------------------------------------------------------------------ */
/* Build: match every tree to its collider and its far-tree instance    */
/* ------------------------------------------------------------------ */
function buildNature() {
  const key = (x, z) => Math.round(Math.fround(x) * 16) + ':' + Math.round(Math.fround(z) * 16);
  const byKey = new Map();
  W.trees.forEach((t, i) => {
    t.i = i; t.s0 = t.s; t.state = 'stand'; t.hp = TREE_DIM[t.kind].hp * t.s0;
    t.fire = 0; t.char = 0; t.leaf = 1; t.shake = 0; t.notch = 0; t.grow = 1;
    byKey.set(key(t.x, t.z), t);
  });
  for (const c of COLL.circles) if (c.tag === 'tree') { const t = byKey.get(key(c.x, c.z)); if (t && !t.coll) { t.coll = c; t.collR = c.r; } }
  for (const m of treeChunks) {
    const a = m.geometry.attributes.iPos;
    for (let k = 0; k < a.count; k++) { const t = byKey.get(key(a.array[k * 4], a.array[k * 4 + 2])); if (t) { t.chunk = m; t.ci = k; } }
  }
  natTreeSets();
  NATURE.built = true;
}
// show a tree in the ordinary forest sets at scale s (0 hides it: the nature sets draw it instead)
function natShowRegular(t, s) {
  t.s = s;
  if (t.chunk) {
    const a = t.chunk.geometry.attributes.iPos;
    a.array[t.ci * 4 + 1] = t.y - 0.15;
    a.array[t.ci * 4 + 3] = s;
    a.needsUpdate = true;
  }
  NEAR_TREES.t = 0; NEAR_TREES.lastX = 1e9;
}
function natTake(t) {
  if (t.state === 'dyn') return;
  t.state = 'dyn';
  natShowRegular(t, 0);
  if (!NATURE.dyn.includes(t)) NATURE.dyn.push(t);
}
// a tree that is whole and still again goes back to the forest
function natRelease(t) {
  t.state = 'stand';
  t.shake = 0; t.notch = 0;
  natShowRegular(t, t.s0 * t.grow);
  const i = NATURE.dyn.indexOf(t);
  if (i >= 0) NATURE.dyn.splice(i, 1);
}

/* ------------------------------------------------------------------ */
/* Trees: blows, felling, falling, burning, regrowing                  */
/* ------------------------------------------------------------------ */
const natStanding = (t) => !t.felled && t.grow > 0.55 && t.fire < 0.1;
const natS = (t) => t.s0 * t.grow;
function natTreesNear(x, z, r, fn) {
  if (!NEAR_TREES.grid) return;
  const c = NEAR_TREES.cell;
  for (let j = Math.floor((z - r) / c); j <= Math.floor((z + r) / c); j++) {
    for (let i = Math.floor((x - r) / c); i <= Math.floor((x + r) / c); i++) {
      const L = NEAR_TREES.grid.get(i + ',' + j);
      if (!L) continue;
      for (const ti of L) { const t = W.trees[ti]; const d = Math.hypot(t.x - x, t.z - z); if (d < r) fn(t, d); }
    }
  }
}
function nearestTree(x, z, r, filter = natStanding) {
  let best = null, bd = r;
  natTreesNear(x, z, r, (t, d) => { if (d < bd && filter(t)) { bd = d; best = t; } });
  return best;
}
// a blow against a tree from (fx, fz): it shakes, and if it has taken enough it comes down away from the blow
function treeBlow(t, power, fx, fz) {
  if (!NATURE.built || t.felled || t.fall) return false;
  natTake(t);
  t.shake = Math.min(1, t.shake + 0.35 + power / 120);
  t.hp -= power * (t.char > 0.5 ? 1.8 : 1);
  if (t.leaf > 0.3 && dist2(t.x, t.z, camera.position.x, camera.position.z) < 70 * 70) natLeafFall(t, 6 + Math.round(power / 12));
  if (t.hp <= 0 || t.grow < 0.45) { fellTree(t, t.x - fx, t.z - fz, power, false); return true; }
  return false;
}
// heavy blows in a circle: abilities, meteors, the dragon
function natureBlowArea(x, z, r, power, fromX = x, fromZ = z) {
  if (!NATURE.built || x > DUN_X0 - 50) return;
  natTreesNear(x, z, r + 0.6, (t, d) => {
    if (t.felled) return;
    const k = clamp(1.2 - d / (r + 0.6), 0.35, 1);
    const fx = d < 0.4 ? fromX : x, fz = d < 0.4 ? fromZ : z;
    treeBlow(t, power * k, fx === t.x && fz === t.z ? t.x - 1 : fx, fz);
  });
}
// can a tree fall along (ux, uz) without its trunk passing through another trunk, a wall or a house?
function natFallClear(t, ux, uz, L) {
  collidersNear(t.x + ux * L * 0.5, t.z + uz * L * 0.5, L * 0.5 + 3, _natC);
  for (const c of _natC) {
    if (!c.active || c === t.coll) continue;
    if (c.type === 'circle') {
      const ox = c.x - t.x, oz = c.z - t.z, along = ox * ux + oz * uz;
      if (along < 0.4 || along > L * 0.9) continue;
      if (Math.abs(ox * uz - oz * ux) < c.r + (c.tag === 'tree' ? 0.35 : 0.6)) return false;
    } else {
      for (let s = 1; s < L * 0.9; s += 0.8) {
        const dx = t.x + ux * s - c.x, dz = t.z + uz * s - c.z;
        const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos;
        if (Math.abs(lx) < c.hx + 0.5 && Math.abs(lz) < c.hz + 0.5) return false;
      }
    }
  }
  return true;
}
function fellTree(t, dx, dz, power = 60, chopped = false) {
  if (t.felled) return;
  natTake(t);
  const D = TREE_DIM[t.kind], s = natS(t), L = D.top * s;
  // fall away from the blow, or into the nearest gap beside that line
  const base = Math.atan2(dx, dz) + (Math.random() - 0.5) * 0.2;
  let ang = base;
  for (const off of [0, 0.3, -0.3, 0.6, -0.6, 0.9, -0.9, 1.25, -1.25, 1.6, -1.6]) {
    if (natFallClear(t, Math.sin(base + off), Math.cos(base + off), L)) { ang = base + off; break; }
  }
  const ux = Math.sin(ang), uz = Math.cos(ang);
  const pivotY = t.y - 0.15 + D.cut * s;
  // where the trunk first meets the ground (the crown props the top end up a little)
  let stop = 1.62;
  outer: for (let a = 0.25; a < 1.75; a += 0.015) {
    const sa = Math.sin(a), ca = Math.cos(a);
    for (let r = 0.8; r <= L; r += 0.7) {
      const clr = r < D.trunk * s ? D.r * s * 1.1 : D.crown * s * 0.42;
      if (pivotY + r * ca - clr < heightAt(t.x + ux * r * sa, t.z + uz * r * sa)) { stop = a; break outer; }
    }
  }
  t.felled = true; t.chopped = chopped; t.felledAt = GAME.t;
  t.fall = { ang: 0.02, vel: 0.12 + Math.min(0.5, power / 400), ux, uz, stop, L, bounces: 0, done: false, slide: 0, drop: 0 };
  t.shake = Math.max(t.shake, 0.4);
  // the stump keeps the old collider, cut down to size (still tagged a tree, so sight lines pass it as before)
  if (t.coll) { t.coll.r = D.r * s * 1.15 + 0.08; t.coll.h = D.cut * s + 0.2; t.coll.stump = true; }
  NATURE.felled.push(t);
  natSfx('creak', t.x, t.z);
  const P = GAME.player;
  if (P && dist2(P.x, P.z, t.x, t.z) < 60 * 60 && chopped) uiLog(`The ${t.kind} comes down.`, 'sys');
}
function natLeafFall(t, n) {
  const D = TREE_DIM[t.kind], s = natS(t);
  const brown = t.char > 0.2;
  for (let k = 0; k < n; k++) {
    const a = Math.random() * TAU, r = Math.random() * D.crown * s;
    const g = 0.6 + Math.random() * 0.4;
    const c = brown ? [0.32 * g, 0.18 * g, 0.06 * g] : t.kind === 'pine' ? [0.12 * g, 0.22 * g, 0.12 * g] : [0.22 * g, 0.34 * g, 0.1 * g];
    fxAlpha.emit(t.x + Math.cos(a) * r, t.y + D.crownY * s + (Math.random() - 0.3) * D.crown * s, t.z + Math.sin(a) * r,
      (Math.random() - 0.5) * 1.2 + U.uWindDir.value.x * 0.8, -0.3 - Math.random() * 0.5, (Math.random() - 0.5) * 1.2 + U.uWindDir.value.y * 0.8,
      2.2 + Math.random() * 1.6, c[0], c[1], c[2], 0.07 + Math.random() * 0.05, 0.6, 1.4);
  }
}
function natChips(x, y, z, ux, uz, n = 14) {
  for (let k = 0; k < n; k++) {
    const g = 0.75 + Math.random() * 0.3;
    fxAlpha.emit(x, y, z, ux * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2.2, 1.4 + Math.random() * 2.6, uz * (1.5 + Math.random() * 3) + (Math.random() - 0.5) * 2.2,
      0.8 + Math.random() * 0.5, 0.78 * g, 0.64 * g, 0.42 * g, 0.05 + Math.random() * 0.05, 9, 0.6);
  }
}
// set a tree's crown alight (lightning, fire spells, grass fire, a burning house); false if it cannot burn now
function igniteTree(i) {
  const t = typeof i === 'number' ? W.trees[i] : i;
  if (!NATURE.built || !t || t.fire > 0.05 || t.char > 0.92 || t.grow < 0.3 || (t.felled && !t.log)) return false;
  natTake(t);
  t.fire = Math.max(t.fire, 0.15); t.burnT = 0; t.burnDur = 20 + Math.random() * 14;
  natSfx('crackle', t.x, t.z);
  return true;
}
function stepTree(t, dt) {
  const D = TREE_DIM[t.kind], s = natS(t);
  t.shake = Math.max(0, t.shake - dt * 1.4);
  // burning: the fire climbs through the crown, chars the wood and strips the leaves, then dies down
  if (t.fire > 0) {
    t.burnT += dt;
    const dry = natDry();
    const dying = t.burnT > t.burnDur || dry < 0.25;
    t.fire = dying ? Math.max(0, t.fire - dt * (dry < 0.25 ? 0.25 : 0.08)) : Math.min(1, t.fire + dt * 0.22 * (0.4 + dry));
    t.char = Math.min(1, t.char + dt * t.fire / 18);
    t.leaf = Math.min(t.leaf, 1 - sstep(0.15, 0.85, t.char));
    t.nextSpread = (t.nextSpread || 0) - dt;
    if (t.nextSpread <= 0 && t.fire > 0.3) {
      t.nextSpread = 1.4 + Math.random();
      // embers fall into the grass below and drift to neighbouring crowns
      const a = Math.random() * TAU, r = Math.random() * D.crown * s;
      const fx = t.felled && t.fall ? t.x + t.fall.ux * D.trunk * s * 0.8 : t.x, fz = t.felled && t.fall ? t.z + t.fall.uz * D.trunk * s * 0.8 : t.z;
      igniteGrass(fx + Math.cos(a) * r, fz + Math.sin(a) * r, 0.8);
      natTreesNear(t.x, t.z, (D.crown * s) * 2 + 1.5, (o) => { if (o !== t && Math.random() < 0.13 * t.fire * dry) igniteTree(o); });
      if (typeof houseAt === 'function' && Math.random() < 0.12 * t.fire) { const H = houseAt(t.x, t.z, D.crown * s + 1); if (H) igniteHouse(H, t.x, t.z); }
    }
    if (t.fire <= 0) {
      t.fire = 0;
      // a burnt snag may come down by itself
      if (!t.felled && Math.random() < 0.45) t.collapseAt = GAME.t + 2 + Math.random() * 14;
      else if (!t.felled) t.collapseAt = GAME.t + NAT_REGROW.snag * (0.7 + Math.random() * 0.6) / NATURE.speed;
    }
  }
  if (t.collapseAt && GAME.t > t.collapseAt && !t.felled) { t.collapseAt = 0; const a = Math.random() * TAU; fellTree(t, Math.sin(a), Math.cos(a), 30); }
  // falling: a rigid trunk turning about its base, pulled over by its own weight
  const F = t.fall;
  if (F && !F.done) {
    const g = 9.8, Lc = F.L;
    F.vel += (3 * g / (2 * Lc)) * Math.sin(F.ang) * dt - F.vel * 0.05 * dt;
    F.ang += F.vel * dt;
    if (F.ang >= F.stop) {
      F.ang = F.stop;
      if (F.bounces === 0) natLand(t);
      F.bounces++;
      F.vel = -F.vel * (F.bounces === 1 ? 0.22 : 0.12);
      t.shake = Math.min(1, t.shake + (F.bounces === 1 ? 1 : 0.4));
      if (Math.abs(F.vel) < 0.08 || F.bounces > 3) { F.vel = 0; F.done = true; natSettle(t); }
    }
  }
  if (F && F.done && F.drop < 1) {
    // the butt slides off the stump and comes to rest on the ground
    F.drop = Math.min(1, F.drop + dt * 2.5);
  }
  if (t.log && t.rotAt && GAME.t > t.rotAt) {
    t.rot2 = Math.min(1, (t.rot2 || 0) + dt / 25);
    if (t.rot2 >= 1) natRemoveLog(t);
  }
  // fallen crowns wither slowly
  if (t.felled && F && F.done && t.leaf > 0) t.leaf = Math.max(0, t.leaf - dt / 260 * NATURE.speed);
  // whole and still again: back to the forest
  if (!t.felled && t.fire <= 0 && t.char <= 0 && t.shake <= 0 && t.notch <= 0 && !(NATURE.job && NATURE.job.tree === t)) natRelease(t);
}
// the moment a falling tree hits the ground
function natLand(t) {
  const F = t.fall, D = TREE_DIM[t.kind], s = natS(t);
  const ex = t.x + F.ux * F.L * 0.7, ez = t.z + F.uz * F.L * 0.7;
  const near = dist2(ex, ez, camera.position.x, camera.position.z) < 90 * 90;
  if (near) {
    for (let r = 1; r < F.L; r += 0.9) {
      const x = t.x + F.ux * r, z = t.z + F.uz * r;
      FX.dust(x, heightAt(x, z), z, 3, [0.42, 0.37, 0.29]);
    }
    if (t.leaf > 0.2) natLeafFall(t, 30);
    if (t.fire > 0.2) FX.burst(ex, heightAt(ex, ez) + 0.5, ez, 40, [2.4, 1.0, 0.3], 5, 0.8, 0.12, 3);
  }
  natSfx('crash', ex, ez);
  if (dist2(ex, ez, camera.position.x, camera.position.z) < 30 * 30) cameraShake(0.22, ex, ez);
  // anyone under it is struck down
  forNear(t.x + F.ux * F.L * 0.5, t.z + F.uz * F.L * 0.5, F.L * 0.5 + 1.5, (o) => {
    if (!o.alive || !isActor(o) || o.flying || o.kind === 'dragon') return;
    const ox = o.x - t.x, oz = o.z - t.z, along = ox * F.ux + oz * F.uz;
    if (along < 0.8 || along > F.L) return;
    const width = along < D.trunk * s ? D.r * s + 0.5 : D.crown * s * 0.6;
    if (Math.abs(ox * F.uz - oz * F.ux) > width + o.radius) return;
    const hit = o.maxHp * (along < D.trunk * s ? 0.22 : 0.08);
    dealDamage(o, o, hit, { dot: true, kind: 'crush' });
    if (o.alive) addBuff(o, 'stun', 1, along < D.trunk * s ? 1.4 : 0.6, null);
    if (o === GAME.player) uiLog('A falling tree strikes you!', 'warn');
  });
  // crushed grass under the trunk
  for (let r = 0.5; r < D.trunk * s; r += 0.8) natureCut(t.x + F.ux * r, t.z + F.uz * r, 0.6, 0.7, false);
}
// at rest: the log gets its collider and the stump its clock
function natSettle(t) {
  const F = t.fall, D = TREE_DIM[t.kind], s = natS(t);
  const len = D.trunk * s * Math.sin(F.ang) + 0.2;
  const cx = t.x + F.ux * (len * 0.5 + 0.55), cz = t.z + F.uz * (len * 0.5 + 0.55);
  t.log = true;
  // tagged like a post so line-of-sight checks look past it, as they do past trees
  t.logColl = addBox(cx, cz, D.r * s + 0.05, len * 0.5, Math.atan2(F.ux, F.uz), 'post', D.r * s * 2 + 0.25);
  t.logColl.natLog = true;
  t.regrowAt = GAME.t + NAT_REGROW.felled * (0.8 + Math.random() * 0.4) / NATURE.speed;
  t.rotAt = t.regrowAt;
}
function natRemoveLog(t) {
  t.log = false; t.rot2 = 0;
  if (t.logColl) { t.logColl.active = false; t.logColl = null; }
  const i = NATURE.dyn.indexOf(t);
  if (i >= 0) NATURE.dyn.splice(i, 1);
}
// a stump becomes a sapling, and the sapling a tree
function stepFelled(dt) {
  for (let i = NATURE.felled.length - 1; i >= 0; i--) {
    const t = NATURE.felled[i];
    if (t.log || !t.regrowAt || GAME.t < t.regrowAt) continue;
    if (t.fall && !t.fall.done) continue;
    NATURE.felled.splice(i, 1);
    const k = NATURE.dyn.indexOf(t);
    if (k >= 0) NATURE.dyn.splice(k, 1);
    t.felled = false; t.fall = null; t.chopped = false; t.state = 'stand';
    t.fire = 0; t.char = 0; t.leaf = 1; t.shake = 0; t.notch = 0;
    t.grow = 0.12; t.hp = TREE_DIM[t.kind].hp * t.s0;
    t.y = heightAt(t.x, t.z);
    if (t.coll) { t.coll.stump = false; t.coll.r = (t.collR || 0.5) * 0.4; t.coll.h = 8; t.coll.active = true; }
    natShowRegular(t, t.s0 * t.grow);
    NATURE.growing = NATURE.growing || [];
    NATURE.growing.push(t);
  }
  const G = NATURE.growing;
  if (!G || !G.length) return;
  NATURE.growAcc = (NATURE.growAcc || 0) + dt;
  if (NATURE.growAcc < 2) return;
  const step = NATURE.growAcc; NATURE.growAcc = 0;
  for (let i = G.length - 1; i >= 0; i--) {
    const t = G[i];
    if (t.felled || t.state !== 'stand') { G.splice(i, 1); continue; }
    t.grow = Math.min(1, t.grow + step * NATURE.speed / NAT_REGROW.grow);
    if (t.coll) t.coll.r = (t.collR || 0.5) * (0.4 + 0.6 * t.grow);
    natShowRegular(t, t.s0 * t.grow);
    if (t.grow >= 1) G.splice(i, 1);
  }
}

/* ------------------------------------------------------------------ */
/* Grass: cutting, burning, regrowing                                  */
/* ------------------------------------------------------------------ */
// cut the grass in a circle (or a sector facing yaw with half-angle half)
function natureCut(x, z, r, amount = 1, clippings = true, yaw = 0, half = Math.PI) {
  if (!NATURE.built || x > DUN_X0 - 50) return 0;
  const i0 = Math.max(1, natCell(x - r)), i1 = Math.min(NAT.res - 2, natCell(x + r));
  const j0 = Math.max(1, natCell(z - r)), j1 = Math.min(NAT.res - 2, natCell(z + r));
  if (i0 > i1 || j0 > j1) return 0;
  const fx = Math.sin(yaw), fz = Math.cos(yaw), ch = Math.cos(half);
  let n = 0;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const px = i - 511.5, pz = j - 511.5, dx = px - x, dz = pz - z, d = Math.hypot(dx, dz);
    if (d > r) continue;
    if (half < Math.PI && d > 0.6 && (dx * fx + dz * fz) / d < ch) continue;
    const o = natIdx(i, j) * 4;
    const v = Math.round(255 * amount * clamp((r - d) / 0.6, 0.4, 1));
    if (NAT.data[o] < v && NAT.data[o + 1] < 200) { NAT.data[o] = v; n++; }
  }
  if (!n) return 0;
  natMark(i0, j0, i1, j1);
  natTouchRect(i0, j0, i1, j1);
  // clippings fly where the blade passed through standing grass
  if (clippings && dist2(x, z, camera.position.x, camera.position.z) < 45 * 45) {
    const dens = sampleGrid(W.grass, x, z);
    const m = Math.min(26, Math.round(n * 0.5 * dens));
    for (let k = 0; k < m; k++) {
      const a = yaw + (Math.random() * 2 - 1) * Math.min(half, Math.PI), rr = (0.4 + 0.6 * Math.random()) * r;
      const px = x + Math.sin(a) * rr, pz = z + Math.cos(a) * rr;
      const g = 0.7 + Math.random() * 0.4;
      fxAlpha.emit(px, heightAt(px, pz) + 0.25 + Math.random() * 0.3, pz, Math.sin(a + 1.4) * (1 + Math.random() * 2), 1 + Math.random() * 1.6, Math.cos(a + 1.4) * (1 + Math.random() * 2),
        0.9 + Math.random() * 0.6, 0.3 * g, 0.42 * g, 0.12 * g, 0.045 + Math.random() * 0.03, 7, 1.2);
    }
  }
  return n;
}
// a blade swing by an entity: cuts the grass in front (or all round) and strikes any tree in reach
function natureSwing(e, r, half, treePower = 0) {
  if (!NATURE.built || !e || e.kind !== 'humanoid' || inDungeon(e)) return;
  natureCut(e.x, e.z, r, 1, true, e.yaw, half);
  if (treePower > 0) {
    natTreesNear(e.x, e.z, r + 0.8, (t, d) => {
      if (t.felled) return;
      if (half < Math.PI && d > 0.8 && Math.abs(angDiff(e.yaw, Math.atan2(t.x - e.x, t.z - e.z))) > half + 0.25) return;
      if (treeBlow(t, treePower, e.x, e.z)) return;
      natChips(t.x, t.y + 1 + Math.random(), t.z, (e.x - t.x) / Math.max(d, 0.1), (e.z - t.z) / Math.max(d, 0.1), 8);
    });
  }
}
// set grass alight around (x, z): a few seed cells inside r
function igniteGrass(x, z, r = 1, seeds = 0) {
  if (!NATURE.built || x > DUN_X0 - 50) return 0;
  if (natDry() < 0.2) return 0;
  let n = 0;
  const m = seeds || Math.max(1, Math.round(r * r * 0.8));
  for (let k = 0; k < m; k++) {
    const a = Math.random() * TAU, d = Math.sqrt(Math.random()) * r;
    const i = natCell(x + Math.cos(a) * d), j = natCell(z + Math.sin(a) * d);
    if (natIgniteCell(i, j)) n++;
  }
  return n;
}
function natIgniteCell(i, j) {
  if (NATURE.fire.size > 6000) return false;
  const f = natFuel(i, j);
  if (f <= 0.05) return false;
  const k = natIdx(i, j);
  NATURE.fire.set(k, { i, j, t: 0, life: 3.5 + 4 * f + Math.random() * 2.5, f });
  NAT.data[k * 4 + 2] = 90;
  natMark(i, j, i, j);
  natTouch(i, j);
  return true;
}
// the grass fire: burning cells light their neighbours (downwind, dry and thick grass first), then burn out to ash
function stepGrassFire(dt) {
  const C = NATURE.clock;
  C.fire += dt;
  if (C.fire < 0.25) return;
  const step = C.fire; C.fire = 0;
  if (!NATURE.fire.size) { NATURE.fireList.length = 0; return; }
  const dry = natDry();
  const wx = U.uWindDir.value.x, wz = U.uWindDir.value.y, wind = clamp(U.uWind.value, 0, 3);
  const D = NAT.data, list = NATURE.fireList;
  list.length = 0;
  const born = [];
  for (const [k, c] of NATURE.fire) {
    c.t += step * (dry < 0.35 ? 2.2 : 1);
    const life = c.life;
    const ramp = Math.min(1, c.t / 0.9) * (1 - sstep(life - 1.6, life, c.t));
    const o = k * 4;
    if (c.t >= life) {
      D[o + 2] = 0; D[o + 1] = 255; D[o] = 0;
      NATURE.fire.delete(k);
      natMark(c.i, c.j, c.i, c.j);
      continue;
    }
    D[o + 2] = Math.round(40 + 215 * ramp);
    D[o + 1] = Math.max(D[o + 1], Math.round(255 * Math.min(1, c.t / life) * 0.85));
    natMark(c.i, c.j, c.i, c.j);
    list.push(c);
    if (ramp < 0.35) continue;
    // spread to the eight neighbours, and two cells downwind in a wind
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      if (!di && !dj) continue;
      const diag = di && dj ? 0.7 : 1;
      const along = (di * wx + dj * wz) / (diag === 1 ? 1 : 1.414);
      const p = 0.11 * step / 0.25 * diag * dry * dry * clamp(1 + along * 0.9 * wind, 0.15, 2.6);
      if (Math.random() < p * ramp) born.push(c.i + di, c.j + dj);
    }
    if (wind > 0.8 && Math.random() < 0.04 * wind * dry) born.push(c.i + Math.round(wx * 2.4), c.j + Math.round(wz * 2.4));
  }
  for (let q = 0; q < born.length; q += 2) natIgniteCell(born[q], born[q + 1]);
  // fire reaches the trees and houses at its edge
  const tries = Math.min(list.length, 24);
  for (let q = 0; q < tries; q++) {
    const c = list[Math.floor(Math.random() * list.length)];
    const x = c.i - 511.5, z = c.j - 511.5;
    const t = nearestTree(x, z, 1.6, (o) => !o.felled || o.log);
    if (t && Math.random() < 0.35 * dry) igniteTree(t);
    if (Math.random() < 0.2) { const H = houseAt(x, z, 1.2); if (H && Math.random() < 0.3) igniteHouse(H, x, z); }
  }
}
// standing in fire burns
function stepFireHarm(dt) {
  const C = NATURE.clock;
  C.harm -= dt;
  if (C.harm > 0 || !NATURE.fire.size) return;
  C.harm = 0.5;
  for (const e of ENT) {
    if (!e.alive || e.removed || e.kind === 'door' || e.kind === 'dragon' || e.flying || e.x > DUN_X0 - 50) continue;
    if (e.y > heightAt(e.x, e.z) + 1.2) continue;
    if (natGet(e.x, e.z, 2) > 0.45) {
      addBuff(e, 'burn', e.maxHp * 0.02, 1.2, null);
      if (e === GAME.player && !NATURE.warnedFire) { NATURE.warnedFire = true; uiToast('The grass is on fire under you! Get clear of the flames.', 'hint'); }
    }
  }
}
// burning houses drop fire into the grass around them
function stepHouseFires(dt) {
  const C = NATURE.clock;
  C.houses -= dt;
  if (C.houses > 0) return;
  C.houses = 1;
  for (const H of HOUSES) {
    if (H.state !== 'burning' || H.char < 0.3 || Math.random() > 0.35) continue;
    const a = Math.random() * TAU, r = (H.foot || 4) + 0.8 + Math.random() * 1.5;
    igniteGrass(H.x + Math.sin(a) * r, H.z + Math.cos(a) * r, 0.8, 1);
  }
}
// cut and burnt grass grows back, a few tiles at a time
function stepRegrow(dt) {
  const C = NATURE.clock;
  C.regrow -= dt;
  if (C.regrow > 0) return;
  C.regrow = 0.5;
  const keys = NATURE.tileKeys;
  if (!keys.length) return;
  const D = NAT.data;
  const budget = Math.min(keys.length, 6);
  for (let b = 0; b < budget; b++) {
    if (NATURE.tileAt >= keys.length) NATURE.tileAt = 0;
    const key = keys[NATURE.tileAt];
    const last = NATURE.tiles.get(key);
    const el = (GAME.t - last) * NATURE.speed;
    NATURE.tiles.set(key, GAME.t);
    const dc = Math.ceil(255 * el / NAT_REGROW.cut), db = Math.ceil(255 * el / NAT_REGROW.burnt), de = Math.ceil(255 * el / NAT_REGROW.earth);
    const ti = (key % 32) * 32, tj = Math.floor(key / 32) * 32;
    let any = false;
    for (let j = tj; j < tj + 32; j++) {
      let o = natIdx(ti, j) * 4;
      for (let i = 0; i < 32; i++, o += 4) {
        if (D[o + 2]) { any = true; continue; }
        if (D[o]) { D[o] = Math.max(0, D[o] - dc); any = true; }
        if (D[o + 1]) { D[o + 1] = Math.max(0, D[o + 1] - db); any = true; }
        if (D[o + 3]) { D[o + 3] = Math.max(0, D[o + 3] - de); any = true; }
      }
    }
    natMark(ti, tj, ti + 31, tj + 31);
    if (!any) { NATURE.tiles.delete(key); keys.splice(NATURE.tileAt, 1); }
    else NATURE.tileAt++;
  }
}

/* ------------------------------------------------------------------ */
/* Ground: craters                                                     */
/* ------------------------------------------------------------------ */
// does anything built stand close to (x, z)? craters leave buildings, walls and rocks alone
function natProtected(x, z) {
  for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + 5) ** 2) return 1;
  if (BARROW.door && dist2(x, z, BARROW.door.x, BARROW.door.z) < 18 * 18) return 1;
  collidersNear(x, z, 4, _natC);
  let p = 0;
  for (const c of _natC) {
    if (!c.active || c.tag === 'tree' || c.natLog) continue;
    const d = c.type === 'circle' ? Math.hypot(x - c.x, z - c.z) - c.r : (() => { const dx = x - c.x, dz = z - c.z; const lx = dx * c.cos - dz * c.sin, lz = dx * c.sin + dz * c.cos; return Math.hypot(Math.max(0, Math.abs(lx) - c.hx), Math.max(0, Math.abs(lz) - c.hz)); })();
    p = Math.max(p, 1 - sstep(1.2, 3.5, d));
  }
  return p;
}
// rebuild the terrain chunk vertices, normals and the height texture over grid cells [i0..i1] x [j0..j1]
function natTerrainUpdate(i0, j0, i1, j1) {
  i0 = Math.max(0, i0 - 1); j0 = Math.max(0, j0 - 1); i1 = Math.min(HN - 1, i1 + 1); j1 = Math.min(HN - 1, j1 + 1);
  const CELLS = 64, n = CELLS + 1, H = W.H;
  const seen = new Set();
  for (let cj = Math.floor(j0 / CELLS) - 1; cj <= Math.floor(j1 / CELLS); cj++) for (let ci = Math.floor(i0 / CELLS) - 1; ci <= Math.floor(i1 / CELLS); ci++) {
    if (ci < 0 || cj < 0 || ci > 7 || cj > 7) continue;
    const m = terrainChunks[cj * 8 + ci];
    if (!m || seen.has(m)) continue;
    seen.add(m);
    const pos = m.geometry.attributes.position, nrm = m.geometry.attributes.normal;
    let touched = false;
    for (let gj = Math.max(j0, cj * CELLS); gj <= Math.min(j1, cj * CELLS + CELLS); gj++) {
      for (let gi = Math.max(i0, ci * CELLS); gi <= Math.min(i1, ci * CELLS + CELLS); gi++) {
        const k = ((gj - cj * CELLS) * n + (gi - ci * CELLS)) * 3;
        pos.array[k + 1] = H[gj * HN + gi];
        const hl = H[gj * HN + Math.max(0, gi - 1)], hr = H[gj * HN + Math.min(HN - 1, gi + 1)];
        const hd = H[Math.max(0, gj - 1) * HN + gi], hu = H[Math.min(HN - 1, gj + 1) * HN + gi];
        const nx = (hl - hr) / (2 * HS), nz = (hd - hu) / (2 * HS), l = Math.hypot(nx, 1, nz);
        nrm.array[k] = nx / l; nrm.array[k + 1] = 1 / l; nrm.array[k + 2] = nz / l;
        touched = true;
      }
    }
    if (touched) { pos.needsUpdate = true; nrm.needsUpdate = true; }
  }
  texSubUpload(U.uHeightTex.value, i0, j0, i1 - i0 + 1, j1 - j0 + 1, HN, gl.RED, gl.FLOAT, W.H, 4);
}
// press a crater into the ground: a bowl of depth `depth` and radius r with a rim of thrown earth
function natureCrater(x, z, r, depth, rim = 0.32) {
  if (!NATURE.built || x > DUN_X0 - 50 || Math.abs(x) > HALF - 10 || Math.abs(z) > HALF - 10) return null;
  const R = r * 1.75;
  const i0 = Math.max(1, Math.floor((x - R + HALF) / HS)), i1 = Math.min(HN - 2, Math.ceil((x + R + HALF) / HS));
  const j0 = Math.max(1, Math.floor((z - R + HALF) / HS)), j1 = Math.min(HN - 2, Math.ceil((z + R + HALF) / HS));
  const w = i1 - i0 + 1, d = new Float32Array(w * (j1 - j0 + 1));
  const before = heightAt(x, z);
  let any = false;
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
    const gx = -HALF + i * HS, gz = -HALF + j * HS, q = Math.hypot(gx - x, gz - z) / r;
    if (q > 1.75) continue;
    let dh = -depth * Math.max(0, 1 - q * q) * (0.85 + 0.3 * hash2(i * 7, j * 13)) + depth * rim * Math.exp(-(((q - 1.05) / 0.3) ** 2));
    const k = j * HN + i;
    dh *= 1 - natProtected(gx, gz);
    if (Math.abs(dh) < 0.005) continue;
    W.H[k] += dh;
    d[(j - j0) * w + (i - i0)] = dh;
    any = true;
  }
  if (!any) return null;
  natTerrainUpdate(i0, j0, i1, j1);
  const C = { i0, j0, i1, j1, w, d, k: 1, born: GAME.t, x, z, r };
  NATURE.craters.push(C);
  // thrown earth on the nature map, a little wider than the bowl
  const e0 = natCell(x - r * 1.5), e1 = natCell(x + r * 1.5), f0 = natCell(z - r * 1.5), f1 = natCell(z + r * 1.5);
  for (let j = Math.max(0, f0); j <= Math.min(NAT.res - 1, f1); j++) for (let i = Math.max(0, e0); i <= Math.min(NAT.res - 1, e1); i++) {
    const q = Math.hypot(i - 511.5 - x, j - 511.5 - z) / r;
    const v = (1 - sstep(0.9, 1.5, q + (hash2(i * 3, j * 5) - 0.5) * 0.35)) * 255;
    const o = natIdx(i, j) * 4;
    if (v > D_EARTH_MIN && NAT.data[o + 3] < v) NAT.data[o + 3] = v;
    if (q < 1.1) NAT.data[o] = 0;
  }
  natMark(Math.max(0, e0), Math.max(0, f0), Math.min(NAT.res - 1, e1), Math.min(NAT.res - 1, f1));
  natTouchRect(e0, f0, e1, f1);
  // people and things in the bowl settle onto the new ground
  forNear(x, z, R + 1, (o) => { if (!o.flying && o.kind !== 'dragon' && o.kind !== 'door' && Math.abs(o.y - heightAt(o.x, o.z)) < 3) o.y = heightAt(o.x, o.z); });
  natTreesNear(x, z, R, (t) => { if (!t.felled) { t.y = heightAt(t.x, t.z); if (t.state !== 'dyn') natShowRegular(t, t.s); } });
  return { before, after: heightAt(x, z) };
}
const D_EARTH_MIN = 8;
// craters soften: the rim slumps and the bowl fills, over a long while
function stepCraters(dt) {
  const C = NATURE.clock;
  C.soften -= dt;
  if (C.soften > 0 || !NATURE.craters.length) return;
  C.soften = 12;
  for (let n = NATURE.craters.length - 1; n >= 0; n--) {
    const K = NATURE.craters[n];
    const kn = Math.exp(-(GAME.t - K.born) * NATURE.speed / 1500);
    const f = kn - K.k;
    K.k = kn;
    for (let j = K.j0; j <= K.j1; j++) for (let i = K.i0; i <= K.i1; i++) { const v = K.d[(j - K.j0) * K.w + (i - K.i0)]; if (v) W.H[j * HN + i] += v * f; }
    natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
    if (kn < 0.03) {
      for (let j = K.j0; j <= K.j1; j++) for (let i = K.i0; i <= K.i1; i++) { const v = K.d[(j - K.j0) * K.w + (i - K.i0)]; if (v) W.H[j * HN + i] -= v * kn; }
      natTerrainUpdate(K.i0, K.j0, K.i1, K.j1);
      NATURE.craters.splice(n, 1);
    }
  }
}

/* ------------------------------------------------------------------ */
/* Hooks for the rest of the game                                      */
/* ------------------------------------------------------------------ */
// a fire spell lands (called from fireLandsAt): grass catches, and the crowns of trees it lands among
function natureFireAt(x, y, z, r = 1) {
  if (!NATURE.built || x > DUN_X0 - 50) return;
  const g = heightAt(x, z);
  if (y - g > 3.5) return;
  if (r <= 1.2 && Math.random() > 0.45) return; // a single bolt does not always take
  igniteGrass(x, z, Math.max(0.8, r * 0.75), r <= 1.2 ? 2 : Math.round(3 + r * 2));
  natTreesNear(x, z, r + 1.2, (t) => { if (!t.felled || t.log) { if (Math.random() < (r > 2 ? 0.75 : 0.4)) igniteTree(t); } });
}
// a dragon's breath along (dx, dz)
function natureFireCone(x, z, dx, dz, range, half) {
  if (!NATURE.built) return;
  for (let k = 0; k < 3; k++) {
    const a = Math.atan2(dx, dz) + (Math.random() * 2 - 1) * half * 0.8, d = 2 + Math.random() * range;
    igniteGrass(x + Math.sin(a) * d, z + Math.cos(a) * d, 1.2, 2);
  }
  if (Math.random() < 0.5) natTreesNear(x + dx * range * 0.5, z + dz * range * 0.5, range * 0.6, (t) => { if (Math.random() < 0.25) igniteTree(t); });
}
// lightning (for 05e_weather.js): the tallest thing near the strike takes it, else the grass where it lands
function natureStrike(x, z, r = 8) {
  if (!NATURE.built || x > DUN_X0 - 50) return -1;
  const t = nearestTree(x, z, r, (o) => !o.felled && o.grow > 0.5);
  if (t) {
    igniteTree(t.i);
    if (Math.random() < 0.25) treeBlow(t, 400, t.x + Math.random() - 0.5, t.z + Math.random() - 0.5); // split by the bolt
    igniteGrass(t.x, t.z, 2, 3);
    return t.i;
  }
  igniteGrass(x, z, 1.2, 4);
  return -1;
}
// heavy impacts: a meteor, the leap strike, the dragon landing
function natureImpact(x, z, kind, r = 3) {
  if (!NATURE.built || x > DUN_X0 - 50) return;
  if (kind === 'meteor') {
    natureCrater(x, z, r * 0.62, 1.5 + r * 0.12, 0.3);
    natureBlowArea(x, z, r * 1.25, 260);
    igniteGrass(x, z, r * 0.9, Math.round(6 + r * 2));
    natTreesNear(x, z, r * 1.3, (t) => { if (Math.random() < 0.8) igniteTree(t); });
    // the scorched bowl: no grass, black earth
    const i0 = natCell(x - r), i1 = natCell(x + r), j0 = natCell(z - r), j1 = natCell(z + r);
    for (let j = Math.max(0, j0); j <= Math.min(NAT.res - 1, j1); j++) for (let i = Math.max(0, i0); i <= Math.min(NAT.res - 1, i1); i++) {
      const q = Math.hypot(i - 511.5 - x, j - 511.5 - z) / (r * 0.8);
      if (q > 1) continue;
      const o = natIdx(i, j) * 4;
      NAT.data[o + 1] = Math.max(NAT.data[o + 1], Math.round(255 * (1 - q * q * 0.6)));
    }
    natMark(Math.max(0, i0), Math.max(0, j0), Math.min(NAT.res - 1, i1), Math.min(NAT.res - 1, j1));
    natTouchRect(i0, j0, i1, j1);
  } else if (kind === 'leap') {
    natureCrater(x, z, Math.max(1.6, r * 0.55), 0.42, 0.45);
    natureBlowArea(x, z, r, 85);
  } else if (kind === 'dragon') {
    natureCrater(x, z, 4.2, 0.65, 0.5);
    natureBlowArea(x, z, 7.5, 320);
  }
}

/* ------------------------------------------------------------------ */
/* The player's axe work: chopping trees, cutting logs, lighting fires  */
/* ------------------------------------------------------------------ */
function natureOffers(P, offer) {
  if (!NATURE.built || inDungeon(P) || P.carrying != null || P.mount) return;
  const J = NATURE.job;
  const t = nearestTree(P.x, P.z, 3.4, (o) => natStanding(o) && !o.fall);
  if (t && !(J && J.tree === t)) offer(Math.max(0.1, dist(P.x, P.z, t.x, t.z) - TREE_DIM[t.kind].r * natS(t)), 2.6, `Chop down the ${t.kind}`, () => natureStartJob('chop', t));
  // the nearest log and pile
  let lb = null, ld = 2.4;
  for (const o of NATURE.felled) {
    if (!o.log || !o.fall || !o.fall.done) continue;
    const D = TREE_DIM[o.kind], len = D.trunk * natS(o);
    const ox = P.x - o.x, oz = P.z - o.z, along = clamp(ox * o.fall.ux + oz * o.fall.uz, 0.5, len + 0.5);
    const d = Math.hypot(ox - o.fall.ux * along, oz - o.fall.uz * along) - D.r * natS(o);
    if (d < ld) { ld = d; lb = o; }
  }
  if (lb && !(J && J.tree === lb)) offer(Math.max(0.1, ld), 2.4, 'Cut the log into firewood', () => natureStartJob('split', lb));
  for (const p of NATURE.piles) {
    if (p.lit || p.gone) continue;
    offer(dist(P.x, P.z, p.x, p.z), 2.6, 'Light a campfire', () => natureLightPile(p), 0.1);
  }
}
function natureStartJob(kind, t) {
  const P = GAME.player;
  if (!P || !P.alive) return;
  if (P.mount) dismount(P);
  let tx = t.x, tz = t.z;
  if (kind === 'split') {
    // stand beside the log: work at the nearest point along it
    const len = TREE_DIM[t.kind].trunk * natS(t);
    const along = clamp((P.x - t.x) * t.fall.ux + (P.z - t.z) * t.fall.uz, 0.8, len);
    tx = t.x + t.fall.ux * along; tz = t.z + t.fall.uz * along;
  }
  const yaw = Math.atan2(tx - P.x, tz - P.z);
  const need = kind === 'chop' ? 3 + Math.round(natS(t) * 2 + (t.kind === 'oak' ? 1 : 0)) : 3;
  NATURE.job = { kind, tree: t, px: P.x, pz: P.z, yaw, t: 0, next: 0.15, hitAt: 0, swings: 0, need, tx, tz };
  P.yaw = yaw; P.target = null;
  if (kind === 'chop') { natTake(t); t.notchYaw = yaw + Math.PI; }
  uiToast(kind === 'chop' ? `Chopping the ${t.kind}. Move to stop.` : 'Cutting the log into firewood. Move to stop.', 'hint');
}
function natureStopJob(msg) {
  NATURE.job = null;
  if (msg) uiLog(msg, 'sys');
}
function stepJob(dt) {
  const J = NATURE.job;
  if (!J) return;
  const P = GAME.player, t = J.tree;
  if (!P || !P.alive || P.casting || P.mount || P.motion || dist(P.x, P.z, J.px, J.pz) > 0.3) { natureStopJob(P && P.alive ? 'You stop working.' : null); return; }
  if ((J.kind === 'chop' && t.felled) || (J.kind === 'split' && !t.log)) { natureStopJob(null); return; }
  J.t += dt;
  P.yaw = J.yaw;
  if (J.t >= J.next && !J.hitAt) {
    J.next = J.t + 0.95;
    setAct(P, 1, 0.62);
    J.hitAt = J.t + 0.3;
    sfx('swing');
  }
  if (J.hitAt && J.t >= J.hitAt) {
    J.hitAt = 0;
    J.swings++;
    const D = TREE_DIM[t.kind];
    const ux = Math.sin(J.yaw), uz = Math.cos(J.yaw);
    if (J.kind === 'chop') {
      t.notch = J.swings / J.need;
      t.shake = Math.min(1, t.shake + 0.45);
      natChips(J.tx - ux * D.r * natS(t), t.y + D.cut * natS(t) + 0.15, J.tz - uz * D.r * natS(t), -ux, -uz, 12);
      natSfx('chop', t.x, t.z);
      if (t.leaf > 0.3 && Math.random() < 0.6) natLeafFall(t, 4);
      if (J.swings >= J.need) {
        // the last blow: it goes over away from the axe
        t.notch = 1;
        fellTree(t, t.x - P.x, t.z - P.z, 30, true);
        natureStopJob(null);
        P.yaw = J.yaw;
      }
    } else {
      natChips(J.tx, heightAt(J.tx, J.tz) + D.r * natS(t) * 2, J.tz, -ux, -uz, 10);
      natSfx('split', J.tx, J.tz);
      if (J.swings >= J.need) {
        // the log is gone; a stack of split wood is left by the stump
        const len = TREE_DIM[t.kind].trunk * natS(t);
        const px = t.x + t.fall.ux * Math.min(len * 0.5 + 0.6, 2.4), pz = t.z + t.fall.uz * Math.min(len * 0.5 + 0.6, 2.4);
        natRemoveLog(t);
        t.leaf = 0;
        natAddPile(px, pz, Math.atan2(t.fall.uz, -t.fall.ux), t.kind);
        natureStopJob('You split the log into firewood.');
      }
    }
  }
}
function natAddPile(x, z, yaw, kind) {
  if (NATURE.piles.length >= NAT_CAP.piles) { const old = NATURE.piles.shift(); if (old.coll) old.coll.active = false; }
  const p = { x, z, y: heightAt(x, z), yaw, kind: kind === 'birch' ? 1 : kind === 'pine' ? 2 : 0, lit: false, char: 0, seed: Math.random(), born: GAME.t };
  p.coll = addCircle(x, z, 0.55, 'prop', 0.7);
  NATURE.piles.push(p);
  return p;
}
function natureLightPile(p) {
  if (p.lit) return;
  if (natDry() < 0.25) { uiError('The wood is too wet to light.'); return; }
  p.lit = true; p.litAt = GAME.t; p.until = GAME.t + 240;
  addFire(p.x, p.y + 0.35, p.z, 0.85, false, p.until, { r: 9, k: 1 });
  // a ring of scorched ground under the fire, but a campfire is tended: it does not spread
  const i0 = natCell(p.x - 1.4), i1 = natCell(p.x + 1.4), j0 = natCell(p.z - 1.4), j1 = natCell(p.z + 1.4);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const q = Math.hypot(i - 511.5 - p.x, j - 511.5 - p.z) / 1.4; if (q < 1) { const o = natIdx(i, j) * 4; NAT.data[o + 1] = Math.max(NAT.data[o + 1], Math.round(255 * (1 - q * q))); } }
  natTouchRect(i0, j0, i1, j1);
  natMark(i0, j0, i1, j1);
  sfx('ignite');
  uiLog('You light a campfire.', 'sys');
}
function stepPiles(dt) {
  for (let i = NATURE.piles.length - 1; i >= 0; i--) {
    const p = NATURE.piles[i];
    if (p.lit) {
      p.char = clamp((GAME.t - p.litAt) / 200, 0, 1);
      if (GAME.t > p.until) { if (p.coll) p.coll.active = false; NATURE.piles.splice(i, 1); }
    } else if (GAME.t - p.born > 900 / NATURE.speed) { if (p.coll) p.coll.active = false; NATURE.piles.splice(i, 1); }
  }
}

/* ------------------------------------------------------------------ */
/* Per step and per frame                                              */
/* ------------------------------------------------------------------ */
function updateNature(dt) {
  if (!NATURE.built) return;
  stepJob(dt);
  for (let i = NATURE.dyn.length - 1; i >= 0; i--) { const t = NATURE.dyn[i]; if (t) stepTree(t, dt); }
  stepFelled(dt);
  stepGrassFire(dt);
  stepFireHarm(dt);
  stepHouseFires(dt);
  stepRegrow(dt);
  stepCraters(dt);
  stepPiles(dt);
}
const _natQ2 = new THREE.Quaternion(), _natFlip = new THREE.Quaternion(1, 0, 0, 0);
function natFallQuat(t, out) {
  const F = t.fall;
  if (!F) return out.set(0, 0, 0, 1);
  _natAx.set(F.uz, 0, -F.ux);
  return out.setFromAxisAngle(_natAx, F.ang);
}
// fill the instance buffers of the nature sets and draw the flames
function drawNature(dt) {
  if (!NATURE.built) return;
  const camX = camera.position.x, camZ = camera.position.z;
  const maxD = (quality.treeDist || 300) + 20;
  const kinds = NATURE.sets;
  for (const k of Object.keys(TREE_KINDS)) { kinds[k].full.n = 0; kinds[k].bark.n = 0; }
  const ends = kinds.ends;
  ends.n = 0;
  const flameBudget = quality.level === 'high' ? 1 : quality.level === 'medium' ? 0.6 : 0.35;
  const burning = [];
  for (const t of NATURE.dyn) {
    const d2 = (t.x - camX) ** 2 + (t.z - camZ) ** 2;
    if (d2 > maxD * maxD) continue;
    const D = TREE_DIM[t.kind], s = natS(t), F = t.fall;
    const set = t.leaf > 0.02 && kinds[t.kind].full.n < kinds[t.kind].full.cap ? kinds[t.kind].full : kinds[t.kind].bark;
    if (set.n >= set.cap) continue;
    const n = set.n++;
    const A = set.attrs;
    natFallQuat(t, _natQ);
    let ox = 0, oy = 0, oz = 0;
    if (F && F.done) { const e = smooth(F.drop); ox = F.ux * 0.45 * e; oz = F.uz * 0.45 * e; oy = -(D.cut * s - D.r * s * 0.9) * e - (t.rot2 || 0) * D.r * s * 1.6; }
    A.iPos.array.set([t.x + ox, t.y - 0.15 + oy, t.z + oz, s], n * 4);
    A.iRot.array.set([t.rot, t.tint], n * 2);
    A.iFall.array.set([_natQ.x, _natQ.y, _natQ.z, _natQ.w], n * 4);
    A.iSt.array.set([t.felled ? D.cut : 0, t.char, t.leaf, t.fire], n * 4);
    // the notch faces the axe: its direction in the tree's own frame
    const ny = t.notchYaw ?? 0, wx = Math.sin(ny), wz = Math.cos(ny), c = Math.cos(t.rot), sn = Math.sin(t.rot);
    // standing: the notch (amount, direction, height); felled: the trunk radius at the cut
    A.iFx.array.set([t.shake, t.felled ? 0 : t.notch, Math.atan2(wx * c - wz * sn, wx * sn + wz * c), t.felled ? D.r * 0.98 : D.cut], n * 4);
    if (t.felled && F && ends.n < ends.cap) {
      // the cut end of the trunk, turned with it
      const e = ends.n++, EA = ends.attrs;
      const q = _natQ2.copy(_natQ).multiply(_natFlip);
      const py = t.y - 0.15 + oy + D.cut * s;
      EA.iP.array.set([t.x + ox, py, t.z + oz, 1], e * 4);
      EA.iQ.array.set([q.x, q.y, q.z, q.w], e * 4);
      EA.iSc.array.set([D.r * s * 0.98, 1, D.r * s * 0.98, t.fire * 0.6], e * 4);
      EA.iW.array.set([t.char, t.chopped ? 0 : 1, (t.i % 97) / 97, t.kind === 'birch' ? 1 : t.kind === 'pine' ? 2 : 0], e * 4);
    }
    if (t.fire > 0.05 && d2 < 110 * 110) burning.push(t);
  }
  for (const k of Object.keys(TREE_KINDS)) for (const S of [kinds[k].full, kinds[k].bark]) {
    S.geo.instanceCount = S.n;
    for (const a of Object.values(S.attrs)) a.needsUpdate = true;
  }
  // stumps
  const st = kinds.stump;
  st.n = 0;
  for (const t of NATURE.felled) {
    if (st.n >= st.cap) break;
    if ((t.x - camX) ** 2 + (t.z - camZ) ** 2 > maxD * maxD) continue;
    const D = TREE_DIM[t.kind], s = natS(t), n = st.n++, A = st.attrs;
    A.iP.array.set([t.x, t.y - 0.15, t.z, 1], n * 4);
    _natQ.setFromAxisAngle(_natAx.set(0, 1, 0), t.rot);
    A.iQ.array.set([_natQ.x, _natQ.y, _natQ.z, _natQ.w], n * 4);
    A.iSc.array.set([D.r * s * 1.05, D.cut * s, D.r * s * 1.05, t.fire * 0.4], n * 4);
    // fresh wood greys as the stump weathers (a negative char)
    const age = clamp((GAME.t - t.felledAt) * NATURE.speed / 600, 0, 0.7);
    A.iW.array.set([t.char > 0.3 ? t.char : -age, t.chopped ? 0 : 1, (t.i % 97) / 97, t.kind === 'birch' ? 1 : t.kind === 'pine' ? 2 : 0], n * 4);
  }
  st.geo.instanceCount = st.n;
  for (const a of Object.values(st.attrs)) a.needsUpdate = true;
  ends.geo.instanceCount = ends.n;
  for (const a of Object.values(ends.attrs)) a.needsUpdate = true;
  // firewood
  const pl = kinds.pile;
  pl.n = 0;
  for (const p of NATURE.piles) {
    if (pl.n >= pl.cap) break;
    const n = pl.n++, A = pl.attrs;
    A.iP.array.set([p.x, p.y, p.z, 1], n * 4);
    _natQ.setFromAxisAngle(_natAx.set(0, 1, 0), p.yaw);
    A.iQ.array.set([_natQ.x, _natQ.y, _natQ.z, _natQ.w], n * 4);
    A.iSc.array.set([1, 1, 1, p.lit ? 0.5 + 0.5 * (1 - p.char) : 0], n * 4);
    A.iW.array.set([p.lit ? p.char : 0, 0, p.seed, p.kind], n * 4);
  }
  pl.geo.instanceCount = pl.n;
  for (const a of Object.values(pl.attrs)) a.needsUpdate = true;
  // flames, smoke and embers: burning crowns and the grass fire near the camera
  const E = NATURE.emit;
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  for (const t of burning) {
    const D = TREE_DIM[t.kind], s = natS(t), F = t.fall;
    natFallQuat(t, _natQ);
    t.flameAcc = (t.flameAcc || 0) + dt * 70 * t.fire * flameBudget;
    while (t.flameAcc >= 1) {
      t.flameAcc -= 1;
      // a point in the crown or on the trunk, turned with the tree if it has fallen
      const inCrown = Math.random() < (t.leaf > 0.05 ? 0.75 : 0.35);
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * (inCrown ? D.crown * s * 0.8 : D.r * s);
      const ly = inCrown ? D.crownY * s + (Math.random() - 0.5) * D.crown * s : Math.random() * D.trunk * s;
      _natAx.set(Math.cos(a) * rr, (t.felled ? Math.max(ly, D.cut * s) : ly) - (t.felled ? D.cut * s : 0), Math.sin(a) * rr).applyQuaternion(_natQ);
      const x = t.x + _natAx.x, y = t.y - 0.15 + (t.felled ? D.cut * s : 0) + _natAx.y, z = t.z + _natAx.z;
      const k = 0.7 + Math.random() * 0.5;
      fxAdd.emit(x, y, z, (Math.random() - 0.5) * 0.4 + U.uWindDir.value.x * 0.5, 1.3 + Math.random() * 1.4, (Math.random() - 0.5) * 0.4 + U.uWindDir.value.y * 0.5,
        0.45 + Math.random() * 0.35, FIRE_COL[0] * k, FIRE_COL[1] * k, FIRE_COL[2] * k, (0.32 + Math.random() * 0.3) * (inCrown ? 1.3 : 0.8), -1.4, 0.5);
      if (Math.random() < 0.08) fxAdd.emit(x, y + 0.5, z, (Math.random() - 0.5) * 1.4, 2 + Math.random() * 2, (Math.random() - 0.5) * 1.4, 1.6 + Math.random(), 2.6, 1.1, 0.3, 0.05, -0.3, 0.3);
      if (Math.random() < 0.12) {
        const g = 0.25 + Math.random() * 0.1;
        fxAlpha.emit(x, y + 1, z, U.uWindDir.value.x * 0.6, 0.9 + Math.random() * 0.4, U.uWindDir.value.y * 0.6, 5 + Math.random() * 3, (A.x * 0.7 + Lc.x * 0.2) * g, (A.y * 0.7 + Lc.y * 0.2) * g, (A.z * 0.7 + Lc.z * 0.2) * g, -(1.2 + Math.random() * 0.6), -0.05, 0.1);
      }
    }
    glowPush(t.x + (F ? F.ux * D.trunk * s * 0.5 * Math.sin(F.ang) : 0), t.y + D.crownY * s * (F ? Math.cos(F.ang) * 0.7 + 0.15 : 1), t.z + (F ? F.uz * D.trunk * s * 0.5 * Math.sin(F.ang) : 0), 2.4 * t.fire, 1.0 * t.fire, 0.3 * t.fire, D.crown * s * 2.2);
    if (t.leaf > 0.05 && Math.random() < dt * 6) natLeafFall(t, 1);
    if (Math.random() < dt * 2) natSfx('crackle', t.x, t.z);
  }
  const list = NATURE.fireList;
  if (list.length) {
    E.flame += dt * 900 * flameBudget;
    E.smoke += dt * 45 * flameBudget;
    E.ember += dt * 50 * flameBudget;
    let tries = 0;
    while (E.flame >= 1 && tries++ < 400) {
      const c = list[Math.floor(Math.random() * list.length)];
      const x = c.i - 512 + Math.random(), z = c.j - 512 + Math.random();
      if ((x - camX) ** 2 + (z - camZ) ** 2 > 85 * 85) { E.flame -= 0.25; continue; }
      E.flame -= 1;
      const o = (c.j * NAT.res + c.i) * 4, b = NAT.data[o + 2] / 255;
      if (b < 0.2) continue;
      const k = (0.6 + Math.random() * 0.5) * b;
      fxAdd.emit(x, heightAt(x, z) + 0.05, z, (Math.random() - 0.5) * 0.3 + U.uWindDir.value.x * 0.6, 0.8 + Math.random() * 1.1, (Math.random() - 0.5) * 0.3 + U.uWindDir.value.y * 0.6,
        0.35 + Math.random() * 0.3, FIRE_COL[0] * k, FIRE_COL[1] * k, FIRE_COL[2] * k, 0.2 + Math.random() * 0.25 * c.f, -1.2, 0.6);
      if (E.ember >= 1) { E.ember -= 1; fxAdd.emit(x, heightAt(x, z) + 0.4, z, (Math.random() - 0.5) * 1.2, 1.4 + Math.random() * 1.6, (Math.random() - 0.5) * 1.2, 1.3 + Math.random() * 0.8, 2.6, 1.1, 0.3, 0.045, -0.35, 0.3); }
      if (E.smoke >= 1) {
        E.smoke -= 1;
        const g = 0.22 + Math.random() * 0.1;
        fxAlpha.emit(x, heightAt(x, z) + 0.8, z, U.uWindDir.value.x * 0.8, 0.7 + Math.random() * 0.4, U.uWindDir.value.y * 0.8, 5 + Math.random() * 3, (A.x * 0.7 + Lc.x * 0.2) * g, (A.y * 0.7 + Lc.y * 0.2) * g, (A.z * 0.7 + Lc.z * 0.2) * g, -(1.1 + Math.random() * 0.6), -0.05, 0.1);
      }
    }
    E.flame = Math.min(E.flame, 40); E.smoke = Math.min(E.smoke, 4); E.ember = Math.min(E.ember, 4);
    if (Math.random() < dt * 3) { const c = list[Math.floor(Math.random() * list.length)]; natSfx('crackle', c.i - 512, c.j - 512); }
  } else { E.flame = 0; E.smoke = 0; E.ember = 0; }
  natLights(burning, dt);
  natFlush();
}
// a few real lights follow the nearest flames (they go through FIRES so gatherLights picks them up)
function natLights(burning, dt) {
  const C = NATURE.clock;
  C.lights -= dt;
  const L = NATURE.lights;
  const want = [];
  if (C.lights <= 0) {
    C.lights = 0.4;
    const camX = camera.position.x, camZ = camera.position.z;
    const cands = [];
    for (const t of burning) cands.push({ x: t.x, z: t.z, y: t.y + TREE_DIM[t.kind].crownY * natS(t) * (t.fall ? 0.3 : 0.8), s: 1.4 * t.fire, d: Math.hypot(t.x - camX, t.z - camZ) });
    const list = NATURE.fireList;
    for (let k = 0; k < Math.min(list.length, 160); k++) {
      const c = list[Math.floor(Math.random() * list.length)], x = c.i - 511.5, z = c.j - 511.5;
      cands.push({ x, z, y: heightAt(x, z) + 0.6, s: 0.9, d: Math.hypot(x - camX, z - camZ) });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const c of cands) {
      if (want.length >= 4 || c.d > 90) break;
      if (want.some((w) => dist2(w.x, w.z, c.x, c.z) < 9 * 9)) continue;
      want.push(c);
    }
    // move the lights we own onto the chosen flames
    for (let k = 0; k < Math.max(want.length, L.length); k++) {
      const w = want[k];
      let f = L[k];
      if (!w) { if (f) f.until = GAME.t - 1; continue; }
      if (!f || f.until < GAME.t) {
        f = { x: w.x, y: w.y, z: w.z, size: 0.01, ghost: false, acc: 0, smokeAcc: 0, emberAcc: 0, seed: Math.random() * 100, until: GAME.t + 1, born: renderTime, lightR: 11, lightK: 1.25, nature: true };
        FIRES.push(f);
        L[k] = f;
      }
      f.x = w.x; f.y = w.y; f.z = w.z; f.until = GAME.t + 1.2; f.lightK = 1.1 * Math.min(1.4, w.s);
    }
    for (let k = L.length - 1; k >= 0; k--) if (L[k].until < GAME.t) L.splice(k, 1);
  }
}

/* ---- debug and test hooks ---- */
const NATURE_DEBUG = {
  NATURE, NAT, TREE_DIM, igniteTree, igniteGrass, natureStrike, natureCut, natureSwing, natureCrater, natureImpact, natureBlowArea, fellTree, treeBlow, nearestTree, natureStartJob, natureLightPile,
  cutAt: (x, z) => natGet(x, z, 0), burntAt: (x, z) => natGet(x, z, 1), fireAt: (x, z) => natGet(x, z, 2), earthAt: (x, z) => natGet(x, z, 3),
  fires: () => NATURE.fire.size,
  tree: (i) => { const t = W.trees[i]; return t && { i: t.i, kind: t.kind, x: t.x, z: t.z, y: t.y, state: t.state, felled: !!t.felled, log: !!t.log, fire: t.fire, char: t.char, leaf: t.leaf, grow: t.grow, s: t.s, fall: t.fall && { ang: t.fall.ang, stop: t.fall.stop, done: t.fall.done, ux: t.fall.ux, uz: t.fall.uz }, coll: t.coll && { tag: t.coll.tag, r: t.coll.r, h: t.coll.h, active: t.coll.active }, logColl: t.logColl && { hx: t.logColl.hx, hz: t.logColl.hz, active: t.logColl.active, x: t.logColl.x, z: t.logColl.z } }; },
};
