import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createAgentOwnSession } from './agent-own-session.mjs';
import { createAgentGameplayPerformance } from './agent-gameplay-performance.mjs';
import { createOwnerPerformanceConsultation } from './performance-consultation.mjs';
import { FOXXI_PLANNER_ACTION, FOXXI_PLANNER_DESCRIPTOR } from './foxxi-consulting.mjs';
import { GAMEPLAY_LEARNING_WRITE_ACTION, GAMEPLAY_LEARNING_READ_ACTION } from './gameplay-learning-delivery.mjs';
import { createWorldAgentMcpHost } from '../world-agent-mcp.mjs';
import { WorldAgentClientError } from '../world-agent-client.mjs';
import { signingDelegationFixture } from './signing-delegation.fixture.mjs';

const id = 'u-eth-1234567890ab', owner = 'did:web:identity.example:users:' + id;
const agent = 'did:web:identity.example:agents:interego-delegate-' + id, podUrl = 'https://pod.example/' + id + '/';
const human = { subjectDid: 'did:web:identity.example:users:human', podUrl: 'https://pod.example/human/' };
const connection = { origin: 'https://game.example', applicationId: 'did:web:identity.example:users:game', agentDid: agent,
  grantId: 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41', roomId: 'march', entityId: 'human:companion:2fd428f0-d768-4ec7-9c52-f6c4e1cadce0' };
const consultingTarget = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan';
const writeTarget = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/write';
const readTarget = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/read';
const copy = value => structuredClone(value);
const rpc = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
let rpcId = 10;
const call = async (host, name, args = {}) => (await host.handle(rpc(++rpcId, 'tools/call', { name, arguments: args }))).result;
async function fixture(options = {}) {
  let time = Date.parse('2026-10-17T12:00:00Z'), currentOwner = owner, currentAgent = agent;
  let mode = '', pendingWrite = false, pendingJournal = false, pendingConsultation = false, pendingAck = false, signingGate = null, approvalGate = null, approval = options.approved ?? true;
  let refusedSave = null, discoveryGate = null, saveGate = null;
  const calls = [], records = options.records || new Map(), statements = options.statements || new Map(), previews = [];
  const transport = { async connect(required) { return { granted: required }; }, async callTool(name, args) {
    calls.push({ name, args: copy(args) });
    if (name === 'get_pod_status') { const signing = signingDelegationFixture({ ownerDid: owner, agentDid: agent, podUrl }); return { ...signing.status, identity: { ...signing.status.identity, did: currentOwner }, sessionAgent: { did: currentAgent } }; }
    if (name === 'verify_agent') return signingDelegationFixture({ ownerDid: owner, agentDid: agent, podUrl }).verified;
    if (name === 'dereference') {
      if (discoveryGate && args.iri !== FOXXI_PLANNER_DESCRIPTOR) { discoveryGate.enter(); await discoveryGate.wait; }
      return { status: 'ok', affordances: args.iri === FOXXI_PLANNER_DESCRIPTOR
        ? [{ action: FOXXI_PLANNER_ACTION, method: 'POST', target: consultingTarget }]
        : [{ action: GAMEPLAY_LEARNING_WRITE_ACTION, method: 'POST', target: writeTarget }, { action: GAMEPLAY_LEARNING_READ_ACTION, method: 'POST', target: readTarget }] };
    }
    if (name === 'sign_request') {
      if (signingGate && (args.payload.statements || args.payload.situation)) { signingGate.enter(); await signingGate.wait; }
      return { _signature: 'fixture-native-signature', _signed_payload: JSON.stringify({ ...args.payload, agent_id: currentAgent,
        subject_pod_url: podUrl, timestamp: new Date(time).toISOString() }) };
    }
    if (name === 'act') {
      const payload = JSON.parse(args.payload._signed_payload);
      if (args.action_iri === FOXXI_PLANNER_ACTION) {
        if (mode === 'coach-timeout') throw Error('Lost actual consulting reply');
        return { status: 200, body: { classifiedBy: agent, diagnosis: { situationId: payload.situation.id, method: 'classify-first' },
          plan: { situationId: payload.situation.id, selected: [{ title: 'Observe health before attacking' }], summary: 'Actual fixture advice: observe before choosing another input.' } } };
      }
      if (args.action_iri === GAMEPLAY_LEARNING_READ_ACTION) {
        const statement = statements.get(payload.query.statementId);
        return statement ? { status: 200, body: { ok: true, durable: true, subjectDid: owner, statement } } : { status: 404, body: { ok: false } };
      }
      assert.equal(args.action_iri, GAMEPLAY_LEARNING_WRITE_ACTION);
      for (const statement of payload.statements) statements.set(statement.id, { ...copy(statement), authority: { objectType: 'Agent', name: 'Fixture own-subject service' }, stored: new Date(time).toISOString(), version: '2.0.0' });
      if (mode === 'activity-timeout') throw Error('Lost receipt after storage');
      const ids = payload.statements.map(statement => statement.id);
      return { status: 200, body: { ok: true, durable: true, lrsAccepted: true, subjectDid: owner, statementIds: ids, receipts: ids.map(statementId => ({ statementId, persisted: true })) } };
    }
    throw Error('Unexpected tool ' + name);
  } };
  function client() {
    const operations = new Map(); let registered = false;
    const store = async ({ graphIri, record, checkpoint, expectedHead }) => {
      assert(registered, 'each native profile must verify the original key registration before saving');
      assert.equal(checkpoint, 'hallowmarch-performance-consultation/v1');
      if (refusedSave && record.schema === 'hallowmarch.agent-gameplay-performance/v1') { const code = refusedSave; refusedSave = null; throw Object.assign(Error('Known predispatch refusal'), { code }); }
      if (saveGate && record.schema === 'hallowmarch.agent-gameplay-performance/v1') { calls.push({ name: 'private-save-start', record: copy(record) }); saveGate.enter(); await saveGate.wait; }
      if (expectedHead) assert.deepEqual(expectedHead, records.get(graphIri)?.head);
      const revision = webcrypto.randomUUID();
      const found = { record: copy(record), graphIri, head: { cid: 'stable-binding', bindingCid: 'stable-binding', proofKind: 'owner-key-authenticated-checkpoint', descriptorUrl: podUrl + 'graphs/binding', nativeRevision: 'revision-' + revision, recordCid: 'record-' + revision } };
      records.set(graphIri, found); calls.push({ name: 'private-save', graphIri, record: copy(record) });
      if (pendingWrite || pendingJournal && record.schema !== 'hallowmarch.agent-gameplay-performance/v1' || pendingConsultation && record.consultations?.length
        || pendingAck && record.delivery?.acknowledgedCount > 0 && !record.delivery.pending) {
        pendingWrite = false; pendingJournal = false; pendingConsultation = false; pendingAck = false; operations.set('pending-original', { ...copy(found), saved: true });
        return { saved: false, operationId: 'pending-original' };
      }
      return { ...copy(found), saved: true };
    };
    return { async connect() { return { keyPresent: options.keyPresent !== false, ownerDid: owner, podUrl }; },
      async load({ graphIri }) { return copy(records.get(graphIri) || null); }, async currentHead({ graphIri }) { return copy(records.get(graphIri)?.head || null); },
      createAt: store, save: store, async registerKey() { registered = true; }, status: () => ({ pending: 0 }),
      async confirm(operationId) { return copy(operations.get(operationId) || { saved: true }); }, async reconcileCheckpoint() {}, close() {} };
  }
  const own = createAgentOwnSession({ walletAddress: '0x1234567890abcdef1234567890abcdef12345678', signMessage: async () => 'host-wallet-signature',
    nativeSignInWithWallet: async () => ({ kind: 'relay-oauth-bearer', method: 'siwe', accessToken: 'host-private-token', expiresAt: time + 3600000 }),
    humanBinding: human, relayUrl: 'https://relay.example', identityOrigin: 'https://identity.example', redirectUri: 'http://127.0.0.1/callback',
    createTransport: () => transport, now: () => time, crypto: webcrypto });
  await own.connect();
  const ports = [];
  const ownWithFixtureStorage = { ...own, createPodProfile: client,
    createJournal({ sessionId }) { const journal = createOwnerPerformanceConsultation({ binding: own.binding(), sessionId,
      relayUrl: 'https://relay.example', createClient: client, crypto: webcrypto, now: () => time }); ports.push(journal); return journal; } };
  const performance = createAgentGameplayPerformance({ ownSession: ownWithFixtureStorage, keyStorage: { load() {}, create() {} }, connection: { ...connection, ...options.connection },
    authorizeSession: async preview => { previews.push(preview); if (approvalGate) { approvalGate.enter(); await approvalGate.wait; } return approval; },
    crypto: webcrypto, now: () => time, timers: options.timers });
  let gameplayConnected = false, gameplayFailure = null, poseX = 1, pageSession = 'owner-page-a', gameGate = null;
  const observe = () => ({ roomId: connection.roomId, entityId: connection.entityId, authority: 'owner-page-observation',
    state: { ownerSession: pageSession, at: time, body: { id: connection.entityId, kind: 'companion', name: 'Companion', x: poseX, y: 0, z: 0, hp: 65, maxHp: 100 }, targets: [] } });
  const host = createWorldAgentMcpHost({ connection: { ...connection, ...options.connection, ...options.mcpConnection }, sign_request: own.signRequest, performance,
    createClient: () => ({ async connect() { gameplayConnected = true; return { connected: true }; }, status: () => ({ connected: gameplayConnected }), close() { gameplayConnected = false; },
      async observe() { return observe(); }, async move() { calls.push({ name: 'gameplay-move' }); if (gameGate) { gameGate.enter(); await gameGate.wait; } if (gameplayFailure) throw gameplayFailure; return { accepted: true, execution: 'owner-page-input-applied', requestId: 'actual-request' }; },
      async attack() { return { accepted: true, execution: 'owner-page-input-applied', requestId: 'actual-attack' }; } }) });
  await host.handle(rpc(1, 'initialize', { protocolVersion: '2025-06-18' })); await host.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  const start = async () => { await call(host, 'march_connect'); const result = await call(host, 'march_performance_start'); assert(!result.isError, JSON.stringify(result)); return result; };
  return { own, performance, host, start, calls, records, statements, previews, ports, observe, advance(ms) { time += ms; poseX += 2; },
    mode(value) { mode = value; }, failGame() { gameplayFailure = new WorldAgentClientError('agent_operation_unconfirmed', { uncertain: true }); },
    changeOwner() { currentOwner = human.subjectDid; }, changePage() { pageSession = 'owner-page-b'; }, pendingSave() { pendingWrite = true; }, pendingJournal() { pendingJournal = true; }, pendingConsultation() { pendingConsultation = true; }, pendingAck() { pendingAck = true; },
    signingGate(value) { signingGate = value; }, saveGate(value) { saveGate = value; }, discoveryGate(value) { discoveryGate = value; }, approvalGate(value) { approvalGate = value; }, gameGate(value) { gameGate = value; }, refuseSave(value) { refusedSave = value; }, approve(value) { approval = value; } };
}
function gate() { let enter, release; return { entered: new Promise(resolve => { enter = resolve; }), wait: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() }; }

test('configured MCP path uses real native own identity, real consent journal, activity delivery and consultant; actual advice reaches model', async () => {
  const f = await fixture(); const list = await f.host.handle(rpc(2, 'tools/list')); assert.equal(list.result.tools.length, 12);
  assert.equal((await call(f.host, 'march_performance_start')).isError, true);
  await f.start();
  assert.equal(f.previews[0].performerDid, owner); assert.equal(f.previews[0].agentDid, agent); assert.equal(f.previews[0].grantId, connection.grantId);
  assert.equal(f.previews[0].lifetimeMs, 900000); assert.equal(f.previews[0].activityRecipient, writeTarget);
  await call(f.host, 'march_observe');
  const moved = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  assert.equal(moved.structuredContent.result.execution, 'owner-page-input-applied'); assert.equal(moved.structuredContent.result.performance.acceptedInputs, 1);
  await call(f.host, 'march_performance_status');
  const statement = [...f.statements.values()][0]; assert.equal(statement.actor.account.name, owner);
  assert.equal(statement.verb.id, 'urn:interego:gaming:activity:verb:agent.command-accepted'); assert.equal(statement.result.completion, undefined);
  assert.equal(statement.context.extensions['urn:interego:gaming:activity:context'].controllerId, agent);
  const coached = await call(f.host, 'march_coach'); assert(!coached.isError, JSON.stringify(coached));
  assert.match(coached.structuredContent.result.advice.response.plan.summary, /^Actual fixture advice/);
  const request = f.calls.filter(c => c.name === 'act' && c.args.action_iri === FOXXI_PLANNER_ACTION).at(-1);
  const sent = JSON.parse(request.args.payload._signed_payload); assert.deepEqual(sent.situation.performer, { id: owner, kind: 'agent' });
  const history = await f.ports.at(-1).read(); assert.equal(history.observations.length, 1); assert.equal(history.observations[0].performerKind, 'agent'); assert.equal(history.consultations.length, 1);
  assert(!JSON.stringify(sent).includes(human.subjectDid)); assert(!JSON.stringify(coached).includes('host-private-token'));
  assert([...f.records.values()].every(value => value.record.ownerDid === owner));
  f.host.close();
});

test('host decline, wrong pinned signer, missing native key, model scope expansion and identity change cannot write/send', async () => {
  const declined = await fixture({ approved: false }); await call(declined.host, 'march_connect');
  assert.equal((await call(declined.host, 'march_performance_start')).isError, true); assert(!declined.calls.some(c => c.name === 'private-save'));
  const wrong = await fixture({ connection: { agentDid: 'did:web:identity.example:agents:other' } }); await call(wrong.host, 'march_connect');
  assert.equal((await call(wrong.host, 'march_performance_start')).isError, true); assert.equal(wrong.previews.length, 0);
  const noKey = await fixture({ keyPresent: false }); await call(noKey.host, 'march_connect'); assert.equal((await call(noKey.host, 'march_performance_start')).isError, true);
  assert.equal(noKey.previews.length, 0);
  const f = await fixture(); await f.start(); const count = f.calls.length;
  assert.equal((await call(f.host, 'march_performance_start', { lifetimeMs: 3600000, actor: human.subjectDid })).isError, true); assert.equal(f.calls.length, count);
  f.changeOwner(); await call(f.host, 'march_observe'); await call(f.host, 'march_performance_status'); assert.equal(f.performance.status().code, 'agent_owner_mismatch');
  assert(!f.calls.some(c => c.name === 'act'));
  await assert.rejects(fixture({ mcpConnection: { roomId: 'another-room' } }), /performance_scope_mismatch/);
});

test('lost activity ACK retains exact durable IDs, does not resend on later gameplay or restart, and reads exact IDs to reconcile', async () => {
  const f = await fixture(); await f.start(); f.mode('activity-timeout');
  const moved = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert(!moved.isError);
  await call(f.host, 'march_performance_status'); assert.equal(f.performance.status().activityPending, true);
  const writes = () => f.calls.filter(c => c.name === 'act' && c.args.action_iri === GAMEPLAY_LEARNING_WRITE_ACTION);
  const ids = [...f.statements.keys()]; assert.equal(ids.length, 1);
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert.equal(writes().length, 1);
  await call(f.host, 'march_performance_stop'); f.mode(''); await f.start(); assert.equal(writes().length, 1);
  const reconciled = await call(f.host, 'march_performance_reconcile', { operation: 'activity-read' }); assert(!reconciled.isError, JSON.stringify(reconciled));
  assert.equal(f.performance.status().activityPending, false); assert.equal(writes().length, 1); assert.deepEqual([...f.statements.keys()], ids);
});

test('consultation uncertainty has durable fence across restart; explicit close never replays plan', async () => {
  const f = await fixture(); await f.start(); await call(f.host, 'march_observe'); f.mode('coach-timeout');
  assert.equal((await call(f.host, 'march_coach')).isError, true); assert(f.performance.status().consultationPending);
  const plans = () => f.calls.filter(c => c.name === 'act' && c.args.action_iri === FOXXI_PLANNER_ACTION).length;
  assert.equal(plans(), 1); await call(f.host, 'march_coach'); assert.equal(plans(), 1);
  await call(f.host, 'march_performance_stop'); await f.start(); await call(f.host, 'march_coach'); assert.equal(plans(), 1);
  const closed = await call(f.host, 'march_performance_reconcile', { operation: 'consultation-close' }); assert(!closed.isError, JSON.stringify(closed));
  assert.equal(f.performance.status().consultationPending, false); assert.equal(plans(), 1);
});

test('uncertain gameplay replies never become accepted activity and capture failure never retries applied world input', async () => {
  const f = await fixture(); await f.start(); f.failGame();
  const failed = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert.equal(failed.isError, true);
  assert.equal(f.performance.status().unknownCommands, 1); assert.equal(f.statements.size, 0); assert.equal(f.calls.filter(c => c.name === 'gameplay-move').length, 1);
  const g = await fixture(); await g.start(); g.pendingSave();
  const moved = await call(g.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert(!moved.isError);
  await call(g.host, 'march_performance_status'); assert(g.performance.status().savePending); assert.equal(g.statements.size, 0);
  await call(g.host, 'march_performance_reconcile', { operation: 'private-save' });
  assert.equal(g.performance.status().savePending, false); assert.equal(g.calls.filter(c => c.name === 'gameplay-move').length, 1);
});

test('fresh pose sampling keeps page baselines and hundreds of accepted commands continue without native I/O per ACK', async () => {
  const f = await fixture(); await f.start(); await call(f.host, 'march_observe'); await call(f.host, 'march_observe');
  assert.equal(f.performance.status().observations, 1); f.advance(5000); await call(f.host, 'march_observe'); assert.equal(f.performance.status().observations, 2);
  await call(f.host, 'march_performance_status');
  let record = [...f.records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1').record;
  assert.equal(record.lastObservation.observedDistance, 2); f.changePage(); f.advance(30000); await call(f.host, 'march_observe'); await call(f.host, 'march_performance_status');
  record = [...f.records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1').record; assert.equal(record.lastObservation.observedDistance, undefined);
  const nativeBefore = f.calls.length;
  for (let i = 0; i < 1500; i++) await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  assert.equal(f.statements.size, 0); assert.equal(f.performance.status().acceptedInputs, 1500); assert.equal(f.calls.length, nativeBefore + 1500);
  await call(f.host, 'march_performance_status');
  assert.equal([...f.statements.values()][0].result.extensions['urn:interego:gaming:activity:observation'].quantity, 1500);
  assert.equal(f.performance.status().cumulativeAcceptedInputs, 1500); assert.equal(f.performance.status().durableAcceptedInputs, 1500);
  f.advance(900001); const before = f.calls.length; await call(f.host, 'march_observe'); assert.equal(f.calls.length, before); assert.equal(f.performance.status().enabled, false);
});

test('Stop fences in-flight native signature before any activity act and disconnect stops capture', async () => {
  const f = await fixture(); await f.start(); let enter, release;
  const entered = new Promise(resolve => { enter = resolve; }), wait = new Promise(resolve => { release = resolve; });
  f.signingGate({ enter, wait });
  const result = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  const flushing = call(f.host, 'march_performance_status'); await entered;
  const stopping = call(f.host, 'march_performance_stop'); release(); await stopping; await flushing;
  assert(!result.isError); assert.equal(result.structuredContent.result.execution, 'owner-page-input-applied');
  assert.equal(f.calls.some(c => c.name === 'act'), false); assert.equal(f.performance.status().enabled, false); assert(f.performance.status().activityPending);
  const g = await fixture(); await g.start(); await call(g.host, 'march_disconnect'); assert.equal(g.performance.status().enabled, false);
});

test('a possibly committed consent is tracked before acknowledgement and Stop confirms original mutation before withdrawal', async () => {
  const f = await fixture(); await call(f.host, 'march_connect'); f.pendingJournal();
  const started = await call(f.host, 'march_performance_start'); assert.equal(started.isError, true);
  assert.equal(f.performance.status().journalPending, true); assert.equal(f.performance.status().consentUnconfirmed, true);
  const stopped = await call(f.host, 'march_performance_stop'); assert(!stopped.isError);
  assert.equal(f.performance.status().consentUnconfirmed, false); assert.equal(f.performance.status().journalPending, false);
  assert(!f.calls.some(c => c.name === 'act'));
  const consent = [...f.records.values()].find(value => value.record.consents)?.record.consents[0]; assert.equal(consent.revoked, true);
});

test('an unconfirmed journal observation can be explicitly confirmed without a consulting request; fresh observation required after idle', async () => {
  const f = await fixture(); await f.start(); await call(f.host, 'march_observe'); f.pendingJournal();
  const coach = await call(f.host, 'march_coach'); assert(coach.isError); assert(f.performance.status().journalPending);
  assert(!f.calls.some(c => c.name === 'act'));
  const confirmed = await call(f.host, 'march_performance_reconcile', { operation: 'private-save' }); assert(!confirmed.isError, JSON.stringify(confirmed));
  assert.equal(f.performance.status().journalPending, false); assert(!f.calls.some(c => c.name === 'act'));
  f.advance(11000); assert((await call(f.host, 'march_coach')).isError); assert(!f.calls.some(c => c.name === 'act'));
});

test('a new tool process discovers original pending statement IDs in the same bounded graph and performs read-only reconciliation', async () => {
  const first = await fixture(); await first.start(); first.mode('activity-timeout');
  await call(first.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await call(first.host, 'march_performance_status'); await first.performance.stop();
  const ids = [...first.statements.keys()];
  const next = await fixture({ records: first.records, statements: first.statements }); await next.start();
  assert(next.performance.status().activityPending);
  assert.equal(next.calls.filter(c => c.name === 'act').length, 0);
  const reconciled = await call(next.host, 'march_performance_reconcile', { operation: 'activity-read' }); assert(!reconciled.isError, JSON.stringify(reconciled));
  assert.equal(next.performance.status().acknowledgedActivities, 1);
  assert(next.calls.filter(c => c.name === 'act').every(c => c.args.action_iri === GAMEPLAY_LEARNING_READ_ACTION));
  assert.deepEqual([...next.statements.keys()], ids);
  assert.equal([...next.records.values()].filter(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1').length, 1);
});

test('known actual advice remains recoverable after journal ACK loss, including explicit close after baseline expires', async () => {
  const f = await fixture(); await f.start(); await call(f.host, 'march_observe'); f.pendingConsultation();
  const actual = await call(f.host, 'march_coach'); assert(!actual.isError); assert.equal(actual.structuredContent.result.retainedInJournal, false);
  assert(f.performance.status().consultationPending); assert(f.performance.status().journalPending);
  const plans = () => f.calls.filter(c => c.name === 'act' && c.args.action_iri === FOXXI_PLANNER_ACTION).length;
  assert.equal(plans(), 1);
  await call(f.host, 'march_performance_reconcile', { operation: 'private-save' });
  f.advance(3600001); await f.performance.stop(); await f.start();
  const recovered = await call(f.host, 'march_performance_reconcile', { operation: 'consultation-close' }); assert(!recovered.isError, JSON.stringify(recovered));
  assert.match(recovered.structuredContent.result.advice.response.plan.summary, /^Actual fixture advice/);
  assert.equal(recovered.structuredContent.result.retainedInJournal, false); assert.equal(plans(), 1);
  assert.equal(f.performance.status().consultationPending, false);
});

test('queued Start cannot revive a session after Stop, and capture queued during host approval never becomes eligible later', async () => {
  const f = await fixture(); await f.start(); const held = gate(); f.signingGate(held);
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); const moving = call(f.host, 'march_performance_status'); await held.entered;
  const queuedStart = call(f.host, 'march_performance_start'); const stopped = f.performance.stop(); held.release();
  await stopped; await moving; assert((await queuedStart).isError); assert.equal(f.performance.status().enabled, false); assert.equal(f.previews.length, 1);
  const g = await fixture(); await call(g.host, 'march_connect'); const policy = gate(); g.approvalGate(policy);
  const starting = call(g.host, 'march_performance_start'); await policy.entered;
  const earlier = await call(g.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert(!earlier.isError);
  policy.release(); assert(!(await starting).isError); assert.equal(g.statements.size, 0); assert.equal(g.performance.status().acceptedInputs, 0);
});

test('performance-issued invocation tickets exclude delayed world ACKs from before consent or from an earlier stopped session', async () => {
  const f = await fixture(); await call(f.host, 'march_connect'); const held = gate(); f.gameGate(held);
  const earlier = call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await held.entered;
  await call(f.host, 'march_performance_start'); held.release(); assert(!(await earlier).isError);
  assert.equal(f.statements.size, 0); assert.equal(f.performance.status().acceptedInputs, 0);
  const g = await fixture(); await g.start(); const old = gate(); g.gameGate(old);
  const previous = call(g.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await old.entered;
  await g.performance.stop(); assert(!(await call(g.host, 'march_performance_start')).isError); old.release(); await previous;
  assert.equal(g.statements.size, 0); assert.equal(g.performance.status().acceptedInputs, 0);
});

test('known predispatch budget refusal clears an uncommitted draft and explicit head refresh recovers without replay', async () => {
  const f = await fixture(); await f.start(); f.refuseSave('checkpoint_write_budget');
  const moved = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert(!moved.isError);
  await call(f.host, 'march_performance_status');
  assert.equal(f.performance.status().savePending, false); assert.equal(f.performance.status().saveRefreshRequired, true);
  assert.equal(f.statements.size, 0);
  const repaired = await call(f.host, 'march_performance_reconcile', { operation: 'private-save' }); assert(!repaired.isError, JSON.stringify(repaired));
  assert.equal(f.performance.status().saveRefreshRequired, false); assert.equal(f.statements.size, 0);
  assert.equal(f.calls.filter(c => c.name === 'gameplay-move').length, 1);
  await f.performance.stop(); await f.start();
});

test('read-only service discovery never opens capture before exact host authorization and all consent/private-save acknowledgments', async () => {
  const f = await fixture(); await call(f.host, 'march_connect'); const held = gate(); f.discoveryGate(held);
  const starting = call(f.host, 'march_performance_start'); await held.entered;
  assert.equal(f.previews.length, 0); assert.equal(f.performance.status().enabled, false);
  const earlier = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); assert(!earlier.isError);
  held.release(); assert(!(await starting).isError); assert.equal(f.statements.size, 0); assert.equal(f.performance.status().acceptedInputs, 0);
});

test('blocked native CAS never delays world ACKs and immutable batch snapshots do not overwrite later captured totals', { timeout: 5000 }, async () => {
  const f = await fixture(); await f.start(); const held = gate(); f.saveGate(held);
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  const flushing = call(f.host, 'march_performance_status'); await held.entered;
  const original = copy(f.calls.find(c => c.name === 'private-save-start').record);
  for (let i = 0; i < 1000; i++) assert(!(await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 })).isError);
  assert.equal(f.performance.status().acceptedInputs, 1001); assert.equal(f.performance.status().cumulativeAcceptedInputs, 1001);
  assert.equal(f.performance.status().durableAcceptedInputs, 0); assert(f.performance.status().savePending);
  assert.deepEqual(f.calls.find(c => c.name === 'private-save-start').record, original);
  assert.equal(original.delivery.pending.events[0].result.quantity, 1);
  held.release(); f.saveGate(null); assert(!(await flushing).isError);
  assert.equal(f.performance.status().durableAcceptedInputs, 1001);
  await call(f.host, 'march_performance_status');
  assert.equal([...f.statements.values()].reduce((sum, statement) => sum + statement.result.extensions['urn:interego:gaming:activity:observation'].quantity, 0), 1001);
});

test('lost batch receipt never freezes cumulative capture and no second write occurs before exact read reconciliation', async () => {
  const f = await fixture(); await f.start(); f.mode('activity-timeout');
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await call(f.host, 'march_performance_status');
  const originalIds = [...f.statements.keys()], writes = () => f.calls.filter(c => c.name === 'act' && c.args.action_iri === GAMEPLAY_LEARNING_WRITE_ACTION).length;
  for (let i = 0; i < 500; i++) await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  await call(f.host, 'march_performance_status');
  assert.equal(writes(), 1); assert.equal(f.performance.status().cumulativeAcceptedInputs, 501); assert.equal(f.performance.status().durableAcceptedInputs, 501);
  assert.deepEqual([...f.statements.keys()], originalIds); assert(f.performance.status().activityPending);
  f.mode(''); await call(f.host, 'march_performance_reconcile', { operation: 'activity-read' });
  assert.equal(writes(), 1); await call(f.host, 'march_performance_status'); assert.equal(writes(), 2);
  assert.equal([...f.statements.values()].reduce((sum, statement) => sum + statement.result.extensions['urn:interego:gaming:activity:observation'].quantity, 0), 501);
});

test('bounded detail overflow pauses export with an explicit gap while local and durable totals continue; explicit close resumes future detail', async () => {
  const f = await fixture(); await f.start();
  for (let i = 0; i < 70; i++) { await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); f.advance(5000); }
  assert.equal(f.performance.status().cumulativeAcceptedInputs, 70); assert.equal(f.performance.status().bufferedDetails, 64);
  assert.equal(f.performance.status().exportPaused, true); assert.equal(f.performance.status().exportGapInputs, 6);
  await call(f.host, 'march_performance_status'); assert.equal(f.statements.size, 0); assert.equal(f.performance.status().durableAcceptedInputs, 70);
  await call(f.host, 'march_performance_reconcile', { operation: 'activity-close' });
  assert.equal(f.performance.status().bufferedDetails, 0); assert.equal(f.performance.status().exportPaused, false); assert.equal(f.performance.status().exportGapInputs, 70);
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await call(f.host, 'march_performance_status');
  assert.equal(f.performance.status().cumulativeAcceptedInputs, 71); assert.equal(f.performance.status().durableAcceptedInputs, 71); assert.equal(f.statements.size, 1);
});

test('each 30-second window sends at most three twenty-summary batches and later flush preserves original timestamps', async () => {
  const f = await fixture(); await f.start();
  for (let i = 0; i < 61; i++) { await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); f.advance(5000); }
  await call(f.host, 'march_performance_status');
  const writes = () => f.calls.filter(c => c.name === 'act' && c.args.action_iri === GAMEPLAY_LEARNING_WRITE_ACTION).length;
  assert.equal(writes(), 3); assert.equal(f.statements.size, 60); await call(f.host, 'march_performance_status'); assert.equal(writes(), 3);
  const lastTime = [...f.records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1').record.queuedEvents[0].observedAt;
  f.advance(30000); await call(f.host, 'march_performance_status'); assert.equal(writes(), 4); assert.equal(f.statements.size, 61);
  assert.equal([...f.statements.values()].at(-1).timestamp, lastTime);
});

test('one controlled unref timer flushes bounded work and Stop cancels/fences its queued continuation', async () => {
  const callbacks = new Map(); let next = 0, unrefs = 0;
  const timers = { setTimeout(callback) { const handle = { id: ++next, unref() { unrefs++; } }; callbacks.set(handle.id, callback); return handle; }, clearTimeout(handle) { callbacks.delete(handle.id); } };
  const f = await fixture({ timers }); await f.start(); assert.equal(callbacks.size, 1); assert.equal(unrefs, 1);
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); const stale = [...callbacks.values()][0]; callbacks.clear(); stale();
  await f.performance.flush(); assert.equal(f.statements.size, 1);
  const held = gate(); f.signingGate(held); f.advance(30000); await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  const flushing = f.performance.flush(); await held.entered; const stopping = f.performance.stop(); held.release(); await stopping;
  await assert.rejects(flushing); const before = f.calls.filter(c => c.name === 'act').length; stale(); await Promise.resolve();
  assert.equal(callbacks.size, 0); assert.equal(f.calls.filter(c => c.name === 'act').length, before);
});

test('peer native head changes are never overwritten by an old process live snapshot', async () => {
  const first = await fixture(); await first.start(); await call(first.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await first.performance.flush(); await first.performance.stop();
  const peer = await fixture({ records: first.records, statements: first.statements }); await peer.start();
  for (let i = 0; i < 20; i++) await call(peer.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await peer.performance.flush();
  const before = copy([...first.records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1'));
  const stale = await call(first.host, 'march_performance_start'); assert(stale.isError); assert.equal(first.performance.status().code, 'agent_performance_conflict_review');
  assert.deepEqual([...first.records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1'), before);
  assert.equal(peer.performance.status().durableAcceptedInputs, 21);
});

test('a delayed private flush cannot turn an old pose into fresh coaching evidence', async () => {
  const f = await fixture(); await f.start(); await call(f.host, 'march_observe'); const held = gate(); f.saveGate(held);
  const coaching = call(f.host, 'march_coach'); await held.entered; f.advance(11000); held.release(); f.saveGate(null);
  assert((await coaching).isError); assert.equal(f.calls.some(c => c.name === 'act' && c.args.action_iri === FOXXI_PLANNER_ACTION), false);
});

test('failed policy decisions never double-count discarded prior-session detail gaps', async () => {
  const first = await fixture(); await first.start(); first.mode('activity-timeout');
  await call(first.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await call(first.host, 'march_performance_status');
  for (let i = 0; i < 10; i++) await call(first.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await first.performance.flush(); await first.performance.stop();
  const next = await fixture({ records: first.records, statements: first.statements, approved: false }); await call(next.host, 'march_connect');
  assert((await call(next.host, 'march_performance_start')).isError); const gaps = next.performance.status().exportGapInputs;
  assert.equal(gaps, 10); assert((await call(next.host, 'march_performance_start')).isError); assert.equal(next.performance.status().exportGapInputs, gaps);
});

test('confirming a possibly committed private ACK preserves known delivery receipts and the later live input tail', async () => {
  const f = await fixture(); await f.start(); f.pendingAck();
  await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 }); await call(f.host, 'march_performance_status');
  assert(f.performance.status().savePending); assert(f.performance.status().activityPending);
  for (let i = 0; i < 10; i++) await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  const repaired = await call(f.host, 'march_performance_reconcile', { operation: 'private-save' }); assert(!repaired.isError, JSON.stringify(repaired));
  assert.equal(f.performance.status().acknowledgedActivities, 1); assert.equal(f.performance.status().activityPending, false); assert.equal(f.performance.status().cumulativeAcceptedInputs, 11);
  await call(f.host, 'march_performance_status'); assert.equal(f.performance.status().acknowledgedActivities, 2);
  await call(f.host, 'march_performance_reconcile', { operation: 'activity-close' });
  assert.equal(f.performance.status().acknowledgedActivities, 2); assert.equal(f.performance.status().closedUnconfirmedActivities, 0); assert.equal(f.performance.status().exportGapInputs, 0);
});

test('malformed cumulative counts or oversized/invalid persisted detail buffers fail before host consent or writes', async () => {
  const first = await fixture(); await first.start(); await first.performance.stop();
  const cases = [
    value => { value.acceptedCounts.move = -1; }, value => { value.captureRevision = NaN; }, value => { value.exportGapInputs = 0.5; },
    value => { value.queuedEvents = null; }, value => { value.queuedAggregates = Array.from({ length: 65 }, () => ({ action: 'move', firstAt: 0, lastAt: 0, count: 1 })); },
    value => { value.queuedAggregates = [{ action: 'attack', firstAt: 10, lastAt: 5, count: 1 }]; },
  ];
  for (const mutate of cases) {
    const records = copy(first.records); const saved = [...records.values()].find(value => value.record.schema === 'hallowmarch.agent-gameplay-performance/v1'); mutate(saved.record);
    const next = await fixture({ records }); await call(next.host, 'march_connect'); assert((await call(next.host, 'march_performance_start')).isError);
    assert.equal(next.previews.length, 0); assert(!next.calls.some(c => c.name === 'private-save'));
  }
});
