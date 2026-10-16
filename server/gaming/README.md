# Interego gaming vertical — initial shared-authority slice

This package composes reusable game authority, player-owned records, scoped agent
delegation, Interego-native persistence and optional Foxxi delivery with the
Hallowmarch domain adapter. The shared expedition has bounded server authority;
the main world retains elected page/region keepers for combat. This is a hosted
provider bridge with no MMO-scale capacity claim. Team and realm ownership and
permissions remain outside the native migration.

## Implemented

- `AuthoritativeRoom`: server-derived actors, serialized validated commands,
  logical command replay and authoritative live snapshots. The serving game uses
  a fast in-memory layer with bounded background native checkpoints. The reusable
  room also retains an explicit strict mode that waits for every durable commit.
- `createInteregoStore`: encrypted `@interego/pgsl` native artifacts and atomic
  head CAS. No independent SQL primary or volatile production fallback.
- `createHallowmarchDomain`: two or more players share one guardian, health total,
  retaliation, death and loot outcome. Expedition rewards do not change the
  legacy browser-owned character inventory. Claim the reward and start the next
  encounter, or wait thirty seconds to reset an abandoned reward. Fallen bodies
  can be recovered by their human owner.
- Native players keep encrypted character saves and their discovery indexes in
  their own pods. The game retains a verified participation binding and a record
  reference; it does not receive the private character body or encryption key.
- When native world persistence is configured, game-owned progressive
  world/season checkpoints use a distinct stream in Hallowmarch's own pod. See
  [the migration and rollback contract](progressive-owned-state.md).
- Scoped native companion grants bind the owner, agent, application, room, body,
  actions, expiry and rate. Locally verified command proofs follow native
  admission and renewal; local and owner-pod revocation are distinct steps. See
  [the native authority contract](native-agent-authority.md). Enabling this path
  requires complete live admission, command, renewal and revocation proof in the
  target deployment; implementation and fixture tests alone do not establish it.
  Legacy opaque bearer grants remain available only for separately configured
  legacy integrations.
- `projectGamingEvents`: attributed player, actor, team, realm and game activity
  metrics, plus timing observations. Counts do not establish competence.
- `createFoxxiSink` and `createLearningOutbox`: signed own-subject xAPI activity,
  verified DID bindings, per-session consent, exact durable receipts, and
  recoverable retries. The serving game's personal learning export is unavailable
  until a trusted subject delivery path and exact consent are configured. NPC
  activity cannot become a human learning record.
- Generic and Hallowmarch JSON-LD profiles reference canonical I2IDL concepts
  from glossary snapshot v0.0.89 with related mappings. They do not replace
  definitions, claim equivalence, or claim that these application URNs are
  already published I2IDL ontology terms. These mappings support performance
  consulting and job aids; they do not define the game's identity or rules.

## Running and configuration

The ordinary game starts with this feature disabled. `/gaming/manifest` reports
readiness; `/gaming/agents` advertises the companion HTTP affordances, and
`/gaming/vocabulary` and `/gaming/hallowmarch-vocabulary` serve the profiles.
The Shared expedition menu appears only after the native service opens and its
first real durable world commit succeeds. Missing storage never enables a
test store in production.

The game Dockerfile builds `@interego/core`, `@interego/solid` and `@interego/pgsl`
from reviewed Interego commit `aeabd6f2fe95524993ef94d7579debd26e39eac7`
([PR 631](https://github.com/markjspivey-xwisee/interego/pull/631)).
Its committed npm lockfile pins the SDK's transitive dependencies. The native
commit store, artifact codec and encryption exports are checked during the image
build. The build uses the public source repository and needs no private registry,
credential or runtime key. Source metadata is recorded in `interego-sdk.json`.
Local native benchmarks need those same built packages available to Node.
Native storage availability and live game latency still require independent
deployment checks; shipping the SDK does not establish either.

For a deployment with a persistent `HM_DATA` volume, use only public flags:

```
HM_GAMING_BOOTSTRAP=1
HM_GAMING_ENABLED=1
HM_GAMING_MONITOR_ENABLED=1
```

The serving game uses `realtime` persistence. `HM_GAMING_PERSISTENCE_MODE=strict`
selects the diagnostic, commit-per-command path. Library callers retain strict
mode unless they pass `persistenceMode: 'realtime'` to `createGamingRuntime()` or
`AuthoritativeRoom` explicitly.

In realtime mode, movement and combat acknowledge the server's current live
sequence immediately. Shared snapshots coalesce input bursts and broadcast at
most twenty times per second, independently of command responses. A single background writer coalesces state into native
checkpoints. Snapshots distinguish `liveSequence`, `durableSequence` and
`durableVersion`; the manifest sets `durableAcknowledgements: false` and
`progressivePersistence: true`. An immediate action acknowledgement is never a
claim that the slower layer has saved it. Rewards remain marked as saving until
their checkpoint is confirmed, and capability/consent operations retain explicit
durability confirmation. The client displays Saved, Saving, Save delayed or
Saving paused from the checkpoint status.

Unsaved work is bounded by count and age. A prolonged outage pauses mutation;
an unexpected competing room writer blocks the authority rather than merging
divergent live state. A restart recovers the last confirmed native checkpoint,
so a crash can lose the explicitly unsaved tail. Graceful shutdown stops new
commands and drains checkpoints for up to fifteen seconds. This is one serving
process per room; a multi-process room needs a leader/lease and cross-process
live subscriptions before adding replicas.

`prepareGamingEnvironment()` generates fresh identity, encryption and monitoring
keys inside the serving process and atomically saves them as
`HM_DATA/gaming-service-identity.json`, owned by the service with mode 600. No
private key needs to be sent through deployment tools. Restarts reuse that file;
it must stay with the data volume. Bootstrap creates isolated service pods and
rejects invalid existing keys rather than replacing the identity. It cannot be
combined with manually configured identity keys.

Alternatively, provision a dedicated service identity/pod and configure:

```
HM_GAMING_NATIVE_POD_URL
HM_GAMING_NATIVE_OWNER
HM_GAMING_SERVICE_IDENTITY_KEY_JSON   # renewable Ed25519 service identity
HM_GAMING_NATIVE_CAPABILITY          # only for manually managed static credentials
HM_GAMING_NATIVE_PRIVATE_KEY
HM_GAMING_NATIVE_OWNER_PUBLIC_KEY
HM_GAMING_NATIVE_HEAD_URL             # optional within service pod
HM_GAMING_NATIVE_ARTIFACT_CONTAINER   # optional within service pod
```

Do not reuse an operator write secret, a human's entire-pod token, or Foxxi's
service key. The current gate enforces pod scope, not individual game-head scope;
a dedicated game pod is the required isolation boundary. Importing this package
alone does not provision an identity; the explicit bootstrap flag does.
No unrelated Foxxi/LRS service restart or migration is part of this change.

For separately configured legacy integrations, the transport derives a human
principal from the existing authenticated game connection. External agents receive
only the capability deliberately granted by
that human. They may POST to `/gaming/agent/observe` or `/gaming/agent/command`
with that bearer capability and the advertised JSON body. They can also use
`gaming` WebSocket operations. Tokens are returned once, never persisted in
browser storage, and cleared from the sheet on close or connection change.
Replaying a grant does not disclose its secret again; revoke and regrant if its
initial response was lost.

The agent DID on a legacy bearer grant is an owner-declared label. Possession of
the scoped bearer capability authorizes commands; this path does not cryptographically
prove that the caller controls that DID. Native-required deployments instead use
the verified owner/agent proof flow in [native-agent-authority.md](native-agent-authority.md).
Foxxi export separately requires a verified subject binding and does not treat a
legacy label or a gameplay grant as identity proof or learning consent.

Personal learning export remains unavailable in the serving deployment. Native
sign-in alone does not configure delivery or grant consent. Enable export only
after a trusted composition proves delivery for the verified subject and the
human grants exact purpose/recipient/session/expiry-specific consent. Recheck
that same subject, destination and current captured consent before each delivery.
`createGamingRuntime({learningSink})` accepts a sink built from a freshly
discovered Foxxi signed-write affordance, signer and consent callbacks.
`flushLearning()` processes the durable queue in bounded pages and records verified
receipts through the same native room store. Schedule that method only after
the sink is configured. Revocation prevents subsequent export; already delivered
records remain subject to the destination's own retention controls.

## Evidence and limitations

Run `node --test server/gaming/*.test.mjs` and
`python3 tools/tests/gaming_client.py`. Native adapter tests use an explicitly
labelled local HTTP contract fixture; they are not an actual CSS/PGSL deployment
or cryptographic interoperability benchmark. Room tests include a disk restart,
two writers, one shared kill/loot, failed storage, revocation and outbox recovery.
The protocol tests run the actual module with DOM doubles. The enabled Chromium
test (`node tools/tests/gaming_browser.mjs`) uses real DOM/WebSocket clients at
four mobile/landscape sizes; a full built Three.js page was also exercised. These
are browser checks, not physical iPhone verification.

`evidence/runtime-bootstrap-native-verification-20261016.json` records an actual
fresh runtime bootstrap, empty-pod native world/join/command commits and exact
cold-store recovery with persisted keys. Its identities are software-verification
identities, separate from those generated inside the production service.

Enable this initial runtime with a single active serving process. Native CAS
detects competing checkpoint writers, but snapshot broadcasts reach only clients
connected to the authoritative process. Before serving one room from multiple
processes, add a leader/lease and cross-process live subscriptions and verify
that every process receives the same authoritative sequence. Native CAS alone
does not provide that live delivery path.

The pinned native SDK supports verified selected-record reads, which the game
adapter uses for each stream and exact operation receipt instead of enumerating
the whole scope index. Strict mode persists a full state snapshot per accepted
command; realtime mode coalesces pending commands
into full checkpoint snapshots outside the gameplay queue. Native operation history grows; room replay
responses retain 1,024 commands and recent event metrics cover a 256-event window.
The game transport retains at most 512 immutable ciphertext responses and 8 MiB
including their metadata, keyed by the native SHA-256 artifact/commit URL.
Mutable heads and every write still go to native storage; the first verification
read after a write also goes to storage. A new process starts with an empty cache.
This bounded encounter still does not establish an MMO tick rate or player
capacity. Live action latency, checkpoint lag and cold recovery require separate
measurements. Further work includes native history compaction, fixed simulation
ticks, interpolation, room-leader coordination and load/fan-out
benchmarks. Never advertise MMO-scale throughput from local fixture timings.

For a real private-scope benchmark, configure the native SDK and a dedicated
benchmark pod, then run:

```
node server/gaming/benchmark.mjs --authorize-native-writes --commands=100
```

This makes actual durable software-verification records, reports p50/p95/p99
command latency, and verifies recovery through a new SDK/store with an empty
ciphertext cache. It does not measure the
player's phone/network RTT. Missing prerequisites fail explicitly.

The existing world NPCs, armies, inventory, quests, trade and PvP are still on
the earlier architecture. This package must not be described as having migrated
those systems. Extending the authoritative domain and client rendering remains
separate work after the native authority and performance gates pass.

Service operational monitoring composes the live Foxxi own-subject xAPI
operation advertised by `https://foxxi-bridge.interego.xwisee.com/affordances`.
It uses a separately provisioned game-monitor wallet and pod, with
`HM_GAMING_MONITOR_ENABLED=1`, `HM_GAMING_MONITOR_DID`,
`HM_GAMING_MONITOR_PRIVATE_KEY` and `HM_GAMING_MONITOR_POD_URL`.
Neither a human credential nor the game-native encryption identity is reused.
The native game store durably queues each sanitized observation before delivery;
Foxxi must acknowledge every exact statement id as persisted before the queue is
acknowledged in native storage. Failed or uncertain delivery retains the same
statement ids and content across process restarts.

Sample at most once every 30 seconds and run it outside the gameplay command
path. The sample contains process counters, timing gauges, connection counts,
room sequence and counts from the bounded recent event window. These are live
operational observations, not a claim that every observed action is durable. Windows
can overlap and must not be summed as unique lifetime activity. The exporter
whitelists fields and excludes account ids, actor ids, team/realm membership,
chat, capabilities and raw game events. The subject is the game-monitor service,
with an explicit operational or software-verification purpose; no human learning
or competency is asserted. Individual player learning remains unavailable until
a trusted delivery path for the verified subject and exact current consent are
composed; service monitoring does not establish either.

The software-verification receipt in
`evidence/foxxi-monitor-native-verification-20261016.json` records one actual
native-queued service snapshot, Foxxi's persisted receipt, exact signed LRS
read-back digest and native queue acknowledgement (version 2, pending 0).
It used isolated test service identities and makes no claim about the production
identity, human learning or game latency. The first 30-second delivery timed out;
retrying the same statement id reconciled the accepted write and confirmed its
receipt. Background delivery therefore has a 90-second deadline and preserves
pending observations after uncertainty. Fresh production identities are generated
inside the serving process by `HM_GAMING_BOOTSTRAP=1`; their private keys stay on
the existing persistent data volume and are never sent through deployment tools.
