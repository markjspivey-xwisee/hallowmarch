# Owner-side native records

This ES module composes the existing Interego relay tools. It imports a 76.9 KB
browser ESM bundle built from reviewed Interego revision
`87ee71626c015af3c1e7b9dac5579eff6899e8c1`; the bundle's source hashes, dependency
versions, reviewed lock hash and output hash are in its adjacent manifest. No
game engine or workspace vertical is imported.

## Host contract

The host completes native OAuth and hands the initiating browser an explicitly
authorized relay OAuth access credential plus the verified owner DID/pod.
It must request the native `mcp:write` grant, keep the access token in browser
memory, and never send it to the game backend. Refresh-token custody is not
implemented here and refresh tokens are refused. The host must reconnect when
the access grant expires. Do not log credentials or persistence bodies.

Serve `client.mjs` and `vendor/interego-browser.mjs` as same-origin JavaScript;
load the module only when native persistence is requested. This change does not
add a server route or connect the game save pipeline.

```js
import { createNativePodClient } from '/client/native-pod/client.mjs';
const pod = createNativePodClient({ relayUrl, credential, ownerDid, podUrl });
const status = await pod.connect();
// If no key exists, offer explicit create/restore choices. Do not create a
// replacement automatically when an existing encrypted record cannot open.
await pod.createKey(); // or restoreRecovery(encryptedFile, passphrase)
const created = await pod.create({ record: applicationRecord });
if (created.saved) {
  // Put this graph reference in the owner's discoverable native record index.
  const loaded = await pod.load({ graphIri: created.graphIri });
  const updated = await pod.save({ graphIri: loaded.graphIri,
    expectedHead: loaded.head, record: updatedApplicationRecord });
}
```

`createKey()` registers a **new key-derived recipient resource** on the actual
owner pod's `agents` registry, with `ReadOnly` scope and only its public key. It
is an encryption recipient, not a newly minted login DID. The existing OAuth
session agent remains the publisher. No existing session-agent encryption key
is changed; a conflicting recipient registration is refused. `registerKey()`
allows a browser holding an existing/restored key to verify its registration.

`keyStatus()`, `exportRecovery(passphrase)`, `restoreRecovery(file, passphrase)`,
`confirm(operationId)`, `status()` and `close()` complete the API. Domain record
versions, import verification, authoritative game signatures/outcome validation,
discovery/index semantics and conflict reconciliation are the caller's concern.
An opaque record is not automatically an authoritative game outcome.

## What is persisted

The authoritative private record lives in the owner's Interego pod. Its RDF
wrapper binds the owner, graph and operation ID; the payload remains opaque JSON
to this adapter. Real `ClientKeyVault` X25519/XSalsa20-Poly1305 envelopes are
constructed before transport and include only the browser's recipient key.
The relay receives `sealed_payload`, the canonical RDF digest and a non-secret
supersession mirror. Readback gets the original envelope, decrypts locally,
compares the opened RDF digest with the authenticated descriptor's signed digest,
and checks owner/graph binding. There is no server decryption fallback.

IndexedDB holds only encryption-key custody: an encrypted NaCl secret and a
non-extractable WebCrypto AES wrapping key. Both remain in the browser. Same-origin
malicious script is outside that isolation boundary; this is not hardware key
isolation. No game records or OAuth tokens are written to IndexedDB/localStorage.
Encrypted recovery uses the existing SDK PBKDF2-SHA256 (600,000 iterations) and
AES-GCM contract, tied to the exact owner/relay scope. Its passphrase is a human
choice; no passphrase or recovery file is uploaded by the adapter.

Updates require the previously read native CID and use native CAS. A new graph
uses a freshly generated UUID: the current relay has no atomic compare-with-
absence precondition, so first creation is **not** described as initial CAS.
The host must retain the returned graph reference through its owner-side index.

Only fresh native head plus exact local decrypt/digest readback returns
`saved: true`. Pending or lost acknowledgements return `saved: false` and an
operation ID; `confirm` resolves them without replaying a write. At most eight
unconfirmed operations and one per graph can be held. Pending metadata is
in-memory, bounded and not a durable data primary. A lost browser can recover
committed records through the native index and encrypted key recovery. A record
that never committed is not recoverable from this adapter.

## Rebuild and verification

```sh
HM_INTEREGO_SDK_ROOT=/path/to/reviewed/interego \
HM_ESBUILD_MODULE=/path/to/esbuild/lib/main.js \
node tools/build-native-pod-client.mjs
node --test client/native-pod/client.test.mjs
HM_PLAYWRIGHT_MODULE=/path/to/playwright/index.mjs \
HM_CHROMIUM_EXECUTABLE=/path/to/headless_shell \
node client/native-pod/browser.test.mjs
```

The builder requires esbuild 0.28.0, checks the exact SDK commit and every bundled
SDK source against git, and compares bundled dependency versions with the
reviewed lock. It does not require a registry credential or include node_modules.

Tests use real pinned cryptography, the SDK's JSON/SSE transport and actual
Chromium IndexedDB/CryptoKey structured cloning. Relay storage, identity responses
and authorship verdicts are explicitly contract fixtures: these tests establish
neither live pod provisioning nor live authentication or native durability.
