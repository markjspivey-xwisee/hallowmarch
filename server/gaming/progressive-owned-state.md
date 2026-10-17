# Progressive owned-state composition

`createProgressiveOwnedState` is a small application bridge over the existing
`createInteregoStore` / `NativeCommitStore` load and commit ports. It adds no
storage protocol, identity provider, database or file fallback. Production must
pass the dedicated game's owner-scoped native store. The bridge's snapshot
envelope is local application data; it is not a new Interego kernel term.

The generic bridge is composed by `hallowmarch-world-state.js` and `server.js`.
When native game settings are enabled, world/season persistence defaults to native
ownership. An explicit `HM_WORLD_PERSISTENCE_MODE=legacy` retains the old file
mode for independently configured legacy deployments; it is never an automatic
outage fallback. Tests make no live pod or deployment changes.

## Contract

```js
const owned = createProgressiveOwnedState({
  store: gamingStore,                 // the actual configured native adapter
  streamId: 'hallowmarch-world-season-v1',
  checkpointIntervalMs: 1000,
});
const recovered = await owned.start({ seed: readLegacyWorldAndSeasonStrictly });
// Restore recovered before constructing a world or season that can mutate it.
owned.capture(nextCompleteSnapshot);  // synchronous copy, no durable I/O
await owned.checkpoint();             // optional explicit persistence boundary
```

`start` waits for the native load. A successful load with exactly
`{version: 0, state: null}` is the only migration permission. It calls the seed
factory once and confirms that seed using expected version zero before returning.
Read errors, decryption errors, a foreign owner, malformed state, missing fields
and corrupt digests never fall back to a legacy file or a new world. A failed
seed commit preserves its exact operation for a subsequent `start` retry.

`capture` clones finite, bounded JSON immediately; later caller mutation cannot
change its bytes. A changed snapshot advances `liveVersion`. Unchanged content
does not create a checkpoint. Work is scheduled outside the caller; neither
capture nor a simulation handler awaits a pod write. The host should capture
after its existing coarse mutation batches, rather than on render frames.

The queue has at most one exact attempt and one coalesced latest snapshot. A slow
or failed native store does not grow a snapshot queue. An uncertain retry keeps
the same expected version, idempotency key, event and snapshot bytes until the
native adapter confirms it. The actual native adapter validates encrypted PGSL
closure, scoped owner binding, CAS and operation receipts. A promise rejected by
that adapter cannot advance the bridge's confirmed version.

`status()` separates three numbers:

| Field | Meaning |
| --- | --- |
| `liveVersion` | Latest complete snapshot captured by this process |
| `confirmedLiveVersion` | Snapshot generation durably confirmed by the native adapter |
| `confirmedVersion` | Confirmed native stream version, incremented once per checkpoint |

`durable` means the captured state is confirmed and there is no pending snapshot
or unresolved conflict. It is not an acknowledgement of uncaptured host mutations
or of the correctness of the game's inputs. The host must capture each accepted
world/season mutation batch or expose its own dirty flag until capture. Sanitized
status errors do not contain credentials, transport exceptions or private data.

A stream `VERSION_CONFLICT` fences capture and further writes. It never adopts
the foreign version and overwrites that writer with the local world. The host
must pause mutation and publication, wait for an in-flight operation to settle,
then explicitly call:

```js
await owned.recover({
  discardUnconfirmed: true,
  restore: async snapshot => restorePausedWorldAndSeason(snapshot),
});
```

Recovery validates a fresh native snapshot and invokes the host restore callback
before unblocking capture. A failed read or failed host restore remains fenced.
Recovering an established world from absent state is refused. The host is
responsible for making its restore callback atomic with respect to observers.

Stop accepting mutations and stop simulation timers, capture the final complete
state, then await `shutdown({timeoutMs: 15000})`. It retries transient failure
within that bound and drains both the exact attempt and the latest snapshot.
An expired deadline rejects with `SHUTDOWN_UNCONFIRMED`; recovery is limited to
the last confirmed native snapshot. There is no false final saved acknowledgement.
A request already in flight can still produce a genuine late receipt after the
deadline; status may then advance, but no new writes are launched after closure.

## Hallowmarch host boundary

`server/server.js` now initializes native ownership before reading `WORLDS` or
calling `makeSeason`. The composed host implements these boundaries:

1. Create the dedicated native store before the `WORLDS` read and `makeSeason`
   call. When native ownership is enabled, failed native setup or recovery must
   prevent authoritative world startup. Do not silently switch back to volume
   authority. Leave the independently configured legacy mode explicit.
2. Start this bridge on a distinct stream of that game's store. The seed factory
   reads only `worlds.json` and `season.json`, with strict JSON parsing. Only
   `ENOENT` permits the old defaults `{}` and `null`; an unreadable, truncated or
   malformed file must stop migration. Existing `store.read` swallows these errors
   and is therefore unsuitable for the migration seed.
3. Persist one snapshot with exactly `{worlds, season}`. `worlds` is the room-name
   map from `worlds.json`. Each existing room record contains the checked keep
   owners `k`, gates `g`, day time `td`, campaign `tm`/`cn`, optional claims `cl`,
   update `at`, and optional shared weather `wx`. A weather-only room record is
   legal. `season` is the existing complete `RS` plus its `savedAt`, or `null`
   before first initialization. Preserve original finite JSON values. The
   season's existing strategic news log is world history; private realm chat is
   in a different file and is excluded.
4. Supply an owned read overlay for these two filenames before construction:
   `read('worlds.json')` returns a detached recovered `worlds`, and
   `read('season.json')` returns a detached recovered `season`. Other reads still
   use their current store. Then construct `WORLDS`, `SEASON`, `COMP` and `FIELD`
   in their current order. Do not merge the recovered world with stale local
   world data. Do not use local files to repair an invalid native world.
5. `makeSeason` sanitizes the strategic state and advances downtime, capped at a
   week. Capture its initialized or caught-up `RS` immediately after construction
   and before serving clients. A missing/invalid realm module or rejected native
   season must not silently create and overwrite a fresh season. On subsequent
   captures, use `SEASON.lastStep` for `savedAt` so the timestamp tracks the
   simulated clock boundary rather than an unrelated later snapshot timer.
6. Capture a complete pair after `worldReport`, accepted `keepWx` changes,
   `SEASON.step`, `FIELD.step`/reports, season captures, contributions, orders,
   company pledges that change `RS`, and admin keep/reset/step operations. Domain
   validation stays in the existing modules. JSON object properties explicitly
   set to `undefined` by existing world code (for example omitted `cl`) need the
   same omission projection as their old JSON file, while nonfinite numbers,
   cycles and unsupported values must remain errors. Capture both documents
   together so a checkpoint cannot restore a world from one generation and the
   strategic season from another.
7. Replace canonical writes of these two filenames with native capture. Their
   old debounced file writes may be removed or retained as explicitly disposable
   cache/export copies; they must never acknowledge native durability. Keep
   roster, chat and company persistence separate. Advertise this composed bridge
   and its status through Hallowmarch's existing discovered game capability; do
   not add Hallowmarch names or commands to the Interego kernel.
8. Fence all world/season mutation handlers and timers when a bridge conflict is
   observed. Pause before restore, replace the room-map contents while preserving
   references used by callers, replace `SEASON.RS`, reset time/dirty state and
   invalidate cached world reports/summaries. Resume only when restore succeeds.
   A multi-process deployment needs an explicit single-writer authority/lease;
   the conflict fence alone is not a distributed simulation coordinator.
9. During shutdown, close mutation admission, stop its simulation timers, perform
   the final step and capture, close sockets, and await this bridge's drain
   alongside the shared expedition's existing drain within the host deadline.
   Report any unconfirmed result rather than saying the world was saved.

`GET /gaming/world-state` exposes the actual live/confirmed/pending status.
`/gaming/world-state/descriptor` advertises its read-only Hydra operation. The
same description is published through the existing verified native capability
publisher into the game's own pod at
`urn:graph:hallowmarch:world-season-persistence`. Native publication status is
reported separately; an HTTP description alone is never called a verified native
publication. The manifest states that snapshot ownership has migrated while the
main-world realtime authority still uses elected page/region keepers and has no
authoritative combat added by this bridge.

With the bounded multiplayer provider, authenticated operators can list retained
world checkpoints using `POST /admin?op=world-rollback-checkpoints`, then restore
one using `POST /admin?op=world-rollback&at=<epoch-milliseconds>` with a stable
`Idempotency-Key` header. Both require `x-hm-admin: <HM_ADMIN>`. A successful rollback
pauses shared mutation, drains pending state, confirms a new native version,
restores the world/season pair and reconnects all clients. Current access grants
are preserved. Repeat the same target and key after an uncertain response; do not
invent a new key. Choose an exact timestamp from the checkpoint list. The selected verified snapshot is
pinned before pending local saves drain, including later saves in the same minute.
Expired or replaced exact targets return 410 rather than choosing another world. The operator should call
`world-recover` if an uncertain outcome leaves world persistence fenced.

The existing authenticated operator `POST /admin` door accepts
`op=world-checkpoint` to await an explicit confirmed checkpoint and
`op=world-recover` to discard pending local state, restore fresh confirmed native
state and require clients to reconnect. Both require the existing `HM_ADMIN`
secret. A known CAS conflict returns 503 for world/season mutation, pauses season
and field timers, refuses relevant WS messages, suppresses stale world/season
publication and prevents the shutdown path overwriting the winning writer.

## First migration and deployment isolation

Preview environments require their own persistent volume, game identity, native
pod and keys. Never share the production game identity with an empty preview:
the first preview seed would otherwise become canonical for that production
stream. Never copy preview state into the production world as part of rollout.
Production must seed from its own existing `HM_DATA` files only after the native
store has positively confirmed that this stream is absent.

Quiesce or stop the old legacy server before its first native import whenever the
deployment platform permits it. Native CAS cannot fence a legacy binary that
still writes local `worlds.json` and `season.json`. If an old legacy writer runs
during first import, the migration boundary is the pair of local files read by
the seed factory; later old-process writes are outside that confirmed snapshot.
Those two legacy files were previously written independently, so that initial
pair is not a transactional old-world snapshot. Do not claim zero-loss or atomic
cutover of unconfirmed legacy changes. Record the cutover boundary and have
clients reconnect and resynchronize with the elected keepers at the new service.
Native-to-native rolling deployments use the tested CAS conflict fence, but still
need an explicit single-writer/lease strategy before running multiple replicas.

First production import:

1. Confirm the preview uses a separate volume, identity and pod. Keep production's
   existing mounted `HM_DATA` and service identity/key file; do not replace them
   with preview data or newly generated credentials.
2. Close new player admission and gracefully stop the old legacy process so its
   final world/season saves complete. Record that final local-file boundary. A
   rolling overlap with the old process has the limitations described above.
3. Start the native-capable release on that same production volume and identity,
   with native world mode enabled. The bridge must confirm native stream absence
   before reading the two legacy files. If a native stream already exists, it
   restores that stream and never imports volume copies over it.
4. Check `/health` and `/gaming/world-state`: require native mode, an unfenced
   world and a nonzero confirmed version. Use the existing authenticated operator
   `POST /admin?op=world-checkpoint` to confirm the initialized/caught-up snapshot.
   Compare season number and keep holders with the recorded production boundary;
   the existing season module applies its bounded downtime catch-up.
5. Reopen admission and have clients reconnect and resynchronize. Confirm a live
   change advances the live version, then the confirmed version. A known conflict
   must be recovered explicitly; never relabel it a successful import.
6. After native play has advanced, retain a native-compatible reader for rollback.
   A legacy binary reading the old volume files cannot recover the later native
   world. Pause for controlled recovery instead of silently reverting authority.

Do not put `accounts.json`, passwords, tokens, player saves, `roster.json`,
`chat.json`, `companies.json`, consent, learning records or private keys in this
snapshot. Keeping only the game's world/season pair does not migrate teams or
realm ownership/permissions. Their current account-bound participation and
company data remain separate unfinished ownership work.

## Validation and limits

The focused tests cover confirmed startup and absence, corruption, frozen seed
retry, detached synchronous capture, 1,000 coalesced mutations, bounded concurrent
queues, lost acknowledgements, two writers, explicit recovery, final draining and
deadline expiry. With `INTEREGO_SDK_TEST_ROOT` pointing at a built pinned Interego
checkout, an additional test uses the actual `createInteregoStore`,
`NativeCommitStore`, encryption and PGSL checks over an explicit in-memory native
HTTP contract model. It verifies ciphertext omits a plaintext marker, resolves a
lost head acknowledgement and recovers through a cold client. That test is not
live CSS storage, real authorization, crash-safe backend testing or a capacity
benchmark.

Real-server subprocess tests replace only the configured provider with an
explicit local load/commit contract fixture. They exercise production startup
ordering and fail-closed configuration/read/corruption paths, strict missing-file
seeding, cold native recovery over stale volume copies, slow-write independent
mutation response, foreign-writer 503 fencing, explicit recovery, and refusal to
overwrite that writer during shutdown. Domain tests verify the allowlisted pair
and room fields, optional JSON omissions, strategic input checks, and actual SDK
extraction of the world status affordance. These are bridge/host tests, not a live
CSS authorization or deployment benchmark.

Snapshot memory is bounded; native artifact/operation history is not compacted by
this bridge. The pinned native SDK provides verified selected-record reads; the
game adapter follows the requested stream and exact operation receipt rather
than enumerating every record in the scope. Checkpoint cadence, scope size and
eventual native history compaction need measurement for long-running worlds. A
crash can lose the gap between live and confirmed state;
the bridge offers progressive persistence, not a synchronous durable action log.

This moves persistence authority only when integrated. It does not make the main
world a fully authoritative MMO simulation: client-elected region/room hosts
still report keeps and gates; it adds no server combat, movement reconciliation,
lag compensation, loot validation, cross-world transfers or native delegation
permissions. Hashes/provenance prove which snapshot was retained, not that its
game events were valid. I2IDL-X does not define any world or season data here; it
remains scoped to performance consulting and support in other composed bridges.
