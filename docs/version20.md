# Version 20 verification and rollout

The four saved version 20 branches are integrated: persistent companies, live season armies, measured WebAssembly way-finding and the look7 pass. The client also receives shared weather from the server.

## Source and behavior

| Saved work | Original commit | Result |
|---|---|---|
| Companies | 8c20b399164ccd95984b5f3f7c3116eae6b99557 | Persistent membership, ranks, invitations, chat, notices and pledges. Stale invitations and inherited-key handling fixed; rapid UI requests queued at the server's pace. |
| Season armies | d9539934d435d642f34bc3f338dc050a1da91ad9 | Armies enter the live war under one region keeper and return losses to the season. Invalid completion cannot orphan a live lease; handover and disconnect return control. |
| Performance and weather | 20a7b35669e8bbe17bb8806d1b4eb1e3e062e713 | WASM paths agree with JavaScript and fall back on module/search errors. Sanitized shared weather survives the profile decoder. |
| Visual pass | 364a714ef09c8494045c2185ca668053beafcef2 | Cart, yard, worker, cloud, death and weapon fixes retained and reviewed through eight fixed screenshots. |

An authenticated welcome sends the realm profile before actions, fixing company operations immediately after reconnect. Realm delivery points saturate at 35 per day at 1,500 units: the original 12 seeds and 24 held-out seeds retain participation benefit and keep the roster advantage within the existing test's 35% limit. These are simulation results, rather than a claim of balance across a live player population.

The WASM test compares 4,000 seeded grids and 80 live paths, including parents. A live sample measured 12.2 ms in JavaScript and 6.9 ms in WASM (1.77 times faster for these searches); it establishes a benefit to the path kernel, not to overall FPS. A forced WASM memory failure also returns the original JavaScript result and disables the broken module.

## Verification evidence

- [Integrated checks at 28885ad](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38604947750): build/lint, nine model regressions, real company sockets and restart, season measures, browser company and season flows, live path comparison, shared weather, visuals, shaders, phone/touch flows, ten-minute soak, draw budgets and hour-long memory run.
- [Water fixture verification at ace5c77](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38606868351): the original water check plus diving, ice, boats and tracks.
- [High-quality draw budgets](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38607205436).
- [Season calibration, including held-out seeds](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38600478891).
- [Fixed-camera visual contact sheet](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38600843969).

The integrated run's original water measurement failed because nearby combat killed the wolf between depth samples. The revised fixture retains the exact staged actors, requires them to be alive, clears combat effects and steps the production water function directly for the speed measurement. The preceding chase still runs live AI and requires both bodies to follow the player into water. Assertions and speed thresholds are retained.

The draw benchmark now starts each quality in an independent seeded world. Earlier qualities' siege fires, rubble and masons advanced and changed the world used for later qualities. A controlled version 19/version 20 comparison showed identical draw counts before this isolation change. Water render chunks are larger, preserving grid coverage, positions and flow/ice values while reducing submissions. All original draw and memory limits remain in place.

The CI wrapper turns printed failures into a failed job even when a diagnostic script returns zero. Lint uses pipefail so its output cannot hide an ESLint failure. The permanent workflow has read-only repository permission and tests checked-out source without merging or pushing branches.

Final performance and water results are recorded when their runs finish.

## Rollout and remaining work

Railway production is connected to GitHub main, server/Dockerfile, the existing /data volume and the existing /health endpoint. A source push touching server/**, src/** or build.py deploys automatically. No account, company or season data is reset for this release.

The separate Claude artifact is still version 19. This environment has no Claude Artifact publication capability; an Artifact-capable session must read its current source and republish the build from merged main, omitting capabilities and icon.

Updating Georgio's shared Interego project graph is blocked by an agent-ID/DID registration mismatch: the bare ChatGPT subject verifies as signed ReadWrite, while publication derives a DID the gate reports as unregistered. No credentials or registrations were changed. Continuation is saved in the authenticated ChatGPT Interego pod; repository source and this record remain the reviewable work.

The older gameplay and balance limits in CLAUDE.md's Next row remain open. The relay still delegates detailed field simulation to clients; this release does not provide an authoritative server simulation of every blow.
