/** Read-only own-account activity. No journal, recording grant, delegation repair,
 * persistence, hidden publication or write action belongs in this reader. */
import { RelayMcpTransport } from './vendor/interego-browser.mjs';

export const GAMEPLAY_RECORD_DESCRIPTOR = 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/affordance';
export const GAMEPLAY_RECORD_READ_ACTION = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/read-own-subject-xapi-statements-signed';
export const GAMEPLAY_RECORD_LIMITS = Object.freeze({ page: 200, bytes: 4 * 1024 * 1024, statementBytes: 18 * 1024, cursor: 8192, pages: 512 });
const REQUIRED = ['get_pod_status', 'dereference', 'sign_request', 'act'];
const CONTEXT = 'urn:interego:gaming:activity:context', OBSERVATION = 'urn:interego:gaming:activity:observation';
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (a, b) => canonical(a) === canonical(b);
const freeze = value => { if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); } return value; };
const integer = value => Number.isSafeInteger(value) && value >= 0;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const iso = value => typeof value === 'string' && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value;
const text = (value, max = 1024) => typeof value === 'string' && value.length > 0 && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
function exact(value, fields) { if (!plain(value) || Object.keys(value).some(key => !fields.includes(key))) fail('account_record_contract', 'The account record does not match its bounded contract.'); }
function finite(value, depth = 0, seen = new Set()) {
  if (depth > 24) return false;
  if (value === null || ['string', 'boolean'].includes(typeof value)) return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if ((!plain(value) && !Array.isArray(value)) || seen.has(value)) return false;
  seen.add(value); const ok = Object.values(value).every(child => finite(child, depth + 1, seen)); seen.delete(value); return ok;
}
function bounded(value, max = GAMEPLAY_RECORD_LIMITS.bytes) {
  if (!finite(value) || new TextEncoder().encode(JSON.stringify(value)).length > max) fail('account_record_contract', 'The account record exceeds its supported capacity.');
  return copy(value);
}
function pod(value, secure = false) {
  let url; try { url = new URL(value); } catch { fail('account_record_owner_mismatch', 'The authenticated account pod is unreadable.'); }
  if (!(secure ? url.protocol === 'https:' : ['https:', 'http:'].includes(url.protocol)) || url.username || url.password || url.search || url.hash
    || !/^\/[A-Za-z0-9_-]+\/$/.test(url.pathname) || url.href !== value) fail('account_record_owner_mismatch', 'An authenticated own-pod root is required.');
  return url;
}
function queryInput(value) {
  exact(value, ['statementId', 'verb', 'activity', 'registration', 'since', 'until', 'ascending', 'limit']);
  if (value.statementId !== undefined) {
    if (!uuid(value.statementId) || Object.keys(value).length !== 1) fail('account_record_query', 'Use one statement UUID without other filters.');
    return { statementId: value.statementId };
  }
  const result = { limit: 100, ...value };
  if (!Number.isInteger(result.limit) || result.limit < 1 || result.limit > GAMEPLAY_RECORD_LIMITS.page
    || result.ascending !== undefined && typeof result.ascending !== 'boolean'
    || ['verb', 'activity'].some(key => result[key] !== undefined && (!text(result[key], 2048) || !/^[a-z][a-z0-9+.-]*:[^\s<>"{}|^`\\]+$/i.test(result[key])))
    || result.registration !== undefined && !uuid(result.registration)
    || ['since', 'until'].some(key => result[key] !== undefined && !iso(result[key]))
    || result.since !== undefined && result.until !== undefined && result.since > result.until) fail('account_record_query', 'Use bounded account activity filters and observed ISO time limits.');
  return copy(result);
}

export function createOwnerGameplayRecordReader({ binding, credential, relayUrl, assertCurrent = () => true, transport, now = Date.now } = {}) {
  const owner = /^did:web:([^:]+):users:([A-Za-z0-9_-]+)$/.exec(binding?.subjectDid || '');
  if (!owner || typeof binding?.authenticatedAgentDid !== 'string' || !/^did:web:[^\s<>"{}|^`\\]+$/.test(binding.authenticatedAgentDid)
    || typeof assertCurrent !== 'function' || typeof now !== 'function') throw new TypeError('A current authenticated native account binding is required.');
  const ownerDid = binding.subjectDid, agentDid = binding.authenticatedAgentDid, ownerPod = pod(binding.podUrl, true);
  const identity = new URL('https://' + decodeURIComponent(owner[1]));
  if (identity.pathname !== '/' || identity.username || identity.password || identity.search || identity.hash || ownerPod.pathname !== '/' + owner[2] + '/') throw new TypeError('The native account identity and pod must agree.');
  const relay = new URL(relayUrl);
  if (relay.protocol !== 'https:' || relay.origin !== relayUrl) throw new TypeError('An HTTPS native relay origin is required.');
  if (!transport && (credential?.kind !== 'relay-oauth-bearer' || !text(credential.accessToken, 16384) || credential.refreshToken
    || credential.expiresAt !== undefined && (!Number.isFinite(credential.expiresAt) || credential.expiresAt <= now()))) throw new TypeError('A current browser-only native access credential is required.');
  const tx = transport || new RelayMcpTransport(relay.origin, { ...credential }, globalThis.fetch.bind(globalThis));
  credential = null;
  const pages = new WeakMap(), aliases = new Set([ownerPod.href]);
  let closed = false, connected = false, busy = false, contract = null, queue = Promise.resolve(), epoch = 0, code = null;
  function current(selected = epoch) {
    if (closed || selected !== epoch) fail('account_record_closed', 'This account record connection is closed.');
    if (assertCurrent() === false) fail('account_record_scope_changed', 'The signed-in account changed before the read completed.');
  }
  async function tool(name, input) {
    const selected = epoch; current(selected); let result;
    try { result = await tx.callTool(name, input, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch (error) { current(selected); fail(error?.code === 'needs_reauth' ? 'needs_reauth' : 'account_record_unavailable', 'The native account record service did not complete this read.'); }
    current(selected);
    if (!plain(result) || result.error) fail(result?.error === 'needs_reauth' ? 'needs_reauth' : 'account_record_unavailable', 'The native service refused this account read.');
    return result;
  }
  async function verifyOwner() {
    const status = await tool('get_pod_status', {}), reported = pod(status.pod);
    if (status.identity?.did !== ownerDid || status.sessionAgent?.did !== agentDid || reported.pathname !== ownerPod.pathname || status.userId !== owner[2])
      fail('account_record_owner_mismatch', 'The current native session belongs to another account.');
    const registry = status.delegationRegistry, webId = identity.origin + '/users/' + owner[2] + '/profile#me';
    const rows = registry?.rows?.filter?.(row => row?.agentId === agentDid), row = rows?.length === 1 ? rows[0] : null;
    if (!plain(registry) || registry.owner !== webId || registry.url !== reported.href + 'agents' || !Array.isArray(registry.rows)
      || registry.count !== registry.rows.length || !row || !['ReadWrite', 'ReadOnly', 'DiscoverOnly'].includes(row.scope)
      || row.revoked !== undefined && row.revoked !== false
      || row.validFrom !== undefined && (typeof row.validFrom !== 'string' || !Number.isFinite(Date.parse(row.validFrom)) || Date.parse(row.validFrom) > now())
      || row.validUntil !== undefined && (typeof row.validUntil !== 'string' || !Number.isFinite(Date.parse(row.validUntil)) || Date.parse(row.validUntil) <= now()))
      fail('account_record_delegation_required', 'This account needs an existing discover delegation before its record can be read.');
    aliases.add(reported.href);
  }
  async function discover() {
    const result = await tool('dereference', { iri: GAMEPLAY_RECORD_DESCRIPTOR });
    const found = result.affordances?.filter?.(item => item.action === GAMEPLAY_RECORD_READ_ACTION);
    if (result.status !== 'ok' || !Array.isArray(found) || found.length !== 1) fail('account_record_contract', 'The live own-account read action is unavailable or ambiguous.');
    const item = found[0]; let target; try { target = new URL(item.target); } catch { fail('account_record_contract', 'The account read target is unreadable.'); }
    if (item.method !== 'POST' || target.origin !== new URL(GAMEPLAY_RECORD_DESCRIPTOR).origin || target.protocol !== 'https:'
      || target.username || target.password || target.search || target.hash || target.href !== item.target || /[{}]/.test(item.target)) fail('account_record_contract', 'The live account read contract has an unsupported target.');
    return freeze({ descriptorUrl: GAMEPLAY_RECORD_DESCRIPTOR, action: GAMEPLAY_RECORD_READ_ACTION, method: 'POST', target: target.href });
  }
  function coverage(value) {
    exact(value, ['model', 'completeHistory', 'retentionMs', 'maxDetailedStatements', 'maxReceiptIds', 'from', 'retainedFrom', 'through', 'retainedCount', 'prunedCount', 'observationAuthority', 'competencyStatus']);
    if (value.model !== 'bounded-personal-observation-profile' || value.completeHistory !== false || value.retentionMs !== 3600000
      || value.maxDetailedStatements !== 512 || value.maxReceiptIds !== 4096 || !iso(value.from)
      || value.retainedFrom !== null && !iso(value.retainedFrom) || value.through !== null && !iso(value.through)
      || !integer(value.retainedCount) || value.retainedCount > 512 || !integer(value.prunedCount)
      || value.observationAuthority !== 'owner-browser-observation' || value.competencyStatus !== 'not-assessed') fail('account_record_contract', 'The native record did not describe its actual retained observation window.');
    return copy(value);
  }
  function summary(value) {
    exact(value, ['total', 'byVerb', 'byBody', 'byController', 'otherVerb', 'otherBody', 'otherController', 'saturated', 'firstAt', 'lastAt', 'detailsPruned']);
    if (!integer(value.total) || !integer(value.detailsPruned) || typeof value.saturated !== 'boolean'
      || value.firstAt !== null && !iso(value.firstAt) || value.lastAt !== null && !iso(value.lastAt)) fail('account_record_contract', 'The native cumulative account counts are unreadable.');
    for (const [kind, limit] of [['Verb', 64], ['Body', 17], ['Controller', 16]]) {
      const rows = value['by' + kind], other = value['other' + kind];
      if (!Array.isArray(rows) || rows.length > limit || !integer(other) || new Set(rows.map(row => row?.id)).size !== rows.length
        || rows.some(row => !plain(row) || Object.keys(row).some(key => !['id', 'count'].includes(key)) || typeof row.id !== 'string' || row.id.length > 1024 || !integer(row.count))
        || rows.reduce((total, row) => total + row.count, other) !== value.total) fail('account_record_contract', 'The native account count totals do not agree.');
    }
    return copy(value);
  }
  function statement(value, filters) {
    const s = bounded(value, GAMEPLAY_RECORD_LIMITS.statementBytes), actor = s.actor;
    if (!uuid(s.id) || !plain(actor) || Object.keys(actor).some(key => !['objectType', 'name', 'account'].includes(key))
      || actor.objectType !== undefined && actor.objectType !== 'Agent' || actor.name !== undefined && typeof actor.name !== 'string' || !plain(actor.account)
      || Object.keys(actor.account).some(key => !['homePage', 'name'].includes(key)) || actor.account.name !== ownerDid || actor.account.homePage !== identity.origin)
      fail('account_record_owner_mismatch', 'The returned statement belongs to another account or actor identity.');
    if (!iso(s.timestamp) || !iso(s.stored) || s.version !== '2.0.0' || !text(s.verb?.id, 2048) || !text(s.object?.id, 2048) || s.attachments !== undefined
      || s.object.objectType !== undefined && s.object.objectType !== 'Activity' || s.authority?.objectType !== 'Agent'
      || s.authority.account?.name !== 'foxxi-personal-activity-window' || !text(s.authority.account.homePage, 2048)) fail('account_record_contract', 'The returned activity envelope is not a supported durable account observation.');
    const ctx = s.context?.extensions?.[CONTEXT], observed = s.result?.extensions?.[OBSERVATION];
    if (ctx !== undefined && (!plain(ctx) || !text(ctx.bodyId, 128) || !['character', 'owned-unit'].includes(ctx.bodyKind)
      || !['human-input', 'agent', 'unattributed', 'companion-autonomy'].includes(ctx.controllerKind))) fail('account_record_contract', 'The returned gameplay body or controller context is inconsistent.');
    if (observed !== undefined && (!plain(observed) || observed.authority !== 'owner-browser-observation' || observed.competencyStatus !== 'not-assessed')) fail('account_record_contract', 'The returned observation changes its evidence authority or assessment status.');
    if (filters.statementId !== undefined && s.id !== filters.statementId || filters.verb !== undefined && s.verb.id !== filters.verb
      || filters.activity !== undefined && s.object.id !== filters.activity || filters.registration !== undefined && s.context?.registration !== filters.registration
      || filters.since !== undefined && s.stored <= filters.since || filters.until !== undefined && s.stored > filters.until) fail('account_record_contract', 'The returned statement does not match the requested account query.');
    return s;
  }
  function cursor(value, chain, offset) {
    if (!text(value, GAMEPLAY_RECORD_LIMITS.cursor) || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(value)) fail('account_record_contract', 'The native continuation is not an opaque snapshot cursor.');
    let decoded; try { const raw = value.split('.')[0], binary = globalThis.atob(raw.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - raw.length % 4) % 4));
      decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(binary, char => char.charCodeAt(0)))); }
    catch { fail('account_record_contract', 'The account snapshot cursor is unreadable.'); }
    exact(decoded, ['revision', 'query', 'offset', 'expiresAt']);
    if (!text(decoded.revision, 2048) || !same(decoded.query, chain.query) || decoded.offset !== offset || !integer(decoded.expiresAt)
      || decoded.expiresAt <= now() || chain.revision !== null && decoded.revision !== chain.revision) fail('account_record_snapshot_changed', 'The native account view changed or expired. Load the account record again.');
    return { value, revision: decoded.revision, expiresAt: decoded.expiresAt };
  }
  async function read(filters, chain) {
    current(); if (!connected) fail('account_record_disconnected', 'Connect the signed-in account before reading its record.');
    await verifyOwner();
    if (!same(await discover(), contract)) fail('account_record_contract_changed', 'The live account read destination changed. Reconnect before reading.');
    const input = { subject_did: ownerDid, purpose: 'personal-performance', query: filters };
    const signed = await tool('sign_request', { payload: input }); let payload;
    try { payload = JSON.parse(signed._signed_payload); } catch { fail('account_record_signature', 'The native read signature is unreadable.'); }
    if (!plain(payload) || !text(signed._signature, 4096) || payload.agent_id !== agentDid || !aliases.has(pod(payload.subject_pod_url).href)
      || !iso(payload.timestamp) || Math.abs(now() - Date.parse(payload.timestamp)) > 60000
      || Object.keys(payload).some(key => !['agent_id', 'subject_pod_url', 'timestamp', ...Object.keys(input)].includes(key))
      || !same(Object.fromEntries(Object.entries(payload).filter(([key]) => !['agent_id', 'subject_pod_url', 'timestamp'].includes(key))), input)) fail('account_record_signature', 'The native signature changed the account, purpose or exact read filters.');
    await verifyOwner();
    if (Math.abs(now() - Date.parse(payload.timestamp)) > 60000) fail('account_record_signature', 'The native read signature expired while account authority was checked. Retry the read.');
    const response = await tool('act', { descriptor_url: contract.descriptorUrl, action_iri: contract.action, payload: signed });
    await verifyOwner();
    if (response.status === 401) fail('needs_reauth', 'Sign in to the native account again before reading.');
    if (response.status === 403) fail('account_record_delegation_required', 'The native authorizer did not confirm this account discover delegation.');
    if (response.status === 409) fail('account_record_snapshot_changed', 'The native account view changed. Load the account record again.');
    if (response.status >= 500 || response.status === 429) fail('account_record_unavailable', 'The native account record is temporarily unavailable.');
    let body = response.body;
    if (typeof body === 'string') { if (new TextEncoder().encode(body).length > GAMEPLAY_RECORD_LIMITS.bytes) fail('account_record_contract', 'The account page is too large.'); try { body = JSON.parse(body); } catch { fail('account_record_contract', 'The account response is unreadable.'); } }
    body = bounded(body);
    if (body.subjectDid !== ownerDid) fail('account_record_owner_mismatch', 'The native response belongs to another account.');
    const window = coverage(body.coverage), checkedAt = new Date(now()).toISOString();
    if ([404, 410].includes(response.status) && filters.statementId && body.ok === false) return freeze({ state: response.status === 404 ? 'missing' : 'detail-unavailable', ownerDid, statements: [], coverage: window, summary: null, more: false, checkedAt });
    if (response.status !== 200 || body.ok !== true || body.durable !== true) fail('account_record_contract', 'The native account read was not durably confirmed.');
    const single = filters.statementId !== undefined;
    const rows = single ? [statement(body.statement, chain.query)] : Array.isArray(body.statements) ? body.statements.map(value => statement(value, chain.query)) : null;
    if (!rows || rows.length > (chain.query.limit || 1) || new Set(rows.map(row => row.id)).size !== rows.length || rows.some(row => chain.ids.has(row.id))) fail('account_record_contract', 'The account page repeats or exceeds its requested statement window.');
    const totals = single ? null : summary(body.profile);
    if (!single && (window.retainedCount + window.prunedCount !== totals.total || totals.total < rows.length
      || chain.summary && (!same(totals, chain.summary) || window.retainedCount !== chain.retainedCount))) fail('account_record_snapshot_changed', 'The account totals changed during this snapshot. Load the account record again.');
    if (!single && typeof body.more !== 'string') fail('account_record_contract', 'The native account continuation marker is missing.');
    const offset = chain.offset + rows.length, next = !single && body.more ? cursor(body.more, chain, chain.offset + chain.query.limit) : null;
    if (next && rows.length !== chain.query.limit || offset > 512) fail('account_record_contract', 'The native account page has inconsistent snapshot bounds.');
    const page = freeze({ state: 'loaded', ownerDid, statements: rows, coverage: window, summary: totals, more: !!next, checkedAt });
    const ids = new Set([...chain.ids, ...rows.map(row => row.id)]);
    if (next) pages.set(page, { cursor: next.value, expiresAt: next.expiresAt, chain: { ...chain, offset, revision: next.revision, ids, summary: totals, retainedCount: window.retainedCount, pages: chain.pages + 1 } });
    return page;
  }
  const serialized = run => { const result = queue.then(async () => { current(); busy = true; try { code = null; return await run(); } catch (error) { code = error.code || 'account_record_unavailable'; throw error; } finally { busy = false; } }); queue = result.catch(() => {}); return result; };
  const api = {
    connect() { return serialized(async () => { connected = false; contract = null; const selected = epoch; const manifest = await tx.connect(REQUIRED, 'get_pod_status'); current(selected);
      if (!REQUIRED.every(name => manifest.granted?.includes(name))) fail('account_record_unavailable', 'The native session does not provide account record reads.');
      await verifyOwner(); contract = await discover(); connected = true; return api.status(); }); },
    status() { return { connected: connected && !closed, closed, busy, ownerDid, readOnly: true, recordingConsentRequired: false, recipient: contract?.target || null, code }; },
    query(filters = {}) { const selected = freeze(queryInput(filters)); return serialized(() => read(selected, { query: selected, offset: 0, revision: null, ids: new Set(), summary: null, retainedCount: null, pages: 0 })); },
    next(page) { return serialized(() => { const continuation = pages.get(page);
      if (!continuation) fail('account_record_cursor', 'Continue only a page returned by this account reader.');
      if (continuation.expiresAt <= now() || continuation.chain.pages >= GAMEPLAY_RECORD_LIMITS.pages) fail('account_record_snapshot_changed', 'This bounded account snapshot expired. Load it again.');
      return read({ cursor: continuation.cursor }, continuation.chain).then(result => { pages.delete(page); return result; }); }); },
    close() { if (closed) return; closed = true; connected = false; contract = null; epoch++; aliases.clear();
      tx.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', refreshToken: null, expiresAt: now() }); },
  };
  return Object.freeze(api);
}
