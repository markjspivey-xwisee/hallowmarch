import { randomUUID } from 'node:crypto';
import { AuthoritativeRoom, GameCommandError } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { projectGamingEvents } from './learning.js';
import { createLearningOutbox } from './outbox.js';

/** Bind a domain to the existing authenticated transport. An absent store leaves
 * this capability disabled; it never substitutes local files or human pod keys.
 */
export function createGamingRuntime({ store = null, send, clock = Date.now, domain = createHallowmarchDomain(), roomId = 'march-proof', learningSink = null } = {}) {
  let room = null, failure = store ? 'initializing' : 'native-service-unconfigured';
  const evidenceDomain = domain.evidenceDomain || domain.id;
  const clients = new Map(), pending = new Map(); let outbox = null;
  const manifest = () => ({ schemaVersion: 1, enabled: !!room, status: room ? 'ready' : failure,
    domain: domain.id, roomId, scope: 'shared-expedition', worldMigration: false, learningExport: 'requires-verified-identity-and-session-consent',
    companionRoles: ['teammate', 'pet', 'coach'], vocabulary: '/gaming/vocabulary', domainVocabulary: '/gaming/hallowmarch-vocabulary',
    transport: { websocket: '/ws', messageType: 'gaming', commandAuthority: 'server', durableAcknowledgements: true },
    ...(room ? { version: room.version } : {}) });
  const snapshot = async (client, refresh = false) => {
    const principal = clients.get(client);
    if (principal && client.ws?.readyState === 1) {
      const state = refresh ? await room.observe(principal) : room.observeCommitted(principal);
      send(client, { t: 'gaming', op: 'snapshot', roomId: state.roomId, version: state.version, state });
    }
  };
  const ready = (async () => {
    if (!store) return;
    try {
      await store.ready?.();
      const candidate = await new AuthoritativeRoom({ roomId, store, domain, clock }).open();
      candidate.subscribe(() => { for (const client of clients.keys()) void snapshot(client).catch(() => clients.delete(client)); });
      room = candidate; failure = '';
      outbox = createLearningOutbox({ sink: learningSink, domain: evidenceDomain, gameId: roomId, now: clock,
        getEntries: async ({ limit }) => (await room.learningContext(limit)).outbox,
        getConsent: async ({ actorId }) => (await room.learningContext(1)).consent[actorId],
        acknowledge: data => room.acknowledgeLearning(data) });
    } catch { failure = 'native-service-unavailable'; }
  })();
  function principalOf(c) {
    if (!c.acct?.id) throw new GameCommandError('unauthenticated', 'Sign in to enter the expedition.');
    if (![0, 1, 2].includes(c.realm)) throw new GameCommandError('realm_required', 'Start your character first.');
    return { playerId: c.acct.id, realmId: String(c.realm), name: c.slow?.dn || c.slow?.n || c.acct.name || 'Traveller' };
  }
  async function handle(c, message) {
    const requestId = typeof message.requestId === 'string' && message.requestId.length <= 128 ? message.requestId : '';
    const count = pending.get(c) || 0;
    if (count >= 8) { send(c, { t: 'gaming', op: 'result', requestId, ok: false, error: { code: 'busy', message: 'Too many pending game commands.' } }); return; }
    pending.set(c, count + 1);
    try {
      if (!room) throw new GameCommandError('unavailable', 'Shared expeditions are waiting for their native game service.');
      let principal, command, result;
      if (message.op === 'agent.command' || message.op === 'agent.observe') {
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
            result = await room.execute(principal, command);
          }
        }
      }
      send(c, { t: 'gaming', op: 'result', requestId, ok: true, result });
    } catch (error) {
      // Known command failures are safe product messages. Never relay SDK/auth or network exception text.
      const known = ['GameCommandError', 'CompanionError'].includes(error.name);
      send(c, { t: 'gaming', op: 'result', requestId, ok: false, error: { code: known ? error.code : 'durability_unavailable', message: known ? error.message : 'The game state could not be committed. Try again.' } });
    } finally { const n = (pending.get(c) || 1) - 1; if (n) pending.set(c, n); else pending.delete(c); }
  }
  return { ready, manifest, handle, flushLearning() { return outbox ? outbox.flush() : Promise.resolve({ ok: false, reason: 'native-service-unavailable' }); }, close(c) { clients.delete(c); pending.delete(c); },
    metrics() { return room ? { ...room.stats, version: room.version, playerConnections: clients.size, eventWindow: room.current.events.length,
      performance: projectGamingEvents(room.current.events, { domain: evidenceDomain, gameId: roomId }).scopes.game } : null; },
    get room() { return room; } };
}
