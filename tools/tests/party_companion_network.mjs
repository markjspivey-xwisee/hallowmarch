import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Actual engine + complete network source. Only browser/renderer/world ports
// are controlled here; companion ownership, packing, parsers, ghosts, send
// change keys and movement remain the implementations used by the game.
const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const entities = read('07_entities.js'), ai = read('08_ai.js');
const declarations = entities.slice(entities.indexOf('const FACTION_MONSTER'), entities.indexOf('/* spatial hash'));
const movement = entities.slice(entities.indexOf('const _mv ='), entities.indexOf('function groundY'));
const spawn = ai.slice(ai.indexOf('function spawnRealmUnit'), ai.indexOf('/* ------------------------------------------------------------------ */', ai.indexOf('function spawnRealmUnit')));
const uuid = '2fd428f0-d768-4ec7-9c52-f6c4e1cadce0', another = '7e6e27b5-8536-42c2-9a96-4766ea6261ab';
const plain = value => JSON.parse(JSON.stringify(value));
function client(name = 'observer', realm = 0) {
  let now = 10000;
  const fast = [], slow = [], errors = [];
  const look = () => ({ tabard: [0.5, 0.6, 0.7], armor: [0.4, 0.4, 0.4], skin: 0.2, hair: 0.2, mask: 3, flags: 0, scale: 1, outfit: 0, emblem: 3, fem: 0, bulk: 0 });
  const context = vm.createContext({
    // This transport fixture represents an already live human; lease/idle behavior has dedicated integration tests.
    netHumanSync() {}, netHumanLive: () => true, NET_HUMAN_PLAY: { activity: 1 }, console, Map, Set, Math, Number, Object, Array, JSON, Date,
    performance: { now: () => now }, NETWS: { acct: { id: name }, generation: 1, ws: {} }, UI: { modal: null },
    window: {}, TAU: Math.PI * 2, LEVEL_CAP: 60, WB: { torch: 1 << 20, beater: 1 << 21, hammer: 1 << 22, cape: 1 << 5 },
    CLASSES: { warrior: {}, mage: {}, archer: {}, priest: {} }, WAR_LEVEL_OFF: {}, DRAGON: { e: null }, WAR: { keeps: [] },
    crypto: { randomUUID: () => uuid }, isFiniteNum: Number.isFinite, randomName: () => 'generated', warLevel: () => 1,
    mulberry: () => () => 0.5,
    heightAt: () => 0, floorAt: () => 0, classLook: look, isWalkable: () => true, swimPassable: () => true, segmentClear: () => true,
    resolveCollisions() {}, boatShove() {}, castleStepBlocked: () => false, jettyJumpIn: () => false,
    effectiveSpeed: e => !e.alive ? 0 : e.speed, isStunned: () => false, saveSoon() {}, registerSavePart() {},
    turnToward(e, x, z) { e.yaw = Math.atan2(x - e.x, z - e.z); },
    setupStats(e) { e.maxHp = e.hp = 180; e.maxPower = e.power = 100; },
    updateAnim(e) { e.prevX = e.x; e.prevZ = e.z; }, deathEffects() {}, burnFlames() {},
    netWxRead: () => null, netWxObj: () => null, late2Named: e => e.name, realmRank: () => 1, late3MantleCode: () => 0,
    animActValue: e => e.anim.act || 0, inDungeon: () => false, waterAt: () => null,
    uiLog() {}, reportError: error => errors.push(error), onImpact() {},
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)), lerp: (a, b, k) => a + (b - a) * k,
    angDiff: (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
    dist2: (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2,
    setTimeout: () => 1, clearTimeout() {},
  });
  vm.runInContext(declarations + '\n' + movement + '\n' + spawn + '\n' + read('14v_partycompanion.js') + '\n' + read('14n_net.js') + `
    GAME.player = makeEnt({role:'player',name:${JSON.stringify(name)},cls:'warrior',faction:${realm},level:8,x:0,y:0,z:0,look:classLook()});
    GAME.prog = {level:8,rp:0}; GAME.started = true;
    globalThis.h = { GAME, ENT, NET, NETWS, makeEnt, removeEnt,
      partyCompanionCreate, partyCompanionMove, partyCompanionDismiss, partyCompanionBodies,
      netSlowObj, netFastObj, netSendFast, netSendSlow, netPeerUpdate, netPeerFastGone, netPeerLeft,
      netGhosts, netRemoteStep, netCompanionRead, netIsEnemy, netOutHit, netOutBuff, netOutHeal };
  `, context);
  const h = context.h;
  h.NET.state = 'on'; h.NET.self = name; h.NET.link = { kind: 'ws', connected: () => true,
    setSlow: value => { slow.push(plain(value)); return true; }, setFast: value => { fast.push(plain(value)); return true; } };
  return { h, fast, slow, errors, now: () => now, advance(ms) { now += ms; },
    receive(owner, slowValue = owner.h.netSlowObj(), fastValue = owner.h.netFastObj(owner.now())) {
      h.netPeerUpdate(owner.h.NET.self, { by: owner.h.NETWS.acct.id, slow: plain(slowValue), fast: plain(fastValue) }); h.netGhosts();
      return h.NET.peers.get(owner.h.NET.self);
    } };
}
function sender(name = 'owner') { const c = client(name); c.entity = c.h.partyCompanionCreate(); return c; }

test('stationary human still sends a fresh fast state when actual companion movement changes', () => {
  const c = sender(), playerBefore = [c.h.GAME.player.x, c.h.GAME.player.z];
  c.h.netSendFast(c.now()); assert.equal(c.fast.length, 1);
  c.advance(100); c.h.netSendFast(c.now()); assert.equal(c.fast.length, 1, 'unchanged public bodies do not resend');
  assert.equal(c.h.partyCompanionMove(c.entity, 1, 0, 0.05), true);
  c.advance(100); c.h.netSendFast(c.now()); assert.equal(c.fast.length, 2);
  assert.deepEqual(c.fast[0].p, c.fast[1].p); assert.notDeepEqual(c.fast[0].pc.p, c.fast[1].pc.p);
  assert.deepEqual([c.h.GAME.player.x, c.h.GAME.player.z], playerBefore);
});
test('public companion projection includes bounded gameplay fields only', () => {
  const c = sender(); c.entity.agentDid = 'private-agent'; c.entity.grant = 'private-grant'; c.entity.privateSave = 'private-save';
  c.entity.token = 'private-token'; c.entity.podUrl = 'private-pod'; c.entity.inventory = ['private-inventory'];
  const slow = plain(c.h.netSlowObj()).pc, fast = plain(c.h.netFastObj(c.now())).pc;
  assert.deepEqual(Object.keys(slow).sort(), ['c', 'id', 'l', 'lk', 'n']);
  assert.deepEqual(Object.keys(fast).sort(), ['a', 'd', 'h', 'id', 'm', 'p', 'y']);
  assert.equal(slow.id, uuid); assert.equal(fast.id, uuid); assert.equal(slow.c, 'warrior');
  for (const secret of ['private-agent', 'private-grant', 'private-save', 'private-token', 'private-pod', 'private-inventory']) assert.equal(JSON.stringify([slow, fast]).includes(secret), false);
  assert.ok(JSON.stringify([slow, fast]).length < 500);
});
test('remote companion copies the actual persisted humanoid look rather than a generated substitute', () => {
  const owner = sender(), observer = client();
  owner.entity.look = { tabard: [0.123, 0.456, 0.789], armor: [0.321, 0.654, 0.987], skin: 0.777, hair: 0.789,
    mask: 3455, flags: 7, scale: 1.034, outfit: 2, emblem: 1, fem: 1, bulk: 0.3 };
  owner.entity.scale = owner.entity.look.scale;
  const R = observer.receive(owner), ghost = R.companion.ghost;
  assert.deepEqual(plain(ghost.look), plain(owner.entity.look)); assert.equal(ghost.scale, owner.entity.scale);
  const packed = plain(owner.h.netSlowObj()).pc.lk;
  assert.equal(packed.length, 15); assert.ok(packed.every(Number.isFinite));
});
test('malformed companion looks use existing bounded human look validation without leaking extra fields', () => {
  const c = sender(), input = plain(c.h.netSlowObj()).pc;
  for (const invalid of [null, {}, 'private-secret', [], new Array(16).fill(1)]) {
    const value = c.h.netCompanionRead({ ...input, lk: invalid }, false);
    assert.equal(value.lk, undefined);
  }
  const value = c.h.netCompanionRead({ ...input, lk: ['secret', Infinity, -9, 999, null, {}, 3, -1, 1e10, -1, 99, 99, 99, 99, 99] }, false);
  assert.equal(JSON.stringify(value).includes('secret'), false);
  assert.ok(value.lk.tabard.every(n => n >= 0 && n <= 2)); assert.ok(value.lk.armor.every(n => n >= 0 && n <= 2));
  assert.ok(value.lk.skin >= 0 && value.lk.skin <= 1); assert.ok(value.lk.hair >= 0 && value.lk.hair <= 1);
  assert.ok(value.lk.scale >= 0.85 && value.lk.scale <= 1.12); assert.ok(value.lk.mask >= 0 && value.lk.mask < (1 << 24));
  assert.ok(value.lk.outfit >= 0 && value.lk.outfit <= 3); assert.ok(value.lk.bulk >= 0 && value.lk.bulk <= 0.5);
});
test('one peer projects two independent humanoids; companion motion cannot move human ghost', () => {
  const owner = sender(), observer = client(), R = observer.receive(owner);
  assert.ok(R.ghost); assert.ok(R.companion?.ghost); assert.notEqual(R.ghost, R.companion.ghost);
  assert.equal(R.ghost.kind, 'humanoid'); assert.equal(R.companion.ghost.kind, 'humanoid');
  assert.equal(R.ghost.role, 'remote'); assert.equal(R.companion.ghost.netCompanion, uuid);
  const humanPose = [R.ghost.x, R.ghost.z], oldCompanionX = R.companion.ghost.x;
  owner.h.partyCompanionMove(owner.entity, 1, 0, 0.05); owner.advance(100); observer.advance(100);
  const fast = owner.h.netFastObj(owner.now()); fast.s = 1;
  observer.h.netPeerUpdate('owner', { fast: plain(fast) }); observer.h.netGhosts(); observer.advance(130);
  observer.h.netRemoteStep(R.companion.ghost, 0.05); observer.h.netRemoteStep(R.ghost, 0.05);
  assert.ok(R.companion.ghost.x > oldCompanionX); assert.deepEqual([R.ghost.x, R.ghost.z], humanPose);
  assert.equal(observer.h.GAME.player.name, 'observer'); assert.equal(observer.h.ENT.length, 3);
});
for (const mode of ['fast-gone', 'left', 'dismissed', 'uuid-mismatch', 'off', 'out-of-bounds']) {
  test('companion ghost cleanup: ' + mode, () => {
    const owner = sender(), observer = client(), R = observer.receive(owner), ghost = R.companion.ghost;
    if (mode === 'fast-gone') observer.h.netPeerFastGone('owner');
    else if (mode === 'left') observer.h.netPeerLeft('owner');
    else {
      const slow = plain(owner.h.netSlowObj()), fast = plain(owner.h.netFastObj(owner.now())); fast.s = 1;
      if (mode === 'dismissed') { owner.h.partyCompanionDismiss(); delete slow.pc; delete fast.pc; }
      if (mode === 'uuid-mismatch') fast.pc.id = another;
      if (mode === 'off') slow.on = 0;
      if (mode === 'out-of-bounds') fast.pc.p[0] = 4001;
      observer.h.netPeerUpdate('owner', { slow, fast }); observer.h.netGhosts();
    }
    assert.equal(ghost.removed, true); assert.equal(R.companion, null);
    if (mode === 'left') assert.equal(observer.h.NET.peers.has('owner'), false);
  });
}
test('owner change drops the old companion until both new profile and pose arrive', () => {
  const owner = sender(), observer = client(), R = observer.receive(owner), old = R.companion.ghost;
  observer.h.netPeerUpdate('owner', { by: 'replacement-owner' }); observer.h.netGhosts();
  assert.equal(old.removed, true); assert.equal(R.companion, null);
  const slow = plain(owner.h.netSlowObj()), fast = plain(owner.h.netFastObj(owner.now()));
  slow.pc.id = another; fast.pc.id = another; fast.s = 2;
  observer.h.netPeerUpdate('owner', { slow }); observer.h.netGhosts();
  assert.equal(R.companion, null, 'old retained pose cannot complete a new owner profile');
  observer.h.netPeerUpdate('owner', { fast }); observer.h.netGhosts();
  assert.equal(R.companion.id, another); assert.notEqual(R.companion.ghost, old);
});
for (const id of ['other-owner:companion:' + uuid, 'other-owner:animal:1', 'not-a-uuid', another.toUpperCase()]) {
  test('public companion rejects forged foreign or malformed ID: ' + id, () => {
    const owner = sender(), observer = client(), slow = plain(owner.h.netSlowObj()), fast = plain(owner.h.netFastObj(owner.now()));
    slow.pc.id = id; fast.pc.id = id;
    const R = observer.receive(owner, slow, fast); assert.equal(R.companion, null); assert.ok(R.ghost, 'ordinary human remains visible');
  });
}
for (const [field, value] of [['c', '__proto__'], ['c', 'constructor'], ['l', 0], ['l', 61], ['n', '']]) {
  test('public profile rejects invalid companion ' + field, () => {
    const c = sender(), input = plain(c.h.netSlowObj()).pc; input[field] = value;
    assert.equal(c.h.netCompanionRead(input, false), null);
  });
}
for (const [field, value] of [['p', [0, Infinity, 0]], ['p', [0, 0]], ['y', 51], ['a', 64], ['h', -0.1], ['m', 0], ['d', true]]) {
  test('public pose rejects invalid companion ' + field + '=' + JSON.stringify(value), () => {
    const c = sender(), input = plain(c.h.netFastObj(c.now())).pc; input[field] = value;
    assert.equal(c.h.netCompanionRead(input, true), null);
  });
}
test('foreign caller metadata never enters sanitized public companion readers', () => {
  const c = sender(), profile = plain(c.h.netSlowObj()).pc, pose = plain(c.h.netFastObj(c.now())).pc;
  for (const value of [profile, pose]) Object.assign(value, { agentDid: 'private', grant: { token: 'private' }, inventory: 'private', ownerId: 'victim', accountId: 'victim' });
  assert.equal(JSON.stringify([c.h.netCompanionRead(profile, false), c.h.netCompanionRead(pose, true)]).includes('private'), false);
  assert.equal(c.h.netCompanionRead(profile, false).ownerId, undefined);
});
test('remote companion cannot route combat operations to the human owner by sharing netPeer', () => {
  const owner = sender(), observer = client('observer', 2), R = observer.receive(owner), human = observer.h.GAME.player, ghost = R.companion.ghost;
  assert.equal(observer.h.netIsEnemy(human, ghost), false); assert.equal(observer.h.netIsEnemy(ghost, human), false);
  const before = observer.h.NET.out.length;
  assert.equal(observer.h.netOutHit(human, ghost, 10, {}), 0);
  observer.h.netOutBuff(ghost, 'stun', 1, 1, human.id);
  ghost.faction = human.faction; assert.equal(observer.h.netOutHeal(human, ghost, 10), 0);
  assert.equal(observer.h.NET.out.length, before, 'no hit, buff or heal is addressed to owner peer through its companion');
});
