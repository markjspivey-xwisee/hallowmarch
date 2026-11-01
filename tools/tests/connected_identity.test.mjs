/** Actual shipping identity renderer, synthetic DOM/state only. No browser or ports. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parse } from 'acorn';

const source = readFileSync(new URL('../../src/14v_nativeidentity.js', import.meta.url), 'utf8');
const transport = readFileSync(new URL('../../src/14p_netws.js', import.meta.url), 'utf8');
function actual(code, names) {
  return parse(code, { ecmaVersion: 'latest' }).body.filter(node =>
    node.type === 'FunctionDeclaration' && names.includes(node.id.name)
    || node.type === 'VariableDeclaration' && node.declarations.some(item => names.includes(item.id.name)))
    .map(node => code.slice(node.start, node.end)).join('\n');
}
class Element {
  constructor(tag) {
    this.tagName = tag.toUpperCase(); this.children = []; this.parentElement = null;
    this.dataset = {}; this.attributes = {}; this.style = {}; this.open = false; this.hidden = false; this._text = '';
    const classes = new Set();
    this.classList = { contains: value => classes.has(value), add: value => classes.add(value),
      toggle: (value, on) => { if (on) classes.add(value); else classes.delete(value); } };
    Object.defineProperty(this, 'className', { set: value => { classes.clear(); value.split(/\s+/).filter(Boolean).forEach(item => classes.add(item)); }, get: () => [...classes].join(' ') });
  }
  set innerHTML(_value) { throw Error('The owner identity must never enter an HTML sink.'); }
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
const OWNER = 'u-pk-synthetic-owner';
const DID = 'did:web:identity.example:users:' + OWNER;
const VERIFIED = '2026-10-31T12:34:56.000Z';
function status(patch = {}) {
  return { enabled: true, bound: true, verified: true, account: { id: 'march-participation-only', name: 'Game name', guest: false },
    binding: { userId: OWNER, subjectDid: DID, verifiedAt: VERIFIED, podUrl: 'http://css.railway.internal/private-owner/',
      accessToken: 'private-native-token-must-not-render', privateKey: 'private-key-must-not-render' }, ...patch };
}
function fixture() {
  const root = new Element('div'), target = new Element('div'); target.className = 'card-body'; root.appendChild(target);
  const effects = { fetch: 0, auth: 0, key: 0, save: 0, hooks: 0 }, nodes = {};
  const document = { activeElement: null, createElement: tag => new Element(tag),
    querySelector: selector => selector === '#create .card-body' ? target : root.querySelector(selector),
    querySelectorAll: selector => root.querySelectorAll(selector) };
  const context = vm.createContext({ document, console, Date, URL, JSON, Number,
    NETWS: { host: 'march.example', acct: { id: 'march-participation-only' }, token: 'private-game-token-must-not-render', generation: 7,
      state: 'on', ws: { readyState: 1 }, closed: false, reload: false },
    NATIVE_PLAYER: { status: null, state: 'key_required', profile: { status: () => ({ hasRecord: true, keyPresent: false, pending: false }) },
      busy: false, switching: false, message: '', recoveryOpen: false, authRefusal: null },
    GAME: { ready: true, started: false }, SAVE: { native: true, readConfirmed: false, loaded: null, pending: null }, UI: {},
    $: id => nodes[id] || null,
    nativePlayerIsProvisional: () => false, nativePlayerGuestExpired: () => false, nativePlayerCanPlayNow: () => false,
    nativePlayerNewAdventureAllowed: () => false, nativePlayerFreshAllowed: () => false, nativePlayerExpiredAdventureAllowed: () => false,
    nativePlayerSaveMessage: () => 'Restore your recovery file to open this private character.',
    nativePlayerCheckRecovery: () => effects.fetch++, nativePlayerFindRetainedKey: () => effects.key++,
    nativePlayerConnect: () => effects.auth++, nativePlayerRetryLoad: () => effects.fetch++,
    fetch: () => { effects.fetch++; throw Error('No network in this display.'); },
    localStorage: { getItem: () => { throw Error('No storage in this display.'); } },
    saveNow: () => { effects.save++; },
  });
  vm.runInContext(actual(source, ['NATIVE_PLAYER_CONNECTED_IDENTITY', 'NATIVE_PLAYER_CONNECTED_IDENTITY_EPOCH', 'nativePlayerConnectedIdentityContext',
    'nativePlayerConnectedIdentityValues', 'nativePlayerConnectedIdentityCurrent',
    'nativePlayerRememberConnectedIdentity', 'nativePlayerClearConnectedIdentity', 'nativePlayerConnectedIdentity',
    'nativePlayerRenderConnectedIdentity', 'nativePlayerRender']) + '\n'
    + actual(transport, ['netWsClearIdentityDisplay']) + '\n'
    + 'globalThis.render=nativePlayerRender;globalThis.capture=()=>typeof nativePlayerConnectedIdentityContext===\'function\'?nativePlayerConnectedIdentityContext():{};'
    + 'globalThis.accept=(value,scope)=>{NATIVE_PLAYER.status=value;if(typeof nativePlayerRememberConnectedIdentity===\'function\')nativePlayerRememberConnectedIdentity(value,scope);};'
    + 'globalThis.clear=()=>{if(typeof nativePlayerClearConnectedIdentity===\'function\')nativePlayerClearConnectedIdentity();};'
    + 'globalThis.guard=()=>typeof nativePlayerConnectedIdentity===\'function\'?nativePlayerConnectedIdentity():null;', context);
  return { context, root, target, effects, accept(value = status(), scope = context.capture()) { context.accept(value, scope); },
    render() { context.render(); }, panel() { return root.querySelector('.native-connected-identity'); } };
}

test('accepted current identity renders a discoverable collapsed public account panel without private fields or new actions', () => {
  const f = fixture(); f.accept(); f.render(); const panel = f.panel();
  assert(panel, 'The ordinary game UI must reveal which canonical Interego account is connected.');
  assert.equal(panel.open, false); assert.equal(panel.querySelector('summary').textContent, 'Connected identity');
  assert.match(panel.textContent, /Interego account ID/); assert(panel.textContent.includes(OWNER)); assert(panel.textContent.includes(DID));
  assert.match(panel.textContent, /Identity record verified/); assert(panel.textContent.includes(VERIFIED));
  assert.doesNotMatch(panel.textContent, /private-|css\.railway\.internal|march-participation-only|Game name/);
  assert.deepEqual(f.effects, { fetch: 0, auth: 0, key: 0, save: 0, hooks: 0 });
});

test('a verified-looking status without an accepted response stamp is not public evidence', () => {
  const f = fixture(); f.context.NATIVE_PLAYER.status = status(); f.render(); assert.equal(f.panel(), null);
});

test('missing or malicious identity fields never render HTML, private pod addresses or fallback account guesses', () => {
  for (const patch of [{ userId: undefined }, { userId: '' }, { subjectDid: undefined }, { userId: '<img src=x onerror=alert(1)>' },
    { subjectDid: 'did:example:<script>alert(1)</script>' }, { subjectDid: 'did:example:null\u0000byte' }]) {
    const f = fixture(), value = status(); Object.assign(value.binding, patch); f.accept(value); f.render();
    assert.equal(f.panel(), null); assert.equal(f.root.querySelector('script'), null); assert.equal(f.root.querySelector('img'), null);
    assert.doesNotMatch(f.root.textContent, /private-|css\.railway\.internal|march-participation-only/);
  }
});

test('historical verification time is optional and never becomes a guessed sign-in time or expiry', () => {
  for (const time of [undefined, 'not-a-time', '<img src=x>', '2026-10-31']) {
    const f = fixture(), value = status(); value.binding.verifiedAt = time; f.accept(value); f.render();
    assert(f.panel()); assert(!f.panel().textContent.includes('Identity record verified')); assert(!f.panel().textContent.includes(String(time)));
  }
  const f = fixture(), value = status(); value.binding.verifiedAt = '2001-01-01T00:00:00.000Z'; f.accept(value); f.render();
  assert(f.panel().textContent.includes('2001-01-01T00:00:00.000Z'), 'Fresh accepted status can refer to a historically verified identity record.');
  assert.match(f.panel().textContent, /historical, not the time of this sign-in/);
});

test('disconnect, refusal, expiry and changed connection ownership remove old public details and cannot resurrect them', () => {
  const changes = [c => { c.NETWS.state = 'off'; }, c => { c.NETWS.ws.readyState = 3; }, c => { c.NETWS.closed = true; },
    c => { c.NETWS.reload = true; }, c => { c.NETWS.host = 'another-march.example'; }, c => { c.NETWS.acct.id = 'other-game-account'; },
    c => { c.NETWS.generation++; }, c => { c.NETWS.token = 'another-private-token'; },
    c => { c.NATIVE_PLAYER.authRefusal = { reason: 'native_owner_mismatch' }; }, c => { c.NATIVE_PLAYER.expiredAdventure = {}; },
    c => { c.NATIVE_PLAYER.state = 'native_signin_required'; }, c => { c.NATIVE_PLAYER.status.verified = false; }];
  for (const change of changes) {
    const f = fixture(); f.accept(); f.render(); assert(f.panel()); change(f.context); f.context.guard(); assert.equal(f.panel(), null);
    assert.equal(f.context.guard(), null); assert.equal(f.effects.fetch, 0); assert.equal(f.effects.auth, 0); assert.equal(f.effects.save, 0);
  }
});

test('pending display is hidden during busy/switching work without changing saves or accepting a different owner', () => {
  for (const flag of ['busy', 'switching']) {
    const f = fixture(); f.accept(); f.render(); f.context.NATIVE_PLAYER[flag] = true; f.render(); assert.equal(f.panel(), null);
    f.context.NATIVE_PLAYER[flag] = false; f.render(); assert(f.panel()); assert.equal(f.effects.save, 0);
  }
});

test('stale status response after a same-participation-ID host, token or generation switch is refused', () => {
  for (const change of [c => { c.NETWS.host = 'other-host.example'; }, c => { c.NETWS.token = 'new-private-token'; }, c => { c.NETWS.generation++; }]) {
    const f = fixture(), scope = f.context.capture(); change(f.context); f.accept(status(), scope); f.render(); assert.equal(f.panel(), null);
  }
});

test('explicit invalidation rejects an earlier in-flight response even when all connection labels stay the same', () => {
  const f = fixture(), scope = f.context.capture(); f.context.clear(); f.accept(status(), scope); f.render(); assert.equal(f.panel(), null);
  f.accept(); f.render(); assert(f.panel(), 'A genuinely later accepted response may reveal the same owner.');
});

test('clearing then accepting identical values rebuilds the panel rather than trusting a stale render cache', () => {
  const f = fixture(), value = status(); f.accept(value); f.render(); assert(f.panel());
  f.context.clear(); assert.equal(f.panel(), null); f.accept(value); f.render(); assert(f.panel());
});

test('owner changes cannot reuse old metadata and a new accepted owner begins collapsed', () => {
  const f = fixture(); f.accept(); f.render(); f.panel().open = true;
  f.context.NATIVE_PLAYER.message = 'A separate character check'; f.render(); assert.equal(f.panel().open, true);
  const next = status(); next.binding = { ...next.binding, userId: OWNER + '-next', subjectDid: DID + '-next' };
  f.context.NATIVE_PLAYER.status = next; f.render(); assert.equal(f.panel(), null, 'An unstamped replacement never inherits an older proof.');
  f.accept(next); f.render(); assert(f.panel()); assert.equal(f.panel().open, false); assert(f.panel().textContent.includes(OWNER + '-next'));
  const original = status(); f.accept(original); original.binding.subjectDid += '-mutated-after-accept'; f.render(); assert.equal(f.panel(), null);
});

function transportFixture(f) {
  Object.assign(f.context, { NET: { peers: new Map(), state: 'alone' }, netWsPendingFail: () => { f.effects.hooks++; },
    netWsRetryLater: () => { f.effects.hooks++; }, netPeerLeft: () => assert.fail('No peer is present'),
    netStr: value => typeof value === 'string' ? value : '', netWsAdmissionStatus: () => null,
    setTimeout: () => 1, clearTimeout() {}, clearInterval() {}, netWsStartHumanPing() {}, netNote() {} });
  f.context.NETWS.stats = { drops: 0 }; f.context.NETWS.url = 'wss://march.example';
  vm.runInContext(actual(transport, ['netWsRetire', 'netWsAdmissionUpdate']), f.context);
}

test('actual transport retirement removes visible identity immediately and preserves the original retirement effects', () => {
  for (const hook of ['normal', 'throws', 'absent']) {
    const f = fixture(); transportFixture(f); f.accept(); f.render(); const ws = f.context.NETWS.ws, generation = f.context.NETWS.generation;
    const originalStatus = f.context.NATIVE_PLAYER.status;
    if (hook !== 'normal') vm.runInContext('nativePlayerClearConnectedIdentity=' + (hook === 'throws' ? '()=>{throw Error("synthetic UI failure")}' : 'undefined'), f.context);
    assert.equal(f.context.netWsRetire(ws, 'synthetic disconnect'), true);
    assert.equal(f.context.NETWS.generation, generation + 1); assert.equal(f.context.NETWS.state, 'off'); assert.equal(f.context.NETWS.ws, null);
    assert.equal(f.context.NETWS.stats.drops, 1); assert.equal(f.effects.hooks, 2); assert.equal(f.context.NATIVE_PLAYER.status, originalStatus);
    if (hook === 'normal') assert.equal(f.panel(), null);
  }
});

test('only an actual identity-required admission invalidates the account display and any pre-refusal read', () => {
  const f = fixture(); transportFixture(f); f.accept(); f.render(); const scope = f.context.capture();
  f.context.netWsAdmissionUpdate({ admission: 'identity-required', code: 'wrong-code' }); assert(f.panel());
  f.context.netWsAdmissionUpdate({ admission: 'standby', code: 'human_play_required' }); assert(f.panel());
  f.context.netWsAdmissionUpdate({ admission: 'identity-required', code: 'native_signin_required' }); assert.equal(f.panel(), null);
  f.context.NETWS.liveAdmission = null; f.accept(status(), scope); f.render(); assert.equal(f.panel(), null, 'A later flag reset does not revive the pre-refusal response.');
  f.accept(); f.render(); assert(f.panel());
});

test('actual open and socket-close callbacks invalidate display without a real socket, timer or network', async () => {
  const f = fixture(); transportFixture(f); let socket;
  f.context.WebSocket = class { constructor() { socket = this; this.readyState = 0; } close() { this.readyState = 3; } };
  vm.runInContext(actual(transport, ['netWsOpen']), f.context);
  f.accept(); f.render(); f.context.NETWS.state = 'off';
  const opening = f.context.netWsOpen(); assert.equal(f.panel(), null); assert(socket);
  socket.readyState = 1; f.context.NETWS.state = 'on'; f.accept(); f.render(); assert(f.panel());
  socket.onclose({ code: 1000, reason: 'synthetic' }); assert.equal(f.panel(), null); assert.equal(await opening, false);
  assert.equal(f.effects.fetch, 0); assert.equal(f.effects.auth, 0);
});

test('actual explicit link close clears details even though the old socket callback is retired', async () => {
  const f = fixture(); transportFixture(f); f.context.WebSocket = function () { throw Error('No real socket may be constructed.'); };
  f.context.netWsOpen = async () => true;
  vm.runInContext(actual(transport, ['netLinkWS']), f.context);
  const link = await f.context.netLinkWS('wss://march.example'); assert(link); f.context.NET.link = link;
  f.accept(); f.render(); assert(f.panel()); link.close(); assert.equal(f.panel(), null);
  assert.equal(f.context.NETWS.closed, true); assert.equal(f.context.NETWS.state, 'off'); assert.equal(f.context.NETWS.link, null);
});

test('actual ordinary startup accepts only the status read bound to its original current connection', async () => {
  for (const mode of ['current', 'host-switched', 'token-switched', 'refused']) {
    const f = fixture(); let finish, began; const reading = new Promise(resolve => { began = resolve; });
    const response = new Promise(resolve => { finish = resolve; }); const value = status();
    f.context.AbortSignal = { timeout: () => ({}) };
    f.context.netServerUrl = () => 'wss://march.example/'; f.context.netLinkWS = async () => true;
    f.context.nativePlayerError = (code, message) => Object.assign(new Error(message), { code });
    f.context.fetch = async () => { f.effects.fetch++; return { status: 200, ok: true, json: async () => ({ playerIdentity: {} }) }; };
    f.context.nativePlayerRequest = async () => { f.effects.fetch++; began(); return response; };
    const profile = { status: () => ({ hasRecord: true, keyPresent: false, pending: false }), close() {},
      connect: async () => { f.context.NATIVE_PLAYER.state = 'key_required'; }, get: async () => null };
    f.context.NATIVE_PLAYER.cache = { list: async () => [{ ownerDid: DID, podUrl: value.binding.podUrl, relayUrl: 'https://relay.example' }],
      get: async () => ({ credential: { accessToken: 'synthetic-never-rendered' } }) };
    f.context.nativePlayerModules = async () => ({ createPlayerPodProfile: () => profile });
    vm.runInContext(actual(source, ['nativePlayerSaveRef']), f.context);
    const pending = f.context.nativePlayerSaveRef(); await reading;
    f.render(); assert.equal(f.panel(), null, 'Ordinary renders during a pending read do not invent evidence.');
    if (mode === 'host-switched') f.context.NETWS.host = 'other-host.example';
    if (mode === 'token-switched') f.context.NETWS.token = 'different-private-game-token';
    if (mode === 'refused') f.context.clear();
    finish(value); const ref = await pending;
    if (ref && !ref.blocked) await ref.get();
    f.render(); assert.equal(!!f.panel(), mode === 'current');
    assert.equal(f.effects.fetch, 2, 'The display adds no request to the existing manifest/status reads.');
    assert.equal(f.effects.save, 0); assert.equal(f.effects.auth, 0); assert.equal(f.effects.key, 0);
  }
});

test('actual active-game reconnect never promotes a pre-rebind status into new display evidence', async () => {
  for (const invalidateWhileHeld of [false, true]) {
    const f = fixture(); transportFixture(f); f.accept(); f.render(); const oldStatus = f.context.NATIVE_PLAYER.status;
    const profile = f.context.NATIVE_PLAYER.profile; let reauthenticated = 0, release, began;
    const held = new Promise(resolve => { release = resolve; }), rebindBegan = new Promise(resolve => { began = resolve; });
    profile.reauthenticate = async () => { reauthenticated++; };
    f.context.GAME.started = true; f.context.SAVE.chain = Promise.resolve(); f.context.SAVE.readConfirmed = true;
    f.context.localStorage = { getItem: () => 'synthetic-rebound-game-token' };
    f.context.nativePlayerError = (code, message) => Object.assign(new Error(message), { code });
    const refreshed = status();
    f.context.nativePlayerRequest = async () => { f.effects.fetch++; return refreshed; };
    f.context.nativePlayerModules = async () => {};
    f.context.NATIVE_PLAYER.cache = { list: async () => [{ ownerDid: DID, podUrl: oldStatus.binding.podUrl, relayUrl: 'https://relay.example' }],
      get: async () => ({ credential: { accessToken: 'synthetic-private-reauthentication-credential' } }) };
    f.context.withTimeout = promise => promise;
    f.context.netLinkWS = async () => {
      f.context.NETWS.generation++; f.context.netWsClearIdentityDisplay(); began(); await held;
      f.context.NETWS.state = 'on'; f.context.NETWS.ws = { readyState: 1 }; return true;
    };
    vm.runInContext(actual(source, ['nativePlayerReconnect']), f.context);
    const expected = { accountId: f.context.NETWS.acct.id, host: f.context.NETWS.host, ownerDid: DID, podUrl: oldStatus.binding.podUrl, profile };
    const pending = f.context.nativePlayerReconnect(expected, { accountId: expected.accountId }); await rebindBegan;
    assert.equal(f.panel(), null); if (invalidateWhileHeld) f.context.clear(); release(); await pending;
    assert.equal(f.panel(), null, 'The pre-rebind snapshot is never relabelled with a newer display epoch.');
    assert.equal(reauthenticated, 1); assert.equal(f.effects.fetch, 1); assert.equal(f.effects.save, 1, 'Existing reconnect keeps its original final save.');
    assert.equal(f.context.NATIVE_PLAYER.status, refreshed); assert.equal(f.context.SAVE.nativePaused, false);
    f.accept(refreshed); f.render(); assert(f.panel(), 'A separately accepted current-connection status can show the panel.');
  }
});
