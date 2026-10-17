# Own-subject performance consulting

The player opens **Character → Progress & coach**. Normal play supplies the observations; there is no assessment form. The page shows the current focus, observed milestone counts, and practical support buttons. **Continue your path** opens the existing game progression rather than replacing it with an assessment system.

Local support and the private activity journal work without a remote consultation. **Coach connection & privacy** contains an explicit 15-minute live-coaching switch, a stop action, and sharing details. Enabling permits bounded summaries of meaningful new observations, at most once every two minutes automatically. Combat, menus, hidden pages, a downed player, and **Quiet for 10 minutes** suppress automatic requests. No popup interrupts combat. Stop invalidates in-flight authorization before an external request can start; already-sent work may finish externally but is never resent automatically.

Each remote request first confirms its intent in the native character save. An uncertain response or private acknowledgment remains visible for exact reconciliation; reloading cannot silently issue it again. Players can close an unconfirmed request without resending, then explicitly start a fresh session. A planner outage leaves prior private guidance and ordinary gameplay available.

The coaching task keeps a stable play-session scope. A separate bounded focus carries the current game criterion and, where available, the observed body. Choosing an intervention records a choice, not completed practice. Comparisons require later evidence for the same focus and body, tied to the same consultation and intervention attempt. Missing attribution stays unknown; one observation does not establish mastery or prove that advice caused improvement.

An external agent acts through its own party companion. Human input remains independent. The authenticated owner is the observer of private gameplay records; a known controller is context, not permission to assign every later outcome to that agent. The portable xAPI profile and encrypted native archive are documented in [gameplay-activity-profile.md](gameplay-activity-profile.md); this is not a claim of LRS certification.

`client/native-pod/foxxi-consulting.mjs` follows Foxxi's live planning descriptor:

- Descriptor: <https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance>
- Action: <https://relay.interego.xwisee.com/ns/iep/action/foxxi/contextualize-and-plan-signed>
- Methodology catalog: <https://foxxi-bridge.interego.xwisee.com/performance/methods>
- Measured private-episode contract: <https://foxxi-bridge.interego.xwisee.com/agent/performance/schema>

These contracts were read live through Interego on October 16, 2026. The planner has its own descriptor and is not currently listed in the root `/affordances` collection. The adapter re-reads its descriptor before sending and refuses a changed recipient until a new preview and consent.

Opening coaching only verifies the current native owner/delegate and reads the public contract. Preparing a request returns a frozen, bounded `payload` for inspection. The task, constraints, explicit cause answers and optional owner-browser counts shown in that payload are the exact logical body sent. Inventory, chat, native access tokens, other players and private character saves have no input field. Calling `requestPlan` requires task-scoped, exact-recipient `request-consultation` consent from the private journal. Consent is re-read after signing, immediately before the external action.

The browser OAuth credential signs through its authenticated session delegate. A human performer is identified by `binding.subjectDid`, while `classifiedBy` must identify `binding.authenticatedAgentDid`. These are distinct roles. Both identities and the pod root are checked against authenticated `get_pod_status`. An agent using its own independently verified owner binding uses the same adapter with `subjectKind: 'agent'`; entering an arbitrary agent DID is not a subject-selection mechanism.

The request carries no `private_evidence`, `private_review`, training completion, `record_performance`, credential or achievement write. Foxxi returns a real diagnosis and intervention plan, attributed to the verified delegate, without retaining a personal plan. Its regime source remains visible. Owner-browser observations are Hypothetical performance evidence, not committed multiplayer outcomes. An explicit user-reported cause answer can justify `default-gap-intent`; it does not establish a derived regime or causal finding. Without sufficient evidence, Foxxi returns `classify-first` with no selected intervention.

The separate owner journal may retain the actual response only under its own task-scoped retention consent. An initial plan and a later self-reported comparison do not establish demonstrated learning. Foxxi's measured-outcome contract additionally requires immutable assessment, response, scorer, policy and canonical report references and a server-bound private plan. This adapter does not manufacture those records or claim that such an episode has been recorded.

The live method catalog applies to humans, agents and teams. It routes Evident work to established practice, Knowable work to diagnosis and cause-specific options, Emergent work to probes and coaching, and Turbulent work to stabilization. I2IDL-X annotations remain limited to performance consulting; they do not define the game's world or entities.

Validation: `node --test client/native-pod/foxxi-consulting.test.mjs` exercises real adapter control flow with an injected native transport. It covers exact preview preservation, own human/agent attribution, revocation during signing, identity and recipient changes, foreign pod stamps and response substitution. These are protocol fixtures, not evidence of a live human consulting episode or measured improvement.
