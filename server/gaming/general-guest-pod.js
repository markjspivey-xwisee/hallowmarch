/**
 * A general guest's character in the guest's OWN Interego pod (general-guest.js;
 * identity's PROVISIONAL-PLAY.md, "General guest" and "Tokens"; the storage
 * gate's deploy/css-gate/provisional-play.mjs).
 *
 * The browser seals the character with an X25519 key it made at the game's
 * origin and never sends anywhere. This module holds, in memory and for the
 * session only, the application token identity gave for the guest at the door,
 * and forwards the sealed envelope to the one document the gate lets that token
 * write:
 *
 *   <pod>/<namespace>/checkpoints/<sha256('urn:graph:<namespace>:player-profile:<sha256(ownerDid)>')>.json
 *
 * as a native commit (`application/vnd.interego.native-commit+json`), created
 * if absent or conditional on the exact revision. Nothing but an envelope of
 * the gate's own shape is forwarded: one wrapped key, its own sender, and no
 * member that is not ciphertext, a nonce, a public key or the algorithm's name.
 *
 * The gate gives a guest 1024 write attempts and 32 MiB for its whole life,
 * shared by every application. This game takes a fixed part of that, counted
 * before each attempt and kept with the game's account record, so a restart
 * cannot reset it; and it spaces its writes so the part lasts.
 *
 * It reads no environment and logs no content.
 */
import { createHash } from 'node:crypto';

export const GUEST_POD_COMMIT_TYPE = 'application/vnd.interego.native-commit+json';
export const GUEST_POD_LIMITS = Object.freeze({
  /** This game's part of the guest's lifetime budget (the gate's: 1024 attempts, 32 MiB, every application together). */
  writes: 192, bytes: 12 * 1024 * 1024,
  /** One envelope: far under the gate's 4 MiB a write. */
  envelopeBytes: 768 * 1024,
  /** No two writes of one guest nearer than this, whatever the page asks. */
  floorMs: 5 * 60_000,
  /** The page's own spacing, and the play time the byte part is spread over. */
  intervalMs: 10 * 60_000, spreadMs: 32 * 3_600_000,
});
// The native engine's ETag is strong (`"<revision>-<16 hex>"`); one decoded on the way (gzip) comes back weak.
// Either names its revision, which `Interego-Revision` states again and `Interego-Body-Digest` binds to the bytes.
const REVISION = /^(?:W\/)?"(sha256:[a-f0-9]{64})(?:-[a-f0-9]{16})?"$/;
const NATIVE = /^sha256:[a-f0-9]{64}$/;
const NAMESPACE = /^[a-z][a-z0-9-]{1,31}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const KEY = /^[A-Za-z0-9+/]{43}=$/;
const sha256 = value => createHash('sha256').update(value).digest('hex');
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const only = (value, keys) => plain(value) && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const b64 = (value, min, max) => typeof value === 'string' && value.length >= min && value.length <= max && B64.test(value);

/** The spacing a write of `bytes` asks for: ten minutes, longer for a large envelope so the byte part lasts `spreadMs` of play. */
export function guestPodInterval(bytes, limits = GUEST_POD_LIMITS) {
  return Math.max(limits.intervalMs, Math.ceil(limits.spreadMs * Math.max(0, bytes) / limits.bytes));
}

/** The one document of a guest's pod this game writes, as the gate derives it (kind `player-profile`). */
export function guestCheckpointUrl({ podUrl, userId, ownerDid, namespace = 'hallowmarch', podOrigin }) {
  let url;
  try { url = new URL(podUrl); } catch { return null; }
  if (typeof userId !== 'string' || !/^u-try-guest-[0-9a-f]{32}$/.test(userId) || typeof ownerDid !== 'string' || !ownerDid.endsWith(':users:' + userId)
    || typeof namespace !== 'string' || !NAMESPACE.test(namespace)
    || url.protocol !== 'https:' || url.origin !== podOrigin || url.username || url.password || url.search || url.hash
    || url.pathname !== `/${userId}/`) return null;
  return `${url.origin}/${userId}/${namespace}/checkpoints/${sha256(`urn:graph:${namespace}:player-profile:${sha256(ownerDid)}`)}.json`;
}

/**
 * The envelope the browser sealed, held to the gate's shape and to ciphertext
 * alone. Returns its exact bytes to forward, or null.
 */
export function sealedGuestEnvelope(envelope, limits = GUEST_POD_LIMITS) {
  const e = envelope, c = e?.content, w = Array.isArray(e?.wrappedKeys) && e.wrappedKeys.length === 1 ? e.wrappedKeys[0] : null;
  if (!only(e, ['version', 'algorithm', 'content', 'wrappedKeys']) || e.version !== 1 || e.algorithm !== 'X25519-XSalsa20-Poly1305'
    || !only(c, ['ciphertext', 'nonce', 'algorithm', 'encryptedAt']) || c.algorithm !== 'XSalsa20-Poly1305'
    || !b64(c.ciphertext, 24, limits.envelopeBytes) || !b64(c.nonce, 32, 32)
    || typeof c.encryptedAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(c.encryptedAt)
    || !only(w, ['recipientPublicKey', 'senderPublicKey', 'nonce', 'wrappedKey'])
    || !KEY.test(w.recipientPublicKey) || w.senderPublicKey !== w.recipientPublicKey || !b64(w.nonce, 32, 32) || !b64(w.wrappedKey, 64, 64)) return null;
  const bytes = Buffer.from(JSON.stringify({ version: 1, algorithm: e.algorithm,
    content: { ciphertext: c.ciphertext, nonce: c.nonce, algorithm: c.algorithm, encryptedAt: c.encryptedAt },
    wrappedKeys: [{ recipientPublicKey: w.recipientPublicKey, wrappedKey: w.wrappedKey, nonce: w.nonce, senderPublicKey: w.senderPublicKey }] }));
  return bytes.length <= limits.envelopeBytes ? bytes : null;
}

/**
 * The pod side of every live guest session. `usage(id)` answers the account's
 * kept `{ writes, bytes, lastAt, full }` (or nothing), `keep(id, usage)` keeps
 * it. Tokens live in this object alone and go with `forget`, the session's
 * bound, or the process.
 */
export function createGuestPodStore({ fetch: transport = globalThis.fetch, now = Date.now, podOrigin, usage, keep,
  limits = GUEST_POD_LIMITS, timeoutMs = 15_000, maxGuests = 4096 } = {}) {
  let origin;
  try { origin = new URL(podOrigin); } catch { /* refused below */ }
  if (!origin || origin.protocol !== 'https:' || origin.origin !== podOrigin || typeof transport !== 'function' || typeof now !== 'function'
    || typeof usage !== 'function' || typeof keep !== 'function') throw new TypeError('The guest pod needs its HTTPS origin, a transport and the accounts\' usage.');
  const guests = new Map();
  // One write of a guest at a time, whatever session holds its token: a new arrival replaces the session's
  // record, so a flag kept on that record would let a second write past the count and the spacing.
  const writing = new Set();
  const counts = { admitted: 0, written: 0, refused: 0, failed: 0, read: 0, readFailed: 0, bytes: 0, reasons: {} };
  const note = (kind, reason) => { counts[kind]++; counts.reasons[reason] = (counts.reasons[reason] ?? 0) + 1; return { ok: false, code: reason }; };
  const used = id => { const u = usage(id); return { writes: Number.isSafeInteger(u?.writes) && u.writes >= 0 ? u.writes : 0,
    bytes: Number.isSafeInteger(u?.bytes) && u.bytes >= 0 ? u.bytes : 0, lastAt: Number.isSafeInteger(u?.lastAt) ? u.lastAt : 0, full: u?.full === true }; };
  const prune = () => { const time = now(); for (const [id, g] of guests) if (g.expiresAt <= time) guests.delete(id); };
  const live = id => { const g = guests.get(id); if (g && g.expiresAt <= now()) { guests.delete(id); return null; } return g ?? null; };
  const call = (url, init) => transport(url, { redirect: 'error', cache: 'no-store', credentials: 'omit', signal: AbortSignal.timeout(timeoutMs), ...init });

  /** The document as it stands: its revision and its bytes. Reads need no bearer and get none. */
  async function current(g) {
    const response = await call(g.url, { method: 'GET', headers: { Accept: 'application/json' } });
    if (response.status === 404 || response.status === 410) return { revision: null, text: null };
    const bytes = Buffer.from(await response.arrayBuffer());
    const tagged = REVISION.exec(response.headers.get('etag') ?? '')?.[1], stated = response.headers.get('interego-revision');
    const digest = response.headers.get('interego-body-digest');
    const revision = tagged ?? (NATIVE.test(stated ?? '') ? stated : undefined);
    if (!response.ok || !revision || (stated !== null && stated !== revision) || bytes.length > 4 * 1024 * 1024
      || (digest !== null && digest !== 'sha256:' + sha256(bytes))) throw new Error('unreadable');
    return { revision, text: bytes.toString('utf8') };
  }

  return Object.freeze({
    limits,
    /** Take the guest's application token for this session. False where the answer names no document this game may write. */
    admit(id, { token, tokenExpiresAt, podUrl, userId, ownerDid, namespace, sessionExpiresAt } = {}) {
      const url = guestCheckpointUrl({ podUrl, userId, ownerDid, namespace, podOrigin: origin.origin });
      const until = Math.min(Date.parse(String(tokenExpiresAt ?? '')), Number(sessionExpiresAt));
      if (typeof id !== 'string' || !url || typeof token !== 'string' || !/^[\x21-\x7e]{16,8192}$/.test(token) || !Number.isFinite(until) || until <= now()) {
        note('refused', 'not_admitted'); return false;
      }
      prune();
      while (guests.size >= maxGuests) guests.delete(guests.keys().next().value);
      const before = guests.get(id);
      guests.set(id, { token, url, expiresAt: until, revision: before?.url === url ? before.revision : undefined, busy: false });
      counts.admitted++;
      return true;
    },
    has(id) { return !!live(id); },
    forget(id) { guests.delete(id); },
    /** What the page may plan by: this game's part that is left, and when the next write may come. */
    budget(id) {
      const u = used(id);
      return { writesLeft: u.full ? 0 : Math.max(0, limits.writes - u.writes), bytesLeft: u.full ? 0 : Math.max(0, limits.bytes - u.bytes),
        nextAt: u.lastAt + limits.floorMs, intervalMs: limits.intervalMs, spreadMs: limits.spreadMs, bytes: limits.bytes };
    },
    /** Forward one sealed envelope. Every attempt that leaves here is counted first, whatever the pod then answers. */
    async put(id, envelope) {
      const g = live(id);
      if (!g) return note('refused', 'reauth');
      const body = sealedGuestEnvelope(envelope, limits);
      if (!body) return note('refused', 'not_sealed');
      if (g.busy || writing.has(id)) return note('refused', 'busy');
      const u = used(id), time = now();
      if (u.full || u.writes + 1 > limits.writes || u.bytes + body.length > limits.bytes) return note('refused', 'budget');
      if (time < u.lastAt + limits.floorMs) return note('refused', 'too_soon');
      g.busy = true; writing.add(id);
      try {
        if (g.revision === undefined) {
          try { g.revision = (await current(g)).revision; } catch { return note('failed', 'pod_unreadable'); }
        }
        const expected = g.revision;
        keep(id, { writes: u.writes + 1, bytes: u.bytes + body.length, lastAt: time, full: false });
        let response;
        try {
          response = await call(g.url, { method: 'PUT',
            headers: { Authorization: 'Bearer ' + g.token, 'Content-Type': GUEST_POD_COMMIT_TYPE, Accept: 'application/json',
              ...(expected ? { 'If-Match': `"${expected}"` } : { 'If-None-Match': '*' }) },
            body: JSON.stringify({ version: 1, expectedRevision: expected, contentType: 'application/json', bodyBase64: body.toString('base64') }) });
          await response.arrayBuffer().catch(() => null);
        } catch { g.revision = undefined; return note('failed', 'pod_unreachable'); }
        if (response.ok) {
          const revision = REVISION.exec(response.headers.get('etag') ?? '')?.[1];
          g.revision = revision && revision !== expected ? revision : undefined;
          counts.written++; counts.bytes += body.length;
          return { ok: true, bytes: body.length };
        }
        g.revision = undefined;
        if (response.status === 507) { keep(id, { ...used(id), full: true }); return note('failed', 'pod_full'); }
        if (response.status === 401 || response.status === 403) { guests.delete(id); return note('failed', 'reauth'); }
        return note('failed', response.status === 409 || response.status === 412 ? 'pod_conflict' : response.status === 429 ? 'pod_busy' : 'pod_refused');
      } finally { g.busy = false; writing.delete(id); }
    },
    /** The sealed envelope kept in the pod, as text, or null where there is none. */
    async get(id) {
      const g = live(id);
      if (!g) return note('refused', 'reauth');
      try {
        const found = await current(g);
        g.revision = found.revision;
        let envelope = null;
        if (found.text !== null) { try { envelope = JSON.parse(found.text); } catch { envelope = null; } }
        counts.read++;
        // Whatever the document holds, only an envelope of the gate's shape goes on to the page.
        // `present`: a document stands there even where it is not such an envelope, so the page never takes it for
        // an empty pod and writes over it unasked.
        return { ok: true, present: found.text !== null,
          env: envelope && sealedGuestEnvelope(envelope, { ...limits, envelopeBytes: 4 * 1024 * 1024 }) ? envelope : null };
      } catch { counts.readFailed++; return { ok: false, code: 'pod_unreadable' }; }
    },
    status() { prune(); return { guests: guests.size, ...counts, reasons: { ...counts.reasons } }; },
    close() { guests.clear(); },
  });
}

/**
 * The guest pod as a deployment configures it. Null unless one of
 *
 *   HM_GENERAL_GUEST_POD_SHADOW=1         the server's save stays the character;
 *                                         each save is also sealed by the browser
 *                                         and forwarded to the guest's pod;
 *   HM_GENERAL_GUEST_POD_AUTHORITATIVE=1  the pod's sealed copy is the character
 *                                         of an unlinked guest, and the server
 *                                         keeps no save for it
 *
 * is exactly `1` (the second wins where both are). Either needs the general
 * guest itself (HM_GENERAL_GUEST=1) and
 *
 *   HM_GENERAL_GUEST_POD_ORIGIN           the HTTPS origin the guests' pods are
 *                                         served from: the only place a guest's
 *                                         token is ever sent,
 *
 * or this throws and the server does not start.
 */
export function configuredGuestPod({ env = {}, fetch: transport = globalThis.fetch, now = Date.now, usage, keep } = {}) {
  const mode = env.HM_GENERAL_GUEST_POD_AUTHORITATIVE === '1' ? 'authoritative' : env.HM_GENERAL_GUEST_POD_SHADOW === '1' ? 'shadow' : null;
  if (!mode) return null;
  const missing = message => { throw new Error('The general guest\'s pod (HM_GENERAL_GUEST_POD_' + mode.toUpperCase() + '=1): ' + message); };
  if (env.HM_GENERAL_GUEST !== '1') missing('HM_GENERAL_GUEST is not 1, so there is no general guest to keep a character for.');
  if (!env.HM_GENERAL_GUEST_POD_ORIGIN) missing('HM_GENERAL_GUEST_POD_ORIGIN is not set (the HTTPS origin of the guests\' pods).');
  let store;
  try { store = createGuestPodStore({ fetch: transport, now, podOrigin: env.HM_GENERAL_GUEST_POD_ORIGIN, usage, keep }); }
  catch { missing('HM_GENERAL_GUEST_POD_ORIGIN must be an HTTPS origin with no path.'); }
  return Object.freeze({ mode, store });
}
