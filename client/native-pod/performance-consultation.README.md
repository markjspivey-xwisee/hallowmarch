# Private performance consultation

`performance-consultation.mjs` composes the existing `createNativePodClient` encryption, native identity checks, signed readback and compare-and-swap updates. Its stable encrypted named graph is an owner index and bounded journal. Neither observation bodies nor consent records go through a Hallowmarch game endpoint, database, public graph, public owner-agent grant, or local-storage record primary. Browser key custody and recovery reuse the existing native client.

Construct `createOwnerPerformanceConsultation({ binding, credential, relayUrl, sessionId })` from the current verified native owner connection. Use a random session identifier distinct from all bearer credentials. `connect()` and `read()` are read-only and never create an encryption key or consent. A missing existing key requires the ordinary native profile recovery flow; this module cannot replace it.

The journal represents exactly `binding.subjectDid`. The relay client verifies that DID against its authenticated own pod. It does not substitute the OAuth signing delegate for the owner, accept a performer selector, or let a player write an agent's personal performance record. An agent uses its own authenticated connection and pod. `performerKind` classifies the self-attributed observation; the field never grants authority.

## Consent and delivery

Every consent scope includes all of the following: owner, application, current session, selected task, purpose, exact HTTPS recipient, and an expiry of at most fifteen minutes. The two purposes are:

- `retain-observations`, whose recipient must be the authenticated owner's pod.
- `request-consultation`, whose recipient must be the concrete discovered Foxxi action target.

Call `grantConsent({ accepted: true, purpose, recipient, taskId, lifetimeMs })` only for an explicit performer choice. A native OAuth grant, public gameplay relationship, resource consultation, or prior session permission is insufficient. `authorize({ purpose, recipient, taskId })` returns a consent token. After signing the exact previewed request, the service adapter must call `assertAuthorized(token)` immediately before transport. This rereads the current encrypted native index and rejects expiry, withdrawal, changed consent, wrong task, different subject/session and uncertain publication.

`revokeConsent({ purpose, recipient, taskId })` blocks this open connection immediately, including a queued capture awaiting key registration. It then confirms any outstanding native operation before writing the withdrawal with the current native head. A failed withdrawal stays locally blocked. Other connections observe a withdrawal after its native publication is confirmed; pending publication is not described as cross-device revocation. Starting a new consultation session never restores another session's permission.

Native initial named-graph creation has no atomic compare-with-absence primitive. The underlying client preflights absence and refuses forked readback. Uncertain writes block new writes and delivery until `retry()` confirms the original operation. The journal never silently creates a second graph or overwrites an unread competing head. On a native conflict, reopen the current owner record before making a new explicit choice. Existing evidence is preserved when the bounded journal is full.

## Honest task evidence

`appendObservation({ task, performerKind, evidence })` requires current task-scoped retention consent. Task fields are `id`, `desiredResult`, `observedResult`, `workContext` and optional bounded `constraints`. Desired/current result text is a performer report. Evidence entries are `{ kind: 'owner-browser-observation', performerDid, at, metrics }`, where the DID must equal the authenticated owner and measurements must be bounded finite nonnegative numbers. These are observations of the actual open game, not signed authoritative event-log proofs. Do not supply made-up measurements, achievements, other players' state, inventory, chat, credentials or hidden state. Changing a goal or work context requires a new task identity and consent.

`appendConsultation({ observationId, service: { action, target }, response })` retains the actual bounded service response in this owner pod. It requires retention consent, references an existing self-attributed observation, and labels the response `service-response-unvalidated-effect`. The Foxxi adapter separately enforces network consent and its signed subject-proof contract. No learner registration or remote `private_evidence` is needed to retain the returned unretained plan here.

Record a later real observation of the same task, then call `appendEvaluation({ consultationId, observationId, playerReport })`. This retains the performer report and actual before/after differences for matching measured values. It cannot create a success score, infer causation, assert learning or mastery, publish xAPI statements, enroll a learner or issue a credential. All records retain `competencyStatus: 'not-assessed'`. Delayed or unseen transfer testing requires additional authentic observations and evaluation; receiving a plan does not establish an effect.

`read()` returns cloned `{ schema, ownerDid, applicationId, consents, observations, consultations, evaluations }` snapshots. Append methods return `{ saved, reference, observation|consultation|evaluation }` only after verified native readback. `status()` reports key presence, connection/pending state and counts. `close()` clears the open private index and rejects late asynchronous results.

Run the focused checks with:

```sh
node --test client/native-pod/performance-consultation.test.mjs server/gaming/player-browser-assets.test.mjs
```

The tests use synthetic isolated native ports, perform no account or consent changes, and cover task/subject/session/recipient boundaries, late withdrawal, expiry, pending acknowledgements, native CAS conflicts, recovery-key absence, agent self-attribution, and actual before/after comparisons.
