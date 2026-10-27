# Observed gameplay activity

The public [Profile](https://march-production-f6d9.up.railway.app/gaming/activity-profile.jsonld) defines Hallowmarch's observed gameplay vocabulary, xAPI statement templates and patterns. It contains no player's record. The current version identifier is the Profile URL followed by `/versions/1.1.0`; `/versions/1.0.0` serves the preserved historical document. The profile has 28 concepts (16 verbs, 10 activity types, two extensions), 16 templates and six patterns.

A player's activity history belongs in the player's encrypted native pod and uses the original owner key and recovery path. Public discovery describes the contract; it does not expose personal activity, scores, a private index or decryption keys. Retained own-pod statements are activity records. Their existence is not a claim that a conformant Learning Record Store accepted them.

Ordinary play retains bounded detail and cumulative totals in the private character.
Optional Foxxi recording keeps a bounded encrypted current performance profile in
that same owner's pod: cumulative observations and a rolling hour of recent xAPI
detail. Its coverage reports any shortened detail window. This personal activity
window is distinct from a complete historical LRS. Permanent raw-page exports
are explicit diagnostics rather than an automatic background operation.

## Identity and evidence

The statement actor is always the authenticated **observing owner**, represented as an xAPI `Agent`: `account.homePage` is `https://identity.interego.xwisee.com` and `account.name` is that owner's DID. This includes observations involving a verified agent controller. It does not prove the owner manually performed an action: `human-input`, `agent`, `unattributed` and `companion-autonomy` remain distinct controller facts. The context extension records the concrete body, verified controller DID and grant when available; unknown control remains `unattributed`. A native agent identity must be verified before attributing control to it. These owner-browser records do not create the agent's independent performance profile, and a human session delegate must not be relabeled as the human performer.

The source is `owner-browser-observation`. These records describe what the game browser observed, without claiming independent server verification. An executed input is not automatically a hit; a resource read is not a learned skill; a game level, path, bounty or victory is not an assessed competency.

The module preserves a UUID event identifier and observed timestamp. Its xAPI projection removes the `urn:uuid:` prefix from `statement.id` and uses the session UUID as `context.registration`. Retry or export the same event with the same identifier and content. A changed event requires a separate correction; do not overwrite its original statement or manufacture a replacement identifier to hide uncertain delivery.

The `urn:interego:gaming:activity:context` extension identifies event kind, body, controller, party and optional game/task context. The `urn:interego:gaming:activity:observation` result extension retains the observed quantity or refusal reason, local history ordinal, provenance and `competencyStatus: "not-assessed"`. Both have closed Draft-07 JSON Schemas in the Profile. No prompts, messages, transcripts, tokens or arbitrary extension fields belong in them.

## Statements and patterns

Every emitted kind has an exact custom verb and Activity Type, using `urn:interego:gaming:activity:verb:<kind>` and `urn:interego:gaming:activity:object:<family>`. The event kinds are:

| Family | Observations |
| --- | --- |
| Ability | Executed, refused |
| Combat | Defeated, died, healed |
| Resource | Gathered, harvested |
| Craft | Completed, refused |
| Bounty | Completed, claimed |
| Supply | Delivered |
| Path | Completed |
| Character | Respawned |
| Intervention | Started |
| Agent | Command accepted |

A statement's category activity uses the exact **Profile version** IRI. The primary pattern allows one or more observed events within the same registration, ordered by timestamp. It requires no invented initialization, completion, pass, lesson or outcome. When reading mixed sessions, partition by registration and order by observed timestamp; the local history ordinal preserves the original capture order. New semantic template or pattern constraints require new identifiers and a new Profile version.

Version 1.1.0 adds four secondary sequence motifs: refused ability to executed ability, refused craft to completed craft, completed bounty to claimed reward, and character death to respawn. Diagnostics examine the relevant-event projection for the same observer, body and controller; ability, recipe and bounty pairs also require the same object. They never join different registrations or Profile versions. A motif match describes a sequence, not its cause or a demonstrated capability. These partial-window motifs do not claim the full session lifecycle advertised for ScaryMansion.

`analyzeGameplayPatterns(statements, profiles)` checks the exact supported Hallowmarch template/extension subset and observation-stream structure. It reports matched, unmatched and invalid streams, plus matched/incomplete/unmatched motifs. This is bounded application diagnostics, not a general xAPI Profiles processor. `__hm.activity.patterns()` reads the public immutable profiles and analyzes the retained private recent window. A missing start or end may reflect shortened retention rather than a failed action.

New private events use internal event schema v2 to select Profile 1.1.0. Saved v1 events continue projecting the original 1.0.0 category and unchanged statement content/IDs, including pending deliveries and archived detail. The wire extension schema is unchanged. Early events freeze their UUID and observation time before lazy module loading; loading delay no longer becomes the recorded action time.

`result.success` and `result.completion`, when present, describe the concrete game operation only. Refusals have `success: false`. For `agent.command-accepted`, `success: true` means the input was admitted; it does not establish movement, a hit, task completion or an effect. Both accepted commands and started interventions omit `result.completion`. Starting support does not establish intervention completion or effectiveness. Source records omit LRS-assigned `authority` and `stored`; a real LRS may enrich accepted statements with them without breaking these templates.

## Progress and coaching

Game milestones use explicit game criteria and retained evidence identifiers: collect a resource, complete a recipe, execute legal abilities, receive defeat credit, claim a bounty or deliver supplies. The interface may show those observed counts and which next game action is available. Label them game progress. Do not turn them into knowledge, skill, mastery or credential claims.

A support attempt records the selected intervention, when it began, the baseline event count and subsequent real observations. The coach can compare those observations and recommend continuing, adapting, stopping or revisiting the context. A before/after difference alone does not establish why the difference occurred. A measured performance assessment additionally needs a defined task, criterion, actual response evidence and scorer; the game milestone count supplies none of those by itself.

The live Foxxi contextual planner accepts actual trajectories and returns its regime, method, selected interventions and reasoning. Its consulting method calls for context, scope, rationale, evaluation and a review trigger. Keep the returned plan and subsequent observed use in the performer's pod. A returned plan is not delivery, and an opened guide is not a verified effect. The game's authored `job-aid`, `reference` and `concept` resources retain their source digest and revision; I2IDL-X annotations express instructional aboutness, without declaring equivalence or achievement.

## I2IDL-X semantic layer

The native resource publication now uses `i2x:isClassifiedBy` for actual Profile, Profile version, Statement Template and Pattern nodes. It cites I2IDL release v0.0.93 (commit `b75261de5ad7851c1f61607091cc00e486bbbb5f`) and I2IDL-X 0.5.0 vocabulary, referent and alignment sources. Every such classification remains explicitly **Hypothetical**. Resource `dct:subject` annotations retain their instructional aboutness; they do not classify the text as a person's knowledge or competence.

`__hm.activity.semanticGraph()` derives a private JSON-LD view of retained observations. The occurrence is a `prov:Activity`; the statement is a distinct `prov:Entity` classified as `i2idl:xapi-statement` and linked to that occurrence. Its exact original xAPI JSON, observer attribution and Profile version are preserved. Ordinary gameplay occurrences are not automatically classified as learning events or competencies. Both analyst views are explicit reads and make no publication, delivery or assessment record.

This superset adds semantic interpretation to standard xAPI evidence. It does not replace xAPI Profile conformance or LRS delivery contracts.

## External xAPI delivery

The native Foxxi signed writer accepts ordinary Activity statements only when `actor.account.name` equals the authenticated signing DID. A delegated browser signs as its session agent, so this writer cannot be used to impersonate the human actor. Keep the correct human record in the human's encrypted pod until an explicitly supported subject-attestation contract is available. An independently authenticated agent can use its own supported native contract.

The current signed adapter rejects SubStatements, attachments and voiding statements. Corrections that need xAPI voiding require the actual standard LRS Statements Resource, a new `voided` statement referencing the original statement ID, and authorized credentials for that resource. Never claim that an application correction marker voided an LRS record. An ambiguous native or LRS write stays pending until the same operation or statement identifier is reconciled against actual readback.

The separate [committed-event Profile](https://march-production-f6d9.up.railway.app/gaming/committed-activity-profile.jsonld) describes authoritative server-log projections. `committedGameplayStatements(events, {subjectDid, actorId, registration, ...context})` requires the actual run registration and verified subject binding. It uses separately salted statement IDs and fails on unknown kinds or incorrect provenance. It is an explicit API for a new exporter; the existing server sink and durable outbox retain their legacy statement IDs/content and do not claim this Profile. Do not deliver both projections as independent observations of the same action. The active browser/Foxxi gameplay route uses the observed Profile above.

## Validation

The document follows [ADL xAPI Profiles 1.0](https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-structure.md). Its metadata and shape were checked with the [ADL Profile Server validator](https://github.com/adlnet/profile-server/tree/da9159adc694bac7817f9068fe6002dca89d69b3/profile-server/server/profileValidator). This is Profile validation, not LRS conformance certification.

`node --test tools/tests/gameplay_activity_profile.test.mjs` additionally checks vocabulary against the real module, every actual event projection, both extension schemas, pattern references, incorrect provenance, controller identity, bounds, secret-field rejection and LRS-enriched envelopes. The official schema does not cover all normative reference or semantic constraints; these focused checks supplement it.

The 2026-10-27 comparison uses the supplied Shelly Blake-Plock LinkedIn screenshot as evidence of ScaryMansion's advertised 73 concepts, 40 templates and 16 patterns. Its public Profile implementation was not located. The useful comparison is the same Concepts/Templates/Patterns discipline described in the [ADL Profile structure](https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-structure.md) and [processing specification](https://github.com/adlnet/xapi-profiles/blob/master/xapi-profiles-communication.md), not matching another game's counts.

Fresh validation ran all three Profile documents through the unmodified historical ADL validator pinned above, with all 16 source files checked against their Git blob hashes. All passed; a deliberate extra pattern operator failed. [The retained report](verification/xapi-profile-adl-20261027.json) states that validator's structural scope. Live I2IDL-X SHACL checks covered all 64 distinct public classification targets without violations or unknown concepts; representative classification and a synthetic private statement also passed. Full OWL consistency, universal pattern processing and LRS certification are not established by these checks.
