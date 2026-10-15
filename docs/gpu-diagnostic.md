# Isolating a startup graphics loss

The reduced graphics launch still lost its context on the affected desktop before the GPU completed its first view. The Ready checkpoint records CPU submission; it cannot establish that drawing succeeded. Software-renderer CI does not reproduce this hardware failure.

Use `?safe=1&gpuDiag=1` for an opt-in isolation run. It reads the existing world and settings but never starts a character, simulation, title warm-up, ordinary frame loop, or save. The page waits for a manual selection before each draw. Each submitted batch is followed by a WebGL2 fence, flushed once and polled with zero timeout on later tasks. A stage completes only when the GPU signals it. A timeout, shader failure, or lost context stops the run.

Start in a browser session where the independent WebGL2 test still renders. Run one stage at a time, checking the displayed result before continuing. After a loss, stop: a broken browser graphics session cannot provide meaningful further draw results. Do not repeat normal game launches against that session. No browser security flags, graphics blocklists, or OS timeout settings need changing.

Before the trail stage, family draws sample a neutral one-pixel trail texture; the trail stage initializes the real targets and the combined view uses them. A completed fence with zero family draw calls is labeled unexercised.

The stages separate a simple cube, the byte scene target and composite, the actual scene families, offscreen helpers, and the combined view. A failed stage narrows the rendering family; it does not by itself prove a particular shader expression or driver defect. A successful diagnostic is also not a hardware gameplay soak.

The existing normal and reduced launches remain available. Do not label the recovery fixed until the affected browser can render the game and then still render the independent WebGL2 test.
