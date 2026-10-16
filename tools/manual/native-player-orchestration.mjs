/** Offline-testable orchestration only; no browser import or native I/O. */
export function retainedGameBoot({ createContext, url, onContext = () => {}, onPage = () => {}, onStep = () => {} }) {
  let context, page;
  return Object.freeze({
    async open() {
      if (!context) { onStep('new-context'); context = await createContext(); onContext(context); }
      if (!page) { onStep('new-page'); page = await context.newPage(); onPage(page); }
      // Retain the page before any navigation can fail. A retry reuses it and
      // its context rather than leaving another full game renderer behind.
      onStep('navigation');
      await page.goto(url, { waitUntil: 'domcontentloaded' });
      onStep('game-ready');
      await page.waitForFunction(() => window.__hm?.ready && window.__hm.net?.NETWS?.state === 'on'
        && !!window.__hm.net.NETWS.token, undefined, { timeout: 180_000 });
      onStep('identity-control');
      await page.locator('#title .native-player button').first().waitFor({ timeout: 30_000 });
      onStep('complete');
      return page;
    },
  });
}

export function verifiedContextHandoff({ verify, privacy, close }) {
  let privacyVerified = false, closed = false;
  const status = () => ({ privacyVerified, closed });
  return Object.freeze({ status,
    async run() {
      if (!privacyVerified) {
        await verify();
        if (await privacy() !== true) throw Object.assign(new Error('First-context privacy proof failed.'), { code: 'qa_first_privacy' });
        privacyVerified = true;
      }
      // A failed close can be retried without reading from a closed page or
      // replaying native operations. The Node-only recovery/passkey stay alive.
      if (!closed) { await close(); closed = true; }
      return status();
    },
    requireClosed() {
      if (!privacyVerified || !closed) throw Object.assign(new Error('First context must be verified and closed.'), { code: 'qa_context_handoff' });
    },
  });
}

export function qaPageInventory(entries, { gameOrigin, relayOrigin }) {
  const pages = entries.map(({ page, contextIndex }, index) => {
    let originClass = 'other', closed = false;
    try {
      const url = new URL(page.url());
      originClass = url.href === 'about:blank' ? 'blank' : url.origin === gameOrigin ? 'game' : url.origin === relayOrigin ? 'relay' : 'other';
    } catch { /* Only the fixed classification leaves this function. */ }
    try { closed = page.isClosed(); } catch { closed = true; }
    return { pageIndex: index + 1, contextIndex, originClass, closed };
  });
  return { kind: 'native_qa_pages', count: pages.length, openCount: pages.filter(page => !page.closed).length,
    closedCount: pages.filter(page => page.closed).length,
    originCounts: Object.fromEntries(['game', 'relay', 'blank', 'other'].map(kind => [kind, pages.filter(page => page.originClass === kind).length])), pages };
}

// No arbitrary browser strings, URLs, errors or credentials may be printed by
// retained diagnostics, even if the page returns an unexpected value.
const fixedSteps = new Set(['binding-check', 'access-cache', 'profile-connect', 'recipient-register-resume', 'browser-key-create',
  'encrypted-recovery-export', 'profile-confirmation-retry', 'profile-set', 'exact-profile-readback', 'game-pointer-link',
  'native-connect', 'owner-index-head', 'profile-head', 'recipient-registry-read', 'signed-descriptor-readback',
  'recipient-register', 'owner-index-publish', 'profile-publish', 'encrypted-readback', 'native-capability']);
const fixedCodes = new Set(['operation_failed', 'operation_busy', 'invalid_input', 'invalid_record', 'invalid_identity', 'invalid_owner', 'invalid_relay',
  'invalid_credential', 'record_capacity', 'key_storage_unavailable', 'not_connected', 'native_unavailable',
  'capability_missing', 'owner_mismatch', 'native_contract', 'key_required', 'key_exists', 'recipient_conflict',
  'registration_pending', 'invalid_head', 'fork', 'conflict', 'invalid_proof', 'cannot_decrypt', 'unknown_operation',
  'key_registration_required', 'confirmation_required', 'needs_reauth', 'native_refused', 'crypto_unavailable',
  'invalid_profile', 'invalid_profile_index', 'missing_profile_index', 'profile_index_conflict', 'pod_pending',
  'pod_index_pending', 'pod_link_pending', 'unread_record', 'missing_record', 'recovery_required', 'revoked',
  'tool_error', 'manifest_incomplete', 'qa_owner_not_fresh', 'qa_scope_mismatch', 'qa_access_cache',
  'qa_bridge_refused', 'qa_bridge_body', 'qa_binding', 'qa_readback', 'qa_confirmation_timeout']);
const numericCode = value => Number.isInteger(value) && ((value >= 100 && value <= 599) || (value >= -32700 && value <= -32000)) ? value : null;
const profileStates = new Set(['idle', 'identity_unconfirmed', 'native_identity_required', 'native_signin_required',
  'connecting', 'ready', 'key_required', 'saving', 'uncertain', 'index_pending', 'link_pending', 'saved', 'closed']);
const profileState = value => profileStates.has(value) || fixedCodes.has(value) ? value : null;
function publicState(value) {
  const result = {};
  for (const key of ['ready', 'native', 'netOn', 'nativeBound', 'hasAccessSession']) result[key] = value?.[key] === true;
  result.nativePlayer = null;
  if (value?.nativePlayer && typeof value.nativePlayer === 'object') {
    const source = value.nativePlayer, player = result.nativePlayer = { state: profileState(source.state),
      loadPhase: ['identity', 'read', 'confirmed', 'blocked'].includes(source.loadPhase) ? source.loadPhase : null };
    for (const key of ['readConfirmed', 'loaded', 'started', 'loading', 'refPresent', 'refBlocked', 'profilePresent']) player[key] = source[key] === true;
    player.profileStatus = null;
    if (source.profileStatus && typeof source.profileStatus === 'object') {
      player.profileStatus = { state: profileState(source.profileStatus.state) };
      for (const key of ['keyPresent', 'hasRecord', 'pending', 'indexed', 'linked']) player.profileStatus[key] = source.profileStatus[key] === true;
    }
  }
  result.nativeQa = null;
  if (value?.nativeQa && typeof value.nativeQa === 'object') {
    result.nativeQa = {};
    for (const key of ['complete', 'busy', 'connected', 'keyStarted', 'keyReady', 'setStarted', 'recoveryPresent',
      'profilePresent', 'pending', 'hasRecord', 'indexed', 'linked', 'heldKeyPresent', 'recipientRegistered']) {
      if (typeof value.nativeQa[key] === 'boolean') result.nativeQa[key] = value.nativeQa[key];
    }
    const count = value.nativeQa.nativePendingCount;
    if (Number.isSafeInteger(count) && count >= 0 && count <= 4096) result.nativeQa.nativePendingCount = count;
    result.nativeQa.step = fixedSteps.has(value.nativeQa.step) ? value.nativeQa.step : null;
    result.nativeQa.code = fixedCodes.has(value.nativeQa.code) ? value.nativeQa.code : null;
    result.nativeQa.keyStatusCode = fixedCodes.has(value.nativeQa.keyStatusCode) ? value.nativeQa.keyStatusCode : null;
    result.nativeQa.profileState = ['connecting', 'ready', 'key_required', 'saving', 'uncertain', 'index_pending', 'link_pending', 'saved', 'closed']
      .includes(value.nativeQa.profileState) ? value.nativeQa.profileState : null;
    result.nativeQa.tools = Array.isArray(value.nativeQa.tools) ? value.nativeQa.tools.slice(-32).map(entry => ({
      step: fixedSteps.has(entry?.step) ? entry.step : null,
      outcome: ['returned', 'refused', 'threw'].includes(entry?.outcome) ? entry.outcome : null,
      code: fixedCodes.has(entry?.code) ? entry.code : null, numericCode: numericCode(entry?.numericCode),
    })) : [];
  }
  return result;
}

export function boundedPageStatus({ evaluate, timeoutMs = 2000 }) {
  const pending = new WeakMap();
  return async (page, diagnose = false) => {
    // A stalled renderer keeps ONE read-only evaluation in flight. Repeated
    // status commands cannot enqueue more work or reset a pending writer.
    if (pending.has(page)) return { inFlight: true, timedOut: true, unavailable: false };
    const job = Promise.resolve().then(() => evaluate(page, diagnose)).then(
      value => ({ inFlight: false, timedOut: false, unavailable: false, state: publicState(value) }),
      () => ({ inFlight: false, timedOut: false, unavailable: true }));
    pending.set(page, job);
    job.then(() => { if (pending.get(page) === job) pending.delete(page); });
    let timer;
    try {
      return await Promise.race([job, new Promise(resolve => {
        timer = setTimeout(() => resolve({ inFlight: true, timedOut: true, unavailable: false }), timeoutMs);
      })]);
    } finally { clearTimeout(timer); }
  };
}
