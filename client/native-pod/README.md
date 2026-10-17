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

Serve `client.mjs`, `checkpoint.mjs` and the reviewed vendor modules as same-origin JavaScript;
load the module only when native persistence is requested. Hallowmarch's bridge
serves these assets and connects its save pipeline through `profile.mjs`.

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
isolation. This adapter writes no game records or OAuth tokens to browser storage.
The separate access cache stores an unexpired OAuth access credential only as
SDK-sealed ciphertext; it never accepts refresh tokens.
Encrypted recovery uses the existing SDK PBKDF2-SHA256 (600,000 iterations) and
AES-GCM contract, tied to the exact owner/relay scope. Its passphrase is a human
choice; no passphrase or recovery file is uploaded by the adapter.

Generic immutable-record updates require the previously read native CID and use native CAS. A new graph
uses a freshly generated UUID: the current relay has no atomic compare-with-
absence precondition, so first creation is **not** described as initial CAS.
`profile.mjs` maintains the sealed, stable owner index at
`urn:graph:hallowmarch:player-profile-index:<sha256-owner-did>`. It validates and
opens that index before following the current profile head; the game service's
pointer is an optional hint. Existing index metadata requires key recovery even
when the game has no pointer. Named index creation checks absence and sole-head
readback, but also has no atomic compare-with-absence guarantee. Index conflicts
fail closed. Previously created random character graphs still require their owner
index or a verified game hint for discovery.

## Bounded Hallowmarch checkpoints

`profile.mjs` explicitly uses `checkpoint: 'hallowmarch-character/v1'` for character
records. The Hallowmarch consultation journal explicitly uses
`checkpoint: 'hallowmarch-performance-consultation/v1'`. These modes are never
selected from arbitrary model-supplied graph metadata. Agent grants, delegation,
revocation records and the one-time owner index keep immutable native publication.

The first character save or explicit legacy migration publishes one sealed,
signed native graph **binding**. It binds the exact owner DID, pod root, graph,
checkpoint mode, fixed resource URL and registered browser-vault public key.
Every later save replaces that one encrypted own-pod resource through the actual
native resource CAS protocol; it does not publish another context graph. Native
protocol discovery must succeed before any write. The host adds the current
OAuth credential only to this exact own-pod resource fetch. Credentials are not
part of the binding, encrypted checkpoint or pending publication plan.

Every checkpoint has exactly one wrapped key with both sender and recipient
equal to the pinned owner key. The SDK authenticates that self-wrapped key and
the content locally. The authenticated plaintext binds the owner, pod, graph,
fixed resource, schema, operation ID, predecessor native revision, record digest
and original binding publication plan. Readback separately verifies the binding's
descriptor CID, trusted relay authorship report, owner identity, descriptor URL
binding and locally recomputed signed plaintext digest. Original delegation
expiry does not invalidate an otherwise verified historical relay attestation.
The resulting proof kind is `owner-key-authenticated-checkpoint`: each save is
an owner-key-authenticated CAS checkpoint under a signed binding, rather than a
new publisher digital signature. An exact old checkpoint remains cryptographically
valid; a fresh reader does not obtain independent protection against server rollback.

The current application record stays within 384 KiB, the authenticated checkpoint
within 2 MiB, and final encrypted resource within 4 MiB. Sparse rollback snapshots
cover at most the latest hour, one per five-minute interval, with at most twelve
entries and 32 KiB total history. Capacity prunes older snapshots while preserving
the current record; this is not a promise to retain twelve full-size characters.
A persisted rolling-hour budget permits at most 128 MiB of conservatively charged
encrypted writes, including history and binding overhead. Exhaustion is explicit
and expires with the rolling window; no lifetime event count disables saving.

The head returned by `load` or `currentHead` in checkpoint mode contains the
actual native binding descriptor `cid` and `descriptorUrl`, plus explicit
`bindingCid`, physical `nativeRevision`, dynamic `recordCid` and `proofKind`.
Pass the complete head to `save`; comparing only the stable binding CID misses
concurrent character changes. `digest` is the dynamic canonical record RDF digest
(`graph-nquads-sha256:<hex>`). Independent readers must use the known explicit
checkpoint mode on both `load` and `currentHead`.

New characters use `urn:graph:hallowmarch:player-profile:<sha256-owner-did>`, so a
fresh browser can discover the first save even before its owner-index write
confirms. Existing indexed legacy character graphs keep their identities and
migrate only on an explicit save. Every checkpoint-mode read probes its fixed
resource first. Corrupt resources, a binding whose resource is missing, or an
unconfirmed bootstrap cannot authorize a fallback to older legacy progress.

Before the initial native binding publication, the encrypted fixed resource
stores the exact original sealed publication arguments, UUID, digest and expected
legacy head. Interrupted bootstrap is read-only quarantine on load.
`confirm(operationId)` only reads. Explicit
`reconcileCheckpoint({graphIri, checkpoint})` may reconcile that original binding
publication; it never changes its UUID, ciphertext, digest or predecessor. A
dropped native CAS retains the exact original encrypted bytes in memory for an
explicit retry against the original revision. Unknown writes remain fenced until
readback resolves them; neither reconnect nor ordinary load resends a write.

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
node --test client/native-pod/checkpoint*.test.mjs client/native-pod/profile.test.mjs
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
