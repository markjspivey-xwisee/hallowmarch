import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('analyst reads before ordinary initialization cannot start tracking or delivery', async () => {
  const source = readFileSync(new URL('../../src/14y_activity.js', import.meta.url), 'utf8');
  const window = { __hm: {}, addEventListener() {} };
  const context = vm.createContext({ window, registerSavePart() {} });
  vm.runInContext(source + '\nactivityEnsure = () => { throw new Error("Unexpected tracking initialization"); };', context);
  assert.equal(await window.__hm.activity.semanticGraph(), null);
  assert.equal(await window.__hm.activity.patterns(), null);
});

test('actual observation hook freezes IDs and times before the module becomes available', () => {
  const source = readFileSync(new URL('../../src/14y_activity.js', import.meta.url), 'utf8');
  let clock = Date.parse('2026-10-27T18:00:00.000Z'), counter = 0;
  const recorded = [], player = { faction: 0, cls: 'test', name: 'Synthetic' };
  class ClockDate extends Date { constructor(...args) { super(...(args.length ? args : [clock])); } static now() { return clock; } }
  const context = vm.createContext({ GAME: { started: true, player, prog: { level: 1 } }, CAPTURE: { on: false },
    SAVE: { native: false }, NATIVE_PLAYER: {}, NETWS: {}, NET: {}, saveSoon() {}, Date: ClockDate,
    crypto: { randomUUID: () => '00000000-0000-4000-8000-' + String(++counter).padStart(12, '0') } });
  vm.runInContext(source.slice(0, source.indexOf('function activityEntityEvent')) +
    '\nactivityModules = () => Promise.resolve(null); globalThis.H = { activityRecord, activityEnsure, state: GAME_ACTIVITY };', context);
  context.H.activityRecord('resource.gathered', 'stone', 1);
  const queued = JSON.parse(JSON.stringify(context.H.state.queue[0].input));
  clock += 30000;
  context.H.state.module = { createGameplayActivityProfile: () => ({ record(input) { recorded.push(JSON.parse(JSON.stringify(input))); return { recorded: true }; } }) };
  context.H.activityEnsure();
  assert.equal(recorded.length, 1); assert.equal(recorded[0].id, queued.id);
  assert.equal(recorded[0].observedAt, '2026-10-27T18:00:00.000Z');
  assert.equal(recorded[0].observedAt, queued.observedAt);
});
