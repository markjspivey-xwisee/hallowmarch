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

/** Single-room command owner. Shared-store CAS also arbitrates independent processes.
 * Working state is a cache: no acknowledged change exists without a durable receipt.
 * The domain adapter owns rules; this module owns identity, sequencing and commits.
 */
export class AuthoritativeRoom {
  constructor({ roomId, store, domain, clock = Date.now, maxPlayers = 64, onCommitted = null }) {
    requireGame(validId(roomId), 'invalid_room', 'Invalid room identity.');
    requireGame(store?.load && store?.commit, 'storage_required', 'A durable store is required.');
    this.id = roomId; this.store = store; this.domain = domain; this.clock = clock;
    this.maxPlayers = maxPlayers; this.onCommitted = onCommitted;
    this.current = null; this.version = 0; this.queue = Promise.resolve(); this.listeners = new Set();
    this.stats = { commands: 0, refused: 0, commits: 0, conflicts: 0, maxCommandMs: 0, lastCommitMs: 0 };
  }
  #accept(saved) {
    const state = saved?.state;
    requireGame(Number.isSafeInteger(saved?.version) && saved.version >= 1 && plain(state) && state.roomId === this.id && state.schemaVersion === 1
      && (!state.domainId || state.domainId === this.domain.id) && ['entities', 'sessions', 'consent', 'receipts', 'companions'].every(key => plain(state[key]))
      && plain(state.companions.grants) && plain(state.companions.tokenIndex) && Array.isArray(state.events) && Array.isArray(state.outbox),
    'corrupt_state', 'The committed expedition state is invalid.');
    requireGame(saved.version >= this.version, 'stale_state', 'Native storage returned an older expedition state.');
    this.current = structuredClone(state); this.version = saved.version;
  }
  async #refresh() { this.#accept(await this.store.load(this.id)); }
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
      if (receipt.replayed) await this.#refresh();
      else this.#accept(receipt);
    } catch (error) {
      const winner = await this.store.load(this.id);
      if (!winner.state) throw error;
      this.#accept(winner);
    }
    return this;
  }
  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  execute(principal, command) {
    const enqueued = performance.now();
    // Capture once before queueing: callers cannot mutate a pending command's
    // authenticated actor or payload while another durable write is in flight.
    let actor, input;
    try {
      requireGame(plain(command), 'invalid_command', 'A command object is required.');
      const encoded = canonical(command);
      requireGame(Buffer.byteLength(encoded) <= 8192, 'command_too_large', 'Command exceeds 8 KiB.');
      input = JSON.parse(encoded); actor = structuredClone(principal);
    } catch (error) { return Promise.reject(error); }
    const task = this.queue.then(() => this.#execute(actor, input, enqueued));
    this.queue = task.catch(() => {});
    return task;
  }
  async #execute(principal, command, enqueued) {
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
      // Authorization/replay must see a current native head. Cached grants are
      // insufficient after a different service process revokes an agent.
      await this.#refresh();
      const seen = own(this.current.receipts, key);
      if (seen) {
        if (!human(principal)) authorizeCompanion(structuredClone(this.current), principal.token, command, this.clock());
        requireGame(seen.fingerprint === fingerprint, 'idempotency_conflict', 'commandId was reused for different content.');
        // A grant token is deliberately never retained or replayed to a new caller.
        return structuredClone({ ...seen.result, replayed: true });
      }
      for (let attempt = 0; attempt < 3; attempt++) {
        const state = structuredClone(this.current), now = this.clock();
        requireGame(Number.isSafeInteger(now), 'invalid_clock', 'A trusted server clock is required.');
        let actorId = principal.playerId, entityId = command.entityId || actorId, normalized = { ...command }, authorization;
        if (!human(principal)) {
          authorization = authorizeCompanion(state, principal.token, command, now);
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
          if (normalized.type === 'grantCompanion') {
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
            // The transport must bind this DID to the authenticated player before enabling export.
            requireGame(!normalized.enabled || principal.verifiedDid === normalized.actorDid, 'identity_unverified', 'Link your verified learning identity before enabling export.');
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
            requireGame(state.outbox.length < 512, 'learning_queue_full', 'Learning export is delayed. Disable export or try again later.');
            state.outbox.push({ event, consent: structuredClone(consent) });
          }
        }
        state.events = state.events.slice(-256);
        const event = { id: randomUUID(), streamId: this.id, version, at: new Date(now).toISOString(), kind: 'command.accepted',
          actorId, payload: { type: normalized.type, entityId, events, queueMs: Math.round(started - enqueued) } };
        const beforeCommit = performance.now();
        try {
          const receipt = await this.store.commit(this.id, { expectedVersion: this.version, state, event, idempotencyKey: key });
          if (receipt.replayed) {
            await this.#refresh();
            if (!human(principal)) authorizeCompanion(structuredClone(this.current), principal.token, command, this.clock());
            const accepted = own(receipt.state?.receipts, key);
            requireGame(accepted?.fingerprint === fingerprint, 'idempotency_conflict', 'A different command already used this identity.');
            return structuredClone({ ...accepted.result, replayed: true });
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
            if (!human(principal)) authorizeCompanion(structuredClone(this.current), principal.token, command, this.clock());
            requireGame(repeated.fingerprint === fingerprint, 'idempotency_conflict', 'commandId conflicts with a committed command.');
            return structuredClone({ ...repeated.result, replayed: true });
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
    const task = this.queue.then(async () => { await this.#refresh(); return { outbox: structuredClone(this.current.outbox.slice(0, limit)), consent: structuredClone(this.current.consent) }; });
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
        if (this.current.learningReceipts?.[key]) return { durable: true, ...this.current.learningReceipts[key] };
        const entries = ack.eventIds.map(id => this.current.outbox.find(e => e.event.id === id));
        requireGame(new Set(ack.eventIds).size === ack.eventIds.length && entries.every(Boolean), 'outbox_conflict', 'The learning outbox changed.');
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
        try {
          this.#accept(await this.store.commit(this.id, { expectedVersion: this.version, state, event: { id: randomUUID(), kind: 'learning.delivery', payload: receipt }, idempotencyKey: key }));
          return { durable: true, ...receipt };
        } catch (error) { if (error.code !== 'VERSION_CONFLICT' && error.code !== 'version_conflict' && error.code !== 'IDEMPOTENCY_CONFLICT') throw error; if (attempt === 2) throw error; }
      }
    }); this.queue = task.catch(() => {}); return task;
  }
  observe(principal) {
    const actor = structuredClone(principal);
    const task = this.queue.then(async () => { await this.#refresh(); return this.#observe(actor); });
    this.queue = task.catch(() => {});
    return task;
  }
  #observe(principal) {
    requireGame(this.current, 'not_ready', 'The world is not ready.');
    if (principal?.kind === 'agent') {
      // Validate against a disposable clone: observing does not mutate canonical rate state.
      const grant = authorizeCompanion(structuredClone(this.current), principal.token, { type: 'observe', roomId: this.id, entityId: principal.entityId }, this.clock());
      return redactObservation({ roomId: this.id, version: this.version, ...this.domain.observe(this.current, grant.ownerPlayerId) }, grant);
    }
    requireGame(human(principal) && own(this.current.entities, principal.playerId)?.kind === 'player', 'not_joined', 'Enter the expedition first.');
    return { roomId: this.id, version: this.version, ...this.domain.observe(this.current, principal.playerId),
      grants: Object.values(this.current.companions.grants).filter(g => g.ownerPlayerId === principal.playerId).map(g => { const { tokenHash, commandTimes, ...safe } = g; return structuredClone(safe); }),
      consent: structuredClone(this.current.consent[principal.playerId] || { enabled: false }), storage: 'interego-native' };
  }
}
