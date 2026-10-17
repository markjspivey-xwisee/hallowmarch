import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';
import { webcrypto } from 'node:crypto';
import * as activity from './gameplay-activity.mjs';
const copy = value => JSON.parse(JSON.stringify(value));
const tick = () => new Promise(resolve => setImmediate(resolve));
const root = new URL('../../', import.meta.url);
async function body(file, name) {
  const source = await readFile(new URL('src/' + file, root), 'utf8');
  const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start) + 2;
  assert(start >= 0 && end > start); return source.slice(start, end);
}
async function adapter({ native = false } = {}) {
  const source = await readFile(new URL('src/14y_activity.js', root), 'utf8'), parts = {}, saves = [], timers = [];
  const P = { id: 1, name: 'Fixture', cls: 'warrior', faction: 0, alive: true }, pet = { id: 2, alive: true, role: 'companion' };
  const wrapped = { ...activity, createGameplayActivityProfile(options) {
    const profile = activity.createGameplayActivityProfile(copy(options));
    return Object.fromEntries(Object.entries(profile).map(([key, value]) => [key,
      typeof value === 'function' ? (...args) => Reflect.apply(value, profile, args.map(arg => arg === undefined ? undefined : copy(arg))) : value]));
  } };
  const context = vm.createContext({ console, Date, JSON, URL, crypto: webcrypto, setInterval: fn => { timers.push(fn); },
    window: { __hm: {}, addEventListener() {} }, GAME: { started: true, player: P, prog: { level: 1, lore: {} } }, CAPTURE: { on: false },
    SAVE: { native }, NATIVE_PLAYER: { status: native ? { verified: true, binding: { subjectDid: 'did:web:identity.example:users:owner', podUrl: 'https://pod.example/owner/' } } : null, profile: null }, NETWS: { acct: { id: 'character-fixture' }, generation: 1, token: 'not-exported' },
    NET: { party: '' }, mainWorldAgentBodies: () => [{ id: 'character-fixture:companion:fixture', entity: pet }], anOwned: () => false,
    registerSavePart: (where, key, part) => { parts[key] = part; }, saveSoon: delay => { saves.push(delay); }, saveNow: async () => {},
    pathNext: () => ({ id: 'canonical-path', title: 'Existing path objective' }), __loadActivityModule: async () => wrapped });
  vm.runInContext(source.replace("import('/gaming/identity/assets/gameplay-activity.mjs')", '__loadActivityModule()'), context);
  await tick(); await tick();
  return { context, parts, saves, timers, P, pet, api: context.window.__hm.activity,
    evaluate: code => vm.runInContext(code, context) };
}

test('adapter automatically records actual body events in existing save part and preserves the canonical path', async () => {
  const f = await adapter(); f.api.record('resource.gathered', 'stone', 2, { success: true });
  const snapshot = f.api.snapshot(); assert.equal(snapshot.eventCount, 1); assert.equal(snapshot.canonicalPath.id, 'canonical-path');
  assert.equal(snapshot.summary.quantities['resource.gathered'], 2); assert.equal(snapshot.nativeOwned, false);
  assert.equal(snapshot.history.recent[0].actor.kind, 'unattributed'); assert.equal(f.parts.activity.save().schema, activity.GAMEPLAY_ACTIVITY_SCHEMA);
  assert.equal(f.saves.length, 1); assert.equal(f.api.statements().length, 0, 'Local artifact records cannot masquerade as an authenticated native actor');
  const stored = copy(f.parts.activity.save()); f.parts.activity.load(stored);
  assert.equal(f.api.snapshot().eventCount, 1); assert.equal(f.api.snapshot().summary.quantities['resource.gathered'], 2);
});

test('verified native command intent records owned companion and contextual agent without relabelling observer', async () => {
  const f = await adapter({ native: true });
  f.api.record('agent.command-accepted', 'move', 1, { entity: f.pet, actor: { kind: 'agent', id: 'did:web:identity.example:agents:helper',
    grantId: 'urn:uuid:48a438b2-e4ac-46ae-8fd1-d304922c1bd5' }, success: true });
  const statement = f.api.statements()[0]; assert.equal(statement.actor.account.name, 'did:web:identity.example:users:owner');
  assert.equal(statement.context.extensions['urn:interego:gaming:activity:context'].bodyKind, 'owned-unit');
  assert.equal(statement.context.extensions['urn:interego:gaming:activity:context'].controllerId, 'did:web:identity.example:agents:helper');
  assert(!Object.hasOwn(statement.result, 'completion')); const trajectory = f.api.trajectory();
  assert.equal(trajectory.agentDid, 'did:web:identity.example:users:owner'); assert.equal(trajectory.steps.length, 1);
  assert(!JSON.stringify(trajectory).includes('not-exported')); assert(!JSON.stringify(trajectory).includes('grantId'));
});

test('missing owner, capture mode, foreign bodies and observer faults never affect gameplay', async () => {
  const f = await adapter(); f.context.SAVE.native = true;
  assert.equal(f.api.record('craft.completed', 'recipe', 1), null); assert.equal(f.api.snapshot().eventCount, 0);
  f.context.SAVE.native = false; f.context.CAPTURE.on = true;
  assert.equal(f.api.record('craft.completed', 'recipe', 1), null); f.context.CAPTURE.on = false;
  assert.equal(f.api.record('combat.healed', 'guard', 10, { entity: {} }), null);
  f.context.GAME.prog = null; assert.doesNotThrow(() => f.api.record('agent.command-accepted', 'move', 1));
});

test('foraging hooks count goods actually accepted once and ignore an unripe plant', async () => {
  const observed = []; let accepted = 2;
  const context = vm.createContext({ GAME: { player: {}, t: 1 }, SURV: { skill: {} }, FORAGE_KINDS: { shrub: { n: [2, 2], good: 'berries', regrow: 10, name: 'shrub' } },
    Math: Object.assign(Object.create(Math), { random: () => 0.99 }), FORAGE: {}, goodsHave: () => false, goodsAdd: () => accepted,
    activityRecord: (...args) => observed.push(args), uiLog() {}, goodName: id => id, skillGain() {}, sfx() {}, saveSoon() {}, fxAlpha: { emit() {} } });
  vm.runInContext(await body('09s_survival.js', 'forageTake'), context);
  const plant = { k: 'shrub', ripe: 0.5, x: 0, y: 0, z: 0, s: 1 }; assert.equal(context.forageTake(plant), 0); assert.equal(observed.length, 0);
  plant.ripe = 1; assert.equal(context.forageTake(plant), 2); assert.equal(observed.length, 1);
  assert.deepEqual(observed[0].slice(0, 3), ['resource.gathered', 'berries', 2]);
  plant.ripe = 1; accepted = 0; context.forageTake(plant); assert.equal(observed.length, 1, 'Full bags cannot produce a collected-resource claim');
});

test('craft hooks distinguish refused actual attempts from completed outputs', async () => {
  const observed = []; let reason = 'Missing materials';
  const context = vm.createContext({ GAME: { player: {} }, SURV: { skill: {} }, UI: {}, GOODS: {}, GOODS_UI: {},
    craftBlock: () => reason, goodsTakeAll: () => true, goodsHave: () => false, goodsAdd: () => 1, recipeSkill: () => 'craft',
    activityRecord: (...args) => observed.push(args), uiError() {}, skillGain() {}, guideMade() {}, uiLog() {}, saveSoon() {},
    goodName: id => id, Math }); vm.runInContext(await body('09t_craft.js', 'survCraftOnce'), context);
  const recipe = { id: 'planks', need: [], make: ['plank', 1] };
  assert.equal(context.survCraftOnce(recipe), false); assert.equal(observed[0][0], 'craft.refused');
  reason = null; assert.equal(context.survCraftOnce(recipe), true); assert.equal(observed[1][0], 'craft.completed');
  assert.equal(observed.filter(item => item[0] === 'craft.completed').length, 1);
});

test('actual healing records only positive local health restored, never remote estimates', async () => {
  const observed = [];
  const context = vm.createContext({ healWound: () => 1, BAL: {}, classOnHeal() {}, onHealFeedback() {}, forNear() {},
    activityEntityEvent: (...args) => observed.push(args), netOutHeal: () => 99, Math });
  vm.runInContext(await body('07_entities.js', 'healEnt'), context);
  const source = {}, local = { alive: true, role: 'guard', kind: 'humanoid', hp: 90, maxHp: 100, x: 0, z: 0 };
  assert.equal(context.healEnt(source, local, 20), 10); assert.equal(observed.length, 1); assert.equal(observed[0][3], 10);
  assert.equal(context.healEnt(source, local, 20), 0); assert.equal(observed.length, 1);
  assert.equal(context.healEnt(source, { ...local, role: 'remote' }, 20), 99); assert.equal(observed.length, 1);
});
