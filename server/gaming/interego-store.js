/**
 * Gaming stream adapter over @interego/pgsl's encrypted NativeCommitStore.
 *
 * Supply the real SDK and stable owner-held keys at composition time. Native
 * commits stage encrypted holons, atomically CAS the head, validate receipts,
 * and retain operation history. This adapter has no SQL or volatile fallback.
 * load().events contains only the most recent event, not an unbounded replay.
 * The reviewed SDK verifies selected record paths under one native head. Older
 * injected adapters retain an explicit complete-index compatibility path.
 */
import { createHash } from 'node:crypto';

const SCHEMA = 'urn:interego:gaming:stream:v1';
const LEGACY_RECEIPT_SCHEMA = 'urn:interego:gaming:operation:v1';
const RECEIPT_SCHEMA = 'urn:interego:gaming:operation:v2';
const CONTENT_TYPE = 'application/vnd.interego.gaming-state+json';
const REVISION = /^sha256:[a-f0-9]{64}$/;
const MAX_NATIVE_BYTES = 8 * 1024 * 1024;
const MAX_NATIVE_COMMAND_BYTES = Math.ceil(8 * 1024 * 1024 / 3) * 4 + 8192;

export class DurableStoreError extends Error {
  constructor(message, code = 'DURABILITY_UNAVAILABLE', status = 503) {
    super(message); this.name = 'DurableStoreError'; this.code = code; this.status = status;
  }
}

export class DurableStoreConflictError extends DurableStoreError {
  constructor(expectedVersion, actualVersion) {
    super('Gaming stream changed; reload before submitting a new operation.', 'VERSION_CONFLICT', 409);
    this.name = 'DurableStoreConflictError';
    this.expectedVersion = expectedVersion; this.actualVersion = actualVersion;
  }
}

function fail(message, code, status) { throw new DurableStoreError(message, code, status); }
function plain(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    && [Object.prototype, null].includes(Object.getPrototypeOf(value));
}
function identifier(value, label, limit = 1024) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > limit || /[\u0000-\u001f\u007f]/.test(value)) {
    fail('Invalid ' + label + '.', 'INVALID_INPUT', 400);
  }
  return value;
}
function integer(value) { return Number.isSafeInteger(value) && value >= 0; }
function canonical(value, depth = 0, active = new Set()) {
  if (depth > 64) fail('Gaming data nesting exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!Array.isArray(value) && !plain(value)) fail('Gaming data must contain finite JSON values.', 'INVALID_INPUT', 400);
  if (active.has(value)) fail('Gaming data contains a cycle.', 'INVALID_INPUT', 400);
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) fail('Gaming arrays must not contain holes.', 'INVALID_INPUT', 400);
        parts.push(canonical(value[i], depth + 1, active));
      }
      return '[' + parts.join(',') + ']';
    }
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1, active)).join(',') + '}';
  } finally { active.delete(value); }
}
function hash(value) { return createHash('sha256').update(value).digest('hex'); }
function boundedBytes(value, maximum, label) {
  const bytes = Buffer.from(canonical(value));
  if (bytes.length > maximum) fail(label + ' exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
  return bytes;
}
function checkedUrl(value) {
  let url;
  try { url = new URL(value); } catch { fail('Invalid native service URL.', 'INVALID_CONFIGURATION', 500); }
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)))
    || url.username || url.password || url.search || url.hash || /%2f|%5c|%2e/i.test(url.pathname)) {
    fail('Native service requires a scoped HTTPS URL.', 'INVALID_CONFIGURATION', 500);
  }
  return url;
}

/** Credentials are resolved per request; redirects can never forward them.
 * Only native immutable ciphertext is cached, under its exact SHA-256 URL.
 * Mutable heads, capability discovery, writes and first write readback stay live.
 * This bounded disposable cache is never an acknowledged primary state store.
 */
export function createNativeTransport({ scope, credentialsProvider, transport = globalThis.fetch, timeoutMs = 10000,
  cacheMaxEntries = 512, cacheMaxBytes = 8 * 1024 * 1024 }) {
  if (typeof credentialsProvider !== 'function' || typeof transport !== 'function'
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 60000
    || !Number.isSafeInteger(cacheMaxEntries) || cacheMaxEntries < 0 || cacheMaxEntries > 4096
    || !Number.isSafeInteger(cacheMaxBytes) || cacheMaxBytes < 0 || cacheMaxBytes > 64 * 1024 * 1024) {
    fail('Native credentials, transport, and bounded timeout are required.', 'INVALID_CONFIGURATION', 500);
  }
  const pod = checkedUrl(scope?.pod), head = checkedUrl(scope?.headUrl), artifacts = checkedUrl(scope?.artifactContainer);
  if (!pod.pathname.endsWith('/') || !artifacts.pathname.endsWith('/')
    || [head, artifacts].some(url => url.origin !== pod.origin || !url.pathname.startsWith(pod.pathname))) {
    fail('Native resources must share an authorized pod scope.', 'INVALID_CONFIGURATION', 500);
  }
  const cache = new Map(), actualWrites = new Set();
  let cachedBytes = 0, writeEpoch = 0, writeSettlementUnknown = false;
  const removeCached = key => { const entry = cache.get(key); if (entry) { cache.delete(key); cachedBytes -= entry.size; } };
  const detached = entry => new Response(Buffer.from(entry.bytes), { status: 200, statusText: entry.statusText, headers: entry.headers });
  const immutableDigest = url => {
    if (!cacheMaxEntries || !cacheMaxBytes || url.href === head.href || !url.href.startsWith(artifacts.href)) return null;
    const match = url.href.slice(artifacts.href.length).match(/^(?:artifact|commit)-([a-f0-9]{64})\.json$/);
    return match ? 'sha256:' + match[1] : null;
  };
  const fetch = async (target, init = {}) => {
    const url = checkedUrl(String(target));
    if (url.href !== String(target) || url.origin !== pod.origin || !url.pathname.startsWith(pod.pathname)) {
      fail('Native request escaped its authorized pod.', 'INVALID_CONFIGURATION', 500);
    }
    const method = (init.method || 'GET').toUpperCase();
    if (!['GET', 'OPTIONS', 'PUT'].includes(method)) fail('Unsupported native request method.', 'INVALID_INPUT', 400);
    if (init.body !== undefined && (typeof init.body !== 'string' || Buffer.byteLength(init.body) > MAX_NATIVE_COMMAND_BYTES)) {
      fail('Native command exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413);
    }
    // A concurrent read started before/during a write must not repopulate the
    // cache behind that write and hide the SDK's first verification GET.
    if (method === 'PUT') { writeEpoch++; removeCached(url.href); }
    const controller = new AbortController();
    let timer, actual, expired = false, dispatched = false;
    try {
      const operation = async () => {
        const credentials = await credentialsProvider({ url: url.href, method });
        if (expired) fail('Native service transport timed out.', 'DURABILITY_UNAVAILABLE', 503);
        if (init.signal?.aborted) fail('Native service transport was cancelled.', 'DURABILITY_UNAVAILABLE', 503);
        const auth = new Headers(credentials), headers = new Headers(init.headers);
        let credentialCount = 0;
        for (const [key, value] of auth) {
          if (/^(accept|content-|if-|host$|connection$|transfer-encoding$|proxy-)/i.test(key)) {
            fail('Credentials cannot replace native protocol headers.', 'INVALID_CONFIGURATION', 500);
          }
          if (value) { headers.set(key, value); credentialCount++; }
        }
        if (!credentialCount) fail('Native service credentials are unavailable.', 'DURABILITY_UNAVAILABLE', 503);
        const expectedDigest = method === 'GET' && init.body === undefined
          && !['range', 'if-match', 'if-none-match', 'if-modified-since', 'if-unmodified-since'].some(name => headers.has(name))
          ? immutableDigest(url) : null;
        if (expectedDigest && cache.has(url.href)) {
          const cached = cache.get(url.href); cache.delete(url.href); cache.set(url.href, cached);
          return detached(cached);
        }
        const startedEpoch = writeEpoch;
        // A caller deadline cannot cancel an already-launched CAS: aborting
        // fetch only stops our response, and does not prove remote quiescence.
        // Reads remain abortable; PUTs retain their real response task.
        dispatched = true;
        if (method === 'PUT') actualWrites.add(actual);
        const response = await transport(url.href, { ...init, method, headers, redirect: 'manual',
          signal: method === 'PUT' ? undefined
            : init.signal ? AbortSignal.any([init.signal, controller.signal]) : controller.signal });
        // Keep the deadline through the response body, not just the headers.
        // NativeCommitStore also checks its tighter per-artifact/receipt limits.
        const reader = response.body?.getReader(), chunks = [];
        let size = 0;
        if (reader) {
          try {
            for (;;) {
              const part = await reader.read(); if (part.done) break;
              size += part.value.length;
              if (size > MAX_NATIVE_BYTES) { await reader.cancel(); fail('Native response exceeds capacity.', 'PAYLOAD_TOO_LARGE', 413); }
              chunks.push(part.value);
            }
          } finally { reader.releaseLock(); }
        }
        const bytes = Buffer.concat(chunks);
        // Match the pinned SDK's exact immutable URL and native read metadata.
        // Its own decrypt/PGSL closure checks still run on every returned body.
        const revision = response.headers.get('Interego-Revision');
        const etagRevision = response.headers.get('ETag')?.match(/^"(sha256:[a-f0-9]{64})(?:-[^"\r\n]{1,200})?"$/)?.[1];
        if (expectedDigest && response.status === 200 && startedEpoch === writeEpoch
          && response.headers.get('Content-Type')?.split(';')[0]?.trim() === 'application/json'
          && revision && REVISION.test(revision) && etagRevision === revision
          && response.headers.get('Interego-Body-Digest') === expectedDigest
          && 'sha256:' + hash(bytes) === expectedDigest) {
          const entry = { bytes: Buffer.from(bytes), headers: [...response.headers], statusText: response.statusText };
          entry.size = bytes.length + Buffer.byteLength(JSON.stringify(entry.headers) + url.href + entry.statusText);
          if (entry.size <= cacheMaxBytes) {
            removeCached(url.href); cache.set(url.href, entry); cachedBytes += entry.size;
            while (cache.size > cacheMaxEntries || cachedBytes > cacheMaxBytes) removeCached(cache.keys().next().value);
          }
        }
        return new Response([204, 205, 304].includes(response.status) ? null : bytes,
          { status: response.status, statusText: response.statusText, headers: response.headers });
      };
      const timeout = new Promise((resolve, reject) => {
        timer = setTimeout(() => { expired = true; if (method !== 'PUT') controller.abort();
          reject(new DurableStoreError('Native service transport timed out.')); }, timeoutMs);
      });
      actual = operation();
      if (method === 'PUT') {
        actual.then(() => actualWrites.delete(actual), () => {
          // A connection/body failure after dispatch leaves the remote outcome
          // unknowable. Do not let later work race a possibly surviving CAS.
          if (dispatched) writeSettlementUnknown = true;
          actualWrites.delete(actual);
        });
      }
      return await Promise.race([actual, timeout]);
    } catch (error) {
      if (error instanceof DurableStoreError) throw error;
      // Never expose credential-provider/transport exception text in game logs.
      fail('Native service transport is unavailable.', 'DURABILITY_UNAVAILABLE', 503);
    } finally {
      clearTimeout(timer);
      if (method === 'PUT') { writeEpoch++; removeCached(url.href); }
    }
  };
  // A deadline does not prove that a launched PUT has stopped. The
  // store's commit permit stays occupied until the actual task settles, even
  // when its caller has already received an uncertain-operation response.
  Object.defineProperty(fetch, 'whenWritesSettled', { value: async ({ operationConfirmed = false } = {}) => {
    while (actualWrites.size) await Promise.allSettled([...actualWrites]);
    // Only the adapter's verified immutable receipt can resolve a lost response.
    // Absence at one read cannot exclude a still-surviving remote CAS.
    if (writeSettlementUnknown && !operationConfirmed) fail('Native write settlement requires recovery.', 'NATIVE_COMMIT_FENCED', 503);
    if (operationConfirmed) writeSettlementUnknown = false;
  } });
  return fetch;
}

/** Production composition point: native must be the deployed @interego/pgsl SDK. */
export function createInteregoStore(options) {
  const { native, scope, senderKeyPair, ownerPublicKey, recipientPublicKeys } = options || {};
  if (typeof native?.NativeCommitStore !== 'function' || typeof native?.createNativeByteArtifact !== 'function'
    || typeof native?.readNativeByteArtifact !== 'function' || !senderKeyPair || !ownerPublicKey || !recipientPublicKeys?.length) {
    fail('Real native SDK and stable owner encryption keys are required.', 'INVALID_CONFIGURATION', 500);
  }
  const fetch = createNativeTransport(options);
  const nativeClient = new native.NativeCommitStore({ scope, senderKeyPair, ownerPublicKey, recipientPublicKeys, fetch,
    ...(options.storageDomain === undefined ? {} : { storageDomain: options.storageDomain }),
    ...(options.maxArtifactBytes === undefined ? {} : { maxArtifactBytes: options.maxArtifactBytes }) });
  return new InteregoGamingStore({ ...options, nativeClient, artifactCodec: native, owner: scope.owner,
    waitForNativeWrites: fetch.whenWritesSettled });
}

export class InteregoGamingStore {
  constructor({ nativeClient, artifactCodec, owner, namespace, maxStateBytes = 512 * 1024,
    maxEventBytes = 64 * 1024, maxRecordBytes = 1024 * 1024, conflictRetries = 3,
    maxPendingCommits = 64, waitForNativeWrites = async () => {} } = {}) {
    if (!nativeClient || !['ready', 'readHead', 'readArtifact', 'commit'].every(method => typeof nativeClient[method] === 'function')
      || !artifactCodec || !['createNativeByteArtifact', 'readNativeByteArtifact'].every(method => typeof artifactCodec[method] === 'function')) {
      fail('An encrypted native commit client and artifact codec are required.', 'INVALID_CONFIGURATION', 500);
    }
    identifier(owner, 'native owner', 4096); identifier(namespace, 'gaming namespace', 128);
    if (![maxStateBytes, maxEventBytes, maxRecordBytes].every(limit => Number.isSafeInteger(limit) && limit > 0 && limit <= 1024 * 1024)
      || !Number.isSafeInteger(conflictRetries) || conflictRetries < 0 || conflictRetries > 8
      || !Number.isSafeInteger(maxPendingCommits) || maxPendingCommits < 1 || maxPendingCommits > 1024
      || typeof waitForNativeWrites !== 'function') {
      fail('Invalid gaming storage limits.', 'INVALID_CONFIGURATION', 500);
    }
    Object.assign(this, { nativeClient, artifactCodec, owner, namespace, maxStateBytes, maxEventBytes, maxRecordBytes, conflictRetries,
      maxPendingCommits, waitForNativeWrites });
    this.commitQueue = []; this.pendingCommits = 0; this.activeCommit = false; this.commitSettlementFailed = false;
    this.activeStartedAt = null;
    this.performance = { completed: 0, failed: 0, cancelled: 0, refused: 0,
      lastQueueWaitMs: null, maxQueueWaitMs: 0, lastOperationMs: null, lastSettlementMs: null,
      lastSnapshotMs: null, snapshotReads: 0 };
  }
  /** One native head per store: local streams must not race the same CAS. */
  admitCommit(operation, signal) {
    if (signal !== undefined && (!signal || typeof signal.aborted !== 'boolean'
      || typeof signal.addEventListener !== 'function' || typeof signal.removeEventListener !== 'function')) {
      fail('Invalid commit cancellation signal.', 'INVALID_INPUT', 400);
    }
    if (signal?.aborted) fail('Queued native operation was cancelled.', 'OPERATION_ABORTED', 499);
    if (this.commitSettlementFailed) fail('Native write settlement requires recovery.', 'NATIVE_COMMIT_FENCED', 503);
    if (this.pendingCommits >= this.maxPendingCommits) { this.performance.refused++;
      fail('Native commit admission is at capacity.', 'NATIVE_COMMIT_CAPACITY', 503); }
    return new Promise((resolve, reject) => {
      const task = { operation, resolve, reject, signal, queuedAt: performance.now() };
      task.cancel = () => {
        const position = this.commitQueue.indexOf(task);
        if (position < 0) return; // Running operations retain their permit.
        this.commitQueue.splice(position, 1); this.pendingCommits--;
        this.performance.cancelled++;
        signal.removeEventListener('abort', task.cancel);
        reject(new DurableStoreError('Queued native operation was cancelled.', 'OPERATION_ABORTED', 499));
      };
      this.pendingCommits++; this.commitQueue.push(task);
      signal?.addEventListener('abort', task.cancel, { once: true });
      this.runNextCommit();
    });
  }
  runNextCommit() {
    if (this.activeCommit || this.commitSettlementFailed || !this.commitQueue.length) return;
    const task = this.commitQueue.shift();
    task.signal?.removeEventListener('abort', task.cancel);
    this.activeCommit = true;
    const startedAt = performance.now(); this.activeStartedAt = startedAt;
    this.performance.lastQueueWaitMs = Math.max(0, Math.round(startedAt - task.queuedAt));
    this.performance.maxQueueWaitMs = Math.max(this.performance.maxQueueWaitMs, this.performance.lastQueueWaitMs);
    // Once running, cancellation suppresses a caller acknowledgement in its
    // own layer; it cannot release this native permit or undo a durable write.
    let operationConfirmed = false, operationFinishedAt;
    Promise.resolve().then(task.operation).then(value => { operationConfirmed = true; this.performance.completed++; task.resolve(value); },
      error => { this.performance.failed++; task.reject(error); }).then(() => {
        operationFinishedAt = performance.now(); this.performance.lastOperationMs = Math.max(0, Math.round(operationFinishedAt - startedAt));
        return this.waitForNativeWrites({ operationConfirmed });
      }).then(() => {
      this.performance.lastSettlementMs = Math.max(0, Math.round(performance.now() - operationFinishedAt));
      this.pendingCommits--; this.activeCommit = false; this.activeStartedAt = null; this.runNextCommit();
    }, () => {
      this.commitSettlementFailed = true;
      for (const queued of this.commitQueue.splice(0)) {
        queued.signal?.removeEventListener('abort', queued.cancel); this.pendingCommits--;
        queued.reject(new DurableStoreError('Native write settlement requires recovery.', 'NATIVE_COMMIT_FENCED', 503));
      }
    });
  }
  commitAdmissionStatus() { return { active: this.activeCommit, queued: this.pendingCommits - (this.activeCommit ? 1 : 0),
    capacity: this.maxPendingCommits, settlementFailed: this.commitSettlementFailed }; }
  performanceStatus() { return { snapshotMode: typeof this.nativeClient.readHeadRecords === 'function' ? 'selected-records' : 'complete-index',
    activeMs: this.activeStartedAt === null ? 0 : Math.max(0, Math.round(performance.now() - this.activeStartedAt)),
    oldestQueuedMs: this.commitQueue.length ? Math.max(0, Math.round(performance.now() - this.commitQueue[0].queuedAt)) : 0,
    ...this.performance }; }
  keys(streamId, idempotencyKey) {
    identifier(streamId, 'stream ID');
    const stream = 'gaming:' + hash(canonical([this.namespace, streamId]));
    if (idempotencyKey === undefined) return { stream };
    identifier(idempotencyKey, 'idempotency key', 512);
    const operationId = 'gaming-v1-' + hash(canonical([this.namespace, streamId, idempotencyKey]));
    return { stream, operation: stream + ':operation:' + hash(idempotencyKey), operationId };
  }
  checkedSnapshot(snapshot, selectedKeys) {
    if (!snapshot || !(snapshot.records instanceof Map) || (snapshot.revision !== null && !REVISION.test(snapshot.revision))) {
      fail('Native snapshot is malformed.', 'CORRUPT_DURABLE_STATE', 503);
    }
    if (selectedKeys !== undefined) {
      const expected = [...new Set(selectedKeys)].sort();
      if (!Array.isArray(snapshot.selectedRecordKeys) || canonical(snapshot.selectedRecordKeys) !== canonical(expected)
        || [...snapshot.records.keys()].some(key => !expected.includes(key))) {
        fail('Native snapshot does not cover the requested records.', 'CORRUPT_DURABLE_STATE', 503);
      }
    } else if (snapshot.selectedRecordKeys !== undefined) {
      fail('Complete native snapshot coverage was not established.', 'CORRUPT_DURABLE_STATE', 503);
    }
    return snapshot;
  }
  async snapshot(selectedKeys = []) {
    const selected = typeof this.nativeClient.readHeadRecords === 'function';
    const expected = Object.freeze([...new Set(selectedKeys)].sort());
    const startedAt = performance.now();
    try {
      return this.checkedSnapshot(await (selected ? this.nativeClient.readHeadRecords([...expected]) : this.nativeClient.readHead()),
        selected ? expected : undefined);
    } finally { this.performance.snapshotReads++; this.performance.lastSnapshotMs = Math.max(0, Math.round(performance.now() - startedAt)); }
  }
  async record(snapshot, key) {
    if (snapshot.selectedRecordKeys !== undefined && !snapshot.selectedRecordKeys.includes(key)) {
      fail('Native record was outside the verified selection.', 'CORRUPT_DURABLE_STATE', 503);
    }
    const ref = snapshot.records.get(key);
    if (!ref) return null;
    const artifact = await this.nativeClient.readArtifact(ref);
    const decoded = this.artifactCodec.readNativeByteArtifact(artifact);
    if (decoded.owner !== this.owner || decoded.contentType !== CONTENT_TYPE || !(decoded.bytes instanceof Uint8Array)
      || decoded.bytes.length > this.maxRecordBytes) fail('Native gaming artifact binding is invalid.', 'CORRUPT_DURABLE_STATE', 503);
    let value;
    try {
      const text = Buffer.from(decoded.bytes).toString('utf8');
      value = JSON.parse(text);
      if (!Buffer.from(text).equals(Buffer.from(decoded.bytes)) || canonical(value) !== text) throw new Error('Noncanonical bytes');
    }
    catch { fail('Native gaming artifact is unreadable.', 'CORRUPT_DURABLE_STATE', 503); }
    if (!plain(value) || value.namespace !== this.namespace) fail('Native gaming scope changed.', 'CORRUPT_DURABLE_STATE', 503);
    return value;
  }
  streamRecord(value, streamId) {
    if (value !== null && (value.schema !== SCHEMA || value.namespace !== this.namespace || value.streamId !== streamId || !integer(value.version) || value.version < 1
      || !plain(value.state) || !Object.hasOwn(value, 'event') || typeof value.operationId !== 'string')) {
      fail('Native gaming stream is malformed.', 'CORRUPT_DURABLE_STATE', 503);
    }
    if (value) {
      try { boundedBytes(value.state, this.maxStateBytes, 'Gaming state'); boundedBytes(value.event, this.maxEventBytes, 'Gaming event'); }
      catch { fail('Native gaming stream exceeds its configured capacity.', 'CORRUPT_DURABLE_STATE', 503); }
    }
    return value;
  }
  view(record, revision, replayed = false) {
    return record ? { version: record.version, state: structuredClone(record.state),
      events: record.event === null ? [] : [structuredClone(record.event)], operationId: record.operationId, nativeRevision: revision, replayed }
      : { version: 0, state: null, events: [], nativeRevision: revision, replayed: false };
  }
  /** Capability/read check only. First real commit must establish write authority. */
  async ready() {
    if (this.commitSettlementFailed) fail('Native write settlement requires recovery.', 'NATIVE_COMMIT_FENCED', 503);
    await this.nativeClient.ready(); await this.snapshot();
  }
  async load(streamId) {
    const keys = this.keys(streamId), snapshot = await this.snapshot([keys.stream]);
    return this.view(this.streamRecord(await this.record(snapshot, keys.stream), streamId), snapshot.revision);
  }
  artifact(value) {
    return this.artifactCodec.createNativeByteArtifact({ owner: this.owner, contentType: CONTENT_TYPE,
      bytes: boundedBytes(value, this.maxRecordBytes, 'Gaming record') });
  }
  async replay(snapshot, keys, streamId, inputDigest, submitted) {
    const prior = await this.record(snapshot, keys.operation);
    if (!prior) return null;
    if (![RECEIPT_SCHEMA, LEGACY_RECEIPT_SCHEMA].includes(prior.schema) || prior.streamId !== streamId || prior.operationId !== keys.operationId
      || typeof prior.inputDigest !== 'string') fail('Native operation record is malformed.', 'CORRUPT_DURABLE_STATE', 503);
    if (prior.inputDigest !== inputDigest) fail('Idempotency key was already used for a different gaming operation.', 'IDEMPOTENCY_CONFLICT', 409);
    // The caller supplies exactly the input bound by the durable digest. Rebuild
    // its result rather than retaining another complete state in every receipt.
    if (prior.schema === RECEIPT_SCHEMA && (prior.resultVersion !== submitted.version
      || prior.resultDigest !== hash(canonical(submitted)))) fail('Native operation result binding is invalid.', 'CORRUPT_DURABLE_STATE', 503);
    const result = this.streamRecord(prior.schema === LEGACY_RECEIPT_SCHEMA ? prior.result : submitted, streamId);
    if (!result || result.operationId !== keys.operationId) fail('Native operation result is malformed.', 'CORRUPT_DURABLE_STATE', 503);
    return this.view(result, snapshot.revision, true);
  }
  async commit(streamId, { expectedVersion, state, event = null, idempotencyKey, signal } = {}) {
    if (!integer(expectedVersion) || expectedVersion === Number.MAX_SAFE_INTEGER || !plain(state)) fail('A finite stream version and object state are required.', 'INVALID_INPUT', 400);
    const keys = this.keys(streamId, identifier(idempotencyKey, 'idempotency key', 512));
    // Capture caller input before the first await, so later mutation cannot alter it.
    const cleanState = JSON.parse(boundedBytes(state, this.maxStateBytes, 'Gaming state').toString('utf8'));
    const cleanEvent = JSON.parse(boundedBytes(event, this.maxEventBytes, 'Gaming event').toString('utf8'));
    const inputDigest = hash(canonical({ expectedVersion, state: cleanState, event: cleanEvent }));
    const next = { schema: SCHEMA, namespace: this.namespace, streamId, version: expectedVersion + 1,
      state: cleanState, event: cleanEvent, operationId: keys.operationId };
    const receipt = { schema: RECEIPT_SCHEMA, namespace: this.namespace, streamId, operationId: keys.operationId, inputDigest, resultVersion: next.version, resultDigest: hash(canonical(next)) };
    const selectedKeys = Object.freeze([keys.stream, keys.operation].sort()), selected = typeof this.nativeClient.readHeadRecords === 'function';
    // Check both records' bounds before making any native writes.
    boundedBytes(next, this.maxRecordBytes, 'Gaming stream'); boundedBytes(receipt, this.maxRecordBytes, 'Gaming receipt');
    return this.admitCommit(async () => {
    for (let attempt = 0; attempt <= this.conflictRetries; attempt++) {
      const snapshot = await this.snapshot(selectedKeys), replayed = await this.replay(snapshot, keys, streamId, inputDigest, next);
      if (replayed) return replayed;
      const current = this.streamRecord(await this.record(snapshot, keys.stream), streamId);
      if ((current?.version ?? 0) !== expectedVersion) throw new DurableStoreConflictError(expectedVersion, current?.version ?? 0);
      try {
        const committed = await this.nativeClient.commit({ operationId: keys.operationId, expected: snapshot,
          changes: [{ key: keys.stream, artifact: this.artifact(next) }, { key: keys.operation, artifact: this.artifact(receipt) }],
          ...(selected ? { resultRecordKeys: [...selectedKeys] } : {}) });
        if (committed?.operationId !== keys.operationId || !committed.snapshot || committed.head?.revision !== committed.snapshot.revision) {
          fail('Native gaming receipt is not bound to this operation.', 'COMMIT_UNCERTAIN', 503);
        }
        this.checkedSnapshot(committed.snapshot, selected ? selectedKeys : undefined);
        const confirmed = await this.replay(committed.snapshot, keys, streamId, inputDigest, next);
        if (!confirmed) fail('Native gaming operation lacks durable readback.', 'COMMIT_UNCERTAIN', 503);
        return { ...confirmed, replayed: Boolean(committed.replayed) };
      } catch (error) {
        // The PUT may have committed before a timeout or another writer advanced
        // the head. Resolve by the durable operation record, never by guessing.
        let recoveredSnapshot;
        try { recoveredSnapshot = await this.snapshot(selectedKeys); }
        catch { fail('Gaming commit outcome is uncertain; retry the same idempotency key.', 'COMMIT_UNCERTAIN', 503); }
        const recovered = await this.replay(recoveredSnapshot, keys, streamId, inputDigest, next);
        if (recovered) return recovered;
        const latest = this.streamRecord(await this.record(recoveredSnapshot, keys.stream), streamId);
        if ((latest?.version ?? 0) !== expectedVersion) throw new DurableStoreConflictError(expectedVersion, latest?.version ?? 0);
        const conflict = error?.status === 412 || error?.name === 'NativeCommitConflictError';
        if (conflict && attempt < this.conflictRetries) continue;
        if (conflict) fail('Native scope is busy; retry the same gaming operation.', 'NATIVE_CONTENTION', 503);
        if (error instanceof DurableStoreError) throw error;
        fail('Gaming commit was not durably confirmed; retry the same idempotency key.', 'COMMIT_UNCERTAIN', 503);
      }
    }
    fail('Native gaming commit did not complete.', 'DURABILITY_UNAVAILABLE', 503);
    }, signal);
  }
}
