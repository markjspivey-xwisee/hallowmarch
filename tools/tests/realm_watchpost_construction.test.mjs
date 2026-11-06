import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { loadRealmModule } from '../../server/season.js';
import { createRealmManagementProtocol } from '../../server/realm-management.js';
import { checkedWorldSnapshot } from '../../server/gaming/hallowmarch-world-state.js';
import { fixture, activePost, plain, succeed, noChange, setStock, stocks, building, fund, pauseOthers, commission, clientProjection } from './fixtures/realm_watchpost_fixture.mjs';

const near = (got, expected, why = '') => assert.ok(Math.abs(got - expected) < 1e-8, why + ': ' + got + ' != ' + expected);
const spec = f => plain(f.view(0).catalog.find(row => row.id === 'watchpost'));
function save(f) {
  const original = plain(f.state), result = checkedWorldSnapshot({ worlds: {}, season: original }, {
    keepCount: 6, realmModule: { loops: true, realmSimSanitize: f.api.realmSimSanitize },
  });
  assert.deepEqual(result.season, original, 'native admission preserves the exact paid state');
  return f.api.realmSimSanitize(result.season);
}
function serverModule() {
  const module = loadRealmModule(fileURLToPath(new URL('../../src/', import.meta.url)), fileURLToPath(new URL('../../server/', import.meta.url)));
  assert.equal(module.file, '08m_realm.js'); assert.equal(module.loops, true); return module;
}

test('catalog exposes the exact finite Watchpost contract and unchanged ordinary level limits', () => {
  const f = fixture(), D = spec(f);
  assert.deepEqual(D.cost, { timber: 60, stone: 40, iron: 8, tools: 2 });
  assert.equal(D.label, 'Watchpost'); assert.deepEqual(D.siteTypes, ['keep']); assert.equal(D.maxLevel, 1);
  assert.equal(D.seconds, 90); assert.equal(D.workers, 2); assert.deepEqual(D.inputs, { food: 0.5 });
  assert.deepEqual(D.outputs, {}); assert.equal(D.defenseSupport, 0.1);
  assert.equal(f.view(0).catalog.length, 15);
  for (const row of f.view(0).catalog) if (row.id !== 'watchpost') assert.equal(row.maxLevel, 3);
});

test('actual new commissions enforce every site class before payment', () => {
  const townOnly = ['farm', 'mill', 'bakery', 'sheepfold', 'weaver', 'house', 'market'];
  const both = ['woodcutter', 'sawmill', 'mine', 'toolmaker', 'quarry', 'hunter', 'stables'];
  for (const kind of [...townOnly, ...both, 'watchpost']) {
    for (const [site, expected] of [['town:0:10', kind !== 'watchpost'], ['keep:0:0', !townOnly.includes(kind)]]) {
      const f = fixture(); fund(f);
      assert.equal(f.api.realmManageBuildSiteAllowed(kind, f.view(0).plots.find(p => p.id === site)), expected);
      if (expected) succeed(f.action(0, { type: 'build', kind, plotId: site }));
      else noChange(f, 0, { type: 'build', kind, plotId: site });
    }
  }
  const f = fixture(); fund(f);
  for (const args of [
    { type: 'build', kind: 'watchpost', plotId: 'keep:2:0' },
    { type: 'build', kind: 'watchpost', plotId: 'keep:99:0' },
    { type: 'build', kind: '__proto__', plotId: 'keep:0:0' },
    { type: 'build', kind: 'watchpost', plotId: 'keep:0:0', expectedRevision: -1 },
  ]) noChange(f, 0, args);
});

test('commission charges exact materials once, owns no actor or garrison grant and preserves canonical placement', () => {
  const f = fixture(); fund(f); const before = stocks(f), military = plain({ armies: f.state.armies, keeps: f.state.keeps, levy: f.state.realms.map(r => r.lev) });
  const plot = plain(f.view(0).plots.find(p => p.id === 'keep:0:0'));
  succeed(f.action(0, { type: 'build', kind: 'watchpost', plotId: plot.id, x: 999, yaw: 9, placementVersion: 1 }));
  const paid = stocks(f), post = building(f);
  for (const id of Object.keys(before)) near(paid[id], before[id] - (spec(f).cost[id] || 0), id);
  assert.deepEqual(plain({ armies: f.state.armies, keeps: f.state.keeps, levy: f.state.realms.map(r => r.lev) }), military);
  assert.equal(post.status, 'building'); assert.equal(post.level, 0); assert.equal(post.placementVersion, 2);
  assert.equal(Object.hasOwn(post, 'x'), false); assert.equal(Object.hasOwn(post, 'yaw'), false);
  const projected = f.view(0).buildings.find(b => b.id === post.id);
  for (const key of ['x', 'z', 'home', 'yaw', 'placementVersion']) assert.equal(projected[key], plot[key]);
  noChange(f, 0, { type: 'build', kind: 'watchpost', plotId: 'keep:0:0' });
  noChange(f, 0, { type: 'build', kind: 'watchpost', plotId: 'keep:0:1' });
  succeed(f.action(0, { type: 'build', kind: 'watchpost', plotId: 'keep:1:0' }));
  assert.equal(f.state.realms[0].management.buildings.filter(b => b.kind === 'watchpost').length, 2);
});

test('missing one required material refuses without charging any store or advancing revision', () => {
  for (const [id, cost] of Object.entries({ timber: 60, stone: 40, iron: 8, tools: 2 })) {
    const f = fixture(); fund(f); setStock(f, 0, id, cost - 0.01);
    noChange(f, 0, { type: 'build', kind: 'watchpost', plotId: 'keep:0:0' });
  }
});

test('construction uses real allocated work, pause and operating food before benefit', () => {
  const f = fixture(); fund(f); pauseOthers(f); const post = commission(f);
  f.tick(30); near(post.remaining, 60); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0);
  succeed(f.action(0, { type: 'pause', buildingId: post.id, paused: true })); f.tick(60); near(post.remaining, 60);
  succeed(f.action(0, { type: 'pause', buildingId: post.id, paused: false })); f.tick(60);
  assert.equal(post.status, 'built'); assert.equal(post.level, 1); assert.equal(post.working, false);
  assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0, 'completion is not evidence of food paid');
  setStock(f, 0, 'food', 10); setStock(f, 0, 'bread', 0); setStock(f, 0, 'tools', 0);
  const before = stocks(f); f.tick(60);
  near(stocks(f).food, 9.5); assert.equal(post.assigned, 2); assert.equal(post.blocked, ''); assert.equal(post.working, true);
  assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0.1);
  for (const id of ['timber', 'stone', 'iron', 'grain', 'flour', 'planks', 'wool', 'horses']) near(stocks(f)[id], before[id], 'no Watchpost output ' + id);
});

test('one or zero workers, unavailable workforce, pause and partial food each remove support', () => {
  for (const scenario of ['one', 'zero', 'population', 'paused', 'partial', 'empty']) {
    const { f, post } = activePost(); setStock(f, 0, 'bread', 0); setStock(f, 0, 'food', 10);
    if (scenario === 'one' || scenario === 'zero') succeed(f.action(0, { type: 'workforce', buildingId: post.id, workers: scenario === 'one' ? 1 : 0, priority: 2 }));
    if (scenario === 'population') f.state.realms[0].management.population = 0;
    if (scenario === 'paused') succeed(f.action(0, { type: 'pause', buildingId: post.id, paused: true }));
    if (scenario === 'partial' || scenario === 'empty') setStock(f, 0, 'food', scenario === 'partial' ? 0.25 : 0);
    f.tick(60); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0, scenario);
    if (['partial', 'empty'].includes(scenario)) { assert.equal(post.blocked, 'inputs:food'); near(stocks(f).food, 0); }
  }
  const { f, post } = activePost();
  noChange(f, 0, { type: 'workforce', buildingId: post.id, workers: 3, priority: 2 });
  noChange(f, 0, { type: 'upgrade', buildingId: post.id });
  const view = f.view(0).buildings.find(b => b.id === post.id);
  assert.equal(view.maxLevel, 1); assert.equal(view.upgradeCost, null); assert.equal(view.upgradeSeconds, 0);
});

test('capture denies stale old-owner readiness immediately and requires new-owner labor and full food', () => {
  const { f, post } = activePost(); const oldPosition = plain(f.view(0).publicBuildings.find(b => b.id === post.id));
  f.api.realmSimLive(f.state, { type: 'keep', keep: 0, holder: 1, manual: true });
  assert.equal(f.state.keeps[0].h, 1); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0);
  noChange(f, 1, { type: 'build', kind: 'watchpost', plotId: 'keep:0:1' });
  fund(f, 1); setStock(f, 1, 'food', 0); setStock(f, 1, 'bread', 0); f.tick(60);
  assert.equal(f.state.realms[0].management.buildings.includes(post), false);
  assert.equal(f.state.realms[1].management.buildings.includes(post), true);
  assert.equal(post.working, false); assert.equal(post.blocked, 'inputs:food'); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0);
  setStock(f, 1, 'food', 10); f.tick(60); near(stocks(f, 1).food, 9.5); assert.equal(f.api.realmManageDefenseSupport(f.state, 0), 0.1);
  const current = f.view(1).buildings.find(b => b.id === post.id);
  for (const key of ['x', 'z', 'home', 'yaw', 'placementVersion']) assert.equal(current[key], oldPosition[key]);
});

test('save admission roundtrips building and ready states exactly, and pre-transfer capture cannot revive readiness', () => {
  const f = fixture(); fund(f); pauseOthers(f); const post = commission(f); f.tick(17.5);
  const incomplete = save(f); assert.equal(f.api.realmManageDefenseSupport(incomplete, 0), 0);
  f.tick(72.5); f.tick(60); const ready = save(f);
  assert.equal(f.api.realmManageDefenseSupport(ready, 0), 0.1);
  assert.deepEqual(plain(f.api.realmSimSanitize(plain(ready))), plain(ready), 'sanitizer is idempotent');
  f.api.realmSimLive(f.state, { type: 'keep', keep: 0, holder: 1, manual: true });
  assert.equal(post.working, true, 'old row may still contain last-owner paid state until next step');
  const captured = save(f); assert.equal(f.api.realmManageDefenseSupport(captured, 0), 0, 'holder lookup survives save before transfer');
});

test('sanitization refuses town/adopted/duplicate posts and caps Watchpost levels without deleting historic offsite farms', () => {
  const { f, post } = activePost();
  const input = plain(f.state), oldFarm = plain(f.api.rmBuilding('keep:0:2', 'farm', true));
  input.realms[0].management.buildings.push(oldFarm,
    { ...plain(post), id: 'b:town:0:10', plotId: 'town:0:10' },
    { ...plain(post), id: 'b:keep:0:1', plotId: 'keep:0:1' },
    { ...plain(post), id: 'b:keep:1:0', plotId: 'keep:1:0', adopted: true });
  input.realms[0].management.buildings.find(b => b.id === post.id).level = 99;
  input.realms[0].management.buildings.find(b => b.id === post.id).targetLevel = 99;
  const restored = f.api.realmSimSanitize(input), rows = restored.realms.flatMap(r => r.management.buildings);
  assert.equal(rows.filter(b => b.kind === 'watchpost').length, 1);
  assert.equal(rows.find(b => b.id === post.id).level, 1); assert.equal(rows.find(b => b.id === post.id).targetLevel, 1);
  assert.deepEqual(plain(rows.find(b => b.id === oldFarm.id)), oldFarm, 'grandfathered paid offsite building unchanged');
});

test('actual server protocol confirms one canonical commission and replay cannot charge it twice', async () => {
  const f = fixture(); fund(f); const sent = [], M = serverModule();
  const season = { RS: f.state, M, dirty: false, save() {} };
  const protocol = createRealmManagementProtocol({ season, commanderFor: c => c.seated ? { realm: c.realm } : null,
    confirm: async () => {}, send: (_c, msg) => sent.push(msg) });
  const client = { seated: true, realm: 0, acct: { id: 'fictional-watchpost' }, room: { diagnostic: false } };
  const request = { t: 'order', q: 1, o: { kind: 'manage', nonce: 'watchpost-command-a', season: f.state.n,
    revision: f.state.management.revision, hall: 1, args: { type: 'build', kind: 'watchpost', plotId: 'keep:0:0' } } };
  await protocol.handle(client, request); assert.equal(sent.at(-1).ok, true); assert.equal(sent.at(-1).confirmed, true);
  const after = plain(season.RS); await protocol.handle(client, request);
  assert.equal(sent.at(-1).confirmed, true); assert.deepEqual(plain(season.RS), after);
  const noSeat = { ...client, seated: false };
  await protocol.handle(noSeat, { ...request, o: { ...request.o, nonce: 'watchpost-command-b', revision: season.RS.management.revision,
    args: { type: 'build', kind: 'watchpost', plotId: 'keep:1:0' } } });
  assert.equal(sent.at(-1).code, 'throne_required'); assert.deepEqual(plain(season.RS), after);
});

test('server and canonical summaries carry current support through the actual bounded decoder', () => {
  const { f } = activePost(), M = serverModule();
  assert.equal(f.api.realmSimSummary(f.state, 0).keeps[0].defenseSupport, 0.1);
  const packet = M.realmSimSummary(f.state, 0, -1, 'fictional-watchpost'), client = clientProjection(packet, f.state);
  assert.equal(packet.keeps[0].defenseSupport, 0.1); assert.equal(client.wire.keeps[0].defenseSupport, 0.1);
  assert.equal(client.api.current().keeps[0].defenseSupport, 0.1);
  assert.equal(client.wire.management.catalog.find(b => b.id === 'watchpost').maxLevel, 1);
  for (const bad of [-0.1, 1, '0.1', null, undefined]) {
    const changed = plain(packet); changed.t += 1; changed.keeps[0].defenseSupport = bad;
    assert.equal(client.apply(changed).keeps[0].defenseSupport, 0);
  }
});

test('actual computeDamage grants only same-keep guards/lord the finite bonus and leaves armor unchanged', () => {
  const { f } = activePost(), packet = serverModule().realmSimSummary(f.state, 0, -1, 'fictional-watchpost');
  const c = clientProjection(packet, f.state), keep = { id: 0, realm: 0 };
  const guard = { level: 1, dmgMult: 1, faction: 0, role: 'guard', keep };
  const damage = e => c.api.damage(e, { level: 1 }, 1).d;
  near(damage(guard), 110); near(damage({ ...guard, role: 'lord' }), 110); near(c.api.armor(guard), 1);
  for (const extra of [{ role: 'player' }, { role: 'soldier' }, { role: 'remote' }, { role: 'bot' },
    { bot: true }, { netCompanion: true }, { netEntityOwner: 'other' }, { keep: { id: 1, realm: 0 } },
    { keep: { id: 0, realm: 1 } }, { keep: null }]) near(damage({ ...guard, ...extra }), 100);
  const old = plain(packet); old.t += 1; old.keeps[0].r = 1; c.apply(old); near(damage(guard), 100, 'stale owner cannot inherit bonus');
});

test('offline same-keep damage uses canonical readiness while hosted mode never falls through to local readiness', () => {
  const { f, post } = activePost(), packet = serverModule().realmSimSummary(f.state, 0, -1, 'fictional-watchpost');
  const c = clientProjection(packet, f.state), keep = { id: 0, realm: 0 }, guard = { role: 'guard', faction: 0, keep };
  c.ctx.NETWS.url = ''; near(c.api.attack(guard), 1.1); assert.equal(c.api.localSupport(keep), 0.1);
  succeed(f.action(0, { type: 'pause', buildingId: post.id, paused: true })); near(c.api.attack(guard), 1);
  c.ctx.NETWS.url = 'https://fictional.invalid'; assert.equal(c.api.localSupport(keep), 0);
  c.ctx.NETS.s.n += 1; near(c.api.attack(guard), 1, 'no admitted current hosted summary');
});

test('actual canonical siege gains exactly ten percent defensive damage with identical RNG and no extra defenders', () => {
  const { f } = activePost(), enabled = plain(f.state), disabled = plain(f.state);
  enabled.phase = disabled.phase = 'war'; disabled.realms[0].management.buildings.find(b => b.kind === 'watchpost').paused = true;
  const army = () => ({ id: 99, r: 1, k: 0, n: 100, n0: 100, arm: 1, eng: 0, kind: 'assault', state: 'siege', siegeH: 0, manual: true });
  const a = army(), b = army(), before = enabled.keeps[0].g;
  f.api.rsmSiege(enabled, a, enabled.realms[1], 0.01); f.api.rsmSiege(disabled, b, disabled.realms[1], 0.01);
  near((100 - a.n) / (100 - b.n), 1.1); near(enabled.keeps[0].g, disabled.keeps[0].g);
  assert.ok(enabled.keeps[0].g < before); assert.equal(enabled.rs, disabled.rs, 'identical random draws');
  assert.equal(enabled.armies.length, disabled.armies.length); assert.equal(enabled.realms[0].lev, disabled.realms[0].lev);
});
