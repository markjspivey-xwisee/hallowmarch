# Manual native owner/pod verification

`native-player-live.mjs` is a **mutating, opt-in live QA runner**. It is not a CI
test and is not invoked by a package script or workflow. Without
`HM_NATIVE_LIVE_TEST=1` it exits before importing Playwright or contacting a host.
Editing or testing this runner does not launch a live test.

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

For a trusted executor that requires its configured outbound proxy and CA, add
these explicit flags. They are off by default:

```sh
HM_NATIVE_PROXY_FROM_ENV=1 HM_NATIVE_CA_FROM_ENV=1 \
HM_NATIVE_RETAIN_FAILED_SESSION=1 \
HM_NATIVE_LIVE_TEST=1 \
HM_NATIVE_ORIGIN='https://YOUR-DEPLOYED-HALLOWMARCH-HOST' \
HM_NATIVE_RELAY_ORIGIN='https://YOUR-CONFIGURED-INTEREGO-RELAY' \
node tools/manual/native-player-live.mjs
```

Proxy opt-in uses `HTTPS_PROXY`/`https_proxy`, then `HTTP_PROXY`/`http_proxy`, as a
structured Playwright proxy. It accepts HTTP/HTTPS proxy origins only; credentials
are kept in structured memory and never printed. CA opt-in reads
`NODE_EXTRA_CA_CERTS`, falling back to `SSL_CERT_FILE`, and requires an absolute
path containing exactly one currently valid CA certificate. It derives that
configured certificate's public SPKI SHA-256 pin for Chromium. It does not use
`ignoreHTTPSErrors`, a blanket certificate-error flag, a checked-in executor CA,
or a caller-supplied arbitrary pin. Do not use an unrelated CA or a bundle of
public roots for this option.

Failures print the fixed stage plus an allowlisted code such as
`err_empty_response`, `err_cert_authority_invalid`, `browser_timeout`, or
`native_operation_failed`. First-save failures additionally print a bounded
report containing only fixed connect, registry, registration, publication,
index, bridge-link and readback step names; allowlisted error codes; numeric
HTTP/JSON-RPC codes; and booleans/counts. Native messages, subjects, graph IRIs,
keys, requests and response bodies are not printed. If a synthetic passkey has been created and
`HM_NATIVE_RETAIN_FAILED_SESSION=1`, the failed process keeps its ephemeral
browser contexts, the original client/profile and pending operation maps,
expected synthetic save, encrypted recovery and that same test passkey in RAM.
It accepts these exact commands, with no arbitrary JavaScript or URL arguments:

- `status`: redacted browser state, fixed plan cursor, local native QA state,
  proof substep, fixed proof-error code and native verification-request count.
- `diagnose`: the same state plus read-only held-key/registration booleans and
  bounded provider challenge HTTP status, pending-action flags and fixed UI
  classifications. Unknown error text, user identifiers and response bodies
  never appear. A stalled provider inspection cannot queue more browser reads.
- `retry`: retry only the failed stage using its existing closure and owner.
- `continue`: retry the failed stage and proceed through remaining stages.
- `oauth-retry-same-owner`: after a definitively failed callback **before any
  claim request**, explicitly start a new sign-in with only the original
  retained resident passkey. This cannot register a replacement owner.
- `oauth-restart-unproved-start`: explicitly cancel a later start that has not
  attached capture/proof or sent any verification/callback/claim, after this
  controller's original registration was accepted. It verifies the same initiating
  game account using the exact observed start bearer, closes the original popup,
  rechecks all no-proof/no-claim conditions, and starts a usernameless sign-in with
  the original passkey. Pending observer jobs or any uncertain proof forbid it.
- `companion-restart-admission`: when optional companion QA is selected, reset
  only its expired/uncertain ephemeral admission at the permitted proof stage.
- `finish`: forget access cache and close the retained browsers.

A completed stage is never rerun. Registration has an additional irreversible
attempt guard: the registration click cannot be replayed by any command.
OAuth timeouts retain the original popup, listeners and ceremony: ordinary
`retry` resumes their pending result without another start, proof submission or
callback/code reload. A missing claim response is uncertain, even if a request
was sent; it cannot authorize a replacement ceremony. Fixed OAuth diagnostics
include phase, numeric HTTP statuses, allowlisted callback/finish error codes,
claim-request counts and a bounded ceremony history. They never include URLs,
codes, states, credential IDs, user IDs, keys or authorization values.

Before the proof click, the owned native popup receives a narrow fetch wrapper
for the exact relay `POST /oauth/verify`. It clones at most 8 KiB of that
response, validates its exact `{redirect}` shape, callback origin/path/query and
this ceremony's state, then acknowledges only a SHA-256 digest to the runner
before returning the original, unchanged Response to the provider. The binding
accepts only that popup's main frame at the relay authorization page and one
receipt for the retained attempt. No redirect, OAuth code, state or native
credential crosses this diagnostic port.

The independent runner observer still verifies the actual native request,
original retained passkey and HTTP 200. If immediate cross-origin navigation
evicts Playwright's body, only the validated browser receipt can supply its
response digest. The callback URL must match that exact digest; readable Node
and browser evidence must agree. HTTP acceptance alone cannot permit a retry.
Fixed `verifyBodyCode`, `captureCode` and `redirectEvidence` fields distinguish
an unavailable body, malformed response and valid pre-navigation capture. A
malformed readable response, foreign/stale/duplicate receipt, or unknown claim
result still refuses replacement. The receipt can arrive before or after the
independent HTTP observer; both checks must finish before granting authority.

The explicit `oauth-retry-same-owner` command is available only at an OAuth
stage after a validated native proof and a definitive callback HTTP error,
with no claim request and the exact original passkey still held. Resolve the
application callback failure before invoking it. The old popup is closed; a
fresh S256 ceremony uses the provider's discoverable **Sign in** flow with only
that resident credential installed. No userId/DID argument, identity lookup,
second registration or alternate passkey is accepted. At most four total
ceremonies can be retained for one logical sign-in stage.

Before capture or proof, each observed `/start` bearer is checked by a read-only
same-origin `/gaming/identity/status` request using that exact bearer. The first
initiating game account is pinned for that controller, and later starts must
resolve to the same account. A WebSocket reconnect may rotate the guest bearer;
that rotation is accepted only after independent same-account verification.
Each individual ceremony still requires exact start-to-claim bearer equality.
The fresh browser's initiating guest account is distinct from the canonical
native account restored after a successful claim; final native owner checks
remain separate and unchanged. A cancelled unproved start remains in the privacy
audit and never counts as a successful proof or callback.

The corrected fixture `20261017004027730-354fc8e1` stopped before its first
successful claim. Its registration proof and one same-owner proof each received
HTTP 200, but both callbacks returned HTTP 409 `identity_binding_rejected`.
After the diagnostic-only preview restart, `/start` returned HTTP 200 but the
older loaded harness rejected its rotated guest bearer before submitting any
native proof (`qa_oauth_start_provenance`). No private profile, agent grant or
coaching delivery occurred in that fixture. The new account verifier and fixed
unproved-start command cannot hotload into that older retained process.

The running native relay's `/oauth/verify` response exposes only `{redirect}`;
it does **not** expose a response-derived userId. The helper binds its success
to the original request's credential ID, the retained CDP credential and the
exact advertised callback/state, all in RAM. As a consistency check only, it
uses Interego revision `5fe8edb9c3d341c73cdca356a22aa211c350a6cb`'s documented
`deploy/identity/derive-userid.ts` invariant: SHA-256 over the base64url credential
ID **string**, first 12 hex digits with `u-pk-`. This local derivation grants no
authority. WebAuthn, the native callback and authenticated Hallow status must
verify the actual owner, matching any prior canonical binding. Final privacy
checks still require exactly two successful claims; any additional start must
have the separately recorded, explicitly superseded pre-claim failure and the
same initiating game authorization. Unaccounted starts or claims fail the suite.

First-save retries reuse a locally created key if recipient registration
failed and preserve outstanding native operation IDs for confirmation. They do
not create a replacement profile while an acknowledgement is uncertain. A
definitively refused publication may be retried by the original profile adapter.
The complete-suite PASS is emitted only after every proof check passes. EOF
or process termination also closes the retained session. The existing browser
keys/access cache remain available in the retained context until it closes.
After a resumed suite passes, the retained command loop stays open until `finish`.

Fresh-browser verification retains its one reload and verifies that the document
changed. Stage `retry` then observes that same page and private read instead of
reloading again. If that stage has failed and the original owner's title is
still open, `native-startup-retry` clicks its existing **Retry connection** button.
It refuses a different owner/host, active gameplay, pending writes, or a busy
stage. Follow it with `diagnose`, then `retry` or `continue` to verify the exact
native character. This action does not start OAuth or recreate the owner/key.

The recovery stage retains a separate browser-only diagnostic helper. Its reports
contain fixed recovery phases, allowlisted native error codes, native tool
outcomes/numeric codes, and profile/readiness flags. They never include a request,
credential, key, recovery file, private record, owner identifier or raw error.
Before restoring the original key it checks the original game session/native
binding and the existing client's local readiness. The transport permits only
native reads during recovery: a missing original encryption recipient is a
failure, not permission to register another recipient or publish a version.
Retried recovery preserves the same profile, key and expected record; it never
starts OAuth. Diagnostic changes apply only to a newly loaded runner, not to an
already retained process.

The authorized preview run `20261017002434624-3a018eb7` passed the first six native
stages, including one owner registration, exact private-body verification,
same-browser reload and fresh-context same-owner sign-in. It stopped at
`fresh-browser-encrypted-key-recovery` with the old runner's generic
`native_operation_failed`. A bounded same-stage retry at
`2026-10-17T00:36:26.881Z` also failed within one second. No main-world grant or
coaching delivery occurred in that run. The older loaded runner cannot expose
the new phase/code probe; these diagnostic changes do not establish a live PASS.

Optional companion verification uses `HM_NATIVE_COMPANION_LIVE_TEST=1`, plus the
existing native agent's independently verified public DID and HTTPS home pod in
`HM_NATIVE_COMPANION_AGENT_DID` and `HM_NATIVE_COMPANION_AGENT_POD_URL`. It starts
only after all ten private stages and privacy checks pass and reuses the single
recovered game page. One stdin router is already listening when its signing
stage emits a public `interego.sign_request` request. Feed only the matching
public signed envelope back; never a connector credential. See
[`native-companion-live.README.md`](./native-companion-live.README.md) for the exact
protocol, optional flags, retained retries and explicit admission restart.

### Optional human coaching smoke

`HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST=1` explicitly adds a manual coaching smoke
after all ten native-owner stages and all six main-world stages pass. It also
requires `HM_NATIVE_LIVE_TEST=1` and `HM_NATIVE_MAIN_WORLD_LIVE_TEST=1`, the explicit
HTTPS game/relay origins, and the existing public agent scope required by the
main-world suite. Supplying this flag without that scope, or using a value other
than exactly `1`, is refused before browser import. This flag does not supply
user authorization: authenticated relay/pod activity must be specifically
authorized before anyone launches the suite.

The smoke uses the same labelled synthetic human owner and the ordinary Players
sheet. It enters the fixed goal “Validate coaching workflow on this synthetic QA
character,” describes an explicitly synthetic integration test, reviews the real
owner-browser observations, checks both task-scoped consent boxes, and clicks
**Request my plan** once. A page-local observer counts only delivery attempts for
that advertised Foxxi action; it forwards every request unchanged. Successful
verification requires exactly one observed `act` delivery attempt, a displayed
response attributed to the actual Foxxi descriptor/session delegate, and an
independent authenticated private readback of that exact plan and observation.

The click-attempt flag is retained before clicking. An uncertain response never
causes an automatic resend, a new request, or another consent grant. A later
manual continuation can only wait for the original result and read it back.
Concurrent continuations share one in-flight helper operation, independently
of the UI button’s busy state. Private readback rechecks the original page,
origin, game account/session and native owner binding after the read and before
accepting proof; changing the owner during readback cannot produce a PASS.
The original owner/session is pinned before any connection or review UI waits.
Each consent and request click rechecks that pinned native binding and requires
the preview to identify that exact human performer and reviewed synthetic task.
The final check and real DOM click share one browser turn; an owner switch
during connection or review cannot silently redirect the QA request.
If that cannot establish the result, the smoke stays failed and the operator
must stop; unknown delivery is never a PASS. Only pending native storage
confirmation has the product’s separate existing confirmation control.

The synthetic report is a transport test, not evidence of learning or better
gameplay. Verification requires `not-assessed`, unvalidated-effect provenance,
no competency claims, and no Foxxi personal learning record. Console output
contains fixed stages, booleans and bounded actual owner-browser measurements.
Private plans, task bodies, encryption keys, native credentials and signed
envelopes remain in browser/process memory and are never dumped or exported.
Context cleanup removes the temporary request observer and its memory.

The public run label `20261016221141372-61d93afc` records a blocked attempt, **not
a live PASS**. Its last successful status was `initial-game-boot`, 0 of 10 native
stages, with no observed OAuth controller or confirmed native binding. Automatic
approval review then rejected continuation of the authenticated external
relay/pod test. The safe finish attempt reported that its process handle was
unavailable; cleanup could not be independently confirmed. No equivalent live
flow was retried after that rejection. No live credentials or private records
were retained as checkpoint artifacts.
Subsequent cleanup-only process inventory found no runner with this worktree’s
script/cwd visible in the available runtime. Browser descendant cleanup remains
unconfirmed; no namespace workaround or further authenticated flow was attempted.

Boot diagnostics include fixed substeps and an inventory of every observed page,
including closed pages and game/relay/blank/other origin classes, with counts.
They never print page URLs. Browser status evaluation has a two-second bound;
one stalled evaluation per page is retained so repeated commands cannot queue
more renderer work. Known native phase names, error codes and bounded tool
history remain visible through strict allowlists. Cleanup evaluation is also
bounded and cannot prevent the subsequent context-close attempt. Final context
and browser close attempts are bounded too, so a stuck context cannot prevent
the browser-close backstop.

## What it does

### Explicit private synthetic checkpoint

The default remains RAM-only. The full main-world runner can explicitly retain
its generated synthetic fixture outside the repository and Library:

```sh
export HM_NATIVE_QA_CHECKPOINT_DIR='/tmp/hallowmarch-synthetic-qa-unique-label'
export HM_NATIVE_QA_CHECKPOINT_MODE=new
```

Then use the already-authorized full live/main-world command with its exact
origins, agent scope and opt-in flags.

Set both variables or neither; there is no default directory. `new` refuses an
existing checkpoint. The directory must be a private absolute temporary path
(0700), with private owned files (0600), no symlinks/repository/Library path, and
one exclusive writer. Writes use a private temporary file, file fsync, atomic
rename and directory fsync. Any checkpoint failure blocks further native writes.

The strict versioned file contains only this generated test's virtual passkey
and counter, public run/owner scope, fake expected save, encrypted profile-key
recovery plus synthetic passphrase, and safe publication/grant pointers and
intent markers. Optional CDP metadata is not stored. Native OAuth bearers, game
tokens, signed envelopes, real user credentials, private coaching responses,
HAR, logs and browser-storage dumps are never checkpointed. Never print, upload,
commit, or add this directory to Library. It is a private test credential store.

Registration intent is persisted before its one click; each captured/updated
passkey is acknowledged before its event resolves. The verified owner is retained
after the native claim. Encrypted key recovery is durably acknowledged before
`profile.set`; graph/operation/digest intent is acknowledged before each actual
native publication. Grant and coaching-delivery intent is recorded before its
real UI click, so interruption cannot cause another grant or coaching request.

After independently confirming the prior runner **and** browser are gone, use
the exact same scope/directory with `HM_NATIVE_QA_CHECKPOINT_MODE=resume`.
Clean shutdown releases `writer.lock`. A process crash may leave that lock:
never break it based on age or an unknown process handle. Only after independent
process inventory proves the previous writer/browser stopped, remove that single
stale `writer.lock`; keep `checkpoint.json` untouched and private. Do not dump its
contents to inspect it. Concurrent writers, changed files/locks, wrong modes,
unsafe permissions, or missing/corrupt state are refused before browser launch.

Resume requires the original captured passkey, verified owner and encrypted
recovery. An interruption before any required capture is explicitly unrecoverable;
the runner never registers a replacement identity or creates a replacement key.
It signs in with the original resident passkey and obtains fresh native proof.
The five-stage resumed lane uses direct native `currentHead`/`load` behind a
read-only transport, comparing both original graph/operation/digest entries,
owner index target, exact fake body and provenance. It does not call the profile
adapter's potentially writing `get`, restore a transaction map, repair a missing
index, resend a publication, or count persisted PASS flags as evidence. Missing
or uncertain native records stop the run. Only fresh successful readback permits
normal title reload/privacy checks and previously unstarted optional gameplay.
Any prior grant/coaching intent blocks automatic resume, including uncertain
delivery or a grant later marked revoked; native readback/revocation needs a
separate reviewed continuation.

There is one explicit pre-registration continuation: `resume-unregistered`
reopens the exact saved fixture only when registration intent is false, the
credential/owner/recovery are all absent, publication intents are empty, and
every grant/coaching lifecycle field is empty or false. It reuses the original
run, synthetic passphrase and fake expected save in the normal first-registration
lane. Any partial registration, key, record or lifecycle state is refused;
ordinary `resume` retains its owner-known, read-only recovery rules. This mode
does not reset state or choose a new identity after an uncertain registration.

`resume-current-owner-save` is a separate explicit owner-known continuation for
a character that legitimately autosaved after the initial exact-body proof.
It keeps the original owner/pod/account/key, recovery, expected save and
publication baseline. Native reads must prove the exact original owner-index
operation/digest and its original profile graph, then authenticate that graph's
current player-authored save with the same unique character name/realm/class.
Both native heads and the current owner binding are rechecked. Only a save hash,
public heads and bounded verification flags leave the browser; no current body
is returned or written over the original checkpoint. After one real reload the
title must independently prove the same save hash and fresh owner binding.
A same-account token may rotate across that reload; each in-flight check pins
its own token/generation. This proves the current gameplay save, not a repeat
of the initial fake-body proof. Missing or foreign records and any prior
grant/coaching intent still block continuation. The exact original passkey's
monotonic assertion counter remains durably synchronized; no native record is
published by this verification lane and no lifecycle intent is created by it.

Run `20261017010249256-747db867` lost its process handle during environment refresh.
Read-only inventory found no remaining runner/browser. Only its launch label was
observed; registration and later progress are unknown. It had no checkpoint and
is explicitly unrecoverable, with no live PASS claimed.

Fixture `20261017015232831-92e59157` passed all ten native/private stages on
preview `802d180`, after an initial pre-registration startup timeout and a
separate startup-only check that reached readiness in 50.49 seconds. Its private
party setup later timed out before chat messages, agent grants or coaching
requests. The retained process handle was then lost; orderly finish was not
confirmed. Independent process inventory found no runner/browser, and its
private checkpoint remains untouched with its stale writer lock. Normal game
autosave may have advanced the private profile; no later live PASS is claimed.

The main-world lane also checks private chat after reconnect and before its
public agent grant. It uses the existing second authenticated QA socket in the
unique QA room, forms a real party through the game protocol, sends one synthetic
message through the owner's real input/button and one reply from that peer, and
requires both actual wire events plus the owner's displayed reply. Membership
and channel are checked in the same browser turn as the send click; a missing
party stops the check before chat can fall back to the global realm channel.
An uncertain attempt is never replayed. It does not contact real players.

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
- After the same-browser reload and exact native-head equality, records a
  successful privacy check and closes that entire first context. Only then
  opens a fresh isolated browser context with empty storage, keeping one full
  SwiftShader game context active at a time. Failed boots retain their page
  before navigation and reuse it on retry. The final privacy invariant uses
  the first context's recorded proof and a live check of the fresh context.
  In-memory CDP
  transfer of **this test's own virtual passkey only** simulates passkey sync so
  it can authenticate the same owner; it does not register a second identity.
  The exact credential ID, key, relying party and user handle stay bound while
  actual CDP assertion events advance its retained signature counter. The
  runner waits for that proof's credential event before reading or copying it;
  reusing the old registration counter after a retry is refused. A definitive
  native verification HTTP refusal fails promptly, without another ceremony.
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
new**; every reauthentication uses the relay's canonical **Sign in** UI with
only this run's exact resident credential installed. The authenticated owner,
pod and game account must still match the original verified binding. The
optional known-user-ID lookup is not exercised by this runner. Read-only
challenge diagnostics default to the reviewed Interego identity origin;
`HM_NATIVE_IDENTITY_ORIGIN` can explicitly select another HTTPS identity origin.
No user password, wallet, invite, existing user passkey, or existing
user credential is needed or read.

## Custody, retained state, and limits

All access credentials stay in browser memory or the real encrypted browser
cache. By default the synthetic passkey transfer, encrypted recovery object,
and random recovery passphrase exist only in the runner/browser processes.
The explicit checkpoint opt-in above retains only the generated fixture's
allowlisted state in its private directory. No traces, screenshots, raw logs,
or browser-storage dumps are written. Browser
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
credentials. The QA passkey/recovery leave RAM when it exits; an explicitly
enabled private checkpoint remains available for the guarded same-owner resume.
Keep the printed label for administrative identification. A `new` invocation can
create one QA owner; a failed run is not automatically repeated, and `resume`
never registers another owner.

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
node --test tools/manual/native-player-orchestration.test.mjs
node --test tools/manual/native-browser-network.test.mjs
node --test tools/manual/native-live-stages.test.mjs tools/manual/native-owner-qa-session.test.mjs
node --test tools/manual/native-oauth-ceremony.test.mjs tools/manual/native-oauth-redirect-capture.test.mjs
HM_PLAYWRIGHT_MODULE=/ABSOLUTE/playwright/index.mjs node --test tools/manual/native-owner-qa-session.browser.test.mjs
HM_PLAYWRIGHT_MODULE=/ABSOLUTE/playwright/index.mjs node --test tools/manual/native-oauth-redirect-capture.browser.test.mjs
```

These offline checks use a fixture for failure/retry orchestration and actual
allowlisted SDK modules for Chromium serialization/import. They create no native
identity, exercise no live pod, and do not establish that a deployed native save
passes. The live command remains a separate, explicitly authorized operation.
