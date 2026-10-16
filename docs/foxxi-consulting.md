# Own-subject performance consulting

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
