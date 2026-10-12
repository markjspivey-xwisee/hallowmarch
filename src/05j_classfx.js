/* ================================================================== */
/* the callings' visuals: ice on the water, iron snares, frozen         */
/* bodies, steam, arrows in flight and in the ground, the parry cue     */
/* (the systems themselves are in 07b_classes.js; rune and holy-ground  */
/* marks are disc kinds in 05g_spells.js; guard, parry and kneel are    */
/* actions 10-12 in the body rig, 05a_rig.js)                           */
/* ================================================================== */

/* ---- ice over the water: a sheet that forms where frost falls on a lake or pond, cracked and rimed, and melts ---- */
const ICE_VS = /* glsl */`
  varying vec3 vW; varying vec2 vL;
  void main(){
    vL = position.xy;
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const iceSheetMat = mat({
  transparent: true, depthWrite: true,
  uniforms: { uK: { value: 1 }, uAge: { value: 0 }, uSeed: { value: 0 }, uR: { value: 5 }, uWY: { value: WATER_Y } },
  vertexShader: ICE_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_WORLD}
    ${GLSL_WEATHER}
    uniform float uK, uAge, uSeed, uR, uWY, uWet, uSnowCover; // uWY: the frozen water's surface (ponds and rivers lie at their own heights)
    varying vec3 vW; varying vec2 vL;
    float cellsI(vec2 p){
      vec2 i = floor(p), f = fract(p);
      float d1 = 8.0, d2 = 8.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 n = vec2(float(x), float(y));
        float d = length(n + hash22(i + n) - f);
        if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) d2 = d;
      }
      return 1.0 - smoothstep(0.0, 0.06, d2 - d1);
    }
    void main(){
      float r = length(vL);
      // a ragged, melting edge; the sheet grows out from the middle in its first moments
      float grow = smoothstep(0.0, 0.45, uAge);
      float edge = (0.84 + 0.16 * fbm3(vW.xz * 0.45 + uSeed) - 0.07 * vnoise(vW.xz * 2.3)) * uK * grow;
      if (r > edge) discard;
      float th = terrainHeight(vW.xz);
      if (th > uWY + 0.03) discard;
      float depth = clamp((uWY - th) / 3.0, 0.0, 1.0);
      float rim = smoothstep(edge - 0.16, edge, r);
      // clear dark ice over deep water, white rime in drifts and along the edge, cracks through it all
      float rime = clamp(smoothstep(0.42, 0.85, fbm3(vW.xz * 0.7 + uSeed * 1.7)) * 0.75 + rim * 0.85, 0.0, 1.0);
      // the big cracks between plates, and fine hair-cracks where the noise crosses its middle
      float crack = cellsI(vW.xz * 0.55 + uSeed) * 0.75 + (1.0 - smoothstep(0.0, 0.035, abs(vnoise(vW.xz * 1.7 + uSeed) - 0.5))) * 0.3;
      vec3 deep = mix(vec3(0.3, 0.52, 0.6), vec3(0.08, 0.2, 0.3), depth);
      vec3 alb = mix(deep, vec3(0.82, 0.9, 0.97), rime);
      alb = mix(alb, vec3(0.92, 0.97, 1.0), crack * (0.55 - 0.3 * rime));
      vec3 n = safeNormalize(vec3((vnoise(vW.xz * 3.1) - 0.5) * 0.06, 1.0, (vnoise(vW.xz * 3.1 + 7.0) - 0.5) * 0.06));
      vec3 V = safeNormalize(cameraPosition - vW);
      float sh = shadowAt(vW, n);
      // snow settles on the ice; rain and the thaw leave a film of water on it
      float melt = 1.0 - smoothstep(0.35, 0.75, uK);
      float snow = snowAmount(vW, n, uSnowCover, vec3(0.0));
      alb = mix(alb, snowAlbedo(vW), snow);
      float wet = clamp(max(uWet, melt) * (1.0 - snow), 0.0, 1.0);
      vec3 col = alb * (uAmbient * 0.95 + uLightColor * max(dot(n, uLightDir), 0.0) * sh * 0.85);
      float fres = 0.04 + 0.96 * spow(1.0 - max(dot(n, V), 0.0), 5.0);
      vec3 R = reflect(-V, n);
      col = mix(col, skyBase(safeNormalize(vec3(R.x, max(R.y, 0.03), R.z))) * 0.95, fres * (0.75 - 0.6 * rime) * (1.0 - snow));
      vec3 H = safeNormalize(uLightDir + V);
      col += uLightColor * spow(max(dot(n, H), 0.0), mix(300.0, 60.0, rime)) * mix(1.6, 0.4, rime) * sh;
      col += wetSheen(vW, n, V, wet, 0.0, sh) * 0.8;
      col += vec3(1.4, 1.5, 1.7) * snowSparkle(vW, V, sh) * (rime + snow);
      float a = mix(0.82, 0.97, max(rime, snow)) * (1.0 - 0.45 * melt) * (1.0 - smoothstep(edge - 0.03, edge, r) * 0.5);
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), a);
    }`,
});
let ICE_GEO = null;
function iceSheetMesh(s) {
  if (!ICE_GEO) ICE_GEO = new THREE.CircleGeometry(1, 72);
  const wy = Number.isFinite(s.wy) ? s.wy : WATER_Y;
  const m = new THREE.Mesh(ICE_GEO, shareMat(iceSheetMat, { uK: { value: 1 }, uAge: { value: 0 }, uSeed: { value: Math.random() * 50 }, uR: { value: s.r }, uWY: { value: wy } }));
  m.rotation.x = -Math.PI / 2;
  m.scale.setScalar(s.r * 1.05);
  m.position.set(s.x, wy + 0.05, s.z);
  m.renderOrder = 3;
  m.frustumCulled = false;
  scene.add(m);
  s.mesh = m;
}
function iceSheetRefresh(s) { if (s.mesh) { s.mesh.scale.setScalar(s.r * 1.05); s.mesh.material.uniforms.uR.value = s.r; } }

/* ---- iron snares: a ring with two toothed jaws on a spring, a short chain to a stake ---- */
const SNARE_VS = /* glsl */`
  uniform float uClose;
  attribute float aPart;
  varying vec3 vW; varying vec3 vN; varying float vPart; varying vec3 vO;
  void main(){
    vec3 p = position, n = normal;
    if (aPart > 0.5) {
      // the jaws swing up about the hinge line (local x) to meet over the plate
      float a = uClose * 1.42 * (aPart < 1.5 ? -1.0 : 1.0);
      float c = cos(a), s = sin(a);
      p = vec3(p.x, p.y * c - p.z * s, p.y * s + p.z * c);
      n = vec3(n.x, n.y * c - n.z * s, n.y * s + n.z * c);
    }
    vO = position; vPart = aPart;
    vec4 w = modelMatrix * vec4(p, 1.0);
    vW = w.xyz; vN = normalize(mat3(modelMatrix) * n);
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const snareMat = mat({
  uniforms: { uClose: { value: 0 } },
  vertexShader: SNARE_VS,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_PLIGHT}
    ${GLSL_WEATHER}
    uniform float uWet, uSnowCover;
    varying vec3 vW; varying vec3 vN; varying float vPart; varying vec3 vO;
    void main(){
      vec3 n = safeNormalize(vN);
      if (!gl_FrontFacing) n = -n;
      vec3 V = safeNormalize(cameraPosition - vW);
      float sh = shadowAt(vW, n);
      // dark forged iron, rusted in patches, bright where the teeth were filed
      float rust = smoothstep(0.45, 0.8, fbm3(vO.xz * 22.0 + vO.y * 9.0));
      vec3 alb = mix(vec3(0.16, 0.16, 0.17), vec3(0.34, 0.17, 0.08), rust);
      float metal = 1.0 - rust;
      if (vPart > 2.5) { alb = vec3(0.3, 0.22, 0.14) * (0.8 + 0.3 * vnoise(vO.xy * 40.0)); metal = 0.0; } // the wooden stake
      alb = wetAlbedo(alb, uWet, 0.2);
      float snow = snowAmount(vW, n, uSnowCover, vec3(0.0));
      alb = mix(alb, snowAlbedo(vW), snow);
      float ndl = max(dot(n, uLightDir), 0.0);
      vec3 col = alb * (uAmbient * (0.55 + 0.45 * n.y) + uLightColor * ndl * sh);
      vec3 H = safeNormalize(uLightDir + V);
      col += uLightColor * spow(max(dot(n, H), 0.0), 60.0) * (0.25 + 0.9 * metal) * sh * (1.0 - snow);
      col += alb * pointLights(vW, n);
      col += wetSheen(vW, n, V, uWet, 0.1, sh) * 0.6;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
let SNARE_GEO = null;
function snareGeometry() {
  const parts = [];
  const add = (g, part, m) => { g = g.index ? g.toNonIndexed() : g; if (m) g.applyMatrix4(m); g.deleteAttribute('uv'); const n = g.attributes.position.count; g.setAttribute('aPart', new THREE.Float32BufferAttribute(new Float32Array(n).fill(part), 1)); parts.push(g); };
  const T = (x, y, z, rx = 0, ry = 0, rz = 0, s = 1) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz)), new THREE.Vector3(s, s, s));
  // the base ring and the trigger plate
  add(new THREE.TorusGeometry(0.27, 0.016, 6, 28), 0, T(0, 0.02, 0, Math.PI / 2));
  add(new THREE.CylinderGeometry(0.085, 0.09, 0.014, 14), 0, T(0, 0.018, 0));
  // two leaf springs out to the sides
  for (const sx of [-1, 1]) add(new THREE.BoxGeometry(0.2, 0.012, 0.045), 0, T(sx * 0.37, 0.016, 0, 0, 0, sx * 0.08));
  // the jaws: half rings lying open on either side of the hinge, each with a row of teeth
  for (const [part, side] of [[1, 1], [2, -1]]) {
    add(new THREE.TorusGeometry(0.26, 0.017, 6, 16, Math.PI), part, T(0, 0.024, 0, Math.PI / 2, 0, side > 0 ? 0 : Math.PI));
    for (let i = 1; i < 8; i++) {
      const a = (i / 8) * Math.PI, x = Math.cos(a) * 0.26, z = Math.sin(a) * 0.26 * side;
      // each tooth points inward (and up, once the jaw is closed)
      add(new THREE.ConeGeometry(0.014, 0.06, 5), part, T(x * 0.9, 0.024, z * 0.9).multiply(new THREE.Matrix4().makeRotationY(Math.atan2(x, z))).multiply(new THREE.Matrix4().makeRotationX(-Math.PI / 2)));
    }
  }
  // a short chain to a stake driven into the ground
  for (let i = 0; i < 5; i++) add(new THREE.TorusGeometry(0.03, 0.007, 5, 10), 0, T(0.32 + i * 0.075, 0.025, 0, i % 2 ? Math.PI / 2 : 0, 0, 0));
  add(new THREE.CylinderGeometry(0.022, 0.012, 0.32, 7), 3, T(0.72, 0.06, 0, 0, 0, 0.1));
  // merge
  let n = 0;
  for (const g of parts) n += g.attributes.position.count;
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), A = new Float32Array(n);
  let o = 0;
  for (const g of parts) { P.set(g.attributes.position.array, o * 3); N.set(g.attributes.normal.array, o * 3); A.set(g.attributes.aPart.array, o); o += g.attributes.position.count; }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(P, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  geo.setAttribute('aPart', new THREE.BufferAttribute(A, 1));
  return geo;
}
function snareMesh(S) {
  if (!SNARE_GEO) SNARE_GEO = snareGeometry();
  const m = new THREE.Mesh(SNARE_GEO, shareMat(snareMat, { uClose: { value: 0 } }));
  m.position.set(S.x, S.y, S.z);
  // lie flat on the slope it was set on (on a floor, level)
  const onGround = Math.abs(S.y - heightAt(S.x, S.z)) < 0.05, n = onGround ? normalAt(S.x, S.z) : { x: 0, y: 1, z: 0 };
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), new THREE.Vector3(n.x, n.y, n.z)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), S.yaw));
  m.scale.setScalar(1.25);
  m.frustumCulled = false;
  scene.add(m);
  S.mesh = m;
}

/* ---- a body frozen solid: a shell of faceted ice around it ---- */
const frozenMat = mat({
  transparent: true, depthWrite: false, side: THREE.DoubleSide,
  uniforms: { uFade: { value: 1 } },
  vertexShader: /* glsl */`
    varying vec3 vW; varying vec3 vO;
    void main(){ vO = position; vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    uniform float uFade;
    varying vec3 vW; varying vec3 vO;
    void main(){
      vec3 n = safeNormalize(cross(dFdx(vW), dFdy(vW)));
      vec3 V = safeNormalize(cameraPosition - vW);
      if (dot(n, V) < 0.0) n = -n;
      float fres = spow(1.0 - abs(dot(n, V)), 2.0);
      float crack = smoothstep(0.82, 0.95, vnoise(vO.xy * 9.0 + vO.z * 5.0));
      vec3 H = safeNormalize(uLightDir + V);
      vec3 col = vec3(0.55, 0.75, 0.95) * (uAmbient * 1.2 + uLightColor * 0.35) + uLightColor * spow(max(dot(n, H), 0.0), 80.0) * 1.5;
      col += skyBase(reflect(-V, n)) * fres * 0.6 + vec3(0.9, 0.95, 1.0) * crack * 0.4;
      float a = (0.22 + 0.6 * fres + 0.25 * crack) * uFade;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), clamp(a, 0.0, 0.9));
    }`,
});
const FROZEN_POOL = [];
let FROZEN_GEO = null;

/* ------------------------------------------------------------------ */
/* every frame                                                         */
/* ------------------------------------------------------------------ */
function drawClasses(dt) {
  const camX = camera.position.x, camZ = camera.position.z;
  const lo = quality.level === 'low', near2 = (x, z, r) => dist2(x, z, camX, camZ) < r * r;
  // arrows loosed from a drawn bow, and the ones lying where they fell
  for (const A of CLS.arrows) {
    const sp = Math.hypot(A.vx, A.vy, A.vz) || 1;
    arrowPush(A.x, A.y, A.z, A.vx / sp, A.vy / sp, A.vz / sp);
    if (A.type === 'fire') glowPush(A.x, A.y, A.z, 2.4, 1.1, 0.3, 0.42);
    else if (A.k >= 0.98) glowPush(A.x, A.y, A.z, 1.4, 1.3, 1.0, 0.16);
  }
  drawDazzle(); // [balance3] motes of light about a dazzled head (07c_balance3.js)
  for (const S of CLS.stuck) if (near2(S.x, S.z, 70)) { arrowPush(S.x - S.dx * 0.25, S.y - S.dy * 0.25, S.z - S.dz * 0.25, S.dx, S.dy, S.dz); if (S.type === 'fire' && GAME.t < S.until - 52) glowPush(S.x, S.y, S.z, 1.6, 0.6, 0.15, 0.3); }
  // ice sheets: grow in, melt away
  for (const s of CLS.ice) if (s.mesh) { const u = s.mesh.material.uniforms; u.uK.value = iceRadiusK(s); u.uAge.value = GAME.t - s.t0; }
  // snares: the jaws snap shut on whatever steps in
  for (const S of CLS.snares) if (S.mesh) S.mesh.material.uniforms.uClose.value = smooth(clamp(S.close, 0, 1));
  // frozen bodies stand in shells of ice
  let fi = 0;
  for (const id of CLS.frozen) {
    const e = getEnt(id);
    if (!e || !e.alive || !near2(e.x, e.z, 70)) continue;
    if (!FROZEN_GEO) FROZEN_GEO = new THREE.IcosahedronGeometry(1, 1);
    let m = FROZEN_POOL[fi];
    if (!m) { m = new THREE.Mesh(FROZEN_GEO, shareMat(frozenMat, { uFade: { value: 1 } })); m.frustumCulled = false; m.renderOrder = 8; scene.add(m); FROZEN_POOL.push(m); }
    const sc = e.scale || 1, big = e.kind === 'humanoid' ? 1 : 1.3;
    m.visible = true;
    m.position.set(e.x, e.y + 0.92 * sc * big, e.z);
    m.scale.set(0.62 * sc * big, 1.08 * sc * (e.kind === 'humanoid' ? 1 : 0.7), 0.62 * sc * big);
    m.rotation.y = e.yaw + id;
    let left = 0;
    for (const b of e.buffs) if (b.kind === 'frozen') left = Math.max(left, b.until - GAME.t);
    m.material.uniforms.uFade.value = clamp(left / 0.4, 0, 1);
    fi++;
    if (fi >= 12) break;
  }
  for (let i = fi; i < FROZEN_POOL.length; i++) FROZEN_POOL[i].visible = false;
  // steam rolls and rises
  const A0 = U.uAmbient.value, L0 = U.uLightColor.value;
  for (const S of CLS.steam) {
    if (!near2(S.x, S.z, 90)) continue;
    const life = clamp((S.until - GAME.t) / 1.5, 0, 1);
    const n = Math.round((lo ? 2 : 5) * life);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, rr = Math.sqrt(Math.random()) * S.r, x = S.x + Math.cos(a) * rr, z = S.z + Math.sin(a) * rr;
      fxAlpha.emit(x, heightAt(x, z) + 0.3 + Math.random() * 1.2, z, (Math.random() - 0.5) * 0.5 + U.uWindDir.value.x * 0.4, 0.5 + Math.random() * 0.7, (Math.random() - 0.5) * 0.5 + U.uWindDir.value.y * 0.4, 2.2 + Math.random(), A0.x * 0.65 + L0.x * 0.4 + 0.28, A0.y * 0.65 + L0.y * 0.4 + 0.3, A0.z * 0.65 + L0.z * 0.4 + 0.33, -(1.1 + Math.random() * 0.6), -0.12, 0.35);
    }
  }
  // runes glow where they wait; holy ground lights the feet of those on it
  for (const R of CLS.runes) if (near2(R.x, R.z, 90)) {
    const c = ELEM_COL[R.el], p = 0.6 + 0.4 * Math.sin(renderTime * 3 + R.x); glowPush(R.x, heightAt(R.x, R.z) + 0.25, R.z, c[0] * 0.5 * p, c[1] * 0.5 * p, c[2] * 0.5 * p, 2.6);
    // [balance] a rune laid out of sight (by a far-off mage, or before the camera came) gets its carved glyph when
    // you come near, so no rune waits unseen; a glyph whose disc went to another spell is laid again
    const left = R.until - GAME.t;
    if (left > 0.6) {
      if (!R.cut || !R.cut.on || R.cut.owner !== R) { R.cut = spellDisc(R.x, R.z, 2.2, DISC_KIND.runecut, left, [1, 1, 1], 0.04); if (R.cut) R.cut.owner = R; }
      if (!R.disc || !R.disc.on || R.disc.owner !== R) { R.disc = spellDisc(R.x, R.z, 2.2, DISC_KIND.rune, left, c); if (R.disc) R.disc.owner = R; }
    }
  }
  // [look4] a soft light low over the hallowed ground (a glow of 1.1 times the ground's width at full strength blew the
  // frame out to white round the priest: cls_hallow), its edge marked over the grass by a ring of slowly turning motes
  // (the disc on the ground hides in a meadow)
  for (const G of CLS.grounds) if (near2(G.x, G.z, 100)) {
    const k = clamp((G.until - GAME.t) / 1.2, 0, 1) * clamp((GAME.t - G.t0) / 0.4, 0, 1), gy = heightAt(G.x, G.z);
    glowPush(G.x, gy + 0.3, G.z, 0.3 * k, 0.26 * k, 0.13 * k, G.r * 0.95);
    const n = near2(G.x, G.z, 60) && glowCount < GLOW_MAX - 80 ? Math.max(10, Math.round(G.r * 5)) : 0, t = renderTime * 0.18; // (leaving the glows room for the rest)
    for (let i = 0; i < n; i++) { const a = t + (i / n) * TAU, x = G.x + Math.sin(a) * G.r * 0.93, z = G.z + Math.cos(a) * G.r * 0.93; glowPush(x, heightAt(x, z) + 0.58 + 0.06 * Math.sin(renderTime * 1.7 + i), z, 1.0 * k, 0.86 * k, 0.45 * k, 0.19); }
  }
  const P = GAME.player;
  // chilled bodies breathe frost
  if (!lo) forNear(camX, camZ, 40, (e) => { if (e.alive && e.buffs.length && Math.random() < dt * 4 && chillOf(e) > 0) { const sc = e.scale || 1; fxAdd.emit(e.x + (Math.random() - 0.5) * 0.6 * sc, e.y + Math.random() * 1.6 * sc, e.z + (Math.random() - 0.5) * 0.6 * sc, 0, 0.25, 0, 0.9, 0.5, 0.8, 1.3, 0.07, -0.1, 0.5); } });
  if (!P || !P.alive || !P.cs) return;
  // the parry cue: a glint on the weapon of a foe whose blow is on its way to you
  if (P.cls === 'warrior' && clsHas(P, 'block')) {
    forNear(P.x, P.z, 6, (o) => {
      if (!o.alive || o.target !== P.id || !isEnemy(o, P) || o.rangedKind) return;
      const a = o.anim.act;
      if ((a !== 1 && a !== 8) || o.anim.actT > 0.27) return;
      const k = clamp(o.anim.actT / 0.26, 0, 1), sc = o.scale || 1, s = Math.sin(o.yaw), c = Math.cos(o.yaw);
      const hx = o.x + c * -0.35 * sc + s * 0.35 * sc, hz = o.z - s * -0.35 * sc + c * 0.35 * sc;
      glowPush(hx, o.y + (1.4 + 0.5 * (1 - k)) * sc, hz, 2.2 * k + 0.4, 2.0 * k + 0.35, 1.4 * k + 0.25, 0.35 + 0.35 * k);
    });
  }
  // a full draw: the arrowhead catches the light
  if (P.cls === 'archer' && P.cs.drawFrom >= 0) {
    const k = drawK(P), s = Math.sin(P.yaw), c = Math.cos(P.yaw), sc = P.scale || 1;
    if (k >= 0.98) glowPush(P.x + s * 0.75 * sc, P.y + 1.48 * sc, P.z + c * 0.75 * sc, 1.6, 1.45, 1.0, 0.22 + 0.06 * Math.sin(renderTime * 14));
  }
}

/* ---- the callings' sounds, made from the shared synth voices (11_audio.js) ---- */
const CLS_SFX_GAP = {};
function classSfx(kind, x, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  const v = clamp(1.2 - Math.hypot(x - camera.position.x, z - camera.position.z) / 70, 0, 1);
  if (v <= 0.02) return;
  const now = AUDIO.ctx.currentTime;
  if (now - (CLS_SFX_GAP[kind] || -9) < 0.06) return;
  CLS_SFX_GAP[kind] = now;
  const t = now + 0.01;
  try {
    if (kind === 'parry') { tone('triangle', 1650, 1250, t, 0.28, 0.12 * v); tone('sine', 2480, 2300, t, 0.4, 0.06 * v); noiseBurst(t, 0.09, 0.2 * v, 'highpass', 3500, 6000, 1.0); }
    else if (kind === 'block') { noiseBurst(t, 0.12, 0.22 * v, 'bandpass', 700, 380, 1.2); tone('square', 210, 120, t, 0.08, 0.04 * v); }
    else if (kind === 'finisher') { noiseBurst(t, 0.22, 0.3 * v, 'lowpass', 1800, 300, 0.9); tone('sine', 120, 55, t, 0.3, 0.2 * v); }
    else if (kind === 'freeze') { noiseBurst(t, 0.5, 0.16 * v, 'highpass', 5000, 2500, 0.8); tone('sine', 1900, 2600, t, 0.35, 0.03 * v); }
    else if (kind === 'shatter') { noiseBurst(t, 0.3, 0.32 * v, 'highpass', 2600, 6500, 1.0); for (let i = 0; i < 4; i++) tone('triangle', 2400 + Math.random() * 1800, 1500, t + i * 0.035, 0.12, 0.045 * v); }
    else if (kind === 'overload') { noiseBurst(t, 0.5, 0.34 * v, 'lowpass', 2400, 160, 0.8); tone('sawtooth', 90, 40, t, 0.45, 0.08 * v); noiseBurst(t, 0.12, 0.2 * v, 'highpass', 4000, 7000, 1.2); }
    else if (kind === 'steam') { noiseBurst(t, 1.2, 0.18 * v, 'highpass', 2200, 1200, 0.6, 0.05); }
    else if (kind === 'rune') { tone('sine', 330, 495, t, 0.6, 0.06 * v, 0.05); tone('sine', 660, 660, t + 0.12, 0.5, 0.03 * v, 0.05); }
    else if (kind === 'runeburst') { tone('sine', 495, 160, t, 0.5, 0.12 * v); noiseBurst(t, 0.35, 0.25 * v, 'bandpass', 900, 300, 0.9); }
    else if (kind === 'snareset') { noiseBurst(t, 0.06, 0.14 * v, 'bandpass', 1800, 1400, 2); tone('square', 520, 480, t + 0.05, 0.05, 0.03 * v); }
    else if (kind === 'snare') { noiseBurst(t, 0.07, 0.3 * v, 'bandpass', 2600, 1500, 2.5); tone('square', 900, 300, t, 0.09, 0.07 * v); }
  } catch (err) { /* sound is optional */ }
}
