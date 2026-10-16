# Native companion authority bridge

`createNativeAgentAuthority` composes the native proof adapter with a game-owned
`AuthoritativeRoom`. `createNativeAgentHttp` exposes its advertised HTTP actions.
The Hallowmarch deployment factory is `configuredNativeAgentHost`; all generic
modules receive the application identity, origin, account ports and domain room.

The owner first publishes a deliberately **public, nonpersonal** scoped grant
using `client/native-pod/owner-agent-grant.mjs`. The browser and server share the
same immutable schema module. Private character state stays in its separately
sealed owner-pod record. A gameplay grant does not authorize learning export.

## Host trust ports

`accounts.bindingForAccount(accountId)` returns only the confirmed native owner
ledger binding. `accounts.ownerForRequest(req)` authenticates the existing game
HMAC session, requires its current native proof to match that ledger, and returns
`{accountId,binding}`. A claimed DID or pod URL is never a trust input.

The bridge's `lookupOwnerGrant({grantId})` supplies the production native readers
with the game-owned reference and the current trusted owner binding. All native
owner-head/authorship and current agent delegation checks are performed by the
existing reader/proof adapters. Their native request signer is either an
independently proved wallet key or explicitly **relay-mediated** provenance.
Current public native readers support canonical relay-mediated agents, including
delegates that share the owner's pod. They do not pretend a `did:web` label has
an independently held agent key.

## Wire contract

The bootstrap manifest advertises `nativeAgents.{enabled,applicationId,audience,
affordances,leaseMs,nativePublication}`. Resolve actions from the advertised
JSON-LD document's `operations[]`, match exact `iep:action.@id`, validate POST and
the same origin of `hydra:target`, and use its schema references. Do not substitute
the historical label-grant UI when native agents are required.

| Action suffix | Input |
| --- | --- |
| `register` | `{grantId,graphIri}`; fresh native game Bearer and exact same Origin |
| `challenge` | `{grantId,sessionPublicKeyJwk}` |
| `complete` | `{challengeId,envelope,sessionSignature}` |
| `renew` | `{sessionId,sequence,at,signature}` |
| `command` | `{sessionId,sequence,at,signature,command}` |
| `observe` | `{sessionId,sequence,at,signature,roomId,entityId}` |
| `revoke` | `{grantId}`; fresh native game Bearer and exact same Origin |

Action IDs use `urn:interego:gaming:native-agent:<suffix>`. Responses are
`{ok:true,result}` or `{error:<safe-code>}`. A registration result contains
`reference:{grantId,graphIri,ownerPlayerId,ownerDid,registeredAt,revoked}` and
`authority:{roomId,version,durable:true}`. Registration stores only the pointer;
it does not admit an agent. The human must already own a body in the actual room.

Completion verifies the native signed challenge and possession of the bound
ephemeral Ed25519 key. It returns the proof adapter's session ID, expiry,
identity/provenance and native owner-reference receipt, plus a **durable** game
authority receipt. No agent command can run through this bridge before that
receipt is confirmed. Reconnecting sessions reuse the saved native relationship;
a restarted bridge safely rotates unrecoverable internal permits.

For commands, sign `agentCommandMessage(sessionId,request)` where the host derives
`request={sequence,at,method:'POST',path,action,roomId,entityId,body}` from the actual
HTTP action. `action=command.type`, `body={command}` for commands;
`action='observe'`, `body={roomId,entityId}` for observation. The command itself
must explicitly contain roomId, entityId, type and a stable commandId. Renewal
uses `agentRenewalMessage(sessionId,{sequence,at})`. Sequence starts at 1 and is
shared across commands/observations/renewals. Valid proofs consume their sequence
even when domain authority subsequently refuses an action. Domain commandId is
the separate retry/idempotency contract.

All fast commands verify Ed25519 locally. Native identity/grant reads happen only
at admission and renewal. The advertised zero command-time reads refer to that
control plane; ordinary game-owned strict commits or progressive checkpoints
still persist game state independently. Exact owner, grant digest, derived action, room, body, sequence,
expiry and shared per-grant rate are checked before ordinary game authority
checks movement, combat and body ownership. Queued commands recheck lease expiry
inside the room. Internal legacy-format permits remain private bridge memory;
their hashes and native reference/scope are persisted. Those permits alone cannot
authorize native grants through WebSocket, HTTP or direct room dispatch.

## Revocation and ownership

Owner `revoke` immediately invalidates local leases, then persists game-owned
UUID revocation. Success returns `{grantId,revoked:true,
ownerPodRevocation:'requires-owner-publication',authority:{...,durable:true}}`.
The owner separately performs and confirms their pod CAS with `revoked:true`.
Game-local revocation can be retried and survives restart even if an old owner
head is still readable. Re-grant uses a new UUID. Native remote revocation is
bounded by the **10 second** proof lease, anchored to the original native read
observation before I/O. Renewal failures close access. These seconds describe
control-plane freshness, not player ping or round-trip latency.

Human snapshots enumerate only their own `nativeReferences` (including pointers
not yet admitted) and `nativeCompanions` (verified receipts with revoked flag).
Native entries are excluded from legacy `grants`. No native access/refresh token,
human private key, signed envelope, personal save or agent ephemeral key is
retained in the game-owned state.

## Deployment and observed limits

Enable only with a native game room, `HM_NATIVE_AGENT_ENABLED=1` and an
independently verified `HM_NATIVE_AGENT_RELAY_SIGNER_DID`. The default reader
discovers the actual public operations catalog. Optional configured aliases are
`HM_NATIVE_AGENT_STORE_ALIASES` (JSON array); network requests still use the
configured HTTPS gate. Missing prerequisites fail closed. The combined player
and native-agent contract graph is submitted through the existing owned native
publisher; a verified publication status/readback remains required before
claiming it is durably discoverable.

This public REST path is a **bounded pilot**, not MMO-scale native admission:
relay REST is limited to 60 requests/minute/IP. The game's cg2 identity credential
is not accepted by the audited relay OAuth MCP middleware. A genuine game-owned
relay OAuth grant or a separately designed native service transport is needed
before claiming that alternative. No fictional endpoint, broad pod delegation or
forwarded human token is used here. Public native read latency must be measured
inside the serving game environment before choosing a different advertised lease.

Current capacity is 256 retained native UUID references per room, 256 proof
sessions and 8 active relationships per owner under the existing room policy.
Revoked UUID references are intentionally retained; future scale needs a native
historical reference index rather than silently forgetting revocation. This
bridge does not migrate teams or the browser-hosted main world into native room
authority, and does not establish a personal learning delivery path.

Tests use real native secp256k1 envelopes, real Ed25519 possession/command proofs,
actual game authority and fixture CAS/native read ports. They cover cross-owner
isolation, queued expiry, durable admission failure, reconnects, shared rate,
restart revocation, no command-time native reads and HTTP concurrency retention.
They are not evidence of a live game/owner-pod end-to-end deployment.
