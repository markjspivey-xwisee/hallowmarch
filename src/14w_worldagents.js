/* Native agents operate the real character and owned animals. The ordinary
 * player/pet controllers retain collision, range, cooldowns and damage rules. */
const MAIN_WORLD_AGENTS = { client: null, ownerKey: '', records: new Map(), allowed: new Set(), paused: true,
  busy: false, note: '', loaded: false, intent: null, attack: null, targets: new Map(), lastFrame: 0, lastGeneration: -1, reservedUuid: null };
const mainWorldAgentBodies = () => !GAME.started || !GAME.player || !NETWS.acct ? [] : [
  { id: NETWS.acct.id, name: 'Your character', entity: GAME.player },
  ...anCompanions().slice(0, 16).map(e => ({ id: NETWS.acct.id + ':animal:' + e.tame.aid, name: e.tame.name, entity: e })),
];
function mainWorldAgentStop(grantId = null) {
  const state = MAIN_WORLD_AGENTS;
  for (const key of ['intent', 'attack']) {
    const held = state[key]; if (!held || grantId && held.grantId !== grantId) continue;
    if (held.entity && held.entity !== GAME.player && anOwned(held.entity)) anCommand(held.entity, 'stay');
    if (key === 'attack' && held.entity?.target === held.targetId) held.entity.target = held.previousTarget;
    state[key] = null;
  }
}
function mainWorldAgentPause() {
  MAIN_WORLD_AGENTS.paused = true; mainWorldAgentStop(); mainWorldAgentFrame(true); mainWorldAgentRender();
}
function mainWorldAgentCanRun() {
  return GAME.started && !!GAME.player?.alive && NETWS.state === 'on' && !NETWS.worldPauseReason
    && !NETWS.reload && NATIVE_PLAYER.status?.verified && !MAIN_WORLD_AGENTS.paused && !UI.modal;
}
function mainWorldAgentMovement() {
  const held = MAIN_WORLD_AGENTS.intent;
  if (!held || held.entity !== GAME.player || !mainWorldAgentCanRun() || held.until <= Date.now()) return null;
  return { dx: held.dx, dz: held.dz };
}
function mainWorldAgentTick() {
  const state = MAIN_WORLD_AGENTS, manual = INPUT.joy || ['KeyW', 'KeyS', 'KeyA', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].some(k => INPUT.keys.has(k));
  if (!mainWorldAgentCanRun() || manual) { mainWorldAgentStop(); return; }
  for (const key of ['intent', 'attack']) if (state[key] && state[key].until <= Date.now()) {
    const held = state[key];
    if (held.entity !== GAME.player && anOwned(held.entity)) anCommand(held.entity, 'stay');
    if (key === 'attack' && held.entity?.target === held.targetId) held.entity.target = held.previousTarget;
    state[key] = null;
  }
}
function mainWorldAgentFrame(force = false) {
  if (!GAME.started || !GAME.player || NETWS.state !== 'on') return;
  const state = MAIN_WORLD_AGENTS;
  if (!force && (Date.now() - state.lastFrame < 500 || !state.allowed.size)) return;
  state.lastFrame = Date.now();
  const bodies = mainWorldAgentBodies().filter(b => b.entity === GAME.player || state.allowed.has(b.id));
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
  if (mainWorldAgentCanRun() && record?.registered && !record.grant?.revoked && body?.entity?.alive
    && MAIN_WORLD_AGENTS.allowed.has(command.entityId) && record.grant?.roomId === NETWS.worldRoom
    && record.grant.entityId === command.entityId && record.grant.actions.includes(command.type)
    && Date.parse(record.grant.expiresAt) > Date.now() && message.expiresAt > Date.now()) {
    const entity = body.entity;
    if (command.type === 'move' && [command.dx, command.dz].every(Number.isFinite)
      && Math.hypot(command.dx, command.dz) <= 1.01 && command.durationMs >= 50 && command.durationMs <= 500) {
      mainWorldAgentStop();
      MAIN_WORLD_AGENTS.intent = { entity, grantId: message.grantId, dx: command.dx, dz: command.dz,
        until: Math.min(message.expiresAt, Date.now() + command.durationMs) };
      if (entity !== GAME.player) {
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
        if (entity !== GAME.player) { entity.tame.prevCmd = entity.tame.cmd; entity.tame.cmd = 'attack'; }
        accepted = true;
      }
    }
  }
  netWsSend({ t: 'world-agent', op: 'result', requestId: message.requestId, ok: accepted });
}
async function mainWorldAgentContext() {
  const accountId = NETWS.acct?.id, token = NETWS.token;
  if (!accountId || !token || !GAME.started || !SAVE.native || !NATIVE_PLAYER.status?.verified) throw new Error('Sign in and enter your character first.');
  const status = await nativePlayerRequest('/gaming/identity/status');
  if (NETWS.acct?.id !== accountId || NETWS.token !== token || !status.verified || !status.bound
    || status.binding?.subjectDid !== NATIVE_PLAYER.status.binding?.subjectDid || status.binding?.podUrl !== NATIVE_PLAYER.status.binding?.podUrl) throw new Error('Reconnect the original owner identity.');
  const advertised = window.__HM_GAMING?.mainWorldAgents;
  if (!advertised?.enabled || advertised.audience !== location.origin || !advertised.applicationId) throw new Error('Main-world agent access is unavailable on this server.');
  const ownerKey = JSON.stringify([accountId, status.binding.subjectDid, status.binding.podUrl, advertised.applicationId, location.origin]);
  if (MAIN_WORLD_AGENTS.ownerKey && MAIN_WORLD_AGENTS.ownerKey !== ownerKey) throw new Error('The owner connection changed. Reload before opening agent access.');
  MAIN_WORLD_AGENTS.ownerKey = ownerKey;
  const current = () => { if (NETWS.acct?.id !== accountId || NETWS.token !== token || !NATIVE_PLAYER.status?.verified) throw new Error('The owner connection changed.'); };
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
    if (!held?.credential || held.credential.refreshToken || held.credential.expiresAt <= Date.now()) throw new Error('Reconnect your identity to access your pod.');
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
  state.busy = true; state.note = ''; mainWorldAgentRender();
  try { await run(await mainWorldAgentContext()); }
  catch (e) { state.note = e.message || 'Agent access is not confirmed. Retry its pending step.'; }
  finally { state.busy = false; mainWorldAgentRender(); }
}
async function mainWorldAgentRegister(context, record) {
  const read = await context.client.load(record.reference); context.current();
  if (!read || read.grant.revoked || Date.parse(read.grant.expiresAt) <= Date.now()
    || record.grant && ['actor', 'role', 'entityId', 'roomId'].some(k => record.grant[k] !== read.grant[k])
    || record.grant && JSON.stringify(record.grant.actions) !== JSON.stringify(read.grant.actions)) throw new Error('Your pod did not confirm the exact active access you selected.');
  const response = await context.request(context.actions.register, record.reference);
  if (response.ok !== true || response.result?.authority?.durable !== true
    || response.result.reference.grantId !== record.reference.grantId || response.result.reference.graphIri !== record.reference.graphIri
    || response.result.reference.ownerPlayerId !== NETWS.acct.id || response.result.reference.ownerDid !== NATIVE_PLAYER.status.binding.subjectDid
    || response.result.reference.revoked) throw new Error('The game has not confirmed this grant. Retry registration.');
  Object.assign(record, read, { registered: true, phase: '' });
  MAIN_WORLD_AGENTS.note = 'Access confirmed. Resume agent control below, close this panel, and share the grant ID and discovery link with your agent.';
}
async function mainWorldAgentPublish(context) {
  const state = MAIN_WORLD_AGENTS;
  if ([...state.records.values()].some(r => r.phase)) throw new Error('Finish the pending grant change first.');
  if (!$('world-agent-public').checked) throw new Error('Choose to publish this limited relationship in your pod first.');
  const body = mainWorldAgentBodies().find(b => b.id === $('world-agent-body').value);
  if (!body) throw new Error('Choose your character or one of your existing companions.');
  const role = $('world-agent-role').value;
  const actor = $('world-agent-did').value.trim();
  if (!/^did:web:[^\s]+:agents:[A-Za-z0-9][A-Za-z0-9._-]{0,255}$/.test(actor) || !['teammate', 'pet', 'coach'].includes(role)) throw new Error('Enter your agent’s native Agent DID and choose a role.');
  if (role === 'pet' && body.entity === GAME.player) throw new Error('Choose one of your existing animal companions for the pet role.');
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
function mainWorldAgentRender() {
  const parent = $('netsheet')?.querySelector('.sheet');
  if (!parent || !GAME.started || !window.__HM_GAMING?.mainWorldAgents?.enabled) return;
  let box = $('world-agent-controls');
  if (!box) {
    box = document.createElement('section'); box.id = 'world-agent-controls'; box.style.cssText = 'border-top:1px solid #806f4d;padding-top:12px;display:grid;gap:10px';
    box.innerHTML = '<h3>Agent access</h3><p>Your agent can operate your real character or an existing animal companion while this game is open. Human movement takes priority. Menus pause control. Private saves and personal learning stay private.</p><button class="btn" id="world-agent-load">Check access in my pod</button><form id="world-agent-form" style="display:grid;gap:10px"><label>Control<select id="world-agent-body"></select></label><label>Agent DID<input id="world-agent-did" autocomplete="off" spellcheck="false" required placeholder="did:…"></label><label>Role<select id="world-agent-role"><option value="teammate">Teammate</option><option value="pet">Animal companion</option><option value="coach">Coach · observe only</option></select></label><label style="display:flex;gap:10px;align-items:center"><input id="world-agent-public" type="checkbox">Publish this agent relationship, selected body and limited access in my pod for 15 minutes.</label><button class="btn" type="submit">Grant access</button></form><div style="display:flex;gap:10px;flex-wrap:wrap"><button class="btn" id="world-agent-resume">Resume agent control</button><button class="btn" id="world-agent-pause">Pause immediately</button></div><p id="world-agent-note" role="status" aria-live="polite"></p><div id="world-agent-records" style="overflow-wrap:anywhere"></div>';
    parent.appendChild(box);
    for (const n of box.querySelectorAll('button,input,select')) n.style.minHeight = '44px';
    $('world-agent-form').onsubmit = event => { event.preventDefault(); void mainWorldAgentRun(mainWorldAgentPublish); };
    $('world-agent-load').onclick = () => mainWorldAgentRun(mainWorldAgentLoad);
    $('world-agent-pause').onclick = mainWorldAgentPause;
    $('world-agent-resume').onclick = () => {
      MAIN_WORLD_AGENTS.allowed.clear();
      for (const r of MAIN_WORLD_AGENTS.records.values()) if (r.registered && !r.localRevoked && !r.grant?.revoked
        && Date.parse(r.grant?.expiresAt) > Date.now() && r.grant.roomId === NETWS.worldRoom) MAIN_WORLD_AGENTS.allowed.add(r.grant.entityId);
      MAIN_WORLD_AGENTS.paused = MAIN_WORLD_AGENTS.allowed.size === 0;
      MAIN_WORLD_AGENTS.note = MAIN_WORLD_AGENTS.paused ? 'No current confirmed grant is available for this character or its companions.'
        : 'Ready. Close this panel to resume agent access in the March.'; mainWorldAgentFrame(true); mainWorldAgentRender();
    };
  }
  const state = MAIN_WORLD_AGENTS, selector = $('world-agent-body'), bodies = mainWorldAgentBodies(), key = JSON.stringify(bodies.map(b => [b.id, b.name]));
  if (selector.dataset.bodyKey !== key) {
    const selected = selector.value; selector.replaceChildren(); selector.dataset.bodyKey = key;
    for (const body of bodies) { const option = document.createElement('option'); option.value = body.id; option.textContent = body.name; selector.appendChild(option); }
    if (bodies.some(b => b.id === selected)) selector.value = selected;
  }
  $('world-agent-note').textContent = state.note || (state.paused ? 'Agent control paused.' : 'Agent control resumes when this panel closes.');
  for (const button of box.querySelectorAll('form button,#world-agent-load')) button.disabled = state.busy;
  const records = $('world-agent-records');
  const recordKey = JSON.stringify([state.busy, location.origin, window.__HM_GAMING.mainWorldAgents.applicationId,
    [...state.records.values()].map(r => [r.reference.grantId, r.grant?.role, r.grant?.actor, r.grant?.roomId, r.grant?.entityId,
      r.grant?.applicationId, r.grant?.audience, r.grant?.expiresAt, !!r.registered, !!r.grant?.revoked, !!r.localRevoked,
      Date.parse(r.grant?.expiresAt) > Date.now(), r.phase || ''])]);
  // Polling must not replace a focused Revoke/Confirm button every 500 ms.
  if (records.dataset.recordKey === recordKey) return;
  records.dataset.recordKey = recordKey; records.replaceChildren();
  for (const record of state.records.values()) {
    const row = document.createElement('p'); row.textContent = `${record.grant?.revoked ? 'Revoked' : record.localRevoked ? 'Stopped here · finish pod revocation' : record.phase || 'Access confirmed'} · ${record.grant?.role || 'Grant'} · ${record.reference.grantId}`;
    const link = document.createElement('a'); link.href = window.__HM_GAMING.mainWorldAgents.affordances; link.target = '_blank'; link.rel = 'noopener'; link.textContent = ' Agent discovery'; row.appendChild(link);
    if (record.registered && !record.phase && !record.localRevoked && !record.grant?.revoked
      && Date.parse(record.grant?.expiresAt) > Date.now() && record.grant.audience === location.origin
      && record.grant.applicationId === window.__HM_GAMING.mainWorldAgents.applicationId) {
      const details = document.createElement('details'), summary = document.createElement('summary');
      summary.textContent = 'Agent connection details'; summary.style.minHeight = '44px'; details.appendChild(summary);
      const help = document.createElement('p');
      help.textContent = 'Share these public connection details with your agent’s tool host. Your agent signs as its own identity. Keep the game open and close this panel to resume control.';
      details.appendChild(help);
      const connection = JSON.stringify({ origin: location.origin, applicationId: record.grant.applicationId,
        agentDid: record.grant.actor, grantId: record.reference.grantId, roomId: record.grant.roomId,
        entityId: record.grant.entityId, module: location.origin + '/world/agent-client.mjs' }, null, 2);
      const field = document.createElement('textarea'); field.readOnly = true; field.rows = 9; field.value = connection;
      field.setAttribute('aria-label', 'Public agent connection details'); field.style.cssText = 'width:100%;box-sizing:border-box;font:12px monospace;min-height:160px';
      details.appendChild(field);
      const copy = document.createElement('button'); copy.type = 'button'; copy.className = 'btn'; copy.style.minHeight = '44px'; copy.textContent = 'Copy connection details';
      copy.onclick = async () => {
        try { await navigator.clipboard.writeText(connection); state.note = 'Public agent connection details copied.'; }
        catch { field.focus(); field.select(); state.note = 'Connection details selected. Copy the selected text for your agent.'; }
        mainWorldAgentRender();
      };
      details.appendChild(copy); row.appendChild(details);
    }
    if (!record.grant?.revoked) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'btn'; button.style.minHeight = '44px'; button.disabled = state.busy;
      button.textContent = record.phase || record.localRevoked ? 'Confirm pending change' : 'Revoke access';
      button.onclick = () => mainWorldAgentRun(context => { const current = state.records.get(record.reference.grantId);
        if (!current) throw new Error('Check your current access before changing it.');
        return current.phase || current.localRevoked ? mainWorldAgentRetry(context, current) : mainWorldAgentRevoke(context, current); }); row.appendChild(button);
    }
    records.appendChild(row);
  }
}
setInterval(() => {
  if (MAIN_WORLD_AGENTS.lastGeneration !== NETWS.generation) {
    MAIN_WORLD_AGENTS.lastGeneration = NETWS.generation; MAIN_WORLD_AGENTS.paused = true; mainWorldAgentStop();
  }
  mainWorldAgentFrame(); if (typeof NETUI !== 'undefined' && NETUI.open) mainWorldAgentRender();
}, 500);
addEventListener('blur', mainWorldAgentPause);
addEventListener('pagehide', () => { mainWorldAgentPause(); MAIN_WORLD_AGENTS.client?.close(); });
if (window.__hm) window.__hm.worldAgents = { state: MAIN_WORLD_AGENTS, frame: mainWorldAgentFrame, message: mainWorldAgentMessage,
  pause: mainWorldAgentPause, bodies: mainWorldAgentBodies };
