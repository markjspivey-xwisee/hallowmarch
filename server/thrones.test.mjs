import test from 'node:test';
import assert from 'node:assert/strict';
import { createThrones } from './thrones.js';
import { createSharedScene } from './shared-scene.js';

function fixture() {
  let clock = 10000;
  const admission = { origin: 'https://march.test', epoch: 1 };
  const room = { clients: new Map() };
  const halls = [{ id: 15, realm: 0, x: 0, y: 5, z: 0, ready: true },
    { id: 16, realm: 0, x: 1, y: 5, z: 0, ready: true }];
  const make = peer => ({ peer, room, live: true, worldAdmission: admission,
    pos: { x: 0, z: 0 }, posT: clock, slow: { r: 0 }, fast: { p: [0, 5, 0], d: 0, st: 5.53 } });
  const a = make('a'), b = make('b'); room.clients.set('a', a); room.clients.set('b', b);
  const api = { now: () => clock, live: c => c.live, sameAdmission: (a,b) => a?.origin === b?.origin && a?.epoch === b?.epoch };
  const seats = createThrones(api);
  return { a, b, room, halls, admission, api, seats, tick: ms => { clock += ms; },
    handle: (c, op, seq, id = 15) => seats.handle(c, { op, seq, id }, halls, admission),
    prune: () => seats.prune(room, halls, admission) };
}
test('first claimant wins, a player occupies one throne, and releases are caller-bound', () => {
  const f = fixture();
  assert.equal(f.handle(f.a, 'claim', 1).ok, true);
  assert.equal(f.handle(f.b, 'claim', 1).ok, false);
  assert.equal(f.handle(f.a, 'claim', 2, 16).ok, false);
  f.handle(f.b, 'release', 2);
  assert.equal(f.seats.held('a', 15), true);
  f.handle(f.a, 'release', 3);
  assert.equal(f.handle(f.b, 'claim', 3).ok, true);
});
test('old claim and release messages cannot regain or remove a later seat', () => {
  const f = fixture(); f.handle(f.a, 'claim', 1); f.handle(f.a, 'release', 2); f.handle(f.a, 'claim', 3);
  assert.equal(f.handle(f.a, 'release', 2), null);
  assert.equal(f.handle(f.a, 'claim', 1), null);
  assert.equal(f.seats.held('a', 15), true);
});
test('invalid admission, death, casting, movement, stale pose, capture and fire revoke occupancy', () => {
  const changes = [f => { f.a.live = false; }, f => { f.a.worldAdmission = { ...f.admission, epoch: 2 }; },
    f => { f.a.fast.d = 1; }, f => { f.a.fast.cs = ['spell', .5]; }, f => { f.a.pos.x = 3; },
    f => { f.a.fast.p[1] = 20; }, f => { f.tick(5001); }, f => { f.halls[0].realm = 1; },
    f => { f.halls[0].ready = false; }, f => { f.room.clients.delete('a'); }, f => { f.halls.splice(0, 1); }];
  for (const change of changes) {
    const f = fixture(); f.handle(f.a, 'claim', 1); change(f);
    assert.equal(f.prune(), true); assert.equal(f.seats.held('a', 15), false);
  }
});
test('unseated pose gets a short entry grace, then releases; no recurring writes or timers', () => {
  const f = fixture(); f.a.fast.st = 0; f.handle(f.a, 'claim', 1);
  f.tick(2000); assert.equal(f.prune(), false);
  f.tick(1001); assert.equal(f.prune(), true);
  const snap = f.seats.snapshot(); for (let i = 0; i < 100; i++) f.prune();
  assert.deepEqual(f.seats.snapshot(), snap);
});
test('shared protocol fences old authority, broadcasts claim, hands off and cold-starts unoccupied without writes', () => {
  const f = fixture(), packets = [], state = {}; let host = f.a, writes = 0;
  const scene = createSharedScene({ ...f.api, admission: () => f.admission, hostFor: () => host,
    stateFor: () => state, changed: () => writes++, send: (c,m) => packets.push({ to: c.peer, m }) });
  scene.sync(f.room);
  const authority = () => packets.findLast(p => p.to === 'a' && p.m.kind === 'authority').m.authority;
  const send = (c,m) => scene.handle(c, { t: 'activity', authority: authority(), worldAdmission: f.admission, ...m });
  const data = JSON.stringify({ v: 1, full: true, rows: [], remove: [], meta: { thrones: f.halls } });
  assert.equal(send(f.a, { kind: 'entities', op: 'snapshot', seq: 1, part: 0, total: 1, data }), true);
  const before = writes, saved = structuredClone(state);
  assert.equal(send(f.b, { kind: 'thrones', op: 'claim', id: 15, seq: 1 }), true);
  assert.equal(writes, before); assert.deepEqual(state, saved);
  const old = authority(); host = f.b; scene.sync(f.room);
  assert.notEqual(authority(), old);
  assert.equal(packets.findLast(p => p.m.kind === 'authority').m.thrones.seats[0].peer, 'b');
  assert.equal(scene.handle(f.b, { t: 'activity', kind: 'thrones', op: 'release', id: 15, seq: 2,
    authority: old, worldAdmission: f.admission }), false);
  f.b.live = false; scene.sync(f.room);
  assert.equal(packets.findLast(p => p.m.kind === 'thrones').m.seats.length, 0);
  const fresh = createSharedScene({ ...f.api, admission: () => f.admission, hostFor: () => f.a,
    stateFor: () => state, send: (c,m) => packets.push({ to: c.peer, m }) });
  fresh.sync(f.room);
  assert.deepEqual(packets.findLast(p => p.m.kind === 'authority').m.thrones.seats, []);
});
