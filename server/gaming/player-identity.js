/**
 * Interego OAuth owner binding, independent of a game's account or save model.
 * The host verifies its existing game session in authorizeGameAccount and owns
 * duplicate-owner checks, session revocation and persistence in onVerified.
 * The host should honor context.signal if its binding operation is asynchronous.
 * Native credentials never enter the verified binding or either host callback.
 *
 * Default: a read-only native grant is used once and discarded. An explicitly
 * enabled owner-browser flow may claim a write grant once, within 30 seconds,
 * using the same browser ceremony cookie and a fresh matching game session.
 * This authorizes personal pod access; it conveys no learning-export consent.
 */
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const NATIVE_RELAY = 'https://relay.interego.xwisee.com';
const NATIVE_IDENTITY = 'https://identity.interego.xwisee.com';
const DEFAULT_STORES = ['https://gate.interego.xwisee.com/', 'http://css.railway.internal:3456/'];
const hash = value => createHash('sha256').update(value).digest('hex');
const random = () => randomBytes(32).toString('base64url');
const same = (a, b) => typeof a === 'string' && typeof b === 'string'
  && a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

class IdentityError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
const fail = (code, status) => { throw new IdentityError(code, status); };
const bounded = (value, fallback, min, max, name) => {
  const result = value ?? fallback;
  if (!Number.isInteger(result) || result < min || result > max) throw new TypeError(`Invalid ${name}`);
  return result;
};
function httpsUrl(value, name, { origin = false } = {}) {
  let url;
  try { url = new URL(value); } catch { throw new TypeError(`Invalid ${name}`); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash
    || (origin && (url.pathname !== '/' || url.search))) throw new TypeError(`${name} requires HTTPS`);
  return url;
}
function path(value, fallback) {
  const result = value ?? fallback;
  if (typeof result !== 'string' || !/^\/[A-Za-z0-9/_.,-]+$/.test(result) || result.includes('//')
    || result.split('/').some(segment => segment === '.' || segment === '..')) throw new TypeError('Invalid identity route path');
  return result;
}
function storeBase(value) {
  const url = new URL(value);
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.search || url.hash
    || !url.pathname.endsWith('/') || /%|\/\//.test(url.pathname)) throw new TypeError('Invalid trusted store base');
  return url;
}
function cookie(req, name) {
  const raw = req.headers.cookie;
  if (typeof raw !== 'string' || raw.length > 8192) return null;
  const values = raw.split(';').map(part => part.trim()).filter(part => part.startsWith(name + '='));
  if (values.length !== 1) return null;
  const value = values[0].slice(name.length + 1);
  return /^[A-Za-z0-9_-]{43}$/.test(value) ? value : null;
}
function setCookie(res, name, value, ttlMs) {
  const next = `${name}=${value}; Path=/; Secure; HttpOnly; SameSite=Lax; Max-Age=${Math.ceil(ttlMs / 1000)}`;
  const prior = res.getHeader('Set-Cookie');
  const others = (prior ? (Array.isArray(prior) ? prior : [prior]) : []).filter(item => !item.startsWith(name + '='));
  res.setHeader('Set-Cookie', others.length ? [...others, next] : next);
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
    Pragma: 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
  res.end(JSON.stringify(value));
}
function acceptsHtml(req) {
  if (typeof req.headers.accept !== 'string') return false;
  return req.headers.accept.split(',').some(item => {
    const [type, ...parameters] = item.toLowerCase().split(';').map(part => part.trim());
    if (type !== 'text/html') return false;
    const quality = parameters.filter(part => /^q\s*=/.test(part));
    if (!quality.length) return true;
    if (quality.length !== 1) return false;
    const match = /^q\s*=\s*(0(?:\.\d{0,3})?|1(?:\.0{0,3})?)$/.exec(quality[0]);
    return !!match && Number(match[1]) > 0;
  });
}
function browserFailure(res, status, code, browserCeremony) {
  const safeCode = ['native_owner_mismatch', 'identity_authorization_declined'].includes(code)
    ? code : 'identity_connection_failed';
  // Only fixed copy, allowlisted codes and a server-generated public correlation
  // nonce enter this page. OAuth values, owner data and internal errors do not.
  const evidence = /^[A-Za-z0-9_-]{43}$/.test(browserCeremony ?? '')
    ? `<meta name="hallowmarch-identity-ceremony" content="${browserCeremony}">` : '';
  const message = safeCode === 'native_owner_mismatch'
    ? 'This sign-in belongs to a different identity. Your character has not been switched. Return to the game and choose your original identity.'
    : safeCode === 'identity_authorization_declined'
      ? 'Identity sign-in was declined. Return to the game to try again.'
      : 'The identity connection could not be completed. Return to the game to try again.';
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store', Pragma: 'no-cache',
    'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" });
  res.end('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'
    + '<meta name="color-scheme" content="dark"><meta name="hallowmarch-identity-error" content="' + safeCode + '">' + evidence
    + '<title>Return to Hallowmarch</title><link rel="stylesheet" href="/gaming/identity/assets/finish.css"><main><h1>Identity connection incomplete</h1>'
    + '<p id="status" role="status">' + message + '</p><button id="return" type="button">Return to the game</button></main>'
    + '<script type="module" src="/gaming/identity/assets/finish.mjs"></script></html>');
}
async function bodyOf(req, supplied) {
  if (supplied !== undefined) {
    if (!supplied || typeof supplied !== 'object' || Array.isArray(supplied)
      || Buffer.byteLength(JSON.stringify(supplied)) > 8192) fail('invalid_request_body');
    return supplied;
  }
  if (!(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) fail('json_body_required', 415);
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) fail('request_body_too_large', 413);
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('invalid_request_body'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('invalid_request_body');
  return value;
}
async function responseText(response, maxBytes) {
  const length = Number(response.headers.get('content-length') ?? '0');
  if (length > maxBytes) fail('identity_response_too_large', 502);
  if (!response.body) return '';
  const reader = response.body.getReader(); const chunks = []; let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > maxBytes) { await reader.cancel(); fail('identity_response_too_large', 502); }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks).toString('utf8');
}
function parseJson(raw) {
  try { return JSON.parse(raw); } catch { fail('invalid_identity_response', 502); }
}
function parseMcp(raw) {
  let message;
  if (/(?:^|\n)(?:data:|event:)/.test(raw)) {
    for (const frame of raw.split(/\r?\n\r?\n/)) {
      const data = frame.split(/\r?\n/).filter(line => line.startsWith('data:')).map(line => line.slice(5).trim()).join('\n');
      if (!data) continue;
      const candidate = parseJson(data);
      if (candidate.id === 1) message = candidate;
    }
  } else message = parseJson(raw);
  if (!message || message.jsonrpc !== '2.0' || message.id !== 1 || message.error || !message.result
    || message.result.isError) fail('identity_status_refused', 502);
  const result = message.result;
  const value = result.structuredContent ?? parseJson(result.content?.find(part => part.type === 'text')?.text ?? '');
  if (!value || typeof value !== 'object' || value.error) fail('identity_status_refused', 502);
  return value;
}

/**
 * Required ports:
 *   authorizeGameAccount(req, body) -> { accountId, sessionId,
 *     expectedSubjectDid?: previously verified owner to require on reconnect,
 *     ownerPodWriteAccess?: true } or null. Prove the existing game session;
 *     never derive these fields from unverified account/identity labels.
 *   onVerified(binding, accountId, context) -> Promise<void | { appSession }>.
 *     Recheck sessionBinding and enforce owner/account uniqueness atomically.
 *     Honor context.signal for cancelable work; native credentials are absent.
 *     Optional bounded appSession is returned only through the same one-use
 *     browser/account-bound claim, including with a read-only native grant.
 *
 * handle(req, res, parsedBody?) consumes only paths it advertises. Mount before
 * other request-body consumers, or supply their already-parsed JSON body.
 * status() exposes counts only; close() removes pending ceremonies/handoffs.
 * Federated providers can supply metadataUrl, resourceMetadataUrl,
 * identityOrigin and trusted storeBases; callers cannot select endpoints.
 * bindingTimeoutMs independently bounds the host's native binding persistence
 * (100–30,000 ms). It defaults to requestTimeoutMs for existing compositions;
 * increasing it does not change provider request deadlines or handoff leases.
 */
export function createPlayerIdentityBridge(options = {}) {
  if (typeof options.authorizeGameAccount !== 'function' || typeof options.onVerified !== 'function') {
    throw new TypeError('Game account authorization and verified-binding callbacks are required');
  }
  const publicUrl = httpsUrl(options.publicOrigin, 'publicOrigin', { origin: true });
  const identityUrl = httpsUrl(options.identityOrigin ?? NATIVE_IDENTITY, 'identityOrigin', { origin: true });
  const metadataUrl = httpsUrl(options.metadataUrl ?? NATIVE_RELAY + '/.well-known/oauth-authorization-server', 'metadataUrl');
  const resourceUrl = httpsUrl(options.resourceMetadataUrl ?? metadataUrl.origin + '/.well-known/oauth-protected-resource', 'resourceMetadataUrl');
  if (resourceUrl.origin !== metadataUrl.origin) throw new TypeError('OAuth discovery must remain on its configured provider');
  const stores = (options.storeBases ?? DEFAULT_STORES).map(storeBase);
  if (!stores.length || stores[0].protocol !== 'https:') throw new TypeError('The first trusted store base must be public HTTPS');
  const paths = Object.freeze({ start: path(options.startPath, '/gaming/identity/start'),
    callback: path(options.callbackPath, '/gaming/identity/callback'),
    clientMetadata: path(options.clientMetadataPath, '/gaming/identity/client.json'),
    claim: path(options.claimPath, '/gaming/identity/claim') });
  if (new Set(Object.values(paths)).size !== 4) throw new TypeError('Identity route paths must be distinct');
  const callbackUrl = publicUrl.origin + paths.callback;
  const clientId = publicUrl.origin + paths.clientMetadata;
  const clientName = options.clientName ?? 'gaming-client';
  if (typeof clientName !== 'string' || !/^[A-Za-z][A-Za-z0-9 -]{1,31}$/.test(clientName)) throw new TypeError('Invalid clientName');
  const successPath = options.successPath ?? '/';
  if (typeof successPath !== 'string' || !successPath.startsWith('/') || successPath.startsWith('//')
    || /[\\\r\n]/.test(successPath) || new URL(successPath, publicUrl).origin !== publicUrl.origin) throw new TypeError('Invalid successPath');
  const cookieName = options.cookieName ?? '__Host-gaming-interego';
  if (!/^__Host-[A-Za-z0-9_-]{1,48}$/.test(cookieName)) throw new TypeError('Invalid ceremony cookie name');
  const ttlMs = bounded(options.ttlMs, 300_000, 30_000, 600_000, 'ttlMs');
  const handoffTtlMs = bounded(options.handoffTtlMs, 30_000, 1_000, 30_000, 'handoffTtlMs');
  const maxPending = bounded(options.maxPending, 256, 1, 4096, 'maxPending');
  const maxPerAccount = bounded(options.maxPerAccount, 2, 1, 16, 'maxPerAccount');
  const requestTimeoutMs = bounded(options.requestTimeoutMs, 15_000, 100, 30_000, 'requestTimeoutMs');
  const bindingTimeoutMs = bounded(options.bindingTimeoutMs, requestTimeoutMs, 100, 30_000, 'bindingTimeoutMs');
  const now = options.now ?? Date.now;
  const fetcher = options.fetch ?? globalThis.fetch;
  const pending = new Map(), handoffs = new Map(), active = new Set();
  const callbackFailures = { identity_service_timeout: 0, identity_binding_timeout: 0, identity_binding_rejected: 0 };
  let discovery, discoveryUntil = 0, discoveryFlight, closed = false;
  const release = (map, key) => { const record = map.get(key); if (record) clearTimeout(record.timer); map.delete(key); return record; };
  function prune() {
    for (const map of [pending, handoffs]) for (const [key, record] of map) if (record.expiresAt <= now()) release(map, key);
  }
  function retain(map, key, record, lifetime) {
    record.expiresAt = now() + lifetime;
    record.timer = setTimeout(() => release(map, key), lifetime);
    record.timer.unref?.(); map.set(key, record);
  }
  async function request(url, init = {}, maxBytes = 1_048_576) {
    const controller = new AbortController(); let timer;
    try {
      return await Promise.race([
        (async () => {
          const response = await fetcher(url, { ...init, redirect: 'error', credentials: 'omit', cache: 'no-store', signal: controller.signal });
          if (!response.ok) fail('identity_service_refused', response.status === 401 ? 401 : 502);
          return await responseText(response, maxBytes);
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => {
          controller.abort(); reject(new IdentityError('identity_service_timeout', 504));
        }, requestTimeoutMs); }),
      ]);
    } catch (error) {
      if (error instanceof IdentityError) throw error;
      fail('identity_service_unavailable', 502);
    } finally { clearTimeout(timer); controller.abort(); }
  }
  function providerEndpoint(value) {
    let url;
    try { url = httpsUrl(value, 'advertised OAuth endpoint'); } catch { fail('unsupported_identity_provider', 502); }
    if (url.origin !== metadataUrl.origin || url.search) fail('unsupported_identity_provider', 502);
    return url.href;
  }
  async function discover() {
    if (discovery && discoveryUntil > now()) return discovery;
    if (!discoveryFlight) discoveryFlight = (async () => {
      const [metadata, resource] = await Promise.all([
        request(metadataUrl.href, { headers: { Accept: 'application/json' } }, 65_536).then(parseJson),
        request(resourceUrl.href, { headers: { Accept: 'application/json' } }, 65_536).then(parseJson),
      ]);
      providerEndpoint(metadata.issuer);
      const issuer = metadata.issuer; // OAuth issuer comparison is exact, including its path/trailing slash.
      if (!metadata.client_id_metadata_document_supported || !metadata.response_types_supported?.includes('code')
        || !metadata.code_challenge_methods_supported?.includes('S256') || !metadata.scopes_supported?.includes('mcp:read')
        || !metadata.token_endpoint_auth_methods_supported?.includes('none')
        || !resource.authorization_servers?.some(value => value === issuer)) fail('unsupported_identity_provider', 502);
      const invokes = resource.affordances?.filter(item => item.action === 'urn:iep:action:mcp:invoke' && item.method === 'POST');
      if (invokes?.length !== 1) fail('missing_advertised_mcp_endpoint', 502);
      discovery = Object.freeze({ issuer, authorize: providerEndpoint(metadata.authorization_endpoint),
        token: providerEndpoint(metadata.token_endpoint), mcp: providerEndpoint(invokes[0].target),
        supportsWrite: metadata.scopes_supported.includes('mcp:write') });
      discoveryUntil = now() + 600_000;
      return discovery;
    })().finally(() => { discoveryFlight = undefined; });
    return discoveryFlight;
  }
  async function account(req, body) {
    let value;
    try { value = await options.authorizeGameAccount(req, body); } catch { fail('game_account_required', 401); }
    if (!value || typeof value.accountId !== 'string' || !value.accountId || value.accountId.length > 256
      || typeof value.sessionId !== 'string' || !value.sessionId || value.sessionId.length > 4096) fail('game_account_required', 401);
    if (value.expectedSubjectDid !== undefined && (typeof value.expectedSubjectDid !== 'string'
      || !/^did:[a-z0-9]+:[^\s<>"'\\]{1,1000}$/.test(value.expectedSubjectDid))) fail('game_account_required', 401);
    return { accountId: value.accountId, sessionHash: hash(value.sessionId),
      ...(value.expectedSubjectDid ? { expectedSubjectDid: value.expectedSubjectDid } : {}),
      write: options.allowOwnerBrowserHandoff === true && value.ownerPodWriteAccess === true };
  }
  function verifyOwner(status, provider) {
    const identity = status.identity, agent = status.sessionAgent;
    const userId = identity?.userId;
    if (typeof userId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/.test(userId)) fail('unverified_native_owner', 502);
    const didHost = identityUrl.host.replace(/:/g, '%3A');
    const subjectDid = `did:web:${didHost}:users:${userId}`;
    const webId = `${identityUrl.origin}/users/${userId}/profile#me`;
    const registryOwner = status.delegationRegistry?.owner ?? status.registry?.owner;
    if (identity.did !== subjectDid || identity.webId !== webId || registryOwner !== webId
      || (status.webId !== undefined && status.webId !== webId) || (status.userId !== undefined && status.userId !== userId)
      || (status.registry?.owner !== undefined && status.registry.owner !== webId)) fail('unverified_native_owner', 502);
    if (!agent || typeof agent.id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,255}$/.test(agent.id)
      || !agent.id.endsWith('-' + userId) || agent.did !== `did:web:${didHost}:agents:${agent.id}`
      || !['ReadWrite', 'ReadOnly', 'PublishOnly', 'DiscoverOnly'].includes(agent.scope)) fail('unverified_native_agent', 502);
    let pod;
    try { pod = new URL(status.pod); } catch { fail('unverified_native_pod', 502); }
    if (pod.username || pod.password || pod.search || pod.hash || !stores.some(base =>
      pod.origin === base.origin && pod.pathname === base.pathname + userId + '/')) fail('unverified_native_pod', 502);
    return Object.freeze({ subjectDid, webId, userId, podUrl: stores[0].href + userId + '/',
      authenticatedAgentDid: agent.did, authenticatedAgentId: agent.id, verifiedAt: new Date(now()).toISOString(),
      issuer: provider.issuer, verificationMethod: 'oauth-pkce+authenticated-mcp' });
  }
  async function start(req, res, body) {
    const owner = await account(req, body); const provider = await discover();
    if (closed) fail('identity_bridge_closed', 503);
    prune();
    const ceremonies = [...pending.values(), ...active, ...handoffs.values()];
    if (ceremonies.length >= maxPending || ceremonies.filter(item => item.accountId === owner.accountId).length >= maxPerAccount) {
      fail('identity_ceremony_limit', 429);
    }
    if (owner.write && !provider.supportsWrite) fail('owner_pod_access_unavailable', 502);
    const state = random(), ceremony = random(), verifier = random(), browserCeremony = random();
    retain(pending, hash(state), { ...owner, provider, verifier, browserCeremony, cookieHash: hash(ceremony), startedAt: now() }, ttlMs);
    const authorize = new URL(provider.authorize);
    const scope = owner.write ? 'mcp:write' : 'mcp:read';
    for (const [name, value] of Object.entries({ response_type: 'code', client_id: clientId, redirect_uri: callbackUrl,
      scope, state, code_challenge: hashBase64(verifier), code_challenge_method: 'S256' })) authorize.searchParams.set(name, value);
    setCookie(res, cookieName, ceremony, ttlMs);
    json(res, 200, { authorizationUrl: authorize.href, expiresAt: new Date(now() + ttlMs).toISOString(),
      ownerPodWriteAccess: owner.write, browserCeremony });
  }
  async function callback(req, res, url, evidence) {
    for (const key of ['state', 'code', 'error']) if (url.searchParams.getAll(key).length > 1) fail('invalid_identity_callback');
    const state = url.searchParams.get('state'), ceremony = cookie(req, cookieName);
    if (!state || !/^[A-Za-z0-9_-]{43}$/.test(state) || !ceremony) fail('invalid_identity_ceremony', 401);
    const key = hash(state), record = pending.get(key);
    if (!record || record.expiresAt <= now() || !same(record.cookieHash, hash(ceremony))) fail('invalid_identity_ceremony', 401);
    release(pending, key); // one use, before any asynchronous token exchange
    evidence.browserCeremony = record.browserCeremony;
    active.add(record);
    try {
      setCookie(res, cookieName, '', 0);
      const code = url.searchParams.get('code');
      if (url.searchParams.has('error')) fail('identity_authorization_declined', 403);
      if (!code || code.length > 4096) fail('invalid_identity_callback');
      const provider = record.provider;
      const token = parseJson(await request(provider.token, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, client_id: clientId, code_verifier: record.verifier,
          redirect_uri: callbackUrl }).toString() }, 65_536));
      const scopes = typeof token.scope === 'string' ? token.scope.split(/\s+/).filter(Boolean) : [];
      if (token.token_type !== 'Bearer' || typeof token.access_token !== 'string' || !token.access_token || token.access_token.length > 16_384
        || !Number.isFinite(token.expires_in) || token.expires_in <= 0 || token.expires_in > 86_400
        || (record.write ? !scopes.some(item => item === 'mcp' || item === 'mcp:write')
          : scopes.length !== 1 || scopes[0] !== 'mcp:read')
        || scopes.some(item => !['mcp', 'mcp:read', 'mcp:write'].includes(item))) fail('unexpected_native_grant', 502);
      if (record.write && token.refresh_token !== undefined && (typeof token.refresh_token !== 'string' || token.refresh_token.length > 16_384)) {
        fail('unexpected_native_grant', 502);
      }
      const tokenExpiresAt = now() + token.expires_in * 1000;
      const status = parseMcp(await request(provider.mcp, { method: 'POST', headers: { Authorization: 'Bearer ' + token.access_token,
        'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'get_pod_status', arguments: {} } }) }));
      const binding = verifyOwner(status, provider);
      // Supplied only by the host's authenticated ceremony port, never a body
      // label. Refuse a foreign OAuth owner before any host binding/session work.
      if (record.expectedSubjectDid && binding.subjectDid !== record.expectedSubjectDid) fail('native_owner_mismatch', 403);
      if (closed) fail('identity_bridge_closed', 503);
      let nativeSession;
      if (record.write) nativeSession = { accessToken: token.access_token, tokenType: 'Bearer', scope: scopes.join(' '),
        expiresAt: new Date(tokenExpiresAt).toISOString(), authorizationServer: provider.issuer,
        tokenEndpoint: provider.token, mcpUrl: provider.mcp };
      // Discard the default read grant before calling any host persistence code.
      delete token.access_token; delete token.refresh_token;
      const hostAbort = new AbortController(); let hostTimer, appSession;
      try {
        const hostResult = await Promise.race([
          Promise.resolve().then(() => options.onVerified(binding, record.accountId, Object.freeze({ sessionBinding: record.sessionHash,
            startedAt: new Date(record.startedAt).toISOString(), ownerPodWriteAccess: record.write, signal: hostAbort.signal }))),
          new Promise((_, reject) => { hostTimer = setTimeout(() => {
            hostAbort.abort(); reject(new IdentityError('identity_binding_timeout', 504));
          }, bindingTimeoutMs); }),
        ]);
        if (hostResult?.appSession !== undefined) {
          const encoded = JSON.stringify(hostResult.appSession);
          if (!hostResult.appSession || typeof hostResult.appSession !== 'object' || Array.isArray(hostResult.appSession)
            || typeof encoded !== 'string' || Buffer.byteLength(encoded) > 8192) fail('invalid_app_session', 502);
          appSession = JSON.parse(encoded);
        }
      } catch (error) {
        if (error instanceof IdentityError && error.code === 'identity_binding_timeout') throw error;
        fail('identity_binding_rejected', 409);
      } finally { clearTimeout(hostTimer); hostAbort.abort(); }
      if (closed) fail('identity_bridge_closed', 503);
      if (record.write || appSession) {
        prune();
        if (handoffs.size >= maxPending) fail('identity_ceremony_limit', 429);
        const lifetime = record.write ? Math.min(handoffTtlMs, tokenExpiresAt - now()) : handoffTtlMs;
        if (lifetime <= 0) fail('expired_native_grant', 502);
        retain(handoffs, record.cookieHash, { accountId: record.accountId, sessionHash: record.sessionHash, binding, nativeSession, appSession },
          lifetime);
        // Replace the clearing cookie; neither the bearer nor a claim secret goes in a URL.
        setCookie(res, cookieName, ceremony, lifetime);
      }
      res.writeHead(303, { Location: successPath, 'Cache-Control': 'no-store', Pragma: 'no-cache', 'Referrer-Policy': 'no-referrer' });
      res.end();
    } finally { active.delete(record); }
  }
  async function claim(req, res, body) {
    const owner = await account(req, body), ceremony = cookie(req, cookieName);
    if (!ceremony) fail('native_session_unavailable', 404);
    const key = hash(ceremony), record = handoffs.get(key);
    if (!record || record.expiresAt <= now()) fail('native_session_unavailable', 404);
    if ((record.nativeSession && !owner.write) || owner.accountId !== record.accountId || !same(owner.sessionHash, record.sessionHash)) fail('native_session_owner_mismatch', 403);
    release(handoffs, key); // consume before returning any native credential
    setCookie(res, cookieName, '', 0);
    json(res, 200, { binding: record.binding, ...(record.nativeSession ? { nativeSession: record.nativeSession } : {}),
      ...(record.appSession ? { appSession: record.appSession } : {}) });
  }
  function clientMetadata() {
    return { client_id: clientId, client_name: clientName, client_uri: publicUrl.origin,
      redirect_uris: [callbackUrl], response_types: ['code'],
      grant_types: ['authorization_code'],
      token_endpoint_auth_method: 'none' };
  }
  return Object.freeze({ paths, clientMetadata,
    status() { prune(); return { pending: pending.size, readyHandoffs: handoffs.size, callbackFailures: { ...callbackFailures } }; },
    close() { closed = true; for (const map of [pending, handoffs]) for (const key of map.keys()) release(map, key); discovery = undefined; },
    async handle(req, res, suppliedBody) {
      let url;
      try { url = new URL(req.url, publicUrl); } catch { return false; }
      const route = Object.entries(paths).find(([, value]) => value === url.pathname)?.[0];
      if (!route) return false;
      const callbackEvidence = {};
      try {
        if (closed) fail('identity_bridge_closed', 503);
        if (req.headers.host !== publicUrl.host || url.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        const method = ['start', 'claim'].includes(route) ? 'POST' : 'GET';
        if (req.method !== method) { res.setHeader('Allow', method); fail('method_not_allowed', 405); }
        if (method === 'POST' && req.headers.origin !== publicUrl.origin) fail('invalid_identity_origin', 403);
        prune();
        if (route === 'clientMetadata') json(res, 200, clientMetadata());
        else if (route === 'callback') await callback(req, res, url, callbackEvidence);
        else if (route === 'start') await start(req, res, await bodyOf(req, suppliedBody));
        else await claim(req, res, await bodyOf(req, suppliedBody));
      } catch (error) {
        const known = error instanceof IdentityError ? error : new IdentityError('identity_service_unavailable', 502);
        // Fixed aggregate counters distinguish provider and host deadlines.
        // No ceremony, owner, credential, URL, request or exception is retained.
        if (route === 'callback' && Object.hasOwn(callbackFailures, known.code)) {
          callbackFailures[known.code] = Math.min(Number.MAX_SAFE_INTEGER, callbackFailures[known.code] + 1);
        }
        if (!res.headersSent && route === 'callback' && acceptsHtml(req)) {
          browserFailure(res, known.status, known.code, callbackEvidence.browserCeremony);
        } else if (!res.headersSent) json(res, known.status, { error: known.code });
        else res.end();
      }
      return true;
    },
  });
}

function hashBase64(value) { return createHash('sha256').update(value).digest('base64url'); }
