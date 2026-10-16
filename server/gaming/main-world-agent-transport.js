/** Bounded dispatch to a verified owner's actual running game page. Frames are
 * a small public gameplay projection, never a character/save/chat envelope. */
import { createHash, randomUUID } from 'node:crypto';
import { NativeAgentAuthorityError } from './native-agent-authority.js';
const fail = code => { throw new NativeAgentAuthorityError(code); };
const finite = (v, min, max) => Number.isFinite(v) && v >= min && v <= max;
// One maximum native grant can issue 20 inputs/second for one hour. Keep its
// exact receipts through the proof session, including renewals; an LRU would
// let an old logical ID execute again when re-signed with a fresh sequence.
const MAX_OWNER_COMMAND_RECEIPTS = 80_000;
export function createMainWorldAgentTransport({ principalFor, send, now = Date.now } = {}) {
  const owners = new Map(), pending = new Map();
  function frame(c, input) {
    const owner = principalFor(c);
    if (!owner || !c.acct?.id || !c.room?.name || !input || !Array.isArray(input.bodies) || input.bodies.length > 17) return false;
    // The namespace is derived from the authenticated account, not supplied by
    // a frame. A pet reference cannot claim another player's body.
    const bodies = [];
    for (const item of input.bodies) {
      if (!item || typeof item.id !== 'string' || (item.id !== c.acct.id
        && !(item.id.startsWith(c.acct.id + ':animal:') && /^[0-9]{1,9}$/.test(item.id.slice((c.acct.id + ':animal:').length))))) return false;
      if (![item.x, item.y, item.z].every(v => finite(v, -4000, 4000)) || !finite(item.hp, 0, 1e7)
        || !finite(item.maxHp, 1, 1e7) || typeof item.allowed !== 'boolean') return false;
      if (bodies.some(b => b.id === item.id)) return false;
      bodies.push({ id: item.id, kind: item.id === c.acct.id ? 'player' : 'companion',
        name: typeof item.name === 'string' ? item.name.slice(0, 40) : 'Companion',
        x: item.x, y: item.y, z: item.z, hp: item.hp, maxHp: item.maxHp, allowed: item.allowed });
    }
    const previous = owners.get(c.acct.id);
    if (previous && previous.client !== c && previous.at > now() - 3000 && previous.bodies.some(b => b.allowed)) {
      // A second signed-in tab cannot silently steal the running controller.
      send(c, { t: 'world-agent', op: 'status', error: 'another_owner_page_active' }); return false;
    }
    const targets = [];
    for (const item of Array.isArray(input.targets) ? input.targets.slice(0, 24) : []) {
      if (!item || typeof item.id !== 'string' || !/^[a-zA-Z0-9:_-]{1,100}$/.test(item.id)
        || ![item.x, item.y, item.z].every(v => finite(v, -4000, 4000)) || !finite(item.hp, 0, 1e7)
        || !finite(item.maxHp, 1, 1e7) || !bodies.some(b => Math.hypot(b.x - item.x, b.z - item.z) <= 30)) continue;
      targets.push({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 40) : 'Creature',
        x: item.x, y: item.y, z: item.z, hp: item.hp, maxHp: item.maxHp });
    }
    owners.set(c.acct.id, { client: c, ownerDid: owner, roomId: c.room.name, at: now(), paused: input.paused !== false,
      connectionId: c.peer, bodies, targets, commands: previous?.client === c ? previous.commands : new Map(),
      commandSessions: previous?.client === c ? previous.commandSessions : new Map() });
    if (input.paused !== false || !bodies.some(b => b.allowed)) stop(c.acct.id);
    return true;
  }
  function view(accountId, roomId, entityId) {
    const owner = owners.get(accountId);
    if (!owner || owner.paused || owner.at < now() - 3000 || owner.client.ws?.readyState !== 1
      || principalFor(owner.client) !== owner.ownerDid || owner.roomId !== roomId) return null;
    const body = owner.bodies.find(b => b.id === entityId && b.allowed);
    if (!body || body.hp <= 0) return null;
    return { ownerSession: owner.connectionId, at: owner.at, body: { ...body, allowed: undefined }, targets: owner.targets };
  }
  function dispatch(accountId, command, authorization) {
    const current = view(accountId, command.roomId, command.entityId), owner = owners.get(accountId);
    if (!current) fail('native_owner_page_unavailable');
    if (typeof authorization.sessionId !== 'string' || typeof authorization.isSessionActive !== 'function'
      || !command.commandId.startsWith(authorization.sessionId + ':') || !authorization.isSessionActive()) fail('native_agent_session_unavailable');
    // Consult the authority's actual session state, not the lease snapshot in
    // an old input: a native renewal can extend an otherwise idle session.
    // Expired/revoked session IDs cannot be reused in a newly admitted session.
    for (const [id, session] of owner.commandSessions) if (!session.isActive()) {
      for (const commandId of session.commandIds) owner.commands.delete(commandId);
      owner.commandSessions.delete(id);
    }
    if (command.type === 'attack' && !owner.targets.some(t => t.id === command.targetId && t.hp > 0)) fail('native_target_unavailable');
    const digest = createHash('sha256').update(JSON.stringify([authorization.grantId, command])).digest('hex');
    const old = owner.commands.get(command.commandId);
    if (old) { if (old.digest !== digest) fail('native_command_id_conflict'); return old.promise; }
    if (owner.commands.size >= MAX_OWNER_COMMAND_RECEIPTS || pending.size >= 64) fail('native_world_command_capacity');
    const requestId = randomUUID(), expiresAt = Math.min(authorization.expiresAt, now() + 1500);
    if (expiresAt <= now()) fail('native_agent_session_unavailable');
    let resolve, reject;
    const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
    const timer = setTimeout(() => { pending.delete(requestId); reject(new NativeAgentAuthorityError('native_execution_unconfirmed')); }, expiresAt - now());
    pending.set(requestId, { client: owner.client, accountId, grantId: authorization.grantId, resolve, reject, timer });
    owner.commands.set(command.commandId, { digest, promise });
    let session = owner.commandSessions.get(authorization.sessionId);
    if (!session) owner.commandSessions.set(authorization.sessionId, session = { isActive: authorization.isSessionActive, commandIds: new Set() });
    session.commandIds.add(command.commandId);
    // Receipts live until this proof session is inactive or its owner connection
    // closes. Renewing a session never discards its prior logical command IDs.
    send(owner.client, { t: 'world-agent', op: 'command', requestId, grantId: authorization.grantId, expiresAt, command });
    return promise;
  }
  function result(c, message) {
    const task = pending.get(message.requestId); if (!task || task.client !== c) return false;
    pending.delete(message.requestId); clearTimeout(task.timer);
    if (message.ok !== true) { task.reject(new NativeAgentAuthorityError('native_owner_input_refused')); return true; }
    // ACKs contain no arbitrary page payload: actual pose arrives in the next
    // redacted frame. This ACK means input applied, not damage/loot awarded.
    task.resolve({ accepted: true, execution: 'owner-page-input-applied', requestId: message.requestId }); return true;
  }
  function stop(accountId, grantId = null) {
    const owner = owners.get(accountId);
    if (owner) send(owner.client, { t: 'world-agent', op: 'stop', ...(grantId ? { grantId } : {}) });
    for (const [id, task] of pending) if (task.accountId === accountId && (!grantId || task.grantId === grantId)) {
      clearTimeout(task.timer); pending.delete(id); task.reject(new NativeAgentAuthorityError('native_owner_input_refused'));
    }
  }
  function close(c) { const owner = owners.get(c.acct?.id); if (owner?.client === c) { stop(c.acct.id); owners.delete(c.acct.id); } }
  function status() {
    let retainedCommandReceipts = 0, commandSessions = 0;
    for (const owner of owners.values()) { retainedCommandReceipts += owner.commands.size; commandSessions += owner.commandSessions.size; }
    return { owners: owners.size, pending: pending.size, retainedCommandReceipts, commandSessions,
      maxOwnerCommandReceipts: MAX_OWNER_COMMAND_RECEIPTS };
  }
  return { frame, view, dispatch, stop, result, close, status };
}
