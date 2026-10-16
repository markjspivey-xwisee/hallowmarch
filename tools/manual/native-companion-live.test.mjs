import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { createGamingRuntime } from '../../server/gaming/runtime.js';
import { createHallowmarchDomain } from '../../server/gaming/hallowmarch.js';
import { createNativeAgentAuthority, NATIVE_AGENT_PATHS } from '../../server/gaming/native-agent-authority.js';
import { nativeAgentAffordances } from '../../server/gaming/native-agent-http.js';
import { createNativeCompanionLiveQa } from './native-companion-live.mjs';

// No network or native writes. The real game authority and Ed25519 verifier run
// against synthetic native owner/grant ports. With the reviewed SDK configured,
// the signing callback also creates real secp256k1 native request signatures.
const sdk = process.env.INTEREGO_SDK_TEST_ROOT ? await import(pathToFileURL(resolve(process.env.INTEREGO_SDK_TEST_ROOT, 'packages/core/dist/index.js'))) : null;
const wallet = sdk ? await sdk.createWallet('agent', 'manual-companion-fixture') : null;
const signerDid = wallet ? 'did:ethr:' + wallet.address.toLowerCase() : 'did:ethr:0x' + '1'.repeat(40);
const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const agentDid = 'did:web:identity.example:agents:existing-root-agent', agentPodUrl = 'https://pods.example/root-owner/';
const applicationId = 'did:web:identity.example:users:game';
const owner = { accountId: 'qa_account', subjectDid: 'did:web:identity.example:users:qa-owner', podUrl: 'https://pods.example/qa-owner/' };
const binding = { subjectDid: owner.subjectDid, podUrl: owner.podUrl, webId: 'https://identity.example/users/qa-owner/profile#me', userId: 'qa-owner' };
const ref = { grantId: 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41', graphIri: 'urn:graph:interego:gaming:owner-agent-grant:1647775c-22c7-4a79-8a45-d55cfe101b41' };
class Store {
  value = { version: 0, state: null };
  async load() { return structuredClone(this.value); }
  async commit(id, request) {
    assert.equal(request.expectedVersion, this.value.version);
    this.value = { version: this.value.version + 1, state: structuredClone(request.state) }; return this.load();
  }
}
async function fixture(t, options = {}) {
  let clock = Date.now(), grant = null, body = null, publishPending = options.publishPending, lostComplete = options.lostComplete, lostCommand = options.lostCommand;
  const count = { spawn: 0, publish: 0, confirm: 0, register: 0, localRevoke: 0, podRevoke: 0, sign: 0, complete: 0, ownerReads: 0, agentReads: 0, command: 0 };
  const store = new Store(), principal = { playerId: owner.accountId, verifiedDid: owner.subjectDid, realmId: '0', name: 'QA Owner' };
  const gaming = createGamingRuntime({ store, roomId: 'room-qa', send() {}, domain: createHallowmarchDomain(), clock: () => clock }); await gaming.ready;
  let foreignBefore = null;
  if (options.retainedForeignPlayer) {
    await gaming.room.execute({ playerId: 'retained-foreign-player', realmId: '1', name: 'Other player' }, { type: 'join', commandId: 'prior-player-join' });
    foreignBefore = structuredClone(store.value.state.entities['retained-foreign-player']);
  }
  const authority = createNativeAgentAuthority({ gaming, accounts: { bindingForAccount: id => id === owner.accountId ? binding : null },
    applicationId, audience: gameOrigin, now: () => clock, nativeCore: sdk || { recoverMessageSigner: () => signerDid.slice('did:ethr:'.length) },
    readOwnerGrantHead: async () => {
      count.ownerReads++; return { grant: structuredClone(grant), ownerPodUrl: owner.podUrl, descriptorUrl: owner.podUrl + 'context-graphs/grant.ttl',
        graphIri: ref.graphIri, cid: 'bafy-fixture', contentDigest: 'a'.repeat(64), observedAt: clock };
    }, resolveAgentProof: async () => { count.agentReads++; return { agentDid, podUrl: agentPodUrl, mode: 'relay-mediated', signerDid, observedAt: clock, expiresAt: clock + 300000 }; } });
  const receipt = () => ({ visibility: 'public', ownerDid: owner.subjectDid, ownerPodUrl: owner.podUrl,
    authorship: { verified: true, authority: 'relay-attestation' }, cid: 'bafy-fixture' });
  const ownerPort = {
    async enterAndSpawn() {
      if (body) return body;
      const entered = await gaming.room.execute(principal, { type: 'join', commandId: 'qa-join' });
      const spawned = await gaming.room.execute(principal, { type: 'spawnCompanion', commandId: 'qa-spawn', roomId: entered.roomId }); count.spawn++;
      const entity = gaming.room.current.entities[spawned.result.entityId];
      body = { accountId: owner.accountId, roomId: entered.roomId, entityId: entity.id, x: entity.x, z: entity.z }; return body;
    },
    async publish() {
      if (!grant) {
        count.publish++; grant = { schema: 'interego.gaming.owner-agent-grant/v1', id: ref.grantId, issuer: owner.subjectDid, actor: agentDid,
          applicationId, audience: gameOrigin, roomId: body.roomId, entityId: body.entityId, role: 'pet', actions: ['observe', 'move'],
          maxCommandsPerSecond: 5, revoked: false, notBefore: new Date(clock).toISOString(), expiresAt: new Date(clock + 900000).toISOString() };
      } else count.confirm++;
      if (publishPending) { publishPending = false; return { saved: false, reference: ref, operationId: 'existing-publication' }; }
      return { saved: true, reference: ref };
    },
    async readback() { return { reference: ref, grant: structuredClone(grant), receipt: receipt() }; },
    async register() { count.register++; return authority.register({ accountId: owner.accountId, binding }, ref); },
    async localRevoke() { count.localRevoke++; return authority.revoke({ accountId: owner.accountId, binding }, { grantId: ref.grantId }); },
    async ownerPodRevoke() { count.podRevoke++; grant.revoked = true; return { revoked: true, reference: ref, receipt: receipt() }; },
  };
  const description = nativeAgentAffordances({ publicOrigin: gameOrigin, applicationId, enabled: true });
  description.proof.counterObservationAdvertised = true;
  options.mutateDescription?.(description);
  const manifest = { enabled: true, roomId: 'room-qa', nativeAgents: { enabled: true, applicationId, audience: gameOrigin,
    affordances: gameOrigin + '/gaming/native-agents', leaseMs: 10000, nativeReadScope: 'owner-grant-and-agent-proof-control-plane', nativePublication: { verified: true } } };
  const calls = [];
  const request = async (url, init) => {
    calls.push({ url, method: init.method }); assert(!init.headers.Authorization && !init.headers.authorization);
    if (url === gameOrigin + '/gaming/manifest') return Response.json(manifest);
    if (url === gameOrigin + '/gaming/native-agents') return Response.json(description);
    const name = Object.keys(NATIVE_AGENT_PATHS).find(name => url === gameOrigin + NATIVE_AGENT_PATHS[name]); assert(name, 'discovered route only');
    if (name === 'challenge' && count.localRevoke && options.revocationOutage) return Response.json({ error: 'native_agent_unavailable' }, { status: options.revocationOutage });
    try {
      const payload = JSON.parse(init.body);
      if (name === 'complete') count.complete++;
      if (name === 'command') count.command++;
      const injected = options.httpResponse?.(name); if (injected) return injected;
      const result = await authority[name](payload);
      if (name === 'complete' && lostComplete) { lostComplete = false; throw Object.assign(new Error('fixture lost ack'), { uncertain: true }); }
      if (name === 'command' && result.ok && lostCommand) { lostCommand = false; throw Object.assign(new Error('fixture lost ack'), { uncertain: true }); }
      return Response.json({ ok: true, result });
    } catch (error) { if (error.uncertain) throw error; return Response.json({ error: error.code || 'fixture_refused' }, { status: 403 }); }
  };
  const signNativeRequest = async ({ payload }) => {
    count.sign++; clock += 1000;
    const _signed_payload = JSON.stringify({ ...payload, agent_id: agentDid, subject_pod_url: agentPodUrl, timestamp: new Date(clock).toISOString() });
    return { _signed_payload, _signature: sdk ? await sdk.signMessageRaw(wallet, 'sha256:' + createHash('sha256').update(_signed_payload).digest('hex')) : '0x' + 'ab'.repeat(65) };
  };
  const qa = createNativeCompanionLiveQa({ enabled: true, gameOrigin, relayOrigin, expectedOwner: owner, agentDid, agentPodUrl, ownerPort,
    signNativeRequest, request, now: () => clock, readProofCounters: async () => count.ownerReads + count.agentReads });
  t.after(async () => { qa.close(); authority.close(); await gaming.shutdown(); });
  return { qa, count, store, calls, authority, gaming, foreignBefore, body: () => body, advance(ms) { clock += ms; } };
}
test('manual scenario runs actual authority with signature/negative/revocation checks and zero proof reads for fast commands', async t => {
  const f = await fixture(t); const result = await f.qa.remaining(), report = f.qa.status();
  assert(result.complete); assert(report.fastCommandAccepted && report.renewed && report.observed && report.localRevoked && report.ownerPodRevoked);
  assert.deepEqual(report.negative, ['forged-action', 'forbidden-scope', 'wrong-room', 'expired-command', 'replay', 'after-local-revoke']);
  assert(report.nativeCounterMeasured); assert.equal(report.freshnessIsPlayerPing, false); assert.equal(report.advertisedLeaseMs, 10000);
  assert.equal(f.count.ownerReads, 3); assert.equal(f.count.agentReads, 2); assert.equal(f.count.spawn, 1); assert.equal(f.count.publish, 1); assert.equal(f.count.sign, 1);
  assert.equal(f.gaming.room.current.entities[f.body().entityId].x, f.body().x + 0.1);
  const outward = JSON.stringify(report);
  for (const denied of ['accessToken', 'refreshToken', 'privateKey', '_signed_payload', '_signature', 'hmca_']) assert(!outward.includes(denied));
});
test('the complete native companion scenario leaves a previously durable foreign player unchanged', async t => {
  const f = await fixture(t, { retainedForeignPlayer: true }); await f.qa.remaining();
  assert.equal(f.qa.status().complete, true);
  assert.deepEqual(f.gaming.room.current.entities['retained-foreign-player'], f.foreignBefore);
  assert.deepEqual(f.store.value.state.entities['retained-foreign-player'], f.foreignBefore);
  const companion = f.gaming.room.current.entities[f.body().entityId];
  assert.equal(companion.ownerPlayerId, owner.accountId); assert.equal(companion.x, f.body().x + 0.1);
  const moves = f.store.value.state.events.filter(event => event.kind === 'movement.applied');
  assert.equal(moves.length, 1); assert.equal(moves[0].payload.entityId, f.body().entityId);
  assert.equal(f.store.value.state.events.some(event => ['damage', 'loot.granted', 'encounter.started', 'entity.recovered'].includes(event.kind)), false);
});
test('an actual public proof expiry code is retained without replaying uncertain admission', async t => {
  const f = await fixture(t, { httpResponse: name => name === 'complete'
    ? Response.json({ error: 'native_admission_expired' }, { status: 403 }) : null });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_http_refused' });
  const report = f.qa.status();
  assert.equal(report.compoundStep, 'native-admission'); assert.equal(report.lastHttpStatus, 403);
  assert.equal(report.lastHttpCode, 'native_admission_expired'); assert.equal(f.count.complete, 1);
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_admission_uncertain' });
  assert.equal(f.count.complete, 1); assert.equal(f.count.publish, 1); assert.equal(f.count.spawn, 1);
});
test('unknown and malicious HTTP errors cannot enter retained diagnostics', async t => {
  for (const error of ['https://private.example/?token=DO_NOT_CAPTURE', 'native_admission_expired\nDO_NOT_CAPTURE',
    { code: 'native_admission_expired', privateKey: 'DO_NOT_CAPTURE' }, ['stale_native_proof'], null]) {
    const f = await fixture(t, { httpResponse: name => name === 'complete'
      ? Response.json({ error, message: 'DO_NOT_CAPTURE', token: 'DO_NOT_CAPTURE' }, { status: 503 }) : null });
    await assert.rejects(f.qa.remaining(), { code: 'qa_companion_http_refused' });
    const report = f.qa.status(); assert.equal(report.lastHttpStatus, 503); assert.equal(report.lastHttpCode, null);
    assert.equal(JSON.stringify(report).includes('DO_NOT_CAPTURE'), false);
    assert.equal(f.count.complete, 1);
  }
});
test('an unreadable HTTP response retains its numeric status without retaining the body', async t => {
  const f = await fixture(t, { httpResponse: name => name === 'complete' ? new Response('DO_NOT_CAPTURE', { status: 502 }) : null });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_response' });
  assert.equal(f.qa.status().lastHttpStatus, 502); assert.equal(f.qa.status().lastHttpCode, null);
  assert.equal(JSON.stringify(f.qa.status()).includes('DO_NOT_CAPTURE'), false);
});
test('uncertain publication retains stage cursor and original owner body/scope without re-running completed stages', async t => {
  const f = await fixture(t, { publishPending: true });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_public_readback' });
  assert.equal(f.qa.status().stage, 'native-companion-public-grant'); assert.equal(f.count.spawn, 1); assert.equal(f.count.publish, 1);
  await f.qa.remaining(); assert(f.qa.status().complete); assert.equal(f.count.spawn, 1); assert.equal(f.count.publish, 1); assert.equal(f.count.confirm, 1);
  assert.equal(f.calls.filter(call => call.url.endsWith('/gaming/manifest')).length, 1);
});
test('an uncertain native completion is never replayed automatically; manual admission reset preserves public grant and command identity', async t => {
  const f = await fixture(t, { lostComplete: true });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_http_uncertain' });
  assert.equal(f.count.complete, 1); assert.equal(f.qa.status().stage, 'native-companion-proof-and-commands');
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_admission_uncertain' }); assert.equal(f.count.complete, 1);
  f.qa.restartAdmission(); await f.qa.remaining();
  assert(f.qa.status().complete); assert.equal(f.count.complete, 2); assert.equal(f.count.publish, 1); assert.equal(f.count.spawn, 1);
});
test('an uncertain applied command requires explicit admission reset and reuses domain idempotency rather than moving twice', async t => {
  const f = await fixture(t, { lostCommand: true });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_http_uncertain' });
  const once = f.gaming.room.current.entities[f.body().entityId].x;
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_http_refused' });
  f.qa.restartAdmission(); await f.qa.remaining();
  assert(f.qa.status().complete); assert.equal(f.gaming.room.current.entities[f.body().entityId].x, once);
  assert.equal(f.count.publish, 1); assert.equal(f.count.spawn, 1);
});
test('a replaced native target origin is refused before owner mutation or native signing', async t => {
  const f = await fixture(t, { mutateDescription: doc => { doc.operations[0]['hydra:target'] = 'https://evil.example/grant'; } });
  await assert.rejects(f.qa.remaining(), { code: 'qa_companion_description' });
  assert.equal(f.count.spawn, 0); assert.equal(f.count.publish, 0); assert.equal(f.count.sign, 0); assert.equal(f.calls.length, 2);
});
test('closing after discovery prevents all later owner mutations even through retained next/remaining functions', async t => {
  const f = await fixture(t); await f.qa.next(); f.qa.close(); const before = { ...f.count };
  assert.throws(() => f.qa.next(), { code: 'qa_companion_closed' });
  assert.throws(() => f.qa.remaining(), { code: 'qa_companion_closed' }); assert.deepEqual(f.count, before);
});
test('unrelated rate limits and service outages cannot pass a UUID revocation check', async t => {
  for (const status of [429, 503]) {
    const f = await fixture(t, { revocationOutage: status });
    await assert.rejects(f.qa.remaining(), { code: 'qa_companion_revocation_failed' });
    assert.equal(f.qa.status().stage, 'native-companion-local-revocation'); assert(!f.qa.status().negative.includes('after-local-revoke'));
  }
});
