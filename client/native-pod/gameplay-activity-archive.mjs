/** Immutable gameplay evidence, sealed by the existing owner-side pod client. */
import { createNativePodClient, NativePodError } from './client.mjs';
import { GAMEPLAY_EVENT_SCHEMA as EVENT_SCHEMA, GAMEPLAY_EVENT_TYPES, validateGameplayActivityEvent } from './gameplay-activity.mjs';

const PAGE_SCHEMA = 'hallowmarch.gameplay-activity-page/v1';
const TYPES = new Set(GAMEPLAY_EVENT_TYPES);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PREFIX = 'urn:graph:hallowmarch:gameplay-activity:';
const FORBIDDEN = /^(?:proto|prototype|constructor|authorization|cookie|setcookie|password|passphrase|secret|credential|credentials|token|apikey|accesstoken|refreshtoken|idtoken|bearertoken|privatekey|encryptionkey|recoverykey|recoveryfile|capability|capabilitytoken)$/;
const fail = (code, message) => { throw new NativePodError(code, message); };
const clone = value => JSON.parse(JSON.stringify(value));
const plain = value => value !== null && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const encode = value => new TextEncoder().encode(JSON.stringify(value));
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (plain(value)) return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
const same = (left, right) => canonical(left) === canonical(right);
function safeJson(value) {
  let nodes = 0;
  const visit = (item, depth = 0, seen = new Set()) => {
    if (++nodes > 12000 || depth > 12) fail('invalid_activity', 'Gameplay evidence must be compact finite JSON.');
    if (item === null || typeof item === 'boolean' || typeof item === 'number' && Number.isFinite(item)) return;
    if (typeof item === 'string') {
      if (item.length > 8192 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(item)
        || /(?:^|\s)Bearer\s+[A-Za-z0-9._~+\/-]+/i.test(item)) fail('invalid_activity', 'Gameplay evidence cannot contain credentials or unbounded text.');
      return;
    }
    if ((!plain(item) && !Array.isArray(item)) || seen.has(item)) fail('invalid_activity', 'Gameplay evidence must be plain finite JSON.');
    if (Reflect.ownKeys(item).some(key => typeof key !== 'string')) fail('invalid_activity', 'Gameplay evidence cannot contain hidden properties.');
    seen.add(item);
    for (const key of Reflect.ownKeys(item)) {
      if (Array.isArray(item) && key === 'length') continue;
      const descriptor = Object.getOwnPropertyDescriptor(item, key);
      if (!descriptor?.enumerable || !('value' in descriptor) || key.length > 128
        || Array.isArray(item) && !/^(0|[1-9][0-9]*)$/.test(key)
        || FORBIDDEN.test(key.replace(/[^a-z0-9]/gi, '').toLowerCase())) {
        fail('invalid_activity', 'Gameplay evidence cannot contain credentials or executable properties.');
      }
      visit(descriptor.value, depth + 1, seen);
    }
    seen.delete(item);
  };
  visit(value); return clone(value);
}
function exact(value, fields) {
  if (!plain(value) || Object.keys(value).length !== fields.length || Object.keys(value).some(key => !fields.includes(key))) {
    fail('invalid_archive', 'The gameplay page does not match its private archive contract.');
  }
}
function subject(value) {
  if (typeof value !== 'string' || value.length > 1024 || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(value)) fail('invalid_owner', 'A verified native owner is required.');
  return value;
}
function https(value) {
  let url; try { url = new URL(value); } catch { fail('invalid_archive', 'A concrete native HTTPS reference is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.href !== value) fail('invalid_archive', 'A concrete native HTTPS reference is required.');
  return url;
}

/** No game bridge, public pointer, learning service, key minting or recovery. */
export function createOwnerGameplayActivityArchive({ binding, credential, relayUrl, createClient = createNativePodClient,
  crypto = globalThis.crypto, validateEvent = validateGameplayActivityEvent } = {}) {
  const ownerDid = subject(binding?.subjectDid), podUrl = https(binding?.podUrl).href;
  if (!podUrl.endsWith('/') || !crypto?.subtle) fail('invalid_owner', 'An owner pod root and browser cryptography are required.');
  const client = createClient({ relayUrl, credential, ownerDid, podUrl, crypto });
  const observed = new Set();
  let connected = false, keyPresent = false, closed = false, stopped = false, code = '', pending = null, queue = Promise.resolve();
  const active = () => { if (closed) fail('revoked', 'This gameplay archive connection is closed.'); };
  const ready = () => {
    active();
    if (!connected || !keyPresent) fail(keyPresent ? 'not_connected' : 'key_required', 'Connect the existing owner encryption key before opening gameplay evidence.');
  };
  const serialized = run => { const next = queue.then(run); queue = next.catch(() => {}); return next; };
  function reference(value) {
    if (value === null) return null;
    value = safeJson(value);
    exact(value, ['graphIri', 'cid', 'descriptorUrl']);
    if (typeof value.graphIri !== 'string' || !new RegExp('^' + PREFIX + '[0-9a-f]{64}$').test(value.graphIri)
      || typeof value.cid !== 'string' || !value.cid || value.cid.length > 1024 || /[\s\u0000-\u001f]/.test(value.cid)) fail('invalid_archive', 'An exact gameplay page reference is required.');
    if (!https(value.descriptorUrl).href.startsWith(podUrl)) fail('owner_mismatch', 'Gameplay page references must stay in the authenticated owner pod.');
    return clone(value);
  }
  function events(value, sessionId) {
    if (!UUID.test(sessionId || '') || !Array.isArray(value) || value.length < 1 || value.length > 64) fail('invalid_activity', 'A gameplay page needs one to sixty-four events from one session.');
    const output = safeJson(value), ids = new Set();
    for (let index = 0; index < output.length; index++) {
      const event = output[index];
      if (!plain(event) || event.schema !== EVENT_SCHEMA || typeof event.id !== 'string' || !event.id.startsWith('urn:uuid:')
        || !UUID.test(event.id.slice(9)) || ids.has(event.id) || event.sessionId !== sessionId || !TYPES.has(event.type)
        || !Number.isSafeInteger(event.sequence) || event.sequence < 1 || index > 0 && event.sequence !== output[index - 1].sequence + 1
        || typeof event.observedAt !== 'string' || !Number.isFinite(Date.parse(event.observedAt))
        || new Date(event.observedAt).toISOString() !== event.observedAt) fail('invalid_activity', 'Gameplay event identities, times and session sequences must be valid and contiguous.');
      if (validateEvent) validateEvent(event);
      ids.add(event.id);
    }
    return output;
  }
  async function graphFor(record) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', encode([ownerDid, record.sessionId, record.firstSequence, record.lastSequence])));
    active(); return PREFIX + [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function draft(input) {
    input = safeJson(input);
    exact(input, ['sessionId', 'events', 'previous']);
    const list = events(input.events, input.sessionId);
    const record = { schema: PAGE_SCHEMA, ownerDid, sessionId: input.sessionId, firstSequence: list[0].sequence,
      lastSequence: list.at(-1).sequence, previous: reference(input.previous), events: list };
    if (encode(record).length > 48 * 1024) fail('activity_capacity', 'A gameplay page cannot exceed forty-eight KiB.');
    return record;
  }
  async function validateRecord(record, graphIri) {
    exact(record, ['schema', 'ownerDid', 'sessionId', 'firstSequence', 'lastSequence', 'previous', 'events']);
    if (record.schema !== PAGE_SCHEMA || record.ownerDid !== ownerDid) fail('owner_mismatch', 'This gameplay page belongs to another owner or schema.');
    const clean = draft({ sessionId: record.sessionId, events: record.events, previous: record.previous });
    if (!same(clean, record) || await graphFor(clean) !== graphIri || clean.previous?.graphIri === graphIri) fail('invalid_archive', 'The gameplay page identity or sequence bounds changed.');
    return clean;
  }
  async function readNative(graphIri, selected = undefined) {
    const before = selected === undefined ? await client.currentHead({ graphIri }) : selected; active();
    if (!before) {
      if (observed.has(graphIri)) fail('missing_archive', 'An already observed gameplay page is missing.');
      return null;
    }
    observed.add(graphIri);
    const found = await client.load({ graphIri }); active();
    const after = await client.currentHead({ graphIri }); active();
    if (!found || found.graphIri !== graphIri || !same(found.head, before) || !same(after, before)) fail('archive_changed', 'The immutable gameplay page no longer matches its native head.');
    const ref = reference({ graphIri, cid: found.head.cid, descriptorUrl: found.head.descriptorUrl });
    return { reference: ref, record: await validateRecord(found.record, graphIri) };
  }
  async function readPageImpl(input) {
    ready(); const ref = reference(input);
    if (!ref) fail('invalid_archive', 'Select an exact gameplay page reference.');
    observed.add(ref.graphIri);
    const found = await readNative(ref.graphIri);
    if (!found || !same(found.reference, ref)) fail('archive_changed', 'The gameplay page differs from its confirmed reference.');
    return clone(found);
  }
  function halt(nextCode) { stopped = true; code = nextCode; }
  async function accept(result, expected, graphIri) {
    active();
    if (result?.saved === true) {
      if (result.graphIri !== graphIri) { halt('owner_mismatch'); fail(code, 'The native confirmation identifies another gameplay page.'); }
      try {
        const checked = await validateRecord(result.record, graphIri);
        if (!same(checked, expected)) fail('archive_conflict', 'The confirmed gameplay page differs from its original draft.');
        const ref = reference({ graphIri, cid: result.head?.cid, descriptorUrl: result.head?.descriptorUrl });
        observed.add(graphIri); pending = null; code = '';
        return { saved: true, reference: ref };
      } catch (cause) { halt(cause.code || 'invalid_archive'); throw cause; }
    }
    if (result?.status === 'conflict') { halt('archive_conflict'); fail(code, 'The gameplay page has competing native heads.'); }
    if (typeof result?.operationId !== 'string' || !result.operationId || result.graphIri !== graphIri) {
      halt('archive_uncertain'); fail(code, 'This gameplay write has no original native operation to confirm.');
    }
    if (pending && result.operationId !== pending.receipt.operationId) { halt('archive_uncertain'); fail(code, 'Native confirmation changed the original gameplay operation.'); }
    if (!pending) pending = { receipt: clone(result), record: clone(expected), graphIri };
    code = 'pod_pending';
    return { saved: false, status: 'pending' };
  }
  return Object.freeze({
    connect() {
      return serialized(async () => {
        active();
        const result = await client.connect(); active();
        keyPresent = result?.keyPresent === true;
        if (!keyPresent) { code = 'key_required'; fail(code, 'Restore the existing owner key through the character connection before archiving gameplay.'); }
        if (result.ownerDid !== undefined && result.ownerDid !== ownerDid || result.podUrl !== undefined && result.podUrl !== podUrl) fail('owner_mismatch', 'The native connection identifies another owner pod.');
        await client.registerKey(); active(); connected = true; code = '';
        return { connected: true, keyPresent: true };
      });
    },
    appendPage(input) {
      // Snapshot before a queued call can observe caller mutation.
      const record = draft(input);
      return serialized(async () => {
        ready(); if (stopped) fail(code || 'archive_stopped', 'Reopen the owner archive to reconcile the uncertain gameplay page.');
        const graphIri = await graphFor(record);
        if (pending) {
          if (pending.graphIri !== graphIri || !same(pending.record, record)) fail('confirmation_required', 'Retry the original gameplay page before appending another.');
          const result = await client.confirm(pending.receipt.operationId); active();
          return accept(result, record, graphIri);
        }
        const found = await readNative(graphIri);
        if (found) {
          if (!same(found.record, record)) fail('archive_conflict', 'This immutable gameplay page already contains different evidence.');
          return { saved: true, reference: found.reference };
        }
        if (record.previous) {
          const previous = await readPageImpl(record.previous);
          if (previous.record.sessionId === record.sessionId ? previous.record.lastSequence + 1 !== record.firstSequence : record.firstSequence !== 1) {
            fail('invalid_activity', 'Gameplay pages must continue their session without sequence gaps.');
          }
        } else if (record.firstSequence !== 1) fail('invalid_activity', 'A gameplay session archive must begin at sequence one.');
        let result;
        try { result = await client.createAt({ graphIri, record: clone(record) }); active(); }
        catch (cause) { halt('archive_uncertain'); throw cause; }
        return accept(result, record, graphIri);
      });
    },
    async readPage(input) { const ref = reference(input); return serialized(() => readPageImpl(ref)); },
    status: () => ({ connected: connected && !closed, keyPresent, pending: !!pending, stopped, closed, code }),
    close() { closed = true; connected = false; client.close(); },
  });
}
