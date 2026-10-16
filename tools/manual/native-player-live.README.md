# Manual native owner/pod verification

`native-player-live.mjs` is a **mutating, opt-in live QA runner**. It is not a CI
test and is not invoked by a package script or workflow. Without
`HM_NATIVE_LIVE_TEST=1` it exits before importing Playwright or contacting a host.
No live run has been performed while preparing this runner.

## Prerequisites

1. Deploy the Hallowmarch owner-browser persistence slice. The HTTPS game origin
   must serve the real built game, `/ws`, the advertised identity routes,
   `/gaming/identity/finish`, and the allowlisted native-pod browser assets.
   Native participation persistence and the owner-browser write handoff must be
   enabled and healthy. Deploy the owner-pod index composition as well: the
   shipped client must expose `currentHead`/`createAt` and the profile module
   must expose `playerProfileIndexGraphIri`/`validatePlayerProfileIndex`.
   `GET /gaming/identity/status` must eventually report a
   verified native owner, and record-link publication must be available.
2. The explicitly selected HTTPS Interego relay must advertise PKCE S256,
   `mcp:write`, client metadata documents, and the owner-pod tools required by the
   shipped browser client. Its public passkey registration and pod provisioning
   must be enabled. Identity/relay/gate TLS, the passkey RP origin, and browser
   CORS access from the game origin to the advertised MCP endpoint must work.
   Use the real provider configured in Hallowmarch, not a mock or a local shim.
3. Install the existing `tools` dependencies (`npm ci --prefix tools`) and the
   matching Playwright Chromium (`cd tools && npx playwright install chromium`).
   A compatible installed Chromium can instead be selected with
   `HM_CHROMIUM_EXECUTABLE`. `HM_PLAYWRIGHT_MODULE` optionally names an absolute
   installed Playwright `index.mjs`; otherwise `tools/node_modules` is used.
   Node 22 or newer is required. The host must support Chromium CDP and
   SwiftShader WebGL for the actual game boot.
4. Allow several minutes for two complete game boots, native first-owner/pod
   provisioning, descriptor confirmation, and recovery. The runner uses the
   existing game/relay expiry and confirmation contracts; it does not extend
   them, retry registration, or substitute a local save after a timeout.

Run from the repository root, replacing both explicit origins:

```sh
HM_NATIVE_LIVE_TEST=1 \
HM_NATIVE_ORIGIN='https://YOUR-DEPLOYED-HALLOWMARCH-HOST' \
HM_NATIVE_RELAY_ORIGIN='https://YOUR-CONFIGURED-INTEREGO-RELAY' \
node tools/manual/native-player-live.mjs
```

Do not enable `DEBUG`, `PWDEBUG`, `PW_TEST_TRACE`, `NODE_DEBUG`, a browser trace,
HAR, screenshots, storage-state export, or request-body logging. The runner
refuses the listed debug environment variables. It prints only a non-secret QA
display name and fixed stage results. Failure output intentionally omits raw
Playwright errors, URLs, response bodies, and browser console messages.

## What it does

- Creates **one** new Interego owner with display name
  `Hallowmarch QA native E2E <unique run>`, using the real Hallowmarch start route
  and real relay PKCE passkey ceremony. It verifies an explicit `mcp:write` grant
  and the real one-use claim, authenticated by the initiating game account.
- Uses the shipped browser access cache, profile adapter, native SDK, and real
  browser encryption. It creates one browser-held encryption recipient and one
  sealed, clearly synthetic level-one character graph and one sealed owner index
  graph in that owner's pod. The index stores its profile graph IRI and follows
  the latest native character head. Only pointer metadata goes to Hallowmarch.
  Pending native character/index acknowledgements are
  confirmed through the profile's retry path, without replaying creation.
- Loads the native head, verifies authenticated descriptor binding and signed
  canonical RDF digest, decrypts locally, and compares the exact character body.
  It reloads the actual game and checks `SAVE.loaded` against that same body and
  both native heads/digests, using the unexpired encrypted access-session cache.
- Opens a fresh isolated browser context with empty storage. In-memory CDP
  transfer of **this test's own virtual passkey only** simulates passkey sync so
  it can authenticate the same owner; it does not register a second identity.
  Native encryption keys are not copied. The runner deliberately omits the
  Hallowmarch pointer, discovers the owner's existing index, and verifies that a
  replacement key is refused and reading requires recovery. It then imports the
  SDK's encrypted recovery object with an in-memory random passphrase. Another
  actual game reload must open the identical private body and native heads.
- Uses an isolated QA room to verify a native-bound WebSocket refuses central
  `save`, `load`, and `wipe`. Its rejection probe contains no private character
  data. It checks that the real private marker never appears in game HTTP
  requests and that native access bearers never appear in URLs, localStorage,
  captured browser logs, or game HTTP authorization headers.

The virtual authenticator pattern is taken from reviewed Interego revision
`87ee71626c015af3c1e7b9dac5579eff6899e8c1`,
`deploy/mcp-relay/tests/passkey-oauth.spec.ts`: CTAP2/internal, resident key,
verified user, automatic presence. Registration uses `#pk-name` / **Register
new**; reauthentication uses the relay's `#uid-userid` / **Sign in with this
userId** UI. No user password, wallet, invite, existing user passkey, or existing
user credential is needed or read.

## Custody, retained state, and limits

All access credentials stay in browser memory or the real encrypted browser
cache. The synthetic passkey transfer, encrypted recovery object, and random
recovery passphrase exist only in the runner/browser processes. No credential
files, traces, screenshots, raw logs, or recovery files are written. Browser
contexts are ephemeral and closed on completion/failure; the runner also tries
to forget access-cache entries before closing them. The actual OAuth code
travels through the normal PKCE callback URL, but is never printed or saved.
Access/refresh tokens and private keys must never appear in a URL.

The current native relay can issue a refresh token during its server-side code
exchange. Hallowmarch's reviewed bridge discards it before the browser handoff.
This runner does not request, retain, export, or use a refresh token, and checks
that the browser credential has none and no browser refresh exchange occurs.
It cannot observe the private server-to-server token response.

The labelled QA identity, public recipient registration, private character/index graphs,
and game-owned participation/pointer metadata remain in native pods. The game
also creates the usual guest app session before each identity handoff; both
handoffs must resolve to the same canonical native-bound game account. This
runner does not claim to delete durable pod history or revoke the test's native
credentials. The QA passkey/recovery are discarded when it exits, so keep the
printed label for administrative identification. Each explicit invocation can
create one new QA owner; a failed run is not automatically repeated.

The stable named owner index uses an absence preflight and native fork/readback
checks; the current substrate has no atomic compare-with-absence creation
primitive. Unconfirmed writes are never reported saved. This runner does not
claim to prove concurrent first-creation atomicity or recovery of an unindexed
profile if a process dies before its first index commits.

The character is player-authored synthetic data, not an authoritative game
outcome, achievement, assessment, learning result, performance benchmark, or
proof that all legacy personal data has migrated. It does not enter gameplay,
issue rewards, or exercise learning export. A passing run establishes this one
deployed identity/pod persistence path only.

Offline guard verification (does not contact live hosts):

```sh
node --check tools/manual/native-player-live.mjs
node --test tools/manual/native-player-live.guard.test.mjs
```
