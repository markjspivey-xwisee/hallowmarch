/* ================================================================== */
/* Opt-in, stationary GPU isolation. Never enters the game frame loop. */
/* ================================================================== */
// Boot calls await graphicsRunDiagnostic() after CPU world construction and
// sizing, before compile(), tick(), title setup, readiness or RAF scheduling.
// A true return means boot is handled and must return. Normal launches return
// false. This diagnostic requires both ?safe=1 and ?gpuDiag=1.
//
// One manual click submits one batch. A fence must finish before another click
// can submit work. A timeout, shader error, GL error or context loss permanently
// stops this diagnostic tab. A fence receipt establishes completion of that
// batch; it does not prove compatibility with later frames or other hardware.
const GPU_DIAG_REQUESTED = new URLSearchParams(location.search).get('gpuDiag') === '1';
const GPU_DIAG_TIMEOUT_MS = 15000;
const GPU_DIAG_POLL_MS = 25;
let GPU_DIAG_STATE = null;

function graphicsDiagnosticActive() { return !!(GPU_DIAG_STATE && GPU_DIAG_STATE.active); }

function gpuDiagWaitForFence(context, timeout = GPU_DIAG_TIMEOUT_MS) {
  if (GRAPHICS_CONTEXT_LOST || context.isContextLost()) return Promise.reject(new Error('Graphics context was lost.'));
  const sync = context.fenceSync(context.SYNC_GPU_COMMANDS_COMPLETE, 0);
  if (!sync) return Promise.reject(new Error('The browser could not create a GPU completion fence.'));
  try { context.flush(); }
  catch (error) {
    if (!GRAPHICS_CONTEXT_LOST && !context.isContextLost()) {
      try { context.deleteSync(sync); } catch { /* preserve the original submission failure */ }
    }
    return Promise.reject(error);
  }
  const start = performance.now();
  return new Promise((resolve, reject) => {
    let timer = null, settled = false, lost = false;
    let clockAt = start, visibleMs = 0, wasHidden = !!document.hidden;
    const visibleElapsed = () => {
      const now = performance.now(), hiddenNow = !!document.hidden;
      // A delayed visibility event must not turn background throttling into a
      // graphics failure. Conservatively exclude intervals touching hidden state.
      if (!wasHidden && !hiddenNow) visibleMs += Math.max(0, now - clockAt);
      clockAt = now; wasHidden = hiddenNow;
      return visibleMs;
    };
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (timer !== null) clearTimeout(timer);
      timer = null;
      document.removeEventListener('visibilitychange', visibility);
      context.canvas?.removeEventListener('webglcontextlost', contextLost);
      // Do not issue more GL calls once the context has been lost.
      try {
        if (!lost && !GRAPHICS_CONTEXT_LOST && !context.isContextLost()) context.deleteSync(sync);
      } catch (cleanupError) { error ||= cleanupError; }
      if (error) reject(error);
      else {
        const visibleWaitMs = Math.round(visibleElapsed()), waitMs = Math.round(performance.now() - start);
        resolve({ waitMs, visibleWaitMs, hiddenWaitMs: Math.max(0, waitMs - visibleWaitMs) });
      }
    };
    const poll = () => {
      if (settled) return;
      timer = null;
      try {
        visibleElapsed();
        if (lost || GRAPHICS_CONTEXT_LOST || context.isContextLost()) { finish(new Error('Graphics context was lost while waiting for the batch.')); return; }
        const status = context.clientWaitSync(sync, 0, 0);
        if (lost || GRAPHICS_CONTEXT_LOST || context.isContextLost()) { finish(new Error('Graphics context was lost while waiting for the batch.')); return; }
        if (status === context.ALREADY_SIGNALED || status === context.CONDITION_SATISFIED) { finish(); return; }
        if (status === context.WAIT_FAILED) { finish(new Error('The browser rejected the GPU completion wait.')); return; }
        // Actual completion always wins over an elapsed deadline. Only a
        // still-pending fence spends its bounded foreground waiting budget.
        if (visibleElapsed() >= timeout) { finish(new Error('GPU completion timed out after ' + timeout + ' ms of visible waiting. No further stage will run.')); return; }
        timer = setTimeout(poll, GPU_DIAG_POLL_MS);
      } catch (error) { finish(error); }
    };
    const visibility = () => {
      if (settled) return;
      visibleElapsed();
      if (timer !== null) clearTimeout(timer);
      if (!settled) timer = setTimeout(poll, 0);
    };
    const contextLost = () => { lost = true; finish(new Error('Graphics context was lost while waiting for the batch.')); };
    document.addEventListener('visibilitychange', visibility);
    context.canvas?.addEventListener('webglcontextlost', contextLost);
    // Yield first: context-loss notifications must be able to reach the latch.
    timer = setTimeout(poll, 0);
  });
}

function gpuDiagPrepareView({ weatherGpu = true } = {}) {
  // The preparation half of tick, with a frozen simulation. These functions
  // populate the actual crowds/LOD/grass/props; there is no tick or simStep, no
  // weather GPU pass, and no trail/decal submission here.
  const dt = 0;
  applyTimeOfDay(tod.p);
  applyWeather();
  applyIndoor();
  updateNightSky(dt);
  if (weatherGpu) wxCloudsFrame(dt); // safe diagnostics return before allocating/drawing clouds
  else { U.uCloudDomeOn.value.x = 0; U.uCloudSh.value.w = 0; U.uCloudScrP.value.z = 0; }
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  skyU.uInvVP.value.copy(projView).invert();
  const P = GAME.player, fx = P ? P.x : W.heroTree.x, fz = P ? P.z : W.heroTree.z;
  drawActors(fx, fz);
  drawDragon(dt); drawBrand(dt); drawTargetAndMarks();
  drawRelicsAndPortals(); drawTownLife(dt); drawHouses(dt); drawFires(dt);
  drawNature(dt); drawGifts(dt);
  // drawWater would call the ripple pass. Prepare its visible objects directly.
  diveDraw(dt); boatsDraw(dt); tracksDraw(dt);
  drawHall(dt); drawBuild(dt); drawClasses(dt); look5Frame(dt); drawLate4(dt);
  loopsDraw(dt); look6Frame(dt); drawFarming(dt); drawAnimals(dt); drawDepth(dt);
  updateAmbientLife(dt); drawSurvival(dt); drawProjectiles(); drawWalls();
  updateSpellFX(dt); drawLoot();
  camera.getWorldDirection(_fwd);
  updateGrassCenters(camera.position.x, camera.position.z, _fwd.x, _fwd.z);
  updateTreeVisibility(camera.position.x, camera.position.z);
  updateNearTrees(dt, camera.position.x, camera.position.z);
  updateFireflies(camera.position.x, camera.position.z);
  updateLod(); updateMountains();
  gatherLights(camera.position.x, camera.position.y, camera.position.z);
  fxAdd.flush(); fxAlpha.flush(); arrowFlush(); glowFlush();
  regroupOutdoors();
  return { fx, fz };
}

function gpuDiagFamilies() {
  const sets = {
    sky: new Set([skyMesh]),
    terrain: new Set(terrainChunks),
    grass: new Set(grassMeshes),
    flowers: new Set(flowerMeshes),
    trees: new Set(treeChunks),
    water: new Set(WATER_MESHES),
    structures: new Set(),
    crowds: new Set([crowdHuman.mesh, crowdHumanLo.mesh]),
    other: new Set(),
  };
  if (AURORA.mesh) sets.sky.add(AURORA.mesh);
  if (AUR_STAR.mesh) sets.sky.add(AUR_STAR.mesh);
  if (crowdHumanFar) sets.crowds.add(crowdHumanFar.mesh);
  for (const cs of Object.values(crowdBeast)) for (const c of cs) if (c && c.mesh) sets.crowds.add(c.mesh);
  if (DRAGON.mesh) sets.crowds.add(DRAGON.mesh);
  for (const n of Object.values(NEAR_TREES.kinds)) sets.trees.add(n.mesh);
  for (const t of LOD.terrain) sets.terrain.add(t.m);
  for (const b of LOD.blocks) sets.terrain.add(b.m);
  for (const bands of Object.values(LOD.bands || {})) for (const b of bands) if (b) sets.trees.add(b.mesh);
  // shareMat clones material objects; use the actual production vertex shader
  // identity as well as collection membership, never object-name guesses.
  const structuralVS = new Set([buildingMat.vertexShader, houseMat.vertexShader, castleMat.vertexShader]);
  const renderables = [];
  scene.traverse((o) => {
    if (!o.isMesh && !o.isPoints && !o.isLine && !o.isSprite) return;
    renderables.push(o);
    if (Object.values(sets).some((set) => set.has(o))) return;
    const materials = Array.isArray(o.material) ? o.material : [o.material];
    if (materials.some((m) => m && structuralVS.has(m.vertexShader))) sets.structures.add(o);
    else sets.other.add(o);
  });
  return { sets, renderables };
}

function gpuDiagCaptureRenderer() {
  const uniforms = composite.uniforms;
  const post = {};
  for (const key of ['tScene', 'tBloom', 'tRays', 'uBloom', 'uRays', 'uTime']) post[key] = uniforms[key].value;
  return {
    target: renderer.getRenderTarget(), color: renderer.getClearColor(new THREE.Color()).clone(),
    alpha: renderer.getClearAlpha(), autoClear: renderer.autoClear,
    viewport: renderer.getViewport(new THREE.Vector4()).clone(),
    scissor: renderer.getScissor(new THREE.Vector4()).clone(), scissorTest: renderer.getScissorTest(),
    fsMaterial: fsMesh.material, post,
  };
}
function gpuDiagRestoreRenderer(saved, restoreGl) {
  fsMesh.material = saved.fsMaterial;
  for (const [key, value] of Object.entries(saved.post)) composite.uniforms[key].value = value;
  renderer.autoClear = saved.autoClear;
  if (!restoreGl || GRAPHICS_CONTEXT_LOST || gl.isContextLost()) return;
  renderer.setRenderTarget(saved.target);
  renderer.setClearColor(saved.color, saved.alpha);
  renderer.setViewport(saved.viewport);
  renderer.setScissor(saved.scissor);
  renderer.setScissorTest(saved.scissorTest);
}

function gpuDiagGlErrors(context) {
  const errors = [];
  for (let n = 0; n < 16 && !context.isContextLost(); n++) {
    const error = context.getError();
    if (error === context.NO_ERROR) break;
    errors.push('0x' + error.toString(16));
  }
  return errors;
}

async function graphicsRunDiagnostic() {
  if (!GPU_DIAG_REQUESTED) return false;
  if (GPU_DIAG_STATE) return true;
  const state = GPU_DIAG_STATE = window.__hmGpuDiagnostic = {
    active: true, index: 0, running: false, stopped: false, complete: false,
    results: [], stages: [], error: null, timeoutMs: GPU_DIAG_TIMEOUT_MS,
  };
  GAME.ready = false;
  window.__hm.ready = false;
  const loading = document.getElementById('loading');
  if (loading) { loading.hidden = true; loading.style.display = 'none'; }
  for (const id of ['title', 'hud', 'menu']) { const el = document.getElementById(id); if (el) el.hidden = true; }
  const panel = document.createElement('section');
  panel.id = 'gpu-diag';
  panel.setAttribute('aria-labelledby', 'gpu-diag-title');
  panel.style.cssText = 'position:fixed;z-index:9999;left:12px;top:12px;width:min(460px,calc(100vw - 24px));max-height:calc(100dvh - 24px);overflow:auto;box-sizing:border-box;padding:16px;background:#111b24f2;color:#f2f5f8;border:1px solid #7d929e;border-radius:10px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 30px #0008;';
  const title = document.createElement('h2');
  title.id = 'gpu-diag-title'; title.textContent = 'GPU diagnostic'; title.style.cssText = 'font-size:18px;margin:0 0 8px';
  const explanation = document.createElement('p');
  explanation.textContent = 'Each button press draws one stationary stage and waits for the GPU. The game stays paused. Stop at the first error; successful stages do not prove later stages are safe.';
  const status = document.createElement('p');
  status.id = 'gpu-diag-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
  const button = document.createElement('button');
  button.id = 'gpu-diag-next'; button.type = 'button';
  button.style.cssText = 'display:block;width:100%;padding:12px;background:#d9edf8;color:#102331;border:2px solid transparent;border-radius:6px;font:600 14px system-ui;cursor:pointer;';
  const results = document.createElement('ol');
  results.id = 'gpu-diag-results'; results.style.cssText = 'padding-left:22px;margin-bottom:0;overflow-wrap:anywhere;';
  panel.append(title, explanation, status, button, results);
  panel.addEventListener('pointerdown', (event) => event.stopPropagation());
  panel.addEventListener('keydown', (event) => event.stopPropagation());
  document.body.appendChild(panel);

  const stop = (error) => {
    state.stopped = true; state.error = String(error && error.message || error);
    GRAPHICS_STARTUP.stopped = true;
    button.disabled = true;
    status.textContent = 'Stopped: ' + state.error;
    status.style.color = '#ffb7ac';
    // Context-loss handling already recorded its precise submitting stage.
    if (!GRAPHICS_CONTEXT_LOST) graphicsCheckpoint(GRAPHICS_STARTUP.phase, 'Stopped: ' + state.error);
  };
  canvas.addEventListener('webglcontextlost', () => stop(new Error('Graphics context lost. Restart the browser before another attempt.')));
  if (!BOOT_SAFE) {
    button.textContent = 'Diagnostic unavailable'; button.disabled = true;
    stop(new Error('This diagnostic requires both safe=1 and gpuDiag=1. No game frame was submitted.'));
    return true;
  }
  if (GRAPHICS_CONTEXT_LOST || gl.isContextLost()) {
    stop(new Error('Graphics was already lost before diagnostics began.'));
    return true;
  }
  if (typeof gl.fenceSync !== 'function') {
    stop(new Error('WebGL 2 GPU completion fences are unavailable.'));
    return true;
  }

  let focus, inventory;
  try {
    graphicsCheckpoint('GPU diagnostic: preparing frozen view');
    // Enforce the CPU-only preparation contract rather than relying on names.
    const previousRender = renderer.render;
    renderer.render = () => { throw new Error('Unexpected GPU draw during diagnostic preparation.'); };
    try { focus = gpuDiagPrepareView(); } finally { renderer.render = previousRender; }
    inventory = gpuDiagFamilies();
  } catch (error) { stop(error); return true; }

  const cubeScene = new THREE.Scene();
  const cubeCamera = new THREE.PerspectiveCamera(55, view.w / view.h, 0.1, 20);
  cubeCamera.position.z = 4;
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0x55c5e9 }));
  cube.rotation.set(0.3, 0.5, 0);
  cubeScene.add(cube);
  const renderCube = (post) => {
    renderer.setRenderTarget(post ? sceneRT : null);
    renderer.setClearColor(0x071019, 1);
    renderer.clear(true, true, false);
    renderer.render(cubeScene, cubeCamera);
    if (post) renderPost();
  };
  // Eager trail clears are deferred in this mode. A CPU-created neutral texel
  // prevents earlier families from sampling an uninitialized trail target.
  const neutralTrail = new THREE.DataTexture(new Uint8Array([128, 128, 0, 0]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
  neutralTrail.minFilter = neutralTrail.magFilter = THREE.NearestFilter;
  neutralTrail.needsUpdate = true;
  state.trailInitialized = false;
  const renderFamily = (members) => {
    for (const o of inventory.renderables) if (!members.has(o)) o.visible = false;
    const oldTrail = U.uTrail.value;
    if (!state.trailInitialized) U.uTrail.value = neutralTrail;
    try {
      renderer.setRenderTarget(sceneRT);
      renderer.setClearColor(0x071019, 1);
      renderer.clear(true, true, false);
      const calls = renderer.info.render.calls, triangles = renderer.info.render.triangles;
      renderer.render(scene, camera);
      const work = { workCalls: renderer.info.render.calls - calls, workTriangles: renderer.info.render.triangles - triangles };
      renderPost();
      return work;
    } finally { U.uTrail.value = oldTrail; }
  };
  const familyLabels = {
    sky: 'Sky and night objects', terrain: 'Terrain', grass: 'Grass blades', flowers: 'Flowers',
    trees: 'Trees and tree LOD bands', water: 'Water surfaces', structures: 'Buildings and castles',
    crowds: 'People, animals and dragon', other: 'Other rocks, props and effects',
  };
  const stages = [
    { id: 'cube-default', label: 'Simple cube, direct', run: () => renderCube(false) },
    { id: 'cube-post', label: 'Simple cube, game target and composite', run: () => renderCube(true) },
  ];
  for (const [id, label] of Object.entries(familyLabels)) stages.push({ id, label, run: () => renderFamily(inventory.sets[id]), members: inventory.sets[id] });
  stages.push(
    { id: 'trail', label: 'Offscreen grass-trail pass', run: () => {
      pass(trailClearMat, trailA); pass(trailClearMat, trailB);
      stepTrail(0, focus.fx, focus.fz); state.trailInitialized = true;
    } },
    { id: 'decal', label: 'Offscreen ground-decal pass', run: () => renderDecals(focus.fx, focus.fz) },
    { id: 'combined', label: 'Combined original stationary view', run: () => {
      renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x071019, 1); renderer.clear(true, true, false);
      renderer.render(scene, camera); renderPost();
    } },
  );
  state.stages = stages.map(({ id, label, members }) => ({ id, label, members: members ? members.size : null }));

  const paintNext = () => {
    if (state.stopped) return;
    button.disabled = state.running || state.complete;
    button.textContent = state.complete ? 'Diagnostic complete' : 'Run ' + (state.index + 1) + '/' + stages.length + ': ' + stages[state.index].label;
    status.textContent = state.complete ? 'All selected batches finished. Check unexercised stages above. The game has not started; saved data is unchanged.' : 'Waiting for a manual run. No game frame loop is active.';
  };
  state.runNext = async () => {
    if (state.running || state.stopped || state.complete) return false;
    state.running = true; button.disabled = true;
    const stage = stages[state.index], started = performance.now();
    state.currentStage = stage.id;
    const visibility = inventory.renderables.map((o) => [o, o.visible]);
    const draws = [], direct = renderer.renderBufferDirect, debug = renderer.debug;
    const oldShaderError = debug && debug.onShaderError, oldCheck = debug && debug.checkShaderErrors;
    let currentMaterial = '', completed = false, saved = null;
    try {
      saved = gpuDiagCaptureRenderer();
      renderer.renderBufferDirect = function (cam, scn, geo, material, object, group) {
        currentMaterial = (material.name || material.type || 'Material') + '#' + material.id;
        draws.push({ object: object.uuid, label: perfLabel(object), material: currentMaterial, geometry: geo.id,
          vertices: geo.attributes.position ? geo.attributes.position.count : 0,
          indices: geo.index ? geo.index.count : 0,
          instances: geo.isInstancedBufferGeometry ? geo.instanceCount : object.isInstancedMesh ? object.count : 1 });
        return direct.call(this, cam, scn, geo, material, object, group);
      };
      if (!debug) throw new Error('The renderer shader diagnostics are unavailable.');
      debug.checkShaderErrors = true;
      debug.onShaderError = (context, program, vertex, fragment) => {
        const log = (read) => context.isContextLost() ? 'Context lost.' : String(read() || '').slice(0, 600);
        const message = 'Shader failed in ' + stage.label + ' / ' + currentMaterial + '. Program: ' +
          log(() => context.getProgramInfoLog(program)) + ' Vertex: ' + log(() => context.getShaderInfoLog(vertex)) +
          ' Fragment: ' + log(() => context.getShaderInfoLog(fragment));
        throw new Error(message);
      };
      graphicsAssertActive();
      const priorErrors = gpuDiagGlErrors(gl);
      if (priorErrors.length) throw new Error('GL errors before submission: ' + priorErrors.join(', '));
      graphicsCheckpoint('GPU diagnostic ' + (state.index + 1) + '/' + stages.length + ': ' + stage.label + ' (submitting)');
      status.textContent = 'Running ' + stage.label + '; waiting for GPU completion.';
      renderer.info.reset();
      const work = stage.run() || {};
      graphicsAssertActive();
      const fence = await gpuDiagWaitForFence(gl);
      graphicsAssertActive();
      const errors = gpuDiagGlErrors(gl);
      if (errors.length) throw new Error('GL errors after ' + stage.label + ': ' + errors.join(', '));
      const workCalls = work.workCalls ?? renderer.info.render.calls;
      const result = { id: stage.id, label: stage.label, completed: true, fenceComplete: true, exercised: workCalls > 0,
        workCalls, workTriangles: work.workTriangles ?? renderer.info.render.triangles, totalMs: Math.round(performance.now() - started),
        fenceWaitMs: fence.waitMs, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles, draws };
      state.results.push(result);
      graphicsCheckpoint('GPU diagnostic: ' + stage.label + ' completed', JSON.stringify({ calls: result.calls, triangles: result.triangles, totalMs: result.totalMs, exercised: result.exercised }));
      const line = document.createElement('li');
      line.textContent = stage.label + (result.exercised ? ': exercised, GPU completed, ' : ': unexercised (no family draw), GPU fence completed, ') +
        result.workCalls + ' work draw calls, ' + result.workTriangles + ' work triangles, ' + result.totalMs + ' ms.';
      results.appendChild(line);
      state.index++;
      state.complete = state.index === stages.length;
      completed = true;
      return true;
    } catch (error) {
      state.results.push({ id: stage.id, label: stage.label, completed: false, fenceComplete: false, exercised: false,
        totalMs: Math.round(performance.now() - started), error: String(error.message || error), draws });
      stop(error);
      return false;
    } finally {
      renderer.renderBufferDirect = direct;
      if (debug) { debug.onShaderError = oldShaderError; debug.checkShaderErrors = oldCheck; }
      for (const [object, visible] of visibility) object.visible = visible;
      state.running = false;
      // On failure, restore CPU state only: no extra GL calls follow the failed batch.
      try { if (saved) gpuDiagRestoreRenderer(saved, completed); } catch (error) { stop(error); }
      paintNext();
    }
  };
  button.addEventListener('click', () => { state.runNext(); });
  graphicsCheckpoint('GPU diagnostic: waiting for manual stage 1');
  paintNext();
  return true;
}
