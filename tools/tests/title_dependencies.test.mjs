import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import * as THREE from 'three';
import { WebGLPrograms } from '../node_modules/three/src/renderers/webgl/WebGLPrograms.js';

const root = new URL('../../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const original = read('src/02_render.js'), controller = read('src/13o_title_compile.js');
const productPending = Number(controller.match(/pending:\s*(\d+)/)[1]);
const dive = read('src/07d_dive.js'), diagnostic = read('src/13y_gpu_diagnostic.js');
const rendererSource = read('tools/node_modules/three/src/renderers/WebGLRenderer.js');
const section = (text, start, end) => text.slice(text.indexOf(start), text.indexOf(end, text.indexOf(start)));
// Execute the exact production constructors, shared GLSL and live composite
// patch. Real r160 cache parameters/traversal are used; no WebGL is created.
const constructors = section(original, 'const U =', 'const GLSL_PLIGHT')
  + section(original, 'function mat(opts)', '// a copy of a material')
  + section(original, 'const GLSL_CLOUDS', '/* applies a time-of-day phase')
  + section(dive, '(function divePatchComposite()', 'function reportErrorLater');
const grouping = section(read('src/04d_barrow.js'), 'function groupOutdoors()', 'function regroupOutdoors()');
const compile = section(rendererSource, '\t\tfunction prepareMaterial(', '\t\t// compileAsync');
const capture = section(diagnostic, 'function gpuDiagCaptureRenderer()', 'function gpuDiagGlErrors(');

function events() {
  const listeners = new Map();
  return { addEventListener(name, fn) { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name).add(fn); },
    removeEventListener(name, fn) { listeners.get(name)?.delete(fn); },
    emit(name) { for (const fn of [...(listeners.get(name) || [])]) fn({}); },
    count: () => [...listeners.values()].reduce((count, set) => count + set.size, 0) };
}

function fixture({ level = 'medium', safe = false, supported = true, readyDelay = 25, compileMs = 0, failure = '', pendingLimit = productPending } = {}) {
  let now = 0, timerId = 0, lost = false, cache, randomCalls = 0, preflightCalls = 0;
  const timers = new Map(), programs = [], known = new Map(), compileCalls = [], calls = [], errors = [], errorChecks = [];
  const document = { hidden: false, ...events() }, window = events(), canvas = events();
  const originalTarget = {}, scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(55, 1.6, 0.1, 900);
  camera.position.set(0, 5, 0); camera.lookAt(0, 5, -1); camera.updateMatrixWorld();
  let currentTarget = originalTarget;
  const clearColor = new THREE.Color(0x234567), viewport = new THREE.Vector4(1, 2, 300, 200), scissor = new THREE.Vector4(3, 4, 150, 100);
  let clearAlpha = 0.7, scissorTest = true;
  const renderer = { info: { programs }, extensions: { has: () => supported }, _useLegacyLights: false,
    toneMapping: THREE.NoToneMapping, outputColorSpace: THREE.LinearSRGBColorSpace,
    shadowMap: { enabled: false, type: THREE.PCFShadowMap }, autoClear: false,
    getRenderTarget: () => currentTarget,
    setRenderTarget(target) { assert(!lost, 'no target work after loss'); if (failure === 'target') throw Error('controlled target failure'); currentTarget = target; },
    getClearColor: value => value.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor(value, alpha) { assert(!lost); clearColor.set(value); clearAlpha = alpha; },
    getViewport: value => value.copy(viewport), setViewport: value => { assert(!lost); viewport.copy(value); },
    getScissor: value => value.copy(scissor), setScissor: value => { assert(!lost); scissor.copy(value); },
    getScissorTest: () => scissorTest, setScissorTest: value => { assert(!lost); scissorTest = value; } };
  const lights = { directional: [], point: [], spot: [], spotLightMap: [], rectArea: [], hemi: [],
    directionalShadowMap: [], pointShadowMap: [], spotShadowMap: [], numSpotLightShadowsWithMaps: 0, numLightProbes: 0 };
  const renderState = { init() {}, pushLight() {}, pushShadow() {}, setupLights() {} };
  const getProgram = (material, targetScene, object) => {
    assert(!lost);
    calls.push({ material, object, geometry: object.geometry, target: currentTarget, targetScene, side: material.side });
    if (failure === 'compile') throw Error('controlled compile failure');
    const parameters = cache.getParameters(material, lights, [], targetScene, object), key = cache.getProgramCacheKey(parameters);
    if (!known.has(key)) {
      const program = { id: programs.length, cacheKey: key, parameters, program: {}, readyAt: now + readyDelay,
        isReady() { assert(!lost); return now >= this.readyAt; } };
      known.set(key, program); programs.push(program);
    }
    if (failure === 'context') { lost = true; ctx.GRAPHICS_CONTEXT_LOST = true; canvas.emit('webglcontextlost'); }
    return known.get(key);
  };
  const ctx = { THREE, scene, camera, renderer, document, window, canvas, BOOT_SAFE: safe, REDUCE_MOTION: false,
    ZERO_TEX: new THREE.Texture(), RT_TYPE: THREE.HalfFloatType, GRAPHICS_CONTEXT_LOST: false,
    quality: { level, bloom: level === 'low' ? 4 : 5, dprActual: 1 }, INDOOR: { on: false },
    SHADOW: { rt: null, proxies: [] }, crowdHuman: { mesh: null }, GAME: { started: false },
    GRAPHICS_STARTUP: { stopped: false }, TITLE_RESIZE_PENDING: false, resizeTimer: 0, TITLE_WARM_GENERATION: 1,
    Math: Object.assign(Object.create(Math), { random() { randomCalls++; return 0.5; } }),
    clamp: (value, min, max) => Math.max(min, Math.min(max, value)), smooth: value => value * value * (3 - 2 * value),
    reportErrorLater(message) { throw Error(message); }, performance: { now: () => now },
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { fn, due: now + delay }); return id; }, clearTimeout: id => timers.delete(id),
    gl: { LINK_STATUS: 35714, isContextLost: () => lost, flush() { assert(!lost); }, getProgramParameter() { assert(!lost); return failure !== 'link'; } },
    gpuDiagGlErrors() { errorChecks.push(programs.filter(program => now < program.readyAt).length); return errors.shift() || []; },
    titleAssertActive() { if (lost || ctx.GRAPHICS_CONTEXT_LOST || ctx.GRAPHICS_STARTUP.stopped) throw Error('context lost or stopped'); },
    liveIn(object) { for (let parent = object; parent; parent = parent.parent) { if (!parent.visible) return false; if (parent === scene) return true; } return false; },
    frustum: { intersectsObject: () => true, intersectsSprite: () => true },
    renderStates: { get: () => renderState }, renderStateStack: [], currentRenderState: null,
    _this: renderer, BackSide: THREE.BackSide, FrontSide: THREE.FrontSide, DoubleSide: THREE.DoubleSide, getProgram };
  vm.createContext(ctx);
  vm.runInContext(constructors + grouping + '\ngroupOutdoors(); view.w=1280;view.h=800;makeTargets();\n'
    + 'skyU.uSunDir.value.set(0,0.5,-1).normalize(); skyU.uSunVis.value=1;\n'
    + 'this.resources={skyMesh,skyU,fsMesh,fsTriGeo,fsScene,fsCam,sceneRT,bloomRTs,bloomDown,bloomUp,composite,raysMat,raysRT,_sunNdc,_camDir};\n'
    + 'function install(){' + compile + '} install.call(renderer);\n' + capture
    + controller.replace(/pending:\s*\d+/, 'pending: ' + pendingLimit), ctx);
  const r = ctx.resources;
  const maps = { get: value => value || null };
  cache = WebGLPrograms(renderer, maps, maps, { has: () => true }, { isWebGL2: true, logarithmicDepthBuffer: false,
    vertexTextures: true, precision: 'highp', getMaxPrecision: value => value }, {}, { numPlanes: 0, numIntersection: 0 });
  const actualCompile = renderer.compile;
  renderer.compile = function(object, cam, targetScene) {
    compileCalls.push({ object, camera: cam, targetScene, target: currentTarget }); now += compileMs;
    return actualCompile.call(this, object, cam, targetScene);
  };
  renderer.render = function(targetScene, cam) {
    targetScene.traverseVisible(object => { if (object.isMesh && object.material.visible && object.layers.test(cam.layers)) getProgram(object.material, targetScene, object); });
  };
  const actualRays = ctx.updateRays;
  ctx.updateRays = () => { preflightCalls++; return actualRays(); };
  const inventory = { renderables: [r.skyMesh], sets: { sky: new Set([r.skyMesh]) } };
  const state = () => ({ material: r.fsMesh.material, sides: [r.bloomDown, r.bloomUp, r.raysMat, r.composite, r.skyMesh.material].map(material => material.side),
    post: Object.fromEntries(Object.entries(r.composite.uniforms).map(([key, uniform]) => [key, uniform.value])),
    sun: r.raysMat.uniforms.uSun.value.toArray(), sunObject: r.raysMat.uniforms.uSun.value,
    color: r.raysMat.uniforms.uCol.value.toArray(), colorObject: r.raysMat.uniforms.uCol.value,
    aspect: r.raysMat.uniforms.uAspect.value, ndc: r._sunNdc.toArray(), direction: r._camDir.toArray(),
    autoClear: renderer.autoClear, clearColor: clearColor.getHex(), clearAlpha, viewport: viewport.toArray(), scissor: scissor.toArray(), scissorTest });
  return { ctx, r, scene, camera, inventory, programs, known, compileCalls, calls, timers, errors, errorChecks, originalTarget,
    currentTarget: () => currentTarget, randomCalls: () => randomCalls, preflightCalls: () => preflightCalls, state,
    run: id => ctx.prepareTitleDependencies(id, inventory, ctx.TITLE_WARM_GENERATION),
    eval: text => vm.runInContext(text, ctx),
    async flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); },
    async timer(lateBy = 0) { const [id, timer] = [...timers].sort((a, b) => a[1].due - b[1].due)[0] || []; assert(timer); timers.delete(id); now = timer.due + lateBy; timer.fn(); await this.flush(); },
    async finish(promise) { let done = false, result, error; promise.then(value => { done = true; result = value; }, reason => { done = true; error = reason; });
      for (let i = 0; i < 1000 && !done; i++) { await this.flush(); if (!done) await this.timer(); }
      assert(done); if (error) throw error; return result; },
    lose() { lost = true; ctx.GRAPHICS_CONTEXT_LOST = true; canvas.emit('webglcontextlost'); },
    clean() { assert.equal(timers.size, 0); assert.equal(document.count() + window.count() + canvas.count(), 0); } };
}

test('post preparation uses only exact original leaves, materials, camera and target variants, restoring shared state', async () => {
  const f = fixture(); f.r._sunNdc.set(8, 7, 6); f.r._camDir.set(5, 4, 3); const before = f.state();
  const receipt = await f.finish(f.run('post'));
  assert.deepEqual(f.calls.map(call => call.material), [f.r.bloomDown, f.r.bloomUp, f.r.raysMat, f.r.composite]);
  assert.deepEqual(f.calls.map(call => call.target), [f.r.bloomRTs[0], f.r.bloomRTs.at(-2), f.r.raysRT, null]);
  assert(f.compileCalls.every(call => call.object === f.r.fsMesh && call.camera === f.r.fsCam && call.targetScene === f.r.fsScene));
  assert(f.calls.every(call => call.geometry === f.r.fsTriGeo));
  assert.deepEqual(f.state(), before); assert.equal(f.currentTarget(), f.originalTarget); assert.equal(f.randomCalls(), 0);
  assert.equal(f.preflightCalls(), 1); assert.equal(receipt.dependency, 'post'); assert.equal(receipt.completed, true);
  assert.equal(receipt.newPrograms, 4); assert(receipt.maxPending <= productPending); assert.equal(receipt.waves, 1); assert.equal(receipt.maxWavePrograms, 4);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined);
  assert(f.errorChecks.every(count => count === 0)); f.clean();
});

test('sky preparation compiles only the owned eligible original sky and leaves night overlays alone', async () => {
  const f = fixture(), overlay = new THREE.Mesh(f.r.fsTriGeo, new THREE.ShaderMaterial()); f.scene.add(overlay);
  f.inventory.renderables.push(overlay); f.inventory.sets.sky.add(overlay);
  const receipt = await f.finish(f.run('sky'));
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].object, f.r.skyMesh); assert.equal(f.calls[0].target, f.r.sceneRT);
  assert.equal(f.compileCalls[0].object, f.r.skyMesh); assert.equal(f.compileCalls[0].camera, f.camera); assert.equal(f.compileCalls[0].targetScene, f.scene);
  assert.equal(f.preflightCalls(), 0); assert.equal(receipt.dependency, 'sky'); assert.equal(receipt.newPrograms, 1);
  assert.equal(receipt.waves, 1); assert.equal(receipt.maxWavePrograms, 1); f.clean();
});

for (const pendingLimit of [4, 8]) test('the dependency API reserves double-sided variants across bounded waves, cap=' + pendingLimit, async () => {
  const f = fixture({ compileMs: 10, readyDelay: 1000, pendingLimit });
  for (const material of [f.r.bloomDown, f.r.bloomUp, f.r.raysMat, f.r.composite]) {
    material.transparent = true; material.side = THREE.DoubleSide; material.forceSinglePass = false;
  }
  const before = f.state(), receipt = await f.finish(f.run('post'));
  assert.equal(receipt.waves, pendingLimit === 4 ? 2 : 1); assert.equal(receipt.newPrograms, 8); assert.equal(receipt.maxWavePrograms, pendingLimit);
  assert.equal(receipt.maxPending, pendingLimit); assert.equal(receipt.maxPreparesPerTurn, 1); assert.equal(f.compileCalls.length, 4);
  assert(f.errorChecks.every(count => count === 0)); assert.deepEqual(f.state(), before); f.clean();
});

test('the actual production groupOutdoors path and the direct scene path retain exact sky ownership', async () => {
  for (const direct of [false, true]) {
    const f = fixture(); assert.equal(f.r.skyMesh.parent, f.ctx.INDOOR.outdoor); assert.equal(f.ctx.INDOOR.outdoor.parent, f.scene);
    if (direct) f.scene.add(f.r.skyMesh);
    const receipt = await f.finish(f.run('sky'));
    assert.equal(receipt.eligibleJobs, 1); assert.equal(receipt.preparedJobs, 1); assert.equal(receipt.newPrograms, 1);
    assert.equal(f.calls[0].object, f.r.skyMesh); assert.equal(f.compileCalls[0].targetScene, f.scene); f.clean();
  }
});

test('an arbitrary group under the scene does not gain ownership of the sky preparation lane', async () => {
  const f = fixture(), foreign = new THREE.Group(); f.scene.add(foreign); foreign.add(f.r.skyMesh);
  const receipt = await f.run('sky'); assert.equal(receipt.eligibleJobs, 0); assert.equal(f.compileCalls.length, 0); f.clean();
});

for (const levels of [0, 1]) test('only post passes present in the current bloom chain are prepared: ' + levels, async () => {
  const f = fixture(); f.r.bloomRTs.splice(levels); await f.finish(f.run('post'));
  assert.equal(f.calls.some(call => call.material === f.r.bloomDown), levels > 0);
  assert(!f.calls.some(call => call.material === f.r.bloomUp)); assert.equal(f.programs.length, levels + 2); f.clean();
});

for (const level of ['high', 'medium', 'low']) test('real r160 keys and CPU cached program identities match the original later post/sky calls at ' + level, async () => {
  const f = fixture({ level }); await f.finish(f.run('post')); await f.finish(f.run('sky'));
  const before = new Map(f.known), count = f.programs.length;
  assert(f.r.composite.fragmentShader.includes('uniform float uUnderW;'));
  assert(f.r.composite.fragmentShader.includes('vec2 uvW = vUv;'));
  f.eval('renderPost(); renderer.setRenderTarget(sceneRT); renderer.render(scene,camera);');
  assert.equal(f.programs.length, count, 'unchanged r160 keys require no additional program acquisition');
  assert.equal(f.known.size, before.size); for (const [key, program] of before) assert.equal(f.known.get(key), program);
  for (const program of f.programs) { assert.equal(program.parameters.outputColorSpace, THREE.LinearSRGBColorSpace); assert.equal(program.parameters.toneMapping, THREE.NoToneMapping); }
  assert.equal(count, level === 'low' ? 4 : 5); f.clean();
});

for (const change of ['child', 'parent', 'geometry', 'scene child', 'scene hook', 'override', 'hidden', 'layer', 'frustum']) test('unsafe post ownership remains serial: ' + change, async () => {
  const f = fixture();
  if (change === 'child') f.r.fsMesh.add(new THREE.Object3D());
  if (change === 'parent') new THREE.Scene().add(f.r.fsMesh);
  if (change === 'geometry') f.r.fsMesh.geometry = new THREE.BufferGeometry();
  if (change === 'scene child') f.r.fsScene.add(new THREE.Object3D());
  if (change === 'scene hook') f.r.fsScene.onBeforeRender = () => { throw Error('not a compile hook'); };
  if (change === 'override') f.r.fsScene.overrideMaterial = new THREE.ShaderMaterial();
  if (change === 'hidden') f.r.fsMesh.visible = false;
  if (change === 'layer') f.r.fsMesh.layers.set(4);
  if (change === 'frustum') f.r.fsMesh.frustumCulled = true;
  const receipt = await f.run('post'); assert.equal(receipt.eligibleJobs, 0); assert.equal(f.calls.length, 0); assert.equal(f.preflightCalls(), 0); f.clean();
});

for (const material of ['bloomDown', 'bloomUp', 'raysMat', 'composite']) test('an unsupported original post material is left for its real render: ' + material, async () => {
  const f = fixture(); f.r[material].onBeforeCompile = () => { throw Error('never invoke unsupported hook'); };
  const receipt = await f.finish(f.run('post'));
  assert(!f.calls.some(call => call.material === f.r[material])); assert.equal(receipt.skipped, 1); assert.equal(receipt.preparedJobs, 3); f.clean();
});

for (const change of ['hidden', 'parent', 'child', 'geometry', 'layer', 'object hook', 'material hook', 'scene hook', 'override', 'material hidden']) test('ineligible or unsafe sky stays serial: ' + change, async () => {
  const f = fixture();
  if (change === 'hidden') f.r.skyMesh.visible = false;
  if (change === 'parent') new THREE.Scene().add(f.r.skyMesh);
  if (change === 'child') f.r.skyMesh.add(new THREE.Object3D());
  if (change === 'geometry') f.r.skyMesh.geometry = new THREE.BufferGeometry();
  if (change === 'layer') f.r.skyMesh.layers.set(4);
  if (change === 'object hook') f.r.skyMesh.onBeforeRender = () => {};
  if (change === 'material hook') f.r.skyMesh.material.onBeforeCompile = () => {};
  if (change === 'scene hook') f.scene.onAfterRender = () => {};
  if (change === 'override') f.scene.overrideMaterial = new THREE.ShaderMaterial();
  if (change === 'material hidden') f.r.skyMesh.material.visible = false;
  const receipt = await f.run('sky'); assert.equal(receipt.eligibleJobs, 0); assert.equal(f.calls.length, 0); f.clean();
});

test('unowned sky and unknown dependencies fail without preparing a program', async () => {
  for (const missing of ['inventory', 'family']) {
    const f = fixture(); if (missing === 'inventory') f.inventory.renderables = []; else f.inventory.sets.sky.clear();
    await assert.rejects(f.run('sky'), /unowned/); assert.equal(f.calls.length, 0); f.clean();
  }
  const f = fixture(); await assert.rejects(f.run('crowds'), /Unknown/); assert.equal(f.calls.length, 0); f.clean();
});

test('recovery and missing KHR retain the original serial path without running a preflight', async () => {
  for (const options of [{ safe: true }, { supported: false }]) for (const id of ['post', 'sky']) {
    const f = fixture(options), receipt = await f.run(id); assert.equal(receipt.supported, false); assert.equal(f.calls.length, 0); assert.equal(f.preflightCalls(), 0); f.clean();
  }
});

for (const change of ['low', 'indoor', 'behind', 'no light']) test('the exact rays selector can decline without leaking state: ' + change, async () => {
  const f = fixture({ level: change === 'low' ? 'low' : 'medium' });
  if (change === 'indoor') f.ctx.INDOOR.on = true;
  if (change === 'behind') f.r.skyU.uSunDir.value.set(0, 0.5, 1).normalize();
  if (change === 'no light') { f.r.skyU.uSunVis.value = 0; f.r.skyU.uMoonVis.value = 0; }
  const before = f.state(); await f.finish(f.run('post'));
  assert(!f.calls.some(call => call.material === f.r.raysMat)); assert.deepEqual(f.state(), before); f.clean();
});

test('a throwing rays preflight restores every changed uniform, vector identity and scratch vector', async () => {
  const f = fixture(), before = f.state();
  f.eval('updateRays=function(){composite.uniforms.uRays.value=99; raysMat.uniforms.uSun.value.set(9,8); raysMat.uniforms.uAspect.value=7; raysMat.uniforms.uCol.value.set(6,5,4); _sunNdc.set(3,2,1); _camDir.set(1,2,3); throw Error("controlled rays failure");};');
  await assert.rejects(f.run('post'), /controlled rays failure/);
  assert.deepEqual(f.state(), before); assert.equal(f.calls.length, 0); assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});

for (const change of ['target', 'bloom target', 'ray target', 'material', 'geometry', 'shader', 'quality', 'indoor', 'camera', 'hidden', 'generation']) test('pending post dependencies drain before stale replan: ' + change, async () => {
  const f = fixture({ compileMs: 10, readyDelay: 50 }), before = f.state(), promise = f.run('post'); await f.flush();
  assert.deepEqual(f.state(), before, 'state is restored before the first asynchronous wait'); const submitted = f.compileCalls.length;
  if (change === 'target') f.eval('sceneRT = new THREE.WebGLRenderTarget(32,32);');
  if (change === 'bloom target') f.r.bloomRTs[0] = new THREE.WebGLRenderTarget(32, 32);
  if (change === 'ray target') f.eval('raysRT = new THREE.WebGLRenderTarget(32,32);');
  if (change === 'material') f.r.fsMesh.material = new THREE.ShaderMaterial();
  if (change === 'geometry') f.r.fsMesh.geometry = new THREE.BufferGeometry();
  if (change === 'shader') { f.r.bloomDown.fragmentShader += '\n'; f.r.bloomDown.needsUpdate = true; }
  if (change === 'quality') f.ctx.quality.level = 'low';
  if (change === 'indoor') f.ctx.INDOOR.on = true;
  if (change === 'camera') { f.camera.position.x += 10; f.camera.updateMatrixWorld(); }
  if (change === 'hidden') { f.ctx.document.hidden = true; f.ctx.document.emit('visibilitychange'); }
  if (change === 'generation') f.ctx.TITLE_WARM_GENERATION++;
  const receipt = await f.finish(promise); assert.equal(receipt.stale, true); assert.equal(receipt.completed, false);
  assert.equal(f.compileCalls.length, submitted); assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});

for (const change of ['hidden', 'geometry', 'shader', 'hook', 'outdoor hidden', 'outdoor detached', 'outdoor replaced', 'reparented']) test('pending sky dependency drains before stale replan: ' + change, async () => {
  const f = fixture({ readyDelay: 50 }), promise = f.run('sky'); await f.flush();
  if (change === 'hidden') f.r.skyMesh.visible = false;
  if (change === 'geometry') f.r.skyMesh.geometry = new THREE.BufferGeometry();
  if (change === 'shader') f.r.skyMesh.material.vertexShader += '\n';
  if (change === 'hook') f.r.skyMesh.material.onBeforeCompile = () => {};
  if (change === 'outdoor hidden') f.ctx.INDOOR.outdoor.visible = false;
  if (change === 'outdoor detached') f.ctx.INDOOR.outdoor.removeFromParent();
  if (change === 'outdoor replaced') f.ctx.INDOOR.outdoor = new THREE.Group();
  if (change === 'reparented') f.scene.add(f.r.skyMesh);
  const receipt = await f.finish(promise); assert.equal(receipt.stale, true); assert.equal(f.compileCalls.length, 1); f.clean();
});

for (const failure of ['compile', 'target', 'context', 'link']) test('dependency failure restores CPU state and never retries: ' + failure, async () => {
  const f = fixture({ failure }), before = f.state();
  await assert.rejects(f.finish(f.run('post')), /controlled|context|Graphics stopped|failed to link/);
  assert.deepEqual(f.state(), before); assert(f.compileCalls.length <= (failure === 'link' ? 4 : 1));
  assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations[0].completed, false); f.clean();
});

test('pending dependency errors cannot be hidden by a stale view, and cached jobs still check errors', async () => {
  const f = fixture({ readyDelay: 50 }), promise = f.run('post'); await f.flush(); f.errors.push(['0x0502']);
  f.ctx.TITLE_WARM_GENERATION++; await assert.rejects(f.finish(promise), /GL errors/);
  assert(f.errorChecks.every(count => count === 0)); f.clean();
  const cached = fixture(); await cached.finish(cached.run('post')); const compile = cached.ctx.renderer.compile;
  cached.ctx.renderer.compile = function(...args) { const result = compile.apply(this, args); cached.errors.push(['0x0502']); return result; };
  await assert.rejects(cached.run('post'), /GL errors/); assert.equal(cached.ctx.GRAPHICS_STARTUP.titlePreparations.at(-1).newPrograms, 0); cached.clean();
});

test('double-sided preparation restores the original side and material between bounded turns', async () => {
  const f = fixture({ compileMs: 10 }); f.r.bloomUp.side = THREE.DoubleSide; f.r.bloomUp.forceSinglePass = false;
  const before = f.state(), promise = f.run('post'); await f.flush(); assert.deepEqual(f.state(), before);
  const receipt = await f.finish(promise); assert.equal(receipt.completed, true); assert.deepEqual(f.state(), before);
  assert.deepEqual(f.calls.filter(call => call.material === f.r.bloomUp).map(call => call.side), [THREE.BackSide, THREE.FrontSide]); f.clean();
});

// The entry fixture constructs the actual original weather shader strings and
// targets on the CPU. It never runs a weather frame, simulation or WebGL pass.
function entryFixture(options = {}) {
  const f = fixture(options), weatherSource = read('src/12c_weather2.js');
  f.ctx.WX_N = 12; f.ctx.WX_WETK = [0.62, 1.1, 0.85];
  f.eval(section(weatherSource, 'const WX_Q =', '// rain hanging under its cloud')
    + '\nthis.entryResources=wxPrepareCloudResources(); this.weather=WXR;\n');
  const weather = f.ctx.weather;
  const resources = Array.from(f.ctx.entryResources);
  const shadow = f.ctx.SHADOW;
  shadow.scene = new THREE.Scene(); shadow.cam = new THREE.OrthographicCamera(-100, 100, 100, -100, 0.1, 600);
  shadow.rt = new THREE.WebGLRenderTarget(1536, 1536);
  f.eval(section(original, 'function shadowCaster(', '// [perf2]')
    + section(original, 'function depthFrom(', 'function liveIn('));
  const sources = [], proxies = [], depthFs = original.match(/const DEPTH_FS = \/\* glsl \*\/`([^`]+)`;/)[1];
  for (let index = 0; index < (options.shadows ?? 7); index++) {
    const geometry = new THREE.InstancedBufferGeometry(); geometry.instanceCount = index % 2 ? 4 : 0;
    geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(9), 3));
    geometry.setAttribute('iPos', new THREE.InstancedBufferAttribute(new Float32Array(16), 4));
    const material = new THREE.ShaderMaterial({ vertexShader: 'attribute vec4 iPos; void main(){ gl_Position=projectionMatrix*modelViewMatrix*vec4(position+iPos.xyz+vec3(' + index + '.0),1.0); }' });
    const source = new THREE.Mesh(geometry, material); f.scene.add(source); f.inventory.renderables.push(source);
    const proxy = f.ctx.shadowCaster(source, f.ctx.depthFrom(material, depthFs));
    sources.push(source); proxies.push(proxy);
  }
  return Object.assign(f, { weather, resources, shadow, sources, proxies,
    runEntry: (pairs = resources) => f.ctx.prepareTitleEntryPrograms(f.inventory, f.ctx.TITLE_WARM_GENERATION, pairs) });
}

for (const pendingLimit of [4, 8]) test('entry preparation uses exact original shadow/weather resources in bounded drained waves, cap=' + pendingLimit, async () => {
  const f = entryFixture({ shadows: 11, pendingLimit, readyDelay: 50 }), before = f.state();
  const counts = f.sources.map(source => source.geometry.instanceCount), parents = f.sources.map(source => source.parent);
  const receipt = await f.finish(f.runEntry());
  assert.equal(receipt.completed, true); assert.equal(receipt.dependency, 'entry'); assert.equal(receipt.eligibleJobs, 14);
  assert.equal(receipt.maxPending, pendingLimit); assert.equal(receipt.maxWavePrograms, pendingLimit);
  assert.equal(receipt.waves, Math.ceil(14 / pendingLimit)); assert(receipt.maxPreparesPerTurn <= 4);
  assert(f.errorChecks.every(count => count === 0)); assert.deepEqual(f.state(), before);
  assert.deepEqual(f.sources.map(source => source.geometry.instanceCount), counts); assert.deepEqual(f.sources.map(source => source.parent), parents);
  assert.equal(f.randomCalls(), 0); assert.equal(f.preflightCalls(), 0); assert.equal(f.currentTarget(), f.originalTarget);
  const shadowCalls = f.calls.filter(call => call.targetScene === f.shadow.scene);
  assert.deepEqual(shadowCalls.map(call => call.object), f.proxies);
  assert(shadowCalls.every(call => call.target === f.shadow.rt && call.geometry === call.object.userData.src.geometry));
  assert(f.compileCalls.filter(call => call.targetScene === f.shadow.scene).every(call => call.camera === f.shadow.cam));
  assert.deepEqual(f.calls.filter(call => call.object === f.r.fsMesh).map(call => [call.material, call.target]), f.resources.map(pair => [pair.material, pair.target]));
  assert(f.compileCalls.filter(call => call.targetScene === f.r.fsScene).every(call => call.object === f.r.fsMesh && call.camera === f.r.fsCam));
  assert.equal(f.ctx.GRAPHICS_STARTUP.titleCompleted, undefined); f.clean();
});

test('entry preparation leaves weather bindings, uniforms, counters and original simulation state unchanged', async () => {
  const f = entryFixture(), snapshot = () => f.eval('({map:U.uCloudMap.value,dome:U.uCloudDome.value,screen:U.uCloudScr.value,domeOn:U.uCloudDomeOn.value.toArray(),screenOn:U.uCloudScrP.value.toArray(),mapP:U.uCloudMapP.value.toArray(),n:WXR.n,domeP:WXR.domeMat.uniforms.uDomeP.value.toArray(),eye:WXR.scrMat.uniforms.uEye.value.toArray()})');
  const before = snapshot(); await f.finish(f.runEntry()); assert.deepEqual(snapshot(), before);
  assert.equal(f.randomCalls(), 0); assert.equal(f.preflightCalls(), 0); f.clean();
});

test('real r160 entry program keys and CPU cache identities survive later original weather passes and populated shadow transforms', async () => {
  const f = entryFixture(); await f.finish(f.runEntry()); const count = f.programs.length, known = new Map(f.known);
  f.proxies.forEach((proxy, index) => { proxy.geometry.instanceCount = 3 + index; proxy.matrixWorld.makeTranslation(400, 8, -90); });
  f.shadow.cam.position.set(100, 300, -200);
  f.eval('renderer.setRenderTarget(SHADOW.rt); renderer.render(SHADOW.scene, SHADOW.cam); pass(WXR.fieldMat,WXR.field); pass(WXR.domeMat,WXR.dome); pass(WXR.scrMat,WXR.scr);');
  assert.equal(f.programs.length, count); for (const [key, program] of known) assert.equal(f.known.get(key), program);
  assert(f.programs.every(program => program.parameters.outputColorSpace === THREE.LinearSRGBColorSpace && program.parameters.toneMapping === THREE.NoToneMapping));
  f.clean();
});

for (const change of ['unowned source', 'hidden source', 'source hook', 'proxy hook', 'material hook', 'proxy child', 'foreign proxy', 'geometry', 'array material', 'layer', 'colorWrite', 'depthWrite'])
test('entry preparation leaves unsupported or unowned shadow cases to their real draw: ' + change, async () => {
  const f = entryFixture({ shadows: 1 }), source = f.sources[0], proxy = f.proxies[0];
  if (change === 'unowned source') f.inventory.renderables.splice(f.inventory.renderables.indexOf(source), 1);
  if (change === 'hidden source') source.visible = false;
  if (change === 'source hook') source.onBeforeRender = () => {};
  if (change === 'proxy hook') proxy.onBeforeRender = () => {};
  if (change === 'material hook') proxy.material.onBeforeCompile = () => {};
  if (change === 'proxy child') proxy.add(new THREE.Mesh());
  if (change === 'foreign proxy') f.scene.add(proxy);
  if (change === 'geometry') source.geometry = new THREE.BufferGeometry();
  if (change === 'array material') proxy.material = [proxy.material];
  if (change === 'layer') proxy.layers.set(3);
  if (change === 'colorWrite') proxy.material.colorWrite = true;
  if (change === 'depthWrite') proxy.material.depthWrite = false;
  const receipt = await f.finish(f.runEntry()); assert.equal(receipt.families['entry-shadow'], undefined);
  assert.equal(f.calls.length, 3); assert(f.calls.every(call => call.object === f.r.fsMesh)); f.clean();
});

for (const change of ['source parent', 'source material', 'source geometry', 'proxy source', 'proxy material', 'proxy geometry', 'proxy removed', 'target', 'camera', 'scene', 'indoor', 'weather target', 'weather material', 'quality', 'weather off', 'weather q', 'shader', 'version', 'depthWrite'])
test('entry ownership changes stop new admission and drain before stale return: ' + change, async () => {
  const f = entryFixture({ shadows: 7, readyDelay: 50, compileMs: 10 }), promise = f.runEntry(); await f.flush();
  assert.equal(f.compileCalls.length, 1); const source = f.sources[0], proxy = f.proxies[0];
  if (change === 'source parent') { const group = new THREE.Group(); f.scene.add(group); group.add(source); }
  if (change === 'source material') source.material = new THREE.ShaderMaterial();
  if (change === 'source geometry') source.geometry = new THREE.BufferGeometry();
  if (change === 'proxy source') proxy.userData.src = f.sources[1];
  if (change === 'proxy material') proxy.material = new THREE.ShaderMaterial();
  if (change === 'proxy geometry') proxy.geometry = new THREE.BufferGeometry();
  if (change === 'proxy removed') f.shadow.proxies.splice(0, 1);
  if (change === 'target') f.shadow.rt = new THREE.WebGLRenderTarget();
  if (change === 'camera') f.shadow.cam = new THREE.PerspectiveCamera();
  if (change === 'scene') f.shadow.scene = new THREE.Scene();
  if (change === 'indoor') f.ctx.INDOOR.on = true;
  if (change === 'weather target') f.weather.field = new THREE.WebGLRenderTarget();
  if (change === 'weather material') f.weather.fieldMat = new THREE.ShaderMaterial();
  if (change === 'quality') f.ctx.quality.level = 'low';
  if (change === 'weather off') f.weather.on = false;
  if (change === 'weather q') f.weather.q = {};
  if (change === 'shader') proxy.material.vertexShader += '\n';
  if (change === 'version') proxy.material.needsUpdate = true;
  if (change === 'depthWrite') proxy.material.depthWrite = false;
  const receipt = await f.finish(promise); assert.equal(receipt.stale, true); assert.equal(f.compileCalls.length, 1);
  assert(f.errorChecks.every(count => count === 0)); assert.equal(f.currentTarget(), f.originalTarget); f.clean();
});

for (const change of ['spoof material', 'spoof target', 'unknown id', 'duplicate id', 'fs child', 'fs parent', 'fs hook'])
test('entry weather resources fail closed on ownership violations: ' + change, async () => {
  const f = entryFixture({ shadows: 0 }), pairs = f.resources.map(pair => ({ ...pair }));
  if (change === 'spoof material') pairs[0].material = new THREE.ShaderMaterial();
  if (change === 'spoof target') pairs[0].target = new THREE.WebGLRenderTarget();
  if (change === 'unknown id') pairs[0].id = 'weather-foreign';
  if (change === 'duplicate id') pairs.push(pairs[0]);
  if (change === 'fs child') f.r.fsMesh.add(new THREE.Mesh());
  if (change === 'fs parent') f.scene.add(f.r.fsMesh);
  if (change === 'fs hook') f.r.fsScene.onBeforeRender = () => {};
  const before = f.state(); await assert.rejects(f.runEntry(pairs), /unowned weather resource/);
  assert.equal(f.compileCalls.length, 0); assert.deepEqual(f.state(), before); f.clean();
});

for (const failure of ['compile', 'target', 'context', 'link']) test('entry failure restores shared CPU state and never retries: ' + failure, async () => {
  const f = entryFixture({ failure }), before = f.state();
  await assert.rejects(f.finish(f.runEntry()), /controlled|context|Graphics stopped|failed to link/);
  assert.deepEqual(f.state(), before); assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations.at(-1).completed, false); f.clean();
});

test('entry queued GL failure prevents the next wave and completion even when resources become stale', async () => {
  const f = entryFixture({ shadows: 7, readyDelay: 50 }), promise = f.runEntry(); await f.flush();
  assert.equal(f.compileCalls.length, productPending); f.errors.push(['0x0502']); f.weather.on = false;
  await assert.rejects(f.finish(promise), /GL errors/); assert.equal(f.compileCalls.length, productPending);
  assert.equal(f.ctx.GRAPHICS_STARTUP.titlePreparations.at(-1).completed, false); assert(f.errorChecks.every(count => count === 0)); f.clean();
});
