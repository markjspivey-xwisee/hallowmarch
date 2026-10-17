/** Manual, mutating QA only. Never import from CI or an automatic test suite. */
import { randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { nativeBrowserNetwork, nativeFailureCode } from './native-browser-network.mjs';
import { nativeLiveStages } from './native-live-stages.mjs';
import { installNativeOwnerQaSession } from './native-owner-qa-session.mjs';
import { retainedGameBoot, verifiedContextHandoff, retainedNativeReload, retryNativeStartup, qaPageInventory, boundedPageStatus, currentOwnerSaveHash as currentOwnerSaveHashFromReport } from './native-player-orchestration.mjs';
import { createNativeLiveInput } from './native-live-input.mjs';
import { nativeCompanionRunnerConfig, createNativeCompanionRunner, nativeCompanionFailureCode } from './native-companion-runner.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';
import { createRetainedNativeOAuth, retainedNativeOAuthPopup, verifyNativeOAuthStartAccount, nativeOAuthFailureCode, nativeOAuthPrivacy } from './native-oauth-ceremony.mjs';
import { createNativeQaPasskey } from './native-virtual-passkey.mjs';
import { installNativeOAuthProofDiagnostics } from './native-oauth-proof-diagnostics.mjs';
import { createMainWorldLiveQa } from './main-world-live.mjs';
import { createHumanConsultingLiveQa } from './human-consulting-live.mjs';
import { recoverNativeOwnerQa } from './native-recovery-session.mjs';
import { openNativeQaCheckpoint, nativeQaCheckpointFailureCode } from './native-qa-checkpoint.mjs';
import { installNativeQaCheckpointBinding } from './native-qa-checkpoint-binding.mjs';
import { readNativeQaCheckpoint } from './native-qa-resume.mjs';
import { verifyNativePrivateChat } from './native-private-chat.mjs';
import { readNativeQaCurrentOwnerSave, verifyNativeQaCurrentTitle } from './native-qa-current-save.mjs';

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
let gameOrigin, relayOrigin, identityOrigin, companionConfig, mainWorldConfig;
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
  if (process.env.HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST !== undefined
    && (process.env.HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST !== '1' || !mainWorldConfig)) throw new Error('configuration');
} catch {
  console.error('FAIL: configuration. Supply separate HTTPS game/relay origins; companion opt-in additionally requires the existing agent DID and HTTPS public pod. Unset browser/debug tracing.');
  process.exit(2);
}

const generatedRun = new Date().toISOString().replace(/[-:.TZ]/g, '') + '-' + randomBytes(4).toString('hex');
let fixture = { run: generatedRun, displayName: 'Hallowmarch QA native E2E ' + generatedRun,
  characterName: 'QA Native ' + generatedRun.slice(-8), room: 'native-qa-' + generatedRun.slice(-8),
  gameOrigin, relayOrigin, identityOrigin, agentDid: (mainWorldConfig || companionConfig)?.agentDid,
  agentPodUrl: (mainWorldConfig || companionConfig)?.agentPodUrl, passphrase: randomBytes(32).toString('base64url'), expectedSave: {
  v: 1,
  char: { name: 'QA Native ' + generatedRun.slice(-8), realm: 0, cls: 'warrior', level: 1, xp: 0, rp: 0,
    kills: 0, realmKills: 0, deaths: 0, played: 0, bounty: null, pos: null,
    gold: 0, potions: 0, bag: [], eq: {}, lore: null, gift: {}, x: {} },
  settings: { quality: 'low', auto: false, tod: 'morning', sound: false, weather: 'clear' },
  qa: { run: generatedRun, privateMarker: 'private-native-qa-' + randomBytes(24).toString('hex'),
    purpose: 'Synthetic owner-pod persistence verification', authoritativeGameOutcome: false },
} };
let checkpoint = null, checkpointState = null, checkpointMode = null;
try {
  const directory = process.env.HM_NATIVE_QA_CHECKPOINT_DIR, mode = process.env.HM_NATIVE_QA_CHECKPOINT_MODE;
  if ((directory === undefined) !== (mode === undefined)) throw Object.assign(Error('Explicit checkpoint scope required.'), { code: 'qa_checkpoint_configuration' });
  if (directory !== undefined) {
    if (!mainWorldConfig) throw Object.assign(Error('Checkpoint lifecycle scope requires the main-world suite.'), { code: 'qa_checkpoint_configuration' });
    checkpointMode = mode;
    checkpoint = openNativeQaCheckpoint({ directory, mode, ...(mode === 'new' ? { fixture } : {}),
      expectedScope: { gameOrigin, relayOrigin, identityOrigin, agentDid: fixture.agentDid, agentPodUrl: fixture.agentPodUrl } });
    checkpointState = checkpoint.snapshot(); fixture = checkpointState.fixture;
  }
} catch (error) {
  console.error('FAIL: private QA checkpoint [' + (nativeQaCheckpointFailureCode(error) || 'qa_checkpoint_configuration') + ']. No browser or identity was opened.');
  process.exit(2);
}
const { run, displayName, characterName, room, passphrase, expectedSave } = fixture;
const privateMarker = expectedSave.qa.privateMarker;
const ownerKnownResume = checkpointMode === 'resume' || checkpointMode === 'resume-current-owner-save';
const observations = { requests: [], console: [], gameAuthorization: [], startAuthorization: [], claimAuthorization: [],
  bridgeBodyLeak: false, refreshUsed: false, registerCount: 0, oauthWritePkce: false };
let browser, stage = 'load-browser', plan, boot = null, bootStep = null;
let input = null, broker = null, companion = null, mainWorld = null, humanConsulting = null, finishRequested = false, cleaning = false;
let privatePrivacyVerified = false, completeReported = false, activeOAuth = null;
const oauthControllers = [], oauthByPage = new WeakMap();
let firstContext, first, owner = ownerKnownResume ? checkpointState.owner : undefined,
  initialHead, freshContext, fresh, registrationAttempted = false, resumeNativeVerified = false, currentOwnerSaveHash = null;
const contexts = [], retainedPages = [];
let qaPasskey;
try { qaPasskey = createNativeQaPasskey({ restoredCredential: ownerKnownResume ? checkpointState.credential : null,
  onCredential: value => checkpoint?.recordCredential(value) }); }
catch { checkpoint?.close(); console.error('FAIL: private QA checkpoint [qa_checkpoint_unrecoverable]. No browser or identity was opened.'); process.exit(2); }
let encryptedRecovery = ownerKnownResume ? checkpointState.recovery : null;
const ensure = (condition, code) => { if (!condition) throw Object.assign(new Error('A native QA condition failed.'), { code }); };
function passed(label) { console.log('PASS: ' + label); }
function reportComplete() {
  if (!allComplete() || finishRequested) return;
  if (completeReported) return;
  completeReported = true;
  console.log(checkpointMode === 'resume-current-owner-save'
    ? 'PASS: current-owner save continuation complete. Fresh original-owner sign-in, original key/index and current private gameplay save hash/title/privacy verified; the initial fake-body proof was not replayed.'
    : checkpointMode === 'resume'
    ? 'PASS: resumed native QA complete. Fresh original-owner sign-in, read-only private recovery, title load and privacy verified; historical stages were not replayed.'
    : 'PASS: native live QA complete. The labelled synthetic owner and private pod record remain.'
      + (checkpoint ? ' The explicit private synthetic-fixture checkpoint remains; OAuth and game tokens were never checkpointed.' : ' No local credential artifacts were written.'));
  if (companion) console.log('PASS: native companion QA complete. Scoped public grant, native admission, local commands and both revocations verified; labelled game-owned QA records remain.');
  if (mainWorld) console.log('PASS: actual main-world QA complete. Normal 3D entry, native control, real movement, second authenticated peer, scoped proofs and both revocations verified.');
  if (humanConsulting) console.log('PASS: synthetic human coaching request returned an attributed live Foxxi plan with exact private native readback and no achievement claims.');
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
      verifyStartAccount: config => page.evaluate(verifyNativeOAuthStartAccount, config),
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
          checkpoint?.recordRegistrationIntent();
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
  const result = await controller.run();
  if (checkpointMode === 'resume-current-owner-save') ensure(['userId', 'subjectDid', 'podUrl', 'accountId']
    .every(key => result[key] === checkpointState.owner[key]), 'same-owner');
  else checkpoint?.recordOwner(result);
  observations.oauthWritePkce = true; return result;
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
    if (ownerKnownResume) { ensure(resumeNativeVerified && (checkpointMode !== 'resume-current-owner-save' || currentOwnerSaveHash), 'qa_native_step_failed'); return; }
    const restoredHead = await verifiedRead(fresh, expectedSave);
    ensure(JSON.stringify(restoredHead) === JSON.stringify(initialHead), 'recovery-head-digest');
  },
  async prepareReload() {
    freshReloadMarker = await fresh.evaluate(() => { const marker = crypto.randomUUID(); window.__hmNativeReloadDocument = marker; return marker; });
  },
  reload: () => fresh.reload({ waitUntil: 'domcontentloaded' }),
  waitForNewDocument: () => fresh.waitForFunction(marker => window.__hmNativeReloadDocument !== marker,
    freshReloadMarker, { timeout: 30_000 }),
  waitForSave: () => checkpointMode === 'resume-current-owner-save'
    ? fresh.waitForFunction(name => window.__hm?.ready && window.__hm.SAVE.native
      && window.__hm.SAVE.loaded?.char?.name === name, characterName, { timeout: 180_000 })
    : fresh.waitForFunction(run => window.__hm?.ready && window.__hm.SAVE.native
      && window.__hm.SAVE.loaded?.qa?.run === run, run, { timeout: 180_000 }),
  async verifyLoaded() {
    if (checkpointMode === 'resume-current-owner-save') {
      const result = await fresh.evaluate(verifyNativeQaCurrentTitle, { owner, gameOrigin, saveHash: currentOwnerSaveHash });
      console.log(JSON.stringify({ kind: 'native_qa_current_owner_title', ...result }));
      ensure(result.ok === true && result.complete === true, 'qa_native_step_failed');
    } else ensure(await fresh.evaluate(expected => JSON.stringify(window.__hm.SAVE.loaded) === JSON.stringify(expected), expectedSave), 'fresh-game-reload-body');
  },
});
const inspectPage = boundedPageStatus({ evaluate: (page, diagnose) => page.evaluate(async diagnose => {
  const h = window.__hm, n = h?.net?.NETWS;
  return { ready: !!h?.ready, native: !!h?.SAVE?.native,
    netOn: n?.state === 'on', nativeBound: !!n?.acct?.nativeBound,
    hasAccessSession: !!localStorage.getItem('hallowmarch.token.' + location.host),
    nativePlayer: typeof h?.nativePlayerStatus === 'function' ? h.nativePlayerStatus() : null,
    nativeRecovery: window.__hmNativeQaRecovery?.status?.() || null,
    nativeQa: window.__hmNativeQaSession ? (diagnose ? await window.__hmNativeQaSession.diagnose() : window.__hmNativeQaSession.status()) : null };
}, diagnose) });
const cleanupPage = boundedPageStatus({ evaluate: page => page.evaluate(async () => {
  await window.__hmNativeCompanionQa?.close();
  await window.__hmNativeQaSession?.close();
  window.__hmNativeQaRecovery?.profile?.close();
  await window.__hmNativeQaRecovery?.cache?.close();
  const { createBrowserAccessCache } = await import('/gaming/identity/assets/access-cache.mjs');
  const cache = createBrowserAccessCache(); await cache.forgetAll(); await cache.close();
}) });
// The same bounded, rejection-sanitizing wrapper also protects final close
// attempts; a stuck context must not prevent the browser-close backstop.
const closeBrowserResource = boundedPageStatus({ evaluate: value => value.close() });
async function reportRetainedStatus(diagnose) {
  console.log(JSON.stringify({ kind: 'native_qa_plan', ...plan?.status(), checkpointMode, boot, bootStep, freshReload: freshNativeReload.status() }));
  if (companion) console.log(JSON.stringify(companion.status()));
  if (companion) console.log(JSON.stringify(await companion.ownerStatus()));
  if (mainWorld) { console.log(JSON.stringify(mainWorld.status())); if (diagnose) console.log(JSON.stringify({kind:'main_world_diagnosis', ...await mainWorld.diagnose()})); }
  if (humanConsulting) console.log(JSON.stringify(humanConsulting.status()));
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

const failureCode = error => nativeQaCheckpointFailureCode(error) || nativeOAuthFailureCode(error) || nativeCompanionFailureCode(error) || nativeFailureCode(error);
const allComplete = () => plan?.status().complete === true && (!companion || companion.status().complete === true)
  && (!mainWorld || mainWorld.status().complete === true) && (!humanConsulting || humanConsulting.status().complete === true);
function checkpointLifecycle(event) {
  if (checkpointMode === 'resume-current-owner-save') ensure(plan?.status().complete === true
    && privatePrivacyVerified && resumeNativeVerified && currentOwnerSaveHash, 'qa_native_step_failed');
  checkpoint?.recordLifecycle(event);
}
async function advanceQa(all) {
  ensure(!finishRequested, 'qa_session_closed');
  if (!plan?.status().complete) {
    if (all) await plan.remaining(); else await plan.next();
    if (!all) return;
  }
  if (companion) {
    if (all) await companion.remaining(); else await companion.next();
  }
  if (mainWorld) { if (all) await mainWorld.remaining(); else await mainWorld.next(); }
  if (humanConsulting && mainWorld?.status().complete) await humanConsulting.run();
}
function startInput() {
  if (input) return input;
  input = createNativeLiveInput({ input: process.stdin,
    acceptProtocolLine: line => broker?.acceptLine(line) === true,
    onInvalid: () => console.log('Commands: status, diagnose, retry, continue, native-startup-retry, oauth-retry-same-owner, oauth-restart-unproved-start, companion-restart-admission, finish.'),
    onBusy: () => console.log('A manual command is still running. Signing replies and finish remain available.'),
    onError: () => console.error('FAIL: manual QA command [stage_failed]. Raw details were not emitted.'),
    async onClose() {
      finishRequested = true;
      const active = plan?.status().busy || companion?.status().busy || mainWorld?.status().busy
        || humanConsulting?.status().busy || input?.status().commandBusy;
      broker?.close(); companion?.close(); mainWorld?.close();
      // Explicit finish/EOF can release a stalled renderer. Ordinary cleanup
      // first closes the owner helper and cache before its context/browser.
      if (!cleaning && active && browser) await closeBrowserResource(browser);
    },
    async onCommand(action) {
      if (action === 'status' || action === 'diagnose') { await reportRetainedStatus(action === 'diagnose'); return; }
      if (plan?.status().busy || companion?.status().busy) { console.log('The QA stage is still running. Signing replies and finish remain available.'); return; }
      try {
        if (action === 'native-startup-retry') {
          ensure(plan?.status().stage === 'fresh-browser-native-verification' && !plan.status().busy
            && freshNativeReload.status().reloadAttempted, 'qa_startup_retry_refused');
          console.log(JSON.stringify(await retryNativeStartup({ page: fresh, expectedAccountId: owner?.accountId, gameOrigin }))); return;
        }
        if (action === 'main-world-revoke') { if (!mainWorld) throw new Error('Main-world QA is not selected.'); await mainWorld.revoke(); return; }
        if (action === 'companion-restart-admission') {
          if (mainWorld) { console.log(JSON.stringify(await mainWorld.restartAdmission())); return; }
          if (!companion) throw Object.assign(new Error('Companion QA is not selected.'), { code: 'qa_companion_restart_refused' });
          console.log(JSON.stringify(companion.restartAdmission())); return;
        }
        if (!plan) { console.log('No retained QA plan is available.'); return; }
        if (action === 'oauth-retry-same-owner' || action === 'oauth-restart-unproved-start') {
          ensure(activeOAuth && ['single-owner-passkey-oauth', 'fresh-browser-same-owner-oauth', 'resumed-same-owner-oauth'].includes(plan.status().stage), 'qa_oauth_retry_refused');
          if (action === 'oauth-restart-unproved-start') activeOAuth.requestUnprovedStartRestart();
          else activeOAuth.requestSameOwnerRetry();
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
  if (checkpointMode === 'resume-unregistered') console.log('QA continuation: exact original fixture; no registration intent or private operation previously began.');
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
      signNativeRequest: broker.signNativeRequest, onStage: name => { stage = name; }, checkpoint: checkpointLifecycle,
      verifyPrivateChat: async () => { const chat = await verifyNativePrivateChat({ page: fresh, run, gameOrigin });
        console.log(JSON.stringify({ kind: 'native_private_chat_qa', ...chat }));
        ensure(chat.ok === true && chat.privateParty === true && chat.ownerUiSend === true && chat.peerReceivedOwnerFastSay === true
          && chat.ownerReceivedPeerFastSay === true && chat.ownerDisplayedPeerReply === true && chat.cleanupConfirmed === true,
        'qa_private_chat_unconfirmed');
        passed('two synthetic private party messages reached the actual peer and owner UI after native reconnect'); } });
    if (process.env.HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST === '1') humanConsulting = createHumanConsultingLiveQa({
      getPage: () => fresh, getOwner: () => owner, relayOrigin, gameOrigin, run, checkpoint: checkpointLifecycle });
  }
  plan = nativeLiveStages(ownerKnownResume ? [
    { name: 'resumed-game-boot', async run() { await freshBoot.open(); } },
    { name: 'resumed-same-owner-oauth', async run() {
      const original = owner;
      const sameOwner = await oauth(fresh, { register: false, userId: original.userId });
      ensure(['userId', 'subjectDid', 'podUrl', 'accountId'].every(key => sameOwner[key] === original[key])
        && observations.registerCount === 0, 'same-owner');
      passed('resumed original synthetic owner signs in with its retained passkey; no registration replay');
    } },
    { name: checkpointMode === 'resume-current-owner-save' ? 'resumed-current-owner-save-readback' : 'resumed-private-native-readback', async run() {
      const report = await fresh.evaluate(checkpointMode === 'resume-current-owner-save' ? readNativeQaCurrentOwnerSave : readNativeQaCheckpoint,
        { owner, relayOrigin, gameOrigin, recovery: encryptedRecovery,
        passphrase, expected: expectedSave, publications: checkpointState.publications });
      if (checkpointMode === 'resume-current-owner-save') {
        console.log(JSON.stringify({ kind: 'native_qa_current_owner_save', ...report }));
        currentOwnerSaveHash = currentOwnerSaveHashFromReport(report); resumeNativeVerified = true;
        passed('original owner/key/index and current authenticated gameplay save hash verified through native reads only'); return;
      }
      if (!report.ok) {
        console.log(JSON.stringify({ kind: 'native_qa_resume', ...report }));
        throw Object.assign(Error('Original checkpoint private record could not be read.'), { code: 'qa_native_step_failed' });
      }
      resumeNativeVerified = true;
      passed('original checkpoint key, native profile/index operations and exact synthetic body verified through native reads only');
    } },
    { name: 'fresh-browser-native-verification', async run() {
      await freshNativeReload.run(); passed(checkpointMode === 'resume-current-owner-save'
        ? 'current authenticated gameplay save hash and fresh original-owner binding verified after one real title reload'
        : 'resumed original private character opens in the normal game title after one real reload');
    } },
    { name: 'resumed-privacy-verification', async run() {
      ensure(observations.oauthWritePkce && observations.registerCount === 0 && !observations.refreshUsed && !observations.bridgeBodyLeak
        && oauthControllers.length === 1 && oauthControllers[0].audit(observations.startAuthorization, observations.claimAuthorization)
        && await privacy(fresh), 'privacy-invariants');
      privatePrivacyVerified = true;
      passed('resumed run has fresh proof/claim/privacy evidence; no historical PASS flags or private write replay');
    } },
  ] : [
    { name: 'initial-game-boot', async run() {
      await firstBoot.open();
    } },
    { name: 'single-owner-passkey-oauth', async run() {
      owner = await oauth(first, { register: true });
      ensure(owner.userId.startsWith('u-pk-') && observations.registerCount === 1 && qaPasskey.credential()?.privateKey, 'one-qa-owner');
      passed('one labelled QA owner; real PKCE/write grant and one-use Hallow claim');
    } },
    { name: 'sealed-profile-create-and-link', async run() {
      if (checkpoint) await installNativeQaCheckpointBinding({ page: first, gameOrigin, checkpoint });
      await first.evaluate(installNativeOwnerQaSession, { run, owner, relayOrigin, expected: expectedSave, passphrase, checkpointEnabled: !!checkpoint });
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
      const report = await fresh.evaluate(recoverNativeOwnerQa,
        { run, owner, recovery: encryptedRecovery, passphrase, relayOrigin, expected: expectedSave });
      if (!report.ok) {
        console.log(JSON.stringify({ kind: 'native_qa_recovery', ...report }));
        throw Object.assign(new Error('Retained native recovery failed.'), { code: 'qa_native_step_failed' });
      }
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
    console.log('QA session retained in RAM. Commands: status, diagnose, retry, continue, native-startup-retry, oauth-retry-same-owner, oauth-restart-unproved-start, companion-restart-admission, finish. Registration is never replayed.');
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
  checkpoint?.close();
}
