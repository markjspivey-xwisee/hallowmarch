/* Personal performance support in the existing March. A player report and a
 * bounded owner-page observation are evidence inputs, never verified outcomes. */
const MARCH_CONSULTING = { ownerKey: '', sessionId: '', journal: null, consultant: null,
  current: null, openConsultant: null, busy: false, note: '', reviewed: null, result: null,
  observationId: null, consultationId: null, baseline: null, evaluation: null, rendering: false };
const marchConsultingCopy = value => JSON.parse(JSON.stringify(value));
const marchConsultingCanonical = value => Array.isArray(value) ? '[' + value.map(marchConsultingCanonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + marchConsultingCanonical(value[key])).join(',') + '}' : JSON.stringify(value);
function marchConsultingOwnerKey() {
  const b = NATIVE_PLAYER.status?.binding;
  return GAME.started && NETWS.acct?.id && b?.subjectDid && b?.podUrl
    ? JSON.stringify([NETWS.acct.id, b.subjectDid, b.podUrl, NETWS.generation]) : '';
}
function marchConsultingClose() {
  MARCH_CONSULTING.consultant?.close?.(); MARCH_CONSULTING.journal?.close?.();
  Object.assign(MARCH_CONSULTING, { journal: null, consultant: null, current: null, openConsultant: null, reviewed: null,
    result: null, observationId: null, consultationId: null, baseline: null, sessionId: '', evaluation: null });
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
    ownedCompanions: Math.min(16, anCompanions().length),
  } };
}
const marchConsultingMetricLabels = { healthPercent: 'Health (%)', level: 'Character level',
  creatureDefeats: 'Character’s recorded creature defeats', deaths: 'Character’s recorded deaths',
  activePlaySeconds: 'Character’s recorded active play (seconds)', nearbyHostiles: 'Nearby hostiles (up to 24)', ownedCompanions: 'Your companions (up to 16)' };
function marchConsultingNode(tag, text, className) {
  const node = document.createElement(tag); if (text !== undefined) node.textContent = String(text);
  if (className) node.className = className; return node;
}
function marchConsultingButton(text, action) {
  const button = marchConsultingNode('button', text, 'btn'); button.type = 'button'; button.style.minHeight = '44px';
  button.onclick = action; return button;
}
function marchConsultingInvalidate() {
  const state = MARCH_CONSULTING; if (!state.reviewed) return;
  state.reviewed = null;
  for (const id of ['march-consulting-retain', 'march-consulting-share']) if ($(id)) $(id).checked = false;
  state.note = 'Your answers changed. Review the updated request before sharing it.'; marchConsultingRender();
}
function marchConsultingTask() {
  const value = id => $(id).value.trim();
  const goal = value('march-consulting-goal'), desiredResult = value('march-consulting-desired'), observedResult = value('march-consulting-current');
  if (!goal || !desiredResult || !observedResult) throw new Error('Add your goal, current result and desired result.');
  const workContext = value('march-consulting-context') || 'Playing my own character in the Hallowmarch.';
  const task = { id: 'urn:uuid:' + crypto.randomUUID(), desiredResult, observedResult,
    workContext: goal + '\n' + workContext,
    constraints: value('march-consulting-constraints').split('\n').map(line => line.trim()).filter(Boolean).slice(0, 8) };
  if (task.constraints.some(line => line.length > 300)) throw new Error('Keep each limit to 300 characters or fewer.');
  const ideal = value('march-consulting-ideal'), previous = value('march-consulting-previous'), factor = value('march-consulting-factor');
  let gapEvidence;
  if (ideal) {
    gapEvidence = { couldPerformUnderIdealConditions: ideal === 'yes' };
    if (previous) gapEvidence.performedWellBefore = previous === 'yes';
    if (factor) {
      const evidence = value('march-consulting-factor-evidence');
      if (!evidence) throw new Error('Describe what you observed about that obstacle, or leave the obstacle unspecified.');
      gapEvidence.factorEvidence = { [factor]: { adequate: false, evidence } };
    }
  } else if (factor || previous) throw new Error('Answer whether you can meet the goal under good conditions, or leave all optional diagnosis answers unspecified.');
  return { task, context: marchConsultingObservation(), ...(gapEvidence ? { gapEvidence } : {}) };
}
function marchConsultingStructure(parent, value, depth = 0) {
  if (value === null || value === undefined || depth > 5) return;
  if (typeof value !== 'object') {
    const text = String(value).slice(0, 12000), node = marchConsultingNode('p', text);
    try { const url = new URL(text); if (url.protocol === 'https:' && !url.username && !url.password) {
      const link = marchConsultingNode('a', text); link.href = url.href; link.target = '_blank'; link.rel = 'noopener noreferrer'; node.replaceChildren(link);
    } } catch { /* Ordinary service text. */ }
    parent.appendChild(node); return;
  }
  if (Array.isArray(value)) {
    const list = document.createElement('ol');
    for (const item of value.slice(0, 32)) { const row = document.createElement('li'); marchConsultingStructure(row, item, depth + 1); list.appendChild(row); }
    parent.appendChild(list); return;
  }
  const list = document.createElement('dl');
  for (const [key, item] of Object.entries(value).slice(0, 40)) {
    if (item === null || item === undefined) continue;
    list.appendChild(marchConsultingNode('dt', key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[_-]/g, ' ')));
    const content = document.createElement('dd'); content.style.marginInlineStart = '12px'; marchConsultingStructure(content, item, depth + 1); list.appendChild(content);
  }
  parent.appendChild(list);
}
function marchConsultingCreate(parent) {
  const box = marchConsultingNode('section'); box.id = 'march-consulting';
  box.style.cssText = 'border-top:1px solid #806f4d;padding-top:14px;display:grid;gap:12px;overflow-wrap:anywhere';
  box.appendChild(marchConsultingNode('h3', 'Help me improve'));
  box.appendChild(marchConsultingNode('p', 'Choose something you want to do better. Review your own report and a small snapshot of your play, then ask Foxxi for support. Your plan can be kept privately with your character.'));
  const note = marchConsultingNode('p'); note.id = 'march-consulting-note'; note.setAttribute('role', 'status'); note.setAttribute('aria-live', 'polite'); box.appendChild(note);
  const connect = marchConsultingButton('Open private coaching', () => marchConsultingRun(marchConsultingConnect)); connect.id = 'march-consulting-connect'; box.appendChild(connect);
  const form = marchConsultingNode('form'); form.id = 'march-consulting-form'; form.style.cssText = 'display:grid;gap:12px';
  const field = (id, label, placeholder, multiline = false, limit = 1200) => {
    const wrap = marchConsultingNode('label', label), input = document.createElement(multiline ? 'textarea' : 'input'); input.id = id;
    input.maxLength = limit; input.placeholder = placeholder; input.style.cssText = 'display:block;width:100%;min-height:44px;box-sizing:border-box';
    if (multiline) input.rows = 2; else input.type = 'text';
    input.oninput = marchConsultingInvalidate; wrap.appendChild(input); form.appendChild(wrap); return input;
  };
  field('march-consulting-goal', 'What do you want to do better?', 'For example, survive a fight with a frost wolf.', false, 240);
  field('march-consulting-current', 'What happens now?', 'Describe your current result.', true);
  field('march-consulting-desired', 'What result would count as success?', 'Make the goal specific enough to check afterward.', true);
  field('march-consulting-context', 'What is the situation?', 'Where you get stuck and anything that matters.', true);
  field('march-consulting-constraints', 'Limits to work within (optional)', 'One limit per line, such as ten minutes to practice.', true, 1200);
  const optional = document.createElement('details'); optional.appendChild(marchConsultingNode('summary', 'Help diagnose the obstacle (optional)'));
  const choice = (id, label, choices) => {
    const wrap = marchConsultingNode('label', label), select = document.createElement('select'); select.id = id; select.style.cssText = 'display:block;min-height:44px;max-width:100%';
    for (const [value, text] of choices) { const option = marchConsultingNode('option', text); option.value = value; select.appendChild(option); }
    select.onchange = marchConsultingInvalidate; wrap.appendChild(select); optional.appendChild(wrap);
  };
  choice('march-consulting-ideal', 'Could you meet this goal when the conditions are right?', [['', 'Not sure'], ['yes', 'Yes'], ['no', 'No']]);
  choice('march-consulting-previous', 'Have you done this well before?', [['', 'Not sure'], ['yes', 'Yes'], ['no', 'No']]);
  choice('march-consulting-factor', 'What seems to get in the way?', [['', 'Not sure'], ['information', 'Instructions or information'], ['instrumentation', 'Tools or access'],
    ['incentives', 'Rewards or consequences'], ['knowledgeSkill', 'Knowing how or practice'], ['capacity', 'Capacity or time'], ['motives', 'Motivation']]);
  const why = marchConsultingNode('label', 'What makes you think that?'), input = document.createElement('textarea'); input.id = 'march-consulting-factor-evidence'; input.maxLength = 600;
  input.rows = 2; input.style.cssText = 'display:block;width:100%;box-sizing:border-box'; input.oninput = marchConsultingInvalidate; why.appendChild(input); optional.appendChild(why); form.appendChild(optional);
  const review = marchConsultingButton('Review my request', () => marchConsultingRun(marchConsultingReview)); review.id = 'march-consulting-review'; form.appendChild(review);
  form.onsubmit = event => { event.preventDefault(); void marchConsultingRun(marchConsultingReview); }; box.appendChild(form);
  const preview = marchConsultingNode('section'); preview.id = 'march-consulting-preview'; preview.hidden = true; box.appendChild(preview);
  const actions = marchConsultingNode('div'); actions.style.cssText = 'display:grid;gap:10px';
  for (const [id, text] of [['march-consulting-retain', 'Keep this goal, observations and plan privately in my pod. Allow new records for this goal for up to 15 minutes.'],
    ['march-consulting-share', 'Send this exact reviewed request to Foxxi for a plan. This permission lasts up to 15 minutes.']]) {
    const label = marchConsultingNode('label'), checkbox = document.createElement('input'); checkbox.type = 'checkbox'; checkbox.id = id;
    checkbox.style.cssText = 'width:22px;height:22px;vertical-align:middle;margin-right:8px'; label.append(checkbox, document.createTextNode(text)); actions.appendChild(label);
  }
  const send = marchConsultingButton('Request my plan', () => marchConsultingRun(marchConsultingRequest)); send.id = 'march-consulting-request'; actions.appendChild(send);
  const withdraw = marchConsultingButton('Withdraw permission to share', () => {
    void marchConsultingWithdraw().catch(error => { MARCH_CONSULTING.note = error?.message || 'Withdrawal confirmation is pending. Sharing is stopped in this page.'; marchConsultingRender(); });
  }); withdraw.id = 'march-consulting-withdraw'; actions.appendChild(withdraw);
  const retry = marchConsultingButton('Confirm pending private save', () => marchConsultingRun(marchConsultingRetry)); retry.id = 'march-consulting-retry'; retry.hidden = true; actions.appendChild(retry);
  box.appendChild(actions);
  const result = marchConsultingNode('section'); result.id = 'march-consulting-result'; result.hidden = true; box.appendChild(result);
  const evaluation = marchConsultingNode('section'); evaluation.id = 'march-consulting-evaluation'; evaluation.hidden = true;
  evaluation.appendChild(marchConsultingNode('h4', 'Try the support, then check what changed'));
  evaluation.appendChild(marchConsultingNode('p', 'Describe what you tried and what happened. A comparison is evidence about this attempt, not proof that you mastered a skill.'));
  for (const [id, text] of [['march-consulting-tried', 'What did you try?'], ['march-consulting-after', 'What happened afterward?']]) {
    const label = marchConsultingNode('label', text), area = document.createElement('textarea'); area.id = id; area.maxLength = 900; area.rows = 2;
    area.oninput = () => { MARCH_CONSULTING.evaluation = null; $('march-consulting-save-evaluation').hidden = true; $('march-consulting-comparison').replaceChildren(); };
    area.style.cssText = 'display:block;width:100%;box-sizing:border-box'; label.appendChild(area); evaluation.appendChild(label);
  }
  const evaluate = marchConsultingButton('Review the comparison', () => marchConsultingRun(marchConsultingReviewEvaluation)); evaluate.id = 'march-consulting-review-evaluation'; evaluation.appendChild(evaluate);
  const comparison = marchConsultingNode('div'); comparison.id = 'march-consulting-comparison'; evaluation.appendChild(comparison);
  const retainEvaluation = marchConsultingButton('Keep this comparison privately', () => marchConsultingRun(marchConsultingSaveEvaluation)); retainEvaluation.id = 'march-consulting-save-evaluation'; retainEvaluation.hidden = true; evaluation.appendChild(retainEvaluation);
  box.appendChild(evaluation); parent.appendChild(box); return box;
}
async function marchConsultingRun(action) {
  const state = MARCH_CONSULTING; if (state.busy) return;
  state.busy = true; state.note = ''; marchConsultingRender();
  try { await action(); }
  catch (error) {
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
    state.note = state.consultationId ? 'Your private plan is open. You can review a new request or check what changed after trying this one.' : 'Ready. Add your goal and review exactly what you want to share.';
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
  const journal = privateModule.createOwnerPerformanceConsultation({ binding, credential: cached.credential, relayUrl: matches[0].relayUrl, sessionId });
  try {
    await journal.connect(); current();
    if (!journal.status().keyPresent) throw new Error('Restore your character’s recovery key before keeping private coaching history.');
    const history = await journal.read(); current();
    Object.assign(state, { ownerKey, sessionId, journal, current, openConsultant: () => {
      current(); return liveModule.createFoxxiConsultant({ binding, credential: cached.credential, relayUrl: matches[0].relayUrl, journal, sessionId, subjectKind: 'human' });
    } });
    const last = history.consultations?.at(-1), baseline = history.observations?.find(item => item.id === last?.observationId);
    if (last && baseline) Object.assign(state, { result: last.response, observationId: baseline.id, consultationId: last.id, baseline });
    state.note = last ? 'Your private plan is open.' : 'Your private coaching history is open.'; marchConsultingRender();
  } catch (error) { if (state.journal === journal) marchConsultingClose(); else journal.close(); throw error; }
}
async function marchConsultingReview() {
  await marchConsultingConnect(); const state = MARCH_CONSULTING; state.current();
  const input = marchConsultingTask(), prepared = state.consultant.preparePlan(input);
  state.reviewed = { input, prepared, at: Date.now(), progress: {} };
  for (const id of ['march-consulting-retain', 'march-consulting-share']) $(id).checked = false;
  state.note = 'Review this request. Nothing has been saved or sent for this new goal.';
}
async function marchConsultingConsent(purpose, recipient, taskId) {
  const state = MARCH_CONSULTING; state.current();
  try { await state.journal.authorize({ purpose, recipient, taskId }); }
  catch (error) {
    if (!['consultation_consent_required', 'consulting_consent_required'].includes(error?.code)) throw error;
    await state.journal.grantConsent({ accepted: true, purpose, recipient, taskId, lifetimeMs: 900000 });
  }
  state.current();
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
async function marchConsultingRequest() {
  const state = MARCH_CONSULTING, review = state.reviewed;
  if (!review || !state.consultant) throw new Error('Review your exact request first.');
  state.current();
  if (!review.progress.requestAttempted && Date.now() - review.at > 120000) throw new Error('This observation is more than two minutes old. Review a fresh request before sharing it.');
  if (!$('march-consulting-retain').checked || !$('march-consulting-share').checked) throw new Error('Choose both private retention and sharing this exact request before requesting a plan.');
  const continuing = () => {
    state.current();
    if (state.reviewed !== review || review.cancelled || !$('march-consulting-share').checked) throw new Error('Sharing permission was withdrawn. This request will not continue.');
  };
  continuing();
  const taskId = review.input.task.id, podUrl = state.journal.status().podUrl;
  state.note = 'Confirming your choices in your private pod…'; marchConsultingRender();
  await marchConsultingConsent('retain-observations', podUrl, taskId);
  continuing();
  await marchConsultingConsent('request-consultation', review.prepared.recipient, taskId);
  continuing();
  const observation = await marchConsultingRecordedObservation(review.input, review.progress);
  continuing();
  if (!review.progress.response) {
    if (review.progress.requestAttempted) throw new Error('Foxxi’s reply to this request is unconfirmed. This page has not sent the request again. Review a new request if you want to ask again.');
    review.progress.requestAttempted = true;
    state.note = 'Asking Foxxi for a plan from your reviewed report and observations…'; marchConsultingRender();
    review.progress.response = await state.consultant.requestPlan(review.prepared); state.current();
  }
  state.result = review.progress.response; state.baseline = observation; state.observationId = observation.id;
  state.note = 'Foxxi returned a plan. Confirming its private record in your pod…'; marchConsultingRender();
  let stored;
  if (review.progress.consultationAttempted) {
    const history = await state.journal.read(); state.current();
    stored = history.consultations.find(item => item.observationId === observation.id && marchConsultingCanonical(item.response) === marchConsultingCanonical(review.progress.response));
    if (!stored) throw new Error('The returned plan is visible here, but its private record is not confirmed. Confirm the pending private save before continuing.');
  } else {
    review.progress.consultationAttempted = true;
    let saved;
    try { saved = await state.journal.appendConsultation({ observationId: observation.id, service: state.result.service, response: state.result }); }
    catch (error) { marchConsultingKnownRefusal(review.progress, 'consultationAttempted', error); throw error; }
    state.current();
    if (!saved.saved || !saved.consultation?.id) throw new Error('Your pod did not confirm the returned plan’s private record.');
    stored = saved.consultation;
  }
  state.consultationId = stored.id; state.reviewed = null;
  for (const id of ['march-consulting-retain', 'march-consulting-share']) $(id).checked = false;
  state.note = 'Your plan is confirmed privately in your pod. Try the suggested support, then review what changed.';
}
async function marchConsultingWithdraw() {
  const state = MARCH_CONSULTING;
  if (!state.journal || !state.consultant) throw new Error('Open your private coaching connection first.');
  state.current();
  const taskId = state.reviewed?.input.task.id || state.baseline?.task.id;
  if (!taskId) throw new Error('No coaching goal has permission to share in this session.');
  $('march-consulting-share').checked = false;
  if (state.reviewed) state.reviewed.cancelled = true;
  await state.journal.revokeConsent({ purpose: 'request-consultation', recipient: state.consultant.status().recipient, taskId }); state.current();
  state.note = 'Sharing permission withdrawn for this goal. Your private history is still available.';
}
async function marchConsultingRetry() {
  const state = MARCH_CONSULTING; state.current?.();
  if (!state.journal) throw new Error('Open private coaching first.');
  const result = await state.journal.retry(); state.current();
  if (!result.saved) throw new Error('The same private save is still awaiting confirmation.');
  state.note = 'The pending private save is confirmed. Continue the reviewed request when you are ready.';
}
async function marchConsultingReviewEvaluation() {
  const state = MARCH_CONSULTING;
  if (!state.journal || !state.consultationId || !state.baseline) throw new Error('Open a plan confirmed in your private history first.');
  state.current();
  const tried = $('march-consulting-tried').value.trim(), observedResult = $('march-consulting-after').value.trim();
  if (!tried || !observedResult) throw new Error('Describe what you tried and what happened afterward.');
  const context = marchConsultingObservation(), before = state.baseline.evidence.at(-1)?.metrics || {};
  const comparison = Object.fromEntries(Object.entries(context.metrics).filter(([key]) => Number.isFinite(before[key])).map(([key, after]) => [key,
    { before: before[key], after, change: after - before[key] }]));
  state.evaluation = { input: { task: { ...state.baseline.task, observedResult }, context }, playerReport: 'Tried: ' + tried + '\nObserved: ' + observedResult,
    comparison, at: Date.now(), progress: {} };
  state.note = 'Review this comparison. It stays in this page until you choose to keep it privately. It is not sent to Foxxi.';
}
async function marchConsultingSaveEvaluation() {
  const state = MARCH_CONSULTING, evaluation = state.evaluation;
  if (!evaluation || !state.journal) throw new Error('Review the comparison first.');
  state.current();
  if (!evaluation.progress.evaluationAttempted && Date.now() - evaluation.at > 120000) throw new Error('Review a fresh comparison before keeping it.');
  await marchConsultingConsent('retain-observations', state.journal.status().podUrl, evaluation.input.task.id);
  const observation = await marchConsultingRecordedObservation(evaluation.input, evaluation.progress);
  let saved;
  if (evaluation.progress.evaluationAttempted) {
    const history = await state.journal.read(); state.current();
    saved = history.evaluations.find(item => item.consultationId === state.consultationId && item.observationId === observation.id && item.playerReport === evaluation.playerReport);
    if (!saved) throw new Error('This exact private comparison is not confirmed. Confirm the pending private save before continuing.');
  } else {
    evaluation.progress.evaluationAttempted = true;
    let result;
    try { result = await state.journal.appendEvaluation({ consultationId: state.consultationId, observationId: observation.id, playerReport: evaluation.playerReport }); }
    catch (error) { marchConsultingKnownRefusal(evaluation.progress, 'evaluationAttempted', error); throw error; }
    state.current();
    if (!result.saved || !result.evaluation?.id) throw new Error('Your pod did not confirm this private comparison.'); saved = result.evaluation;
  }
  evaluation.saved = saved;
  state.note = 'Your before-and-after comparison is confirmed privately. It records this attempt without claiming a cause or mastery.';
}
function marchConsultingKnownRefusal(progress, stage, error) {
  if (!MARCH_CONSULTING.journal?.status().pending && ['consultation_consent_required', 'task_scope_changed', 'consultation_capacity',
    'key_required', 'invalid_consultation', 'invalid_evaluation', 'unknown_observation', 'conflict'].includes(error?.code)) progress[stage] = false;
}
function marchConsultingRender() {
  const parent = $('netsheet')?.querySelector('.sheet');
  if (!parent || !GAME.started || !GAME.player || MARCH_CONSULTING.rendering) return;
  const state = MARCH_CONSULTING; state.rendering = true;
  try {
    const box = $('march-consulting') || marchConsultingCreate(parent), connected = !!state.journal && !!state.consultant;
    $('march-consulting-note').textContent = state.note || (connected ? 'Your coaching history belongs to you. Review a request before sharing it.' : 'Open private coaching to confirm your identity, history and the live support service.');
    $('march-consulting-connect').hidden = connected;
    $('march-consulting-connect').textContent = state.journal ? 'Retry Foxxi connection' : 'Open private coaching';
    $('march-consulting-form').hidden = !connected;
    for (const control of box.querySelectorAll('button,input,textarea,select')) if (control.id !== 'march-consulting-withdraw') control.disabled = state.busy;
    $('march-consulting-withdraw').disabled = !connected || !state.reviewed && !state.baseline;
    $('march-consulting-request').disabled = state.busy || !connected || !state.reviewed || !!state.reviewed.cancelled;
    $('march-consulting-retain').disabled = state.busy || !state.reviewed;
    $('march-consulting-share').disabled = state.busy || !state.reviewed;
    $('march-consulting-retry').hidden = !state.journal?.status().pending;
    const preview = $('march-consulting-preview'); preview.hidden = !state.reviewed;
    const previewKey = state.reviewed?.input.task.id || '';
    if (preview.dataset.requestKey !== previewKey) {
      preview.dataset.requestKey = previewKey; preview.replaceChildren();
      if (state.reviewed) {
        preview.appendChild(marchConsultingNode('h4', 'Your reviewed request'));
        preview.appendChild(marchConsultingNode('p', 'Your report and the following owner-page observations will be shared. These observations do not verify combat results or identify other players.'));
        const task = state.reviewed.input.task;
        marchConsultingStructure(preview, { 'Goal and situation': task.workContext, 'Current result': task.observedResult,
          'Desired result': task.desiredResult, ...(task.constraints.length ? { Limits: task.constraints } : {}) });
        const metrics = document.createElement('dl');
        for (const [key, value] of Object.entries(state.reviewed.input.context.metrics)) {
          metrics.append(marchConsultingNode('dt', marchConsultingMetricLabels[key]), marchConsultingNode('dd', value));
        }
        preview.appendChild(metrics);
        const recipient = marchConsultingNode('p', 'Recipient: '), link = marchConsultingNode('a', state.reviewed.prepared.recipient);
        link.href = state.reviewed.prepared.recipient; link.target = '_blank'; link.rel = 'noopener noreferrer'; recipient.appendChild(link); preview.appendChild(recipient);
        const exact = document.createElement('details'); exact.appendChild(marchConsultingNode('summary', 'Review the exact information to share'));
        const body = marchConsultingNode('pre', JSON.stringify(state.reviewed.prepared.payload, null, 2)); body.style.cssText = 'white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px'; exact.appendChild(body); preview.appendChild(exact);
      }
    }
    const result = $('march-consulting-result'); result.hidden = !state.result;
    const resultKey = state.result ? JSON.stringify(state.result) : '';
    if (result.dataset.resultKey !== resultKey) {
      result.dataset.resultKey = resultKey; result.replaceChildren();
      if (state.result) {
        const response = state.result.response;
        result.appendChild(marchConsultingNode('h4', 'Foxxi’s returned plan'));
        result.appendChild(marchConsultingNode('p', 'This plan responds to your report and observations. Its effect has not been established.'));
        if (response) {
          for (const [label, value] of [['Diagnosis', response.diagnosis], ['Suggested support and rationale', response.plan], ['Guidance', response.scaffold]]) {
            if (!value) continue; result.appendChild(marchConsultingNode('h5', label)); marchConsultingStructure(result, value);
          }
        }
        let sourceUrl; try { const url = new URL(state.result.source?.descriptorUrl); if (url.protocol === 'https:' && !url.username && !url.password) sourceUrl = url.href; } catch { /* Untrusted stored URLs never become links. */ }
        if (sourceUrl) {
          const link = marchConsultingNode('a', 'Source: live Foxxi support service'); link.href = state.result.source.descriptorUrl;
          link.target = '_blank'; link.rel = 'noopener noreferrer'; result.appendChild(link);
        }
      }
    }
    $('march-consulting-evaluation').hidden = !state.consultationId;
    const comparison = $('march-consulting-comparison'), evaluationKey = state.evaluation ? JSON.stringify([state.evaluation.comparison, state.evaluation.playerReport, !!state.evaluation.saved]) : '';
    if (comparison.dataset.evaluationKey !== evaluationKey) {
      comparison.dataset.evaluationKey = evaluationKey; comparison.replaceChildren();
      if (state.evaluation) {
        comparison.appendChild(marchConsultingNode('p', state.evaluation.playerReport));
        const table = document.createElement('table'), head = document.createElement('tr');
        for (const label of ['Owner-page observation', 'Before', 'After', 'Change']) head.appendChild(marchConsultingNode('th', label)); table.appendChild(head);
        for (const [key, value] of Object.entries(state.evaluation.comparison)) {
          const row = document.createElement('tr');
          for (const cell of [marchConsultingMetricLabels[key] || key, value.before, value.after, value.change]) row.appendChild(marchConsultingNode('td', cell)); table.appendChild(row);
        }
        comparison.appendChild(table);
        comparison.appendChild(marchConsultingNode('p', state.evaluation.saved ? 'This comparison is confirmed privately in your pod.' : 'Keeping this comparison renews permission to record only this goal in your own pod for up to 15 minutes.'));
      }
    }
    $('march-consulting-save-evaluation').hidden = !state.evaluation || !!state.evaluation.saved;
  } finally { state.rendering = false; }
}
function marchConsultingStep() {
  const state = MARCH_CONSULTING, key = marchConsultingOwnerKey();
  if (state.ownerKey && state.ownerKey !== key) {
    marchConsultingClose(); $('march-consulting')?.remove(); state.note = 'Your identity connection changed. Open your own private coaching history again.';
  }
  state.ownerKey = key;
  // Personal support remains reachable when a player is alone in the March.
  if ($('btn-net') && GAME.started) $('btn-net').hidden = false;
  if (NETUI.open && Date.now() - (state.lastRender || 0) >= 250) { state.lastRender = Date.now(); marchConsultingRender(); }
}
if (window.__hm) window.__hm.consulting = { observation: marchConsultingObservation, render: marchConsultingRender,
  get status() { const state = MARCH_CONSULTING; return { connected: !!state.journal && !!state.consultant,
    privateHistoryOpen: !!state.journal, busy: state.busy, reviewed: !!state.reviewed, hasPlan: !!state.result, hasPrivatePlan: !!state.consultationId, hasEvaluation: !!state.evaluation?.saved }; } };
