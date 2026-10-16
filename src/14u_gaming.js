/* A deliberately separate shared expedition. Enabled only by a ready server;
 * legacy world entities, local combat and the character's inventory stay outside
 * this adapter. Every displayed encounter outcome comes from the room service. */
const GAMING = { status: 'idle', roomId: '', version: -1, snapshot: null, pending: new Map(),
  request: 0, updatedAt: 0, lastError: '', open: false, focus: null, socket: null, session: null, timer: 0,
  attackingUntil: 0, movingUntil: 0, moving: false, lastAttackVersion: -1, autoOpened: false };
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
  const safe = { encounter: { sequence: Number.isSafeInteger(value.encounter?.sequence) && value.encounter.sequence > 0 ? value.encounter.sequence : 1,
    defeatedAt: Number.isSafeInteger(value.encounter?.defeatedAt) && value.encounter.defeatedAt > 0 ? value.encounter.defeatedAt : null }, entities: entities.map(entity => {
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
  const copy = $('gaming-token-copy'); if (copy) copy.textContent = 'Copy capability';
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
function gamingEnemy() {
  return gamingList(GAMING.snapshot?.entities).find(entity => entity.kind === 'npc');
}
async function gamingMove(dx, dz) {
  const entity = gamingSelectedEntity();
  if (!entity) throw new Error('Choose your expedition body.');
  if (GAMING.moving || performance.now() < GAMING.movingUntil) return;
  GAMING.movingUntil = performance.now() + 180;
  GAMING.moving = true;
  try { return await gamingCommand({ type: 'move', entityId: entity.id, x: entity.x + dx, z: entity.z + dz }); }
  finally { GAMING.moving = false; }
}
async function gamingAttack() {
  const entity = gamingSelectedEntity(), enemy = gamingEnemy();
  if (!entity || !enemy || enemy.hp <= 0) return;
  if (performance.now() < GAMING.attackingUntil) return;
  GAMING.attackingUntil = performance.now() + 700;
  gamingArenaStatus();
  try { const result = await gamingCommand({ type: 'attack', entityId: entity.id, targetId: enemy.id }); GAMING.lastAttackVersion = GAMING.version; return result; }
  catch (error) { GAMING.attackingUntil = 0; throw error; }
  finally { setTimeout(gamingArenaStatus, 710); }
}
function gamingArenaStatus() {
  const hint = $('gaming-arena-hint'), attack = $('gaming-attack'), entity = gamingSelectedEntity(), enemy = gamingEnemy();
  if (!hint || !attack) return;
  const distance = entity && enemy ? Math.hypot(entity.x - enemy.x, entity.z - enemy.z) : Infinity;
  const cooling = performance.now() < GAMING.attackingUntil;
  attack.disabled = GAMING.status !== 'joined' || !entity || entity.hp <= 0 || !enemy || enemy.hp <= 0 || distance > 3 || cooling;
  attack.textContent = cooling ? 'Recovering…' : '⚔ Strike';
  hint.textContent = !entity ? 'Choose your body to begin.' : entity.hp <= 0 ? 'Your body has fallen. Recover to return to the encounter.' :
    !enemy || enemy.hp <= 0 ? 'Guardian defeated. Claim the reward, then start another encounter.' :
      distance > 3 ? `Move ${Math.max(1, Math.ceil(distance - 3))} paces closer to strike. Tap the arena or use the direction buttons.` :
        'In striking range. Strike together with other players. Keyboard: WASD or arrows, Space to strike.';
  const reset = $('gaming-reset'); if (reset) reset.hidden = !enemy || enemy.hp > 0;
  const recover = $('gaming-recover'); if (recover) recover.hidden = !entity || entity.hp > 0;
}
function gamingArena() {
  const arena = $('gaming-arena'); if (!arena) return;
  arena.replaceChildren();
  const entities = gamingList(GAMING.snapshot?.entities), enemy = gamingEnemy(), selected = gamingSelectedEntity();
  const centerX = enemy?.x || 0, centerZ = enemy?.z || 5;
  const rendered = new Set(), ordered = [...entities].sort((a, b) => Number(b.id === selected?.id) - Number(a.id === selected?.id));
  for (const entity of ordered) {
    const position = `${entity.kind === 'npc' ? 'enemy' : 'ally'}:${entity.x.toFixed(1)}:${entity.z.toFixed(1)}`;
    if (rendered.has(position)) continue;
    rendered.add(position);
    const together = entities.filter(other => other.kind !== 'npc' && entity.kind !== 'npc' && other.x.toFixed(1) === entity.x.toFixed(1) && other.z.toFixed(1) === entity.z.toFixed(1));
    const marker = gamingNode('div', undefined, 'gaming-marker');
    marker.dataset.kind = entity.kind; marker.dataset.dead = String(entity.hp <= 0);
    marker.classList.toggle('gaming-selected', entity.id === selected?.id);
    marker.style.left = `${Math.max(4, Math.min(96, 50 + (entity.x - centerX) * 5))}%`;
    marker.style.top = `${Math.max(18, Math.min(78, 45 - (entity.z - centerZ) * 6))}%`;
    marker.appendChild(gamingNode('span', entity.kind === 'npc' ? '♜' : entity.kind === 'companion' ? '✦' : '◆', 'gaming-body'));
    const name = entity.id === gamingSelf() ? 'You' : entity.name || entity.kind;
    marker.appendChild(gamingNode('strong', `${name}${together.length > 1 ? ` +${together.length - 1}` : ''}`));
    marker.title = together.length > 1 ? together.map(other => other.name || other.kind).join(', ') : name;
    const meter = gamingNode('span', undefined, 'gaming-health');
    const fill = gamingNode('span'); fill.style.width = `${100 * entity.hp / entity.maxHp}%`; meter.appendChild(fill); marker.appendChild(meter);
    marker.appendChild(gamingNode('small', `${entity.hp}/${entity.maxHp}`)); arena.appendChild(marker);
  }
  arena.setAttribute('aria-label', `Confirmed expedition positions. ${entities.length} bodies. ${enemy ? `Guardian health ${enemy.hp} of ${enemy.maxHp}.` : ''}`);
  gamingArenaStatus();
}
function gamingRender() {
  if (!$('gaming-sheet')) return;
  gamingStatus();
  const joined = GAMING.status === 'joined';
  $('gaming-enter').hidden = joined; $('gaming-enter').disabled = !gamingConnected() || GAMING.status === 'entering';
  $('gaming-intro').hidden = joined;
  $('gaming-live').hidden = !joined; $('gaming-leave').hidden = !joined;
  gamingEntitySelect();
  gamingArena();
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
  const rewardTotal = $('gaming-reward-total'); if (rewardTotal) rewardTotal.textContent = Object.entries(GAMING.snapshot?.rewards || {}).map(([item, quantity]) => `${quantity} ${item}`).join(' · ') || 'No expedition rewards claimed yet.';
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
  style.textContent = `#gaming-sheet .sheet{width:min(680px,100%);box-sizing:border-box;gap:12px}#gaming-sheet{z-index:42}#gaming-sheet #gaming-status{font-size:12px;line-height:1.3;min-height:16px}#gaming-sheet #gaming-arena{position:relative;min-height:230px;overflow:hidden;touch-action:manipulation;border:1px solid #85704b;border-radius:14px;background:radial-gradient(ellipse at 50% 42%,#535740 0,#202b27 45%,#101917 100%);isolation:isolate}#gaming-sheet #gaming-arena:before{content:"";position:absolute;inset:0;opacity:.18;background-image:linear-gradient(#d2b379 1px,transparent 1px),linear-gradient(90deg,#d2b379 1px,transparent 1px);background-size:5% 8%}#gaming-sheet .gaming-marker{position:absolute;transform:translate(-50%,-50%);display:grid;justify-items:center;gap:1px;min-width:50px;max-width:96px;pointer-events:none;text-align:center;color:#eee3c4;font-size:10px;line-height:1.2}#gaming-sheet .gaming-body{font-size:26px;line-height:30px;color:#78c3d5;text-shadow:0 2px 8px #000}#gaming-sheet .gaming-marker[data-kind=npc] .gaming-body{font-size:42px;color:#f4a475}#gaming-sheet .gaming-marker[data-kind=companion] .gaming-body{color:#b6adf1}#gaming-sheet .gaming-marker[data-dead=true]{opacity:.45}#gaming-sheet .gaming-selected .gaming-body{filter:drop-shadow(0 0 5px #fff)}#gaming-sheet .gaming-health{display:block;width:46px;height:5px;background:#321d1b;border:1px solid #100d0b;border-radius:4px;overflow:hidden}#gaming-sheet .gaming-health>span{display:block;height:100%;background:#84b58d}#gaming-sheet .gaming-marker[data-kind=npc] .gaming-health>span{background:#d46c54}#gaming-sheet #gaming-arena-hint{font-size:12px;line-height:1.4;min-height:34px}#gaming-sheet .gaming-controls{display:grid;grid-template-columns:minmax(0,1fr) 110px;gap:12px;align-items:center}#gaming-sheet #gaming-attack{border-radius:50%;width:104px;min-height:104px;background:#be9e62;color:#15140f;font-weight:700;font-size:18px}#gaming-sheet details{border-top:1px solid var(--line);padding-top:10px;min-width:0}#gaming-sheet summary{min-height:44px;cursor:pointer;color:var(--bronze-hi);display:flex;align-items:center;font-size:15px}#gaming-sheet details[open]>section{margin-top:10px}#gaming-sheet #gaming-reward-total{font-size:13px;color:#dbc181}#gaming-mobile-open{width:100%;min-height:48px}#gaming-sheet #gaming-live{gap:12px}#gaming-sheet .gaming-head{display:flex;align-items:center;justify-content:space-between;gap:12px;position:sticky;top:-20px;background:var(--slate-2);z-index:2;padding-block:8px}#gaming-sheet .gaming-head h2{font-size:24px}#gaming-sheet #gaming-close{width:46px;min-width:46px;padding:4px;font-size:26px;line-height:1}#gaming-sheet .btn{min-height:46px;touch-action:manipulation;white-space:normal}#gaming-sheet input,#gaming-sheet select{min-width:0;max-width:100%;box-sizing:border-box;min-height:46px;font-size:16px}#gaming-sheet label{display:grid;gap:6px}#gaming-sheet section,#gaming-sheet form,#gaming-live{display:grid;gap:10px;min-width:0}#gaming-sheet [hidden]{display:none!important}#gaming-sheet .gaming-card{display:grid;gap:6px;border:1px solid var(--line);padding:10px;overflow-wrap:anywhere}#gaming-sheet .gaming-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:8px}#gaming-sheet .gaming-move{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}#gaming-sheet .gaming-move button:first-child{grid-column:2}#gaming-sheet .gaming-move button:nth-child(2){grid-column:1}#gaming-sheet .gaming-move button:nth-child(3){grid-column:3}#gaming-sheet .gaming-move button:last-child{grid-column:2}#gaming-sheet .gaming-failure{color:#f4b29c}#gaming-token{width:100%;overflow-wrap:anywhere}#gaming-menu-open{margin-block:8px}@media(max-height:740px){#gaming-sheet #gaming-arena{min-height:170px}#gaming-sheet .gaming-head h2{font-size:20px}#gaming-sheet .gaming-move{gap:5px}#gaming-sheet .gaming-controls{gap:8px}}@media(max-height:600px){#gaming-sheet #gaming-arena{min-height:140px}#gaming-sheet .sheet{gap:8px}#gaming-sheet #gaming-live,#gaming-sheet section{gap:7px}}@media(max-width:420px){#gaming-sheet .sheet{padding:12px}#gaming-sheet .gaming-head{top:-12px}#gaming-sheet .gaming-grid{grid-template-columns:minmax(0,1fr)}}`;
  document.head.appendChild(style);
  const overlay = gamingNode('div'); overlay.id = 'gaming-sheet'; overlay.className = 'overlay'; overlay.hidden = true;
  overlay.innerHTML = '<div class="sheet panel" role="dialog" aria-modal="true" aria-labelledby="gaming-title"><div class="gaming-head"><h2 id="gaming-title">Shared expedition</h2><button class="btn" id="gaming-close" type="button" aria-label="Close shared expedition">×</button></div><p id="gaming-intro">Fight the guardian together. Each move and strike is confirmed by the shared server.</p><p id="gaming-status" role="status" aria-live="polite"></p><button class="btn primary" id="gaming-enter" type="button">Enter shared expedition</button><div id="gaming-live" hidden><section><div id="gaming-arena" role="img" tabindex="0" aria-label="Shared encounter arena"></div><p id="gaming-arena-hint"></p><div class="gaming-controls"><div class="gaming-move" aria-label="Move one pace"><button class="btn" type="button" data-gaming-dx="0" data-gaming-dz="1" aria-label="Move forward">↑</button><button class="btn" type="button" data-gaming-dx="-1" data-gaming-dz="0" aria-label="Move left">←</button><button class="btn" type="button" data-gaming-dx="1" data-gaming-dz="0" aria-label="Move right">→</button><button class="btn" type="button" data-gaming-dx="0" data-gaming-dz="-1" aria-label="Move back">↓</button></div><button class="btn" type="button" id="gaming-attack">⚔ Strike</button></div><label>Control body<select id="gaming-entity"></select></label><button class="btn" type="button" id="gaming-recover" hidden>Recover fallen body</button><button class="btn" type="button" id="gaming-reset" hidden>Start another encounter · heal party</button></section><section><h3>Expedition rewards</h3><p id="gaming-reward-total"></p><div id="gaming-loot"></div></section><details><summary>Party &amp; confirmed positions</summary><section><div id="gaming-entities" class="gaming-grid"></div><button class="btn" type="button" id="gaming-refresh">Refresh shared state</button></section></details><details><summary>Bring your agent · teammate, pet or coach</summary><section><h3>Your agent companions</h3><p>Create a companion, select its body above, then issue access. The Agent DID is an owner-provided label; the capability authorizes access. Coach access is observation only. Access expires after 15 minutes and can be revoked at any time.</p><button class="btn" type="button" id="gaming-spawn">Create companion body</button><form id="gaming-grant-form"><label>Agent DID<input id="gaming-agent" maxlength="512" placeholder="did:…" autocomplete="off" autocapitalize="off" spellcheck="false" required></label><label>Companion role<select id="gaming-role"><option value="teammate">Teammate</option><option value="pet">Pet</option><option value="coach">Coach · observe only</option></select></label><button class="btn" type="submit">Grant access to selected body</button></form><div id="gaming-token-wrap" hidden><label>One-time agent capability<input id="gaming-token" readonly autocomplete="off" spellcheck="false"></label><p>Give your chosen agent this capability and its discovery URL: <a id="gaming-agent-discovery" target="_blank" rel="noopener noreferrer"></a>. The agent sends the capability in its Authorization: Bearer header and follows the allowed actions in that descriptor. The capability is cleared when this sheet closes.</p><button class="btn" id="gaming-token-copy" type="button">Copy capability</button><button class="btn" id="gaming-token-clear" type="button">Clear capability</button></div><div id="gaming-grants"></div></section></details><details><summary>Learning &amp; activity</summary><section><p id="gaming-learning"></p></section></details><p>Expedition rewards stay here and do not change your main-world inventory.</p></div><button class="btn" id="gaming-leave" type="button" hidden>Leave expedition</button></div>';
  document.body.appendChild(overlay);
  $('gaming-close').onclick = () => gamingToggle(false);
  $('gaming-enter').onclick = () => gamingRun(gamingEnter, $('gaming-enter'));
  $('gaming-leave').onclick = () => gamingRun(gamingLeave, $('gaming-leave'));
  $('gaming-refresh').onclick = () => gamingRun(gamingObserve, $('gaming-refresh'));
  $('gaming-entity').onchange = gamingArena;
  $('gaming-attack').onclick = () => gamingRun(gamingAttack, $('gaming-attack'));
  $('gaming-recover').onclick = () => gamingRun(() => gamingCommand({ type: 'recover', entityId: gamingSelectedEntity()?.id }), $('gaming-recover'));
  $('gaming-reset').onclick = () => gamingRun(() => gamingCommand({ type: 'resetEncounter' }), $('gaming-reset'));
  $('gaming-arena').onclick = event => {
    const entity = gamingSelectedEntity(), enemy = gamingEnemy(); if (!entity || !enemy) return;
    const box = event.currentTarget.getBoundingClientRect();
    const x = (event.clientX - box.left) / box.width * 100, y = (event.clientY - box.top) / box.height * 100;
    const targetX = enemy.x + (x - 50) / 5, targetZ = enemy.z + (45 - y) / 6;
    const dx = targetX - entity.x, dz = targetZ - entity.z, distance = Math.hypot(dx, dz);
    if (distance > .1) gamingRun(() => gamingMove(dx / Math.max(1, distance), dz / Math.max(1, distance)));
  };
  $('gaming-spawn').onclick = () => gamingRun(() => gamingCommand({ type: 'spawnCompanion', name: 'Expedition companion' }), $('gaming-spawn'));
  $('gaming-token-clear').onclick = gamingClearToken;
  const discovery = $('gaming-agent-discovery'); discovery.href = new URL('/gaming/agents', location.href).href; discovery.textContent = discovery.href;
  $('gaming-token-copy').onclick = async () => {
    const token = $('gaming-token'), button = $('gaming-token-copy'); if (!token.value || !GAMING.open) return;
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Select the capability to copy it.');
      await navigator.clipboard.writeText(token.value); if (GAMING.open && token.value) button.textContent = 'Copied';
    } catch { if (GAMING.open && token.value) { token.focus(); token.select(); button.textContent = 'Select capability to copy'; } }
  };
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
      return gamingMove(Number(button.dataset.gamingDx), Number(button.dataset.gamingDz));
    }, button);
  });
  addEventListener('keydown', event => {
    if (!GAMING.open) return;
    const typing = event.target?.matches?.('input,select,textarea');
    const direction = { w: [0, 1], ArrowUp: [0, 1], a: [-1, 0], ArrowLeft: [-1, 0], s: [0, -1], ArrowDown: [0, -1], d: [1, 0], ArrowRight: [1, 0] }[event.key];
    const nativeSpaceControl = event.target?.closest?.('button,summary,a,input,select,textarea');
    if (!typing && GAMING.status === 'joined' && (direction || event.code === 'Space' && !nativeSpaceControl)) {
      event.preventDefault(); event.stopImmediatePropagation();
      if (!event.repeat) gamingRun(() => direction ? gamingMove(...direction) : gamingAttack());
      return;
    }
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
  if (tray) { const section = gamingNode('section'); section.dataset.mobileSection = 'world social'; section.style.order = '-2'; const button = gamingButton('Shared expedition', () => gamingToggle(true)); button.id = 'gaming-mobile-open'; section.appendChild(button); tray.appendChild(section); }
  GAMING.socket = typeof NETWS !== 'undefined' ? NETWS.ws : null;
  GAMING.timer = setInterval(() => {
    const socket = typeof NETWS !== 'undefined' ? NETWS.ws : null;
    if ((!gamingSessionCurrent() || socket !== GAMING.socket) && ['entering', 'joined'].includes(GAMING.status)) {
      GAMING.status = 'disconnected'; gamingClearToken(); gamingRejectPending('The expedition connection changed. Enter again to resume.'); gamingRender();
    }
    GAMING.socket = socket; if (GAMING.open) { gamingStatus(); gamingArenaStatus(); }
    if (!GAMING.autoOpened && new URLSearchParams(location.search).get('expedition') === '1' && gamingConnected() && (typeof GAME === 'undefined' || GAME.started && GAME.player) && !UI.modal) { GAMING.autoOpened = true; gamingToggle(true); }
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
