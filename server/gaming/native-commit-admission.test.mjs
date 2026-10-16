import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { InteregoGamingStore } from './interego-store.js';
import { createPlayerAccountHost } from './player-account-host.js';

// Native I/O contract model only: the real callback, owner validation, ledger,
// stream adapter, CAS retry and handoff run unchanged. This test does not mock
// a signature verifier or claim to measure a live native backend. Other native
// suites exercise actual pinned SDK encryption and PGSL receipt verification.
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const codec = {
  createNativeByteArtifact: value => ({ ...value, bytes: Buffer.from(value.bytes).toString('base64') }),
  readNativeByteArtifact: value => ({ ...value, bytes: Buffer.from(value.bytes, 'base64') }),
};
function nativeFixture({ worldDelayMs = 70, bindingDelayMs = 180 } = {}) {
  let revision = null, sequence = 0; const records = new Map(), calls = [];
  let entered; const firstEntered = new Promise(resolve => { entered = resolve; });
  const snapshot = () => ({ revision, records: new Map(records) });
  return { calls, firstEntered,
    ready: async () => {}, readHead: async () => snapshot(), readArtifact: async value => structuredClone(value),
    async commit({ expected, changes, operationId }) {
      const stream = JSON.parse(Buffer.from(changes[0].artifact.bytes, 'base64')).streamId;
      calls.push(stream); if (stream === 'world') entered();
      const delay = stream === 'world' ? worldDelayMs : bindingDelayMs;
      if (delay) await wait(delay);
      if (expected.revision !== revision) throw Object.assign(new Error('Native fixture stale head'), { name: 'NativeCommitConflictError', status: 412 });
      for (const change of changes) records.set(change.key, structuredClone(change.artifact));
      revision = 'sha256:' + createHash('sha256').update(String(++sequence)).digest('hex');
      return { operationId, head: { revision }, snapshot: snapshot(), replayed: false };
    },
  };
}
async function hostFixture(t, store, options = {}) {
  const origin = 'https://game.example', relay = 'https://relay.interego.xwisee.com';
  const account = { id: 'qa-account', name: 'Synthetic player', guest: true }; let issued = 0;
  const fetch = async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: relay + '/',
      authorization_endpoint: relay + '/authorize', token_endpoint: relay + '/token', response_types_supported: ['code'],
      scopes_supported: ['mcp:read', 'mcp:write'], code_challenge_methods_supported: ['S256'],
      client_id_metadata_document_supported: true, token_endpoint_auth_methods_supported: ['none'] });
    if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ authorization_servers: [relay + '/'],
      affordances: [{ action: 'urn:iep:action:mcp:invoke', target: relay + '/mcp', method: 'POST' }] });
    if (url.endsWith('/token')) return Response.json({ access_token: 'native-access-fixture', refresh_token: 'native-refresh-fixture',
      token_type: 'Bearer', scope: 'mcp:write', expires_in: 3600 });
    assert.equal(url, relay + '/mcp'); assert.equal(JSON.parse(init.body).params.name, 'get_pod_status');
    return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {
      identity: { userId: 'u-pk-qa', did: 'did:web:identity.interego.xwisee.com:users:u-pk-qa', webId: 'https://identity.interego.xwisee.com/users/u-pk-qa/profile#me' },
      pod: 'http://css.railway.internal:3456/u-pk-qa/', registry: { owner: 'https://identity.interego.xwisee.com/users/u-pk-qa/profile#me' },
      sessionAgent: { id: 'hallowmarch-u-pk-qa', did: 'did:web:identity.interego.xwisee.com:agents:hallowmarch-u-pk-qa', scope: 'ReadWrite' },
    } } });
  };
  const host = createPlayerAccountHost({ store, publicOrigin: origin, fetch, requestTimeoutMs: 300, allowOwnerBrowserHandoff: true,
    ...options,
    tokenClaims: value => value === 'fixture-game-session' ? { id: account.id, exp: Date.now() + 3600000 } : null,
    getAccount: id => id === account.id ? account : null, restoreAccount: () => account, readLegacySave: () => null,
    issueAppSession: () => { issued++; return { token: 'new-app-fixture', acct: { id: account.id } }; },
  });
  t.after(() => host.close()); await host.ready;
  async function request(path, { method = 'GET', body, cookie, auth = true } = {}) {
    const req = { url: path, method, headers: { host: 'game.example', origin, 'content-type': 'application/json',
      ...(auth ? { authorization: 'Bearer fixture-game-session' } : {}), ...(cookie ? { cookie } : {}) },
      async *[Symbol.asyncIterator]() { if (body !== undefined) yield Buffer.from(JSON.stringify(body)); } };
    const headers = new Headers(); let status = 200, output;
    const res = { headersSent: false, getHeader: key => headers.get(key), setHeader: (key, value) => headers.set(key, value),
      writeHead(code, values = {}) { status = code; this.headersSent = true; for (const [key, value] of Object.entries(values)) headers.set(key, value); },
      end(value) { output = value; } };
    assert.equal(await host.handle(req, res), true);
    return new Response(output ?? null, { status, headers });
  }
  const startCeremony = async () => {
    const started = await request('/gaming/identity/start', { method: 'POST', body: { ownerPodWriteAccess: true } });
    assert.equal(started.status, 200, await started.clone().text()); const authorization = new URL((await started.json()).authorizationUrl);
    const cookie = started.headers.get('set-cookie').split(';')[0];
    return { callback: () => request('/gaming/identity/callback?' + new URLSearchParams({
      state: authorization.searchParams.get('state'), code: 'synthetic-issued-code' }), { cookie, auth: false }),
      claim: () => request('/gaming/identity/claim', { method: 'POST', body: { ownerPodWriteAccess: true }, cookie }) };
  };
  return { host, issued: () => issued, startCeremony, ...await startCeremony() };
}

test('actual callback/ledger avoids a scaled binding deadline after local unrelated-head admission', async t => {
  for (const serialized of [false, true]) await t.test(serialized ? 'bounded admission' : 'unserialized control reproduces timeout', async t => {
    const native = nativeFixture();
    const store = new InteregoGamingStore({ nativeClient: native, artifactCodec: codec, owner: 'urn:game:qa', namespace: 'callback-queue-fixture' });
    // Explicitly reproduce the pre-fix adapter as the experimental control.
    if (!serialized) store.admitCommit = operation => operation();
    const f = await hostFixture(t, store);
    const world = store.commit('world', { expectedVersion: 0, state: { season: 1 }, idempotencyKey: 'first-world' });
    await native.firstEntered;
    const response = await f.callback(); await world;
    if (serialized) {
      assert.equal(response.status, 303, await response.clone().text());
      assert.equal(f.issued(), 1); assert.equal((await f.claim()).status, 200);
      assert.equal(f.host.status().callbackFailures.identity_binding_timeout, 0);
      assert.deepEqual(native.calls, ['world', 'player-bindings-v1']);
    } else {
      assert.equal(response.status, 504, await response.clone().text()); assert.equal((await response.json()).error, 'identity_binding_timeout');
      assert.equal(f.host.status().callbackFailures.identity_binding_timeout, 1);
      assert.equal(f.host.status().callbackFailures.identity_service_timeout, 0);
      await wait(250); // The already-started native operation may finish late.
      assert.equal((await store.load('player-bindings-v1')).version, 1);
      assert.equal(f.issued(), 0); assert.equal(f.host.status().readyHandoffs, 0);
      assert((await f.claim()).status >= 400);
      assert.deepEqual(native.calls, ['world', 'player-bindings-v1', 'player-bindings-v1']);
    }
  });
});

test('commit admission is bounded per store and queued input is detached before awaiting its permit', async () => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const native = nativeFixture(), original = native.commit.bind(native);
  native.commit = async request => { if (!release.done) { release.done = true; entered(); await gate; } return original(request); };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec: codec, owner: 'urn:game:one', namespace: 'bounded', maxPendingCommits: 2 });
  const first = store.commit('world', { expectedVersion: 0, state: {}, idempotencyKey: 'first' }); await started;
  const input = { nested: { value: 'captured' } };
  const queued = store.commit('bindings', { expectedVersion: 0, state: input, idempotencyKey: 'second' });
  input.nested.value = 'changed after admission';
  await assert.rejects(store.commit('third', { expectedVersion: 0, state: {}, idempotencyKey: 'third' }), { code: 'NATIVE_COMMIT_CAPACITY' });
  const other = new InteregoGamingStore({ nativeClient: nativeFixture(), artifactCodec: codec, owner: 'urn:game:other', namespace: 'independent' });
  assert.equal((await other.commit('independent', { expectedVersion: 0, state: {}, idempotencyKey: 'one' })).version, 1);
  release(); await first; assert.equal((await queued).state.nested.value, 'captured');
});

test('aborting a queued operation removes only that operation and restores bounded admission capacity', async () => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); const native = nativeFixture();
  const original = native.commit.bind(native);
  native.commit = async request => { if (!release.done) { release.done = true; entered(); await gate; } return original(request); };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec: codec, owner: 'urn:game:abort', namespace: 'abort', maxPendingCommits: 2 });
  const activeSignal = new AbortController(), queuedSignal = new AbortController();
  const first = store.commit('world', { expectedVersion: 0, state: {}, idempotencyKey: 'first', signal: activeSignal.signal }); await started;
  const aborted = store.commit('cancelled', { expectedVersion: 0, state: {}, idempotencyKey: 'cancelled', signal: queuedSignal.signal });
  const refusal = assert.rejects(aborted, { code: 'OPERATION_ABORTED' }); queuedSignal.abort(); await refusal;
  assert.deepEqual(store.commitAdmissionStatus(), { active: true, queued: 0, capacity: 2, settlementFailed: false });
  const next = store.commit('after-cancel', { expectedVersion: 0, state: {}, idempotencyKey: 'after' });
  activeSignal.abort(); await wait(10);
  assert.deepEqual(native.calls, [], 'active transaction remains blocked without launching the queued transaction');
  release(); assert.equal((await first).version, 1); assert.equal((await next).version, 1);
  assert.deepEqual(native.calls, ['world', 'after-cancel']); assert.equal((await store.load('cancelled')).version, 0);
  await assert.rejects(store.commit('already-aborted', { expectedVersion: 0, state: {}, idempotencyKey: 'aborted', signal: queuedSignal.signal }), { code: 'OPERATION_ABORTED' });
  await assert.rejects(store.commit('bad-signal', { expectedVersion: 0, state: {}, idempotencyKey: 'bad', signal: {} }), { code: 'INVALID_INPUT' });
});

test('the actual callback cancellation removes a not-yet-started native binding instead of creating it late', async t => {
  let release, entered; const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); const native = nativeFixture();
  const original = native.commit.bind(native);
  native.commit = async request => { if (!release.done) { release.done = true; entered(); await gate; } return original(request); };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec: codec, owner: 'urn:game:queued-callback', namespace: 'queued-callback' });
  const f = await hostFixture(t, store);
  const world = store.commit('world', { expectedVersion: 0, state: {}, idempotencyKey: 'blocked-world' }); await started;
  try {
    const response = await f.callback(); assert.equal(response.status, 504);
    assert.equal((await response.json()).error, 'identity_binding_timeout');
    assert.equal(store.commitAdmissionStatus().queued, 0, 'callback abort reaches queued ledger commit');
    assert.equal(f.issued(), 0); assert.equal(f.host.status().readyHandoffs, 0);
  } finally { release(); await world; }
  assert.equal((await store.load('player-bindings-v1')).version, 0);
  assert.deepEqual(native.calls, ['world']);
  const retry = await f.startCeremony();
  const response = await retry.callback(); assert.equal(response.status, 303, await response.clone().text());
  assert.equal((await retry.claim()).status, 200); assert.equal(f.issued(), 1);
  assert.deepEqual(native.calls, ['world', 'player-bindings-v1']);
});

test('the 30s host allowance still cancels queued binding work without releasing the active native permit', async t => {
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; }), started = new Promise(resolve => { entered = resolve; });
  const native = nativeFixture({ worldDelayMs: 0, bindingDelayMs: 0 }), original = native.commit.bind(native);
  native.commit = async request => { if (!release.done) { release.done = true; entered(); await gate; } return original(request); };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec: codec,
    owner: 'urn:game:binding-deadline', namespace: 'binding-deadline' });
  const f = await hostFixture(t, store, { requestTimeoutMs: 15_000, bindingTimeoutMs: 30_000 });
  const world = store.commit('world', { expectedVersion: 0, state: {}, idempotencyKey: 'held-world' }); await started;
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const active = f.callback();
  try {
    for (let i = 0; i < 20 && store.commitAdmissionStatus().queued === 0; i++) await new Promise(setImmediate);
    assert.equal(store.commitAdmissionStatus().queued, 1, 'binding is waiting behind the actual native world write');
    t.mock.timers.tick(15_001);
    assert.equal(store.commitAdmissionStatus().queued, 1, 'binding remains eligible beyond the former deadline');
    t.mock.timers.tick(14_999); const response = await active;
    assert.equal(response.status, 504); assert.equal((await response.json()).error, 'identity_binding_timeout');
    assert.deepEqual(store.commitAdmissionStatus(), { active: true, queued: 0, capacity: 64, settlementFailed: false });
    assert.equal(store.performanceStatus().cancelled, 1);
    assert.equal(f.issued(), 0); assert.equal(f.host.status().readyHandoffs, 0);
    assert((await f.claim()).status >= 400);
  } finally { release(); await world; }
  assert.equal((await store.load('player-bindings-v1')).version, 0, 'cancelled binding never reaches the native head');
  const retry = await f.startCeremony();
  assert.equal((await retry.callback()).status, 303); assert.equal((await retry.claim()).status, 200);
  assert.equal(f.issued(), 1); assert.deepEqual(native.calls, ['world', 'player-bindings-v1']);
});
