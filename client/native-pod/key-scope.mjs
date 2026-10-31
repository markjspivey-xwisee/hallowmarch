/** Public recovery links reuse an existing vault; encrypted key records stay untouched. */
import { ClientKeyVault, validEncryptionPublicKey } from './vendor/interego-browser.mjs';

const SCHEMA = 'hallowmarch-key-scope/v1';
export const ownerKeyAliasAddress = scope => SCHEMA + ':' + scope;
const address = ownerKeyAliasAddress;
function refusal(code, message) { throw Object.assign(new Error(message), { code }); }
export function parseOwnerKeyScope(scope) {
  try {
    if (typeof scope !== 'string' || scope.length > 4096) return null;
    const parts = JSON.parse(scope);
    if (!Array.isArray(parts) || parts.length !== 4 || parts[0] !== 'interego-client-key/v1'
      || parts.some(value => typeof value !== 'string') || !parts[2].startsWith('did:') || parts[2].length > 1024
      || !/^[a-zA-Z0-9_-]{1,200}$/.test(parts[3])) return null;
    const relay = new URL(parts[1]);
    if (relay.protocol !== 'https:' || relay.origin !== parts[1] || relay.pathname !== '/'
      || relay.username || relay.password || relay.search || relay.hash) return null;
    return { relay: parts[1], ownerDid: parts[2], podName: parts[3] };
  } catch { return null; }
}
function sourceFor(scope, alias) {
  const target = parseOwnerKeyScope(scope), source = parseOwnerKeyScope(alias?.sourceScope);
  if (!target || !source || source.ownerDid !== target.ownerDid || source.podName !== target.podName
    || alias.sourceScope === scope || alias.schema !== SCHEMA
    || Object.keys(alias).some(key => !['schema', 'sourceScope', 'publicKey'].includes(key))
    || typeof alias.publicKey !== 'string' || !/^[A-Za-z0-9+/]{43}=$/.test(alias.publicKey)) {
    refusal('invalid_recovery_link', 'The saved key connection is invalid. Existing keys were kept.');
  }
  return alias.sourceScope;
}

/** Call only after authenticated character proof and an explicit owner action. */
export async function adoptRetainedKey({ scope, sourceScope, publicKey, keyStorage, crypto = globalThis.crypto,
  signal, isCurrent = () => true }) {
  const active = () => { if (signal?.aborted || !isCurrent()) refusal('cancelled', 'The recovery request changed. Existing keys were kept.'); };
  active();
  const alias = { schema: SCHEMA, sourceScope, publicKey };
  sourceFor(scope, alias);
  if (await keyStorage.load(scope)) refusal('key_exists', 'This site already has a key. Its key was preserved.');
  active();
  const source = new ClientKeyVault(sourceScope, keyStorage, crypto);
  if (await source.publicKey() !== publicKey) refusal('key_changed', 'The saved browser key changed. Check recovery again.');
  const challenge = 'hallowmarch-key-recovery:' + publicKey;
  if (await source.open(await source.seal(challenge)) !== challenge) refusal('key_changed', 'The saved browser key could not be verified.');
  active();
  // Atomic insert, with a separate address: never rename, replace or duplicate
  // a protected key record, and never change its authenticated encryption data.
  const stored = await keyStorage.create(address(scope), alias, { signal, isCurrent });
  active();
  if (sourceFor(scope, stored) !== sourceScope || stored.publicKey !== publicKey) {
    refusal('recovery_conflict', 'Another recovery choice is already saved. Existing keys were kept.');
  }
  if (await keyStorage.load(scope)) refusal('key_exists', 'Another tab saved a key for this site. Its key was preserved.');
  if (await source.publicKey() !== publicKey) refusal('key_changed', 'The saved browser key changed. Check recovery again.');
  active(); return { adopted: true };
}

/** Resolve once per client so a concurrent tab cannot switch its vault mid-operation. */
export function createOwnerKeyVault({ scope, keyStorage, crypto = globalThis.crypto }) {
  if (!parseOwnerKeyScope(scope)) refusal('invalid_identity', 'A verified owner key scope is required.');
  const changed = () => refusal('key_scope_changed', 'The browser key selection changed. Reconnect before continuing. Existing keys were kept.');
  const missing = () => refusal('key_required', 'The original browser key is unavailable. Restore its recovery file. No replacement was created.');
  const fingerprint = record => {
    if (!record || !validEncryptionPublicKey(record.publicKey)) return missing();
    return record.publicKey;
  };
  function canonicalSelection(initial) {
    let pinned = initial ? fingerprint(initial) : null;
    const guard = async () => {
      const current = await keyStorage.load(scope);
      if (current) {
        const publicKey = fingerprint(current);
        if (pinned && publicKey !== pinned) return changed();
        pinned = publicKey; return current;
      }
      if (pinned) return missing();
      if (await keyStorage.load(address(scope))) return changed();
      return null;
    };
    const storage = Object.freeze({
      load: value => value === scope ? guard() : Promise.reject(Object.assign(new Error('The browser key selection changed.'), { code: 'key_scope_changed' })),
      async create(value, record) {
        if (value !== scope) return changed();
        const existing = await guard();
        if (existing) return existing;
        // The alias absence check and key insertion share one storage transaction.
        // A late recovery choice must not be hidden by a newly generated key.
        const stored = await keyStorage.create(scope, record, { absentKeys: [address(scope)] });
        const publicKey = fingerprint(stored);
        if (pinned && pinned !== publicKey) return changed();
        pinned = publicKey; await guard(); return stored;
      },
    });
    return { vault: new ClientKeyVault(scope, storage, crypto), guard };
  }
  function aliasSelection(alias) {
    const sourceScope = sourceFor(scope, alias), pinned = alias.publicKey;
    const guard = async () => {
      const canonical = await keyStorage.load(scope);
      if (canonical && canonical.publicKey !== pinned) return changed();
      const source = await keyStorage.load(sourceScope);
      if (!source) return missing();
      if (fingerprint(source) !== pinned) return changed();
      const currentAlias = await keyStorage.load(address(scope));
      if (!currentAlias || sourceFor(scope, currentAlias) !== sourceScope || currentAlias.publicKey !== pinned) return changed();
      const latestCanonical = await keyStorage.load(scope);
      if (latestCanonical && latestCanonical.publicKey !== pinned) return changed();
      return source;
    };
    const storage = Object.freeze({
      load: value => value === sourceScope ? guard() : Promise.reject(Object.assign(new Error('The browser key selection changed.'), { code: 'key_scope_changed' })),
      async create(value) { if (value !== sourceScope) return changed(); return guard(); },
    });
    return { vault: new ClientKeyVault(sourceScope, storage, crypto), guard, retainedPublicKey: pinned };
  }
  let selected;
  const resolve = () => selected ||= (async () => {
    const current = await keyStorage.load(scope);
    if (current) return canonicalSelection(current);
    const alias = await keyStorage.load(address(scope));
    if (!alias) return canonicalSelection(null);
    // A canonical key that won a concurrent insert always takes precedence.
    const latest = await keyStorage.load(scope);
    if (latest) return canonicalSelection(latest);
    const found = aliasSelection(alias); await found.guard(); return found;
  })();
  const using = async run => {
    const found = await resolve(); await found.guard();
    const value = await run(found);
    // SDK crypto and backup derivation await the browser. Recheck before their
    // result can leave this client, without switching its selected vault.
    await found.guard(); return value;
  };
  return Object.freeze({
    publicKey: () => using(found => found.vault.publicKey()),
    open: envelope => using(found => found.vault.open(envelope)),
    seal: (content, recipients) => using(found => found.vault.seal(content, recipients)),
    create: () => using(found => found.retainedPublicKey || found.vault.create()),
    backup: passphrase => using(found => found.vault.backup(passphrase)),
    restore: (file, passphrase) => using(found => {
      if (found.retainedPublicKey && file?.publicKey !== found.retainedPublicKey) refusal('key_exists', 'Restore the original key. Existing keys were kept.');
      return found.vault.restore(file, passphrase);
    }),
  });
}
