/** Retained manual QA choreography only. No browser, identity or native I/O. */
const refused = () => { throw Object.assign(new Error('The original checkpoint cannot be recovered safely.'), { code: 'qa_checkpoint_recovery_refused' }); };
export function checkpointRecoveryEligible({ plan, session, evidence, episode, laterStarted = false } = {}) {
  return plan?.stage === 'sealed-profile-create-and-link' && plan.completed === 2 && !plan.busy && !plan.complete
    && session?.pending === true && session.nativePendingCount === 1 && !session.indexed && !session.linked && !session.busy
    && session.setStarted === true && session.keyReady === true && session.checkpointWriteCount === 1
    && evidence?.knownCommitted === true && evidence.originalWriteMatched === true
    && /^sha256:[0-9a-f]{64}$/.test(evidence.cipherDigest || '') && /^[0-9a-f]{64}$/.test(evidence.recipientKeyHash || '')
    && Number.isSafeInteger(evidence.storedBytes) && evidence.storedBytes > 0 && evidence.storedBytes <= 4194304
    && episode?.reserved === true && !episode.failed && !episode.closed && episode.stages?.length === 0 && !laterStarted;
}
export function retainedCheckpointReleaseRecovery({ eligible, preflight, markDocument, reload, waitDocument, recover } = {}) {
  let preflightPassed = false, reloadAttempted = false, documentConfirmed = false, complete = false, busy = false, marker;
  const status = () => ({ kind: 'native_checkpoint_release_recovery', preflightPassed, reloadAttempted, documentConfirmed, complete, busy });
  return Object.freeze({ status, async run() {
    if (busy) refused(); if (complete) return status(); busy = true;
    try {
      if (!preflightPassed) { if (!await eligible()) refused(); await preflight(); marker = await markDocument(); preflightPassed = true; }
      if (!reloadAttempted) { reloadAttempted = true; await reload(); }
      if (!documentConfirmed) { await waitDocument(marker); documentConfirmed = true; }
      await recover(); complete = true; return status();
    } finally { busy = false; }
  } });
}
