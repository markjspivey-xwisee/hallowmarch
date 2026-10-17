/** Explicit owner-key-authenticated checkpoints under one signed native graph binding. */
import { canonicalGraphDigest, turtleIriRef, escapeTurtleLiteral } from './vendor/interego-browser.mjs';

export const CHECKPOINT_BINDING_SCHEMA = 'interego.client-owned-checkpoint-binding/v1';
const SCHEMA = 'interego.client-owned-checkpoint/v1';
const MODES = new Set(['hallowmarch-character/v1', 'hallowmarch-performance-consultation/v1']);
export const CHECKPOINT_MAX_BYTES = 4 * 1024 * 1024;
const MAX_PLAIN = 2 * 1024 * 1024, HOUR = 3600000, WRITE_BUDGET = 128 * 1024 * 1024;
const HISTORY_BYTES = 32 * 1024, HISTORY_INTERVAL = 5 * 60000;
const ATTRIBUTED = 'http://www.w3.org/ns/prov#wasAttributedTo';
const RDF_VALUE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#value';
const copy = value => JSON.parse(JSON.stringify(value));
const encode = value => new TextEncoder().encode(JSON.stringify(value));
function failure(code, message, extra = {}) { return Object.assign(new Error(message), { code, ...extra }); }
function check(condition, code = 'invalid_checkpoint', message = 'The private checkpoint did not authenticate.') { if (!condition) throw failure(code, message); }
export function checkpointMode(value) { check(MODES.has(value), 'invalid_checkpoint_mode'); return value; }
export function sameNativeHead(a, b) {
  return !!a && !!b && a.cid === b.cid && a.descriptorUrl === b.descriptorUrl
    && (a.nativeRevision ?? null) === (b.nativeRevision ?? null) && (a.recordCid ?? null) === (b.recordCid ?? null);
}
export async function checkpointResourceUrl(podUrl, graphIri, crypto = globalThis.crypto) {
  check(!!turtleIriRef(graphIri) && graphIri.length <= 1024, 'invalid_input');
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(graphIri)));
  return podUrl + 'hallowmarch/checkpoints/' + [...digest].map(x => x.toString(16).padStart(2, '0')).join('') + '.json';
}
export function checkpointRecordDigest({ ownerDid, graphIri, operationId, record }) {
  const value = { schema: 'interego.client-owned-record/v1', owner: ownerDid, graphIri, operationId, record };
  const text = `${turtleIriRef(graphIri)} <${ATTRIBUTED}> ${turtleIriRef(ownerDid)} ;\n  <${RDF_VALUE}> "${escapeTurtleLiteral(JSON.stringify(value))}" .\n`;
  return canonicalGraphDigest(text);
}

/** The host supplies the existing vault and its authenticated native operations.
 * There is no signer private key, bearer, arbitrary endpoint, or retry policy here. */
export function createOwnerCheckpointStore({ ownerDid, podUrl, vault, crypto, now, resourceClient,
  nativeHead, readBinding, prepareBinding, publishBinding, validateRecord, active, registered }) {
  const uncertain = new Map();
  const resourceClients = new Map();
  async function resource(graphIri) {
    const resourceUrl = await checkpointResourceUrl(podUrl, graphIri, crypto);
    let port = resourceClients.get(resourceUrl);
    if (!port) {
      const client = resourceClient(resourceUrl);
      port = { client, ready: client.ready() }; resourceClients.set(resourceUrl, port);
      port.ready.catch(() => { if (resourceClients.get(resourceUrl) === port) resourceClients.delete(resourceUrl); });
    }
    await port.ready; active();
    return { resourceUrl, client: port.client };
  }
  async function open(graphIri, mode, read, resourceUrl) {
    check(read.body instanceof Uint8Array && typeof read.revision === 'string' && read.revision.length > 0);
    check(read.contentType === 'application/json');
    check(read.body.byteLength <= CHECKPOINT_MAX_BYTES, 'record_capacity');
    let envelope;
    try { envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(read.body)); } catch { throw failure('invalid_checkpoint'); }
    const key = await vault.publicKey();
    check(key, 'key_required', 'Restore this identity’s encryption key before opening its checkpoint.');
    check(envelope.version === 1 && envelope.algorithm === 'X25519-XSalsa20-Poly1305'
      && envelope.content?.algorithm === 'XSalsa20-Poly1305' && envelope.wrappedKeys?.length === 1
      && envelope.wrappedKeys[0].recipientPublicKey === key && envelope.wrappedKeys[0].senderPublicKey === key,
    'invalid_checkpoint_sender', 'A checkpoint must have exactly one owner-key-authenticated recipient.');
    let body;
    try {
      const plaintext = await vault.open(envelope);
      check(new TextEncoder().encode(plaintext).length <= MAX_PLAIN, 'record_capacity');
      body = JSON.parse(plaintext);
    } catch (cause) { if (cause.code === 'record_capacity') throw cause; throw failure('cannot_decrypt', 'The owner key could not authenticate this private checkpoint.'); }
    check(body.schema === SCHEMA && body.ownerDid === ownerDid && body.podUrl === podUrl && body.graphIri === graphIri
      && body.resourceUrl === resourceUrl && body.mode === mode && body.vaultPublicKey === key
      && typeof body.operationId === 'string' && (body.previousRevision === null || typeof body.previousRevision === 'string')
      && Number.isSafeInteger(body.at) && body.at >= 0 && Array.isArray(body.history) && body.history.length <= 12 && encode(body.history).byteLength <= HISTORY_BYTES
      && Array.isArray(body.budget) && body.budget.length <= 61 && body.binding?.schema === CHECKPOINT_BINDING_SCHEMA);
    validateRecord(body.record);
    check(body.recordCid === checkpointRecordDigest({ ownerDid, graphIri, operationId: body.operationId, record: body.record }));
    const expected = { schema: CHECKPOINT_BINDING_SCHEMA, ownerDid, podUrl, graphIri, resourceUrl, mode, vaultPublicKey: key };
    check(JSON.stringify(body.binding) === JSON.stringify(expected));
    check(typeof body.bindingDigest === 'string' && body.bindingPlan?.args?.graph_iri === graphIri
      && body.bindingPlan.digest === body.bindingDigest && body.bindingPlan.record
      && JSON.stringify(body.bindingPlan.record) === JSON.stringify(expected));
    for (const item of body.budget) check(Number.isSafeInteger(item.minute) && Number.isSafeInteger(item.bytes) && item.bytes > 0 && item.bytes <= WRITE_BUDGET);
    for (const item of body.history) check(Number.isSafeInteger(item.at) && typeof item.operationId === 'string'
      && typeof item.recordCid === 'string' && item.recordCid === checkpointRecordDigest({ ownerDid, graphIri, operationId: item.operationId, record: validateRecord(item.record) }));
    return { body, revision: read.revision, resourceUrl };
  }
  async function inspect(graphIri, mode) {
    active(); checkpointMode(mode); const { client, resourceUrl } = await resource(graphIri);
    const raw = await client.read(); active();
    if (raw.body === null) {
      check(raw.revision === null);
      const selected = await nativeHead(graphIri);
      if (!selected) return { client, resourceUrl, found: null, selected: null };
      const legacy = await readBinding(graphIri, selected, false);
      check(legacy.record.schema !== CHECKPOINT_BINDING_SCHEMA, 'missing_checkpoint', 'The signed checkpoint binding exists but its fixed private resource is missing.');
      return { client, resourceUrl, found: null, selected, legacy };
    }
    const found = await open(graphIri, mode, raw, resourceUrl);
    const selected = await nativeHead(graphIri);
    let verified = null;
    if (selected && !sameNativeHead(selected, found.body.bindingPlan.expectedHead)) {
      verified = await readBinding(graphIri, selected, true);
      check(verified.digest === found.body.bindingDigest && JSON.stringify(verified.record) === JSON.stringify(found.body.binding), 'checkpoint_binding_conflict');
      if (found.body.bindingHead) check(sameNativeHead(found.body.bindingHead, selected), 'checkpoint_binding_conflict');
    }
    return { client, resourceUrl, found, selected, verified };
  }
  function pendingResult(graphIri, operationId) { return { saved: false, status: 'uncertain', operationId, graphIri, checkpointBinding: true, proofKind: 'owner-key-authenticated-checkpoint' }; }
  function observed(graphIri, value) {
    const { found, selected } = value;
    check(value.verified, 'checkpoint_binding_pending');
    return { graphIri, head: { ...selected, bindingCid: selected.cid, nativeRevision: found.revision,
      recordCid: found.body.recordCid, proofKind: 'owner-key-authenticated-checkpoint' },
    record: copy(found.body.record), operationId: found.body.operationId, digest: found.body.recordCid,
    proofKind: 'owner-key-authenticated-checkpoint', retention: { detailMs: HOUR, maxBytes: CHECKPOINT_MAX_BYTES, historyMaxBytes: HISTORY_BYTES,
      historyIntervalMs: HISTORY_INTERVAL,
      historyEntries: found.body.history.filter(item => item.at > now() - HOUR).length,
      earliestRetainedAt: found.body.history.find(item => item.at > now() - HOUR)?.at ?? found.body.at } };
  }
  async function load(graphIri, mode) {
    const value = await inspect(graphIri, mode);
    if (!value.found) return value.legacy || null;
    if (!value.verified) {
      if (!uncertain.has(value.found.body.operationId)) uncertain.set(value.found.body.operationId, { graphIri, mode, recordCid: value.found.body.recordCid });
      throw failure('checkpoint_binding_pending', 'The original private checkpoint binding is unconfirmed. Reconcile its existing operation before saving.',
        { graphIri, operationId: value.found.body.operationId });
    }
    return observed(graphIri, value);
  }
  async function currentHead(graphIri, mode) {
    const value = await inspect(graphIri, mode);
    if (!value.found) return value.selected;
    if (!value.verified) {
      if (!uncertain.has(value.found.body.operationId)) uncertain.set(value.found.body.operationId, { graphIri, mode, recordCid: value.found.body.recordCid });
      throw failure('checkpoint_binding_pending', 'The original checkpoint binding needs explicit reconciliation.', { graphIri, operationId: value.found.body.operationId });
    }
    return observed(graphIri, value).head;
  }
  async function confirm(operationId) {
    const operation = uncertain.get(operationId);
    check(operation, 'unknown_operation');
    const value = await inspect(operation.graphIri, operation.mode);
    if (!value.found) return pendingResult(operation.graphIri, operationId);
    if (operation.write && value.found.revision === operation.write.expectedRevision) return pendingResult(operation.graphIri, operationId);
    if (value.found.body.operationId !== operationId || value.found.body.recordCid !== operation.recordCid) {
      uncertain.delete(operationId); return { saved: false, status: 'conflict', operationId, graphIri: operation.graphIri };
    }
    if (!value.verified) return pendingResult(operation.graphIri, operationId);
    uncertain.delete(operationId); return { saved: true, status: 'saved', ...observed(operation.graphIri, value) };
  }
  async function reconcile(graphIri, mode) {
    let value = await inspect(graphIri, mode);
    const original = [...uncertain.entries()].find(([, operation]) => operation.graphIri === graphIri && operation.mode === mode && operation.write);
    if (original && ((!value.found && original[1].write.expectedRevision === null)
      || value.found?.revision === original[1].write.expectedRevision)) {
      // An explicit retry of a dropped CAS reuses the exact ciphertext/nonce.
      // The original request may still finish, but native CAS permits one winner.
      try { await value.client.write(original[1].write); }
      catch (cause) {
        if (cause.writeMayHaveCommitted) return pendingResult(graphIri, original[0]);
        if (cause.code !== 'CONFLICT') throw cause;
      }
      value = await inspect(graphIri, mode);
    }
    check(value.found, 'missing_checkpoint');
    const op = value.found.body;
    if (original) check(op.operationId === original[0] && op.recordCid === original[1].recordCid, 'conflict');
    if (!uncertain.has(op.operationId)) uncertain.set(op.operationId, { graphIri, mode, recordCid: op.recordCid });
    if (value.verified) return confirm(op.operationId);
    check((!value.selected && !op.bindingPlan.expectedHead) || sameNativeHead(value.selected, op.bindingPlan.expectedHead), 'checkpoint_binding_conflict');
    // This is the sole explicit retry path. Reuse the exact original encrypted
    // graph, descriptor UUID, digest and expected legacy head; never reseal it.
    try { await publishBinding(copy(op.bindingPlan)); } catch (cause) {
      if (cause.code === 'conflict' || cause.code === 'native_refused') throw cause;
      return pendingResult(graphIri, op.operationId);
    }
    return confirm(op.operationId);
  }
  async function save({ graphIri, mode, record, expectedHead, creating = false }) {
    active(); registered(); checkpointMode(mode); record = validateRecord(record);
    check(uncertain.size < 8, 'confirmation_required');
    check(![...uncertain.values()].some(op => op.graphIri === graphIri), 'confirmation_required');
    const value = await inspect(graphIri, mode);
    if (value.found && !value.verified) {
      if (!uncertain.has(value.found.body.operationId)) uncertain.set(value.found.body.operationId, { graphIri, mode, recordCid: value.found.body.recordCid });
      throw failure('checkpoint_binding_pending', 'Reconcile the original binding before another save.', { graphIri, operationId: value.found.body.operationId });
    }
    const before = value.found ? observed(graphIri, value).head : value.selected;
    check(creating ? !before && !value.found : sameNativeHead(before, expectedHead), 'conflict', 'The private checkpoint changed. Load it before saving.');
    const operationId = crypto.randomUUID(), at = now(), publicKey = await vault.publicKey();
    const binding = value.found?.body.binding || { schema: CHECKPOINT_BINDING_SCHEMA, ownerDid, podUrl, graphIri,
      resourceUrl: value.resourceUrl, mode, vaultPublicKey: publicKey };
    const bindingPlan = value.found?.body.bindingPlan || await prepareBinding({ graphIri, record: binding, expectedHead: before });
    const history = (value.found?.body.history || []).filter(item => item.at > at - HOUR && Math.floor(item.at / HISTORY_INTERVAL) !== Math.floor(at / HISTORY_INTERVAL));
    if (value.found && Math.floor(value.found.body.at / HISTORY_INTERVAL) !== Math.floor(at / HISTORY_INTERVAL)) {
      const prior = value.found.body; history.push({ at: prior.at, operationId: prior.operationId, recordCid: prior.recordCid, record: prior.record });
    }
    while (history.length > 12 || encode(history).byteLength > HISTORY_BYTES) history.shift();
    const body = { schema: SCHEMA, ownerDid, podUrl, graphIri, resourceUrl: value.resourceUrl, mode,
      vaultPublicKey: publicKey, operationId, previousRevision: value.found?.revision || null, at, binding,
      bindingDigest: bindingPlan.digest, bindingPlan, bindingHead: value.verified ? value.selected : null,
      record, recordCid: checkpointRecordDigest({ ownerDid, graphIri, operationId, record }), history,
      budget: (value.found?.body.budget || []).filter(item => (item.minute + 1) * 60000 > at - HOUR) };
    // History is a capacity-bounded rolling hour, not a promise of 61 full-size copies.
    while (encode(body).byteLength > MAX_PLAIN - 8192 && history.length) history.shift();
    check(encode(body).byteLength <= MAX_PLAIN - 8192, 'record_capacity');
    const charge = encode(body).byteLength * 2 + 8192;
    check(body.budget.reduce((sum, item) => sum + item.bytes, 0) + charge <= WRITE_BUDGET, 'checkpoint_write_budget', 'The rolling-hour private save budget is full. Keep this game open and retry later.');
    const minute = Math.floor(at / 60000), entry = body.budget.find(item => item.minute === minute);
    if (entry) entry.bytes += charge; else body.budget.push({ minute, bytes: charge });
    const bytes = encode(await vault.seal(JSON.stringify(body)));
    check(bytes.byteLength <= CHECKPOINT_MAX_BYTES && bytes.byteLength <= charge, 'record_capacity');
    const write = { expectedRevision: value.found?.revision || null, body: bytes, contentType: 'application/json' };
    uncertain.set(operationId, { graphIri, mode, recordCid: body.recordCid, write });
    active();
    try { await value.client.write(write); }
    catch (cause) {
      if (!cause.writeMayHaveCommitted) { uncertain.delete(operationId); throw failure(cause.code === 'CONFLICT' ? 'conflict' : cause.code === 'HTTP' && cause.status === 401 ? 'needs_reauth' : 'native_unavailable', 'The native checkpoint was not saved.'); }
      return pendingResult(graphIri, operationId);
    }
    if (!value.found) {
      try { await publishBinding(copy(bindingPlan)); }
      catch { return pendingResult(graphIri, operationId); }
    }
    try { return await confirm(operationId); } catch { return pendingResult(graphIri, operationId); }
  }
  return Object.freeze({ load, currentHead, save, confirm, reconcile, hasPending: id => uncertain.has(id), pendingCount: () => uncertain.size });
}
