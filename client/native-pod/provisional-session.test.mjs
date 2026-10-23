import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createProvisionalPlayerSession } from './provisional-session.mjs';

const NOW = Date.now(), origin = 'https://game.example', relayUrl = 'https://relay.example';
const guest = { subjectDid: 'did:web:identity.example:users:u-try-play-one', podUrl: 'https://pod.example/u-try-play-one/' };
const owner = { subjectDid: 'did:web:identity.example:users:alice', podUrl: 'https://pod.example/alice/', userId: 'u-pk-alice' };
const clone = value => structuredClone(value);
function fixture() {
  let metadata = null, finalizeLost = false, failReadback = false, quota = false, persistenceFails = false;
  const records = new Map(), credentials = new Map(), calls = [], requests = [], sessions = [];
  const device = { async peekMetadata() { return clone(metadata); },
    async publicDescription() { return { publicKeyJwk: { kty: 'EC', crv: 'P-256', x: 'x'.repeat(43), y: 'y'.repeat(43) }, proofKeyThumbprint: 't'.repeat(43) }; },
    async remember(value) { if (persistenceFails) throw Error('browser transaction failed'); metadata = clone(value); return clone(metadata); },
    async signBootstrap() { return 'browser-native-grant-proof'; }, async signProof(value) { calls.push({ op: 'proof', ...value }); return 'browser-key-proof'; }, close() {} };
  const cache = { async put(value) { credentials.set(value.ownerDid, clone(value)); },
    async get(value) { return clone(credentials.get(value.ownerDid) || null); }, close() {} };
  const createProfile = options => {
    let read = false, key = records.has(options.binding.subjectDid), closed = false;
    const id = options.binding.subjectDid;
    return { async connect() { calls.push({ op: 'connect', id }); },
      async reauthenticate() { calls.push({ op: 'reauthenticate', id }); },
      async get() { calls.push({ op: 'get', id }); read = true; const found = records.get(id);
        const data = found ? clone(found.save) : null;
        if (failReadback && id === owner.subjectDid && found && data.char) data.char.name = 'corrupted';
        return { exists: !!found, data: () => clone(data) }; },
      async createKey() { assert(read); assert(!records.has(id)); key = true; calls.push({ op: 'createKey', id }); },
      async set(value) { assert(!closed); assert(read); assert(key); if (quota && id === guest.subjectDid) throw Object.assign(Error('quota'), { code: 'guest_quota_exhausted' });
        calls.push({ op: 'set', id, save: clone(value), deferred: options.deferRelationship });
        records.set(id, { save: clone(value), revision: (records.get(id)?.revision || 0) + 1 }); },
      async confirmRelationship() { calls.push({ op: 'link', id }); },
      reference() { const found = records.get(id); return found ? { kind: 'character', graphIri: 'urn:graph:fixture:' + id.split(':').at(-1),
        descriptorUrl: options.binding.podUrl + 'context-graphs/binding.ttl', cid: 'sha256:' + 'c'.repeat(64), bindingCid: 'sha256:' + 'c'.repeat(64),
        nativeRevision: 'sha256:' + found.revision.toString(16).padStart(64, '0'), recordCid: 'graph-nquads-sha256:' + 'd'.repeat(64), digest: 'graph-nquads-sha256:' + 'd'.repeat(64),
        proofKind: 'owner-key-authenticated-checkpoint' } : null; },
      async retry() {}, status() { return { keyPresent: key, pending: false }; }, close() { closed = true; } };
  };
  const request = async (path, options) => {
    requests.push({ path, ...clone(options) });
    assert(!JSON.stringify(options).includes('identity-native-token-secret'));
    assert(!JSON.stringify(options).includes('relay-access-token-secret'));
    if (path.endsWith('/play/challenge')) return { playGrant: { _signed_payload: 'payload', _signature: 'native-signature' },
      challenge: 'game-challenge', issuer: 'https://identity.example', relayUrl, audience: origin, provisionalEndpoint: 'https://identity.example/play/provisional' };
    if (path.endsWith('/play/complete')) return { binding: guest, appSession: { token: 'guest-game-session' }, provisional: true };
    if (path.endsWith('/play/claim-challenge')) return { audience: origin, challenge: 'claim-start-challenge' };
    if (path.endsWith('/claim-owner/start')) return { authorizationUrl: 'https://identity.example/authorize', browserCeremony: 'popup' };
    if (path.endsWith('/play/claim-complete')) {
      assert.equal(options.body.readConfirmed, true); assert(options.body.targetRecord.nativeRevision);
      assert(!JSON.stringify(options.body).includes('private hero'));
      if (finalizeLost) { finalizeLost = false; throw Error('lost final response'); }
      return { binding: owner, appSession: { token: 'canonical-game-session' } };
    }
    throw Error(path);
  };
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body); calls.push({ op: 'nativePost', url, body });
    const data = url.endsWith('/exchange') ? { access_token: 'relay-access-token-secret', token_type: 'Bearer', expiresAt: new Date(NOW + 3600000).toISOString() } :
      { token: 'identity-native-token-secret', did: guest.subjectDid, podUrl: guest.podUrl, userId: 'u-try-play-one', provisional: true,
        proofKeyThumbprint: 't'.repeat(43), attestation: 'public-attestation', guestExpiresAt: new Date(NOW + 86400000).toISOString(), expiresAt: new Date(NOW + 3600000).toISOString() };
    assert.equal(options.credentials, 'omit'); return new Response(JSON.stringify(data), { status: 200 });
  };
  const make = async extra => createProvisionalPlayerSession({ origin, relayUrl, request, fetch, crypto: webcrypto, now: () => NOW,
    device, accessCache: cache, createProfile, onSession: async result => { sessions.push(result); }, ...extra });
  const target = () => ({ binding: owner, nativeSession: { accessToken: 'canonical-relay-secret', tokenType: 'Bearer',
    mcpUrl: relayUrl + '/mcp', expiresAt: NOW + 3600000 }, appSession: { purpose: 'character-claim-target',
      claimOperationId: 'claim-operation-one', guestOwnerDid: guest.subjectDid, targetOwnerDid: owner.subjectDid,
      audience: origin, sourceChallenge: 'claim-completion-challenge', expiresAt: NOW + 600000 } });
  return { make, target, device, records, requests, calls, sessions, credentials,
    get metadata() { return clone(metadata); }, loseFinalize() { finalizeLost = true; }, corruptReadback() { failReadback = true; },
    exhaustQuota() { quota = true; }, failPersistence() { persistenceFails = true; } };
}
test('first Play confirms a private checkpoint; reload resumes it without provisioning or credential disclosure', async () => {
  const f = fixture(), session = await f.make();
  assert.equal(await session.peek(), null); assert.equal(f.calls.length, 0);
  await session.bootstrap(); assert.equal(session.status().provisional, true);
  assert.equal(f.records.get(guest.subjectDid).save.char, null);
  await session.set({ v: 1, char: { name: 'private hero', level: 4 } });
  const savedId = session.status().characterId;
  const next = await f.make(); await next.resume({ binding: guest });
  assert.equal((await next.get()).data().char.level, 4); assert.equal(next.status().characterId, savedId);
  assert.equal(f.requests.filter(call => call.path.endsWith('/play/challenge')).length, 1);
  assert(!JSON.stringify(f.metadata).includes('private hero'));
  await next.resume({ binding: guest, requireGameSession: true });
  assert.equal(f.requests.filter(call => call.path.endsWith('/play/challenge')).length, 2);
  assert(f.calls.some(call => call.op === 'reauthenticate'));
});
test('OAuth reload recovers staged sealed target credential and durable own-pod claim intent', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } });
  await session.prepareClaim(); const intent = f.records.get(guest.subjectDid).save.nativePlay.claim.intentId;
  const popup = await f.make(); await popup.stageClaimTarget(f.target());
  assert(!JSON.stringify(f.metadata).includes('canonical-relay-secret'));
  assert.equal(f.credentials.get(owner.subjectDid).credential.accessToken, 'canonical-relay-secret');
  const reloaded = await f.make(); await reloaded.resume({ binding: guest }); const result = await reloaded.resumeClaim();
  assert.equal(result.claimed, true); assert.equal(reloaded.status().provisional, false);
  assert.equal(f.records.get(owner.subjectDid).save.nativePlay.claim.intentId, intent);
  assert.equal(f.records.get(owner.subjectDid).save.nativePlay.characterId, f.records.get(guest.subjectDid).save.nativePlay.characterId);
  assert.equal(f.records.get(owner.subjectDid).save.char.level, 5);
  assert.equal(f.calls.filter(call => call.op === 'set' && call.id === owner.subjectDid).length, 1);
  assert.equal(f.requests.at(-1).body.selection, 'copy-guest');
  const targetWrites = f.calls.filter(call => call.op === 'set' && call.id === owner.subjectDid);
  assert(targetWrites.every(call => call.deferred));
  const canonicalBoot = await f.make(); await canonicalBoot.peek();
  assert.equal(canonicalBoot.status().provisional, false, 'durable claimed metadata cannot relabel a returning canonical owner as guest');
});
test('existing owner is an explicit conflict and use-existing never copies over either private character', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  f.records.set(owner.subjectDid, { save: { v: 1, char: { name: 'older canonical hero', level: 20 } }, revision: 1 });
  const result = await session.claimTarget(f.target()); assert.equal(result.conflict, true);
  assert.equal(session.status().provisional, true); assert.equal(f.records.get(owner.subjectDid).save.char.level, 20);
  assert.equal(f.calls.filter(call => call.op === 'set' && call.id === owner.subjectDid).length, 0);
  const source = clone(f.records.get(guest.subjectDid));
  const chosen = await session.useExistingTarget(); assert.equal(chosen.claimed, true);
  assert.deepEqual(f.records.get(guest.subjectDid), source); assert.equal((await session.get()).data().char.level, 20);
  assert.equal(f.requests.at(-1).body.selection, 'use-existing');
});
test('canonical-token reload reads pending guest source without game re-admission or source relationship writes', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  await session.stageClaimTarget(f.target());
  const next = await f.make();
  assert.equal((await next.peek()).targetOwnerDid, owner.subjectDid);
  const resumed = await next.resume({ binding: owner, recoverPendingClaim: true, requireGameSession: true });
  assert.equal(resumed.pendingClaimResume, true);
  assert.equal(f.requests.filter(call => call.path.endsWith('/play/challenge')).length, 1);
  const count = f.calls.length; await next.resumeClaim();
  assert(f.calls.slice(count).filter(call => call.op === 'set' && call.id === guest.subjectDid).every(call => call.deferred));
});
test('unconfirmed canonical readback never finalizes or changes the guest save target', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); f.corruptReadback();
  await assert.rejects(session.claimTarget(f.target()), { code: 'claim_readback_failed' });
  assert.equal(session.status().provisional, true);
  assert.equal(f.requests.filter(call => call.path.endsWith('/claim-complete')).length, 0);
  assert.equal(f.records.get(guest.subjectDid).save.char.level, 5);
});
test('lost completion acknowledgement reload reuses the same owner copy and exact source intent', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); f.loseFinalize();
  await assert.rejects(session.claimTarget(f.target()), /lost final response/);
  assert.equal(session.status().provisional, true);
  const next = await f.make(); await next.resume({ binding: guest }); await next.resumeClaim();
  assert.equal(f.calls.filter(call => call.op === 'set' && call.id === owner.subjectDid).length, 1);
  assert.equal(next.status().provisional, false);
});
test('quota refusal preserves the previous durable checkpoint and does not provision another owner', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 2 } }); f.exhaustQuota();
  await assert.rejects(session.set({ v: 1, char: { name: 'private hero', level: 3 } }), { code: 'guest_quota_exhausted' });
  assert.equal(session.status().quota, true); assert.equal(f.records.get(guest.subjectDid).save.char.level, 2);
  assert.equal(f.requests.filter(call => call.path.endsWith('/play/challenge')).length, 1);
});
test('explicit last-confirmed claim works at hard quota without another guest write', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 2 } }); f.exhaustQuota();
  await assert.rejects(session.set({ v: 1, char: { name: 'private hero', level: 3 } }), { code: 'guest_quota_exhausted' });
  await assert.rejects(session.prepareClaim(), { code: 'guest_quota_exhausted' });
  const count = f.calls.filter(call => call.op === 'set' && call.id === guest.subjectDid).length;
  await session.prepareClaim({ lastConfirmed: true });
  const result = await session.claimTarget(f.target()); assert.equal(result.claimed, true);
  assert.equal(f.records.get(owner.subjectDid).save.char.level, 2);
  assert.equal(f.calls.filter(call => call.op === 'set' && call.id === guest.subjectDid).length, count);
});
test('lost completion plus continued progress retries original receipt before canonical CAS of latest progress', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); f.loseFinalize();
  await assert.rejects(session.claimTarget(f.target()), /lost final response/);
  const originalReceipt = clone(f.requests.at(-1).body.targetRecord);
  await session.set({ v: 1, char: { name: 'private hero', level: 6 } });
  const next = await f.make(); await next.resume({ binding: guest }); await next.resumeClaim();
  const finalizations = f.requests.filter(call => call.path.endsWith('/claim-complete'));
  assert.deepEqual(finalizations[1].body.targetRecord, originalReceipt);
  assert.equal(f.records.get(owner.subjectDid).save.char.level, 6);
  assert.equal(f.calls.filter(call => call.op === 'set' && call.id === owner.subjectDid).length, 2);
});
test('local metadata failure after acknowledged promotion retains canonical active save target', async () => {
  const f = fixture(); let session;
  session = await f.make({ onSession: async result => { if (result.binding.subjectDid === owner.subjectDid) f.failPersistence(); } });
  await session.bootstrap(); await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const result = await session.claimTarget(f.target());
  assert.equal(result.claimed, true); assert.equal(result.localPersistencePending, true); assert.equal(session.status().provisional, false);
  await session.set({ v: 1, char: { name: 'private hero', level: 6 } });
  assert.equal(f.records.get(owner.subjectDid).save.char.level, 6); assert.equal(f.records.get(guest.subjectDid).save.char.level, 5);
});
test('acknowledged canonical promotion remains active when local connection fails and retrySession retries only local confirmation', async () => {
  const f = fixture(); let refuseCanonical = true;
  const session = await f.make({ onSession: async result => {
    if (result.binding.subjectDid === owner.subjectDid && refuseCanonical) throw Error('game reconnect pending');
  } });
  await session.bootstrap(); await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const first = await session.claimTarget(f.target());
  assert.equal(first.claimed, true); assert.equal(first.localSessionPending, true); assert.equal(session.status().provisional, false);
  const stillPending = await session.retrySession(); assert.equal(stillPending.claimed, true); assert.equal(stillPending.localSessionPending, true);
  refuseCanonical = false;
  const confirmed = await session.retrySession(); assert.equal(confirmed.localSessionPending, false); assert(confirmed.profile);
  assert.equal(f.requests.filter(call => call.path.endsWith('/claim-complete')).length, 1);
});
