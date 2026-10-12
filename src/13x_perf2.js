/* ================================================================== */
/* [perf2] the March on a phone: memory, the boot and frame time      */
/* ================================================================== */
// (version 16) What a phone's page holds and where the time goes, measured with everything the game has become
// (tools/tests/perf2.py) and put right at the causes:
// - three.js keeps a CPU copy of every geometry's arrays for ever, beside the GPU's: a static mesh's copy (the houses,
//   the keeps and temples, the castles, the towers' rooms, the Barrow, the camps' props, the workstations) is let go
//   once it is on the GPU (perf2Release). About 80 MB of the page's 180 MB of ArrayBuffers were these copies.
// - the wrecks of things that may never fall (every stone tower's rubble, every curtain's breach, every gate's
//   splinters) are made the first time they show (perf2LazyMesh), not all at the boot.
// - the terrain's 64 chunks and their coarser levels share one index each (the same grid), 16-bit (03_terrain.js,
//   13q_lod.js).
// - every shader of what the boot has made, shown or not (the Barrow's, the crowds' far models, fire, rubble), is asked
//   for while the loading veil is still up (perf2Compile), not on the frame that first shows it.
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
  // the water map (02c_water_map.js: 4 MB of floats) is made once and never sent again
  const wt = WATERGRID.tex;
  if (wt && wt.image && wt.image.data) wt.onUpdate = (t) => { if (t.image.data) { PERF2.releasedMB += t.image.data.byteLength / 1048576; t.image.data = null; } t.onUpdate = null; };
}
// A mesh whose geometry is made the first time it is shown (`visible` set true): the wrecks of things that may never
// fall. Its shadow's proxy follows (shadowCaster made it with the empty geometry).
function perf2SetGeo(mesh, g) {
  const old = mesh.geometry;
  mesh.geometry = g;
  for (const q of SHADOW.proxies) if (q.userData.src === mesh) q.geometry = g;
  if (old && old !== g) old.dispose();
}
function perf2Make(mesh, make) {
  const t = performance.now(), g = make();
  perf2SetGeo(mesh, g);
  PERF2.made++; PERF2.madeMB += perf2Bytes(g) / 1048576; PERF2.makeMs = (PERF2.makeMs || 0) + performance.now() - t;
}
// `visible` is an accessor on the class's prototype: defined on each mesh instead (Object.defineProperty over the data
// property Object3D's constructor makes), it put every such mesh's properties in a dictionary, and the renderer's walk
// over the scene each frame read them slowly (a walk of 700 objects with 100 such: 0.14-0.27 ms against 0.05-0.08 here)
let PERF2_LAZY_MESH = null; // (made at first use: the boot builds the wrecks after this module's own code has run)
function perf2LazyMesh(make, material) {
  if (!PERF2_LAZY_MESH) PERF2_LAZY_MESH = class Perf2LazyMesh extends THREE.Mesh {
    get visible() { return this._pv; }
    set visible(v) { this._pv = !!v; if (this._pv && this._pm) { const f = this._pm; this._pm = null; perf2Make(this, f); } }
  };
  const m = new PERF2_LAZY_MESH(perf2Empty(), material); // (Object3D's constructor shows it: nothing to make yet)
  m._pm = make;
  m.visible = false;
  PERF2.lazy++;
  return m;
}
// an empty geometry with the building shader's attributes (as look3EmptyGeo, 04d_look3.js)
function perf2Empty() { return look3EmptyGeo(); }

/* the boot: each step's time (13_main.js's loadStep keeps them: the first was not timed before) */
window.__hm.perf2 = {
  PERF2,
  release: perf2Release, releaseStatic: perf2ReleaseStatic, lazy: perf2LazyMesh,
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
/* shaders: asked for while the loading veil is still up */
// three.js links a program as soon as compile() asks (compile prepares every material in the scene, hidden or not) and
// waits for it only at its first draw: asked for once the screen is sized (a canvas resize waits for every shader asked
// for), the GPU's process (a phone's driver, SwiftShader here) compiles them while the boot draws the map. The shadow
// pass's own (the depth materials of what casts a shadow, shown or not) are asked for once the title is up. What is
// made after the boot (an engine's charring, a fire's own) still compiles at its first sight.
function perf2Compile(shadows) {
  const t = performance.now(), p0 = renderer.info.programs.length;
  try {
    if (shadows) { if (SHADOW.rt) renderer.compile(SHADOW.scene, SHADOW.cam); }
    else { spellCompileVisible(true); renderer.compile(scene, camera); }
  } catch (e) { reportError(e); } finally { if (!shadows) spellCompileVisible(false); }
  gl.flush(); // (the GPU's process starts on them now)
  PERF2.warmed += renderer.info.programs.length - p0; PERF2.warmMs += performance.now() - t;
}
// The boot waits for the shaders with the veil counting them (where the browser tells whether a program is ready without
// waiting for it: KHR_parallel_shader_compile, a phone's Chrome and Safari): the page stays alive and says what it is
// doing; without it the first frame waits for them, as before. Gives up waiting after 90 s (the first frame then waits).
async function perf2Shaders(f0, f1) {
  const t0 = performance.now(), progs = renderer.info.programs, n = progs.length;
  if (!renderer.extensions.has('KHR_parallel_shader_compile') || !n) { PERF2.shaderWait = { n, ready: n, ms: 0, ext: false }; return; }
  const left = () => progs.filter((p) => p.isReady && !p.isReady()).length;
  let k = left();
  while (k > 0 && performance.now() - t0 < 90000) {
    $('loadbar').style.width = Math.round((f0 + (f1 - f0) * (1 - k / n)) * 100) + '%';
    $('loadmsg').textContent = `Lighting the sky: the shaders, ${n - k} of ${n}`;
    await new Promise((r) => setTimeout(r, 40));
    k = left();
  }
  PERF2.shaderWait = { n, ready: n - k, ms: Math.round(performance.now() - t0), ext: true };
  BOOT_STEPS.push(['Lighting the sky (waiting for the shaders)', PERF2.shaderWait.ms, Math.round(t0), performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null]);
}
{
  // the static meshes let go of their arrays once they are drawn (from right after the world is built)
  const go0 = groupOutdoors;
  groupOutdoors = function perf2GroupOutdoors() { go0(); try { perf2ReleaseStatic(); } catch (e) { reportError(e); } };
  // the shadow pass's shaders once the title is up (once: a new character's title comes again)
  const st0 = setupTitle;
  let warm = false;
  setupTitle = function perf2SetupTitle(...a) { st0.apply(this, a); if (!warm) { warm = true; setTimeout(() => perf2Compile(true), 300); } };
}
