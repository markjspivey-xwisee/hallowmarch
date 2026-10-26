import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
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
    tick: ms => { clock += ms; }, connected: v => { connected = v; },
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
