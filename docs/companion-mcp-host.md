# Use companion tools in an external agent host

`tools/agents/world-agent-mcp.mjs` is a standard stdio MCP server for the existing
March. It wraps the reviewed `client/world-agent-client.mjs` without adding a
provider SDK or a game-control bearer. Node 22 or newer is required. The tools
control the owner's selected separate party companion or owned animal. They
cannot select or possess the human character.

This is a local tool-process adapter for hosts that support stdio MCP, such as a
configured desktop or self-hosted agent runtime. A ChatGPT cloud connector needs
a separately hosted MCP bridge; this executable does not create that bridge or
claim that every LLM provider has been tested.

## Configure the trusted host once

1. Give the agent host its own current native Interego signing capability. Reuse
   its existing connector or the [agent-owned native session adapter](../client/native-pod/agent-own-session.README.md).
   Independent agent performance records require the latter's distinct owner
   identity and pod; a player's surface delegate is not a separate performer.
2. In the ordinary game, sign in, enter your character and open **Players → Your
   companion**. Add a companion, open **Connect your AI agent · host setup** and
   grant limited companion access to that host's verified agent DID. Copy the
   resulting **Agent connection details** JSON to a local public connection file.
   These IDs are public references, not credentials. Pin its game origin and
   service DID against the game's published service identity.
3. Write a reviewed local signer module that delegates to the host's existing
   native signing capability. It exports the callback used below. It
   must unwrap the connector's actual result and return the exact two-field
   native envelope unchanged. The game client verifies the signed challenge,
   identity, pod and timestamp; the game independently checks native delegation.

```js
// /absolute/path/reviewed-native-signer.mjs
// Import YOUR host's already authenticated native connector here. This is a
// host capability, never model text or a key/token copied from the player.
import { nativeConnector } from './your-existing-native-host.mjs';

export async function sign_request({ payload }) {
  const result = await nativeConnector.sign_request({ payload });
  return nativeConnector.unwrapSignedRequest(result);
}
```

If the host uses `createAgentOwnSession`, return
`await own.signRequest({ payload })` directly instead. That adapter already
validates and unwraps the native envelope. Keep its original wallet and durable
encryption-key storage in the host's existing vault. This executable neither
creates nor receives wallet secrets, owner game tokens or native bearer tokens.
The signer module is trusted local code and must keep stdout free of logs and
secrets because stdout carries MCP messages.

Configure the LLM runtime's MCP process settings with actual absolute paths:

```json
{
  "mcpServers": {
    "hallowmarch-companion": {
      "command": "node",
      "args": [
        "/absolute/path/hallowmarch/tools/agents/world-agent-mcp.mjs",
        "--connection",
        "/absolute/path/public-companion-connection.json",
        "--signer-module",
        "/absolute/path/reviewed-native-signer.mjs"
      ]
    }
  }
}
```

The public file's `module` URL is checked against the pinned game origin but
never dynamically executed. Only the operator-selected local signer module is
imported. The model cannot change the module, game origin, actor DID, grant,
room or companion using tool arguments. Changing the selected relationship
requires updating the public file and restarting the tool process.

## Play together

Resume companion control and close the game's Players panel. Keep the owner
game open, focused, connected and unpaused. The agent can then call:

| Tool | Input | Result |
| --- | --- | --- |
| `march_connect` | `{}` | Fresh native admission to the pinned companion |
| `march_observe` | `{}` | Current public companion pose and nearby hostiles |
| `march_move` | `{"dx":1,"dz":0,"durationMs":200}` | One bounded ordinary movement input |
| `march_attack` | `{"targetId":"actual ID from observe"}` | One bounded ordinary attack input |
| `march_renew` | `{}` | Fresh native grant/delegation check |
| `march_status` | `{}` | Public local connection status |
| `march_disconnect` | `{}` | Local connection closed; ephemeral key reference dropped; optional performance support stopped |

The model chooses its own next input from a fresh observation. There is no
automatic gameplay loop. Calls share the client's ordered proof sequence, and
near-expiry inputs renew first. A command reply means the owner page applied
ordinary input; it does not prove damage, loot, learning or competency. Private
character state and inventory remain outside these tools.

If a tool reports `uncertain: true`, a response may have been lost after input
was applied. Explicitly reconnect, observe current state and choose the next
input; never automatically resend the previous move or attack. Pause stops
control immediately in the game. Revoke confirms the durable local stop and
the owner's separate pod revocation. Closing this MCP process only drops its
local key and does not itself publish a pod revocation.

## Add the agent's own performance support

The same tool process can optionally record the agent's actual tool activity,
share its own xAPI observations and return Foxxi coaching to its model. This
uses the agent's separate native owner and pod. The human's game record and
consultation remain separate, and gameplay access grants none of these choices.
The default signer-only setup above still exposes just the seven gameplay tools.

In the reviewed signer module, export `performance` alongside `sign_request`:

```js
import { createAgentGameplayPerformance } from '/absolute/path/hallowmarch/client/native-pod/agent-gameplay-performance.mjs';
import { own, keyStorage, connection, hostPolicyApproves } from './your-existing-native-host.mjs';

// `own` is this agent's already connected createAgentOwnSession instance.
// Its existing native encryption key was explicitly initialized or recovered
// through own.createPodProfile({ keyStorage }); keyStorage is the host's vault.
export const sign_request = request => own.signRequest(request);
export const performance = createAgentGameplayPerformance({
  ownSession: own,
  keyStorage,
  connection, // the same pinned public companion connection file
  authorizeSession: async preview => hostPolicyApproves(preview),
});
```

`authorizeSession` is trusted host policy, outside model-controlled tool
arguments. It receives the exact agent owner, signing DID, selected body, room,
grant, game origin, discovered recipients and task references for a fifteen-minute
session (`lifetimeMs: 900000`). Approval covers the fixed purposes
`retain-observations`, `record-gameplay-activity` and `request-consultation` at
those destinations. It must return `true` only when the host authorizes that
specific session's private retention, activity sharing and coach requests. A
model call to Start does not itself grant permission. Keep the original wallet
and durable key storage; this path never creates a replacement encryption key.

With that export, the process additionally exposes:

| Tool | Input | Result |
| --- | --- | --- |
| `march_performance_start` | `{}` | After gameplay connects, discover exact recipients and apply the host's session policy |
| `march_performance_status` | `{}` | Attempt a bounded flush, then show captured and durable counts, gaps and pending operations |
| `march_performance_stop` | `{}` | Immediately fence local continuations and close the performance ports |
| `march_coach` | `{}` | Request advice from the current actual observations and return the service reply to the model |
| `march_performance_reconcile` | `{"operation":"private-save"}` | Confirm the original uncertain private save |
| `march_performance_reconcile` | `{"operation":"activity-read"}` | Read back the exact outstanding xAPI statement IDs |
| `march_performance_reconcile` | `{"operation":"activity-close"}` | Close an unknown batch and discard unsent detail as an explicit gap; resume future capture export |
| `march_performance_reconcile` | `{"operation":"consultation-close"}` | Close an unknown coach request without resending it |

During an active session, successful gameplay replies include independent
performance status, including capture failures. A performance failure does not
turn an already applied move or attack into a failed input to replay. Movement,
attack, observation and gameplay disconnect replies never wait for native
performance storage or delivery. Capture updates bounded in-memory counts and
the newest public pose immediately.

The host groups actual accepted inputs by action in five-second windows. It
exports `agent.command-accepted` summary events with object kind
`agent-command-summary`, the actual input count in `result.quantity`, and the
original last-acknowledgment timestamp. Each summary records that ordinary input was
applied. A summary statement is not one input, and neither it nor a public pose
establishes damage, a kill, task completion, learning or competency.
The coach reply goes directly to the calling model as a tool result. It is not
posted to the player's room chat.
If retaining an actual reply is uncertain, the tool still returns that reply
with `retentionStatus: "unconfirmed"` and its pending-save status. Explicit
consultation closure can recover a known reply without asking Foxxi again;
an expired baseline is reported as unavailable for journal retention.

The agent's deterministic encrypted checkpoint retains its bounded activity and
delivery state; its own consultation journal retains consent and advice. Both
use native compare-and-swap updates. The host confirms the exact private pending
marker before external xAPI delivery. An uncertain save, delivery or consultation
blocks that operation's replacement while in-memory input totals continue to
update. Reconciliation never resends activity or coaching. An explicit activity
close records uncertainty rather than a receipt, discards the remaining unsent
detail as an export gap, and resumes export for future inputs only. No new
profile or identity bypasses a pending operation.

Input totals continue throughout the authorized fifteen-minute session; there
is no per-session command-count cutoff. Pose sampling occurs at most once every
five seconds within the same owner-page session. A new owner page starts a new
pose baseline. Coach requests are limited to six, at least two minutes apart.

One unreferenced timer attempts a flush every thirty seconds while enabled.
The status tool and coach also attempt a flush. Each thirty-second window
permits at most three batches of twenty summary statements. If no delivery
occurs, a flush can confirm one private count-state save in that window. Native
storage and service failures remain visible; a timer never resends an unknown
batch. The host adapter's `status()` is a synchronous local read, while its
`flush()` is asynchronous and performs this bounded work.

The combined buffer holds at most 64 action windows and queued summary events.
If it fills, `exportPaused` becomes true and `exportGapInputs` counts inputs
whose detail cannot be exported. Local cumulative input totals continue to
update. The agent's state retains its newest bounded pose and activity working
set; its journal and the xAPI recipient retain at most a rolling hour of detail.
These are not complete gameplay histories.

Status distinguishes `cumulativeAcceptedInputs`, including the current process's
captured inputs, from `durableAcceptedInputs`, confirmed in the native pod.
`unsavedCapture` identifies a newer in-memory tail. `acknowledgedActivities`
counts confirmed summary statements, so it must not be read as an input count.
`bufferedDetails`, `exportPaused`, `exportGapInputs` and the pending flags expose
incomplete storage or export coverage.

Stop, gameplay disconnect and process closure fence local performance work,
including late replies. Stop also attempts to publish the withdrawal of this
session's consent; an unconfirmed withdrawal remains visible in status and is
not described as a confirmed remote revocation. An unsaved in-memory tail stays
visible after Stop and can be lost if the process exits before confirmation.
After authentication reconnect, reopen performance against the same durable
keys and a new session policy decision. A fresh Start preserves known cumulative
counts, records prior unsent detail as gaps and does not bulk-export that history.
Prior session consent does not resume.

Verification: `node --test client/world-agent-mcp.test.mjs` includes a real
spawned stdio handshake, protocol/tool schema and pinned-scope checks, and
uncertain-response privacy checks using explicit offline client fixtures.
These protocol tests are separate from actual live gameplay verification.
`node --test client/native-pod/agent-gameplay-performance.test.mjs` exercises the
composed own-session, consent journal, own-subject delivery and consultant using
explicit offline native and CAS fixtures, including lost replies, Stop and
recovery. It does not establish a particular LLM provider's deployed behavior.
