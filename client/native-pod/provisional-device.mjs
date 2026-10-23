/** Durable browser key custody for native provisional play. Never a save store. */
const SCHEMA = 'hallowmarch.provisional-device/v1';
const DATABASE = 'hallowmarch-provisional-device-v1';
const encoder = new TextEncoder();
const clone = value => structuredClone(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const object = value => value && typeof value === 'object' && !Array.isArray(value);
function originOf(value) {
  let url;
  try { url = new URL(value); } catch { fail('invalid_origin', 'A secure game origin is required.'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    fail('invalid_origin', 'A secure game origin is required.');
  }
  return url.origin;
}
function bounded(value, maximum, label) {
  if (typeof value !== 'string' || !value || value.length > maximum || /[\r\n\u0000]/.test(value)) {
    fail('invalid_proof', 'The ' + label + ' is invalid.');
  }
  return value;
}
export function provisionalPublicKey(value) {
  if (!object(value) || value.kty !== 'EC' || value.crv !== 'P-256'
    || Object.hasOwn(value, 'd') || !/^[A-Za-z0-9_-]{43}$/.test(value.x || '')
    || !/^[A-Za-z0-9_-]{43}$/.test(value.y || '')) fail('invalid_device_key', 'The public play key is invalid.');
  return { kty: 'EC', crv: 'P-256', x: value.x, y: value.y };
}
export function provisionalBase64Url(bytes) {
  let binary = '';
  for (const value of bytes) binary += String.fromCharCode(value);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}
export async function provisionalKeyThumbprint(publicKeyJwk, crypto = globalThis.crypto) {
  const key = provisionalPublicKey(publicKeyJwk);
  const canonical = JSON.stringify({ crv: key.crv, kty: key.kty, x: key.x, y: key.y });
  return provisionalBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', encoder.encode(canonical))));
}

/** CryptoKey structured cloning keeps the signing key nonextractable. */
export function indexedDbProvisionalStorage({ indexedDB = globalThis.indexedDB, databaseName = DATABASE } = {}) {
  let opening;
  async function database() {
    if (!indexedDB) fail('device_storage_unavailable', 'This browser cannot protect a persistent play session.');
    if (!opening) opening = new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, 1);
      request.onupgradeneeded = () => request.result.createObjectStore('devices');
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => reject(Object.assign(new Error('Browser play-key storage could not open.'), { code: 'device_storage_unavailable' }));
    });
    return opening;
  }
  async function transact(scope, candidate, expectedRevision) {
    const db = await database();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('devices', candidate ? 'readwrite' : 'readonly');
      const store = tx.objectStore('devices');
      let result, mismatch = false;
      const read = store.get(scope);
      read.onsuccess = () => {
        const current = read.result || null;
        if (!candidate) { result = current; return; }
        if (expectedRevision !== undefined) {
          if (current?.revision !== expectedRevision) { mismatch = true; tx.abort(); return; }
          store.put(candidate, scope); result = candidate;
        } else if (current) result = current;
        else { store.add(candidate, scope); result = candidate; }
      };
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () => reject(Object.assign(new Error(mismatch
        ? 'This browser play session changed in another tab.' : 'The browser play-key transaction did not complete.'),
      { code: mismatch ? 'device_changed' : 'device_storage_unavailable' }));
    });
  }
  return Object.freeze({ load: scope => transact(scope), create: (scope, record) => transact(scope, record),
    replace: (scope, revision, record) => transact(scope, record, revision),
    async close() { if (opening) (await opening).close(); opening = null; } });
}

const METADATA_FIELDS = new Set(['ownerDid', 'podUrl', 'issuer', 'relayUrl', 'provisionalEndpoint', 'attestation',
  'guestExpiresAt', 'proofKeyThumbprint', 'characterId', 'credentialExpiresAt', 'claimedOwnerDid', 'targetClaim', 'lastConfirmedClaim']);
function metadataOf(value) {
  if (value === null || value === undefined) return null;
  if (!object(value) || Object.keys(value).some(key => !METADATA_FIELDS.has(key))
    || encoder.encode(JSON.stringify(value)).byteLength > 32768) fail('invalid_device_metadata', 'The public play-session metadata is invalid.');
  if (typeof value.ownerDid !== 'string' || !/^did:[a-z0-9]+:[^\s]+$/.test(value.ownerDid)
    || typeof value.podUrl !== 'string' || value.podUrl.length > 2048
    || !Number.isSafeInteger(value.guestExpiresAt) || value.guestExpiresAt <= 0
    || !/^[A-Za-z0-9_-]{43}$/.test(value.proofKeyThumbprint || '')
    || typeof value.attestation !== 'string' || !value.attestation || value.attestation.length > 16384
    || value.characterId !== undefined && !/^urn:uuid:[0-9a-f-]{36}$/i.test(value.characterId)
    || value.credentialExpiresAt !== undefined && !Number.isSafeInteger(value.credentialExpiresAt)
    || value.claimedOwnerDid !== undefined && !/^did:[a-z0-9]+:[^\s]+$/.test(value.claimedOwnerDid)) fail('invalid_device_metadata', 'The public play-session metadata is invalid.');
  originOf(value.issuer); originOf(value.relayUrl);
  if (value.lastConfirmedClaim !== undefined && typeof value.lastConfirmedClaim !== 'boolean') fail('invalid_device_metadata', 'The last-confirmed claim choice is invalid.');
  const pod = new URL(value.podUrl), endpoint = new URL(value.provisionalEndpoint);
  if (pod.protocol !== 'https:' || pod.username || pod.password || pod.search || pod.hash
    || !pod.pathname.endsWith('/') || endpoint.origin !== originOf(value.issuer)
    || endpoint.protocol !== 'https:' || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
    fail('invalid_device_metadata', 'The play-session endpoints are invalid.');
  }
  if (value.targetClaim !== undefined && value.targetClaim !== null) {
    const target = value.targetClaim;
    if (!object(target) || Object.keys(target).some(key => !['binding', 'appSession', 'confirmation'].includes(key))
      || !object(target.binding) || !object(target.appSession)
      || Object.keys(target.binding).some(key => !['subjectDid', 'podUrl', 'userId', 'webId', 'authenticatedAgentDid', 'verifiedAt', 'issuer', 'verificationMethod'].includes(key))
      || Object.keys(target.appSession).some(key => !['purpose', 'claimOperationId', 'guestOwnerDid', 'targetOwnerDid', 'audience', 'sourceChallenge', 'expiresAt', 'existingRecord'].includes(key))
      || target.appSession.purpose !== 'character-claim-target'
      || target.appSession.guestOwnerDid !== value.ownerDid
      || target.appSession.targetOwnerDid !== target.binding.subjectDid
      || target.appSession.audience === undefined) fail('invalid_device_metadata', 'The public character-claim lease is invalid.');
    originOf(target.appSession.audience);
    const existing = target.appSession.existingRecord;
    if (existing !== undefined && existing !== null && (!object(existing)
      || Object.keys(existing).some(key => !['kind', 'graphIri', 'descriptorUrl', 'cid', 'bindingCid', 'nativeRevision', 'recordCid', 'proofKind', 'digest'].includes(key))
      || Object.values(existing).some(item => typeof item !== 'string' || item.length > 2048))) {
      fail('invalid_device_metadata', 'Only the public saved-character reference belongs in a claim lease.');
    }
    if (target.confirmation !== undefined) {
      const confirmation = target.confirmation, reference = confirmation?.targetRecord;
      if (!object(confirmation) || Object.keys(confirmation).some(key => !['targetRecord', 'selection'].includes(key))
        || !['copy-guest', 'use-existing'].includes(confirmation.selection) || !object(reference) || reference.kind !== 'character'
        || Object.keys(reference).some(key => !['kind', 'graphIri', 'descriptorUrl', 'cid', 'bindingCid', 'nativeRevision', 'recordCid', 'proofKind', 'digest'].includes(key))
        || Object.values(reference).some(item => typeof item !== 'string' || !item || item.length > 2048)
        || reference.proofKind !== 'owner-key-authenticated-checkpoint'
        || !/^sha256:[a-f0-9]{64}$/.test(reference.nativeRevision || '')
        || !reference.graphIri || !reference.descriptorUrl || !reference.cid || !reference.recordCid || !reference.digest) {
        fail('invalid_device_metadata', 'The durable claim confirmation must contain only its exact public native receipt.');
      }
    }
  }
  return clone(value);
}

/** Only public metadata and signing operations leave this object. */
export function createProvisionalDevice({ origin = globalThis.location?.origin, crypto = globalThis.crypto,
  storage = indexedDbProvisionalStorage(), now = Date.now } = {}) {
  const gameOrigin = originOf(origin), scope = JSON.stringify([SCHEMA, gameOrigin]);
  if (!crypto?.subtle || !crypto.randomUUID || !storage?.load || !storage?.create || !storage?.replace) {
    throw new TypeError('Persistent browser cryptography is required for provisional play.');
  }
  let current = null, opening = null, closed = false;
  const active = () => { if (closed) fail('device_closed', 'The browser play connection is closed.'); };
  async function validate(record) {
    active();
    if (!object(record) || record.schema !== SCHEMA || record.origin !== gameOrigin || !record.revision
      || record.privateKey?.type !== 'private' || record.privateKey.extractable !== false
      || record.privateKey.algorithm?.name !== 'ECDSA' || record.privateKey.algorithm?.namedCurve !== 'P-256'
      || !record.privateKey.usages?.includes('sign')) fail('invalid_device_key', 'The original browser play key cannot be opened.');
    const publicKeyJwk = provisionalPublicKey(record.publicKeyJwk);
    const publicKey = await crypto.subtle.importKey('jwk', publicKeyJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const probe = encoder.encode('interego-provisional-device-check-v1\n' + gameOrigin);
    const signature = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, probe);
    if (!await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey, signature, probe)) {
      fail('invalid_device_key', 'The original browser play key does not match its public identity.');
    }
    const metadata = metadataOf(record.metadata);
    if (metadata && metadata.proofKeyThumbprint !== await provisionalKeyThumbprint(publicKeyJwk, crypto)) {
      fail('invalid_device_key', 'The saved play session belongs to another browser key.');
    }
    return { ...record, publicKeyJwk, metadata };
  }
  async function open() {
    active();
    if (current) return current;
    if (!opening) opening = (async () => {
      let found = await storage.load(scope);
      if (!found) {
        const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign', 'verify']);
        const publicKeyJwk = provisionalPublicKey(await crypto.subtle.exportKey('jwk', pair.publicKey));
        found = await storage.create(scope, { schema: SCHEMA, origin: gameOrigin, revision: crypto.randomUUID(),
          createdAt: now(), privateKey: pair.privateKey, publicKeyJwk, metadata: null });
      }
      current = await validate(found); active(); return current;
    })().finally(() => { opening = null; });
    return opening;
  }
  async function publicDescription() {
    const record = await open();
    return { publicKeyJwk: clone(record.publicKeyJwk), proofKeyThumbprint: await provisionalKeyThumbprint(record.publicKeyJwk, crypto) };
  }
  async function sign(text) {
    const record = await open(); active();
    const signed = new Uint8Array(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, record.privateKey, encoder.encode(text)));
    if (signed.byteLength !== 64) fail('invalid_proof', 'The browser produced an unsupported play proof.');
    return provisionalBase64Url(signed);
  }
  return Object.freeze({ publicDescription,
    async peekMetadata() {
      active();
      const found = await storage.load(scope);
      if (!found) return null;
      const checked = await validate(found); active();
      current = checked;
      return clone(checked.metadata);
    },
    async metadata() { return clone((await open()).metadata); },
    async remember(value) {
      const record = await open(), metadata = metadataOf(value);
      if (!metadata) fail('invalid_device_metadata', 'A provisional identity is required.');
      if (record.metadata && (record.metadata.ownerDid !== metadata.ownerDid || record.metadata.podUrl !== metadata.podUrl
        || record.metadata.issuer !== metadata.issuer || record.metadata.guestExpiresAt !== metadata.guestExpiresAt)) {
        fail('guest_identity_changed', 'Reconnect the original provisional character before starting another one.');
      }
      if (metadata.proofKeyThumbprint !== await provisionalKeyThumbprint(record.publicKeyJwk, crypto)) fail('invalid_device_key', 'The provisional identity did not bind this browser key.');
      current = await validate(await storage.replace(scope, record.revision,
        { ...record, revision: crypto.randomUUID(), metadata }));
      return clone(current.metadata);
    },
    async signBootstrap(playGrant) {
      if (!object(playGrant)) fail('invalid_proof', 'The native play grant is invalid.');
      const payload = bounded(playGrant._signed_payload, 65536, 'native grant payload');
      const signature = bounded(playGrant._signature, 2048, 'native grant signature');
      return sign('interego-play-provisional-v1\n' + payload + '\n' + signature);
    },
    async signProof({ attestation, audience, challenge } = {}) {
      bounded(attestation, 16384, 'provisional attestation'); bounded(challenge, 512, 'play challenge');
      if (originOf(audience) !== gameOrigin) fail('invalid_proof', 'The play proof is for another game origin.');
      return sign('interego-play-proof-v1\n' + attestation + '\n' + gameOrigin + '\n' + challenge);
    },
    close() { closed = true; current = null; void storage.close?.(); },
  });
}
