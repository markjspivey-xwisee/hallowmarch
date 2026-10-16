import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';

const agentDid = 'did:web:identity.example:agents:fixture-companion';
const agentPodUrl = 'https://pods.example/fixture-companion/';
const timestamp = Date.parse('2026-10-17T01:02:03.000Z');
const publicKey = () => generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
function publicPayload() {
  return { purpose: 'urn:interego:gaming:agent-admission:v1', applicationId: 'did:web:game.example', audience: 'https://game.example',
    challenge: randomBytes(32).toString('base64url'), grantId: 'urn:uuid:' + randomUUID(), grantDigest: randomBytes(32).toString('hex'),
    sessionPublicKeyJwk: publicKey() };
}
function fixture(options = {}) {
  let time = timestamp;
  const output = [], payload = publicPayload();
  const broker = createNativeCompanionSigningBroker({ enabled: true, agentDid, agentPodUrl,
    writePublicRequest: value => output.push(value), now: () => time, ...options });
  const begin = () => {
    const result = broker.signNativeRequest({ payload, expiresAt: time + 10_000 });
    // Attach a rejection handler immediately, including tests that close a pending request.
    result.catch(() => {});
    return result;
  };
  const envelope = (changes = {}) => ({ _signed_payload: JSON.stringify({ ...payload, agent_id: agentDid,
    subject_pod_url: agentPodUrl, timestamp: new Date(time).toISOString(), ...changes }),
    // This broker checks transport shape/binding. Cryptographic verification is
    // performed by native admission; these bytes are deliberately a shape fixture.
    _signature: '0x' + 'ab'.repeat(65) });
  const line = (signed = envelope(), changes = {}) => JSON.stringify({ kind: 'native_companion_signed_envelope',
    requestId: output.at(-1)?.requestId, envelope: signed, ...changes });
  return { broker, payload, output, begin, envelope, line, advance: milliseconds => { time += milliseconds; } };
}

test('the broker emits only exact public interego.sign_request arguments and binds an immutable copy', async t => {
  const f = fixture(); t.after(() => f.broker.close());
  const expected = structuredClone(f.payload), result = f.begin();
  assert.equal(f.output.length, 1);
  assert.deepEqual(Object.keys(f.output[0]).sort(), ['args', 'kind', 'requestId', 'tool']);
  assert.match(f.output[0].requestId, /^[0-9a-f-]{36}$/);
  assert.deepEqual(f.output[0], { kind: 'native_companion_sign_request', requestId: f.output[0].requestId,
    tool: 'interego.sign_request', args: { payload: expected } });
  assert.deepEqual(Object.keys(f.output[0].args), ['payload']);
  assert.deepEqual(Object.keys(expected.sessionPublicKeyJwk).sort(), ['crv', 'kty', 'x']);
  f.payload.challenge = randomBytes(32).toString('base64url');
  const signed = f.envelope({ ...expected });
  assert.equal(f.broker.acceptLine(f.line(signed)), true);
  assert.deepEqual(await result, signed);
  assert.deepEqual(f.broker.status(), { kind: 'native_companion_signing', pending: false, closed: false });
  assert.equal(f.broker.acceptLine(f.line(signed)), false);
});

test('semantic public-key equality accepts different JSON field order', async t => {
  const f = fixture(); t.after(() => f.broker.close());
  const result = f.begin(), key = f.payload.sessionPublicKeyJwk;
  const signed = f.envelope({ sessionPublicKeyJwk: { x: key.x, crv: key.crv, kty: key.kty } });
  assert(f.broker.acceptLine(f.line(signed)));
  assert.deepEqual(await result, signed);
});

test('malformed or unrelated input and a wrong request ID cannot resolve a pending request', async t => {
  const f = fixture(); t.after(() => f.broker.close());
  const result = f.begin();
  for (const input of [null, '{', '', 'return process.env', JSON.stringify({ kind: 'other_protocol' }), 'x'.repeat(32769)]) {
    assert.equal(f.broker.acceptLine(input), false);
    assert.equal(f.broker.status().pending, true);
  }
  assert.equal(f.broker.acceptLine(f.line(f.envelope(), { requestId: randomUUID() })), true);
  assert.equal(f.broker.status().pending, true);
  // Extra top-level fields must not be forwarded or complete the request.
  assert.equal(f.broker.acceptLine(f.line(f.envelope(), { privateKey: 'DO_NOT_FORWARD' })), true);
  assert.equal(f.broker.status().pending, true);
  const signed = f.envelope();
  assert(f.broker.acceptLine(f.line(signed)));
  assert.deepEqual(await result, signed);
  assert(!JSON.stringify(f.output).includes('DO_NOT_FORWARD'));
});

test('only fresh envelopes for the exact actor, pod, grant, challenge and session key resolve', async t => {
  const mutations = [
    ['actor', { agent_id: 'did:web:identity.example:agents:other' }],
    ['pod', { subject_pod_url: 'https://pods.example/other/' }],
    ['challenge', { challenge: randomBytes(32).toString('base64url') }],
    ['session key', { sessionPublicKeyJwk: publicKey() }],
    ['application', { applicationId: 'did:web:other.example' }],
    ['audience', { audience: 'https://other.example' }],
    ['grant', { grantId: 'urn:uuid:' + randomUUID() }],
    ['grant digest', { grantDigest: '0'.repeat(64) }],
    ['purpose', { purpose: 'urn:other' }],
    ['extra private field', { privateKey: 'DO_NOT_FORWARD' }],
    ['invalid timestamp', { timestamp: 'invalid' }],
    ['noncanonical timestamp', { timestamp: '2026-10-17T01:02:03Z' }],
    ['old timestamp', { timestamp: new Date(timestamp - 30_001).toISOString() }],
    ['future timestamp', { timestamp: new Date(timestamp + 30_001).toISOString() }],
  ];
  for (const [name, change] of mutations) await t.test(name, async () => {
    const f = fixture();
    try {
      const result = f.begin();
      assert.equal(f.broker.acceptLine(f.line(f.envelope(change))), true);
      await assert.rejects(result, { code: 'qa_companion_signature_binding' });
      assert.equal(f.broker.status().pending, false);
      assert(!JSON.stringify(f.output).includes('DO_NOT_FORWARD'));
    } finally { f.broker.close(); }
  });
});

test('malformed envelopes and extra credential fields fail with fixed errors', async t => {
  const mutations = [
    ['bad signature', value => ({ ...value, _signature: 'not-a-native-signature' })],
    ['oversized payload', value => ({ ...value, _signed_payload: 'x'.repeat(16385) })],
    ['invalid payload JSON', value => ({ ...value, _signed_payload: '{' })],
    ['extra envelope field', value => ({ ...value, token: 'DO_NOT_FORWARD' })],
    ['missing envelope field', value => ({ _signed_payload: value._signed_payload })],
    ['array payload', value => ({ ...value, _signed_payload: '[]' })],
  ];
  for (const [name, mutate] of mutations) await t.test(name, async () => {
    const f = fixture();
    try {
      const result = f.begin();
      f.broker.acceptLine(f.line(mutate(f.envelope())));
      await assert.rejects(result, error => ['qa_companion_signature_envelope', 'qa_companion_signature_binding'].includes(error.code)
        && !error.message.includes('DO_NOT_FORWARD'));
    } finally { f.broker.close(); }
  });
});

test('private or malformed challenge fields are refused before any public output', () => {
  const mutations = [value => ({ ...value, token: 'DO_NOT_FORWARD' }),
    value => ({ ...value, sessionPublicKeyJwk: { ...value.sessionPublicKeyJwk, d: 'DO_NOT_FORWARD' } }),
    value => ({ ...value, sessionPublicKeyJwk: { ...value.sessionPublicKeyJwk, x: 'invalid' } }),
    value => ({ ...value, purpose: 'other' }), value => ({ ...value, challenge: 'bad' }),
    value => ({ ...value, grantId: 'wrong' }), value => ({ ...value, grantDigest: 'wrong' }),
    value => ({ ...value, audience: 'https://game.example/path' }),
    value => ({ ...value, applicationId: 'not-a-did' })];
  for (const mutate of mutations) {
    const f = fixture();
    try {
      assert.throws(() => f.broker.signNativeRequest({ payload: mutate(f.payload), expiresAt: timestamp + 10_000 }),
        { code: 'qa_companion_signing_payload' });
      assert.equal(f.output.length, 0);
      assert.equal(f.broker.status().pending, false);
    } finally { f.broker.close(); }
  }
});

test('expiry, output failure, timeout, busy state and close settle without falling back', async t => {
  await t.test('expired request is rejected before output', () => {
    const f = fixture();
    try {
      assert.throws(() => f.broker.signNativeRequest({ payload: f.payload, expiresAt: timestamp }), { code: 'qa_companion_signing_payload' });
      assert.equal(f.output.length, 0);
    } finally { f.broker.close(); }
  });
  await t.test('expired challenge refuses a fresh-looking envelope', async () => {
    const f = fixture();
    try {
      const result = f.begin(); f.advance(10_000); f.broker.acceptLine(f.line());
      await assert.rejects(result, { code: 'qa_companion_signature_binding' });
    } finally { f.broker.close(); }
  });
  await t.test('failed public output emits only a fixed error', async () => {
    const f = fixture({ writePublicRequest() { throw Error('DO_NOT_FORWARD'); } });
    try { await assert.rejects(f.begin(), error => error.code === 'qa_companion_signature_output' && !error.message.includes('DO_NOT_FORWARD')); }
    finally { f.broker.close(); }
  });
  await t.test('a bounded timeout rejects and permits a new manual request', async () => {
    const f = fixture({ timeoutMs: 100 });
    try {
      await assert.rejects(f.begin(), { code: 'qa_companion_signature_timeout' });
      const retry = f.begin(), signed = f.envelope();
      f.broker.acceptLine(f.line(signed)); assert.deepEqual(await retry, signed);
    } finally { f.broker.close(); }
  });
  await t.test('busy and closed brokers cannot begin more work', async () => {
    const f = fixture(), result = f.begin();
    assert.throws(f.begin, { code: 'qa_companion_signing_busy' });
    f.broker.close();
    await assert.rejects(result, { code: 'qa_companion_signing_closed' });
    assert.throws(f.begin, { code: 'qa_companion_signing_busy' });
    assert.equal(f.broker.acceptLine(f.line()), false);
    assert.deepEqual(f.broker.status(), { kind: 'native_companion_signing', pending: false, closed: true });
  });
});
