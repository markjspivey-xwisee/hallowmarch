/* ================================================================== */
/* spell visuals: lightning, columns of light, marks on the ground      */
/* ================================================================== */
const SPELL = { discs: [], ribbons: [], pillars: [], emitters: [], built: false };

/* ---- marks on the ground: a disc that drapes over the terrain ---- */
const DISC_RINGS = 10, DISC_SEGS = 48, DISC_N = 1 + DISC_RINGS * DISC_SEGS;
const DISC_KIND = { frost: 0, holy: 1, renew: 2, shock: 3, crack: 4, scorch: 5, rune: 6, consecrate: 7, runecut: 8 }; // [classes] rune, consecrate (07b_classes.js); [balance] runecut: the rune's carved strokes
const DISC_MAX = 14;
const discIndex = (() => {
  const idx = [];
  for (let s = 0; s < DISC_SEGS; s++) idx.push(0, 1 + ((s + 1) % DISC_SEGS), 1 + s);
  for (let r = 1; r < DISC_RINGS; r++) for (let s = 0; s < DISC_SEGS; s++) {
    const a = 1 + (r - 1) * DISC_SEGS + s, b = 1 + (r - 1) * DISC_SEGS + ((s + 1) % DISC_SEGS);
    idx.push(a, b, a + DISC_SEGS, b, b + DISC_SEGS, a + DISC_SEGS);
  }
  return idx;
})();
const discLocal = (() => {
  const L = new Float32Array(DISC_N * 2);
  for (let r = 1; r <= DISC_RINGS; r++) for (let s = 0; s < DISC_SEGS; s++) {
    const a = (s / DISC_SEGS) * TAU, rr = r / DISC_RINGS, k = 1 + (r - 1) * DISC_SEGS + s;
    L[k * 2] = Math.cos(a) * rr; L[k * 2 + 1] = Math.sin(a) * rr;
  }
  return L;
})();
const DISC_VS = /* glsl */`
  uniform float uFogDensity;
  attribute vec2 aL;
  varying vec2 vL; varying vec3 vW; varying float vFog;
  void main(){
    vL = aL; vW = position;
    vec4 mv = viewMatrix * vec4(position, 1.0);
    vFog = exp(-max(-mv.z, 0.0) * uFogDensity);
    gl_Position = projectionMatrix * mv;
  }`;
const DISC_FS = (additive) => /* glsl */`
  ${GLSL_COMMON}
  uniform float uTime, uKind, uAge, uDur;
  uniform vec3 uCol;
  varying vec2 vL; varying vec3 vW; varying float vFog;
  float band(float x, float c, float w){ return 1.0 - smoothstep(0.0, w, abs(x - c)); }
  // cell borders of a jittered grid: bright lines like hoarfrost or cracked earth
  // [classes] distance from p to the segment ab (rune strokes)
  float segD(vec2 p, vec2 a, vec2 b){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0); return length(pa - ba * h); }
  // [classes] [balance] a rune's strokes: two rings, a band of nine carved staves and a turning three-armed sigil;
  // w is the stroke's half-width in the band's own units (the glow is drawn wider than the carving)
  float runeGlyph(vec2 l, float r, float ang, float w){
    float ring = band(r, 0.93, 0.03 * w / 0.06) + band(r, 0.62, 0.024 * w / 0.06) * 0.9 + band(r, 0.3, 0.018 * w / 0.06) * 0.7;
    float sec = floor((ang / 6.2832 + 0.5) * 9.0);
    float u = fract((ang / 6.2832 + 0.5) * 9.0), v = (r - 0.66) / 0.24;
    vec2 q = vec2((u - 0.5) * 1.6, v);
    float hsh = hash12(vec2(sec, 3.7)), hs2 = hash12(vec2(sec, 9.1));
    float glyph = segD(q, vec2(0.0, 0.06), vec2(0.0, 0.94));
    glyph = min(glyph, segD(q, vec2(0.0, 0.25 + 0.4 * hsh), vec2(hs2 > 0.5 ? 0.42 : -0.42, 0.1 + 0.5 * hsh)));
    glyph = min(glyph, segD(q, vec2(0.0, 0.7 - 0.3 * hs2), vec2(hsh > 0.4 ? -0.36 : 0.36, 0.92 - 0.2 * hs2)));
    float staves = (1.0 - smoothstep(w, w * 1.7, glyph)) * step(-0.05, v) * step(v, 1.05);
    vec2 c = l / 0.27;
    float sig = 1.0;
    for (int i = 0; i < 3; i++) { float aa = float(i) * 2.0944 + uTime * 0.15; sig = min(sig, segD(c, vec2(0.0), vec2(cos(aa), sin(aa)))); }
    float sigil = (1.0 - smoothstep(w * 1.4, w * 2.4, sig)) * step(r, 0.3);
    return clamp(ring + staves + sigil, 0.0, 1.0);
  }
  float cells(vec2 p){
    vec2 i = floor(p), f = fract(p);
    float d1 = 8.0, d2 = 8.0;
    for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
      vec2 n = vec2(float(x), float(y));
      vec2 o = hash22(i + n);
      float d = length(n + o - f);
      if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
    }
    return 1.0 - smoothstep(0.0, 0.07, d2 - d1);
  }
  void main(){
    float r = length(vL);
    float ang = satan(vL.y, vL.x);
    float env = smoothstep(0.0, 0.12, uAge) * (1.0 - smoothstep(uDur - min(0.7, uDur * 0.4), uDur, uAge));
    float t = clamp(uAge / max(uDur, 0.01), 0.0, 1.0);
    int k = int(uKind + 0.5);
    vec3 col = vec3(0.0); float a = 0.0;
    if (k == 0) {
      // frost: rime spreads out from the middle, crazed with crystal lines, glinting
      float grow = smoothstep(0.0, 0.55, uAge);
      float inside = 1.0 - smoothstep(grow - 0.06, grow, r);
      float lines = cells(vW.xz * 1.7) * 0.8 + cells(vW.xz * 4.3) * 0.35;
      float rime = 0.28 + 0.3 * vnoise(vW.xz * 2.3);
      float rim = band(r, grow - 0.05, 0.06);
      float glint = step(0.986, hash12(floor(vW.xz * 11.0) + floor(uTime * 4.0))) * inside;
      a = inside * (rime + lines * 0.65) + rim * 0.7;
      col = vec3(0.42, 0.66, 1.0) * a + vec3(1.6, 1.8, 2.2) * glint;
    } else if (k == 1) {
      // a circle of light: two rings, a band of turning marks, rays from the middle
      float spin = uTime * 0.35;
      float ring = band(r, 0.94, 0.03) + band(r, 0.7, 0.018) * 0.8;
      float marks = step(0.55, fract((ang / 6.2832) * 40.0 + spin)) * band(r, 0.82, 0.055);
      float rays = spow(0.5 + 0.5 * cos(ang * 10.0 - uTime * 1.4), 10.0) * (1.0 - smoothstep(0.05, 0.92, r)) * 0.7;
      float core = (1.0 - smoothstep(0.0, 0.7, r)) * 0.3;
      a = ring + marks * 0.75 + rays + core;
      col = uCol * a;
    } else if (k == 2) {
      // renewal: a green-gold ring that swells outward, leaving a soft glow behind
      float front = mix(0.15, 1.0, smoothstep(0.0, 0.5, t));
      float ring = band(r, front, 0.07);
      float fill = (1.0 - smoothstep(0.0, front, r)) * 0.18 * (1.0 - t);
      float leafy = smoothstep(0.55, 0.8, vnoise(vW.xz * 1.6 + uTime * 0.3)) * (1.0 - smoothstep(front - 0.1, front, r)) * 0.35;
      a = ring + fill + leafy;
      col = uCol * a;
    } else if (k == 3) {
      // a shockwave racing outward
      float front = smoothstep(0.0, 1.0, sqrt(t));
      a = band(r, front, 0.04 + 0.12 * (1.0 - t)) * (1.0 - t) * 1.4;
      col = uCol * a;
    } else if (k == 4) {
      // cracked, pounded earth where something heavy came down
      float jag = vnoise(vec2(r * 6.0, ang * 3.0)) * 1.6;
      float spokes = 1.0 - smoothstep(0.0, 0.09 + r * 0.04, abs(sin(ang * 4.5 + jag)));
      float web = cells(vW.xz * 2.2) * (1.0 - smoothstep(0.2, 0.6, r));
      float crush = (1.0 - smoothstep(0.0, 0.5, r)) * 0.45;
      a = (crush + (spokes * (1.0 - smoothstep(0.35, 0.95, r)) + web) * 0.75) * (0.75 + 0.25 * vnoise(vW.xz * 5.0));
      col = vec3(0.07, 0.06, 0.05);
    } else if (k == 6) {
      // [classes] a rune laid on the ground: its carved strokes glow (wider than the cut, so they read from afar),
      // breathing, with a faint light in the circle; the dark cut itself is the runecut disc below it
      float pulse = 0.7 + 0.3 * sin(uTime * 2.4 + r * 6.0);
      float g = runeGlyph(vL, r, ang, 0.11);
      float core = runeGlyph(vL, r, ang, 0.05);
      a = (g * 0.55 + core * 0.9) * pulse + (1.0 - smoothstep(0.0, 0.95, r)) * 0.08;
      col = uCol * a;
    } else if (k == 8) {
      // [balance] the rune's strokes cut dark into the ground, so the glyph reads in full daylight
      a = runeGlyph(vL, r, ang, 0.075) * 0.85;
      col = vec3(0.045, 0.04, 0.035);
    } else if (k == 7) {
      // [classes] holy ground: a soft hallowed light, a ring of turning sun-marks, waves of light rising outward
      float spin = uTime * 0.18;
      float fill = (1.0 - smoothstep(0.1, 1.0, r)) * 0.22 + (0.5 + 0.5 * sin(uTime * 1.3)) * 0.05;
      float ring = band(r, 0.95, 0.025) + band(r, 0.83, 0.012) * 0.8;
      float ticks = step(0.6, fract((ang / 6.2832) * 24.0 + spin)) * band(r, 0.89, 0.035);
      float wave = band(r, fract(uTime * 0.35), 0.05) * (1.0 - fract(uTime * 0.35)) * 0.6;
      float star = spow(0.5 + 0.5 * cos(ang * 8.0 - uTime * 0.5), 16.0) * (1.0 - smoothstep(0.05, 0.55, r)) * 0.9;
      float core = (1.0 - smoothstep(0.0, 0.12, r)) * 0.6;
      a = fill + ring + ticks * 0.7 + wave + star + core;
      col = uCol * a;
    } else {
      // scorched ground: soot with a few embers that cool
      float soot = (1.0 - smoothstep(0.2, 1.0, r)) * (0.6 + 0.4 * vnoise(vW.xz * 1.8));
      float ember = step(0.93, hash12(floor(vW.xz * 6.0))) * (1.0 - smoothstep(0.0, 0.7, r)) * (1.0 - t);
      a = soot * 0.8;
      col = mix(vec3(0.05, 0.04, 0.035), vec3(1.6, 0.5, 0.1), ember);
    }
    // soften the outer edge so the disc never shows its rim
    a *= (1.0 - smoothstep(0.92, 1.0, r)) * env;
    ${additive ? 'gl_FragColor = vec4(col * env * (1.0 - smoothstep(0.92, 1.0, r)) * vFog, 1.0);' : 'gl_FragColor = vec4(col, clamp(a * vFog, 0.0, 0.92));'}
    if (a < 0.002) discard;
  }`;
function discMaterial(additive) {
  return new THREE.ShaderMaterial({
    uniforms: { uTime: U.uTime, uFogDensity: U.uFogDensity, uKind: { value: 0 }, uAge: { value: 0 }, uDur: { value: 1 }, uCol: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: DISC_VS, fragmentShader: DISC_FS(additive),
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  });
}
function makeDisc(additive) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(DISC_N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aL', new THREE.BufferAttribute(discLocal, 2));
  g.setIndex(discIndex);
  const m = new THREE.Mesh(g, discMaterial(additive));
  m.frustumCulled = false;
  m.visible = false;
  m.renderOrder = additive ? 9 : 2;
  m.userData.keep = true;
  scene.add(m);
  const d = { mesh: m, additive, age: 0, dur: 0, on: false };
  SPELL.discs.push(d);
  return d;
}
function spellDisc(x, z, r, kind, dur, col = [1, 1, 1], lift = 0.05) {
  if (!SPELL.built || dist2(x, z, camera.position.x, camera.position.z) > 120 * 120) return null;
  const additive = kind !== DISC_KIND.crack && kind !== DISC_KIND.scorch && kind !== DISC_KIND.runecut; // [balance] runecut
  let d = SPELL.discs.find((o) => !o.on && o.additive === additive);
  if (!d) {
    if (SPELL.discs.length < DISC_MAX) d = makeDisc(additive);
    else d = SPELL.discs.filter((o) => o.additive === additive).sort((a, b) => b.age / b.dur - a.age / a.dur)[0];
  }
  if (!d) return null;
  const P = d.mesh.geometry.attributes.position.array;
  for (let i = 0; i < DISC_N; i++) {
    const wx = x + discLocal[i * 2] * r, wz = z + discLocal[i * 2 + 1] * r;
    P[i * 3] = wx; P[i * 3 + 1] = heightAt(wx, wz) + lift; P[i * 3 + 2] = wz;
  }
  d.mesh.geometry.attributes.position.needsUpdate = true;
  const u = d.mesh.material.uniforms;
  u.uKind.value = kind; u.uAge.value = 0; u.uDur.value = dur; u.uCol.value.set(col[0], col[1], col[2]);
  d.age = 0; d.dur = dur; d.on = true; d.mesh.visible = true; d.owner = null; // [balance] whoever holds it sets the owner again
  return d;
}

/* ---- ribbons: bright camera-facing strips along a path (lightning, tracers) ---- */
const RIB_PTS = 33, RIB_MAX = 10;
const RIB_VS = /* glsl */`
  uniform float uFogDensity, uWidth;
  attribute vec3 aNext; attribute float aSide; attribute float aU;
  varying float vS; varying float vU; varying float vFog;
  void main(){
    vec4 mv = viewMatrix * vec4(position, 1.0);
    vec4 mn = viewMatrix * vec4(aNext, 1.0);
    vec3 dir = mn.xyz - mv.xyz;
    if (dot(dir, dir) < 1e-8) dir = vec3(1.0, 0.0, 0.0);
    vec3 side = cross(normalize(dir), normalize(-mv.xyz + vec3(0.0, 0.0, 1e-4)));
    if (dot(side, side) < 1e-8) side = vec3(0.0, 1.0, 0.0);
    float w = uWidth * (0.55 + 0.45 * sin(aU * 3.1416));
    mv.xyz += normalize(side) * aSide * w;
    vS = aSide; vU = aU;
    vFog = exp(-max(-mv.z, 0.0) * uFogDensity * 0.7);
    gl_Position = projectionMatrix * mv;
  }`;
const RIB_FS = /* glsl */`
  uniform vec3 uCol; uniform float uAlpha;
  varying float vS; varying float vU; varying float vFog;
  void main(){
    float core = exp(-vS * vS * 26.0), halo = exp(-vS * vS * 3.2);
    float a = (core * 1.7 + halo * 0.4) * uAlpha * vFog;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uCol * a, 1.0);
  }`;
function makeRibbon() {
  const g = new THREE.BufferGeometry();
  const N = RIB_PTS * 2;
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('aNext', new THREE.BufferAttribute(new Float32Array(N * 3), 3).setUsage(THREE.DynamicDrawUsage));
  const side = new Float32Array(N), uu = new Float32Array(N);
  for (let i = 0; i < RIB_PTS; i++) { side[i * 2] = -1; side[i * 2 + 1] = 1; uu[i * 2] = uu[i * 2 + 1] = i / (RIB_PTS - 1); }
  g.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  g.setAttribute('aU', new THREE.BufferAttribute(uu, 1));
  const idx = [];
  for (let i = 0; i < RIB_PTS - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  g.setIndex(idx);
  const m = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms: { uFogDensity: U.uFogDensity, uWidth: { value: 0.3 }, uCol: { value: new THREE.Vector3(1, 1, 1) }, uAlpha: { value: 0 } },
    vertexShader: RIB_VS, fragmentShader: RIB_FS,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  }));
  m.frustumCulled = false; m.visible = false; m.renderOrder = 10; m.userData.keep = true;
  scene.add(m);
  const r = { mesh: m, on: false, age: 0, life: 0, kind: 'bolt', a: null, b: null, nextJit: 0 };
  SPELL.ribbons.push(r);
  return r;
}
// a jagged path between two points by midpoint displacement: 2^5 + 1 points
function boltPath(a, b, rough = 0.22) {
  let pts = [a.slice(), b.slice()];
  let disp = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]) * rough;
  for (let lvl = 0; lvl < 5; lvl++) {
    const out = [pts[0]];
    for (let i = 0; i < pts.length - 1; i++) {
      const p = pts[i], q = pts[i + 1];
      out.push([(p[0] + q[0]) / 2 + (Math.random() - 0.5) * disp, (p[1] + q[1]) / 2 + (Math.random() - 0.5) * disp * 0.8, (p[2] + q[2]) / 2 + (Math.random() - 0.5) * disp], q);
    }
    pts = out; disp *= 0.52;
  }
  return pts;
}
function straightPath(a, b) {
  const pts = [];
  for (let i = 0; i < RIB_PTS; i++) { const k = i / (RIB_PTS - 1); pts.push([lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k)]); }
  return pts;
}
function setRibbonPath(r, pts) {
  const P = r.mesh.geometry.attributes.position.array, Nx = r.mesh.geometry.attributes.aNext.array;
  for (let i = 0; i < RIB_PTS; i++) {
    const p = pts[Math.min(i, pts.length - 1)];
    const q = i < RIB_PTS - 1 ? pts[Math.min(i + 1, pts.length - 1)] : [p[0] * 2 - pts[i - 1][0], p[1] * 2 - pts[i - 1][1], p[2] * 2 - pts[i - 1][2]];
    for (const j of [0, 1]) { const k = (i * 2 + j) * 3; P[k] = p[0]; P[k + 1] = p[1]; P[k + 2] = p[2]; Nx[k] = q[0]; Nx[k + 1] = q[1]; Nx[k + 2] = q[2]; }
  }
  r.mesh.geometry.attributes.position.needsUpdate = true;
  r.mesh.geometry.attributes.aNext.needsUpdate = true;
}
function spellRibbon(a, b, kind, col, width, life) {
  if (!SPELL.built) return null;
  let r = SPELL.ribbons.find((o) => !o.on);
  if (!r) r = SPELL.ribbons.length < RIB_MAX ? makeRibbon() : SPELL.ribbons.sort((x, y) => y.age - x.age)[0];
  r.on = true; r.age = 0; r.life = life; r.kind = kind; r.a = a; r.b = b; r.nextJit = 0;
  r.mesh.material.uniforms.uCol.value.set(col[0], col[1], col[2]);
  r.mesh.material.uniforms.uWidth.value = width;
  setRibbonPath(r, kind === 'bolt' ? boltPath(a, b) : straightPath(a, b));
  r.mesh.visible = true;
  return r;
}

/* ---- columns of light ---- */
const PILLAR_MAX = 4;
const pillarGeo = (() => { const g = new THREE.CylinderGeometry(1, 1, 1, 36, 1, true); g.translate(0, 0.5, 0); return g; })();
const PILLAR_VS = /* glsl */`
  uniform float uFogDensity;
  varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vFog;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * normal); vUv = uv;
    vec4 mv = viewMatrix * w;
    vFog = exp(-max(-mv.z, 0.0) * uFogDensity * 0.6);
    gl_Position = projectionMatrix * mv;
  }`;
const PILLAR_FS = /* glsl */`
  ${GLSL_COMMON}
  uniform float uTime, uAge, uDur, uCore;
  uniform vec3 uCol;
  varying vec3 vW; varying vec3 vN; varying vec2 vUv; varying float vFog;
  void main(){
    vec3 V = safeNormalize(cameraPosition - vW);
    float facing = abs(dot(safeNormalize(vN), V));
    float body = spow(facing, uCore > 0.5 ? 1.2 : 2.6);
    float h = vUv.y;
    float vfade = (1.0 - smoothstep(0.45, 1.0, h)) * (0.55 + 0.45 * smoothstep(0.0, 0.06, h));
    float bands = 0.72 + 0.28 * sin(h * 46.0 - uTime * 16.0 + vUv.x * 6.2832 * 2.0);
    float motes = step(0.955, hash12(floor(vec2(vUv.x * 42.0, h * 70.0 - uTime * 26.0)))) * body;
    float env = smoothstep(0.0, 0.14, uAge) * (1.0 - smoothstep(uDur - 0.45, uDur, uAge));
    float a = (body * bands * vfade * (uCore > 0.5 ? 1.6 : 0.9) + motes * 0.8 * vfade) * env;
    if (a < 0.003) discard;
    gl_FragColor = vec4(uCol * a * vFog, 1.0);
  }`;
function makePillar() {
  const mk = (core) => {
    const m = new THREE.Mesh(pillarGeo, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uFogDensity: U.uFogDensity, uAge: { value: 0 }, uDur: { value: 1 }, uCore: { value: core ? 1 : 0 }, uCol: { value: new THREE.Vector3(1, 1, 1) } },
      vertexShader: PILLAR_VS, fragmentShader: PILLAR_FS,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    }));
    m.frustumCulled = false; m.visible = false; m.renderOrder = 10; m.userData.keep = true;
    scene.add(m);
    return m;
  };
  const p = { outer: mk(false), core: mk(true), on: false, age: 0, dur: 0, r: 1, h: 20 };
  SPELL.pillars.push(p);
  return p;
}
function spellPillar(x, y, z, r, h, dur, col) {
  if (!SPELL.built) return null;
  let p = SPELL.pillars.find((o) => !o.on);
  if (!p) p = SPELL.pillars.length < PILLAR_MAX ? makePillar() : SPELL.pillars.sort((a, b) => b.age - a.age)[0];
  p.on = true; p.age = 0; p.dur = dur; p.r = r; p.h = h;
  for (const m of [p.outer, p.core]) {
    m.position.set(x, y - 0.3, z);
    m.material.uniforms.uAge.value = 0; m.material.uniforms.uDur.value = dur;
    m.visible = true;
  }
  p.outer.material.uniforms.uCol.value.set(col[0], col[1], col[2]);
  p.core.material.uniforms.uCol.value.set(col[0] * 0.8 + 0.6, col[1] * 0.8 + 0.6, col[2] * 0.8 + 0.6);
  return p;
}

/* ---- emitters: weather made by spells ---- */
function spellEmitter(o) { SPELL.emitters.push({ acc: 0, ...o }); }

function buildSpellFX() {
  if (SPELL.built) return;
  SPELL.built = true;
  // one of each kind up front so their shaders compile with the rest
  makeDisc(true); makeDisc(false); makeRibbon(); makePillar();
}
// show every pool member for the boot-time shader compile
function spellCompileVisible(on) {
  for (const d of SPELL.discs) d.mesh.visible = on || d.on;
  for (const r of SPELL.ribbons) r.mesh.visible = on || r.on;
  for (const p of SPELL.pillars) { p.outer.visible = on || p.on; p.core.visible = on || p.on; }
}

function updateSpellFX(dt) {
  if (!SPELL.built) return;
  for (const d of SPELL.discs) {
    if (!d.on) continue;
    d.age += dt;
    d.mesh.material.uniforms.uAge.value = d.age;
    if (d.age >= d.dur) { d.on = false; d.mesh.visible = false; }
  }
  for (const r of SPELL.ribbons) {
    if (!r.on) continue;
    r.age += dt;
    const k = r.age / r.life;
    if (k >= 1) { r.on = false; r.mesh.visible = false; continue; }
    let alpha = 1 - k;
    if (r.kind === 'bolt') {
      // lightning flickers and re-forks while it lasts
      r.nextJit -= dt;
      if (r.nextJit <= 0) { r.nextJit = 0.045; setRibbonPath(r, boltPath(r.a, r.b)); }
      alpha *= 0.65 + 0.35 * Math.sin(r.age * 90);
    } else alpha = (1 - k) * (1 - k);
    r.mesh.material.uniforms.uAlpha.value = alpha;
  }
  for (const p of SPELL.pillars) {
    if (!p.on) continue;
    p.age += dt;
    if (p.age >= p.dur) { p.on = false; p.outer.visible = false; p.core.visible = false; continue; }
    // the column lands narrow and bright, swells, then thins away
    const open = smooth(clamp(p.age / 0.18, 0, 1)), close = 1 - smooth(clamp((p.age - (p.dur - 0.45)) / 0.45, 0, 1));
    const rr = p.r * (0.25 + 0.75 * open) * (0.35 + 0.65 * close) * (1 + 0.04 * Math.sin(p.age * 30));
    p.outer.scale.set(rr, p.h, rr);
    p.core.scale.set(rr * 0.32, p.h * 1.02, rr * 0.32);
    for (const m of [p.outer, p.core]) m.material.uniforms.uAge.value = p.age;
  }
  for (let i = SPELL.emitters.length - 1; i >= 0; i--) {
    const em = SPELL.emitters[i];
    if (GAME.t >= em.until) { SPELL.emitters.splice(i, 1); continue; }
    if (em.kind === 'blizzard') {
      if (dist2(em.x, em.z, camera.position.x, camera.position.z) > 90 * 90) continue;
      em.acc += dt * (quality.level === 'low' ? 10 : quality.level === 'medium' ? 16 : 24);
      const gy = heightAt(em.x, em.z);
      while (em.acc >= 1) {
        em.acc -= 1;
        // ice shards slant down on the wind
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * em.r;
        const tx = em.x + Math.cos(a) * rr, tz = em.z + Math.sin(a) * rr, ty = heightAt(tx, tz);
        spawnProjectile(em.src, null, 'ice', null, { x: tx, y: ty + 0.1, z: tz }, true, { x: tx - 3, y: gy + 13 + Math.random() * 4, z: tz - 1.5 });
      }
      for (let k = 0; k < 3; k++) {
        const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * em.r * 1.1;
        fxAdd.emit(em.x + Math.cos(a) * rr, gy + 2 + Math.random() * 6, em.z + Math.sin(a) * rr, 1.2 + Math.random(), -2.5 - Math.random() * 2, 0.4, 1.4, 0.9, 1.05, 1.25, 0.09, 0, 0.2);
      }
    }
  }
}
