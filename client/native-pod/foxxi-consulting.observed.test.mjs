import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createFoxxiConsultant, FOXXI_PLANNER_ACTION } from './foxxi-consulting.mjs';
import { signingDelegationFixture } from './signing-delegation.fixture.mjs';

const binding = { subjectDid: 'did:web:identity.example:users:u-pk-alice', authenticatedAgentDid: 'did:web:identity.example:agents:hallowmarch-u-pk-alice', podUrl: 'https://pod.example/u-pk-alice/' };
const target = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan';
const clock = Date.parse('2026-10-17T22:00:00Z');
const ids = ['fd1aecae-550e-4cec-a5cd-04482f7b9167', '33a7fd43-893c-41d7-a02c-8f8a36bbf445'];
const task = () => ({ id: 'coach-session-1', desiredResult: 'Support the current game path using observed activity.', observedResult: 'An actual craft attempt was refused.', workContext: 'Hallowmarch owner-browser coaching during this consent session.', constraints: ['Owner-browser evidence only; causes and competency are unassessed.'] });
const focus = () => ({ id: 'craft-readiness', title: 'Prepare a craft attempt', desiredResult: 'Observe one completed craft after this refused attempt.', workContext: 'Use the recipe and tool references before a new real attempt.', bodyId: 'u-pk-alice:character', bodyKind: 'character' });
const context = () => ({ observationLevel: 'owner-browser', capturedAt: new Date(clock).toISOString(), metrics: { healthPercent: 75, level: 3, deaths: 1 } });
const trajectory = () => [{ agentDid: binding.subjectDid, steps: [{ modalStatus: 'Asserted', granularity: 'task', verb: 'craft.refused', objectId: 'urn:hallowmarch:recipe:bandage', objectName: 'Bandage recipe', recordedAt: new Date(clock).toISOString(), wasDerivedFrom: ['urn:uuid:' + ids[0]], result: { success: false, note: 'The game refused this attempt; cause is unassessed.' } }] }];
const observed = () => ({ task: task(), taskOrigin: 'observed-gameplay', observationId: ids[0], focus: focus(), context: context(), trajectories: trajectory() });

function fixture({ mutateResponse, afterSign, afterAuthorize, rawResponse } = {}) {
  const calls = []; let time = clock, revoked = false;
  const transport = { async connect(required) { return { granted: required }; }, async callTool(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'get_pod_status') return signingDelegationFixture({ ownerDid: binding.subjectDid, agentDid: binding.authenticatedAgentDid, podUrl: binding.podUrl }).status;
    if (name === 'verify_agent') return signingDelegationFixture({ ownerDid: binding.subjectDid, agentDid: binding.authenticatedAgentDid, podUrl: binding.podUrl }).verified;
    if (name === 'dereference') return { status: 'ok', affordances: [{ action: FOXXI_PLANNER_ACTION, method: 'POST', target }] };
    if (name === 'sign_request') {
      const payload = { ...structuredClone(args.payload), agent_id: binding.authenticatedAgentDid, subject_pod_url: binding.podUrl, timestamp: new Date(time).toISOString() };
      afterSign?.({ revoke() { revoked = true; }, advance(ms) { time += ms; } });
      return { _signed_payload: JSON.stringify(payload), _signature: 'fixture-signature' };
    }
    if (name === 'act') {
      const { situation } = JSON.parse(args.payload._signed_payload);
      const body = { classifiedBy: binding.authenticatedAgentDid, diagnosis: { situationId: situation.id, method: 'classify-first', regimeSource: 'unclassified', reasoning: ['An observed refusal is available; its cause is unassessed.'], caveat: 'This observation does not establish mastery or improvement.' }, plan: { situationId: situation.id, selected: [{ type: 'reference', title: 'Recipe reference', rationale: 'Check the relevant recipe before a fresh attempt.', resource: { iri: 'urn:hallowmarch:reference:craft', kind: 'job-aid' } }], summary: 'Use the recipe reference, then observe a new craft attempt.' }, serviceMetadata: { version: 'fixture-v1', assessed: false } };
      mutateResponse?.(body);
      return { status: 200, body: rawResponse ? rawResponse(body) : JSON.stringify(body) };
    }
    throw Error('Unexpected tool: ' + name);
  } };
  const journal = {
    async authorize(args) { const token = { ownerDid: binding.subjectDid, sessionId: 'coach-session-1', ...args, consentId: 'consent-1', revision: 1, expiresAt: new Date(time + 30000).toISOString() }; calls.push({ name: 'authorize', args }); afterAuthorize?.(token); return token; },
    async assertAuthorized() { calls.push({ name: 'assertAuthorized' }); if (revoked) throw Object.assign(Error('Revoked'), { code: 'consent_required' }); return true; },
  };
  const client = createFoxxiConsultant({ binding, relayUrl: 'https://relay.example', sessionId: 'coach-session-1', journal, transport, now: () => time });
  return { client, calls };
}

test('dynamic observed focus changes the planner context while retaining one stable journal task', async () => {
  const f = fixture(); await f.client.connect(); const input = observed();
  const first = f.client.preparePlan(input);
  input.focus.desiredResult = 'Caller mutation'; input.trajectories[0].steps[0].verb = 'Caller mutation';
  assert.equal(first.taskId, task().id); assert.equal(first.payload.situation.competency, focus().desiredResult);
  assert(first.payload.situation.workContext.includes(focus().workContext));
  assert(first.payload.situation.workContext.includes('Observed body:'));
  assert.equal(first.payload.situation.performer.id, binding.subjectDid);
  assert.equal(first.payload.situation.provenance, 'owner-browser-observed-gameplay');
  assert.equal(first.payload.situation.modalStatus, 'Hypothetical');
  assert.deepEqual(first.payload.trajectories, trajectory()); assert(Object.isFrozen(first.focus));
  assert(!Object.hasOwn(first.payload, 'exemplary')); assert(!Object.hasOwn(first.payload, 'couldPerformUnderIdealConditions'));
  const next = observed(); next.observationId = ids[1]; next.focus = { id: 'recover-after-fall', title: 'Recover after a fall', desiredResult: 'Observe the same character respawn after the fall.', workContext: 'Use the recovery aid.' };
  const second = f.client.preparePlan(next);
  await f.client.requestPlan(first); await f.client.requestPlan(second);
  assert.notEqual(first.payload.situation.id, second.payload.situation.id);
  assert.equal(second.payload.situation.competency, next.focus.desiredResult);
  assert.deepEqual(f.calls.filter(x => x.name === 'authorize').map(x => x.args.taskId), [task().id, task().id]);
});

test('observed focus requires concrete observation identity and owner-browser provenance', async () => {
  const f = fixture(); await f.client.connect();
  const changes = [x => delete x.context, x => delete x.observationId, x => { x.observationId = 'not-an-observation-uuid'; },
    x => { x.context.observationLevel = 'server-verified'; }, x => { x.taskOrigin = 'performer-report'; },
    x => { x.focus.inventory = ['private']; }, x => { x.focus.bodyKind = 'human'; }, x => delete x.focus.bodyId,
    x => delete x.focus.bodyKind, x => { x.focus.id = 'arbitrary focus with spaces'; }, x => { x.focus.title = 'x'.repeat(201); }];
  for (const change of changes) { const input = observed(); change(input); assert.throws(() => f.client.preparePlan(input), { code: 'invalid_consultation' }); }
  assert.equal(f.calls.filter(x => x.name === 'sign_request' || x.name === 'act').length, 0);
});

test('trajectory uses only the authenticated observer and bounded actual source steps', async () => {
  const f = fixture(); await f.client.connect();
  const changes = [x => { x.trajectories[0].agentDid = binding.authenticatedAgentDid; }, x => { x.trajectories[0].steps[0].recordedAt = 'unknown'; },
    x => { x.trajectories[0].steps[0].wasDerivedFrom = []; }, x => { x.trajectories[0].steps[0].wasDerivedFrom = ['http://untrusted.example/event']; },
    x => { x.trajectories[0].steps[0].chat = 'private'; }, x => { x.trajectories[0].steps[0].result.quality = 2; },
    x => { x.trajectories[0].steps = Array.from({ length: 33 }, () => trajectory()[0].steps[0]); }];
  for (const change of changes) { const input = observed(); change(input); assert.throws(() => f.client.preparePlan(input), { code: 'invalid_consultation' }); }
  assert.equal(f.calls.filter(x => x.name === 'sign_request' || x.name === 'act').length, 0);
});

test('valid rich service plan fields remain intact, private and frozen', async () => {
  const f = fixture(); await f.client.connect(); const result = await f.client.requestPlan(f.client.preparePlan(observed()));
  assert.equal(result.response.plan.selected[0].resource.iri, 'urn:hallowmarch:reference:craft');
  assert.equal(result.response.serviceMetadata.version, 'fixture-v1');
  assert.equal(result.response.diagnosis.reasoning.length, 1); assert(Object.isFrozen(result.response.plan.selected[0].resource));
  assert.equal(result.foxxiPersonalRecordCreated, false); assert.deepEqual(result.competencyClaims, []);
});

test('malformed and unbounded plans cannot enter the private coaching history', async () => {
  const changes = [body => { body.plan.selected = [null]; }, body => { body.plan.selected = Array(17).fill({}); },
    body => { body.plan.selected[0].rationale = { text: 'unrenderable' }; }, body => { body.plan.summary = ' '; },
    body => { body.plan.summary = 'x'.repeat(4001); }, body => { body.diagnosis.reasoning = {}; },
    body => { body.diagnosis.reasoning = [null]; }, body => { body.diagnosis.caveat = []; },
    body => { body.extra = Array(4).fill('x'.repeat(8192)); }];
  for (const mutateResponse of changes) {
    const f = fixture({ mutateResponse }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code: 'consulting_contract' });
  }
});

test('credential-shaped fields and echoed signing material cannot be retained as plan metadata', async () => {
  const changes = [body => { body.extra = { access_token: 'not-a-real-token' }; }, body => { body.extra = { _signed_payload: '{}' }; },
    body => { body.extra = { nested: { 'Private-Key': 'not-a-key' } }; }, body => { body.extra = 'Bearer synthetic-opaque-value'; },
    body => { body.extra = 'https://service.example/path?token=synthetic'; }, body => { body.extra = '-----BEGIN PRIVATE KEY-----'; }];
  for (const mutateResponse of changes) {
    const f = fixture({ mutateResponse }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code: 'consulting_contract' });
  }
});

test('non-JSON response objects are rejected without invoking their properties', async () => {
  let accessed = false;
  for (const rawResponse of [body => { body.extra = body; return body; }, body => { Object.defineProperty(body, 'extra', { enumerable: true, get() { accessed = true; return 'bad'; } }); return body; }, body => { body.extra = NaN; return body; }]) {
    const f = fixture({ rawResponse }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code: 'consulting_contract' });
  }
  assert.equal(accessed, false);
});

test('stop or expiry during signing prevents the external action even after initial authorization', async () => {
  for (const [afterSign, code] of [[controls => controls.revoke(), 'consent_required'], [controls => controls.advance(30001), 'consulting_consent_required']]) {
    const f = fixture({ afterSign }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code });
    assert.equal(f.calls.filter(x => x.name === 'sign_request').length, 1);
    assert.equal(f.calls.filter(x => x.name === 'act').length, 0);
  }
});

const producerFixtures = JSON.parse(readFileSync(new URL('./fixtures/foxxi-methodology-responses.json', import.meta.url), 'utf8'));
test('all five actual Foxxi producer responses preserve every public methodology and plan field', async () => {
  assert.deepEqual(producerFixtures.responses.map(entry => entry.method).sort(),
    ['classify-first', 'apply-practice', 'gap-analysis', 'dispositional-read', 'stabilise-first'].sort());
  for (const { method, body } of producerFixtures.responses) {
    const f = fixture({ rawResponse: () => JSON.stringify(body) }); await f.client.connect();
    const result = await f.client.requestPlan(f.client.preparePlan(observed()));
    assert.equal(result.response.diagnosis.method, method); assert.deepEqual(result.response, body);
    assert(Object.isFrozen(result.response.plan.consultingProcess));
    assert(result.response.plan.paradigm.every(option => Object.isFrozen(option.methodology)));
    assert(result.response.plan.selected.every(option => Object.isFrozen(option.methodology)));
    assert.equal(f.calls.filter(call => call.name === 'act').length, 1);
  }
});

test('public MethodReference exception rejects foreign, mismatched, extended and misplaced tokens', async () => {
  const source = producerFixtures.responses.find(entry => entry.method === 'gap-analysis').body;
  const changes = [
    body => { body.plan.paradigm[0].methodology.token = 'private-opaque-value'; },
    body => { body.plan.paradigm[0].methodology.token = 'reference'; },
    body => { body.plan.paradigm[0].methodology['@id'] = 'https://attacker.example/InstructionalDesign'; },
    body => { body.plan.paradigm[0].methodology.version = '1.0.1'; },
    body => { body.plan.paradigm[0].methodology.extra = 'private'; },
    body => { body.plan.paradigm[0].methodology.accessToken = 'private'; },
    body => { body.plan.paradigm[0].type = 'reference'; },
    body => { body.plan.paradigm[0].methodology.Token = body.plan.paradigm[0].methodology.token; delete body.plan.paradigm[0].methodology.token; },
    body => { body.plan.consultingProcess = structuredClone(body.plan.paradigm[0].methodology); },
    body => { body.extra = structuredClone(body.plan.consultingProcess); },
    body => { body.plan.extra = { methodology: structuredClone(body.plan.paradigm[0].methodology) }; },
    body => { body['plan.paradigm.0.methodology'] = structuredClone(body.plan.paradigm[0].methodology); },
    body => { body['plan/selected/0/methodology'] = structuredClone(body.plan.paradigm[0].methodology); },
    body => { body.plan.paradigm = { 0: structuredClone(body.plan.paradigm[0]) }; },
    body => { body.plan.selected = { 0: structuredClone(body.plan.paradigm[0]) }; },
    body => { body.plan.selected.push({ type: 'reference', methodology: { ...body.plan.consultingProcess } }); },
    body => { body.plan.selected.push({ type: 'instruction', methodology: { ...body.plan.paradigm[0].methodology, refresh_token: 'private' } }); },
  ];
  for (const change of changes) {
    const body = structuredClone(source); change(body);
    const f = fixture({ rawResponse: () => JSON.stringify(body) }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code: 'consulting_contract' });
  }
});

test('methodology getters and nonenumerable extra fields cannot use the public token exception', async () => {
  let accessed = false;
  for (const change of [
    ref => { Object.defineProperty(ref, 'token', { enumerable: true, get() { accessed = true; return 'instruction'; } }); },
    ref => { Object.defineProperty(ref, 'private', { value: 'private', enumerable: false }); },
  ]) {
    const body = structuredClone(producerFixtures.responses[0].body); change(body.plan.paradigm[0].methodology);
    const f = fixture({ rawResponse: () => body }); await f.client.connect();
    await assert.rejects(f.client.requestPlan(f.client.preparePlan(observed())), { code: 'consulting_contract' });
  }
  assert.equal(accessed, false);
});
