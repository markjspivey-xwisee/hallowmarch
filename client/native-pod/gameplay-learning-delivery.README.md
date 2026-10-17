# Optional private gameplay xAPI delivery

`createOwnerGameplayLearningDelivery` sends actual gameplay observations through
the owner's own browser session and Foxxi's advertised own-subject xAPI action.
The game server never receives the browser bearer, decrypts the activity record,
signs a personal learning statement, or substitutes its service identity.

Connecting the module is read-only. The player separately enables
`record-gameplay-activity` for the exact current session, character task and live
Foxxi write recipient. The existing encrypted consultation journal retains that
choice for at most fifteen minutes; choosing coaching does not enable learning
export. Stop, expiry, a hidden page, identity change and character change close
the UI's delivery scope. No questionnaire is part of this path.

The caller supplies `sessionId` for the consultation consent journal and
`gameplaySessionId` for the actual activity profile. `startAfterOrdinal` is the
current profile count when the player enables delivery, so previous observations
are not silently exported. `prepare(rawEvents)` accepts up to 128 events and
selects at most twenty future observations. It reuses the activity profile's
`gameplayActivityStatement` mapper. The authenticated owner remains the statement
actor; character/companion body, controller kind, actual agent DID and grant
context remain explicit. These browser observations never establish competency.
An agent uses its own verified owner session to retain its own observations.

Before a write, the module rechecks authenticated owner and session delegate,
the live descriptor, the complete signed payload, and exact current consent.
`assertCurrent` must check the caller's active identity, character, generation,
visibility and consent scope and is invoked before and after asynchronous work.
The relay holds the bearer and follows the discovered action; Foxxi receives only
the signed request.

The caller's `commitState(next)` **must save and verify the exact state in the
encrypted owner character record before returning `{saved:true}`**. The module
persists one exact batch marker before any external action. It clears that marker
only after Foxxi confirms every stable statement ID and private durable receipt.
If saving that marker is uncertain, it also remains pending in memory. A later
call cannot replace it; explicit recovery must confirm the same marker first.
State is capped at 64 KiB, with at most twenty pending observations and a monotonic
activity ordinal cursor rather than an ever-growing list of receipt IDs.

An interrupted or partially accepted request remains pending. Ordinary delivery
never resends it. `reconcile()` reads the exact IDs and compares returned LRS
envelopes with the original observations, allowing only LRS-assigned authority,
stored time and version additions. The read must explicitly confirm durable
private storage; an accepted but transient LRS response cannot acknowledge it.
`retryPending()` is an explicit recovery
operation using the same IDs and content, with fresh current consent. It must
never run from an automatic retry timer. An acknowledgment save failure leaves
the pre-send marker available for read-only recovery after restart.

The own-subject descriptor advertises read and write separately at
`/agent/xapi-statements/own-subject/affordance`. Both use a signature-covered
`{subject_did,purpose:'personal-performance',...}` payload. Backend owner binding
must verify the delegate's native identity controller and own-pod authorization;
the older agent-only xAPI action cannot safely stand in for this contract.

The Foxxi recipient is a bounded private performance profile: durable cumulative
observed totals plus recent actual xAPI observations from a rolling hour. It does
not promise a forever-growing historical LRS. Detail can also reach its bounded
capacity within that hour; the service reports the actual retained coverage.
An old statement may return `410` after leaving that coverage. The browser never
retries observations older than one hour, since the recipient no longer retains
their detail and duplicate-ID window.

The player may explicitly choose `abandonPending()` (`closePending()` is an
alias) to close an unknown batch without resending it. This only updates the
encrypted owner delivery state. It advances the processed ordinal and records
`closedUnconfirmedCount`; it does **not** increase acknowledged deliveries or
claim that the service accepted the observations. No batch is automatically
abandoned. An uncertain closure save leaves the pending fence in place, and a
confirmed closure survives reload without replaying the old observations.

Run the focused boundary checks with:

```sh
node --test client/native-pod/gameplay-learning-delivery.test.mjs client/native-pod/performance-consultation.test.mjs
```
