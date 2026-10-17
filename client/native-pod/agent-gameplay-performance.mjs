/** Optional trusted-host performance composition. No import-time I/O or consent.
 * Only actual public companion observations and applied-input acknowledgments
 * enter this agent's own native pod. Gameplay never depends on capture success. */
import { createGameplayActivityProfile, validateGameplayActivityEvent } from './gameplay-activity.mjs';
import { validateWorldAgentConnection } from '../world-agent-mcp.mjs';

const MODE = 'hallowmarch-performance-consultation/v1';
const SCHEMA = 'hallowmarch.agent-gameplay-performance/v1';
const LIFETIME = 900000, FLUSH_MS = 30000, WINDOW_MS = 5000, MAX_DETAIL = 64;
const copy = value => structuredClone(value);
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : value && typeof value === 'object' ? '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}' : JSON.stringify(value);
const fail = code => { throw Object.assign(new Error('Agent performance support needs explicit host confirmation.'), { code }); };
const safeCode = error => /^[a-z][a-z0-9_]{0,63}$/.test(error?.code || '') ? error.code : 'agent_performance_unconfirmed';

export function createAgentGameplayPerformance({ ownSession, keyStorage, connection, authorizeSession,
  crypto = globalThis.crypto, now = Date.now,
  timers = { setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout } } = {}) {
  const config = validateWorldAgentConnection(connection);
  if (!ownSession || typeof ownSession.verify !== 'function' || typeof ownSession.createLearningDelivery !== 'function'
    || typeof authorizeSession !== 'function' || !keyStorage || !crypto?.subtle || !crypto.randomUUID) throw TypeError('Verified agent own-session, durable key storage and explicit host policy required.');
  let epoch = 0, enabledUntil = 0, captureReady = false, closed = false, busy = false, code = null, binding, graphIri, raw, head = null, refreshRequired = false;
  let record = null, pendingRecord = null, pendingOperation = null, profile, journal, consultant, delivery, journalClosed = false, knownAdvice = null;
  let sessionId, inputs = 0, observations = 0, coachCount = 0, lastCoachAt = 0, consentUnconfirmed = false;
  let grants = [], queue = Promise.resolve(), stopFlight = null, queued = 0;
  let live = null, aggregates = new Map(), eventBuffer = [], profileStamp = null, timer = null, flushFlight = null;
  let flushWindow = -1, batchesUsed = 0, privateSaveUsed = false, exportPaused = false;
  let deliveryStartOrdinal = 0;
  const captureTickets = new WeakMap();
  const context = { origin: config.origin, applicationId: config.applicationId, agentDid: config.agentDid, entityId: config.entityId, roomId: config.roomId };
  const inputTotal = value => (value?.legacy || 0) + (value?.move || 0) + (value?.attack || 0);
  const quantity = events => events.reduce((sum, event) => sum + (event.result.quantity || 0), 0);
  function initializeLive() {
    live = { acceptedCounts: copy(record.acceptedCounts || { legacy: record.activity?.quantities?.['agent.command-accepted']
      || record.activity?.counters?.['agent.command-accepted'] || 0, move: 0, attack: 0 }),
      observationCount: record.observationCount, unknownCommands: record.unknownCommands, lastObservation: record.lastObservation,
      captureRevision: record.captureRevision || 0, exportGapInputs: record.exportGapInputs || 0 };
  }
  function snapshot(overrides = {}) {
    return { ...record, ...copy(live), activity: profile.save(), queuedEvents: copy(eventBuffer),
      queuedAggregates: copy([...aggregates.values()]), exportPaused, ...overrides };
  }
  function makeProfile(state) {
    return createGameplayActivityProfile({ ownerDid: binding.subjectDid, characterId: config.entityId, sessionId,
      state, now: () => profileStamp ?? now(), uuid: () => crypto.randomUUID() });
  }
  function makeDelivery(selected, state) {
    return ownSession.createLearningDelivery({ sessionId, journal, gameplaySessionId: sessionId, characterId: config.entityId,
      startAfterOrdinal: deliveryStartOrdinal, state, assertCurrent: () => { check(selected); return true; },
      commitState: next => persist(snapshot({ delivery: next,
        queuedEvents: eventBuffer.filter(event => event.ordinal > next.throughOrdinal) }), selected) });
  }
  function dirty() { return !!live && live.captureRevision > (record?.captureRevision || 0); }
  function cancelTimer() { if (timer !== null) timers.clearTimeout(timer); timer = null; }
  function scheduleFlush() {
    cancelTimer();
    if (!status().enabled) return;
    const selected = epoch;
    timer = timers.setTimeout(() => {
      timer = null;
      if (selected !== epoch || !status().enabled) return;
      void queueFlush().catch(() => {}).finally(() => { if (selected === epoch) scheduleFlush(); });
    }, FLUSH_MS);
    timer?.unref?.();
  }
  const serialize = run => {
    if (queued >= 16) return Promise.reject(Object.assign(new Error('Agent performance queue is full.'), { code: 'agent_performance_busy' }));
    queued++;
    const task = queue.then(async () => { busy = true; try { return await run(); }
      catch (error) { code = safeCode(error); throw error; } finally { busy = false; } });
    queue = task.catch(() => {}); return task.finally(() => { queued--; });
  };
  function check(selected, active = true) {
    if (closed || selected !== epoch || active && enabledUntil <= now()) fail('agent_performance_stopped');
  }
  async function verify(selected) {
    try {
      const actual = await ownSession.verify(); check(selected, false);
      if (!actual?.subjectDid || actual.authenticatedAgentDid !== config.agentDid || !ownSession.status().separateFromPlayer
        || binding && canonical(actual) !== canonical(binding)) fail('agent_performance_identity_changed');
      binding = actual; return actual;
    } catch (error) { if (selected === epoch) { captureReady = false; cancelTimer(); } throw error; }
  }
  function validate(value) {
    const integer = number => Number.isSafeInteger(number) && number >= 0;
    if (value?.schema !== SCHEMA || value.ownerDid !== binding.subjectDid || canonical(value.scope) !== canonical(context)
      || new TextEncoder().encode(JSON.stringify(value)).length > 196608
      || !Number.isSafeInteger(value.observationCount) || value.observationCount < 0
      || !Number.isSafeInteger(value.unknownCommands) || value.unknownCommands < 0) fail('agent_performance_scope_changed');
    for (const key of ['captureRevision', 'exportGapInputs', 'closedUnconfirmedConsultations']) if (value[key] !== undefined && !integer(value[key])) fail('agent_performance_state_invalid');
    if (value.acceptedCounts !== undefined && (!value.acceptedCounts || Object.keys(value.acceptedCounts).length !== 3
      || !['legacy', 'move', 'attack'].every(key => integer(value.acceptedCounts[key])) || !integer(inputTotal(value.acceptedCounts)))) fail('agent_performance_state_invalid');
    const events = value.queuedEvents === undefined ? [] : value.queuedEvents, buckets = value.queuedAggregates === undefined ? [] : value.queuedAggregates;
    if (!Array.isArray(events) || !Array.isArray(buckets) || events.length + buckets.length > MAX_DETAIL
      || value.exportPaused !== undefined && typeof value.exportPaused !== 'boolean') fail('agent_performance_state_invalid');
    for (const event of events) {
      validateGameplayActivityEvent(event);
      if (event.type !== 'agent.command-accepted' || event.body.id !== config.entityId || event.body.kind !== 'owned-unit'
        || event.actor.kind !== 'agent' || event.actor.id !== config.agentDid) fail('agent_performance_state_invalid');
    }
    for (const bucket of buckets) if (!bucket || Object.keys(bucket).length !== 4 || !['move', 'attack'].includes(bucket.action)
      || !integer(bucket.firstAt) || !integer(bucket.lastAt) || bucket.lastAt < bucket.firstAt || Math.floor(bucket.firstAt / WINDOW_MS) !== Math.floor(bucket.lastAt / WINDOW_MS)
      || !integer(bucket.count) || bucket.count < 1 || bucket.count > 1000000000) fail('agent_performance_state_invalid');
    return { ...copy(value), closedUnconfirmedConsultations: value.closedUnconfirmedConsultations || 0 };
  }
  async function openStore(selected) {
    await verify(selected);
    if (!graphIri) {
      const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical([binding.subjectDid, context]))); check(selected, false);
      graphIri = 'urn:graph:hallowmarch:agent-performance:' + Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('');
    }
    if (!raw) { raw = ownSession.createPodProfile({ keyStorage }); const status = await raw.connect(); check(selected, false);
      if (!status.keyPresent) fail('key_required'); }
    const loaded = await raw.load({ graphIri, checkpoint: MODE }); check(selected, false);
    if (loaded) {
      if (live && head && !pendingRecord && (head.nativeRevision !== loaded.head.nativeRevision || head.recordCid !== loaded.head.recordCid)) fail('agent_performance_conflict_review');
      record = validate(loaded.record); head = loaded.head;
    }
    else { record = { schema: SCHEMA, ownerDid: binding.subjectDid, scope: context, activity: null, delivery: null,
      observationCount: 0, unknownCommands: 0, lastObservation: null, coachPending: null }; head = null; }
    if (pendingRecord && canonical(record) !== canonical(pendingRecord)) fail('agent_performance_save_pending');
    if (pendingRecord) { pendingRecord = null; pendingOperation = null; }
    refreshRequired = false;
    if (!live) initializeLive();
  }
  async function persist(next, selected, active = true) {
    check(selected, active); if (pendingRecord || refreshRequired) fail('agent_performance_save_pending');
    // Reuse/register the existing host key through the native client. This does
    // not mint a key; each fresh native client must verify its registry binding.
    await raw.registerKey(); check(selected, active);
    const exact = validate(next); pendingRecord = exact;
    let result;
    try {
      result = head ? await raw.save({ graphIri, record: exact, expectedHead: head, checkpoint: MODE })
        : await raw.createAt({ graphIri, record: exact, checkpoint: MODE });
      pendingOperation = result?.operationId || null; check(selected, active);
      if (!result?.saved) fail('agent_performance_save_pending');
      const read = await raw.load({ graphIri, checkpoint: MODE }); check(selected, active);
      if (!read || canonical(read.record) !== canonical(exact)) fail('agent_performance_save_pending');
      record = exact; head = read.head; pendingRecord = null; pendingOperation = null; return { saved: true };
    } catch (error) {
      // The checkpoint client returns an uncertain operation for a possibly
      // committed PUT. These thrown refusals occurred before a committed write.
      if (!result && ['conflict', 'record_capacity', 'checkpoint_write_budget', 'needs_reauth', 'native_unavailable', 'key_required'].includes(error?.code)
        && raw.status().pending === 0) { pendingRecord = null; pendingOperation = null; refreshRequired = true; }
      code = safeCode(error); throw error;
    }
  }
  const status = () => ({ configured: true, enabled: !closed && captureReady && enabledUntil > now(), expiresAt: captureReady ? enabledUntil || null : null,
    ownerDid: binding?.subjectDid || null, ...context, grantId: config.grantId, busy,
    acceptedInputs: inputs, observations, unknownCommands: live?.unknownCommands ?? record?.unknownCommands ?? 0,
    cumulativeAcceptedInputs: live ? inputTotal(live.acceptedCounts) : inputTotal(record?.acceptedCounts),
    durableAcceptedInputs: inputTotal(record?.acceptedCounts), unsavedCapture: dirty(),
    bufferedDetails: aggregates.size + eventBuffer.length, exportPaused,
    exportGapInputs: live?.exportGapInputs || record?.exportGapInputs || 0,
    acknowledgedActivities: delivery?.status().acknowledgedCount ?? record?.delivery?.acknowledgedCount ?? 0,
    closedUnconfirmedActivities: delivery?.status().closedUnconfirmedCount ?? record?.delivery?.closedUnconfirmedCount ?? 0,
    closedUnconfirmedConsultations: record?.closedUnconfirmedConsultations || 0,
    savePending: !!pendingRecord, saveRefreshRequired: refreshRequired, journalPending: !!journal?.status().pending,
    activityPending: !!delivery?.status().pending || !!record?.delivery?.pending,
    consultationPending: !!record?.coachPending || !!pendingRecord?.coachPending,
    hasRecoverableAdvice: !!knownAdvice,
    consentUnconfirmed, code, competencyStatus: 'not-assessed' });
  function task() {
    const observed = live.lastObservation;
    return { id: 'hallowmarch-agent:' + sessionId,
      desiredResult: 'Choose safe, useful bounded inputs for the granted party companion from fresh observations.',
      observedResult: `${inputs} accepted inputs in this session; ${observations} public observations; ${live.unknownCommands} uncertain command replies. Latest observed health ${observed ? observed.hp + '/' + observed.maxHp : 'unknown'}. Accepted input does not establish damage or achievement.`,
      workContext: 'Independent agent companion tool use in Hallowmarch. Observe the selected body, choose one input, and inspect fresh state.',
      constraints: ['Control only the granted companion.', 'Pose and health come from the owner page, not server-verified outcomes.',
        'Never replay uncertain commands. Do not infer hits, damage, mastery or causes.', 'Propose one practical next action using current tool affordances.'] };
  }
  function metrics() {
    const last = live.lastObservation;
    return last ? { healthPercent: last.maxHp ? last.hp * 100 / last.maxHp : 0, nearbyHostiles: last.nearbyHostiles } : {};
  }
  async function grant(scope, selected) {
    grants.push(scope); // A lost write acknowledgment can still mean consent committed.
    const result = await journal.grantConsent({ ...scope, accepted: true, lifetimeMs: Math.max(1, enabledUntil - now()) }); check(selected);
    if (!result.saved) fail('agent_performance_consent_pending');
  }
  async function start(invoked) {
    if (stopFlight) await stopFlight;
    check(invoked, false);
    if (closed || enabledUntil > now()) fail('agent_performance_already_started');
    if (consentUnconfirmed && grants.length) fail('agent_performance_consent_pending');
    const selected = ++epoch; code = null;
    captureReady = false; cancelTimer();
    const hadLive = !!live;
    await openStore(selected);
    if (journal?.status().pending) fail('agent_performance_reconcile_required');
    sessionId = crypto.randomUUID(); inputs = 0; observations = 0; coachCount = 0; lastCoachAt = 0;
    // A fresh consent never bulk-exports an earlier session's unsent detail.
    // Cumulative input totals remain truthful, including this process's RAM tail.
    const oldEvents = hadLive ? eventBuffer : record.queuedEvents || [];
    const oldBuckets = hadLive ? [...aggregates.values()] : record.queuedAggregates || [];
    const pendingIds = new Set(record.delivery?.pending?.events?.map(event => event.id) || []);
    live.exportGapInputs += quantity(oldEvents.filter(event => !pendingIds.has(event.id))) + oldBuckets.reduce((sum, bucket) => sum + bucket.count, 0);
    eventBuffer = copy(record.delivery?.pending?.events || []); aggregates = new Map(); exportPaused = false;
    profile = makeProfile(profile?.save() || record.activity);
    live.lastObservation = null; live.captureRevision++;
    flushWindow = -1; batchesUsed = 0; privateSaveUsed = false;
    journal = ownSession.createJournal({ sessionId, keyStorage }); journalClosed = false; await journal.connect(); check(selected, false);
    if (!journal.status().keyPresent) fail('key_required');
    consultant = ownSession.createConsultant({ sessionId, journal }); await consultant.connect(); check(selected, false);
    deliveryStartOrdinal = profile.save().eventCount;
    delivery = makeDelivery(selected, record.delivery);
    // Discovery is read-only and occurs before the host authorizes exact scopes.
    enabledUntil = now() + LIFETIME;
    try {
      await delivery.connect(); check(selected);
      const scopes = [
        { purpose: 'retain-observations', recipient: binding.podUrl, taskId: task().id },
        { purpose: 'request-consultation', recipient: consultant.status().recipient, taskId: task().id },
        { purpose: delivery.status().purpose, recipient: delivery.status().recipient, taskId: delivery.status().taskId },
        ...(record.coachPending?.taskId ? [{ purpose: 'retain-observations', recipient: binding.podUrl, taskId: record.coachPending.taskId }] : []),
      ];
      const preview = Object.freeze({ ...context, grantId: config.grantId, performerDid: binding.subjectDid, podUrl: binding.podUrl, lifetimeMs: LIFETIME,
        retentionRecipient: binding.podUrl, consultingRecipient: consultant.status().recipient,
        activityRecipient: delivery.status().recipient, consultationTaskId: task().id, activityTaskId: delivery.status().taskId,
        recoveryRetentionTaskId: record.coachPending?.taskId || null, scopes: Object.freeze(scopes.map(scope => Object.freeze(copy(scope)))) });
      enabledUntil = 0;
      const approved = await authorizeSession(preview); check(selected, false);
      if (approved !== true) fail('agent_performance_host_consent_required');
      enabledUntil = now() + LIFETIME;
      grants = []; consentUnconfirmed = false;
      for (const scope of scopes) await grant(scope, selected);
      await persist(snapshot(), selected); captureReady = true; scheduleFlush(); return status();
    } catch (error) { enabledUntil = 0; delivery?.close(); consultant?.close(); consentUnconfirmed = grants.length > 0; code = safeCode(error); throw error; }
  }
  function capture({ action, result, uncertain = false } = {}, selected) {
    try {
      check(selected);
      if (uncertain && ['move', 'attack'].includes(action)) {
        live.unknownCommands++; live.captureRevision++; return status();
      }
      if (action === 'observe') {
        const body = result?.state?.body;
        if (result?.entityId !== config.entityId || result?.roomId !== config.roomId || result?.authority !== 'owner-page-observation' || body?.id !== config.entityId
          || !Number.isSafeInteger(result.state.at) || result.state.at > now() + 5000 || result.state.at < now() - 10000
          || typeof result.state.ownerSession !== 'string' || !result.state.ownerSession || result.state.ownerSession.length > 128
          || ![body.x, body.y, body.z, body.hp, body.maxHp].every(Number.isFinite) || body.hp < 0 || body.maxHp < 1 || body.hp > body.maxHp
          || [body.x, body.y, body.z].some(value => Math.abs(value) > 4000) || body.maxHp > 10000000
          || !Array.isArray(result.state.targets) || result.state.targets.length > 24) fail('agent_performance_observation_refused');
        const previous = live.lastObservation;
        const comparable = previous && result.state.ownerSession === previous.ownerSession;
        if (comparable && result.state.at <= previous.at) fail('agent_performance_observation_order');
        if (comparable && result.state.at - previous.at < 5000) return status();
        observations++;
        const observation = { at: result.state.at, ownerSession: result.state.ownerSession, hp: body.hp, maxHp: body.maxHp,
          x: body.x, y: body.y, z: body.z, nearbyHostiles: result.state.targets.length,
          ...(comparable ? { observedDistance: Math.hypot(body.x - previous.x, body.y - previous.y, body.z - previous.z) } : {}) };
        live.observationCount++; live.lastObservation = observation; live.captureRevision++;
      } else if (['move', 'attack'].includes(action)) {
        if (result?.accepted !== true || result.execution !== 'owner-page-input-applied') fail('agent_performance_ack_refused');
        inputs++; live.acceptedCounts[action]++; live.captureRevision++;
        const stamp = now(), key = Math.floor(stamp / WINDOW_MS) + ':' + action, bucket = aggregates.get(key);
        if (exportPaused) live.exportGapInputs++;
        else if (bucket) { bucket.count++; bucket.lastAt = stamp; }
        else if (aggregates.size + eventBuffer.length >= MAX_DETAIL) { exportPaused = true; live.exportGapInputs++; code = 'agent_performance_detail_gap'; }
        else aggregates.set(key, { action, firstAt: stamp, lastAt: stamp, count: 1 });
      }
      if (!exportPaused && !pendingRecord && !refreshRequired && !delivery?.status().pending) code = null;
    } catch (error) { code = safeCode(error); }
    return status();
  }
  function sealBuckets() {
    for (const [key, bucket] of [...aggregates].sort((a, b) => a[1].lastAt - b[1].lastAt)) {
      profileStamp = bucket.lastAt;
      try {
        const event = profile.record({ type: 'agent.command-accepted', body: { id: config.entityId, kind: 'owned-unit' },
          actor: { kind: 'agent', id: config.agentDid, grantId: config.grantId },
          object: { id: `${bucket.action}:${bucket.firstAt}-${bucket.lastAt}`, kind: 'agent-command-summary' },
          result: { quantity: bucket.count, success: true }, context: { party: true } }).event;
        eventBuffer.push(event); aggregates.delete(key);
      } finally { profileStamp = null; }
    }
  }
  async function flushNow(selected, force = false) {
    check(selected);
    if (!captureReady) return status();
    if (pendingRecord || refreshRequired) { code = 'agent_performance_reconcile_required'; return status(); }
    const window = Math.floor(now() / FLUSH_MS);
    if (flushWindow !== window) { flushWindow = window; batchesUsed = 0; privateSaveUsed = false; }
    if (!force && !dirty() && !aggregates.size && !eventBuffer.length) return status();
    const canSend = !exportPaused && !delivery.status().pending && !journal.status().pending && batchesUsed < 3 && (aggregates.size || eventBuffer.length);
    if (!canSend && (!dirty() || privateSaveUsed)) return status();
    await verify(selected); check(selected);
    sealBuckets();
    let sent = false;
    if (!exportPaused && !delivery.status().pending && !journal.status().pending) {
      while (!exportPaused && eventBuffer.length && batchesUsed < 3) {
        const prepared = delivery.prepare(eventBuffer); if (!prepared) break;
        batchesUsed++; // A possibly committed send consumes its rate allowance.
        await delivery.deliver(prepared); check(selected);
        const ids = new Set(prepared.events.map(event => event.id)); eventBuffer = eventBuffer.filter(event => !ids.has(event.id)); sent = true;
      }
    }
    if (!sent && dirty() && !privateSaveUsed) { privateSaveUsed = true; await persist(snapshot(), selected); }
    if (delivery.status().pending) code = 'agent_performance_reconcile_required';
    return status();
  }
  function queueFlush(force = false) {
    if (flushFlight) return flushFlight;
    const selected = epoch;
    if (!status().enabled) return Promise.resolve(status());
    const run = serialize(() => flushNow(selected, force));
    flushFlight = run.finally(() => { flushFlight = null; }); return flushFlight;
  }
  async function coach(selected) {
    check(selected); await verify(selected); check(selected);
    if (pendingRecord || refreshRequired || record.coachPending || journal.status().pending) fail('agent_performance_reconcile_required');
    if (!observations || now() - live.lastObservation.at > 10000 || coachCount >= 6 || lastCoachAt && now() - lastCoachAt < 120000) fail('agent_performance_coach_wait');
    await flushNow(selected, true); check(selected);
    if (pendingRecord || refreshRequired) fail('agent_performance_reconcile_required');
    if (now() - live.lastObservation.at > 10000) fail('agent_performance_coach_wait');
    const actualTask = task(), evidence = [{ kind: 'owner-browser-observation', performerDid: binding.subjectDid,
      at: new Date(live.lastObservation.at).toISOString(), metrics: metrics() }];
    const prepared = consultant.preparePlan({ task: actualTask, context: { observationLevel: 'owner-browser', capturedAt: evidence[0].at, metrics: metrics() }, taskOrigin: 'observed-gameplay', observationId: crypto.randomUUID() });
    const observed = await journal.appendObservation({ task: actualTask, performerKind: 'agent', evidence }); check(selected);
    if (!observed.saved) fail('agent_performance_save_pending');
    // Durable unknown fence precedes the consulting act. No automatic resend.
    await persist(snapshot({ coachPending: { taskId: actualTask.id, observationId: observed.observation.id, response: null } }), selected);
    coachCount++; lastCoachAt = now();
    const advice = await consultant.requestPlan(prepared); check(selected);
    knownAdvice = { taskId: actualTask.id, observationId: observed.observation.id, response: advice };
    let retainedInJournal = false;
    try {
      await persist(snapshot({ coachPending: knownAdvice }), selected);
      const saved = await journal.appendConsultation({ observationId: observed.observation.id, service: advice.service, response: advice }); check(selected);
      if (!saved.saved) fail('agent_performance_save_pending');
      retainedInJournal = true;
      await persist(snapshot({ coachPending: null }), selected); knownAdvice = null;
      return { advice, retainedInJournal: true, retentionStatus: 'confirmed', performance: status() };
    } catch (error) {
      code = safeCode(error); check(selected);
      // An actual validated service reply remains useful when private retention
      // fails. Expose that fact without retrying the consulting request.
      return { advice, retainedInJournal, retentionStatus: retainedInJournal ? 'confirmed' : 'unconfirmed', performance: status() };
    }
  }
  async function reconcile(operation, selected) {
    check(selected, false); await verify(selected);
    if (!raw) await openStore(selected);
    if (operation === 'private-save') {
      if (!refreshRequired || raw.status().pending !== 0) await raw.reconcileCheckpoint({ graphIri, checkpoint: MODE }); check(selected, false);
      if (pendingOperation) await raw.confirm(pendingOperation); check(selected, false);
      await openStore(selected);
      if (delivery && canonical(delivery.save()) !== canonical(record.delivery)) {
        delivery.close();
        if (status().enabled) { delivery = makeDelivery(selected, record.delivery); await delivery.connect(); check(selected); }
        else delivery = null;
        eventBuffer = eventBuffer.filter(event => event.ordinal > (record.delivery?.throughOrdinal || 0));
      }
      if (journal?.status().pending || journalClosed && grants.length) {
        if (journalClosed) {
          journal = ownSession.createJournal({ sessionId, keyStorage }); journalClosed = false;
          try { await journal.connect(); } catch (error) { if (error.code !== 'pod_pending') throw error; }
        }
        await journal.retry();
      }
      check(selected, false);
      return status();
    }
    check(selected);
    if (pendingRecord) fail('agent_performance_save_pending');
    let recovered = null;
    if (operation === 'activity-read') {
      await delivery.reconcile(); check(selected);
      eventBuffer = eventBuffer.filter(event => event.ordinal > delivery.save().throughOrdinal);
    } else if (operation === 'activity-close') {
      const pendingCount = quantity(delivery.save().pending?.events || []);
      await delivery.abandonPending(); check(selected);
      eventBuffer = eventBuffer.filter(event => event.ordinal > delivery.save().throughOrdinal);
      live.exportGapInputs += pendingCount + quantity(eventBuffer) + [...aggregates.values()].reduce((sum, bucket) => sum + bucket.count, 0);
      eventBuffer = []; aggregates.clear(); exportPaused = false; live.captureRevision++;
      await persist(snapshot(), selected);
    }
    else if (operation === 'consultation-close') {
      // A retained actual reply can be journaled without another consulting act.
      const pending = knownAdvice || record.coachPending;
      if (pending?.response) {
        const history = await journal.read(); check(selected);
        const hasBaseline = history.observations.some(item => item.id === pending.observationId);
        if (hasBaseline
          && !history.consultations.some(item => item.observationId === pending.observationId && canonical(item.response) === canonical(pending.response))) {
          const saved = await journal.appendConsultation({ observationId: pending.observationId, service: pending.response.service, response: pending.response }); check(selected);
          if (!saved.saved) fail('agent_performance_save_pending');
        }
        recovered = { advice: pending.response, retainedInJournal: hasBaseline };
      }
      await persist(snapshot({ coachPending: null, closedUnconfirmedConsultations: (record.closedUnconfirmedConsultations || 0) + (pending && !pending.response ? 1 : 0) }), selected);
      knownAdvice = null;
    } else fail('agent_performance_invalid_recovery');
    check(selected); code = null; return { ...status(), ...(recovered || {}) };
  }
  function stop() {
    ++epoch; enabledUntil = 0; captureReady = false; cancelTimer(); delivery?.close(); consultant?.close();
    if (stopFlight) return stopFlight;
    const held = journal, scopes = grants; grants = []; consentUnconfirmed = scopes.length > 0;
    const run = (async () => {
      try { for (const scope of scopes) { const result = await held.revokeConsent(scope); if (!result.saved) fail('agent_performance_consent_pending'); }
        consentUnconfirmed = false; }
      catch (error) { grants = scopes; code = safeCode(error); }
      finally { held?.close(); if (held === journal) journalClosed = true; }
      return status();
    })();
    stopFlight = run.finally(() => { stopFlight = null; }); return stopFlight;
  }
  return Object.freeze({ start() { const invoked = epoch; return serialize(() => start(invoked)); }, status,
    beginCapture() { const ticket = Object.freeze({}); captureTickets.set(ticket, { selected: epoch, eligible: status().enabled }); return ticket; },
    capture({ ticket, ...input } = {}) {
      const issued = ticket && captureTickets.get(ticket); if (ticket) captureTickets.delete(ticket);
      return issued?.eligible && issued.selected === epoch && status().enabled
        ? capture(input, issued.selected) : status();
    },
    flush: () => queueFlush(true),
    coach() { const selected = epoch; try { if (!status().enabled) fail('agent_performance_stopped'); check(selected); } catch (error) { return Promise.reject(error); } return serialize(() => coach(selected)); },
    reconcile(operation) { const selected = epoch; return serialize(() => reconcile(operation, selected)); }, stop,
    close() { const stopped = stop(); closed = true; raw?.close(); return stopped; } });
}
