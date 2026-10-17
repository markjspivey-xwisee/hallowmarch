import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createRollingMultiplayerStore } from './rolling-multiplayer-store.js';
import { createInteregoStore } from './interego-store.js';

// Real PGSL serialization, closure validation, encryption and native SDK CAS.
// HTTP storage is an explicit contract model, not a production CSS proof.
const root = process.env.INTEREGO_SDK_TEST_ROOT;
const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
async function fixture() {
  const [native, core] = await Promise.all(['pgsl', 'core'].map(name => import(pathToFileURL(root + '/packages/' + name + '/dist/index.js').href)));
  const owner = 'urn:rolling:real-sdk', senderKeyPair = core.deriveEncryptionKeyPair('a'.repeat(64), owner);
  const scope = { pod: 'https://pod.example/game/', owner, headUrl: 'https://pod.example/game/gaming/head', artifactContainer: 'https://pod.example/game/gaming/artifacts/' };
  const rows = new Map(), calls = [], control = { loseAck: false, corrupt: false }; let sequence = 0, now = 10000000;
  const transport = async (url, init = {}) => {
    init = { ...init, method: init.method || 'GET' };
    calls.push({ url, method: init.method });
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Accept-Put': native.NATIVE_COMMIT_MEDIA_TYPE, 'Interego-Native-Commit': '1' } });
    if (init.method === 'GET') {
      const row = rows.get(url); return row ? new Response(row.bytes, { headers: { 'Content-Type': 'application/json', ETag: '"' + row.revision + '-json"',
        'Interego-Revision': row.revision, 'Interego-Body-Digest': control.corrupt ? sha('wrong') : sha(row.bytes) } }) : new Response(null, { status: 404 });
    }
    const command = JSON.parse(init.body), old = rows.get(url);
    if ((command.expectedRevision === null && old) || (command.expectedRevision !== null && old?.revision !== command.expectedRevision)) return new Response(null, { status: 412 });
    const bytes = Buffer.from(command.bodyBase64, 'base64'), revision = sha(url + ':' + (++sequence) + ':' + sha(bytes));
    rows.set(url, { bytes, revision });
    if (control.loseAck) { control.loseAck = false; throw new Error('lost acknowledgement'); }
    const nativeUri = core.mintNodeId('atom', sha(bytes).slice(7, 47));
    return new Response(JSON.stringify({ version: 1, status: 'committed', expectedRevision: command.expectedRevision, resource: url, revision,
      bodyDigest: sha(bytes), contentType: 'application/json', pod: 'css', path: url, size: bytes.length, updatedAt: now, topUri: nativeUri, opaqueUri: nativeUri }),
    { headers: { 'Content-Type': 'application/json', ETag: '"' + revision + '-json"' } });
  };
  const options = { native, scope, senderKeyPair, ownerPublicKey: senderKeyPair.publicKey, recipientPublicKeys: [senderKeyPair.publicKey],
    namespace: 'real-sdk-rolling-hour', credentialsProvider: async () => ({ Authorization: 'Bearer explicit-test' }), transport, clock: () => now };
  return { native, options, rows, calls, control, advance(ms) { now += ms; }, create: () => createRollingMultiplayerStore(options) };
}

test('actual native encryption keeps one resource across two hours, cold restart and lost acknowledgement', { skip: !root }, async () => {
  const f = await fixture(), store = f.create(); await store.ready();
  for (let i = 0; i < 125; i++) {
    if (i === 60) f.control.loseAck = true;
    const result = await store.commit('multiplayer', { expectedVersion: i, state: { secret: 'private-shared-world-marker', minute: i }, idempotencyKey: 'minute-' + i });
    assert.equal(result.version, i + 1); f.advance(60000);
  }
  assert.equal(f.rows.size, 1, 'no independently rooted archive resources are created');
  assert.ok(store.performanceStatus().checkpoints <= 61);
  const cold = f.create(); await cold.ready(); assert.equal((await cold.load('multiplayer')).state.minute, 124);
  const bytes = f.rows.get(f.options.scope.headUrl).bytes;
  assert.ok(bytes.length <= 1024 * 1024); assert.ok(!bytes.includes('private-shared-world-marker'));
  f.control.corrupt = true;
  await assert.rejects(cold.load('multiplayer')); assert.equal(f.rows.size, 1);
});

test('actual legacy migration preserves every current stream and fences immutable writers', { skip: !root }, async () => {
  const f = await fixture(), old = createInteregoStore(f.options);
  await old.commit('world', { expectedVersion: 0, state: { season: 7 }, idempotencyKey: 'world-initial' });
  await old.commit('grants', { expectedVersion: 0, state: { revoked: true }, idempotencyKey: 'current-revocation' });
  const count = f.rows.size, rolling = f.create(); await rolling.ready();
  assert.equal(f.rows.size, count, 'cutover uses the existing encrypted head');
  assert.deepEqual((await rolling.load('world')).state, { season: 7 });
  assert.deepEqual((await rolling.load('grants')).state, { revoked: true });
  await assert.rejects(old.load('world'), /head|tuple/i);
  await rolling.commit('world', { expectedVersion: 1, state: { season: 8 }, idempotencyKey: 'world-next' });
  assert.equal(f.rows.size, count);
});

test('actual atomic SDK rejects stale CAS, cross-head ciphertext, missing opt-in and oversize before PUT', { skip: !root }, async () => {
  const f = await fixture(), store = f.create();
  const client = store.nativeClient, artifact = f.native.createNativeByteArtifact({ owner: f.options.scope.owner,
    contentType: 'application/vnd.interego.rolling-checkpoint+gzip', bytes: Buffer.from('checkpoint') });
  const first = await client.commitAtomicCheckpoint(null, artifact);
  await assert.rejects(client.commitAtomicCheckpoint(null, artifact), { status: 412 });
  assert.ok((await client.readAtomicCheckpoint()).artifact);
  const otherScope = { ...f.options.scope, headUrl: f.options.scope.headUrl + '-other' };
  f.rows.set(otherScope.headUrl, f.rows.get(f.options.scope.headUrl));
  const other = new f.native.NativeCommitStore({ ...f.options, scope: otherScope, fetch: f.options.transport, atomicCheckpoint: true });
  await assert.rejects(other.readAtomicCheckpoint(), /scope/);
  const disabled = new f.native.NativeCommitStore({ ...f.options, fetch: f.options.transport });
  const before = f.calls.length;
  await assert.rejects(disabled.readAtomicCheckpoint(), { status: 400 }); assert.equal(f.calls.length, before);
  const writes = f.calls.filter(c => c.method === 'PUT').length;
  const large = f.native.createNativeByteArtifact({ owner: f.options.scope.owner,
    contentType: 'application/vnd.interego.rolling-checkpoint+gzip', bytes: randomBytes(1024 * 1024) });
  await assert.rejects(client.commitAtomicCheckpoint(first.revision, large), { status: 413 });
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, writes);
});

test('actual atomic SDK sizes its encrypted scope wrapper and enforces reserved bytes before network writes', { skip: !root }, async () => {
  const f = await fixture(), client = f.create().nativeClient;
  const artifact = f.native.createNativeByteArtifact({ owner: f.options.scope.owner,
    contentType: 'application/vnd.interego.rolling-checkpoint+gzip', bytes: randomBytes(8192) });
  const size = client.atomicCheckpointSize(artifact), callsBefore = f.calls.length;
  assert.ok(Number.isSafeInteger(size) && size > 8192 && size <= 1024 * 1024);
  for (let i = 0; i < 5; i++) assert.equal(client.atomicCheckpointSize(artifact), size, 'fresh encryption has a stable encoded size');
  assert.equal(f.calls.length, callsBefore, 'estimation performs no network operation');
  await assert.rejects(client.commitAtomicCheckpoint(null, artifact, { maxEncryptedBytes: size - 1 }), { status: 413 });
  assert.equal(f.calls.length, callsBefore, 'undersized reservations fail before OPTIONS or PUT');
  for (const maxEncryptedBytes of [0, -1, 1.5, NaN, Infinity, 1024 * 1024 + 1]) {
    await assert.rejects(client.commitAtomicCheckpoint(null, artifact, { maxEncryptedBytes }), { status: 400 });
  }
  assert.equal(f.calls.length, callsBefore, 'invalid reservations perform no network operation');
  await client.commitAtomicCheckpoint(null, artifact, { maxEncryptedBytes: size });
  assert.equal(f.rows.get(f.options.scope.headUrl).bytes.length, size, 'the committed representation fits the exact reservation');
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, 1);
});

test('actual atomic SDK accepts only exact scoped legacy heads backed by their immutable commit', { skip: !root }, async () => {
  const f = await fixture(), old = createInteregoStore(f.options);
  await old.commit('world', { expectedVersion: 0, state: { season: 7 }, idempotencyKey: 'legacy-head-check' });
  const client = f.create().nativeClient, head = f.rows.get(f.options.scope.headUrl);
  assert.ok((await client.readAtomicCheckpoint()).artifact, 'a verified scoped legacy head remains available for explicit migration');
  const otherScope = { ...f.options.scope, headUrl: f.options.scope.headUrl + '-other' };
  f.rows.set(otherScope.headUrl, head);
  const other = new f.native.NativeCommitStore({ ...f.options, scope: otherScope, fetch: f.options.transport, atomicCheckpoint: true });
  const writes = f.calls.filter(c => c.method === 'PUT').length;
  await assert.rejects(other.readAtomicCheckpoint(), /scope/);
  const artifact = [...f.rows].find(([url]) => url.startsWith(f.options.scope.artifactContainer + 'artifact-'));
  assert.ok(artifact, 'the fixture includes a valid encrypted non-head artifact');
  f.rows.set(f.options.scope.headUrl, artifact[1]);
  await assert.rejects(client.readAtomicCheckpoint(), /head|tuple/i, 'a valid encrypted arbitrary artifact is not a legacy head');
  f.rows.set(f.options.scope.headUrl, head);
  const backing = [...f.rows].find(([url, row]) => url.startsWith(f.options.scope.artifactContainer + 'commit-') && row.bytes.equals(head.bytes));
  assert.ok(backing, 'the legacy head has an immutable backing resource');
  f.rows.delete(backing[0]);
  await assert.rejects(f.create().nativeClient.readAtomicCheckpoint(), /history.*unavailable/i, 'a scoped head without its backing commit is rejected on cold read');
  assert.equal(f.calls.filter(c => c.method === 'PUT').length, writes, 'validation performs no writes');
});

test('actual atomic scope wrapping preserves every submitted node and its original provenance', { skip: !root }, async () => {
  const f = await fixture(), client = f.create().nativeClient;
  const artifact = f.native.createNativeByteArtifact({ owner: f.options.scope.owner,
    contentType: 'application/vnd.interego.rolling-checkpoint+gzip', bytes: Buffer.from('preserve submitted provenance'),
    provenance: { wasAttributedTo: 'urn:original:checkpoint-author', generatedAtTime: '2020-01-02T03:04:05.678Z' } });
  const expected = f.native.validateNativeArtifact({ topUri: artifact.topUri, nodes: artifact.pgsl.nodes });
  const submittedNodes = structuredClone(expected.nodes);
  const result = await client.commitAtomicCheckpoint(null, artifact);
  assert.deepEqual(result.artifact.nodes, submittedNodes, 'the commit result retains all submitted node fields');
  const loaded = await client.readAtomicCheckpoint();
  assert.equal(loaded.artifact.topUri, expected.topUri);
  assert.deepEqual(loaded.artifact.nodes, submittedNodes, 'encrypted readback preserves original provenance, including shared wrapper literals');
  assert.deepEqual(artifact.pgsl.nodes, submittedNodes, 'scope composition leaves the submitted lattice unchanged');
});
