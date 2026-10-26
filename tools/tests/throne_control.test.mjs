import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { createThrones } from '../../server/thrones.js';
const read = f => readFileSync(new URL('../../' + f, import.meta.url), 'utf8');
function extract(src, name) {
  const at = src.indexOf('function ' + name + '(');
  assert.ok(at >= 0, name); return src.slice(at, src.indexOf('\n}', at) + 2);
}
function fixture() {
  let clock = 1000, connected = true;
  const H = { num: 15, realm: 0, y: 5, yaw: 0, state: 'intact', intact: true,
    S: { name: '<Keep>' }, hallSpots: { seat: { x: 0, z: 0 }, table: { x: 8, z: 8 } },
    items: [{ type: 'highseat', x: 0, z: 0, yaw: 0 }] };
  const P = { alive: true, faction: 0, x: 0, z: 1, y: 5, hp: 50, maxHp: 100 };
  const packets = [], errors = [], ui = { modal: null };
  const admission = { origin: 'https://march.test', epoch: 1 };
  const scope = vm.createContext({ HALL: { list: [H], sit: null }, GAME: { player: P, prog: { rp: 0, level: 1 } },
    NET: { self: 'b' }, UI: ui, performance: { now: () => clock },
    netEntityLive: () => connected, netEntityShared: () => true, netWsSend: m => { packets.push(m); return true; },
    netCurrentWorldAdmission: () => admission, netSameWorldAdmission: (a,b) => !!a && !!b && a.origin === b.origin && a.epoch === b.epoch,
    houseW: (h,x,z) => ({ x, z }), hallHolder: h => h.realm, houseIntact: h => h.intact,
    dist2: (x,z,a,b) => (x-a)**2 + (z-b)**2, uiError: s => errors.push(s), uiToast() {}, uiLog() {},
    realmRank: rp => rp, hallCommandGrant: () => false,
    toggleMap: open => { ui.modal = open ? 'map' : null; } });
  const hall = read('src/04k_hall.js'), campaign = read('src/08g_campaign.js');
  vm.runInContext(['hallSit','hallSeatAvailable','hallLeave','hallThroneGrant','hallSitConfirmed'].map(n => extract(hall,n)).join('\n')
    + '\n' + read('src/14z_netthrones.js') + '\n'
    + ['cwCanCommand','cwCommandTable','cwCommandThrone'].map(n => extract(campaign,n)).join('\n')
    + '\nthis.state = NET_THRONES;', scope);
  const message = extra => scope.netThroneMessage({ t: 'activity', kind: 'thrones', authority: 'live', worldAdmission: admission, ...extra });
  message({ kind: 'authority', peer: 'a', thrones: { revision: 0, seats: [] } });
  return { scope, H, P, packets, errors, ui, admission, message,
    now: () => clock, tick: ms => { clock += ms; }, connected: v => { connected = v; },
    claim() { scope.hallSit(H); },
    grant() { const seq = scope.state.pending.seq; message({ revision: 1, seats: [{ id: 15, peer: 'b' }], ok: true, request: seq, id: 15 }); } };
}
test('seat and low-rank command map open only after matching shared confirmation', () => {
  const f = fixture(); f.claim();
  assert.equal(f.scope.HALL.sit, null); assert.equal(f.scope.cwCanCommand(), false); assert.equal(f.ui.modal, null);
  f.message({ revision: 1, seats: [{ id: 15, peer: 'b' }] });
  assert.equal(f.ui.modal, null, 'broadcast is not the request acknowledgement');
  f.grant();
  assert.equal(f.P.seat.y, 5.53); assert.equal(f.ui.modal, 'map'); assert.equal(f.scope.cwCanCommand(), true);
  f.scope.hallLeave();
  assert.equal(f.P.seat, null); assert.equal(f.scope.cwCanCommand(), false); assert.equal(f.ui.modal, null);
  assert.equal(f.packets.at(-1).op, 'release');
});
test('lost authority, disconnect, capture and burning end throne grants', () => {
  for (const change of [f => { f.connected(false); }, f => { f.H.realm = 1; }, f => { f.H.state = 'burning'; },
    f => { f.P.alive = false; }, f => { f.P.casting = {}; }, f => { f.P.x = 3; }]) {
    const f = fixture(); f.claim(); f.grant(); change(f);
    assert.equal(f.scope.hallThroneGrant(), false);
  }
  const f = fixture(); f.claim(); f.grant();
  f.message({ revision: 2, seats: [] });
  assert.equal(f.scope.HALL.sit, null); assert.equal(f.ui.modal, null);
  f.message({ revision: 1, seats: [{ id: 15, peer: 'b' }] });
  assert.equal(f.scope.hallThroneGrant(), false, 'older frames cannot resurrect a grant');
});
test('timeout, refusal and old world frames cannot create an optimistic or late seat', () => {
  const f = fixture(); f.claim(); const seq = f.scope.state.pending.seq;
  f.tick(8001); f.scope.netThroneUpdate();
  assert.equal(f.scope.state.pending, null); assert.equal(f.packets.at(-1).op, 'release');
  f.message({ revision: 1, seats: [{ id: 15, peer: 'b' }], request: seq, id: 15, ok: true });
  assert.equal(f.scope.HALL.sit, null);
  f.message({ kind: 'authority', authority: 'retired', worldAdmission: { ...f.admission, epoch: 0 }, thrones: { revision: 8, seats: [] } });
  assert.equal(f.scope.state.authority, 'live');
  const g = fixture(); g.claim();
  g.message({ revision: 0, seats: [], request: g.scope.state.pending.seq, id: 15, ok: false, reason: 'Occupied' });
  assert.equal(g.errors.at(-1), 'Occupied'); assert.equal(g.ui.modal, null);
});
test('keeper handoff preserves confirmed occupancy but cancels an interrupted pending claim safely', () => {
  const f = fixture(); f.claim(); f.grant();
  f.message({ kind: 'authority', authority: 'next', peer: 'b', thrones: { revision: 1, seats: [{ id: 15, peer: 'b' }] } });
  assert.equal(f.scope.hallThroneGrant(), true);
  const g = fixture(); g.claim();
  g.message({ kind: 'authority', authority: 'next', peer: 'b', thrones: { revision: 1, seats: [{ id: 15, peer: 'b' }] } });
  assert.equal(g.scope.HALL.sit, null); assert.equal(g.packets.at(-1).op, 'release');
});
test('remote low-rank caller requires server-stamped throne plus canonical owner, proximity and intact hall', () => {
  const f = fixture();
  Object.assign(f.P, { netCommand: true, commandRank: 0, level: 1, commandTable: -1 });
  assert.equal(f.scope.cwCanCommand(), false);
  f.P.commandThrone = 15; assert.equal(f.scope.cwCanCommand(), true);
  f.H.state = 'burning'; assert.equal(f.scope.cwCanCommand(), false);
  f.H.state = 'intact'; f.P.x = 4; assert.equal(f.scope.cwCanCommand(), false);
});
test('an authority without throne support cannot retain an earlier grant', () => {
  const f = fixture(); f.claim(); f.grant();
  f.message({ kind: 'authority', authority: 'legacy', peer: 'a' });
  assert.equal(f.scope.hallThroneGrant(), false);
  assert.equal(f.scope.cwCanCommand(), false);
});

test('a full-health stationary throne retains its server lease with bounded poses and stops refreshing on idle or disconnect', () => {
  const f = fixture(), sent = [];
  let humanLive = true;
  f.P.hp = f.P.maxHp;
  Object.assign(f.P, { yaw: 0, buffs: [], target: null });
  f.claim(); f.grant();
  const client = { peer: 'b', worldAdmission: f.admission, slow: { r: 0 } };
  const halls = [{ id: f.H.num, realm: 0, x: 0, y: 5, z: 0, ready: true }];
  const room = { clients: new Map([[client.peer, client]]) };
  const seats = createThrones({ now: f.now,
    live: () => humanLive && f.scope.netEntityLive(),
    sameAdmission: f.scope.netSameWorldAdmission });
  Object.assign(f.scope.NET, {
    cfg: { fastHz: 20, ringMax: 64 }, fastAt: -Infinity, fastKey: '',
    vel: { t: f.now(), px: f.P.x, pz: f.P.z, x: 0, z: 0 },
    out: [], evSeq: 0, seq: 0, lastFast: null,
    stats: { fastSent: 0, upBytes: 0, sizeTrim: 0 },
    link: { setFast(o) {
      sent.push({ at: f.now(), pose: o });
      client.fast = o; client.pos = { x: o.p[0], z: o.p[2] }; client.posT = f.now();
    } },
  });
  Object.assign(f.scope, {
    netHumanLive: () => humanLive, netOn: () => f.scope.netEntityLive(),
    TAU: Math.PI * 2, netR2: n => Math.round(n * 100) / 100,
    netR3: n => Math.round(n * 1000) / 1000,
    lerp: (a, b, k) => a + (b - a) * k,
    clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
    isStunned: () => false, inDungeon: () => false,
    animActValue: () => 0, getEnt: () => null,
  });
  f.scope.GAME.started = true;
  const net = read('src/14n_net.js');
  vm.runInContext(['netFastObj', 'netSendFast', 'netActivityPosition'].map(n => extract(net, n)).join('\n'), f.scope);
  f.scope.netSendFast(f.now());
  assert.equal(seats.handle(client, { op: 'claim', id: f.H.num, seq: 1 }, halls, f.admission).ok, true);
  // Run ordinary frame updates without moving, healing, changing animation or issuing orders.
  // Server snapshots prune leases independently of user commands and require a pose <= 5 s old.
  for (let elapsed = 50; elapsed <= 12000; elapsed += 50) {
    f.tick(50); f.scope.netThroneUpdate(); f.scope.netSendFast(f.now());
    seats.prune(room, halls, f.admission);
    assert.equal(seats.held(client.peer, f.H.num), true, `stationary seat expired after ${elapsed} ms`);
  }
  assert.equal(sent.length, 13, 'only the initial pose and existing once-a-second position refresh are sent');
  for (let i = 1; i < sent.length; i++) assert.ok(sent[i].at - sent[i - 1].at >= 1000);
  assert.ok(sent.every(row => row.pose.h === 1 && row.pose.st === 5.53));
  const activeSent = sent.length;
  humanLive = false;
  for (let elapsed = 0; elapsed < 10000; elapsed += 50) { f.tick(50); f.scope.netThroneUpdate(); }
  assert.equal(sent.length, activeSent, 'an idle human cannot send throne heartbeats');
  seats.prune(room, halls, f.admission);
  assert.equal(seats.held(client.peer, f.H.num), false);
  humanLive = true; f.connected(false);
  for (let elapsed = 0; elapsed < 10000; elapsed += 50) { f.tick(50); f.scope.netThroneUpdate(); }
  assert.equal(sent.length, activeSent, 'a disconnected human cannot send throne heartbeats');
  f.scope.hallLeave(false); f.connected(true);
  for (let elapsed = 0; elapsed < 2000; elapsed += 50) { f.tick(50); f.scope.netThroneUpdate(); }
  assert.equal(sent.length, activeSent, 'leaving the throne ends its position refresh');
});

