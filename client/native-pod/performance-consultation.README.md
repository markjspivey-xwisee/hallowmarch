# Private performance consultation

`performance-consultation.mjs` composes the existing `createNativePodClient` encryption, native identity checks, signed readback and compare-and-swap updates. Its stable encrypted named graph is an owner index and bounded current working set. Immutable encrypted history pages retain the complete history. Neither observation bodies nor consent records go through a Hallowmarch game endpoint, database, public graph, public owner-agent grant, or local-storage record primary. Browser key custody and recovery reuse the existing native client.

Construct `createOwnerPerformanceConsultation({ binding, credential, relayUrl, sessionId })` from the current verified native owner connection. Use a random session identifier distinct from all bearer credentials. `connect()` and `read()` are read-only and never create an encryption key or consent. A missing existing key requires the ordinary native profile recovery flow; this module cannot replace it.

The journal represents exactly `binding.subjectDid`. The relay client verifies that DID against its authenticated own pod. It does not substitute the OAuth signing delegate for the owner, accept a performer selector, or let a player write an agent's personal performance record. An agent uses its own authenticated connection and pod. `performerKind` classifies the self-attributed observation; the field never grants authority.

## Consent and delivery

Every consent scope includes all of the following: owner, application, current session, selected task, purpose, exact HTTPS recipient, and an expiry of at most fifteen minutes. The two purposes are:

- `retain-observations`, whose recipient must be the authenticated owner's pod.
- `request-consultation`, whose recipient must be the concrete discovered Foxxi action target.

Call `grantConsent({ accepted: true, purpose, recipient, taskId, lifetimeMs })` only for an explicit performer choice. A native OAuth grant, public gameplay relationship, resource consultation, or prior session permission is insufficient. `authorize({ purpose, recipient, taskId })` returns a consent token. After signing the exact previewed request, the service adapter must call `assertAuthorized(token)` immediately before transport. This rereads the current encrypted native index and rejects expiry, withdrawal, changed consent, wrong task, different subject/session and uncertain publication.

`revokeConsent({ purpose, recipient, taskId })` blocks this open connection immediately, including a queued capture awaiting key registration. It then confirms any outstanding native operation before writing the withdrawal with the current native head. A failed withdrawal stays locally blocked. Other connections observe a withdrawal after its native publication is confirmed; pending publication is not described as cross-device revocation. Starting a new consultation session never restores another session's permission.

Native initial named-graph creation has no atomic compare-with-absence primitive. The underlying client preflights absence and refuses forked readback. Uncertain writes block new writes and delivery until `retry()` confirms the original operation. The journal never silently replaces its discovery graph or overwrites an unread competing head. On a native conflict, reopen the current owner record before making a new explicit choice.

## History and continued use

There is no lifetime limit of 24 consultations. When a draft passes sixteen records of one kind or 190 KiB, rotation runs within the current explicit append:

1. CAS the complete new draft into its existing native owner index and verify readback. This binds the new activity to the same current-consent head as an ordinary update, so a concurrent withdrawal cannot permit a new unguarded archive write.
2. Copy that already-confirmed complete draft to a fresh encrypted native history page and verify its readback. This snapshot includes all baseline, plan and evaluation relationships, including unfinished attempts, and the previous archive reference.
3. CAS the owner index to the append's small, dependency-complete working set and the new immutable page reference. The index holds one archive head, so index size does not grow with the lifetime page count.

Every page reference pins the graph IRI, native CID and descriptor URL. History reads reject a changed page, wrong owner/application, or a cyclic chain. Pages are never updated or deleted. Observations copied as dependencies retain their exact original IDs and bodies. The per-page hard bounds of 32 records per kind and 350 KiB are safety bounds, not lifetime record limits; the earlier rotation watermark leaves room for the next bounded append. Each full service response remains bounded at 32 KiB without truncation.

Lost acknowledgements at all three stages retain the original native operation and pending rotation. `retry()` confirms that exact operation and finishes its discovery relationship rather than creating duplicate pages or records. Once the complete draft was committed, confirmation after consent expiry only finishes indexing already-retained data. It cannot authorize another capture or Foxxi request. Local withdrawal still blocks sends immediately and completes a pending rotation before its own native withdrawal update. If another device changes the owner index during compaction, the module preserves that head and exposes the real unlinked page receipt as `error.archiveReference`; it does not overwrite the other device's state. The full new draft was already verified in the index before this maintenance began.

`read()` returns the current working set plus its `archiveHead`. It also supplies the latest archived plan and matching baseline when an observation-only working set would otherwise hide the last-plan entry point. This is not a flattened lifetime history list. `readArchive(reference)` returns `{ reference, record, next }`, with the next page reference for optional history paging; omitting the reference starts at the current archive head. These reads create no records and restore no prior session's consent. Appending a consultation or evaluation resolves its original baseline and plan from verified pages and copies only the needed dependencies into the current working set, so unfinished older tasks remain resumable. Historical lookup follows the private page chain; a separate searchable native history index is not implemented.

## Honest task evidence

`appendObservation({ task, performerKind, evidence })` requires current task-scoped retention consent. Task fields are `id`, `desiredResult`, `observedResult`, `workContext` and optional bounded `constraints`. Desired/current result text is a performer report. Evidence entries are `{ kind: 'owner-browser-observation', performerDid, at, metrics }`, where the DID must equal the authenticated owner and measurements must be bounded finite nonnegative numbers. These are observations of the actual open game, not signed authoritative event-log proofs. Do not supply made-up measurements, achievements, other players' state, inventory, chat, credentials or hidden state. Changing a goal or work context requires a new task identity and consent.

`appendConsultation({ observationId, service: { action, target }, response })` retains the actual bounded service response in this owner pod. It requires retention consent, references an existing self-attributed observation, and labels the response `service-response-unvalidated-effect`. The Foxxi adapter separately enforces network consent and its signed subject-proof contract. No learner registration or remote `private_evidence` is needed to retain the returned unretained plan here.

Record a later real observation of the same task, then call `appendEvaluation({ consultationId, observationId, playerReport })`. This retains the performer report and actual before/after differences for matching measured values. It cannot create a success score, infer causation, assert learning or mastery, publish xAPI statements, enroll a learner or issue a credential. All records retain `competencyStatus: 'not-assessed'`. Delayed or unseen transfer testing requires additional authentic observations and evaluation; receiving a plan does not establish an effect.

`read()` returns cloned `{ schema, ownerDid, applicationId, consents, observations, consultations, evaluations, archiveHead }` snapshots. Existing v1 records without `archiveHead` remain readable. Append methods return `{ saved, reference, observation|consultation|evaluation }` only after verified native readback. `status()` reports key presence, connection/pending state, archive head and current working-set counts. `close()` clears the open private index and rejects late asynchronous results.

Run the focused checks with:

```sh
node --test client/native-pod/performance-consultation.test.mjs server/gaming/player-browser-assets.test.mjs
```

The tests use synthetic isolated native ports, perform no account or consent changes, and cover task/subject/session/recipient boundaries, late withdrawal, expiry, pending acknowledgements, native CAS conflicts, recovery-key absence, agent self-attribution, actual before/after comparisons, forty continued evaluations, forty unfinished plans, all three rotation acknowledgement stages, and pinned private history reads.
