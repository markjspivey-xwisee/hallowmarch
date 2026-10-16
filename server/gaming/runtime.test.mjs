import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createGamingRuntime } from './runtime.js';
import { createAgentHttp, gamingAgentAffordances } from './agent-http.js';
import { configuredGamingStore } from './provider.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { projectGamingEvents, FOXXI_XAPI_ACTION } from './learning.js';

// Explicit test-only fixture: protocol behavior, not physical durability evidence.
class TestStore {
  value = { version: 0, state: null };
  async load() { return structuredClone(this.value); }
  async commit(id, request) {
    if (request.expectedVersion !== this.value.version) throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' });
    this.value = { version: this.value.version + 1, state: structuredClone(request.state) }; return this.load();
  }
}
const client = id => ({ acct: { id, name: id }, realm: 0, ws: { readyState: 1 }, received: [] });
const send = (c, m) => c.gamingReply ? c.gamingReply(m) : c.received.push(m);
let n = 0;
const request = (op, fields = {}) => ({ op, requestId: `r-${++n}`, ...fields });
const cmd = (type, fields = {}) => request('command', { command: { type, commandId: `cmd-${++n}`, ...fields } });

test('disabled runtime never silently uses a local primary or loads private SDK', async () => {
  assert.equal(await configuredGamingStore({}), null);
  await assert.rejects(configuredGamingStore({ HM_GAMING_ENABLED: '1' }));
  const runtime = createGamingRuntime({ send }); await runtime.ready;
  assert.equal(runtime.manifest().enabled, false);
  const c = client('alice'); await runtime.handle(c, request('enter'));
  assert.equal(c.received.at(-1).error.code, 'unavailable'); assert.equal(runtime.room, null);
});

test('two authenticated clients receive confirmed snapshots; payload owner cannot impersonate', async () => {
  let now = 100000; const runtime = createGamingRuntime({ store: new TestStore(), send, clock: () => now }); await runtime.ready;
  const alice = client('alice'), bob = client('bob');
  await runtime.handle(alice, request('enter', { playerId: 'bob' })); await runtime.handle(bob, request('enter'));
  assert.equal(runtime.manifest().enabled, true); now += 1000;
  await runtime.handle(alice, cmd('move', { x: 0, z: 3 }));
  await runtime.handle(alice, cmd('attack', { targetId: 'march-guardian' }));
  // Flush queued snapshot reads without sleeping.
  await runtime.room.queue;
  const a = alice.received.filter(x => x.op === 'snapshot').at(-1), b = bob.received.filter(x => x.op === 'snapshot').at(-1);
  assert.equal(a.state.entities['march-guardian'].hp, 90); assert.equal(b.state.entities['march-guardian'].hp, 90);
  assert.equal(runtime.room.current.entities.bob.x, 0); assert.equal(runtime.room.current.entities.alice.z, 3);
  runtime.close(alice); runtime.close(bob);
});

test('native actor identity is supplied only by the trusted current-session port', async () => {
  let currentDid = null;
  const runtime = createGamingRuntime({ store: new TestStore(), send, clock: () => 100000, verifiedDidFor: () => currentDid });
  await runtime.ready;
  const alice = client('alice'); alice.verifiedDid = 'did:example:claimed'; alice.acct.verifiedDid = alice.verifiedDid;
  await runtime.handle(alice, request('enter'));
  const consent = () => request('consent', { enabled: true, actorDid: 'did:example:alice', recipient: 'https://learning.example/signed',
    sessionId: 'native-game-session', expiresAt: 110000, verifiedDid: 'did:example:alice' });
  await runtime.handle(alice, consent());
  assert.equal(alice.received.at(-1).error.code, 'identity_unverified');
  currentDid = 'did:example:alice';
  await runtime.handle(alice, consent()); assert.equal(alice.received.at(-1).ok, true);
  currentDid = null;
  await runtime.handle(alice, consent()); assert.equal(alice.received.at(-1).error.code, 'identity_unverified');
  runtime.close(alice);
});

test('native-required rooms refuse claimed identity and recheck the trusted proof for every action', async () => {
  let currentDid = null;
  const runtime = createGamingRuntime({ store: new TestStore(), send, clock: () => 100000,
    verifiedDidFor: () => currentDid, requireVerifiedPlayers: true });
  await runtime.ready; const alice = client('alice');
  alice.acct.verifiedDid = 'did:example:forged';
  await runtime.handle(alice, request('enter', { verifiedDid: 'did:example:forged' }));
  assert.equal(alice.received.at(-1).error.code, 'native_identity_required');
  assert.equal(runtime.room.current.entities.alice, undefined);
  currentDid = 'did:example:alice';
  await runtime.handle(alice, request('enter')); assert.equal(alice.received.at(-1).ok, true);
  currentDid = null;
  await runtime.handle(alice, cmd('move', { x: 0, z: 3 }));
  assert.equal(alice.received.at(-1).error.code, 'native_identity_required');
  assert.equal(runtime.room.current.entities.alice.z, 0);
  runtime.close(alice);
});

test('HTTP affordance uses human-issued capability, redacts private state, and honors revocation', async t => {
  const runtime = createGamingRuntime({ store: new TestStore(), send, clock: () => 100000 }); await runtime.ready;
  const alice = client('alice'); await runtime.handle(alice, request('enter'));
  await runtime.handle(alice, request('grant', { request: { agentId: 'did:example:coach', role: 'coach' } }));
  const grant = alice.received.filter(x => x.op === 'result' && x.ok).at(-1).result.result;
  const handler = createAgentHttp({ gaming: runtime });
  const server = http.createServer((req, res) => { if (!handler(req, res, new URL(req.url, 'http://x').pathname)) { res.writeHead(404); res.end(); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (path, body, token = grant.token) => fetch(base + path, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const response = await post('/gaming/agent/observe', { entityId: 'alice' }); assert.equal(response.status, 200);
  const body = await response.json(); assert(body.result.entities); assert(!JSON.stringify(body).includes('tokenHash')); assert.equal(body.result.consent, undefined);
  const denied = await post('/gaming/agent/command', { command: { type: 'move', commandId: 'coach-move', entityId: 'alice', x: 0, z: 1 } }); assert.equal(denied.status, 409);
  await runtime.handle(alice, request('revoke', { grantId: grant.grant.id }));
  assert.equal((await post('/gaming/agent/observe', { entityId: 'alice' })).status, 403);
  assert.equal((await post('/gaming/agent/observe', {}, 'not-a-capability')).status, 401);
  const manifest = gamingAgentAffordances('https://game.example'); assert.equal(manifest.affordances.length, 2);
  assert(manifest.affordances.every(a => a.target.startsWith('https://game.example/gaming/agent/')));
});

test('confirmed snapshot fan-out does not add a native read for every player connection', async () => {
  const store = new TestStore(); let reads = 0, now = 100000;
  const load = store.load.bind(store); store.load = (...args) => { reads++; return load(...args); };
  const runtime = createGamingRuntime({ store, send, clock: () => now }); await runtime.ready;
  const players = Array.from({ length: 12 }, (_, i) => client(`subscriber-${i}`));
  for (const player of players) await runtime.handle(player, request('enter'));
  const before = reads; now += 1000;
  await runtime.handle(players[0], cmd('move', { x: 0, z: 2 })); await runtime.room.queue;
  // One canonical command refresh and the fixture's commit readback; fan-out
  // reuses the just-confirmed snapshot instead of adding twelve remote reads.
  assert.equal(reads - before, 2);
  for (const player of players) assert.equal(player.received.filter(m => m.op === 'snapshot').at(-1).state.entities['subscriber-0'].z, 2);
  const refreshed = reads; await runtime.handle(players[0], request('observe')); assert.equal(reads - refreshed, 1);
  assert.throws(() => runtime.room.observeCommitted({ kind: 'agent', token: 'anything' }), { code: 'human_required' });
});

test('real server snapshots are accepted by the actual browser adapter during entry, movement and combat', async () => {
  let now = 100000, api;
  const human = client('alice');
  const runtime = createGamingRuntime({ store: new TestStore(), clock: () => now,
    send: (c, message) => { assert.equal(c, human); api.msg(message); } });
  await runtime.ready;
  // Initialize the real client module with its feature disabled to avoid DOM
  // construction. Then use its actual protocol/state handlers with this server.
  const context = { window: { __HM_GAMING: { enabled: false }, __hm: {} },
    NETWS: { state: 'on', ws: human.ws, acct: { id: 'alice' }, generation: 1 },
    UI: { modal: null }, IS_TOUCH: true, Date, Promise, Error, Map, Set, Object, Number, String,
    structuredClone, crypto: webcrypto, performance, setTimeout, clearTimeout, setInterval,
    $: () => undefined,
    netWsSend: message => { void runtime.handle(human, JSON.parse(JSON.stringify(message))); return true; },
  };
  vm.createContext(context);
  vm.runInContext(readFileSync(new URL('../../src/14u_gaming.js', import.meta.url), 'utf8'), context);
  api = context.window.__hm.gaming; context.window.__HM_GAMING = runtime.manifest();
  await api.enter();
  assert.equal(api.state.status, 'joined'); assert.equal(api.state.snapshot.entities.length, 2);
  now += 1000;
  await api.command({ type: 'move', x: 0, z: 3 }); await runtime.room.queue;
  assert.equal(api.state.snapshot.entities.find(e => e.id === 'alice').z, 3);
  await api.command({ type: 'attack', targetId: 'march-guardian' }); await runtime.room.queue;
  assert.equal(api.state.snapshot.entities.find(e => e.id === 'march-guardian').hp, 90);
  await api.leave(); runtime.close(human);
});

test('injected domain identity is used by outbox projection and durable acknowledgement', async () => {
  const custom = { ...createHallowmarchDomain(), id: 'custom.shared.v1', evidenceDomain: 'custom-game' };
  let observedDomain;
  const runtime = createGamingRuntime({ store: new TestStore(), domain: custom, clock: () => 100000, send,
    learningSink: { descriptor: { action: FOXXI_XAPI_ACTION, method: 'POST', target: 'https://learning.example/signed' },
      async publish(events, context) { observedDomain = context.domain; return { ok: true, exported: events.length,
        receipts: projectGamingEvents(events, context).evidence.map(e => ({ statementId: e.id, persisted: true })) }; } } });
  await runtime.ready;
  const actor = { playerId: 'alice', realmId: '0', verifiedDid: 'did:example:alice' };
  await runtime.room.execute(actor, { type: 'join', commandId: 'join' });
  await runtime.room.execute(actor, { type: 'learningConsent', commandId: 'consent', enabled: true,
    actorDid: actor.verifiedDid, recipient: 'https://learning.example/signed', sessionId: 'session-a', expiresAt: 110000 });
  await runtime.room.execute(actor, { type: 'knowledge.consulted', commandId: 'consult', resourceId: 'https://example.org/knowledge' });
  const result = await runtime.flushLearning();
  assert.equal(observedDomain, 'custom-game'); assert.equal(result.exported, 1);
  assert.equal(runtime.room.current.outbox.length, 0);
  assert.equal(runtime.metrics().performance.metrics.knowledgeConsultations, 1);
});

test('HTTP response timeout retains backend concurrency until the durable handler settles', async t => {
  let releaseBackend, announceStart, announceSettled, calls = 0;
  const backend = new Promise(resolve => { releaseBackend = resolve; });
  const started = new Promise(resolve => { announceStart = resolve; });
  const settled = new Promise(resolve => { announceSettled = resolve; });
  t.after(() => releaseBackend());
  const gaming = { manifest: () => ({ enabled: true }), async handle(c) {
    calls++;
    if (calls === 1) { announceStart(); await backend; announceSettled(); }
    c.gamingReply({ ok: true, result: { accepted: true } });
  } };
  const handler = createAgentHttp({ gaming, maxConcurrent: 1, timeoutMs: 20 });
  const server = http.createServer((req, res) => handler(req, res, new URL(req.url, 'http://x').pathname));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  const url = `http://127.0.0.1:${server.address().port}/gaming/agent/command`;
  const post = () => fetch(url, { method: 'POST', headers: { authorization: 'Bearer hmca_' + 'A'.repeat(43), 'content-type': 'application/json' },
    body: JSON.stringify({ command: { type: 'move', commandId: 'same-stable-id', x: 0, z: 1 } }) });
  const firstRequest = post(); await started;
  const timeout = await firstRequest; assert.equal(timeout.status, 408); await timeout.arrayBuffer();
  const refused = await post(); assert.equal(refused.status, 429); await refused.arrayBuffer();
  assert.equal(calls, 1, 'a timed-out command still occupies its backend slot');
  releaseBackend(); await settled; await new Promise(resolve => setImmediate(resolve));
  const accepted = await post(); assert.equal(accepted.status, 200); await accepted.arrayBuffer();
  assert.equal(calls, 2, 'the slot becomes available only after actual completion');
});

test('realtime transport advances both players while a native checkpoint is blocked, then recovers saved state', async () => {
  const store = new TestStore(); let now = 100000, releaseWrite, writeStarted;
  const gate = new Promise(resolve => { releaseWrite = resolve; });
  const started = new Promise(resolve => { writeStarted = resolve; });
  const commit = store.commit.bind(store); let blocking = false;
  store.commit = async (...args) => { if (blocking) { writeStarted(); await gate; } return commit(...args); };
  const runtime = createGamingRuntime({ store, send, clock: () => now, persistenceMode: 'realtime' });
  await runtime.ready;
  assert.equal(runtime.manifest().transport.durableAcknowledgements, false);
  assert.equal(runtime.manifest().transport.progressivePersistence, true);
  const alice = client('live-alice'), bob = client('live-bob');
  await runtime.handle(alice, request('enter')); await runtime.handle(bob, request('enter'));
  blocking = true;
  const saving = runtime.flushPersistence(); await started;
  now += 1000;
  // A blocked remote write must not occupy the authoritative command queue.
  const actions = (async () => {
    await runtime.handle(alice, cmd('move', { x: 0, z: 2 }));
    await runtime.handle(alice, cmd('attack', { targetId: 'march-guardian' }));
  })();
  let timeout;
  try { await Promise.race([actions, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error('Gameplay waited for persistence')), 1000); })]); }
  finally { clearTimeout(timeout); }
  await new Promise(resolve => setTimeout(resolve, 80));
  const snapshot = bob.received.filter(m => m.op === 'snapshot').at(-1);
  assert.equal(snapshot.state.entities['live-alice'].z, 2);
  assert.equal(snapshot.state.entities['march-guardian'].hp, 90);
  assert.equal(snapshot.version, snapshot.liveSequence);
  assert(snapshot.liveSequence > snapshot.durableSequence);
  assert.equal(snapshot.persistence.mode, 'realtime');
  releaseWrite();
  await saving; blocking = false; await runtime.flushPersistence();
  const durable = runtime.metrics().persistence;
  assert.equal(durable.liveSequence, durable.durableSequence);
  const restarted = createGamingRuntime({ store, send, clock: () => now, persistenceMode: 'realtime' });
  await restarted.ready;
  assert.equal(restarted.room.current.entities['live-alice'].z, 2);
  assert.equal(restarted.room.current.entities['march-guardian'].hp, 90);
  assert.equal(restarted.metrics().persistence.liveSequence, durable.durableSequence);
  await runtime.shutdown(); await restarted.shutdown();
  await runtime.handle(alice, request('enter'));
  assert.equal(alice.received.at(-1).error.code, 'restarting');
});

test('realtime snapshot fan-out coalesces input bursts without slowing command responses', async () => {
  let now = 100000; const runtime = createGamingRuntime({ store: new TestStore(), send, clock: () => now,
    persistenceMode: 'realtime', broadcastIntervalMs: 20 });
  await runtime.ready;
  const alice = client('burst-alice'), bob = client('burst-bob');
  await runtime.handle(alice, request('enter')); await runtime.handle(bob, request('enter'));
  const before = bob.received.filter(m => m.op === 'snapshot').length;
  for (let z = 1; z <= 6; z++) { now += 500; await runtime.handle(alice, cmd('move', { x: 0, z })); }
  assert.equal(bob.received.filter(m => m.op === 'snapshot').length, before);
  assert.equal(alice.received.filter(m => m.op === 'result' && m.ok).length, 7);
  await new Promise(resolve => setTimeout(resolve, 35));
  const snapshots = bob.received.filter(m => m.op === 'snapshot');
  assert.equal(snapshots.length, before + 1);
  assert.equal(snapshots.at(-1).state.entities['burst-alice'].z, 6);
  assert.equal(runtime.manifest().transport.maxSnapshotHz, 50);
  await runtime.shutdown();
});
