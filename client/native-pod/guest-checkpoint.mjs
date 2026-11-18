/** A general guest's character, sealed in this browser for the guest's own pod
 * (src/14w_generalguest.js; server/gaming/general-guest-pod.js).
 *
 * The X25519 key is made here, at the game's origin, and kept only here: its
 * secret is wrapped by a non-extractable AES-GCM key in this origin's IndexedDB
 * (the vault the native owner's client uses). Nothing of it is sent anywhere,
 * so another browser cannot open what this one sealed. The envelope is the
 * substrate's own, with one wrapped key, its own sender. */
import { ClientKeyVault } from './vendor/interego-browser.mjs';

const SCHEMA = 'hallowmarch.general-guest-save/v1';
const DB = 'hallowmarch-general-guest', STORE = 'keys';
export const GUEST_SAVE_MAX_ENVELOPE = 760 * 1024;

/** IndexedDB, one record a scope. CryptoKey objects are stored as they are: structured clone keeps them non-extractable. */
export function guestKeyStorage(factory = globalThis.indexedDB) {
  const open = () => new Promise((resolve, reject) => {
    const request = factory.open(DB, 1);
    request.onupgradeneeded = () => { request.result.createObjectStore(STORE); };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB is unavailable'));
  });
  // Answered only once the transaction has committed: a key reported kept before that could be lost.
  const run = async (mode, work) => {
    const database = await open();
    try {
      return await new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE, mode), request = work(transaction.objectStore(STORE));
        transaction.oncomplete = () => resolve(request.result);
        transaction.onabort = transaction.onerror = () => reject(transaction.error ?? request.error ?? new Error('IndexedDB transaction failed'));
      });
    } finally { database.close(); }
  };
  return {
    load: async scope => (await run('readonly', store => store.get(scope))) ?? null,
    // `add` never replaces: two tabs making a key at once keep the first.
    create: async (scope, record) => { try { await run('readwrite', store => store.add(record, scope)); } catch { /* another tab's stands */ }
      return run('readonly', store => store.get(scope)); },
    remove: async scope => { await run('readwrite', store => store.delete(scope)); },
  };
}

const toBase64 = bytes => { let binary = ''; for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(binary); };
const fromBase64 = text => { const binary = atob(text), bytes = new Uint8Array(binary.length); for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i); return bytes; };
async function through(stream, bytes) {
  const writer = stream.writable.getWriter();
  void writer.write(bytes).then(() => writer.close()).catch(() => {});
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

/** The vault of one guest account in this browser. `account` is the game's account id for the guest. */
export function createGuestCheckpoint({ account, storage = guestKeyStorage(), crypto = globalThis.crypto, now = Date.now } = {}) {
  if (typeof account !== 'string' || !/^gg-[0-9a-f]{40}$/.test(account)) throw new TypeError('A general guest account is required.');
  const scope = 'hallowmarch-general-guest/v1:' + account, vault = new ClientKeyVault(scope, storage, crypto);
  return Object.freeze({
    /** True where this browser already holds the key that seals this guest's character. */
    async hasKey() { return !!await vault.publicKey(); },
    /** Seal `save` (the game's save record, or null for a deleted character). Makes the key on first use. */
    async seal(save) {
      await vault.create();
      const text = JSON.stringify(save ?? null);
      let body = { schema: SCHEMA, account, at: now(), z: 'none', d: text };
      if (typeof CompressionStream === 'function') {
        try { body = { ...body, z: 'gzip', d: toBase64(await through(new CompressionStream('gzip'), new TextEncoder().encode(text))) }; }
        catch { /* sealed uncompressed */ }
      }
      const envelope = await vault.seal(JSON.stringify(body));
      const bytes = new TextEncoder().encode(JSON.stringify(envelope)).length;
      if (bytes > GUEST_SAVE_MAX_ENVELOPE) throw Object.assign(new Error('The sealed character is too large for one write.'), { code: 'too_large' });
      return { envelope, bytes };
    },
    /** Open an envelope this browser sealed. `{ save, at }`, or null where this browser's key does not open it. */
    async open(envelope) {
      try {
        if (!await vault.publicKey()) return null;
        const body = JSON.parse(await vault.open(envelope));
        if (!body || body.schema !== SCHEMA || body.account !== account || !Number.isSafeInteger(body.at) || typeof body.d !== 'string') return null;
        const text = body.z === 'gzip' ? new TextDecoder('utf-8', { fatal: true }).decode(await through(new DecompressionStream('gzip'), fromBase64(body.d)))
          : body.z === 'none' ? body.d : null;
        return text === null ? null : { save: JSON.parse(text), at: body.at };
      } catch { return null; }
    },
    /** Forget this browser's key: what it sealed can never be opened again. */
    async forget() { try { await storage.remove?.(scope); } catch { /* storage blocked */ } },
  });
}
