/** Manual, mutating QA only. Never import from CI or an automatic test suite. */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { nativeBrowserNetwork, nativeFailureCode } from './native-browser-network.mjs';
import { nativeLiveStages } from './native-live-stages.mjs';
import { installNativeOwnerQaSession } from './native-owner-qa-session.mjs';
import { retainedGameBoot, verifiedContextHandoff, qaPageInventory, boundedPageStatus } from './native-player-orchestration.mjs';
import { createNativeLiveInput } from './native-live-input.mjs';
import { nativeCompanionRunnerConfig, createNativeCompanionRunner, nativeCompanionFailureCode } from './native-companion-runner.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';
import { createRetainedNativeOAuth, retainedNativeOAuthPopup, nativeOAuthFailureCode, nativeOAuthPrivacy } from './native-oauth-ceremony.mjs';

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
let gameOrigin, relayOrigin, companionConfig;
try {
  gameOrigin = origin(process.env.HM_NATIVE_ORIGIN);
  relayOrigin = origin(process.env.HM_NATIVE_RELAY_ORIGIN);
  if (gameOrigin === relayOrigin) throw new Error('configuration');
  if (process.env.DEBUG || process.env.PWDEBUG || process.env.PW_TEST_TRACE || process.env.NODE_DEBUG) throw new Error('configuration');
  companionConfig = nativeCompanionRunnerConfig(process.env);
} catch {
  console.error('FAIL: configuration. Supply separate HTTPS game/relay origins; companion opt-in additionally requires the existing agent DID and HTTPS public pod. Unset browser/debug tracing.');
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
let browser, stage = 'load-browser', plan, boot = null, bootStep = null;
let input = null, broker = null, companion = null, finishRequested = false, cleaning = false;
let privatePrivacyVerified = false, completeReported = false, activeOAuth = null;
const oauthControllers = [], oauthByPage = new WeakMap();
let firstContext, first, owner, initialHead, freshContext, fresh, registrationAttempted = false;
const contexts = [], retainedPages = [];
let syntheticPasskey = null, encryptedRecovery = null;
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error('A native QA condition failed.'), { code }); };
function passed(label) { console.log('PASS: ' + label); }
function reportComplete() {
  if (!allComplete() || finishRequested) return;
  if (completeReported) return;
  completeReported = true;
  console.log('PASS: native live QA complete. The labelled synthetic owner and private pod record remain; no local credential artifacts were written.');
  if (companion) console.log('PASS: native companion QA complete. Scoped public grant, native admission, local commands and both revocations verified; labelled game-owned QA records remain.');
}
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
    retainedPages.push({ page, contextIndex: contexts.indexOf(value) + 1 });
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
const firstBoot = retainedGameBoot({ createContext: context, url: gameOrigin + '/?safe=1&shard=' + room,
  onContext: value => { firstContext = value; }, onPage: page => { first = page; },
  onStep: value => { boot = 'initial'; bootStep = value; } });
const freshBoot = retainedGameBoot({ createContext: context, url: gameOrigin + '/?safe=1&shard=' + room,
  onContext: value => { freshContext = value; }, onPage: page => { fresh = page; },
  onStep: value => { boot = 'fresh'; bootStep = value; } });
async function oauth(page, { register, userId } = {}) {
  let controller = oauthByPage.get(page);
  if (!controller) {
    ensure(register || (owner && userId === owner.userId), 'same-owner');
    controller = createRetainedNativeOAuth({ register, gameOrigin, relayOrigin, expectedOwner: register ? null : owner,
      getPasskey: () => syntheticPasskey,
      start: ({ onPopup }) => retainedNativeOAuthPopup({ page, gameOrigin, onPopup }),
      async prove(popup, intent) {
        await popup.waitForURL(url => url.origin === relayOrigin, { timeout: 60_000 });
        await enableVirtualAuthenticator(popup, intent.register ? null : syntheticPasskey);
        if (intent.register) {
          ensure(!registrationAttempted, 'qa_registration_retry_refused');
          await popup.locator('#pk-name').fill(displayName);
          registrationAttempted = true;
          await popup.getByRole('button', { name: /^Register new$/i }).click();
        } else {
          ensure(syntheticPasskey?.privateKey && syntheticPasskey.isResidentCredential, 'synthetic-passkey-sync');
          if (intent.userId) {
            await popup.locator('#uid-userid').fill(intent.userId);
            await popup.getByRole('button', { name: /^Sign in with this userId$/i }).click();
          } else {
            // This new authenticator contains only the original run's resident
            // credential. Native credential lookup chooses its canonical owner.
            await popup.getByRole('button', { name: /^Sign in$/i }).click();
          }
        }
      },
      inspectFinish: popup => popup.locator('#status').textContent({ timeout: 1000 }),
      async verifyOwner() {
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
      },
    });
    oauthByPage.set(page, controller); oauthControllers.push(controller);
  }
  activeOAuth = controller;
  const result = await controller.run(); observations.oauthWritePkce = true; return result;
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

const firstHandoff = verifiedContextHandoff({
  async verify() {
    await first.reload({ waitUntil: 'domcontentloaded' });
    await first.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
      && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 });
    ensure(await first.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'game-reload-body');
    const reloadedHead = await verifiedRead(first, expectedSave);
    ensure(JSON.stringify(reloadedHead) === JSON.stringify(initialHead), 'reload-head-digest');
  },
  privacy: () => privacy(first),
  close: () => firstContext.close(),
});
const inspectPage = boundedPageStatus({ evaluate: (page, diagnose) => page.evaluate(async diagnose => {
  const h = window.__hm, n = h?.net?.NETWS;
  return { ready: !!h?.ready, native: !!h?.SAVE?.native,
    netOn: n?.state === 'on', nativeBound: !!n?.acct?.nativeBound,
    hasAccessSession: !!localStorage.getItem('hallowmarch.token.' + location.host),
    nativeQa: window.__hmNativeQaSession ? (diagnose ? await window.__hmNativeQaSession.diagnose() : window.__hmNativeQaSession.status()) : null };
}, diagnose) });
const cleanupPage = boundedPageStatus({ evaluate: page => page.evaluate(async () => {
  await window.__hmNativeCompanionQa?.close();
  await window.__hmNativeQaSession?.close();
  window.__hmNativeQaRecovery?.profile.close();
  await window.__hmNativeQaRecovery?.cache.close();
  const { createBrowserAccessCache } = await import('/gaming/identity/assets/access-cache.mjs');
  const cache = createBrowserAccessCache(); await cache.forgetAll(); await cache.close();
}) });
// The same bounded, rejection-sanitizing wrapper also protects final close
// attempts; a stuck context must not prevent the browser-close backstop.
const closeBrowserResource = boundedPageStatus({ evaluate: value => value.close() });
async function reportRetainedStatus(diagnose) {
  console.log(JSON.stringify({ kind: 'native_qa_plan', ...plan?.status(), boot, bootStep }));
  if (companion) console.log(JSON.stringify(companion.status()));
  if (companion) console.log(JSON.stringify(await companion.ownerStatus()));
  if (broker) console.log(JSON.stringify(broker.status()));
  for (let i = 0; i < oauthControllers.length; i++) console.log(JSON.stringify({ ...oauthControllers[i].status(), ceremonyIndex: i + 1 }));
  const inventory = qaPageInventory(retainedPages, { gameOrigin, relayOrigin });
  console.log(JSON.stringify(inventory));
  for (const entry of inventory.pages) if (!entry.closed && entry.originClass === 'game') {
    console.log(JSON.stringify({ kind: 'retained_browser_status', pageIndex: entry.pageIndex,
      ...await inspectPage(retainedPages[entry.pageIndex - 1].page, diagnose) }));
  }
}

const failureCode = error => nativeOAuthFailureCode(error) || nativeCompanionFailureCode(error) || nativeFailureCode(error);
const allComplete = () => plan?.status().complete === true && (!companion || companion.status().complete === true);
async function advanceQa(all) {
  ensure(!finishRequested, 'qa_session_closed');
  if (!plan?.status().complete) {
    if (all) await plan.remaining(); else await plan.next();
    if (!all) return;
  }
  if (companion) {
    if (all) await companion.remaining(); else await companion.next();
  }
}
function startInput() {
  if (input) return input;
  input = createNativeLiveInput({ input: process.stdin,
    acceptProtocolLine: line => broker?.acceptLine(line) === true,
    onInvalid: () => console.log('Commands: status, diagnose, retry, continue, oauth-retry-same-owner, companion-restart-admission, finish.'),
    onBusy: () => console.log('A manual command is still running. Signing replies and finish remain available.'),
    onError: () => console.error('FAIL: manual QA command [stage_failed]. Raw details were not emitted.'),
    async onClose() {
      finishRequested = true;
      const active = plan?.status().busy || companion?.status().busy;
      broker?.close(); companion?.close();
      // Explicit finish/EOF can release a stalled renderer. Ordinary cleanup
      // first closes the owner helper and cache before its context/browser.
      if (!cleaning && active && browser) await closeBrowserResource(browser);
    },
    async onCommand(action) {
      if (action === 'status' || action === 'diagnose') { await reportRetainedStatus(action === 'diagnose'); return; }
      if (plan?.status().busy || companion?.status().busy) { console.log('The QA stage is still running. Signing replies and finish remain available.'); return; }
      try {
        if (action === 'companion-restart-admission') {
          if (!companion) throw Object.assign(new Error('Companion QA is not selected.'), { code: 'qa_companion_restart_refused' });
          console.log(JSON.stringify(companion.restartAdmission())); return;
        }
        if (!plan) { console.log('No retained QA plan is available.'); return; }
        if (action === 'oauth-retry-same-owner') {
          ensure(activeOAuth && ['single-owner-passkey-oauth', 'fresh-browser-same-owner-oauth'].includes(plan.status().stage), 'qa_oauth_retry_refused');
          activeOAuth.requestSameOwnerRetry();
        }
        await advanceQa(action === 'continue');
        if (allComplete()) { process.exitCode = 0; reportComplete(); }
        else console.log(JSON.stringify({ kind: 'native_qa_stage_advanced', ...plan.status(),
          ...(companion ? { companion: companion.status() } : {}) }));
      } catch (error) { console.error('FAIL: native live QA at ' + stage + ' [' + failureCode(error) + ']. Raw details were not emitted.'); }
    },
  });
  return input;
}

try {
  const module = process.env.HM_PLAYWRIGHT_MODULE
    ? pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE).href : new URL('../node_modules/playwright/index.mjs', import.meta.url).href;
  const { chromium } = await import(module);
  stage = 'browser-network-configuration';
  const network = await nativeBrowserNetwork();
  stage = 'launch-browser';
  browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined,
    ...(network.proxy ? { proxy: network.proxy } : {}),
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', ...network.args] });
  console.log('QA owner display name: ' + displayName);
  if (companionConfig) {
    broker = createNativeCompanionSigningBroker({ enabled: true, ...companionConfig,
      writePublicRequest: value => console.log(JSON.stringify(value)) });
    companion = createNativeCompanionRunner({ config: companionConfig, run, gameOrigin, relayOrigin,
      getOwner: () => owner, getPage: () => fresh,
      privateQaComplete: () => plan?.status().complete === true && privatePrivacyVerified,
      signNativeRequest: broker.signNativeRequest, onStage: name => { stage = name; } });
  }
  plan = nativeLiveStages([
    { name: 'initial-game-boot', async run() {
      await firstBoot.open();
    } },
    { name: 'single-owner-passkey-oauth', async run() {
      owner = await oauth(first, { register: true });
      ensure(owner.userId.startsWith('u-pk-') && observations.registerCount === 1 && syntheticPasskey?.privateKey, 'one-qa-owner');
      passed('one labelled QA owner; real PKCE/write grant and one-use Hallow claim');
    } },
    { name: 'sealed-profile-create-and-link', async run() {
      await first.evaluate(installNativeOwnerQaSession, { run, owner, relayOrigin, expected: expectedSave, passphrase });
          const report = await first.evaluate(() => window.__hmNativeQaSession.ensureSaved());
          if (!report.ok) {
            console.log(JSON.stringify(report));
            throw Object.assign(new Error('Retained native QA operation failed.'), { code: 'qa_native_step_failed' });
          }
          encryptedRecovery = await first.evaluate(() => window.__hmNativeQaSession.encryptedRecovery());
    } },
    { name: 'native-profile-verification', async run() {
      initialHead = await verifiedRead(first, expectedSave);
      ensure(await privacy(first), 'browser-secret-custody');
      ensure(!observations.bridgeBodyLeak, 'private-body-game-bridge');
      passed('browser-sealed character and owner index; native heads/digests and exact private body');
    } },
    { name: 'same-browser-reload', async run() {
      await firstHandoff.run();
      passed('same browser reload opens the exact native character; privacy verified and first game context closed');
    } },
    { name: 'fresh-browser-same-owner-oauth', async run() {
      firstHandoff.requireClosed();
      // A failed boot retains its page before navigation. Its retry cannot
      // create another SwiftShader game context or replay owner registration.
      if (boot !== 'fresh' || bootStep !== 'complete') await freshBoot.open();
      const sameOwner = await oauth(fresh, { register: false, userId: owner.userId });
      ensure(sameOwner.subjectDid === owner.subjectDid && sameOwner.podUrl === owner.podUrl
        && sameOwner.accountId === owner.accountId && observations.registerCount === 1, 'same-owner');
    } },
    { name: 'fresh-browser-encrypted-key-recovery', async run() {
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
        let retained = window.__hmNativeQaRecovery;
        if (!retained) {
          const profile = createPlayerPodProfile({ binding: status.binding, credential: held.credential, relayUrl: relayOrigin, request });
          retained = window.__hmNativeQaRecovery = { profile, cache, checked: false, complete: false };
        } else { await cache.close(); }
        const profile = retained.profile;
        if (retained.complete) return;
        if (!retained.checked) {
          const connected = await profile.connect(); if (connected.keyPresent || !connected.hasRecord) throw new Error('fresh-browser-owner-index');
          let keyReplacementBlocked = false;
          try { await profile.createKey(); } catch (error) { keyReplacementBlocked = error.code === 'recovery_required'; }
          if (!keyReplacementBlocked) throw new Error('existing-index-key-replacement');
          let blocked = false; try { await profile.get(); } catch (error) { blocked = error.code === 'key_required'; }
          if (!blocked) throw new Error('recovery-not-required');
          retained.checked = true;
        }
          await profile.restoreRecovery(recovery, passphrase);
          const read = await profile.get();
          if (!read.exists || JSON.stringify(read.data()) !== JSON.stringify(expected)) throw new Error('recovery-readback');
          retained.complete = true;
      }, { recovery: encryptedRecovery, passphrase, relayOrigin, expected: expectedSave });
    } },
    { name: 'fresh-browser-native-verification', async run() {
      const restoredHead = await verifiedRead(fresh, expectedSave);
      ensure(JSON.stringify(restoredHead) === JSON.stringify(initialHead), 'recovery-head-digest');
      await fresh.reload({ waitUntil: 'domcontentloaded' });
      await fresh.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
        && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 });
      ensure(await fresh.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'fresh-game-reload-body');
      passed('fresh browser discovers owner index without a game hint, requires recovery, then opens identical native heads/body');
    } },
    { name: 'native-bound-central-write-rejection', async run() {
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
    } },
    { name: 'privacy-and-single-owner-invariants', async run() {
      ensure(observations.oauthWritePkce && observations.registerCount === 1 && !observations.refreshUsed
        && !observations.bridgeBodyLeak && nativeOAuthPrivacy(oauthControllers, observations)
        && firstHandoff.status().privacyVerified && firstHandoff.status().closed
        && await privacy(fresh), 'privacy-invariants');
      passed('one registration; no refresh use, native bearer URL/localStorage/log/game-bridge leakage, or private game-bridge body');
      privatePrivacyVerified = true;
    } }
  ], name => { ensure(!finishRequested, 'qa_session_closed'); stage = name; });
  // One reader must already be listening when a companion stage awaits the
  // root connector's public signed envelope. Never add a competing consumer.
  if (companion) startInput();
  await advanceQa(true);
  reportComplete();
} catch (cause) {
  // Playwright errors can contain request URLs or payloads. Print our own stage only.
  console.error('FAIL: native live QA at ' + stage + ' [' + failureCode(cause) + ']. Raw browser/error details were intentionally not emitted.');
  if (bootStep && bootStep !== 'complete') console.log(JSON.stringify({
    ...qaPageInventory(retainedPages, { gameOrigin, relayOrigin }), kind: 'native_qa_boot', boot, bootStep }));
  process.exitCode = 1;
  if (!finishRequested && syntheticPasskey && process.env.HM_NATIVE_RETAIN_FAILED_SESSION === '1') {
    console.log('QA session retained in RAM. Commands: status, diagnose, retry, continue, oauth-retry-same-owner, companion-restart-admission, finish. Registration is never replayed.');
    await startInput().waitForClose();
  }
} finally {
  cleaning = true; broker?.close(); companion?.close(); input?.close();
  for (const controller of oauthControllers) controller.close();
  syntheticPasskey = null; encryptedRecovery = null;
  for (const value of contexts) {
    try {
      for (const page of value.pages()) if (!page.isClosed() && new URL(page.url()).origin === gameOrigin) {
        await cleanupPage(page);
      }
    } catch { /* A stalled page must not prevent context/process closure. */ }
    finally { await closeBrowserResource(value); }
  }
  if (browser) await closeBrowserResource(browser);
}
