/* ================================================================== */
/* main: boot, game start, frame loop, quality, debug hooks            */
/* ================================================================== */
quality.auto = !BOOT_SAFE;
GAME.ready = false;
let TITLE_FRAME_PROMISE = null, TITLE_FRAME_DIRTY = false, TITLE_FRAME_FAILED = false;
let TITLE_RESIZE_PENDING = false, TITLE_WARMED = false, TITLE_WARM_GENERATION = 0, TITLE_START_PROMISE = null;
renderer.info.autoReset = false;
const HM_ERRORS = [];
function reportError(err) {
  const msg = String(err && (err.stack || err.message) || err);
  if (HM_ERRORS.length < 20 && !HM_ERRORS.includes(msg)) { HM_ERRORS.push(msg); console.error(err); }
}
window.addEventListener('error', (e) => reportError(e.error || e.message));
window.addEventListener('unhandledrejection', (e) => reportError(e.reason));

/* ------------------------------------------------------------------ */
/* sizing and quality                                                  */
/* ------------------------------------------------------------------ */
function graphicsRenderRatio() {
  let ratio = Math.max(0.5, Math.min(window.devicePixelRatio || 1, quality.dpr) * (quality.scale || 1));
  // Recovery keeps its existing, stricter limit regardless of saved choices.
  if (BOOT_SAFE) return Math.min(ratio, 1280 / view.w, 1280 / view.h, Math.sqrt(921600 / (view.w * view.h)));
  if (!IS_TOUCH && quality.auto !== false) {
    // Automatic detail needs a bound before it has frame timings, including
    // after an automatic preference was saved. Manual choices retain their DPR.
    ratio = Math.min(ratio, 1920 / view.w, 1920 / view.h, Math.sqrt(1440000 / (view.w * view.h)));
  }
  return ratio;
}
function applyGraphicsSize() {
  // A changed frustum/quality can expose a previously culled shader variant.
  // Rewarm this explicit title view; unchanged redraws reuse completed work.
  if (!GAME.started) TITLE_WARMED = false;
  view.w = Math.max(1, window.innerWidth);
  view.h = Math.max(1, window.innerHeight);
  quality.dprActual = graphicsRenderRatio();
  renderer.setPixelRatio(quality.dprActual);
  renderer.setSize(view.w, view.h, false);
  camera.aspect = view.w / view.h;
  camera.fov = view.w < view.h ? 70 : 55;
  camera.updateProjectionMatrix();
  makeTargets();
  setupShadows(quality.level);
  flowerMat.uniforms.uAlphaCut.value = quality.msaa > 0 ? 0.01 : 0.5;
  U.uFoliageCut.value = quality.msaa > 0 ? 0.01 : 0.5;
  const focal = (view.h * quality.dprActual) / (2 * Math.tan((camera.fov * DEG) / 2));
  for (const m of [fxAdd.mesh.material, fxAlpha.mesh.material, glowMesh.material, fireflyMat]) m.uniforms.uFocal.value = focal;
}
function resize() {
  if (GRAPHICS_CONTEXT_LOST || GRAPHICS_STARTUP.stopped || graphicsDiagnosticActive()) return;
  // Never dispose targets or replace the drawing buffer while a title batch is
  // pending on the GPU. One flag coalesces all requests to the latest size.
  if (TITLE_FRAME_PROMISE) { TITLE_RESIZE_PENDING = true; return; }
  applyGraphicsSize();
  if (!GAME.started && (GAME.ready || GRAPHICS_STARTUP.titleSubmitted > 0)) void renderTitleFrame().catch(reportError);
}
function setQuality(level, auto = false) {
  if (!QUALITY_PRESETS[level]) return;
  if (!auto) quality.userChanged = true;
  const rebuild = level !== quality.level;
  quality.level = level;
  Object.assign(quality, QUALITY_PRESETS[level]);
  if (BOOT_SAFE) quality.msaa = 0;
  quality.auto = auto;
  quality.scale = 1;
  if (rebuild && GAME.built) { buildGrass(); buildFlowers(); }
  if (GAME.built) { resize(); updateTreeVisibility(camera.position.x, camera.position.z); }
}
const TOD_TARGET = { morning: 0.3, golden: 1.0, night: 2.1 };
function setTimeMode(mode) {
  if (mode !== 'cycle' && !(mode in TOD_TARGET)) return;
  tod.mode = mode;
}
let resizeTimer = 0;
window.addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = setTimeout(() => { resizeTimer = 0; if (GAME.built) resize(); }, 80);
});

/* adaptive detail: step down when frames run long for a while */
const PERF = { acc: 0, n: 0, window: 0, grace: 6 };
function adaptQuality(dt) {
  if (!quality.auto || navigator.webdriver || document.hidden) return;
  PERF.grace -= dt;
  if (PERF.grace > 0) return;
  PERF.acc += dt; PERF.n++; PERF.window += dt;
  if (PERF.window < 4) return;
  const avg = PERF.acc / PERF.n;
  PERF.acc = 0; PERF.n = 0; PERF.window = 0;
  if (avg < 1 / 36) return;
  PERF.grace = 5;
  if (quality.level === 'high') { setQuality('medium', true); uiLog('Lowered graphics detail to keep things smooth.', 'sys'); }
  else if (quality.level === 'medium') { setQuality('low', true); uiLog('Lowered graphics detail to keep things smooth.', 'sys'); }
  else if ((quality.scale || 1) > 0.62) { quality.scale = Math.max(0.6, (quality.scale || 1) - 0.15); resize(); }
}

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */
const nextPaint = () => new Promise((r) => { let done = false; const go = () => { if (!done) { done = true; r(); } }; requestAnimationFrame(() => setTimeout(go, 0)); setTimeout(go, 60); });
// A title prepares existing environment meshes and uniforms only. Even dt=0
// gameplay draw helpers can move ambient actors, advance timer state or consume
// the shared random stream; leave those paths for actual human play.
function prepareTitleView() {
  applyTimeOfDay(tod.p);
  applyWeather();
  applyIndoor();
  U.uCloudDomeOn.value.x = 0; U.uCloudSh.value.w = 0; U.uCloudScrP.value.z = 0;
  camera.updateMatrixWorld();
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  skyU.uInvVP.value.copy(projView).invert();
  camera.getWorldDirection(_fwd);
  const length = Math.hypot(_fwd.x, _fwd.z) || 1;
  const fx = _fwd.x / length, fz = _fwd.z / length;
  const x = camera.position.x, z = camera.position.z;
  // updateGrassCenters also builds canopy/AO textures lazily. Position only the
  // already-built grass/flower uniforms here, without allocating new resources.
  for (const mesh of grassMeshes) {
    const ahead = mesh.userData.layer.ahead;
    mesh.material.uniforms.uCenter.value.set(x + fx * ahead, z + fz * ahead);
    mesh.material.uniforms.uCam2.value.set(x, z);
  }
  for (const mesh of flowerMeshes) {
    mesh.material.uniforms.uCenter.value.set(x + fx * 14, z + fz * 14);
    mesh.material.uniforms.uCam2.value.set(x, z);
  }
  updateTreeVisibility(x, z);
  updateMountains();
}
function captureTitleResizeRequest() {
  // A resize event is a request immediately, even while its 80 ms callback is
  // queued. At a GPU-safe boundary coalesce it into the current pipeline.
  if (resizeTimer) {
    clearTimeout(resizeTimer); resizeTimer = 0;
    TITLE_RESIZE_PENDING = true;
  }
}
function titleAssertActive() {
  graphicsAssertActive();
  if (GRAPHICS_STARTUP.stopped || gl.isContextLost()) throw new Error('Title graphics context is unavailable.');
}
function titleGraphicsBusy(active) {
  const loadingBar = document.getElementById('loadbar')?.parentElement;
  const hint = document.getElementById('loadhint');
  if (loadingBar && !GAME.ready) {
    loadingBar.setAttribute('aria-busy', String(active));
    if (active) loadingBar.removeAttribute('aria-valuenow');
  }
  if (hint) hint.hidden = !active || GAME.ready;
  const title = document.getElementById('title');
  if (!title) return;
  title.setAttribute('aria-busy', String(active));
  let status = document.getElementById('title-graphics-status');
  if (active && GAME.ready) {
    if (!status) {
      status = document.createElement('p'); status.id = 'title-graphics-status';
      status.setAttribute('role', 'status'); title.appendChild(status);
    }
    status.textContent = 'Preparing the resized view. Please wait.';
  } else if (status) status.remove();
}
// Submit only existing production resources. Unlike renderer.compile(), a
// restricted render does not traverse invisible families and link their shaders.
async function submitTitleStage(id, members, inventory, combined = false) {
  titleAssertActive();
  const programsBefore = renderer.info.programs.length;
  const started = performance.now(), visibility = inventory.renderables.map(object => [object, object.visible]);
  const saved = gpuDiagCaptureRenderer(), oldTrail = U.uTrail.value;
  const direct = renderer.renderBufferDirect, debug = renderer.debug;
  const oldShaderError = debug && debug.onShaderError, oldShaderCheck = debug && debug.checkShaderErrors;
  let current = null, workCalls = 0, workTriangles = 0;
  GRAPHICS_STARTUP.titleStage = id;
  const message = document.getElementById('loadmsg');
  const stageMessage = ({
    post: 'Preparing the view', sky: 'Preparing the sky', terrain: 'Preparing the landscape',
    grass: 'Preparing the meadows', flowers: 'Preparing the meadows', trees: 'Preparing the forests',
    water: 'Preparing the water', structures: 'Preparing the towns and keeps',
    crowds: 'Preparing the people and creatures', other: 'Finishing the world', combined: 'Checking the first view',
  })[id.split('-')[0]] || 'Finishing the view';
  if (message && !GAME.ready && message.textContent !== stageMessage) message.textContent = stageMessage;
  try {
    const priorErrors = gpuDiagGlErrors(gl);
    if (priorErrors.length) throw new Error('GL errors before title ' + id + ': ' + priorErrors.join(', '));
    renderer.renderBufferDirect = function (cam, scn, geo, material, object, group) {
      const label = value => String(value || '').slice(0, 100);
      current = { material: label(material.name || material.type), materialId: material.id,
        object: label(object.name || object.type), objectId: object.id, geometryId: geo.id };
      return direct.call(this, cam, scn, geo, material, object, group);
    };
    if (!debug) throw new Error('Title shader diagnostics are unavailable.');
    debug.checkShaderErrors = true;
    debug.onShaderError = (context, program, vertex, fragment) => {
      const lost = context.isContextLost();
      const read = fn => { if (lost) return 'Context lost.'; try { return String(fn() ?? '').slice(0, 600); } catch { return 'Unavailable.'; } };
      const failure = { stage: id, ...current, contextLost: lost,
        linked: read(() => context.getProgramParameter(program, context.LINK_STATUS)),
        vertexCompiled: read(() => context.getShaderParameter(vertex, context.COMPILE_STATUS)),
        fragmentCompiled: read(() => context.getShaderParameter(fragment, context.COMPILE_STATUS)),
        programLog: read(() => context.getProgramInfoLog(program)),
        vertexLog: read(() => context.getShaderInfoLog(vertex)), fragmentLog: read(() => context.getShaderInfoLog(fragment)) };
      GRAPHICS_STARTUP.titleFailure = failure;
      throw new Error('Title shader could not link: ' + JSON.stringify(failure));
    };
    if (members) for (const [object, visible] of visibility) object.visible = visible && members.has(object);
    U.uTrail.value = trailA.texture; // neutral, already cleared during ordinary boot
    renderer.info.reset();
    renderer.setRenderTarget(sceneRT); renderer.setClearColor(0x000000, 1); renderer.clear(true, true, false);
    if (combined) GRAPHICS_STARTUP.titleSubmitted++;
    if (id !== 'post') renderer.render(scene, camera);
    workCalls = renderer.info.render.calls; workTriangles = renderer.info.render.triangles;
    renderPost();
    if (id === 'post') { workCalls = renderer.info.render.calls; workTriangles = renderer.info.render.triangles; }
  } finally {
    // Restore every shared CPU value before the fence yields. No further GL
    // calls are made here, including when a shader or context has failed.
    for (const [object, visible] of visibility) object.visible = visible;
    U.uTrail.value = oldTrail;
    renderer.renderBufferDirect = direct;
    if (debug) { debug.onShaderError = oldShaderError; debug.checkShaderErrors = oldShaderCheck; }
    gpuDiagRestoreRenderer(saved, false);
  }
  const receipt = await gpuDiagWaitForFence(gl);
  titleAssertActive();
  const errors = gpuDiagGlErrors(gl);
  if (errors.length) throw new Error('GL errors after title ' + id + ': ' + errors.join(', '));
  return { id, generation: TITLE_WARM_GENERATION, completed: true, fenceComplete: true,
    exercised: workCalls > 0, workCalls, workTriangles,
    totalMs: Math.round(performance.now() - started), fenceWaitMs: receipt.waitMs,
    programsBefore, programsAfter: renderer.info.programs.length, newPrograms: renderer.info.programs.length - programsBefore };
}
// A title is a frozen view, not a live player. Warm existing shader families in
// bounded, separately fenced submissions before the first combined view. Empty
// instances still belong to a family: Three links their programs before checking
// instance counts. The final combined fence alone can release the loading veil.
function renderTitleFrame() {
  if (!GAME.built || GAME.started || GRAPHICS_CONTEXT_LOST || TITLE_FRAME_FAILED || document.hidden || graphicsDiagnosticActive()) return Promise.resolve(false);
  TITLE_FRAME_DIRTY = true;
  if (TITLE_FRAME_PROMISE) return TITLE_FRAME_PROMISE;
  TITLE_FRAME_PROMISE = (async () => {
    titleGraphicsBusy(true);
    captureTitleResizeRequest();
    while (TITLE_FRAME_DIRTY && !GAME.started && !GRAPHICS_CONTEXT_LOST && !graphicsDiagnosticActive()) {
      TITLE_FRAME_DIRTY = false;
      await waitForTitleVisibility();
      titleAssertActive();
      if (TITLE_RESIZE_PENDING) {
        TITLE_RESIZE_PENDING = false;
        applyGraphicsSize();
      }
      prepareTitleView();
      const inventory = gpuDiagFamilies();
      if (!TITLE_WARMED) {
        TITLE_WARM_GENERATION++;
        GRAPHICS_STARTUP.titleWarmup = [];
        // Crowds contain several expensive rig programs, even when their
        // instance counts are zero at the title. Fence and yield between meshes
        // so one cold crowd family cannot monopolize the whole loading screen.
        const families = Object.entries(inventory.sets).flatMap(([id, members]) =>
          id === 'crowds' && members.size > 1
            ? Array.from(members, (object, index) => [id + '-' + (index + 1), new Set([object])])
            : [[id, members]]);
        const stages = [['post', new Set()], ...families];
        let resized = false;
        rippleAllocate();
        const entryPreparation = await prepareTitleEntryPrograms(inventory, TITLE_WARM_GENERATION, wxPrepareCloudResources());
        captureTitleResizeRequest();
        if (entryPreparation.stale || TITLE_RESIZE_PENDING) { TITLE_FRAME_DIRTY = true; continue; }
        for (const [id, members] of stages) {
          await waitForTitleVisibility();
          titleAssertActive();
          if (GAME.started) return false;
          if (id === 'post' || id === 'sky' || id === 'terrain') {
            const preparation = id === 'terrain'
              ? await prepareTitlePrograms(inventory, stages, TITLE_WARM_GENERATION)
              : await prepareTitleDependencies(id, inventory, TITLE_WARM_GENERATION);
            captureTitleResizeRequest();
            if (preparation.stale || TITLE_RESIZE_PENDING) { TITLE_FRAME_DIRTY = true; resized = true; break; }
          }
          const result = await submitTitleStage(id, members, inventory);
          GRAPHICS_STARTUP.titleWarmup.push(result);
          // A real event-loop/paint opportunity separates cold submissions.
          await nextPaint();
          titleAssertActive();
          captureTitleResizeRequest();
          if (TITLE_RESIZE_PENDING) { TITLE_FRAME_DIRTY = true; resized = true; break; }
        }
        if (resized) continue; // explicit resize, never retry a failed shader
        TITLE_WARMED = true;
      }
      await waitForTitleVisibility();
      titleAssertActive();
      if (GAME.started) return false;
      const result = await submitTitleStage('combined', null, inventory, true);
      captureTitleResizeRequest();
      GRAPHICS_STARTUP.titleFinal = result;
      GRAPHICS_STARTUP.titleCompleted++;
      GRAPHICS_STARTUP.titleFenceWaitMs = result.fenceWaitMs;
      // A completed hidden submission is not the first visible title. Keep the
      // same pipeline pending until visibility returns and a fresh fence wins.
      if (TITLE_RESIZE_PENDING || document.hidden) TITLE_FRAME_DIRTY = true;
    }
    return true;
  })().catch(error => {
    TITLE_FRAME_DIRTY = false; TITLE_FRAME_FAILED = true;
    GRAPHICS_STARTUP.stopped = true; GRAPHICS_STARTUP.titleError = String(error.message || error); GAME.ready = false;
    if (!GRAPHICS_STARTUP.titleFailure) GRAPHICS_STARTUP.titleFailure = {
      stage: GRAPHICS_STARTUP.titleStage, contextLost: GRAPHICS_CONTEXT_LOST || gl.isContextLost(),
      error: GRAPHICS_STARTUP.titleError,
    };
    if (window.__hm) window.__hm.ready = false;
    graphicsRememberRecovery();
    graphicsCheckpoint('Title graphics stopped', error.message || error);
    graphicsStartFailure(error, 'Graphics stopped');
    throw error;
  }).finally(() => {
    TITLE_FRAME_PROMISE = null;
    titleGraphicsBusy(false);
    // Play may begin during a later title redraw. Its successful fence still
    // owns a coalesced resize; hand the latest dimensions to the live renderer.
    if (TITLE_RESIZE_PENDING && GAME.started && !GRAPHICS_CONTEXT_LOST && !GRAPHICS_STARTUP.stopped) {
      TITLE_RESIZE_PENDING = false;
      applyGraphicsSize();
    }
  });
  return TITLE_FRAME_PROMISE;
}
function waitForTitleVisibility() {
  if (!document.hidden) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      document.removeEventListener('visibilitychange', visible);
      canvas.removeEventListener('webglcontextlost', lost);
    };
    const visible = () => { if (!document.hidden) { cleanup(); resolve(); } };
    const lost = () => { cleanup(); reject(new Error('Graphics stopped before the title became visible.')); };
    document.addEventListener('visibilitychange', visible);
    canvas.addEventListener('webglcontextlost', lost);
    if (GRAPHICS_CONTEXT_LOST) lost(); else visible();
  });
}
async function renderFirstTitleFrame() {
  while (GRAPHICS_STARTUP.titleCompleted === 0) {
    await waitForTitleVisibility();
    graphicsAssertActive();
    if (GRAPHICS_STARTUP.stopped) throw new Error('Title graphics are stopped.');
    await renderTitleFrame();
    // A visibility change between wake and submission may defer this draw.
    // Wait for the next visible event rather than polling or declaring Ready.
    if (!document.hidden && GRAPHICS_STARTUP.titleCompleted === 0) throw new Error('The first title draw did not complete.');
  }
}
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && GAME.ready && !GAME.started) void renderTitleFrame().catch(reportError);
});
const BOOT_STEPS = []; // [perf2] every step's time, the first too (13x_perf2.js)
const BOOT_WORK_BUDGET_MS = 8;
function yieldBootWork() {
  // Let input/rendering run without waiting for a fresh display frame after
  // every CPU slice. Older browsers retain the existing paint/timer fallback.
  if (window.scheduler && typeof window.scheduler.yield === 'function') return window.scheduler.yield();
  return nextPaint();
}
function* bootSequence(tasks) {
  for (const task of tasks) {
    const work = task();
    if (work && typeof work.next === 'function') { yield* work; yield; }
    else yield work;
  }
}
async function runBootWork(fn, receipt) {
  if (!fn) { receipt.completed = true; return; }
  let sliceAt = performance.now();
  const firstAt = sliceAt;
  let work;
  try { work = fn(); }
  finally {
    receipt.workMs += performance.now() - sliceAt;
    receipt.maxChunkMs = receipt.maxSliceMs = receipt.workMs;
    receipt.chunks++;
  }
  if (!work || typeof work.next !== 'function') {
    // An asynchronous step's wait is not synchronous main-thread work.
    await work;
    receipt.completed = true;
    return;
  }
  receipt.chunked = true;
  if (performance.now() - sliceAt >= BOOT_WORK_BUDGET_MS) {
    receipt.yields++;
    await yieldBootWork();
    graphicsAssertActive();
    sliceAt = performance.now();
  }
  for (;;) {
    graphicsAssertActive();
    const at = performance.now();
    let step;
    try { step = work.next(); }
    finally {
      const ms = performance.now() - at;
      receipt.workMs += ms; receipt.maxChunkMs = Math.max(receipt.maxChunkMs, ms); receipt.chunks++;
      receipt.maxSliceMs = Math.max(receipt.maxSliceMs, performance.now() - sliceAt);
    }
    let sliceMs = performance.now() - sliceAt;
    receipt.maxSliceMs = Math.max(receipt.maxSliceMs, sliceMs);
    if (step.done) { receipt.completed = true; break; }
    if (step.value && typeof step.value.then === 'function') {
      const waitAt = performance.now();
      await step.value;
      // Preserve the accumulated synchronous slice across an async subtask,
      // while excluding time during which this task did not occupy the thread.
      sliceAt += performance.now() - waitAt;
      graphicsAssertActive();
      sliceMs = performance.now() - sliceAt;
    }
    if (sliceMs >= BOOT_WORK_BUDGET_MS) {
      receipt.yields++;
      await yieldBootWork();
      graphicsAssertActive();
      sliceAt = performance.now();
    }
  }
  receipt.elapsedMs = performance.now() - firstAt;
}
async function loadStep(frac, msg, fn) {
  graphicsAssertActive();
  if (msg) graphicsCheckpoint(msg);
  $('loadbar').style.width = Math.round(frac * 100) + '%';
  $('loadbar').parentElement?.setAttribute('aria-valuenow', String(Math.round(frac * 100)));
  if (msg) $('loadmsg').textContent = msg;
  await nextPaint();
  graphicsAssertActive();
  const t = performance.now(); // [perf2]
  const receipt = { stage: msg || '', chunked: false, completed: false, chunks: 0, yields: 0,
    workMs: 0, maxChunkMs: 0, maxSliceMs: 0, elapsedMs: 0 };
  const history = GRAPHICS_STARTUP.bootWork ||= [];
  history.push(receipt); if (history.length > 16) history.shift();
  try { await runBootWork(fn, receipt); }
  finally { receipt.elapsedMs = performance.now() - t; }
  graphicsAssertActive();
  BOOT_STEPS.push([msg || '', +(performance.now() - t).toFixed(1), +t.toFixed(0), performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null]); // [perf2] (the JS heap as the step ends: its garbage still in it)
}
async function boot() {
  GAME.built = false;
  const savePromise = loadSave().catch(() => null);
  await loadStep(0.03, 'Raising the hills', () => buildWorldChunks(7));
  await loadStep(0.2, 'Shaping the land', () => bootSequence([uploadWorldTextures, buildTerrain, buildWater]));
  await loadStep(0.34, 'Planting the forests', () => bootSequence([buildTrees, buildNearTrees, buildRocks, buildHeroTree, buildCrags])); // [land] buildCrags (03c_land.js)
  await loadStep(0.48, 'Raising the keeps', () => bootSequence([buildStructuresChunks, buildBarrowSurface, buildSurvival, buildBoats])); // [survival] plants, workstations (before the grass reads the cover map); [water2] jetties and boats (07e_boats.js)
  await loadStep(0.54, 'Digging the barrow', () => buildDungeon());
  await loadStep(0.58, 'Sowing the meadows', () => bootSequence([buildGrass, buildFlowers, buildNature, buildFarming])); // [farming] beds, town strips, wild herbs (08h_farming.js)
  await loadStep(0.63, 'Raising the mountains', () => mtnHeightsChunks()); // [heights] the whole mountain shaped once everything is placed, hardy trees, the crags (03d_heights.js)
  await loadStep(0.68, 'Mustering the realms', () => bootSequence([buildCrowds, buildParticles, buildSpellFX, buildFireflies, buildWeather, buildAmbientLife, buildDragon, buildLootMeshes, initCamps, initTowns, initMerchants, initWar, initWildlife, initAnimals, spawnDragon, initBarrow]));
  GAME.built = true;
  groupOutdoors();
  // Read saved preferences before sizing. Shader work belongs to the separately
  // fenced, visible title families below, not a bulk compile of hidden content.
  await loadStep(0.78, 'Reading the chronicle');
  const save = await savePromise;
  graphicsAssertActive();
  if (save) { applySettings(save.settings); applyWorldSave(save.world); }
  netSharedSceneFlushBuilt();
  graphicsCheckpoint('Sizing graphics targets');
  resize();
  applyTimeOfDay(tod.p);
  updateCamera(0.016);
  camera.updateMatrixWorld();
  // Isolation owns every draw and never enters ordinary compilation or the game loop.
  if (await graphicsRunDiagnostic()) return;
  await loadStep(0.84, 'Drawing the map', () => bootSequence([buildMapImage, buildDungeonMap]));
  await loadStep(0.9, 'Preparing the first view', () => {
    updateCamera(0.016);
    camera.updateMatrixWorld();
  });
  await loadStep(0.97, 'Drawing the first view', () => renderFirstTitleFrame());
  graphicsAssertActive();
  GAME.ready = true;
  window.__hm.ready = true;
  $('loadbar').style.width = '100%';
  $('loadbar').parentElement?.setAttribute('aria-valuenow', '100');
  setupTitle(save);
  graphicsRecoveryNotice();
  graphicsCheckpoint('Ready');
  const L = $('loading');
  L.style.opacity = 0;
  L.style.pointerEvents = 'none'; // [v9] a fading veil takes no taps
  setTimeout(() => { L.hidden = true; }, 850);
  lastNow = performance.now();
  requestAnimationFrame(frame);
}

/* ------------------------------------------------------------------ */
/* starting, leaving                                                   */
/* ------------------------------------------------------------------ */
function startGame(save, mayStart = () => true) {
  if (!mayStart()) return;
  if (!GAME.ready || GRAPHICS_CONTEXT_LOST || GRAPHICS_STARTUP.stopped) return;
  // A real click can beat the resize debounce timer. Drain that requested
  // layout now, before player creation, so its cold batches own the start too.
  if (resizeTimer) { clearTimeout(resizeTimer); resizeTimer = 0; resize(); }
  // Coalesce the existing Play intent until graphics settle. Return completion
  // to debug callers too; no player or live work overlaps a cold title batch.
  if (TITLE_FRAME_PROMISE) {
    if (!TITLE_START_PROMISE) {
      TITLE_START_PROMISE = TITLE_FRAME_PROMISE.then(() => {
        TITLE_START_PROMISE = null;
        if (!GAME.started) return startGame(save, mayStart);
      }, error => { TITLE_START_PROMISE = null; throw error; });
      void TITLE_START_PROMISE.catch(reportError);
    }
    return TITLE_START_PROMISE;
  }
  $('title').hidden = true;
  const P = createPlayer(save);
  savePartsLoad('char', save.x); // goods and every other system's records for the character (06d_goods.js)
  rescaleWar();
  buildHUD();
  GAME.started = true;
  lastZone = '';
  INPUT.keys.clear();
  uiLog(`Welcome to ${zoneAt(P.x, P.z).name}, ${P.name}.`, 'sys');
  if (save.fresh) {
    // a pack for the road: draughts for a recruit, a veteran's kit for a veteran
    INV.potions = P.level >= 10 ? 5 : 3;
    INV.gold = P.level >= 10 ? 120 : 10;
    if (P.level >= 10) {
      for (const [slot, q] of [['weapon', 2], ['chest', 2], ['head', 1], ['legs', 1]]) {
        const it = makeItem({ cls: P.cls, realm: P.faction, lvl: P.level - 1, q, slot });
        INV.eq[slot] = it;
      }
      applyGear();
      P.hp = P.maxHp;
    }
    // first steps: the prologue and the path (10c_lore.js) take it from here
    SAVE.chain.then(() => saveNow());
  } else {
    uiLog(`Level ${GAME.prog.level} ${CLASSES[P.cls].name}, realm rank ${realmRank(GAME.prog.rp)}.`, 'sys');
    // characters from before gear existed get a quartermaster's kit
    if (save.gold === undefined) {
      INV.potions = 5; INV.gold = 60 + P.level * 5;
      for (const [slot, q] of [['weapon', 2], ['chest', 2], ['head', 1]]) INV.eq[slot] = makeItem({ cls: P.cls, realm: P.faction, lvl: Math.max(1, P.level - 1), q, slot });
      applyGear();
      P.hp = P.maxHp;
      setTimeout(() => uiToast(`The quartermaster has issued you a kit and some coin. ${IS_TOUCH ? 'Tap Kit' : 'Press I'} to see your gear.`, 'hint') /* [guide] */, 2500);
      saveSoon();
    }
  }
  sfx('portal');
  loreOnStart(save);
  giftsOnStart(save); // [gifts] the realm ultimate's cooldown carries over (06c_gifts.js)
  buildOnStart(save); // [building] the build button and the bed (06k_build.js)
  survivalOnStart(save); // [survival] the needs on the HUD, food in the bags, deer as game (09s_survival.js)
  depthOnStart(); // [depth] game birds (09u_depth.js)
}
function newCharacter() {
  wipeSave();
  const P = GAME.player;
  if (P) { if (P.carrying != null) dropRelic(P); removeEnt(P); }
  GAME.player = null; GAME.prog = null; GAME.started = false;
  CAM.mode = 'title';
  INPUT.keys.clear(); INPUT.joy = null;
  for (const id of ['menu', 'death', 'dialog', 'mapov', 'kit']) $(id).hidden = true;
  LOOT.length = 0;
  resetInventory(null);
  UI.modal = null;
  $('hud').hidden = true;
  setupTitle(null);
}

/* ------------------------------------------------------------------ */
/* per-frame rendering preparation                                     */
/* ------------------------------------------------------------------ */
const frustum = new THREE.Frustum();
const projView = new THREE.Matrix4();
const _sph = new THREE.Sphere();
const _fwd = new THREE.Vector3();
const _p4 = [0, 0, 0, 0], _a4 = [0, 0, 0, 0], _ca = [0, 0, 0, 0], _cb = [0, 0, 0, 0], _mi = [0, 0, 0, 0], _st = [0, 0, 0, 0];
const _ma = [0, 0, 0, 0], _hc = [0, 0, 0, 0], _hb = [0, 0, 0, 0], _we = [0, 0, 0, 0];
const HUMAN_LOD = { high: 30, medium: 22, low: 15 };
const TRAIL_CAND = [];
const SHADOW_R = { humanoid: 0.62, wolf: 0.75, boar: 0.72, bear: 1.15, wisp: 0.45, deer: 0.7, stag: 0.74, horse: 1.0 };
const STAMP_R = { humanoid: 0.55, wolf: 0.6, boar: 0.6, bear: 0.95, deer: 0.6, stag: 0.6, horse: 0.8 };

function drawActors(fx, fz) {
  crowdHuman.begin(); crowdHumanLo.begin(); if (crowdHumanFar) crowdHumanFar.begin(); // [phones]
  for (const k in crowdBeast) { crowdBeast[k][0].begin(); crowdBeast[k][1].begin(); }
  footLockBegin(); // [polish] the rows of planted feet (13s_footlock.js)
  const lodD2 = (HUMAN_LOD[quality.level] || 22) ** 2, farD2 = (HUMAN_FAR[quality.level] || 90) ** 2; // [phones] the farthest crowd (13q_lod.js)
  TRAIL_CAND.length = 0;
  const camX = camera.position.x, camZ = camera.position.z;
  const rts = typeof THRONE_RTS !== 'undefined' && THRONE_RTS.active;
  const viewer = rts ? GAME.player : null;
  // An overhead view reaches beyond the play camera's local disk. The existing
  // frustum still bounds visible geometry; no actor beyond the camera's far plane draws.
  const maxD2 = rts ? camera.far * camera.far : 175 * 175;
  for (const e of ENT) {
    if (typeof netNpcVisible === 'function' && !netNpcVisible(e) || typeof netEntityVisible === 'function' && !netEntityVisible(e)) continue;
    // The command camera shares the map's scouting: panning cannot reveal an unseen enemy band.
    if (viewer && e.warband && e.warband.realm !== viewer.faction && !cwSpotted(e.warband, viewer)) continue;
    if (e.removed || e.kind === 'door' || e.kind === 'dragon' || e.capHide) continue; // [capture] the player kept out of the frame (14_capture.js)
    const dx = e.x - camX, dz = e.z - camZ;
    if (dx * dx + dz * dz > maxD2) continue;
    const sc = e.scale || 1;
    let y = e.y;
    if (!e.alive && e.removeAt < Infinity) y -= Math.max(0, GAME.t - (e.removeAt - 2.5)) * 0.7; // sink before vanishing
    _sph.center.set(e.x, y + 1.0 * sc, e.z); _sph.radius = 2.4 * sc;
    const visible = frustum.intersectsSphere(_sph);
    // Altitude reduces model detail too: units directly below the command camera
    // must not retain the close play model merely because their XZ coordinates match.
    const detailD2 = dx * dx + dz * dz + (rts ? (camera.position.y - _sph.center.y) ** 2 : 0);
    // ground shadows (the decal window is 96 m around the player)
    if (Math.abs(e.x - fx) < 46 && Math.abs(e.z - fz) < 46 && (e.alive || e.anim.death < 1)) decalAdd(e.x, e.z, (e.mount ? SHADOW_R.horse : SHADOW_R[e.kind]) * sc * (e.kind === 'wisp' ? 1.2 : SHADOW.rt ? 0.72 : 1), 0);
    // grass parting
    if (e.kind !== 'wisp' && e.alive && Math.abs(e.x - fx) < 30 && Math.abs(e.z - fz) < 30) {
      if (e._tx === undefined) { e._tx = e.x; e._tz = e.z; }
      const m = Math.abs(e.x - e._tx) + Math.abs(e.z - e._tz);
      if (m > 0.04 || e === GAME.player) TRAIL_CAND.push(e);
    } else { e._tx = e.x; e._tz = e.z; }
    if (!visible) continue;
    if (e.kind === 'wisp') {
      const k = e.alive ? 1 : 1 - e.anim.death;
      if (k <= 0.01) continue;
      const pulse = 0.85 + 0.15 * Math.sin(renderTime * 5 + e.id), wc = look5WispCol(e), ws = e.scale || 1; // [look5] each wisp in its own colour (its look: the late wisps' pale, storm-blue, ghost-green and violet lights, a risen champion's ember red), at its size: every wisp was drawn teal (13z_look5.js)
      glowPush(e.x, y, e.z, wc[0] * k, wc[1] * k, wc[2] * k, 1.5 * pulse * ws);
      glowPush(e.x, y, e.z, wc[3] * k, wc[4] * k, wc[5] * k, 0.32 * ws);
      if (e.alive && Math.random() < 0.35) FX.trail(e.x + (Math.random() - 0.5) * 0.4 * ws, y + (Math.random() - 0.5) * 0.4 * ws, e.z + (Math.random() - 0.5) * 0.4 * ws, wc.tr, 0.14 * ws, 0.7);
      continue;
    }
    _p4[0] = e.x; _p4[1] = y; _p4[2] = e.z; _p4[3] = e.yaw;
    _a4[0] = e.anim.phase; _a4[1] = e.anim.turn > 0.05 && e.anim.amt < 0.15 ? -e.anim.turn : e.anim.amt; _a4[2] = animActValue(e); _a4[3] = e.anim.death; // [motion] a negative amount: stepping round on the spot (humanVS)
    waterAnimPack(e, _a4); // [water] strokes, paddling and treading water (07b_swim.js)
    const L = e.look;
    if (e.kind === 'humanoid') {
      _ca[0] = L.tabard[0]; _ca[1] = L.tabard[1]; _ca[2] = L.tabard[2]; _ca[3] = sc;
      _cb[0] = L.armor[0]; _cb[1] = L.armor[1]; _cb[2] = L.armor[2]; _cb[3] = L.flags || 0;
      _mi[0] = L.skin; _mi[1] = (e.brand || e.fishing) && e.alive ? (L.mask | WB.torch) & ~WB.bow : e.boat || (e.anim.act === 19 && e.anim.actDur > 0) ? L.mask & ~(WEAPON_BITS | WB.shield | WB.shieldRound) : L.mask; _mi[2] = e.anim.flash; _mi[3] = L.hair; // [survival] a rod is held like a brand; [water2] at the oars the hands are on them (the weapon and shield laid in the boat); [polish] and both hands on the boat you shove off (action 19)
      if (e.anim.act === 21 && e.anim.actDur > 0) _mi[1] |= WB.beater; // [look4] a fire beater in the hands that beat out flames (05a_rig.js)
      if (e.alive && e.ai?.lj?.haul) _mi[1] = (_mi[1] & ~WEAPON_BITS) | (e.ai.lj.haul === 'wood' ? WB.timberLoad : WB.stoneLoad);
      if (e._hamUntil > GAME.t) _mi[1] |= WB.hammer; // [motion5] a mallet in the hand of a builder or a mason at work
      _st[0] = L.outfit ?? 0; _st[1] = L.emblem ?? 3; _st[2] = (L.fem ? 1 : 0) + 2 * footLockSlot(e, false); _st[3] = L.bulk ?? 0; // [polish] the row of its planted feet above the bit (13s_footlock.js)
      if (e.role === 'player') { const mc = late3MantleCode(e); if (mc) { _st[1] += mc; _mi[1] |= WB.cape; } } // [late3] the mantle of the name you wear (10n_veteran.js)
      else if (e.l2risen || e.role === 'lord') { const mc = late4MantleCode(e); if (mc) { _st[1] += mc; _mi[1] |= WB.cape; } } // [late4] the March's other veterans wear their devices: a risen champion's crowned skull, a keep lord's tower past 40 (10o_late4.js)
      if (e.mount && e.alive) {
        // the horse under the rider, then the rider on the saddle
        const MA = e.mountAnim, H = crowdBeast[e.mount.crowd] || crowdBeast.horse; // [animals] your own horse in its own coat
        _ma[0] = MA.phase; _ma[1] = MA.amt; _ma[2] = e.onGround === false ? 6.5 : 0; _ma[3] = 0;
        _hc[0] = e.mount.coat[0]; _hc[1] = e.mount.coat[1]; _hc[2] = e.mount.coat[2]; _hc[3] = 1 + (e.mount.crowd ? e.mount.visCode || 0 : 0);
        _p4[3] = beastLeanYaw(e); // [motion] the horse leans into the turn with its rider (13r_motion.js); [motion3] before its hooves' row (the tilt it takes off)
        _hb[0] = e.mount.cloth[0] + late3BardCode(e); _hb[1] = e.mount.cloth[1]; /* [late3] a veteran's barding (10n_veteran.js) */ _hb[2] = e.mount.cloth[2]; _hb[3] = beastWx(e, e.anim.flash) + 256 * footLockSlot(e, true); // the horse is as wet as its rider; [polish] its planted hooves (13s_footlock.js)
        let horses = detailD2 < lodD2 && H[0].n < H[0].max ? H[0] : H[1];
        if (rts && horses.n >= horses.max && H[0].n < H[0].max) horses = H[0];
        horses.push(_p4, _ma, _hc, _hb);
        _p4[1] = y + HORSE_SEAT - 0.86 * sc;
        _a4[0] = MA.phase; _a4[1] = MA.amt;
        _cb[3] = (L.flags || 0) | 8;
      }
      // seated: on a throne the body takes the rider's pose, hips on the seat
      if (e.seat && e.alive) { _p4[1] = e.seat.y - 0.86 * sc; _a4[0] = 0; _a4[1] = 0; _cb[3] = (L.flags || 0) | 8; }
      wearVisual(e, _we);
      if (typeof realmPublicWorksVisual === 'function') realmPublicWorksVisual(e, _mi, _cb); // feature/weather: wet, snow, dirt, blood and damage for the actor shader (05h_wear.js)
      _p4[3] = humanSlopeYaw(e, y, detailD2 < lodD2 * 2.5); // [motion] the floor's slope rides on the yaw (13r_motion.js)
      let people = detailD2 < lodD2 && crowdHuman.n < crowdHuman.max ? crowdHuman
        : detailD2 > farD2 && crowdHumanFar && crowdHumanFar.n < crowdHumanFar.max ? crowdHumanFar : crowdHumanLo;
      // A broad command view may fill the far pool. Spill through the existing
      // pools before dropping a body; their fixed allocation remains unchanged.
      if (rts && people.n >= people.max) people = crowdHumanFar && crowdHumanFar.n < crowdHumanFar.max ? crowdHumanFar
        : crowdHumanLo.n < crowdHumanLo.max ? crowdHumanLo : crowdHuman;
      people.push(_p4, _a4, _ca, _cb, _mi, _st, _we); // [phones] far: crowdHumanFar
      // a gem of light on casters' hands while a spell builds
      if (e.casting && e.alive && e.casting.id !== 'summon') {
        const A = ABILITIES[e.casting.id];
        const c = e.cls === 'mage' ? [2.4, 1.1, 0.4] : e.cls === 'priest' ? [2.2, 2.0, 1.1] : [1.2, 1.4, 2.0];
        const k = 0.4 + 0.6 * clamp(e.casting.t / e.casting.total, 0, 1);
        glowPush(e.x + Math.sin(e.yaw) * 0.42, y + 1.55 * sc, e.z + Math.cos(e.yaw) * 0.42, c[0], c[1], c[2], (A && A.ground ? 0.9 : 0.6) * k);
      }
    } else {
      _ca[0] = L.colA[0]; _ca[1] = L.colA[1]; _ca[2] = L.colA[2]; _ca[3] = sc + (e.visCode || 0); // [animals] pattern and seed above the scale
      const C = crowdBeast[e.crowd || e.kind]; // [animals] shorn sheep, bulls, tacked horses
      if (C && e.role !== 'bird' && e.kind !== 'hen') _p4[3] = beastLeanYaw(e); // [motion] a beast leans into its turns (beastVS); [motion3] before its feet's row, which takes off the tilt the shader will get (a step of the tilt a frame late moved the feet 3 cm)
      _cb[0] = L.colB[0] + (e.tame && e.tame.k === 'horse' && e.tame.owner === 'player' ? late3BardCode(GAME.player) : 0); _cb[1] = L.colB[1]; _cb[2] = L.colB[2]; _cb[3] = beastWx(e, e.anim.flash) + 256 * footLockSlot(e, false); // [late3] your horse's barding (10n_veteran.js) // visual pass: its own wet and snow; [polish] its planted feet (13s_footlock.js)
      if (C) {
        let beasts = detailD2 < lodD2 && C[0].n < C[0].max ? C[0] : C[1];
        if (rts && beasts.n >= beasts.max && C[0].n < C[0].max) beasts = C[0];
        beasts.push(_p4, _a4, _ca, _cb);
      }
    }
  }
  crowdHuman.end(); crowdHumanLo.end(); if (crowdHumanFar) crowdHumanFar.end(); // [phones]
  footLockEnd(); // [polish]
  for (const k in crowdBeast) { crowdBeast[k][0].end(); crowdBeast[k][1].end(); }
  // the nearest movers press the grass (the player first)
  const P = GAME.player;
  TRAIL_CAND.sort((a, b) => (a === P ? -1 : b === P ? 1 : dist2(a.x, a.z, fx, fz) - dist2(b.x, b.z, fx, fz)));
  for (const e of TRAIL_CAND) {
    if (trailSegs.length >= TRAIL.maxSegs) { e._tx = e.x; e._tz = e.z; continue; }
    const r = STAMP_R[e.kind] * (e.scale || 1);
    if (dist2(e._tx, e._tz, e.x, e.z) > 16) { e._tx = e.x; e._tz = e.z; } // [look] a jump (a journey, a release, a portal) starts a fresh trail: it pressed a straight streak through the grass from where the body was, glowing at night
    trailStamp(e._tx, e._tz, e.x, e.z, e.onGround === false && e.y > heightAt(e.x, e.z) + 0.6 ? 0.01 : r);
    e._tx = e.x; e._tz = e.z;
  }
}
function drawTargetAndMarks() {
  const P = GAME.player;
  const t = P ? getEnt(P.target) : null;
  if (t && (t.alive || t.kind === 'door') && t !== P) {
    const hostile = isEnemy(P, t);
    const c = t.faction === FACTION_MONSTER ? hex3(CON[conIndex(t.level, P.level)].col) : t.faction <= 2 ? REALMS[t.faction].rgb : [1, 0.9, 0.6];
    U.uTargetColor.value.set(c[0], c[1], c[2]);
    const r = t.kind === 'door' ? 4.4 : (t.radius * 1.9 + 0.35) * (t.scale || 1);
    decalAdd(t.x, t.z, r, hostile ? 1 : 3);
  }
  for (let i = AOE_MARKS.length - 1; i >= 0; i--) {
    const m = AOE_MARKS[i];
    if (!aoeMarkAlive(m)) { AOE_MARKS.splice(i, 1); continue; }
    decalAdd(m.x, m.z, m.r, 2);
  }
}
// chimney smoke and lantern light in the towns
function drawTownLife(dt) {
  const camX = camera.position.x, camZ = camera.position.z;
  const wx = U.uWindDir.value.x * U.uWind.value, wz = U.uWindDir.value.y * U.uWind.value;
  const A = U.uAmbient.value, Lc = U.uLightColor.value;
  const night = U.uNight.value;
  for (const c of CHIMNEYS) {
    if (dist2(c.x, c.z, camX, camZ) > 110 * 110) continue;
    c.t = (c.t || Math.random()) - dt;
    if (c.t > 0) continue;
    c.t = 0.28 + Math.random() * 0.25;
    const g = 0.55 + Math.random() * 0.12;
    fxAlpha.emit(c.x + (Math.random() - 0.5) * 0.2, c.y, c.z + (Math.random() - 0.5) * 0.2,
      wx * 0.35 + (Math.random() - 0.5) * 0.12, 0.55 + Math.random() * 0.3, wz * 0.35 + (Math.random() - 0.5) * 0.12,
      6 + Math.random() * 3, (A.x * 0.8 + Lc.x * 0.3) * g, (A.y * 0.8 + Lc.y * 0.3) * g, (A.z * 0.8 + Lc.z * 0.3) * g, -(0.9 + Math.random() * 0.5), -0.03, 0.12);
  }
  if (night > 0.04) {
    for (const l of LANTERNS) {
      if (dist2(l.x, l.z, camX, camZ) > 140 * 140) continue;
      const f = night * (0.9 + 0.1 * Math.sin(renderTime * 7.3 + l.x * 3.1) * Math.sin(renderTime * 4.1 + l.z));
      glowPush(l.x, l.y, l.z, 2.4 * f, 1.55 * f, 0.6 * f, 0.55);
      glowPush(l.x, l.y, l.z, 0.75 * f, 0.45 * f, 0.16 * f, 3.2);
    }
  }
}
function drawRelicsAndPortals() {
  for (const rel of WAR.relics) {
    const p = rel.mesh.position, R = REALMS[rel.realm];
    glowPush(p.x, p.y, p.z, R.rgb[0] * 1.6 + 0.6, R.rgb[1] * 1.6 + 0.6, R.rgb[2] * 1.6 + 0.6, 1.8);
    if (Math.random() < 0.12) FX.trail(p.x + (Math.random() - 0.5) * 0.6, p.y + (Math.random() - 0.5) * 0.6, p.z + (Math.random() - 0.5) * 0.6, [1.6, 1.3, 0.6], 0.12, 1.0);
  }
  const camX = camera.position.x, camZ = camera.position.z;
  for (const R of REALMS) {
    for (const S of [R.town, R.musterSite]) {
      if (dist2(S.x, S.z, camX, camZ) > 160 * 160) continue;
      const pulse = 0.8 + 0.2 * Math.sin(renderTime * 1.7 + S.x);
      glowPush(S.x, S.y + 1.3, S.z, 0.35 * pulse, 0.85 * pulse, 1.4 * pulse, 3.2);
      if (Math.random() < 0.25) { const a = Math.random() * TAU, r = Math.random() * 2.2; FX.trail(S.x + Math.cos(a) * r, S.y + 0.3 + Math.random() * 0.5, S.z + Math.sin(a) * r, [0.4, 1.0, 1.6], 0.16, 1.4); }
    }
  }
}

/* ------------------------------------------------------------------ */
/* the frame                                                           */
/* ------------------------------------------------------------------ */
let lastNow = 0, renderTime = 0, treeTick = 0, treeCamX = 0, treeCamZ = 0;
function simStep(dt) {
  if (typeof netHumanLive === 'function' && !netHumanLive()) return;
  GAME.t += dt;
  GAME.dt = dt;
  rebuildGrid();
  runLater();
  if (typeof mainWorldAgentTick === 'function') mainWorldAgentTick();
  if (GAME.player) updatePlayer(dt);
  if (typeof netWorldPartsLocalStep === 'function') netWorldPartsLocalStep(dt);
  updateNPCs(dt);
  const sharedSim = (typeof netEntityCanSimulateWorld !== 'function' || netEntityCanSimulateWorld())
    && (typeof netWorldPartsCanSimulate !== 'function' || netWorldPartsCanSimulate());
  if (sharedSim) updateWar(dt);
  updateProjectiles(dt);
  updateWalls(dt); // [walls] arrows glancing off stone, stuck ones falling with what held them (07g_walls.js)
  if (sharedSim) updateDragonWorld(dt);
  updateLoot(dt);
  if (sharedSim) updateGates(dt);
  if (sharedSim) updateCastles(dt); // castles: gates swing for their own side, walls are repaired (04g_castles.js)
  if (sharedSim) updateBarrow(dt);
  updateBarrowLocal(dt);
  if (sharedSim) updateHouses(dt);
  updateWear(dt); // feature/weather: soaking, snow, mud, blood and lightning on the ground (05h_wear.js)
  if (sharedSim) updateNature(dt); // nature (05h_nature.js): falling and burning trees, grass fire, regrowth, craters
  updateBrand(dt); // a burning brand in hand (09d_brand.js)
  updateLand(dt); // [worldstate] loot settles into craters, the woodcutter's axe in hand (12b_worldstate.js)
  updateGifts(dt); // [gifts] realm gifts: passives, the realm ultimate, champions (06c_gifts.js)
  updateWater(dt); // [water] wading, swimming, the current, fire out, splashes (07b_swim.js)
  updateHall(dt); // [building] the war table's grant, resting by a hall's hearth (04k_hall.js)
  updateBuild(dt); // [building] building work, fire and repair of placed structures (06k_build.js)
  updateClasses(dt); // [classes] the callings: blocks and parries, the draw and arrows in flight, snares, runes, steam, ice, holy ground (07b_classes.js)
  updateSurvival(dt); // [survival] hunger and thirst, work, fishing, regrowth (09s_survival.js)
  updateFarming(dt); // [farming] the season, beds and crops, the town fields, herbs (08h_farming.js)
  updateAnimals(dt); // [animals] taming, companions, pens, breeding (08h_animals.js)
  if (sharedSim) updateSeasons(dt); // [seasons] the snow lying on the land, the lakes freezing and thawing (05k_seasons.js)
  if (sharedSim) updateDepth(dt); // [depth] burning and felled plants, stumps, game birds, built doors, wells, hatching, herding (09u_depth.js)
  updateLate2(dt); // [late2] deeds done with you there (10l_late.js)
  if (sharedSim) updateLate4(dt); // [late4] the roaming risen, the gore rushes, the deep's own air (10o_late4.js)
  updateWeather2(dt); // [weather2] the weather systems: fronts, showers and storms carried across the March (12c_weather2.js)
  if (sharedSim) updateLoops(dt); // [loops] the realms' stores: the land's work, the war's draw, the caravans (08m_loops.js)
  updateSeason(dt); // [loops] the season of weeks: its clock, points, projects and offensives (08n_season.js)
  netPump(dt); // [net] the others in the March: heard, told (14n_net.js)
}
function tick(dt) {
  if (typeof throneRtsGuard === 'function') throneRtsGuard();
  if (GRAPHICS_CONTEXT_LOST || GRAPHICS_STARTUP.stopped) return;
  if (typeof netHumanSync === 'function') netHumanSync();
  if (typeof netHumanLive === 'function' && !netHumanLive()) return;
  dt = captureDt(dt); // [capture] the capture build's clock: the world frozen or slowed, a shot's own step (14_capture.js)
  renderer.info.reset();
  renderTime += dt;
  U.uTime.value = renderTime;
  // time of day
  if (tod.mode === 'cycle') tod.p = (tod.p + (dt * 3) / tod.cycleSec) % 3;
  else {
    const target = tod.mode === 'fixed' ? tod.fixedP : TOD_TARGET[tod.mode];
    const fwd = (((target - tod.p) % 3) + 3) % 3;
    if (fwd > 2.6) tod.p = (((tod.p - Math.min(3 - fwd, dt * 0.55)) % 3) + 3) % 3;
    else if (fwd > 0.002) tod.p = (tod.p + Math.min(fwd, dt * 0.55)) % 3;
  }
  applyTimeOfDay(tod.p);
  updateWeather(dt);
  seasonsFrame(dt); // [seasons] the year's colours, the snow cover, leaves and fireflies (05k_seasons.js)
  applyWeather();
  applyIndoor();
  updateNightSky(dt); // [aurora] the northern lights and shooting stars (05i_aurora.js)
  wxCloudsFrame(dt); // [weather2] the cloud field and the dome of the sky, the clouds' shadows, mist in the valleys (12c_weather2.js)
  // simulation (the menu and the prologue pause the world)
  if (UI.modal !== 'menu' && UI.modal !== 'prologue') {
    // up to two steps so a slow frame rate does not slow the world down
    let rest = Math.min(dt, 0.1);
    if (GAME.hitStop > 0) { GAME.hitStop -= dt; rest *= 0.06; }
    while (rest > 1e-4) { const s = Math.min(rest, 0.05); simStep(s); rest -= s; }
  } else netPump(dt); // [net] the menu pauses your world, not the room (14n_net.js)
  // camera
  updateCamera(dt);
  captureCamera(); // [capture] the capture build's camera: free, orbiting, following or on its path (14_capture.js)
  camera.updateMatrixWorld();
  if (GAME.player && CAM.mode === 'play') U.uCamFocus.value.set(GAME.player.x, GAME.player.y + 1.3, GAME.player.z);
  else U.uCamFocus.value.set(0, -1000, 0);
  projView.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
  frustum.setFromProjectionMatrix(projView);
  skyU.uInvVP.value.copy(projView).invert();
  wxCloudsScreen(); // [weather2] the main view's own clouds, once the camera is placed (12c_weather2.js)
  const P = GAME.player;
  const fx = P ? P.x : W.heroTree.x, fz = P ? P.z : W.heroTree.z;
  // world-space helpers
  drawActors(fx, fz);
  drawDragon(dt);
  drawBrand(dt);
  drawTargetAndMarks();
  drawRelicsAndPortals();
  drawTownLife(dt);
  drawHouses(dt);
  if (typeof realmRtsModelsFrame === 'function') realmRtsModelsFrame(dt);
  if (typeof realmPublicWorksFrame === 'function') realmPublicWorksFrame(dt);
  drawFires(dt);
  drawNature(dt); // nature (05h_nature.js): tree and wood instances, flames, the nature map upload
  drawGifts(dt); // [gifts] the standard, the hunt, the winter storm and the gift button (06c_gifts.js)
  drawWater(dt); // [water] the ripple simulation, rain and spells on the water, the sound of rivers (07b_swim.js)
  drawHall(dt); // [building] the torches of the keeps' halls (04k_hall.js)
  drawBuild(dt); // [building] the placement ghost, flames and states of placed structures (06k_build.js)
  drawClasses(dt); // [classes] arrows in flight, ice sheets, snares, frozen bodies, steam and the parry cue (05j_classfx.js)
  look5Frame(dt); // [look5] holy ground's light in the grass (13z_look5.js)
  drawLate4(dt); // [late4] the risen's embers and glow, boulders and flasks in flight (10o_late4.js)
  loopsDraw(dt); // [loops] the carts on the roads (08m_loops.js)
  look6Frame(dt); // [look6] the cistern's water stirred by those in it (14_look6.js)
  drawFarming(dt); // [farming] crops, weeds and herbs near the camera, the beds' soil, the plant card (08i_farm_draw.js)
  drawAnimals(dt); // [animals] pen gates, the paddock marker, the companion bar (08h_animals.js)
  drawDepth(dt); // [depth] nests and their eggs (09u_depth.js)
  updateAmbientLife(dt);
  drawSurvival(dt); // [survival] plants, the rod and line, the spit, the needs on the HUD (after the fish: 09s_survival.js)
  drawProjectiles();
  drawWalls(); // [walls] arrows stuck in walls, roofs and doors, and those glancing off stone (07g_walls.js)
  updateSpellFX(dt);
  drawLoot();
  renderDecals(fx, fz);
  stepTrail(dt, fx, fz);
  camera.getWorldDirection(_fwd);
  updateGrassCenters(camera.position.x, camera.position.z, _fwd.x, _fwd.z);
  // (at once when the camera has jumped: a release, a journey, a fixed view; else every 15 frames)
  if (dist2(camera.position.x, camera.position.z, treeCamX, treeCamZ) > 20 * 20) treeTick = 0;
  if (--treeTick <= 0) { treeTick = 15; treeCamX = camera.position.x; treeCamZ = camera.position.z; updateTreeVisibility(camera.position.x, camera.position.z); }
  updateNearTrees(dt, camera.position.x, camera.position.z);
  updateFireflies(camera.position.x, camera.position.z);
  updateLod(); // [phones] terrain and far trees by distance (13q_lod.js)
  updateMountains(); // [land] the crags each model draws (03c_land.js)
  gatherLights(camera.position.x, camera.position.y, camera.position.z);
  fxAdd.flush(); fxAlpha.flush();
  arrowFlush(); glowFlush();
  // the sun's shadow map, centred a little ahead of the view
  if (SHADOW.rt && !INDOOR.on) {
    const ax = camera.position.x + _fwd.x * SHADOW.half * 0.45, az = camera.position.z + _fwd.z * SHADOW.half * 0.45;
    U.uShadowOn.value = 1 - 0.75 * WEATHER.overcast;
    renderShadowPass(ax, heightAt(ax, az), az);
  }
  // draw (meshes rebuilt since boot, like grass after a quality change, belong to the world above)
  regroupOutdoors();
  renderer.setRenderTarget(sceneRT);
  renderer.setClearColor(0x000000, 1);
  renderer.clear(true, true, false);
  renderer.render(scene, camera);
  composite.uniforms.uTime.value = renderTime;
  const fl = composite.uniforms.uFlash.value;
  fl.w = REDUCE_MOTION ? 0 : Math.max(0, fl.w - dt * 1.3);
  renderPost();
  // interface
  if (GAME.started && GAME.player) updateHUD(dt);
  if (GAME.started && GAME.player) updateLore(dt);
  if (GAME.started && GAME.player) classHUD(dt); // [classes] momentum, stance, the draw, attunement, devotion and the combo cue (10d_classes_ui.js)
  netUiFrame(); // [net] the Players button, the party's frames, speech over heads (14o_netui.js)
  hudLayout(dt); // [phones] keep the panels apart on every screen (10p_hud.js)
  if (typeof updateThroneRTS === 'function') updateThroneRTS(dt);
  if (typeof realmLogisticsOwnerFrame === 'function') realmLogisticsOwnerFrame();
  updateAudio(dt);
  adaptQuality(dt);
}
function frame(now) {
  if (GRAPHICS_CONTEXT_LOST || GRAPHICS_STARTUP.stopped) return;
  requestAnimationFrame(frame);
  let dt = (now - lastNow) / 1000;
  lastNow = now;
  if (!(dt > 0)) dt = 1 / 60;
  dt = Math.min(dt, 0.1);
  try { tick(dt); } catch (err) { reportError(err); }
}

/* ------------------------------------------------------------------ */
/* test and debug hooks                                                */
/* ------------------------------------------------------------------ */
function warSummary() {
  const roles = {};
  let bad = 0;
  for (const e of ENT) {
    roles[e.role] = (roles[e.role] || 0) + 1;
    if (!isFiniteNum(e.x) || !isFiniteNum(e.z) || !isFiniteNum(e.y) || !isFiniteNum(e.hp)) bad++;
  }
  return {
    t: Math.round(GAME.t), ents: ENT.length, roles, nonFinite: bad,
    keeps: WAR.keeps.map((K) => `${K.site.name}:${REALMS[K.realm].name}${K.door.alive ? '' : ' (gate down)'}`),
    relics: WAR.relics.map((r) => `${REALMS[r.realm].hallow}:${r.state}${r.state === 'temple' ? '@' + REALMS[r.at].name : ''}`),
    warbands: WAR.warbands.map((w) => `${REALMS[w.realm].name}:${w.order ? w.order.type : 'idle'}:${wbMembers(w).length}`),
    stats: { ...WAR.stats }, news: WAR.news.slice(-8).map((n) => n.text), errors: HM_ERRORS.slice(),
    later: LATER.length, proj: PROJ.length,
  };
}
window.__hm = {
  ready: false, GAME, WAR, ENT, CAMPS, REALMS, CAM, INPUT, UI, tod, quality, SAVE, errors: HM_ERRORS, camera, MOBS, FACTION_MONSTER, FACTION_NEUTRAL,
  DUN, INDOOR, BARROW, BARROW_STATE,
  rts: { state: THRONE_RTS, ui: THRONE_RTS_UI, open: openThroneRTS, close: closeThroneRTS, focus: throneRtsFocus, zoom: throneRtsZoom, realm: throneRtsView },
  dbg: { grassMeshes, scene, SHADOW, U, renderer, DBG, LAKES, skyU, FIRES, CAMPS, WEATHER, strikeLightning, spawnSlash, slashGeo, slashMesh, DRAGON, setDragonState, COVER, addFire, BRAND },
  start(o = {}) {
    const realm = o.realm ?? 0, cls = o.cls ?? 'warrior';
    const completion = startGame({ v: 1, name: o.name || randomName(realm), realm, cls, level: o.level || 1, xp: 0, rp: o.rp || 0, fresh: true });
    const playerId = () => GAME.player ? GAME.player.id : null;
    return completion && typeof completion.then === 'function' ? completion.then(playerId) : playerId();
  },
  simulate(sec, dt = 0.05) {
    const n = Math.round(sec / dt);
    for (let i = 0; i < n; i++) {
      try { simStep(dt); } catch (err) { reportError(err); }
      U.uTime.value += dt;
      for (let j = AOE_MARKS.length - 1; j >= 0; j--) if (!aoeMarkAlive(AOE_MARKS[j])) AOE_MARKS.splice(j, 1);
    }
    return warSummary();
  },
  summary: warSummary,
  startup() {
    return { ...GRAPHICS_STARTUP, events: GRAPHICS_STARTUP.events.slice(), buffer: [gl.drawingBufferWidth, gl.drawingBufferHeight], target: sceneRT ? [sceneRT.width, sceneRT.height] : null, rtType: sceneRT && sceneRT.texture.type, bloomTargets: bloomRTs.length, raysEnabled: !!raysRT, legacyClouds: !BOOT_SAFE, rippleTargets: RIPPLE.res, weatherGpu: { on: WXR.on, field: !!WXR.field, dome: !!WXR.dome, screen: !!WXR.scr, fieldMat: !!WXR.fieldMat, domeMat: !!WXR.domeMat, screenMat: !!WXR.scrMat }, proactivePrograms: PERF2.warmed };
  },
  renderInfo() {
    const r = renderer.info.render;
    const crowds = { human: crowdHuman.n, humanLo: crowdHumanLo.n };
    for (const k in crowdBeast) crowds[k] = [crowdBeast[k][0].n, crowdBeast[k][1].n];
    const vis = { trees: treeChunks.filter((m) => m.visible).reduce((a, m) => a + m.geometry.instanceCount, 0) };
    const geo = (g) => (g.index ? g.index.count / 3 : g.attributes.position.count / 3);
    const per = { human: geo(crowdHuman.geo), humanLo: geo(crowdHumanLo.geo), beasts: Object.fromEntries(Object.keys(crowdBeast).map((k) => [k, crowdBeast[k].map((c) => geo(c.geo))])), tree: treeChunks.length ? geo(treeChunks[0].geometry) : 0, grass: grassMeshes.map((m) => [m.geometry.instanceCount, geo(m.geometry)]) };
    return { calls: r.calls, triangles: r.triangles, programs: renderer.info.programs.length, textures: renderer.info.memory.textures, geometries: renderer.info.memory.geometries, crowds, vis, per, rt: [sceneRT.width, sceneRT.height, quality.msaa] };
  },
  teleport(x, z) { const P = GAME.player; if (!P) return; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = heightAt(x, z); },
  setTod(p, mode = 'fixed') { tod.p = p; tod.fixedP = p; tod.mode = mode === 'cycle' ? 'cycle' : 'fixed'; },
  look(yaw, pitch, dist) { if (yaw !== undefined) CAM.yaw = yaw; if (pitch !== undefined) CAM.pitch = pitch; if (dist !== undefined) CAM.dist = CAM.targetDist = dist; },
  frame(dt = 1 / 60) { tick(dt); },
  INV, LOOT, QUALITY, ABILITIES, CLASSES, SPELL,
  nature: NATURE_DEBUG, // nature (05h_nature.js)
  fn: { warLevel, abilityRank, rankMult, rescaleWar, buildHotbar, updateMotion, spellDisc, spellRibbon, spellPillar, spawnProjectile, addBuff, hasBuff, enterBarrow, leaveBarrow, setIndoor, setGate, dunPoint, dunFloorAt, dunRoomAt, makeItem, dropItem, equipItem, unequip, rollLoot, openKit, closeKit, renderKit, usePotion, applyGear, merchantStock, sellJunk, gearTotals, spawnRealmUnit, spawnMob, makeEnt, setupStats, classLook, villagerLook, removeEnt, OUTFIT, WB, W, sampleGrid, realmWeightsAt, sfx, audioUnlock, updateAudio, AUDIO, screenOf, setQuality, setTimeMode, playerUseSlot, setPlayerTarget, cycleTarget, playerInteract, getEnt, zoneAt, heightAt, isWalkable, useAbility, teleportPlayer, toggleMount, mountUp, dismount, humanStep, beastStride, dragonAnimate, GOODS, goodsAdd, goodsTake, goodsTakeAll, goodsHave, goodsCount, dropGood, registerGood, registerSavePart, savePartsLoad, savePartsData, openMenu, toggleMap, newCharacter, saveNow, buildSave, applyTimeOfDay, nearestWhere, isEnemy, addXP, addRP, killEnt, dealDamage, captureKeep, pickUpRelic, relicPosition, wbMembers, wbLeader },
};

window.__hm.water = WATER_DEBUG; // [water] test hooks (07b_swim.js)

function bootStartFailure(err) {
  if (GRAPHICS_CONTEXT_LOST) return;
  reportError(err);
  // Title rendering already owns its detailed, stopped recovery panel.
  if (GRAPHICS_STARTUP.titleError) return;
  GRAPHICS_STARTUP.stopped = true;
  GAME.ready = false;
  if (window.__hm) window.__hm.ready = false;
  const notice = document.getElementById('nogl'), loading = document.getElementById('loading');
  if (loading) { loading.hidden = true; loading.style.display = 'none'; }
  if (!notice) return;
  graphicsFailureTakeover(notice);
  notice.setAttribute('role', 'alert');
  const heading = document.createElement('strong'); heading.id = 'boot-failure-title';
  heading.textContent = 'The game could not finish loading';
  notice.setAttribute('aria-labelledby', heading.id);
  const detail = document.createElement('span');
  detail.textContent = 'An unexpected problem interrupted loading. Try again. Your saved progress has not been reset.';
  const retry = document.createElement('button'); retry.type = 'button'; retry.className = 'btn primary';
  retry.textContent = 'Retry loading'; retry.onclick = () => location.reload();
  const technical = document.createElement('details'); technical.className = 'graphics-technical';
  const summary = document.createElement('summary'); summary.textContent = 'Technical details';
  const log = document.createElement('pre'); log.textContent = String(err && err.message || err).slice(0,1500);
  technical.appendChild(summary); technical.appendChild(log);
  notice.replaceChildren(heading, detail, retry, technical);
  retry.focus({ preventScroll: true });
}
boot().catch(bootStartFailure);



