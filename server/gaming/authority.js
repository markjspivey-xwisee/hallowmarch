import { createHash, randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { grantCompanion, authorizeCompanion, revokeCompanion, redactObservation } from './companions.js';
import { learningOutboxDigest } from './outbox.js';
import { projectGamingEvents } from './learning.js';

export class GameCommandError extends Error {
  constructor(code, message) { super(message); this.name = 'GameCommandError'; this.code = code; }
}
export function requireGame(ok, code, message) { if (!ok) throw new GameCommandError(code, message); }
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function canonical(value, depth = 0, active = new Set()) {
  requireGame(depth <= 32, 'invalid_command', 'Command nesting exceeds capacity.');
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  requireGame(Array.isArray(value) || plain(value), 'invalid_command', 'Commands must contain finite JSON data.');
  requireGame(!active.has(value), 'invalid_command', 'Commands cannot contain cycles.'); active.add(value);
  try {
    if (Array.isArray(value)) {
      const parts = [];
      for (let i = 0; i < value.length; i++) { requireGame(Object.hasOwn(value, i), 'invalid_command', 'Command arrays cannot contain holes.'); parts.push(canonical(value[i], depth + 1, active)); }
      return '[' + parts.join(',') + ']';
    }
    // Server transport compositions may omit optional fields with undefined.
    return '{' + Object.keys(value).filter(key => value[key] !== undefined).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key], depth + 1, active)).join(',') + '}';
  } finally { active.delete(value); }
}
const digest = value => createHash('sha256').update(canonical(value)).digest('hex');
const validId = x => typeof x === 'string' && /^[A-Za-z0-9:_./-]{1,128}$/.test(x) && !['__proto__', 'constructor', 'prototype'].includes(x);
const human = p => (p?.kind === undefined || p.kind === 'human' || p.kind === 'player') && !p?.agentId && validId(p?.playerId);
const own = (map, key) => map && Object.hasOwn(map, key) ? map[key] : undefined;

/** Single-room command owner. Strict mode acknowledges only native commits.
 * Realtime mode requires one serving process: its live sequence advances in
 * memory while immutable, coalesced checkpoints progressively reach native CAS.
 * Live acceptance and durable confirmation are deliberately separate contracts.
 */
export class AuthoritativeRoom {
  constructor({ roomId, store, domain, clock = Date.now, maxPlayers = 64, onCommitted = null,
    persistenceMode = 'strict', checkpointIntervalMs = 1000, maxPendingCommands = 128,
    maxPendingAgeMs = 30000, durableWaitMs = 30000, learningDeliveryAvailable = null }) {
    requireGame(validId(roomId), 'invalid_room', 'Invalid room identity.');
    requireGame(store?.load && store?.commit, 'storage_required', 'A durable store is required.');
    this.id = roomId; this.store = store; this.domain = domain; this.clock = clock;
    this.maxPlayers = maxPlayers; this.onCommitted = onCommitted;
    // A trusted composition must prove current, owner-pod-safe delivery. Merely
    // linking a game identity or accepting an OAuth grant does not enable it.
    this.learningDeliveryAvailable = context => {
      try {
        const result = typeof learningDeliveryAvailable === 'function' && learningDeliveryAvailable(context);
        // A mistaken async port cannot become permission or leak a rejection.
        if (result && typeof result.then === 'function') { void Promise.resolve(result).catch(() => {}); return false; }
        return result === true;
      }
      catch { return false; }
    };
    this.current = null; this.version = 0; this.queue = Promise.resolve(); this.listeners = new Set();
    requireGame(['strict', 'realtime'].includes(persistenceMode)
      && Number.isSafeInteger(checkpointIntervalMs) && checkpointIntervalMs >= 1 && checkpointIntervalMs <= 30000
      && Number.isSafeInteger(maxPendingCommands) && maxPendingCommands >= 1 && maxPendingCommands <= 512
      && Number.isSafeInteger(maxPendingAgeMs) && maxPendingAgeMs >= 1 && maxPendingAgeMs <= 300000
      && Number.isSafeInteger(durableWaitMs) && durableWaitMs >= 1 && durableWaitMs <= 120000,
    'invalid_persistence', 'Bounded persistence configuration is required.');
    this.persistenceMode = persistenceMode; this.checkpointIntervalMs = checkpointIntervalMs;
    this.maxPendingCommands = maxPendingCommands; this.maxPendingAgeMs = maxPendingAgeMs; this.durableWaitMs = durableWaitMs;
    this.durableVersion = 0; this.durableSequence = 0; this.durableState = null;
    this.pendingCheckpoints = []; this.checkpoint = null; this.checkpointPromise = null; this.checkpointTimer = null;
    this.persistenceFailure = ''; this.persistenceBlocked = false; this.lastSavedAt = null; this.closed = false;
    this.stats = { commands: 0, refused: 0, commits: 0, conflicts: 0, checkpointFailures: 0, maxCommandMs: 0, lastCommitMs: 0 };
  }
  #accept(saved) {
    const state = saved?.state;
    requireGame(Number.isSafeInteger(saved?.version) && saved.version >= 1 && plain(state) && state.roomId === this.id && state.schemaVersion === 1
      && (!state.domainId || state.domainId === this.domain.id) && ['entities', 'sessions', 'consent', 'receipts', 'companions'].every(key => plain(state[key]))
      && plain(state.companions.grants) && plain(state.companions.tokenIndex) && Array.isArray(state.events) && Array.isArray(state.outbox),
    'corrupt_state', 'The committed expedition state is invalid.');
    requireGame(saved.version >= (this.persistenceMode === 'realtime' ? this.durableVersion : this.version), 'stale_state', 'Native storage returned an older expedition state.');
    requireGame(state.authoritySequence === undefined || (Number.isSafeInteger(state.authoritySequence) && state.authoritySequence >= saved.version), 'corrupt_state', 'The checkpoint sequence is invalid.');
    this.current = structuredClone(state); this.version = this.persistenceMode === 'realtime' ? (state.authoritySequence || saved.version) : saved.version;
    this.durableVersion = saved.version; this.durableSequence = this.version; this.durableState = structuredClone(state);
  }
  async #refresh() { if (this.persistenceMode !== 'realtime') this.#accept(await this.store.load(this.id)); }
  async open() {
    const saved = await this.store.load(this.id);
    if (saved.state) { this.#accept(saved); return this; }
    requireGame(saved.version === 0, 'corrupt_state', 'An existing expedition cannot have an empty state.');
    const state = { ...this.domain.initialState(this.id), roomId: this.id, schemaVersion: 1, domainId: this.domain.id,
      companions: { grants: {}, tokenIndex: {} }, sessions: {}, consent: {}, receipts: {}, events: [], outbox: [] };
    const event = { id: randomUUID(), streamId: this.id, version: 1, kind: 'world.created', actorId: 'server', actorKind: 'system', humanSubject: false,
      at: new Date(this.clock()).toISOString(), payload: { domain: this.domain.id } };
    state.events.push(event);
    try {
      const receipt = await this.store.commit(this.id, { expectedVersion: 0, state, event, idempotencyKey: `bootstrap:${this.id}` });
      if (receipt.replayed) this.#accept(await this.store.load(this.id));
      else this.#accept(receipt);
    } catch (error) {
      const winner = await this.store.load(this.id);
      if (!winner.state) throw error;
      this.#accept(winner);
    }
    return this;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  persistenceStatus() {
    const pendingCommands = this.pendingCheckpoints.length;
    const oldestPendingMs = pendingCommands ? Math.round(performance.now() - this.pendingCheckpoints[0].queuedAt) : 0;
    const aged = oldestPendingMs >= this.maxPendingAgeMs;
    return { mode: this.persistenceMode, status: this.persistenceBlocked || aged || pendingCommands >= this.maxPendingCommands ? 'blocked'
      : this.persistenceFailure ? 'degraded' : pendingCommands ? 'pending' : 'saved',
    liveSequence: this.version, durableSequence: this.durableSequence, durableVersion: this.durableVersion, pendingCommands, oldestPendingMs,
    pendingRewards: this.pendingCheckpoints.some(item => item.reward), lastSavedAt: this.lastSavedAt,
    ...(this.persistenceFailure ? { lastError: this.persistenceFailure } : {}) };
  }
  #metadata(sequence = this.version) {
    return { liveSequence: sequence, durableSequence: this.durableSequence, durableVersion: this.durableVersion,
      durable: sequence <= this.durableSequence, persistence: this.persistenceStatus() };
  }
  #replayResult(key, seen) {
    // Strict rollback restarts sequence numbering at the native revision. A
    // historical receipt can therefore carry a larger counter from the prior
    // realtime epoch. Its presence in the durable snapshot proves acceptance;
    // report it within the current saved prefix instead of promising a future
    // sequence that this owner has never accepted.
    const saved = own(this.durableState?.receipts, key);
    const version = saved?.fingerprint === seen.fingerprint
      ? Math.min(seen.result.version, this.durableSequence) : seen.result.version;
    return structuredClone({ ...seen.result, version, replayed: true });
  }
  #capacity() {
    requireGame(!this.closed, 'room_closed', 'This expedition is shutting down.');
    requireGame(this.persistenceStatus().status !== 'blocked', 'durability_backlog', 'Saving is delayed. The expedition is paused until its checkpoint is safe.');
  }
  #notify(events = []) {
    for (const listener of this.listeners) { try { listener({ roomId: this.id, version: this.version, events, ...this.#metadata() }); } catch { /* observers cannot undo authority */ } }
  }
  #publishLive(state, events, key, { reward = false } = {}) {
    this.#capacity();
    state.authoritySequence = this.version + 1;
    requireGame(Buffer.byteLength(canonical(state)) <= (this.store.maxStateBytes || 512 * 1024), 'state_capacity', 'The expedition checkpoint has reached its capacity.');
    this.current = state; this.version = state.authoritySequence;
    this.pendingCheckpoints.push({ sequence: this.version, queuedAt: performance.now(), events: structuredClone(events), key, reward });
    this.#notify(events); this.#scheduleCheckpoint();
    return this.#metadata();
  }
  #scheduleCheckpoint() {
    if (this.checkpointTimer || this.checkpointPromise || this.persistenceBlocked || this.closed || !this.pendingCheckpoints.length) return;
    this.checkpointTimer = setTimeout(() => { this.checkpointTimer = null; void this.flushPersistence().catch(() => {}); }, this.checkpointIntervalMs);
    this.checkpointTimer.unref?.();
  }
  async #checkpointOnce() {
    if (!this.checkpoint) {
      // Snapshot capture occupies the command queue only for its synchronous
      // clone. The network commit never holds up another validated game action.
      const capture = this.queue.then(() => {
        if (!this.pendingCheckpoints.length) return null;
        const state = structuredClone(this.current), entries = [...this.pendingCheckpoints];
        const event = { id: randomUUID(), kind: 'commands.checkpointed', streamId: this.id,
          version: this.durableVersion + 1, at: new Date(this.clock()).toISOString(),
          payload: { fromSequence: this.durableSequence + 1, throughSequence: this.version,
            commandCount: entries.length, eventIds: entries.flatMap(entry => entry.events.map(item => item.id)) } };
        return { expectedVersion: this.durableVersion, state, event,
          idempotencyKey: digest(['checkpoint', this.id, this.durableVersion, this.version, digest(state)]), entries };
      });
      this.queue = capture.then(() => {}, () => {});
      this.checkpoint = await capture;
      if (!this.checkpoint) return;
    }
    const batch = this.checkpoint, started = performance.now();
    try {
      let receipt;
      try { receipt = await this.store.commit(this.id, batch); }
      catch (error) {
        if (['conflict', 'version_conflict', 'VERSION_CONFLICT', 'IDEMPOTENCY_CONFLICT'].includes(error.code) || error.name === 'DurableStoreConflictError') {
          // An uncertain response may have reached native storage. Recognize
          // our exact immutable checkpoint; a different writer freezes this owner.
          const saved = await this.store.load(this.id);
          if (saved.version === batch.expectedVersion + 1 && digest(saved.state) === digest(batch.state)) receipt = saved;
          else { this.persistenceBlocked = true; this.stats.conflicts++; throw new GameCommandError('checkpoint_conflict', 'Another authority changed this room.'); }
        } else throw error;
      }
      requireGame(receipt.version === batch.expectedVersion + 1 && digest(receipt.state) === digest(batch.state), 'invalid_receipt', 'The native checkpoint receipt differs from the live snapshot.');
      this.durableVersion = receipt.version; this.durableSequence = batch.state.authoritySequence;
      this.durableState = structuredClone(batch.state);
      this.pendingCheckpoints = this.pendingCheckpoints.filter(entry => entry.sequence > this.durableSequence);
      this.checkpoint = null; this.persistenceFailure = ''; this.lastSavedAt = new Date(this.clock()).toISOString();
      this.stats.commits++; this.stats.lastCommitMs = Math.round((performance.now() - started) * 100) / 100;
      this.#notify();
      if (this.onCommitted) { try { this.onCommitted(batch.entries.flatMap(entry => entry.events), this); } catch { /* derived delivery uses durable outbox */ } }
    } catch (error) {
      this.stats.checkpointFailures++;
      this.persistenceFailure = this.persistenceBlocked ? 'checkpoint_conflict' : 'checkpoint_unavailable';
      this.#notify(); throw error;
    }
  }
  async flushPersistence() {
    if (this.persistenceMode !== 'realtime') { await this.queue; return this.persistenceStatus(); }
    if (this.checkpointTimer) { clearTimeout(this.checkpointTimer); this.checkpointTimer = null; }
    // A flush covers the accepted prefix at invocation. New actions can keep
    // running; they are captured by the next bounded checkpoint.
    await this.queue;
    const target = this.version;
    while (this.durableSequence < target) {
      requireGame(!this.persistenceBlocked, 'checkpoint_conflict', 'Another authority changed this room.');
      if (!this.checkpointPromise) {
        this.checkpointPromise = this.#checkpointOnce().finally(() => { this.checkpointPromise = null; this.#scheduleCheckpoint(); });
      }
      await this.checkpointPromise;
    }
    return this.persistenceStatus();
  }
  async #waitForDurability(sequence) {
    if (sequence <= this.durableSequence) return;
    let timer;
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new GameCommandError('durability_pending', 'That action is live, but its save is delayed. Check its status before trying again.')), this.durableWaitMs);
    });
    try {
      await Promise.race([this.flushPersistence().catch(() => { throw new GameCommandError('durability_pending', 'That action is live, but its save is delayed. Check its status before trying again.'); }), deadline]);
      requireGame(sequence <= this.durableSequence, 'durability_pending', 'That action is live, but its save is delayed. Check its status before trying again.');
    } finally { clearTimeout(timer); }
  }
  async close() { this.closed = true; if (this.checkpointTimer) { clearTimeout(this.checkpointTimer); this.checkpointTimer = null; } return this.flushPersistence(); }
  execute(principal, command) { return this.#enqueue(principal, command); }
  /** Privileged server ports, never dispatch these from caller supplied proof
   * labels. The native bridge verifies the owner pod and agent first. */
  admitNativeCompanion(principal, receipt, commandId) {
    return this.#enqueue(principal, { type: 'admitNativeCompanion', commandId }, { receipt });
  }
  executeNativeAgent(token, command, proof) {
    return this.#enqueue({ kind: 'agent', token }, command, { proof });
  }
  nativePermitReceipt(token, receipt) {
    const tokenHash = createHash('sha256').update(token).digest('hex');
    const current = Object.values(this.current?.companions.grants || {}).find(grant => grant.tokenHash === tokenHash);
    const saved = current && this.durableState?.companions.grants[current.id];
    if (!current?.nativeReceipt || !saved?.nativeReceipt || current.revokedAt !== null || current.expiresAt <= this.clock()
      || digest(current.nativeReceipt) !== digest(receipt) || digest(saved.nativeReceipt) !== digest(receipt)
      || own(this.current.companions.nativeReferences, receipt.grantId)?.revoked !== false) return null;
    return { roomId: this.id, version: this.durableSequence, durable: true };
  }
  #authorizeAgent(state, principal, command, now, native) {
    const authorization = authorizeCompanion(state, principal.token, command, now);
    const receipt = state.companions.grants[authorization.grantId]?.nativeReceipt;
    if (receipt) {
      const proof = native?.proof, reference = own(state.companions.nativeReferences, receipt.grantId);
      requireGame(reference && !reference.revoked && proof && proof.expiresAt > now
        && proof.grantId === receipt.grantId && proof.agentDid === receipt.agentDid && proof.ownerDid === receipt.ownerDid
        && proof.receiptRef?.grantDigest === receipt.grantDigest && digest(proof.scope) === digest(receipt.scope),
      'native_agent_proof_required', 'A current native agent proof is required.');
    } else requireGame(!native?.proof, 'native_agent_receipt_required', 'A durable native admission receipt is required.');
    return authorization;
  }
  #enqueue(principal, command, native = null) {
    const enqueued = performance.now();
    // Capture once before queueing: callers cannot mutate a pending command's
    // authenticated actor or payload while another durable write is in flight.
    let actor, input;
    try {
      requireGame(plain(command), 'invalid_command', 'A command object is required.');
      const encoded = canonical(command);
      requireGame(Buffer.byteLength(encoded) <= 8192, 'command_too_large', 'Command exceeds 8 KiB.');
      input = JSON.parse(encoded); actor = structuredClone(principal); native = native ? structuredClone(native) : null;
    } catch (error) { return Promise.reject(error); }
    const task = this.queue.then(() => this.#execute(actor, input, enqueued, native));
    this.queue = task.catch(() => {});
    return task.then(async result => {
      if (this.persistenceMode !== 'realtime') return result;
      if (['claimLoot', 'grantCompanion', 'revokeCompanion', 'learningConsent', 'registerNativeCompanion', 'admitNativeCompanion', 'revokeNativeCompanion'].includes(input.type)) await this.#waitForDurability(result.version);
      return { ...result, ...this.#metadata(result.version) };
    });
  }
  async #execute(principal, command, enqueued, native) {
    const started = performance.now();
    this.stats.commands++;
    try {
      requireGame(this.current, 'not_ready', 'The world is not ready.');
      requireGame(command && typeof command === 'object' && !Array.isArray(command), 'invalid_command', 'A command object is required.');
      requireGame(validId(command.commandId), 'command_id_required', 'A stable commandId is required.');
      requireGame(typeof command.type === 'string' && command.type.length <= 40, 'invalid_command', 'A command type is required.');
      requireGame(!command.roomId || command.roomId === this.id, 'room_mismatch', 'Command belongs to another room.');
      requireGame(human(principal) || (principal?.kind === 'agent' && typeof principal.token === 'string' && principal.token.length <= 100), 'unauthenticated', 'Authentication is required.');
      const identity = human(principal) ? `human:${principal.playerId}` : `agent:${digest(principal.token)}`;
      const key = digest([identity, command.commandId]);
      const fingerprint = digest(command);
      // Strict mode refreshes cross-process authorization. Realtime mode uses
      // the sole live owner's grants; a competing checkpoint writer freezes it.
      await this.#refresh();
      const seen = own(this.current.receipts, key);
      if (seen) {
        if (!human(principal)) this.#authorizeAgent(structuredClone(this.current), principal, command, this.clock(), native);
        requireGame(seen.fingerprint === fingerprint, 'idempotency_conflict', 'commandId was reused for different content.');
        // A grant token is deliberately never retained or replayed to a new caller.
        return this.#replayResult(key, seen);
      }
      if (this.persistenceMode === 'realtime') this.#capacity();
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = structuredClone(this.current), now = this.clock();
        requireGame(Number.isSafeInteger(now), 'invalid_clock', 'A trusted server clock is required.');
        let actorId = principal.playerId, entityId = command.entityId || actorId, normalized = { ...command }, authorization;
        if (!human(principal)) {
          authorization = this.#authorizeAgent(state, principal, command, now, native);
          normalized = { ...authorization.command, commandId: command.commandId };
          actorId = authorization.ownerPlayerId; entityId = authorization.entityId;
        }
        const events = [], emit = (kind, payload, subject = {}) => {
          const entity = own(state.entities, entityId) || own(state.entities, actorId);
          const event = { id: randomUUID(), streamId: this.id, version: this.version + 1, index: events.length, at: new Date(now).toISOString(),
            actorId, ...(authorization ? { agentId: authorization.actorId } : {}),
            teamId: String(entity?.teamId || ''), realmId: String(entity?.realmId ?? ''), kind, payload, ...subject };
          events.push(event); return event;
        };
        const context = { actorId, entityId, now, principal, authorization, emit };
        let result;
        if (normalized.type === 'join') {
          requireGame(human(principal), 'human_required', 'An agent cannot create player accounts.');
          const players = Object.values(state.entities).filter(e => e.kind === 'player');
          requireGame(own(state.entities, actorId) || players.length < this.maxPlayers, 'room_full', 'The expedition is full.');
          result = this.domain.join(state, principal, context);
          state.sessions[actorId] = { joinedAt: now };
        } else {
          requireGame(own(state.entities, actorId)?.kind === 'player', 'not_joined', 'Enter the expedition first.');
          if (normalized.type === 'registerNativeCompanion') {
            requireGame(human(principal) && typeof principal.verifiedDid === 'string', 'native_identity_required', 'A verified native owner is required.');
            requireGame(/^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(normalized.grantId)
              && /^urn:graph:[A-Za-z0-9:._/-]{1,1000}$/.test(normalized.graphIri), 'invalid_native_reference', 'A native grant reference is required.');
            state.companions.nativeReferences ||= {};
            const previous = own(state.companions.nativeReferences, normalized.grantId);
            requireGame(!previous || (previous.ownerPlayerId === actorId && previous.ownerDid === principal.verifiedDid && previous.graphIri === normalized.graphIri),
              'native_reference_conflict', 'This native grant reference is already bound.');
            requireGame(previous || Object.keys(state.companions.nativeReferences).length < 256, 'native_reference_capacity', 'Native reference capacity reached.');
            const reference = previous || { grantId: normalized.grantId, graphIri: normalized.graphIri, ownerPlayerId: actorId,
              ownerDid: principal.verifiedDid, registeredAt: new Date(now).toISOString(), revoked: false };
            state.companions.nativeReferences[normalized.grantId] = reference;
            emit('companion.nativeReferenceRegistered', { reference }); result = { reference };
          } else if (normalized.type === 'admitNativeCompanion') {
            const receipt = native?.receipt, reference = own(state.companions.nativeReferences, receipt?.grantId);
            requireGame(human(principal) && receipt && reference && !reference.revoked && reference.ownerPlayerId === actorId
              && principal.verifiedDid === receipt.ownerDid && reference.ownerDid === receipt.ownerDid
              && receipt.ownerRecord?.graphIri === reference.graphIri && receipt.scope?.roomId === this.id,
            'native_admission_rejected', 'A verified owner-pod grant is required.');
            // A restarted bridge cannot recover an old private permit. Rotate
            // that UUID's old permits rather than accumulating unusable grants.
            for (const old of Object.values(state.companions.grants)) if (old.nativeReceipt?.grantId === receipt.grantId) old.revokedAt = now;
            const scope = receipt.scope, created = grantCompanion(state, principal, { agentId: receipt.agentDid, role: scope.role,
              roomId: scope.roomId, entityId: scope.entityId, scopes: scope.actions, maxCommandsPerSecond: scope.maxCommandsPerSecond,
              expiresAt: Date.parse(receipt.grantExpiresAt) }, now);
            const grant = state.companions.grants[created.grant.id]; grant.nativeReceipt = structuredClone(receipt);
            emit('companion.nativeAdmitted', { receipt: structuredClone(receipt), ownerPlayerId: actorId });
            result = { receipt: structuredClone(receipt), token: created.token };
          } else if (normalized.type === 'revokeNativeCompanion') {
            const reference = own(state.companions.nativeReferences, normalized.grantId);
            requireGame(human(principal) && reference && reference.ownerPlayerId === actorId && principal.verifiedDid === reference.ownerDid,
              'native_owner_required', 'Only the verified owner can revoke this relationship.');
            reference.revoked = true;
            for (const grant of Object.values(state.companions.grants)) if (grant.nativeReceipt?.grantId === normalized.grantId) grant.revokedAt = now;
            emit('companion.nativeRevoked', { grantId: normalized.grantId }); result = { grantId: normalized.grantId, revoked: true };
          } else if (normalized.type === 'grantCompanion') {
            requireGame(human(principal), 'human_required', 'Only the human owner can grant access.');
            const grant = grantCompanion(state, principal, normalized.request, now);
            emit('companion.granted', { grant: grant.event.grant });
            result = { grant: grant.grant, token: grant.token };
          } else if (normalized.type === 'revokeCompanion') {
            const grant = revokeCompanion(state, principal, normalized.grantId, now);
            emit('companion.revoked', { grantId: grant.grant.id }); result = { grant: grant.grant };
          } else if (normalized.type === 'learningConsent') {
            requireGame(human(principal), 'human_required', 'Only the human controls learning export.');
            const until = normalized.enabled ? normalized.expiresAt : now;
            requireGame(typeof normalized.enabled === 'boolean' && Number.isSafeInteger(until) && until >= now && until <= now + 86400000,
              'invalid_consent', 'Consent must explicitly expire within 24 hours.');
            requireGame(!normalized.enabled || (typeof normalized.recipient === 'string' && normalized.recipient.startsWith('https://') && typeof normalized.actorDid === 'string' && normalized.actorDid.startsWith('did:')),
              'invalid_consent', 'A verified actor identity and concrete learning recipient are required.');
            requireGame(!normalized.enabled || (typeof normalized.sessionId === 'string' && normalized.sessionId.length > 0 && normalized.sessionId.length <= 128 && until > now),
              'invalid_consent', 'An unexpired learning session is required.');
            // The transport must bind this DID to the authenticated player before enabling export.
            requireGame(!normalized.enabled || principal.verifiedDid === normalized.actorDid, 'identity_unverified', 'Link your verified learning identity before enabling export.');
            requireGame(!normalized.enabled || this.learningDeliveryAvailable({ actorId, actorDid: normalized.actorDid,
              recipient: normalized.recipient, sessionId: normalized.sessionId, now, phase: 'consent' }),
            'learning_unavailable', 'Personal activity export is unavailable. You can keep playing.');
            state.consent[actorId] = { enabled: normalized.enabled, expiresAt: until, recipient: normalized.recipient || '', actorDid: normalized.actorDid || '', sessionId: normalized.sessionId || '' };
            // Changing or withdrawing consent cancels undelivered records for
            // that actor; old recipient/session consent cannot authorize them.
            state.outbox = state.outbox.filter(item => item.event.actorId !== actorId);
            emit('consent.changed', { enabled: normalized.enabled }); result = { consent: state.consent[actorId] };
          } else {
            result = this.domain.apply(state, normalized, context);
          }
        }
        const version = this.version + 1;
        const response = { ok: true, roomId: this.id, version, result: result || {} };
        const safeResponse = structuredClone(response); if (safeResponse.result) delete safeResponse.result.token;
        state.receipts[key] = { fingerprint, result: safeResponse };
        const receiptKeys = Object.keys(state.receipts); for (const old of receiptKeys.slice(0, Math.max(0, receiptKeys.length - 1024))) delete state.receipts[old];
        for (const event of events) {
          state.events.push(event);
          const consent = state.consent[event.actorId];
          if (consent?.enabled && consent.expiresAt > now && !['consent.changed', 'companion.granted'].includes(event.kind)) {
            const available = principal.verifiedDid === consent.actorDid && this.learningDeliveryAvailable({ actorId: event.actorId,
              actorDid: consent.actorDid, recipient: consent.recipient, sessionId: consent.sessionId, eventKind: event.kind, now, phase: 'capture' });
            if (available && state.outbox.length < 512) state.outbox.push({ event, consent: structuredClone(consent) });
            else {
              // Optional export cannot stop a command or grow an unbounded queue.
              // Retain old entries and make omitted coverage explicit and durable.
              const old = state.learningCaptureGaps?.total;
              state.learningCaptureGaps = { total: Math.min(Number.MAX_SAFE_INTEGER, (Number.isSafeInteger(old) && old >= 0 ? old : 0) + 1),
                lastAt: new Date(now).toISOString(), lastReason: available ? 'outbox-full' : 'delivery-unavailable' };
            }
          }
        }
        state.events = state.events.slice(-256);
        const event = { id: randomUUID(), streamId: this.id, version, at: new Date(now).toISOString(), kind: 'command.accepted',
          actorId, payload: { type: normalized.type, entityId, events, queueMs: Math.round(started - enqueued) } };
        if (this.persistenceMode === 'realtime') {
          const metadata = this.#publishLive(state, events, key, { reward: normalized.type === 'claimLoot' });
          return { ...response, ...metadata };
        }
        // A configured rollback to strict mode uses native revisions as its
        // sequence again. Do not retain a stale realtime checkpoint counter.
        if (Object.hasOwn(state, 'authoritySequence')) state.authoritySequence = version;
        const beforeCommit = performance.now();
        try {
          const receipt = await this.store.commit(this.id, { expectedVersion: this.version, state, event, idempotencyKey: key });
          if (receipt.replayed) {
            await this.#refresh();
            if (!human(principal)) this.#authorizeAgent(structuredClone(this.current), principal, command, this.clock(), native);
            const accepted = own(receipt.state?.receipts, key);
            requireGame(accepted?.fingerprint === fingerprint, 'idempotency_conflict', 'A different command already used this identity.');
            return this.#replayResult(key, accepted);
          }
          requireGame(receipt.version === version, 'invalid_receipt', 'Native receipt version differs from the committed command.');
          this.#accept(receipt); this.stats.commits++;
          this.stats.lastCommitMs = Math.round((performance.now() - beforeCommit) * 100) / 100;
          for (const listener of this.listeners) { try { listener({ roomId: this.id, version: this.version, events }); } catch { /* observers cannot undo a durable command */ } }
          if (this.onCommitted) { try { this.onCommitted(events, this); } catch { /* derived work is repaired from the durable outbox */ } }
          return response;
        } catch (error) {
          // Independently derived UUIDs/grant tokens make two executions of the
          // same logical command different native payloads. Recover by the
          // committed command fingerprint, not by retrying that speculative body.
          const nativeDuplicate = error.code === 'IDEMPOTENCY_CONFLICT';
          if (!nativeDuplicate && error.code !== 'conflict' && error.code !== 'version_conflict' && error.code !== 'VERSION_CONFLICT' && error.name !== 'DurableStoreConflictError') throw error;
          this.stats.conflicts++;
          await this.#refresh();
          const repeated = own(this.current.receipts, key);
          if (repeated) {
            if (!human(principal)) this.#authorizeAgent(structuredClone(this.current), principal, command, this.clock(), native);
            requireGame(repeated.fingerprint === fingerprint, 'idempotency_conflict', 'commandId conflicts with a committed command.');
            return this.#replayResult(key, repeated);
          }
          requireGame(!nativeDuplicate, 'command_receipt_unavailable', 'This command identity has already been committed; its response is outside the room replay window.');
          if (attempt === 2) throw error;
        }
      }
    } catch (error) { this.stats.refused++; throw error; }
    finally { this.stats.maxCommandMs = Math.max(this.stats.maxCommandMs, performance.now() - started); }
  }
  /** Internal dispatcher callback; intentionally absent from player/agent commands. */
  learningContext(limit = 200) {
    requireGame(Number.isInteger(limit) && limit >= 1 && limit <= 512, 'invalid_limit', 'Invalid learning page size.');
    const task = this.queue.then(async () => {
      await this.#refresh();
      // Speculative observations never become learning evidence. Current
      // consent still wins immediately when a human withdraws permission.
      const source = this.persistenceMode === 'realtime' ? this.durableState : this.current;
      return { outbox: structuredClone(source.outbox.filter(entry => this.current.outbox.some(item => item.event.id === entry.event.id)).slice(0, limit)), consent: structuredClone(this.current.consent) };
    });
    this.queue = task.catch(() => {}); return task;
  }
  acknowledgeLearning(data) {
    const ack = structuredClone(data);
    const task = this.queue.then(async () => {
      requireGame(ack && ['exported', 'discarded'].includes(ack.status) && Array.isArray(ack.eventIds) && ack.eventIds.length > 0 && ack.eventIds.length <= 20,
        'invalid_ack', 'A bounded learning acknowledgement is required.');
      const key = digest(['learning-ack', ack]);
      for (let attempt = 0; attempt < 3; attempt++) {
        await this.#refresh();
        if (this.current.learningReceipts?.[key]) {
          const receipt = this.current.learningReceipts[key], saved = this.durableState?.learningReceipts?.[key];
          return { durable: !!saved, ...receipt, version: saved ? Math.min(receipt.version, this.durableSequence) : receipt.version };
        }
        const entries = ack.eventIds.map(id => this.current.outbox.find(e => e.event.id === id));
        requireGame(new Set(ack.eventIds).size === ack.eventIds.length && entries.every(Boolean), 'outbox_conflict', 'The learning outbox changed.');
        if (this.persistenceMode === 'realtime') requireGame(entries.every(entry => this.durableState.outbox.some(item => item.event.id === entry.event.id)), 'outbox_conflict', 'Only checkpointed learning records can be acknowledged.');
        for (const entry of entries) {
          const c = entry.consent, ref = ack.eventRefs?.find(r => r.eventId === entry.event.id), hash = ack.sourceDigests?.find(r => r.eventId === entry.event.id)?.sha256;
          requireGame(hash === learningOutboxDigest(entry) && ref?.streamId === entry.event.streamId && ref.version === entry.event.version && (ref.index ?? 0) === (entry.event.index ?? 0)
            && ack.binding?.actorId === entry.event.actorId && ack.binding.sessionId === c.sessionId && ack.binding.recipient === c.recipient && ack.binding.actorDid === c.actorDid,
          'outbox_conflict', 'A learning acknowledgement must bind its exact source entries.');
        }
        if (ack.status === 'exported') {
          const expected = projectGamingEvents(entries.map(e => e.event), { domain: this.domain.evidenceDomain || this.domain.id, gameId: this.id }).evidence.map(e => e.id).sort();
          requireGame(Array.isArray(ack.receipts) && ack.receipts.every(r => r.persisted === true) && JSON.stringify(ack.receipts.map(r => r.statementId).sort()) === JSON.stringify(expected),
            'invalid_ack', 'Exact persisted learning receipts are required.');
        }
        const state = structuredClone(this.current), receipt = { version: this.version + 1, status: ack.status, eventIds: ack.eventIds, receipts: ack.receipts || [], at: new Date(this.clock()).toISOString() };
        state.outbox = state.outbox.filter(e => !ack.eventIds.includes(e.event.id)); state.learningReceipts ||= {}; state.learningReceipts[key] = receipt;
        const old = Object.keys(state.learningReceipts); for (const id of old.slice(0, Math.max(0, old.length - 256))) delete state.learningReceipts[id];
        if (this.persistenceMode === 'realtime') {
          this.#publishLive(state, [], key);
          return { durable: false, ...receipt };
        }
        if (Object.hasOwn(state, 'authoritySequence')) state.authoritySequence = receipt.version;
        try {
          this.#accept(await this.store.commit(this.id, { expectedVersion: this.version, state, event: { id: randomUUID(), kind: 'learning.delivery', payload: receipt }, idempotencyKey: key }));
          return { durable: true, ...receipt };
        } catch (error) { if (error.code !== 'VERSION_CONFLICT' && error.code !== 'version_conflict' && error.code !== 'IDEMPOTENCY_CONFLICT') throw error; if (attempt === 2) throw error; }
      }
    }); this.queue = task.catch(() => {});
    return task.then(async result => {
      if (this.persistenceMode === 'realtime') await this.#waitForDurability(result.version);
      return { ...result, durable: true };
    });
  }
  observe(principal) {
    const actor = structuredClone(principal);
    const task = this.queue.then(async () => { await this.#refresh(); return this.#observe(actor); });
    this.queue = task.catch(() => {});
    return task;
  }
  observeNativeAgent(token, entityId, proof) {
    const actor = { kind: 'agent', token, entityId }, native = { proof: structuredClone(proof) };
    const task = this.queue.then(async () => { await this.#refresh(); return this.#observe(actor, native); });
    this.queue = task.catch(() => {}); return task;
  }
  /** Human subscription fan-out needs no storage read per connection. In strict
   * mode this is a committed view; realtime mode explicitly includes the live
   * sequence and durability lag. Agent authorization uses the sole live owner
   * in realtime mode and refreshes native storage in strict mode.
   */
  observeCommitted(principal) {
    requireGame(human(principal), 'human_required', 'Only authenticated human subscriptions use committed snapshots.');
    return this.#observe(structuredClone(principal));
  }
  #observe(principal, native) {
    requireGame(this.current, 'not_ready', 'The world is not ready.');
    if (principal?.kind === 'agent') {
      // Validate against a disposable clone: observing does not mutate canonical rate state.
      const grant = this.#authorizeAgent(structuredClone(this.current), principal, { type: 'observe', roomId: this.id, entityId: principal.entityId }, this.clock(), native);
      return redactObservation({ roomId: this.id, version: this.version, ...this.#metadata(), ...this.domain.observe(this.current, grant.ownerPlayerId) }, grant);
    }
    requireGame(human(principal) && own(this.current.entities, principal.playerId)?.kind === 'player', 'not_joined', 'Enter the expedition first.');
    return { roomId: this.id, version: this.version, ...this.#metadata(), ...this.domain.observe(this.current, principal.playerId),
      grants: Object.values(this.current.companions.grants).filter(g => g.ownerPlayerId === principal.playerId && !g.nativeReceipt).map(g => { const { tokenHash, commandTimes, ...safe } = g; return structuredClone(safe); }),
      nativeCompanions: Object.values(this.current.companions.grants).filter(g => g.ownerPlayerId === principal.playerId && g.nativeReceipt)
        .map(g => ({ ...structuredClone(g.nativeReceipt), revoked: g.revokedAt !== null })),
      nativeReferences: Object.values(this.current.companions.nativeReferences || {}).filter(ref => ref.ownerPlayerId === principal.playerId).map(ref => structuredClone(ref)),
      consent: structuredClone(this.current.consent[principal.playerId] || { enabled: false }), storage: 'interego-native' };
  }
}
