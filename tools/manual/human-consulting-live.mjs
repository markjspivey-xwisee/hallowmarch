/** Explicit manual QA of the Progress menu. No import-time I/O,
 * identity creation, synthetic observation/clock changes or delivery retry.
 * Optional followup performs one ordinary game input after a durable fence. */
export function createHumanConsultingLiveQa({ getPage, getOwner, relayOrigin, gameOrigin, run,
  checkpoint = async () => {}, automaticFollowup = false, diagnose = null, onDiagnostic = null } = {}) {
  const origin = value => { try { const url = new URL(value); return url.protocol === 'https:' && url.origin === value; } catch { return false; } };
  if (typeof getPage !== 'function' || typeof getOwner !== 'function' || !origin(gameOrigin) || !origin(relayOrigin)
    || gameOrigin === relayOrigin || typeof run !== 'string' || !/^[a-zA-Z0-9_-]{1,128}$/.test(run)
    || typeof automaticFollowup !== 'boolean' || diagnose !== null && typeof diagnose !== 'function'
    || onDiagnostic !== null && typeof onDiagnostic !== 'function') throw new TypeError('Explicit manual coaching QA configuration is required.');
  let step = 'not-started', opened = false, observerInstalled = false, localGuidance = false, enableClicked = false, stopped = false, complete = false, flight = null;
  let firstVerified = false, followupAttempted = false, secondVerified = false;
  const flags = { automaticObservedContext: false, attributedLiveResponse: false, exactPrivatePlan: false,
    exactObservation: false, verifiedNativeDigest: false, boundedExactConsent: false, noAchievementClaims: false,
    ownerKeyAuthenticatedCheckpoint: false, singleDeliveryAttempt: false, intentConfirmedBeforeDelivery: false, sharingStopped: false };
  if (automaticFollowup) Object.assign(flags, { realElapsedFollowup: false, changedOutcome: false, automaticFollowup: false,
    distinctSituation: false, exactSecondPrivatePlan: false, twoDeliveries: false });
  const baseFlags = ['automaticObservedContext', 'attributedLiveResponse', 'exactPrivatePlan', 'exactObservation',
    'verifiedNativeDigest', 'ownerKeyAuthenticatedCheckpoint', 'boundedExactConsent', 'noAchievementClaims', 'singleDeliveryAttempt', 'intentConfirmedBeforeDelivery'];
  const check = (ok, code) => { if (!ok) throw Object.assign(new Error('Manual human coaching verification refused.'), { code }); };
  async function observedWait(wait) {
    if (!diagnose || !onDiagnostic) return wait();
    let pending = null;
    const report = () => {
      if (pending) return pending;
      const next = Promise.resolve().then(diagnose).then(onDiagnostic, () => onDiagnostic({ kind: 'human_consulting_diagnostic', unavailable: true }));
      pending = next; void next.finally(() => { if (pending === next) pending = null; }).catch(() => {}); return next;
    };
    void report().catch(() => {});
    const timer = setInterval(() => { void report().catch(() => {}); }, 15000);
    try { return await wait(); }
    finally { clearInterval(timer); if (pending) await pending.catch(() => {}); await report().catch(() => {}); }
  }
  async function runOnce() {
    if (complete) return status();
    const page = getPage(), owner = getOwner();
    check(page && !page.isClosed() && owner?.accountId && owner.subjectDid && owner.podUrl, 'qa_human_owner');
    const showCoach = async () => {
      if (!await page.locator('#menu').isVisible()) await page.locator('#btn-menu').click();
      await page.locator('#menu-tabs [data-tab="progress"]').click();
      await page.locator('#march-coach-milestones').waitFor({ state: 'visible', timeout: 15000 });
    };
    await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, initialize: true, action: 'check' });
    if (!opened) {
      step = 'open-progress';
      if (!observerInstalled) { await page.evaluate(installHumanConsultingObserver, { relayOrigin, automaticFollowup }); observerInstalled = true; }
      if (await page.locator('#netsheet').isVisible()) await page.locator('#netsheet-close').click();
      await showCoach();
      opened = true;
    }
    try {
      if (!enableClicked) {
        step = 'local-guidance-first';
        await page.waitForFunction(() => !!window.__hm?.activity?.snapshot()?.current?.id
          && !window.__hm.SAVE.pending && !window.__hm.SAVE.nativeFlight, null, { timeout: 30000 });
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'local' }); localGuidance = true;
        if (await page.locator('#march-coach-options').getAttribute('open') === null) await page.locator('#march-coach-options > summary').click();
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'disclosure' });
        // The caller's durable fixture fence is written before the one real
        // consent click. Neither a failed readback nor a lost reply re-clicks it.
        await checkpoint({ kind: 'coaching-delivery-intent' });
        enableClicked = true; step = 'enable-once';
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'enable' });
      }
      if (!firstVerified) {
      step = 'private-plan-confirmation';
      await observedWait(() => page.waitForFunction(() => window.__hm?.consulting?.status.hasPrivatePlan && !window.__hm.consulting.status.busy
        && !!window.__hmNativeHumanConsultingTrace?.memo, null, { timeout: 240000 }));
      check(await page.locator('#march-consulting-result').isVisible(), 'qa_human_plan_display');
      await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'check' });
      step = 'native-private-readback';
      const result = await page.evaluate(readHumanConsultingPlan, { owner, relayOrigin, gameOrigin, withdrawn: stopped });
      Object.assign(flags, result);
      check(baseFlags.every(key => flags[key] === true), 'qa_human_private_readback');
      firstVerified = true;
      }
      if (automaticFollowup && !secondVerified) {
        // After an uncertain input or stopped session this same helper may only
        // read already delivered evidence. It never presses another key.
        check(!stopped || followupAttempted, 'qa_human_followup_stopped');
        if (!followupAttempted) {
          step = 'followup-real-wait';
          await page.evaluate(inspectHumanConsultingFollowup, { owner, gameOrigin, action: 'begin' });
          while (!(await page.evaluate(inspectHumanConsultingFollowup, { owner, gameOrigin, action: 'wait' })).ready) await page.waitForTimeout(1000);
          await checkpoint({ kind: 'coaching-followup-intent' });
          await page.evaluate(inspectHumanConsultingFollowup, { owner, gameOrigin, action: 'arm' });
          await page.locator('#btn-resume').click();
          await page.bringToFront();
          await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'check' });
          await page.evaluate(inspectHumanConsultingFollowup, { owner, gameOrigin, action: 'input' });
          followupAttempted = true; step = 'followup-one-input';
          await page.keyboard.press('1');
        }
        step = 'automatic-followup-confirmation';
        await observedWait(() => page.waitForFunction(() => {
          const trace = window.__hmNativeHumanConsultingTrace;
          if (trace?.ambiguous || trace?.deliveries > 2) throw Error('Unexpected coaching delivery.');
          return trace?.deliveries === 2 && trace.memos?.length === 2 && !window.__hm.consulting.status.busy;
        }, null, { timeout: 240000 }));
        await page.evaluate(inspectHumanConsultingFollowup, { owner, gameOrigin, action: 'outcome' });
        await showCoach();
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'check' });
        const second = await page.evaluate(readHumanConsultingPlan, { owner, relayOrigin, gameOrigin, withdrawn: stopped, planIndex: 1 });
        Object.assign(flags, second);
        check(baseFlags.filter(key => key !== 'singleDeliveryAttempt').every(key => flags[key] === true) && ['realElapsedFollowup', 'changedOutcome', 'automaticFollowup',
          'distinctSituation', 'exactSecondPrivatePlan', 'twoDeliveries'].every(key => flags[key] === true), 'qa_human_followup_readback');
        secondVerified = true;
      }
    } finally {
      if (enableClicked && !stopped && !page.isClosed()) {
        step = 'stop-sharing';
        if (automaticFollowup) {
          await showCoach();
          if (await page.locator('#march-coach-options').getAttribute('open') === null) await page.locator('#march-coach-options > summary').click();
        }
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'withdraw' }); stopped = true;
      }
    }
    step = 'withdrawal-native-readback';
    // Stop is one click. Only read-only native verification is repeated while
    // its two exact consent withdrawals settle; no request is delivered again.
    const deadline = Date.now() + 180000;
    do {
      const result = await page.evaluate(readHumanConsultingPlan, { owner, relayOrigin, gameOrigin, withdrawn: true, ...(automaticFollowup ? { planIndex: 1 } : {}) });
      flags.sharingStopped = result.sharingStopped;
      if (flags.sharingStopped) break;
      await page.waitForTimeout(1000);
    } while (Date.now() < deadline);
    check(flags.sharingStopped, 'qa_human_withdrawal_readback');
    await page.evaluate(disposeHumanConsultingObserver);
    complete = true; step = 'complete'; return status();
  }
  const status = () => ({ kind: 'human_consulting_qa', step, opened, localGuidance, enableClicked,
    requestClicked: enableClicked, stopped, complete, busy: !!flight, ...flags });
  return Object.freeze({ status, run() {
    if (flight) return flight;
    const next = Promise.resolve().then(runOnce).catch(error => {
      throw Object.assign(new Error('Manual human coaching verification failed.'), {
        code: /^qa_human_[a-z_]{1,64}$/.test(error?.code || '') ? error.code : 'qa_human_stage_failed' });
    }); flight = next;
    const clear = () => { if (flight === next) flight = null; };
    void next.then(clear, clear); return next;
  } });
}

/** The game/app session and its original native owner are checked before and
 * after every await. Tokens, exact snapshots and private records stay in-page. */
export async function guardHumanConsultingOwner({ owner, gameOrigin, initialize = false, action = 'check' }) {
  const fail = code => { throw Object.assign(Error('The original human coaching QA condition changed.'), { code }); };
  let pinned = window.__hmNativeHumanConsultingOwner;
  if (!pinned) {
    if (!initialize) fail('qa_human_owner_changed');
    const game = window.__hm, transport = game?.net?.NETWS;
    pinned = { game, transport, player: game?.GAME?.player, token: transport?.token, generation: transport?.generation, gameOrigin,
      accountId: owner.accountId, subjectDid: owner.subjectDid, podUrl: owner.podUrl, binding: null };
    window.__hmNativeHumanConsultingOwner = pinned;
  }
  const current = () => {
    const game = window.__hm, transport = game?.net?.NETWS;
    if (window.__hmNativeHumanConsultingOwner !== pinned || location.origin !== gameOrigin || pinned.gameOrigin !== gameOrigin
      || pinned.accountId !== owner.accountId || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl
      || game !== pinned.game || transport !== pinned.transport || !game?.GAME?.started || game.GAME.player !== pinned.player || !game.GAME.player?.alive
      || !game.SAVE?.native || game.SAVE.readConfirmed !== true || !pinned.token || transport?.token !== pinned.token
      || transport.generation !== pinned.generation || transport.reload || transport.acct?.id !== owner.accountId
      || !transport.acct.nativeBound || localStorage.getItem('hallowmarch.token.' + location.host) !== pinned.token) fail('qa_human_owner_changed');
  };
  current();
  const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000),
    headers: { Authorization: 'Bearer ' + pinned.token } });
  current(); if (!response.ok) fail('qa_human_owner_changed'); const status = await response.json(); current();
  const binding = status.binding;
  if (!status.bound || !status.verified || status.account?.id !== owner.accountId || binding?.subjectDid !== owner.subjectDid
    || binding.podUrl !== owner.podUrl || !binding.authenticatedAgentDid) fail('qa_human_owner_changed');
  if (pinned.binding && ['subjectDid', 'podUrl', 'authenticatedAgentDid'].some(key => pinned.binding[key] !== binding[key])) fail('qa_human_owner_changed');
  pinned.binding ||= { subjectDid: binding.subjectDid, podUrl: binding.podUrl, authenticatedAgentDid: binding.authenticatedAgentDid };
  const game = window.__hm, trace = window.__hmNativeHumanConsultingTrace;
  if (['local', 'disclosure', 'enable'].includes(action)) {
    const state = game.consulting?.status, snapshot = game.activity?.snapshot?.();
    const focus = document.querySelector('#march-coach-milestones'), suggestions = document.querySelector('#march-coach-interventions');
    if (!state || state.enabled || state.connected || state.privateHistoryOpen || state.reviewed || state.busy || !trace
      || trace.deliveries || trace.coachingCalls || !snapshot?.current?.id || !snapshot.current.title
      || !focus?.textContent.includes(snapshot.current.title) || !suggestions?.querySelector('button')
      || document.querySelector('#march-consulting-goal') || document.querySelector('#march-consulting-current')
      || game.SAVE.pending || game.SAVE.nativeFlight || game.fn?.buildSave?.()?.char?.x?.coachDelivery?.pending) fail('qa_human_local_guidance');
    trace.localVerified = true;
  }
  if (['disclosure', 'enable'].includes(action)) {
    const privacy = document.querySelector('#march-coach-options'), button = document.getElementById('march-consulting-connect');
    if (!privacy?.open || !privacy.textContent.includes('Shares your current milestone and a small gameplay summary with Foxxi.')
      || !privacy.textContent.includes('Chat, inventory contents and other players’ private records are excluded.')
      || !privacy.textContent.includes('15-minute guidance session') || !privacy.textContent.includes('keep its plans privately in your pod')
      || !privacy.textContent.includes('stop sharing at any time') || button?.textContent !== 'Start Foxxi guidance for 15 minutes') fail('qa_human_disclosure');
  }
  if (action === 'enable' || action === 'withdraw') {
    if (!trace || action === 'enable' && (!trace.localVerified || trace.enableClicked)) fail('qa_human_single_click');
    const control = document.getElementById(action === 'enable' ? 'march-consulting-connect' : 'march-consulting-withdraw');
    if (!control || control.disabled || control.hidden) fail('qa_human_control');
    current();
    if (action === 'enable') trace.enableClicked = true;
    control.click();
  } else if (!['check', 'local', 'disclosure'].includes(action)) fail('qa_human_action');
  return true;
}

/** A transparent observation port: it never changes a request, response,
 * clock, gameplay event, consent, native signature or private-save state. */
export function installHumanConsultingObserver({ relayOrigin, automaticFollowup = false }) {
  if (window.__hmNativeHumanConsultingTrace) throw Object.assign(Error('A coaching delivery observer already exists.'), { code: 'qa_human_observer_exists' });
  const trace = { prior: globalThis.fetch, observed: null, observer: null, deliveries: 0, coachingCalls: 0,
    memo: null, memos: [], automaticFollowup, ambiguous: false, localVerified: false, enableClicked: false, intentConfirmed: false, intents: [] };
  const capture = () => {
    try {
      const payload = JSON.parse(document.querySelector('#march-coach-preview')?.textContent || 'null');
      if (!payload?.situation?.id?.startsWith('urn:hallowmarch:consultation:')) return;
      if (trace.memos.some(item => item.payload.situation.id === payload.situation.id)) return;
      if (trace.memos.length && (!automaticFollowup || trace.memos.length !== 1 || !trace.followup?.inputAttempted)) { trace.ambiguous = true; return; }
      const snapshot = window.__hm.activity.snapshot();
      const marker = '\nOwner-browser observations, not server-verified outcomes: ';
      const observedContext = JSON.parse(payload.situation.workContext.split(marker).at(-1));
      const constraints = JSON.parse(payload.situation.workContext.split('\nConstraints (game-defined): ')[1].split('\nDesired result (game milestone criterion): ')[0]);
      const current = snapshot.current, milestone = !current.bodyId && snapshot.milestones?.find(item => item.id === current.id);
      const observed = { ...current, ...(milestone || {}) }, clean = value => String(value || '').slice(0, 1300).trim();
      const focus = { id: current.id, title: clean(observed.title), desiredResult: clean(observed.desiredResult || observed.description || observed.title),
        workContext: clean(observed.workContext || observed.description || observed.title),
        ...(current.bodyId ? { bodyId: current.bodyId, bodyKind: current.bodyKind } : {}) };
      const result = Number.isFinite(observed.current) && Number.isFinite(observed.target)
        ? `${observed.current} / ${observed.target} observed for ${observed.title}.` : String(observed.observedResult || 'No comparable outcome observed.');
      const body = snapshot.summary?.bodyObservations?.find(item => item.bodyId === window.__hmNativeHumanConsultingOwner?.accountId && item.kind === 'character');
      const humanOutcome = { executed: body?.counters?.['ability.executed'] || 0, refused: body?.counters?.['ability.refused'] || 0 };
      const memo = { payload, observedContext, constraints, focus, humanOutcome, expectedObservedResult: clean(observed.title + ': ' + result) };
      trace.memos.push(memo); trace.memo ||= memo;
    } catch { /* Missing/incomplete DOM text is retried read-only at delivery. */ }
  };
  trace.observer = new MutationObserver(capture);
  trace.observer.observe(document.body, { childList: true, subtree: true, characterData: true });
  trace.observed = function (...args) {
    try {
      const url = new URL(typeof args[0]?.url === 'string' ? args[0].url : String(args[0]), location.href);
      const rpc = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : null;
      if (url.origin === relayOrigin && rpc?.method === 'tools/call') {
        const name = rpc.params?.name, input = rpc.params?.arguments;
        const planner = input?.descriptor_url === 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance';
        if (name === 'dereference' && input?.iri === 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance'
          || name === 'sign_request' && input?.payload?.situation?.id?.startsWith('urn:hallowmarch:consultation:') || name === 'act' && planner) trace.coachingCalls++;
        if (name === 'act' && planner && input.action_iri === 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/contextualize-and-plan-signed') {
          capture(); trace.deliveries++;
          const pending = JSON.parse(window.__hm.SAVE.lastBody || 'null')?.char?.x?.coachDelivery?.pending;
          const memo = trace.memos[trace.deliveries - 1];
          trace.intents.push(!!memo && pending?.id === memo.payload.situation.id
            && pending.stage === 'intent' && window.__hm.SAVE.native && !window.__hm.SAVE.pending);
          trace.intentConfirmed = trace.deliveries === 1 && trace.intents[0];
          if (trace.deliveries > (automaticFollowup ? 2 : 1) || !memo) trace.ambiguous = true;
        }
      }
    } catch { /* No body, URL, credential or raw exception leaves this counter. */ }
    return Reflect.apply(trace.prior, this, args);
  };
  window.__hmNativeHumanConsultingTrace = trace; globalThis.fetch = trace.observed;
  return true;
}

/** Reads real browser elapsed time and actual human-body ability counters. Only
 * QA observer state changes; no game, activity, clock or native port is patched. */
export function inspectHumanConsultingFollowup({ owner, gameOrigin, action }) {
  const fail = () => { throw Object.assign(Error('Automatic coaching followup condition changed.'), { code: 'qa_human_followup_guard' }); };
  const game = window.__hm, pinned = window.__hmNativeHumanConsultingOwner, trace = window.__hmNativeHumanConsultingTrace;
  if (!trace?.automaticFollowup || !trace.verifiedFirst || !pinned?.binding || location.origin !== gameOrigin || pinned.gameOrigin !== gameOrigin
    || pinned.accountId !== owner.accountId || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl
    || game !== pinned.game || game.net?.NETWS !== pinned.transport || game.GAME?.player !== pinned.player || !game.GAME.started || !pinned.player.alive
    || !game.SAVE?.native || game.SAVE.readConfirmed !== true || game.net.NETWS.token !== pinned.token || game.net.NETWS.generation !== pinned.generation
    || game.net.NETWS.reload || game.net.NETWS.acct?.id !== owner.accountId || !game.net.NETWS.acct.nativeBound
    || localStorage.getItem('hallowmarch.token.' + location.host) !== pinned.token || trace.ambiguous || trace.deliveries > 2) fail();
  const menu = document.getElementById('menu'), now = performance.now();
  const outcome = () => {
    const body = game.activity.snapshot()?.summary?.bodyObservations?.find(item => item.bodyId === owner.accountId && item.kind === 'character');
    return { executed: body?.counters?.['ability.executed'] || 0, refused: body?.counters?.['ability.refused'] || 0 };
  };
  const waiting = () => { if (trace.deliveries !== 1 || !game.consulting.status.enabled || game.consulting.status.busy
    || !menu || menu.hidden || game.UI?.modal !== 'menu') fail(); };
  if (action === 'begin') {
    waiting(); if (trace.followup) fail();
    trace.followup = { startedAt: now, armed: false, inputAttempted: false, changedOutcome: false };
  }
  const state = trace.followup; if (!state || !Number.isFinite(now) || now < state.startedAt) fail();
  const ready = now - state.startedAt >= 120000;
  if (action === 'wait' || action === 'arm') {
    waiting(); if (action === 'arm') { if (!ready || state.armed) fail(); state.armed = true; state.elapsed = now - state.startedAt; }
  } else if (action === 'input') {
    const active = document.activeElement;
    if (!ready || !state.armed || state.inputAttempted || trace.deliveries !== 1 || !game.consulting.status.enabled
      || !menu?.hidden || game.UI?.modal || document.hidden || !document.hasFocus()
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable
      || !Number.isFinite(game.GAME.t) || !Number.isFinite(pinned.player.combatUntil) || game.GAME.t <= pinned.player.combatUntil) fail();
    state.before = outcome(); state.inputAttempted = true;
  } else if (action === 'outcome') {
    if (!state.inputAttempted || !state.before) fail();
    const after = outcome();
    state.changedOutcome = after.executed > state.before.executed || after.refused > state.before.refused;
    if (!state.changedOutcome || trace.deliveries !== 2 || trace.memos.length !== 2) fail();
  } else if (action !== 'begin') fail();
  return { ready };
}
export function disposeHumanConsultingObserver() {
  const trace = window.__hmNativeHumanConsultingTrace;
  trace?.observer?.disconnect();
  if (trace && globalThis.fetch === trace.observed) globalThis.fetch = trace.prior;
  return true;
}

/** Fresh native clients read and decrypt the actual owner journal. The native
 * client verifies descriptor authorship, encrypted envelope and RDF digest.
 * Supplied modules are isolated offline-test ports, never live substitutions. */
export async function readHumanConsultingPlan({ owner, relayOrigin, gameOrigin, withdrawn = false, planIndex = 0 }, suppliedModules) {
  const trace = window.__hmNativeHumanConsultingTrace, memo = planIndex === 0 ? trace?.memo : trace?.memos?.[1], pinned = window.__hmNativeHumanConsultingOwner;
  const game = window.__hm, transport = game?.net?.NETWS, token = transport?.token, generation = transport?.generation;
  const fail = code => { throw Object.assign(Error('Native private coaching verification refused.'), { code }); };
  const current = () => {
    if (![0, 1].includes(planIndex) || planIndex === 1 && !trace?.automaticFollowup || !memo || trace.ambiguous || !trace.enableClicked || !pinned?.binding || window.__hmNativeHumanConsultingTrace !== trace
      || window.__hmNativeHumanConsultingOwner !== pinned || pinned.game !== game || pinned.transport !== transport
      || location.origin !== gameOrigin || pinned.gameOrigin !== gameOrigin || pinned.token !== token || pinned.generation !== generation
      || pinned.accountId !== owner.accountId || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl
      || window.__hm !== game || !game?.GAME?.started || game.GAME.player !== pinned.player || !game.SAVE?.native || game.SAVE.readConfirmed !== true
      || transport !== game.net?.NETWS || transport.acct?.id !== owner.accountId || !transport.acct.nativeBound
      || !token || transport.token !== token || transport.generation !== generation || transport.reload
      || localStorage.getItem('hallowmarch.token.' + location.host) !== token) fail('qa_human_owner_changed');
  };
  const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
    : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
  const equal = (a, b) => canonical(a) === canonical(b);
  const verifyBinding = async () => {
    current(); const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000), headers: { Authorization: 'Bearer ' + token } });
    current(); if (!response.ok) fail('qa_human_owner_changed'); const status = await response.json(); current();
    if (!status.verified || !status.bound || status.account?.id !== owner.accountId || status.binding?.subjectDid !== owner.subjectDid
      || status.binding.podUrl !== owner.podUrl || status.binding.authenticatedAgentDid !== pinned.binding.authenticatedAgentDid) fail('qa_human_owner_changed');
    return status;
  };
  current();
  const [{ createBrowserAccessCache }, { createOwnerPerformanceConsultation }, live, { createNativePodClient }, { RelayMcpTransport }] = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/performance-consultation.mjs'),
    import('/gaming/identity/assets/foxxi-consulting.mjs'), import('/gaming/identity/assets/client.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
  ]); current();
  const status = await verifyBinding(), cache = createBrowserAccessCache(), clients = [];
  let journal;
  try {
    const held = await cache.get({ ownerDid: owner.subjectDid, podUrl: owner.podUrl, relayUrl: relayOrigin }); current();
    if (!held?.credential || held.credential.refreshToken || held.credential.expiresAt <= Date.now()) fail('qa_human_access_cache');
    const readOnlyClient = options => {
      const tx = new RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
      const allowed = new Set(['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph']);
      const transport = { connect: (...args) => tx.connect(...args), setCredential: value => tx.setCredential?.(value),
        callTool(name, input, options) { if (!allowed.has(name)) fail('qa_human_read_only'); return tx.callTool(name, input, options); } };
      const client = createNativePodClient({ ...options, transport }); clients.push(client); return client;
    };
    journal = createOwnerPerformanceConsultation({ binding: status.binding, credential: held.credential,
      relayUrl: relayOrigin, sessionId: crypto.randomUUID(), createClient: readOnlyClient });
    await journal.connect(); current(); const history = await journal.read(); current();
    const graphIri = journal.status().graphIri;
    const native = readOnlyClient({ ownerDid: owner.subjectDid, podUrl: owner.podUrl, credential: held.credential, relayUrl: relayOrigin });
    await native.connect(); current();
    const checkpoint = 'hallowmarch-performance-consultation/v1';
    const selected = await native.currentHead({ graphIri, checkpoint }); current();
    const opened = await native.load({ graphIri, checkpoint }); current();
    const after = await native.currentHead({ graphIri, checkpoint }); current();
    await verifyBinding();
    if (!selected || !opened) fail('qa_human_readback_changed');
    if (!equal(selected, opened.head) || !equal(selected, after) || !equal(opened.record, history)) {
      // The two actual withdrawals can change this native head during a read.
      // Only their read-only polling may wait for a stable graph; no proof or
      // owner error is converted into permission to repeat a delivery.
      if (withdrawn) return { sharingStopped: false };
      fail('qa_human_readback_changed');
    }
    const consultations = history.consultations.filter(item => item.response?.response?.plan?.situationId === memo.payload.situation.id);
    if (consultations.length !== 1) fail('qa_human_plan_ambiguous'); const consultation = consultations[0];
    const observations = history.observations.filter(item => item.id === consultation.observationId);
    if (observations.length !== 1) fail('qa_human_observation_ambiguous'); const observation = observations[0], displayed = consultation.response;
    // The product render cache is [response, evaluationId], not the response
    // itself. Check each slot without treating its evaluation label as proof
    // of learning or assuming it belongs to the current plan.
    let displayTuple;
    try { displayTuple = JSON.parse(document.querySelector('#march-consulting-result')?.dataset.resultKey); }
    catch { fail('qa_human_display_shape'); }
    if (!Array.isArray(displayTuple) || displayTuple.length !== 2 || !displayTuple[0]
      || typeof displayTuple[0] !== 'object' || Array.isArray(displayTuple[0])) fail('qa_human_display_shape');
    const [actualDisplay, displayedEvaluationId] = displayTuple;
    if (displayedEvaluationId !== null && (typeof displayedEvaluationId !== 'string' || !displayedEvaluationId.trim()
      || displayedEvaluationId.length > 128 || /[\u0000-\u001f\u007f]/.test(displayedEvaluationId))) fail('qa_human_display_shape');
    const stableTask = { desiredResult: 'Develop effective play through observed Hallowmarch activity and practical support.',
      workContext: 'Hallowmarch play-session coaching for the authenticated player and their separate party companion.' };
    const exactObservation = observation.ownerDid === owner.subjectDid && observation.performerKind === 'human'
      && observation.task.id.startsWith('urn:hallowmarch:play-session:') && observation.task.observedResult === memo.payload.situation.observed
      && observation.task.observedResult === memo.expectedObservedResult
      && history.observations.filter(item => item.task.id === observation.task.id).every(item => item.task.desiredResult === stableTask.desiredResult
        && item.task.workContext === stableTask.workContext && equal(item.task.constraints, memo.constraints))
      && observation.evidence.length === 1 && observation.evidence[0].kind === 'owner-browser-observation'
      && observation.evidence[0].performerDid === owner.subjectDid && observation.evidence[0].at === memo.observedContext.capturedAt
      && equal(observation.evidence[0].metrics, memo.observedContext.metrics);
    const focus = memo.focus, body = focus?.bodyId;
    const strictFocus = focus && Object.keys(focus).every(key => ['id', 'title', 'desiredResult', 'workContext', 'bodyId', 'bodyKind'].includes(key))
      && /^[A-Za-z0-9][A-Za-z0-9:_-]{0,127}$/.test(focus.id) && typeof focus.title === 'string' && focus.title.length > 0 && focus.title.length <= 200
      && ['desiredResult', 'workContext'].every(key => typeof focus[key] === 'string' && focus[key].trim() && focus[key].length <= 1600)
      && (!Object.hasOwn(focus, 'bodyId') && !Object.hasOwn(focus, 'bodyKind') || focus.bodyKind === 'character' && body === owner.accountId
        || focus.bodyKind === 'owned-unit' && typeof body === 'string' && (body.startsWith(owner.accountId + ':companion:')
          && /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.slice((owner.accountId + ':companion:').length))
          || body.startsWith(owner.accountId + ':animal:') && /^[0-9]{1,9}$/.test(body.slice((owner.accountId + ':animal:').length))));
    const exactFocusContext = strictFocus && focus.workContext + '\nMilestone: ' + focus.id + ' (' + focus.title + ')'
      + (body ? '\nObserved body: ' + JSON.stringify({ id: body, kind: focus.bodyKind }) : '')
      + '\nConstraints (game-defined): ' + JSON.stringify(memo.constraints) + '\nDesired result (game milestone criterion): ' + focus.desiredResult
      + '\nOwner-browser observations, not server-verified outcomes: ' + JSON.stringify(memo.observedContext);
    const automaticObservedContext = trace.localVerified && memo.payload.situation.provenance === 'owner-browser-observed-gameplay'
      && memo.payload.situation.performer?.id === owner.subjectDid && memo.payload.situation.performer.kind === 'human'
      && memo.payload.situation.modalStatus === 'Hypothetical' && memo.observedContext.observationLevel === 'owner-browser'
      && !!strictFocus && memo.payload.situation.competency === focus.desiredResult && memo.payload.situation.workContext === exactFocusContext
      && Object.keys(memo.observedContext.metrics).sort().join(',') === 'activePlaySeconds,creatureDefeats,deaths,healthPercent,level,nearbyHostiles,ownedCompanions'
      && memo.observedContext.metrics.healthPercent <= 100 && Object.values(memo.observedContext.metrics).every(value => Number.isFinite(value) && value >= 0 && value <= 1e9);
    const attributedLiveResponse = displayed.source?.descriptorUrl === live.FOXXI_PLANNER_DESCRIPTOR
      && displayed.service?.action === live.FOXXI_PLANNER_ACTION && displayed.source.performerDid === owner.subjectDid
      && displayed.source.performerKind === 'human' && displayed.source.signatureAuthority === 'relay-delegated'
      && displayed.response?.classifiedBy === status.binding.authenticatedAgentDid
      && displayed.response?.diagnosis?.situationId === memo.payload.situation.id && displayed.response?.plan?.situationId === memo.payload.situation.id;
    const exactPrivatePlan = consultation.ownerDid === owner.subjectDid && equal(displayed.response, actualDisplay)
      && equal(consultation.service, displayed.service);
    const scopes = history.consents.filter(item => item.taskId === observation.task.id);
    const retention = scopes.find(item => item.purpose === 'retain-observations' && item.recipient === owner.podUrl);
    const sharing = scopes.find(item => item.purpose === 'request-consultation' && item.recipient === displayed.service.target);
    const boundedExactConsent = scopes.length === 2 && !!retention && !!sharing && retention.sessionId === sharing.sessionId
      && scopes.every(item => Number.isFinite(Date.parse(item.issuedAt)) && Date.parse(item.expiresAt) > Date.parse(item.issuedAt)
        && Date.parse(item.expiresAt) - Date.parse(item.issuedAt) <= 900000 && typeof item.revoked === 'boolean')
      && (withdrawn || scopes.every(item => item.revoked === false && Date.parse(item.expiresAt) > Date.now()));
    const ownerKeyAuthenticatedCheckpoint = opened.proofKind === 'owner-key-authenticated-checkpoint'
      && opened.head.proofKind === opened.proofKind && opened.head.cid === opened.head.bindingCid
      && opened.head.recordCid === opened.digest && typeof opened.head.nativeRevision === 'string' && opened.head.nativeRevision.length > 0;
    const verifiedNativeDigest = ownerKeyAuthenticatedCheckpoint && opened.graphIri === graphIri && opened.record.ownerDid === owner.subjectDid
        && /^graph-nquads-sha256:[0-9a-f]{64}$/.test(opened.digest) && typeof opened.operationId === 'string' && !!opened.operationId,
      noAchievementClaims = observation.competencyStatus === 'not-assessed' && consultation.competencyStatus === 'not-assessed'
        && consultation.epistemicStatus === 'service-response-unvalidated-effect' && displayed.foxxiPersonalRecordCreated === false
        && Array.isArray(displayed.competencyClaims) && displayed.competencyClaims.length === 0;
    const intentConfirmedBeforeDelivery = planIndex === 0 ? trace.intentConfirmed === true
      : trace.intents?.length === 2 && trace.intents.every(value => value === true);
    const allProofs = automaticObservedContext && attributedLiveResponse && exactPrivatePlan && exactObservation
      && verifiedNativeDigest && ownerKeyAuthenticatedCheckpoint && boundedExactConsent && noAchievementClaims && intentConfirmedBeforeDelivery;
    if (planIndex === 0 && allProofs && trace.deliveries === 1) trace.verifiedFirst ||= {
      taskId: observation.task.id, observationId: observation.id, consultationId: consultation.id,
      situationId: memo.payload.situation.id, sessionId: retention.sessionId,
      observation: canonical(observation), consultation: canonical(consultation) };
    const first = trace.verifiedFirst, followup = trace.followup;
    const distinctSituation = planIndex === 1 && !!first && first.situationId !== memo.payload.situation.id
      && first.observationId !== observation.id && first.consultationId !== consultation.id;
    const firstStillRetained = !!first && history.observations.filter(item => item.id === first.observationId && canonical(item) === first.observation).length === 1
      && history.consultations.filter(item => item.id === first.consultationId && canonical(item) === first.consultation).length === 1;
    const sameSession = distinctSituation && firstStillRetained && first.taskId === observation.task.id && first.sessionId === retention?.sessionId;
    const secondHumanOutcome = memo.humanOutcome;
    const changedOutcome = planIndex === 1 && followup?.changedOutcome === true && !!followup.before
      && (secondHumanOutcome?.executed > followup.before.executed || secondHumanOutcome?.refused > followup.before.refused);
    return { automaticObservedContext, attributedLiveResponse, exactPrivatePlan, exactObservation, verifiedNativeDigest, ownerKeyAuthenticatedCheckpoint,
      boundedExactConsent: !!boundedExactConsent, noAchievementClaims,
      singleDeliveryAttempt: trace.deliveries === 1, intentConfirmedBeforeDelivery: trace.intentConfirmed === true,
      ...(planIndex === 1 ? { intentConfirmedBeforeDelivery, realElapsedFollowup: Number.isFinite(followup?.elapsed) && followup.elapsed >= 120000,
        changedOutcome, automaticFollowup: !!sameSession && followup?.armed === true && followup.inputAttempted === true,
        distinctSituation: !!distinctSituation, exactSecondPrivatePlan: !!allProofs && !!sameSession && changedOutcome,
        twoDeliveries: trace.deliveries === 2 && trace.memos?.length === 2 && trace.intents?.length === 2 } : {}),
      sharingStopped: withdrawn && boundedExactConsent && scopes.every(item => item.revoked) && game.consulting.status.enabled === false };
  } finally {
    journal?.close(); for (const client of clients) client.close(); await cache.close(); current();
  }
}
