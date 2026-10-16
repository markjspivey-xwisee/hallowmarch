/** Native delegation for the existing March. The owner page runs its ordinary
 * physics/combat; this bridge authenticates and dispatches bounded inputs. An
 * accepted input is never described as a server-verified combat outcome. */
import { createHash } from 'node:crypto';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { createNativeAgentProofAdapter } from './native-agent-proof.js';
import { NativeAgentAuthorityError } from './native-agent-authority.js';
import { nativeAgentAffordances } from './native-agent-http.js';

export const WORLD_AGENT_PATHS = Object.freeze(Object.fromEntries(
  ['register', 'challenge', 'complete', 'renew', 'command', 'observe', 'revoke'].map(op => [op, '/world/native-agent/' + op])));
const copy = value => structuredClone(value);
const fail = code => { throw new NativeAgentAuthorityError(code); };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const uuid = value => /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');

export function mainWorldAgentAffordances(options) {
  const base = nativeAgentAffordances(options);
  const doc = JSON.parse(JSON.stringify(base).replaceAll('/gaming/native-agent', '/world/native-agent'));
  doc.authority = 'native-permissions-with-owner-page-physics';
  doc.scope = 'main-world';
  doc.inputs = { move: { dx: 'world-space direction -1..1', dz: 'world-space direction -1..1', durationMs: '50..500; human input takes priority' },
    attack: { targetId: 'visible hostile entity from the current owner-page observation' }, claimLoot: 'unavailable; private inventory stays owner-controlled' };
  doc.execution = 'The live owner page applies ordinary collision, speed, targeting and combat rules. Replies distinguish accepted input from completed execution. Offline, paused or stale pages refuse control.';
  doc.inputs.commandId = 'sessionId followed by : and a fresh UUID; retries retain the same ID and exact body within that owner connection';
  doc.operations = doc.operations.map(op => ({ ...op,
    'iep:action': { '@id': op['iep:action']['@id'].replace('gaming:native-agent:', 'hallowmarch:main-world-agent:') } }));
  doc.operations.push({ '@id': doc['@id'] + '#ownerReferences', '@type': 'hydra:Operation',
    'iep:action': { '@id': 'urn:interego:hallowmarch:main-world-agent:ownerReferences' },
    'hydra:method': 'GET', 'hydra:target': doc['@id'] + '/owner', authentication: 'Fresh native owner app session',
    description: 'Read only your own game-retained public grant references. Fetch their actual current grant heads from your own pod before displaying access.' });
  return doc;
}

export async function createMainWorldAgents({ store, accounts, applicationId, audience,
  readOwnerGrantHead, resolveAgentProof, nativeCore, view, dispatch, stop,
  now = Date.now, leaseMs = 10000, requestTimeoutMs = 10000 } = {}) {
  if (!store || typeof accounts?.bindingForAccount !== 'function'
    || ![view, dispatch, stop].every(f => typeof f === 'function')) throw new TypeError('Owned main-world ports required');
  const owned = createProgressiveOwnedState({ store, streamId: 'hallowmarch-main-world-agent-authority-v1' });
  let records = await owned.start({ seed: () => ({ schema: 'hallowmarch.main-world-agent-authority/v1', references: {} }) });
  if (records?.schema !== 'hallowmarch.main-world-agent-authority/v1' || !records.references
    || Array.isArray(records.references) || Object.keys(records.references).length > 512) fail('native_world_authority_corrupt');
  let confirmedRecords = copy(records), closed = false, chain = Promise.resolve(); const rates = new Map(), sessions = new Map();
  const running = () => { const s = owned.status(); if (closed || s.error || ['conflict', 'recovering', 'closing', 'closed'].includes(s.state)) fail('native_world_authority_unavailable'); };
  function reference(id, includeRevoked = false) {
    running(); const ref = Object.hasOwn(records.references, id) ? records.references[id] : null;
    if (!ref || (!includeRevoked && ref.revoked)) fail('native_grant_unavailable'); return ref;
  }
  function binding(ref) {
    const b = accounts.bindingForAccount(ref.ownerPlayerId);
    if (!b || b.subjectDid !== ref.ownerDid) fail('native_owner_binding_unavailable'); return b;
  }
  function principal(owner) {
    const b = accounts.bindingForAccount(owner?.accountId);
    if (!b || b.subjectDid !== owner?.binding?.subjectDid || b.podUrl !== owner?.binding?.podUrl) fail('native_owner_required');
    return { accountId: owner.accountId, binding: b };
  }
  function currentScope(id, ownerDid, scope) {
    const ref = reference(id); binding(ref);
    if (ref.ownerDid !== ownerDid || !view(ref.ownerPlayerId, scope.roomId, scope.entityId)) fail('native_body_forbidden');
    return ref;
  }
  async function save(mutator) {
    const task = chain.then(async () => {
      // A permission request may retry an exact retained operation after an
      // unknown native acknowledgement. No gameplay input retries a write.
      if (owned.status().error === 'CHECKPOINT_UNCONFIRMED') await owned.checkpoint();
      running(); const next = copy(records); mutator(next); records = next;
      const selected = owned.capture(records).liveVersion;
      // Strict permission acknowledgements: reuse the retained native attempt
      // after an unknown acknowledgement, never manufacture a replacement write.
      while (owned.status().confirmedLiveVersion < selected) await owned.checkpoint();
      confirmedRecords = copy(records);
      return owned.status();
    }); chain = task.catch(() => {}); return task;
  }
  const proof = createNativeAgentProofAdapter({ applicationId, audience, nativeCore, now, leaseMs, requestTimeoutMs,
    readOwnerGrantHead: async query => {
      const head = await readOwnerGrantHead(query), ref = reference(query.grantId);
      if (head?.graphIri !== ref.graphIri || head?.grant?.id !== query.grantId) fail('native_grant_reference_mismatch');
      currentScope(query.grantId, head.grant.issuer, head.grant);
      if (head.grant.actions.includes('claimLoot')) fail('native_world_action_unavailable'); return head;
    }, resolveAgentProof });
  function authorize(body, action, path, payload) {
    running(); const authorization = proof.authorize({ sessionId: body.sessionId, signature: body.signature,
      request: { sequence: body.sequence, at: body.at, method: 'POST', path, action,
        roomId: payload.roomId, entityId: payload.entityId, body: action === 'observe' ? payload : { command: payload } } });
    const ref = currentScope(authorization.grantId, authorization.ownerDid, authorization.scope);
    if (sessions.get(body.sessionId)?.ownerSession !== view(ref.ownerPlayerId, payload.roomId, payload.entityId)?.ownerSession) {
      proof.invalidateSession(body.sessionId); fail('native_owner_page_changed');
    }
    for (const [id, r] of rates) if (now() - r.at >= 1000) rates.delete(id);
    const rate = rates.get(authorization.grantId) || { at: now(), n: 0 };
    if (++rate.n > authorization.scope.maxCommandsPerSecond) fail('native_grant_rate_limited'); rates.set(authorization.grantId, rate);
    const saved = confirmedRecords.references[authorization.grantId];
    if (!saved || saved.revoked || saved.admission?.grantDigest !== authorization.receiptRef.grantDigest) fail('native_admission_uncertain');
    return { ref, authorization };
  }
  return Object.freeze({
    references(owner) { const who = principal(owner); return Object.values(confirmedRecords.references)
      .filter(ref => ref.ownerPlayerId === who.accountId && ref.ownerDid === who.binding.subjectDid)
      .map(ref => ({ grantId: ref.grantId, graphIri: ref.graphIri, revoked: ref.revoked })); },
    lookupOwnerGrant({ grantId }) { const ref = reference(grantId); return { binding: copy(binding(ref)), graphIri: ref.graphIri }; },
    status() { return { ...proof.status(), enabled: !closed && !owned.status().error, scope: 'main-world', leaseMs, persistence: owned.status(),
      privateCharacterIncluded: false, combatAuthority: 'owner-page' }; },
    async register(owner, body) {
      const who = principal(owner);
      if (owned.status().error === 'CHECKPOINT_UNCONFIRMED') await owned.checkpoint();
      if (!exact(body, ['grantId', 'graphIri']) || !uuid(body.grantId)
        || body.graphIri !== 'urn:graph:interego:gaming:owner-agent-grant:' + body.grantId.slice(9)) fail('native_reference_only');
      const prior = records.references[body.grantId];
      if (prior && (prior.ownerPlayerId !== who.accountId || prior.ownerDid !== who.binding.subjectDid || prior.graphIri !== body.graphIri || prior.revoked)) fail('native_grant_unavailable');
      if (!prior && Object.keys(records.references).length >= 512) fail('native_reference_capacity');
      const persistence = await save(next => {
        principal(owner); const current = next.references[body.grantId];
        if (current && (current.ownerPlayerId !== who.accountId || current.ownerDid !== who.binding.subjectDid
          || current.graphIri !== body.graphIri || current.revoked)) fail('native_grant_unavailable');
        if (!current && Object.keys(next.references).length >= 512) fail('native_reference_capacity');
        next.references[body.grantId] ||= { ...body, ownerPlayerId: who.accountId, ownerDid: who.binding.subjectDid, revoked: false };
      });
      return { reference: copy(records.references[body.grantId]), authority: { scope: 'main-world', durable: true, version: persistence.confirmedVersion } };
    },
    challenge(body) { reference(body?.grantId); return proof.challenge(body); },
    async complete(body) {
      running(); const result = await proof.complete(body);
      try {
        const ref = currentScope(result.receipt.grantId, result.receipt.ownerDid, result.receipt.scope);
        const ownerSession = view(ref.ownerPlayerId, result.receipt.scope.roomId, result.receipt.scope.entityId)?.ownerSession;
        const id = result.receipt.grantId, digest = result.receipt.grantDigest;
        if (confirmedRecords.references[id]?.admission?.grantDigest !== digest) await save(next => {
          const ref = next.references[id]; if (ref.revoked) fail('native_grant_unavailable');
          ref.admission = { grantDigest: digest, receiptDigest: fingerprint(result.receipt), scope: copy(result.receipt.scope) };
        });
        if (!proof.isSessionActive(result.sessionId)) fail('native_admission_expired');
        if (ownerSession !== view(ref.ownerPlayerId, result.receipt.scope.roomId, result.receipt.scope.entityId)?.ownerSession) fail('native_owner_page_changed');
        for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
        sessions.set(result.sessionId, { ownerSession: view(records.references[id].ownerPlayerId,
          result.receipt.scope.roomId, result.receipt.scope.entityId)?.ownerSession, expiresAt: result.expiresAt });
        return { ...result, authority: { scope: 'main-world', durable: true, version: owned.status().confirmedVersion } };
      } catch (e) { proof.invalidateSession(result.sessionId); throw e; }
    },
    async renew(body) { const result = await proof.renew(body); try {
      const ref = currentScope(result.receipt.grantId, result.receipt.ownerDid, result.receipt.scope), held = sessions.get(body.sessionId);
      if (!held || held.ownerSession !== view(ref.ownerPlayerId, result.receipt.scope.roomId, result.receipt.scope.entityId)?.ownerSession) fail('native_owner_page_changed');
      held.expiresAt = result.expiresAt; return result;
    } catch (e) { proof.invalidateSession(body.sessionId); throw e; } },
    async command(body) {
      if (!exact(body, ['sessionId', 'sequence', 'at', 'signature', 'command'])
        || !['move', 'attack'].includes(body.command?.type)) fail('invalid_native_command');
      const command = copy(body.command);
      const keys = command.type === 'move' ? ['type', 'commandId', 'roomId', 'entityId', 'dx', 'dz', 'durationMs']
        : ['type', 'commandId', 'roomId', 'entityId', 'targetId'];
      if (!exact(command, keys) || typeof command.commandId !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(command.commandId)
        || !command.commandId.startsWith(body.sessionId + ':')) fail('invalid_native_command');
      if (command.type === 'move' && (![command.dx, command.dz].every(x => Number.isFinite(x) && Math.abs(x) <= 1)
        || Math.hypot(command.dx, command.dz) > 1.01 || !Number.isInteger(command.durationMs) || command.durationMs < 50 || command.durationMs > 500)) fail('invalid_native_command');
      if (command.type === 'attack' && (typeof command.targetId !== 'string' || command.targetId.length > 100)) fail('invalid_native_command');
      const { ref, authorization } = authorize(body, command.type, WORLD_AGENT_PATHS.command, command);
      return dispatch(ref.ownerPlayerId, command, { grantId: authorization.grantId, expiresAt: authorization.expiresAt });
    },
    observe(body) {
      if (!exact(body, ['sessionId', 'sequence', 'at', 'signature', 'roomId', 'entityId'])) fail('invalid_native_observation');
      const { ref } = authorize(body, 'observe', WORLD_AGENT_PATHS.observe, { roomId: body.roomId, entityId: body.entityId });
      const state = view(ref.ownerPlayerId, body.roomId, body.entityId);
      return { roomId: body.roomId, entityId: body.entityId, state: copy(state), authority: 'owner-page-observation' };
    },
    async revoke(owner, body) {
      const who = principal(owner); if (!exact(body, ['grantId'])) fail('native_reference_only');
      if (owned.status().error === 'CHECKPOINT_UNCONFIRMED') await owned.checkpoint();
      const ref = reference(body.grantId, true); if (ref.ownerPlayerId !== who.accountId || ref.ownerDid !== who.binding.subjectDid) fail('native_owner_required');
      proof.revoke(body.grantId); rates.delete(body.grantId); stop(who.accountId, body.grantId);
      const persistence = await save(next => { next.references[body.grantId].revoked = true; });
      return { grantId: body.grantId, revoked: true, ownerPodRevocation: 'requires-owner-publication', authority: { scope: 'main-world', durable: true, version: persistence.confirmedVersion } };
    },
    async close() { closed = true; proof.close(); rates.clear(); sessions.clear(); await chain; return owned.shutdown({ timeoutMs: 14000 }); },
  });
}
