import { createHash } from 'node:crypto';
import { brotliCompressSync, constants as zlibConstants } from 'node:zlib';
import { InteregoGamingStore, createNativeTransport, DurableStoreError, DurableStoreConflictError } from './interego-store.js';
import { encodeRollingHistoryColumns } from './rolling-history-columns.js';
import { validateRollingDocument } from './rolling-document-codec.js';
import { rollingStorageWorker } from './rolling-storage-worker-client.js';

export const MULTIPLAYER_HISTORY_MS = 60 * 60 * 1000;
export const MULTIPLAYER_WRITE_BYTES = 64 * 1024 * 1024;
const LEGACY_TYPE = 'application/vnd.interego.rolling-checkpoint+gzip';
const TYPE = 'application/vnd.interego.rolling-checkpoint-delta-v1+br';
const SCHEMA = 'urn:hallowmarch:multiplayer-rolling-hour:v1';
const WORLD = 'hallowmarch-world-season-v1';
const MAX_JSON = 64 * 1024 * 1024, MAX_COMPRESSED = 384 * 1024, MAX_RECEIPTS = 16384, MAX_STREAMS = 16384;
const BROTLI_WINDOW_BITS = 22, WIRE_DEPTH = 264;
const error = (message, code = 'CORRUPT_DURABLE_STATE', status = 503) => { throw new DurableStoreError(message, code, status); };
const hash = text => createHash('sha256').update(text).digest('hex');
const plain = x => x !== null && typeof x === 'object' && !Array.isArray(x) && [Object.prototype, null].includes(Object.getPrototypeOf(x));
function canonical(x, depth = 0, maximumDepth = 64) {
  if (depth > maximumDepth) error('Multiplayer snapshot nesting exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
  if (x === null || typeof x === 'string' || typeof x === 'boolean') return JSON.stringify(x);
  if (typeof x === 'number' && Number.isFinite(x)) return JSON.stringify(x);
  if (Array.isArray(x)) return '[' + Array.from(x, v => canonical(v, depth + 1, maximumDepth)).join(',') + ']';
  if (plain(x)) return '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k], depth + 1, maximumDepth)).join(',') + '}';
  error('Multiplayer state must be finite JSON.', 'INVALID_INPUT', 400);
}
const copy = x => JSON.parse(canonical(x));
const conflict = e => e?.status === 412 || e?.name === 'NativeCommitConflictError';
/** Current shared state plus one checkpoint per minute for a rolling hour.
 * One encrypted native CAS resource replaces permanent per-operation archives.
 * Personal owner-pod saves and learning archives are not stored here.
 * Expired idempotency receipts are not promises of indefinite replay. */
export function createRollingMultiplayerStore(options) {
  const { native, scope, senderKeyPair, ownerPublicKey, recipientPublicKeys } = options;
  const fetch = createNativeTransport(options);
  const nativeClient = new native.NativeCommitStore({ scope, senderKeyPair, ownerPublicKey, recipientPublicKeys,
    fetch, atomicCheckpoint: true, ...(options.storageDomain ? { storageDomain: options.storageDomain } : {}) });
  return new RollingMultiplayerStore({ ...options, nativeClient, artifactCodec: native, owner: scope.owner,
    resourceUrl: scope.headUrl, waitForNativeWrites: fetch.whenWritesSettled });
}

export class RollingMultiplayerStore extends InteregoGamingStore {
  constructor(options) {
    super(options);
    if (!['readAtomicCheckpoint', 'commitAtomicCheckpoint'].every(k => typeof this.nativeClient[k] === 'function')
      || typeof options.resourceUrl !== 'string' || !options.resourceUrl || typeof (options.clock ?? Date.now) !== 'function') {
      error('Bounded multiplayer native checkpoint support is required.', 'INVALID_CONFIGURATION', 500);
    }
    this.resourceUrl = options.resourceUrl; this.clock = options.clock ?? Date.now; this.lastEnvelope = null;
    this.lastCommitSize = null; this.lastCommitSizeFailure = null;
    this.storageWorker = options.storageWorker ?? rollingStorageWorker;
  }
  now() { const n = this.clock(); if (!Number.isSafeInteger(n) || n < 0) error('Invalid multiplayer clock.'); return n; }
  empty(now) { return { schema: SCHEMA, owner: this.owner, namespace: this.namespace, resourceUrl: this.resourceUrl,
    retentionMs: MULTIPLAYER_HISTORY_MS, writtenAt: now, streams: [], checkpoints: [], receipts: [], writeBudget: [] }; }
  workerContext() { return {owner:this.owner,namespace:this.namespace,resourceUrl:this.resourceUrl,now:this.now(),
    maxStateBytes:this.maxStateBytes,maxEventBytes:this.maxEventBytes}; }
  checked(doc) { validateRollingDocument(doc,this.workerContext());this.lastEnvelope=doc;return doc; }
  async checkedAsync(doc) {
    const checked=await this.storageWorker.run('validate',{doc,context:this.workerContext()});
    this.lastEnvelope=checked;return checked;
  }
  async prepareWriteAsync(doc,measured={phase:'preparing'}) {
    this.lastCommitSize=measured;
    try {
      const context=this.workerContext(),first=await this.storageWorker.run('encode',{doc,context});
      Object.assign(measured,first.measured);
      if(!(first.compressed instanceof Uint8Array)||first.compressed.length>MAX_COMPRESSED)error('Invalid rolling worker result.');
      const artifact=this.artifactCodec.createNativeByteArtifact({owner:this.owner,contentType:TYPE,bytes:first.compressed});
      measured.phase='native-sizing';
      const estimate=this.nativeClient.atomicCheckpointSize?.(artifact)??1024*1024;
      measured.encryptedEstimateBytes=estimate;
      if(!Number.isSafeInteger(estimate)||estimate<1||estimate>1024*1024)error('Invalid native checkpoint byte estimate.');
      const charge=Math.min(1024*1024,Math.ceil((estimate+4096)/4096)*4096);
      const used=doc.writeBudget.reduce((sum,bucket)=>sum+bucket.bytes,0);
      Object.assign(measured,{phase:'write-budget',reservedBytes:charge,usedBudgetBytes:used});
      if(used+charge>MULTIPLAYER_WRITE_BYTES)error('Multiplayer save budget is full; pending saves will retry after capacity returns.','NATIVE_WRITE_BUDGET',503);
      const minute=Math.floor(doc.writtenAt/60000),last=doc.writeBudget.at(-1);
      const writeBudget=[...doc.writeBudget.filter(bucket=>bucket.minute!==minute),
        {minute,bytes:(last?.minute===minute?last.bytes:0)+charge}];
      const final=await this.storageWorker.run('finish',{wire:first.wire,writeBudget,context,measured:first.measured});
      Object.assign(measured,final.measured);
      if(!(final.compressed instanceof Uint8Array)||final.compressed.length>MAX_COMPRESSED)error('Invalid rolling worker result.');
      doc.writeBudget=writeBudget;this.lastEnvelope=doc;
      const finalArtifact=this.artifactCodec.createNativeByteArtifact({owner:this.owner,contentType:TYPE,bytes:final.compressed});
      measured.phase='prepared';return {artifact:finalArtifact,maxEncryptedBytes:charge};
    }catch(e){if(e?.measured)Object.assign(measured,e.measured);throw e}
  }
  artifact(doc, measured, preparedHistory) {
    if (measured) Object.assign(measured, { phase: 'document-json', streams: doc.streams.length,
      checkpoints: doc.checkpoints.length, receipts: doc.receipts.length, writeBudgetBuckets: doc.writeBudget.length,
      bindings: doc.streams.find(row => row.streamId === 'player-bindings-v1')?.state?.bindings?.length ?? 0 });
    const bytes = Buffer.from(canonical(doc));
    if (measured) { measured.rawBytes = bytes.length; measured.phase = 'document-raw-limit'; }
    if (bytes.length > MAX_JSON) error('Rollback window exceeds its uncompressed budget.', 'PAYLOAD_TOO_LARGE', 413);
    // The logical document keeps its original schema and byte/depth bounds.
    // Storage-only delta tags require more nesting than the reconstructed JSON.
    const encoded = preparedHistory?.wire ?? encodeRollingHistoryColumns(doc);
    if (preparedHistory) preparedHistory.wire = encoded;
    const wire = Buffer.from(canonical(encoded, 0, WIRE_DEPTH));
    if (measured) { measured.wireBytes = wire.length; measured.phase = 'document-wire-limit'; }
    if (wire.length > MAX_JSON) error('Encoded rollback window exceeds its uncompressed budget.', 'PAYLOAD_TOO_LARGE', 413);
    const compressed = brotliCompressSync(wire, { params: {
      [zlibConstants.BROTLI_PARAM_QUALITY]: 6, [zlibConstants.BROTLI_PARAM_LGWIN]: BROTLI_WINDOW_BITS,
    } });
    if (measured) { measured.compressedBytes = compressed.length; measured.phase = 'document-compressed-limit'; }
    if (compressed.length > MAX_COMPRESSED) error('Rollback window exceeds its compressed storage budget.', 'PAYLOAD_TOO_LARGE', 413);
    if (measured) measured.phase = 'native-byte-artifact';
    return this.artifactCodec.createNativeByteArtifact({ owner: this.owner, contentType: TYPE, bytes: compressed });
  }
  prepareWrite(doc, measured = { phase: 'preparing' }) {
    this.lastCommitSize = measured;
    // Budget reservation changes current metadata only. Reuse this operation's
    // exact history encoding while sizing the final reserved representation.
    const preparedHistory = {};
    const artifact = this.artifact(doc, measured, preparedHistory);
    // Reserve a little above the real encrypted size before encoding the
    // reservation itself. The SDK enforces this exact ceiling before PUT.
    measured.phase = 'native-sizing';
    const estimate = this.nativeClient.atomicCheckpointSize?.(artifact) ?? 1024 * 1024;
    measured.encryptedEstimateBytes = estimate;
    if (!Number.isSafeInteger(estimate) || estimate < 1 || estimate > 1024 * 1024) error('Invalid native checkpoint byte estimate.');
    const charge = Math.min(1024 * 1024, Math.ceil((estimate + 4096) / 4096) * 4096);
    const used = doc.writeBudget.reduce((sum, bucket) => sum + bucket.bytes, 0);
    Object.assign(measured, { phase: 'write-budget', reservedBytes: charge, usedBudgetBytes: used });
    if (used + charge > MULTIPLAYER_WRITE_BYTES) error('Multiplayer save budget is full; pending saves will retry after capacity returns.', 'NATIVE_WRITE_BUDGET', 503);
    const minute = Math.floor(doc.writtenAt / 60000), last = doc.writeBudget.at(-1);
    doc.writeBudget = [...doc.writeBudget.filter(bucket => bucket.minute !== minute), { minute, bytes: (last?.minute === minute ? last.bytes : 0) + charge }];
    this.checked(doc);
    preparedHistory.wire.current.writeBudget = doc.writeBudget;
    const finalArtifact = this.artifact(doc, measured, preparedHistory);
    measured.phase = 'prepared';
    return { artifact: finalArtifact, maxEncryptedBytes: charge };
  }
  async read(migrationRetries = 3) {
    const stored = await this.nativeClient.readAtomicCheckpoint();
    if (!stored.artifact) return { revision: null, doc: this.empty(this.now()) };
    let decoded;
    try { decoded = this.artifactCodec.readNativeByteArtifact(stored.artifact); }
    catch {
      // Only a fully verified legacy head permits migration. Corruption or a
      // read failure never becomes an empty state. One CAS fences old clients.
      try {
        const legacy = this.checkedSnapshot(await this.nativeClient.readHead());
        if (legacy.revision !== stored.revision) throw new DurableStoreConflictError(0, 0);
        const doc = this.empty(this.now());
        for (const key of legacy.records.keys()) {
          if (key.includes(':operation:')) continue;
          const r = await this.record(legacy, key);
          if (r) doc.streams.push(this.streamRecord(r, r.streamId));
        }
        const world = doc.streams.find(r => r.streamId === WORLD);
        doc.checkpoints = world ? [{ at: doc.writtenAt, streams: [copy(world)] }] : [];
        const prepared = await this.prepareWriteAsync(doc);
        const result = await this.nativeClient.commitAtomicCheckpoint(stored.revision, prepared.artifact, { maxEncryptedBytes: prepared.maxEncryptedBytes });
        return { revision: result.revision, doc };
      } catch (error) {
        await this.waitForNativeWrites();
        const actual = await this.nativeClient.readAtomicCheckpoint();
        if (migrationRetries > 0 && actual.revision !== stored.revision) return this.read(migrationRetries - 1);
        throw error;
      }
    }
    if (decoded.owner !== this.owner || ![TYPE, LEGACY_TYPE].includes(decoded.contentType)) error('Multiplayer artifact ownership or type changed.');
    if (decoded.bytes.length > MAX_COMPRESSED) error('Multiplayer artifact exceeds its compressed storage budget.', 'PAYLOAD_TOO_LARGE', 413);
    const doc=await this.storageWorker.run('decode',{bytes:Uint8Array.from(decoded.bytes),contentType:decoded.contentType,context:this.workerContext()});
    this.lastEnvelope=doc;
    return {revision:stored.revision,doc};
  }

  async ready() { await this.nativeClient.ready(); await this.admitCommit(() => this.read()); }
  async load(streamId) {
    this.keys(streamId);
    const { doc, revision } = await this.read();
    return this.view(doc.streams.find(r => r.streamId === streamId) ?? null, revision);
  }
  retained(doc, now) {
    if (now < doc.writtenAt) error('Clock moved behind the confirmed multiplayer checkpoint.');
    return { ...doc, writtenAt: now, receipts: doc.receipts.filter(r => r.at >= now - MULTIPLAYER_HISTORY_MS),
      checkpoints: doc.checkpoints.filter(p => p.at >= now - MULTIPLAYER_HISTORY_MS),
      writeBudget: doc.writeBudget.filter(bucket => bucket.minute >= Math.floor((now - MULTIPLAYER_HISTORY_MS) / 60000)) };
  }
  async commit(streamId, { expectedVersion, state, event = null, idempotencyKey, signal } = {}) {
    if (idempotencyKey === undefined) error('Multiplayer commits require an idempotency key.', 'INVALID_INPUT', 400);
    const keys = this.keys(streamId, idempotencyKey);
    if (!Number.isSafeInteger(expectedVersion) || expectedVersion < 0 || !plain(state)) error('Invalid multiplayer commit.', 'INVALID_INPUT', 400);
    const clean = copy(state), cleanEvent = copy(event);
    const measured = { phase: 'stream-limits', stateBytes: Buffer.byteLength(canonical(clean)),
      eventBytes: Buffer.byteLength(canonical(cleanEvent)) };
    this.lastCommitSize = measured;
    if (measured.stateBytes > this.maxStateBytes || measured.eventBytes > this.maxEventBytes) {
      this.lastCommitSizeFailure = { ...measured };
      error('Multiplayer commit exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
    }
    const inputDigest = hash(canonical({ expectedVersion, state: clean, event: cleanEvent }));
    const next = { schema: 'urn:interego:gaming:stream:v1', namespace: this.namespace, streamId,
      version: expectedVersion + 1, state: clean, event: cleanEvent, operationId: keys.operationId };
    const replay = (doc, revision) => {
      const receipt = doc.receipts.find(r => r.operationId === keys.operationId && r.at >= this.now() - MULTIPLAYER_HISTORY_MS);
      if (!receipt) return null;
      if (receipt.inputDigest !== inputDigest || receipt.streamId !== streamId || receipt.version !== next.version) error('Idempotency key was used for another multiplayer operation.', 'IDEMPOTENCY_CONFLICT', 409);
      return this.view(next, revision, true);
    };
    return this.admitCommit(async () => {
      this.lastCommitSize = measured;
      for (let attempt = 0; attempt <= this.conflictRetries; attempt++) {
        const current = await this.read(), recovered = replay(current.doc, current.revision);
        if (recovered) return recovered;
        const prior = current.doc.streams.find(r => r.streamId === streamId);
        if ((prior?.version ?? 0) !== expectedVersion) throw new DurableStoreConflictError(expectedVersion, prior?.version ?? 0);
        // Current permission tombstones never expire with rollback history.
        // Refuse a new stream explicitly before constructing an invalid head.
        if (!prior && current.doc.streams.length >= MAX_STREAMS) error('Multiplayer current stream capacity is full.', 'NATIVE_COMMIT_CAPACITY', 503);
        const now = this.now(), doc = this.retained(current.doc, now);
        if (doc.receipts.length >= MAX_RECEIPTS) error('Multiplayer operation window is full.', 'NATIVE_COMMIT_CAPACITY', 503);
        doc.streams = [...doc.streams.filter(r => r.streamId !== streamId), next].sort((a, b) => a.streamId.localeCompare(b.streamId));
        doc.receipts = [...doc.receipts, { operationId: keys.operationId, inputDigest, streamId, version: next.version, at: now,
          ...(streamId === WORLD && cleanEvent?.kind === 'world.rollback' ? { rollbackTargetAt: cleanEvent.targetAt } : {}) }];
        // Rollback restores only the shared world. Permission records and
        // revocation tombstones remain current rather than being copied into
        // every historical checkpoint, where they could exhaust its budget.
        const world = doc.streams.find(r => r.streamId === WORLD);
        doc.checkpoints = doc.checkpoints.filter(p => Math.floor(p.at / 60000) !== Math.floor(now / 60000));
        if (world) doc.checkpoints.push({ at: now, streams: [copy(world)] });
        try {
          const prepared = await this.prepareWriteAsync(doc, measured);
          measured.phase = 'native-commit';
          await this.nativeClient.commitAtomicCheckpoint(current.revision, prepared.artifact, { maxEncryptedBytes: prepared.maxEncryptedBytes });
          measured.phase = 'native-readback';
          const confirmed = await this.read(), result = replay(confirmed.doc, confirmed.revision);
          if (!result) error('Multiplayer commit lacks verified receipt readback.', 'COMMIT_UNCERTAIN', 503);
          measured.phase = 'confirmed';
          return { ...result, replayed: false };
        } catch (e) {
          this.lastCommitSizeFailure = { ...measured };
          // Settle the dispatched native request before reading/retrying. No
          // timeout permits a second overlapping writer to the same head.
          await this.waitForNativeWrites();
          const actual = await this.read(), result = replay(actual.doc, actual.revision);
          if (result) return result;
          if (!conflict(e)) throw e;
          if (attempt === this.conflictRetries) throw new DurableStoreConflictError(expectedVersion, actual.doc.streams.find(r => r.streamId === streamId)?.version ?? 0);
        }
      }
    }, signal);
  }
  async rollbackCheckpoints() {
    const { doc } = await this.read(), now = this.now();
    return doc.checkpoints.filter(p => p.at >= now - MULTIPLAYER_HISTORY_MS).map(p => ({ at: p.at,
      version: p.streams.find(r => r.streamId === WORLD)?.version ?? 0 })).filter(p => p.version > 0);
  }
  async restoreWorldAt(at, { idempotencyKey, beforeRestore } = {}) {
    const now = this.now();
    if (!Number.isSafeInteger(at) || at < 0) error('Rollback requires a valid checkpoint time.', 'INVALID_INPUT', 400);
    if (idempotencyKey === undefined) error('Rollback requires an idempotency key.', 'INVALID_INPUT', 400);
    if (beforeRestore !== undefined && typeof beforeRestore !== 'function') error('Invalid rollback drain callback.', 'INVALID_INPUT', 400);
    const operationId = this.keys(WORLD, idempotencyKey).operationId;
    const outcome = (version, nativeRevision, replayed) => ({ version, nativeRevision, replayed, targetAt: at });
    const replay = ({ doc, revision }) => {
      const receipt = doc.receipts.find(r => r.operationId === operationId && r.at >= now - MULTIPLAYER_HISTORY_MS);
      if (!receipt) return null;
      if (receipt.rollbackTargetAt !== at || receipt.streamId !== WORLD) error('Rollback key was used for another operation.', 'IDEMPOTENCY_CONFLICT', 409);
      return outcome(receipt.version, revision, true);
    };
    const loaded = await this.read(), known = replay(loaded);
    if (known) { await beforeRestore?.(); return known; }
    if (!Number.isSafeInteger(at) || at < now - MULTIPLAYER_HISTORY_MS || at > now) error('Rollback target is outside the rolling hour.', 'ROLLBACK_EXPIRED', 410);
    const { doc } = loaded;
    const checkpoint = doc.checkpoints.find(p => p.at === at && p.at >= now - MULTIPLAYER_HISTORY_MS);
    const prior = checkpoint?.streams.find(r => r.streamId === WORLD);
    if (!prior) error('That exact multiplayer checkpoint is no longer retained.', 'ROLLBACK_EXPIRED', 410);
    // Pin the verified selected snapshot before the host drains newer local
    // work, which may replace this minute's advertised checkpoint in the head.
    const state = copy(prior.state);
    await beforeRestore?.();
    const fresh = await this.read(), confirmed = replay(fresh);
    if (confirmed) return confirmed;
    const current = fresh.doc.streams.find(r => r.streamId === WORLD);
    if (!current) error('Current multiplayer world is unavailable.');
    if (state.owner !== this.owner || state.schema !== 'urn:bridge:owned-state-checkpoint:v1' || !plain(state.value)
      || state.digest !== 'sha256:' + hash(canonical(state.value)) || !Number.isSafeInteger(current.state.liveVersion)
      || current.state.liveVersion < 1 || current.state.liveVersion >= Number.MAX_SAFE_INTEGER) error('Invalid retained world ownership.');
    state.liveVersion = current.state.liveVersion + 1; state.capturedAt = now;
    if (state.value.season) state.value.season.savedAt = now;
    state.digest = 'sha256:' + hash(canonical(state.value));
    try {
      const result = await this.commit(WORLD, { expectedVersion: current.version, state,
        event: { kind: 'world.rollback', targetAt: at, sourceVersion: prior.version }, idempotencyKey });
      return outcome(result.version, result.nativeRevision, result.replayed);
    } catch (e) { const recovered = replay(await this.read()); if (recovered) return recovered; throw e; }
  }
  performanceStatus() { return { ...super.performanceStatus(), snapshotMode: 'bounded-rolling-hour', retentionMs: MULTIPLAYER_HISTORY_MS,
    checkpointResolutionMs: 60000, maxEncryptedBytes: 1024 * 1024, writeBudgetBytes: MULTIPLAYER_WRITE_BYTES,
    storageCodec: 'lossless-history-columns-v1+brotli', maxLogicalBytes: MAX_JSON, maxCompressedBytes: MAX_COMPRESSED,
    brotliWindowBits: BROTLI_WINDOW_BITS,
    lastCommitSize: this.lastCommitSize ? { ...this.lastCommitSize } : null,
    lastCommitSizeFailure: this.lastCommitSizeFailure ? { ...this.lastCommitSizeFailure } : null,
    reservedWriteBytes: (this.lastEnvelope?.writeBudget ?? []).filter(bucket => bucket.minute >= Math.floor((this.now() - MULTIPLAYER_HISTORY_MS) / 60000))
      .reduce((sum, bucket) => sum + bucket.bytes, 0), checkpoints: this.lastEnvelope?.checkpoints.length ?? 0 }; }
}
