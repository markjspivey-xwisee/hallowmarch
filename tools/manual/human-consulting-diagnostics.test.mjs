import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { createHumanConsultingDiagnostics, readHumanConsultingDiagnostic,
  recoverHumanConsultingPendingSave, safeHumanConsultingDiagnostic } from './human-consulting-diagnostics.mjs';

// Deliberately offline fixtures. No browser, native identity or network service.
const gameOrigin = 'https://game.example';
const owner = { accountId: 'fixture', subjectDid: 'did:web:fixture.example:owner', podUrl: 'https://pods.example/fixture/' };
function fixture({ note = '', wrongOwner = false, knownPlan = true, stopped = false, ambiguous = false } = {}) {
  const clicks = [], calls = [], token = 'PRIVATE-TOKEN-MUST-NOT-LEAVE';
  const binding = { ...owner, authenticatedAgentDid: 'did:web:fixture.example:delegate' };
  const id = 'urn:hallowmarch:consultation:fixture';
  const controls = new Map([
    ['march-consulting-note', { textContent: note }],
    ['march-consulting-retry', { hidden: false, disabled: false, click: () => clicks.push('confirm') }],
    ['march-coach-continue', { hidden: false, disabled: false, click: () => clicks.push('continue') }],
    ['march-consulting-connect', { hidden: false, disabled: false, click: () => clicks.push('enable') }],
  ]);
  const transport = { token, generation: 1, acct: { id: owner.accountId, nativeBound: true } };
  const game = { GAME: { started: true, player: { alive: true } }, net: { NETWS: transport },
    SAVE: { native: true, readConfirmed: true, lastBody: JSON.stringify({ char: { x: { coachDelivery: { pending: { id, stage: 'intent' } } } } }) },
    consulting: { status: { connected: true, busy: false, enabled: !stopped, reviewed: true, hasPlan: knownPlan, hasPrivatePlan: false } } };
  const trace = { memo: { payload: { situation: { id } } }, memos: [{}], deliveries: 1, coachingCalls: 3, intentConfirmed: true, enableClicked: true, ambiguous };
  const pinned = { ...owner, binding, gameOrigin, game, transport, player: game.GAME.player, token, generation: 1 };
  if (wrongOwner) pinned.accountId = 'other-fixture';
  const context = vm.createContext({ window: { __hm: game, __hmNativeHumanConsultingOwner: pinned, __hmNativeHumanConsultingTrace: trace },
    location: { origin: gameOrigin, host: 'game.example' }, localStorage: { getItem: () => token },
    document: { getElementById: id => controls.get(id) || null }, AbortSignal,
    async fetch(url) { calls.push(url); return { ok: true, json: async () => ({ verified: true, bound: true, account: { id: owner.accountId }, binding }) }; },
  });
  return { clicks, calls, context, game, trace,
    diagnostic: () => vm.runInContext(`(${readHumanConsultingDiagnostic})`, context)({ owner, gameOrigin }),
    recover: () => vm.runInContext(`(${recoverHumanConsultingPendingSave})`, context)({ owner, gameOrigin }) };
}
test('actual diagnostic returns fixed flags and category without private note, token, subject or plan', async () => {
  const f = fixture({ note: 'Foxxi returned a plan for an unverified performer or situation.' });
  const result = await f.diagnostic();
  assert.equal(result.ownerPinned, true); assert.equal(result.ownerVerified, true);
  assert.equal(result.noteCategory, 'response_contract_refused'); assert.equal(result.hasPlan, true);
  assert.equal(result.intentMatchesMemo, true); assert.equal(result.deliveries, 1);
  assert.equal(result.recoveryPortPresent, false); assert.deepEqual(f.clicks, []);
  const text = JSON.stringify(result); for (const privateValue of ['PRIVATE', owner.subjectDid, owner.podUrl, 'unverified performer']) assert.equal(text.includes(privateValue), false);
});
test('unknown error content becomes other and owner mismatch performs no identity or coaching call', async () => {
  const f = fixture({ wrongOwner: true, note: 'PRIVATE-RESPONSE-DETAILS' }), result = await f.diagnostic();
  assert.equal(result.ownerPinned, false); assert.equal(result.ownerVerified, false); assert.equal(result.noteCategory, 'other');
  assert.deepEqual(f.calls, []); assert.deepEqual(f.clicks, []); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
for (const override of [{ wrongOwner: true }, { knownPlan: false }, { stopped: true }, { ambiguous: true }, {}]) {
  test('deployed source recovery refuses unavailable proof without any UI click: ' + JSON.stringify(override), async () => {
    const f = fixture(override); await assert.rejects(f.recover(), { code: 'qa_human_recovery_refused' });
    assert.deepEqual(f.clicks, []); assert.deepEqual(f.calls, []); assert.equal(f.trace.deliveries, 1);
  });
}
test('Node diagnostic boundary ignores arbitrary fields and categories', () => {
  const result = safeHumanConsultingDiagnostic({ ownerVerified: 'PRIVATE', busy: true, deliveries: -1, memoCount: 5000,
    coachingCalls: 3, noteCategory: 'PRIVATE', response: 'PRIVATE', token: 'PRIVATE' });
  assert.equal(result.ownerVerified, false); assert.equal(result.busy, true); assert.equal(result.deliveries, null);
  assert.equal(result.memoCount, null); assert.equal(result.coachingCalls, 3); assert.equal(result.noteCategory, 'other');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
test('bounded retained diagnostic allows one read in flight and never queues duplicate reads', async () => {
  let calls = 0, release;
  const page = { isClosed: () => false, evaluate(fn) { assert.equal(fn, readHumanConsultingDiagnostic); calls++; return new Promise(resolve => { release = resolve; }); } };
  const diagnostic = createHumanConsultingDiagnostics({ getPage: () => page, getOwner: () => owner, gameOrigin, timeoutMs: 5 });
  assert.equal((await diagnostic.diagnose()).timedOut, true);
  assert.equal((await diagnostic.diagnose()).inFlight, true); assert.equal(calls, 1);
  release({ busy: true, noteCategory: 'reviewing', privateContent: 'PRIVATE' }); await new Promise(resolve => setImmediate(resolve));
  const next = diagnostic.diagnose(); await new Promise(resolve => setImmediate(resolve)); assert.equal(calls, 2);
  release({ busy: false, hasPlan: false, noteCategory: 'response_contract_refused' });
  assert.equal((await next).noteCategory, 'response_contract_refused');
});
