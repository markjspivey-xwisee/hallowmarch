/** Native delegation for the existing March. The owner page runs its ordinary
 * physics/combat; this bridge authenticates and dispatches bounded inputs. An
 * accepted input is never described as a server-verified combat outcome. */
import { createHash } from 'node:crypto';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { createNativeAgentProofAdapter } from './native-agent-proof.js';
import { NativeAgentAuthorityError } from './native-agent-authority.js';
import { nativeAgentAffordances } from './native-agent-http.js';
import { GAMEPLAY_ACTIVITY_PROFILE, GAMEPLAY_ACTIVITY_PROFILE_VERSION, GAMEPLAY_MILESTONES, GAMEPLAY_INTERVENTIONS } from '../../client/native-pod/gameplay-activity.mjs';

export const WORLD_AGENT_PATHS = Object.freeze(Object.fromEntries(
  ['register', 'challenge', 'complete', 'renew', 'command', 'observe', 'revoke'].map(op => [op, '/world/native-agent/' + op])));
const copy = value => structuredClone(value);
const fail = code => { throw new NativeAgentAuthorityError(code); };
const exact = (o, keys) => o && typeof o === 'object' && !Array.isArray(o)
  && Object.keys(o).length === keys.length && keys.every(k => Object.hasOwn(o, k));
const uuid = value => /^urn:uuid:[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const fingerprint = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const REVOCATION_SCHEMA = 'hallowmarch.main-world-agent-revocation/v1';
const revocationStream = id => 'hallowmarch-main-world-agent-revocation-v1:' + id;

export function mainWorldAgentAffordances(options) {
  const base = nativeAgentAffordances(options);
  const doc = JSON.parse(JSON.stringify(base).replaceAll('/gaming/native-agent', '/world/native-agent'));
  doc.authority = 'native-permissions-with-owner-page-physics';
  doc.scope = 'main-world';
  doc.performanceSupport = {
    resourcesDescriptor: new URL('/gaming/resources/descriptor.ttl', doc.audience).href,
    activityProfile: new URL('/gaming/activity-profile.jsonld', doc.audience).href,
    activityProfileCanonical: GAMEPLAY_ACTIVITY_PROFILE,
    activityProfileVersion: GAMEPLAY_ACTIVITY_PROFILE_VERSION,
    activityModule: new URL('/gaming/identity/assets/gameplay-activity.mjs', doc.audience).href,
    activityArchiveModule: new URL('/gaming/identity/assets/gameplay-activity-archive.mjs', doc.audience).href,
    consultingDescriptor: 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance',
    methodologyCatalog: 'https://foxxi-bridge.interego.xwisee.com/performance/methods',
    agentSessionModule: new URL('/gaming/identity/assets/agent-own-session.mjs', doc.audience).href,
    agentSessionGuide: 'https://github.com/markjspivey-xwisee/hallowmarch/blob/main/client/native-pod/agent-own-session.README.md',
    subjectPolicy: 'Consult using the performer’s own authenticated Interego identity and pod with task-scoped consent. A game control grant does not authorize personal consultation or access to the player’s journal.',
    observationPolicy: 'Only the granted body’s public observation is available to a game agent. Label it owner-page observation; it is not a verified combat, learning or competency outcome.',
    activity: { storage: 'encrypted-observing-owner-pod', source: 'owner-browser-observation', actor: 'authenticated-observing-owner',
      controllerIdentity: 'context-only', competencyStatus: 'not-assessed', lrsConformanceClaim: false,
      scope: 'Observed gameplay, game milestone counts and support attempts. A control grant does not create an independent agent performance record or authorize private history access.' },
    milestoneCatalog: { scope: 'observed-game-progress', milestones: copy(GAMEPLAY_MILESTONES), interventions: copy(GAMEPLAY_INTERVENTIONS),
      evidencePolicy: 'Game progress and started support do not establish learning, mastery or an intervention effect.' },
  };
  doc.agentClient = { module: doc.audience + '/world/agent-client.mjs', export: 'createWorldAgentClient',
    runtime: 'WebCrypto Ed25519 and fetch; Node 22+ or same-origin trusted browser host',
    nativeSigning: 'Caller-supplied sign_request({payload}) returns only the native signed envelope; never a human bearer.',
    integrationGuide: 'https://github.com/markjspivey-xwisee/hallowmarch/blob/main/docs/main-world-agent-client.md', testedProviders: [],
    scope: 'Owner-selected separate AI party unit or owned animal. The human character remains player-controlled. The owner page must remain connected and active.' };
  doc.bodySelection = { default: 'separate-owned-party-unit',
    options: ['separate-owned-party-unit', 'owned-animal'],
    selection: 'Players → Your AI party member; Connect an AI agent · advanced host setup',
    humanPriority: 'The human keeps their own character. Human input, pause, focus and revocation retain priority over native control.',
    execution: 'Ordinary owner-page game physics and combat; no independent avatar or offline owner-page execution.' };
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
    || Array.isArray(records.references) || Object.keys(records.references).length > 512
    || (records.reclaimCursor !== undefined && (!Number.isInteger(records.reclaimCursor) || records.reclaimCursor < 0 || records.reclaimCursor >= 512))) fail('native_world_authority_corrupt');
  let confirmedRecords = copy(records), closed = false, chain = Promise.resolve(), retirementRead = null; const rates = new Map(), sessions = new Map(), revoking = new Set();
  const running = () => { const s = owned.status(); if (closed || s.error || ['conflict', 'recovering', 'closing', 'closed'].includes(s.state)) fail('native_world_authority_unavailable'); };
  function reference(id) {
    running(); const ref = Object.hasOwn(records.references, id) ? records.references[id] : null;
    if (!ref || ref.revoked || revoking.has(id)) fail('native_grant_unavailable'); return ref;
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
      running(); const next = copy(records); await mutator(next); records = next;
      const selected = owned.capture(records).liveVersion;
      // Strict permission acknowledgements: reuse the retained native attempt
      // after an unknown acknowledgement, never manufacture a replacement write.
      while (owned.status().confirmedLiveVersion < selected) await owned.checkpoint();
      confirmedRecords = copy(records);
      return owned.status();
    }); chain = task.catch(() => {}); return task;
  }
  async function archivedRevocation(id) {
    const result = await store.load(revocationStream(id));
    if (result?.version === 0 && result.state === null) return null;
    const state = result?.state;
    if (result?.version !== 1 || !exact(state, ['schema', 'grantId', 'graphIri', 'ownerPlayerId', 'ownerDid', 'revoked'])
      || state.schema !== REVOCATION_SCHEMA || state.grantId !== id || state.revoked !== true
      || state.graphIri !== 'urn:graph:interego:gaming:owner-agent-grant:' + id.slice(9)
      || typeof state.ownerPlayerId !== 'string' || !state.ownerPlayerId || typeof state.ownerDid !== 'string' || !state.ownerDid) {
      fail('native_world_authority_corrupt');
    }
    return state;
  }
  async function archiveRevocation(ref) {
    if (!uuid(ref?.grantId) || ref.graphIri !== 'urn:graph:interego:gaming:owner-agent-grant:' + ref.grantId.slice(9)
      || ref.revoked !== true || typeof ref.ownerPlayerId !== 'string' || !ref.ownerPlayerId
      || typeof ref.ownerDid !== 'string' || !ref.ownerDid) fail('native_world_authority_corrupt');
    const state = { schema: REVOCATION_SCHEMA, grantId: ref.grantId, graphIri: ref.graphIri,
      ownerPlayerId: ref.ownerPlayerId, ownerDid: ref.ownerDid, revoked: true };
    const prior = await archivedRevocation(ref.grantId);
    if (prior) {
      if (Object.keys(state).some(key => prior[key] !== state[key])) fail('native_world_authority_corrupt');
      return;
    }
    // The exact immutable operation is retained by the native store, including
    // after a lost acknowledgement or restart. Never free an index slot first.
    const result = await store.commit(revocationStream(ref.grantId), {
      expectedVersion: 0, state, event: null, idempotencyKey: 'main-world-agent-revocation-v1' });
    if (result?.version !== 1 || !exact(result.state, Object.keys(state)) || Object.keys(state).some(key => result.state[key] !== state[key])) fail('native_revocation_uncertain');
  }
  async function retirementHead(id) {
    // One bounded inspection per capacity request, and at most one surviving
    // read if an injected native port ignores cancellation.
    if (retirementRead) return null;
    const controller = new AbortController(); let timer;
    const task = Promise.resolve().then(() => readOwnerGrantHead({ grantId: id, signal: controller.signal }));
    retirementRead = task;
    task.then(() => { if (retirementRead === task) retirementRead = null; }, () => { if (retirementRead === task) retirementRead = null; });
    try { return await Promise.race([task, new Promise(resolve => {
      timer = setTimeout(() => { controller.abort(); resolve(null); }, requestTimeoutMs);
    })]); } catch { return null; }
    finally { clearTimeout(timer); controller.abort(); }
  }
  async function reclaimReference(next) {
    const ids = Object.keys(next.references).sort(), cursor = next.reclaimCursor || 0;
    const expired = ids.findIndex((id, i) => i >= cursor && !next.references[id].revoked
      && Date.parse(next.references[id].verifiedGrantExpiresAt) <= now());
    const index = expired >= 0 ? expired : cursor % ids.length, id = ids[index], ref = next.references[id];
    next.reclaimCursor = (index + 1) % ids.length;
    if (ref.grantId !== id) fail('native_world_authority_corrupt');
    // A prior natural retirement may have committed its tombstone just before
    // index checkpoint acknowledgement was lost. It remains authoritative.
    if (!ref.revoked && await archivedRevocation(id)) { blockGrant(id, ref.ownerPlayerId); delete next.references[id]; return id; }
    let head; try { binding(ref); head = await retirementHead(id); } catch { return; }
    if (head?.graphIri !== ref.graphIri || head?.grant?.id !== id || head.grant.issuer !== ref.ownerDid
      || head.grant.schema !== 'interego.gaming.owner-agent-grant/v1' || head.grant.applicationId !== applicationId || head.grant.audience !== audience
      || !Number.isSafeInteger(head.observedAt) || head.observedAt > now() || head.observedAt < now() - requestTimeoutMs) return;
    const expiresAt = typeof head.grant.expiresAt === 'string' && head.grant.expiresAt.length <= 64 ? Date.parse(head.grant.expiresAt) : NaN;
    if (Number.isFinite(expiresAt)) ref.verifiedGrantExpiresAt = head.grant.expiresAt;
    // Explicit stops stay discoverable until the owner finishes pod revocation.
    // Natural expiry can retire an active pointer; the UUID tombstone prevents
    // any later owner extension from resurrecting that retired relationship.
    if (head.grant.revoked !== true && (ref.revoked || !(Number.isFinite(expiresAt) && expiresAt <= now()))) return;
    blockGrant(id, ref.ownerPlayerId);
    await archiveRevocation({ ...ref, revoked: true }); delete next.references[id]; return id;
  }
  function blockGrant(id, ownerPlayerId) {
    revoking.add(id);
    for (const [sessionId, session] of sessions) if (session.grantId === id) { proof.invalidateSession(sessionId); sessions.delete(sessionId); }
    rates.delete(id); stop(ownerPlayerId, id);
  }
  const proof = createNativeAgentProofAdapter({ applicationId, audience, nativeCore, now, leaseMs, requestTimeoutMs,
    readOwnerGrantHead: async query => {
      reference(query.grantId);
      if (await archivedRevocation(query.grantId)) fail('native_grant_unavailable');
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
    lookupOwnerGrant({ grantId }) {
      // Native readback must also reach stopped grants to confirm their owner's
      // pod publication. Proof admission separately enforces reference().
      running(); const ref = records.references[grantId]; if (!ref) fail('native_grant_unavailable');
      return { binding: copy(binding(ref)), graphIri: ref.graphIri };
    },
    status() { return { ...proof.status(), enabled: !closed && !owned.status().error, scope: 'main-world', leaseMs, persistence: owned.status(),
      privateCharacterIncluded: false, combatAuthority: 'owner-page' }; },
    async register(owner, body) {
      const who = principal(owner);
      if (owned.status().error === 'CHECKPOINT_UNCONFIRMED') await owned.checkpoint();
      if (!exact(body, ['grantId', 'graphIri']) || !uuid(body.grantId)
        || body.graphIri !== 'urn:graph:interego:gaming:owner-agent-grant:' + body.grantId.slice(9)) fail('native_reference_only');
      const prior = records.references[body.grantId];
      if (prior && (prior.ownerPlayerId !== who.accountId || prior.ownerDid !== who.binding.subjectDid || prior.graphIri !== body.graphIri || prior.revoked)) fail('native_grant_unavailable');
      let atCapacity = false, reclaimed = null;
      const persistence = await save(async next => {
        if (revoking.has(body.grantId) || await archivedRevocation(body.grantId)) fail('native_grant_unavailable');
        if (!next.references[body.grantId] && Object.keys(next.references).length >= 512) reclaimed = await reclaimReference(next);
        principal(owner); if (revoking.has(body.grantId)) fail('native_grant_unavailable');
        const current = next.references[body.grantId];
        if (current && (current.ownerPlayerId !== who.accountId || current.ownerDid !== who.binding.subjectDid
          || current.graphIri !== body.graphIri || current.revoked)) fail('native_grant_unavailable');
        if (!current && Object.keys(next.references).length >= 512) { atCapacity = true; return; }
        next.references[body.grantId] ||= { ...body, ownerPlayerId: who.accountId, ownerDid: who.binding.subjectDid, revoked: false };
      });
      if (reclaimed) revoking.delete(reclaimed);
      if (atCapacity) fail('native_reference_capacity');
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
          const ref = next.references[id]; if (!ref || ref.revoked || revoking.has(id)) fail('native_grant_unavailable');
          ref.verifiedGrantExpiresAt = result.receipt.grantExpiresAt;
          ref.admission = { grantDigest: digest, receiptDigest: fingerprint(result.receipt), scope: copy(result.receipt.scope) };
        });
        currentScope(id, result.receipt.ownerDid, result.receipt.scope);
        if (!proof.isSessionActive(result.sessionId)) fail('native_admission_expired');
        if (ownerSession !== view(ref.ownerPlayerId, result.receipt.scope.roomId, result.receipt.scope.entityId)?.ownerSession) fail('native_owner_page_changed');
        for (const [id, session] of sessions) if (session.expiresAt <= now()) sessions.delete(id);
        sessions.set(result.sessionId, { grantId: id, ownerSession: view(records.references[id].ownerPlayerId,
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
      return dispatch(ref.ownerPlayerId, command, { grantId: authorization.grantId, expiresAt: authorization.expiresAt,
        sessionId: body.sessionId, isSessionActive: () => proof.isSessionActive(body.sessionId) });
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
      if (!uuid(body.grantId)) fail('native_reference_only');
      running();
      const ref = records.references[body.grantId] || await archivedRevocation(body.grantId);
      if (!ref) fail('native_grant_unavailable');
      if (ref.ownerPlayerId !== who.accountId || ref.ownerDid !== who.binding.subjectDid) fail('native_owner_required');
      // This permanent admission gate replaces the proof adapter's temporary
      // one-hour tombstones. Existing leases stop now; pending completions are
      // refused by reference/currentScope before they can return authority.
      blockGrant(body.grantId, who.accountId);
      if (records.references[body.grantId]) await save(next => { const current = next.references[body.grantId]; if (current) current.revoked = true; });
      const persistence = await save(async next => {
        const current = next.references[body.grantId];
        if (current) await archiveRevocation(current);
      });
      revoking.delete(body.grantId);
      return { grantId: body.grantId, revoked: true, ownerPodRevocation: 'requires-owner-publication', authority: { scope: 'main-world', durable: true, version: persistence.confirmedVersion } };
    },
    async close() { closed = true; proof.close(); rates.clear(); sessions.clear(); revoking.clear(); await chain; return owned.shutdown({ timeoutMs: 14000 }); },
  });
}
