/* A player's observation dashboard. Viewing never starts recording or repairs
 * a delivery. Account reads use the current player's existing native session. */
const ACTIVITY_DASHBOARD_UI = { opened: false, parent: null, overview: null, host: null, button: null, back: null, entry: null,
  view: null, module: null, loading: null, scopeKey: '', epoch: 0, reader: null, page: null, lastRender: '',
  account: { state: 'idle', statements: [] }, analysis: { state: 'idle' } };
const activityDashboardCopy = value => JSON.parse(JSON.stringify(value));
function activityDashboardKey() {
  const scope = activityScope();
  return scope ? JSON.stringify([scope.identity, scope.generation ?? null, scope.native, scope.ownerDid, scope.podUrl ?? null]) : '';
}
function activityDashboardInvalidate() {
  const state = ACTIVITY_DASHBOARD_UI;
  state.epoch++; state.reader?.close(); state.reader = null; state.page = null; state.scopeKey = '';
  state.account = { state: 'idle', statements: [] }; state.analysis = { state: 'idle' }; state.lastRender = '';
  state.view?.destroy(); state.view = null;
  if (state.host) state.host.replaceChildren();
}
function activityDashboardRecording(scope) {
  const state = MARCH_LEARNING, live = state.delivery?.status(), stored = state.stored;
  const sameOwner = value => !!value && value.ownerDid === scope?.ownerDid && value.characterId === scope?.characterId;
  const candidate = sameOwner(live) ? live : sameOwner(stored) && stored.schema === 'hallowmarch.gameplay-learning-delivery/v1' ? stored : null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  if (!live && !stored && scope?.native && NATIVE_PLAYER.status?.verified && NATIVE_PLAYER.status?.bound) {
    if (state.blocked) return { scoped: true, enabled: false, busy: state.busy, blocked: true, pending: false,
      acknowledgedCount: null, pendingCount: null, closedUnconfirmedCount: null, expiresAt: null,
      note: 'A previous recording journal could not be read. Its confirmation counts are unavailable. Nothing was sent again.' };
    return { scoped: true, enabled: false, pending: false, acknowledgedCount: 0, pendingCount: 0, closedUnconfirmedCount: 0 };
  }
  const storedShape = candidate !== stored || stored && count(stored.throughOrdinal) !== null
    && Object.keys(stored).every(key => ['schema', 'ownerDid', 'characterId', 'throughOrdinal', 'acknowledgedCount', 'closedUnconfirmedCount', 'pending'].includes(key))
    && (stored.pending === null || stored.pending && typeof stored.pending === 'object' && Array.isArray(stored.pending.events)
      && stored.pending.events.length > 0 && stored.pending.events.length <= 20);
  if (!candidate || !storedShape || count(candidate.acknowledgedCount) === null || count(candidate.closedUnconfirmedCount ?? 0) === null)
    return { scoped: false, enabled: false, pending: false, acknowledgedCount: 0, pendingCount: 0, closedUnconfirmedCount: 0 };
  const pending = candidate.pending === true || !!candidate.pending && typeof candidate.pending === 'object';
  const pendingCount = count(candidate.pendingCount ?? candidate.pending?.events?.length ?? 0);
  const currentLive = sameOwner(live) && live.connected === true && !!state.scope && activityCurrent(state.scope);
  return { scoped: true, enabled: currentLive && state.enabledUntil > Date.now(), busy: state.busy,
    blocked: state.blocked, pending, pendingCount: pendingCount ?? 0, acknowledgedCount: candidate.acknowledgedCount,
    closedUnconfirmedCount: candidate.closedUnconfirmedCount ?? 0, expiresAt: state.enabledUntil > 0 ? new Date(state.enabledUntil).toISOString() : null,
    note: currentLive || !state.scope && sameOwner(stored) ? String(state.note || '').slice(0, 400) : '' };
}
function activityDashboardData() {
  const scope = activityScope(), state = ACTIVITY_DASHBOARD_UI, profile = GAME_ACTIVITY.profile;
  const scoped = !!scope && GAME_ACTIVITY.scope && activityCurrent(GAME_ACTIVITY.scope)
    && GAME_ACTIVITY.scope.identity === scope.identity && GAME_ACTIVITY.scope.body === scope.body;
  const saved = scoped && profile ? profile.save() : null;
  const events = saved?.recent || [], native = !!scope?.native;
  return { scopeKey: activityDashboardKey(), characterName: String(GAME.player?.name || 'Your character'),
    identityState: !scope ? 'unavailable' : native ? 'native' : 'character-only',
    local: scoped && profile ? profile.snapshot() : null, events,
    statements: native && scoped && GAME_ACTIVITY.module ? events.map(event => GAME_ACTIVITY.module.gameplayActivityStatement(event, scope.ownerDid)) : [],
    recording: activityDashboardRecording(scope), account: state.account, analysis: state.analysis };
}
function activityDashboardCurrent(scope, epoch) {
  if (!ACTIVITY_DASHBOARD_UI.opened || ACTIVITY_DASHBOARD_UI.epoch !== epoch || !activityCurrent(scope)
    || activityDashboardKey() !== ACTIVITY_DASHBOARD_UI.scopeKey || !ACTIVITY_DASHBOARD_UI.host?.isConnected
    || document.hidden) throw new Error('Your active character changed. Open the dashboard again for your own account.');
}
function activityDashboardAccountMessage(error) {
  if (['needs_reauth', 'account_record_delegation_required', 'account_record_owner_mismatch'].includes(error?.code))
    return 'Refresh your identity connection, then try your account record again. Activity recording remains unchanged.';
  if (['account_record_snapshot_changed', 'account_record_cursor'].includes(error?.code))
    return 'Your account record changed or this view expired. Refresh it to open the latest records.';
  if (typeof error?.code === 'string' && error.code.startsWith('account_record_'))
    return 'Your account record could not be confirmed. Try refreshing. Your saved activity has not changed.';
  return String(error?.message || 'Your account record is unavailable. Nothing was sent or recorded.').slice(0, 400);
}
async function activityDashboardModules() {
  const state = ACTIVITY_DASHBOARD_UI;
  if (state.module) return state.module;
  if (!state.loading) state.loading = import('/gaming/identity/assets/activity-dashboard.mjs').then(module => {
    state.module = module; return module;
  }).catch(error => { state.loading = null; throw error; });
  return state.loading;
}
function activityDashboardUpdate(force = false) {
  const state = ACTIVITY_DASHBOARD_UI;
  if (!state.opened || !state.host?.isConnected || !state.view) return;
  if (state.scopeKey !== activityDashboardKey()) { activityDashboardHide(); return; }
  const data = activityDashboardData();
  const key = JSON.stringify([data.scopeKey, data.local?.revision, data.identityState, data.recording,
    state.account.state, state.account.checkedAt, state.account.statements.length, state.account.note,
    state.analysis.state, state.analysis.note]);
  if (force || key !== state.lastRender) { state.lastRender = key; state.view.update(data); }
}
async function activityDashboardShow() {
  const state = ACTIVITY_DASHBOARD_UI;
  if (!state.parent?.isConnected) return;
  if (state.opened) return;
  activityDashboardInvalidate(); state.opened = true; state.scopeKey = activityDashboardKey();
  state.button.setAttribute('aria-expanded', 'true');
  if (state.back) state.back.hidden = false;
  state.overview.hidden = true; state.host.hidden = false; state.host.textContent = 'Opening your activity dashboard…';
  state.host.tabIndex = -1; state.host.focus?.({ preventScroll: true });
  const epoch = state.epoch, host = state.host;
  try {
    const module = await activityDashboardModules();
    if (!state.opened || state.epoch !== epoch || state.host !== host || !host.isConnected) return;
    host.replaceChildren();
    state.view = module.mountActivityDashboard(host, { onRefresh: () => activityDashboardUpdate(true),
      onLoadAccount: () => { void activityDashboardReadAccount(false); }, onMoreAccount: () => { void activityDashboardReadAccount(true); },
      onAnalyze: () => { void activityDashboardAnalyze(); }, onManageRecording: activityDashboardManageRecording });
    activityDashboardUpdate(true);
    const heading = host.querySelector('h2'); if (heading) { heading.tabIndex = -1; heading.focus({ preventScroll: true }); }
  } catch {
    if (state.epoch === epoch && host.isConnected) {
      host.replaceChildren(marchConsultingNode('p', 'Activity history could not open. Your saved progress is unchanged.'));
      host.append(marchConsultingButton('Try opening history again', () => { state.opened = false; void activityDashboardShow(); }));
    }
  }
}
function activityDashboardHide({ restoreFocus = true } = {}) {
  const state = ACTIVITY_DASHBOARD_UI;
  state.opened = false; activityDashboardInvalidate();
  if (state.overview) state.overview.hidden = false;
  if (state.host) state.host.hidden = true;
  if (state.back) state.back.hidden = true;
  if (state.button) {
    state.button.setAttribute('aria-expanded', 'false');
    if (restoreFocus && state.button.isConnected && !document.hidden && state.button.getClientRects?.().length) state.button.focus();
  }
}
function activityDashboardManageRecording() {
  activityDashboardHide({ restoreFocus: false });
  const optional = $('march-progress-optional'); if (optional) optional.open = true;
  const control = $('march-learning-record');
  control?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  ['march-learning-check', 'march-learning-stop', 'march-learning-enable', 'march-progress-identity'].map(id => $(id))
    .find(button => button && !button.hidden && !button.disabled && button.getClientRects().length)?.focus({ preventScroll: true });
}
function activityDashboardProgressMount(parent, overview) {
  const state = ACTIVITY_DASHBOARD_UI;
  if (state.parent === parent && state.button?.isConnected) return;
  activityDashboardHide({ restoreFocus: false });
  state.entry?.remove(); state.button?.remove(); state.back?.remove(); state.host?.remove();
  const entry = marchConsultingNode('div'); entry.style.cssText = 'margin:0 0 14px;display:flex;gap:8px;flex-wrap:wrap';
  const button = marchConsultingButton('View activity history', () => { void activityDashboardShow(); });
  button.id = 'march-activity-open'; button.setAttribute('aria-expanded', 'false'); button.setAttribute('aria-controls', 'march-activity-dashboard');
  entry.append(button);
  const host = marchConsultingNode('section'); host.id = 'march-activity-dashboard'; host.hidden = true; host.style.minWidth = '0';
  const navigation = overview.querySelector('#march-progress-navigation');
  if (navigation) navigation.append(button); else parent.insertBefore(entry, overview);
  const back = marchConsultingButton('Back to Progress', () => activityDashboardHide()); back.id = 'march-activity-back'; back.hidden = true;
  back.style.cssText = 'position:sticky;top:0;z-index:2;max-width:100%;align-self:start;margin-bottom:12px;min-height:44px;white-space:normal';
  parent.append(back, host);
  Object.assign(state, { parent, overview, host, button, back, entry });
}
async function activityDashboardReadAccount(more) {
  const state = ACTIVITY_DASHBOARD_UI, scope = activityScope();
  if (!scope?.native || state.account.state === 'loading') return;
  if (more && (!state.reader || !state.page?.more || state.account.statements.length >= 200)) return;
  const epoch = state.epoch;
  try {
    activityDashboardCurrent(scope, epoch);
    state.account = { ...state.account, state: 'loading', note: '' }; activityDashboardUpdate(true);
    if (!more) {
      state.reader?.close(); state.reader = null; state.page = null;
      state.account = { state: 'loading', statements: [] };
      const binding = activityDashboardCopy(NATIVE_PLAYER.status.binding);
      const verified = await nativePlayerRequest('/gaming/identity/status'); activityDashboardCurrent(scope, epoch);
      if (!verified.verified || !verified.bound || verified.binding?.subjectDid !== binding.subjectDid
        || verified.binding?.podUrl !== binding.podUrl || verified.binding?.authenticatedAgentDid !== binding.authenticatedAgentDid)
        throw new Error('Reconnect your original identity to read your own account record.');
      await nativePlayerModules(); activityDashboardCurrent(scope, epoch);
      const matches = (await NATIVE_PLAYER.cache.list({})).filter(item => item.ownerDid === binding.subjectDid
        && item.podUrl === binding.podUrl && item.expiresAt > Date.now()); activityDashboardCurrent(scope, epoch);
      if (matches.length !== 1) throw new Error('Reconnect your identity to select your own private account.');
      const cached = await NATIVE_PLAYER.cache.get(matches[0]); activityDashboardCurrent(scope, epoch);
      if (!cached?.credential || cached.credential.refreshToken || cached.credential.expiresAt <= Date.now())
        throw new Error('Reconnect your identity before reading your account record.');
      const module = await import('/gaming/identity/assets/gameplay-record-reader.mjs'); activityDashboardCurrent(scope, epoch);
      const reader = module.createOwnerGameplayRecordReader({ binding, credential: cached.credential, relayUrl: matches[0].relayUrl,
        assertCurrent: () => activityDashboardCurrent(scope, epoch) });
      state.reader = reader;
      await reader.connect(); activityDashboardCurrent(scope, epoch);
    }
    const page = more ? await state.reader.next(state.page) : await state.reader.query({ limit: 40, ascending: false });
    activityDashboardCurrent(scope, epoch);
    if (page.ownerDid !== scope.ownerDid || page.state !== 'loaded') throw new Error('Your own account record could not be confirmed.');
    const rows = more ? [...state.account.statements, ...page.statements] : page.statements;
    const unique = new Map();
    for (const statement of rows) {
      if (unique.has(statement.id) && marchConsultingCanonical(unique.get(statement.id)) !== marchConsultingCanonical(statement))
        throw new Error('The account record changed. Refresh it before loading more.');
      unique.set(statement.id, statement);
    }
    state.page = page; state.account = { state: 'ready', statements: [...unique.values()].slice(0, 200), coverage: page.coverage,
      summary: page.summary, more: page.more && unique.size < 200, checkedAt: page.checkedAt,
      note: unique.size >= 200 && page.more ? 'Showing the first 200 records in this view. Refresh to open a new recent window.' : '' };
  } catch (error) {
    if (state.epoch !== epoch) return;
    if (!activityCurrent(scope)) { activityDashboardHide(); return; }
    state.account = { ...state.account, state: 'error', note: activityDashboardAccountMessage(error) };
  } finally { if (state.epoch === epoch) activityDashboardUpdate(true); }
}
async function activityDashboardAnalyze() {
  const state = ACTIVITY_DASHBOARD_UI, scope = activityScope(), epoch = state.epoch;
  if (!scope?.native || state.analysis.state === 'loading') return;
  state.analysis = { state: 'loading' }; activityDashboardUpdate(true);
  try {
    activityDashboardCurrent(scope, epoch);
    const report = await window.__hm.activity.patterns(); activityDashboardCurrent(scope, epoch);
    state.analysis = report ? { state: 'ready', report } : { state: 'error', note: 'No retained observations are available for this character yet.' };
  } catch { if (state.epoch === epoch) state.analysis = { state: 'error', note: 'The recent sequences could not be checked. Your saved observations are unchanged.' }; }
  finally { if (state.epoch === epoch) activityDashboardUpdate(true); }
}
setInterval(() => {
  const state = ACTIVITY_DASHBOARD_UI;
  if (!state.opened) return;
  if (!state.host?.isConnected || document.hidden || UI.modal !== 'menu'
    || !(UI.menuTab === 'progress' || UI.menuTab === 'chronicle' && LORE.chronSec === 'coach')) { activityDashboardHide(); return; }
  if (state.scopeKey !== activityDashboardKey()) { activityDashboardHide(); return; }
  activityDashboardUpdate();
}, 1000);
document.addEventListener('visibilitychange', () => { if (document.hidden) activityDashboardHide(); });
window.addEventListener('pagehide', activityDashboardHide);
window.__hm.activityDashboard = Object.freeze({ open: activityDashboardShow, close: activityDashboardHide,
  refresh: () => activityDashboardUpdate(true), loadAccount: () => activityDashboardReadAccount(false),
  get status() { const state = ACTIVITY_DASHBOARD_UI; return { open: state.opened, account: state.account.state,
    loadedRecords: state.account.statements.length, analysis: state.analysis.state }; } });
