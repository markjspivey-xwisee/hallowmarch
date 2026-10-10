# The Hallowmarch: project handoff

**Status, 2026-10-10:** Version 10 is merged on `main` and published. It adds gear that keeps up to level 50 (drops, champions' spoils, hoards and merchants at about the level, masterworks a little above a drop of their grade) and the callings tuned again in fair gear; every body's motion measured from what its shaders draw and fixed (planted feet, short steps when slow, leaning into turns and climbs, the game birds' own flight, Cinderwing's take-off and landing); the mountains up close (unreachable faces reshaped, about a thousand crags, the rock in beds of their own tone with lit lips and shaded undercuts that hold the snow, scree of loose angular stones, heather, snow lines by altitude, realm and season); the stone keeps' corner towers hollow, with doors, rooms, ladders and hatches; diving in three dimensions, rowing boats at every town's jetty, and tracks in snow, mud and wet sand. The four branches were fitted together and checked by the full suite (`tools/tests/*.py`, `tools/soak.py 10`): companions now find their way round banks and walls, townsfolk round houses and fences (`localPath`), and the first look of the mountain rock, which read as masonry, was reworked before publishing.

**Open points (see the Roadmap, row 32):** towers for every keep (gate towers, Ériu's lookouts, Thule's timber towers) and fighting on a ladder; the mountains' walkable slopes keep smooth cone outlines; the warrior's answer to kiting before level 30 and the warrior-priest and priest-archer counters at 30 and 50, with the balance table re-measured on a quiet machine; a galloping horse's hooves slide about 8 cm a stride; bodies do not push boats; tracks are not saved.

**Where things are**
- Source: https://github.com/markjspivey-xwisee/hallowmarch (private), branch `main`. Every feature branch so far is merged.
- Live build: https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T (Claude artifact).
- The repository's `CLAUDE.md` holds the same notes as below and is the copy to edit. This record mirrors it at each milestone.

**How to help:** read the requirements and conventions below, then pick up the first unfinished item on the roadmap. Test through `window.__hm` with the harness in `tools/`, push to a feature branch to be merged, and update this record when you finish a piece of work.
