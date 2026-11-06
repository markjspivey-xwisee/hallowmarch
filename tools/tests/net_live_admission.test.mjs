// Actual socket dispatch and Players status text; all identities and packets are synthetic.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const root = new URL('../../', import.meta.url);
const transport = readFileSync(new URL('src/14p_netws.js', root), 'utf8');
const players = readFileSync(new URL('src/14o_netui.js', root), 'utf8');
const statusHelper = players.includes('function netSheetConnectionStatus()')
  ? players.slice(players.indexOf('function netSheetConnectionStatus()'), players.indexOf('function netSheetRender()')) : '';
const persistence = { scope: 'world-and-season', mode: 'native', enabled: true,
  state: 'confirmed', fenced: false, confirmedVersion: 1170 };
const messages = {
  live: { t: 'world-status', ok: true, admission: 'live', code: 'human_play_admitted', why: 'Live shared-world play is confirmed.' },
  standby: { t: 'world-status', ok: true, admission: 'standby', code: 'human_play_required', why: 'Shared-world play is paused. Return to the game and interact to resume.' },
  identity: { t: 'world-status', ok: false, admission: 'identity-required', code: 'native_signin_required', why: 'Reconnect your identity to join the shared world. Your private character is preserved.' },
};
async function flush() { for (let n = 0; n < 10; n++) await Promise.resolve(); }
function fixture() {
  const sockets = [], sent = [], notices = [], ui = [];
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); }
    send(value) { sent.push(JSON.parse(value)); }
    open() { this.readyState = 1; this.onopen?.(); }
    message(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
    close() { this.readyState = 3; this.onclose?.({ code: 4000, reason: 'Human play not started' }); }
  }
  const context = vm.createContext({
    URL, URLSearchParams, Map, Set, Object, Array, JSON, Math, Number,
    performance: { now: () => 100 }, setTimeout: () => 1, clearTimeout() {}, setInterval: () => 1, clearInterval() {}, queueMicrotask,
    WebSocket: Socket, localStorage: { getItem: () => 'synthetic-existing-session', setItem() {} },
    location: { search: '', reload() { assert.fail('No automatic reload'); } },
    window: { __hm: {}, __HM_NET_SERVER: 'wss://march.test/ws' },
    GAME: { ready: false, started: true, player: {} }, NETUI: { open: false },
    netHumanLive: () => true, netHumanSync() {},
    NET: { state: 'on', peers: new Map(), stats: {}, link: null },
    $: () => ({ addEventListener() {} }),
    netStr: (value, limit) => typeof value === 'string' ? value.replace(/[\u0000-\u001f]/g, '').trim().slice(0, limit) : '',
    netNote() {}, uiToast: message => notices.push(message), uiLog: message => notices.push(message),
    netSheetRender: () => ui.push('render'), netSheetBadge: () => ui.push('badge'),
    netWorldRead: value => value, netWorldTake() {}, netPeerLeft() {}, withTimeout: promise => promise,
    nativePlayerConnect() { assert.fail('Admission never reauthenticates automatically'); },
    fetch() { assert.fail('No external request'); },
  });
  vm.runInContext(transport + '\n' + statusHelper + `
    globalThis.H={NETWS,netWsOpen,netWsRetire,
      admission:()=>typeof netWsAdmissionStatus==='function'?netWsAdmissionStatus():null,
      text:()=>typeof netSheetConnectionStatus==='function'?netSheetConnectionStatus():''};
    globalThis.netOn=()=>NET.state==='on'&&!!NET.link&&NET.link.connected();`, context);
  const H = context.H; H.NETWS.url = 'wss://march.test/ws'; H.NETWS.host = 'march.test';
  async function connect(account = 'synthetic-owner') {
    const opening = H.netWsOpen(); await flush(); const socket = sockets.at(-1); socket.open();
    socket.message({ t: 'welcome', peer: 'p', acct: { id: account }, worldAuthority: persistence });
    assert.equal(await opening, true);
    context.NET.link = { kind: 'ws', connected: () => H.NETWS.state === 'on' };
    return socket;
  }
  return { H, context, sockets, sent, notices, ui, connect };
}

test('identity admission refusal is retained separately from a connected socket and confirmed world persistence', async () => {
  const f = fixture(), socket = await f.connect(), sends = f.sent.length;
  socket.message(messages.identity);
  assert.equal(f.H.admission()?.state, 'identity-required');
  assert.match(f.H.text(), /Reconnect your identity/);
  assert.equal(f.H.NETWS.state, 'on');
  assert.equal(f.H.NETWS.worldPersistence.state, 'confirmed');
  assert.equal(f.H.NETWS.worldPauseReason, '');
  assert.equal(f.sent.length, sends, 'status does not send, register, renew or save');
});

test('live, normal menu standby and resumed live statuses replace each other only on acknowledgement', async () => {
  const f = fixture(), socket = await f.connect();
  assert.equal(f.H.admission(), null);
  assert.match(f.H.text(), /Waiting.*confirm/i);
  socket.message(messages.live); assert.equal(f.H.admission().state, 'live');
  assert.match(f.H.text(), /Connected to the shared world on march\.test/);
  socket.message(messages.standby); assert.equal(f.H.admission().state, 'standby');
  assert.match(f.H.text(), /paused.*Return to the game/i);
  socket.message({ t: 'pong', c: 10 });
  socket.message({ t: 'world-status', persistence });
  assert.equal(f.H.admission().state, 'standby', 'transport and checkpoint messages never admit play');
  socket.message(messages.live); assert.equal(f.H.admission().state, 'live');
});

test('cold close and same-owner retries retain a labelled negative attempt, but invalidate positive proof', async () => {
  const f = fixture(), first = await f.connect(); first.message(messages.identity); first.close();
  assert.equal(f.H.admission().state, 'identity-required');
  assert.equal(f.H.admission().current, false); assert.match(f.H.text(), /Last.*attempt/i);
  const socket = await f.connect();
  assert.match(f.H.text(), /Last.*attempt/i);
  socket.message(messages.live); assert.equal(f.H.admission().current, true);
  f.H.netWsRetire(socket, 'synthetic transport failure'); assert.equal(f.H.admission(), null);
  const next = await f.connect(); assert.equal(f.H.admission(), null);
  assert.match(f.H.text(), /Waiting.*confirm/i);
  next.message(messages.live); assert.equal(f.H.admission().state, 'live');
});

test('retired packets and host or owner changes cannot carry admission across connection scopes', async () => {
  const f = fixture(), old = await f.connect(); old.message(messages.identity);
  f.H.netWsRetire(old, 'synthetic retry'); const current = await f.connect();
  old.message(messages.live); assert.equal(f.H.admission().state, 'identity-required');
  current.message(messages.live); assert.equal(f.H.admission().state, 'live');
  f.H.NETWS.host = 'other.test'; assert.equal(f.H.admission(), null);
  f.H.NETWS.host = 'march.test'; f.H.NETWS.acct = { id: 'another-owner' };
  assert.equal(f.H.admission(), null);
  f.H.netWsRetire(current, 'synthetic owner switch'); await f.connect('another-owner');
  assert.equal(f.H.admission(), null);
});

test('malformed status cannot forge live proof or clear identity recovery and text remains bounded', async () => {
  const f = fixture(), socket = await f.connect(); socket.message(messages.identity);
  for (const packet of [ { admission: 'live' }, { ...messages.live, ok: false },
    { ...messages.live, code: 'native_signin_required' }, { ...messages.live, standby: true },
    { admission: 'invented', code: 'human_play_admitted', ok: true } ]) {
    socket.message({ t: 'world-status', ...packet });
    assert.equal(f.H.admission().state, 'identity-required');
  }
  socket.message({ ...messages.identity, why: 'x'.repeat(1000) });
  assert.equal(f.H.admission().why.length, 180);
});

test('a fallback host room cannot claim admission to the configured shared-world server', async () => {
  const f = fixture(); await f.connect();
  f.H.NETWS.state = 'off'; f.context.NET.link = { kind: 'room', connected: () => true };
  assert.match(f.H.text(), /separate multiplayer room/i);
  assert.match(f.H.text(), /shared world.*not connected/i);
});

test('cold expired game-session denial remains visible without acquiring a new identity or claiming connection', async () => {
  const f=fixture(), opening=f.H.netWsOpen();await flush();const socket=f.sockets.at(-1);socket.open();
  socket.message({t:'denied',code:'native_signin_required',why:'Your sign-in expired. Reconnect your account to continue.'});
  assert.equal(await opening,false);assert.equal(f.H.NETWS.state,'off');
  assert.equal(f.H.admission().state,'identity-required');assert.equal(f.H.admission().current,false);
  assert.match(f.H.text(),/Last shared-world attempt on march\.test: Your sign-in expired/);
  assert.equal(f.sent.length,1);assert.equal(f.sent[0].t,'hello');
});

test('live admission never clears an independent persistence fence or says world changes are running',async()=>{
  const f=fixture(),socket=await f.connect();
  socket.message({t:'world-status',persistence:{...persistence,state:'conflict',fenced:true}});
  socket.message(messages.live);
  assert.equal(f.H.admission().state,'live');assert.match(f.H.NETWS.worldPauseReason,/paused until recovery/);
  assert.equal(f.H.NETWS.worldPersistence.state,'conflict');
  assert.match(f.H.text(),/Connected to the shared world/);assert.doesNotMatch(f.H.text(),/Playing|running|resumed/);
});

test('invalid configured URL cannot throw in repeated Players status reads',()=>{
  const f=fixture();f.context.netServerUrl=()=> 'not a valid URL';
  for(let i=0;i<10;i++)assert.match(f.H.text(),/connection settings could not be confirmed/);
});

test('a changed configured target cannot borrow a live acknowledgement from the previous host',async()=>{
  const f=fixture(),socket=await f.connect();socket.message(messages.live);
  f.context.netServerUrl=()=> 'wss://different.test/ws';
  assert.match(f.H.text(),/Not connected to the shared world on different\.test/);
  assert.doesNotMatch(f.H.text(),/^Connected to/);
});
