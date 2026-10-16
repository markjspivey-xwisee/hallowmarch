import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createGameSessionTokens } from './game-session.js';

test('legacy transport credentials remain compatible without acquiring native identity', () => {
  const secret = 'local-synthetic-game-session-secret', tokens = createGameSessionTokens({ secret, now: () => 1000 });
  const body = Buffer.from(JSON.stringify({ id: 'guest-a', exp: 5000 })).toString('base64url');
  const original = body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
  assert.deepEqual(tokens.read(original), { id: 'guest-a', exp: 5000 });
  assert.equal(tokens.read(tokens.issueLegacy('guest-a')).nativeDid, undefined);
});

test('native proof is game-signed, bounded, tamper resistant and cannot be extended by legacy tokens', () => {
  let clock = 1000;
  const tokens = createGameSessionTokens({ secret: 'ephemeral-test-secret', now: () => clock });
  const issued = tokens.issueNative('alice', 'did:example:alice');
  assert.equal(issued.expiresAt, 3_601_000);
  assert.deepEqual(tokens.read(issued.token), { id: 'alice', exp: issued.expiresAt, nativeDid: 'did:example:alice', nativeVerifiedAt: 1000 });
  for (const invalid of [issued.token + '.extra', issued.token.replace(/.$/, '.'), issued.token.replace('a', 'b'), null]) {
    assert.equal(tokens.read(invalid), null);
  }
  clock = issued.expiresAt; assert.equal(tokens.read(issued.token), null);
  assert.equal(tokens.read(tokens.issueLegacy('alice')).nativeDid, undefined);
});
