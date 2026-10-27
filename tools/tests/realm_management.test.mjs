import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { checkedWorldSnapshot } from '../../server/gaming/hallowmarch-world-state.js';

const read = path => readFileSync(new URL('../../src/' + path, import.meta.url), 'utf8');
const realmSource = read('08m_realm.js'), managementSource = read('08p_realm_management.js');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture(seed = 314159) {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(realmSource + '\n' + managementSource + '\nthis.model = { RSM, RSM_GOODS, realmSimInit, realmSimStep, realmSimSanitize, realmSimLive, rsmEconomy, rsmArmy, rsmTarget, rsmDecide, rsmArmies, rsmOffensives, realmManageInit, realmManageStep, realmManageAction, realmManageView, realmManageSanitize };', context);
  const api = context.model, state = api.realmSimInit(seed, { days: 28 });
  api.realmManageInit(state);
  return { api, state,
    view: realm => api.realmManageView(state, realm),
    action(realm, args, options = {}) {
      return api.realmManageAction(state, realm, { revision: state.management.revision, ...args }, options);
    },
    tick(seconds) { let left = seconds; while (left > 1e-8) { const step = Math.min(60, left); state.t += step; api.realmManageStep(state, step); left -= step; } },
  };
}
function stock(f, realm, id) {
  const row = f.view(realm).stocks.find(item => item.id === id);
  assert.ok(row, 'published stock ' + id); return row.n;
}
function setStock(f, realm, id, n) {
  const index = f.api.RSM_GOODS.indexOf(id);
  if (index >= 0) f.state.realms[realm].s[index] = n;
  else f.state.realms[realm].management.stock[id] = n;
}
function zeroPopulation(f) {
  for (const realm of f.state.realms) realm.management.population = 0;
}
function fund(f, realm = 0) {
  for (const row of f.view(realm).stocks) setStock(f, realm, row.id, row.cap * 0.75);
}
function succeed(result) { assert.equal(result.ok, true, result.why || result.message); return result; }
function noCharge(f, realm, args, options) {
  const before = plain(f.state);
  const result = f.action(realm, args, options);
  assert.equal(result.ok, false);
  assert.deepEqual(plain(f.state), before, result.why); return result;
}

test('management keeps the eight canonical raw pools and initializes without minting goods', () => {
  const f = fixture();
  assert.deepEqual(plain(f.api.RSM_GOODS), ['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses', 'gold']);
  for (let realm = 0; realm < 3; realm++) {
    const raw = f.state.realms[realm].s;
    assert.equal(raw.length, 8);
    for (let i = 0; i < 8; i++) {
      assert.equal(raw[i], Math.round(f.api.RSM.target[i] * 0.8));
      assert.equal(stock(f, realm, f.api.RSM_GOODS[i]), raw[i]);
      assert.equal(Object.hasOwn(f.state.realms[realm].management.stock, f.api.RSM_GOODS[i]), false);
    }
  }
  const before = plain(f.state); f.api.realmManageInit(f.state);
  assert.deepEqual(plain(f.state), before, 'initialization is idempotent');
});

test('stale revisions and malformed management actions leave all stores and state untouched', () => {
  const f = fixture(); fund(f);
  const revision = f.state.management.revision;
  noCharge(f, 0, { type: 'build', kind: 'house', plotId: 'town:0:10', revision: revision - 1 });
  for (const args of [
    {}, { type: 'invent-gold' }, { type: 'build', kind: '__proto__', plotId: 'town:0:10' },
    { type: 'build', kind: 'constructor', plotId: 'town:0:10' },
    { type: 'build', kind: 'house', plotId: 'town:1:10' },
    { type: 'gift', targetRealm: 1, resource: 'gold', amount: -1 },
    { type: 'gift', targetRealm: 1, resource: 'gold', amount: NaN },
    { type: 'gift', targetRealm: 1, resource: 'gold', amount: Infinity },
    { type: 'gift', targetRealm: 0, resource: 'gold', amount: 1 },
    { type: 'gift', targetRealm: 1, resource: 'not-a-resource', amount: 1 },
  ]) noCharge(f, 0, args);
  for (const realm of [-1, 3, 0.5]) noCharge(f, realm, { type: 'tax', policy: 'normal' });
});

const near = (a, b, message = '') => assert.ok(Math.abs(a - b) < 1e-7, message + ': expected ' + b + ', got ' + a);
const stocks = (f, realm) => Object.fromEntries(f.view(realm).stocks.map(row => [row.id, row.n]));
const catalog = (f, kind) => { const row = f.view(0).catalog.find(item => item.id === kind); assert.ok(row, kind); return row; };
const building = (f, realm, id) => f.state.realms[realm].management.buildings.find(row => row.id === id);
function pauseAll(f, realm = 0) {
  for (const b of f.view(realm).buildings) succeed(f.action(realm, { type: 'pause', buildingId: b.id, paused: true }));
}
function commission(f, kind, plotId = 'town:0:10', realm = 0) {
  const spec = catalog(f, kind);
  succeed(f.action(realm, { type: 'build', kind, plotId }));
  const id = 'b:' + plotId;
  succeed(f.action(realm, { type: 'workforce', buildingId: id, workers: spec.workers, priority: 2 }));
  f.tick(spec.seconds + 1);
  assert.equal(building(f, realm, id).status, 'built', kind + ' finishes with allocated workers');
  return id;
}
function activate(f, id, realm = 0, workers) {
  succeed(f.action(realm, { type: 'pause', buildingId: id, paused: false }));
  const b = building(f, realm, id), spec = catalog(f, b.kind);
  succeed(f.action(realm, { type: 'workforce', buildingId: id, workers: workers ?? spec.workers, priority: 2 }));
}
test('grain and flour become bread, and bread funds the actual army levy', () => {
  const f = fixture(); fund(f); pauseAll(f);
  const mill = commission(f, 'mill'), bakery = commission(f, 'bakery', 'town:0:11');
  pauseAll(f); activate(f, mill);
  for (const [id, n] of Object.entries({ grain: 60, flour: 0, bread: 0, food: 0, timber: 100 })) setStock(f, 0, id, n);
  for (let i = 0; i < 20; i++) f.tick(60);
  near(stock(f, 0, 'grain'), 0); near(stock(f, 0, 'flour'), 60);
  succeed(f.action(0, { type: 'pause', buildingId: mill, paused: true })); activate(f, bakery);
  const timber = stock(f, 0, 'timber'); let breadConsumed = 0;
  for (let i = 0; i < 20; i++) {
    breadConsumed += f.state.realms[0].management.population * 0.012;
    f.tick(60);
  }
  near(stock(f, 0, 'flour'), 0);
  near(timber - stock(f, 0, 'timber'), 6, 'bakery burns real timber');
  near(stock(f, 0, 'bread') + stock(f, 0, 'food') / 1.4 + breadConsumed, 60, 'grain energy is conserved through citizens and provisions');
  assert.ok(stock(f, 0, 'food') >= f.api.RSM.levyCost[0], 'bread replenishes canonical army provisions');
  const R = f.state.realms[0], raw = [...R.s], lev = R.lev, trained = R.stats.trained;
  R.levyAt = f.state.t;
  f.api.rsmEconomy(f.state, 0, R, 0);
  assert.equal(R.lev, lev + 1); assert.equal(R.stats.trained, trained + 1);
  for (let i = 0; i < 8; i++) near(R.s[i], raw[i] - f.api.RSM.levyCost[i], 'real levy cost ' + f.api.RSM_GOODS[i]);
});
test('sawmills and toolsmiths consume canonical timber, iron and processed planks', () => {
  const f = fixture(); fund(f); pauseAll(f);
  const sawmill = commission(f, 'sawmill'), toolmaker = commission(f, 'toolmaker', 'town:0:11');
  pauseAll(f); activate(f, sawmill);
  setStock(f, 0, 'timber', 30); setStock(f, 0, 'planks', 0); f.tick(60);
  near(stock(f, 0, 'timber'), 28.5); near(stock(f, 0, 'planks'), 3);
  succeed(f.action(0, { type: 'pause', buildingId: sawmill, paused: true })); activate(f, toolmaker);
  setStock(f, 0, 'iron', 20); setStock(f, 0, 'tools', 10);
  const planks = stock(f, 0, 'planks'), residents = f.state.realms[0].management.population;
  f.tick(60);
  near(stock(f, 0, 'iron'), 19.5); near(stock(f, 0, 'planks'), planks - 1);
  near(stock(f, 0, 'tools'), 10 + 0.4 - residents * 0.0003, 'tool output pays household maintenance too');
});
test('input shortages, output capacity, zero workers and pause stop production without charging inputs', () => {
  const f = fixture(); fund(f); pauseAll(f); const mill = commission(f, 'mill');
  pauseAll(f); activate(f, mill, 0, 0);
  setStock(f, 0, 'grain', 30); setStock(f, 0, 'flour', 0); f.tick(60);
  near(stock(f, 0, 'grain'), 30); near(stock(f, 0, 'flour'), 0);
  assert.equal(building(f, 0, mill).assigned, 0); assert.equal(building(f, 0, mill).working, false);
  activate(f, mill); f.state.realms[0].management.population = 0; f.tick(60);
  near(stock(f, 0, 'grain'), 30); near(stock(f, 0, 'flour'), 0);
  assert.equal(building(f, 0, mill).blocked, 'workforce');
  f.state.realms[0].management.population = 32;
  activate(f, mill, 0, 1); f.tick(60);
  near(stock(f, 0, 'grain'), 28.5); near(stock(f, 0, 'flour'), 1.5);
  succeed(f.action(0, { type: 'pause', buildingId: mill, paused: true })); f.tick(60);
  near(stock(f, 0, 'grain'), 28.5); near(stock(f, 0, 'flour'), 1.5);
  assert.equal(building(f, 0, mill).blocked, 'paused');
  activate(f, mill); setStock(f, 0, 'grain', 0); f.tick(60);
  near(stock(f, 0, 'flour'), 1.5); assert.equal(building(f, 0, mill).working, false);
  assert.equal(building(f, 0, mill).blocked, 'inputs:grain');
  setStock(f, 0, 'grain', 30); setStock(f, 0, 'flour', f.view(0).stocks.find(row => row.id === 'flour').cap); f.tick(60);
  near(stock(f, 0, 'grain'), 30); assert.equal(building(f, 0, mill).blocked, 'storage:flour');
});
test('paid construction and upgrades change housing only after real work completes', () => {
  const f = fixture(); fund(f); pauseAll(f);
  const capacity = f.view(0).population.capacity, spec = catalog(f, 'house'), before = stocks(f, 0);
  succeed(f.action(0, { type: 'build', kind: 'house', plotId: 'town:0:10' }));
  const id = 'b:town:0:10', paid = stocks(f, 0);
  for (const resource of Object.keys(before)) near(paid[resource], before[resource] - (spec.cost[resource] || 0), resource + ' build charge');
  assert.equal(f.view(0).population.capacity, capacity);
  noCharge(f, 0, { type: 'build', kind: 'house', plotId: 'town:0:10' });
  f.tick(10); const left = building(f, 0, id).remaining; assert.ok(left > 0 && left < spec.seconds);
  succeed(f.action(0, { type: 'pause', buildingId: id, paused: true })); f.tick(20);
  near(building(f, 0, id).remaining, left, 'paused construction holds progress');
  succeed(f.action(0, { type: 'pause', buildingId: id, paused: false })); f.tick(left);
  assert.equal(building(f, 0, id).status, 'built');
  assert.equal(f.view(0).population.capacity, capacity + spec.housing);
  const quote = f.view(0).buildings.find(b => b.id === id).upgradeCost, upgradeBefore = stocks(f, 0);
  succeed(f.action(0, { type: 'upgrade', buildingId: id }));
  for (const resource of Object.keys(upgradeBefore)) near(stock(f, 0, resource), upgradeBefore[resource] - (quote[resource] || 0), resource + ' upgrade charge');
  assert.equal(f.view(0).population.capacity, capacity + spec.housing);
  f.tick(spec.seconds * 2);
  assert.equal(building(f, 0, id).level, 2);
  assert.equal(f.view(0).population.capacity, capacity + 2 * spec.housing);
});
test('household needs change available workers and treasury revenue', () => {
  const run = nourished => {
    const f = fixture(); fund(f); pauseAll(f); setStock(f, 0, 'gold', 0);
    if (!nourished) for (const id of ['bread', 'cloth', 'tools']) setStock(f, 0, id, 0);
    f.tick(600); return { view: f.view(0), gold: stock(f, 0, 'gold') };
  };
  const fed = run(true), hungry = run(false);
  assert.equal(fed.view.population.needs.bread, 1); assert.equal(hungry.view.population.needs.bread, 0);
  assert.ok(fed.view.population.happiness > hungry.view.population.happiness);
  assert.ok(fed.view.population.workers > hungry.view.population.workers);
  assert.ok(fed.view.population.available > hungry.view.population.available);
  assert.ok(fed.gold > hungry.gold && hungry.gold > 0);
  const tax = policy => { const f = fixture(); fund(f); pauseAll(f); setStock(f, 0, 'gold', 0); succeed(f.action(0, { type: 'tax', policy })); f.tick(60); return { gold: stock(f, 0, 'gold'), happiness: f.view(0).population.happiness }; };
  const low = tax('low'), high = tax('high');
  assert.ok(high.gold > low.gold); assert.ok(low.happiness > high.happiness);
});
test('population respects completed dwelling capacity and growth remains bounded', () => {
  const f = fixture(); fund(f); pauseAll(f);
  const M = f.state.realms[0].management, capacity = f.view(0).population.capacity;
  M.population = capacity - 0.01; M.happiness = 100;
  f.tick(60); near(M.population, capacity);
  f.tick(600); near(M.population, capacity, 'full town cannot grow past its homes');
  commission(f, 'house'); assert.equal(f.view(0).population.capacity, capacity + catalog(f, 'house').housing);
  f.tick(600); assert.ok(M.population > capacity && M.population <= f.view(0).population.capacity);
});
test('captured keep plots transfer the actual paid building and its control', () => {
  const f = fixture(); fund(f, 0); fund(f, 1); pauseAll(f);
  const id = commission(f, 'mill', 'keep:0:0'), original = building(f, 0, id);
  f.state.t = f.state.len / 4; f.state.phase = 'war';
  f.api.realmSimLive(f.state, { type: 'keep', keep: 0, holder: 1 }); f.tick(1);
  assert.equal(building(f, 0, id), undefined);
  assert.equal(building(f, 1, id), original, 'capture preserves the constructed building');
  assert.equal(f.view(1).plots.find(p => p.id === 'keep:0:0').buildingId, id);
  noCharge(f, 0, { type: 'pause', buildingId: id, paused: true });
  noCharge(f, 0, { type: 'build', plotId: 'keep:0:1', kind: 'house' });
  succeed(f.action(1, { type: 'pause', buildingId: id, paused: true }));
  assert.equal(original.paused, true);
  const cost = f.view(1).buildings.find(b => b.id === id).upgradeCost, before = stocks(f, 1);
  succeed(f.action(1, { type: 'upgrade', buildingId: id }));
  for (const resource of Object.keys(before)) near(stock(f, 1, resource), before[resource] - (cost[resource] || 0));
});
test('gifts and accepted trades conserve both realms stores and settle only once', () => {
  const f = fixture(); fund(f, 0); fund(f, 1);
  const timber = [stock(f, 0, 'timber'), stock(f, 1, 'timber')];
  succeed(f.action(0, { type: 'gift', targetRealm: 1, resource: 'timber', amount: 10 }));
  near(stock(f, 0, 'timber'), timber[0] - 10); near(stock(f, 1, 'timber'), timber[1] + 10);
  const before = [stocks(f, 0), stocks(f, 1)];
  succeed(f.action(0, { type: 'offer', targetRealm: 1, giveResource: 'timber', giveAmount: 10, wantResource: 'stone', wantAmount: 10 }));
  const offer = f.state.management.offers.at(-1); assert.equal(offer.status, 'pending');
  assert.deepEqual([stocks(f, 0), stocks(f, 1)], before, 'human proposal transfers nothing before acceptance');
  noCharge(f, 0, { type: 'reply', offerId: offer.id, accept: true });
  succeed(f.action(1, { type: 'reply', offerId: offer.id, accept: true }));
  assert.equal(offer.status, 'accepted');
  near(stock(f, 0, 'timber'), before[0].timber - 10); near(stock(f, 1, 'timber'), before[1].timber + 10);
  near(stock(f, 0, 'stone'), before[0].stone + 10); near(stock(f, 1, 'stone'), before[1].stone - 10);
  noCharge(f, 1, { type: 'reply', offerId: offer.id, accept: true });
  const full = f.view(1).stocks.find(row => row.id === 'timber').cap; setStock(f, 1, 'timber', full);
  noCharge(f, 0, { type: 'gift', targetRealm: 1, resource: 'timber', amount: 1 });
});
test('AI acceptance is explicit and trade shortages cannot debit the other realm', () => {
  const f = fixture(); fund(f, 0); fund(f, 1);
  const before = [stocks(f, 0), stocks(f, 1)];
  succeed(f.action(0, { type: 'offer', targetRealm: 1, giveResource: 'timber', giveAmount: 11, wantResource: 'stone', wantAmount: 10 }, { aiRealms: [1] }));
  assert.equal(f.state.management.offers.at(-1).status, 'accepted');
  near(stock(f, 0, 'timber'), before[0].timber - 11); near(stock(f, 1, 'stone'), before[1].stone - 10);
  succeed(f.action(0, { type: 'offer', targetRealm: 1, giveResource: 'timber', giveAmount: 10, wantResource: 'stone', wantAmount: 10 }));
  const offer = f.state.management.offers.at(-1); setStock(f, 1, 'stone', 0);
  noCharge(f, 1, { type: 'reply', offerId: offer.id, accept: true });
});
test('accepted treaties stop actual strategic attacks, expire by active time and can be ended by war', () => {
  const f = fixture(); fund(f); f.state.t = f.state.len / 4; f.state.phase = 'war';
  for (const K of f.state.keeps) K.h = K.home === 0 ? 0 : 1;
  const originalLevy = f.state.realms.map(R => R.lev);
  assert.ok(f.api.rsmArmy(f.state, 0, 8, 'assault', 2));
  assert.ok(f.api.rsmArmy(f.state, 1, 8, 'assault', 0));
  f.state.offs.push({ r: 0, k: 2, at: f.state.t + 60, ann: f.state.t, state: 'planned', army: 0, res: '', liveUntil: 0 });
  const gold = stock(f, 0, 'gold');
  succeed(f.action(0, { type: 'treaty', targetRealm: 1, kind: 'truce' }, { aiRealms: [1] }));
  const relation = f.view(0).allRelations.find(row => row.a === 0 && row.b === 1);
  assert.equal(relation.treaty, 'truce'); assert.equal(relation.expires, f.state.t + 1200);
  near(stock(f, 0, 'gold'), gold - 30, 'envoy cost is paid once on acceptance');
  assert.equal(f.state.armies.length, 0); assert.deepEqual(f.state.realms.map(R => R.lev), originalLevy);
  assert.equal(f.state.offs[0].state, 'done'); assert.equal(f.api.rsmTarget(f.state, 0), -1);
  assert.equal(f.api.rsmArmy(f.state, 0, 8, 'assault', 2), null);
  f.api.realmSimLive(f.state, { type: 'keep', keep: 2, holder: 0 }); assert.equal(f.state.keeps[2].h, 1);
  noCharge(f, 0, { type: 'target', keep: 2 });
  f.tick(60); assert.deepEqual(f.state.realms.map(R => R.lev), originalLevy, 'recall does not mint soldiers on later ticks');
  f.tick(1141); assert.equal(f.api.rsmTarget(f.state, 0) >= 0, true, 'expired truce permits real targets');
  succeed(f.action(0, { type: 'treaty', targetRealm: 1, kind: 'trade' }, { aiRealms: [1] }));
  assert.equal(f.api.rsmTarget(f.state, 0), -1);
  succeed(f.action(0, { type: 'declareWar', targetRealm: 1 }));
  assert.ok(f.api.rsmTarget(f.state, 0) >= 0);
});
test('legitimate management state survives exact season sanitizer roundtrips', () => {
  const f = fixture(); fund(f); pauseAll(f); commission(f, 'mill');
  succeed(f.action(0, { type: 'tax', policy: 'high' }));
  succeed(f.action(0, { type: 'offer', targetRealm: 1, giveResource: 'timber', giveAmount: 10, wantResource: 'stone', wantAmount: 10 }));
  succeed(f.action(0, { type: 'treaty', targetRealm: 2, kind: 'truce' }, { aiRealms: [2] }));
  f.tick(30);
  const original = plain(f.state), first = f.api.realmSimSanitize(original), second = f.api.realmSimSanitize(plain(first));
  assert.deepEqual(plain(first.management), original.management);
  assert.deepEqual(plain(first.realms.map(R => R.management)), original.realms.map(R => R.management));
  assert.deepEqual(plain(first.realms.map(R => R.s)), original.realms.map(R => R.s));
  assert.deepEqual(plain(second.management), plain(first.management));
  assert.deepEqual(plain(second.realms.map(R => R.management)), plain(first.realms.map(R => R.management)));
  zeroPopulation(f);
  const empty = f.api.realmSimSanitize(plain(f.state)); assert.equal(empty.realms[0].management.population, 0);
});

test('expired replies reject atomically and ordinary stepping expires the proposal', () => {
  const f = fixture(); fund(f, 0); fund(f, 1);
  succeed(f.action(0, { type: 'offer', targetRealm: 1, giveResource: 'timber', giveAmount: 10, wantResource: 'stone', wantAmount: 10 }));
  const offer = f.state.management.offers.at(-1); f.state.t = offer.expires + 1;
  noCharge(f, 1, { type: 'reply', offerId: offer.id, accept: true });
  assert.equal(offer.status, 'pending'); f.tick(1); assert.equal(offer.status, 'expired');
});
test('native world snapshot validation and season readback preserve the full economy exactly', () => {
  const f = fixture(); fund(f); pauseAll(f); commission(f, 'mill');
  succeed(f.action(0, { type: 'treaty', targetRealm: 1, kind: 'truce' }, { aiRealms: [1] }));
  succeed(f.action(0, { type: 'offer', targetRealm: 2, giveResource: 'timber', giveAmount: 10, wantResource: 'stone', wantAmount: 10 }));
  f.tick(13); const input = plain(f.state);
  const snapshot = checkedWorldSnapshot({ worlds: {}, season: input }, { keepCount: 6,
    realmModule: { loops: true, realmSimSanitize: f.api.realmSimSanitize } });
  assert.deepEqual(snapshot.season, input, 'native validator preserves every accepted season field');
  const restored = f.api.realmSimSanitize(snapshot.season);
  assert.deepEqual(plain(restored.management), input.management);
  assert.deepEqual(plain(restored.realms.map(R => R.management)), input.realms.map(R => R.management));
  assert.deepEqual(plain(restored.realms.map(R => R.s)), input.realms.map(R => R.s));
});

const LEGACY_NATIVE_FIXTURE = "{\"worlds\":{},\"season\":{\"v\":1,\"seed\":20261027,\"rs\":20261027,\"n\":1,\"t\":0,\"len\":2419200,\"nextLen\":0,\"phase\":\"muster\",\"winner\":null,\"t0\":0,\"live\":false,\"names\":{\"realms\":[\"Logres\",\"Ériu\",\"Thule\"],\"keeps\":[\"the Logres keep west\",\"the Logres keep east\",\"the Ériu keep west\",\"the Ériu keep east\",\"the Thule keep west\",\"the Thule keep east\"]},\"realms\":[{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":12,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}},{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":12,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}},{\"s\":[320,128,96,40,32,24,10,480],\"bank\":[0,0,0,0,0,0,0,0],\"lev\":12,\"sp\":0,\"del\":0,\"work\":0,\"proj\":{\"walls\":0,\"granary\":0,\"yard\":0,\"smithy\":0,\"engines\":0},\"act\":\"granary\",\"prog\":0,\"votes\":{},\"aim\":-1,\"short\":[],\"hungry\":0,\"by\":{},\"raidAt\":0,\"decideAt\":0,\"levyAt\":0,\"refillAt\":0,\"dDay\":-1,\"dWorth\":0,\"stats\":{\"trained\":0,\"lost\":0,\"taken\":0,\"raids\":0,\"made\":0,\"ate\":0,\"offensives\":0,\"won\":0,\"hungryH\":0,\"poured\":0,\"bought\":0}}],\"keeps\":[{\"h\":0,\"home\":0,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":0,\"home\":0,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":1,\"home\":1,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":1,\"home\":1,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":2,\"home\":2,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null},{\"h\":2,\"home\":2,\"g\":8,\"tier\":0,\"gate\":1,\"siege\":null}],\"hallows\":[0,1,2],\"hallowAt\":[0,0,0],\"armies\":[],\"nextArmy\":1,\"offs\":[],\"log\":[{\"t\":0,\"r\":-1,\"k\":\"news\",\"x\":\"The first season of the March begins: 28 days, the muster first (4d 16h). Raise your stores, build and train: no keep can fall until the war.\"}],\"past\":[],\"stats\":{\"captures\":0,\"sieges\":0,\"relief\":0,\"raids\":0,\"battles\":0},\"ln\":1}}";
const LEGACY_NATIVE_SHA256 = "e923b4c824883c4f68bff4193745f93393faf66ca940764878d4233414074fba";

test('a confirmed pre-management native season restores byte-exactly before economy initialization', () => {
  const f = fixture(), confirmed = JSON.parse(LEGACY_NATIVE_FIXTURE);
  const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  assert.equal(digest(confirmed), LEGACY_NATIVE_SHA256, 'fixed native admission fixture digest');
  const restored = f.api.realmSimSanitize(confirmed.season);
  assert.equal(Object.hasOwn(restored, 'management'), false);
  assert.equal(Object.hasOwn(restored, 'managementReceipts'), false);
  for (const realm of restored.realms) assert.equal(Object.hasOwn(realm, 'management'), false);
  const native = checkedWorldSnapshot({ worlds: confirmed.worlds, season: plain(restored) }, { keepCount: 6,
    realmModule: { loops: true, realmSimSanitize: f.api.realmSimSanitize } });
  assert.deepEqual(native, confirmed);
  assert.equal(digest(native), LEGACY_NATIVE_SHA256, 'accepted legacy bytes keep their confirmed digest');
  const rawPools = plain(restored.realms.map(R => R.s));
  const view = f.api.realmManageView(restored, 0);
  assert.equal(view.v, 1); assert.equal(restored.management.v, 1);
  assert.deepEqual(plain(restored.realms.map(R => R.s)), rawPools, 'initialization after admission preserves existing raw stores');
});
