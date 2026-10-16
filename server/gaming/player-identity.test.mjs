import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createHash } from 'node:crypto';
import { createPlayerIdentityBridge } from './player-identity.js';

const PUBLIC_ORIGIN = 'https://game.example';
const RELAY_ORIGIN = 'https://relay.interego.xwisee.com';
const ISSUER = RELAY_ORIGIN + '/';
const ACCESS_TOKEN = 'sensitive-native-access-token-fixture';
const REFRESH_TOKEN = 'sensitive-native-refresh-token-fixture';
const COOKIE_NAME = '__Host-gaming-interego';
const proofBody = { accountProof: 'proof-alice', did: 'did:web:attacker.example:users:claimed', pod: 'https://attacker.example/pod/' };

const playerStatus = () => ({
  identity: {
    userId: 'u-pk-player',
    did: 'did:web:identity.interego.xwisee.com:users:u-pk-player',
    webId: 'https://identity.interego.xwisee.com/users/u-pk-player/profile#me',
  },
  pod: 'http://css.railway.internal:3456/u-pk-player/',
  registry: { owner: 'https://identity.interego.xwisee.com/users/u-pk-player/profile#me' },
  sessionAgent: {
    id: 'gaming-client-u-pk-player',
    did: 'did:web:identity.interego.xwisee.com:agents:gaming-client-u-pk-player',
    scope: 'ReadWrite',
  },
});

async function fixture(t, options = {}) {
  let clock = Date.parse('2026-10-16T12:00:00Z');
  let metadataTransform = x => x, resourceTransform = x => x, statusTransform = x => x;
  let tokenTransform = x => x, useSse = false, upstreamError = null, blockToken = null;
  const requests = [], verified = [], faults = [];
  let announceToken; const tokenEntered = new Promise(resolve => { announceToken = resolve; });
  const authorizationFor = body => {
    if (body?.accountProof === 'proof-alice') return { accountId: 'local-alice', sessionId: 'session-alice', ownerPodWriteAccess: true };
    if (body?.accountProof === 'proof-alice-new-session') return { accountId: 'local-alice', sessionId: 'new-session-alice', ownerPodWriteAccess: true };
    if (body?.accountProof === 'proof-alice-read-only') return { accountId: 'local-alice', sessionId: 'session-alice' };
    if (body?.accountProof === 'proof-bob') return { accountId: 'local-bob', sessionId: 'session-bob', ownerPodWriteAccess: true };
    return null;
  };
  const remoteFetch = async (input, init = {}) => {
    const url = String(input); requests.push({ url, ...init });
    assert.equal(init.redirect, 'error', 'discovery and authenticated requests must reject redirects');
    if (url === RELAY_ORIGIN + '/.well-known/oauth-authorization-server') return Response.json(metadataTransform({
      issuer: ISSUER, authorization_endpoint: RELAY_ORIGIN + '/authorize', token_endpoint: RELAY_ORIGIN + '/token',
      response_types_supported: ['code'], grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true, scopes_supported: ['mcp', 'mcp:read', 'mcp:write'],
    }));
    if (url === RELAY_ORIGIN + '/.well-known/oauth-protected-resource') return Response.json(resourceTransform({
      resource: RELAY_ORIGIN + '/mcp', authorization_servers: [ISSUER], scopes_supported: ['mcp', 'mcp:read', 'mcp:write'],
      affordances: [{ action: 'urn:iep:action:mcp:invoke', target: RELAY_ORIGIN + '/mcp', method: 'POST' }],
    }));
    if (url === RELAY_ORIGIN + '/token') {
      announceToken();
      if (blockToken) await blockToken;
      if (upstreamError) return new Response(upstreamError, { status: 502 });
      return Response.json(tokenTransform({
        access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, token_type: 'Bearer',
        scope: options.allowOwnerBrowserHandoff ? 'mcp:write' : 'mcp:read', expires_in: 3600,
      }));
    }
    assert.equal(url, RELAY_ORIGIN + '/mcp', 'invoke target comes from protected resource metadata');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + ACCESS_TOKEN);
    const rpc = JSON.parse(init.body);
    assert.equal(rpc.method, 'tools/call');
    assert.deepEqual(rpc.params, { name: 'get_pod_status', arguments: {} }, 'identity must come from caller context, never a supplied pod or DID');
    const status = statusTransform(playerStatus());
    const body = { jsonrpc: '2.0', id: rpc.id, result: { content: [{ type: 'text', text: JSON.stringify(status) }], structuredContent: status } };
    return useSse
      ? new Response(': native relay keepalive\n\nevent: message\ndata: ' + JSON.stringify(body) + '\n\n', { headers: { 'content-type': 'text/event-stream' } })
      : Response.json(body);
  };
  const bridge = createPlayerIdentityBridge({
    publicOrigin: PUBLIC_ORIGIN, fetch: remoteFetch, now: () => clock,
    authorizeGameAccount: async (_req, body) => authorizationFor(body),
    onVerified: async (...args) => { verified.push(args); },
    ...options,
  });
  const server = http.createServer(async (req, res) => {
    try {
      let body;
      if (req.method === 'POST') {
        let text = ''; for await (const chunk of req) text += chunk;
        body = text ? JSON.parse(text) : {};
      }
      if (!await bridge.handle(req, res, body)) { res.writeHead(404); res.end(); }
    } catch (error) {
      faults.push(error); res.writeHead(500, { 'content-type': 'application/json' }); res.end('{"error":"fixture_handler_fault"}');
    }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    bridge.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.deepEqual(faults, [], 'HTTP bridge handles failures without throwing into its host');
  });
  const local = `http://127.0.0.1:${server.address().port}`;
  // Node's built-in fetch rewrites Host to the loopback transport origin.
  // Raw HTTP lets the fixture exercise production Host validation unchanged.
  const request = (path, { method = 'GET', body, cookie, host = 'game.example', origin = PUBLIC_ORIGIN } = {}) => new Promise((resolve, reject) => {
    const req = http.request(local + path, {
      method, headers: { Host: host, ...(method === 'POST' ? { Origin: origin, 'content-type': 'application/json' } : {}), ...(cookie ? { Cookie: cookie } : {}) },
    }, res => {
      const chunks = []; res.on('data', chunk => chunks.push(chunk)); res.on('error', reject);
      res.on('end', () => resolve(new Response(Buffer.concat(chunks), { status: res.statusCode, headers: res.headers })));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  const start = async (body = proofBody) => {
    const response = await request(bridge.paths.start, { method: 'POST', body });
    const payload = await response.json();
    return { response, payload, authorization: payload.authorizationUrl ? new URL(payload.authorizationUrl) : null,
      cookie: response.headers.get('set-cookie')?.split(';')[0] };
  };
  const callback = (started, fields = {}) => {
    const query = new URLSearchParams({ code: 'issued-code', state: started.authorization.searchParams.get('state'), ...fields });
    return request(bridge.paths.callback + '?' + query, { cookie: started.cookie });
  };
  return { bridge, requests, verified, request, start, callback, tokenEntered, advance(ms) { clock += ms; },
    metadata(fn) { metadataTransform = fn; }, resource(fn) { resourceTransform = fn; }, status(fn) { statusTransform = fn; },
    token(fn) { tokenTransform = fn; }, sse() { useSse = true; }, upstreamError(value) { upstreamError = value; },
    blockToken(promise) { blockToken = promise; },
  };
}

const tokenRequests = f => f.requests.filter(r => r.url === RELAY_ORIGIN + '/token');
const assertNoTokens = value => {
  assert(!JSON.stringify(value).includes(ACCESS_TOKEN)); assert(!JSON.stringify(value).includes(REFRESH_TOKEN));
};

test('public client metadata and discovery produce a bound authorization code flow with S256', async t => {
  const f = await fixture(t);
  const metadata = await f.request(f.bridge.paths.clientMetadata);
  assert.equal(metadata.status, 200);
  const client = await metadata.json();
  assert.equal(client.client_id, PUBLIC_ORIGIN + f.bridge.paths.clientMetadata);
  assert.deepEqual(client.redirect_uris, [PUBLIC_ORIGIN + f.bridge.paths.callback]);
  assert.equal(client.token_endpoint_auth_method, 'none');
  const flow = await f.start();
  assert.equal(flow.response.status, 200);
  assert.equal(flow.authorization.origin, RELAY_ORIGIN);
  const q = flow.authorization.searchParams;
  assert.equal(q.get('client_id'), client.client_id); assert.equal(q.get('redirect_uri'), client.redirect_uris[0]);
  assert.equal(q.get('response_type'), 'code'); assert.equal(q.get('scope'), 'mcp:read'); assert.equal(q.get('code_challenge_method'), 'S256');
  assert.match(q.get('state'), /^[A-Za-z0-9_-]{32,}$/); assert.match(q.get('code_challenge'), /^[A-Za-z0-9_-]{43}$/);
  assert.match(flow.cookie, new RegExp('^' + COOKIE_NAME + '='));
  const cookie = flow.response.headers.get('set-cookie');
  for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/']) assert(cookie.includes(attribute));
  assertNoTokens(flow.payload); assert.equal(tokenRequests(f).length, 0);
});

test('callback verifies caller identity and owner, ignores claimed identity, and discards native tokens', async t => {
  const f = await fixture(t); const flow = await f.start();
  const response = await f.callback(flow);
  assert.equal(response.status, 303); assert.equal(response.headers.get('location'), '/');
  assert.equal(f.verified.length, 1);
  const [binding, accountId, context] = f.verified[0];
  assert.equal(accountId, 'local-alice');
  assert.equal(binding.subjectDid, playerStatus().identity.did); assert.equal(binding.webId, playerStatus().identity.webId);
  assert.equal(binding.userId, 'u-pk-player'); assert.equal(binding.podUrl, 'https://gate.interego.xwisee.com/u-pk-player/');
  assert.equal(binding.authenticatedAgentDid, playerStatus().sessionAgent.did); assert.equal(binding.issuer, ISSUER);
  assert(binding.verifiedAt); assert(binding.verificationMethod);
  assert.equal(context.sessionBinding, createHash('sha256').update('session-alice').digest('hex'));
  const tokenRequest = tokenRequests(f)[0], tokenBody = new URLSearchParams(tokenRequest.body);
  assert.equal(tokenBody.get('grant_type'), 'authorization_code'); assert.equal(tokenBody.get('code'), 'issued-code');
  assert.equal(tokenBody.get('client_id'), PUBLIC_ORIGIN + f.bridge.paths.clientMetadata);
  assert.equal(tokenBody.get('redirect_uri'), PUBLIC_ORIGIN + f.bridge.paths.callback);
  assert.equal(createHash('sha256').update(tokenBody.get('code_verifier')).digest('base64url'), flow.authorization.searchParams.get('code_challenge'));
  assertNoTokens(f.verified); assertNoTokens(f.bridge.status()); assertNoTokens(Object.fromEntries(response.headers));
  assertNoTokens(await response.text()); assert.equal(f.bridge.status().pending, 0); assert.equal(f.bridge.status().readyHandoffs, 0);
});

test('SSE get_pod_status responses bind the same caller identity', async t => {
  const f = await fixture(t); f.sse(); const flow = await f.start();
  assert.equal((await f.callback(flow)).status, 303); assert.equal(f.verified.length, 1);
});

test('start requires the host account proof, exact Origin, and the configured Host', async t => {
  const f = await fixture(t);
  for (const options of [
    { body: { accountId: 'local-alice', sessionId: 'session-alice', did: playerStatus().identity.did } },
    { body: proofBody, origin: 'https://evil.example' }, { body: proofBody, host: 'evil.example' },
    { body: proofBody, origin: 'null' },
  ]) {
    const response = await f.request(f.bridge.paths.start, { method: 'POST', ...options });
    assert(response.status >= 400); assertNoTokens(await response.text());
  }
  assert.equal(f.bridge.status().pending, 0); assert.equal(f.verified.length, 0); assert.equal(tokenRequests(f).length, 0);
  assert.equal((await f.request(f.bridge.paths.clientMetadata, { host: 'evil.example' })).status >= 400, true);
});

test('wrong state, missing cookie, and another browser cookie cannot redeem a flow', async t => {
  const f = await fixture(t); const flow = await f.start();
  const query = new URLSearchParams({ code: 'issued-code', state: flow.authorization.searchParams.get('state') });
  const wrongState = await f.callback(flow, { state: 'unrelated-state-value' }); assert(wrongState.status >= 400);
  for (const cookie of [undefined, COOKIE_NAME + '=other-browser-value']) {
    const response = await f.request(f.bridge.paths.callback + '?' + query, { cookie }); assert(response.status >= 400);
  }
  assert.equal(tokenRequests(f).length, 0); assert.equal(f.verified.length, 0);
});

test('callback state is consumed before token exchange, preventing concurrent and later replay', async t => {
  const f = await fixture(t); let release;
  const blocked = new Promise(resolve => { release = resolve; }); t.after(() => release()); f.blockToken(blocked);
  const flow = await f.start(); const first = f.callback(flow);
  // The fake upstream announces entry before blocking, so concurrency is tested
  // without a timing assumption about completion of the native exchange.
  await f.tokenEntered;
  assert.equal(tokenRequests(f).length, 1);
  const concurrent = await f.callback(flow); assert(concurrent.status >= 400);
  release(); assert.equal((await first).status, 303);
  assert((await f.callback(flow)).status >= 400); assert.equal(tokenRequests(f).length, 1); assert.equal(f.verified.length, 1);
});

test('expired state and bounded pending flows fail without native calls', async t => {
  const f = await fixture(t, { ttlMs: 30_000, maxPending: 1, maxPerAccount: 1 });
  const flow = await f.start(); assert.equal(flow.response.status, 200);
  assert((await f.start({ accountProof: 'proof-bob' })).response.status >= 400);
  assert.equal(f.bridge.status().pending, 1);
  f.advance(30_001); assert((await f.callback(flow)).status >= 400); assert.equal(tokenRequests(f).length, 0);
  assert.equal((await f.start({ accountProof: 'proof-bob' })).response.status, 200);
});

test('per-account pending limit applies across browser attempts', async t => {
  const f = await fixture(t, { maxPending: 4, maxPerAccount: 1 });
  assert.equal((await f.start()).response.status, 200);
  assert((await f.start()).response.status >= 400);
  assert.equal((await f.start({ accountProof: 'proof-bob' })).response.status, 200);
  assert.equal(f.bridge.status().pending, 2);
});

test('malformed or swapped native identity, owner, pod, and session agent fail closed', async t => {
  const mutations = [
    ['missing identity', s => { delete s.identity; return s; }],
    ['missing user ID', s => { delete s.identity.userId; return s; }],
    ['noncanonical user DID', s => ({ ...s, identity: { ...s.identity, did: 'did:web:identity.interego.xwisee.com:users:u-pk-other' } })],
    ['swapped WebID', s => ({ ...s, identity: { ...s.identity, webId: 'https://identity.interego.xwisee.com/users/u-pk-other/profile#me' } })],
    ['foreign identity origin', s => ({ ...s, identity: { ...s.identity, did: 'did:web:evil.example:users:u-pk-player', webId: 'https://evil.example/users/u-pk-player/profile#me' } })],
    ['missing pod', s => { delete s.pod; return s; }],
    ['other owner pod', s => ({ ...s, pod: 'http://css.railway.internal:3456/u-pk-other/' })],
    ['foreign pod host', s => ({ ...s, pod: 'https://evil.example/u-pk-player/' })],
    ['encoded pod traversal', s => ({ ...s, pod: 'https://gate.interego.xwisee.com/u-pk-player/%2e%2e/u-pk-other/' })],
    ['missing registry', s => { delete s.registry; return s; }],
    ['swapped registry owner', s => ({ ...s, registry: { owner: 'https://identity.interego.xwisee.com/users/u-pk-other/profile#me' } })],
    ['contradictory delegation owner', s => ({ ...s, delegationRegistry: { owner: 'https://identity.interego.xwisee.com/users/u-pk-other/profile#me' } })],
    ['missing session agent', s => { delete s.sessionAgent; return s; }],
    ['swapped session agent ID', s => ({ ...s, sessionAgent: { ...s.sessionAgent, id: 'gaming-client-u-pk-other' } })],
    ['swapped session agent DID', s => ({ ...s, sessionAgent: { ...s.sessionAgent, did: 'did:web:identity.interego.xwisee.com:agents:gaming-client-u-pk-other' } })],
    ['missing session scope', s => { delete s.sessionAgent.scope; return s; }],
  ];
  for (const [label, mutate] of mutations) await t.test(label, async t => {
    const f = await fixture(t); f.status(mutate); const flow = await f.start();
    const response = await f.callback(flow); assert(response.status >= 400); assert.equal(f.verified.length, 0);
    assertNoTokens(await response.text()); assert.equal(f.bridge.status().pending, 0);
  });
});

test('unsafe discovery metadata is rejected before opening authorization or calling token endpoint', async t => {
  for (const [label, change] of [
    ['HTTP authorization', x => ({ ...x, authorization_endpoint: 'http://relay.interego.xwisee.com/authorize' })],
    ['foreign token endpoint', x => ({ ...x, token_endpoint: 'https://evil.example/token' })],
    ['issuer mismatch', x => ({ ...x, issuer: 'https://evil.example/' })],
    ['CIMD unsupported', x => ({ ...x, client_id_metadata_document_supported: false })],
    ['S256 unsupported', x => ({ ...x, code_challenge_methods_supported: ['plain'] })],
    ['code unsupported', x => ({ ...x, response_types_supported: ['token'] })],
    ['read scope unsupported', x => ({ ...x, scopes_supported: ['unrelated'] })],
  ]) await t.test(label, async t => {
    const f = await fixture(t); f.metadata(change); assert((await f.start()).response.status >= 400);
    assert.equal(f.bridge.status().pending, 0); assert.equal(tokenRequests(f).length, 0);
  });
  for (const [label, change] of [
    ['foreign authorization server', x => ({ ...x, authorization_servers: ['https://evil.example/'] })],
    ['foreign invoke target', x => ({ ...x, affordances: [{ action: 'urn:iep:action:mcp:invoke', target: 'https://evil.example/mcp', method: 'POST' }] })],
    ['missing invoke affordance', x => ({ ...x, affordances: [] })],
  ]) await t.test(label, async t => {
    const f = await fixture(t); f.resource(change); assert((await f.start()).response.status >= 400);
    assert.equal(tokenRequests(f).length, 0);
  });
});

test('native failures and invalid token responses never expose upstream content or tokens', async t => {
  for (const [label, configure] of [
    ['upstream error', f => f.upstreamError('private upstream trace ' + ACCESS_TOKEN + ' ' + REFRESH_TOKEN)],
    ['wrong token type', f => f.token(x => ({ ...x, token_type: 'Untrusted' }))],
    ['wrong scope', f => f.token(x => ({ ...x, scope: 'mcp:write' }))],
    ['missing access token', f => f.token(x => { delete x.access_token; return x; })],
  ]) await t.test(label, async t => {
    const f = await fixture(t); configure(f); const flow = await f.start(); const response = await f.callback(flow);
    assert(response.status >= 400); const body = await response.text(); assertNoTokens(body); assert(!body.includes('private upstream trace'));
    assert.equal(f.verified.length, 0); assertNoTokens(f.bridge.status()); assert.equal(f.bridge.status().pending, 0);
  });
});

test('owner browser handoff requires explicit option, same account session and cookie, then consumes credentials once', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true }); const flow = await f.start();
  assert(flow.authorization.searchParams.get('scope').split(' ').some(scope => scope === 'mcp' || scope === 'mcp:write'));
  const callback = await f.callback(flow); assert.equal(callback.status, 303); assertNoTokens(Object.fromEntries(callback.headers));
  assert.equal(f.bridge.status().readyHandoffs, 1); assertNoTokens(f.verified);
  for (const options of [
    { body: { accountProof: 'proof-bob' }, cookie: flow.cookie },
    { body: { accountProof: 'proof-alice-new-session' }, cookie: flow.cookie },
    { body: proofBody },
    { body: proofBody, cookie: flow.cookie, origin: 'https://evil.example' },
  ]) assert((await f.request(f.bridge.paths.claim, { method: 'POST', ...options })).status >= 400);
  const claimed = await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie });
  assert.equal(claimed.status, 200); const payload = await claimed.json();
  assert.equal(payload.binding.subjectDid, playerStatus().identity.did); assert.equal(payload.nativeSession.accessToken, ACCESS_TOKEN);
  assert.equal(payload.nativeSession.refreshToken, undefined); assert.equal(payload.nativeSession.tokenType, 'Bearer');
  assert(!JSON.stringify(payload).includes(REFRESH_TOKEN));
  assert.equal(payload.nativeSession.authorizationServer, ISSUER); assert.equal(payload.nativeSession.tokenEndpoint, RELAY_ORIGIN + '/token');
  assert.equal(payload.nativeSession.mcpUrl, RELAY_ORIGIN + '/mcp'); assert(payload.nativeSession.expiresAt);
  assert.match(claimed.headers.get('set-cookie'), /Max-Age=0/);
  assert.equal(f.bridge.status().readyHandoffs, 0);
  assert((await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie })).status >= 400);
});

test('browser handoff expires and is never enabled solely by a claimed body flag', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true, handoffTtlMs: 30_000 }); const flow = await f.start();
  assert.equal((await f.callback(flow)).status, 303); f.advance(30_001);
  const claimed = await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie });
  assert(claimed.status >= 400); assertNoTokens(await claimed.text()); assert.equal(f.bridge.status().readyHandoffs, 0);
  const defaultFlow = await fixture(t); const normal = await defaultFlow.start({ ...proofBody, ownerPodWriteAccess: true, allowOwnerBrowserHandoff: true });
  assert.equal(normal.authorization.searchParams.get('scope'), 'mcp:read'); assert.equal((await defaultFlow.callback(normal)).status, 303);
  assert((await defaultFlow.request(defaultFlow.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: normal.cookie })).status >= 400);
});

test('browser write handoff also requires the host account authorization to permit pod access', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true }); f.token(x => ({ ...x, scope: 'mcp:read' }));
  const flow = await f.start({ accountProof: 'proof-alice-read-only', ownerPodWriteAccess: true });
  assert.equal(flow.authorization.searchParams.get('scope'), 'mcp:read');
  assert.equal((await f.callback(flow)).status, 303); assert.equal(f.bridge.status().readyHandoffs, 0);
  assert((await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie })).status >= 400);
});

test('consumed callbacks retain global and per-account capacity while their native exchange is in flight', async t => {
  for (const [label, limits, body] of [
    ['global', { maxPending: 1, maxPerAccount: 2 }, { accountProof: 'proof-bob' }],
    ['account', { maxPending: 4, maxPerAccount: 1 }, proofBody],
  ]) await t.test(label, async t => {
    const f = await fixture(t, limits); let release;
    f.blockToken(new Promise(resolve => { release = resolve; })); t.after(() => release());
    const flow = await f.start(), active = f.callback(flow); await f.tokenEntered;
    const blocked = await f.start(body); assert.equal(blocked.response.status, 429); assert.equal(tokenRequests(f).length, 1);
    release(); assert.equal((await active).status, 303);
    assert.equal((await f.start(body)).response.status, 200);
  });
});

test('invalid optional refresh credentials are rejected before the host commits a verified binding', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true }); f.token(x => ({ ...x, refresh_token: { sensitive: REFRESH_TOKEN } }));
  const flow = await f.start(); const response = await f.callback(flow);
  assert(response.status >= 400); assert.equal(f.verified.length, 0); assert.equal(f.bridge.status().readyHandoffs, 0);
  assertNoTokens(await response.text());
});

test('closing the bridge during a host binding write cannot leave a native credential handoff', async t => {
  let announce, release; const entered = new Promise(resolve => { announce = resolve; });
  const blocked = new Promise(resolve => { release = resolve; }); t.after(() => release());
  const f = await fixture(t, { allowOwnerBrowserHandoff: true, onVerified: async () => { announce(); await blocked; } });
  const flow = await f.start(), active = f.callback(flow); await entered;
  f.bridge.close(); release(); const response = await active;
  assert.equal(response.status, 503); assertNoTokens(await response.text()); assert.equal(f.bridge.status().readyHandoffs, 0);
  assert.equal((await f.start()).response.status, 503);
});

test('the host can refuse a stale or conflicting binding without leaking native credentials', async t => {
  const f = await fixture(t, { allowOwnerBrowserHandoff: true,
    onVerified: async () => { throw new Error('private host account conflict ' + ACCESS_TOKEN); } });
  const flow = await f.start(); const response = await f.callback(flow);
  assert.equal(response.status, 409); const body = await response.text(); assertNoTokens(body); assert(!body.includes('private host account conflict'));
  assert.equal(f.bridge.status().readyHandoffs, 0); assert((await f.callback(flow)).status >= 400);
});

test('OAuth denial and duplicate callback fields cannot trigger token exchange', async t => {
  const f = await fixture(t); const deniedFlow = await f.start();
  assert.equal((await f.callback(deniedFlow, { error: 'access_denied' })).status, 403);
  assert.equal(tokenRequests(f).length, 0); assert((await f.callback(deniedFlow)).status >= 400);
  const duplicateFlow = await f.start(), state = duplicateFlow.authorization.searchParams.get('state');
  const query = new URLSearchParams({ state, code: 'issued-code' }); query.append('state', state);
  const duplicate = await f.request(f.bridge.paths.callback + '?' + query, { cookie: duplicateFlow.cookie });
  assert(duplicate.status >= 400); assert.equal(tokenRequests(f).length, 0);
});

test('a host binding write that never settles times out, aborts its context, and creates no credential handoff', async t => {
  let context;
  const f = await fixture(t, { allowOwnerBrowserHandoff: true, requestTimeoutMs: 100,
    onVerified: async (_binding, _accountId, value) => { context = value; await new Promise(() => {}); } });
  const flow = await f.start(); const response = await f.callback(flow);
  assert.equal(response.status, 504); assert(context.signal instanceof AbortSignal); assert.equal(context.signal.aborted, true);
  assertNoTokens(await response.text()); assert.equal(f.bridge.status().readyHandoffs, 0);
  assert((await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie })).status >= 400);
});

test('a native transport ignoring abort still times out and releases active ceremony capacity', async t => {
  const f = await fixture(t, { requestTimeoutMs: 100, maxPending: 1, maxPerAccount: 1 }); let release;
  f.blockToken(new Promise(resolve => { release = resolve; })); t.after(() => release());
  const flow = await f.start(); const active = f.callback(flow); await f.tokenEntered;
  assert.equal((await f.start()).response.status, 429);
  const response = await active;
  assert.equal(response.status, 504); assert.equal(tokenRequests(f)[0].signal.aborted, true);
  assertNoTokens(await response.text()); assert.equal(f.verified.length, 0); assert.equal(f.bridge.status().readyHandoffs, 0);
  // The first injected transport is still blocked: the HTTP timeout, rather
  // than cooperation from that transport, must release ceremony capacity.
  const next = await f.start(); assert.equal(next.response.status, 200);
  release();
});

test('owner handoff expiry is anchored to token issuance and cannot be extended by slow host persistence', async t => {
  await t.test('remaining lifetime', async t => {
    let f; f = await fixture(t, { allowOwnerBrowserHandoff: true, onVerified: async () => { f.advance(1000); } });
    f.token(x => ({ ...x, expires_in: 2 })); const flow = await f.start();
    assert.equal((await f.callback(flow)).status, 303);
    const response = await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie });
    assert.equal(response.status, 200); const payload = await response.json();
    assert.equal(payload.nativeSession.expiresAt, '2026-10-16T12:00:02.000Z');
  });
  await t.test('already expired', async t => {
    let f; f = await fixture(t, { allowOwnerBrowserHandoff: true, onVerified: async () => { f.advance(1001); } });
    f.token(x => ({ ...x, expires_in: 1 })); const flow = await f.start(); const response = await f.callback(flow);
    assert.equal(response.status, 502); assertNoTokens(await response.text()); assert.equal(f.bridge.status().readyHandoffs, 0);
    assert((await f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie })).status >= 400);
  });
});

test('claim rechecks host pod-access permission and concurrent claims disclose credentials only once', async t => {
  let permitted = true;
  const f = await fixture(t, { allowOwnerBrowserHandoff: true,
    authorizeGameAccount: async () => ({ accountId: 'local-alice', sessionId: 'session-alice', ownerPodWriteAccess: permitted }) });
  const flow = await f.start();
  assert.equal((await f.callback(flow)).status, 303);
  const claim = () => f.request(f.bridge.paths.claim, { method: 'POST', body: proofBody, cookie: flow.cookie });
  permitted = false;
  const refused = await claim();
  assert.equal(refused.status, 403); assertNoTokens(await refused.text());
  permitted = true;
  const responses = await Promise.all([claim(), claim()]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 404]);
  assert.equal(f.bridge.status().readyHandoffs, 0);
});
