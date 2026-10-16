# Native agent access in the March

Agent access belongs to the existing 3D game. Open **Players → Agent access**
after signing into the native owner identity and entering a character. Choose
that character or one of its existing animal companions, the agent DID, a role,
and explicitly accept publication of the limited relationship in the owner's
pod. No second encounter or inventory is created.

The owner's public native grant names the exact game, origin, room, body,
actions, expiry and rate. The game retains its reference and strictly confirms
registration/admission/revocation in its own encrypted native stream. Native
signature and current delegation checks bind an ephemeral Ed25519 session key.
Local commands carry exact path, scope, sequence and body signatures. The
10-second native lease is unchanged. Commands perform no native identity reads.

The player explicitly resumes confirmed access and closes the panel. Movement
uses ordinary character input or animal navigation; attacks use existing target,
range, collision and combat logic. Human movement takes priority. Menus, loss of
focus, a stale/disconnected page, changed owner connection, death and world
recovery refuse control. A repeated logical command cannot dispatch twice to
the same page. A new owner connection requires fresh admission. No operation
can mutate private inventory or claim an expedition reward.

The dispatch acknowledgement means **input applied by the owner page**, not
server-verified damage, loot or achievement. Observation is a bounded projection
of the selected body and nearby public targets; it contains no character save,
inventory, private chat, native bearer or recovery material. These controls use
the current elected-page multiplayer simulation. Offline/headless main-world
combat, independent agent avatars, native team/realm permissions and MMO scale
are not established by this change.

`/gaming/manifest` advertises `mainWorldAgents`; `/world/native-agents` describes
the actual owner-reference and agent operations using Hydra action affordances.
Its `agentClient` entry advertises the reusable WebCrypto/fetch client at
`/world/agent-client.mjs`; see [the integration guide](main-world-agent-client.md).
The player-ownership publication composes that description in Hallowmarch's pod.
The bridge's registration/admission/revocation stream is separate from player
pods and from the existing world/season checkpoint stream. No identity or key
is replaced and no production file is imported into a different owner's pod.

The former guardian encounter remains only as an explicit integration harness
at `?integrationTest=expedition`. Its button is absent from ordinary desktop and
phone menus; the old `?expedition=1` link has no auto-open effect. Its checks do
not establish that the main game works.

Foxxi operational samples include separately named, whitelisted **main-world
service counters** from actual movement relay, connections, season steps and
orders. They contain no player identities or learning/competence claims.
Individual learning export still needs a trusted owner-subject delivery path
and exact fresh consent. I2IDL-X remains performance-consulting vocabulary,
not the definition of game rules or delegation.

Verification includes native-signature/CAS/expiry/replay/owner-connection tests,
the built 3D game's normal title and prologue path, real ground movement,
human override and immediate pause. Live release additionally requires actual
native sign-in/save recovery, signed main-world control, a second multiplayer
peer seeing the movement, revocation and native-compatible restart recovery.
Source/fixture checks alone are not a production-readiness claim.
