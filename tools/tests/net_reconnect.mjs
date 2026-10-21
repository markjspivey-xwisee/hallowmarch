#!/usr/bin/env node
// Actual multiplayer client in a deterministic VM: timers and sockets are controlled, protocol code is unchanged.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const sourceParts = ['12_save.js', '14n_net.js', '14p_netws.js']
  .map(name => fs.readFileSync(path.join(root, 'src', name), 'utf8'));
const source = sourceParts.join('\n');
const nativeSource = fs.readFileSync(path.join(root, 'src/14v_nativeidentity.js'), 'utf8');
const HOST = 'march.test', URL_WS = 'wss://' + HOST + '/ws';
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
};
async function flush() { for (let i = 0; i < 40; i++) await Promise.resolve(); }

function harness(options = {}) {
  let now = 0, id = 0;
  const jobs = new Map(), sockets = [], failures = [], storage = new Map(Object.entries(options.storage || {}));
  const clock = {
    get now() { return now; },
    setTimeout(fn, delay = 0) {
      const key = ++id;
      jobs.set(key, { fn, at: now + Math.max(0, Number(delay) || 0), interval: 0 });
      return key;
    },
    setInterval(fn, delay) {
      const key = ++id;
      jobs.set(key, { fn, at: now + delay, interval: delay });
      return key;
    },
    clear(key) { jobs.delete(key); },
    stall(ms) { now += ms; },
    async advance(ms) {
      const end = now + ms;
      for (let guard = 0; guard < 10000; guard++) {
        const due = [...jobs].filter(([, j]) => j.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!due) { now = end; await flush(); return; }
        const [key, job] = due;
        now = Math.max(now, job.at);
        if (job.interval) job.at = now + job.interval; else jobs.delete(key);
        job.fn();
        await flush();
      }
      throw new Error('Unbounded timer loop');
    },
  };
  class Socket {
    constructor(url) {
      if (options.throwOpen) throw new Error('offline');
      this.url = url; this.readyState = 0; this.sent = []; this.closed = 0; this.created = now;
      sockets.push(this);
    }
    open() { this.readyState = 1; return this.onopen?.({}); }
    message(m) { return this.onmessage?.({ data: JSON.stringify(m) }); }
    send(s) { assert.equal(this.readyState, 1, 'send requires an open socket'); this.sent.push(JSON.parse(s)); }
    close() {
      if (this.readyState >= 2) return;
      this.closed++;
      if (options.delayedClose) { this.readyState = 2; return; }
      this.emitClose();
    }
    emitClose() { this.readyState = 3; this.onclose?.({ code: 1006 }); }
  }
  const GAME = { ready: false, started: false, player: null, prog: null };
  const buttons = new Map(['btn-begin', 'btn-continue', 'save-note'].map(id => [id, { disabled: false, textContent: '' }]));
  const binding = { subjectDid: 'did:web:identity.test:users:u-owner', podUrl: 'https://pod.test/u-owner/' };
  const nativeProfile = options.nativeProfile || { connect: async () => {}, get: async () => ({ exists: false }),
    status: () => ({ keyPresent: true, hasRecord: false }), set: async () => {}, close() {} };
  const requests = [], titleUpdates = [], settingUpdates = [], worldUpdates = [];
  const context = vm.createContext({
    // This transport fixture represents an already live human; lease/idle behavior has dedicated integration tests.
    netHumanSync() {}, netHumanLive: () => true, NET_HUMAN_PLAY: { activity: 1 },
    console, URL, URLSearchParams, Map, Set, Object, Array, JSON, Math, AbortSignal,
    performance: { now: () => now },
    Date: class extends Date { static now() { return 1700000000000 + now; } },
    setTimeout: clock.setTimeout, clearTimeout: clock.clear,
    setInterval: clock.setInterval, clearInterval: clock.clear,
    WebSocket: Socket, GAME, BOOT_SAFE: true, CAPTURE: { on: false },
    CLASSES: { warrior: {} }, LEVEL_CAP: 50,
    clamp: (n, lo, hi) => Math.max(lo, Math.min(hi, n)),
    localStorage: {
      getItem: k => storage.get(k) ?? null,
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    location: { search: '?server=' + encodeURIComponent(URL_WS) + '&shard=regression', reload: () => failures.push('unexpected reload') },
    window: { claude: options.claude, addEventListener() {} },
    document: { addEventListener() {}, querySelector: () => null, hidden: false },
    $: id => buttons.get(id) || null,
    fetch: async (url, init) => {
      requests.push({ url, init });
      if (url.endsWith('/gaming/manifest')) return options.manifestResponse ? options.manifestResponse() : {
        ok: true, status: 200, json: async () => options.manifest || { playerIdentity: { enabled: true } },
      };
      assert.equal(url, '/gaming/identity/status');
      return { ok: options.statusCode !== 503, status: options.statusCode || 200,
        json: async () => options.nativeStatus || { enabled: true, bound: true, verified: true, binding, recordLinks: {} } };
    },
    reportError: error => failures.push(String(error)),
    netUiOn() {}, netSeasonMsg() {}, coMsg() {}, season2ServerMsg() {},
    savePartsKey: x => x, landKey: x => x,
    setupTitle: save => titleUpdates.push(save), fixtureSettingUpdates: settingUpdates, fixtureWorldUpdates: worldUpdates,
    // The native owner port is tested separately from the legacy WS transport.
    nativePlayerSaveRef: async () => options.nativeSave || null,
    NATIVE_PLAYER: { state: 'ready' }, nativePlayerRender() {},
  });
  const bootOrderSource = options.earlyBoot ? sourceParts[0] + '\nglobalThis.earlyLoading=loadSave(); earlyLoading.catch(()=>{});\n' + sourceParts.slice(1).join('\n') : source;
  vm.runInContext(bootOrderSource + '\n' + (options.nativePolicy ? nativeSource : '') + '\n' + [
    'netHostElect = netInbox = netGhosts = netDeathWatch = netWorldKeep = () => {};',
    'netPeerLeft = (peer) => NET.peers.delete(peer);',
    'netSlowObj = () => ({on:1,n:GAME.player?.name || "",r:0,c:"warrior",l:1});',
    'netFastObj = () => ({p:[0,0,0],y:0,v:0,a:0,h:100});',
    'globalThis.fixtureSave = {v:1,char:null,settings:{},world:null};',
    'buildSave = () => JSON.parse(JSON.stringify(globalThis.fixtureSave));',
    'applySettings = settings => fixtureSettingUpdates.push(settings); applyWorldSave = world => fixtureWorldUpdates.push(world);',
    'globalThis.H = {NET,NETWS,SAVE,GAME,netLinkWS,netConnect,netPump,netWsOpen,netWsRetire,netWsReconnect,netWsAcct,netAcctDo,netServerSaveRef,loadSave,saveNow,nativePlayerRender,netWsTokenForget};',
  ].join('\n'), context);
  if (options.nativePolicy) {
    context.fixtureNativeProfile = nativeProfile; context.fixtureNativeBinding = binding;
    vm.runInContext('NATIVE_PLAYER.module=Promise.resolve({createPlayerPodProfile:()=>fixtureNativeProfile}); NATIVE_PLAYER.cache={list:async()=>[{...fixtureNativeBinding,ownerDid:fixtureNativeBinding.subjectDid,relayUrl:"https://relay.test"}],get:async()=>({credential:{kind:"relay-oauth-bearer",accessToken:"browser-only-fixture-token"}})}; H.NATIVE_PLAYER=NATIVE_PLAYER;', context);
  }
  const H = context.H;
  if (options.nativeSave) H.SAVE.native = true;
  const welcome = (socket, peer = 'peer-new') => socket.message({
    t: 'welcome', v: 1, peer, token: 'server-issued-token',
    acct: { id: 'account-one', guest: true }, world: { k: [] },
  });
  async function healthy() {
    const promise = H.netConnect();
    await flush();
    assert.equal(sockets.length, 1);
    await sockets[0].open(); await flush();
    welcome(sockets[0]); await promise; await flush();
    assert.equal(H.NET.state, 'on');
    return sockets[0];
  }
  async function drive(ms, step = 100) {
    for (let t = 0; t < ms; t += step) {
      H.netPump(0.1);
      await clock.advance(Math.min(step, ms - t));
    }
  }
  async function nextSocket() {
    const count = sockets.length;
    for (let elapsed = 0; elapsed <= 16000 && sockets.length === count; elapsed += 100) await drive(100);
    assert.equal(sockets.length, count + 1, 'one new socket opens within capped retry delay');
    return sockets.at(-1);
  }
  return { H, clock, sockets, failures, storage, context, welcome, healthy, drive, nextSocket, buttons, requests, nativeProfile, titleUpdates, settingUpdates, worldUpdates, earlyLoading: context.earlyLoading };
}

test('cold handshake failure is shared, clears its promise, and reconnects after a stalled boot', async () => {
  const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'existing-host-token' } });
  const first = h.H.netLinkWS(), same = h.H.netLinkWS();
  assert.equal(first, same, 'save and room share one attempt');
  const connect = h.H.netConnect();
  await flush();
  assert.equal(h.sockets.length, 1);
  const old = h.sockets[0];
  await old.open(); await flush();
  assert.deepEqual(old.sent[0], { t: 'hello', v: 1, token: 'existing-host-token', room: 'regression' });
  await h.clock.advance(7000);
  h.clock.stall(60000); // startup blocks the main thread; queued deadline runs before its queued welcome.
  await h.clock.advance(0);
  assert.equal(await first, null);
  await connect;
  assert.equal(h.H.NETWS.linkP, null, 'a failed Promise must not poison all later attempts');
  assert.equal(h.H.NETWS.state, 'off');
  assert.equal(h.H.NET.state, 'alone');
  assert.equal(old.closed, 1);
  old.message({ t: 'welcome', peer: 'too-late', token: 'stale-token', acct: { id: 'stale' } });
  assert.notEqual(h.H.NET.self, 'too-late', 'expired welcome cannot authenticate a dead attempt');
  await h.drive(30000);
  assert.equal(h.sockets.length, 1, 'boot and diagnostic pages do not start background retry work before ready');
  h.H.GAME.ready = true; h.H.GAME.started = true; h.H.GAME.player = { name: 'Local Aldwin' };
  await h.nextSocket();
  assert.equal(h.sockets.length, 2, 'a ready game retries once after initial timeout');
  const current = h.sockets[1];
  const shared = h.H.netLinkWS();
  for (let i = 0; i < 20; i++) { h.H.netConnect(); h.H.netPump(0.1); }
  await flush();
  assert.equal(h.sockets.length, 2, 'concurrent asks cannot create duplicate live sockets');
  await current.open(); await flush(); h.welcome(current);
  await shared; await flush(); await h.drive(100);
  assert.equal(h.H.NET.state, 'on');
  assert.equal(h.H.NET.link.kind, 'ws');
  assert.equal(h.H.NET.link.connected(), true);
  assert.equal(current.sent.filter(m => m.t === 'hello').length, 1);
  assert.equal(current.sent.find(m => m.t === 'hello').room, 'regression');
  assert.ok(current.sent.some(m => m.t === 'slow' && m.d.n === 'Local Aldwin'), 'welcome resumes the running character profile');
  assert.equal(h.sockets.filter(s => s.readyState !== 3).length, 1);
  assert.deepEqual(h.failures, []);
});

for (const phase of ['connecting', 'awaiting welcome']) test('explicit title retirement releases an old ' + phase + ' attempt before a fresh guest handshake', async () => {
  const h = harness({ delayedClose: true, storage: { ['hallowmarch.token.' + HOST]: 'retained-old-account-proof' } });
  const first = h.H.netLinkWS(); await flush();
  const old = h.sockets[0], oldMessage = old.onmessage, oldClose = old.onclose;
  if (phase === 'awaiting welcome') { await old.open(); await flush(); assert.equal(old.sent[0].token, 'retained-old-account-proof'); }
  assert.equal(h.H.NETWS.link, null, 'the room link has not been established');
  assert.equal(h.H.netWsRetire(old, 'explicit title sign-in'), true);
  h.H.NETWS.token = ''; h.H.NETWS.acct = null; h.storage.delete('hallowmarch.token.' + HOST);
  const second = h.H.netLinkWS();
  assert.notEqual(second, first, 'the explicit action must not reuse the retired link promise');
  await flush();
  assert.equal(await first, null, 'retirement settles every caller sharing the old opening');
  assert.equal(h.sockets.length, 2, 'a replacement socket opens without waiting for the old deadline');
  const current = h.sockets[1];
  old.open(); oldMessage({ data: JSON.stringify({ t: 'welcome', peer: 'stale-peer', token: 'stale-proof', acct: { id: 'old-owner' } }) });
  oldClose({ code: 1006 }); await flush();
  assert.equal(h.H.NETWS.ws, current); assert.equal(h.H.NETWS.acct, null); assert.equal(h.H.NETWS.token, '');
  await current.open(); await flush();
  assert.equal(current.sent[0].t, 'hello'); assert.equal(current.sent[0].token, undefined, 'fresh guest hello never forwards the old account proof');
  h.welcome(current, 'fresh-peer'); assert.ok(await second); await flush();
  await h.clock.advance(60000);
  assert.equal(h.H.NETWS.ws, current); assert.equal(h.H.NETWS.state, 'on'); assert.equal(h.H.NET.self, 'fresh-peer');
  assert.equal(h.sockets.length, 2); assert.deepEqual(h.failures, []);
});

test('retirement after welcome but before link installation cannot install the old transport', async () => {
  const h = harness({ delayedClose: true });
  const first = h.H.netLinkWS(); await flush();
  const old = h.sockets[0]; await old.open(); await flush();
  h.welcome(old, 'retired-welcome');
  assert.equal(h.H.NETWS.state, 'on'); assert.equal(h.H.NETWS.link, null);
  h.H.netWsRetire(old, 'explicit title sign-in');
  const second = h.H.netLinkWS(); await flush();
  assert.equal(await first, null, 'a superseded welcome cannot produce a retained room link');
  assert.equal(h.H.NETWS.link, null); assert.equal(h.sockets.length, 2);
  const current = h.sockets[1]; await current.open(); await flush(); h.welcome(current, 'current-welcome');
  const link = await second; assert.equal(link, h.H.NETWS.link); assert.equal(link.connected(), true);
  assert.equal(h.H.NETWS.ws, current); assert.deepEqual(h.failures, []);
});

test('explicit title retirement cancels a private token lookup before any socket exists', async () => {
  const lookup = deferred(); let reads = 0;
  const h = harness({ claude: { use: async name => name === 'db' ? { doc: () => ({
    get: () => ++reads === 1 ? lookup.promise : Promise.resolve({ exists: false }), set: async () => {},
  }) } : { id: async () => 'known-existing-owner' } } });
  const first = h.H.netLinkWS(); await flush();
  assert.equal(h.sockets.length, 0); assert.ok(h.H.NETWS.openP); assert.equal(h.H.NETWS.ws, null);
  assert.equal(h.H.netWsRetire(null, 'explicit title sign-in'), true);
  const second = h.H.netLinkWS(); assert.notEqual(second, first); await flush();
  assert.equal(await first, null); assert.equal(h.sockets.length, 1);
  const current = h.sockets[0]; await current.open(); await flush();
  assert.equal(current.sent[0].token, undefined, 'confirmed fresh absence authorizes the guest hello');
  h.welcome(current, 'fresh-after-lookup'); assert.ok(await second);
  lookup.resolve({ exists: true, data: () => ({ tokens: { [HOST]: 'retired-private-account-proof' } }) }); await flush();
  await h.clock.advance(30000);
  assert.equal(h.sockets.length, 1); assert.equal(h.H.NETWS.ws, current); assert.equal(h.H.NET.self, 'fresh-after-lookup');
  assert.equal(h.H.NETWS.token, 'server-issued-token'); assert.deepEqual(h.failures, []);
});

test('closing an established link releases a shared reconnect before an immediate fresh attempt', async () => {
  const h = harness({ delayedClose: true });
  const old = await h.healthy(), link = h.H.NETWS.link;
  old.emitClose(); await h.clock.advance(1000);
  const reconnecting = h.H.netLinkWS(); await flush();
  assert.equal(h.sockets.length, 2); assert.ok(h.H.NETWS.openP); assert.equal(h.H.NETWS.link, link);
  const retired = h.sockets[1]; link.close();
  h.H.NETWS.token = ''; h.H.NETWS.acct = null; h.storage.delete('hallowmarch.token.' + HOST);
  const fresh = h.H.netLinkWS(); assert.notEqual(fresh, reconnecting); await flush();
  assert.equal(await reconnecting, null); assert.equal(h.sockets.length, 3);
  const current = h.sockets[2]; await current.open(); await flush(); assert.equal(current.sent[0].token, undefined);
  h.welcome(current, 'fresh-after-reconnect'); const currentLink = await fresh;
  retired.open(); retired.message({ t: 'welcome', peer: 'stale-reconnect', token: 'stale-proof', acct: { id: 'old-owner' } }); retired.emitClose();
  await h.clock.advance(30000);
  assert.equal(h.H.NETWS.link, currentLink); assert.equal(currentLink.connected(), true); assert.equal(h.H.NETWS.ws, current);
  assert.equal(h.H.NET.self, 'fresh-after-reconnect'); assert.equal(h.sockets.length, 3); assert.deepEqual(h.failures, []);
});

test('repeated cold failures use one bounded backoff and recover without an unauthenticated link', async () => {
  const h = harness();
  h.H.GAME.ready = true;
  const initial = h.H.netConnect();
  await flush(); h.sockets[0].close(); await initial;
  const starts = [h.sockets[0].created];
  for (let i = 0; i < 7; i++) {
    const s = await h.nextSocket();
    const count = h.sockets.length;
    for (let j = 0; j < 20; j++) h.H.netPump(0.1);
    await flush();
    assert.equal(h.sockets.length, count, 'one opening attempt survives repeated pump calls');
    starts.push(s.created);
    assert.notEqual(h.H.NETWS.state, 'on');
    assert.notEqual(h.H.NET.state, 'on');
    s.close(); await flush();
  }
  const gaps = starts.slice(1).map((t, i) => t - starts[i]);
  assert.ok(gaps.every(n => n >= 1000 && n <= 16000), 'retry waits stay between one and fifteen seconds plus pump resolution');
  assert.ok(gaps.some(n => n >= 8000), 'failures increase the delay rather than spin once per frame');
  assert.ok(h.H.NETWS.backoff <= 15);
  const current = await h.nextSocket();
  await current.open(); await flush();
  assert.notEqual(h.H.NETWS.state, 'on', 'TCP open alone is not an authenticated welcome');
  h.welcome(current); await flush(); await h.drive(100);
  assert.equal(h.H.NET.state, 'on');
  assert.equal(h.H.NETWS.backoff, 1);
  assert.deepEqual(h.failures, []);
});

test('unknown private credentials time out without creating a new guest and can retry safely', async () => {
  const token = deferred();
  const db = { doc: () => ({ get: () => token.promise, set: async () => {} }) };
  const h = harness({ claude: { use: async name => name === 'db' ? db : name === 'user' ? { id: async () => 'u1' } : null } });
  const first = h.H.netLinkWS(); await flush();
  assert.equal(h.sockets.length, 0, 'identity discovery precedes the server hello deadline');
  await h.clock.advance(4000);
  assert.equal(await first, null);
  assert.equal(h.sockets.length, 0, 'unknown identity must not become a guest account');
  assert.equal(h.H.NETWS.linkP, null);
  h.storage.set('hallowmarch.token.' + HOST, 'new-host-token');
  const second = h.H.netLinkWS(); await flush();
  const current = h.sockets[0];
  await current.open(); await flush(); h.welcome(current); await second;
  const sent = current.sent.length;
  token.resolve({ exists: true, data: () => ({ tokens: { [HOST]: 'old-host-token' } }) });
  await flush();
  assert.equal(h.sockets.length, 1);
  assert.equal(current.sent.length, sent, 'late private lookup cannot send another hello');
  assert.equal(h.H.NETWS.token, 'server-issued-token');
  assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'server-issued-token');
  assert.deepEqual(h.failures, []);
});

test('late old welcome, close and timeout cannot mutate a newer connection', async () => {
  const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'existing-host-token' } });
  const first = h.H.netLinkWS(); await flush();
  const old = h.sockets[0]; await old.open(); await flush();
  const oldClose = old.onclose, oldMessage = old.onmessage;
  old.close(); await first; await flush();
  const second = h.H.netLinkWS(); await flush();
  const current = h.sockets[1];
  await current.open(); await flush(); h.welcome(current, 'current-peer'); await second;
  h.H.NET.peers.set('current-other-peer', {});
  oldMessage({ data: JSON.stringify({ t: 'welcome', peer: 'old-peer', token: 'old-token', acct: { id: 'old' } }) });
  oldClose({ code: 1006 });
  await h.clock.advance(30000);
  assert.equal(h.H.NETWS.ws, current);
  assert.equal(h.H.NETWS.state, 'on');
  assert.equal(h.H.NET.self, 'current-peer');
  assert.equal(h.H.NETWS.token, 'server-issued-token');
  assert.equal(h.H.NETWS.acct.id, 'account-one');
  assert.ok(h.H.NET.peers.has('current-other-peer'));
  assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'server-issued-token');
  assert.equal(h.sockets.length, 2, 'old deadlines cannot create a third socket');
  assert.deepEqual(h.failures, []);
});

test('disconnect settles pending account and save calls; stale save replies cannot consume new waits', async () => {
  const h = harness();
  h.H.GAME.ready = true;
  const old = await h.healthy(), oldMessage = old.onmessage;
  const ref = await h.H.netServerSaveRef();
  let loadSettled = 0, acctSettled = 0;
  const load = ref.get().then(() => assert.fail('a dropped load cannot succeed'), error => { loadSettled++; assert.equal(error.code, 'unavailable'); });
  const acct = h.H.netWsAcct('login', 'somebody', 'wrong-pass').then(r => { acctSettled++; assert.equal(r.ok, false); return r; });
  old.close(); await flush();
  await load; await acct;
  assert.equal(loadSettled, 1); assert.equal(acctSettled, 1);
  assert.equal(h.H.NETWS.acctWait, null);
  await h.drive(16000);
  const current = h.sockets.at(-1);
  await current.open(); await flush(); h.welcome(current); await flush();
  const newRef = await h.H.netServerSaveRef();
  let latest = null;
  const nextLoad = newRef.get().then(s => { latest = s.data(); });
  await flush(); assert.equal(h.H.NETWS.waits.length, 1);
  oldMessage({ data: JSON.stringify({ t: 'save', d: { name: 'stale-save' } }) });
  await flush();
  assert.equal(h.H.NETWS.waits.length, 1);
  assert.equal(latest, null);
  current.message({ t: 'save', d: { name: 'current-account-save' } });
  await nextLoad;
  assert.equal(latest.name, 'current-account-save');
  await h.clock.advance(10000);
  assert.equal(loadSettled, 1); assert.equal(acctSettled, 1);
  assert.deepEqual(h.failures, []);
});

test('local save fallback remains local after late authenticated multiplayer reconnect', async () => {
  const local = { v: 1, char: { name: 'Local Aldwin', realm: 0, cls: 'warrior', level: 3, xp: 29 }, settings: { quality: 'high' }, world: null };
  const h = harness({ storage: {
    'hallowmarch.save.v1': JSON.stringify(local),
    ['hallowmarch.token.' + HOST]: 'existing-account-token',
    'hallowmarch.token.other.test': 'other-host-token',
  } });
  const loaded = await h.H.loadSave();
  assert.equal(h.sockets.length, 0, 'the idle title retains its local character without a presence socket');
  assert.equal(loaded.char.name, local.char.name);
  assert.equal(h.H.SAVE.ref, null);
  assert.equal(h.H.SAVE.backend, 'local');
  await h.clock.advance(15000);
  assert.equal(h.H.NETWS.linkP, null);
  h.H.GAME.ready = true; h.H.GAME.started = true; h.H.GAME.player = { name: local.char.name };
  const connecting = h.H.netConnect(); await flush();
  const current = h.sockets.at(-1);
  await current.open(); await flush(); h.welcome(current); await connecting;
  h.context.fixtureSave = { ...local, char: { ...local.char, xp: 46 } };
  await h.H.saveNow();
  assert.equal(h.H.SAVE.ref, null);
  assert.equal(h.H.SAVE.backend, 'local');
  assert.equal(h.H.SAVE.loaded.char.name, local.char.name);
  assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.xp, 46);
  assert.ok(!current.sent.some(m => ['load', 'save', 'wipe'].includes(m.t)), 'presence recovery never reads or overwrites an unselected account save');
  assert.equal(h.storage.get('hallowmarch.token.other.test'), 'other-host-token');
  assert.deepEqual(h.failures, []);
});

test('server denial and failed account authentication never invent a session or replace an account token', async () => {
  const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'old-valid-token' } });
  const linking = h.H.netLinkWS(); await flush();
  const socket = h.sockets[0]; await socket.open(); await flush();
  socket.message({ t: 'denied', why: 'Authentication required' });
  assert.equal(await linking, null);
  assert.notEqual(h.H.NETWS.state, 'on');
  assert.equal(h.H.NETWS.acct, null);
  assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'old-valid-token');
  const second = h.H.netLinkWS(); await flush();
  const current = h.sockets.at(-1); await current.open(); await flush(); h.welcome(current); await second;
  const acct = h.H.netAcctDo('login', 'somebody', 'wrong-pass');
  current.message({ t: 'acct', ok: false, why: 'Wrong password', acct: { id: 'forged' }, token: 'untrusted-failed-response' });
  const r = await acct;
  assert.equal(r.ok, false);
  assert.equal(h.H.NETWS.acct.id, 'account-one');
  assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'server-issued-token');
  await h.clock.advance(1000);
  assert.deepEqual(h.failures, []);
});

test('closing a recovered link cancels further retries and keeps one heartbeat', async () => {
  const h = harness();
  h.H.GAME.ready = true;
  await h.healthy();
  const cached = h.H.netLinkWS();
  for (let i = 0; i < 20; i++) assert.equal(h.H.netLinkWS(), cached);
  await h.clock.advance(30000);
  assert.equal(h.sockets[0].sent.filter(m => m.t === 'ping').length, 3, 'exactly one heartbeat interval');
  h.H.NET.link.close();
  await h.drive(60000);
  assert.equal(h.sockets.length, 1, 'intentional close does not reconnect');
  assert.equal(h.H.NETWS.ws, null);
  assert.deepEqual(h.failures, []);
});

test('an established link retries once per capped backoff and resends its profile after recovery', async () => {
  const h = harness();
  h.H.GAME.ready = true; h.H.GAME.started = true; h.H.GAME.player = { name: 'Returning Aldwin' };
  const first = await h.healthy();
  first.close(); await flush();
  const gaps = [];
  for (let i = 0; i < 7; i++) {
    const failedAt = h.clock.now;
    const current = await h.nextSocket();
    gaps.push(current.created - failedAt);
    current.close(); await flush();
    assert.equal(h.sockets.filter(s => s.readyState !== 3).length, 0);
  }
  assert.deepEqual(gaps, [1000,2000,4000,8000,15000,15000,15000]);
  const current = await h.nextSocket();
  await current.open(); await flush(); h.welcome(current);
  await flush();
  assert.equal(h.H.NETWS.backoff, 1);
  assert.equal(h.H.NET.link.connected(), true);
  assert.ok(current.sent.some(m => m.t === 'slow' && m.d.n === 'Returning Aldwin'));
  assert.deepEqual(h.failures, []);
});

test('a remote save reference cannot write or wipe a different account after reconnect', async () => {
  const h = harness();
  h.H.GAME.ready = true;
  const old = await h.healthy();
  const ref = await h.H.netServerSaveRef();
  const initialRead = ref.get();
  old.message({ t: 'save', d: { v: 1, char: { name: 'Account A' } } });
  assert.equal((await initialRead).data().char.name, 'Account A');
  old.close(); await flush();
  const current = await h.nextSocket();
  await current.open(); await flush();
  current.message({ t: 'welcome', v: 1, peer: 'peer-b', token: 'token-b', acct: { id: 'account-b', guest: true } });
  await flush();
  const before = current.sent.length;
  await assert.rejects(ref.set({ v: 1, char: { name: 'Account A' } }), e => e.code === 'revoked');
  await assert.rejects(ref.delete(), e => e.code === 'revoked');
  assert.equal(current.sent.length, before, 'owner mismatch sends neither save nor wipe');
  h.H.SAVE.ref = ref; h.H.SAVE.backend = 'db';
  h.H.GAME.player = { name: 'Account A' };
  h.context.fixtureSave = { v: 1, char: { name: 'Account A', xp: 73 }, settings: {}, world: null };
  await h.H.saveNow();
  assert.equal(h.H.SAVE.ref, null);
  assert.equal(h.H.SAVE.backend, 'local');
  assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.name, 'Account A');
  assert.ok(!current.sent.some(m => m.t === 'save' || m.t === 'wipe'));
  assert.deepEqual(h.failures, []);
});

test('private storage errors cannot create guests, while confirmed absence still permits a guest', async () => {
  const blocked = harness({ claude: { use: async () => { throw { code: 'unavailable' }; } } });
  assert.equal(await blocked.H.netLinkWS(), null);
  assert.equal(blocked.sockets.length, 0);
  assert.equal(blocked.storage.get('hallowmarch.token.' + HOST), undefined);
  const guest = harness({ claude: {
    use: async name => name === 'db' ? { doc: () => ({ get: async () => ({ exists: false }), set: async () => {} }) }
      : name === 'user' ? { id: async () => 'known-user-with-no-server-token' } : null,
  } });
  const pending = guest.H.netLinkWS(); await flush();
  assert.equal(guest.sockets.length, 1);
  await guest.sockets[0].open(); await flush();
  assert.equal(guest.sockets[0].sent[0].t, 'hello');
  assert.equal(guest.sockets[0].sent[0].token, undefined);
  guest.welcome(guest.sockets[0]); assert.ok(await pending);
  assert.deepEqual(blocked.failures, []);
  assert.deepEqual(guest.failures, []);
});

test('RPC timeout retires a CLOSING socket immediately and rejects every overlapping save wait', async () => {
  const h = harness({ delayedClose: true });
  h.H.GAME.ready = true;
  const old = await h.healthy(), oldMessage = old.onmessage;
  const ref = await h.H.netServerSaveRef(), settled = [];
  const request = label => ref.get().then(
    snap => settled.push({ label, data: snap.data() }),
    error => settled.push({ label, code: error.code }),
  );
  const first = request('first');
  await h.clock.advance(1000);
  const second = request('second');
  await h.clock.advance(7000);
  assert.equal(old.readyState, 2, 'native close may remain CLOSING without delivering close');
  assert.equal(settled.length, 2, 'one expired uncorrelated RPC invalidates every pending reply immediately');
  assert.ok(settled.every(r => r.code === 'unavailable'));
  assert.equal(h.H.NETWS.waits.length, 0);
  assert.equal(h.H.NETWS.state, 'off');
  oldMessage({ data: JSON.stringify({ t: 'save', d: { name: 'late-first-response' } }) });
  await flush();
  await first; await second;
  assert.ok(settled.every(r => r.code === 'unavailable'), 'queued old reply cannot satisfy a later request');
  const current = await h.nextSocket();
  assert.equal(h.sockets.length, 2, 'the deadline schedules one recovery attempt');
  await current.open(); await flush(); h.welcome(current);
  old.emitClose(); await flush();
  assert.equal(h.H.NETWS.ws, current);
  assert.equal(h.H.NETWS.state, 'on');
  await h.drive(3000);
  assert.equal(h.sockets.length, 2, 'old close and old RPC timers cannot duplicate recovery');
  assert.deepEqual(h.failures, []);
});

test('native unread saves never substitute another browser character or write a central fallback', async () => {
  const original = JSON.stringify({ v: 1, char: null, settings: { owner: 'other-browser-session' } });
  let writes = 0;
  const nativeSave = { native: true, get: async () => { throw { code: 'cannot_decrypt' }; },
    set: async () => { writes++; throw { code: 'key_required' }; } };
  const h = harness({ nativeSave, storage: { 'hallowmarch.save.v1': original } });
  assert.equal(await h.H.loadSave(), null);
  assert.equal(h.H.SAVE.ref, nativeSave);
  assert.equal(h.H.SAVE.backend, 'pod');
  h.H.GAME.ready = true; h.H.GAME.player = {};
  h.context.fixtureSave = { v: 1, char: null, settings: { progress: 1 } };
  await h.H.saveNow();
  assert.equal(writes, 1);
  assert.equal(h.H.SAVE.lastBody, '', 'failed pod writes must remain retryable');
  assert.equal(h.H.SAVE.pending.settings.progress, 1);
  assert.equal(h.storage.get('hallowmarch.save.v1'), original);
  assert.equal(h.sockets.length, 0, 'the native port sends no legacy save RPC');
});

test('native pending writes retry identical progress and become saved only after confirmation', async () => {
  let writes = 0;
  const nativeSave = { native: true, get: async () => ({ exists: false }),
    set: async () => { if (++writes === 1) throw { code: 'pod_pending' }; } };
  const h = harness({ nativeSave }); await h.H.loadSave();
  h.H.GAME.ready = true; h.H.GAME.player = {};
  h.context.fixtureSave = { v: 1, char: null, settings: { progress: 2 } };
  await h.H.saveNow();
  assert.equal(h.H.SAVE.lastBody, ''); assert.ok(h.H.SAVE.pending);
  await h.H.saveNow();
  assert.equal(writes, 2); assert.match(h.H.SAVE.lastBody, /progress/);
  assert.equal(h.H.SAVE.pending, null); assert.equal(h.storage.size, 0);
});

test('an older native acknowledgement cannot discard newer queued progress', async () => {
  const first = deferred(), bodies = [];
  const nativeSave = { native: true, get: async () => ({ exists: false }),
    set: async save => { bodies.push(save); if (bodies.length === 1) await first.promise; } };
  const h = harness({ nativeSave }); await h.H.loadSave();
  h.H.GAME.ready = true; h.H.GAME.player = {};
  h.context.fixtureSave = { v: 1, char: null, settings: { progress: 3 } };
  const a = h.H.saveNow(); await flush();
  h.context.fixtureSave = { v: 1, char: null, settings: { progress: 4 } };
  const b = h.H.saveNow(); assert.equal(h.H.SAVE.pending.settings.progress, 4);
  first.resolve(); await a; await b;
  assert.deepEqual(bodies.map(save => save.settings.progress), [3, 4]);
  assert.match(h.H.SAVE.lastBody, /"progress":4/); assert.equal(h.H.SAVE.pending, null);
  assert.equal(h.storage.size, 0);
});

const previousLocal = { v: 1, char: { name: 'Other browser character', realm: 0, cls: 'warrior', level: 3 }, settings: {}, world: null };
const ownNative = { ...previousLocal, char: { ...previousLocal.char, name: 'Owner pod character' } };
async function nativeWelcome(h) { await flush(); await h.sockets[0].open(); await flush(); h.welcome(h.sockets[0]); await flush(); }

for (const keyPresent of [true, false]) test('recovered native binding after transport retirement ' + (keyPresent ? 'hydrates its retained character and enables entry' : 'keeps the retained character closed without its key'), async () => {
  let reads = 0, writes = 0;
  const profile = { connect: async () => {}, get: async () => {
    reads++;
    if (!keyPresent) throw { code: 'key_required' };
    return { exists: true, data: () => ownNative };
  }, status: () => ({ keyPresent, hasRecord: true }), set: async () => { writes++; }, close() {} };
  const nativeStatus = { enabled: true, bound: true, verified: true, account: { id: 'retained-native-account' }, binding: null, recordLinks: {} };
  const h = harness({ nativePolicy: true, nativeProfile: profile, nativeStatus, storage: {
    ['hallowmarch.token.' + HOST]: 'retired-account-proof', 'hallowmarch.save.v1': JSON.stringify(previousLocal), 'native-key-fixture': 'retained-key-material',
  } });
  nativeStatus.binding = h.context.fixtureNativeBinding;
  const original = h.H.netLinkWS(); await flush(); const old = h.sockets[0]; await old.open(); await flush();
  h.H.netWsRetire(old, 'explicit title sign-in'); h.H.NETWS.token = ''; h.storage.delete('hallowmarch.token.' + HOST);
  const recovered = h.H.netLinkWS(); await flush(); assert.equal(await original, null);
  const current = h.sockets[1]; await current.open(); await flush(); assert.equal(current.sent[0].token, undefined);
  // The OAuth callback/claim is independently covered by the browser suite.
  // This welcomed owner and status model the subsequent page's restored app
  // session; exercise its actual native save initialization and read policy.
  current.message({ t: 'welcome', v: 1, peer: 'restored-native-peer', token: 'restored-native-app-proof',
    acct: { id: 'retained-native-account', nativeBound: true, guest: false }, world: { k: [] } });
  assert.ok(await recovered); old.message({ t: 'welcome', peer: 'late-old-peer', token: 'stale-proof', acct: { id: 'old-owner' } });
  const loaded = await h.H.loadSave(); h.H.nativePlayerRender();
  assert.equal(h.H.SAVE.backend, 'pod'); assert.equal(h.H.SAVE.native, true); assert.equal(reads, 1); assert.equal(writes, 0);
  assert.equal(h.H.NETWS.acct.id, 'retained-native-account'); assert.equal(h.H.NETWS.token, 'restored-native-app-proof');
  assert.equal(h.H.NATIVE_PLAYER.profile, profile); assert.equal(h.storage.get('native-key-fixture'), 'retained-key-material');
  assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.name, previousLocal.char.name);
  assert.equal(h.H.SAVE.readConfirmed, keyPresent); assert.equal(h.buttons.get('btn-begin').disabled, !keyPresent); assert.equal(h.buttons.get('btn-continue').disabled, !keyPresent);
  if (keyPresent) {
    assert.equal(loaded.char.name, ownNative.char.name); assert.equal(h.H.SAVE.loaded.char.name, ownNative.char.name);
  } else { assert.equal(loaded, null); assert.equal(h.H.SAVE.loaded, null); }
  assert(h.sockets.every(socket => !socket.sent.some(message => ['load', 'save', 'wipe'].includes(message.t))));
  assert.deepEqual(h.failures, []);
});

test('actual native policy waits past the old 12 s fallback for a delayed owner welcome', async () => {
  const profile = { connect: async () => {}, get: async () => ({ exists: true, data: () => ownNative }),
    status: () => ({ keyPresent: true, hasRecord: true }), close() {} };
  const h = harness({ nativePolicy: true, nativeProfile: profile, storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  let settled = false; const loading = h.H.loadSave().then(value => { settled = true; return value; });
  await flush(); await h.sockets[0].open(); await flush(); await h.clock.advance(18000);
  assert.equal(settled, false); assert.equal(h.H.SAVE.native, true); assert.equal(h.H.SAVE.loaded, null);
  h.welcome(h.sockets[0]); const save = await loading;
  assert.equal(save.char.name, ownNative.char.name); assert.equal(h.H.SAVE.readConfirmed, true);
  assert.equal(h.H.SAVE.backend, 'pod'); assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.name, previousLocal.char.name);
  assert(!h.sockets[0].sent.some(message => ['load', 'save', 'wipe'].includes(message.t)));
});

test('early boot starts its save read before native and transport constants initialize', async () => {
  const h = harness({ nativePolicy: true, earlyBoot: true, manifest: { schemaVersion: 1 }, throwOpen: true,
    storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const save = await h.earlyLoading;
  assert.equal(save.char.name, previousLocal.char.name); assert.equal(h.H.SAVE.native, false);
  assert.equal(h.H.SAVE.backend, 'local'); assert.equal(h.H.SAVE.loaded.char.name, previousLocal.char.name);
});

test('a timed-out native discovery cannot downgrade the exposed title after a late legacy manifest', async () => {
  const manifest = deferred();
  const h = harness({ nativePolicy: true, manifestResponse: () => manifest.promise, storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const loading = h.H.loadSave(); await flush(); await h.clock.advance(45000);
  assert.equal(await loading, null); assert.equal(h.H.SAVE.native, true); assert.equal(h.H.SAVE.readConfirmed, false);
  manifest.resolve({ ok: true, status: 200, json: async () => ({ schemaVersion: 1 }) }); await flush();
  assert.equal(h.H.SAVE.native, true); assert.equal(h.H.SAVE.backend, 'pod'); assert.equal(h.H.SAVE.loaded, null);
  assert.equal(h.H.SAVE.ref?.native, true); assert.equal(h.H.SAVE.ref?.blocked, true); assert.equal(h.sockets.length, 0);
  assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.name, previousLocal.char.name);
  h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, true); assert.equal(h.buttons.get('btn-continue').disabled, true);
});

test('confirmed legacy policy preserves offline browser play without late promotion', async () => {
  const h = harness({ nativePolicy: true, manifest: { schemaVersion: 1 }, throwOpen: true, storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const save = await h.H.loadSave();
  assert.equal(save.char.name, previousLocal.char.name); assert.equal(h.H.SAVE.native, false);
  assert.equal(h.H.SAVE.backend, 'local'); assert.equal(h.H.SAVE.ref, null); assert.equal(h.H.SAVE.server, false);
  h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, false);
  assert.equal(h.requests[0].init.credentials, 'omit'); assert.equal(h.requests[0].init.headers?.Authorization, undefined);
});

test('an explicit new title retry may confirm legacy policy afresh without accepting the timed-out response', async () => {
  const delayed = deferred(); let manifests = 0;
  const legacy = { ok: true, status: 200, json: async () => ({ schemaVersion: 1 }) };
  const h = harness({ nativePolicy: true, throwOpen: true, manifestResponse: () => ++manifests === 1 ? delayed.promise : Promise.resolve(legacy),
    storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const first = h.H.loadSave(); await flush(); await h.clock.advance(45000); assert.equal(await first, null);
  delayed.resolve(legacy); await flush(); assert.equal(h.H.SAVE.native, true); assert.equal(h.H.SAVE.loaded, null);
  const selected = await h.H.loadSave({ retry: true });
  assert.equal(manifests, 2); assert.equal(selected.char.name, previousLocal.char.name); assert.equal(h.H.SAVE.native, false);
});

for (const mode of ['unavailable', 'disabled', 'unbound']) test('advertised native ' + mode + ' owner state blocks entry and all generic fallback', async () => {
  const h = harness({ nativePolicy: true, statusCode: mode === 'unavailable' ? 503 : 200,
    nativeStatus: { enabled: mode !== 'disabled', bound: mode !== 'unbound', verified: false, binding: null, recordLinks: {} },
    storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const loading = h.H.loadSave(); await nativeWelcome(h); assert.equal(await loading, null);
  assert.equal(h.H.SAVE.native, true); assert.equal(h.H.SAVE.readConfirmed, false); assert.equal(h.H.SAVE.backend, 'pod');
  h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, true); assert.equal(h.buttons.get('btn-continue').disabled, true);
  assert(!h.sockets[0].sent.some(message => ['load', 'save', 'wipe'].includes(message.t)));
});

test('initial private read timeout retains the same owner read and opens its exact late character only on the title', async () => {
  const read = deferred(); let reads = 0, closes = 0;
  const h = harness({ nativePolicy: true, nativeProfile: { connect: async () => {}, get: () => { reads++; return read.promise; },
    status: () => ({ keyPresent: true, hasRecord: true }), close() { closes++; } }, storage: { 'hallowmarch.save.v1': JSON.stringify(previousLocal) } });
  const loading = h.H.loadSave(); await nativeWelcome(h); await h.clock.advance(45000);
  assert.equal(await loading, null); assert.equal(h.H.SAVE.readConfirmed, false);
  h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, true); assert.equal(h.buttons.get('btn-continue').disabled, true);
  const profile = h.H.NATIVE_PLAYER.profile; h.H.GAME.ready = true;
  read.resolve({ exists: true, data: () => ownNative }); await flush(); h.H.nativePlayerRender();
  assert.deepEqual(JSON.parse(JSON.stringify(h.H.SAVE.loaded)), ownNative); assert.equal(h.H.SAVE.readConfirmed, true);
  assert.equal(reads, 1); assert.equal(closes, 0); assert.equal(h.H.NATIVE_PLAYER.profile, profile);
  assert.equal(h.titleUpdates.length, 1); assert.equal(h.titleUpdates[0], h.H.SAVE.loaded);
  assert.equal(h.settingUpdates.length, 1); assert.equal(h.worldUpdates.length, 1);
  assert.equal(h.buttons.get('btn-begin').disabled, false); assert.equal(h.buttons.get('btn-continue').disabled, false);
  assert.equal(JSON.parse(h.storage.get('hallowmarch.save.v1')).char.name, previousLocal.char.name);
  assert(!h.sockets[0].sent.some(message => ['load', 'save', 'wipe'].includes(message.t)));
});

for (const changed of ['account', 'host', 'started']) test('a late private read cannot replace progress after ' + changed + ' changes', async () => {
  const read = deferred(); let closes = 0;
  const h = harness({ nativePolicy: true, nativeProfile: { connect: async () => {}, get: () => read.promise,
    status: () => ({ keyPresent: true, hasRecord: true }), close() { closes++; } } });
  const loading = h.H.loadSave(); await nativeWelcome(h); await h.clock.advance(45000); await loading;
  h.H.GAME.ready = true;
  if (changed === 'account') h.H.NETWS.acct = { id: 'another-owner' };
  if (changed === 'host') h.H.NETWS.host = 'another.test';
  if (changed === 'started') { h.H.GAME.started = true; h.H.GAME.player = { name: 'Live in-memory progress' }; }
  read.resolve({ exists: true, data: () => ownNative }); await flush();
  assert.equal(h.H.SAVE.loaded, null); assert.equal(h.H.SAVE.readConfirmed, false); assert.equal(h.titleUpdates.length, 0);
  assert.equal(h.settingUpdates.length, 0); assert.equal(h.worldUpdates.length, 0); assert.equal(closes, changed === 'started' ? 0 : 1);
  if (changed === 'started') assert.equal(h.H.GAME.player.name, 'Live in-memory progress');
  assert(!h.sockets[0].sent.some(message => ['load', 'save', 'wipe'].includes(message.t)));
});

test('a confirmed absent native character needs its encryption key before entry', async () => {
  let keyPresent = false;
  const h = harness({ nativePolicy: true, nativeProfile: { connect: async () => {}, get: async () => ({ exists: false }),
    status: () => ({ keyPresent, hasRecord: false }), close() {} } });
  const loading = h.H.loadSave(); await nativeWelcome(h); assert.equal(await loading, null);
  assert.equal(h.H.SAVE.readConfirmed, true); h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, true);
  keyPresent = true; h.H.nativePlayerRender(); assert.equal(h.buttons.get('btn-begin').disabled, false);
});

test('a native reference refuses account switches before any owner-pod write', async () => {
  let writes = 0;
  const h = harness({ nativePolicy: true, nativeProfile: { connect: async () => {}, get: async () => ({ exists: false }),
    status: () => ({ keyPresent: true, hasRecord: false }), set: async () => { writes++; }, close() {} } });
  const loading = h.H.loadSave(); await nativeWelcome(h); await loading;
  h.H.NETWS.acct = { id: 'different-account', nativeBound: true };
  await assert.rejects(h.H.SAVE.ref.set(ownNative), error => error.code === 'revoked');
  assert.equal(writes, 0);
});

test('explicit title token recovery clears only the refused host proof and preserves native/browser data', async () => {
  let privateData = { other: 'preserved', tokens: { [HOST]: 'refused-proof', 'other.test': 'other-proof' } }, writes = 0;
  const ref = { get: async () => ({ exists: true, data: () => structuredClone(privateData) }), set: async data => { privateData = data; writes++; } };
  const claude = { use: async name => name === 'db' ? { doc: () => ref } : { id: async () => 'fixture-user' } };
  const h = harness({ claude, storage: { ['hallowmarch.token.' + HOST]: 'refused-proof', 'hallowmarch.token.other.test': 'other-proof', 'native-key-fixture': 'kept' } });
  h.H.NETWS.host = HOST; h.H.NETWS.token = 'refused-proof';
  await assert.rejects(h.H.netWsTokenForget(HOST, 'refused-proof'), /current character/);
  await h.H.netWsTokenForget(HOST, 'refused-proof', () => true);
  assert.equal(writes, 1); assert.deepEqual(JSON.parse(JSON.stringify(privateData)), { other: 'preserved', tokens: { 'other.test': 'other-proof' } });
  assert.equal(h.storage.has('hallowmarch.token.' + HOST), false);
  assert.equal(h.storage.get('hallowmarch.token.other.test'), 'other-proof'); assert.equal(h.storage.get('native-key-fixture'), 'kept');
  assert.equal(h.H.NETWS.token, 'refused-proof', 'Token deletion cannot silently promote another account');
});

test('title token recovery refuses active play, pending progress and newer local or private credentials', async () => {
  for (const guard of ['started', 'pending', 'flight', 'new-local', 'new-private']) {
    let writes = 0;
    const h = harness({ storage: { ['hallowmarch.token.' + HOST]: guard === 'new-local' ? 'new-proof' : 'refused-proof' },
      claude: { use: async name => name === 'db' ? { doc: () => ({ get: async () => ({ exists: true, data: () => ({ tokens: { [HOST]: 'new-proof' } }) }), set: async () => { writes++; } }) } : { id: async () => 'fixture-user' } } });
    h.H.NETWS.host = HOST; h.H.NETWS.token = 'refused-proof';
    if (guard === 'started') h.H.GAME.started = true;
    if (guard === 'pending') h.H.SAVE.pending = { progress: 'kept' };
    if (guard === 'flight') h.H.SAVE.nativeFlight = Promise.resolve();
    await assert.rejects(h.H.netWsTokenForget(HOST, 'refused-proof', () => true), /current character|Another game session/);
    assert.equal(writes, 0); assert.equal(h.storage.get('hallowmarch.token.' + HOST), guard === 'new-local' ? 'new-proof' : 'refused-proof');
  }
});

test('private token recovery rechecks a refreshed grant before writing and refuses unreadable storage', async () => {
  for (const cause of ['refresh', 'unavailable']) {
    let reads = 0, writes = 0;
    const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'refused-proof' }, claude: { use: async name => name === 'db' ? { doc: () => ({
      get: async () => { if (cause === 'unavailable') throw Error('fixture private store offline'); return { exists: true, data: () => ({ tokens: { [HOST]: ++reads === 1 ? 'refused-proof' : 'fresh-proof' } }) }; },
      set: async () => { writes++; },
    }) } : { id: async () => 'fixture-user' } } });
    h.H.NETWS.host = HOST;
    await assert.rejects(h.H.netWsTokenForget(HOST, 'refused-proof', () => true), /Another game session|offline/);
    assert.equal(writes, 0); assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'refused-proof');
  }
});

test('timed-out private recovery quarantines its late read and never clears a token or opens a socket', async () => {
  const reading = deferred(); let writes = 0;
  const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'refused-proof' }, claude: { use: async name => name === 'db' ? { doc: () => ({
    get: () => reading.promise, set: async () => { writes++; },
  }) } : { id: async () => 'fixture-user' } } });
  h.H.NETWS.host = HOST;
  const rejected = assert.rejects(h.H.netWsTokenForget(HOST, 'refused-proof', () => true), /did not confirm in time/);
  await flush(); await h.clock.advance(8000); await rejected;
  reading.resolve({ exists: true, data: () => ({ tokens: { [HOST]: 'refused-proof' } }) }); await flush();
  assert.equal(writes, 0); assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'refused-proof'); assert.equal(h.sockets.length, 0);
});

test('private recovery stops when gameplay progress appears during its storage read', async () => {
  const reading = deferred(); let writes = 0;
  const h = harness({ storage: { ['hallowmarch.token.' + HOST]: 'refused-proof' }, claude: { use: async name => name === 'db' ? { doc: () => ({
    get: () => reading.promise, set: async () => { writes++; },
  }) } : { id: async () => 'fixture-user' } } });
  h.H.NETWS.host = HOST;
  const rejected = assert.rejects(h.H.netWsTokenForget(HOST, 'refused-proof', () => true), /current character/); await flush();
  h.H.SAVE.pending = { privateProgress: 'kept' };
  reading.resolve({ exists: true, data: () => ({ tokens: { [HOST]: 'refused-proof' } }) }); await rejected;
  assert.equal(writes, 0); assert.equal(h.storage.get('hallowmarch.token.' + HOST), 'refused-proof');
});
