/** Read-only presentation of already supplied owner activity. No transport,
 * persistence, consent, recording or account discovery belongs in this module. */
const CONTEXT = 'urn:interego:gaming:activity:context', OBSERVATION = 'urn:interego:gaming:activity:observation';
const LABELS = Object.freeze({
  'ability.executed': 'Used an ability', 'ability.refused': 'Ability could not execute',
  'combat.defeated': 'Received credit for a defeated foe', 'combat.died': 'Fell in combat', 'combat.healed': 'Restored health',
  'resource.gathered': 'Collected resources', 'resource.harvested': 'Harvested ripe plants',
  'craft.completed': 'Completed a recipe', 'craft.refused': 'Recipe could not complete',
  'bounty.completed': 'Met a bounty target', 'bounty.claimed': 'Collected a bounty reward',
  'supply.delivered': 'Delivered supplies', 'path.completed': 'Completed a path step',
  'character.respawned': 'Released after falling', 'intervention.started': 'Started a support attempt',
  'agent.command-accepted': 'Agent input accepted',
});
const FAMILIES = Object.freeze({ ability: 'Abilities', combat: 'Combat', resource: 'Resources', craft: 'Crafting', bounty: 'Bounties',
  supply: 'Supplies', path: 'Path', character: 'Character', intervention: 'Support', agent: 'Agent input' });
const MOTIFS = Object.freeze({ 'ability-recovery': 'Ability refused, then executed', 'craft-recovery': 'Recipe refused, then completed',
  'bounty-reward': 'Bounty target met, then reward claimed', 'character-recovery': 'Character fell, then released' });
const text = (value, limit = 300) => typeof value === 'string' ? value.slice(0, limit) : '';
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const quantity = value => typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null;
const stamp = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : null;
const list = value => Array.isArray(value) ? value : [];
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
const number = value => value === null ? 'Unavailable' : value.toLocaleString();
const date = value => stamp(value) ? new Date(value).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'Time unavailable';
const VERB_PREFIX = 'urn:interego:gaming:activity:verb:';
const kindFromVerb = verb => typeof verb === 'string' && verb.startsWith(VERB_PREFIX) ? verb.slice(VERB_PREFIX.length) : '';
function objectLabel(statement) {
  const name = statement?.object?.definition?.name?.['en-US'] || statement?.object?.definition?.name?.en;
  if (typeof name === 'string') return name;
  const id = statement?.object?.id, prefix = 'urn:interego:gaming:activity:object:';
  if (typeof id === 'string' && id.startsWith(prefix)) {
    const tail = id.slice(prefix.length), separator = tail.indexOf(':');
    if (separator >= 0) { try { return decodeURIComponent(tail.slice(separator + 1)); } catch { return tail.slice(separator + 1); } }
  }
  return '';
}
function recordView(event, statement, index) {
  const context = event?.context || statement?.context?.extensions?.[CONTEXT] || {}, result = event?.result || statement?.result || {};
  const observed = statement?.result?.extensions?.[OBSERVATION] || {};
  const kind = text(event?.type || context.eventType || kindFromVerb(statement?.verb?.id), 80), known = Object.hasOwn(LABELS, kind);
  const bodyKind = event?.body?.kind || context.bodyKind, controller = event?.actor?.kind || context.controllerKind;
  const object = event?.object?.id || objectLabel(statement);
  const amount = quantity(event?.result?.quantity ?? observed.quantity);
  return { id: text(event?.id || statement?.id, 200) || 'record-' + index, kind, family: known ? kind.split('.')[0] : 'other',
    label: known ? LABELS[kind] : text(statement?.verb?.display?.['en-US'] || statement?.verb?.display?.en, 100) || 'Recorded activity', at: stamp(event?.observedAt || statement?.timestamp),
    body: bodyKind === 'character' ? 'Your character' : bodyKind === 'owned-unit' ? 'Owned companion' : 'Recorded body',
    controller: ({ 'human-input': 'Human input', agent: 'Agent control', 'companion-autonomy': 'Companion autonomy', unattributed: 'Control unknown' })[controller] || 'Control unknown',
    object: text(object, 100), quantity: amount, refused: result.success === false && kind.endsWith('.refused'),
    reason: text(result.reason || observed.reason, 64), ordinal: count(event?.ordinal ?? observed.historyOrdinal),
    statement: plain(statement) ? statement : null };
}
function safeCounts(value) {
  return Object.entries(plain(value) ? value : {}).filter(([kind, total]) => Object.hasOwn(LABELS, kind) && count(total) !== null)
    .map(([kind, total]) => ({ kind, label: LABELS[kind], total }));
}
function safeCoverage(value) {
  const source = plain(value) ? value : {};
  return { retainedCount: count(source.retainedCount), prunedCount: count(source.prunedCount),
    retentionMs: quantity(source.retentionMs), maxDetailedStatements: count(source.maxDetailedStatements),
    from: stamp(source.from), retainedFrom: stamp(source.retainedFrom), through: stamp(source.through),
    completeHistory: source.completeHistory === true };
}

/** Display normalization deliberately keeps local observations, local delivery
 * acknowledgments and returned account totals separate. No delivery inference
 * is attached to an individual observation. */
export function normalizeActivityDashboardData(input = {}) {
  const identityState = ['native', 'character-only', 'unavailable'].includes(input.identityState) ? input.identityState : 'unavailable';
  const local = plain(input.local) && input.local.available !== false ? input.local : null;
  const statements = new Map(list(input.statements).filter(plain).map(statement => [statement.id, statement]));
  const rows = list(input.events).slice(-16).filter(plain).map((event, index) => recordView(event, statements.get(text(event.id).replace(/^urn:uuid:/, '')), index));
  rows.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || (b.ordinal || 0) - (a.ordinal || 0));
  const rawRecording = plain(input.recording) ? input.recording : {}, scoped = identityState === 'native' && rawRecording.scoped === true;
  const rawAccount = identityState === 'native' && plain(input.account) ? input.account : {};
  const accountState = ['idle', 'loading', 'ready', 'error'].includes(rawAccount.state) ? rawAccount.state : 'idle';
  const summary = plain(rawAccount.summary) ? rawAccount.summary : null;
  const accountRows = list(rawAccount.statements).slice(0, 512).filter(plain).map((statement, index) => recordView(null, statement, index));
  accountRows.sort((a, b) => (Date.parse(b.at) || 0) - (Date.parse(a.at) || 0) || (b.ordinal || 0) - (a.ordinal || 0));
  const accountCounts = list(summary?.byVerb).slice(0, 64).filter(item => plain(item) && count(item.count) !== null)
    .map(item => ({ kind: kindFromVerb(item.id), label: LABELS[kindFromVerb(item.id)] || 'Other recorded activity', total: item.count }));
  if (count(summary?.otherVerb)) accountCounts.push({ kind: 'other', label: 'Additional activity outside the breakdown', total: summary.otherVerb });
  const rawAnalysis = identityState === 'native' && plain(input.analysis) ? input.analysis : {};
  return { scopeKey: text(input.scopeKey, 1000), characterName: text(input.characterName, 100) || 'Your character', identityState,
    local: { available: !!local, eventCount: count(local?.eventCount), lastEventAt: stamp(local?.lastEventAt), rows,
      counts: safeCounts(local?.summary?.counters), quantities: safeCounts(local?.summary?.quantities),
      detailsDropped: count(local?.history?.detailsDropped), captureUnavailable: count(local?.history?.captureUnavailable),
      retainedCount: count(local?.history?.coverage?.retainedEvents), from: stamp(local?.history?.coverage?.from), until: stamp(local?.history?.coverage?.until) },
    recording: { scoped, enabled: scoped && rawRecording.enabled === true, busy: scoped && rawRecording.busy === true,
      blocked: scoped && rawRecording.blocked === true, pending: scoped && rawRecording.pending === true,
      pendingCount: scoped ? count(rawRecording.pendingCount) : null, acknowledgedCount: scoped ? count(rawRecording.acknowledgedCount) : null,
      closedUnconfirmedCount: scoped ? count(rawRecording.closedUnconfirmedCount) : null, expiresAt: scoped ? stamp(rawRecording.expiresAt) : null,
      note: scoped ? text(rawRecording.note, 600) : '' },
    account: { state: accountState, rows: accountRows, total: count(summary?.total), counts: accountCounts,
      saturated: summary?.saturated === true, firstAt: stamp(summary?.firstAt), lastAt: stamp(summary?.lastAt),
      coverage: safeCoverage(rawAccount.coverage), more: rawAccount.more === true, checkedAt: stamp(rawAccount.checkedAt), note: text(rawAccount.note, 600) },
    analysis: { state: ['idle', 'loading', 'ready', 'error'].includes(rawAnalysis.state) ? rawAnalysis.state : 'idle',
      report: plain(rawAnalysis.report) ? rawAnalysis.report : null, note: text(rawAnalysis.note, 600) } };
}

const CSS = `
[data-hm-activity-dashboard]{color:#e7e1d4;background:#141b22;border:1px solid #806f4d;border-radius:12px;padding:clamp(10px,3vw,18px);min-width:0;font:inherit;overflow-wrap:anywhere}
[data-hm-activity-dashboard] *{box-sizing:border-box;min-width:0}
[data-hm-activity-dashboard] h2,[data-hm-activity-dashboard] h3,[data-hm-activity-dashboard] h4{margin:0 0 8px;color:#f0e5ca;line-height:1.3}
[data-hm-activity-dashboard] p{margin:6px 0;line-height:1.55}
[data-hm-activity-dashboard] small{color:#c8c6bd;line-height:1.5;display:block}
[data-hm-activity-dashboard] .had-tabs,[data-hm-activity-dashboard] .had-actions{display:flex;flex-wrap:wrap;gap:8px;margin:12px 0}
[data-hm-activity-dashboard] button,[data-hm-activity-dashboard] select,[data-hm-activity-dashboard] summary{min-height:44px;font:inherit;line-height:1.3}
[data-hm-activity-dashboard] button,[data-hm-activity-dashboard] select{border:1px solid #88764f;border-radius:7px;background:#242e36;color:#f1eadb;padding:10px 12px;max-width:100%;cursor:pointer;white-space:normal}
[data-hm-activity-dashboard] button[aria-selected=true]{background:#6a5735;border-color:#c3a56c;color:#fff5db}
[data-hm-activity-dashboard] button:disabled{opacity:.55;cursor:default}
[data-hm-activity-dashboard] :is(button,select,summary):focus-visible{outline:3px solid #e2bd76;outline-offset:3px}
[data-hm-activity-dashboard] .had-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,155px),1fr));gap:9px;margin:14px 0}
[data-hm-activity-dashboard] .had-card{background:#1e2831;border:1px solid #4e514b;border-radius:8px;padding:12px}
[data-hm-activity-dashboard] .had-value{display:block;font-size:1.5em;line-height:1.3;color:#f2d699;margin:5px 0}
[data-hm-activity-dashboard] .had-note{border-left:3px solid #b29964;background:#1b252d;padding:10px 12px;margin:12px 0}
[data-hm-activity-dashboard] .had-toolbar{display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px;margin:16px 0 8px}
[data-hm-activity-dashboard] .had-list{list-style:none;padding:0;margin:0;display:grid;gap:8px}
[data-hm-activity-dashboard] .had-event{border:1px solid #454d50;border-radius:8px;padding:12px;background:#19232b}
[data-hm-activity-dashboard] .had-event-head{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:baseline;gap:5px 14px}
[data-hm-activity-dashboard] .had-counts{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,210px),1fr));gap:7px;margin:10px 0}
[data-hm-activity-dashboard] .had-count{display:flex;justify-content:space-between;gap:12px;border-bottom:1px solid #3b454b;padding:8px 0}
[data-hm-activity-dashboard] details{margin:10px 0;border-top:1px solid #414b4e;padding-top:4px}
[data-hm-activity-dashboard] summary{cursor:pointer;padding:12px 0;color:#e5c894}
[data-hm-activity-dashboard] pre{max-height:300px;overflow:auto;background:#10171d;border:1px solid #465057;border-radius:6px;padding:10px;white-space:pre-wrap;word-break:break-word;font-size:.82em;line-height:1.45}
[data-hm-activity-dashboard] [hidden]{display:none!important}
@media(max-width:420px){[data-hm-activity-dashboard] .had-tabs{display:grid;grid-template-columns:repeat(2,minmax(0,1fr))}[data-hm-activity-dashboard] .had-cards{grid-template-columns:repeat(2,minmax(0,1fr))}[data-hm-activity-dashboard] .had-card:last-child:nth-child(odd){grid-column:1/-1}[data-hm-activity-dashboard] .had-actions button{flex:1 1 100%}[data-hm-activity-dashboard] select{width:100%}}
`;
let mountNumber = 0;
export function mountActivityDashboard(parent, { onRefresh, onLoadAccount, onMoreAccount, onAnalyze, onManageRecording, onInspect } = {}) {
  if (!parent?.ownerDocument?.createElement || typeof parent.append !== 'function') throw new TypeError('A dashboard parent element is required.');
  const document = parent.ownerDocument, id = 'hm-activity-dashboard-' + ++mountNumber, root = document.createElement('section');
  root.dataset.hmActivityDashboard = ''; root.setAttribute('aria-label', 'Your activity'); parent.append(root);
  let data = normalizeActivityDashboardData(), scopeKey = null, view = 'character', filter = 'all', destroyed = false;
  const expanded = new Set();
  const el = (tag, value, className) => { const node = document.createElement(tag); if (value !== undefined) node.textContent = value; if (className) node.className = className; return node; };
  function button(label, callback, key, disabled = false) {
    const node = el('button', label); node.type = 'button'; node.disabled = disabled || typeof callback !== 'function'; node.dataset.focusKey = key;
    const captured = scopeKey;
    node.addEventListener('click', () => { if (!destroyed && captured === scopeKey && !node.disabled) callback?.(); }); return node;
  }
  function details(label, key) {
    const node = el('details'); node.open = expanded.has(key);
    const summary = el('summary', label); summary.dataset.focusKey = 'summary-' + key; node.append(summary);
    node.addEventListener('toggle', () => { if (!root.contains(node) || destroyed) return; if (node.open) expanded.add(key); else expanded.delete(key); }); return node;
  }
  function card(parentNode, label, value, note) {
    const node = el('div', undefined, 'had-card'); node.append(el('small', label), el('strong', value, 'had-value')); if (note) node.append(el('small', note)); parentNode.append(node);
  }
  function counts(parentNode, entries, title) {
    if (!entries.length) return;
    const box = details(title, view + '-counts'), rows = el('div', undefined, 'had-counts');
    for (const item of entries) { const row = el('div', undefined, 'had-count'); row.append(el('span', item.label), el('strong', number(item.total))); rows.append(row); }
    box.append(el('small', 'Number of recorded observations for each action, rather than quantities collected or skill scores.'), rows); parentNode.append(box);
  }
  function timeline(parentNode, rows, account = false) {
    const toolbar = el('div', undefined, 'had-toolbar'); toolbar.append(el('h3', account ? 'Recent account records' : 'Recent activity'));
    const select = el('select'); select.setAttribute('aria-label', 'Filter recent activity'); select.dataset.focusKey = 'activity-filter';
    for (const [key, label] of [['all', 'All activity'], ...Object.entries(FAMILIES), ['other', 'Other activity']]) {
      if (key !== 'all' && !rows.some(row => row.family === key)) continue;
      const option = el('option', label); option.value = key; select.append(option);
    }
    if (![...select.options].some(option => option.value === filter)) filter = 'all'; select.value = filter;
    select.addEventListener('change', () => { filter = select.value; render(); }); toolbar.append(select); parentNode.append(toolbar);
    const shown = filter === 'all' ? rows : rows.filter(row => row.family === filter);
    if (!shown.length) { parentNode.append(el('p', rows.length ? 'No recent records match this filter.' : account ? 'No recent details were returned for this account.' : 'Play a little to see your observed activity here.')); return; }
    const ordered = el('ol', undefined, 'had-list');
    for (const row of shown) {
      const item = el('li', undefined, 'had-event'), heading = el('div', undefined, 'had-event-head');
      heading.append(el('strong', row.label), el('small', date(row.at))); item.append(heading);
      item.append(el('small', (account && row.body === 'Your character' ? 'Character' : row.body) + ' · ' + row.controller));
      if (row.object) item.append(el('p', row.object));
      if (row.quantity !== null && ['combat.healed', 'resource.gathered', 'resource.harvested', 'supply.delivered'].includes(row.kind)) item.append(el('small', (row.kind === 'combat.healed' ? 'Health restored: ' : row.kind === 'resource.harvested' ? 'Ripe plants removed: ' : row.kind === 'supply.delivered' ? 'Supplies handed over: ' : 'Resources collected: ') + number(row.quantity)));
      if (row.refused && row.reason) item.append(el('small', 'Game reason: ' + row.reason.replaceAll('_', ' ').replaceAll('-', ' ')));
      if (row.statement) {
        const inspect = details('Inspect xAPI record', view + '-record-' + row.id); inspect.append(el('small', account ? 'Returned account statement.' : 'Projection of this browser observation. This view does not confirm external delivery.'));
        let encoded; try { encoded = JSON.stringify(row.statement, null, 2); } catch { encoded = 'This record could not be displayed.'; }
        inspect.append(el('pre', encoded));
        if (typeof onInspect === 'function') inspect.append(button('Inspect this record', () => onInspect(row.statement), 'inspect-' + row.id));
        item.append(inspect);
      }
      ordered.append(item);
    }
    parentNode.append(ordered);
  }
  function semantics(parentNode) {
    const box = details('What these observations mean', 'semantics');
    box.append(el('p', 'The browser observes a game action. Its xAPI record preserves the action, time, body and known controller.'));
    box.append(el('p', 'I2IDL-X adds a proposed classification of the xAPI record. Instructional resources link to their subject. An observed action does not establish knowledge, skill or mastery.'));
    box.append(el('small', 'Observation source: owner browser. Competency status: not assessed. Account receipts describe persistence; they do not establish a learning outcome.')); parentNode.append(box);
  }
  function patternView(parentNode) {
    if (data.identityState !== 'native') return;
    const box = details('Patterns in recent activity', 'patterns'), status = data.analysis;
    box.append(el('p', 'Look for paired observations in the retained recent window. Missing details can leave a pair incomplete.'));
    box.append(button(status.state === 'loading' ? 'Checking patterns…' : 'Check recent patterns', onAnalyze, 'analyze', status.state === 'loading'));
    if (status.note) box.append(el('p', status.note));
    if (status.state === 'ready' && status.report) {
      for (const [suffix, label] of Object.entries(MOTIFS)) {
        const patterns = list(status.report.partitions).flatMap(partition => list(partition.motifs)).filter(motif => text(motif.id).endsWith('/' + suffix));
        const matched = patterns.reduce((total, motif) => total + list(motif.matches).length, 0), incomplete = patterns.reduce((total, motif) => total + list(motif.incomplete).length, 0);
        box.append(el('p', label + ': ' + matched + ' observed pair' + (matched === 1 ? '' : 's') + (incomplete ? '; ' + incomplete + ' incomplete' : '')));
      }
      if (status.report.status === 'invalid') box.append(el('p', 'Some records could not be validated in this window.'));
      box.append(el('small', 'These pairs describe temporal game observations. They are not mastery scores or evidence that support caused an improvement.'));
    } else if (status.state === 'error' && !status.note) box.append(el('p', 'Pattern details are unavailable. Your activity remains available.'));
    parentNode.append(box);
  }
  function characterView(parentNode) {
    const local = data.local, recording = data.recording, cards = el('div', undefined, 'had-cards');
    card(cards, 'Observed with this character', number(local.eventCount), 'Cumulative game observations');
    card(cards, 'Recent details shown', number(local.rows.length), 'At most 16 recent events');
    const recordingLabel = !recording.scoped ? 'Unavailable' : recording.blocked ? 'Needs attention' : recording.pending ? 'Unconfirmed' : recording.enabled ? 'On' : 'Off';
    card(cards, 'Optional recording', recordingLabel, recording.enabled && recording.expiresAt ? 'Until ' + date(recording.expiresAt) : 'Separate from ordinary character saving'); parentNode.append(cards);
    if (!local.available) parentNode.append(el('p', 'This character’s activity is unavailable or still opening.'));
    const coverage = el('div', undefined, 'had-note');
    coverage.append(el('p', 'This view shows this character’s saved observations and up to 16 recent details. It is not a complete account history.'));
    if (local.lastEventAt) coverage.append(el('small', 'Last observed activity: ' + date(local.lastEventAt)));
    if (local.detailsDropped || local.captureUnavailable) coverage.append(el('small', number(local.detailsDropped || 0) + ' older details no longer retained; ' + number(local.captureUnavailable || 0) + ' observations unavailable during capture. Cumulative totals are shown separately.'));
    parentNode.append(coverage);
    const actions = el('div', undefined, 'had-actions'); actions.append(button('Refresh character activity', onRefresh, 'refresh-character'));
    if (data.identityState === 'native') actions.append(button('Manage optional recording', onManageRecording, 'manage-recording'));
    parentNode.append(actions);
    if (recording.scoped) {
      const info = details('Recording status', 'recording-status');
      if (recording.note) info.append(el('p', recording.note));
      info.append(el('p', recording.acknowledgedCount === null ? 'This character’s delivery confirmation count is unavailable.'
        : 'Confirmed by this character’s delivery journal: ' + number(recording.acknowledgedCount) + ' observations.'));
      if (recording.pending) info.append(el('p', number(recording.pendingCount) + ' observations await confirmation.'));
      if (recording.closedUnconfirmedCount) info.append(el('p', number(recording.closedUnconfirmedCount) + ' observations were closed without confirmation. Their arrival remains unknown.'));
      info.append(el('small', 'These are local delivery acknowledgments, not the account’s total records or a delivery label for each event.')); parentNode.append(info);
    }
    counts(parentNode, local.counts, 'Activity counts for this character'); timeline(parentNode, local.rows); patternView(parentNode); semantics(parentNode);
  }
  function accountView(parentNode) {
    const account = data.account, native = data.identityState === 'native';
    parentNode.append(el('p', 'Read records already held in your own account. Viewing them does not start activity recording.'));
    parentNode.append(el('small', 'Account totals can include other characters and applications.'));
    if (!native) { parentNode.append(el('p', 'Connect your native identity to view its private account record. Character history remains available in This character.')); return; }
    const actions = el('div', undefined, 'had-actions'); actions.append(button(account.state === 'loading' ? 'Loading account record…' : account.state === 'idle' ? 'Load account record' : 'Refresh account record', onLoadAccount, 'load-account', account.state === 'loading')); parentNode.append(actions);
    if (account.note) parentNode.append(el('p', account.note));
    if (account.state === 'idle') { parentNode.append(el('p', 'Your account record has not been loaded.')); return; }
    if (account.state === 'loading') { const status = el('p', 'Reading your own account record…'); status.setAttribute('role', 'status'); parentNode.append(status); return; }
    if (account.state === 'error') { if (!account.note) parentNode.append(el('p', 'Your account record could not be read. This does not mean it is empty.')); return; }
    const cards = el('div', undefined, 'had-cards');
    card(cards, 'Account observations', number(account.total), account.saturated ? 'Count has reached the record’s bound' : 'Returned cumulative account total');
    card(cards, 'Recent records retained', number(account.coverage.retainedCount), 'Account service’s bounded detail');
    card(cards, 'Recent records shown', number(account.rows.length), account.more ? 'More records are available' : 'Records returned for this view'); parentNode.append(cards);
    const coverage = el('div', undefined, 'had-note');
    coverage.append(el('p', account.coverage.completeHistory ? 'Coverage is reported by the account service.' : 'Recent account details are bounded. Cumulative totals can include observations whose detailed records are no longer retained.'));
    if (account.coverage.retentionMs !== null) coverage.append(el('small', 'Detail retention: up to ' + Math.round(account.coverage.retentionMs / 60000) + ' minutes, subject to record and storage limits.'));
    if (account.coverage.retainedFrom) coverage.append(el('small', 'Earliest retained detail: ' + date(account.coverage.retainedFrom)));
    if (account.coverage.through) coverage.append(el('small', 'Details through: ' + date(account.coverage.through)));
    if (account.coverage.prunedCount !== null) coverage.append(el('small', 'Earlier details pruned: ' + number(account.coverage.prunedCount)));
    if (account.checkedAt) coverage.append(el('small', 'Account checked: ' + date(account.checkedAt))); parentNode.append(coverage);
    if (account.total === 0 && !account.rows.length) parentNode.append(el('p', 'No observations are recorded in the returned account profile. Ordinary character history can still exist.'));
    counts(parentNode, account.counts, 'Returned account activity counts'); timeline(parentNode, account.rows, true);
    if (account.more) parentNode.append(button('Load more account records', onMoreAccount, 'more-account')); semantics(parentNode);
  }
  function render() {
    if (destroyed) return;
    const focusKey = root.contains(document.activeElement) ? document.activeElement?.dataset?.focusKey : null;
    const style = el('style', CSS), heading = el('h2', 'Your activity');
    const subtitle = el('p', view === 'account' ? data.identityState === 'native' ? 'Your signed-in account · Private records' : 'Account connection required'
      : data.characterName + (data.identityState === 'character-only' ? ' · Character history only' : ''));
    const tabs = el('div', undefined, 'had-tabs'); tabs.setAttribute('role', 'tablist'); tabs.setAttribute('aria-label', 'Activity record scope');
    for (const [key, label] of [['character', 'This character'], ['account', 'Account record']]) {
      const tab = button(label, () => { view = key; filter = 'all'; render(); }, 'tab-' + key); tab.id = id + '-tab-' + key;
      tab.setAttribute('role', 'tab'); tab.setAttribute('aria-selected', String(view === key)); tab.setAttribute('aria-controls', id + '-panel'); tab.tabIndex = view === key ? 0 : -1;
      tab.addEventListener('keydown', event => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        event.preventDefault(); view = event.key === 'Home' ? 'character' : event.key === 'End' ? 'account' : view === 'character' ? 'account' : 'character'; filter = 'all'; render();
        root.querySelector('[data-focus-key="tab-' + view + '"]')?.focus();
      }); tabs.append(tab);
    }
    const panel = el('div'); panel.id = id + '-panel'; panel.setAttribute('role', 'tabpanel'); panel.setAttribute('aria-labelledby', id + '-tab-' + view);
    if (view === 'character') characterView(panel); else accountView(panel);
    root.replaceChildren(style, heading, subtitle, tabs, panel);
    if (focusKey) [...root.querySelectorAll('[data-focus-key]')].find(node => node.dataset.focusKey === focusKey)?.focus({ preventScroll: true });
  }
  return Object.freeze({
    update(input) {
      if (destroyed) return;
      const next = normalizeActivityDashboardData(input), changed = scopeKey !== null && next.scopeKey !== scopeKey;
      if (changed) { view = 'character'; filter = 'all'; expanded.clear(); next.account = normalizeActivityDashboardData({ identityState: next.identityState }).account; next.analysis = normalizeActivityDashboardData().analysis; }
      scopeKey = next.scopeKey; data = next; render();
    },
    destroy() { if (destroyed) return; destroyed = true; expanded.clear(); root.remove(); },
  });
}
