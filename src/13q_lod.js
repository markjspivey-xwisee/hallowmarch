/* ================================================================== */
/* [phones] level of detail and the phone's quality                    */
/* ================================================================== */
// Terrain: every 128 m chunk has two coarser index buffers over its own vertices (4 m and 8 m cells). The chunk's
// rim is always kept at full detail and zipped to the coarse inside, so neighbouring chunks meet whatever their level
// (no cracks), and craters (natTerrainUpdate writes the shared vertices) show at every level.
// Trees: the far chunks swap to the same trees with fewer faces (treeGeometry(kind, 1)), in the shadow pass too.
const LOD = { built: false, terrain: [], blocks: [], trees: [], lastQ: '', stats: { terrain: [0, 0, 0], blocks: 0, trees: [0, 0] } };
// [full detail within, half detail within] metres from the chunk's nearest edge; beyond: quarter detail
const TERRAIN_LOD_D = { high: [150, 330], medium: [90, 230], low: [44, 150] };
const TREE_LOD_D = { high: 140, medium: 80, low: 30 };
// the triangles of an N-cell square at s-cell steps inside and full detail round its rim, in grid coordinates
// (front faces up, as the full grid has them)
function lodTris(N, s, emit) {
  const tri = (a, b, c) => { if ((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]) < 0) emit(a, b, c); else emit(a, c, b); };
  for (let j = s; j < N - s; j += s) for (let i = s; i < N - s; i += s) {
    const a = [i, j], b = [i + s, j], c = [i, j + s], d = [i + s, j + s];
    if (((i + j) / s) & 1) { tri(a, b, d); tri(a, d, c); } else { tri(a, b, c); tri(b, d, c); }
  }
  // the rim: each side zips the full-detail edge to the coarse ring inside it
  const sides = [(t) => [t, 0], (t) => [t, N], (t) => [0, t], (t) => [N, t]];
  const inner = [(t) => [t, s], (t) => [t, N - s], (t) => [s, t], (t) => [N - s, t]];
  for (let k = 0; k < 4; k++) {
    const O = sides[k], I = inner[k];
    let o = 0, q = s;
    while (o < N || q < N - s) {
      if (q >= N - s || (o < N && o + 1 <= q + s)) { tri(O(o), O(o + 1), I(q)); o++; }
      else { tri(O(o), I(q + s), I(q)); q += s; }
    }
  }
}
function terrainLodGeo(g0, s) {
  const idx = [], n = 65, v = (p) => p[1] * n + p[0];
  lodTris(64, s, (a, b, c) => idx.push(v(a), v(b), v(c)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', g0.attributes.position);
  g.setAttribute('normal', g0.attributes.normal);
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  g.boundingSphere = g0.boundingSphere;
  return g;
}
// far away, four chunks are drawn as one: a block of 2 x 2 chunks at 8 m cells (full detail round its rim), with its
// own few vertices; craters rebuild it (natTerrainUpdate is followed)
function terrainBlockGeo(bi, bj) {
  const N = 128, i0 = bi * N, j0 = bj * N, map = new Map(), pos = [], nrm = [], idx = [], H = W.H;
  let minY = 1e9, maxY = -1e9;
  const v = (p) => {
    const gi = i0 + p[0], gj = j0 + p[1], k = gj * HN + gi;
    let id = map.get(k);
    if (id === undefined) {
      id = pos.length / 3; map.set(k, id);
      const y = H[k];
      pos.push(-HALF + gi * HS, y, -HALF + gj * HS);
      const hl = H[gj * HN + Math.max(0, gi - 1)], hr = H[gj * HN + Math.min(HN - 1, gi + 1)];
      const hd = H[Math.max(0, gj - 1) * HN + gi], hu = H[Math.min(HN - 1, gj + 1) * HN + gi];
      const nx = (hl - hr) / (2 * HS), nz = (hd - hu) / (2 * HS), l = Math.hypot(nx, 1, nz);
      nrm.push(nx / l, 1 / l, nz / l);
      if (y < minY) minY = y; if (y > maxY) maxY = y;
    }
    return id;
  };
  lodTris(N, 4, (a, b, c) => idx.push(v(a), v(b), v(c)));
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  const cx = -HALF + (i0 + N / 2) * HS, cz = -HALF + (j0 + N / 2) * HS;
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, (minY + maxY) / 2, cz), Math.hypot(N, N, (maxY - minY) / 2));
  return g;
}
function lodBuild() {
  LOD.built = true;
  for (const m of terrainChunks) {
    const g0 = m.geometry, c = g0.boundingSphere.center;
    LOD.terrain.push({ m, gs: [g0, terrainLodGeo(g0, 2), terrainLodGeo(g0, 4)], x: c.x, z: c.z, lvl: 0 });
  }
  if (terrainChunks.length === 64) for (let bj = 0; bj < 4; bj++) for (let bi = 0; bi < 4; bi++) {
    const m = new THREE.Mesh(terrainBlockGeo(bi, bj), terrainMat);
    m.renderOrder = 1; m.visible = false;
    scene.add(m);
    const kids = [0, 1, 2, 3].map((k) => LOD.terrain[(bj * 2 + (k >> 1)) * 8 + bi * 2 + (k & 1)]);
    LOD.blocks.push({ m, bi, bj, kids, dirty: false });
  }
  const far = {};
  for (const m of treeChunks) {
    const k = m.userData.kind;
    if (!k) continue;
    if (!far[k]) far[k] = treeGeometry(k, 1);
    const g0 = m.geometry, f = far[k], g1 = new THREE.InstancedBufferGeometry();
    for (const a of ['position', 'normal', 'aPart', 'aAO']) g1.setAttribute(a, f.attributes[a]);
    g1.setIndex(f.index);
    for (const a of ['iPos', 'iRot']) g1.setAttribute(a, g0.attributes[a]); // the same trees: shared instance data
    g1.instanceCount = g0.instanceCount;
    g1.boundingSphere = g0.boundingSphere;
    LOD.trees.push({ m, gs: [g0, g1], x: m.userData.center.x, z: m.userData.center.y, lvl: 0 });
  }
}
const lodEdge = (cx, cz, x, z, half) => Math.hypot(Math.max(0, Math.abs(x - cx) - half), Math.max(0, Math.abs(z - cz) - half));
// each frame: pick each chunk's level from the camera
function updateLod() {
  if (!GAME.built) return;
  if (!LOD.built) lodBuild();
  const q = quality.level, cx = camera.position.x, cz = camera.position.z;
  const TD = TERRAIN_LOD_D[q] || TERRAIN_LOD_D.high, RD = TREE_LOD_D[q] || TREE_LOD_D.high;
  const st = LOD.stats;
  st.terrain[0] = st.terrain[1] = st.terrain[2] = 0; st.trees[0] = st.trees[1] = 0;
  for (const T of LOD.terrain) {
    // the land is never coarse right under the camera (a crater's walls, a cliff by the player)
    const d = lodEdge(T.x, T.z, cx, cz, 64);
    const l = d < TD[0] ? 0 : d < TD[1] ? 1 : 2;
    if (l !== T.lvl) { T.lvl = l; T.m.geometry = T.gs[l]; }
    st.terrain[l]++;
  }
  // a block of four far chunks goes as one draw
  st.blocks = 0;
  for (const B of LOD.blocks) {
    const far = B.kids.every((T) => T.lvl === 2);
    if (far && B.dirty) { B.m.geometry.dispose(); B.m.geometry = terrainBlockGeo(B.bi, B.bj); B.dirty = false; }
    B.m.visible = far;
    for (const T of B.kids) T.m.visible = !far;
    if (far) st.blocks++;
  }
  for (const T of LOD.trees) {
    const d = lodEdge(T.x, T.z, cx, cz, 64);
    const l = d < RD ? 0 : 1;
    if (l !== T.lvl) {
      T.lvl = l; T.m.geometry = T.gs[l];
      const px = T.m.userData.proxy;
      if (px) px.geometry = T.gs[l];
    }
    // trees felled or regrown change the chunk's instance count: keep the far model's in step
    if (T.gs[1].instanceCount !== T.gs[0].instanceCount) T.gs[1].instanceCount = T.gs[0].instanceCount;
    st.trees[l]++;
  }
}

/* the phone's quality: a touch screen starts at low (it can be raised in the menu), a small or weak desk at medium */
function phoneQualityPick() {
  if (!IS_TOUCH) return null;
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  const big = Math.min(screen.width, screen.height) >= 700; // a tablet
  return big && mem >= 6 && cores >= 8 ? 'medium' : 'low';
}
window.__hm.lod = { LOD, updateLod, terrainLodGeo, TERRAIN_LOD_D, TREE_LOD_D, phoneQualityPick };
// before the world is built: a phone builds its grass and shadows at its own level from the start
{
  const pick = phoneQualityPick();
  if (pick && pick !== quality.level) { quality.level = pick; Object.assign(quality, QUALITY_PRESETS[pick]); }
}
window.__hm.hud = { HUDL, hudLayout, npSeen, uiToast: (t) => uiToast(t), note: (id) => { loreNote(id); showNextNote(); return 0; } }; // [phones] 10p_hud.js
// craters reshape the land: the far blocks over them are rebuilt when next drawn
{
  const ntu = natTerrainUpdate;
  natTerrainUpdate = (i0, j0, i1, j1) => {
    ntu(i0, j0, i1, j1);
    for (const B of LOD.blocks) if (i1 >= B.bi * 128 - 1 && i0 <= B.bi * 128 + 129 && j1 >= B.bj * 128 - 1 && j0 <= B.bj * 128 + 129) B.dirty = true;
  };
}
