/* ================================================================== */
/* living off the land: plants to forage, water to drink, fires to cook */
/* at, game to hunt and fish to catch; hunger and thirst on the HUD     */
/* ================================================================== */
// Berry bushes along the woods' edges, mushroom rings in the shade, herbs where each likes to grow, nettles for fibre,
// apple trees in the Logres orchards: every plant is drawn in code (one instanced foliage shader for all of them, with
// wind, rain, snow, shadows and the fires' light), is picked with E, and fruits again after a while (not in winter,
// if the farming branch's seasons are in). Wells, troughs and lakes give water; any fire cooks; wolves, boars, bears
// and deer give meat, hides and bone; a rod catches fish at any water. The needs themselves live in 06s_survival.js.
const FORAGE = { list: [], meshes: {}, mat: null, at: 0, dirty: true, clock: 0, herds: [], herdT: 0, ready: false };
const FORAGE_KINDS = {
  bush: { id: 0, good: 'berries', n: [2, 4], regrow: 420, verb: 'Pick berries', name: 'berry bush', r: 0.75, act: 5, fruit: true },
  mush: { id: 1, good: 'mushrooms', n: [3, 5], regrow: 540, verb: 'Gather the mushrooms', name: 'mushroom ring', r: 1.2, act: 6, autumn: true },
  ember: { id: 2, good: 'herb_fire', n: [2, 3], regrow: 660, verb: 'Gather the embercap', name: 'ring of embercap', r: 1.0, act: 6, autumn: true },
  heal: { id: 3, good: 'herb_heal', n: [2, 3], regrow: 480, verb: 'Pick woundwort', name: 'woundwort', r: 0.5, act: 6, knife: true, flower: true },
  mana: { id: 4, good: 'herb_mana', n: [1, 3], regrow: 540, verb: 'Pick starflower', name: 'starflower', r: 0.5, act: 6, knife: true, flower: true },
  frost: { id: 5, good: 'herb_frost', n: [1, 3], regrow: 540, verb: 'Pick rimeleaf', name: 'rimeleaf', r: 0.5, act: 6, knife: true },
  storm: { id: 6, good: 'herb_storm', n: [1, 2], regrow: 600, verb: 'Cut thunder thistle', name: 'thunder thistle', r: 0.55, act: 6, knife: true, flower: true },
  nettle: { id: 7, good: 'fibre', n: [2, 4], regrow: 360, verb: 'Cut nettles for fibre', name: 'nettle patch', r: 0.7, act: 6, knife: true },
  apple: { id: 8, good: 'apple', n: [3, 5], regrow: 600, verb: 'Pick apples', name: 'apple tree', r: 1.1, act: 5, fruit: true },
};
const FORAGE_DRAW = { high: 170, medium: 130, low: 90 };

/* ---- the water branch's rivers and the farming branch's seasons, when they are merged in ---- */
let _survWaterFn, _survSeasonObj;
function survWaterFn() {
  // eslint-disable-next-line no-eval
  if (_survWaterFn === undefined) _survWaterFn = typeof waterAt === 'function' ? eval('waterAt') : null; // feature/water
  return _survWaterFn;
}
// is there water deep enough to drink or fish at (x, z)?
function survWaterHere(x, z, deep = 0.2) {
  if (x > DUN_X0) return false;
  const g = heightAt(x, z);
  if (g < WATER_Y - deep) return true;
  const f = survWaterFn();
  if (!f) return false;
  try {
    const w = f(x, z);
    if (!w) return false;
    if (typeof w === 'number') return w - g > deep;
    if (typeof w === 'object') { if (Number.isFinite(w.depth)) return w.depth > deep; if (Number.isFinite(w.y)) return w.y - g > deep; return true; }
    return !!w;
  } catch (e) { return false; }
}
// 'winter', 'spring', 'summer', 'autumn' or null when there are no seasons
function survSeason() {
  // eslint-disable-next-line no-eval
  if (_survSeasonObj === undefined) _survSeasonObj = typeof SEASON !== 'undefined' ? eval('() => SEASON') : null; // feature/farming: a getter, so a season that changes is read live
  const S = _survSeasonObj ? _survSeasonObj() : null;
  if (!S) return null;
  const v = typeof S === 'string' ? S : typeof S === 'object' ? (S.name || S.key || S.season || S.id || null) : null;
  if (typeof v !== 'string') return null;
  const k = v.toLowerCase();
  return ['winter', 'spring', 'summer', 'autumn'].find((s) => k.includes(s)) || (k.includes('fall') ? 'autumn' : null);
}
// how fast a plant fruits again in this season (0: not at all)
function forageSeasonRate(K) {
  const s = survSeason();
  if (!s) return 1;
  if (s === 'winter') return K.fruit || K.flower ? 0 : K.autumn ? 0.4 : 0.5;
  if (s === 'autumn') return K.autumn ? 2 : K.fruit ? 1.2 : 0.8;
  if (s === 'spring') return K.flower ? 1.5 : K.fruit ? 0.6 : 1;
  return 1;
}

/* ------------------------------------------------------------------ */
/* the plants: where they grow                                         */
/* ------------------------------------------------------------------ */
function buildForage() {
  const rnd = mulberry(7331);
  const TD = new Map(), cell = 8;
  const ck = (x, z) => Math.floor((x + HALF) / cell) * 4096 + Math.floor((z + HALF) / cell);
  for (const t of W.trees) TD.set(ck(t.x, t.z), (TD.get(ck(t.x, t.z)) || 0) + 1);
  const treesNear = (x, z) => { let n = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) n += TD.get(ck(x + i * cell, z + j * cell)) || 0; return n; };
  const lakeNear = (x, z, pad) => LAKES.some((L) => dist(x, z, L.x, L.z) < L.r + pad);
  const placed = [];
  const _c = [];
  const free = (x, z, r, spacing = 3) => {
    if (!isWalkable(x, z) || Math.hypot(x, z) > 470 || Math.hypot(x, z) < 34) return false;
    const h = heightAt(x, z);
    if (h < WATER_Y + 0.7 || sampleGrid(W.road, x, z) > 0.04 || sampleGrid(W.field, x, z) > 0.3) return false;
    for (const S of SITES) if (dist2(x, z, S.x, S.z) < (S.r + 10) ** 2) return false;
    if (BARROW && BARROW.door && dist2(x, z, BARROW.door.x, BARROW.door.z) < 30 * 30) return false;
    const n = normalAt(x, z);
    if (n.y < 0.88) return false;
    collidersNear(x, z, r + 3, _c);
    for (const c of _c) if (c.active && collCovers(c, x, z, r + 0.25)) return false;
    for (const p of placed) if (dist2(x, z, p.x, p.z) < spacing * spacing) return false;
    if (typeof houseAt === 'function' && houseAt(x, z, r + 1)) return false;
    return true;
  };
  const add = (k, x, z, s, o = {}) => {
    const p = { k, x, z, y: heightAt(x, z), yaw: rnd() * TAU, s, seed: rnd(), ripe: 1, at: 0, i: placed.length, ...o };
    placed.push(p);
    return p;
  };
  const scatter = (k, count, test, scale, tries = 9000) => {
    let made = 0;
    for (let n = 0; n < tries && made < count; n++) {
      const x = (rnd() * 2 - 1) * 465, z = (rnd() * 2 - 1) * 465;
      const K = FORAGE_KINDS[k];
      if (!test(x, z)) continue;
      if (!free(x, z, K.r, k === 'bush' ? 4 : 3)) continue;
      const p = add(k, x, z, scale());
      if (k === 'bush') p.coll = addCircle(x, z, 0.5 * p.s, 'bush', 1.0 * p.s);
      made++;
    }
    return made;
  };
  scatter('bush', 150, (x, z) => { const t = treesNear(x, z); return t >= 1 && t <= 7 && sampleGrid(W.grass, x, z) > 0.3; }, () => 0.85 + rnd() * 0.45);
  scatter('mush', 60, (x, z) => treesNear(x, z) >= 5, () => 0.8 + rnd() * 0.5);
  scatter('ember', 24, (x, z) => treesNear(x, z) >= 3 && (realmAt(x, z) === 2 || Math.hypot(x, z) < R_RING), () => 0.8 + rnd() * 0.4);
  scatter('heal', 50, (x, z) => (lakeNear(x, z, 30) || heightAt(x, z) < 1.5) && sampleGrid(W.grass, x, z) > 0.45, () => 0.85 + rnd() * 0.4);
  scatter('mana', 40, (x, z) => realmAt(x, z) === 1 && sampleGrid(W.grass, x, z) > 0.5 && treesNear(x, z) <= 3, () => 0.85 + rnd() * 0.35);
  scatter('frost', 36, (x, z) => realmAt(x, z) === 2 || heightAt(x, z) > 14, () => 0.85 + rnd() * 0.35);
  scatter('storm', 36, (x, z) => sampleGrid(W.rock, x, z) > 0.18 || heightAt(x, z) > 12, () => 0.9 + rnd() * 0.35);
  scatter('nettle', 60, (x, z) => { const t = treesNear(x, z); const town = REALMS.some((R) => { const d = dist(x, z, R.town.x, R.town.z); return d > 45 && d < 120; }); return town || (t >= 2 && t <= 8); }, () => 0.85 + rnd() * 0.4);
  // the Logres orchard: rows of apple trees outside the town, and a few wild ones in its homeland
  const RL = REALMS[0];
  orchard: for (let tries = 0; tries < 400; tries++) {
    const a = rnd() * TAU, d = 55 + rnd() * 45;
    const cx = RL.town.x + Math.sin(a) * d, cz = RL.town.z + Math.cos(a) * d, yaw = rnd() * TAU;
    const spots = [];
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) {
      const lx = (c - 1.5) * 6.5, lz = (r - 1) * 6.5;
      const x = cx + lx * Math.cos(yaw) + lz * Math.sin(yaw), z = cz - lx * Math.sin(yaw) + lz * Math.cos(yaw);
      if (!free(x, z, 2.2, 5.5) || realmAt(x, z) !== 0) continue orchard;
      spots.push([x, z]);
    }
    for (const [x, z] of spots) { const p = add('apple', x, z, 0.9 + rnd() * 0.25); p.coll = addCircle(x, z, 0.3 * p.s, 'tree', 3.5); }
    FORAGE.orchard = { x: cx, z: cz };
    break;
  }
  scatter('apple', 8, (x, z) => realmAt(x, z) === 0 && Math.hypot(x, z) > R_RING + 20 && sampleGrid(W.grass, x, z) > 0.4 && treesNear(x, z) <= 2, () => 0.85 + rnd() * 0.3);
  for (const p of placed) if (p.k === 'apple' && !p.coll) p.coll = addCircle(p.x, p.z, 0.3 * p.s, 'tree', 3.5);
  FORAGE.list = placed;
  buildForageMeshes();
  FORAGE.ready = true;
}

/* ------------------------------------------------------------------ */
/* the plants: how they look                                           */
/* ------------------------------------------------------------------ */
// one geometry per plant, from parts: [geometry, matrix, part, anchor]. Parts: 0 stem or bark, 1 leaves, 2 fruit,
// 3 a mushroom's cap, 4 flowers, 5 a mushroom's stem. Fruit, flowers and mushrooms shrink to their anchor when picked.
function fgGeo(parts) {
  const pos = [], nrm = [], part = [], anc = [], idx = [];
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  let base = 0;
  for (const [g, m, pid, a] of parts) {
    const p = g.attributes.position, nr = g.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m);
    const A = a ? new THREE.Vector3(a[0], a[1], a[2]) : new THREE.Vector3().applyMatrix4(m);
    for (let i = 0; i < p.count; i++) {
      v.fromBufferAttribute(p, i).applyMatrix4(m); nv.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize();
      pos.push(v.x, v.y, v.z); nrm.push(nv.x, nv.y, nv.z); part.push(pid); anc.push(A.x, A.y, A.z);
    }
    const n = g.index ? g.index.count : p.count;
    for (let i = 0; i < n; i++) idx.push(base + (g.index ? g.index.getX(i) : i));
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aPart', new THREE.Float32BufferAttribute(part, 1));
  g.setAttribute('aAnc', new THREE.Float32BufferAttribute(anc, 3));
  g.setIndex(idx);
  return g;
}
const fgM = (x, y, z, sx = 1, sy = sx, sz = sx, ry = 0, rx = 0, rz = 0) => new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), new THREE.Quaternion().setFromEuler(new THREE.Euler(rx, ry, rz, 'YXZ')), new THREE.Vector3(sx, sy, sz));
// a lumpy ball of leaves
function fgBlob(seed, detail = 1) {
  const g = new THREE.SphereGeometry(1, detail ? 9 : 7, detail ? 7 : 5);
  const p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const d = 0.82 + 0.3 * vnoiseJS(v.x * 1.9 + seed * 7.1, v.y * 1.9 + v.z * 1.6 + seed * 3.3);
    p.setXYZ(i, v.x * d, v.y * d * 0.9, v.z * d);
  }
  g.computeVertexNormals();
  return g;
}
// a small value noise for building shapes on the CPU (the GLSL one is not reachable here)
function vnoiseJS(x, y) {
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const h = (a, b) => { const s = Math.sin(a * 127.1 + b * 311.7) * 43758.5453; return s - Math.floor(s); };
  const ux = fx * fx * (3 - 2 * fx), uy = fy * fy * (3 - 2 * fy);
  return lerp(lerp(h(i, j), h(i + 1, j), ux), lerp(h(i, j + 1), h(i + 1, j + 1), ux), uy);
}
function forageGeometries() {
  const r = mulberry(4242);
  const ball = new THREE.SphereGeometry(1, 6, 4), stalk = new THREE.CylinderGeometry(0.5, 1, 1, 5, 1), leafG = new THREE.SphereGeometry(1, 6, 3);
  stalk.translate(0, 0.5, 0);
  const out = {};
  // a bramble bush: lumps of leaves on woody stems, berries tucked over the outside
  {
    const parts = [];
    for (let k = 0; k < 5; k++) { const a = (k / 5) * TAU + r(); parts.push([stalk, fgM(Math.sin(a) * 0.12, 0, Math.cos(a) * 0.12, 0.035, 0.55, 0.035, 0, Math.sin(a) * 0.5, Math.cos(a) * 0.5), 0]); }
    const blobs = [];
    for (let k = 0; k < 7; k++) {
      const a = (k / 7) * TAU + r() * 0.6, rr = k === 0 ? 0 : 0.32 + r() * 0.18, y = k === 0 ? 0.62 : 0.38 + r() * 0.22, s = k === 0 ? 0.42 : 0.3 + r() * 0.1;
      const c = [Math.sin(a) * rr, y, Math.cos(a) * rr];
      blobs.push([c, s]);
      parts.push([fgBlob(k + 1), fgM(c[0], c[1], c[2], s, s * 0.85, s), 1, c]);
    }
    for (let k = 0; k < 34; k++) {
      const [c, s] = blobs[k % blobs.length], th = r() * TAU, ph = 0.15 + r() * 1.1;
      const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.85, Math.sin(ph) * Math.sin(th)];
      const at = [c[0] + d[0] * s * 0.92, c[1] + d[1] * s * 0.92, c[2] + d[2] * s * 0.92];
      for (let q = 0; q < 3; q++) { const o = [at[0] + (r() - 0.5) * 0.035, at[1] + (r() - 0.5) * 0.035, at[2] + (r() - 0.5) * 0.035]; parts.push([ball, fgM(o[0], o[1], o[2], 0.019 + r() * 0.006), 2, at]); }
    }
    out.bush = fgGeo(parts);
  }
  // a fairy ring of mushrooms: stems and domed caps in a broken circle
  {
    const parts = [];
    const cap = new THREE.LatheGeometry([[0, 0.5], [0.45, 0.45], [0.8, 0.28], [1, 0.05], [0.9, -0.02], [0.3, -0.04], [0, -0.03]].map(([x, y]) => new THREE.Vector2(x, y)), 10);
    const stem = new THREE.CylinderGeometry(0.85, 1, 1, 7, 1); stem.translate(0, 0.5, 0);
    for (let k = 0; k < 11; k++) {
      const a = (k / 11) * TAU + (r() - 0.5) * 0.3, rr = 0.85 + (r() - 0.5) * 0.25, x = Math.sin(a) * rr, z = Math.cos(a) * rr;
      const big = 0.6 + r() * 0.7, h = 0.07 * big + 0.03, cr = 0.06 * big + 0.02, tilt = (r() - 0.5) * 0.3;
      parts.push([stem, fgM(x, 0, z, cr * 0.32, h, cr * 0.32, 0, tilt, tilt * 0.5), 5, [x, 0, z]]);
      parts.push([cap, fgM(x + Math.sin(tilt) * h * 0.2, h, z, cr, cr * 0.75, cr, r() * TAU, tilt, tilt * 0.5), 3, [x, 0, z]]);
      if (r() < 0.45) { const x2 = x + (r() - 0.5) * 0.18, z2 = z + (r() - 0.5) * 0.18, s2 = 0.45; parts.push([stem, fgM(x2, 0, z2, cr * s2 * 0.32, h * s2, cr * s2 * 0.32), 5, [x2, 0, z2]]); parts.push([cap, fgM(x2, h * s2, z2, cr * s2, cr * s2 * 0.8, cr * s2), 3, [x2, 0, z2]]); }
    }
    out.ring = fgGeo(parts);
  }
  // a herb: a rosette of leaves, stalks with flower heads (each herb takes its own colours in the shader)
  {
    const parts = [];
    for (let k = 0; k < 7; k++) { const a = (k / 7) * TAU + r() * 0.4, L = 0.14 + r() * 0.05; parts.push([leafG, fgM(Math.sin(a) * L * 0.8, 0.03 + r() * 0.03, Math.cos(a) * L * 0.8, L * 0.55, 0.016, L * 0.2, a + Math.PI / 2, 0, 0.25), 1, [0, 0, 0]]); }
    for (let k = 0; k < 4; k++) {
      const a = r() * TAU, lean = 0.12 + r() * 0.15, h = 0.28 + r() * 0.16;
      const tx = Math.sin(a) * Math.sin(lean) * h, tz = Math.cos(a) * Math.sin(lean) * h, ty = Math.cos(lean) * h;
      parts.push([stalk, fgM(0, 0, 0, 0.008, h, 0.008, a, lean), 0]);
      parts.push([leafG, fgM(tx * 0.5, ty * 0.5, tz * 0.5, 0.06, 0.012, 0.025, a + 1.2, 0, 0.6), 1, [0, 0, 0]]);
      for (let q = 0; q < 5; q++) parts.push([ball, fgM(tx + (r() - 0.5) * 0.04, ty + q * 0.022, tz + (r() - 0.5) * 0.04, 0.022 - q * 0.002), 4, [tx, ty, tz]]);
    }
    out.herb = fgGeo(parts);
  }
  // a stand of nettles: tall stalks with pairs of toothed leaves
  {
    const parts = [];
    for (let k = 0; k < 9; k++) {
      const a = r() * TAU, rr = r() * 0.4, x = Math.sin(a) * rr, z = Math.cos(a) * rr, h = 0.65 + r() * 0.45, lean = (r() - 0.5) * 0.2;
      parts.push([stalk, fgM(x, 0, z, 0.012, h, 0.012, a, lean), 0]);
      for (let q = 1; q <= 4; q++) {
        const y = h * (0.25 + q * 0.17), L = 0.09 * (1.15 - q * 0.15), ang = a + q * 1.57;
        for (const sd of [-1, 1]) parts.push([leafG, fgM(x + Math.sin(ang) * sd * L, y, z + Math.cos(ang) * sd * L, L, 0.012, L * 0.5, ang + Math.PI / 2, 0, sd * 0.4), 1, [x, y, z]]);
      }
    }
    out.nettle = fgGeo(parts);
  }
  // an apple tree: a short crooked trunk, a few limbs, a round crown and its apples
  {
    const parts = [];
    const trunk = new THREE.CylinderGeometry(0.7, 1, 1, 7, 3); trunk.translate(0, 0.5, 0);
    parts.push([trunk, fgM(0, -0.1, 0, 0.17, 1.75, 0.17, 0, 0.06), 0]);
    const limbs = [];
    for (let k = 0; k < 4; k++) { const a = (k / 4) * TAU + 0.4, lean = 0.75; parts.push([trunk, fgM(0, 1.5, 0, 0.08, 1.25, 0.08, a, lean), 0]); limbs.push([Math.sin(a) * Math.sin(lean) * 1.25, 1.5 + Math.cos(lean) * 1.25, Math.cos(a) * Math.sin(lean) * 1.25]); }
    const blobs = [[0, 2.85, 0, 1.05]];
    for (let k = 0; k < 8; k++) { const a = (k / 8) * TAU + r() * 0.5, rr = 0.85 + r() * 0.35; blobs.push([Math.sin(a) * rr, 2.25 + r() * 0.75, Math.cos(a) * rr, 0.62 + r() * 0.2]); }
    blobs.forEach(([x, y, z, s], k) => parts.push([fgBlob(k + 11), fgM(x, y, z, s, s * 0.82, s), 1, [x, y, z]]));
    for (let k = 0; k < 30; k++) {
      const [x, y, z, s] = blobs[1 + (k % 8)], th = r() * TAU, ph = 0.6 + r() * 1.3;
      const d = [Math.sin(ph) * Math.cos(th), Math.cos(ph) * 0.82, Math.sin(ph) * Math.sin(th)];
      const at = [x + d[0] * s * 0.95, y + d[1] * s * 0.95, z + d[2] * s * 0.95];
      parts.push([ball, fgM(at[0], at[1] - 0.03, at[2], 0.055 + r() * 0.015), 2, at]);
    }
    out.apple = fgGeo(parts);
  }
  return out;
}
const FG_VS = /* glsl */`
  uniform float uTime, uWind;
  uniform vec2 uWindDir;
  attribute vec4 iPos; attribute vec4 iDat; attribute float aPart; attribute vec3 aAnc;
  varying vec3 vW; varying vec3 vN; varying vec3 vO; varying float vPart; varying vec4 vDat; varying vec3 vAnc;
  void main(){
    float ripe = iDat.z, kind = iDat.y, sc = iDat.x;
    vec3 p = position;
    bool fruit = aPart > 1.5 && aPart < 2.5, cap = aPart > 2.5 && aPart < 3.5, flower = aPart > 3.5 && aPart < 4.5, stemM = aPart > 4.5;
    // picked: fruit and flowers shrink away; a ring of mushrooms is gone to the ground; a cut herb is a low stub
    float grow = smoothstep(0.0, 0.95, ripe);
    if (fruit || flower || cap || stemM) p = mix(aAnc, p, grow);
    else if (kind > 2.5 && kind < 7.5) p = mix(vec3(p.x, p.y * 0.35, p.z), p, smoothstep(0.0, 0.6, ripe));
    // wind: the tall and the leafy bend, mushrooms do not
    float flex = kind < 0.5 ? 0.5 : kind < 2.5 ? 0.0 : kind < 6.5 ? 1.3 : kind < 7.5 ? 1.6 : 0.25;
    float h = max(p.y, 0.0);
    float gust = 0.55 + 0.45 * sin(uTime * 1.9 + iDat.w * 40.0 + iPos.x * 0.21) * sin(uTime * 0.83 + iPos.z * 0.17);
    p.xz += uWindDir * gust * uWind * 0.028 * flex * h * h / max(sc, 0.2);
    float c = cos(iPos.w), s = sin(iPos.w);
    vec3 w = vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c) * sc + iPos.xyz;
    vW = w; vN = vec3(normal.x * c + normal.z * s, normal.y, -normal.x * s + normal.z * c);
    vO = position; vPart = aPart; vDat = iDat; vAnc = aAnc;
    gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
  }`;
const FG_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_SHADOW}
  ${GLSL_PLIGHT}
  ${GLSL_LIGHT}
  ${GLSL_WEATHER}
  uniform float uWet, uSnowCover;
  varying vec3 vW; varying vec3 vN; varying vec3 vO; varying float vPart; varying vec4 vDat; varying vec3 vAnc;
  void main(){
    vec3 n = safeNormalize(vN);
    vec3 V = safeNormalize(cameraPosition - vW);
    if (dot(n, V) < 0.0 && vPart > 0.5 && vPart < 1.5) n = -n; // thin leaves are lit from the side you see
    gSh = shadowAt(vW, n);
    gPL = pointLights(vW, n);
    float kind = floor(vDat.y + 0.5), seed = vDat.w;
    float hs = hash12(vAnc.xz * 37.0 + seed * 11.0);
    vec3 alb; float por = 0.8, ao = 1.0;
    vec3 emit = vec3(0.0);
    if (vPart < 0.5) {
      // stems and bark
      alb = kind > 7.5 ? vec3(0.3, 0.23, 0.16) * (0.75 + 0.35 * vnoise(vO.xz * 30.0 + vO.y * 6.0)) : vec3(0.24, 0.27, 0.13);
      if (kind > 7.5) alb *= 0.8 + 0.25 * smoothstep(0.2, 0.8, vnoise(vec2(atan(vO.x, vO.z) * 3.0, vO.y * 14.0)));
      por = 0.7;
    } else if (vPart < 1.5) {
      // leaves: each kind its own green, clusters picked out by noise, the underside of a lump in shade
      vec3 g = kind < 0.5 ? vec3(0.13, 0.25, 0.08) : kind < 3.5 ? vec3(0.19, 0.33, 0.12) : kind < 4.5 ? vec3(0.17, 0.31, 0.15)
        : kind < 5.5 ? vec3(0.42, 0.52, 0.55) : kind < 6.5 ? vec3(0.28, 0.36, 0.25) : kind < 7.5 ? vec3(0.15, 0.3, 0.09) : vec3(0.17, 0.3, 0.09);
      float cl = vnoise(vO.xz * 13.0 + vO.y * 9.0 + seed * 7.0), fine = vnoise(vO.xz * 41.0 + vO.y * 33.0);
      alb = g * (0.68 + 0.5 * cl) * (0.85 + 0.25 * fine) * (0.9 + 0.2 * hs);
      if (kind > 4.5 && kind < 5.5) alb += vec3(0.1, 0.12, 0.14) * step(0.7, fine); // rime on rimeleaf
      vec3 up = safeNormalize(vO - vAnc + vec3(0.0, 0.001, 0.0));
      ao = clamp(0.5 + 0.6 * (up.y * 0.5 + 0.5), 0.45, 1.0);
      por = 0.55;
    } else if (vPart < 2.5) {
      // fruit: blackberries ripening through red; apples red and gold
      if (kind > 7.5) alb = mix(vec3(0.62, 0.09, 0.05), vec3(0.62, 0.52, 0.12), smoothstep(0.55, 0.95, hs) * 0.8 + 0.2 * vnoise(vO.xy * 60.0));
      else alb = mix(vec3(0.07, 0.02, 0.06), vec3(0.42, 0.04, 0.07), step(0.8, hs));
      por = 0.15;
    } else if (vPart < 3.5) {
      // caps: brown penny-buns with pale flecks, or embercap's red that glows from beneath at night
      float under = smoothstep(0.05, -0.2, n.y);
      if (kind > 1.5) {
        alb = mix(vec3(0.62, 0.13, 0.04), vec3(0.9, 0.42, 0.12), vnoise(vO.xz * 40.0));
        emit = vec3(1.4, 0.45, 0.1) * (0.25 + 0.75 * uNight) * (0.3 + 0.7 * under) * 0.6;
      } else {
        alb = mix(vec3(0.5, 0.33, 0.18), vec3(0.62, 0.45, 0.27), hs) * (0.85 + 0.25 * vnoise(vO.xz * 50.0));
        alb = mix(alb, vec3(0.86, 0.8, 0.66), step(0.83, vnoise(vO.xz * 70.0 + 3.0)) * (1.0 - under));
      }
      alb = mix(alb, vec3(0.78, 0.7, 0.58), under * (kind > 1.5 ? 0.0 : 0.7));
      por = 0.6;
    } else if (vPart < 4.5) {
      // flowers: woundwort purple, starflower's pale stars (a faint shine after dark), rimeleaf white, thistle violet
      alb = kind < 3.5 ? vec3(0.55, 0.22, 0.5) : kind < 4.5 ? vec3(0.78, 0.85, 1.0) : kind < 5.5 ? vec3(0.9, 0.94, 1.0) : vec3(0.46, 0.18, 0.58);
      alb *= 0.85 + 0.3 * hs;
      if (kind > 3.5 && kind < 4.5) emit = vec3(0.45, 0.6, 1.0) * uNight * 0.55;
      por = 0.9;
    } else {
      alb = vec3(0.86, 0.82, 0.7) * (0.85 + 0.2 * vnoise(vO.xz * 60.0 + vO.y * 40.0));
      por = 0.6;
    }
    // weather: rain darkens and glosses, snow settles on what faces up (and melts by fires)
    alb = wetAlbedo(alb, uWet, por);
    float sn = snowAmount(vW, n, uSnowCover, gPL) * (vPart > 0.5 ? 0.85 : 0.4);
    alb = mix(alb, snowAlbedo(vW), sn);
    vec3 col = lightSurface(alb, n, ao);
    // sunlight through the leaves
    if (vPart > 0.5 && vPart < 1.5) col += alb * uLightColor * 0.45 * spow(max(dot(-n, uLightDir), 0.0), 1.5) * gSh * (1.0 - sn);
    col += wetSheen(vW, n, V, max(uWet, vPart > 1.5 && vPart < 2.5 ? 0.35 : 0.0), por, gSh);
    col += snowSparkle(vW, V, gSh) * sn;
    col += emit;
    gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
  }`;
function buildForageMeshes() {
  const geos = forageGeometries();
  FORAGE.mat = mat({ vertexShader: FG_VS, fragmentShader: FG_FS });
  const depth = depthFrom(FORAGE.mat);
  const caps = { bush: 0, ring: 0, herb: 0, nettle: 0, apple: 0 };
  for (const p of FORAGE.list) caps[forageModel(p.k)]++;
  for (const key of Object.keys(geos)) {
    const src = geos[key], g = new THREE.InstancedBufferGeometry();
    g.index = src.index;
    for (const a of ['position', 'normal', 'aPart', 'aAnc']) g.setAttribute(a, src.attributes[a]);
    const cap = Math.max(1, caps[key]);
    g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('iDat', new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage));
    g.instanceCount = 0;
    const m = new THREE.Mesh(g, FORAGE.mat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    scene.add(m);
    shadowCaster(m, depth);
    FORAGE.meshes[key] = { mesh: m, cap };
  }
}
const forageModel = (k) => (k === 'bush' ? 'bush' : k === 'mush' || k === 'ember' ? 'ring' : k === 'nettle' ? 'nettle' : k === 'apple' ? 'apple' : 'herb');
// fill the instance buffers with the plants near the camera (a few times a second, or when one is picked)
function drawForage(dt) {
  if (!FORAGE.ready) return;
  FORAGE.clock -= dt;
  if (FORAGE.clock > 0 && !FORAGE.dirty) return;
  FORAGE.clock = 0.4; FORAGE.dirty = false;
  const camX = camera.position.x, camZ = camera.position.z, R = FORAGE_DRAW[quality.level] || 130, R2 = R * R;
  const fill = {};
  for (const k in FORAGE.meshes) fill[k] = 0;
  const vis = INDOOR.on ? 0 : 1;
  for (const p of FORAGE.list) {
    if (!vis || dist2(p.x, p.z, camX, camZ) > (p.k === 'apple' ? R2 * 1.6 : R2)) continue;
    const key = forageModel(p.k), M = FORAGE.meshes[key];
    const n = fill[key];
    if (n >= M.cap) continue;
    const g = M.mesh.geometry;
    g.attributes.iPos.array.set([p.x, p.y, p.z, p.yaw], n * 4);
    g.attributes.iDat.array.set([p.s, FORAGE_KINDS[p.k].id, forageShown(p), p.seed], n * 4);
    fill[key] = n + 1;
  }
  for (const k in FORAGE.meshes) {
    const g = FORAGE.meshes[k].mesh.geometry;
    g.instanceCount = fill[k];
    g.attributes.iPos.needsUpdate = true; g.attributes.iDat.needsUpdate = true;
  }
}
// how ripe a plant looks: fruit and flowers are gone in winter
function forageShown(p) {
  const K = FORAGE_KINDS[p.k];
  if ((K.fruit || K.flower) && survSeason() === 'winter') return Math.min(p.ripe, 0.02);
  return p.ripe;
}

/* ------------------------------------------------------------------ */
/* picking and regrowth                                                 */
/* ------------------------------------------------------------------ */
function forageNearest(P, reach = 1.5) {
  let best = null, bd = Infinity;
  for (const p of FORAGE.list) {
    const d = dist(P.x, P.z, p.x, p.z) - FORAGE_KINDS[p.k].r * p.s;
    if (d < reach && d < bd && forageShown(p) >= 0.99 && Math.abs(P.y - p.y) < 2) { bd = d; best = p; }
  }
  return best ? { p: best, d: Math.max(0.05, bd) } : null;
}
function forageStart(p) {
  const P = GAME.player, K = FORAGE_KINDS[p.k];
  if (!P || !P.alive) return;
  if (P.mount) dismount(P);
  const yaw = Math.atan2(p.x - P.x, p.z - P.z);
  setAct(P, K.act, K.act === 6 ? 1.3 : 1.0);
  survStartJob({ kind: 'pick', label: K.verb.replace(/^(\w)/, (m) => m), dur: K.act === 6 ? 1.3 : 1.0, yaw, plant: p, done: () => { forageTake(p); return false; } });
}
function forageTake(p) {
  const K = FORAGE_KINDS[p.k];
  if (p.ripe < 0.99) return 0;
  const sk = SURV.skill.forage || 0;
  let n = K.n[0] + Math.floor(Math.random() * (K.n[1] - K.n[0] + 1));
  if (Math.random() < sk / 120) n++;
  if (K.knife && goodsHave('tool_knife')) n++;
  const got = goodsAdd(K.good, n, true);
  if (got) uiLog(`You pick ${got} ${goodName(K.good, got).toLowerCase()} from the ${K.name}.`, 'loot');
  // a feather caught in the brambles, a seed or two in the nettles
  if (p.k === 'bush' && Math.random() < 0.18) { goodsAdd('feather', 1, true); uiLog('A feather caught in the twigs comes away too.', 'loot'); }
  if (p.k === 'apple' && Math.random() < 0.25) goodsAdd('stick', 1, true);
  p.ripe = 0;
  p.at = GAME.t + K.regrow * (0.85 + Math.random() * 0.3);
  FORAGE.dirty = true;
  skillGain('forage', 0.6);
  sfx('loot');
  const P = GAME.player;
  // leaves and bits fly as it is picked
  for (let i = 0; i < 8; i++) fxAlpha.emit(p.x + (Math.random() - 0.5) * 0.6 * p.s, p.y + (K.act === 6 ? 0.15 : 0.6 * p.s), p.z + (Math.random() - 0.5) * 0.6 * p.s, (Math.random() - 0.5) * 0.8, 0.4 + Math.random() * 0.6, (Math.random() - 0.5) * 0.8, 0.8, 0.22, 0.32, 0.12, 0.04, 6, 0.6);
  saveSoon();
  return got;
}
// plants fruit again: the last fifth of the wait they grow back in
function stepForage(dt) {
  FORAGE.at -= dt;
  if (FORAGE.at > 0) return;
  FORAGE.at = 1;
  const t = GAME.t;
  for (const p of FORAGE.list) {
    if (p.ripe >= 1) continue;
    const K = FORAGE_KINDS[p.k], rate = forageSeasonRate(K);
    if (rate <= 0) { p.at += 1; continue; } // the clock waits out the winter
    if (rate !== 1) p.at -= (rate - 1) * 1;
    const tail = K.regrow * 0.2, left = p.at - t;
    const r = left <= 0 ? 1 : left < tail ? 1 - left / tail : 0;
    if (Math.abs(r - p.ripe) > 0.01 || (r === 1 && p.ripe < 1)) { p.ripe = r; FORAGE.dirty = true; }
  }
}

/* ------------------------------------------------------------------ */
/* water: wells, troughs and lakes                                     */
/* ------------------------------------------------------------------ */
const WATERSKINS_MAX = 8;
// the nearest shore point within reach, or null
function shoreNear(P, reach = 2.6) {
  if (inDungeon(P) || survWaterHere(P.x, P.z, 0.35)) return null;
  let best = null;
  for (let k = 0; k < 12 && !best; k++) {
    const a = (k / 12) * TAU;
    for (const d of [1.2, 1.9, reach]) { const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d; if (survWaterHere(x, z, 0.12)) { best = { x, z, d }; break; } }
  }
  return best;
}
function drinkAt(spot, kind) {
  const P = GAME.player;
  if (!P) return;
  if (P.mount) dismount(P);
  const lake = kind === 'lake';
  const yaw = Math.atan2(spot.x - P.x, spot.z - P.z);
  setAct(P, lake ? 6 : 5, lake ? 1.6 : 1.1);
  survStartJob({ kind: 'drink', label: lake ? 'Drinking' : 'Drawing water', dur: lake ? 1.6 : 1.2, yaw, done: () => {
    const before = SURV.thirst;
    needsDrink(1);
    const fill = Math.max(0, WATERSKINS_MAX - goodsCount('water'));
    if (fill > 0) goodsAdd('water', fill, true);
    const what = kind === 'lake' ? 'the lake' : kind === 'trough' ? 'the trough' : 'the well';
    uiLog(before < 0.97 && fill > 0 ? `You drink your fill from ${what} and fill your waterskins (${goodsCount('water')}).` : before < 0.97 ? `You drink your fill from ${what}.` : `You fill your waterskins at ${what} (${goodsCount('water')}).`, 'sys');
    sfx('drip'); later(0.18, () => sfx('drip'));
    if (lake && typeof waterSplash === 'function') waterSplash(spot.x, spot.z, 0.35);
    return false;
  } });
}

/* ------------------------------------------------------------------ */
/* eating and drinking from the packs                                  */
/* ------------------------------------------------------------------ */
function eatGood(id, quiet = false) {
  const G = GOODS[id], P = GAME.player;
  if (!G || !G.food || !P || !P.alive || !goodsHave(id)) return false;
  const f = G.food, wantH = (f.hunger || 0) > 0 && SURV.hunger < 0.97, wantT = (f.thirst || 0) > 0 && SURV.thirst < 0.97;
  if (!wantH && !wantT) { if (!quiet) uiError(f.hunger ? 'You are full' : 'You are not thirsty'); return false; }
  goodsTake(id, 1);
  needsEat(f.hunger || 0); needsDrink(f.thirst || 0);
  const drink = G.kind === 'drink' || (!f.hunger && f.thirst);
  if (!P.casting && !P.mount) setAct(P, 5, 0.7);
  survSfx(drink ? 'gulp' : 'munch');
  const raw = id === 'meat_raw' || id === 'fish_raw';
  const art = G.plural && G.plural === G.name ? 'some' : /^[aeiou]/i.test(G.name) ? 'an' : 'a';
  uiLog(`You ${drink ? 'drink' : 'eat'} ${art} ${G.name.toLowerCase()}.${raw ? ' Raw, it does little for you: cook it at a fire.' : ''}`, 'sys');
  if (id === 'water' && goodsCount('water') === 0) uiLog('Your waterskins are empty. Fill them at a well, a trough or a lake.', 'sys');
  GOODS_UI.dirty = true;
  if (UI.modal === 'kit') renderKit();
  return true;
}
// V or a tap on the bars: eat or drink whatever helps most, wasting least
function quickEatDrink() {
  const P = GAME.player;
  if (!P || !P.alive) return false;
  const needH = 1 - SURV.hunger, needT = 1 - SURV.thirst;
  if (needH < 0.03 && needT < 0.03) { uiError('You are not hungry or thirsty'); return false; }
  let best = null, bs = -1;
  for (const id in INV.goods || {}) {
    const G = GOODS[id];
    if (!G || !G.food || !(INV.goods[id] > 0) || G.kind === 'seed' || G.kind === 'herb') continue;
    const h = G.food.hunger || 0, t = G.food.thirst || 0;
    // what it does for what you lack (the bigger need first), less a little for waste and for eating it raw
    const gain = Math.min(h, needH) * (needH >= needT ? 1.3 : 1) + Math.min(t, needT) * (needT > needH ? 1.3 : 1);
    const waste = Math.max(0, h - needH) + Math.max(0, t - needT);
    const sc = gain - waste * 0.35 - (id === 'meat_raw' || id === 'fish_raw' ? 0.05 : 0) - G.value * 0.002;
    if (gain > 0.005 && sc > bs) { bs = sc; best = id; }
  }
  if (!best) { uiError(needT > needH ? 'You have nothing to drink. Try a well, a trough or a lake' : 'You have nothing to eat. Forage, hunt, fish or buy food'); return false; }
  return eatGood(best);
}
// every good with food value gets an Eat or Drink button in the bags (other systems' foods too)
function survivalFoodUses() {
  for (const id in GOODS) {
    const G = GOODS[id];
    if (!G.food || G.use) continue;
    G.use = (P, gid) => eatGood(gid);
    G.useLabel = G.kind === 'drink' || (!G.food.hunger && G.food.thirst) ? 'Drink' : 'Eat';
  }
}

/* ------------------------------------------------------------------ */
/* the hunt                                                            */
/* ------------------------------------------------------------------ */
const HUNT_DROPS = {
  wolf: [['meat_raw', 1, 2], ['hide', 1, 1], ['bone', 1, 2]],
  boar: [['meat_raw', 2, 3], ['hide', 1, 1], ['bone', 1, 1]],
  bear: [['meat_raw', 3, 4], ['hide', 1, 2], ['bone', 2, 3]],
  deer: [['meat_raw', 2, 3], ['hide', 1, 1], ['bone', 1, 1]],
  stag: [['meat_raw', 2, 4], ['hide', 1, 1], ['bone', 2, 2]],
};
// called when something the player hurt dies (grantKillRewards in 07_entities.js)
function huntOnKill(e) {
  const kind = e.kind === 'humanoid' ? null : e.kind;
  const D = HUNT_DROPS[kind];
  if (!D || inDungeon(e)) return;
  const knife = goodsHave('tool_knife');
  for (const [id, a, b] of D) {
    let n = a + Math.floor(Math.random() * (b - a + 1));
    if (knife && (id === 'meat_raw' || id === 'hide')) n += 1;
    if (n > 0) dropGood(id, n, e.x, e.z, e.y + 0.6 * (e.scale || 1));
  }
  if (!knife && Math.random() < 0.5) uiLog('A knife would have taken more meat and a cleaner hide.', 'sys');
}
// deer are game: the player may hunt them (isEnemy in 07_entities.js), and herds come back
function survivalGame() {
  FORAGE.herds = [];
  const byHerd = new Map();
  for (const e of ENT) if ((e.kind === 'deer' || e.kind === 'stag') && e.role === 'critter') {
    e.game = true;
    if (!byHerd.has(e.herd)) byHerd.set(e.herd, { herd: e.herd, home: e.home, n: 0, look: e.look, next: 0 });
    byHerd.get(e.herd).n++;
  }
  FORAGE.herds = [...byHerd.values()];
}
function stepHerds(dt) {
  FORAGE.herdT -= dt;
  if (FORAGE.herdT > 0 || !FORAGE.herds.length) return;
  FORAGE.herdT = 20;
  const P = GAME.player;
  for (const H of FORAGE.herds) {
    let n = 0;
    for (const e of ENT) if (e.herd === H.herd && e.alive && !e.removed && (e.kind === 'deer' || e.kind === 'stag')) n++;
    if (n >= H.n) { H.next = 0; continue; }
    if (!H.next) { H.next = GAME.t + 240 + Math.random() * 120; continue; }
    if (GAME.t < H.next || (P && dist(P.x, P.z, H.home.x, H.home.z) < 45)) continue;
    H.next = 0;
    const a = Math.random() * TAU, x = H.home.x + Math.cos(a) * 6, z = H.home.z + Math.sin(a) * 6;
    if (!isWalkable(x, z)) continue;
    const e = makeEnt({ kind: 'deer', faction: FACTION_NEUTRAL, role: 'critter', name: 'hind', level: 1, x, z, y: heightAt(x, z), yaw: Math.random() * TAU, scale: 0.86 + Math.random() * 0.12, radius: 0.4, speed: 10, look: { colA: H.look.colA.slice(), colB: H.look.colB.slice() }, herd: H.herd, home: H.home });
    e.ai.mode = 'graze'; e.ai.until = GAME.t + 3;
    e.game = true;
  }
}

/* ------------------------------------------------------------------ */
/* cooking at any fire                                                 */
/* ------------------------------------------------------------------ */
function fireNear(P, reach = 2.7) {
  let best = null, bd = reach;
  for (const f of FIRES) {
    if (f.ghost || f.until < GAME.t || Math.abs(f.y - P.y) > 2.4) continue;
    const d = dist(P.x, P.z, f.x, f.z) - 0.3 * f.size;
    if (d < bd) { bd = d; best = f; }
  }
  return best;
}
const fireName = (f) => (f.indoor ? 'the hearth' : f.station ? `the ${f.station}` : f.size < 0.7 ? 'the brazier' : 'the fire');
const fireHasPot = (f) => !!(f && (f.indoor || f.station === 'forge'));
// E at a fire with raw food: cook it all, one piece after another
function cookAll(f) {
  const P = GAME.player;
  const list = ['meat_raw', 'fish_raw'].filter((id) => goodsHave(id));
  if (!list.length) return;
  const total = list.reduce((a, id) => a + goodsCount(id), 0);
  const yaw = Math.atan2(f.x - P.x, f.z - P.z);
  let i = 0;
  const one = () => {
    const id = ['meat_raw', 'fish_raw'].find((k) => goodsHave(k));
    if (!id) return false;
    survCraftOnce(RECIPE_BY_ID[id === 'meat_raw' ? 'roast_meat' : 'grill_fish'], { fire: f, quiet: true });
    i++;
    SURV.job.i = i;
    if (!['meat_raw', 'fish_raw'].some((k) => goodsHave(k))) { uiLog(`You cook ${i} piece${i === 1 ? '' : 's'} over ${fireName(f)}.`, 'loot'); return false; }
    setAct(P, 5, 0.6);
    return true;
  };
  setAct(P, 5, 0.6);
  survStartJob({ kind: 'cook', label: 'Cooking', dur: 2.4, yaw, fire: f, n: total, i: 0, done: one });
}

/* ------------------------------------------------------------------ */
/* fishing                                                             */
/* ------------------------------------------------------------------ */
const FISH_KINDS = [
  { name: 'perch', w: [0.2, 0.7], realms: [0, 1, 2], when: 'day', p: 1.0 },
  { name: 'roach', w: [0.1, 0.45], realms: [0, 1], when: 'any', p: 0.8 },
  { name: 'carp', w: [0.8, 3.2], realms: [0], when: 'any', p: 0.45 },
  { name: 'brown trout', w: [0.4, 1.9], realms: [1, 2], when: 'dawn', p: 0.75 },
  { name: 'eel', w: [0.5, 1.7], realms: [0, 1, 2], when: 'night', p: 0.95 },
  { name: 'pike', w: [1.5, 6.5], realms: [0, 1, 2], when: 'any', p: 0.22 },
  { name: 'arctic char', w: [0.6, 2.4], realms: [2], when: 'any', p: 0.75 },
  { name: 'silver salmon', w: [3, 8.5], realms: [1, 2], when: 'dawn', p: 0.1 },
];
function fishWhen() { const n = U.uNight.value; return n > 0.55 ? 'night' : n > 0.12 || U.uLightDir.value.y < 0.22 ? 'dawn' : 'day'; }
function fishRoll(x, z) {
  const realm = realmAt(x, z), when = fishWhen(), sk = (SURV.skill.fish || 0) / 100;
  const pool = [];
  for (const F of FISH_KINDS) {
    if (!F.realms.includes(realm)) continue;
    let p = F.p * (F.when === 'any' ? 1 : F.when === when ? 1.8 : F.when === 'day' && when === 'dawn' ? 0.8 : 0.25);
    if (F.p < 0.3) p *= 1 + 2 * sk; // the rare ones come to the patient
    pool.push([F, p]);
  }
  let s = pool.reduce((a, [, p]) => a + p, 0) * Math.random();
  let F = pool[0][0];
  for (const [f, p] of pool) { s -= p; if (s <= 0) { F = f; break; } }
  const u = Math.pow(Math.random(), 1.6 - sk * 0.9);
  const kg = Math.round(lerp(F.w[0], F.w[1], u) * 10) / 10;
  return { name: F.name, kg, n: clamp(Math.round(kg / 1.4) + 1, 1, 4) };
}
// where the line can go: deep water 4 to 9 m out, roughly the way the player faces
function fishSpot(P) {
  if (inDungeon(P) || survWaterHere(P.x, P.z, 0.5)) return null;
  let best = null, bs = -Infinity;
  for (let k = 0; k < 16; k++) {
    const a = P.yaw + ((k % 2 ? 1 : -1) * Math.ceil(k / 2) * TAU) / 16;
    for (const d of [8, 6.5, 5, 4]) {
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
      if (!survWaterHere(x, z, 0.6)) continue;
      const sc = d * 0.1 - Math.abs(angDiff(a, P.yaw));
      if (sc > bs) { bs = sc; best = { x, z }; }
      break;
    }
  }
  return best;
}
function fishStart(spot) {
  const P = GAME.player;
  if (!P || !P.alive || !goodsHave('tool_rod')) return;
  if (P.mount) dismount(P);
  P.yaw = Math.atan2(spot.x - P.x, spot.z - P.z);
  P.target = null;
  SURV.fish = { phase: 'cast', t: 0, px: P.x, pz: P.z, yaw: P.yaw, bx: spot.x, bz: spot.z, sx: P.x, sy: P.y + 2, sz: P.z, wait: 0, nib: 0, nibAt: 0, win: 0, catch: null };
  P.fishing = true;
  setAct(P, 1, 0.75);
  survSfx('cast');
}
function fishStop(msg = 'You reel in your line.') {
  const P = GAME.player;
  SURV.fish = null;
  if (P) P.fishing = false;
  if (msg) uiLog(msg, 'sys');
}
function fishWait(F, longer = 1) {
  const sk = (SURV.skill.fish || 0) / 100, when = fishWhen();
  let w = (5 + Math.random() * 9) * (1 - 0.35 * sk) * (when === 'dawn' ? 0.75 : when === 'night' ? 1.1 : 1) * (WEATHER.raining > 0.2 ? 0.8 : 1) * longer;
  F.phase = 'wait'; F.t = 0; F.wait = w; F.nib = 1 + Math.floor(Math.random() * 3);
}
function fishStrike() {
  const F = SURV.fish, P = GAME.player;
  if (!F) return;
  if (F.phase === 'bite') {
    F.phase = 'reel'; F.t = 0;
    F.catch = fishRoll(F.bx, F.bz);
    setAct(P, 1, 0.6);
    survSfx('reel');
    if (typeof waterSplash === 'function') waterSplash(F.bx, F.bz, 0.9);
  } else if (F.phase === 'wait' || F.phase === 'nibble') {
    uiLog('Too soon: the fish takes fright. Wait for the float to go right under.', 'sys');
    if (typeof waterSplash === 'function') waterSplash(F.bx, F.bz, 0.3);
    fishWait(F, 1.4);
  }
}
function stepFishing(dt) {
  const F = SURV.fish, P = GAME.player;
  if (!F) return;
  if (!P || !P.alive || P.mount || P.casting || P.motion || dist(P.x, P.z, F.px, F.pz) > 0.6 || GAME.t < (P.combatUntil || 0) - 5.5 || !goodsHave('tool_rod')) { fishStop(P && P.alive ? 'You reel in your line.' : null); return; }
  F.t += dt;
  P.yaw = F.yaw;
  if (F.phase === 'cast' && F.t >= 0.7) {
    if (typeof waterSplash === 'function') waterSplash(F.bx, F.bz, 0.35);
    survSfx('plop');
    fishWait(F);
  } else if (F.phase === 'wait' && F.t >= F.wait) {
    F.phase = 'nibble'; F.t = 0; F.nibAt = 0.5;
  } else if (F.phase === 'nibble') {
    if (F.t >= F.nibAt) {
      F.nib--; F.nibAt = F.t + 0.55 + Math.random() * 0.6; F.dip = 0.35;
      FX.ring(F.bx, WATER_Y + 0.02, F.bz, 0.1, [0.25, 0.3, 0.34], 10, 0.5);
      survSfx('tick');
      if (F.nib < 0) {
        const sk = (SURV.skill.fish || 0) / 100;
        F.phase = 'bite'; F.t = 0; F.win = 0.85 + 0.6 * sk;
        if (typeof waterSplash === 'function') waterSplash(F.bx, F.bz, 0.6);
        survSfx('bite');
      }
    }
  } else if (F.phase === 'bite' && F.t >= F.win) {
    uiLog('It got away. Strike the moment the float goes under.', 'sys');
    fishWait(F, 1.1);
  } else if (F.phase === 'reel' && F.t >= 0.9) {
    const C = F.catch;
    const got = goodsAdd('fish_raw', C.n, true);
    uiLog(`You catch ${/^[aeiou]/.test(C.name) ? 'an' : 'a'} ${C.name} of ${C.kg} kg${got ? `: ${got} raw fish` : ''}.`, 'loot');
    uiFloatAt(P.x, P.y + 2.2, P.z, `${capFirst(C.name)} · ${C.kg} kg`, 'xp');
    skillGain('fish', 0.8 + Math.min(1.5, C.kg / 3));
    sfx('loot');
    F.phase = 'done'; F.t = 0;
  } else if (F.phase === 'done' && F.t >= 0.4) fishStop(null);
  if (F.dip) F.dip = Math.max(0, F.dip - dt * 1.4);
}

/* ------------------------------------------------------------------ */
/* the player's work: one job at a time, shown on the cast bar         */
/* ------------------------------------------------------------------ */
function survStartJob(o) {
  const P = GAME.player;
  if (!P) return;
  if (NATURE.job) natureStopJob(null);
  SURV.job = { t: 0, px: P.x, pz: P.z, i: 0, n: 0, ...o };
  if (o.yaw !== undefined) P.yaw = o.yaw;
  P.target = null;
}
function survStopJob(msg) { SURV.job = null; if (msg) uiLog(msg, 'sys'); if (UI.modal === 'craft') renderCraft(); }
function stepSurvJob(dt) {
  const J = SURV.job, P = GAME.player;
  if (!J) return;
  if (!P || !P.alive || P.casting || P.mount || P.motion || NATURE.job || dist(P.x, P.z, J.px, J.pz) > 0.35) { survStopJob(P && P.alive ? 'You stop working.' : null); return; }
  if (J.fire && J.fire.until < GAME.t) { survStopJob('The fire has gone out.'); return; }
  J.t += dt;
  if (J.yaw !== undefined) P.yaw = J.yaw;
  if (J.tick) J.tick(J, dt);
  if (J.t >= J.dur) {
    let again = false;
    try { again = J.done(J); } catch (e) { reportError(e); }
    if (again && SURV.job === J) J.t = 0;
    else if (SURV.job === J) SURV.job = null;
    if (UI.modal === 'craft') renderCraft();
  }
}
function survJobBar() {
  const J = SURV.job;
  if (!J) return null;
  return { label: J.label, frac: clamp(J.t / J.dur, 0, 1), count: J.n > 1 ? `${Math.min(J.i + 1, J.n)} / ${J.n}` : '' };
}

/* ------------------------------------------------------------------ */
/* the interaction list (09_player.js)                                 */
/* ------------------------------------------------------------------ */
function survivalOffers(P, offer) {
  if (!SURV.built || P.carrying != null) return;
  const F = SURV.fish;
  if (F) {
    if (F.phase === 'bite') offer(0.01, 1, 'Strike!', () => fishStrike(), 50);
    else if (F.phase === 'wait' || F.phase === 'nibble') offer(0.01, 1, F.phase === 'nibble' ? 'Wait for the float to go under' : 'Reel in your line', () => (F.phase === 'nibble' ? fishStrike() : fishStop()), 20);
    return;
  }
  if (inDungeon(P) || P.mount) return;
  const thirsty = SURV.thirst < 0.97, fill = goodsCount('water') < WATERSKINS_MAX;
  const waterLabel = (what) => (thirsty && fill ? `Drink from ${what} and fill your waterskins` : thirsty ? `Drink from ${what}` : `Fill your waterskins at ${what}`);
  if (thirsty || fill) {
    for (const w of wellSpots()) offer(dist(P.x, P.z, w.x, w.z), w.kind === 'well' ? 2.9 : 2.6, waterLabel(`the ${w.kind}`), () => drinkAt(w, w.kind), thirsty ? 0.08 : 0.03);
    const s = shoreNear(P);
    if (s && !survWaterFn()) offer(Math.max(0.1, s.d - 0.6), 2.6, waterLabel('the lake'), () => drinkAt(s, 'lake'), thirsty ? 0.06 : 0.01);
    else if (s && fill) offer(Math.max(0.1, s.d - 0.6), 2.6, 'Fill your waterskins', () => drinkAt(s, 'lake'), 0.01);
  }
  // a fire: cook what is raw (stews and the rest in the crafting book, C)
  const f = fireNear(P);
  if (f) {
    const raw = goodsCount('meat_raw') + goodsCount('fish_raw');
    if (raw > 0) offer(Math.max(0.1, dist(P.x, P.z, f.x, f.z) - 0.6), 2.7, `Cook your raw ${goodsHave('meat_raw') ? (goodsHave('fish_raw') ? 'meat and fish' : 'meat') : 'fish'} (${raw}) over ${fireName(f)}`, () => cookAll(f), 0.06);
    else if (RECIPES.some((r) => r.st === 'fire' && recipeFor(r, P) && recipeCanMake(r))) offer(Math.max(0.1, dist(P.x, P.z, f.x, f.z) - 0.6), 2.7, `Cook at ${fireName(f)}`, () => openCraft('fire'), -0.04);
  }
  const fp = forageNearest(P);
  if (fp) offer(fp.d, 1.5, FORAGE_KINDS[fp.p.k].verb, () => forageStart(fp.p), 0.02);
  if (goodsHave('tool_rod') && !SURV.job) { const sp = fishSpot(P); if (sp) offer(1.2, 2.4, 'Fish here', () => fishStart(sp), -0.03); }
  craftOffers(P, offer); // workstations and rocks (09t_craft.js)
}

/* ------------------------------------------------------------------ */
/* sounds                                                              */
/* ------------------------------------------------------------------ */
function survSfx(name, x, z) {
  if (!AUDIO.ctx || !AUDIO.on || AUDIO.ctx.state !== 'running') return;
  let v = 1;
  if (x !== undefined) { const d = Math.hypot(x - camera.position.x, z - camera.position.z); v = clamp(1.15 - d / 50, 0, 1); if (v <= 0.02) return; }
  const t = AUDIO.ctx.currentTime + 0.005;
  try {
    if (name === 'munch') { for (let k = 0; k < 3; k++) noiseBurst(t + k * 0.13 + Math.random() * 0.03, 0.06, 0.12 * v, 'bandpass', 1800 + Math.random() * 600, 900, 1.4); }
    else if (name === 'gulp') { for (let k = 0; k < 3; k++) { const f = 300 + Math.random() * 60; tone('sine', f, f * 0.6, t + k * 0.22, 0.09, 0.08 * v, 0.01); } }
    else if (name === 'cast') { noiseBurst(t, 0.35, 0.1 * v, 'bandpass', 900, 3200, 1.2, 0.02); }
    else if (name === 'plop') { tone('sine', 900, 260, t, 0.09, 0.08 * v, 0.002); noiseBurst(t, 0.08, 0.05 * v, 'highpass', 2500, 1800, 1); }
    else if (name === 'tick') { tone('sine', 1400, 900, t, 0.04, 0.03 * v, 0.002); }
    else if (name === 'bite') { tone('sine', 700, 180, t, 0.16, 0.12 * v, 0.002); noiseBurst(t, 0.25, 0.12 * v, 'bandpass', 1400, 600, 1.2); }
    else if (name === 'reel') { for (let k = 0; k < 7; k++) tone('square', 1600 + k * 40, 1500, t + k * 0.07, 0.025, 0.012 * v, 0.002); noiseBurst(t + 0.3, 0.4, 0.14 * v, 'bandpass', 1300, 700, 1); }
    else if (name === 'sizzle') { noiseBurst(t, 0.9, 0.06 * v, 'highpass', 3600, 5200, 0.8, 0.05); }
    else if (name === 'clink') { const f = 2400 + Math.random() * 500; tone('triangle', f, f * 0.98, t, 0.5, 0.06 * v, 0.001); tone('sine', f * 2.7, f * 2.6, t, 0.25, 0.02 * v, 0.001); noiseBurst(t, 0.04, 0.12 * v, 'highpass', 3000, 2500, 1); }
    else if (name === 'mine') { tone('triangle', 520, 380, t, 0.06, 0.12 * v); noiseBurst(t, 0.12, 0.2 * v, 'bandpass', 2600, 1200, 1.6); }
    else if (name === 'saw') { for (let k = 0; k < 4; k++) noiseBurst(t + k * 0.16, 0.12, 0.1 * v, 'bandpass', k % 2 ? 2200 : 1700, 1400, 3); }
    else if (name === 'scrape') { noiseBurst(t, 0.4, 0.1 * v, 'bandpass', 900, 1500, 2, 0.05); }
    else if (name === 'loom') { tone('sine', 140, 90, t, 0.1, 0.12 * v); noiseBurst(t + 0.25, 0.08, 0.08 * v, 'bandpass', 700, 500, 2); }
    else if (name === 'bubble') { for (let k = 0; k < 4; k++) { const f = 500 + Math.random() * 500; tone('sine', f, f * 1.6, t + k * 0.11 + Math.random() * 0.05, 0.06, 0.03 * v, 0.004); } }
  } catch (e) { /* audio is optional */ }
}

/* ------------------------------------------------------------------ */
/* the rod, the line, the float and the spit (drawn every frame)       */
/* ------------------------------------------------------------------ */
const SURV_FX = { rod: null, line: null, bob: null, spit: null, spitMat: null, linePts: null };
const SURV_PROP_VS = /* glsl */`
  attribute vec3 aCol;
  varying vec3 vW; varying vec3 vN; varying vec3 vC;
  void main(){
    vec4 w = modelMatrix * vec4(position, 1.0);
    vW = w.xyz; vN = mat3(modelMatrix) * normal; vC = aCol;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const SURV_PROP_FS = /* glsl */`
  ${GLSL_COMMON}
  ${GLSL_ATMOS}
  ${GLSL_SHADOW}
  ${GLSL_PLIGHT}
  ${GLSL_LIGHT}
  ${GLSL_WEATHER}
  uniform float uWet, uSnowCover;
  uniform vec4 uTint;
  varying vec3 vW; varying vec3 vN; varying vec3 vC;
  void main(){
    vec3 n = safeNormalize(vN);
    vec3 V = safeNormalize(cameraPosition - vW);
    gSh = shadowAt(vW, n); gPL = pointLights(vW, n);
    vec3 alb = mix(vC, uTint.rgb, uTint.a * step(0.5, vC.g - vC.b + 0.5) * step(vC.r, 0.9));
    alb = wetAlbedo(alb, uWet, 0.4);
    vec3 col = lightSurface(alb, n, 1.0) + wetSheen(vW, n, V, max(uWet, 0.15), 0.3, gSh);
    gl_FragColor = vec4(safeColor(applyFog(col, vW)), 1.0);
  }`;
function survPropGeo(parts) {
  const pos = [], nrm = [], col = [], idx = [];
  const v = new THREE.Vector3(), nv = new THREE.Vector3();
  let base = 0;
  for (const [g, m, c] of parts) {
    const p = g.attributes.position, nr = g.attributes.normal, nm = new THREE.Matrix3().getNormalMatrix(m);
    for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(m); nv.fromBufferAttribute(nr, i).applyMatrix3(nm).normalize(); pos.push(v.x, v.y, v.z); nrm.push(nv.x, nv.y, nv.z); col.push(c[0], c[1], c[2]); }
    const n = g.index ? g.index.count : p.count;
    for (let i = 0; i < n; i++) idx.push(base + (g.index ? g.index.getX(i) : i));
    base += p.count;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('aCol', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  return g;
}
function buildSurvivalFX() {
  const M = mat({ vertexShader: SURV_PROP_VS, fragmentShader: SURV_PROP_FS, uniforms: { uTint: { value: new THREE.Vector4(1, 1, 1, 0) } } });
  // the rod: a tapered cane with a cork grip and a little reel
  const cane = new THREE.CylinderGeometry(0.5, 1, 1, 6, 1); cane.translate(0, 0.5, 0);
  SURV_FX.rod = new THREE.Mesh(survPropGeo([
    [cane, fgM(0, 0, 0, 0.016, 2.7, 0.016), [0.42, 0.3, 0.17]],
    [cane, fgM(0, -0.05, 0, 0.024, 0.42, 0.024), [0.55, 0.42, 0.28]],
    [new THREE.CylinderGeometry(1, 1, 1, 8, 1), fgM(0.03, 0.42, 0, 0.045, 0.03, 0.045, 0, 0, Math.PI / 2), [0.3, 0.3, 0.32]],
  ]), M);
  // the float: red over white
  const sph = new THREE.SphereGeometry(1, 8, 6);
  SURV_FX.bob = new THREE.Mesh(survPropGeo([
    [sph, fgM(0, 0.02, 0, 0.045, 0.05, 0.045), [0.85, 0.85, 0.82]],
    [sph, fgM(0, 0.06, 0, 0.04, 0.035, 0.04), [0.8, 0.08, 0.05]],
    [cane, fgM(0, 0.08, 0, 0.004, 0.08, 0.004), [0.9, 0.88, 0.8]],
  ]), M);
  // the spit: a green stick with a lump of meat that browns as it cooks
  const lump = new THREE.SphereGeometry(1, 8, 6);
  SURV_FX.spitMat = mat({ vertexShader: SURV_PROP_VS, fragmentShader: SURV_PROP_FS, uniforms: { uTint: { value: new THREE.Vector4(0.42, 0.2, 0.08, 0) } } });
  SURV_FX.spit = new THREE.Mesh(survPropGeo([
    [cane, fgM(0, 0, 0, 0.012, 1.1, 0.012, 0, 0, Math.PI / 2), [0.48, 0.4, 0.22]],
    [lump, fgM(-0.55, 0, 0, 0.09, 0.07, 0.075), [0.7, 0.2, 0.18]],
    [lump, fgM(-0.42, 0.01, 0.01, 0.07, 0.06, 0.06), [0.72, 0.24, 0.2]],
  ]), SURV_FX.spitMat);
  // the line
  SURV_FX.linePts = new Float32Array(17 * 3);
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(SURV_FX.linePts, 3).setUsage(THREE.DynamicDrawUsage));
  SURV_FX.line = new THREE.Line(lg, new THREE.ShaderMaterial({
    uniforms: { uFogDensity: U.uFogDensity, uAmbient: U.uAmbient, uLightColor: U.uLightColor },
    vertexShader: /* glsl */`void main(){ gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0); }`,
    fragmentShader: /* glsl */`uniform vec3 uAmbient, uLightColor; void main(){ gl_FragColor = vec4(clamp((uAmbient * 0.7 + uLightColor * 0.5) * vec3(0.82, 0.82, 0.78), 0.0, 1.5), 1.0); }`,
  }));
  for (const m of [SURV_FX.rod, SURV_FX.bob, SURV_FX.spit, SURV_FX.line]) { m.visible = false; m.frustumCulled = false; m.renderOrder = 3; scene.add(m); }
}
// a point along the left forearm's haft, the way the body shader holds a brand (the rod is held the same way)
const _rodUp = new THREE.Vector3(0, 1, 0), _rodDir = new THREE.Vector3(), _rodQ = new THREE.Quaternion();
function survRodBase(e, out, along = 0) {
  const A = BRAND.pose;
  const rx = (a, v) => { const c = Math.cos(a), s = Math.sin(a); return [v[0], c * v[1] - s * v[2], s * v[1] + c * v[2]]; };
  const rz = (a, v) => { const c = Math.cos(a), s = Math.sin(a); return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]]; };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const t = 1.82, grip = SK.fist, pt = [grip[0], grip[1] + along * Math.cos(t), grip[2] + along * Math.sin(t)];
  let p = add(SK.elbow, rx(A.fa, sub(pt, SK.elbow)));
  p = add(SK.shoulder, rz(A.uaz, rx(A.ua, sub(p, SK.shoulder))));
  const sc = e.scale || 1, c = Math.cos(e.yaw), s = Math.sin(e.yaw);
  const x = p[0] * sc, y = p[1] * sc, z = p[2] * sc;
  out.set(e.x + x * c + z * s, e.y + y, e.z - x * s + z * c);
  return out;
}
const _rb = new THREE.Vector3(), _rt = new THREE.Vector3();
function drawSurvivalFX(dt) {
  if (!SURV_FX.rod) return;
  const P = GAME.player, F = SURV.fish;
  const show = !!(F && P && P.alive && !INDOOR.on);
  SURV_FX.rod.visible = SURV_FX.line.visible = SURV_FX.bob.visible = show;
  if (show) {
    survRodBase(P, _rb, 0); survRodBase(P, _rt, 0.47);
    _rodDir.subVectors(_rt, _rb).normalize();
    // the rod rises from the fist past the end of the grip; it bends down a little when a fish is on
    const bend = F.phase === 'reel' ? 0.35 : F.phase === 'bite' ? 0.2 : F.dip ? F.dip * 0.2 : 0;
    _rodDir.y -= bend; _rodDir.normalize();
    _rodQ.setFromUnitVectors(_rodUp, _rodDir);
    SURV_FX.rod.position.copy(_rb); SURV_FX.rod.quaternion.copy(_rodQ);
    const tip = _rt.copy(_rb).addScaledVector(_rodDir, 2.62);
    // the float: flies out on the cast, bobs, dips at a nibble, goes under at the bite, comes in with the fish
    let bx = F.bx, bz = F.bz, by = WATER_Y + 0.0;
    if (F.phase === 'cast') { const k = clamp(F.t / 0.7, 0, 1); bx = lerp(tip.x, F.bx, k); bz = lerp(tip.z, F.bz, k); by = lerp(tip.y, WATER_Y, k) + Math.sin(k * Math.PI) * 1.6; }
    else if (F.phase === 'bite') by = WATER_Y - 0.12 - 0.03 * Math.sin(renderTime * 30);
    else if (F.phase === 'reel' || F.phase === 'done') { const k = clamp(F.t / 0.9, 0, 1); bx = lerp(F.bx, tip.x, k); bz = lerp(F.bz, tip.z, k); by = lerp(WATER_Y, tip.y - 0.8, k) + Math.sin(k * Math.PI) * 1.2; }
    else by = WATER_Y - 0.02 + 0.015 * Math.sin(renderTime * 2.3) - (F.dip || 0) * 0.12;
    SURV_FX.bob.position.set(bx, by, bz);
    // the line sags between the tip and the float
    const L = SURV_FX.linePts, slack = F.phase === 'wait' || F.phase === 'nibble' ? 0.6 : 0.15;
    for (let i = 0; i <= 16; i++) { const u = i / 16; L[i * 3] = lerp(tip.x, bx, u); L[i * 3 + 1] = lerp(tip.y, by, u) - Math.sin(u * Math.PI) * slack; L[i * 3 + 2] = lerp(tip.z, bz, u); }
    SURV_FX.line.geometry.attributes.position.needsUpdate = true;
    // the catch: a fish on the line, thrashing on its way in
    if (F.phase === 'reel' && FISH.mesh) {
      const g = FISH.mesh.geometry, n = g.instanceCount;
      if (n < FISH.max) {
        g.attributes.iA.array.set([bx, by - 0.12, bz, renderTime * 2.2], n * 4);
        g.attributes.iB.array.set([tip.x - bx, 0.4, tip.z - bz, 0.9 + Math.min(1.4, F.catch.kg * 0.25)], n * 4);
        g.instanceCount = n + 1;
        g.attributes.iA.needsUpdate = true; g.attributes.iB.needsUpdate = true;
      }
      if (Math.random() < 0.5) fxAlpha.emit(bx, by, bz, (Math.random() - 0.5), 0.5 + Math.random(), (Math.random() - 0.5), 0.5, 0.6, 0.68, 0.74, 0.04, 9, 0);
    }
  }
  // cooking: the spit over the fire, browning
  const J = SURV.job, cooking = !!(J && J.kind === 'cook' && J.fire && P && !INDOOR.on);
  SURV_FX.spit.visible = cooking;
  if (cooking) {
    const f = J.fire, a = Math.atan2(P.x - f.x, P.z - f.z);
    SURV_FX.spit.position.set(f.x + Math.sin(a) * 0.15, f.y + 0.38 + 0.25 * (f.size || 1), f.z + Math.cos(a) * 0.15);
    SURV_FX.spit.rotation.set(0, a + Math.PI / 2, renderTime * 1.3);
    const k = clamp(J.t / J.dur, 0, 1);
    SURV_FX.spitMat.uniforms.uTint.value.w = smoothstepJS(0.2, 1, k) * 0.9;
    if (Math.random() < dt * 8) fxAlpha.emit(f.x + (Math.random() - 0.5) * 0.3, f.y + 0.6, f.z + (Math.random() - 0.5) * 0.3, U.uWindDir.value.x * 0.3, 0.6 + Math.random() * 0.4, U.uWindDir.value.y * 0.3, 2.2, 0.55, 0.52, 0.5, -0.25, -0.05, 0.1);
    J._sz = (J._sz || 0) - dt;
    if (J._sz <= 0) { J._sz = 0.9; survSfx('sizzle', f.x, f.z); }
  }
}
const smoothstepJS = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

/* ------------------------------------------------------------------ */
/* the HUD: food and water under the player's frame                    */
/* ------------------------------------------------------------------ */
function survivalHUD() {
  let el = $('needs');
  if (!el) {
    el = document.createElement('button');
    el.type = 'button';
    el.id = 'needs';
    el.className = 'needs';
    el.innerHTML = `<span class="nd food" title="Food"><i class="ic">${iconSvg('loaf', 14)}</i><b><i id="nd-h"></i></b></span><span class="nd water" title="Water"><i class="ic">${iconSvg('drop', 14)}</i><b><i id="nd-t"></i></b></span><span class="nds" id="nd-s"></span>`;
    el.addEventListener('click', (e) => { e.preventDefault(); quickEatDrink(); });
    const pf = $('pf'), buffs = $('pf-buffs');
    pf.insertBefore(el, buffs);
  }
  el.setAttribute('aria-label', `Food and water. ${IS_TOUCH ? 'Tap' : 'Click or press V'} to eat or drink.`);
}
function updateNeedsHUD() {
  const el = $('needs');
  if (!el) return;
  setW($('nd-h'), SURV.hunger); setW($('nd-t'), SURV.thirst);
  const S = needsState();
  setT($('nd-s'), S.label);
  if (el._k !== S.key) { el._k = S.key; el.dataset.k = S.key; }
  el.classList.toggle('lowh', SURV.hunger < 0.25);
  el.classList.toggle('lowt', SURV.thirst < 0.25);
}

/* ------------------------------------------------------------------ */
/* merchants: provisions and tools, and they buy your goods            */
/* ------------------------------------------------------------------ */
const PROVISIONS = ['bread', 'cheese', 'meat_cooked', 'apple', 'water', 'ale', 'flour', 'grain', 'feather', 'fibre', 'leather', 'iron', 'herb_heal', 'tool_knife', 'tool_rod', 'tool_axe', 'tool_pick', 'tool_hammer', 'tool_pot', 'tool_hoe', 'tool_shears'];
const goodBuyPrice = (id) => Math.max(1, Math.round((GOODS[id] ? GOODS[id].value : 1) * 2.5));
const goodSellPrice = (id) => Math.max(1, Math.round((GOODS[id] ? GOODS[id].value : 1) * 0.8));
function provisionsShopHTML() {
  const rows = PROVISIONS.filter((id) => GOODS[id]).map((id) => {
    const G = GOODS[id], p = goodBuyPrice(id), have = goodsCount(id);
    const tool = G.kind === 'tool';
    return `<div class="shoprow goodbuy"><span class="ic" style="--qc:#c9b98f">${iconSvg(G.icon, 20)}</span><span class="nm">${esc(G.name)}<small>${esc(G.desc)}${have ? ` · ${have} carried` : ''}</small></span><span class="pr">${fmtInt(p)}</span><span class="bb"><button class="btn" type="button" data-sbuy="${id}" data-n="1" ${INV.gold < p || (tool && have) ? 'disabled' : ''}>${tool && have ? 'Have one' : 'Buy'}</button>${tool ? '' : `<button class="btn" type="button" data-sbuy="${id}" data-n="5" ${INV.gold < p * 5 ? 'disabled' : ''}>5</button>`}</span></div>`;
  }).join('');
  const mine = Object.keys(INV.goods || {}).filter((id) => GOODS[id] && INV.goods[id] > 0).sort((a, b) => GOODS[a].name.localeCompare(GOODS[b].name));
  const sell = mine.map((id) => {
    const G = GOODS[id], n = INV.goods[id], p = goodSellPrice(id);
    return `<div class="shoprow goodsell"><span class="ic" style="--qc:#a8a49c">${iconSvg(G.icon, 20)}</span><span class="nm">${esc(goodName(id, n))}<small>${n} carried · ${fmtInt(p)} gold each</small></span><span class="bb"><button class="btn" type="button" data-ssell="${id}" data-n="1">Sell 1</button>${n > 1 ? `<button class="btn" type="button" data-ssell="${id}" data-n="${n}">All</button>` : ''}</span></div>`;
  }).join('');
  return `<h3>Provisions and tools</h3><div class="provs">${rows}</div>${sell ? `<h3>Your goods</h3><div class="provs">${sell}</div>` : ''}`;
}
function buyGood(id, n) {
  const p = goodBuyPrice(id), can = Math.min(n, Math.floor(INV.gold / p));
  if (can <= 0) { uiError('You cannot afford that'); return; }
  const got = goodsAdd(id, can, true);
  if (!got) return;
  INV.gold -= got * p;
  sfx('coins');
  uiLog(`You buy ${got} ${goodName(id, got).toLowerCase()} for ${fmtInt(got * p)} gold.`, 'loot');
  saveSoon();
}
function sellGood(id, n) {
  const have = goodsCount(id), k = Math.min(n, have);
  if (k <= 0 || !goodsTake(id, k)) return;
  const p = goodSellPrice(id) * k;
  INV.gold += p;
  sfx('coins');
  uiLog(`You sell ${k} ${goodName(id, k).toLowerCase()} for ${fmtInt(p)} gold.`, 'sys');
  saveSoon();
}
function bindSurvivalUI() {
  $('kit').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.sbuy) { buyGood(b.dataset.sbuy, +b.dataset.n || 1); renderKit(); }
    else if (b.dataset.ssell) { sellGood(b.dataset.ssell, +b.dataset.n || 1); renderKit(); }
    else if (b.id === 'kit-craft') { closeKit(); openCraft(null); }
    else if (b.id === 'kit-eat') { quickEatDrink(); renderKit(); }
  });
  bindCraftUI();
}
// the buttons under the bags (10b_kit.js)
function survivalKitButtons() {
  return `<button class="btn" type="button" id="kit-eat">${iconSvg('loaf', 16)}Eat or drink</button><button class="btn" type="button" id="kit-craft">${iconSvg('hammer', 16)}Crafting${IS_TOUCH ? '' : ' (C)'}</button>`;
}

/* ------------------------------------------------------------------ */
/* keys: V to eat or drink, C for the crafting book                    */
/* ------------------------------------------------------------------ */
window.addEventListener('keydown', (e) => {
  if (!GAME.started || typing() || e.repeat) return;
  if (e.code === 'Escape' && UI.modal === 'craft') { closeCraft(); return; }
  if (e.code === 'KeyC') { if (UI.modal === 'craft') closeCraft(); else if (!UI.modal) openCraft(null); return; }
  if (UI.modal) return;
  if (e.code === 'KeyV') quickEatDrink();
});

/* ------------------------------------------------------------------ */
/* boot, start, step and frame                                         */
/* ------------------------------------------------------------------ */
// at boot, after the keeps and towns are up and before the grass (its cover map then keeps blades out of what is placed)
function buildSurvival() {
  try { buildForage(); } catch (e) { reportError(e); }
  try { buildStations(); } catch (e) { reportError(e); }
  try { buildSurvivalFX(); } catch (e) { reportError(e); }
  try { bindSurvivalUI(); } catch (e) { reportError(e); }
  survivalFoodUses();
  SURV.built = true;
  if (window.__hm) window.__hm.surv = survTestHooks();
}
function survivalOnStart() {
  survivalFoodUses();
  survivalHUD();
  survivalGame();
  SURV.lx = null; SURV.job = null;
  if (SURV.fish) fishStop(null);
}
function updateSurvival(dt) {
  if (!SURV.built) return;
  updateNeeds(dt);
  stepSurvJob(dt);
  stepFishing(dt);
  stepForage(dt);
  stepHerds(dt);
  stepRocks(dt);
  craftHand();
}
function drawSurvival(dt) {
  if (!SURV.built) return;
  drawForage(dt);
  drawSurvivalFX(dt);
  if (GAME.started && GAME.player) { updateNeedsHUD(); drawCraftUI(); }
}

/* ---- the land remembers what was picked and mined (seconds left, capped) ---- */
registerSavePart('world', 'forage', {
  save() {
    const p = [], r = [];
    for (const q of FORAGE.list) if (q.ripe < 1 && p.length < 600) p.push([q.i, Math.max(1, Math.round(q.at - GAME.t)), Math.round(q.ripe * 100)]);
    for (const [i, R] of CRAFT.rocks) if (r.length < 300) r.push([i, R.n, Math.max(0, Math.round(R.until - GAME.t))]);
    return p.length || r.length ? { p, r } : null;
  },
  load(d) {
    for (const q of FORAGE.list) { q.ripe = 1; q.at = 0; }
    CRAFT.rocks.clear();
    if (!d || typeof d !== 'object') { FORAGE.dirty = true; return; }
    if (Array.isArray(d.p)) for (const e of d.p.slice(0, 600)) {
      if (!Array.isArray(e)) continue;
      const q = FORAGE.list[Math.round(+e[0])];
      const left = +e[1], rp = +e[2];
      if (!q || !Number.isFinite(left)) continue;
      q.at = GAME.t + clamp(left, 0, 3600);
      q.ripe = Number.isFinite(rp) ? clamp(rp / 100, 0, 0.99) : 0;
    }
    if (Array.isArray(d.r)) for (const e of d.r.slice(0, 300)) {
      if (!Array.isArray(e)) continue;
      const i = Math.round(+e[0]), n = Math.round(+e[1]), left = +e[2];
      if (!W.rocks[i] || !Number.isFinite(n) || !Number.isFinite(left)) continue;
      CRAFT.rocks.set(i, { n: clamp(n, 0, 3), until: GAME.t + clamp(left, 0, 3600) });
    }
    FORAGE.dirty = true;
  },
  key: (d) => (d ? [(d.p || []).map((e) => e[0]), (d.r || []).map((e) => e[0] + ':' + e[1])] : null),
});

/* ------------------------------------------------------------------ */
/* the woodcutter's take: a split log leaves firewood to carry too     */
/* ------------------------------------------------------------------ */
// called by the nature module when the player finishes splitting a log (05h_nature.js)
function natSplitGoods(t) {
  const axe = goodsHave('tool_axe');
  const got = [];
  const give = (id, n) => { const k = goodsAdd(id, n, true); if (k) got.push(`${k} ${goodName(id, k).toLowerCase()}`); };
  give('firewood', 2 + (axe ? 1 : 0) + (t.kind === 'oak' ? 1 : 0));
  give('log', 1);
  give('stick', 2);
  if (got.length) uiLog(`You carry away ${got.join(', ')}; the rest is stacked by the stump.`, 'loot');
}

/* ------------------------------------------------------------------ */
/* the help page and the Chronicle                                     */
/* ------------------------------------------------------------------ */
function survivalHelpHTML() {
  return `<div class="survhelp"><h3>Food, water and crafting</h3>
    <p>You grow hungry and thirsty over an hour or two of play: faster when you run, fight or stand in the sun or by a fire, slower when you rest. The two bars under your health show it. Fed and watered, your health, power and endurance come back faster; hungry or thirsty, slower. You never starve to death. ${IS_TOUCH ? 'Tap the bars' : 'Press <kbd>V</kbd> or click the bars'} to eat or drink the best thing you carry.</p>
    <p>Drink at a well, a trough or a lake (it fills your waterskins too). Pick berries, mushrooms, apples and herbs (E), hunt deer, wolves, boars and bears for meat and hides, fish with a rod at any water, and cook at any fire. Felled trees give logs and firewood; rocks give stone, and flint and iron ore to a pick.</p>
    <p>Every town has a forge, a workbench, a tanning rack, a loom, a bakehouse and an alchemy table; every keep a forge and a workbench. ${IS_TOUCH ? 'Use one' : 'Press E at one'} to open its recipes, or ${IS_TOUCH ? 'open Crafting from your kit' : 'press <kbd>C</kbd>'} for what you can make by hand. The more you make, the better your gear turns out. The Chronicle's page <b>Living off the land</b> tells you more.</p></div>`;
}
function chronLiving() {
  const S = needsState(), sk = SURV.skill;
  const pct = (v) => Math.round(v * 100);
  const row = (k) => `<li><b>${SKILL_NAMES[k]}</b> ${Math.floor(sk[k] || 0)} · ${skillRank(sk[k] || 0)}</li>`;
  return `<p class="lead">The March feeds those who know where to look. Bread in the towns, berries on the woods' edges, deer in the high meadows, fish in every lake; and in every town a forge, a bench and a loom for those who would make their own.</p>
    <h3>Hunger and thirst</h3>
    <p>Your belly empties over an hour or two of play, faster when you run or fight, slower when you rest; thirst comes a little sooner, sooner still in the sun or by a fire. Snow and rain make you hungrier. <b>Well fed</b> (both bars above half), health comes back a third faster and endurance a quarter faster. <b>Hungry</b> or <b>thirsty</b> (a bar below a quarter), they come back slowly; <b>starving</b> or <b>parched</b>, slower still. Nobody in the March dies of hunger: when you rise again the healers have fed you.</p>
    <p>Eat and drink from your bags, or ${IS_TOUCH ? 'tap the food and water bars' : 'press V or click the bars'} to take whatever helps most. Cooked food is four times as filling as raw; a bowl of stew is the best meal there is.</p>
    <h3>Water</h3>
    <p>Every town has a well, and most a trough. Drink there or at the edge of any lake (E): it slakes your thirst and fills your waterskins, up to ${WATERSKINS_MAX}.</p>
    <h3>Foraging</h3>
    <p><b>Berry bushes</b> grow along the woods' edges, <b>mushroom rings</b> in the shade of thick woods, and red <b>embercap</b> in the dark woods of Thule and the frontier, glowing after dusk. <b>Woundwort</b> likes damp meadows by the water, <b>starflower</b> the glens of Ériu, <b>rimeleaf</b> the cold of Thule and the heights, <b>thunder thistle</b> the rocky hills. <b>Nettles</b> give fibre for cloth and bowstrings. The <b>apple orchard</b> stands outside the town of Logres. Whatever you pick grows back in a few minutes${survSeason() ? ', though fruit and flowers wait out the winter' : ''}. A knife takes more from herbs and nettles.</p>
    <h3>Hunting and fishing</h3>
    <p>Deer, wolves, boars and bears leave meat, hides and bone where they fall; a knife takes more meat and a cleaner hide. Deer are shy: an archer has the best of them. With a <b>fishing rod</b>, stand at the water's edge and fish (E). Wait while the float bobs; when it goes right under, strike (E) at once. Perch and roach bite by day, trout and salmon at dawn and dusk, eels at night; carp in the ponds of Logres, char in the cold lakes of Thule, and now and then a great pike.</p>
    <h3>Cooking</h3>
    <p>Any fire cooks: a campfire, a hearth, a brazier, the forge. ${IS_TOUCH ? 'Use' : 'Press E at'} a fire to roast all your raw meat and fish. Stews need a pot: every hearth has one, or forge your own. The bakehouse grinds flour, bakes bread and pasties and brews ale. Lay a campfire anywhere with two bundles of firewood (crafting by hand).</p>
    <h3>Crafting</h3>
    <p>Every town has a <b>forge and anvil</b> (smelt ore into iron; tools, blades, mail and the mending of worn gear), a <b>workbench</b> (planks, sticks, rods, bows, staves, arrows), a <b>tanning rack</b> (leather and leather armour), a <b>loom</b> (cloth, cloaks, robes, hoods), a <b>bakehouse</b> and an <b>alchemy table</b> (healing draughts, the starflower tonic, wards against fire and frost, vigour). Every keep has a forge and a workbench.</p>
    <p>Materials come from the land: logs and firewood from felled trees, stone from rocks (a <b>pick</b> also breaks out flint and iron ore, most in the rocky hills), hides and bone from the hunt, fibre from nettles. Tools help: an <b>axe</b> fells and splits in fewer blows, a <b>pick</b> finds ore, a <b>knife</b> takes more from every kill and plant, a <b>hammer</b> mends gear good as new, a <b>pot</b> cooks stews anywhere, a <b>rod</b> fishes.</p>
    <p>Each thing you make teaches you. A practised hand works faster, wastes less and turns out better gear: a novice's blade is usually common, a master's often rare and now and then epic. Some recipes wait for skill.</p>
    <p class="now">Now: <b>${S.label.toLowerCase()}</b> (food ${pct(SURV.hunger)}%, water ${pct(SURV.thirst)}%).</p>
    <ul class="skills">${Object.keys(SKILL_NAMES).map(row).join('')}</ul>`;
}

/* ---- test hooks (__hm.surv) ---- */
const survTestHooks = () => ({
  SURV, NEEDS, FORAGE, FORAGE_KINDS, CRAFT, RECIPES, RECIPE_BY_ID, STATIONS, STATION_DEF,
  needsEat, needsDrink, needsState, needsMult, eatGood, quickEatDrink, forageTake, forageStart, forageNearest, drinkAt, wellSpots: () => wellSpots(), shoreNear,
  huntOnKill, fishStart, fishStrike, fishStop, fishSpot, fishRoll, cookAll, fireNear, survCraftOnce, craftStart, craftBlock, craftGear, openCraft, closeCraft, renderCraft,
  stationNear, rockNear, mineStart, mineYield, survivalOffers, survSeason, skillGain, craftOdds, natSplitGoods, chronLiving,
});
