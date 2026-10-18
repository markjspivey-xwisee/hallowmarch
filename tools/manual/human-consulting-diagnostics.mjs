/** Fixed manual diagnostics for the retained coaching page. No import-time I/O,
 * arbitrary evaluation, private content, credentials or identity creation. */
const categories = new Set(['pending_private_save', 'reply_private_save_unconfirmed', 'private_plan_confirmed', 'reviewing',
  'sharing_stopped', 'session_expired', 'response_contract_refused', 'response_content_refused', 'response_too_large',
  'coaching_unconfirmed', 'coaching_refused', 'coaching_service_refused', 'response_unreadable', 'response_record_refused',
  'identity_changed', 'consent_required', 'other', 'empty']);
export function safeHumanConsultingDiagnostic(value) {
  const result = { kind: 'human_consulting_diagnostic' };
  for (const key of ['ownerPinned', 'ownerVerified', 'connected', 'busy', 'enabled', 'reviewed', 'hasPlan', 'hasPrivatePlan',
    'hasEvaluation', 'tracePresent', 'memoPresent', 'ambiguous', 'intentConfirmed', 'intentPresent', 'intentMatchesMemo',
    'retryPresent', 'retryAvailable', 'continuePresent', 'continueAvailable', 'recoveryPortPresent']) result[key] = value?.[key] === true;
  for (const key of ['memoCount', 'deliveries', 'coachingCalls']) result[key] = Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 4096 ? value[key] : null;
  result.noteCategory = categories.has(value?.noteCategory) ? value.noteCategory : 'other';
  return result;
}

export function createHumanConsultingDiagnostics({ getPage, getOwner, gameOrigin, timeoutMs = 2000 } = {}) {
  if (typeof getPage !== 'function' || typeof getOwner !== 'function' || !Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 18000) throw new TypeError('Explicit retained coaching diagnostic ports are required.');
  let flight = null;
  return Object.freeze({ async diagnose() {
    if (flight) return { kind: 'human_consulting_diagnostic', inFlight: true, timedOut: true };
    const page = getPage(), owner = getOwner();
    if (!page || page.isClosed() || !owner) return { kind: 'human_consulting_diagnostic', unavailable: true };
    const task = Promise.resolve().then(() => page.evaluate(readHumanConsultingDiagnostic, { owner, gameOrigin })).then(
      safeHumanConsultingDiagnostic, () => ({ kind: 'human_consulting_diagnostic', unavailable: true }));
    flight = task; task.then(() => { if (flight === task) flight = null; });
    let timer;
    try { return await Promise.race([task, new Promise(resolve => { timer = setTimeout(() => resolve({ kind: 'human_consulting_diagnostic', inFlight: true, timedOut: true }), timeoutMs); })]); }
    finally { clearTimeout(timer); }
  }, async recover() {
    const page = getPage(), owner = getOwner();
    if (!page || page.isClosed() || !owner) throw Object.assign(Error('Retained coaching recovery is unavailable.'), { code: 'qa_human_recovery_refused' });
    const result = await page.evaluate(recoverHumanConsultingPendingSave, { owner, gameOrigin });
    if (result?.sameRequest !== true || result?.noDelivery !== true) throw Object.assign(Error('Retained coaching recovery is unconfirmed.'), { code: 'qa_human_recovery_refused' });
    return { kind: 'human_consulting_recovery', sameRequest: true, noDelivery: true,
      confirmationClicked: result.confirmationClicked === true, continuationClicked: result.continuationClicked === true,
      privatePlanConfirmed: result.privatePlanConfirmed === true };
  } });
}

export async function readHumanConsultingDiagnostic({ owner, gameOrigin }) {
  const game = window.__hm, transport = game?.net?.NETWS, pinned = window.__hmNativeHumanConsultingOwner;
  const trace = window.__hmNativeHumanConsultingTrace, state = game?.consulting?.status;
  const control = id => { const value = document.getElementById(id); return { present: !!value,
    available: !!value && !value.disabled && !value.hidden }; };
  const note = document.getElementById('march-consulting-note')?.textContent || '';
  const notes = [
    ['pending_private_save', 'Your private save is awaiting confirmation.'],
    ['reply_private_save_unconfirmed', 'Your coach replied. Its private save is not confirmed yet'],
    ['private_plan_confirmed', 'Your coach plan is saved privately.'],
    ['reviewing', 'Your coach is reviewing what happened'],
    ['sharing_stopped', 'Live sharing stopped.'],
    ['session_expired', 'Your live coaching session ended.'],
    ['response_contract_refused', 'Foxxi returned a plan for an unverified performer or situation.'],
    ['response_content_refused', 'The returned coaching plan contains unsupported'],
    ['response_too_large', 'The returned coaching plan is too large'],
    ['response_record_refused', 'The returned coaching plan'],
    ['response_unreadable', 'Foxxi returned an unreadable consultation.'],
    ['coaching_unconfirmed', 'Interego did not confirm the coaching request.'],
    ['coaching_refused', 'Foxxi did not confirm a consultation.'],
    ['coaching_service_refused', 'The coaching service refused this operation.'],
    ['identity_changed', 'Your identity connection changed.'],
    ['consent_required', 'Current performer consent for this exact recipient and purpose is required.'],
  ];
  const count = value => Number.isSafeInteger(value) && value >= 0 && value <= 4096 ? value : null;
  const localOwner = () => !!owner?.accountId && !!owner.subjectDid && !!owner.podUrl && !!pinned?.binding
    && location.origin === gameOrigin && pinned.gameOrigin === gameOrigin && pinned.game === game
    && pinned.transport === transport && pinned.player === game?.GAME?.player && !!game?.GAME?.started
    && !!game.GAME.player?.alive && game.SAVE?.native === true && game.SAVE.readConfirmed === true
    && pinned.accountId === owner.accountId && pinned.subjectDid === owner.subjectDid && pinned.podUrl === owner.podUrl
    && transport?.acct?.id === owner.accountId && transport.acct.nativeBound === true
    && !!pinned.token && transport.token === pinned.token && transport.generation === pinned.generation && !transport.reload
    && localStorage.getItem('hallowmarch.token.' + location.host) === pinned.token;
  const ownerPinned = localOwner(); let ownerVerified = false;
  if (ownerPinned) {
    try {
      const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error',
        signal: AbortSignal.timeout(18000), headers: { Authorization: 'Bearer ' + pinned.token } });
      const actual = response.ok ? await response.json() : null;
      ownerVerified = localOwner() && window.__hmNativeHumanConsultingTrace === trace
        && actual?.verified === true && actual.bound === true && actual.account?.id === owner.accountId
        && actual.binding?.subjectDid === owner.subjectDid && actual.binding.podUrl === owner.podUrl
        && actual.binding.authenticatedAgentDid === pinned.binding.authenticatedAgentDid;
    } catch { /* Only the fixed verification boolean leaves the page. */ }
  }
  const retry = control('march-consulting-retry'), resume = control('march-coach-continue');
  let intentPresent = false, intentMatchesMemo = false;
  try {
    const intent = JSON.parse(game?.SAVE?.lastBody || 'null')?.char?.x?.coachDelivery?.pending;
    intentPresent = !!intent; intentMatchesMemo = !!intent && intent.stage === 'intent' && intent.id === trace?.memo?.payload?.situation?.id;
  } catch { /* No private save text leaves the page. */ }
  return { kind: 'human_consulting_diagnostic', ownerPinned, ownerVerified,
    connected: state?.connected === true, busy: state?.busy === true, enabled: state?.enabled === true,
    reviewed: state?.reviewed === true, hasPlan: state?.hasPlan === true, hasPrivatePlan: state?.hasPrivatePlan === true,
    hasEvaluation: state?.hasEvaluation === true, tracePresent: !!trace, memoPresent: !!trace?.memo,
    memoCount: count(trace?.memos?.length), deliveries: count(trace?.deliveries), coachingCalls: count(trace?.coachingCalls),
    ambiguous: trace?.ambiguous === true, intentConfirmed: trace?.intentConfirmed === true, intentPresent, intentMatchesMemo,
    retryPresent: retry.present, retryAvailable: retry.available, continuePresent: resume.present, continueAvailable: resume.available,
    recoveryPortPresent: typeof game?.consulting?.recoverPendingSave === 'function',
    noteCategory: notes.find(([, text]) => note.startsWith(text))?.[0] || (note ? 'other' : 'empty') };
}

/** Explicit recovery invokes only the product's guarded same-request UI port.
 * Older deployments lacking that exact port are read-only and fail closed. */
export async function recoverHumanConsultingPendingSave({ owner, gameOrigin }) {
  const game = window.__hm, pinned = window.__hmNativeHumanConsultingOwner, trace = window.__hmNativeHumanConsultingTrace;
  const fail = () => { throw Object.assign(Error('The retained private coaching save cannot be recovered safely.'), { code: 'qa_human_recovery_refused' }); };
  if (!owner?.accountId || !pinned?.binding || pinned.game !== game || pinned.transport !== game?.net?.NETWS
    || location.origin !== gameOrigin || pinned.gameOrigin !== gameOrigin || pinned.accountId !== owner.accountId
    || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl || !trace || trace.ambiguous
    || trace.deliveries !== 1 || trace.memos?.length !== 1 || !trace.memo || !trace.intentConfirmed
    || !trace.enableClicked || game.consulting?.status.busy || !game.consulting?.status.enabled
    || !game.consulting?.status.reviewed || !game.consulting?.status.hasPlan
    || typeof game.consulting.recoverPendingSave !== 'function') fail();
  const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000),
    headers: { Authorization: 'Bearer ' + pinned.token } });
  if (!response.ok) fail(); const actual = await response.json();
  if (!actual.verified || !actual.bound || actual.account?.id !== owner.accountId || actual.binding?.subjectDid !== owner.subjectDid
    || actual.binding.podUrl !== owner.podUrl || actual.binding.authenticatedAgentDid !== pinned.binding.authenticatedAgentDid
    || window.__hm !== game || window.__hmNativeHumanConsultingOwner !== pinned || window.__hmNativeHumanConsultingTrace !== trace) fail();
  // This port returns only booleans. It holds the original module-scoped
  // response/review references and refuses owner, consent and delivery changes.
  const result = await game.consulting.recoverPendingSave({ situationId: trace.memo.payload.situation.id });
  if (trace.deliveries !== 1 || trace.ambiguous || result?.sameRequest !== true || result?.noDelivery !== true) fail();
  return { kind: 'human_consulting_recovery', sameRequest: true, noDelivery: true,
    confirmationClicked: result.confirmationClicked === true, continuationClicked: result.continuationClicked === true,
    privatePlanConfirmed: result.privatePlanConfirmed === true };
}
