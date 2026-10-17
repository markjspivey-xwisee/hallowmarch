# Bring an agent with its own native identity

`createAgentOwnSession` runs in the agent's trusted host. It composes the existing Interego wallet OAuth flow, native MCP transport, private consultation journal and Foxxi consultant. Hallowmarch does not mint or hold the agent wallet, receive its bearer, or store the agent's consultation records.

A player's ChatGPT/Claude surface DID usually still points to the player's pod. That connection cannot become a separate agent by changing a performer label. This adapter requires a distinct wallet already held by the agent host and verifies its credential-derived owner, pod and stable `interego-delegate` DID against authenticated native status. Passing the player's wallet or another session's status fails before consultation.

The pinned Interego revision is recorded in `server/gaming/interego-sdk.json`. Its existing wallet helper is exported from `applications/shared-workspace/desktop/src/auth.ts` as `signInWithWallet`; it implements native OAuth PKCE and SIWE. The core package exports `RelayMcpTransport` at `@interego/core/relay`, but does not currently export the wallet sign-in helper through a package subpath. Import/bundle that pinned native function in your host and pass it directly. This adapter does not copy its OAuth implementation. Hosts using Ed25519 instead already have `DidTokenMinter` in the pinned `applications/_shared/relay-agent/index.ts`; this wallet adapter does not substitute a wallet identity for that different credential.

```js
// The host owns these capabilities. None comes from the game or from model text.
import { signInWithWallet } from './pinned-interego/applications/shared-workspace/desktop/src/auth.ts';
import { createAgentOwnSession } from './agent-own-session.mjs';

const own = createAgentOwnSession({
  walletAddress: agentHost.walletAddress,
  signMessage: message => agentHost.signMessage(message),
  nativeSignInWithWallet: signInWithWallet,
  humanBinding: verifiedPlayerBinding, // public owner DID and canonical HTTPS pod
  relayUrl: verifiedRelayOrigin,
  identityOrigin: verifiedIdentityOrigin,
  redirectUri: agentHost.oauthCallbackUrl,
});
await own.connect();
const agentBinding = own.binding(); // public metadata; no bearer or private key
```

The helper calls the native function with its fixed `interego-delegate` surface, so the same wallet has the same identity across hosts. The independent wallet's owner principal is `users:u-eth-…`; its session signing delegate is `agents:interego-delegate-u-eth-…`. The former owns the agent's pod and is its consultation performer. The latter signs native requests with explicit relay provenance. The player's principal is neither.

No sign-in, wallet mint, key registration, consent or publication occurs on import or construction. Calling `connect()` performs native sign-in and can provision the separate wallet's own pod through the existing native flow. It must therefore run only for a host-authorized identity. Setup also verifies the agent's current signed delegation. If native bootstrap created only a live write-eligible registry entry, setup can issue its missing credential through the relay's advertised `register_agent { agent_id, pod_name, repair_only: true }` mode, then requires complete signed-chain readback. This mode never changes the authority registry, scope, keys or another principal. Revoked, narrowed and unrelated invalid authority is refused; an unsupported relay has no legacy repair fallback. A lost acknowledgement remains fenced through reconnect and is confirmed by reads. Native request signing rechecks current authority. No human add-device token is supplied. The host must keep its wallet and its durable encryption-key storage across sessions.

## Private consultation in the agent host

Use the agent's existing native encryption key/recovery workflow. `createPodProfile` and `createJournal` both require the host's durable `load/create` key-storage port and use exactly the same native owner scope. Opening either is read-only. A new key is created only by an explicit call to the native profile's `createKey()`; an existing key is restored through its native recovery methods. Missing recovery keys are never silently replaced.

```js
const keyStorage = agentHost.privateEncryptionKeyStorage;
const profile = own.createPodProfile({ keyStorage });
const keyStatus = await profile.connect();
// If needed, the host explicitly initializes or restores THIS agent's native
// encryption profile using profile.createKey()/restoreRecovery().
// Back up the native profile through its encrypted recovery workflow in the host vault.

const sessionId = crypto.randomUUID();
const journal = own.createJournal({ sessionId, keyStorage });
await journal.connect();
const consultant = own.createConsultant({ sessionId, journal });
await consultant.connect(); // verifies own identity and discovers current Foxxi contract
const preview = consultant.preparePlan({ task: actualAgentTask });
// Render/review preview and obtain the host's explicit task/recipient permission.
await journal.grantConsent({
  accepted: hostApprovedThisPreview,
  purpose: 'request-consultation', recipient: preview.recipient,
  taskId: preview.taskId, lifetimeMs: 15 * 60 * 1000,
});
const advice = await consultant.requestPlan(preview);
```

`requestPlan` rechecks native identity, the current Foxxi descriptor and current own-pod consent immediately before sending. It identifies the agent as the performer, preserves the actual service reply, and claims no learning or verified outcome. Retention of observations/results additionally requires the separate own-pod `retain-observations` consent documented in `performance-consultation.README.md`. Task measurements must come from the agent's actual observations; player-private information, credentials and invented performance evidence are not consultation inputs.

## Gameplay remains a separate grant

Use `own.agentDid` as the actor named in the player's existing native gameplay grant. Pass `request => own.signRequest(request)` as the `sign_request` port to the existing world-agent SDK. The adapter verifies its own current identity and the exact native signed envelope. It does not create a gameplay grant, grant broad access to the player's pod, or treat consultation consent as gameplay authority.

Call `own.reconnect()` to rerun the original host-held native sign-in flow after authentication expiry. Reconnection closes all old journal/consultant ports; reopen them against the same durable key storage with a new consultation session and explicit consent. `own.close()` suppresses late sign-in results and disables every child port. Neither method rotates or deletes the host's wallet/key material.

For actual companion tool activity, use the [optional trusted-host performance
composition](../../docs/companion-mcp-host.md#add-the-agents-own-performance-support).
Its MCP tools join actual observations and accepted-input acknowledgments to
this agent's own bounded checkpoint, journal and consultant, and return the
actual advice to the calling model. `own.createLearningDelivery(options)` supplies
the existing own-subject xAPI helper with this verified native binding and
transport; caller fields cannot replace its credential, owner or transport.
The caller must still provide exact confirmed private state persistence and
current-scope checks. The composed host supplies those fences and obtains its
separate fifteen-minute policy authorization before consent writes.

This adapter supplies the reusable host integration. ChatGPT/Claude/OpenClaw must actually run it in a trusted host capable of invoking the native signing callback. A plain connector session that only has a player's surface token cannot conjure a separate signer or access an external host's keystore.
