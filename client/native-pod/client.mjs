/** Owner-side Interego records. No game engine, bearer persistence or server decryption. */
import { ClientKeyVault, RelayMcpTransport, canonicalGraphDigest, parseTrig,
  turtleIriRef, escapeTurtleLiteral } from './vendor/interego-browser.mjs';

const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const RDF_VALUE = 'http://www.w3.org/1999/02/22-rdf-syntax-ns#value';
const ATTRIBUTED = 'http://www.w3.org/ns/prov#wasAttributedTo';
const SCHEMA = 'interego.client-owned-record/v1';
const REQUIRED = ['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph', 'register_agent', 'publish_context'];
const MAX_RECORD_BYTES = 384 * 1024;
export class NativePodError extends Error {
  constructor(code, message) { super(message); this.name = 'NativePodError'; this.code = code; }
}
const fail = (code, message) => { throw new NativePodError(code, message); };
const plain = value => value && typeof value === 'object' && !Array.isArray(value);
function iri(value) { const result = turtleIriRef(value); if (!result) fail('invalid_input', 'An absolute RDF identity is required.'); return result; }
function podIdentity(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !/^\/[a-zA-Z0-9_-]+\/$/.test(url.pathname)) fail('invalid_identity', 'An authenticated pod root is required.');
  return url.pathname.slice(1, -1);
}
function jsonRecord(value) {
  const visit = (next, depth = 0, active = new Set()) => {
    if (depth > 40) fail('invalid_record', 'The private record is too deeply nested.');
    if (next === null || typeof next === 'string' || typeof next === 'boolean') return;
    if (typeof next === 'number' && Number.isFinite(next)) return;
    if (!plain(next) && !Array.isArray(next)) fail('invalid_record', 'A finite JSON record is required.');
    if (active.has(next)) fail('invalid_record', 'A finite JSON record is required.');
    active.add(next); for (const child of Object.values(next)) visit(child, depth + 1, active); active.delete(next);
  };
  visit(value);
  const text = JSON.stringify(value);
  if (!text || new TextEncoder().encode(text).length > MAX_RECORD_BYTES) fail('record_capacity', 'The private record exceeds its bounded capacity.');
  return JSON.parse(text);
}
function singleton(node, predicate, kind) {
  const values = node?.properties.get(predicate) || [];
  if (values.length !== 1 || values[0].kind !== kind) fail('invalid_record', 'The stored record does not satisfy its native contract.');
  return kind === 'iri' ? values[0].iri : values[0].value;
}

/** IndexedDB is key custody only. It is never an acknowledged game-record primary. */
export function indexedDbKeyStorage({ indexedDB = globalThis.indexedDB, name = 'interego-client-keys-v1' } = {}) {
  let opening;
  const database = () => {
    if (!indexedDB) fail('key_storage_unavailable', 'Durable browser key storage is unavailable. Nothing was saved.');
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(name, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('keys');
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(new NativePodError('key_storage_unavailable', 'Durable browser key storage could not be opened.'));
      request.onblocked = () => reject(new NativePodError('key_storage_unavailable', 'Another browser tab is blocking key storage.'));
    });
    return opening;
  };
  async function transact(scope, candidate) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('keys', candidate ? 'readwrite' : 'readonly');
      const store = tx.objectStore('keys'); let value;
      const request = store.get(scope);
      request.onsuccess = () => { value = request.result || null; if (!value && candidate) { value = candidate; store.add(candidate, scope); } };
      tx.oncomplete = () => resolve(value);
      tx.onabort = tx.onerror = () => reject(new NativePodError('key_storage_unavailable', 'The browser key transaction did not complete.'));
    });
  }
  return Object.freeze({ load: scope => transact(scope), create: (scope, record) => transact(scope, record),
    async close() { if (opening) (await opening).close(); opening = null; } });
}

export function createNativePodClient({ relayUrl, credential, ownerDid, podUrl, transport,
  keyStorage = indexedDbKeyStorage(), crypto = globalThis.crypto, now = Date.now } = {}) {
  const relay = new URL(relayUrl);
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/') {
    fail('invalid_relay', 'An HTTPS Interego relay origin is required.');
  }
  iri(ownerDid); const podName = podIdentity(podUrl);
  if (!crypto?.subtle || !crypto.randomUUID) fail('crypto_unavailable', 'Browser encryption requires a secure page.');
  if (!transport && (credential?.kind !== 'relay-oauth-bearer' || !credential.accessToken || credential.refreshToken)) {
    fail('invalid_credential', 'An explicitly granted browser-only relay access token is required. Refresh tokens are not retained.');
  }
  const tx = transport || new RelayMcpTransport(relay.origin, { ...credential }, globalThis.fetch.bind(globalThis));
  // Scope is stable across browsers and relay sessions so encrypted recovery works.
  const scope = JSON.stringify(['interego-client-key/v1', relay.origin, ownerDid, podName]);
  const vault = new ClientKeyVault(scope, keyStorage, crypto);
  let connected = false, closed = false, registered = false, recipientId = null, sessionAgent = null;
  const pending = new Map(); let queue = Promise.resolve();
  function active() { if (closed || !connected) fail('not_connected', 'Reconnect your Interego identity before accessing its pod.'); }
  async function tool(name, args) {
    if (closed) fail('not_connected', 'This Interego connection is closed.');
    let result;
    try { result = await tx.callTool(name, args, { cache: false, signal: AbortSignal.timeout(35000) }); }
    catch (error) { throw new NativePodError(error?.code === 'needs_reauth' ? 'needs_reauth' : 'native_unavailable', 'Interego did not confirm this operation. Reconnect or check its saved status.'); }
    if (!plain(result)) fail('native_contract', 'Interego returned an unreadable operation result.');
    if (result.error) fail(Number(result.code) === 412 ? 'conflict' : 'native_refused', 'Interego refused this operation. Refresh the current record before trying again.');
    return result;
  }
  async function connect() {
    if (closed) fail('not_connected', 'This Interego connection is closed.');
    let manifest;
    try { manifest = await tx.connect(REQUIRED, 'get_pod_status'); }
    catch { fail('native_unavailable', 'The Interego capability manifest is unavailable.'); }
    if (!REQUIRED.every(name => manifest.granted.includes(name))) fail('capability_missing', 'The relay does not advertise the required private-record capabilities.');
    const status = await tool('get_pod_status', {});
    if (podIdentity(status.pod) !== podName || status.userId !== podName || status.identity?.did !== ownerDid) {
      fail('owner_mismatch', 'The authenticated Interego identity does not own the expected pod.');
    }
    sessionAgent = status.sessionAgent?.did;
    if (!sessionAgent) fail('native_contract', 'Interego did not identify the authenticated publishing agent.');
    connected = true;
    return { ownerDid, podUrl: status.pod, keyPresent: !!await vault.publicKey(), keyRegistered: false };
  }
  async function agentFor(publicKey) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(publicKey)));
    const suffix = [...digest].map(x => x.toString(16).padStart(2, '0')).join('');
    return podUrl + 'agents#browser-encryption-' + suffix;
  }
  async function registryKey(agent) {
    const result = await tool('get_descriptor', { url: podUrl + 'agents' });
    const document = parseTrig(result.turtle || result.graph?.content || result.content || '');
    const matches = document.subjects.filter(node => (node.properties.get(IEP + 'agentIdentity') || []).some(term => term.kind === 'iri' && term.iri === agent));
    if (matches.length > 1) fail('recipient_conflict', 'The registered browser recipient is ambiguous.');
    return matches.length ? singleton(matches[0], IEP + 'encryptionPublicKey', 'literal') : null;
  }
  async function registerKey() {
    active(); const publicKey = await vault.publicKey();
    if (!publicKey) fail('key_required', 'Create a browser key or restore its encrypted recovery file first.');
    const agent = await agentFor(publicKey);
    if (agent === sessionAgent) fail('recipient_conflict', 'The browser encryption recipient must be distinct from the session agent.');
    const existing = await registryKey(agent);
    if (existing && existing !== publicKey) fail('recipient_conflict', 'The registered recipient has another key. Its key was preserved.');
    if (!existing) {
      const result = await tool('register_agent', { pod_name: podName, agent_id: agent, scope: 'ReadOnly',
        encryption_public_key: publicKey, label: 'Browser-held encryption recipient' });
      if (result.agent !== agent || result.scope !== 'ReadOnly') fail('native_contract', 'Interego did not register the intended browser recipient.');
    }
    if (await registryKey(agent) !== publicKey) fail('registration_pending', 'The browser public-key registration has not read back.');
    recipientId = agent; registered = true; return { agentId: agent, publicKey, scope: 'ReadOnly' };
  }
  async function head(graphIri) {
    active(); iri(graphIri);
    const result = await tool('get_current_head', { urn: graphIri, pod_name: podName });
    if (podIdentity(result.podUrl) !== podName || result.urn !== graphIri) fail('owner_mismatch', 'Interego answered for a different pod or record.');
    if (result.forked) fail('conflict', 'This private record has competing native heads. Resolve them before saving.');
    if (result.head === null || (!result.head && typeof result.message === 'string')) return null;
    if (!result.head?.descriptorUrl || !result.head.cid) fail('native_contract', 'The private record head is unreadable.');
    return { descriptorUrl: result.head.descriptorUrl, cid: result.head.cid };
  }
  async function readAt(graphIri, selected) {
    if (!await vault.publicKey()) fail('key_required', 'Restore this identity’s encryption key before opening its records.');
    const descriptor = await tool('get_descriptor', { url: selected.descriptorUrl });
    if (descriptor.authorship?.authorshipVerified !== true || descriptor.authorship?.descriptorBinding?.bound !== true) {
      fail('invalid_proof', 'The native record descriptor did not verify.');
    }
    const encrypted = await tool('get_encrypted_graph', { url: selected.descriptorUrl });
    if (encrypted.encrypted !== true || encrypted.url !== selected.descriptorUrl || typeof encrypted.envelope !== 'string') fail('invalid_record', 'A client-sealed native record is required.');
    if (encrypted.envelope.length > 2 * MAX_RECORD_BYTES) fail('record_capacity', 'The encrypted record exceeds its bounded capacity.');
    let plaintext;
    try { plaintext = await vault.open(JSON.parse(encrypted.envelope)); }
    catch { fail('cannot_decrypt', 'This browser could not authenticate the encrypted record. Restore the correct recovery key.'); }
    if (plaintext.length > MAX_RECORD_BYTES + 16384) fail('record_capacity', 'The opened record exceeds its bounded capacity.');
    const digest = canonicalGraphDigest(plaintext);
    const proofHashes = parseTrig(descriptor.turtle || '').subjects.flatMap(node => node.properties.get(IEP + 'contentHash') || [])
      .filter(term => term.kind === 'literal').map(term => term.value);
    if (!digest || proofHashes.length !== 1 || proofHashes[0] !== digest) fail('invalid_proof', 'The opened record differs from its signed content digest.');
    const nodes = parseTrig(plaintext).subjects;
    if (nodes.length !== 1 || nodes[0].subject !== graphIri || singleton(nodes[0], ATTRIBUTED, 'iri') !== ownerDid) fail('owner_mismatch', 'The encrypted record belongs to another owner or graph.');
    const record = JSON.parse(singleton(nodes[0], RDF_VALUE, 'literal'));
    if (record.schema !== SCHEMA || record.owner !== ownerDid || record.graphIri !== graphIri || typeof record.operationId !== 'string') fail('owner_mismatch', 'The private record binding is invalid.');
    return { graphIri, head: selected, record: jsonRecord(record.record), operationId: record.operationId, digest };
  }
  async function load({ graphIri }) { const selected = await head(graphIri); return selected ? readAt(graphIri, selected) : null; }
  async function confirm(operationId) {
    active(); const operation = pending.get(operationId);
    if (!operation) fail('unknown_operation', 'This browser has no unconfirmed publication with that operation ID.');
    const current = await head(operation.graphIri);
    if (!current) return { status: 'pending', saved: false, operationId, graphIri: operation.graphIri };
    if (operation.descriptorUrl && current.descriptorUrl !== operation.descriptorUrl) {
      if (operation.expectedHead?.cid === current.cid) return { status: 'pending', saved: false, operationId, graphIri: operation.graphIri };
      pending.delete(operationId);
      return { status: 'conflict', saved: false, operationId, graphIri: operation.graphIri, head: current };
    }
    const observed = await readAt(operation.graphIri, current);
    if (observed.operationId !== operationId || observed.digest !== operation.digest) {
      const status = operation.expectedHead?.cid === current.cid ? 'pending' : 'conflict';
      if (status === 'conflict') pending.delete(operationId);
      return { status, saved: false, operationId, graphIri: operation.graphIri, head: current };
    }
    pending.delete(operationId);
    return { status: 'saved', saved: true, ...observed };
  }
  async function publish({ graphIri, record, expectedHead, creating = false }) {
    active(); if (!registered) fail('key_registration_required', 'Register this browser’s public encryption key before saving.');
    if (pending.size >= 8 || [...pending.values()].some(operation => operation.graphIri === graphIri)) {
      fail('confirmation_required', 'Confirm outstanding native publications before saving more records.');
    }
    iri(graphIri); const current = await head(graphIri);
    if (creating ? current !== null : !expectedHead?.cid || !current || current.cid !== expectedHead.cid || current.descriptorUrl !== expectedHead.descriptorUrl) {
      fail('conflict', 'The private record changed. Load it again before saving.');
    }
    const operationId = crypto.randomUUID();
    const value = { schema: SCHEMA, owner: ownerDid, graphIri, operationId, record: jsonRecord(record) };
    const plaintext = `${iri(graphIri)} ${iri(ATTRIBUTED)} ${iri(ownerDid)} ;\n  ${iri(RDF_VALUE)} "${escapeTurtleLiteral(JSON.stringify(value))}" .\n`;
    const digest = canonicalGraphDigest(plaintext);
    if (!digest) fail('invalid_record', 'The private record cannot be digested as RDF.');
    const envelope = await vault.seal(plaintext);
    const operation = { graphIri, expectedHead, digest, descriptorUrl: null };
    pending.set(operationId, operation);
    let result;
    try {
      result = await tool('publish_context', { pod_name: podName, graph_iri: graphIri,
        descriptor_id: 'urn:uuid:' + operationId, graph_content: JSON.stringify(envelope), sealed_payload: true,
        content_digest: digest, cleartext_mirror: current ? `${iri(graphIri)} ${iri(IEP + 'supersedes')} ${iri(current.descriptorUrl)} .` : '',
        visibility: 'private', sign_authorship: true, auto_supersede_prior: !creating,
        ...(current ? { if_match: current.cid } : {}), sync: true });
    } catch (error) {
      if (error.code === 'conflict' || error.code === 'native_refused') { pending.delete(operationId); throw error; }
      return { status: 'uncertain', saved: false, operationId, graphIri };
    }
    operation.descriptorUrl = result.descriptorUrl || null;
    // Neither a pending acknowledgement nor a claimed publication is readback.
    try { return { ...await confirm(operationId), ...(result.status === 'pending' ? { acceptedPending: true } : {}) }; }
    catch { return { status: 'uncertain', saved: false, operationId, graphIri }; }
  }
  function serialized(run) { const next = queue.then(run); queue = next.catch(() => {}); return next; }
  return Object.freeze({ connect, load, registerKey, confirm,
    async keyStatus() { active(); return { keyPresent: !!await vault.publicKey(), keyRegistered: registered, agentId: recipientId }; },
    async createKey() { active(); await vault.create(); return registerKey(); },
    async exportRecovery(passphrase) { active(); return vault.backup(passphrase); },
    async restoreRecovery(recovery, passphrase) { active(); await vault.restore(recovery, passphrase); return registerKey(); },
    // First publication uses a fresh, unguessable graph identity. The relay has
    // no compare-with-absence primitive; never describe this as initial CAS.
    create({ record }) { const graphIri = 'urn:graph:client-owned:' + crypto.randomUUID(); return serialized(() => publish({ graphIri, record, creating: true })); },
    save(input) { if (!input?.expectedHead) fail('head_required', 'Updates require the previously read native head.'); return serialized(() => publish(input)); },
    status() { return { connected: connected && !closed, ownerDid, podUrl, recipientId, pending: pending.size }; },
    close() { closed = true; connected = false; registered = false; tx.setCredential?.({ kind: 'relay-oauth-bearer', accessToken: '', method: credential?.method || 'webauthn', expiresAt: now(), refreshToken: null, clientId: null }); },
  });
}
