/* Native agents operate their own party companion or an owned animal beside
 * the human. Ordinary controllers retain collision, range and combat rules. */
/* global activityRecord */
const MAIN_WORLD_AGENTS = { client: null, ownerKey: '', records: new Map(), allowed: new Set(), paused: true,
  companionPaused: false, busy: false, note: '', loaded: false, intent: null, attack: null, targets: new Map(), lastFrame: 0, lastGeneration: -1, reservedUuid: null,
  directory: null, directoryCurrent: null, directoryAgents: [], directoryKey: '', directoryNote: '', needsIdentity: false, dismissConfirm: null };
const mainWorldAgentIdentityError = message => Object.assign(new Error(message), { code: 'companion_identity_required' });
function mainWorldAgentIdentityRefused(error) {
  return error?.code === 'companion_identity_required' || [401, 403].includes(error?.httpStatus)
    || ['needs_reauth', 'invalid_credential', 'credential_expired', 'native_signin_required', 'account_required', 'owner_mismatch'].includes(error?.code);
}
function mainWorldAgentRequireIdentity() {
  MAIN_WORLD_AGENTS.needsIdentity = true; MAIN_WORLD_AGENTS.paused = true; MAIN_WORLD_AGENTS.companionPaused = true;
  mainWorldAgentStop(); partyCompanionStop();
}
function mainWorldAgentControlIssue() {
  if (!SAVE.native || !SAVE.readConfirmed || !NATIVE_PLAYER.status?.bound || !NATIVE_PLAYER.status?.verified || MAIN_WORLD_AGENTS.needsIdentity)
    return 'Open identity settings to confirm this character’s connection. Companion control stays paused until its connection is available.';
  if (NETWS.reload) return 'The account is reconnecting. Companion control stays paused until the connection is confirmed.';
  if (NETWS.state !== 'on') return 'The game connection is interrupted. Open Players to check its connection; companion control stays paused.';
  if (NETWS.worldPauseReason) return 'World recovery is in progress. Companion control stays paused until recovery finishes.';
  if (!GAME.player?.alive) return 'Your character has fallen. Return to your character before resuming a companion.';
  return '';
}
function mainWorldAgentDismissCurrent(choice = MAIN_WORLD_AGENTS.dismissConfirm) {
  const party = partyCompanionMember();
  return !!choice && party?.entity === choice.entity && party.id === choice.id && NETWS.acct?.id === choice.accountId
    && GAME.player === choice.player && NATIVE_PLAYER.status?.binding?.subjectDid === choice.ownerDid
    && NATIVE_PLAYER.status?.binding?.podUrl === choice.podUrl && SAVE.ref === choice.ref;
}
function mainWorldAgentFocusOwner() {
  return { player: GAME.player, account: NETWS.acct?.id, host: NETWS.host, did: NATIVE_PLAYER.status?.binding?.subjectDid,
    pod: NATIVE_PLAYER.status?.binding?.podUrl, ref: SAVE.ref };
}
const mainWorldAgentSameFocusOwner = (a, b = mainWorldAgentFocusOwner()) => !!a
  && ['player', 'account', 'host', 'did', 'pod', 'ref'].every(key => a[key] === b[key]);
const mainWorldAgentGrantFocusKey = record => JSON.stringify([record.reference.grantId, record.reference.graphIri,
  record.grant?.actor, record.grant?.entityId, record.grant?.applicationId, record.grant?.audience, record.grant?.roomId,
  record.grant?.role, record.grant?.actions, record.grant?.notBefore, record.grant?.expiresAt]);
function mainWorldAgentCaptureFocus() {
  const node = document.activeElement, box = $('world-agent-controls');
  if (!box?.contains(node)) return null;
  const row = node.closest('[data-world-agent-grant]');
  return { node, owner: row?._agentFocusOwner || mainWorldAgentFocusOwner(), id: node.id,
    grant: row?.dataset.worldAgentGrant, scope: row?.dataset.focusScope, body: row?._agentFocusBody,
    action: node.dataset.worldAgentAction };
}
function mainWorldAgentRestoreFocus(held) {
  const box = $('world-agent-controls');
  if (!held || !box || UI.modal !== 'menu' || UI.menuTab !== 'companion' || box.closest('[hidden]')) return;
  const visible = node => !!node && !node.disabled && !node.closest('[hidden], [inert]') && node.getClientRects().length
    && (!node.checkVisibility || node.checkVisibility({ visibilityProperty: true }));
  const sameOwner = mainWorldAgentSameFocusOwner(held.owner);
  const row = sameOwner && held.grant && [...box.querySelectorAll('[data-world-agent-grant]')].find(node =>
    node.dataset.worldAgentGrant === held.grant && node.dataset.focusScope === held.scope && node._agentFocusBody === held.body);
  if (sameOwner && (!held.grant || row) && document.activeElement === held.node && visible(held.node)) return;
  const exact = row ? [...row.querySelectorAll('[data-world-agent-action]')].find(node => node.dataset.worldAgentAction === held.action)
    : !held.grant && sameOwner ? held.id ? $(held.id) : held.node.isConnected ? held.node : null : null;
  const recovery = sameOwner && MAIN_WORLD_AGENTS.needsIdentity && $('world-agent-identity');
  const next = visible(exact) ? exact : !MAIN_WORLD_AGENTS.busy && visible(recovery) ? recovery
    : !MAIN_WORLD_AGENTS.busy && row ? row.querySelector('[data-world-agent-action="status"]') : $('world-agent-note');
  next?.focus({ preventScroll: true });
}
const mainWorldAgentBodies = () => !GAME.started || !GAME.player || !NETWS.acct ? [] : [
  ...partyCompanionBodies(),
  ...anCompanions().slice(0, 16).map(e => ({ id: NETWS.acct.id + ':animal:' + e.tame.aid, name: e.tame.name, entity: e })),
];
function mainWorldAgentStop(grantId = null) {
  const state = MAIN_WORLD_AGENTS;
  for (const key of ['intent', 'attack']) {
    const held = state[key]; if (!held || grantId && held.grantId !== grantId) continue;
    if (partyCompanionOwned(held.entity)) partyCompanionStop(held.entity);
    else if (held.entity && held.entity !== GAME.player && anOwned(held.entity)) anCommand(held.entity, 'stay');
    if (key === 'attack' && held.entity?.target === held.targetId) held.entity.target = held.previousTarget;
    state[key] = null;
  }
}
function mainWorldAgentPause() {
  MAIN_WORLD_AGENTS.paused = true; MAIN_WORLD_AGENTS.companionPaused = true; mainWorldAgentStop();
  partyCompanionStop(); mainWorldAgentFrame(true); mainWorldAgentRender();
}
function mainWorldAgentCanRun() {
  return (typeof netHumanLive !== 'function' || netHumanLive()) && GAME.started && !!GAME.player?.alive && NETWS.state === 'on' && !NETWS.worldPauseReason
    && !NETWS.reload && NATIVE_PLAYER.status?.verified && !MAIN_WORLD_AGENTS.needsIdentity && !MAIN_WORLD_AGENTS.paused && !UI.modal;
}
function mainWorldAgentMovement() {
  // The human always owns their character input. Kept for older controller
  // callers; native party access never supplies movement to GAME.player.
  return null;
}
function mainWorldAgentTick() {
  if (typeof netHumanLive === 'function' && !netHumanLive()) {
    mainWorldAgentStop(); partyCompanionStop(); return;
  }
  const state = MAIN_WORLD_AGENTS;
  if (!mainWorldAgentCanRun()) {
    mainWorldAgentStop();
    partyCompanionTick(GAME.dt, { paused: state.companionPaused || NETWS.state !== 'on' || !!NETWS.worldPauseReason
      || NETWS.reload || !NATIVE_PLAYER.status?.verified || state.needsIdentity }); return;
  }
  for (const key of ['intent', 'attack']) if (state[key] && state[key].until <= Date.now()) {
    const held = state[key];
    if (partyCompanionOwned(held.entity)) partyCompanionStop(held.entity);
    else if (held.entity !== GAME.player && anOwned(held.entity)) anCommand(held.entity, 'stay');
    if (key === 'attack' && held.entity?.target === held.targetId) held.entity.target = held.previousTarget;
    state[key] = null;
  }
  const intent = state.intent, attack = state.attack;
  const held = new Set([intent?.entity, attack?.entity].filter(Boolean));
  partyCompanionTick(GAME.dt, { held });
  if (intent && partyCompanionOwned(intent.entity) && intent.entity.alive
    && !intent.entity.motion && !intent.entity.casting && !isStunned(intent.entity)) {
    partyCompanionMove(intent.entity, intent.dx, intent.dz, GAME.dt);
  }
  if (attack && partyCompanionOwned(attack.entity)) {
    const target = getEnt(attack.targetId), e = attack.entity;
    if (!e.alive || !target?.alive || target.role === 'remote' || !isEnemy(e, target)
      || dist(e.x, e.z, target.x, target.z) > 30) { mainWorldAgentStop(attack.grantId); return; }
    if (!e.motion && !e.casting && !isStunned(e)) fightTarget(e, target, GAME.dt);
  }
}
function mainWorldAgentFrame(force = false) {
  if (!GAME.started || !GAME.player || NETWS.state !== 'on') return;
  const state = MAIN_WORLD_AGENTS;
  if (!force && (Date.now() - state.lastFrame < 500 || !state.allowed.size)) return;
  state.lastFrame = Date.now();
  const bodies = mainWorldAgentBodies().filter(b => state.allowed.has(b.id));
  const targets = [];
  state.targets.clear();
  for (const e of ENT) {
    if (targets.length >= 24) break;
    if (!e.alive || e.removed || e.role === 'remote' || e === GAME.player || !isEnemy(GAME.player, e)
      || !bodies.some(b => dist(b.entity.x, b.entity.z, e.x, e.z) <= 30)) continue;
    const id = String(e.id); state.targets.set(id, e);
    targets.push({ id, name: e.name || e.kind, x: e.x, y: e.y, z: e.z, hp: e.hp, maxHp: e.maxHp });
  }
  netWsSend({ t: 'world-agent', op: 'frame', paused: !mainWorldAgentCanRun(), targets,
    bodies: bodies.map(b => ({ id: b.id, name: b.entity.name || b.name, x: b.entity.x, y: b.entity.y, z: b.entity.z,
      hp: b.entity.hp, maxHp: b.entity.maxHp, allowed: state.allowed.has(b.id) })) });
}
function mainWorldAgentMessage(message) {
  if (message.op === 'stop') { mainWorldAgentStop(message.grantId || null); return; }
  if (message.op === 'status') { MAIN_WORLD_AGENTS.note = 'Another open game page is controlling agent access. Pause it before resuming here.'; mainWorldAgentPause(); return; }
  if (message.op !== 'command') return;
  const command = message.command, record = MAIN_WORLD_AGENTS.records.get(message.grantId);
  const body = mainWorldAgentBodies().find(b => b.id === command?.entityId);
  let accepted = false;
  if (mainWorldAgentCanRun() && record?.registered && !record.localRevoked && !record.grant?.revoked && body?.entity?.alive && !body.entity.removed
    && MAIN_WORLD_AGENTS.allowed.has(command.entityId) && record.grant?.roomId === NETWS.worldRoom
    && record.grant.entityId === command.entityId && command.roomId === NETWS.worldRoom && record.grant.actions.includes(command.type)
    && Date.parse(record.grant.expiresAt) > Date.now() && message.expiresAt > Date.now()) {
    const entity = body.entity;
    if (command.type === 'move' && [command.dx, command.dz].every(Number.isFinite)
      && Math.hypot(command.dx, command.dz) <= 1.01 && command.durationMs >= 50 && command.durationMs <= 500) {
      mainWorldAgentStop();
      MAIN_WORLD_AGENTS.intent = { entity, grantId: message.grantId, dx: command.dx, dz: command.dz,
        until: Math.min(message.expiresAt, Date.now() + command.durationMs) };
      if (!partyCompanionOwned(entity)) {
        anCommand(entity, 'stay'); entity.tame.stay = { x: entity.x + command.dx * 8, z: entity.z + command.dz * 8 };
      }
      accepted = true;
    } else if (command.type === 'attack') {
      const target = MAIN_WORLD_AGENTS.targets.get(command.targetId);
      if (target?.alive && target.role !== 'remote' && isEnemy(entity, target) && dist(entity.x, entity.z, target.x, target.z) <= 30) {
        mainWorldAgentStop();
        MAIN_WORLD_AGENTS.attack = { entity, grantId: message.grantId, targetId: target.id, previousTarget: entity.target,
          until: Math.min(message.expiresAt, Date.now() + 500) };
        entity.target = target.id;
        if (!partyCompanionOwned(entity)) { entity.tame.prevCmd = entity.tame.cmd; entity.tame.cmd = 'attack'; }
        accepted = true;
      }
    }
  }
  if (accepted) {
    record.lastCommandAt = Date.now();
    // Observation must not turn an already-applied gameplay input into a lost ACK.
    if (typeof activityRecord === 'function') {
      try { activityRecord('agent.command-accepted', command.type, 1,
        { entity: body.entity, actor: { kind: 'agent', id: record.grant.actor, grantId: message.grantId }, success: true }); }
      catch (error) { reportError(error); }
    }
  }
  netWsSend({ t: 'world-agent', op: 'result', requestId: message.requestId, ok: accepted });
}
async function mainWorldAgentContext() {
  const accountId = NETWS.acct?.id, token = NETWS.token;
  if (!accountId || !token || !GAME.started || !SAVE.native || !NATIVE_PLAYER.status?.verified) throw mainWorldAgentIdentityError('Sign in and enter your character first.');
  const status = await nativePlayerRequest('/gaming/identity/status');
  if (NETWS.acct?.id !== accountId || NETWS.token !== token || !status.verified || !status.bound
    || status.binding?.subjectDid !== NATIVE_PLAYER.status.binding?.subjectDid || status.binding?.podUrl !== NATIVE_PLAYER.status.binding?.podUrl) throw mainWorldAgentIdentityError('Reconnect the original owner identity.');
  const advertised = window.__HM_GAMING?.mainWorldAgents;
  if (!advertised?.enabled || advertised.audience !== location.origin || !advertised.applicationId) throw new Error('Main-world agent access is unavailable on this server.');
  const ownerKey = JSON.stringify([accountId, status.binding.subjectDid, status.binding.podUrl, advertised.applicationId, location.origin]);
  if (MAIN_WORLD_AGENTS.ownerKey && MAIN_WORLD_AGENTS.ownerKey !== ownerKey) throw new Error('The owner connection changed. Reload before opening agent access.');
  MAIN_WORLD_AGENTS.ownerKey = ownerKey;
  const current = () => { if (NETWS.acct?.id !== accountId || NETWS.token !== token || !NATIVE_PLAYER.status?.verified) throw mainWorldAgentIdentityError('The owner connection changed.'); };
  const request = async (target, body = {}, method = 'POST') => {
    current(); const url = new URL(target, location.origin);
    if (url.origin !== location.origin || url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) throw new Error('Agent access advertised an invalid target.');
    const response = await fetch(url.href, { method, cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(40000),
      headers: { Authorization: 'Bearer ' + token, ...(method === 'POST' ? { 'Content-Type': 'application/json' } : {}) },
      ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) });
    current(); if (!response.ok) throw new Error('Agent access is not confirmed. Keep this page open and retry the pending step.');
    return response.json();
  };
  const url = new URL(advertised.affordances);
  if (url.origin !== location.origin || url.protocol !== 'https:' || url.search || url.hash) throw new Error('Agent access advertised an invalid descriptor.');
  const document = await (await fetch(url.href, { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(15000) })).json(); current();
  if (!document.enabled || document.applicationId !== advertised.applicationId || document.audience !== location.origin || document.scope !== 'main-world') throw new Error('Main-world agent access could not be verified.');
  const actions = {};
  for (const name of ['register', 'revoke', 'ownerReferences']) {
    const operations = document.operations.filter(o => o['iep:action']?.['@id'] === 'urn:interego:hallowmarch:main-world-agent:' + name);
    if (operations.length !== 1 || operations[0]['hydra:method'] !== (name === 'ownerReferences' ? 'GET' : 'POST')) throw new Error('The game did not advertise owner control.');
    actions[name] = operations[0]['hydra:target'];
  }
  if (!MAIN_WORLD_AGENTS.client) {
    await nativePlayerModules(); current();
    const matches = await NATIVE_PLAYER.cache.list({});
    const match = matches.find(m => m.ownerDid === status.binding.subjectDid && m.podUrl === status.binding.podUrl && m.expiresAt > Date.now());
    const held = match && await NATIVE_PLAYER.cache.get(match); current();
    if (!held?.credential || held.credential.refreshToken || held.credential.expiresAt <= Date.now()) throw mainWorldAgentIdentityError('Reconnect your identity to access your pod.');
    const module = await import('/gaming/identity/assets/owner-agent-grant.mjs'); current();
    const client = module.createOwnerAgentGrants({ binding: status.binding, applicationId: advertised.applicationId,
      audience: location.origin, relayUrl: match.relayUrl, credential: held.credential,
      crypto: { subtle: crypto.subtle, getRandomValues: crypto.getRandomValues.bind(crypto), randomUUID: () => {
        const reserved = MAIN_WORLD_AGENTS.reservedUuid; MAIN_WORLD_AGENTS.reservedUuid = null; return reserved || crypto.randomUUID();
      } } });
    try { await client.connect(); current(); MAIN_WORLD_AGENTS.client = client; } catch (e) { client.close(); throw e; }
  }
  return { request, current, actions, advertised, client: MAIN_WORLD_AGENTS.client };
}
async function mainWorldAgentLoad(context) {
  const response = await context.request(context.actions.ownerReferences, {}, 'GET');
  for (const ref of response.result.references) {
    const record = await context.client.load(ref); context.current();
    if (record) MAIN_WORLD_AGENTS.records.set(ref.grantId, { ...record, registered: true, localRevoked: ref.revoked });
  }
  MAIN_WORLD_AGENTS.loaded = true;
}
async function mainWorldAgentRun(run) {
  const state = MAIN_WORLD_AGENTS; if (state.busy) return;
  const heldFocus = mainWorldAgentCaptureFocus();
  state.busy = true; state.note = ''; mainWorldAgentRender();
  const waitingFocus = document.activeElement;
  let moved = false;
  const trackFocus = event => { if (event.target !== waitingFocus) moved = true; };
  if (heldFocus) document.addEventListener('focusin', trackFocus);
  try { const context = await mainWorldAgentContext(); state.needsIdentity = false; await run(context); }
  catch (e) { if (mainWorldAgentIdentityRefused(e)) mainWorldAgentRequireIdentity(); state.note = e.message || 'Agent access is not confirmed. Retry its pending step.'; }
  finally {
    const restore = heldFocus && !moved && document.activeElement === waitingFocus;
    document.removeEventListener('focusin', trackFocus);
    state.busy = false; mainWorldAgentRender();
    if (restore) mainWorldAgentRestoreFocus(heldFocus);
  }
}
async function mainWorldAgentRegister(context, record) {
  const read = await context.client.load(record.reference); context.current();
  if (!read || read.grant.revoked || Date.parse(read.grant.expiresAt) <= Date.now()
    || !mainWorldAgentBodies().some(body => body.id === read.grant.entityId && body.entity !== GAME.player && body.entity.alive && !body.entity.removed)
    || record.grant && ['actor', 'role', 'entityId', 'roomId'].some(k => record.grant[k] !== read.grant[k])
    || record.grant && JSON.stringify(record.grant.actions) !== JSON.stringify(read.grant.actions)) throw new Error('Your pod did not confirm the exact active access you selected.');
  const response = await context.request(context.actions.register, record.reference);
  if (response.ok !== true || response.result?.authority?.durable !== true
    || response.result.reference.grantId !== record.reference.grantId || response.result.reference.graphIri !== record.reference.graphIri
    || response.result.reference.ownerPlayerId !== NETWS.acct.id || response.result.reference.ownerDid !== NATIVE_PLAYER.status.binding.subjectDid
    || response.result.reference.revoked) throw new Error('The game has not confirmed this grant. Retry registration.');
  Object.assign(record, read, { registered: true, phase: '' });
  MAIN_WORLD_AGENTS.note = 'Companion access is ready; waiting for your agent host to connect. Copy its connection details, resume agent control and close this panel.';
}
async function mainWorldAgentPublish(context) {
  const state = MAIN_WORLD_AGENTS;
  if ([...state.records.values()].some(r => r.phase)) throw new Error('Finish the pending grant change first.');
  if (!$('world-agent-public').checked) throw new Error('Choose to publish this limited relationship in your pod first.');
  const body = mainWorldAgentBodies().find(b => b.id === $('world-agent-body').value);
  if (!body || body.entity === GAME.player) throw new Error('Add your AI party companion or choose an owned animal. Your agent never controls your character.');
  if (!body.entity.alive) throw new Error('This companion is down and cannot accept agent control.');
  if (SAVE.native && (SAVE.pending || SAVE.nativeFlight || !SAVE.readConfirmed)) throw new Error('Confirm your companion’s private character save before granting access.');
  if ([...state.records.values()].some(r => r.grant?.entityId === body.id && !r.grant.revoked && !r.localRevoked
    && Date.parse(r.grant.expiresAt) > Date.now())) throw new Error('Revoke this companion’s current access before connecting another agent.');
  const role = $('world-agent-role').value;
  const choice = $('world-agent-choice').value;
  let actor = $('world-agent-did').value.trim();
  if (choice !== 'manual') {
    if (!choice || !state.directory || !state.directoryAgents.some(agent => agent.did === choice)) throw new Error('Choose your registered agent, or enter an agent ID in advanced setup.');
    state.directoryCurrent();
    const verified = await state.directory.verify(choice); context.current(); state.directoryCurrent();
    if (!verified.verified || verified.agent.did !== choice) throw new Error('This agent could not be verified. Refresh your agent list before granting access.');
    actor = choice;
  }
  if (!/^did:web:[^\s]+:agents:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(actor) || !['teammate', 'pet', 'coach'].includes(role)) throw new Error('Choose an Interego agent and its permissions.');
  if (actor === NATIVE_PLAYER.status.binding?.authenticatedAgentDid) throw new Error('Use your AI app’s agent identity, not this game browser’s identity.');
  if (role === 'pet' && partyCompanionOwned(body.entity)) throw new Error('Choose an owned animal for the animal companion role.');
  const expected = { actor, role, entityId: body.id, roomId: NETWS.worldRoom, actions: role === 'coach' ? ['observe'] : ['observe', 'move', 'attack'] };
  const id = crypto.randomUUID(), reference = { grantId: 'urn:uuid:' + id, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + id };
  const record = { reference, grant: expected, operationId: null, phase: 'publish', registered: false };
  state.records.set(reference.grantId, record); state.reservedUuid = id;
  let issued;
  try { issued = await context.client.publish({ publicDisclosureAccepted: true, ...expected, maxCommandsPerSecond: 5, lifetimeMs: 900000 }); }
  finally { state.reservedUuid = null; }
  context.current();
  if (issued.reference.grantId !== reference.grantId || issued.reference.graphIri !== reference.graphIri) throw new Error('The pod returned a different grant reference. Keep the pending operation open.');
  $('world-agent-public').checked = false;
  record.operationId = issued.operationId; record.phase = issued.saved ? 'register' : 'publish';
  if (issued.saved) await mainWorldAgentRegister(context, record);
  else state.note = 'Your pod publication is pending. Keep this page open and confirm it; do not create another grant.';
}
async function mainWorldAgentRetry(context, record) {
  if (record.phase === 'publish' || record.phase === 'pod-revoke-pending') {
    if (!record.operationId) {
      const read = await context.client.load(record.reference); context.current();
      if (!read) throw new Error('The exact pending grant is not confirmed in your pod yet. It has not been republished.');
      if (record.phase === 'publish') record.phase = 'register';
      else { if (!read.grant.revoked) throw new Error('The exact pod revocation is not confirmed yet.'); record.grant = read.grant; record.phase = ''; return; }
    } else {
    const result = await context.client.confirm(record.operationId); context.current();
    if (!result.saved) throw new Error('The same pod operation is still awaiting confirmation.');
    record.phase = record.phase === 'publish' ? 'register' : '';
    if (!record.phase) { record.grant.revoked = true; return; }
    }
  }
  if (record.phase === 'register') return mainWorldAgentRegister(context, record);
  if (record.phase === 'stop' || record.phase === 'pod-revoke' || record.localRevoked && !record.grant?.revoked) return mainWorldAgentRevoke(context, record);
}
async function mainWorldAgentRevoke(context, record) {
  mainWorldAgentPause(); mainWorldAgentStop(record.reference.grantId);
  if (!record.localRevoked) {
    record.phase = 'stop';
    const response = await context.request(context.actions.revoke, { grantId: record.reference.grantId });
    if (response.result?.revoked !== true || response.result.authority?.durable !== true) throw new Error('The game has not confirmed the stop yet. Retry stopping access.');
    record.localRevoked = true;
  }
  record.phase = 'pod-revoke';
  const result = await context.client.revoke(record.reference); context.current();
  record.phase = result.saved ? '' : 'pod-revoke-pending'; record.operationId = result.operationId;
  if (result.saved && record.grant) record.grant.revoked = true;
  MAIN_WORLD_AGENTS.note = result.saved ? 'Access revoked here and confirmed revoked in your pod.' : 'Access is stopped here. Your pod revocation is awaiting confirmation.';
}
function mainWorldAgentAccessStatus(record, body) {
  if (record.grant?.revoked) return 'Access revoked';
  if (record.phase) return ({ publish: 'Waiting for pod confirmation', register: 'Waiting for game confirmation',
    stop: 'Stopping access · confirmation needed', 'pod-revoke': 'Stopped here · confirm pod revocation',
    'pod-revoke-pending': 'Stopped here · confirm pod revocation' })[record.phase] || 'Access change needs confirmation';
  if (record.localRevoked) return 'Stopped here · confirm pod revocation';
  if (!record.registered) return 'Access is not confirmed';
  if (!(Date.parse(record.grant?.expiresAt) > Date.now())) return 'Access expired · connect again for a new session';
  if (record.grant.audience !== location.origin || record.grant.applicationId !== window.__HM_GAMING.mainWorldAgents.applicationId
    || record.grant.roomId !== NETWS.worldRoom) return 'Access unavailable in this March';
  if (!body) return 'Previous companion · access unavailable';
  if (!body.entity.alive) return 'Companion fallen · access unavailable';
  if (body.entity.removed) return 'Companion unavailable';
  if (NETWS.worldPauseReason) return 'World recovery · agent control paused';
  if (NETWS.reload) return 'Account reconnecting · agent control paused';
  if (NETWS.state !== 'on') return 'Connection interrupted · agent control paused';
  if (!NATIVE_PLAYER.status?.verified) return 'Reconnect your identity · agent control paused';
  if (!GAME.player.alive) return 'Your character has fallen · agent control paused';
  const input = record.lastCommandAt ? 'Agent input received' : 'Access ready · waiting for agent input';
  return input + (MAIN_WORLD_AGENTS.paused || !MAIN_WORLD_AGENTS.allowed.has(body.id) ? ' · control paused' : UI.modal ? ' · close this panel to allow input' : '');
}
function mainWorldAgentDirectoryClose() {
  const state = MAIN_WORLD_AGENTS;
  state.directory?.close(); state.directory = null; state.directoryCurrent = null;
  state.directoryAgents = []; state.directoryKey = ''; state.directoryNote = '';
}
async function mainWorldAgentDirectoryLoad() {
  const state = MAIN_WORLD_AGENTS; if (state.busy) return;
  state.busy = true; state.directoryNote = 'Looking up your registered agents…'; mainWorldAgentRender();
  const accountId = NETWS.acct?.id, token = NETWS.token, generation = NETWS.generation;
  const original = { ...NATIVE_PLAYER.status?.binding };
  const sameOwner = binding => ['subjectDid', 'podUrl', 'webId', 'authenticatedAgentDid'].every(key => original[key] && binding?.[key] === original[key]);
  const current = () => {
    if (!accountId || !token || NETWS.acct?.id !== accountId || NETWS.token !== token || NETWS.generation !== generation
      || NETWS.reload || !NATIVE_PLAYER.status?.bound || !NATIVE_PLAYER.status?.verified
      || !sameOwner(NATIVE_PLAYER.status.binding)) throw mainWorldAgentIdentityError('Reconnect your identity before choosing an agent.');
  };
  let directory;
  try {
    current(); const status = await nativePlayerRequest('/gaming/identity/status'); current();
    if (!status.verified || !status.bound || status.account?.id !== accountId
      || !sameOwner(status.binding)) throw mainWorldAgentIdentityError('Your owner identity could not be confirmed.');
    await nativePlayerModules(); current();
    const matches = await NATIVE_PLAYER.cache.list({}); current();
    const match = matches.find(item => item.ownerDid === status.binding.subjectDid && item.podUrl === status.binding.podUrl && item.expiresAt > Date.now());
    const held = match && await NATIVE_PLAYER.cache.get(match); current();
    if (!held?.credential || held.credential.refreshToken || held.credential.expiresAt <= Date.now()) throw mainWorldAgentIdentityError('Reconnect your identity to see your agents.');
    const module = await import('/gaming/identity/assets/agent-directory.mjs'); current();
    directory = module.createOwnerAgentDirectory({ binding: status.binding, credential: held.credential, relayUrl: match.relayUrl });
    const result = await directory.list(); current();
    if (result.ownerDid !== status.binding.subjectDid || result.podUrl !== status.binding.podUrl) throw new Error('Your agent list belongs to a different identity.');
    mainWorldAgentDirectoryClose(); state.directory = directory; state.directoryCurrent = current;
    state.directoryAgents = result.agents.filter(agent => agent.did !== status.binding.authenticatedAgentDid);
    state.directoryKey = JSON.stringify(state.directoryAgents);
    state.needsIdentity = false;
    state.directoryNote = state.directoryAgents.length ? 'Choose the agent you use in your AI app. Nothing is connected or authorized yet.'
      : 'No other registered agents were found. Connect Interego in your AI app first, then refresh this list.';
    directory = null;
  } catch (error) {
    if (mainWorldAgentIdentityRefused(error)) mainWorldAgentRequireIdentity();
    mainWorldAgentDirectoryClose(); state.directoryNote = error?.message || 'Your agents could not be read. Reconnect your identity and try again.';
  } finally { directory?.close(); state.busy = false; mainWorldAgentRender(); }
}
function mainWorldAgentChoice() {
  const choice = $('world-agent-choice'), field = $('world-agent-did'), manual = $('world-agent-manual');
  const entered = choice.value === 'manual';
  manual.open = entered; field.required = entered;
  if (entered && field.dataset.fromPicker) { field.value = ''; delete field.dataset.fromPicker; }
  if (!entered) { field.value = choice.value; field.dataset.fromPicker = 'true'; }
}
async function mainWorldAgentCopy(text, fallback, message) {
  try { await navigator.clipboard.writeText(text); MAIN_WORLD_AGENTS.note = message; }
  catch {
    for (let parent = fallback.parentElement; parent; parent = parent.parentElement) if (parent.tagName === 'DETAILS') parent.open = true;
    fallback.hidden = false; fallback.value = text; fallback.focus(); fallback.select();
    MAIN_WORLD_AGENTS.note = 'Text selected. Copy it, then paste it into your AI app.';
  }
  mainWorldAgentRender();
}
function mainWorldAgentRender() {
  const heldFocus = mainWorldAgentCaptureFocus();
  const parent = $('world-agent-mount');
  if (!parent || !GAME.started) return;
  if (!window.__HM_GAMING?.mainWorldAgents?.enabled) { parent.textContent = 'Companion setup is unavailable on this server.'; return; }
  let box = $('world-agent-controls');
  if (!box) {
    box = document.createElement('section'); box.id = 'world-agent-controls'; box.style.cssText = 'border-top:1px solid #806f4d;padding-top:12px;display:grid;gap:10px';
    box.innerHTML = `
      <h2>Your companion</h2>
      <p>Add a party member that follows, guards or supports you. These built-in behaviors work without an LLM.</p>
      <div id="world-agent-prerequisite"><p id="world-agent-prerequisite-note">Connect your identity and open your private character to save and manage a companion.</p><button type="button" class="btn" id="world-agent-identity">Open identity settings</button><button type="button" class="btn" id="world-agent-retry-identity" hidden>Retry companion connection</button></div>
      <div style="display:grid;gap:10px">
        <label>Companion name<input id="world-agent-companion-name" maxlength="32" value="Companion"></label>
        <button class="btn" id="world-agent-create">Add companion</button>
        <p id="world-agent-party" role="status"></p>
        <label>Companion behavior<select id="world-agent-party-role"><option value="follow">Follow me</option><option value="guard">Guard this position</option><option value="support">Support my target</option></select></label>
        <details id="world-agent-options"><summary>Companion options</summary>
          <button class="btn" id="world-agent-dismiss">Review dismissal…</button>
          <div id="world-agent-dismiss-confirm" hidden>
            <p id="world-agent-dismiss-warning"></p>
            <button class="btn" id="world-agent-dismiss-cancel">Keep companion</button>
            <button class="btn" id="world-agent-dismiss-confirm-button">Dismiss companion and revoke its access</button>
          </div>
        </details>
      </div>
      <details id="world-agent-advanced">
        <summary style="min-height:44px">Use my own AI agent</summary>
        <p>Your AI app runs the model. Hallowmarch gives it limited access to a companion. Granting access does not connect a subscription or start an agent.</p>
        <details id="world-agent-model-help"><summary>Using ChatGPT or Claude</summary>
          <p>This game does not yet offer a one-click ChatGPT or Claude connection. Your AI app needs a compatible game tool connection and an Interego identity. A configured desktop or self-hosted agent can use the supplied game adapter; a cloud chat app needs a hosted connection.</p>
          <p>Keep the game open while playing together. A chat subscription alone does not keep an agent running in the background.</p>
        </details>
        <h3>1. Choose your agent</h3>
        <p>An agent has a name and an Interego identity. Look up the agents already registered with your identity; you do not need to invent an ID.</p>
        <button class="btn" type="button" id="world-agent-find">Find my registered agents</button>
        <p id="world-agent-directory-status" role="status" aria-live="polite"></p>
        <form id="world-agent-form" style="display:grid;gap:10px">
          <label>My agent<select id="world-agent-choice" required><option value="">Choose an agent</option><option value="manual">Use an agent ID from another app…</option></select></label>
          <details id="world-agent-manual"><summary>Advanced: enter an agent ID</summary>
            <p>In your AI app, connect Interego and ask it to show its current agent identity. Use that app’s agent ID, not the game browser’s identity or your human identity.</p>
            <button class="btn" type="button" id="world-agent-copy-identity">Copy a request for my AI app</button>
            <textarea id="world-agent-identity-request" hidden readonly rows="4" aria-label="Request for my AI app" style="width:100%;box-sizing:border-box"></textarea>
            <label>Interego agent ID (DID)<input id="world-agent-did" autocomplete="off" spellcheck="false" placeholder="did:web:…:agents:…"></label>
          </details>
          <h3>2. Give limited access</h3>
          <label>Companion<select id="world-agent-body"></select></label>
          <label>Agent permissions<select id="world-agent-role"><option value="teammate">Move and fight alongside me</option><option value="pet">Control my animal companion</option><option value="coach">Read-only observer</option></select></label>
          <label style="display:flex;gap:10px;align-items:center"><input id="world-agent-public" type="checkbox">Publish this agent relationship, selected companion and limited access in my pod for 15 minutes.</label>
          <button class="btn" type="submit">Grant companion access · 15 minutes</button>
        </form>
        <h3>3. Connect it from your AI app</h3>
        <p>After access is confirmed, copy the setup instructions below into your compatible agent host. It must connect and prove its own identity before it can play.</p>
        <button class="btn" id="world-agent-load">Check existing access</button>
      </details>
      <p id="world-agent-connection" role="status"></p>
      <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="world-agent-resume">Resume companion</button><button class="btn" id="world-agent-pause">Pause immediately</button></div>
      <p id="world-agent-note" role="status" aria-live="polite" tabindex="-1"></p>
      <div id="world-agent-records" style="overflow-wrap:anywhere"></div>`;
    parent.appendChild(box);
    for (const n of box.querySelectorAll('button,input,select,summary')) n.style.minHeight = '44px';
    for (const label of box.querySelectorAll('label')) if (!label.querySelector('input[type="checkbox"]')) {
      label.style.display = 'grid'; label.style.gap = '6px';
    }
    for (const n of box.querySelectorAll('input:not([type="checkbox"]),select')) { n.style.width = '100%'; n.style.minWidth = '0'; n.style.boxSizing = 'border-box'; n.style.fontSize = '16px'; }
    $('world-agent-form').onsubmit = event => { event.preventDefault(); void mainWorldAgentRun(mainWorldAgentPublish); };
    $('world-agent-identity').onclick = openPlayerIdentity;
    $('world-agent-retry-identity').onclick = () => mainWorldAgentRun(mainWorldAgentLoad);
    $('world-agent-find').onclick = () => { void mainWorldAgentDirectoryLoad(); };
    $('world-agent-choice').onchange = mainWorldAgentChoice;
    $('world-agent-manual').ontoggle = () => {
      if ($('world-agent-manual').open && $('world-agent-choice').value !== 'manual') {
        $('world-agent-choice').value = 'manual'; mainWorldAgentChoice();
      }
    };
    $('world-agent-copy-identity').onclick = () => { void mainWorldAgentCopy(
      'Using your connected Interego account, read get_pod_status and show the active sessionAgent.did, its label and the pod it belongs to. Do not register a new agent or change permissions. I need this agent identity for Hallowmarch.',
      $('world-agent-identity-request'), 'Identity request copied. Paste it into your AI app with Interego connected.'); };
    $('world-agent-load').onclick = () => mainWorldAgentRun(mainWorldAgentLoad);
    $('world-agent-create').onclick = () => mainWorldAgentRun(async context => {
      partyCompanionCreate($('world-agent-companion-name').value, GAME.player.cls);
      await saveNow(); context.current();
      if (SAVE.pending || SAVE.nativeFlight) throw new Error('Your party member is here. Confirm its pending private save before connecting an agent.');
      MAIN_WORLD_AGENTS.note = 'Your companion is saved and ready to use its built-in behavior. Choose Resume companion and close this menu to play.';
    });
    $('world-agent-party-role').onchange = () => {
      partyCompanionSetRole($('world-agent-party-role').value); mainWorldAgentStop();
      MAIN_WORLD_AGENTS.note = 'Party role updated. Your human character’s controls are unchanged.'; mainWorldAgentRender();
    };
    $('world-agent-dismiss').onclick = () => {
      const party = partyCompanionMember();
      if (MAIN_WORLD_AGENTS.busy || !party) return;
      MAIN_WORLD_AGENTS.dismissConfirm = { entity: party.entity, id: party.id, accountId: NETWS.acct?.id,
        player: GAME.player, ownerDid: NATIVE_PLAYER.status?.binding?.subjectDid, podUrl: NATIVE_PLAYER.status?.binding?.podUrl, ref: SAVE.ref };
      mainWorldAgentRender(); $('world-agent-dismiss-cancel').focus({ preventScroll: true });
    };
    $('world-agent-dismiss-cancel').onclick = () => {
      MAIN_WORLD_AGENTS.dismissConfirm = null; mainWorldAgentRender(); $('world-agent-dismiss').focus({ preventScroll: true });
    };
    $('world-agent-dismiss-confirm-button').onclick = () => {
      const choice = MAIN_WORLD_AGENTS.dismissConfirm;
      if (!mainWorldAgentDismissCurrent(choice)) { MAIN_WORLD_AGENTS.dismissConfirm = null; mainWorldAgentRender(); return; }
      return mainWorldAgentRun(async context => {
        const current = () => { context.current(); if (!mainWorldAgentDismissCurrent(choice)) throw new Error('The companion or owner changed. Review dismissal again; nothing else was dismissed.'); };
        current();
        if ([...MAIN_WORLD_AGENTS.records.values()].some(record => record.phase)) throw new Error('Confirm the pending access change before dismissing your companion.');
        await mainWorldAgentLoad(context); current();
        const body = partyCompanionMember();
        if (!body) throw new Error('No companion is present to dismiss.');
        for (const record of MAIN_WORLD_AGENTS.records.values()) if (record.grant?.entityId === body.id && !record.grant.revoked) {
          await mainWorldAgentRevoke(context, record); current();
          if (!record.grant.revoked) throw new Error('Confirm this companion’s pending pod revocation before dismissing it.');
        }
        partyCompanionDismiss(); await saveNow(); context.current();
        MAIN_WORLD_AGENTS.dismissConfirm = null;
        MAIN_WORLD_AGENTS.note = SAVE.pending ? 'Companion dismissed here. Confirm the pending private save.' : 'Companion dismissed and saved privately.';
      });
    };
    $('world-agent-pause').onclick = mainWorldAgentPause;
    $('world-agent-resume').onclick = () => {
      const issue = mainWorldAgentControlIssue();
      if (MAIN_WORLD_AGENTS.busy || issue) { MAIN_WORLD_AGENTS.note = issue; mainWorldAgentRender(); return; }
      MAIN_WORLD_AGENTS.allowed.clear();
      for (const r of MAIN_WORLD_AGENTS.records.values()) if (r.registered && !r.phase && !r.localRevoked && !r.grant?.revoked
        && Date.parse(r.grant?.expiresAt) > Date.now() && r.grant.roomId === NETWS.worldRoom
        && mainWorldAgentBodies().some(body => body.id === r.grant.entityId && body.entity.alive && body.entity !== GAME.player)) MAIN_WORLD_AGENTS.allowed.add(r.grant.entityId);
      MAIN_WORLD_AGENTS.paused = MAIN_WORLD_AGENTS.allowed.size === 0;
      MAIN_WORLD_AGENTS.companionPaused = false;
      MAIN_WORLD_AGENTS.note = MAIN_WORLD_AGENTS.paused ? 'Built-in companion behavior will resume when this panel closes. No external agent access was enabled.'
        : 'Ready. Close this panel to resume agent access in the March.'; mainWorldAgentFrame(true); mainWorldAgentRender();
    };
  }
  const state = MAIN_WORLD_AGENTS, selector = $('world-agent-body'), bodies = mainWorldAgentBodies(), key = JSON.stringify(bodies.map(b => [b.id, b.name]));
  const baseReady = SAVE.native && SAVE.readConfirmed && NATIVE_PLAYER.status?.bound && NATIVE_PLAYER.status?.verified;
  const ready = baseReady && !state.needsIdentity;
  const issue = mainWorldAgentControlIssue(), handoff = !ready || NETWS.reload || NETWS.state !== 'on';
  $('world-agent-prerequisite').hidden = !issue;
  $('world-agent-prerequisite-note').textContent = state.needsIdentity
    ? 'Sign in again in identity settings, then choose Retry companion connection. Your companion and existing access records are kept.' : issue;
  $('world-agent-identity').hidden = !handoff;
  $('world-agent-identity').textContent = ready ? 'Open Players' : 'Open identity settings';
  $('world-agent-identity').disabled = state.busy;
  $('world-agent-retry-identity').hidden = !state.needsIdentity || !baseReady;
  $('world-agent-retry-identity').disabled = state.busy;
  const agentSelector = $('world-agent-choice');
  if (agentSelector.dataset.directoryKey !== state.directoryKey) {
    const selected = agentSelector.value; agentSelector.replaceChildren(); agentSelector.dataset.directoryKey = state.directoryKey;
    for (const agent of [{ did: '', label: 'Choose an agent' }, ...state.directoryAgents, { did: 'manual', label: 'Use an agent ID from another app…' }]) {
      const option = document.createElement('option'); option.value = agent.did;
      option.textContent = agent.label + (agent.surface ? ' · ' + agent.surface : ''); agentSelector.appendChild(option);
    }
    if (selected === 'manual' || state.directoryAgents.some(agent => agent.did === selected)) agentSelector.value = selected;
  }
  $('world-agent-directory-status').textContent = state.directoryNote;
  $('world-agent-find').disabled = state.busy || !ready;
  const party = partyCompanionMember();
  const changing = [...state.records.values()].some(record => record.phase);
  if (state.dismissConfirm && (!mainWorldAgentDismissCurrent() || changing)) state.dismissConfirm = null;
  $('world-agent-create').disabled = state.busy || !!party || !ready;
  $('world-agent-create').hidden = !!party;
  $('world-agent-companion-name').disabled = state.busy || !!party;
  $('world-agent-companion-name').parentElement.hidden = !!party;
  if (party) $('world-agent-companion-name').value = party.name;
  const partyRole = party && { follow: 'Follow me', guard: 'Guard this position', support: 'Support my target' }[PARTY_COMPANION.record.role];
  $('world-agent-party').textContent = party ? party.entity.alive ? `${party.name} · ${partyRole} · ${CLASSES[party.entity.cls].name}`
    : `${party.name} has fallen. Revival is not available. Dismiss this companion to add a new one; dismissal first confirms that its agent access is revoked. Your character is kept.`
    : 'No companion yet. Add one to get started.';
  const partyAccess = party && [...state.records.values()].filter(r => r.grant?.entityId === party.id && !r.grant.revoked);
  const latestAccess = partyAccess?.at(-1);
  $('world-agent-connection').textContent = !party || !party.entity.alive ? '' : latestAccess
    ? 'Your AI connection: ' + mainWorldAgentAccessStatus(latestAccess, party) + '.'
    : 'Built-in companion behavior is ready. No external AI agent is connected.';
  $('world-agent-party-role').parentElement.hidden = !party;
  $('world-agent-party-role').disabled = state.busy || !ready || !party || !party.entity.alive;
  if (party) $('world-agent-party-role').value = PARTY_COMPANION.record.role;
  $('world-agent-options').hidden = !party;
  $('world-agent-dismiss').hidden = !!state.dismissConfirm; $('world-agent-dismiss').disabled = state.busy || !ready || changing;
  $('world-agent-dismiss-confirm').hidden = !state.dismissConfirm;
  $('world-agent-dismiss-cancel').disabled = state.busy;
  $('world-agent-dismiss-confirm-button').disabled = state.busy || !ready;
  $('world-agent-dismiss-warning').textContent = party ? `Dismiss ${party.name}? This removes this companion and revokes its current agent access before removal. Your own character, earned progress and past activity records stay intact.` : '';
  const usable = [...state.records.values()].filter(r => r.registered && !r.phase && !r.localRevoked && !r.grant?.revoked
    && Date.parse(r.grant?.expiresAt) > Date.now() && r.grant.roomId === NETWS.worldRoom
    && bodies.some(body => body.id === r.grant.entityId && body.entity.alive && !body.entity.removed));
  const running = !!party?.entity.alive && !state.companionPaused || !state.paused && usable.some(r => state.allowed.has(r.grant.entityId));
  $('world-agent-resume').textContent = party ? 'Resume companion' : 'Resume agent control';
  $('world-agent-resume').hidden = !issue && running || !party && !usable.length;
  $('world-agent-resume').disabled = state.busy || !!issue || !ready || !GAME.player.alive || !(party?.entity.alive && !party.entity.removed || usable.length);
  $('world-agent-pause').hidden = !running;
  if (selector.dataset.bodyKey !== key) {
    const selected = selector.value; selector.replaceChildren(); selector.dataset.bodyKey = key;
    for (const body of bodies) { const option = document.createElement('option'); option.value = body.id; option.textContent = body.name; selector.appendChild(option); }
    if (bodies.some(b => b.id === selected)) selector.value = selected;
  }
  $('world-agent-note').textContent = state.note || (state.busy ? 'Confirming companion access… Keep this game open.' : issue)
    || (party ? state.companionPaused ? 'Companion paused.' : 'Companion behavior resumes when this panel closes.' : 'Add a companion to get started.');
  for (const button of box.querySelectorAll('form button,#world-agent-load')) button.disabled = state.busy || !ready;
  const records = $('world-agent-records');
  const pending = [...state.records.values()].find(record => !record.grant?.revoked && (record.phase || record.localRevoked));
  const highlight = () => {
    const primary = handoff ? $('world-agent-identity') : state.dismissConfirm ? $('world-agent-dismiss-confirm-button')
      : pending ? [...records.querySelectorAll('button[data-grant-id]')].find(button => button.dataset.grantId === pending.reference.grantId)
        : !party ? $('world-agent-create') : !issue && party.entity.alive ? running ? $('world-agent-pause') : $('world-agent-resume') : null;
    for (const button of box.querySelectorAll('button')) button.classList.toggle('primary', button === primary && !button.hidden);
  };
  const rows = [...state.records.values()].map(record => {
    const body = bodies.find(b => b.id === record.grant?.entityId) || (party?.id === record.grant?.entityId ? party : null);
    return { record, body, status: mainWorldAgentAccessStatus(record, body) };
  });
  const recordKey = JSON.stringify([location.origin, window.__HM_GAMING.mainWorldAgents.applicationId,
    rows.map(({ record: r, body, status }) => [r.reference.grantId, r.grant?.role, r.grant?.actor, r.grant?.roomId, r.grant?.entityId,
      r.grant?.applicationId, r.grant?.audience, r.grant?.expiresAt, !!r.registered, !!r.grant?.revoked, !!r.localRevoked,
      Date.parse(r.grant?.expiresAt) > Date.now(), r.phase || '', !!r.lastCommandAt, body?.name, !!body?.entity.alive,
      !!body?.entity.removed, status])]);
  const finish = () => {
    for (const button of records.querySelectorAll('button[data-grant-id]')) button.disabled = state.busy || !ready;
    highlight(); mainWorldAgentRestoreFocus(heldFocus);
  };
  // Busy state changes disable the existing nodes. Content changes preserve
  // disclosure and focus only for the exact grant, owned body and owner.
  const sameBodies = records._agentFocusBodies?.size === rows.length
    && rows.every(({ record, body }) => records._agentFocusBodies.get(record.reference.grantId) === body?.entity);
  if (records.dataset.recordKey === recordKey && mainWorldAgentSameFocusOwner(records._agentFocusOwner) && sameBodies) { finish(); return; }
  const disclosures = mainWorldAgentSameFocusOwner(records._agentFocusOwner) ? records._agentDisclosures || new Map() : new Map();
  for (const details of records.querySelectorAll('details')) {
    const row = details.closest('[data-world-agent-grant]');
    if (mainWorldAgentSameFocusOwner(row._agentFocusOwner)) disclosures.set(row.dataset.worldAgentGrant,
      { open: details.open, scope: row.dataset.focusScope, body: row._agentFocusBody, owner: row._agentFocusOwner });
  }
  for (const id of disclosures.keys()) if (!state.records.has(id)) disclosures.delete(id);
  records._agentDisclosures = disclosures;
  records._agentFocusOwner = mainWorldAgentFocusOwner();
  records._agentFocusBodies = new Map(rows.map(({ record, body }) => [record.reference.grantId, body?.entity]));
  records.dataset.recordKey = recordKey; records.replaceChildren();
  for (const { record, body: currentBody, status } of rows) {
    const row = document.createElement('p'); row.dataset.worldAgentGrant = record.reference.grantId;
    row.dataset.focusScope = mainWorldAgentGrantFocusKey(record); row._agentFocusOwner = records._agentFocusOwner; row._agentFocusBody = currentBody?.entity;
    const statusNode = document.createElement('span'); statusNode.textContent = `${currentBody?.name || 'Previous companion'} · ${status}`;
    statusNode.tabIndex = -1; statusNode.dataset.worldAgentAction = 'status'; row.appendChild(statusNode);
    if (record.registered && !record.phase && !record.localRevoked && !record.grant?.revoked
      && Date.parse(record.grant?.expiresAt) > Date.now() && record.grant.audience === location.origin
      && record.grant.applicationId === window.__HM_GAMING.mainWorldAgents.applicationId && record.grant.roomId === NETWS.worldRoom
      && currentBody?.entity.alive && !currentBody.entity.removed) {
      const details = document.createElement('details'), summary = document.createElement('summary');
      const disclosure = disclosures.get(record.reference.grantId);
      details.open = !!(disclosure?.open && disclosure.scope === row.dataset.focusScope && disclosure.body === currentBody.entity && mainWorldAgentSameFocusOwner(disclosure.owner));
      summary.dataset.worldAgentAction = 'details';
      summary.textContent = 'Agent connection details'; summary.style.minHeight = '44px'; details.appendChild(summary);
      const link = document.createElement('a'); link.href = window.__HM_GAMING.mainWorldAgents.affordances; link.target = '_blank'; link.rel = 'noopener'; link.textContent = 'Agent discovery'; details.appendChild(link);
      link.dataset.worldAgentAction = 'discovery';
      const help = document.createElement('p');
      help.textContent = 'Share these public connection details with your agent’s tool host. Your agent signs as its own identity. Keep the game open and close this panel to resume control.';
      details.appendChild(help);
      const connection = JSON.stringify({ origin: location.origin, applicationId: record.grant.applicationId,
        agentDid: record.grant.actor, grantId: record.reference.grantId, roomId: record.grant.roomId,
        entityId: record.grant.entityId, module: location.origin + '/world/agent-client.mjs' }, null, 2);
      const field = document.createElement('textarea'); field.readOnly = true; field.rows = 9; field.value = connection;
      field.dataset.worldAgentAction = 'connection';
      field.setAttribute('aria-label', 'Public agent connection details'); field.style.cssText = 'width:100%;box-sizing:border-box;font:12px monospace;min-height:160px';
      details.appendChild(field);
      const setup = document.createElement('button'); setup.type = 'button'; setup.className = 'btn'; setup.style.minHeight = '44px'; setup.textContent = 'Copy setup instructions for my agent';
      setup.dataset.worldAgentAction = 'setup';
      setup.onclick = () => { void mainWorldAgentCopy('Connect to my Hallowmarch companion using these public connection details. Use your own Interego signing identity and the game’s advertised native admission flow. If you do not have a compatible game tool host, explain what connection is missing; do not claim to be connected or invent commands. Do not register another identity or widen this grant. Only the listed companion is authorized.\n\n' + connection, field, 'Agent setup instructions copied. Paste them into your compatible AI app or agent host.'); };
      row.appendChild(setup);
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn'; copy.style.minHeight = '44px'; copy.textContent = 'Copy raw connection details';
      copy.dataset.worldAgentAction = 'copy';
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(connection); state.note = 'Public agent connection details copied.'; }
        catch { field.focus(); field.select(); state.note = 'Connection details selected. Copy the selected text for your agent.'; }
        mainWorldAgentRender();
      };
      details.appendChild(copy); row.appendChild(details);
    }
    if (!record.grant?.revoked) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.style.minHeight = '44px'; button.disabled = state.busy || !ready;
      button.textContent = record.phase || record.localRevoked ? 'Confirm pending change' : 'Revoke access';
      button.dataset.grantId = record.reference.grantId;
      button.dataset.worldAgentAction = record.phase || record.localRevoked ? 'confirm' : 'revoke';
      button.onclick = () => mainWorldAgentRun(context => { const current = state.records.get(record.reference.grantId);
        if (!current) throw new Error('Check your current access before changing it.');
        return current.phase || current.localRevoked ? mainWorldAgentRetry(context, current) : mainWorldAgentRevoke(context, current); }); row.appendChild(button);
    }
    records.appendChild(row);
  }
  finish();
}
setInterval(() => {
  if (typeof netHumanLive === 'function' && !netHumanLive()) return;
  if (MAIN_WORLD_AGENTS.lastGeneration !== NETWS.generation) {
    mainWorldAgentDirectoryClose();
    MAIN_WORLD_AGENTS.lastGeneration = NETWS.generation; MAIN_WORLD_AGENTS.paused = true; MAIN_WORLD_AGENTS.companionPaused = true; mainWorldAgentStop(); partyCompanionStop();
  }
  mainWorldAgentFrame(); if (UI.modal === 'menu' && UI.menuTab === 'companion') mainWorldAgentRender();
}, 500);
addEventListener('blur', mainWorldAgentPause);
addEventListener('pagehide', () => { mainWorldAgentPause(); MAIN_WORLD_AGENTS.client?.close(); mainWorldAgentDirectoryClose(); });
if (window.__hm) window.__hm.worldAgents = { state: MAIN_WORLD_AGENTS, frame: mainWorldAgentFrame, message: mainWorldAgentMessage,
  pause: mainWorldAgentPause, bodies: mainWorldAgentBodies };
