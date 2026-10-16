import { createHash, randomBytes } from 'node:crypto';

// These functions run inside the room's durable commit. The caller obtains
// principal.playerId from its authenticated human session, never from a request.
// A bearer token is returned once; room state and replay events contain its hash.
const MAX_LIFETIME_MS = 60 * 60 * 1000;
const DEFAULT_LIFETIME_MS = 15 * 60 * 1000;
const MAX_RATE = 20;
const MAX_OWNER_GRANTS = 8;
const MAX_ROOM_GRANTS = 256;
const ROLE_SCOPES = Object.freeze({
  teammate: ['observe', 'move', 'attack', 'claimLoot'],
  pet: ['observe', 'move', 'attack'],
  coach: ['observe'],
});
const COMMAND_KEYS = new Set(['type', 'roomId', 'entityId', 'targetId', 'x', 'z', 'commandId', 'seq']);
const ENTITY_KEYS = ['id', 'kind', 'teamId', 'realmId', 'x', 'z', 'hp', 'maxHp', 'alive'];

export class CompanionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'CompanionError';
    this.code = code;
  }
}

function reject(code, message) { throw new CompanionError(code, message); }
function identifier(value) { return typeof value === 'string' && value.length > 0 && value.length <= 512 && !/[\s\x00-\x1f]/.test(value); }
function time(value) {
  if (!Number.isSafeInteger(value) || value < 0) reject('invalid_time', 'A trusted server timestamp is required.');
  return value;
}
function roomId(state) {
  if (!identifier(state?.roomId)) reject('invalid_room', 'A room identity is required.');
  return state.roomId;
}
function humanOwner(state, principal) {
  const id = principal?.playerId;
  if (!identifier(id) || principal?.kind === 'agent' || principal?.agentId) reject('human_required', 'An authenticated human owner must grant or revoke access.');
  const player = Object.hasOwn(state.entities || {}, id) ? state.entities[id] : null;
  if (player?.kind !== 'player' || player.ownerPlayerId !== id) reject('human_required', 'The human must belong to this room.');
  return id;
}
function hashToken(token) { return createHash('sha256').update(token).digest('hex'); }
function tokenShape(token) { return typeof token === 'string' && /^hmca_[A-Za-z0-9_-]{43}$/.test(token); }
function registry(state) {
  return state.companions || { grants: {}, tokenIndex: {} };
}
function grantView(grant) {
  const { tokenHash: _hash, commandTimes: _times, ...safe } = grant;
  return structuredClone(safe);
}
function ownEntity(state, entityId, owner) {
  const entity = identifier(entityId) && Object.hasOwn(state.entities || {}, entityId) ? state.entities[entityId] : null;
  if (!entity || entity.ownerPlayerId !== owner || !['player', 'companion'].includes(entity.kind)) {
    reject('entity_forbidden', 'An agent may control only an entity owned by the granting player.');
  }
  return entity;
}

export function grantCompanion(state, principal, request, now, options = {}) {
  time(now);
  const ownerPlayerId = humanOwner(state, principal);
  const currentRoom = roomId(state);
  if (!request || typeof request !== 'object' || Array.isArray(request)) reject('invalid_grant', 'A grant request is required.');
  if ((request.ownerPlayerId !== undefined && request.ownerPlayerId !== ownerPlayerId) ||
      (request.playerId !== undefined && request.playerId !== ownerPlayerId)) reject('owner_mismatch', 'The authenticated owner cannot be overridden.');
  if (request.roomId !== undefined && request.roomId !== currentRoom) reject('room_mismatch', 'A grant belongs to the current room.');
  if (typeof request.agentId !== 'string' || !/^did:[a-z0-9]+:[^\s\x00-\x1f]{1,480}$/.test(request.agentId)) reject('invalid_agent', 'A companion agent DID is required.');
  const role = request.role || 'teammate';
  if (!Object.hasOwn(ROLE_SCOPES, role)) reject('invalid_role', 'Choose teammate, pet, or coach.');
  const entityId = request.entityId || ownerPlayerId;
  ownEntity(state, entityId, ownerPlayerId);
  const scopes = request.scopes === undefined ? ROLE_SCOPES[role].filter(scope => scope !== 'claimLoot') : request.scopes;
  if (!Array.isArray(scopes) || !scopes.length || scopes.length > 4 || scopes.some(scope => !ROLE_SCOPES[role].includes(scope))) {
    reject('invalid_scopes', 'Every scope must be allowed by the companion role.');
  }
  const expiresAt = request.expiresAt ?? (now + DEFAULT_LIFETIME_MS);
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= now || expiresAt > now + MAX_LIFETIME_MS) reject('invalid_expiry', 'Access must expire within one hour.');
  const maxCommandsPerSecond = request.maxCommandsPerSecond ?? 5;
  if (!Number.isInteger(maxCommandsPerSecond) || maxCommandsPerSecond < 1 || maxCommandsPerSecond > MAX_RATE) reject('invalid_rate', 'The command rate must be between 1 and 20 per second.');
  const current = registry(state);
  const active = Object.values(current.grants).filter(grant => grant.revokedAt === null && grant.expiresAt > now);
  if (active.filter(grant => grant.ownerPlayerId === ownerPlayerId).length >= MAX_OWNER_GRANTS || active.length >= MAX_ROOM_GRANTS) reject('grant_limit', 'The room or owner companion limit has been reached.');
  const token = options.token ?? `hmca_${randomBytes(32).toString('base64url')}`;
  if (!tokenShape(token)) reject('invalid_token', 'A server-generated 256-bit capability is required.');
  const tokenHash = hashToken(token);
  if (Object.hasOwn(current.tokenIndex, tokenHash)) reject('token_reused', 'A capability cannot be reused.');
  const grant = {
    id: `companion-${tokenHash.slice(0, 24)}`, ownerPlayerId, agentId: request.agentId,
    role, scopes: [...new Set(scopes)], roomId: currentRoom, entityId,
    createdAt: now, expiresAt, maxCommandsPerSecond, revokedAt: null, tokenHash, commandTimes: [],
  };
  // Compact ended grants; durable room history retains their grant/revoke events.
  const next = { grants: {}, tokenIndex: {} };
  for (const item of [...active, grant]) {
    next.grants[item.id] = item;
    next.tokenIndex[item.tokenHash] = item.id;
  }
  state.companions = next;
  return { token, grant: grantView(grant), event: { type: 'companion.granted', grant: structuredClone(grant) } };
}

export function authorizeCompanion(state, token, command, now, context = {}) {
  time(now);
  if (!tokenShape(token)) reject('invalid_capability', 'The companion capability is invalid.');
  const currentRoom = roomId(state);
  const records = registry(state);
  const digest = hashToken(token);
  const id = Object.hasOwn(records.tokenIndex, digest) ? records.tokenIndex[digest] : null;
  const grant = id && Object.hasOwn(records.grants, id) ? records.grants[id] : null;
  if (!grant || grant.tokenHash !== digest) reject('invalid_capability', 'The companion capability is invalid.');
  if (grant.revokedAt !== null) reject('revoked', 'The owner revoked companion access.');
  if (now >= grant.expiresAt) reject('expired', 'Companion access has expired.');
  if (now < grant.createdAt || (grant.commandTimes.length && now < grant.commandTimes.at(-1))) reject('clock_regressed', 'The trusted server clock must not go backwards.');
  if (grant.roomId !== currentRoom || (context.roomId !== undefined && context.roomId !== currentRoom) ||
      (command?.roomId !== undefined && command.roomId !== currentRoom)) reject('room_mismatch', 'Companion access is restricted to its granted room.');
  if (!command || typeof command !== 'object' || Array.isArray(command) || !Object.hasOwn(ROLE_SCOPES, grant.role) ||
      !ROLE_SCOPES[grant.role].includes(command.type) || !grant.scopes.includes(command.type)) reject('scope_forbidden', 'This action was not granted to the companion.');
  if (Object.keys(command).some(key => !COMMAND_KEYS.has(key))) reject('command_fields', 'Companion commands cannot override identity or world state.');
  const entityId = command.entityId ?? grant.entityId;
  if (entityId !== grant.entityId) reject('entity_forbidden', 'Companion access is restricted to its granted entity.');
  ownEntity(state, entityId, grant.ownerPlayerId);
  if ((command.targetId !== undefined && !identifier(command.targetId)) ||
      (command.commandId !== undefined && !identifier(command.commandId)) ||
      (command.seq !== undefined && (!Number.isSafeInteger(command.seq) || command.seq < 0)) ||
      (command.x !== undefined && !Number.isFinite(command.x)) || (command.z !== undefined && !Number.isFinite(command.z))) reject('invalid_command', 'Command targets and coordinates must be valid.');
  const recent = grant.commandTimes.filter(at => at > now - 1000);
  if (recent.length >= grant.maxCommandsPerSecond) reject('rate_limited', 'The companion command rate has been exceeded.');
  grant.commandTimes = [...recent, now];
  return {
    grantId: grant.id, ownerPlayerId: grant.ownerPlayerId, actorId: grant.agentId,
    role: grant.role, roomId: currentRoom, entityId, scopes: [...grant.scopes],
    command: { ...command, roomId: currentRoom, entityId },
    event: { type: 'companion.commandAuthorized', grantId: grant.id, at: now, commandTimes: [...grant.commandTimes] },
  };
}

export function revokeCompanion(state, principal, grantId, now) {
  time(now);
  const owner = humanOwner(state, principal);
  const records = registry(state);
  const grant = identifier(grantId) && Object.hasOwn(records.grants, grantId) ? records.grants[grantId] : null;
  if (!grant || grant.ownerPlayerId !== owner || grant.roomId !== roomId(state)) reject('grant_forbidden', 'Only this companion grant\'s human owner may revoke it.');
  if (now < grant.createdAt) reject('clock_regressed', 'The trusted server clock must not go backwards.');
  if (grant.revokedAt === null) grant.revokedAt = now;
  return { grant: grantView(grant), event: { type: 'companion.revoked', grantId: grant.id, at: grant.revokedAt } };
}

// Feed only the server's already interest-filtered public room view here. No
// inventory, private profile, chat, credentials, or arbitrary nested payloads pass.
export function redactObservation(observation, authorization) {
  if (!authorization?.scopes?.includes('observe') || authorization.roomId !== observation?.roomId) reject('observation_forbidden', 'Observation requires granted access to this room.');
  const result = { roomId: observation.roomId };
  for (const key of ['version', 'tick', 'time', 'realmId']) {
    const value = observation[key];
    if (typeof value === 'string' || (typeof value === 'number' && Number.isFinite(value))) result[key] = value;
  }
  const entities = Array.isArray(observation.entities) ? observation.entities : Object.values(observation.entities || {});
  result.entities = entities.filter(entity => entity && typeof entity === 'object').map(entity => {
    const safe = {};
    for (const key of ENTITY_KEYS) {
      const value = entity[key];
      if (typeof value === 'string' || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) safe[key] = value;
    }
    return safe;
  });
  return result;
}

// Events are trusted room-journal records, never accepted from an agent. Token
// generation occurs before the durable commit, so replays use only stored hashes.
export function applyCompanionEvent(state, event) {
  if (event.type === 'companion.granted') {
    const grant = structuredClone(event.grant);
    const records = registry(state);
    for (const item of Object.values(records.grants)) {
      if (item.revokedAt !== null || item.expiresAt <= grant.createdAt) {
        delete records.grants[item.id];
        delete records.tokenIndex[item.tokenHash];
      }
    }
    records.grants[grant.id] = grant;
    records.tokenIndex[grant.tokenHash] = grant.id;
    state.companions = records;
  } else if (event.type === 'companion.revoked') {
    const grant = registry(state).grants[event.grantId];
    if (!grant) reject('invalid_event', 'The replayed companion grant does not exist.');
    grant.revokedAt = event.at;
  } else if (event.type === 'companion.commandAuthorized') {
    const grant = registry(state).grants[event.grantId];
    if (!grant) reject('invalid_event', 'The replayed companion grant does not exist.');
    grant.commandTimes = [...event.commandTimes];
  } else reject('invalid_event', 'Unknown companion event.');
}
