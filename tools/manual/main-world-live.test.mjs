import test from 'node:test';
import assert from 'node:assert/strict';
import { createMainWorldLiveQa, mainWorldLiveMotionEvidence, mainWorldAdmissionCanRestart,
  mainWorldPauseCanRecover, mainWorldPauseProof, openMainWorldCompanionControls } from './main-world-live.mjs';

const uuid = 'b311cc62-f50a-471a-965d-413c36954669';
const observation = () => ({ ownerId: 'owner-1', bodyId: 'owner-1:companion:' + uuid, confirmedCommands: 8,
  elapsedMs: 5100, gameElapsed: 1.4, humanInputObserved: true, overlappingInputObserved: true,
  companionMeters: .69, humanMeters: .42, peerBodyId: uuid, peerSeen: 3, peerCompanionMeters: .68 });

test('Companion navigation chooses the independent fixture agent through explicit manual entry', async () => {
  const calls = [], open = new Set();
  const page = { locator(selector) {
    assert.notEqual(selector, '#btn-net', 'Players is not the agent setup surface');
    return {
      async isVisible() { return open.has(selector); },
      async click() { calls.push('click:' + selector);
        if (selector === '#btn-menu') open.add('#menu');
        if (selector === '#menu-tabs [data-tab="companion"]') open.add('#world-agent-controls');
        if (selector.endsWith(' > summary')) open.add(selector.slice(0, -' > summary'.length));
      },
      async waitFor(options) { assert.deepEqual(options, { state: 'visible', timeout: 30000 }); assert(open.has(selector)); },
      async evaluate(predicate) { return predicate({ open: open.has(selector) }); },
      async selectOption(value) { calls.push('select:' + selector + ':' + value); },
    };
  } };
  await openMainWorldCompanionControls(page, { manualAgent: true });
  assert.deepEqual(calls, ['click:#btn-menu', 'click:#menu-tabs [data-tab="companion"]',
    'click:#world-agent-advanced > summary', 'select:#world-agent-choice:manual', 'click:#world-agent-manual > summary']);
  calls.length = 0;
  await openMainWorldCompanionControls(page, { advanced: true });
  assert.deepEqual(calls, [], 'an open scope view does not change the selected actor or re-toggle details');
});

test('expired unsigned native challenges can restart without replaying an admission attempt', () => {
  const base = { stopped: false, reference: {}, localRevoked: false, completeAttempted: false,
    admission: null, challenge: { expiresAt: 100 }, envelope: null, now: 101 };
  assert.equal(mainWorldAdmissionCanRestart(base), true);
  for (const patch of [{ now: 99 }, { challenge: null }, { stopped: true }, { reference: null },
    { localRevoked: true }, { envelope: { signed: true } }, { admission: { expiresAt: 100 } }]) {
    assert.equal(mainWorldAdmissionCanRestart({ ...base, ...patch }), false);
  }
  assert.equal(mainWorldAdmissionCanRestart({ ...base, completeAttempted: true, envelope: { signed: true } }), true);
  assert.equal(mainWorldAdmissionCanRestart({ ...base, completeAttempted: true, admission: { expiresAt: 100 } }), true);
  assert.equal(mainWorldAdmissionCanRestart({ ...base, completeAttempted: true, admission: { expiresAt: 102 } }), false);
});

test('constructing the fixed companion proof plan performs no I/O or live mutation', () => {
  const qa = createMainWorldLiveQa({ config: {}, getPage() { throw Error('must remain lazy'); }, signNativeRequest() { throw Error('no signing'); } });
  assert.equal(qa.status().total, 8); assert.equal(qa.status().completed, 0); assert.equal(qa.status().stage, 'actual-main-game-entry');
  assert.equal(qa.status().separateCompanion, false); assert.equal(qa.status().nativeCompanionSave, false);
  assert.equal(qa.status().companionReloaded, false); qa.close();
});
test('public grant read refuses before the one original publication without opening a page', async () => {
  let pages = 0;
  const qa = createMainWorldLiveQa({ config: {}, getPage() { pages++; throw Error('must remain lazy'); } });
  await assert.rejects(qa.readGrant(), { code: 'qa_world_grant_read_refused' });
  assert.equal(pages, 0); assert.equal(qa.status().publicationClicked, false); assert.equal(qa.status().lastGrantRead, null); qa.close();
});

test('movement evidence distinguishes simultaneous real human and companion bodies with peer projection', () => {
  const result = mainWorldLiveMotionEvidence(observation());
  assert.equal(result.distinctCompanion, true); assert.equal(result.simultaneousInput, true); assert.equal(result.ordinaryClock, true);
  assert.equal(result.confirmedCommands, 8); assert.equal(result.movedMeters, .69); assert.equal(result.humanMovedMeters, .42);
  assert.equal(result.sameOwnerMultiConnection, true);
  assert(!JSON.stringify(result).includes(uuid), 'Safe evidence does not expose a private body identity');
});

test('human possession, autonomous-only movement, ack-only commands and wrong peer bodies cannot pass', () => {
  const invalid = [
    { bodyId: 'owner-1' }, { bodyId: 'another-owner:companion:' + uuid }, { bodyId: 'owner-1:companion:invalid' },
    { confirmedCommands: 7 }, { elapsedMs: 200 }, { gameElapsed: 0 }, { humanInputObserved: false },
    { overlappingInputObserved: false }, { humanMeters: 0 }, { companionMeters: 0 }, { companionMeters: 100 },
    { peerSeen: 0 }, { peerCompanionMeters: 0 }, { peerBodyId: 'another-companion' },
  ];
  for (const patch of invalid) assert.throws(() => mainWorldLiveMotionEvidence({ ...observation(), ...patch }));
});

test('manual pause recovery requires its exact failed phase and all eight known acknowledgements', () => {
  const inputs = Array.from({ length: 8 }, () => ({ attempted: true, confirmed: true }));
  const eligible = { stage: 'actual-main-game-owner-revocation', busy: false, failed: true, stopped: false, reference: {},
    localRevoked: false, podRevoked: false, paused: false, signedAdmission: true, mainWorldMoved: true,
    humanMoved: true, peerSawMovement: true, renewed: true, movementInputs: inputs };
  assert.equal(mainWorldPauseCanRecover(eligible), true);
  for (const patch of [{ stage: 'actual-main-game-movement-and-peer' }, { busy: true }, { failed: false }, { stopped: true },
    { reference: null }, { localRevoked: true }, { podRevoked: true }, { paused: true }, { renewed: false },
    { signedAdmission: false }, { mainWorldMoved: false }, { humanMoved: false }, { peerSawMovement: false },
    { movementInputs: inputs.slice(1) }, { movementInputs: [...inputs, inputs[0]] },
    { movementInputs: inputs.map((input, index) => index === 7 ? { ...input, confirmed: false } : input) }]) {
    assert.equal(mainWorldPauseCanRecover({ ...eligible, ...patch }), false);
  }
  assert.deepEqual(inputs, Array.from({ length: 8 }, () => ({ attempted: true, confirmed: true })), 'Eligibility checks never rewrite prior movement receipts');
});

test('ordinary pause proof refreshes the lease immediately before the UI and never retries movement', async () => {
  const calls = [];
  await mainWorldPauseProof({ now: () => 1000,
    refresh: async () => { calls.push('renew-existing-session'); return { expiresAt: 10000 }; },
    pause: async () => { calls.push('actual-ui-pause-and-close'); },
    probe: async () => { calls.push('fresh-negative-probe'); },
  });
  assert.deepEqual(calls, ['renew-existing-session', 'actual-ui-pause-and-close', 'fresh-negative-probe']);
});

test('explicit recovery resumes the same owner before refreshing proof and rechecking Pause', async () => {
  const calls = [], receipts = Object.freeze(Array.from({ length: 8 }, (_, index) => Object.freeze({ id: 'ack-' + index, confirmed: true })));
  await mainWorldPauseProof({ now: () => 1000,
    resume: async () => { calls.push('same-owner-ui-resume-close-fresh-frame'); },
    refresh: async () => { calls.push('same-grant-fresh-admission'); return { expiresAt: 10000 }; },
    pause: async () => { calls.push('actual-ui-pause-and-close'); },
    probe: async () => { calls.push('fresh-negative-probe'); },
  });
  assert.deepEqual(calls, ['same-owner-ui-resume-close-fresh-frame', 'same-grant-fresh-admission', 'actual-ui-pause-and-close', 'fresh-negative-probe']);
  assert.equal(receipts.length, 8); assert(receipts.every(receipt => receipt.confirmed));
});

test('a lease too short for Pause stops before UI mutation; expiry during UI never becomes pause evidence', async () => {
  let now = 1000; const calls = [];
  const ports = { now: () => now, refresh: async () => ({ expiresAt: 4000 }),
    pause: async () => { calls.push('pause'); }, probe: async () => { calls.push('probe'); } };
  await assert.rejects(mainWorldPauseProof(ports), { code: 'qa_world_pause_lease_short' }); assert.deepEqual(calls, []);
  await assert.rejects(mainWorldPauseProof({ ...ports, refresh: async () => ({ expiresAt: 10000 }),
    pause: async () => { calls.push('pause'); now = 10001; } }), { code: 'qa_world_pause_lease_expired' });
  assert.deepEqual(calls, ['pause']);
});
