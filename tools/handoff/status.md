# The Hallowmarch: project handoff

**Status, 2026-10-10:** Version 9 is merged on `main` and published. It adds the year's seasons across the land (broadleaves turning and bare in winter while pines carry snow, blossom and apples in season, the meadow and its flowers through the year, snow lying by local warmth, Thule's lakes and the high tarns frozen in deep winter so you can walk and fish on them, gardens in every town), balance and mastery of the callings (simple and skilled bots, a balance run with mastery duels, diminishing returns on stuns, roots and slows, a priest's offer to raise the fallen player), depth for the version 8 systems (bushes and apple trees that burn, fall and grow back, stumps grubbed out, pheasants and ducks, crafting to item level 50 with nine masterworks, hip roofs, lean-tos, leaded glazing, wells, built doors used by everyone, hens that lay and hatch, a hound that herds, bands that guard their engines), and phones and performance (levels of detail, grass by quality, far work at a lower rate, the HUD laid out on every screen, 40 px touch targets, names not shown through walls). The four branches were fitted together and checked by the full suite (`tools/tests/*.py`, `tools/soak.py 10`).

**Open points (see the Roadmap, row 26):** pack survival and duels between the callings are not yet within the ±15% aim (priests outlast packs at level 50, archers trail; mages lose duels at 30 and 50); drops stop at item level 22, so crafted gear is the stronger path late; tower interiors and hatches; diving and boats; the forest view at low quality is a little over its triangle budget.

**Where things are**
- Source: https://github.com/markjspivey-xwisee/hallowmarch (private), branch `main`. Every feature branch so far is merged.
- Live build: https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T (Claude artifact).
- The repository's `CLAUDE.md` holds the same notes as below and is the copy to edit. This record mirrors it at each milestone.

**How to help:** read the requirements and conventions below, then pick up the first unfinished item on the roadmap. Test through `window.__hm` with the harness in `tools/`, push to a feature branch to be merged, and update this record when you finish a piece of work.
