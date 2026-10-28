/* Prepare only this title's required shader programs. Actual draws and GPU
   fences remain the readiness gate; compilation completion is not a frame. */
const TITLE_COMPILE_LIMITS = Object.freeze({ pending: 8, perTurn: 4, pollMs: 10, programMs: 90000, totalMs: 180000 });

function titleCompileEligible(object) {
  if (!liveIn(object) || !object.layers.test(camera.layers)) return false;
  if (object.frustumCulled && !(object.isSprite ? frustum.intersectsSprite(object) : frustum.intersectsObject(object))) return false;
  return !!object.material && object.material.visible !== false;
}
function titleCompileSupported(object) {
  const material = object.material;
  // compile() traverses every array entry and does not run render hooks. Leave
  // those cases to the existing real draw rather than guessing their variants.
  return !!material && !Array.isArray(material) && !!object.geometry
    && object.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && object.onAfterRender === THREE.Object3D.prototype.onAfterRender
    && material.onBuild === THREE.Material.prototype.onBuild
    && material.onBeforeCompile === THREE.Material.prototype.onBeforeCompile
    && material.onBeforeRender === THREE.Material.prototype.onBeforeRender
    && material.customProgramCacheKey === THREE.Material.prototype.customProgramCacheKey;
}
async function prepareTitlePrograms(inventory, stages, generation) {
  const started = performance.now();
  const receipt = { generation, supported: false, outcome: 'serial', completed: false, stale: false,
    eligibleJobs: 0, preparedJobs: 0, skipped: 0, newPrograms: 0, maxPending: 0, maxPreparesPerTurn: 0,
    prepareMs: 0, flushMs: 0, maxFlushMs: 0, pollMs: 0, maxPollMs: 0,
    errorCheckMs: 0, maxErrorCheckMs: 0, elapsedMs: 0, disposed: 0, families: {} };
  const history = GRAPHICS_STARTUP.titlePreparations ||= [];
  history.push(receipt);
  if (history.length > 8) history.shift();
  if (BOOT_SAFE || !renderer.extensions?.has?.('KHR_parallel_shader_compile')) return receipt;
  receipt.supported = true;
  GRAPHICS_STARTUP.titlePreparing = true;
  const message = document.getElementById?.('loadmsg');
  if (message) message.textContent = 'Preparing the first view';
  const pending = new Map(), initialTarget = sceneRT;
  let timer = null, wake = null, lost = false, stale = false;
  const invalidate = reason => { stale = true; receipt.reason ||= reason; resume(); };
  const resume = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (wake) { const resolve = wake; wake = null; resolve(); }
  };
  const hidden = () => { if (document.hidden) invalidate('visibility'); };
  const resized = () => invalidate('resize');
  const contextLost = () => { lost = true; resume(); };
  const active = () => {
    if (lost) throw new Error('Graphics stopped while preparing title programs.');
    titleAssertActive();
  };
  const changed = () => {
    if (document.hidden) invalidate('visibility');
    if (TITLE_RESIZE_PENDING || resizeTimer || sceneRT !== initialTarget) invalidate('resize');
    if (TITLE_WARM_GENERATION !== generation || GAME.started) invalidate('generation');
  };
  const errors = () => {
    active();
    const checkStarted = performance.now();
    const found = gpuDiagGlErrors(gl);
    active();
    const checked = performance.now() - checkStarted;
    receipt.errorCheckMs += checked; receipt.maxErrorCheckMs = Math.max(receipt.maxErrorCheckMs, checked);
    if (found.length) throw new Error('GL errors while preparing title programs: ' + found.join(', '));
  };
  const pause = () => new Promise(resolve => {
    wake = resolve;
    timer = setTimeout(() => { timer = null; wake = null; resolve(); }, TITLE_COMPILE_LIMITS.pollMs);
  });
  document.addEventListener('visibilitychange', hidden);
  window.addEventListener('resize', resized);
  canvas.addEventListener('webglcontextlost', contextLost);
  try {
    active(); changed(); errors();
    const allowed = new Set(inventory.renderables), seen = new Set(), jobs = [];
    const priority = id => id === 'terrain' ? 0 : id === 'structures' ? 1 : id === 'crowds-1' ? 2 : 3;
    const ordered = stages.map(([id, members], index) => ({ id, members, index }))
      .filter(stage => stage.id !== 'post' && stage.id !== 'sky')
      .sort((a, b) => priority(a.id) - priority(b.id) || a.index - b.index);
    for (const { id, members } of ordered) for (const object of members) {
      if (!allowed.has(object)) throw new Error('Title program preparation received an unowned renderable.');
      if (seen.has(object)) continue;
      seen.add(object);
      if (!titleCompileSupported(object)) { receipt.skipped++; continue; }
      if (!titleCompileEligible(object)) continue;
      const material = object.material;
      jobs.push({ family: id, object, material, geometry: object.geometry,
        cost: material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1 });
      const family = receipt.families[id] ||= { jobs: 0, prepared: 0, programs: 0 };
      family.jobs++;
    }
    receipt.eligibleJobs = jobs.length;
    let index = 0;
    while (index < jobs.length || pending.size) {
      active(); changed();
      const pollStarted = performance.now();
      for (const [program, job] of pending) {
        active();
        if (!program.program) {
          if (!stale) throw new Error('A required title program was disposed before completion.');
          receipt.disposed++; pending.delete(program); continue;
        }
        // Check availability before elapsed deadlines, including after a late
        // background-tab poll. Context loss reports KHR completion=true, so it
        // must be rejected before querying or accepting the completion result.
        if (program.isReady()) {
          active();
          const linked = gl.getProgramParameter(program.program, gl.LINK_STATUS);
          active();
          if (linked !== true) {
            receipt.failedProgram = { id: program.id, family: job.family, linked };
            throw new Error('A required title program failed to link.');
          }
          pending.delete(program);
        }
      }
      const polled = performance.now() - pollStarted;
      receipt.pollMs += polled; receipt.maxPollMs = Math.max(receipt.maxPollMs, polled);
      active(); changed();
      for (const job of pending.values()) if (performance.now() - job.queuedAt >= TITLE_COMPILE_LIMITS.programMs) throw new Error('Title program preparation timed out.');
      if (!pending.size) {
        errors();
        if (stale) { receipt.outcome = 'stale'; receipt.stale = true; return receipt; }
        if (index === jobs.length) break;
      }
      if (performance.now() - started >= TITLE_COMPILE_LIMITS.totalMs) throw new Error('Title program preparation exceeded its time budget.');
      let prepared = 0;
      // An earlier queued program may report a GL error while other programs
      // are still pending. Check before adding work to that window, not only
      // when the entire pending set has drained.
      if (!stale && index < jobs.length && pending.size + jobs[index].cost <= TITLE_COMPILE_LIMITS.pending) errors();
      while (!stale && index < jobs.length && prepared < TITLE_COMPILE_LIMITS.perTurn) {
        const job = jobs[index];
        // Reserve both possible sided programs before submission. Each call
        // sees one supported original single-material leaf, never a subtree.
        if (pending.size + job.cost > TITLE_COMPILE_LIMITS.pending) break;
        active(); changed();
        if (stale) break;
        if (!titleCompileEligible(job.object) || job.object.geometry !== job.geometry || job.object.material !== job.material) { invalidate('inventory'); break; }
        const before = new Set(renderer.info.programs), saved = gpuDiagCaptureRenderer(), side = job.material.side;
        const queuedAt = performance.now();
        // Pinned r160 compile() needs only these traversals on its input root.
        // Flat original references preserve instancing/morph/geometry flags,
        // hooks and cache keys without reparenting or allocating scene objects.
        const collection = { traverse: visit => visit(job.object), traverseVisible: visit => visit(job.object) };
        let compiled = false;
        try {
          renderer.setRenderTarget(initialTarget);
          renderer.compile(collection, camera, scene);
          compiled = true;
        } finally {
          job.material.side = side;
          // An exception can leave r160's internal render-state stack dirty.
          // Restore CPU values, then fail; never retry that renderer or submit
          // more GL cleanup work after a failed compile/context loss.
          gpuDiagRestoreRenderer(saved, compiled && !lost);
        }
        receipt.prepareMs += performance.now() - queuedAt;
        active();
        const added = renderer.info.programs.filter(program => !before.has(program));
        if (added.length > job.cost) throw new Error('Title compilation exceeded its reserved program window.');
        for (const program of added) pending.set(program, { queuedAt, family: job.family });
        receipt.newPrograms += added.length;
        receipt.families[job.family].prepared++;
        receipt.families[job.family].programs += added.length;
        index++; prepared++; receipt.preparedJobs++;
        receipt.maxPending = Math.max(receipt.maxPending, pending.size);
      }
      receipt.maxPreparesPerTurn = Math.max(receipt.maxPreparesPerTurn, prepared);
      if (prepared) {
        active(); const flushStarted = performance.now(); gl.flush();
        const flushed = performance.now() - flushStarted;
        receipt.flushMs += flushed; receipt.maxFlushMs = Math.max(receipt.maxFlushMs, flushed);
        errors();
      }
      if (index < jobs.length || pending.size) await pause();
    }
    active(); changed(); errors();
    if (stale) { receipt.outcome = 'stale'; receipt.stale = true; return receipt; }
    receipt.outcome = 'completed'; receipt.completed = true;
    return receipt;
  } catch (error) {
    receipt.outcome = 'failed'; receipt.error = String(error.message || error);
    if (!GRAPHICS_STARTUP.titleFailure) GRAPHICS_STARTUP.titleFailure = {
      stage: 'program preparation', generation, ...receipt.failedProgram,
      contextLost: lost || GRAPHICS_CONTEXT_LOST || gl.isContextLost(), error: receipt.error,
    };
    throw error;
  } finally {
    if (timer !== null) clearTimeout(timer);
    timer = null; wake = null;
    document.removeEventListener('visibilitychange', hidden);
    window.removeEventListener('resize', resized);
    canvas.removeEventListener('webglcontextlost', contextLost);
    GRAPHICS_STARTUP.titlePreparing = false;
    receipt.elapsedMs = Math.round(performance.now() - started);
  }
}
