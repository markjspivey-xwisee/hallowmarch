import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const diagnosticSource = readFileSync(new URL('src/13y_gpu_diagnostic.js', root), 'utf8');
const mainSource = readFileSync(new URL('src/13_main.js', root), 'utf8');

function harness({ requested = true, safe = true, statuses = [], defaultStatus = 2 } = {}) {
  let now = 0, lost = false, id = 0;
  const timers = [], nodes = {}, calls = [], restores = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; }
    set id(value) { this._id = value; nodes[value] = this; }
    get id() { return this._id; }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
  }
  const body = new Element('body'), canvas = new Element('canvas');
  canvas.id = 'scene';
  for (const name of ['loading', 'title', 'hud', 'menu']) { const node = new Element('div'); node.id = name; }
  const gl = {
    SYNC_GPU_COMMANDS_COMPLETE: 1, ALREADY_SIGNALED: 2, CONDITION_SATISFIED: 3,
    TIMEOUT_EXPIRED: 4, WAIT_FAILED: 5, NO_ERROR: 0,
    isContextLost: () => lost,
    fenceSync() { calls.push('fence'); return {}; },
    flush() { calls.push('flush'); },
    clientWaitSync() { calls.push('wait'); return statuses.length ? statuses.shift() : defaultStatus; },
    deleteSync() { calls.push('delete'); },
    getError: () => 0,
  };
  const info = { render: { calls: 0, triangles: 0 }, reset() { this.render.calls = 0; this.render.triangles = 0; } };
  const scene = { objects: [] };
  const renderer = {
    info, debug: { checkShaderErrors: false, onShaderError: null },
    setRenderTarget() {}, setClearColor() {}, clear() {},
    renderBufferDirect(cam, scn, geometry) { info.render.calls++; info.render.triangles += geometry.index.count / 3; },
    render(scn, camera) {
      calls.push('render');
      for (const object of scn.objects || []) {
        if (object.visible !== false) this.renderBufferDirect(camera, scn, object.geometry, object.material, object);
      }
    },
  };
  class BoxGeometry { constructor() { this.id = ++id; this.attributes = { position: { count: 8 } }; this.index = { count: 36 }; } }
  class MeshBasicMaterial { constructor() { this.id = ++id; this.type = 'MeshBasicMaterial'; } }
  class Mesh { constructor(geometry, material) { this.uuid = 'object-' + (++id); this.geometry = geometry; this.material = material; this.visible = true; this.rotation = { set() {} }; } }
  const ctx = {
    URLSearchParams, location: { search: requested ? '?safe=' + (safe ? '1' : '0') + '&gpuDiag=1' : '?safe=1' },
    BOOT_SAFE: safe, GRAPHICS_CONTEXT_LOST: false,
    GRAPHICS_STARTUP: { events: [], phase: 'initial', stopped: false },
    window: { __hm: { ready: false } }, GAME: { ready: false, started: false, t: 0, player: null },
    document: { createElement: tag => new Element(tag), getElementById: name => nodes[name], body },
    canvas, gl, renderer, scene, sceneRT: {}, camera: {}, view: { w: 800, h: 450 },
    performance: { now: () => now },
    setTimeout(fn, delay = 0) { timers.push({ fn, due: now + delay }); return timers.length; },
    requestAnimationFrame() { throw new Error('diagnostic must not schedule the normal animation loop'); },
    tick() { throw new Error('diagnostic must not tick the game'); },
    perfLabel: object => object.uuid,
    graphicsCheckpoint(phase, message) { ctx.GRAPHICS_STARTUP.phase = phase; ctx.GRAPHICS_STARTUP.events.push({ phase, message }); },
    graphicsAssertActive() { if (ctx.GRAPHICS_CONTEXT_LOST) throw new Error('Graphics stopped'); },
    renderPost() { calls.push('post'); },
    U: {uTrail:{value:null}}, trailClearMat:{}, trailA:{}, trailB:{},
    pass() { calls.push('offscreen'); },
    stepTrail() { return { workCalls: 0, workTriangles: 0 }; },
    renderDecals() { return { workCalls: 0, workTriangles: 0 }; },
    THREE: {
      Scene: class { constructor() { this.objects = []; } add(object) { this.objects.push(object); } },
      PerspectiveCamera: class { constructor() { this.position = {}; } },
      DataTexture:class {},
      BoxGeometry, MeshBasicMaterial, Mesh,
    },
  };
  vm.createContext(ctx);
  vm.runInContext(diagnosticSource, ctx);
  let prepared = 0;
  const inventory = {
    renderables: [],
    sets: Object.fromEntries(['sky','terrain','grass','flowers','trees','water','structures','crowds','other'].map(key => [key, new Set()])),
  };
  // Keep real state machine, UI, stage runners and fence code. World preparation
  // and renderer snapshots are outside these sequencing tests.
  ctx.prepareFixture = () => { prepared++; return { fx: 0, fz: 0 }; };
  ctx.inventoryFixture = () => inventory;
  ctx.captureFixture = () => ({ fixture: true });
  ctx.restoreFixture = (saved, restoreGl) => restores.push(restoreGl);
  vm.runInContext('gpuDiagPrepareView=prepareFixture; gpuDiagFamilies=inventoryFixture; gpuDiagCaptureRenderer=captureFixture; gpuDiagRestoreRenderer=restoreFixture;', ctx);
  return {
    ctx, gl, renderer, nodes, body, calls, timers, restores, inventory,
    get prepared() { return prepared; },
    get state() { return ctx.window.__hmGpuDiagnostic; },
    lose() { lost = true; ctx.GRAPHICS_CONTEXT_LOST = true; },
    notifyLoss() { for (const fn of canvas.listeners.webglcontextlost || []) fn({ preventDefault() {} }); },
    async timer() {
      assert.ok(timers.length, 'an explicit fence poll was scheduled');
      timers.sort((a,b) => a.due-b.due);
      const next = timers.shift(); now = next.due; next.fn();
      await Promise.resolve(); await Promise.resolve();
    },
    async drain() {
      let count = 0;
      while (timers.length) { assert.ok(count++ < 1000, 'bounded timer polling'); await this.timer(); }
    },
  };
}

test('GPU fences yield, poll, and resolve only after actual completion status', async () => {
  const h = harness({ statuses: [4, 3] });
  const pending = vm.runInContext('gpuDiagWaitForFence(gl,100)', h.ctx);
  assert.deepEqual(h.calls, ['fence','flush']);
  await h.timer();
  assert.deepEqual(h.calls, ['fence','flush','wait']);
  await h.timer();
  const receipt = await pending;
  assert.equal(receipt.waitMs, 25);
  assert.deepEqual(h.calls, ['fence','flush','wait','wait','delete']);
});

test('fence timeout rejects and cleans up without a false completion receipt', async () => {
  const h = harness({ defaultStatus: 4 });
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /timed out after 50 ms/);
  await h.drain();
  await rejected;
  assert.equal(h.calls.filter(x => x === 'wait').length, 2);
  assert.equal(h.calls.filter(x => x === 'delete').length, 1);
});

test('loss while waiting stops further GL polling or cleanup commands', async () => {
  const h = harness();
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,100)', h.ctx), /context was lost/);
  h.lose();
  await h.drain();
  await rejected;
  assert.deepEqual(h.calls, ['fence','flush']);
});

test('normal launch does not construct diagnostic UI or submit work', async () => {
  const h = harness({ requested: false });
  assert.equal(await vm.runInContext('graphicsRunDiagnostic()', h.ctx), false);
  assert.equal(h.state, undefined);
  assert.equal(h.body.children.length, 0);
  assert.equal(h.prepared, 0);
  assert.deepEqual(h.calls, []);
});

test('diagnostic without safe=1 refuses before preparation or GPU submission', async () => {
  const h = harness({ safe: false });
  assert.equal(await vm.runInContext('graphicsRunDiagnostic()', h.ctx), true);
  assert.equal(h.state.stopped, true);
  assert.match(h.state.error, /safe=1/);
  assert.equal(h.prepared, 0);
  assert.deepEqual(h.calls, []);
  assert.equal(h.nodes['gpu-diag-next'].disabled, true);
});

test('one manual stage is in flight at a time and completion never auto-advances', async () => {
  const h = harness();
  assert.equal(await vm.runInContext('graphicsRunDiagnostic()', h.ctx), true);
  assert.equal(h.prepared, 1);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.results.length, 0);
  assert.deepEqual(h.calls, []);
  assert.equal(h.timers.length, 0);
  const first = h.state.runNext();
  assert.equal(h.state.running, true);
  assert.equal(await h.state.runNext(), false);
  assert.equal(h.calls.filter(x => x === 'fence').length, 1);
  await h.drain();
  assert.equal(await first, true);
  assert.equal(h.state.index, 1);
  assert.equal(h.state.results.length, 1);
  assert.equal(h.state.results[0].id, 'cube-default');
  assert.equal(h.state.results[0].completed, true);
  assert.equal(h.state.results[0].exercised, true);
  assert.equal(h.state.running, false);
  assert.equal(h.timers.length, 0);
  const second = h.state.runNext();
  await h.drain();
  assert.equal(await second, true);
  assert.equal(h.state.index, 2);
  assert.deepEqual(Array.from(h.state.results, row => row.id), ['cube-default','cube-post']);
  assert.equal(h.timers.length, 0);
});

test('stage timeout permanently stops subsequent manual submissions', async () => {
  const h = harness({ defaultStatus: 4 });
  await vm.runInContext('graphicsRunDiagnostic()', h.ctx);
  const pending = h.state.runNext();
  await h.drain();
  assert.equal(await pending, false);
  assert.equal(h.state.stopped, true);
  assert.equal(h.state.complete, false);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.results[0].completed, false);
  assert.match(h.state.error, /timed out/);
  assert.equal(h.restores.at(-1), false);
  const calls = h.calls.length;
  assert.equal(await h.state.runNext(), false);
  assert.equal(h.calls.length, calls);
});

test('stage loss remains stopped and submits nothing after the loss latch', async () => {
  const h = harness();
  await vm.runInContext('graphicsRunDiagnostic()', h.ctx);
  const pending = h.state.runNext();
  h.lose(); h.notifyLoss();
  const calls = h.calls.length;
  await h.drain();
  assert.equal(await pending, false);
  assert.equal(h.state.stopped, true);
  assert.equal(h.state.index, 0);
  assert.equal(h.state.results[0].completed, false);
  assert.equal(h.calls.length, calls);
  assert.equal(await h.state.runNext(), false);
  assert.equal(h.calls.length, calls);
});

test('nominal completion stays distinct from failure and allows no extra batches', async () => {
  const h = harness();
  await vm.runInContext('graphicsRunDiagnostic()', h.ctx);
  const count = h.state.stages.length;
  for (let index=0; index<count; index++) {
    const pending = h.state.runNext();
    await h.drain();
    assert.equal(await pending, true);
    assert.equal(h.state.index, index+1);
  }
  assert.equal(h.state.complete, true);
  assert.equal(h.state.stopped, false);
  assert.equal(h.state.results.length, count);
  assert.equal(h.ctx.GAME.ready, false);
  assert.equal(h.ctx.GAME.started, false);
  assert.equal(h.ctx.GAME.t, 0);
  assert.equal(h.nodes['gpu-diag-next'].disabled, true);
  const calls = h.calls.length;
  assert.equal(await h.state.runNext(), false);
  assert.equal(h.calls.length, calls);
  assert.equal(h.timers.length, 0);
});

function bootHarness({ diagnostic = true, safe = true } = {}) {
  const calls = [], nodes = { loading: { style: {} } };
  const ctx = {
    BOOT_SAFE: safe, GAME: { ready: false }, window: { __hm: { ready: false } },
    performance: { now: () => 0 }, tod: { p: 1 }, camera: { updateMatrixWorld() {} },
    DUN: { root: {} }, INDOOR: { on: false }, scene: {}, lastNow: 0,
    $: id => nodes[id],
    loadSave: async () => null,
    loadStep: async (frac,msg,fn) => { if(fn) await fn(); },
    graphicsAssertActive() {}, graphicsCheckpoint() {},
    graphicsRunDiagnostic: async () => { calls.push('diagnostic'); return diagnostic; },
    perf2Compile: () => calls.push('compile'),
    perf2Shaders: async () => calls.push('shader-wait'),
    buildMapImage: () => calls.push('map'),
    buildDungeonMap: () => calls.push('dungeon-map'),
    tick: () => calls.push('tick'),
    setupTitle: () => calls.push('title'),
    requestAnimationFrame: () => calls.push('raf'),
    frame() {}, setTimeout() {}, reportError(error) { throw error; },
    renderer: { compile: () => calls.push('renderer.compile') },
  };
  for (const name of [
    'buildWorld','uploadWorldTextures','buildTerrain','buildWater','buildTrees','buildNearTrees',
    'buildRocks','buildHeroTree','buildCrags','buildStructures','buildBarrowSurface','buildSurvival',
    'buildBoats','buildDungeon','buildGrass','buildFlowers','buildNature','buildFarming','mtnHeights',
    'buildCrowds','buildParticles','buildSpellFX','buildFireflies','buildWeather','buildAmbientLife',
    'buildDragon','buildLootMeshes','initCamps','initTowns','initMerchants','initWar','initWildlife',
    'initAnimals','spawnDragon','initBarrow','groupOutdoors','resize','applyTimeOfDay','updateCamera',
    'spellCompileVisible',
  ]) ctx[name] = () => {};
  const start = mainSource.indexOf('async function boot() {');
  const end = mainSource.indexOf('\n}',start);
  assert.ok(start>=0 && end>start);
  vm.createContext(ctx);
  vm.runInContext(mainSource.slice(start,end+2),ctx);
  return {ctx,calls};
}

test('diagnostic boot returns before compilation, map, first tick, title and normal RAF', async () => {
  const h = bootHarness({diagnostic:true,safe:true});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['diagnostic']);
  assert.equal(h.ctx.GAME.ready,false);
  assert.equal(h.ctx.window.__hm.ready,false);
});

test('ordinary safe boot still renders its first view and enters the normal loop', async () => {
  const h = bootHarness({diagnostic:false,safe:true});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['diagnostic','map','dungeon-map','tick','title','raf']);
  assert.equal(h.ctx.GAME.ready,true);
  assert.equal(h.ctx.window.__hm.ready,true);
});

test('ordinary high quality boot still follows its existing shader and frame pipeline', async () => {
  const h = bootHarness({diagnostic:false,safe:false});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['diagnostic','compile','map','dungeon-map','renderer.compile','shader-wait','tick','title','raf']);
  assert.equal(h.ctx.GAME.ready,true);
});

test('shader diagnostic failure stops the stage and restores hooks and visibility',async()=>{
  const h=harness();
  const makeObject=()=>new h.ctx.THREE.Mesh(new h.ctx.THREE.BoxGeometry(),new h.ctx.THREE.MeshBasicMaterial());
  const sky=makeObject(),other=makeObject();
  h.inventory.renderables.push(sky,other);
  h.inventory.sets.sky.add(sky);h.inventory.sets.other.add(other);
  h.ctx.scene.objects.push(sky,other);
  h.gl.getProgramInfoLog=()=> 'program diagnostic';
  h.gl.getShaderInfoLog=()=> 'shader diagnostic';
  let fail=false;
  const ordinaryDirect=h.renderer.renderBufferDirect;
  const draw=function(...args){
    if(fail)this.debug.onShaderError(h.gl,{},{},{});
    return ordinaryDirect.apply(this,args);
  };
  h.renderer.renderBufferDirect=draw;
  const oldHook=h.renderer.debug.onShaderError;
  await vm.runInContext('graphicsRunDiagnostic()',h.ctx);
  for(let n=0;n<2;n++){const pending=h.state.runNext();await h.drain();assert.equal(await pending,true);}
  fail=true;
  assert.equal(await h.state.runNext(),false);
  assert.equal(h.state.currentStage,'sky');
  assert.equal(h.state.index,2);
  assert.equal(h.state.stopped,true);
  assert.equal(h.state.results.at(-1).completed,false);
  assert.match(h.state.error,/Shader failed in Sky/);
  assert.match(h.state.error,/program diagnostic/);
  assert.equal(other.visible,true,'nonfamily visibility returns after the throwing draw');
  assert.equal(sky.visible,true);
  assert.equal(h.renderer.renderBufferDirect,draw);
  assert.equal(h.renderer.debug.onShaderError,oldHook);
  assert.equal(h.renderer.debug.checkShaderErrors,false);
  assert.equal(h.restores.at(-1),false,'failed batch performs CPU restoration only');
  const calls=h.calls.length;
  assert.equal(await h.state.runNext(),false);
  assert.equal(h.calls.length,calls);
});

test('GL error after a completed fence fails the stage rather than claiming success',async()=>{
  const h=harness();
  const errors=[0,0x0502,0];
  h.gl.getError=()=>errors.shift()??0;
  const direct=h.renderer.renderBufferDirect,shaderHook=h.renderer.debug.onShaderError;
  await vm.runInContext('graphicsRunDiagnostic()',h.ctx);
  const pending=h.state.runNext();
  await h.drain();
  assert.equal(await pending,false);
  assert.equal(h.state.stopped,true);
  assert.equal(h.state.index,0);
  assert.equal(h.state.results[0].completed,false);
  assert.match(h.state.error,/GL errors after.*0x502/);
  assert.equal(h.renderer.renderBufferDirect,direct);
  assert.equal(h.renderer.debug.onShaderError,shaderHook);
  assert.equal(h.renderer.debug.checkShaderErrors,false);
  assert.equal(h.calls.filter(x=>x==='fence').length,1);
  assert.equal(h.restores.at(-1),false);
  const calls=h.calls.length;
  assert.equal(await h.state.runNext(),false);
  assert.equal(h.calls.length,calls);
});
