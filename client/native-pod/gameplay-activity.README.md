# Private gameplay activity

`gameplay-activity.mjs` records observed play, supplements the existing Your path
journey with concrete milestones, and projects portable xAPI statements. It
performs no I/O or learning-service delivery. No questionnaire is required.

`src/14y_activity.js` captures actual gameplay hooks and registers the `activity`
character save part. The normal native character save seals this data in its
owner's pod. A legacy standalone artifact can retain its existing local save;
local records cannot produce statements attributed to a native identity.

The browser interface is `window.__hm.activity`:

- `snapshot()` returns `milestones`, `current`, `revision`, `eventCount`,
  `lastEventAt`, `history`, `summary`, and the existing `canonicalPath` pointer.
- `record(type, objectId, quantity, options)` observes an actual successful or
  refused action. It cannot affect the gameplay result if observation fails.
- `interventionStart(id)` records the start of a catalogued tool, job aid or
  practice attempt. It returns its action destination and attempt ID.
- `resource(id)` returns a bounded catalogue entry for the existing game UI.
- `statements()` projects the recent native-owner observations as xAPI-shaped
  statements. `trajectory()` returns the bounded real-event trajectory.
- `archive()` flushes one page, at most once per thirty seconds; it never sends
  telemetry to Foxxi or an LRS.

The integration must serve both new modules using the existing fixed native
asset allowlist. The companion controller's separate integration emits
`agent.command-accepted` only after an input is accepted under its verified
native grant. That event establishes accepted intent, not a combat outcome.

## Evidence and attribution

Hooks capture legal ability execution/refusal, credited defeat, actual local
health restored, death/release, accepted foraging/mining/wood/fishing yields,
ripe-bed harvest, recipe completion/refusal, bounty target/reward, supply
delivery and non-silent rewarded path completion. Outbound multiplayer damage
and heal estimates are not treated as confirmed outcomes. Harvest quantity is
the number of ripe plants actually removed, not an assertion that bags accepted
every resulting good.

Statements name the authenticated owner as the observing actor. Body ownership,
party presence and explicitly known controllers are context. Delayed casts,
projectiles and mixed control remain `unattributed` when their controller is not
established. A human pod delegate is never relabelled an independent agent.
Observed milestones do not establish skill, mastery or learning. Later evidence
linked to an intervention establishes temporal association, not effectiveness.

The public Profile version is
`https://march-production-f6d9.up.railway.app/gaming/activity-profile.jsonld/versions/1.0.0`.
The corresponding static Profile and statement templates are maintained in the
server integration. No `stored` or `authority` fields are invented, and this
private archive is not presented as a conformant LRS.

## Bounded persistence

The versioned save part preserves aggregate outcome/quantity counters, stable
UUID event IDs, fresh session IDs and sequence checkpoints, recent sixteen
events, up to sixty-four pending detail events, eight intervention attempts, an
archive head and explicit dropped-detail counts within 64 KiB. Initial observed
milestones remain available after the recent window advances. Completed initial
milestones fall back to repeatable practice rather than declaring mastery.
New actual observations continuously replace the oldest pending detail; a full
queue never freezes current coaching or later optional learning delivery.
Every removed pending observation increments the explicit detail-gap count.
Older detail also yields to current observations when the byte ceiling is
tighter than the count ceiling, while cumulative counters and milestone evidence
remain available. Per-body event types retain their latest real evidence point.
Snapshot coverage reports the actual first/last retained ordinal and timestamp,
and never labels a pruned window as a complete history.

Automatic permanent raw-page archiving is disabled. Ordinary play retains the
bounded recent/pending detail and aggregate profile in the private character.
Optional Foxxi recording keeps cumulative totals and a rolling hour of details
in one bounded encrypted own-pod checkpoint. An explicit archive export remains
available for diagnostics; it is not part of a recurring gameplay timer.

`gameplay-activity-archive.mjs` reuses the existing owner encryption key and
publishes immutable private pages of up to sixty-four events and 48 KiB. A page
has a deterministic graph derived from the owner, session and sequence bounds.
Exact existing native pages reconcile without another publication; pending
operations retain their original receipt and draft. Unknown writes stop, rather
than blindly create another page. Readback verifies owner, schema, exact head,
content and sequence continuity. A confirmed page advances only the unchanged
pending prefix, preserving new outcomes that arrived while it was written.
Automatic archive publication is disabled. This legacy adapter remains available
only while its original complete session prefix exists; a missing or evicted
prefix fails closed instead of inventing a partial archive chain. An in-flight
page whose selected prefix was evicted cannot advance the profile's archive head.

The confirmed archive head is then persisted through the original native
character save before the next page advances. If the archive is unavailable,
aggregates continue and detail overflow is explicitly counted. The recent tail
is never described as complete historical xAPI detail when a gap exists. No
central database, LRS, OAuth bearer or private key is part of this profile.

Tests: `node --test client/native-pod/gameplay-activity*.test.mjs
client/native-pod/client.test.mjs` (including real pinned SDK encryption,
readback and exact immutable-page reconciliation).
