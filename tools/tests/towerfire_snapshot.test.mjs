import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { checkedSharedScene } from '../../server/shared-scene.js';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const source = read('04n_towerfire.js');
const clone = value => JSON.parse(JSON.stringify(value));
function extract(text, name) {
  const at = text.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  return text.slice(at, text.indexOf('\n}', at) + 2);
}
function vector() { return { values: [], set(...values) { this.values = values; } }; }
function harness() {
  const uniforms = () => ({ value: Array.from({ length: 6 }, vector) });
  const C = { S: { yaw: 0 }, towerU: { uTA: uniforms(), uTB: uniforms(), uTS: uniforms(), uTR: { value: vector() } } };
  const tower = look => ({ look, C, S: { y: 0, name: 'Test keep' }, wx: 10, wz: 20, TT: 8, apex: 14, HO: 3, RO: 3,
    shelterY: 8, kind: look === 'rath' ? 'drum' : 'square', burn: null, fallen: null, char: 0, fresh: 0,
    topFloors: [{ active: true }], topColls: [{ active: true }], heap: { visible: false },
    ladders: [{ yt: 4 }, { yt: 8, gone: false, hatch: { gone: false, k: 0.9, held: true, until: 20, floor: { active: false }, lidColl: { active: true } } }] });
  const towers = [tower('timber'), tower('rath'), tower('stone')], effects = [], parts = {}, microtasks = [];
  const keeper = { C, dirty: false, parts: [{ dirty: false }] };
  const scope = vm.createContext({ TOWER: { list: towers, keeps: [keeper] }, GAME: { t: 100, player: null },
    window: {}, queueMicrotask: fn => microtasks.push(fn), registerSavePart: (area, key, part) => { parts[key] = part; },
    clamp: (v, lo, hi) => Math.max(lo, Math.min(v, hi)), lerp: (a, b, k) => a + (b - a) * k, TW_FIRE_MAX: 6,
    sfxAt: () => effects.push('sound'), uiLog: () => effects.push('log'), news: () => effects.push('news'),
    forNear: () => effects.push('actors'), later: () => effects.push('dust'), cameraShake: () => effects.push('shake'),
    NETPARTS: { keys: {}, applying: false, ready: false, received: 0 }, NETPART_ADAPTERS: new Map() });
  vm.runInContext(source + '\nglobalThis.hooks={TFIRE,towerIgnite,towerFallIn,towerRebuilt,towerFireRestore};', scope);
  for (const fn of microtasks) fn();
  const part = parts.towerfire;
  scope.NETPART_ADAPTERS.set('towerfire', { apply: value => part.load(value) });
  vm.runInContext(extract(read('14z_networldparts.js'), 'netWorldPartsApply'), scope);
  return { scope, part, towers, C, keeper, effects, ...scope.hooks };
}
function state(T) {
  const L = T.ladders[1], H = L.hatch;
  return clone({ burn: T.burn && { t: T.burn.t, heat: T.burn.heat, y0: T.burn.y0 }, fallen: T.fallen,
    char: T.char, fresh: T.fresh, floors: T.topFloors, colls: T.topColls,
    ladder: { gone: L.gone, hatch: { gone: H.gone, k: H.k, floor: H.floor, lidColl: H.lidColl } }, heap: T.heap });
}
function frame(rows) { return { v: 1, full: true, parts: rows == null ? {} : { towerfire: rows }, remove: [] }; }

test('fallen follower accepts a later burning snapshot without bypassing live ignition guards', () => {
  const h = harness(), T = h.towers[0];
  h.towerIgnite(T); h.towerFallIn(T);
  assert.equal(T.burn, null); assert.equal(h.towerIgnite(T), false);
  h.effects.length = 0; const stats = clone(h.TFIRE.stats);
  h.scope.netWorldPartsApply(frame([[0, 1, 25, { heat: 0.3, y0: 5, char: 0.4, fresh: 0 }]]));
  assert.equal(T.fallen, null); assert.equal(T.burn.t, 25); assert.equal(T.burn.heat, 0.3);
  assert.equal(T.ladders[1].gone, false); assert.equal(T.ladders[1].hatch.lidColl.active, true);
  assert.equal(T.topFloors[0].active, true); assert.equal(T.heap.visible, false);
  assert.deepEqual(clone(h.TFIRE.stats), stats); assert.deepEqual(h.effects, []);
  assert.equal(h.C.towerU.uTB.value[0].values[1], 0.3);
});

test('burning -> fallen -> omitted/rebuilt -> burning converges through real shared snapshot apply', () => {
  const h = harness(), T = h.towers[0];
  h.scope.netWorldPartsApply(frame([[0, 1, 20]]));
  const fire = { until: 200 }; T.burn.fires.push(fire);
  h.scope.netWorldPartsApply(frame([[0, 2, 0.43, { elapsed: 30, quiet: 10, embers: 0.6, newTimber: 1, char: 0.35, fresh: 0 }]]));
  assert.equal(fire.until, 100); assert.equal(T.burn, null); assert.equal(T.fallen.r, 0.43);
  assert.equal(T.topFloors[0].active, false); assert.equal(T.topColls[0].active, false); assert.equal(T.heap.visible, true);
  assert.equal(T.ladders[1].gone, true); assert.equal(T.ladders[1].hatch.floor.active, false); assert.equal(T.ladders[1].hatch.lidColl.active, false);
  h.scope.netWorldPartsApply(frame(null));
  assert.equal(T.burn, null); assert.equal(T.fallen, null); assert.equal(T.heap.visible, false);
  assert.equal(T.topFloors[0].active, true); assert.equal(T.ladders[1].gone, false);
  h.scope.netWorldPartsApply(frame([[0, 1, 1]]));
  assert.equal(T.burn.t, 1); assert.equal(h.scope.NETPARTS.applying, false);
  assert.deepEqual(h.effects, []); assert.deepEqual(clone(h.TFIRE.stats), { lit: 0, out: 0, fell: 0, rebuilt: 0 });
});

test('repeated snapshots preserve flame objects and produce no repeated collapse effects or actor mutation', () => {
  const h = harness(), T = h.towers[0], burning = [[0, 1, 30, { heat: 0.22, y0: 4, char: 0.55, fresh: 0 }]];
  h.part.load(burning); const B = T.burn, fire = { until: 200 }; B.fires.push(fire);
  h.part.load(burning); assert.equal(T.burn, B); assert.equal(T.burn.fires[0], fire); assert.equal(fire.until, 200);
  const falling = [[0, 2, 0.35, { elapsed: 60, quiet: 8, embers: 0.72, newTimber: 0.9, char: 0.6, fresh: 0 }]];
  h.part.load(falling); const once = state(T); h.part.load(falling);
  assert.deepEqual(state(T), once); assert.deepEqual(h.effects, []);
  assert.equal(h.keeper.dirty, true); assert.equal(h.keeper.parts[0].dirty, true);
  h.keeper.dirty = false; h.keeper.parts[0].dirty = false;
  const F = T.fallen, floors = T.topFloors, colls = T.topColls, heap = T.heap, saved = clone(h.part.save());
  for (let i = 0; i < 100; i++) h.part.load(falling);
  assert.equal(T.fallen, F); assert.equal(T.topFloors, floors); assert.equal(T.topColls, colls); assert.equal(T.heap, heap);
  assert.equal(h.keeper.dirty, false); assert.equal(h.keeper.parts[0].dirty, false);
  assert.deepEqual(clone(h.part.save()), saved); assert.equal(h.TFIRE.dirty.size, 0); assert.deepEqual(h.effects, []);
  assert.equal(h.scope.TOWER.list.length, 3); assert.equal(T.topFloors.length, 1); assert.equal(T.topColls.length, 1);
});

test('save/load round trip preserves exact serialized rain-damped fire, rebuild clocks and standing char/fresh state', () => {
  const sender = harness(), receiver = harness();
  sender.part.load([[0, 1, 12.25, { heat: 0.17, y0: 6.5, char: 0.29, fresh: 0.1 }],
    [1, 2, 0.43, { elapsed: 70.12, quiet: 1.25, embers: 0.31, newTimber: 0.8, char: 0.65, fresh: 0.05 }]]);
  const saved = clone(sender.part.save()); receiver.part.load(saved);
  assert.deepEqual(clone(receiver.part.save()), saved);
  sender.part.load([[0, 0, 0, { char: 0.25, fresh: 0.9 }]]);
  receiver.part.load(clone(sender.part.save()));
  assert.deepEqual(clone(receiver.part.save()), clone(sender.part.save()));
  assert.equal(receiver.towers[0].burn, null); assert.equal(receiver.towers[0].char, 0.25); assert.equal(receiver.towers[0].fresh, 0.9);
});

test('fresh late join and an already fallen replica reach the same canonical state; legacy three-tuples still load', () => {
  const fresh = harness(), stale = harness();
  stale.part.load([[0, 2, 0.2], [1, 1, 15]]);
  const saved = [[0, 1, 22], [1, 2, 0.5]];
  fresh.part.load(saved); stale.part.load(saved);
  assert.deepEqual(state(stale.towers[0]), state(fresh.towers[0]));
  assert.equal(stale.towers[1].fallen.r, 0.5); assert.equal(stale.towers[1].burn, null);
  // A rath loses its thatch, while its platform ladder remains in place.
  assert.equal(stale.towers[1].ladders[1].gone, false);
  assert.deepEqual(fresh.effects, []); assert.deepEqual(stale.effects, []);
});

test('restoring timber/cone state never reopens a ladder owned by a separate tower breach', () => {
  const h = harness(), T = h.towers[0], ladder = T.ladders[1];
  T.breached = true; ladder.brGone = true; ladder.gone = true;
  h.part.load([[0, 1, 12]]); assert.equal(ladder.gone, true); assert.equal(ladder.hatch.gone, true);
  assert.equal(ladder.hatch.floor.active, false); assert.equal(ladder.hatch.lidColl.active, false);
  h.part.load(null); assert.equal(ladder.gone, true); assert.equal(T.topFloors[0].active, false);
});

test('near-complete burns and reconstruction preserve their reported phase and quantized progress', () => {
  const h = harness(), receiver = harness();
  h.part.load([[0, 1, 69.99], [1, 2, 1]]);
  const saved = clone(h.part.save()); receiver.part.load(saved);
  assert.equal(receiver.towers[0].burn.t, 69.99); assert.equal(receiver.towers[1].fallen.r, 1);
  assert.deepEqual(clone(receiver.part.save()), saved); assert.deepEqual(receiver.effects, []);
});

test('invalid/nonfinite snapshot fields cannot inject NaN, select a coerced tower index, or mutate stone towers', () => {
  const h = harness(), stone = state(h.towers[2]);
  h.part.load([[0, 1, 10, { heat: Infinity, y0: NaN, char: -50, fresh: 40 }], ['1', 1, 10],
    [1, 9, 1], [2, 1, 10], [-1, 1, 10], [0.5, 1, 10], [1, 1, Infinity], null]);
  assert.equal(h.towers[0].burn.heat, 10 / 22); assert.equal(h.towers[0].char, 0); assert.equal(h.towers[0].fresh, 1);
  assert.equal(h.towers[1].burn, null); assert.deepEqual(state(h.towers[2]), stone);
  assert.doesNotThrow(() => h.part.load({ invalid: true }));
  h.part.load([[1, 1, 20, 'bad'], [0, 1, 12, { unexpected: 7 }], [1, 1, 20, {}, 'extra']]);
  assert.equal(h.towers[0].burn, null); assert.equal(h.towers[1].burn, null);
});

test('the existing 64-row cap and server shared-scene byte/shape limits accept extended snapshots', () => {
  const h = harness(), T = h.towers[0];
  h.scope.TOWER.list = Array.from({ length: 65 }, () => ({ ...T, burn: null, fallen: null }));
  h.part.load(Array.from({ length: 65 }, (_, i) => [i, 2, 0.55, { elapsed: 999, quiet: 7.5, embers: 0.3, newTimber: 1, char: 0.4, fresh: 0 }]));
  assert.equal(h.scope.TOWER.list[64].fallen, null);
  const rows = clone(h.part.save()); assert.equal(rows.length, 64);
  const worldparts = { ...frame(rows), receipts: [] };
  const scene = { v: 1, worldAdmission: { origin: 'https://march.example', epoch: 1 }, boats: [], npcs: [], entities: null, worldparts };
  assert.ok(Buffer.byteLength(JSON.stringify(scene)) < 16 * 1024);
  assert.ok(checkedSharedScene(scene));
});
