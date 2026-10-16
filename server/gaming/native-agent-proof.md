Native companion proof adapter
==============================

This isolated adapter proves a native agent's admission and binds a short realtime lease to a holder's Ed25519 key. It does not replace the existing `hmca_` routes until a host integrates it. It does not publish owner grants, implement native readers, persist authority receipts, or migrate teams. Those are explicit integration ports.

The owner relationship is primary in the player's pod. The game keeps its own admission receipt containing the exact owner descriptor, content digest, grant digest and admitted scope. An agent receives no access to the player's pod. Player OAuth tokens and private keys never enter this adapter.

Existing native contracts
-------------------------

The existing `@interego/core` `recoverMessageSigner` verifies the rev-196 wallet message `sha256:<SHA256 of exact _signed_payload UTF-8>`. A direct `did:ethr` agent proves its own wallet key. The native `sign_request` capability instead signs as the session-derived canonical `did:web` agent using the relay's delegation key. Its payload includes `agent_id`, `subject_pod_url` and `timestamp`, and preserves the challenge, audience, grant digest and session public key. This is explicitly **relay-mediated** proof, not independently held client-key proof.

Source contracts in the Interego repository:

- `packages/core/src/crypto/wallet.ts`: `recoverMessageSigner`, `makeWalletDelegationVerifier`.
- `deploy/mcp-relay/server.ts`: `handleSignRequest`, `handleVerifyAgent`, native `sign_request` and `verify_agent` capabilities.
- `deploy/identity/server.ts`: `buildDidDocument`; surface agents have identity-server-generated keys and point to their controller's pod.
- `integrations/application-runtime/client-signing-grant.ts`: independently signed subordinate Ed25519 grants, with exact actor/issuer/audience/action/contract/pod binding and live status reads.
- `integrations/application-runtime/client-grant-ledger.ts`: the existing convenience lifecycle enrolls a subordinate key as the **same** principal. Its issuer-equals-actor rule is not an owner-to-distinct-agent gaming grant.
- `deploy/mcp-relay/client-authorization.ts` and `client-signing-keys.ts`: real passkey/wallet/did:key client authorization and current credential registration. OAuth or a relay signature does not substitute for those client signatures.

The four pod registry scopes are storage scopes. Do not register an agent with `PublishOnly` to grant teammate or pet actions. A native registry chain authenticates an identity/delegation; it does not supply gaming permissions.

Owner publication payload
-------------------------

`NATIVE_OWNER_AGENT_GRANT_SCHEMA` exports the JSON Schema. The owner browser publishes this exact domain payload inside its native owner-pod record, with native owner-authenticated authorship and content binding:

```json
{
  "schema": "interego.gaming.owner-agent-grant/v1",
  "id": "urn:uuid:39885d5e-f008-4ce9-bf90-9430cd7d00cb",
  "issuer": "did:web:identity.example:users:player",
  "actor": "did:web:identity.example:agents:companion-player",
  "applicationId": "did:web:identity.example:users:game-service",
  "audience": "https://game.example",
  "roomId": "room-1",
  "entityId": "owned-body-1",
  "role": "pet",
  "actions": ["observe", "move"],
  "notBefore": "2026-10-16T12:00:00.000Z",
  "expiresAt": "2026-10-16T12:55:00.000Z",
  "maxCommandsPerSecond": 5,
  "revoked": false
}
```

No action is implicit. Teammates may explicitly receive `observe`, `move`, `attack`, `claimLoot`; pets exclude `claimLoot`; coaches allow `observe` only. Grants last at most one hour. Re-grants after revocation use a new UUID. The host must also confirm the issuer owns the room body and may grant the requested game actions. This adapter does not decide those game rules.

The owner's publication may expose only this relationship or encrypt it for an explicitly selected game recipient. Giving a game permission to read a particular grant is separate from giving it pod-write permission. A descriptor pointer alone proves neither record existence nor owner approval.

Required host composition
-------------------------

```js
const proof = createNativeAgentProofAdapter({
  audience: publicOrigin,
  applicationId: gameServiceDid,
  nativeCore: await import('@interego/core'),
  readOwnerGrantHead,
  resolveAgentProof,
  leaseMs: 10_000,
});
```

All three native ports are mandatory. Missing ports fail at construction; unavailable, stale, malformed or revoked native evidence refuses admission and renewal. There is no label or bearer fallback.

`readOwnerGrantHead({grantId, signal})` resolves a previously admitted owner relationship reference. It must:

1. Obtain the owner pod from the game's verified owner binding and relationship index, never from the request body.
2. Resolve the current unforked native head. Verify descriptor owner, native authorship, graph content binding and exact issuer-to-record relationship. Extract the grant from that verified content.
3. Check the game's current authority for the body and action scope, including its own revocation receipts.
4. Return `{grant, ownerPodUrl, descriptorUrl, graphIri, cid, contentDigest, observedAt}`. URLs are canonical public HTTPS; the concrete descriptor must be inside the owner pod. `contentDigest` is a verified 64-hex digest, optionally prefixed `sha256:` or the native `graph-nquads-sha256:`. `observedAt` is the server's millisecond time when current native authority was actually observed. Reusing cached evidence must retain its original observation time.

`resolveAgentProof({agentDid, signatureSigner, signal})` independently resolves the **current** native identity and proof anchor. It returns `{agentDid, podUrl, mode, signerDid, observedAt, expiresAt}`; times are milliseconds.

- For `independent-key`, the exact `did:ethr` agent equals the signature's recovered wallet. The resolver still establishes its native identity/pod relationship.
- For `relay-mediated`, the canonical agent is a `did:web` surface agent. The resolver validates current own-pod registration/delegation and a trusted native signing anchor. That anchor must equal the recovered signer. It must not use an anchor, key or arbitrary pod supplied by the caller.
- The signed `subject_pod_url` must equal the resolver's canonical public own-pod URL. The owner's gaming grant and the agent's own identity are separate relationships and may belong to different pods.

A public DID document containing server-generated keys does not establish that an external agent holds their private keys. Generic signature validity alone does not establish who owns a credential. Native readers must resolve the actual subject and trusted provenance. Federated endpoint discovery also requires HTTPS, explicit trust policy and guarded fetches; these are not provided by a caller-selected URI.

Admission and local commands
-----------------------------

1. The agent generates and retains an ephemeral Ed25519 private key. Send only `{kty:'OKP', crv:'Ed25519', x:<canonical base64url public key>}`.
2. `await proof.challenge({grantId, sessionPublicKeyJwk})` reads the current owner grant and returns `{challengeId, payload, expiresAt}`. Sign the exact returned payload using native `sign_request` or the agent's own wallet. The native envelope adds only `agent_id`, `subject_pod_url`, `timestamp`.
3. Sign `agentSessionPossessionMessage(payload)` with the ephemeral Ed25519 key, base64url-encode its 64-byte signature, then call `await proof.complete({challengeId,envelope,sessionSignature})`. The native envelope is `{_signed_payload,_signature}`; unsigned wrapper labels do not determine identity.
4. Completion consumes the challenge before asynchronous work, re-reads the current owner head and current agent identity, verifies both cryptographic proofs, then returns `{sessionId,expiresAt,identity,receipt}`. The receipt includes references, digests, scope and explicit proof mode. It contains no native bearer, private key or native envelope. The host must commit that admission into its own native authority before enabling the agent in the room.
5. For each command, the host reconstructs `request = {sequence,at,method,path,action,roomId,entityId,body}` from its actual transport and parsed command. Never take a signed action label as a substitute for deriving the action from the actual command. The agent signs `agentCommandMessage(sessionId,request)` with its ephemeral key. `proof.authorize({sessionId,request,signature})` verifies locally and returns admitted identity, scope and receipt reference. The host still validates game rules and commits according to its realtime/durable policy.

Successful commands use exact consecutive sequences, starting at 1. Signatures bind method, path, action, room, body, sequence and timestamp; timestamps allow at most 5 seconds of drift. A command rejection consumes no sequence. Rate limits use a rolling server-time second. Local commands make no native reads.

Renewal and revocation
----------------------

Before the lease expires, the holder signs `agentRenewalMessage(sessionId,{sequence,at})` and calls `await proof.renew({sessionId,sequence,at,signature})`. Renewal and commands share the same sequence. Renewal rechecks the current owner head and native agent proof. Any renewal failure removes the session; it cannot use the previous lease after a failed check.

The default lease is **10 seconds**, bounded to 1–30 seconds by deployment policy. Expiry is anchored to the older verified native observation plus the lease, and cannot extend beyond the owner grant or native proof expiry. This is bounded propagation, not atomic revocation across two pods. Native outages stop renewal; expired leases stop commands. `proof.revoke(grantId)` immediately invalidates local sessions, pending and in-flight admissions for that UUID. The host separately persists its game receipt and the owner updates the primary native relationship. A restart requires fresh admission, and the native readers must honor persisted revocation.

Pending challenges, sessions, native calls and local revocations are bounded. Timed-out native ports retain their concurrency permit until they actually settle, even if they ignore abort. `proof.close()` clears local leases and aborts native reads. No operation persists a native credential.

Validation boundary
-------------------

Tests use actual `@interego/core` secp256k1 signing/recovery and Node Ed25519 signatures. Native head/identity readers are synthetic trusted fixtures, explicitly not production integrations. The real native `sign_request` capability was checked for session-derived DID, public own-pod URL, challenge/audience/digest/key binding and relay-mediated provenance. No live owner grant, identity registration, game command or deployment was performed by this adapter work.
