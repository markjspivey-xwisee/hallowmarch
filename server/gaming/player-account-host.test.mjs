import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createPlayerAccountHost } from './player-account-host.js';
import { createPlayerBindingLedger } from './player-bindings.js';
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
  const document = await response.json(); assert.equal(document['hydra:supportedOperation'].length, 4);
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
