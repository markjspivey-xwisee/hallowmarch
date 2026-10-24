import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createProvisionalPlayerSession } from './provisional-session.mjs';

const NOW = Date.now(), origin = 'https://game.example', relayUrl = 'https://relay.example';
const guest = { subjectDid: 'did:web:identity.example:users:u-try-play-one', podUrl: 'https://pod.example/u-try-play-one/' };
const owner = { subjectDid: 'did:web:identity.example:users:alice', podUrl: 'https://pod.example/alice/', userId: 'u-pk-alice' };
const clone = value => structuredClone(value);
function fixture() {
  let metadata = null, finalizeLost = false, failReadback = false, quota = false, persistenceFails = false, completionBinding = owner, clock = NOW;
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
    if (path.endsWith('/play/claim-recovery-challenge')) return { audience: origin, challenge: 'r'.repeat(43), expiresAt: clock + 120000 };
    if (path.endsWith('/play/claim-complete')) {
      assert.equal(options.body.readConfirmed, true); assert(options.body.targetRecord.nativeRevision);
      assert(!JSON.stringify(options.body).includes('private hero'));
      if (finalizeLost) { finalizeLost = false; throw Error('lost final response'); }
      return { binding: completionBinding, appSession: { token: 'canonical-game-session' } };
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
  const make = async extra => { if (extra?.now) clock = extra.now(); return createProvisionalPlayerSession({ origin, relayUrl, request, fetch, crypto: webcrypto, now: () => clock,
    device, accessCache: cache, createProfile, onSession: async result => { sessions.push(result); }, ...extra }); };
  const target = (binding = owner) => { completionBinding = binding; return { binding, nativeSession: { accessToken: 'canonical-relay-secret', tokenType: 'Bearer',
    mcpUrl: relayUrl + '/mcp', expiresAt: NOW + 3600000 }, appSession: { purpose: 'character-claim-target',
      claimOperationId: 'claim-operation-one', guestOwnerDid: guest.subjectDid, targetOwnerDid: binding.subjectDid,
      audience: origin, sourceChallenge: 'claim-completion-challenge', expiresAt: NOW + 600000 } }; };
  return { make, target, device, records, requests, calls, sessions, credentials, nativeFetch: fetch,
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
test('failed first relay exchange reload retries incomplete bootstrap with the same browser key, owner, pod and deadline', async () => {
  const f = fixture(); let refuseExchange = true;
  const first = await f.make({ fetch: async (url, options) => {
    if (refuseExchange && url.endsWith('/exchange')) { refuseExchange = false; return Response.json({ error: 'native_unavailable' }, { status: 503 }); }
    return f.nativeFetch(url, options);
  } });
  await assert.rejects(first.bootstrap(), { code: 'native_unavailable' });
  const prior = f.metadata, key = await f.device.publicDescription();
  assert(prior.ownerDid); assert.equal(prior.gameAdmitted, undefined); assert.equal(prior.characterId, undefined);
  assert.equal(f.sessions.length, 0); assert.equal(f.records.size, 0);
  const next = await f.make(); await next.resume({ requireGameSession: true });
  const challenges = f.requests.filter(call => call.path.endsWith('/play/challenge'));
  assert.equal(challenges[0].bootstrapRecovery, false); assert.equal(challenges[1].bootstrapRecovery, true);
  assert.deepEqual(challenges[0].body.publicKeyJwk, challenges[1].body.publicKeyJwk);
  assert.equal(f.metadata.ownerDid, prior.ownerDid); assert.equal(f.metadata.podUrl, prior.podUrl);
  assert.equal(f.metadata.guestExpiresAt, prior.guestExpiresAt); assert.equal(f.metadata.gameAdmitted, true);
  assert.deepEqual(await f.device.publicDescription(), key); assert.equal(f.records.size, 1);
  assert.equal((await next.get()).exists, true); assert.equal(next.status().provisional, true);
  await next.resume({ requireGameSession: true });
  assert.equal(f.requests.filter(call => call.path.endsWith('/play/challenge')).at(-1).bootstrapRecovery, false,
    'admitted characters cannot request disposable bootstrap transport recovery');
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
test('same-DID passkey enrollment promotes the exact existing pod pointer without copying or replacing its key', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const original = clone(f.records.get(guest.subjectDid)), reference = session.profile().reference();
  assert.equal(original.save.nativePlay.claim.phase, 'prepared');
  assert.equal(original.save.nativePlay.claim.targetOwnerDid, undefined);
  const enrolled = { ...guest, userId: 'u-try-play-one' }, handoff = f.target(enrolled);
  handoff.appSession.existingRecord = Object.fromEntries(['kind', 'graphIri', 'descriptorUrl', 'cid'].map(key => [key, reference[key]]));
  const count = f.calls.length, result = await session.claimTarget(handoff);
  assert.equal(result.claimed, true); assert.equal(session.status().provisional, false);
  assert.equal(session.status().ownerDid, guest.subjectDid);
  assert.deepEqual(f.records.get(guest.subjectDid), original); assert.equal(f.records.size, 1);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
  assert.deepEqual(f.requests.at(-1).body.targetRecord, reference);
  assert.equal(f.credentials.get(guest.subjectDid).credential.method, 'webauthn');
});
test('same-DID enrollment refuses a different latest native character without writing or finalizing', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const changed = clone(f.records.get(guest.subjectDid)); changed.save.char.level = 6; changed.revision++;
  f.records.set(guest.subjectDid, changed);
  const count = f.calls.length;
  await assert.rejects(session.claimTarget(f.target({ ...guest, userId: 'u-try-play-one' })), { code: 'claim_readback_failed' });
  assert.equal(session.status().provisional, true); assert.deepEqual(f.records.get(guest.subjectDid), changed);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
  assert.equal(f.requests.filter(call => call.path.endsWith('/claim-complete')).length, 0);
});
test('same-pod lost completion retains original public receipt and later progress through reload without private rewrites', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const handoff = f.target({ ...guest, userId: 'u-try-play-one' });
  f.loseFinalize(); await assert.rejects(session.claimTarget(handoff), /lost final response/);
  const original = clone(f.requests.at(-1).body.targetRecord);
  assert.deepEqual(f.metadata.targetClaim.confirmation.targetRecord, original);
  assert(!JSON.stringify(f.metadata).includes('private hero'));
  await session.set({ v: 1, char: { name: 'private hero', level: 6 } });
  const next = await f.make(); await next.resume({ binding: guest, recoverPendingClaim: true });
  const before = f.calls.length, result = await next.resumeClaim();
  assert.equal(result.claimed, true); assert.deepEqual(f.requests.at(-1).body.targetRecord, original);
  assert.equal(f.records.get(guest.subjectDid).save.char.level, 6);
  assert.equal(f.calls.slice(before).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
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

test('expired lease reload reconciles the frozen copied receipt without another private write', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); f.loseFinalize();
  await assert.rejects(session.claimTarget(f.target()), /lost final response/);
  const original = clone(f.requests.at(-1).body.targetRecord), records = clone([...f.records]);
  const next = await f.make({ now: () => NOW + 660000 }); await next.resume({ binding: guest, recoverPendingClaim: true });
  const count = f.calls.length, result = await next.resumeClaim();
  assert.equal(result.claimed, true); assert.deepEqual(f.requests.at(-1).body.targetRecord, original);
  assert.deepEqual([...f.records], records);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
});

test('expired use-existing receipt recovery preserves both private characters and repeats only the original choice', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  f.records.set(owner.subjectDid, { save: { v: 1, char: { name: 'older canonical hero', level: 20 } }, revision: 1 });
  assert.equal((await session.claimTarget(f.target())).conflict, true); f.loseFinalize();
  await assert.rejects(session.useExistingTarget(), /lost final response/);
  assert.equal(f.metadata.targetClaim.confirmation.selection, 'use-existing');
  const original = clone(f.requests.at(-1).body.targetRecord), records = clone([...f.records]);
  const next = await f.make({ now: () => NOW + 660000 }); await next.resume({ binding: guest, recoverPendingClaim: true });
  const count = f.calls.length, result = await next.resumeClaim();
  assert.equal(result.claimed, true); assert.equal(f.requests.at(-1).body.selection, 'use-existing');
  assert.deepEqual(f.requests.at(-1).body.targetRecord, original); assert.deepEqual([...f.records], records);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
});

test('an expired lease without an original completion receipt cannot create a target checkpoint', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); await session.stageClaimTarget(f.target());
  const next = await f.make({ now: () => NOW + 660000 }); await next.resume({ binding: guest });
  const count = f.calls.length;
  await assert.rejects(next.resumeClaim(), { code: 'claim_expired' });
  assert.equal(f.records.has(owner.subjectDid), false);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey'].includes(call.op)).length, 0);
  assert.equal(f.requests.filter(call => call.path.endsWith('/claim-complete')).length, 0);
});

test('both expired native grants recover only confirmed game admission and require normal canonical pod sign-in', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim(); f.loseFinalize();
  await assert.rejects(session.claimTarget(f.target()), /lost final response/);
  const records = clone([...f.records]), original = clone(f.metadata.targetClaim.confirmation.targetRecord);
  f.credentials.clear();
  const next = await f.make({ now: () => NOW + 3600001 }), count = f.calls.length;
  await assert.rejects(next.resume({ binding: guest, requireGameSession: true }), { code: 'credential_expired' });
  assert.equal(next.status().provisional, false); assert.equal(next.status().ownerDid, owner.subjectDid);
  assert.equal(next.profile(), null, 'game admission does not masquerade as a confirmed private character read');
  assert.equal(f.metadata.claimedOwnerDid, owner.subjectDid); assert.equal(f.metadata.targetClaim, null);
  assert.deepEqual(f.requests.at(-1).body.targetRecord, original); assert.equal(f.requests.at(-1).body.recoveryChallenge, 'r'.repeat(43));
  assert.deepEqual([...f.records], records);
  assert.equal(f.calls.slice(count).filter(call => ['set', 'createKey', 'get', 'connect', 'nativePost'].includes(call.op)).length, 0);
  assert.equal(f.sessions.at(-1).appSession.token, 'canonical-game-session');
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

test('hard quota while staging a claim journal exposes explicit last-confirmed recovery without changing the guest key or source', async () => {
  const f = fixture(), session = await f.make(); await session.bootstrap();
  await session.set({ v: 1, char: { name: 'private hero', level: 5 } }); await session.prepareClaim();
  const original = clone(f.records.get(guest.subjectDid)), key = await f.device.publicDescription();
  f.exhaustQuota();
  await assert.rejects(session.claimTarget(f.target()), { code: 'guest_quota_exhausted' });
  assert.equal(session.status().quota, true); assert.equal(session.status().state, 'guest_quota_exhausted');
  assert.equal(session.status().provisional, true); assert.equal(f.metadata.claimedOwnerDid, undefined);
  assert.deepEqual(f.records.get(guest.subjectDid), original); assert.deepEqual(await f.device.publicDescription(), key);
  assert.equal(f.records.has(owner.subjectDid), false);
  assert.equal(f.requests.filter(call => call.path.endsWith('/claim-complete')).length, 0);
  await assert.rejects(session.prepareClaim(), { code: 'guest_quota_exhausted' });
  await session.prepareClaim({ lastConfirmed: true });
  const result = await session.resumeClaim(); assert.equal(result.claimed, true);
  assert.deepEqual(f.records.get(guest.subjectDid), original, 'explicit fallback never retries a refused source write');
  assert.deepEqual(await f.device.publicDescription(), key);
  assert.equal(f.records.get(owner.subjectDid).save.char.level, 5);
  assert.equal(f.records.get(owner.subjectDid).save.nativePlay.characterId, original.save.nativePlay.characterId);
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
