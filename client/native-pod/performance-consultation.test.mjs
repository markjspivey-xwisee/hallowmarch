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
function fixture({ ownerDid = OWNER, podUrl = POD, sessionId = 'test-session', records = new Map(), keyPresent = true, initialClock = Date.parse('2026-10-16T21:30:00.000Z'), pendingWrite = 0, bounded = false, applicationId = bounded ? 'urn:game:hallowmarch' : 'urn:game:legacy-test' } = {}) {
  const calls = [], operations = new Map(); let clock = initialClock, version = 0, writes = 0, registrationGate = null, loadGate = null, archiveGate = null;
  const stored = (graphIri, record, checkpoint) => {
    const revision = ++version, bindingCid = 'test-binding-cid';
    return { status: 'saved', saved: true, graphIri, record: copy(record), head: checkpoint
      ? { cid: bindingCid, bindingCid, descriptorUrl: podUrl + 'context-graphs/binding.ttl', nativeRevision: 'native-revision-' + revision, recordCid: 'record-cid-' + revision, proofKind: 'owner-key-authenticated-checkpoint' }
      : { cid: 'test-cid-' + revision, descriptorUrl: podUrl + 'context-graphs/' + revision + '.ttl' } };
  };
  const client = {
    connect: async () => { calls.push({ op: 'connect' }); return { ownerDid, podUrl, keyPresent }; },
    currentHead: async ({ graphIri, checkpoint }) => { calls.push({ op: 'currentHead', graphIri, checkpoint }); return records.get(graphIri)?.head || null; },
    load: async ({ graphIri, checkpoint }) => { calls.push({ op: 'load', graphIri, checkpoint }); const found = records.get(graphIri); if (loadGate) { loadGate.enter(); await loadGate.wait; } return found ? copy(found) : null; },
    registerKey: async () => { calls.push({ op: 'registerKey' }); if (registrationGate) { registrationGate.enter(); await registrationGate.wait; } },
    createAt: async ({ graphIri, record, checkpoint }) => { calls.push({ op: 'createAt', graphIri, checkpoint }); assert(!records.has(graphIri), 'named creation may not replace an unread index'); return publish(graphIri, record, checkpoint); },
    create: async ({ record }) => { calls.push({ op: 'createArchive' }); const result = publish('urn:graph:test-archive:' + webcrypto.randomUUID(), record);
      if (archiveGate) { archiveGate.enter(); await archiveGate.wait; } return result; },
    save: async ({ graphIri, expectedHead, record, checkpoint }) => {
      calls.push({ op: 'save', graphIri, expectedHead: copy(expectedHead), checkpoint });
      if (JSON.stringify(expectedHead) !== JSON.stringify(records.get(graphIri)?.head)) throw Object.assign(Error('test CAS conflict'), { code: 'conflict' });
      return publish(graphIri, record, checkpoint);
    },
    confirm: async operationId => { calls.push({ op: 'confirm', operationId }); const result = operations.get(operationId); assert(result); records.set(result.graphIri, result); return copy(result); },
    close: () => { calls.push({ op: 'close' }); },
  };
  function publish(graphIri, record, checkpoint) {
    writes++; calls.push({ op: 'write', graphIri, record: copy(record) });
    const result = stored(graphIri, record, checkpoint); records.set(graphIri, result);
    if (writes === pendingWrite) { const operationId = 'test-operation-' + writes; operations.set(operationId, result); return { status: 'uncertain', saved: false, graphIri, operationId }; }
    return copy(result);
  }
  const journal = createOwnerPerformanceConsultation({ binding: { subjectDid: ownerDid, podUrl }, credential: { testOnly: true }, relayUrl: 'https://relay.example/',
    sessionId, applicationId, createClient: () => client, crypto: webcrypto, now: () => clock });
  return { journal, client, calls, records, clock: () => clock, advance: ms => { clock += ms; }, stored,
    holdRegistration: value => { registrationGate = value; }, holdLoad: value => { loadGate = value; }, holdArchive: value => { archiveGate = value; },
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

test('gameplay LRS delivery has its own recipient/session/purpose permission and never follows coaching consent implicitly', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent(scope('request-consultation', TARGET));
  const delivery = scope('record-gameplay-activity', 'https://foxxi.example/agent/xapi-statements/own-subject/write', 'hallowmarch-activity:char:session');
  await assert.rejects(f.journal.authorize(delivery), { code: 'consultation_consent_required' });
  await f.consent(delivery); const token = await f.journal.authorize(delivery);
  assert.equal(token.purpose, 'record-gameplay-activity'); assert.equal(token.recipient, delivery.recipient);
  await f.journal.revokeConsent(delivery);
  await assert.rejects(f.journal.assertAuthorized(token), { code: 'consultation_consent_required' });
  assert.equal((await f.journal.authorize(scope('request-consultation', TARGET))).purpose, 'request-consultation');
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

async function allHistory(journal) {
  const active = await journal.read(), records = { observations: new Map(), consultations: new Map(), evaluations: new Map() };
  function retain(record) { for (const kind of Object.keys(records)) for (const item of record[kind]) {
    if (records[kind].has(item.id)) assert.deepEqual(records[kind].get(item.id), item, 'copied dependencies retain their exact original bodies');
    records[kind].set(item.id, item);
  } }
  retain(active); let reference = active.archiveHead, pages = 0;
  while (reference) { const page = await journal.readArchive(reference); retain(page.record); reference = page.next; pages++; assert(pages < 100); }
  return { records, pages, active };
}

test('forty continued evaluations archive complete dependency bundles and preserve every original record beyond the old limit', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const plan = await f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { plan: ['Try the existing map'] } });
  for (let i = 0; i < 40; i++) {
    f.advance(10);
    const after = await f.journal.appendObservation({ task: task({ observedResult: 'Observed attempt ' + i }), evidence: f.evidence({ healthPercent: 50 + i, deaths: 2 }) });
    await f.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'Authentic attempt ' + i });
  }
  const history = await allHistory(f.journal);
  assert(history.pages >= 2); assert(history.active.observations.length <= 16);
  assert.equal(history.records.observations.size, 41); assert.equal(history.records.consultations.size, 1); assert.equal(history.records.evaluations.size, 40);
  assert.equal(history.records.observations.get(baseline.observation.id).task.desiredResult, task().desiredResult);
  assert([...history.records.evaluations.values()].every(item => item.competencyStatus === 'not-assessed'));
  const reopened = fixture({ records: f.records, sessionId: 'new-session' }); await reopened.journal.connect();
  await assert.rejects(reopened.journal.authorize(scope()), { code: 'consultation_consent_required' });
  await reopened.consent(); reopened.advance(1000);
  const after = await reopened.journal.appendObservation({ task: task({ observedResult: 'Resumed old plan' }), evidence: reopened.evidence({ healthPercent: 80 }) });
  const evaluation = await reopened.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'Resumed with the original baseline.' });
  assert.equal(evaluation.evaluation.comparison.healthPercent.before, 40);
});

test('unfinished plans remain resumable after forty later consultations and private history paging does not write', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  let oldest, newest;
  for (let i = 0; i < 40; i++) {
    const saved = await f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { plan: ['Untested support ' + i] } });
    oldest ||= saved.consultation; newest = saved.consultation;
  }
  const history = await allHistory(f.journal); assert.equal(history.records.consultations.size, 40); assert(history.pages >= 2);
  const writes = f.writeCount(); await f.journal.readArchive(); assert.equal(f.writeCount(), writes);
  // Force an observation-only active slice. read() still restores the latest
  // plan and baseline as an entry point without mutating the archived history.
  for (let i = 0; i < 16; i++) await f.journal.appendObservation({ task: task({ observedResult: 'Further observation ' + i }), evidence: f.evidence() });
  const resumed = await f.journal.read(); assert(resumed.consultations.some(item => item.id === newest.id));
  f.advance(1);
  const after = await f.journal.appendObservation({ task: task({ observedResult: 'Returning to the first unfinished plan' }), evidence: f.evidence({ healthPercent: 72 }) });
  const saved = await f.journal.appendEvaluation({ consultationId: oldest.id, observationId: after.observation.id, playerReport: 'An old unfinished plan still works.' });
  assert.equal(saved.evaluation.comparison.healthPercent.before, 40);
});

for (const pendingWrite of [18, 19, 20]) test('archive ' + ({ 18: 'draft', 19: 'page', 20: 'index' }[pendingWrite]) + ' lost acknowledgement confirms original operations without duplicate pages', async () => {
  const f = fixture({ pendingWrite }); await f.journal.connect(); await f.consent();
  for (let i = 0; i < 16; i++) await f.journal.appendObservation({ task: task({ observedResult: 'Observed attempt ' + i }), evidence: f.evidence() });
  await assert.rejects(f.journal.appendObservation({ task: task({ observedResult: 'Last acknowledged once' }), evidence: f.evidence() }), { code: 'pod_pending' });
  assert.equal(f.journal.status().pending, true);
  await assert.rejects(f.journal.authorize(scope()), { code: 'pod_pending' });
  // The complete draft is already in its private immutable page. Confirmation
  // after expiry only finishes that original publication's discovery pointer.
  f.advance(900_000); await f.journal.retry(); assert.equal(f.journal.status().pending, false);
  const history = await allHistory(f.journal); assert.equal(history.pages, 1); assert.equal(history.records.observations.size, 17);
  assert.equal(f.records.size, 2); assert.equal(f.writeCount(), 20);
  await assert.rejects(f.journal.authorize(scope()), { code: 'consultation_consent_required' });
});

test('withdrawal during an uncertain archive preserves the accepted observations and then records native withdrawal', async () => {
  const f = fixture({ pendingWrite: 19 }); await f.journal.connect(); await f.consent();
  for (let i = 0; i < 16; i++) await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  await assert.rejects(f.journal.appendObservation({ task: task(), evidence: f.evidence() }), { code: 'pod_pending' });
  await f.journal.revokeConsent(scope());
  const history = await allHistory(f.journal); assert.equal(history.records.observations.size, 17);
  assert.equal(history.active.consents[0].revoked, true);
  await assert.rejects(f.journal.authorize(scope()), { code: 'consultation_consent_required' });
});

test('an archive CAS conflict preserves the competing native index and exposes the real unlinked private page receipt', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  for (let i = 0; i < 16; i++) await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const held = gate(); f.holdArchive(held);
  const appending = f.journal.appendObservation({ task: task({ observedResult: 'Competing device test' }), evidence: f.evidence() }); await held.entered;
  const graph = f.journal.status().graphIri, prior = f.records.get(graph);
  f.records.set(graph, { ...prior, head: { ...prior.head, cid: 'competing-device-head' } }); held.release();
  let receipt;
  await assert.rejects(appending, error => { receipt = error.archiveReference; return error.code === 'conflict' && !!receipt; });
  assert.equal(f.records.get(graph).head.cid, 'competing-device-head');
  const unlinked = await f.journal.readArchive(receipt); assert.equal(unlinked.record.observations.length, 17);
  assert.equal(f.journal.status().pending, false);
  assert.equal((await f.journal.read()).observations.length, 17);
});

test('private archive references are immutable and wrong-subject pages fail closed', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  for (let i = 0; i < 17; i++) await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const reference = (await f.journal.read()).archiveHead, original = f.records.get(reference.graphIri);
  f.records.set(reference.graphIri, { ...original, head: { ...original.head, cid: 'unexpected-archive-version' } });
  await assert.rejects(f.journal.readArchive(reference), { code: 'archive_changed' });
  f.records.set(reference.graphIri, { ...original, record: { ...original.record, ownerDid: 'did:web:identity.example:users:bob' } });
  await assert.rejects(f.journal.readArchive(reference), { code: 'owner_mismatch' });
});

test('substantial real-shaped plans rotate by byte size and retain more than 350 KiB of complete responses', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const response = { plan: { paradigm: { options: Array.from({ length: 10 }, (_, index) => ({ index, rationale: 'Observed task constraints; proposed reference and workflow support remain untested. '.repeat(26) })) } } };
  const expected = new Map();
  for (let i = 0; i < 20; i++) {
    const actual = { ...response, attempt: i }, saved = await f.journal.appendConsultation({ observationId: baseline.observation.id,
      service: { action: 'urn:foxxi:plan', target: TARGET }, response: actual });
    expected.set(saved.consultation.id, actual);
  }
  assert(new TextEncoder().encode(JSON.stringify([...expected.values()])).length > 350 * 1024);
  const history = await allHistory(f.journal); assert(history.pages >= 2); assert.equal(history.records.consultations.size, 20);
  for (const [id, body] of expected) assert.deepEqual(history.records.consultations.get(id).response, body);
  assert(new TextEncoder().encode(JSON.stringify(history.active)).length < 190 * 1024);
});

test('v1 indexes without archive fields remain readable without migration writes', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const graph = f.journal.status().graphIri, original = f.records.get(graph), legacy = copy(original.record); delete legacy.archiveHead;
  f.records.set(graph, { ...original, record: legacy });
  const reopened = fixture({ records: f.records }); await reopened.journal.connect();
  assert.equal((await reopened.journal.read()).consents.length, 1); assert.equal(reopened.writeCount(), 0);
});

test('an existing full 24-observation v1 journal continues into native history without dropping prior records', async () => {
  const f = fixture(); await f.journal.connect(); await f.consent();
  const graph = f.journal.status().graphIri, original = f.records.get(graph), legacy = copy(original.record); delete legacy.archiveHead;
  legacy.observations = Array.from({ length: 24 }, (_, i) => ({ id: 'urn:uuid:legacy-' + i, ownerDid: OWNER, performerKind: 'human', at: new Date(f.clock()).toISOString(),
    task: task({ observedResult: 'Existing authentic task observation ' + i }), evidence: f.evidence(),
    epistemicStatus: 'reported-task-and-client-observation', competencyStatus: 'not-assessed' }));
  f.records.set(graph, { ...original, record: legacy });
  const reopened = fixture({ records: f.records }); await reopened.journal.connect();
  await reopened.journal.appendObservation({ task: task({ observedResult: 'Continued after old limit' }), evidence: reopened.evidence() });
  const history = await allHistory(reopened.journal); assert.equal(history.records.observations.size, 25); assert.equal(history.pages, 1);
});


test('Hallowmarch defaults to fixed checkpoint storage and more than 600 consultations mutations create no archive graph', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const plan = await f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { support: 'An untested route suggestion' } });
  let previous = { observations: 1, consultations: 1, evaluations: 0 };
  for (let i = 0; i < 310; i++) {
    f.advance(1000);
    const after = await f.journal.appendObservation({ task: task({ observedResult: 'Real bounded attempt ' + i }), evidence: f.evidence({ healthPercent: i % 100, deaths: 2 }) });
    await f.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'A real comparison without a causal claim.' });
    const record = await f.journal.read();
    for (const kind of ['observations', 'consultations', 'evaluations']) {
      assert(record.coverage.counts[kind] >= previous[kind]); previous[kind] = record.coverage.counts[kind];
      assert(record[kind].length <= 32); assert.equal(record.coverage.pruned[kind], record.coverage.counts[kind] - record[kind].length);
    }
    assert(Buffer.byteLength(JSON.stringify(record)) <= 192 * 1024);
  }
  const record = await f.journal.read();
  assert.deepEqual(record.coverage.counts, { observations: 311, consultations: 1, evaluations: 310 });
  assert(record.coverage.pruned.observations > 270); assert(record.coverage.pruned.evaluations > 270);
  assert.equal(record.archiveHead, null); assert.equal(f.records.size, 1); assert.equal(f.writeCount(), 623);
  assert(!f.calls.some(call => call.op === 'createArchive'));
  assert(f.calls.filter(call => ['load', 'currentHead', 'createAt', 'save'].includes(call.op)).every(call => call.checkpoint === 'hallowmarch-performance-consultation/v1'));
  assert(record.evaluations.every(item => item.competencyStatus === 'not-assessed'));
});

test('bounded detail expires after one hour, keeps cumulative coverage and never revives old plan dependencies', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const plan = await f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { plan: ['Untested support'] } });
  f.advance(60 * 60 * 1000);
  const writes = f.writeCount(), expired = await f.journal.read();
  assert.equal(f.writeCount(), writes); assert.equal(expired.observations.length, 0); assert.equal(expired.consultations.length, 0);
  assert.deepEqual(expired.coverage.counts, { observations: 1, consultations: 1, evaluations: 0 });
  assert.deepEqual(expired.coverage.pruned, { observations: 1, consultations: 1, evaluations: 0 });
  await assert.rejects(f.journal.authorize(scope()), { code: 'consultation_consent_required' });
  await f.consent();
  await assert.rejects(f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: {} }), { code: 'unknown_observation' });
  f.advance(1);
  const after = await f.journal.appendObservation({ task: task({ observedResult: 'A new real observation' }), evidence: f.evidence() });
  await assert.rejects(f.journal.appendEvaluation({ consultationId: plan.consultation.id, observationId: after.observation.id, playerReport: 'No preserved baseline to compare.' }), { code: 'invalid_evaluation' });
  const current = await f.journal.read(); assert.equal(current.coverage.counts.observations, 2); assert.equal(current.coverage.pruned.observations, 1);
  assert.equal(current.coverage.legacyHistoryUnknown, false); assert.equal(f.records.size, 1);
});

test('bounded byte pressure drops whole dependent detail without truncating plans or freezing lifetime use', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent();
  const baseline = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const response = { untested: 'A response retained exactly, with no assumed benefit. '.repeat(540) };
  let latest;
  for (let i = 0; i < 50; i++) {
    latest = await f.journal.appendConsultation({ observationId: baseline.observation.id, service: { action: 'urn:foxxi:plan', target: TARGET }, response: { ...response, attempt: i } });
    assert.deepEqual(latest.consultation.response, { ...response, attempt: i });
  }
  const record = await f.journal.read(); assert.equal(record.coverage.counts.consultations, 50); assert(record.consultations.length < 10);
  assert(record.consultations.some(item => item.id === latest.consultation.id)); assert.equal(record.observations[0].id, baseline.observation.id);
  assert(Buffer.byteLength(JSON.stringify(record)) <= 192 * 1024); assert.equal(f.records.size, 1);
});

test('bounded pending original observation stays fenced through aging and never auto-resends or prunes its uncertain operation', async () => {
  const f = fixture({ bounded: true, pendingWrite: 2 }); await f.journal.connect(); await f.consent();
  await assert.rejects(f.journal.appendObservation({ task: task(), evidence: f.evidence() }), { code: 'pod_pending' });
  f.advance(2 * 60 * 60 * 1000);
  await assert.rejects(f.journal.read(), { code: 'pod_pending' });
  await assert.rejects(f.journal.authorize(scope()), { code: 'pod_pending' });
  await assert.rejects(f.journal.appendObservation({ task: task(), evidence: f.evidence() }), { code: 'pod_pending' });
  assert.equal(f.writeCount(), 2); assert.equal(f.journal.status().pending, true);
  await f.journal.retry(); assert.equal(f.writeCount(), 2); assert.equal(f.calls.filter(call => call.op === 'confirm').length, 1);
  const record = await f.journal.read(); assert.equal(record.observations.length, 0); assert.equal(record.coverage.counts.observations, 1); assert.equal(record.coverage.pruned.observations, 1);
  assert.equal(f.journal.status().pending, false);
});

test('bounded consent roundtrips, withdrawal and a new session never restore delivery permission', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent(scope('request-consultation', TARGET));
  const token = await f.journal.authorize(scope('request-consultation', TARGET));
  const peer = fixture({ bounded: true, records: f.records }); await peer.journal.connect();
  await peer.journal.assertAuthorized(token); await peer.journal.revokeConsent(scope('request-consultation', TARGET));
  await assert.rejects(f.journal.assertAuthorized(token), { code: 'consultation_consent_required' });
  const next = fixture({ bounded: true, records: f.records, sessionId: 'another-native-session' }); await next.journal.connect();
  await assert.rejects(next.journal.authorize(scope('request-consultation', TARGET)), { code: 'consultation_consent_required' });
  await next.consent(scope('request-consultation', TARGET));
  await assert.rejects(f.journal.authorize(scope('request-consultation', TARGET)), { code: 'consultation_consent_required' });
  assert.equal(f.records.size, 1); assert.equal(next.records.size, 1);
});

test('bounded migration keeps an existing archive pointer read-only with honest unknown historical counts', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent();
  const graph = f.journal.status().graphIri, original = f.records.get(graph), legacy = copy(original.record); delete legacy.coverage;
  const archiveIri = 'urn:graph:legacy-verified-page', archiveRecord = copy(legacy);
  archiveRecord.observations = [{ id: 'urn:uuid:older-observation', ownerDid: OWNER, performerKind: 'human', at: new Date(f.clock()).toISOString(), task: task(), evidence: f.evidence(), epistemicStatus: 'reported-task-and-client-observation', competencyStatus: 'not-assessed' }];
  const archived = f.stored(archiveIri, archiveRecord); f.records.set(archiveIri, archived);
  legacy.archiveHead = { graphIri: archiveIri, ...archived.head }; f.records.set(graph, { ...original, record: legacy });
  const next = fixture({ bounded: true, records: f.records }); await next.journal.connect();
  const before = await next.journal.read(); assert.equal(before.coverage.legacyHistoryUnknown, true); assert.equal(before.coverage.counts.observations, 0);
  await assert.rejects(next.journal.appendConsultation({ observationId: 'urn:uuid:older-observation', service: { action: 'urn:foxxi:plan', target: TARGET }, response: {} }), { code: 'unknown_observation' });
  await next.journal.appendObservation({ task: task(), evidence: next.evidence() });
  const current = await next.journal.read(); assert.deepEqual(current.archiveHead, legacy.archiveHead); assert.equal(current.coverage.counts.observations, 1);
  const writes = next.writeCount(), page = await next.journal.readArchive(); assert.equal(page.record.observations[0].id, 'urn:uuid:older-observation'); assert.equal(next.writeCount(), writes);
  assert(!next.calls.some(call => call.op === 'createArchive')); assert.equal(next.records.size, 2);
});


test('unconfirmed checkpoint bootstrap is read-fenced and only explicit Retry can reconcile its original binding', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); await f.consent(scope('request-consultation', TARGET));
  const original = copy(f.records.get(f.journal.status().graphIri));
  let confirmed = false, reconciliations = 0, confirmations = 0;
  const ordinaryLoad = f.client.load;
  f.client.load = async input => { if (!confirmed) throw Object.assign(Error('Original binding is uncertain'), { code: 'checkpoint_binding_pending', operationId: 'original-binding-operation', graphIri: input.graphIri }); return ordinaryLoad(input); };
  f.client.confirm = async operationId => { assert.equal(operationId, 'original-binding-operation'); confirmations++; return confirmed ? { ...copy(original), saved: true } : { saved: false, status: 'uncertain', operationId, graphIri: original.graphIri, checkpointBinding: true }; };
  f.client.reconcileCheckpoint = async input => { assert.deepEqual(input, { graphIri: original.graphIri, checkpoint: 'hallowmarch-performance-consultation/v1' }); reconciliations++; confirmed = true; return { ...copy(original), saved: true }; };
  await assert.rejects(f.journal.read(), { code: 'pod_pending' });
  await assert.rejects(f.journal.authorize(scope('request-consultation', TARGET)), { code: 'pod_pending' });
  await assert.rejects(f.journal.revokeConsent(scope('request-consultation', TARGET)), { code: 'pod_pending' });
  assert.equal(reconciliations, 0); assert.equal(f.writeCount(), 1); assert.equal(f.journal.status().pending, true);
  await f.journal.retry(); assert.equal(reconciliations, 1); assert.equal(confirmations, 2); assert.equal(f.writeCount(), 1);
  assert.equal(f.journal.status().pending, false);
  await assert.rejects(f.journal.authorize(scope('request-consultation', TARGET)), { code: 'consultation_consent_required' });
  await f.journal.revokeConsent(scope('request-consultation', TARGET));
  assert.equal(f.writeCount(), 2); assert.equal((await f.journal.read()).consents[0].revoked, true);
});


test('checkpoint receipts separate one stable binding from each dynamic native revision and record digest', async () => {
  const f = fixture({ bounded: true }); await f.journal.connect(); const grant = await f.consent();
  const first = await f.journal.appendObservation({ task: task(), evidence: f.evidence() });
  const second = await f.journal.appendObservation({ task: task({ observedResult: 'A later exact observation' }), evidence: f.evidence() });
  assert.equal(first.reference.cid, grant.reference.cid); assert.equal(second.reference.cid, first.reference.cid);
  assert.equal(first.reference.bindingCid, first.reference.cid); assert.equal(second.reference.bindingCid, second.reference.cid);
  assert.notEqual(second.reference.nativeRevision, first.reference.nativeRevision); assert.notEqual(second.reference.recordCid, first.reference.recordCid);
  assert.equal(second.reference.proofKind, 'owner-key-authenticated-checkpoint');
  const writes = f.calls.filter(call => call.op === 'save');
  assert.equal(writes.at(-1).expectedHead.nativeRevision, first.reference.nativeRevision);
  assert.equal(writes.at(-1).expectedHead.recordCid, first.reference.recordCid);
});
