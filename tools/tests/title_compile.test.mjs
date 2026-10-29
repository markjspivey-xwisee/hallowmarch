import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { WebGLPrograms } from '../node_modules/three/src/renderers/webgl/WebGLPrograms.js';

const root = new URL('../../', import.meta.url);
const source = readFileSync(new URL('src/13o_title_compile.js', root), 'utf8');
const originalRender = readFileSync(new URL('src/02_render.js', root), 'utf8');
// Small shader/attribute fixture exercises real r160 cache parameters without
// compiling GLSL or retaining the large native capture in CI. Native evidence
// separately pins the exact humanVS(true) bytes and actual cached first draw.
const avatarFixture = {
  vertexShader: 'attribute vec4 iPos; void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position + iPos.xyz, 1.0); }',
  fragmentShader: originalRender.match(/const DEPTH_FS = \/\* glsl \*\/`([^`]+)`;/)[1],
  geometry: { attributes: ['position', 'normal', 'aBone', 'aW', 'aMat', 'aBit', 'aUV', 'aAO', 'iPos', 'iAnim', 'iColA', 'iColB', 'iMisc', 'iStyle', 'iWear'] },
  sourceMaterial: { vertexShader: 'void main(){ gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }', fragmentShader: 'void main(){ gl_FragColor = vec4(1.0); }' },
};
const rendererSource = readFileSync(new URL('../node_modules/three/src/renderers/WebGLRenderer.js', import.meta.url), 'utf8');
// Use the installed renderer's real compile/prepareMaterial traversal and sided
// behavior. Only the GL program factory is replaced by a controllable fixture.
const actualConstructors = originalRender.slice(originalRender.indexOf('function shadowCaster('), originalRender.indexOf('// [perf2]', originalRender.indexOf('function shadowCaster('))) + originalRender.slice(originalRender.indexOf('function depthFrom('), originalRender.indexOf('function liveIn('));
const compile = rendererSource.slice(rendererSource.indexOf('\t\tfunction prepareMaterial('), rendererSource.indexOf('\t\t// compileAsync'));
function target() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...(listeners.get(name) || [])]) fn({}); },
    listenerCount: () => [...listeners.values()].reduce((n, set) => n + set.size, 0) };
}
function fixture({ safe = false, supported = true, count = 20, readyDelay = 25, failure = '', avatar = false, compileMs = 0, flushMs = 0, inventoryCheckMs = 0 } = {}) {
  let now = 0, timerId = 0, currentTarget, lost = false, randomCalls = 0;
  const timers = new Map(), document = { hidden: false, ...target() }, window = target(), canvas = target();
  const scene = new THREE.Scene(), sceneRT = {}, originalTarget = currentTarget = {};
  const calls = [], queries = [], programs = [], known = new Map(), restores = [], glErrors = [], flushes = [], errorChecks = [];
  const renderState = { init() {}, pushLight() {}, pushShadow() {}, setupLights() {} };
  const renderer = { info: { programs }, extensions: { has: () => supported }, _useLegacyLights: false,
    setRenderTarget(value) { assert(!lost); currentTarget = value; } };
  const SHADOW = { scene: new THREE.Scene(), cam: new THREE.OrthographicCamera(-100,100,100,-100,0.1,600), rt: avatar ? new THREE.WebGLRenderTarget(1536,1536) : null, proxies: [] };
  const INDOOR = { on: false }, crowdHuman = { mesh: null };
  const ctx = { SHADOW, INDOOR, crowdHuman, DEPTH_FS: avatarFixture.fragmentShader, THREE, scene, sceneRT, renderer, document, window, canvas, BOOT_SAFE: safe,
    GRAPHICS_STARTUP: { stopped: false }, GRAPHICS_CONTEXT_LOST: false, GAME: { started: false },
    TITLE_RESIZE_PENDING: false, resizeTimer: 0, TITLE_WARM_GENERATION: 1,
    performance: { now: () => now }, camera: new THREE.PerspectiveCamera(),
    frustum: { intersectsObject: object => { now += inventoryCheckMs; return !object.userData.offscreen; }, intersectsSprite: object => { now += inventoryCheckMs; return !object.userData.offscreen; } },
    Math: Object.assign(Object.create(Math), { random() { randomCalls++; return 0.5; } }),
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    liveIn(object) { for (let q = object; q; q = q.parent) { if (!q.visible) return false; if (q === scene) return true; } return false; },
    titleAssertActive() { if (ctx.GRAPHICS_CONTEXT_LOST || lost || ctx.GRAPHICS_STARTUP.stopped) throw Error('context lost or stopped'); },
    gpuDiagCaptureRenderer: () => ({ target: currentTarget }),
    gpuDiagRestoreRenderer(saved, restoreGl) { restores.push(restoreGl); if (restoreGl && !lost) currentTarget = saved.target; },
    gpuDiagGlErrors: () => {
      errorChecks.push({ calls: calls.length, pending: programs.filter(program => program.program && !ctx.forceComplete && now < program.readyAt).length });
      return glErrors.shift() || [];
    },
    gl: { LINK_STATUS: 35714, isContextLost: () => lost, flush() { assert(!lost); flushes.push(now); now += flushMs; if (failure === 'flushGL') glErrors.push(['0x0502']); },
      getProgramParameter(program) { assert(!lost); queries.push(program); return failure !== 'link'; } },
    renderStates: { get: () => renderState }, renderStateStack: [], currentRenderState: null, _this: renderer,
    BackSide: THREE.BackSide, FrontSide: THREE.FrontSide, DoubleSide: THREE.DoubleSide,
    getProgram(material, targetScene, object) {
      assert([scene, SHADOW.scene].includes(targetScene)); assert.equal(currentTarget, targetScene === SHADOW.scene ? SHADOW.rt : sceneRT); assert(!lost);
      calls.push({ material, object, geometry: object.geometry, side: material.side, targetScene, target: currentTarget });
      if (failure === 'throw') throw Error('controlled compile failure');
      const key = material.id + ':' + material.side + ':' + !!object.isInstancedMesh + ':' + !!object.instanceColor;
      if (!known.has(key)) {
        const program = { id: programs.length, program: {}, readyAt: now + readyDelay, isReady() { assert(!lost); return ctx.forceComplete || now >= program.readyAt; } };
        known.set(key, program); programs.push(program);
      }
      return known.get(key);
    },
  };
  vm.createContext(ctx);
  vm.runInContext('function install(){' + compile + '}\ninstall.call(renderer);\n' + actualConstructors + '\n' + source, ctx);
  const compileCalls = [], actualCompile = renderer.compile; renderer.compile = function(collection, camera, targetScene) { compileCalls.push({ collection, camera, targetScene, target: currentTarget }); now += compileMs; return actualCompile.call(this, collection, camera, targetScene); };
  const objects = [];
  for (let i = 0; i < count; i++) {
    const geometry = new THREE.BufferGeometry(), material = new THREE.ShaderMaterial({ transparent: i % 4 === 0,
      side: i % 4 === 0 ? THREE.DoubleSide : THREE.FrontSide, forceSinglePass: false });
    const object = i === 3 ? new THREE.InstancedMesh(geometry, material, 1) : new THREE.Mesh(geometry, material);
    if (i === 3) object.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(3), 3);
    scene.add(object); objects.push(object);
  }
  const hiddenParent = new THREE.Group(); hiddenParent.visible = false; scene.add(hiddenParent);
  const hidden = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); hiddenParent.add(hidden);
  const offscreen = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); offscreen.userData.offscreen = true; scene.add(offscreen);
  const wrongLayer = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); wrongLayer.layers.set(3); scene.add(wrongLayer);
  const parent = new THREE.Group(); parent.layers.set(4); scene.add(parent);
  const child = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); parent.add(child);
  const array = new THREE.Mesh(new THREE.BufferGeometry(), [new THREE.ShaderMaterial(), new THREE.ShaderMaterial()]); scene.add(array);
  const hooked = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); hooked.onBeforeRender = () => { throw Error('must not call render hook'); }; scene.add(hooked);
  const cacheHook = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); cacheHook.material.customProgramCacheKey = () => 'custom'; scene.add(cacheHook);
  const extras = count > 1 ? [hidden, offscreen, wrongLayer, child, array, hooked, cacheHook] : [];
  const all = [...objects, ...extras], stages = [['post', new Set()], ['sky', new Set()],
    ['terrain', new Set(all.slice(0, 5))], ['structures', new Set(all.slice(5, 12))], ['crowds-1', new Set(all.slice(12, 13))], ['other', new Set(all.slice(13))]];
  const inventory = { renderables: all };
  const avatarGeometry = new THREE.InstancedBufferGeometry();
  for(const name of avatarFixture.geometry.attributes) avatarGeometry.setAttribute(name, new THREE.InstancedBufferAttribute(new Float32Array(3), 3));
  avatarGeometry.instanceCount = 6;
  const avatarMaterial = new THREE.ShaderMaterial({ vertexShader: avatarFixture.sourceMaterial.vertexShader, fragmentShader: avatarFixture.sourceMaterial.fragmentShader });
  const avatarSource = new THREE.Mesh(avatarGeometry, avatarMaterial); scene.add(avatarSource); crowdHuman.mesh = avatarSource;
  const depth = ctx.depthFrom(avatarMaterial, avatarFixture.fragmentShader, avatarFixture.vertexShader);
  const avatarProxy = ctx.shadowCaster(avatarSource, depth);
  // Decoys make an accidental full material traversal observable. Stock light scanning is left intact.
  const shadowDecoy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); SHADOW.scene.add(shadowDecoy);
  const hiddenShadowDecoy = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.ShaderMaterial()); hiddenShadowDecoy.visible=false; SHADOW.scene.add(hiddenShadowDecoy);
  const f = { SHADOW, INDOOR, crowdHuman, avatarSource, avatarProxy, shadowDecoy, hiddenShadowDecoy, compileCalls, ctx, calls, queries, programs, timers, objects, all, hidden, offscreen, wrongLayer, child, array, hooked, cacheHook, inventory, stages, restores, glErrors, flushes, errorChecks,
    run: () => ctx.prepareTitlePrograms(inventory, stages, ctx.TITLE_WARM_GENERATION),
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async timer(lateBy = 0) {
      const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0] || [];
      assert(timer, 'one bounded scheduled poll'); timers.delete(id); now = timer.due + lateBy; timer.fn(); await this.flush();
    },
    async finish(promise) {
      let done = false, value, error; promise.then(v => { done = true; value = v; }, e => { done = true; error = e; });
      for (let i = 0; i < 1000 && !done; i++) { await this.flush(); if (!done) await this.timer(); }
      assert(done, 'preparation terminates'); if (error) throw error; return value;
    },
    lose() { lost = true; ctx.GRAPHICS_CONTEXT_LOST = true; canvas.emit('webglcontextlost'); },
    clean() { assert.equal(timers.size, 0); assert.equal(document.listenerCount() + window.listenerCount() + canvas.listenerCount(), 0); },
    currentTarget: () => currentTarget, originalTarget, randomCalls: () => randomCalls,
  };
  return f;
}

test('bounded preparation uses exact original leaves/flags and restores sides and target without randomness', async () => {
  const f = fixture(), parents = f.all.map(object => object.parent), sides = f.objects.map(object => object.material.side);
  const receipt = await f.finish(f.run());
  assert.equal(receipt.completed, true); assert.equal(receipt.outcome, 'completed');
  assert(receipt.maxPending <= 8 && receipt.maxPending > 1); assert(receipt.maxPreparesPerTurn <= 4);
  assert(f.calls.every(call => f.all.includes(call.object) && call.geometry === call.object.geometry));
  for (const object of [f.hidden, f.offscreen, f.wrongLayer, f.array, f.hooked, f.cacheHook]) assert(!f.calls.some(call => call.object === object));
  assert(f.calls.some(call => call.object === f.child), 'parent layer mismatch does not hide child');
  assert(f.calls.some(call => call.object.isInstancedMesh && call.object.instanceColor));
  assert.deepEqual(f.calls.filter(call => call.object === f.objects[0]).map(call => call.side), [THREE.BackSide, THREE.FrontSide]);
  assert.deepEqual(f.all.map(object => object.parent), parents); assert.deepEqual(f.objects.map(object => object.material.side), sides);
  assert.equal(f.currentTarget(), f.originalTarget); assert.equal(f.randomCalls(), 0);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations[0], receipt); assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparing, false); f.clean();
  assert.equal(receipt.errorPolicy, 'queue-boundaries'); assert.equal(f.errorChecks.length, 2);
  assert.deepEqual(f.errorChecks, [{ calls: 0, pending: 0 }, { calls: f.calls.length, pending: 0 }]);
});
test('recovery and absent parallel extension retain serial rendering without timers or preparation', async () => {
  for (const options of [{ safe: true }, { supported: false }]) {
    const f = fixture(options), receipt = await f.run(); assert.equal(receipt.supported, false); assert.equal(f.calls.length, 0); f.clean();
  }
});
test('zero eligible leaves completes preparation without compiling or claiming a frame', async () => {
  const f = fixture({ count: 1 }); f.objects[0].visible = false;
  const receipt = await f.run(); assert.equal(receipt.completed, true); assert.equal(receipt.eligibleJobs, 0);
  assert.equal(f.calls.length, 0); assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined); f.clean();
});
test('target replacement without a resize event drains old work before replanning', async () => {
  const f = fixture({ readyDelay: 50 }), promise = f.run(); await f.flush();
  const submitted = f.calls.length; f.ctx.sceneRT = {};
  const receipt = await f.finish(promise); assert.equal(receipt.stale, true); assert.equal(receipt.reason, 'resize');
  assert.equal(f.calls.length, submitted); f.clean();
});
for (const change of ['resize', 'hidden', 'generation']) test(change + ' stops new work and drains the bounded old window before returning stale', async () => {
  const f = fixture({ readyDelay: 50 }), promise = f.run(); await f.flush();
  const submitted = f.calls.length; assert(submitted > 0);
  if (change === 'resize') { f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize'); }
  if (change === 'hidden') { f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); }
  if (change === 'generation') f.ctx.TITLE_WARM_GENERATION++;
  const receipt = await f.finish(promise); assert.equal(receipt.stale, true); assert.equal(receipt.completed, false);
  assert.equal(f.calls.length, submitted); assert(f.queries.length > 0, 'already-submitted programs drained'); f.clean();
});
test('late complete poll succeeds before both elapsed deadlines are considered', async () => {
  const f = fixture({ count: 1, readyDelay: 1 }), promise = f.run(); await f.flush();
  await f.timer(200000); const receipt = await promise; assert.equal(receipt.completed, true); f.clean();
});
test('late pending poll times out without queueing another object', async () => {
  const f = fixture({ readyDelay: 1000000 }), promise = f.run(), rejected = assert.rejects(promise, /timed out/);
  await f.flush(); const submitted = f.calls.length; await f.timer(90000); await rejected; assert.equal(f.calls.length, submitted); f.clean();
});
test('a five-second synchronous prepare yields before another job and reports the unpreemptible call', async () => {
  const f = fixture({ count: 3, compileMs: 5000 }), promise = f.run(); await f.flush();
  assert.equal(f.compileCalls.length, 1, 'one slow call returns before the first poll/paint opportunity');
  const first = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert.equal(first.maxSinglePrepareMs, 5000); assert.equal(first.maxFullTurnMs, 5000);
  assert.equal(first.maxPreparesPerTurn, 1); assert.equal(first.budgetYields, 1);
  assert.equal(first.slowestPrepare.objectId, f.objects[0].id);
  const receipt = await f.finish(promise);
  assert.equal(receipt.completed, true); assert.equal(receipt.preparedJobs, receipt.eligibleJobs);
  assert(receipt.maxPending <= 8); assert.equal(receipt.maxPreparesPerTurn, 1); f.clean();
});
test('fast prepares retain the four-job/eight-program window while elapsed time can end a turn sooner', async () => {
  const fast = fixture({ compileMs: 1 }), fp = fast.run(); await fast.flush();
  assert.equal(fast.compileCalls.length, 4);
  const fr = await fast.finish(fp); assert(fr.maxPending <= 8); assert.equal(fr.maxPreparesPerTurn, 4); fast.clean();
  const slow = fixture({ count: 3, compileMs: 5 }), sp = slow.run(); await slow.flush();
  assert.equal(slow.compileCalls.length, 2);
  const sr = await slow.finish(sp); assert.equal(sr.maxFullTurnMs, 10); assert.equal(sr.maxSinglePrepareMs, 5); slow.clean();
});
test('full-turn telemetry includes a slow flush and excludes asynchronous poll waits', async () => {
  const flush = fixture({ count: 1, flushMs: 3000 }), fp = flush.run();
  const fr = await flush.finish(fp); assert.equal(fr.maxSinglePrepareMs, 0); assert.equal(fr.maxFlushMs, 3000);
  assert.equal(fr.maxFullTurnMs, 3000); flush.clean();
  const waiting = fixture({ count: 1, readyDelay: 50000 }), wp = waiting.run(); await waiting.flush();
  await waiting.timer(60000); const wr = await wp;
  assert(wr.elapsedMs >= 60000); assert.equal(wr.maxFullTurnMs, 0); waiting.clean();
});
test('inventory telemetry is bounded and separates expensive eligibility checks from preparation', async () => {
  const f = fixture({ count: 1, inventoryCheckMs: 13 }), receipt = await f.finish(f.run());
  assert.equal(receipt.inventoryObjects, 1); assert.equal(receipt.inventoryMs, 13);
  assert.equal(receipt.maxInventoryCheckMs, 13); assert.equal(receipt.slowestInventory.objectId, f.objects[0].id);
  assert.equal(receipt.maxSinglePrepareMs, 0); assert(receipt.maxFullTurnMs >= 13);
  assert.deepEqual(Object.keys(receipt.slowestInventory).sort(), ['family','materialId','ms','objectId']); f.clean();
});
test('an inventory failure retains its timing and clears preparation listeners without compiling', async () => {
  const f = fixture({ count: 1, inventoryCheckMs: 13 });
  Object.defineProperty(f.objects[0].userData, 'offscreen', { get() { throw Error('controlled inventory failure'); } });
  await assert.rejects(f.run(), /controlled inventory failure/);
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert.equal(receipt.inventoryMs, 13); assert.equal(receipt.maxInventoryCheckMs, 13);
  assert.equal(receipt.outcome, 'failed'); assert.equal(f.compileCalls.length, 0); f.clean();
});
for (const eventDelivered of [true, false]) test('background time beyond the program deadline is excluded, visibility event=' + eventDelivered, async () => {
  const f = fixture({ readyDelay: 1000000 }), promise = f.run(); let failed = false;
  promise.catch(() => { failed = true; }); await f.flush();
  const submitted = f.calls.length; f.ctx.document.hidden = true;
  if (eventDelivered) f.ctx.document.emit('visibilitychange');
  await f.flush(); await f.timer(120000);
  assert.equal(failed, false); assert.equal(f.calls.length, submitted);
  f.ctx.document.hidden = false; f.ctx.document.emit('visibilitychange'); await f.flush();
  await f.timer(); assert.equal(failed, false, 'returning to the foreground does not spend the hidden interval');
  const rejected = assert.rejects(promise, /timed out/);
  await f.timer(90000); await rejected;
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert(receipt.visibleMs >= 90000); assert(receipt.hiddenMs >= 120000); assert.equal(receipt.reason, 'visibility'); f.clean();
});
test('a completed background window drains as stale without claiming a frame or spending hidden time', async () => {
  const f = fixture({ readyDelay: 100000 }), promise = f.run(); await f.flush();
  f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); await f.flush();
  await f.timer(200000); const receipt = await promise;
  assert.equal(receipt.stale, true); assert.equal(receipt.completed, false);
  assert.equal(receipt.visibleMs, 0); assert(receipt.hiddenMs >= 200000);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined); f.clean();
});
for (const failure of ['link', 'GL', 'context']) test('hidden-time suspension still fails closed on ' + failure, async () => {
  const f = fixture({ readyDelay: 100000, failure: failure === 'link' ? 'link' : '' }), promise = f.run();
  const rejected = assert.rejects(promise, failure === 'link' ? /failed to link/ : failure === 'GL' ? /GL errors/ : /Graphics stopped/);
  await f.flush(); const submitted = f.calls.length;
  f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); await f.flush();
  if (failure === 'context') f.lose();
  else { if (failure === 'GL') f.glErrors.push(['0x0502']); await f.timer(200000); }
  await rejected; assert.equal(f.calls.length, submitted); assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations[0].outcome, 'failed'); f.clean();
});
test('failed slow preparation still records its blocking time without retry or GL restoration', async () => {
  const f = fixture({ failure: 'throw', compileMs: 5000 }); await assert.rejects(f.run(), /controlled compile/);
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert.equal(receipt.maxSinglePrepareMs, 5000); assert.equal(receipt.maxFullTurnMs, 5000);
  assert.equal(f.compileCalls.length, 1); assert.deepEqual(f.restores, [false]); f.clean();
});
test('the total visible-time deadline still bounds a stream of individually completed programs', async () => {
  const f = fixture({ count: 50, readyDelay: 0, compileMs: 8000 });
  await assert.rejects(f.finish(f.run()), /exceeded its time budget/);
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert(receipt.visibleMs >= 180000); assert.equal(receipt.hiddenMs, 0);
  assert(receipt.preparedJobs < receipt.eligibleJobs); f.clean();
});
test('context loss rejects before completion=true can be accepted and removes listeners immediately', async () => {
  const f = fixture(), promise = f.run(), rejected = assert.rejects(promise, /Graphics stopped/); await f.flush();
  const submitted = f.calls.length; f.ctx.forceComplete = true; f.lose(); await rejected;
  assert.equal(f.queries.length, 0); assert.equal(f.calls.length, submitted); f.clean();
});
test('disposed pending handles are never queried; stale views drain, unexpected disposal fails', async () => {
  for (const stale of [false, true]) {
    const f = fixture({ count: 1 }); f.objects[0].material.forceSinglePass = true;
    const promise = f.run(); await f.flush(); f.programs[0].program = undefined;
    if (stale) { f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize'); const r = await f.finish(promise); assert.equal(r.stale, true); assert.equal(r.disposed, 1); }
    else { const rejected = assert.rejects(promise, /disposed/); await f.timer(); await rejected; }
    assert.equal(f.queries.length, 0); f.clean();
  }
});
test('completed failed links and GL errors fail closed without a completion receipt', async () => {
  const link = fixture({ failure: 'link' }), pending = link.run(); await assert.rejects(link.finish(pending), /failed to link/); link.clean();
  const gl = fixture(); gl.glErrors.push(['0x0502']); await assert.rejects(gl.run(), /GL errors/); assert.equal(gl.calls.length, 0); gl.clean();
});
test('an unobserved GL error is recognized after the finite queue drains and cannot become a completed receipt', async () => {
  const f = fixture({ readyDelay: 100 }), promise = f.run(); await f.flush();
  const submitted = f.compileCalls.length;
  assert(submitted > 0 && f.timers.size === 1);
  f.glErrors.push(['0x0502']); await assert.rejects(f.finish(promise), /GL errors/);
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert(f.compileCalls.length > submitted, 'sliding admission continues before the deferred error becomes known');
  assert.equal(receipt.preparedJobs, receipt.eligibleJobs); assert.equal(receipt.completed, false); assert.equal(receipt.outcome, 'failed');
  assert.equal(f.errorChecks.length, 2); assert(f.errorChecks.every(check => check.pending === 0));
  const failedCalls = f.compileCalls.length; await f.flush(); assert.equal(f.compileCalls.length, failedCalls); f.clean();
});
test('a final GL error from a flush rejects after the last pending handle without a successful completion', async () => {
  const f = fixture({ failure: 'flushGL' }); await assert.rejects(f.finish(f.run()), /GL errors/);
  const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert(f.flushes.length > 1); assert.equal(receipt.preparedJobs, receipt.eligibleJobs); assert.equal(receipt.outcome, 'failed');
  assert.equal(receipt.completed, false); assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined);
  assert.equal(f.errorChecks.length, 2); assert.equal(f.errorChecks.at(-1).pending, 0); f.clean();
});

test('sliding admission fills slots after partial completion without an in-flight GL error query', async () => {
  const f = fixture({ readyDelay: 1000 }), promise = f.run(); await f.flush(); await f.timer();
  assert.equal(f.programs.length, 8); const submitted = f.compileCalls.length;
  f.programs[0].readyAt = 0; f.programs[1].readyAt = 0; await f.timer();
  assert(f.compileCalls.length > submitted); assert.equal(f.errorChecks.length, 1);
  const receipt = await f.finish(promise); assert.equal(receipt.completed, true); assert(receipt.maxPending <= 8);
  assert(receipt.maxPreparesPerTurn <= 4); assert.equal(f.errorChecks.length, 2); f.clean();
});
test('a stale drained view still checks queued GL errors before allowing a replan', async () => {
  const f = fixture({ readyDelay: 100 }), promise = f.run(); await f.flush(); const submitted = f.compileCalls.length;
  f.glErrors.push(['0x0502']); f.ctx.TITLE_RESIZE_PENDING = true; f.ctx.window.emit('resize');
  await assert.rejects(f.finish(promise), /GL errors/); const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations[0];
  assert.equal(f.compileCalls.length, submitted); assert.equal(receipt.outcome, 'failed'); assert.equal(receipt.stale, false); f.clean();
});
test('cached-only finite jobs retain a final GL error check before completion', async () => {
  const f = fixture({ count: 1 }); await f.finish(f.run()); const compile = f.ctx.renderer.compile, before = f.errorChecks.length;
  f.ctx.renderer.compile = function(...args) { const result = compile.apply(this, args); f.glErrors.push(['0x0502']); return result; };
  await assert.rejects(f.run(), /GL errors/); const receipt = f.ctx.GRAPHICS_STARTUP.titlePreparations.at(-1);
  assert.equal(receipt.newPrograms, 0); assert.equal(receipt.completed, false); assert.equal(f.errorChecks.length, before + 2); f.clean();
});
test('completed failed links are still rejected before other pending programs or deferred GL checks', async () => {
  const f = fixture({ readyDelay: 1000, failure: 'link' }), promise = f.run(); await f.flush();
  const submitted = f.compileCalls.length; f.programs[0].readyAt = 0;
  const rejected = assert.rejects(promise, /failed to link/); await f.timer(); await rejected;
  assert.equal(f.compileCalls.length, submitted); assert.equal(f.queries.length, 1); assert.equal(f.errorChecks.length, 1); f.clean();
});
test('context loss during a flush is fatal before another admission, completion query or timer', async () => {
  const f = fixture(); f.ctx.gl.flush = () => f.lose();
  await assert.rejects(f.run(), /Graphics stopped/);
  assert.equal(f.queries.length, 0); assert.equal(f.errorChecks.length, 1); assert(f.compileCalls.length <= 4); f.clean();
});
test('compile exceptions restore material side and perform no further GL restoration or retry', async () => {
  const f = fixture({ failure: 'throw' }); await assert.rejects(f.run(), /controlled compile failure/);
  assert.equal(f.calls.length, 1); assert.equal(f.objects[0].material.side, THREE.DoubleSide); assert.deepEqual(f.restores, [false]); f.clean();
});
test('preparation history is bounded and never claims readiness or mutates character/world state', async () => {
  const f = fixture({ safe: true }); const before = JSON.stringify(f.ctx.GAME);
  for (let i = 0; i < 12; i++) await f.run();
  assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations.length, 8); assert.equal(JSON.stringify(f.ctx.GAME), before); f.clean();
});

test('one exact existing avatar proxy is compiled once in its real shadow scene/camera/target', async () => {
  const f = fixture({ avatar: true }), side = f.avatarProxy.material.side;
  const sceneTraversal = f.SHADOW.scene.traverseVisible, sourceParent = f.avatarSource.parent;
  const receipt = await f.finish(f.run());
  const calls = f.calls.filter(call => call.targetScene === f.SHADOW.scene);
  assert.equal(calls.length, 1); assert.equal(calls[0].object, f.avatarProxy);
  assert.equal(calls[0].material, f.avatarProxy.material); assert.equal(calls[0].geometry, f.avatarSource.geometry);
  assert.equal(calls[0].side, THREE.DoubleSide); assert.equal(calls[0].target, f.SHADOW.rt);
  const compileCall = f.compileCalls.find(call => call.targetScene === f.SHADOW.scene);
  assert.equal(compileCall.camera, f.SHADOW.cam); assert.notEqual(compileCall.collection, f.SHADOW.scene);
  assert.equal(f.SHADOW.scene.traverseVisible, sceneTraversal, 'stock target-scene light scan is untouched');
  for (const decoy of [f.shadowDecoy, f.hiddenShadowDecoy]) assert(!f.calls.some(call => call.object === decoy));
  assert.equal(receipt.families['avatar-shadow'].jobs, 1); assert.equal(receipt.families['avatar-shadow'].prepared, 1);
  assert.equal(receipt.families['avatar-shadow'].programs, 1); assert.equal(receipt.avatarShadowQueued, true);
  assert(receipt.maxPending <= 8 && receipt.maxPreparesPerTurn <= 4);
  assert.equal(f.avatarProxy.parent, f.SHADOW.scene); assert.equal(f.avatarSource.parent, sourceParent);
  assert.equal(f.avatarProxy.material.side, side); assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});
test('safe/unsupported/Low/indoor/missing/ambiguous/unsupported proxy paths never preload shadow', async () => {
  for (const kind of ['safe', 'extension', 'Low', 'indoor', 'missing', 'ambiguous', 'hook', 'side', 'geometry']) {
    const f = fixture({ avatar: true, safe: kind === 'safe', supported: kind !== 'extension' });
    if (kind === 'Low') f.SHADOW.rt = null;
    if (kind === 'indoor') f.INDOOR.on = true;
    if (kind === 'missing') f.SHADOW.proxies.length = 0;
    if (kind === 'ambiguous') f.SHADOW.proxies.push(f.avatarProxy);
    if (kind === 'hook') f.avatarProxy.onBeforeRender = () => {};
    if (kind === 'side') f.avatarProxy.material.side = THREE.FrontSide;
    if (kind === 'geometry') f.avatarProxy.geometry = new THREE.BufferGeometry();
    const receipt = await f.finish(f.run());
    assert(!f.calls.some(call => call.targetScene === f.SHADOW.scene), kind);
    assert(!receipt.families['avatar-shadow'], kind); f.clean();
  }
});
for (const kind of ['replace target', 'disable target', 'indoor']) test(kind + ' drains submitted shadow program before returning stale', async () => {
  const f = fixture({ avatar: true, readyDelay: 100 }), promise = f.run(); await f.flush();
  for(let i=0; i<100 && !f.calls.some(call => call.object === f.avatarProxy); i++) await f.timer();
  assert(f.calls.some(call => call.object === f.avatarProxy), 'shadow program has been queued');
  const submitted = f.calls.length;
  if (kind === 'replace target') f.SHADOW.rt = {};
  if (kind === 'disable target') f.SHADOW.rt = null;
  if (kind === 'indoor') f.INDOOR.on = true;
  const receipt = await f.finish(promise);
  assert.equal(receipt.stale, true); assert.equal(receipt.reason, 'avatar-shadow');
  assert.equal(f.calls.length, submitted); assert.equal(f.queries.length, f.programs.length);
  assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});
test('real r160 cache parameters match preparation and later avatar shadow transforms', () => {
  const f = fixture({ avatar: true }), material = f.avatarProxy.material;
  assert.equal(material.vertexShader, avatarFixture.vertexShader); assert.equal(material.fragmentShader, avatarFixture.fragmentShader);
  assert.equal(material.uniforms, f.avatarSource.material.uniforms); assert.equal(material.colorWrite, false);
  assert.equal(material.transparent, false); assert.equal(material.forceSinglePass, true);
  const renderer = { getRenderTarget: () => f.SHADOW.rt, toneMapping: THREE.ACESFilmicToneMapping,
    outputColorSpace: THREE.SRGBColorSpace, shadowMap: { enabled: false, type: THREE.PCFShadowMap }, _useLegacyLights: false };
  const maps = { get: value => value || null }, extensions = { has: name => name === 'KHR_parallel_shader_compile' };
  const cache = WebGLPrograms(renderer, maps, maps, extensions, { isWebGL2: true, logarithmicDepthBuffer: false,
    vertexTextures: true, precision: 'highp', getMaxPrecision: value => value }, {}, { numPlanes: 0, numIntersection: 0 });
  const lights = { directional: [], point: [], spot: [], spotLightMap: [], rectArea: [], hemi: [],
    directionalShadowMap: [], pointShadowMap: [], spotShadowMap: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
  const parameters = () => cache.getParameters(material, lights, [], f.SHADOW.scene, f.avatarProxy);
  const prepared = parameters(), preparedKey = cache.getProgramCacheKey(prepared);
  f.avatarProxy.matrixWorld.makeTranslation(500, 12, -300); f.SHADOW.cam.position.set(20, 100, 90);
  const drawn = parameters();
  assert.deepEqual(drawn, prepared); assert.equal(cache.getProgramCacheKey(drawn), preparedKey);
  assert.equal(prepared.vertexShader, avatarFixture.vertexShader); assert.equal(prepared.doubleSided, true);
  for (const flag of ['instancing','instancingColor','batching','skinning','morphTargets','morphNormals','morphColors','shadowMapEnabled']) assert.equal(prepared[flag], false, flag);
  assert.equal(prepared.toneMapping, THREE.NoToneMapping); assert.equal(prepared.outputColorSpace, THREE.LinearSRGBColorSpace);
  assert.equal(prepared.fog, false); assert.equal(prepared.numDirLights, 0); assert.equal(prepared.numPointLights, 0);
  assert.equal(f.avatarProxy.geometry.isInstancedBufferGeometry, true); assert.equal(f.avatarProxy.isInstancedMesh, undefined);
  assert.equal(f.SHADOW.scene.children.filter(object => object.isLight).length, 0);
});
