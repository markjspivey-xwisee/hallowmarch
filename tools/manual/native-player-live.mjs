/** Manual, mutating QA only. Never import from CI or an automatic test suite. */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { nativeBrowserNetwork, nativeFailureCode } from './native-browser-network.mjs';
import { nativeLiveStages } from './native-live-stages.mjs';
import { installNativeOwnerQaSession } from './native-owner-qa-session.mjs';
import { retainedGameBoot, verifiedContextHandoff, retainedNativeReload, retryNativeStartup, qaPageInventory, boundedPageStatus } from './native-player-orchestration.mjs';
import { createNativeLiveInput } from './native-live-input.mjs';
import { nativeCompanionRunnerConfig, createNativeCompanionRunner, nativeCompanionFailureCode } from './native-companion-runner.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';
import { createRetainedNativeOAuth, retainedNativeOAuthPopup, nativeOAuthFailureCode, nativeOAuthPrivacy } from './native-oauth-ceremony.mjs';
import { createNativeQaPasskey } from './native-virtual-passkey.mjs';
import { installNativeOAuthProofDiagnostics } from './native-oauth-proof-diagnostics.mjs';
import { createMainWorldLiveQa } from './main-world-live.mjs';
import { createHumanConsultingLiveQa } from './human-consulting-live.mjs';
import { createNativeQaEpisode, validateNativeQaEpisodeFile } from './native-qa-episode.mjs';

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
let gameOrigin, relayOrigin, identityOrigin, companionConfig, mainWorldConfig, episodeFile;
const humanConsultingSelected = process.env.HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST === '1';
const automaticFollowup = process.env.HM_NATIVE_COACH_FOLLOWUP_LIVE_TEST === '1';
try {
  gameOrigin = origin(process.env.HM_NATIVE_ORIGIN);
  relayOrigin = origin(process.env.HM_NATIVE_RELAY_ORIGIN);
  identityOrigin = origin(process.env.HM_NATIVE_IDENTITY_ORIGIN || 'https://identity.interego.xwisee.com');
  if (gameOrigin === relayOrigin) throw new Error('configuration');
  if (process.env.DEBUG || process.env.PWDEBUG || process.env.PW_TEST_TRACE || process.env.NODE_DEBUG) throw new Error('configuration');
  companionConfig = nativeCompanionRunnerConfig(process.env);
  if (process.env.HM_NATIVE_MAIN_WORLD_LIVE_TEST === '1') {
    if (companionConfig) throw new Error('Select main-world QA or the isolated companion diagnostic, not both.');
    mainWorldConfig = nativeCompanionRunnerConfig({ ...process.env, HM_NATIVE_COMPANION_LIVE_TEST: '1' });
  }
  if (humanConsultingSelected) {
    if (!mainWorldConfig || companionConfig) throw new Error('Coaching proof requires the completed real main-world episode.');
    episodeFile = validateNativeQaEpisodeFile(process.env.HM_NATIVE_QA_EPISODE_FILE);
  }
  if (automaticFollowup && !humanConsultingSelected) throw new Error('Automatic follow-up requires explicit human coaching proof.');
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
let input = null, broker = null, companion = null, mainWorld = null, humanConsulting = null, episode = null,
  mainWorldEpisodeMarked = false, coachingEpisodeMarked = false, finishRequested = false, cleaning = false;
let privatePrivacyVerified = false, completeReported = false, activeOAuth = null;
const oauthControllers = [], oauthByPage = new WeakMap();
let firstContext, first, owner, initialHead, freshContext, fresh, registrationAttempted = false;
const contexts = [], retainedPages = [];
const qaPasskey = createNativeQaPasskey();
let encryptedRecovery = null;
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error('A native QA condition failed.'), { code }); };
function passed(label) { console.log('PASS: ' + label); }
function reportComplete() {
  if (!allComplete() || finishRequested) return;
  if (completeReported) return;
  completeReported = true;
  console.log('PASS: native live QA complete. The labelled synthetic owner and private pod record remain; no local credential artifacts were written.');
  if (companion) console.log('PASS: native companion QA complete. Scoped public grant, native admission, local commands and both revocations verified; labelled game-owned QA records remain.');
  if (mainWorld) console.log('PASS: actual main-world QA complete. Normal 3D entry, native control, real movement, second authenticated peer, scoped proofs and both revocations verified.');
  if (humanConsulting) console.log('PASS: observed human coaching QA complete. Explicit Enable, attributed live response, exact encrypted private readback and Stop verified.');
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
      getPasskey: () => qaPasskey.credential(),
      start: ({ onPopup }) => retainedNativeOAuthPopup({ page, gameOrigin, onPopup }),
      prepareProof: popup => popup.evaluate(installNativeOAuthProofDiagnostics, { identityOrigin }),
      inspectProof: popup => popup.evaluate(() => window.__hmNativeProofDiagnostics?.status() || null),
      async prove(popup, intent) {
        intent.onStep('relay-document');
        await popup.waitForURL(url => url.origin === relayOrigin, { timeout: 60_000 });
        intent.onStep('authenticator-attach');
        const authenticator = await qaPasskey.attach(popup, { register: intent.register });
        if (intent.register) {
          ensure(!registrationAttempted, 'qa_registration_retry_refused');
          intent.onStep('display-name');
          await popup.locator('#pk-name').fill(displayName);
          registrationAttempted = true;
          intent.onStep('register-click');
          await popup.getByRole('button', { name: /^Register new$/i }).click();
        } else {
          ensure(qaPasskey.credential()?.isResidentCredential, 'synthetic-passkey-sync');
          // Only this run's exact resident key is installed. Native credential
          // lookup chooses its canonical owner for every sign-in attempt.
          intent.onStep('signin-click');
          await popup.getByRole('button', { name: /^Sign in$/i }).click();
        }
        // The click may return while its asynchronous native challenge is
        // pending. Read CDP storage only after this exact proof's key event.
        intent.onStep('passkey-event');
        await authenticator.waitForCredential();
        // If the callback closes the popup first, its assertion
        // event already retained the exact updated credential. Never replace it
        // with the registration snapshot or infer a counter value.
        intent.onStep('passkey-sync');
        if (!popup.isClosed()) await authenticator.sync();
        qaPasskey.credential();
        intent.onStep('proof-submitted');
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
  close: async () => { qaPasskey.credential(); await firstContext.close(); },
});
let freshReloadMarker = null;
const freshNativeReload = retainedNativeReload({
  async verifyBeforeReload() {
    const restoredHead = await verifiedRead(fresh, expectedSave);
    ensure(JSON.stringify(restoredHead) === JSON.stringify(initialHead), 'recovery-head-digest');
  },
  async prepareReload() {
    freshReloadMarker = await fresh.evaluate(() => { const marker = crypto.randomUUID(); window.__hmNativeReloadDocument = marker; return marker; });
  },
  reload: () => fresh.reload({ waitUntil: 'domcontentloaded' }),
  waitForNewDocument: () => fresh.waitForFunction(marker => window.__hmNativeReloadDocument !== marker,
    freshReloadMarker, { timeout: 30_000 }),
  waitForSave: () => fresh.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
    && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 }),
  async verifyLoaded() {
    ensure(await fresh.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'fresh-game-reload-body');
  },
});
const inspectPage = boundedPageStatus({ evaluate: (page, diagnose) => page.evaluate(async diagnose => {
  const h = window.__hm, n = h?.net?.NETWS;
  return { ready: !!h?.ready, native: !!h?.SAVE?.native,
    netOn: n?.state === 'on', nativeBound: !!n?.acct?.nativeBound,
    hasAccessSession: !!localStorage.getItem('hallowmarch.token.' + location.host),
    nativePlayer: typeof h?.nativePlayerStatus === 'function' ? h.nativePlayerStatus() : null,
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
  console.log(JSON.stringify({ kind: 'native_qa_plan', ...plan?.status(), boot, bootStep, freshReload: freshNativeReload.status() }));
  if (companion) console.log(JSON.stringify(companion.status()));
  if (companion) console.log(JSON.stringify(await companion.ownerStatus()));
  if (mainWorld) { console.log(JSON.stringify(mainWorld.status())); if (diagnose) console.log(JSON.stringify({kind:'main_world_diagnosis', ...await mainWorld.diagnose()})); }
  if (humanConsulting) console.log(JSON.stringify(humanConsulting.status()));
  if (episode) console.log(JSON.stringify(episode.status()));
  if (broker) console.log(JSON.stringify(broker.status()));
  for (let i = 0; i < oauthControllers.length; i++) console.log(JSON.stringify({
    ...(diagnose ? await oauthControllers[i].diagnose() : oauthControllers[i].status()), ceremonyIndex: i + 1 }));
  const inventory = qaPageInventory(retainedPages, { gameOrigin, relayOrigin });
  console.log(JSON.stringify(inventory));
  for (const entry of inventory.pages) if (!entry.closed && entry.originClass === 'game') {
    console.log(JSON.stringify({ kind: 'retained_browser_status', pageIndex: entry.pageIndex,
      ...await inspectPage(retainedPages[entry.pageIndex - 1].page, diagnose) }));
  }
}

const failureCode = error => nativeOAuthFailureCode(error) || nativeCompanionFailureCode(error) || nativeFailureCode(error);
const allComplete = () => plan?.status().complete === true && (!companion || companion.status().complete === true)
  && (!mainWorld || mainWorld.status().complete === true) && (!humanConsulting || humanConsulting.status().complete && coachingEpisodeMarked);
const qaBusy = () => plan?.status().busy || companion?.status().busy || mainWorld?.status().busy || humanConsulting?.status().busy;
async function advanceQa(all) {
  ensure(!finishRequested, 'qa_session_closed');
  if (!plan?.status().complete) {
    if (all) await plan.remaining(); else await plan.next();
    if (!all) return;
  }
  if (companion) {
    if (all) await companion.remaining(); else await companion.next();
  }
  if (mainWorld && !mainWorld.status().complete) {
    if (all) await mainWorld.remaining(); else await mainWorld.next();
    if (!all) return;
  }
  if (humanConsulting) {
    ensure(mainWorld?.status().complete && privatePrivacyVerified && episode, 'qa_human_prior_episode');
    if (!mainWorldEpisodeMarked) { await episode.mark('main-world-complete'); mainWorldEpisodeMarked = true; }
    stage = 'actual-human-observed-coaching'; await humanConsulting.run();
    if (automaticFollowup) { const proof = humanConsulting.status();
      ensure(proof.automaticFollowup === true && proof.realElapsedFollowup === true && proof.changedOutcome === true
        && proof.distinctSituation === true && proof.exactSecondPrivatePlan === true && proof.twoDeliveries === true,
      'qa_human_followup_unconfirmed'); }
    ensure(await privacy(fresh), 'privacy-invariants');
    if (humanConsulting.status().complete && !coachingEpisodeMarked) { await episode.mark('coaching-complete'); coachingEpisodeMarked = true; }
  }
}
function startInput() {
  if (input) return input;
  input = createNativeLiveInput({ input: process.stdin,
    acceptProtocolLine: line => broker?.acceptLine(line) === true,
    onInvalid: () => console.log('Commands: status, diagnose, retry, continue, native-startup-retry, oauth-retry-same-owner, companion-restart-admission, finish.'),
    onBusy: () => console.log('A manual command is still running. Signing replies and finish remain available.'),
    onError: () => console.error('FAIL: manual QA command [stage_failed]. Raw details were not emitted.'),
    async onClose() {
      finishRequested = true;
      const active = qaBusy();
      broker?.close(); companion?.close(); mainWorld?.close();
      // Explicit finish/EOF can release a stalled renderer. Ordinary cleanup
      // first closes the owner helper and cache before its context/browser.
      if (!cleaning && active && browser) await closeBrowserResource(browser);
    },
    async onCommand(action) {
      if (action === 'status' || action === 'diagnose') { await reportRetainedStatus(action === 'diagnose'); return; }
      if (qaBusy()) { console.log('The QA stage is still running. Signing replies and finish remain available.'); return; }
      try {
        if (action === 'native-startup-retry') {
          const freshRecovery = plan?.status().stage === 'fresh-browser-native-verification' && !plan.status().busy
            && freshNativeReload.status().reloadAttempted;
          const companionReload = plan?.status().complete && mainWorld?.status().stage === 'actual-party-companion-reload-persistence'
            && !mainWorld.status().busy && mainWorld.status().reloadAttempted;
          ensure(freshRecovery || companionReload, 'qa_startup_retry_refused');
          console.log(JSON.stringify(await retryNativeStartup({ page: fresh, expectedAccountId: owner?.accountId, gameOrigin }))); return;
        }
        if (action === 'main-world-revoke') { if (!mainWorld) throw new Error('Main-world QA is not selected.'); await mainWorld.revoke(); return; }
        if (action === 'companion-restart-admission') {
          if (mainWorld) { console.log(JSON.stringify(await mainWorld.restartAdmission())); return; }
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
  // A previous/unknown coaching intent refuses this process before browser
  // import, identity creation or any remote I/O. The ledger holds no secrets.
  if (episodeFile) { stage = 'manual-qa-episode'; episode = await createNativeQaEpisode({ file: episodeFile, run, gameOrigin, relayOrigin }); }
  stage = 'load-browser';
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
  if (mainWorldConfig) {
    broker = createNativeCompanionSigningBroker({ enabled: true, ...mainWorldConfig,
      writePublicRequest: value => console.log(JSON.stringify(value)) });
    mainWorld = createMainWorldLiveQa({ config: mainWorldConfig, getPage: () => fresh,
      signNativeRequest: broker.signNativeRequest, onStage: name => { stage = name; } });
  }
  if (humanConsultingSelected) humanConsulting = createHumanConsultingLiveQa({ getPage: () => fresh, getOwner: () => owner,
    gameOrigin, relayOrigin, run, automaticFollowup,
    checkpoint: async value => { ensure(mainWorldEpisodeMarked && ['coaching-delivery-intent', 'coaching-followup-intent'].includes(value?.kind), 'qa_human_episode_scope');
      await episode.mark(value.kind); } });
  plan = nativeLiveStages([
    { name: 'initial-game-boot', async run() {
      await firstBoot.open();
    } },
    { name: 'single-owner-passkey-oauth', async run() {
      owner = await oauth(first, { register: true });
      ensure(owner.userId.startsWith('u-pk-') && observations.registerCount === 1 && qaPasskey.credential()?.privateKey, 'one-qa-owner');
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
      await freshNativeReload.run();
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
  if (companion || mainWorld) startInput();
  await advanceQa(true);
  reportComplete();
} catch (cause) {
  // Playwright errors can contain request URLs or payloads. Print our own stage only.
  console.error('FAIL: native live QA at ' + stage + ' [' + failureCode(cause) + ']. Raw browser/error details were intentionally not emitted.');
  if (bootStep && bootStep !== 'complete') console.log(JSON.stringify({
    ...qaPageInventory(retainedPages, { gameOrigin, relayOrigin }), kind: 'native_qa_boot', boot, bootStep }));
  process.exitCode = 1;
  if (!finishRequested && qaPasskey.status().present && process.env.HM_NATIVE_RETAIN_FAILED_SESSION === '1') {
    console.log('QA session retained in RAM. Commands: status, diagnose, retry, continue, native-startup-retry, oauth-retry-same-owner, companion-restart-admission, finish. Registration is never replayed.');
    await startInput().waitForClose();
  }
} finally {
  cleaning = true; broker?.close(); companion?.close(); mainWorld?.close(); input?.close();
  for (const controller of oauthControllers) controller.close();
  qaPasskey.close(); encryptedRecovery = null;
  for (const value of contexts) {
    try {
      for (const page of value.pages()) if (!page.isClosed() && new URL(page.url()).origin === gameOrigin) {
        await cleanupPage(page);
      }
    } catch { /* A stalled page must not prevent context/process closure. */ }
    finally { await closeBrowserResource(value); }
  }
  if (browser) await closeBrowserResource(browser);
  await episode?.close();
}
