/* ================================================================== */
/* [water2] tracks: footprints in snow, mud and wet sand; ruts; drifts  */
/* ================================================================== */
// Bodies leave tracks where the ground takes them: boots, hooves, paws and birds' feet in lying snow, in the mud after
// rain and on the wet sand at the water's edge; siege engines cut wheel ruts. Every print is a small decal laid on the
// ground where a foot came down (one instanced draw, a ring of the newest prints, sized by quality); its shape is drawn
// in the shader. New snow fills prints in, dry weather takes them out of the mud and the sand, the snow melting takes
// them with it, and a later print laid over an earlier one cuts it out. Deep snow drifts against the windward faces of
// walls, houses and fences wherever snow lies (a mesh of wedges against them, raised by the snow lying there).
const TRACKS = { built: false, mesh: null, max: 0, head: 0, n: 0, cells: new Map(), born: null, snowAcc: 0, dryAcc: 0, drifts: [], driftOn: false, laid: 0, cut: 0, ruts: 0, visT: 0, dirty: false, lo: Infinity, hi: -1 };
const TRK_MAX = { high: 1600, medium: 1000, low: 520 };
const TRK_KIND = { boot: 0, hoof: 1, paw: 2, bird: 3, rut: 4 };
// beasts' feet: kind, print size, where the fore and hind feet fall along the body, and how far apart the two sides are
const TRK_BEAST = {
  wolf: [2, 0.11, 0.46, -0.42, 0.11], hound: [2, 0.1, 0.42, -0.38, 0.1], bear: [2, 0.22, 0.6, -0.55, 0.2], boar: [1, 0.075, 0.38, -0.36, 0.1], pig: [1, 0.065, 0.34, -0.32, 0.1],
  deer: [1, 0.085, 0.5, -0.45, 0.1], stag: [1, 0.095, 0.55, -0.5, 0.11], horse: [1, 0.15, 0.72, -0.62, 0.15], cattle: [1, 0.14, 0.7, -0.6, 0.17], bull: [1, 0.15, 0.72, -0.62, 0.18],
  sheep: [1, 0.065, 0.36, -0.33, 0.09], hen: [3, 0.075, 0.02, 0.02, 0.04], bird: [3, 0.08, 0.02, 0.02, 0.05],
};
const trkMat = mat({
  transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
  uniforms: { uTrk: { value: new THREE.Vector4() } }, // snow fallen so far, dryness so far, game time, far fade
  vertexShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_WORLD}
    attribute vec4 iP; attribute vec4 iK; attribute vec4 iT;
    varying vec2 vL; varying vec3 vW; varying vec4 vK; varying vec4 vT; varying float vYaw;
    void main(){
      vec2 l = vec2(position.x * iT.w, position.y) * iP.w;
      float c = cos(iP.z), s = sin(iP.z);
      vec2 xz = iP.xy + vec2(l.x * c + l.y * s, -l.x * s + l.y * c);
      vec3 w = vec3(xz.x, terrainHeight(xz) + 0.02, xz.y);
      vL = vec2(position.x * iK.y, position.y); vW = w; vK = iK; vT = iT; vYaw = iP.z;
      gl_Position = iK.w > 0.001 ? projectionMatrix * viewMatrix * vec4(w, 1.0) : vec4(0.0, 0.0, -2.0, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SEASON}
    uniform vec4 uTrk;
    uniform float uSnowCover;
    varying vec2 vL; varying vec3 vW; varying vec4 vK; varying vec4 vT; varying float vYaw;
    float ell(vec2 p, vec2 c, vec2 r){ vec2 q = (p - c) / r; return 1.0 - smoothstep(0.75, 1.0, dot(q, q)); }
    float seg(vec2 p, vec2 a, vec2 b, float w){ vec2 pa = p - a, ba = b - a; float h = clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0); return 1.0 - smoothstep(w * 0.6, w, length(pa - ba * h)); }
    // how deep the print is at p (local: x across -0.5..0.5, y along, toes at +y)
    float printD(vec2 p, int k){
      if (k == 0) { // a boot: the sole's ball and the heel, a waist between, tread across
        float d = max(ell(p, vec2(0.04, 0.17), vec2(0.42, 0.3)), ell(p, vec2(-0.02, -0.3), vec2(0.36, 0.19)));
        d = max(d, ell(p, vec2(0.0, -0.06), vec2(0.27, 0.2)) * 0.8);
        return d * (0.85 + 0.15 * step(0.5, fract(p.y * 9.0)));
      }
      if (k == 1) { // a hoof: a cloven or round rim, deeper at the toe
        float o = ell(p, vec2(0.0, 0.0), vec2(0.46, 0.5)), i = ell(p, vec2(0.0, -0.12), vec2(0.24, 0.3));
        return max(o - i * 0.65, 0.0) * (0.8 + 0.2 * smoothstep(-0.3, 0.4, p.y)) * (1.0 - 0.6 * (1.0 - smoothstep(0.02, 0.06, abs(p.x))) * step(0.0, p.y));
      }
      if (k == 2) { // a paw: the pad and four toes with their claws
        float d = ell(p, vec2(0.0, -0.18), vec2(0.3, 0.24));
        d = max(d, ell(p, vec2(-0.27, 0.12), vec2(0.1, 0.12))); d = max(d, ell(p, vec2(0.27, 0.12), vec2(0.1, 0.12)));
        d = max(d, ell(p, vec2(-0.1, 0.27), vec2(0.1, 0.13))); d = max(d, ell(p, vec2(0.1, 0.27), vec2(0.1, 0.13)));
        d = max(d, ell(p, vec2(-0.13, 0.45), vec2(0.035, 0.05)) * 0.7); d = max(d, ell(p, vec2(0.13, 0.45), vec2(0.035, 0.05)) * 0.7);
        return d;
      }
      if (k == 3) { // a bird: three toes forward and one back
        vec2 o = vec2(0.0, -0.1);
        float d = seg(p, o, vec2(-0.32, 0.38), 0.07); d = max(d, seg(p, o, vec2(0.0, 0.48), 0.07)); d = max(d, seg(p, o, vec2(0.32, 0.38), 0.07));
        return max(d, seg(p, o, vec2(0.0, -0.42), 0.06));
      }
      // a wheel rut: a trough with the tyre's edge
      return (1.0 - smoothstep(0.32, 0.5, abs(p.x))) * (0.85 + 0.15 * step(0.5, fract(p.y * 7.0)));
    }
    void main(){
      int k = int(vK.x + 0.5), surf = int(vK.z + 0.5);
      vec2 p = vL;
      float d = printD(p, k);
      // the rim pushed up round it, and which side the light comes from (a dent is lit on its far wall)
      float e = 0.035;
      float gx = printD(p + vec2(e, 0.0), k) - printD(p - vec2(e, 0.0), k), gy = printD(p + vec2(0.0, e), k) - printD(p - vec2(0.0, e), k);
      float c = cos(vYaw), s = sin(vYaw);
      vec2 gw = vec2(gx * c + gy * s, -gx * s + gy * c);
      float side = dot(gw, normalize(uLightDir.xz + 1e-4)) / (2.0 * e);
      float rim = clamp(length(vec2(gx, gy)) / (2.0 * e) * 0.18, 0.0, 1.0) * (1.0 - d);
      float age = uTrk.z - vT.z;
      float fade = vK.w * (1.0 - smoothstep(0.7, 1.0, age / 900.0));
      fade *= 1.0 - smoothstep(uTrk.w * 0.75, uTrk.w, length(vW.xz - cameraPosition.xz));
      vec3 col; float a;
      if (surf == 0) {
        // snow: a blue shadow in the dent, the lit wall and the rim catching the light; new snow fills it in
        float fill = clamp((uTrk.x - vT.x) / 2.2, 0.0, 1.0);
        float lie = smoothstep(0.12, 0.4, uSnowCover * snowHere(vW));
        float sh = clamp(0.55 - side * 0.45, 0.1, 1.0);
        col = mix(vec3(0.42, 0.5, 0.68) * (uAmbient * 0.9 + uLightColor * 0.15), vec3(0.85, 0.9, 1.0) * (uAmbient * 0.6 + uLightColor * 0.6), clamp(-side * 0.6, 0.0, 1.0));
        a = (d * 0.55 * sh + rim * 0.2) * (1.0 - fill) * lie;
        col = mix(col, vec3(0.95, 0.97, 1.0) * (uAmbient * 0.6 + uLightColor * 0.7), rim / max(d * sh + rim, 1e-3) * 0.6);
      } else if (surf == 1) {
        // mud: dark, wet, a film of water in the deepest part catching the sky; it dries out of the ground
        float dry = clamp((uTrk.y - vT.y) / 240.0, 0.0, 1.0);
        vec3 V = safeNormalize(cameraPosition - vW);
        float fres = spow(1.0 - max(V.y, 0.0), 3.0);
        col = mix(vec3(0.07, 0.05, 0.035), skyBase(vec3(-V.x, 0.4, -V.z)) * 0.55, smoothstep(0.6, 1.0, d) * fres * (1.0 - dry));
        a = (d * 0.62 + rim * 0.12) * (1.0 - dry * 0.92);
      } else {
        // wet sand at the water's edge: a darker hollow, gone as the sand dries
        float dry = clamp((uTrk.y - vT.y) / 150.0, 0.0, 1.0);
        col = vec3(0.13, 0.1, 0.07) * (uAmbient + uLightColor * 0.4);
        a = (d * 0.5 + rim * 0.1) * (1.0 - dry);
      }
      a *= fade;
      if (a < 0.01) discard;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), clamp(a, 0.0, 1.0));
    }`,
});
function buildTracks() {
  if (TRACKS.built) return;
  TRACKS.built = true;
  const max = TRACKS.max = TRK_MAX.high;
  const g = new THREE.InstancedBufferGeometry();
  const q = new THREE.PlaneGeometry(1, 1, 2, 2);
  g.setAttribute('position', q.attributes.position);
  g.setIndex(q.index);
  for (const [name, n] of [['iP', 4], ['iK', 4], ['iT', 4]]) g.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(max * n), n).setUsage(THREE.DynamicDrawUsage));
  g.instanceCount = 0;
  const m = new THREE.Mesh(g, trkMat);
  m.frustumCulled = false; m.renderOrder = 2;
  scene.add(m);
  TRACKS.mesh = m;
  TRACKS.cellOf = new Int32Array(max).fill(-1);
  buildDrifts();
}
const trkCell = (x, z) => ((Math.floor(x / 0.6) + 4096) << 13) | (Math.floor(z / 0.6) + 4096);
// lay one print; kill whatever earlier print it lands on (a later track cuts an earlier one)
function trkLay(x, z, yaw, kind, size, side, surf, width = 0.42) {
  const T = TRACKS, M = T.mesh;
  if (!M) return -1;
  const cap = Math.min(T.max, TRK_MAX[quality.level] || T.max);
  const A = M.geometry.attributes, cell = trkCell(x, z);
  if (kind !== TRK_KIND.rut) {
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const L = T.cells.get(cell + di * 8192 + dj);
      if (!L) continue;
      for (const i of L) {
        const o = i * 4;
        if (A.iK.array[o + 3] <= 0 || A.iK.array[o] === TRK_KIND.rut) continue;
        const dx = A.iP.array[o] - x, dz = A.iP.array[o + 1] - z, r = (A.iP.array[o + 3] + size) * 0.36;
        if (dx * dx + dz * dz < r * r) { A.iK.array[o + 3] = 0; T.cut++; trkMark(i); }
      }
    }
  }
  const i = T.head % cap;
  T.head = (T.head + 1) % cap;
  T.n = Math.min(cap, T.n + 1);
  // the slot's old print leaves its cell
  const oc = T.cellOf[i];
  if (oc !== -1) { const L = T.cells.get(oc); if (L) { const k = L.indexOf(i); if (k >= 0) L.splice(k, 1); if (!L.length) T.cells.delete(oc); } }
  T.cellOf[i] = cell;
  let L = T.cells.get(cell); if (!L) T.cells.set(cell, L = []); L.push(i);
  const o = i * 4;
  A.iP.array[o] = x; A.iP.array[o + 1] = z; A.iP.array[o + 2] = yaw; A.iP.array[o + 3] = size;
  A.iK.array[o] = kind; A.iK.array[o + 1] = side; A.iK.array[o + 2] = surf; A.iK.array[o + 3] = 1;
  A.iT.array[o] = T.snowAcc; A.iT.array[o + 1] = T.dryAcc; A.iT.array[o + 2] = GAME.t; A.iT.array[o + 3] = width;
  trkMark(i);
  M.geometry.instanceCount = T.n;
  T.laid++;
  return i;
}
function trkMark(i) { const T = TRACKS; T.dirty = true; T.lo = Math.min(T.lo, i); T.hi = Math.max(T.hi, i); }
// what the ground at (x, z) takes a print in: 0 snow, 1 mud, 2 wet sand; -1 none
function trkSurface(x, z) {
  if (x > DUN_X0 || waterAt(x, z, _trkW)) return -1;
  const g = heightAt(x, z);
  const snow = Math.max(typeof seasonSnowLieAt === 'function' ? seasonSnowLieAt(x, z) : 0, dist2(x, z, camera.position.x, camera.position.z) < 40 * 40 ? WEATHER.snow || 0 : 0);
  if (snow > 0.3) return 0;
  if (sampleGrid(W.rock, x, z) > 0.45) return -1;
  // the wet band by the water: a lake, a pond or a river within a few steps, the ground not much above it
  for (const [dx, dz] of TRK_RING) { const w = waterAt(x + dx, z + dz, _trkW); if (w && g - w.y < 0.55) return 2; }
  if ((U.uWet.value || 0) > 0.32 || (WEATHER.raining || 0) > 0.3) return 1;
  return -1;
}
const _trkW = { y: 0, depth: 0, fx: 0, fz: 0 };
const TRK_RING = [[1.4, 0], [-1.4, 0], [0, 1.4], [0, -1.4], [2.4, 1.2], [-2.4, -1.2], [1.2, -2.4], [-1.2, 2.4]];
function tracksUpdate(dt) {
  if (!TRACKS.built) return;
  const T = TRACKS;
  // the clocks the prints are read against: snow fallen, and drying (sun and wind, not rain)
  T.snowAcc += dt * (WEATHER.snowing || 0) * 0.9;
  T.dryAcc += dt * ((WEATHER.raining || 0) > 0.15 ? 0 : 0.45 + 0.55 * (1 - U.uNight.value));
  const cam = camera.position, P = GAME.player;
  for (const e of ENT) {
    if (e.removed || !e.alive) continue;
    const dx = e.x - cam.x, dz = e.z - cam.z;
    if (dx * dx + dz * dz > 42 * 42) { e._tkS = undefined; continue; }
    if (e.siegeEngine) { trkRuts(e); continue; }
    if (e.kind === 'door' || e.kind === 'wisp' || e.kind === 'dragon' || e.fixedY !== null || e.flying || e.swim || e.dive || e.boat || e.seat || e.motion) { e._tkS = undefined; continue; }
    const sc = e.scale || 1;
    const g = heightAt(e.x, e.z);
    if (e.y > g + 0.25 || e.y < g - 0.3 || (e.wd || 0) > 0.05) { e._tkS = undefined; continue; } // on a floor, in the air, in the water
    const B = e.kind === 'humanoid' ? null : TRK_BEAST[e.crowd] || TRK_BEAST[e.kind] || (e.role === 'bird' ? TRK_BEAST.bird : null);
    if (e.kind !== 'humanoid' && !B) continue;
    const step = Math.floor(e.anim.phase / Math.PI);
    if (e._tkS === undefined) { e._tkS = step; continue; }
    if (step === e._tkS) continue;
    e._tkS = step;
    if (e.anim.amt < 0.05) continue;
    const side = step & 1 ? 1 : -1, fx = Math.sin(e.yaw), fz = Math.cos(e.yaw), rx = Math.cos(e.yaw), rz = -Math.sin(e.yaw);
    if (e.kind === 'humanoid' && !e.mount) {
      const x = e.x + fx * 0.08 * sc + rx * side * 0.11 * sc, z = e.z + fz * 0.08 * sc + rz * side * 0.11 * sc;
      const surf = trkSurface(x, z);
      if (surf >= 0) trkLay(x, z, e.yaw - side * 0.07, TRK_KIND.boot, 0.29 * sc, side, surf, 0.42);
    } else {
      const K = e.mount ? TRK_BEAST.horse : B, s2 = e.mount ? 1 : sc;
      for (const [along, k2] of [[K[2], 0], [K[3], 1]]) {
        if (K[0] === TRK_KIND.bird && k2) continue;
        const sd = k2 ? -side : side;
        const x = e.x + fx * along * s2 + rx * sd * K[4] * s2, z = e.z + fz * along * s2 + rz * sd * K[4] * s2;
        const surf = trkSurface(x, z);
        if (surf >= 0) trkLay(x, z, e.yaw, K[0], K[1] * s2 * (K[0] === TRK_KIND.hoof ? 1.15 : 1.2), sd, surf, K[0] === TRK_KIND.hoof ? 0.85 : 0.8);
      }
    }
  }
  if (P && P.alive && typeof loreNote === 'function' && T.laid > 30 && trkSurface(P.x, P.z) === 0 && P.anim.amt > 0.1) loreNote('tracks');
}
// a siege engine rolling: two ruts from its wheels, laid as it goes
function trkRuts(e) {
  if (e._tkX === undefined) { e._tkX = e.x; e._tkZ = e.z; return; }
  const dx = e.x - e._tkX, dz = e.z - e._tkZ, d = Math.hypot(dx, dz);
  if (d < 0.5) return;
  if (d > 4) { e._tkX = e.x; e._tkZ = e.z; return; }
  const yaw = Math.atan2(dx, dz), mx = (e.x + e._tkX) / 2, mz = (e.z + e._tkZ) / 2, rx = Math.cos(yaw), rz = -Math.sin(yaw), half = Math.max(0.8, (e.radius || 2) * 0.55);
  for (const sd of [-1, 1]) {
    const x = mx + rx * sd * half, z = mz + rz * sd * half;
    let surf = trkSurface(x, z);
    if (surf < 0 && sampleGrid(W.rock, x, z) < 0.45) surf = 1; // a heavy wheel marks dry ground too
    if (surf >= 0) { trkLay(x, z, yaw, TRK_KIND.rut, d + 0.1, 1, surf, 0.24 / (d + 0.1)); TRACKS.ruts++; }
  }
  e._tkX = e.x; e._tkZ = e.z;
}

/* ------------------------------------------------------------------ */
/* drifts against walls, houses and fences                              */
/* ------------------------------------------------------------------ */
const DRIFT_TAGS = new Set(['wall', 'house', 'hdoor', 'fence', 'stone', 'gate']);
const driftMat = mat({
  vertexShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_WORLD}
    uniform float uSnowCover;
    uniform vec2 uSnowK;
    uniform sampler2D uSeasonMap;
    attribute vec4 aD; // height at full snow, distance out (0 at the wall .. 1 at the toe), the face's normal x, z
    varying vec3 vW; varying vec3 vN; varying float vU; varying float vK;
    float snowHereV(vec3 wp){ vec4 m = texture(uSeasonMap, (wp.xz + 512.0) / 1024.0); return clamp(max(uSnowK.x, m.r) * uSnowK.y, 0.0, 100.0); }
    void main(){
      vec3 w = (modelMatrix * vec4(position, 1.0)).xyz;
      float k = clamp(uSnowCover * snowHereV(w) * 1.25 - 0.18, 0.0, 1.0);
      w.y = terrainHeight(w.xz) + aD.x * k - 0.02;
      // the slope of the drift: steep at its crest by the wall, flattening to the toe
      float dh = aD.x * k * 1.7 * pow(max(1.0 - aD.y, 0.0), 0.7) / 1.5;
      vN = normalize(vec3(aD.z * dh, 1.0, aD.w * dh));
      vW = w; vU = aD.y; vK = k;
      gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
    }`,
  fragmentShader: /* glsl */`
    ${GLSL_COMMON}
    ${GLSL_ATMOS}
    ${GLSL_SHADOW}
    ${GLSL_WEATHER}
    varying vec3 vW; varying vec3 vN; varying float vU; varying float vK;
    void main(){
      if (vK < 0.03) discard;
      if (vU > 0.72 && bayer4(gl_FragCoord.xy) > (1.0 - vU) / 0.28) discard; // the toe feathers into the snow on the ground
      vec3 n = safeNormalize(vN + vec3(vnoise(vW.xz * 3.0) - 0.5, 0.0, vnoise(vW.xz * 3.0 + 7.0) - 0.5) * 0.25);
      float sh = shadowAt(vW, n);
      vec3 V = safeNormalize(cameraPosition - vW);
      vec3 alb = snowAlbedo(vW);
      float ndl = clamp(dot(n, uLightDir) * 0.6 + 0.4, 0.0, 1.0);
      vec3 col = alb * (uAmbient * vec3(0.78, 0.84, 1.0) * 0.85 + uLightColor * 0.75 * ndl * mix(0.3, 1.0, sh));
      col += snowSparkle(vW, V, sh) * uLightColor;
      gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
    }`,
});
function buildDrifts() {
  const wd = U.uWindDir.value, Wx = wd.x, Wz = wd.y;
  const chunks = new Map();
  const add = (key) => { let c = chunks.get(key); if (!c) chunks.set(key, c = { pos: [], ad: [], idx: [], n: 0, x: 0, z: 0, k: 0 }); return c; };
  for (const c of COLL.boxes) {
    if (!c.active || !DRIFT_TAGS.has(c.tag) || c.x > DUN_X0 || (c.vert && c.y0 != null && c.y0 > c.baseY + 0.6)) continue;
    // the four faces: those the wind blows onto gather a drift
    for (const [lx, lz, len] of [[1, 0, c.hz], [-1, 0, c.hz], [0, 1, c.hx], [0, -1, c.hx]]) {
      if (len < 0.6) continue;
      // the face's outward normal in the world (houseL's frame: local x = dx c - dz s, z = dx s + dz c)
      const nx = lx * c.cos + lz * c.sin, nz = -lx * c.sin + lz * c.cos;
      if (nx * Wx + nz * Wz > -0.3) continue;
      const fx = c.x + nx * (lx ? c.hx : c.hz), fz = c.z + nz * (lx ? c.hx : c.hz);
      const tx = -nz, tz = nx; // along the face
      const segs = Math.max(2, Math.round((len * 2) / 0.6)), R = 5, depth = 1.2 + hash2(Math.round(fx * 7), Math.round(fz * 7)) * 0.7;
      const ch = add((Math.floor(fx / 64) + 64) * 256 + Math.floor(fz / 64) + 64);
      const base = ch.n;
      for (let i = 0; i <= segs; i++) {
        const t = -len + (2 * len * i) / segs, endK = sstep(0, 0.9, len - Math.abs(t));
        const h = (0.42 + 0.3 * vnoise(fx * 0.7 + t * 0.9, fz * 0.7 - t * 0.9)) * (0.25 + 0.75 * endK) * Math.min(1, (c.h || 3) / 1.4);
        for (let j = 0; j <= R; j++) {
          const u = j / R, out = 0.04 + u * depth * (0.8 + 0.4 * vnoise(t * 1.3 + fx, u * 2));
          const x = fx + tx * t + nx * out, z = fz + tz * t + nz * out;
          ch.pos.push(x, 0, z);
          ch.ad.push(h * Math.pow(1 - u, 1.7), u, nx, nz);
          ch.x += x; ch.z += z; ch.k++;
        }
      }
      for (let i = 0; i < segs; i++) for (let j = 0; j < R; j++) {
        const a = base + i * (R + 1) + j, b = a + 1, cc = a + R + 1, d = cc + 1;
        ch.idx.push(a, b, cc, b, d, cc);
      }
      ch.n += (segs + 1) * (R + 1);
    }
  }
  for (const ch of chunks.values()) {
    if (!ch.n) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(ch.pos, 3));
    g.setAttribute('aD', new THREE.Float32BufferAttribute(ch.ad, 4));
    g.setIndex(ch.n > 65535 ? new THREE.Uint32BufferAttribute(ch.idx, 1) : new THREE.Uint16BufferAttribute(ch.idx, 1));
    g.computeBoundingSphere();
    g.boundingSphere.radius += 2;
    const m = new THREE.Mesh(g, driftMat);
    m.visible = false; m.renderOrder = 1;
    // the triangles may face either way after the faces' own frames: draw both
    m.material.side = THREE.DoubleSide;
    scene.add(m);
    TRACKS.drifts.push({ m, x: ch.x / ch.k, z: ch.z / ch.k, tris: ch.idx.length / 3 });
  }
}
function tracksDraw(dt) {
  if (!TRACKS.built) return;
  const T = TRACKS, M = T.mesh;
  trkMat.uniforms.uTrk.value.set(T.snowAcc, T.dryAcc, GAME.t, quality.level === 'low' ? 26 : quality.level === 'medium' ? 34 : 42);
  if (T.dirty && M) {
    T.dirty = false;
    const A = M.geometry.attributes;
    for (const a of [A.iP, A.iK, A.iT]) {
      a.clearUpdateRanges ? (a.clearUpdateRanges(), a.addUpdateRange(T.lo * 4, (T.hi - T.lo + 1) * 4)) : (a.updateRange.offset = T.lo * 4, a.updateRange.count = (T.hi - T.lo + 1) * 4);
      a.needsUpdate = true;
    }
    T.lo = Infinity; T.hi = -1;
  }
  if (M) M.visible = T.n > 0 && !INDOOR.on;
  // the drifts show only where snow lies near the camera
  T.visT -= dt;
  if (T.visT < 0) {
    T.visT = 0.5;
    const any = !INDOOR.on && (U.uSnowCover.value > 0.015);
    T.driftOn = any;
    const cam = camera.position, r = quality.level === 'low' ? 70 : quality.level === 'medium' ? 110 : 150;
    for (const D of T.drifts) D.m.visible = any && dist2(D.x, D.z, cam.x, cam.z) < (r + 32) * (r + 32);
  }
}

/* test hooks (window.__hm.water.tracks) */
const TRACKS_DEBUG = {
  TRACKS, lay: trkLay, surface: trkSurface,
  prints: (x, z, r = 3) => { const A = TRACKS.mesh.geometry.attributes, out = []; for (let i = 0; i < TRACKS.n; i++) { const o = i * 4; if (A.iK.array[o + 3] > 0 && Math.hypot(A.iP.array[o] - x, A.iP.array[o + 1] - z) < r) out.push({ i, x: A.iP.array[o], z: A.iP.array[o + 1], kind: A.iK.array[o], surf: A.iK.array[o + 2], snow0: A.iT.array[o], dry0: A.iT.array[o + 1], t: A.iT.array[o + 2] }); } return out; },
  // how much of a print still shows (the shader's own sums, on the CPU)
  shows: (i) => { const A = TRACKS.mesh.geometry.attributes, o = i * 4, surf = A.iK.array[o + 2]; if (A.iK.array[o + 3] <= 0) return 0; if (surf === 0) return 1 - clamp((TRACKS.snowAcc - A.iT.array[o]) / 2.2, 0, 1); return 1 - clamp((TRACKS.dryAcc - A.iT.array[o + 1]) / (surf === 1 ? 240 : 150), 0, 1) * (surf === 1 ? 0.92 : 1); },
  drifts: () => ({ n: TRACKS.drifts.length, tris: TRACKS.drifts.reduce((s, D) => s + D.tris, 0), on: TRACKS.driftOn, visible: TRACKS.drifts.filter((D) => D.m.visible).length }),
};
WATER_DEBUG.tracks = TRACKS_DEBUG; // window.__hm.water.tracks
