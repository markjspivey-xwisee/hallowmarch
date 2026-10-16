import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import * as core from '@interego/core';
import { createMainWorldAgents, WORLD_AGENT_PATHS, mainWorldAgentAffordances } from './main-world-agents.js';
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
class Store {
  owner = applicationId; value = { version: 0, state: null }; receipts = new Map(); commits = 0; hook = null; uncertain = false;
  async load() { return clone(this.value); }
  async commit(id, request) {
    if (this.receipts.has(request.idempotencyKey)) return clone(this.receipts.get(request.idempotencyKey));
    this.commits++; await this.hook?.();
    if (request.expectedVersion !== this.value.version) throw Object.assign(new Error('fixture CAS conflict'), { code: 'VERSION_CONFLICT' });
    this.value = { version: this.value.version + 1, state: clone(request.state) };
    this.receipts.set(request.idempotencyKey, clone(this.value));
    if (this.uncertain) { this.uncertain = false; throw new Error('fixture lost native ACK'); }
    return clone(this.value);
  }
}
async function setup(t, existingStore = null) {
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
  let transform = x => x;
  const grant = () => transform({ schema: 'interego.gaming.owner-agent-grant/v1', id: grantId, issuer: binding('alice').subjectDid,
    actor, applicationId, audience: 'https://game.example', roomId: 'march', entityId: 'alice', role: 'teammate',
    actions: ['observe', 'move', 'attack'], maxCommandsPerSecond: 20, revoked: false,
    notBefore: '2026-10-16T11:59:59.000Z', expiresAt: '2026-10-16T12:30:00.000Z' });
  const authority = await createMainWorldAgents({ store, accounts, applicationId, audience: 'https://game.example', nativeCore: core,
    now: () => at, ...transport,
    readOwnerGrantHead: async () => { ownerReads++; return { grant: grant(), ownerPodUrl: binding('alice').podUrl,
      descriptorUrl: binding('alice').podUrl + 'context-graphs/head.ttl', graphIri, cid: 'bafy-explicit-fixture', contentDigest: 'a'.repeat(64), observedAt: at }; },
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
    now: () => at, advance: ms => { at += ms; }, reads: () => [ownerReads, agentReads], transform: fn => { transform = fn; } };
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
