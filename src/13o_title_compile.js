/* Prepare only this title's required shader programs. Actual draws and GPU
   fences remain the readiness gate; compilation completion is not a frame. */
// Fill by new programs, then validate a drained wave before refill.
// Context loss and completed failed links still stop admission immediately.
const TITLE_COMPILE_LIMITS = Object.freeze({ pending: 4, perTurn: 4, turnMs: 8, pollMs: 10, programMs: 90000, totalMs: 180000 });

function titleCompileEligible(object) {
  if (!liveIn(object) || !object.layers.test(camera.layers)) return false;
  if (object.frustumCulled && !(object.isSprite ? frustum.intersectsSprite(object) : frustum.intersectsObject(object))) return false;
  return !!object.material && object.material.visible !== false;
}
function titleCompileSupported(object, material = object.material) {
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
function titleAvatarShadowJob() {
  if (BOOT_SAFE || !SHADOW.rt || INDOOR.on || !crowdHuman?.mesh) return null;
  const source = crowdHuman.mesh;
  const matches = SHADOW.proxies.filter(object => object.userData.src === source);
  if (matches.length !== 1) return null;
  const object = matches[0], material = object.material;
  if (!titleCompileSupported(object) || object.parent !== SHADOW.scene || object.geometry !== source.geometry
    || material.fragmentShader !== DEPTH_FS || material.colorWrite !== false || material.side !== THREE.DoubleSide
    || material.transparent || !material.depthTest || !material.depthWrite || material.uniforms !== source.material.uniforms) return null;
  return { family: 'avatar-shadow', object, material, geometry: object.geometry, cost: 1, avatarShadow: true,
    target: SHADOW.rt, camera: SHADOW.cam, targetScene: SHADOW.scene };
}

// These are the original first-world resources, not substitute renderables.
// Preparation does not set instance counts, move the camera, simulate or draw.
function titleEntryJobs(inventory, receipt, weatherResources) {
  const jobs = [], checks = [], allowed = new Set(inventory.renderables);
  const shadowScene = SHADOW.scene, shadowCamera = SHADOW.cam, shadowTarget = SHADOW.rt;
  const add = (family, object, material, target, targetCamera, targetScene, postDependency = false) => {
    jobs.push({ family, object, material, geometry: object.geometry, target, camera: targetCamera, targetScene,
      postDependency, dependency: true, version: material.version, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader,
      side: material.side, transparent: material.transparent, forceSinglePass: material.forceSinglePass,
      cost: material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1 });
    const familyReceipt = receipt.families[family] ||= { jobs: 0, prepared: 0, programs: 0 };
    familyReceipt.jobs++;
  };
  const sceneSupported = targetScene => targetScene.overrideMaterial === null
    && targetScene.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && targetScene.onAfterRender === THREE.Object3D.prototype.onAfterRender;
  if (shadowTarget && !INDOOR.on && sceneSupported(shadowScene)) {
    for (const object of new Set(SHADOW.proxies)) {
      receipt.inventoryObjects++;
      const source = object.userData.src, material = object.material, geometry = object.geometry;
      if (!source || !allowed.has(source) || !liveIn(source) || !titleCompileSupported(source)
        || !material?.isShaderMaterial || !titleCompileSupported(object) || object.children.length
        || object.parent !== shadowScene || geometry !== source.geometry || material.visible === false
        || material.colorWrite !== false || material.transparent || !material.depthTest || !material.depthWrite
        || !object.layers.test(shadowCamera.layers)) { receipt.skipped++; continue; }
      const sourceMaterial = source.material, ancestry = [];
      for (let node = source; node !== scene; node = node.parent) ancestry.push([node, node.parent]);
      checks.push(() => SHADOW.rt === shadowTarget && SHADOW.scene === shadowScene && SHADOW.cam === shadowCamera
        && !INDOOR.on && sceneSupported(shadowScene) && SHADOW.proxies.includes(object)
        && object.parent === shadowScene && object.children.length === 0 && object.userData.src === source
        && object.geometry === geometry && source.geometry === geometry && object.material === material
        && source.material === sourceMaterial && titleCompileSupported(source)
        && ancestry.every(([node, parent]) => node.parent === parent && node.visible)
        && material.colorWrite === false && !material.transparent && material.depthTest && material.depthWrite
        && object.layers.test(shadowCamera.layers));
      add('entry-shadow', object, material, shadowTarget, shadowCamera, shadowScene);
    }
  }
  const originalMaterial = fsMesh.material, geometry = fsMesh.geometry;
  const fsOwned = () => fsMesh.parent === fsScene && fsScene.children.length === 1 && fsScene.children[0] === fsMesh
    && fsMesh.children.length === 0 && fsMesh.geometry === geometry && geometry === fsTriGeo
    && fsMesh.material === originalMaterial && fsMesh.visible && fsScene.visible && !fsMesh.frustumCulled
    && fsMesh.layers.test(fsCam.layers) && sceneSupported(fsScene);
  if (!Array.isArray(weatherResources)) throw new Error('First-view preparation requires owned weather resources.');
  if (weatherResources.length) {
    const weatherQuality = quality.level, q = WXR.q;
    const bindings = { 'weather-field': ['fieldMat', 'field'], 'weather-dome': ['domeMat', 'dome'], 'weather-screen': ['scrMat', 'scr'] };
    const ids = new Set();
    for (const { id, material, target } of weatherResources) {
      receipt.inventoryObjects++;
      const binding = bindings[id];
      if (!binding || ids.has(id) || !WXR.on || !fsOwned() || !target?.isWebGLRenderTarget
        || WXR[binding[0]] !== material || WXR[binding[1]] !== target)
        throw new Error('First-view preparation received an unowned weather resource.');
      ids.add(id);
      if (!material?.isShaderMaterial || !titleCompileSupported(fsMesh, material) || material.visible === false) { receipt.skipped++; continue; }
      checks.push(() => WXR.on && WXR.q === q && quality.level === weatherQuality && fsOwned()
        && WXR[binding[0]] === material && WXR[binding[1]] === target);
      add(id, fsMesh, material, target, fsCam, fsScene, true);
    }
  }
  // Only the observed ordinary first-frame effects are admitted here. Their
  // original allocators run before this API; no pass, counters or uniforms run.
  const addPass = (id, material, target, current) => {
    if (!material || !target) return;
    receipt.inventoryObjects++;
    if (!fsOwned() || !material.isShaderMaterial || !target.isWebGLRenderTarget
      || !titleCompileSupported(fsMesh, material) || material.visible === false) { receipt.skipped++; return; }
    checks.push(() => fsOwned() && current());
    add(id, fsMesh, material, target, fsCam, fsScene, true);
  };
  const rippleA = RIPPLE.rtA, rippleB = RIPPLE.rtB, rippleRes = RIPPLE.res;
  const rippleCurrent = () => RIPPLE.rtA === rippleA && RIPPLE.rtB === rippleB && RIPPLE.res === rippleRes;
  if (rippleA && rippleB && !INDOOR.on) {
    addPass('entry-ripple-clear', rippleClearMat, rippleA, () => rippleCurrent() && !INDOOR.on);
    addPass('entry-ripple-sim', rippleSimMat, rippleB, () => rippleCurrent() && !INDOOR.on);
  }
  const trailTarget = trailB;
  addPass('entry-trail', trailMat, trailTarget, () => trailB === trailTarget);
  if (decalMesh && decalRT && decalMesh.parent === decalScene && decalScene.children.length === 1
    && decalScene.children[0] === decalMesh && decalMesh.children.length === 0 && sceneSupported(decalScene)
    && decalMesh.geometry === decalGeo && decalMesh.material === decalMat && decalMesh.visible
    && !decalMesh.frustumCulled && decalMesh.layers.test(fsCam.layers) && titleCompileSupported(decalMesh)) {
    receipt.inventoryObjects++;
    checks.push(() => decalMesh.parent === decalScene && decalScene.children.length === 1 && decalScene.children[0] === decalMesh
      && decalMesh.children.length === 0 && decalMesh.geometry === decalGeo && decalMesh.material === decalMat
      && decalMesh.visible && !decalMesh.frustumCulled && decalMesh.layers.test(fsCam.layers) && sceneSupported(decalScene));
    add('entry-decal', decalMesh, decalMat, decalRT, fsCam, decalScene);
  }
  const addWorld = (id, object, owned, allocatedInvisible = false) => {
    if (!object) return;
    receipt.inventoryObjects++;
    const material = object.material, geometry = object.geometry, ancestry = [], target = sceneRT, visible = object.visible;
    if (!owned() || !(allocatedInvisible ? object.parent && liveIn(object.parent) : liveIn(object)) || object.children.length || !titleCompileSupported(object) || material.visible === false
      || !object.layers.test(camera.layers) || !sceneSupported(scene)) { receipt.skipped++; return; }
    for (let node = object; node !== scene; node = node.parent) ancestry.push([node, node.parent]);
    checks.push(() => owned() && sceneRT === target && object.material === material && object.geometry === geometry
      && object.children.length === 0 && object.layers.test(camera.layers) && sceneSupported(scene)
      && ancestry.every(([node, parent]) => node.parent === parent && (allocatedInvisible && node === object ? node.visible === visible : node.visible)));
    add(id, object, material, target, camera, scene);
  };
  const shaft = WXR.shafts;
  if (WXR.on && !INDOOR.on && shaft) addWorld('entry-weather-shafts', shaft, () => WXR.on && !INDOOR.on && WXR.shafts === shaft, true);
  if (houseGlassMat) for (const owner of new Set(HOUSES.map(house => house.S.houseSet).filter(Boolean))) {
    const object = owner.mGl, material = object?.material;
    const owned = () => allowed.has(object) && HOUSES.some(house => house.S.houseSet === owner) && owner.mGl === object
      && object.material === material && !Array.isArray(material) && material.vertexShader === houseGlassMat.vertexShader
      && material.fragmentShader === houseGlassMat.fragmentShader && material.uniforms.uHA === owner.TU.uHA && material.uniforms.uHL === owner.TU.uHL;
    if (material && owned()) addWorld('entry-house-glass', object, owned);
  }
  return { jobs, current: () => checks.every(check => check()) && jobs.every(job => titleCompileSupported(job.object, job.material)
    && job.material.visible !== false && job.material.version === job.version
    && job.material.vertexShader === job.vertexShader && job.material.fragmentShader === job.fragmentShader
    && job.material.side === job.side && job.material.transparent === job.transparent && job.material.forceSinglePass === job.forceSinglePass) };
}

// Prepare only the resources that the next real post/sky
// submission will use. It never executes a post pass or creates a renderable.
function titleDependencyJobs(id, inventory, receipt) {
  const jobs = [], originalTarget = sceneRT;
  const add = (family, object, material, target, targetCamera, targetScene, postDependency = false) => {
    receipt.inventoryObjects++;
    if (!material?.isShaderMaterial || !titleCompileSupported(object, material) || material.visible === false) { receipt.skipped++; return; }
    jobs.push({ family, object, material, geometry: object.geometry, target, camera: targetCamera, targetScene,
      postDependency, dependency: true, version: material.version, vertexShader: material.vertexShader, fragmentShader: material.fragmentShader,
      side: material.side, transparent: material.transparent, forceSinglePass: material.forceSinglePass,
      cost: material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1 });
    receipt.families[family] = { jobs: 1, prepared: 0, programs: 0 };
  };
  const materialsCurrent = () => jobs.every(job => titleCompileSupported(job.object, job.material)
    && job.material.visible !== false && job.material.version === job.version
    && job.material.vertexShader === job.vertexShader && job.material.fragmentShader === job.fragmentShader
    && job.material.side === job.side && job.material.transparent === job.transparent && job.material.forceSinglePass === job.forceSinglePass);
  if (id === 'sky') {
    if (!inventory.renderables.includes(skyMesh) || !inventory.sets.sky.has(skyMesh)) throw new Error('Title sky preparation received an unowned renderable.');
    const geometry = skyMesh.geometry, material = skyMesh.material;
    // groupOutdoors places the original sky under this one owned group. Keep
    // that exact ancestry, rather than accepting any group rooted in the scene.
    const parent = skyMesh.parent, outdoor = parent === INDOOR.outdoor && parent?.parent === scene ? parent : null;
    const ownedPath = () => skyMesh.parent === parent && (parent === scene
      || (outdoor !== null && parent === outdoor && INDOOR.outdoor === outdoor && outdoor.parent === scene));
    const owned = () => ownedPath() && skyMesh.children.length === 0 && skyMesh.geometry === geometry
      && geometry === fsTriGeo && skyMesh.material === material && titleCompileEligible(skyMesh)
      && titleCompileSupported(skyMesh) && scene.overrideMaterial === null
      && scene.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
      && scene.onAfterRender === THREE.Object3D.prototype.onAfterRender;
    if (owned()) add('sky', skyMesh, material, originalTarget, camera, scene);
    return { jobs, current: () => sceneRT === originalTarget && materialsCurrent() && (!jobs.length || owned()) };
  }
  const originalMaterial = fsMesh.material, geometry = fsMesh.geometry;
  const targets = bloomRTs.slice(), rayTarget = raysRT;
  const owned = () => fsMesh.parent === fsScene && fsScene.children.length === 1 && fsScene.children[0] === fsMesh
    && fsMesh.children.length === 0 && fsMesh.geometry === geometry && geometry === fsTriGeo
    && fsMesh.material === originalMaterial && fsMesh.visible && fsScene.visible && !fsMesh.frustumCulled
    && fsMesh.layers.test(fsCam.layers) && fsScene.overrideMaterial === null
    && fsScene.onBeforeRender === THREE.Object3D.prototype.onBeforeRender
    && fsScene.onAfterRender === THREE.Object3D.prototype.onAfterRender;
  if (!owned()) { receipt.skipped++; return { jobs, current: () => true }; }
  if (targets.length) add('post-down', fsMesh, bloomDown, targets[0], fsCam, fsScene, true);
  if (targets.length > 1) add('post-up', fsMesh, bloomUp, targets[targets.length - 2], fsCam, fsScene, true);
  // updateRays is the draw's exact conditional selector. Its scratch vectors
  // and every changed uniform are restored synchronously, including on throw.
  const rayUniforms = raysMat.uniforms, postUniform = composite.uniforms.uRays;
  const sun = rayUniforms.uSun.value, color = rayUniforms.uCol.value;
  const saved = { rays: postUniform.value, sun: sun.clone(), color: color.clone(), aspect: rayUniforms.uAspect.value,
    ndc: _sunNdc.clone(), direction: _camDir.clone() };
  let rays = false;
  try { rays = updateRays() === true; }
  finally {
    postUniform.value = saved.rays;
    rayUniforms.uSun.value = sun; sun.copy(saved.sun);
    rayUniforms.uCol.value = color; color.copy(saved.color);
    rayUniforms.uAspect.value = saved.aspect;
    _sunNdc.copy(saved.ndc); _camDir.copy(saved.direction);
  }
  if (rays) add('post-rays', fsMesh, raysMat, rayTarget, fsCam, fsScene, true);
  add('post-composite', fsMesh, composite, null, fsCam, fsScene, true);
  const selection = () => [quality.level, INDOOR.on, skyU.uSunVis.value, skyU.uMoonVis.value,
    ...skyU.uSunDir.value.toArray(), ...skyU.uMoonDir.value.toArray(),
    ...camera.matrixWorld.elements, ...camera.projectionMatrix.elements];
  const originalSelection = selection();
  return { jobs, current: () => owned() && materialsCurrent() && sceneRT === originalTarget && raysRT === rayTarget
    && bloomRTs.length === targets.length && targets.every((target, index) => bloomRTs[index] === target)
    && selection().every((value, index) => value === originalSelection[index]) };
}

function prepareTitlePrograms(inventory, stages, generation) {
  return prepareTitleProgramJobs(inventory, stages, generation);
}
async function prepareTitleDependencies(id, inventory, generation) {
  if (id !== 'post' && id !== 'sky') throw new Error('Unknown title preparation dependency.');
  return prepareTitleProgramJobs(inventory, [], generation, id);
}
function prepareTitleEntryPrograms(inventory, generation, weatherResources) {
  return prepareTitleProgramJobs(inventory, [], generation, 'entry', weatherResources);
}

async function prepareTitleProgramJobs(inventory, stages, generation, dependencyId = null, weatherResources = null) {
  const started = performance.now();
  const receipt = { generation, dependency: dependencyId, errorPolicy: 'drained-waves', supported: false, outcome: 'serial', completed: false, stale: false,
    eligibleJobs: 0, preparedJobs: 0, skipped: 0, newPrograms: 0, maxPending: 0, maxPreparesPerTurn: 0,
    prepareMs: 0, maxSinglePrepareMs: 0, slowestPrepare: null, maxFullTurnMs: 0, budgetYields: 0, waves: 0, maxWavePrograms: 0,
    inventoryMs: 0, inventoryObjects: 0, maxInventoryCheckMs: 0, slowestInventory: null,
    flushMs: 0, maxFlushMs: 0, pollMs: 0, maxPollMs: 0,
    errorCheckMs: 0, maxErrorCheckMs: 0, elapsedMs: 0, visibleMs: 0, hiddenMs: 0, disposed: 0, families: {} };
  const history = GRAPHICS_STARTUP.titlePreparations ||= [];
  history.push(receipt);
  if (history.length > 8) history.shift();
  if (BOOT_SAFE || !renderer.extensions?.has?.('KHR_parallel_shader_compile')) return receipt;
  receipt.supported = true;
  GRAPHICS_STARTUP.titlePreparing = true;
  const message = document.getElementById?.('loadmsg');
  if (message) message.textContent = 'Preparing the first view';
  const pending = new Map(), initialTarget = sceneRT;
  let timer = null, wake = null, lost = false, stale = false, avatarJob = null, dependencies = null;
  let clockAt = started, visibleMs = 0, wasHidden = !!document.hidden;
  // Driver work may be throttled in a background tab. Spend deadlines only
  // while visible; context loss and genuine GL/link failures remain fatal.
  const visibleElapsed = () => {
    const now = performance.now(), hiddenNow = !!document.hidden;
    // A delayed visibility event must not charge a background interval as
    // foreground work. Treat intervals touching a hidden observation as hidden.
    if (!wasHidden && !hiddenNow) visibleMs += Math.max(0, now - clockAt);
    clockAt = now; wasHidden = hiddenNow;
    return visibleMs;
  };
  const invalidate = reason => { stale = true; receipt.reason ||= reason; resume(); };
  const resume = () => {
    if (timer !== null) clearTimeout(timer);
    timer = null;
    if (wake) { const resolve = wake; wake = null; resolve(); }
  };
  const hidden = () => { visibleElapsed(); if (document.hidden) invalidate('visibility'); else resume(); };
  const resized = () => invalidate('resize');
  const contextLost = () => { lost = true; resume(); };
  const active = () => {
    if (lost) throw new Error('Graphics stopped while preparing title programs.');
    titleAssertActive();
  };
  const changed = () => {
    visibleElapsed();
    if (document.hidden) invalidate('visibility');
    if (TITLE_RESIZE_PENDING || resizeTimer || sceneRT !== initialTarget) invalidate('resize');
    if (avatarJob && (SHADOW.rt !== avatarJob.target || INDOOR.on)) invalidate('avatar-shadow');
    if (dependencies && !dependencies.current()) invalidate('dependencies');
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
    const jobs = [], inventoryStarted = performance.now();
    try {
      if (dependencyId) {
        dependencies = dependencyId === 'entry' ? titleEntryJobs(inventory, receipt, weatherResources) : titleDependencyJobs(dependencyId, inventory, receipt);
        jobs.push(...dependencies.jobs);
      } else {
      const allowed = new Set(inventory.renderables), seen = new Set();
      const priority = id => id === 'terrain' ? 0 : id === 'structures' ? 1 : id === 'crowds-1' ? 2 : 3;
      const ordered = stages.map(([id, members], index) => ({ id, members, index }))
        .filter(stage => stage.id !== 'post' && stage.id !== 'sky')
        .sort((a, b) => priority(a.id) - priority(b.id) || a.index - b.index);
      for (const { id, members } of ordered) for (const object of members) {
        if (!allowed.has(object)) throw new Error('Title program preparation received an unowned renderable.');
        if (seen.has(object)) continue;
        seen.add(object);
        const checkStarted = performance.now();
        let supported, eligible;
        try { supported = titleCompileSupported(object); eligible = supported && titleCompileEligible(object); }
        finally {
          const checked = performance.now() - checkStarted;
          receipt.inventoryObjects++;
          if (checked > receipt.maxInventoryCheckMs) {
            receipt.maxInventoryCheckMs = checked;
            receipt.slowestInventory = { family: id, objectId: object.id, materialId: object.material?.id ?? null, ms: checked };
          }
        }
        if (!supported) { receipt.skipped++; continue; }
        if (!eligible) continue;
        const material = object.material;
        jobs.push({ family: id, object, material, geometry: object.geometry, target: initialTarget, camera, targetScene: scene,
          cost: material.transparent && material.side === THREE.DoubleSide && !material.forceSinglePass ? 2 : 1 });
        const family = receipt.families[id] ||= { jobs: 0, prepared: 0, programs: 0 };
        family.jobs++;
      }
      avatarJob = titleAvatarShadowJob();
      if (avatarJob) {
        const human = jobs.findIndex(job => job.family === 'crowds-1');
        jobs.splice(human < 0 ? 0 : human, 0, avatarJob);
        receipt.families['avatar-shadow'] = { jobs: 1, prepared: 0, programs: 0 };
      }
      }
    } finally {
      receipt.inventoryMs = performance.now() - inventoryStarted;
    }
    receipt.avatarShadowQueued = !!avatarJob;
    receipt.eligibleJobs = jobs.length;
    let index = 0, wavePrograms = 0, waveStarted = false, waveSealed = false;
    while (index < jobs.length || pending.size || waveStarted) {
      const turnStarted = performance.now();
      let shouldPause = false;
      try {
        active(); changed();
        const pollStarted = performance.now();
        for (const [program, job] of pending) {
          active();
          if (!program.program) {
            if (!stale) throw new Error('A required title program was disposed before completion.');
            receipt.disposed++; pending.delete(program); continue;
          }
          // Check availability before visible-time deadlines. Context loss
          // reports KHR completion=true, so reject it before accepting a result.
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
        const visibleNow = visibleElapsed();
        for (const job of pending.values()) if (visibleNow - job.queuedVisibleMs >= TITLE_COMPILE_LIMITS.programMs) throw new Error('Title program preparation timed out.');
        if (stale || index === jobs.length) waveSealed = true;
        if (!pending.size && (!waveStarted || waveSealed)) {
          // Observe queued GL errors before another wave adds driver work.
          errors();
          if (stale) { receipt.outcome = 'stale'; receipt.stale = true; return receipt; }
          if (index === jobs.length) break;
          wavePrograms = 0; waveStarted = false; waveSealed = false;
        }
        if (visibleNow >= TITLE_COMPILE_LIMITS.totalMs) throw new Error('Title program preparation exceeded its time budget.');
        let prepared = 0;
        // Cache hits do not consume a wave's program capacity. Fill across
        // bounded turns, counting even completed handles in this wave; partial
        // completion cannot free slots or permit a new wave before draining.
        while (!waveSealed && !stale && index < jobs.length && prepared < TITLE_COMPILE_LIMITS.perTurn) {
          const job = jobs[index];
          if (wavePrograms + job.cost > TITLE_COMPILE_LIMITS.pending) { waveSealed = true; break; }
          active(); changed();
          if (stale) break;
          const eligible = job.dependency ? dependencies.current() && titleCompileSupported(job.object, job.material)
            && job.material.visible !== false && job.material.version === job.version
            : job.avatarShadow ? SHADOW.rt === job.target && !INDOOR.on && job.object.parent === job.targetScene && job.object.userData.src === crowdHuman.mesh : titleCompileEligible(job.object);
          if (!eligible || job.object.geometry !== job.geometry || (!job.postDependency && job.object.material !== job.material)) { invalidate('inventory'); break; }
          const before = new Set(renderer.info.programs), saved = gpuDiagCaptureRenderer(), side = job.material.side, originalMaterial = job.object.material;
          const queuedAt = performance.now(), queuedVisibleMs = visibleElapsed();
          // Flat original leaves preserve the renderer's real flags and cache keys.
          const collection = { traverse: visit => visit(job.object), traverseVisible: visit => visit(job.object) };
          let compiled = false;
          try {
            try {
              if (job.postDependency) job.object.material = job.material;
              renderer.setRenderTarget(job.target);
              renderer.compile(job.dependency ? job.object : collection, job.camera, job.targetScene);
              compiled = true;
            } finally {
              job.material.side = side;
              if (job.postDependency) job.object.material = originalMaterial;
              if (compiled && job.dependency) job.version = job.material.version;
              // A failed r160 compile can leave its render-state stack dirty.
              // Restore CPU values only, then fail without retrying that renderer.
              gpuDiagRestoreRenderer(saved, compiled && !lost);
            }
          } finally {
            const single = performance.now() - queuedAt;
            receipt.prepareMs += single;
            if (single > receipt.maxSinglePrepareMs) {
              receipt.maxSinglePrepareMs = single;
              receipt.slowestPrepare = { family: job.family, objectId: job.object.id, materialId: job.material.id, geometryId: job.geometry.id, ms: single };
            }
          }
          active();
          const added = renderer.info.programs.filter(program => !before.has(program));
          if (added.length > job.cost) throw new Error('Title compilation exceeded its reserved program window.');
          for (const program of added) pending.set(program, { queuedVisibleMs, family: job.family });
          wavePrograms += added.length;
          receipt.maxWavePrograms = Math.max(receipt.maxWavePrograms, wavePrograms);
          receipt.newPrograms += added.length;
          receipt.families[job.family].prepared++;
          receipt.families[job.family].programs += added.length;
          index++; prepared++; receipt.preparedJobs++;
          receipt.maxPending = Math.max(receipt.maxPending, pending.size);
          if (wavePrograms === TITLE_COMPILE_LIMITS.pending || index === jobs.length) waveSealed = true;
          // JavaScript cannot preempt one synchronous driver call. Yield before
          // starting another once this turn has spent its elapsed-time budget.
          if (performance.now() - turnStarted >= TITLE_COMPILE_LIMITS.turnMs) { receipt.budgetYields++; break; }
        }
        receipt.maxPreparesPerTurn = Math.max(receipt.maxPreparesPerTurn, prepared);
        if (prepared) {
          if (!waveStarted) { receipt.waves++; waveStarted = true; }
          active(); const flushStarted = performance.now(); gl.flush();
          const flushed = performance.now() - flushStarted;
          receipt.flushMs += flushed; receipt.maxFlushMs = Math.max(receipt.maxFlushMs, flushed);
          active();
          if (!pending.size) errors();
        }
        shouldPause = index < jobs.length || pending.size;
      } finally {
        receipt.maxFullTurnMs = Math.max(receipt.maxFullTurnMs, performance.now() - turnStarted);
      }
      if (shouldPause) await pause();
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
    receipt.visibleMs = Math.round(visibleElapsed());
    receipt.elapsedMs = Math.round(performance.now() - started);
    receipt.hiddenMs = Math.max(0, receipt.elapsedMs - receipt.visibleMs);
  }
}
