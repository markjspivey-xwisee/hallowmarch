import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync } from 'node:crypto';
import { provisionalKey, createNativePlayGrantSigner, createProvisionalProofVerifier, createProvisionalPlayAdmission } from './provisional-play.js';

const ORIGIN = 'https://game.example';
const RELAY = 'https://relay.interego.xwisee.com';
const key = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const challenge = 'c'.repeat(43), proof = 'p'.repeat(86);

test('Play public key thumbprints are canonical and private material is refused', () => {
  const jwk = key(), expected = provisionalKey(jwk);
  assert.deepEqual(provisionalKey({ y: jwk.y, x: jwk.x, kty: jwk.kty, crv: jwk.crv, ext: true }), expected);
  for (const value of [{ ...jwk, d: 'private' }, { ...jwk, key_ops: ['sign'] }, { ...jwk, crv: 'P-384' }, { ...jwk, x: '../key' }]) {
    assert.throws(() => provisionalKey(value), /invalid_play_key/);
  }
});

test('Play grants use the discovered exact native signer with the existing service credential only', async () => {
  const requests = [], payload = { purpose: 'interego-play-provisional-v1', audience: ORIGIN, challenge, publicKeyThumbprint: 'k'.repeat(43), expiresAt: 1792171320 };
  const identity = { agentDid: 'did:web:identity.example:agents:game-u-service', podUrl: 'https://gate.example/u-service/',
    credentialsProvider: async () => ({ Authorization: 'Bearer SERVICE_NATIVE_SECRET' }) };
  const sign = createNativePlayGrantSigner({ identityProvider: async () => identity, fetch: async (url, init) => {
    requests.push({ url, ...init }); assert.equal(init.redirect, 'error');
    if (url === RELAY + '/tools') return Response.json({ '@id': url, 'hydra:member': [{ name: 'sign_request', '@id': RELAY + '/tool/sign_request',
      inputSchema: { properties: { payload: {} } }, affordances: [{ action: 'urn:iep:action:invoke:sign_request', method: 'POST', target: RELAY + '/tool/sign_request' }] }] });
    assert.equal(url, RELAY + '/tool/sign_request'); assert.equal(init.headers.Authorization, 'Bearer SERVICE_NATIVE_SECRET');
    assert.deepEqual(JSON.parse(init.body), { payload });
    return Response.json({ _signed_payload: JSON.stringify({ ...payload, agent_id: identity.agentDid, subject_pod_url: identity.podUrl }), _signature: 'native-signature' });
  } });
  const grant = await sign(payload); assert.equal(grant._signature, 'native-signature');
  assert.equal(requests.length, 2); assert.equal(requests[0].headers.Authorization, undefined);
  assert(!JSON.stringify(grant).includes('SERVICE_NATIVE_SECRET'));
});

test('Play signer refuses a foreign advertised endpoint before sending a credential', async () => {
  let credentialsRead = false;
  const sign = createNativePlayGrantSigner({ identityProvider: async () => ({ agentDid: 'service', podUrl: 'https://gate.example/u/',
    credentialsProvider: () => { credentialsRead = true; return { Authorization: 'Bearer SECRET' }; } }),
    fetch: async () => Response.json({ '@id': RELAY + '/tools', 'hydra:member': [{ name: 'sign_request', '@id': 'https://foreign.example/sign',
      inputSchema: { properties: { payload: {} } }, affordances: [{ action: 'urn:iep:action:invoke:sign_request', method: 'POST', target: 'https://foreign.example/sign' }] }] }) });
  await assert.rejects(sign({}), /invalid_play_signer_contract/); assert.equal(credentialsRead, false);
});

test('provisional verification sends only proof to the configured identity endpoint', async () => {
  const requests = [];
  const verify = createProvisionalProofVerifier({ fetch: async (url, init) => {
    requests.push({ url, ...init }); return Response.json({ valid: true });
  } });
  const input = { attestation: 'attestation', audience: ORIGIN, challenge, proof };
  assert.deepEqual(await verify(input), { valid: true });
  assert.equal(requests[0].url, 'https://identity.interego.xwisee.com/play/provisional/verify');
  assert.equal(requests[0].headers.Authorization, undefined); assert.equal(requests[0].credentials, 'omit');
  assert.deepEqual(JSON.parse(requests[0].body), input);
  await assert.rejects(verify({ ...input, token: 'NATIVE_BEARER' }), /invalid_play_proof/);
  assert.equal(requests.length, 1);
});

test('Play challenge limits, session binding, expiry and durable acknowledgement remain independent of browser labels', async () => {
  let time = 1792152000000, bindCount = 0, failBind = true;
  const jwk = key(), auth = { account: { id: 'guest-a' }, sessionId: 'session-a' };
  const play = createProvisionalPlayAdmission({ publicOrigin: ORIGIN, now: () => time, ttlMs: 1000, maxChallenges: 2,
    signGrant: async payload => ({ _signed_payload: JSON.stringify(payload), _signature: 'native' }),
    verifyProof: async () => ({ valid: true, provisional: true, issuer: 'https://identity.interego.xwisee.com', ownerDid: 'did:web:identity.example:users:u-play',
      userId: 'u-play', webId: 'https://identity.example/users/u-play/profile#me', authenticatedAgentDid: 'did:web:identity.example:agents:browser-u-play',
      podUrl: 'https://gate.example/u-play/', publicKeyJwk: jwk, expiresAt: (time + 86400000) / 1000, capabilities: ['human-play', 'own-pod-checkpoint'] }),
    bindOwner: async () => { bindCount++; if (failBind) throw new Error('native commit unavailable'); return { appSession: { token: 'SHORT_GAME_SESSION' } }; } });
  const issued = await play.challenge(auth, { publicKeyJwk: jwk }), input = { attestation: 'a', challenge: issued.challenge, proof };
  await assert.rejects(play.complete({ ...auth, sessionId: 'other' }, input), /play_challenge_unavailable/);
  await assert.rejects(play.complete(auth, input), /native commit unavailable/); assert.equal(bindCount, 1);
  failBind = false; const answer = await play.complete(auth, input); assert.equal(answer.provisional, true);
  assert.deepEqual(await play.complete(auth, input), answer); assert.equal(bindCount, 2);
  await assert.rejects(play.complete(auth, { ...input, attestation: 'changed' }), /play_operation_changed/);
  await play.challenge(auth, { publicKeyJwk: jwk });
  await assert.rejects(play.challenge(auth, { publicKeyJwk: jwk }), /play_admission_capacity/);
  time += 1001; await assert.rejects(play.complete(auth, input), /play_challenge_unavailable/);
  assert.equal(play.status().pending, 0); play.close();
});
