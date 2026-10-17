# Authorized existing-grant movement observation

This manual controller is a contingency for an ordinary game's slow renderer.
Use it only after the original QA runner has a **confirmed input ACK**, its
actual public pose stayed unchanged, the old input/proof expired, and the
operator explicitly authorizes a separate bounded controller for that same
existing grant. An uncertain original outcome is not permission to replay it.
This controller creates no identity, grant, save, record, simulation or avatar.

Prepare an explicit public JSON configuration, containing exactly:

```json
{
  "enabled": true,
  "origin": "https://ACTUAL-GAME-OR-PREVIEW-ORIGIN",
  "applicationId": "did:web:ACTUAL-GAME-IDENTITY",
  "agentDid": "did:web:ACTUAL-IDENTITY:agents:ACTUAL-CONNECTED-ACTOR",
  "agentPodUrl": "https://ACTUAL-POD/ACTUAL-OWNER/",
  "grantId": "urn:uuid:ACTUAL-EXISTING-GRANT-UUID",
  "roomId": "ACTUAL-QA-ROOM",
  "entityId": "ACTUAL-QA-BODY",
  "dx": 1,
  "dz": 0
}
```

Use the caller's already verified origin, service/actor DIDs, actor pod, grant,
room and body. Choose a permitted bounded direction. The placeholders are not
a runnable test case. No owner bearer, session ID, old command ID, private key
or native signed envelope belongs in the config file.

```sh
node tools/manual/world-agent-sdk-controller.mjs \
  --authorized-existing-grant --public-config /absolute/path/public-controller.json
```

Set `HM_PLAYWRIGHT_MODULE` to the installed Playwright module, optionally
`HM_CHROMIUM_EXECUTABLE`, and reuse the reviewed `nativeBrowserNetwork` opt-ins
for the executor's structured proxy and configured CA when required. There is
no blanket TLS bypass. The CLI opens a brand-new blank browser context at the
actual game origin, route-fulfills only its empty document, and uses that public
fetch port. It never boots the game or borrows the owner's browser session.
The existing SDK retains its own fresh ephemeral non-extractable Ed25519 key.

When stdout emits `native_companion_sign_request`, call the connected actor's
native `sign_request` with exactly `args`, then send the matching existing
broker protocol line on stdin:

```json
{"kind":"native_companion_signed_envelope","requestId":"ACTUAL-MATCHED-REQUEST-ID","envelope":{"_signed_payload":"ACTUAL-RETURNED-SIGNED-PAYLOAD","_signature":"ACTUAL-RETURNED-SIGNATURE"}}
```

The broker checks the actual actor, pod, timestamp and exact challenge binding.
Never print or save signed responses as a debugging transcript. `finish` or EOF
closes the controller. Closing does not revoke the owner's native grant; the
original QA owner remains responsible for its normal revocation stages.

After fresh SDK admission and a public observation, the controller sends exactly
eight distinct 500ms moves, with at least 400ms after each previous response.
It requires `observe` and `move` plus a grant rate of at least three per second;
the initial observation is also separated from input by 400ms. The official SDK
serializes signatures and renews its proof lease as needed. No automatic retry
or second admission is attempted. Every refusal or unknown outcome stops all
remaining inputs. These are new authorized operations, never an old command's
replay. The final observation reports only the selected body's before/after
XYZ and horizontal displacement. A zero remains zero. The ACK means owner-page
input applied; it establishes no combat or learning outcome, and a separate
peer must still confirm the actual movement in the original QA workflow.

Offline checks:
`node --test tools/manual/world-agent-sdk-controller.test.mjs` and
`node --check tools/manual/world-agent-sdk-controller.mjs`.
