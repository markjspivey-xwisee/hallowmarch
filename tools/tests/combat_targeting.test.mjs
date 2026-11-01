import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
function extract(source, name) {
  const at = source.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name);
  return source.slice(at, source.indexOf('\n}', at) + 2);
}
function targeting() {
  const P = { id: 1, x: 0, y: 0, z: 0, faction: 0, alive: true, target: null };
  const entities = [2, 3, 4].map((id, i) => ({ id, alive: true, x: 0, y: 0, z: 4 + i * 4,
    faction: 1, kind: 'humanoid', scale: 1, role: 'soldier' }));
  const c = vm.createContext({ GAME: { player: P }, ENT: [P, ...entities], CAM: { yaw: 0 },
    camera: { position: { x: 0, y: 3, z: -8 } }, performance: { now: () => 0 },
    dist: (x, z, a, b) => Math.hypot(x - a, z - b), dist2: (x, z, a, b) => (x - a) ** 2 + (z - b) ** 2,
    angDiff: (a, b) => b - a, clamp: (n, a, b) => Math.max(a, Math.min(b, n)), sfx() {},
    towerSightBlocked: (a, b) => !!b.towerBlocked, npSeen: e => !e.occluded,
    isEnemy: (a, b) => a.faction !== b.faction,
    screenOf: e => e, forNear: (x, z, r, cb) => entities.forEach(cb) });
  const source = read('09_player.js');
  const helper = source.includes('function playerTargetVisible(') ? extract(source, 'playerTargetVisible') : '';
  vm.runInContext(helper + '\n' + ['setPlayerTarget', 'cycleTarget', 'pickAt'].map(n => extract(source, n)).join('\n'), c);
  c.screenOf = (x, y, z) => z === 0 ? null : ({ x: 100, y: 100 });
  return { c, P, entities };
}

test('forward and reverse targeting start at opposite ends, then wrap predictably', () => {
  const f = targeting();
  f.c.cycleTarget(); assert.equal(f.P.target, 2);
  f.c.cycleTarget(); assert.equal(f.P.target, 3);
  f.c.cycleTarget(true); assert.equal(f.P.target, 2);
  f.P.target = null; f.c.cycleTarget(true); assert.equal(f.P.target, 4);
  f.c.cycleTarget(true); assert.equal(f.P.target, 3);
});

for (const property of ['towerBlocked', 'occluded', 'removed', 'flying']) {
  test('target cycling skips ' + property + ' bodies while retaining the next visible foe', () => {
    const f = targeting(); f.entities[0][property] = true;
    f.c.cycleTarget(); assert.equal(f.P.target, 3);
  });
}

test('a fully hidden group produces no selected target', () => {
  const f = targeting(); f.entities.forEach(e => e.occluded = true);
  f.P.target = 2; f.c.cycleTarget(); assert.equal(f.P.target, null);
});

for (const property of ['towerBlocked', 'occluded']) {
  test('pointer targeting cannot select a body hidden by ' + property, () => {
    const f = targeting(); f.entities[0][property] = true;
    f.entities[1].occluded = true; f.entities[2].occluded = true;
    f.c.pickAt(100, 100); assert.equal(f.P.target, null);
    f.entities[0][property] = false;
    f.c.pickAt(100, 100); assert.equal(f.P.target, 2);
  });
}

test('a selected nameplate still respects the same occlusion check as other names', () => {
  const f = targeting(); f.P.target = 2; f.entities[0].occluded = true;
  f.entities.splice(1); f.c.ENT = [f.P, f.entities[0]];
  const created = [];
  Object.assign(f.c, { UI: { npPool: [] }, IS_TOUCH: false, FACTION_MONSTER: 4, view: { w: 1280, h: 720 },
    $: () => ({ appendChild: el => created.push(el) }),
    document: { createElement() { throw new Error('An occluded body must not create a plate'); } } });
  vm.runInContext(extract(read('10_ui.js'), 'updateNameplates'), f.c);
  f.c.updateNameplates(); assert.deepEqual(created, []);
});

test('tower floors and walls participate in the cached nameplate visibility result', () => {
  const f = targeting(); const e = f.entities[0]; let calls = 0;
  Object.assign(f.c, { renderTime: 1, INDOOR: { on: false },
    towerSightBlocked: () => { calls++; return true; } });
  vm.runInContext(extract(read('10p_hud.js'), 'npSeen'), f.c);
  assert.equal(f.c.npSeen(e, 12), false);
  assert.equal(f.c.npSeen(e, 12), false);
  assert.equal(calls, 1, 'the existing short visibility cache also bounds tower checks');
});

test('a retained hostile target blocked by a tower explains the obstacle rather than asking for a hostile target', () => {
  const f = targeting(), messages = []; f.P.cls = 'warrior'; f.P.target = 2;
  f.entities[0].towerBlocked = true;
  Object.assign(f.c, { CLASSES: { warrior: { abilities: ['test'] } }, ABILITIES: { test: { level: 1 } },
    getEnt: id => f.entities.find(e => e.id === id), useAbility: () => 'target', uiError: text => messages.push(text) });
  vm.runInContext(extract(read('09_player.js'), 'playerUseSlot'), f.c);
  f.c.playerUseSlot(0);
  assert.deepEqual(messages, ['Your target is hidden by a wall or floor']);
});

function completion() {
  const target = { id: 2, alive: true, faction: 1, x: 4, z: 0 };
  const P = { role: 'player', faction: 0, power: 20, x: 0, z: 0,
    casting: { id: 'test', targetId: 2 } };
  const messages = [], executed = [];
  const c = vm.createContext({ ABILITIES: { test: { id: 'test', cost: 10 } },
    getEnt: () => target, isEnemy: (a, b) => a.faction !== b.faction,
    dist: (x, z, a, b) => Math.hypot(x - a, z - b), abilityRange: () => 20,
    classOvercast: () => false, uiError: text => messages.push(text),
    executeAbility: (...args) => executed.push(args) });
  vm.runInContext(extract(read('07_entities.js'), 'finishCast'), c);
  return { c, P, target, messages, executed };
}

for (const why of ['dead', 'changed', 'missing']) {
  test('cast completion explains a ' + why + ' hostile target without spending power', () => {
    const f = completion();
    if (why === 'dead') f.target.alive = false;
    if (why === 'changed') f.target.faction = 0;
    if (why === 'missing') f.c.getEnt = () => null;
    f.c.finishCast(f.P);
    assert.deepEqual(f.messages, ['Your target is no longer available']);
    assert.equal(f.executed.length, 0); assert.equal(f.P.power, 20); assert.equal(f.P.casting, null);
  });
}

test('a depleted cast explains the missing power; an NPC cancellation stays quiet', () => {
  const f = completion(); f.P.power = 5;
  f.c.finishCast(f.P); assert.deepEqual(f.messages, ['Not enough power to finish casting']);
  assert.equal(f.executed.length, 0);
  f.messages.length = 0; f.P.role = 'soldier'; f.P.casting = { id: 'test', targetId: 2 };
  f.target.alive = false; f.c.finishCast(f.P); assert.deepEqual(f.messages, []);
});

test('a valid completed cast and friendly fallback keep their existing execution', () => {
  const f = completion(); f.c.finishCast(f.P);
  assert.equal(f.executed.length, 1); assert.deepEqual(f.messages, []);
  f.c.ABILITIES.test.friendly = true; f.target.alive = false;
  f.P.casting = { id: 'test', targetId: 2 }; f.c.finishCast(f.P);
  assert.equal(f.executed.length, 2); assert.equal(f.executed[1][2], f.P);
  assert.deepEqual(f.messages, []);
});
