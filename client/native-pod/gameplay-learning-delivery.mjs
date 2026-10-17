/** Optional owner-browser xAPI delivery. Original observations and the bounded
 * delivery journal remain in the player's encrypted native character record.
 * A game service identity never signs, transports or owns personal statements. */
import { RelayMcpTransport } from './vendor/interego-browser.mjs';
import { gameplayActivityStatement, validateGameplayActivityEvent } from './gameplay-activity.mjs';

export const GAMEPLAY_LEARNING_DESCRIPTOR = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/affordance';
export const GAMEPLAY_LEARNING_WRITE_ACTION = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/write-own-subject-xapi-statements-signed';
export const GAMEPLAY_LEARNING_READ_ACTION = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/read-own-subject-xapi-statements-signed';
export const GAMEPLAY_LEARNING_PURPOSE = 'record-gameplay-activity';
export const GAMEPLAY_LEARNING_SCHEMA = 'hallowmarch.gameplay-learning-delivery/v1';
const REQUIRED = ['get_pod_status', 'dereference', 'sign_request', 'act'];
const MAX_BYTES = 64 * 1024, MAX_BATCH = 20, DETAIL_RETENTION_MS = 60 * 60 * 1000;
const copy = value => JSON.parse(JSON.stringify(value));
const plain = value => value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const did = value => typeof value === 'string' && value.length <= 1024 && /^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(value);
const text = value => typeof value === 'string' && value.length > 0 && value.length <= 128 && !/[\u0000-\u001f\u007f]/.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
function pod(value) {
  let url; try { url = new URL(value); } catch { fail('owner_mismatch', 'The authenticated owner pod is unreadable.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) fail('owner_mismatch', 'An authenticated own-pod root is required.');
  return url;
}
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) fail('learning_delivery_contract', 'The learning delivery does not match its bounded contract.');
}
function bounded(value) {
  if (new TextEncoder().encode(JSON.stringify(value)).length > MAX_BYTES) fail('learning_delivery_capacity', 'This gameplay delivery exceeds its bounded private record.');
  return copy(value);
}

/** commitState MUST confirm the exact supplied state in the encrypted owner
 * character save before returning {saved:true}. No external write occurs first.
 * startAfterOrdinal is captured when the player enables this session. Historical
 * activity never silently becomes eligible, including after reconnect/reload. */
export function createOwnerGameplayLearningDelivery({ binding, credential, relayUrl, journal, sessionId, gameplaySessionId = sessionId, characterId,
  startAfterOrdinal, state, commitState, assertCurrent = () => true, transport, now = Date.now } = {}) {
  if (!did(binding?.subjectDid) || !did(binding?.authenticatedAgentDid) || !text(sessionId) || !text(gameplaySessionId) || !text(characterId)
    || !integer(startAfterOrdinal) || typeof commitState !== 'function' || typeof assertCurrent !== 'function' || typeof journal?.authorize !== 'function'
    || typeof journal?.assertAuthorized !== 'function') throw new TypeError('Verified owner, current gameplay scope, consent journal and confirmed private state writer are required.');
  const ownerDid = binding.subjectDid, delegateDid = binding.authenticatedAgentDid, ownerPod = pod(binding.podUrl);
  const relay = new URL(relayUrl);
  if (relay.protocol !== 'https:' || relay.origin !== relayUrl) throw new TypeError('An HTTPS relay origin is required.');
  if (!transport && (credential?.kind !== 'relay-oauth-bearer' || !credential.accessToken || credential.refreshToken)) throw new TypeError('A browser-only native access token is required.');
  const tx = transport || new RelayMcpTransport(relay.origin, { ...credential }, globalThis.fetch.bind(globalThis));
  const taskId = 'hallowmarch-activity:' + characterId + ':' + sessionId;
  const previews = new WeakSet(), aliases = new Set([ownerPod.href]);
  let connected = false, closed = false, contract = null, queue = Promise.resolve(), busy = false, code = null, pendingStateConfirmed = true;
  function events(input, currentSession = true) {
    if (!Array.isArray(input) || input.length < 1 || input.length > MAX_BATCH) fail('invalid_activity', 'A learning batch needs one to twenty actual observations.');
    const result = input.map(validateGameplayActivityEvent);
    if (new Set(result.map(event => event.id)).size !== result.length || result.some((event, index) =>
      currentSession && event.sessionId !== gameplaySessionId || index > 0 && event.ordinal <= result[index - 1].ordinal)) fail('learning_delivery_scope', 'Only ordered observations from the enabled gameplay session are eligible.');
    return result;
  }
  function validate(value) {
    exact(value, ['schema', 'ownerDid', 'characterId', 'throughOrdinal', 'acknowledgedCount', 'closedUnconfirmedCount', 'pending']);
    if (!Object.hasOwn(value, 'closedUnconfirmedCount')) value = { ...value, closedUnconfirmedCount: 0 };
    if (value.schema !== GAMEPLAY_LEARNING_SCHEMA || value.ownerDid !== ownerDid || value.characterId !== characterId
      || !integer(value.throughOrdinal) || !integer(value.acknowledgedCount) || !integer(value.closedUnconfirmedCount)) fail('learning_delivery_scope', 'This delivery record belongs to another owner or character.');
    if (value.pending !== null) {
      exact(value.pending, ['events', 'contract', 'createdAt']); exact(value.pending.contract, ['descriptorUrl', 'write', 'read']);
      const list = events(value.pending.events, false);
      if (list.some(event => event.ordinal <= value.throughOrdinal) || !iso(value.pending.createdAt)
        || !same(value.pending.contract, normalizeContract(value.pending.contract))) fail('learning_delivery_contract', 'The pending delivery must retain its exact event identities and service contract.');
    }
    return bounded(value);
  }
  function normalizeContract(value) {
    if (value.descriptorUrl !== GAMEPLAY_LEARNING_DESCRIPTOR) fail('learning_delivery_contract', 'The own-subject learning descriptor changed.');
    const result = { descriptorUrl: GAMEPLAY_LEARNING_DESCRIPTOR };
    for (const [kind, action] of [['write', GAMEPLAY_LEARNING_WRITE_ACTION], ['read', GAMEPLAY_LEARNING_READ_ACTION]]) {
      exact(value[kind], ['action', 'target', 'method']); const item = value[kind]; let url;
      try { url = new URL(item.target); } catch { fail('learning_delivery_contract', 'The own-subject learning target is unreadable.'); }
      if (item.action !== action || item.method !== 'POST' || url.protocol !== 'https:'
        || url.origin !== new URL(GAMEPLAY_LEARNING_DESCRIPTOR).origin || url.username || url.password || url.search || url.hash || /[{}]/.test(item.target)) fail('learning_delivery_contract', 'The live learning action differs from the own-subject service contract.');
      result[kind] = { action, target: url.href, method: 'POST' };
    }
    return result;
  }
  let current = state === undefined || state === null ? { schema: GAMEPLAY_LEARNING_SCHEMA, ownerDid, characterId,
    throughOrdinal: startAfterOrdinal, acknowledgedCount: 0, closedUnconfirmedCount: 0, pending: null } : validate(state);
  const currentScope = () => { if (assertCurrent() === false) fail('learning_delivery_scope_changed', 'This performer or active gameplay scope changed before delivery.'); };
  const active = () => { currentScope(); if (closed || !connected) fail('learning_delivery_disconnected', 'Reconnect this performer before delivering activity.'); };
  const serialize = run => { const next = queue.then(async () => { busy = true; try { return await run(); } finally { busy = false; } }); queue = next.catch(() => {}); return next; };
  async function tool(name, args) {
    currentScope(); if (closed) fail('learning_delivery_disconnected', 'This activity delivery connection is closed.');
    let result; try { result = await tx.callTool(name, args, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch (cause) { fail(cause?.code === 'needs_reauth' ? 'needs_reauth' : 'learning_delivery_unconfirmed', 'Interego did not confirm this activity operation.'); }
    currentScope(); if (closed) fail('learning_delivery_disconnected', 'This activity delivery connection is closed.');
    if (!plain(result) || result.error) fail('learning_delivery_refused', 'Interego refused this activity operation.');
    return result;
  }
  async function verifyOwner() {
    const status = await tool('get_pod_status', {}), reported = pod(status.pod);
    if (status.identity?.did !== ownerDid || status.sessionAgent?.did !== delegateDid || reported.pathname !== ownerPod.pathname
      || status.userId !== ownerPod.pathname.slice(1, -1)) fail('owner_mismatch', 'The current native session belongs to another performer.');
    aliases.add(reported.href);
  }
  async function discover() {
    const result = await tool('dereference', { iri: GAMEPLAY_LEARNING_DESCRIPTOR });
    if (result.status !== 'ok' || !Array.isArray(result.affordances)) fail('learning_delivery_contract', 'The own-subject learning service did not advertise its live contract.');
    const selected = { descriptorUrl: GAMEPLAY_LEARNING_DESCRIPTOR };
    for (const [kind, action] of [['write', GAMEPLAY_LEARNING_WRITE_ACTION], ['read', GAMEPLAY_LEARNING_READ_ACTION]]) {
      const matches = result.affordances.filter(item => item.action === action);
      if (matches.length !== 1) fail('learning_delivery_contract', 'The own-subject learning action is unavailable or ambiguous.');
      selected[kind] = { action, method: matches[0].method, target: matches[0].target };
    }
    return freeze(normalizeContract(selected));
  }
  function payload(list) { return { subject_did: ownerDid, purpose: 'personal-performance', statements: list.map(event => gameplayActivityStatement(event, ownerDid)) }; }
  async function persist(next) {
    active();
    next = validate(next);
    // The private save may commit even when its acknowledgment is lost. Retain
    // its exact pending intent immediately, so a later call cannot replace it.
    // An explicit recovery must confirm this same marker before an external act.
    if (next.pending) { current = next; pendingStateConfirmed = false; }
    const result = await commitState(copy(next)); active();
    if (result?.saved !== true) fail('learning_state_unconfirmed', 'The owner pod has not confirmed this delivery journal.');
    current = next; pendingStateConfirmed = true;
  }
  async function authorized(selected) {
    const token = await journal.authorize({ purpose: GAMEPLAY_LEARNING_PURPOSE, recipient: selected.write.target, taskId }); active();
    if (token?.ownerDid !== ownerDid || token?.sessionId !== sessionId || token?.purpose !== GAMEPLAY_LEARNING_PURPOSE
      || token?.recipient !== selected.write.target || token?.taskId !== taskId || !Number.isFinite(Date.parse(token.expiresAt))
      || Date.parse(token.expiresAt) <= now()) fail('learning_consent_required', 'Current exact owner consent is required for this activity recipient.');
    return token;
  }
  async function signedRequest(input, selected, operation, token) {
    await verifyOwner(); active();
    if (!same(await discover(), selected)) fail('learning_delivery_contract_changed', 'The learning recipient changed. Review its new destination before sending.');
    const signed = await tool('sign_request', { payload: input }); active(); let decoded;
    try { decoded = JSON.parse(signed._signed_payload); } catch { fail('learning_delivery_signature', 'The signed activity request is unreadable.'); }
    if (!plain(decoded) || typeof signed._signature !== 'string' || !signed._signature || signed._signature.length > 4096
      || decoded.agent_id !== delegateDid || !aliases.has(pod(decoded.subject_pod_url).href) || !Number.isFinite(Date.parse(decoded.timestamp))
      || Math.abs(now() - Date.parse(decoded.timestamp)) > 60000
      || Object.keys(decoded).some(key => !['agent_id', 'subject_pod_url', 'timestamp', ...Object.keys(input)].includes(key))
      || !same(Object.fromEntries(Object.entries(decoded).filter(([key]) => !['agent_id', 'subject_pod_url', 'timestamp'].includes(key))), input)) fail('learning_delivery_signature', 'The signed request changed the performer or exact activity batch.');
    if (await journal.assertAuthorized(token) === false || Date.parse(token.expiresAt) <= now()) fail('learning_consent_required', 'Activity consent changed before delivery.'); active();
    return { descriptor_url: selected.descriptorUrl, action_iri: selected[operation].action, payload: signed };
  }
  function bodyOf(response) {
    let body = response.body;
    if (typeof body === 'string') { if (new TextEncoder().encode(body).length > 128 * 1024) fail('learning_delivery_contract', 'The activity receipt is too large.');
      try { body = JSON.parse(body); } catch { fail('learning_delivery_contract', 'The activity receipt is unreadable.'); } }
    if (!plain(body)) fail('learning_delivery_contract', 'The activity receipt is unreadable.'); return body;
  }
  async function acknowledge(pending) {
    const next = { ...current, throughOrdinal: pending.events.at(-1).ordinal,
      acknowledgedCount: current.acknowledgedCount + pending.events.length, pending: null };
    await persist(next); code = null; return { delivered: true, count: pending.events.length, throughOrdinal: next.throughOrdinal };
  }
  async function sendPending() {
    active(); const pending = current.pending; if (!pending) return { delivered: false, pending: false };
    // Old IDs have left the service's bounded detail/deduplication window.
    // Rewriting them could count the same observation twice in its totals.
    if (pending.events.some(event => Date.parse(event.observedAt) <= now() - DETAIL_RETENTION_MS)) fail('learning_delivery_expired', 'This unconfirmed activity is outside the rolling hour. Close it without resending.');
    if (!pendingStateConfirmed) await persist(current);
    const token = await authorized(pending.contract), request = await signedRequest(payload(pending.events), pending.contract, 'write', token);
    if (pending.events.some(event => Date.parse(event.observedAt) <= now() - DETAIL_RETENTION_MS)) fail('learning_delivery_expired', 'This unconfirmed activity is outside the rolling hour. Close it without resending.');
    const response = await tool('act', request); active(); const body = bodyOf(response), ids = pending.events.map(event => event.id.slice(9));
    if (response.status !== 200 || body.ok !== true || body.durable !== true || body.lrsAccepted !== true || body.subjectDid !== ownerDid
      || !same(body.statementIds, ids) || !Array.isArray(body.receipts) || body.receipts.length !== ids.length
      || body.receipts.some((receipt, index) => !plain(receipt) || receipt.statementId !== ids[index] || receipt.persisted !== true
        || receipt.descriptorUrl !== undefined)) fail('learning_delivery_unconfirmed', 'Foxxi has not confirmed every exact activity statement in the private owner record.');
    return acknowledge(pending);
  }
  const api = {
    async connect() {
      currentScope();
      if (closed) fail('learning_delivery_disconnected', 'This delivery connection is closed.');
      let manifest; try { manifest = await tx.connect(REQUIRED, 'get_pod_status'); } catch { fail('learning_delivery_unavailable', 'The native activity transport is unavailable.'); }
      currentScope(); if (!REQUIRED.every(name => manifest.granted?.includes(name))) fail('learning_delivery_unavailable', 'The native transport does not grant activity delivery.');
      await verifyOwner(); contract = await discover(); connected = true; return api.status();
    },
    status() { return { connected: connected && !closed, ownerDid, characterId, sessionId, taskId,
      recipient: contract?.write.target || null, descriptorUrl: contract?.descriptorUrl || null, purpose: GAMEPLAY_LEARNING_PURPOSE,
      pending: !!current.pending, pendingCount: current.pending?.events.length || 0, statePending: !!current.pending && !pendingStateConfirmed, acknowledgedCount: current.acknowledgedCount,
      closedUnconfirmedCount: current.closedUnconfirmedCount, throughOrdinal: current.throughOrdinal, busy, code }; },
    prepare(input) {
      active(); if (current.pending) fail('learning_delivery_pending', 'Reconcile the exact outstanding activity delivery first.');
      if (!Array.isArray(input) || input.length > 128) fail('invalid_activity', 'A bounded list of current observations is required.');
      const selected = input.filter(event => event.ordinal > Math.max(startAfterOrdinal, current.throughOrdinal)).slice(0, MAX_BATCH);
      if (!selected.length) return null;
      const list = events(selected);
      if (list.some(event => Date.parse(event.observedAt) <= now() - DETAIL_RETENTION_MS)) fail('learning_delivery_expired', 'Only observations within the rolling hour can enter the private performance profile.');
      const prepared = freeze({ events: list, contract: copy(contract), subjectDid: ownerDid, characterId,
        sessionId, taskId, recipient: contract.write.target, count: list.length, statementIds: list.map(event => event.id.slice(9)) });
      bounded(prepared); previews.add(prepared); return prepared;
    },
    deliver(prepared) { return serialize(async () => {
      active(); if (current.pending) fail('learning_delivery_pending', 'An uncertain activity delivery is never resent automatically.');
      if (!previews.has(prepared)) fail('learning_preview_required', 'Prepare this connection’s exact activity batch before delivering it.');
      const list = events(prepared.events);
      if (list.some(event => event.ordinal <= Math.max(startAfterOrdinal, current.throughOrdinal))) fail('learning_delivery_scope', 'This observation batch was already delivered or predates session consent.');
      const token = await authorized(prepared.contract); await verifyOwner();
      if (!same(await discover(), prepared.contract)) fail('learning_delivery_contract_changed', 'The learning recipient changed. Review its destination before sending.');
      // Persist exact immutable event IDs BEFORE an external action can happen.
      // A delayed/failed acknowledgment leaves this marker for read-only recovery.
      await persist({ ...current, pending: { events: list, contract: copy(prepared.contract), createdAt: new Date(now()).toISOString() } });
      if (await journal.assertAuthorized(token) === false) fail('learning_consent_required', 'Activity consent changed while saving the delivery journal.'); active();
      try { return await sendPending(); } catch (cause) { code = cause?.code || 'learning_delivery_unconfirmed'; throw cause; }
    }); },
    /** Explicit recovery only. Neither connect nor deliver retries uncertainty. */
    retryPending() { return serialize(async () => { try { return await sendPending(); } catch (cause) { code = cause?.code || 'learning_delivery_unconfirmed'; throw cause; } }); },
    /** Explicit local closure is not a delivery receipt or an acknowledgment.
     * It needs the verified owner save, but sends no activity to any recipient. */
    abandonPending() { return serialize(async () => {
      active(); const pending = current.pending;
      if (!pending) return { closedUnconfirmed: false, count: 0 };
      const count = pending.events.length, next = { ...current, pending: null,
        throughOrdinal: pending.events.at(-1).ordinal, closedUnconfirmedCount: current.closedUnconfirmedCount + count };
      await persist(next); code = null;
      return { closedUnconfirmed: true, count, throughOrdinal: next.throughOrdinal };
    }); },
    closePending() { return api.abandonPending(); },
    reconcile() { return serialize(async () => {
      active(); const pending = current.pending; if (!pending) return { delivered: false, pending: false };
      const token = await authorized(pending.contract), expected = payload(pending.events).statements;
      for (const statement of expected) {
        const request = await signedRequest({ subject_did: ownerDid, purpose: 'personal-performance', query: { statementId: statement.id } }, pending.contract, 'read', token);
        const response = await tool('act', request); active(); const body = bodyOf(response);
        if (response.status === 404 || response.status === 410) return { delivered: false, pending: true,
          ...(response.status === 410 ? { expired: true } : {}), missingStatementId: statement.id };
        if (response.status !== 200 || body.ok !== true || body.durable !== true || body.subjectDid !== ownerDid || !plain(body.statement)) fail('learning_delivery_unconfirmed', 'The owner LRS did not confirm this exact statement in its durable private record.');
        const { authority, stored, version, ...actual } = body.statement;
        if (!same(actual, statement) || !plain(authority) || !iso(stored)) fail('learning_delivery_conflict', 'The LRS statement differs from the original observed activity.');
      }
      return acknowledge(pending);
    }); },
    save: () => copy(current),
    close() { closed = true; connected = false; tx.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, expiresAt: now() }); },
  };
  return Object.freeze(api);
}
