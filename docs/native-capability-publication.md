# Native capability publication from a bridge

`server/gaming/native-capability-publication.js` is a generic adapter over existing Interego affordances. It contains no game rules, content, ontology terms or fixed service targets. A caller supplies the public graph and the relay catalog discovered through its bootstrap descriptor.

```js
const publication = createNativeCapabilityPublication({
  identity: {
    owner, ownerWebId, agentDid, userId, podUrl,
    podAliases, // Returned by the verified identity ceremony, not inferred from matching paths.
  },
  credentialsProvider,
  catalogUrl,
  graphIri,
  graphContent,
  publicData: true,
});
// Run outside the real-time loop. No write is performed by the constructor.
const receipt = await publication.publish();
const status = publication.status();
```

`ownerWebId` must be the identity service's returned owner WebID. A canonical DID and a similarly named HTTPS profile are not treated as interchangeable. Each internal/public pod spelling must be explicitly supplied from verified deployment metadata. The adapter sends credentials only to HTTPS operation targets advertised by the pinned same-origin relay catalog. Redirects are refused. All request bodies, response sizes, timeouts and poll counts are bounded. The REST `/tool/…` operations use the service's own bearer; this adapter does not use the OAuth MCP transport.

The live catalog must advertise `invoke:get_current_head`, `invoke:publish_context` and `invoke:get_descriptor`, with compatible input schemas. All three are checked before a write. A changed target origin, duplicate control, missing input, refusal or malformed result stops the composition. An optional catalog digest can pin a previously verified catalog revision.

The adapter first resolves the exact graph on the explicit owner pod. An existing head must pass owner, signer, distribution, graph-scope and authorship checks before a revision can supersede it. An unchanged verified publication is reused. A revision carries the prior head's exact CID or descriptor URL as `if_match`, and its receipt must report that prior head through the advertised `previousHeadCid`/`previousHeadUrl` fields. Current relays can also supply a `precondition` block; the adapter accepts that equivalent representation and refuses an explicit failed precondition, without requiring the extra block from compatible relays.

The relay currently has no atomic compare-and-create-empty-head operation. Initial publication therefore sets `auto_supersede_prior:false`. A concurrent initializer can create a detectable fork; this adapter never silently supersedes a head it did not inspect, and a fork cannot return a verified receipt.

Publication is not confirmed from an acceptance response. Bounded `get_descriptor` polls must recover a public distribution, a verified descriptor-bound authorship attestation, the exact owner WebID and agent DID, and the expected graph digest. The graph region is selected by `@interego/solid.digestedGraphRegion`, then digested by `@interego/core.canonicalGraphDigest`; descriptor/default-graph triples cannot enter the comparison. These existing helpers also handle the relay's TriG rewrite. A final current-head read must identify the same sole descriptor.

Only `state:'verified'` exposes descriptor/graph URLs. Pending, refused, ambiguous and timeout outcomes expose no successful publication receipt. A later explicit `publish()` recovers by reading current durable state before considering another write. Calls coalesce within one adapter instance; there is no automatic publish retry after a transport failure or CAS conflict. The authorship authority is explicitly a relay attestation, not a signature made by a client-held key.

Run transport tests with `node --test server/gaming/native-capability-publication.test.mjs`. Set `INTEREGO_SDK_TEST_ROOT` to a built Interego checkout to additionally exercise the actual core/solid graph serialization and digest-scope path. The ordinary transport suite stubs those SDK boundaries and never claims to verify a real signature. No test publishes to a live pod.

## Bounded native compositions

`createNativeCapabilityComposition({ identity, credentialsProvider, catalogUrl, root, parts, publicData:true, ...sdkAndBounds })` takes `{graphIri,graphContent}` for each part and the root. It publishes and verifies one bounded part at a time, then publishes the root. The root must actually reference every part IRI, and all graph identities must be unique. The same verified owner and transport bounds apply throughout.

Use content-addressed/revision-specific part IRIs. Replacing a part behind a stable mutable IRI would also change what an older root resolves to, even if a later root update fails. New immutable part identities preserve the previous root's part set during an interrupted update.

`publish()` and `status()` return `{state,verified,completedParts,totalParts}`. The `root` receipt appears only after every part and the root are verified. A failed part prevents any root write. A failed root preserves the existing durable root; retry starts by re-reading each existing part and reuses verified content instead of publishing duplicates. The orchestrator never invents a separate blob-storage protocol or writes content outside the existing native publish affordance.
