import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { makeSeason, loadRealmModule } from '../season.js';
import { openHallowmarchWorldState } from './hallowmarch-world-state.js';

const root = new URL('../../', import.meta.url).pathname;
const realmModule = loadRealmModule(root + 'src', root + 'server');

test('timer season saves defer while explicit season.save and direct season writes capture an empty world immediately', async t => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'world-season-save-intent-'));
  t.after(() => rmSync(dataDir, { recursive: true, force: true }));
  let now = Date.now(), saved = { version: 0, state: null }, commits = 0;
  const passthrough = [];
  const nativeStore = { owner: 'urn:world:season-save-intent', async load() { return structuredClone(saved); },
    async commit(id, input) { assert.equal(input.expectedVersion, saved.version); commits++;
      saved = { version: saved.version + 1, state: structuredClone(input.state) }; return structuredClone(saved); } };
  const bridge = await openHallowmarchWorldState({ nativeStore, dataDir, keepCount: 6, realmModule, clock: () => now,
    files: { read(name, fallback) { return fallback; }, write(name) { passthrough.push(name); } } });
  const strategic = makeSeason({ src: root + 'src', here: root + 'server', seasonSpeed: 1, seasonStep: 2000,
    seasonSeed: 19, seasonLen: 28 * 86400, keeps: [0, 0, 1, 1, 2, 2] }, bridge.store,
  { seasonSaves: 0, seasonSteps: 0, seasons: 0 });
  bridge.attach({ worlds: {}, season: strategic, field: { step() {}, report() {}, left() {} }, rooms: new Map() });
  await bridge.checkpoint(); const baseline = commits;
  now += 2000; strategic.lastStep = Date.now() - 2000; strategic.step();
  strategic.save({ background: true });
  await bridge.checkpoint();
  assert.equal(commits, baseline, 'the timer save does not undo idle background deferral');
  assert.equal(bridge.status().backgroundCaptureDeferred, true);
  strategic.save();
  assert.equal(bridge.status().backgroundCaptureDeferred, false);
  assert.equal(bridge.status().pendingSnapshots, 1, 'explicit save captures synchronously before the next timer');
  await bridge.checkpoint(); assert.equal(commits, baseline + 1);
  assert.equal(saved.state.value.season.t, strategic.RS.t);
  assert.ok(passthrough.includes('roster.json')); assert.ok(passthrough.includes('chat.json'));

  // Admin reset replaces RS and calls the same default explicit save path.
  strategic.RS = strategic.M.realmSimInit(20, { season: strategic.RS.n + 1 });
  strategic.save(); await bridge.checkpoint();
  assert.equal(commits, baseline + 2); assert.equal(saved.state.value.season.n, strategic.RS.n);
  strategic.RS.t += 1;
  bridge.store.write('season.json', strategic.RS);
  assert.equal(bridge.status().pendingSnapshots, 1, 'plain store writes are explicit by default');
  await bridge.checkpoint(); assert.equal(commits, baseline + 3);
  await bridge.shutdown();
});
