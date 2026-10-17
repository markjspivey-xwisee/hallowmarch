import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { RollingMultiplayerStore, MULTIPLAYER_HISTORY_MS } from './rolling-multiplayer-store.js';

// Application contract fixture: CAS and uncertain acknowledgements are modeled;
// real encryption and native transport are covered by the separate SDK tests.
const OWNER = 'urn:hallowmarch:review-owner';
const WORLD = 'hallowmarch-world-season-v1';
const sha = value => 'sha256:' + createHash('sha256').update(value).digest('hex');
function canonical(x) {
  if (x === null || typeof x !== 'object') return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + x.map(canonical).join(',') + ']';
  return '{' + Object.keys(x).sort().map(key => JSON.stringify(key) + ':' + canonical(x[key])).join(',') + '}';
}
function worldState(label, liveVersion = 1) {
  const value = { worlds: { label }, season: { savedAt: 1000000, label } };
  return { schema: 'urn:bridge:owned-state-checkpoint:v1', owner: OWNER, liveVersion,
    capturedAt: 1000000, digest: sha(canonical(value)), value };
}
function fixture() {
  let now = 1000000, serial = 0, saved = { revision: null, artifact: null };
  const control = { loseAck: false, beforeCommit: null, afterCommit: null, commits: 0 };
  const codec = {
    createNativeByteArtifact({ owner, contentType, bytes }) {
      return { marker: 'review-byte-artifact', owner, contentType, bytes: Uint8Array.from(bytes) };
    },
    readNativeByteArtifact(artifact) {
      assert.equal(artifact.marker, 'review-byte-artifact');
      return { owner: artifact.owner, contentType: artifact.contentType, bytes: Uint8Array.from(artifact.bytes) };
    },
  };
  const client = {
    async ready() {},
    async readHead() { throw new Error('No legacy migration expected in this fixture'); },
    async readArtifact() { throw new Error('No immutable artifact access expected'); },
    async commit() { throw new Error('No immutable commits permitted'); },
    atomicCheckpointSize(artifact) { return control.estimateBytes ?? artifact.bytes.length * 2 + 32768; },
    async readAtomicCheckpoint() { return structuredClone(saved); },
    async commitAtomicCheckpoint(expectedRevision, artifact) {
      if (control.beforeCommit) { const fn = control.beforeCommit; control.beforeCommit = null; await fn(); }
      if (expectedRevision !== saved.revision) {
        const error = new Error('Native head changed'); error.status = 412; throw error;
      }
      saved = { revision: sha('review-revision-' + ++serial), artifact: structuredClone(artifact) };
      control.commits++;
      if (control.afterCommit) { const fn = control.afterCommit; control.afterCommit = null; await fn(); }
      if (control.loseAck) { control.loseAck = false; throw new Error('Lost durable acknowledgement'); }
      return structuredClone(saved);
    },
  };
  const make = (overrides = {}) => new RollingMultiplayerStore({ nativeClient: client, artifactCodec: codec, owner: OWNER,
    namespace: 'hallowmarch-review', resourceUrl: 'https://native.example/game/gaming/head.json', clock: () => now, ...overrides });
  return { make, client, codec, control, advance(ms) { now += ms; }, get now() { return now; }, set now(value) { now = value; } };
}

test('rolling receipts cold-replay exact historical input and reject changed input', async () => {
  const f = fixture(), original = { expectedVersion: 0, state: { score: 1 }, event: { kind: 'score' }, idempotencyKey: 'score-first' };
  const first = await f.make().commit('room-one', original);
  f.advance(1000);
  await f.make().commit('room-one', { expectedVersion: 1, state: { score: 2 }, idempotencyKey: 'score-second' });
  const replay = await f.make().commit('room-one', original);
  assert.equal(replay.replayed, true); assert.equal(replay.version, first.version);
  assert.deepEqual(replay.state, original.state); assert.deepEqual(replay.events, [original.event]);
  assert.equal((await f.make().load('room-one')).state.score, 2, 'historical replay does not restore historical state');
  await assert.rejects(f.make().commit('room-one', { ...original, state: { score: 999 } }), { code: 'IDEMPOTENCY_CONFLICT' });
  assert.equal(f.control.commits, 2);
});

test('expired receipt cannot reapply an old operation and current state survives history expiry', async () => {
  const f = fixture(), input = { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'expired' };
  await f.make().commit('room-one', input);
  f.advance(MULTIPLAYER_HISTORY_MS + 1);
  await assert.rejects(f.make().commit('room-one', input), { code: 'VERSION_CONFLICT' });
  assert.equal((await f.make().load('room-one')).state.score, 1);
  assert.equal(f.control.commits, 1);
});

test('lost acknowledgement is recovered from persisted receipt without a second write', async () => {
  const f = fixture(); f.control.loseAck = true;
  const result = await f.make().commit('room-one', { expectedVersion: 0, state: { score: 3 }, idempotencyKey: 'uncertain' });
  assert.equal(result.version, 1); assert.equal(result.replayed, true); assert.equal(f.control.commits, 1);
  assert.equal((await f.make().load('room-one')).state.score, 3);
});

test('concurrent writers preserve unrelated streams after a stale CAS', async () => {
  const f = fixture(), first = f.make(), second = f.make();
  f.control.beforeCommit = async () => { await second.commit('room-two', { expectedVersion: 0, state: { score: 7 }, idempotencyKey: 'competitor' }); };
  await first.commit('room-one', { expectedVersion: 0, state: { score: 3 }, idempotencyKey: 'first' });
  assert.equal((await first.load('room-one')).state.score, 3);
  assert.equal((await first.load('room-two')).state.score, 7);
  assert.equal(f.control.commits, 2);
});

test('rolling hour keeps at most 61 minute checkpoints and never expires current streams', async () => {
  const f = fixture(), store = f.make();
  await store.commit('grants', { expectedVersion: 0, state: { active: ['grant-one'] }, idempotencyKey: 'initial-grants' });
  let version = 0;
  for (let minute = 0; minute < 125; minute++) {
    await store.commit(WORLD, { expectedVersion: version++, state: worldState('minute-' + minute, version), idempotencyKey: 'world-' + minute });
    await store.commit(WORLD, { expectedVersion: version++, state: worldState('minute-' + minute + '-later', version), idempotencyKey: 'world-' + minute + '-later' });
    if (minute < 124) f.advance(60000);
  }
  const checkpoints = await f.make().rollbackCheckpoints();
  assert.equal(checkpoints.length, 61);
  assert.ok(checkpoints.every(row => row.at >= f.now - MULTIPLAYER_HISTORY_MS));
  assert.ok(checkpoints.every((row, i) => i === 0 || row.at > checkpoints[i - 1].at));
  assert.deepEqual((await f.make().load('grants')).state, { active: ['grant-one'] });
});

test('world rollback restores selected state at a new version while preserving current grants', async () => {
  const f = fixture(), store = f.make(), target = f.now;
  await store.commit(WORLD, { expectedVersion: 0, state: worldState('before'), idempotencyKey: 'world-before' });
  await store.commit('grants', { expectedVersion: 0, state: { revoked: false }, idempotencyKey: 'grant-before' });
  f.advance(60000);
  await store.commit(WORLD, { expectedVersion: 1, state: worldState('after', 2), idempotencyKey: 'world-after' });
  await store.commit('grants', { expectedVersion: 1, state: { revoked: true }, idempotencyKey: 'grant-revoked' });
  const restored = await store.restoreWorldAt(target, { idempotencyKey: 'restore-before' });
  assert.equal(restored.version, 3); const restoredState = (await store.load(WORLD)).state; assert.equal(restoredState.liveVersion, 3);
  assert.equal(restoredState.value.worlds.label, 'before');
  assert.equal(restoredState.value.season.savedAt, f.now);
  assert.equal(restoredState.digest, sha(canonical(restoredState.value)));
  assert.deepEqual((await f.make().load('grants')).state, { revoked: true });
});

test('repeating the same world rollback key replays the confirmed rollback', async () => {
  const f = fixture(), store = f.make(), target = f.now;
  await store.commit(WORLD, { expectedVersion: 0, state: worldState('before'), idempotencyKey: 'world-before' });
  f.advance(60000);
  await store.commit(WORLD, { expectedVersion: 1, state: worldState('after', 2), idempotencyKey: 'world-after' });
  const restored = await store.restoreWorldAt(target, { idempotencyKey: 'retry-rollback' });
  const replay = await f.make().restoreWorldAt(target, { idempotencyKey: 'retry-rollback' });
  assert.equal(replay.replayed, true); assert.equal(replay.version, restored.version);
  assert.equal(f.control.commits, 3);
});

test('clock rollback fails closed without overwriting the confirmed checkpoint', async () => {
  const f = fixture(), store = f.make();
  await store.commit('room-one', { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'first' });
  f.advance(-1);
  await assert.rejects(f.make().load('room-one'), { code: 'CORRUPT_DURABLE_STATE' });
  await assert.rejects(f.make().commit('room-one', { expectedVersion: 1, state: { score: 2 }, idempotencyKey: 'second' }), { code: 'CORRUPT_DURABLE_STATE' });
  assert.equal(f.control.commits, 1);
});

test('a missing idempotency key is rejected as invalid input before any write', async () => {
  const f = fixture();
  await assert.rejects(f.make().commit('room-one', { expectedVersion: 0, state: { score: 1 } }), { code: 'INVALID_INPUT', status: 400 });
  assert.equal(f.control.commits, 0);
});

test('ciphertext from a foreign resource URL cannot become this multiplayer state', async () => {
  const f = fixture();
  await f.make().commit('room-one', { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'first' });
  await assert.rejects(f.make({ resourceUrl: 'https://native.example/other/gaming/head.json' }).load('room-one'), { code: 'CORRUPT_DURABLE_STATE' });
  assert.equal(f.control.commits, 1);
});

test('compressed history overflow preserves the previously confirmed head', async () => {
  const f = fixture(), store = f.make(), firstState = { payload: randomBytes(150 * 1024).toString('base64') };
  await store.commit(WORLD, { expectedVersion: 0, state: firstState, idempotencyKey: 'first' });
  const before = await f.client.readAtomicCheckpoint();
  f.advance(60000);
  await assert.rejects(store.commit(WORLD, { expectedVersion: 1,
    state: { payload: randomBytes(150 * 1024).toString('base64') }, idempotencyKey: 'overflow' }), { code: 'PAYLOAD_TOO_LARGE', status: 413 });
  const after = await f.client.readAtomicCheckpoint();
  assert.equal(after.revision, before.revision); assert.deepEqual(after.artifact, before.artifact);
  assert.deepEqual((await f.make().load(WORLD)).state, firstState); assert.equal(f.control.commits, 1);
});

test('malformed compressed checkpoint fails closed without an empty-state write', async () => {
  const f = fixture();
  await f.make().commit('room-one', { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'first' });
  const stored = await f.client.readAtomicCheckpoint();
  stored.artifact.bytes = Uint8Array.from(Buffer.from('not a gzip stream'));
  await f.client.commitAtomicCheckpoint(stored.revision, stored.artifact);
  const before = f.control.commits;
  await assert.rejects(f.make().load('room-one'), { code: 'CORRUPT_DURABLE_STATE' });
  await assert.rejects(f.make().commit('room-one', { expectedVersion: 0, state: {}, idempotencyKey: 'must-not-reset' }), { code: 'CORRUPT_DURABLE_STATE' });
  assert.equal(f.control.commits, before);
});

test('full receipt capacity refuses new operations without evicting existing proofs', async () => {
  const f = fixture(), store = f.make(), doc = store.empty(f.now);
  doc.receipts = Array.from({ length: 16384 }, (_, i) => ({ operationId: 'gaming-v1-' + i.toString(16).padStart(64, '0'),
    inputDigest: '0'.repeat(64), streamId: 'room-one', version: 1, at: f.now }));
  await f.client.commitAtomicCheckpoint(null, store.artifact(doc));
  const before = await f.client.readAtomicCheckpoint();
  await assert.rejects(store.commit('room-one', { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'full' }), { code: 'NATIVE_COMMIT_CAPACITY', status: 503 });
  assert.equal((await f.client.readAtomicCheckpoint()).revision, before.revision);
  f.advance(MULTIPLAYER_HISTORY_MS + 1);
  assert.equal((await f.make().commit('room-one', { expectedVersion: 0, state: { score: 1 }, idempotencyKey: 'after-expiry' })).version, 1);
});

test('expired world rollback target is refused without changing current state', async () => {
  const f = fixture(), target = f.now;
  await f.make().commit(WORLD, { expectedVersion: 0, state: worldState('current'), idempotencyKey: 'first' });
  f.advance(MULTIPLAYER_HISTORY_MS + 1);
  await assert.rejects(f.make().restoreWorldAt(target, { idempotencyKey: 'expired' }), { code: 'ROLLBACK_EXPIRED', status: 410 });
  assert.equal((await f.make().load(WORLD)).state.value.worlds.label, 'current'); assert.equal(f.control.commits, 1);
});

test('hundreds of permanent grant tombstones survive expiry, cold restart and world rollback without entering history', async () => {
  const f = fixture(), store = f.make();
  const revocation = i => {
    const grantId = 'urn:uuid:' + i.toString(16).padStart(8, '0') + '-0000-4000-8000-000000000000';
    return { streamId: 'hallowmarch-main-world-agent-revocation-v1:' + grantId,
      state: { schema: 'hallowmarch.main-world-agent-revocation/v1', grantId,
        graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9),
        ownerPlayerId: 'player-one', ownerDid: OWNER, revoked: true } };
  };
  const revoke = async i => {
    const { streamId, state } = revocation(i);
    return store.commit(streamId, { expectedVersion: 0, state, event: null, idempotencyKey: 'main-world-agent-revocation-v1' });
  };
  await store.commit(WORLD, { expectedVersion: 0, state: worldState('original'), idempotencyKey: 'original-world' });
  f.advance(60000);
  for (let i = 0; i < 300; i++) { await revoke(i); f.advance(1000); }
  f.advance(MULTIPLAYER_HISTORY_MS + 1);
  await revoke(300);
  const cold = f.make(), before = revocation(0), last = revocation(300), target = f.now;
  assert.deepEqual((await cold.load(before.streamId)).state, before.state);
  assert.deepEqual((await cold.load(last.streamId)).state, last.state);
  await assert.rejects(revoke(0), { code: 'VERSION_CONFLICT' }, 'expired operation receipts do not revive a retired grant');
  await cold.commit(WORLD, { expectedVersion: 1, state: worldState('retained-world', 2), idempotencyKey: 'retained-world' });
  f.advance(60000);
  await cold.commit(WORLD, { expectedVersion: 2, state: worldState('new-world', 3), idempotencyKey: 'new-world' });
  await cold.restoreWorldAt(target, { idempotencyKey: 'restore-world-only' });
  assert.equal((await f.make().load(WORLD)).state.value.worlds.label, 'retained-world');
  assert.deepEqual((await f.make().load(before.streamId)).state, before.state);
  assert.deepEqual((await f.make().load(last.streamId)).state, last.state);
  const saved = await f.client.readAtomicCheckpoint(), doc = JSON.parse(gunzipSync(saved.artifact.bytes));
  assert.equal(doc.streams.length, 302);
  assert.ok(doc.checkpoints.length > 0);
  assert.ok(doc.checkpoints.every(p => p.streams.length === 1 && p.streams[0].streamId === WORLD));
});

test('new current streams at capacity return an explicit capacity error and existing streams can still save', async () => {
  const f = fixture(), store = f.make(), doc = store.empty(f.now);
  doc.streams = Array.from({ length: 16384 }, (_, i) => ({ schema: 'urn:interego:gaming:stream:v1', namespace: store.namespace,
    streamId: 'current-' + i, version: 1, state: {}, event: null, operationId: 'gaming-v1-' + '0'.repeat(64) }));
  await f.client.commitAtomicCheckpoint(null, store.artifact(store.checked(doc)));
  const before = await f.client.readAtomicCheckpoint();
  await assert.rejects(store.commit('one-too-many', { expectedVersion: 0, state: {}, idempotencyKey: 'capacity' }),
    { code: 'NATIVE_COMMIT_CAPACITY', status: 503 });
  assert.equal((await f.client.readAtomicCheckpoint()).revision, before.revision);
  assert.equal((await store.commit('current-0', { expectedVersion: 1, state: { updated: true }, idempotencyKey: 'existing' })).version, 2);
  assert.deepEqual((await f.make().load('current-0')).state, { updated: true });
});

test('encrypted write budget survives restart and lost acknowledgement, replays without charging, and expires conservatively', async () => {
  const f = fixture(), first = { expectedVersion: 0, state: { n: 0 }, idempotencyKey: 'budget-0' };
  f.control.estimateBytes = 1024 * 1024; f.control.loseAck = true;
  await f.make().commit('budget', first);
  for (let i = 1; i < 64; i++) await f.make().commit('budget', { expectedVersion: i, state: { n: i }, idempotencyKey: 'budget-' + i });
  const before = await f.client.readAtomicCheckpoint();
  assert.equal((await f.make().commit('budget', first)).replayed, true);
  assert.equal(f.make().checked(JSON.parse(gunzipSync(before.artifact.bytes))).writeBudget[0].bytes, 64 * 1024 * 1024);
  const next = { expectedVersion: 64, state: { n: 64 }, idempotencyKey: 'budget-next' };
  await assert.rejects(f.make().commit('budget', next), { code: 'NATIVE_WRITE_BUDGET' });
  assert.equal((await f.client.readAtomicCheckpoint()).revision, before.revision);
  f.advance(MULTIPLAYER_HISTORY_MS);
  await assert.rejects(f.make().commit('budget', next), { code: 'NATIVE_WRITE_BUDGET' });
  f.advance(60000);
  assert.equal((await f.make().commit('budget', next)).version, 65);
  assert.equal(f.control.commits, 65);
});

test('concurrent writers share one persisted byte budget and cannot spend the last reservation twice', async () => {
  const f = fixture(); f.control.estimateBytes = 1024 * 1024;
  const first = f.make(), second = f.make();
  for (let i = 0; i < 63; i++) await first.commit('budget', { expectedVersion: i, state: { n: i }, idempotencyKey: 'initial-' + i });
  f.control.beforeCommit = () => second.commit('other', { expectedVersion: 0, state: { accepted: true }, idempotencyKey: 'last-reservation' });
  await assert.rejects(first.commit('budget', { expectedVersion: 63, state: { n: 63 }, idempotencyKey: 'cannot-overspend' }), { code: 'NATIVE_WRITE_BUDGET' });
  assert.equal((await f.make().load('budget')).version, 63);
  assert.equal((await f.make().load('other')).state.accepted, true);
  assert.equal(f.control.commits, 64);
});
