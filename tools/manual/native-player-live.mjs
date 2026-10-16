/** Manual, mutating QA only. Never import from CI or an automatic test suite. */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';

// Check the opt-in before importing a browser, resolving a service or making I/O.
if (process.env.HM_NATIVE_LIVE_TEST !== '1') {
  console.log('SKIP: native live QA requires HM_NATIVE_LIVE_TEST=1 and explicit HTTPS origins.');
  process.exit(0);
}
function origin(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/'
    || parsed.search || parsed.hash) throw new Error('configuration');
  return parsed.origin;
}
let gameOrigin, relayOrigin;
try {
  gameOrigin = origin(process.env.HM_NATIVE_ORIGIN);
  relayOrigin = origin(process.env.HM_NATIVE_RELAY_ORIGIN);
  if (gameOrigin === relayOrigin) throw new Error('configuration');
  if (process.env.DEBUG || process.env.PWDEBUG || process.env.PW_TEST_TRACE || process.env.NODE_DEBUG) throw new Error('configuration');
} catch {
  console.error('FAIL: configuration. Supply separate HTTPS HM_NATIVE_ORIGIN and HM_NATIVE_RELAY_ORIGIN; unset browser/debug tracing.');
  process.exit(2);
}

const run = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + randomBytes(4).toString('hex');
const displayName = 'Hallowmarch QA native E2E ' + run;
const characterName = 'QA Native ' + run.slice(-8);
const passphrase = randomBytes(32).toString('base64url');
const privateMarker = 'private-native-qa-' + randomBytes(24).toString('hex');
const room = 'native-qa-' + run.slice(-8);
const expectedSave = {
  v: 1,
  char: { name: characterName, realm: 0, cls: 'warrior', level: 1, xp: 0, rp: 0,
    kills: 0, realmKills: 0, deaths: 0, played: 0, bounty: null, pos: null,
    gold: 0, potions: 0, bag: [], eq: {}, lore: null, gift: {}, x: {} },
  settings: { quality: 'low', auto: false, tod: 'morning', sound: false, weather: 'clear' },
  qa: { run, privateMarker, purpose: 'Synthetic owner-pod persistence verification', authoritativeGameOutcome: false },
};
const observations = { requests: [], console: [], gameAuthorization: [], startAuthorization: [], claimAuthorization: [],
  bridgeBodyLeak: false, refreshUsed: false, registerCount: 0, oauthWritePkce: false };
let browser, stage = 'load-browser';
const contexts = [];
let syntheticPasskey = null, encryptedRecovery = null;
const ensure = (condition, code) => { if (!condition) throw new Error(code); };
function passed(label) { console.log('PASS: ' + label); }
// A later failed stage can close a page with outstanding listeners. Handle the
// orphan rejection without ever letting Playwright dump a sensitive raw error.
function watched(promise) { promise.catch(() => {}); return promise; }
async function enableVirtualAuthenticator(page, credential = null) {
  // Reviewed pattern: Interego 87ee716, deploy/mcp-relay/tests/passkey-oauth.spec.ts.
  const client = await page.context().newCDPSession(page);
  await client.send('WebAuthn.enable');
  const { authenticatorId } = await client.send('WebAuthn.addVirtualAuthenticator', { options: {
    protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true,
    isUserVerified: true, automaticPresenceSimulation: true,
  } });
  // The synthetic passkey sync stays in process memory; never export a file.
  if (credential) await client.send('WebAuthn.addCredential', { authenticatorId, credential });
  client.on('WebAuthn.credentialAdded', event => {
    if (!credential) syntheticPasskey = event.credential;
  });
  return { client, authenticatorId };
}
async function context() {
  const value = await browser.newContext({ viewport: { width: 1024, height: 768 }, acceptDownloads: false });
  contexts.push(value);
  value.on('page', page => {
    // Capture only in memory. Never print raw page errors, responses or URLs.
    page.on('console', message => observations.console.push(message.text()));
    page.on('pageerror', error => observations.console.push(error.message));
    page.on('request', request => {
      const url = new URL(request.url());
      observations.requests.push(request.url());
      const body = request.postData() || '';
      if (/grant_type(?:=|"\s*:\s*")refresh_token/.test(body)) observations.refreshUsed = true;
      if (url.origin === gameOrigin && body.includes(privateMarker)) observations.bridgeBodyLeak = true;
      const authorization = request.headers().authorization;
      if (url.origin === gameOrigin && authorization) observations.gameAuthorization.push(authorization);
      if (url.origin === gameOrigin && url.pathname === '/gaming/identity/start') {
        observations.startAuthorization.push(authorization);
      }
      if (url.origin === gameOrigin && url.pathname === '/gaming/identity/claim') {
        observations.claimAuthorization.push(authorization);
      }
      if (url.origin === relayOrigin && url.pathname === '/oauth/verify' && /webauthn-register/.test(body)) observations.registerCount++;
    });
  });
  return value;
}
async function openGame(value) {
  const page = await value.newPage();
  await page.goto(gameOrigin + '/?safe=1&shard=' + room, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__hm?.ready && window.__hm.net?.NETWS?.state === 'on'
    && !!window.__hm.net.NETWS.token, undefined, { timeout: 180_000 });
  await page.locator('#title .native-player button').first().waitFor({ timeout: 30_000 });
  return page;
}
async function oauth(page, { register, userId } = {}) {
  const startResponse = watched(page.waitForResponse(response => new URL(response.url()).origin === gameOrigin
    && new URL(response.url()).pathname === '/gaming/identity/start' && response.request().method() === 'POST'));
  const popupPromise = watched(page.waitForEvent('popup'));
  await page.locator('#title .native-player button').first().click();
  const popup = await popupPromise;
  const start = await startResponse, advertised = await start.json();
  const authorize = new URL(advertised.authorizationUrl);
  ensure(start.ok() && advertised.ownerPodWriteAccess === true && authorize.origin === relayOrigin
    && authorize.searchParams.get('scope') === 'mcp:write' && authorize.searchParams.get('response_type') === 'code'
    && authorize.searchParams.get('code_challenge_method') === 'S256'
    && /^[A-Za-z0-9_-]{43}$/.test(authorize.searchParams.get('code_challenge') || '')
    && authorize.searchParams.get('redirect_uri') === gameOrigin + '/gaming/identity/callback', 'advertised-pkce');
  observations.oauthWritePkce = true;
  await popup.waitForURL(url => url.origin === relayOrigin, { timeout: 60_000 });
  await enableVirtualAuthenticator(popup, register ? null : syntheticPasskey);
  const claimed = watched(popup.waitForResponse(response => new URL(response.url()).origin === gameOrigin
    && new URL(response.url()).pathname === '/gaming/identity/claim' && response.request().method() === 'POST', { timeout: 180_000 }));
  const closed = watched(popup.waitForEvent('close', { timeout: 180_000 }));
  if (register) {
    await popup.locator('#pk-name').fill(displayName);
    // Exactly one registration attempt. Failure never registers a replacement.
    await popup.getByRole('button', { name: /^Register new$/i }).click();
  } else {
    ensure(syntheticPasskey?.privateKey && syntheticPasskey.isResidentCredential, 'synthetic-passkey-sync');
    await popup.locator('#uid-userid').fill(userId);
    await popup.getByRole('button', { name: /^Sign in with this userId$/i }).click();
  }
  ensure((await claimed).ok(), 'claim');
  await closed;
  await page.waitForFunction(() => window.__hm?.ready && window.__hm.net?.NETWS?.acct?.nativeBound
    && window.__hm.SAVE.native, undefined, { timeout: 180_000 });
  return page.evaluate(async () => {
    const token = localStorage.getItem('hallowmarch.token.' + location.host);
    const response = await fetch('/gaming/identity/status', { headers: { Authorization: 'Bearer ' + token }, cache: 'no-store' });
    if (!response.ok) throw new Error('status');
    const status = await response.json();
    if (!status.bound || !status.verified || !status.binding?.subjectDid || !status.binding?.podUrl) throw new Error('binding');
    return { userId: status.binding.userId, subjectDid: status.binding.subjectDid, podUrl: status.binding.podUrl, accountId: status.account.id };
  });
}
async function verifiedRead(page, expected) {
  return page.evaluate(async ({ expected, relayOrigin }) => {
    const [{ createBrowserAccessCache }, { createNativePodClient }, { playerProfileIndexGraphIri, validatePlayerProfileIndex }] = await Promise.all([
      import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/client.mjs'),
      import('/gaming/identity/assets/profile.mjs'),
    ]);
    const appToken = localStorage.getItem('hallowmarch.token.' + location.host);
    const response = await fetch('/gaming/identity/status', { headers: { Authorization: 'Bearer ' + appToken }, cache: 'no-store' });
    if (!response.ok) throw new Error('status');
    const status = await response.json();
    if (!status.verified) throw new Error('owner');
    const cache = createBrowserAccessCache();
    const held = await cache.get({ relayUrl: relayOrigin, ownerDid: status.binding.subjectDid, podUrl: status.binding.podUrl });
    if (!held || held.credential.refreshToken || held.expiresAt <= Date.now()) throw new Error('access-cache');
    const client = createNativePodClient({ relayUrl: relayOrigin, credential: held.credential,
      ownerDid: status.binding.subjectDid, podUrl: status.binding.podUrl });
    try {
      await client.connect(); await client.registerKey();
      // load performs actual head lookup, authenticated descriptor verification,
      // sealed graph retrieval, local decrypt and signed canonical RDF digest check.
      const indexGraphIri = await playerProfileIndexGraphIri(status.binding.subjectDid);
      const index = await client.load({ graphIri: indexGraphIri });
      if (!index?.digest) throw new Error('owner-index');
      const graphIri = validatePlayerProfileIndex(index.record, status.binding.subjectDid);
      const found = await client.load({ graphIri });
      if (!found?.digest || JSON.stringify(found.record.save) !== JSON.stringify(expected)
        || found.record.schema !== 'hallowmarch.player-profile/v1' || found.record.ownerDid !== status.binding.subjectDid
        || found.record.provenance.authority !== 'player-authored' || found.record.provenance.importedProgressIsAuthoritative !== false) throw new Error('readback');
      return { indexGraphIri, indexCid: index.head.cid, indexDigest: index.digest,
        graphIri: found.graphIri, cid: found.head.cid, digest: found.digest };
    } finally { client.close(); await cache.close(); }
  }, { expected, relayOrigin });
}
async function privacy(page) {
  return page.evaluate(async ({ relayOrigin, observed }) => {
    const { createBrowserAccessCache } = await import('/gaming/identity/assets/access-cache.mjs');
    const cache = createBrowserAccessCache();
    try {
      const entries = await cache.list({ relayUrl: relayOrigin });
      if (entries.length !== 1) return false;
      const held = await cache.get(entries[0]), token = held?.credential.accessToken;
      return !!token && !held.credential.refreshToken
        && !JSON.stringify(Object.fromEntries(Object.entries(localStorage))).includes(token)
        && observed.requests.every(url => !url.includes(token) && !/[?&#](?:access_token|refresh_token|token|private_key)=/i.test(url))
        && observed.console.every(message => !message.includes(token))
        && observed.gameAuthorization.every(header => header !== 'Bearer ' + token);
    } finally { await cache.close(); }
  }, { relayOrigin, observed: { requests: observations.requests, console: observations.console, gameAuthorization: observations.gameAuthorization } });
}

try {
  const module = process.env.HM_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE).href : new URL('../node_modules/playwright/index.mjs', import.meta.url).href;
  const { chromium } = await import(module);
  browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined,
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  console.log('QA owner display name: ' + displayName);
  stage = 'initial-game-boot';
  const firstContext = await context(), first = await openGame(firstContext);
  stage = 'single-owner-passkey-oauth';
  const owner = await oauth(first, { register: true });
  ensure(owner.userId.startsWith('u-pk-') && observations.registerCount === 1 && syntheticPasskey?.privateKey, 'one-qa-owner');
  passed('one labelled QA owner; real PKCE/write grant and one-use Hallow claim');
  stage = 'sealed-profile-create-and-link';
  encryptedRecovery = await first.evaluate(async ({ expected, passphrase, relayOrigin }) => {
    const [{ createBrowserAccessCache }, { createPlayerPodProfile }] = await Promise.all([
      import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/profile.mjs'),
    ]);
    const appToken = localStorage.getItem('hallowmarch.token.' + location.host);
    const request = async (path, init = {}) => {
      if (!['/gaming/identity/status', '/gaming/identity/record-link'].includes(path)) throw new Error('bridge-path');
      if (init.body && Object.keys(init.body).sort().join(',') !== 'cid,descriptorUrl,graphIri,kind') throw new Error('bridge-body');
      const response = await fetch(path, { method: init.method || 'GET', cache: 'no-store', credentials: 'same-origin',
        headers: { Authorization: 'Bearer ' + appToken, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
      if (!response.ok) throw new Error('bridge-refused'); return response.json();
    };
    const status = await request('/gaming/identity/status');
    if (status.recordLinks?.character) throw new Error('qa-owner-not-fresh');
    const cache = createBrowserAccessCache(), held = await cache.get({ relayUrl: relayOrigin,
      ownerDid: status.binding.subjectDid, podUrl: status.binding.podUrl });
    if (!held || held.credential.refreshToken) throw new Error('access-cache');
    const profile = createPlayerPodProfile({ binding: status.binding, credential: held.credential, relayUrl: relayOrigin, request });
    try {
      const connected = await profile.connect(); if (connected.keyPresent || connected.hasRecord) throw new Error('qa-owner-not-fresh');
      await profile.createKey();
      const recovery = await profile.exportRecovery(passphrase);
      try { await profile.set(expected); } catch (error) { if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error.code)) throw error; }
      const deadline = Date.now() + 180000;
      while (profile.status().state !== 'saved') {
        if (Date.now() > deadline) throw new Error('native-confirmation-timeout');
        await new Promise(resolve => setTimeout(resolve, 1500));
        try { await profile.retry(); } catch (error) { if (!['pod_pending', 'pod_index_pending', 'pod_link_pending'].includes(error.code)) throw error; }
      }
      const read = await profile.get();
      if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw new Error('profile-readback');
      return recovery; // Encrypted backup only; passphrase/private key never leave custody in plaintext.
    } finally { profile.close(); await cache.close(); }
  }, { expected: expectedSave, passphrase, relayOrigin });
  const initialHead = await verifiedRead(first, expectedSave);
  ensure(await privacy(first), 'browser-secret-custody');
  ensure(!observations.bridgeBodyLeak, 'private-body-game-bridge');
  passed('browser-sealed character and owner index; native heads/digests and exact private body');
  stage = 'same-browser-reload';
  await first.reload({ waitUntil: 'domcontentloaded' });
  await first.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
    && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 });
  ensure(await first.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'game-reload-body');
  const reloadedHead = await verifiedRead(first, expectedSave);
  ensure(JSON.stringify(reloadedHead) === JSON.stringify(initialHead), 'reload-head-digest');
  passed('same browser reload resumes unexpired encrypted access and opens the exact native character');
  stage = 'fresh-browser-same-owner-oauth';
  const freshContext = await context(), fresh = await openGame(freshContext);
  const sameOwner = await oauth(fresh, { register: false, userId: owner.userId });
  ensure(sameOwner.subjectDid === owner.subjectDid && sameOwner.podUrl === owner.podUrl
    && sameOwner.accountId === owner.accountId && observations.registerCount === 1, 'same-owner');
  stage = 'fresh-browser-encrypted-key-recovery';
  await fresh.evaluate(async ({ recovery, passphrase, relayOrigin, expected }) => {
    const [{ createBrowserAccessCache }, { createPlayerPodProfile }] = await Promise.all([
      import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/profile.mjs'),
    ]);
    const appToken = localStorage.getItem('hallowmarch.token.' + location.host);
    const request = async (path, init = {}) => {
      const response = await fetch(path, { method: init.method || 'GET', cache: 'no-store',
        headers: { Authorization: 'Bearer ' + appToken, ...(init.body ? { 'Content-Type': 'application/json' } : {}) },
        ...(init.body ? { body: JSON.stringify(init.body) } : {}) });
      if (!response.ok) throw new Error('bridge-refused'); return response.json();
    };
    const status = await request('/gaming/identity/status'), cache = createBrowserAccessCache();
    const held = await cache.get({ relayUrl: relayOrigin, ownerDid: status.binding.subjectDid, podUrl: status.binding.podUrl });
    if (!held) throw new Error('native-owner');
    // Deliberately omit the Hallow pointer: recovery/discovery belongs to the
    // owner pod even when a different game authority has no participation hint.
    const profile = createPlayerPodProfile({ binding: status.binding, credential: held.credential,
      relayUrl: relayOrigin, request });
    try {
      const connected = await profile.connect(); if (connected.keyPresent || !connected.hasRecord) throw new Error('fresh-browser-owner-index');
      let keyReplacementBlocked = false;
      try { await profile.createKey(); } catch (error) { keyReplacementBlocked = error.code === 'recovery_required'; }
      if (!keyReplacementBlocked) throw new Error('existing-index-key-replacement');
      let blocked = false; try { await profile.get(); } catch (error) { blocked = error.code === 'key_required'; }
      if (!blocked) throw new Error('recovery-not-required');
      await profile.restoreRecovery(recovery, passphrase);
      const read = await profile.get();
      if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw new Error('recovery-readback');
    } finally { profile.close(); await cache.close(); }
  }, { recovery: encryptedRecovery, passphrase, relayOrigin, expected: expectedSave });
  const restoredHead = await verifiedRead(fresh, expectedSave);
  ensure(JSON.stringify(restoredHead) === JSON.stringify(initialHead), 'recovery-head-digest');
  await fresh.reload({ waitUntil: 'domcontentloaded' });
  await fresh.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
    && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 });
  ensure(await fresh.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'fresh-game-reload-body');
  passed('fresh browser discovers owner index without a game hint, requires recovery, then opens identical native heads/body');
  stage = 'native-bound-central-write-rejection';
  ensure(await fresh.evaluate(async room => {
    const token = localStorage.getItem('hallowmarch.token.' + location.host);
    const socket = new WebSocket('wss://' + location.host + '/ws');
    const replies = [], waiters = [];
    socket.addEventListener('message', event => { let value; try { value = JSON.parse(event.data); } catch { return; }
      const waiter = waiters.shift(); if (waiter) waiter(value); else replies.push(value); });
    const next = () => new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('ws-timeout')), 20000);
      const finish = value => { clearTimeout(timer); resolve(value); };
      if (replies.length) finish(replies.shift()); else waiters.push(finish);
    });
    const matching = async type => { for (let i = 0; i < 64; i++) { const reply = await next(); if (reply.t === type) return reply; } throw new Error('ws-reply'); };
    try {
      await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = () => reject(new Error('ws-open')); });
      socket.send(JSON.stringify({ t: 'hello', v: 1, token, room }));
      const welcome = await matching('welcome'); if (!welcome.acct?.nativeBound) return false;
      // Deliberately empty probe, never the actual private character body.
      socket.send(JSON.stringify({ t: 'save', d: { v: 1, char: null, qa: 'central-rejection-probe' } }));
      const save = await matching('saved');
      socket.send(JSON.stringify({ t: 'load' })); const load = await matching('save');
      socket.send(JSON.stringify({ t: 'wipe' })); const wipe = await matching('saved');
      return save.ok === false && wipe.ok === false && load.d === null
        && [save, load, wipe].every(reply => reply.error === 'nativepodsave_required');
    } finally { socket.close(); }
  }, room), 'central-write-rejection');
  passed('native-bound WebSocket refuses central save, load and wipe');
  stage = 'privacy-and-single-owner-invariants';
  ensure(observations.oauthWritePkce && observations.registerCount === 1 && !observations.refreshUsed
    && !observations.bridgeBodyLeak && observations.startAuthorization.length === 2
    && observations.claimAuthorization.length === 2
    && observations.startAuthorization.every((value, index) => value && value === observations.claimAuthorization[index])
    && await privacy(first) && await privacy(fresh), 'privacy-invariants');
  passed('one registration; no refresh use, native bearer URL/localStorage/log/game-bridge leakage, or private game-bridge body');
  console.log('PASS: native live QA complete. The labelled synthetic owner and its private pod record remain; no local credential artifacts were written.');
} catch {
  // Playwright errors can contain request URLs or payloads. Print our own stage only.
  console.error('FAIL: native live QA at ' + stage + '. Raw browser/error details were intentionally not emitted.');
  process.exitCode = 1;
} finally {
  syntheticPasskey = null; encryptedRecovery = null;
  for (const value of contexts) {
    try {
      for (const page of value.pages()) if (!page.isClosed() && new URL(page.url()).origin === gameOrigin) {
        await page.evaluate(async () => { const { createBrowserAccessCache } = await import('/gaming/identity/assets/access-cache.mjs');
          const cache = createBrowserAccessCache(); await cache.forgetAll(); await cache.close(); }).catch(() => {});
      }
      await value.close();
    } catch { /* Ephemeral browser process is also closed below. */ }
  }
  if (browser) await browser.close().catch(() => {});
}
