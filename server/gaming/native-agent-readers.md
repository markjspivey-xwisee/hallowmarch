Native public owner-grant and agent-proof readers
================================================

`createNativeAgentProofReaders` implements the two native read ports required by `createNativeAgentProofAdapter`. It follows the relay's actual public operations catalog and independently checks raw native signatures, descriptor CIDs, graph digests, owner bindings and direct delegation credentials with the Interego SDK.

```js
const readers = createNativeAgentProofReaders({
  nativeCore: await import('@interego/core'),
  nativeSolid: await import('@interego/solid'),
  operationsUrl: 'https://relay.interego.xwisee.com/.well-known/operations',
  identityOrigin: 'https://identity.interego.xwisee.com',
  storeBases: [
    'https://gate.interego.xwisee.com/',
    'http://css.railway.internal:3456/',
  ],
  relaySigningDid: independentlyPinnedRelaySigningDid,
  lookupOwnerGrant: async ({grantId}) => ({
    binding: verifiedOwnerBindingFromNativeLedger,
    graphIri: registeredOwnerGrantGraphIri,
  }),
});
await readers.ready;
const proof = createNativeAgentProofAdapter({
  audience, applicationId, nativeCore,
  readOwnerGrantHead: readers.readOwnerGrantHead,
  resolveAgentProof: readers.resolveAgentProof,
});
```

`lookupOwnerGrant` is a trusted host lookup. It must derive the owner binding and grant reference from the game's verified native participation relationship, never a caller's DID, arbitrary pod URL or claimed account. The reader checks the canonical user DID, WebID and pod mapping against the configured identity authority and store aliases. The signing DID is a public trust pin obtained from a trusted authenticated native relay observation; it is not adopted from the peer's supplied credential. Rotation requires an explicit pin update.

The production image builds and links the reviewed `@interego/core`, `@interego/solid` and `@interego/pgsl` packages at Interego `87ee71626c015af3c1e7b9dac5579eff6899e8c1`. The networking CI job builds the same pinned source and lockfile before running the actual proof tests. Local setup uses the same workspace install/build flags:

```sh
npm ci --prefix server
export INTEREGO_SDK_TEST_ROOT=/absolute/dedicated/interego-pinned
node tools/setup-native-sdk.mjs
node --test server/gaming/native-agent-readers.test.mjs
```

The setup command creates the dedicated checkout if absent, verifies the exact revision and lockfile, builds the actual packages, and links them into `server/node_modules`. It refuses another revision, modified reviewed source, or an existing link to a different SDK. An already built checkout can also be supplied through `INTEREGO_SDK_TEST_ROOT`, consistent with the other real-SDK tests. Missing native dependencies fail the proof suite; no mock or skip replaces native cryptography. The setup/test commands do not contact a live game or native pod or create identities.

Actual advertised public operations
----------------------------------

The live `/.well-known/operations` JSON-LD catalog advertises these three operations with `Authorization` required `false`. The reader obtains each target and input schema from that catalog; it does not construct a hidden endpoint.

| Operation | JSON request | Native response used |
|---|---|---|
| `get_current_head` | `{urn:graphIri,pod_url:trustedOwnerPod}` | `urn,podUrl,head:{descriptorUrl,cid},forked:false` |
| `get_descriptor` | `{url:currentDescriptorUrl}` | `url,turtle,graph:{content,encrypted:false},authorship` |
| `verify_agent` | `{agent_id:canonicalAgentDid,pod_url:agentOwnPod}` | Explicit subject pod, owner, agent, signed direct chain and signing anchors |

These public REST reads ignore an ordinary Bearer header in the audited source. No game or human credential is sent. A game `cg2` credential gains no extra authority on this public path. Peer encrypted/private payloads are intentionally unavailable; only the owner-selected public non-personal gaming relationship is accepted. Character records stay sealed.

The resolver follows the configured identity authority's canonical agent DID document. Its unique controller, storage, relay and registry services determine the agent's own native pod. It never derives ownership from a name suffix or a caller's pod. It then checks fresh raw registry and VC data, exact VC subject/pod/issuer/delegator, validity and scope consistency, real signature, and the pinned relay key. A positive relay trust label alone is insufficient. Initial support is direct owner-to-surface-agent chains of length one. Subdelegation and independent-wallet-to-native-pod mappings are explicitly unavailable.

The owner reader resolves the current unforked head, recomputes the descriptor CID, verifies the raw authorship proof and exact owner, identifies the SDK's signed named graph, recomputes its `graph-nquads-sha256` digest, and parses the grant only from that covered region. It verifies the publisher's current native delegation and rechecks the owner head before returning. A private graph, unknown proof owner, unsigned/default-graph addition, changed head or unavailable source refuses admission.

Owner publication format
------------------------

`ownerAgentGrantGraph({graphIri,grant})` serializes the domain payload. The graph subject is the exact registered graph IRI, typed `schema:DigitalDocument`, with `dct:conformsTo <urn:interego:gaming:owner-agent-grant:v1>` and one `rdf:value` JSON literal typed `rdf:JSON`. The literal contains the exact `NATIVE_OWNER_AGENT_GRANT_SCHEMA` payload. Publish with the owner's existing native public publication and signed authorship. Revocation supersedes the same graph using native head CAS and the same grant UUID with `revoked:true`; a later re-grant uses a new UUID.

Readers return the adapter's documented snapshots, preserving the original native observation time. Same-scope concurrent reads coalesce by owner/graph/grant or agent/pinned signer, with bounded maps and I/O. Completed authority is not cached by these readers. No native read occurs on the command path; only challenge/admission/renewal uses these ports. Observations are stamped before the control-plane read starts, so slow reads consume the lease rather than silently extending it.

Performance and transport limits
--------------------------------

The audited public `/tool/:name` limiter is **60 requests per minute per IP**. One complete owner/agent renewal uses several public REST calls plus direct public registry/VC reads. This is a bounded pilot path, not an MMO-scale control plane. Metadata discovery is cached for ten minutes; immutable descriptor/native serving-owner caches may last five minutes inside the relay. Current-head lookup refreshes the manifest and raw registry/credential reads are fresh. Returned descriptor bytes must still match the current head CID.

An alternative authenticated MCP path is advertised by protected-resource metadata as `urn:iep:action:mcp:invoke`. Actual `@interego/core/relay` exposes `RelayMcpTransport`, accepting `kind:'relay-oauth-bearer'`, and `callTool(name,args,{cache:false,signal})`. It avoids the REST tool limiter when the game holds its own genuine relay OAuth grant. In audited revisions, `/mcp` does **not** accept identity-server `cg2` tokens, and no `NativeMCPTransport` exists. Do not relabel `cg2`, forward a human grant, or register a game with pod-wide permission to bypass that contract. This change does not fabricate that missing transport.

Read-only live validation from this executor succeeded for the existing native agent's canonical DID document, public registry, signed VC and pinned relay anchor. One measured discovery took 6.30 seconds; two subsequent proof reads took 8.61 and 11.16 seconds. The second would correctly fail a 10-second observation-bound lease. These are native control-plane measurements from this executor, not player multiplayer ping or Railway game-runtime measurements. Deployment may choose a lease up to 30 seconds only with an explicit matching revocation bound and runtime measurement; old observations never gain fresh authority from reuse.

Primary contracts: Interego `deploy/mcp-relay/server.ts` public operations catalog, `handleGetCurrentHead`, `handleGetDescriptor`, `handleVerifyAgent`, REST limiter and `oauthDpopOrBearer`; `packages/solid/src/client.ts` descriptor/proof/covered-graph/registry/credential readers; `packages/core/src/model/delegation.ts`, `rdf/graph-digest.ts` and `crypto/wallet.ts`; `packages/core/src/relay/transport.ts` and OAuth provider verification.
