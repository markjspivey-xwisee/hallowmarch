/* ================================================================== */
/* combat feel: slash trails, impact flashes, hit-stop, richer spell hits */
/* ================================================================== */
const SLASH_MAX = 72;
const slashGeo = (() => {
  const g = new THREE.InstancedBufferGeometry();
  const N = 20, P = [], idx = [];
  for (let i = 0; i <= N; i++) for (const j of [0, 1]) P.push(i / N, j, 0);
  for (let i = 0; i < N; i++) { const a = i * 2; idx.push(a, a + 1, a + 3, a, a + 3, a + 2); }
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setIndex(idx);
  for (const k of ['iA', 'iB', 'iC']) g.setAttribute(k, new THREE.InstancedBufferAttribute(new Float32Array(SLASH_MAX * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  return g;
})();
const slashMesh = new THREE.Mesh(slashGeo, new THREE.ShaderMaterial({
  uniforms: { uTime: U.uTime, uFogDensity: U.uFogDensity },
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
  vertexShader: /* glsl */`
    uniform float uTime, uFogDensity;
    attribute vec4 iA; attribute vec4 iB; attribute vec4 iC;
    varying vec2 vUv; varying float vK; varying vec3 vCol; varying float vFog;
    void main(){
      float life = abs(iB.w);
      float age = (uTime - iB.z) / life;
      vK = age; vCol = iC.rgb; vUv = vec2(iB.w < 0.0 ? 1.0 - position.x : position.x, position.y);
      if (age < 0.0 || age > 1.0) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); vFog = 0.0; return; }
      float th = mix(-1.3, 1.3, position.x);
      float r = iB.y + (position.y - 0.5) * iC.w * (0.4 + 0.6 * sin(position.x * 3.1416));
      vec3 p = vec3(sin(th) * r, 0.0, cos(th) * r * 0.85);
      float cr = cos(iB.x), sr = sin(iB.x);
      p = vec3(p.x * cr, p.x * sr, p.z);
      float cy = cos(iA.w), sy = sin(iA.w);
      p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
      vec4 mv = viewMatrix * vec4(iA.xyz + p, 1.0);
      vFog = exp(-max(-mv.z, 0.0) * uFogDensity);
      gl_Position = projectionMatrix * mv;
    }`,
  fragmentShader: /* glsl */`
    varying vec2 vUv; varying float vK; varying vec3 vCol; varying float vFog;
    void main(){
      float head = vK * 1.6;
      float a = smoothstep(head - 0.65, head, vUv.x) * (1.0 - smoothstep(head, head + 0.03, vUv.x));
      float e = 1.0 - abs(vUv.y * 2.0 - 1.0);
      a *= e * e * (1.0 - smoothstep(0.65, 1.0, vK)) * vFog;
      if (a < 0.003) discard;
      gl_FragColor = vec4(vCol * a * 2.4, 1.0);
    }`,
}));
slashMesh.frustumCulled = false;
slashMesh.renderOrder = 9;
slashMesh.userData.keep = true;
scene.add(slashMesh);
let slashHead = 0;
function spawnSlash(e, heavy = false, lifeOverride = 0) {
  if (!e || dist2(e.x, e.z, camera.position.x, camera.position.z) > 50 * 50) return;
  const sc = e.scale || 1, i = slashHead;
  slashHead = (slashHead + 1) % SLASH_MAX;
  const beast = e.kind !== 'humanoid';
  const fx = Math.sin(e.yaw), fz = Math.cos(e.yaw);
  const y = e.y + (beast ? 0.6 : 1.15) * sc;
  const roll = heavy ? Math.PI / 2 + (Math.random() - 0.5) * 0.3 : (Math.random() < 0.5 ? -1 : 1) * (0.25 + Math.random() * 0.6);
  const col = beast ? [1.5, 0.42, 0.3] : e.role === 'player' ? [1.7, 1.5, 1.15] : e.faction <= 2 ? REALMS[e.faction].rgb.map((v) => v * 0.9 + 0.55) : [1.2, 1.1, 1.0];
  const life = (lifeOverride || (beast ? 0.16 : 0.2)) * (Math.random() < 0.5 ? -1 : 1);
  slashGeo.attributes.iA.array.set([e.x + fx * 0.15, y, e.z + fz * 0.15, e.yaw], i * 4);
  slashGeo.attributes.iB.array.set([roll, (beast ? 0.75 : 1.05) * sc * (heavy ? 1.25 : 1), U.uTime.value, life], i * 4);
  slashGeo.attributes.iC.array.set([col[0], col[1], col[2], (beast ? 0.18 : 0.34) * sc], i * 4);
  for (const k of ['iA', 'iB', 'iC']) { const a = slashGeo.attributes[k]; a.clearUpdateRanges(); a.addUpdateRange(i * 4, 4); a.needsUpdate = true; }
  slashGeo.instanceCount = SLASH_MAX;
}

/* hit-stop: the world holds its breath for a few frames on a telling blow */
function hitStop(sec) { GAME.hitStop = Math.max(GAME.hitStop || 0, sec); }

/* the moment a blow lands: a flash where it struck, some shake and a pause for the player's best hits */
function onImpact(src, dst, dmg, opts) {
  const P = GAME.player;
  if (!dst || dst.kind === 'door') return;
  const near = dist2(dst.x, dst.z, camera.position.x, camera.position.z) < 45 * 45;
  if (!near) return;
  const y = dst.y + 1.1 * (dst.scale || 1);
  if (!opts.dot && (opts.kind === 'melee' || opts.kind === 'arrow')) {
    FX.glowAt(dst.x, y, dst.z, opts.crit ? [2.4, 2.0, 1.4] : [1.4, 1.2, 0.9], opts.crit ? 1.3 : 0.7, 0.09);
    if (opts.kind === 'melee' && (dst.kind !== 'humanoid' || dst.mobType)) FX.blood(dst.x, y, dst.z);
  }
  if (src === P && !opts.dot) {
    if (opts.crit) { hitStop(0.075); cameraShake(0.14, dst.x, dst.z); lightFlash(dst.x, y, dst.z, 5, [2.2, 1.7, 1.0], 0.16); }
    if (!dst.alive || dst.hp <= 0) { hitStop(0.09); cameraShake(0.1, dst.x, dst.z); }
  } else if (dst === P && dmg > P.maxHp * 0.12 && !opts.dot) { hitStop(0.05); cameraShake(0.2, P.x, P.z); }
}

/* richer spell impacts */
function spellImpact(kind, x, y, z) {
  if (dist2(x, z, camera.position.x, camera.position.z) > 70 * 70) return;
  if (kind === 'fire') {
    FX.burst(x, y, z, 26, [2.4, 1.0, 0.3], 4.2, 0.45, 0.2, 2);
    FX.burst(x, y, z, 10, [2.6, 1.8, 0.7], 1.5, 0.25, 0.4, 0);
    for (let i = 0; i < 4; i++) fxAlpha.emit(x + (Math.random() - 0.5) * 0.4, y, z + (Math.random() - 0.5) * 0.4, (Math.random() - 0.5) * 0.6, 0.6 + Math.random() * 0.5, (Math.random() - 0.5) * 0.6, 1.8, 0.16, 0.14, 0.13, -0.6, -0.1, 0.4);
    lightFlash(x, y, z, 8, [3.0, 1.4, 0.4], 0.35);
  } else if (kind === 'frost') {
    FX.burst(x, y, z, 22, [1.2, 1.8, 2.6], 4.5, 0.5, 0.12, 7);
    FX.ring(x, y - 0.3, z, 0.8, [0.9, 1.5, 2.4], 18, 2.2);
    lightFlash(x, y, z, 6, [0.9, 1.6, 2.8], 0.3);
  } else if (kind === 'holy') {
    FX.burst(x, y, z, 20, [2.4, 2.1, 1.1], 2.5, 0.6, 0.18, -2);
    lightFlash(x, y, z, 7, [2.6, 2.3, 1.2], 0.35);
  } else if (kind === 'arcane' || kind === 'wisp') {
    FX.burst(x, y, z, 18, kind === 'wisp' ? [0.7, 1.9, 1.6] : [1.4, 0.8, 2.6], 3, 0.4, 0.16, 1);
    lightFlash(x, y, z, 5, kind === 'wisp' ? [0.7, 1.9, 1.6] : [1.4, 0.8, 2.6], 0.25);
  }
}

/* the fallen: a puff of dust where they land; the restless dead give up a pale wisp */
function deathEffects(e) {
  if (!e || e.kind === 'door' || dist2(e.x, e.z, camera.position.x, camera.position.z) > 60 * 60) return;
  const undead = e.mobType === 'skeleton' || e.mobType === 'draugr' || e.kind === 'wisp';
  later(0.55, () => FX.dust(e.x, e.y, e.z, e.kind === 'bear' || e.mobType === 'troll' ? 16 : 9, [0.42, 0.37, 0.3]));
  if (undead) {
    for (let i = 0; i < 14; i++) fxAdd.emit(e.x + (Math.random() - 0.5) * 0.6, e.y + 0.6 + Math.random(), e.z + (Math.random() - 0.5) * 0.6, (Math.random() - 0.5) * 0.4, 1.2 + Math.random() * 1.2, (Math.random() - 0.5) * 0.4, 1.4 + Math.random() * 0.8, 0.5, 1.5, 1.3, 0.22, -0.6, 0.5);
    lightFlash(e.x, e.y + 1, e.z, 6, [0.5, 1.5, 1.3], 0.8);
  }
}
