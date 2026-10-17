# Manual human coaching verification

This helper verifies the ordinary **Chronicle → Your path → Progress & coach** flow. It uses the already authenticated human and their current, confirmed private character. It creates no identity, replaces no key and synthesizes no gameplay observation or clock change. The optional followup mode performs one real ordinary ability input.

Importing the helper performs no I/O. An authorized retained native QA runner may call it only behind its explicit `HM_NATIVE_HUMAN_CONSULTING_LIVE_TEST=1` gate, after its existing owner, private-save, recovery and fixture checks pass:

```js
import { createHumanConsultingLiveQa } from './human-consulting-live.mjs';

const coaching = createHumanConsultingLiveQa({
  getPage: () => retainedPage,
  getOwner: () => originalOwner,
  gameOrigin: previewOrigin,
  relayOrigin,
  run: existingRunId,
  checkpoint: persistExistingFixtureIntent,
});
await coaching.run();
```

The owner is `{ accountId, subjectDid, podUrl }` from the original native session. `checkpoint` must durably fence `{ kind: 'coaching-delivery-intent' }` on the same existing fixture before allowing the one enable click. Keep the existing runner's native signing broker; this helper supplies no alternate signing or identity path. Do not reconstruct a completed or uncertain delivery in a new helper/page/fixture.

The helper opens the actual menu and Chronicle controls. Before enabling it verifies current milestone guidance and useful next steps with live sharing off and no coaching calls. It checks the visible disclosure of a 15-minute session, current milestone and small gameplay summary, excluded chat/inventory/other players' records, private plan retention and withdrawal. It then clicks **Enable live coaching · 15 minutes** once. There is no questionnaire or manufactured goal.

A transparent fetch counter and DOM observer retain only an in-page actual prepared payload and fixed delivery counters. They do not alter requests, responses, consent, signatures, time or gameplay. The helper checks that the product's real private request intent was confirmed before delivery; it never bypasses `saveNow` or retries delivery. An independent read-only native client opens the explicit `hallowmarch-performance-consultation/v1` checkpoint and verifies its authenticated native binding, owner-key record digest, native revision, exact observation, exact displayed Foxxi plan, human attribution and the two bounded recipient/task/session consent scopes. The descriptor CID identifies the stable binding; the native revision and record CID identify the current encrypted checkpoint. This does not claim a new descriptor signature for each save. It clicks **Stop live sharing** once, then checks both actual native withdrawals through read-only polling.

The private journal keeps one broad play-session task and its exact purpose/recipient/session consent scopes as milestones change. The service receives a separate strict observed focus: the current milestone, criterion, contextual summary and optional original owned-body identity. Readback checks that stable private task independently from the exact focus serialized by the actual Foxxi adapter. A different human/agent performer or another owner's unit cannot satisfy that focus check.

For an explicitly authorized ongoing-coaching check, pass `automaticFollowup: true` (default `false`). The retained native runner additionally gates this mode with `HM_NATIVE_COACH_FOLLOWUP_LIVE_TEST=1`. Its existing durable fixture checkpoint must accept `{ kind: 'coaching-followup-intent' }` as well as the initial delivery intent. Both fences belong to the original fixture; the runner must refuse an already uncertain/completed fence rather than recreating a helper or fixture.

After independent readback of the first actual plan, this mode holds the Coach menu open for at least **120,000 milliseconds of real browser `performance.now()` elapsed time**, checking every second. It durably checkpoints the followup intent before closing the menu or producing the second request. It clicks the actual **Resume** button, brings the page to the foreground, confirms the same living human is focused, outside combat and outside text input, and calls `page.keyboard.press('1')` exactly once. There are no simulated activity events, manual Ask clicks, re-enables, clock overrides or input retries. A real product-recorded `ability.executed` or `ability.refused` counter increase for the human body must follow; a companion's activity cannot satisfy it.

The product must then request its second consultation automatically. The passive observer retains two distinct actual prepared payloads and verifies each product-native private delivery intent. Independent encrypted journal readback must contain the first verified record unchanged plus the second exact displayed plan and observation, with distinct situation/observation/consultation IDs and the same broad task, original owner and consent session. The helper reopens Coach through actual navigation before Stop, withdraws both exact scopes and permits only read-only withdrawal polling. An extra delivery or an uncertain stage fails and stops sharing. A retained retry never presses the key again or enables another session.

Successful optional mode reports `realElapsedFollowup`, `changedOutcome`, `automaticFollowup`, `distinctSituation`, `exactSecondPrivatePlan` and `twoDeliveries` as true. `singleDeliveryAttempt` remains truthful: true for the default one-delivery check and false after the optional two deliveries. These flags verify observed behavior and retention; they do not claim that coaching improved performance.

Only safe booleans and fixed stage names leave the page. Do not capture traces, HARs, raw errors, browser storage, native bearers, signed envelopes or private journal contents. A failure retains the same helper state and never re-clicks Enable. Inspect its fixed `status()` and the existing fixture fence; do not start over with another identity. If a delivery happened but verification failed, this helper stops sharing and refuses to deliver again.

`node --test tools/manual/human-consulting-live.test.mjs` runs isolated fake-page/VM guards, including fake elapsed time, input ordering, uncertainty, separately captured situations and two mock native records. Those tests establish helper behavior only. They are **not evidence of a real Foxxi reply, native persistence, live withdrawal, independent agent consulting or improved player performance**. Completion still requires an authorized actual preview run with the original owner, actual Foxxi response(s), verified encrypted journal/digest readback, exactly one delivery by default or exactly two in optional mode, and confirmed withdrawal. Optional mode additionally requires the actual real wait and actual ordinary ability outcome. This helper itself launches no browser or production deployment.
