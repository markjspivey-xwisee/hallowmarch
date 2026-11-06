import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerGameplayRecordReader, GAMEPLAY_RECORD_DESCRIPTOR, GAMEPLAY_RECORD_READ_ACTION } from './gameplay-record-reader.mjs';
import { createGameplayActivityProfile, gameplayActivityStatement } from './gameplay-activity.mjs';
import { signingDelegationFixture } from './signing-delegation.fixture.mjs';

const owner = 'did:web:identity.example:users:alice', delegate = 'did:web:identity.example:agents:hallowmarch-alice';
const podUrl = 'https://pod.example/alice/', clock = Date.parse('2026-10-27T21:00:00.000Z');
const target = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/read';
const clone = value => structuredClone(value), stamp = time => new Date(time).toISOString();
function statements(count = 2) {
  let next = 0;
  const profile = createGameplayActivityProfile({ ownerDid: owner, characterId: 'char-a', sessionId: '17c9c70f-c91c-49a9-bd29-7f93f1477c01', now: () => clock - 1000,
    uuid: () => '43d9d02a-8c27-4a70-a000-' + String(++next).padStart(12, '0') });
  return Array.from({ length: count }, () => ({ ...gameplayActivityStatement(profile.record({ type: 'craft.completed', body: { id: 'char-a', kind: 'character' },
    actor: { kind: 'human-input' }, object: { id: 'planks', kind: 'craft' }, result: { success: true }, context: {} }).event, owner),
  authority: { objectType: 'Agent', account: { homePage: 'https://foxxi-bridge.interego.xwisee.com', name: 'foxxi-personal-activity-window' } },
  stored: stamp(clock), version: '2.0.0' })).map(statement => ({ ...statement,
    actor: { ...statement.actor, account: { homePage: 'https://identity.example', name: owner } } }));
}
function metadata(records) {
  const count = key => [...records.reduce((map, record) => {
    const id = key(record); map.set(id, (map.get(id) || 0) + 1); return map;
  }, new Map())].map(([id, count]) => ({ id, count }));
  return { coverage: { model: 'bounded-personal-observation-profile', completeHistory: false, retentionMs: 3600000, maxDetailedStatements: 512, maxReceiptIds: 4096,
    from: stamp(clock - 3600000), retainedFrom: records[0]?.timestamp || null, through: records.at(-1)?.timestamp || null,
    retainedCount: records.length, prunedCount: 0, observationAuthority: 'owner-browser-observation', competencyStatus: 'not-assessed' },
  profile: { total: records.length, byVerb: count(record => record.verb.id), byBody: count(record => record.context.extensions['urn:interego:gaming:activity:context'].bodyId),
    byController: count(record => record.context.extensions['urn:interego:gaming:activity:context'].controllerKind), otherVerb: 0, otherBody: 0, otherController: 0,
    saturated: false, firstAt: records[0]?.timestamp || null, lastAt: records.at(-1)?.timestamp || null, detailsPruned: 0 } };
}
const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url') + '.synthetic-signature';
const decode = value => JSON.parse(Buffer.from(value.split('.')[0], 'base64url').toString('utf8'));
function fixture({ records = statements(), scope = 'DiscoverOnly', ...options } = {}) {
  const calls = [], credentials = [];
  let time = clock, mode = '', current = true, afterTool = null, responseMutator = null, revision = 'snapshot-a';
  const signing = signingDelegationFixture({ ownerDid: owner, agentDid: delegate, podUrl, statusPod: 'http://css.railway.internal:3456/alice/', scope });
  const transport = { async connect(required, probe) { calls.push({ name: 'connect', required, probe }); return { granted: required }; },
    setCredential(value) { credentials.push(clone(value)); },
    async callTool(name, args) {
      calls.push({ name, args: clone(args) }); let reply;
      if (name === 'get_pod_status') { reply = clone(signing.status); if (mode === 'owner-swap') reply.identity.did = 'did:web:identity.example:users:bob'; }
      else if (name === 'dereference') reply = { status: 'ok', affordances: [{ action: GAMEPLAY_RECORD_READ_ACTION, target: target + (mode === 'contract-drift' ? '-changed' : ''), method: 'POST' }] };
      else if (name === 'sign_request') {
        const payload = { ...clone(args.payload), agent_id: delegate, subject_pod_url: podUrl, timestamp: stamp(time) };
        if (mode === 'sign-owner') payload.subject_did = 'did:web:identity.example:users:bob';
        if (mode === 'sign-agent') payload.agent_id = owner;
        if (mode === 'sign-pod') payload.subject_pod_url = 'https://attacker.example/alice/';
        if (mode === 'sign-purpose') payload.purpose = 'record';
        if (mode === 'sign-query') payload.query.limit = 200;
        if (mode === 'sign-stale') payload.timestamp = stamp(time - 60001);
        if (mode === 'sign-extra') payload.statements = [];
        reply = { _signed_payload: JSON.stringify(payload), _signature: 'synthetic-only-signature' };
      } else if (name === 'act') {
        assert.equal(args.action_iri, GAMEPLAY_RECORD_READ_ACTION); assert.equal(args.descriptor_url, GAMEPLAY_RECORD_DESCRIPTOR);
        const payload = JSON.parse(args.payload._signed_payload), query = payload.query;
        const meta = metadata(records);
        if (mode.startsWith('status-')) reply = { status: Number(mode.slice(7)), body: { ok: false, subjectDid: owner, coverage: meta.coverage, error: 'Synthetic refusal' } };
        else if (query.statementId) {
          const record = records.find(record => record.id === query.statementId);
          reply = record ? { status: 200, body: { ok: true, durable: true, subjectDid: owner, coverage: meta.coverage, statement: clone(record) } }
            : { status: 404, body: { ok: false, subjectDid: owner, coverage: meta.coverage, error: 'Not in retained window' } };
        } else {
          const continuation = query.cursor ? decode(query.cursor) : null;
          if (continuation && continuation.revision !== revision) reply = { status: 409, body: { ok: false, subjectDid: owner, coverage: meta.coverage } };
          else {
            const filters = continuation?.query || query, offset = continuation?.offset || 0, limit = filters.limit;
            const selected = records.filter(record => !filters.verb || record.verb.id === filters.verb).slice(offset, offset + limit);
            reply = { status: 200, body: { ok: true, durable: true, subjectDid: owner, ...meta, statements: clone(selected),
              more: offset + limit < records.length ? encode({ revision, query: filters, offset: offset + limit, expiresAt: time + 60000 }) : '' } };
          }
        }
        if (mode === 'timeout') throw Error('Synthetic connection unavailable');
        responseMutator?.(reply);
      } else throw Error('Unexpected non-read operation ' + name);
      afterTool?.(name, reply); return reply;
    } };
  const reader = createOwnerGameplayRecordReader({ binding: { subjectDid: owner, authenticatedAgentDid: delegate, podUrl }, transport, relayUrl: 'https://relay.example',
    assertCurrent: () => current, now: () => time, ...options });
  return { reader, calls, credentials, signing, setMode: value => { mode = value; }, advance: ms => { time += ms; }, revoke: () => { current = false; },
    mutate: value => { responseMutator = value; }, after: value => { afterTool = value; }, changeSnapshot: () => { revision = 'snapshot-b'; } };
}

test('connecting is strictly read-only and needs existing discover scope, not recording consent or publish setup', async () => {
  for (const scope of ['DiscoverOnly', 'ReadOnly', 'ReadWrite']) {
    const f = fixture({ scope }); await f.reader.connect();
    assert.equal(f.reader.status().readOnly, true); assert.equal(f.reader.status().recordingConsentRequired, false);
    assert.deepEqual(f.calls.map(call => call.name), ['connect', 'get_pod_status', 'dereference']);
    assert.equal(f.calls[0].probe, 'get_pod_status');
  }
  const f = fixture({ scope: 'PublishOnly' }); await assert.rejects(f.reader.connect(), { code: 'account_record_delegation_required' });
  assert(!f.calls.some(call => ['register_agent', 'verify_agent', 'sign_request', 'act'].includes(call.name)));
});

test('verified empty account record is a successful bounded empty read, distinct from service failure', async () => {
  const f = fixture({ records: [] }); await f.reader.connect(); const page = await f.reader.query();
  assert.equal(page.state, 'loaded'); assert.deepEqual(page.statements, []); assert.equal(page.summary.total, 0);
  assert.equal(page.coverage.completeHistory, false); assert.equal(page.more, false); assert.equal(page.checkedAt, stamp(clock));
  assert(Object.isFrozen(page.coverage));
  f.setMode('status-503'); await assert.rejects(f.reader.query(), { code: 'account_record_unavailable' });
});

test('actual actor-bound xAPI envelopes survive an exact fresh read signature without writes', async () => {
  const f = fixture(); await f.reader.connect(); const page = await f.reader.query({ limit: 2 });
  assert.deepEqual(page.statements, statements()); assert.equal(page.summary.total, 2); assert.equal(page.coverage.retainedCount, 2);
  const act = f.calls.find(call => call.name === 'act'), signed = JSON.parse(act.args.payload._signed_payload);
  assert.deepEqual(signed.query, { limit: 2 }); assert.equal(signed.subject_did, owner); assert.equal(signed.purpose, 'personal-performance');
  assert(!f.calls.some(call => ['register_agent', 'verify_agent', 'publish_context', 'write', 'commitState'].includes(call.name)));
  assert.equal(Object.hasOwn(f.reader, 'prepare'), false); assert.equal(Object.hasOwn(f.reader, 'deliver'), false);
});

test('continuation remains bound to exact page, reader, owner, query and native snapshot', async () => {
  const f = fixture(); await f.reader.connect(); const first = await f.reader.query({ limit: 1 });
  assert.equal(first.more, true); assert.equal(Object.hasOwn(first, 'cursor'), false);
  await assert.rejects(f.reader.next(clone(first)), { code: 'account_record_cursor' });
  const other = fixture(); await other.reader.connect(); await assert.rejects(other.reader.next(first), { code: 'account_record_cursor' });
  const last = await f.reader.next(first); assert.equal(last.more, false); assert.equal(last.statements[0].id, statements()[1].id);
  const readQueries = f.calls.filter(call => call.name === 'sign_request').map(call => call.args.payload.query);
  assert.deepEqual(Object.keys(readQueries[1]), ['cursor']); assert.equal(decode(readQueries[1].cursor).query.limit, 1);
  await assert.rejects(f.reader.next(first), { code: 'account_record_cursor' });
  const changed = await f.reader.query({ limit: 1 }); f.changeSnapshot(); await assert.rejects(f.reader.next(changed), { code: 'account_record_snapshot_changed' });
});

test('cursor expiry and unsafe caller-supplied cursor or filters fail before signing', async () => {
  const f = fixture(); await f.reader.connect();
  for (const filters of [{ cursor: 'invented' }, { limit: 201 }, { limit: 0 }, { ascending: 'true' }, { verb: 'javascript text' }, { since: '2026' },
    { since: stamp(clock), until: stamp(clock - 1) }, { statementId: statements()[0].id, limit: 1 }]) assert.throws(() => f.reader.query(filters));
  assert(!f.calls.some(call => call.name === 'sign_request'));
  const page = await f.reader.query({ limit: 1 }); f.advance(60001); await assert.rejects(f.reader.next(page), { code: 'account_record_snapshot_changed' });
});

test('signature subject, agent, own pod, purpose, filters, freshness and extra-field substitutions are refused', async () => {
  for (const mode of ['sign-owner', 'sign-agent', 'sign-pod', 'sign-purpose', 'sign-query', 'sign-stale', 'sign-extra']) {
    const f = fixture(); await f.reader.connect(); f.setMode(mode);
    await assert.rejects(f.reader.query(), { code: 'account_record_signature' }); assert(!f.calls.some(call => call.name === 'act'));
  }
  const f = fixture(); await f.reader.connect(); let signed = false;
  f.after(name => { if (name === 'sign_request') signed = true; else if (name === 'get_pod_status' && signed) f.advance(60001); });
  await assert.rejects(f.reader.query(), { code: 'account_record_signature' }); assert(!f.calls.some(call => call.name === 'act'));
});

test('account switches, revoked discover rows, contract drift and closure during awaits release no record', async () => {
  const switched = fixture(); await switched.reader.connect(); switched.setMode('owner-swap'); await assert.rejects(switched.reader.query(), { code: 'account_record_owner_mismatch' });
  const revoked = fixture(); await revoked.reader.connect(); revoked.signing.status.delegationRegistry.rows[0].revoked = true;
  await assert.rejects(revoked.reader.query(), { code: 'account_record_delegation_required' });
  const drift = fixture(); await drift.reader.connect(); drift.setMode('contract-drift'); await assert.rejects(drift.reader.query(), { code: 'account_record_contract_changed' });
  for (const operation of ['get_pod_status', 'dereference', 'sign_request', 'act']) {
    const f = fixture(); await f.reader.connect(); f.after(name => { if (name === operation) f.revoke(); });
    await assert.rejects(f.reader.query(), { code: 'account_record_scope_changed' });
    const closed = fixture(); await closed.reader.connect(); closed.after(name => { if (name === operation) closed.reader.close(); });
    await assert.rejects(closed.reader.query(), { code: 'account_record_closed' });
    assert.equal(closed.credentials.at(-1).accessToken, '');
  }
});

test('cross-subject bodies, actors, wrong activity/filter results and false durable claims are refused', async () => {
  for (const mutation of [
    body => { body.subjectDid = delegate; }, body => { body.statements[0].actor.account.name = delegate; },
    body => { body.statements[0].actor.account.homePage = 'https://other.example'; }, body => { body.statements[0].actor.mbox = 'mailto:other@example.org'; },
    body => { body.statements[0].context.extensions['urn:interego:gaming:activity:context'].bodyKind = 'other-subject'; },
    body => { body.statements[0].result.extensions['urn:interego:gaming:activity:observation'].authority = 'server-verified'; },
    body => { body.durable = false; }, body => { body.profile.total++; }, body => { body.coverage.completeHistory = true; },
    body => { body.statements.push(clone(body.statements[0])); }, body => { body.statements[0].verb.id = 'urn:other:verb'; }
  ]) {
    const f = fixture(); await f.reader.connect(); f.mutate(reply => mutation(reply.body));
    await assert.rejects(f.reader.query({ verb: statements()[0].verb.id }));
  }
});

test('malformed or substituted continuation query/offset/revision and repeated page rows fail closed', async () => {
  for (const change of [value => { value.query.limit = 200; }, value => { value.offset = 0; }, value => { value.expiresAt = clock - 1; }]) {
    const f = fixture(); await f.reader.connect(); f.mutate(reply => { const cursor = decode(reply.body.more); change(cursor); reply.body.more = encode(cursor); });
    await assert.rejects(f.reader.query({ limit: 1 }), { code: 'account_record_snapshot_changed' });
  }
  const f = fixture(); await f.reader.connect(); const page = await f.reader.query({ limit: 1 });
  f.mutate(reply => { reply.body.statements = [statements()[0]]; }); await assert.rejects(f.reader.next(page), { code: 'account_record_contract' });
});

test('missing UUID, pruned detail, authentication, authority and storage failures stay distinct', async () => {
  const f = fixture(); await f.reader.connect(); const missing = await f.reader.query({ statementId: '00000000-0000-0000-0000-000000000000' });
  assert.equal(missing.state, 'missing'); assert.equal(missing.coverage.completeHistory, false);
  f.setMode('status-410'); assert.equal((await f.reader.query({ statementId: statements()[0].id })).state, 'detail-unavailable');
  for (const [status, code] of [[401, 'needs_reauth'], [403, 'account_record_delegation_required'], [409, 'account_record_snapshot_changed'], [503, 'account_record_unavailable'], [429, 'account_record_unavailable']]) {
    f.setMode('status-' + status); await assert.rejects(f.reader.query(), { code });
  }
  f.setMode('timeout'); await assert.rejects(f.reader.query(), { code: 'account_record_unavailable' });
});

test('read timeout can retry the same snapshot continuation without any write recovery', async () => {
  const f = fixture(); await f.reader.connect(); const page = await f.reader.query({ limit: 1 });
  f.setMode('timeout'); await assert.rejects(f.reader.next(page), { code: 'account_record_unavailable' });
  f.setMode(''); assert.equal((await f.reader.next(page)).statements[0].id, statements()[1].id);
  f.reader.close(); assert.equal(f.reader.status().closed, true); assert.equal(f.credentials.at(-1).accessToken, '');
  await assert.rejects(f.reader.query(), { code: 'account_record_closed' });
});
