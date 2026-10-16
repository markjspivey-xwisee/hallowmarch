import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { createWallet, signMessageRaw, recoverMessageSigner } from '@interego/core';
import { createNativeAgentProofAdapter, agentSessionPossessionMessage, agentCommandMessage, agentRenewalMessage } from './native-agent-proof.js';

// Real native wallet signatures and Ed25519 session proofs. The owner-head
// reader and native identity resolver below are synthetic trusted ports, not
// evidence of live owner-pod authorship or a deployed delegation integration.
const wallet = await createWallet('agent', 'native-agent-proof-test');
const unrelatedWallet = await createWallet('agent', 'unrelated-agent-proof-test');
const AUDIENCE = 'https://game.example';
const APPLICATION_ID = 'did:web:identity.example:users:hallowmarch-game';
const OWNER_DID = 'did:web:identity.example:users:owner-a';
const OWNER_POD = 'https://pods.example/owner-a/';
const AGENT_POD = 'https://pods.example/agent-a/';
const GRANT_ID = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
const relayAgentDid = 'did:web:identity.example:agents:agent-owner-a';
const walletDid = signingWallet => 'did:ethr:' + signingWallet.address.toLowerCase();
const sha256 = value => createHash('sha256').update(value).digest('hex');
const edKey = () => {
  const pair = generateKeyPairSync('ed25519');
  return { ...pair, jwk: pair.publicKey.export({ format: 'jwk' }) };
};

function fixture(t, options = {}) {
  let clock = Date.parse('2026-10-16T12:00:00Z'), grantTransform = x => x, snapshotTransform = x => x;
  let identityTransform = x => x, readerFailure = null, resolverFailure = null, readerBlock = null;
  let enteredReader; const readerEntered = new Promise(resolve => { enteredReader = resolve; });
  const mode = options.mode ?? 'independent-key', actorDid = mode === 'relay-mediated' ? relayAgentDid : walletDid(wallet);
  const reads = [], resolutions = [], key = edKey();
  const grant = () => grantTransform({ schema: 'interego.gaming.owner-agent-grant/v1', id: GRANT_ID, applicationId: APPLICATION_ID,
    issuer: OWNER_DID, actor: actorDid, audience: AUDIENCE, roomId: 'room-a', entityId: 'pet-a',
    role: 'pet', actions: ['observe', 'move', 'attack'], notBefore: '2026-10-16T11:59:59.000Z',
    expiresAt: '2026-10-16T12:30:00.000Z', maxCommandsPerSecond: 5, revoked: false });
  const adapter = createNativeAgentProofAdapter({ audience: AUDIENCE, applicationId: APPLICATION_ID, nativeCore: { recoverMessageSigner }, now: () => clock,
    readOwnerGrantHead: async query => {
      reads.push(query); if (readerFailure) throw readerFailure;
      if (readerBlock) { enteredReader(); await readerBlock; }
      return snapshotTransform({ grant: grant(), ownerPodUrl: OWNER_POD, descriptorUrl: OWNER_POD + 'context-graphs/grant.ttl',
        graphIri: 'urn:graph:gaming:owner-agent-grant:test', cid: 'bafy-native-grant-fixture',
        contentDigest: 'a'.repeat(64), observedAt: clock });
    },
    resolveAgentProof: async query => {
      resolutions.push(query); if (resolverFailure) throw resolverFailure;
      return identityTransform({ agentDid: actorDid, podUrl: AGENT_POD, mode, signerDid: walletDid(wallet),
        observedAt: clock, expiresAt: clock + 300_000 });
    },
    ...options,
  });
  t.after(() => adapter.close?.());
  const challenge = (jwk = key.jwk) => adapter.challenge({ grantId: GRANT_ID, sessionPublicKeyJwk: jwk });
  const envelope = async (challengeRecord, fields = {}) => {
    const payload = { ...challengeRecord.payload, ...(fields.payload ?? {}), agent_id: fields.agentDid ?? actorDid,
      subject_pod_url: fields.podUrl ?? AGENT_POD, timestamp: fields.timestamp ?? new Date(clock).toISOString() };
    const _signed_payload = JSON.stringify(payload);
    return { _signed_payload, _signature: await signMessageRaw(fields.wallet ?? wallet, 'sha256:' + sha256(_signed_payload)) };
  };
  const possession = (challengeRecord, signingKey = key) => sign(null, Buffer.from(agentSessionPossessionMessage(challengeRecord.payload)), signingKey.privateKey).toString('base64url');
  const complete = async (challengeRecord, fields = {}) => adapter.complete({ challengeId: challengeRecord.challengeId,
    envelope: await envelope(challengeRecord, fields), sessionSignature: possession(challengeRecord, fields.key ?? key) });
  const session = async () => complete(await challenge());
  const request = (fields = {}) => ({ sequence: 1, at: clock, method: 'POST', path: '/gaming/agent/command', action: 'move',
    roomId: 'room-a', entityId: 'pet-a', body: { command: { type: 'move', x: 1, z: 2 } }, ...fields });
  const commandSignature = (sessionId, command, signingKey = key) => sign(null, Buffer.from(agentCommandMessage(sessionId, command)), signingKey.privateKey).toString('base64url');
  const authorize = (sessionRecord, command = request(), signature = commandSignature(sessionRecord.sessionId, command)) =>
    adapter.authorize({ sessionId: sessionRecord.sessionId, request: command, signature });
  const renew = (sessionRecord, fields = {}) => {
    const proof = { sequence: 1, at: clock, ...fields };
    const signature = sign(null, Buffer.from(agentRenewalMessage(sessionRecord.sessionId, proof)), key.privateKey).toString('base64url');
    return adapter.renew({ sessionId: sessionRecord.sessionId, ...proof, signature });
  };
  return { adapter, key, actorDid, mode, reads, resolutions, challenge, envelope, possession, complete, session, request, commandSignature, authorize, renew, readerEntered,
    advance(ms) { clock += ms; }, clock: () => clock,
    grant(fn) { grantTransform = fn; }, snapshot(fn) { snapshotTransform = fn; }, identity(fn) { identityTransform = fn; },
    failReader(error = new Error('synthetic reader unavailable')) { readerFailure = error; },
    blockReader(promise) { readerBlock = promise; },
    failResolver(error = new Error('synthetic identity resolver unavailable')) { resolverFailure = error; },
  };
}
const rejects = action => assert.rejects(async () => action());

test('native wallet proof and Ed25519 possession establish a short independent-key session with owner receipt', async t => {
  const f = fixture(t); const challenge = await f.challenge();
  assert(challenge.challengeId); assert(challenge.expiresAt); assert.equal(challenge.payload.audience, AUDIENCE);
  assert.equal(challenge.payload.applicationId, APPLICATION_ID);
  assert.equal(challenge.payload.grantId, GRANT_ID); assert.deepEqual(challenge.payload.sessionPublicKeyJwk, f.key.jwk);
  assert(challenge.payload.purpose); assert(challenge.payload.challenge); assert.match(challenge.payload.grantDigest, /^(?:sha256:)?[a-f0-9]{64}$/);
  const session = await f.complete(challenge); assert(session.sessionId); assert(session.expiresAt <= f.clock() + 10_000);
  assert.equal(session.identity.agentDid.toLowerCase(), f.actorDid); assert.equal(session.identity.mode, 'independent-key');
  assert(session.receipt); assert(JSON.stringify(session.receipt).includes(GRANT_ID));
  assert(!JSON.stringify(session).includes('_signed_payload')); assert(!JSON.stringify(session).includes('_signature'));
  const authorized = await f.authorize(session); assert.equal(authorized.agentDid.toLowerCase(), f.actorDid);
  assert.equal(authorized.ownerDid, OWNER_DID); assert.equal(authorized.grantId, GRANT_ID); assert.equal(authorized.proofMode, 'independent-key');
  assert(authorized.scope); assert(authorized.receiptRef);
  assert(f.resolutions.every(query => query.signatureSigner)); assert(f.reads.every(query => query.grantId === GRANT_ID));
});

test('relay-mediated signatures remain explicitly relay provenance rather than independent agent keys', async t => {
  const f = fixture(t, { mode: 'relay-mediated' }); const session = await f.session(); const authorized = await f.authorize(session);
  assert.equal(session.identity.agentDid, relayAgentDid); assert.equal(session.identity.mode, 'relay-mediated');
  assert.equal(authorized.agentDid, relayAgentDid); assert.equal(authorized.proofMode, 'relay-mediated');
});

test('a real unrelated native wallet cannot attest the resolver-selected signer or a session key it does not possess', async t => {
  const f = fixture(t); let challenge = await f.challenge();
  await rejects(() => f.complete(challenge, { wallet: unrelatedWallet }));
  challenge = await f.challenge(); await rejects(() => f.complete(challenge, { key: edKey() }));
});

test('signed payloads bind every challenge field, native actor and subject pod rather than accepting re-signed substitutions', async t => {
  for (const [label, fields] of [
    ['purpose', { payload: { purpose: 'other-service-purpose' } }],
    ['audience', { payload: { audience: 'https://evil.example' } }],
    ['application', { payload: { applicationId: 'did:web:identity.example:users:other-game' } }],
    ['challenge', { payload: { challenge: 'another-random-challenge' } }],
    ['grant ID', { payload: { grantId: 'urn:uuid:10151480-80cc-4f4a-b542-f7df185a2de1' } }],
    ['grant digest', { payload: { grantDigest: 'b'.repeat(64) } }],
    ['unsigned-purpose extension', { payload: { otherPurpose: 'unrelated-task' } }],
    ['session key', { payload: { sessionPublicKeyJwk: edKey().jwk } }],
    ['agent DID', { agentDid: walletDid(unrelatedWallet) }],
    ['subject pod', { podUrl: 'https://pods.example/other-agent/' }],
    ['old native timestamp', { timestamp: '2026-10-16T11:00:00.000Z' }],
  ]) await t.test(label, async t => {
    const f = fixture(t); const challenge = await f.challenge(); await rejects(() => f.complete(challenge, fields));
  });
});

test('completed or expired challenges and a captured envelope cannot be replayed to create another session', async t => {
  const f = fixture(t); const challenge = await f.challenge();
  const request = { challengeId: challenge.challengeId, envelope: await f.envelope(challenge), sessionSignature: f.possession(challenge) };
  await f.adapter.complete(request); await rejects(() => f.adapter.complete(request));
  const other = await f.challenge(); await rejects(() => f.adapter.complete({ ...request, challengeId: other.challengeId }));
  const expired = await f.challenge(); f.advance(30_001); await rejects(() => f.complete(expired));
});

test('completion consumes the challenge before awaiting the current native owner head', async t => {
  const f = fixture(t); const challenge = await f.challenge(); let release;
  f.blockReader(new Promise(resolve => { release = resolve; })); t.after(() => release());
  const request = { challengeId: challenge.challengeId, envelope: await f.envelope(challenge), sessionSignature: f.possession(challenge) };
  const first = f.adapter.complete(request); await f.readerEntered;
  await rejects(() => f.adapter.complete(request)); release(); assert((await first).sessionId);
});

test('changed or revoked owner grants invalidate a challenge before a session is issued', async t => {
  for (const [label, mutate] of [
    ['revoked', g => ({ ...g, revoked: true })], ['changed scope', g => ({ ...g, actions: ['observe'] })],
    ['changed owner', g => ({ ...g, issuer: 'did:web:identity.example:users:other-owner' })],
  ]) await t.test(label, async t => {
    const f = fixture(t); const challenge = await f.challenge(); f.grant(mutate); await rejects(() => f.complete(challenge));
  });
  await t.test('current owner head becomes unavailable', async t => {
    const f = fixture(t); const challenge = await f.challenge(); f.failReader(); await rejects(() => f.complete(challenge));
  });
});

test('grant validation rejects foreign audiences, malformed contracts and role escalation', async t => {
  for (const [label, mutate] of [
    ['foreign audience', g => ({ ...g, audience: 'https://evil.example' })],
    ['foreign game', g => ({ ...g, applicationId: 'did:web:identity.example:users:other-game' })],
    ['unknown schema', g => ({ ...g, schema: 'interego.gaming.owner-agent-grant/v0' })],
    ['non-UUID grant ID', g => ({ ...g, id: 'caller-selected-grant' })],
    ['revoked', g => ({ ...g, revoked: true })],
    ['future grant', g => ({ ...g, notBefore: '2026-10-16T12:00:01.000Z' })],
    ['expired grant', g => ({ ...g, expiresAt: '2026-10-16T11:59:59.000Z' })],
    ['over one hour', g => ({ ...g, expiresAt: '2026-10-16T13:00:01.000Z' })],
    ['coach attacks', g => ({ ...g, role: 'coach', actions: ['attack'] })],
    ['pet claims loot', g => ({ ...g, actions: ['claimLoot'] })],
    ['unknown role', g => ({ ...g, role: 'admin' })],
    ['empty actions', g => ({ ...g, actions: [] })],
    ['unbounded rate', g => ({ ...g, maxCommandsPerSecond: 1000 })],
    ['unexpected owner credentials', g => ({ ...g, bearerToken: 'private-material' })],
  ]) await t.test(label, async t => { const f = fixture(t); f.grant(mutate); await rejects(() => f.challenge()); });
});

test('missing or stale trusted native provenance cannot establish an agent session', async t => {
  for (const [label, configure, phase] of [
    ['reader failure', f => f.failReader(), 'challenge'],
    ['missing native snapshot', f => f.snapshot(() => null), 'challenge'],
    ['stale observed head', f => f.snapshot(s => ({ ...s, observedAt: f.clock() - 60_000 })), 'challenge'],
    ['descriptor outside owner pod', f => f.snapshot(s => ({ ...s, descriptorUrl: 'https://pods.example/other-owner/head.ttl' })), 'challenge'],
    ['missing content digest', f => f.snapshot(s => { delete s.contentDigest; return s; }), 'challenge'],
    ['identity failure', f => f.failResolver(), 'complete'],
    ['missing identity', f => f.identity(() => null), 'complete'],
    ['wrong canonical actor', f => f.identity(i => ({ ...i, agentDid: walletDid(unrelatedWallet) })), 'complete'],
    ['unanchored signer', f => f.identity(i => ({ ...i, signerDid: walletDid(unrelatedWallet) })), 'complete'],
    ['expired identity proof', f => f.identity(i => ({ ...i, expiresAt: f.clock() - 1 })), 'complete'],
    ['unknown proof mode', f => f.identity(i => ({ ...i, mode: 'claimed-key' })), 'complete'],
    ['false independent provenance', f => f.identity(i => ({ ...i, agentDid: relayAgentDid, mode: 'independent-key' })), 'complete'],
  ]) await t.test(label, async t => {
    const f = fixture(t); const challenge = phase === 'complete' ? await f.challenge() : null; configure(f);
    await rejects(() => phase === 'challenge' ? f.challenge() : f.complete(challenge));
  });
  await t.test('relay signer cannot be relabeled independent', async t => {
    const f = fixture(t, { mode: 'relay-mediated' }); const challenge = await f.challenge();
    f.identity(identity => ({ ...identity, mode: 'independent-key' })); await rejects(() => f.complete(challenge));
  });
});

test('command signatures bind body, method, path, action, room, entity and session', async t => {
  const f = fixture(t); const session = await f.session(); const command = f.request(); const signature = f.commandSignature(session.sessionId, command);
  for (const mutation of [
    { body: { command: { type: 'move', x: 200, z: 2 } } }, { method: 'GET' }, { path: '/other-action' },
    { action: 'attack' }, { roomId: 'room-b' }, { entityId: 'pet-b' }, { at: f.clock() + 1 }, { sequence: 2 },
  ]) await rejects(() => f.authorize(session, { ...command, ...mutation }, signature));
  const another = await f.session(); await rejects(() => f.authorize(another, command, signature));
  assert.equal((await f.authorize(session, command, signature)).ownerDid, OWNER_DID);
});

test('even validly signed commands must respect grant scope, room, entity and timestamp', async t => {
  const f = fixture(t); const session = await f.session();
  for (const mutation of [{ action: 'claimLoot' }, { roomId: 'room-b' }, { entityId: 'pet-b' },
    { at: f.clock() - 5001 }, { at: f.clock() + 5001 }, { path: 'https://evil.example/command' }]) {
    await rejects(() => f.authorize(session, f.request(mutation)));
  }
  assert.equal((await f.authorize(session)).grantId, GRANT_ID);
});

test('commands require exact monotonically increasing sequence and enforce the granted rate', async t => {
  const f = fixture(t); f.grant(g => ({ ...g, maxCommandsPerSecond: 2 })); const session = await f.session();
  await rejects(() => f.authorize(session, f.request({ sequence: 0 }))); await rejects(() => f.authorize(session, f.request({ sequence: 2 })));
  await f.authorize(session); await rejects(() => f.authorize(session));
  await f.authorize(session, f.request({ sequence: 2 })); await rejects(() => f.authorize(session, f.request({ sequence: 3 })));
  f.advance(1001); assert.equal((await f.authorize(session, f.request({ sequence: 3 }))).grantId, GRANT_ID);
});

test('local signed commands reuse the admitted proof and contact native services only on renewal', async t => {
  const f = fixture(t); f.grant(grant => ({ ...grant, maxCommandsPerSecond: 20 }));
  const challenge = await f.challenge(), envelope = await f.envelope(challenge);
  const session = await f.adapter.complete({ challengeId: challenge.challengeId, envelope, sessionSignature: f.possession(challenge) });
  const serialized = JSON.stringify(session), privateJwk = f.key.privateKey.export({ format: 'jwk' });
  for (const secret of ['_signed_payload', '_signature', 'accessToken', 'refreshToken', 'privateJwk', 'Bearer ',
    envelope._signed_payload, envelope._signature, privateJwk.d]) assert(!serialized.includes(secret));
  const admittedReads = [f.reads.length, f.resolutions.length];
  for (let sequence = 1; sequence <= 12; sequence++) {
    f.advance(100); await f.authorize(session, f.request({ sequence }));
  }
  assert.deepEqual([f.reads.length, f.resolutions.length], admittedReads);
  await f.renew(session, { sequence: 13 });
  assert.equal(f.reads.length, admittedReads[0] + 1); assert.equal(f.resolutions.length, admittedReads[1] + 1);
  const renewedReads = [f.reads.length, f.resolutions.length];
  await f.authorize(session, f.request({ sequence: 14 }));
  assert.deepEqual([f.reads.length, f.resolutions.length], renewedReads);
});

test('coach observation and explicit teammate loot grants retain their distinct role limits', async t => {
  const coach = fixture(t); coach.grant(g => ({ ...g, role: 'coach', actions: ['observe'] })); const coached = await coach.session();
  await coach.authorize(coached, coach.request({ action: 'observe', path: '/gaming/agent/observe', body: {} }));
  await rejects(() => coach.authorize(coached, coach.request({ sequence: 2, action: 'attack' })));
  const teammate = fixture(t); teammate.grant(g => ({ ...g, role: 'teammate', actions: ['observe', 'claimLoot'] })); const teamed = await teammate.session();
  assert.equal((await teammate.authorize(teamed, teammate.request({ action: 'claimLoot', body: { command: { type: 'claimLoot' } } }))).grantId, GRANT_ID);
});

test('local grant revocation and lease expiry immediately remove command authority', async t => {
  const f = fixture(t); const session = await f.session(); f.adapter.revoke(GRANT_ID); await rejects(() => f.authorize(session));
  await rejects(() => f.challenge());
  const other = fixture(t); const leased = await other.session(); other.advance(10_001); await rejects(() => other.authorize(leased));
});

test('lease expiry is anchored to the oldest native observation rather than the session issuance time', async t => {
  for (const source of ['owner', 'identity']) await t.test(source, async t => {
    const f = fixture(t);
    if (source === 'owner') f.snapshot(s => ({ ...s, observedAt: f.clock() - 9900 }));
    else f.identity(identity => ({ ...identity, observedAt: f.clock() - 9900 }));
    const session = await f.session(); assert.equal(session.expiresAt, f.clock() + 100);
    f.advance(101); await rejects(() => f.authorize(session));
  });
});

test('local revocation wins races with in-flight native completion and renewal', async t => {
  for (const phase of ['complete', 'renew']) await t.test(phase, async t => {
    const f = fixture(t), existing = phase === 'renew' ? await f.session() : null;
    const challenge = phase === 'complete' ? await f.challenge() : null; let release;
    f.blockReader(new Promise(resolve => { release = resolve; })); t.after(() => release());
    const active = phase === 'complete' ? f.complete(challenge) : f.renew(existing);
    const rejected = assert.rejects(active); await f.readerEntered;
    f.adapter.revoke(GRANT_ID); release(); await rejected;
    if (existing) await rejects(() => f.authorize(existing));
    await rejects(() => f.challenge()); assert.equal(f.adapter.status().sessions, 0);
  });
});

test('renewal rereads current owner and agent proofs; any failure removes the old session', async t => {
  await t.test('renewal succeeds within lease', async t => {
    const f = fixture(t); const session = await f.session(); const before = [f.reads.length, f.resolutions.length]; f.advance(5000);
    const renewed = await f.renew(session); assert(renewed.expiresAt > session.expiresAt);
    assert(f.reads.length > before[0]); assert(f.resolutions.length > before[1]); assert.equal((await f.authorize(session, f.request({ sequence: 2 }))).grantId, GRANT_ID);
  });
  for (const [label, configure] of [
    ['owner read fails', f => f.failReader()], ['agent proof fails', f => f.failResolver()],
    ['owner revokes', f => f.grant(g => ({ ...g, revoked: true }))],
    ['owner changes scope', f => f.grant(g => ({ ...g, actions: ['observe'] }))],
    ['identity changes signer', f => f.identity(i => ({ ...i, signerDid: walletDid(unrelatedWallet) }))],
  ]) await t.test(label, async t => {
    const f = fixture(t); const session = await f.session(); configure(f);
    await rejects(() => f.renew(session)); await rejects(() => f.authorize(session));
  });
});

test('renewal requires a fresh exact-next Ed25519 proof and shares the command sequence', async t => {
  for (const [label, proof] of [
    ['missing signature', f => ({ sequence: 1, at: f.clock() })],
    ['wrong session key', (f, session) => {
      const request = { sequence: 1, at: f.clock() };
      return { ...request, signature: sign(null, Buffer.from(agentRenewalMessage(session.sessionId, request)), edKey().privateKey).toString('base64url') };
    }],
    ['skipped sequence', (f, session) => {
      const request = { sequence: 2, at: f.clock() };
      return { ...request, signature: sign(null, Buffer.from(agentRenewalMessage(session.sessionId, request)), f.key.privateKey).toString('base64url') };
    }],
    ['expired timestamp', (f, session) => {
      const request = { sequence: 1, at: f.clock() - 5001 };
      return { ...request, signature: sign(null, Buffer.from(agentRenewalMessage(session.sessionId, request)), f.key.privateKey).toString('base64url') };
    }],
  ]) await t.test(label, async t => {
    const f = fixture(t); const session = await f.session();
    await rejects(() => f.adapter.renew({ sessionId: session.sessionId, ...proof(f, session) })); await rejects(() => f.authorize(session));
  });
  await t.test('command then renewal then command', async t => {
    const f = fixture(t); const session = await f.session(); await f.authorize(session);
    await f.renew(session, { sequence: 2 }); await rejects(() => f.authorize(session, f.request({ sequence: 2 })));
    assert.equal((await f.authorize(session, f.request({ sequence: 3 }))).grantId, GRANT_ID);
  });
});

test('pending challenge and live session budgets are bounded', async t => {
  const f = fixture(t, { maxPending: 1, maxSessions: 1 }); const first = await f.challenge();
  await rejects(() => f.challenge()); const session = await f.complete(first);
  await rejects(() => f.challenge()); f.advance(10_001);
  assert.equal((await f.session()).identity.agentDid.toLowerCase(), f.actorDid);
  await rejects(() => f.authorize(session));
});
