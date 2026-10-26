import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import { createHumanPlayGate } from '../../server/human-play.js';

// Execute actual client send/receive and server routing code with controlled
// browser/transport ports. No game frame, physics, token or native service bypass.
const repo = fileURLToPath(new URL('../../', import.meta.url)).replace(/\/$/, '');
const clientSource = ['14n_net.js', '14o_netui.js'].map(name => readFileSync(repo + '/src/' + name, 'utf8')).join('\n');
const serverSource = readFileSync(repo + '/server/server.js', 'utf8');
const roomHostSource = serverSource.slice(serverSource.indexOf('function roomNeedsWarbandOrders('), serverSource.indexOf('const send =', serverSource.indexOf('function roomHost(')));
const evForSource = serverSource.slice(serverSource.indexOf('function evFor('), serverSource.indexOf('/* ------------------------------------------------------------------ */', serverSource.indexOf('function evFor(')));
const onFastSource = serverSource.slice(serverSource.indexOf('function onFast('), serverSource.indexOf('/* ------------------------------------------------------------------ */', serverSource.indexOf('function onFast(')));
const plain = value => JSON.parse(JSON.stringify(value));

function client(name = 'owner', realm = 0) {
  let now = 10000, nextTimer = 0;
  const timers = new Map();
  const sends = [], received = [], logs = [], errors = [];
  const player = { name, faction: realm, x: 0, y: 30, z: 0, prevX: 0, prevZ: 0, yaw: 0, hp: 100, maxHp: 100, alive: true, buffs: [] };
  const context = vm.createContext({
    // This transport fixture represents an already live human; lease/idle behavior has dedicated integration tests.
    netHumanSync() {}, netHumanLive: () => true, NET_HUMAN_PLAY: { activity: 1 },
    setTimeout(fn, ms) { const id = ++nextTimer; timers.set(id, { fn, at: now + ms }); return id; },
    clearTimeout(id) { timers.delete(id); },
    performance: { now: () => now }, Date, Map, Set, Math, Number, Object, Array, JSON,
    GAME: { ready: false, started: true, player, t: 1.65 }, NETWS: { closed: false, reload: false, generation: 1, ws: {} },
    NETSTUB: {}, window: { __hm: {} }, addEventListener() {}, FIELD_NOTES: {}, GUIDE_HELP: [], LOADING_TIPS: [],
    netStubId: () => 'party123', IS_TOUCH: false, REALMS: [{ light: 'a' }, { light: 'b' }, { light: 'c' }],
    clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)), lerp: (a, b, t) => a + (b - a) * t,
    TAU: 2 * Math.PI, ABILITIES: {}, isStunned: () => false, inDungeon: () => false, animActValue: () => 0, getEnt: () => null,
    reportError: error => errors.push(error), uiError: error => errors.push(error), uiLog: line => logs.push(line), uiToast() {}, sfx() {},
    $: () => null,
  });
  vm.runInContext(clientSource + `
    // Exclude unrelated world/ghost work. The event queue, real fast-state object,
    // ring expiry, send eligibility, receiver parsing, dedup and social handlers stay actual source.
    netHostElect = () => {}; netGhosts = () => {}; netWorldKeep = () => {}; netDeathWatch = () => {};
    netSheetBadge = () => {};
    netSlowObj = () => ({ v: 1, on: 1, r: GAME.player.faction, pt: NET.party });
    netChatShow = (who, realm, ch, text) => globalThis.captureChat({who, realm, ch, text});
    globalThis.h = { NET, NETUI, NETWS, GAME, netEvent, netPump, netPeerUpdate, netPeerEvents, netInvite, netInviteAnswer, netChatSend, netChatIn, netPartyIn };
  `, context);
  context.captureChat = entry => received.push(plain(entry));
  const h = context.h;
  h.NET.state = 'on'; h.NET.self = name; h.NET.slowAt = Infinity;
  const writes = [];
  h.NET.link = { kind: 'ws', connected: () => true, setFast: o => { sends.push(plain(o)); writes.push({ type: 'fast', at: now, value: plain(o) }); return true; }, setSlow(o) { writes.push({ type: 'slow', at: now, value: plain(o) }); return true; } };
  return { h, sends, writes, timers, received, logs, errors, player, clock(value) { now = value; }, advance(ms) { now += ms; },
    peer(id, peerRealm = realm, party = '') { h.NET.peers.set(id, { peer: id, slow: { on: 1, r: peerRealm, dn: id, pt: party }, lastEv: -1, lastFS: -1, buf: [], off: Infinity, offT: 0, chatAt: 0 }); },
    pump() { h.netPump(0.05); }, runTimers() { let count = 0; for (;;) { const due = [...timers].find(([, timer]) => timer.at <= now); if (!due) return; if (++count > 100) throw Error('Timer loop'); timers.delete(due[0]); due[1].fn(); } }, now: () => now };
}
function server() {
  let now = 100000;
  const kept = [], packets = [];
  const humanPlay = createHumanPlayGate({ clock: () => now });
  const context = vm.createContext({
    Date: { now: () => now }, Map, Object, Array, JSON, Math, Number,
    isHumanPlaying: humanPlay.isPlaying,
    STATS: { badMsgs: 0, paceDropped: 0, chatKept: 0, hitsFar: 0, evDropped: 0, relayed: 0, evRelayed: 0, farRelayed: 0, thinned: 0 },
    CFG: { maxPace: 35, interest: 260, farEvery: 2500 }, WORLD: { ports: [] }, WORLDS: {},
    regionOf: () => 'a', regionsTell() {}, worldNow: () => null, KEEP_REGION: {},
    dist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z), legitJump: () => false,
    SEASON: { chatIn: (...args) => kept.push(args) }, cleanName: x => x,
    send: (who, message) => packets.push({ who: who.peer, message: plain(message) }),
  });
  vm.runInContext(roomHostSource + '\n' + evForSource + '\n' + onFastSource + '\nglobalThis.onFast = onFast;', context);
  const room = { clients: new Map() };
  const add = (peer, realm, party = '') => { const c = { peer, realm, party, since: now, slow: { on: 1, r: realm, pt: party, sharedScene: 1 }, region: 'a', room, acct: { id: 'account-' + peer, name: peer }, pos: { x: 0, z: 0 }, posT: now, evSeq: 0 }; room.clients.set(peer, c); humanPlay.update(c, { on: 1, humanLive: 1, humanActivity: 1 }); return c; };
  return { add, packets, kept, pause: c => humanPlay.forget(c), onFast: context.onFast, advance(ms) { now += ms; } };
}

for (const kind of ['inv', 'pa', 'say']) {
  for (const delay of [8999, 9000, 9001]) {
    test(`actual source ${kind}: first opportunity after ${delay}ms preserves never-sent event`, () => {
      const c = client();
      c.h.netEvent(kind, kind === 'say' ? 0 : 'other', kind === 'say' ? ['r', 'hello', ''] : kind === 'pa' ? 1 : 'party123');
      assert.equal(c.sends.length, 0, 'enqueuing social event does not send');
      assert.equal(c.h.NET.out.length, 1);
      c.advance(delay); c.pump();
      assert.equal(c.sends.length, 1, 'real fast state is sent');
      assert.equal(c.sends[0].ev.length, 1);
      assert.equal(c.h.NET.stats.evOut, 1, 'UI event counter still records attempted event');
      assert.equal(c.h.NET.stats.fastSent, 1);
      assert.equal(c.errors.length, 0);
    });
  }
}

test('actual invite remains queued until timer opportunity, including a 9001ms event-loop gap', () => {
  const c = client(); c.peer('other');
  assert.equal(c.h.netInvite('other'), true);
  assert.ok(c.logs.some(line => line.includes('You invite other')));
  assert.equal(c.sends.length, 0);
  c.advance(9001); c.pump();
  assert.equal(c.sends[0].ev[0][1], 'inv');
});

test('already received social event survives a 30s receiver render gap; actual receiver deduplicates repeated ring', () => {
  const c = client('recipient'); c.peer('sender');
  const packet = { s: 1, t: 10000, p: [0, 30, 0], y: 0, ev: [[1, 'say', 0, ['r', 'delayed inbox', '']]] };
  c.h.netPeerUpdate('sender', { fast: packet });
  assert.equal(c.h.NET.inbox.length, 0, 'social handler does not wait for a frame');
  assert.equal(c.received.length, 1);
  c.advance(30000); c.pump();
  assert.equal(c.received.length, 1);
  c.h.netPeerUpdate('sender', { fast: { ...packet, s: 2, t: 40000 } }); c.pump();
  assert.equal(c.received.length, 1);
});

test('actual server preserves invite target, realm/party chat scope and sequence dedup', () => {
  const s = server(), owner = s.add('owner', 0, 'party123');
  s.add('target', 0, 'party123'); s.add('sameRealm', 0, 'otherparty'); s.add('otherRealm', 1, 'otherparty');
  const base = { s: 1, t: 10000, p: [0, 30, 0], y: 0, ev: [[1, 'inv', 'target', 'party123'], [2, 'say', 0, ['r', 'realm', '']], [3, 'say', 0, ['p', 'party', 'party123']]] };
  s.onFast(owner, base);
  const eventsFor = who => s.packets.filter(p => p.who === who).flatMap(p => p.message.fast?.ev || p.message.ev || []);
  assert.deepEqual(eventsFor('target').map(e => e[0]), [1, 2, 3]);
  assert.deepEqual(eventsFor('sameRealm').map(e => e[0]), [2]);
  assert.deepEqual(eventsFor('otherRealm'), []);
  assert.equal(s.kept.length, 1, 'realm history stored once');
  s.advance(150); s.onFast(owner, { ...base, s: 2 });
  assert.deepEqual(eventsFor('target').map(e => e[0]), [1, 2, 3], 'repeated ring not a second delivery');
  assert.equal(s.kept.length, 1);
});

test('actual server rejects social and position traffic after the human lease ends', () => {
  const s = server(), owner = s.add('owner', 0, 'party123');
  s.add('target', 0, 'party123');
  s.pause(owner);
  s.onFast(owner, { s: 1, t: 10000, p: [0, 30, 0], y: 0,
    ev: [[1, 'say', 0, ['r', 'idle traffic', '']]] });
  assert.equal(s.packets.length, 0);
  assert.equal(s.kept.length, 0);
});

test('social timer sends without any render pump, with changed party profile before fast event', () => {
  const c = client(); c.peer('other');
  c.h.NET.fastAt = c.now();
  c.h.netInvite('other');
  c.advance(99); c.runTimers(); assert.equal(c.writes.length, 0);
  c.advance(1); c.runTimers();
  assert.deepEqual(c.writes.map(x => x.type), ['slow', 'fast']);
  assert.equal(c.writes[0].value.pt, 'party123');
  assert.equal(c.sends[0].ev[0][1], 'inv');
  assert.equal(c.h.GAME.t, 1.65, 'simulation time never advanced');
  assert.deepEqual([c.player.x, c.player.z], [0, 0], 'no physics override');
});

test('timer coalesces social actions to 10Hz even when a render pump wins the send race', () => {
  const c = client(); c.h.NET.fastAt = c.now();
  c.h.netEvent('inv', 'target', 'party123');
  c.advance(50); c.h.netEvent('pa', 'other', 1); c.runTimers();
  assert.equal(c.sends.length, 0);
  c.advance(50); c.pump(); c.runTimers();
  assert.equal(c.sends.length, 1); assert.equal(c.sends[0].ev.length, 2);
  c.h.netEvent('inv', 'third', 'party123'); c.advance(99); c.runTimers();
  assert.equal(c.sends.length, 1);
  c.advance(1); c.runTimers(); assert.equal(c.sends.length, 2);
  assert.deepEqual(c.writes.filter(x => x.type === 'fast').map(x => x.at), [10100, 10200]);
});

test('a timer delayed 30s sends never-attempted social once and sent ring expires at normal age', () => {
  const c = client(); c.h.netEvent('say', 0, ['r', 'late send', '']);
  c.advance(30000); c.runTimers(); assert.equal(c.sends.length, 1); assert.equal(c.sends[0].ev.length, 1);
  c.advance(9001); c.player.x = 1; c.pump();
  assert.equal(c.sends.length, 2); assert.deepEqual(c.sends[1].ev, []);
  assert.equal(c.h.NET.stats.evOut, 1, 'no new event sequence on delayed send');
});

for (const change of ['link', 'generation', 'socket', 'player']) {
  test(`pending social action is discarded when its ${change} changes before timer execution`, () => {
    const c = client(); c.h.netEvent('inv', 'target', 'party123');
    if (change === 'link') c.h.NET.link = { ...c.h.NET.link };
    if (change === 'generation') c.h.NETWS.generation++;
    if (change === 'socket') c.h.NETWS.ws = {};
    if (change === 'player') c.h.GAME.player = { ...c.player };
    c.runTimers(); assert.equal(c.sends.length, 0, 'stale timer cannot write');
    c.pump(); assert.deepEqual(c.sends[0].ev, [], 'frame path also excludes the old action');
  });
}

test('a changed connection can queue its own event before a stale timer runs without reviving old events', () => {
  const c = client(); c.h.netEvent('inv', 'old-target', 'party123');
  c.h.NETWS.generation++; c.h.NETWS.ws = {};
  c.h.netEvent('inv', 'new-target', 'party123'); c.runTimers();
  assert.deepEqual(c.sends[0].ev.map(e => e[2]), ['new-target']);
});

test('unknown transport send failure is attempted once, diagnosed, and never replayed across reconnect', () => {
  const c = client();
  c.h.NET.link.setFast = value => { c.sends.push(plain(value)); throw Error('unknown write result'); };
  c.h.netEvent('say', 0, ['r', 'one attempt', '']); c.runTimers();
  assert.equal(c.sends.length, 1); assert.equal(c.errors.length, 1);
  assert.equal(c.h.NET.out[0].sentAt, c.now());
  c.advance(200); c.runTimers(); assert.equal(c.sends.length, 1, 'no automatic timer resend');
  c.h.NETWS.generation++; c.h.NETWS.ws = {};
  c.h.NET.link.setFast = value => c.sends.push(plain(value));
  c.player.x = 1; c.pump();
  assert.deepEqual(c.sends[1].ev, [], 'unknown old event not transferred');
});

test('social queue stays bounded when a burst arrives while rendering is stalled', () => {
  const c = client();
  for (let index = 0; index < 100; index++) c.h.netEvent('inv', 'target-' + index, 'party123');
  assert.equal(c.h.NET.out.length, c.h.NET.cfg.ringMax);
  assert.equal(c.timers.size, 1); c.runTimers();
  assert.equal(c.sends.length, 1); assert.equal(c.sends[0].ev.length, 22);
  assert.ok(JSON.stringify(c.sends[0]).length <= 3700);
});

test('incoming social routing keeps target, realm, party and duplicate checks while combat remains frame queued', () => {
  const c = client('recipient'); c.peer('same'); c.peer('enemy', 1); c.peer('partyMate', 0, 'party123');
  c.h.NET.party = 'party123';
  const base = { s: 1, t: 10000, p: [0, 30, 0], y: 0 };
  c.h.netPeerUpdate('same', { fast: { ...base, ev: [[1, 'say', 'someone-else', ['r', 'wrong target', '']], [2, 'say', 0, ['p', 'wrong party', 'otherparty']], [3, 'hit', 'recipient', {}], [4, 'say', 0, ['r', 'realm allowed', '']]] } });
  c.h.netPeerUpdate('enemy', { fast: { ...base, ev: [[1, 'say', 0, ['r', 'wrong realm', '']], [2, 'inv', 'recipient', 'enemy123']] } });
  c.h.netPeerEvents('partyMate', [[1, 'say', 0, ['p', 'party allowed', 'party123']]]);
  c.h.netPeerEvents('partyMate', [[1, 'say', 0, ['p', 'duplicate', 'party123']]]);
  assert.deepEqual(c.received.map(entry => entry.text), ['realm allowed', 'party allowed']);
  assert.equal(c.h.NET.invites.length, 0);
  assert.equal(c.h.NET.inbox.length, 1); assert.equal(c.h.NET.inbox[0][1][1], 'hit');
  assert.equal(c.h.NET.stats.hitsIn, 0, 'combat was not processed from socket callback');
});

test('incoming social handlers wait until actual gameplay and current connected WS link exist', () => {
  const c = client('recipient'); c.peer('same');
  c.h.GAME.started = false;
  c.h.netPeerEvents('same', [[1, 'inv', 'recipient', 'party123']]);
  assert.equal(c.h.NET.invites.length, 0); assert.equal(c.h.NET.inbox.length, 1);
  c.h.GAME.started = true; c.pump(); assert.equal(c.h.NET.invites.length, 1);
  c.h.NET.link.connected = () => false;
  c.h.netPeerEvents('same', [[2, 'say', 0, ['r', 'disconnected', '']]]);
  assert.equal(c.received.length, 0); assert.equal(c.h.NET.inbox.length, 1);
});

test('room transport retains its existing frame path and does not start social timers', () => {
  const c = client('recipient'); c.peer('same'); c.h.NET.link.kind = 'room';
  c.h.netEvent('say', 0, ['r', 'room send', '']); assert.equal(c.timers.size, 0);
  c.h.netPeerEvents('same', [[1, 'say', 0, ['r', 'room receive', '']]]);
  assert.equal(c.received.length, 0); c.advance(30); c.pump();
  assert.equal(c.received.length, 1); assert.equal(c.sends[0].ev.length, 1);
});

test('actual party handshake and party chat route between two clients with no render pumps', () => {
  const s = server(), a = client('a'), b = client('b'); a.peer('b'); b.peer('a');
  const sa = s.add('a', 0), sb = s.add('b', 0);
  const clients = { a, b };
  for (const [c, serverPeer] of [[a, sa], [b, sb]]) {
    c.h.NET.link.setSlow = value => { serverPeer.party = value.pt || ''; serverPeer.realm = value.r; for (const other of [a, b]) if (other !== c) other.h.NET.peers.get(serverPeer.peer).slow.pt = serverPeer.party; };
    c.h.NET.link.setFast = value => {
      const before = s.packets.length; s.onFast(serverPeer, value);
      for (const packet of s.packets.slice(before)) clients[packet.who].h.netPeerUpdate(serverPeer.peer, { fast: packet.message.fast });
      return true;
    };
  }
  assert.equal(a.h.netInvite('b'), true); a.runTimers();
  assert.equal(b.h.NET.invites.length, 1);
  assert.equal(b.h.netInviteAnswer('a', true), true); b.runTimers();
  assert.equal(a.h.NET.party, b.h.NET.party); assert.equal(sa.party, sb.party);
  assert.ok(a.logs.some(line => line.includes('b joins your party.')));
  a.advance(1200); b.advance(1200); s.advance(1200);
  assert.equal(a.h.netChatSend('p', 'together'), true); a.runTimers();
  assert.equal(b.received.length, 1); assert.equal(b.received[0].text, 'together');
  assert.equal(a.h.GAME.t, 1.65); assert.equal(b.h.GAME.t, 1.65);
});

test('a stale callback cannot clear or duplicate its replacement timer', () => {
  const c = client(); c.h.NET.fastAt = c.now();
  c.h.netEvent('inv', 'old-target', 'party123'); const stale = [...c.timers.values()][0].fn;
  c.h.NETWS.generation++; c.h.NETWS.ws = {};
  c.h.netEvent('inv', 'new-target', 'party123'); const currentId = c.h.NET.socialTimer;
  stale(); assert.equal(c.h.NET.socialTimer, currentId); assert.equal(c.timers.size, 1);
  c.advance(100); c.runTimers();
  assert.equal(c.sends.length, 1); assert.deepEqual(c.sends[0].ev.map(e => e[2]), ['new-target']);
});

test('a render pump that wins the race also publishes changed party metadata before social', () => {
  const c = client(); c.peer('other'); c.h.NET.fastAt = c.now(); c.h.NET.slowAt = c.now();
  c.h.netInvite('other'); c.advance(100); c.pump(); c.runTimers();
  assert.deepEqual(c.writes.map(x => x.type), ['slow', 'fast']); assert.equal(c.writes[0].value.pt, 'party123');
  assert.equal(c.sends.length, 1);
});

test('a refused slow-profile socket write prevents social fast send and does not falsely cache profile success', () => {
  const c = client(); c.h.NET.link.setSlow = () => false;
  c.h.netEvent('inv', 'target', 'party123'); c.runTimers();
  assert.equal(c.sends.length, 0); assert.equal(c.h.NET.slowKey, ''); assert.equal(c.h.NET.out[0].sentAt, null);
  c.h.NET.link.setSlow = () => true;
  c.pump(); assert.equal(c.sends.length, 1, 'known refused profile write can precede first event attempt');
});

test('a throwing slow-profile write does not attempt fast send or silently reschedule an unknown write', () => {
  const c = client(); c.h.NET.link.setSlow = () => { throw Error('unknown profile write'); };
  c.h.netEvent('inv', 'target', 'party123'); c.runTimers();
  assert.equal(c.sends.length, 0); assert.equal(c.errors.length, 1); assert.equal(c.timers.size, 0);
});

test('the fixed 3700-byte state ceiling trims oversized rings before marking attempted entries', () => {
  const c = client();
  for (let index = 0; index < 22; index++) c.h.netEvent('inv', 'target', 'a'.repeat(500));
  c.runTimers(); assert.equal(c.sends.length, 1);
  assert.ok(JSON.stringify(c.sends[0]).length <= 3700); assert.ok(c.sends[0].ev.length < 22);
  assert.equal(c.h.NET.out.length, c.sends[0].ev.length);
  assert.ok([...c.h.NET.out].every(entry => entry.sentAt !== null));
});

test('actual chat send throttle stays at 1100ms despite frame-independent transport', () => {
  const c = client();
  assert.equal(c.h.netChatSend('r', 'first'), true); c.runTimers();
  c.advance(1099); assert.equal(c.h.netChatSend('r', 'too early'), false);
  c.advance(1); assert.equal(c.h.netChatSend('r', 'second'), true); c.runTimers();
  assert.equal(c.h.NET.stats.chatOut, 2); assert.equal(c.h.NET.stats.evOut, 2);
});

test('a queued old-party message is discarded before actual server can expose its text to a new party', () => {
  const c = client('sender'); c.h.NET.party = 'oldparty';
  const s = server(), sender = s.add('sender', 0, 'oldparty'); s.add('oldmate', 0, 'oldparty'); s.add('newmate', 0, 'newparty');
  c.h.NET.link.setSlow = value => { sender.party = value.pt || ''; sender.realm = value.r; return true; };
  c.h.NET.link.setFast = value => { c.sends.push(plain(value)); s.onFast(sender, value); return true; };
  assert.equal(c.h.netChatSend('p', 'old party private text'), true);
  c.advance(9001); c.h.NET.party = 'newparty'; c.runTimers(); c.pump();
  assert.ok(!JSON.stringify(s.packets).includes('old party private text'));
  assert.deepEqual(c.sends[0].ev, []);
});

for (const kind of ['inv', 'pa']) {
  test(`pending ${kind} is discarded after party context changes`, () => {
    const c = client(); c.h.NET.party = 'oldparty';
    c.h.netEvent(kind, 'target', kind === 'inv' ? 'oldparty' : 1);
    c.h.NET.party = 'newparty'; c.runTimers(); c.pump();
    assert.deepEqual(c.sends[0].ev, []);
  });
}

test('realm chat survives party changes but is discarded when the player changes realm', () => {
  const c = client(); c.h.NET.party = 'oldparty';
  assert.equal(c.h.netChatSend('r', 'realm message'), true); c.h.NET.party = 'newparty'; c.runTimers();
  assert.equal(c.sends[0].ev[0][3][1], 'realm message');
  c.advance(1200); assert.equal(c.h.netChatSend('r', 'old realm private text'), true);
  c.player.faction = 1; c.runTimers(); c.pump();
  assert.ok(!JSON.stringify(c.sends.at(-1)).includes('old realm private text'));
});

test('already-attempted party ring entries cannot be repeated in another party context', () => {
  const c = client(); c.h.NET.party = 'oldparty'; c.h.netChatSend('p', 'old party ring'); c.runTimers();
  c.advance(100); c.h.NET.party = 'newparty'; c.player.x = 1; c.pump();
  assert.deepEqual(c.sends[1].ev, []);
});
