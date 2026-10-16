# Encrypted browser access-session cache

`access-cache.mjs` is a generic, browser-only cache for an **already verified**
Interego relay OAuth access session. It reuses the pinned `ClientKeyVault`; no
cryptographic implementation, remote authentication flow or application-specific
authority is added.

```js
import { createBrowserAccessCache } from '/client/native-pod/access-cache.mjs';
const sessions = createBrowserAccessCache();
await sessions.put({ relayUrl, ownerDid, podUrl, credential });
// After reload: this list contains only non-secret identity/expiry metadata.
const candidates = await sessions.list({ relayUrl });
const restored = await sessions.get({ relayUrl, ownerDid, podUrl });
if (restored) {
  // Probe the native client/session before using it. A cached unexpired token
  // may still have been revoked, and this offline cache cannot determine that.
  const client = createNativePodClient({ ...restored });
  await client.connect();
}
await sessions.forget({ relayUrl, ownerDid, podUrl }); // explicit sign out
await sessions.forgetAll(); // all cached sessions on this browser origin
await sessions.close(); // closes this cache instance; does not forget records
```

`put` returns non-secret metadata. `get` returns that metadata and the original
access credential, or `null` for absent, expired, changed, corrupted or unopenable
entries. Neither method returns an expired token. `list` is discovery metadata,
not proof of current authentication. Multiple identities require the host's
selection policy; this cache never silently chooses one.

The input credential is the SDK relay credential shape: `kind` is
`relay-oauth-bearer`, `accessToken` is opaque, `method` is `siwe` or `webauthn`,
`expiresAt` is the actual grant expiry in Unix milliseconds, `clientId` is optional,
and `refreshToken` is absent/null. Refresh tokens and unknown credential fields
are refused before any cache change. There is no refresh or backend storage.

Only an encrypted envelope and non-secret canonical owner/pod/relay/expiry metadata
are stored in IndexedDB. A purpose-separated SDK vault holds an encrypted NaCl
secret plus a nonextractable WebCrypto AES wrapping key. Its authenticated scope
binds the cache purpose, exact owner DID, exact canonical pod URL, relay origin
and record revision. The encrypted payload independently binds those values and
the credential's expiry. Altering outer metadata cannot extend a token's lifetime.

The cache is limited to 16 sessions. Expired entries are removed when listed/read;
forgetting removes both envelope and wrapping-key record. IndexedDB transaction
revision checks prevent an in-flight store or decrypt in another cache instance
from resurrecting a forgotten/replaced session. A credential already returned
to the host cannot be recalled: sign out must also close the native client and
discard the host's in-memory credential.

Client-held keys do not isolate the session from malicious code executing on the
same browser origin. This protects persisted values from plaintext storage and
keeps credentials out of servers; it is not hardware custody or a replacement
for browser-origin security. The cache makes **zero network requests** and logs
neither credentials nor decrypted payloads.

The optional constructor ports are `{ indexedDB, crypto, now, databaseName }`.
Defaults use the browser's native IndexedDB/WebCrypto and wall clock; unavailable
durable storage or secure crypto fails closed. No memory/localStorage plaintext
fallback is used.

Verification uses actual Chromium IndexedDB and WebCrypto with synthetic access
tokens: reload, nonextractable key custody, expiry/tamper checks, owner/pod/relay
isolation, refresh rejection, cross-instance forget races, replacement races,
forgetAll and no network operations.

```sh
HM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
HM_CHROMIUM_EXECUTABLE=/path/to/headless_shell \
node client/native-pod/access-cache.browser.test.mjs
```
