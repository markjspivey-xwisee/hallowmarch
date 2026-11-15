import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { loadRealmModule, makeSeason } from '../season.js';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { openHallowmarchWorldState, checkedWorldSnapshot, hallowmarchWorldDescription } from './hallowmarch-world-state.js';

const root = fileURLToPath(new URL('../../', import.meta.url));
const realmModule = loadRealmModule(root + 'src', root + 'server');
const season = () => ({ ...realmModule.realmSimInit(19, { season: 1 }), savedAt: Date.now() });
const options = { keepCount: 6, realmModule };

async function inactiveBootFixture(t, { savedAt = true, absent = false } = {}) {
  let now = 1700000000000, commits = 0, native = { version: 0, state: null };
  t.mock.method(Date, 'now', () => now);
  const directory = mkdtempSync(path.join(tmpdir(), 'world-confirmed-idle-boot-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const nativeStore = { owner: 'urn:world:confirmed-idle-boot', async load() { return structuredClone(native); },
    async commit(id, input) { assert.equal(input.expectedVersion, native.version); commits++;
      native = { version: native.version + 1, state: structuredClone(input.state) }; return structuredClone(native); } };
  if (!absent) {
    const value = checkedWorldSnapshot({ worlds: { march: { cn: 7 } },
      season: { ...realmModule.realmSimInit(19, { season: 1 }), t: 321, ...(savedAt ? { savedAt: now } : {}) } }, options);
    const writer = createProgressiveOwnedState({ store: nativeStore, streamId: 'hallowmarch-world-season-v1', clock: () => now });
    await writer.start({ seed: () => value }); await writer.shutdown({ checkpoint: false });
  }
  const confirmed = structuredClone(native), priorCommits = commits;
  now += 3 * 86400000;
  const bridge = await openHallowmarchWorldState({ nativeStore, dataDir: directory, ...options,
    files: { read: (name, fallback) => fallback, write() { assert.fail('No file write expected'); } },
    active: false, clock: () => now });
  t.after(() => bridge.shutdown({ checkpoint: false }));
  const strategic = makeSeason({ src: root + 'src', here: root + 'server', seasonSpeed: 1, seasonStep: 5000,
    seasonSeed: 19, seasonLen: 28 * 86400, keeps: [0, 0, 1, 1, 2, 2], seasonLiveOnly: true }, bridge.store,
  { seasons: 0, seasonSaves: 0, seasonSteps: 0 });
  const worlds = bridge.store.read('worlds.json', {});
  return { bridge, strategic, worlds, confirmed, bootCommits: () => commits - priorCommits,
    native: () => structuredClone(native),
    attach: () => bridge.attach({ worlds, season: strategic,
      field: { step() {}, report() {}, left() {}, held: new Map() }, rooms: new Map() }) };
}

for (const savedAt of [true, false]) test(`confirmed live-only startup preserves the exact native head with savedAt ${savedAt ? 'present' : 'absent'}`, async t => {
  const f = await inactiveBootFixture(t, { savedAt });
  assert.equal(f.bridge.status().durable, true);
  f.attach();
  const status = f.bridge.status();
  assert.equal(status.pendingSnapshots, 0, 'Rebasing the scheduler clock is not a world mutation');
  assert.equal(status.durable, true); assert.equal(status.state, 'confirmed');
  assert.equal(status.liveVersion, f.confirmed.state.liveVersion);
  assert.equal(status.confirmedLiveVersion, status.liveVersion); assert.equal(status.confirmedVersion, f.confirmed.version);
  assert.equal(f.strategic.RS.t, 321); assert.deepEqual(f.worlds, f.confirmed.state.value.worlds);
  await new Promise(resolve => setTimeout(resolve, 20)); await f.bridge.checkpoint();
  await f.bridge.shutdown({ checkpoint: false });
  assert.equal(f.bootCommits(), 0); assert.deepEqual(f.native(), f.confirmed);
});

for (const part of ['world', 'season']) test(`inactive attach still retains a genuine ${part} change for the next permitted checkpoint`, async t => {
  const f = await inactiveBootFixture(t);
  if (part === 'world') f.worlds.march.cn++;
  else f.strategic.RS.t++;
  f.attach();
  assert.equal(f.bridge.status().pendingSnapshots, 1); assert.equal(f.bridge.status().durable, false);
  await f.bridge.checkpoint(); await f.bridge.suspend({ checkpoint: false });
  assert.equal(f.bootCommits(), 0); assert.deepEqual(f.native(), f.confirmed);
  f.bridge.setActive(true); await f.bridge.checkpoint();
  assert.equal(f.bootCommits(), 1); assert.equal(f.bridge.status().durable, true);
  assert.equal(f.native().state.value.worlds.march.cn, part === 'world' ? 8 : 7);
  assert.equal(f.native().state.value.season.t, part === 'season' ? 322 : 321);
});

test('an absent native world retains its new season migration seed until live activation', async t => {
  const f = await inactiveBootFixture(t, { absent: true }); f.attach();
  assert.equal(f.bridge.status().confirmedVersion, 0); assert.equal(f.bridge.status().pendingSnapshots, 1);
  assert.equal(f.bridge.status().durable, false);
  await f.bridge.checkpoint(); assert.equal(f.bootCommits(), 0);
  f.bridge.setActive(true); await f.bridge.checkpoint();
  assert.equal(f.bootCommits(), 1); assert.equal(f.native().state.value.season.v, 1);
  assert.equal(f.bridge.status().durable, true);
});

test('domain snapshot permits only the world/season pair, omits optional undefined JSON fields and accepts generated shard names', () => {
  const value = checkedWorldSnapshot({ worlds: { ['x'.repeat(32) + '-99']: { k: [0, 0, 1, 1, 2, 2], cl: undefined } }, season: season() }, options);
  assert.equal(Object.hasOwn(value.worlds['x'.repeat(32) + '-99'], 'cl'), false);
  for (const extra of ['accounts', 'credentials', 'playerSave', 'roster', 'chat', 'companies', 'learning']) {
    assert.throws(() => checkedWorldSnapshot({ worlds: {}, season: season(), [extra]: {} }, options), { code: 'INVALID_WORLD_STATE' });
  }
});

test('domain snapshot rejects unknown room fields and invalid strategic input before a sanitizer could replace it with a fresh season', () => {
  for (const value of [{ worlds: { march: { personalSave: {} } }, season: season() },
    { worlds: {}, season: { v: 1, n: 1, t: 0, len: 100, realms: [], keeps: [] } },
    { worlds: {}, season: { ...season(), realms: [{}, {}, {}] } },
    { worlds: { march: { k: [0, 1] } }, season: season() },
    { worlds: { march: { cn: Infinity } }, season: season() }]) {
    assert.throws(() => checkedWorldSnapshot(value, options), { code: 'INVALID_WORLD_STATE' });
  }
});

test('world bridge advertises a public read-only operation and keeps game authority limits explicit', () => {
  const value = hallowmarchWorldDescription('https://game.example');
  const operations = value.description['hydra:supportedOperation']; assert.equal(operations.length, 1);
  assert.equal(operations[0]['hydra:method'], 'GET'); assert.equal(operations[0]['hydra:target']['@id'], 'https://game.example/gaming/world-state');
  assert.match(value.graphContent, /does not add authoritative combat/); assert.doesNotMatch(value.graphContent, /i2idl|privateKey|accessToken/);
  for (const origin of ['https://game.example/path', 'http://other.example', 'https://name:secret@game.example', 'https://game.example/?x=1']) assert.throws(() => hallowmarchWorldDescription(origin));
});

test('actual pinned Interego affordance extraction discovers the composed world status operation', { skip: !process.env.INTEREGO_SDK_TEST_ROOT }, async () => {
  const core = await import(pathToFileURL(process.env.INTEREGO_SDK_TEST_ROOT + '/packages/core/dist/index.js').href);
  const value = hallowmarchWorldDescription('https://game.example');
  const actions = core.extractAffordancesFromTurtle(value.graphContent, 'https://game.example/gaming/world-state/descriptor');
  assert.equal(actions.length, 1); assert.equal(actions[0].action, 'urn:hallowmarch:world:status');
  assert.equal(actions[0].method, 'GET'); assert.equal(actions[0].target, 'https://game.example/gaming/world-state');
});


test('empty world background ticks coalesce for five minutes while player mutations capture immediately', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'world-idle-budget-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let now = 1000000, commits = 0, saved = { version: 0, state: null };
  const nativeStore = { owner: 'urn:world:budget', async load() { return structuredClone(saved); },
    async commit(id, input) { assert.equal(input.expectedVersion, saved.version); commits++;
      saved = { version: saved.version + 1, state: structuredClone(input.state) }; return structuredClone(saved); } };
  const bridge = await openHallowmarchWorldState({ nativeStore, dataDir: directory,
    files: { read: (name, fallback) => fallback, write() {} }, ...options, clock: () => now });
  const strategic = { RS: season(), M: realmModule, lastStep: now,
    step() { this.RS.t += 2; this.lastStep = now; }, order() { this.RS.t += 1; } };
  const room = { diagnostic: true, clients: new Map([['qa', {}]]) };
  const field = { step() {}, report() {}, left() {} };
  bridge.attach({ worlds: {}, season: strategic, field, rooms: new Map([['qa', room]]) });
  await bridge.checkpoint(); const baseline = commits;
  for (let elapsed = 2000; elapsed < 300000; elapsed += 2000) {
    now += 2000; strategic.step(); field.step();
    if (elapsed % 30000 === 0) bridge.store.write('season.json', strategic.RS, { background: true });
  }
  assert.equal(bridge.status().backgroundCaptureDeferred, true); assert.equal(bridge.status().durable, false);
  await bridge.checkpoint(); assert.equal(commits, baseline, 'diagnostic sockets do not turn idle ticks into native writes');
  now += 2000; strategic.step(); await bridge.checkpoint(); assert.equal(commits, baseline + 1);
  assert.equal(bridge.status().backgroundCaptureDeferred, false); assert.equal(bridge.status().durable, true);
  strategic.order(); await bridge.checkpoint(); assert.equal(commits, baseline + 2, 'explicit mutations bypass idle delay');
  room.diagnostic = false; now += 2000; strategic.step(); await bridge.checkpoint();
  assert.equal(commits, baseline + 3, 'occupied world captures every simulation update for normal checkpoint coalescing');
  room.diagnostic = true; now += 2000; strategic.step();
  assert.equal(bridge.status().backgroundCaptureDeferred, true);
  await bridge.shutdown(); assert.equal(commits, baseline + 4, 'shutdown captures deferred background state before draining');
  assert.equal(saved.state.value.season.t, strategic.RS.t);
});

test('shared rollback pauses mutations, restores every room through recovery and fences uncertain outcomes', async t => {
  const directory = mkdtempSync(path.join(tmpdir(), 'world-rollback-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  let saved = { version: 0, state: null }, original, bridge, failRestore = false;
  const nativeStore = { owner: 'urn:world:rollback', async load() { return structuredClone(saved); },
    async commit(id, input) { assert.equal(input.expectedVersion, saved.version);
      saved = { version: saved.version + 1, state: structuredClone(input.state) }; return structuredClone(saved); },
    async rollbackCheckpoints() { return [{ at: 1000, version: 1 }]; },
    async restoreWorldAt(at, options) {
      await options.beforeRestore();
      assert.equal(at, 1000); assert.equal(bridge.canMutate(), false);
      assert.throws(() => bridge.assertMutable(), { code: 'WORLD_FENCED' });
      if (failRestore) throw new Error('uncertain native rollback');
      saved = { version: saved.version + 1, state: structuredClone(original.state) };
      return { version: saved.version, targetAt: at, replayed: false };
    } };
  bridge = await openHallowmarchWorldState({ nativeStore, dataDir: directory,
    files: { read: (name, fallback) => fallback, write() {} }, ...options });
  const worlds = { march: { cn: 3 } }, strategic = { RS: season(), M: realmModule, speed: 1, lastStep: Date.now() };
  const client = { toldSeason: true, seasonT: 12 }, room = { clients: new Map([['one', client]]), rep: [1], wxSavedAt: 50 };
  const field = { held: new Map([['keep', 1]]) };
  bridge.attach({ worlds, season: strategic, field, rooms: new Map([['march', room]]) });
  await bridge.checkpoint(); original = structuredClone(saved);
  worlds.march.cn = 9; bridge.capture();
  assert.deepEqual(await bridge.rollbackCheckpoints(), [{ at: 1000, version: 1 }]);
  const result = await bridge.rollback(1000, { idempotencyKey: 'rollback-command' });
  assert.equal(result.persistence.fenced, false); assert.equal(bridge.canMutate(), true);
  assert.equal(worlds.march.cn, 3); assert.equal(field.held.size, 0); assert.deepEqual(room.rep, []);
  assert.equal(client.toldSeason, false); assert.equal(client.seasonT, 0);
  failRestore = true;
  await assert.rejects(bridge.rollback(1000, { idempotencyKey: 'uncertain-command' }));
  assert.equal(bridge.canMutate(), false);
});


test('public shared scene survives the owned world checkpoint without admitting private character state', () => {
  const activity = { v: 1, worldAdmission: { origin: 'https://game.example', epoch: 1 },
    boats: [], npcs: [], entities: { v: 1, full: true, rows: [], remove: [] },
    worldparts: { v: 1, full: true, parts: { build: { pieces: [] } }, remove: [], receipts: [] } };
  const value = checkedWorldSnapshot({ worlds: { march: { activity } }, season: season() }, options);
  assert.equal(value.worlds.march.activity.v, 1);
  assert.equal(value.worlds.march.activity.worldparts.parts.build.pieces.length, 0);
  for (const bad of [{ ...activity, v: 2 }, { ...activity, npcs: [{ id: 'private-character' }] },
    { ...activity, boats: [{ id: 1, x: Infinity }] }, { ...activity, worldAdmission: { origin: 'bad', epoch: 0 } }]) {
    assert.throws(() => checkedWorldSnapshot({ worlds: { march: { activity: bad } }, season: season() }, options),
      { code: 'INVALID_WORLD_STATE' });
  }
});
