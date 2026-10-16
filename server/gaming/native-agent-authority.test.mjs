import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as core from '@interego/core';
import { createGamingRuntime } from './runtime.js';
import { createNativeAgentAuthority, NATIVE_AGENT_PATHS } from './native-agent-authority.js';
import { createNativeAgentHttp, nativeAgentAffordances, nativeAgentMetadataGraph } from './native-agent-http.js';
import { configuredNativeAgentHost } from './native-agent-host.js';
import { createGameSessionTokens } from './game-session.js';
import { agentCommandMessage, agentRenewalMessage, agentSessionPossessionMessage, NATIVE_OWNER_AGENT_GRANT_SCHEMA } from './native-agent-proof.js';
import { OWNER_AGENT_GRANT_SCHEMA } from '../../client/native-pod/owner-agent-grant-schema.mjs';

// Actual native secp256k1 envelope + Ed25519 signatures + actual room/CAS paths.
// Native read ports are explicit fixtures, not live owner-pod evidence.
const wallet = await core.createWallet('agent', 'game-authority-fixture');
const agentDid = 'did:ethr:' + wallet.address.toLowerCase();
const origin = 'https://game.example', applicationId = 'did:web:identity.example:users:game';
const grantId = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
const graphIri = 'urn:graph:interego:gaming:owner-agent-grant:1647775c-22c7-4a79-8a45-d55cfe101b41';
const sha = text => createHash('sha256').update(text).digest('hex');
const localRequest = (port, path, body, headers = {}) => new Promise((resolve, reject) => {
  const req = http.request({ hostname: '127.0.0.1', port, path, method: body === undefined ? 'GET' : 'POST', headers }, res => {
    const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
  }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
});
const ownerBinding = id => ({ subjectDid: 'did:web:identity.example:users:' + id, webId: `https://identity.example/users/${id}/profile#me`,
  userId: id, podUrl: `https://pods.example/${id}/` });
class Store {
  value = { version: 0, state: null }; reads = 0; commits = 0; hook = null;
  async load() { this.reads++; return structuredClone(this.value); }
  async commit(id, request) {
    this.commits++; if (this.hook) await this.hook(request);
    if (request.expectedVersion !== this.value.version) throw Object.assign(new Error('fixture CAS conflict'), { code: 'VERSION_CONFLICT' });
    this.value = { version: this.value.version + 1, state: structuredClone(request.state) }; return this.load();
  }
}
async function fixture(t, options = {}) {
  let at = Date.parse('2026-10-16T12:00:00Z'), ownerReads = 0, agentReads = 0, failRead = false, grantTransform = x => x;
  const bindings = { alice: ownerBinding('alice'), bob: ownerBinding('bob') }, store = options.store || new Store();
  const clients = {}, tokens = createGameSessionTokens({ secret: 'fixture-game-HMAC-only', now: () => at });
  const accounts = { bindingForAccount(id) { return bindings[id] || null; }, async ownerForRequest(req) {
    const claims = tokens.read(req.headers.authorization?.replace(/^Bearer /, ''));
    if (!claims || claims.nativeDid !== bindings[claims.id]?.subjectDid) throw Object.assign(new Error('No verified owner fixture session'),
      { name: 'HostError', code: 'game_account_required', status: 401 });
    return { accountId: claims.id, binding: bindings[claims.id] };
  } };
  const gaming = createGamingRuntime({ store, clock: () => at, requireVerifiedPlayers: true, roomId: 'room-a',
    persistenceMode: options.persistenceMode || 'strict', checkpointIntervalMs: 30000, send: (c, value) => c.received.push(value),
    verifiedDidFor: c => bindings[c.acct?.id]?.subjectDid || null });
  await gaming.ready;
  for (const id of ['alice', 'bob']) {
    const c = clients[id] = { acct: { id }, realm: 0, ws: { readyState: 1 }, received: [] };
    await gaming.handle(c, { op: 'enter', requestId: 'enter-' + id });
  }
  await gaming.flushPersistence();
  const grant = () => grantTransform({ schema: 'interego.gaming.owner-agent-grant/v1', id: grantId, issuer: bindings.alice.subjectDid,
    actor: agentDid, applicationId, audience: origin, roomId: 'room-a', entityId: 'alice', role: 'teammate',
    actions: ['observe', 'move', 'attack', 'claimLoot'], maxCommandsPerSecond: 20, revoked: false,
    notBefore: '2026-10-16T11:59:59.000Z', expiresAt: '2026-10-16T12:30:00.000Z' });
  const makeAuthority = runtime => createNativeAgentAuthority({ gaming: runtime, accounts, applicationId, audience: origin, nativeCore: core, now: () => at,
    readOwnerGrantHead: async () => { ownerReads++; if (failRead) throw new Error('fixture owner source unavailable'); return {
      grant: grant(), ownerPodUrl: bindings.alice.podUrl, descriptorUrl: bindings.alice.podUrl + 'context-graphs/current.ttl',
      graphIri, cid: 'bafy-fixture', contentDigest: 'a'.repeat(64), observedAt: at }; },
    resolveAgentProof: async () => { agentReads++; return { agentDid, podUrl: 'https://pods.example/agent-a/', mode: 'independent-key',
      signerDid: agentDid, observedAt: at, expiresAt: at + 300000 }; } });
  const authority = makeAuthority(gaming), owner = id => ({ accountId: id, binding: bindings[id] });
  const register = () => authority.register(owner('alice'), { grantId, graphIri });
  const prepare = async () => {
    const key = generateKeyPairSync('ed25519'), challenge = await authority.challenge({ grantId, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) });
    const _signed_payload = JSON.stringify({ ...challenge.payload, agent_id: agentDid, subject_pod_url: 'https://pods.example/agent-a/', timestamp: new Date(at).toISOString() });
    return { key, body: { challengeId: challenge.challengeId, envelope: { _signed_payload, _signature: await core.signMessageRaw(wallet, 'sha256:' + sha(_signed_payload)) },
      sessionSignature: sign(null, Buffer.from(agentSessionPossessionMessage(challenge.payload)), key.privateKey).toString('base64url') } };
  };
  const session = async () => { await register(); const prepared = await prepare(); return { ...(await authority.complete(prepared.body)), key: prepared.key }; };
  const command = (session, sequence = 1, changes = {}) => {
    const command = { type: 'move', roomId: 'room-a', entityId: 'alice', commandId: 'move-' + sequence, x: 0, z: 0, ...changes };
    const request = { sequence, at, method: 'POST', path: NATIVE_AGENT_PATHS.command, action: command.type, roomId: command.roomId, entityId: command.entityId, body: { command } };
    return { sessionId: session.sessionId, sequence, at, command,
      signature: sign(null, Buffer.from(agentCommandMessage(session.sessionId, request)), session.key.privateKey).toString('base64url') };
  };
  t.after(async () => { authority.close(); store.hook = null; await gaming.shutdown().catch(() => {}); });
  return { authority, gaming, store, accounts, clients, bindings, tokens, owner, register, prepare, session, command, makeAuthority,
    now: () => at, advance(ms) { at += ms; }, reads: () => ({ ownerReads, agentReads }), failRead() { failRead = true; }, grant(fn) { grantTransform = fn; } };
}

test('owner pointer registration and native proof admission persist references/scope without bearer or personal state', async t => {
  const f = await fixture(t), registered = await f.register();
  assert(registered.authority.durable); assert.equal(f.authority.lookupOwnerGrant({ grantId }).binding.subjectDid, f.bindings.alice.subjectDid);
  const ownerView = await f.gaming.room.observe({ playerId: 'alice' }), otherView = await f.gaming.room.observe({ playerId: 'bob' });
  assert.equal(ownerView.nativeReferences[0].grantId, grantId); assert.equal(otherView.nativeReferences.length, 0);
  const s = await f.session(); assert(s.authority.durable); assert(s.authority.version <= f.store.value.version);
  assert.deepEqual(s.receipt.scope.actions, ['observe', 'move', 'attack', 'claimLoot']);
  const stored = JSON.stringify(f.store.value), output = JSON.stringify(s);
  for (const secret of ['hmca_', '_signed_payload', '_signature', 'privateKey', 'refreshToken', 'accessToken']) assert(!stored.includes(secret));
  assert(!output.includes('hmca_')); assert.equal((await f.gaming.room.observe({ playerId: 'alice' })).grants.length, 0);
  assert.equal((await f.gaming.room.observe({ playerId: 'bob' })).nativeCompanions.length, 0);
  assert.equal(NATIVE_OWNER_AGENT_GRANT_SCHEMA, OWNER_AGENT_GRANT_SCHEMA);
});

test('command action is derived from actual signed body; exact scope/sequence survives into normal game authority', async t => {
  const f = await fixture(t), s = await f.session(); f.advance(1000);
  const before = f.reads(), result = await f.authority.command(f.command(s, 1, { z: 1 }));
  assert.equal(result.result.z, 1); assert.deepEqual(f.reads(), before);
  await assert.rejects(f.authority.command(f.command(s, 1)));
  await assert.rejects(f.authority.command({ ...f.command(s, 2), action: 'observe' }));
  await assert.rejects(f.authority.command(f.command(s, 2, { entityId: 'bob' })));
  await assert.rejects(f.authority.command(f.command(s, 2, { type: 'resetEncounter' })));
  // Valid proof is consumed even when the normal domain refuses a teleport.
  await assert.rejects(f.authority.command(f.command(s, 2, { z: 30 })), { code: 'pace_exceeded' });
  assert.equal((await f.authority.command(f.command(s, 3, { z: 1 }))).ok, true);
  assert.deepEqual(f.reads(), before); assert.equal(f.gaming.room.current.entities.bob.z, 0);
});

test('native proof does not grant a caller another owner body or let a game bearer replace native identity', async t => {
  const f = await fixture(t); await f.register();
  await assert.rejects(f.authority.register(f.owner('bob'), { grantId, graphIri }), { code: 'native_reference_conflict' });
  await assert.rejects(f.authority.register(f.owner('alice'), { grantId, graphIri, issuer: f.bindings.bob.subjectDid }));
  f.grant(grant => ({ ...grant, entityId: 'bob' })); await assert.rejects(f.prepare(), { code: 'native_proof_unavailable' });
  f.grant(grant => ({ ...grant, issuer: f.bindings.bob.subjectDid })); await assert.rejects(f.prepare(), { code: 'native_proof_unavailable' });
});

test('a native internal room permit still refuses bearer-only commands and forged wire admissions', async t => {
  const f = await fixture(t), s = await f.session();
  const admitted = await f.gaming.room.admitNativeCompanion({ playerId: 'alice', verifiedDid: f.bindings.alice.subjectDid }, s.receipt, 'privileged-fixture-second-admission');
  const internalPermit = admitted.result.token;
  await assert.rejects(f.gaming.room.execute({ kind: 'agent', token: internalPermit }, f.command(s).command), { code: 'native_agent_proof_required' });
  await f.gaming.handle(f.clients.alice, { op: 'command', requestId: 'forged-wire-admit', command: { type: 'admitNativeCompanion', commandId: 'forged-admit', receipt: s.receipt } });
  assert.equal(f.clients.alice.received.at(-1).error.code, 'native_agent_bridge_required');
  await f.gaming.handle(f.clients.alice, { op: 'grant', requestId: 'legacy-label', request: { agentId: agentDid } });
  assert.equal(f.clients.alice.received.at(-1).error.code, 'native_agent_grant_required');
  await f.gaming.handle(f.clients.alice, { op: 'agent.command', token: internalPermit, command: f.command(s).command });
  assert.equal(f.clients.alice.received.at(-1).error.code, 'native_agent_proof_required');
});

test('admission in realtime mode waits for the native checkpoint; failure never leaves a usable bridge session', async t => {
  const f = await fixture(t, { persistenceMode: 'realtime' }); await f.register(); const prepared = await f.prepare();
  let release, entered; const blocked = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.store.hook = async () => { entered(); await blocked; };
  let returned = false; const completion = f.authority.complete(prepared.body).then(value => { returned = true; return value; });
  await started; assert.equal(returned, false); assert.equal(f.authority.status().activeAuthoritySessions, 0);
  release(); const s = await completion; assert(s.authority.durable); assert(returned); assert.equal(f.authority.status().activeAuthoritySessions, 1);
  f.store.hook = null;
});

test('a failed strict native admission commit and expired queued proof both fail closed', async t => {
  const f = await fixture(t); await f.register(); const prepared = await f.prepare();
  f.store.hook = async () => { throw new Error('fixture storage down'); };
  await assert.rejects(f.authority.complete(prepared.body)); assert.equal(f.authority.status().activeAuthoritySessions, 0); assert.equal(f.authority.status().sessions, 0);
  f.store.hook = null; const s = await f.session();
  let release; const blocker = new Promise(resolve => { release = resolve; });
  f.gaming.room.queue = blocker;
  const pending = f.authority.command(f.command(s)); f.advance(10001); release();
  await assert.rejects(pending, { code: 'native_agent_proof_required' });
});

test('local revoke precedes durable save, remains idempotent, and persisted UUID revocation rejects old owner heads after restart', async t => {
  const f = await fixture(t), s = await f.session();
  await assert.rejects(f.authority.revoke(f.owner('bob'), { grantId }));
  let release, entered; const block = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.store.hook = async () => { entered(); await block; };
  const revocation = f.authority.revoke(f.owner('alice'), { grantId }); await started;
  await assert.rejects(f.authority.command(f.command(s))); assert.equal(f.authority.status().activeAuthoritySessions, 0);
  release(); const revoked = await revocation; f.store.hook = null;
  assert(revoked.revoked && revoked.authority.durable); assert.equal(revoked.ownerPodRevocation, 'requires-owner-publication');
  assert((await f.authority.revoke(f.owner('alice'), { grantId })).revoked);
  const restarted = createGamingRuntime({ store: f.store, send() {}, roomId: 'room-a', clock: f.now }); await restarted.ready;
  const next = f.makeAuthority(restarted); t.after(() => { next.close(); return restarted.shutdown(); });
  const beforeReads = f.reads();
  await assert.rejects(async () => next.challenge({ grantId, sessionPublicKeyJwk: s.key.publicKey.export({ format: 'jwk' }) }), { code: 'native_grant_unavailable' });
  assert.deepEqual(f.reads(), beforeReads);
});

test('renewal reads fresh native sources once and failure closes commands without a fallback', async t => {
  const f = await fixture(t), s = await f.session(); f.advance(1000);
  const request = { sequence: 1, at: f.now() }, signature = sign(null, Buffer.from(agentRenewalMessage(s.sessionId, request)), s.key.privateKey).toString('base64url');
  const before = f.reads(), renewed = await f.authority.renew({ sessionId: s.sessionId, ...request, signature });
  assert(renewed.expiresAt > s.expiresAt); assert.deepEqual(f.reads(), { ownerReads: before.ownerReads + 1, agentReads: before.agentReads + 1 });
  f.failRead(); const bad = { sequence: 2, at: f.now() };
  await assert.rejects(f.authority.renew({ sessionId: s.sessionId, ...bad, signature: sign(null, Buffer.from(agentRenewalMessage(s.sessionId, bad)), s.key.privateKey).toString('base64url') }));
  await assert.rejects(f.authority.command(f.command(s, 3))); assert.equal(f.authority.status().activeAuthoritySessions, 0);
});

test('reconnecting sessions reuse the durable native relationship and enforce its shared command rate', async t => {
  const f = await fixture(t); f.grant(grant => ({ ...grant, maxCommandsPerSecond: 1 }));
  const first = await f.session(), commits = f.store.commits;
  const others = [];
  for (let i = 0; i < 9; i++) others.push(await f.session());
  assert.equal(f.store.commits, commits); assert.equal(Object.keys(f.gaming.room.current.companions.grants).length, 1);
  assert.equal((await f.authority.command(f.command(first))).ok, true);
  await assert.rejects(f.authority.command(f.command(others[0])), { code: 'native_grant_rate_limited' });
  f.advance(1000);
  assert.equal((await f.authority.command(f.command(others[0], 2))).ok, true);
  assert.equal((await f.gaming.room.observe({ playerId: 'alice' })).nativeReferences.length, 1);
});

test('a restarted bridge rotates unrecoverable private permits without using up the owner grant limit', async t => {
  const f = await fixture(t), first = await f.session();
  for (let i = 0; i < 10; i++) {
    const receipt = await f.gaming.room.admitNativeCompanion({ playerId: 'alice', verifiedDid: f.bindings.alice.subjectDid }, first.receipt, 'restart-admission-' + i);
    assert(receipt.result.token); assert.equal(Object.keys(f.gaming.room.current.companions.grants).length, 1);
    assert.equal(Object.keys(f.gaming.room.current.companions.nativeReferences).length, 1);
  }
});

test('discoverable native operations use actual core affordance extraction and truthful scope limits', async () => {
  const doc = nativeAgentAffordances({ publicOrigin: origin, applicationId, enabled: true }), graph = nativeAgentMetadataGraph(doc);
  assert.equal(doc.operations.length, 7); assert.equal(doc.ownerGrant.schema, OWNER_AGENT_GRANT_SCHEMA);
  const actions = core.extractAffordancesFromTurtle(graph);
  assert.equal(actions.length, 7);
  assert(graph.includes('urn:interego:gaming:native-agent:register')); assert(graph.includes('60 requests/minute/IP'));
  assert.equal(doc.migrationBoundaries.mainWorldServerAuthority, false);
});

test('native host disabled configuration neither imports a mock SDK nor falls back to cg2 credentials', async () => {
  const accounts = { ownerForRequest() {} }, gaming = { manifest: () => ({ enabled: true }) };
  const host = await configuredNativeAgentHost({ gaming, accounts, environment: { HM_PUBLIC_ORIGIN: origin, HM_NATIVE_AGENT_ENABLED: '1',
    HM_GAMING_NATIVE_OWNER: applicationId, HM_GAMING_NATIVE_CAPABILITY: 'cg2.fixture-not-an-oauth-token' }, modules: { core: new Proxy({}, { get() { throw new Error('must not load'); } }) } });
  assert.equal(host.status().enabled, false); assert.equal(host.manifest().enabled, false); assert.equal(host.manifest().applicationId, applicationId); host.close();
});

test('HTTP requires a current owner app proof only for pointer mutations and rejects foreign origins/claimed DID', async t => {
  const f = await fixture(t), handler = createNativeAgentHttp({ authority: f.authority, accounts: f.accounts, publicOrigin: origin, applicationId });
  const server = http.createServer((req, res) => { void handler.handle(req, res, new URL(req.url, origin).pathname).then(handled => { if (!handled) { res.writeHead(404); res.end(); } }); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => server.close(resolve)));
  const token = f.tokens.issueNative('alice', f.bindings.alice.subjectDid).token;
  const post = (path, body, headers = {}) => localRequest(server.address().port, path, body, { host: 'game.example', origin, authorization: 'Bearer ' + token,
    'content-type': 'application/json', ...headers });
  assert.equal((await post(NATIVE_AGENT_PATHS.register, { grantId, graphIri }, { origin: 'https://foreign.example' })).status, 403);
  const unauthenticated = await post(NATIVE_AGENT_PATHS.register, { grantId, graphIri }, { authorization: 'Bearer invalid' });
  assert.equal(unauthenticated.status, 401); assert.equal((await unauthenticated.json()).error, 'game_account_required');
  assert.equal((await post(NATIVE_AGENT_PATHS.register, { grantId, graphIri, did: f.bindings.bob.subjectDid })).status, 403);
  const registered = await (await post(NATIVE_AGENT_PATHS.register, { grantId, graphIri })).json(); assert(registered.ok); assert(registered.result.authority.durable);
  const description = await (await localRequest(server.address().port, '/gaming/native-agents', undefined, { host: 'game.example' })).json();
  assert.equal(description.operations.find(op => op['iep:action']['@id'].endsWith(':register'))['hydra:target'], origin + NATIVE_AGENT_PATHS.register);
  assert.equal((await post(NATIVE_AGENT_PATHS.command, { token: 'hmca_' + 'a'.repeat(43) })).status, 403);
  assert(!(JSON.stringify(registered).includes('hmca_')));
});

test('HTTP timeout retains backend capacity while an unabortable native operation is still pending', async t => {
  let finish; const blocked = new Promise(resolve => { finish = resolve; });
  const authority = { status: () => ({ enabled: true, leaseMs: 10000 }), challenge: () => blocked };
  const handler = createNativeAgentHttp({ authority, accounts: { ownerForRequest() {} }, publicOrigin: origin, applicationId, timeoutMs: 100, maxConcurrent: 1 });
  const server = http.createServer((req, res) => { void handler.handle(req, res, NATIVE_AGENT_PATHS.challenge); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve)); t.after(() => { finish({}); return new Promise(resolve => server.close(resolve)); });
  const request = () => localRequest(server.address().port, '/', {}, { host: 'game.example', 'content-type': 'application/json' });
  assert.equal((await request()).status, 504); assert.equal((await request()).status, 429); finish({});
});
