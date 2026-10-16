/** Offline fixtures only: no live browser, external HTTP, identity/pod writes or live PASS. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createHumanConsultingLiveQa, guardHumanConsultingOwner } from './human-consulting-live.mjs';

test('constructing manual coaching QA performs no I/O and missing own-page scope fails before any delivery', async () => {
  let networkCalls = 0;
  const previous = globalThis.fetch;
  globalThis.fetch = () => { networkCalls++; throw Error('No network is permitted in this offline guard check.'); };
  try {
    const qa = createHumanConsultingLiveQa({ getPage: () => null, getOwner: () => null,
      gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example', run: 'offline-guard' });
    const before = qa.status();
    assert.equal(before.step, 'not-started'); assert.equal(before.requestClicked, false); assert.equal(before.complete, false);
    await assert.rejects(qa.run(), { code: 'qa_human_owner' });
    assert.equal(networkCalls, 0); assert.equal(qa.status().requestClicked, false); assert.equal(qa.status().complete, false);
  } finally { globalThis.fetch = previous; }
});

const deferred = () => { let resolve, reject; const promise = new Promise((done, fail) => { resolve = done; reject = fail; }); return { promise, resolve, reject }; };
test('concurrent helper runs share one real request click and an uncertain acknowledgement never permits another', async () => {
  const request = deferred(), entered = deferred(), counts = { connect: 0, review: 0, request: 0, checks: 0 };
  const page = { isClosed: () => false,
    async evaluate(fn, input) {
      if (fn === guardHumanConsultingOwner) {
        if (input.action === 'connect') counts.connect++;
        if (input.action === 'review') counts.review++;
        if (input.action === 'retain' || input.action === 'share') counts.checks++;
        if (input.action === 'request') { counts.request++; entered.resolve(); await request.promise; }
        return true;
      }
      if (input?.goal) return { healthPercent: 100 };
    },
    async waitForFunction(fn) { if (fn.toString().includes('hasPrivatePlan')) throw Error('The original response remains unknown.'); },
    locator(id) { return { isVisible: async () => true, waitFor: async () => {}, fill: async () => {},
      check: async () => { counts.checks++; }, async click() {
        if (id === '#march-consulting-connect') counts.connect++;
        if (id === '#march-consulting-review') counts.review++;
        if (id === '#march-consulting-request') { counts.request++; entered.resolve(); await request.promise; }
      } }; },
  };
  const qa = createHumanConsultingLiveQa({ getPage: () => page, getOwner: () => ({ accountId: 'fixture-account', subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' }),
    gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example', run: 'offline-concurrency-guard' });
  const first = qa.run(); await entered.promise;
  const second = qa.run(); assert.equal(second, first); assert.equal(qa.status().busy, true);
  assert.deepEqual(counts, { connect: 1, review: 1, request: 1, checks: 2 });
  const failedFirst = assert.rejects(first, /uncertain request acknowledgement/), failedSecond = assert.rejects(second, /uncertain request acknowledgement/);
  request.reject(Error('uncertain request acknowledgement')); await Promise.all([failedFirst, failedSecond]);
  assert.equal(qa.status().busy, false); assert.equal(qa.status().requestClicked, true);
  await assert.rejects(qa.run(), /original response remains unknown/);
  assert.deepEqual(counts, { connect: 1, review: 1, request: 1, checks: 2 }); assert.equal(qa.status().complete, false);
});

function readbackFixture({ readGate, closeGate } = {}) {
  const owner = { accountId: 'fixture-account', subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' };
  const delegate = 'did:fixture:delegate', metrics = { healthPercent: 100, level: 1, creatureDefeats: 0, deaths: 0, activePlaySeconds: 5, nearbyHostiles: 0, ownedCompanions: 0 };
  const memo = { taskId: 'fixture-task', situationId: 'fixture-situation', goal: 'Synthetic offline guard', observed: 'No plan yet', desired: 'Exact private readback', context: 'Software fixture, no achievement claim.',
    observedContext: { capturedAt: '2026-10-16T22:00:00.000Z', metrics } };
  const live = { FOXXI_PLANNER_DESCRIPTOR: 'https://foxxi.example/affordance', FOXXI_PLANNER_ACTION: 'urn:fixture:planner' };
  const displayed = { source: { descriptorUrl: live.FOXXI_PLANNER_DESCRIPTOR, performerDid: owner.subjectDid, performerKind: 'human', signatureAuthority: 'relay-delegated' },
    service: { action: live.FOXXI_PLANNER_ACTION, target: 'https://foxxi.example/plan' }, response: { classifiedBy: delegate,
      diagnosis: { situationId: memo.situationId }, plan: { situationId: memo.situationId } }, foxxiPersonalRecordCreated: false, competencyClaims: [] };
  const observation = { id: 'fixture-observation', ownerDid: owner.subjectDid, performerKind: 'human', competencyStatus: 'not-assessed',
    task: { id: memo.taskId, observedResult: memo.observed, desiredResult: memo.desired, workContext: memo.goal + '\n' + memo.context },
    evidence: [{ kind: 'owner-browser-observation', performerDid: owner.subjectDid, at: memo.observedContext.capturedAt, metrics }] };
  const consultation = { ownerDid: owner.subjectDid, observationId: observation.id, response: displayed, service: displayed.service,
    competencyStatus: 'not-assessed', epistemicStatus: 'service-response-unvalidated-effect' };
  const transport = { token: 'fixture-only-app-proof', generation: 1, acct: { id: owner.accountId, nativeBound: true } };
  const game = { GAME: { started: true }, SAVE: { native: true }, net: { NETWS: transport } };
  const win = { __hm: game, __hmNativeHumanConsultingQa: memo, __hmNativeHumanConsultingTrace: { deliveryAttempts: 1 } };
  const location = { origin: 'https://game.example', host: 'game.example' }, status = { verified: true, bound: true,
    account: { id: owner.accountId }, binding: { subjectDid: owner.subjectDid, podUrl: owner.podUrl, authenticatedAgentDid: delegate } };
  win.__hmNativeHumanConsultingOwner = { game, transport, token: transport.token, generation: transport.generation, gameOrigin: location.origin,
    accountId: owner.accountId, subjectDid: owner.subjectDid, podUrl: owner.podUrl, binding: structuredClone(status.binding) };
  const clicks = {}, controls = Object.fromEntries(['connect','review','retain','share','request'].map(action => {
    const id = 'march-consulting-' + action, control = { type: ['retain','share'].includes(action) ? 'checkbox' : 'button', disabled: false, hidden: false, checked: false,
      click() { clicks[action] = (clicks[action] || 0) + 1; if (control.type === 'checkbox') control.checked = !control.checked; } }; return [id, control];
  }));
  const preview = { situation: { id: memo.situationId, observed: memo.observed, competency: memo.goal + '\n' + memo.context, modalStatus: 'Hypothetical', performer: { id: owner.subjectDid, kind: 'human' } } };
  const counts = { requests: 0, reads: 0, journalClosed: 0, cacheClosed: 0 }, readEntered = deferred(), closeEntered = deferred();
  const cache = { get: async () => ({ credential: { kind: 'offline-fixture-only' } }), async close() { counts.cacheClosed++; closeEntered.resolve(); if (closeGate) await closeGate.promise; } };
  const journal = { connect: async () => {}, async read() { counts.reads++; readEntered.resolve(); if (readGate) await readGate.promise; return { observations: [observation], consultations: [consultation] }; }, close() { counts.journalClosed++; } };
  const values = { window: win, location, document: {
      querySelector: selector => selector === '#march-consulting-preview pre' ? { textContent: JSON.stringify(preview) } : { dataset: { resultKey: JSON.stringify(displayed) } },
      getElementById: id => controls[id],
    },
    localStorage: { getItem: () => transport.token }, fetch: async (url, input) => {
      assert.equal(url, '/gaming/identity/status'); assert.equal(input.headers.Authorization, 'Bearer fixture-only-app-proof');
      counts.requests++; return { ok: true, json: async () => structuredClone(status) };
    } };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  return { owner, status, game, location, transport, counts, readEntered, closeEntered, win, clicks, preview,
    modules: [{ createBrowserAccessCache: () => cache }, { createOwnerPerformanceConsultation: () => journal }, live],
    args: { owner, relayOrigin: 'https://relay.example', gameOrigin: 'https://game.example' },
    restore() { for (const [key, descriptor] of previous) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key]; },
  };
}

test('private readback confirms the same native binding after the read and returns only proof booleans', async () => {
  const { readHumanConsultingPlan } = await import('./human-consulting-live.mjs');
  const f = readbackFixture();
  try {
    assert.deepEqual(await readHumanConsultingPlan(f.args, f.modules), { exactObservation: true, attributedLiveResponse: true, exactPrivatePlan: true, noAchievementClaims: true, singleDeliveryAttempt: true });
    assert.deepEqual(f.counts, { requests: 2, reads: 1, journalClosed: 1, cacheClosed: 1 });
  } finally { f.restore(); }
});

test('account, origin, game session and native binding changes during a private read cannot produce a PASS', async () => {
  const { readHumanConsultingPlan } = await import('./human-consulting-live.mjs');
  for (const change of [f => { f.transport.acct.id = 'another-account'; }, f => { f.location.origin = 'https://another.example'; },
    f => { f.game.GAME.started = false; }, f => { f.transport.generation++; }, f => { f.transport.token = 'another-fixture-proof'; },
    f => { f.status.binding.subjectDid = 'did:fixture:another-owner'; }, f => { f.status.binding.podUrl = 'https://pod.example/another/'; },
    f => { f.status.binding.authenticatedAgentDid = 'did:fixture:another-delegate'; }]) {
    const readGate = deferred(), f = readbackFixture({ readGate });
    try {
      const read = readHumanConsultingPlan(f.args, f.modules), rejected = assert.rejects(read, { code: 'qa_human_owner_changed' });
      await f.readEntered.promise; change(f); readGate.resolve(); await rejected;
      assert.equal(f.counts.reads, 1); assert.equal(f.counts.journalClosed, 1); assert.equal(f.counts.cacheClosed, 1);
    } finally { f.restore(); }
  }
});

test('an owner change during final cache cleanup also rejects previously computed proof flags', async () => {
  const { readHumanConsultingPlan } = await import('./human-consulting-live.mjs');
  const closeGate = deferred(), f = readbackFixture({ closeGate });
  try {
    const read = readHumanConsultingPlan(f.args, f.modules), rejected = assert.rejects(read, { code: 'qa_human_owner_changed' });
    await f.closeEntered.promise; f.transport.acct.id = 'another-account'; closeGate.resolve(); await rejected;
  } finally { f.restore(); }
});

test('owner changes after connection or review reject before either checkbox or request click', async () => {
  for (const phase of ['connect', 'review']) for (const change of [f => { f.transport.acct.id = 'another-account'; },
    f => { f.transport.token = 'another-proof'; }, f => { f.transport.generation++; },
    f => { f.location.origin = 'https://another.example'; }, f => { f.status.binding.subjectDid = 'did:fixture:another-owner'; },
    f => { f.status.binding.authenticatedAgentDid = 'did:fixture:another-delegate'; }]) {
    const f = readbackFixture(); delete f.win.__hmNativeHumanConsultingOwner; delete f.win.__hmNativeHumanConsultingTrace;
    const page = { isClosed: () => false, evaluate: (fn, input) => fn(input),
      async waitForFunction(fn) {
        const source = fn.toString();
        if (phase === 'connect' && source.includes('status.connected') || phase === 'review' && source.includes('status.reviewed')) change(f);
      },
      locator() { return { isVisible: async () => true, waitFor: async () => {}, fill: async () => {} }; },
    };
    const qa = createHumanConsultingLiveQa({ getPage: () => page, getOwner: () => f.owner,
      gameOrigin: f.args.gameOrigin, relayOrigin: f.args.relayOrigin, run: 'offline-presend-guard' });
    try {
      await assert.rejects(qa.run(), { code: 'qa_human_owner_changed' });
      assert.equal(f.clicks.connect, 1); assert.equal(f.clicks.retain || 0, 0); assert.equal(f.clicks.share || 0, 0); assert.equal(f.clicks.request || 0, 0);
      assert.equal(qa.status().requestClicked, false); assert.equal(qa.status().complete, false);
      assert.equal(f.counts.reads, 0, 'No private readback or delivery begins after the owner switch.');
    } finally { f.restore(); }
  }
});

test('preview must identify the pinned human performer before consent or request controls can be used', async () => {
  for (const action of ['preview', 'retain', 'share', 'request']) for (const performer of [{ id: 'did:fixture:another-owner', kind: 'human' }, { id: 'did:fixture:owner', kind: 'agent' }]) {
    const f = readbackFixture(); f.preview.situation.performer = performer;
    try {
      await assert.rejects(guardHumanConsultingOwner({ ...f.args, action }), { code: 'qa_human_owner_changed' });
      assert.deepEqual(f.clicks, {});
    } finally { f.restore(); }
  }
});

test('an owner change while the immediate pre-click binding check waits cannot click either consent or request', async () => {
  for (const action of ['retain', 'share', 'request']) {
    const f = readbackFixture(), response = deferred(), entered = deferred();
    const original = globalThis.fetch;
    globalThis.fetch = async (...args) => { entered.resolve(); await response.promise; return original(...args); };
    try {
      const pending = guardHumanConsultingOwner({ ...f.args, action }), rejected = assert.rejects(pending, { code: 'qa_human_owner_changed' });
      await entered.promise; f.transport.acct.id = 'another-account'; response.resolve(); await rejected;
      assert.deepEqual(f.clicks, {});
    } finally { f.restore(); }
  }
});
