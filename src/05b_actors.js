/* ================================================================== */
/* actors: instanced, vertex-animated humanoids and beasts; particles  */
/* ================================================================== */
/* ------------------------------------------------------------------ */
/* Instanced crowds                                                    */
/* ------------------------------------------------------------------ */
class Crowd {
  constructor(geo, material, max, attrs = ['iPos', 'iAnim', 'iColA', 'iColB', 'iMisc']) {
    this.max = max;
    this.geo = geo;
    this.names = attrs;
    this.attrs = attrs.map((k) => {
      const a = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage);
      geo.setAttribute(k, a);
      return a;
    });
    geo.instanceCount = 0;
    this.mesh = new THREE.Mesh(geo, material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.userData.keep = true;
    this.n = 0;
    scene.add(this.mesh);
  }
  begin() { this.n = 0; }
  push(...vals) {
    if (this.n >= this.max) return;
    const k = this.n * 4;
    for (let i = 0; i < this.attrs.length; i++) if (vals[i]) this.attrs[i].array.set(vals[i], k);
    this.n++;
  }
  end() {
    this.geo.instanceCount = this.n;
    for (const a of this.attrs) {
      a.clearUpdateRanges();
      if (this.n) a.addUpdateRange(0, this.n * 4);
      a.needsUpdate = true;
    }
  }
}
const BEAST_ATTRS = ['iPos', 'iAnim', 'iColA', 'iColB'];
const HUMAN_ATTRS = ['iPos', 'iAnim', 'iColA', 'iColB', 'iMisc', 'iStyle', 'iWear']; // iWear: feature/weather (05h_wear.js)
let crowdHuman, crowdHumanLo;
const crowdBeast = {};
function buildCrowds() {
  crowdHuman = new Crowd(buildHumanoid(0), humanoidMat, 72, HUMAN_ATTRS);
  crowdHumanLo = new Crowd(buildHumanoid(1), humanoidMat, 380, HUMAN_ATTRS);
  const hd = depthFrom(humanoidMat, DEPTH_FS, humanVS(true));
  shadowCaster(crowdHuman.mesh, hd);
  shadowCaster(crowdHumanLo.mesh, hd);
  for (const [kind, n] of [['wolf', 80], ['boar', 64], ['bear', 40], ['deer', 48], ['stag', 16], ['horse', 40]]) {
    const m = shareMat(beastMat, beastUniforms(kind));
    crowdBeast[kind] = [new Crowd(buildBeast(kind, 0), m, Math.ceil(n * 0.4), BEAST_ATTRS), new Crowd(buildBeast(kind, 1), m, n, BEAST_ATTRS)];
    const bd = depthFrom(m, DEPTH_FS, beastVS(true));
    for (const c of crowdBeast[kind]) shadowCaster(c.mesh, bd);
  }
}

/* ------------------------------------------------------------------ */
/* Particles (GPU-integrated ring buffers)                             */
/* ------------------------------------------------------------------ */
class Particles {
  constructor(max, additive) {
    this.max = max; this.head = 0;
    const g = new THREE.BufferGeometry();
    this.a0 = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // pos, birth
    this.a1 = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // vel, life
    this.a2 = new THREE.BufferAttribute(new Float32Array(max * 4), 4).setUsage(THREE.DynamicDrawUsage); // rgb, size
    this.a3 = new THREE.BufferAttribute(new Float32Array(max * 2), 2).setUsage(THREE.DynamicDrawUsage); // gravity, drag
    for (let i = 0; i < max; i++) this.a1.array[i * 4 + 3] = -1;
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(max * 3), 3));
    g.setAttribute('aP', this.a0); g.setAttribute('aV', this.a1); g.setAttribute('aC', this.a2); g.setAttribute('aG', this.a3);
    this.dirty0 = max; this.dirty1 = -1;
    this.mesh = new THREE.Points(g, new THREE.ShaderMaterial({
      uniforms: { uTime: U.uTime, uFocal: { value: 600 }, uMaxPoint: { value: MAX_POINT }, uFogDensity: U.uFogDensity },
      transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      vertexShader: /* glsl */`
        uniform float uTime, uFocal, uMaxPoint, uFogDensity;
        attribute vec4 aP; attribute vec4 aV; attribute vec4 aC; attribute vec2 aG;
        varying vec4 vC; varying float vFade; varying vec2 vAge; // visual pass: age (0..1) and a seed for the puff shape
        void main(){
          float t = uTime - aP.w;
          vC = aC; vFade = 0.0; vAge = vec2(0.0);
          bool smoke = aC.w < 0.0;
          if (aV.w <= 0.0 || t < 0.0 || t > aV.w) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); gl_PointSize = 0.0; return; }
          float k = t / aV.w;
          vAge = vec2(k, fract(aP.w * 7.13 + aP.x * 0.37 + aP.z * 0.61));
          float drag = exp(-aG.y * t);
          vec3 p = aP.xyz + aV.xyz * (aG.y > 0.0 ? (1.0 - drag) / aG.y : t) + vec3(0.0, -0.5 * aG.x * t * t, 0.0);
          vec4 mv = viewMatrix * vec4(p, 1.0);
          // smoke (negative size) swells and fades in slowly; sparks shrink
          float sz = abs(aC.w) * (smoke ? 0.35 + 1.9 * k : 1.0 - k * 0.5) * uFocal / max(-mv.z, 0.1);
          gl_PointSize = clamp(sz, 0.0, uMaxPoint);
          vFade = (1.0 - k) * (1.0 - k) * min(1.0, t * (smoke ? 1.1 : 12.0)) * (smoke ? 0.34 : 1.0);
          vFade *= exp(-max(-mv.z, 0.0) * uFogDensity * 0.8);
          gl_Position = projectionMatrix * mv;
        }`,
      fragmentShader: /* glsl */`
        varying vec4 vC; varying float vFade; varying vec2 vAge;
        void main(){
          // visual pass: ragged puffs rather than perfect discs, each turned its own way
          vec2 pc = gl_PointCoord - 0.5;
          float ang = atan(pc.y, pc.x) + vAge.y * 6.2831;
          float lobe = 0.12 * sin(ang * 3.0 + vAge.y * 9.0) + 0.07 * sin(ang * 5.0 - vAge.y * 13.0);
          float r = length(pc) * 2.0 * (1.0 + lobe * (${additive ? '0.6' : '1.0'}));
          float a = (1.0 - smoothstep(0.2, 1.0, r)) * vFade;
          if (a <= 0.001) discard;
          vec3 c = clamp(vC.rgb, 0.0, 6.0);
          ${additive ? `// flames burn white-yellow at the heart and cool to orange and red as they rise (warm colours only)
          float warm = clamp((c.r - c.b) / max(c.r, 1e-3) - 0.25, 0.0, 1.0);
          c *= mix(vec3(1.0), mix(vec3(1.2, 1.12, 1.0), vec3(1.0, 0.5, 0.28), smoothstep(0.1, 0.9, vAge.x)), warm);
          c *= 1.0 + 0.5 * warm * (1.0 - smoothstep(0.0, 0.5, r));` : `// smoke: lighter on its upper side, a little thicker in the middle
          c *= 0.9 + 0.22 * clamp(-pc.y * 2.0 + 0.5, 0.0, 1.0);`}
          gl_FragColor = vec4(c * ${additive ? 'a' : '1.0'}, ${additive ? '1.0' : 'a'});
        }`,
    }));
    this.mesh.frustumCulled = false;
    this.mesh.userData.keep = true;
    this.mesh.renderOrder = additive ? 9 : 8;
    scene.add(this.mesh);
  }
  emit(x, y, z, vx, vy, vz, life, r, g, b, size, gravity = 0, drag = 0) {
    if (!isFiniteNum(x + y + z + vx + vy + vz)) return;
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    this.a0.array.set([x, y, z, U.uTime.value], i * 4);
    this.a1.array.set([vx, vy, vz, life], i * 4);
    this.a2.array.set([r, g, b, size], i * 4);
    this.a3.array.set([gravity, drag], i * 2);
    if (i < this.dirty0) this.dirty0 = i;
    if (i > this.dirty1) this.dirty1 = i;
  }
  flush() {
    if (this.dirty1 < this.dirty0) return;
    const c = this.dirty1 - this.dirty0 + 1;
    for (const [a, n] of [[this.a0, 4], [this.a1, 4], [this.a2, 4], [this.a3, 2]]) {
      a.clearUpdateRanges();
      a.addUpdateRange(this.dirty0 * n, c * n);
      a.needsUpdate = true;
    }
    this.dirty0 = this.max; this.dirty1 = -1;
  }
}
let fxAdd, fxAlpha;
function buildParticles() {
  fxAdd = new Particles(7000, true);
  fxAlpha = new Particles(2500, false);
}
const FX = {
  burst(x, y, z, n, col, speed = 3, life = 0.6, size = 0.18, gravity = 4, spread = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, e = (Math.random() - 0.3) * Math.PI * 0.6;
      const s = speed * (0.4 + Math.random() * 0.8);
      fxAdd.emit(x, y, z, Math.cos(a) * Math.cos(e) * s * spread, Math.sin(e) * s + speed * 0.3, Math.sin(a) * Math.cos(e) * s * spread, life * (0.6 + Math.random() * 0.6), col[0], col[1], col[2], size * (0.6 + Math.random() * 0.8), gravity, 1.5);
    }
  },
  sparks(x, y, z) { FX.burst(x, y, z, 10, [2.2, 1.6, 0.8], 4, 0.35, 0.09, 9); },
  blood(x, y, z) { for (let i = 0; i < 6; i++) fxAlpha.emit(x, y, z, (Math.random() - 0.5) * 2, Math.random() * 2, (Math.random() - 0.5) * 2, 0.5, 0.35, 0.05, 0.04, 0.09, 9, 1); },
  heal(x, y, z) { for (let i = 0; i < 18; i++) { const a = Math.random() * TAU, r = 0.3 + Math.random() * 0.5; fxAdd.emit(x + Math.cos(a) * r, y + Math.random() * 1.6, z + Math.sin(a) * r, 0, 0.9 + Math.random() * 0.6, 0, 1.0 + Math.random() * 0.4, 0.9, 1.5, 0.6, 0.14, -0.4, 0.5); } },
  levelUp(x, y, z) {
    for (let i = 0; i < 70; i++) { const a = Math.random() * TAU, r = 0.4 + Math.random() * 0.9; fxAdd.emit(x + Math.cos(a) * r, y + Math.random() * 0.4, z + Math.sin(a) * r, Math.cos(a) * 0.3, 2.5 + Math.random() * 3, Math.sin(a) * 0.3, 1.6, 2.4, 1.8, 0.7, 0.2, 0.3, 0.6); }
    FX.ring(x, y + 0.2, z, 1.6, [2.0, 1.5, 0.6], 40);
  },
  ring(x, y, z, r, col, n = 30, speed = 3) { for (let i = 0; i < n; i++) { const a = (i / n) * TAU; fxAdd.emit(x + Math.cos(a) * r * 0.3, y, z + Math.sin(a) * r * 0.3, Math.cos(a) * speed, 0.3, Math.sin(a) * speed, 0.55, col[0], col[1], col[2], 0.2, 0, 2.5); } },
  dust(x, y, z, n = 6, col = [0.45, 0.4, 0.32]) { for (let i = 0; i < n; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.6, y + 0.05, z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 1.2, 0.4 + Math.random() * 0.5, (Math.random() - 0.5) * 1.2, 0.9, col[0], col[1], col[2], 0.35, -0.2, 2.0); },
  splinters(x, y, z) { for (let i = 0; i < 40; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 4, y + Math.random() * 4, z + (Math.random() - 0.5) * 1, (Math.random() - 0.5) * 6, Math.random() * 5, (Math.random() - 0.5) * 6, 1.3, 0.36, 0.25, 0.14, 0.22, 9, 0.5); FX.dust(x, y, z, 20, [0.5, 0.45, 0.38]); },
  trail(x, y, z, col, size = 0.22, life = 0.35) { fxAdd.emit(x, y, z, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.4, life, col[0], col[1], col[2], size, 0, 1); },
  glowAt(x, y, z, col, size = 0.6, life = 0.12) { fxAdd.emit(x, y, z, 0, 0, 0, life, col[0], col[1], col[2], size, 0, 0); },
};

/* arrows: instanced slim boxes oriented along their flight */
const ARROW_MAX = 120;
const arrowGeo = (() => {
  const K = new SkinKit();
  // shaft, nock, a steel bodkin and three vanes
  kitTube(K, [{ c: [0, 0, -0.39], rx: 0.0068, rz: 0.0068 }, { c: [0, 0, 0.0], rx: 0.0075, rz: 0.0075 }, { c: [0, 0, 0.35], rx: 0.0068, rz: 0.0068 }], 6, { cap0: 'dome', front: [0, 1, 0], attr: () => ({ mat: AM.wood }) });
  const head = new THREE.ConeGeometry(0.019, 0.085, 4);
  head.scale(1, 1, 0.38);
  kitGeo(K, head, M4([0, 0, 0.39], [Math.PI / 2, 0, 0]), { mat: AM.steel });
  kitGeo(K, new THREE.CylinderGeometry(0.0095, 0.0085, 0.03, 6), M4([0, 0, 0.345], [Math.PI / 2, 0, 0]), { mat: AM.steel });
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * TAU;
    const vane = new THREE.BufferGeometry();
    // a swept vane, double-sided
    const pts = [[0, 0, -0.36], [0, 0.026, -0.345], [0, 0.022, -0.26], [0, 0, -0.235]];
    const tri = [0, 1, 2, 0, 2, 3, 0, 2, 1, 0, 3, 2];
    const pos = [], nrm = [];
    tri.forEach((i, j) => { pos.push(...pts[i]); nrm.push(j < 6 ? 1 : -1, 0, 0); });
    vane.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    vane.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
    kitGeo(K, vane, M4([Math.sin(a) * 0.006, Math.cos(a) * 0.006, 0], [0, 0, -a]), { mat: AM.fletch });
  }
  const g = K.build();
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(ARROW_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(ARROW_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  return g;
})();
const arrowMesh = new THREE.Mesh(arrowGeo, mat({
  side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    ${GLSL_COMMON}
    attribute vec4 iA; attribute vec4 iB; attribute float aMat;
    varying vec3 vW; varying vec3 vN; varying float vMat;
    void main(){
      vec3 f = safeNormalize(iB.xyz);
      vec3 r = safeNormalize(cross(vec3(0.0, 1.0, 0.0), f));
      if (dot(r, r) < 0.5) r = vec3(1.0, 0.0, 0.0);
      vec3 u = cross(f, r);
      vec3 w = iA.xyz + r * position.x + u * position.y + f * position.z;
      vW = w; vMat = aMat; vN = r * normal.x + u * normal.y + f * normal.z;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    varying vec3 vW; varying vec3 vN; varying float vMat;
    void main(){
      int m = int(vMat + 0.5);
      vec3 n = safeNormalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 alb = m == 6 ? vec3(0.62, 0.64, 0.68) : (m == 24 ? vec3(0.86, 0.84, 0.78) : vec3(0.5, 0.36, 0.2));
      float dif = max(dot(n, uLightDir), 0.0);
      vec3 V = safeNormalize(cameraPosition - vW);
      float spec = m == 6 ? pow(max(dot(n, safeNormalize(uLightDir + V)), 0.0), 40.0) * 1.5 : 0.0;
      vec3 col = alb * (uAmbient * (0.6 + 0.4 * n.y) + uLightColor * dif * 0.8) + uLightColor * spec;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
}));
arrowMesh.frustumCulled = false;
arrowMesh.renderOrder = 4;
arrowMesh.userData.keep = true;
let arrowCount = 0;
function arrowPush(x, y, z, dx, dy, dz) {
  if (arrowCount >= ARROW_MAX) return;
  arrowGeo.attributes.iA.array.set([x, y, z, 0], arrowCount * 4);
  arrowGeo.attributes.iB.array.set([dx, dy, dz, 0], arrowCount * 4);
  arrowCount++;
}
function arrowFlush() {
  arrowGeo.instanceCount = arrowCount;
  arrowGeo.attributes.iA.needsUpdate = true;
  arrowGeo.attributes.iB.needsUpdate = true;
  arrowCount = 0;
}

/* soft glows: wisps, relics, staff gems, portals (additive billboards) */
const GLOW_MAX = 160;
const glowGeo = new THREE.BufferGeometry();
glowGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(GLOW_MAX * 3), 3).setUsage(THREE.DynamicDrawUsage));
glowGeo.setAttribute('aC', new THREE.BufferAttribute(new Float32Array(GLOW_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
glowGeo.setDrawRange(0, 0);
const glowMesh = new THREE.Points(glowGeo, new THREE.ShaderMaterial({
  uniforms: { uFocal: { value: 600 }, uMaxPoint: { value: MAX_POINT }, uTime: U.uTime, uFogDensity: U.uFogDensity },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    uniform float uFocal, uMaxPoint, uTime, uFogDensity; attribute vec4 aC; varying vec4 vC;
    void main(){
      vec4 mv = modelViewMatrix * vec4(position, 1.0);
      vC = aC;
      vC.rgb *= exp(-max(-mv.z, 0.0) * uFogDensity * 0.7);
      gl_PointSize = clamp(aC.w * uFocal / max(-mv.z, 0.1), 0.0, uMaxPoint);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying vec4 vC;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.0, 0.35, r);
      float halo = exp(-r * r * 4.0);
      gl_FragColor = vec4(clamp(vC.rgb, 0.0, 6.0) * (core * 1.2 + halo * 0.6), 1.0);
    }`,
}));
glowMesh.frustumCulled = false;
glowMesh.renderOrder = 9;
glowMesh.userData.keep = true;
let glowCount = 0;
function glowPush(x, y, z, r, g, b, size) {
  if (glowCount >= GLOW_MAX || !isFiniteNum(x + y + z)) return;
  glowGeo.attributes.position.array.set([x, y, z], glowCount * 3);
  glowGeo.attributes.aC.array.set([r, g, b, size], glowCount * 4);
  glowCount++;
}
function glowFlush() {
  glowGeo.setDrawRange(0, glowCount);
  glowGeo.attributes.position.needsUpdate = true;
  glowGeo.attributes.aC.needsUpdate = true;
  glowCount = 0;
}

/* fireflies near the camera at night */
const fireflyMat = new THREE.ShaderMaterial({
  uniforms: { uTime: U.uTime, uNight: U.uNight, uFocal: { value: 600 }, uMaxPoint: { value: MAX_POINT }, uCenter: { value: new THREE.Vector3() } },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  vertexShader: /* glsl */`
    uniform float uTime, uNight, uFocal, uMaxPoint;
    uniform vec3 uCenter;
    attribute vec4 aSeed;
    varying float vAlpha;
    void main(){
      float ph = aSeed.x * 6.2831;
      vec3 p = position;
      // wrap each firefly into a 90 m box around the camera so the swarm follows the player
      vec2 rel2 = mod(p.xz - uCenter.xz + 45.0, 90.0) - 45.0;
      vec3 rel = vec3(rel2.x, 0.0, rel2.y);
      p = vec3(uCenter.x + rel2.x, p.y, uCenter.z + rel2.y);
      p += vec3(sin(uTime * 0.23 * aSeed.y + ph) * aSeed.z, sin(uTime * 0.41 * aSeed.y + ph * 1.7) * 0.3, cos(uTime * 0.19 * aSeed.y + ph * 2.3) * aSeed.z);
      vec4 mv = viewMatrix * vec4(p, 1.0);
      float blink = smoothstep(0.18, 0.85, sin(uTime * (0.55 + aSeed.y * 0.45) + ph * 3.0) * 0.5 + 0.5);
      float sz = aSeed.w * uFocal / max(-mv.z, 0.1);
      vAlpha = blink * smoothstep(0.35, 1.0, uNight) * clamp(sz / 1.2, 0.3, 1.0) * (1.0 - smoothstep(30.0, 45.0, length(rel.xz)));
      gl_PointSize = clamp(sz * 3.0, 2.0, min(uMaxPoint, 64.0));
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying float vAlpha;
    void main(){
      float r = length(gl_PointCoord - 0.5) * 2.0;
      float core = 1.0 - smoothstep(0.22, 0.34, r);
      float halo = exp(-r * r * 5.0);
      gl_FragColor = vec4(clamp(vec3(0.86, 0.97, 0.42) * (core * 2.1 + halo * 0.7) * clamp(vAlpha, 0.0, 1.0), 0.0, 8.0), 1.0);
    }`,
});
let fireflies;
function buildFireflies() {
  const R = mulberry(4242), N = 260;
  const pos = new Float32Array(N * 3), seed = new Float32Array(N * 4);
  for (let i = 0; i < N; i++) {
    pos.set([(R() - 0.5) * 90, 0, (R() - 0.5) * 90], i * 3);
    seed.set([R(), 0.6 + R() * 0.8, 0.4 + R() * 1.4, 0.03 + 0.024 * R() * R()], i * 4);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
  fireflies = new THREE.Points(g, fireflyMat);
  fireflies.frustumCulled = false;
  fireflies.renderOrder = 9;
  scene.add(fireflies);
  scene.add(glowMesh);
  scene.add(arrowMesh);
}
// fireflies need a y per position: we lift them above the terrain on the CPU once per frame for the visible box
function updateFireflies(cx, cz) {
  fireflyMat.uniforms.uCenter.value.set(cx, 0, cz);
  if (U.uNight.value < 0.3 || INDOOR.on) { fireflies.visible = false; return; }
  fireflies.visible = true;
  const p = fireflies.geometry.attributes.position, s = fireflies.geometry.attributes.aSeed;
  for (let i = 0; i < p.count; i++) {
    const relx = ((p.array[i * 3] - cx + 45) % 90 + 90) % 90 - 45, relz = ((p.array[i * 3 + 2] - cz + 45) % 90 + 90) % 90 - 45;
    const x = cx + relx, z = cz + relz;
    const want = heightAt(x, z) + 0.4 + (s.array[i * 4 + 2] - 0.4) * 1.3;
    p.array[i * 3 + 1] = lerp(p.array[i * 3 + 1] || want, want, 0.2);
  }
  p.needsUpdate = true;
}
