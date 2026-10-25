import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createProvisionalDevice, provisionalKeyThumbprint } from './provisional-device.mjs';

const origin = 'https://game.example';
function storage() {
  const records = new Map(); let creates = 0;
  return { records, get creates() { return creates; },
    async load(scope) { return structuredClone(records.get(scope) || null); },
    async create(scope, value) { creates++; if (!records.has(scope)) records.set(scope, structuredClone(value)); return this.load(scope); },
    async replace(scope, revision, value) {
      assert.equal(records.get(scope)?.revision, revision); records.set(scope, structuredClone(value)); return this.load(scope);
    },
    async archiveAndReplace(scope, revision, archiveScope, value, isCurrent) {
      if (records.get(scope)?.revision !== revision || !isCurrent()) throw Object.assign(Error('changed'), { code: 'device_changed' });
      assert(!records.has(archiveScope)); records.set(archiveScope, structuredClone(records.get(scope)));
      records.set(scope, structuredClone(value)); return this.load(scope);
    } };
}
const from64 = value => Uint8Array.from(Buffer.from(value, 'base64url'));
test('boot peek does not create a browser key; reload retains the same nonextractable key and proof identity', async () => {
  const store = storage(), first = createProvisionalDevice({ origin, crypto: webcrypto, storage: store });
  assert.equal(await first.peekMetadata(), null); assert.equal(store.creates, 0);
  const publicKey = await first.publicDescription(); assert.equal(store.creates, 1);
  const held = [...store.records.values()][0];
  assert.equal(held.privateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk', held.privateKey));
  assert(!Object.hasOwn(held.publicKeyJwk, 'd'));
  const metadata = { ownerDid: 'did:web:identity.example:users:u-try-play-one', podUrl: 'https://pod.example/u-try-play-one/',
    issuer: 'https://identity.example', relayUrl: 'https://relay.example', provisionalEndpoint: 'https://identity.example/play/provisional',
    guestExpiresAt: Date.now() + 86400000, attestation: 'public-attestation', proofKeyThumbprint: publicKey.proofKeyThumbprint };
  await first.remember(metadata);
  const second = createProvisionalDevice({ origin, crypto: webcrypto, storage: store });
  assert.deepEqual(await second.peekMetadata(), metadata);
  assert.deepEqual(await second.publicDescription(), publicKey); assert.equal(store.creates, 1);
  await second.remember({ ...metadata, gameAdmitted: true });
  assert.equal((await second.peekMetadata()).gameAdmitted, true);
  await assert.rejects(second.remember({ ...metadata, gameAdmitted: 'yes' }), { code: 'invalid_device_metadata' });
  const verifier = await webcrypto.subtle.importKey('jwk', publicKey.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const grant = { _signed_payload: 'native-payload', _signature: 'native-signature' };
  const proof = await second.signBootstrap(grant);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, from64(proof),
    new TextEncoder().encode('interego-play-provisional-v1\nnative-payload\nnative-signature')), true);
  const signed = await second.signProof({ attestation: 'public-attestation', audience: origin, challenge: 'one-use-challenge' });
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, from64(signed),
    new TextEncoder().encode('interego-play-proof-v1\npublic-attestation\nhttps://game.example\none-use-challenge')), true);
  assert.equal(await provisionalKeyThumbprint(publicKey.publicKeyJwk, webcrypto), publicKey.proofKeyThumbprint);
  await assert.rejects(second.signProof({ attestation: 'a', audience: 'https://other.example', challenge: 'b' }), { code: 'invalid_proof' });
  const receipt = { kind: 'character', graphIri: 'urn:graph:hallowmarch:fixture', descriptorUrl: metadata.podUrl + 'context-graphs/binding.ttl',
    cid: 'native-binding-cid', nativeRevision: 'sha256:' + 'a'.repeat(64), recordCid: 'graph-nquads-sha256:' + 'b'.repeat(64),
    digest: 'graph-nquads-sha256:' + 'b'.repeat(64), proofKind: 'owner-key-authenticated-checkpoint' };
  const targetClaim = { binding: { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl },
    appSession: { purpose: 'character-claim-target', claimOperationId: 'same-pod-operation', guestOwnerDid: metadata.ownerDid,
      targetOwnerDid: metadata.ownerDid, audience: origin, sourceChallenge: 'fresh-source-proof-challenge', expiresAt: Date.now() + 60000 },
    confirmation: { selection: 'copy-guest', targetRecord: receipt } };
  await second.remember({ ...metadata, targetClaim });
  const reloaded = createProvisionalDevice({ origin, crypto: webcrypto, storage: store });
  assert.deepEqual((await reloaded.peekMetadata()).targetClaim.confirmation.targetRecord, receipt);
  await second.remember({ ...metadata, targetClaim: { ...targetClaim, confirmation: { selection: 'use-existing', targetRecord: receipt } } });
  assert.equal((await second.peekMetadata()).targetClaim.confirmation.selection, 'use-existing');
  await assert.rejects(second.remember({ ...metadata, targetClaim: { ...targetClaim,
    confirmation: { selection: 'copy-guest', targetRecord: { ...receipt, body: 'private character body' } } } }), { code: 'invalid_device_metadata' });
  await assert.rejects(second.remember({ ...metadata, ownerDid: 'did:web:other.example:other' }), { code: 'guest_identity_changed' });
  await assert.rejects(second.remember(null), { code: 'invalid_device_metadata' });
});
test('an unreadable original device key is never replaced', async () => {
  const store = storage(), first = createProvisionalDevice({ origin, crypto: webcrypto, storage: store });
  await first.publicDescription();
  const [scope, record] = [...store.records][0]; store.records.set(scope, { ...record, privateKey: null });
  const next = createProvisionalDevice({ origin, crypto: webcrypto, storage: store });
  await assert.rejects(next.publicDescription(), { code: 'invalid_device_key' });
  assert.equal(store.creates, 1);
});

test('explicit expired restart archives the exact signing key and routing before selecting a fresh device', async () => {
  const store = storage(), now = 2000000000000, device = createProvisionalDevice({ origin, crypto: webcrypto, storage: store, now: () => now });
  const oldKey = await device.publicDescription();
  const metadata = { ownerDid: 'did:web:identity.example:users:expired', podUrl: 'https://pod.example/expired/',
    issuer: 'https://identity.example', relayUrl: 'https://relay.example', provisionalEndpoint: 'https://identity.example/play/provisional',
    guestExpiresAt: now - 1, attestation: 'original-public-attestation', proofKeyThumbprint: oldKey.proofKeyThumbprint };
  await device.remember(metadata);
  const [scope, original] = [...store.records][0];
  await device.archiveExpired({ expectedOwnerDid: metadata.ownerDid, isCurrent: () => true });
  assert.equal(await device.peekMetadata(), null); assert.equal(store.records.size, 2);
  assert.notDeepEqual(await device.publicDescription(), oldKey);
  const [archiveScope, archived] = [...store.records].find(([key]) => key !== scope);
  assert(archiveScope.includes('expired')); assert.deepEqual(archived.metadata, metadata);
  assert.equal(archived.revision, original.revision); assert.equal(archived.privateKey.extractable, false);
  const proof = await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, archived.privateKey, new TextEncoder().encode('recovery-proof'));
  const verifier = await webcrypto.subtle.importKey('jwk', oldKey.publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await webcrypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, verifier, proof, new TextEncoder().encode('recovery-proof')), true);
});

test('restart refuses live, claimed, pending, foreign or concurrently changed devices without losing keys', async () => {
  for (const mode of ['live', 'claimed', 'pending', 'started', 'foreign', 'cancelled', 'concurrent']) {
    const store = storage(), now = 2000000000000, device = createProvisionalDevice({ origin, crypto: webcrypto, storage: store, now: () => now });
    const key = await device.publicDescription();
    const metadata = { ownerDid: 'did:web:identity.example:users:expired', podUrl: 'https://pod.example/expired/',
      issuer: 'https://identity.example', relayUrl: 'https://relay.example', provisionalEndpoint: 'https://identity.example/play/provisional',
      guestExpiresAt: now + (mode === 'live' ? 60000 : -1), attestation: 'public-attestation', proofKeyThumbprint: key.proofKeyThumbprint,
      ...(mode === 'claimed' ? { claimedOwnerDid: 'did:web:identity.example:users:alice' } : {}) };
    await device.remember(metadata);
    if (mode === 'started') await device.remember({ ...metadata, lastConfirmedClaim: false });
    if (mode === 'pending') {
      const [scope, record] = [...store.records][0];
      // A valid pending claim is enough to prevent rollover, even after expiry.
      const targetClaim = { binding: { subjectDid: metadata.ownerDid, podUrl: metadata.podUrl },
        appSession: { purpose: 'character-claim-target', claimOperationId: 'pending-operation', guestOwnerDid: metadata.ownerDid,
          targetOwnerDid: metadata.ownerDid, audience: origin, sourceChallenge: 'pending-proof', expiresAt: now - 1 } };
      store.records.set(scope, { ...record, metadata: { ...metadata, targetClaim } });
    }
    if (mode === 'concurrent') {
      const replace = store.archiveAndReplace;
      store.archiveAndReplace = async function(scope, revision, ...rest) {
        store.records.set(scope, { ...store.records.get(scope), revision: 'newer-tab-revision' });
        return replace.call(this, scope, revision, ...rest);
      };
    }
    await assert.rejects(device.archiveExpired({ expectedOwnerDid: mode === 'foreign' ? 'did:other:owner' : metadata.ownerDid,
      isCurrent: () => mode !== 'cancelled' }), { code: mode === 'concurrent' ? 'device_changed' : 'guest_restart_refused' });
    assert.equal(store.records.size, 1); assert.deepEqual(await device.publicDescription(), key);
  }
});

