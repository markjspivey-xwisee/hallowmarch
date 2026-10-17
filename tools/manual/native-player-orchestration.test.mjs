import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { retainedGameBoot, verifiedContextHandoff, retainedNativeReload, retryNativeStartup, qaPageInventory, boundedPageStatus, retainCompletedNativeQa, nativeCheckpointReadResult } from './native-player-orchestration.mjs';

test('native checkpoint read output admits only fixed proof booleans, codes and numeric status', () => {
  assert.deepEqual(nativeCheckpointReadResult({ ok: true, found: true, checkpointVerified: true, hasNativeRevision: true,
    code: 'INTEGRITY', numericCode: 403, checkpointStage: 'headers', checkpointCheck: 'resource', privateBody: 'PRIVATE_BODY', accessToken: 'PRIVATE_TOKEN', nativeRevision: 'PRIVATE_REVISION' }),
  { ok: true, found: true, checkpointVerified: true, hasNativeRevision: true, code: 'INTEGRITY', numericCode: 403, checkpointStage: 'headers', checkpointCheck: 'resource' });
  assert.deepEqual(nativeCheckpointReadResult({ ok: 'PRIVATE', found: 1, code: 'PRIVATE_BODY', numericCode: 99999, checkpointStage: 'PRIVATE', checkpointCheck: 'PRIVATE_VALUE' }),
    { ok: false, found: false, checkpointVerified: false, hasNativeRevision: false, code: null, numericCode: null, checkpointStage: null, checkpointCheck: null });
});
test('committed checkpoint evidence exposes only bounded public digests and sizes', () => {
  const metadata = { knownCommitted: true, originalWriteMatched: true, cipherDigest: 'sha256:' + 'a'.repeat(64),
    nativeRevision: 'sha256:' + 'b'.repeat(64), recipientKeyHash: 'c'.repeat(64), storedBytes: 7942 };
  assert.deepEqual(Object.fromEntries(Object.entries(nativeCheckpointReadResult({ ...metadata, key: 'PRIVATE_KEY', ciphertext: 'PRIVATE_BYTES' }))
    .filter(([key]) => key in metadata)), metadata);
  assert.equal('cipherDigest' in nativeCheckpointReadResult({ ...metadata, storedBytes: 4194305 }), false);
});

test('success retention is opt-in, requires completion and never waits after finish', async () => {
  for (const input of [{ enabled: false, complete: true }, { enabled: '1', complete: true },
    { enabled: true, complete: false }, { enabled: true, complete: true, finishRequested: true }]) {
    assert.equal(await retainCompletedNativeQa(input), false);
  }
});
test('successful retention holds the existing episode until the original input closes', async () => {
  const events = []; let close;
  const closed = new Promise(resolve => { close = resolve; });
  let finished = false;
  const hold = retainCompletedNativeQa({ enabled: true, complete: true, finishRequested: false,
    announce: () => events.push('retained'), waitForClose: () => { events.push('original-input'); return closed; } });
  void hold.then(() => { finished = true; });
  await Promise.resolve();
  assert.equal(finished, false); assert.deepEqual(events, ['retained', 'original-input']);
  close(); assert.equal(await hold, true); assert.equal(finished, true);
  assert.deepEqual(events, ['retained', 'original-input']);
});

function fakeGame({ failNavigation = false, failReady = false } = {}) {
  const calls = { contexts: 0, pages: 0, navigations: 0, ready: 0 }, events = [];
  const page = { goto: async () => { calls.navigations++; events.push('navigate'); if (failNavigation) { failNavigation = false; throw new Error('sensitive navigation URL'); } },
    waitForFunction: async () => { calls.ready++; if (failReady) { failReady = false; throw new Error('sensitive renderer error'); } },
    locator: () => ({ first: () => ({ waitFor: async () => {} }) }) };
  const context = { newPage: async () => { calls.pages++; return page; } };
  const boot = retainedGameBoot({ createContext: async () => { calls.contexts++; return context; }, url: 'https://game.example/?private=test',
    onContext: () => events.push('retain-context'), onPage: () => events.push('retain-page'), onStep: value => events.push(value) });
  return { boot, calls, events, page };
}

test('navigation failure retains the page before navigation; retry reuses the single renderer', async () => {
  const fixture = fakeGame({ failNavigation: true });
  await assert.rejects(fixture.boot.open());
  assert(fixture.events.indexOf('retain-page') < fixture.events.indexOf('navigate'));
  assert.equal(await fixture.boot.open(), fixture.page);
  assert.deepEqual(fixture.calls, { contexts: 1, pages: 1, navigations: 2, ready: 1 });
  assert.equal(fixture.events.at(-1), 'complete');
});
test('a game-ready timeout also reuses the original page/context and fixed substeps', async () => {
  const fixture = fakeGame({ failReady: true });
  await assert.rejects(fixture.boot.open()); await fixture.boot.open();
  assert.equal(fixture.calls.contexts, 1); assert.equal(fixture.calls.pages, 1);
  assert.deepEqual([...new Set(fixture.events.filter(value => !value.startsWith('retain-') && value !== 'navigate'))],
    ['new-context', 'new-page', 'navigation', 'game-ready', 'identity-control', 'complete']);
});
test('handoff verifies reload/head then privacy before closing; fresh boot cannot precede close', async () => {
  const events = [], encryptedRecovery = { encrypted: 'opaque-node-memory' }, syntheticPasskey = { privateKey: 'node-memory-only' };
  let activeGames = 1;
  const handoff = verifiedContextHandoff({ verify: async () => events.push('exact-body-and-native-head'),
    privacy: async () => { events.push('privacy'); return true; }, close: async () => { events.push('close-first'); activeGames--; } });
  assert.throws(() => handoff.requireClosed(), { code: 'qa_context_handoff' });
  await handoff.run(); handoff.requireClosed();
  const fresh = retainedGameBoot({ createContext: async () => { assert.equal(activeGames, 0); activeGames++; return {
    newPage: async () => ({ goto: async () => events.push('fresh-navigation'), waitForFunction: async () => {},
      locator: () => ({ first: () => ({ waitFor: async () => {} }) }) }),
  }; }, url: 'https://game.example/' });
  await fresh.open();
  assert.deepEqual(events, ['exact-body-and-native-head', 'privacy', 'close-first', 'fresh-navigation']);
  assert.equal(activeGames, 1); assert(encryptedRecovery.encrypted); assert(syntheticPasskey.privateKey);
  assert.deepEqual(handoff.status(), { privacyVerified: true, closed: true });
});
test('failed head/body or privacy proof cannot close first context or admit a fresh game', async () => {
  for (const failure of ['verify', 'privacy']) {
    let closed = false;
    const handoff = verifiedContextHandoff({ verify: async () => { if (failure === 'verify') throw new Error('private body'); },
      privacy: async () => false, close: async () => { closed = true; } });
    await assert.rejects(handoff.run()); assert.equal(closed, false);
    assert.deepEqual(handoff.status(), { privacyVerified: false, closed: false });
    assert.throws(() => handoff.requireClosed(), { code: 'qa_context_handoff' });
  }
});
test('close retries preserve recorded proof without touching a possibly closed page again', async () => {
  let reads = 0, closes = 0;
  const handoff = verifiedContextHandoff({ verify: async () => { reads++; }, privacy: async () => { reads++; return true; },
    close: async () => { if (++closes === 1) throw new Error('closed while awaiting CDP'); } });
  await assert.rejects(handoff.run());
  assert.deepEqual(handoff.status(), { privacyVerified: true, closed: false });
  assert.throws(() => handoff.requireClosed());
  await handoff.run(); await handoff.run();
  assert.equal(reads, 2); assert.equal(closes, 2); handoff.requireClosed();
});
test('inventory includes game, relay, blank, other, and closed pages without printing URLs', () => {
  const secret = 'NEVER-LOG-BEARER';
  const urls = [`https://game.example/?token=${secret}`, `https://relay.example/oauth?code=${secret}`, 'about:blank',
    `https://other.example/${secret}`, `https://game.example/?code=${secret}`];
  const entries = urls.map((url, index) => ({ contextIndex: index < 4 ? 1 : 2,
    page: { url: () => url, isClosed: () => index === 4 } }));
  const inventory = qaPageInventory(entries, { gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example' });
  assert.equal(inventory.count, 5); assert.equal(inventory.openCount, 4); assert.equal(inventory.closedCount, 1);
  assert.deepEqual(inventory.originCounts, { game: 2, relay: 1, blank: 1, other: 1 });
  assert.deepEqual(inventory.pages.map(value => value.originClass), ['game', 'relay', 'blank', 'other', 'game']);
  assert(!JSON.stringify(inventory).includes(secret)); assert(!JSON.stringify(inventory).includes('https:'));
});
test('stalled status is bounded and repeated status cannot enqueue another evaluation', async () => {
  const page = {}, page2 = {}; let calls = 0, resolve;
  const inspect = boundedPageStatus({ timeoutMs: 15, evaluate: () => { calls++; return new Promise(done => { resolve = done; }); } });
  assert.deepEqual(await inspect(page), { inFlight: true, timedOut: true, unavailable: false });
  for (let i = 0; i < 20; i++) assert.deepEqual(await inspect(page, true), { inFlight: true, timedOut: true, unavailable: false });
  assert.equal(calls, 1);
  resolve({ ready: true }); await new Promise(done => setImmediate(done));
  const next = inspect(page2); assert.equal((await next).timedOut, true); assert.equal(calls, 2);
  resolve({ ready: true });
});
test('a timed-out evaluation can reject later without raw errors or an unhandled rejection', async () => {
  let reject;
  const inspect = boundedPageStatus({ timeoutMs: 10, evaluate: () => new Promise((_, fail) => { reject = fail; }) });
  assert.equal((await inspect({})).timedOut, true);
  reject(new Error('https://relay.example/?token=SECRET')); await new Promise(done => setImmediate(done));
});
test('status whitelists only booleans and bounded counts, never browser strings or keys', async () => {
  const secret = 'privateKey bearer token rawURL _signed_payload';
  const inspect = boundedPageStatus({ evaluate: async () => ({ ready: true, rawURL: secret, token: secret,
    nativeQa: { busy: true, nativePendingCount: 1, step: secret, code: secret, privateJwk: secret, tools: [secret], heldKeyPresent: false } }) });
  const result = await inspect({});
  assert.equal(result.state.ready, true); assert.equal(result.state.nativeQa.busy, true);
  assert.equal(result.state.nativeQa.nativePendingCount, 1); assert.equal(result.state.nativeQa.heldKeyPresent, false);
  assert(!JSON.stringify(result).includes(secret)); assert(!JSON.stringify(result).includes('privateJwk'));
  assert.equal(result.state.nativeQa.step, null); assert.equal(result.state.nativeQa.code, null);
  const useful = boundedPageStatus({ evaluate: async () => ({ nativeQa: { step: 'profile-confirmation-retry', code: 'pod_pending',
    profileState: 'uncertain', tools: [{ step: 'profile-publish', outcome: 'refused', code: 'confirmation_required', numericCode: 503,
      rawURL: secret, body: secret }] } }) });
  const report = (await useful({})).state.nativeQa;
  assert.equal(report.step, 'profile-confirmation-retry'); assert.equal(report.code, 'pod_pending');
  assert.deepEqual(report.tools, [{ step: 'profile-publish', outcome: 'refused', code: 'confirmation_required', numericCode: 503 }]);
  const failed = boundedPageStatus({ evaluate: async () => { throw new Error(secret); } });
  assert.deepEqual(await failed({}), { inFlight: false, timedOut: false, unavailable: true });
});
test('startup diagnostics expose only fixed native states and profile/read confirmation flags', async () => {
  const secret = 'Bearer private-body private-key https://private.example/owner';
  const inspect = boundedPageStatus({ evaluate: async () => ({ nativePlayer: {
    state: 'key_required', readConfirmed: false, loaded: false, started: false, loading: true, loadPhase: 'read',
    refPresent: true, refBlocked: false, profilePresent: true, ownerDid: secret, credential: secret,
    profileStatus: { state: 'ready', keyPresent: true, hasRecord: true, pending: false, indexed: true, linked: false,
      profileGraphIri: secret, record: secret, privateJwk: secret },
  } }) });
  assert.deepEqual((await inspect({})).state.nativePlayer, {
    state: 'key_required', loadPhase: 'read', readConfirmed: false, loaded: false, started: false, loading: true,
    refPresent: true, refBlocked: false, profilePresent: true,
    profileStatus: { state: 'ready', keyPresent: true, hasRecord: true, pending: false, indexed: true, linked: false },
  });
  const malicious = boundedPageStatus({ evaluate: async () => ({ nativePlayer: {
    state: secret, loadPhase: secret, readConfirmed: secret, profileStatus: { state: secret, keyPresent: secret, record: secret },
  } }) });
  const result = (await malicious({})).state.nativePlayer;
  assert.equal(result.state, null); assert.equal(result.loadPhase, null); assert.equal(result.readConfirmed, false);
  assert.equal(result.profileStatus.state, null); assert.equal(result.profileStatus.keyPresent, false);
  assert(!JSON.stringify(result).includes(secret));
});
test('fresh verification retries retain the one changed document and its pending private read', async () => {
  const calls = { before: 0, prepare: 0, reload: 0, document: 0, wait: 0, exact: 0 }; let pending = true;
  const reload = retainedNativeReload({ verifyBeforeReload: async () => { calls.before++; }, prepareReload: async () => { calls.prepare++; },
    reload: async () => { calls.reload++; }, waitForNewDocument: async () => { calls.document++; },
    waitForSave: async () => { calls.wait++; if (pending) throw Error('native read still pending'); }, verifyLoaded: async () => { calls.exact++; } });
  await assert.rejects(reload.run()); await assert.rejects(reload.run());
  assert.deepEqual(reload.status(), { beforeVerified: true, prepared: true, reloadAttempted: true, documentConfirmed: true, complete: false });
  pending = false; await reload.run(); await reload.run();
  assert.deepEqual(calls, { before: 1, prepare: 1, reload: 1, document: 1, wait: 3, exact: 1 }); assert.equal(reload.status().complete, true);
});
test('a thrown reload is never replayed and an unchanged document cannot prove recovery', async () => {
  let reloads = 0, changed = false, waits = 0;
  const reload = retainedNativeReload({ verifyBeforeReload: async () => {}, prepareReload: async () => {},
    reload: async () => { reloads++; throw Error('navigation timeout after request'); },
    waitForNewDocument: async () => { if (!changed) throw Error('same document'); },
    waitForSave: async () => { waits++; }, verifyLoaded: async () => {} });
  await assert.rejects(reload.run()); await assert.rejects(reload.run()); assert.equal(reloads, 1); assert.equal(waits, 0);
  changed = true; await reload.run(); assert.equal(reloads, 1); assert.equal(waits, 1); assert.equal(reload.status().complete, true);
});
function startupPage() {
  let clicks = 0;
  const h = { ready: true, GAME: { started: false }, SAVE: { native: true, readConfirmed: false },
    net: { NETWS: { acct: { id: 'fixture-owner', nativeBound: true } } }, nativePlayerStatus: () => ({ profileStatus: { pending: false } }) };
  const button = { textContent: 'Retry connection', disabled: false, click: () => { clicks++; } };
  const location = { origin: 'https://game.example' };
  const page = { isClosed: () => false, evaluate: async (fn, input) => vm.runInNewContext('(' + fn.toString() + ')(input)',
    { window: { __hm: h }, location, document: { querySelectorAll: () => [button] }, input }) };
  return { h, button, location, page, clicks: () => clicks };
}
test('startup retry clicks only the original owner title button and confirmed reads need no click', async () => {
  const f = startupPage(), args = { page: f.page, expectedAccountId: 'fixture-owner', gameOrigin: f.location.origin };
  assert.deepEqual(await retryNativeStartup(args), { kind: 'native_startup_retry', clicked: true, alreadyConfirmed: false }); assert.equal(f.clicks(), 1);
  f.h.SAVE.readConfirmed = true;
  assert.deepEqual(await retryNativeStartup(args), { kind: 'native_startup_retry', clicked: false, alreadyConfirmed: true }); assert.equal(f.clicks(), 1);
});
test('startup retry refuses another owner, host, running game, pending writes and disabled controls', async () => {
  for (const change of [f => { f.h.net.NETWS.acct.id = 'another-owner'; }, f => { f.location.origin = 'https://another.example'; },
    f => { f.h.GAME.started = true; }, f => { f.h.SAVE.pending = { private: 'live progress' }; },
    f => { f.h.SAVE.nativeFlight = Promise.resolve(); }, f => { f.h.SAVE.wiping = true; },
    f => { f.h.nativePlayerStatus = () => ({ profileStatus: { pending: true } }); },
    f => { f.h.net.NETWS.reload = true; }, f => { f.button.disabled = true; }, f => { f.page.isClosed = () => true; }]) {
    const f = startupPage(); change(f);
    await assert.rejects(retryNativeStartup({ page: f.page, expectedAccountId: 'fixture-owner', gameOrigin: 'https://game.example' }), { code: 'qa_startup_retry_refused' });
    assert.equal(f.clicks(), 0);
  }
});
