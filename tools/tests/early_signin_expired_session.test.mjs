/** Expired-session sign-in: actual save/transport/identity/UI, synthetic ports only. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { join } from 'node:path';
import vm from 'node:vm';
import { parse } from 'acorn';

const root = new URL('../../', import.meta.url);
const source = (name, before) => readFileSync(process.env.HM_EXPIRED_SOURCE_DIR
  ? join(process.env.HM_EXPIRED_SOURCE_DIR, before) : new URL('src/' + name, root), 'utf8');
const identity = source('14v_nativeidentity.js', 'pr93-before-14v_nativeidentity.js');
const transport = source('14p_netws.js', 'pr93-before-14p_netws.js');
const save = readFileSync(new URL('src/12_save.js', root), 'utf8').split('function graphicsSaveSettings()')[0];
const ui = readFileSync(new URL('src/10_ui.js', root), 'utf8');
const node = parse(ui, { ecmaVersion: 'latest' }).body.find(item => item.type === 'FunctionDeclaration' && item.id.name === 'titleEntryBlocked');
const guard = ui.slice(node.start, node.end);
const OLD = 'synthetic-expired-game-token', FRESH = 'synthetic-fresh-game-token', CANONICAL = 'synthetic-canonical-game-token';
const OWNER = 'did:example:synthetic-existing-owner', POD = 'https://pod.example/synthetic-existing-owner/';
const canonical = () => ({ enabled: true, bound: true, verified: true, account: { id: 'canonical-account' },
  binding: { userId: 'synthetic-existing-owner', subjectDid: OWNER, podUrl: POD }, recordLinks: {} });
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done; }); return { promise, resolve }; };
async function flush() { for (let n = 0; n < 25; n++) await Promise.resolve(); await new Promise(resolve => setImmediate(resolve)); }
async function until(predicate) { for (let n = 0; n < 45 && !predicate(); n++) await flush(); assert(predicate(), 'Actual source must reach its controlled protocol boundary.'); }

// The actual renderer runs against the same small DOM surface as the existing
// connected-identity unit tests. It is not replaced by a fixture UI/decision.
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = {}; this.style = {}; this.hidden = false; this.disabled = false; this._text = '';
    const classes = new Set();
    this.classList = { contains: value => classes.has(value), add: value => classes.add(value),
      toggle: (value, on) => { if (on) classes.add(value); else classes.delete(value); } };
    Object.defineProperty(this, 'className', { set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(item => classes.add(item)); },
      get: () => [...classes].join(' ') });
  }
  set innerHTML(_value) { throw Error('Identity UI may not use an HTML sink.'); }
  get textContent() { return this._text + this.children.map(child => child.textContent).join(''); }
  set textContent(value) { this._text = String(value); this.replaceChildren(); }
  appendChild(child) { child.parentElement = this; this.children.push(child); return child; }
  append(...children) { children.forEach(child => this.appendChild(child)); }
  prepend(child) { child.parentElement = this; this.children.unshift(child); }
  replaceChildren(...children) { this.children.forEach(child => { child.parentElement = null; }); this.children = []; children.forEach(child => this.appendChild(child)); }
  remove() { if (this.parentElement) { this.parentElement.children = this.parentElement.children.filter(child => child !== this); this.parentElement = null; } }
  setAttribute(name, value) { this.attributes[name] = String(value); }
  addEventListener() {}
  contains(node) { return node === this || this.children.some(child => child.contains(node)); }
  matches(selector) {
    const [tag, cls] = selector.split('.');
    return (!tag || this.tagName === tag.toUpperCase()) && (!cls || this.classList.contains(cls));
  }
  querySelectorAll(selector) { return this.children.flatMap(child => [...(child.matches(selector) ? [child] : []), ...child.querySelectorAll(selector)]); }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  focus() {}
}

function fixture(options = {}) {
  let now = 0, nextTimer = 0;
  const wall = Date.now(), timers = new Map(), sockets = [], channels = [], popups = [], store = new Map();
  const readGate = deferred(), peekGate = deferred(), statusGate = deferred(), verificationGate = deferred(), forgetGate = deferred(), startGate = deferred();
  const metadata = options.empty ? null : { ownerDid: 'did:example:retained-expired-device', podUrl: 'https://pod.example/retained-expired-device/', characterId: 'retained-expired-character',
    guestExpiresAt: wall - 1000, expired: true, claimedOwnerDid: null, targetAvailable: false, targetOwnerDid: null,
    claimStarted: false, lastConfirmedClaim: false, credentialExpiresAt: wall - 2000, gameAdmitted: true, ...options.metadata };
  const originalMetadata = JSON.stringify(metadata);
  const counts = { requests: [], packets: [], tokenRemoves: [], removedValues: [], tokenWrites: [], privateTokenReads: 0, privateTokenWrites: 0,
    intervals: 0, reload: 0, popup: 0, popupClosed: 0,
    starts: 0, entries: 0, writes: 0, keys: 0, archive: 0, claim: 0, resumes: 0, peeks: 0, reads: 0, statuses: 0, titles: 0, cacheDeletes: 0 };
  if (!options.anonymousBoot) store.set('hallowmarch.token.game.example', OLD);
  store.set('synthetic-native-cache', 'sealed-existing-access'); store.set('synthetic-character-key', 'retained-existing-key');
  const nodes = Object.fromEntries(['loading-identity', 'loading-sign-in', 'loading-identity-status', 'btn-begin', 'btn-continue', 'character-create-fields', 'save-note']
    .map(id => [id, new Element(id.startsWith('btn-') || id === 'loading-sign-in' ? 'button' : 'div')]));
  const dom = new Element('main'), target = new Element('div'); target.className = 'card-body'; dom.appendChild(target);
  Object.values(nodes).forEach(item => dom.appendChild(item));
  const document = { activeElement: null, createElement: tag => new Element(tag), getElementById: id => nodes[id] || null,
    querySelector: selector => selector === '#create .card-body' ? target : dom.querySelector(selector),
    querySelectorAll: selector => dom.querySelectorAll(selector) };
  class FixtureDate extends Date { static now() { return wall + now; } }
  const schedule = (fn, delay) => { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; };
  let context;
  class Socket {
    constructor() { this.readyState = 0; sockets.push(this); queueMicrotask(() => { this.readyState = 1; this.onopen?.(); }); }
    send(raw) {
      const packet = JSON.parse(raw); counts.packets.push(packet);
      if (packet.t !== 'hello') return;
      queueMicrotask(() => {
        if (packet.token === OLD && !options.welcomeOld) {
          this.message({ t: 'denied', why: 'Your sign-in expired.', code: 'native_signin_required' }); return;
        }
        if (!packet.token && options.freshWelcomeUnavailable) {
          this.message({ t: 'denied', why: 'Synthetic unavailable fresh connection', code: 'service_unavailable' }); return;
        }
        const token = packet.token === CANONICAL ? CANONICAL : packet.token === OLD ? OLD : FRESH;
        const account = token === CANONICAL ? 'canonical-account' : token === OLD ? 'old-account' : 'fresh-bootstrap-account';
        this.message({ t: 'welcome', peer: 'synthetic-peer', acct: { id: account, guest: true, nativeBound: token === CANONICAL,
          ...(token === FRESH ? options.freshAccount : {}) }, token });
      });
    }
    message(packet) { this.onmessage?.({ data: JSON.stringify(packet) }); }
    close(code = 1000, reason = '') { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code, reason }); }
  }
  const profileState = { pending: false, hasRecord: false, keyPresent: true };
  const profile = { status: () => ({ ...profileState }), close() {}, connect: async () => {},
    async get() { counts.reads++; await readGate.promise; return { exists: false }; },
    set() { counts.writes++; throw Error('No private write during sign-in.'); },
    delete() { counts.writes++; throw Error('No private delete during sign-in.'); },
    createKey() { counts.keys++; throw Error('No character key creation during sign-in.'); } };
  const sessions = [];
  const sessionStatus = () => ({ provisional: metadata !== null && !options.nonProvisional, pending: false,
    guestExpiresAt: metadata?.guestExpiresAt, ownerDid: metadata?.ownerDid, characterId: metadata?.characterId,
    claimStarted: metadata?.claimStarted, claim: metadata?.claim || null,
    ...options.sessionStatus });
  function makeSession() {
    const session = { status: sessionStatus,
      async peek() { counts.peeks++; if (options.holdPeek) await peekGate.promise; if (options.peekFailure) throw Error('Synthetic unreadable browser metadata'); return metadata === null ? null : structuredClone(metadata); },
      async resume() { counts.resumes++; throw Object.assign(Error('Synthetic expired temporary session'), { code: 'guest_expired' }); },
      close() { session.closed = true; }, profile: () => profile, claimProfile: () => null,
      archiveExpired() { counts.archive++; throw Error('Sign-in must not archive the retained character.'); },
      bootstrap() { counts.keys++; throw Error('Sign-in must not bootstrap a provisional owner.'); },
      useExistingTarget() { counts.claim++; throw Error('No character claim during sign-in.'); } };
    sessions.push(session); return session;
  }
  context = vm.createContext({ console, URL, URLSearchParams, structuredClone, crypto: webcrypto, Date: FixtureDate,
    performance: { now: () => now }, setTimeout: schedule, clearTimeout: id => timers.delete(id),
    setInterval() { counts.intervals++; return 1; }, clearInterval() {}, queueMicrotask, WebSocket: Socket,
    AbortSignal: { timeout: () => new AbortController().signal }, document, $: id => document.getElementById(id),
    location: { origin: 'https://game.example', search: '', reload() { counts.reload++; } },
    localStorage: { getItem(key) {
      // Another tab's canonical session arrives at the real fresh-opening read,
      // after the old-token removal checks but before hello resolves its token.
      if (options.raceCanonicalWelcome && key === 'hallowmarch.token.game.example' && !store.has(key)
        && counts.tokenRemoves.length && context.H.NETWS.state === 'opening') store.set(key, CANONICAL);
      return store.get(key) || null;
    },
      setItem(key, value) { counts.tokenWrites.push({ key, value }); store.set(key, value); },
      removeItem(key) { counts.tokenRemoves.push(key); counts.removedValues.push(store.get(key));
        if (options.forgetFailure) throw Error('Synthetic blocked game-token removal'); store.delete(key); } },
    BroadcastChannel: class { constructor(name) { this.name = name; channels.push(this); } close() { this.closed = true; } },
    window: { __hm: {}, __HM_NET_SERVER: 'wss://game.example/ws', open() {
      counts.popup++; const popupStore = new Map(); const popup = { closed: false, document,
        sessionStorage: { getItem: key => popupStore.get(key) || null, setItem: (key, value) => popupStore.set(key, value) },
        close() { popup.closed = true; counts.popupClosed++; }, location: { replace(url) { popup.destination = url; } } };
      popups.push(popup); return popup;
    } },
    GAME: { ready: false, started: false, player: null, built: false }, GRAPHICS_STARTUP: { stopped: false }, GRAPHICS_CONTEXT_LOST: false,
    UI: {}, REALMS: [], CLASSES: { warrior: {} }, LEVEL_CAP: 50, coreKey: JSON.stringify,
    NET: { state: 'alone', peers: new Map(), stats: {}, link: null }, NETUI: { open: false },
    netHumanLive: () => false, netStr: (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '',
    netNote() {}, netPeerLeft() {}, netWorldRead: value => value, netWorldTake() {}, uiLog() {}, uiToast() {},
    applySettings() {}, applyWorldSave() {}, setupTitle() { counts.titles++; },
    async startGame() { counts.entries++; },
    async fetch(targetUrl, init = {}) {
      const path = new URL(targetUrl, 'https://game.example').pathname, token = (init.headers?.Authorization || '').replace(/^Bearer /, '');
      counts.requests.push({ path, token, method: init.method || 'GET' });
      if (path === '/gaming/manifest') return { ok: true, status: 200,
        json: async () => ({ playerIdentity: { enabled: options.policyEnabled !== false, provisionalPlay: { enabled: true } } }) };
      if (path === '/gaming/identity/start') {
        counts.starts++;
        if (options.holdStart) await startGate.promise;
        if (token === OLD || options.start401) return { ok: false, status: 401, json: async () => ({ error: 'game_account_required' }) };
        assert.equal(token, FRESH); return { ok: true, json: async () => ({ browserCeremony: 'c'.repeat(43), authorizationUrl: 'https://identity.example/authorize' }) };
      }
      assert.equal(path, '/gaming/identity/status'); counts.statuses++;
      if (token === OLD || token === FRESH) {
        if (options.holdStatus) await statusGate.promise;
        if (options.status401) return { ok: false, status: 401, json: async () => ({ error: 'game_account_required' }) };
        return { ok: true, json: async () => ({ enabled: true, bound: false, verified: false, provisional: false,
          account: { id: token === OLD ? 'old-account' : 'fresh-bootstrap-account' },
          provisionalPlay: { enabled: true }, recordLinks: {}, ...options.statusPatch }) };
      }
      assert.equal(token, CANONICAL); if (options.holdVerification && counts.statuses === 1) await verificationGate.promise;
      return { ok: true, json: async () => canonical() };
    },
  });
  if (options.holdForget) context.window.claude = { use: async name => name === 'user' ? { id: async () => 'synthetic-user' }
    : { doc: () => ({ async get() { counts.privateTokenReads++; await forgetGate.promise;
      return { exists: true, data: () => ({ tokens: { 'game.example': OLD } }) }; },
    async set() { counts.privateTokenWrites++; throw Error('No private-token write is permitted by this fixture.'); } }) } };
  vm.runInContext(save + '\n' + transport + '\n' + guard + '\n' + identity + `
    globalThis.H = { SAVE, NETWS, NATIVE_PLAYER, loadSave, netWsOpen, netWsRetire,
      render: nativePlayerRender, renderEarly: nativePlayerRenderEarlySignIn,
      connectedIdentity: nativePlayerConnectedIdentity, startupPending: nativePlayerStartupPending,
      expiredChoice: () => typeof nativePlayerExpiredSignInChoice === 'function' ? nativePlayerExpiredSignInChoice() : null,
      clearEarlyPolicy() { NATIVE_PLAYER_EARLY_POLICY = null; nativePlayerClearEarlySignIn(); },
      connect: nativePlayerConnect, begin: () => nativePlayerBegin({name:'Synthetic recruit',realm:0,cls:'warrior',fresh:true}),
      invalidate: saveLoadInvalidate };
  `, context);
  context.makeFixtureSession = makeSession; context.fixtureProfile = profile;
  vm.runInContext(`nativePlayerProvisionalSession = async () => {
      if (NATIVE_PLAYER.provisional) return NATIVE_PLAYER.provisional;
      const session = makeFixtureSession(); NATIVE_PLAYER.provisional = session;
      NATIVE_PLAYER.provisionalContext = {host:NETWS.host,accountId:NETWS.acct?.id}; return session;
    };
    nativePlayerModules = async () => ({createPlayerPodProfile(){return fixtureProfile;}});
    NATIVE_PLAYER.cache = {list:async()=>[{ownerDid:'${OWNER}',podUrl:'${POD}',relayUrl:'https://relay.example'}],
      get:async()=>({credential:{accessToken:'sdk-only-synthetic-access'}}),
      delete:()=>{throw Error('Sign-in must not erase cached native access.')}};
  `, context);
  const H = context.H;
  return { H, context, counts, nodes, target, sessions, sockets, channels, popups, store, metadata, profileState,
    peekGate, readGate, statusGate, verificationGate, forgetGate, startGate,
    async initial() { const p = H.loadSave(); p.catch(() => {}); if (options.holdPeek || options.holdStatus) return p; await p; H.render(); return p; },
    async advance(ms) {
      const end = now + ms;
      for (;;) { let next; for (const [id, task] of timers) if (task.at <= end && (!next || task.at < next[1].at)) next = [id, task];
        if (!next) break; now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush(); }
      now = end; await flush();
    },
    async clickLoader() { nodes['loading-sign-in'].onclick(); await until(() => !H.NATIVE_PLAYER.busy); },
    primary() { return target.querySelector('button.primary'); },
    async clickPrimary() { this.primary().onclick(); await until(() => !H.NATIVE_PLAYER.busy); },
    connected() { store.set('hallowmarch.token.game.example', CANONICAL); channels.at(-1).onmessage({ data: {
      type: 'hallowmarch-native-connected', accountId: 'canonical-account', ownerDid: OWNER, podUrl: POD } }); },
    assertRetained() {
      assert.equal(JSON.stringify(metadata), originalMetadata); assert.equal(store.get('synthetic-native-cache'), 'sealed-existing-access');
      assert.equal(store.get('synthetic-character-key'), 'retained-existing-key'); assert.equal(counts.archive, 0); assert.equal(counts.claim, 0);
      assert.equal(counts.keys, 0); assert.equal(counts.writes, 0); assert.equal(counts.cacheDeletes, 0);
      assert(counts.tokenRemoves.every(key => key === 'hallowmarch.token.game.example'));
    },
  };
}

function assertNoGameplay(f) {
  assert.equal(f.context.GAME.started, false); assert.equal(f.counts.entries, 0); assert.equal(f.counts.intervals, 0);
  assert(f.counts.packets.every(packet => packet.t === 'hello'), 'No live-play, keepalive, activity or save message is admitted.');
  f.assertRetained();
}
async function knownExpired(options) {
  const f = fixture(options); await f.initial();
  if (!options?.anonymousBoot) assert.equal(f.H.NETWS.sessionRefusal?.code, 'native_signin_required');
  assert.equal(f.nodes['loading-sign-in'].disabled, false, 'A checked, idle, expired session must offer explicit existing-identity sign-in during world preparation.');
  return f;
}

test('an expired local session with an exact rejected socket offers explicit sign-in before world readiness without first causing a401', async () => {
  const f = await knownExpired();
  assert.equal(f.H.NETWS.state, 'off'); assert.equal(f.H.NETWS.acct, null); assert.equal(f.counts.statuses, 0);
  assert.equal(f.counts.starts, 0); assert.equal(f.sockets.length, 1); assert.equal(f.counts.tokenRemoves.length, 0);
  assert.doesNotMatch(f.nodes['loading-identity-status'].textContent, /checking sign-in options/i);
  await f.H.begin(); assertNoGameplay(f);
  await f.clickLoader(); assert.equal(f.counts.starts, 1, f.H.NATIVE_PLAYER.message); assert.equal(f.counts.popupClosed, 0);
  assert.equal(f.popups[0].destination, 'https://identity.example/authorize');
  assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [FRESH]);
  assert.deepEqual(f.counts.packets.map(packet => packet.token || null), [OLD, null]); assertNoGameplay(f);
});

test('the primary Open my saved character action takes the same fresh route for an expired rejected session', async () => {
  const f = await knownExpired(); f.context.GAME.ready = true; f.H.render();
  assert.equal(f.primary()?.textContent, 'Open my saved character'); assert.equal(f.primary()?.disabled, false);
  await f.clickPrimary(); assert.equal(f.counts.starts, 1, f.H.NATIVE_PLAYER.message); assert.equal(f.counts.popupClosed, 0);
  assert.equal(f.counts.requests.find(row => row.path === '/gaming/identity/start').token, FRESH); assertNoGameplay(f);
});

test('returning from a pending expired sign-in restores the new character choice without archiving the retained key', async () => {
  const f = await knownExpired(); f.context.GAME.ready = true; f.H.render();
  const action = label => f.target.querySelectorAll('button').find(button => button.textContent === label);
  assert.equal(action('Start a new character')?.disabled, false);
  await f.clickPrimary();
  assert.equal(action('Start a new character'), undefined);
  assert.equal(action('Back to character choices')?.disabled, false);
  action('Back to character choices').onclick();
  assert.equal(f.counts.popupClosed, 1);
  assert.equal(f.H.NATIVE_PLAYER.channel, null);
  assert.equal(action('Start a new character')?.disabled, false);
  assert.equal(f.store.get('hallowmarch.token.game.example'), FRESH);
  assert.equal(f.H.NATIVE_PLAYER.message, '');
  f.connected(); await flush();
  assert.equal(f.counts.reads, 0, 'An old authorization response cannot open a character after returning.');
  f.H.render();
  assert.equal(action('Start a new character'), undefined, 'A new account token blocks a fresh character reset.');
  assert.equal(f.store.get('hallowmarch.token.game.example'), CANONICAL);
  assertNoGameplay(f);
});

test('returning from an expired sign-in keeps a newer identity connection when its token already arrived', async () => {
  const f = await knownExpired(); f.context.GAME.ready = true; f.H.render();
  await f.clickPrimary();
  const back = f.target.querySelectorAll('button').find(button => button.textContent === 'Back to character choices');
  assert.equal(back?.disabled, false);
  f.store.set('hallowmarch.token.game.example', CANONICAL);
  back.onclick();
  assert.equal(f.counts.popupClosed, 0);
  assert.equal(f.H.NATIVE_PLAYER.channel, f.channels.at(-1));
  assert.match(f.H.NATIVE_PLAYER.message, /Reload to see your character choices/);
  assert.equal(f.store.get('hallowmarch.token.game.example'), CANONICAL);
  assertNoGameplay(f);
});

test('a reload with no game bearer and a retained expired device reuses its checked anonymous welcome for sign-in', async () => {
  const f = await knownExpired({ anonymousBoot: true });
  assert.equal(f.H.NETWS.sessionRefusal, null); assert.equal(f.H.NETWS.token, FRESH);
  assert.equal(f.counts.statuses, 1); assert.equal(f.counts.starts, 0); assert.equal(f.counts.tokenRemoves.length, 0);
  await f.clickLoader(); assert.equal(f.counts.starts, 1, f.H.NATIVE_PLAYER.message);
  assert.deepEqual(f.counts.packets.map(packet => packet.token || null), [null]);
  assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [FRESH]);
  assert.equal(f.counts.tokenRemoves.length, 0); f.connected(); await until(() => f.counts.reads === 1);
  f.readGate.resolve(); await until(() => f.H.SAVE.loading.settled && !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.H.NATIVE_PLAYER.switching, true); assert.equal(f.nodes['btn-begin'].disabled, true);
  f.context.GAME.ready = true; await f.advance(100); f.H.render();
  assert.equal(f.H.startupPending(), false); assert.equal(f.H.SAVE.readConfirmed, true);
  assert.equal(f.nodes['btn-begin'].disabled, false); assert.equal(f.counts.reload, 0); assertNoGameplay(f);
});

test('a canonical session arriving from another tab during fresh opening is never adopted as the anonymous sign-in bootstrap', async () => {
  const f = await knownExpired({ raceCanonicalWelcome: true }); await f.clickLoader();
  assert.deepEqual(f.counts.packets.map(packet => packet.token || null), [OLD, CANONICAL], 'The race reaches the actual fresh-opening token read and welcome.');
  assert.equal(f.H.NETWS.acct.id, 'canonical-account'); assert.equal(f.H.NETWS.acct.nativeBound, true);
  assert.equal(f.counts.starts, 0); assert.equal(f.counts.reads, 0); assert.equal(f.counts.reload, 0);
  assert.deepEqual(f.counts.removedValues, [OLD]); assert.equal(f.store.get('hallowmarch.token.game.example'), CANONICAL);
  assert.equal(f.H.NATIVE_PLAYER.switching, false); assertNoGameplay(f);
});

for (const [label, option] of [['token forgetting fails', 'forgetFailure'], ['fresh welcome is unavailable', 'freshWelcomeUnavailable']]) {
  test(label + ' releases only its own pre-ceremony switching latch and leaves a usable error', async () => {
    const f = await knownExpired({ [option]: true }); await f.clickLoader();
    assert.equal(f.H.NATIVE_PLAYER.busy, false); assert.equal(f.H.NATIVE_PLAYER.switching, false);
    assert.equal(f.counts.starts, 0); assert.equal(f.counts.reads, 0); assert.equal(f.counts.popupClosed, 1);
    assert(f.H.NATIVE_PLAYER.message.length > 0); assert.equal(f.H.SAVE.readConfirmed, false); assertNoGameplay(f);
    if (option === 'forgetFailure') assert.equal(f.store.get('hallowmarch.token.game.example'), OLD);
  });
}

test('an older failed token-forgetting operation cannot release a newer owner switching latch', async () => {
  const f = await knownExpired({ holdForget: true }); f.nodes['loading-sign-in'].onclick();
  await until(() => f.counts.privateTokenReads === 1); assert.equal(f.H.NATIVE_PLAYER.switching, true);
  f.H.NETWS.generation++; f.H.NETWS.acct = { id: 'newer-owner', guest: true, nativeBound: true };
  f.H.NETWS.token = 'newer-owner-token'; f.H.NATIVE_PLAYER.provisionalContext = { host: 'game.example', accountId: 'newer-owner' };
  f.forgetGate.resolve(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.H.NATIVE_PLAYER.switching, true); assert.equal(f.H.NETWS.token, 'newer-owner-token');
  assert.equal(f.H.NETWS.acct.id, 'newer-owner'); assert.equal(f.counts.privateTokenWrites, 0);
  assert.equal(f.counts.tokenRemoves.length, 0); assert.equal(f.counts.starts, 0); assertNoGameplay(f);
});

for (const [label, options] of [
  ['non-anonymous welcome', { freshAccount: { guest: false } }],
  ['native-bound welcome', { freshAccount: { nativeBound: true } }],
  ['missing original status enabled', { statusPatch: { enabled: undefined } }],
  ['foreign status account', { statusPatch: { account: { id: 'foreign-account' } } }],
  ['provisional status', { statusPatch: { provisional: true } }],
]) test('anonymous reload with ' + label + ' cannot promote an expired-session action', async () => {
  const f = fixture({ anonymousBoot: true, ...options }); await f.initial();
  assert.equal(f.H.expiredChoice(), null); assert.equal(f.nodes['loading-sign-in'].disabled, true);
  assert.equal(f.counts.starts, 0); assert.equal(f.counts.tokenRemoves.length, 0); assertNoGameplay(f);
});

test('a canonical unverified account with old claimed expired metadata keeps its ordinary existing-account sign-in', async () => {
  const f = fixture({ anonymousBoot: true, nonProvisional: true, metadata: { claimedOwnerDid: OWNER },
    freshAccount: { id: 'canonical-unverified-account', guest: true, nativeBound: true },
    statusPatch: { bound: true, verified: false, provisional: false, account: { id: 'canonical-unverified-account' } } });
  await f.initial(); assert.equal(f.H.expiredChoice(), null); assert.equal(f.counts.reads, 0);
  f.context.GAME.ready = true; f.H.render();
  const existing = f.primary() || f.target.querySelectorAll('button').find(button => /Reconnect identity|I already have an identity|Open my saved character/.test(button.textContent));
  assert(existing, 'The accepted canonical account must retain an explicit existing-identity action.');
  existing.onclick(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.counts.starts, 1, f.H.NATIVE_PLAYER.message);
  assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [FRESH]);
  assert.equal(f.counts.tokenRemoves.length, 0); assert.equal(f.counts.packets.length, 1);
  assert.equal(f.popups[0].destination, 'https://identity.example/authorize'); assert.equal(f.counts.popupClosed, 0); assertNoGameplay(f);
});

test('successful fresh sign-in from an expired retained session verifies the canonical owner and preserves warmed-world readiness', async () => {
  const f = await knownExpired(); await f.clickLoader(); f.connected();
  await until(() => f.counts.reads === 1); assert.equal(f.H.NETWS.acct.id, 'canonical-account');
  assert.equal(f.counts.statuses, 2, 'Notification is followed by canonical HTTP proof, new welcome, and fresh status binding.');
  assert.equal(f.counts.reload, 0); assert.equal(f.H.NATIVE_PLAYER.switching, true); assert.equal(f.nodes['btn-begin'].disabled, true);
  await f.H.begin(); assertNoGameplay(f); f.readGate.resolve();
  await until(() => f.H.SAVE.loading.settled && !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.NATIVE_PLAYER.switching, true);
  assert.equal(f.nodes['btn-begin'].disabled, true); assert.equal(f.counts.reload, 0); assertNoGameplay(f);
  f.context.GAME.ready = true; await f.advance(100); f.H.render();
  assert.equal(f.H.startupPending(), false); assert.equal(f.H.NATIVE_PLAYER.switching, false);
  assert.equal(f.H.SAVE.nativePaused, false); assert.equal(f.H.SAVE.readConfirmed, true); assert.equal(f.H.SAVE.loading.invalidated, false);
  assert.equal(f.nodes['btn-begin'].disabled, false); assert.equal(f.counts.reload, 0); assert.equal(f.counts.titles, 1);
  assert(f.counts.requests.every(row => row.token !== 'sdk-only-synthetic-access')); assertNoGameplay(f);
});

test('restarting the pending expired-session popup reuses only its fresh game session and the old callback cannot select an owner', async () => {
  const f = await knownExpired(); await f.clickLoader(); const oldChannel = f.channels.at(-1);
  const removals = f.counts.tokenRemoves.length, hellos = f.counts.packets.length;
  assert.match(f.nodes['loading-sign-in'].textContent, /restart sign-in/i);
  await f.clickLoader(); assert.equal(f.counts.starts, 2); assert.equal(f.counts.packets.length, hellos);
  assert.equal(f.counts.tokenRemoves.length, removals); assert.equal(oldChannel.closed, true);
  assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [FRESH, FRESH]);
  oldChannel.onmessage({ data: { type: 'hallowmarch-native-connected', accountId: 'canonical-account', ownerDid: OWNER, podUrl: POD } });
  await flush(); assert.equal(f.counts.reads, 0); assert.equal(f.counts.statuses, 0);
  f.connected(); await until(() => f.counts.reads === 1); assertNoGameplay(f);
});

test('the canonical handoff after expired-session sign-in survives its own normal title idle close', async () => {
  const f = await knownExpired(); await f.clickLoader(); f.connected(); await until(() => f.counts.reads === 1);
  f.readGate.resolve(); await until(() => f.H.SAVE.loading.settled && !f.H.NATIVE_PLAYER.busy);
  f.sockets.at(-1).close(4000, 'Human play not started'); await flush();
  assert.equal(f.H.NETWS.state, 'off'); assert.equal(f.H.startupPending(), true); assert.equal(f.H.SAVE.readConfirmed, true);
  assert.equal(f.nodes['btn-begin'].disabled, true); assertNoGameplay(f);
  f.context.GAME.ready = true; await f.advance(100); f.H.render();
  assert.equal(f.H.startupPending(), false); assert.equal(f.H.NATIVE_PLAYER.switching, false); assert.equal(f.nodes['btn-begin'].disabled, false);
  assert.equal(f.counts.reload, 0); assertNoGameplay(f);
});

for (const [label, options] of [
  ['claimed owner', { metadata: { claimedOwnerDid: OWNER } }],
  ['existing target', { metadata: { targetAvailable: true, targetOwnerDid: OWNER } }],
  ['started claim', { metadata: { claimStarted: true }, sessionStatus: { claimStarted: true } }],
  ['pending claim', { sessionStatus: { claim: { targetAvailable: true }, pending: true } }],
  ['unexpired metadata', { metadata: { expired: false, guestExpiresAt: Date.now() + 86400000 } }],
  ['unreadable metadata', { peekFailure: true }],
  ['disabled policy', { policyEnabled: false }],
]) test(label + ' cannot become an expired-session bypass', async () => {
  const f = fixture(options); await f.initial(); assert.equal(f.H.expiredChoice(), null);
  assert.equal(f.nodes['loading-sign-in'].disabled, true); assert.equal(f.counts.starts, 0); assert.equal(f.counts.tokenRemoves.length, 0);
  assertNoGameplay(f);
});

for (const [label, change] of [
  ['host', f => { f.H.NETWS.host = 'other.example'; }],
  ['game token', f => { f.H.NETWS.token = 'changed-token'; }],
  ['stored game token', f => { f.store.set('hallowmarch.token.game.example', 'other-tab-token'); }],
  ['account', f => { f.H.NETWS.acct = { id: 'other-account' }; }],
  ['generation', f => { f.H.NETWS.generation++; }],
  ['load', f => { f.H.SAVE.loading = { active: true, settled: true }; }],
  ['invalidated load', f => { f.H.invalidate(); }],
  ['pending private save', f => { f.H.SAVE.pending = {}; }],
  ['in-flight private save', f => { f.H.SAVE.nativeFlight = {}; }],
  ['read-confirmed character', f => { f.H.SAVE.readConfirmed = true; }],
  ['applied private world', f => { f.H.SAVE.privateApplied = true; }],
  ['selected character', f => { f.H.SAVE.loaded = { v: 1, char: { name: 'Retained selected character' } }; }],
  ['pending claim', f => { f.H.NATIVE_PLAYER.claimPendingResume = true; }],
  ['started game', f => { f.context.GAME.started = true; }],
]) test('a captured expired-session loader action rechecks ' + label + ' before opening or forgetting anything', async () => {
  const f = await knownExpired(); const click = f.nodes['loading-sign-in'].onclick; change(f); click(); await flush();
  assert.equal(f.counts.starts, 0); assert.equal(f.counts.popup, 0); assert.equal(f.counts.tokenRemoves.length, 0);
  assert.equal(f.sockets.length, 1); f.assertRetained();
});

test('metadata that changes after the popup opens cannot promote a claim or select another owner on notification', async () => {
  const f = await knownExpired(); await f.clickLoader(); f.metadata.targetAvailable = true; f.metadata.targetOwnerDid = OWNER;
  f.connected(); await flush(); await flush();
  assert.equal(f.counts.reads, 0); assert.equal(f.counts.reload, 0); assert.equal(f.H.SAVE.readConfirmed, false);
  assert.equal(f.counts.claim, 0); assert.equal(f.counts.archive, 0); assert.equal(f.counts.keys, 0); assert.equal(f.counts.writes, 0);
});

test('metadata that changes before the explicit click is re-peeked before the refused game bearer can be forgotten', async () => {
  const f = await knownExpired(); const clicked = f.nodes['loading-sign-in'].onclick;
  f.metadata.targetAvailable = true; f.metadata.targetOwnerDid = OWNER; clicked(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.counts.tokenRemoves.length, 0); assert.equal(f.counts.starts, 0); assert.equal(f.sockets.length, 1);
  assert.equal(f.counts.reads, 0); assert.equal(f.counts.archive, 0); assert.equal(f.counts.claim, 0); assert.equal(f.counts.writes, 0);
});

test('a current status401 is shown as an explicit fresh-sign-in route, with no automatic guest fallback', async () => {
  const f = fixture({ welcomeOld: true, status401: true, empty: true, nonProvisional: true }); await f.initial();
  assert.equal(f.counts.statuses, 1); assert.equal(f.counts.starts, 0); assert.equal(f.sockets.length, 1);
  assert.equal(f.nodes['loading-sign-in'].disabled, false); assert.doesNotMatch(f.nodes['loading-identity-status'].textContent, /checking sign-in options/i);
  f.context.GAME.ready = true; f.H.render(); assert.match(f.primary()?.textContent || '', /fresh sign-in|sign in again/i);
  await f.clickPrimary(); assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [FRESH]);
  assertNoGameplay(f);
});

test('after an actual start401 the primary action does not repeatedly repost the rejected game bearer', async () => {
  const f = fixture({ welcomeOld: true, empty: true, nonProvisional: true }); await f.initial();
  f.context.GAME.ready = true; f.H.render();
  const existing = f.target.querySelectorAll('button').find(button => button.textContent === 'I already have an identity');
  assert(existing, 'Use the actual existing-identity action while Play now is still available.'); existing.onclick(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [OLD]);
  assert.match(f.primary()?.textContent || '', /fresh sign-in|sign in again/i); assert.equal(f.sockets.length, 1);
  await f.clickPrimary(); assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [OLD, FRESH]);
  assert.equal(f.counts.starts, 2); assertNoGameplay(f);
});

test('a reused title component without early policy still turns a current start401 into an explicit fresh-sign-in action', async () => {
  const f = fixture({ welcomeOld: true, empty: true, nonProvisional: true }); await f.initial();
  // The title/Players identity component is also used outside the boot-time
  // manifest observer. It retains a genuine current socket/session and HTTP
  // refusal; that must not fabricate early policy or strand ordinary recovery.
  f.H.clearEarlyPolicy(); f.H.SAVE.loading = null; f.context.GAME.ready = true; f.H.render();
  const existing = f.target.querySelectorAll('button').find(button => button.textContent === 'I already have an identity');
  assert(existing); existing.onclick(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.counts.starts, 1); assert.equal(f.H.NATIVE_PLAYER.authRefusal?.token, OLD);
  assert.match(f.primary()?.textContent || '', /fresh sign-in|sign in again/i);
  assert.equal(f.nodes['loading-sign-in'].disabled, true, 'Ordinary title recovery cannot invent an early-loading policy.');
  assert.equal(f.store.get('hallowmarch.token.game.example'), OLD); assert.equal(f.counts.tokenRemoves.length, 0);
  assert.equal(f.sockets.length, 1); assertNoGameplay(f);
  await f.clickPrimary(); assert.deepEqual(f.counts.requests.filter(row => row.path === '/gaming/identity/start').map(row => row.token), [OLD, FRESH]);
  assert.equal(f.counts.starts, 2); assertNoGameplay(f);
});

for (const [label, change] of [
  ['host', f => { f.H.NETWS.host = 'different.example'; }],
  ['token', f => { f.H.NETWS.token = 'different-game-token'; }],
  ['generation', f => { f.H.NETWS.generation++; }],
  ['load', f => { f.H.SAVE.loading = { active: true, settled: true }; }],
  ['channel', f => { f.H.NATIVE_PLAYER.channel = { close() {} }; }],
]) test('a reused title start401 without early policy cannot offer fresh recovery after its ' + label + ' changes', async () => {
  const f = fixture({ welcomeOld: true, empty: true, nonProvisional: true, holdStart: true }); await f.initial();
  f.H.clearEarlyPolicy(); f.H.SAVE.loading = null; f.context.GAME.ready = true; f.H.render();
  const existing = f.target.querySelectorAll('button').find(button => button.textContent === 'I already have an identity');
  assert(existing); existing.onclick(); await until(() => f.counts.starts === 1);
  change(f); f.startGate.resolve(); await until(() => !f.H.NATIVE_PLAYER.busy);
  assert.equal(f.H.NATIVE_PLAYER.authRefusal, null); assert.equal(f.counts.tokenRemoves.length, 0); assert.equal(f.sockets.length, 1);
  assert.equal(f.nodes['loading-sign-in'].disabled, true); assertNoGameplay(f);
});
