/** Opt-in QA of actual future gameplay delivery. No import-time I/O, fabricated
 * activity, clock changes, identity/key creation or automatic delivery retry. */
import { guardHumanConsultingOwner } from './human-consulting-live.mjs';

export function createPersonalActivityLiveQa({ getPage, getOwner, relayOrigin, gameOrigin, checkpoint } = {}) {
  const origin = value => { try { const u = new URL(value); return u.protocol === 'https:' && u.origin === value; } catch { return false; } };
  if (typeof getPage !== 'function' || typeof getOwner !== 'function' || typeof checkpoint !== 'function'
    || !origin(gameOrigin) || !origin(relayOrigin) || gameOrigin === relayOrigin) throw new TypeError('Explicit retained personal activity QA ports are required.');
  let step = 'not-started', opened = false, enabled = false, inputAttempted = false, stopped = false, complete = false, flight = null;
  const flags = { genuineHumanOutcome: false, futureActivityOnly: false, intentConfirmedBeforeDelivery: false,
    exactPrivateCheckpoint: false, verifiedNativeDigest: false, exactPrivateLrsReadback: false,
    boundedExactConsent: false, sharingStopped: false, noAutomaticResend: false, noAchievementClaims: false };
  const ensure = (ok, code) => { if (!ok) throw Object.assign(new Error('Personal activity live verification refused.'), { code }); };
  const show = async page => {
    if (!await page.locator('#menu').isVisible()) await page.locator('#btn-menu').click();
    await page.locator('#menu-tabs [data-tab="chronicle"]').click();
    await page.locator('.chron-nav [data-grp="you"]').click();
    await page.locator('.chron-nav [data-sec="coach"]').click();
    if (await page.locator('#march-coach-options').getAttribute('open') === null) await page.locator('#march-coach-options > summary').click();
    await page.locator('#march-learning-record').waitFor({ state: 'visible', timeout: 15000 });
  };
  async function runOnce() {
    if (complete) return status();
    const page = getPage(), owner = getOwner();
    ensure(page && !page.isClosed() && owner?.accountId && owner.subjectDid && owner.podUrl, 'qa_activity_owner');
    await page.evaluate(guardHumanConsultingOwner, { owner, gameOrigin, action: 'check' });
    try {
      if (!opened) {
        step = 'activity-disclosure'; await show(page);
        await page.evaluate(installPersonalActivityObserver, { owner, relayOrigin, gameOrigin }); opened = true;
      }
      if (!enabled) {
        await checkpoint({ kind: 'activity-delivery-intent' });
        enabled = true; step = 'activity-enable-once';
        await page.evaluate(personalActivityControl, { action: 'enable', owner, gameOrigin });
      }
      if (!inputAttempted) {
        await page.waitForFunction(() => window.__hm?.learningDelivery?.status.enabled && !window.__hm.learningDelivery.status.busy,
          null, { timeout: 180000 });
        await checkpoint({ kind: 'activity-input-intent' });
        await page.locator('#btn-resume').click(); await page.bringToFront();
        await page.evaluate(personalActivityControl, { action: 'input', owner, gameOrigin });
        inputAttempted = true; step = 'activity-one-genuine-input'; await page.keyboard.press('1');
      }
      step = 'activity-real-outcome';
      await page.waitForFunction(() => {
        const t = window.__hmNativePersonalActivityTrace, h = window.__hm;
        const body = h.activity.snapshot()?.summary?.bodyObservations?.find(item => item.bodyId === t.owner.accountId && item.kind === 'character');
        return (body?.counters?.['ability.executed'] || 0) > t.before.executed || (body?.counters?.['ability.refused'] || 0) > t.before.refused;
      }, null, { timeout: 15000 });
      await show(page);
      step = 'activity-private-acknowledgment';
      await page.waitForFunction(() => {
        const t = window.__hmNativePersonalActivityTrace, s = window.__hm.learningDelivery.status;
        if (t.ambiguous || t.writes > 1) throw Error('Unexpected activity delivery.');
        return t.writes === 1 && !!t.memo && !s.busy && !s.pending && s.acknowledgedCount >= t.memo.events.length;
      }, null, { timeout: 180000 });
    } finally {
      if (enabled && !stopped && !page.isClosed()) {
        step = 'activity-stop-once'; await show(page);
        await page.evaluate(personalActivityControl, { action: 'stop', owner, gameOrigin }); stopped = true;
      }
    }
    step = 'activity-independent-native-readback';
    const deadline = Date.now() + 180000;
    do {
      const result = await page.evaluate(readPersonalActivityProof, { owner, relayOrigin, gameOrigin });
      Object.assign(flags, result);
      if (flags.sharingStopped) break;
      await page.waitForTimeout(1000);
    } while (Date.now() < deadline);
    ensure(Object.entries(flags).filter(([key]) => key !== 'noAutomaticResend').every(([, value]) => value === true), 'qa_activity_readback');
    step = 'activity-stopped-real-wait';
    while (!(await page.evaluate(personalActivityControl, { action: 'stopped', owner, gameOrigin })).ready) {
      await page.waitForTimeout(1000);
    }
    flags.noAutomaticResend = true;
    await page.evaluate(disposePersonalActivityObserver); complete = true; step = 'complete'; return status();
  }
  const status = () => ({ kind: 'personal_activity_qa', step, opened, enabled, inputAttempted, stopped, complete, busy: !!flight, ...flags });
  return Object.freeze({ status, run() {
    if (flight) return flight;
    const next = Promise.resolve().then(runOnce).catch(error => { throw Object.assign(new Error('Personal activity live verification failed.'), {
      code: /^qa_activity_[a-z_]{1,64}$/.test(error?.code || '') ? error.code : 'qa_activity_stage_failed' }); });
    flight = next; const clear = () => { if (flight === next) flight = null; }; void next.then(clear, clear); return next;
  } });
}

/** Captures only actual logical xAPI content and its already-confirmed private
 * marker in this page. Native bearers/signatures never enter the trace. */
export function installPersonalActivityObserver({ owner, relayOrigin, gameOrigin }) {
  const fail = () => { throw Object.assign(Error('Personal activity observer refused.'), { code: 'qa_activity_observer' }); };
  const h = window.__hm, p = window.__hmNativeHumanConsultingOwner;
  if (window.__hmNativePersonalActivityTrace || location.origin !== gameOrigin || !p || p.game !== h
    || p.accountId !== owner.accountId || p.subjectDid !== owner.subjectDid || p.podUrl !== owner.podUrl
    || !h?.learningDelivery || h.learningDelivery.status.enabled || h.learningDelivery.status.pending || h.learningDelivery.status.busy
    || !h.SAVE.native || !h.SAVE.readConfirmed || h.SAVE.pending || h.SAVE.nativeFlight || h.consulting.status.enabled) fail();
  const disclosure = document.getElementById('march-learning-record')?.textContent || '';
  if (!disclosure.includes('15 minutes') || !disclosure.includes('own pod') || !disclosure.includes('Chat') || !disclosure.includes('inventory')) fail();
  const saved = h.activity.snapshot(), gameplaySessionId = saved?.history?.recent?.at(-1)?.sessionId;
  if (!Number.isSafeInteger(saved?.eventCount) || !gameplaySessionId) fail();
  const trace = { owner, gameOrigin, relayOrigin, prior: globalThis.fetch, observed: null, writes: 0, ambiguous: false,
    memo: null, enabled: false, inputAttempted: false, stopped: false, startOrdinal: saved.eventCount, gameplaySessionId,
    pinned: p, before: null };
  trace.observed = function (...args) {
    try {
      const u = new URL(typeof args[0]?.url === 'string' ? args[0].url : String(args[0]), location.href);
      const rpc = typeof args[1]?.body === 'string' ? JSON.parse(args[1].body) : null, input = rpc?.params?.arguments;
      if (u.origin === relayOrigin && rpc?.method === 'tools/call' && rpc.params.name === 'act'
        && input?.descriptor_url === 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/affordance'
        && input?.action_iri === 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/write-own-subject-xapi-statements-signed') {
        trace.writes++;
        const signed = JSON.parse(input.payload?._signed_payload || 'null'), pending = JSON.parse(h.SAVE.lastBody || 'null')?.char?.x?.learningDelivery?.pending;
        if (trace.writes !== 1 || !trace.enabled || !trace.inputAttempted || trace.stopped || !signed || !pending?.events?.length) trace.ambiguous = true;
        else trace.memo = { payload: { subject_did: signed.subject_did, purpose: signed.purpose, statements: signed.statements },
          events: JSON.parse(JSON.stringify(pending.events)), contract: JSON.parse(JSON.stringify(pending.contract)),
          signer: signed.agent_id, intentConfirmed: h.SAVE.native && h.SAVE.readConfirmed && !h.SAVE.pending && !h.SAVE.nativeFlight };
      }
    } catch { trace.ambiguous = true; }
    return Reflect.apply(trace.prior, this, args);
  };
  globalThis.fetch = trace.observed; window.__hmNativePersonalActivityTrace = trace; return true;
}

export function personalActivityControl({ action, owner, gameOrigin }) {
  const t = window.__hmNativePersonalActivityTrace, h = window.__hm, p = t?.pinned, n = h?.net?.NETWS;
  const fail = () => { throw Object.assign(Error('Personal activity control refused.'), { code: 'qa_activity_scope' }); };
  if (!t || t.ambiguous || location.origin !== gameOrigin || p !== window.__hmNativeHumanConsultingOwner || p?.game !== h
    || p.accountId !== owner.accountId || p.subjectDid !== owner.subjectDid || p.podUrl !== owner.podUrl
    || n !== p.transport || n.token !== p.token || n.generation !== p.generation || n.reload || n.acct?.id !== owner.accountId
    || !n.acct.nativeBound || !h.GAME.started || h.GAME.player !== p.player || !p.player.alive
    || !h.SAVE.native || !h.SAVE.readConfirmed) fail();
  const s = h.learningDelivery.status;
  if (action === 'enable') {
    const control = document.getElementById('march-learning-enable');
    if (t.enabled || t.writes || s.enabled || s.pending || s.busy || !control || control.disabled || control.hidden) fail();
    t.enabled = true; control.click();
  } else if (action === 'input') {
    const active = document.activeElement;
    if (!t.enabled || t.inputAttempted || t.writes || !s.enabled || s.busy || document.hidden || !document.hasFocus()
      || !document.getElementById('menu')?.hidden || h.UI?.modal || h.GAME.t <= p.player.combatUntil
      || ['INPUT', 'TEXTAREA', 'SELECT'].includes(active?.tagName) || active?.isContentEditable) fail();
    const body = h.activity.snapshot()?.summary?.bodyObservations?.find(item => item.bodyId === owner.accountId && item.kind === 'character');
    t.before = { executed: body?.counters?.['ability.executed'] || 0, refused: body?.counters?.['ability.refused'] || 0 }; t.inputAttempted = true;
  } else if (action === 'stop') {
    const control = document.getElementById('march-learning-stop');
    if (t.stopped) fail(); t.stopped = true; t.stoppedAt = performance.now();
    if (s.enabled || s.busy) { if (!control || control.disabled || control.hidden) fail(); control.click(); }
  } else if (action === 'stopped') {
    if (!t.stopped || s.enabled || s.busy || t.writes !== 1) fail();
    return { ready: Number.isFinite(t.stoppedAt) && performance.now() - t.stoppedAt >= 35000 };
  } else fail();
  return true;
}

/** Independent native character/journal and private LRS reads. Captured content,
 * native credentials and exact statement IDs remain exclusively in this page. */
export async function readPersonalActivityProof({ owner, relayOrigin, gameOrigin }, suppliedModules) {
  const t = window.__hmNativePersonalActivityTrace, h = window.__hm, p = t?.pinned;
  const fail = () => { throw Object.assign(Error('Personal activity readback refused.'), { code: 'qa_activity_readback' }); };
  const same = (a, b) => {
    const c = x => Array.isArray(x) ? '[' + x.map(c).join(',') + ']' : x && typeof x === 'object'
      ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + c(x[k])).join(',') + '}' : JSON.stringify(x);
    return c(a) === c(b);
  };
  const current = () => {
    if (!t?.memo || t.ambiguous || t.writes !== 1 || !t.stopped || location.origin !== gameOrigin
      || window.__hm !== h || p !== window.__hmNativeHumanConsultingOwner || p?.game !== h
      || p.accountId !== owner.accountId || p.subjectDid !== owner.subjectDid || p.podUrl !== owner.podUrl
      || h.net.NETWS !== p.transport || h.net.NETWS.token !== p.token || h.net.NETWS.generation !== p.generation
      || h.net.NETWS.reload || !h.GAME.started || h.GAME.player !== p.player
      || !h.SAVE.native || !h.SAVE.readConfirmed || h.learningDelivery.status.enabled) fail();
  };
  current();
  const [cacheModule, nativeModule, profileModule, journalModule, activityModule, transportModule] = suppliedModules || await Promise.all([
    import('/gaming/identity/assets/access-cache.mjs'), import('/gaming/identity/assets/client.mjs'),
    import('/gaming/identity/assets/profile.mjs'), import('/gaming/identity/assets/performance-consultation.mjs'),
    import('/gaming/identity/assets/gameplay-activity.mjs'), import('/gaming/identity/assets/vendor/interego-browser.mjs'),
  ]); current();
  const cache = cacheModule.createBrowserAccessCache(), clients = []; let journal, tx;
  try {
    const bindingResponse = await fetch('/gaming/identity/status', { cache: 'no-store', redirect: 'error', signal: AbortSignal.timeout(18000), headers: { Authorization: 'Bearer ' + p.token } });
    current(); if (!bindingResponse.ok) fail(); const bindingStatus = await bindingResponse.json(); current();
    const binding = bindingStatus.binding;
    if (!bindingStatus.bound || !bindingStatus.verified || bindingStatus.account?.id !== owner.accountId || binding.subjectDid !== owner.subjectDid
      || binding.podUrl !== owner.podUrl || binding.authenticatedAgentDid !== p.binding.authenticatedAgentDid) fail();
    const held = await cache.get({ relayUrl: relayOrigin, ownerDid: owner.subjectDid, podUrl: owner.podUrl }); current();
    if (!held?.credential || held.credential.refreshToken || held.expiresAt <= Date.now()) fail();
    const readOnlyNative = options => {
      const nativeTx = new transportModule.RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
      const allowed = new Set(['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph']);
      const native = nativeModule.createNativePodClient({ ...options, transport: { connect: (...args) => nativeTx.connect(...args),
        setCredential: value => nativeTx.setCredential?.(value), callTool(name, args, options) { if (!allowed.has(name)) fail(); return nativeTx.callTool(name, args, options); } } });
      clients.push(native); return native;
    };
    const native = readOnlyNative({ ownerDid: owner.subjectDid, podUrl: owner.podUrl, credential: held.credential, relayUrl: relayOrigin });
    await native.connect(); current();
    const indexIri = await profileModule.playerProfileIndexGraphIri(owner.subjectDid), index = await native.load({ graphIri: indexIri }); current();
    const characterIri = profileModule.validatePlayerProfileIndex(index.record, owner.subjectDid);
    const opened = await native.load({ graphIri: characterIri }); current(); const after = await native.currentHead({ graphIri: characterIri }); current();
    // A normal owner save may advance this graph between the two reads. Only
    // that known read race may poll again; it never authorizes another input or
    // external write and does not turn substituted content into a valid proof.
    if (opened?.head && !same(opened.head, after)) return { sharingStopped: false };
    const saved = opened?.record?.save?.char?.x, state = saved?.learningDelivery, events = t.memo.events;
    const body = h.activity.snapshot()?.summary?.bodyObservations?.find(item => item.bodyId === owner.accountId && item.kind === 'character');
    const changed = !!t.inputAttempted && !!t.before && ((body?.counters?.['ability.executed'] || 0) > t.before.executed
      || (body?.counters?.['ability.refused'] || 0) > t.before.refused);
    // The product may truthfully leave controller attribution unknown. The QA
    // key and body delta prove this input without rewriting its xAPI context.
    const genuineHumanOutcome = changed && events.some(event => event.body?.id === owner.accountId && event.body.kind === 'character'
      && ['human-input', 'unattributed'].includes(event.actor?.kind) && ['ability.executed', 'ability.refused'].includes(event.type));
    const expected = events.map(event => activityModule.gameplayActivityStatement(event, owner.subjectDid));
    const futureActivityOnly = events.every(event => event.ordinal > t.startOrdinal && event.sessionId === t.gameplaySessionId);
    const exactPrivateCheckpoint = !!state && state.ownerDid === owner.subjectDid && state.characterId === owner.accountId
      && state.pending === null && state.throughOrdinal >= events.at(-1).ordinal && state.acknowledgedCount >= events.length
      && same(t.memo.payload.statements, expected) && t.memo.payload.subject_did === owner.subjectDid && t.memo.payload.purpose === 'personal-performance';
    const verifiedNativeDigest = !!opened && /^graph-nquads-sha256:[0-9a-f]{64}$/.test(opened.digest)
      && opened.record.ownerDid === owner.subjectDid && same(opened.head, after);
    journal = journalModule.createOwnerPerformanceConsultation({ binding, credential: held.credential, relayUrl: relayOrigin,
      sessionId: crypto.randomUUID(), createClient: readOnlyNative });
    await journal.connect(); current(); const history = await journal.read(); current();
    const scopes = history.consents.filter(item => item.purpose === 'record-gameplay-activity' && item.recipient === t.memo.contract.write.target);
    const consent = scopes.length === 1 ? scopes[0] : null;
    const boundedExactConsent = !!consent && history.ownerDid === owner.subjectDid && consent.taskId === 'hallowmarch-activity:' + state?.characterId + ':' + consent.sessionId
      && Date.parse(consent.expiresAt) > Date.parse(consent.issuedAt) && Date.parse(consent.expiresAt) - Date.parse(consent.issuedAt) <= 900000;
    if (!consent?.revoked) return { genuineHumanOutcome, futureActivityOnly, intentConfirmedBeforeDelivery: t.memo.intentConfirmed,
      exactPrivateCheckpoint, verifiedNativeDigest, exactPrivateLrsReadback: false, boundedExactConsent, sharingStopped: false, noAchievementClaims: false };
    tx = new transportModule.RelayMcpTransport(relayOrigin, { ...held.credential }, globalThis.fetch.bind(globalThis));
    await tx.connect(['get_pod_status', 'dereference', 'sign_request', 'act'], 'get_pod_status'); current();
    const status = await tx.callTool('get_pod_status', {}, { cache: false }); current();
    if (status.identity?.did !== owner.subjectDid || status.sessionAgent?.did !== binding.authenticatedAgentDid) fail();
    const descriptor = await tx.callTool('dereference', { iri: t.memo.contract.descriptorUrl }, { cache: false }); current();
    const reads = descriptor.affordances?.filter(item => item.action === t.memo.contract.read.action);
    if (descriptor.status !== 'ok' || reads?.length !== 1 || reads[0].method !== 'POST' || reads[0].target !== t.memo.contract.read.target) fail();
    let exactPrivateLrsReadback = true;
    for (const statement of expected) {
      const query = { subject_did: owner.subjectDid, purpose: 'personal-performance', query: { statementId: statement.id } };
      const signed = await tx.callTool('sign_request', { payload: query }, { cache: false }); current();
      const stamp = JSON.parse(signed?._signed_payload || 'null');
      if (!signed?._signature || stamp?.agent_id !== binding.authenticatedAgentDid
        || ![owner.podUrl, status.pod].includes(stamp.subject_pod_url) || Math.abs(Date.now() - Date.parse(stamp.timestamp)) > 60000
        || !Number.isFinite(Date.parse(stamp.timestamp))
        || !same(Object.fromEntries(Object.entries(stamp).filter(([key]) => !['agent_id', 'subject_pod_url', 'timestamp'].includes(key))), query)) fail();
      const response = await tx.callTool('act', { descriptor_url: t.memo.contract.descriptorUrl, action_iri: t.memo.contract.read.action, payload: signed }, { cache: false }); current();
      if (typeof response.body === 'string' && new TextEncoder().encode(response.body).length > 128 * 1024) fail();
      const body = typeof response.body === 'string' ? JSON.parse(response.body) : response.body;
      if (response.status !== 200 || body?.ok !== true || body.durable !== true || body.subjectDid !== owner.subjectDid || !body.statement) { exactPrivateLrsReadback = false; break; }
      const { authority, stored, version, ...actual } = body.statement;
      if (!same(actual, statement) || !authority || !Number.isFinite(Date.parse(stored))) exactPrivateLrsReadback = false;
    }
    const noAchievementClaims = expected.every(statement => statement.result?.extensions?.['urn:interego:gaming:activity:observation']?.competencyStatus === 'not-assessed'
      && statement.result.extensions['urn:interego:gaming:activity:observation'].authority === 'owner-browser-observation');
    return { genuineHumanOutcome, futureActivityOnly, intentConfirmedBeforeDelivery: t.memo.intentConfirmed === true,
      exactPrivateCheckpoint, verifiedNativeDigest, exactPrivateLrsReadback, boundedExactConsent,
      sharingStopped: boundedExactConsent && consent.revoked === true && !h.learningDelivery.status.enabled,
      noAchievementClaims };
  } finally {
    journal?.close(); for (const native of clients) native.close(); tx?.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, expiresAt: Date.now() });
    await cache.close(); current();
  }
}

export function disposePersonalActivityObserver() {
  const t = window.__hmNativePersonalActivityTrace;
  if (t && globalThis.fetch === t.observed) globalThis.fetch = t.prior;
  return true;
}
