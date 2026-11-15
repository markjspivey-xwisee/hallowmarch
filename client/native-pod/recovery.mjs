/** Owner-initiated, read-only discovery of retained browser character keys. */
import { ClientKeyVault, validEncryptionPublicKey } from './vendor/interego-browser.mjs';
import { createNativePodClient, indexedDbKeyStorage } from './client.mjs';
import { sameNativeHead } from './checkpoint.mjs';
import { ownerKeyAliasAddress } from './key-scope.mjs';
import { playerProfileIndexGraphIri, playerProfileGraphIri, validatePlayerProfileIndex, validatePlayerProfile } from './profile.mjs';

const DATABASE = 'interego-client-keys-v1', STORE = 'keys', CHECKPOINT = 'hallowmarch-character/v1';
const fail = code => Object.assign(new Error('The retained character key could not be verified.'), { code });
const bound = (value, fallback, maximum) => Number.isSafeInteger(value) && value > 0 ? Math.min(value, maximum) : fallback;
const outcome = status => Object.freeze({ status });
const fileSnapshot = value => Object.freeze(Object.fromEntries(['format', 'version', 'scope', 'publicKey', 'kdf', 'iterations', 'salt', 'iv', 'ciphertext']
  .map(field => [field, value?.[field]])));
function podSlug(value) {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !/^\/[A-Za-z0-9_-]+\/$/.test(url.pathname)) throw fail('recovery_configuration');
  return url.pathname.slice(1, -1);
}
function relayOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw fail('recovery_configuration');
  return url.origin;
}
function candidateScope(candidate, ownerDid, slug) {
  if (!candidate || typeof candidate.scope !== 'string' || candidate.scope.length > 4096
    || !validEncryptionPublicKey(candidate.publicKey)) return false;
  try {
    const scope = JSON.parse(candidate.scope);
    return Array.isArray(scope) && scope.length === 4 && scope[0] === 'interego-client-key/v1'
      && typeof scope[1] === 'string' && relayOrigin(scope[1]) === scope[1]
      && scope[2] === ownerDid && scope[3] === slug;
  } catch { return false; }
}
function graphIri(value) {
  return typeof value === 'string' && value.length <= 1024 && /^urn:graph:[^\s<>"{}|^`\\]+$/.test(value);
}
function characterSummary(save) {
  if (save.char === null || save.char === undefined) return null;
  const char = save.char;
  if (!char || typeof char !== 'object' || Array.isArray(char) || typeof char.name !== 'string'
    || !char.name.trim() || char.name.length > 80 || /[\x00-\x1f\x7f]/.test(char.name)
    || char.level !== undefined && (!Number.isSafeInteger(char.level) || char.level < 1 || char.level > 100000)
    || !Number.isInteger(char.realm) || char.realm < 0 || char.realm > 2
    || typeof char.cls !== 'string' || !/^[a-z][a-z0-9_-]{0,39}$/i.test(char.cls)
    || char.rp !== undefined && (!Number.isSafeInteger(char.rp) || char.rp < 0)) throw fail('invalid_profile');
  return Object.freeze({ name: char.name, ...(char.level !== undefined ? { level: char.level } : {}), realm: char.realm, calling: char.cls, realmPoints: char.rp ?? 0 });
}

// This source never creates/upgrades a database and never opens a write transaction.
// Key records and their scope strings stay inside this module's browser closure.
function browserCandidateSource({ indexedDB, crypto, ownerDid, slug, maxRecords }) {
  let db = null, opening = null, generation = 0, closed = false;
  const active = () => { if (closed) throw fail('recovery_cancelled'); };
  async function database() {
    active();
    if (db) return db;
    if (!opening) opening = (async (attempt) => {
      if (!indexedDB || typeof indexedDB.databases !== 'function') throw fail('recovery_storage_unavailable');
      const names = await indexedDB.databases(); active();
      if (!names.some(value => value.name === DATABASE)) return null;
      return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE);
        let settled = false;
        const refuse = () => { if (!settled) { settled = true; reject(fail('recovery_storage_unavailable')); } };
        request.onupgradeneeded = () => { request.transaction?.abort(); };
        request.onerror = request.onblocked = refuse;
        request.onsuccess = () => {
          const found = request.result;
          if (settled || closed || attempt !== generation || !found.objectStoreNames.contains(STORE)) {
            found.close();
            if (!settled) { settled = true; reject(fail(closed ? 'recovery_cancelled' : 'recovery_storage_unavailable')); }
            return;
          }
          settled = true; db = found;
          found.onversionchange = () => { found.close(); if (db === found) { db = null; opening = null; generation++; } };
          resolve(found);
        };
      });
    })(++generation);
    const attempt = opening;
    try {
      const found = await attempt;
      if (found === null && opening === attempt) opening = null;
      return found;
    } catch (cause) {
      if (opening === attempt) { opening = null; generation++; }
      throw cause;
    }
  }
  async function load(scope, publicKey) {
    const found = await database(); active();
    if (!found) throw fail('recovery_candidate_changed');
    return new Promise((resolve, reject) => {
      const tx = found.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(scope);
      let record;
      request.onsuccess = () => { record = request.result; };
      tx.onerror = tx.onabort = () => reject(fail('recovery_storage_unavailable'));
      tx.oncomplete = () => {
        try {
          active();
          if (!record || record.publicKey !== publicKey) throw fail('recovery_candidate_changed');
          if (record.version !== 1 || record.wrappingKey?.extractable !== false
            || record.wrappingKey?.algorithm?.name !== 'AES-GCM' || record.wrappingKey?.algorithm?.length !== 256
            || !(record.iv instanceof Uint8Array) || record.iv.byteLength !== 12
            || !(record.ciphertext instanceof ArrayBuffer) || record.ciphertext.byteLength !== 48) throw fail('recovery_candidate_invalid');
          resolve(record);
        } catch (cause) { reject(cause); }
      };
    });
  }
  return Object.freeze({
    async publicKeyAt(scope) {
      const found = await database(); active();
      if (!found) return null;
      return new Promise((resolve, reject) => {
        const tx = found.transaction(STORE, 'readonly'), request = tx.objectStore(STORE).get(scope);
        let record;
        request.onsuccess = () => { record = request.result; };
        tx.onerror = tx.onabort = () => reject(fail('recovery_storage_unavailable'));
        tx.oncomplete = () => {
          try {
            active();
            if (record && !validEncryptionPublicKey(record.publicKey)) throw fail('recovery_candidate_invalid');
            resolve(record?.publicKey ?? null);
          } catch (cause) { reject(cause); }
        };
      });
    },
    async list({ limit, signal }) {
      const found = await database(); active();
      if (!found) return { candidates: [], truncated: false };
      return new Promise((resolve, reject) => {
        const tx = found.transaction(STORE, 'readonly'), candidates = [];
        let scanned = 0, truncated = false, cancelled = false;
        const abort = () => { cancelled = true; try { tx.abort(); } catch { /* already finished */ } };
        if (signal?.aborted) abort(); else signal?.addEventListener('abort', abort, { once: true });
        const cleanup = () => signal?.removeEventListener('abort', abort);
        const request = tx.objectStore(STORE).openCursor();
        request.onsuccess = () => {
          const cursor = request.result;
          if (!cursor || cancelled) return;
          if (scanned >= maxRecords || candidates.length >= limit) { truncated = true; return; }
          scanned++;
          const candidate = { scope: cursor.key, publicKey: cursor.value?.publicKey };
          if (candidateScope(candidate, ownerDid, slug)) candidates.push(candidate);
          cursor.continue();
        };
        tx.onerror = tx.onabort = () => { cleanup(); reject(fail(cancelled ? 'recovery_cancelled' : 'recovery_storage_unavailable')); };
        tx.oncomplete = () => { cleanup(); try { active(); resolve({ candidates, truncated }); } catch (cause) { reject(cause); } };
      });
    },
    openVault(candidate) {
      active();
      return new ClientKeyVault(candidate.scope, Object.freeze({
        load: scope => scope === candidate.scope ? load(scope, candidate.publicKey) : Promise.reject(fail('recovery_candidate_changed')),
        create: () => Promise.reject(fail('recovery_read_only')),
      }), crypto);
    },
    close() { closed = true; generation++; db?.close(); db = null; },
  });
}

/** The alias adopter only receives local public routing metadata after fresh proof. */
const defaultAdoptCandidate = async (options, indexedDB, suppliedStorage) => {
  const keyStorage = suppliedStorage || indexedDbKeyStorage({ indexedDB });
  try { return await (await import('./key-scope.mjs')).adoptRetainedKey({ ...options, keyStorage }); }
  finally { if (!suppliedStorage) await keyStorage.close(); }
};

export function createRetainedCharacterRecovery({ binding, relayUrl, credential, pointer = null,
  candidateSource, createClient = createNativePodClient, crypto = globalThis.crypto,
  indexedDB = globalThis.indexedDB, keyStorage: suppliedStorage = null,
  signal, isCurrent = () => true, limits = {}, adoptCandidate = defaultAdoptCandidate } = {}) {
  if (!binding || typeof binding.subjectDid !== 'string' || !/^did:[a-z0-9]+:[^\s<>"{}|^`\\]+$/.test(binding.subjectDid)
    || binding.subjectDid.length > 1024 || typeof binding.podUrl !== 'string' || !crypto?.subtle || !crypto.randomUUID
    || typeof createClient !== 'function' || typeof isCurrent !== 'function' || typeof adoptCandidate !== 'function') throw fail('recovery_configuration');
  const ownerDid = binding.subjectDid, podUrl = binding.podUrl, slug = podSlug(podUrl), relay = relayOrigin(relayUrl);
  if (new URL(podUrl).protocol !== 'https:' || new URL(podUrl).href !== podUrl || pointer?.graphIri !== undefined && !graphIri(pointer.graphIri)) throw fail('recovery_configuration');
  const maxCandidates = bound(limits.maxCandidates, 16, 32), maxRecords = bound(limits.maxRecords, 256, 1024);
  const deadlineMs = bound(limits.deadlineMs, 30000, 60000), access = Object.freeze({ ...credential });
  if (suppliedStorage && (typeof suppliedStorage.load !== 'function' || typeof suppliedStorage.create !== 'function')) throw fail('recovery_configuration');
  const adopter = adoptCandidate === defaultAdoptCandidate ? options => defaultAdoptCandidate(options, indexedDB, suppliedStorage) : adoptCandidate;
  const source = candidateSource || browserCandidateSource({ indexedDB, crypto, ownerDid, slug, maxRecords });
  if (typeof source.list !== 'function' || typeof source.openVault !== 'function') throw fail('recovery_configuration');
  const scope = JSON.stringify(['interego-client-key/v1', relay, ownerDid, slug]);
  const proofs = new Map(); let closed = false, flight = null, kind = null, running = null;
  const clearProofs = () => { for (const proof of proofs.values()) proof.temporary?.clear(); proofs.clear(); };
  const contextCurrent = () => { try { return !closed && !signal?.aborted && isCurrent(); } catch { return false; } };
  async function probe(expected = null, recoveryFile = null) {
    const controller = new AbortController(); running = controller; clearProofs();
    let timedOut = false;
    const externalAbort = () => controller.abort();
    signal?.addEventListener('abort', externalAbort, { once: true });
    const timer = setTimeout(() => { timedOut = true; controller.abort(); }, deadlineMs);
    const clients = new Set(), ownedStorage = new Set();
    let temporary = null, temporaryVault = null, keepTemporary = false;
    const check = () => {
      if (!contextCurrent()) throw fail('recovery_cancelled');
      if (controller.signal.aborted) throw fail(timedOut ? 'recovery_timeout' : 'recovery_cancelled');
      if (Number.isFinite(access.expiresAt) && access.expiresAt <= Date.now()) throw fail('needs_reauth');
    };
    const guarded = operation => {
      check();
      return new Promise((resolve, reject) => {
        const abort = () => reject(fail(timedOut ? 'recovery_timeout' : 'recovery_cancelled'));
        controller.signal.addEventListener('abort', abort, { once: true });
        Promise.resolve().then(operation).then(value => {
          controller.signal.removeEventListener('abort', abort);
          try { check(); resolve(value); } catch (cause) { reject(cause); }
        }, cause => { controller.signal.removeEventListener('abort', abort); reject(cause); });
      });
    };
    const clientFor = vault => {
      const port = Object.freeze({ publicKey: () => guarded(() => vault.publicKey()), open: envelope => guarded(() => vault.open(envelope)) });
      const client = createClient({ ownerDid, podUrl, relayUrl: relay, credential: access, vault: port, crypto });
      if (!client || !['connect', 'currentHead', 'load', 'close'].every(name => typeof client[name] === 'function')) throw fail('recovery_configuration');
      clients.add(client); return client;
    };
    const connect = async client => {
      const actual = await guarded(() => client.connect());
      if (actual?.ownerDid !== ownerDid || podSlug(actual.podUrl) !== slug) throw fail('owner_mismatch');
    };
    const sameHead = (expected, actual) => expected === null ? actual === null : sameNativeHead(expected, actual);
    try {
      check();
      const indexGraph = await guarded(() => playerProfileIndexGraphIri(ownerDid, crypto));
      const defaultGraph = await guarded(() => playerProfileGraphIri(ownerDid, crypto));
      let imported = null;
      if (recoveryFile) {
        const file = recoveryFile.file;
        let passphrase = recoveryFile.passphrase;
        recoveryFile.file = null; recoveryFile.passphrase = null;
        if (!candidateScope(file, ownerDid, slug) || typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 4096
          || typeof file.salt !== 'string' || file.salt.length !== 24 || typeof file.iv !== 'string' || file.iv.length !== 16
          || typeof file.ciphertext !== 'string' || file.ciphertext.length !== 64) throw fail('invalid_recovery_file');
        const currentPublicKey = suppliedStorage ? (await guarded(() => suppliedStorage.load(scope)))?.publicKey
          : typeof source.publicKeyAt === 'function' ? await guarded(() => source.publicKeyAt(scope)) : null;
        if (currentPublicKey && currentPublicKey !== file.publicKey) throw fail('key_exists');
        temporary = new Map();
        const port = Object.freeze({
          load: async value => { check(); return temporary.get(value) || null; },
          create: (value, record) => {
            if (value !== file.scope) return Promise.reject(fail('recovery_read_only'));
            check();
            if (!temporary.has(value)) temporary.set(value, record);
            return Promise.resolve(temporary.get(value));
          },
        });
        // The public SDK restores under its ORIGINAL authenticated scope in
        // protected memory only. An unproven file cannot occupy a persistent slot.
        const original = new ClientKeyVault(file.scope, port, crypto);
        try { await guarded(() => original.restore(file, passphrase)); }
        finally { passphrase = null; }
        if (await guarded(() => original.publicKey()) !== file.publicKey) throw fail('recovery_candidate_changed');
        temporaryVault = original;
        imported = Object.freeze({ scope: file.scope, publicKey: file.publicKey });
      }
      const listed = expected ? [expected.candidate] : imported ? [imported]
        : await guarded(() => source.list({ limit: maxCandidates + 1, signal: controller.signal }));
      const entries = Array.isArray(listed) ? listed : listed?.candidates;
      if (!Array.isArray(entries)) throw fail('recovery_storage_unavailable');
      const truncated = !!(!Array.isArray(listed) && listed.truncated) || entries.length > maxCandidates;
      for (const candidate of entries.slice(0, maxCandidates)) {
        check();
        if (!candidateScope(candidate, ownerDid, slug)) continue;
        const vault = temporaryVault || (expected?.temporaryVault ?? await guarded(() => source.openVault(candidate)));
        if (!vault || typeof vault.publicKey !== 'function' || typeof vault.open !== 'function') throw fail('recovery_candidate_invalid');
        if (await guarded(() => vault.publicKey()) !== candidate.publicKey) {
          if (expected) throw fail('conflict');
          continue;
        }
        const client = clientFor(vault);
        try {
          await connect(client);
          const initialIndex = await guarded(() => client.currentHead({ graphIri: indexGraph }));
          let target = pointer?.graphIri || defaultGraph;
          if (initialIndex) {
            const index = await guarded(() => client.load({ graphIri: indexGraph }));
            if (!index || index.graphIri !== indexGraph || !sameNativeHead(initialIndex, index.head)) throw fail('conflict');
            target = validatePlayerProfileIndex(index.record, ownerDid);
          }
          if (expected && (target !== expected.graphIri || !sameHead(expected.indexHead, initialIndex))) throw fail('conflict');
          const initialProfile = await guarded(() => client.currentHead({ graphIri: target, checkpoint: CHECKPOINT }));
          const found = await guarded(() => client.load({ graphIri: target, checkpoint: CHECKPOINT }));
          const latestIndex = await guarded(() => client.currentHead({ graphIri: indexGraph }));
          if (!sameHead(initialIndex, latestIndex)) throw fail('conflict');
          if (!found) {
            if (expected) throw fail('conflict');
            if (initialProfile !== null) throw fail('conflict');
            if (initialIndex) return outcome('index_only');
            continue;
          }
          if (found.graphIri !== target || !found.head?.descriptorUrl || !found.head.cid) throw fail('invalid_profile');
          if (!sameHead(initialProfile, found.head)) throw fail('conflict');
          const save = validatePlayerProfile(found.record, ownerDid);
          const latest = await guarded(() => client.currentHead({ graphIri: target, checkpoint: CHECKPOINT }));
          if (!sameNativeHead(found.head, latest)) throw fail('conflict');
          const summary = characterSummary(save); check();
          const finalIndex = await guarded(() => client.currentHead({ graphIri: indexGraph }));
          if (!sameHead(initialIndex, finalIndex)) throw fail('conflict');
          const recordBytes = new TextEncoder().encode(JSON.stringify(found.record));
          if (recordBytes.byteLength > 512 * 1024) throw fail('invalid_profile');
          const recordHash = await guarded(() => crypto.subtle.digest('SHA-256', recordBytes));
          const digest = JSON.stringify([typeof found.digest === 'string' ? found.digest : null,
            [...new Uint8Array(recordHash)].map(value => value.toString(16).padStart(2, '0')).join('')]);
          if (expected) {
            if (!sameNativeHead(expected.head, found.head) || expected.digest !== digest
              || JSON.stringify(expected.summary) !== JSON.stringify(summary)) throw fail('conflict');
            if (expected.temporary) {
              const storage = suppliedStorage || indexedDbKeyStorage({ indexedDB });
              if (!suppliedStorage) ownedStorage.add(storage);
              const canonical = await guarded(() => storage.load(scope));
              if (canonical && canonical.publicKey !== candidate.publicKey) throw fail('key_exists');
              const record = expected.temporary.get(candidate.scope);
              if (!record || record.publicKey !== candidate.publicKey) throw fail('recovery_candidate_changed');
              const saved = await guarded(() => storage.create(candidate.scope, record,
                { signal: controller.signal, isCurrent: () => contextCurrent() && !controller.signal.aborted,
                  absentKeys: [ownerKeyAliasAddress(candidate.scope)] }));
              if (saved?.publicKey !== candidate.publicKey) throw fail('key_exists');
              // A concurrent winner must open with the already-proven key too.
              const persisted = new ClientKeyVault(candidate.scope, storage, crypto);
              const challenge = 'hallowmarch-recovery-check:' + crypto.randomUUID();
              const sealed = await guarded(() => vault.seal(challenge));
              if (await guarded(() => persisted.open(sealed)) !== challenge) throw fail('recovery_candidate_changed');
            }
            if (candidate.scope === scope) return outcome('activated');
            const adopted = await guarded(() => adopter({ scope, sourceScope: candidate.scope, publicKey: candidate.publicKey,
              crypto, signal: controller.signal, isCurrent: () => contextCurrent() && !controller.signal.aborted }));
            if (adopted?.adopted !== true) throw fail('recovery_adoption_failed');
            return outcome('activated');
          }
          const handle = 'recovery-' + crypto.randomUUID();
          // Neither the vault, its old scope nor opened records leave this closure.
          proofs.set(handle, { candidate: Object.freeze({ scope: candidate.scope, publicKey: candidate.publicKey }),
            indexHead: initialIndex && { ...initialIndex }, graphIri: target, head: { ...found.head }, digest, summary,
            ...(temporary ? { temporary, temporaryVault } : {}) });
          keepTemporary = !!temporary;
          return Object.freeze({ status: summary ? 'verified_character' : 'verified_empty', ...(summary ? { summary } : {}), handle });
        } catch (cause) {
          if (['cannot_decrypt', 'invalid_checkpoint_sender', 'key_required'].includes(cause?.code)) {
            if (expected) throw fail('conflict');
            if (recoveryFile) throw fail('invalid_recovery_file');
            continue;
          }
          throw cause;
        } finally { client.close(); clients.delete(client); }
      }
      return outcome(truncated ? 'limit_reached' : 'no_match');
    } catch (cause) {
      clearProofs();
      if (['recovery_cancelled', 'cancelled'].includes(cause?.code) || !contextCurrent()) return outcome('cancelled');
      return outcome((expected && ['invalid_profile', 'invalid_profile_index', 'owner_mismatch', 'invalid_proof',
        'invalid_checkpoint', 'invalid_record'].includes(cause?.code)) || ['conflict', 'profile_index_conflict', 'checkpoint_binding_conflict', 'recovery_candidate_changed',
        'key_scope_conflict', 'alias_conflict', 'key_exists', 'recovery_conflict', 'key_changed', 'key_scope_changed'].includes(cause?.code) ? 'conflict' : 'unavailable');
    } finally {
      if (recoveryFile) { recoveryFile.file = null; recoveryFile.passphrase = null; }
      clearTimeout(timer); signal?.removeEventListener('abort', externalAbort);
      for (const client of clients) { try { client.close(); } catch { /* no recovery result is promoted */ } }
      for (const storage of ownedStorage) { try { await storage.close(); } catch { /* the original imported record is preserved */ } }
      if (temporary && !keepTemporary) temporary.clear();
      expected?.temporary?.clear();
      if (running === controller) running = null;
    }
  }
  function launch(operation, expected = null, recoveryFile = null) {
    kind = operation;
    flight = probe(expected, recoveryFile).finally(() => { flight = null; kind = null; });
    return flight;
  }
  return Object.freeze({
    discover() { if (flight) return kind === 'discover' ? flight : Promise.resolve(outcome('unavailable')); return launch('discover'); },
    activate(handle) {
      if (!contextCurrent()) return Promise.resolve(outcome('cancelled'));
      if (flight) return Promise.resolve(outcome('unavailable'));
      const expected = typeof handle === 'string' && proofs.get(handle);
      if (!expected) return Promise.resolve(outcome('unavailable'));
      proofs.delete(handle);
      return launch('activate', expected);
    },
    restore(file, passphrase) {
      if (!contextCurrent()) return Promise.resolve(outcome('cancelled'));
      if (flight) return Promise.resolve(outcome('unavailable'));
      try { return launch('restore', null, { file: fileSnapshot(file), passphrase }); }
      catch { return Promise.resolve(outcome('unavailable')); }
    },
    discard(handle) {
      if (typeof handle !== 'string') return false;
      const proof = proofs.get(handle); proof?.temporary?.clear(); return proofs.delete(handle);
    },
    close() { closed = true; running?.abort(); clearProofs(); try { source.close?.(); } catch { /* no private storage details escape */ } },
  });
}
