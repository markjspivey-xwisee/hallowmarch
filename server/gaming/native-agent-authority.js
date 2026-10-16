/** Native proof -> game authority composition. Native reads occur only at
 * admission/renewal. The internal room permit never leaves this module and
 * cannot authorize its native grant without a current verified proof lease. */
import { createHash } from 'node:crypto';
import { createNativeAgentProofAdapter } from './native-agent-proof.js';

export const NATIVE_AGENT_PATHS = Object.freeze(Object.fromEntries(
  ['register', 'challenge', 'complete', 'renew', 'command', 'observe', 'revoke'].map(name => [name, '/gaming/native-agent/' + name])));
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const copy = value => structuredClone(value);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export class NativeAgentAuthorityError extends Error {
  constructor(code) { super(code); this.name = 'NativeAgentAuthorityError'; this.code = code; }
}
const fail = code => { throw new NativeAgentAuthorityError(code); };
const exact = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));

/** accounts is the trusted native account host, never a caller DID resolver.
 * All methods except proof requests are privileged server ports. Wire access
 * must use createNativeAgentHttp so owner mutations require a fresh app proof. */
export function createNativeAgentAuthority(options = {}) {
  const { gaming, accounts, now = Date.now } = options;
  if (!gaming?.manifest || typeof accounts?.bindingForAccount !== 'function'
    || typeof options.readOwnerGrantHead !== 'function' || typeof options.resolveAgentProof !== 'function') {
    throw new TypeError('Native agent authority requires verified account and native read ports');
  }
  const maxSessions = options.maxSessions ?? 256, leases = new Map(), permits = new Map(), rates = new Map(); let closed = false;
  const room = () => { if (closed || !gaming.room || !gaming.manifest().enabled) fail('native_game_unavailable'); return gaming.room; };
  const prune = () => {
    for (const [id, lease] of leases) if (lease.expiresAt <= now()) leases.delete(id);
    for (const [id, permit] of permits) if (permit.expiresAt <= now()) permits.delete(id);
    for (const [id, rate] of rates) if (rate.lastAt <= now() - 1000) rates.delete(id);
  };
  function limitGrant(authorization) {
    const time = now(), rate = rates.get(authorization.grantId) || { lastAt: time, times: [] };
    if (time < rate.lastAt) fail('native_agent_clock_regressed');
    rate.times = rate.times.filter(at => at > time - 1000);
    if (rate.times.length >= authorization.scope.maxCommandsPerSecond) fail('native_grant_rate_limited');
    rate.lastAt = time; rate.times.push(time); rates.set(authorization.grantId, rate);
  }
  function reference(grantId) {
    const records = room().current.companions.nativeReferences;
    const ref = records && Object.hasOwn(records, grantId) ? records[grantId] : null;
    if (!ref || ref.revoked) fail('native_grant_unavailable'); return ref;
  }
  function ownerPrincipal(owner) {
    if (!plain(owner) || typeof owner.accountId !== 'string' || !plain(owner.binding)) fail('native_owner_required');
    const binding = accounts.bindingForAccount(owner.accountId), entity = room().current.entities[owner.accountId];
    if (!binding || binding.subjectDid !== owner.binding.subjectDid || binding.podUrl !== owner.binding.podUrl
      || entity?.kind !== 'player' || entity.ownerPlayerId !== owner.accountId) fail('native_owner_required');
    return { playerId: owner.accountId, verifiedDid: binding.subjectDid, realmId: entity.realmId, name: entity.name || 'Traveller' };
  }
  function lookupOwnerGrant({ grantId }) {
    const ref = reference(grantId), binding = accounts.bindingForAccount(ref.ownerPlayerId);
    if (!binding || binding.subjectDid !== ref.ownerDid) fail('native_owner_binding_unavailable');
    return { binding: copy(binding), graphIri: ref.graphIri };
  }
  function ownerForGrant(grantId, expectedOwnerDid, scope) {
    const ref = reference(grantId), binding = accounts.bindingForAccount(ref.ownerPlayerId);
    if (!binding || binding.subjectDid !== ref.ownerDid || ref.ownerDid !== expectedOwnerDid) fail('native_owner_binding_unavailable');
    const principal = ownerPrincipal({ accountId: ref.ownerPlayerId, binding }), body = room().current.entities[scope.entityId];
    if (scope.roomId !== room().id || !body || body.ownerPlayerId !== principal.playerId || !['player', 'companion'].includes(body.kind)) fail('native_body_forbidden');
    return principal;
  }
  const proof = createNativeAgentProofAdapter({ ...options, maxSessions,
    readOwnerGrantHead: async query => {
      const head = await options.readOwnerGrantHead(query);
      const ref = reference(query.grantId);
      if (head?.grant?.id !== query.grantId || head.graphIri !== ref.graphIri) fail('native_grant_reference_mismatch');
      ownerForGrant(query.grantId, head.grant.issuer, head.grant);
      return head;
    }, resolveAgentProof: options.resolveAgentProof });
  function session(id) { prune(); room(); const value = leases.get(id); if (!value) fail('native_agent_session_unavailable'); return value; }
  const revokeLeases = grantId => {
    proof.revoke(grantId);
    permits.delete(grantId); rates.delete(grantId);
    for (const [id, lease] of leases) if (lease.grantId === grantId) leases.delete(id);
  };
  return Object.freeze({ lookupOwnerGrant,
    status() { prune(); return { enabled: !closed && !!gaming.room, ...proof.status(), activeAuthoritySessions: leases.size }; },
    async register(owner, body) {
      if (!exact(body, ['grantId', 'graphIri'])) fail('native_reference_only');
      const principal = ownerPrincipal(owner);
      const result = await room().execute(principal, { type: 'registerNativeCompanion', ...body,
        commandId: 'native-register:' + hash([principal.playerId, body]) });
      return { reference: result.result.reference, authority: { roomId: room().id, version: result.version, durable: true } };
    },
    challenge(body) {
      room(); reference(body?.grantId);
      // A retained local UUID revocation is an explicit authority refusal,
      // distinguishable from failed native reads and without any peer I/O.
      return proof.challenge(body);
    },
    async complete(body) {
      prune(); room(); if (leases.size >= maxSessions) fail('native_agent_session_capacity');
      const admitted = await proof.complete(body);
      try {
        const principal = ownerForGrant(admitted.receipt.grantId, admitted.receipt.ownerDid, admitted.receipt.scope);
        let permit = permits.get(admitted.receipt.grantId);
        let authority = permit?.grantDigest === admitted.receipt.grantDigest ? room().nativePermitReceipt(permit.token, admitted.receipt) : null;
        if (!authority) {
          const result = await room().admitNativeCompanion(principal, admitted.receipt, 'native-admit:' + hash(admitted.sessionId));
          if (typeof result.result.token !== 'string') fail('native_admission_uncertain');
          for (const [id, lease] of leases) if (lease.grantId === admitted.receipt.grantId) { leases.delete(id); proof.invalidateSession(id); }
          permit = { token: result.result.token, grantDigest: admitted.receipt.grantDigest, expiresAt: Date.parse(admitted.receipt.grantExpiresAt) };
          permits.set(admitted.receipt.grantId, permit);
          authority = { roomId: room().id, version: result.version, durable: true };
        }
        if (admitted.expiresAt <= now() || !proof.isSessionActive(admitted.sessionId)) fail('native_admission_expired');
        // Only this private memory map sees the internal permit. Room receipts
        // persist its hash, the owner-pod reference and scope, never the permit.
        leases.set(admitted.sessionId, { token: permit.token, grantId: admitted.receipt.grantId, expiresAt: admitted.expiresAt });
        return { ...admitted, authority };
      } catch (error) { proof.invalidateSession(admitted.sessionId); throw error; }
    },
    async renew(body) {
      const lease = session(body?.sessionId);
      try {
        const renewed = await proof.renew(body);
        ownerForGrant(renewed.receipt.grantId, renewed.receipt.ownerDid, renewed.receipt.scope);
        // The receipt is immutable for a grant digest; renewal only updates
        // transient evidence age, not durable authority or owner permissions.
        lease.expiresAt = renewed.expiresAt; return renewed;
      } catch (error) { leases.delete(body?.sessionId); proof.invalidateSession(body?.sessionId); throw error; }
    },
    async command(body) {
      if (!exact(body, ['sessionId', 'sequence', 'at', 'signature', 'command']) || !plain(body.command)
        || !['move', 'attack', 'claimLoot'].includes(body.command.type)) fail('invalid_native_command');
      const lease = session(body.sessionId), command = copy(body.command);
      const request = { sequence: body.sequence, at: body.at, method: 'POST', path: NATIVE_AGENT_PATHS.command,
        action: command.type, roomId: command.roomId, entityId: command.entityId, body: { command } };
      const authorization = proof.authorize({ sessionId: body.sessionId, request, signature: body.signature });
      limitGrant(authorization);
      return room().executeNativeAgent(lease.token, command, authorization);
    },
    async observe(body) {
      if (!exact(body, ['sessionId', 'sequence', 'at', 'signature', 'roomId', 'entityId'])) fail('invalid_native_observation');
      const lease = session(body.sessionId), request = { sequence: body.sequence, at: body.at, method: 'POST', path: NATIVE_AGENT_PATHS.observe,
        action: 'observe', roomId: body.roomId, entityId: body.entityId, body: { roomId: body.roomId, entityId: body.entityId } };
      const authorization = proof.authorize({ sessionId: body.sessionId, request, signature: body.signature });
      limitGrant(authorization);
      return room().observeNativeAgent(lease.token, body.entityId, authorization);
    },
    async revoke(owner, body) {
      if (!exact(body, ['grantId'])) fail('native_reference_only');
      const principal = ownerPrincipal(owner), records = room().current.companions.nativeReferences;
      const ref = records && Object.hasOwn(records, body.grantId) ? records[body.grantId] : null;
      if (!ref) fail('native_grant_unavailable');
      if (ref.ownerPlayerId !== principal.playerId || ref.ownerDid !== principal.verifiedDid) fail('native_owner_required');
      // Local stop precedes slow CAS. A successful reply confirms durable game
      // revocation. Owner-pod revoked:true publication is a separate operation.
      revokeLeases(body.grantId);
      const result = await room().execute(principal, { type: 'revokeNativeCompanion', grantId: body.grantId,
        commandId: 'native-revoke:' + hash([principal.playerId, body.grantId]) });
      return { ...result.result, ownerPodRevocation: 'requires-owner-publication', authority: { roomId: room().id, version: result.version, durable: true } };
    },
    close() { closed = true; leases.clear(); permits.clear(); rates.clear(); proof.close(); },
  });
}
