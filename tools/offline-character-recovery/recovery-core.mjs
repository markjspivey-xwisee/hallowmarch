/** A load-only view of the one historical owner key slot. Never character proof. */
import { ClientKeyVault, validEncryptionPublicKey } from '../../client/native-pod/vendor/interego-browser.mjs';
import { candidateSlots, checkedPublicScope, KEY_DATABASE, KEY_STORE, RECOVERY_ORIGIN } from './scope.mjs';

const result = status => Object.freeze({ status });
const refused = status => Object.assign(new Error('The optional browser key check did not complete.'), { status });
function checkedRecord(record) {
  if (!record || record.version !== 1 || !validEncryptionPublicKey(record.publicKey)
    || record.wrappingKey?.type !== 'secret' || record.wrappingKey?.extractable !== false
    || record.wrappingKey?.algorithm?.name !== 'AES-GCM' || record.wrappingKey?.algorithm?.length !== 256
    || !record.wrappingKey.usages?.includes('decrypt') || !record.wrappingKey.usages?.includes('encrypt')
    || !(record.iv instanceof Uint8Array) || record.iv.byteLength !== 12
    || !(record.ciphertext instanceof ArrayBuffer) || record.ciphertext.byteLength !== 48) throw refused('unavailable');
  return record;
}
async function fingerprint(record, crypto) {
  checkedRecord(record);
  const bytes = new Uint8Array(32 + 12 + 48), key = record.publicKey;
  // The existing SDK validates canonical, padded standard base64 (32 bytes).
  const publicBytes = Uint8Array.from(atob(key), value => value.charCodeAt(0));
  bytes.set(publicBytes); bytes.set(record.iv, 32); bytes.set(new Uint8Array(record.ciphertext), 44);
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), value => value.toString(16).padStart(2, '0')).join('');
}

/** All transactions are readonly. A missing-database race aborts its upgrade. */
async function openExisting(indexedDB, current, remember) {
  if (!indexedDB || typeof indexedDB.databases !== 'function') throw refused('unavailable');
  const names = await indexedDB.databases(); current();
  if (!names.some(value => value.name === KEY_DATABASE)) return null;
  return new Promise((resolve, reject) => {
    let done = false;
    const request = indexedDB.open(KEY_DATABASE);
    const finish = (error, db) => {
      if (done) { db?.close(); return; }
      done = true; clearTimeout(timer);
      if (error) reject(error); else resolve(db);
    };
    const timer = setTimeout(() => finish(refused('unavailable')), 5000);
    request.onupgradeneeded = () => { request.transaction?.abort(); };
    request.onerror = request.onblocked = () => finish(refused('unavailable'));
    request.onsuccess = () => {
      const db = request.result;
      try {
        current();
        if (!db.objectStoreNames.contains(KEY_STORE)) throw refused('unavailable');
        db.onversionchange = () => db.close();
        remember(db); finish(null, db);
      } catch (error) { db.close(); finish(error); }
    };
  });
}
function load(db, scope, current) {
  current();
  return new Promise((resolve, reject) => {
    let record, done = false;
    const tx = db.transaction(KEY_STORE, 'readonly');
    const finish = error => {
      if (done) return;
      done = true; clearTimeout(timer);
      if (error) reject(error); else {
        try { current(); resolve(record ?? null); } catch (cause) { reject(cause); }
      }
    };
    const timer = setTimeout(() => { try { tx.abort(); } catch { /* already complete */ } finish(refused('unavailable')); }, 5000);
    const request = tx.objectStore(KEY_STORE).get(scope);
    request.onsuccess = () => { record = request.result; };
    tx.onabort = tx.onerror = () => finish(refused('unavailable'));
    tx.oncomplete = () => finish();
  });
}

export function createOfflineKeyRecovery({ publicScope, origin = globalThis.location?.origin,
  indexedDB = globalThis.indexedDB, crypto = globalThis.crypto } = {}) {
  const selected = checkedPublicScope(publicScope), slots = candidateSlots(selected);
  if (origin !== RECOVERY_ORIGIN || !crypto?.subtle || typeof crypto.randomUUID !== 'function') throw refused('unavailable');
  // Construction and consent changes perform no browser storage operation.
  let generation = 0, closed = false;
  const handles = new Map(), connections = new Set();
  const cancel = () => { generation++; handles.clear(); for (const db of connections) db.close(); connections.clear(); };
  async function operation(body) {
    const attempt = ++generation;
    const current = () => { if (closed || attempt !== generation) throw refused('cancelled'); };
    let db;
    try {
      current(); db = await openExisting(indexedDB, current, value => { db = value; connections.add(value); }); current();
      return await body(db, current);
    } catch (error) {
      if (closed || attempt !== generation) return result('cancelled');
      return result(['changed', 'cancelled'].includes(error?.status) ? error.status : 'unavailable');
    } finally { if (db) { db.close(); connections.delete(db); } }
  }
  return Object.freeze({
    async check({ consent = false } = {}) {
      if (consent !== true) return result('consent_required');
      handles.clear();
      return operation(async (db, current) => {
        if (!db) return result('no_candidate');
        const candidates = [];
        for (const slot of slots) {
          const record = await load(db, slot.scope, current); current();
          if (!record) continue; // Never instantiate a vault for a missing record.
          const digest = await fingerprint(record, crypto); current();
          const handle = crypto.randomUUID();
          handles.set(handle, Object.freeze({ slot, publicKey: record.publicKey, digest }));
          candidates.push(Object.freeze({ handle, publicKey: record.publicKey, relayOrigin: slot.relayOrigin }));
        }
        return candidates.length ? Object.freeze({ status: 'candidates', candidates: Object.freeze(candidates) }) : result('no_candidate');
      });
    },
    async backup({ handle, passphrase, consent = false } = {}) {
      if (consent !== true) return result('consent_required');
      if (typeof passphrase !== 'string' || passphrase.length < 12 || passphrase.length > 4096) return result('invalid_passphrase');
      const candidate = handles.get(handle);
      if (!candidate) return result('changed');
      return operation(async (db, current) => {
        if (!db) throw refused('changed');
        const pinnedLoad = async scope => {
          current();
          if (scope !== candidate.slot.scope) throw refused('changed');
          const record = await load(db, scope, current); current();
          if (!record || record.publicKey !== candidate.publicKey || await fingerprint(record, crypto) !== candidate.digest) throw refused('changed');
          current(); return record;
        };
        await pinnedLoad(candidate.slot.scope); current();
        const storage = Object.freeze({ load: pinnedLoad, create: () => Promise.reject(refused('unavailable')) });
        const vault = new ClientKeyVault(candidate.slot.scope, storage, crypto);
        const recovery = await vault.backup(passphrase); current();
        await pinnedLoad(candidate.slot.scope); current();
        if (recovery.scope !== candidate.slot.scope || recovery.publicKey !== candidate.publicKey) throw refused('changed');
        return Object.freeze({ status: 'backup_ready', recovery });
      });
    },
    cancel,
    close() { closed = true; cancel(); },
  });
}
