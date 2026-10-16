import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createOwnerPerformanceConsultation, performanceConsultationGraphIri } from './performance-consultation.mjs';

const OWNER = 'did:web:identity.example:users:alice', POD = 'https://pod.example/alice/';
const TARGET = 'https://foxxi.example/agent/contextualize-and-plan', TASK = 'urn:uuid:task-1';
const copy = value => JSON.parse(JSON.stringify(value));
const scope = (purpose = 'retain-observations', recipient = POD, taskId = TASK) => ({ purpose, recipient, taskId });
const task = overrides => ({ id: TASK, desiredResult: 'Return safely from the fight', observedResult: 'I lost too much health', workContext: 'Hallowmarch main world', ...overrides });
function gate() { let enter, release; return { entered: new Promise(r => { enter = r; }), wait: new Promise(r => { release = r; }), enter: () => enter(), release: () => release() }; }
function fixture({ ownerDid = OWNER, podUrl = POD, sessionId = 'test-session', records = new Map(), keyPresent = true, initialClock = Date.parse('2026-10-16T21:30:00.000Z'), pendingWrite = 0 } = {}) {
  const calls = [], operations = new Map(); let clock = initialClock, version = 0, writes = 0, registrationGate = null, loadGate = null;
  const stored = (graphIri, record) => ({ status: 'saved', saved: true, graphIri, record: copy(record), head: { cid: 'test-cid-' + ++version,
    descriptorUrl: podUrl + 'context-graphs/' + version + '.ttl' } });
  const client = {
    connect: async () => { calls.push({ op: 'connect' }); return { ownerDid, podUrl, keyPresent }; },
    currentHead: async ({ graphIri }) => { calls.push({ op: 'currentHead', graphIri }); return records.get(graphIri)?.head || null; },
    load: async ({ graphIri }) => { calls.push({ op: 'load', graphIri }); const found = records.get(graphIri); if (loadGate) { loadGate.enter(); await loadGate.wait; } return found ? copy(found) : null; },
    registerKey: async () => { calls.push({ op: 'registerKey' }); if (registrationGate) { registrationGate.enter(); await registrationGate.wait; } },
    createAt: async ({ graphIri, record }) => { assert(!records.has(graphIri), 'named creation may not replace an unread index'); return publish(graphIri, record); },
    save: async ({ graphIri, expectedHead, record }) => {
      if (expectedHead.cid !== records.get(graphIri)?.head.cid) throw Object.assign(Error('test CAS conflict'), { code: 'conflict' });
      return publish(graphIri, record);
    },
    confirm: async operationId => { calls.push({ op: 'confirm', operationId }); const result = operations.get(operationId); assert(result); records.set(result.graphIri, result); return copy(result); },
    close: () => { calls.push({ op: 'close' }); },
  };
  function publish(graphIri, record) {
    writes++; calls.push({ op: 'write', graphIri, record: copy(record) });
    const result = stored(graphIri, record); records.set(graphIri, result);
    if (writes === pendingWrite) { const operationId = 'test-operation-' + writes; operations.set(operationId, result); return { status: 'uncertain', saved: false, graphIri, operationId }; }
    return copy(result);
  }
  const journal = createOwnerPerformanceConsultation({ binding: { subjectDid: ownerDid, podUrl }, credential: { testOnly: true }, relayUrl: 'https://relay.example/',
    sessionId, createClient: () => client, crypto: webcrypto, now: () => clock });
  return { journal, calls, records, clock: () => clock, advance: ms => { clock += ms; }, stored,
    holdRegistration: value => { registrationGate = value; }, holdLoad: value => { loadGate = value; },
    evidence: (metrics = { healthPercent: 40, deaths: 2 }) => [{ kind: 'owner-browser-observation', performerDid: ownerDid, at: new Date(clock).toISOString(), metrics }],
    consent: (chosen = scope(), lifetimeMs = 900_000) => journal.grantConsent({ ...chosen, accepted: true, lifetimeMs }),
    writeCount: () => calls.filter(c => c.op === 'write').length,
  };
}

test('private owner index naming survives session/host changes and separates subjects/applications', async () => {
  const first = await performanceConsultationGraphIri(OWNER, undefined, webcrypto);
  assert.match(first, /^urn:graph:interego:performance-consultation:[0-9a-f]{64}$/);
  assert.equal(first, await performanceConsultationGraphIri(OWNER, undefined, webcrypto));
  assert.notEqual(first, await performanceConsultationGraphIri('did:web:identity.example:users:bob', undefined, webcrypto));
  assert.notEqual(first, await performanceConsultationGraphIri(OWNER, 'urn:game:another', webcrypto));
});

test('opening and reading are read-only; identity connection is never consent or key enrollment', async () => {
  const f = fixture(); await f.journal.connect(); assert.equal((await f.journal.read()).observations.length, 0);
  await assert.rejects(f.journal.authorize(scope()), { code: 'consultation_consent_required' });
  await assert.rejects(f.journal.appendObservation({ task: task(), evidence: f.evidence() }), { code: 'consultation_consent_required' });
  await assert.rejects(f.journal.grantConsent({ ...scope(), lifetimeMs: 1000 }), { code: 'consultation_consent_required' });
  assert.equal(f.writeCount(), 0); assert(!f.calls.some(c => c.op === 'registerKey'));
  const noKey = fixture({ keyPresent: false }); await noKey.journal.connect();
  await assert.rejects(noKey.consent(), { code: 'key_required' }); assert.equal(noKey.writeCount(), 0);
});

test('consent binds exact owner, session, purpose, recipient, task and fifteen-minute expiry', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(scope('request-consultation', TARGET));
  const token = await f.journal.authorize(scope('request-consultation', TARGET));
  assert.equal(token.ownerDid, OWNER); assert.equal(token.taskId, TASK);
  for (const other of [scope('request-consultation', 'https://other.example/plan'), scope('retain-observations'), scope('request-consultation', TARGET, 'other-task')]) {
    await assert.rejects(f.journal.authorize(other), { code: 'consultation_consent_required' });
  }
  await assert.rejects(f.journal.assertAuthorized({ ...token, ownerDid: 'did:web:identity.example:users:bob' }), { code: 'cross_subject_denied' });
  await assert.rejects(f.journal.assertAuthorized({ ...token, sessionId: 'another-session' }), { code: 'cross_subject_denied' });
  await assert.rejects(f.consent(scope(), 900_001), { code: 'invalid_consent_scope' });
  await assert.rejects(f.consent(scope('retain-observations', 'https://other.example/pod/')), { code: 'invalid_recipient' });
  f.advance(900_000); await assert.rejects(f.journal.assertAuthorized(token), { code: 'consultation_consent_required' });
});

test('native reread refuses consent withdrawn by another owner device after signing', async () => {
  const records = new Map(), first = fixture({ records }), second = fixture({ records });
  await first.journal.connect(); await first.consent(scope('request-consultation', TARGET));
  const token = await first.journal.authorize(scope('request-consultation', TARGET));
  await second.journal.connect(); await second.journal.revokeConsent(scope('request-consultation', TARGET));
  await assert.rejects(first.journal.assertAuthorized(token), { code: 'consultation_consent_required' });
});

test('a new native session can read history while restored consent cannot authorize new sends', async () => {
  const first = fixture(); await first.journal.connect(); await first.consent();
  const { observation } = await first.journal.appendObservation({ task: task(), evidence: first.evidence() });
  const second = fixture({ records: first.records, sessionId: 'new-session' }); await second.journal.connect();
  assert.equal((await second.journal.read()).observations[0].id, observation.id);
  await assert.rejects(second.journal.authorize(scope()), { code: 'consultation_consent_required' });
  assert.equal(second.writeCount(), 0);
});

test('owner observations, service plans, and numeric followup remain private records without learning claims', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const original = task(), evidence = f.evidence();
  const first = await f.journal.appendObservation({ task: original, evidence }); original.desiredResult = 'changed after capture'; evidence[0].metrics.deaths = 999;
  const plan = await f.journal.appendConsultation({ observationId: first.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { diagnosis: 'Need clearer route guidance', plan: ['Consult the existing map'] } });
  f.advance(1000);
  const after = await f.journal.appendObservation({ task: task({ observedResult: 'Returned with more health' }), evidence: f.evidence({ healthPercent: 80, deaths: 2 }) });
  const outcome = await f.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'The map helped me choose the route.' });
  assert.deepEqual(outcome.evaluation.comparison.healthPercent, { before: 40, after: 80, change: 40 });
  assert.equal(outcome.evaluation.competencyStatus, 'not-assessed'); assert.equal(outcome.evaluation.epistemicStatus, 'observed-before-after-no-causal-claim');
  assert.equal((await f.journal.read()).observations[0].task.desiredResult, task().desiredResult);
  assert.equal((await f.journal.read()).observations[0].evidence[0].metrics.deaths, 2);
  assert(f.calls.filter(c => c.op === 'write').every(c => c.graphIri === f.journal.status().graphIri));
  assert(!f.calls.some(c => ['gameBridge', 'foxxi', 'assessment', 'credential', 'xapi', 'enroll'].includes(c.op)));
  const outward = await f.journal.read(); outward.evaluations[0].comparison.healthPercent.change = 999;
  assert.equal((await f.journal.read()).evaluations[0].comparison.healthPercent.change, 40);
});

test('an agent uses its own native subject and pod; a player cannot record an agent as itself', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const evidence = f.evidence(); evidence[0].performerDid = 'did:web:identity.example:agents:helper';
  assert.throws(() => f.journal.appendObservation({ task: task(), performerKind: 'agent', evidence }), { code: 'cross_subject_denied' });
  const agent = fixture({ ownerDid: evidence[0].performerDid, podUrl: 'https://pod.example/helper/' }); await agent.journal.connect();
  await agent.consent(scope('retain-observations', 'https://pod.example/helper/'));
  const saved = await agent.journal.appendObservation({ task: task(), performerKind: 'agent', evidence: agent.evidence() });
  assert.equal(saved.observation.ownerDid, evidence[0].performerDid); assert.equal(saved.observation.performerKind, 'agent');
  assert.notEqual(agent.journal.status().graphIri, f.journal.status().graphIri);
});

test('withdrawal blocks a queued capture immediately, before delayed registration can publish plaintext-derived content', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(); const held = gate(); f.holdRegistration(held);
  const observation = f.journal.appendObservation({ task: task(), evidence: f.evidence() }); await held.entered;
  const withdrawal = f.journal.revokeConsent(scope()); held.release();
  await assert.rejects(observation, { code: 'consultation_consent_required' }); await withdrawal;
  assert.equal(f.writeCount(), 2); assert.equal((await f.journal.read()).observations.length, 0);
});

test('uncertain native writes block delivery; retry confirms the original operation without duplicate records', async () => {
  const f = fixture({ pendingWrite: 2 }); await f.journal.connect(); await f.consent();
  await assert.rejects(f.journal.appendObservation({ task: task(), evidence: f.evidence() }), { code: 'pod_pending' });
  await assert.rejects(f.journal.authorize(scope()), { code: 'pod_pending' });
  assert.equal(f.journal.status().pending, true); await f.journal.retry(); assert.equal(f.journal.status().pending, false);
  assert.equal(f.writeCount(), 2); assert.equal((await f.journal.read()).observations.length, 1);
});

test('revocation confirms a possibly committed grant before durable withdrawal, and stays locally denied', async () => {
  const f = fixture({ pendingWrite: 1 }); await f.journal.connect();
  await assert.rejects(f.consent(scope('request-consultation', TARGET)), { code: 'pod_pending' });
  await f.journal.revokeConsent(scope('request-consultation', TARGET));
  await assert.rejects(f.journal.authorize(scope('request-consultation', TARGET)), { code: 'consultation_consent_required' });
  assert.equal(f.writeCount(), 2); assert.equal((await f.journal.read()).consents[0].revoked, true);
});

test('native CAS conflicts retain the competing private record and do not report a save', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(); const held = gate(); f.holdRegistration(held);
  const saving = f.journal.appendObservation({ task: task(), evidence: f.evidence() }); await held.entered;
  const graph = f.journal.status().graphIri, current = f.records.get(graph);
  f.records.set(graph, { ...current, head: { ...current.head, cid: 'other-device-cid' } }); held.release();
  await assert.rejects(saving, { code: 'conflict' }); assert.equal(f.writeCount(), 1);
});

test('changed goals, cross-task comparisons, unknown observations and invented numeric values are rejected', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(); const first = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  await assert.rejects(f.journal.appendObservation({ task: task({ desiredResult: 'A different goal' }), evidence: f.evidence() }), { code: 'task_scope_changed' });
  assert.throws(() => f.journal.appendObservation({ task: task(), evidence: f.evidence({ healthPercent: NaN }) }), { code: 'invalid_consultation' });
  await assert.rejects(f.journal.appendConsultation({ observationId: 'unknown', service: { action: 'urn:foxxi:plan', target: TARGET }, response: {} }), { code: 'unknown_observation' });
  const plan = await f.journal.appendConsultation({ observationId: first.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: {} });
  await assert.rejects(f.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: first.observation.id, playerReport: 'No followup yet' }), { code: 'invalid_evaluation' });
  assert.throws(() => f.journal.appendConsultation({ observationId: first.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { text: 'x'.repeat(32 * 1024 + 1) } }), { code: 'consultation_capacity' });
});

test('a substantial nested planning response fits the bounded own-pod journal without truncation', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const first = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const response = { plan: { paradigm: { options: Array.from({ length: 10 }, (_, index) => ({ index, methodProfiles: ['Reference', 'Coaching', 'Workflow'], rationale: 'Observed task constraints and an untested intervention rationale. '.repeat(22) })) }, scaffold: { next: ['Apply to an authentic task', 'Compare using the same measurements'] }, calibration: { confidence: 0.5, explanation: 'Plan usefulness has not been measured.' } }, note: 'A plan does not establish learning.' };
  assert(new TextEncoder().encode(JSON.stringify(response)).length > 8192);
  const saved = await f.journal.appendConsultation({ observationId: first.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response });
  assert.deepEqual(saved.consultation.response, response);
  assert.deepEqual((await f.journal.read()).consultations[0].response, response);
});

test('closing a native identity connection suppresses late private reads and all later operations', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(); const held = gate(); f.holdLoad(held);
  const read = f.journal.read(); await held.entered; f.journal.close(); held.release();
  await assert.rejects(read, { code: 'revoked' }); await assert.rejects(f.journal.read(), { code: 'revoked' });
  assert.equal(f.journal.status().connected, false);
});
