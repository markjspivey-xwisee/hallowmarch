import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, createPublicKey, verify } from 'node:crypto';
import { createGameServiceIdentity } from './service-identity.js';

function fixture(options = {}) {
  const keyJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  let clock = Date.now(), calls = [], counter = 0, transform = x => x, identity;
  const fetch = async (url, request) => {
    calls.push({ url, request });
    assert.equal(request.headers.Authorization, undefined);
    assert.equal(request.redirect, 'error');
    const payload = JSON.parse(request.body);
    if (url.endsWith('/challenges')) return Response.json({ nonce: 'native-service-nonce-' + ++counter, expiresAt: new Date(clock + 60_000).toISOString() });
    assert.equal(payload.did, identity.credentialDid);
    assert.ok(verify(null, Buffer.from(payload.nonce), createPublicKey({ key: keyJwk, format: 'jwk' }), Buffer.from(payload.signature, 'base64url')));
    return Response.json(transform({ userId: identity.userId, did: identity.owner,
      agentDid: 'did:web:identity.interego.xwisee.com:agents:hallowmarch-game-' + identity.userId,
      podUrl: 'http://css.railway.internal:3456/' + identity.userId + '/', token: 'game-only-bearer-' + String(counter).padStart(32, '0'),
      expiresAt: new Date(clock + 3_600_000).toISOString(), scope: 'ReadWrite' }));
  };
  identity = createGameServiceIdentity({ keyJwk, fetch, now: () => clock, ...options });
  return { identity, keyJwk, calls, advance(ms) { clock += ms; }, transform(fn) { transform = fn; } };
}

test('game service signs a real nonce and accepts only its credential-derived isolated owner', async () => {
  const f = fixture();
  assert.match(f.identity.userId, /^u-did-[a-f0-9]{12}$/);
  const auth = await f.identity.credentials();
  assert.match(auth.Authorization, /^Bearer game-only-bearer-/);
  const metadata = await f.identity.metadata();
  assert.equal(metadata.token, undefined);
  assert.equal(metadata.owner, f.identity.owner);
  assert.equal(f.calls.length, 2);
});

test('service renewal is cached, single-flight and refreshes before expiry', async () => {
  const f = fixture();
  const credentials = await Promise.all(Array.from({ length: 6 }, () => f.identity.credentials()));
  assert.equal(f.calls.length, 2);
  assert.ok(credentials.every(c => c.Authorization === credentials[0].Authorization));
  f.advance(3_400_000);
  assert.notEqual((await f.identity.credentials()).Authorization, credentials[0].Authorization);
  assert.equal(f.calls.length, 4);
  f.identity.invalidate();
  await f.identity.credentials();
  assert.equal(f.calls.length, 6);
});

test('identity key and deployment pod pins cannot name a human owner', () => {
  const f = fixture();
  assert.throws(() => createGameServiceIdentity({ keyJwk: f.keyJwk, expectedUserId: 'u-pk-human' }), /owner/);
  assert.throws(() => createGameServiceIdentity({ keyJwk: f.keyJwk, expectedPodUrl: 'https://gate.interego.xwisee.com/u-pk-human/' }), /isolated/);
  assert.throws(() => createGameServiceIdentity({ keyJwk: f.keyJwk, identityOrigin: 'http://identity.interego.xwisee.com' }), /HTTPS/);
  const other = fixture().keyJwk;
  assert.throws(() => createGameServiceIdentity({ keyJwk: { ...f.keyJwk, x: other.x } }), /match/);
});

test('authentication rejects swapped owner, agent, scope, pod and expiry', async () => {
  for (const replacement of [{ userId: 'u-pk-human' }, { did: 'did:web:human' }, { agentDid: 'did:web:human-agent' }, { scope: 'Read' },
    { podUrl: 'http://css.railway.internal:3456/u-pk-human/' }, { expiresAt: new Date(0).toISOString() }]) {
    const f = fixture(); f.transform(x => ({ ...x, ...replacement }));
    await assert.rejects(f.identity.credentials(), /isolated owner/);
  }
});

test('failed authentication never exposes a server response or retains a failed flight', async () => {
  const keyJwk = generateKeyPairSync('ed25519').privateKey.export({ format: 'jwk' });
  let count = 0;
  const identity = createGameServiceIdentity({ keyJwk, fetch: async () => { count++; return new Response('secret material', { status: 503 }); } });
  await assert.rejects(identity.credentials(), e => !e.message.includes('secret') && e.message.includes('503'));
  await assert.rejects(identity.credentials());
  assert.equal(count, 2);
});
