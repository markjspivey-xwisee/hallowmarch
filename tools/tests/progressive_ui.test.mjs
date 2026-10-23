/** Actual native title entry functions with delayed provisioning and pod fixtures. */
import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import vm from 'node:vm';

const identity = await fs.readFile(new URL('../../src/14v_nativeidentity.js', import.meta.url), 'utf8');
const saves = await fs.readFile(new URL('../../src/12_save.js', import.meta.url), 'utf8');
const main = await fs.readFile(new URL('../../src/13_main.js', import.meta.url), 'utf8');
const startSource = main.slice(main.indexOf('function startGame('), main.indexOf('function newCharacter('));
const liveplay = await fs.readFile(new URL('../../src/14m_liveplay.js', import.meta.url), 'utf8');
const eligibleSource = liveplay.slice(liveplay.indexOf('function netHumanEligible()'), liveplay.indexOf('function netHumanLive()'));
const validSave = saves.slice(saves.indexOf('function validSave(s)'), saves.indexOf('function saveLoadOwned('));
const fresh = () => ({ v: 1, name: 'New recruit', realm: 0, cls: 'warrior', level: 1, fresh: true });
const clone = value => JSON.parse(JSON.stringify(value));
const flush = async () => { for (let n = 0; n < 12; n++) await Promise.resolve(); };
function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }

function fixture({ prior = null, snapshot = { v: 1, char: null }, bootstrapGate, readGate, keyGate,
  bootstrapFailure = false, canonical = false, keyPresent = true, hasRecord = false, statusOverride = {},
  linked = true, manifestPlay = false, gameProof = 'retired-game-proof', resumePending = false, tokenGate, peekGate } = {}) {
  const calls = { bootstrap: 0, resume: 0, resumeInputs: [], peek: 0, reads: 0, keys: 0, starts: [], settings: 0, world: 0, renders: 0, finalSaves: 0, titles: [] };
  const profileState = { keyPresent, hasRecord, pending: false };
  const initialStatus = { ...(canonical
    ? { enabled: true, bound: true, verified: true, provisional: false, account: { id: 'owner' }, recordLinks: {}, binding: { subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' } }
    : { enabled: true, bound: false, verified: false, provisionalPlay: { enabled: true, relayUrl: 'https://relay.example' }, account: { id: 'transport' }, recordLinks: {} }), ...statusOverride };
  const context = vm.createContext({ console, URL, AbortSignal, structuredClone, setTimeout, clearTimeout,
    window: {}, location: { origin: 'https://game.example' }, $: () => null,
    NETWS: { token: 'opaque-game-token', host: 'game.example', acct: { id: canonical ? 'owner' : 'transport' }, reload: false },
    GAME: { started: false, ready: true },
    SAVE: { native: true, readConfirmed: canonical, loaded: null, pending: null, nativeFlight: null, loading: null },
    CLASSES: { warrior: {} }, LEVEL_CAP: 60,
    localStorage: { getItem() { throw Error('Title entry cannot read a browser character'); } },
    netServerUrl: () => 'wss://game.example/ws', netLinkWS: async () => linked,
    netWsToken: async () => { if (tokenGate) await tokenGate.promise; return gameProof; },
    fetch: async () => ({ ok: true, status: 200, json: async () => ({ playerIdentity: manifestPlay
      ? { provisionalPlay: { enabled: true, relayUrl: 'https://relay.example', audience: 'https://game.example' } } : {} }) }),
    applySettings: () => calls.settings++, applyWorldSave: () => calls.world++, coreKey: value => JSON.stringify(value),
    saveNow: async () => { calls.finalSaves++; },
    setupTitle: value => calls.titles.push(clone(value)),
    async startGame(value) {
      assert.equal(context.SAVE.readConfirmed, true, 'native checkpoint read must precede graphics/game start');
      assert.equal(context.fixture.NATIVE_PLAYER.status.verified, true);
      calls.starts.push(clone(value)); context.GAME.started = true;
    },
  });
  const profile = { status: () => ({ ...profileState }),
    async createKey() { calls.keys++; if (keyGate) await keyGate.promise; profileState.keyPresent = true; }, close() {}, delete: async () => {} };
  const session = {
    async peek() { calls.peek++; if (peekGate) await peekGate.promise; return prior; },
    async bootstrap() {
      calls.bootstrap++; if (bootstrapGate) await bootstrapGate.promise;
      if (bootstrapFailure) throw Object.assign(Error('Native checkpoint unavailable'), { code: 'native_unavailable' });
      context.fixture.NATIVE_PLAYER.status = { ...initialStatus, bound: true, verified: true, provisional: true };
    },
    async resume(input) { calls.resume++; calls.resumeInputs.push(clone(input));
      if (!resumePending) context.fixture.NATIVE_PLAYER.status = { ...initialStatus, bound: true, verified: true, provisional: true };
      return { pendingClaimResume: resumePending }; },
    async get() { calls.reads++; if (readGate) await readGate.promise; return snapshot === false ? { exists: false } : { exists: true, data: () => clone(snapshot) }; },
    set: async () => {}, profile: () => profile, status: () => ({ provisional: true }),
  };
  context.fixtureProfile = profile; context.fixtureSession = session; context.fixtureStatus = initialStatus;
  vm.runInContext(validSave + '\n' + identity + `
    NATIVE_PLAYER.status = fixtureStatus;
    NATIVE_PLAYER.profile = ${canonical} ? fixtureProfile : null;
    nativePlayerRender = () => {};
    nativePlayerRequest = async () => fixtureStatus;
    nativePlayerProvisionalSession = async () => {
      NATIVE_PLAYER.provisional = fixtureSession;
      NATIVE_PLAYER.provisionalContext = { host: NETWS.host, accountId: NETWS.acct?.id };
      return fixtureSession;
    };
    globalThis.fixture = { NATIVE_PLAYER, nativePlayerBegin, nativePlayerSaveRef, nativePlayerProvisionalRef,
      nativePlayerFinishClaim, nativePlayerConfirmClaim, nativePlayerClaimConnect, nativePlayerUseExistingTarget,
      nativePlayerGuestRequest, nativePlayerCanPlayNow, nativePlayerAcceptSession, nativePlayerRefreshGuest };
  `, context);
  return { ...context.fixture, context, calls, session, profile, profileState, SAVE: context.SAVE, NETWS: context.NETWS, GAME: context.GAME };
}

test('new-player title discovery does not provision a pod, create a key or start play', async () => {
  const f = fixture(); const ref = await f.nativePlayerSaveRef({ active: true });
  assert.equal(ref.blocked, true); assert.equal(f.calls.peek, 1);
  assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.resume, 0); assert.equal(f.calls.keys, 0);
  assert.equal(f.calls.reads, 0); assert.equal(f.calls.starts.length, 0); assert.equal(f.SAVE.readConfirmed, false);
});

test('a bound guest whose game proof is stale requests fresh proof admission while retaining its existing pod', async () => {
  const f = fixture({ prior: { ownerDid: 'did:fixture:guest' }, statusOverride: { bound: true, provisional: true, verified: false,
    binding: { subjectDid: 'did:fixture:guest', podUrl: 'https://pod.example/guest/' } } });
  await f.nativePlayerSaveRef({ active: true });
  assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.resume, 1);
  assert.equal(f.calls.resumeInputs[0].requireGameSession, true);
});

test('a cold retired guest can reopen only its staged native claim while multiplayer admission stays closed', async () => {
  const f = fixture({ linked: false, manifestPlay: true, resumePending: true,
    prior: { ownerDid: 'did:fixture:guest', targetAvailable: true, targetOwnerDid: 'did:fixture:owner', lastConfirmedClaim: true } });
  f.NETWS.token = ''; f.NETWS.acct = null;
  const ref = await f.nativePlayerSaveRef({ active: true });
  assert.equal(ref.native, true); assert.equal(ref.blocked, undefined);
  assert.equal(f.calls.peek, 1); assert.equal(f.calls.resume, 1); assert.equal(f.calls.resumeInputs[0].requireGameSession, true);
  assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.keys, 0); assert.equal(f.calls.starts.length, 0);
  assert.equal(f.NETWS.token, ''); assert.equal(f.NETWS.acct, null); assert.equal(f.SAVE.loaded, null); assert.equal(f.SAVE.readConfirmed, false);
  assert.equal(f.NATIVE_PLAYER.claimPendingResume, true); assert.equal(f.NATIVE_PLAYER.claimLastConfirmed, true);
  assert.equal(f.NATIVE_PLAYER.profile, f.profile); assert.equal(f.nativePlayerCanPlayNow(), false);
});

test('cold connection failure never provisions a guest from absent, canonical, or unadvertised metadata', async () => {
  for (const options of [
    { prior: null, manifestPlay: true },
    { prior: { ownerDid: 'did:fixture:guest', claimedOwnerDid: 'did:fixture:owner' }, manifestPlay: true },
    { prior: { ownerDid: 'did:fixture:guest', targetAvailable: true }, manifestPlay: false },
    { prior: { ownerDid: 'did:fixture:guest', targetAvailable: true }, manifestPlay: true, gameProof: null },
  ]) {
    const f = fixture({ linked: false, ...options }); f.NETWS.token = ''; f.NETWS.acct = null;
    const ref = await f.nativePlayerSaveRef({ active: true });
    assert.equal(ref.blocked, true); assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.resume, 0);
    assert.equal(f.calls.keys, 0); assert.equal(f.calls.starts.length, 0); assert.equal(f.NETWS.token, ''); assert.equal(f.NETWS.acct, null);
  }
});

test('late token and metadata reads cannot retain proof recovery after the current connection changes', async () => {
  for (const phase of ['token', 'metadata']) for (const change of [
    f => { f.NETWS.host = 'foreign.example'; }, f => { f.NETWS.acct = { id: 'other-owner' }; },
    f => { f.NETWS.token = 'newer-game-session'; }, f => { f.NETWS.reload = true; },
  ]) {
    const gate = deferred(), f = fixture({ linked: false, manifestPlay: true, resumePending: true,
      prior: { ownerDid: 'did:fixture:guest', targetAvailable: true }, ...(phase === 'token' ? { tokenGate: gate } : { peekGate: gate }) });
    f.NETWS.token = ''; f.NETWS.acct = null; const opening = f.nativePlayerSaveRef({ active: true }); await flush();
    change(f); gate.resolve(); const ref = await opening;
    assert.equal(ref.blocked, true); assert.equal(f.calls.resume, 0); assert.equal(f.calls.bootstrap, 0);
    assert.equal(!!f.NATIVE_PLAYER.provisionalProofToken, false); assert.equal(f.calls.starts.length, 0);
  }
});

async function coldProofFixture() {
  const f = fixture({ linked: false, manifestPlay: true, resumePending: true, prior: { ownerDid: 'did:fixture:guest', targetAvailable: true } });
  f.NETWS.token = ''; f.NETWS.acct = null; await f.nativePlayerSaveRef({ active: true });
  const requests = [];
  f.context.fetch = async (url, init) => { requests.push({ url, ...init }); return { ok: true, json: async () => ({ ok: true }) }; };
  const requestSource = identity.slice(identity.indexOf('async function nativePlayerRequest('), identity.indexOf('async function nativePlayerModules('));
  vm.runInContext(requestSource, f.context);
  return { ...f, requests };
}

test('the retired game proof is available only to the four same-origin POST proof controls', async () => {
  const f = await coldProofFixture();
  for (const path of ['/gaming/identity/play/challenge', '/gaming/identity/play/complete', '/gaming/identity/play/claim-complete', '/gaming/identity/play/claim-recovery-challenge']) {
    await f.nativePlayerGuestRequest(path, { method: 'POST', body: { fixture: 'public-proof' } });
  }
  assert.equal(f.requests.length, 4); assert(f.requests.every(request => request.headers.Authorization === 'Bearer retired-game-proof'));
  assert.equal(f.NETWS.token, ''); assert.equal(f.NETWS.acct, null);
  for (const [url, method] of [
    ['/gaming/identity/status', 'GET'], ['/gaming/identity/record-link', 'POST'], ['/gaming/identity/claim-owner/start', 'POST'],
    ['/gaming/identity/play/challenge', 'GET'], ['https://foreign.example/gaming/identity/play/complete', 'POST'],
    ['https://user@game.example/gaming/identity/play/complete', 'POST'], ['/gaming/identity/play/complete?other=1', 'POST'],
    ['/gaming/identity/play/complete#fragment', 'POST'],
  ]) await assert.rejects(f.nativePlayerGuestRequest(url, { method }), 'a retained proof cannot authorize ' + url);
  assert.equal(f.requests.length, 4, 'denied controls never receive a retained game proof');
});

test('an incomplete bootstrap may replace only its refused disposable game transport before retrying the same public key', async () => {
  const f = await coldProofFixture(), prior = { ownerDid: 'did:fixture:guest', gameAdmitted: false };
  f.session.peek = async () => prior; f.session.profile = () => null;
  f.NATIVE_PLAYER.profile = null; f.NATIVE_PLAYER.claimPendingResume = false;
  f.NETWS.token = 'stale-disposable'; let forgotten = 0, linked = 0;
  f.context.netWsTokenForget = async (host, token, allowed) => { assert.equal(host, 'game.example'); assert.equal(token, 'stale-disposable'); assert.equal(allowed(), true); forgotten++; };
  f.context.netWsRetire = () => {};
  f.context.netLinkWS = async () => { linked++; f.NETWS.token = 'fresh-disposable'; f.NETWS.acct = { id: 'fresh-transport' }; return true; };
  f.context.fetch = async (url, init) => { f.requests.push({ url, ...init }); return f.requests.length === 1
    ? { ok: false, status: 401, json: async () => ({ error: 'game_account_required' }) }
    : { ok: true, json: async () => ({ challenge: 'same-key-bootstrap' }) }; };
  const result = await f.nativePlayerGuestRequest('/gaming/identity/play/challenge', { method: 'POST', bootstrapRecovery: true,
    body: { publicKeyJwk: { fixture: 'same-public-key' } } });
  assert.equal(result.challenge, 'same-key-bootstrap'); assert.equal(forgotten, 1); assert.equal(linked, 1);
  assert.equal(f.requests[0].headers.Authorization, 'Bearer stale-disposable');
  assert.equal(f.requests[1].headers.Authorization, 'Bearer fresh-disposable');
  assert.equal(f.requests[0].body, f.requests[1].body); assert.equal(f.NATIVE_PLAYER.provisionalContext.accountId, 'fresh-transport');
  assert.deepEqual(await f.session.peek(), prior); assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.starts.length, 0);
});

test('admitted, saved and claiming guests never clear their app proof through incomplete-bootstrap recovery', async () => {
  for (const metadata of [{ gameAdmitted: true }, { credentialExpiresAt: Date.now() + 60000 }, { characterId: 'existing-character' }, { targetAvailable: true }, { claimedOwnerDid: 'did:fixture:owner' }]) {
    const f = await coldProofFixture(); f.session.peek = async () => ({ ownerDid: 'did:fixture:guest', ...metadata });
    f.NATIVE_PLAYER.profile = null; f.NATIVE_PLAYER.claimPendingResume = false; f.NETWS.token = 'existing-proof';
    let forgotten = 0; f.context.netWsTokenForget = async () => { forgotten++; };
    f.context.fetch = async () => ({ ok: false, status: 401, json: async () => ({ error: 'game_account_required' }) });
    await assert.rejects(f.nativePlayerGuestRequest('/gaming/identity/play/challenge', { method: 'POST', bootstrapRecovery: true, body: {} }), { code: 'owner_mismatch' });
    assert.equal(forgotten, 0); assert.equal(f.NETWS.token, 'existing-proof');
  }
});

test('refreshing an incomplete title bootstrap confirms its private read before enabling entry', async () => {
  const f = fixture({ prior: { ownerDid: 'did:fixture:guest', gameAdmitted: false } });
  await f.nativePlayerSaveRef({ active: true }); f.SAVE.chain = Promise.resolve();
  f.context.withTimeout = async promise => promise; let reads = 0;
  f.context.loadSave = async options => { assert.equal(options.retry, true); reads++; f.SAVE.readConfirmed = true; };
  await f.nativePlayerRefreshGuest();
  assert.equal(reads, 1); assert.equal(f.SAVE.readConfirmed, true);
  assert.equal(f.calls.finalSaves, 0, 'a title refresh reads the saved character instead of writing unstarted gameplay');
  assert.match(f.NATIVE_PLAYER.message, /character confirmed/); assert.equal(f.NATIVE_PLAYER.switching, false);
});

test('host, account, context or navigation changes revoke cold proof recovery before another request', async () => {
  for (const change of [f => { f.NETWS.host = 'foreign.example'; }, f => { f.NETWS.acct = { id: 'other-owner' }; },
    f => { f.NATIVE_PLAYER.provisionalContext = { ...f.NATIVE_PLAYER.provisionalContext }; }, f => { f.NETWS.reload = true; }]) {
    const f = await coldProofFixture(); change(f);
    await assert.rejects(f.nativePlayerGuestRequest('/gaming/identity/play/claim-complete', { method: 'POST' }));
    assert.equal(f.requests.length, 0); assert.equal(f.NETWS.token, '');
  }
});

test('the cold retired-guest claim reconciles its original receipt before opening the canonical character on the title', async () => {
  const f = await coldProofFixture(), browserTokens = new Map();
  const binding = { subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' };
  const promoted = { provisional: false, binding, appSession: { token: 'canonical-game-session', acct: { id: 'canonical-account', nativeBound: true } } };
  const kept = { v: 1, char: { name: 'Original guest hero', realm: 0, cls: 'warrior', level: 7, xp: 432, bag: [{ id: 'original-loot' }] } };
  const target = { status: () => ({ keyPresent: true, hasRecord: true, pending: false }) };
  f.context.localStorage = { getItem: key => browserTokens.get(key), setItem: (key, value) => browserTokens.set(key, value) };
  f.context.netLinkWS = async () => true;
  f.context.fetch = async (url, init) => {
    f.requests.push({ url, ...init });
    return { ok: true, json: async () => url === '/gaming/identity/play/claim-complete' ? promoted
      : { enabled: true, bound: true, verified: true, binding, account: { id: 'canonical-account' } } };
  };
  f.session.get = async () => ({ exists: true, data: () => clone(kept) });
  f.session.resumeClaim = async () => {
    const result = await f.nativePlayerGuestRequest('/gaming/identity/play/claim-complete', { method: 'POST', body: { fixture: 'exact-original-operation' } });
    f.session.profile = () => target;
    await f.nativePlayerAcceptSession(result, f.NATIVE_PLAYER.provisionalContext);
    return { ...result, claimed: true };
  };
  assert.equal(f.NATIVE_PLAYER.claimPendingResume, true); assert.equal(f.SAVE.loaded, null);
  await f.nativePlayerFinishClaim();
  assert.equal(f.requests[0].headers.Authorization, 'Bearer retired-game-proof');
  assert.equal(f.requests[1].headers.Authorization, 'Bearer canonical-game-session');
  assert.equal(f.NETWS.token, 'canonical-game-session'); assert.equal(f.NETWS.acct.id, 'canonical-account');
  assert.equal(browserTokens.get('hallowmarch.token.game.example'), 'canonical-game-session');
  assert.equal(f.NATIVE_PLAYER.claimPendingResume, false); assert.equal(f.NATIVE_PLAYER.promoted, true);
  assert.equal(f.NATIVE_PLAYER.provisionalProofToken, ''); assert.equal(f.NATIVE_PLAYER.provisionalProofContext, null);
  assert.equal(f.SAVE.readConfirmed, true); assert.deepEqual(clone(f.SAVE.loaded), kept); assert.deepEqual(f.calls.titles, [kept]);
  assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.starts.length, 0); assert.equal(f.GAME.started, false);
});

test('concurrent Play clicks coalesce provisioning and wait for confirmed native read before starting', async () => {
  const bootstrapGate = deferred(), readGate = deferred(), f = fixture({ bootstrapGate, readGate });
  const a = f.nativePlayerBegin(fresh()), b = f.nativePlayerBegin(fresh()); await flush();
  assert.equal(f.calls.bootstrap, 1); assert.equal(f.calls.starts.length, 0);
  bootstrapGate.resolve(); await flush(); assert.equal(f.calls.reads, 1); assert.equal(f.calls.starts.length, 0);
  readGate.resolve(); await Promise.all([a, b]);
  assert.equal(f.calls.starts.length, 1); assert.equal(f.calls.starts[0].name, 'New recruit');
  assert.equal(f.SAVE.native, true); assert.equal(f.SAVE.backend, 'pod'); assert.equal(f.SAVE.readConfirmed, true);
  assert.equal(f.NATIVE_PLAYER.playFlight, null);
});

test('Play resumes the exact existing guest character instead of a new title choice', async () => {
  const snapshot = { v: 1, char: { name: 'Already adventuring', realm: 1, cls: 'warrior', level: 9, xp: 123, bag: [{ id: 'kept-item' }] }, settings: { quality: 'low' }, world: { keeps: [0, 1, 2] } };
  const f = fixture({ prior: { ownerDid: 'did:fixture:guest' }, snapshot }); await f.nativePlayerBegin(fresh());
  assert.equal(f.calls.bootstrap, 0); assert.equal(f.calls.resume, 1);
  assert.deepEqual(f.calls.starts, [snapshot.char]); assert.equal(f.calls.settings, 1); assert.equal(f.calls.world, 1);
  assert.deepEqual(clone(f.SAVE.loaded), snapshot);
});

test('a confirmed initial empty checkpoint permits the first new character', async () => {
  const f = fixture(); await f.nativePlayerBegin(fresh());
  assert.equal(f.calls.starts.length, 1); assert.equal(f.SAVE.loaded.char, null); assert.equal(f.SAVE.readConfirmed, true);
});

test('a missing mandatory guest checkpoint never becomes permission to start over', async () => {
  const f = fixture({ prior: { ownerDid: 'did:fixture:guest' }, snapshot: false }); await f.nativePlayerBegin(fresh());
  assert.equal(f.calls.starts.length, 0); assert.equal(f.SAVE.readConfirmed, false);
  assert.match(f.NATIVE_PLAYER.message, /checkpoint could not be confirmed/);
});

test('provisioning failure leaves native entry closed and preserves the current title', async () => {
  const f = fixture({ bootstrapFailure: true }); await f.nativePlayerBegin(fresh());
  assert.equal(f.GAME.started, false); assert.equal(f.calls.starts.length, 0); assert.equal(f.SAVE.readConfirmed, false);
  assert.match(f.NATIVE_PLAYER.message, /unavailable/); assert.equal(f.NATIVE_PLAYER.playFlight, null);
});

test('an unreadable existing character is preserved rather than replaced by a fresh character', async () => {
  const snapshot = { v: 1, char: { name: 'Original', realm: 99, cls: 'warrior', level: 9 } };
  const f = fixture({ prior: { ownerDid: 'did:fixture:guest' }, snapshot }); await f.nativePlayerBegin(fresh());
  assert.equal(f.calls.starts.length, 0); assert.equal(f.SAVE.readConfirmed, false);
  assert.match(f.NATIVE_PLAYER.message, /saved character could not be opened/);
});

test('changing host or account during a guest read cannot hydrate or start the old character', async () => {
  for (const change of [f => { f.NETWS.host = 'foreign.example'; }, f => { f.NETWS.acct = { id: 'foreign' }; }, f => { f.NETWS.reload = true; }]) {
    const readGate = deferred(), f = fixture({ readGate }); const opening = f.nativePlayerBegin(fresh()); await flush();
    assert.equal(f.calls.reads, 1); change(f); readGate.resolve(); await opening;
    assert.equal(f.calls.starts.length, 0); assert.equal(f.SAVE.readConfirmed, false); assert.equal(f.SAVE.loaded, null);
  }
});

test('an existing owner can defer recovery download until after key creation and play', async () => {
  const keyGate = deferred(), f = fixture({ canonical: true, keyPresent: false, hasRecord: false, keyGate });
  const opening = f.nativePlayerBegin(fresh()); await flush(); assert.equal(f.calls.keys, 1); assert.equal(f.calls.starts.length, 0);
  keyGate.resolve(); await opening; assert.equal(f.calls.starts.length, 1); assert.equal(f.calls.bootstrap, 0);
});

test('a different owner arriving during key creation cannot start the previous owner character', async () => {
  const keyGate = deferred(), f = fixture({ canonical: true, keyPresent: false, hasRecord: false, keyGate });
  const opening = f.nativePlayerBegin(fresh()); await flush(); f.NETWS.acct = { id: 'foreign-owner' }; keyGate.resolve(); await opening;
  assert.equal(f.calls.starts.length, 0); assert.match(f.NATIVE_PLAYER.message, /owner changed/);
});

test('native admission is checked again after the actual deferred graphics start resumes', async () => {
  for (const change of [f => { f.NETWS.acct = { id: 'foreign-owner' }; }, f => { f.NATIVE_PLAYER.profile = {}; }, f => { f.SAVE.readConfirmed = false; }]) {
    const graphicsGate = deferred(), f = fixture();
    Object.assign(f.context, { GRAPHICS_CONTEXT_LOST: false, GRAPHICS_STARTUP: { stopped: false }, resizeTimer: 0,
      TITLE_FRAME_PROMISE: graphicsGate.promise, TITLE_START_PROMISE: null, reportError() {},
      $: () => ({ hidden: false }), createPlayer(value) { f.calls.starts.push(clone(value)); throw Error('unexpected player creation'); } });
    vm.runInContext(startSource, f.context);
    const opening = f.nativePlayerBegin(fresh()); await flush();
    assert.ok(f.context.TITLE_START_PROMISE, 'the real graphics start is deferred'); assert.equal(f.calls.starts.length, 0);
    change(f); f.context.TITLE_FRAME_PROMISE = null; graphicsGate.resolve(); await opening;
    assert.equal(f.calls.starts.length, 0, 'deferred native start cannot create a player after admission changed');
    assert.equal(f.GAME.started, false);
  }
});

test('an existing encrypted character without its key requires recovery before play', async () => {
  const f = fixture({ canonical: true, keyPresent: false, hasRecord: true }); await f.nativePlayerBegin(fresh());
  assert.equal(f.calls.keys, 0); assert.equal(f.calls.starts.length, 0); assert.match(f.NATIVE_PLAYER.message, /recovery file/);
});

test('the provisional save port rejects revoked ownership both before and after a read', async () => {
  const readGate = deferred(), f = fixture({ readGate });
  await f.context.fixture.nativePlayerSaveRef({ active: true });
  const ref = f.nativePlayerProvisionalRef(f.session), reading = ref.get(); await flush();
  f.NETWS.acct = { id: 'another' }; readGate.resolve(); await assert.rejects(reading, error => error.code === 'revoked');
  await assert.rejects(ref.set({ v: 1, char: null }), error => error.code === 'revoked');
});

async function liveClaimFixture() {
  const f = fixture(); await f.nativePlayerSaveRef({ active: true });
  f.NATIVE_PLAYER.status = { ...f.NATIVE_PLAYER.status, bound: true, verified: true, provisional: true,
    binding: { subjectDid: 'did:fixture:guest', podUrl: 'https://pod.example/guest/' } };
  f.NATIVE_PLAYER.profile = f.profile; f.SAVE.readConfirmed = true; f.GAME.started = true;
  f.GAME.player = { name: 'Current hero', heldItem: 'latest-in-memory-item' };
  return f;
}

test('a promoted character adopts its canonical save target while local confirmation remains visibly pending', async () => {
  for (const flag of ['localSessionPending', 'localPersistencePending', 'latestProgressPending']) {
    const f = await liveClaimFixture(), player = f.GAME.player;
    const target = { status: () => ({ keyPresent: true, hasRecord: true, pending: false }) };
    f.session.profile = () => target; f.session.claimTarget = async () => ({ claimed: true, [flag]: true });
    await f.nativePlayerFinishClaim({ fixture: 'target' });
    assert.equal(f.NATIVE_PLAYER.profile, target); assert.equal(f.NATIVE_PLAYER.promoted, true);
    assert.equal(f.NATIVE_PLAYER.claimConfirmationPending, true); assert.match(f.NATIVE_PLAYER.message, /still pending/);
    assert.equal(f.GAME.player, player); assert.equal(f.GAME.started, true);
    assert.equal(f.SAVE.nativePaused, false); assert.equal(f.NATIVE_PLAYER.switching, false);
    f.session.retrySession = async () => ({ claimed: true, localSessionPending: false, localPersistencePending: false, latestProgressPending: false });
    await f.nativePlayerConfirmClaim();
    assert.equal(f.NATIVE_PLAYER.claimConfirmationPending, false); assert.match(f.NATIVE_PLAYER.message, /latest save confirmed/);
    assert.equal(f.GAME.player, player);
  }
});

test('a failed canonical copy readback keeps the provisional profile and live character intact', async () => {
  const f = await liveClaimFixture(), player = f.GAME.player;
  f.session.claimTarget = async () => { throw Object.assign(Error('Exact target readback is unavailable'), { code: 'claim_readback_failed' }); };
  await assert.rejects(f.nativePlayerFinishClaim({ fixture: 'target' }), { code: 'claim_readback_failed' });
  assert.equal(f.NATIVE_PLAYER.profile, f.profile); assert.equal(f.NATIVE_PLAYER.promoted, false);
  assert.equal(f.GAME.player, player); assert.equal(f.SAVE.nativePaused, false); assert.equal(f.NATIVE_PLAYER.switching, false);
});

test('an existing owner-character conflict remains an explicit choice without switching the live character', async () => {
  const f = await liveClaimFixture(), player = f.GAME.player;
  const conflict = { conflict: true, reason: 'owner_character_exists', existingCharacter: { name: 'Saved owner hero' } };
  f.session.claimTarget = async () => conflict;
  await f.nativePlayerFinishClaim({ fixture: 'target' });
  assert.equal(f.NATIVE_PLAYER.conflict, conflict); assert.equal(f.NATIVE_PLAYER.profile, f.profile);
  assert.equal(f.NATIVE_PLAYER.promoted, false); assert.equal(f.GAME.player, player); assert.match(f.NATIVE_PLAYER.message, /Choose which one/);
});

test('an unresolved source save prevents opening a canonical copy unless an explicit quota fallback was chosen', async () => {
  const f = await liveClaimFixture(); let copies = 0;
  f.session.claimTarget = async () => { copies++; return { claimed: true }; };
  f.context.saveNow = async () => { f.SAVE.pending = { char: { name: 'Dirty progress' } }; };
  await assert.rejects(f.nativePlayerFinishClaim({ fixture: 'target' }), { code: 'pod_pending' });
  assert.equal(copies, 0); assert.equal(f.SAVE.pending.char.name, 'Dirty progress'); assert.equal(f.NATIVE_PLAYER.promoted, false);
});

test('the Keep character popup binds its durable handoff to the original guest and preserves the active game token', async () => {
  const f = await liveClaimFixture(), values = new Map(), channels = [], notifications = [];
  let destination = null, closed = false;
  const popup = { sessionStorage: { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) },
    location: { replace(url) { destination = url; } }, close() { closed = true; } };
  f.context.window.open = () => popup;
  f.context.crypto = { randomUUID: () => '01234567-89ab-cdef-0123-456789abcdef' };
  f.context.BroadcastChannel = class { constructor(name) { this.name = name; channels.push(this); } close() {} };
  f.session.prepareClaim = async () => ({ browserCeremony: 'c'.repeat(43), authorizationUrl: 'https://identity.example/authorize' });
  f.context.nativePlayerFinishClaim = async result => { notifications.push(result); };
  f.nativePlayerClaimConnect(); await flush();
  assert.equal(closed, false); assert.equal(destination, 'https://identity.example/authorize');
  const ceremony = JSON.parse(values.get('hallowmarch.identity.ceremony.v1'));
  assert.equal(ceremony.purpose, 'character-claim-target'); assert.equal(ceremony.expectedOwnerDid, 'did:fixture:guest');
  assert.equal(ceremony.token, 'opaque-game-token'); assert.equal(f.NETWS.token, 'opaque-game-token');
  assert.equal(ceremony.browserCeremony, 'c'.repeat(43)); assert.equal(channels.length, 1);
  channels[0].onmessage({ data: { type: 'hallowmarch-native-claim-target', host: 'foreign.example', browserCeremony: 'c'.repeat(43) } });
  channels[0].onmessage({ data: { type: 'hallowmarch-native-claim-target', host: f.NETWS.host, browserCeremony: 'wrong-ceremony' } });
  await flush(); assert.equal(notifications.length, 0, 'foreign or unrelated popup messages cannot complete a claim');
  channels[0].onmessage({ data: { type: 'hallowmarch-native-claim-target', host: f.NETWS.host, browserCeremony: 'c'.repeat(43) } });
  await flush(); assert.equal(notifications.length, 1); assert.equal(notifications[0], undefined, 'opener resumes the durably staged handoff without a bearer in the notification');
});

test('opening an existing owner character pauses the old guest until confirmation without writing guest progress over it', async () => {
  const f = await liveClaimFixture(), player = f.GAME.player; let reloads = 0;
  const target = { status: () => ({ keyPresent: true, hasRecord: true, pending: false }) };
  f.context.location.reload = () => { reloads++; };
  f.NATIVE_PLAYER.conflict = { reason: 'owner_character_exists' };
  f.session.profile = () => target; f.session.useExistingTarget = async () => ({ claimed: true, localSessionPending: true });
  await f.nativePlayerUseExistingTarget();
  assert.equal(reloads, 0); assert.equal(f.NATIVE_PLAYER.promoted, true); assert.equal(f.NATIVE_PLAYER.openExistingPending, true);
  assert.equal(f.NATIVE_PLAYER.claimConfirmationPending, true); assert.equal(f.SAVE.nativePaused, true);
  assert.equal(f.calls.finalSaves, 1, 'only the preselection guest checkpoint is published');
  assert.equal(f.GAME.player, player); assert.equal(f.NATIVE_PLAYER.profile, target);
  Object.assign(f.context, { document: { hidden: false, hasFocus: () => true }, NET_HUMAN_PLAY: { focused: true }, UI: { modal: null } });
  vm.runInContext(eligibleSource + '\nglobalThis.eligible=netHumanEligible;', f.context);
  assert.equal(f.context.eligible(), false, 'the old guest cannot participate under the newly selected owner');
  f.session.retrySession = async () => ({ claimed: true }); await f.nativePlayerConfirmClaim();
  assert.equal(reloads, 1); assert.equal(f.NETWS.reload, true); assert.equal(f.calls.finalSaves, 1);
  assert.equal(f.SAVE.nativePaused, true, 'old guest saves stay paused through navigation to the selected character');
});

function pacedSaveFixture() {
  let now = 1000, live = true, nextTimer = 0; const timers = new Map(), writes = [];
  const SAVE = { nativeFlight: null, nativePaused: false, pending: null, chain: Promise.resolve(), guestWriteAt: 0,
    guestTimer: 0, guestFlush: false, lastBody: '', lastCore: '', ref: { async set(value) { writes.push(clone(value)); } } };
  const context = vm.createContext({ SAVE, Promise, Date: { now: () => now }, performance: { now: () => now },
    nativePlayerIsProvisional: () => true, netHumanLive: () => live, coreKey: value => JSON.stringify(value),
    NATIVE_PLAYER: {}, nativePlayerRender() {}, nativePlayerError: () => Error('unexpected native error'),
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); },
  });
  const source = saves.slice(saves.indexOf('function nativeSavePending('), saves.indexOf('function saveNow()'));
  vm.runInContext(source + '\nglobalThis.publish=nativeSavePending;', context);
  return { SAVE, writes, timers, publish: context.publish, setLive(value) { live = value; },
    async advance(ms) { now += ms; for (const [id, timer] of [...timers]) if (timer.at <= now) { timers.delete(id); timer.fn(); } await flush(); } };
}

test('routine guest saves coalesce to the latest character during the thirty-second checkpoint interval', async () => {
  const f = pacedSaveFixture(); f.SAVE.pending = { n: 1 }; await f.publish(); await flush();
  assert.deepEqual(f.writes, [{ n: 1 }]); const confirmedBody = f.SAVE.lastBody;
  f.SAVE.pending = { n: 2 }; await f.publish(); await flush();
  f.SAVE.pending = { n: 3 }; await f.publish(); await flush();
  assert.equal(f.writes.length, 1); assert.equal(f.timers.size, 1); assert.equal(f.SAVE.pending.n, 3);
  assert.equal(f.SAVE.lastBody, confirmedBody, 'coalescing does not acknowledge an unsaved checkpoint');
  await f.advance(29999); assert.equal(f.writes.length, 1);
  await f.advance(1); assert.deepEqual(f.writes, [{ n: 1 }, { n: 3 }]); assert.equal(f.SAVE.pending, null);
});

test('an explicit final guest checkpoint bypasses pacing and cancels its old timer', async () => {
  const f = pacedSaveFixture(); f.SAVE.pending = { n: 1 }; await f.publish(); await flush();
  f.SAVE.pending = { n: 2 }; await f.publish(); await flush(); assert.equal(f.timers.size, 1);
  f.setLive(false); await f.publish({ immediate: true }); await flush();
  assert.deepEqual(f.writes, [{ n: 1 }, { n: 2 }]); assert.equal(f.timers.size, 0); assert.equal(f.SAVE.pending, null);
});

test('a paced guest timer does not publish from an idle game and retains dirty progress', async () => {
  const f = pacedSaveFixture(); f.SAVE.pending = { n: 1 }; await f.publish(); await flush();
  f.SAVE.pending = { n: 2 }; await f.publish(); await flush(); f.setLive(false); await f.advance(30000);
  assert.deepEqual(f.writes, [{ n: 1 }]); assert.equal(f.SAVE.pending.n, 2); assert.equal(f.timers.size, 0);
});
