// Run: node --test tools/tests/warband_replication.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
const base = process.env.HALLOWMARCH_BASE_SOURCE || src;
const campaign = readFileSync(resolve(src, '08g_campaign.js'), 'utf8');
const replication = readFileSync(resolve(src, '14x_netentities.js'), 'utf8');
const ai = readFileSync(resolve(base, '08_ai.js'), 'utf8');
const siege = readFileSync(resolve(base, '04i_siege3.js'), 'utf8');
function declaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing real function ${name}`);
  const lineEnd = source.indexOf('\n', start);
  return source.slice(start, source.slice(start, lineEnd).trimEnd().endsWith('}')
    ? lineEnd : source.indexOf('\n}', start) + 2);
}

function fixture(clock = 100, self = 'publisher') {
  const nodes = Array.from({ length: 15 }, (_, id) => ({ id, x: id * 30, z: id * 2 }));
  const realms = [0, 1, 2].map((id) => ({ id, name: `Realm ${id}`, templeName: `Temple ${id}`,
    hallow: `Hallow ${id}`, hallowName: `Hallow ${id}`, musterSite: { name: `Muster ${id}` },
    templeSite: { x: 90 + id * 150, z: 6 },
    nav: { muster: nodes[id * 5], tg: nodes[id * 5 + 3], tc: nodes[id * 5 + 4] } }));
  const keeps = [0, 1, 2].map((id) => ({ id, realm: (id + 1) % 3, orig: id,
    site: { name: `Keep ${id}`, x: 80 + id * 150, z: 2 },
    nav: { gate: nodes[id * 5 + 1], court: nodes[id * 5 + 2] },
    door: { alive: true }, guards: new Set() }));
  const temples = realms.map((r) => ({ id: r.id, realm: r.id, site: { name: r.templeName, ...r.templeSite },
    nav: r.nav, door: { alive: true } }));
  const relics = realms.map((r) => ({ id: r.id, realm: r.id, state: 'temple', at: (r.id + 1) % 3 }));
  const unit = (id, x) => ({ id, netEntityId: `scene:soldier:${id}`, role: 'soldier', x, z: 0, yaw: 0,
    faction: 0, alive: true, carrying: null, cls: 'warrior', mount: null, target: null,
    ai: { nextScan: Infinity, remountAt: Infinity } });
  const leader = unit(11, 0), follower = unit(12, -10), removedMember = unit(13, -20);
  const engineActor = { id: 30, netEntityId: 'scene:engine:30', siegeEngine: 71, alive: true };
  const engine = { id: 71, ent: engineActor };
  // A JSON copy of any live scene graph would fail; only the actor ID may cross.
  engine.scene = engine; engineActor.scene = engine; keeps[0].door.keepRef = keeps[0];
  const actors = [leader, follower, removedMember, engineActor];
  const entities = new Map(actors.map((e) => [e.id, e]));
  const band = { id: 32, realm: 0, members: [11, 12],
    order: { type: 'attack', keep: keeps[0], phase: 'travel' } };
  leader.warband = band; follower.warband = band;
  const moves = [];
  const context = vm.createContext({ WAR: { keeps, temples, relics, warbands: [band], stats: {}, commanders: [], nextWb: 33 },
    REALMS: realms, NAV: { nodes }, ENT: actors,
    GAME: { t: clock, player: { id: 1, x: 50, z: 0, alive: true, faction: 0, name: self } },
    NET: { self, peers: new Map() }, NETWS: { url: 'fixture', state: 'on' }, netOn: () => true,
    queueMicrotask: () => {}, window: {}, performance: { now: () => 0 },
    SIEGE3: { stats: {} }, SIEGE: { engines: [engine] }, siegeById: (id) => id === engine.id ? engine : null,
    clamp: (x, lo, hi) => Math.max(lo, Math.min(hi, x)),
    dist: (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz),
    dist2: (ax, az, bx, bz) => (ax - bx) ** 2 + (az - bz) ** 2,
    getEnt: (id) => entities.get(id),
    moveToward: (e, x, z) => { assert.ok(Number.isFinite(x) && Number.isFinite(z)); moves.push([e.id, x, z]); },
    segmentClear: () => true, bandDownStep: () => false,
    bandSlot: (_e, _L, x, z) => ({ x, z }), war3OrderPhrase: () => null,
    war3EngageGuard: () => {}, wbEnemiesNear: () => 0,
    bandInsideKeep: () => false, warbandEngineBusy: () => false,
    siegeBandAfter: () => {}, bandLeaderExit: () => {}, templeExposed: () => true,
    bandStartNode: () => nodes[0], nearestNavNode: () => nodes[0], navPath: (a, b) => [a, b],
    news: () => {}, inDungeon: () => false, R_RING: 1000,
    relicPosition: (rel) => rel.state === 'temple' ? temples[rel.at]?.site : rel,
  });
  const names = ['wbMembers', 'wbLeader', 'wbSetOrder', 'doorOpenFor', 'wbPlan', 'updateWarband', 'thinkSoldier', 'followTrail'];
  vm.runInContext(names.map((name) => declaration(ai, name)).join('\n') + '\n' + declaration(siege, 'bandUnstick'), context);
  vm.runInContext(campaign.slice(0, campaign.indexOf('(function campaignStyle()')), context);
  vm.runInContext(replication, context);
  const state = vm.runInContext('NET_ENTITIES', context);
  for (const actor of actors) state.bodies.set(actor.netEntityId, actor);
  return { c: context, state, entities, band, leader, follower, removedMember, engine, engineActor, moves, nodes, temples, relics, keeps };
}

test('actual metadata roundtrip restores canonical objectives, ownership and relative clocks', () => {
  const from = fixture(100), to = fixture(2000, 'keeper');
  to.c.NET.peers.set('publisher', { ghost: { ...from.c.GAME.player, role: 'remote', name: 'Publisher' } });
  const clocks = { since: 80, until: 160, holdUntil: 135, bombSince: 70, bombFirst: 60, breachBan: 180 };
  const orders = [
    { type: 'attack', keep: from.keeps[0], phase: 'hold' },
    { type: 'defend', keep: from.keeps[1], phase: 'travel' },
    { type: 'garrison', keep: from.keeps[2], phase: 'travel' },
    { type: 'raid', temple: from.temples[1], relic: from.relics[0], phase: 'siege' },
    { type: 'carry', relic: from.relics[1], phase: 'travel' },
    { type: 'retrieve', relic: from.relics[2], phase: 'travel' },
    { type: 'patrol', node: from.nodes[0], phase: 'travel', home: true },
    { type: 'rally', phase: 'travel', point: { x: 45, z: 0 } },
    { type: 'attack', keep: from.keeps[0], phase: 'bombard', siegeE: from.engine.id },
  ];
  for (const order of orders) {
    from.band.order = { ...order, ...clocks, byPlayer: true, why: 'fixture reason' };
    const wire = JSON.parse(JSON.stringify(from.c.netEntityMeta()));
    const row = wire.warbands[0].order;
    for (const key of ['keep', 'temple', 'relic', 'node']) if (order[key]) assert.equal(row[key], order[key].id);
    for (const [key, value] of Object.entries(clocks)) assert.equal(row[key + 'In'], value - 100);
    assert.equal(row.byPlayer, true);
    assert.equal(row.why, 'fixture reason');
    if (order.type === 'rally') assert.equal(row.rallyPeer, 'publisher');
    if (order.siegeE) assert.equal(row.engine, 'scene:engine:30');
    to.c.netEntityApplyMeta(wire);
    const restored = to.c.WAR.warbands[0].order;
    assert.ok(restored, order.type);
    for (const key of ['keep', 'temple', 'relic', 'node']) if (order[key]) {
      const list = { keep: to.keeps, temple: to.temples, relic: to.relics, node: to.nodes }[key];
      assert.equal(restored[key], list[order[key].id], key);
      assert.notEqual(restored[key], order[key], 'receiver must use its own world graph');
    }
    for (const [key, value] of Object.entries(clocks)) assert.equal(restored[key], value + 1900, key);
    assert.equal(restored.byPlayer, true);
    assert.equal(restored.home, order.home);
    assert.equal(restored.why, 'fixture reason');
    assert.equal(restored.phase, order.phase);
    if (order.siegeE) assert.equal(restored.siegeE, to.engine.id);
    if (order.type === 'rally') {
      assert.equal(restored.rallyPeer, 'publisher');
      assert.equal(to.c.orderShort(to.c.WAR.warbands[0])[2], 'Publisher');
    }
  }
});

test('metadata replacement detaches dropped and retired members before preparing new bands', () => {
  const { c, band, leader, follower, removedMember } = fixture();
  band.members.push(removedMember.id); removedMember.warband = band;
  c.netEntityApplyMeta({ warbands: [{ id: band.id, realm: 0, ord: 1,
    members: [leader.netEntityId, follower.netEntityId], order: { type: 'patrol', node: 0, untilIn: 30 } }] });
  const restored = c.WAR.warbands[0];
  assert.equal(removedMember.warband, null);
  assert.equal(leader.warband, restored);
  assert.equal(follower.warband, restored);
  assert.equal(restored.L, leader);
  assert.ok(restored.trail.length);
  c.netEntityApplyMeta({ warbands: [] });
  assert.equal(leader.warband, null);
  assert.equal(follower.warband, null);
});

test('malformed membership cannot enlist private actors or duplicate public soldiers', () => {
  const { c, state, entities, band, leader, follower, removedMember } = fixture();
  const player = c.GAME.player;
  const remote = { id: 21, role: 'remote', netPeer: 'remote', alive: true, faction: 0, x: 4, z: 0 };
  const pet = { id: 22, role: 'pet', netEntityOwner: 'publisher', netEntityId: 'scene:pet:22',
    alive: true, faction: 0, x: 6, z: 0, ai: { personal: 'preserve' } };
  // A personal actor carrying a soldier role still belongs to its private owner.
  const ownedSoldier = { ...pet, id: 23, role: 'soldier', netEntityId: 'scene:owned:23' };
  const town = { id: 24, role: 'herald', netNpcId: 'town:24', netEntityId: 'scene:town:24',
    alive: true, faction: 0, x: 8, z: 0, ai: { town: 'preserve' } };
  const foreign = { id: 25, role: 'soldier', netEntityId: 'scene:foreign:25', alive: true,
    faction: 1, x: 10, z: 0, ai: { realm: 'preserve' } };
  const guard = { ...foreign, id: 26, role: 'guard', faction: 0, netEntityId: 'scene:guard:26' };
  c.NET.peers.set('remote', { ghost: remote });
  const excluded = [player, remote, pet, ownedSoldier, town, foreign, guard];
  for (const actor of excluded) {
    actor.warband = band;
    entities.set(actor.id, actor);
    c.ENT.push(actor);
    if (actor.netEntityId) state.bodies.set(actor.netEntityId, actor);
    band.members.push(actor.id);
  }
  const before = excluded.map((actor) => ({ ai: actor.ai, aiData: JSON.stringify(actor.ai), warband: actor.warband }));
  c.netEntityApplyMeta({ warbands: [
    { id: 32, realm: 0, members: ['peer:publisher', 'peer:remote', pet.netEntityId, ownedSoldier.netEntityId,
      town.netEntityId, foreign.netEntityId, guard.netEntityId, leader.netEntityId, leader.netEntityId,
      follower.netEntityId], order: { type: 'patrol', node: 0, untilIn: 30 } },
    { id: 33, realm: 0, members: [leader.netEntityId, follower.netEntityId, removedMember.netEntityId],
      order: { type: 'patrol', node: 0, untilIn: 30 } },
  ] });
  assert.deepEqual([...c.WAR.warbands[0].members], [leader.id, follower.id]);
  assert.deepEqual([...c.WAR.warbands[1].members], [removedMember.id], 'a soldier belongs to one band');
  assert.equal(c.WAR.warbands[0].L, leader);
  assert.equal(leader.warband, c.WAR.warbands[0]);
  assert.equal(removedMember.warband, c.WAR.warbands[1]);
  excluded.forEach((actor, i) => {
    assert.equal(actor.ai, before[i].ai, `${actor.id}: AI identity`);
    assert.equal(JSON.stringify(actor.ai), before[i].aiData, `${actor.id}: AI state`);
    assert.equal(actor.warband, before[i].warband, `${actor.id}: private or other-role pointer`);
  });
});

test('actual authority and delayed snapshot admission prepare trails before NPCs can tick', () => {
  for (const hasEntities of [false, true]) {
    const { c, state, band, follower, leader, moves } = fixture(100, 'next');
    Object.assign(state, { authority: 'old', peer: 'previous', waiting: false });
    band.path = null; band.goal = 1; delete band.trail;
    follower.ai.unstick = { x: follower.x, z: follower.z, t: 99, mode: 1, until: 105, side: 1 };
    const authority = { t: 'activity', kind: 'authority', authority: 'new', peer: 'next', hasEntities,
      worldAdmission: { origin: 'fixture', epoch: 1 } };
    assert.equal(c.netEntityMessage(authority), true);
    if (hasEntities) {
      assert.equal(c.netEntityCanSimulateWorld(), false);
      assert.equal(c.netEntityReceive({ v: 1, rows: [], full: false }), true);
    }
    assert.equal(c.netEntityCanSimulateWorld(), true);
    assert.equal(band.L, leader);
    assert.ok(band.trail.length, 'admission itself must establish the trail');
    assert.equal(band.goal, null);
    c.thinkSoldier(follower, 1 / 60); // Deliberately before updateWarband.
    assert.equal(moves.length, 1);
    assert.deepEqual([leader.x, leader.z, follower.x, follower.z], [0, 0, -10, 0]);
  }
});

test('legacy objectives recover only when canonical targets exist and local siege routes rebuild', () => {
  const { c, state, band, relics } = fixture();
  const apply = (order) => {
    c.netEntityApplyMeta({ warbands: [{ id: band.id, realm: 0, members: band.members.map((id) => c.getEnt(id).netEntityId), order }] });
    c.netEntityPrepareWarbands();
    return c.WAR.warbands[0];
  };
  assert.equal(apply({ type: 'raid', relic: 0, keep: null, temple: null, phase: 'travel' }).order.temple, c.WAR.temples[relics[0].at]);
  for (const order of [{ type: 'raid' }, { type: 'raid', relic: 999 }, { type: 'patrol' },
    { type: 'raid', relic: 0, temple: 999 }, { type: 'patrol', home: true, node: 999 },
    { type: 'attack', keep: 999 }, { type: 'rally' }]) assert.equal(apply(order).order, null);
  Object.assign(band, { path: [0, 1], pathIdx: 1, goal: 1, leaderGoal: { x: 900, z: 900 } });
  const legacyRally = apply({ type: 'rally' });
  assert.equal(legacyRally.order, null);
  assert.equal(legacyRally.path, null);
  assert.equal(legacyRally.goal, null);
  assert.deepEqual({ ...legacyRally.leaderGoal }, { x: 0, z: 0 }, 'a lost rally must not retain its caller movement');
  for (const phase of ['bombard', 'breach', 'gap']) {
    const restored = apply({ type: 'attack', keep: 0, phase, bombSinceIn: -20, bombFirstIn: -30 });
    assert.equal(restored.order.phase, 'travel');
    assert.equal(restored.path, null);
    assert.equal(restored.goal, null);
    assert.equal(restored.order.bombSince, undefined);
  }
  const held = apply({ type: 'attack', keep: 0, phase: 'hold' });
  assert.equal(held.order.holdUntil, c.GAME.t + 35);
  assert.equal(apply({ type: 'patrol', node: 0 }).order.until, c.GAME.t + 45);
  const expired = apply({ type: 'patrol', node: 0, untilIn: -1 });
  assert.equal(expired.order.until, c.GAME.t - 1, 'an explicit expiry must not be extended');
  c.updateWarband(expired, 1 / 60);
  assert.equal(expired.order, null);
  state.bodies.delete('scene:engine:30');
  assert.equal(apply({ type: 'attack', keep: 0, phase: 'bombard', engine: 'scene:engine:30' }).order.phase, 'travel');
});
