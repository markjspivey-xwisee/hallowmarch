import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createSharedScene, checkedSharedScene } from './shared-scene.js';

const copy = value => structuredClone(value);
const attack = () => ({ type: 'attack', keep: 1, phase: 'travel', byPlayer: true, home: false, why: 'player', untilIn: 180 });
const entities = (order = null, orderVersion = 0, orderToken = '', orderCampaign = 1) => ({ v: 1, full: true, rows: [], remove: [],
  meta: { warbands: [{ id: 1, realm: 0, order, orderVersion, orderToken, orderCampaign }] } });
const receipt = (id, order, orderVersion, campaign = 1) => ({ id, ownerAccount: 'owner-b', to: 'b', digest: 'digest-' + id,
  action: 'warband.order', ok: true, durable: false, goods: [], gold: 0, items: [], skills: [],
  result: { campaign, orderVersion, warband: { id: 1, order } } });

function fixture(saved = {}) {
  let clock = 100000, host = 'a', valid = true, mutable = true, writes = 0;
  const room = { name: 'march', clients: new Map() }, packets = [];
  const admission = { origin: 'https://game.test', epoch: 1 };
  function add(peer) {
    const c = { peer, room, live: true, acct: { id: 'owner-' + peer }, since: room.clients.size,
      slow: { on: 1, r: 0, l: 20, rr: 2, sharedScene: 2, warbandOrders: 1, dn: peer },
      fast: { p: [2, 0, 3], d: 0 }, pos: { x: 2, z: 3 }, posT: clock, worldAdmission: admission };
    room.clients.set(peer, c); return c;
  }
  const a = add('a'), b = add('b');
  const scene = createSharedScene({ hostFor: () => room.clients.get(host), live: c => c.live,
    admission: () => admission, stateFor: () => saved, canMutate: () => mutable, validatePersist: () => valid,
    changed: () => writes++, now: () => clock, send: (c, m) => packets.push({ to: c.peer, m: copy(m) }) });
  scene.sync(room);
  const authority = c => packets.findLast(p => p.to === c.peer && p.m.kind === 'authority').m.authority;
  const send = (c, m) => scene.handle(c, { t: 'activity', authority: authority(c), worldAdmission: admission, ...m });
  let next = { entities: 0, worldparts: 0 };
  function publish(kind, data) {
    const text = JSON.stringify(data), total = Math.ceil(text.length / 3500), seq = ++next[kind]; let result;
    for (let part = 0; part < total; part++) result = send(room.clients.get(host), {
      kind, op: 'snapshot', seq, part, total, data: text.slice(part * 3500, (part + 1) * 3500) });
    return result;
  }
  const worldparts = receipts => publish('worldparts', { v: 1, full: true, parts: {}, remove: [], receipts });
  return { a, b, scene, room, state: saved, packets, send, publish, worldparts, admission,
    band: () => saved.activity.entities.meta.warbands[0], writes: () => writes,
    valid: v => { valid = v; }, mutable: v => { mutable = v; },
    tick(ms) { clock += ms; for (const c of room.clients.values()) c.posT = clock; },
    host(id) { host = id; next = { entities: 0, worldparts: 0 }; scene.sync(room); } };
}

test('only a live throne occupant receives a server-stamped throne command grant', () => {
  const f = fixture(), e = entities();
  e.meta.thrones = [{ id: 15, realm: 0, x: 2, y: 0, z: 3, ready: true }];
  f.publish('entities', e); f.worldparts([]); f.b.slow.l = 1; f.b.slow.rr = 0;
  assert.equal(f.send(f.b, { kind: 'thrones', op: 'claim', id: 15, seq: 1 }), true);
  const command = id => ({ id, op: 'warband.order', args: { campaign: 1, version: 0, wb: 1, cmd: 'defend', table: 15, target: 0 }, goods: {} });
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command: command('b:seated') }), true);
  const forwarded = () => f.packets.findLast(p => p.m.op === 'command').m.actorState;
  assert.equal(forwarded().throne, 15); assert.equal(forwarded().level, 1);
  assert.equal(f.send(f.b, { kind: 'thrones', op: 'release', id: 15, seq: 2 }), true);
  assert.equal(f.send(f.b, { kind: 'worldparts', op: 'command', command: command('b:standing'), actorState: { throne: 15 } }), true);
  assert.equal(forwarded().throne, undefined, 'caller-supplied actor context cannot forge a released seat');
});

test('orders and release revisions commit with their receipts and emit canonical patches', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const first = receipt('b:attack', attack(), 1);
  assert.equal(f.worldparts([first]), true);
  assert.equal(f.band().orderVersion, 1); assert.equal(f.band().orderToken, first.id);
  assert.equal(f.state.activity.worldparts.receipts[0].result.orderVersion, 1);
  const patches = f.packets.filter(p => p.m.op === 'warband-order');
  assert.equal(patches.length, 2); assert.equal(patches[0].m.orderVersion, 1);
  assert.equal(patches[0].m.warband.order.keep, 1);
  assert.equal(f.worldparts([first, receipt('b:release', null, 2)]), true);
  assert.equal(f.band().order, null); assert.equal(f.band().orderVersion, 2);
  assert.ok(checkedSharedScene(f.state.activity));
});

test('entity snapshots cannot advance command revisions or rewind a release, but matching AI transitions work', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const queued = entities(attack(), 1, 'b:attack');
  f.publish('entities', queued);
  assert.equal(f.band().order, null, 'unconfirmed optimistic entity metadata is not a command');
  f.worldparts([receipt('b:attack', attack(), 1)]);
  f.worldparts([receipt('b:attack', attack(), 1), receipt('b:release', null, 2)]);
  f.publish('entities', queued);
  assert.equal(f.band().order, null); assert.equal(f.band().orderVersion, 2);
  f.publish('entities', entities({ ...attack(), byPlayer: false, why: 'commander' }, 2, 'b:release'));
  assert.equal(f.band().order.byPlayer, false, 'accepted token may be retasked by canonical AI');
  f.publish('entities', entities(attack(), 99, 'forged'));
  assert.equal(f.band().orderVersion, 2); assert.equal(f.band().order.byPlayer, false);
});

test('pruned old receipt cannot resurrect an order after handoff and cold restart', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const old = receipt('b:attack', attack(), 1), release = receipt('b:release', null, 2);
  f.worldparts([old, release]);
  for (const r of [old, release]) assert.equal(f.send(f.b, { kind: 'worldparts', op: 'settled', id: r.id, digest: r.digest }), true);
  const filler = Array.from({ length: 9 }, (_, i) => ({ id: 'done-' + i, ownerAccount: 'owner-b', to: 'b',
    digest: 'filler-' + i, ok: true, durable: false, settled: true, result: null }));
  f.worldparts(filler);
  assert.equal(f.state.activity.worldparts.receipts.some(r => r.id === old.id), false);
  f.host('b'); f.worldparts([...f.state.activity.worldparts.receipts, old]);
  assert.equal(f.band().order, null); assert.equal(f.band().orderVersion, 2);
  const cold = fixture(copy(f.state));
  cold.worldparts([old]);
  assert.equal(cold.band().order, null); assert.equal(cold.band().orderVersion, 2);
  cold.publish('entities', entities(attack(), 1, old.id));
  assert.equal(cold.band().order, null, 'the revision fence survives process restart');
});

test('campaign reset clears its revision explicitly and retires delayed old campaign receipts', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([receipt('b:first', attack(), 1)]);
  f.publish('entities', entities(null, 0, '', 2));
  assert.equal(f.band().orderCampaign, 2); assert.equal(f.band().orderVersion, 0);
  f.worldparts([receipt('b:old-delayed', attack(), 2, 1)]);
  assert.equal(f.band().order, null); assert.equal(f.band().orderVersion, 0);
  f.worldparts([receipt('b:new', attack(), 1, 2)]);
  assert.equal(f.band().orderCampaign, 2); assert.equal(f.band().orderVersion, 1);
});

test('receipt gaps, future campaign effects and malformed orders leave both caches untouched', () => {
  for (const bad of [receipt('b:gap', attack(), 2), receipt('b:future', attack(), 1, 2),
    receipt('b:invalid', { ...attack(), keep: 99 }, 1), receipt('b:string', attack(), '1')]) {
    const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
    const before = copy(f.state);
    assert.equal(f.worldparts([bad]), false); assert.deepEqual(copy(f.state), before);
    assert.equal(f.packets.some(p => p.m.op === 'warband-order'), false);
  }
});

test('refused checkpoint rolls back army, command revision, receipt and public patch atomically', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const before = copy(f.state), patches = f.packets.filter(p => p.m.op === 'warband-order').length;
  f.valid(false);
  assert.equal(f.worldparts([receipt('b:first', attack(), 1)]), false);
  assert.deepEqual(copy(f.state), before); assert.equal(f.packets.filter(p => p.m.op === 'warband-order').length, patches);
  f.valid(true); assert.equal(f.worldparts([receipt('b:first', attack(), 1)]), true);
  assert.equal(f.band().orderVersion, 1);
});

test('a missing canonical band settles as failure while unrelated state continues and a stale keeper cannot reopen success', () => {
  for (const seeded of [false, true]) {
    const f = fixture();
    if (seeded) f.publish('entities', { ...entities(), meta: { warbands: [] } });
    const original = receipt('b:gone', attack(), 1), ordinary = { id: 'b:other', to: 'b', ownerAccount: 'owner-b',
      digest: 'other-digest', ok: true, durable: false, result: { done: true } };
    assert.equal(f.publish('worldparts', { v: 1, full: true, parts: { farm: { stage: 2 } }, remove: [], receipts: [original, ordinary] }), true);
    assert.equal(f.state.activity.worldparts.parts.farm.stage, 2);
    const refused = f.state.activity.worldparts.receipts.find(r => r.id === original.id);
    assert.equal(refused.ok, false); assert.equal(refused.result, null); assert.match(refused.reason, /warband is no longer available/);
    assert.equal(refused.digest, original.digest); assert.equal(f.state.activity.worldparts.receipts.find(r => r.id === ordinary.id).ok, true);
    assert.equal(f.packets.some(p => p.m.op === 'warband-order'), false);
    const canonicalPacket = f.packets.findLast(p => p.m.kind === 'worldparts' && p.m.op === 'snapshot').m;
    assert.equal(JSON.parse(canonicalPacket.data).receipts.find(r => r.id === original.id).ok, false);
    f.publish('entities', entities());
    assert.equal(f.worldparts([original, ordinary]), true);
    assert.equal(f.state.activity.worldparts.receipts.find(r => r.id === original.id).ok, false);
    assert.equal(f.band().order, null); assert.equal(f.band().orderVersion, 0);
  }
});

test('server derives caller context once, rejects forged or inactive callers, and preserves it on retry', () => {
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const command = { id: 'b:command', op: 'warband.order', args: { campaign: 1, wb: 1, cmd: 'attack', target: 1, table: -1, version: 0 }, goods: {} };
  const request = { kind: 'worldparts', op: 'command', command, actorState: { rank: 20, y: 200, alive: true } };
  assert.equal(f.send(f.b, request), true);
  const forwarded = f.packets.findLast(p => p.m.op === 'command').m;
  assert.deepEqual(forwarded.actorState, { alive: true, y: 0, level: 20, rank: 2, name: 'b' });
  f.tick(3000); f.b.fast = { p: [99, 200, 99], d: 1 }; f.b.slow.rr = 20; f.b.pos = { x: 99, z: 99 };
  assert.equal(f.send(f.b, request), true);
  assert.deepEqual(f.packets.findLast(p => p.m.op === 'command').m.actorState, forwarded.actorState);
  assert.deepEqual(f.packets.findLast(p => p.m.op === 'command').m.position, forwarded.position);
  assert.equal(f.send(f.b, { ...request, command: { ...command, id: 'b:dead' } }), false);
  f.b.fast.d = 0; f.b.live = false;
  assert.equal(f.send(f.b, { ...request, command: { ...command, id: 'b:idle' } }), false);
  f.b.live = true; f.a.slow.warbandOrders = 0;
  assert.equal(f.send(f.b, { ...request, command: { ...command, id: 'b:legacy' } }), false);
});

test('persisted command revisions fence legacy keepers without scheduling idle writes', () => {
  const source = readFileSync(new URL('./server.js', import.meta.url), 'utf8');
  const extract = name => { const at = source.indexOf('function ' + name + '('); return source.slice(at, source.indexOf('\n}', at) + 2); };
  const state = { activity: { entities: entities(null, 2, 'b:release') } };
  const room = { name: 'march', clients: new Map() };
  const a = { peer: 'a', live: true, since: 1, slow: { on: 1, sharedScene: 2, warbandOrders: 0 } };
  const b = { peer: 'b', live: true, since: 2, slow: { on: 1, sharedScene: 2, warbandOrders: 1 } };
  room.clients.set('a', a); room.clients.set('b', b);
  const context = vm.createContext({ WORLDS: { march: state }, isHumanPlaying: c => c.live });
  vm.runInContext(extract('roomNeedsWarbandOrders') + '\n' + extract('roomHost'), context);
  assert.equal(context.roomHost(room).peer, 'b');
  b.live = false; assert.equal(context.roomHost(room), null);
  const f = fixture(); f.publish('entities', entities()); f.worldparts([]);
  const writes = f.writes(), before = copy(f.state); f.a.live = false; f.b.live = false; f.tick(60000);
  f.scene.sync(f.room); assert.equal(f.writes(), writes); assert.deepEqual(copy(f.state), before);
});
