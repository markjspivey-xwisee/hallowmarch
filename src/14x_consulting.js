/* Contextual coaching follows observed gameplay. Private game activity is
 * separate from an explicitly enabled, bounded live Foxxi connection. */
const MARCH_CONSULTING = { ownerKey: '', sessionId: '', journal: null, consultant: null,
  current: null, openConsultant: null, openLearning: null, busy: false, note: '', reviewed: null, result: null,
  observationId: null, consultationId: null, baseline: null, evaluation: null, rendering: false, enabled: false, coachUntil: 0, epoch: 0, snoozeUntil: 0,
  lastRequestAt: 0, lastEvidence: '', baselineFocus: null, tried: null, lastTip: '', issue: false };
const marchConsultingCopy = value => JSON.parse(JSON.stringify(value));
const marchConsultingCanonical = value => Array.isArray(value) ? '[' + value.map(marchConsultingCanonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + marchConsultingCanonical(value[key])).join(',') + '}' : JSON.stringify(value);
const MARCH_COACH_DELIVERY = { pending: null, receipts: [], blocked: false };
registerSavePart('char', 'coachDelivery', { save: () => marchConsultingCopy(MARCH_COACH_DELIVERY), load(value) {
  const valid = item => item && typeof item.id === 'string' && /^urn:hallowmarch:consultation:[0-9a-f-]{36}$/.test(item.id)
    && typeof item.at === 'string' && item.at.length <= 40 && Number.isFinite(Date.parse(item.at)) && ['intent', 'completed', 'closed-unconfirmed'].includes(item.stage);
  const normalize = item => ({ id: item.id, at: item.at, stage: item.stage });
  MARCH_COACH_DELIVERY.pending = valid(value?.pending) ? normalize(value.pending) : null;
  MARCH_COACH_DELIVERY.blocked = value?.blocked === true || !!value?.pending && !valid(value.pending);
  MARCH_COACH_DELIVERY.receipts = (Array.isArray(value?.receipts) ? value.receipts : []).slice(-8).filter(valid).map(normalize);
}, key: value => value });
async function marchConsultingPersistIntent(review) {
  if (MARCH_COACH_DELIVERY.blocked) throw new Error('A previous request record is unreadable. Close that unconfirmed request without resending before continuing.');
  const id = review.prepared.payload.situation.id, saved = MARCH_COACH_DELIVERY.pending;
  if (saved && saved.id !== id) throw new Error('An earlier Foxxi reply is unconfirmed. It has not been resent. Close it in Request needs attention before asking again.');
  MARCH_COACH_DELIVERY.pending ||= { id, at: new Date().toISOString(), stage: 'intent' };
  await saveNow(); marchConsultingAllowed(review.epoch);
  const persisted = SAVE.lastBody && JSON.parse(SAVE.lastBody)?.char?.x?.coachDelivery?.pending;
  if (!SAVE.native || SAVE.pending || persisted?.id !== id) throw new Error('Your private request intent is not confirmed yet. Confirm your character save before continuing.');
}
function marchConsultingCloseDelivery(stage) {
  if (MARCH_COACH_DELIVERY.pending) MARCH_COACH_DELIVERY.receipts.push({ ...MARCH_COACH_DELIVERY.pending, stage });
  MARCH_COACH_DELIVERY.receipts = MARCH_COACH_DELIVERY.receipts.slice(-8); MARCH_COACH_DELIVERY.pending = null; MARCH_COACH_DELIVERY.blocked = false; saveSoon(1000);
}
function marchConsultingOwnerKey() {
  const b = NATIVE_PLAYER.status?.binding;
  return GAME.started && NETWS.acct?.id && b?.subjectDid && b?.podUrl
    ? JSON.stringify([NETWS.acct.id, b.subjectDid, b.podUrl, NETWS.generation]) : '';
}

function marchConsultingClose() {
  if (typeof marchLearningClose === 'function') marchLearningClose();
  MARCH_CONSULTING.enabled = false; MARCH_CONSULTING.coachUntil = 0; MARCH_CONSULTING.epoch++;
  MARCH_CONSULTING.consultant?.close?.(); MARCH_CONSULTING.journal?.close?.();
  Object.assign(MARCH_CONSULTING, { journal: null, consultant: null, current: null, openConsultant: null, openLearning: null, reviewed: null,
    result: null, observationId: null, consultationId: null, baseline: null, sessionId: '', evaluation: null,
    tried: null, baselineFocus: null, lastEvidence: '', lastRequestAt: 0, issue: false });
}

function marchConsultingObservation() {
  const P = GAME.player, prog = GAME.prog;
  if (!GAME.started || !P || !prog) throw new Error('Enter your character before reviewing your play.');
  const count = value => Math.max(0, Math.min(1e9, Math.floor(Number.isFinite(value) ? value : 0)));
  let nearbyHostiles = 0;
  for (const entity of ENT) if (entity !== P && entity.alive && !entity.removed && isEnemy(P, entity)
    && dist(P.x, P.z, entity.x, entity.z) <= 30) nearbyHostiles = Math.min(24, nearbyHostiles + 1);
  return { observationLevel: 'owner-browser', capturedAt: new Date().toISOString(), metrics: {
    healthPercent: Math.round(clamp(P.hp / Math.max(1, P.maxHp), 0, 1) * 100),
    level: count(prog.level), creatureDefeats: count(prog.kills), deaths: count(prog.deaths),
    activePlaySeconds: count(prog.played), nearbyHostiles,
    ownedCompanions: Math.min(16, anCompanions().length + (typeof partyCompanionMember === 'function' && partyCompanionMember() ? 1 : 0)),
  } };
}
function marchConsultingNode(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className;
  if (tag === 'summary') node.style.cssText = 'min-height:44px;box-sizing:border-box;padding:10px 0;cursor:pointer';
  return node;
}
function marchConsultingButton(text, action) {
  const button = marchConsultingNode('button', text, 'btn'); button.type = 'button'; button.style.minHeight = '44px';
  button.style.maxWidth = '100%'; button.style.whiteSpace = 'normal'; button.style.overflowWrap = 'anywhere';
  button.onclick = action; return button;
}
async function marchConsultingRun(action) {
  const state = MARCH_CONSULTING; if (state.busy) return;
  state.busy = true; state.note = ''; state.issue = false; marchConsultingRender();
  try { await action(); }
  catch (error) {
    state.issue = true;
    state.note = error?.message || 'Coaching could not be confirmed. Keep this page open and retry the pending private step.';
    if (error?.code === 'pod_pending') state.note = 'Your private save is awaiting confirmation. Keep this page open and confirm that same save before continuing.';
  } finally { state.busy = false; marchConsultingRender(); }
}

async function marchConsultingConnect() {
  const state = MARCH_CONSULTING;
  if (state.journal && state.consultant) { state.current(); return; }
  if (!state.journal) await marchConsultingOpenHistory();
  state.current();
  let consultant;
  try {
    consultant = state.openConsultant();
    state.note = 'Checking the live support connection…'; marchConsultingRender();
    await consultant.connect(); state.current(); state.consultant = consultant;
    state.note = state.consultationId ? 'Your private plan is open. You can review a new request or check what changed after trying this one.' : 'Connected. Your coach follows the current milestone and actual play.';
  } catch (error) {
    consultant?.close?.();
    if (!state.journal || !state.current) throw error;
    state.current();
    // Private history has a separate, already-confirmed owner connection. A
    // planner outage cannot discard that journal, its session or pending I/O.
    throw Object.assign(new Error('Your private coaching history is open. Foxxi could not connect. Retry the support connection before requesting a new plan.'), { code: error?.code || 'consulting_unavailable' });
  }
}

async function marchConsultingOpenHistory() {
  const state = MARCH_CONSULTING;
  if (!SAVE.native || !NATIVE_PLAYER.status?.verified || !NATIVE_PLAYER.status?.bound) throw new Error('Connect your identity and enter your private character first.');
  const ownerKey = marchConsultingOwnerKey(), accountId = NETWS.acct?.id, token = NETWS.token;
  const binding = marchConsultingCopy(NATIVE_PLAYER.status.binding);
  const current = () => {
    if (!ownerKey || ownerKey !== marchConsultingOwnerKey() || NETWS.acct?.id !== accountId || NETWS.token !== token || !NATIVE_PLAYER.status?.verified) {
      marchConsultingClose(); throw new Error('Your identity connection changed. Open private coaching again for your own character.');
    }
  };
  state.note = 'Opening your private coaching history…'; marchConsultingRender();
  const status = await nativePlayerRequest('/gaming/identity/status'); current();
  if (!status.verified || !status.bound || status.binding?.subjectDid !== binding.subjectDid || status.binding?.podUrl !== binding.podUrl
    || status.binding?.authenticatedAgentDid !== binding.authenticatedAgentDid) throw new Error('Reconnect your original identity before opening private coaching.');
  await nativePlayerModules(); current();
  const matches = (await NATIVE_PLAYER.cache.list({})).filter(item => item.ownerDid === binding.subjectDid && item.podUrl === binding.podUrl && item.expiresAt > Date.now()); current();
  if (matches.length !== 1) throw new Error('Reconnect your identity to confirm one current private pod connection.');
  const cached = await NATIVE_PLAYER.cache.get(matches[0]); current();
  if (!cached?.credential || cached.credential.refreshToken || cached.credential.expiresAt <= Date.now()) throw new Error('Reconnect your identity before opening private coaching.');
  const [privateModule, liveModule] = await Promise.all([
    import('/gaming/identity/assets/performance-consultation.mjs'), import('/gaming/identity/assets/foxxi-consulting.mjs'),
  ]); current();
  const sessionId = crypto.randomUUID();
  const journal = privateModule.createOwnerPerformanceConsultation({ binding, credential: cached.credential, relayUrl: matches[0].relayUrl, sessionId, checkpoint: 'hallowmarch-performance-consultation/v1' });
  try {
    await journal.connect(); current();
    if (!journal.status().keyPresent) throw new Error('Restore your character’s recovery key before keeping private coaching history.');
    const history = await journal.read(); current();
    if (MARCH_COACH_DELIVERY.pending && history.consultations.some(item => item.response?.response?.plan?.situationId === MARCH_COACH_DELIVERY.pending.id)) marchConsultingCloseDelivery('completed');
    Object.assign(state, { ownerKey, sessionId, journal, current, openLearning: async options => {
      current(); const module = await import('/gaming/identity/assets/gameplay-learning-delivery.mjs'); current();
      return module.createOwnerGameplayLearningDelivery({ ...options, binding, credential: cached.credential,
        relayUrl: matches[0].relayUrl, journal, sessionId });
    }, openConsultant: () => {
      current(); return liveModule.createFoxxiConsultant({ binding, credential: cached.credential, relayUrl: matches[0].relayUrl, journal, sessionId, subjectKind: 'human' });
    } });
    const last = history.consultations?.at(-1), baseline = history.observations?.find(item => item.id === last?.observationId);
    if (last && baseline) Object.assign(state, { result: last.response, observationId: baseline.id, consultationId: last.id, baseline });
    state.note = last ? 'Your private plan is open.' : 'Your private coaching history is open.'; marchConsultingRender();
  } catch (error) { if (state.journal === journal) marchConsultingClose(); else journal.close(); throw error; }
}
function marchConsultingEvidence(context) {
  return [{ kind: 'owner-browser-observation', performerDid: NATIVE_PLAYER.status.binding.subjectDid,
    at: context.capturedAt, metrics: marchConsultingCopy(context.metrics) }];
}

async function marchConsultingRecordedObservation(input, progress) {
  const state = MARCH_CONSULTING;
  if (progress.observation) return progress.observation;
  if (progress.observationAttempted) {
    const history = await state.journal.read(); state.current();
    const expected = marchConsultingCanonical(marchConsultingEvidence(input.context));
    const found = history.observations.filter(item => item.task.id === input.task.id && marchConsultingCanonical(item.evidence) === expected);
    if (found.length !== 1) throw new Error('This exact private observation is not confirmed. Confirm the pending save before continuing.');
    return progress.observation = found[0];
  }
  progress.observationAttempted = true;
  let result;
  try { result = await state.journal.appendObservation({ task: input.task, performerKind: 'human', evidence: marchConsultingEvidence(input.context) }); }
  catch (error) { marchConsultingKnownRefusal(progress, 'observationAttempted', error); throw error; }
  state.current();
  if (!result.saved || !result.observation?.id) throw new Error('Your pod did not confirm this private observation.');
  return progress.observation = result.observation;
}

async function marchConsultingRetry() {
  const state = MARCH_CONSULTING; state.current?.();
  if (!state.journal) throw new Error('Open private coaching first.');
  const result = await state.journal.retry(); state.current();
  if (!result.saved) throw new Error('The same private save is still awaiting confirmation.');
  state.note = 'The pending private save is confirmed. Continue the same coaching request when you are ready.';
}

function marchConsultingKnownRefusal(progress, stage, error) {
  if (!MARCH_CONSULTING.journal?.status().pending && ['consultation_consent_required', 'task_scope_changed', 'consultation_capacity',
    'key_required', 'invalid_consultation', 'invalid_evaluation', 'unknown_observation', 'conflict'].includes(error?.code)) progress[stage] = false;
}

function marchConsultingActivity() { return window.__hm?.activity?.snapshot?.() || null; }
function marchConsultingTrajectory() {
  const source = window.__hm?.activity?.trajectory?.();
  if (!source?.steps?.length) return undefined;
  return { agentDid: source.agentDid, steps: source.steps.slice(-32).map(step => ({ modalStatus: 'Asserted',
    granularity: 'task', verb: step.verb, objectId: step.object.id, objectName: step.object.name,
    recordedAt: step.at, wasDerivedFrom: [step.eventId] })) };
}
function marchConsultingAllowed(epoch = MARCH_CONSULTING.epoch) {
  const s = MARCH_CONSULTING;
  s.current?.();
  if (!s.enabled || s.coachUntil <= Date.now() || epoch !== s.epoch) throw new Error('Live coaching is paused. Your private progress is still available.');
}
function marchConsultingFocus(snapshot, pinned) {
  const current = snapshot?.current;
  const key = focus => focus ? focus.id + ':' + (focus.bodyId || 'party') : '';
  if (pinned?.criterion) {
    const observed = window.__hm?.activity?.observeCriterion?.(pinned.criterion);
    return observed ? { ...pinned, ...observed, key: key(pinned) } : null;
  }
  if (pinned && pinned.bodyId && key(current) !== key(pinned)) return null;
  const source = pinned || current;
  if (!source) return null;
  const milestone = !source.bodyId && snapshot.milestones?.find(item => item.id === source.id);
  const focus = pinned ? { ...source, ...(milestone || (key(current) === key(source) ? current : {})) } : { ...current, ...(milestone || {}) };
  focus.key = key(source);
  focus.observedResult = Number.isFinite(focus.current) && Number.isFinite(focus.target)
    ? `${focus.current} / ${focus.target} observed for ${focus.title}.`
    : String(focus.observedResult || 'No comparable outcome observed.');
  focus.evidenceIds = (focus.evidenceIds || []).slice(-16);
  return focus;
}
function marchConsultingEvidenceKey(snapshot) {
  const outcomes = Object.entries(snapshot?.summary?.counters || {}).filter(([kind]) => !['agent.command-accepted', 'intervention.started'].includes(kind));
  return JSON.stringify(outcomes);
}
function marchConsultingTask(snapshot = marchConsultingActivity()) {
  const focus = marchConsultingFocus(snapshot);
  if (!focus) throw new Error('Play a little while the game opens your activity journal.');
  const context = marchConsultingObservation(), clean = value => String(value || '').slice(0, 1300), trajectory = marchConsultingTrajectory();
  return { task: { id: 'urn:hallowmarch:play-session:' + MARCH_CONSULTING.sessionId,
    desiredResult: 'Develop effective play through observed Hallowmarch activity and practical support.',
    observedResult: clean(focus.title + ': ' + focus.observedResult),
    workContext: 'Hallowmarch play-session coaching for the authenticated player and their separate party companion.',
    constraints: ['Use the existing character and separate party companion.',
      'Offer a small practical intervention. Missing evidence stays unknown.', 'Do not infer motivation, knowledge, mastery or a cause from an outcome alone.'] },
    focus: { id: focus.id, title: clean(focus.title), desiredResult: clean(focus.desiredResult || focus.description || focus.title),
      workContext: clean(focus.workContext || focus.description || focus.title),
      ...(focus.bodyId ? { bodyId: focus.bodyId, bodyKind: focus.bodyKind } : {}) },
    context, taskOrigin: 'observed-gameplay', observationId: crypto.randomUUID(),
    ...(trajectory ? { trajectories: [trajectory] } : {}) };
}
async function marchConsultingConsent(purpose, recipient, taskId) {
  const state = MARCH_CONSULTING; marchConsultingAllowed();
  try { await state.journal.authorize({ purpose, recipient, taskId }); }
  catch (error) {
    if (!['consultation_consent_required', 'consulting_consent_required'].includes(error?.code)) throw error;
    const lifetimeMs = Math.floor(Math.min(900000, state.coachUntil - Date.now()));
    if (lifetimeMs < 1000) throw new Error('This live coaching session has ended.');
    await state.journal.grantConsent({ accepted: true, purpose, recipient, taskId, lifetimeMs });
  }
  marchConsultingAllowed();
}
async function marchConsultingEnable() {
  const state = MARCH_CONSULTING;
  if (state.reviewed?.cancelled && !state.reviewed.progress.requestAttempted && !MARCH_COACH_DELIVERY.pending) state.reviewed = null;
  if (state.reviewed || MARCH_COACH_DELIVERY.pending || MARCH_COACH_DELIVERY.blocked) throw new Error('Confirm or close the pending request below before starting another guidance session.');
  state.epoch++; state.enabled = true; state.coachUntil = Date.now() + 900000;
  await marchConsultingConnect();
  await marchConsultingReview(); await marchConsultingRequest();
}
async function marchConsultingReview() {
  const state = MARCH_CONSULTING;
  marchConsultingAllowed(); await marchConsultingConnect(); marchConsultingAllowed();
  if (state.reviewed) return; // An uncertain delivery is never replaced automatically.
  const snapshot = marchConsultingActivity(), input = marchConsultingTask(snapshot);
  state.reviewed = { input, prepared: state.consultant.preparePlan(input), at: Date.now(), epoch: state.epoch,
    focus: marchConsultingFocus(snapshot), evidenceKey: marchConsultingEvidenceKey(snapshot), progress: {} };
}
async function marchConsultingRequest() {
  const state = MARCH_CONSULTING, review = state.reviewed;
  if (!review || !state.consultant) throw new Error('Open the current coaching context first.');
  const continuing = () => { marchConsultingAllowed(review.epoch);
    if (state.reviewed !== review || review.cancelled) throw new Error('This coaching request was stopped.'); };
  continuing();
  if (!review.progress.requestAttempted && Date.now() - review.at > 120000) throw new Error('The gameplay snapshot is old. Dismiss this request before asking about current play.');
  const taskId = review.input.task.id;
  await marchConsultingConsent('retain-observations', state.journal.status().podUrl, taskId); continuing();
  await marchConsultingConsent('request-consultation', review.prepared.recipient, taskId); continuing();
  const observation = await marchConsultingRecordedObservation(review.input, review.progress); continuing();
  if (!review.progress.response) {
    if (review.progress.requestAttempted) throw new Error('This reply is unconfirmed. It has not been requested again. Your previous guidance remains available.');
    await marchConsultingPersistIntent(review); continuing();
    review.progress.requestAttempted = true; state.lastRequestAt = Date.now(); state.lastEvidence = review.evidenceKey;
    state.note = 'Your coach is reviewing what happened…'; marchConsultingRender();
    review.progress.response = await state.consultant.requestPlan(review.prepared); continuing();
  }
  state.result = review.progress.response; state.baseline = observation; state.observationId = observation.id;
  state.baselineFocus = review.focus;
  let stored;
  if (review.progress.consultationAttempted) {
    const history = await state.journal.read(); continuing();
    stored = history.consultations.find(x => x.observationId === observation.id && marchConsultingCanonical(x.response) === marchConsultingCanonical(review.progress.response));
    if (!stored) throw new Error('Your coach replied. Its private save is not confirmed yet; confirm that same save.');
  } else {
    review.progress.consultationAttempted = true;
    let saved;
    try { saved = await state.journal.appendConsultation({ observationId: observation.id, service: state.result.service, response: state.result }); }
    catch (error) { marchConsultingKnownRefusal(review.progress, 'consultationAttempted', error); throw error; }
    continuing();
    if (!saved.saved || !saved.consultation?.id) throw new Error('Your pod has not confirmed the coach plan yet.');
    stored = saved.consultation;
  }
  state.consultationId = stored.id; state.evaluation = null; state.tried = null; state.reviewed = null; marchConsultingCloseDelivery('completed');
  state.note = 'Your coach plan is saved privately. Choose a useful next step, or keep playing.';
}
async function marchConsultingWithdraw() {
  const state = MARCH_CONSULTING, taskId = state.reviewed?.input.task.id || state.baseline?.task.id;
  state.enabled = false; state.coachUntil = 0; state.epoch++; state.issue = false;
  if (state.reviewed) state.reviewed.cancelled = true;
  state.note = 'Live sharing stopped. Your private game journal and local guidance continue.'; marchConsultingRender();
  if (taskId && state.journal && state.consultant) {
    await state.journal.revokeConsent({ purpose: 'request-consultation', recipient: state.consultant.status().recipient, taskId }); state.current();
    await state.journal.revokeConsent({ purpose: 'retain-observations', recipient: state.journal.status().podUrl, taskId }); state.current();
  }
}
function marchConsultingIntervene(id) {
  const activity = window.__hm?.activity, resource = activity?.resource?.(id);
  if (!resource) return;
  activity.interventionStart(id);
  const s = MARCH_CONSULTING;
  const focus = marchConsultingFocus(marchConsultingActivity());
  if (s.baseline && s.consultationId && focus?.key === s.baselineFocus?.key) {
    s.evaluation = null;
    s.tried = { id, title: resource.title || id, attemptId: crypto.randomUUID(),
      at: Date.now(), focus: marchConsultingCopy(focus), consultationId: s.consultationId, progress: {} };
  }
  if (resource.note) uiToast(resource.note, 'hint');
  if (resource.destination === 'party') { closeMenu(); netSheetToggle(true); mainWorldAgentRender(); return; }
  if (resource.kind === 'practice') { closeMenu(); return; }
  if (resource.destination === 'craft') { closeMenu(); openCraft(null); return; }
  const section = { 'guide:combat': 'callings', 'guide:classes': 'callings', 'guide:gathering': 'living',
    'guide:farming': 'fields', 'guide:bounties': 'path', 'guide:supplies': 'season' }[resource.destination];
  openChronicle(section || 'path');
}
async function marchConsultingCompare() {
  const s = MARCH_CONSULTING, tried = s.tried, snapshot = marchConsultingActivity();
  if (!tried || !s.baseline || tried.consultationId !== s.consultationId || Date.now() - tried.at < 5000) return;
  const focus = marchConsultingFocus(snapshot, tried.focus);
  if (!focus || focus.observedResult === tried.focus.observedResult
    && !focus.evidenceIds.some(id => !tried.focus.evidenceIds.includes(id))) return;
  marchConsultingAllowed();
  if (!s.evaluation) {
    const context = marchConsultingObservation();
    s.evaluation = { consultationId: tried.consultationId, attemptId: tried.attemptId, input: { task: { ...s.baseline.task,
      observedResult: ('After choosing ' + tried.title + ': ' + focus.observedResult).slice(0, 1600) }, context },
      playerReport: 'The player selected ' + tried.title + '. Subsequent owner-browser observations are compared; no cause or mastery is established.',
      progress: {} };
  }
  const e = s.evaluation;
  if (e.consultationId !== s.consultationId || e.attemptId !== tried.attemptId) throw new Error('Open the current attempt before comparing it.');
  await marchConsultingConsent('retain-observations', s.journal.status().podUrl, e.input.task.id);
  const observation = await marchConsultingRecordedObservation(e.input, e.progress); marchConsultingAllowed();
  if (e.progress.evaluationAttempted) {
    const h = await s.journal.read(); marchConsultingAllowed();
    e.saved = h.evaluations.find(x => x.consultationId === s.consultationId && x.observationId === observation.id);
    if (!e.saved) throw new Error('The same private comparison is awaiting confirmation.');
  } else {
    e.progress.evaluationAttempted = true;
    const result = await s.journal.appendEvaluation({ consultationId: s.consultationId, observationId: observation.id, playerReport: e.playerReport });
    marchConsultingAllowed(); if (!result.saved) throw new Error('Your private comparison is awaiting confirmation.'); e.saved = result.evaluation;
  }
  s.tried = null; s.note = 'Your later attempt is recorded alongside the earlier observation.';
}
function marchConsultingCreate(parent) {
  const box = marchConsultingNode('section'); box.id = 'march-consulting'; box.style.cssText = 'display:grid;gap:14px;overflow-wrap:anywhere';
  box.append(marchConsultingNode('h2', 'Progress'), marchConsultingNode('p',
    'Follow your path, review what happened, or find help with your next game action.'));
  const navigation = marchConsultingNode('div'); navigation.id = 'march-progress-navigation';
  navigation.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap;min-width:0';
  const path = marchConsultingButton('Continue your path', () => openChronicle('path')); path.id = 'march-progress-path'; path.classList.add('primary');
  navigation.append(path); box.append(navigation);
  const milestones = marchConsultingNode('div'); milestones.id = 'march-coach-milestones'; box.append(milestones);
  const interventions = marchConsultingNode('section'); interventions.id = 'march-coach-interventions'; box.append(interventions);
  const optional = marchConsultingNode('details'); optional.id = 'march-progress-optional';
  optional.append(marchConsultingNode('summary', 'Optional guidance and recording'));
  optional.append(marchConsultingNode('p', 'Choose these separately if you want extra guidance or an account activity record. Ordinary character progress already saves as you play.'));
  const prerequisite = marchConsultingNode('div'); prerequisite.id = 'march-progress-prerequisite';
  const identity = marchConsultingButton('Open identity settings', () => openPlayerIdentity()); identity.id = 'march-progress-identity';
  prerequisite.append(marchConsultingNode('p', 'Connect your identity and open your private character to use these options. Your path and character history remain available.'),identity); optional.append(prerequisite);
  const cards = marchConsultingNode('div'); cards.id = 'march-progress-options';
  cards.style.cssText = 'display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,19rem),1fr));gap:14px;align-items:start';
  const guidance = marchConsultingNode('section'); guidance.id = 'march-coach-guidance';
  guidance.style.cssText = 'display:grid;gap:10px;min-width:0;border:1px solid #806f4d;border-radius:10px;padding:14px';
  guidance.append(marchConsultingNode('h3', 'Gameplay guidance'), marchConsultingNode('p', 'Ask Foxxi for practical suggestions based on a small summary of your current play.'));
  const note = marchConsultingNode('p'); note.id = 'march-consulting-note'; note.setAttribute('role', 'status'); guidance.append(note);
  const actions = marchConsultingNode('div'); actions.style.cssText = 'display:flex;gap:8px;flex-wrap:wrap';
  const ask = marchConsultingButton('Review current play', () => {
    void marchConsultingRun(async () => { await marchConsultingReview(); await marchConsultingRequest(); });
  }); ask.id = 'march-consulting-request';
  const later = marchConsultingButton('Quiet for 10 minutes', () => { MARCH_CONSULTING.snoozeUntil = Date.now() + 600000; MARCH_CONSULTING.issue = false; MARCH_CONSULTING.note = 'Suggestions are quiet for ten minutes. Your progress still records.'; marchConsultingRender(); });
  later.id = 'march-consulting-quiet';
  const stop = marchConsultingButton('Stop Foxxi sharing', () => {
    void marchConsultingWithdraw().catch(error => { MARCH_CONSULTING.note = error.message; MARCH_CONSULTING.issue = true; marchConsultingRender(); });
  }); stop.id = 'march-consulting-withdraw';
  const enable = marchConsultingButton('Start guidance · 15 minutes', () => marchConsultingRun(marchConsultingEnable)); enable.id = 'march-consulting-connect';
  actions.append(enable, ask, stop); guidance.append(actions);
  const result = marchConsultingNode('section'); result.id = 'march-consulting-result'; guidance.append(result);
  const privacy = marchConsultingNode('details'); privacy.id = 'march-coach-options';
  privacy.append(marchConsultingNode('summary', 'Guidance privacy and options'));
  privacy.append(marchConsultingNode('p', 'Shares your current milestone and a small gameplay summary with Foxxi. Chat, inventory contents and other players’ private records are excluded.'));
  privacy.append(marchConsultingNode('p', 'Enable a 15-minute guidance session to review new observations automatically and keep its plans privately in your pod. You can stop sharing at any time.'));
  privacy.append(later);
  const preview = marchConsultingNode('details'); preview.append(marchConsultingNode('summary', 'Technical sharing details'));
  const pre = marchConsultingNode('pre'); pre.id = 'march-coach-preview'; pre.style.cssText = 'white-space:pre-wrap;font-size:12px'; preview.append(pre); privacy.append(preview);
  guidance.append(privacy);
  const recovery = marchConsultingNode('section'); recovery.id = 'march-coach-recovery'; recovery.hidden = true;
  recovery.append(marchConsultingNode('h4', 'Request needs attention'), marchConsultingNode('p', 'Confirm the existing request or close it without sending it again.'));
  const retry = marchConsultingButton('Confirm pending private save', () => marchConsultingRun(marchConsultingRetry)); retry.id = 'march-consulting-retry';
  const resume = marchConsultingButton('Continue this saved request', () => marchConsultingRun(marchConsultingRequest)); resume.id = 'march-coach-continue';
  recovery.append(retry, resume);
  const dismiss = marchConsultingButton('Close unconfirmed request · do not resend', () => {
    MARCH_CONSULTING.enabled = false; MARCH_CONSULTING.epoch++; MARCH_CONSULTING.reviewed = null; MARCH_CONSULTING.issue = false;
    marchConsultingCloseDelivery('closed-unconfirmed'); MARCH_CONSULTING.note = 'The unconfirmed request was closed without resending. You can keep playing or explicitly start a new consultation.'; marchConsultingRender();
  }); dismiss.id = 'march-coach-close-pending'; recovery.append(dismiss); guidance.append(recovery);
  cards.append(guidance);
  if (typeof marchLearningMount === 'function') marchLearningMount(cards);
  optional.append(cards); box.append(optional); parent.append(box);
  if (typeof activityDashboardProgressMount === 'function') activityDashboardProgressMount(parent, box);
  return box;
}
function marchConsultingSetupReady() {
  return SAVE.native && SAVE.readConfirmed && NATIVE_PLAYER.status?.verified && NATIVE_PLAYER.status?.bound;
}
function marchConsultingRender() {
  const s = MARCH_CONSULTING, parent = $('march-coach-mount');
  if (!parent || !GAME.started || s.rendering) return;
  const focused = document.activeElement, focusedId = parent.contains(focused) ? focused.id : '';
  s.rendering = true;
  try {
    if (!$('march-consulting')) marchConsultingCreate(parent);
    const snapshot = marchConsultingActivity();
    $('march-consulting-note').textContent = s.note || (!snapshot?.current ? 'Play a little before starting guidance. Your path is ready.'
      : s.enabled ? 'On · reviewing meaningful changes for this 15-minute session.' : 'Off · automatic progress and practical tips remain available.');
    const ready = marchConsultingSetupReady();
    $('march-progress-prerequisite').hidden = ready;
    $('march-progress-options').hidden = !ready;
    const cancelledBeforeDelivery = s.reviewed?.cancelled && !s.reviewed.progress.requestAttempted
      && !s.journal?.status().pending && !MARCH_COACH_DELIVERY.pending && !MARCH_COACH_DELIVERY.blocked;
    const pendingReview = s.reviewed && !cancelledBeforeDelivery;
    const pending = !!(s.journal?.status().pending || MARCH_COACH_DELIVERY.pending || MARCH_COACH_DELIVERY.blocked || pendingReview);
    const recording = typeof activityDashboardRecording === 'function' ? activityDashboardRecording(activityScope()) : null;
    const attention = pending || s.issue || recording?.scoped && (recording.pending || recording.blocked);
    const optional = $('march-progress-optional');
    if (attention && optional.dataset.attention !== 'yes') optional.open = true;
    optional.dataset.attention = attention ? 'yes' : 'no';
    optional.querySelector('summary').textContent = attention ? 'Optional guidance and recording · needs attention'
      : s.enabled ? 'Optional guidance and recording · guidance on' : recording?.enabled ? 'Optional guidance and recording · recording on' : 'Optional guidance and recording';
    const milestones = $('march-coach-milestones'), revision = s.ownerKey + ':' + String(snapshot?.revision ?? 'opening');
    if (milestones.dataset.revision !== revision) {
      const expanded = milestones.querySelector('details')?.open;
      milestones.dataset.revision = revision; milestones.replaceChildren();
      if (!snapshot?.current || snapshot.available === false) milestones.append(marchConsultingNode('p',
        'Your path is ready. Play a little to build a recent activity history and receive practical tips.'));
      else {
        milestones.append(marchConsultingNode('h3', 'Next practice milestone'),
          marchConsultingNode('p', 'These milestones track the game actions you practise. Continue your path opens your next guided objective.'),
          marchConsultingNode('h4', snapshot.current?.title || 'Opening your journal…'),
          marchConsultingNode('p', snapshot.current?.desiredResult || ''), marchConsultingNode('p', snapshot.current?.observedResult || ''));
        const all = marchConsultingNode('details'); all.open = !!expanded;
        const milestoneSummary = marchConsultingNode('summary', 'Development milestones · ' + (snapshot.milestones || []).filter(x => x.completed).length + ' / ' + (snapshot.milestones || []).length);
        milestoneSummary.id = 'march-progress-milestones-summary'; all.append(milestoneSummary);
        for (const m of snapshot.milestones || []) {
          const card = marchConsultingNode('section'); card.style.cssText = 'padding:10px;border:1px solid #806f4d;border-radius:8px;margin:8px 0';
          card.append(marchConsultingNode('h4', (m.completed ? '✓ ' : '') + m.title), marchConsultingNode('p', m.description || m.criteria || ''));
          const meter = document.createElement('progress'); meter.max = Math.max(1, Number(m.target) || 1); meter.value = Math.min(meter.max, Number(m.current) || 0);
          meter.setAttribute('aria-label', m.title); card.append(meter, marchConsultingNode('p', `${Number(m.current) || 0} / ${meter.max} observed`)); all.append(card);
        }
        milestones.append(all);
        if (snapshot.summary?.bodyObservations?.length) {
          const bodies = marchConsultingNode('details'); bodies.append(marchConsultingNode('summary', 'Activity across your party'));
          for (const body of snapshot.summary.bodyObservations) bodies.append(marchConsultingNode('p',
            (body.kind === 'character' ? 'Your character' : body.bodyId.includes(':companion:') ? 'Party companion' : 'Owned companion') + ': ' + body.eventCount + ' observed events.'));
          if (!snapshot.summary.bodyHistory?.complete) bodies.append(marchConsultingNode('p', 'Some earlier activity has no body breakdown.'));
          bodies.append(marchConsultingNode('small', 'These are observed activities, not skill scores. Controller attribution can be unknown.')); milestones.append(bodies);
        }
        if (snapshot.history?.detailsDropped) milestones.append(marchConsultingNode('p', 'Some detailed events could not be retained; totals are shown separately.'));
        if (snapshot.code) milestones.append(marchConsultingNode('p', 'Detailed activity is awaiting its private connection. Your game remains playable.'));
      }
    }
    const current = snapshot?.current;
    const suggestions = $('march-coach-interventions'), suggestionsKey = JSON.stringify([current?.id, current?.interventions]);
    if (suggestions.dataset.key !== suggestionsKey) {
      suggestions.dataset.key = suggestionsKey; suggestions.replaceChildren();
      if (current?.interventions?.length) suggestions.append(marchConsultingNode('h3', 'Help with this action'));
      let extra = null;
      for (const [index, intervention] of (current?.interventions || []).slice(0, 3).entries()) {
        if (index === 2) { extra = marchConsultingNode('details'); extra.append(marchConsultingNode('summary', 'More help with this action')); suggestions.append(extra); }
        const target = extra || suggestions;
        target.append(marchConsultingButton(intervention.title || 'Try this support', () => marchConsultingIntervene(intervention.id)));
        if (intervention.note) target.append(marchConsultingNode('p', intervention.note));
      }
    }
    const result = $('march-consulting-result'), resultKey = JSON.stringify([s.result?.response || null, s.evaluation?.saved?.id || null]);
    if (result.dataset.resultKey !== resultKey) {
      result.dataset.resultKey = resultKey; result.replaceChildren();
      if (s.result?.response) {
        result.append(marchConsultingNode('h4', 'Foxxi suggests'), marchConsultingNode('p', s.result.response.plan?.summary || 'Your saved plan is available.'));
        for (const selected of (s.result.response.plan?.selected || []).slice(0, 3)) {
          result.append(marchConsultingNode('p', String(selected?.rationale || selected?.summary || selected?.title || '').slice(0, 1000)));
        }
        const why = marchConsultingNode('details'); why.append(marchConsultingNode('summary', 'Why this suggestion?'));
        for (const reason of (Array.isArray(s.result.response.diagnosis?.reasoning) ? s.result.response.diagnosis.reasoning : []).slice(0, 4)) why.append(marchConsultingNode('p', String(reason).slice(0, 1000)));
        if (s.result.response.diagnosis?.caveat) why.append(marchConsultingNode('p', String(s.result.response.diagnosis.caveat).slice(0, 1000)));
        result.append(why);
        result.append(marchConsultingNode('small', 'Based on observed play. Suggestions are proposals; their effect is measured through later attempts.'));
      }
      if (s.evaluation?.saved) result.append(marchConsultingNode('p', 'A later attempt is recorded for comparison.'));
    }
    $('march-consulting-connect').hidden = s.enabled;
    $('march-consulting-connect').disabled = s.busy || !ready || pending || !snapshot?.current;
    $('march-coach-options').querySelector('summary').textContent = 'Guidance privacy and options';
    $('march-consulting-request').hidden = !s.enabled;
    $('march-consulting-request').disabled = s.busy || !!s.reviewed || !snapshot?.current;
    $('march-consulting-quiet').hidden = !s.enabled;
    $('march-consulting-quiet').disabled = false;
    $('march-consulting-withdraw').hidden = !s.enabled;
    $('march-consulting-withdraw').disabled = !s.enabled;
    $('march-coach-recovery').hidden = s.busy || !pending;
    $('march-consulting-retry').hidden = !s.journal?.status().pending;
    $('march-consulting-retry').disabled = s.busy;
    $('march-coach-continue').hidden = !s.reviewed || s.reviewed.cancelled || !s.enabled;
    $('march-coach-continue').disabled = s.busy || !!s.journal?.status().pending;
    $('march-coach-close-pending').hidden = !MARCH_COACH_DELIVERY.pending && !MARCH_COACH_DELIVERY.blocked && !pendingReview;
    $('march-coach-preview').textContent = JSON.stringify(s.reviewed?.prepared?.payload || { sharing: s.enabled ? 'Current milestone and owner-browser gameplay summary' : 'off' }, null, 2);
    if (typeof marchLearningRender === 'function') marchLearningRender();
  } finally {
    s.rendering = false;
    if (focusedId && !focused.isConnected) {
      const replacement = $(focusedId);
      if (replacement?.isConnected && replacement.getClientRects().length) replacement.focus({ preventScroll: true });
    }
  }
}
function marchConsultingStep() {
  if (typeof netHumanLive === 'function' && !netHumanLive()) return;
  const s = MARCH_CONSULTING, key = marchConsultingOwnerKey(), now = Date.now();
  if (s.ownerKey && s.ownerKey !== key) { marchConsultingClose(); s.note = 'The player connection changed. Live sharing is stopped.'; }
  s.ownerKey = key;
  if (s.enabled && s.coachUntil <= now) { s.enabled = false; s.epoch++; s.note = 'Your live coaching session ended. Local guidance and private progress remain available.'; }
  // No popup, speech or network coaching interrupts combat, menus or a snooze.
  const quiet = !!UI.modal || document.hidden || !GAME.player?.alive || GAME.t <= GAME.player.combatUntil || s.snoozeUntil > now;
  const eligible = !quiet && s.enabled && s.consultant && !s.busy && !s.reviewed && now - s.lastRequestAt >= 120000;
  const snap = eligible && now - (s.lastPoll || 0) >= 1000 ? (s.lastPoll = now, marchConsultingActivity()) : null;
  if (snap && marchConsultingEvidenceKey(snap) !== s.lastEvidence) {
    s.lastRequestAt = now;
    void marchConsultingRun(async () => { if (s.tried) await marchConsultingCompare(); await marchConsultingReview(); await marchConsultingRequest(); });
  }
  if (UI.modal === 'menu' && (UI.menuTab === 'progress' || UI.menuTab === 'chronicle' && LORE.chronSec === 'coach')
    && now - (s.lastRender || 0) >= 500) { s.lastRender = now; marchConsultingRender(); }
}
chronAdd('coach', 'Progress', 'you', () => {
  queueMicrotask(marchConsultingRender);
  return '<div id="march-coach-mount"></div>';
}, 'path');
if (window.__hm) window.__hm.consulting = { observation: marchConsultingObservation, render: marchConsultingRender,
  get status() { const s = MARCH_CONSULTING; return { connected: !!s.journal && !!s.consultant,
    privateHistoryOpen: !!s.journal, busy: s.busy, enabled: s.enabled, reviewed: !!s.reviewed,
    hasPlan: !!s.result, hasPrivatePlan: !!s.consultationId, hasEvaluation: !!s.evaluation?.saved }; } };
