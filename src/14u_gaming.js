/* A deliberately separate shared expedition. Enabled only by a ready server;
 * legacy world entities, local combat and the character's inventory stay outside
 * this adapter. Every displayed encounter outcome comes from the room service. */
const GAMING = { status: 'idle', roomId: '', version: -1, snapshot: null, pending: new Map(),
  request: 0, updatedAt: 0, lastError: '', open: false, focus: null, socket: null, session: null, timer: 0 };
const gamingEnabled = () => window.__HM_GAMING?.enabled === true;
const gamingConnected = () => typeof NETWS !== 'undefined' && NETWS.state === 'on' && NETWS.ws?.readyState === 1 && !!NETWS.acct?.id;
const gamingSelf = () => typeof NETWS !== 'undefined' ? NETWS.acct?.id || '' : '';
const gamingSessionCurrent = () => gamingConnected() && GAMING.session?.socket === NETWS.ws && GAMING.session?.accountId === gamingSelf() && GAMING.session?.generation === NETWS.generation;
const gamingList = value => Array.isArray(value) ? value : Object.values(value || {});
const gamingError = error => String(error?.message || error || 'The expedition could not complete that action.').slice(0, 240);

function gamingRequest(op, payload = {}) {
  if (!gamingEnabled()) return Promise.reject(new Error('Shared expeditions are not available on this server.'));
  if (!gamingConnected()) return Promise.reject(new Error('Reconnect to the March before entering the expedition.'));
  if (op !== 'enter' && !gamingSessionCurrent()) return Promise.reject(new Error('The expedition connection changed. Enter again to resume.'));
  if (GAMING.pending.size >= 8) return Promise.reject(new Error('Wait for the pending expedition actions to finish.'));
  const requestId = `gaming-${Date.now()}-${++GAMING.request}`;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      GAMING.pending.delete(requestId);
      reject(new Error('The expedition did not confirm this action. Refresh its state before trying again.'));
    }, 15000);
    GAMING.pending.set(requestId, { resolve, reject, timeout, op, socket: NETWS.ws, accountId: gamingSelf(), generation: NETWS.generation });
    if (!netWsSend({ ...payload, t: 'gaming', op, requestId })) {
      clearTimeout(timeout); GAMING.pending.delete(requestId);
      reject(new Error('The expedition connection is unavailable.'));
    }
  });
}
function gamingRejectPending(reason) {
  for (const pending of GAMING.pending.values()) { clearTimeout(pending.timeout); pending.reject(new Error(reason)); }
  GAMING.pending.clear();
}
async function gamingEnter() {
  if (!gamingEnabled()) throw new Error('Shared expeditions are not available on this server.');
  if (GAMING.status === 'entering') throw new Error('Your expedition entry is awaiting confirmation.');
  if (GAMING.status === 'joined' && gamingSessionCurrent()) return gamingObserve();
  GAMING.roomId = ''; GAMING.version = -1; GAMING.snapshot = null;
  GAMING.session = gamingConnected() ? { socket: NETWS.ws, accountId: gamingSelf(), generation: NETWS.generation } : null;
  GAMING.socket = GAMING.session?.socket || null;
  GAMING.status = 'entering'; GAMING.lastError = ''; gamingRender();
  try {
    const result = await gamingRequest('enter');
    GAMING.status = 'joined';
    if (result?.roomId) GAMING.roomId = result.roomId;
    await gamingObserve();
    return result;
  } catch (error) { GAMING.status = 'idle'; GAMING.lastError = gamingError(error); throw error; }
  finally { gamingRender(); }
}
async function gamingLeave() {
  const result = await gamingRequest('leave', { roomId: GAMING.roomId });
  GAMING.status = 'idle'; GAMING.roomId = ''; GAMING.version = -1; GAMING.snapshot = null; GAMING.session = null;
  gamingClearToken(); gamingRender(); return result;
}
function gamingCommand(command) {
  if (GAMING.status !== 'joined') return Promise.reject(new Error('Enter the shared expedition first.'));
  if (!command || typeof command !== 'object' || !command.type) return Promise.reject(new Error('Choose an expedition action.'));
  return gamingRequest('command', { roomId: GAMING.roomId,
    command: { ...command, roomId: GAMING.roomId, commandId: command.commandId || crypto.randomUUID() } });
}
function gamingObserve() {
  if (!['joined', 'entering'].includes(GAMING.status)) return Promise.reject(new Error('Enter the shared expedition first.'));
  return gamingRequest('observe', { roomId: GAMING.roomId });
}
async function gamingGrant(request) {
  if (GAMING.status !== 'joined') throw new Error('Enter the shared expedition first.');
  const result = await gamingRequest('grant', { roomId: GAMING.roomId,
    commandId: crypto.randomUUID(), request: { ...request } });
  await gamingObserve(); return result;
}
async function gamingRevoke(grantId) {
  if (GAMING.status !== 'joined') throw new Error('Enter the shared expedition first.');
  const result = await gamingRequest('revoke', { roomId: GAMING.roomId, commandId: crypto.randomUUID(), grantId });
  gamingClearToken(); await gamingObserve(); return result;
}

function gamingPublicState(value) {
  const id = field => typeof field === 'string' && field.length > 0 && field.length <= 512 && !/[\x00-\x1f]/.test(field);
  const entities = gamingList(value.entities);
  if (!value.entities || typeof value.entities !== 'object' || entities.length > 256 || entities.some(entity =>
    !entity || typeof entity !== 'object' || !id(entity.id) || !['player', 'companion', 'npc'].includes(entity.kind) ||
    !Number.isFinite(entity.x) || !Number.isFinite(entity.z) || !Number.isFinite(entity.hp) || entity.hp < 0 ||
    !Number.isFinite(entity.maxHp) || entity.maxHp <= 0 || entity.hp > entity.maxHp)) return null;
  const safe = { entities: entities.map(entity => {
    const out = { id: entity.id, kind: entity.kind, x: entity.x, z: entity.z, hp: entity.hp, maxHp: entity.maxHp };
    for (const key of ['name', 'ownerPlayerId', 'teamId', 'realmId']) if (typeof entity[key] === 'string') out[key] = entity[key].slice(0, 512);
    return out;
  }), loot: [], grants: [], rewards: {}, consent: { enabled: value.consent?.enabled === true } };
  for (const drop of gamingList(value.loot).slice(0, 128)) {
    if (!drop || !id(drop.id) || !id(drop.targetId)) continue;
    safe.loot.push({ id: drop.id, targetId: drop.targetId, itemId: String(drop.itemId || 'Expedition reward').slice(0, 80),
      claimedBy: typeof drop.claimedBy === 'string' ? drop.claimedBy.slice(0, 512) : null });
  }
  for (const grant of gamingList(value.grants).slice(0, 8)) {
    if (!grant || !id(grant.id) || !id(grant.agentId) || !['teammate', 'pet', 'coach'].includes(grant.role) || !Number.isSafeInteger(grant.expiresAt)) continue;
    safe.grants.push({ id: grant.id, agentId: grant.agentId, role: grant.role, entityId: String(grant.entityId || '').slice(0, 512),
      expiresAt: grant.expiresAt, revokedAt: Number.isSafeInteger(grant.revokedAt) ? grant.revokedAt : null });
  }
  for (const [key, quantity] of Object.entries(value.rewards || {}).slice(0, 128)) {
    if (id(key) && Number.isSafeInteger(quantity) && quantity >= 0) Object.defineProperty(safe.rewards, key, { value: quantity, enumerable: true });
  }
  return safe;
}
function gamingSnapshot(message) {
  if (!['entering', 'joined'].includes(GAMING.status) || typeof message.roomId !== 'string' ||
      !message.roomId.length || message.roomId.length > 128 || !Number.isSafeInteger(message.version) || message.version < 0 ||
      !message.state || typeof message.state !== 'object' || Array.isArray(message.state) || !gamingSessionCurrent()) return;
  if (GAMING.roomId && message.roomId !== GAMING.roomId) return;
  if (message.state.roomId !== undefined && message.state.roomId !== message.roomId) return;
  if (message.version < GAMING.version) return;
  const snapshot = gamingPublicState(message.state);
  if (!snapshot) return;
  GAMING.roomId = message.roomId; GAMING.version = message.version;
  GAMING.snapshot = snapshot; GAMING.updatedAt = performance.now();
  gamingRender();
}
function gamingMsg(message) {
  if (!gamingEnabled() || message?.t !== 'gaming') return;
  if (message.op === 'snapshot') { gamingSnapshot(message); return; }
  if (message.op !== 'result') return;
  const pending = GAMING.pending.get(message.requestId);
  if (!pending) return;
  clearTimeout(pending.timeout); GAMING.pending.delete(message.requestId);
  if (!gamingConnected() || pending.socket !== NETWS.ws || pending.accountId !== gamingSelf() || pending.generation !== NETWS.generation) {
    pending.reject(new Error('The expedition connection changed. Enter again to resume.')); return;
  }
  if (message.ok === true) pending.resolve(message.result || {});
  else {
    const error = new Error(gamingError(message.error));
    if (message.error?.code) error.code = message.error.code;
    pending.reject(error);
  }
}

function gamingNode(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  return node;
}
function gamingButton(text, action) {
  const button = gamingNode('button', text, 'btn'); button.type = 'button';
  button.addEventListener('click', () => gamingRun(action, button)); return button;
}
async function gamingRun(action, button) {
  if (button?.disabled) return;
  if (button) button.disabled = true;
  GAMING.lastError = ''; gamingStatus();
  try { await action(); }
  catch (error) { GAMING.lastError = gamingError(error); }
  finally { if (button) button.disabled = false; gamingRender(); }
}
function gamingClearToken() {
  const token = $('gaming-token');
  if (token) { token.value = ''; $('gaming-token-wrap').hidden = true; }
}
function gamingStatus() {
  const status = $('gaming-status');
  if (!status) return;
  const connected = gamingConnected(), age = GAMING.updatedAt ? Math.max(0, Math.floor((performance.now() - GAMING.updatedAt) / 1000)) : null;
  const ping = connected && NETWS.stats.rtt > 0 ? ` Connection round trip: ${NETWS.stats.rtt} ms.` : '';
  status.textContent = GAMING.lastError || (GAMING.status === 'joined' ?
    `${connected ? 'In the shared expedition.' : 'Connection lost.'}${age === null ? ' Awaiting shared state.' : ` State confirmed ${age}s ago.`}${ping}` :
    GAMING.status === 'entering' ? 'Waiting for expedition entry to be confirmed…' :
      connected ? 'Ready to enter a shared expedition.' : 'Connect to the March to enter a shared expedition.');
  status.classList.toggle('gaming-failure', !!GAMING.lastError || GAMING.status === 'disconnected');
}
function gamingEntitySelect() {
  const select = $('gaming-entity');
  if (!select) return;
  const selected = select.value, self = gamingSelf();
  const entities = gamingList(GAMING.snapshot?.entities).filter(entity => entity.ownerPlayerId === self && ['player', 'companion'].includes(entity.kind));
  select.replaceChildren();
  for (const entity of entities) {
    const option = gamingNode('option', entity.name || (entity.kind === 'player' ? 'Your expedition body' : 'Your companion'));
    option.value = entity.id; select.appendChild(option);
  }
  if (entities.some(entity => entity.id === selected)) select.value = selected;
}
function gamingSelectedEntity() {
  const id = $('gaming-entity')?.value || gamingSelf();
  return gamingList(GAMING.snapshot?.entities).find(entity => entity.id === id);
}
function gamingRender() {
  if (!$('gaming-sheet')) return;
  gamingStatus();
  const joined = GAMING.status === 'joined';
  $('gaming-enter').hidden = joined; $('gaming-enter').disabled = !gamingConnected() || GAMING.status === 'entering';
  $('gaming-live').hidden = !joined; $('gaming-leave').hidden = !joined;
  gamingEntitySelect();
  const entities = $('gaming-entities'); entities.replaceChildren();
  for (const entity of gamingList(GAMING.snapshot?.entities).slice(0, 128)) {
    const card = gamingNode('div', undefined, 'gaming-card');
    card.appendChild(gamingNode('strong', entity.name || entity.id));
    const hp = Number.isFinite(entity.hp) ? Math.max(0, entity.hp) : 0;
    card.appendChild(gamingNode('span', `${entity.kind === 'npc' ? 'Enemy' : entity.kind === 'companion' ? 'Companion' : 'Player'} · ${hp}/${entity.maxHp || 0} health`));
    card.appendChild(gamingNode('small', `Position ${Number(entity.x || 0).toFixed(1)}, ${Number(entity.z || 0).toFixed(1)}`));
    if (entity.kind === 'npc' && hp > 0) {
      const attack = gamingButton('Attack', () => gamingCommand({ type: 'attack', entityId: gamingSelectedEntity()?.id, targetId: entity.id }));
      attack.disabled = !joined; card.appendChild(attack);
    }
    entities.appendChild(card);
  }
  const loot = $('gaming-loot'); loot.replaceChildren();
  const drops = gamingList(GAMING.snapshot?.loot);
  if (!drops.length) loot.appendChild(gamingNode('p', 'Defeat the guardian to reveal the expedition reward.'));
  for (const drop of drops.slice(0, 128)) {
    const card = gamingNode('div', undefined, 'gaming-card');
    card.appendChild(gamingNode('span', drop.itemId || 'Expedition reward'));
    if (drop.claimedBy) card.appendChild(gamingNode('small', drop.claimedBy === gamingSelf() ? 'Claimed by you' : 'Claimed by another player'));
    else card.appendChild(gamingButton('Claim reward', () => gamingCommand({ type: 'claimLoot', entityId: gamingSelectedEntity()?.id, targetId: drop.targetId })));
    loot.appendChild(card);
  }
  const grants = $('gaming-grants'); grants.replaceChildren();
  const active = gamingList(GAMING.snapshot?.grants).filter(grant => grant.revokedAt == null && grant.expiresAt > Date.now());
  if (!active.length) grants.appendChild(gamingNode('p', 'No companion agents have access.'));
  for (const grant of active.slice(0, 8)) {
    const card = gamingNode('div', undefined, 'gaming-card');
    card.appendChild(gamingNode('strong', `${grant.role}: ${grant.agentId}`));
    card.appendChild(gamingNode('small', `Access expires ${new Date(grant.expiresAt).toLocaleTimeString()}`));
    card.appendChild(gamingButton('Revoke access', () => gamingRevoke(grant.id))); grants.appendChild(card);
  }
  $('gaming-learning').textContent = GAMING.snapshot?.consent?.enabled ?
    'Learning export is linked. Your existing consent applies to expedition activity.' :
    'Personal learning export is off. Link a verified learning identity before sharing activity with Foxxi.';
}

function gamingToggle(open = !GAMING.open) {
  if (!gamingEnabled() || !$('gaming-sheet')) return false;
  if (open) {
    if (UI.modal && !['menu', 'mobile', 'gaming'].includes(UI.modal)) return false;
    GAMING.focus = document.activeElement;
    if (UI.modal === 'menu') closeMenu();
    if (UI.modal === 'mobile') mobileTray(false, false);
    mobileStopInput(); UI.modal = 'gaming'; GAMING.open = true;
    $('gaming-sheet').hidden = false; gamingRender(); $('gaming-close').focus();
  } else {
    $('gaming-sheet').hidden = true; GAMING.open = false; gamingClearToken();
    if (UI.modal === 'gaming') UI.modal = null;
    const focus = GAMING.focus?.getClientRects().length ? GAMING.focus : $(IS_TOUCH ? 'mobile-menu-toggle' : 'btn-menu');
    focus?.focus({ preventScroll: true });
  }
  return true;
}
function gamingInit() {
  if (!gamingEnabled() || $('gaming-sheet')) return;
  const style = gamingNode('style');
  style.textContent = `#gaming-sheet .sheet{width:min(620px,100%);box-sizing:border-box;gap:14px}#gaming-sheet .gaming-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-20px;background:var(--slate-2);z-index:2;padding-block:8px}#gaming-sheet .gaming-head h2{font-size:24px}#gaming-sheet .btn{min-height:46px;touch-action:manipulation;white-space:normal}#gaming-sheet input,#gaming-sheet select{min-width:0;max-width:100%;box-sizing:border-box;min-height:46px;font-size:16px}#gaming-sheet label{display:grid;gap:6px}#gaming-sheet section,#gaming-sheet form,#gaming-live{display:grid;gap:10px;min-width:0}#gaming-sheet [hidden]{display:none!important}#gaming-sheet .gaming-card{display:grid;gap:6px;border:1px solid var(--line);padding:10px;overflow-wrap:anywhere}#gaming-sheet .gaming-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#gaming-sheet .gaming-move{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#gaming-sheet .gaming-move button:first-child{grid-column:2}#gaming-sheet .gaming-move button:nth-child(2){grid-column:1}#gaming-sheet .gaming-move button:last-child{grid-column:2}#gaming-sheet .gaming-failure{color:#f4b29c}#gaming-token{width:100%;overflow-wrap:anywhere}#gaming-menu-open{margin-block:8px}@media(max-width:420px){#gaming-sheet .sheet{padding:12px}#gaming-sheet .gaming-head{top:-12px}#gaming-sheet .gaming-grid{grid-template-columns:minmax(0,1fr)}}`;
  document.head.appendChild(style);
  const overlay = gamingNode('div'); overlay.id = 'gaming-sheet'; overlay.className = 'overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="gaming-title"><div class="gaming-head"><h2 id="gaming-title">Shared expedition</h2><button class="btn" id="gaming-close" type="button">Close ×</button></div><p>A shared guardian encounter. Expedition progress and rewards stay in this expedition.</p><p id="gaming-status" role="status" aria-live="polite"></p><button class="btn primary" id="gaming-enter" type="button">Enter shared expedition</button><div id="gaming-live" hidden><section><h3>Expedition controls</h3><label>Control body<select id="gaming-entity"></select></label><div class="gaming-move" aria-label="Move one pace"><button class="btn" type="button" data-gaming-dx="0" data-gaming-dz="1">Forward</button><button class="btn" type="button" data-gaming-dx="-1" data-gaming-dz="0">Left</button><button class="btn" type="button" data-gaming-dx="1" data-gaming-dz="0">Right</button><button class="btn" type="button" data-gaming-dx="0" data-gaming-dz="-1">Back</button></div><button class="btn" type="button" id="gaming-refresh">Refresh shared state</button></section><section><h3>In the expedition</h3><div id="gaming-entities" class="gaming-grid"></div></section><section><h3>Expedition rewards</h3><div id="gaming-loot"></div></section><section><h3>Your agent companions</h3><p>Choose an agent and the body it can control. Coach access is observation only. Access expires after 15 minutes and can be revoked at any time.</p><button class="btn" type="button" id="gaming-spawn">Create companion body</button><form id="gaming-grant-form"><label>Agent DID<input id="gaming-agent" maxlength="512" placeholder="did:…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label><label>Companion role<select id="gaming-role"><option value="teammate">Teammate</option><option value="pet">Pet</option><option value="coach">Coach · observe only</option></select></label><button class="btn" type="submit">Grant access to selected body</button></form><div id="gaming-token-wrap" hidden><label>One-time agent capability<input id="gaming-token" readonly autocomplete="off" spellcheck="false"></label><p>Give this capability to your chosen agent. It is cleared when this sheet closes.</p><button class="btn" id="gaming-token-clear" type="button">Clear capability</button></div><div id="gaming-grants"></div></section><section><h3>Learning &amp; activity</h3><p id="gaming-learning"></p></section></div><button class="btn" id="gaming-leave" type="button" hidden>Leave expedition</button></div>';
  document.body.appendChild(overlay);
  $('gaming-close').onclick = () => gamingToggle(false);
  $('gaming-enter').onclick = () => gamingRun(gamingEnter, $('gaming-enter'));
  $('gaming-leave').onclick = () => gamingRun(gamingLeave, $('gaming-leave'));
  $('gaming-refresh').onclick = () => gamingRun(gamingObserve, $('gaming-refresh'));
  $('gaming-spawn').onclick = () => gamingRun(() => gamingCommand({ type: 'spawnCompanion', name: 'Expedition companion' }), $('gaming-spawn'));
  $('gaming-token-clear').onclick = gamingClearToken;
  $('gaming-grant-form').onsubmit = event => {
    event.preventDefault();
    gamingRun(async () => {
      gamingClearToken();
      const result = await gamingGrant({ agentId: $('gaming-agent').value.trim(), role: $('gaming-role').value,
        entityId: gamingSelectedEntity()?.id, expiresAt: Date.now() + 900000, maxCommandsPerSecond: 5 });
      const issued = result?.result || result;
      if (GAMING.open && typeof issued?.token === 'string') { $('gaming-token').value = issued.token; $('gaming-token-wrap').hidden = false; $('gaming-token').focus(); $('gaming-token').select(); }
    }, $('gaming-grant-form').querySelector('button'));
  };
  overlay.addEventListener('click', event => {
    if (event.target === overlay) gamingToggle(false);
    const button = event.target.closest('button[data-gaming-dx]');
    if (button) gamingRun(() => {
      const entity = gamingSelectedEntity();
      if (!entity) throw new Error('Choose your expedition body.');
      return gamingCommand({ type: 'move', entityId: entity.id, x: entity.x + Number(button.dataset.gamingDx), z: entity.z + Number(button.dataset.gamingDz) });
    }, button);
  });
  addEventListener('keydown', event => {
    if (!GAMING.open) return;
    if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); gamingToggle(false); }
    else if (event.key === 'Tab') {
      const controls = [...overlay.querySelectorAll('button,input,select')].filter(node => !node.disabled && node.getClientRects().length);
      const first = controls[0], last = controls.at(-1);
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
    }
  }, true);
  addEventListener('pagehide', gamingClearToken);
  const menu = $('menu')?.querySelector('.actions');
  if (menu) { const button = gamingButton('Shared expedition', () => gamingToggle(true)); button.id = 'gaming-menu-open'; menu.before(button); }
  const tray = $('mobile-tray-panel');
  if (tray) { const section = gamingNode('section'); section.dataset.mobileSection = 'social'; const button = gamingButton('Shared expedition', () => gamingToggle(true)); button.id = 'gaming-mobile-open'; section.appendChild(button); tray.appendChild(section); }
  GAMING.socket = typeof NETWS !== 'undefined' ? NETWS.ws : null;
  GAMING.timer = setInterval(() => {
    const socket = typeof NETWS !== 'undefined' ? NETWS.ws : null;
    if ((!gamingSessionCurrent() || socket !== GAMING.socket) && ['entering', 'joined'].includes(GAMING.status)) {
      GAMING.status = 'disconnected'; gamingClearToken(); gamingRejectPending('The expedition connection changed. Enter again to resume.'); gamingRender();
    }
    GAMING.socket = socket; if (GAMING.open) gamingStatus();
  }, 1000);
  gamingRender();
}
if (window.__hm) window.__hm.gaming = {
  get enabled() { return gamingEnabled(); },
  get state() { return { status: GAMING.status, roomId: GAMING.roomId, version: GAMING.version,
    snapshot: structuredClone(GAMING.snapshot), pending: GAMING.pending.size, error: GAMING.lastError }; },
  enter: gamingEnter, leave: gamingLeave, observe: gamingObserve, command: gamingCommand,
  grant: gamingGrant, revoke: gamingRevoke, show: gamingToggle, msg: gamingMsg,
};
gamingInit();
