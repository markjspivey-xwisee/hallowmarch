import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, writeFileSync, openSync, fsyncSync, closeSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInteregoStore, createNativeTransport, DurableStoreConflictError } from './interego-store.js';

/*
 * LOCAL CONTRACT FIXTURE ONLY. It implements the native HTTP command, CAS
 * predicates, receipt bindings and disk restart for adapter tests. Its codec
 * deliberately uses plain test bytes, not PGSL/encryption. These tests do not
 * prove the real CSS/PGSL engine's durability or performance. Production must
 * inject the actual @interego/pgsl SDK, never this fixture.
 */
const MEDIA = 'application/vnd.interego.native-commit+json';
const digest = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
const artifactCodec = {
  createNativeByteArtifact(input) { return { owner: input.owner, contentType: input.contentType, bytes: Buffer.from(input.bytes).toString('base64') }; },
  readNativeByteArtifact(artifact) { return { ...artifact, bytes: Buffer.from(artifact.bytes, 'base64') }; },
};

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
  const result = await f.store({ transport }).commit('room', { expectedVersion: 0, state: { loot: 1 }, idempotencyKey: 'unique-loot' });
  assert.equal(result.version, 1); assert.equal(result.replayed, true); assert.equal(f.counts.put, 1);
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
