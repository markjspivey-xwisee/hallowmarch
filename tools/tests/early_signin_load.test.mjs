/** Actual save generations and boot order with controlled storage/render ports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const saveSource = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8').split('function graphicsSaveSettings()')[0];
const main = readFileSync(new URL('../../src/13_main.js', import.meta.url), 'utf8');
const bootSource = main.slice(main.indexOf('const BOOT_STEPS'), main.indexOf('\n/* ------------------------------------------------------------------ */', main.indexOf('async function boot()')));
const copy = value => value == null ? value : structuredClone(value);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function flush() { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); }
async function until(predicate) { for (let n = 0; n < 30 && !predicate(); n++) await flush(); assert(predicate(), 'The controlled actual-source operation must reach its expected boundary.'); }
const saved = owner => ({ v: 1, char: { name: owner + ' character', realm: 0, cls: 'warrior', level: 3 },
  settings: { owner }, world: { owner } });

function fixture(initial = {}) {
  let now = 0, timerId = 0;
  const timers = new Map(), counts = { refs: 0, reads: 0, writes: 0, keys: 0, settings: [], world: [], titles: [],
    builds: {}, fences: 0, frames: 0, drafts: [], finalDrafts: 0 };
  const plan = { value: saved('A'), ...initial }, fence = deferred();
  const nodes = Object.fromEntries(['loading', 'loadbar', 'loadmsg'].map(id => [id, {
    style: {}, hidden: false, parentElement: { setAttribute() {} }, setAttribute() {},
  }]));
  const context = vm.createContext({ console, URL, JSON, structuredClone,
    setTimeout(fn, delay) { const id = ++timerId; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout: id => timers.delete(id),
    performance: { now: () => now }, window: { __hm: { ready: false } }, $: id => nodes[id] || null,
    GAME: { ready: false, started: false }, GRAPHICS_STARTUP: { stopped: false }, GRAPHICS_CONTEXT_LOST: false,
    NETWS: { host: 'game.example', acct: { id: 'owner' }, token: 'old-proof', generation: 7, reload: false },
    CLASSES: { warrior: {} }, LEVEL_CAP: 50, NATIVE_PLAYER: { status: { verified: true }, profile: null },
    netServerUrl: () => 'wss://game.example/ws', localStorage: { getItem: () => assert.fail('Native reads cannot fall back to browser saves.') },
    coreKey: JSON.stringify, applySettings: value => counts.settings.push(copy(value)), applyWorldSave: value => counts.world.push(copy(value)),
    setupTitle: value => counts.titles.push({ value: copy(value), ready: context.GAME.ready, current: context.H.SAVE.loading,
      readConfirmed: context.H.SAVE.readConfirmed }),
    graphicsAssertActive() { if (context.GRAPHICS_CONTEXT_LOST || context.GRAPHICS_STARTUP.stopped) throw Error('Graphics stopped'); },
    graphicsCheckpoint() {}, nextPaint: async () => {}, graphicsRunDiagnostic: async () => false,
    netSharedSceneFlushBuilt() {}, tod: { p: 0.5 }, camera: { updateMatrixWorld() {} }, lastNow: 0,
    renderFirstTitleFrame: async () => { counts.fences++; await fence.promise; },
    prepareTitleDraft: value => { counts.drafts.push(copy(value)); return false; }, finishTitleDraft: () => { counts.finalDrafts++; return false; },
    graphicsRecoveryNotice() {}, frame() {}, requestAnimationFrame: () => { counts.frames++; },
  });
  for (const name of ['buildWorldChunks', 'uploadWorldTextures', 'buildTerrain', 'buildWater', 'buildTrees', 'buildNearTrees',
    'buildRocks', 'buildHeroTree', 'buildCrags', 'buildStructuresChunks', 'buildBarrowSurface', 'buildSurvival', 'buildBoats', 'buildDungeon',
    'buildGrass', 'buildFlowers', 'buildNature', 'buildFarming', 'prepareMeadowRGBChunks', 'mtnHeightsChunks', 'buildCrowds',
    'buildParticles', 'buildSpellFX', 'buildFireflies', 'buildWeather', 'buildAmbientLife', 'buildDragon', 'buildLootMeshes',
    'initCamps', 'initTowns', 'initMerchants', 'initWar', 'initWildlife', 'initAnimals', 'spawnDragon', 'initBarrow',
    'groupOutdoors', 'resize', 'applyTimeOfDay', 'updateCamera', 'prepareSoundBuffersChunks', 'prepareGroundAOChunks',
    'prepareSeasonMapChunks', 'buildMapImageChunks', 'buildDungeonMapChunks']) {
    context[name] = () => { counts.builds[name] = (counts.builds[name] || 0) + 1; };
  }
  vm.runInContext(saveSource + '\n' + bootSource + `\n
    globalThis.H = { SAVE, loadSave, saveLoadOwned, saveLoadTitle, boot,
      current: (...args) => saveLoadCurrent(...args), presented: (...args) => saveLoadPresented(...args),
      apply: (...args) => saveLoadApply(...args), invalidate: (...args) => saveLoadInvalidate(...args) };
  `, context);
  context.nativePlayerSaveRef = async initialization => {
    const selected = { ...plan }; counts.refs++; context.H.SAVE.native = true;
    initialization.owner = context.NETWS.acct.id; initialization.host = context.NETWS.host;
    if (selected.refGate) await selected.refGate.promise;
    if (selected.refFailure) throw Error('Synthetic identity discovery failed');
    return { native: true, async get() { counts.reads++; if (selected.readGate) await selected.readGate.promise;
      if (selected.failure) throw Error('Synthetic private read failed'); return { exists: true, data: () => copy(selected.value) }; },
    set() { counts.writes++; assert.fail('Startup never writes a private save.'); }, delete() { counts.writes++; assert.fail('Startup never deletes a private save.'); } };
  };
  return { context, H: context.H, counts, plan, fence, timers,
    async advance(ms) { const end = now + ms; for (;;) { let next;
      for (const [id, task] of timers) if (task.at <= end && (!next || task.at < next[1].at)) next = [id, task];
      if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    } now = end; await flush(); },
  };
}

test('explicit invalidation releases only the old boot waiter and retains the original pending private operation', async () => {
  const readGate = deferred(), f = fixture({ readGate }); let returned = false, originalSettled = false;
  const waiting = f.H.loadSave().then(value => { returned = true; return value; }); await until(() => f.counts.reads === 1);
  const old = f.H.SAVE.loading; old.promise.then(() => { originalSettled = true; });
  let coalescedReturned = false;
  const coalesced = f.H.loadSave({ retry: true }).then(value => { coalescedReturned = true; return value; }); await flush();
  assert.equal(f.H.invalidate(old), true); await flush();
  assert.equal(returned, true); assert.equal(await waiting, null); assert.equal(originalSettled, false);
  assert.equal(coalescedReturned, true); assert.equal(await coalesced, null);
  assert.equal(old.settled, false); assert.equal(old.timedOut, false); assert.equal(old.detached, false);
  assert.equal(f.H.SAVE.loading, null); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
  f.plan.readGate = null; f.plan.value = saved('B'); await f.H.loadSave(); const selected = f.H.SAVE.loading;
  readGate.resolve(); await old.promise; await flush();
  assert.equal(f.H.SAVE.loading, selected); assert.equal(f.H.SAVE.loaded.char.name, 'B character');
  assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.counts.titles.length, 0);
});

test('ordinary retry keeps the same pending read and the original45-second bounded wait', async () => {
  const readGate = deferred(), f = fixture({ readGate }); let firstReturned = false, retryReturned = false;
  const first = f.H.loadSave().then(value => { firstReturned = true; return value; }); await until(() => f.counts.reads === 1);
  const old = f.H.SAVE.loading;
  const retry = f.H.loadSave({ retry: true }).then(value => { retryReturned = true; return value; }); await flush();
  assert.equal(f.H.SAVE.loading, old); assert.equal(f.counts.refs, 1); assert.equal(f.counts.reads, 1);
  await f.advance(44999); assert.equal(firstReturned, false); assert.equal(retryReturned, false);
  await f.advance(1); assert.equal(await first, null); assert.equal(await retry, null);
  assert.equal(old.timedOut, true); assert.equal(old.settled, false); readGate.resolve(); await old.promise;
});

test('post-read title callback runs once only after current-owned hydration and graphics readiness', async () => {
  const f = fixture(); let completed = 0, observed;
  await f.H.loadSave({ retry: true, onTitleReady(load) {
    completed++; observed = { ready: f.context.GAME.ready, current: load === f.H.SAVE.loading,
      titleCurrent: f.counts.titles.at(-1).current === load, readConfirmed: f.counts.titles.at(-1).readConfirmed };
  } });
  assert.equal(completed, 0); assert.equal(f.counts.titles.length, 0);
  f.context.GAME.ready = true; await f.advance(100);
  assert.equal(completed, 1); assert.equal(f.counts.settings.length, 1); assert.equal(f.counts.world.length, 1);
  assert.deepEqual(observed, { ready: true, current: true, titleCurrent: true, readConfirmed: true });
  f.H.saveLoadTitle(f.H.SAVE.loading); await f.advance(1000); assert.equal(completed, 1);
});

test('a confirmed empty selection completes title hydration once without private settings, world, keys or writes', async () => {
  const f = fixture({ value: null }); let completed = 0, observed;
  await f.H.loadSave({ retry: true, onTitleReady(load) {
    completed++; observed = { applied: load.applied, readConfirmed: f.H.SAVE.readConfirmed,
      ready: f.context.GAME.ready, title: f.counts.titles.at(-1).value };
  } });
  assert.equal(completed, 0); assert.equal(f.H.SAVE.readConfirmed, true);
  f.context.GAME.ready = true; await f.advance(100);
  assert.equal(completed, 1); assert.equal(f.H.SAVE.privateApplied, false);
  assert.deepEqual(observed, { applied: true, readConfirmed: true, ready: true, title: null });
  assert.equal(f.counts.settings.length, 0); assert.equal(f.counts.world.length, 0);
  assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
  f.H.saveLoadTitle(f.H.SAVE.loading); assert.equal(completed, 1);
});

test('an applied private snapshot remains a sticky fact after its selection is cleared', async () => {
  const f = fixture(); await f.H.loadSave(); assert.equal(f.H.SAVE.privateApplied, false);
  f.H.apply(); assert.equal(f.H.SAVE.privateApplied, true); assert.equal(f.counts.world.length, 1);
  f.H.apply(); assert.equal(f.counts.world.length, 1);
  f.H.SAVE.loaded = null; f.H.SAVE.readConfirmed = false;
  assert.equal(f.H.SAVE.privateApplied, true); assert.equal(f.H.current(), null); assert.equal(f.H.presented(), null);
});

test('a failed new discovery cannot promote the preceding generation save into current boot authority', async () => {
  const f = fixture(); await f.H.loadSave(); f.H.apply();
  assert.equal(f.counts.world.length, 1); f.H.invalidate(); f.plan.refFailure = true;
  await assert.rejects(f.H.loadSave({ retry: true }), /identity discovery failed/);
  assert.equal(f.H.SAVE.readConfirmed, false);
  assert.notEqual(f.H.SAVE.loading.applied, true, 'Failed discovery is not a confirmed empty selection.');
  assert.equal(f.H.current(), null, 'A settled failure is not proof that the old global SAVE.loaded belongs to this generation.');
  assert.equal(f.H.presented(), null); f.H.apply();
  assert.equal(f.counts.world.length, 1); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
});

test('boot never reuses its resolved old save after a new generation is selected during held GPU preparation', async () => {
  const f = fixture(); const boot = f.H.boot(); await until(() => f.counts.fences === 1);
  assert.deepEqual(f.counts.world.map(value => value.owner), ['A']);
  assert.equal(f.context.GAME.ready, false); assert.equal(f.H.SAVE.privateApplied, true);
  f.H.invalidate(); f.plan.value = saved('B'); await f.H.loadSave({ retry: true });
  assert.equal(f.H.SAVE.loaded.char.name, 'B character');
  assert.equal(f.H.presented(), null, 'A read B has not yet applied its own private settings/world.');
  f.fence.resolve(); await boot;
  assert.equal(f.counts.titles.at(-1).value, null, 'Final boot cannot present unhydrated B under the original A snapshot.');
  assert.deepEqual(f.counts.world.map(value => value.owner), ['A']);
  await f.advance(100);
  assert.equal(f.counts.titles.at(-1).value.char.name, 'B character');
  assert(!f.counts.titles.some(row => row.value?.char?.name === 'A character'));
  assert.equal(f.counts.builds.buildWorldChunks, 1); assert.equal(f.counts.builds.buildTerrain, 1); assert.equal(f.counts.fences, 1);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
});

test('a new unresolved generation never presents the old boot snapshot while its owned title waits', async () => {
  const f = fixture(); const boot = f.H.boot(); await until(() => f.counts.fences === 1);
  const readGate = deferred(); f.H.invalidate(); f.plan.value = saved('B'); f.plan.readGate = readGate;
  const next = f.H.loadSave({ retry: true }); await until(() => f.counts.reads === 2);
  f.fence.resolve(); await boot;
  assert.equal(f.counts.titles.at(-1).value, null); assert.equal(f.H.SAVE.readConfirmed, false);
  readGate.resolve(); await next; await f.advance(100);
  assert.equal(f.counts.titles.at(-1).value.char.name, 'B character');
  assert.equal(f.counts.fences, 1); assert.equal(f.counts.builds.buildWorldChunks, 1);
});

test('a changed global value is not selected or presented by an earlier completed generation', async () => {
  const f = fixture(); await f.H.loadSave(); f.H.apply(); f.H.SAVE.loaded = saved('unselected');
  assert.equal(f.H.current(), null); assert.equal(f.H.presented(), null);
  f.H.apply(); assert.deepEqual(f.counts.world.map(value => value.owner), ['A']);
});

test('clearing the selected global save while graphics wait cannot masquerade as an owned empty selection', async () => {
  const f = fixture(); let completed = 0;
  await f.H.loadSave({ retry: true, onTitleReady() { completed++; } });
  assert.equal(f.H.SAVE.loaded.char.name, 'A character');
  f.H.SAVE.loaded = null; f.context.GAME.ready = true; await f.advance(100);
  assert.equal(f.counts.titles.length, 0, 'A rejected stale selection cannot hydrate an apparently empty title.');
  assert.equal(completed, 0); assert.equal(f.H.SAVE.loading.applied, undefined);
  assert.equal(f.counts.settings.length, 0); assert.equal(f.counts.world.length, 0);
});

test('partial private application remains sticky and cannot cross an owner change', async () => {
  const f = fixture(); await f.H.loadSave();
  f.context.applySettings = value => { f.counts.settings.push(copy(value)); f.context.NETWS.acct.id = 'other-owner'; };
  assert.equal(f.H.apply(), null); assert.equal(f.H.SAVE.privateApplied, true);
  assert.equal(f.counts.world.length, 0); assert.equal(f.H.presented(), null);
});

test('an invalidated former initializer cannot cancel the new current private read', async () => {
  const f = fixture(); await f.H.loadSave(); const old = f.H.SAVE.loading; f.H.invalidate(old);
  const readGate = deferred(); f.plan.readGate = readGate; f.plan.value = saved('B');
  const next = f.H.loadSave(); await until(() => f.counts.reads === 2); const current = f.H.SAVE.loading;
  assert.equal(f.H.invalidate(old), false); assert.equal(f.H.SAVE.loading, current);
  assert.equal(current.invalidated, false); readGate.resolve(); await next;
  assert.equal(f.H.SAVE.loaded.char.name, 'B character');
});

test('a stale late private failure cannot clear the newer successful owner read', async () => {
  const readGate = deferred(), f = fixture({ readGate, failure: true });
  const first = f.H.loadSave(); await until(() => f.counts.reads === 1); const old = f.H.SAVE.loading;
  f.H.invalidate(old); assert.equal(await first, null);
  Object.assign(f.plan, { readGate: null, failure: false, value: saved('B') }); await f.H.loadSave();
  const current = f.H.SAVE.loading, selected = f.H.SAVE.ref; readGate.resolve(); await old.promise;
  assert.equal(f.H.SAVE.loading, current); assert.equal(f.H.SAVE.ref, selected);
  assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.SAVE.loaded.char.name, 'B character');
  assert.equal(f.counts.titles.length, 0); assert.equal(f.counts.writes, 0);
});

test('callback errors and an owner switch during title setup cannot lift another generation', async () => {
  const f = fixture(); let called = 0;
  f.context.GAME.ready = true;
  await f.H.loadSave({ retry: true, onTitleReady() { called++; throw Error('Synthetic display failure'); } });
  assert.equal(called, 1); assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.SAVE.loaded.char.name, 'A character');
  const g = fixture(); g.context.GAME.ready = true;
  g.context.setupTitle = () => { g.context.NETWS.acct.id = 'another-owner'; };
  let wrongCompletion = 0; await g.H.loadSave({ retry: true, onTitleReady() { wrongCompletion++; } });
  assert.equal(wrongCompletion, 0);
});

test('cancelling a held old discovery frees the actual boot while preserving its original operation and one world/fence', async () => {
  const refGate = deferred(), f = fixture({ refGate }); let oldSettled = false;
  const boot = f.H.boot(); await until(() => f.counts.refs === 1 && f.counts.builds.groupOutdoors === 1);
  const old = f.H.SAVE.loading; old.promise.then(() => { oldSettled = true; });
  f.H.invalidate(old); Object.assign(f.plan, { refGate: null, value: saved('B') });
  const next = f.H.loadSave({ retry: true }); await next; await until(() => f.counts.fences === 1);
  assert.equal(oldSettled, false); assert.equal(old.timedOut, false);
  f.fence.resolve(); await boot; await f.advance(100);
  assert.equal(f.counts.titles.at(-1).value.char.name, 'B character');
  const selected = f.H.SAVE.loading; refGate.resolve(); await old.promise; await flush();
  assert.equal(f.H.SAVE.loading, selected); assert.equal(f.H.SAVE.loaded.char.name, 'B character');
  assert.equal(f.counts.builds.buildWorldChunks, 1); assert.equal(f.counts.fences, 1);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
});
