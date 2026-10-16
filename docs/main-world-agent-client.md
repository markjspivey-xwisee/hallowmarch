# Connect an agent to the existing March

The reusable module at `/world/agent-client.mjs` exports
`createWorldAgentClient`. It uses standard fetch and WebCrypto Ed25519, with no
package dependency, LLM-provider SDK, ambient credentials, or import-time I/O.
Node 22+ can run it in an agent's tool process; a trusted browser integration
can run it on the game's own HTTPS origin. The current server does not grant
cross-origin browser access. Pin the actual game origin and application DID
from its published service identity before connecting.

First the human signs into the ordinary 3D game, opens **Players → Agent
access**, chooses their existing character or animal, enters the agent's native
DID, and publishes the limited access in their own pod. They resume control and
close the panel. The public grant UUID, room and entity IDs describe this
relationship; they are not keys. The agent must already have its own native
identity and current delegation. This client does not register new identities.
Agent hosts that need their own native identity and private consulting can use
the [host-owned native session adapter](../client/native-pod/agent-own-session.README.md).
The host supplies its separate wallet and durable native encryption keystore;
the adapter verifies the agent's own pod and keeps player and agent records separate.
For a confirmed active grant, expand **Agent connection details** and copy its
public configuration to the agent's tool host. The panel supplies the actual
origin, game and agent DIDs, grant UUID, room, selected body, and module URL.

```js
// Import the reviewed module into your agent tool host. Browser hosts may use
// import('/world/agent-client.mjs'); Node hosts use the local .mjs file.
import { createWorldAgentClient } from './world-agent-client.mjs';

const march = createWorldAgentClient({
  origin: gameOrigin,             // exact HTTPS origin, no trailing slash
  applicationId: gameServiceDid, // independently pinned native game identity
  agentDid: myNativeAgentDid,
  sign_request: async ({ payload }) => {
    // Call YOUR bound native connector's sign_request({payload}). Unwrap the
    // connector's result to its exact two-field signed-request envelope.
    const result = await nativeConnector.sign_request({ payload });
    return unwrapNativeEnvelope(result); // {_signed_payload, _signature}
  },
});

await march.connect({ grantId, roomId, entityId });
const view = await march.observe();
// Your agent chooses a bounded tool input from this current public view.
const acknowledgement = await march.move({ dx: 1, dz: 0, durationMs: 200 });
// attack({targetId}) accepts an actual visible hostile target ID from observe().
// Each input must be inside the owner's granted actions and game domain rules.
march.close();
```

`unwrapNativeEnvelope` is the integration's adapter for the connector's actual
returned tool result, not another signer. Never supply an owner game token,
native private key, recovery material, or a copied credential. The connector
signs as the agent's own bound identity. The client validates the returned
envelope's exact challenge, identity, pod URL shape and timestamp; the game
independently verifies its native signature and current delegation.

Wrap `observe`, `move`, `attack`, `renew`, and `status` as tools in the player's
chosen LLM runtime. Keep this client object in that trusted tool process, where
its non-extractable ephemeral Ed25519 private key remains in memory. Send the
model only the public observation and bounded tool results. It does not need
the key, session signing material, or native envelope. No particular LLM
provider is required by this interface; provider adapters and all providers'
behavior have not been individually verified.

The client discovers the manifest and exact main-world action affordances,
checks the audience/application binding, and signs the actual discovered
HTTPS operation path. Admission completes one one-use challenge. Calls are
serialized through one shared command/observation/renewal sequence. An operation
near the end of its native lease renews first; no background loop renews unused
access. Invalid move/attack inputs are refused locally. Network uncertainty or
any remote refusal drops the local lease. There is no automatic resend: inspect
the current game state and explicitly reconnect with fresh admission if needed.
An error with `uncertain: true` leaves the command outcome unknown. A lost
response may follow an already applied input. Reconnecting does not make
reissuing that input safe: its deduplication ID belonged to the old session,
so the agent must decide its next action from a fresh observation. Never turn
an uncertain result into a fresh automatic move or attack.
`close()` aborts pending requests and drops the local key reference. It does not
publish a revocation in the owner's pod. The owner can pause immediately or
revoke through Agent access; short native leases bound remote revocation.

An accepted command returns `execution: "owner-page-input-applied"`. That means
the running owner page applied ordinary input. It is not verified damage,
loot, task completion, or learner achievement. The game must remain open,
focused, connected and unpaused; human input takes priority. Independent agent
avatars, offline/headless gameplay and private inventory mutations are not
supported by this client. Performance consulting and personal learning export
use their separate identity and consent controls.

Validation: `node --test client/world-agent-client.test.mjs`. Chromium
interoperability: set `HM_PLAYWRIGHT_MODULE` to the installed Playwright module
(and `HM_CHROMIUM_EXECUTABLE` if needed), then run
`node --test client/world-agent-client.browser.test.mjs`. The tests exercise
the actual authority implementation with explicit in-memory owner-pod/CAS/native
identity fixtures and real ephemeral Ed25519 signatures. They establish wire
compatibility and rejection behavior, not live-provider or deployed readiness.
