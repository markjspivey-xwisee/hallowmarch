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
