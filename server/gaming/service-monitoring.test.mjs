import test from 'node:test';
import assert from 'node:assert/strict';
import { createServiceMonitoring, sanitizeServiceMetrics, discoverFoxxiMonitoringDescriptor, configuredServiceMonitoring } from './service-monitoring.js';
import { FOXXI_XAPI_ACTION_PUBLISHED } from './learning.js';

// Contract fixture only, never evidence of physical native durability.
class FixtureStore {
  value = { version: 0, state: null }; fail = false;
  async load() { return structuredClone(this.value); }
  async commit(stream, request) { if (this.fail) throw new Error('native outage'); if (request.expectedVersion !== this.value.version) throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' }); this.value = { version: this.value.version + 1, state: structuredClone(request.state) }; return this.load(); }
}
const serviceDid = 'did:ethr:0x1111111111111111111111111111111111111111';
const descriptor = { action: FOXXI_XAPI_ACTION_PUBLISHED, method: 'POST', target: 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/write' };
const metrics = { commands: 5, refused: 1, commits: 4, conflicts: 0, maxCommandMs: 24.1, lastCommitMs: 12, version: 4, playerConnections: 2, eventWindow: 4,
  acct: 'private-human', performance: { actors: { 'private-human': {} }, byKind: { 'movement.applied': 2, damage: 1, 'alice-secret-event': 1 } } };
const receipt = statements => ({ status: 200, body: { ok: true, durable: true, lrsAccepted: true, statementIds: statements.map(s => s.id), receipts: statements.map(s => ({ statementId: s.id, persisted: true })) } });
function factory(options = {}) { let calls = []; const store = options.store || new FixtureStore(); const monitor = createServiceMonitoring({ store, serviceDid, descriptor, now: () => 100000, runId: 'run1', signRequest: async ({ statements }) => ({ _signed_payload: JSON.stringify({ agent_id: serviceDid, statements }), _signature: 'fixture-signature' }), transport: async ({ body }) => { const statements = JSON.parse(body._signed_payload).statements; calls.push(statements); return receipt(statements); }, ...options }); return { store, monitor, calls }; }

test('service sample drops identities and labels counters and overlapping event windows', () => {
  const safe = sanitizeServiceMetrics(metrics), serialized = JSON.stringify(safe);
  assert(!serialized.includes('private-human')); assert(!serialized.includes('alice-secret')); assert.equal(safe.snapshot.playerConnections, 2);
  assert.equal(safe.recentEventWindow.semantics, 'bounded-overlapping-committed-events'); assert.equal(safe.recentEventWindow.byKind.damage, 1);
  assert.throws(() => sanitizeServiceMetrics({ lastCommitMs: Infinity })); assert.throws(() => sanitizeServiceMetrics({ playerConnections: 1.1 }));
});

test('live service measurements distinguish authoritative activity from durable checkpoints', async () => {
  const measured = { ...metrics, persistence: { liveSequence: 9, durableSequence: 6, durableVersion: 3, pendingCommands: 3, oldestPendingMs: 1250,
    error: 'private transport detail', ownerId: 'private-owner' } };
  const safe = sanitizeServiceMetrics(measured);
  assert.equal(safe.snapshot.liveSequence, 9); assert.equal(safe.snapshot.durableSequence, 6);
  assert.equal(safe.timings.oldestPendingMs, 1250);
  assert.equal(safe.recentEventWindow.semantics, 'bounded-overlapping-authoritative-live-events');
  assert(!JSON.stringify(safe).includes('private-'));
  const first = factory(); await first.monitor.ready; await first.monitor.record(measured, { sampleId: 'realtime' });
  const restart = factory({ store: first.store }); await restart.monitor.ready;
  assert.equal((await restart.monitor.flush()).exported, 1);
});

test('a new sample does not hide an unconfirmed Foxxi delivery diagnostic', async () => {
  const { monitor } = factory({ transport: async () => ({ status: 500, body: { error: 'private server details' } }) });
  await monitor.ready; await monitor.record(metrics, { sampleId: 'one' }); await monitor.flush();
  await monitor.record(metrics, { sampleId: 'two' });
  const status = monitor.status(); assert.equal(status.state, 'delivery-unconfirmed');
  assert.equal(status.lastHttpStatus, 500); assert.equal(status.lastDeliveryReason, 'foxxi-durable-ack-required');
  assert(!JSON.stringify(status).includes('private server details')); assert.equal(status.pending, 2);
});

test('sample is native-queued before export and records only own service operational evidence', async () => {
  const { monitor, store, calls } = factory(); await monitor.ready;
  const staged = await monitor.record(metrics, { sampleId: 's1' }); assert.equal(staged.durable, true); assert.equal(calls.length, 0); assert.equal(store.value.state.pending.length, 1);
  const sent = await monitor.flush(); assert.equal(sent.exported, 1); assert.equal(store.value.state.pending.length, 0); assert.equal(store.value.state.receipts.length, 1);
  const statement = calls[0][0]; assert.equal(statement.actor.account.name, serviceDid); assert.equal(statement.context.extensions['urn:interego:gaming:competencyStatus'], 'not-assessed'); assert.equal(statement.context.extensions['urn:interego:gaming:humanRecordsExported'], false);
  assert(!JSON.stringify(statement).includes('private-human')); assert.equal(monitor.status().pending, 0);
});

test('native failure prevents all outbound data, never falls back to memory', async () => {
  const { monitor, store, calls } = factory(); await monitor.ready; store.fail = true;
  await assert.rejects(monitor.record(metrics, { sampleId: 's1' })); assert.equal(calls.length, 0); assert.equal(store.value.state, null);
});

test('delivery ambiguity survives adapter recreation with identical event id and content', async () => {
  const store = new FixtureStore(); const original = factory({ store, transport: async () => { throw new Error('timeout'); } }); await original.monitor.ready;
  const staged = await original.monitor.record(metrics, { sampleId: 's1' }); assert.equal((await original.monitor.flush()).ok, false);
  const restart = factory({ store, runId: 'run2' }); await restart.monitor.ready;
  assert.equal((await restart.monitor.flush()).exported, 1); assert.equal(restart.calls[0][0].id, staged.statementId); assert.equal(restart.calls[0][0].context.extensions['urn:interego:gaming:processRunId'], 'run1');
});

test('partial Foxxi acknowledgement retains exact batch and native acknowledgement failure retries safely', async () => {
  const partial = factory({ transport: async ({ body }) => { const statements = JSON.parse(body._signed_payload).statements; const reply = receipt(statements); reply.body.receipts[0].persisted = false; return reply; } }); await partial.monitor.ready;
  await partial.monitor.record(metrics, { sampleId: 's1' }); assert.equal((await partial.monitor.flush()).reason, 'foxxi-durable-ack-required'); assert.equal(partial.store.value.state.pending.length, 1);
  const store = new FixtureStore(); const ambiguous = factory({ store, transport: async ({ body }) => { store.fail = true; return receipt(JSON.parse(body._signed_payload).statements); } }); await ambiguous.monitor.ready;
  await ambiguous.monitor.record(metrics, { sampleId: 's2' }); await assert.rejects(ambiguous.monitor.flush()); assert.equal(store.value.state.pending.length, 1);
  store.fail = false; const restart = factory({ store }); await restart.monitor.ready; assert.equal((await restart.monitor.flush()).exported, 1);
});

test('signed subject and content are verified before any outbound call', async () => {
  const { monitor, calls } = factory({ signRequest: async ({ statements }) => ({ _signature: 'fixture', _signed_payload: JSON.stringify({ agent_id: 'did:example:human', statements }) }) }); await monitor.ready;
  await monitor.record(metrics, { sampleId: 's1' }); await assert.rejects(monitor.flush(), /identity/); assert.equal(calls.length, 0);
});

test('outbox capacity and sample identity conflicts fail explicitly and retain staged observations', async () => {
  const { monitor, store } = factory({ maxPending: 1 }); await monitor.ready;
  await monitor.record(metrics, { sampleId: 's1' }); await monitor.record(metrics, { sampleId: 's1' }); assert.equal(store.value.state.pending.length, 1);
  await assert.rejects(monitor.record({ ...metrics, version: 6 }, { sampleId: 's1' }), /identity conflict/);
  await assert.rejects(monitor.record(metrics, { sampleId: 's2' }), { code: 'MONITORING_CAPACITY' });
});

test('live capability extraction rejects action lookalikes and external credential targets', async () => {
  const ttl = `<${descriptor.action}> a iep:Affordance ;\n hydra:method "POST" ;\n hydra:target <${descriptor.target}> .\n\n<urn:next> a iep:Affordance .`;
  const discovered = await discoverFoxxiMonitoringDescriptor(async () => new Response(ttl)); assert.equal(discovered.target, descriptor.target);
  await assert.rejects(discoverFoxxiMonitoringDescriptor(async () => new Response(ttl.replace(descriptor.action, descriptor.action + '-fake'))));
  await assert.rejects(discoverFoxxiMonitoringDescriptor(async () => new Response(ttl.replace(descriptor.target, 'https://evil.example/collect'))));
  assert.equal(await configuredServiceMonitoring({ env: {} }), null);
});

test('unexpected persisted fields and another subject are refused before signing', async () => {
  const original = factory(); await original.monitor.ready; await original.monitor.record(metrics, { sampleId: 's1' });
  original.store.value.state.pending[0].statement.context.extensions['urn:private:human'] = 'never-export';
  const restart = factory({ store: original.store }); await assert.rejects(restart.monitor.ready, /persisted monitoring/); assert.equal(restart.calls.length, 0);
});
