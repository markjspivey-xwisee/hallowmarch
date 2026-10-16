/**
 * Hallowmarch-owned participation registry over the injected native gaming
 * stream. It stores public owner bindings and owner-pod record pointers only.
 * Personal game state, credentials and private keys never belong in this ledger.
 *
 * bindVerified is a trusted composition port: only the authenticated identity
 * bridge may call it. Syntactically valid caller-supplied DIDs are not proofs.
 * The synchronous lookups are disposable views of confirmed native state.
 */
import { createHash } from 'node:crypto';

const SCHEMA = 'urn:interego:gaming:player-bindings:v1';
const DEFAULT_STORES = ['https://gate.interego.xwisee.com/', 'http://css.railway.internal:3456/'];
const USER_ID = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const own = (value, key) => Object.hasOwn(value, key);
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const copy = value => structuredClone(value);
const canonical = value => plain(value) ? '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
  : Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']' : JSON.stringify(value);
const equal = (a, b) => canonical(a) === canonical(b);
const hash = value => createHash('sha256').update(value).digest('hex');

export class PlayerBindingError extends Error {
  constructor(message, code = 'INVALID_PLAYER_BINDING', status = 400) {
    super(message); this.name = 'PlayerBindingError'; this.code = code; this.status = status;
  }
}
function fail(message, code, status) { throw new PlayerBindingError(message, code, status); }
function text(value, label, max = 256) {
  if (typeof value !== 'string' || !value || Buffer.byteLength(value) > max || /[\s\u0000-\u001f\u007f]/.test(value)) {
    fail('Invalid ' + label + '.');
  }
  return value;
}
function url(value, label) {
  text(value, label, 2048);
  let parsed;
  try { parsed = new URL(value); } catch { fail('Invalid ' + label + '.'); }
  // Reject before URL normalization can erase traversal or encoded separators.
  if (parsed.href !== value || parsed.username || parsed.password || parsed.search || parsed.hash
    || /[%\\]/.test(value) || /\/{2}/.test(parsed.pathname)) fail('Invalid ' + label + '.');
  return parsed;
}
function configuredBases(values) {
  if (!Array.isArray(values) || !values.length || values.length > 16) throw new TypeError('Trusted native store bases are required.');
  return values.map((value, index) => {
    const parsed = url(value, 'native store base');
    if (!parsed.pathname.endsWith('/') || !['https:', 'http:'].includes(parsed.protocol)
      || (index === 0 && parsed.protocol !== 'https:')) throw new TypeError('The first native store base requires public HTTPS.');
    return parsed;
  });
}

/** No filesystem, SQL, bearer-token, key-custody or memory-primary fallback. */
export function createPlayerBindingLedger({ store, now = Date.now, streamId = 'player-bindings-v1',
  maxBindings = 500, storeBases = DEFAULT_STORES, conflictRetries = 3 } = {}) {
  text(streamId, 'binding stream', 128);
  if (typeof now !== 'function' || !Number.isSafeInteger(maxBindings) || maxBindings < 1 || maxBindings > 10000
    || !Number.isSafeInteger(conflictRetries) || conflictRetries < 0 || conflictRetries > 8) throw new TypeError('Invalid binding ledger bounds.');
  if (store !== undefined && store !== null && !['ready', 'load', 'commit'].every(key => typeof store[key] === 'function')) {
    throw new TypeError('An existing native gaming store is required.');
  }
  const bases = configuredBases(storeBases);
  let snapshot = null, healthy = false, lastError = null, initialized = false, highestVersion = -1, highestDigest = null;
  const configured = Boolean(store);
  const unavailable = () => fail('Native participation bindings are unavailable.', 'NATIVE_BINDINGS_UNAVAILABLE', 503);
  const aborted = signal => { if (signal?.aborted) fail('Participation operation was cancelled.', 'OPERATION_ABORTED', 499); };
  const timestamp = () => {
    const value = now();
    if (!Number.isFinite(value)) fail('Participation clock is unavailable.', 'NATIVE_BINDINGS_UNAVAILABLE', 503);
    return new Date(value).toISOString();
  };

  function bindingOf(value) {
    if (!plain(value)) fail('A verified native owner binding is required.');
    const subjectDid = text(value.subjectDid, 'owner DID', 512), userId = text(value.userId, 'owner user ID', 128);
    if (!USER_ID.test(userId)) fail('Invalid native owner user ID.');
    const match = subjectDid.match(/^did:web:([^:]+):users:([A-Za-z0-9][A-Za-z0-9._-]{0,127})$/);
    if (!match || match[2] !== userId) fail('Native owner DID and user ID disagree.');
    let identity;
    try { identity = new URL('https://' + decodeURIComponent(match[1])); } catch { fail('Invalid native identity host.'); }
    if (identity.pathname !== '/' || identity.username || identity.password || identity.search || identity.hash
      || identity.host.replace(/:/g, '%3A') !== match[1]) fail('Invalid native identity host.');
    const webId = text(value.webId, 'owner WebID', 1024);
    if (webId !== identity.origin + '/users/' + userId + '/profile#me') fail('Native owner DID and WebID disagree.');
    const pod = url(value.podUrl, 'owner pod');
    if (!bases.some(base => pod.origin === base.origin && pod.pathname === base.pathname + userId + '/')) {
      fail('Native owner pod does not match the verified user.');
    }
    const authenticatedAgentDid = text(value.authenticatedAgentDid, 'authenticated agent DID', 768);
    const agentPrefix = 'did:web:' + match[1] + ':agents:';
    const agentId = authenticatedAgentDid.startsWith(agentPrefix) ? authenticatedAgentDid.slice(agentPrefix.length) : '';
    if (!/^[A-Za-z0-9][A-Za-z0-9._-]{1,255}$/.test(agentId) || !agentId.endsWith('-' + userId)) fail('Authenticated native agent does not match the owner.');
    const verifiedAt = text(value.verifiedAt, 'owner verification time', 32);
    if (!Number.isFinite(Date.parse(verifiedAt)) || new Date(verifiedAt).toISOString() !== verifiedAt) fail('Invalid owner verification time.');
    const issuer = url(value.issuer, 'identity issuer');
    if (issuer.protocol !== 'https:') fail('Identity issuer requires HTTPS.');
    return { subjectDid, webId, userId, podUrl: bases[0].href + userId + '/', authenticatedAgentDid,
      verifiedAt, issuer: issuer.href, verificationMethod: text(value.verificationMethod, 'verification method', 128) };
  }
  function accountIdOf(value) { return text(value, 'game account ID', 256); }
  function summaryOf(value, accountId) {
    if (value === undefined) return undefined;
    if (!plain(value) || value.id !== accountId || typeof value.name !== 'string' || !value.name.trim()
      || Buffer.byteLength(value.name) > 128 || /[\u0000-\u001f\u007f]/.test(value.name) || typeof value.guest !== 'boolean') {
      fail('Invalid public game account summary.');
    }
    return { id: accountId, name: value.name, guest: value.guest };
  }
  function pointerOf(value, binding) {
    if (!plain(value) || value.kind !== 'character') fail('A character record pointer is required.');
    const graphIri = text(value.graphIri, 'owner record graph', 1024);
    if (!/^urn:graph:[^\s]+$/.test(graphIri)) fail('Invalid owner record graph.');
    const descriptor = url(value.descriptorUrl, 'owner record descriptor');
    const matchedBase = bases.find(base => descriptor.origin === base.origin
      && descriptor.pathname.startsWith(base.pathname + binding.userId + '/'));
    if (!matchedBase) fail('Record descriptor escaped its owner pod.', 'PLAYER_RECORD_OWNER_MISMATCH', 403);
    const suffix = descriptor.pathname.slice((matchedBase.pathname + binding.userId + '/').length);
    if (!suffix || suffix.endsWith('/')) fail('A concrete owner record descriptor is required.');
    const result = { kind: 'character', graphIri, descriptorUrl: binding.podUrl + suffix };
    if (value.cid !== undefined) result.cid = text(value.cid, 'owner record content ID', 256);
    return result;
  }
  function stateOf(value) {
    if (!plain(value) || value.schema !== SCHEMA || !Array.isArray(value.bindings) || value.bindings.length > maxBindings
      || Object.keys(value).some(key => !['schema', 'bindings'].includes(key))) fail('Native participation state is malformed.');
    const accounts = new Set(), dids = new Set();
    const bindings = value.bindings.map(entry => {
      if (!plain(entry) || Object.keys(entry).some(key => !['accountId', 'binding', 'accountSummary', 'records'].includes(key))) fail('Native participation entry is malformed.');
      const accountId = accountIdOf(entry.accountId), binding = bindingOf(entry.binding);
      if (!equal(entry.binding, binding) || accounts.has(accountId) || dids.has(binding.subjectDid)) fail('Native participation ownership is ambiguous.');
      accounts.add(accountId); dids.add(binding.subjectDid);
      const result = { accountId, binding };
      const accountSummary = summaryOf(entry.accountSummary, accountId);
      if (accountSummary !== undefined) {
        if (!equal(accountSummary, entry.accountSummary)) fail('Native public account summary is malformed.');
        result.accountSummary = accountSummary;
      }
      if (!plain(entry.records) || Object.keys(entry.records).some(key => key !== 'character')) fail('Native personal record pointers are malformed.');
      result.records = {};
      if (own(entry.records, 'character')) {
        result.records.character = pointerOf(entry.records.character, binding);
        if (!equal(result.records.character, entry.records.character)) fail('Native owner record pointer is malformed.');
      }
      return result;
    });
    return { schema: SCHEMA, bindings };
  }
  function snapshotOf(value) {
    if (!plain(value) || !Number.isSafeInteger(value.version) || value.version < 0
      || (value.version === 0 && value.state !== null) || (value.version > 0 && value.state === null)) fail('Native participation snapshot is malformed.');
    return { version: value.version, state: value.version === 0 ? { schema: SCHEMA, bindings: [] } : stateOf(value.state) };
  }
  function retain(value) {
    // Concurrent reads may finish out of order; an old view cannot erase a
    // newer confirmed binding. A conflicting same-version view is corruption.
    const digest = hash(canonical(value.state));
    if (value.version === highestVersion && digest !== highestDigest) fail('Native participation version equivocated.');
    if (!snapshot && value.version < highestVersion) fail('Native participation read regressed behind confirmed ownership.');
    if (value.version > highestVersion) { highestVersion = value.version; highestDigest = digest; }
    if (!snapshot || value.version >= snapshot.version) snapshot = value;
    healthy = true; lastError = null;
    return copy(snapshot);
  }
  function corrupt(error) {
    healthy = false; snapshot = null;
    lastError = error instanceof PlayerBindingError ? error : new PlayerBindingError('Native participation read failed.', 'NATIVE_BINDINGS_UNAVAILABLE', 503);
    if (lastError.code === 'INVALID_PLAYER_BINDING') lastError = new PlayerBindingError('Native participation state is corrupt.', 'CORRUPT_DURABLE_STATE', 503);
    throw lastError;
  }
  async function refresh() {
    if (!configured) return null;
    try { return retain(snapshotOf(await store.load(streamId))); } catch (error) { return corrupt(error); }
  }
  const ready = (async () => {
    if (!configured) { initialized = true; return null; }
    try { await store.ready(); return await refresh(); }
    catch (error) { return corrupt(error); }
    finally { initialized = true; }
  })();
  // Startup callers still observe rejection through ready; this also prevents
  // an unhandled rejection when the host deliberately serves a disabled mode.
  ready.catch(() => {});
  async function usable(signal) {
    aborted(signal);
    if (!initialized) await ready;
    if (!configured || !healthy || !snapshot) unavailable();
  }
  function lookup(predicate) { return healthy && snapshot ? copy(snapshot.state.bindings.find(predicate) ?? null) : null; }
  function operation(value) { return text(value, 'participation operation ID', 256); }
  async function mutate(kind, operationId, signal, transform) {
    await usable(signal);
    for (let attempt = 0; attempt <= conflictRetries; attempt++) {
      aborted(signal);
      const current = await refresh(); aborted(signal);
      const next = transform(current.state, current.version);
      if (!next.state) return next.result;
      try {
        await store.commit(streamId, { expectedVersion: current.version, state: next.state, event: next.event,
          idempotencyKey: 'player-binding-v1:' + kind + ':' + hash(operationId) });
      } catch (error) {
        if (error?.code === 'VERSION_CONFLICT' && attempt < conflictRetries) continue;
        // Do not promote the proposed state to cache on an uncertain write.
        healthy = false; snapshot = null; lastError = error;
        throw error;
      }
      let confirmed;
      try { confirmed = snapshotOf(await store.load(streamId)); } catch (error) { return corrupt(error); }
      if (confirmed.version < current.version + 1 || !next.confirm(confirmed.state)) {
        return corrupt(new PlayerBindingError('Native participation commit lacks matching readback.', 'COMMIT_UNCERTAIN', 503));
      }
      try { retain(confirmed); } catch (error) { return corrupt(error); }
      // A cancellation can suppress the HTTP acknowledgement, but cannot undo
      // a native commit that has already been confirmed. Retry reads its result.
      aborted(signal);
      return { ...next.result, version: confirmed.version };
    }
    fail('Native participation ledger is busy.', 'VERSION_CONFLICT', 409);
  }
  async function bindVerified(value, requestedAccountId, { operationId, accountSummary, signal } = {}) {
    const binding = bindingOf(value), accountId = accountIdOf(requestedAccountId), summary = summaryOf(accountSummary, accountId);
    operation(operationId);
    const recordedAt = timestamp();
    return mutate('bind', operationId, signal, (state, version) => {
      const requested = state.bindings.find(entry => entry.accountId === accountId);
      if (requested && requested.binding.subjectDid !== binding.subjectDid) fail('Game account already belongs to another native identity.', 'PLAYER_BINDING_CONFLICT', 409);
      const existing = state.bindings.find(entry => entry.binding.subjectDid === binding.subjectDid);
      if (existing) return { result: { accountId: existing.accountId, binding: copy(existing.binding), restored: existing.accountId !== accountId, version } };
      if (state.bindings.length >= maxBindings) fail('Native participation registry reached its configured capacity.', 'BINDING_CAPACITY', 503);
      const entry = { accountId, binding, ...(summary === undefined ? {} : { accountSummary: summary }), records: {} };
      const next = { schema: SCHEMA, bindings: [...state.bindings, entry] };
      return { state: next, event: { kind: 'player-bound', accountId, subjectDid: binding.subjectDid, recordedAt },
        result: { accountId, binding: copy(binding), restored: false },
        confirm: persisted => persisted.bindings.some(item => item.accountId === accountId && equal(item.binding, binding)) };
    });
  }
  async function linkRecord(accountId, subjectDid, value, { operationId, signal } = {}) {
    accountIdOf(accountId); text(subjectDid, 'owner DID', 512); operation(operationId);
    const recordedAt = timestamp();
    if (!plain(value)) fail('A character record pointer is required.');
    const input = { kind: value.kind, graphIri: value.graphIri, descriptorUrl: value.descriptorUrl,
      ...(value.cid === undefined ? {} : { cid: value.cid }) };
    return mutate('record', operationId, signal, (state, version) => {
      const entry = state.bindings.find(item => item.accountId === accountId);
      if (!entry || entry.binding.subjectDid !== subjectDid) fail('Only the bound owner may link a personal record.', 'PLAYER_RECORD_OWNER_MISMATCH', 403);
      const pointer = pointerOf(input, entry.binding);
      const result = { accountId, subjectDid, pointer, version };
      if (equal(entry.records.character, pointer)) return { result };
      const next = copy(state);
      next.bindings.find(item => item.accountId === accountId).records.character = pointer;
      return { state: next, event: { kind: 'player-record-linked', accountId, subjectDid, pointer, recordedAt }, result,
        confirm: persisted => equal(persisted.bindings.find(item => item.accountId === accountId)?.records.character, pointer) };
    });
  }
  return Object.freeze({ ready, get enabled() { return configured && healthy; }, refresh,
    status: () => ({ configured, ready: healthy, version: healthy ? snapshot.version : null,
      bindings: healthy ? snapshot.state.bindings.length : 0, error: lastError?.code ?? null }),
    bindingForAccount: accountId => lookup(entry => entry.accountId === accountId),
    bindingForDid: did => lookup(entry => entry.binding.subjectDid === did), bindVerified, linkRecord });
}
