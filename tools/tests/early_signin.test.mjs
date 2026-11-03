/** Loading identity controls: actual shipping DOM/source, synthetic offline account only. */
/* global __early */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { parse } from 'acorn';
import { chromium } from '../node_modules/playwright/index.mjs';

const shell = readFileSync(new URL('../../src/page.html', import.meta.url), 'utf8');
const sourceFile = name => process.env.HM_EXPIRED_SOURCE_DIR
  ? join(process.env.HM_EXPIRED_SOURCE_DIR, 'pr93-before-' + name) : new URL('../../src/' + name, import.meta.url);
const identity = readFileSync(sourceFile('14v_nativeidentity.js'), 'utf8');
const save = readFileSync(new URL('../../src/12_save.js', import.meta.url), 'utf8').split('function graphicsSaveSettings()')[0];
const transport = readFileSync(sourceFile('14p_netws.js'), 'utf8');
const ui = readFileSync(new URL('../../src/10_ui.js', import.meta.url), 'utf8');
function declarations(source, select) {
  return parse(source, { ecmaVersion: 'latest' }).body.filter(select).map(node => source.slice(node.start, node.end)).join('\n');
}
// Real helper bodies and their private state, including new declarations. The
// only replaced functions below are synthetic network/profile/action ports.
const nativeCode = declarations(identity, node => node.type === 'FunctionDeclaration'
  || node.type === 'VariableDeclaration' && node.declarations.some(item => item.id.name.startsWith('NATIVE_PLAYER') || item.id.name === 'nativePlayerError'));
// Keep the real save-generation/selection guards used by Connect. SAVE itself
// is the fixture's controlled state; no selector or cancellation helper is stubbed.
const saveCode = declarations(save, node => node.type === 'FunctionDeclaration'
  || node.type === 'VariableDeclaration' && node.declarations.every(item => item.id.name !== 'SAVE'));
const guardCode = declarations(ui, node => node.type === 'FunctionDeclaration' && node.id.name === 'titleEntryBlocked');
const transportHook = declarations(transport, node => node.type === 'FunctionDeclaration'
  && ['netWsClearIdentityDisplay', 'netWsAdmissionUpdate', 'netWsAdmissionStatus'].includes(node.id.name));
let browser;
test.before(async () => { browser = await chromium.launch({
  ...(process.env.HM_EARLY_SIGNIN_BROWSER_CHANNEL ? { channel: process.env.HM_EARLY_SIGNIN_BROWSER_CHANNEL } : {}),
  headless: true, args: ['--disable-gpu'],
}); });
test.after(async () => { await browser?.close(); });

async function fixture(t) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, serviceWorkers: 'block', offline: true });
  t.after(() => context.close());
  const page = await context.newPage();
  page.setDefaultTimeout(5000);
  const requests = [];
  await page.route('**/*', route => {
    requests.push({ method: route.request().method(), url: route.request().url() });
    if (route.request().url() === 'http://hm-early.test/' && route.request().method() === 'GET') {
      return route.fulfill({ contentType: 'text/html', headers: {
        'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src 'none'; connect-src 'none'; frame-src 'none'; form-action 'none'",
      }, body: shell });
    }
    return route.abort();
  });
  await page.goto('http://hm-early.test/', { waitUntil: 'domcontentloaded' });
  return { page, requests };
}

async function accountFixture(t, options = {}) {
  const f = await fixture(t);
  // This script executes in the disposable document only. No real socket,
  // native SDK, credential, key, owner browser storage or auth flow exists.
  await f.page.evaluate(`window.__early = (() => { const options = ${JSON.stringify(options)};
      ${guardCode}\n${saveCode}\n${nativeCode}\n${transportHook}\n
      const calls = { fetch: [], request: [], link: 0, peek: 0, auth: [], write: 0, key: 0, settled: 0, popup: 0, token: 0, start: 0, entry: 0, retries: 0 };
      const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
      const manifest = deferred(), status = deferred(), metadata = deferred(), authorization = deferred();
      const $ = id => document.getElementById(id);
      const GAME = { ready: false, started: false };
      const GRAPHICS_STARTUP = { stopped: false };
      let GRAPHICS_CONTEXT_LOST = false;
      const NETWS = { host: 'march.example', acct: { id: 'synthetic-game-account' }, token: 'synthetic-game-token', generation: 7,
        state: 'on', ws: { readyState: 1 }, closed: false, reload: false, liveAdmission: null };
      if (options.anonymous) NETWS.acct = { id: 'synthetic-game-account', guest: true, nativeBound: false };
      if (options.refused) { NETWS.acct = null; NETWS.token = ''; NETWS.state = 'off'; NETWS.ws = null;
        NETWS.sessionRefusal = { code: 'native_signin_required', host: NETWS.host, token: 'synthetic-retired-proof', generation: NETWS.generation }; }
      const SAVE = { native: false, backend: 'local', readConfirmed: false, loaded: null, loading: null,
        pending: null, nativeFlight: null, ref: null };
      const UI = {}, REALMS = [], CLASSES = {};
      const startGame = async () => { calls.entry++; };
      const crypto = { randomUUID: () => '00000000-0000-4000-8000-000000000001' };
      const BroadcastChannel = class { close() {} };
      const netStr = (value, limit) => typeof value === 'string' ? value.slice(0, limit) : '';
      const netWsToken = async () => { calls.token++; return 'synthetic-retired-proof'; };
      const popupStore = new Map();
      window.open = () => { calls.popup++; return { sessionStorage: { getItem: key => popupStore.get(key) || null,
        setItem: (key, value) => popupStore.set(key, value) }, close() {}, location: { replace() {} } }; };
      const netServerUrl = () => options.server === undefined ? 'wss://march.example/ws' : options.server;
      const netLinkWS = async () => { calls.link++; return !options.refused && options.socket !== false; };
      const fetch = async target => { calls.fetch.push(new URL(target).pathname); await manifest.promise;
        return { ok: options.manifestStatus !== 503, status: options.manifestStatus || 200, json: async () => options.manifest || { playerIdentity: { enabled: true, provisionalPlay: { enabled: true } } } }; };
      nativePlayerRequest = async path => { calls.request.push(path); if (path === '/gaming/identity/start') { calls.start++; return authorization.promise; } return status.promise; };
      const actualConnect = nativePlayerConnect;
      nativePlayerConnect = fresh => { calls.auth.push({ fresh }); };
      const profile = { status: () => ({ hasRecord: true, keyPresent: false, pending: false }),
        set: async () => { calls.write++; throw Error('No private write in this fixture.'); } };
      const session = { status: () => options.expired ? { provisional: true, pending: false, guestExpiresAt: options.expired,
        ownerDid: 'did:example:retained-temporary-owner', characterId: 'retained-character', claimStarted: false, claim: null }
        : { provisional: false }, peek: async () => { calls.peek++; return metadata.promise; },
        resume: async () => { throw Error('No temporary character may be resumed by this fixture.'); }, profile: () => options.expired ? null : profile, claimProfile: () => null };
      nativePlayerProvisionalSession = async () => { NATIVE_PLAYER.provisional = session;
        NATIVE_PLAYER.provisionalContext = { host: NETWS.host, accountId: NETWS.acct?.id }; return session; };
      nativePlayerModules = async () => { throw Error('No SDK or private key may be opened by this fixture.'); };
      const initialization = { active: true, settled: false }; SAVE.loading = initialization;
      let result, finished;
      const start = () => { finished = nativePlayerSaveRef(initialization).then(value => { result = value; initialization.settled = true; calls.settled++; }); initialization.promise = finished; };
      return { GAME, SAVE, NETWS, NATIVE_PLAYER, GRAPHICS_STARTUP, initialization, calls,
        start, releaseManifest: () => manifest.resolve(), releaseStatus: value => status.resolve(value), rejectStatus: () => status.reject(Error('synthetic status unavailable')),
        releaseMetadata: value => metadata.resolve(value), result: () => result, finish: () => finished,
        render: () => { if (typeof nativePlayerRenderEarlySignIn === 'function') nativePlayerRenderEarlySignIn(); },
        useRetryProbe: () => { loadSave = async options => { if (options.retry === true) calls.retries++; };
          nativePlayerTask = async operation => operation(); },
        clear: () => netWsClearIdentityDisplay(), refuse: () => netWsAdmissionUpdate({ admission: 'identity-required', code: 'native_signin_required' }),
        loseGraphics: () => { GRAPHICS_CONTEXT_LOST = true; }, actualConnect: () => actualConnect(false),
        attemptBegin: () => nativePlayerBegin({ name: 'Synthetic recruit', realm: 0, cls: 'warrior', fresh: true }),
        failAuthorization: () => authorization.reject(Object.assign(Error('synthetic refusal'), { httpStatus: 401, code: 'game_account_required' })),
        completeAuthorization: () => authorization.resolve({ browserCeremony: 'a'.repeat(43), authorizationUrl: 'https://identity.invalid/authorize' }),
        mismatchNotification: () => NATIVE_PLAYER.channel.onmessage({ data: { type: 'hallowmarch-native-failed', host: NETWS.host,
          browserCeremony: 'a'.repeat(43), error: 'native_owner_mismatch' } }) };
    })()`);
  return f;
}

const unbound = () => ({ enabled: true, bound: false, verified: false, provisional: false, account: { id: 'synthetic-game-account' },
  provisionalPlay: { enabled: true }, recordLinks: {} });

async function acceptStatus(page, value = unbound()) {
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.request.length === 1);
  await page.evaluate(value => __early.releaseStatus(value), value);
  await page.waitForFunction(() => __early.calls.peek === 1 || __early.calls.settled === 1);
}

test('the public loading shell exposes disabled sign-in before any world or graphics module runs', async t => {
  const { page, requests } = await fixture(t);
  assert.equal(await page.locator('#loading').isVisible(), true);
  assert.equal(await page.locator('#loading .inner #loading-identity').count(), 1,
    'The first parsed loading DOM must contain a sign-in section, before world/graphics preparation.');
  const button = page.locator('#loading-sign-in');
  assert.equal(await button.isVisible(), true);
  assert.equal(await button.isDisabled(), true, 'No identity action is admitted before the existing server policy/status reads.');
  assert.equal(await button.getAttribute('type'), 'button');
  assert.match(await page.locator('#loading-identity-status').innerText(), /prepar|check|connect|sign.in/i);
  assert.equal(await page.locator('#title').isVisible(), false);
  assert.equal(await page.locator('#btn-begin').isVisible(), false);
  assert.equal(await page.locator('#btn-continue').isVisible(), false);
  assert.equal(await page.evaluate(() => !!window.__hm), false, 'The isolated DOM check has not executed the game or GPU.');
  assert.deepEqual(requests.filter(request => request.method !== 'GET'), []);
});

test('accepted live policy and status allow explicit sign-in while private load and graphics remain unfinished', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  const button = page.locator('#loading-sign-in');
  assert.equal(await button.count(), 1, 'Sign-in must be available in the loader, rather than behind private profile/world preparation.');
  assert.equal(await button.isEnabled(), true, 'The accepted live unbound account may sign in before private metadata finishes.');
  await page.evaluate(() => {
    assertNoGameEntry();
    function assertNoGameEntry() {
      if (__early.GAME.ready || __early.GAME.started || __early.SAVE.readConfirmed || __early.SAVE.loaded !== null
        || __early.initialization.settled) throw Error('The fixture must hold the actual private load and world readiness.');
    }
  });
  assert.equal(await page.locator('#btn-begin').isVisible(), false);
  assert.equal(await page.locator('#btn-continue').isVisible(), false);
  await page.evaluate(() => __early.attemptBegin());
  assert.equal(await page.evaluate(() => __early.calls.entry), 0, 'The original realm-entry guard remains closed while graphics are unfinished.');
  assert.doesNotMatch(await page.locator('#loading-identity-status').innerText(), /no (saved )?character|new character|empty (save|pod)|character (is )?absent/i);
  await button.click();
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: false }]);
  assert.deepEqual(await page.evaluate(() => ({ fetch: __early.calls.fetch, request: __early.calls.request,
    write: __early.calls.write, key: __early.calls.key })),
  { fetch: ['/gaming/manifest'], request: ['/gaming/identity/status'], write: 0, key: 0 });
  await page.evaluate(() => __early.releaseMetadata(null));
  await page.evaluate(() => __early.finish());
});

test('failed identity offers a scoped connection retry without enabling authentication or selecting a character', async t => {
  const { page } = await accountFixture(t);
  await page.evaluate(() => __early.start());
  assert.equal(await page.locator('#loading-sign-in').isDisabled(), true);
  assert.deepEqual(await page.evaluate(() => __early.calls.request), []);
  await page.evaluate(() => __early.releaseManifest());
  await page.waitForFunction(() => __early.calls.request.length === 1);
  assert.equal(await page.locator('#loading-sign-in').isDisabled(), true, 'A public manifest is not accepted account status.');
  await page.evaluate(() => __early.rejectStatus());
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').innerText(), 'Retry sign-in check');
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), true);
  assert.doesNotMatch(await page.locator('#loading-identity-status').innerText(), /no (saved )?character|new character|empty (save|pod)|character (is )?absent/i);
  assert.equal(await page.evaluate(() => __early.SAVE.readConfirmed), false);
  assert.equal(await page.evaluate(() => __early.SAVE.loaded), null);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  await page.evaluate(() => __early.useRetryProbe());
  await page.locator('#loading-sign-in').click();
  assert.equal(await page.evaluate(() => __early.calls.retries), 1);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  // A captured retry cannot operate after its initialization is replaced.
  await page.evaluate(() => { __early.SAVE.loading = { active:true, settled:true, identityError:true }; });
  await page.locator('#loading-sign-in').click();
  assert.equal(await page.evaluate(() => __early.calls.retries), 1);
});

for (const [name, options] of [
  ['serverless local', { server: '' }],
  ['legacy hosted', { manifest: {} }],
  ['native policy disabled', { manifest: { playerIdentity: { enabled: false } } }],
  ['native policy missing explicit enabled', { manifest: { playerIdentity: {} } }],
  ['native policy is an array', { manifest: { playerIdentity: [] } }],
  ['failed public policy', { manifestStatus: 503 }],
  ['unconnected game socket', { socket: false }],
]) test(name + ' cannot acquire early identity authority', async t => {
  const { page } = await accountFixture(t, options);
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); __early.releaseStatus({ enabled: true, bound: false, verified: false,
    account: { id: 'synthetic-game-account' } }); __early.releaseMetadata(null); });
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  const retriable = options.manifestStatus === 503 || options.socket === false;
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), retriable);
  if (retriable) assert.equal(await page.locator('#loading-sign-in').innerText(), 'Retry sign-in check');
  if (!retriable) await page.evaluate(() => document.getElementById('loading-sign-in')?.onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  assert.equal(await page.evaluate(() => __early.calls.write), 0);
});

const connectionChanges = [
  ['account', "__early.NETWS.acct.id = 'another-account'"],
  ['host', "__early.NETWS.host = 'another-game.example'"],
  ['token', "__early.NETWS.token = 'another-synthetic-token'"],
  ['generation', '__early.NETWS.generation++'],
  ['closed socket', '__early.NETWS.ws.readyState = 3'],
  ['off connection', "__early.NETWS.state = 'off'"],
  ['reload', '__early.NETWS.reload = true'],
  ['closed connection', '__early.NETWS.closed = true'],
  ['cancelled initialization', '__early.initialization.active = false'],
  ['replaced initialization', '__early.SAVE.loading = { active: true, settled: false }'],
  ['identity-required then cleared', "__early.refuse(); __early.NETWS.liveAdmission = null"],
];

for (const [name, change] of connectionChanges) test('status arriving after ' + name + ' cannot reveal or operate early sign-in', async t => {
  const { page } = await accountFixture(t);
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.request.length === 1);
  await page.evaluate(change);
  await page.evaluate(value => { __early.releaseStatus(value); __early.releaseMetadata(null); }, unbound());
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => document.getElementById('loading-sign-in')?.onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  assert.equal(await page.evaluate(() => __early.SAVE.readConfirmed), false);
  assert.equal(await page.evaluate(() => __early.calls.write), 0);
});

for (const [name, change] of [
  ...connectionChanges,
  ['busy native work', '__early.NATIVE_PLAYER.busy = true'],
  ['account switching', '__early.NATIVE_PLAYER.switching = true'],
  ['pending private write', '__early.SAVE.pending = {}'],
  ['in-flight private write', '__early.SAVE.nativeFlight = {}'],
  ['pending claim', '__early.NATIVE_PLAYER.claimConfirmationPending = true'],
  ['pending claim resume', '__early.NATIVE_PLAYER.claimPendingResume = true'],
  ['provisional active character', '__early.NATIVE_PLAYER.status.provisional = true'],
  ['graphics failure', '__early.GRAPHICS_STARTUP.stopped = true'],
  ['lost graphics context', '__early.loseGraphics()'],
  ['finished graphics', '__early.GAME.ready = true'],
  ['entered game', '__early.GAME.started = true'],
  ['replaced status object', '__early.NATIVE_PLAYER.status = { ...__early.NATIVE_PLAYER.status }'],
]) test('captured click rechecks ' + name + ' before calling the existing sign-in action', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), true);
  await page.evaluate(() => { __early.capturedClick = document.getElementById('loading-sign-in').onclick; });
  await page.evaluate(change);
  await page.evaluate(() => __early.capturedClick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [], 'A previously enabled handler is not authority after its context changes.');
  assert.equal(await page.evaluate(() => __early.calls.write), 0);
  await page.evaluate(() => { __early.releaseMetadata(null); __early.render(); });
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
});

test('an already accepted anonymous session can sign in with retained expired metadata after a reload', async t => {
  const expiry = Date.now() - 60000;
  const { page } = await accountFixture(t, { anonymous: true, expired: expiry });
  await acceptStatus(page);
  await page.evaluate(value => __early.releaseMetadata(value), expiredMetadata(expiry));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), true);
  assert.equal(await page.evaluate(() => __early.GAME.ready), false);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  await page.locator('#loading-sign-in').click();
  await page.waitForFunction(() => __early.calls.auth.length === 1);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: false }], 'The accepted anonymous session is reused for explicit sign-in.');
  assert.equal(await page.evaluate(() => __early.calls.write + __early.calls.key + __early.calls.entry), 0);
});

for (const [name, patch] of [
  ['disabled original status', { enabled: false }],
  ['missing original enabled', { enabled: undefined }],
  ['foreign account', { account: { id: 'another-game-account' } }],
  ['missing account', { account: undefined }],
  ['missing account identifier', { account: {} }],
]) test(name + ' cannot be promoted by the forced-enabled UI copy', async t => {
  const { page } = await accountFixture(t);
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.request.length === 1);
  await page.evaluate(value => { __early.releaseStatus(value); __early.releaseMetadata(null); }, { ...unbound(), ...patch });
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => document.getElementById('loading-sign-in').onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
});

test('a real retired-session refusal and empty metadata permit sign-in proof without a live bearer or character creation', async t => {
  const { page } = await accountFixture(t, { refused: true });
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); __early.releaseMetadata(null); });
  await page.evaluate(() => __early.finish());
  await page.waitForFunction(() => !document.getElementById('loading-sign-in').disabled);
  assert.equal(await page.evaluate(() => __early.NETWS.token), '');
  assert.equal(await page.evaluate(() => __early.NETWS.acct), null);
  assert.equal(await page.evaluate(() => __early.NETWS.state), 'off');
  assert.equal(await page.evaluate(() => __early.SAVE.readConfirmed), false);
  assert.equal(await page.evaluate(() => __early.SAVE.loaded), null);
  await page.locator('#loading-sign-in').click();
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: false }]);
  assert.deepEqual(await page.evaluate(() => ({ request: __early.calls.request, fetch: __early.calls.fetch,
    peek: __early.calls.peek, token: __early.calls.token, key: __early.calls.key, write: __early.calls.write })),
  { request: [], fetch: ['/gaming/manifest'], peek: 1, token: 1, key: 0, write: 0 });
  assert.equal(await page.locator('#btn-begin').isVisible(), false);
  assert.equal(await page.locator('#btn-continue').isVisible(), false);
});

const expiredMetadata = guestExpiresAt => ({
  ownerDid: 'did:example:retained-temporary-owner', podUrl: 'https://pod.example/retained/',
  guestExpiresAt, characterId: 'retained-character', credentialExpiresAt: guestExpiresAt,
  claimedOwnerDid: null, expired: true, gameAdmitted: true, targetAvailable: false, targetOwnerDid: null,
  lastConfirmedClaim: false, claimStarted: false,
});

test('a retained expired temporary session offers explicit sign-in in the real loading DOM without waiting for the world', async t => {
  const expiry = Date.now() - 60000;
  const { page } = await accountFixture(t, { refused: true, expired: expiry });
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.peek === 1);
  await page.evaluate(value => __early.releaseMetadata(value), expiredMetadata(expiry));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  const button = page.locator('#loading-sign-in');
  assert.equal(await button.isVisible(), true);
  assert.equal(await button.isEnabled(), true, 'Expired retained metadata must not permanently strand the loader action.');
  assert((await button.evaluate(node => node.getBoundingClientRect().height)) >= 44);
  assert.equal(await page.evaluate(() => __early.GAME.ready), false);
  assert.equal(await page.evaluate(() => __early.SAVE.readConfirmed), false);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [], 'Discovery never authenticates or replaces a session automatically.');
  await button.click();
  await page.waitForFunction(() => __early.calls.auth.length === 1);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: true }]);
  assert.equal(await page.evaluate(() => __early.calls.write + __early.calls.key + __early.calls.entry), 0);
});

for (const [name, patch] of [
  ['pending character claim', { claimStarted: true }],
  ['unknown retained owner', { ownerDid: null }],
]) test(name + ' cannot be treated as the safe expired sign-in choice in the real loading DOM', async t => {
  const expiry = Date.now() - 60000;
  const { page } = await accountFixture(t, { refused: true, expired: expiry });
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.peek === 1);
  await page.evaluate(value => __early.releaseMetadata(value), { ...expiredMetadata(expiry), ...patch });
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => document.getElementById('loading-sign-in').onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  assert.equal(await page.evaluate(() => __early.calls.write + __early.calls.key + __early.calls.entry), 0);
});

test('clearing a real refusal proof cannot re-attest the old choice under a fresh display epoch', async t => {
  const { page } = await accountFixture(t, { refused: true });
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); __early.releaseMetadata(null); });
  await page.evaluate(() => __early.finish());
  await page.waitForFunction(() => !document.getElementById('loading-sign-in').disabled);
  await page.evaluate(() => { __early.capturedClick = document.getElementById('loading-sign-in').onclick; __early.clear(); __early.render(); });
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => { __early.capturedClick(); document.getElementById('loading-sign-in').onclick?.(); });
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
});

test('invalidation while real refusal metadata is pending cannot stamp it after labels are restored', async t => {
  const { page } = await accountFixture(t, { refused: true });
  await page.evaluate(() => { __early.start(); __early.releaseManifest(); });
  await page.waitForFunction(() => __early.calls.peek === 1);
  await page.evaluate(() => { __early.clear(); __early.releaseMetadata(null); });
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => document.getElementById('loading-sign-in').onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  assert.equal(await page.evaluate(() => __early.NETWS.token), '');
});

test('an actual failed sign-in POST offers an explicit fresh sign-in and never retries itself', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  await page.evaluate(() => __early.releaseMetadata(null));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.actualConnect());
  await page.waitForFunction(() => __early.calls.start === 1);
  await page.evaluate(() => __early.failAuthorization());
  await page.waitForFunction(() => !__early.NATIVE_PLAYER.busy && !!__early.NATIVE_PLAYER.authRefusal);
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), true);
  assert.equal(await page.locator('#loading-sign-in').innerText(), 'Start a fresh sign-in');
  assert.equal(await page.evaluate(() => __early.calls.start), 1);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  await page.locator('#loading-sign-in').click();
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: true }]);
  assert.equal(await page.evaluate(() => __early.calls.start), 1, 'The early button delegates the established action rather than adding a retry.');
});

for (const [name, change] of [
  ['token changes', "__early.NETWS.token = 'another-synthetic-token'"],
  ['host changes', "__early.NETWS.host = 'another-game.example'"],
  ['account changes', "__early.NETWS.acct.id = 'another-account'"],
  ['generation changes', '__early.NETWS.generation++'],
  ['display invalidation', '__early.clear()'],
  ['initialization replacement', '__early.SAVE.loading = { active: true, settled: true }'],
]) test('a late actual 401 after ' + name + ' does not create a fresh early action', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  await page.evaluate(() => __early.releaseMetadata(null));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.actualConnect());
  await page.waitForFunction(() => __early.calls.start === 1);
  await page.evaluate(change);
  await page.evaluate(() => __early.failAuthorization());
  await page.waitForFunction(() => !__early.NATIVE_PLAYER.busy);
  await page.evaluate(() => __early.render());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
  await page.evaluate(() => document.getElementById('loading-sign-in').onclick?.());
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
});

test('a validated existing owner-mismatch channel reply preserves the different-account choice', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  await page.evaluate(() => __early.releaseMetadata(null));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.actualConnect());
  await page.waitForFunction(() => __early.calls.start === 1);
  await page.evaluate(() => __early.completeAuthorization());
  await page.waitForFunction(() => !__early.NATIVE_PLAYER.busy);
  await page.evaluate(() => __early.mismatchNotification());
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), true);
  assert.equal(await page.locator('#loading-sign-in').innerText(), 'Sign in with a different account');
  await page.locator('#loading-sign-in').click();
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: true }]);
});

test('canonical connected identity is acknowledged during loading only from current accepted evidence', async t => {
  const { page } = await accountFixture(t);
  const value = { enabled: true, bound: true, verified: true, account: { id: 'synthetic-game-account' },
    binding: { userId: 'u-synthetic-owner', subjectDid: 'did:example:synthetic-owner', verifiedAt: '2026-11-01T12:00:00.000Z',
      podUrl: 'http://css.railway.internal/synthetic-owner/' }, recordLinks: {} };
  await acceptStatus(page, value);
  assert.equal(await page.locator('#loading-identity-status').innerText(), 'Your identity is connected. Your world is still loading.');
  assert.equal(await page.locator('#loading-sign-in').innerText(), 'Reconnect identity');
  assert.equal(await page.evaluate(() => __early.SAVE.readConfirmed), false);
  assert.equal(await page.locator('#btn-continue').isVisible(), false);
  assert.doesNotMatch(await page.locator('#loading-identity').innerText(), /synthetic-owner|did:|css\.railway\.internal/);
  await page.evaluate(() => { __early.NETWS.token = 'another-synthetic-token'; __early.render(); });
  assert.doesNotMatch(await page.locator('#loading-identity-status').innerText(), /identity is connected/i);
  assert.equal(await page.locator('#loading-sign-in').isEnabled(), false);
});

test('a pending existing sign-in window has honest restart guidance without an automatic retry', async t => {
  const { page } = await accountFixture(t);
  await acceptStatus(page);
  await page.evaluate(() => __early.releaseMetadata(null));
  await page.evaluate(() => __early.finish());
  await page.evaluate(() => __early.actualConnect());
  await page.waitForFunction(() => __early.calls.start === 1);
  assert.equal(await page.locator('#loading-sign-in').isDisabled(), true, 'The established in-flight task stays busy.');
  await page.evaluate(() => __early.completeAuthorization());
  await page.waitForFunction(() => !__early.NATIVE_PLAYER.busy);
  assert.equal(await page.locator('#loading-sign-in').innerText(), 'Restart sign-in');
  assert.match(await page.locator('#loading-identity-status').innerText(), /other window.*closed it.*restart/i);
  assert.equal(await page.evaluate(() => __early.calls.start), 1);
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), []);
  await page.locator('#loading-sign-in').click();
  assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: false }]);
  assert.equal(await page.evaluate(() => __early.calls.start), 1);
});

test('the narrow loading shell keeps readable copy and a touch-sized sign-in target', async t => {
  const { page } = await accountFixture(t);
  await page.setViewportSize({ width: 320, height: 560 });
  await acceptStatus(page);
  const box = await page.locator('#loading-sign-in').boundingBox();
  assert(box && box.height >= 44 && box.width >= 44, 'The consumer sign-in control must remain touch-sized.');
  assert(box.x >= 0 && box.x + box.width <= 320 && box.y >= 0 && box.y + box.height <= 560);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  mkdirSync(new URL('../out/', import.meta.url), { recursive: true });
  await page.screenshot({ path: fileURLToPath(new URL('../out/early-signin-320.png', import.meta.url)) });
  await page.setViewportSize({ width: 1280, height: 800 });
  assert.equal(await page.locator('#loading-sign-in').isVisible(), true);
  await page.screenshot({ path: fileURLToPath(new URL('../out/early-signin-1280.png', import.meta.url)) });
});

for (const [width, height] of [[844, 320], [640, 360]]) {
  for (const drafted of [false, true]) test(`loading sign-in is reachable at ${width}x${height}${drafted ? ' in the existing draft footer' : ''}`, async t => {
    const { page } = await accountFixture(t);
    await page.setViewportSize({ width, height });
    await acceptStatus(page);
    await page.evaluate(drafted => {
      const detail = document.getElementById('load-detail'), hint = document.getElementById('load-hint');
      detail.hidden = false; detail.textContent = 'Preparing the first view, water, people, shadows and the final drawing fence.';
      hint.hidden = false; hint.textContent = 'Keep this tab open while the view is prepared. You can sign in while the world loads.';
      if (drafted) {
        // Exercise the unchanged DOM move that prepareTitleDraft owns. Its
        // actual-source ownership/RNG/cancellation checks stay in early_title.
        document.body.classList.add('title-preparing'); document.getElementById('title').hidden = false;
        document.querySelector('#create .card-foot').appendChild(document.getElementById('loading'));
        document.getElementById('btn-begin').disabled = true;
        document.getElementById('btn-continue').disabled = true;
      }
      document.getElementById('loading-sign-in').focus();
    }, drafted);
    await page.locator('#loading-sign-in').scrollIntoViewIfNeeded();
    assert.equal(await page.locator('#loading').count(), 1);
    const actual = await page.evaluate(() => {
      const button = document.getElementById('loading-sign-in'), box = button.getBoundingClientRect();
      const point = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
      return { focused: document.activeElement === button, hit: point === button || button.contains(point),
        top: box.top, bottom: box.bottom, left: box.left, right: box.right,
        width: innerWidth, height: innerHeight, bodyFits: document.documentElement.scrollWidth <= innerWidth };
    });
    assert.equal(actual.focused, true); assert.equal(actual.hit, true, 'The focused CTA must not be clipped behind the fixed loader or draft footer.');
    assert(actual.top >= 0 && actual.bottom <= actual.height && actual.left >= 0 && actual.right <= actual.width);
    assert.equal(actual.bodyFits, true);
    await page.evaluate(() => __early.attemptBegin());
    assert.equal(await page.evaluate(() => __early.calls.entry), 0);
    assert.equal(await page.evaluate(() => __early.calls.write), 0);
    assert.equal(await page.evaluate(() => __early.calls.key), 0);
    if (drafted) {
      assert.equal(await page.locator('#btn-begin').isDisabled(), true);
      await page.locator('#btn-begin').scrollIntoViewIfNeeded();
      assert.equal(await page.locator('#btn-begin').evaluate(button => {
        const box = button.getBoundingClientRect(), hit = document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2);
        return box.top >= 0 && box.bottom <= innerHeight && (hit === button || button.contains(hit));
      }), true, 'The unchanged disabled realm-entry action remains reachable within the same scrollable footer.');
      await page.locator('#loading-sign-in').focus();
      await page.locator('#loading-sign-in').scrollIntoViewIfNeeded();
    }
    await page.keyboard.press('Enter');
    assert.deepEqual(await page.evaluate(() => __early.calls.auth), [{ fresh: false }], 'Keyboard activation delegates only the explicit sign-in action.');
    assert.equal(await page.evaluate(() => __early.calls.entry), 0);
  });
}
