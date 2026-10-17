# Native agent access in the March

The AI joins the human's party in the existing 3D game as its own humanoid
companion. Open **Players → Your AI party member** after native sign-in and
entering the game. Give it a nickname and choose **Add AI party member**. Its
stable identity, appearance, calling, health, position and party role are kept
in the owner's existing encrypted character save. One companion belongs to
each human character. The human character is never a selectable agent body.

Choose **Follow me**, **Guard this position**, or **Support my target**. These
use ordinary NPC movement and combat rules. Support only targets the human's
current nearby hostile NPC. The companion has its own party health frame and
other players see a separate humanoid beside its human owner. A fallen
companion stays down after reload.

Expand **Connect an AI agent · advanced host setup** to choose that companion
or an existing owned animal, enter the agent DID and explicitly publish the
limited relationship in the owner's pod. The panel reports access ready while
waiting for a real agent host; publication does not claim the agent connected.
Public connection details stay inside a collapsed section. Dismissal first
confirms its grants revoked in the game and owner's pod, then removes the
companion from the private character save.

The owner's public native grant names the exact game, origin, room, body,
actions, expiry and rate. The game retains its reference and strictly confirms
registration/admission/revocation in its own encrypted native stream. Native
signature and current delegation checks bind an ephemeral Ed25519 session key.
Local commands carry exact path, scope, sequence and body signatures. The
10-second native lease is unchanged. Commands perform no native identity reads.

The player explicitly resumes confirmed access and closes the panel. Movement
uses ordinary companion or animal navigation; attacks use existing target,
range, collision and combat logic. The human moves independently alongside the
companion; human movement does not cancel its intent. Menus, immediate pause, loss of
focus, a stale/disconnected page, changed owner connection, death and world
recovery refuse control. A repeated logical command cannot dispatch twice to
the same page. A new owner connection requires fresh admission. No operation
can possess the human character, mutate private inventory or claim an expedition reward.
Old player-body grants remain readable/revocable but cannot resume or dispatch.

The dispatch acknowledgement means **input applied by the owner page**, not
server-verified damage, loot or achievement. Observation is a bounded projection
of the selected body and nearby public targets; it contains no character save,
inventory, private chat, native bearer or recovery material. These controls use
the current elected-page multiplayer simulation. Offline/headless main-world
combat, separately logged-in agent players, native team/realm permissions and MMO scale
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
simultaneous human/companion movement and immediate pause. Live release additionally requires actual
native sign-in/save recovery, signed main-world control, a second multiplayer
peer seeing the movement, revocation and native-compatible restart recovery.
Source/fixture checks alone are not a production-readiness claim.
