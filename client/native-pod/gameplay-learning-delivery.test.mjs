import test from 'node:test';
import assert from 'node:assert/strict';
import { createGameplayActivityProfile, gameplayActivityStatement } from './gameplay-activity.mjs';
import { createOwnerGameplayLearningDelivery, GAMEPLAY_LEARNING_DESCRIPTOR, GAMEPLAY_LEARNING_WRITE_ACTION,
  GAMEPLAY_LEARNING_READ_ACTION, GAMEPLAY_LEARNING_PURPOSE } from './gameplay-learning-delivery.mjs';

const owner = 'did:web:identity.example:users:alice', delegate = 'did:web:identity.example:agents:hallowmarch-alice';
const podUrl = 'https://pod.example/alice/', characterId = 'char-alice';
const sessionId = 'consent-session', gameplaySessionId = '17c9c70f-c91c-49a9-bd29-7f93f1477c01';
const clock = Date.parse('2026-10-17T18:00:00.000Z');
const writeTarget = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/write';
const readTarget = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/read';
const copy = value => structuredClone(value);
function observations(count = 2, overrides = {}) {
  let sequence = 0;
  const profile = createGameplayActivityProfile({ ownerDid: owner, characterId, sessionId: gameplaySessionId, now: () => clock,
    uuid: () => '43d9d02a-8c27-4a70-a000-' + String(++sequence).padStart(12, '0') });
  return Array.from({ length: count }, (_, index) => profile.record({ type: index ? 'agent.command-accepted' : 'craft.completed',
    body: { id: index ? characterId + ':companion:one' : characterId, kind: index ? 'owned-unit' : 'character' },
    actor: index ? { kind: 'agent', id: 'did:web:identity.example:agents:companion', grantId: 'urn:uuid:7cd0d0b7-9755-4c02-92fd-d60809cbb3b3' } : { kind: 'human-input' },
    object: { id: index ? 'move' : 'planks', kind: index ? 'agent-command' : 'craft' }, result: { success: true }, context: { party: true }, ...overrides }).event);
}
function fixture(options = {}) {
  const calls = [], records = options.records || new Map(); let mode = '', revoked = false, currentOwner = owner, currentDelegate = delegate;
  let time = clock, commitResult = true, afterCommit = null, durableState = options.state || null;
  const transport = { async connect(required) { return { granted: required }; }, async callTool(name, args) {
    calls.push({ name, args: copy(args) });
    if (name === 'get_pod_status') return { pod: 'http://css.railway.internal:3456/alice/', userId: 'alice', identity: { did: currentOwner }, sessionAgent: { did: currentDelegate } };
    if (name === 'dereference') return { status: 'ok', affordances: [
      { action: GAMEPLAY_LEARNING_WRITE_ACTION, method: 'POST', target: writeTarget + (mode === 'contract-drift' ? '-other' : '') },
      { action: GAMEPLAY_LEARNING_READ_ACTION, method: 'POST', target: readTarget }] };
    if (name === 'sign_request') {
      const payload = { ...copy(args.payload), agent_id: delegate, subject_pod_url: podUrl, timestamp: new Date(time).toISOString() };
      if (mode === 'subject-swap') payload.subject_did = 'did:web:identity.example:users:bob';
      if (mode === 'stamp-swap') payload.subject_pod_url = 'https://attacker.example/alice/';
      if (mode === 'extra-field') payload.context = { password: 'not-allowed' };
      if (mode === 'statement-swap') payload.statements[0].actor.account.name = delegate;
      if (mode === 'revoke-after-sign') revoked = true;
      if (mode === 'expire-after-sign') time += 900001;
      return { _signed_payload: JSON.stringify(payload), _signature: 'test-only-signature' };
    }
    if (name === 'act') {
      const payload = JSON.parse(args.payload._signed_payload);
      if (args.action_iri === GAMEPLAY_LEARNING_READ_ACTION) {
        const statement = records.get(payload.query.statementId);
        if (mode === 'expired-read') return { status: 410, body: { ok: false, error: 'outside retained detail' } };
        return statement ? { status: 200, body: { ok: true, durable: true, subjectDid: owner, statement: copy(statement) } }
          : { status: 404, body: { ok: false, error: 'not found' } };
      }
      for (const statement of payload.statements) records.set(statement.id, { ...copy(statement), authority: { objectType: 'Agent', account: { homePage: 'https://foxxi.example', name: 'LRS' } }, stored: new Date(time).toISOString(), version: '2.0.0' });
      if (mode === 'timeout-after-write') throw Error('Connection closed after accepting body');
      const ids = payload.statements.map(statement => statement.id);
      return { status: mode === 'partial-durable' ? 502 : 200, body: { ok: true, lrsAccepted: true, durable: mode !== 'partial-durable',
        subjectDid: mode === 'response-owner-swap' ? delegate : owner, statementIds: ids,
        receipts: ids.map(statementId => ({ statementId, persisted: true, holonUri: 'urn:holon:encrypted:' + statementId,
          ...(mode === 'public-receipt' ? { descriptorUrl: 'https://public.example/record' } : {}) })) } };
    }
    throw Error('Unexpected tool ' + name);
  } };
  const journal = {
    async authorize(scope) { calls.push({ name: 'authorize', args: copy(scope) }); if (revoked) throw Object.assign(Error('Withdrawn'), { code: 'consultation_consent_required' });
      return { ...scope, ownerDid: owner, sessionId, consentId: 'consent-real-session', revision: 1, expiresAt: new Date(clock + 900000).toISOString() }; },
    async assertAuthorized(token) { calls.push({ name: 'assertAuthorized', args: copy(token) });
      if (revoked) throw Object.assign(Error('Withdrawn'), { code: 'consultation_consent_required' }); return true; },
  };
  const client = createOwnerGameplayLearningDelivery({ binding: { subjectDid: owner, authenticatedAgentDid: delegate, podUrl },
    relayUrl: 'https://relay.example', journal, sessionId, gameplaySessionId, characterId, startAfterOrdinal: 0,
    transport, now: () => time, ...options, commitState: async state => {
      const saved = commitResult; calls.push({ name: 'commitState', state: copy(state) }); if (saved) durableState = copy(state); afterCommit?.(); return { saved };
    } });
  return { client, calls, records, setMode: value => { mode = value; }, revoke: () => { revoked = true; },
    changeOwner: value => { currentOwner = value; }, changeDelegate: value => { currentDelegate = value; }, advance: ms => { time += ms; },
    failCommit: () => { commitResult = false; }, resumeCommit: () => { commitResult = true; }, afterCommit: value => { afterCommit = value; }, durableState: () => copy(durableState) };
}

test('opening discovers current own-subject contract without signing or sending personal activity', async () => {
  const f = fixture(); await f.client.connect();
  assert.equal(f.client.status().purpose, GAMEPLAY_LEARNING_PURPOSE); assert.equal(f.client.status().recipient, writeTarget);
  assert.equal(f.client.status().taskId, 'hallowmarch-activity:' + characterId + ':' + sessionId);
  assert(!f.calls.some(call => ['sign_request', 'act', 'commitState', 'authorize'].includes(call.name)));
});

test('only explicitly enabled current session events become eligible and the canonical mapper preserves companion attribution', async () => {
  const events = observations(3), f = fixture({ startAfterOrdinal: 1 }); await f.client.connect();
  const prepared = f.client.prepare(events); assert.equal(prepared.count, 2); assert(Object.isFrozen(prepared.events[0].actor));
  const result = await f.client.deliver(prepared); assert.equal(result.delivered, true); assert.equal(result.count, 2);
  const act = f.calls.find(call => call.name === 'act'), sent = JSON.parse(act.args.payload._signed_payload);
  assert.equal(act.args.descriptor_url, GAMEPLAY_LEARNING_DESCRIPTOR); assert.equal(act.args.action_iri, GAMEPLAY_LEARNING_WRITE_ACTION);
  assert.equal(sent.subject_did, owner); assert.equal(sent.agent_id, delegate); assert.equal(sent.purpose, 'personal-performance');
  assert.deepEqual(sent.statements, events.slice(1).map(event => gameplayActivityStatement(event, owner)));
  assert.equal(sent.statements[0].actor.account.name, owner);
  assert.equal(sent.statements[0].context.extensions['urn:interego:gaming:activity:context'].controllerId, 'did:web:identity.example:agents:companion');
  assert.equal(sent.statements[0].context.extensions['urn:interego:gaming:activity:context'].bodyKind, 'owned-unit');
  assert(!Object.hasOwn(sent.statements[0].result, 'completion'));
  assert.equal(f.client.prepare(events), null); assert.equal(f.client.save().throughOrdinal, 3);
  assert.equal(f.client.save().pending, null); assert.equal(f.client.save().acknowledgedCount, 2);
  assert(f.calls.findIndex(call => call.name === 'commitState') < f.calls.findIndex(call => call.name === 'act'));
});

test('optional learning can activate after hundreds of game actions and deliver only the newly enabled rolling observations', async () => {
  let next = 0;
  const profile = createGameplayActivityProfile({ ownerDid: owner, characterId, sessionId: gameplaySessionId, now: () => clock,
    uuid: () => '30e19021-423c-4e9c-8000-' + String(++next).padStart(12, '0') });
  const f = fixture({ startAfterOrdinal: 250 });
  for (let ordinal = 1; ordinal <= 256; ordinal++) profile.record({ type: 'resource.gathered',
    body: { id: characterId, kind: 'character' }, actor: { kind: 'human-input' }, object: { id: 'stone', kind: 'resource' },
    result: { quantity: 1, success: true }, context: { party: false } });
  await f.client.connect(); const prepared = f.client.prepare(profile.save().recent);
  assert.equal(prepared.count, 6); assert.equal(prepared.events[0].ordinal, 251); assert.equal(prepared.events.at(-1).ordinal, 256);
  await f.client.deliver(prepared); assert.equal(f.client.status().acknowledgedCount, 6);
  const sent = JSON.parse(f.calls.find(call => call.name === 'act').args.payload._signed_payload).statements;
  assert.equal(sent.at(-1).result.extensions['urn:interego:gaming:activity:observation'].historyOrdinal, 256);
  assert.equal(profile.snapshot().summary.counters['resource.gathered'], 256);
  assert.equal(profile.snapshot().history.detailsDropped, 192);
});

test('foreign gameplay sessions, arbitrary preview objects and changed identities cannot send', async () => {
  const f = fixture(); await f.client.connect(); const events = observations();
  assert.throws(() => f.client.prepare([{ ...events[0], sessionId: 'cbf1220a-c564-44cf-a5c3-d4140e162cf4' }]), { code: 'learning_delivery_scope' });
  const prepared = f.client.prepare(events); await assert.rejects(f.client.deliver(copy(prepared)), { code: 'learning_preview_required' });
  f.changeOwner('did:web:identity.example:users:bob'); await assert.rejects(f.client.deliver(prepared), { code: 'owner_mismatch' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, 0);
});

test('an unconfirmed native journal write fences the external act', async () => {
  const f = fixture(); await f.client.connect(); f.failCommit();
  const prepared = f.client.prepare(observations());
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_state_unconfirmed' });
  assert.equal(f.client.status().pending, true); assert.equal(f.client.status().statePending, true);
  assert.throws(() => f.client.prepare(observations(3)), { code: 'learning_delivery_pending' });
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_delivery_pending' });
  await assert.rejects(f.client.retryPending(), { code: 'learning_state_unconfirmed' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, 0);
  f.resumeCommit(); await f.client.retryPending();
  const write = f.calls.find(call => call.name === 'act');
  assert.deepEqual(JSON.parse(write.args.payload._signed_payload).statements.map(statement => statement.id), prepared.statementIds);
  assert.equal(f.client.status().pending, false);
});

test('a caller scope change during private staging or signing fences the external act immediately', async () => {
  let current = true;
  const first = fixture({ assertCurrent: () => current }); await first.client.connect();
  first.afterCommit(() => { current = false; });
  await assert.rejects(first.client.deliver(first.client.prepare(observations())), { code: 'learning_delivery_scope_changed' });
  assert(first.durableState().pending, 'the exact private marker survives even if the browser scope closes');
  assert(!first.calls.some(call => call.name === 'act'));
  const second = fixture({ assertCurrent: () => !second.calls.some(call => call.name === 'sign_request') }); await second.client.connect();
  await assert.rejects(second.client.deliver(second.client.prepare(observations())), { code: 'learning_delivery_scope_changed' });
  assert(!second.calls.some(call => call.name === 'act'));
});

for (const mode of ['subject-swap', 'stamp-swap', 'extra-field', 'statement-swap']) test(mode + ' cannot alter signature-covered activity or its owner', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode(mode);
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_delivery_signature' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, 0); assert(f.client.status().pending);
});

for (const mode of ['revoke-after-sign', 'expire-after-sign']) test(mode + ' prevents activity delivery after private staging', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode(mode);
  await assert.rejects(f.client.deliver(prepared), { code: mode === 'revoke-after-sign' ? 'consultation_consent_required' : 'learning_delivery_signature' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, 0);
});

test('a changed live destination is rejected before private staging or signing', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode('contract-drift');
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_delivery_contract_changed' });
  assert(!f.calls.some(call => ['act', 'sign_request', 'commitState'].includes(call.name)));
});

for (const mode of ['timeout-after-write', 'partial-durable', 'response-owner-swap', 'public-receipt']) test(mode + ' leaves an exact pending batch and never automatically resends it', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode(mode);
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_delivery_unconfirmed' });
  assert.equal(f.client.status().pendingCount, 2); assert.equal(f.durableState().pending.events[0].id, prepared.events[0].id);
  await assert.rejects(f.client.deliver(prepared), { code: 'learning_delivery_pending' });
  assert.throws(() => f.client.prepare(observations()), { code: 'learning_delivery_pending' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, 1);
});

test('restart reconciles exact LRS envelopes by id without rewriting accepted observations', async () => {
  const f = fixture(); await f.client.connect(); f.setMode('timeout-after-write');
  await assert.rejects(f.client.deliver(f.client.prepare(observations())));
  const restored = fixture({ state: f.durableState(), records: f.records, startAfterOrdinal: 20 }); await restored.client.connect();
  assert(!restored.calls.some(call => call.name === 'act')); const result = await restored.client.reconcile();
  assert.equal(result.delivered, true); assert.equal(restored.client.status().pending, false);
  assert(restored.calls.filter(call => call.name === 'act').every(call => call.args.action_iri === GAMEPLAY_LEARNING_READ_ACTION));
  assert.equal(restored.client.prepare(observations()), null, 'a later activation cannot export older activity');
});

test('a partial write remains pending on absent ids; an explicit retry preserves every original id and body', async () => {
  const f = fixture(); await f.client.connect(); const original = f.client.prepare(observations()); f.setMode('timeout-after-write');
  await assert.rejects(f.client.deliver(original)); f.records.delete(original.statementIds[1]); f.setMode('');
  const result = await f.client.reconcile(); assert.equal(result.delivered, false); assert.equal(result.missingStatementId, original.statementIds[1]);
  assert(f.client.status().pending); await f.client.retryPending();
  const writes = f.calls.filter(call => call.name === 'act' && call.args.action_iri === GAMEPLAY_LEARNING_WRITE_ACTION)
    .map(call => JSON.parse(call.args.payload._signed_payload).statements);
  assert.equal(writes.length, 2); assert.deepEqual(writes[0], writes[1]); assert.equal(f.client.status().pending, false);
});

test('conflicting LRS bodies remain pending and cannot become an acknowledgment', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode('timeout-after-write');
  await assert.rejects(f.client.deliver(prepared)); f.records.get(prepared.statementIds[0]).result.success = false;
  await assert.rejects(f.client.reconcile(), { code: 'learning_delivery_conflict' }); assert(f.client.status().pending);
});

test('explicitly closing an expired unknown batch preserves actual acknowledgments and never sends or replays it', async () => {
  const f = fixture(); await f.client.connect(); const prepared = f.client.prepare(observations()); f.setMode('timeout-after-write');
  await assert.rejects(f.client.deliver(prepared)); f.setMode('expired-read');
  const result = await f.client.reconcile(); assert.equal(result.expired, true); assert.equal(result.delivered, false);
  f.advance(3600000);
  const callsBefore = f.calls.filter(call => call.name === 'act').length;
  await assert.rejects(f.client.retryPending(), { code: 'learning_delivery_expired' });
  assert.equal(f.calls.filter(call => call.name === 'act').length, callsBefore, 'expired IDs cannot be written again after deduplication expiry');
  assert.equal(f.client.status().pending, true, 'expiration never silently closes or acknowledges the batch');
  const closed = await f.client.abandonPending(); assert.deepEqual(closed, { closedUnconfirmed: true, count: 2, throughOrdinal: 2 });
  assert.equal(f.calls.filter(call => call.name === 'act').length, callsBefore, 'explicit closure is only a private owner save');
  assert.equal(f.client.status().acknowledgedCount, 0); assert.equal(f.client.status().closedUnconfirmedCount, 2);
  const restored = fixture({ state: f.durableState() }); await restored.client.connect();
  assert.equal(restored.client.status().pending, false); assert.equal(restored.client.status().closedUnconfirmedCount, 2);
  assert.equal(restored.client.status().acknowledgedCount, 0); assert.equal(restored.client.prepare(observations()), null);
  assert.equal(restored.client.prepare(observations(3)).count, 1, 'a later future observation remains eligible');
});

test('an uncertain closure save retains the pending fence until that exact private closure confirms', async () => {
  const f = fixture(); await f.client.connect(); f.setMode('timeout-after-write');
  await assert.rejects(f.client.deliver(f.client.prepare(observations()))); f.failCommit();
  const writes = f.calls.filter(call => call.name === 'act').length;
  await assert.rejects(f.client.closePending(), { code: 'learning_state_unconfirmed' });
  assert.equal(f.client.status().pending, true); assert.equal(f.client.status().closedUnconfirmedCount, 0);
  assert.throws(() => f.client.prepare(observations(3)), { code: 'learning_delivery_pending' });
  assert.equal(f.client.status().acknowledgedCount, 0); assert.equal(f.calls.filter(call => call.name === 'act').length, writes);
  f.resumeCommit(); await f.client.closePending();
  assert.equal(f.client.status().pending, false); assert.equal(f.client.status().closedUnconfirmedCount, 2);
  assert.equal(f.client.status().acknowledgedCount, 0); assert.equal(f.calls.filter(call => call.name === 'act').length, writes);
});

test('legacy delivery state loads with zero unconfirmed closures without migration writes', async () => {
  const first = fixture(); await first.client.connect(); const legacy = first.client.save(); delete legacy.closedUnconfirmedCount;
  const restored = fixture({ state: legacy }); await restored.client.connect();
  assert.equal(restored.client.status().closedUnconfirmedCount, 0); assert(!restored.calls.some(call => call.name === 'commitState'));
});

test('an acknowledgment save failure keeps the pre-send marker for exact read-only recovery', async () => {
  const f = fixture(); await f.client.connect(); let calls = 0; f.afterCommit(() => { if (++calls === 1) f.failCommit(); });
  await assert.rejects(f.client.deliver(f.client.prepare(observations())), { code: 'learning_state_unconfirmed' });
  assert(f.client.status().pending); assert.equal(f.client.status().acknowledgedCount, 0);
  const restored = fixture({ state: f.durableState(), records: f.records }); await restored.client.connect();
  assert.equal((await restored.client.reconcile()).delivered, true);
});

test('bounded cursor state does not grow with historical delivery ids and cross-owner state fails closed', async () => {
  const f = fixture(); await f.client.connect(); await f.client.deliver(f.client.prepare(observations(20)));
  const state = f.client.save(); assert(state.throughOrdinal === 20); assert(JSON.stringify(state).length < 512);
  assert.throws(() => fixture({ state: { ...state, ownerDid: delegate } }), { code: 'learning_delivery_scope' });
  assert.throws(() => fixture({ state: { ...state, characterId: 'other-character' } }), { code: 'learning_delivery_scope' });
  f.client.close(); await assert.rejects(f.client.retryPending(), { code: 'learning_delivery_disconnected' });
});
