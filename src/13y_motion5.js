/* ================================================================== */
/* [motion5] feet on the stones: the drawn surface of a fallen tower's */
/* rubble and a fallen house's heaps, for the feet that walk on them   */
/* ================================================================== */
// A breached tower's rubble is walked on along two ramps (04g_breach.js: from the field up over the fallen face, and down
// into the store room), and the bodies that storm it stand on them; the stones drawn over the ramps (the drum's dressed
// stones tumbled, broken pieces, a few squared blocks of the face, the floor's beams: look3's) stood a stone above the ramp
// here and a hand below it there, so a stormer's feet were in a stone one step and in the air over a gap the next. The
// mesh itself is the truth: rubHf rasterises the top faces of its triangles into a height map of RUB_CELL texels (the
// highest face over each texel's middle), once, when the heap first shows; the feet (the foot lock's floor, flFloor in
// 13s_footlock.js) stand on it where it lies within reach of the body, the rubble's ramps left to the bodies themselves.
// A fallen house's heaps (04j_rubble.js) are the same: a foot by a broken wall steps onto the masonry heaped at its foot.
const RUB_CELL = 0.08;
// [motion5] how far before the body's middle a builder's mallet strikes at the blow of action 23 (05a_rig.js), at about
// chest height: a builder stands this far from the wall's face (houseScafWorkSpot, 04j_rubble.js; the masons, 13v_look3.js)
const HAMMER_REACH = 0.705;
const RUBHF = { maps: new Map(), off: false, stats: { built: 0, cells: 0, ms: 0, asks: 0, hits: 0 } }; // (off: the feet on the ramps as before, for the measures)
// the height map of a mesh's top faces (positions in the world: the rubble meshes are built in place)
function rubHfBuild(geo) {
  const t0 = performance.now(), pos = geo.attributes.position.array, idx = geo.index ? geo.index.array : null, nTri = (idx ? idx.length : pos.length / 3) / 3;
  if (!geo.boundingBox) geo.computeBoundingBox();
  const bb = geo.boundingBox, x0 = bb.min.x - RUB_CELL, z0 = bb.min.z - RUB_CELL;
  const nx = Math.min(400, Math.ceil((bb.max.x - x0) / RUB_CELL) + 2), nz = Math.min(400, Math.ceil((bb.max.z - z0) / RUB_CELL) + 2);
  const h = new Float32Array(nx * nz).fill(-1e9);
  for (let t = 0; t < nTri; t++) {
    const a = idx ? idx[t * 3] : t * 3, b = idx ? idx[t * 3 + 1] : t * 3 + 1, c = idx ? idx[t * 3 + 2] : t * 3 + 2;
    const ax = pos[a * 3], ay = pos[a * 3 + 1], az = pos[a * 3 + 2], bx = pos[b * 3], by = pos[b * 3 + 1], bz = pos[b * 3 + 2], cx = pos[c * 3], cy = pos[c * 3 + 1], cz = pos[c * 3 + 2];
    // (a face looking up: its normal's rise, either winding)
    const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az;
    const ny = uz * vx - ux * vz, nl = Math.hypot(uy * vz - uz * vy, ny, ux * vy - uy * vx);
    if (nl < 1e-9 || Math.abs(ny) / nl < 0.25) continue;
    const den = (bz - cz) * (ax - cx) + (cx - bx) * (az - cz);
    if (Math.abs(den) < 1e-10) continue;
    const i0 = Math.max(0, Math.floor((Math.min(ax, bx, cx) - x0) / RUB_CELL)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx, cx) - x0) / RUB_CELL));
    const j0 = Math.max(0, Math.floor((Math.min(az, bz, cz) - z0) / RUB_CELL)), j1 = Math.min(nz - 1, Math.ceil((Math.max(az, bz, cz) - z0) / RUB_CELL));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const px = x0 + (i + 0.5) * RUB_CELL, pz = z0 + (j + 0.5) * RUB_CELL;
      const l1 = ((bz - cz) * (px - cx) + (cx - bx) * (pz - cz)) / den, l2 = ((cz - az) * (px - cx) + (ax - cx) * (pz - cz)) / den, l3 = 1 - l1 - l2;
      if (l1 < -1e-4 || l2 < -1e-4 || l3 < -1e-4) continue;
      const y = l1 * ay + l2 * by + l3 * cy, k = j * nx + i;
      if (y > h[k]) h[k] = y;
    }
  }
  let n = 0; for (let k = 0; k < h.length; k++) if (h[k] > -1e8) n++;
  RUBHF.stats.built++; RUBHF.stats.cells += n; RUBHF.stats.ms += performance.now() - t0;
  return { x0, z0, nx, nz, h, x1: x0 + nx * RUB_CELL, z1: z0 + nz * RUB_CELL };
}
// the heaps that lie now: a breached tower's rubble (while it shows) and every fallen house's heaps
function rubHfSync() {
  const want = new Set();
  for (const W of (typeof TBREACH !== 'undefined' ? TBREACH.list : [])) if (W.wreck && W.wreck.visible && W.state !== 'whole') want.add(W.wreck);
  if (typeof RUBBLE !== 'undefined') for (const R of RUBBLE.list.values()) if (R.mesh && R.mesh.parent) want.add(R.mesh);
  for (const m of RUBHF.maps.keys()) if (!want.has(m)) RUBHF.maps.delete(m);
  for (const m of want) { const E = RUBHF.maps.get(m); if (!E || E.geo !== m.geometry) RUBHF.maps.set(m, { geo: m.geometry, ...rubHfBuild(m.geometry) }); }
}
// the drawn rubble's top at (x, z), or null where no heap lies (the highest of the texels about the point within a
// quarter of a sole's breadth: a foot stands on the stone it is over, not between the texels)
function rubbleTopAt(x, z) {
  if (!RUBHF.maps.size) return null;
  RUBHF.stats.asks++;
  let best = null;
  for (const E of RUBHF.maps.values()) {
    if (x < E.x0 || z < E.z0 || x >= E.x1 || z >= E.z1) continue;
    const fi = (x - E.x0) / RUB_CELL - 0.5, fj = (z - E.z0) / RUB_CELL - 0.5, i = Math.round(fi), j = Math.round(fj);
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= E.nx || jj >= E.nz || (Math.abs(ii - fi) > 0.75 || Math.abs(jj - fj) > 0.75)) continue;
      const y = E.h[jj * E.nx + ii];
      if (y > -1e8 && (best === null || y > best)) best = y;
    }
  }
  if (best !== null) RUBHF.stats.hits++;
  return best;
}
// floorAt without the rubble's own ramps: what lies under the heap (the field, the store room's floor)
function floorUnderRubble(x, z, y) {
  let g = heightAt(x, z);
  const list = FLOOR.grid.get(collKey(Math.floor(x / FLOOR.cell), Math.floor(z / FLOOR.cell)));
  if (!list) return g;
  for (const f of list) {
    if (!f.active || f.tag === 'rubble') continue;
    const t = floorTopOf(f, x, z);
    if (t !== null && t > g && t <= y + FLOOR_STEP) g = t;
  }
  return g;
}
// the floor a foot stands on at (x, z) for a body at y, where a heap lies: the stone drawn there (or, between the stones,
// what lies under the heap), never the rubble's ramp; null where no heap lies (the floor as it is)
function rubbleFootFloor(x, z, y) {
  const top = rubbleTopAt(x, z);
  if (top === null) return null;
  const under = floorUnderRubble(x, z, y);
  return Math.max(top, under);
}
// the mound under a fallen tower's stones (from towerRubbleGeo, 04g_breach.js): broken masonry and grit over the two
// ramps a body walks (the field's up over the fallen face, the store room's down into it), falling away at their sides to
// the ground. The stones lay scattered over the bare field with the ramps invisible between them: a body walking the ramps
// stood in the air between the stones, half a metre over the grass
function rubbleMound(b, W) {
  const C = W.C, col = darker(C.st.stone, 0.48), side = 0.55;
  for (const f of W.rubbleFloors || []) {
    if (f.type !== 'box') continue;
    const NX = 8, NZ = Math.max(4, Math.round(f.hz * 2 / 0.35)), pos = [], idx = [], r = mulberry(Math.round(Math.abs(f.x * 13 + f.z * 7)) + 11);
    for (let j = 0; j <= NZ; j++) for (let i = 0; i <= NX; i++) {
      const lx = (i / NX * 2 - 1) * (f.hx + side), lz = (j / NZ * 2 - 1) * f.hz * 0.999;
      const x = f.x + lx * f.cos + lz * f.sin, z = f.z - lx * f.sin + lz * f.cos;
      const top = f.ya + (f.yb - f.ya) * (lz + f.hz) / (2 * f.hz), out = sstepJ(f.hx, f.hx + side, Math.abs(lx));
      const g = floorUnderRubble(x, z, top);
      const y = lerp(top, Math.min(top, g) - 0.05, out) + (i > 0 && i < NX && j > 0 && j < NZ ? (r() - 0.5) * 0.06 : -0.02);
      pos.push(x, y, z);
    }
    for (let j = 0; j < NZ; j++) for (let i = 0; i < NX; i++) { const a = j * (NX + 1) + i, c = a + NX + 1; idx.push(a, c, a + 1, a + 1, c, c + 1); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx); g.computeVertexNormals();
    // (faces up: the winding by the first triangle's normal)
    const nrm = g.attributes.normal; let up = 0; for (let k = 0; k < nrm.count; k++) up += nrm.getY(k);
    if (up < 0) { for (let k = 0; k < idx.length; k += 3) { const t = idx[k + 1]; idx[k + 1] = idx[k + 2]; idx[k + 2] = t; } g.setIndex(idx); g.computeVertexNormals(); }
    b.add(g, new THREE.Matrix4(), MAT.rock, col, C.S.y, 1.5);
  }
}
// a stone of the heap over a ramp a body walks lies in the mound, its top no more than a short step over the ramp (the
// heap's stones stood up to 0.8 m over the way in, and the stormers walked through them): the height (site-local) to set a
// stone at site-local (lx, lz) wanted at ly, whose top is about half over its middle
function rubbleSinkY(W, lx, ly, lz, half) {
  const S = W.C.S, p = siteToWorld(S, lx, lz);
  let best = null;
  for (const f of W.rubbleFloors || []) {
    const dx = p.x - f.x, dz = p.z - f.z, fx = dx * f.cos - dz * f.sin, fz = dx * f.sin + dz * f.cos;
    if (Math.abs(fx) > f.hx + 0.4 || Math.abs(fz) > f.hz + 0.2) continue;
    const t = f.ya + (f.yb - f.ya) * (clamp(fz, -f.hz, f.hz) + f.hz) / (2 * f.hz) - S.y;
    best = best === null ? t : Math.max(best, t);
  }
  return best === null ? ly : Math.min(ly, best + 0.14 - half);
}
window.__hm.motion5 = { rubbleSinkY, rubbleMound, RUBHF, RUB_CELL, rubHfBuild, rubHfSync, rubbleTopAt, floorUnderRubble, rubbleFootFloor };
