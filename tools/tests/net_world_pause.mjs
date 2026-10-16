#!/usr/bin/env node
// Execute the actual WebSocket and season UI modules; only browser/game ports
// are local fixtures. The state machine, message dispatch and HUD are unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const source = ['14p_netws.js', '14q_netseason.js'].map(name => readFileSync(new URL('src/' + name, root), 'utf8')).join('\n');
const running = { scope: 'world-and-season', mode: 'native', enabled: true, state: 'confirmed', fenced: false, confirmedVersion: 1 };
const paused = { ...running, state: 'conflict', fenced: true };
async function flush() { for (let i = 0; i < 10; i++) await Promise.resolve(); }
function fixture(bootstrap) {
  const sockets = [], toasts = [], logs = [], saveReplies = [], appliedWorlds = [];
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); }
    send() {}
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 1012, reason: 'identity refreshed' }); }
  }
  const context = vm.createContext({
    URL, URLSearchParams, Map, Set, Object, Array, JSON, Math, Number,
    performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, queueMicrotask,
    WebSocket: Socket, localStorage: { getItem: () => 'existing-game-token', setItem() {} },
    location: { search: '', reload() { assert.fail('No page reload'); } },
    window: { __hm: {}, __HM_GAMING: bootstrap ? { worldAuthority: bootstrap } : {} },
    GAME: { ready: false, started: true, player: null }, FIELD_NOTES: {}, GUIDE_HELP: [], LOADING_TIPS: [],
    NET: { peers: new Map(), stats: {}, link: null, state: 'on' }, NETUI: { open: false },
    $: () => ({ addEventListener() {} }),
    uiToast: message => toasts.push(message), uiLog: message => logs.push(message), netNote() {},
    netStr: (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '',
    esc: value => String(value).replace(/[&<>]/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[char])),
    netWorldRead: value => value, netWorldTake: value => appliedWorlds.push(value), netPeerLeft() {},
    withTimeout: promise => promise,
  });
  vm.runInContext(source + '\nglobalThis.H={NETWS,NETS,netWsOpen,netWsRetire,netSeasonHudHTML};', context);
  const H = context.H; H.NETWS.url = 'wss://march.test/ws'; H.NETWS.host = 'march.test';
  async function connect(status = running) {
    const opening = H.netWsOpen(); await flush(); const socket = sockets.at(-1); socket.open();
    socket.message({ t: 'welcome', peer: 'p', acct: { id: 'owner' }, world: { k: [] }, ...(status ? { worldAuthority: status } : {}) });
    assert.equal(await opening, true); return socket;
  }
  return { H, sockets, toasts, logs, saveReplies, appliedWorlds, connect, context };
}

test('world pause packets persist in network state and HUD, notify once and leave character save replies independent', async () => {
  const f = fixture(), socket = await f.connect();
  f.H.NETWS.waits.push(message => f.saveReplies.push(message));
  for (let count = 0; count < 100; count++) socket.message({ t: 'world-status', ok: false, persistence: { ...paused, liveVersion: count + 1 } });
  assert.match(f.H.NETWS.worldPauseReason, /World and season changes paused until recovery/);
  assert.match(f.H.netSeasonHudHTML(), /role="status"/); assert.match(f.H.netSeasonHudHTML(), /paused until recovery/);
  assert.equal(f.toasts.length, 1); assert.equal(f.logs.length, 1); assert.doesNotMatch(f.toasts[0], /save|character/i);
  assert.equal(f.H.NETWS.state, 'on'); assert.equal(f.H.NETWS.waits.length, 1);
  socket.message({ t: 'saved', ok: true }); assert.equal(f.saveReplies[0].ok, true);
  assert.match(f.H.NETWS.worldPauseReason, /paused/);
});

test('a paused contribution settles its own action while also retaining one shared world status', async () => {
  const f = fixture(), socket = await f.connect(); let reply;
  f.H.NETS.waits.set(7, value => { reply = value; });
  socket.message({ t: 'contrib', q: 7, ok: false, why: 'World paused', persistence: paused });
  socket.message({ t: 'order', q: 8, ok: false, persistence: paused });
  assert.equal(reply.ok, false); assert.equal(f.H.NETS.waits.size, 0);
  assert.equal(f.toasts.length, 1); assert.match(f.H.NETWS.worldPauseReason, /paused/);
});

test('socket and identity reconnect attempts, ordinary world packets, pongs and malformed status cannot clear a pause', async () => {
  const f = fixture(), old = await f.connect(); old.message({ t: 'world-status', persistence: paused });
  old.message({ t: 'pong', c: 10 }); old.message({ t: 'world', w: { k: [0] } });
  for (const persistence of [{}, { ...running, confirmedVersion: 0 }, { ...running, confirmedVersion: '2' },
    { ...running, fenced: undefined }, { ...running, scope: 'character' }]) old.message({ t: 'world-status', persistence });
  assert.match(f.H.NETWS.worldPauseReason, /paused/);
  f.H.netWsRetire(old, 'identity refreshed'); assert.match(f.H.NETWS.worldPauseReason, /paused/);
  const socket = await f.connect(null); assert.equal(f.H.NETWS.state, 'on'); assert.match(f.H.NETWS.worldPauseReason, /paused/);
  old.message({ t: 'world-status', persistence: { ...running, confirmedVersion: 9 } });
  assert.match(f.H.NETWS.worldPauseReason, /paused/, 'retired socket cannot supply a late recovery');
  socket.message({ t: 'world-status', persistence: { ...running, state: 'pending', confirmedVersion: 2 } });
  assert.equal(f.H.NETWS.worldPauseReason, ''); assert.equal(f.toasts.length, 2);
  assert.match(f.toasts[1], /resumed/);
});

test('fresh confirmed reconnect clears the pause once and a later new pause notifies once again', async () => {
  const f = fixture(), first = await f.connect(); first.message({ t: 'world-status', persistence: paused }); first.close();
  const socket = await f.connect({ ...running, confirmedVersion: 2 });
  assert.equal(f.H.NETWS.worldPauseReason, ''); assert.equal(f.toasts.length, 2);
  socket.message({ t: 'world-status', persistence: { ...running, confirmedVersion: 3 } }); assert.equal(f.toasts.length, 2);
  socket.message({ t: 'world-status', persistence: paused }); assert.equal(f.toasts.length, 3);
});

test('fresh server bootstrap retains a known pause without enabling field-note popups', () => {
  const f = fixture(paused);
  assert.match(f.H.NETWS.worldPauseReason, /paused/); assert.equal(f.toasts.length, 1);
  assert.equal(Object.keys(f.context.FIELD_NOTES).length, 1, 'only the existing season job aid was registered');
});
