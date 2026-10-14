# The Hallowmarch: project handoff

**Status, 2026-10-14:** Version 19 is merged on `main` and published as a new artifact, https://claude.ai/artifact/KZMFoKYvezPNTxGVS4k4ya (private until the owner shares it): the version 18 artifact could not be updated without a session reading its whole 4.4 MB live source line by line. The March's own server runs from `main` on the owner's Railway (https://march-production-f6d9.up.railway.app/).

- **A war of weeks whose realms live their own life.** A season of 42 days (muster, war, reckoning) stepped by `src/08m_realm.js` in the page and, with loops's own module, on the server day and night: each realm's stores, works voted for, offensives announced two days ahead, armies and sieges by the numbers while nobody plays, and a returning player told what happened.
- **The war runs on the land.** Carts with escorts on the roads, stores yards, woodcutters and quarrymen, deliveries to the quartermaster, heavy packs, keeps taken with their stores.
- **Multiplayer.** Others in the artifact's room as bodies, foes and allies, parties, chat and the shared war; the server with accounts, saves, regions kept by the page there, a realm's roster and chat.
- **Weather that is real.** Systems that move with the wind, clouds ray-marched for every pixel, rain only under its cloud, no snow or rain inside any building.
- **Bodies that never break.** No foot left in the air, the bow drawn upright and bending, deaths flat on the floor, Cinderwing dead where it lies.

**Open points (see the Roadmap, row 80):** the season's armies as live bands near players, teams that last, the season's measures for many players, the weather shared from the server, whether a published artifact may reach the server, a measured answer on WASM, and a look at version 19's additions.

**Where things are**
- Source: https://github.com/markjspivey-xwisee/hallowmarch (private), branch `main`. Every feature branch so far is merged.
- Live build: https://claude.ai/artifact/KZMFoKYvezPNTxGVS4k4ya (version 19; version 18 at https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T). Server: https://march-production-f6d9.up.railway.app/ (Railway project `hallowmarch`, service `march`, from `main`).
- The repository's `CLAUDE.md` holds the same notes as below and is the copy to edit. This record mirrors it at each milestone.

**How to help:** read the requirements and conventions below, then pick up the first unfinished item on the roadmap. Several sessions work at once: follow CLAUDE.md's "Working alongside other sessions" (a branch for each piece of work, fast-forwarded into `main` after a rebase; a work note on Interego; this record written by compare-and-swap; the live artifact republished only from merged `main`). Test through `window.__hm` with the harness in `tools/`, and update this record when you finish a piece of work.
