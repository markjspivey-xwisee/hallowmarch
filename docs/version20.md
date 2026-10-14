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

The WASM test compares 4,000 seeded grids and 82 live paths, including parents. A live sample measured 7.7 ms in JavaScript and 3.6 ms in WASM (2.14 times faster for these searches); it establishes a benefit to the path kernel, not to overall FPS. A forced WASM memory failure also returns the original JavaScript result and disables the broken module.

## Verification evidence

- [Integrated checks at 28885ad](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38604947750): build/lint, nine model regressions, real company sockets and restart, season measures, browser company and season flows, live path comparison, shared weather, visuals, shaders, phone/touch flows, ten-minute soak, draw budgets and hour-long memory run.
- [Water fixture verification at ace5c77](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38606868351): the original water check plus diving, ice, boats and tracks.
- [High-quality draw budgets](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38607205436).
- [Season calibration, including held-out seeds](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38600478891).
- [Fixed-camera visual contact sheet](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38600843969).

The integrated run's original water measurement failed because nearby combat killed the wolf between depth samples. The revised fixture retains the exact staged actors, requires them to be alive, clears combat effects and steps the production water function directly for the speed measurement. The preceding chase still runs live AI and requires both bodies to follow the player into water. Assertions and speed thresholds are retained.

The draw benchmark now starts each quality in an independent seeded world. Earlier qualities' siege fires, rubble and masons advanced and changed the world used for later qualities. A controlled version 19/version 20 comparison showed identical draw counts before this isolation change. Water render chunks are larger, preserving grid coverage, positions and flow/ice values while reducing submissions. All original draw and memory limits remain in place.

[Final parser and water screenshot review](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38608679162) passed all six parser regressions, replayed the complete clean water2 output and exported four original high-quality screenshots for manual inspection. The underwater surface, lake and river boats, and ice views show no visible batching regression.

The CI wrapper turns printed failures into a failed job even when a diagnostic script returns zero. Lint uses pipefail so its output cannot hide an ESLint failure. The permanent workflow has read-only repository permission and tests checked-out source without merging or pushing branches.

All low, medium and high render views pass the original budgets. Forest: low 164 calls and 739,000 triangles; medium 204 calls and 1.56 million triangles. Over the hour-long war, from minute 10 to minute 60, heap growth is 4.1 MB, ArrayBuffers 2.3 MB, scene objects 26, geometries 53 and textures zero; all remain within the original limits. No simulation errors or non-finite positions were recorded.

The water follow-up produced no failed assertions and no runtime errors, including diving, ice, boats and tracks. Its job was initially marked failed because the CI wrapper read the elapsed label in `errors [164s] []` as malformed error data. The parser now removes only a numeric elapsed label, while retaining rejection of nonempty or malformed errors, printed failures and failing process exits. Unit fixtures and replay of the exact captured water output verify this correction. The source test's water behavior assertions were retained.

The first CI run on main also caught an older hard-coded float check: a short recruit correctly floated 1.23 m below the surface, while the assertion assumed an unscaled 1.3 m body. The player float check now measures the same 1.3 m clearance relative to body height and retains its 6 cm tolerance. It also exercises short (0.94), standard (1.0) and tall (1.06) bodies through the real motion simulation. [Focused verification](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38609976964) records the result.

## Rollout and remaining work

Production deployment a8bb13cb-2dcb-4706-9688-dc9895b0d332 reached SUCCESS. [Read-only deployment verification](https://github.com/markjspivey-xwisee/hallowmarch/actions/runs/38609568192) confirmed /health and byte-for-byte equality with the built HTML of 3161b65 (served HTML SHA-256 f4ca61d87049eacd37a62e79d1da75375789c0267cf5d59dff4ce243cea25d0f). The subsequent body-size test correction does not change the game build.

Railway production is connected to GitHub main, server/Dockerfile, the existing /data volume and the existing /health endpoint. A source push touching server/**, src/** or build.py deploys automatically. No account, company or season data is reset for this release.

The separate Claude artifact is still version 19. This environment has no Claude Artifact publication capability; an Artifact-capable session must read its current source and republish the build from merged main, omitting capabilities and icon.

Updating Georgio's shared Interego project graph is blocked by an agent-ID/DID registration mismatch: the bare ChatGPT subject verifies as signed ReadWrite, while publication derives a DID the gate reports as unregistered. No credentials or registrations were changed. Continuation is saved in the authenticated ChatGPT Interego pod; repository source and this record remain the reviewable work.

The older gameplay and balance limits in CLAUDE.md's Next row remain open. The relay still delegates detailed field simulation to clients; this release does not provide an authoritative server simulation of every blow.

## Graphics startup recovery

A production desktop report exposed a gap between software-renderer CI and the user's browser: Edge reported that the page's WebGL context was blocked after context loss, and a reload became unresponsive. A successful deployment and software-renderer checks do not establish compatibility with that GPU and driver.

The recovery URL `?safe=1` chooses the existing Low preset before any world generation or render-target sizing, requests the browser's default graphics preference, and keeps saved graphics settings and tablet detection from restoring High during that launch. The Graphics menu can still change detail after startup. This option reduces startup graphics demand; it does not override the browser's WebGL safety block.

Early graphics initialization failures now remove the loading veil, show the browser's actual context-creation message, and offer a manual low-graphics reload preserving the existing URL's server and other parameters. There is no automatic reload loop. If the browser continues refusing WebGL, closing and reopening the browser may still be needed.
