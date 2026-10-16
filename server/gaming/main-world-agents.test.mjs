import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as core from '@interego/core';
import { createMainWorldAgents, WORLD_AGENT_PATHS, mainWorldAgentAffordances } from './main-world-agents.js';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { createMainWorldAgentTransport } from './main-world-agent-transport.js';
import { agentCommandMessage, agentSessionPossessionMessage, agentRenewalMessage } from './native-agent-proof.js';

// Actual native wallet and holder signatures. Pod head/CAS ports are explicit
// fixtures; separate live main-game verification must establish deployment.
const wallet = await core.createWallet('agent', 'main-world-fixture');
const actor = 'did:ethr:' + wallet.address.toLowerCase(), applicationId = 'did:web:identity.example:users:march';
const grantId = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
const graphIri = 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9);
const binding = id => ({ subjectDid: 'did:web:identity.example:users:' + id, podUrl: 'https://pod.example/' + id + '/' });
const clone = value => structuredClone(value);
const authorityStream = 'hallowmarch-main-world-agent-authority-v1';
const revocationStream = id => 'hallowmarch-main-world-agent-revocation-v1:' + id;
const referenceFor = i => { const grantId = 'urn:uuid:00000000-0000-4000-8000-' + i.toString(16).padStart(12, '0');
  return { grantId, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9) }; };
class Store {
  owner = applicationId; values = new Map(); podRevocations = new Set(); receipts = new Map(); commits = 0; hook = null; uncertain = false;
  get value() { return this.values.get(authorityStream) || { version: 0, state: null }; }
  async load(id) { return clone(this.values.get(id) || { version: 0, state: null }); }
  async commit(id, request) {
    const key = id + ':' + request.idempotencyKey;
    if (this.receipts.has(key)) return clone(this.receipts.get(key));
    this.commits++; await this.hook?.(id, request);
    const prior = this.values.get(id) || { version: 0, state: null };
    if (request.expectedVersion !== prior.version) throw Object.assign(new Error('fixture CAS conflict'), { code: 'VERSION_CONFLICT' });
    const value = { version: prior.version + 1, state: clone(request.state) };
    this.values.set(id, value); this.receipts.set(key, clone(value));
    if (this.uncertain) { this.uncertain = false; throw new Error('fixture lost native ACK'); }
    return clone(value);
  }
}
async function setup(t, existingStore = null, options = {}) {
  let at = Date.parse('2026-10-16T12:00:00Z'), ownerReads = 0, agentReads = 0;
  const store = existingStore || new Store(), messages = [], alice = { acct: { id: 'alice' }, room: { name: 'march' }, peer: 'first-owner-page', ws: { readyState: 1 }, native: true };
  const bob = { acct: { id: 'bob' }, room: alice.room, peer: 'bob-page', ws: { readyState: 1 }, native: true };
  const transport = createMainWorldAgentTransport({ now: () => at,
    principalFor: c => c.native && c.ws.readyState === 1 ? binding(c.acct.id).subjectDid : null,
    send: (client, message) => messages.push({ client, message }) });
  const frame = (c = alice, options = {}) => transport.frame(c, { paused: false,
    bodies: [{ id: c.acct.id, x: 1, y: 0, z: 2, hp: 100, maxHp: 100, allowed: true }],
    targets: [{ id: '42', name: 'A real main-world foe', x: 1, y: 0, z: 3, hp: 40, maxHp: 40 }], ...options });
  frame();
  const accounts = { bindingForAccount: id => ['alice', 'bob'].includes(id) ? binding(id) : null };
  const owner = id => ({ accountId: id, binding: binding(id) });
  let transform = x => x, ownerReadHook = null;
  const grant = () => transform({ schema: 'interego.gaming.owner-agent-grant/v1', id: grantId, issuer: binding('alice').subjectDid,
    actor, applicationId, audience: 'https://game.example', roomId: 'march', entityId: 'alice', role: 'teammate',
    actions: ['observe', 'move', 'attack'], maxCommandsPerSecond: 20, revoked: false,
    notBefore: '2026-10-16T11:59:59.000Z', expiresAt: '2026-10-16T12:30:00.000Z' });
  const authority = await createMainWorldAgents({ store, accounts, applicationId, audience: 'https://game.example', nativeCore: core,
    now: () => at, requestTimeoutMs: options.requestTimeoutMs || 10000, ...transport,
    readOwnerGrantHead: async ({ grantId: selected }) => { ownerReads++; await ownerReadHook?.(selected); const g = grant(); return {
      grant: { ...g, id: selected, revoked: store.podRevocations.has(selected) || g.revoked }, ownerPodUrl: binding('alice').podUrl,
      descriptorUrl: binding('alice').podUrl + 'context-graphs/head.ttl', graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + selected.slice(9),
      cid: 'bafy-explicit-fixture', contentDigest: 'a'.repeat(64), observedAt: at }; },
    resolveAgentProof: async () => { agentReads++; return { agentDid: actor, podUrl: 'https://pod.example/agent/',
      mode: 'independent-key', signerDid: actor, observedAt: at, expiresAt: at + 300000 }; } });
  const register = () => authority.register(owner('alice'), { grantId, graphIri });
  const prepare = async () => {
    const key = generateKeyPairSync('ed25519');
    const challenge = await authority.challenge({ grantId, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) });
    const _signed_payload = JSON.stringify({ ...challenge.payload, agent_id: actor, subject_pod_url: 'https://pod.example/agent/', timestamp: new Date(at).toISOString() });
    const _signature = await core.signMessageRaw(wallet, 'sha256:' + createHash('sha256').update(_signed_payload).digest('hex'));
    return { key, body: { challengeId: challenge.challengeId, envelope: { _signed_payload, _signature },
      sessionSignature: sign(null, Buffer.from(agentSessionPossessionMessage(challenge.payload)), key.privateKey).toString('base64url') } };
  };
  const session = async () => { await register(); const p = await prepare(); return { ...(await authority.complete(p.body)), key: p.key }; };
  const command = (session, sequence = 1, override = {}) => {
    const command = { type: 'move', roomId: 'march', entityId: 'alice', commandId: session.sessionId + ':move-1', dx: 1, dz: 0, durationMs: 200, ...override };
    const request = { sequence, at, method: 'POST', path: WORLD_AGENT_PATHS.command, action: command.type,
      roomId: command.roomId, entityId: command.entityId, body: { command } };
    return { sessionId: session.sessionId, sequence, at, command,
      signature: sign(null, Buffer.from(agentCommandMessage(session.sessionId, request)), session.key.privateKey).toString('base64url') };
  };
  const settle = async task => {
    await new Promise(resolve => setImmediate(resolve));
    const message = messages.findLast(row => row.message.op === 'command').message;
    transport.result(alice, { requestId: message.requestId, ok: true }); return task;
  };
  t.after(async () => { store.hook = null; transport.close(alice); await authority.close().catch(() => {}); });
  return { store, authority, transport, messages, alice, bob, owner, frame, register, prepare, session, command, settle,
    now: () => at, advance: ms => { at += ms; }, reads: () => [ownerReads, agentReads], transform: fn => { transform = fn; }, markPodRevoked: id => { store.podRevocations.add(id); }, setOwnerReadHook: fn => { ownerReadHook = fn; } };
}

test('main-world references bind actual native owner; disclosure does not authorize personal data', async t => {
  const f = await setup(t), r = await f.register(); assert(r.authority.durable);
  assert.equal(f.authority.references(f.owner('alice')).length, 1); assert.deepEqual(f.authority.references(f.owner('bob')), []);
  await assert.rejects(f.authority.register(f.owner('bob'), { grantId, graphIri }));
  await assert.rejects(f.authority.register(f.owner('alice'), { grantId, graphIri, privateCharacter: {} }));
  const s = await f.session(); assert(s.authority.durable);
  for (const secret of ['privateKey', '_signed_payload', '_signature', 'accessToken', 'refreshToken', 'inventory']) assert(!JSON.stringify(f.store.value).includes(secret));
});
test('signed input reaches only the live owner page, with zero command-plane native reads', async t => {
  const f = await setup(t), s = await f.session(), before = f.reads();
  const task = f.authority.command(f.command(s));
  await new Promise(resolve => setImmediate(resolve));
  const sent = f.messages.findLast(row => row.message.op === 'command'); assert.equal(sent.client, f.alice);
  assert.equal(f.transport.result(f.bob, { requestId: sent.message.requestId, ok: true }), false);
  const result = await f.settle(task); assert.equal(result.execution, 'owner-page-input-applied'); assert.deepEqual(f.reads(), before);
  await assert.rejects(f.authority.command(f.command(s)), { code: 'agent_sequence_rejected' });
});
test('teleports, wrong bodies/rooms, forged signatures and private loot mutations are refused', async t => {
  const f = await setup(t), s = await f.session();
  await assert.rejects(f.authority.command(f.command(s, 1, { dx: 400 })));
  await assert.rejects(f.authority.command(f.command(s, 1, { entityId: 'bob' })));
  await assert.rejects(f.authority.command(f.command(s, 1, { roomId: 'another-shard' })));
  await assert.rejects(f.authority.command({ ...f.command(s), signature: 'A'.repeat(86) }));
  await assert.rejects(f.authority.command(f.command(s, 1, { type: 'claimLoot' })));
  assert.equal(f.messages.filter(r => r.message.op === 'command').length, 0);
});
test('logical command retries retain one dispatch and reject changed bodies for an existing ID', async t => {
  const f = await setup(t), s = await f.session(); const result = await f.settle(f.authority.command(f.command(s)));
  assert.deepEqual(await f.authority.command(f.command(s, 2)), result);
  await assert.rejects(f.authority.command(f.command(s, 3, { dx: 0 })), { code: 'native_command_id_conflict' });
  assert.equal(f.messages.filter(r => r.message.op === 'command').length, 1);
});
test('renewed agent control runs beyond 512 inputs without evicting active-session retry receipts', async t => {
  const f = await setup(t), s = await f.session(); let sequence = 0, expiresAt = s.expiresAt, firstRequest, firstResult;
  for (let i = 0; i < 620; i++) {
    if (expiresAt - f.now() < 3000) {
      const input = { sessionId: s.sessionId, sequence: ++sequence, at: f.now() };
      input.signature = sign(null, Buffer.from(agentRenewalMessage(s.sessionId, { sequence: input.sequence, at: input.at })), s.key.privateKey).toString('base64url');
      expiresAt = (await f.authority.renew(input)).expiresAt;
    }
    const request = f.command(s, ++sequence, { commandId: s.sessionId + ':move-' + i });
    const result = await f.settle(f.authority.command(request));
    if (!i) { firstRequest = request; firstResult = result; }
    f.advance(51); f.frame();
  }
  assert.equal(f.messages.filter(r => r.message.op === 'command').length, 620);
  assert.equal(f.transport.status().retainedCommandReceipts, 620);
  assert.equal(f.transport.status().commandSessions, 1);
  // A fresh signed sequence may retry an earlier logical ID. It must retain
  // the original result even after hundreds of later inputs and renewals.
  f.advance(1000); f.frame();
  assert.deepEqual(await f.authority.command(f.command(s, ++sequence, firstRequest.command)), firstResult);
  await assert.rejects(f.authority.command(f.command(s, ++sequence, { ...firstRequest.command, dx: 0 })), { code: 'native_command_id_conflict' });
  await assert.rejects(f.authority.command(firstRequest), { code: 'agent_sequence_rejected' });
  assert.equal(f.messages.filter(r => r.message.op === 'command').length, 620);
});
test('receipt cleanup respects an idle renewal and removes only unusable proof sessions', async t => {
  const f = await setup(t), first = await f.session();
  const oldRequest = f.command(first), oldResult = await f.settle(f.authority.command(oldRequest));
  f.advance(9000); f.frame();
  const input = { sessionId: first.sessionId, sequence: 2, at: f.now() };
  input.signature = sign(null, Buffer.from(agentRenewalMessage(first.sessionId, { sequence: input.sequence, at: input.at })), first.key.privateKey).toString('base64url');
  await f.authority.renew(input);
  // The original lease expired, but the authority renewed it while no inputs
  // reached transport. A second session must not discard its exact receipts.
  f.advance(2000); f.frame(); const second = await f.session();
  await f.settle(f.authority.command(f.command(second)));
  assert.equal(f.transport.status().retainedCommandReceipts, 2);
  assert.deepEqual(await f.authority.command(f.command(first, 3)), oldResult);
  f.advance(11000); f.frame(); const third = await f.session();
  await f.settle(f.authority.command(f.command(third)));
  assert.equal(f.transport.status().retainedCommandReceipts, 1);
  assert.equal(f.transport.status().commandSessions, 1);
  await assert.rejects(f.authority.command(oldRequest), { code: 'agent_session_unavailable' });
  await assert.rejects(f.authority.command(f.command(third, 2, { commandId: oldRequest.command.commandId })), { code: 'invalid_native_command' });
  assert.equal(f.messages.filter(r => r.message.op === 'command').length, 3);
});
test('paused, stale and replaced owner pages fail closed even inside a native lease', async t => {
  const f = await setup(t), s = await f.session(); f.frame(f.alice, { paused: true });
  await assert.rejects(f.authority.command(f.command(s)), { code: 'native_body_forbidden' });
  f.frame(); f.advance(3100); await assert.rejects(f.authority.command(f.command(s, 2)), { code: 'native_body_forbidden' });
  f.frame(); f.alice.peer = 'reconnected-owner-page'; f.frame();
  await assert.rejects(f.authority.command(f.command(s, 3)), { code: 'native_owner_page_changed' });
});
test('expired or remotely revoked native grants cannot renew', async t => {
  const f = await setup(t), s = await f.session(); f.transform(g => ({ ...g, revoked: true }));
  const input = { sessionId: s.sessionId, sequence: 1, at: f.now() };
  input.signature = sign(null, Buffer.from(agentRenewalMessage(s.sessionId, { sequence: 1, at: input.at })), s.key.privateKey).toString('base64url');
  await assert.rejects(f.authority.renew(input)); await assert.rejects(f.authority.command(f.command(s, 2)));
});
test('durable local revocation survives a registry restart without consulting the owner pod', async t => {
  const f = await setup(t), s = await f.session(); await f.authority.revoke(f.owner('alice'), { grantId });
  await assert.rejects(f.authority.command(f.command(s))); const g = await setup(t, f.store), before = g.reads();
  assert.throws(() => g.authority.challenge({ grantId, sessionPublicKeyJwk: s.key.publicKey.export({ format: 'jwk' }) }), { code: 'native_grant_unavailable' });
  assert.deepEqual(g.reads(), before);
  assert.equal(g.authority.lookupOwnerGrant({ grantId }).binding.subjectDid, binding('alice').subjectDid);
  await assert.rejects(g.authority.revoke(g.owner('bob'), { grantId }), { code: 'native_owner_required' });
  await assert.rejects(g.register(), { code: 'native_grant_unavailable' });
  g.advance(24 * 60 * 60 * 1000); // Owner may extend the pod grant, but its UUID stays retired.
  await assert.rejects(g.register(), { code: 'native_grant_unavailable' });
  await assert.rejects(g.authority.register(g.owner('bob'), { grantId, graphIri }), { code: 'native_grant_unavailable' });
  assert.deepEqual(g.reads(), before);
});
test('lost native permission ACK retries the same retained operation rather than duplicating authority', async t => {
  const f = await setup(t); f.store.uncertain = true;
  await assert.rejects(f.register()); const commits = f.store.commits;
  const result = await f.register(); assert(result.authority.durable); assert.equal(f.store.commits, commits);
});
test('a blocked durable admission cannot return a usable proof lease after expiry', async t => {
  const f = await setup(t); await f.register(); const p = await f.prepare();
  f.store.hook = async () => { f.advance(11000); f.frame(); };
  await assert.rejects(f.authority.complete(p.body), { code: 'native_admission_expired' });
  f.store.hook = null; const before = f.store.commits, q = await f.prepare();
  const fresh = await f.authority.complete(q.body); assert(fresh.authority.durable); assert.equal(f.store.commits, before);
});
test('concurrent native completions both wait for a real confirmed permission receipt', async t => {
  const f = await setup(t); await f.register(); const first = await f.prepare(), second = await f.prepare();
  let release, entered;
  const waiting = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  f.store.hook = async () => { entered(); await waiting; };
  let completed = 0;
  const a = f.authority.complete(first.body).then(value => { completed++; return value; });
  await started;
  const b = f.authority.complete(second.body).then(value => { completed++; return value; });
  await new Promise(resolve => setImmediate(resolve)); assert.equal(completed, 0);
  release(); const replies = await Promise.all([a, b]); assert(replies.every(r => r.authority.durable));
});
test('main-world discovery advertises existing-body input and owner reference reads', () => {
  const d = mainWorldAgentAffordances({ publicOrigin: 'https://game.example', applicationId, enabled: true });
  assert.equal(d.scope, 'main-world'); assert.equal(d['@id'], 'https://game.example/world/native-agents');
  assert(d.operations.some(o => o['hydra:method'] === 'GET' && o['hydra:target'].endsWith('/owner')));
  assert(!JSON.stringify(d).includes('/gaming/native-agent/')); assert.equal(d.migrationBoundaries.mainWorldServerAuthority, false);
});

test('revoked references free bounded capacity through permanent native tombstones, including after restart', async t => {
  const f = await setup(t);
  for (let i = 0; i < 520; i++) {
    const ref = referenceFor(i);
    await f.authority.register(f.owner('alice'), ref);
    await f.authority.revoke(f.owner('alice'), { grantId: ref.grantId });
    f.markPodRevoked(ref.grantId); // Explicit verified owner-head fixture publication.
  }
  assert.equal(Object.keys(f.store.value.state.value.references).length, 512);
  assert.equal(f.store.values.size, 521); assert(f.authority.status().enabled);
  const g = await setup(t, f.store);
  for (const i of [0, 255, 511, 519]) await assert.rejects(g.authority.register(g.owner('alice'), referenceFor(i)), { code: 'native_grant_unavailable' });
  assert((await g.authority.register(g.owner('alice'), referenceFor(520))).authority.durable);
});
test('legacy full reference indexes archive revoked rows before admitting a new UUID', async t => {
  const store = new Store(), references = {};
  for (let i = 0; i < 512; i++) { const ref = referenceFor(i); references[ref.grantId] = {
    ...ref, ownerPlayerId: 'alice', ownerDid: binding('alice').subjectDid, revoked: i === 0 }; }
  const legacy = createProgressiveOwnedState({ store, streamId: authorityStream });
  await legacy.start({ seed: () => ({ schema: 'hallowmarch.main-world-agent-authority/v1', references }) });
  await legacy.shutdown();
  const f = await setup(t, store); f.markPodRevoked(referenceFor(0).grantId);
  assert((await f.authority.register(f.owner('alice'), referenceFor(512))).authority.durable);
  assert.equal(Object.keys(store.value.state.value.references).length, 512);
  assert.equal((await store.load(revocationStream(referenceFor(0).grantId))).version, 1);
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(0)), { code: 'native_grant_unavailable' });
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(513)), { code: 'native_reference_capacity' });
});
test('unknown archive acknowledgement retains stopped index until its exact native tombstone is confirmed', async t => {
  const f = await setup(t), s = await f.session(); let archiveAttempts = 0;
  f.store.hook = id => { if (id === revocationStream(grantId)) { archiveAttempts++; f.store.uncertain = true; } };
  await assert.rejects(f.authority.revoke(f.owner('alice'), { grantId }));
  assert.equal(f.store.value.state.value.references[grantId].revoked, true);
  await assert.rejects(f.authority.command(f.command(s)));
  assert.throws(() => f.authority.challenge({ grantId, sessionPublicKeyJwk: s.key.publicKey.export({ format: 'jwk' }) }));
  f.store.hook = null; const g = await setup(t, f.store);
  await assert.rejects(g.register(), { code: 'native_grant_unavailable' });
  assert((await g.authority.revoke(g.owner('alice'), { grantId })).authority.durable);
  assert.equal(archiveAttempts, 1); assert.equal(g.authority.references(g.owner('alice')).length, 1);
  assert.equal(g.authority.references(g.owner('alice'))[0].revoked, true);
});
test('revocation racing a blocked durable admission cannot return a usable lease', async t => {
  const f = await setup(t); await f.register(); const prepared = await f.prepare();
  let release, entered; const waiting = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  f.store.hook = async id => { if (id === authorityStream) { entered(); await waiting; } };
  const admission = assert.rejects(f.authority.complete(prepared.body), { code: 'native_grant_unavailable' });
  await started;
  const revocation = f.authority.revoke(f.owner('alice'), { grantId });
  release(); await admission; await revocation;
  assert.equal(f.messages.filter(row => row.message.op === 'command').length, 0);
});

test('stopped grants remain discoverable after reload until actual owner-pod revocation is confirmed', async t => {
  const store = new Store(), references = {};
  for (let i = 0; i < 512; i++) { const ref = referenceFor(i); references[ref.grantId] = {
    ...ref, ownerPlayerId: 'alice', ownerDid: binding('alice').subjectDid, revoked: i === 0 }; }
  const legacy = createProgressiveOwnedState({ store, streamId: authorityStream });
  await legacy.start({ seed: () => ({ schema: 'hallowmarch.main-world-agent-authority/v1', references }) }); await legacy.shutdown();
  const f = await setup(t, store);
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(512)), { code: 'native_reference_capacity' });
  assert(f.authority.references(f.owner('alice')).some(ref => ref.grantId === referenceFor(0).grantId && ref.revoked));
  assert.equal((await store.load(revocationStream(referenceFor(0).grantId))).version, 0);
  f.markPodRevoked(referenceFor(0).grantId);
  let admitted;
  for (let attempts = 0; attempts < 512 && !admitted; attempts++) {
    try { admitted = await f.authority.register(f.owner('alice'), referenceFor(512)); }
    catch (error) { assert.equal(error.code, 'native_reference_capacity'); }
  }
  assert(admitted.authority.durable);
  // The owner's pod can later republish the old UUID as active; local retirement stays permanent.
  store.podRevocations.delete(referenceFor(0).grantId);
  const g = await setup(t, store);
  await assert.rejects(g.authority.register(g.owner('alice'), referenceFor(0)), { code: 'native_grant_unavailable' });
  assert.deepEqual(g.authority.references(g.owner('bob')), []);
});

async function fullActiveStore() {
  const store = new Store(), references = {};
  for (let i = 0; i < 512; i++) { const ref = referenceFor(i); references[ref.grantId] = {
    ...ref, ownerPlayerId: 'alice', ownerDid: binding('alice').subjectDid, revoked: false,
    verifiedGrantExpiresAt: '2026-10-16T12:30:00.000Z' }; }
  const owned = createProgressiveOwnedState({ store, streamId: authorityStream });
  await owned.start({ seed: () => ({ schema: 'hallowmarch.main-world-agent-authority/v1', references }) }); await owned.shutdown();
  return store;
}
test('natural expiry reclaims one reference only after a fresh native head and permanently retires its UUID', async t => {
  const store = await fullActiveStore(), f = await setup(t, store); f.advance(31 * 60 * 1000);
  const before = f.reads()[0];
  assert((await f.authority.register(f.owner('alice'), referenceFor(512))).authority.durable);
  assert.equal(f.reads()[0] - before, 1);
  assert.equal((await store.load(revocationStream(referenceFor(0).grantId))).version, 1);
  const g = await setup(t, store); g.transform(grant => ({ ...grant, expiresAt: '2026-10-17T12:30:00.000Z' }));
  await assert.rejects(g.authority.register(g.owner('alice'), referenceFor(0)), { code: 'native_grant_unavailable' });
});
test('a fresh extended owner head overrides an old verified expiry hint and capacity retries rotate durably', async t => {
  const store = await fullActiveStore(), f = await setup(t, store); f.advance(31 * 60 * 1000);
  f.transform(grant => ({ ...grant, expiresAt: '2026-10-17T12:30:00.000Z' }));
  const before = f.reads()[0];
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(512)), { code: 'native_reference_capacity' });
  assert.equal(f.reads()[0] - before, 1); assert.equal((await store.load(revocationStream(referenceFor(0).grantId))).version, 0);
  assert.equal(store.value.state.value.reclaimCursor, 1);
  const g = await setup(t, store); g.advance(31 * 60 * 1000);
  assert((await g.authority.register(g.owner('alice'), referenceFor(512))).authority.durable);
  assert.equal((await store.load(revocationStream(referenceFor(1).grantId))).version, 1);
});
test('an uncertain natural-expiry tombstone prevents admission through an old active index after restart', async t => {
  const store = await fullActiveStore(), f = await setup(t, store); f.advance(31 * 60 * 1000);
  store.hook = id => { if (id === revocationStream(referenceFor(0).grantId)) store.uncertain = true; };
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(512)));
  assert.equal(store.value.state.value.references[referenceFor(0).grantId].revoked, false);
  store.hook = null; const g = await setup(t, store);
  g.transform(grant => ({ ...grant, expiresAt: '2026-10-17T12:30:00.000Z' }));
  const key = generateKeyPairSync('ed25519');
  await assert.rejects(g.authority.challenge({ grantId: referenceFor(0).grantId, sessionPublicKeyJwk: key.publicKey.export({ format: 'jwk' }) }));
  assert.equal(g.reads()[0], 0);
  assert((await g.authority.register(g.owner('alice'), referenceFor(512))).authority.durable);
});
test('capacity cleanup bounds native inspection and retains one permit if a port ignores cancellation', async t => {
  const store = await fullActiveStore(), f = await setup(t, store, { requestTimeoutMs: 100 });
  let release; const waiting = new Promise(resolve => { release = resolve; });
  f.setOwnerReadHook(() => waiting);
  const before = f.reads()[0];
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(512)), { code: 'native_reference_capacity' });
  await assert.rejects(f.authority.register(f.owner('alice'), referenceFor(512)), { code: 'native_reference_capacity' });
  assert.equal(f.reads()[0] - before, 1); assert.equal(store.value.state.value.reclaimCursor, 2);
  release(); f.setOwnerReadHook(null);
});
