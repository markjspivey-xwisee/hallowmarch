# Manual native companion verification

These modules extend the retained native-player QA runner. They are **manual,
mutating, opt-in**, never a package script or CI live test. Importing them makes
no network request, creates no browser, registers no identity and writes no file.
The implementation and offline tests do not establish that a deployment passed.

Use only the explicitly selected preview and its dedicated game-owned pod, with
no other authoritative-room players. First finish the existing private profile,
owner index, reload, same-owner OAuth, encryption recovery and privacy checks.
Only then run companion gameplay; its public QA presence and game-owned room
state are additional durable test data. Keep **one recovered game page** open;
multiple full SwiftShader game pages can stall this executor. The extension
creates a lightweight same-owner WebSocket inside that page, not another game.

`native-player-live.mjs` now composes these modules as an optional extension.
It never attaches to an already running browser namespace. Companion mode is
off unless its own exact flag is selected. It requires the existing native
agent's public scope in two additional environment values:

```sh
HM_NATIVE_LIVE_TEST=1 HM_NATIVE_COMPANION_LIVE_TEST=1 \
HM_NATIVE_RETAIN_FAILED_SESSION=1 \
HM_NATIVE_ORIGIN='https://YOUR-DEDICATED-PREVIEW' \
HM_NATIVE_RELAY_ORIGIN='https://YOUR-CONFIGURED-RELAY' \
HM_NATIVE_COMPANION_AGENT_DID='did:web:YOUR-IDENTITY-HOST:agents:EXISTING-AGENT' \
HM_NATIVE_COMPANION_AGENT_POD_URL='https://YOUR-PUBLIC-POD-HOST/EXISTING-AGENT-HOME/' \
node tools/manual/native-player-live.mjs
```

Independently verify that DID and canonical public pod using the root's current
authenticated native session and advertised identity metadata before invocation.
The signed `subject_pod_url` must equal the configured public URL exactly; an
internal storage address returned elsewhere is not an instruction to rewrite a
signed envelope. These values are public identifiers, never a connector bearer,
cookie, private key or new registration. Invalid companion configuration is
refused before importing a browser.

## Ports

`installNativeCompanionOwnerQaSession(config)` is a self-contained browser
installer suitable for Playwright `page.evaluate`. Supply:

```js
{
  enabled: true, run, owner, gameOrigin, relayOrigin,
  agentDid, agentPodUrl,
}
```

`owner` is the existing runner's verified QA owner, including canonical
`accountId`, `subjectDid` and public `podUrl`. The helper re-verifies its fresh
game session and canonical native binding. Native credentials come from the
shipped encrypted browser access cache; none are returned to Node. The existing
agent DID/public home pod must come from the root's independently authenticated
native session (`get_pod_status`/advertised identity metadata), **not a new
registration or a caller-selected foreign pod**.

The retained browser object is `window.__hmNativeCompanionQa`, with these ports:

| Port | Behavior |
| --- | --- |
| `enterAndSpawn()` | Actual same-owner WSS hello, synthetic QA realm/profile presence, game enter and stable-ID `spawnCompanion`; derive body/account/room from real server replies/snapshot. Refuse another room player. |
| `publish()` | Publish one explicit **public** owner grant: existing native agent, exact game application/audience/room/body, pet role, observe+move, rate 5/s, 15 minutes. Retain UUID/operation and confirm uncertainty rather than recreate. |
| `readback()` | Actual owner-side SDK current-head/descriptor/authorship/digest/public readback; return only the public relationship and receipt. |
| `register()` | Resolve the described native action and send only `{grantId,graphIri}` with browser-held fresh game session. Require durable own-game reference receipt. |
| `localRevoke()` | Resolve native revoke action, send only `{grantId}`, require durable game-owned UUID revocation. |
| `ownerPodRevoke()` | After local revoke, owner-pod CAS `revoked:true`, confirmation and public native readback. |
| `status()` | Fixed stage, booleans/counts and fixed error codes. No credentials, raw errors or private records. |
| `close()` | Close its grant client/cache handle and lightweight WebSocket. A close does not revoke or delete durable records. |

The helper retains the same grant client, UUID, public scope and operation ID
across failed publication/revocation acknowledgement. A definitive unknown
publication is read back before any decision; it is never silently republished.
Owner game HTTP has a bounded deadline and retains a backend permit if an
upstream ignores abort. A different run/owner/pod/account/relay/agent scope cannot
replace the retained helper. There is no `register_agent`, passkey ceremony,
profile save or recovery operation in this helper.

`createNativeCompanionLiveQa(options)` is the Node orchestration port:

```js
const qa = createNativeCompanionLiveQa({
  enabled: true, gameOrigin, relayOrigin, expectedOwner: owner,
  agentDid, agentPodUrl, ownerPort, signNativeRequest, request,
  onStage: name => { /* retain/report fixed name only */ },
});
await qa.remaining();
```

The constructor requires the opt-in and complete ports but performs no stage.
`next()`, `remaining()`, `status()`, `restartAdmission()` and `close()` operate on
a retained fixed stage cursor. Node holds only public grant/proof data and an
ephemeral Ed25519 private key in RAM. No native bearer, human private key,
passkey or recovery object is read by this module. `status()` is safe for the
existing fixed diagnostic output; never print internal closures or HTTP bodies.

The exact `nativeAgents` manifest, same-origin JSON-LD action targets, application,
audience, published native capability status and short lease are checked before
owner mutation. Every agent action uses the discovered endpoint and host-derived
action/room/body signing contract. No historical label-grant/bearer fallback is
used. Completion must return a matching relay-mediated native receipt and a
durable game-owned authority receipt.

The scenario checks valid local movement, redacted observation and fresh native
renewal. It requires explicit refusals for a forged signed action, ungranted
scope, wrong room, stale command timestamp, replay and local revocation. The
revoked UUID challenge must return **403 `native_grant_unavailable`**, not an
unrelated outage or rate limit. The narrow authority preflight included with
this harness makes that distinction without a native read.

Fast command/renewal proof sequences share a counter. On an uncertain native
completion or command, retries do not replay the consumed admission ceremony.
An explicit `restartAdmission()` is permitted only at the proof/command stage:
it resets the ephemeral challenge/key/session while retaining the original
owner, public grant, body, scope and stable domain command ID. This cannot run
after revocation. The fixed private-profile/registration stages are not replayed.

## Signing without exporting the plugin credential

`createNativeCompanionSigningBroker` takes
`{enabled:true,agentDid,agentPodUrl,writePublicRequest}` and returns
`{signNativeRequest,acceptLine,status,close}`. It owns **no stdin reader**. The
root runner must route one existing readline stream: pass lines to
`broker.acceptLine(line)` first, then route non-protocol lines to its retained
manual command loop. Install that routing before running the companion stage;
do not create a competing readline consumer after the stage starts waiting.

The broker emits only this public request:

```json
{
  "kind": "native_companion_sign_request",
  "requestId": "public-request-uuid",
  "tool": "interego.sign_request",
  "args": {"payload": {"purpose": "urn:interego:gaming:agent-admission:v1", "...": "exact public challenge fields"}}
}
```

The root uses its **existing authenticated** Interego connector to invoke
`sign_request({payload: args.payload})`. Extract only `_signed_payload` and
`_signature` from the returned public native envelope and feed one JSON line:

```json
{"kind":"native_companion_signed_envelope","requestId":"the-same-public-request-uuid","envelope":{"_signed_payload":"exact native signed JSON bytes","_signature":"0x..."}}
```

Never copy a connector bearer, cookie, key, whole tool result, private profile or
recovery into stdin. The broker validates the exact original challenge, game,
audience, grant digest, ephemeral **public** key, authenticated expected agent,
public home pod and canonical fresh timestamp. It accepts no extra fields and
does not print rejected input. Actual cryptographic signer/delegation validation
belongs to the native game admission adapter; the broker is not a replacement.
The one-use challenge expires after its advertised bound. Signing timeout is a
failed stage, not permission to register a replacement identity or widen scope.

## Runner integration

The root runner calls `nativeCompanionRunnerConfig(process.env)` after its main
guard. Its `nativeCompanionOptIn` returns false unless `HM_NATIVE_COMPANION_LIVE_TEST=1`; when selected it
also requires `HM_NATIVE_LIVE_TEST=1`, separate exact HTTPS game/relay origins and
no DEBUG/PWDEBUG/PW_TEST_TRACE/NODE_DEBUG flags. The root must separately confirm
that these are the intended dedicated preview/game pod. The module does not
infer deployment isolation from a hostname.

After all ten private stages and their recovery/privacy invariants pass, the
runner installs the helper into the single retained recovered page and creates
thin ports. It does not create a third full game page:

```js
await fresh.evaluate(installNativeCompanionOwnerQaSession, {
  enabled: true, run, owner, gameOrigin, relayOrigin, agentDid, agentPodUrl,
});
const ownerPort = Object.fromEntries([
  'enterAndSpawn', 'publish', 'readback', 'register', 'localRevoke', 'ownerPodRevoke',
].map(method => [method, () => fresh.evaluate(method =>
  window.__hmNativeCompanionQa[method](), method)]));
```

For an executor whose browser already has the verified proxy/CA setup, the
optional serialized `nativeCompanionBrowserRequest` keeps public agent HTTP on
that network without copying native browser credentials into Node:

```js
const request = async (url, init) => {
  const result = await fresh.evaluate(nativeCompanionBrowserRequest, {
    url,
    init: {method: init.method, headers: init.headers, body: init.body,
      credentials: 'omit', redirect: 'error', cache: 'no-store'},
  });
  return {...result, json: async () => result.value};
};
```

That helper restricts exact same-origin HTTPS, JSON GET/POST, no URL query/fragment,
no Authorization header, no cookies, no known token/private-key body fields,
bounded time and bounded response size. Only public native envelopes, public
keys and local command signatures cross into the page; the Ed25519 private key
stays Node-side. Default Node `fetch` is available if the executor's Node network
already works; it does not inherit Chromium proxy configuration automatically.

The single stdin router is installed before the automatic plan starts in
companion mode. Protocol envelopes are routed before command concurrency checks,
including while a manual continuation is waiting for the signature. The router
accepts only the fixed commands below; it never evaluates or echoes input.

- `status` / `diagnose`: bounded fixed-state diagnostics, including the Node
  companion cursor, signing-pending flag and browser grant-pending booleans.
- `retry`: retry only the failed retained stage. Successful private stages and
  owner registration are never replayed.
- `continue`: run the failed stage and remaining private/companion stages.
- `oauth-retry-same-owner`: during a private OAuth stage only, explicitly retry
  a definitively failed pre-claim callback with the original retained resident
  passkey. It cannot register another identity or replay a consumed claim.
- `companion-restart-admission`: explicitly discard an expired/uncertain
  ephemeral admission only at its allowed proof/command stage, preserving the
  owner, public grant UUID and body. Then use `continue` for a new challenge.
- `finish`: close the retained session. EOF has the same cleanup meaning.

Owner diagnostics include only fixed native error codes and bounded native
pending counts. `HM_NATIVE_COMPANION_DIAGNOSTIC_PUBLIC_REFERENCE=1` additionally
prints the retained public grant UUID/graph reference after the explicit public
publication attempt. It never prints an owner identity, credential, private
record or arbitrary native error. This option is off by default.

On failure with `HM_NATIVE_RETAIN_FAILED_SESSION=1`, the page/client/QA/broker
instances remain in RAM for those commands. A complete-suite PASS requires the
private checks and the selected companion scenario to finish. On explicit
finish, close the broker,
close Node QA, call the browser helper's `close()`, then perform the original
runner's cache/context cleanup. Do not close and recreate the grant client on an
uncertain write. Do not attach arbitrary CDP or inject into an unknown process.

## Evidence and limits

No live invocation was made while implementing this harness or its wiring. Offline tests run
the real game authority, native proof adapter, Ed25519 verifier and fixture CAS/
native ports; `INTEREGO_SDK_TEST_ROOT` additionally enables real reviewed native
secp256k1 signing/recovery. Browser-module serialization is checked in an offline
Chromium route fixture. Broker tests use structural envelope signatures because
the broker intentionally leaves cryptographic admission to the game adapter.

```sh
INTEREGO_SDK_TEST_ROOT=/ABSOLUTE/REVIEWED/INTEREGO \
HM_PLAYWRIGHT_MODULE=/ABSOLUTE/playwright/index.mjs \
node --test tools/manual/native-companion-*.test.mjs
```

The advertised **10-second lease is control-plane evidence freshness**, not player
ping, frame time or a multiplayer performance measurement. Fast commands use
local Ed25519 and cached admitted native evidence. Game-owned strict commits or
progressive checkpoints remain a separate persistence path. Only if a real
proof-read counter is explicitly advertised and its read port is supplied does
the harness compare counters around a fast command; otherwise it reports the
counter as unavailable and makes no measured zero-read claim. Do not invent a
metrics endpoint. Public REST native admission remains the existing bounded
pilot (60 requests/minute/IP); cg2 is not silently treated as relay OAuth.

The public grant/revocation history, companion body, labelled QA presence and
game-owned admission/revocation receipts remain in native pods. No deletion of
history or revocation of the existing root agent's native identity is attempted.
The scope is observe/move on one synthetic owned companion, with no attacks,
rewards, team migration, learning delivery or modification of other players.
