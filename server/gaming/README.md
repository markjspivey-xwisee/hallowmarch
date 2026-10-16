# Interego gaming vertical — initial shared-authority slice

This package separates reusable game authority, human-owned agent delegation,
Interego-native persistence, and Foxxi learning evidence from the Hallowmarch
domain adapter. It is an initial bounded shared expedition, not a migration of
the existing Hallowmarch world to a complete authoritative MMO.

## Implemented

- `AuthoritativeRoom`: server-derived actors, serialized validated commands,
  conditional durable commits, logical command replay, competing-writer recovery,
  and confirmed snapshots. No acknowledged primary state is memory-only.
- `createInteregoStore`: encrypted `@interego/pgsl` native artifacts and atomic
  head CAS. No independent SQL primary or volatile production fallback.
- `createHallowmarchDomain`: two or more players share one guardian, health total,
  retaliation, death and loot outcome. Expedition rewards do not change the
  legacy browser-owned character inventory.
- Human-owned companion grants for teammate, pet and coach roles. Opaque
  capabilities have exact room/body/actions, expiry, rate limits and revocation.
  Agents use the same authoritative rules and cannot award loot or alter state.
- `projectGamingEvents`: attributed player, actor, team, realm and game activity
  metrics, plus timing observations. Counts do not establish competence.
- `createFoxxiSink` and `createLearningOutbox`: signed own-subject xAPI activity,
  verified DID bindings, per-session consent, exact durable receipts, and
  recoverable retries. NPC activity cannot become a human learning record.
- Generic and Hallowmarch JSON-LD profiles reference canonical I2IDL concepts
  from glossary snapshot v0.0.89 with related mappings. They do not replace
  definitions, claim equivalence, or claim that these application URNs are
  already published I2IDL ontology terms.

## Running and configuration

The ordinary game starts with this feature disabled. `/gaming/manifest` reports
readiness; `/gaming/agents` advertises the companion HTTP affordances, and
`/gaming/vocabulary` and `/gaming/hallowmarch-vocabulary` serve the profiles.
The Shared expedition menu appears only after the native service opens and its
first real durable world commit succeeds. Missing storage never enables a
test store in production.

The host must supply pinned built `@interego/core` and `@interego/pgsl` packages
from a reviewed Interego revision that exposes `NativeCommitStore`. These are
private workspace packages; the current game image does not assume they are
available from public npm. Native storage prerequisite work must be released
and verified independently of this game change.

Provision a dedicated game service identity/pod and stable game-owned keys.
Configure `HM_GAMING_ENABLED=1` and these separate service settings:

```
HM_GAMING_NATIVE_POD_URL
HM_GAMING_NATIVE_OWNER
HM_GAMING_NATIVE_CAPABILITY
HM_GAMING_NATIVE_PRIVATE_KEY
HM_GAMING_NATIVE_OWNER_PUBLIC_KEY
HM_GAMING_NATIVE_HEAD_URL             # optional within service pod
HM_GAMING_NATIVE_ARTIFACT_CONTAINER   # optional within service pod
```

Do not reuse an operator write secret, a human's entire-pod token, or Foxxi's
service key. The current gate enforces pod scope, not individual game-head scope;
a dedicated game pod is the required isolation boundary. No service identity,
production key or new permission is provisioned by importing this package.
No unrelated Foxxi/LRS service restart or migration is part of this change.

The transport derives a human principal from the existing authenticated game
connection. External agents receive only the capability deliberately granted by
that human. They may POST to `/gaming/agent/observe` or `/gaming/agent/command`
with that bearer capability and the advertised JSON body. They can also use
`gaming` WebSocket operations. Tokens are returned once, never persisted in
browser storage, and cleared from the sheet on close or connection change.
Replaying a grant does not disclose its secret again; revoke and regrant if its
initial response was lost.

The agent DID on a grant is an owner-declared label. Possession of the scoped
bearer capability authorizes commands; this version does not cryptographically
prove that the caller controls that DID. Foxxi export separately requires a
verified subject binding and does not treat this label as identity proof.

Foxxi export remains unconfigured by default. A game account is not automatically
an Interego DID. Enable export only after a genuine linked-identity flow verifies
the subject and a human grants purpose/recipient/session/expiry-specific consent.
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
Client tests run the actual module with protocol/DOM doubles, not a physical phone.

Enable this initial runtime with a single active serving process. Native CAS
arbitrates competing writes, but snapshot broadcasts currently reach only the
clients connected to the committing process. Before serving one room from
multiple processes, add cross-process committed-state subscriptions and verify
that every process broadcasts those updates; native CAS alone does not provide
that delivery path. Otherwise remote changes appear only after an explicit read.

The current native SDK enumerates the scope index and this room persists a full
state snapshot per accepted command. Native operation history grows; room replay
responses retain 1,024 commands and recent event metrics cover a 256-event window.
That supports a bounded proof, not a measured MMO tick rate. The next performance
work is version-bound native record lookup, short atomic command batches,
room-leader coordination and actual latency/fan-out/recovery benchmarks. Do not
enable high-frequency movement against the current persistence path or advertise
MMO-scale throughput based on local fixture timings.

For a real private-scope benchmark, configure the native SDK and a dedicated
benchmark pod, then run:

```
node server/gaming/benchmark.mjs --authorize-native-writes --commands=100
```

This makes actual durable software-verification records, reports p50/p95/p99
command latency, and verifies a fresh native read. It does not measure the
player's phone/network RTT. Missing prerequisites fail explicitly.

The existing world NPCs, armies, inventory, quests, trade and PvP are still on
the earlier architecture. This package must not be described as having migrated
those systems. Extending the authoritative domain and client rendering remains
separate work after the native authority and performance gates pass.
