import test from 'node:test';
import assert from 'node:assert/strict';
import { createFoxxiConsultant, FOXXI_PLANNER_ACTION, FOXXI_PLANNER_DESCRIPTOR } from './foxxi-consulting.mjs';

const binding = { subjectDid: 'did:web:identity.example:users:u-pk-alice', authenticatedAgentDid: 'did:web:identity.example:agents:hallowmarch-u-pk-alice', podUrl: 'https://pod.example/u-pk-alice/' };
const target = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan';
const clock = Date.parse('2026-10-16T22:00:00Z');
const task = () => ({ id: 'real-player-session-1', workContext: 'Survive the forest encounter', observedResult: 'I ran out of health while attacking.', desiredResult: 'Notice the enemy attack and retreat before defeat.', constraints: ['Touch controls', 'No companion healer'] });
function fixture(options = {}) {
  const calls = []; let revoked = false, mode = 'normal', owner = binding.subjectDid;
  const transport = { async connect(required) { return { granted: required }; }, async callTool(name, args) {
    calls.push({ name, args: structuredClone(args) });
    if (name === 'get_pod_status') return { pod: 'http://css.railway.internal:3456/u-pk-alice/', userId: 'u-pk-alice', identity: { did: owner }, sessionAgent: { did: binding.authenticatedAgentDid } };
    if (name === 'dereference') return { status: 'ok', affordances: [{ action: FOXXI_PLANNER_ACTION, method: 'POST', target: mode === 'recipient-drift' ? target + '-new' : target }] };
    if (name === 'sign_request') {
      const payload = { ...structuredClone(args.payload), agent_id: binding.authenticatedAgentDid, subject_pod_url: binding.podUrl, timestamp: new Date(clock).toISOString() };
      if (mode === 'content-swap') payload.situation.performer.id = 'did:web:identity.example:users:u-pk-victim';
      if (mode === 'stamp-swap') payload.subject_pod_url = 'https://attacker.example/u-pk-alice/';
      if (mode === 'extra-field') payload.private_evidence = { fake: true };
      if (mode === 'revoked-after-sign') revoked = true;
      return { _signed_payload: JSON.stringify(payload), _signature: 'fixture-signature', signed_as: binding.authenticatedAgentDid };
    }
    if (name === 'act') {
      const payload = JSON.parse(args.payload._signed_payload), situationId = payload.situation.id;
      const method = payload.exemplary ? 'gap-analysis' : 'classify-first';
      return { status: 200, body: JSON.stringify({ classifiedBy: mode === 'response-identity-swap' ? 'did:web:attacker.example:agents:x' : binding.authenticatedAgentDid,
        diagnosis: { situationId, method, regimeSource: payload.exemplary ? 'default-gap-intent' : 'unclassified' },
        plan: { situationId, selected: payload.exemplary ? [{ type: 'reference', rationale: 'The performer reports missing information.' }] : [], summary: 'Actual fixture service response.' } }) };
    }
    throw Error('Unexpected tool: ' + name);
  } };
  const journal = {
    async authorize(args) { calls.push({ name: 'authorize', args }); return { ownerDid: binding.subjectDid, sessionId: 'player-session-1', ...args, consentId: 'consent-1', revision: 1, expiresAt: new Date(clock + 60000).toISOString() }; },
    async assertAuthorized(token) { calls.push({ name: 'assertAuthorized', token }); if (revoked) throw Object.assign(Error('Revoked'), { code: 'consent_required' }); return true; },
  };
  const client = createFoxxiConsultant({ binding, relayUrl: 'https://relay.example', sessionId: 'player-session-1', journal, transport, now: () => clock, ...options });
  return { client, calls, setMode(value) { mode = value; }, setOwner(value) { owner = value; } };
}

test('live planner discovery, frozen preview, delegated signer and consent recheck preserve exact human DTO', async () => {
  const f = fixture(); await f.client.connect();
  assert.equal(f.client.status().recipient, target);
  assert.equal(f.calls.some(x => x.name === 'sign_request' || x.name === 'act'), false, 'opening coaching does not send personal observations');
  const prepared = f.client.preparePlan({ task: task(), context: { observationLevel: 'owner-browser', capturedAt: new Date(clock).toISOString(), metrics: { healthPercent: 30, creatureDefeats: 4 } } });
  assert(Object.isFrozen(prepared.payload.situation.performer));
  assert.equal(prepared.payload.situation.performer.id, binding.subjectDid);
  assert.equal(prepared.payload.situation.performer.kind, 'human');
  assert.equal(prepared.payload.situation.modalStatus, 'Hypothetical');
  assert.equal(Object.hasOwn(prepared.payload, 'exemplary'), false, 'a goal is not by itself evidence of a knowable gap');
  const result = await f.client.requestPlan(prepared);
  assert.equal(result.response.diagnosis.method, 'classify-first');
  assert.equal(result.source.classifiedBy, binding.authenticatedAgentDid);
  assert.equal(result.source.performerDid, binding.subjectDid);
  assert.equal(result.foxxiPersonalRecordCreated, false);
  assert.deepEqual(result.competencyClaims, []);
  const signed = f.calls.find(x => x.name === 'sign_request'); assert.deepEqual(signed.args.payload, prepared.payload);
  const act = f.calls.find(x => x.name === 'act'); assert.equal(act.args.descriptor_url, FOXXI_PLANNER_DESCRIPTOR);
  assert.equal(act.args.action_iri, FOXXI_PLANNER_ACTION);
  assert.equal(f.calls[f.calls.findIndex(x => x.name === 'act') - 1].name, 'assertAuthorized');
  assert(!JSON.stringify(act).includes('accessToken'));
});

test('agent own-subject uses the same contract and explicit self-reported cause evidence', async () => {
  const f = fixture({ subjectKind: 'agent' }); await f.client.connect();
  const prepared = f.client.preparePlan({ task: task(), gapEvidence: { couldPerformUnderIdealConditions: true, factorEvidence: { information: { adequate: false, evidence: 'I cannot find the current attack range.' } } } });
  assert.equal(prepared.payload.situation.performer.kind, 'agent');
  assert.equal(prepared.payload.exemplary, task().desiredResult);
  const result = await f.client.requestPlan(prepared); assert.equal(result.response.diagnosis.regimeSource, 'default-gap-intent');
  assert.equal(result.service.target, target);
});

test('consent revoked during signing prevents any external act', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.preparePlan({ task: task() });
  f.setMode('revoked-after-sign'); await assert.rejects(f.client.requestPlan(prepared), { code: 'consent_required' });
  assert.equal(f.calls.filter(x => x.name === 'act').length, 0);
});

for (const mode of ['content-swap', 'stamp-swap', 'extra-field']) test(mode + ' cannot alter frozen external preview', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.preparePlan({ task: task() });
  f.setMode(mode); await assert.rejects(f.client.requestPlan(prepared), { code: 'consulting_signature' });
  assert.equal(f.calls.filter(x => x.name === 'act').length, 0);
});

test('changed owner or live recipient needs a new connection and preview', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.preparePlan({ task: task() });
  f.setOwner('did:web:identity.example:users:u-pk-bob'); await assert.rejects(f.client.requestPlan(prepared), { code: 'owner_mismatch' });
  assert.equal(f.calls.filter(x => x.name === 'sign_request').length, 0);
  f.setOwner(binding.subjectDid); f.setMode('recipient-drift'); await assert.rejects(f.client.requestPlan(prepared), { code: 'consulting_contract_changed' });
  assert.equal(f.calls.filter(x => x.name === 'sign_request').length, 0);
});

test('arbitrary subjects, secret context, forged previews and substituted response identities fail closed', async () => {
  const f = fixture(); await f.client.connect();
  assert.throws(() => f.client.preparePlan({ task: { ...task(), performerDid: 'did:example:other' } }), { code: 'invalid_consultation' });
  assert.throws(() => f.client.preparePlan({ task: task(), context: { observationLevel: 'owner-browser', capturedAt: new Date(clock).toISOString(), metrics: { inventory: 9 } } }), { code: 'invalid_consultation' });
  const prepared = f.client.preparePlan({ task: task() });
  await assert.rejects(f.client.requestPlan(structuredClone(prepared)), { code: 'consultation_preview_required' });
  f.setMode('response-identity-swap'); await assert.rejects(f.client.requestPlan(prepared), { code: 'consulting_contract' });
});
