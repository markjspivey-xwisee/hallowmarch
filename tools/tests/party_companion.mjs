import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const source = readFileSync(new URL('../../src/14v_partycompanion.js', import.meta.url), 'utf8');
const entities = readFileSync(new URL('../../src/07_entities.js', import.meta.url), 'utf8');
const ai = readFileSync(new URL('../../src/08_ai.js', import.meta.url), 'utf8');
const entitySource = entities.slice(entities.indexOf('const FACTION_MONSTER'), entities.indexOf('/* spatial hash'));
const movementSource = entities.slice(entities.indexOf('const _mv ='), entities.indexOf('function groundY'));
const spawnSource = ai.slice(ai.indexOf('function spawnRealmUnit'), ai.indexOf('/* ------------------------------------------------------------------ */', ai.indexOf('function spawnRealmUnit')));
const fightSource = ai.slice(ai.indexOf('function fightTarget'), ai.indexOf('// [v12] a chase', ai.indexOf('function fightTarget')));
const plain = value => JSON.parse(JSON.stringify(value));
const uuid = '2fd428f0-d768-4ec7-9c52-f6c4e1cadce0';
function fixture() {
  let saves = 0, collision = false, walkable = true;
  const parts = new Map();
  const context = vm.createContext({ console, Map, Set, Math, Number, Object, Array, JSON,
    NETWS: { acct: { id: 'owner-one' } }, UI: { modal: null }, TAU: Math.PI * 2, LEVEL_CAP: 60,
    dist: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
    CLASSES: { warrior: {}, mage: {}, archer: {}, priest: {} }, WAR_LEVEL_OFF: {}, DRAGON: { e: null },
    crypto: { randomUUID: () => uuid }, isFiniteNum: Number.isFinite,
    randomName: () => 'generated', warLevel: () => 1, heightAt: () => 0, floorAt: () => 0,
    classLook: () => ({ tabard: [0.5, 0.6, 0.7], armor: [0.4, 0.4, 0.4], skin: 0.2, hair: 0.2, mask: 3, flags: 0, scale: 1, outfit: 0, emblem: 3, fem: 0, bulk: 0 }),
    setupStats(e) { e.maxHp = e.hp = 100 + e.level * 10; e.maxPower = e.power = 100; },
    saveSoon() { saves++; }, registerSavePart(where, key, part) { parts.set(where + ':' + key, part); },
    isWalkable: () => walkable, swimPassable: () => walkable, segmentClear: () => walkable,
    resolveCollisions(point, radius, by, faction) { if (collision) { point.x = context.wallX; point.z = context.wallZ; } },
    boatShove() {}, castleStepBlocked: () => false, jettyJumpIn: () => false,
    effectiveSpeed: e => e.rooted || e.stunned || !e.alive ? 0 : e.speed,
    isStunned: e => !!e.stunned, turnToward(e, x, z) { e.yaw = Math.atan2(x - e.x, z - e.z); },
    inDungeon: e => !!e.dungeon, isEnemy: (a, b) => a.faction !== b.faction,
    wallsSeekLine: () => false, bandGateShotStep: () => false, castleClimbToward: () => false, fightChase() {},
  });
  vm.runInContext(entitySource + '\n' + movementSource + '\n' + spawnSource + '\n' + fightSource + '\n' + source + `
    GAME.player = makeEnt({role:'player',name:'Human',cls:'warrior',faction:1,level:8,x:0,y:0,z:0});
    GAME.started = true;
    globalThis.h = { GAME, ENT, PARTY_COMPANION, NETWS, UI, makeEnt, removeEnt,
      partyCompanionCreate, partyCompanionBodies, partyCompanionOwned, partyCompanionMove,
      partyCompanionTick, partyCompanionStop, partyCompanionSave, partyCompanionLoad, partyCompanionSetRole, partyCompanionDismiss, partyCompanionMember };
  `, context);
  return { h: context.h, parts, saves: () => saves,
    collision(on, entity) { collision = on; context.wallX = entity?.x; context.wallZ = entity?.z; },
    walkable(on) { walkable = on; } };
}
function created() { const f = fixture(); f.entity = f.h.partyCompanionCreate(); return f; }

test('creates a separate normal humanoid, preserving human controller and ownership', () => {
  const f = fixture(), player = f.h.GAME.player, before = plain(player);
  const e = f.h.partyCompanionCreate();
  assert.notEqual(e, player); assert.equal(e.role, 'companion'); assert.equal(e.kind, 'humanoid');
  assert.equal(e.cls, player.cls); assert.equal(e.level, 8); assert.equal(e.name, 'AI companion');
  assert.equal(e.bot, undefined); assert.deepEqual(plain(player), before);
  assert.equal(f.saves(), 1); assert.equal(f.h.partyCompanionOwned(player), false);
  assert.equal(f.h.partyCompanionBodies()[0].id, 'owner-one:companion:' + uuid);
  assert.equal(f.parts.has('char:partyCompanion'), true);
});
test('one companion per character, including after it falls or corpse is removed', () => {
  const f = created(); assert.throws(() => f.h.partyCompanionCreate('Second'), /already has/);
  f.entity.alive = false; f.entity.hp = 0; f.h.removeEnt(f.entity);
  assert.throws(() => f.h.partyCompanionCreate('Replacement'), /fallen/);
  const record = f.h.partyCompanionSave(); assert.equal(record.alive, false); assert.equal(record.hp, 0);
  assert.equal(f.h.partyCompanionBodies().length, 0);
  assert.equal(f.h.partyCompanionMember().entity, f.entity, 'down roster survives corpse removal');
});
test('private character save round trips stable identity, look, pose and injured ratios without healing', () => {
  const f = created(); f.entity.hp = f.entity.maxHp * 0.23; f.entity.power = 19;
  f.entity.x = 45.25; f.entity.z = 33.5; f.entity.yaw = 1.2;
  const saved = plain(f.h.partyCompanionSave()), old = f.entity;
  saved.agentDid = 'never saved'; saved.grant = { token: 'never saved' };
  f.h.partyCompanionLoad(saved); const current = f.h.PARTY_COMPANION.entity;
  assert.equal(old.removed, true); assert.notEqual(old.id, current.id);
  assert.equal(f.h.partyCompanionBodies()[0].id, 'owner-one:companion:' + uuid);
  assert.deepEqual([current.x, current.z, current.yaw], [45.25, 33.5, 1.2]);
  assert.ok(Math.abs(current.hp / current.maxHp - 0.23) < 1e-12); assert.equal(current.power, 19);
  const again = plain(f.h.partyCompanionSave()); assert.equal(again.agentDid, undefined); assert.equal(again.grant, undefined);
  assert.deepEqual(again.look, saved.look); assert.equal(f.saves(), 1, 'load does not publish a new save');
});
test('a fallen persisted unit reloads down, even with inconsistent positive saved health', () => {
  const f = created(), saved = plain(f.h.partyCompanionSave()); saved.alive = false; saved.hp = 0.8;
  f.h.partyCompanionLoad(saved); const e = f.h.PARTY_COMPANION.entity;
  assert.equal(e.alive, false); assert.equal(e.hp, 0); assert.equal(e.removeAt, f.h.GAME.t + 10);
  const x = e.x; f.h.partyCompanionMove(e, 1, 0, 0.05); f.h.partyCompanionTick(0.05);
  assert.equal(e.x, x); assert.equal(f.h.partyCompanionSave().alive, false);
});
test('zero health cannot become an alive reload', () => {
  const f = created(), saved = plain(f.h.partyCompanionSave()); saved.hp = 0;
  f.h.partyCompanionLoad(saved); assert.equal(f.h.PARTY_COMPANION.entity.alive, false);
});
for (const [key, value] of [['id', 'bad'], ['cls', '__proto__'], ['cls', 'constructor'], ['level', 1e8], ['level', 1.4], ['hp', -1], ['hp', 1.1], ['power', NaN], ['x', Infinity], ['z', 4001], ['alive', 'yes'], ['v', 2], ['role', 'possess-player'], ['role', 'guard']]) {
  test('malformed saved ' + key + '=' + String(value) + ' removes old body and fails closed', () => {
    const f = created(), saved = plain(f.h.partyCompanionSave()); saved[key] = value;
    f.h.partyCompanionLoad(saved); assert.equal(f.entity.removed, true); assert.equal(f.h.partyCompanionSave(), null);
    assert.equal(f.h.partyCompanionBodies().length, 0); assert.equal(f.h.ENT.length, 1);
  });
}
test('new character load unloads previous companion and missing legacy part adds none', () => {
  const f = created(); f.h.GAME.player = f.h.makeEnt({ role: 'player', cls: 'mage', faction: 2, level: 4 });
  assert.equal(f.h.partyCompanionOwned(f.entity), false); assert.equal(f.h.partyCompanionSave(), null);
  f.h.partyCompanionLoad(undefined); assert.equal(f.entity.removed, true); assert.equal(f.h.partyCompanionBodies().length, 0);
});
test('changed account never exposes or moves a prior owner body', () => {
  const f = created(), x = f.entity.x; f.h.NETWS.acct = { id: 'owner-two' };
  assert.equal(f.h.partyCompanionBodies().length, 0); assert.equal(f.h.partyCompanionOwned(f.entity), false);
  assert.equal(f.h.partyCompanionMove(f.entity, 1, 0, 0.05), false); assert.equal(f.entity.x, x);
});
test('normal movement respects actual stepTo collision, speed, root, and vector bounds', () => {
  const f = created(), e = f.entity, before = e.x;
  assert.equal(f.h.partyCompanionMove(e, 1, 0, 0.05), true);
  assert.ok(e.x > before && e.x - before <= e.speed * 0.05 + 1e-9);
  const x = e.x, z = e.z; f.collision(true, e);
  assert.equal(f.h.partyCompanionMove(e, 1, 0, 0.05), false); assert.deepEqual([e.x, e.z], [x, z]);
  f.collision(false); e.rooted = true; assert.equal(f.h.partyCompanionMove(e, 1, 0, 0.05), false);
  e.rooted = false;
  for (const [dx, dz, dt] of [[2, 0, 0.05], [NaN, 0, 0.05], [1, 0, 1], [1, 0, -1]]) assert.equal(f.h.partyCompanionMove(e, dx, dz, dt), false);
  assert.deepEqual([e.x, e.z], [x, z]);
});
test('follow uses ordinary motion and does not double move an actively held body', () => {
  const f = created(), e = f.entity; f.h.GAME.player.x = 20;
  const before = e.x; f.h.partyCompanionTick(0.05); assert.ok(e.x > before);
  const heldAt = [e.x, e.z]; f.h.partyCompanionTick(0.05, { held: new Set([e]) });
  assert.deepEqual([e.x, e.z], heldAt); assert.equal(f.h.GAME.player.x, 20);
  f.collision(true, e); f.h.partyCompanionTick(0.05); assert.deepEqual([e.x, e.z], heldAt);
});
test('explicit pause, menu, inactive game or dead owner stops follow and target without resetting physics or casts', () => {
  const f = created(), e = f.entity; f.h.GAME.player.x = 20;
  for (const mode of ['pause', 'menu', 'inactive', 'dead']) {
    e.target = 999; const cast = { id: 'mend' }, motion = { kind: 'knockback' }; e.casting = cast; e.motion = motion;
    const before = [e.x, e.z]; f.h.UI.modal = mode === 'menu' ? 'players' : null;
    f.h.GAME.started = mode !== 'inactive'; f.h.GAME.player.alive = mode !== 'dead';
    f.h.partyCompanionTick(0.05, { paused: mode === 'pause' });
    assert.deepEqual([e.x, e.z], before); assert.equal(e.target, null);
    assert.equal(e.casting, cast); assert.equal(e.motion, motion);
  }
});
test('held cast, physical motion and stun refuse direct native movement', () => {
  const f = created(), e = f.entity, before = [e.x, e.z];
  for (const field of ['casting', 'motion', 'stunned']) { e[field] = true; assert.equal(f.h.partyCompanionMove(e, 1, 0, 0.05), false); e[field] = null; }
  assert.deepEqual([e.x, e.z], before);
});
test('creation requires active owned character and clear ground; names contain no markup/control text', () => {
  const f = fixture(); f.h.GAME.started = false; assert.throws(() => f.h.partyCompanionCreate(), /Enter/);
  f.h.GAME.started = true; f.h.NETWS.acct = null; assert.throws(() => f.h.partyCompanionCreate(), /Enter/);
  f.h.NETWS.acct = { id: 'owner-one' }; f.walkable(false); assert.throws(() => f.h.partyCompanionCreate(), /clear ground/);
  assert.equal(f.h.ENT.length, 1); f.walkable(true);
  assert.equal(f.h.partyCompanionCreate('<AI>\u200b & "buddy"', 'mage').name, 'AI  buddy');
});
test('guard persists its ground anchor and ignores a moving human until role changes', () => {
  const f = created(), e = f.entity, at = [e.x, e.z];
  f.h.partyCompanionSetRole('guard'); f.h.GAME.player.x = 20; f.h.partyCompanionTick(0.05);
  assert.deepEqual([e.x, e.z], at); const saved = plain(f.h.partyCompanionSave());
  assert.equal(saved.role, 'guard'); assert.deepEqual(saved.guard, { x: at[0], z: at[1] });
  f.h.partyCompanionLoad(saved); assert.deepEqual(plain(f.h.partyCompanionSave().guard), saved.guard);
  const loaded = f.h.PARTY_COMPANION.entity; loaded.x += 2; f.h.partyCompanionTick(0.05);
  assert.ok(loaded.x < at[0] + 2); assert.equal(f.saves(), 2);
});
test('support follows more closely and engages only the current validated human NPC target', () => {
  const f = created(), e = f.entity;
  f.h.partyCompanionSetRole('support');
  const foe = f.h.makeEnt({ role: 'mob', faction: 3, x: 10, z: 0 }); f.h.GAME.player.target = foe.id;
  const playerBefore = plain(f.h.GAME.player), x = e.x;
  f.h.partyCompanionTick(0.05); assert.equal(e.target, foe.id); assert.ok(e.x > x);
  assert.deepEqual(plain(f.h.GAME.player), playerBefore);
  f.h.GAME.player.target = null; f.h.partyCompanionTick(0.05); assert.equal(e.target, null);
});
for (const mode of ['remote', 'friendly', 'far-human', 'far-companion', 'dungeon', 'dead', 'removed', 'door']) {
  test('support refuses invalid target: ' + mode, () => {
    const f = created(), e = f.entity; f.h.partyCompanionSetRole('support');
    const foe = f.h.makeEnt({ role: mode === 'remote' ? 'remote' : 'mob', faction: mode === 'friendly' ? 1 : 3, x: mode === 'far-human' ? 19 : 10, z: 0 });
    if (mode === 'far-companion') e.x = -30;
    if (mode === 'dungeon') foe.dungeon = true;
    if (mode === 'dead') foe.alive = false;
    if (mode === 'removed') f.h.removeEnt(foe);
    if (mode === 'door') foe.kind = 'door';
    e.target = foe.id; f.h.GAME.player.target = foe.id; f.h.partyCompanionTick(0.05);
    assert.equal(e.target, null);
  });
}
test('held native body runs no support role and invalid role does not change retained role', () => {
  const f = created(), e = f.entity; f.h.partyCompanionSetRole('support');
  const foe = f.h.makeEnt({ role: 'mob', faction: 3, x: 10, z: 0 }); f.h.GAME.player.target = foe.id;
  const before = [e.x, e.z]; f.h.partyCompanionTick(0.05, { held: new Set([e]) });
  assert.equal(e.target, null); assert.deepEqual([e.x, e.z], before);
  assert.throws(() => f.h.partyCompanionSetRole('possess-player'), /Choose follow/);
  assert.equal(f.h.partyCompanionSave().role, 'support');
});
test('explicit dismissal removes body and private record without touching player, including down state', () => {
  const f = created(), player = f.h.GAME.player, before = plain(player);
  f.entity.alive = false; f.entity.hp = 0; f.h.removeEnt(f.entity);
  f.h.partyCompanionDismiss(); assert.equal(f.h.partyCompanionSave(), null); assert.equal(f.h.PARTY_COMPANION.record, null);
  assert.deepEqual(plain(player), before); assert.equal(f.saves(), 2);
});
