import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = path => readFileSync(new URL('../../' + path, import.meta.url), 'utf8');
const files = Object.fromEntries(['08q_diplomacy', '07_entities', '08l_war4', '08k_war3', '08g_campaign', '14n_net', '14x_netentities'].map(n => [n, read('src/' + n + '.js')]));
function extract(source, name) {
  const start = source.indexOf('function ' + name + '('), end = source.indexOf('\n}', start);
  assert.ok(start >= 0 && end >= start, name + ' exists');
  return source.slice(start, end + 2);
}
function fixture({ kind = 'truce', expires = 200, time = 100 } = {}) {
  const spies = { enemy: 0, damage: 0, requests: [], orders: 0, computed: 0, buffs: 0, wounds: 0, buffDispatch: 0 };
  const player = { id: 1, role: 'player', alive: true, faction: 0, x: 0, y: 0, z: 0 };
  const other = { id: 2, role: 'remote', alive: true, faction: 1, x: 0, y: 0, z: 0 };
  const state = { simulate: true, leader: -1 };
  const context = vm.createContext({
    NETS: { s: { management: { v: 1, time, allRelations: [{ a: 0, b: 1, score: 50, treaty: kind, expires }] } } },
    GAME: { t: 10, player, prog: { level: 1 } }, ENT: [player, other], NET: { self: 'keeper', peers: new Map() },
    W3: { on: true, pact: null, stats: { pacts: 0 }, PACT_END: 45 }, W4: { on: true, pactKey: '', stats: { pacts: 0, recalled: 0 } },
    WAR: { warbands: [], keeps: [], temples: [], relics: [], stats: { raidOrders: 0 } },
    REALMS: [0, 1, 2].map(r => ({ name: 'realm' + r, nav: { muster: { id: r + 10 } }, musterSite: { x: r * 20, z: 0 } })),
    CAMPAIGN: { n: 1, state: 'war' }, NETPARTS: { replay: false, peer: 'keeper' }, HALL: { sit: { H: { num: 3 } } }, FACTION_NEUTRAL: 4,
    netEntityVisible: () => true, netEntityRemoteEnemy() { spies.enemy++; return true; }, netEntityDamage() { spies.damage++; return 17; },
    netEntityBuff() { spies.buffDispatch++; return false; }, netOutBuff() { spies.buffs++; return {}; }, burnFlames() {},
    giftBuffAdjust: (e, kind, value, dur) => ({ value, dur }), ccAdjust: (e, kind, dur) => dur, ladderOnStun() {},
    netEntityRegister(e) { e.netEntityId = 'scene:test:2'; e.netEntityKey = 'test'; }, netEntityR: n => n,
    netEntityPackLook: x => x, netEntityUnpackLook: x => x, NET_ENTITY_DEFAULTS: {}, netEntityOwnPet: () => false,
    netEntityPlain: x => x == null ? null : JSON.parse(JSON.stringify(x)), animActValue: () => 0,
    netEntityCanSimulateWorld: () => state.simulate, netWorldPartsCanSimulate: () => state.simulate,
    netWorldPartsActive: () => true, netWorldPartsConnected: () => false, netWorldPartsRequest(...args) { spies.requests.push(args); return true; },
    cwCanCommand: () => true, hallThroneGrant: () => true, hallCommandGrant: () => false,
    getEnt: id => context.ENT.find(e => e.id === id) || null,
    wbSetOrder(wb, order) { spies.orders++; wb.order = { ...order, phase: 'travel' }; },
    news() {}, w3Leads: r => state.leader === r, liveGuards: () => 0, siegeDanger: () => 0,
    dist: (x, z, a, b) => Math.hypot(x - a, z - b),
    PROJ: [], PROJ_COL: {}, FX: { sparks() {} }, ARROWLIKE: { arrow: true }, BODKIN_PIERCE: 0.5, wallsAimY: e => e.y, wallsProj: () => false, spellRibbon() {},
    computeDamage() { spies.computed++; return { d: 5, crit: false }; }, addBuff() { spies.buffs++; }, crippleWound() { spies.wounds++; },
  });
  const names = [
    ['07_entities', ['isEnemy', 'dealDamage', 'updateProjectiles', 'addBuff', 'tickBuffs']], ['14n_net', ['netIsEnemy', 'netSlowObj', 'netSlowRead']],
    ['08l_war4', ['war4Allied', 'w4PactBegins', 'w4PactStep', 'w4PactSweep', 'war4Choose']],
    ['14x_netentities', ['netEntityWire', 'netEntityRow', 'netEntityReadRow', 'netEntityApply']],
    ['08k_war3', ['w3PactStep', 'w3BestTarget', 'war3Column']], ['08g_campaign', ['cwPlayerOrder', 'planWar']],
  ];
  const code = names.flatMap(([file, funcs]) => funcs.map(name => extract(files[file], name))).join('\n');
  const api = 'realmManualAllied,realmManualCeasefire,addBuff,tickBuffs,netEntityRow,netEntityReadRow,netEntityApply,isEnemy,dealDamage,updateProjectiles,netIsEnemy,netSlowObj,netSlowRead,war4Allied,w4PactBegins,w4PactStep,w4PactSweep,war4Choose,w3PactStep,w3BestTarget,war3Column,cwPlayerOrder,planWar';
  vm.runInContext(files['08q_diplomacy'] + '\n' + code + '\nthis.api={' + api + '};', context);
  return { context, api: context.api, spies, player, other, state, advance(t) { context.NETS.s.management.time = t; } };
}
test('ratified trade and truce are reciprocal; offers, scores and unrelated realms confer no peace', () => {
  for (const kind of ['truce', 'trade']) {
    const f = fixture({ kind });
    assert.equal(f.api.realmManualAllied(0, 1), true); assert.equal(f.api.realmManualAllied(1, 0), true);
    for (const pair of [[0, 0], [0, 2], [-1, 1], [0, 4], [0.5, 1]]) assert.equal(f.api.realmManualAllied(...pair), false);
    f.context.NETS.s.management.allRelations = [{ a: 0, b: 1, treaty: 'war', score: 100, expires: 999 }];
    f.context.NETS.s.management.offers = [{ from: 0, to: 1, treaty: 'truce', status: 'pending' }];
    assert.equal(f.api.realmManualAllied(0, 1), false);
    assert.equal(f.api.realmManualCeasefire({ faction: 0, role: 'bot' }, f.other), false);
  }
});
test('expiry follows accepted season time, never camera time or a local realm simulation', () => {
  const f = fixture({ expires: 101 });
  f.context.GAME.t += 100000; assert.equal(f.api.realmManualAllied(0, 1), true);
  f.advance(100.999); assert.equal(f.api.realmManualAllied(0, 1), true);
  f.advance(101); assert.equal(f.api.realmManualAllied(0, 1), false);
  f.context.SEASONP = { rs: { t: 0, management: { allRelations: [{ a: 0, b: 1, treaty: 'truce', expires: 999 }] } } };
  f.context.NETS.s = null; assert.equal(f.api.realmManualAllied(0, 1), false);
});
test('ceasefire precedes shared and remote PvP enemy and damage dispatch', () => {
  const f = fixture();
  assert.equal(f.api.isEnemy(f.player, f.other), false); assert.equal(f.api.isEnemy(f.other, f.player), false);
  assert.equal(f.api.netIsEnemy(f.player, f.other), false);
  assert.equal(f.api.dealDamage(f.player, f.other, 10), 0); assert.equal(f.api.dealDamage(f.other, f.player, 10, { dot: true }), 0);
  assert.equal(f.spies.enemy, 0); assert.equal(f.spies.damage, 0);
  f.advance(201); assert.equal(f.api.isEnemy(f.player, f.other), true); assert.equal(f.spies.enemy, 1);
  assert.equal(f.api.netIsEnemy(f.player, f.other), true);
  assert.equal(f.api.dealDamage(f.player, f.other, 10), 17); assert.equal(f.spies.damage, 1);
});
test('in-flight arrows cannot apply damage, snare, burn or wounds after ratification', () => {
  const projectile = () => ({ src: 1, srcFaction: 0, tgt: 2, kind: 'arrow', x: 0, y: 0, z: 0, age: 0, life: 2, speed: 50,
    payload: { mult: 1, snare: [0.5, 5], burn: [10, 5], ability: 'cripple' } });
  for (const missingSource of [false, true]) {
    const f = fixture(); if (missingSource) f.context.ENT = [f.other];
    f.context.PROJ.push(projectile()); f.api.updateProjectiles(1);
    assert.equal(f.context.PROJ.length, 0); assert.equal(f.spies.computed, 0);
    assert.equal(f.spies.damage, 0); assert.equal(f.spies.buffs, 0); assert.equal(f.spies.wounds, 0);
  }
  const f = fixture({ expires: 99 }); f.context.PROJ.push(projectile()); f.api.updateProjectiles(1);
  assert.ok(f.spies.computed > 0); assert.ok(f.spies.buffs > 0);
});
test('new army attacks and raids reject allies before reserving shared commands', () => {
  const f = fixture(), keep = { id: 0, realm: 1, site: { name: 'ally keep' } };
  f.context.WAR.keeps = [keep]; f.context.WAR.temples = [{ id: 0, realm: 1 }];
  f.context.WAR.warbands = [{ id: 9, realm: 0, orderCampaign: 1, orderVersion: 4 }];
  for (const command of ['attack', 'raid']) {
    const result = f.api.cwPlayerOrder(9, command, 0); assert.equal(result.ok, false);
    assert.match(result.message, /ally|treaty/); assert.equal(f.spies.requests.length, 0);
  }
  f.advance(201); assert.equal(f.api.cwPlayerOrder(9, 'attack', 0).pending, true);
  assert.equal(f.spies.requests.length, 1); assert.equal(f.spies.requests[0][1].version, 4);
});
test('only the admitted keeper recalls AI and player orders without changing accepted revisions', () => {
  const f = fixture(), ally = { id: 0, realm: 1 }, foe = { id: 1, realm: 2 };
  const make = (id, byPlayer, keep = ally) => ({ id, realm: 0, order: { type: 'attack', keep, byPlayer }, cwMine: {}, cwKey: 'attack',
    path: [5], pathIdx: 1, goal: 5, orderToken: 'accepted:' + id, orderVersion: 7, orderCampaign: 2 });
  const ai = make(1, false), player = make(2, true), unrelated = make(3, true, foe);
  f.context.WAR.warbands = [ai, player, unrelated]; f.state.simulate = false;
  f.api.w4PactSweep(); assert.equal(f.spies.orders, 0); assert.equal(player.order.type, 'attack');
  f.state.simulate = true; f.api.w4PactSweep();
  for (const band of [ai, player]) {
    assert.equal(band.order.type, 'patrol'); assert.equal(band.order.home, true); assert.equal(band.order.byPlayer, undefined);
    assert.equal(band.cwMine, null); assert.equal(band.path, null); assert.equal(band.goal, null);
    assert.equal(band.orderToken, 'accepted:' + band.id); assert.equal(band.orderVersion, 7); assert.equal(band.orderCampaign, 2);
  }
  assert.equal(unrelated.order.type, 'attack'); assert.equal(f.context.W4.stats.recalled, 2);
  f.api.w4PactSweep(); assert.equal(f.context.W4.stats.recalled, 2);
});
test('keeper clears allied world targets without changing another owner body', () => {
  const f = fixture(), enemy = { id: 3, faction: 1, alive: true, role: 'soldier' };
  const soldier = { id: 4, faction: 0, alive: true, role: 'soldier', target: 3, threat: new Map([[3, 10]]), ai: { chase: 3 } };
  const remote = { id: 5, faction: 0, alive: true, role: 'remote', target: 3 };
  const foreignPet = { id: 6, faction: 0, alive: true, role: 'pet', netEntityOwner: 'other', target: 3 };
  f.context.ENT = [enemy, soldier, remote, foreignPet]; f.api.w4PactSweep();
  assert.equal(soldier.target, null); assert.equal(soldier.threat.has(3), false); assert.equal(soldier.ai.chase, null);
  assert.equal(remote.target, 3); assert.equal(foreignPet.target, 3);
});
test('manual treaties coexist with automatic common-cause creation and expiry', () => {
  const f = fixture({ expires: 1000 }); f.state.leader = 0; f.api.w3PactStep();
  const automatic = JSON.stringify(f.context.W3.pact);
  const unrelatedRemote = { id: 7, role: 'remote', alive: true, faction: 0, target: 2 };
  f.context.ENT.push(unrelatedRemote); f.api.w4PactBegins(f.context.W3.pact);
  assert.equal(unrelatedRemote.target, 2);
  assert.equal(f.api.war4Allied(1, 2), true); assert.equal(f.api.war4Allied(0, 1), true);
  assert.equal(JSON.stringify(f.context.W3.pact), automatic);
  f.state.leader = -1; f.context.GAME.t = 11; f.api.w3PactStep();
  f.context.GAME.t = 57; f.api.w3PactStep(); assert.equal(f.context.W3.pact, null);
  assert.equal(f.api.war4Allied(1, 2), false); assert.equal(f.api.war4Allied(0, 1), true);
});
test('AI candidates and pressure targets exclude manual allied objectives', () => {
  const f = fixture();
  const ally = { id: 0, realm: 1, orig: 1, guards: [], door: { alive: true, hp: 100, maxHp: 100 }, site: { x: 1, z: 0 } };
  const foe = { id: 1, realm: 2, orig: 2, guards: [], door: { alive: true, hp: 100, maxHp: 100 }, site: { x: 50, z: 0 } };
  f.context.WAR.keeps = [ally, foe]; assert.equal(f.api.w3BestTarget(0, false), foe);
  const candidates = [{ o: { type: 'attack', keep: ally } }, { o: { type: 'raid', temple: { realm: 1 } } }, { o: { type: 'attack', keep: foe } }];
  f.api.war4Choose(0, candidates); assert.equal(candidates.length, 1); assert.equal(candidates[0].o.keep, foe);
});

test('queued hostile buffs stop before dispatch while friendly recovery remains available', () => {
  const f = fixture(); f.other.buffs = [];
  for (const kind of ['stun', 'snare', 'root', 'burn', 'bleed', 'wound']) {
    const result = f.api.addBuff(f.other, kind, 2, 10, f.player.id);
    assert.equal(result.until, f.context.GAME.t); assert.equal(f.spies.buffDispatch, 0); assert.equal(f.other.buffs.length, 0);
  }
  f.other.role = 'player'; f.api.addBuff(f.other, 'hot', 2, 10, f.player.id);
  assert.equal(f.spies.buffDispatch, 1); assert.equal(f.other.buffs[0].kind, 'hot');
});
test('DOT source faction survives source removal and unknown legacy damage fails closed only for treaty recipients', () => {
  const f = fixture({ kind: 'war' }); f.other.role = 'player'; f.other.buffs = [];
  f.api.addBuff(f.other, 'burn', 2, 10, f.player.id);
  assert.equal(f.other.buffs[0].sourceFaction, 0);
  f.context.ENT = [f.other]; f.context.NETS.s.management.allRelations = [{ a: 0, b: 1, treaty: 'truce', expires: 200 }];
  f.context.GAME.t = 12; f.api.tickBuffs(f.other, 2); assert.equal(f.spies.damage, 0);
  f.advance(201); f.context.GAME.t = 14; f.api.tickBuffs(f.other, 2); assert.ok(f.spies.damage > 0);
  for (const [faction, sourceFaction, shouldStop] of [[1, undefined, true], [2, undefined, false], [1, 3, false], [1, -2, false]]) {
    const q = fixture(); q.other.role = 'player'; q.other.faction = faction; q.context.ENT = [q.other];
    q.other.buffs = [{ kind: 'dot', value: 2, until: 20, tick: 10, src: 999, ...(sourceFaction === undefined ? {} : { sourceFaction }) }];
    q.context.GAME.t = 12; q.api.tickBuffs(q.other, 2);
    assert.equal(q.spies.damage === 0, shouldStop);
  }
});
test('source faction round-trips the real entity wire, parser and keeper handoff', () => {
  const f = fixture({ kind: 'war' });
  Object.assign(f.other, { role: 'soldier', kind: 'humanoid', name: 'test', level: 1, yaw: 0, hp: 100, maxHp: 100,
    scale: 1, look: {}, anim: { phase: 0, amt: 0 }, buffs: [] });
  f.api.addBuff(f.other, 'bleed', 2, 10, f.player.id);
  const wire = f.api.netEntityRow(f.other), decoded = f.api.netEntityReadRow(wire);
  assert.ok(decoded); assert.equal(decoded.buffs[0].sourceFaction, 0);
  assert.equal(Object.hasOwn(decoded.buffs[0], 'src'), false);
  const nextKeeper = { id: 9, role: 'soldier', kind: 'humanoid', alive: true, anim: {}, buffs: [] };
  f.api.netEntityApply(nextKeeper, decoded);
  assert.equal(nextKeeper.buffs[0].sourceFaction, 0); assert.equal(nextKeeper.buffs[0].src, null);
  f.context.NETS.s.management.allRelations = [{ a: 0, b: 1, treaty: 'truce', expires: 200 }];
  f.context.ENT = [nextKeeper]; f.context.GAME.t = 12; f.api.tickBuffs(nextKeeper, 2);
  assert.equal(f.spies.damage, 0);
});

test('canonical hosted armies disable legacy free musters and columns while solo musters retain their path', () => {
  const f = fixture(); let canonical = true, spawned = 0;
  Object.assign(f.context, { season2CanonicalWar: () => canonical, wbOrd() {}, looseRelicFor: () => null,
    cwBandsCounted: () => 0, MAX_WARBANDS: () => 1, war3Levy: () => 0, cwWeary: () => 0,
    loopsMuster: (realm, size) => size, spawnWarband(realm) { spawned++; return { id: 9, realm, order: null }; },
    loopsMustered() {}, cwMergeRemnants() {}, cwChoose: () => null, wbMembers: () => [] });
  const commander = { realm: 0, nextSpawn: -1 };
  f.api.planWar(commander); assert.equal(spawned, 0);
  const before = JSON.stringify(f.context.WAR);
  assert.equal(f.api.war3Column(null, 0, []), null); assert.equal(JSON.stringify(f.context.WAR), before);
  canonical = false; f.api.planWar(commander); assert.equal(spawned, 1);
});

test('FIELD v2 is explicitly advertised and older capability values stay unsupported', () => {
  const f = fixture(); f.context.GAME.player = null; f.context.GAME.prog = null;
  Object.assign(f.context, { netHumanLive: () => true, NET_HUMAN_PLAY: { activity: 1 }, NETWS: { url: 'wss://example.test' },
    netSharedWorldReady: () => false, NET_REALM_OK: r => Number.isInteger(r) && r >= 0 && r <= 2,
    CLASSES: { warrior: {} }, LEVEL_CAP: 60, netWxRead: () => null, netCompanionRead: () => null,
    netStr: (s, n) => typeof s === 'string' ? s.slice(0, n) : '',
    netNum: (v, lo, hi, fallback = lo) => Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback });
  const slow = f.api.netSlowObj(); assert.equal(slow.seasonField, 2); assert.equal(slow.warbandOrders, 1);
  assert.equal(f.api.netSlowRead({ seasonField: 2 }).seasonField, 2);
  for (const value of [undefined, 0, 1, 3, '2']) assert.equal(f.api.netSlowRead({ seasonField: value }).seasonField, 0);
});
