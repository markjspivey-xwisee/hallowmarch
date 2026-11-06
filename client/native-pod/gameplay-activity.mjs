/** Private owner-browser observations. No import-time I/O, LRS delivery or learning claims. */
export const GAMEPLAY_ACTIVITY_SCHEMA = 'hallowmarch.gameplay-activity/v1';
export const GAMEPLAY_EVENT_LEGACY_SCHEMA = 'hallowmarch.gameplay-event/v1';
export const GAMEPLAY_EVENT_SCHEMA = 'hallowmarch.gameplay-event/v2';
export const GAMEPLAY_ACTIVITY_PROFILE = 'https://march-production-f6d9.up.railway.app/gaming/activity-profile.jsonld';
export const GAMEPLAY_ACTIVITY_PROFILE_LEGACY_VERSION = GAMEPLAY_ACTIVITY_PROFILE + '/versions/1.0.0';
export const GAMEPLAY_ACTIVITY_PROFILE_VERSION = GAMEPLAY_ACTIVITY_PROFILE + '/versions/1.1.0';
export const GAMEPLAY_ACTIVITY_LIMITS = Object.freeze({ pending: 64, recent: 16, attempts: 8, sessions: 80, bodies: 17, bytes: 65536 });
export const GAMEPLAY_EVENT_TYPES = Object.freeze(['ability.executed', 'ability.refused', 'combat.defeated', 'combat.died', 'combat.healed',
  'resource.gathered', 'resource.harvested', 'craft.completed', 'craft.refused', 'bounty.completed', 'bounty.claimed',
  'supply.delivered', 'path.completed', 'character.respawned', 'intervention.started', 'agent.command-accepted']);
const types = new Set(GAMEPLAY_EVENT_TYPES), copy = value => JSON.parse(JSON.stringify(value));
const fail = code => { throw Object.assign(new Error('The private gameplay activity record is not valid.'), { code }); };
const plain = value => !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
const text = (value, max = 128) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function exact(value, keys) { if (!plain(value) || Object.keys(value).some(key => !keys.includes(key))) fail('invalid_activity'); }
function bounded(value) { if (new TextEncoder().encode(JSON.stringify(value)).length > GAMEPLAY_ACTIVITY_LIMITS.bytes) fail('activity_capacity'); return value; }
function reference(value) {
  if (value === null) return null;
  exact(value, ['graphIri', 'cid', 'descriptorUrl']);
  if (!text(value.graphIri, 1024) || !/^urn:graph:[^\s<>"{}|^`\\]+$/.test(value.graphIri) || !text(value.cid, 512) || !text(value.descriptorUrl, 2048)) fail('invalid_activity');
  const url = new URL(value.descriptorUrl); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) fail('invalid_activity');
  return copy(value);
}
export function validateGameplayActivityEvent(value) {
  exact(value, ['schema', 'id', 'sessionId', 'sequence', 'ordinal', 'type', 'observedAt', 'body', 'actor', 'object', 'result', 'context']);
  if (![GAMEPLAY_EVENT_LEGACY_SCHEMA, GAMEPLAY_EVENT_SCHEMA].includes(value.schema) || !uuid(value.id?.replace(/^urn:uuid:/, '')) || !value.id.startsWith('urn:uuid:')
    || !uuid(value.sessionId) || !integer(value.sequence) || value.sequence < 1 || !integer(value.ordinal) || value.ordinal < 1
    || !types.has(value.type) || !iso(value.observedAt)) fail('invalid_activity_event');
  exact(value.body, ['id', 'kind']); exact(value.actor, ['kind', 'id', 'grantId']); exact(value.object, ['id', 'kind']);
  exact(value.result, ['quantity', 'success', 'reason']); exact(value.context, ['realm', 'level', 'party', 'attemptId', 'interventionId']);
  if (!text(value.body.id) || !['character', 'owned-unit'].includes(value.body.kind)
    || !['unattributed', 'human-input', 'agent', 'companion-autonomy'].includes(value.actor.kind)
    || (value.actor.id !== undefined && (!text(value.actor.id, 512) || !value.actor.id.startsWith('did:')))
    || (value.actor.kind === 'agent' && !value.actor.id)
    || (value.actor.grantId !== undefined && (!uuid(value.actor.grantId.replace(/^urn:uuid:/, '')) || !value.actor.grantId.startsWith('urn:uuid:')))
    || !text(value.object.id) || !/^[a-z][a-z0-9-]{0,31}$/.test(value.object.kind)
    || (value.result.quantity !== undefined && (!Number.isFinite(value.result.quantity) || value.result.quantity < 0 || value.result.quantity > 1e9))
    || (value.result.success !== undefined && typeof value.result.success !== 'boolean')
    || (value.result.reason !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(value.result.reason))
    || typeof value.context.party !== 'boolean' || (value.context.realm !== undefined && ![0, 1, 2].includes(value.context.realm))
    || (value.context.level !== undefined && (!integer(value.context.level) || value.context.level < 1 || value.context.level > 50))
    || (value.context.attemptId !== undefined && !uuid(value.context.attemptId))
    || (value.context.interventionId !== undefined && !text(value.context.interventionId, 64))) fail('invalid_activity_event');
  if (new TextEncoder().encode(JSON.stringify(value)).length > 2048) fail('activity_capacity');
  return copy(value);
}

export const GAMEPLAY_INTERVENTIONS = Object.freeze([
  { id: 'combat-field-guide', title: 'Read the combat field notes', kind: 'job-aid', destination: 'guide:combat', note: 'Check range, target, resource and cooldown before your next ability.' },
  { id: 'one-foe-practice', title: 'Practise one controlled fight', kind: 'practice', destination: 'guide:combat', note: 'Choose one nearby foe at a suitable level. Observe the result before trying a larger group.' },
  { id: 'callings-reference', title: 'Review your calling', kind: 'job-aid', destination: 'guide:classes', note: 'Use your actual ability descriptions and calling mechanics.' },
  { id: 'gather-field-guide', title: 'Find materials nearby', kind: 'job-aid', destination: 'guide:gathering', note: 'Use a ripe plant or a suitable rock; only materials actually collected count.' },
  { id: 'craft-reference', title: 'Open the crafting book', kind: 'tool', destination: 'craft', note: 'Choose a recipe, check its ingredients and station, then complete one item.' },
  { id: 'herbal-reference', title: 'Read the farming notes', kind: 'job-aid', destination: 'guide:farming', note: 'Check ripeness, beds and available tools before gathering or harvesting.' },
  { id: 'herald-return', title: 'Return to the herald', kind: 'job-aid', destination: 'guide:bounties', note: 'Your bounty counts as claimed only when its reward is actually collected.' },
  { id: 'supply-reference', title: 'Plan a supply delivery', kind: 'job-aid', destination: 'guide:supplies', note: 'Carry useful goods to a friendly quartermaster or keep hall and hand them over.' },
  { id: 'recovery-reference', title: 'Regroup after falling', kind: 'job-aid', destination: 'guide:combat', note: 'Release when ready, review your supplies and choose a manageable next encounter.' },
  { id: 'party-recovery-reference', title: 'Review your party after a fall', kind: 'tool', destination: 'party', note: 'Review which party members remain available. A fallen AI party member stays fallen; use Players to manage it and choose your next step. A companion respawn is not assumed.' },
]);
const resourceById = new Map(GAMEPLAY_INTERVENTIONS.map(item => [item.id, item]));
export const GAMEPLAY_MILESTONES = Object.freeze([
  { id: 'gather-one', title: 'Collect a resource', description: 'Collect goods from a plant, rock, tree or fishing attempt.', eventTypes: ['resource.gathered'], target: 1, resources: ['gather-field-guide'] },
  { id: 'craft-one', title: 'Complete a recipe', description: 'Finish one successful craft using the actual recipe and materials.', eventTypes: ['craft.completed'], target: 1, resources: ['craft-reference'] },
  { id: 'ability-three', title: 'Use three abilities', description: 'Execute three legal abilities. Refused inputs do not count.', eventTypes: ['ability.executed'], target: 3, resources: ['callings-reference', 'combat-field-guide'] },
  { id: 'defeat-one', title: 'Receive credit for a foe', description: 'Receive real local game credit for a defeated foe.', eventTypes: ['combat.defeated'], target: 1, resources: ['one-foe-practice'] },
  { id: 'heal-one', title: 'Restore lost health', description: 'Use your character or an owned unit to apply a heal that actually restores health.', eventTypes: ['combat.healed'], target: 1, resources: ['callings-reference'] },
  { id: 'harvest-one', title: 'Harvest a ripe bed', description: 'Harvest at least one ripe plant from a bed.', eventTypes: ['resource.harvested'], target: 1, resources: ['herbal-reference'] },
  { id: 'bounty-complete', title: 'Meet a bounty target', description: 'Reach the actual target of an accepted bounty.', eventTypes: ['bounty.completed'], target: 1, resources: ['herald-return'] },
  { id: 'bounty-claim', title: 'Collect a bounty reward', description: 'Claim a completed bounty at the herald.', eventTypes: ['bounty.claimed'], target: 1, resources: ['herald-return'] },
  { id: 'supply-one', title: 'Deliver supplies', description: 'Hand over useful carried goods to your realm or a friendly keep.', eventTypes: ['supply.delivered'], target: 1, resources: ['supply-reference'] },
  { id: 'path-one', title: 'Complete a path step', description: 'Complete and receive the reward for an actual path objective.', eventTypes: ['path.completed'], target: 1, resources: ['gather-field-guide', 'combat-field-guide'] },
]);
export const GAMEPLAY_FAILURE_FOCI = Object.freeze([
  { id: 'recover-after-fall', eventType: 'combat.died', bodyKind: 'character', title: 'Regroup after falling',
    description: 'Release when ready, review your readiness and choose a manageable next encounter.', resources: ['recovery-reference', 'one-foe-practice'] },
  { id: 'party-after-fall', eventType: 'combat.died', bodyKind: 'owned-unit', title: 'Review the party after a fall',
    description: 'Review the surviving party and manage the fallen companion before choosing your next field task. A respawn for this unit is not assumed.', resources: ['party-recovery-reference', 'callings-reference'] },
  { id: 'ability-readiness', eventType: 'ability.refused', title: 'Prepare the next ability attempt',
    description: 'Check the selected target, range, resources and cooldown before the next legal ability.', resources: ['combat-field-guide', 'callings-reference'] },
  { id: 'craft-readiness', eventType: 'craft.refused', title: 'Check the next recipe attempt',
    description: 'Check the actual recipe ingredients, station and capacity before trying again.', resources: ['craft-reference', 'gather-field-guide'] },
]);
const contextEvent = event => ({ type: event.type, id: event.id, observedAt: event.observedAt, ordinal: event.ordinal,
  body: copy(event.body), object: copy(event.object), ...(event.result.reason ? { reason: event.result.reason } : {}) });
const meaningful = type => !['intervention.started', 'agent.command-accepted'].includes(type);

function validateState(value, ownerDid, characterId) {
  exact(value, ['schema', 'ownerDid', 'characterId', 'revision', 'eventCount', 'lastEventAt', 'counters', 'quantities', 'evidence', 'sessions', 'recent', 'pending', 'attempts', 'archiveHead', 'archivedEvents', 'historyGaps',
    'bodyObservations', 'bodyHistory', 'lastMeaningfulContext']);
  value = copy(value);
  if (!Object.hasOwn(value, 'bodyObservations') && !Object.hasOwn(value, 'bodyHistory')) {
    value.bodyObservations = []; value.bodyHistory = { unknownHistoricalEvents: value.eventCount, unassignedEvents: 0 };
  }
  if (!Object.hasOwn(value, 'lastMeaningfulContext')) { const last = [...(value.recent || [])].reverse().find(item => meaningful(item.type)); value.lastMeaningfulContext = last ? contextEvent(last) : null; }
  if (value.schema !== GAMEPLAY_ACTIVITY_SCHEMA || value.ownerDid !== ownerDid || value.characterId !== characterId
    || !integer(value.revision) || !integer(value.eventCount) || !integer(value.archivedEvents)
    || (value.lastEventAt !== null && !iso(value.lastEventAt))) fail('activity_scope');
  for (const field of ['counters', 'quantities', 'evidence']) {
    if (!plain(value[field]) || Object.keys(value[field]).some(key => !types.has(key))) fail('invalid_activity');
    for (const item of Object.values(value[field])) {
      if (field === 'evidence') { if (!Array.isArray(item) || item.length > 4 || item.some(id => !uuid(id?.replace(/^urn:uuid:/, '')) || !id.startsWith('urn:uuid:'))) fail('invalid_activity'); }
      else if (!Number.isFinite(item) || item < 0 || item > Number.MAX_SAFE_INTEGER || field === 'counters' && !integer(item)) fail('invalid_activity');
    }
  }
  if (!Array.isArray(value.sessions) || value.sessions.length > GAMEPLAY_ACTIVITY_LIMITS.sessions || new Set(value.sessions.map(item => item.id)).size !== value.sessions.length) fail('invalid_activity');
  for (const item of value.sessions) { exact(item, ['id', 'sequence']); if (!uuid(item.id) || !integer(item.sequence)) fail('invalid_activity'); }
  for (const field of ['recent', 'pending']) {
    if (!Array.isArray(value[field]) || value[field].length > GAMEPLAY_ACTIVITY_LIMITS[field]) fail('activity_capacity');
    for (const item of value[field]) validateGameplayActivityEvent(item);
    if (new Set(value[field].map(item => item.id)).size !== value[field].length) fail('invalid_activity');
  }
  const pendingSessions = new Set(); let previous = null;
  for (const item of value.pending) {
    if (previous?.sessionId === item.sessionId && item.sequence !== previous.sequence + 1) fail('invalid_activity');
    if (previous?.sessionId !== item.sessionId) { if (pendingSessions.has(item.sessionId)) fail('invalid_activity'); pendingSessions.add(item.sessionId); }
    previous = item;
  }
  const sum = values => values.reduce((total, number) => Math.min(Number.MAX_SAFE_INTEGER, total + number), 0);
  if (sum(Object.values(value.counters)) !== value.eventCount
    || sum([value.archivedEvents, value.pending.length, value.historyGaps?.detailsDropped || 0]) !== value.eventCount
    || (value.eventCount > 0 && value.lastEventAt === null)) fail('invalid_activity');
  const checkpoints = new Map(); const records = new Map();
  for (const item of [...value.pending, ...value.recent]) {
    if (item.ordinal > value.eventCount || Date.parse(item.observedAt) > Date.parse(value.lastEventAt)) fail('invalid_activity');
    if (records.has(item.id) && JSON.stringify(records.get(item.id)) !== JSON.stringify(item)) fail('invalid_activity'); records.set(item.id, item);
    checkpoints.set(item.sessionId, Math.max(checkpoints.get(item.sessionId) || 0, item.sequence));
  }
  if (value.sessions.length !== checkpoints.size || value.sessions.some(item => checkpoints.get(item.id) !== item.sequence)) fail('invalid_activity');
  if (!Array.isArray(value.bodyObservations) || value.bodyObservations.length > GAMEPLAY_ACTIVITY_LIMITS.bodies
    || new Set(value.bodyObservations.map(item => item.bodyId)).size !== value.bodyObservations.length) fail('invalid_activity');
  exact(value.bodyHistory, ['unknownHistoricalEvents', 'unassignedEvents']);
  if (!integer(value.bodyHistory.unknownHistoricalEvents) || !integer(value.bodyHistory.unassignedEvents)) fail('invalid_activity');
  for (const item of value.bodyObservations) {
    exact(item, ['bodyId', 'kind', 'eventCount', 'counters', 'quantities', 'controllerCounts', 'evidenceIds', 'evidenceByType', 'lastEventAt']);
    if (!text(item.bodyId) || !['character', 'owned-unit'].includes(item.kind) || !integer(item.eventCount) || !iso(item.lastEventAt)) fail('invalid_activity');
    for (const field of ['counters', 'quantities']) {
      if (!plain(item[field]) || Object.keys(item[field]).some(key => !types.has(key))
        || Object.values(item[field]).some(number => !Number.isFinite(number) || number < 0 || number > Number.MAX_SAFE_INTEGER || field === 'counters' && !integer(number))) fail('invalid_activity');
    }
    exact(item.controllerCounts, ['unattributed', 'human-input', 'agent', 'companion-autonomy']);
    if (Object.values(item.controllerCounts).some(number => !integer(number)) || sum(Object.values(item.counters)) !== item.eventCount
      || sum(Object.values(item.controllerCounts)) !== item.eventCount || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 4
      || item.evidenceIds.some(id => !uuid(id?.replace(/^urn:uuid:/, '')) || !id.startsWith('urn:uuid:'))) fail('invalid_activity');
    if (!plain(item.evidenceByType) || Object.keys(item.evidenceByType).some(key => !types.has(key))) fail('invalid_activity');
    for (const evidence of Object.values(item.evidenceByType)) {
      if (!Array.isArray(evidence) || evidence.length > 2) fail('invalid_activity');
      for (const point of evidence) { exact(point, ['id', 'ordinal']);
        if (!uuid(point.id?.replace(/^urn:uuid:/, '')) || !point.id.startsWith('urn:uuid:') || !integer(point.ordinal) || point.ordinal > value.eventCount) fail('invalid_activity'); }
    }
  }
  if (sum([...value.bodyObservations.map(item => item.eventCount), value.bodyHistory.unknownHistoricalEvents, value.bodyHistory.unassignedEvents]) !== value.eventCount) fail('invalid_activity');
  if (value.lastMeaningfulContext) {
    const item = value.lastMeaningfulContext; exact(item, ['type', 'id', 'observedAt', 'ordinal', 'body', 'object', 'reason']);
    exact(item.body, ['id', 'kind']); exact(item.object, ['id', 'kind']);
    if (!types.has(item.type) || !meaningful(item.type) || !uuid(item.id?.replace(/^urn:uuid:/, '')) || !item.id.startsWith('urn:uuid:')
      || !iso(item.observedAt) || !integer(item.ordinal) || item.ordinal > value.eventCount || !text(item.body?.id)
      || !['character', 'owned-unit'].includes(item.body.kind) || !text(item.object?.id) || !text(item.object?.kind, 32)
      || (item.reason !== undefined && !/^[a-z][a-z0-9_-]{0,63}$/.test(item.reason))) fail('invalid_activity');
  }
  if (!Array.isArray(value.attempts) || value.attempts.length > 8) fail('activity_capacity');
  for (const item of value.attempts) { exact(item, ['id', 'interventionId', 'startedAt', 'baselineEventCount', 'evidenceIds']);
    if (!uuid(item.id) || !resourceById.has(item.interventionId) || !iso(item.startedAt) || !integer(item.baselineEventCount)
      || !Array.isArray(item.evidenceIds) || item.evidenceIds.length > 4 || item.evidenceIds.some(id => !uuid(id?.replace(/^urn:uuid:/, '')))) fail('invalid_activity'); }
  reference(value.archiveHead); if (value.archivedEvents > 0 && value.archiveHead === null) fail('invalid_activity');
  exact(value.historyGaps, ['detailsDropped', 'captureUnavailable']);
  if (!integer(value.historyGaps.detailsDropped) || !integer(value.historyGaps.captureUnavailable)) fail('invalid_activity');
  return bounded(copy(value));
}

export function createGameplayActivityProfile({ ownerDid, characterId, sessionId, state, now = Date.now, uuid: nextUuid = () => globalThis.crypto.randomUUID() } = {}) {
  if (!text(ownerDid, 512) || !/^(did:|urn:local:)/.test(ownerDid) || !text(characterId) || !uuid(sessionId)
    || typeof now !== 'function' || typeof nextUuid !== 'function') fail('activity_scope');
  let profile = state === undefined || state === null ? { schema: GAMEPLAY_ACTIVITY_SCHEMA, ownerDid, characterId,
    revision: 0, eventCount: 0, lastEventAt: null, counters: {}, quantities: {}, evidence: {}, sessions: [], recent: [], pending: [], attempts: [],
    archiveHead: null, archivedEvents: 0, historyGaps: { detailsDropped: 0, captureUnavailable: 0 },
    bodyObservations: [], bodyHistory: { unknownHistoricalEvents: 0, unassignedEvents: 0 }, lastMeaningfulContext: null } : validateState(state, ownerDid, characterId);
  if (profile.pending.some(item => item.sessionId === sessionId) && profile.pending.at(-1)?.sessionId !== sessionId) fail('activity_scope');
  const add = (value, amount = 1) => Math.min(Number.MAX_SAFE_INTEGER, (value || 0) + amount);
  const pruneSessions = value => {
    const cursors = new Map();
    for (const event of [...value.pending, ...value.recent]) cursors.set(event.sessionId, Math.max(cursors.get(event.sessionId) || 0, event.sequence));
    value.sessions = [...cursors].map(([id, sequence]) => ({ id, sequence }));
  };
  function record(input) {
    exact(input, ['type', 'body', 'actor', 'object', 'result', 'context', 'id', 'observedAt']);
    const id = input.id || 'urn:uuid:' + nextUuid(), observedAt = input.observedAt ?? new Date(now()).toISOString();
    if (profile.recent.some(item => item.id === id) || profile.pending.some(item => item.id === id)) return { recorded: false, duplicate: true };
    const checkpoint = profile.sessions.find(item => item.id === sessionId), sequence = (checkpoint?.sequence || 0) + 1;
    const event = validateGameplayActivityEvent({ schema: GAMEPLAY_EVENT_SCHEMA, id, sessionId, sequence,
      ordinal: add(profile.eventCount), observedAt, type: input.type, body: input.body,
      actor: input.actor || { kind: 'unattributed' }, object: input.object, result: input.result || {}, context: { party: false, ...input.context } });
    const next = copy(profile); next.revision = add(next.revision); next.eventCount = add(next.eventCount);
    next.lastEventAt = !next.lastEventAt || event.observedAt > next.lastEventAt ? event.observedAt : next.lastEventAt;
    next.counters[event.type] = add(next.counters[event.type]);
    if (event.result.quantity !== undefined) next.quantities[event.type] = add(next.quantities[event.type], event.result.quantity);
    next.evidence[event.type] = [...(next.evidence[event.type] || []).slice(-3), event.id];
    let body = next.bodyObservations.find(item => item.bodyId === event.body.id);
    if (body && body.kind !== event.body.kind) fail('activity_scope');
    if (!body && next.bodyObservations.length < GAMEPLAY_ACTIVITY_LIMITS.bodies) {
      body = { bodyId: event.body.id, kind: event.body.kind, eventCount: 0, counters: {}, quantities: {}, controllerCounts: {}, evidenceIds: [], evidenceByType: {}, lastEventAt: event.observedAt };
      next.bodyObservations.push(body);
    }
    if (body) {
      body.eventCount = add(body.eventCount); body.counters[event.type] = add(body.counters[event.type]);
      if (event.result.quantity !== undefined) body.quantities[event.type] = add(body.quantities[event.type], event.result.quantity);
      body.controllerCounts[event.actor.kind] = add(body.controllerCounts[event.actor.kind]);
      body.evidenceIds = [...body.evidenceIds.slice(-3), event.id]; body.lastEventAt = event.observedAt;
      body.evidenceByType[event.type] = [{ id: event.id, ordinal: event.ordinal }];
    } else next.bodyHistory.unassignedEvents = add(next.bodyHistory.unassignedEvents);
    if (meaningful(event.type)) next.lastMeaningfulContext = contextEvent(event);
    // Retain the newest actual observations continuously. Automatic archive
    // publication is optional, so an old full queue must never freeze coaching
    // or make subsequent activity disappear from the current detail window.
    next.pending.push(event); next.recent = [...next.recent, event].slice(-GAMEPLAY_ACTIVITY_LIMITS.recent);
    const dropPending = () => { next.pending.shift(); next.historyGaps.detailsDropped = add(next.historyGaps.detailsDropped); };
    while (next.pending.length > GAMEPLAY_ACTIVITY_LIMITS.pending) dropPending();
    for (const attempt of next.attempts) if (meaningful(event.type) && next.eventCount > attempt.baselineEventCount
      && Date.parse(event.observedAt) - Date.parse(attempt.startedAt) <= 15 * 60 * 1000) attempt.evidenceIds = [...attempt.evidenceIds, event.id].slice(-4);
    // Preserve aggregates and the latest event before older detail when the
    // byte ceiling is tighter than the count ceiling. The pending-prefix guard
    // makes an in-flight archive of evicted detail fail closed on confirmation.
    const fits = () => { pruneSessions(next); try { bounded(next); return true; } catch { return false; } };
    while (!fits()) {
      if (next.pending.length > 1) dropPending();
      // Legacy profiles may keep two points for every event type and body.
      // Keep their latest real point while preserving every aggregate counter.
      else if (next.bodyObservations.some(item => Object.values(item.evidenceByType).some(points => points.length > 1))) {
        for (const item of next.bodyObservations) for (const [type, points] of Object.entries(item.evidenceByType)) item.evidenceByType[type] = points.slice(-1);
      }
      else if (next.recent.length) next.recent.shift();
      else if (next.pending.length) dropPending();
      else throw Object.assign(new Error('Activity aggregate capacity exceeded.'), { code: 'activity_capacity' });
    }
    const retained = next.pending.some(item => item.id === event.id);
    profile = next; return { recorded: true, retained, event: copy(event) };
  }
  function snapshot() {
    const milestones = GAMEPLAY_MILESTONES.map(item => {
      const current = item.eventTypes.reduce((n, type) => n + (profile.counters[type] || 0), 0);
      return { id: item.id, title: item.title, description: item.description, completed: current >= item.target,
        current, target: item.target, evidenceIds: item.eventTypes.flatMap(type => profile.evidence[type] || []).slice(-4),
        interventions: item.resources.map(id => copy(resourceById.get(id))) };
    });
    const last = profile.lastMeaningfulContext, preferred = last?.type === 'bounty.completed' ? 'bounty-claim' : last?.type === 'resource.gathered' ? 'craft-one'
      : last?.type === 'craft.completed' ? 'supply-one' : null;
    const failure = last && now() - Date.parse(last.observedAt) >= 0 && now() - Date.parse(last.observedAt) <= 120000
      ? GAMEPLAY_FAILURE_FOCI.find(item => item.eventType === last.type && (!item.bodyKind || item.bodyKind === last.body.kind)) : null;
    const selected = milestones.find(item => item.id === preferred && !item.completed) || milestones.find(item => !item.completed);
    // Intent markers may evict detail from the recent tail, but cannot become
    // outcomes or make idle coaching appear to have new field-task evidence.
    const fieldObservations = Object.entries(profile.counters).filter(([type]) => meaningful(type)).reduce((total, [, count]) => total + count, 0);
    const repeatable = { id: 'field-practice', title: 'Practise your next field task', description: 'Choose one legal field task, use a relevant aid, and review the actual result.',
      current: fieldObservations, target: null, evidenceIds: last ? [last.id] : [], interventions: [copy(resourceById.get('one-foe-practice')), copy(resourceById.get('supply-reference'))] };
    const current = failure ? { ...failure, current: 0, target: 1, evidenceIds: [last.id], interventions: failure.resources.map(id => copy(resourceById.get(id))) } : selected || repeatable;
    const nextType = { 'combat.died': 'character.respawned', 'ability.refused': 'ability.executed', 'craft.refused': 'craft.completed' }[last?.type];
    const body = failure && profile.bodyObservations.find(item => item.bodyId === last.body.id);
    const detail = [...new Map([...profile.pending, ...profile.recent].map(event => [event.id, event])).values()].sort((a, b) => a.ordinal - b.ordinal);
    return { schema: GAMEPLAY_ACTIVITY_SCHEMA, revision: profile.revision, eventCount: profile.eventCount, lastEventAt: profile.lastEventAt, milestones,
      current: { id: current.id, title: current.title, desiredResult: current.description,
        observedResult: failure ? 'The game observed ' + last.type.replace('.', ' ') + (last.reason ? ' (' + last.reason + ')' : '') + '. A performance cause has not been established.'
          : current.target === null ? current.current + ' total field-task observations' : current.current + ' / ' + current.target + ' observed completions',
        workContext: 'Actual owner-browser gameplay observations for ' + current.id + '. Controller attribution is explicit; outcomes do not establish learning or skill.',
        evidenceIds: copy(current.evidenceIds), interventions: copy(current.interventions),
        ...(failure ? { bodyId: last.body.id, bodyKind: last.body.kind } : {}),
        ...(failure && body && !(last.type === 'combat.died' && last.body.kind !== 'character') ? { current: 0, target: 1, criterion: { eventType: nextType, bodyId: body.bodyId,
          baselineCount: body.counters[nextType] || 0, afterOrdinal: last.ordinal, target: 1 } } : {}),
        constraints: ['Respect real game range, materials, cooldowns, ownership and player input.', 'No questionnaire is required.'] },
      history: { recent: copy(profile.recent), archivedEvents: profile.archivedEvents, pendingEvents: profile.pending.length,
        archiveHead: copy(profile.archiveHead), detailsDropped: profile.historyGaps.detailsDropped, captureUnavailable: profile.historyGaps.captureUnavailable,
        complete: profile.historyGaps.detailsDropped === 0 && profile.historyGaps.captureUnavailable === 0,
        coverage: { kind: 'bounded-rolling-detail', retainedEvents: detail.length,
          firstOrdinal: detail[0]?.ordinal || null, lastOrdinal: detail.at(-1)?.ordinal || null,
          from: detail[0]?.observedAt || null, until: detail.at(-1)?.observedAt || null,
          maxPendingEvents: GAMEPLAY_ACTIVITY_LIMITS.pending, maxRecentEvents: GAMEPLAY_ACTIVITY_LIMITS.recent },
        description: 'Bounded recent observations with durable aggregate counters. Existing archive references and explicit detail gaps are preserved; a complete historical LRS is not claimed.' },
      summary: { counters: copy(profile.counters), quantities: copy(profile.quantities), attempts: copy(profile.attempts),
        bodyObservations: profile.bodyObservations.map(item => ({ ...copy(item), observationAuthority: 'owner-browser-observation', competencyStatus: 'not-assessed' })),
        bodyHistory: { ...copy(profile.bodyHistory), complete: profile.bodyHistory.unknownHistoricalEvents === 0 && profile.bodyHistory.unassignedEvents === 0 },
        observationAuthority: 'owner-browser-observation', competencyStatus: 'not-assessed' } };
  }
  return Object.freeze({ record, snapshot, save: () => copy(profile), resource: id => resourceById.has(id) ? copy(resourceById.get(id)) : null,
    observeCriterion(criterion) {
      exact(criterion, ['eventType', 'bodyId', 'baselineCount', 'afterOrdinal', 'target']);
      if (!types.has(criterion.eventType) || !text(criterion.bodyId) || !integer(criterion.baselineCount)
        || !integer(criterion.afterOrdinal) || !integer(criterion.target) || criterion.target < 1) fail('invalid_activity');
      const body = profile.bodyObservations.find(item => item.bodyId === criterion.bodyId);
      if (!body || (body.counters[criterion.eventType] || 0) < criterion.baselineCount) return null;
      const current = (body.counters[criterion.eventType] || 0) - criterion.baselineCount;
      const evidenceIds = (body.evidenceByType[criterion.eventType] || []).filter(point => point.ordinal > criterion.afterOrdinal).map(point => point.id);
      return { bodyId: body.bodyId, bodyKind: body.kind, current, target: criterion.target, evidenceIds,
        observedResult: current + ' / ' + criterion.target + ' subsequent observed completions for this body',
        observationAuthority: 'owner-browser-observation', competencyStatus: 'not-assessed' };
    },
    captureGap(count) {
      if (!integer(count) || count < 1) fail('invalid_activity'); const next = copy(profile);
      next.historyGaps.captureUnavailable = add(next.historyGaps.captureUnavailable, count); next.revision = add(next.revision); bounded(next); profile = next;
    },
    interventionStart(id, scope) {
      if (!resourceById.has(id)) fail('invalid_intervention'); const attemptId = nextUuid(); if (!uuid(attemptId)) fail('invalid_intervention');
      const result = record({ type: 'intervention.started', body: scope?.body || { id: characterId, kind: 'character' }, actor: scope?.actor,
        object: { id, kind: 'intervention' }, context: { ...scope?.context, attemptId, interventionId: id } });
      const next = copy(profile); next.attempts.push({ id: attemptId, interventionId: id, startedAt: profile.lastEventAt,
        baselineEventCount: profile.eventCount, evidenceIds: [] }); next.attempts = next.attempts.slice(-8); bounded(next); profile = next;
      return { ...result, attemptId, resource: copy(resourceById.get(id)) };
    },
    nextArchivePage() {
      if (!profile.pending.length) return null; const first = profile.pending[0];
      const events = []; for (const item of profile.pending) {
        if (item.sessionId !== first.sessionId || events.length >= 64) break;
        if (new TextEncoder().encode(JSON.stringify([...events, item])).length > 44 * 1024) break;
        events.push(item);
      }
      return { sessionId: first.sessionId, events: copy(events), previous: copy(profile.archiveHead) };
    },
    archiveConfirmed(page, confirmedReference) {
      if (!confirmedReference) fail('activity_archive_changed');
      if (!plain(page) || !Array.isArray(page.events) || page.events.length < 1 || page.events.length > 64
        || page.sessionId !== profile.pending[0]?.sessionId || page.events.some(item => item.sessionId !== page.sessionId)
        || JSON.stringify(page.previous) !== JSON.stringify(profile.archiveHead)
        || JSON.stringify(page.events) !== JSON.stringify(profile.pending.slice(0, page.events.length))) fail('activity_archive_changed');
      const next = copy(profile); next.archiveHead = reference(confirmedReference); next.pending.splice(0, page.events.length);
      next.archivedEvents = add(next.archivedEvents, page.events.length); next.revision = add(next.revision); pruneSessions(next); bounded(next); profile = next;
      return snapshot();
    },
  });
}

export function gameplayActivityStatement(event, ownerDid) {
  const value = validateGameplayActivityEvent(event); if (!text(ownerDid, 512) || !ownerDid.startsWith('did:')) fail('activity_scope');
  const actorDid = ownerDid;
  // The wire extension's shape is unchanged. Internal event v2 selects the new
  // Profile without rewriting the payload of any saved v1 observation.
  const context = { schema: GAMEPLAY_EVENT_LEGACY_SCHEMA, eventType: value.type, bodyId: value.body.id, bodyKind: value.body.kind,
    controllerKind: value.actor.kind, ...value.context };
  if (value.actor.id) context.controllerId = value.actor.id; if (value.actor.grantId) context.grantId = value.actor.grantId;
  const result = { extensions: { 'urn:interego:gaming:activity:observation': { authority: 'owner-browser-observation', competencyStatus: 'not-assessed', historyOrdinal: value.ordinal,
    ...(value.result.quantity !== undefined ? { quantity: value.result.quantity } : {}), ...(value.result.reason ? { reason: value.result.reason } : {}) } } };
  if (typeof value.result.success === 'boolean') result.success = value.result.success;
  if (value.result.success === true && !['intervention.started', 'agent.command-accepted'].includes(value.type)) result.completion = true;
  return { id: value.id.slice(9), actor: { objectType: 'Agent', account: { homePage: 'https://identity.interego.xwisee.com', name: actorDid } },
    verb: { id: 'urn:interego:gaming:activity:verb:' + value.type, display: { 'en-US': value.type.replace('.', ' ') } },
    object: { objectType: 'Activity', id: 'urn:interego:gaming:activity:object:' + value.object.kind + ':' + encodeURIComponent(value.object.id),
      definition: { type: 'urn:interego:gaming:activity:object:' + value.type.split('.')[0] } }, result,
    context: { registration: value.sessionId, contextActivities: { category: [{ id: value.schema === GAMEPLAY_EVENT_LEGACY_SCHEMA ? GAMEPLAY_ACTIVITY_PROFILE_LEGACY_VERSION : GAMEPLAY_ACTIVITY_PROFILE_VERSION }] },
      extensions: { 'urn:interego:gaming:activity:context': context } }, timestamp: value.observedAt };
}
