import { createHash, randomUUID } from 'node:crypto';

const SCHEMA = 'urn:bridge:owned-state-checkpoint:v1';
const positive = value => Number.isSafeInteger(value) && value > 0;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const digest = text => 'sha256:' + createHash('sha256').update(text).digest('hex');

export class OwnedStateError extends Error {
  constructor(code, message) { super(message); this.name = 'OwnedStateError'; this.code = code; }
}
const fail = (code, message) => { throw new OwnedStateError(code, message); };

function canonical(value, depth = 0, active = new Set()) {
  if (depth > 64) fail('INVALID_STATE', 'Snapshot nesting exceeds capacity.');
  if (value === null || ['string', 'boolean'].includes(typeof value)) return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (!Array.isArray(value) && !object(value)) fail('INVALID_STATE', 'Snapshots require finite JSON values.');
  if (active.has(value)) fail('INVALID_STATE', 'Snapshot contains a cycle.');
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) {
        if (!Object.hasOwn(value, i)) fail('INVALID_STATE', 'Snapshot arrays cannot contain holes.');
        parts.push(canonical(value[i], depth + 1, active));
      }
      return '[' + parts.join(',') + ']';
    }
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1, active)).join(',') + '}';
  } finally { active.delete(value); }
}

/**
 * An application bridge over an already owner-scoped durable store. Production
 * supplies createInteregoStore(), whose commit resolves only after native CAS,
 * encrypted artifact and operation-receipt readback. There is no file fallback.
 * capture() copies bounded JSON synchronously; it performs no durable I/O.
 */
export function createProgressiveOwnedState({ store, streamId, owner = store?.owner,
  checkpointIntervalMs = 1000, retryIntervalMs = 5000, maxSnapshotBytes = 480 * 1024, clock = Date.now, active = true } = {}) {
  if (!store || !['load', 'commit'].every(method => typeof store[method] === 'function')
    || typeof owner !== 'string' || !owner || owner.length > 4096 || (store.owner !== undefined && store.owner !== owner)
    || typeof streamId !== 'string' || !streamId || streamId.length > 1024
    || ![checkpointIntervalMs, retryIntervalMs].every(n => positive(n) && n <= 60000)
    || !positive(maxSnapshotBytes) || maxSnapshotBytes > 1024 * 1024 || typeof clock !== 'function') {
    fail('INVALID_CONFIGURATION', 'Owner-scoped durable load and commit ports and bounded settings are required.');
  }
  let started = false, starting = null, recovering = false, stopping = false, closed = false, conflict = false;
  let live = null, confirmed = null, confirmedVersion = 0, latest = null, attempt = null, inFlight = null, timer = null;
  let lastError = null, lastConfirmedAt = null, activityActive = active === true;

  function bounded(value) {
    const text = canonical(value);
    if (Buffer.byteLength(text) > maxSnapshotBytes) fail('SNAPSHOT_TOO_LARGE', 'Snapshot exceeds configured capacity.');
    return JSON.parse(text);
  }
  function envelope(value, version) {
    if (!object(value)) fail('INVALID_STATE', 'Snapshot root must be an object.');
    const clean = bounded(value), capturedAt = clock();
    if (!Number.isSafeInteger(capturedAt) || capturedAt < 0 || !positive(version)) fail('INVALID_STATE', 'Snapshot version or clock is invalid.');
    return bounded({ schema: SCHEMA, owner, liveVersion: version, capturedAt, digest: digest(canonical(clean)), value: clean });
  }
  function checked(result) {
    if (!object(result) || !Number.isSafeInteger(result.version) || result.version < 0) fail('CORRUPT_DURABLE_STATE', 'Durable snapshot version is invalid.');
    if (result.version === 0) {
      if (result.state !== null) fail('CORRUPT_DURABLE_STATE', 'Only explicit version-zero null state confirms absence.');
      return null;
    }
    try {
      const state = bounded(result.state);
      if (!object(state) || state.schema !== SCHEMA || state.owner !== owner || !positive(state.liveVersion)
        || !Number.isSafeInteger(state.capturedAt) || state.capturedAt < 0 || !object(state.value)
        || state.digest !== digest(canonical(state.value))) throw new Error('Invalid binding');
      return state;
    } catch { fail('CORRUPT_DURABLE_STATE', 'Durable snapshot ownership, shape or digest is invalid.'); }
  }
  function stateName() {
    if (conflict) return 'conflict';
    if (recovering) return 'recovering';
    if (closed) return latest || attempt ? 'closed-unconfirmed' : 'closed';
    if (stopping) return 'closing';
    if (!started) return starting ? 'initializing' : lastError ? 'unavailable' : 'uninitialized';
    return latest || attempt ? lastError ? 'delayed' : 'pending' : 'confirmed';
  }
  function status() {
    return { state: stateName(), owner, streamId, liveVersion: live?.liveVersion ?? 0,
      confirmedLiveVersion: confirmed?.liveVersion ?? 0, confirmedVersion,
      pendingSnapshots: (attempt ? 1 : 0) + (latest ? 1 : 0), writing: Boolean(inFlight),
      durable: started && !latest && !attempt && !conflict && !recovering,
      lastConfirmedAt, error: lastError };
  }
  function clearTimer() { if (timer) clearTimeout(timer); timer = null; }
  function schedule(delay = checkpointIntervalMs) {
    if (!activityActive || timer || stopping || closed || conflict || recovering || !started) return;
    timer = setTimeout(() => { timer = null; void checkpoint().catch(() => {}); }, delay);
    timer.unref?.();
  }
  function requireRunning() {
    if (conflict) fail('VERSION_CONFLICT', 'Owned state has another writer; pause and explicitly recover.');
    if (!started || recovering) fail('NOT_READY', 'Confirmed owned state must be restored before simulation.');
    if (stopping || closed) fail('CLOSED', 'Owned state is draining for shutdown.');
  }
  function capture(value) {
    requireRunning();
    const next = envelope(value, (live?.liveVersion ?? 0) + 1);
    if (next.digest === live.digest) return { changed: false, liveVersion: live.liveVersion, durable: !attempt && !latest };
    live = next; latest = next; schedule();
    return { changed: true, liveVersion: live.liveVersion, durable: false };
  }
  async function runAttempt() {
    if (!attempt) {
      if (!latest) return status();
      attempt = { state: latest, expectedVersion: confirmedVersion, idempotencyKey: 'owned-checkpoint-' + randomUUID() };
      latest = null;
    }
    const sent = attempt;
    try {
      const result = await store.commit(streamId, { ...sent, event: null });
      const restored = checked(result);
      if (result.version !== sent.expectedVersion + 1 || canonical(restored) !== canonical(sent.state)) {
        fail('COMMIT_UNCERTAIN', 'Durable acknowledgement does not identify the submitted snapshot.');
      }
      confirmed = restored; confirmedVersion = result.version; lastConfirmedAt = clock(); lastError = null; attempt = null;
      return status();
    } catch (error) {
      conflict = error?.code === 'VERSION_CONFLICT';
      lastError = conflict ? 'VERSION_CONFLICT' : error?.code === 'CORRUPT_DURABLE_STATE' ? 'CORRUPT_DURABLE_STATE' : 'CHECKPOINT_UNCONFIRMED';
      // Preserve the exact operation, expected version and bytes for uncertain
      // retries. Never adopt a foreign version and rebase local world state.
      fail(lastError, conflict ? 'Owned state changed; explicit recovery is required.' : 'Checkpoint is not durably confirmed.');
    }
  }
  function checkpoint({ allowInactive = false } = {}) {
    if (inFlight) return inFlight;
    if (!activityActive && !allowInactive) return Promise.resolve(status());
    if (closed) return Promise.reject(new OwnedStateError('CLOSED', 'Owned state is closed.'));
    if (conflict) return Promise.reject(new OwnedStateError('VERSION_CONFLICT', 'Explicit owned-state recovery is required.'));
    if ((!started && !starting) || recovering) return Promise.reject(new OwnedStateError('NOT_READY', 'Owned state is not ready.'));
    clearTimer();
    inFlight = runAttempt().finally(() => {
      inFlight = null;
      if (attempt || latest) schedule(lastError ? retryIntervalMs : checkpointIntervalMs);
    });
    return inFlight;
  }
  function adopt(result, state) {
    confirmedVersion = result.version; confirmed = state; live = state; latest = null; attempt = null;
    conflict = false; lastError = null; lastConfirmedAt = clock(); started = true;
  }
  function start({ seed } = {}) {
    if (starting) return starting;
    if (started) return Promise.resolve(structuredClone(live.value));
    if (stopping || closed || conflict) return Promise.reject(new OwnedStateError(conflict ? 'VERSION_CONFLICT' : 'CLOSED', 'Owned state cannot start.'));
    starting = Promise.resolve().then(async () => {
      if (!attempt) {
        const result = await store.load(streamId), restored = checked(result);
        if (restored) { adopt(result, restored); return structuredClone(restored.value); }
        if (typeof seed !== 'function') fail('SEED_REQUIRED', 'Confirmed absence requires an explicit migration seed.');
        live = envelope(await seed(), 1); latest = live;
        if (!activityActive) { started = true; return structuredClone(live.value); }
      }
      // First migration is itself confirmed before any legacy constructors run.
      await checkpoint(); started = true;
      return structuredClone(confirmed.value);
    }).catch(error => {
      if (!lastError) lastError = ['CORRUPT_DURABLE_STATE', 'SEED_REQUIRED'].includes(error?.code) ? error.code : 'STARTUP_UNCONFIRMED';
      throw error instanceof OwnedStateError ? error : new OwnedStateError('STARTUP_UNCONFIRMED', 'Native startup read is unavailable; migration was not attempted.');
    }).finally(() => { starting = null; });
    return starting;
  }
  async function recover({ discardUnconfirmed = false, restore } = {}) {
    if (discardUnconfirmed !== true || typeof restore !== 'function') fail('RECOVERY_REQUIRED', 'Explicitly discard pending local state and restore the native snapshot while simulation is paused.');
    if (recovering || starting || inFlight || stopping || closed) fail('BUSY', 'Owned-state work must settle before recovery.');
    recovering = true; clearTimer();
    try {
      const result = await store.load(streamId), restored = checked(result);
      if (!restored) fail('CORRUPT_DURABLE_STATE', 'Recovery cannot replace an established world with absent state.');
      await restore(structuredClone(restored.value));
      adopt(result, restored);
      return structuredClone(restored.value);
    } catch {
      conflict = true; lastError = 'RECOVERY_UNCONFIRMED';
      fail('RECOVERY_UNCONFIRMED', 'Native recovery or host restoration failed; simulation must remain paused.');
    } finally { recovering = false; }
  }
  function setActive(value) {
    activityActive = value === true;
    if (!activityActive) clearTimer();
    else if (attempt || latest) schedule();
    return status();
  }
  async function suspend({ checkpoint: save = true, timeoutMs = 10000 } = {}) {
    if (!positive(timeoutMs) || timeoutMs > 60000) fail('INVALID_CONFIGURATION', 'A bounded suspension deadline is required.');
    setActive(false);
    if (!save || (!attempt && !latest && !inFlight)) return status();
    let deadline;
    try {
      // Settle an already dispatched write, then save the latest accepted state once.
      // A failed dispatch is retained exactly and never retried while idle.
      const drain = async () => {
        if (inFlight) await inFlight;
        return attempt || latest ? checkpoint({ allowInactive: true }) : status();
      };
      return await Promise.race([drain(), new Promise((_, reject) => {
        deadline = setTimeout(() => reject(new OwnedStateError('SUSPEND_UNCONFIRMED', 'Only the last confirmed checkpoint is recoverable.')), timeoutMs);
        deadline.unref?.();
      })]);
    } finally { clearTimeout(deadline); }
  }
  async function shutdown({ timeoutMs = 15000, checkpoint: save = true } = {}) {
    if (!positive(timeoutMs) || timeoutMs > 60000) fail('INVALID_CONFIGURATION', 'A bounded shutdown deadline is required.');
    if (!save || !activityActive) { clearTimer(); stopping = true; closed = true; return status(); }
    if (starting || recovering || !started) fail('NOT_READY', 'Owned state must finish startup or recovery before draining.');
    if (closed) return status();
    stopping = true; clearTimer();
    let expired = false, deadlineTimer, retryTimer, finishRetry;
    const deadline = new Promise((_, reject) => {
      deadlineTimer = setTimeout(() => { expired = true; finishRetry?.(); reject(new OwnedStateError('SHUTDOWN_UNCONFIRMED', 'Shutdown deadline expired; only the last confirmed snapshot is recoverable.')); }, timeoutMs);
    });
    const drain = async () => {
      if (conflict) fail('VERSION_CONFLICT', 'A conflicting owned-state writer prevents shutdown confirmation.');
      while (!expired && (attempt || latest || inFlight)) {
        try { await checkpoint(); }
        catch (error) {
          if (conflict) throw error;
          if (!expired) await new Promise(resolve => { finishRetry = resolve; retryTimer = setTimeout(resolve, Math.min(retryIntervalMs, timeoutMs)); });
          clearTimeout(retryTimer); finishRetry = null;
        }
      }
      if (expired) fail('SHUTDOWN_UNCONFIRMED', 'Shutdown checkpoint remains unconfirmed.');
      return status();
    };
    try { await Promise.race([drain(), deadline]); }
    finally { expired = true; clearTimeout(deadlineTimer); clearTimeout(retryTimer); finishRetry?.(); closed = true; }
    return status();
  }
  return { start, capture, checkpoint, recover, shutdown, status, setActive, suspend };
}
