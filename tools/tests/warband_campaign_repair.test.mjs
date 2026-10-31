// Run: node --test tools/tests/warband_campaign_repair.test.mjs
import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const src = fileURLToPath(new URL('../../src/', import.meta.url));
// Allows testing the two-file repair checkout against its unchanged AI baseline.
const base = process.env.HALLOWMARCH_BASE_SOURCE || src;
const campaign = readFileSync(resolve(src, '08g_campaign.js'), 'utf8');
const ai = readFileSync(resolve(base, '08_ai.js'), 'utf8');
const siege = readFileSync(resolve(base, '04i_siege3.js'), 'utf8');
function declaration(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `missing real function ${name}`);
  const end = source.indexOf('\n}', start);
  // Some small declarations occupy one line.
  const lineEnd = source.indexOf('\n', start);
  return source.slice(start, source.slice(start, lineEnd).trimEnd().endsWith('}') ? lineEnd : end + 2);
}

function fixture(order = { type: 'attack', keep: 0, phase: 'travel' }) {
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
  const unit = (id, x) => ({ id, x, z: 0, yaw: 0, faction: 0, alive: true, carrying: null,
    cls: 'warrior', mount: null, target: null, ai: { nextScan: Infinity, remountAt: Infinity } });
  const leader = unit(11, 0), follower = unit(12, -10);
  const entities = new Map([[leader.id, leader], [follower.id, follower]]);
  const band = { id: 32, realm: 0, members: [11, 12], order };
  const moves = [];
  const context = vm.createContext({ WAR: { keeps, temples, relics, warbands: [band], stats: {} },
    REALMS: realms, NAV: { nodes }, GAME: { t: 100, player: null },
    SIEGE3: { stats: {} },
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
    bandStartNode: () => nodes[0], nearestNavNode: () => nodes[0],
    navPath: (a, b) => [a, b], news: () => {},
    relicPosition: (rel) => rel.state === 'temple' ? temples[rel.at]?.site : rel,
  });
  const names = ['wbMembers', 'wbLeader', 'wbSetOrder', 'doorOpenFor', 'wbPlan', 'updateWarband', 'thinkSoldier', 'followTrail'];
  vm.runInContext(names.map((name) => declaration(ai, name)).join('\n') + '\n' + declaration(siege, 'bandUnstick'), context);
  vm.runInContext(campaign.slice(0, campaign.indexOf('(function campaignStyle()')), context);
  return { context, band, leader, follower, moves, nodes, temples, relics, keeps };
}

test('partial observer orders use canonical targets, with a recoverable legacy raid', () => {
  const f = fixture({ type: 'raid', relic: 0, phase: 'travel' });
  const { context: c, band, temples, relics } = f;
  const original = band.order;
  assert.equal(c.cwOrderView(band).temple, temples[1]);
  assert.deepEqual({ ...c.cwTarget(band) }, { x: temples[1].site.x, z: temples[1].site.z });
  assert.equal(c.orderShort(band)[2], temples[1].site.name);
  assert.match(c.orderPhrase(band, band.order), /Temple 1/);
  assert.equal(band.order, original, 'observer rendering must not mutate an order');
  assert.ok(c.cwRoute(band).length >= 2);
  for (const order of [{ type: 'raid', relic: 0, temple: 99 }, { type: 'raid' },
    { type: 'attack', keep: { id: 99, site: { x: 1, z: 1 } } }, { type: 'patrol' },
    { type: 'carry' }, { type: 'retrieve', relic: null }]) {
    band.order = order;
    assert.equal(c.cwTarget(band), null);
    assert.equal(c.cwRoute(band), null);
    assert.equal(c.orderShort(band)[1], 'Mustering');
    assert.equal(c.orderPhrase(band, order), 'awaits orders');
  }
  band.order = { type: 'raid', relic: 0 };
  relics[0].state = 'ground';
  assert.equal(c.cwOrderView(band), null, 'a lost legacy raid target must be retasked');
});

test('promotion prepares missing and empty trails before the first real NPC tick', () => {
  for (const trail of [undefined, [], [{ x: NaN, z: 1 }]]) {
    const { context: c, band, follower, leader, moves, keeps } = fixture();
    band.trail = trail;
    band.path = null;
    band.goal = keeps[0].nav.gate.id;
    follower.ai.trailAbs = 999;
    // This retained local recovery state formerly called followTrail on undefined.
    follower.ai.unstick = { x: follower.x, z: follower.z, t: 99, mode: 1, until: 105, side: 1 };
    assert.equal(c.cwPrepareReplicaBand(band), true);
    assert.equal(band.L, leader);
    assert.equal(follower.warband, band);
    assert.equal(band.goal, null, 'a missing path must allow normal replanning');
    assert.equal(band.trail.length, 1);
    assert.equal(follower.ai.trailAbs, undefined);
    c.thinkSoldier(follower, 1 / 60); // NPCs tick before updateWar.
    assert.equal(moves.length, 1);
    assert.equal(follower.ai.trailAbs, 0);
    c.updateWarband(band, 1 / 60);
    assert.equal(band.goal, keeps[0].nav.gate.id);
    assert.ok(band.path.length);
    assert.deepEqual([leader.x, leader.z, follower.x, follower.z], [0, 0, -10, 0]);
  }
});

test('repair preserves living navigation and valid orders, including player patrols', () => {
  const { context: c, band, nodes, leader, follower } = fixture();
  const order = { type: 'patrol', node: nodes[1], phase: 'travel', until: 400, byPlayer: true };
  Object.assign(band, { order, L: leader, lid: leader.id, trail: [{ x: -2, z: 0 }, { x: 0, z: 0 }],
    trailBase: 9, path: [0, 1], pathIdx: 1, goal: 1, leaderGoal: { x: 30, z: 2 },
    progX: -3, progZ: 0, lastProgress: 80, realProgress: 90, engagedUntil: 101, engaged: true });
  follower.ai.trailAbs = 9;
  const before = { ...band };
  c.cwPrepareReplicaBand(band);
  c.cwPrepareReplicaBand(band);
  for (const key of ['order', 'L', 'lid', 'trail', 'trailBase', 'path', 'pathIdx', 'goal', 'leaderGoal',
    'progX', 'progZ', 'lastProgress', 'realProgress', 'engagedUntil', 'engaged']) assert.equal(band[key], before[key], key);
  assert.equal(follower.ai.trailAbs, 9);
});

test('unrecoverable orders return to the commander and malformed paths can replan', () => {
  const { context: c, band, keeps, nodes } = fixture({ type: 'raid', relic: 0, temple: 99 });
  band.path = [0, 999]; band.pathIdx = -1; band.goal = 999; band.leaderGoal = { x: 999, z: 999 };
  c.cwPrepareReplicaBand(band);
  assert.equal(band.order, null);
  assert.equal(band.path, null);
  assert.deepEqual({ ...band.leaderGoal }, { x: 0, z: 0 });
  vm.runInContext("CAMPAIGN.state = 'peace'; CAMPAIGN.peaceUntil = 200; planWar({ realm: 0 });", c);
  assert.equal(band.order.type, 'patrol');
  assert.equal(band.order.node, nodes[0]);
  assert.equal(band.order.home, true);
  band.order = { type: 'attack', keep: { id: keeps[0].id }, phase: 'travel' };
  c.cwPrepareReplicaBand(band);
  assert.equal(band.order.keep, keeps[0]);
  c.updateWarband(band, 1 / 60);
  assert.equal(band.goal, keeps[0].nav.gate.id);
});

test('a transferred rally follows its bound caller and never the new keeper', () => {
  const { context: c, band, leader } = fixture({ type: 'rally', rallyPeer: 'caller', byPlayer: true,
    phase: 'travel', until: 200, x: 55, z: 0 });
  const keeper = { alive: true, faction: 0, name: 'Keeper', x: 200, z: 0 };
  const caller = { alive: true, faction: 0, name: 'Caller', x: 60, z: 0 };
  c.GAME.player = keeper;
  c.NET = { self: 'keeper' };
  c.netEntityFind = (ref) => ref === 'peer:caller' ? caller : null;
  c.inDungeon = () => false;
  c.R_RING = 1000;
  c.cwPrepareReplicaBand(band);
  assert.equal(c.rallyPoint(band, band.order, leader), true);
  assert.equal(band.order.point.x, 55);
  assert.equal(c.cwTarget(band).x, caller.x);
  assert.equal(c.orderShort(band)[2], 'Caller');
  assert.equal(c.orderPhrase(band, band.order), 'rallies to Caller');
  caller.alive = false;
  assert.equal(c.rallyPoint(band, band.order, leader), false);
  assert.equal(c.cwTarget(band).x, 55, 'observer can retain the transmitted rally point');
  assert.equal(c.orderShort(band)[2], '');
  assert.equal(c.orderPhrase(band, band.order), 'rallies to its caller');
  delete band.order.x; delete band.order.z;
  c.updateWarband(band, 1 / 60);
  assert.equal(band.order, null, 'an absent caller returns the band for retasking');
  assert.equal(c.cwTarget({ ...band, order: { type: 'rally', rallyPeer: 'missing' } }), null);
  assert.equal(c.cwTarget({ ...band, order: { type: 'rally', rallyPeer: 'keeper' } }).x, keeper.x);
  assert.equal(c.cwTarget({ ...band, order: { type: 'rally' } }).x, keeper.x, 'standalone rally retains its behavior');
});
