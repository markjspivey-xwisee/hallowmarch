# Game content as performance support and instruction

The checked-in `server/gaming/performance-resources.json` describes existing authored game content for humans and agents. Field notes are job aids, the map legend is a reference, and the five prologue pages form an instructional course outline. The forms match Foxxi's `job-aid`, `reference` and `concept` fragments. This catalog creates no Foxxi course, enrollment, learner event, credential or claim of competence.

Run `npm --prefix tools ci` once, then:

```sh
npm --prefix tools run resources
npm --prefix tools run resources:check
npm --prefix tools run resources:test
```

Regeneration parses the authored JavaScript with Acorn. It never executes the game. Complete literal bodies become Markdown for both readers. A function depending on input device, realm, player state or another runtime value is listed with `requiresContext: true`, source provenance and no static body. Resolving it requires the relevant authorized game context; placeholders and partial interpolations are not published as complete instructions.

Every resource includes its authored path, SHA-256 source digest, line span and logical selector. Its revision digest covers content and metadata. The overall digest covers the catalog. `--check` regenerates the projection and compares it exactly, catching source changes and newly added resources. The game build has no parser dependency, and serving the committed artifact needs no extraction step.

`ui.destination` names an existing in-game destination. There are no invented URL fragments: Field notes lives under Chronicle → Your path and lists the notes collected in play; Map opens the existing map; the prologue can be replayed from Chronicle → The March. A server route may offer a direct readable view of the complete static content. The public map resource contains only the authored legend, never hidden entities, current ownership or player positions.

Foxxi can later accept complete content through its advertised signed `foxxi.content_fragment` and `foxxi.xapi_author` affordances, owned by Hallowmarch. It requires an explicit valid competency reference supplied by the author; the catalog does not invent one. The fifth prologue page and contextual notes must be resolved honestly before authoring a complete instructional body. Personal consultation activity belongs to its verified actor's pod when that actor chooses to record it; an automatic popup, a catalog read and a completed page are not evidence of mastery.

Personal activity export is currently unavailable. A configured signed xAPI sink alone cannot enable it: the runtime also requires a trusted synchronous `learningDeliveryAvailable` port that confirms owner-pod-safe delivery for the exact actor, recipient and session before consent and capture. Linking an identity or authorizing OAuth pod access is not learning consent. This guard does not implement an owner-pod activity journal or establish that the current Foxxi transport can sign for a native player. That composition must be verified before supplying the port.

Previously stored consent cannot create new export entries while delivery or current identity proof is unavailable. Existing pending evidence remains intact, and consent can always be withdrawn. Optional export capacity never blocks a game command: a full queue retains its existing entries and records a bounded durable count and reason for omitted capture coverage. This count is not a learning or successful-delivery claim.

The read-only service exposes `/gaming/resources` (JSON, or HTML when requested), `/gaming/resources/view?id=…`, and `/gaming/resources/item?id=…`. Its advertised POST `/gaming/resources/query` accepts `{}` to list resources or `{ "id": "field-note:keep" }` to read one. `/gaming/resources/descriptor.ttl` links that action and its actual JSON schema; it requires the deployment's trusted public origin. `HM_PUBLIC_ORIGIN` overrides `RAILWAY_PUBLIC_DOMAIN`; request Host headers cannot choose advertised targets. This HTTP projection is not a signed pod publication.

I2IDL-X applies only to the **performance consulting layer**, not the game's model. `performance-consulting-alignment.json` pins the reviewed source release v0.0.90 / semantic profile0.4.0 and links verified concepts without copying their definitions. Its small reviewed resource annotations use aboutness (`dct:subject`), remain proposed, and carry a separate alignment revision digest. The local job-aid and reference roles have no asserted exact canonical equivalent. There are no automatic concept assignments to the rest of the lore, map or game entities. Consultation, learning and assessment remain distinct. `/gaming/resources/alignment.json` exposes that scope and evidence policy to consulting clients.

When the dedicated native game identity is configured, the host composes the same description and complete authored bodies into Hallowmarch's pod through the relay's discovered publication affordances. Content-addressed parts contain at most twelve resources each; a separate root links those parts and the callable bridge. Parts are verified before the root is published. This bounds RDF writes and lets an old root keep its existing part set if a later revision cannot finish. The generic publisher reuses Interego core/solid graph scoping and digests; the host supplies Hallowmarch's namespace and content.

`nativeDiscovery` in `/gaming/manifest` and `/gaming/status`, and `nativePublication` in the catalog, report actual background publication state. Only a verified complete composition exposes its root receipt. Native publication is independent from live command handling and retries are bounded. No player state, credentials or personalized note values enter these public graphs. This content/discovery release does not migrate player identities, personal saves, companion delegation or the legacy shared world.
