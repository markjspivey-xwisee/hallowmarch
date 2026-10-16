/** Live, own-subject consulting. Public discovery precedes preview and consent.
 * A relay delegate signs the request; the human/agent performer is independently
 * bound by authenticated pod status. This path retains no Foxxi learner record.
 */
import { RelayMcpTransport } from './vendor/interego-browser.mjs';

export const FOXXI_PLANNER_DESCRIPTOR = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance';
export const FOXXI_PLANNER_ACTION = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/contextualize-and-plan-signed';
const REQUIRED = ['get_pod_status', 'dereference', 'sign_request', 'act'];
const FACTORS = ['information', 'instrumentation', 'incentives', 'knowledgeSkill', 'capacity', 'motives'];
const METRICS = ['healthPercent', 'level', 'creatureDefeats', 'deaths', 'activePlaySeconds', 'nearbyHostiles', 'ownedCompanions'];
const METHODS = ['classify-first', 'apply-practice', 'gap-analysis', 'dispositional-read', 'stabilise-first'];
const plain = x => !!x && typeof x === 'object' && !Array.isArray(x);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const canonical = x => Array.isArray(x) ? '[' + x.map(canonical).join(',') + ']' : plain(x)
  ? '{' + Object.keys(x).sort().map(k => JSON.stringify(k) + ':' + canonical(x[k])).join(',') + '}' : JSON.stringify(x);
const freeze = x => { if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); } return x; };
const copy = x => JSON.parse(JSON.stringify(x));
function fields(x, keys, label) {
  if (!plain(x) || Object.keys(x).some(k => !keys.includes(k))) fail('invalid_consultation', label + ' contains unsupported fields.');
}
function text(x, label, max = 1600) {
  if (typeof x !== 'string' || !x.trim() || x.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(x)) fail('invalid_consultation', label + ' must be bounded text.');
  return x.trim();
}
function did(x) { return typeof x === 'string' && /^did:[a-z0-9]+:[^\s<>"{}|^`\\]{1,1000}$/.test(x); }
function pod(x) {
  let u; try { u = new URL(x); } catch { fail('owner_mismatch', 'The authenticated pod is unreadable.'); }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash || !/^\/[a-zA-Z0-9_-]+\/$/.test(u.pathname)) fail('owner_mismatch', 'An authenticated pod root is required.');
  return u;
}
function normalizeTask(task) {
  fields(task, ['id', 'desiredResult', 'observedResult', 'workContext', 'constraints'], 'Task');
  const result = Object.fromEntries(['id', 'desiredResult', 'observedResult', 'workContext'].map(k => [k, text(task[k], 'Task ' + k, k === 'id' ? 160 : 1600)]));
  if (!Array.isArray(task.constraints) || task.constraints.length > 8) fail('invalid_consultation', 'Task constraints must be a bounded list.');
  result.constraints = task.constraints.map(x => text(x, 'Constraint', 300));
  return result;
}
function normalizeContext(context) {
  if (context === undefined) return null;
  fields(context, ['observationLevel', 'capturedAt', 'metrics'], 'Gameplay context');
  if (context.observationLevel !== 'owner-browser' || typeof context.capturedAt !== 'string' || !Number.isFinite(Date.parse(context.capturedAt))) fail('invalid_consultation', 'Gameplay context must identify its owner-browser observation and time.');
  fields(context.metrics, METRICS, 'Gameplay metrics');
  for (const [key, value] of Object.entries(context.metrics)) {
    if (!Number.isFinite(value) || value < 0 || value > 1e9 || key === 'healthPercent' && value > 100) fail('invalid_consultation', 'Gameplay metrics must be bounded observed numbers.');
  }
  return copy(context);
}
function normalizeGap(gap) {
  if (gap === undefined) return {};
  fields(gap, ['couldPerformUnderIdealConditions', 'performedWellBefore', 'factorEvidence'], 'Cause evidence');
  const out = {};
  for (const key of ['couldPerformUnderIdealConditions', 'performedWellBefore']) if (Object.hasOwn(gap, key)) {
    if (typeof gap[key] !== 'boolean') fail('invalid_consultation', 'Cause answers must be boolean.');
    out[key] = gap[key];
  }
  if (gap.factorEvidence !== undefined) {
    fields(gap.factorEvidence, FACTORS, 'Performance factors'); out.factorEvidence = {};
    for (const [key, value] of Object.entries(gap.factorEvidence)) {
      fields(value, ['adequate', 'evidence'], 'Performance factor');
      if (typeof value.adequate !== 'boolean') fail('invalid_consultation', 'A factor needs an explicit adequacy answer.');
      out.factorEvidence[key] = { adequate: value.adequate, evidence: text(value.evidence, 'Cause evidence', 600) };
    }
  }
  return out;
}

export function createFoxxiConsultant({ binding, credential, relayUrl, journal, sessionId, subjectKind = 'human',
  transport, now = Date.now } = {}) {
  if (!did(binding?.subjectDid) || !did(binding?.authenticatedAgentDid) || !['human', 'agent'].includes(subjectKind)
    || typeof sessionId !== 'string' || !sessionId || typeof journal?.authorize !== 'function' || typeof journal?.assertAuthorized !== 'function') throw new TypeError('A verified owner, session delegate and private consent journal are required.');
  const ownerDid = binding.subjectDid, delegateDid = binding.authenticatedAgentDid, ownerPod = pod(binding.podUrl);
  const relay = new URL(relayUrl);
  if (relay.protocol !== 'https:' || relay.origin !== relayUrl) throw new TypeError('An HTTPS relay origin is required.');
  if (!transport && (credential?.kind !== 'relay-oauth-bearer' || !credential.accessToken || credential.refreshToken)) throw new TypeError('A browser-only native access grant is required.');
  const tx = transport || new RelayMcpTransport(relay.origin, { ...credential }, globalThis.fetch.bind(globalThis));
  const preparedRequests = new WeakSet(), ownPodAliases = new Set([ownerPod.href]); let connected = false, closed = false, operation = null;
  const active = () => { if (closed || !connected) fail('consultant_disconnected', 'Reconnect your original identity before requesting coaching.'); };
  async function tool(name, args) {
    if (closed) fail('consultant_disconnected', 'This coaching connection is closed.');
    let result; try { result = await tx.callTool(name, args, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch (e) { fail(e?.code === 'needs_reauth' ? 'needs_reauth' : 'consulting_unavailable', 'Interego did not confirm the coaching request.'); }
    if (closed) fail('consultant_disconnected', 'This coaching connection is closed.');
    if (!plain(result) || result.error) fail('consulting_refused', 'The coaching service refused this operation.');
    return result;
  }
  async function verifyOwner() {
    const status = await tool('get_pod_status', {}), reported = pod(status.pod);
    // Storage aliases come only from this relay's authenticated status. Pod slug
    // alone grants no authority: both owner and session delegate must also match.
    if (status.identity?.did !== ownerDid || status.sessionAgent?.did !== delegateDid || reported.pathname !== ownerPod.pathname
      || status.userId !== ownerPod.pathname.slice(1, -1)) fail('owner_mismatch', 'The native session belongs to another performer.');
    ownPodAliases.add(reported.href);
    return status;
  }
  async function discover() {
    const description = await tool('dereference', { iri: FOXXI_PLANNER_DESCRIPTOR });
    if (description.status !== 'ok' || !Array.isArray(description.affordances)) fail('consulting_contract', 'The live coaching descriptor did not resolve.');
    const matches = description.affordances.filter(a => a.action === FOXXI_PLANNER_ACTION);
    if (matches.length !== 1) fail('consulting_contract', 'The live coaching action is ambiguous or unavailable.');
    const a = matches[0]; let target; try { target = new URL(a.target); } catch { fail('consulting_contract', 'The live coaching target is unreadable.'); }
    if (a.method !== 'POST' || target.protocol !== 'https:' || target.origin !== new URL(FOXXI_PLANNER_DESCRIPTOR).origin
      || target.username || target.password || target.search || target.hash || /[{}]/.test(a.target)) fail('consulting_contract', 'The coaching target differs from the live service contract.');
    return freeze({ descriptorUrl: FOXXI_PLANNER_DESCRIPTOR, action: a.action, target: target.href, method: 'POST' });
  }
  async function connect() {
    if (closed) fail('consultant_disconnected', 'This coaching connection is closed.');
    let manifest; try { manifest = await tx.connect(REQUIRED, 'get_pod_status'); } catch { fail('consulting_unavailable', 'Interego coaching capabilities are unavailable.'); }
    if (!REQUIRED.every(name => manifest.granted?.includes(name))) fail('consulting_capability_missing', 'Interego did not grant the coaching transport.');
    await verifyOwner(); operation = await discover(); connected = true; return status();
  }
  function status() { return { connected: connected && !closed, ownerDid, delegateDid, performerKind: subjectKind,
    sessionId, recipient: operation?.target || null, descriptorUrl: operation?.descriptorUrl || null, action: operation?.action || null }; }
  function preparePlan(input) {
    active(); fields(input, ['task', 'context', 'gapEvidence'], 'Consultation');
    const task = normalizeTask(input.task), context = normalizeContext(input.context), evidence = normalizeGap(input.gapEvidence);
    const observationLevel = context ? 'performer-reported-and-owner-browser' : 'performer-reported';
    // No inferred diagnosis, invented trajectory or authority claim is attached.
    const workContext = task.workContext + '\nConstraints (performer-reported): ' + JSON.stringify(task.constraints)
      + '\nDesired result (performer-reported): ' + task.desiredResult
      + (context ? '\nOwner-browser observations, not server-verified outcomes: ' + JSON.stringify(context) : '');
    const payload = { situation: { id: 'urn:hallowmarch:consultation:' + encodeURIComponent(task.id), competency: task.workContext,
      workContext, observed: task.observedResult, performer: { id: ownerDid, kind: subjectKind }, modalStatus: 'Hypothetical', provenance: observationLevel },
      ...evidence, ...(Object.keys(evidence).length ? { exemplary: task.desiredResult } : {}) };
    const prepared = freeze({ payload, taskId: task.id, recipient: operation.target, descriptorUrl: operation.descriptorUrl, action: operation.action,
      performerDid: ownerDid, performerKind: subjectKind, observationLevel });
    if (new TextEncoder().encode(JSON.stringify(payload)).length > 16 * 1024) fail('invalid_consultation', 'The coaching request exceeds its bounded capacity.');
    preparedRequests.add(prepared); return prepared;
  }
  async function requestPlan(prepared) {
    active(); if (!preparedRequests.has(prepared)) fail('consultation_preview_required', 'Preview this connection’s exact coaching request before sending it.');
    await verifyOwner(); const current = await discover(); active();
    if (canonical(current) !== canonical(operation)) fail('consulting_contract_changed', 'The live coaching recipient changed. Preview and consent again.');
    const token = await journal.authorize({ recipient: operation.target, purpose: 'request-consultation', taskId: prepared.taskId }); active();
    if (token?.ownerDid !== ownerDid || token?.sessionId !== sessionId || token?.recipient !== operation.target || token?.purpose !== 'request-consultation' || token?.taskId !== prepared.taskId
      || !Number.isFinite(Date.parse(token.expiresAt)) || Date.parse(token.expiresAt) <= now()) fail('consulting_consent_required', 'Current own-subject coaching consent is required.');
    const signed = await tool('sign_request', { payload: prepared.payload }); active();
    let payload; try { payload = JSON.parse(signed._signed_payload); } catch { fail('consulting_signature', 'The native request signature is unreadable.'); }
    const stamp = pod(payload.subject_pod_url);
    if (!signed._signature || payload.agent_id !== delegateDid || !ownPodAliases.has(stamp.href)
      || !Number.isFinite(Date.parse(payload.timestamp)) || Math.abs(now() - Date.parse(payload.timestamp)) > 60000
      || Object.keys(payload).some(k => !['agent_id', 'timestamp', 'subject_pod_url', ...Object.keys(prepared.payload)].includes(k))
      || canonical(Object.fromEntries(Object.entries(payload).filter(([k]) => !['agent_id', 'timestamp', 'subject_pod_url'].includes(k)))) !== canonical(prepared.payload)) fail('consulting_signature', 'The signed request changed the previewed performer, content or session.');
    if (await journal.assertAuthorized(token) === false) fail('consulting_consent_required', 'Coaching consent changed before sending.'); active();
    // Relay owns the bearer and follows only this discovered external action.
    // The native bearer is never sent to Foxxi or included in the payload.
    const response = await tool('act', { descriptor_url: operation.descriptorUrl, action_iri: operation.action, payload: signed }); active();
    let body = response.body; if (typeof body === 'string') { try { body = JSON.parse(body); } catch { fail('consulting_contract', 'Foxxi returned an unreadable consultation.'); } }
    if (response.status !== 200 || !plain(body) || body.error) fail('consulting_refused', 'Foxxi did not confirm a consultation.');
    if (body.classifiedBy !== delegateDid || !plain(body.diagnosis) || !METHODS.includes(body.diagnosis.method)
      || body.diagnosis.situationId !== prepared.payload.situation.id || !plain(body.plan) || body.plan.situationId !== prepared.payload.situation.id
      || !Array.isArray(body.plan.selected) || typeof body.plan.summary !== 'string') fail('consulting_contract', 'Foxxi returned a plan for an unverified performer or situation.');
    return freeze({ response: copy(body), service: { action: operation.action, target: operation.target }, source: { ...operation, classifiedBy: body.classifiedBy,
      signatureAuthority: 'relay-delegated', performerDid: ownerDid, performerKind: subjectKind },
      observationLevel: prepared.observationLevel, competencyClaims: [], foxxiPersonalRecordCreated: false });
  }
  return Object.freeze({ connect, status, preparePlan, requestPlan,
    close() { closed = true; connected = false; tx.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, expiresAt: now() }); } });
}
