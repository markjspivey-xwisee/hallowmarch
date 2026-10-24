import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('../../src/14t_netboats.js', import.meta.url), 'utf8');
const admission = { origin: 'world', epoch: 'season-2' };
function row(extra = {}) {
  return { id: 1, x: 0, z: 0, yaw: 0, vx: 0, vz: 0, wr: 0, st: 'free', ph: 0, eff: 0,
    grounded: 0, char: 0, rider: null, home: null, launch: null, still: false, ...extra };
}
function client(peer = 'self') {
  let now = 0;
  const sends = [], notices = [], requests = [], ghosts = new Map();
  const B = { ...row(), rider: null }, P = { id: 'local-player', alive: true, boat: null };
  const ctx = vm.createContext({ console, Map, Set, Infinity, Math, Number,
    performance: { now: () => now }, queueMicrotask() {}, window: {},
    BOATS: { list: [B], built: true, jetties: [] }, GAME: { player: P, t: 1 },
    NET: { self: peer, cfg: { delay: 120 } }, NETWS: { url: 'wss://march.example', state: 'on' },
    live: true, connected: true, ready: true,
    netOn: () => ctx.connected, netHumanLive: () => ctx.live, netSharedWorldReady: () => ctx.ready,
    netCurrentWorldAdmission: () => admission,
    netSameWorldAdmission: (a, b) => !!b && a.origin === b.origin && a.epoch === b.epoch,
    netWsSend: m => { sends.push(JSON.parse(JSON.stringify(m))); return true; },
    netWorldPartsRequest: (...args) => { requests.push(JSON.parse(JSON.stringify(args))); return true; },
    uiToast: m => notices.push(m), netGhost: peer => ghosts.get(peer),
    getEnt: id => id === P.id ? P : [...ghosts.values()].find(e => e.id === id),
    clamp: (x, a, b) => Math.max(a, Math.min(b, x)), lerp: (a, b, t) => a + (b - a) * t,
    angDiff: (a, b) => ((b - a + Math.PI * 3) % (Math.PI * 2)) - Math.PI,
    netR2: x => Math.round(x * 100) / 100, netR3: x => Math.round(x * 1000) / 1000,
    boatPose() {}, boatSeat(e, boat) { e.x = boat.x; e.z = boat.z; e.seat = { y: 1 }; },
    boatBoard(boat, e, approved) { assert.equal(approved, true); assert.equal(boat.rider, null); boat.rider = e.id; e.boat = boat; },
    boatLeave(e) { e.boat.rider = null; e.boat = null; },
  });
  vm.runInContext(source + '\nthis.api = { NET_BOATS, netBoatRead, netBoatMessage, netBoatBoard, netBoatCanSimulate, netBoatPump, netBoatStep, netBoatRemoteRider, netBoatReset, netBoatAction, netBoatLoad, netBoatRebuildRequest };', ctx);
  const auth = (host = 'host', boats = [row()], token = 'lease-a') => ctx.api.netBoatMessage({ t: 'activity', kind: 'authority', peer: host, authority: token, worldAdmission: admission, boats });
  const message = (boats, op = 'state', extra = {}) => ctx.api.netBoatMessage({ t: 'activity', kind: 'boats', authority: 'lease-a', worldAdmission: admission, op, boats, ...extra });
  return { ctx, api: ctx.api, B, P, sends, notices, requests, ghosts, auth, message, time: n => { now = n; } };
}

test('boarding waits for exclusive grant; refusal cannot seat a second character', () => {
  const a = client('phone'), b = client('desktop'); a.auth(); b.auth();
  assert.equal(a.api.netBoatBoard(a.B, a.P), true);
  assert.equal(b.api.netBoatBoard(b.B, b.P), true);
  assert.equal(a.P.boat, null); assert.equal(b.P.boat, null);
  a.message([row({ rider: 'phone' })], 'board', { id: 1, ok: true });
  b.message([row({ rider: 'phone' })], 'board', { id: 1, ok: false });
  assert.equal(a.P.boat, a.B); assert.equal(b.P.boat, null);
  assert.equal(a.api.netBoatCanSimulate(a.B), true);
  assert.equal(b.api.netBoatCanSimulate(b.B), false);
  assert.equal(b.notices.length, 1);
});

test('remote boat and rider follow the same interpolated pose without local physics', () => {
  const c = client(); c.auth();
  const ghost = { id: 'ghost-phone', netPeer: 'phone', boat: null };
  c.ghosts.set('phone', ghost);
  c.time(100); c.message([row({ x: 10, rider: 'phone', eff: 0.8, ph: 0.2 })]);
  c.time(300); c.message([row({ x: 20, rider: 'phone', eff: 0.9, ph: 0.5 })]);
  c.time(320); c.api.netBoatStep(c.B, 0.02);
  assert.equal(c.B.x, 15); assert.equal(ghost.x, c.B.x);
  assert.equal(ghost.boat, c.B); assert.equal(c.B.rider, ghost.id);
  assert.equal(ghost.rowPh, 0.5); assert.equal(c.api.netBoatCanSimulate(c.B), false);
});

test('late join and host handoff use accepted positions, not the starting berth', () => {
  const c = client();
  c.auth('host', [row({ x: 83, z: 12, vx: 1, home: { j: 0, b: 1 } })]);
  assert.equal(c.B.x, 83); assert.equal(c.B.z, 12);
  assert.equal(c.api.netBoatCanSimulate(c.B), false);
  c.auth('self', [row({ x: 84, z: 12, vx: 1 })], 'lease-b');
  assert.equal(c.B.x, 84); assert.equal(c.B.vx, 1);
  assert.equal(c.api.netBoatCanSimulate(c.B), true);
  c.message([row({ x: 0 })]); // old authority must not restore its stale berth
  assert.equal(c.B.x, 84);
});

test('revoked occupancy detaches the old local rider', () => {
  const c = client(); c.auth(); c.api.netBoatBoard(c.B, c.P);
  c.message([row({ rider: 'self' })], 'board', { id: 1, ok: true });
  assert.equal(c.P.boat, c.B);
  c.message([row({ x: 8, rider: null })], 'leave', { id: 1, ok: true });
  assert.equal(c.P.boat, null); assert.equal(c.B.x, 8);
  assert.equal(c.api.netBoatCanSimulate(c.B), false);
});

test('shared activity has no sends during idle, disconnection, or world initialization', () => {
  const c = client(); c.auth('self');
  c.ctx.live = false; c.api.netBoatPump(500);
  c.ctx.live = true; c.ctx.connected = false; c.api.netBoatPump(700);
  c.ctx.connected = true; c.ctx.ready = false; c.api.netBoatPump(900);
  assert.equal(c.sends.length, 0);
  c.ctx.ready = true; c.api.netBoatPump(1100);
  assert.equal(c.sends.length, 1); assert.equal(c.sends[0].op, 'snapshot');
  c.api.netBoatPump(1200); assert.equal(c.sends.length, 1);
  c.api.netBoatPump(1500); assert.equal(c.sends.length, 1); // unchanged snapshot
});

test('invalid rows and foreign world frames cannot corrupt the shared boat', () => {
  const c = client(); c.auth('host', [row({ x: 12 })]);
  assert.equal(c.api.netBoatRead(row({ x: NaN })), null);
  assert.equal(c.api.netBoatRead(row({ id: -1 })), null);
  c.api.netBoatMessage({ t: 'activity', kind: 'boats', authority: 'lease-a', worldAdmission: { ...admission, epoch: 'old' }, boats: [row({ x: 90 })] });
  assert.equal(c.B.x, 12);
  c.api.netBoatReset(); assert.equal(c.api.netBoatCanSimulate(c.B), false);
  c.ctx.NETWS.url = ''; assert.equal(c.api.netBoatCanSimulate(c.B), true);
});
test('ignite and rebuild wait for canonical replies on both host and followers', () => {
  for (const host of ['host', 'self']) {
    const c = client(); c.auth(host);
    assert.equal(c.api.netBoatAction(c.B, 'ignite', c.P), true);
    assert.equal(c.B.st, 'free'); assert.equal(c.sends.at(-1).op, 'ignite');
    c.message([row({ st: 'burning' })], 'ignite', { id: 1, ok: true });
    assert.equal(c.B.st, 'burning');
    c.message([row({ st: 'burnt', char: 1 })], 'snapshot');
    // Host snapshots normally echo its own simulation; use a canonical ignition
    // follow-up to represent the completed hull burn on either client.
    c.message([row({ st: 'burnt', char: 1 })], 'ignite', { id: 1, ok: true });
    assert.equal(c.api.netBoatAction(c.B, 'restore'), true);
    assert.equal(c.B.st, 'burnt');
    assert.deepEqual(c.requests.at(-1), ['boat.rebuild', { id: 1 }, [['plank', 6]], true]);
    assert.equal(c.sends.some(m => m.op === 'restore'), false, 'no unpaid legacy restore is dispatched');
    c.message([row({ st: 'free', char: 0 })], 'restore', { id: 1, ok: true });
    assert.equal(c.B.st, 'free'); assert.equal(c.B.char, 0);
  }
});

test('boat rebuild completion reserves costs through the private journal before spending locally', () => {
  const boats = fs.readFileSync(new URL('../../src/07e_boats.js', import.meta.url), 'utf8');
  const body = boats.slice(boats.indexOf('function boatRebuild(B)'), boats.indexOf('function boatRestore(B)'));
  const c = client(); c.auth('host', [row({ st: 'burnt' })]);
  let job, spent = 0, restored = 0;
  Object.assign(c.ctx, { goodsHave: () => true, uiError() {},
    survStartJob: value => { job = value; }, goodsTake: (id, n) => { spent += n; },
    boatRestore: () => { restored++; }, uiLog() {} });
  vm.runInContext(body + '\nthis.rebuild = boatRebuild;', c.ctx);
  c.ctx.rebuild(c.B); job.done();
  assert.equal(spent, 0, 'the reservation owns the cost until a durable server receipt');
  assert.equal(restored, 0); assert.equal(c.requests.length, 1);
  c.ctx.NETWS.url = ''; c.ctx.rebuild(c.B); job.done();
  assert.equal(spent, 6, 'standalone boats retain the original local cost');
  assert.equal(restored, 1);
});

test('a disconnected rebuild leaves materials alone and waits for shared admission', () => {
  const c = client(); c.auth('host', [row({ st: 'burnt' })]);
  c.ctx.connected = false;
  assert.equal(c.api.netBoatRebuildRequest(c.B), true);
  assert.equal(c.requests.length, 0); assert.equal(c.B.st, 'burnt');
});

test('late boat construction and private save reload cannot replace the accepted public pose', () => {
  const c = client(); c.ctx.BOATS.list = [];
  c.auth('self', [row({ x: 81, z: 22 })]);
  c.ctx.BOATS.list = [c.B]; c.api.netBoatPump(1000);
  assert.equal(c.B.x, 81); assert.equal(c.sends.at(-1).boats[0].x, 81);
  c.B.x = 0; c.B.z = 0;
  assert.equal(c.api.netBoatLoad(c.B), true);
  assert.equal(c.B.x, 81); assert.equal(c.B.z, 22);
});
