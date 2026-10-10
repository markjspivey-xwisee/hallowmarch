/* ================================================================== */
/* [phones] level of detail and the phone's quality                    */
/* ================================================================== */
// Terrain: every 128 m chunk has two coarser index buffers over its own vertices (4 m and 8 m cells). The chunk's
// rim is always kept at full detail and zipped to the coarse inside, so neighbouring chunks meet whatever their level
// (no cracks), and craters (natTerrainUpdate writes the shared vertices) show at every level.
// Trees: the far chunks swap to the same trees with fewer faces (treeGeometry(kind, 1)), in the shadow pass too.
const LOD = { built: false, terrain: [], blocks: [], trees: [], lastQ: '', stats: { terrain: [0, 0, 0], blocks: 0, trees: [0, 0, 0] } };
// [full detail within, half detail within] metres from the chunk's nearest edge; beyond: quarter detail
const TERRAIN_LOD_D = { high: [150, 330], medium: [90, 230], low: [44, 150] };
const TREE_LOD_D = { high: 140, medium: 80, low: 0 }; // low: only the chunks the camera stands in keep near trees in full
// people beyond this are drawn with the farthest model (crowdHumanFar: fewer faces round the body, the head and the limbs)
const HUMAN_FAR = { high: 90, medium: 60, low: 38 };
// on medium and low the chunks round the camera are split tree by tree: the full model within this reach, the far one
// beyond (two draws in place of the chunk's one; refreshed as the camera moves or a tree falls). High keeps whole
// chunks (its near trees draw the closest ones in full).
const TREE_SPLIT_D = { medium: 60, low: 36 };
// and beyond this (from the chunk's nearest edge) the farthest model: the crown's big lobes only
const TREE_FAR2_D = { medium: 200, low: 100 };
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
  const far = {}, far2 = {};
  for (const m of treeChunks) {
    const k = m.userData.kind;
    if (!k) continue;
    if (!far[k]) { far[k] = treeGeometry(k, 1); far2[k] = treeGeometry(k, 2); }
    const g0 = m.geometry, f = far[k];
    const inst = (src) => {
      const g1 = new THREE.InstancedBufferGeometry();
      for (const a of ['position', 'normal', 'aPart', 'aAO']) g1.setAttribute(a, src.attributes[a]);
      g1.setIndex(src.index);
      for (const a of ['iPos', 'iRot']) g1.setAttribute(a, g0.attributes[a]); // the same trees: shared instance data
      g1.instanceCount = g0.instanceCount;
      g1.boundingSphere = g0.boundingSphere;
      return g1;
    };
    const g1 = inst(f), g2 = inst(far2[k]);
    LOD.trees.push({ m, gs: [g0, g1, g2], far: f, kind: k, x: m.userData.center.x, z: m.userData.center.y, lvl: 0, split: null });
  }
}
// a stand-in with no trees for the shadow pass (no draw at all)
function treeNoCast(T) {
  if (!T.none) { const g = new THREE.InstancedBufferGeometry(); for (const a of ['position', 'normal', 'aPart', 'aAO', 'iPos', 'iRot']) g.setAttribute(a, T.gs[1].attributes[a]); g.setIndex(T.gs[1].index); g.instanceCount = 0; g.boundingSphere = T.gs[0].boundingSphere; T.none = g; }
  return T.none;
}
// a chunk split tree by tree: two meshes of its own (full and far model) drawn in its place, the chunk itself hidden
// (it keeps its instance data: the nature module writes felled and regrown trees there, and the split follows)
function treeSplit(T, on, cx, cz, R) {
  const m = T.m;
  if (!on) { if (T.split && T.split.on) { T.split.on = false; T.split.hi.visible = T.split.lo.visible = false; m.visible = true; } return; }
  let S = T.split;
  const g0 = T.gs[0], n = g0.attributes.iPos.count;
  if (!S) {
    const mk = (src, cast) => {
      const g = new THREE.InstancedBufferGeometry();
      for (const a of ['position', 'normal', 'aPart', 'aAO']) g.setAttribute(a, src.attributes[a]);
      g.setIndex(src.index);
      g.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('iRot', new THREE.InstancedBufferAttribute(new Float32Array(n * 2), 2).setUsage(THREE.DynamicDrawUsage));
      g.instanceCount = 0; g.boundingSphere = g0.boundingSphere;
      const mesh = new THREE.Mesh(g, m.material);
      mesh.renderOrder = m.renderOrder; mesh.visible = false;
      (m.parent || scene).add(mesh);
      if (cast) shadowCaster(mesh, TREE_DEPTH); // only the near trees fall inside the shadow box
      return mesh;
    };
    S = T.split = { hi: mk(g0, true), lo: mk(T.far, false), x: 1e9, z: 1e9, ver: -1 };
  }
  // stand in for the chunk (a chunk this near the camera is always within the trees' draw distance)
  S.on = true; m.visible = false;
  const src = g0.attributes.iPos, rot = g0.attributes.iRot;
  if (Math.hypot(cx - S.x, cz - S.z) > 4 || src.version !== S.ver) {
    S.x = cx; S.z = cz; S.ver = src.version;
    const P = src.array, Rr = rot.array, hp = S.hi.geometry.attributes.iPos.array, hr = S.hi.geometry.attributes.iRot.array, lp = S.lo.geometry.attributes.iPos.array, lr = S.lo.geometry.attributes.iRot.array;
    let nh = 0, nl = 0;
    const cnt = Math.min(n, g0.instanceCount);
    for (let i = 0; i < cnt; i++) {
      const x = P[i * 4], z = P[i * 4 + 2];
      if ((x - cx) * (x - cx) + (z - cz) * (z - cz) < R * R) { hp[nh * 4] = x; hp[nh * 4 + 1] = P[i * 4 + 1]; hp[nh * 4 + 2] = z; hp[nh * 4 + 3] = P[i * 4 + 3]; hr[nh * 2] = Rr[i * 2]; hr[nh * 2 + 1] = Rr[i * 2 + 1]; nh++; }
      else { lp[nl * 4] = x; lp[nl * 4 + 1] = P[i * 4 + 1]; lp[nl * 4 + 2] = z; lp[nl * 4 + 3] = P[i * 4 + 3]; lr[nl * 2] = Rr[i * 2]; lr[nl * 2 + 1] = Rr[i * 2 + 1]; nl++; }
    }
    for (const [M, k] of [[S.hi, nh], [S.lo, nl]]) { const g = M.geometry; g.instanceCount = k; g.attributes.iPos.needsUpdate = true; g.attributes.iRot.needsUpdate = true; }
  }
  S.hi.visible = S.hi.geometry.instanceCount > 0;
  S.lo.visible = S.lo.geometry.instanceCount > 0;
}
// rocks: on medium and low only those within reach are drawn (the instance lists are cut down as the camera moves);
// the far glass of towns and halls and the furrowed soil of fields far away are not drawn on low and medium
const ROCK_D = { medium: 220, low: 140 }, GLASS_D = { medium: 160, low: 90 }, SOIL_D = { medium: 320, low: 170 };
function lodRocks(cx, cz, q) {
  const R = ROCK_D[q] || 0;
  if (!LOD.rocks) {
    LOD.rocks = [];
    scene.traverse((o) => { if (o.isMesh && o.material === rockMat && o.geometry.attributes.iPos) { const g = o.geometry; LOD.rocks.push({ g, ip: g.attributes.iPos.array.slice(), ir: g.attributes.iRot.array.slice(), n: g.instanceCount }); } });
  }
  if (Math.hypot(cx - (LOD.rockX ?? 1e9), cz - (LOD.rockZ ?? 1e9)) < 12 && R === LOD.rockR) return;
  LOD.rockX = cx; LOD.rockZ = cz; LOD.rockR = R;
  for (const K of LOD.rocks) {
    const ip = K.g.attributes.iPos.array, ir = K.g.attributes.iRot.array;
    let k = 0;
    for (let i = 0; i < K.n; i++) {
      const x = K.ip[i * 4], z = K.ip[i * 4 + 2];
      if (R && (x - cx) * (x - cx) + (z - cz) * (z - cz) > R * R) continue;
      for (let c = 0; c < 4; c++) { ip[k * 4 + c] = K.ip[i * 4 + c]; ir[k * 4 + c] = K.ir[i * 4 + c]; }
      k++;
    }
    K.g.instanceCount = k; K.g.attributes.iPos.needsUpdate = true; K.g.attributes.iRot.needsUpdate = true;
  }
}
function lodFar(cx, cz, q) {
  LOD.farT = (LOD.farT || 0) - 1;
  if (LOD.farT > 0 && LOD.lastQ === q) return;
  LOD.farT = 20; LOD.lastQ = q;
  const G = GLASS_D[q], D = SOIL_D[q];
  for (const S of houseTowns()) { const g = S.houseSet && S.houseSet.mGl; if (g) g.visible = !G || dist2(cx, cz, S.x, S.z) < (S.r + G) ** 2; }
  if (typeof farmSoilMesh !== 'undefined' && farmSoilMesh) farmSoilMesh.visible = !D || FARM.plots.some((P) => dist2(cx, cz, P.x, P.z) < (D + (P.rad || 10)) ** 2);
}
const lodEdge = (cx, cz, x, z, half) => Math.hypot(Math.max(0, Math.abs(x - cx) - half), Math.max(0, Math.abs(z - cz) - half));
// each frame: pick each chunk's level from the camera
function updateLod() {
  if (!GAME.built) return;
  if (!LOD.built) lodBuild();
  const q = quality.level, cx = camera.position.x, cz = camera.position.z;
  const TD = TERRAIN_LOD_D[q] || TERRAIN_LOD_D.high, RD = TREE_LOD_D[q] || TREE_LOD_D.high, RD2 = TREE_FAR2_D[q] || 1e9;
  const st = LOD.stats;
  st.terrain[0] = st.terrain[1] = st.terrain[2] = 0; st.trees[0] = st.trees[1] = st.trees[2] = 0;
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
  lodRocks(cx, cz, q); lodFar(cx, cz, q);
  const SD = TREE_SPLIT_D[q] || 0;
  for (const T of LOD.trees) {
    const d = lodEdge(T.x, T.z, cx, cz, 64);
    const l = d <= RD ? 0 : d < RD2 ? 1 : 2;
    if (l !== T.lvl) {
      T.lvl = l; T.m.geometry = T.gs[l];
      // far chunks lie outside the sun's shadow box (it reaches 38 to 46 m round the view): they cast nothing
      const px = T.m.userData.proxy;
      if (px) px.geometry = l ? treeNoCast(T) : T.gs[0];
    }
    // trees felled or regrown change the chunk's instance count: keep the far model's in step
    if (T.gs[1].instanceCount !== T.gs[0].instanceCount) T.gs[1].instanceCount = T.gs[2].instanceCount = T.gs[0].instanceCount;
    treeSplit(T, l === 0 && SD > 0, cx, cz, SD);
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
