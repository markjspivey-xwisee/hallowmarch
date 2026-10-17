/** Opt-in manual smoke of the actual Players UI and native private coaching.
 * The goal/report are synthetic test inputs; measurements come from this game.
 * No import-time I/O, learner statements, achievements, or independent-agent claim. */
export function createHumanConsultingLiveQa({ getPage, getOwner, relayOrigin, gameOrigin, run, checkpoint = async () => {} } = {}) {
  const goal = 'Validate coaching workflow on this synthetic QA character';
  const observed = 'Actual game open; this synthetic task has no plan yet';
  const desired = 'An attributed returned plan is displayed and saved privately';
  const context = 'Explicit synthetic transport integration test ' + run + '. Verify this workflow only. No learning achievement or improved gameplay is claimed.';
  let step = 'not-started', opened = false, reviewClicked = false, requestClicked = false, complete = false, metrics = null;
  let flight = null;
  const flags = { attributedLiveResponse: false, exactPrivatePlan: false, exactObservation: false, noAchievementClaims: false, singleDeliveryAttempt: false };
  const check = (ok, code) => { if (!ok) throw Object.assign(new Error('Manual human consulting verification refused.'), { code }); };
  async function runOnce() {
      if (complete) return;
      const page = getPage(), owner = getOwner();
      check(page && !page.isClosed() && owner?.accountId && owner.subjectDid && owner.podUrl, 'qa_human_owner');
      await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, initialize: true, action: 'check' });
      if (!opened) {
        step = 'open-players';
        if (!await page.locator('#netsheet').isVisible()) await page.locator('#btn-net').click();
        await page.locator('#march-consulting-connect').waitFor({ state: 'visible', timeout: 15000 });
        await page.evaluate(relayOrigin => {
          if (window.__hmNativeHumanConsultingTrace) throw Error('observation already installed');
          const prior = globalThis.fetch, trace = { prior, observed: null, deliveryAttempts: 0 };
          trace.observed = function (...args) {
            try {
              const url = new URL(typeof args[0]?.url === 'string' ? args[0].url : String(args[0]), location.href);
              const rpc = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : null;
              if (url.origin === relayOrigin && rpc?.method === 'tools/call' && rpc.params?.name === 'act'
                && rpc.params.arguments?.descriptor_url === 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance'
                && rpc.params.arguments?.action_iri === 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/contextualize-and-plan-signed') trace.deliveryAttempts++;
            } catch { /* Fixed counting only: no body, URL, error or credential leaves this observer. */ }
            return Reflect.apply(prior, this, args);
          };
          window.__hmNativeHumanConsultingTrace = trace; globalThis.fetch = trace.observed;
        }, relayOrigin);
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'connect' }); opened = true;
      }
      step = 'private-support-connect';
      await page.waitForFunction(() => window.__hm.consulting?.status.connected && !window.__hm.consulting.status.busy, null, { timeout: 180000 });
      await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'check' });
      if (!reviewClicked) {
        await page.locator('#march-consulting-goal').fill(goal);
        await page.locator('#march-consulting-current').fill(observed);
        await page.locator('#march-consulting-desired').fill(desired);
        await page.locator('#march-consulting-context').fill(context);
        reviewClicked = true; step = 'review'; await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'review' });
      }
      if (!requestClicked) {
        await page.waitForFunction(() => window.__hm.consulting.status.reviewed && !window.__hm.consulting.status.busy, null, { timeout: 180000 });
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'preview' });
        metrics = await page.evaluate(({ goal, observed, desired, context, owner }) => {
          const body = JSON.parse(document.querySelector('#march-consulting-preview pre').textContent);
          const marker = 'Owner-browser observations, not server-verified outcomes: ';
          const observedContext = JSON.parse(body.situation.workContext.split(marker).at(-1));
          if (body.situation.performer?.id !== owner.subjectDid || body.situation.performer?.kind !== 'human'
            || body.situation.modalStatus !== 'Hypothetical' || body.situation.observed !== observed || body.situation.competency !== goal + '\n' + context
            || observedContext.observationLevel !== 'owner-browser' || !body.situation.id.startsWith('urn:hallowmarch:consultation:')) throw Error('synthetic request mismatch');
          const metrics = {};
          for (const key of ['healthPercent','level','creatureDefeats','deaths','activePlaySeconds','nearbyHostiles','ownedCompanions']) {
            const value = observedContext.metrics[key]; if (!Number.isFinite(value) || value < 0 || value > 1e9) throw Error('observation mismatch'); metrics[key] = value;
          }
          window.__hmNativeHumanConsultingQa = { taskId: decodeURIComponent(body.situation.id.slice('urn:hallowmarch:consultation:'.length)),
            situationId: body.situation.id, observedContext, goal, observed, desired, context };
          return metrics;
        }, { goal, observed, desired, context, owner });
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'retain' });
        await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'share' });
        // One real click only. Lost delivery is never an automatic resend.
        await checkpoint({ kind: 'coaching-delivery-intent' });
        requestClicked = true; step = 'request-once'; await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'request' });
      }
      step = 'private-plan-confirmation';
      await page.waitForFunction(() => window.__hm.consulting.status.hasPrivatePlan && !window.__hm.consulting.status.busy, null, { timeout: 240000 });
      check(await page.locator('#march-consulting-result').isVisible(), 'qa_human_plan_display');
      check(await page.locator('#march-consulting-result a').filter({ hasText: 'Source: live Foxxi support service' }).isVisible(), 'qa_human_plan_attribution');
      step = 'native-private-readback';
      const result = await page.evaluate(readHumanConsultingPlan, { owner, relayOrigin, gameOrigin });
      Object.assign(flags, result);
      check(Object.values(flags).every(value => value === true), 'qa_human_private_readback'); complete = true; step = 'complete';
      console.log(JSON.stringify({ kind: 'human_consulting_qa', step, complete, metrics, ...flags }));
  }
  return Object.freeze({ status: () => ({ kind: 'human_consulting_qa', step, opened, reviewClicked, requestClicked, complete, busy: !!flight, metrics, ...flags }),
    run() {
      if (flight) return flight;
      const next = Promise.resolve().then(runOnce); flight = next;
      const clear = () => { if (flight === next) flight = null; };
      void next.then(clear, clear); return next;
    },
  });
}

/** Pin the original QA owner in-page; credentials never leave that page. */
export async function guardHumanConsultingOwner({ owner, gameOrigin, initialize = false, action = 'check' }) {
  const fail = () => { throw Object.assign(Error('The original consulting QA owner or preview changed.'), { code: 'qa_human_owner_changed' }); };
  let pinned = window.__hmNativeHumanConsultingOwner;
  if (!pinned) {
    if (!initialize) fail();
    const game = window.__hm, transport = game?.net?.NETWS;
    // Capture before this function's first await or any UI action.
    pinned = { game, transport, token: transport?.token, generation: transport?.generation, gameOrigin,
      accountId: owner.accountId, subjectDid: owner.subjectDid, podUrl: owner.podUrl, binding: null };
    window.__hmNativeHumanConsultingOwner = pinned;
  }
  const current = () => {
    const game = window.__hm, transport = game?.net?.NETWS;
    if (window.__hmNativeHumanConsultingOwner !== pinned || location.origin !== gameOrigin || pinned.gameOrigin !== gameOrigin
      || pinned.accountId !== owner.accountId || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl
      || game !== pinned.game || transport !== pinned.transport || !game?.GAME?.started || !game?.SAVE?.native
      || !pinned.token || transport?.token !== pinned.token || transport.generation !== pinned.generation || transport.reload
      || transport.acct?.id !== owner.accountId || !transport.acct.nativeBound
      || localStorage.getItem('hallowmarch.token.' + location.host) !== pinned.token) fail();
  };
  current();
  const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000),
    headers: { Authorization: 'Bearer ' + pinned.token } });
  current(); if (!response.ok) fail(); const status = await response.json(); current();
  const binding = status.binding;
  if (!status.bound || !status.verified || status.account?.id !== owner.accountId || binding?.subjectDid !== owner.subjectDid
    || binding.podUrl !== owner.podUrl || !binding.authenticatedAgentDid) fail();
  if (pinned.binding && (pinned.binding.subjectDid !== binding.subjectDid || pinned.binding.podUrl !== binding.podUrl
    || pinned.binding.authenticatedAgentDid !== binding.authenticatedAgentDid)) fail();
  if (!pinned.binding) pinned.binding = { subjectDid: binding.subjectDid, podUrl: binding.podUrl, authenticatedAgentDid: binding.authenticatedAgentDid };
  if (['preview', 'retain', 'share', 'request'].includes(action)) {
    const body = JSON.parse(document.querySelector('#march-consulting-preview pre').textContent), memo = window.__hmNativeHumanConsultingQa;
    if (body.situation?.performer?.id !== owner.subjectDid || body.situation.performer.kind !== 'human') fail();
    if (action !== 'preview' && (!memo || body.situation.id !== memo.situationId || body.situation.observed !== memo.observed
      || body.situation.competency !== memo.goal + '\n' + memo.context || body.situation.modalStatus !== 'Hypothetical')) fail();
  }
  const ids = { connect: 'march-consulting-connect', review: 'march-consulting-review', retain: 'march-consulting-retain', share: 'march-consulting-share', request: 'march-consulting-request' };
  if (Object.hasOwn(ids, action)) {
    const control = document.getElementById(ids[action]); if (!control || control.disabled || control.hidden) fail();
    // Pin check and the real DOM click share one browser turn. Product guards
    // take over for asynchronous work after its original owner's click.
    current();
    if (action === 'retain' || action === 'share') { if (control.type !== 'checkbox') fail(); if (!control.checked) control.click(); }
    else control.click();
  } else if (!['check', 'preview'].includes(action)) fail();
  return true;
}

/** Self-contained browser readback; supplied modules are offline-test fixtures only. */
export async function readHumanConsultingPlan({ owner, relayOrigin, gameOrigin }, suppliedModules) {
  const memo = window.__hmNativeHumanConsultingQa;
  const game = window.__hm, transport = game?.net?.NETWS, app = transport?.token, generation = transport?.generation;
  const pinned = window.__hmNativeHumanConsultingOwner;
  const current = () => {
    if (!memo || !app || location.origin !== gameOrigin || window.__hm !== game || !game?.GAME?.started || !game?.SAVE?.native
      || transport !== game.net?.NETWS || transport.acct?.id !== owner.accountId || !transport.acct.nativeBound
      || transport.token !== app || transport.generation !== generation || transport.reload
      || localStorage.getItem('hallowmarch.token.' + location.host) !== app
      || !pinned?.binding || window.__hmNativeHumanConsultingOwner !== pinned || pinned.game !== game || pinned.transport !== transport
      || pinned.token !== app || pinned.generation !== generation || pinned.gameOrigin !== gameOrigin || pinned.accountId !== owner.accountId
      || pinned.subjectDid !== owner.subjectDid || pinned.podUrl !== owner.podUrl) {
      throw Object.assign(Error('The original consulting owner changed.'), { code: 'qa_human_owner_changed' });
    }
  };
  current();
  const displayed = JSON.parse(document.querySelector('#march-consulting-result').dataset.resultKey);
  const [{ createBrowserAccessCache }, { createOwnerPerformanceConsultation }, live] = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/performance-consultation.mjs'), import('/gaming/identity/assets/foxxi-consulting.mjs'),
  ]);
  const verifyBinding = async () => {
    current();
    const response = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', headers: { Authorization: 'Bearer ' + app } });
    current(); if (!response.ok) throw Error('status unavailable'); const status = await response.json(); current();
    if (!status.verified || !status.bound || status.account?.id !== owner.accountId || status.binding?.subjectDid !== owner.subjectDid
      || status.binding.podUrl !== owner.podUrl || status.binding.authenticatedAgentDid !== pinned.binding.authenticatedAgentDid) {
      throw Object.assign(Error('The original consulting binding changed.'), { code: 'qa_human_owner_changed' });
    }
    return status;
  };
  const status = await verifyBinding();
  const cache = createBrowserAccessCache(); let journal;
  try {
    const held = await cache.get({ ownerDid: owner.subjectDid, podUrl: owner.podUrl, relayUrl: relayOrigin });
    current();
    if (!held?.credential || held.credential.refreshToken) throw Error('grant unavailable');
    journal = createOwnerPerformanceConsultation({ binding: status.binding, credential: held.credential, relayUrl: relayOrigin, sessionId: crypto.randomUUID() });
    await journal.connect(); current(); const history = await journal.read(); current();
    const confirmed = await verifyBinding();
    if (confirmed.binding.authenticatedAgentDid !== status.binding.authenticatedAgentDid) {
      throw Object.assign(Error('The original consulting delegate changed.'), { code: 'qa_human_owner_changed' });
    }
    const observations = history.observations.filter(item => item.task.id === memo.taskId);
    if (observations.length !== 1) throw Error('observation ambiguous'); const observation = observations[0];
    const consultations = history.consultations.filter(item => item.observationId === observation.id);
    if (consultations.length !== 1) throw Error('consultation ambiguous'); const consultation = consultations[0];
    const exactObservation = observation.ownerDid === owner.subjectDid && observation.performerKind === 'human'
      && observation.task.observedResult === memo.observed && observation.task.desiredResult === memo.desired
      && observation.task.workContext === memo.goal + '\n' + memo.context && observation.evidence.length === 1
      && observation.evidence[0].kind === 'owner-browser-observation' && observation.evidence[0].performerDid === owner.subjectDid
      && observation.evidence[0].at === memo.observedContext.capturedAt
      && JSON.stringify(observation.evidence[0].metrics) === JSON.stringify(memo.observedContext.metrics);
    const attributedLiveResponse = displayed.source?.descriptorUrl === live.FOXXI_PLANNER_DESCRIPTOR
      && displayed.service?.action === live.FOXXI_PLANNER_ACTION && displayed.source.performerDid === owner.subjectDid
      && displayed.source.performerKind === 'human' && displayed.source.signatureAuthority === 'relay-delegated'
      && displayed.response?.classifiedBy === status.binding.authenticatedAgentDid
      && displayed.response?.diagnosis?.situationId === memo.situationId && displayed.response?.plan?.situationId === memo.situationId;
    const exactPrivatePlan = consultation.ownerDid === owner.subjectDid && JSON.stringify(consultation.response) === JSON.stringify(displayed)
      && JSON.stringify(consultation.service) === JSON.stringify(displayed.service);
    const noAchievementClaims = observation.competencyStatus === 'not-assessed' && consultation.competencyStatus === 'not-assessed'
      && consultation.epistemicStatus === 'service-response-unvalidated-effect'
      && displayed.foxxiPersonalRecordCreated === false && Array.isArray(displayed.competencyClaims) && displayed.competencyClaims.length === 0;
    const singleDeliveryAttempt = window.__hmNativeHumanConsultingTrace?.deliveryAttempts === 1;
    return { exactObservation, attributedLiveResponse, exactPrivatePlan, noAchievementClaims, singleDeliveryAttempt };
  } finally {
    journal?.close(); await cache.close();
    const trace = window.__hmNativeHumanConsultingTrace;
    if (trace && globalThis.fetch === trace.observed) globalThis.fetch = trace.prior;
    // Keep only this observer/counter in the same page until context
    // cleanup. A failed private readback must not erase proof of the
    // original delivery attempt or permit a second delivery.
    current();
  }
}
