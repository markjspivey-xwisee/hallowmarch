import { createHmac, timingSafeEqual } from 'node:crypto';

/** Game transport credentials only. Native OAuth keys/bearers never enter here. */
export function createGameSessionTokens({ secret, now = Date.now, nativeTtlMs = 3_600_000 } = {}) {
  if (typeof secret !== 'string' || !secret || !Number.isSafeInteger(nativeTtlMs) || nativeTtlMs < 1000 || nativeTtlMs > 3_600_000) {
    throw new TypeError('Stable game signing secret and bounded native-session TTL required.');
  }
  const mac = body => createHmac('sha256', secret).update(body).digest('base64url');
  const validId = id => typeof id === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(id);
  const encode = claims => { const body = Buffer.from(JSON.stringify(claims)).toString('base64url'); return body + '.' + mac(body); };
  return Object.freeze({
    issueLegacy(id) {
      if (!validId(id)) throw new TypeError('Invalid game account.');
      return encode({ id, exp: now() + 1000 * 3600 * 24 * 180 });
    },
    issueNative(id, nativeDid) {
      if (!validId(id) || typeof nativeDid !== 'string' || !/^did:[a-z0-9]+:[^\s<>"'\\]{1,400}$/.test(nativeDid)) {
        throw new TypeError('Verified native owner and canonical game account required.');
      }
      const verifiedAt = now(), expiresAt = verifiedAt + nativeTtlMs;
      return { token: encode({ id, exp: expiresAt, nativeDid, nativeVerifiedAt: verifiedAt }), expiresAt };
    },
    read(token) {
      if (typeof token !== 'string' || token.length > 1000 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/.test(token)) return null;
      const [body, signature] = token.split('.'), expected = mac(body);
      if (signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) return null;
      let claims;
      try { claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')); } catch { return null; }
      if (!claims || !validId(claims.id) || !Number.isSafeInteger(claims.exp) || claims.exp <= now()) return null;
      if (claims.nativeDid !== undefined || claims.nativeVerifiedAt !== undefined) {
        if (typeof claims.nativeDid !== 'string' || !/^did:[a-z0-9]+:[^\s<>"'\\]{1,400}$/.test(claims.nativeDid)
          || !Number.isSafeInteger(claims.nativeVerifiedAt) || claims.nativeVerifiedAt > now()
          || now() - claims.nativeVerifiedAt >= nativeTtlMs || claims.exp > claims.nativeVerifiedAt + nativeTtlMs) return null;
        return { id: claims.id, exp: claims.exp, nativeDid: claims.nativeDid, nativeVerifiedAt: claims.nativeVerifiedAt };
      }
      return { id: claims.id, exp: claims.exp };
    },
  });
}
