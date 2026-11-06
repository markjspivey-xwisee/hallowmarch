/** Canonical placement versions preserve earned works while new commissions use vetted sites. */
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { checkedWorldSnapshot } from '../../server/gaming/hallowmarch-world-state.js';

const read = name => readFileSync(new URL('../../src/' + name, import.meta.url), 'utf8');
const source = read('08m_realm.js') + '\n' + read('08p_realm_management.js');
const plain = value => JSON.parse(JSON.stringify(value));
function fixture() {
  const context = vm.createContext({ module: { exports: {} } });
  vm.runInContext(source + '\nglobalThis.api = { realmSimInit, realmSimSanitize, realmManageInit, realmManageAction, realmManageView, realmManageStep, rmBuilding, rmPlots, RM_PLOT_LAYOUT_V2 };', context);
  const api = context.api, state = api.realmSimInit(20261027, { days: 28 }); api.realmManageInit(state);
  return { api, state, view: realm => api.realmManageView(state, realm),
    action: (realm, args) => api.realmManageAction(state, realm, { revision: state.management.revision, ...args }) };
}
function fund(f, realm = 0) {
  const ids = ['food', 'timber', 'stone', 'iron', 'hides', 'wool', 'horses', 'gold'];
  for (const row of f.view(realm).stocks) {
    const index = ids.indexOf(row.id), amount = row.cap * 0.75;
    if (index >= 0) f.state.realms[realm].s[index] = amount; else f.state.realms[realm].management.stock[row.id] = amount;
  }
}
function coordinates(row) { return plain({ x: row.x, z: row.z, home: row.home, yaw: row.yaw, placementVersion: row.placementVersion }); }
function historicalCoordinates(id) {
  const [kind, rawSite, rawIndex] = id.split(':'), site = Number(rawSite), index = Number(rawIndex), home = kind === 'town' ? site : Math.floor(site / 2);
  const a = [150, 270, 30][home] * Math.PI / 180, dx = Math.sin(a), dz = -Math.cos(a);
  const at = (along, lat) => ({ x: dx * along - dz * lat, z: dz * along + dx * lat });
  const center = kind === 'town' ? { x: 0, z: 0 } : at(118, site % 2 === 0 ? 64 : -64);
  const offset = kind === 'town' ? at(432 + Math.floor(index / 4) * 18, [-63, -39, 39, 63][index % 4]) : at([-28, -28, 28, 28][index], [-26, 26, -26, 26][index]);
  return { x: Math.round((center.x + offset.x) * 100) / 100, z: Math.round((center.z + offset.z) * 100) / 100,
    home, yaw: Math.atan2(-Math.sin(a), Math.cos(a)), placementVersion: 1 };
}
function populate(f, version) {
  const plots = f.api.rmPlots(f.state);
  for (const realm of f.state.realms) realm.management.buildings = [];
  for (const plot of plots) {
    const record = f.api.rmBuilding(plot.id, 'mill', true);
    if (version !== undefined) record.placementVersion = version;
    f.state.realms[plot.owner].management.buildings.push(record);
  }
}

test('every historical occupied plot keeps its exact coordinates and missing version without rewriting the world', () => {
  const f = fixture(); populate(f);
  const original = plain(f.state), view = f.view(0);
  assert.equal(view.publicPlots.length, 72); assert.equal(view.publicBuildings.length, 72);
  assert.equal(new Set(view.publicPlots.map(row => row.id)).size, 72);
  for (const plot of view.publicPlots) {
    assert.deepEqual(coordinates(plot), historicalCoordinates(plot.id));
    assert.deepEqual(coordinates(view.publicBuildings.find(building => building.plotId === plot.id)), historicalCoordinates(plot.id));
  }
  assert.deepEqual(plain(f.state), original, 'viewing does not migrate existing works or stores');
  const restored = f.api.realmSimSanitize(original);
  assert.deepEqual(plain(restored.realms.map(row => row.management)), original.realms.map(row => row.management));
  assert.ok(restored.realms.every(row => row.management.buildings.every(building => !Object.hasOwn(building, 'placementVersion'))));
});

test('the authoritative version-two catalog covers all stable IDs and empty plots select its sites', () => {
  const f = fixture(); for (const realm of f.state.realms) realm.management.buildings = [];
  const plots = f.view(0).publicPlots;
  assert.equal(Object.keys(f.api.RM_PLOT_LAYOUT_V2).length, 72); assert.equal(plots.length, 72);
  for (const plot of plots) {
    const canonical = f.api.RM_PLOT_LAYOUT_V2[plot.id];
    assert.ok(canonical, plot.id); assert.equal(plot.placementVersion, 2); assert.equal(plot.placementAvailable, true);
    assert.equal(plot.x, canonical.x); assert.equal(plot.z, canonical.z);
    assert.ok(Number.isFinite(plot.x) && Number.isFinite(plot.z) && Math.abs(plot.x) < 500 && Math.abs(plot.z) < 500);
    assert.equal(plot.home, historicalCoordinates(plot.id).home); assert.equal(plot.yaw, historicalCoordinates(plot.id).yaw);
  }
});

test('commissioning pins version two and ignores supplied coordinates, home, yaw and downgrade attempts', () => {
  const f = fixture(); fund(f);
  const before = coordinates(f.view(0).plots.find(plot => plot.id === 'town:0:10'));
  assert.equal(before.placementVersion, 2);
  const result = f.action(0, { type: 'build', plotId: 'town:0:10', kind: 'house', placementVersion: 1, x: 999, z: -999, home: 2, yaw: 9 });
  assert.equal(result.ok, true, result.why);
  const building = f.state.realms[0].management.buildings.find(row => row.plotId === 'town:0:10');
  assert.equal(building.placementVersion, 2); assert.equal(Object.hasOwn(building, 'x'), false); assert.equal(Object.hasOwn(building, 'yaw'), false);
  assert.deepEqual(coordinates(f.view(0).buildings.find(row => row.id === building.id)), before, 'commissioning cannot snap the building back to the old layout');
  building.remaining = 17.5; building.assigned = 2; building.paused = true;
  const original = plain(f.state), admitted = checkedWorldSnapshot({ worlds: {}, season: original }, { keepCount: 6,
    realmModule: { loops: true, realmSimSanitize: f.api.realmSimSanitize } });
  assert.deepEqual(admitted.season, original, 'native admission preserves paid work and its placement pin');
  const restored = f.api.realmSimSanitize(admitted.season), again = f.api.realmSimSanitize(plain(restored));
  assert.deepEqual(plain(restored.realms.map(row => row.management)), original.realms.map(row => row.management));
  assert.deepEqual(plain(restored.realms.map(row => row.s)), original.realms.map(row => row.s));
  assert.deepEqual(plain(again), plain(restored));
  assert.deepEqual(coordinates(f.api.realmManageView(restored, 0).buildings.find(row => row.id === building.id)), before);
});

test('known explicit versions survive reload and unknown placement versions never downgrade to a legacy site', () => {
  const f = fixture(); populate(f, 1);
  const records = f.state.realms.flatMap(row => row.management.buildings);
  records[0].placementVersion = 2; records[1].placementVersion = 3;
  const restored = f.api.realmSimSanitize(plain(f.state)), kept = restored.realms.flatMap(row => row.management.buildings);
  assert.equal(kept.find(row => row.id === records[0].id).placementVersion, 2);
  assert.equal(kept.some(row => row.id === records[1].id), false, 'an unsupported site version is rejected, not relocated');
  assert.ok(kept.filter(row => row.id !== records[0].id).every(row => row.placementVersion === 1));
});

test('keep capture changes control while legacy and current buildings retain their home orientation and position', () => {
  const f = fixture(); fund(f);
  assert.equal(f.action(0, { type: 'build', plotId: 'keep:0:0', kind: 'sawmill' }).ok, true);
  const legacy = f.api.rmBuilding('keep:0:1', 'house', true); f.state.realms[0].management.buildings.push(legacy);
  const ids = ['b:keep:0:0', legacy.id], before = new Map(f.view(0).publicBuildings.filter(row => ids.includes(row.id)).map(row => [row.id, coordinates(row)]));
  f.state.keeps[0].h = 1;
  for (const row of f.view(1).buildings.filter(row => ids.includes(row.id))) {
    assert.equal(row.owner, 1); assert.equal(row.home, 0); assert.deepEqual(coordinates(row), before.get(row.id));
  }
  assert.equal(before.size, 2);
});

test('a fully developed winning realm preserves placement metadata through the bounded decoder and still rejects oversized views', () => {
  const f = fixture(); populate(f, 2);
  for (const realm of f.state.realms) for (const building of realm.management.buildings) Object.assign(building, {
    kind: 'toolmaker', adopted: false, level: 2, targetLevel: 3, status: 'upgrading', remaining: 179.123, total: 180,
    workers: 4, assigned: 2, priority: 2, paused: true, blocked: 'construction',
  });
  for (const keep of f.state.keeps) keep.h = 0;
  f.state.t += 1; f.api.realmManageStep(f.state, 1);
  for (const realm of f.state.realms) realm.management.log = Array.from({ length: 12 }, (_, i) => ({ at: i, text: 'A'.repeat(160) }));
  f.state.management.offers = Array.from({ length: 24 }, (_, i) => ({ id: i + 1, from: 0, to: i % 2 + 1,
    type: 'trade', treaty: '', give: { id: 'timber', n: 10 }, want: { id: 'stone', n: 10 },
    status: 'accepted', at: 0, expires: 1200, acceptedAt: 1 }));
  f.state.management.nextOffer = 25;
  const admitted = checkedWorldSnapshot({ worlds: {}, season: plain(f.state) }, { keepCount: 6,
    realmModule: { loops: true, realmSimSanitize: f.api.realmSimSanitize } });
  assert.deepEqual(admitted.season, plain(f.state), 'the dense fixture is a valid authoritative native season');
  const view = f.view(0), clientSource = read('14q_netseason.js');
  const decoder = new Function(clientSource.slice(clientSource.indexOf('function netRealmManagementRead('), clientSource.indexOf('function netRealmManagementView(')) + '\nreturn netRealmManagementRead;')();
  assert.equal(view.buildings.length, 40); assert.equal(view.plots.length, 40);
  const length = JSON.stringify(view).length;
  assert.ok(length > 65536 && length < 98304, 'the real winning-realm view needs the placement-aware capacity');
  const decoded = decoder(plain(view));
  assert.ok(decoded, 'full 72-building publication remains within all recursive, depth, string and list bounds');
  assert.deepEqual(decoded.publicPlots, plain(view.publicPlots)); assert.deepEqual(decoded.publicBuildings, plain(view.publicBuildings));
  assert.equal(decoded.publicBuildings.length, 72);
  const oversized = { ...plain(view), extra: Array.from({ length: 100 }, () => 'x'.repeat(240)), extraTwo: Array.from({ length: 100 }, () => 'x'.repeat(240)) };
  assert.ok(JSON.stringify(oversized).length > 98304);
  assert.equal(decoder(oversized), null);
});
