# Reviewer playability contracts

This pass improves the experience from first entry through choosing an objective,
fighting, and returning to the game. It preserves earned characters, world history,
identity ownership checks, and learning consent.

## Player-facing behavior

- **Onboarding:** an explicit new-character Begin request keeps its prologue
  through slow startup. Continuing a recovered character does not replay it.
  Keyboard dismissal remains trusted player input.
- **Objectives:** Track objective selects an unfinished deed and updates its
  instructions and map guidance. Selection survives the normal character save;
  it grants no XP, reward, completion, or learning event. The activity dashboard
  retains the earliest unfinished canonical step independently of that selection.
- **Bounties:** offers describe living, suitable quarry rather than authored camp
  tiers. Existing accepted progress is retained. When no suitable quarry is
  available, the herald explains this and offers no fabricated acceptance action.
- **Combat:** pointer selection, target cycling, and selected nameplates respect
  walls and closed tower floors. Failed cast completion explains a lost target
  or insufficient power without changing the underlying combat rules.
- **Menus:** Continue resumes the saved character. Progress has one persistent
  menu destination; Chronicle → Your path contains objective tracking. Activity
  history remains distinct from guided objectives. Reading records never enables
  recording or grants access. See [the menu action contracts](menu-usability.md).
- **Effects and recovery:** Settings offers a browser-local reduced-effects
  preference that follows the device by default. Shake, screen flashes, and
  lightning flicker are suppressed while lightning mechanics remain intact.
  Reduced effects disable transitions rather than assigning a tiny duration to
  every property; control size, handedness and screen insets apply immediately.
  Failed dependency loading exposes a retry; a late successful download clears
  that notice and continues startup.

## Verification entrypoints

After building, run the focused Node regressions for `objective_guidance`,
`combat_targeting`, and `presentation_accessibility` under `tools/tests/`, plus
`startup_file_guard.browser.test.mjs`. Actual-game checks are
`tools/tests/objective_tracking.py`, `combat_targeting.py`, and
`menu_usability.py --strict`. The phone gate includes `mobile_hud.py` and
`mobile_hud_tap_regression.py`.

Touch automation waits for the observed click, the closed sheet, and released,
visible, hit-testable gameplay controls. The exact timing mechanism behind the
recurring phone CI transition remains unconfirmed; persistent failures must
retain bounded state diagnostics.

## Native graphics verification

The normal sky reproduced a graphics-context loss in an isolated 64 × 64 RGBA8
view on a GTX 980 Ti / ANGLE D3D11, without world geometry, HDR or MSAA.
Base sky, cosmos and the direct cloud-dome path passed separately; the screen
cloud helper reproduced the failure. Explicit texture LOD alone did not fix it.

`cloudScreen` now selects its original dome sample or four screen samples before
calling `cloudLitDir` once. The cloud lighting, coordinates, averaging, filtering,
original procedural noise and recovery sky remain intact. The original full
normal sky with only this refactor compiled, linked, drew and completed a GPU
fence in a fresh native Edge process with default protections and no overrides.
The before/after result supports this small compiler-path workaround; it does
not identify a specific driver/compiler defect. Experimental noise-texture and
shared-helper rewrites were discarded.

The full native game then passed all 43 title submissions and the combined fence,
real entry/prologue/movement/menu controls, active screen weather and day/night
rendering, with all 74 exercised programs healthy. This was an offline synthetic
character, not a hosted account or shared-world session.

One instrumented cold-profile run took 115.1 seconds to Ready and exposed an
approximately 18-second first-play page stall while further programs appeared.
An equivalent fog-expression factoring passed numerical and native correctness
checks but took 117.9 seconds in its comparison run; it was rejected as an
unproven optimization. The retained title scheduler prepares only supported current-view materials in
a four-program window, at most four preparation calls per turn. Every original
real draw and fence, and the combined visible-frame gate, remain mandatory.
Recovery and unsupported cases keep the serial path. Visibility/resize changes
drain a stale window before replanning; context, link and GL failures stop it.

One existing common-avatar depth program is also prepared with its real shadow
camera, scene and target. This dependency has separate receipts; it is not a
pretend shadow draw. Low/shadows-off, recovery, indoor, unsupported or ambiguous
cases skip it. It creates no mesh/material/target object and does not populate
actors or change ownership/input admission.

The controlled pair on the same GTX 980 Ti measured Ready at 43.715 / 50.038
seconds and Play-to-verified-control at 15.418 / 7.642 seconds without / with the
avatar dependency. Its first actual shadow draw changed from a 7.315-second
cold setup to a 1.9 ms cached submission. Trace captures placed the first unobstructed
world after Escape at 11.311–11.573 / 3.645–4.045 seconds. These are one paired
cold-profile measurement, not a multi-run benchmark or pure key-handler latency.
Loading still has visible pauses; do not claim smooth or instantaneous startup.
Optional weather-gated sky effects are checked when actually active, rather than
requiring a fixed shader-program total.

Bird-only instance pools and their proxies stay hidden while their committed
count is zero, and reappear after population at either detail level. The generic
crowds and title human preparation are unchanged. Actual-game near/far checks
confirmed populated color/shadow submissions and no empty bird submissions.
First sight of a real bird can still require its shader compilation.

## Loading and first-entry follow-up (2026-10-29)

World and dungeon map images are built in four-row slices with bounded tree
stamps and complete-only publication. Mutable heights, trees and dungeon inputs
are snapshotted at the original call boundary; synchronous public callers still
drain the same work. A pinned deployed-source oracle checks exact image bytes
and ordered canvas commands, including mutations between slices. The final canvas
upload remains atomic and requires native measurement.

The combined preparation queue retains every original family draw and fence and
the combined first-view fence. Entry and current-view work share one bounded
queue; program reflection occurs only after its whole linked wave drains.
Identity, private reads, character admission, consent and earned progress retain
their existing gates. Deterministic meadow RGB is prepared in four-row slices;
its live canopy alpha and first-use texture publication remain unchanged.
Yearly snow and ice settling preserve every Float32 store, clamp, byte and final
unrounded threshold decision, with independently pinned deployed-source oracles.

After existing settings/world hydration, eligible players can edit a character
draft over an opaque background while graphics prepare. Begin, Continue, random
names and account changes stay locked until the existing Ready gate. The same
preparation phase disables the panel's redundant backdrop blur; the normal title
filter returns when the checked world is shown. The same
owner keeps typed choices; cancellation restores pre-draft choices. An anonymous
preview requires the existing successful null metadata read and grants no private
absence, identity admission or save authority. Late private reads still defer
their normal title hydration until Ready.

Focused name editing keeps the field within the form's visible area when the
phone viewport shrinks. Its draft-local listeners and pending frame are removed
on Ready, cancellation, failure or ownership changes. The original near/far
mountain crag resources also enter the bounded outdoor entry queue: a low-detail
phone test exposed a 2.507-second first-use compilation when a previously empty
title-camera list gained real instances. Preparation changes no instance count,
visibility, camera or shader; unsupported resources retain the normal draw path.

Pooled scene/material guards and backoff on unchanged sealed waves reduce polling
work. In sequential native Edge / GTX 980 Ti local fixtures, pooled fixed polling
used 17.326 seconds of guard CPU, while bounded 10–100 ms idle backoff used
3.364 seconds. Preparation-loop turns fell from a 391.3 ms maximum to 17.3 ms.
Ready was 94.032 / 95.536 seconds in those runs: this pair does not establish a
total-loading speed improvement. The backoff recording also contains a separate
85 ms setup task and an unattributed 1.16-second frame-callback gap. Those are
retained open findings, not evidence that all startup pauses are fixed.

A fresh deployed-build control took 125.912 seconds to Ready and recorded 559 ms
and 222 ms first-entry long tasks. The later backoff candidate recorded 424 ms
and 113 ms entry tasks, with no new entry programs and exact weather/shadow
program reuse. These are single sequential runs, not input latency, displayed
FPS or statistically isolated benchmark results. They precede the final ice and
character-draft changes; final frozen-build evidence must be recorded separately.

An eight-program experiment reached Ready sooner but produced a 2.991-second
preparation task, so the four-program limit remains. An audio impulse cache passed
byte/RNG equivalence but regressed cold lite cases and added temporary memory;
it was rejected. All failed and rejected native trials remain in the evidence.

## Release limits

Three- and five-minute ordinary SwiftShader title failures are retained as a
regression, alongside the deployed control's 16.828-second Ready receipt.
With bounded map work and the redundant preparation-panel blur removed, the next
software title reached Ready at 21.531 seconds with all 43 family and combined
fences, unchanged world state and zero preparation RNG calls. The original
three-minute software allowance is restored; native/product deadlines and every
shader/draw/fence/state assertion remain unchanged. This is a small rendering-path
workaround, not proof of a specific browser/driver defect or a native benchmark.

Fresh full CI and desktop/phone verification must run on the final frozen build,
with its exact hash and inspected screenshots. The isolated shader result must
also be followed by native full-game startup and weather/day/night checks.

These are engineering and agent playability checks. They are not a human player
study, independent reviewer approval, or AAA certification.
