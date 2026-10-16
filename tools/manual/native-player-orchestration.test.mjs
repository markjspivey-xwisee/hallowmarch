import assert from 'node:assert/strict';
import test from 'node:test';
import { retainedGameBoot, verifiedContextHandoff, qaPageInventory, boundedPageStatus } from './native-player-orchestration.mjs';

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
