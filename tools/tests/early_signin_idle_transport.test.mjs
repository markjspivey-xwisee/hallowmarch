/** Actual loading identity + transport lifecycle; synthetic ports, no owner browser/network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';

const root = new URL('../../', import.meta.url);
// An explicit source directory permits the same regression to run against a
// preserved pre-fix source pair; normal CI always reads the shipping files.
const source = (name, before) => readFileSync(process.env.HM_EARLY_IDLE_SOURCE_DIR
  ? join(process.env.HM_EARLY_IDLE_SOURCE_DIR, before) : new URL('src/' + name, root), 'utf8');
const transport = source('14p_netws.js', 'early-signin-idle-before-14p.js');
const identity = source('14v_nativeidentity.js', 'early-signin-idle-before-14v.js');
const save = readFileSync(new URL('src/12_save.js', root), 'utf8').split('function graphicsSaveSettings()')[0];
const ui = readFileSync(new URL('src/10_ui.js', root), 'utf8');
const guardNode = parse(ui, { ecmaVersion: 'latest' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'titleEntryBlocked');
const guard = ui.slice(guardNode.start, guardNode.end);
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
const flush = async () => { for (let n = 0; n < 20; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
async function until(predicate) { for (let n = 0; n < 40 && !predicate(); n++) await flush(); assert(predicate(), 'Actual source must reach the controlled protocol boundary.'); }
const OWNER = 'did:example:synthetic-owner', POD = 'https://pod.example/synthetic-owner/';
const canonical = () => ({ enabled: true, bound: true, verified: true, account: { id: 'canonical-account' },
  binding: { userId: 'synthetic-owner', subjectDid: OWNER, podUrl: POD }, recordLinks: {} });

function fixture(options = {}) {
  let now = 0, nextTimer = 0;
  const wall = Date.now(), timers = new Map(), sockets = [], channels = [], store = new Map(), statusGate = deferred(), readGate = deferred();
  const counts = { requests: [], packets: [], intervals: 0, reload: 0, popup: 0, starts: 0, entries: 0, writes: 0, keys: 0,
    reads: 0, statuses: 0, titles: 0, worldApplies: 0 };
  store.set('hallowmarch.token.game.example', 'old-game-token');
  const nodes = Object.fromEntries(['loading-identity', 'loading-sign-in', 'loading-identity-status'].map(id => [id,
    { hidden: false, disabled: false, textContent: '', onclick: null }]));
  class FixtureDate extends Date { static now() { return wall + now; } }
  const schedule = (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; };
  let context;
  class Socket {
    constructor() { this.readyState = 0; this.sent = []; sockets.push(this); queueMicrotask(() => this.open()); }
    open() { if (this.readyState !== 0) return; this.readyState = 1; this.onopen?.(); }
    send(raw) {
      const packet = JSON.parse(raw); this.sent.push(packet); counts.packets.push(packet);
      if (packet.t === 'hello') {
        const account = packet.token === 'new-game-token' ? 'canonical-account' : 'transport-account';
        queueMicrotask(() => this.message({ t: 'welcome', peer: 'synthetic-peer', acct: { id: account }, token: packet.token }));
        // The synthetic server follows the production's never-played admission
        // deadline. Only its close event enters the actual transport under test.
        schedule(() => { if (this.readyState === 1) this.close(4000, 'Human play not started'); }, 15000);
      }
    }
    message(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason }); }
  }
  const document = { getElementById: id => nodes[id] || null, querySelectorAll: () => [], querySelector: () => null };
  const profile = { status: () => ({ pending: false, keyPresent: true, hasRecord: false }), close() {}, connect: async () => {},
    async get() { counts.reads++; await readGate.promise; return { exists: false }; },
    set() { counts.writes++; throw Error('No private write during sign-in.'); },
    createKey() { counts.keys++; throw Error('No key creation during sign-in.'); },
    delete() { counts.writes++; throw Error('No private deletion during sign-in.'); } };
  const session = { status: () => ({ provisional: false, pending: false }), peek: async () => null, close() {},
    resume() { throw Error('An empty synthetic session cannot resume a character.'); }, claimProfile: () => null };
  context = vm.createContext({ console, URL, URLSearchParams, structuredClone, crypto: webcrypto, Date: FixtureDate,
    performance: { now: () => now }, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    setInterval() { counts.intervals++; return 1; }, clearInterval() {}, queueMicrotask, WebSocket: Socket,
    AbortSignal: { timeout: () => new AbortController().signal }, document, $: id => document.getElementById(id),
    location: { origin: 'https://game.example', search: '', reload() { counts.reload++; } },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value), removeItem: key => store.delete(key) },
    BroadcastChannel: class { constructor(name) { this.name = name; channels.push(this); } close() { this.closed = true; } },
    window: { __hm: {}, __HM_NET_SERVER: 'wss://game.example/ws', open() { counts.popup++; const popupStore = new Map();
      return { sessionStorage: { getItem: key => popupStore.get(key) || null, setItem: (key, value) => popupStore.set(key, value) },
        close() {}, location: { replace() {} } }; } },
    GAME: { ready: false, started: false, player: null, built: false }, GRAPHICS_STARTUP: { stopped: false }, GRAPHICS_CONTEXT_LOST: false,
    UI: {}, REALMS: [], CLASSES: { warrior: {} }, LEVEL_CAP: 50, coreKey: JSON.stringify,
    NET: { state: 'alone', peers: new Map(), stats: {}, link: null }, NETUI: { open: false },
    netHumanLive: () => false, netStr: (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '',
    netNote() {}, netPeerLeft() {}, netWorldRead: value => value, netWorldTake() {}, uiLog() {}, uiToast() {},
    applySettings() {}, applyWorldSave() { counts.worldApplies++; }, setupTitle() { counts.titles++; },
    async startGame() { counts.entries++; },
    async fetch(target, init = {}) {
      const path = new URL(target, 'https://game.example').pathname, token = (init.headers?.Authorization || '').replace(/^Bearer /, '');
      counts.requests.push({ path, token, method: init.method || 'GET' });
      if (path === '/gaming/manifest') return { ok: true, status: 200,
        json: async () => ({ playerIdentity: { enabled: true, provisionalPlay: { enabled: true } } }) };
      if (path === '/gaming/identity/start') { counts.starts++; return { ok: true,
        json: async () => ({ browserCeremony: 'c'.repeat(43), authorizationUrl: 'https://identity.example/authorize' }) }; }
      assert.equal(path, '/gaming/identity/status'); counts.statuses++;
      if (token === 'old-game-token') {
        if (options.holdStatus) await statusGate.promise;
        return { ok: true, json: async () => options.canonicalInitial ? { ...canonical(), account: { id: 'transport-account' } }
          : { enabled: true, bound: false, verified: false, account: { id: 'transport-account' }, provisionalPlay: { enabled: true }, recordLinks: {} } };
      }
      assert.equal(token, 'new-game-token'); return { ok: true, json: async () => canonical() };
    },
  });
  vm.runInContext(save + '\n' + transport + '\n' + guard + '\n' + identity + `
    globalThis.H = { SAVE, NETWS, NATIVE_PLAYER, loadSave, netWsOpen, netWsRetire,
      render: nativePlayerRenderEarlySignIn, connectedIdentity: nativePlayerConnectedIdentity,
      choice: nativePlayerEarlySignInChoice, connect: nativePlayerConnect, startupPending: nativePlayerStartupPending,
      begin: () => nativePlayerBegin({name:'Synthetic recruit',realm:0,cls:'warrior',fresh:true}),
      refusal: () => netWsAdmissionUpdate({admission:'identity-required',code:'native_signin_required'}),
      invalidate: saveLoadInvalidate };
  `, context);
  context.fixtureSession = session; context.fixtureProfile = profile; context.fixtureCounts = counts;
  vm.runInContext(`nativePlayerProvisionalSession = async () => {
      NATIVE_PLAYER.provisional = fixtureSession;
      NATIVE_PLAYER.provisionalContext = {host:NETWS.host,accountId:NETWS.acct?.id}; return fixtureSession;
    };
    nativePlayerModules = async () => ({createPlayerPodProfile(){return fixtureProfile;}});
    NATIVE_PLAYER.cache = {list:async()=>[{ownerDid:'${OWNER}',podUrl:'${POD}',relayUrl:'https://relay.example'}],
      get:async()=>({credential:{accessToken:'sdk-only-synthetic-grant'}})};
  `, context);
  const H = context.H;
  return { H, context, counts, nodes, sockets, channels, store, statusGate, readGate,
    async initial() {
      const promise = H.loadSave(); promise.catch(() => {});
      await until(() => counts.statuses === 1);
      if (!options.holdStatus && !options.canonicalInitial) await promise;
      return promise;
    },
    async advance(ms) {
      const end = now + ms;
      for (;;) { let next; for (const [id, task] of timers) if (task.at <= end && (!next || task.at < next[1].at)) next = [id, task];
        if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); }
      now = end; await flush();
    },
    async signIn() { nodes['loading-sign-in'].onclick(); await until(() => counts.starts === 1 && !H.NATIVE_PLAYER.busy); },
    connected() { store.set('hallowmarch.token.game.example', 'new-game-token'); channels.at(-1).onmessage({ data: {
      type: 'hallowmarch-native-connected', accountId: 'canonical-account', ownerDid: OWNER, podUrl: POD } }); },
  };
}

function assertNoGameplay(f) {
  assert.equal(f.context.GAME.ready, false); assert.equal(f.context.GAME.started, false);
  assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
  assert.equal(f.counts.intervals, 0, 'Title sign-in does not create human keepalive traffic.');
  assert(f.counts.packets.every(packet => packet.t === 'hello'), 'No slow/play, ping, activity, save or lease message is admitted.');
}

test('actual accepted title sign-in stays explicit after the server passive15-second close during world preparation', async () => {
  const f = fixture(); await f.initial(); assert.equal(f.nodes['loading-sign-in'].disabled, false);
  const packets = f.counts.packets.length; await f.advance(15001);
  assert.equal(f.H.NETWS.state, 'off'); assert.equal(f.H.NETWS.ws, null);
  assert.equal(f.nodes['loading-sign-in'].disabled, false, 'The passive title deadline must not strand sign-in behind world/GPU readiness.');
  assert.equal(f.H.connectedIdentity(), null); assert.doesNotMatch(f.nodes['loading-identity-status'].textContent, /identity is connected/i);
  await f.advance(60000); assert.equal(f.sockets.length, 1); assert.equal(f.counts.packets.length, packets);
  assert.equal(f.counts.starts, 0, 'Passive close never starts authentication or reconnects automatically.');
  await f.H.begin(); assertNoGameplay(f);
  await f.signIn(); assert.equal(f.counts.starts, 1); assert.equal(f.counts.popup, 1); assertNoGameplay(f);
});

test('a still-current original status arriving after the passive close can enable title sign-in without a new socket', async () => {
  const f = fixture({ holdStatus: true }); const pending = f.initial();
  await until(() => f.counts.statuses === 1); await f.advance(15001); assert.equal(f.H.NETWS.state, 'off');
  assert.equal(f.nodes['loading-sign-in'].disabled, true, 'Policy alone remains insufficient.');
  f.statusGate.resolve(); await pending;
  assert.equal(f.nodes['loading-sign-in'].disabled, false); assert.equal(f.sockets.length, 1); assertNoGameplay(f);
});

for (const closeBeforeStart of [true, false]) test('actual sign-in callback survives only the passive title close ' + (closeBeforeStart ? 'before' : 'after') + ' opening its popup', async () => {
  const f = fixture(); await f.initial();
  if (closeBeforeStart) await f.advance(15001);
  await f.signIn(); const channel = f.channels.at(-1);
  if (!closeBeforeStart) await f.advance(15001);
  assert.equal(channel.closed, undefined); f.connected();
  await until(() => f.counts.reads === 1);
  assert.equal(f.H.NETWS.acct.id, 'canonical-account'); assert.equal(f.H.NETWS.state, 'on');
  assert.equal(f.counts.statuses, 3, 'The callback must verify HTTP status and then reread binding after a fresh accepted socket welcome.');
  assert.equal(f.counts.reload, 0); assert.equal(f.H.NATIVE_PLAYER.switching, true); assert.equal(f.sockets.length, 2);
  assert(f.counts.requests.every(row => row.token !== 'sdk-only-synthetic-grant'));
  await f.H.begin(); assertNoGameplay(f); f.readGate.resolve(); await flush();
  assert.equal(f.H.NATIVE_PLAYER.switching, true, 'Completing identity alone cannot bypass unfinished world preparation.');
});

test('the newly verified transport can idle-close while world preparation is pending and the original handoff still completes after readiness', async () => {
  const f = fixture(); await f.initial(); await f.advance(15001); await f.signIn(); f.connected();
  await until(() => f.counts.reads === 1); f.readGate.resolve();
  await until(() => f.H.SAVE.loading.settled && !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.NATIVE_PLAYER.switching, true);
  await f.advance(15001);
  assert.equal(f.H.NETWS.state, 'off'); assert.equal(f.H.NETWS.acct.id, 'canonical-account');
  assert.equal(f.H.startupPending(), true, 'The second passive deadline cannot discard an already verified identity/private-read handoff.');
  assert.equal(f.H.NATIVE_PLAYER.switching, true); assert.equal(f.H.connectedIdentity(), null); assertNoGameplay(f);
  f.context.GAME.ready = true; await f.advance(100);
  assert.equal(f.H.startupPending(), false); assert.equal(f.H.NATIVE_PLAYER.switching, false);
  assert.equal(f.H.SAVE.nativePaused, false); assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.SAVE.loading.invalidated, false);
  assert.equal(f.counts.titles, 1); assert.equal(f.counts.reload, 0); assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0);
  assert.equal(f.sockets.length, 2, 'Readiness completion does not create another socket, lease or retry loop.');
});

test('an accepted canonical identity stops claiming a live connection after the passive close while explicit sign-in remains available', async () => {
  const f = fixture({ canonicalInitial: true }); const pending = f.initial();
  await until(() => f.counts.reads === 1);
  assert.match(f.nodes['loading-identity-status'].textContent, /identity is connected/i);
  await f.advance(15001);
  assert.equal(f.nodes['loading-sign-in'].disabled, false); assert.equal(f.H.connectedIdentity(), null);
  assert.doesNotMatch(f.nodes['loading-identity-status'].textContent, /identity is connected/i);
  assertNoGameplay(f); f.readGate.resolve(); await pending;
});

for (const [label, code, reason] of [
  ['normal browser close', 1000, ''], ['different code', 1001, 'Human play not started'],
  ['different server reason', 4000, 'Disconnected'], ['partial reason', 4000, 'Human play not started extra'],
]) test(label + ' never inherits passive-title sign-in evidence', async () => {
  const f = fixture(); await f.initial(); const captured = f.nodes['loading-sign-in'].onclick;
  f.sockets[0].close(code, reason); f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, true);
  captured(); assert.equal(f.counts.starts, 0); assert.equal(f.counts.popup, 0); assertNoGameplay(f);
});

for (const [label, change] of [
  ['changed host', f => { f.H.NETWS.host = 'other.example'; }],
  ['changed token', f => { f.H.NETWS.token = 'different-game-token'; }],
  ['changed account', f => { f.H.NETWS.acct = { id: 'other-account' }; }],
  ['changed generation', f => { f.H.NETWS.generation++; }],
  ['identity refusal', f => f.H.refusal()],
  ['replaced load', f => { f.H.SAVE.loading = { active: true }; }],
  ['invalidated load', f => f.H.invalidate()],
  ['explicitly closed session', f => { f.H.NETWS.closed = true; }],
  ['reload required', f => { f.H.NETWS.reload = true; }],
  ['pending private write', f => { f.H.SAVE.pending = {}; }],
]) test('passive close cannot carry a captured sign-in action across ' + label, async () => {
  const f = fixture(); await f.initial(); await f.advance(15001); const captured = f.nodes['loading-sign-in'].onclick;
  change(f); f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, true);
  captured(); assert.equal(f.counts.starts, 0); assert.equal(f.counts.popup, 0); assertNoGameplay(f);
});

for (const [label, change] of [
  ['a started game', f => { f.context.GAME.started = true; }],
  ['an existing player', f => { f.context.GAME.player = {}; }],
]) test('the passive server close cannot preserve title evidence for ' + label, async () => {
  const f = fixture(); await f.initial(); const captured = f.nodes['loading-sign-in'].onclick;
  change(f); await f.advance(15001); f.H.render();
  assert.equal(f.nodes['loading-sign-in'].disabled, true); captured();
  assert.equal(f.counts.starts, 0); assert.equal(f.counts.popup, 0); assert.equal(f.counts.writes, 0);
});

test('a new socket opening invalidates the passive choice and its captured callback before another welcome', async () => {
  const f = fixture(); await f.initial(); await f.advance(15001); const captured = f.nodes['loading-sign-in'].onclick;
  const opening = f.H.netWsOpen(); f.H.render();
  assert.equal(f.nodes['loading-sign-in'].disabled, true); captured(); assert.equal(f.counts.starts, 0);
  await opening; f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, true);
  assert.equal(f.counts.statuses, 1, 'A new welcome alone must not revive the previous status action.'); assertNoGameplay(f);
});

for (const closeLink of [false, true]) test('explicit ' + (closeLink ? 'link close' : 'socket retirement') + ' invalidates the passive title choice', async () => {
  const f = fixture(); await f.initial(); await f.advance(15001); const captured = f.nodes['loading-sign-in'].onclick;
  if (closeLink) f.H.NETWS.link.close(); else f.H.netWsRetire(f.H.NETWS.ws, 'explicit user retry');
  f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, true); captured();
  assert.equal(f.counts.starts, 0); assert.equal(f.counts.popup, 0); assertNoGameplay(f);
});

for (const [label, code, reason] of [
  ['network failure', 1006, ''], ['game update', 4006, 'Reload Hallowmarch to join the updated shared world.'],
]) test('an outstanding popup callback cannot revive identity after ' + label, async () => {
  const f = fixture(); await f.initial(); await f.signIn(); f.sockets[0].close(code, reason);
  f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, true); f.connected(); await flush();
  assert.equal(f.counts.statuses, 1, 'An invalidated callback cannot perform the canonical verification or fresh welcome.');
  assert.equal(f.counts.reads, 0); assert.equal(f.sockets.length, 1); assert.equal(f.H.SAVE.readConfirmed, false);
  assertNoGameplay(f);
});

test('a stale different-socket retirement cannot revoke the current passive-title scope', async () => {
  const f = fixture(); await f.initial(); await f.advance(15001);
  assert.equal(f.H.netWsRetire({ readyState: 3 }, 'stale previous socket'), false);
  f.H.render(); assert.equal(f.nodes['loading-sign-in'].disabled, false);
  assert.equal(f.counts.starts, 0); assertNoGameplay(f);
});
