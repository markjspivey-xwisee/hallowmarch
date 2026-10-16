import { randomUUID } from 'node:crypto';
import { AuthoritativeRoom, GameCommandError } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { projectGamingEvents, isFoxxiXapiAction } from './learning.js';
import { createLearningOutbox } from './outbox.js';

/** Bind a domain to the existing authenticated transport. An absent store leaves
 * this capability disabled; it never substitutes local files or human pod keys.
 */
export function createGamingRuntime({ store = null, send, clock = Date.now, domain = createHallowmarchDomain(), roomId = 'march-proof', learningSink = null,
  persistenceMode = 'strict', checkpointIntervalMs = 1000, broadcastIntervalMs = 50, verifiedDidFor = () => null, requireVerifiedPlayers = false,
  learningDeliveryAvailable = null, requireNativeAgents = requireVerifiedPlayers } = {}) {
  if (!Number.isSafeInteger(broadcastIntervalMs) || broadcastIntervalMs < 1 || broadcastIntervalMs > 1000) throw new TypeError('Bounded snapshot interval required.');
  let room = null, failure = store ? 'initializing' : 'native-service-unconfigured', stopping = false;
  const evidenceDomain = domain.evidenceDomain || domain.id;
  // Supplied only by a trusted, verified owner-pod composition; a transport or
  // OAuth identity alone is insufficient. This port must be synchronous/local:
  // game commands never await a learning service's availability probe.
  const deliveryConfigured = typeof learningDeliveryAvailable === 'function' && typeof learningSink?.publish === 'function'
    && isFoxxiXapiAction(learningSink?.descriptor?.action) && learningSink.descriptor.method === 'POST'
    && typeof learningSink.descriptor.target === 'string' && /^https:\/\//.test(learningSink.descriptor.target) && !/[{}]/.test(learningSink.descriptor.target);
  const deliveryAvailable = context => deliveryConfigured && context.recipient === learningSink.descriptor.target
    && learningDeliveryAvailable(context);
  const clients = new Map(), pending = new Map(); let outbox = null, broadcastTimer = null;
  const manifest = () => ({ schemaVersion: 1, enabled: !!room, status: room ? 'ready' : failure,
    domain: domain.id, roomId, scope: 'shared-expedition', worldMigration: false, requiresVerifiedPlayers: requireVerifiedPlayers === true,
    learningExport: deliveryConfigured ? 'requires-verified-owner-pod-delivery-and-session-consent' : 'unavailable',
    learningExportConfigured: deliveryConfigured,
    companionRoles: ['teammate', 'pet', 'coach'], nativeAgentsRequired: requireNativeAgents === true,
    vocabulary: '/gaming/vocabulary', domainVocabulary: '/gaming/hallowmarch-vocabulary',
    resources: { catalog: '/gaming/resources', descriptor: '/gaming/resources/descriptor.ttl', useDoesNotEstablishMastery: true },
    transport: { websocket: '/ws', messageType: 'gaming', commandAuthority: 'server', persistenceMode,
      durableAcknowledgements: persistenceMode !== 'realtime', progressivePersistence: persistenceMode === 'realtime',
      ...(persistenceMode === 'realtime' ? { maxSnapshotHz: 1000 / broadcastIntervalMs } : {}) },
    ...(room ? { version: room.version } : {}) });
  const snapshot = async (client, refresh = false) => {
    const principal = clients.has(client) ? principalOf(client) : null;
    if (principal && client.ws?.readyState === 1) {
      const state = refresh ? await room.observe(principal) : room.observeCommitted(principal);
      send(client, { t: 'gaming', op: 'snapshot', roomId: state.roomId, version: state.version,
        ...(state.persistence ? { liveSequence: state.liveSequence, durableSequence: state.durableSequence,
          durableVersion: state.durableVersion, persistence: state.persistence } : {}), state });
    }
  };
  const broadcast = () => {
    broadcastTimer = null;
    for (const client of clients.keys()) void snapshot(client).catch(() => clients.delete(client));
  };
  const scheduleBroadcast = () => {
    if (persistenceMode !== 'realtime') { broadcast(); return; }
    // Coalesce a burst of inputs into one latest-state packet per client. The
    // simulation and action response never wait for this bounded fan-out rate.
    if (broadcastTimer || stopping) return;
    broadcastTimer = setTimeout(broadcast, broadcastIntervalMs); broadcastTimer.unref?.();
  };
  const ready = (async () => {
    if (!store) return;
    try {
      await store.ready?.();
      const candidate = await new AuthoritativeRoom({ roomId, store, domain, clock, persistenceMode, checkpointIntervalMs,
        learningDeliveryAvailable: deliveryAvailable }).open();
      candidate.subscribe(scheduleBroadcast);
      room = candidate; failure = '';
      const guardedSink = deliveryConfigured ? { descriptor: learningSink.descriptor,
        async publish(events, context) {
          const consent = (await room.learningContext(1)).consent[context.actorId];
          if (!room.learningDeliveryAvailable({ ...context, actorDid: consent?.actorDid,
            recipient: consent?.recipient, now: clock(), phase: 'delivery' })) {
            return { ok: false, reason: 'owner-pod-delivery-unavailable', exported: 0 };
          }
          return learningSink.publish(events, context);
        } } : null;
      outbox = createLearningOutbox({ sink: guardedSink, domain: evidenceDomain, gameId: roomId, now: clock,
        getEntries: async ({ limit }) => (await room.learningContext(limit)).outbox,
        getConsent: async ({ actorId }) => (await room.learningContext(1)).consent[actorId],
        acknowledge: data => room.acknowledgeLearning(data) });
    } catch { failure = 'native-service-unavailable'; }
  })();
  function principalOf(c) {
    if (!c.acct?.id) throw new GameCommandError('unauthenticated', 'Sign in to enter the expedition.');
    if (![0, 1, 2].includes(c.realm)) throw new GameCommandError('realm_required', 'Start your character first.');
    const verifiedDid = verifiedDidFor(c);
    if (requireVerifiedPlayers && !(typeof verifiedDid === 'string' && verifiedDid.startsWith('did:'))) {
      throw new GameCommandError('native_identity_required', 'Reconnect your Interego identity before entering the expedition.');
    }
    return { playerId: c.acct.id, realmId: String(c.realm), name: c.slow?.dn || c.slow?.n || c.acct.name || 'Traveller',
      ...(typeof verifiedDid === 'string' && verifiedDid.startsWith('did:') ? { verifiedDid } : {}) };
  }
  async function handle(c, message) {
    const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128 ? message.requestId : '';
    const count = pending.get(c) || 0;
    if (count >= 8) { send(c, { t: 'gaming', op: 'result', requestId, ok: false, error: { code: 'busy', message: 'Too many pending game commands.' } }); return; }
    pending.set(c, count + 1);
    try {
      if (stopping) throw new GameCommandError('restarting', 'The server is saving before a restart. Reconnect in a moment.');
      if (!room) throw new GameCommandError('unavailable', 'Shared expeditions are waiting for their native game service.');
      let principal, command, result;
      if (message.op === 'agent.command' || message.op === 'agent.observe') {
        if (requireNativeAgents) throw new GameCommandError('native_agent_proof_required', 'Use the native agent proof affordance.');
        if (typeof message.token !== 'string' || message.token.length > 100) throw new GameCommandError('invalid_capability', 'A companion capability is required.');
        principal = { kind: 'agent', token: message.token, entityId: message.command?.entityId || message.entityId };
        if (message.op === 'agent.observe') {
          // Transport rate limit covers observation without changing canonical state.
          const time = clock(); if (time - (c.gamingObserveAt || 0) < 100) throw new GameCommandError('rate_limited', 'Observe at most ten times per second.');
          c.gamingObserveAt = time; result = await room.observe(principal); c.gamingAgent = true;
        } else { result = await room.execute(principal, message.command); c.gamingAgent = true; }
      } else {
        principal = principalOf(c);
        if (message.op === 'enter') {
          result = await room.execute(principal, { type: 'join', commandId: requestId || randomUUID() }); if (c.ws?.readyState === 1) { clients.set(c, principal); await snapshot(c); }
        } else if (message.op === 'leave') { clients.delete(c); result = { left: true }; }
        else {
          if (!clients.has(c)) throw new GameCommandError('not_joined', 'Enter the expedition first.');
          if (message.op === 'observe') { await snapshot(c, true); result = { version: room.version }; }
          else {
            if (message.op === 'command') command = message.command;
            else if (message.op === 'grant') command = { type: 'grantCompanion', request: message.request, commandId: message.commandId || requestId };
            else if (message.op === 'revoke') command = { type: 'revokeCompanion', grantId: message.grantId, commandId: message.commandId || requestId };
            else if (message.op === 'consent') command = { type: 'learningConsent', enabled: message.enabled, actorDid: message.actorDid,
              recipient: message.recipient, expiresAt: message.expiresAt, sessionId: message.sessionId, commandId: requestId };
            else throw new GameCommandError('unknown_operation', 'Unsupported game operation.');
            if (requireNativeAgents && ['grantCompanion', 'revokeCompanion'].includes(command?.type)) {
              throw new GameCommandError('native_agent_grant_required', 'Publish an owner-pod native companion grant first.');
            }
            // Native admission is a privileged bridge port; wire payloads never
            // supply a verified receipt or a trusted native relationship.
            if (['registerNativeCompanion', 'admitNativeCompanion', 'revokeNativeCompanion'].includes(command?.type)) {
              throw new GameCommandError('native_agent_bridge_required', 'Use the native companion affordance.');
            }
            result = await room.execute(principal, command);
          }
        }
      }
      send(c, { t: 'gaming', op: 'result', requestId, ok: true, result });
    } catch (error) {
      // Known command failures are safe product messages. Never relay SDK/auth or network exception text.
      const known = ['GameCommandError', 'CompanionError'].includes(error.name);
      send(c, { t: 'gaming', op: 'result', requestId, ok: false, error: { code: known ? error.code : 'durability_unavailable', message: known ? error.message : 'Saving is delayed. Check the encounter status before retrying.' } });
    } finally { const n = (pending.get(c) || 1) - 1; if (n) pending.set(c, n); else pending.delete(c); }
  }
  return { ready, manifest, handle, shutdown() {
      stopping = true; if (broadcastTimer) { clearTimeout(broadcastTimer); broadcastTimer = null; }
      return room?.close ? room.close() : Promise.resolve({ durable: !!room }); },
    flushPersistence() { return room?.flushPersistence ? room.flushPersistence() : Promise.resolve({ durable: !!room }); },
    flushLearning() { return outbox ? outbox.flush() : Promise.resolve({ ok: false, reason: 'native-service-unavailable' }); }, close(c) { clients.delete(c); pending.delete(c); },
    metrics() { return room ? { ...room.stats, version: room.version, playerConnections: clients.size, eventWindow: room.current.events.length,
      learningExport: { configured: deliveryConfigured, pending: room.current.outbox.length,
        captureGaps: structuredClone(room.current.learningCaptureGaps || { total: 0 }) },
      ...(room.persistenceStatus ? { persistence: room.persistenceStatus() } : {}),
      performance: projectGamingEvents(room.current.events, { domain: evidenceDomain, gameId: roomId }).scopes.game } : null; },
    get room() { return room; } };
}
