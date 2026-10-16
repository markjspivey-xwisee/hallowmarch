import { createHash, createPrivateKey, createPublicKey, sign } from 'node:crypto';

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function base58(bytes) {
  let n = BigInt('0x' + bytes.toString('hex')), value = '';
  while (n) { value = ALPHABET[Number(n % 58n)] + value; n /= 58n; }
  for (const byte of bytes) { if (byte !== 0) break; value = '1' + value; }
  return value;
}
function httpsOrigin(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('Game identity requires an HTTPS origin.');
  return url.origin;
}

/** Dedicated game credential, never an authenticated human add-device flow.
 * Contract: identity POST /challenges then POST /auth/did with Ed25519 nonce proof.
 * The bearer is renewed from the durable game-owned key; no bearer is sent to sign in.
 */
export function createGameServiceIdentity({ identityOrigin = 'https://identity.interego.xwisee.com', keyJwk,
  expectedUserId, expectedPodUrl, surfaceAgent = 'hallowmarch-game', fetch: transport = globalThis.fetch,
  now = Date.now, renewBeforeMs = 300_000 } = {}) {
  const origin = httpsOrigin(identityOrigin);
  const jwk = typeof keyJwk === 'string' ? JSON.parse(keyJwk) : keyJwk;
  if (!jwk || jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || typeof jwk.x !== 'string' || typeof jwk.d !== 'string') throw new Error('Game identity requires a stable Ed25519 private JWK.');
  const privateKey = createPrivateKey({ key: jwk, format: 'jwk' });
  const actual = createPublicKey(privateKey).export({ format: 'jwk' });
  if (actual.x !== jwk.x || Buffer.from(jwk.x, 'base64url').length !== 32) throw new Error('Game identity key does not match its public key.');
  const publicKeyMultibase = 'z' + base58(Buffer.concat([Buffer.from([0xed, 0x01]), Buffer.from(jwk.x, 'base64url')]));
  const credentialDid = 'did:key:' + publicKeyMultibase;
  const userId = 'u-did-' + createHash('sha256').update(credentialDid).digest('hex').slice(0, 12);
  if (expectedUserId && expectedUserId !== userId) throw new Error('Game identity owner does not match its key.');
  if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(surfaceAgent)) throw new Error('Game identity surface is invalid.');
  const pinnedPod = expectedPodUrl ? new URL(expectedPodUrl) : null;
  if (pinnedPod && (pinnedPod.protocol !== 'https:' || pinnedPod.pathname !== '/' + userId + '/' || pinnedPod.search || pinnedPod.hash || pinnedPod.username || pinnedPod.password)) throw new Error('Game pod is not isolated to the game identity.');
  const owner = 'did:web:' + new URL(origin).host + ':users:' + userId;
  let cached = null, inflight = null;

  async function post(path, body) {
    let response;
    try { response = await transport(origin + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000), redirect: 'error' }); }
    catch { throw new Error('Game identity service is unavailable.'); }
    if (!response.ok) throw new Error('Game identity service rejected authentication (' + response.status + ').');
    const text = await response.text();
    if (text.length > 64_000) throw new Error('Game identity response exceeds capacity.');
    try { return JSON.parse(text); } catch { throw new Error('Game identity response is invalid.'); }
  }
  async function renew() {
    const challenge = await post('/challenges', { purpose: 'did-sig' });
    if (typeof challenge.nonce !== 'string' || !challenge.nonce || challenge.nonce.length > 2048 || !Number.isFinite(Date.parse(challenge.expiresAt)) || Date.parse(challenge.expiresAt) <= now()) throw new Error('Game identity challenge is invalid.');
    const signature = sign(null, Buffer.from(challenge.nonce, 'utf8'), privateKey).toString('base64url');
    const result = await post('/auth/did', { did: credentialDid, nonce: challenge.nonce, signature, publicKeyMultibase, name: 'Hallowmarch Game Service', surfaceAgent });
    const expiry = Date.parse(result.expiresAt);
    const ownerWebId = result.webId;
    if (ownerWebId !== undefined && ownerWebId !== origin + '/users/' + userId + '/profile#me') throw new Error('Game identity returned another owner profile.');
    let returnedPod;
    try { returnedPod = new URL(result.podUrl); } catch { throw new Error('Game identity returned an invalid pod.'); }
    if (result.userId !== userId || result.did !== owner || result.agentDid !== 'did:web:' + new URL(origin).host + ':agents:' + surfaceAgent + '-' + userId
      || !['http:', 'https:'].includes(returnedPod.protocol) || returnedPod.pathname !== '/' + userId + '/' || returnedPod.search || returnedPod.hash || returnedPod.username || returnedPod.password
      || typeof result.token !== 'string' || result.token.length < 32 || /[\r\n]/.test(result.token) || !Number.isFinite(expiry) || expiry <= now() + 30_000
      || result.scope !== 'ReadWrite') throw new Error('Game identity response does not match its isolated owner.');
    // The identity server returns its private CSS spelling; deployment supplies the HTTPS
    // gate spelling. Only the credential-derived pod path is accepted in either form.
    cached = { token: result.token, expiresAt: expiry, userId, owner, ...(ownerWebId ? { ownerWebId } : {}), agentDid: result.agentDid, credentialDid,
      podUrl: pinnedPod?.href ?? returnedPod.href, podAliases: [...new Set([returnedPod.href, pinnedPod?.href].filter(Boolean))] };
    return cached;
  }
  async function session() {
    if (cached && cached.expiresAt > now() + renewBeforeMs) return cached;
    if (!inflight) inflight = renew().finally(() => { inflight = null; });
    return inflight;
  }
  return Object.freeze({
    owner, userId, credentialDid,
    async credentials() { return { Authorization: 'Bearer ' + (await session()).token }; },
    async metadata() { const { token: _token, ...metadata } = await session(); return metadata; },
    invalidate() { cached = null; },
  });
}
