import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlayerAccountHost } from './player-account-host.js';
import { createPlayerBindingLedger } from './player-bindings.js';
import { createGameSessionTokens } from './game-session.js';
import { generateKeyPairSync } from 'node:crypto';

const ORIGIN = 'https://game.example';
const RELAY = 'https://relay.interego.xwisee.com';
const nativeOwner = (userId = 'u-pk-player') => ({ userId,
  subjectDid: `did:web:identity.interego.xwisee.com:users:${userId}`,
  webId: `https://identity.interego.xwisee.com/users/${userId}/profile#me`,
  podUrl: `https://gate.interego.xwisee.com/${userId}/`,
  authenticatedAgentDid: `did:web:identity.interego.xwisee.com:agents:gaming-client-${userId}`,
  verifiedAt: '2026-10-16T12:00:00.000Z', issuer: RELAY + '/', verificationMethod: 'oauth-pkce+authenticated-mcp' });
const characterPointer = { kind: 'character', graphIri: 'urn:graph:hallowmarch:character:test-player',
  descriptorUrl: 'https://gate.interego.xwisee.com/u-pk-player/context-graphs/character.ttl', cid: 'sha256:character-fixture' };

// Test-only transport: CAS and recovery are real code paths; this is not a
// physical durability claim or a production memory-primary fallback.
class NativeStoreFixture {
  streams = new Map(); receipts = new Map(); commits = []; fail = false;
  readyCalls = 0; loadCalls = 0; uncertainCommit = false; loadGate = null; readOverride = undefined;
  async ready() { this.readyCalls++; if (this.fail) throw new Error('private native store details'); }
  async load(id) {
    this.loadCalls++;
    if (this.loadGate) await this.loadGate;
    if (this.fail) throw new Error('private native store details');
    if (this.readOverride !== undefined) return structuredClone(this.readOverride);
    return structuredClone(this.streams.get(id) ?? { version: 0, state: null });
  }
  async commit(id, request) {
    if (this.fail) throw new Error('private native store details');
    const key = id + ':' + request.idempotencyKey;
    if (this.receipts.has(key)) return structuredClone(this.receipts.get(key));
    const current = await this.load(id);
    if (request.expectedVersion !== current.version) throw Object.assign(new Error('conflict'), { code: 'VERSION_CONFLICT' });
    const result = { version: current.version + 1, state: structuredClone(request.state) };
    this.streams.set(id, result); this.receipts.set(key, result); this.commits.push(structuredClone(request));
    if (this.uncertainCommit) throw new Error('private native acknowledgement lost');
    return structuredClone(result);
  }
}

async function fixture(t, overrides = {}) {
  let clock = Date.parse('2026-10-16T12:00:00Z'), scope = 'mcp:read', userId = 'u-pk-player';
  const store = Object.hasOwn(overrides, 'store') ? overrides.store : new NativeStoreFixture();
  const accounts = overrides.accounts ?? new Map([
    ['guest-a', { id: 'guest-a', name: 'Alice', guest: true, pass: { secret: 'NEVER_IN_NATIVE_LEDGER' } }],
    ['guest-b', { id: 'guest-b', name: 'Bob', guest: true }],
  ]);
  const gameTokens = createGameSessionTokens({ secret: 'synthetic-signed-host-test-secret', now: () => clock });
  const claims = new Map(), issued = [], restored = [], legacyReads = [], faults = [], remote = [];
  const token = (id, fields = {}) => {
    const value = overrides.realTokens ? (fields.nativeDid ? gameTokens.issueNative(id, fields.nativeDid, { provisional: fields.provisional === true,
      ...(fields.ownerExpiresAt ? { expiresAt: fields.ownerExpiresAt } : {}) }).token : gameTokens.issueLegacy(id)) : `game-session-${id}-${claims.size}`;
    claims.set(value, overrides.realTokens ? gameTokens.read(value) : { id, exp: clock + 7_200_000, ...fields }); return value;
  };
  const aliceToken = token('guest-a'), bobToken = token('guest-b');
  const fetcher = async (input, init) => {
    const url = String(input); remote.push({ url, ...init });
    assert.equal(init.redirect, 'error');
    if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: RELAY + '/',
      authorization_endpoint: RELAY + '/authorize', token_endpoint: RELAY + '/token', response_types_supported: ['code'],
      scopes_supported: ['mcp:read', 'mcp:write'], client_id_metadata_document_supported: true,
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'] });
    if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ authorization_servers: [RELAY + '/'],
      affordances: [{ action: 'urn:iep:action:mcp:invoke', target: RELAY + '/mcp', method: 'POST' }] });
    if (url.endsWith('/token')) return Response.json({ access_token: 'native-access-secret', refresh_token: 'native-refresh-secret',
      token_type: 'Bearer', scope, expires_in: 3600 });
    assert.equal(url, RELAY + '/mcp');
    assert.deepEqual(JSON.parse(init.body).params, { name: 'get_pod_status', arguments: {} });
    const owner = nativeOwner(userId);
    return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {
      identity: { userId, did: owner.subjectDid, webId: owner.webId,
        ...(overrides.omitLifecycle ? {} : { provisionalPlay: overrides.oauthProvisionalPlay ?? false }) }, pod: `http://css.railway.internal:3456/${userId}/`,
      registry: { owner: owner.webId }, sessionAgent: { id: `gaming-client-${userId}`, did: owner.authenticatedAgentDid, scope: 'ReadWrite' },
    } } });
  };
  const host = createPlayerAccountHost({ store, publicOrigin: ORIGIN, now: () => clock, fetch: fetcher,
    tokenClaims: value => overrides.realTokens ? gameTokens.read(value) : claims.has(value) ? { ...claims.get(value) } : null,
    ...(overrides.realTokens ? { reauthenticationClaims: value => gameTokens.readForReauthentication(value),
      provisionalProofClaims: value => gameTokens.readForProvisionalProof(value) } : {}),
    getAccount: id => accounts.get(id) ?? null,
    restoreAccount: record => { restored.push(structuredClone(record)); const account = { ...record.accountSummary }; accounts.set(account.id, account); return account; },
    issueAppSession: (id, binding) => {
      issued.push({ id, binding: structuredClone(binding) });
      return { token: token(id, { nativeDid: binding.subjectDid, nativeVerifiedAt: clock,
        ...(binding.provisional ? { provisional: true, ownerExpiresAt: Date.parse(binding.expiresAt) } : {}) }),
        acct: { id, name: accounts.get(id).name, guest: accounts.get(id).guest }, nativeVerifiedUntil: clock + 3_600_000 };
    },
    readLegacySave: id => { legacyReads.push(id); return { character: id, inventory: ['old-wood'], privateSave: true }; },
    ...overrides,
  });
  await host.ready;
  const server = http.createServer(async (req, res) => {
    try { if (!await host.handle(req, res)) { res.writeHead(404); res.end(); } }
    catch (error) { faults.push(error); res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { host.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(faults, []); });
  const local = `http://127.0.0.1:${server.address().port}`;
  const request = (path, { method = 'GET', body, session = aliceToken, cookie, origin = ORIGIN, hostname = 'game.example' } = {}) => new Promise((resolve, reject) => {
    const req = http.request(local + path, { method, headers: { Host: hostname, ...(session ? { Authorization: 'Bearer ' + session } : {}),
      ...(cookie ? { Cookie: cookie } : {}), ...(method === 'POST' ? { Origin: origin, 'Content-Type': 'application/json' } : {}) } }, res => {
      const chunks = []; res.on('data', value => chunks.push(value)); res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const start = async (session = aliceToken, body = {}) => {
    const response = await request('/gaming/identity/start', { method: 'POST', session, body }); const payload = await response.json();
    const authorization = payload.authorizationUrl ? new URL(payload.authorizationUrl) : null;
    if (authorization) scope = authorization.searchParams.get('scope');
    return { response, payload, authorization, session, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const callback = flow => request('/gaming/identity/callback?' + new URLSearchParams({ code: 'test-issued-code', state: flow.authorization.searchParams.get('state') }),
    { session: undefined, cookie: flow.cookie });
  const claim = (flow, body = {}, session = flow.session) => request('/gaming/identity/claim', { method: 'POST', body, session, cookie: flow.cookie });
  const connect = async (session = aliceToken, body = {}) => {
    const flow = await start(session, body); assert.equal(flow.response.status, 200);
    assert.equal((await callback(flow)).status, 303); const response = await claim(flow, body);
    assert.equal(response.status, 200); return { flow, payload: await response.json() };
  };
  return { host, store, accounts, claims, gameTokens, issued, restored, legacyReads, remote, request, start, callback, claim, connect, token,
    aliceToken, bobToken, advance(ms) { clock += ms; }, nativeUser(value) { userId = value; }, nativeScope(value) { scope = value; }, clock: () => clock };
}

const noNativeCredentials = value => {
  const raw = JSON.stringify(value); assert(!raw.includes('native-access-secret')); assert(!raw.includes('native-refresh-secret'));
};

test('unbound account status trusts the game bearer only and exposes no claimed native owner', async t => {
  const f = await fixture(t);
  const response = await f.request('/gaming/identity/status'); assert.equal(response.status, 200);
  const status = await response.json(); assert.equal(status.verified, false); assert.equal(status.bound, false); assert.equal(status.binding, null);
  assert.equal(status.saveAuthority, 'legacy-server'); assert.deepEqual(status.recordLinks, {});
  assert.equal((await f.request('/gaming/identity/status', { session: 'forged-game-session' })).status, 401);
  assert.equal((await f.start('forged-game-session', { accountId: 'guest-a', nativeDid: nativeOwner().subjectDid })).response.status, 401);
  assert.equal(f.store.commits.length, 0); assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(f.aliceToken) }), null);
});

const playKey = () => generateKeyPairSync('ec', { namedCurve: 'prime256v1' }).publicKey.export({ format: 'jwk' });
const proofFixture = 'A'.repeat(86);
async function provisionalFixture(t, options = {}) {
  const publicKeyJwk = playKey(), verified = [];
  let f, guestExpiresAt;
  f = await fixture(t, { allowOwnerBrowserHandoff: true, playGrantSigner: async payload => ({ _signed_payload: JSON.stringify(payload), _signature: 'native-service-signature' }),
    provisionalProofVerifier: async input => {
      verified.push(structuredClone(input));
      if (![proofFixture, 'B'.repeat(86)].includes(input.proof) || input.attestation !== 'provider-attestation') throw new Error('refused');
      const owner = nativeOwner('u-play-player');
      return { valid: true, provisional: true, issuer: 'https://identity.interego.xwisee.com', ownerDid: owner.subjectDid,
        userId: owner.userId, webId: owner.webId, podUrl: owner.podUrl, authenticatedAgentDid: owner.authenticatedAgentDid,
        publicKeyJwk, expiresAt: guestExpiresAt ??= Math.floor((f.clock() + 86400000) / 1000), capabilities: ['human-play', 'own-pod-checkpoint'] };
    }, ...options });
  async function begin(session = f.aliceToken) {
    const challengeResponse = await f.request('/gaming/identity/play/challenge', { method: 'POST', session, body: { publicKeyJwk } });
    assert.equal(challengeResponse.status, 200); const challenge = await challengeResponse.json();
    const completeBody = { attestation: 'provider-attestation', challenge: challenge.challenge, proof: proofFixture };
    const response = await f.request('/gaming/identity/play/complete', { method: 'POST', session, body: completeBody });
    return { response, result: await response.json(), challenge, completeBody };
  }
  async function target(session) {
    const challengeResponse = await f.request('/gaming/identity/play/claim-challenge', { method: 'POST', session, body: {} });
    assert.equal(challengeResponse.status, 200); const challenge = await challengeResponse.json();
    const response = await f.request('/gaming/identity/claim-owner/start', { method: 'POST', session, body: {
      ownerPodWriteAccess: true, attestation: 'provider-attestation', challenge: challenge.challenge, proof: proofFixture } });
    assert.equal(response.status, 200); const start = await response.json(), authorization = new URL(start.authorizationUrl);
    const cookie = response.headers.get('set-cookie').split(';')[0]; f.nativeScope(authorization.searchParams.get('scope'));
    const callback = await f.request('/gaming/identity/claim-owner/callback?' + new URLSearchParams({ code: 'test-code', state: authorization.searchParams.get('state') }), { cookie });
    if (callback.status !== 303) { const result = await callback.json(); assert.notEqual(callback.status, 502, JSON.stringify(result)); return { callback, result }; }
    assert.equal(callback.headers.get('location'), '/gaming/identity/finish?purpose=character-claim-target');
    const handoff = await f.request('/gaming/identity/claim-owner/claim', { method: 'POST', session, cookie, body: { ownerPodWriteAccess: true } });
    assert.equal(handoff.status, 200); return { callback, result: await handoff.json() };
  }
  return { ...f, publicKeyJwk, verified, begin, target };
}
const targetReference = () => ({ ...characterPointer, nativeRevision: 'sha256:' + 'a'.repeat(64), recordCid: 'sha256:target-record',
  digest: 'sha256:target-digest', proofKind: 'owner-key-authenticated-checkpoint' });
const finalizeBody = target => ({ claimOperationId: target.appSession.claimOperationId, attestation: 'provider-attestation',
  proof: proofFixture, targetRecord: targetReference(), readConfirmed: true });

test('native provisional admission confirms a durable owner before granting human-only play', async t => {
  const f = await provisionalFixture(t), play = await f.begin(); assert.equal(play.response.status, 200);
  assert.equal(play.challenge.audience, ORIGIN); assert.equal(play.challenge.relayUrl, RELAY);
  assert.equal(play.result.binding.provisional, true); assert.equal(f.store.commits.length, 1);
  const session = play.result.appSession.token, client = { acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) };
  assert.equal(f.host.humanPrincipalFor(client), nativeOwner('u-play-player').subjectDid);
  assert.equal(f.host.principalFor(client), null);
  await assert.rejects(f.host.ownerForRequest({ headers: { authorization: 'Bearer ' + session } }), /native_signin_required/);
  const status = await (await f.request('/gaming/identity/status', { session })).json();
  assert.equal(status.verified, true); assert.equal(status.provisional, true); assert.equal(status.provisionalPlay.enabled, true);
  const retry = await f.request('/gaming/identity/play/complete', { method: 'POST', body: play.completeBody });
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), play.result); assert.equal(f.store.commits.length, 1);
  assert.equal((await f.request('/gaming/identity/play/complete', { method: 'POST', session: f.bobToken, body: play.completeBody })).status, 409);
  assert.equal((await f.request('/gaming/identity/play/challenge', { method: 'POST', session, body: { publicKeyJwk: playKey() } })).status, 403);
  f.advance(3600001); assert.equal(f.host.humanPrincipalFor(client), null);
  const staleStatus = await (await f.request('/gaming/identity/status', { session })).json();
  assert.equal(staleStatus.verified, false); assert.equal(staleStatus.provisional, true);
  assert.equal(staleStatus.binding, null); assert.deepEqual(staleStatus.recordLinks, {});
});

test('hour-two guest renewal needs fresh key proof and retains the exact owner, pod and fixed deadline', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), first = await f.begin();
  const old = first.result.appSession.token, originalBinding = f.host.bindingForAccount('guest-a');
  const commits = structuredClone(f.store.commits), issued = f.issued.length;
  f.advance(3_600_001);
  assert.equal(f.gameTokens.read(old), null); assert.equal(f.gameTokens.readForReauthentication(old), null);
  const proofOnly = f.gameTokens.readForProvisionalProof(old);
  assert.equal(proofOnly.purpose, 'provisional-play-proof-only');
  const client = { acct: f.accounts.get('guest-a'), authClaims: proofOnly };
  assert.equal(f.host.humanPrincipalFor(client), null); assert.equal(f.host.principalFor(client), null);
  for (const route of ['/gaming/identity/status', '/gaming/identity/legacy-import']) {
    assert.equal((await f.request(route, { session: old })).status, 401);
  }
  assert.equal((await f.start(old)).response.status, 401, 'guest proof is not generic OAuth reauthentication');
  assert.equal((await f.request('/gaming/identity/play/claim-challenge', { method: 'POST', session: old, body: {} })).status, 401);
  assert.equal((await f.request('/gaming/identity/record-link', { method: 'POST', session: old, body: characterPointer })).status, 401);
  assert.equal((await f.request('/gaming/identity/play/challenge', { method: 'POST', session: old,
    body: { publicKeyJwk: playKey() } })).status, 403, 'different browser key cannot refresh');
  const badChallenge = await (await f.request('/gaming/identity/play/challenge', { method: 'POST', session: old,
    body: { publicKeyJwk: f.publicKeyJwk } })).json();
  const badProof = await f.request('/gaming/identity/play/complete', { method: 'POST', session: old,
    body: { attestation: 'provider-attestation', challenge: badChallenge.challenge, proof: 'C'.repeat(86) } });
  assert.notEqual(badProof.status, 200); assert.equal(f.issued.length, issued);
  assert.deepEqual(f.store.commits, commits, 'a challenge or rejected proof has no binding/session effect');
  const refreshed = await f.begin(old); assert.equal(refreshed.response.status, 200);
  const fresh = f.gameTokens.read(refreshed.result.appSession.token);
  assert.equal(fresh.provisional, true); assert.equal(fresh.nativeDid, originalBinding.subjectDid);
  assert.equal(fresh.exp, f.clock() + 3_600_000);
  assert.equal(f.host.bindingForAccount('guest-a').podUrl, originalBinding.podUrl);
  assert.equal(f.host.bindingForAccount('guest-a').expiresAt, originalBinding.expiresAt);
  assert.equal(refreshed.result.binding.expiresAt, originalBinding.expiresAt);
  assert.deepEqual(f.store.commits, commits, 'renewal reuses the confirmed native owner');
  assert.equal(f.host.humanPrincipalFor({ acct: f.accounts.get('guest-a'), authClaims: fresh }), originalBinding.subjectDid);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: fresh }), null);
  assert.equal(f.gameTokens.read(old), null, 'only the new one-hour game token is live');
});

test('guest proof renewal stops at the original guest deadline and never gives a fresh owner lifetime', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), first = await f.begin(), old = first.result.appSession.token;
  const deadline = Date.parse(first.result.binding.expiresAt);
  f.advance(23.5 * 3_600_000);
  const last = await f.begin(old); assert.equal(last.response.status, 200);
  assert.equal(f.gameTokens.read(last.result.appSession.token).exp, deadline, 'last game session is capped by the guest deadline');
  f.advance(0.5 * 3_600_000);
  assert(f.gameTokens.readForProvisionalProof(old), 'HMAC proof window alone is insufficient at the guest deadline');
  assert.equal((await f.request('/gaming/identity/play/challenge', { method: 'POST', session: old,
    body: { publicKeyJwk: f.publicKeyJwk } })).status, 401);
  assert.equal(f.gameTokens.read(last.result.appSession.token), null);
  assert.equal(f.host.bindingForAccount('guest-a').expiresAt, first.result.binding.expiresAt);
});

test('expired canonical, foreign-owner and forged tokens cannot use the provisional proof route', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), first = await f.begin();
  const old = first.result.appSession.token, owner = first.result.binding.subjectDid;
  const canonical = f.gameTokens.issueNative('guest-a', owner).token;
  const foreign = f.gameTokens.issueNative('guest-a', nativeOwner('u-pk-foreign').subjectDid, { provisional: true }).token;
  const foreignAccount = f.gameTokens.issueNative('guest-b', owner, { provisional: true }).token;
  f.advance(3_600_001); const before = f.issued.length, verified = f.verified.length;
  for (const session of [canonical, foreign, foreignAccount, 'forged', old.slice(0, -1) + '!']) {
    assert.equal((await f.request('/gaming/identity/play/challenge', { method: 'POST', session,
      body: { publicKeyJwk: f.publicKeyJwk } })).status, 401);
  }
  assert.equal(f.issued.length, before); assert.equal(f.verified.length, verified);
});

test('expired guest renewal rereads native ownership and refuses a source claimed by another host', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), first = await f.begin(), old = first.result.appSession.token;
  const external = createPlayerBindingLedger({ store: f.store, now: f.clock }); await external.ready;
  await external.promoteProvisional('guest-a', first.result.binding.subjectDid, nativeOwner(), targetReference(),
    { operationId: 'external-confirmed-character-claim' });
  assert.equal(f.host.bindingForAccount('guest-a').provisional, true, 'the local disposable view predates the external claim');
  f.advance(3_600_001); const before = f.issued.length;
  assert.equal((await f.request('/gaming/identity/play/challenge', { method: 'POST', session: old,
    body: { publicKeyJwk: f.publicKeyJwk } })).status, 401);
  assert.equal(f.host.bindingForAccount('guest-a').provisional, undefined, 'proof refresh observes the confirmed canonical transition');
  assert.equal(f.issued.length, before);
});

test('claim OAuth is purpose limited until fresh source proof and exact target readback finalize durable ownership', async t => {
  const f = await provisionalFixture(t), play = await f.begin(), session = play.result.appSession.token;
  const target = (await f.target(session)).result;
  assert(target.appSession, JSON.stringify(target));
  assert.equal(target.appSession.purpose, 'character-claim-target'); assert.equal(target.appSession.token, undefined);
  assert.equal(target.nativeSession.accessToken, 'native-access-secret'); assert.equal(f.store.commits.length, 1);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) }), null);
  const body = finalizeBody(target);
  assert.equal((await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session: f.bobToken, body })).status, 409);
  assert.equal((await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: { ...body, readConfirmed: false } })).status, 400);
  const response = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body }); assert.equal(response.status, 200);
  const claimed = await response.json(); assert.equal(claimed.claimed, true); assert.equal(claimed.provisional, false);
  assert.equal(claimed.appSession.acct.id, 'guest-a'); assert.equal(f.store.commits.length, 2);
  const client = { acct: f.accounts.get('guest-a'), authClaims: f.claims.get(claimed.appSession.token) };
  assert.equal(f.host.principalFor(client), nativeOwner().subjectDid);
  const retry = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: { ...body, proof: 'B'.repeat(86) } });
  assert.equal(retry.status, 200); assert.deepEqual(await retry.json(), claimed); assert.equal(f.store.commits.length, 2);
  const canonicalRetry = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session: claimed.appSession.token,
    body: { ...body, proof: 'B'.repeat(86) } });
  assert.equal(canonicalRetry.status, 200); assert.deepEqual(await canonicalRetry.json(), claimed); assert.equal(f.store.commits.length, 2);
  const otherCanonicalSession = f.token(claimed.appSession.acct.id, { nativeDid: claimed.binding.subjectDid, nativeVerifiedAt: f.clock() });
  assert.equal((await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session: otherCanonicalSession, body })).status, 409);
  assert.equal((await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...body, targetRecord: { ...body.targetRecord, recordCid: 'sha256:changed' } } })).status, 409);
  assert.equal(f.host.humanPrincipalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) }), null);
  assert(f.verified.some(value => value.challenge === target.appSession.sourceChallenge));
  const reentry = await f.begin(f.bobToken); assert.equal(reentry.response.status, 409);
});

test('canonical character conflict preserves both owner records and never promotes guest progress', async t => {
  const f = await provisionalFixture(t), existing = await f.connect(f.bobToken), canonicalToken = existing.payload.appSession.token;
  const link = await f.request('/gaming/identity/record-link', { method: 'POST', session: canonicalToken, body: { ...characterPointer, cid: 'sha256:existing-character' } });
  assert.equal(link.status, 200);
  const play = await f.begin(), session = play.result.appSession.token, target = (await f.target(session)).result;
  const before = structuredClone(f.store.streams.get('player-bindings-v1'));
  const response = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: finalizeBody(target) });
  assert.equal(response.status, 409); assert.equal((await response.json()).error, 'claim_character_conflict');
  assert.deepEqual(f.store.streams.get('player-bindings-v1'), before);
  assert.equal(f.host.bindingForAccount('guest-a').provisional, true); assert.equal(f.issued.length, 2);
});

test('claim-only OAuth rejects provisional or absent lifecycle metadata before handoff', async t => {
  for (const options of [{ oauthProvisionalPlay: true }, { omitLifecycle: true }]) await t.test(JSON.stringify(options), async child => {
    const f = await provisionalFixture(child, options), play = await f.begin();
    const target = await f.target(play.result.appSession.token); assert.equal(target.callback.status, 403);
    assert.equal(target.result.error, 'canonical_native_owner_required'); assert.equal(f.store.commits.length, 1);
  });
});

test('same-owner permanent credential claim keeps the account and owner pod', async t => {
  const f = await provisionalFixture(t), play = await f.begin(); f.nativeUser('u-play-player');
  const target = (await f.target(play.result.appSession.token)).result;
  const reference = { ...targetReference(), descriptorUrl: 'https://gate.interego.xwisee.com/u-play-player/context-graphs/character.ttl' };
  const response = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session: play.result.appSession.token,
    body: { ...finalizeBody(target), targetRecord: reference } });
  assert.equal(response.status, 200); const claimed = await response.json();
  assert.equal(claimed.binding.subjectDid, play.result.binding.subjectDid); assert.equal(claimed.binding.provisional, undefined);
  assert.equal(claimed.appSession.acct.id, 'guest-a');
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(play.result.appSession.token) }), null);
  assert.equal(f.host.humanPrincipalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(play.result.appSession.token) }), null);
});

test('an uncertain native claim commit recovers by exact operation readback without restoring guest authority', async t => {
  const f = await provisionalFixture(t), play = await f.begin(), session = play.result.appSession.token;
  const target = (await f.target(session)).result, body = finalizeBody(target);
  f.store.uncertainCommit = true;
  const uncertain = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body });
  assert.equal(uncertain.status, 503); assert.equal(f.issued.length, 1);
  f.store.uncertainCommit = false;
  const retry = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body });
  assert.equal(retry.status, 200); const claimed = await retry.json();
  assert.equal(claimed.claimed, true); assert.equal(f.store.commits.length, 2); assert.equal(f.issued.length, 2);
  assert.equal(f.host.humanPrincipalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) }), null);
});

test('committed claim receipt survives host restart, lease expiry and expired source token without another native write', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), play = await f.begin(), session = play.result.appSession.token;
  const target = (await f.target(session)).result, body = finalizeBody(target);
  const initial = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body });
  assert.equal(initial.status, 200); const claimed = await initial.json(), baseline = structuredClone(f.store.commits);
  f.host.close();
  const restarted = await provisionalFixture(t, { realTokens: true, store: f.store, accounts: f.accounts,
    provisionalProofVerifier: async input => {
      assert.match(input.challenge, /^[A-Za-z0-9_-]{43}$/);
      if (input.proof !== input.challenge + input.challenge || input.attestation !== 'provider-attestation') throw Error('refused');
      const owner = nativeOwner('u-play-player');
      return { valid: true, provisional: true, issuer: 'https://identity.interego.xwisee.com', ownerDid: owner.subjectDid,
        userId: owner.userId, webId: owner.webId, podUrl: owner.podUrl, authenticatedAgentDid: owner.authenticatedAgentDid,
        publicKeyJwk: f.publicKeyJwk, expiresAt: Math.floor(Date.parse(play.result.binding.expiresAt) / 1000), capabilities: ['human-play', 'own-pod-checkpoint'] };
    } });
  restarted.advance(3_600_001);
  assert.equal(restarted.gameTokens.read(session), null);
  assert.equal((await restarted.request('/gaming/identity/status', { session })).status, 401);
  const challengeBody = { claimOperationId: body.claimOperationId, targetRecord: body.targetRecord, readConfirmed: true };
  const reads = f.store.loadCalls;
  assert.equal((await restarted.request('/gaming/identity/play/claim-recovery-challenge', { method: 'POST', session: 'forged', body: challengeBody })).status, 401);
  assert.equal(f.store.loadCalls, reads, 'unauthenticated recovery cannot trigger native reads');
  assert.equal((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body })).status, 409,
    'the captured original completion packet cannot mint another canonical session');
  assert.equal(restarted.issued.length, 0);
  const challengeResponse = await restarted.request('/gaming/identity/play/claim-recovery-challenge', { method: 'POST', session, body: challengeBody });
  assert.equal(challengeResponse.status, 200); const nonce = await challengeResponse.json();
  assert.notEqual(nonce.challenge, target.appSession.sourceChallenge);
  const recoveryBody = { ...body, recoveryChallenge: nonce.challenge, proof: nonce.challenge + nonce.challenge };
  assert.notEqual((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...recoveryBody, proof: body.proof } })).status, 200, 'a captured signature does not prove the new nonce');
  assert.equal((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session: restarted.bobToken, body: recoveryBody })).status, 409);
  assert.equal((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...recoveryBody, claimOperationId: 'different-claim-operation' } })).status, 409);
  assert.equal((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...recoveryBody, targetRecord: { ...body.targetRecord, recordCid: 'sha256:changed' } } })).status, 409);
  const response = await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: recoveryBody });
  assert.equal(response.status, 200); const recovered = await response.json();
  assert.equal(recovered.binding.subjectDid, claimed.binding.subjectDid); assert.equal(recovered.appSession.acct.id, claimed.appSession.acct.id);
  assert.equal(restarted.gameTokens.read(recovered.appSession.token).provisional, undefined);
  const duplicate = await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: recoveryBody });
  assert.equal(duplicate.status, 200); assert.deepEqual(await duplicate.json(), recovered);
  assert.equal(restarted.issued.length, 1, 'a consumed nonce returns its original session without minting another');
  restarted.advance(120001);
  assert.equal((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body: recoveryBody })).status, 409);
  const freshNonce = await (await restarted.request('/gaming/identity/play/claim-recovery-challenge', { method: 'POST', session, body: challengeBody })).json();
  assert.notEqual(freshNonce.challenge, nonce.challenge);
  assert.notEqual((await restarted.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...recoveryBody, recoveryChallenge: freshNonce.challenge } })).status, 200, 'another nonce requires another key signature');
  assert.equal(restarted.issued.length, 1);
  assert.deepEqual(f.store.commits, baseline, 'receipt recovery must never repeat promotion or mutate a private/public save');
  assert.equal((await restarted.request('/gaming/identity/play/challenge', { method: 'POST', session,
    body: { publicKeyJwk: f.publicKeyJwk } })).status, 401, 'reconciliation does not revive the retired guest');
});

test('expired uncommitted claim lease cannot create ownership through receipt recovery', async t => {
  const f = await provisionalFixture(t, { realTokens: true }), play = await f.begin(), session = play.result.appSession.token;
  const target = (await f.target(session)).result, body = finalizeBody(target), baseline = structuredClone(f.store.commits);
  f.advance(300_001);
  const response = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session, body });
  assert.equal(response.status, 409); assert.deepEqual(f.store.commits, baseline);
  assert.equal(f.host.bindingForAccount('guest-a').provisional, true);
});

test('explicit use-existing readback preserves canonical character and does not merge guest participation', async t => {
  const f = await provisionalFixture(t), existing = await f.connect(f.bobToken), canonicalToken = existing.payload.appSession.token;
  const reference = targetReference();
  assert.equal((await f.request('/gaming/identity/record-link', { method: 'POST', session: canonicalToken, body: characterPointer })).status, 200);
  const play = await f.begin(), session = play.result.appSession.token, target = (await f.target(session)).result;
  const response = await f.request('/gaming/identity/play/claim-complete', { method: 'POST', session,
    body: { ...finalizeBody(target), targetRecord: reference, selection: 'use-existing' } });
  assert.equal(response.status, 200); const claimed = await response.json(); assert.equal(claimed.appSession.acct.id, 'guest-b');
  assert.equal(f.host.bindingForAccount('guest-a').provisional, true);
  assert.equal(f.host.humanPrincipalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) }), null);
  const ledger = new createPlayerBindingLedger({ store: f.store }); await ledger.ready;
  assert.deepEqual(ledger.bindingForAccount('guest-b').records.character, characterPointer);
  assert.equal(ledger.bindingForAccount('guest-a').claim.targetAccountId, 'guest-b');
});


test('native callback commits the owner ledger before issuing a game session and read flow hands off no native bearer', async t => {
  const f = await fixture(t); const { payload } = await f.connect();
  assert.equal(f.store.commits.length, 1); assert.equal(f.issued.length, 1); assert(payload.appSession.token); assert.equal(payload.nativeSession, undefined);
  const status = await (await f.request('/gaming/identity/status', { session: payload.appSession.token })).json();
  assert.equal(status.bound, true); assert.equal(status.verified, true); assert.equal(status.binding.subjectDid, nativeOwner().subjectDid);
  assert.equal(status.saveAuthority, 'player-pod'); assert.equal(status.legacyImportAvailable, true);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(payload.appSession.token) }), nativeOwner().subjectDid);
  assert.equal(f.host.isBound('guest-a'), true); assert.equal(f.host.isBound('guest-b'), false);
  assert(!JSON.stringify(f.store.commits).includes('NEVER_IN_NATIVE_LEDGER')); noNativeCredentials(f.store.commits); noNativeCredentials(f.issued);
});

test('bound accounts require a fresh matching native proof before disclosing binding or owner record pointers', async t => {
  const f = await fixture(t); const { payload } = await f.connect(); const freshToken = payload.appSession.token;
  const linked = await f.request('/gaming/identity/record-link', { method: 'POST', session: freshToken, body: characterPointer }); assert.equal(linked.status, 200);
  for (const session of [f.aliceToken,
    f.token('guest-a', { nativeDid: nativeOwner('u-pk-other').subjectDid, nativeVerifiedAt: f.clock() }),
    f.token('guest-a', { nativeDid: nativeOwner().subjectDid, nativeVerifiedAt: f.clock() + 1 }),
    f.token('guest-a', { nativeDid: nativeOwner().subjectDid, nativeVerifiedAt: f.clock() - 3_600_001 }),
  ]) {
    const status = await (await f.request('/gaming/identity/status', { session })).json();
    assert.equal(status.bound, true); assert.equal(status.status, 'native_signin_required'); assert.equal(status.verified, false);
    assert.equal(status.binding, null); assert.deepEqual(status.recordLinks, {}); assert.equal(status.legacyImportAvailable, false);
    assert.equal((await f.request('/gaming/identity/record-link', { method: 'POST', session, body: characterPointer })).status, 403);
    assert.equal((await f.request('/gaming/identity/legacy-import', { session })).status, 403);
    assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(session) }), null);
  }
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-b'), authClaims: f.claims.get(freshToken) }), null);
});

test('record links derive their account and owner from the fresh proof and store only a whitelisted owner-pod pointer', async t => {
  const f = await fixture(t); const { payload } = await f.connect(); const session = payload.appSession.token;
  const response = await f.request('/gaming/identity/record-link', { method: 'POST', session, body: { ...characterPointer,
    accountId: 'guest-b', subjectDid: nativeOwner('u-pk-other').subjectDid, save: { inventory: ['private'] }, nativeVerified: true } });
  assert.equal(response.status, 200); const result = await response.json(); assert.equal(result.ok, true); assert.deepEqual(result.pointer, characterPointer);
  const status = await (await f.request('/gaming/identity/status', { session })).json(); assert.deepEqual(status.recordLinks.character, characterPointer);
  assert.equal((await f.request('/gaming/identity/record-link', { method: 'POST', session, origin: 'https://evil.example', body: characterPointer })).status, 403);
  const foreign = await f.request('/gaming/identity/record-link', { method: 'POST', session, body: { ...characterPointer,
    descriptorUrl: 'https://gate.interego.xwisee.com/u-pk-other/context-graphs/private.ttl' } }); assert(foreign.status >= 400);
  assert(!JSON.stringify(f.store.commits).includes('inventory')); assert(!JSON.stringify(f.store.commits).includes('nativeVerified'));
});

test('legacy import reads only the fresh native owner account and labels its save nonauthoritative', async t => {
  const f = await fixture(t); assert.equal((await f.request('/gaming/identity/legacy-import')).status, 403);
  const { payload } = await f.connect(); const response = await f.request('/gaming/identity/legacy-import?accountId=guest-b', { session: payload.appSession.token });
  assert.equal(response.status, 200); const imported = await response.json(); assert.equal(imported.save.character, 'guest-a');
  assert.equal(imported.source, 'legacy-local-import'); assert.equal(imported.authoritative, false); assert(!f.legacyReads.includes('guest-b'));
});

test('a returning native owner restores the canonical account from the ledger without claiming a new guest', async t => {
  const store = new NativeStoreFixture(); const seed = createPlayerBindingLedger({ store }); await seed.ready;
  await seed.bindVerified(nativeOwner(), 'original-account', { operationId: 'initial-owner',
    accountSummary: { id: 'original-account', name: 'Original Traveller', guest: false } });
  const f = await fixture(t, { store }); const guestBefore = structuredClone(f.accounts.get('guest-a'));
  const { payload } = await f.connect(); assert.equal(payload.appSession.acct.id, 'original-account');
  assert.equal(f.restored.length, 1); assert.equal(f.issued[0].id, 'original-account'); assert.deepEqual(f.accounts.get('guest-a'), guestBefore);
  assert.equal(f.host.isBound('guest-a'), false); assert.equal(f.host.isBound('original-account'), true);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('original-account'), authClaims: f.claims.get(payload.appSession.token) }), nativeOwner().subjectDid);
});

test('expired initiating game sessions cannot finish native identity binding', async t => {
  const f = await fixture(t); f.claims.set(f.aliceToken, { id: 'guest-a', exp: f.clock() + 1000 });
  const flow = await f.start(); f.advance(1001); const response = await f.callback(flow);
  assert(response.status >= 400); assert.equal(f.store.commits.length, 0); assert.equal(f.issued.length, 0); noNativeCredentials(await response.text());
  assert.deepEqual(f.host.status().verificationDiagnostics.lastFailure, { stage: 'ready-proof', code: 'game_account_required' });
});

test('host verification diagnostics expose bounded fixed stage counters and a detached safe ledger snapshot', async t => {
  const f = await fixture(t);
  const before = f.host.status().verificationDiagnostics;
  assert.equal(before.attempts, 0); assert.equal(before.failed, 0); assert.equal(before.inFlight, 0); assert.equal(before.lastFailure, null);
  assert.deepEqual(Object.keys(before.stages), ['ready-proof', 'ledger-bind', 'account-restore', 'issue-app-session']);
  await f.connect();
  const status = f.host.status(), diagnostics = status.verificationDiagnostics;
  assert.equal(diagnostics.attempts, 1); assert.equal(diagnostics.succeeded, 1); assert.equal(diagnostics.failed, 0); assert.equal(diagnostics.inFlight, 0);
  for (const stage of Object.values(diagnostics.stages)) assert.deepEqual(stage, { entered: 1, failed: 0, codes: {} });
  assert.deepEqual(diagnostics.ledger, { configured: true, ready: true });
  for (const value of ['guest-a', nativeOwner().subjectDid, nativeOwner().podUrl, 'native-access-secret', 'native-refresh-secret', 'player-bind:', 'operationId', 'timestamp', 'stack']) {
    assert(!JSON.stringify(diagnostics).includes(value));
  }
  diagnostics.stages['ledger-bind'].codes.native_refused = 777; diagnostics.ledger.ready = false; diagnostics.attempts = 999;
  const fresh = f.host.status().verificationDiagnostics;
  assert.equal(fresh.attempts, 1); assert.deepEqual(fresh.stages['ledger-bind'].codes, {}); assert.equal(fresh.ledger.ready, true);
  const accountStatus = await (await f.request('/gaming/identity/status')).json();
  assert.equal(accountStatus.verificationDiagnostics, undefined, 'per-account wire response remains unchanged');
});

test('native ledger failures retain the OAuth 409 response and report only fixed code and host stage', async t => {
  for (const code of ['VERSION_CONFLICT', 'NATIVE_COMMIT_FENCED', 'NATIVE_COMMIT_CAPACITY', 'COMMIT_UNCERTAIN', 'FENCED']) {
    await t.test(code, async st => {
      const f = await fixture(st, { ledgerOptions: { conflictRetries: 0 } }); const flow = await f.start();
      let attempts = 0;
      f.store.commit = async () => { attempts++; throw Object.assign(new Error('PRIVATE_STORE_MESSAGE https://secret.example/owner'), { code }); };
      const response = await f.callback(flow), body = await response.text();
      assert.equal(response.status, 409); assert(body.includes('identity_binding_rejected')); assert(!body.includes('PRIVATE_STORE_MESSAGE'));
      assert.equal(attempts, 1); assert.equal(f.issued.length, 0); assert.equal(f.store.commits.length, 0);
      const diagnostic = f.host.status().verificationDiagnostics;
      assert.deepEqual(diagnostic.lastFailure, { stage: 'ledger-bind', code });
      assert.equal(diagnostic.stages['ledger-bind'].codes[code], 1); assert.equal(diagnostic.failed, 1); assert.equal(diagnostic.inFlight, 0);
      assert(!JSON.stringify(diagnostic).includes('PRIVATE_STORE_MESSAGE')); assert(!JSON.stringify(diagnostic).includes('secret.example'));
      assert.equal(f.host.status().callbackFailures.identity_binding_rejected, 1);
    });
  }
});

test('unknown native ledger codes and error details never escape status diagnostics', async t => {
  const f = await fixture(t); const flow = await f.start();
  const secret = 'PRIVATE_TOKEN_OWNER_URL_OPERATION_ID';
  f.store.commit = async () => { throw Object.assign(new Error(secret), { code: secret, accountId: secret, token: secret, operationId: secret }); };
  assert.equal((await f.callback(flow)).status, 409);
  const diagnostics = f.host.status().verificationDiagnostics;
  assert.deepEqual(diagnostics.lastFailure, { stage: 'ledger-bind', code: 'other' });
  assert.deepEqual(diagnostics.ledger, { configured: true, ready: false }); assert(!JSON.stringify(f.host.status()).includes(secret));
});

test('status polling never evaluates a foreign code getter retained by the native binding ledger', async t => {
  const f = await fixture(t), flow = await f.start(); let codeReads = 0;
  const error = new Error('PRIVATE_RETAINED_STORE_MESSAGE');
  Object.defineProperty(error, 'code', { get() { codeReads++; return 'PRIVATE_RETAINED_STORE_CODE'; } });
  f.store.commit = async () => { throw error; };
  assert.equal((await f.callback(flow)).status, 409);
  const afterCallback = codeReads;
  const first = f.host.status(), second = f.host.status();
  assert.equal(codeReads, afterCallback, 'diagnostic reads must not add to existing ledger error handling');
  assert.deepEqual(first.verificationDiagnostics.lastFailure, { stage: 'ledger-bind', code: 'other' });
  assert.deepEqual(second.verificationDiagnostics.ledger, { configured: true, ready: false });
  assert(!JSON.stringify([first, second]).includes('PRIVATE_RETAINED'));
});

test('canonical account restoration failure is distinct from binding and does not issue a session or rewrite the binding', async t => {
  const store = new NativeStoreFixture(), seed = createPlayerBindingLedger({ store }); await seed.ready;
  await seed.bindVerified(nativeOwner(), 'original-account', { operationId: 'seed-canonical',
    accountSummary: { id: 'original-account', name: 'Original Traveller', guest: false } });
  const f = await fixture(t, { store, restoreAccount: () => null }), before = structuredClone(store.commits);
  const flow = await f.start(), response = await f.callback(flow);
  assert.equal(response.status, 409); assert((await response.text()).includes('identity_binding_rejected'));
  assert.deepEqual(f.host.status().verificationDiagnostics.lastFailure, { stage: 'account-restore', code: 'account_restore_failed' });
  assert.deepEqual(store.commits, before); assert.equal(f.issued.length, 0);
});

test('app session validation failure retains the confirmed ledger and cannot create a handoff', async t => {
  const f = await fixture(t, { issueAppSession: () => ({ token: 'PRIVATE_BAD_SESSION', acct: { id: 'wrong-account' } }) });
  const flow = await f.start(), response = await f.callback(flow);
  assert.equal(response.status, 409); assert((await response.text()).includes('identity_binding_rejected'));
  const diagnostics = f.host.status().verificationDiagnostics;
  assert.deepEqual(diagnostics.lastFailure, { stage: 'issue-app-session', code: 'app_session_unavailable' });
  assert.equal(f.store.commits.length, 1); assert.equal(f.host.status().readyHandoffs, 0);
  assert(!JSON.stringify(f.host.status()).includes('PRIVATE_BAD_SESSION'));
});

test('foreign exception getters are not evaluated by diagnostics and in-flight counts settle on rejection', async t => {
  let reject, entered, codeReads = 0;
  const started = new Promise(resolve => { entered = resolve; }), blocked = new Promise((_, no) => { reject = no; });
  const f = await fixture(t, { issueAppSession: async () => { entered(); return blocked; } });
  const flow = await f.start(), callback = f.callback(flow); await started;
  const active = f.host.status().verificationDiagnostics;
  assert.equal(active.inFlight, 1); assert.equal(active.stages['issue-app-session'].entered, 1); assert.equal(active.failed, 0);
  const error = new Error('PRIVATE_FOREIGN_MESSAGE');
  Object.defineProperty(error, 'code', { get() { codeReads++; return 'PRIVATE_FOREIGN_CODE'; } });
  reject(error);
  const response = await callback; assert.equal(response.status, 409); assert.equal(codeReads, 0);
  const final = f.host.status().verificationDiagnostics;
  assert.equal(final.inFlight, 0); assert.deepEqual(final.lastFailure, { stage: 'issue-app-session', code: 'other' });
  assert(!JSON.stringify(f.host.status()).includes('PRIVATE_FOREIGN'));
});

test('native store failure never promotes a proposed binding or issues a fresh application session', async t => {
  const f = await fixture(t); const flow = await f.start(); f.store.fail = true;
  const response = await f.callback(flow); assert(response.status >= 400); assert.equal(f.issued.length, 0); assert.equal(f.store.commits.length, 0);
  const text = await response.text(); assert(!text.includes('private native store details')); noNativeCredentials(text);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(f.aliceToken) }), null);
});

test('a failed native startup recovers through a fresh native readiness/readback without restarting the host', async t => {
  const store = new NativeStoreFixture(); store.fail = true;
  const f = await fixture(t, { store }); assert.equal(f.host.status().enabled, false);
  store.fail = false;
  const response = await f.request('/gaming/identity/status'); assert.equal(response.status, 200);
  assert.equal((await response.json()).bound, false); assert.equal(f.host.status().enabled, true);
  assert.equal(store.readyCalls, 2); assert.equal(store.loadCalls, 1);
  await f.connect(); assert.equal(store.commits.length, 1);
});

test('the bounded background retry can restore native discovery readiness without an identity request', async t => {
  const store = new NativeStoreFixture(); store.fail = true;
  const f = await fixture(t, { store, recoveryCooldownMs: 100 }); assert.equal(f.host.manifest().enabled, false);
  store.fail = false;
  const until = Date.now() + 2000;
  while (!f.host.manifest().enabled && Date.now() < until) await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.host.manifest().enabled, true); assert.equal(store.readyCalls, 2); assert.equal(store.loadCalls, 1);
  assert.equal(store.commits.length, 0); assert.equal(f.issued.length, 0);
});

test('an uncertain committed binding is recovered by readback and reused without a second native write', async t => {
  const f = await fixture(t); f.store.uncertainCommit = true;
  const flow = await f.start(); assert((await f.callback(flow)).status >= 400);
  assert.equal(f.store.commits.length, 1); assert.equal(f.issued.length, 0); assert.equal(f.host.status().enabled, false);
  f.store.uncertainCommit = false;
  const status = await f.request('/gaming/identity/status'); assert.equal(status.status, 200);
  const body = await status.json(); assert.equal(body.bound, true); assert.equal(body.verified, false); noNativeCredentials(body);
  assert.equal(body.binding, null); assert.deepEqual(body.recordLinks, {});
  const { payload } = await f.connect(); assert.equal(payload.appSession.acct.id, 'guest-a');
  assert.equal(f.store.commits.length, 1); assert.equal(f.issued.length, 1);
});

test('recovery requests coalesce and keep native ownership disabled until their one readback completes', async t => {
  const f = await fixture(t); const { payload } = await f.connect();
  f.store.fail = true;
  assert((await f.request('/gaming/identity/record-link', { method: 'POST', session: payload.appSession.token, body: characterPointer })).status >= 400);
  f.store.fail = false;
  let release; f.store.loadGate = new Promise(resolve => { release = resolve; });
  const before = f.store.loadCalls, readiness = f.store.readyCalls;
  const requests = Array.from({ length: 3 }, () => f.request('/gaming/identity/status', { session: payload.appSession.token }));
  while (f.store.loadCalls === before) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.host.status().enabled, false); assert.equal(f.host.isBound('guest-a'), false);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(payload.appSession.token) }), null);
  release(); const responses = await Promise.all(requests);
  assert(responses.every(response => response.status === 200)); assert.equal(f.store.loadCalls, before + 1);
  assert.equal(f.store.readyCalls, readiness + 1); assert.equal(f.host.status().enabled, true);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(payload.appSession.token) }), nativeOwner().subjectDid);
});

test('failed recovery uses its cooldown before another native attempt and then restores service', async t => {
  const f = await fixture(t, { recoveryCooldownMs: 1000 }); const flow = await f.start(); f.store.fail = true;
  assert((await f.callback(flow)).status >= 400);
  assert.equal((await f.request('/gaming/identity/status')).status, 503);
  const attempts = f.store.readyCalls; f.store.fail = false;
  assert.equal((await f.request('/gaming/identity/status')).status, 503); assert.equal(f.store.readyCalls, attempts);
  f.advance(1001);
  assert.equal((await f.request('/gaming/identity/status')).status, 200); assert.equal(f.store.readyCalls, attempts + 1);
});

test('a timed-out native read cannot pile up recovery flights or enable ownership from a late result', async t => {
  const f = await fixture(t, { recoveryTimeoutMs: 20, recoveryCooldownMs: 100 });
  const flow = await f.start(); f.store.fail = true; assert((await f.callback(flow)).status >= 400);
  f.store.fail = false;
  let release; f.store.loadGate = new Promise(resolve => { release = resolve; });
  const before = f.store.loadCalls;
  const response = await f.request('/gaming/identity/status'); assert.equal(response.status, 503);
  assert.equal(f.host.status().enabled, false); assert.equal(f.store.loadCalls, before + 1);
  f.advance(101);
  assert.equal((await f.request('/gaming/identity/status')).status, 503); assert.equal(f.store.loadCalls, before + 1);
  f.store.loadGate = null; release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.host.status().enabled, false, 'Late completion is not a new proof of readiness');
  f.advance(101);
  assert.equal((await f.request('/gaming/identity/status')).status, 200); assert.equal(f.store.loadCalls, before + 2);
});

test('recovery preserves native high-water and same-version equivocation refusal before accepting repaired reads', async t => {
  const f = await fixture(t, { recoveryCooldownMs: 100 }); const { payload } = await f.connect();
  f.store.fail = true;
  assert((await f.request('/gaming/identity/record-link', { method: 'POST', session: payload.appSession.token, body: characterPointer })).status >= 400);
  f.store.fail = false;
  for (const stale of [{ version: 0, state: null }, { version: 1, state: { schema: 'urn:interego:gaming:player-bindings:v1', bindings: [] } }]) {
    f.store.readOverride = stale; f.advance(101);
    assert.equal((await f.request('/gaming/identity/status', { session: payload.appSession.token })).status, 503);
    assert.equal(f.host.status().enabled, false); assert.equal(f.host.isBound('guest-a'), false);
  }
  f.store.readOverride = undefined; f.advance(101);
  const response = await f.request('/gaming/identity/status', { session: payload.appSession.token });
  assert.equal(response.status, 200); assert.equal((await response.json()).verified, true);
  assert.equal(f.store.commits.length, 1); assert.equal(f.issued.length, 1);
});

test('closing the host releases a waiting recovery response and late reads cannot reopen it', async t => {
  const f = await fixture(t); const flow = await f.start(); f.store.fail = true;
  assert((await f.callback(flow)).status >= 400); f.store.fail = false;
  let release; f.store.loadGate = new Promise(resolve => { release = resolve; });
  const before = f.store.loadCalls, response = f.request('/gaming/identity/status');
  while (f.store.loadCalls === before) await new Promise(resolve => setImmediate(resolve));
  f.host.close(); assert.equal((await response).status, 503);
  f.store.loadGate = null; release(); await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.host.status().enabled, false); assert.equal(f.host.status().status, 'closed');
});

test('disabled native persistence rejects only owned identity routes and leaves finish/assets for its host', async t => {
  const f = await fixture(t, { store: null }); assert.equal(f.host.status().enabled, false);
  for (const route of ['/gaming/identity/status', '/gaming/identity/client.json', '/gaming/identity/legacy-import']) {
    assert.equal((await f.request(route)).status, 503);
  }
  assert.equal((await f.request('/gaming/identity/finish')).status, 404); assert.equal((await f.request('/game.js')).status, 404);
});

test('HTTP identity endpoints reject wrong Host, expired game claims, and oversized link bodies', async t => {
  const f = await fixture(t); assert.equal((await f.request('/gaming/identity/status', { hostname: 'evil.example' })).status, 403);
  const expired = f.token('guest-a', { exp: f.clock() - 1 }); assert.equal((await f.request('/gaming/identity/status', { session: expired })).status, 401);
  const { payload } = await f.connect(); const response = await f.request('/gaming/identity/record-link', { method: 'POST', session: payload.appSession.token,
    body: { ...characterPointer, huge: 'x'.repeat(5000) } }); assert.equal(response.status, 413);
});

test('native browser credentials require explicit write intent at start and claim and never enter host ports', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true });
  const flow = await f.start(f.aliceToken, { ownerPodWriteAccess: true }); assert.equal(flow.authorization.searchParams.get('scope'), 'mcp:write');
  const callback = await f.callback(flow); assert.equal(callback.status, 303); noNativeCredentials(Object.fromEntries(callback.headers));
  const denied = await f.claim(flow); assert(denied.status >= 400); noNativeCredentials(await denied.text());
  const response = await f.claim(flow, { ownerPodWriteAccess: true }); assert.equal(response.status, 200);
  const payload = await response.json(); assert.equal(payload.nativeSession.accessToken, 'native-access-secret');
  assert.equal(payload.nativeSession.refreshToken, undefined); assert(payload.appSession.token);
  noNativeCredentials(f.issued); noNativeCredentials(f.store.commits);
  assert((await f.claim(flow, { ownerPodWriteAccess: true })).status >= 400);
});

test('removing the initiating game account while OAuth is away prevents binding and application session issuance', async t => {
  const f = await fixture(t); const flow = await f.start(); f.accounts.delete('guest-a');
  const response = await f.callback(flow); assert(response.status >= 400); assert.equal(f.store.commits.length, 0); assert.equal(f.issued.length, 0);
});

test('an existing bound game account cannot be rebound to a different authenticated native owner', async t => {
  const f = await fixture(t); const first = await f.connect(); const before = structuredClone(f.store.commits);
  f.nativeUser('u-pk-other'); const flow = await f.start(first.payload.appSession.token);
  const response = await f.callback(flow); assert(response.status >= 400); assert.deepEqual(f.store.commits, before); assert.equal(f.issued.length, 1);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.claims.get(first.payload.appSession.token) }), nativeOwner().subjectDid);
});

test('public owner capability documents remain discoverable without bearer or native storage and expose no player data', async t => {
  const f = await fixture(t, { store: null });
  const response = await f.request('/gaming/identity/affordances', { session: null }); assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type'), /application\/ld\+json/);
  const document = await response.json(); assert.equal(document['hydra:supportedOperation'].length, 11);
  const schemas = await f.request('/gaming/identity/schemas', { session: null }); assert.equal(schemas.status, 200);
  assert.match(schemas.headers.get('content-type'), /application\/schema\+json/);
  assert((await schemas.json()).$defs.RecordLinkRequest);
  assert.equal(f.host.manifest().enabled, false); assert.equal(f.host.manifest().nativeTeamMigration, false);
  assert(f.host.metadataGraph().includes('iep:action <urn:interego:identity:owner:claim>'));
  assert.equal((await f.request('/gaming/identity/affordances', { method: 'POST', body: {} })).status, 405);
  assert.equal((await f.request('/gaming/identity/schemas', { hostname: 'evil.example', session: null })).status, 403);
  noNativeCredentials(document); assert.equal(f.store, null); assert.equal(f.issued.length, 0);
});


test('expired signed native app credential can only reauthenticate its original owner before a fresh session is issued', async t => {
  const f = await fixture(t, { realTokens: true, allowOwnerBrowserHandoff: true });
  const first = await f.connect(f.aliceToken, { ownerPodWriteAccess: true });
  const old = first.payload.appSession.token, oldClaims = f.claims.get(old);
  f.advance(3_600_001);
  assert.equal(f.gameTokens.read(old), null);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: oldClaims }), null);
  for (const route of ['/gaming/identity/status', '/gaming/identity/legacy-import']) assert.equal((await f.request(route, { session: old })).status, 401);
  assert.equal((await f.request('/gaming/identity/record-link', { method: 'POST', session: old, body: characterPointer })).status, 401);
  const before = structuredClone(f.store.commits);
  const flow = await f.start(old, { ownerPodWriteAccess: true, accountId: 'guest-b', nativeDid: nativeOwner('u-pk-other').subjectDid });
  assert.equal(flow.response.status, 200);
  assert.deepEqual(f.store.commits, before); assert.equal(f.issued.length, 1, 'start confers no game session or ledger mutation');
  assert.equal((await f.callback(flow)).status, 303);
  const response = await f.claim(flow, { ownerPodWriteAccess: true }); assert.equal(response.status, 200);
  const renewed = await response.json();
  assert.equal(renewed.appSession.acct.id, 'guest-a'); assert.equal(renewed.binding.subjectDid, nativeOwner().subjectDid);
  assert.notEqual(renewed.appSession.token, old); assert.equal(renewed.nativeSession.accessToken, 'native-access-secret');
  assert.equal(f.issued.length, 2);
  assert.equal((await f.request('/gaming/identity/status', { session: renewed.appSession.token })).status, 200);
  assert.equal(f.gameTokens.read(old), null, 'renewal never revives the expired game credential');
  const renewalOnly = f.gameTokens.readForReauthentication(renewed.appSession.token);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: renewalOnly }), null, 'purpose-only recovery output is not game authority even before expiry');
  noNativeCredentials(f.issued); noNativeCredentials(f.store.commits);
});

test('a native ceremony started before expiry can finish after expiry without weakening ordinary requests', async t => {
  const f = await fixture(t, { realTokens: true });
  const first = await f.connect(), old = first.payload.appSession.token; f.advance(3_599_900);
  const flow = await f.start(old); assert.equal(flow.response.status, 200); f.advance(101);
  assert.equal((await f.request('/gaming/identity/status', { session: old })).status, 401);
  assert.equal((await f.callback(flow)).status, 303);
  assert.equal((await f.claim(flow)).status, 200); assert.equal(f.issued.length, 2);
});

test('expired native recovery rejects foreign OAuth owner before host mutation and never trusts body labels', async t => {
  const f = await fixture(t, { realTokens: true });
  const first = await f.connect(), old = first.payload.appSession.token; f.advance(3_600_001);
  const before = structuredClone(f.store.commits); f.nativeUser('u-pk-other');
  const flow = await f.start(old, { accountId: 'guest-b', nativeDid: nativeOwner('u-pk-other').subjectDid });
  assert.equal(flow.response.status, 200);
  const callback = await f.callback(flow); assert.equal(callback.status, 403);
  assert.equal((await callback.json()).error, 'native_owner_mismatch');
  assert.deepEqual(f.store.commits, before); assert.equal(f.issued.length, 1); assert.equal(f.host.status().readyHandoffs, 0);
  assert.equal((await f.claim(flow)).status, 404);
});

test('forged, foreign-bound and over-age native recovery credentials cannot start or claim', async t => {
  const f = await fixture(t, { realTokens: true });
  const first = await f.connect(), old = first.payload.appSession.token; f.advance(3_600_001);
  const foreign = f.gameTokens.issueNative('guest-a', nativeOwner('u-pk-other').subjectDid).token;
  const forBob = f.gameTokens.issueNative('guest-b', nativeOwner().subjectDid).token;
  const calls = f.remote.length;
  for (const token of ['forged', old.slice(0, -1) + '!', foreign, forBob]) {
    assert.equal((await f.start(token, { accountId: 'guest-a', nativeDid: nativeOwner().subjectDid })).response.status, 401);
  }
  assert.equal(f.remote.length, calls); assert.equal(f.issued.length, 1);
  const flow = await f.start(old); assert.equal(flow.response.status, 200);
  assert.equal((await f.callback(flow)).status, 303);
  assert.equal((await f.claim(flow, {}, foreign)).status, 401);
  assert.equal((await f.claim(flow, {}, f.bobToken)).status, 403);
  assert.equal((await f.claim(flow)).status, 200, 'wrong-session claims do not consume the original browser handoff');
  f.advance(86_400_000);
  assert.equal((await f.start(old)).response.status, 401);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-a'), authClaims: f.gameTokens.readForReauthentication(old) }), null);
});

test('a fresh disposable game transport restores an existing native owner after the old HMAC recovery deadline', async t => {
  const f = await fixture(t, { realTokens: true, allowOwnerBrowserHandoff: true });
  const first = await f.connect(f.aliceToken, { ownerPodWriteAccess: true });
  const old = first.payload.appSession.token, originalAccount = first.payload.appSession.acct.id;
  assert.equal(originalAccount, 'guest-a');
  f.advance(3_600_000 + 86_400_001);
  assert.equal(f.gameTokens.read(old), null); assert.equal(f.gameTokens.readForReauthentication(old), null);
  assert.equal((await f.start(old)).response.status, 401);
  const baseline = structuredClone(f.store.commits), disposableBefore = structuredClone(f.accounts.get('guest-b'));
  // A fresh ordinary game session names no native identity and has no pod access.
  const disposable = f.token('guest-b');
  assert.equal(f.gameTokens.read(disposable).nativeDid, undefined);
  assert.equal(f.host.principalFor({ acct: f.accounts.get('guest-b'), authClaims: f.gameTokens.read(disposable) }), null);
  const flow = await f.start(disposable, { ownerPodWriteAccess: true, accountId: 'guest-b', nativeDid: 'did:example:caller-label' });
  assert.equal(flow.response.status, 200); assert.deepEqual(f.store.commits, baseline);
  assert.equal((await f.callback(flow)).status, 303);
  const response = await f.claim(flow, { ownerPodWriteAccess: true }); assert.equal(response.status, 200);
  const recovered = await response.json();
  assert.equal(recovered.appSession.acct.id, originalAccount);
  assert.equal(recovered.binding.subjectDid, nativeOwner().subjectDid);
  assert.deepEqual(f.accounts.get('guest-b'), disposableBefore, 'the disposable transport is not rebound to the returning owner');
  assert.deepEqual(f.store.commits, baseline, 'existing owner discovery creates no second native identity or participation binding');
  assert.equal(f.host.isBound('guest-b'), false); assert.equal(f.host.isBound(originalAccount), true);
  assert.equal(f.host.principalFor({ acct: f.accounts.get(originalAccount), authClaims: f.gameTokens.read(recovered.appSession.token) }), nativeOwner().subjectDid);
  noNativeCredentials(f.store.commits); noNativeCredentials(f.issued);
});

