/** Pure projections over committed authoritative game events. Activity is evidence of
 * an action, never an automatic claim of knowledge, competency or achievement.
 * External export uses Foxxi's advertised signed xAPI adapter; it is opt-in per session.
 */
import { createHash } from 'node:crypto';

export const GAMING_NS = 'urn:interego:gaming:';
export const COMMITTED_GAMEPLAY_PROFILE = 'https://march-production-f6d9.up.railway.app/gaming/committed-activity-profile.jsonld';
export const COMMITTED_GAMEPLAY_PROFILE_VERSION = COMMITTED_GAMEPLAY_PROFILE + '/versions/1.0.0';
export const COMMITTED_GAMEPLAY_EVENT_TYPES = Object.freeze(['damage', 'loot.granted', 'resource.gathered', 'teaching.delivered',
  'knowledge.consulted', 'companion.spawned', 'movement.applied', 'telemetry.sample', 'player.joined', 'encounter.started',
  'entity.recovered', 'companion.nativeReferenceRegistered', 'companion.nativeAdmitted', 'companion.nativeRevoked',
  'companion.granted', 'companion.revoked', 'consent.changed']);
export const FOXXI_XAPI_ACTION = 'urn:iep:action:foxxi:write-xapi-statements-signed';
export const FOXXI_XAPI_ACTION_PUBLISHED = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/write-xapi-statements-signed';
/** Exact aliases verified in Foxxi's source and published affordances respectively.
 * No suffix matching, URL inference or unadvertised operation is accepted. */
export const isFoxxiXapiAction = action => action === FOXXI_XAPI_ACTION || action === FOXXI_XAPI_ACTION_PUBLISHED;
const ACCOUNT_HOME = 'urn:interego:gaming:accounts';
const MAX_EVENTS = 10000;
const METRICS = ['damageDealt', 'kills', 'lootQuantity', 'resourcesGathered', 'teachingActions', 'knowledgeConsultations', 'companionsSpawned', 'movements'];
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;
  return JSON.stringify(value);
};
const text = (v, field) => {
  if (typeof v !== 'string' || !v.trim() || v.length > 512) throw new TypeError(`${field} must be a nonempty string of at most 512 characters`);
  return v;
};
const observedNumber = (v, field) => {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > Number.MAX_SAFE_INTEGER) throw new TypeError(`${field} must be a finite nonnegative number within the safe numeric range`);
  return v;
};
const uuidFor = value => {
  const hex = createHash('sha256').update(value).digest('hex').slice(0, 32).split('');
  // UUIDv8: a deterministic SHA-256-derived application identifier, not UUIDv5/SHA-1.
  hex[12] = '8'; hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
};
const newScope = (scope, id) => ({ scope, id, eventCount: 0, byKind: Object.create(null), metrics: Object.fromEntries(METRICS.map(k => [k, 0])), telemetry: Object.create(null), competencyStatus: 'not-assessed' });

function measurements(event) {
  const p = event.payload, metrics = {}, telemetry = {};
  if (event.kind === 'damage') {
    metrics.damageDealt = observedNumber(p.amount, 'damage.amount');
    // A committed kill id identifies one death. Repeated damage against an already
    // dead entity does not create another kill merely because dead remains true.
    if (p.dead === true && typeof p.killId === 'string' && p.killId) metrics.kills = 1;
  }
  if (event.kind === 'loot.granted') metrics.lootQuantity = observedNumber(p.quantity, 'loot.quantity');
  if (event.kind === 'resource.gathered') metrics.resourcesGathered = observedNumber(p.quantity, 'resource.quantity');
  if (event.kind === 'teaching.delivered') metrics.teachingActions = 1;
  if (event.kind === 'knowledge.consulted') metrics.knowledgeConsultations = 1;
  if (event.kind === 'companion.spawned') metrics.companionsSpawned = 1;
  if (event.kind === 'movement.applied') metrics.movements = 1;
  if (event.kind === 'telemetry.sample') for (const key of ['rttMs', 'tickMs', 'queueMs']) {
    if (p[key] !== undefined) telemetry[key] = observedNumber(p[key], key);
  }
  return { metrics, telemetry };
}

/** Does not mutate events or retain global state. Replay the committed log (or a
 * bounded window of it) to rebuild these projections. Duplicate IDs are idempotent;
 * conflicting IDs/stream version/index positions fail closed instead of corrupting
 * the evidence. A command can atomically commit several indexed events.
 * teamId/realmId must be resolved by the server at commit, never accepted from a client.
 */
export function projectGamingEvents(events, { domain = 'gaming', gameId = domain, authority = 'authoritative-game-log' } = {}) {
  text(domain, 'domain'); text(gameId, 'gameId'); text(authority, 'authority');
  if (!Array.isArray(events) || events.length > MAX_EVENTS) throw new TypeError(`events must be an array of at most ${MAX_EVENTS} committed events`);
  const unique = new Map(), versions = new Map();
  for (const event of events) {
    if (!event || typeof event !== 'object') throw new TypeError('event must be an object');
    for (const k of ['id', 'streamId', 'actorId', 'kind']) text(event[k], k);
    if (!Number.isSafeInteger(event.version) || event.version < 1) throw new TypeError('event.version must be a positive safe integer');
    if (event.index !== undefined && (!Number.isSafeInteger(event.index) || event.index < 0)) throw new TypeError('event.index must be a nonnegative safe integer');
    if (event.humanSubject !== undefined && typeof event.humanSubject !== 'boolean') throw new TypeError('event.humanSubject must be a boolean');
    if (event.actorKind !== undefined && !['human', 'agent', 'npc', 'system'].includes(event.actorKind)) throw new TypeError('event.actorKind must be human, agent, npc or system');
    if (event.agentId !== undefined) text(event.agentId, 'agentId');
    if (typeof event.at !== 'string' || !Number.isFinite(Date.parse(event.at))) throw new TypeError('event.at must be an observed timestamp');
    if (!event.payload || typeof event.payload !== 'object' || Array.isArray(event.payload)) throw new TypeError('event.payload must be an object');
    for (const k of ['teamId', 'realmId']) if (event[k] !== undefined) text(event[k], k);
    // JSON serialization rejects cycles and BigInts before the event can enter evidence.
    const copy = JSON.parse(JSON.stringify(event));
    const key = canonical([domain, gameId, event.streamId, event.id]);
    const body = canonical(copy), version = canonical([event.streamId, event.version, event.index ?? 0]);
    if (unique.has(key) && unique.get(key).body !== body) throw new Error('conflicting event id');
    if (versions.has(version) && versions.get(version) !== key) throw new Error('conflicting stream version');
    versions.set(version, key); unique.set(key, { event: copy, body, key });
  }
  const scopes = { actors: Object.create(null), players: Object.create(null), teams: Object.create(null), realms: Object.create(null), game: newScope('game', gameId) };
  const evidence = [], kills = new Set();
  const ordered = [...unique.values()].sort((a, b) => Date.parse(a.event.at) - Date.parse(b.event.at) || a.event.streamId.localeCompare(b.event.streamId) || a.event.version - b.event.version || (a.event.index ?? 0) - (b.event.index ?? 0));
  for (const { event, key } of ordered) {
    const observed = measurements(event);
    const aggregateMetrics = { ...observed.metrics };
    if (aggregateMetrics.kills) {
      const killKey = canonical([event.streamId, event.payload.killId]);
      if (kills.has(killKey)) delete aggregateMetrics.kills;
      else kills.add(killKey);
    }
    const row = {
      id: uuidFor(key), actorId: event.actorId, kind: event.kind, at: event.at,
      source: { authority, eventId: event.id, streamId: event.streamId, version: event.version, ...(event.index !== undefined ? { index: event.index } : {}), binding: 'committed-log-reference' },
      ...(event.humanSubject !== undefined ? { humanSubject: event.humanSubject } : {}),
      ...(event.actorKind ? { actorKind: event.actorKind } : {}),
      ...(event.agentId ? { agentId: event.agentId } : {}),
      ...(event.teamId ? { teamId: event.teamId } : {}), ...(event.realmId ? { realmId: event.realmId } : {}),
      measured: observed, epistemicStatus: 'observed-activity', competencyStatus: 'not-assessed'
    };
    evidence.push(row);
    const targets = [scopes.game, scopes.actors[event.actorId] ??= newScope('actor', event.actorId)];
    if (event.humanSubject !== false && event.actorKind !== 'npc' && event.actorKind !== 'system') targets.push(scopes.players[event.actorId] ??= newScope('player', event.actorId));
    if (event.teamId) targets.push(scopes.teams[event.teamId] ??= newScope('team', event.teamId));
    if (event.realmId) targets.push(scopes.realms[event.realmId] ??= newScope('realm', event.realmId));
    for (const target of targets) {
      target.eventCount++; target.byKind[event.kind] = (target.byKind[event.kind] || 0) + 1;
      for (const [metric, value] of Object.entries(aggregateMetrics)) target.metrics[metric] += value;
      for (const [metric, value] of Object.entries(observed.telemetry)) {
        const s = target.telemetry[metric] ??= { count: 0, sum: 0, min: value, max: value, mean: 0 };
        s.count++; s.sum += value; s.min = Math.min(s.min, value); s.max = Math.max(s.max, value); s.mean = s.sum / s.count;
      }
    }
  }
  return { schemaVersion: 1, domain, gameId, eventCount: evidence.length, duplicatesIgnored: events.length - evidence.length, evidence, scopes, competencyClaims: [] };
}

function toStatement(row, did, projection) {
  return {
    id: row.id, actor: { objectType: 'Agent', account: { homePage: ACCOUNT_HOME, name: did } },
    verb: { id: `${GAMING_NS}verbs/${encodeURIComponent(row.kind)}`, display: { en: row.kind } },
    object: { objectType: 'Activity', id: `${GAMING_NS}events/${encodeURIComponent(projection.gameId)}/${encodeURIComponent(row.source.streamId)}/${encodeURIComponent(row.source.eventId)}`,
      definition: { type: `${GAMING_NS}CommittedGameActivity`, name: { en: row.kind } } },
    timestamp: row.at,
    context: { extensions: {
      [`${GAMING_NS}domain`]: projection.domain,
      [`${GAMING_NS}gameId`]: projection.gameId,
      [`${GAMING_NS}source`]: row.source,
      ...(row.agentId ? { [`${GAMING_NS}delegatedAgentId`]: row.agentId } : {}),
      [`${GAMING_NS}measured`]: row.measured,
      [`${GAMING_NS}epistemicStatus`]: row.epistemicStatus,
      [`${GAMING_NS}competencyStatus`]: 'not-assessed'
    } }
  };
}

/** Explicit, versioned projection for a new exporter, not an upgrade of the legacy
 * sink/outbox below. The caller must supply an authenticated subject binding and
 * the actual run's registration UUID; no lifecycle events or sessions are inferred.
 * IDs include this projection version, subject and registration, so legacy LRS
 * statements cannot be silently rewritten. Do not send both projections as two
 * independent observations of the same action. Original committed events remain
 * the source of truth, including their stream versions and event identifiers. */
export function committedGameplayStatements(events, { subjectDid, actorId = subjectDid, registration, ...context } = {}) {
  if (typeof subjectDid !== 'string' || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(subjectDid) || subjectDid.length > 512)
    throw new TypeError('an authenticated subject DID binding is required');
  text(actorId, 'actorId');
  if (typeof registration !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(registration))
    throw new TypeError('the actual run registration UUID is required');
  // UUID text is case-insensitive. Equivalent spellings must not create a new
  // statement identity when a caller retries the same run after a restart.
  registration = registration.toLowerCase();
  const projection = projectGamingEvents(events, context);
  const known = new Set(COMMITTED_GAMEPLAY_EVENT_TYPES);
  return projection.evidence.map(row => {
    if (row.actorId !== actorId) throw new TypeError('a committed projection cannot cross subject bindings');
    if (row.actorKind === 'npc' || row.actorKind === 'system' || row.humanSubject === false && row.actorKind !== 'agent')
      throw new TypeError('a personal committed projection requires a player or authenticated agent subject');
    if (!known.has(row.kind)) throw new TypeError('the committed event kind is outside this Profile');
    if (row.source.authority !== 'authoritative-game-log') throw new TypeError('this Profile requires authoritative-game-log provenance');
    if (new Date(row.at).toISOString() !== row.at) throw new TypeError('the committed event must retain its canonical observed ISO timestamp');
    const statement = toStatement(row, subjectDid, projection);
    statement.id = uuidFor(canonical([COMMITTED_GAMEPLAY_PROFILE_VERSION, row.id, subjectDid, registration]));
    statement.context.registration = registration;
    statement.context.contextActivities = { category: [{ id: COMMITTED_GAMEPLAY_PROFILE_VERSION }] };
    return statement;
  });
}

/** Adapter contract verified in Foxxi affordances.ts / src/self-xapi.ts:
 * POST the discovered target for write-xapi-statements-signed, using sign_request's
 * {_signed_payload,_signature}. Self-attribution is mandatory, max 20 statements/
 * 128 KiB. The transport is injected: this module discovers no URL and sends nothing
 * by default. Never call record-performance for ordinary gameplay; it can promote
 * competencies. Stable statement IDs survive retries and process restarts.
 *
 * getConsent is a SERVER-SIDE lookup, called immediately before every batch; it must
 * return {allowed:true,sessionId,actorId,subjectDid,recipient,expiresAt}. recipient is
 * the exact discovered target, expiresAt is an ISO timestamp. resolveActorDid is an
 * optional SERVER-SIDE verified mapping returning {did,verified:true}; opaque game
 * accounts otherwise cannot be exported into an individual's signed Foxxi lens.
 */
export function createFoxxiSink({ descriptor, transport, signRequest, getConsent, resolveActorDid, now = Date.now } = {}) {
  if (!descriptor || !isFoxxiXapiAction(descriptor.action) || descriptor.method !== 'POST' || typeof descriptor.target !== 'string' || !/^https:\/\//.test(descriptor.target) || /[{}]/.test(descriptor.target)) throw new TypeError('a concrete discovered Foxxi signed xAPI POST descriptor is required');
  if (![transport, signRequest, getConsent].every(v => typeof v === 'function')) throw new TypeError('transport, signRequest and server-side getConsent are required');
  const target = descriptor.target;
  const denied = reason => ({ ok: false, reason, retryable: false, exported: 0 });
  return {
    descriptor: Object.freeze({ action: descriptor.action, method: 'POST', target }),
    async publish(events, context = {}) {
      const { sessionId, actorId } = context;
      if (!sessionId || !actorId) return denied('export-session-required');
      const projection = projectGamingEvents(events, context);
      if (projection.evidence.some(e => e.actorId !== actorId)) return denied('cross-actor-export-denied');
      if (projection.evidence.some(e => e.actorKind === 'npc' || e.actorKind === 'system' || e.humanSubject === false && e.actorKind !== 'agent')) return denied('non-player-export-denied');
      const mapping = resolveActorDid ? await resolveActorDid({ sessionId, actorId }) : { did: actorId, verified: /^did:[a-z0-9]+:/i.test(actorId) };
      if (mapping?.verified !== true || !/^did:[a-z0-9]+:/i.test(mapping.did || '')) return denied('verified-actor-did-required');
      const statements = projection.evidence.map(e => toStatement(e, mapping.did, projection));
      const hasConsent = c => c?.allowed === true && c.sessionId === sessionId && c.actorId === actorId && c.subjectDid === mapping.did && c.recipient === target && Number.isFinite(Date.parse(c.expiresAt)) && Date.parse(c.expiresAt) > now();
      let exported = 0;
      const receipts = [];
      for (let offset = 0; offset < statements.length; offset += 20) {
        const consent = await getConsent({ sessionId, actorId, recipient: target });
        if (!hasConsent(consent)) return { ...denied('export-consent-required'), exported, receipts };
        const consentSnapshot = canonical(consent);
        const batch = statements.slice(offset, offset + 20);
        if (Buffer.byteLength(JSON.stringify(batch), 'utf8') > 131072) return { ...denied('export-batch-too-large'), exported, receipts };
        const envelope = await signRequest({ statements: batch }, { sessionId, subjectDid: mapping.did });
        let signed;
        try { signed = JSON.parse(envelope?._signed_payload); } catch { return { ...denied('invalid-signature-envelope'), exported, receipts }; }
        if (!envelope?._signature || signed.agent_id !== mapping.did || canonical(signed.statements) !== canonical(batch)) return { ...denied('signed-subject-or-content-mismatch'), exported, receipts };
        // Recheck after signing: consent may have been revoked while delegation ran.
        const current = await getConsent({ sessionId, actorId, recipient: target });
        if (!hasConsent(current) || canonical(current) !== consentSnapshot) return { ...denied('export-consent-changed'), exported, receipts };
        let response;
        try { response = await transport({ url: target, method: 'POST', headers: { 'content-type': 'application/json' }, body: envelope }); }
        catch { return { ok: false, reason: 'foxxi-transport-uncertain', retryable: true, exported, receipts, statementIds: batch.map(s => s.id) }; }
        const body = response?.body;
        const expected = batch.map(s => s.id).sort();
        const accepted = Array.isArray(body?.statementIds) ? [...body.statementIds].sort() : [];
        const durableReceipts = Array.isArray(body?.receipts) && body.receipts.length === batch.length && canonical(body.receipts.map(r => r.statementId).sort()) === canonical(expected) && body.receipts.every(r => r.persisted === true);
        if (response?.status !== 200 || body?.ok !== true || body?.durable !== true || body?.lrsAccepted !== true || canonical(expected) !== canonical(accepted) || !durableReceipts) return { ok: false, reason: 'foxxi-durable-ack-required', retryable: true, exported, receipts, statementIds: expected };
        exported += batch.length; receipts.push(...body.receipts);
      }
      return { ok: true, exported, receipts, competencyClaims: [] };
    }
  };
}
