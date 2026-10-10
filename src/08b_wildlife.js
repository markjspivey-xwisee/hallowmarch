/* ================================================================== */
/* wildlife: deer herds that graze and bolt, birds and bats, butterflies, */
/* fish leaping in the lakes                                             */
/* ================================================================== */
const DEER_COLS = [[0.5, 0.33, 0.2], [0.44, 0.3, 0.19], [0.55, 0.4, 0.26]];
function initWildlife() {
  const r = mulberry(9001);
  let herd = 0;
  for (const R of REALMS) {
    let made = 0;
    for (let tries = 0; tries < 700 && made < 7; tries++) {
      const a = R.bearing + (r() - 0.5) * 1.7, d = R_RING + 45 + r() * 160;
      const x = Math.sin(a) * d, z = -Math.cos(a) * d;
      if (Math.hypot(x, z) > 455 || !isWalkable(x, z)) continue;
      const h = heightAt(x, z);
      if (h < WATER_Y + 1 || h > 20) continue;
      if (sampleGrid(W.grass, x, z) < 0.6 || sampleGrid(W.road, x, z) > 0.05) continue;
      if (CAMPS.some((c) => dist2(c.x, c.z, x, z) < 50 * 50)) continue;
      if (SITES.some((S) => dist2(S.x, S.z, x, z) < (S.r + 34) ** 2)) continue;
      let ok = true;
      for (let s = 0; s < 6 && ok; s++) { const aa = (s / 6) * TAU; if (!isWalkable(x + Math.sin(aa) * 12, z + Math.cos(aa) * 12)) ok = false; }
      if (!ok) continue;
      const n = 3 + Math.floor(r() * 3), id = herd++;
      for (let i = 0; i < n; i++) {
        const stag = i === 0 && r() < 0.65;
        const px = x + (r() - 0.5) * 8, pz = z + (r() - 0.5) * 8;
        const c = DEER_COLS[Math.floor(r() * DEER_COLS.length)];
        const e = makeEnt({
          kind: stag ? 'stag' : 'deer', faction: FACTION_NEUTRAL, role: 'critter', name: stag ? 'stag' : 'hind', level: 1,
          x: px, z: pz, y: heightAt(px, pz), yaw: r() * TAU, scale: stag ? 1.06 : 0.86 + r() * 0.12, radius: 0.4, speed: 10,
          look: { colA: c, colB: [c[0] * 0.55, c[1] * 0.5, c[2] * 0.45] }, herd: id, home: { x, z, r: 16 },
        });
        e.ai.mode = 'graze'; e.ai.until = GAME.t + r() * 6;
      }
      made++;
    }
  }
}
const _herdAlarm = new Map(); // herd id -> { x, z, until }
function thinkCritter(e, dt) {
  const ai = e.ai, t = GAME.t;
  if (ai.tameHold > t) return; // [animals] eating from the player's hand (08h_animals.js)
  // anything that is not a deer close by sends the herd running
  if (t > (ai.scanAt || 0)) {
    ai.scanAt = t + 0.25 + Math.random() * 0.2;
    let th = null, bd = 15 * 15;
    forNear(e.x, e.z, 15, (o, d2) => {
      if (o === e || !o.alive || o.role === 'critter' || o.kind === 'door' || o.kind === 'wisp') return;
      if (o.role === 'animal' && o.faction === FACTION_NEUTRAL || animalsSparesDeer(e, o)) return; // [animals] tame beasts, and a calm player with food (08h_animals.js)
      const lim = o.role === 'player' || o.faction === FACTION_MONSTER ? 15 : 8;
      if (d2 < lim * lim && d2 < bd) { bd = d2; th = o; }
    });
    if (th) _herdAlarm.set(e.herd, { x: th.x, z: th.z, until: t + 5 + Math.random() * 2 });
  }
  const al = _herdAlarm.get(e.herd);
  if (al && al.until > t) {
    if (!ai.flee || ai.fleeFrom !== al) {
      // away from the danger, spread a little, toward walkable ground
      let dx = e.x - al.x, dz = e.z - al.z;
      const l = Math.hypot(dx, dz) || 1;
      dx /= l; dz /= l;
      const spread = (Math.random() - 0.5) * 0.7, c = Math.cos(spread), s = Math.sin(spread);
      const fx = dx * c - dz * s, fz = dx * s + dz * c;
      ai.flee = { x: e.x + fx * 40, z: e.z + fz * 40 };
      ai.fleeFrom = al;
      if (e.anim.act) { e.anim.act = 0; e.anim.actDur = 0; }
    }
    const before = e.x + e.z;
    moveToward(e, ai.flee.x, ai.flee.z, dt, 1, 1);
    if (Math.abs(e.x + e.z - before) < 1e-4) ai.flee = { x: e.x + (Math.random() - 0.5) * 40, z: e.z + (Math.random() - 0.5) * 40 };
    ai.mode = 'alert'; ai.until = t + 2 + Math.random() * 2;
    return;
  }
  ai.flee = null;
  // calm: graze, look about, wander a few steps, drift back toward the herd's ground
  if (t > (ai.until || 0)) {
    const roll = Math.random();
    if (dist(e.x, e.z, e.home.x, e.home.z) > e.home.r * 1.6 || roll < 0.3) {
      const a = Math.random() * TAU, rr = Math.random() * e.home.r;
      ai.mode = 'walk'; ai.goal = { x: e.home.x + Math.cos(a) * rr, z: e.home.z + Math.sin(a) * rr }; ai.until = t + 12;
    } else if (roll < 0.82) {
      const dur = 5 + Math.random() * 9;
      ai.mode = 'graze'; ai.until = t + dur; setAct(e, 7, dur);
    } else {
      const dur = 2 + Math.random() * 2.5;
      ai.mode = 'alert'; ai.until = t + dur; setAct(e, 5, dur);
    }
  }
  if (ai.mode === 'walk' && ai.goal) {
    if (moveToward(e, ai.goal.x, ai.goal.z, dt, 0.13, 0.6)) ai.until = 0;
  }
}

/* ------------------------------------------------------------------ */
/* birds by day, bats at dusk and night                                */
/* ------------------------------------------------------------------ */
const FLOCKS = 6, PER_FLOCK = 11;
const birdState = { flocks: [], mesh: null };
function buildBirds() {
  const P = [], SIDE = [], idx = [];
  const v = (x, y, z, side) => { P.push(x, y, z); SIDE.push(side); return P.length / 3 - 1; };
  // body: a slim spindle
  const nose = v(0, 0, 0.17, 0), tail = v(0, 0.0, -0.2, 0), l = v(-0.035, 0, 0.02, 0), r = v(0.035, 0, 0.02, 0), top = v(0, 0.03, 0.02, 0), bot = v(0, -0.025, 0.02, 0);
  idx.push(nose, l, top, nose, top, r, tail, top, l, tail, r, top, nose, bot, l, nose, r, bot, tail, l, bot, tail, bot, r);
  // a forked tail
  const t1 = v(-0.07, 0, -0.3, 0), t2 = v(0.07, 0, -0.3, 0);
  idx.push(tail, t1, t2);
  // wings: swept, tapering to a point
  for (const s of [-1, 1]) {
    const a = v(0.03 * s, 0.005, 0.07, s), b = v(0.03 * s, 0.005, -0.05, s), c = v(0.24 * s, 0.01, 0.02, s), d = v(0.25 * s, 0.01, -0.09, s), e = v(0.46 * s, 0.0, -0.12, s);
    idx.push(a, b, c, b, d, c, c, d, e);
  }
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('aSide', new THREE.Float32BufferAttribute(SIDE, 1));
  g.setIndex(idx);
  const n = FLOCKS * PER_FLOCK, iA = new Float32Array(n * 4), iB = new Float32Array(n * 4);
  const rnd = mulberry(77);
  for (let f = 0; f < FLOCKS; f++) for (let k = 0; k < PER_FLOCK; k++) {
    const i = f * PER_FLOCK + k;
    iA.set([f, rnd() * TAU, 6 + rnd() * 14, (rnd() - 0.5) * 6], i * 4);
    iB.set([(rnd() < 0.5 ? -1 : 1) * (5 + rnd() * 4), rnd() * TAU, 0.8 + rnd() * 0.5, rnd()], i * 4);
  }
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(iA, 4));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(iB, 4));
  g.instanceCount = n;
  const m = new THREE.Mesh(g, mat({
    side: THREE.DoubleSide,
    uniforms: { uFlock: { value: Array.from({ length: FLOCKS }, () => new THREE.Vector4(0, -500, 0, 1)) } },
    vertexShader: /* glsl */`
      ${GLSL_COMMON}
      uniform float uTime, uNight;
      uniform vec4 uFlock[${FLOCKS}];
      attribute float aSide; attribute vec4 iA; attribute vec4 iB;
      varying vec3 vW; varying float vSide;
      void main(){
        vec4 F = uFlock[int(iA.x + 0.5)];
        float bat = smoothstep(0.55, 0.85, uNight);
        float speed = iB.x * mix(1.0, 1.35, bat);
        float R = iA.z * mix(1.0, 0.45, bat) * F.w;
        float ang = iA.y + uTime * speed / max(R, 1.0);
        vec3 c = F.xyz + vec3(cos(ang) * R, iA.w + sin(uTime * 0.5 + iB.w * 9.0) * 1.5, sin(ang) * R);
        c += vec3(sin(uTime * 0.31 + iB.w * 17.0), 0.0, cos(uTime * 0.27 + iB.w * 11.0)) * 3.0 * F.w;
        c.y += bat * sin(uTime * 3.7 + iB.w * 40.0) * 0.8;
        vec3 fwd = safeNormalize(vec3(-sin(ang), 0.0, cos(ang)) * sign(speed));
        vec3 right = safeNormalize(cross(fwd, vec3(0.0, 1.0, 0.0)));
        float bank = 0.5 * sign(speed);
        vec3 up = cross(right, fwd);
        right = right * cos(bank) + up * sin(bank);
        up = cross(right, fwd);
        // flap, with long glides for birds and constant fluttering for bats
        float glide = smoothstep(0.2, 0.7, sin(uTime * 0.45 + iB.w * 20.0)) * (1.0 - bat);
        float flap = sin(uTime * mix(9.0, 19.0, bat) + iB.y) * mix(0.85, 0.12, glide) + 0.1 * glide;
        vec3 p = position;
        if (aSide != 0.0) {
          float span = abs(p.x) - 0.03;
          float a = flap * (0.4 + 0.6 * smoothstep(0.0, 0.2, span));
          p.x = sign(p.x) * (0.03 + span * cos(a));
          p.y += span * sin(a);
        }
        p *= iB.z * mix(1.0, 0.6, bat);
        vW = c + right * p.x + up * p.y + fwd * p.z;
        vSide = aSide;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying vec3 vW; varying float vSide;
      void main(){
        vec3 col = uAmbient * 0.12 + uLightColor * 0.06;
        gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
      }`,
  }));
  m.frustumCulled = false;
  m.renderOrder = 5;
  scene.add(m);
  birdState.mesh = m;
  for (let f = 0; f < FLOCKS; f++) birdState.flocks.push({ x: 0, z: 0, y: -500, h: 0, vx: 0, vz: 0, placed: false, scale: 1, seed: Math.random() * 100 });
}
function updateBirds(dt) {
  if (!birdState.mesh) return;
  const camX = camera.position.x, camZ = camera.position.z;
  const night = U.uNight.value, bat = smooth(clamp((night - 0.55) / 0.3, 0, 1));
  const U4 = birdState.mesh.material.uniforms.uFlock.value;
  const active = Math.round(lerp(FLOCKS, 3, bat) * (1 - 0.7 * WEATHER.raining));
  birdState.flocks.forEach((F, i) => {
    const d = Math.hypot(F.x - camX, F.z - camZ);
    if (!F.placed || d > 260) {
      const a = Math.random() * TAU, rr = 90 + Math.random() * 110;
      F.x = camX + Math.cos(a) * rr; F.z = camZ + Math.sin(a) * rr; F.placed = true;
      const h = Math.random() * TAU; F.vx = Math.cos(h) * 3; F.vz = Math.sin(h) * 3;
      F.y = heightAt(F.x, F.z) + 30;
    }
    // drift and turn slowly
    const turn = Math.sin(renderTime * 0.05 + F.seed) * 0.15 * dt;
    const c = Math.cos(turn), s = Math.sin(turn);
    [F.vx, F.vz] = [F.vx * c - F.vz * s, F.vx * s + F.vz * c];
    F.x += F.vx * dt; F.z += F.vz * dt;
    const want = Math.max(heightAt(F.x, F.z), WATER_Y) + lerp(26 + 10 * Math.sin(F.seed), 8, bat);
    F.y += (want - F.y) * (1 - Math.exp(-dt * 0.4));
    F.scale = lerp(1, 0.6, bat);
    U4[i].set(F.x, i < active ? F.y : -500, F.z, F.scale);
  });
}

/* ------------------------------------------------------------------ */
/* butterflies over the flowers                                        */
/* ------------------------------------------------------------------ */
let butterflyMesh = null;
const BUTTERFLIES = 260;
function buildButterflies() {
  const g = new THREE.InstancedBufferGeometry();
  // two wings hinged on the body axis (x = 0)
  const P = [-0.5, 0, 0.5, 0, 0, 0.5, 0, 0, -0.5, -0.5, 0, -0.35, 0.5, 0, 0.5, 0, 0, 0.5, 0, 0, -0.5, 0.5, 0, -0.35];
  const UV = [0, 1, 0.5, 1, 0.5, 0, 0, 0.15, 1, 1, 0.5, 1, 0.5, 0, 1, 0.15];
  g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
  g.setIndex([0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6]);
  const rnd = mulberry(4040), a = new Float32Array(BUTTERFLIES * 4);
  for (let i = 0; i < BUTTERFLIES * 4; i++) a[i] = rnd();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = BUTTERFLIES;
  butterflyMesh = new THREE.Mesh(g, mat({
    side: THREE.DoubleSide,
    vertexShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_WORLD}
      uniform float uTime, uNight, uWet;
      attribute vec4 aSeed;
      varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
      void main(){
        vUv = uv; vA = 0.0; vW = vec3(0.0);
        float box = 56.0;
        vec2 base = cameraPosition.xz + mod(aSeed.xy * box - cameraPosition.xz + box * 0.5, box) - box * 0.5;
        float s = aSeed.w * 40.0, t = uTime;
        vec2 wander = vec2(sin(t * 0.37 + s) + sin(t * 0.83 + s * 1.7) * 0.5, cos(t * 0.29 + s * 0.6) + cos(t * 0.71 + s * 2.3) * 0.5) * 1.6;
        vec2 xz = base + wander;
        vec4 A = texture(uWorldA, worldUV(xz));
        float bloom = smoothstep(0.15, 0.5, A.b) * (1.0 - smoothstep(0.35, 0.8, uNight)) * (1.0 - smoothstep(0.2, 0.6, uWet));
        float d = length(xz - cameraPosition.xz);
        bloom *= 1.0 - smoothstep(box * 0.32, box * 0.5, d);
        if (bloom < 0.05) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        vec3 c = vec3(xz.x, terrainHeight(xz) + 0.45 + 0.45 * abs(sin(t * 1.1 + s)) + 0.12 * sin(t * 5.0 + s), xz.y);
        vec2 dir = safeNormalize2(vec2(cos(t * 0.37 + s), -sin(t * 0.29 + s * 0.6)));
        float yaw = atan(dir.x, dir.y);
        float flap = sin(t * 24.0 + s * 9.0) * 1.1;
        vec3 p = position;
        float a = flap * sign(p.x);
        p = vec3(p.x * cos(a), abs(p.x) * sin(a), p.z);
        float cy = cos(yaw), sy = sin(yaw);
        p = vec3(p.x * cy + p.z * sy, p.y, -p.x * sy + p.z * cy);
        p *= 0.055 + 0.03 * aSeed.z;
        vW = c + p;
        float k = floor(aSeed.z * 5.0);
        vCol = k < 1.0 ? vec3(0.95, 0.93, 0.86) : k < 2.0 ? vec3(0.98, 0.82, 0.25) : k < 3.0 ? vec3(0.95, 0.5, 0.15) : k < 4.0 ? vec3(0.35, 0.55, 0.95) : vec3(0.9, 0.55, 0.75);
        vA = bloom;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying vec2 vUv; varying vec3 vCol; varying vec3 vW; varying float vA;
      void main(){
        // a rounded forewing and hindwing with a dark rim
        vec2 q = vec2(abs(vUv.x - 0.5) * 2.0, vUv.y);
        float fore = length((q - vec2(0.55, 0.72)) * vec2(1.0, 1.25));
        float hind = length((q - vec2(0.45, 0.28)) * vec2(1.15, 1.2));
        float w = min(fore, hind);
        if (w > 0.48 || vA < 0.05) discard;
        vec3 c = mix(vCol, vCol * 0.25, smoothstep(0.36, 0.46, w));
        c = mix(c, vec3(0.08), (1.0 - smoothstep(0.02, 0.06, q.x)));
        gl_FragColor = vec4(safeColor(applyFog(c * (uAmbient * 0.6 + uLightColor * 0.6), vW)), 1.0);
      }`,
  }));
  butterflyMesh.frustumCulled = false;
  butterflyMesh.renderOrder = 5;
  scene.add(butterflyMesh);
}

/* ------------------------------------------------------------------ */
/* fish leaping in lakes and ponds                                     */
/* ------------------------------------------------------------------ */
const FISH = { list: [], next: 3, mesh: null, max: 6 };
function buildFish() {
  const K = new SkinKit();
  kitTube(K, [[-0.2, 0.01], [-0.14, 0.035], [-0.02, 0.055], [0.1, 0.045], [0.17, 0.02]].map(([z, r]) => ({ c: [0, 0, z], rx: r * 0.6, rz: r })), 8, { cap1: 'dome', front: [0, 1, 0], attr: () => ({ mat: 0 }) });
  const tail = new THREE.ConeGeometry(0.06, 0.1, 4);
  tail.scale(0.15, 1, 1);
  kitGeo(K, tail, M4([0, 0, -0.23], [-Math.PI / 2, 0, 0]), { mat: 1 });
  const g = K.build();
  g.setAttribute('iA', new THREE.InstancedBufferAttribute(new Float32Array(FISH.max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('iB', new THREE.InstancedBufferAttribute(new Float32Array(FISH.max * 4), 4).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  FISH.mesh = new THREE.Mesh(g, mat({
    vertexShader: /* glsl */`
      ${GLSL_COMMON}
      attribute vec4 iA; attribute vec4 iB; attribute float aMat;
      varying vec3 vW; varying vec3 vN; varying float vMat;
      void main(){
        vec3 f = safeNormalize(iB.xyz);
        vec3 r = safeNormalize(cross(vec3(0.0, 1.0, 0.0), f));
        vec3 u = cross(f, r);
        float wig = sin(iA.w * 30.0) * 0.25 * smoothstep(0.0, -0.2, position.z);
        vec3 p = position + vec3(wig * -position.z, 0.0, 0.0);
        vW = iA.xyz + (r * p.x + u * p.y + f * p.z) * iB.w;
        vN = r * normal.x + u * normal.y + f * normal.z;
        vMat = aMat;
        gl_Position = projectionMatrix * viewMatrix * vec4(vW, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying vec3 vW; varying vec3 vN; varying float vMat;
      void main(){
        vec3 n = safeNormalize(vN);
        vec3 V = safeNormalize(cameraPosition - vW);
        vec3 alb = mix(vec3(0.72, 0.74, 0.7), vec3(0.3, 0.36, 0.3), smoothstep(-0.2, 0.6, n.y));
        vec3 H = safeNormalize(uLightDir + V);
        vec3 col = alb * (uAmbient * 0.6 + uLightColor * 0.5 * max(dot(n, uLightDir), 0.0)) + uLightColor * spow(dot(n, H), 60.0) * 0.8;
        gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
      }`,
  }));
  FISH.mesh.frustumCulled = false;
  FISH.mesh.renderOrder = 5;
  scene.add(FISH.mesh);
}
function waterSplash(x, z, big = 1) {
  const y = WATER_Y + 0.02, A = U.uAmbient.value, L = U.uLightColor.value;
  const c = [A.x * 0.8 + L.x * 0.4, A.y * 0.8 + L.y * 0.4, A.z * 0.8 + L.z * 0.45];
  for (let i = 0; i < 10 * big; i++) {
    const a = Math.random() * TAU, s = 0.5 + Math.random() * 0.9;
    fxAlpha.emit(x, y, z, Math.cos(a) * s * 0.6, 1.2 + Math.random() * 1.4 * big, Math.sin(a) * s * 0.6, 0.5, c[0], c[1], c[2], 0.06, 9, 0);
  }
  FX.ring(x, y + 0.02, z, 0.15, [c[0] * 0.5, c[1] * 0.5, c[2] * 0.5], 16, 1.1 * big);
}
function updateFish(dt) {
  if (!FISH.mesh) return;
  const P = GAME.player;
  FISH.next -= dt;
  if (FISH.next <= 0 && P && FISH.list.length < FISH.max) {
    FISH.next = 2.5 + Math.random() * 6;
    for (let tries = 0; tries < 12; tries++) {
      const a = Math.random() * TAU, d = 6 + Math.random() * 38;
      const x = P.x + Math.cos(a) * d, z = P.z + Math.sin(a) * d;
      if (heightAt(x, z) > WATER_Y - 0.7) continue;
      const h = Math.random() * TAU, L = 0.9 + Math.random() * 0.8;
      if (heightAt(x + Math.cos(h) * L, z + Math.sin(h) * L) > WATER_Y - 0.4) continue;
      FISH.list.push({ x, z, dx: Math.cos(h), dz: Math.sin(h), L, H: 0.45 + Math.random() * 0.45, t: 0, dur: 0.7 + Math.random() * 0.3, s: 0.8 + Math.random() * 0.7 });
      waterSplash(x, z, 0.7);
      break;
    }
  }
  const g = FISH.mesh.geometry, iA = g.attributes.iA.array, iB = g.attributes.iB.array;
  let n = 0;
  for (let i = FISH.list.length - 1; i >= 0; i--) {
    const f = FISH.list[i];
    f.t += dt;
    const k = f.t / f.dur;
    if (k >= 1) { waterSplash(f.x + f.dx * f.L, f.z + f.dz * f.L, 1); FISH.list.splice(i, 1); continue; }
    const x = f.x + f.dx * f.L * k, z = f.z + f.dz * f.L * k, y = WATER_Y + f.H * 4 * k * (1 - k) - 0.05;
    const vy = f.H * 4 * (1 - 2 * k) / f.dur, vh = f.L / f.dur;
    iA.set([x, y, z, renderTime], n * 4);
    iB.set([f.dx * vh, vy, f.dz * vh, f.s], n * 4);
    n++;
  }
  g.instanceCount = n;
  g.attributes.iA.needsUpdate = true; g.attributes.iB.needsUpdate = true;
}

function buildAmbientLife() { buildBirds(); buildButterflies(); buildFish(); }
function updateAmbientLife(dt) { updateBirds(dt); updateFish(dt); }
