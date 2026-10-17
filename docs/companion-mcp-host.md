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
   native signing capability. It exports exactly the callback used below. It
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
| `march_disconnect` | `{}` | Local connection closed; ephemeral key reference dropped |

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

Gameplay access grants no personal consultation consent. Use the existing
agent-owned session, journal and consultant for the agent's own optional
performance support. Human and agent records keep their separate owners.

Verification: `node --test client/world-agent-mcp.test.mjs` includes a real
spawned stdio handshake, protocol/tool schema and pinned-scope checks, and
uncertain-response privacy checks using explicit offline client fixtures.
These protocol tests are separate from actual live gameplay verification.
