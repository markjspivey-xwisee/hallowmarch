/** Private, self-attributed consultation records. The game is never their custodian. */
import { createNativePodClient, NativePodError } from './client.mjs';

const SCHEMA = 'interego.owner-performance-consultation/v1';
const PURPOSES = ['retain-observations', 'request-consultation', 'record-gameplay-activity'];
const MAX_LIFETIME = 15 * 60 * 1000, MAX_RECORDS = 32;
const PAGE_WATERMARK = 16, PAGE_BYTES = 190 * 1024;
const fail = (code, message) => { throw new NativePodError(code, message); };
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function text(value, max = 4096) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value)) fail('invalid_consultation', 'A bounded consultation value is required.');
  return value;
}
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) fail('invalid_consultation', 'The consultation does not match its record contract.');
}
function timestamp(value) {
  if (typeof value !== 'string' || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_consultation', 'An observed ISO timestamp is required.');
  return value;
}
function json(value, maxBytes = 32 * 1024) {
  const visit = (v, depth = 0, seen = new Set()) => {
    if (depth > 20) fail('invalid_consultation', 'The consultation response is too deeply nested.');
    if (v === null || ['string', 'boolean'].includes(typeof v) || typeof v === 'number' && Number.isFinite(v)) return;
    if (!plain(v) && !Array.isArray(v) || seen.has(v)) fail('invalid_consultation', 'Finite JSON is required.');
    seen.add(v); for (const child of Object.values(v)) visit(child, depth + 1, seen); seen.delete(v);
  };
  visit(value);
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > maxBytes) fail('consultation_capacity', 'This consultation exceeds its bounded record capacity.');
  return JSON.parse(encoded);
}
function target(value) {
  let url; try { url = new URL(value); } catch { fail('invalid_recipient', 'A concrete HTTPS consultation recipient is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || /[{}]/.test(value) || url.href !== value) fail('invalid_recipient', 'A concrete HTTPS consultation recipient is required.');
  return value;
}
function subject(value) {
  if (typeof value !== 'string' || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(value) || value.length > 1024) fail('invalid_owner', 'An authenticated native subject is required.');
  return value;
}
function archiveReference(value) {
  if (value === null || value === undefined) return null;
  exact(value, ['graphIri', 'descriptorUrl', 'cid']);
  if (typeof value.graphIri !== 'string' || !/^urn:graph:[^\s<>"{}|^`\\]+$/.test(value.graphIri)) fail('invalid_consultation', 'A private native archive graph is required.');
  target(value.descriptorUrl); text(value.cid, 1024); return clone(value);
}
function taskRecord(value) {
  exact(value, ['id', 'desiredResult', 'observedResult', 'workContext', 'constraints']);
  for (const key of ['id', 'desiredResult', 'observedResult', 'workContext']) text(value[key], key === 'id' ? 512 : 2048);
  if (value.constraints !== undefined && (!Array.isArray(value.constraints) || value.constraints.length > 8)) fail('invalid_consultation', 'Task constraints must be bounded.');
  for (const item of value.constraints || []) text(item, 512);
  return clone(value);
}
function evidenceRecord(value, ownerDid) {
  exact(value, ['kind', 'performerDid', 'at', 'metrics']);
  if (value.kind !== 'owner-browser-observation' || value.performerDid !== ownerDid) fail('cross_subject_denied', 'Only observations about this authenticated performer belong in this pod.');
  timestamp(value.at);
  if (!plain(value.metrics) || Object.keys(value.metrics).length > 20) fail('invalid_consultation', 'A bounded set of observed measurements is required.');
  for (const [key, measured] of Object.entries(value.metrics)) {
    if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(key) || typeof measured !== 'number' || !Number.isFinite(measured) || measured < 0 || measured > Number.MAX_SAFE_INTEGER) fail('invalid_consultation', 'Measurements must be finite nonnegative observed numbers.');
  }
  return clone(value);
}

/** The encrypted named graph is the owner index as well as the bounded journal.
 * Naming survives browser, relay session and game-host changes. No public pointer. */
export async function performanceConsultationGraphIri(ownerDid, applicationId = 'urn:game:hallowmarch', crypto = globalThis.crypto) {
  subject(ownerDid); text(applicationId, 1024);
  if (!crypto?.subtle) fail('crypto_unavailable', 'Native private consultation requires browser cryptography.');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([SCHEMA, ownerDid, applicationId]))));
  return 'urn:graph:interego:performance-consultation:' + [...digest].map(n => n.toString(16).padStart(2, '0')).join('');
}

/** This is a subject port, not agent delegation. An agent must open its own native
 * credential/pod; a player cannot choose an agent DID here. No learning sink or
 * Foxxi URL is inferred. Existing browser recovery keys are reused, never minted. */
export function createOwnerPerformanceConsultation({ binding, credential, relayUrl, sessionId,
  applicationId = 'urn:game:hallowmarch', createClient = createNativePodClient,
  crypto = globalThis.crypto, now = Date.now, ...clientOptions } = {}) {
  const ownerDid = subject(binding?.subjectDid), podUrl = target(binding?.podUrl);
  text(sessionId, 256); text(applicationId, 1024);
  if (!crypto?.randomUUID) fail('crypto_unavailable', 'Native private consultation requires browser cryptography.');
  const client = createClient({ ...clientOptions, relayUrl, credential, ownerDid, podUrl, crypto, now });
  const denied = new Set();
  let graphIri = null, current = null, pending = null, stagedPage = null, rotationAfterPending = null, connected = false, keyPresent = false, closed = false, seen = false, chain = Promise.resolve();
  const key = (purpose, recipient, taskId) => JSON.stringify([purpose, recipient, taskId]);
  const active = () => { if (closed) fail('revoked', 'This consultation connection is closed.'); };
  const ready = () => { active(); if (!connected) fail('not_connected', 'Connect the performer identity before consulting.'); };
  const empty = () => ({ schema: SCHEMA, ownerDid, applicationId, consents: [], observations: [], consultations: [], evaluations: [], archiveHead: null });
  function purposeRecipient(purpose, recipient, taskId) {
    text(taskId, 512);
    if (!PURPOSES.includes(purpose)) fail('invalid_consent_scope', 'Choose an advertised consultation purpose.');
    target(recipient);
    if (purpose === 'retain-observations' && recipient !== podUrl) fail('invalid_recipient', 'Private observation retention belongs only to this authenticated pod.');
  }
  function validate(record) {
    exact(record, ['schema', 'ownerDid', 'applicationId', 'consents', 'observations', 'consultations', 'evaluations', 'archiveHead']);
    if (record.schema !== SCHEMA || record.ownerDid !== ownerDid || record.applicationId !== applicationId) fail('owner_mismatch', 'The consultation index belongs to a different subject or application.');
    archiveReference(record.archiveHead);
    if (!Array.isArray(record.consents) || record.consents.length > 8 || !Array.isArray(record.observations) || record.observations.length > MAX_RECORDS
      || !Array.isArray(record.consultations) || record.consultations.length > MAX_RECORDS
      || !Array.isArray(record.evaluations) || record.evaluations.length > MAX_RECORDS) fail('consultation_capacity', 'The private consultation index exceeds its bounded capacity.');
    const scopes = new Set(), ids = new Set(), observations = new Map(), consultations = new Map();
    for (const consent of record.consents) {
      exact(consent, ['id', 'revision', 'sessionId', 'purpose', 'recipient', 'taskId', 'issuedAt', 'expiresAt', 'revoked']);
      text(consent.id, 128); text(consent.sessionId, 256); purposeRecipient(consent.purpose, consent.recipient, consent.taskId);
      timestamp(consent.issuedAt); timestamp(consent.expiresAt);
      if (!Number.isSafeInteger(consent.revision) || consent.revision < 1 || typeof consent.revoked !== 'boolean'
        || Date.parse(consent.expiresAt) <= Date.parse(consent.issuedAt) || Date.parse(consent.expiresAt) - Date.parse(consent.issuedAt) > MAX_LIFETIME) fail('invalid_consent_scope', 'The saved consent has an invalid revision or expiry.');
      const scope = key(consent.purpose, consent.recipient, consent.taskId);
      if (scopes.has(scope)) fail('invalid_consent_scope', 'The private index contains ambiguous consent.'); scopes.add(scope);
    }
    for (const item of record.observations) {
      exact(item, ['id', 'ownerDid', 'performerKind', 'at', 'task', 'evidence', 'epistemicStatus', 'competencyStatus']);
      text(item.id, 128); timestamp(item.at); taskRecord(item.task);
      if (ids.has(item.id) || item.ownerDid !== ownerDid || !['human', 'agent'].includes(item.performerKind)
        || item.epistemicStatus !== 'reported-task-and-client-observation' || item.competencyStatus !== 'not-assessed'
        || !Array.isArray(item.evidence) || item.evidence.length > 8) fail('invalid_consultation', 'The task observation is not self-attributed observed evidence.');
      for (const evidence of item.evidence) evidenceRecord(evidence, ownerDid); ids.add(item.id); observations.set(item.id, item);
    }
    for (const item of record.consultations) {
      exact(item, ['id', 'ownerDid', 'at', 'observationId', 'service', 'response', 'epistemicStatus', 'competencyStatus']);
      text(item.id, 128); timestamp(item.at); exact(item.service, ['action', 'target']); text(item.service.action, 1024); target(item.service.target); json(item.response);
      if (ids.has(item.id) || item.ownerDid !== ownerDid || !observations.has(item.observationId) || item.epistemicStatus !== 'service-response-unvalidated-effect'
        || item.competencyStatus !== 'not-assessed') fail('invalid_consultation', 'A service response must reference this owner’s observed task.');
      ids.add(item.id); consultations.set(item.id, item);
    }
    for (const item of record.evaluations) {
      exact(item, ['id', 'ownerDid', 'at', 'consultationId', 'observationId', 'playerReport', 'comparison', 'epistemicStatus', 'competencyStatus']);
      text(item.id, 128); timestamp(item.at); text(item.playerReport, 2048);
      const consultation = consultations.get(item.consultationId), before = observations.get(consultation?.observationId), after = observations.get(item.observationId);
      if (ids.has(item.id) || item.ownerDid !== ownerDid || !consultation || !after || !before || before.task.id !== after.task.id
        || before.id === after.id || Date.parse(after.at) < Date.parse(consultation.at)
        || item.epistemicStatus !== 'observed-before-after-no-causal-claim' || item.competencyStatus !== 'not-assessed'
        || !same(item.comparison, comparison(before, after))) fail('invalid_consultation', 'An evaluation must preserve this performer’s actual before and after observations.');
      ids.add(item.id);
    }
    return json(record, 350 * 1024);
  }
  async function refresh() {
    ready(); if (pending || stagedPage) fail('pod_pending', 'Confirm the outstanding private consultation write first.');
    const found = await client.load({ graphIri }); active();
    if (!found && seen) fail('missing_record', 'The existing private consultation index could not be opened.');
    if (found) { if (found.graphIri !== graphIri) fail('owner_mismatch', 'The native consultation graph changed.'); validate(found.record); seen = true; }
    current = found; return clone(found?.record || empty());
  }
  function accepted(result) {
    active();
    if (!result?.saved) {
      if (result?.status === 'conflict') { pending = null; fail('conflict', 'The consultation index changed elsewhere. Open its current head before continuing.'); }
      if (!result?.operationId) fail('native_contract', 'The consultation write has no confirmable operation.');
      pending = result; fail('pod_pending', 'Your pod has not confirmed this consultation write.');
    }
    if (result.graphIri !== graphIri) fail('owner_mismatch', 'The confirmed consultation write identifies another graph.');
    validate(result.record); current = result; seen = true; pending = null; stagedPage = null;
    return { saved: true, reference: { graphIri, descriptorUrl: result.head.descriptorUrl, cid: result.head.cid } };
  }
  async function readArchive(input) {
    ready(); const ref = archiveReference(input || current?.record.archiveHead);
    if (!ref) return null;
    if (ref.graphIri === graphIri) fail('invalid_archive', 'The private index cannot be its own archive.');
    const result = await client.load({ graphIri: ref.graphIri }); active();
    if (!result || result.graphIri !== ref.graphIri || result.head.cid !== ref.cid || result.head.descriptorUrl !== ref.descriptorUrl) fail('archive_changed', 'The immutable private archive no longer matches its verified native reference.');
    const record = validate(result.record);
    if (record.archiveHead?.graphIri === ref.graphIri || record.archiveHead?.graphIri === graphIri) fail('invalid_archive', 'The private archive chain contains a cycle.');
    return { reference: ref, record, next: archiveReference(record.archiveHead) };
  }
  async function findRecord(kind, predicate) {
    const local = current?.record[kind].findLast(predicate); if (local) return clone(local);
    const visited = new Set(); let ref = current?.record.archiveHead;
    while (ref) {
      if (visited.has(ref.graphIri)) fail('invalid_archive', 'The private archive chain contains a cycle.'); visited.add(ref.graphIri);
      const page = await readArchive(ref), found = page.record[kind].findLast(predicate);
      if (found) return clone(found); ref = page.next;
    }
    return null;
  }
  function include(record, kind, item) {
    const existing = record[kind].find(value => value.id === item.id);
    if (existing && !same(existing, item)) fail('conflict', 'The private history contains competing records with the same identity.');
    if (!existing) record[kind].push(clone(item));
  }
  function focused(record, focus) {
    const next = { ...empty(), consents: clone(record.consents), archiveHead: stagedPage.reference };
    for (const kind of ['observations', 'consultations', 'evaluations']) next[kind] = record[kind].filter(item => focus[kind]?.includes(item.id));
    return validate(next);
  }
  async function finishPage() {
    ready(); const stage = stagedPage;
    if (stage.operationId) {
      const result = await client.confirm(stage.operationId); active();
      if (!result?.saved) {
        if (result?.status === 'conflict') { stagedPage = null; fail('conflict', 'The private archive has competing native heads.'); }
        fail('pod_pending', 'The private history page is awaiting its original native confirmation.');
      }
      validate(result.record);
      if (!same(result.record, stage.record)) fail('invalid_archive', 'The confirmed private archive differs from the original draft.');
      stage.reference = archiveReference({ graphIri: result.graphIri, ...result.head }); stage.operationId = null;
    }
    const next = focused(stage.record, stage.focus);
    try { return accepted(await client.save({ graphIri, expectedHead: stage.expectedHead, record: next })); }
    catch (cause) {
      if (cause.code === 'conflict') {
        // The immutable page remains private and intact. Expose its real
        // receipt for explicit reconciliation; never replace another head.
        cause.archiveReference = clone(stage.reference); stagedPage = null;
      }
      throw cause;
    }
  }
  async function persist(record, guard = () => {}, focus = null) {
    ready(); if (!keyPresent) fail('key_required', 'Restore your existing browser recovery key before recording consultation.');
    validate(record);
    await client.registerKey(); active(); guard();
    if (focus && current && (['observations', 'consultations', 'evaluations'].some(kind => record[kind].length > PAGE_WATERMARK)
      || new TextEncoder().encode(JSON.stringify(record)).length > PAGE_BYTES)) {
      // First CAS the full draft into its original owner index. A concurrent
      // withdrawal therefore rejects the new content before any archive copy.
      // Only already-confirmed data is copied during subsequent maintenance.
      rotationAfterPending = { record: clone(record), focus };
      try { accepted(await client.save({ graphIri, expectedHead: current.head, record })); }
      catch (cause) { if (cause.code !== 'pod_pending') rotationAfterPending = null; throw cause; }
      rotationAfterPending = null; return beginPage(record, focus);
    }
    return accepted(current ? await client.save({ graphIri, expectedHead: current.head, record }) : await client.createAt({ graphIri, record }));
  }
  async function beginPage(record, focus) {
    stagedPage = { record: clone(record), focus, expectedHead: clone(current.head), reference: null, operationId: null };
    let result;
    try { result = await client.create({ record }); active(); }
    catch (cause) { stagedPage = null; throw cause; }
    if (!result?.saved) {
      if (!result?.operationId) { stagedPage = null; fail('native_contract', 'The private archive write has no confirmable operation.'); }
      stagedPage.operationId = result.operationId; fail('pod_pending', 'The complete private history page is awaiting confirmation.');
    }
    validate(result.record);
    if (!same(result.record, record)) fail('invalid_archive', 'The saved private history page differs from its original draft.');
    stagedPage.reference = archiveReference({ graphIri: result.graphIri, ...result.head });
    return finishPage();
  }
  async function retryPending() {
    ready();
    if (pending) {
      const rotation = rotationAfterPending;
      let result;
      try { result = accepted(await client.confirm(pending.operationId)); }
      catch (cause) { if (cause.code !== 'pod_pending') rotationAfterPending = null; throw cause; }
      rotationAfterPending = null;
      return rotation ? beginPage(rotation.record, rotation.focus) : result;
    }
    return stagedPage ? finishPage() : { saved: true, pending: false };
  }
  const serialize = run => { const result = chain.then(run); chain = result.catch(() => {}); return result; };
  function permission(record, purpose, recipient, taskId) {
    purposeRecipient(purpose, recipient, taskId);
    const found = record.consents.find(c => c.purpose === purpose && c.recipient === recipient && c.taskId === taskId);
    if (denied.has(key(purpose, recipient, taskId)) || !found || found.revoked || found.sessionId !== sessionId
      || Date.parse(found.issuedAt) > now() || Date.parse(found.expiresAt) <= now()) fail('consultation_consent_required', 'Current performer consent for this exact recipient and purpose is required.');
    return { ownerDid, sessionId, consentId: found.id, revision: found.revision, purpose, recipient, taskId, expiresAt: found.expiresAt };
  }
  async function authorize({ purpose, recipient, taskId } = {}) { return permission(await refresh(), purpose, recipient, taskId); }
  const api = {
    async connect() {
      active(); const result = await client.connect(); active();
      if (result.ownerDid !== undefined && result.ownerDid !== ownerDid) fail('owner_mismatch', 'The native consultation identity changed.');
      keyPresent = result.keyPresent === true; connected = true;
      graphIri = await performanceConsultationGraphIri(ownerDid, applicationId, crypto); active();
      const selected = await client.currentHead({ graphIri }); active(); seen ||= !!selected;
      if (selected && !keyPresent) fail('key_required', 'Restore the existing browser recovery key to open consultation.');
      await refresh(); return api.status();
    },
    read: () => serialize(async () => {
      const record = await refresh();
      // Preserve the current UI's last-plan entry point even when a new task's
      // observation rotated an unfinished plan into an immutable history page.
      if (!record.consultations.length && record.archiveHead) {
        const last = await findRecord('consultations', () => true);
        if (last) {
          const baseline = await findRecord('observations', item => item.id === last.observationId);
          if (!baseline) fail('invalid_archive', 'The archived plan has no self-attributed task observation.');
          include(record, 'observations', baseline); include(record, 'consultations', last);
        }
      }
      return clone(record);
    }),
    readArchive: reference => serialize(() => readArchive(reference)),
    authorize: input => serialize(() => authorize(input)),
    assertAuthorized(token) { return serialize(async () => {
      if (!plain(token) || token.ownerDid !== ownerDid || token.sessionId !== sessionId) fail('cross_subject_denied', 'This consent token belongs to another performer or session.');
      const currentToken = await authorize(token);
      if (!same(currentToken, token)) fail('consultation_consent_changed', 'Consultation consent changed before delivery.');
      return clone(currentToken);
    }); },
    grantConsent({ accepted: choice, purpose, recipient, taskId, lifetimeMs } = {}) { return serialize(async () => {
      ready(); purposeRecipient(purpose, recipient, taskId);
      if (choice !== true) fail('consultation_consent_required', 'The performer must explicitly choose this consultation scope.');
      if (!Number.isSafeInteger(lifetimeMs) || lifetimeMs < 1000 || lifetimeMs > MAX_LIFETIME) fail('invalid_consent_scope', 'Consultation consent lasts at most fifteen minutes.');
      const record = await refresh(), start = now();
      const consent = { id: 'urn:uuid:' + crypto.randomUUID(), revision: 1, sessionId, purpose, recipient, taskId,
        issuedAt: new Date(start).toISOString(), expiresAt: new Date(start + lifetimeMs).toISOString(), revoked: false };
      const scope = key(purpose, recipient, taskId);
      record.consents = record.consents.filter(c => key(c.purpose, c.recipient, c.taskId) !== scope && Date.parse(c.expiresAt) > start);
      record.consents.push(consent);
      // A previous explicit withdrawal continues to block delivery until the
      // newly chosen permission has a verified native readback.
      const result = await persist(record); denied.delete(scope); return { ...result, consent: clone(consent) };
    }); },
    revokeConsent({ purpose, recipient, taskId } = {}) {
      purposeRecipient(purpose, recipient, taskId); denied.add(key(purpose, recipient, taskId));
      return serialize(async () => {
        ready();
        // A prior grant may already have reached the pod. Confirm that exact
        // operation before writing its withdrawal; never mint a replacement.
        if (pending || stagedPage) await retryPending();
        const record = await refresh(), found = record.consents.find(c => c.purpose === purpose && c.recipient === recipient && c.taskId === taskId);
        if (!found || found.revoked) return { saved: true, alreadyRevoked: true };
        found.revoked = true; found.revision++;
        return persist(record);
      });
    },
    appendObservation({ task, performerKind = 'human', evidence = [] } = {}) {
      const capturedTask = taskRecord(task);
      if (!['human', 'agent'].includes(performerKind) || !Array.isArray(evidence) || evidence.length > 8) fail('invalid_consultation', 'A self-attributed human or agent observation is required.');
      const capturedEvidence = evidence.map(item => evidenceRecord(item, ownerDid));
      return serialize(async () => {
        const record = await refresh(); permission(record, 'retain-observations', podUrl, capturedTask.id);
        const previous = await findRecord('observations', o => o.task.id === capturedTask.id);
        if (previous && !sameTask(previous.task, capturedTask)) fail('task_scope_changed', 'Choose a new task identity and consent when the goal or work context changes.');
        const observation = { id: 'urn:uuid:' + crypto.randomUUID(), ownerDid, performerKind, at: new Date(now()).toISOString(), task: capturedTask,
          evidence: capturedEvidence, epistemicStatus: 'reported-task-and-client-observation', competencyStatus: 'not-assessed' };
        record.observations.push(observation);
        const result = await persist(record, () => permission(record, 'retain-observations', podUrl, capturedTask.id), { observations: [observation.id] }); return { ...result, observation: clone(observation) };
      });
    },
    appendConsultation({ observationId, service, response } = {}) {
      exact(service, ['action', 'target']); text(service.action, 1024); target(service.target);
      const capturedService = clone(service), capturedResponse = json(response);
      return serialize(async () => {
        const record = await refresh(), observation = await findRecord('observations', o => o.id === observationId);
        if (!observation) fail('unknown_observation', 'Open this performer’s recorded task before retaining its consultation.');
        const capturedTask = observation.task; permission(record, 'retain-observations', podUrl, capturedTask.id);
        include(record, 'observations', observation);
        const consultation = { id: 'urn:uuid:' + crypto.randomUUID(), ownerDid, at: new Date(now()).toISOString(), observationId,
          service: capturedService, response: capturedResponse, epistemicStatus: 'service-response-unvalidated-effect', competencyStatus: 'not-assessed' };
        record.consultations.push(consultation);
        const result = await persist(record, () => permission(record, 'retain-observations', podUrl, capturedTask.id), { observations: [observationId], consultations: [consultation.id] }); return { ...result, consultation: clone(consultation) };
      });
    },
    appendEvaluation({ consultationId, observationId, playerReport } = {}) {
      text(playerReport, 2048);
      return serialize(async () => {
        const record = await refresh();
        const consultation = await findRecord('consultations', c => c.id === consultationId);
        const before = consultation && await findRecord('observations', o => o.id === consultation.observationId), after = await findRecord('observations', o => o.id === observationId);
        if (!consultation || !before || !after || before.id === after.id || before.task.id !== after.task.id
          || Date.parse(after.at) < Date.parse(consultation.at)) fail('invalid_evaluation', 'Record a later observation of this same task before evaluating its consultation.');
        const capturedTask = before.task; permission(record, 'retain-observations', podUrl, capturedTask.id);
        include(record, 'observations', before); include(record, 'observations', after); include(record, 'consultations', consultation);
        const evaluation = { id: 'urn:uuid:' + crypto.randomUUID(), ownerDid, at: new Date(now()).toISOString(), consultationId, observationId,
          playerReport, comparison: comparison(before, after), epistemicStatus: 'observed-before-after-no-causal-claim', competencyStatus: 'not-assessed' };
        record.evaluations.push(evaluation);
        const result = await persist(record, () => permission(record, 'retain-observations', podUrl, capturedTask.id),
          { observations: [before.id, after.id], consultations: [consultationId], evaluations: [evaluation.id] }); return { ...result, evaluation: clone(evaluation) };
      });
    },
    retry: () => serialize(retryPending),
    status: () => ({ connected: connected && !closed, ownerDid, podUrl, applicationId, graphIri, keyPresent, pending: !!(pending || stagedPage),
      archiveHead: clone(current?.record.archiveHead || null), archiving: !!stagedPage,
      observations: current?.record.observations.length || 0, consultations: current?.record.consultations.length || 0, evaluations: current?.record.evaluations.length || 0 }),
    close() { closed = true; connected = false; current = null; stagedPage = null; rotationAfterPending = null; denied.clear(); client.close(); },
  };
  return Object.freeze(api);
}

/** Numeric differences are observations; their cause and quality remain untested. */
function comparison(before, after) {
  const earlier = before.evidence.at(-1)?.metrics || {}, later = after.evidence.at(-1)?.metrics || {};
  return Object.fromEntries(Object.keys(earlier).filter(key => Object.hasOwn(later, key)).sort().map(key => [key,
    { before: earlier[key], after: later[key], change: later[key] - earlier[key] }]));
}

function sameTask(a, b) {
  return a.id === b.id && a.desiredResult === b.desiredResult && a.workContext === b.workContext && same(a.constraints || [], b.constraints || []);
}
