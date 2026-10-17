/* Real gameplay observations stay with the character's private save. Optional
 * coaching receives a separate disclosed summary through its own consent path. */
const GAME_ACTIVITY = { module: null, loading: null, profile: null, stored: undefined, scope: null, blocked: false,
  queue: [], preloadDropped: 0, sessionId: crypto.randomUUID(), archive: null, archivePage: null, archiveFlight: null, archiveNeedsSave: false, lastArchiveAt: 0, code: null };
function activityScope() {
  const P = GAME.player; if (!GAME.started || !P || !GAME.prog || CAPTURE.on) return null;
  const native = SAVE.native, binding = NATIVE_PLAYER.status?.binding;
  if (native && (!NATIVE_PLAYER.status?.verified || !binding?.subjectDid || !NETWS.acct?.id || NETWS.reload)) return null;
  return { ownerDid: native ? binding.subjectDid : 'urn:local:hallowmarch', characterId: NETWS.acct?.id || ('local:' + P.faction + ':' + P.cls + ':' + P.name).slice(0, 128),
    body: P, profile: NATIVE_PLAYER.profile, accountId: NETWS.acct?.id, token: NETWS.token, generation: NETWS.generation,
    podUrl: binding?.podUrl, native, identity: JSON.stringify([native ? binding.subjectDid : 'local', NETWS.acct?.id || null, P.name, P.faction, P.cls]) };
}
function activityCurrent(scope) {
  const current = activityScope(); return !!current && current.identity === scope.identity && current.body === scope.body
    && (!scope.native || current.profile === scope.profile && current.token === scope.token && current.generation === scope.generation);
}
function activityModules() {
  if (!GAME_ACTIVITY.loading) GAME_ACTIVITY.loading = import('/gaming/identity/assets/gameplay-activity.mjs').then(module => {
    GAME_ACTIVITY.module = module; GAME_ACTIVITY.code = null; activityEnsure(); return module;
  }).catch(() => { GAME_ACTIVITY.code = 'activity_module_unavailable'; GAME_ACTIVITY.loading = null; return null; });
  return GAME_ACTIVITY.loading;
}
function activityEnsure() {
  const state = GAME_ACTIVITY, scope = activityScope(); if (!scope || state.blocked) return null;
  if (!state.module) { void activityModules(); return null; }
  if (state.scope && state.scope.identity !== scope.identity) {
    state.archive?.close(); state.archive = null; state.archivePage = null; state.archiveNeedsSave = false; state.profile = null;
    state.blocked = true; state.code = 'activity_owner_changed'; return null;
  }
  if (!state.profile) {
    try { state.profile = state.module.createGameplayActivityProfile({ ownerDid: scope.ownerDid, characterId: scope.characterId,
      sessionId: state.sessionId, state: state.stored }); state.scope = scope; }
    catch { state.blocked = true; state.code = 'activity_record_unreadable'; return null; }
  }
  state.scope = scope;
  if (state.preloadDropped) { state.profile.captureGap(state.preloadDropped); state.preloadDropped = 0; saveSoon(5000); }
  while (state.queue.length) { const item = state.queue.shift(); if (item.identity === scope.identity && item.body === scope.body) activityCommit(item.input); }
  return state.profile;
}
function activityCommit(input) {
  try { const result = GAME_ACTIVITY.profile.record(input); if (result.recorded) saveSoon(5000); return result; }
  catch { GAME_ACTIVITY.code = 'activity_event_refused'; return null; }
}
function activityOwnedBody(entity) {
  if (entity === GAME.player) return { id: NETWS.acct?.id || 'local-character', kind: 'character' };
  if (!entity || !entity.tame && entity.role !== 'companion') return null;
  if (entity && typeof mainWorldAgentBodies === 'function') {
    const known = mainWorldAgentBodies().find(body => body.entity === entity);
    if (known) return { id: known.id, kind: 'owned-unit' };
  }
  if (entity && typeof anOwned === 'function' && anOwned(entity)) return { id: (NETWS.acct?.id || 'local-character') + ':animal:' + entity.tame.aid, kind: 'owned-unit' };
  return null;
}
function activityRecord(type, objectId, quantity = 1, options = {}) {
  try {
  const scope = activityScope(), entity = options.entity || GAME.player, body = activityOwnedBody(entity);
  if (!scope || !body) return null;
  const input = { type, body, actor: options.actor || { kind: 'unattributed' },
    object: { id: String(objectId || type).slice(0, 128), kind: options.kind || type.split('.')[0] },
    result: { ...(quantity !== null ? { quantity: Math.max(0, Math.min(1e9, +quantity || 0)) } : {}),
      ...(options.success !== undefined ? { success: !!options.success } : {}), ...(options.reason ? { reason: options.reason } : {}) },
    context: { realm: GAME.player.faction, level: GAME.prog.level, party: !!NET.party,
      ...(['ability.executed', 'ability.refused', 'craft.completed', 'craft.refused'].includes(type) ? { attemptId: crypto.randomUUID() } : {}) } };
  const profile = activityEnsure();
  if (!profile) {
    if (!GAME_ACTIVITY.blocked && GAME_ACTIVITY.queue.length < 64) GAME_ACTIVITY.queue.push({ identity: scope.identity, body: scope.body, input });
    else if (!GAME_ACTIVITY.blocked) GAME_ACTIVITY.preloadDropped = Math.min(Number.MAX_SAFE_INTEGER, GAME_ACTIVITY.preloadDropped + 1);
    return null;
  }
  return activityCommit(input);
  } catch { return null; } // Observing an action never changes its gameplay result.
}
function activityEntityEvent(type, entity, object, quantity = 1, options = {}) {
  try {
  if (!activityOwnedBody(entity)) return null;
  return activityRecord(type, object?.mobType || object?.role || object?.kind || object?.id || type, quantity, { ...options, entity });
  } catch { return null; }
}
function activitySnapshot() {
  const profile = activityEnsure();
  const snapshot = profile ? profile.snapshot() : { revision: 0, eventCount: 0, lastEventAt: null, milestones: [], current: null,
    history: { recent: [], pendingEvents: 0, complete: false }, summary: { counters: {}, observationAuthority: 'owner-browser-observation', competencyStatus: 'not-assessed' } };
  const path = GAME.started && GAME.prog?.lore && typeof pathNext === 'function' ? pathNext() : null;
  return { ...snapshot, available: !!profile, blocked: GAME_ACTIVITY.blocked, code: GAME_ACTIVITY.code,
    nativeOwned: !!GAME_ACTIVITY.scope?.native, canonicalPath: path ? { id: path.id, title: path.title } : null,
    archive: { pending: !!GAME_ACTIVITY.archivePage || GAME_ACTIVITY.archiveNeedsSave, busy: !!GAME_ACTIVITY.archiveFlight,
      status: GAME_ACTIVITY.archive?.status().code || null } };
}
function activityInterventionStart(id) {
  const profile = activityEnsure(), scope = activityScope(); if (!profile || !scope) return null;
  try { const result = profile.interventionStart(id, { body: activityOwnedBody(GAME.player), actor: { kind: 'human-input' },
    context: { realm: GAME.player.faction, level: GAME.prog.level, party: !!NET.party } }); saveSoon(5000); return result; }
  catch { GAME_ACTIVITY.code = 'activity_intervention_refused'; return null; }
}
async function activityArchiveFlush() {
  const state = GAME_ACTIVITY, profile = activityEnsure(), scope = activityScope();
  if (!profile || !scope?.native || state.archiveFlight || !activityCurrent(scope) || Date.now() - state.lastArchiveAt < 30000) return state.archiveFlight;
  if (!state.archiveNeedsSave && !state.archivePage && !profile.nextArchivePage()) return null;
  state.lastArchiveAt = Date.now();
  const flight = (async () => {
    try {
      if (state.archiveNeedsSave) {
        await saveNow(); if (!activityCurrent(scope)) return;
        if (SAVE.pending || SAVE.nativeFlight) return;
        state.archiveNeedsSave = false; state.archivePage = null;
      }
      if (!state.archive) {
        const status = await nativePlayerRequest('/gaming/identity/status'); if (!activityCurrent(scope)) return;
        if (!status.bound || !status.verified || status.account?.id !== scope.accountId || status.binding?.subjectDid !== scope.ownerDid || status.binding.podUrl !== scope.podUrl) return;
        const matches = await NATIVE_PLAYER.cache.list({}); if (!activityCurrent(scope)) return;
        const match = matches.find(item => item.ownerDid === scope.ownerDid && item.podUrl === scope.podUrl && item.expiresAt > Date.now());
        const held = match && await NATIVE_PLAYER.cache.get(match); if (!activityCurrent(scope)) return;
        if (!held?.credential || held.credential.refreshToken) return;
        const module = await import('/gaming/identity/assets/gameplay-activity-archive.mjs'); if (!activityCurrent(scope)) return;
        const archive = module.createOwnerGameplayActivityArchive({ binding: status.binding, credential: held.credential, relayUrl: match.relayUrl });
        state.archive = archive; await archive.connect(); if (!activityCurrent(scope)) { archive.close(); return; }
      }
      state.archivePage ||= profile.nextArchivePage(); if (!state.archivePage) return;
      const result = await state.archive.appendPage(state.archivePage); if (!activityCurrent(scope)) return;
      if (!result.saved) return;
      profile.archiveConfirmed(state.archivePage, result.reference); state.archiveNeedsSave = true;
      await saveNow(); if (!activityCurrent(scope)) return;
      if (!SAVE.pending && !SAVE.nativeFlight) { state.archiveNeedsSave = false; state.archivePage = null; }
    } catch { state.code = 'activity_archive_unconfirmed'; }
  })();
  state.archiveFlight = flight; void flight.finally(() => { if (state.archiveFlight === flight) state.archiveFlight = null; }); return flight;
}
registerSavePart('char', 'activity', { save: () => GAME_ACTIVITY.profile?.save() || GAME_ACTIVITY.stored || null,
  load(value) {
    GAME_ACTIVITY.archive?.close(); GAME_ACTIVITY.archive = null; GAME_ACTIVITY.archivePage = null; GAME_ACTIVITY.archiveNeedsSave = false;
    GAME_ACTIVITY.profile = null; GAME_ACTIVITY.stored = value; GAME_ACTIVITY.scope = null; GAME_ACTIVITY.blocked = false; GAME_ACTIVITY.code = null; GAME_ACTIVITY.queue = []; GAME_ACTIVITY.preloadDropped = 0;
  }, key: value => value ? [value.schema, value.revision, value.eventCount, value.archiveHead] : null });
setInterval(() => { void activityArchiveFlush(); }, 30000);
window.addEventListener('pagehide', () => { GAME_ACTIVITY.archive?.close(); });
window.__hm.activity = Object.freeze({ snapshot: activitySnapshot, record: activityRecord, interventionStart: activityInterventionStart,
  observeCriterion: criterion => activityEnsure()?.observeCriterion(criterion) || null,
  resource: id => activityEnsure()?.resource(id) || null, archive: activityArchiveFlush,
  statements: () => { const profile = activityEnsure(), owner = GAME_ACTIVITY.scope?.ownerDid;
    return profile && owner?.startsWith('did:') ? profile.save().recent.map(event => GAME_ACTIVITY.module.gameplayActivityStatement(event, owner)) : []; },
  trajectory: () => { const profile = activityEnsure(), owner = GAME_ACTIVITY.scope?.ownerDid;
    if (!profile || !owner?.startsWith('did:')) return null;
    return { schema: 'hallowmarch.observed-trajectory/v1', agentDid: owner, steps: profile.save().recent.slice(-32).map(event => {
      const statement = GAME_ACTIVITY.module.gameplayActivityStatement(event, owner);
      return { verb: statement.verb.id, object: { id: statement.object.id, name: event.object.id }, at: event.observedAt, eventId: event.id };
    }) };
  } });
void activityModules();
