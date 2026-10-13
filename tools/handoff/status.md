# The Hallowmarch: project handoff

**Status, 2026-10-13:** Version 18 is merged on `main` and published.

- **The war's holds are real.** A broken gate is mended behind a scaffold by the keep's masons and hung at full strength. A thinned keep sends for a column from the realm's nearest keep. Garrisons sally only when it pays, and a pact keeps faith in the field. No campaign is won before its twentieth minute, and soldiers no longer stand penned in towers and on walls.
- **The callings are within the aim where version 17 left them out.** Blunt arrows break a spell only from a full draw. A young priest's spell is paused by a stun, not broken. The Ash-Crowned's crown of ash turns holy light, and the measures are steadier.
- **The late game is alive.** Risen bears rear and wolves crouch. Every risen kind has a second move, and champions are marked by embers. Hosts of the risen roam the frontier past 40. The veteran's standard is a swallow-tailed one, and the Deep Barrow remembers its state and has its own air.
- **The world was looked at again.** The deep's pitch is drawn, its seal and floors smoulder, the broken gate's leaf lies against the passage, and How to play fits one screen on a small phone.
- **The owner's reports while fitting were put right:**
  - Robes and tabards no longer stretch far out at a run.
  - Storm cloud hides the moon and stars.
- **Testing.** The whole suite ran on the merged build: `tools/tests/*.py`, `tools/soak.py 10`, `perf.py ... budget`, and campaign soaks at low and medium.

**Open points (see the Roadmap, row 72).** The owner has asked for:
- Every way of working the land made needed and valuable, with loops within and between the realms.
- Multiplayer on a spectrum up to a persistent March of many players, with accounts and saves. The server would go on the owner's Railway once that is connected.
- Real clouds and weather systems.
- No snow inside buildings.
- No walking leg left in the air.
- Weapons held as weapons.
- Cinderwing's death pose fixed.
- A measured answer on WASM.

Also open:
- At low, campaigns now run to the hour's renown rule.
- At medium, the forest and siege views go over the call budget.
- The skilled archer's margin against the Ash-Crowned is thin.

**Where things are**
- Source: https://github.com/markjspivey-xwisee/hallowmarch (private), branch `main`. Every feature branch so far is merged.
- Live build: https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T (Claude artifact).
- The repository's `CLAUDE.md` holds the same notes as below and is the copy to edit. This record mirrors it at each milestone.

**How to help:**
1. Read the requirements and conventions below.
2. Pick up the first unfinished item on the roadmap.
3. Test through `window.__hm` with the harness in `tools/`.
4. Push to a feature branch to be merged.
5. Update this record when you finish a piece of work.
