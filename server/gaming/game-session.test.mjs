import test from 'node:test';
import assert from 'node:assert/strict';
test('provisional game credentials retain their purpose, expire with the guest and cannot use canonical reauthentication', () => {
  let clock = 100000;
  const sessions = createGameSessionTokens({ secret: 'provisional-session-test-secret', now: () => clock });
  const session = sessions.issueNative('guest-a', 'did:web:identity.example:users:u-play', { provisional: true, expiresAt: clock + 2000 });
  assert.equal(sessions.read(session.token).provisional, true);
  assert.equal(sessions.readForReauthentication(session.token), null);
  clock += 2000; assert.equal(sessions.read(session.token), null);
});
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

test('native reauthentication proof is HMAC-bound, purpose-limited and expires within24hours of original expiry', () => {
  let clock = 1000;
  const tokens = createGameSessionTokens({ secret: 'synthetic-reauth-secret', now: () => clock });
  const issued = tokens.issueNative('alice', 'did:example:alice');
  const original = tokens.read(issued.token);
  const recovery = tokens.readForReauthentication(issued.token);
  assert.equal(recovery.purpose, 'native-reauthentication-only');
  assert.equal(recovery.reauthenticationUntil, issued.expiresAt + 86_400_000);
  assert.deepEqual({ id: recovery.id, nativeDid: recovery.nativeDid }, { id: original.id, nativeDid: original.nativeDid });
  assert.equal(tokens.readForReauthentication(tokens.issueLegacy('alice')), null);
  for (const value of [null, issued.token + '.extra', issued.token.slice(0, -1) + '!', issued.token.replace(/^./, 'X')]) {
    assert.equal(tokens.readForReauthentication(value), null);
  }
  clock = issued.expiresAt;
  assert.equal(tokens.read(issued.token), null);
  assert.equal(tokens.readForReauthentication(issued.token).nativeDid, 'did:example:alice');
  clock += 86_400_000 - 1;
  assert(tokens.readForReauthentication(issued.token));
  clock++;
  assert.equal(tokens.readForReauthentication(issued.token), null);
  assert.equal(tokens.read(issued.token), null);
});

test('recovery rejects impossible native claims even when their envelope has a valid server MAC', () => {
  const secret = 'synthetic-reauth-claim-secret', now = 10_000;
  const tokens = createGameSessionTokens({ secret, now: () => now });
  const signed = claims => {
    const body = Buffer.from(JSON.stringify(claims)).toString('base64url');
    return body + '.' + createHmac('sha256', secret).update(body).digest('base64url');
  };
  for (const extra of [ { nativeVerifiedAt: now + 1 }, { nativeVerifiedAt: -1 }, { exp: now },
    { exp: now + 3_600_001 }, { nativeDid: 'unverified label' } ]) {
    const value = signed({ id: 'alice', nativeDid: 'did:example:alice', nativeVerifiedAt: now, exp: now + 3_600_000, ...extra });
    assert.equal(tokens.read(value), null); assert.equal(tokens.readForReauthentication(value), null);
  }
  for (const reauthenticationTtlMs of [0, 86_400_001, Infinity]) {
    assert.throws(() => createGameSessionTokens({ secret, reauthenticationTtlMs }), /bounded/);
  }
});

