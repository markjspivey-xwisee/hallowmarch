# Owner-published companion relationships

This is a reusable gaming vertical over `public-record.mjs`; Hallowmarch supplies its native service DID, exact public origin, authoritative room, and companion body. It does not define the game with a performance consulting vocabulary.

`createOwnerAgentGrants({binding,applicationId,audience,relayUrl,credential,...})` uses the already verified player's binding (`subjectDid`, `webId`, `podUrl`). The application ID is the native game service DID. The audience is the exact HTTPS game origin. `connect()` verifies the native owner connection. Native access credentials and keys never enter a game request.

```js
const grants = createOwnerAgentGrants({ binding, applicationId, audience, relayUrl, credential });
await grants.connect();
const result = await grants.publish({
  publicDisclosureAccepted: true,
  actor: nativeAgentDid,
  roomId,
  entityId: companionBodyId,
  role: 'pet',
  actions: ['observe', 'move', 'attack'],
  maxCommandsPerSecond: 10,
  lifetimeMs: 600_000,
});
// Send only result.reference to the game. It resolves and verifies the native
// current head itself. The publication receipt is public evidence, not access.
```

The UI must explicitly explain that the agent relationship and its limited game scope are public before setting `publicDisclosureAccepted: true`. A new grant requires that choice. A revocation is another version of the already public relationship; it keeps the same grant ID and graph, sets `revoked: true`, and uses native head CAS. A new authorization after revocation gets a new UUID. The primary is always the owner's pod. The game may retain the reference and independently verified admission receipt, never a substitute private save.

The payload conforms exactly to the shared immutable `NATIVE_OWNER_AGENT_GRANT_SCHEMA` (also exported as `OWNER_AGENT_GRANT_SCHEMA`). It contains no additional fields. Roles and actions are shared from the schema: teammate can observe/move/attack/claimLoot, pet can observe/move/attack, and coach can observe. Actions are explicit, unique and nonempty; rates are 1–20 commands per second; lifetime is 1 second to 1 hour. The initial native reader supports canonical `did:web:…:agents:…` identities. A user DID, wallet address, arbitrary local label or game legacy agent token cannot substitute for an agent identity.

Public graph names are `urn:graph:interego:gaming:owner-agent-grant:<UUIDv4>`. Each contains one `schema:DigitalDocument` with `dct:conformsTo <urn:interego:gaming:owner-agent-grant:v1>` and the exact JSON grant as `rdf:value` with `rdf:JSON` datatype. The SDK scoped region is both digested and parsed; triples elsewhere in the served document are never grant data.

Methods are `connect()`, `publish(input)`, `load({grantId,graphIri})`, `revoke({grantId,graphIri})`, `confirm(operationId)`, `status()`, and `close()`. Publication, revocation and confirmation return `{status,saved,reference,operationId?,receipt?}`. A receipt is returned only after confirmed public native readback. `load` additionally returns the validated public `grant`, native `head` and receipt for the owner's UI. Pending or uncertain writes return their original reference and operation ID and must be confirmed; they must not be republished. Native admission and renewal must refuse expired or revoked grants. Cross-pod revocation is bounded by the game's short native lease, not atomic or instantaneous across systems.

Integration must expose only the fixed assets `public-record.mjs`, `owner-agent-grant.mjs`, `owner-agent-grant-schema.mjs`, and `vendor/interego-public-browser.mjs` alongside the existing native browser bundle. Load this composition only when opening companion controls. It makes no game HTTP calls, changes no game source or server routes, creates no identities, and grants no pod-wide agent permissions. Authoritative body creation and native admission remain separate host operations.

Validation: `node --test client/native-pod/public-record.test.mjs client/native-pod/owner-agent-grant.test.mjs`; run the separate Chromium suite with `HM_PLAYWRIGHT_MODULE` and `HM_CHROMIUM_EXECUTABLE`. The native storage/proof reports are explicit fixtures; real SDK CID, RDF digest/parser, transport and Chromium execution are exercised. Live owner authorization and deployment still require integration verification.
