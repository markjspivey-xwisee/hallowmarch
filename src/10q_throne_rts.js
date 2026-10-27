/* Live 3D throne strategy UI. Camera navigation is local; every realm/army
 * mutation continues through its existing canonical authority route. */
const THRONE_RTS_UI = { root: null, tab: 'realm', key: '', time: 0, markers: [], markerKey: '', form: {}, selectedPlot: '', focusBefore: null, revision: null, quoteForm: {}, notice: '', noticeUntil: 0, armyFocus: null };
const throneRtsTabs = [['realm', 'Realm'], ['production', 'Production'], ['build', 'Construction'], ['resources', 'Resources'], ['diplomacy', 'Diplomacy'], ['armies', 'Armies']];
function throneRtsEscape(value) { return String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c])); }
function throneRtsNumber(value) { return Number.isFinite(+value) ? Math.round(+value * 10) / 10 : 0; }
function throneRtsView() { return typeof netRealmManagementView === 'function' ? netRealmManagementView() : null; }
function throneRtsForm(name, fallback = '') { return THRONE_RTS_UI.form[name] ?? fallback; }
function throneRtsCost(cost) {
  if (!cost) return 'See realm stores';
  const rows = Array.isArray(cost) ? cost : Object.entries(cost);
  return rows.map(row => Array.isArray(row) ? `${throneRtsNumber(row[1])} ${throneRtsEscape(row[0])}` : `${throneRtsNumber(row.n ?? row.amount)} ${throneRtsEscape(row.label ?? row.id)}`).join(' · ') || 'No materials';
}
function throneRtsOptions(rows, current) { return rows.map(([id, name]) => `<option value="${throneRtsEscape(id)}"${String(id) === String(current) ? ' selected' : ''}>${throneRtsEscape(name)}</option>`).join(''); }
function throneRtsManage(action) {
  if (!THRONE_RTS.active || UI.modal !== 'rts' || !hallThroneGrant()) return false;
  if (typeof netRealmManagementCommand !== 'function') { throneRtsSetStatus('Realm management is connecting.'); return false; }
  const view = throneRtsView();
  const quoteFields = action.type === 'recruit' ? ['recruitUnits'] : action.type === 'build' ? ['plotId','buildKind'] : action.type === 'project' ? ['projectId'] : [];
  if (!view || THRONE_RTS_UI.revision !== view.revision || quoteFields.some(k => THRONE_RTS_UI.quoteForm[k] !== THRONE_RTS_UI.form[k])) {
    throneRtsRenderPanel(true);
    throneRtsNotice('The realm changed. Review the updated costs and issue the order again.');
    return false;
  }
  netRealmManagementCommand(action);
  THRONE_RTS_UI.key = '';
  return true;
}
function throneRtsNotice(message) { THRONE_RTS_UI.notice=message; THRONE_RTS_UI.noticeUntil=performance.now()+8000; throneRtsSetStatus(message); }
function throneRtsSetStatus(message) { const e = $('rts-status'); if (e) e.textContent = String(message || ''); }
function throneRtsInitUI() {
  if (THRONE_RTS_UI.root) return THRONE_RTS_UI.root;
  const root = document.createElement('section');
  root.id = 'throne-rts'; root.className = 'overlay'; root.hidden = true;
  root.setAttribute('role', 'dialog'); root.setAttribute('aria-modal', 'true'); root.setAttribute('aria-labelledby', 'rts-title');
  root.innerHTML = `<div id="rts-stage" tabindex="0" aria-label="3D realm view. Drag to pan, use the mouse wheel or pinch to zoom."></div>
    <svg id="rts-routes" aria-hidden="true"></svg><div id="rts-markers"></div>
    <header id="rts-header"><div><small>REALM STRATEGY · LIVE 3D VIEW</small><h2 id="rts-title">The high seat</h2></div>
      <div class="rts-tools"><button type="button" data-rts="home" title="Return the camera to your throne">Throne</button><button type="button" data-rts="zoom-in" aria-label="Zoom in">＋</button><button type="button" data-rts="zoom-out" aria-label="Zoom out">−</button><button type="button" data-rts="map">Map</button><button type="button" data-rts="leave" class="rts-leave">Leave throne</button></div></header>
    <aside id="rts-panel"><nav id="rts-tabs" aria-label="Realm strategy">${throneRtsTabs.map(([id, label]) => `<button type="button" data-tab="${id}">${label}</button>`).join('')}</nav>
      <p id="rts-status" role="status" aria-live="polite"></p><button type="button" id="rts-retry" data-rts="retry" hidden>Retry pending order</button><div id="rts-content"></div></aside>
    <div id="rts-help">Drag / WASD: pan · Wheel / pinch: zoom · Select a warband, then a keep · Esc: leave throne</div>`;
  document.body.appendChild(root); THRONE_RTS_UI.root = root;
  throneRtsBindStage($('rts-stage'));
  root.addEventListener('input', e => { if (e.target.name) THRONE_RTS_UI.form[e.target.name] = e.target.value; });
  root.addEventListener('change', e => { if (e.target.name) { THRONE_RTS_UI.form[e.target.name] = e.target.value; THRONE_RTS_UI.key = ''; } });
  root.addEventListener('click', throneRtsClick);
  return root;
}
function openThroneRTS() {
  if (!GAME.started || !GAME.player?.alive || !hallThroneGrant() || UI.modal && !['map', 'rts'].includes(UI.modal)
    || typeof netHumanLive === 'function' && !netHumanLive()) return false;
  const root = throneRtsInitUI();
  if (THRONE_RTS.active) return true;
  THRONE_RTS_UI.focusBefore = document.activeElement;
  cancelPlayerInput();
  $('mapov').hidden = true;
  UI.modal = 'rts'; root.hidden = false; document.body.classList.add('throne-rts-open');
  THRONE_RTS_UI.key = ''; THRONE_RTS_UI.time = 0; THRONE_RTS_UI.markerKey = '';
  const seat = HALL.sit;
  if (!throneRtsStartCamera(seat.x, seat.z)) { closeThroneRTS(false); return false; }
  throneRtsRenderPanel(true);
  $('rts-stage').focus({ preventScroll: true });
  return true;
}
function closeThroneRTS(release = true) {
  if (typeof THRONE_RTS === 'undefined') return;
  const owned = UI.modal === 'rts';
  throneRtsStopCamera();
  if (THRONE_RTS_UI.root) THRONE_RTS_UI.root.hidden = true;
  document.body.classList.remove('throne-rts-open');
  THRONE_RTS_UI.markers = []; THRONE_RTS_UI.markerKey = '';
  if (owned) UI.modal = null;
  if (release && HALL.sit) hallLeave();
  const before = THRONE_RTS_UI.focusBefore; THRONE_RTS_UI.focusBefore = null;
  if (owned && !UI.modal && before?.isConnected && typeof before.focus === 'function') before.focus({ preventScroll: true });
}
function throneRtsGuard() {
  if (!THRONE_RTS.active) return;
  if (!GAME.started || !GAME.player?.alive || UI.modal !== 'rts' || !hallThroneGrant()
    || typeof netHumanLive === 'function' && !netHumanLive()) closeThroneRTS(true);
}
function throneRtsOverview(v) {
  const p = v.population || {}, realm = REALMS[GAME.player.faction];
  const needRows = Array.isArray(p.needs) ? p.needs : Object.entries(p.needs || {}).map(([id,n]) => ({id,label:id,met:n >= 0.9,status:`${n >= 0.9 ? 'Supplied' : n > 0.4 ? 'Limited' : 'Shortage'} · ${Math.round(n*100)}%`}));
  const needs = needRows.map(n => `<li>${throneRtsEscape(n.label ?? n.id)} <b>${throneRtsEscape(n.status ?? (n.met ? 'Supplied' : 'Shortage'))}</b></li>`).join('');
  const works = v.publicWorks || [], projects = works.map(w => [w.id,w.label]);
  const project = works.find(w => w.id === throneRtsForm('projectId','granary'));
  return `<h3>${throneRtsEscape(realm.name)} settlement</h3><div class="rts-metrics"><span>Residents <b>${throneRtsNumber(p.residents)} / ${throneRtsNumber(p.capacity)}</b></span><span>Workers <b>${throneRtsNumber(p.workers)} · ${throneRtsNumber(p.available)} free</b></span><span>Happiness <b>${throneRtsNumber(p.happiness)}%</b></span><span>Revenue <b>${throneRtsNumber(p.revenue)} gold / min</b></span></div>
    <h4>Town needs</h4><ul class="rts-needs">${needs || '<li>Production and households are being surveyed.</li>'}</ul>
    <label>Tax policy<select name="taxPolicy">${throneRtsOptions([['low','Low · favor growth'],['normal','Normal'],['high','High · favor treasury']], throneRtsForm('taxPolicy', p.taxPolicy || 'normal'))}</select></label><button data-action="tax">Apply tax policy</button>
    <h4>Realm priorities</h4><p>Buildings and production supply the same stores used by the realm’s walls, garrisons and armies.</p>
    <label>Public works<select name="projectId">${throneRtsOptions(projects, throneRtsForm('projectId','granary'))}</select></label>${project ? `<p>Level ${throneRtsNumber(project.level)} / ${throneRtsNumber(project.maxLevel)}${project.atWork ? ` · ${Math.round(project.progress*100)}% complete` : ''}</p><p>${project.nextCost ? 'Next level: '+throneRtsCost(project.nextCost) : 'Fully supplied'}. Materials are drawn as work proceeds.</p>` : ''}<button data-action="project"${!project?.nextCost ? ' disabled' : ''}>Prioritize public works</button><p>Use Armies to recruit paid reserves and mobilize a field company.</p>
    ${(v.log || []).slice(-4).reverse().map(n => `<p class="rts-news">${throneRtsEscape(typeof n === 'string' ? n : n.text)}</p>`).join('')}`;
}
function throneRtsSupplies() {
  const logistics=typeof netRealmLogisticsView === 'function' ? netRealmLogisticsView() : null;
  if (!logistics?.quotes) return '<h4>Supplies and repairs</h4><p>Reading confirmed supply orders…</p>';
  const own=typeof NETS !== 'undefined' ? (NETS.s?.keeps || []).filter(k => k.r === GAME.player.faction) : [];
  const selected=Number(throneRtsForm('supplyKeep',own[0]?.i ?? -1)), kind=throneRtsForm('repairKind','wall');
  const repairs=logistics.quotes.repairs || {}, jobs=(logistics.jobs || []).filter(j => j.realm === GAME.player.faction);
  const houses=typeof HOUSES !== 'undefined' ? HOUSES.filter(h => h.realm === GAME.player.faction && !h.keepHall) : [];
  return `<h4>Supplies and repairs</h4><p>Convoys carry reserved goods and paid escorts through the live world. Successful deliveries reinforce the destination; losses consume the reserved supplies.</p>
    <label>Owned keep<select name="supplyKeep">${throneRtsOptions(own.map(k => [k.i,WAR.keeps[k.i]?.site.name || 'Keep '+(k.i+1)]),selected)}</select></label>
    <p>Convoy: ${throneRtsCost(logistics.quotes.cargo)} · ${logistics.quotes.escorts} reserve escorts. Maximum two active per realm.</p>
    <button data-logistics="convoy"${!own.length ? ' disabled' : ''}>Dispatch supply convoy</button>
    <label>Fortification repair<select name="repairKind">${throneRtsOptions([['wall','Walls'],['gate','Gate'],['tower','Tower']],kind)}</select></label>
    <p>Repair work order: ${throneRtsCost(repairs[kind])}. Workers apply the paid work to damaged structures.</p>
    <button data-logistics="repair"${!own.length ? ' disabled' : ''}>Fund fortification repair</button>
    ${repairs.house && houses.length ? `<label>Town building<select name="repairHouse">${throneRtsOptions(houses.map(h => [h.num,'Building '+(h.num+1)+' · '+(h.state || 'standing')]),throneRtsForm('repairHouse',houses[0].num))}</select></label><p>Town repair: ${throneRtsCost(repairs.house)}</p><button data-logistics="house">Fund town repair</button>` : ''}
    ${jobs.slice(-6).map(j => `<div class="rts-card">Convoy to ${throneRtsEscape(WAR.keeps[j.keep]?.site.name || 'keep')} · ${throneRtsEscape(j.state)}</div>`).join('')}`;
}
async function throneRtsLogistics(args) {
  if (!THRONE_RTS.active || UI.modal !== 'rts' || !hallThroneGrant() || typeof netRealmLogisticsCommand !== 'function') return;
  throneRtsNotice('Saving the supply order…');
  try {
    const result=await netRealmLogisticsCommand(args);
    if (!THRONE_RTS.active || UI.modal !== 'rts') return;
    throneRtsNotice(result.pending ? 'This order is waiting for native confirmation. Retry the same order to check it.' : result.message || result.why || (result.ok ? 'Supply order saved.' : 'The order was refused.'));
    THRONE_RTS_UI.key='';
  } catch (err) { if (THRONE_RTS.active) throneRtsNotice('The connection changed. Retry the same supply order after reconnecting.'); }
}
function throneRtsResources(v) {
  return `<h3>Realm stores</h3><p>Real material stocks. Shortages stop dependent production and limit construction and army supplies.</p><table><thead><tr><th>Resource</th><th>Stored</th><th>/ min</th></tr></thead><tbody>${(v.stocks || []).map(s => `<tr><th>${throneRtsEscape(s.label ?? s.id)}</th><td>${throneRtsNumber(s.n)}${s.cap ? ` / ${throneRtsNumber(s.cap)}` : ''}</td><td>${throneRtsNumber(s.rate)}</td></tr>`).join('')}</tbody></table>
    ${throneRtsSupplies()}<h4>Production chains</h4>${(v.recipes || []).map(r => `<div class="rts-card"><b>${throneRtsEscape(r.label ?? r.id)}</b><p>${throneRtsCost(r.inputs)} → ${throneRtsCost(r.outputs)}</p></div>`).join('')}`;
}
function throneRtsProduction(v) {
  const rows = (v.buildings || []).filter(b => b.kind !== 'house');
  return `<h3>Production and workforce</h3><p>Staff a building to work its chain. Missing inputs, an unfinished site or too few workers stop production.</p>${rows.map(b => `<article class="rts-card"><button class="rts-focus" data-building-focus="${throneRtsEscape(b.id)}">${throneRtsEscape(b.label ?? b.kind)} · Lv ${throneRtsNumber(b.level || 1)}</button><p>${throneRtsEscape(b.paused ? 'Paused' : b.blocked || (b.status !== 'built' ? b.status : b.working ? 'Producing' : 'Idle'))}${b.remaining > 0 ? ` · ${Math.ceil(b.remaining)}s` : ''}</p><p>${throneRtsCost(b.inputs)} → ${throneRtsCost(b.outputs)}</p>
      <p>${throneRtsNumber(b.assigned)} workers assigned</p><label>Requested workers<input type="number" min="0" max="${Math.max(0, throneRtsNumber(v.population?.workers || 0))}" name="workers-${throneRtsEscape(b.id)}" value="${throneRtsEscape(throneRtsForm('workers-'+b.id,b.workers ?? 0))}"></label>
      <label>Priority<select name="priority-${throneRtsEscape(b.id)}">${throneRtsOptions([['0','Low'],['1','Normal'],['2','High']], throneRtsForm('priority-'+b.id,b.priority ?? 1))}</select></label>
      <div class="rts-row"><button data-workforce="${throneRtsEscape(b.id)}">Assign workers</button><button data-pause="${throneRtsEscape(b.id)}" data-paused="${b.paused ? '0' : '1'}">${b.paused ? 'Resume' : 'Pause'}</button></div></article>`).join('') || '<p>Choose Construction to commission production buildings.</p>'}`;
}
function throneRtsConstructionChoice(v) {
  const plots = (v?.plots || []).filter(p => p.owner === GAME.player.faction && !p.buildingId);
  const requested = throneRtsForm('plotId', THRONE_RTS_UI.selectedPlot);
  const chosen = plots.find(p => p.id === requested)?.id || plots[0]?.id || '';
  const catalog = v?.catalog || [], requestedKind = throneRtsForm('buildKind', catalog[0]?.id || '');
  const item = catalog.find(c => c.id === requestedKind) || catalog[0];
  const kind = item?.id || '';
  THRONE_RTS_UI.form.plotId = chosen; THRONE_RTS_UI.selectedPlot = chosen; THRONE_RTS_UI.form.buildKind = kind;
  return { plots, chosen, kind, item };
}
function throneRtsConstruction(v) {
  const { plots, chosen, kind, item } = throneRtsConstructionChoice(v);
  return `<h3>Construction</h3><p>Choose an owned plot in the 3D view or below. Realm stores pay the displayed cost; workers then complete the building.</p>
    <label>Building plot<select name="plotId">${throneRtsOptions(plots.map(p => [p.id,p.name || p.site || p.id]),chosen)}</select></label>
    <label>Building<select name="buildKind">${throneRtsOptions((v.catalog || []).map(c => [c.id,c.label || c.id]),kind)}</select></label>
    ${item ? `<div class="rts-card"><b>${throneRtsEscape(item.label || kind)}</b><p>${throneRtsCost(item.cost)}</p><p>${throneRtsNumber(item.seconds)} seconds · ${throneRtsNumber(item.workers)} workers</p><p>${throneRtsCost(item.inputs)} → ${throneRtsCost(item.outputs)}</p></div>` : ''}
    <button data-action="build"${!plots.length || !item ? ' disabled' : ''}>Commission building</button>
    <h4>Sites and upgrades</h4>${(v.buildings || []).map(b => `<article class="rts-card"><button class="rts-focus" data-building-focus="${throneRtsEscape(b.id)}">${throneRtsEscape(b.label || b.kind)} · Lv ${throneRtsNumber(b.level || 1)}</button><p>${throneRtsEscape(b.status || '')}${b.remaining > 0 ? ` · ${Math.ceil(b.remaining)}s to complete` : ''}</p>${b.upgradeCost ? `<p>Upgrade: ${throneRtsCost(b.upgradeCost)}</p>` : ''}<button data-upgrade="${throneRtsEscape(b.id)}"${!b.upgradeCost ? ' disabled' : ''}>${b.level >= 3 ? 'Maximum level' : 'Upgrade building'}</button></article>`).join('')}`;
}
function throneRtsDiplomacy(v) {
  const realm = GAME.player.faction, others = [0,1,2].filter(r => r !== realm), target = throneRtsForm('targetRealm',others[0]);
  const stocks = (v.stocks || []).map(s => [s.id,s.label || s.id]);
  return `<h3>Diplomacy and trade</h3><p>Offers move actual goods only after acceptance. Another human commander decides for their realm; unled realms evaluate offers themselves.</p>
    ${(v.relations || []).filter(r => r.realm !== realm).map(r => `<div class="rts-card"><b>${throneRtsEscape(REALMS[r.realm]?.name || '')}</b><p>Relations ${throneRtsNumber(r.score)} · ${throneRtsEscape(r.treaty || 'At war')}${r.treaty !== 'war' && r.expires > v.time ? ` · ${Math.ceil(r.expires-v.time)}s remaining` : ''}</p></div>`).join('')}
    <label>Other realm<select name="targetRealm">${throneRtsOptions(others.map(r => [r,REALMS[r].name]),target)}</select></label>
    <label>Offer resource<select name="giveResource">${throneRtsOptions(stocks,throneRtsForm('giveResource','planks'))}</select></label><label>Amount offered<input name="giveAmount" type="number" min="1" max="500" value="${throneRtsEscape(throneRtsForm('giveAmount',10))}"></label>
    <label>Requested resource<select name="wantResource">${throneRtsOptions(stocks,throneRtsForm('wantResource','food'))}</select></label><label>Amount requested<input name="wantAmount" type="number" min="1" max="500" value="${throneRtsEscape(throneRtsForm('wantAmount',10))}"></label>
    <div class="rts-row"><button data-action="offer">Propose trade</button><button data-action="gift">Send offered goods as gift</button></div>
    <p>Trade agreement: 20 treasury, 30 active minutes. Ceasefire: 30 treasury, 20 active minutes. Both suspend combat until expiry; declaring war ends the agreement.</p><div class="rts-row"><button data-treaty="trade">Propose trade agreement</button><button data-treaty="truce">Propose ceasefire</button><button data-action="declareWar">Declare war</button></div>
    <h4>Diplomatic offers</h4>${(v.offers || []).filter(o => o.from === realm || o.to === realm).map(o => `<article class="rts-card"><b>${throneRtsEscape(REALMS[o.from]?.name || '')} → ${throneRtsEscape(REALMS[o.to]?.name || '')}</b><p>${throneRtsEscape(o.type === 'treaty' ? o.treaty + ' agreement' : 'Goods trade')} · ${throneRtsEscape(o.status || 'pending')}</p>${o.type === 'treaty' ? `<p>${o.treaty === 'trade' ? '20 treasury · 30 active minutes' : '30 treasury · 20 active minutes'} · nonaggression while active; envoy fee paid by proposer on acceptance.</p>` : `<p>${throneRtsCost(o.give ? {[o.give.id]:o.give.n} : null)} ⇄ ${throneRtsCost(o.want ? {[o.want.id]:o.want.n} : null)}</p>`}${o.to === realm && o.status === 'pending' ? `<div class="rts-row"><button data-offer="${throneRtsEscape(o.id)}" data-accept="1">Accept</button><button data-offer="${throneRtsEscape(o.id)}" data-accept="0">Decline</button></div>` : ''}</article>`).join('') || '<p>No pending offers.</p>'}`;
}
function throneRtsCanonicalArmies() {
  return typeof NETS !== 'undefined' && Array.isArray(NETS.s?.armies) ? NETS.s.armies.filter(a => a.r === GAME.player.faction && a.id != null && a.n > 0) : [];
}
function throneRtsArmyPosition(a) { return {x:a.f && Number.isFinite(a.fx) ? a.fx : a.x,z:a.f && Number.isFinite(a.fz) ? a.fz : a.z}; }
function throneRtsFocusArmy(id) {
  const a=throneRtsCanonicalArmies().find(a => String(a.id) === String(id)); if (!a) return;
  const pos=throneRtsArmyPosition(a); throneRtsFocus(pos.x,pos.z); THRONE_RTS_UI.armyFocus=a.id;
  const band=WAR.warbands.find(w => !w.dead && w.realm === a.r && w.season?.id === a.id);
  if (band) { throneRtsSelectBand(band.id); THRONE_RTS_UI.armyFocus=null; }
}
function throneRtsMilitary(v) {
  const m=v?.military; if (!m) return '';
  const units=Number(throneRtsForm('recruitUnits',4)), cost=Object.fromEntries(Object.entries(m.recruitCost || {}).map(([k,n]) => [k,n*units]));
  const muster=Math.max(0,Math.min(m.musterLimit,Math.floor(m.reserves)-m.musterReserve));
  return `<h4>Recruitment and reserves</h4><p>${throneRtsNumber(m.reserves)} reserve · ${throneRtsNumber(m.field)} in the field · ${throneRtsNumber(m.queued)} training / ${throneRtsNumber(m.capacity)} capacity</p>
    ${m.training ? `<p>Training ${m.training.units}: ${Math.ceil(m.training.remaining)} active seconds remaining · ${m.training.assigned} / 2 workers${m.training.blocked ? ' · '+throneRtsEscape(m.training.blocked) : ''}</p>` : `<label>Recruits<input type="number" name="recruitUnits" min="1" max="12" step="1" value="${throneRtsEscape(units)}"></label><p>${throneRtsCost(cost)} · ${throneRtsNumber(units*m.secondsPerUnit)} active seconds · 2 workers</p><button data-action="recruit">Train recruits</button>`}
    <p>Muster ${muster} paid reserve troops for ${throneRtsNumber(muster*m.musterCostPerTroop)} provisions; keep ${m.musterReserve} in reserve.</p><button data-action="muster"${muster < 4 ? ' disabled' : ''}>Muster field company</button>`;
}
function throneRtsArmies(v) {
  const armies=throneRtsCanonicalArmies();
  return `<h3>Army command</h3><p>Select a friendly banner, then a keep or temple in the 3D view. Orders still require shared confirmation.</p>${campaignSideHTML()}${throneRtsMilitary(v)}
    <h4>Realm armies</h4>${armies.map(a => `<button class="cw-band" data-canonical-army="${a.id}">${throneRtsEscape(a.manual ? 'Field company' : a.kind)} · ${throneRtsNumber(a.n)} troops · ${throneRtsEscape(a.st)} · Focus</button>`).join('') || '<p>No field armies. Train reserves, then muster a company.</p>'}
    <h4>Strategic target</h4><label>Realm objective<select name="targetKeep">${throneRtsOptions(WAR.keeps.filter(k => k.realm !== GAME.player.faction).map(k => [k.id,k.site.name]),throneRtsForm('targetKeep',''))}</select></label><button data-action="target">Set realm objective</button>`;
}
function throneRtsRenderPanel(force = false) {
  if (!THRONE_RTS.active || !THRONE_RTS_UI.root) return;
  const v = throneRtsView(), host = $('rts-content');
  const key = JSON.stringify([THRONE_RTS_UI.tab,v,CWUI.sel,CWUI.msg,THRONE_RTS_UI.selectedPlot]);
  const editing = host.contains(document.activeElement) && /^(INPUT|SELECT|TEXTAREA)$/.test(document.activeElement.tagName);
  if (!force && (editing || key === THRONE_RTS_UI.key)) return;
  THRONE_RTS_UI.key = key; THRONE_RTS_UI.revision = v?.revision ?? null;
  $('rts-title').textContent = `High seat of ${HALL.sit?.H.S.name || REALMS[GAME.player.faction].name}`;
  for (const b of $('rts-tabs').querySelectorAll('button')) b.setAttribute('aria-current',b.dataset.tab === THRONE_RTS_UI.tab ? 'page' : 'false');
  host.innerHTML = THRONE_RTS_UI.tab === 'armies' ? throneRtsArmies(v) : !v ? '<h3>Connecting the realm ledger…</h3><p>Your realm’s saved economy is being read. Orders become available after that read confirms.</p>' :
    THRONE_RTS_UI.tab === 'production' ? throneRtsProduction(v) : THRONE_RTS_UI.tab === 'resources' ? throneRtsResources(v) :
    THRONE_RTS_UI.tab === 'build' ? throneRtsConstruction(v) : THRONE_RTS_UI.tab === 'diplomacy' ? throneRtsDiplomacy(v) : throneRtsOverview(v);
  THRONE_RTS_UI.quoteForm = {...THRONE_RTS_UI.form};
}
function throneRtsSelectBand(id, focus = false) {
  if (!THRONE_RTS.active || UI.modal !== 'rts' || !hallThroneGrant()) return;
  const band = cwBandsOf(GAME.player.faction).find(b => b.id === +id);
  if (!band) return;
  CWUI.sel = band.id; CWUI.msg = ''; THRONE_RTS_UI.tab = 'armies';
  if (focus) { const leader = wbLeader(band); if (leader) throneRtsFocus(leader.x,leader.z); }
  throneRtsRenderPanel(true);
}
function throneRtsMarkerAction(kind, id) {
  if (!THRONE_RTS.active || UI.modal !== 'rts' || !hallThroneGrant()) return;
  if (kind === 'canonical') { throneRtsFocusArmy(id); return; }
  if (kind === 'army') { throneRtsSelectBand(id); return; }
  if (kind === 'plot') {
    const plot = throneRtsView()?.plots?.find(p => String(p.id) === String(id));
    if (!plot || plot.owner !== GAME.player.faction) return;
    THRONE_RTS_UI.selectedPlot = plot.id; THRONE_RTS_UI.form.plotId = plot.id; THRONE_RTS_UI.tab = 'build'; throneRtsRenderPanel(true); return;
  }
  if (!CWUI.sel) return;
  if (kind === 'keep') { const k = WAR.keeps.find(k => k.id === +id); if (k) cwIssue(k.realm === GAME.player.faction ? 'defend' : 'attack',k.id); }
  if (kind === 'temple') { const t = WAR.temples.find(t => t.id === +id); if (t && t.realm !== GAME.player.faction) cwIssue('raid',t.id); }
  throneRtsRenderPanel(true);
}
function throneRtsClick(e) {
  const b = e.target.closest('button');
  if (!b || b.disabled || !THRONE_RTS.active || UI.modal !== 'rts' || !hallThroneGrant()) return;
  const v = throneRtsView(), form = THRONE_RTS_UI.form, num = (name, fallback=0) => Number(throneRtsForm(name,fallback));
  if (b.dataset.rts) {
    if (b.dataset.rts === 'leave') closeThroneRTS(true);
    else if (b.dataset.rts === 'retry' && typeof netRealmManagementRetry === 'function') netRealmManagementRetry();
    else if (b.dataset.rts === 'home' && HALL.sit) throneRtsFocus(HALL.sit.x,HALL.sit.z);
    else if (b.dataset.rts === 'zoom-in') throneRtsZoom(0.82);
    else if (b.dataset.rts === 'zoom-out') throneRtsZoom(1.22);
    else if (b.dataset.rts === 'map') { closeThroneRTS(false); toggleMap(true); }
    return;
  }
  if (b.dataset.tab) { THRONE_RTS_UI.tab = b.dataset.tab; throneRtsRenderPanel(true); return; }
  if (b.dataset.marker) { throneRtsMarkerAction(b.dataset.marker,b.dataset.id); return; }
  if (b.dataset.logistics) {
    if (b.dataset.logistics === 'convoy') throneRtsLogistics({op:'convoy.dispatch',keep:num('supplyKeep',NETS.s?.keeps?.find(k => k.r === GAME.player.faction)?.i ?? -1)});
    else if (b.dataset.logistics === 'repair') throneRtsLogistics({op:'repair.issue',keep:num('supplyKeep',NETS.s?.keeps?.find(k => k.r === GAME.player.faction)?.i ?? -1),kind:String(throneRtsForm('repairKind','wall'))});
    else if (b.dataset.logistics === 'house') throneRtsLogistics({op:'repair.issue',house:num('repairHouse',typeof HOUSES !== 'undefined' ? HOUSES.find(h => h.realm === GAME.player.faction && !h.keepHall)?.num ?? -1 : -1),kind:'house'});
    return;
  }
  if (b.dataset.canonicalArmy) { throneRtsFocusArmy(b.dataset.canonicalArmy); return; }
  if (b.dataset.wb) { throneRtsSelectBand(+b.dataset.wb,true); return; }
  if (b.classList.contains('cw-leave')) { closeThroneRTS(true); return; }
  if (b.dataset.cmd) { if (b.getAttribute('aria-disabled') !== 'true') cwIssue(b.dataset.cmd,+b.dataset.t); throneRtsRenderPanel(true); return; }
  if (b.dataset.buildingFocus) { const item = v?.buildings?.find(x => String(x.id) === b.dataset.buildingFocus), plot = v?.plots?.find(p => p.id === item?.plotId); if (plot) throneRtsFocus(plot.x,plot.z); return; }
  if (b.dataset.upgrade) throneRtsManage({type:'upgrade',buildingId:b.dataset.upgrade});
  else if (b.dataset.pause) throneRtsManage({type:'pause',buildingId:b.dataset.pause,paused:b.dataset.paused === '1'});
  else if (b.dataset.workforce) {
    const id=b.dataset.workforce, building=v?.buildings?.find(row => String(row.id) === id);
    throneRtsManage({type:'workforce',buildingId:id,workers:num('workers-'+id,building?.workers ?? 0),priority:num('priority-'+id,building?.priority ?? 1)});
  }
  else if (b.dataset.offer) throneRtsManage({type:'reply',offerId:Number(b.dataset.offer),accept:b.dataset.accept === '1'});
  else if (b.dataset.treaty) throneRtsManage({type:'treaty',targetRealm:num('targetRealm',[0,1,2].find(r => r !== GAME.player.faction)),kind:b.dataset.treaty});
  else if (b.dataset.action === 'build') { const choice=throneRtsConstructionChoice(v); throneRtsManage({type:'build',plotId:choice.chosen,kind:choice.kind}); }
  else if (b.dataset.action === 'tax') throneRtsManage({type:'tax',policy:String(throneRtsForm('taxPolicy',v?.population?.taxPolicy || 'normal'))});
  else if (b.dataset.action === 'project') throneRtsManage({type:'project',id:String(throneRtsForm('projectId','granary'))});
  else if (b.dataset.action === 'recruit') throneRtsManage({type:'recruit',units:num('recruitUnits',4)});
  else if (b.dataset.action === 'muster') throneRtsManage({type:'muster'});
  else if (b.dataset.action === 'target') throneRtsManage({type:'target',keep:num('targetKeep',WAR.keeps.find(k => k.realm !== GAME.player.faction)?.id ?? -1)});
  else if (['offer','gift','declareWar'].includes(b.dataset.action)) {
    const targetRealm = num('targetRealm',[0,1,2].find(r => r !== GAME.player.faction));
    if (b.dataset.action === 'declareWar') throneRtsManage({type:'declareWar',targetRealm});
    else if (b.dataset.action === 'gift') throneRtsManage({type:'gift',targetRealm,resource:String(throneRtsForm('giveResource','planks')),amount:num('giveAmount',10)});
    else throneRtsManage({type:'offer',targetRealm,giveResource:String(throneRtsForm('giveResource','planks')),giveAmount:num('giveAmount',10),wantResource:String(throneRtsForm('wantResource','food')),wantAmount:num('wantAmount',10)});
  }
}
function throneRtsCollectMarkers() {
  const p = GAME.player, out = [];
  for (const w of WAR.warbands) {
    if (w.dead || !cwSpotted(w,p)) continue;
    const l = wbLeader(w); if (!l) continue;
    out.push({kind:w.realm === p.faction ? 'army':'enemy',id:w.id,x:l.x,y:l.y+3,z:l.z,label:`${REALMS[w.realm].name} · ${wbName(w,false)} · ${wbMembers(w).length}`,color:REALMS[w.realm].color});
  }
  for (const a of throneRtsCanonicalArmies()) if (!WAR.warbands.some(w => !w.dead && w.season?.id === a.id)) {
    const pos=throneRtsArmyPosition(a); out.push({kind:'canonical',id:a.id,x:pos.x,y:heightAt(pos.x,pos.z)+3,z:pos.z,label:`Field company · ${throneRtsNumber(a.n)} troops`,color:REALMS[a.r].color});
  }
  for (const k of WAR.keeps) out.push({kind:'keep',id:k.id,x:k.site.x,y:heightAt(k.site.x,k.site.z)+7,z:k.site.z,label:k.site.name,color:REALMS[k.realm].color});
  for (const t of WAR.temples) out.push({kind:'temple',id:t.id,x:t.site.x,y:heightAt(t.site.x,t.site.z)+7,z:t.site.z,label:t.site.name,color:REALMS[t.realm].color});
  if (THRONE_RTS_UI.tab === 'build') for (const p0 of throneRtsView()?.plots || []) if (p0.owner === p.faction && !p0.buildingId) out.push({kind:'plot',id:p0.id,x:p0.x,y:heightAt(p0.x,p0.z)+0.8,z:p0.z,label:p0.name || 'Building plot',color:'#f1dc9b'});
  return out.slice(0,128);
}
function throneRtsPick(x,y) {
  if (!THRONE_RTS.active || !hallThroneGrant()) return;
  let best = null, distance = 30;
  for (const marker of THRONE_RTS_UI.markers) {
    if (!marker.screen) continue;
    const d = Math.hypot(marker.screen.x-x,marker.screen.y-y);
    if (d < distance) { distance=d; best=marker; }
  }
  if (best) throneRtsMarkerAction(best.kind,best.id);
}
function throneRtsDrawMarkers() {
  const markers = throneRtsCollectMarkers(), host = $('rts-markers'), stage = $('rts-stage').getBoundingClientRect();
  const key = markers.map(m => `${m.kind}:${m.id}:${m.label}:${m.color}`).join('|');
  if (key !== THRONE_RTS_UI.markerKey) { host.innerHTML = markers.map(m => `<button type="button" class="rts-marker ${m.kind}${m.kind === 'army' && m.id === CWUI.sel ? ' selected':''}" data-marker="${m.kind}" data-id="${throneRtsEscape(m.id)}" aria-label="${throneRtsEscape(m.label)}" style="--marker:${m.color}">${m.kind === 'plot' ? '＋' : m.kind === 'army' || m.kind === 'canonical' || m.kind === 'enemy' ? '⚑' : '◆'}<span>${throneRtsEscape(m.label)}</span></button>`).join(''); THRONE_RTS_UI.markerKey=key; }
  const nodes = host.children;
  for (let i=0;i<markers.length;i++) {
    const marker=markers[i], s=screenOf(marker.x,marker.y,marker.z), node=nodes[i];
    const visible=s && s.x > stage.left+18 && s.x < stage.right-18 && s.y > stage.top+24 && s.y < stage.bottom-16;
    marker.screen=visible?s:null; node.hidden=!visible;
    if (visible) {node.style.left=`${s.x}px`;node.style.top=`${s.y}px`;node.classList.toggle('selected',marker.kind==='army'&&marker.id===CWUI.sel);}
  }
  THRONE_RTS_UI.markers=markers;
  const band=WAR.warbands.find(w => w.id===CWUI.sel), leader=band&&wbLeader(band);
  const route=band&&cwRoute(band);
  const points=leader&&route?[{x:leader.x,z:leader.z},...route].map(p => screenOf(p.x,heightAt(p.x,p.z)+1,p.z)).filter(Boolean):[];
  $('rts-routes').setAttribute('viewBox',`0 0 ${view.w} ${view.h}`);
  $('rts-routes').innerHTML=points.length>1?`<polyline points="${points.map(p=>`${p.x},${p.y}`).join(' ')}"/>`:'';
}
function updateThroneRTS(dt) {
  if (!THRONE_RTS.active || UI.modal !== 'rts') return;
  if (!hallThroneGrant()) {closeThroneRTS(true);return;}
  if (typeof netRealmViewUpdate === 'function') netRealmViewUpdate();
  if (THRONE_RTS_UI.armyFocus != null) {
    const band=WAR.warbands.find(w => !w.dead && w.realm === GAME.player.faction && w.season?.id === THRONE_RTS_UI.armyFocus);
    if (band) { THRONE_RTS_UI.armyFocus=null; throneRtsSelectBand(band.id); }
  }
  THRONE_RTS_UI.time-=dt;
  if (THRONE_RTS_UI.time<=0) {THRONE_RTS_UI.time=0.5;throneRtsRenderPanel();}
  const status=typeof netRealmManagementStatus==='function'?netRealmManagementStatus():null;
  throneRtsSetStatus(THRONE_RTS_UI.tab === 'armies' && CWUI.msg ? CWUI.msg : (performance.now()<THRONE_RTS_UI.noticeUntil ? THRONE_RTS_UI.notice : status?.message) || (status?.pending?'Waiting for the realm order to save…':'World live · your character remains seated'));
  $('rts-retry').hidden = !status?.pending;
  throneRtsDrawMarkers();
}
(function throneRtsStyles(){
  const s=document.createElement('style');s.id='throne-rts-css';s.textContent=`
#throne-rts[hidden]{display:none!important}
#throne-rts{display:block;position:fixed;inset:0;z-index:50;padding:0;pointer-events:none;background:none;color:#f4e7cb}
#rts-stage{position:absolute;inset:88px 340px 0 0;pointer-events:auto;touch-action:none;outline:none}
#rts-header{position:absolute;top:max(8px,env(safe-area-inset-top));left:max(12px,env(safe-area-inset-left));right:max(12px,env(safe-area-inset-right));display:flex;justify-content:space-between;gap:12px;align-items:center;pointer-events:auto;background:#151a22ef;border:1px solid #8d7654;border-radius:10px;padding:8px 12px;box-shadow:0 4px 20px #0008}
#rts-header small{font-size:10px;letter-spacing:.12em;color:#d8c492}#rts-header h2{font:500 20px var(--caps);margin:2px 0}
.rts-tools{display:flex;gap:6px;flex-wrap:wrap}#throne-rts button,#throne-rts select,#throne-rts input{min-height:44px;border:1px solid #9b825b;border-radius:6px;background:#222a34;color:#fff0d4;padding:7px 10px;font:600 12px var(--ui);max-width:100%;touch-action:manipulation}
#throne-rts button{cursor:pointer;min-width:44px}#throne-rts button:disabled{opacity:.5;cursor:not-allowed}#throne-rts button:focus-visible{outline:2px solid #ffe4a4;outline-offset:2px}#throne-rts .rts-leave{background:#66402e}
#rts-panel{position:absolute;right:max(12px,env(safe-area-inset-right));top:88px;bottom:max(12px,env(safe-area-inset-bottom));width:316px;display:flex;flex-direction:column;background:#141922f2;border:1px solid #8d7654;border-radius:10px;pointer-events:auto;overflow:hidden}
#rts-tabs{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:8px;border-bottom:1px solid #8d7654}#rts-tabs button[aria-current=page]{background:#685339;border-color:#edcb83}
#rts-status{min-height:20px;margin:0;padding:8px 12px;font-size:12px;color:#f7d992;border-bottom:1px solid #66583f}
#rts-content{overflow:auto;padding:12px;overscroll-behavior:contain;min-height:0;line-height:1.4;font:12px/1.45 var(--ui)}#rts-content h3{margin:0 0 8px;font:500 20px var(--caps)}#rts-content h4{font:600 13px var(--caps);letter-spacing:.04em;margin:14px 0 6px}
#rts-content p{color:#cfcdc4;margin:6px 0}#rts-content label{display:grid;gap:4px;margin:8px 0;color:#e8d9ba}#rts-content select,#rts-content input{width:100%;min-width:0}
.rts-card{padding:10px;margin:8px 0;border:1px solid #8a7550;border-radius:7px;background:#222934bd}.rts-row{display:flex;gap:6px;flex-wrap:wrap}.rts-row>*{flex:1}.rts-metrics{display:grid;grid-template-columns:1fr 1fr;gap:8px}.rts-metrics span{display:grid;gap:4px;background:#272e37;padding:8px;border-radius:5px}.rts-needs{padding:0;list-style:none}.rts-needs li{display:flex;justify-content:space-between;gap:8px;padding:5px 0}
#rts-content table{width:100%;border-collapse:collapse}#rts-content th,#rts-content td{text-align:right;padding:7px 2px;border-bottom:1px solid #655941}#rts-content th:first-child{text-align:left}
#rts-content .cw-throne,#rts-content .cw-stand,#rts-content .cw-rules,#rts-content .cw-now{display:none}#rts-content .cw-bands,#rts-content .cw-grid{display:grid;gap:6px}#rts-content .cw-band{text-align:left;width:100%;margin:4px 0}#rts-content .cw-band.sel{border-color:#ffe4a3;background:#665138}#rts-content .cw-cmd{width:100%}#rts-content .cw-side h4{display:flex;justify-content:space-between}#rts-content ul{padding-left:14px}#rts-content .cw-band svg,#rts-content .cw-cmd svg{vertical-align:middle;margin-right:6px}
#rts-markers{position:absolute;inset:0;pointer-events:none}#rts-markers .rts-marker{position:absolute;transform:translate(-50%,-70%);border-color:var(--marker);background:#141922de;min-width:44px;min-height:44px;padding:5px 8px;pointer-events:none;text-shadow:0 1px 2px #000;font-size:18px}#rts-markers .rts-marker span{display:block;font-size:10px;max-width:140px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}#rts-markers .enemy{pointer-events:none;opacity:.85}#rts-markers .selected{box-shadow:0 0 0 2px #ffdf8a}#rts-markers .plot span{display:none}
#rts-routes{position:absolute;inset:0;width:100%;height:100%;pointer-events:none;overflow:hidden}#rts-routes polyline{stroke:#ffdc86;stroke-width:3;stroke-dasharray:8 6;fill:none;filter:drop-shadow(0 1px 2px #000)}
#rts-help{position:absolute;bottom:max(10px,env(safe-area-inset-bottom));left:16px;max-width:calc(100% - 370px);padding:6px 10px;border-radius:6px;background:#151a22da;font-size:11px;pointer-events:none}
body.throne-rts-open #hud #pf,body.throne-rts-open #hud #topright,body.throne-rts-open #hud #bottom,body.throne-rts-open #hud #lore-path,body.throne-rts-open #hud #log,body.throne-rts-open #hud #nameplates,body.throne-rts-open #hud #banners{visibility:hidden;pointer-events:none}
@media(max-width:760px){#rts-header{left:6px;right:6px;padding:6px 8px;gap:4px;align-items:flex-start}#rts-header h2{font-size:15px}#rts-header small{font-size:8px}.rts-tools{gap:4px;justify-content:flex-end;max-width:58%}#throne-rts .rts-tools button{padding:5px 8px;font-size:11px}#rts-stage{inset:116px 0 max(38%,238px) 0}#rts-panel{top:auto;left:6px;right:6px;bottom:max(6px,env(safe-area-inset-bottom));width:auto;height:36%;min-height:220px}#rts-tabs{display:flex;overflow-x:auto;flex:none;padding:4px}#rts-tabs button{flex:none}#rts-status{font-size:11px;padding:5px 8px}#rts-content{padding:8px}#rts-help{display:none}#rts-markers .rts-marker span{max-width:90px;font-size:9px}}
@media(max-height:520px) and (min-width:520px){#throne-rts{--rts-side:clamp(210px,34vw,288px)}#rts-header{right:calc(var(--rts-side) + 12px);align-items:flex-start}#rts-header small{display:none}#rts-header h2{font-size:14px}.rts-tools{max-width:72%;gap:3px}#throne-rts .rts-tools button{font-size:10px;padding:4px 6px}#rts-panel{top:6px;right:6px;bottom:6px;left:auto;width:var(--rts-side);height:auto;min-height:0}#rts-stage{inset:104px calc(var(--rts-side) + 12px) 0 0}#rts-help{display:none}}
`;document.head.appendChild(s);
})();
window.addEventListener('pagehide',()=>closeThroneRTS(true));
canvas.addEventListener('webglcontextlost',()=>closeThroneRTS(true));
