import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InteregoGamingStore, createInteregoStore, createNativeTransport, DurableStoreConflictError } from './interego-store.js';

/*
 * LOCAL CONTRACT FIXTURE ONLY. It implements the native HTTP command, CAS
 * predicates, receipt bindings and disk restart for adapter tests. Its codec
 * deliberately uses plain test bytes, not PGSL/encryption. These tests do not
 * prove the real CSS/PGSL engine's durability or performance. Production must
 * inject the actual @interego/pgsl SDK, never this fixture.
 */
const MEDIA = 'application/vnd.interego.native-commit+json';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');

function immutableTransportFixture(overrides = {}) {
  const scope = { pod: 'https://native.example/game/', headUrl: 'https://native.example/game/head',
    artifactContainer: 'https://native.example/game/artifacts/', owner: 'urn:game:test' };
  const calls = [], rows = new Map(), controls = { credentials: true, status: 200, tamperDigest: false };
  function add(value, kind = 'artifact') {
    const bytes = Buffer.from(JSON.stringify(value)), url = scope.artifactContainer + kind + '-' + digest(bytes).slice(7) + '.json';
    rows.set(url, bytes); return url;
  }
  const response = url => {
    const bytes = rows.get(url) || Buffer.from('{}'), revision = digest('test-revision');
    return new Response(bytes, { status: controls.status, headers: { 'Content-Type': 'application/json',
      ETag: '"' + revision + '-json"', 'Interego-Revision': revision,
      'Interego-Body-Digest': controls.tamperDigest ? digest('wrong') : digest(bytes) } });
  };
  const options = { scope, credentialsProvider: async () => controls.credentials ? { Authorization: 'Bearer own-pod-test' } : {},
    transport: async (url, init) => { calls.push([init.method, url]); return response(url); }, ...overrides };
  return { scope, calls, rows, controls, add, response, options, create: extra => createNativeTransport({ ...options, ...extra }) };
}

test('immutable native cache detaches bodies, preserves credentials and cold reads; heads and OPTIONS always use network', async () => {
  const f = immutableTransportFixture(), url = f.add({ ciphertext: 'verified bytes' }), get = f.create();
  const first = await get(url); first.headers.set('Interego-Body-Digest', 'mutated');
  new Uint8Array(await first.arrayBuffer()).fill(0);
  assert.deepEqual(await (await get(url)).json(), { ciphertext: 'verified bytes' });
  assert.equal(f.calls.length, 1);
  assert.equal((await get(url)).headers.get('Interego-Body-Digest'), digest(f.rows.get(url)));
  await get(f.scope.headUrl); await get(f.scope.headUrl);
  await get(url, { method: 'OPTIONS' }); await get(url, { method: 'OPTIONS' });
  assert.equal(f.calls.length, 5);
  f.controls.credentials = false;
  await assert.rejects(get(url), /credentials are unavailable/);
  assert.equal(f.calls.length, 5, 'a cached ciphertext never bypasses credential resolution');
  f.controls.credentials = true;
  await f.create()(url);
  assert.equal(f.calls.length, 6, 'a new transport proves recovery through a fresh network read');
});

test('cache accepts only exact native immutable URL, body SHA-256 and read metadata', async () => {
  const f = immutableTransportFixture(), url = f.add({ ciphertext: 'original' }), get = f.create();
  f.controls.tamperDigest = true;
  await get(url); await get(url); assert.equal(f.calls.length, 2);
  f.controls.tamperDigest = false;
  const wrongUrl = f.scope.artifactContainer + 'artifact-' + 'a'.repeat(64) + '.json';
  f.rows.set(wrongUrl, f.rows.get(url));
  await get(wrongUrl); await get(wrongUrl); assert.equal(f.calls.length, 4);
  const lookalike = f.scope.artifactContainer + 'nested/' + url.split('/').at(-1);
  f.rows.set(lookalike, f.rows.get(url));
  await get(lookalike); await get(lookalike); assert.equal(f.calls.length, 6);
  f.controls.status = 401;
  assert.equal((await get(url)).status, 401); assert.equal((await get(url)).status, 401);
  assert.equal(f.calls.length, 8, 'native authorization failures are never cached');
  f.controls.status = 200;
  await get(url); await get(url); assert.equal(f.calls.length, 9);
});

test('every PUT and its first verification GET remain live, including failed CAS', async () => {
  const f = immutableTransportFixture(), url = f.add({ ciphertext: 'persisted' }, 'commit'), get = f.create();
  await get(url); await get(url); assert.equal(f.calls.length, 1);
  await get(url, { method: 'PUT', body: '{}' }); assert.equal(f.calls.length, 2);
  await get(url); assert.equal(f.calls.length, 3);
  await get(url); assert.equal(f.calls.length, 3);
  f.controls.status = 412;
  assert.equal((await get(url, { method: 'PUT', body: '{}' })).status, 412);
  f.controls.status = 200;
  await get(url); assert.equal(f.calls.length, 5, 'a failed native CAS cannot preserve a readback shortcut');
});

test('immutable cache enforces LRU entry and total byte budgets', async () => {
  const f = immutableTransportFixture(), a = f.add({ a: 1 }), b = f.add({ b: 2 }), c = f.add({ c: 3 });
  const get = f.create({ cacheMaxEntries: 2 });
  await get(a); await get(b); await get(a); await get(c); await get(a);
  assert.equal(f.calls.length, 3);
  await get(b); assert.equal(f.calls.length, 4, 'least recently used b was evicted');
  const tiny = f.create({ cacheMaxBytes: 1 });
  await tiny(a); await tiny(a); assert.equal(f.calls.length, 6, 'oversized entries never exceed a byte budget');
  const disabled = f.create({ cacheMaxEntries: 0 });
  await disabled(a); await disabled(a); assert.equal(f.calls.length, 8);
  const entrySize = url => f.rows.get(url).length + Buffer.byteLength(JSON.stringify([...f.response(url).headers]) + url);
  const byteBound = f.create({ cacheMaxBytes: Math.max(entrySize(a), entrySize(b)) + 1 });
  await byteBound(a); await byteBound(b); await byteBound(a);
  assert.equal(f.calls.length, 11, 'total ciphertext and metadata bytes also evict older entries');
  assert.throws(() => f.create({ cacheMaxBytes: -1 }), /bounded timeout/);
});

test('read begun before a concurrent PUT cannot populate its verification cache', async () => {
  const f = immutableTransportFixture(), url = f.add({ ciphertext: 'same immutable bytes' });
  let release, started;
  const firstStarted = new Promise(resolve => { started = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  let first = true;
  const get = f.create({ transport: async (target, init) => {
    f.calls.push([init.method, target]);
    if (init.method === 'GET' && first) { first = false; started(); await pending; }
    return f.response(target);
  } });
  const earlierRead = get(url); await firstStarted;
  await get(url, { method: 'PUT', body: '{}' });
  release(); await earlierRead;
  await get(url); assert.equal(f.calls.length, 3, 'first post-write verification reached native storage');
  await get(url); assert.equal(f.calls.length, 3);
});
const artifactCodec = {
  createNativeByteArtifact(input) { return { owner: input.owner, contentType: input.contentType, bytes: Buffer.from(input.bytes).toString('base64') }; },
  readNativeByteArtifact(artifact) { return { ...artifact, bytes: Buffer.from(artifact.bytes, 'base64') }; },
};

test('selected adapter readiness and absence use exact detached coverage without complete-index reads', async () => {
  const requests = [], native = { ready: async () => {}, readHead: () => assert.fail('selected client must not enumerate full native index'),
    readArtifact: () => assert.fail('confirmed absence has no artifact'), commit: () => assert.fail('readiness must never write'),
    async readHeadRecords(keys) { requests.push([...keys]); return { revision: null, records: new Map(), selectedRecordKeys: [...keys] }; } };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec, owner: 'urn:test:owner', namespace: 'selected-test' });
  await store.ready(); assert.deepEqual(requests, [[]]);
  assert.equal((await store.load('stream')).version, 0); assert.deepEqual(requests[1], [store.keys('stream').stream]);
  assert.equal(store.performanceStatus().snapshotMode, 'selected-records');
  assert.equal(store.performanceStatus().snapshotReads, 2);
  await assert.rejects(store.record({ selectedRecordKeys: [], records: new Map() }, 'unrequested'), { code: 'CORRUPT_DURABLE_STATE' });
  native.readHeadRecords = async keys => { keys.length = 0; return { revision: null, records: new Map(), selectedRecordKeys: [] }; };
  await assert.rejects(store.load('must-be-covered'), { code: 'CORRUPT_DURABLE_STATE' });
  for (const coverage of [undefined, [], ['foreign'], [store.keys('stream').stream, 'extra']]) {
    native.readHeadRecords = async () => ({ revision: null, records: new Map(), selectedRecordKeys: coverage });
    await assert.rejects(store.load('stream'), { code: 'CORRUPT_DURABLE_STATE' });
  }
  native.readHeadRecords = async keys => ({ revision: null, records: new Map([['foreign', {}]]), selectedRecordKeys: keys });
  await assert.rejects(store.load('stream'), { code: 'CORRUPT_DURABLE_STATE' });
});

test('selected commit/recovery/result requests cover only stream and operation, and result selection cannot erase expected coverage', async () => {
  const records = new Map(), requests = []; let revision = null;
  const native = { ready: async () => {}, readHead: () => assert.fail('selected client must not enumerate full native index'),
    readArtifact: async value => value,
    async readHeadRecords(keys) { requests.push([...keys]); return { revision, records: new Map([...records].filter(([key]) => keys.includes(key))), selectedRecordKeys: [...keys] }; },
    async commit(input) {
      assert.deepEqual([...input.resultRecordKeys].sort(), input.expected.selectedRecordKeys);
      for (const change of input.changes) records.set(change.key, change.artifact);
      revision = 'sha256:' + 'a'.repeat(64); input.resultRecordKeys.length = 0;
      return { operationId: input.operationId, head: { revision }, snapshot: { revision, records: new Map(), selectedRecordKeys: [] } };
    } };
  const store = new InteregoGamingStore({ nativeClient: native, artifactCodec, owner: 'urn:test:owner', namespace: 'selected-test' });
  const result = await store.commit('stream', { expectedVersion: 0, state: { own: true }, idempotencyKey: 'op' });
  assert.equal(result.version, 1); assert.equal(result.replayed, true, 'bad result coverage requires independent verified operation readback');
  const keys = store.keys('stream', 'op'); assert.deepEqual(requests, [[keys.stream, keys.operation].sort(), [keys.stream, keys.operation].sort()]);
  assert.equal((await store.load('stream')).state.own, true);
});

class FixtureNativeClient {
  constructor({ scope, fetch }) { this.scope = scope; this.fetch = fetch; }
  async ready() {
    const response = await this.fetch(this.scope.headUrl, { method: 'OPTIONS' });
    assert.equal(response.headers.get('Interego-Native-Commit'), '1');
    assert.equal(response.headers.get('Accept-Put'), MEDIA);
  }
  async readHead() {
    const response = await this.fetch(this.scope.headUrl);
    if (response.status === 404) return { revision: null, records: new Map(), scope: this.scope };
    if (!response.ok) throw new Error('Fixture native read unavailable');
    const bytes = Buffer.from(await response.arrayBuffer());
    if (response.headers.get('Interego-Body-Digest') !== digest(bytes)) throw new Error('Fixture body digest mismatch');
    const data = JSON.parse(bytes);
    return { revision: response.headers.get('Interego-Revision'), records: new Map(data.records), scope: this.scope };
  }
  async readArtifact(reference) { return structuredClone(reference); }
  async commit({ expected, changes, operationId }) {
    const records = new Map(expected.records);
    for (const change of changes) records.set(change.key, change.artifact);
    const body = Buffer.from(JSON.stringify({ operationId, records: [...records] }));
    const response = await this.fetch(this.scope.headUrl, { method: 'PUT', headers: {
      'Content-Type': MEDIA, ...(expected.revision ? { 'If-Match': '"' + expected.revision + '"' } : { 'If-None-Match': '*' }),
    }, body: JSON.stringify({ version: 1, expectedRevision: expected.revision, contentType: 'application/json', bodyBase64: body.toString('base64') }) });
    if (response.status === 412) { const error = new Error('Native head changed'); error.name = 'NativeCommitConflictError'; error.status = 412; throw error; }
    if (!response.ok) throw new Error('Fixture native commit unavailable');
    const receipt = await response.json();
    assert.equal(receipt.bodyDigest, digest(body));
    assert.equal(receipt.expectedRevision, expected.revision);
    assert.equal(receipt.resource, this.scope.headUrl);
    return { operationId, head: { revision: receipt.revision }, resourceReceipt: receipt, replayed: false,
      snapshot: { revision: receipt.revision, records, scope: this.scope } };
  }
}

async function fixture(t) {
  const directory = mkdtempSync(join(tmpdir(), 'gaming-native-contract-')), path = join(directory, 'head.json');
  const counts = { get: 0, put: 0, options: 0 }, controls = { refuse: false, unreadable: false, corruptRecord: false };
  let server, port;
  function persisted() { try { return JSON.parse(readFileSync(path, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
  async function start() {
    server = createServer(async (request, response) => {
      try {
        response.setHeader('Connection', 'close');
        assert.equal(request.headers.authorization, 'Bearer local-fixture-only');
        if (request.method === 'OPTIONS') {
          counts.options++;
          response.writeHead(200, { 'Interego-Native-Commit': '1', 'Accept-Put': MEDIA }); response.end(); return;
        }
        const current = persisted();
        if (request.method === 'GET') {
          counts.get++;
          if (controls.unreadable) { response.writeHead(503); response.end(); return; }
          if (!current) { response.writeHead(404); response.end(); return; }
          let body = Buffer.from(current.bodyBase64, 'base64');
          if (controls.corruptRecord) {
            const data = JSON.parse(body);
            data.records[0][1].bytes = Buffer.from('{broken').toString('base64');
            body = Buffer.from(JSON.stringify(data));
          }
          response.writeHead(200, { 'Content-Type': 'application/json', 'ETag': '"' + current.revision + '"',
            'Interego-Revision': current.revision, 'Interego-Body-Digest': digest(body) }); response.end(body); return;
        }
        assert.equal(request.method, 'PUT');
        assert.equal(request.headers['content-type'], MEDIA);
        counts.put++;
        const chunks = []; for await (const chunk of request) chunks.push(chunk);
        const command = JSON.parse(Buffer.concat(chunks));
        assert.deepEqual(Object.keys(command).sort(), ['bodyBase64', 'contentType', 'expectedRevision', 'version']);
        assert.equal(command.version, 1); assert.equal(command.contentType, 'application/json');
        const body = Buffer.from(command.bodyBase64, 'base64');
        assert.equal(body.toString('base64'), command.bodyBase64);
        const actual = persisted();
        const expected = actual?.revision ?? null;
        const predicate = command.expectedRevision === null ? request.headers['if-none-match'] === '*'
          : request.headers['if-match'] === '"' + command.expectedRevision + '"';
        if (!predicate) { response.writeHead(400); response.end(); return; }
        if (command.expectedRevision !== expected) { response.writeHead(412); response.end(); return; }
        if (controls.refuse) { response.writeHead(503); response.end(); return; }
        const revision = digest(Buffer.concat([body, Buffer.from(String((actual?.sequence ?? 0) + 1))]));
        const next = { bodyBase64: command.bodyBase64, revision, sequence: (actual?.sequence ?? 0) + 1 };
        const temporary = path + '.tmp'; writeFileSync(temporary, JSON.stringify(next));
        const fd = openSync(temporary, 'r'); fsyncSync(fd); closeSync(fd); renameSync(temporary, path);
        const dirFd = openSync(directory, 'r'); fsyncSync(dirFd); closeSync(dirFd);
        const resource = 'http://127.0.0.1:' + port + request.url;
        response.writeHead(200, { 'Content-Type': 'application/json', ETag: '"' + revision + '"' });
        response.end(JSON.stringify({ version: 1, status: 'committed', expectedRevision: expected, resource,
          revision, bodyDigest: digest(body), contentType: command.contentType, size: body.length,
          pod: 'css', path: resource, updatedAt: Date.now(), topUri: 'urn:fixture:top', opaqueUri: 'urn:fixture:opaque' }));
      } catch (error) { response.writeHead(500); response.end(String(error.message)); }
    });
    server.listen(port ?? 0, '127.0.0.1'); await once(server, 'listening'); port = server.address().port;
  }
  async function close() { if (server?.listening) { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); } }
  await start();
  t.after(async () => { await close(); rmSync(directory, { recursive: true, force: true }); });
  const scope = { pod: 'http://127.0.0.1:' + port + '/gaming/', headUrl: 'http://127.0.0.1:' + port + '/gaming/head.json',
    artifactContainer: 'http://127.0.0.1:' + port + '/gaming/artifacts/', owner: 'urn:local:gaming-owner' };
  function store(overrides = {}) {
    return createInteregoStore({ native: { NativeCommitStore: FixtureNativeClient, ...artifactCodec }, scope,
      senderKeyPair: { publicKey: 'fixture-stable-key', secretKey: 'fixture-not-real' }, ownerPublicKey: 'fixture-stable-key',
      recipientPublicKeys: ['fixture-stable-key'], credentialsProvider: async () => ({ Authorization: 'Bearer local-fixture-only' }),
      namespace: 'hallowmarch-tests', ...overrides });
  }
  return { store, scope, counts, controls, async restart() { await close(); await start(); } };
}

test('native HTTP contract: atomic state/event, cold adapter and fixture restart, bounded latest event', async t => {
  const f = await fixture(t), first = f.store();
  await first.ready();
  assert.equal(f.counts.put, 0, 'readiness never invents a production write');
  assert.deepEqual(await first.load('realm-a'), { version: 0, state: null, events: [], nativeRevision: null, replayed: false });
  const one = await first.commit('realm-a', { expectedVersion: 0, state: { monster: { hp: 40 } }, event: { type: 'spawn' }, idempotencyKey: 'spawn-1' });
  assert.equal(one.version, 1); assert.equal(one.replayed, false); assert.deepEqual(one.events, [{ type: 'spawn' }]);
  await first.commit('realm-a', { expectedVersion: 1, state: { monster: { hp: 30 } }, event: { type: 'damage' }, idempotencyKey: 'hit-1' });
  await f.restart();
  const restored = await f.store().load('realm-a');
  assert.equal(restored.version, 2); assert.equal(restored.state.monster.hp, 30); assert.deepEqual(restored.events, [{ type: 'damage' }]);
});

test('independent writers cannot publish the same stream version twice', async t => {
  const f = await fixture(t), a = f.store(), b = f.store();
  const results = await Promise.allSettled([
    a.commit('shared', { expectedVersion: 0, state: { winner: 'a' }, idempotencyKey: 'a' }),
    b.commit('shared', { expectedVersion: 0, state: { winner: 'b' }, idempotencyKey: 'b' }),
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  const rejected = results.find(result => result.status === 'rejected').reason;
  assert.ok(rejected instanceof DurableStoreConflictError); assert.equal(rejected.actualVersion, 1);
  assert.equal((await f.store().load('shared')).version, 1);
});

test('scope contention can retry an unrelated stream without overwriting the winner', async t => {
  const f = await fixture(t);
  await Promise.all([
    f.store().commit('one', { expectedVersion: 0, state: { hp: 1 }, idempotencyKey: 'one' }),
    f.store().commit('two', { expectedVersion: 0, state: { hp: 2 }, idempotencyKey: 'two' }),
  ]);
  assert.equal((await f.store().load('one')).state.hp, 1);
  assert.equal((await f.store().load('two')).state.hp, 2);
});

test('same-store unrelated stream commits enter native CAS in FIFO order without avoidable scope conflicts', async t => {
  const f = await fixture(t); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const firstEntered = new Promise(resolve => { entered = resolve; });
  let puts = 0;
  const store = f.store({ transport: async (url, init) => {
    if (init.method === 'PUT' && ++puts === 1) { entered(); await gate; }
    return fetch(url, init);
  } });
  const first = store.commit('world', { expectedVersion: 0, state: { season: 1 }, idempotencyKey: 'world' });
  first.catch(() => {}); await firstEntered;
  const second = store.commit('player-bindings', { expectedVersion: 0, state: { bindings: [] }, idempotencyKey: 'bindings' });
  second.catch(() => {});
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(puts, 1, 'another local stream must wait for the original native head transaction');
  } finally { release(); await Promise.allSettled([first, second]); }
  assert.equal((await first).version, 1); assert.equal((await second).version, 1);
  assert.equal(f.counts.put, 2, 'local admission avoids a redundant native CAS attempt');
});

test('a timed-out native PUT keeps normal abort-honoring fetch alive and retains its permit until the response settles', async t => {
  const f = await fixture(t); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const firstEntered = new Promise(resolve => { entered = resolve; });
  let puts = 0;
  const store = f.store({ timeoutMs: 100, transport: async (url, init) => {
    if (init.method === 'PUT' && ++puts === 1) {
      entered(); await gate;
      assert.equal(init.signal, undefined, 'a caller deadline must not abort a launched native CAS');
      return fetch(url, init);
    }
    return fetch(url, init);
  } });
  const input = { expectedVersion: 0, state: { season: 1 }, idempotencyKey: 'late-world' };
  const first = store.commit('world', input); first.catch(() => {});
  await Promise.race([firstEntered, first.then(() => assert.fail('the blocked write cannot already be confirmed'))]);
  await assert.rejects(first, error => ['COMMIT_UNCERTAIN', 'DURABILITY_UNAVAILABLE'].includes(error.code));
  const next = store.commit('bindings', { expectedVersion: 0, state: { bindings: [] }, idempotencyKey: 'after-late-world' });
  next.catch(() => {});
  try {
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(puts, 1, 'an expired response is not proof that its actual native write ended');
  } finally { release(); await Promise.allSettled([next]); }
  assert.equal((await next).version, 1);
  const replayed = await store.commit('world', input);
  assert.equal(replayed.version, 1); assert.equal(replayed.replayed, true);
  assert.equal(f.counts.put, 2, 'the uncertain original operation is recovered without a duplicate native write');
});

test('a dispatched PUT connection failure without confirmed native readback fences queued and later commits', async t => {
  const f = await fixture(t); let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; }); let puts = 0;
  const store = f.store({ transport: async (url, init) => {
    if (init.method !== 'PUT' || ++puts !== 1) return fetch(url, init);
    entered(); await gate;
    // An actual network rejection cannot establish whether the remote accepted
    // the request. This explicit transport fault leaves no confirmed receipt.
    throw new Error('connection lost after dispatch with private transport details');
  } });
  const input = { expectedVersion: 0, state: { season: 1 }, idempotencyKey: 'unknown-world' };
  const first = store.commit('world', input); first.catch(() => {}); await started;
  const queued = store.commit('bindings', { expectedVersion: 0, state: {}, idempotencyKey: 'queued' }); queued.catch(() => {});
  release();
  await assert.rejects(first, error => ['COMMIT_UNCERTAIN', 'DURABILITY_UNAVAILABLE'].includes(error.code));
  await assert.rejects(queued, { code: 'NATIVE_COMMIT_FENCED' });
  assert.deepEqual(store.commitAdmissionStatus(), { active: true, queued: 0, capacity: 64, settlementFailed: true });
  await assert.rejects(store.commit('later', { expectedVersion: 0, state: {}, idempotencyKey: 'later' }), { code: 'NATIVE_COMMIT_FENCED' });
  await assert.rejects(store.ready(), { code: 'NATIVE_COMMIT_FENCED' });
  assert.equal(puts, 1, 'unknowable dispatched failure cannot release another write in this adapter');
  const fresh = f.store();
  assert.equal((await fresh.commit('world', input)).version, 1, 'fresh recovery reuses the exact operation key');
  assert.equal(f.counts.put, 1);
});

test('a credential deadline before PUT dispatch releases admission and cannot launch a delayed write', async t => {
  const f = await fixture(t); let release, entered, firstPut = true;
  const credentials = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  const store = f.store({ timeoutMs: 300, credentialsProvider: async ({ method }) => {
    if (method === 'PUT' && firstPut) { firstPut = false; entered(); return credentials; }
    return { Authorization: 'Bearer local-fixture-only' };
  } });
  const input = { expectedVersion: 0, state: {}, idempotencyKey: 'credential-deadline' };
  const first = store.commit('world', input); first.catch(() => {});
  await Promise.race([started, first.then(() => assert.fail('the missing credentials cannot confirm a write'))]);
  await assert.rejects(first, error => ['COMMIT_UNCERTAIN', 'DURABILITY_UNAVAILABLE'].includes(error.code));
  assert.equal((await store.commit('after', { expectedVersion: 0, state: {}, idempotencyKey: 'after' })).version, 1);
  release({ Authorization: 'Bearer local-fixture-only' }); await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(f.counts.put, 1); assert.equal((await store.load('world')).version, 0);
  assert.equal((await store.commit('world', input)).version, 1, 'the refused original operation can reuse its exact idempotency key');
});

test('replayed operation survives later commits; changing its content is rejected', async t => {
  const f = await fixture(t), store = f.store();
  const command = { expectedVersion: 0, state: { loot: ['stone'] }, event: { type: 'loot' }, idempotencyKey: 'loot-1' };
  await store.commit('room', command);
  await store.commit('room', { expectedVersion: 1, state: { loot: ['stone', 'wood'] }, idempotencyKey: 'loot-2' });
  const puts = f.counts.put;
  const replayed = await f.store().commit('room', command);
  assert.equal(replayed.replayed, true); assert.equal(replayed.version, 1); assert.equal(f.counts.put, puts);
  assert.equal((await store.load('room')).version, 2, 'retry does not roll the current stream back');
  await assert.rejects(store.commit('room', { ...command, state: { loot: ['gold'] } }), { code: 'IDEMPOTENCY_CONFLICT' });
});

test('lost commit acknowledgement recovers by durable idempotency record', async t => {
  const f = await fixture(t);
  let lose = true;
  const transport = async (url, init) => {
    const response = await fetch(url, init);
    if (init.method === 'PUT' && response.ok && lose) { lose = false; await response.arrayBuffer(); throw new Error('lost response'); }
    return response;
  };
  const store = f.store({ transport });
  const result = await store.commit('room', { expectedVersion: 0, state: { loot: 1 }, idempotencyKey: 'unique-loot' });
  assert.equal(result.version, 1); assert.equal(result.replayed, true); assert.equal(f.counts.put, 1);
  assert.equal((await store.commit('other', { expectedVersion: 0, state: {}, idempotencyKey: 'after-proven-recovery' })).version, 1,
    'exact verified operation readback resolves a lost response before admitting a later write');
});

test('unconfirmed storage failure never acknowledges or creates volatile state', async t => {
  const f = await fixture(t); f.controls.refuse = true;
  const command = { expectedVersion: 0, state: { reward: 1 }, idempotencyKey: 'reward' };
  await assert.rejects(f.store().commit('room', command), { code: 'COMMIT_UNCERTAIN' });
  assert.equal((await f.store().load('room')).state, null);
  f.controls.refuse = false;
  assert.equal((await f.store().commit('room', command)).version, 1);
  f.controls.unreadable = true;
  await assert.rejects(f.store().load('room'), /unavailable/);
});

test('missing authentication, unsafe targets and oversized/non-JSON input fail before writes', async t => {
  const f = await fixture(t), store = f.store({ maxStateBytes: 32 });
  await assert.rejects(store.commit('room', { expectedVersion: 0, state: { large: 'x'.repeat(40) }, idempotencyKey: 'oversize' }), { code: 'PAYLOAD_TOO_LARGE' });
  for (const state of [{ value: NaN }, { missing: undefined }, { sparse: Array(1) }]) {
    await assert.rejects(store.commit('room', { expectedVersion: 0, state, idempotencyKey: 'invalid' }), { code: 'INVALID_INPUT' });
  }
  assert.equal(f.counts.put, 0);
  await assert.rejects(f.store({ credentialsProvider: async () => ({}) }).load('room'), { code: 'DURABILITY_UNAVAILABLE' });
  const transport = createNativeTransport({ scope: f.scope, credentialsProvider: async () => ({ Authorization: 'fixture' }) });
  await assert.rejects(transport('https://unrelated.example/resource'), /escaped/);
  const invalid = createNativeTransport({ scope: f.scope, credentialsProvider: async () => ({ 'If-Match': '*' }) });
  await assert.rejects(invalid(f.scope.headUrl), /cannot replace/);
});

test('returned state is detached; corrupt native records do not become an empty game', async t => {
  const f = await fixture(t), store = f.store();
  const state = { hp: 5 };
  const committed = store.commit('room', { expectedVersion: 0, state, idempotencyKey: 'init' });
  state.hp = 999;
  const result = await committed; assert.equal(result.state.hp, 5); result.state.hp = -1;
  assert.equal((await store.load('room')).state.hp, 5);
  f.controls.corruptRecord = true;
  await assert.rejects(store.load('room'), { code: 'CORRUPT_DURABLE_STATE' });
});

test('production composition refuses an absent native SDK or unstable key configuration', () => {
  assert.throws(() => createInteregoStore({}), { code: 'INVALID_CONFIGURATION' });
});

test('transport deadline bounds stalled credentials and body reads; errors do not disclose credentials', async t => {
  const f = await fixture(t);
  const waiting = createNativeTransport({ scope: f.scope, timeoutMs: 10,
    credentialsProvider: async () => new Promise(() => {}), transport: () => assert.fail('unresolved credentials must never issue a request') });
  await assert.rejects(waiting(f.scope.headUrl), { code: 'DURABILITY_UNAVAILABLE' });
  let cancelled = false;
  const bodyWait = createNativeTransport({ scope: f.scope, timeoutMs: 10,
    credentialsProvider: async () => ({ Authorization: 'private-value' }),
    transport: async (url, init) => {
      const stream = new ReadableStream({ start(controller) { init.signal.addEventListener('abort', () => { cancelled = true; controller.error(new Error('secret-value')); }); } });
      return new Response(stream, { status: 200 });
    } });
  await assert.rejects(bodyWait(f.scope.headUrl), error => error.code === 'DURABILITY_UNAVAILABLE' && !error.message.includes('secret-value'));
  assert.equal(cancelled, true);
});
