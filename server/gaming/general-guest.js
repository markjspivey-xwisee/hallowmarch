/**
 * Interego's general guest as an additional way into a server-hosted game
 * (github.com/markjspivey-xwisee/hallowmarch issue 105; identity's
 * PROVISIONAL-PLAY.md, "General guest", "A dedicated door origin" and
 * "Linking a guest to an account").
 *
 * A general guest is one guest per browser across every application: its key
 * lives on identity's guest door, never in this origin. The game learns of it
 * by an authorization-code round trip with PKCE, started by a grant the game's
 * own service agent signs:
 *
 *   start   a state and a PKCE verifier kept here, the relay-signed grant
 *           checked to carry the five values asked for, the browser bound by
 *           an HttpOnly SameSite=Lax cookie and sent to the door (top level,
 *           the grant in the fragment);
 *   return  the cookie binding and the state checked, the code exchanged with
 *           identity from this server, every field of the answer checked;
 *   who     the registered account identity states the guest is linked to,
 *           else the guest itself;
 *   bound   never past the guest's own deadline, and about ten minutes for a
 *           linked guest, after which the browser goes back through the door,
 *           where the link is read again.
 *
 * No code and no bearer is left in an address the browser stays on, and
 * identity's token for the guest is dropped with the exchange answer.
 *
 * This module is a plain-JavaScript port of Interego's
 * applications/_shared/guest-access/door.ts and session.ts. It reads no
 * environment and names no deployment.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const GENERAL_GUEST_PURPOSE = 'interego-general-guest-v1';
/** How long a session made for a linked guest lasts before the link is read again at the door. */
export const LINKED_GUEST_SESSION_MS = 10 * 60 * 1000;
export const GENERAL_GUEST_COOKIE = '__Host-hallowmarch-guest-door';
const VISIT_MS = 10 * 60 * 1000;
const GRANT_SECONDS = 90;
const ARRIVAL_MS = 60_000;
const MAX_ANSWER_BYTES = 65_536;

export class GeneralGuestError extends Error {
  constructor(status, code) { super(code); this.name = 'GeneralGuestError'; this.status = status; this.code = code; }
}
const refuse = (status, code) => { throw new GeneralGuestError(status, code); };
const digest = value => createHash('sha256').update(value).digest('base64url');
const text = (value, max) => typeof value === 'string' && value.length > 0 && value.length <= max;
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const same = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };
const STATE = /^[A-Za-z0-9_-]{20,128}$/;
const BINDING = /^[A-Za-z0-9_-]{43}$/;

/** An HTTPS origin with no path, as identity's PROVISIONAL_PLAY_CLIENTS names an application. */
export function httpsOrigin(value, name) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`${name} is not a URL`); }
  if (url.protocol !== 'https:' || url.origin !== value || url.username || url.password) throw new TypeError(`${name} must be an HTTPS origin with no path`);
  return url.origin;
}
/** One path on the game's own origin, of the shape identity accepts as a `generalGuestReturnPath`. */
export function generalGuestPath(value, name = 'The path') {
  if (typeof value !== 'string' || !/^\/[A-Za-z0-9._~/-]{0,127}$/.test(value) || value.includes('//') || value.includes('..')) {
    throw new TypeError(`${name} must be one plain path on this origin`);
  }
  return value;
}

const ORIGIN = /^https?:\/\/[A-Za-z0-9.-]+(?::[0-9]{1,5})?$/;
const isOrigin = value => typeof value === 'string' && value.length <= 256 && ORIGIN.test(value);
const isSeconds = value => Number.isSafeInteger(value) && value > 0;
const isIri = value => typeof value === 'string' && value.length > 0 && value.length <= 2048 && !/\s/.test(value);
const isName = value => typeof value === 'string' && /^[A-Za-z0-9._:-]{1,64}$/.test(value);
const distinct = (list, ok, max) => Array.isArray(list) && list.length <= max && list.every(ok) && new Set(list).size === list.length;
const FACTS = ['subject', 'provisional', 'claimed', 'establishedAt', 'standingUntil', 'admittedBy', 'linkedTo', 'roles', 'onBehalfOf',
  'acceptedTermsVersion', 'proofKeyThumbprint'];

/**
 * What identity stated about a subject, validated whole (the port of
 * `@interego/abac/portable`'s `subjectAttributeGraph`): nothing is read from
 * part of an answer, and an unknown member is refused instead of ignored.
 * Returns the facts, or null.
 */
export function subjectFacts(facts) {
  const f = facts;
  if (!plain(f) || Object.keys(f).some(key => !FACTS.includes(key))
    || !isIri(f.subject) || typeof f.provisional !== 'boolean'
    || (f.claimed !== undefined && typeof f.claimed !== 'boolean')
    || (f.establishedAt !== undefined && !isSeconds(f.establishedAt))
    || (f.standingUntil !== undefined && !isSeconds(f.standingUntil))
    || (f.establishedAt !== undefined && f.standingUntil !== undefined && f.standingUntil <= f.establishedAt)
    || (f.admittedBy !== undefined && !distinct(f.admittedBy, isOrigin, 64))
    || (f.linkedTo !== undefined && (!isIri(f.linkedTo) || f.linkedTo === f.subject))
    || (f.roles !== undefined && !distinct(f.roles, isName, 32))
    || (f.onBehalfOf !== undefined && !isIri(f.onBehalfOf))
    || (f.acceptedTermsVersion !== undefined && !isName(f.acceptedTermsVersion))
    || (f.proofKeyThumbprint !== undefined && (typeof f.proofKeyThumbprint !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(f.proofKeyThumbprint)))) return null;
  return f;
}
/**
 * The standard decision for a provisional subject, default-deny: a provisional
 * subject this application admitted, whose standing has at least a second
 * left, may use the service. Anything missing or malformed is a refusal.
 */
export function provisionalMayUse(facts, audience, nowMs) {
  const f = subjectFacts(facts);
  if (!f || !Number.isFinite(nowMs)) return false;
  return f.provisional === true && Array.isArray(f.admittedBy) && f.admittedBy.includes(audience)
    && isSeconds(f.standingUntil) && f.standingUntil - Math.floor(nowMs / 1000) >= 1;
}

/**
 * The game's side of the door. `signGrant` has the game's service agent sign
 * (the relay's sign_request); `audience` is this deployment's origin as
 * identity names it; `doorOrigin` is where identity serves the door page.
 */
export function createGeneralGuestDoor({ identityOrigin, doorOrigin, audience, signGrant, fetch: transport = globalThis.fetch,
  now = Date.now, maxVisits = 1024, timeoutMs = 15_000 } = {}) {
  const issuer = httpsOrigin(identityOrigin, 'The identity origin'), door = httpsOrigin(doorOrigin ?? identityOrigin, 'The door origin');
  const application = httpsOrigin(audience, 'The application audience');
  if (typeof signGrant !== 'function' || typeof transport !== 'function' || typeof now !== 'function'
    || !Number.isSafeInteger(maxVisits) || maxVisits < 1 || maxVisits > 4096
    || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000) throw new TypeError('Bounded general guest door ports required.');
  const visits = new Map(); let starting = 0, closed = false;
  const prune = () => { const time = now(); for (const [state, visit] of visits) if (visit.expiresAt <= time) visits.delete(state); };

  /**
   * Prepare one visit. `url` is where to send the browser (top level),
   * `binding` what to keep in an HttpOnly cookie until it returns.
   */
  async function start() {
    if (closed) refuse(503, 'guest_door_unavailable');
    prune();
    if (visits.size + starting >= maxVisits) refuse(429, 'guest_door_busy');
    const state = randomBytes(32).toString('base64url'), verifier = randomBytes(32).toString('base64url');
    const binding = randomBytes(32).toString('base64url'), time = now();
    const request = { purpose: GENERAL_GUEST_PURPOSE, audience: application, state, codeChallenge: digest(verifier),
      expiresAt: Math.floor(time / 1000) + GRANT_SECONDS };
    let grant;
    // The place is taken before the signer is awaited, so overlapping starts cannot together pass the ceiling.
    starting += 1;
    try { grant = await signGrant({ ...request }); } catch { refuse(503, 'guest_door_unavailable'); }
    finally { starting -= 1; }
    // What the relay signed is what was asked for, or nothing leaves here.
    let signed = null;
    try { signed = JSON.parse(grant._signed_payload); } catch { /* refused below */ }
    if (closed || !plain(grant) || !text(grant._signed_payload, 8192) || typeof grant._signature !== 'string'
      || !/^0x[0-9a-fA-F]{130}$/.test(grant._signature) || !plain(signed)
      || Object.keys(request).some(key => signed[key] !== request[key])) refuse(503, 'guest_door_unavailable');
    visits.set(state, { verifier, binding, expiresAt: time + VISIT_MS });
    const fragment = Buffer.from(JSON.stringify({ _signed_payload: grant._signed_payload, _signature: grant._signature })).toString('base64url');
    return { url: `${door}/guest/door#grant=${fragment}`, state, binding };
  }

  /**
   * Finish the visit the browser returned from. A return presented with the
   * visit's own binding spends the visit, whatever identity then answers; one
   * presented without it, or with another's, is refused and spends nothing.
   * Identity's token for the guest is not part of what this returns.
   */
  async function finish({ code, state, binding } = {}) {
    if (closed || !text(state, 128) || !STATE.test(state) || !text(code, 2048) || !/^[\x21-\x7e]+$/.test(code)
      || !text(binding, 256)) refuse(401, 'guest_door_return_invalid');
    const visit = visits.get(state);
    if (!visit || visit.expiresAt <= now() || !same(visit.binding, binding)) refuse(401, 'guest_door_return_invalid');
    visits.delete(state);
    let response, body = {};
    try {
      response = await transport(`${issuer}/guest/exchange`, { method: 'POST', redirect: 'error', cache: 'no-store', credentials: 'omit',
        signal: AbortSignal.timeout(timeoutMs), headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ code, codeVerifier: visit.verifier, audience: application, state }) });
      const raw = await response.text();
      if (Buffer.byteLength(raw) <= MAX_ANSWER_BYTES) { try { const parsed = JSON.parse(raw); if (plain(parsed)) body = parsed; } catch { /* refused below */ } }
    } catch { refuse(503, 'guest_door_unavailable'); }
    if (response.status >= 500) refuse(503, 'guest_door_unavailable');
    const facts = subjectFacts(body.subjectAttributes), expires = Date.parse(String(body.guestExpiresAt ?? ''));
    if (!response.ok || body.valid !== true || body.provisional !== true || body.general !== true
      || body.issuer !== issuer || body.audience !== application
      || !text(body.userId, 64) || !/^u-try-guest-[0-9a-f]{32}$/.test(body.userId)
      || !text(body.ownerDid, 2048) || !body.ownerDid.endsWith(`:users:${body.userId}`)
      || !Number.isFinite(expires) || expires <= now()
      || !facts || facts.subject !== body.ownerDid || Number(facts.standingUntil) * 1000 !== expires) refuse(401, 'guest_door_exchange_refused');
    // The application's own decision over what identity stated, default-deny.
    if (!provisionalMayUse(facts, application, now())) refuse(403, 'guest_access_denied');
    return { userId: body.userId, ownerDid: body.ownerDid, guestExpiresAt: expires, attributes: structuredClone(facts) };
  }
  return Object.freeze({ identityOrigin: issuer, doorOrigin: door, audience: application, start, finish,
    /** A browser starting again gives up the visit it had: one browser holds one place. */
    abandon(binding) { if (text(binding, 256)) for (const [state, visit] of visits) if (same(visit.binding, binding)) visits.delete(state); },
    close() { closed = true; visits.clear(); },
    status() { prune(); return { enabled: !closed, visits: visits.size }; } });
}

/**
 * The standing of a session made now for `guest`: whom it acts as and the
 * latest moment it may be honoured. `maxSessionMs` is the game's own ceiling.
 * The game cannot re-check the guest with identity afterwards, so the bound is
 * set here, from what was stated at the exchange.
 */
export function guestSessionStanding(guest, now, maxSessionMs) {
  if (!Number.isFinite(now) || !Number.isFinite(maxSessionMs) || maxSessionMs <= 0) throw new TypeError('A guest session needs a clock and a positive ceiling');
  const facts = subjectFacts(guest?.attributes);
  if (!facts || facts.subject !== guest.ownerDid || !Number.isFinite(guest.guestExpiresAt)) refuse(401, 'guest_door_exchange_refused');
  const linked = typeof facts.linkedTo === 'string', subject = linked ? facts.linkedTo : facts.subject;
  if (!subject || (linked && subject === guest.ownerDid)) refuse(401, 'guest_door_exchange_refused');
  const expiresAt = Math.min(guest.guestExpiresAt, now + maxSessionMs, linked ? now + LINKED_GUEST_SESSION_MS : Infinity);
  if (!Number.isFinite(expiresAt) || expiresAt <= now) refuse(401, 'guest_door_exchange_refused');
  return { subject, linked, guestDid: guest.ownerDid, expiresAt };
}

function cookieOf(req, name) {
  const header = req.headers.cookie;
  if (typeof header !== 'string' || header.length > 8192) return null;
  for (const part of header.split(';')) {
    const at = part.indexOf('=');
    if (at > 0 && part.slice(0, at).trim() === name) return part.slice(at + 1).trim();
  }
  return null;
}
const setCookie = (value, maxAgeSeconds) => `${GENERAL_GUEST_COOKIE}=${value}; Path=/; Max-Age=${maxAgeSeconds}; HttpOnly; Secure; SameSite=Lax`;

/**
 * The three routes of the general guest on the game's own origin:
 *
 *   GET  startPath    binds the browser and sends it to the door;
 *   GET  returnPath   the one registered return path: exchange, decide, bound,
 *                     then a redirect that carries only a flag;
 *   POST sessionPath  the page collects its game session once, by its cookie.
 *
 * `issueSession(standing)` makes the game's own session for the subject and
 * answers what the page is to be given; the door's answer never reaches it
 * beyond who and until when.
 */
export function createGeneralGuestHost({ door, publicOrigin, startPath = '/guest/general/start', returnPath = '/guest/general/return',
  sessionPath = '/guest/general/session', landingPath = '/', issueSession, maxSessionMs = 4 * 3_600_000, now = Date.now,
  maxArrivals = 256, startsPerMinute = 30 } = {}) {
  const origin = httpsOrigin(publicOrigin, 'The public origin'), host = new URL(origin).host;
  const paths = Object.freeze({ start: generalGuestPath(startPath, 'The start path'), return: generalGuestPath(returnPath, 'The return path'),
    session: generalGuestPath(sessionPath, 'The session path') });
  generalGuestPath(landingPath, 'The landing path');
  if (new Set(Object.values(paths)).size !== 3 || !door || door.audience !== origin || typeof issueSession !== 'function'
    || typeof now !== 'function' || !Number.isSafeInteger(maxSessionMs) || maxSessionMs < 60_000 || maxSessionMs > 86_400_000
    || !Number.isSafeInteger(maxArrivals) || maxArrivals < 1 || maxArrivals > 4096
    || !Number.isSafeInteger(startsPerMinute) || startsPerMinute < 1) throw new TypeError('The general guest door must name this game as its audience, with bounded ports.');
  const arrivals = new Map(), starts = []; let closed = false;
  const counts = { started: 0, returned: 0, refused: 0, collected: 0 };
  const headers = extra => ({ 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff', ...extra });
  const json = (res, status, value, extra = {}) => { res.writeHead(status, headers({ 'Content-Type': 'application/json; charset=utf-8', ...extra })); res.end(JSON.stringify(value)); };
  const redirect = (res, location, extra = {}) => { res.writeHead(302, headers({ Location: location, ...extra })); res.end(); };
  // The address the browser is left on carries a flag and nothing else.
  const landing = flag => `${origin}${landingPath}?interego-guest=${flag}`;
  const pruneArrivals = () => { const time = now(); for (const [key, value] of arrivals) if (value.expiresAt <= time) arrivals.delete(key); };

  async function start(req, res) {
    const time = now();
    while (starts.length && starts[0] <= time - 60_000) starts.shift();
    if (starts.length >= startsPerMinute) { counts.refused++; return redirect(res, landing('busy')); }
    starts.push(time);
    const abandoned = cookieOf(req, GENERAL_GUEST_COOKIE);
    if (abandoned && BINDING.test(abandoned)) { door.abandon(abandoned); arrivals.delete(digest(abandoned)); }
    let visit;
    try { visit = await door.start(); }
    catch (error) { counts.refused++; return redirect(res, landing(error instanceof GeneralGuestError && error.status === 429 ? 'busy' : 'unavailable')); }
    if (typeof visit?.url !== 'string' || !visit.url.startsWith(door.doorOrigin + '/guest/door#grant=') || !BINDING.test(visit.binding ?? '')) {
      counts.refused++; return redirect(res, landing('unavailable'));
    }
    counts.started++;
    redirect(res, visit.url, { 'Set-Cookie': setCookie(visit.binding, VISIT_MS / 1000) });
  }

  async function returned(req, res, url) {
    const binding = cookieOf(req, GENERAL_GUEST_COOKIE), keys = [...url.searchParams.keys()];
    const code = url.searchParams.get('code'), state = url.searchParams.get('state');
    // A return without this browser's cookie, or with anything but one code and one state, finishes nothing and spends nothing.
    if (!binding || !BINDING.test(binding) || keys.length !== 2 || !code || !state) { counts.refused++; return redirect(res, landing('refused')); }
    let guest;
    try { guest = await door.finish({ code, state, binding }); }
    catch (error) {
      counts.refused++;
      // The door refused the return itself (not this browser's visit): nothing was spent, so the cookie stays.
      if (error instanceof GeneralGuestError && error.code === 'guest_door_return_invalid') return redirect(res, landing('refused'));
      return redirect(res, landing(error instanceof GeneralGuestError && error.status === 503 ? 'unavailable' : 'refused'), { 'Set-Cookie': setCookie('', 0) });
    }
    let session;
    try {
      const standing = guestSessionStanding(guest, now(), maxSessionMs);
      session = await issueSession(Object.freeze({ ...standing, userId: guest.userId }));
      if (!plain(session) || !text(session.token, 8192) || !plain(session.acct) || !text(session.acct.id, 256)
        || !Number.isSafeInteger(session.expiresAt) || session.expiresAt > standing.expiresAt || session.expiresAt <= now()) refuse(503, 'guest_session_unavailable');
      session = { token: session.token, acct: { id: session.acct.id, name: String(session.acct.name ?? 'Guest').slice(0, 80), guest: true, generalGuest: true },
        expiresAt: session.expiresAt, linked: standing.linked };
    } catch (error) {
      counts.refused++;
      return redirect(res, landing(error instanceof GeneralGuestError && error.status === 401 ? 'refused' : 'unavailable'), { 'Set-Cookie': setCookie('', 0) });
    }
    pruneArrivals();
    while (arrivals.size >= maxArrivals) arrivals.delete(arrivals.keys().next().value);
    arrivals.set(digest(binding), { session, expiresAt: Math.min(now() + ARRIVAL_MS, session.expiresAt) });
    counts.returned++;
    redirect(res, landing('arrived'));
  }

  function collect(req, res) {
    const binding = cookieOf(req, GENERAL_GUEST_COOKIE), key = binding && BINDING.test(binding) ? digest(binding) : null;
    pruneArrivals();
    const arrival = key ? arrivals.get(key) : null;
    if (key) arrivals.delete(key);
    const clear = { 'Set-Cookie': setCookie('', 0) };
    if (!arrival || arrival.expiresAt <= now()) return json(res, 401, { error: 'no_general_guest_arrival' }, clear);
    counts.collected++;
    json(res, 200, arrival.session, clear);
  }

  return Object.freeze({ paths,
    manifest() { return { enabled: !closed, startPath: paths.start, returnPath: paths.return, sessionPath: paths.session, doorOrigin: door.doorOrigin }; },
    status() { pruneArrivals(); return { enabled: !closed, ...door.status(), arrivals: arrivals.size, ...counts }; },
    close() { closed = true; arrivals.clear(); door.close(); },
    /** Answers true where the request was one of the three routes. */
    async handle(req, res) {
      let url;
      try { url = new URL(req.url, origin); } catch { return false; }
      const route = Object.entries(paths).find(([, target]) => target === url.pathname)?.[0];
      if (!route) return false;
      try {
        if (closed) return json(res, 503, { error: 'general_guest_unavailable' }), true;
        if (req.headers.host !== host) return json(res, 403, { error: 'invalid_guest_origin' }), true;
        const method = route === 'session' ? 'POST' : 'GET';
        if (req.method !== method) return json(res, 405, { error: 'method_not_allowed' }, { Allow: method }), true;
        if (route === 'start') await start(req, res);
        else if (route === 'return') await returned(req, res, url);
        // Only this origin's own page may collect: a cross-site form post carries another Origin.
        else if (req.headers.origin !== origin) json(res, 403, { error: 'invalid_guest_origin' });
        else collect(req, res);
      } catch {
        if (!res.headersSent) json(res, 503, { error: 'general_guest_unavailable' }); else res.end();
      }
      return true;
    } });
}

/** The game account a general guest's subject plays as: one per subject DID, never a native owner's participation account. */
export function generalGuestAccountId(subjectDid) {
  if (typeof subjectDid !== 'string' || !subjectDid.startsWith('did:')) throw new TypeError('A subject DID is required.');
  return 'gg-' + createHash('sha256').update(subjectDid).digest('hex').slice(0, 40);
}

/**
 * The game's own rules for a general guest's account and socket, over the
 * game's account table. `claims` are a game session's as `game-session.js`
 * reads them; a client is `{ acct, authClaims }`.
 *
 *   accountFor    the account a live guest session enters: the one derived from
 *                 the subject it names, created on first arrival, and never an
 *                 account that has a password, a name or a native owner;
 *   principalFor  whom the socket plays as, until the session's bound;
 *   mayDelete     false for a session that acts as a linked account: that
 *                 browser holds a guest's key, not the account's.
 */
export function createGeneralGuestAccounts({ accounts, sessions, now = Date.now } = {}) {
  if (!plain(accounts) || typeof sessions?.issueGeneralGuest !== 'function' || typeof sessions.read !== 'function'
    || typeof now !== 'function') throw new TypeError('The game account table and its session tokens are required.');
  const live = claims => plain(claims) && claims.generalGuest === true && typeof claims.guestSubjectDid === 'string'
    && Number.isFinite(claims.exp) && claims.exp > now() && claims.id === generalGuestAccountId(claims.guestSubjectDid);
  function accountFor(claims) {
    if (!live(claims)) return null;
    if (!Object.hasOwn(accounts, claims.id)) accounts[claims.id] = { id: claims.id, name: 'Guest', guest: true, generalGuest: true, created: now(), last: now() };
    const account = accounts[claims.id];
    return account.id === claims.id && account.generalGuest === true && account.guest === true && !account.pass && !account.nativeBound ? account : null;
  }
  return Object.freeze({
    accountFor,
    /** The game's own session for `standing` (who, and until when): what the page collects. Nothing of identity's is in it. */
    issue(standing) {
      const session = sessions.issueGeneralGuest(generalGuestAccountId(standing.subject), { subjectDid: standing.subject,
        guestDid: standing.guestDid, linked: standing.linked, expiresAt: standing.expiresAt });
      const account = accountFor(sessions.read(session.token));
      if (!account) throw new Error('General guest account is unavailable.');
      return { token: session.token, acct: { id: account.id, name: account.name }, expiresAt: session.expiresAt };
    },
    principalFor(client) {
      const claims = client?.authClaims, account = client?.acct;
      return account?.generalGuest === true && live(claims) && claims.id === account.id ? claims.guestSubjectDid : null;
    },
    mayDelete(client) { return !(client?.authClaims?.generalGuest === true && client.authClaims.linked === true); },
  });
}

/**
 * The general guest as a deployment configures it. Off (null) unless
 * `HM_GENERAL_GUEST` is exactly `1`. On, every prerequisite must be present,
 * or this throws and the server does not start:
 *
 *   HM_GENERAL_GUEST_DOOR_ORIGIN  the door page's own HTTPS origin;
 *   publicOrigin                  this deployment's origin, explicitly configured
 *                                 (it is the grant's audience, as identity names it);
 *   signGrant                     the game's service agent, through the relay.
 *
 * `issueSession(standing)` receives only who the session acts as and until
 * when. Both the guest and a linked account must be owners of this identity.
 */
export function configuredGeneralGuest({ env = {}, publicOrigin, publicOriginConfigured = false, identityOrigin, signGrant, issueSession,
  fetch: transport = globalThis.fetch, now = Date.now } = {}) {
  if (env.HM_GENERAL_GUEST !== '1') return null;
  const missing = message => { throw new Error('HM_GENERAL_GUEST=1: ' + message); };
  if (!env.HM_GENERAL_GUEST_DOOR_ORIGIN) missing('HM_GENERAL_GUEST_DOOR_ORIGIN is not set (the guest door\'s HTTPS origin).');
  if (!publicOriginConfigured || !publicOrigin) missing('this deployment\'s public origin is not configured (HM_PUBLIC_ORIGIN or RAILWAY_PUBLIC_DOMAIN).');
  if (typeof signGrant !== 'function') missing('the game\'s service agent is unavailable, so no door grant can be signed.');
  if (typeof issueSession !== 'function') missing('no game session can be issued.');
  let door, issuer;
  try {
    issuer = httpsOrigin(identityOrigin, 'The identity origin');
    door = createGeneralGuestDoor({ identityOrigin: issuer, doorOrigin: env.HM_GENERAL_GUEST_DOOR_ORIGIN, audience: publicOrigin, signGrant, fetch: transport, now });
  } catch (error) { missing(error instanceof TypeError ? error.message + '.' : 'the door could not be configured.'); }
  const users = `did:web:${new URL(issuer).host.replace(/:/g, '%3A')}:users:`;
  return createGeneralGuestHost({ door, publicOrigin, now, issueSession: standing => {
    // The guest, and the account it is linked to, are owners of THIS identity and never the same one.
    const account = standing.subject.startsWith(users) ? standing.subject.slice(users.length) : '';
    if (standing.guestDid !== users + standing.userId || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(account)
      || (standing.linked ? account === standing.userId : standing.subject !== standing.guestDid)) refuse(401, 'guest_door_exchange_refused');
    return issueSession(standing);
  } });
}
