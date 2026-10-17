import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { InteregoGamingStore } from './interego-store.js';
import { createPlayerAccountHost } from './player-account-host.js';
import { createGameSessionTokens } from './game-session.js';

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

// Audit-only native boundary. Actual host, ledger and InteregoGamingStore code
// run unchanged. Codec bytes are synthetic JSON, not a PGSL/encryption claim.
function adapterFixture() {
  const owner = 'did:web:identity.interego.xwisee.com:users:u-test-hallowmarch';
  let head = { revision: null, records: new Map() }, sequence = 0;
  const empty = structuredClone(head), calls = [], writes = [];
  const controls = { refuse: false, loseAcknowledgementAndReads: false, staleStreamReads: false };
  const artifactCodec = {
    createNativeByteArtifact(input) { return { owner: input.owner, contentType: input.contentType,
      bytes: Buffer.from(input.bytes).toString('base64') }; },
    readNativeByteArtifact(artifact) { return { ...artifact, bytes: Buffer.from(artifact.bytes, 'base64') }; },
  };
  let readsUnavailable = false;
  const nativeClient = {
    async ready() {},
    async readHead() { throw new Error('Only verified selected records are used'); },
    async readHeadRecords(keys) {
      if (readsUnavailable) throw new Error('Synthetic unavailable acknowledgement/readback');
      const source = controls.staleStreamReads && keys.length === 1 ? empty : head;
      return { revision: source.revision, records: new Map([...source.records].filter(([key]) => keys.includes(key))),
        selectedRecordKeys: [...keys] };
    },
    async readArtifact(reference) { return structuredClone(reference); },
    async commit(request) {
      calls.push(structuredClone(request));
      if (request.expected.revision !== head.revision) throw Object.assign(new Error('Synthetic native CAS conflict'),
        { name: 'NativeCommitConflictError', status: 412 });
      if (controls.refuse) throw new Error('Synthetic native write refused before mutation');
      const records = new Map(head.records);
      for (const change of request.changes) records.set(change.key, structuredClone(change.artifact));
      const revision = 'sha256:' + createHash('sha256').update(JSON.stringify([...records]) + ++sequence).digest('hex');
      head = { revision, records }; writes.push(structuredClone(request));
      if (controls.loseAcknowledgementAndReads) { readsUnavailable = true; throw new Error('Synthetic native acknowledgement lost after CAS'); }
      return { operationId: request.operationId, head: { revision }, snapshot: { revision,
        records: new Map([...records].filter(([key]) => request.resultRecordKeys.includes(key))),
        selectedRecordKeys: [...request.resultRecordKeys] }, replayed: false };
    },
  };
  const store = new InteregoGamingStore({ nativeClient, artifactCodec, owner, namespace: 'host-idempotency-audit' });
  return { store, calls, writes, controls, restoreReads() { readsUnavailable = false; },
    stateRequests: () => calls.map(call => JSON.parse(Buffer.from(call.changes[0].artifact.bytes, 'base64').toString('utf8'))) };
}

async function fixture(t, overrides = {}) {
  let clock = Date.parse('2026-10-16T12:00:00Z'), scope = 'mcp:read', userId = 'u-pk-player';
  const store = Object.hasOwn(overrides, 'store') ? overrides.store : adapterFixture().store;
  const accounts = overrides.accounts ?? new Map([
    ['guest-a', { id: 'guest-a', name: 'Alice', guest: true, pass: { secret: 'NEVER_IN_NATIVE_LEDGER' } }],
    ['guest-b', { id: 'guest-b', name: 'Bob', guest: true }],
  ]);
  const gameTokens = createGameSessionTokens({ secret: 'synthetic-signed-host-test-secret', now: () => clock });
  const claims = new Map(), issued = [], restored = [], legacyReads = [], faults = [], remote = [];
  const token = (id, fields = {}) => {
    const value = overrides.realTokens ? (fields.nativeDid ? gameTokens.issueNative(id, fields.nativeDid).token : gameTokens.issueLegacy(id)) : `game-session-${id}-${claims.size}`;
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
      identity: { userId, did: owner.subjectDid, webId: owner.webId }, pod: `http://css.railway.internal:3456/${userId}/`,
      registry: { owner: owner.webId }, sessionAgent: { id: `gaming-client-${userId}`, did: owner.authenticatedAgentDid, scope: 'ReadWrite' },
    } } });
  };
  const host = createPlayerAccountHost({ store, publicOrigin: ORIGIN, now: () => clock, fetch: fetcher,
    tokenClaims: value => overrides.realTokens ? gameTokens.read(value) : claims.has(value) ? { ...claims.get(value) } : null,
    ...(overrides.realTokens ? { reauthenticationClaims: value => gameTokens.readForReauthentication(value) } : {}),
    getAccount: id => accounts.get(id) ?? null,
    restoreAccount: record => { restored.push(structuredClone(record)); const account = { ...record.accountSummary }; accounts.set(account.id, account); return account; },
    issueAppSession: (id, binding) => {
      issued.push({ id, binding: structuredClone(binding) });
      return { token: token(id, { nativeDid: binding.subjectDid, nativeVerifiedAt: clock }),
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
    aliceToken, bobToken, advance(ms) { clock += ms; }, nativeUser(value) { userId = value; }, clock: () => clock };
}

test('audit: refused native write allows fresh ceremony with same game session and changed verification time', async t => {
  const a = adapterFixture(), f = await fixture(t, { store: a.store });
  a.controls.refuse = true;
  const first = await f.start(); assert.equal((await f.callback(first)).status, 409);
  assert.deepEqual(f.host.status().verificationDiagnostics.lastFailure, { stage: 'ledger-bind', code: 'COMMIT_UNCERTAIN' });
  assert.equal(a.writes.length, 0); assert.equal(a.calls.length, 1);
  a.controls.refuse = false; f.advance(60_000);
  const { payload } = await f.connect(f.aliceToken);
  assert.equal(payload.appSession.acct.id, 'guest-a');
  assert.equal(a.writes.length, 1); assert.equal(a.calls.length, 2);
  assert.equal(a.calls[0].operationId, a.calls[1].operationId, 'same original game bearer and owner derive the same native operation ID');
  const request = a.stateRequests().map(value => value.schema === 'urn:interego:gaming:operation:v1' ? value.result : value);
  assert.notEqual(request[0].state.bindings[0].binding.verifiedAt, request[1].state.bindings[0].binding.verifiedAt);
  assert.notEqual(request[0].event.recordedAt, request[1].event.recordedAt);
});

test('audit: uncertain committed write is read back before changed-time ceremony, with no second commit', async t => {
  const a = adapterFixture(), f = await fixture(t, { store: a.store });
  a.controls.loseAcknowledgementAndReads = true;
  const first = await f.start(); assert.equal((await f.callback(first)).status, 409);
  assert.deepEqual(f.host.status().verificationDiagnostics.lastFailure, { stage: 'ledger-bind', code: 'COMMIT_UNCERTAIN' });
  assert.equal(a.writes.length, 1); assert.equal(f.issued.length, 0);
  a.controls.loseAcknowledgementAndReads = false; a.restoreReads(); f.advance(60_000);
  const { payload } = await f.connect(f.aliceToken);
  assert.equal(payload.appSession.acct.id, 'guest-a');
  assert.equal(a.calls.length, 1, 'latest stream binding bypasses the changed-time proposed operation');
  assert.equal(a.writes.length, 1); assert.equal(f.issued.length, 1);
  assert.equal(f.issued[0].binding.verifiedAt, '2026-10-16T12:00:00.000Z');
});

test('audit: deliberately stale stream-only read plus current receipt produces a transient exact-payload conflict', async t => {
  const a = adapterFixture(), f = await fixture(t, { store: a.store });
  a.controls.loseAcknowledgementAndReads = true;
  const first = await f.start(); assert.equal((await f.callback(first)).status, 409);
  a.controls.loseAcknowledgementAndReads = false; a.restoreReads(); a.controls.staleStreamReads = true; f.advance(60_000);
  const retry = await f.start(f.aliceToken); assert.equal(retry.response.status, 200);
  assert.equal((await f.callback(retry)).status, 409);
  assert.deepEqual(f.host.status().verificationDiagnostics.lastFailure, { stage: 'ledger-bind', code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(a.calls.length, 1, 'conflict is from actual InteregoGamingStore replay before another native write');
  assert.equal(a.writes.length, 1); assert.equal(f.issued.length, 0);
  a.controls.staleStreamReads = false; f.advance(60_000);
  const { payload } = await f.connect(f.aliceToken);
  assert.equal(payload.appSession.acct.id, 'guest-a');
  assert.equal(a.calls.length, 1); assert.equal(a.writes.length, 1); assert.equal(f.issued.length, 1);
});
