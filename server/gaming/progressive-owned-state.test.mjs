import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { createInteregoStore } from './interego-store.js';

const owner = 'did:web:game.example';
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
function fixture() {
  let row = { version: 0, state: null };
  const operations = new Map(), calls = [], control = { readError: false, failure: false, loseAck: false, gate: null, malformed: false };
  const store = { owner, async load() { if (control.readError) throw new Error('private credential details'); return structuredClone(row); },
    async commit(streamId, input) {
      calls.push(structuredClone({ streamId, ...input }));
      if (control.gate) await control.gate.promise;
      if (control.failure) throw new Error('private transport details');
      const old = operations.get(input.idempotencyKey);
      if (old) { assert.deepEqual(old.input, input); return structuredClone(old.result); }
      if (input.expectedVersion !== row.version) throw Object.assign(new Error('changed'), { code: 'VERSION_CONFLICT' });
      row = { version: row.version + 1, state: structuredClone(input.state) };
      operations.set(input.idempotencyKey, { input: structuredClone(input), result: structuredClone(row) });
      if (control.loseAck) { control.loseAck = false; throw new Error('private lost acknowledgement'); }
      return control.malformed ? { ...structuredClone(row), version: 400 } : structuredClone(row);
    } };
  return { store, calls, control, current: () => structuredClone(row), setRow: value => { row = structuredClone(value); },
    bridge: options => createProgressiveOwnedState({ store, streamId: 'owned-world', checkpointIntervalMs: 60000, retryIntervalMs: 1, ...options }) };
}

test('requires explicit owner-scoped durable ports and bounded settings', () => {
  for (const options of [{}, { store: {} }, { store: { load() {}, commit() {} }, owner, streamId: 'x', maxSnapshotBytes: 0 },
    { store: { owner, load() {}, commit() {} }, owner: 'did:web:other.example', streamId: 'x' }]) {
    assert.throws(() => createProgressiveOwnedState(options), { code: 'INVALID_CONFIGURATION' });
  }
});

test('startup restores native state before consulting a migration seed', async () => {
  const f = fixture(), first = f.bridge();
  await first.start({ seed: () => ({ value: 'canonical' }) });
  const restored = f.bridge();
  const result = await restored.start({ seed: () => assert.fail('native state exists') });
  assert.deepEqual(result, { value: 'canonical' }); result.value = 'mutated';
  assert.equal((await restored.start()).value, 'canonical');
  assert.equal(f.calls.length, 1);
  assert.deepEqual({ ...restored.status(), lastConfirmedAt: null }, { state: 'confirmed', owner, streamId: 'owned-world',
    liveVersion: 1, confirmedLiveVersion: 1, confirmedVersion: 1, pendingSnapshots: 0, writing: false, durable: true, lastConfirmedAt: null, error: null });
});

test('first migration is committed before start resolves; startup captures are refused', async () => {
  const f = fixture(), b = f.bridge(), gate = deferred(); f.control.gate = gate;
  let ready = false; const startup = b.start({ seed: () => ({ worlds: {}, season: null }) }).then(value => { ready = true; return value; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(ready, false); assert.equal(b.status().confirmedVersion, 0);
  assert.throws(() => b.capture({ worlds: {} }), { code: 'NOT_READY' });
  gate.resolve(); await startup;
  assert.equal(b.status().confirmedVersion, 1);
});

test('only exact native absence allows migration; read failures and malformed state fail closed', async () => {
  for (const row of [{ version: 0 }, { version: 0, state: {} }, { version: 1, state: null }, { version: -1, state: null }]) {
    const f = fixture(); f.setRow(row);
    await assert.rejects(f.bridge().start({ seed: () => assert.fail('not absent') }), { code: 'CORRUPT_DURABLE_STATE' });
    assert.equal(f.calls.length, 0);
  }
  const f = fixture(); f.control.readError = true;
  await assert.rejects(f.bridge().start({ seed: () => assert.fail('read failed') }), error => error.code === 'STARTUP_UNCONFIRMED' && !error.message.includes('credential'));
  assert.equal(f.calls.length, 0);
});

test('native startup verifies owner, content digest and envelope schema', async () => {
  for (const mutate of [state => { state.owner = 'did:web:other.example'; }, state => { state.digest = 'wrong'; }, state => { state.schema = 'wrong'; }, state => { state.liveVersion = 0; }]) {
    const f = fixture(); await f.bridge().start({ seed: () => ({ value: 1 }) });
    const row = f.current(); mutate(row.state); f.setRow(row);
    await assert.rejects(f.bridge().start({ seed: () => assert.fail('corrupt native state') }), { code: 'CORRUPT_DURABLE_STATE' });
  }
});

test('hot capture is synchronous, detached, bounded and coalesces a burst into one checkpoint', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  const mutable = { count: 1 }, capture = b.capture(mutable); mutable.count = 999;
  assert.equal(capture?.then, undefined); assert.equal(capture.durable, false);
  for (let count = 2; count <= 1000; count++) b.capture({ count });
  assert.equal(f.calls.length, 1); assert.equal(b.status().pendingSnapshots, 1);
  assert.equal(b.status().liveVersion, 1001); assert.equal(b.status().confirmedLiveVersion, 1);
  assert.deepEqual(b.capture({ count: 1000 }), { changed: false, liveVersion: 1001, durable: false });
  await b.checkpoint();
  assert.equal(f.calls.length, 2); assert.equal(f.current().state.value.count, 1000);
  assert.equal(b.status().confirmedVersion, 2); assert.equal(b.status().confirmedLiveVersion, 1001);
  assert.equal(b.status().durable, true);
});

test('one exact in-flight operation and one latest snapshot bound a concurrent queue', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  const gate = deferred(); f.control.gate = gate;
  b.capture({ count: 1 }); const writing = b.checkpoint();
  assert.equal(b.checkpoint(), writing);
  for (let count = 2; count < 100; count++) b.capture({ count });
  assert.equal(b.status().pendingSnapshots, 2);
  gate.resolve(); await writing; f.control.gate = null;
  assert.equal(b.status().pendingSnapshots, 1); assert.equal(b.status().confirmedLiveVersion, 2);
  await b.checkpoint();
  assert.equal(b.status().durable, true); assert.equal(f.current().state.value.count, 99);
  assert.equal(f.calls.length, 3);
});

test('lost acknowledgement never acknowledges durability and retries exactly the same operation before newer state', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  b.capture({ count: 1 }); f.control.loseAck = true;
  await assert.rejects(b.checkpoint(), { code: 'CHECKPOINT_UNCONFIRMED' });
  assert.equal(b.status().confirmedVersion, 1); assert.equal(b.status().durable, false);
  const uncertain = f.calls.at(-1); b.capture({ count: 2 });
  await b.checkpoint(); assert.deepEqual(f.calls.at(-1), uncertain);
  assert.equal(b.status().confirmedLiveVersion, 2); assert.equal(b.status().pendingSnapshots, 1);
  await b.checkpoint(); assert.equal(f.current().state.value.count, 2);
  assert.equal(b.status().durable, true);
});

test('failed initial seed retries the same operation without rerunning seed creation', async () => {
  const f = fixture(), b = f.bridge(); f.control.loseAck = true;
  await assert.rejects(b.start({ seed: () => ({ count: 0 }) }), { code: 'CHECKPOINT_UNCONFIRMED' });
  const uncertain = f.calls[0];
  await b.start({ seed: () => assert.fail('migration seed already captured') });
  assert.deepEqual(f.calls[1], uncertain); assert.equal(b.status().durable, true);
});

test('two first migrations cannot overwrite each other; the losing seed remains fenced', async () => {
  const f = fixture(), first = f.bridge(), second = f.bridge(), gate = deferred(); f.control.gate = gate;
  const a = first.start({ seed: () => ({ value: 'first' }) }), b = second.start({ seed: () => ({ value: 'second' }) });
  await new Promise(resolve => setImmediate(resolve)); gate.resolve();
  await a; await assert.rejects(b, { code: 'VERSION_CONFLICT' });
  assert.equal(second.status().state, 'conflict'); assert.equal(second.status().confirmedVersion, 0);
  let restored;
  await second.recover({ discardUnconfirmed: true, restore: value => { restored = value; } });
  assert.deepEqual(restored, { value: 'first' }); assert.equal(f.current().state.value.value, 'first');
});

test('incorrect durable acknowledgement remains uncertain and never advances confirmed state', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  b.capture({ count: 1 }); f.control.malformed = true;
  await assert.rejects(b.checkpoint(), { code: 'CHECKPOINT_UNCONFIRMED' });
  assert.equal(b.status().confirmedVersion, 1); assert.equal(b.status().confirmedLiveVersion, 1);
  f.control.malformed = false; await b.checkpoint();
  assert.equal(b.status().confirmedVersion, 2);
});

test('a foreign writer fences capture and native writes; explicit recovery restores winning state before resuming', async () => {
  const f = fixture(), first = f.bridge(), second = f.bridge();
  await first.start({ seed: () => ({ count: 0 }) }); await second.start();
  first.capture({ count: 1 }); second.capture({ count: 20 }); await second.checkpoint();
  await assert.rejects(first.checkpoint(), { code: 'VERSION_CONFLICT' });
  assert.equal(first.status().state, 'conflict');
  assert.throws(() => first.capture({ count: 2 }), { code: 'VERSION_CONFLICT' });
  await assert.rejects(first.checkpoint(), { code: 'VERSION_CONFLICT' });
  const writes = f.calls.length; await assert.rejects(first.recover({}), { code: 'RECOVERY_REQUIRED' });
  let restored = null;
  await first.recover({ discardUnconfirmed: true, restore: value => {
    assert.throws(() => first.capture({ count: 99 }), { code: 'VERSION_CONFLICT' }); restored = value;
  } });
  assert.deepEqual(restored, { count: 20 }); assert.equal(f.calls.length, writes);
  assert.equal(first.status().durable, true); assert.equal(first.status().confirmedVersion, 2);
  first.capture({ count: 21 }); await first.checkpoint(); assert.equal(f.current().state.value.count, 21);
});

test('failed host restoration leaves conflict fenced and pending state recoverable', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) }); b.capture({ count: 1 });
  await assert.rejects(b.recover({ discardUnconfirmed: true, restore: () => { throw new Error('cannot restore'); } }), { code: 'RECOVERY_UNCONFIRMED' });
  assert.equal(b.status().state, 'conflict'); assert.equal(b.status().pendingSnapshots, 1);
  await b.recover({ discardUnconfirmed: true, restore: value => assert.deepEqual(value, { count: 0 }) });
  assert.equal(b.status().pendingSnapshots, 0);
});

test('shutdown freezes capture and drains the in-flight and latest snapshots', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  const gate = deferred(); f.control.gate = gate; b.capture({ count: 1 }); const writing = b.checkpoint(); b.capture({ count: 2 });
  const shutdown = b.shutdown({ timeoutMs: 1000 });
  assert.throws(() => b.capture({ count: 3 }), { code: 'CLOSED' });
  gate.resolve(); await writing; f.control.gate = null;
  assert.equal((await shutdown).state, 'closed'); assert.equal(b.status().durable, true);
  assert.equal(f.current().state.value.count, 2);
});

test('shutdown retries transient failures and expires without claiming an unconfirmed checkpoint', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  b.capture({ count: 1 }); f.control.loseAck = true;
  assert.equal((await b.shutdown({ timeoutMs: 1000 })).durable, true);
  const g = fixture(), delayed = g.bridge(); await delayed.start({ seed: () => ({ count: 0 }) });
  delayed.capture({ count: 1 }); g.control.failure = true;
  await assert.rejects(delayed.shutdown({ timeoutMs: 10 }), { code: 'SHUTDOWN_UNCONFIRMED' });
  assert.equal(delayed.status().state, 'closed-unconfirmed'); assert.equal(delayed.status().durable, false);
  assert.equal(delayed.status().confirmedVersion, 1); assert.equal(g.current().state.value.count, 0);
});

test('shutdown timeout leaves a late genuine receipt distinguishable without launching another write', async () => {
  const f = fixture(), b = f.bridge(); await b.start({ seed: () => ({ count: 0 }) });
  const gate = deferred(); f.control.gate = gate; b.capture({ count: 1 }); const writing = b.checkpoint();
  await assert.rejects(b.shutdown({ timeoutMs: 5 }), { code: 'SHUTDOWN_UNCONFIRMED' });
  assert.equal(b.status().durable, false); gate.resolve(); await writing;
  assert.equal(b.status().state, 'closed'); assert.equal(b.status().durable, true);
  assert.equal(f.calls.length, 2); await assert.rejects(b.checkpoint(), { code: 'CLOSED' });
});

test('snapshots reject cycles, nonfinite numbers, omitted values, oversized data and later mutation', async () => {
  const f = fixture(), b = f.bridge({ maxSnapshotBytes: 1024 }); await b.start({ seed: () => ({ count: 0 }) });
  const cycle = {}; cycle.self = cycle;
  for (const value of [cycle, { n: Infinity }, { n: undefined }, { n: new Date() }, { n: [, 1] }, []]) assert.throws(() => b.capture(value), { code: 'INVALID_STATE' });
  assert.throws(() => b.capture({ value: 'x'.repeat(2048) }), { code: 'SNAPSHOT_TOO_LARGE' });
  assert.equal(b.status().liveVersion, 1);
  const mutable = { count: 1 }; b.capture(mutable); mutable.count = 999; await b.checkpoint();
  assert.equal(f.current().state.value.count, 1);
});

test('automatic checkpoint scheduling operates outside synchronous capture', async () => {
  const f = fixture(), b = f.bridge({ checkpointIntervalMs: 1 }); await b.start({ seed: () => ({ count: 0 }) });
  b.capture({ count: 1 }); assert.equal(f.calls.length, 1);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(b.status().durable, true); assert.equal(f.calls.length, 2);
});

// Storage/auth/HTTP contract model only. With INTEREGO_SDK_TEST_ROOT the actual
// pinned SDK performs encryption, native PGSL closure, digest and receipt checks.
// This does not test production CSS persistence or live server authorization.
test('composes actual InteregoGamingStore and NativeCommitStore with real cryptography across a cold restart', {
  skip: !process.env.INTEREGO_SDK_TEST_ROOT,
}, async () => {
  const root = process.env.INTEREGO_SDK_TEST_ROOT;
  const [native, core] = await Promise.all(['pgsl', 'core'].map(name => import(pathToFileURL(root + '/packages/' + name + '/dist/index.js').href)));
  const senderKeyPair = core.deriveEncryptionKeyPair('a'.repeat(64), owner), rows = new Map(), writes = [];
  const sha = bytes => 'sha256:' + createHash('sha256').update(bytes).digest('hex');
  const scope = { pod: 'https://pod.example/game/', owner, headUrl: 'https://pod.example/game/world/head', artifactContainer: 'https://pod.example/game/world/artifacts/' };
  let sequence = 0, loseAck = false, headConflicts = 0;
  const transport = async (url, init) => {
    if (init.method === 'OPTIONS') return new Response(null, { status: 204, headers: { 'Accept-Put': native.NATIVE_COMMIT_MEDIA_TYPE, 'Interego-Native-Commit': '1' } });
    if (init.method === 'GET') {
      const row = rows.get(url); return row ? new Response(row.bytes, { headers: { 'Content-Type': 'application/json', ETag: '"' + row.revision + '-json"',
        'Interego-Revision': row.revision, 'Interego-Body-Digest': sha(row.bytes) } }) : new Response(null, { status: 404 });
    }
    assert.equal(new Headers(init.headers).get('Content-Type'), native.NATIVE_COMMIT_MEDIA_TYPE);
    const command = JSON.parse(init.body), old = rows.get(url);
    if ((command.expectedRevision === null && old) || (command.expectedRevision !== null && old?.revision !== command.expectedRevision)) {
      if (url === scope.headUrl) headConflicts++;
      return new Response(null, { status: 412 });
    }
    const bytes = Buffer.from(command.bodyBase64, 'base64'), revision = sha(url + ':' + (++sequence) + ':' + sha(bytes));
    rows.set(url, { bytes, revision }); writes.push(bytes.toString('utf8'));
    if (url === scope.headUrl && loseAck) { loseAck = false; throw new Error('lost test acknowledgement'); }
    const nativeUri = core.mintNodeId('atom', sha(bytes).slice(7, 47));
    return new Response(JSON.stringify({ version: 1, status: 'committed', expectedRevision: command.expectedRevision, resource: url, revision,
      bodyDigest: sha(bytes), contentType: 'application/json', pod: 'css', path: url, size: bytes.length, updatedAt: Date.now(), topUri: nativeUri, opaqueUri: nativeUri }),
    { headers: { 'Content-Type': 'application/json', ETag: '"' + revision + '-json"' } });
  };
  const create = () => {
    const store = createInteregoStore({ native, scope, senderKeyPair, ownerPublicKey: senderKeyPair.publicKey,
      recipientPublicKeys: [senderKeyPair.publicKey], namespace: 'test-progressive-world', credentialsProvider: async () => ({ Authorization: 'Bearer explicit-test' }), transport });
    assert.equal(typeof store.nativeClient.readHeadRecords, 'function', 'reviewed SDK must provide selected native proofs');
    store.nativeClient.readHead = () => assert.fail('actual game adapter must not enumerate full native history');
    const commit = store.nativeClient.commit.bind(store.nativeClient);
    store.nativeClient.commit = request => {
      assert.equal(request.resultRecordKeys.length, 2, 'stream and immutable operation receipt paths are requested');
      assert.deepEqual([...request.resultRecordKeys].sort(), request.expected.selectedRecordKeys);
      return commit(request);
    };
    return store;
  };
  const b = createProgressiveOwnedState({ store: create(), streamId: 'world', checkpointIntervalMs: 60000 });
  await b.start({ seed: () => ({ world: 'private-state-marker', season: 1 }) });
  b.capture({ world: 'private-state-marker', season: 2 }); loseAck = true; await b.checkpoint();
  assert.equal(b.status().durable, true, 'actual SDK resolves the lost head acknowledgement by verified native readback');
  assert.ok(writes.length > 1); assert.ok(writes.every(text => !text.includes('private-state-marker')));
  const cold = createProgressiveOwnedState({ store: create(), streamId: 'world' });
  assert.deepEqual(await cold.start({ seed: () => assert.fail('native checkpoint exists') }), { world: 'private-state-marker', season: 2 });
  assert.equal(cold.status().confirmedLiveVersion, 2);
  const shared = create(), before = headConflicts;
  const parallel = await Promise.all([
    shared.commit('player-bindings-fixture', { expectedVersion: 0, state: { bindings: [] }, idempotencyKey: 'same-scope-control-plane' }),
    shared.commit('another-world-fixture', { expectedVersion: 0, state: { season: 3 }, idempotencyKey: 'same-scope-world' }),
  ]);
  assert.deepEqual(parallel.map(value => value.version), [1, 1]);
  assert.equal(headConflicts, before, 'actual native crypto/PGSL commits in one adapter do not race their shared head');
  assert.equal((await shared.load('world')).state.value.season, 2, 'unrelated admitted native commits preserve the original world');
});
