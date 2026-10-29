import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const diagnosticSource = readFileSync(new URL('src/13y_gpu_diagnostic.js', root), 'utf8');
const mainSource = readFileSync(new URL('src/13_main.js', root), 'utf8');

function harness({ requested = true, safe = true, statuses = [], defaultStatus = 2 } = {}) {
  let now = 0, lost = false, id = 0, timerId = 0;
  const timers = [], nodes = {}, calls = [], restores = [];
  class Element {
    constructor(tag) { this.tagName = tag; this.style = {}; this.children = []; this.listeners = {}; this.hidden = false; this.disabled = false; }
    set id(value) { this._id = value; nodes[value] = this; }
    get id() { return this._id; }
    setAttribute(name, value) { this[name] = value; }
    append(...children) { this.children.push(...children); }
    appendChild(child) { this.children.push(child); return child; }
    addEventListener(name, fn) { (this.listeners[name] ||= []).push(fn); }
    removeEventListener(name, fn) { this.listeners[name] = (this.listeners[name] || []).filter(listener => listener !== fn); }
    emit(name) { for (const fn of [...(this.listeners[name] || [])]) fn({}); }
    listenerCount() { return Object.values(this.listeners).reduce((n, listeners) => n + listeners.length, 0); }
  }
  const body = new Element('body'), canvas = new Element('canvas');
  canvas.id = 'scene';
  for (const name of ['loading', 'title', 'hud', 'menu']) { const node = new Element('div'); node.id = name; }
  const gl = {
    canvas,
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
    document: Object.assign(new Element('document'), { createElement: tag => new Element(tag), getElementById: name => nodes[name], body }),
    canvas, gl, renderer, scene, sceneRT: {}, camera: {}, view: { w: 800, h: 450 },
    performance: { now: () => now },
    setTimeout(fn, delay = 0) { const timer = { id: ++timerId, fn, due: now + delay }; timers.push(timer); return timer.id; },
    clearTimeout(id) { const index = timers.findIndex(timer => timer.id === id); if (index >= 0) timers.splice(index, 1); },
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
    visibility(hidden, emit = true) { ctx.document.hidden = hidden; if (emit) ctx.document.emit('visibilitychange'); },
    fenceClean() { assert.equal(timers.length, 0); assert.equal(ctx.document.listenerCount() + canvas.listenerCount(), 0); },
    async timer({lateBy=0}={}) {
      assert.ok(timers.length, 'an explicit fence poll was scheduled');
      timers.sort((a,b) => a.due-b.due);
      const next = timers.shift(); now = next.due + lateBy; next.fn();
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
  assert.equal(h.calls.filter(x => x === 'wait').length, 3,'the deadline poll checks actual GPU status before rejecting');
  assert.equal(h.calls.filter(x => x === 'delete').length, 1);
});

test('a late fence poll accepts actual completion before applying the wall-clock deadline',async()=>{
  const h=harness({statuses:[3]});
  const pending=vm.runInContext('gpuDiagWaitForFence(gl,50)',h.ctx);
  await h.timer({lateBy:1000});
  const receipt=await pending;
  assert.ok(receipt.waitMs>=1000,'background throttling delayed observation');
  assert.deepEqual(h.calls,['fence','flush','wait','delete']);
});
test('a late fence poll still rejects a pending GPU fence beyond the deadline',async()=>{
  const h=harness({defaultStatus:4});
  const rejected=assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)',h.ctx),/timed out after 50 ms/);
  await h.timer({lateBy:1000}); await rejected;
  assert.deepEqual(h.calls,['fence','flush','wait','delete']);
  assert.equal(h.timers.length,0);
});

test('loss while waiting stops further GL polling or cleanup commands', async () => {
  const h = harness();
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,100)', h.ctx), /context was lost/);
  h.lose();
  await h.drain();
  await rejected;
  assert.deepEqual(h.calls, ['fence','flush']);
});

// Visibility is a CPU fixture input here; no browser flags or real page state are spoofed.
for (const eventDelivered of [true, false]) test('hidden time beyond the fence deadline does not spend visible time, event=' + eventDelivered, async () => {
  const h = harness({ defaultStatus: 4 });
  const pending = vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx); let failed = false;
  pending.catch(() => { failed = true; });
  await h.timer(); h.visibility(true, eventDelivered);
  await h.timer({ lateBy: 1000 });
  assert.equal(failed, false); assert.equal(h.timers.length, 1);
  h.visibility(false); await h.timer(); assert.equal(failed, false);
  const rejected = assert.rejects(pending, /timed out after 50 ms of visible waiting/);
  await h.timer({ lateBy: 100 }); await rejected; h.fenceClean();
});

test('a pending fence after background idle still needs actual completion after returning', async () => {
  const h = harness({ statuses: [4,4,3] });
  const pending = vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx); let completed = false;
  pending.then(() => { completed = true; });
  await h.timer(); h.visibility(true); await h.timer({ lateBy: 1000 });
  assert.equal(completed, false, 'visibility never substitutes for a signaled GPU fence');
  h.visibility(false); await h.timer();
  const receipt = await pending;
  assert(receipt.waitMs >= 1000); assert.equal(receipt.visibleWaitMs, 0); assert(receipt.hiddenWaitMs >= 1000);
  assert.equal(h.calls.filter(x => x === 'wait').length, 3); h.fenceClean();
});

test('actual GPU completion while hidden wins before any elapsed deadline', async () => {
  const h = harness({ statuses: [3] }), pending = vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx);
  h.visibility(true); await h.timer({ lateBy: 1000 });
  const receipt = await pending; assert.equal(receipt.visibleWaitMs, 0);
  assert(receipt.waitMs >= 1000); h.fenceClean();
});

test('WAIT_FAILED stays fatal while hidden and leaves no timer or listeners', async () => {
  const h = harness({ defaultStatus: 5 });
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /rejected the GPU completion wait/);
  h.visibility(true); await h.timer({ lateBy: 1000 }); await rejected;
  assert.deepEqual(h.calls, ['fence','flush','wait','delete']); h.fenceClean();
});

for (const latch of [false, true]) test('a hidden context-loss event rejects immediately without later GL work, global latch=' + latch, async () => {
  const h = harness({ defaultStatus: 4 });
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /context was lost/);
  h.visibility(true); if (latch) h.lose(); h.notifyLoss(); await rejected;
  assert.deepEqual(h.calls, ['fence','flush']); h.fenceClean();
});

test('context loss reported by the completion query cannot become a successful fence', async () => {
  const h = harness(); h.gl.clientWaitSync = () => { h.calls.push('wait'); h.lose(); return 3; };
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /context was lost/);
  await h.timer(); await rejected;
  assert.deepEqual(h.calls, ['fence','flush','wait']); h.fenceClean();
});

test('a thrown completion query rejects and cleans the healthy sync without retry', async () => {
  const h = harness(); h.gl.clientWaitSync = () => { h.calls.push('wait'); throw Error('controlled wait failure'); };
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /controlled wait failure/);
  await h.timer(); await rejected;
  assert.deepEqual(h.calls, ['fence','flush','wait','delete']); h.fenceClean();
});

test('cleanup exceptions reject the fence instead of leaving an unresolved promise', async () => {
  const h = harness(); h.gl.deleteSync = () => { h.calls.push('delete'); throw Error('controlled cleanup failure'); };
  const rejected = assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /controlled cleanup failure/);
  await h.timer(); await rejected; h.fenceClean();
});

for (const loseDuringFlush of [false, true]) test('a failed flush rejects without scheduling a poll, context loss=' + loseDuringFlush, async () => {
  const h = harness();
  h.gl.flush = () => { h.calls.push('flush'); if (loseDuringFlush) h.lose(); throw Error('controlled flush failure'); };
  await assert.rejects(vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx), /controlled flush failure/);
  assert.deepEqual(h.calls, loseDuringFlush ? ['fence','flush'] : ['fence','flush','delete']); h.fenceClean();
});

test('completion removes its callbacks and ignores a previously captured visibility callback', async () => {
  const h = harness(), pending = vm.runInContext('gpuDiagWaitForFence(gl,50)', h.ctx);
  const oldVisibility = h.ctx.document.listeners.visibilitychange[0];
  await h.timer(); await pending; oldVisibility(); h.fenceClean();
  assert.equal(h.calls.filter(x => x === 'delete').length, 1);
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
  const calls = [], nodes = { loading: { style: {} }, loadbar: { style: {} } };
  const ctx = {
    BOOT_SAFE: safe, GAME: { ready: false }, window: { __hm: { ready: false } },
    performance: { now: () => 0 }, tod: { p: 1 }, camera: { updateMatrixWorld() {} },
    DUN: { root: {} }, INDOOR: { on: false }, scene: {}, lastNow: 0,
    $: id => nodes[id],
    loadSave: async () => null,
    loadStep: async (frac,msg,fn) => ctx.runBootWork(fn,{workMs:0,maxChunkMs:0,maxSliceMs:0,chunks:0,yields:0}),
    nextPaint: async () => {},
    graphicsAssertActive() {}, graphicsCheckpoint() {},
    graphicsRunDiagnostic: async () => { calls.push('diagnostic'); return diagnostic; },
    netSharedSceneFlushBuilt: () => calls.push('scene-ready'),
    perf2Compile: () => calls.push('compile'),
    perf2Shaders: async () => calls.push('shader-wait'),
    buildMapImage: () => calls.push('map'),
    buildDungeonMap: () => calls.push('dungeon-map'),
    *prepareMeadowRGBChunks() { calls.push('meadow-start'); yield; calls.push('meadow-ready'); },
    *prepareSoundBuffersChunks() { assert.equal(ctx.GAME.ready,false); calls.push('sound-start'); yield; calls.push('sound-ready'); return true; },
    *prepareGroundAOChunks() { assert.equal(ctx.GAME.ready,false); calls.push('ground-start'); yield; calls.push('ground-ready'); return true; },
    prepareTitleDraft: () => { assert.equal(ctx.GAME.ready,false); calls.push('draft-prepare'); return false; },
    finishTitleDraft: () => { assert.equal(ctx.GAME.ready,true); assert.equal(ctx.window.__hm.ready,true); calls.push('draft-finish'); return false; },
    renderFirstTitleFrame: async () => { assert.equal(ctx.GAME.ready,false); calls.push('title-draw'); },
    graphicsRecoveryNotice: () => calls.push('recovery-notice'),
    tick: () => {throw Error('boot must not simulate a title frame');},
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
  ctx.buildWorldChunks=ctx.mtnHeightsChunks=ctx.buildStructuresChunks=function*(){yield;};
  ctx.buildMapImageChunks=function*(){ctx.buildMapImage();yield;};
  ctx.buildDungeonMapChunks=function*(){ctx.buildDungeonMap();yield;};
  const start = mainSource.indexOf('async function boot() {');
  const end = mainSource.indexOf('\n}',start);
  assert.ok(start>=0 && end>start);
  vm.createContext(ctx);
  const workStart=mainSource.indexOf('const BOOT_WORK_BUDGET_MS'),workEnd=mainSource.indexOf('async function loadStep(');
  assert.ok(workStart>=0&&workEnd>workStart);
  vm.runInContext(mainSource.slice(workStart,workEnd)+'\n'+mainSource.slice(start,end+2),ctx);
  return {ctx,calls,nodes};
}

test('diagnostic boot returns before compilation, map, first tick, title and normal RAF', async () => {
  const h = bootHarness({diagnostic:true,safe:true});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['meadow-start','meadow-ready','scene-ready','diagnostic']);
  assert.equal(h.ctx.GAME.ready,false);
  assert.equal(h.ctx.window.__hm.ready,false);
});
test('boot releases canonical scene updates only after its private world snapshot is restored',async()=>{
  const h=bootHarness({diagnostic:false,safe:true});
  const saved={settings:{quality:'medium'},world:{fixture:'private checkpoint'}};
  h.ctx.loadSave=async()=>{assert.equal(h.ctx.GAME.built,false);return saved;};
  h.ctx.applySettings=value=>{assert.equal(value,saved.settings);h.calls.push('settings-restored');};
  h.ctx.applyWorldSave=value=>{assert.equal(value,saved.world);h.calls.push('private-world-restored');};
  h.ctx.netSharedSceneFlushBuilt=()=>{assert.equal(h.ctx.GAME.built,true);h.calls.push('scene-ready');};
  h.ctx.resize=()=>h.calls.push('sizing');
  await vm.runInContext('boot()',h.ctx);
  assert(h.calls.indexOf('settings-restored')<h.calls.indexOf('private-world-restored'));
  assert(h.calls.indexOf('private-world-restored')<h.calls.indexOf('scene-ready'));
  assert(h.calls.indexOf('scene-ready')<h.calls.indexOf('sizing'));
  assert(h.calls.indexOf('sizing')<h.calls.indexOf('sound-start'));
  assert(h.calls.indexOf('diagnostic')<h.calls.indexOf('sound-start'));
  assert(h.calls.indexOf('sound-ready')<h.calls.indexOf('draft-prepare'));
  assert(h.calls.indexOf('draft-prepare')<h.calls.indexOf('map'));
});

test('ordinary safe boot still renders its first view and enters the normal loop', async () => {
  const h = bootHarness({diagnostic:false,safe:true});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['meadow-start','meadow-ready','scene-ready','diagnostic','sound-start','sound-ready','ground-start','ground-ready','draft-prepare','map','dungeon-map','title-draw','draft-finish','title','recovery-notice','raf']);
  assert.equal(h.ctx.GAME.ready,true);
  assert.equal(h.ctx.window.__hm.ready,true);
});

test('ordinary boot reaches its fenced title without bulk-compiling hidden world or dungeon shaders', async () => {
  const h = bootHarness({diagnostic:false,safe:false});
  const forbidden = name => () => { throw Error('ordinary boot must not invoke '+name); };
  h.ctx.perf2Compile=forbidden('bulk world compilation');
  h.ctx.perf2Shaders=forbidden('bulk shader wait');
  h.ctx.spellCompileVisible=forbidden('hidden spell visibility');
  h.ctx.renderer.compile=forbidden('renderer.compile');
  Object.defineProperty(h.ctx.DUN.root,'visible',{set:forbidden('hidden dungeon visibility')});
  await vm.runInContext('boot()',h.ctx);
  assert.deepEqual(h.calls,['meadow-start','meadow-ready','scene-ready','diagnostic','sound-start','sound-ready','ground-start','ground-ready','draft-prepare','map','dungeon-map','title-draw','draft-finish','title','recovery-notice','raf']);
  assert.equal(h.ctx.GAME.ready,true);
});

test('a retained early draft still awaits the real title gate and avoids resetting the form',async()=>{
  const h=bootHarness({diagnostic:false,safe:false});let release;
  h.ctx.prepareTitleDraft=()=>{assert.equal(h.ctx.GAME.ready,false);h.calls.push('draft-prepare');return true;};
  h.ctx.finishTitleDraft=()=>{assert.equal(h.ctx.GAME.ready,true);h.calls.push('draft-finish');return true;};
  h.ctx.renderFirstTitleFrame=()=>{h.calls.push('title-draw');return new Promise(resolve=>{release=resolve;});};
  const pending=vm.runInContext('boot()',h.ctx);
  for(let i=0;i<200&&!release;i++)await Promise.resolve();
  assert.equal(typeof release,'function');assert.equal(h.ctx.GAME.ready,false);assert.equal(h.ctx.window.__hm.ready,false);
  assert.equal(h.calls.includes('draft-finish'),false);assert.equal(h.calls.includes('title'),false);assert.equal(h.calls.includes('raf'),false);
  release();await pending;
  assert.deepEqual(h.calls,['meadow-start','meadow-ready','scene-ready','diagnostic','sound-start','sound-ready','ground-start','ground-ready','draft-prepare','map','dungeon-map','title-draw','draft-finish','recovery-notice','raf']);
  assert.equal(h.nodes.loading.hidden,true);
});

test('optional sound preparation failure preserves every normal title readiness gate',async()=>{
  const h=bootHarness({diagnostic:false,safe:false});
  h.ctx.prepareSoundBuffersChunks=function*(){assert.equal(h.ctx.GAME.ready,false);h.calls.push('sound-start');yield;return false;};
  await vm.runInContext('boot()',h.ctx);
  assert(h.calls.indexOf('sound-start')<h.calls.indexOf('draft-prepare'));
  assert(h.calls.indexOf('draft-prepare')<h.calls.indexOf('title-draw'));
  assert(h.calls.indexOf('title-draw')<h.calls.indexOf('draft-finish'));
  assert(h.calls.indexOf('draft-finish')<h.calls.indexOf('raf'));
  assert.equal(h.ctx.GAME.ready,true);assert.equal(h.ctx.window.__hm.ready,true);
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
