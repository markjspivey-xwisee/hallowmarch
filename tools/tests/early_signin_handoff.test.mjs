/** Actual pre-game identity lifecycle; synthetic ports only, no owner browser or network. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import vm from 'node:vm';
import { parse } from 'acorn';

const identitySource = readFileSync(new URL('../../src/14v_nativeidentity.js', import.meta.url), 'utf8');
const saveSource = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8').split('function graphicsSaveSettings()')[0];
const ui = readFileSync(new URL('../../src/10_ui.js', import.meta.url), 'utf8');
const guardNode = parse(ui, { ecmaVersion: 'latest' }).body.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'titleEntryBlocked');
const guard = ui.slice(guardNode.start, guardNode.end);
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
async function until(predicate) { for (let n = 0; n < 50 && !predicate(); n++) await flush(); assert(predicate(), 'Actual handoff must reach the controlled fixture boundary.'); }
const OWNER = 'did:example:canonical-owner';
const POD = 'https://pod.example/canonical-owner/';
const canonical = () => ({ enabled: true, bound: true, verified: true, account: { id: 'canonical-account' },
  binding: { userId: 'canonical-user', subjectDid: OWNER, podUrl: POD }, recordLinks: {} });
const character = { v: 1, char: { name: 'Canonical character', realm: 0, cls: 'warrior', level: 4 }, settings: {}, world: {} };
function fixture(options = {}) {
  let now = 0, wall = Date.now(), nextTimer = 0;
  const timers = new Map(), oldStatus = deferred(), oldPeek = deferred(), oldPrivate = deferred(), verification = deferred(), read = deferred();
  const counts = { reload: 0, requests: [], writes: 0, keys: 0, retire: 0, links: 0, reads: 0, profiles: 0,
    resumes: 0, peeks: 0, sessionCloses: 0, entries: 0, titles: [], settings: [], worlds: [], canonicalStatuses: 0, oldReads: 0,
    reconnects: [], starts: 0, forgotten: 0 };
  const store = new Map(), channels = [], popupStore = new Map();
  const document = { getElementById: () => null, querySelector: () => null, querySelectorAll: () => [] };
  const profileState = { keyPresent: options.missingKey !== true, hasRecord: options.value !== null, pending: false,
    state: options.missingKey ? 'key_required' : 'ready' };
  const sessionState = { provisional: false, pending: false };
  class FixtureDate extends Date { static now() { return wall; } }
  let context;
  const session = { status: () => sessionState, claimProfile: () => null, close() { counts.sessionCloses++; },
    async peek() { counts.peeks++; if (options.holdPeek) return oldPeek.promise; return null; },
    async resume() { counts.resumes++; throw Error('An old temporary read must not resume after handoff.'); }, profile: () => null };
  const profile = { status: () => profileState, close() {}, connect: async () => {},
    async get() { if (context.NETWS.token === 'old-game-token' && options.initialCanonical) {
      counts.oldReads++; if (options.holdOldPrivate !== false) await oldPrivate.promise;
      if (options.missingKey) throw Error('Synthetic existing private key required');
      return { exists: true, data: () => ({ ...character, char: { ...character.char, name: 'Previously selected character' } }) };
    }
      counts.reads++; if (options.holdRead !== false) await read.promise;
      if (options.readFailure) throw Error('Synthetic private read failed');
      return { exists: options.value !== null, data: () => structuredClone(options.value === undefined ? character : options.value) }; },
    set() { counts.writes++; throw Error('No private writes during sign-in.'); },
    createKey() { counts.keys++; throw Error('No key creation during sign-in.'); } };
  const retire = () => {
    counts.retire++; context.NETWS.ws = null; context.NETWS.state = 'off'; context.NETWS.closed = true; context.NETWS.generation++;
    context.H.clearTransportDisplay();
  };
  context = vm.createContext({ URL, AbortSignal: { timeout: () => new AbortController().signal }, console, structuredClone, Date: FixtureDate, crypto: webcrypto,
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; }, clearTimeout: id => timers.delete(id),
    document, $: id => document.getElementById(id), location: { origin: 'https://game.example', reload() { counts.reload++; } },
    window: { __hm: {}, open: () => ({ sessionStorage: { getItem: key => popupStore.get(key) || null,
      setItem: (key, value) => popupStore.set(key, value) }, close() {}, location: { replace() {} } }) },
    BroadcastChannel: class { constructor(name) { this.name = name; channels.push(this); } close() { this.closed = true; } },
    localStorage: { getItem: key => store.get(key) || null, setItem: (key, value) => store.set(key, value) },
    NETWS: { host: 'game.example', acct: { id: 'transport-account' }, token: 'old-game-token', generation: 7,
      state: 'on', ws: { readyState: 1 }, closed: false, reload: false },
    GAME: { ready: false, started: false }, GRAPHICS_STARTUP: { stopped: false }, GRAPHICS_CONTEXT_LOST: false,
    UI: {}, REALMS: [], CLASSES: { warrior: {} }, LEVEL_CAP: 50, coreKey: JSON.stringify,
    fixtureServer: 'wss://game.example/ws', netServerUrl: () => context.fixtureServer, netWsRetire: retire,
    netWsToken: async () => 'retired-proof',
    async netWsTokenForget(_host, _token, allowed) { assert.equal(allowed(), true); counts.forgotten++; },
    async netLinkWS() {
      counts.links++;
      if (options.refused && !context.NETWS.token) return false;
      if (!options.refused && !context.NETWS.token) {
        context.NETWS.token = 'fresh-game-token'; context.NETWS.acct = { id: 'fresh-transport-account' };
        context.NETWS.closed = false; context.NETWS.state = 'on'; context.NETWS.ws = { readyState: 1 };
      }
      if (context.NETWS.token === 'new-game-token' && context.NETWS.state !== 'on') {
        context.NETWS.closed = false; context.NETWS.state = 'on'; context.NETWS.ws = { readyState: 1 };
        context.NETWS.acct = { id: options.welcomeMismatch ? 'foreign-account' : 'canonical-account' };
      }
      return true;
    },
    applySettings: value => counts.settings.push(value), applyWorldSave: value => counts.worlds.push(value),
    setupTitle: value => counts.titles.push({ value, ready: context.GAME.ready, readConfirmed: context.H.SAVE.readConfirmed }),
    async startGame() { counts.entries++; context.GAME.started = true; },
    async fetch(url, init = {}) {
      const path = new URL(url, 'https://game.example').pathname, token = (init.headers?.Authorization || '').replace(/^Bearer /, '');
      counts.requests.push({ path, token, method: init.method || 'GET' });
      if (path === '/gaming/manifest') return { ok: true, status: 200, json: async () => ({ playerIdentity: { enabled: true, provisionalPlay: { enabled: true } } }) };
      if (path === '/gaming/identity/start') {
        counts.starts++;
        if (options.authFailureOnce && counts.starts === 1) return { ok: false, status: 401, json: async () => ({ error: 'game_account_required' }) };
        return { ok: true, json: async () => ({ browserCeremony: options.invalidCeremony ? 'malformed' : 'c'.repeat(43), authorizationUrl: 'https://identity.example/authorize' }) };
      }
      assert.equal(path, '/gaming/identity/status');
      if (token === 'old-game-token') {
        if (options.holdOldStatus) await oldStatus.promise;
        if (options.initialCanonical) return { ok: true, json: async () => ({ ...canonical(), account: { id: 'transport-account' } }) };
        return { ok: true, json: async () => ({ enabled: true, bound: false, verified: false, account: { id: 'transport-account' }, provisionalPlay: { enabled: true }, recordLinks: {} }) };
      }
      assert.equal(token, 'new-game-token'); counts.canonicalStatuses++;
      if (options.holdVerification && counts.canonicalStatuses === 1) await verification.promise;
      const status = canonical();
      if (options.verifyPatch) Object.assign(status, options.verifyPatch);
      if (options.statusMismatch || options.freshStatusMismatch && counts.canonicalStatuses > 1) status.binding = { ...status.binding, subjectDid: 'did:example:foreign', podUrl: 'https://pod.example/foreign/' };
      return { ok: true, json: async () => status };
    },
  });
  vm.runInContext(saveSource + '\n' + guard + '\n' + identitySource + `\n
    globalThis.H = { NATIVE_PLAYER, NETWS, SAVE, GAME, nativePlayerConnect, loadSave, retry: nativePlayerRetryLoad, invalidate: saveLoadInvalidate, apply: saveLoadApply,
      startupPending: nativePlayerStartupPending,
      begin: () => nativePlayerBegin({ name: 'Explicit character', realm: 0, cls: 'warrior', fresh: true }),
      clearTransportDisplay() { nativePlayerClearConnectedIdentity(); nativePlayerClearEarlySignIn(); },
      provisional: (session) => { NATIVE_PLAYER.provisional = session; NATIVE_PLAYER.provisionalContext = { host: NETWS.host, accountId: NETWS.acct?.id }; return session; } };
  `, context);
  context.H.NATIVE_PLAYER.cache = { list: async () => [{ ownerDid: OWNER, podUrl: POD, relayUrl: 'https://relay.example' },
    { ownerDid: 'did:example:foreign', podUrl: 'https://pod.example/foreign/', relayUrl: 'https://relay.example' }],
    get: async () => ({ credential: { accessToken: 'native-sdk-only-synthetic' } }) };
  context.fixtureSession = session; context.fixtureProfile = profile; context.fixtureCounts = counts;
  vm.runInContext(`nativePlayerProvisionalSession=async()=>H.provisional(fixtureSession);
    nativePlayerModules=async()=>({createPlayerPodProfile(){fixtureCounts.profiles++;return fixtureProfile;}});`, context);
  context.NETWS.link = { close() { retire(); context.NETWS.link = null; } };
  if (options.refused) Object.assign(context.NETWS, { token: '', acct: null, state: 'off', ws: null,
    sessionRefusal: { host: 'game.example', token: 'retired-proof', generation: 7, code: 'native_signin_required' } });
  return { ...context.H, context, counts, channels, store, profile, profileState, sessionState, session, oldStatus, oldPeek, oldPrivate, verification, read,
    async initial() { const result = context.H.loadSave(); result.catch(() => {});
      if (options.refused) { await result; return { promise: result, load: context.H.SAVE.loading }; }
      await until(() => counts.requests.some(row => row.path === '/gaming/identity/status'));
      if (!options.holdOldStatus && !options.holdPeek) await result; return { promise: result, load: context.H.SAVE.loading }; },
    async start(fresh = false) { const before = channels.length; context.H.nativePlayerConnect(fresh); await flush(); assert.equal(channels.length, before + 1); assert.equal(context.H.NATIVE_PLAYER.busy, false); },
    connected(channel = channels.at(-1), patch = {}) { store.set('hallowmarch.token.game.example', 'new-game-token'); channel.onmessage({ data: {
      type: 'hallowmarch-native-connected', accountId: 'canonical-account', ownerDid: OWNER, podUrl: POD,
      ...patch,
    } }); },
    failed(channel = channels.at(-1)) { channel.onmessage({ data: { type: 'hallowmarch-native-failed', host: 'game.example',
      browserCeremony: 'c'.repeat(43), error: 'native_owner_mismatch' } }); },
    jumpWall(ms) { wall += ms; },
    async advance(ms) { const end = now + ms; for (;;) { let next;
      for (const [id, timer] of timers) if (timer.at <= end && (!next || timer.at < next[1].at)) next = [id, timer];
      if (!next) break; wall += next[1].at - now; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush();
    } wall += end - now; now = end; await flush(); },
  };
}

test('a current connected notification retains unfinished world preparation instead of reloading the document', async () => {
  const f = fixture(); await f.initial(); await f.start();
  assert.equal(f.GAME.ready, false); assert.equal(f.GAME.started, false);
  f.connected(); await until(() => f.counts.reads === 1);
  assert.equal(f.counts.reload, 0, 'Successful pre-game sign-in must retain the prepared world/GPU rather than restart the document.');
  assert.equal(f.NETWS.acct.id, 'canonical-account'); assert.equal(f.NATIVE_PLAYER.switching, true);
  await f.begin(); assert.equal(f.counts.entries, 0); f.read.resolve(); await flush();
  assert.equal(f.NATIVE_PLAYER.switching, true); assert.equal(f.counts.titles.length, 0);
  f.GAME.ready = true; await f.advance(100);
  assert.equal(f.NATIVE_PLAYER.switching, false); assert.equal(f.SAVE.nativePaused, false);
  assert.equal(f.counts.titles.at(-1).value.char.name, 'Canonical character'); assert.equal(f.counts.titles.at(-1).ready, true);
  assert.equal(f.GAME.started, false); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
  assert(f.counts.requests.every(row => row.token !== 'native-sdk-only-synthetic'));
});

test('a held original status releases its boot-return wait on valid handoff without settling or reusing the old operation', async () => {
  const f = fixture({ holdOldStatus: true }); const first = await f.initial(); let oldSettled = false, returned = false;
  first.load.promise.then(() => { oldSettled = true; }); first.promise.then(() => { returned = true; });
  await f.start(); f.connected(); await until(() => f.counts.reads === 1);
  assert.equal(returned, true); assert.equal(await first.promise, null); assert.equal(oldSettled, false);
  assert.equal(first.load.timedOut, false); const current = f.SAVE.loading;
  f.oldStatus.resolve(); await first.load.promise; await flush();
  assert.equal(f.SAVE.loading, current); assert.equal(f.counts.resumes, 0); assert.equal(f.NATIVE_PLAYER.profile, f.profile);
  f.read.resolve(); await flush(); f.GAME.ready = true; await f.advance(100);
  assert.equal(f.SAVE.loaded.char.name, 'Canonical character'); assert.equal(f.counts.reload, 0);
});

test('cancelled old provisional metadata cannot resume or mutate a later generation', async () => {
  const f = fixture({ holdPeek: true }); const first = await f.initial(); await until(() => f.counts.peeks === 1);
  f.invalidate(first.load); assert.equal(await first.promise, null);
  f.oldPeek.resolve({ ownerDid: 'did:example:old-guest', lastConfirmedClaim: true }); await first.load.promise;
  assert.equal(f.counts.resumes, 0); assert.equal(f.NATIVE_PLAYER.claimLastConfirmed, false);
  assert.equal(f.SAVE.loaded, null); assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.counts.writes, 0);
});

test('duplicate current notifications coalesce one authoritative verification and one private read', async () => {
  const f = fixture({ holdVerification: true }); await f.initial(); await f.start();
  f.connected(); f.connected(); await until(() => f.counts.canonicalStatuses === 1);
  assert.equal(f.counts.retire, 0); f.verification.resolve(); await until(() => f.counts.reads === 1);
  assert.equal(f.counts.profiles, 1); assert.equal(f.counts.retire, 1); f.read.resolve(); await flush();
  f.GAME.ready = true; await f.advance(100); assert.equal(f.counts.reload, 0);
});

const staleChanges = [
  ['server', f => { f.context.fixtureServer = 'wss://other.example/ws'; }],
  ['host', f => { f.NETWS.host = 'other.example'; }],
  ['account', f => { f.NETWS.acct = { id: 'other-account' }; }],
  ['token', f => { f.NETWS.token = 'unrelated-token'; }],
  ['generation', f => { f.NETWS.generation++; }],
  ['initializer', f => { f.SAVE.loading = { active: true, settled: true }; }],
  ['display epoch', f => f.context.H.clearTransportDisplay()],
  ['expired ceremony', f => f.jumpWall(10 * 60 * 1000 + 1)],
  ['closed connection', f => { f.NETWS.closed = true; }],
];
for (const [name, change] of staleChanges) test('stale ' + name + ' success and failure callbacks are no-ops', async () => {
  const f = fixture(); await f.initial(); await f.start(); const channel = f.channels[0];
  change(f); const beforeMessage = f.NATIVE_PLAYER.message, beforeRefusal = f.NATIVE_PLAYER.authRefusal;
  f.connected(); f.failed(); await flush();
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0);
  assert.equal(f.counts.reload, 0); assert.equal(f.NATIVE_PLAYER.channel, channel); assert.notEqual(channel.closed, true);
  assert.equal(f.NATIVE_PLAYER.message, beforeMessage); assert.equal(f.NATIVE_PLAYER.authRefusal, beforeRefusal);
});

test('a callback from a replaced channel cannot consume the replacement', async () => {
  const f = fixture(); await f.initial(); await f.start(); const old = f.channels[0], replacement = { close() { this.closed = true; } };
  f.NATIVE_PLAYER.channel = replacement; f.connected(old); f.failed(old); await flush();
  assert.equal(f.NATIVE_PLAYER.channel, replacement); assert.notEqual(replacement.closed, true);
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0);
});

test('observing a stale ceremony closes only its exact channel and leaves unrelated private work intact', async () => {
  const f = fixture(); await f.initial(); await f.start(); const stale = f.channels[0], load = f.SAVE.loading;
  const pending = f.SAVE.pending = { operation: 'unrelated-owned-save' };
  f.NETWS.generation++;
  assert.equal(f.startupPending(), false);
  assert.equal(stale.closed, true); assert.equal(f.NATIVE_PLAYER.channel, null);
  assert.equal(f.SAVE.pending, pending); assert.equal(f.SAVE.loading, load); assert.notEqual(load.invalidated, true);
  f.connected(stale); f.failed(stale); await flush();
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
});

test('stale ceremony cleanup cannot close or clear a newer current channel', async () => {
  const f = fixture(); await f.initial(); await f.start(); const stale = f.channels[0];
  const current = { close() { this.closed = true; } }, pending = f.SAVE.pending = { operation: 'newer-owned-save' };
  f.NATIVE_PLAYER.channel = current;
  assert.equal(f.startupPending(), false); assert.equal(stale.closed, true);
  assert.equal(f.NATIVE_PLAYER.channel, current); assert.notEqual(current.closed, true); assert.equal(f.SAVE.pending, pending);
  f.connected(stale); f.failed(stale); await flush();
  assert.equal(f.NATIVE_PLAYER.channel, current); assert.notEqual(current.closed, true);
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0);
});

for (const [name, change] of staleChanges.slice(0, 6)) test('late verification after ' + name + ' changes cannot adopt or tear down state', async () => {
  const f = fixture({ holdVerification: true }); await f.initial(); await f.start(); f.connected();
  await until(() => f.counts.canonicalStatuses === 1); change(f); f.verification.resolve(); await flush();
  assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0); assert.equal(f.counts.reload, 0); assert.equal(f.counts.writes, 0);
});

const protectedChanges = [
  ['pending save', f => { f.SAVE.pending = { operation: 'retained' }; }],
  ['native write flight', f => { f.SAVE.nativeFlight = {}; }],
  ['final save', f => { f.SAVE.nativeFinal = {}; }],
  ['wiping', f => { f.SAVE.wiping = true; }],
  ['pending profile', f => { f.NATIVE_PLAYER.profile = { status: () => ({ pending: true }) }; }],
  ['active provisional', f => { f.sessionState.provisional = true; }],
  ['claim resume', f => { f.NATIVE_PLAYER.claimPendingResume = true; }],
  ['claim confirmation', f => { f.NATIVE_PLAYER.claimConfirmationPending = true; }],
  ['open-existing claim', f => { f.NATIVE_PLAYER.openExistingPending = true; }],
  ['claim conflict', f => { f.NATIVE_PLAYER.conflict = {}; }],
  ['play flight', f => { f.NATIVE_PLAYER.playFlight = {}; }],
];
for (const [name, change] of protectedChanges) test(name + ' forbids pre-game reload, adoption and teardown', async () => {
  const f = fixture(); await f.initial(); await f.start(); change(f); const pending = f.SAVE.pending;
  f.connected(); await flush();
  assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0); assert.equal(f.counts.reload, 0);
  assert.equal(f.NETWS.token, 'old-game-token'); assert.equal(f.NETWS.acct.id, 'transport-account');
  assert.equal(f.SAVE.pending, pending); assert.equal(f.counts.sessionCloses, 0);
  assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
});

for (const applied of [false, true]) test('a genuinely selected' + (applied ? ' and applied' : '') + ' private save retains idle reload fallback', async () => {
  const f = fixture({ holdOldStatus: true, initialCanonical: true }); const first = await f.initial(); await f.start();
  f.oldStatus.resolve(); await until(() => f.counts.oldReads === 1); f.oldPrivate.resolve(); await first.promise;
  if (applied) f.apply();
  assert.equal(f.SAVE.loaded.char.name, 'Previously selected character');
  f.connected(); await flush();
  assert.equal(f.counts.reload, 1); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reads, 0);
  assert.equal(f.SAVE.loaded.char.name, 'Previously selected character'); assert.equal(f.counts.writes, 0);
});

test('unknown held provisional proof and changed helper identity do not fabricate eligibility or reload', async () => {
  for (const changed of [false, true]) {
    const f = fixture({ holdPeek: !changed }); const first = await f.initial();
    if (!changed) await until(() => f.counts.peeks === 1);
    await f.start();
    if (changed) { f.NATIVE_PLAYER.provisional = { ...f.session }; f.NATIVE_PLAYER.provisionalContext = { host: f.NETWS.host, accountId: f.NETWS.acct.id }; }
    f.connected(); await flush();
    assert.equal(f.counts.reload, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0);
    if (!changed) { f.invalidate(first.load); f.oldPeek.resolve(null); await first.load.promise; }
  }
});

test('refusal object replacement invalidates an old retired-proof callback even when its labels match', async () => {
  const f = fixture({ refused: true }); await f.initial(); await f.start();
  f.NETWS.sessionRefusal = { ...f.NETWS.sessionRefusal }; f.connected(); f.failed(); await flush();
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0);
  assert.equal(f.NETWS.token, ''); assert.equal(f.counts.profiles, 0);
});

for (const patch of [{ verified: false }, { bound: false }, { provisional: true }]) test('unconfirmed authoritative status cannot change the original session: ' + JSON.stringify(patch), async () => {
  const f = fixture({ verifyPatch: patch }); await f.initial(); await f.start(); f.connected(); await flush();
  assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0); assert.equal(f.counts.reload, 0);
  assert.equal(f.NETWS.token, 'old-game-token'); assert.equal(f.SAVE.readConfirmed, false);
});

test('a changed fresh status binding is rejected before any other cached private profile is opened or applied', async () => {
  const f = fixture({ freshStatusMismatch: true, holdRead: false }); await f.initial(); await f.start(); f.connected(); await flush();
  assert.equal(f.counts.profiles, 0); assert.equal(f.counts.reads, 0); assert.equal(f.counts.worlds.length, 0);
  assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0);
});

test('a mismatched fresh socket welcome cannot open the notified private profile', async () => {
  const f = fixture({ welcomeMismatch: true }); await f.initial(); await f.start(); f.connected(); await flush();
  assert.equal(f.counts.profiles, 0); assert.equal(f.SAVE.loaded, null); assert.equal(f.SAVE.readConfirmed, false);
  assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0); assert.equal(f.counts.reload, 0);
});

test('a recoverable blocked private read releases handoff work only after Ready, retaining all entry/key/write gates', async () => {
  const f = fixture({ readFailure: true, missingKey: true }); await f.initial(); await f.start(); f.connected();
  await until(() => f.counts.reads === 1); f.read.resolve(); await flush();
  assert.equal(f.NATIVE_PLAYER.switching, true); assert.equal(f.SAVE.readConfirmed, false);
  f.GAME.ready = true; await f.advance(100);
  assert.equal(f.NATIVE_PLAYER.switching, false); assert.equal(f.SAVE.nativePaused, false);
  assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.SAVE.loaded, null); await f.begin();
  assert.equal(f.counts.entries, 0); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});

test('an actually empty confirmed private selection completes handoff without private effects or auto-entry', async () => {
  const f = fixture({ value: null }); await f.initial(); await f.start(); f.connected(); await until(() => f.counts.reads === 1);
  f.read.resolve(); await flush(); f.GAME.ready = true; await f.advance(100);
  assert.equal(f.NATIVE_PLAYER.switching, false); assert.equal(f.SAVE.nativePaused, false); assert.equal(f.SAVE.readConfirmed, true);
  assert.equal(f.SAVE.loaded, null); assert.equal(f.counts.entries, 0); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
  assert.equal(f.counts.settings.length, 0); assert.equal(f.counts.worlds.length, 0);
});

test('starting gameplay after a title ceremony cannot be redirected by its late notification', async () => {
  const f = fixture(); await f.initial(); await f.start(); f.GAME.started = true; f.connected(); await flush();
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0); assert.equal(f.counts.writes, 0);
});

test('an idle canonical missing-key read retains its deliberate reload fallback without pretending the character is absent', async () => {
  const f = fixture({ initialCanonical: true, missingKey: true, holdOldPrivate: false }); await f.initial();
  assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.SAVE.loaded, null);
  assert.equal(f.SAVE.ref.native, true); assert.notEqual(f.SAVE.ref.blocked, true); assert.equal(f.SAVE.loading.ref, f.SAVE.ref);
  await f.start(); f.connected(); await flush();
  assert.equal(f.counts.reload, 1); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reads, 0);
  assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});

test('a raw unknown profile is not positive selected-profile evidence for reload fallback', async () => {
  const f = fixture(); await f.initial(); await f.start(); f.NATIVE_PLAYER.profile = f.profile;
  f.connected(); await flush();
  assert.equal(f.counts.reload, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.profiles, 0);
  assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});

test('a malformed locally prepared ceremony cannot authorize a success or failure wake-up', async () => {
  const f = fixture({ invalidCeremony: true }); await f.initial(); await f.start(); f.connected(); f.failed(); await flush();
  assert.equal(f.counts.canonicalStatuses, 0); assert.equal(f.counts.retire, 0); assert.equal(f.counts.reload, 0);
});

test('an already-playing ceremony keeps the existing reconnect route and never adopts the title handoff', async () => {
  const f = fixture(); await f.initial(); f.GAME.ready = true; f.GAME.started = true; f.SAVE.readConfirmed = true;
  f.NATIVE_PLAYER.status = { ...canonical(), account: { id: 'transport-account' } }; f.NATIVE_PLAYER.profile = f.profile;
  f.context.recordReconnect = (expected, notification) => { f.counts.reconnects.push({ expected, notification }); };
  // Existing active-game workflow is separately tested with its real reauth/save
  // ports; this case observes only which unchanged route the listener chooses.
  vm.runInContext('nativePlayerReconnect=recordReconnect;', f.context);
  await f.start(); f.connected(f.channels[0], { accountId: 'transport-account' }); await flush();
  assert.equal(f.counts.reconnects.length, 1); const call = f.counts.reconnects[0];
  assert.equal(call.expected.profile, f.profile); assert.equal(call.expected.accountId, 'transport-account');
  assert.equal(call.expected.ownerDid, OWNER); assert.equal(call.expected.podUrl, POD);
  assert.equal(f.counts.reload, 0); assert.equal(f.counts.retire, 0); assert.equal(f.GAME.started, true);
});

test('graphics failure during a selected new read cannot admit gameplay or write/create a key', async () => {
  const f = fixture(); await f.initial(); await f.start(); f.connected(); await until(() => f.counts.reads === 1);
  f.read.resolve(); await flush(); f.GAME.ready = true; f.context.GRAPHICS_STARTUP.stopped = true; await f.advance(100);
  await f.begin(); assert.equal(f.counts.entries, 0); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});

test('a socket generation change before title hydration leaves a recoverable blocked connection instead of permanent switching', async () => {
  const f = fixture(); await f.initial(); await f.start(); f.connected(); await until(() => f.counts.reads === 1);
  f.read.resolve(); await flush(); assert.equal(f.NATIVE_PLAYER.switching, true);
  f.context.netWsRetire(f.NETWS.ws); await f.context.netLinkWS(); f.GAME.ready = true; await f.advance(100);
  assert.equal(f.NATIVE_PLAYER.switching, false); assert.equal(f.SAVE.nativePaused, false);
  assert.equal(f.counts.settings.length, 0); assert.equal(f.counts.worlds.length, 0, 'The stale title hook cannot apply its old private snapshot.');
  await f.begin(); assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0); assert.equal(f.counts.keys, 0);
  await f.retry(); assert.equal(f.SAVE.readConfirmed, true, 'The existing explicit retry is usable after retiring the stale handoff.');
  await f.start(); assert.equal(f.channels.length, 2, 'The owner can deliberately reconnect after the stale handoff.');
});

test('late stale hydration never clears a newer pending operation or its switching ownership', async () => {
  const f = fixture(); await f.initial(); await f.start(); f.connected(); await until(() => f.counts.reads === 1);
  f.read.resolve(); await flush(); const pending = { operation: 'newer-private-operation' };
  f.SAVE.pending = pending; f.context.netWsRetire(f.NETWS.ws); await f.context.netLinkWS(); f.GAME.ready = true; await f.advance(100);
  assert.equal(f.SAVE.pending, pending); assert.equal(f.NATIVE_PLAYER.switching, true);
  assert.equal(f.SAVE.nativePaused, true); assert.equal(f.counts.entries, 0); assert.equal(f.counts.writes, 0);
});

test('fresh sign-in keeps a positive canonical missing-key fallback captured before rotating the refused transport', async () => {
  const f = fixture({ initialCanonical: true, missingKey: true, holdOldPrivate: false, authFailureOnce: true });
  await f.initial(); await f.start(); assert(f.NATIVE_PLAYER.authRefusal);
  const profile = f.NATIVE_PLAYER.profile, ref = f.SAVE.ref;
  await f.start(true); assert.equal(f.counts.forgotten, 1); assert.equal(f.NETWS.acct.id, 'fresh-transport-account');
  f.connected(); await flush();
  assert.equal(f.counts.reload, 1); assert.equal(f.NATIVE_PLAYER.profile, profile); assert.equal(f.SAVE.ref, ref);
  assert.equal(f.counts.reads, 0); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});
