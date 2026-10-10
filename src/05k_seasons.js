/* ================================================================== */
/* seasons (2 of 2): the year across the whole world. The clock is     */
/* SEASON (08h_farming.js); this module turns it into what you see and */
/* walk on: the broadleaves' colours and bare winter crowns, the       */
/* meadow and its flowers, snow lying where it is cold, lakes frozen   */
/* over in the northern winter, leaves drifting down in autumn,        */
/* fireflies on summer nights. Shader side: 02d_season.js.             */
/* ================================================================== */
// The season map (8 m texels over the land) holds each place's own warmth (realm and height, as farmTempAt reckons
// them) and the snow lying there: it builds where the air is below freezing (fast while it snows round the camera,
// slowly elsewhere: the snows that fell out of sight) and melts in the warmth, the rain and the spring thaw. So Thule
// and the high ground lie white all winter, the south whitens on cold winter nights and greens again by day.
// Lake ice: every lake and pond texel (not the running rivers) freezes by its own temperature through the year and
// thaws from the shallows in spring; ice 0.3 thick or more is a floor (floorAt, onIce, isWalkable ask seasonIceY).
const SEAS = {
  res: 128, cell: 8, warm: null, lie: null, bytes: null, tex: null, acc: 0, lastT: null, dirty: false, lieView: 0,
  cur: null, inited: false, leaves: null, hole: null, frozenN: 0, noted: { snow: -1, ice: -1 }, ice: null,
};
// the ice on the lakes and ponds: per water texel (2 m) that can freeze
const SICE = { on: false, ks: null, t0: null, shallow: null, thick: null, grid: null, vis: null, shore: null, meshes: [], next: 0, minX: 0, maxX: 0, minZ: 0, maxZ: 0 };

/* ------------------------------------------------------------------ */
/* the year's curves                                                    */
/* ------------------------------------------------------------------ */
// everything that changes through the year, from k (0 the first day of spring .. 1 the end of winter)
function seasonCurves(k) {
  k = ((k % 1) + 1) % 1;
  const raw = [0, 1, 2, 3].map((s) => { let d = Math.abs(k - (0.125 + 0.25 * s)); d = Math.min(d, 1 - d); return 1 - sstep(0.08, 0.17, d); });
  const sum = raw.reduce((a, b) => a + b, 0) || 1;
  return {
    k,
    A: raw.map((v) => v / sum), // spring, summer, autumn, winter
    turn: sstep(0.52, 0.66, k) * (1 - sstep(0.93, 0.98, k)), // the broadleaves' leaves turn gold, rust and red
    fall: k < 0.3 ? 0.65 * (1 - sstep(0.0, 0.05, k)) : k > 0.95 ? 1 - 0.35 * sstep(0.95, 1.0, k) : sstep(0.62, 0.78, k), // and fall; the buds break at the turn of the year
    blossom: sstep(0.02, 0.07, k) * (1 - sstep(0.12, 0.18, k)), // the fruit trees flower in spring
    fresh: k < 0.3 ? sstep(0.02, 0.08, k) * (1 - sstep(0.16, 0.26, k)) : 0, // the pale new green of spring
    flowers: sstep(0.02, 0.1, k) * (1 - sstep(0.55, 0.72, k)) * (0.7 + 0.3 * sstep(0.15, 0.3, k)),
    gold: sstep(0.32, 0.45, k) * (1 - sstep(0.52, 0.62, k)), // high summer burns the dry turf gold
    apples: sstep(0.5, 0.58, k) * (1 - sstep(0.8, 0.88, k)), // apples from late summer through autumn
    drift: sstep(0.58, 0.66, k) * (1 - sstep(0.76, 0.82, k)), // leaves drifting down
    summer: sstep(0.2, 0.3, k) * (1 - sstep(0.55, 0.62, k)), // warm nights: fireflies
  };
}
function seasonCur() { return SEAS.cur || (SEAS.cur = seasonCurves(SEASON.k)); }
// the canopy map's share of a tree's crown (03_terrain.js canopyOf): bare broadleaves still shade a little
function seasonCrownK(t) { return t.kind === 'pine' ? 1 : 1 - 0.78 * seasonCur().fall; }
// the air's temperature now before the place's own warmth: farmTempAt without the realm and the height
function seasonAirNow() {
  const night = U.uNight.value || 0;
  return SEASON.temp - 7 * night - 2.5 * (WEATHER.raining || 0) - 1.2 * (WEATHER.overcast || 0) * (1 - night) + 1.5 * (WEATHER.overcast || 0) * night;
}
// how many birds are about: fewer in winter
function seasonBirdK() { const A = seasonCur().A; return 1 - 0.6 * A[3] - 0.15 * A[2]; }

/* ------------------------------------------------------------------ */
/* the season map: each place's warmth and the snow lying there         */
/* ------------------------------------------------------------------ */
function seasonMapBuild() {
  const R = SEAS.res, c = SEAS.cell;
  SEAS.warm = new Float32Array(R * R); SEAS.lie = new Float32Array(R * R); SEAS.bytes = new Uint8Array(R * R * 4);
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const x = -HALF + (i + 0.5) * c, z = -HALF + (j + 0.5) * c, q = j * R + i;
    const rw = realmWeightsAt(x, z);
    let h = 0;
    for (const [dx, dz] of [[0, 0], [-3, -3], [3, -3], [-3, 3], [3, 3]]) h += heightAt(x + dx, z + dz);
    h /= 5;
    SEAS.warm[q] = rw[0] * 1.2 - rw[2] * 6.5 - Math.max(0, h - 6) * 0.3;
    SEAS.bytes[q * 4 + 1] = Math.round(clamp((SEAS.warm[q] + 30) / 40, 0, 1) * 255);
    SEAS.bytes[q * 4 + 3] = 255;
  }
  const T = new THREE.DataTexture(SEAS.bytes, R, R, THREE.RGBAFormat, THREE.UnsignedByteType);
  T.minFilter = THREE.LinearFilter; T.magFilter = THREE.LinearFilter; T.generateMipmaps = false;
  T.needsUpdate = true;
  SEAS.tex = T; U.uSeasonMap.value = T;
}
// the snow lying on the land: dts seconds of the year's clock
function seasonLieStep(dts) {
  const R = SEAS.res, c = SEAS.cell, L = SEAS.lie, Wm = SEAS.warm, B = SEAS.bytes;
  const air = seasonAirNow(), snowing = WEATHER.snowing || 0, rain = (WEATHER.raining || 0) * (1 - clamp(snowing * 3, 0, 1));
  const cx = (camera.position.x + HALF) / c, cz = (camera.position.z + HALF) / c, near2 = (300 / c) ** 2, view2 = (420 / c) ** 2;
  let vmax = 0;
  for (let j = 0; j < R; j++) for (let i = 0; i < R; i++) {
    const q = j * R + i, T = air + Wm[q], d2 = (i + 0.5 - cx) ** 2 + (j + 0.5 - cz) ** 2, near = d2 < near2 ? 1 : 0;
    let v = L[q];
    if (T < 0.5) v += dts * (0.00035 * Math.min(6, 0.3 + (0.5 - T)) + near * snowing / 70);
    else v -= dts * (T - 0.5) * 0.0011 * (1 + near * 1.5 * rain);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    L[q] = v;
    B[q * 4] = Math.round(v * 255);
    if (d2 < view2 && v > vmax) vmax = v;
  }
  SEAS.lieView = vmax;
  SEAS.dirty = true;
}
// what lies at (x, z): the season map read the way the shaders read it (bilinear)
function seasonMapSample(arr, x, z) {
  if (!arr) return 0;
  const R = SEAS.res, gx = clamp((x + HALF) / SEAS.cell - 0.5, 0, R - 1.001), gz = clamp((z + HALF) / SEAS.cell - 0.5, 0, R - 1.001);
  const i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, q = j * R + i;
  return lerp(lerp(arr[q], arr[q + 1], u), lerp(arr[q + R], arr[q + R + 1], u), v);
}
function seasonSnowLieAt(x, z) { return seasonMapSample(SEAS.lie, x, z); }

/* ------------------------------------------------------------------ */
/* lake ice                                                             */
/* ------------------------------------------------------------------ */
function seasonIceBuild() {
  const G = WATERGRID, S = G.surf, H = W.H, N2 = HN * HN;
  if (!S) return;
  const ks = [];
  let minX = 1e9, maxX = -1e9, minZ = 1e9, maxZ = -1e9;
  for (let k = 0; k < N2; k++) {
    if (isNaN(S[k]) || S[k] - H[k] < 0.05) continue;
    if (Math.hypot(G.fx[k], G.fz[k]) > 0.05) continue; // running water keeps flowing
    const i = k % HN, j = (k / HN) | 0, x = -HALF + i * HS, z = -HALF + j * HS;
    const rv = riverAt(x, z, 2.5);
    if (rv && rv.n.surf > WATER_Y + 0.05 && rv.n.d < rv.n.hw + 2.5) continue; // a river above its lake
    ks.push(k);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x); minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  const n = ks.length;
  SICE.ks = Int32Array.from(ks); SICE.t0 = new Float32Array(n); SICE.shallow = new Float32Array(n); SICE.thick = new Float32Array(n);
  SICE.grid = new Float32Array(N2); SICE.vis = new Float32Array(N2);
  SICE.minX = minX - 4; SICE.maxX = maxX + 4; SICE.minZ = minZ - 4; SICE.maxZ = maxZ + 4;
  const isIce = new Uint8Array(N2);
  for (let q = 0; q < n; q++) {
    const k = ks[q], i = k % HN, j = (k / HN) | 0, x = -HALF + i * HS, z = -HALF + j * HS;
    const rw = realmWeightsAt(x, z);
    SICE.t0[q] = rw[0] * 1.2 - rw[2] * 6.5 - Math.max(0, S[k] - 6) * 0.3;
    SICE.shallow[q] = 1 - clamp((S[k] - H[k]) / 2.5, 0, 1);
    isIce[k] = 1;
  }
  // the texels just round the ice (the water mesh reaches a texel or two onto the shore): they show their neighbours' ice
  const shore = [];
  for (let q = 0; q < n; q++) {
    const k = ks[q];
    for (let dj = -2; dj <= 2; dj++) for (let di = -2; di <= 2; di++) {
      const kk = k + dj * HN + di;
      if (kk < 0 || kk >= N2 || isIce[kk] || isNaN(G.ext[kk])) continue;
      isIce[kk] = 2; shore.push(kk);
    }
  }
  SICE.shore = shore.map((kk) => {
    const nb = [];
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) { const k2 = kk + dj * HN + di; if (k2 >= 0 && k2 < N2 && isIce[k2] === 1) nb.push(k2); }
    return [kk, nb];
  });
  // the water mesh's vertices that stand on or next to the ice
  SICE.meshes = [];
  for (const m of (typeof WATER_MESHES !== 'undefined' ? WATER_MESHES : [])) {
    const kv = m.userData.ks;
    if (!kv) continue;
    const vs = [], kk = [];
    for (let v = 0; v < kv.length; v++) if (isIce[kv[v]]) { vs.push(v); kk.push(kv[v]); }
    if (vs.length) SICE.meshes.push({ attr: m.geometry.attributes.aW, vs: Int32Array.from(vs), kk: Int32Array.from(kk) });
  }
}
// the ice through dts seconds of the year (its own temperature, no night or weather: it follows the season)
function seasonIceStep(dts, k = SEASON.k) {
  if (!SICE.ks) return;
  const base = seasonTempBase(k), ks = SICE.ks, t0 = SICE.t0, sh = SICE.shallow, th = SICE.thick, G = SICE.grid;
  let walk = 0;
  for (let q = 0; q < ks.length; q++) {
    const T = base + t0[q];
    let v = th[q];
    if (T < -1) v += dts * (-1 - T) * 6e-4 * (1 + 0.6 * sh[q]);
    else if (T > 0.5) v -= dts * (T - 0.5) * 7e-4 * (1 + 1.5 * sh[q]);
    v = v < 0 ? 0 : v > 1 ? 1 : v;
    th[q] = v; G[ks[q]] = v;
    if (v >= 0.3) walk++;
  }
  SICE.on = walk > 0;
  SEAS.frozenN = walk;
}
// the ice as it stands at this time of year: the whole year before now, run quickly
function seasonIceSettle() {
  if (!SICE.ks) return;
  SICE.thick.fill(0);
  const Y = SEASON.yearSec, step = 40;
  for (let t = SEASON.t - Y; t < SEASON.t; t += step) seasonIceStep(step, (((t / Y) % 1) + 1) % 1);
  seasonIceVisual(true);
}
// the ice on the water mesh (aW.w)
function seasonIceVisual(force) {
  if (!SICE.ks) return;
  const V = SICE.vis, G = SICE.grid;
  for (let q = 0; q < SICE.ks.length; q++) V[SICE.ks[q]] = G[SICE.ks[q]];
  for (const [kk, nb] of SICE.shore) { let m = 0; for (const k2 of nb) if (G[k2] > m) m = G[k2]; V[kk] = m; }
  for (const M of SICE.meshes) {
    const a = M.attr.array;
    let ch = false;
    for (let i = 0; i < M.vs.length; i++) {
      const o = M.vs[i] * 4 + 3, v = V[M.kk[i]];
      if (force || Math.abs(a[o] - v) > 0.004) { a[o] = v; ch = true; }
    }
    if (ch) M.attr.needsUpdate = true;
  }
}
// the ice's thickness at (x, z), bilinear over its texels (0 on open water or land)
function seasonIceAt(x, z) {
  if (!SICE.grid || x < SICE.minX || x > SICE.maxX || z < SICE.minZ || z > SICE.maxZ) return 0;
  const gx = (x + HALF) / HS, gz = (z + HALF) / HS, i = Math.floor(gx), j = Math.floor(gz), u = gx - i, v = gz - j, k = j * HN + i, G = SICE.grid;
  return lerp(lerp(G[k], G[k + 1], u), lerp(G[k + HN], G[k + HN + 1], u), v);
}
const _siW = { y: 0, depth: 0, fx: 0, fz: 0 };
// the top of ice that carries a body at (x, z), or null (floorAt, onIce and isWalkable ask)
function seasonIceY(x, z) {
  if (!SICE.on || x < SICE.minX || x > SICE.maxX || z < SICE.minZ || z > SICE.maxZ) return null;
  if (DIVE.holes.length && diveHoleAt(x, z)) return null; // [water2] a hole cut in the ice (07d_dive.js)
  if (seasonIceAt(x, z) < 0.3) return null;
  const w = waterAt(x, z, _siW);
  return w ? w.y + 0.05 : null;
}
// whoever swims or wades where the water freezes is lifted onto the ice: nobody stays under it
function seasonIceLift() {
  if (!SICE.on) return;
  for (const e of ENT) {
    if (!e.alive || e.fixedY !== null || e.hover || e.kind === 'door' || e.dive || e.x < SICE.minX || e.x > SICE.maxX || e.z < SICE.minZ || e.z > SICE.maxZ) continue; // [water2] a diver under the ice stays under it
    const y = seasonIceY(e.x, e.z);
    if (y !== null && e.y < y - 0.04 && e.y > y - 4) { e.y = y; e.swim = false; e.vy = 0; e.swimK = 0; }
  }
}

/* ------------------------------------------------------------------ */
/* leaves drifting down in autumn (the fireflies are 05b_actors.js's)   */
/* ------------------------------------------------------------------ */
function seasonParticleGeo(max, seed) {
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1, 1, 1);
  g.setAttribute('position', q.attributes.position);
  g.setAttribute('uv', q.attributes.uv);
  g.setIndex(q.index);
  const r = mulberry(seed), a = new Float32Array(max * 4);
  for (let i = 0; i < max * 4; i++) a[i] = r();
  g.setAttribute('aSeed', new THREE.InstancedBufferAttribute(a, 4));
  g.instanceCount = 0;
  return g;
}
const SEASON_LEAVES_MAX = 900;
function buildSeasonFx() {
  // leaves: each one tumbles as it falls, drifts with the wind and sways; they fall only under the crowns
  SEAS.leaves = new THREE.Mesh(seasonParticleGeo(SEASON_LEAVES_MAX, 91), mat({
    side: THREE.DoubleSide,
    uniforms: { uBox: { value: new THREE.Vector3(34, 13, 34) }, uAmount: { value: 0 } },
    vertexShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_WORLD}
      uniform float uTime, uWind, uAmount;
      uniform vec2 uWindDir;
      uniform vec3 uBox;
      attribute vec4 aSeed;
      varying vec2 vUv; varying vec3 vW; varying vec3 vCol; varying vec3 vN;
      void main(){
        vUv = uv; vW = vec3(0.0); vCol = vec3(0.0); vN = vec3(0.0, 1.0, 0.0);
        float fall = 0.55 + aSeed.w * 0.6;
        vec3 wind = vec3(uWindDir.x, 0.0, uWindDir.y) * (0.6 + uWind * 1.6);
        float s = aSeed.w * 60.0;
        vec3 sway = vec3(sin(uTime * 1.3 + s), 0.0, cos(uTime * 1.1 + s * 1.7)) * 0.7;
        vec3 p0 = aSeed.xyz * uBox + vec3(wind.x * uTime, -fall * uTime, wind.z * uTime) + sway;
        vec3 wp = cameraPosition + mod(p0 - cameraPosition + uBox * 0.5, uBox) - uBox * 0.5;
        float gy = terrainHeight(wp.xz);
        vec3 rel = wp - cameraPosition;
        float hd = length(rel.xz);
        vec4 B = texture(uWorldB, worldUV(wp.xz));
        float k = uAmount * smoothstep(0.08, 0.4, canopyAt(wp.xz)) * (1.0 - 0.75 * B.b) * step(0.25, fract(aSeed.x * 17.3) + uAmount);
        if (k < 0.05 || wp.y < gy + 0.05 || wp.y > gy + 9.0 || hd > uBox.x * 0.5) { gl_Position = vec4(0.0, 0.0, -2.0, 1.0); return; }
        // tumbling: the leaf turns over and over as it falls
        float a1 = uTime * (1.6 + aSeed.y * 2.0) + s, a2 = uTime * (1.1 + aSeed.z * 1.5) + s * 0.7;
        vec3 ax = vec3(cos(a1), sin(a1) * 0.6, sin(a1) * 0.8);
        vec3 ay = safeNormalize(cross(ax, vec3(sin(a2), cos(a2), 0.3)));
        float sz = (0.09 + 0.06 * aSeed.y) * smoothstep(0.0, 0.3, k);
        vec3 p = wp + (ax * (position.x * 1.25) + ay * position.y) * sz;
        vW = p; vN = safeNormalize(cross(ax, ay));
        float h = fract(aSeed.z * 7.13);
        vCol = h < 0.35 ? vec3(0.95, 0.66, 0.14) : h < 0.6 ? vec3(0.82, 0.3, 0.08) : h < 0.82 ? vec3(0.56, 0.36, 0.15) : vec3(0.74, 0.16, 0.08);
        gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
      }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying vec2 vUv; varying vec3 vW; varying vec3 vCol; varying vec3 vN;
      void main(){
        // a pointed leaf with a midrib
        vec2 q = vUv * 2.0 - 1.0;
        float w = (1.0 - q.x * q.x) * (0.62 - 0.22 * q.x);
        if (abs(q.y) > w) discard;
        vec3 c = vCol * (0.85 + 0.25 * vnoise(vUv * 9.0));
        c *= 1.0 - 0.35 * (1.0 - smoothstep(0.0, 0.06, abs(q.y))) * step(-0.9, q.x);
        float ndl = abs(dot(safeNormalize(vN), uLightDir));
        gl_FragColor = vec4(safeColor(applyFog(c * (uAmbient * 0.75 + uLightColor * (0.35 + 0.45 * ndl)), vW)), 1.0);
      }`,
  }));
  SEAS.leaves.frustumCulled = false; SEAS.leaves.renderOrder = 5;
  scene.add(SEAS.leaves);
  // a hole cut in the ice to fish through: dark water in a ring of broken ice
  const hg = new THREE.RingGeometry(0.02, 0.55, 20, 2);
  hg.rotateX(-Math.PI / 2);
  SEAS.hole = new THREE.Mesh(hg, mat({
    transparent: true, depthWrite: false,
    vertexShader: /* glsl */`varying vec3 vW; varying vec2 vP; void main(){ vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; vP = position.xz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      ${GLSL_COMMON}
      ${GLSL_ATMOS}
      varying vec3 vW; varying vec2 vP;
      void main(){
        float r = length(vP) / 0.55 + (vnoise(vP * 9.0) - 0.5) * 0.18;
        if (r > 1.0) discard;
        vec3 water = vec3(0.02, 0.05, 0.06) * (uAmbient + uLightColor * 0.4) + skyBase(vec3(0.0, 1.0, 0.0)) * 0.08;
        vec3 rim = vec3(0.75, 0.82, 0.86) * (uAmbient * 0.8 + uLightColor * 0.6) * (0.85 + 0.3 * vnoise(vP * 23.0));
        float k = smoothstep(0.62, 0.8, r);
        gl_FragColor = vec4(safeColor(applyFog(mix(water, rim, k), vW)), mix(0.97, 0.9, k) * (1.0 - smoothstep(0.93, 1.0, r)));
      }`,
  }));
  SEAS.hole.visible = false; SEAS.hole.renderOrder = 4;
  scene.add(SEAS.hole);
}

/* ------------------------------------------------------------------ */
/* each step and each frame                                             */
/* ------------------------------------------------------------------ */
function seasonsInit() {
  if (SEAS.inited || !W.H || !WATERGRID.surf || typeof WATER_MESHES === 'undefined' || !WATER_MESHES.length) return;
  SEAS.inited = true;
  seasonMapBuild();
  seasonIceBuild();
  buildSeasonFx();
  seasonSettle();
  if (typeof FIELD_NOTES === 'object') {
    FIELD_NOTES.snowlies = { t: 'Snow on the land', x: () => 'Snow lies where the air is below freezing: all winter in Thule and on the high ground, on cold winter nights in the south, gone again by day. It settles on roofs and boughs, slows the grazing herds and chills you without a fire or a roof.' };
    FIELD_NOTES.lakeice = { t: 'The lakes freeze', x: () => `In deep winter the lakes and ponds of Thule and the high tarns freeze over; the rivers keep running. Thick ice carries you and your beasts across, and you can fish through a hole in it${IS_TOUCH ? '' : ' (E with a rod)'}. In the spring thaw it goes thin and dark at the edges first: keep off it then.` };
  }
  if (window.__hm) window.__hm.seasons = seasonHooks();
}
// after a jump of the year's clock (a test, a loaded save): the snow and the ice as they would be now
function seasonSettle() {
  SEAS.cur = seasonCurves(SEASON.k);
  seasonIceSettle();
  if (SEAS.lie) { SEAS.lie.fill(0); for (let n = 0; n < 40; n++) seasonLieStep(30); }
  SEAS.lastT = SEASON.t;
  if (typeof CANOPY !== 'undefined' && CANOPY.tex) CANOPY.next = 0;
}
// the simulation step (13_main.js simStep, after the farming has moved the year on)
function updateSeasons(dt) {
  seasonsInit();
  if (!SEAS.inited) return;
  const Y = SEASON.yearSec;
  let moved = SEASON.t - SEAS.lastT;
  if (moved < -Y / 2) moved += Y;
  if (moved > Y / 2) moved -= Y;
  if (Math.abs(moved - dt * FARM.speed) > 60) { seasonSettle(); return; }
  SEAS.acc += moved;
  SEAS.lastT = SEASON.t;
  if (SEAS.acc >= 1) {
    const s = SEAS.acc;
    SEAS.acc = 0;
    SEAS.cur = seasonCurves(SEASON.k);
    seasonLieStep(s);
    const wasOn = SICE.on;
    seasonIceStep(s);
    if (SICE.on) seasonIceLift();
    if (SICE.on || wasOn) seasonIceVisual(false);
  }
}
// the frame (13_main.js tick, right after the weather): the uniforms, the snow cover, leaves, fireflies, notes
function seasonsFrame(dt) {
  seasonsInit();
  if (!SEAS.inited) return;
  const C = SEAS.cur = seasonCurves(SEASON.k);
  U.uSeasonA.value.set(C.A[0], C.A[1], C.A[2], C.A[3]);
  U.uSeasonB.value.set(C.turn, C.fall, C.blossom, C.fresh);
  U.uSeasonC.value.set(C.flowers, C.gold, clamp((10 - SEASON.temp) * 1.1, -8, 10), seasonAirNow());
  const night = U.uNight.value || 0, outdoors = !INDOOR.on;
  const flies = C.summer * sstep(0.45, 0.8, night) * (1 - clamp((WEATHER.raining || 0) * 1.5, 0, 1)) * (outdoors ? 1 : 0);
  const drift = C.drift * (outdoors ? 1 : 0);
  U.uSeasonD.value.set(C.apples, drift, flies, 0);
  // the light of the year: a pale, cool winter sun, a warm summer and a mellow autumn; colours fuller in autumn,
  // quieter in winter (on top of the time of day, which applyTimeOfDay set this frame)
  const A = C.A, Lc = U.uLightColor.value, Am = U.uAmbient.value, G = composite.uniforms.uGrade.value;
  Lc.set(Lc.x * (1 + 0.03 * A[1] + 0.03 * A[2] - 0.07 * A[3]), Lc.y * (1 - 0.01 * A[2] - 0.04 * A[3]), Lc.z * (1 - 0.04 * A[1] - 0.08 * A[2] + 0.03 * A[3]));
  Am.set(Am.x * (1 - 0.04 * A[3]), Am.y * (1 - 0.01 * A[3]), Am.z * (1 + 0.05 * A[3]));
  G.x *= 1 + 0.06 * A[2] - 0.12 * A[3];
  // the snow: the weather's own round the camera, and the winter's lying snow (02d_season.js explains the pair)
  const Wsnow = WEATHER.snow || 0, here = seasonSnowLieAt(camera.position.x, camera.position.z);
  const cover = INDOOR.on ? 0 : Math.max(Wsnow, here, SEAS.lieView > 0.03 ? 0.02 : 0);
  U.uSnowCover.value = cover;
  U.uSnowK.value.set(Wsnow, 1 / Math.max(cover, 0.01));
  if (SEAS.dirty && SEAS.tex) { SEAS.tex.needsUpdate = true; SEAS.dirty = false; }
  const q = quality.level === 'high' ? 1 : quality.level === 'medium' ? 0.6 : 0.35;
  if (SEAS.leaves) {
    SEAS.leaves.material.uniforms.uAmount.value = drift;
    SEAS.leaves.geometry.instanceCount = drift > 0.02 ? Math.round(SEASON_LEAVES_MAX * q) : 0;
  }
  // fishing through the ice: a hole where the float lies
  const F = typeof SURV !== 'undefined' ? SURV.fish : null;
  if (SEAS.hole) {
    const on = !!(F && seasonIceAt(F.bx, F.bz) > 0.12);
    SEAS.hole.visible = on;
    if (on) { const w = waterAt(F.bx, F.bz); SEAS.hole.position.set(F.bx, (w ? w.y : heightAt(F.bx, F.bz)) + 0.035 + smoothstep01(seasonIceAt(F.bx, F.bz)) * 0.03, F.bz); }
  }
  // field notes: the first snow lying where you stand, and the lakes freezing over
  const P = GAME.player;
  if (P && typeof loreNote === 'function' && GAME.prog) {
    const yr = Math.floor(SEASON.t / SEASON.yearSec);
    if ((here > 0.35 || (WEATHER.snowing || 0) > 0.35) && SEAS.noted.snow !== SEASON.idx) { SEAS.noted.snow = SEASON.idx; loreNote('snowlies'); }
    if (SEAS.frozenN > 40 && SEAS.noted.ice !== yr) { SEAS.noted.ice = yr; loreNote('lakeice'); }
  }
}
const smoothstep01 = (x) => sstep(0.1, 0.5, x);

/* ------------------------------------------------------------------ */
/* the Chronicle, and the test hooks                                    */
/* ------------------------------------------------------------------ */
// a paragraph for the Chronicle's Fields page (08h_farming.js)
function seasonsChronicleHTML() {
  const C = seasonCur();
  const now = C.A[3] > 0.5 ? (SICE.on ? 'Now the northern lakes are frozen hard enough to walk on, and snow lies on Thule and the heights.' : 'Now the snow comes to the north and the high ground, and the lakes of Thule are icing over.')
    : C.A[2] > 0.5 ? 'Now the broadleaves are turning gold and red, and their leaves are coming down.'
      : C.A[1] > 0.5 ? 'Now the meadows are high and the dry turf is burning gold; on warm nights the fireflies come out.'
        : 'Now the woods are in fresh leaf, the orchards in blossom and the meadows full of flowers.';
  return `<h3>The year on the land</h3>
    <p>The whole March turns with the year. In spring the broadleaves come into pale new leaf, the apple trees of the Logres orchards flower and the meadows fill with white, yellow and blue. Summer deepens the green and burns the dry turf gold; butterflies are about by day, fireflies on warm nights, and the apples set. In autumn the oaks and birches turn gold, rust and red and drop their leaves, the grass goes tawny and the last flowers fade. Winter strips the broadleaves bare (the pines keep their needles and carry the snow), lays the meadows down brown and frosted, and brings the snow: all winter in Thule and on the high ground, on cold nights in the south.</p>
    <p>In deep winter the lakes and ponds of Thule and the high tarns freeze over, though the rivers keep running. Thick ice carries people and beasts; nobody swims under it, and you can fish through a hole in it. It thaws from the shallow edges in spring, going dark and thin first. ${now}</p>
    <p>Every town keeps its gardens through the year: grain, beans and roots in the strips of Brackenford, herbs, beans and greens in the gardens of Ériu, hardy turnips and cabbages in the beds of Thule.</p>`;
}
function seasonHooks() {
  return {
    SEAS, SICE, seasonCurves, seasonCur, seasonCrownK, seasonAirNow, seasonSettle, seasonIceY, seasonIceAt, seasonSnowLieAt, seasonBirdK,
    curves: () => { const C = seasonCurves(SEASON.k); return { k: C.k, A: C.A, turn: C.turn, fall: C.fall, blossom: C.blossom, fresh: C.fresh, flowers: C.flowers, gold: C.gold, apples: C.apples, drift: C.drift, summer: C.summer }; },
    uniforms: () => ({ A: U.uSeasonA.value.toArray(), B: U.uSeasonB.value.toArray(), C: U.uSeasonC.value.toArray(), D: U.uSeasonD.value.toArray(), snowCover: U.uSnowCover.value, snowK: U.uSnowK.value.toArray() }),
    // the temperature the season map gives (with the air now) next to farmTempAt's own
    temps: (x, z) => ({ map: seasonAirNow() + seasonMapSample(SEAS.warm, x, z), farm: farmTempAt(x, z) }),
    lie: (x, z) => seasonSnowLieAt(x, z),
    ice: (x, z) => ({ thick: seasonIceAt(x, z), y: seasonIceY(x, z), water: waterAt(x, z) ? +waterAt(x, z).y.toFixed(3) : null }),
    // walkable ice texels by realm; lake: on the realm lakes (at WATER_Y), tarns: the frozen ponds' surfaces (m)
    frozen: () => { const out = [0, 0, 0], all = [0, 0, 0], lake = [0, 0, 0], tarns = []; if (SICE.ks) for (let q = 0; q < SICE.ks.length; q++) { const k = SICE.ks[q], x = -HALF + (k % HN) * HS, z = -HALF + ((k / HN) | 0) * HS, r = realmAt(x, z), sy = WATERGRID.surf[k]; all[r]++; if (SICE.thick[q] >= 0.3) { out[r]++; if (sy < WATER_Y + 0.05) lake[r]++; else if (!tarns.some((t) => t[0] === r && t[1] === Math.round(sy))) tarns.push([r, Math.round(sy)]); } } return { walkable: out, texels: all, lake, tarns, on: SICE.on }; },
    lakes: () => LAKES.map((L) => ({ x: L.x, z: L.z, r: L.r, realm: L.realm })),
    treesNear: (x, z, r, kind) => W.trees.map((t, i) => ({ i, kind: t.kind, x: t.x, z: t.z, y: t.y, s: t.s, d: Math.hypot(t.x - x, t.z - z) })).filter((t) => t.d < r && (!kind || t.kind === kind)).sort((a, b) => a.d - b.d),
    // the town fields and gardens, and any tree standing in one (there should be none)
    fields: () => (W.fieldRects || []).map((F) => { const c = Math.cos(F.ang), s = Math.sin(F.ang); const inside = W.trees.filter((t) => { const lx = (t.x - F.x) * c - (t.z - F.z) * s, lz = (t.x - F.x) * s + (t.z - F.z) * c; return Math.abs(lx) < F.hw + 0.5 && Math.abs(lz) < F.hd + 0.5; }).length; return { x: F.x, z: F.z, hw: F.hw, hd: F.hd, realm: F.realm || 0, garden: !!F.garden, trees: inside }; }),
    trees: () => W.trees.length,
    realmAt: (x, z) => realmAt(x, z),
    step: (sec) => { const n = Math.ceil(sec); for (let i = 0; i < n; i++) { SEAS.acc += 1; seasonLieStep(1); seasonIceStep(1); } seasonIceVisual(true); seasonIceLift(); },
  };
}
