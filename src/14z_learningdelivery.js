/* Optional owner-only activity delivery is separate from coaching. Only new
 * observed events are eligible; an uncertain batch is never sent on reload. */
const MARCH_LEARNING = { stored: null, blocked: false, delivery: null, scope: null, epoch: 0,
  enabledUntil: 0, busy: false, note: '', lastBatchAt: 0, consent: null, buffer: [], startAfterOrdinal: 0 };
const marchLearningCopy = value => JSON.parse(JSON.stringify(value));
registerSavePart('char', 'learningDelivery', { save: () => marchLearningCopy(MARCH_LEARNING.stored), load(value) {
  marchLearningClose(); MARCH_LEARNING.stored = null; MARCH_LEARNING.blocked = false; MARCH_LEARNING.note = '';
  if (value === null || value === undefined) return;
  try {
    const body = JSON.stringify(value);
    if (!value || typeof value !== 'object' || Array.isArray(value) || body.length > 131072) throw new Error();
    MARCH_LEARNING.stored = JSON.parse(body);
  } catch { MARCH_LEARNING.blocked = true; MARCH_LEARNING.note = 'A previous activity record could not be read. It has not been sent again.'; }
}, key: value => value });
function marchLearningClose() {
  const state = MARCH_LEARNING;
  state.epoch++; state.enabledUntil = 0; state.delivery?.close(); state.delivery = null; state.scope = null; state.consent = null; state.buffer = [];
}
function marchLearningObserve(result) {
  const state = MARCH_LEARNING; if (!state.enabledUntil || !result?.recorded) return;
  try { marchLearningCurrent(state.scope, state.epoch, { sharing: true }); }
  catch { marchLearningClose(); state.note = 'Activity recording stopped because the active player connection changed.'; return; }
  if (!result.event || state.buffer.length >= 128) {
    marchLearningClose(); state.note = 'Activity recording paused because detailed observations could not keep up. Your private journal keeps its available history. Start a new session to record future activity.'; return;
  }
  if (result.event.ordinal > state.startAfterOrdinal) state.buffer.push(marchLearningCopy(result.event));
}
function marchLearningScope() {
  const scope = activityScope();
  if (!scope?.native || !SAVE.native || !NATIVE_PLAYER.status?.bound || !NATIVE_PLAYER.status?.verified) return null;
  return scope;
}
function marchLearningCurrent(scope, epoch, { sharing = false } = {}) {
  if (!scope || !activityCurrent(scope) || !SAVE.native || !NATIVE_PLAYER.status?.verified || !NATIVE_PLAYER.status?.bound
    || !MARCH_CONSULTING.current || MARCH_LEARNING.epoch !== epoch) throw new Error('Your player connection changed. Activity recording is stopped.');
  MARCH_CONSULTING.current();
  if (document.hidden) throw new Error('Activity recording is paused while the game is hidden.');
  if (MARCH_LEARNING.enabledUntil && MARCH_LEARNING.enabledUntil <= Date.now()) throw new Error('The activity recording session has ended.');
  if (sharing && MARCH_LEARNING.enabledUntil <= Date.now()) throw new Error('Activity recording is off. Your journal and coach remain available.');
}
async function marchLearningCommit(next, scope, epoch) {
  marchLearningCurrent(scope, epoch);
  const previous = MARCH_LEARNING.stored, exact = marchLearningCopy(next); let confirmed = false;
  MARCH_LEARNING.stored = exact;
  try {
    await saveNow();
    let persisted;
    try { persisted = JSON.parse(SAVE.lastBody)?.char?.x?.learningDelivery; } catch { /* closed below */ }
    confirmed = !SAVE.pending && !SAVE.nativeFlight && marchConsultingCanonical(persisted) === marchConsultingCanonical(exact);
    if (!confirmed) throw new Error('Your private activity delivery record is awaiting its character save. No new batch will be sent.');
    marchLearningCurrent(scope, epoch); return { saved: true };
  } catch (error) {
    // Until an acknowledgment save is confirmed, retain the already-confirmed
    // pre-send marker. A first-stage intent is also retained if its save failed.
    if (!confirmed && previous?.pending && MARCH_LEARNING.stored === exact) MARCH_LEARNING.stored = previous;
    throw error;
  }
}
async function marchLearningOpen() {
  const state = MARCH_LEARNING;
  if (state.blocked) throw new Error('The previous activity delivery record is unreadable. It has not been sent again.');
  if (document.hidden) throw new Error('Return to the game before opening activity recording.');
  const profile = activityEnsure(), scope = marchLearningScope();
  if (!profile || !scope || !GAME_ACTIVITY.sessionId) throw new Error('Connect your identity and enter your private character first.');
  if (state.delivery && state.enabledUntil && state.enabledUntil <= Date.now()) { state.delivery.close(); state.delivery = null; state.enabledUntil = 0; }
  if (state.delivery) { marchLearningCurrent(state.scope, state.epoch); return state.delivery; }
  if (!MARCH_CONSULTING.journal || !MARCH_CONSULTING.openLearning) await marchConsultingOpenHistory();
  if (!activityCurrent(scope) || document.hidden) throw new Error('The player connection changed before activity recording opened.');
  const epoch = ++state.epoch; state.scope = scope;
  const delivery = await MARCH_CONSULTING.openLearning({ gameplaySessionId: GAME_ACTIVITY.sessionId,
    characterId: scope.characterId, startAfterOrdinal: profile.save().eventCount, state: marchLearningCopy(state.stored),
    commitState: next => marchLearningCommit(next, scope, epoch),
    assertCurrent: () => marchLearningCurrent(scope, epoch) });
  try { marchLearningCurrent(scope, epoch); await delivery.connect(); marchLearningCurrent(scope, epoch); state.delivery = delivery; return delivery; }
  catch (error) { delivery.close(); throw error; }
}
async function marchLearningAuthorize(delivery) {
  const status = delivery.status(), state = MARCH_LEARNING;
  const consent = { purpose: status.purpose, recipient: status.recipient, taskId: status.taskId };
  if (!consent.recipient || !consent.taskId || consent.purpose !== 'record-gameplay-activity') throw new Error('Your own learning-record destination is unavailable.');
  marchLearningCurrent(state.scope, state.epoch);
  await MARCH_CONSULTING.journal.grantConsent({ accepted: true, ...consent, lifetimeMs: 900000 });
  marchLearningCurrent(state.scope, state.epoch); state.consent = consent;
}
async function marchLearningEnable() {
  const state = MARCH_LEARNING;
  // Each explicit activation starts after the current event count, including
  // when an earlier session expired. Existing history is never bulk-exported.
  if (state.delivery && !state.delivery.status().pending) { state.delivery.close(); state.delivery = null; }
  const delivery = await marchLearningOpen();
  if (delivery.status().pending) throw new Error('An earlier activity record is unconfirmed. Check that record before starting another session. It will not be sent again automatically.');
  await marchLearningAuthorize(delivery);
  state.startAfterOrdinal = activityEnsure().save().eventCount; state.buffer = [];
  state.enabledUntil = Date.now() + 900000; state.lastBatchAt = Date.now();
  state.note = 'Recording new activity to your own learning record for 15 minutes. Earlier history stays private with your character.';
}
async function marchLearningStop() {
  const state = MARCH_LEARNING, consent = state.consent, journal = MARCH_CONSULTING.journal;
  state.enabledUntil = 0; state.epoch++; state.delivery?.close(); state.delivery = null; state.scope = null; state.consent = null; state.buffer = [];
  state.note = 'Activity recording stopped. Your private journal and coach continue.';
  if (consent && journal && !document.hidden) { MARCH_CONSULTING.current?.(); await journal.revokeConsent(consent); MARCH_CONSULTING.current?.(); }
}
async function marchLearningReconcile() {
  const delivery = await marchLearningOpen();
  await marchLearningAuthorize(delivery);
  const result = await delivery.reconcile();
  MARCH_LEARNING.note = delivery.status().pending
    ? 'That record is still unconfirmed. No activity has been sent again. You can keep playing and using your coach.'
    : 'The previous activity record is confirmed. Recording stays off until you start another session.';
  return result;
}
async function marchLearningCloseUnconfirmed() {
  const delivery = await marchLearningOpen();
  await delivery.closePending();
  MARCH_LEARNING.enabledUntil = 0; MARCH_LEARNING.buffer = [];
  MARCH_LEARNING.note = 'The unconfirmed activity record was closed without resending. Its arrival remains unknown. Start a new session to record future activity.';
}
async function marchLearningRun(action) {
  const state = MARCH_LEARNING; if (state.busy) return;
  state.busy = true; state.note = ''; marchLearningRender();
  try { await action(); }
  catch (error) { if (state.delivery?.status().pending || state.stored?.pending) state.enabledUntil = 0;
    state.note = error?.message || 'The activity record could not be confirmed. It has not been sent again.'; }
  finally { state.busy = false; marchLearningRender(); }
}
async function marchLearningFlush() {
  const state = MARCH_LEARNING;
  if (state.busy || !state.delivery || !state.enabledUntil || document.hidden) return;
  if (state.enabledUntil <= Date.now()) { await marchLearningRun(marchLearningStop); return; }
  if (Date.now() - state.lastBatchAt < 30000) return;
  state.lastBatchAt = Date.now();
  await marchLearningRun(async () => {
    const scope = state.scope, epoch = state.epoch, delivery = state.delivery;
    // Up to sixty observations per heartbeat keeps ordinary active play moving
    // without an unbounded drain. Each batch has its own confirmed private intent.
    for (let batch = 0; batch < 3; batch++) {
      marchLearningCurrent(scope, epoch, { sharing: true });
      if (delivery.status().pending) { state.enabledUntil = 0; state.note = 'An activity record is unconfirmed. Recording is paused; nothing will be sent again automatically.'; return; }
      const prepared = delivery.prepare(state.buffer);
      if (!prepared) return;
      marchLearningCurrent(scope, epoch, { sharing: true });
      await delivery.deliver(prepared); marchLearningCurrent(scope, epoch, { sharing: true });
      if (!delivery.status().pending) {
        const confirmedIds = new Set(prepared.events.map(event => event.id));
        state.buffer = state.buffer.filter(event => !confirmedIds.has(event.id));
      }
      state.note = delivery.status().pending ? 'The latest activity record is awaiting confirmation. It will not be sent again automatically.' : 'Observed activity is saved to your own performance profile.';
      if (delivery.status().pending) { state.enabledUntil = 0; return; }
    }
  });
}
function marchLearningMount(parent) {
  const box = marchConsultingNode('section'); box.id = 'march-learning-record';
  box.style.cssText = 'display:grid;gap:10px;min-width:0;border:1px solid #806f4d;border-radius:10px;padding:14px';
  box.append(marchConsultingNode('h3', 'Private learning record'), marchConsultingNode('p',
    'Optionally add new gameplay activity to your own learning record. Your ordinary progress already saves with your character.'));
  const status = marchConsultingNode('p'); status.id = 'march-learning-status'; status.setAttribute('role', 'status'); box.append(status);
  const enable = marchConsultingButton('Record new activity · 15 minutes', () => { void marchLearningRun(marchLearningEnable); }); enable.id = 'march-learning-enable';
  const stop = marchConsultingButton('Stop activity recording', () => { void marchLearningStop().catch(error => {
    MARCH_LEARNING.note = error?.message || 'Activity recording is stopped. Consent withdrawal could not be confirmed.';
  }).finally(marchLearningRender); marchLearningRender(); }); stop.id = 'march-learning-stop';
  box.append(enable, stop);
  const privacy = marchConsultingNode('details'); privacy.append(marchConsultingNode('summary', 'Recording privacy'));
  privacy.append(marchConsultingNode('p', 'Records new observations for 15 minutes in your own pod using xAPI, without an LLM. Totals remain in your performance profile; recent details are kept for up to one hour. Observed actions are not skill scores. Chat, inventory contents and other players’ private records are excluded.'),
    marchConsultingNode('small', 'Recording stops when this page is hidden or your player connection changes. You can stop recording at any time.'));
  box.append(privacy);
  const recovery = marchConsultingNode('section'); recovery.id = 'march-learning-recovery'; recovery.hidden = true;
  recovery.append(marchConsultingNode('h4', 'Recording needs attention'),
    marchConsultingNode('small', 'Checking an unconfirmed record looks up its existing IDs; it does not send it again.'));
  const check = marchConsultingButton('Check unconfirmed activity record', () => { void marchLearningRun(marchLearningReconcile); }); check.id = 'march-learning-check';
  const close = marchConsultingButton('Close unconfirmed record without resending', () => { void marchLearningRun(marchLearningCloseUnconfirmed); }); close.id = 'march-learning-close';
  recovery.append(check, close); box.append(recovery);
  parent.append(box);
}
function marchLearningRender() {
  const state = MARCH_LEARNING, node = $('march-learning-status'); if (!node) return;
  const live = state.enabledUntil > Date.now(), status = state.delivery?.status(), pending = status?.pending || !!state.stored?.pending;
  node.textContent = state.note || (pending ? 'An earlier record is unconfirmed. It has not been sent again.' : live ? 'On · recording new activity for this 15-minute session.' : 'Off · your ordinary progress still saves.');
  const confirmed = status?.acknowledgedCount ?? state.stored?.acknowledgedCount;
  if (Number.isSafeInteger(confirmed) && confirmed > 0) node.textContent += ' ' + confirmed + ' observed actions confirmed in your performance profile.';
  $('march-learning-enable').hidden = live;
  $('march-learning-enable').disabled = state.busy || state.blocked || !!pending || !marchConsultingSetupReady();
  $('march-learning-stop').hidden = !live && !state.busy;
  $('march-learning-stop').disabled = false;
  $('march-learning-recovery').hidden = !pending && !state.blocked;
  $('march-learning-check').hidden = !pending;
  $('march-learning-check').disabled = state.busy || state.blocked;
  $('march-learning-close').hidden = !pending;
  $('march-learning-close').disabled = state.busy || state.blocked;
}
setInterval(() => { void marchLearningFlush(); }, 30000);
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { const active = MARCH_LEARNING.enabledUntil > 0; marchLearningClose(); if (active) MARCH_LEARNING.note = 'Activity recording stopped while the game was hidden. Start a new session when you return.'; }
});
window.addEventListener('pagehide', marchLearningClose);
window.__hm.learningDelivery = Object.freeze({ enable: () => marchLearningRun(marchLearningEnable), stop: marchLearningStop,
  reconcile: () => marchLearningRun(marchLearningReconcile), closeUnconfirmed: () => marchLearningRun(marchLearningCloseUnconfirmed), flush: marchLearningFlush,
  get status() { const state = MARCH_LEARNING, delivery = state.delivery?.status(); return { enabled: state.enabledUntil > Date.now(), busy: state.busy, blocked: state.blocked,
    pending: !!(delivery?.pending || state.stored?.pending), acknowledgedCount: delivery?.acknowledgedCount ?? state.stored?.acknowledgedCount ?? 0,
    pendingCount: delivery?.pendingCount ?? state.stored?.pending?.events?.length ?? 0, note: state.note }; } });
