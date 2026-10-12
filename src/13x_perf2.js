/* ================================================================== */
/* [perf2] the March on a phone: memory, the boot and frame time      */
/* ================================================================== */
// (version 16) What a phone's page holds and where the time goes, measured with everything the game has become
// (tools/tests/perf2.py) and put right at the causes:
// - three.js keeps a CPU copy of every geometry's arrays for ever, beside the GPU's: a static mesh's copy (the houses,
//   the keeps and temples, the castles, the towers' rooms, the Barrow, the camps' props, the workstations) is let go
//   once it is on the GPU (perf2Release). About 80 MB of the page's 180 MB of ArrayBuffers were these copies.
// - the wrecks of things that may never fall (every stone tower's rubble, every curtain's breach, every gate's
//   splinters) are made the first time they show (perf2Lazy), not all at the boot.
// - the terrain's 64 chunks and their coarser levels share one index each (the same grid), 16-bit (03_terrain.js,
//   13q_lod.js).
// - the shaders that are not in view at the boot (the Barrow's, the crowds' far models, fire, rubble) are compiled
//   while the loading veil is still up (perf2Warm), not on the frame that first shows them.
const PERF2 = { released: 0, releasedMB: 0, pending: 0, lazy: 0, made: 0, madeMB: 0, warmed: 0, warmMs: 0 };
function perf2Bytes(g) {
  let b = 0;
  const seen = new Set();
  for (const k in g.attributes) { const a = g.attributes[k], arr = a.isInterleavedBufferAttribute ? a.data.array : a.array; if (arr && !seen.has(arr)) { seen.add(arr); b += arr.byteLength; } }
  if (g.index && g.index.array) b += g.index.array.byteLength;
  return b;
}
// A geometry that never changes after it is built lets go of its arrays once three.js has put them on the GPU
// (three.js calls an attribute's onUpload right after its bufferData). Nothing may read or rewrite its arrays after
// that: its bounding sphere is worked out first, and its counts stay (BufferAttribute.count).
function perf2FreeArray() { if (this.array) { PERF2.releasedMB += this.array.byteLength / 1048576; this.array = null; } }
function perf2Release(g) {
  if (!g || g.isInstancedBufferGeometry || g.userData.perf2) return;
  g.userData.perf2 = true;
  if (!g.boundingSphere) g.computeBoundingSphere();
  if (!g.boundingBox && g.attributes.position && g.attributes.position.count) g.computeBoundingBox();
  for (const k in g.attributes) { const a = g.attributes[k]; if (!a.isInterleavedBufferAttribute && !a.isGLBufferAttribute) a.onUpload(perf2FreeArray); }
  if (g.index) g.index.onUpload(perf2FreeArray);
  PERF2.released++;
}
// The static meshes, once the world is built: what each holds is built once and moved only by uniforms
// (the houses' doors, fire and fall; the castles' breaches; the towers' rooms shown near).
function perf2ReleaseStatic() {
  if (window.__perf2NoRelease) return; // (a test that reads the static meshes' arrays: tools/tests/perf2.py geohash)
  const out = new Set();
  const add = (m) => { if (m && m.isMesh && !m.isInstancedMesh && m.geometry) out.add(m.geometry); };
  for (const m of SITE_MESHES) add(m);
  for (const C of CASTLES) add(C.mesh);
  for (const q of TOWER.inner) add(q.m);
  for (const S of houseTowns()) { const H = S.houseSet; if (H) { add(H.mExt); add(H.mIn); add(H.mGl); } }
  if (CRAFT.mesh) add(CRAFT.mesh);
  if (DUN.root) DUN.root.traverse((o) => { if (o.isMesh && !o.isInstancedMesh && o.material === buildingMat) add(o); });
  for (const g of out) perf2Release(g);
  PERF2.pending = out.size;
}
// A mesh whose geometry is made the first time it is shown (`visible` set true): the wrecks of things that may never
// fall. Its shadow's proxy follows (shadowCaster made it with the empty geometry).
function perf2SetGeo(mesh, g) {
  const old = mesh.geometry;
  mesh.geometry = g;
  for (const q of SHADOW.proxies) if (q.userData.src === mesh) q.geometry = g;
  if (old && old !== g) old.dispose();
}
function perf2Lazy(mesh, make) {
  let vis = !!mesh.visible, made = false;
  const build = () => {
    made = true;
    const t = performance.now(), g = make();
    perf2SetGeo(mesh, g);
    PERF2.made++; PERF2.madeMB += perf2Bytes(g) / 1048576; PERF2.makeMs = (PERF2.makeMs || 0) + performance.now() - t;
  };
  Object.defineProperty(mesh, 'visible', {
    configurable: true, enumerable: true,
    get() { return vis; },
    set(v) { vis = !!v; if (vis && !made) build(); },
  });
  if (vis) build();
  mesh.userData.perf2Lazy = true; // (perf2Compile leaves it hidden: showing it would make it)
  PERF2.lazy++;
  return mesh;
}
// an empty geometry with the building shader's attributes (as look3EmptyGeo, 04d_look3.js)
function perf2Empty() { return look3EmptyGeo(); }

/* the boot: each step's time (13_main.js's loadStep keeps them: the first was not timed before) */
window.__hm.perf2 = {
  PERF2,
  release: perf2Release, releaseStatic: perf2ReleaseStatic, lazy: perf2Lazy,
  steps: () => BOOT_STEPS.slice(), // [name, ms, when it began (ms after the page began)]
  scriptAt: Math.round(BOOT_T0), // when the game's script began to run (ms after the page began: the page, three.js, the script's parse)
  // what the page holds now, by kind (the geometries the scene draws, with their arrays let go or not)
  mem() {
    let geos = 0, kept = 0, freed = 0;
    const seen = new Set();
    scene.traverse((o) => {
      const g = o.geometry;
      if (!g || seen.has(g)) return;
      seen.add(g); geos++;
      if (g.userData.perf2) { const b = perf2Bytes(g); if (b) kept += b; else freed++; }
    });
    return { geos, released: PERF2.released, freedGeos: freed, keptMB: +(kept / 1048576).toFixed(1), releasedMB: +PERF2.releasedMB.toFixed(1), lazy: PERF2.lazy, made: PERF2.made, madeMB: +PERF2.madeMB.toFixed(2), warmed: PERF2.warmed, warmMs: Math.round(PERF2.warmMs) };
  },
};
/* shaders: compiled while the loading veil is still up, and the hidden things' too while the title shows */
// three.js links a program as soon as compile() asks and waits for it only on its first draw: asked early, the GPU's
// process (a phone's driver, SwiftShader here) compiles them while the boot goes on (the map, the save); the first frame
// then waits only for what is not done yet. The hidden meshes (the Barrow, a tower's rooms, the dragon far off, what
// shows only in a fight or a fire) are asked for once the title is up, so their first sight does not stall a frame.
function perf2Compile(all) {
  const t = performance.now(), p0 = renderer.info.programs.length, shown = [];
  if (all) scene.traverse((o) => { if (!o.visible && !o.userData.perf2Lazy && (o.isMesh || o.isPoints || o.isLine || o.isGroup || o.isObject3D)) { shown.push(o); o.visible = true; } });
  const dun = DUN.root ? DUN.root.visible : false;
  try {
    if (DUN.root) DUN.root.visible = true;
    spellCompileVisible(true);
    renderer.compile(scene, camera);
    if (all && SHADOW.rt) renderer.compile(SHADOW.scene, SHADOW.cam);
  } catch (e) { reportError(e); } finally {
    for (const o of shown) o.visible = false;
    if (DUN.root) DUN.root.visible = dun;
    spellCompileVisible(false);
  }
  gl.flush(); // (the GPU's process starts on them now)
  PERF2.warmed += renderer.info.programs.length - p0; PERF2.warmMs += performance.now() - t;
}
{
  // the static meshes let go of their arrays once they are drawn (from right after the world is built), and the
  // shaders of what is in the scene are asked for at once
  const go0 = groupOutdoors;
  groupOutdoors = function perf2GroupOutdoors() { go0(); try { perf2ReleaseStatic(); perf2Compile(false); } catch (e) { reportError(e); } };
  // the hidden things' shaders once the title is up (once: a new character's title comes again)
  const st0 = setupTitle;
  let warm = false;
  setupTitle = function perf2SetupTitle(...a) { st0.apply(this, a); if (!warm) { warm = true; setTimeout(() => perf2Compile(true), 300); } };
}
