/** Browser-only access-session custody. No refresh token, network or custom crypto. */
import { ClientKeyVault } from './vendor/interego-browser.mjs';

const PURPOSE = 'interego.browser-access-session/v1';
const MAX_ENTRIES = 16;
const fail = code => { const error = new Error({
  invalid_binding: 'The native access-session identity binding is invalid.',
  invalid_credential: 'An unexpired relay OAuth access credential without a refresh token is required.',
  unavailable: 'Encrypted browser session storage is unavailable.',
  changed: 'This browser session was changed or forgotten before the operation completed.',
  capacity: 'The browser session cache is full. Forget an unused session first.',
  invalid_cache: 'The cached access session could not be authenticated. Reconnect your identity.',
  closed: 'The browser session cache is closed.',
}[code] || 'The browser session cache could not complete this operation.'); error.name = 'BrowserAccessCacheError'; error.code = code; throw error; };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function bindingOf({ relayUrl, ownerDid, podUrl } = {}) {
  let relay, pod;
  try { relay = new URL(relayUrl); pod = new URL(podUrl); } catch { fail('invalid_binding'); }
  if (relay.protocol !== 'https:' || relay.username || relay.password || relay.search || relay.hash || relay.pathname !== '/'
    || !['https:', 'http:'].includes(pod.protocol) || pod.username || pod.password || pod.search || pod.hash
    || !/^\/[A-Za-z0-9_-]+\/$/.test(pod.pathname) || pod.href !== podUrl
    || typeof ownerDid !== 'string' || ownerDid.length > 1024 || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(ownerDid)) fail('invalid_binding');
  return { relayUrl: relay.origin, ownerDid, podUrl: pod.href };
}
const idOf = binding => JSON.stringify([PURPOSE, binding.relayUrl, binding.ownerDid, binding.podUrl]);
const vaultScope = (id, revision) => JSON.stringify([PURPOSE, 'credential-custody', id, revision]);
function credentialOf(value, now) {
  if (!object(value) || Object.keys(value).some(key => !['kind', 'accessToken', 'method', 'expiresAt', 'refreshToken', 'clientId'].includes(key))
    || value.kind !== 'relay-oauth-bearer' || typeof value.accessToken !== 'string' || value.accessToken.length < 16 || value.accessToken.length > 16384
    || /[\s\x00-\x1f\x7f]/.test(value.accessToken) || !['siwe', 'webauthn', 'provisional'].includes(value.method)
    || !Number.isSafeInteger(value.expiresAt) || value.expiresAt <= now || (value.refreshToken !== undefined && value.refreshToken !== null)
    || (value.clientId !== undefined && value.clientId !== null && (typeof value.clientId !== 'string' || value.clientId.length > 512))) fail('invalid_credential');
  return { kind: value.kind, accessToken: value.accessToken, method: value.method, expiresAt: value.expiresAt,
    refreshToken: null, clientId: value.clientId ?? null };
}
const metadata = entry => ({ relayUrl: entry.binding.relayUrl, ownerDid: entry.binding.ownerDid,
  podUrl: entry.binding.podUrl, expiresAt: entry.expiresAt, updatedAt: entry.updatedAt });

export function createBrowserAccessCache({ indexedDB = globalThis.indexedDB, crypto = globalThis.crypto,
  now = Date.now, databaseName = 'interego-browser-access-v1' } = {}) {
  let opening = null, closed = false;
  const active = () => { if (closed) fail('closed'); if (!indexedDB || !crypto?.subtle || !crypto.randomUUID) fail('unavailable'); };
  function database() {
    active();
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => { request.result.createObjectStore('sessions'); request.result.createObjectStore('keys'); };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => { try { fail('unavailable'); } catch (error) { reject(error); } };
    });
    return opening;
  }
  async function transaction(stores, mode, run) {
    const db = await database(); active();
    return new Promise((resolve, reject) => {
      let result, reason;
      const tx = db.transaction(stores, mode);
      const refuse = code => { reason = code; tx.abort(); };
      try { run(tx, value => { result = value; }, refuse); } catch { refuse('unavailable'); }
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => { try { fail(reason || 'unavailable'); } catch (error) { reject(error); } };
    });
  }
  const entry = id => transaction(['sessions'], 'readonly', (tx, done) => {
    const request = tx.objectStore('sessions').get(id); request.onsuccess = () => done(request.result || null);
  });
  function storage(id, revision) {
    return {
      load: scope => transaction(['sessions', 'keys'], 'readonly', (tx, done) => {
        const current = tx.objectStore('sessions').get(id);
        current.onsuccess = () => {
          if (current.result?.revision !== revision) { done(null); return; }
          const key = tx.objectStore('keys').get(scope); key.onsuccess = () => done(key.result || null);
        };
      }),
      create: (scope, record) => transaction(['sessions', 'keys'], 'readwrite', (tx, done, refuse) => {
        const current = tx.objectStore('sessions').get(id);
        current.onsuccess = () => {
          if (current.result?.revision !== revision) { refuse('changed'); return; }
          const store = tx.objectStore('keys'), key = store.get(scope);
          key.onsuccess = () => { if (key.result) done(key.result); else { store.add(record, scope); done(record); } };
        };
      }),
    };
  }
  async function forgetIf(id, revision) {
    return transaction(['sessions', 'keys'], 'readwrite', (tx, done) => {
      const sessions = tx.objectStore('sessions'), request = sessions.get(id);
      request.onsuccess = () => {
        if (!request.result || (revision && request.result.revision !== revision)) { done(false); return; }
        tx.objectStore('keys').delete(vaultScope(id, request.result.revision)); sessions.delete(id); done(true);
      };
    });
  }
  async function put(input) {
    active(); const binding = bindingOf(input), id = idOf(binding), credential = credentialOf(input.credential, now());
    const revision = crypto.randomUUID();
    const next = { purpose: PURPOSE, version: 1, binding, revision, expiresAt: credential.expiresAt, updatedAt: now(), status: 'pending' };
    // Publishing a placeholder first makes forgetting atomic with in-flight seal
    // operations. Neither the placeholder nor its wrapping-key record is a token.
    await transaction(['sessions', 'keys'], 'readwrite', (tx, done, refuse) => {
      const sessions = tx.objectStore('sessions'), previous = sessions.get(id), count = sessions.count();
      let existing, size, read = false;
      const finish = () => {
        if (!read || size === undefined) return;
        if (!existing && size >= MAX_ENTRIES) { refuse('capacity'); return; }
        if (existing) tx.objectStore('keys').delete(vaultScope(id, existing.revision));
        sessions.put(next, id); done();
      };
      previous.onsuccess = () => { existing = previous.result; read = true; finish(); };
      count.onsuccess = () => { size = count.result; finish(); };
    });
    try {
      const scope = vaultScope(id, revision), vault = new ClientKeyVault(scope, storage(id, revision), crypto);
      await vault.create();
      const plaintext = JSON.stringify({ purpose: PURPOSE, version: 1, binding, expiresAt: next.expiresAt, revision, credential });
      const envelope = await vault.seal(plaintext);
      active(); if (credential.expiresAt <= now()) fail('invalid_credential');
      await transaction(['sessions'], 'readwrite', (tx, done, refuse) => {
        const sessions = tx.objectStore('sessions'), current = sessions.get(id);
        current.onsuccess = () => {
          if (current.result?.revision !== revision) { refuse('changed'); return; }
          sessions.put({ ...next, status: 'ready', envelope }, id); done();
        };
      });
      return metadata(next);
    } catch (error) {
      await forgetIf(id, revision).catch(() => {});
      if (error?.name === 'BrowserAccessCacheError') throw error;
      fail('unavailable');
    }
  }
  async function get(input) {
    active(); const binding = bindingOf(input), id = idOf(binding), selected = await entry(id);
    if (!selected) return null;
    if (selected.expiresAt <= now()) { await forgetIf(id, selected.revision); return null; }
    if (selected.status !== 'ready') return null;
    try {
      if (selected.purpose !== PURPOSE || selected.version !== 1 || idOf(selected.binding) !== id || !selected.envelope) fail('invalid_cache');
      const vault = new ClientKeyVault(vaultScope(id, selected.revision), storage(id, selected.revision), crypto);
      const plaintext = await vault.open(selected.envelope), opened = JSON.parse(plaintext);
      if (opened.purpose !== PURPOSE || opened.version !== 1 || opened.revision !== selected.revision
        || idOf(opened.binding) !== id || opened.expiresAt !== selected.expiresAt) fail('invalid_cache');
      const credential = credentialOf(opened.credential, now());
      if (credential.expiresAt !== selected.expiresAt) fail('invalid_cache');
      // A concurrent forget/replacement must not return a stale secret after it
      // has completed, even if decryption began before that transaction.
      const current = await entry(id); active();
      if (current?.revision !== selected.revision) return null;
      if (credential.expiresAt <= now()) { await forgetIf(id, selected.revision); return null; }
      return { ...metadata(selected), credential };
    } catch (error) {
      await forgetIf(id, selected.revision).catch(() => {});
      if (error?.code === 'closed') throw error;
      // Authentication failure never creates keys, reconnects or returns stale tokens.
      return null;
    }
  }
  async function list({ relayUrl } = {}) {
    active();
    let relay;
    if (relayUrl !== undefined) {
      try { relay = new URL(relayUrl).origin; } catch { fail('invalid_binding'); }
    }
    const entries = await transaction(['sessions'], 'readonly', (tx, done) => {
      const request = tx.objectStore('sessions').getAll(null, MAX_ENTRIES + 1); request.onsuccess = () => done(request.result);
    });
    if (entries.length > MAX_ENTRIES) fail('capacity');
    const result = [];
    for (const selected of entries) {
      let binding;
      try { binding = bindingOf(selected.binding); } catch { continue; }
      if (selected.expiresAt <= now()) { await forgetIf(idOf(binding), selected.revision); continue; }
      if (selected.status === 'ready' && selected.purpose === PURPOSE && (!relay || relay === binding.relayUrl)) result.push(metadata(selected));
    }
    return result.sort((left, right) => right.updatedAt - left.updatedAt);
  }
  return Object.freeze({ put, get, list,
    forget(input) { active(); return forgetIf(idOf(bindingOf(input))); },
    async forgetAll() { active(); await transaction(['sessions', 'keys'], 'readwrite', (tx, done) => {
      tx.objectStore('sessions').clear(); tx.objectStore('keys').clear(); done();
    }); },
    async close() { closed = true; if (opening) (await opening).close(); opening = null; },
  });
}

