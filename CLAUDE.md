# Working notes for The Hallowmarch

Read this before changing anything. It covers what the game is, the owner's standing requirements, how the code fits together, how to test it, and what is planned. The same handoff is also kept in the owner's Interego pod as the graph `urn:graph:project:hallowmarch`, updated at each milestone.

- **Owner:** Mark (GitHub `markjspivey-xwisee`)
- **Repository:** https://github.com/markjspivey-xwisee/hallowmarch (private). Work on `main`, commit often, and push at each milestone.
- **Live build:** Claude artifact https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T, which is private to the owner. It is published from the built `hallowmarch.html` with capabilities `{db:{}, user:{}}`. When you republish to that URL, omit `capabilities` so the stored set is kept.
- **Published:** Version 5 (loot, merchants, the Barrow and the Hollow King).
- **In progress:** Version 6 (see Roadmap).

## The owner's standing requirements

These apply to every change, not only to the feature that prompted them.

1. **Original work only.** The game is inspired by the three-realm war structure of the old realm-versus-realm MMOs. It uses no names, classes, places, lore, art, UI or branding from them or from any other game. Do not draw known characters or logos.
2. **Everything real and functional.** If something is drawn, it works:
   - Doors and gates open, and stairs and ramps lead up to the wall walks and towers.
   - A guard standing on a wall walked up there.
   - Nothing floats, clips through other objects or vanishes. Banners must not swing into walls.
   - Animations match what the body is doing.
3. **A reactive world:**
   - Trees can be chopped or knocked down, grass cut or set alight, and the ground cratered.
   - Walls, gates and houses break and can be repaired.
   - Houses have doors and shutters that open and close, and real interiors you can see through the windows and walk into. They can be set on fire: the fire spreads, the walls char, the roof falls in, and the house is rebuilt later.
4. **Gear lives.** Armour and clothing get dirty, wet, bloodied and damaged, and can be cleaned and repaired.
5. **Weather acts on everything.** Rain wets surfaces and cloth, snow settles on upward-facing surfaces, thunderstorms strike and set things alight, and sun dries and melts.
6. **It must look great.** Every feature ships with its own model and shader work, and visual quality is part of "done".
7. **Late game stays interesting.** The level cap is 50. Content past 20 must scale with the player, and later levels bring new abilities, ranks and goals.
8. **Players know what to do.** There is lore, onboarding and clear objectives:
   - A playtester said the armies' choice of targets "seems random" and that nobody ever wins.
   - Army orders must be visible and steerable.
   - Campaigns must be winnable.
9. **Phones too.** Every feature works with touch, and at all three quality levels (high, medium, low).

## Build and run

- Run `python3 build.py`. It concatenates `src/page.html` and every `src/NN[a-z]_*.js` module in filename order into one `<script type="module">`, and writes `hallowmarch.html`. three.js 0.160.0 is imported from jsDelivr.
- All modules share one top-level scope after concatenation:
  - Top-level names must be unique across files. `tools/lint.sh` reports redeclarations.
  - No module may contain a closing script tag; `build.py` refuses to build if one does.
- Load order is filename order, but most cross-module references happen at call time. A module can use functions from later modules inside functions, not at top level.

## Testing

The harness lives in `tools/`:

- `hm.py` is a scriptable runner.
- `hmlib.py` provides `setup()`, used by the test files.
- Both load the page wrapped like the claude.ai host does, serve three.js from `tools/node_modules`, and stub web fonts.
- Chromium runs with SwiftShader (software WebGL), so expect about 30–90 s to boot and a slow frame rate.

**Workflow for any change:**

1. `tools/lint.sh` must report 0 errors. A few unused-variable warnings are known.
2. `python3 tools/tests/shaders.py`: every shader program compiles at high, medium and low, by day and by night. If you touch indoor rendering, also check inside the Barrow (see `tests/barrow.py`).
3. Write a focused test for the feature through `window.__hm`:
   - Use `__hm.simulate(seconds)` to advance game time deterministically.
   - Do not wait on wall-clock timers; they run slowly under SwiftShader.
4. Take screenshots from a fixed camera and look at them:
   - Set `__hm.UI.modal = 'menu'; __hm.CAM.mode = 'fixed'`, then position `__hm.camera`.
   - Use `page.screenshot(timeout=300000)`.
5. For war or AI changes, run `python3 tools/soak.py 10`. It must show no errors and no non-finite positions.
   For abilities, scaling and camps, run `python3 tools/tests/level50.py shots`.
6. Check the phone layout with `python3 tools/tests/phone.py`.

**Debug API (`window.__hm`, defined at the end of `13_main.js`):**

- `ready` and `errors`: the boot flag and every runtime error caught.
- `start({realm, cls, level})` starts a game. `realm` is 0 Logres, 1 Ériu or 2 Thule; `cls` is `warrior`, `archer`, `mage` or `priest`.
- `simulate(sec)` runs the fixed-step simulation and returns a war summary.
- `teleport(x, z)`, `setTod(p)` (time of day) and `look(yaw, pitch, dist)`.
- `frame()` renders one frame; `renderInfo()` returns draw calls, triangles and programs.
- `GAME`, `WAR`, `ENT`, `UI`, `CAM`, `DUN`, `INDOOR`, `BARROW`, `BARROW_STATE`, `INV`, `LOOT`.
- `dbg.*` exposes renderer internals; `fn.*` exposes most game functions.

## Architecture

| Module | Role |
|---|---|
| `00_util.js` | Maths, noise and random helpers |
| `01_world.js` | World layout (realms, sites, lakes, navigation graph), heightfield, masks, colliders (`COLL`, `addBox`), `heightAt` / `isWalkable` / `zoneAt` |
| `02_render.js` | Renderer, `QUALITY_PRESETS`, shared uniforms `U`, `mat()` / `shareMat()`, GLSL chunks, sky, post-processing (bloom, light shafts) |
| `03_terrain.js` | Terrain, water, grass, flowers, trails, decals |
| `04_props.js` | Building materials (`MAT` ids and the building shader), keeps, temples, doors, banners, relics, rocks, hero tree |
| `04b_town.js` | Towns: framed houses, roofs, chimneys, yards |
| `04c_trees.js` | Near-camera trees: bark, branches, leaf cards |
| `04d_barrow.js` | The Barrow: the surface mound and the dungeon grid and geometry; indoor mode (`INDOOR`, `setIndoor`, `travel`) |
| `05a_rig.js` | Characters built in code: skinned humanoids and beasts |
| `05b_actors.js` | Instanced, vertex-animated crowds; particles; glows |
| `05c_beasts.js` | Wolves, boars and bears on a three-joint leg rig |
| `05d_fire.js` | Fires, braziers, flashes; `gatherLights` picks the point lights for each frame |
| `05e_weather.js` | Rain, storms and lightning, northern snow, mist |
| `05f_juice.js` | Slash trails, impact flashes, hit-stop |
| `05g_spells.js` | Spell visuals: terrain-draped ground marks (`spellDisc`: frost, holy circle, renewal, shockwave, cracks, scorch), lightning and tracer ribbons (`spellRibbon`), columns of light (`spellPillar`), spell weather (`spellEmitter`) |
| `06_data.js` | Classes, abilities, monsters, names, progression (`LEVEL_CAP`), realm ranks |
| `06b_items.js` | Item quality, slots, generation, stats, how gear looks |
| `07_entities.js` | Entities (`makeEnt`, `ENT`), stats (`setupStats`), combat (`dealDamage`, `killEnt`), abilities, projectiles |
| `08_ai.js` | Monsters, garrisons, warbands, realm commanders, relics; `WAR` state |
| `08b_wildlife.js` | Deer, birds, bats, butterflies |
| `08c_dragon.js`, `08d_dragon_ai.js` | Cinderwing: the model and its behaviour |
| `08e_barrow.js` | The Barrow's dead: packs, flow-field pathing, the burning gallery, chests, the Hollow King fight |
| `09_player.js` | Input, camera, movement, targeting, interaction |
| `09b_mount.js` | Horses |
| `09c_loot.js` | Inventory, drops, merchants, potions |
| `10_ui.js` | Title, HUD, maps, menus, nameplates, log, help |
| `10b_kit.js` | Equipment, bags and shop screen |
| `11_audio.js` | Synthesised sound effects and ambience (Web Audio) |
| `12_save.js` | Saves: `claude.use('db')` document `data/users/<uid>/save`, falling back to localStorage `hallowmarch.save.v1`; `validSave()` sanitises |
| `13_main.js` | Boot, `startGame`, `simStep(dt)` (fixed step), `tick(dt)` (frame), quality switching, `__hm` |

### Conventions worth knowing

**World**
- y is up. The map is a square centred on the origin.
- Each realm sits on a bearing: Logres 150°, Ériu 270°, Thule 30°. `rp(R, along, lat)` places a point on a realm's axis, measured from the centre.
- Per realm: two keeps at `along` 118 (lateral ±64), a temple at 170, the muster at 214 and the town at 378.
- The frontier is inside `R_RING`.
- The Barrow's dungeon lives off-map at x > 1000. `heightAt`, `isWalkable` and `zoneAt` defer to its grid there.

**Materials**
- Every material is a `THREE.ShaderMaterial` made with `mat()`. All of them share the live uniforms in `U`: time, sun, fog, wetness, snow, night and so on.
- Weather and time of day therefore reach every shader through `U`. New shaders should read the same uniforms.

**Buildings**
- Buildings are merged geometry with a per-vertex material id (`MAT` in `04_props.js`: stone 0 … rock 15, drystone 16).
- The building shader branches on that id. To add a surface type, add an id and a shader branch.

**Characters**
- Characters are instanced crowds. The per-instance attributes are in `HUMAN_ATTRS`: `iPos`, `iAnim`, `iColA`, `iColB`, `iMisc`, `iStyle`.
- `iColB.a` packs flags:

  | Bits | Meaning |
  |---|---|
  | 1 | bone |
  | 2 | troll |
  | 4 | hunched |
  | 8 | mounted or seated |
  | 4–6 | glow kind |
  | 7–8 | glow strength |

**Lights**
- Real point lights are capped at 12, 8 or 4 depending on quality, chosen each frame by `gatherLights`.
- `addFire(x, y, z, size, ghost, until, light)` takes an optional light reach `{r, k}`.

**Collision**
- `COLL` holds boxes and circles in a spatial grid. The Barrow also uses it for line of sight.

**Indoors**
- `setIndoor(true)` hides the outdoor group, swaps the lighting and turns off shadows and light shafts.
- `regroupOutdoors()` runs every frame so that rebuilt grass stays in the outdoor group.
- Meshes that must stay visible in both modes set `userData.keep`.

**Entities**
- Factions: 0–2 are the realms, 3 is `FACTION_MONSTER`, 4 is `FACTION_NEUTRAL`.
- Roles scale stats through `ROLE_MULT`. Gear is applied in `setupStats`.
- Standing stat adjustments go in `e.tweak` (`hp`, `dmg`, `rangedRange`, `swing`, `meleeRange`, `speed`). `setupStats` reapplies them, so they survive a level change.
- `e.motion` moves a body by itself: `spin` (whirlwind) or `leap` (a parabola to a landing spot). `updateMotion` runs for the player and for NPCs.

**Scaling past 20**
- `warLevel()` is the player's level, clamped to 20–50.
- Realm units keep their offset from it in `e.wlOff`: soldiers −5 to 0, guards 0, lords +4, hallow-wardens +2, muster wardens +10. Gates are +2, and their HP scales with damage.
- Barrow monsters keep `e.baseLevel` plus `barrowBoost()`. The dragon is `max(24, warLevel + 4)`.
- `rescaleWar()` runs at game start and on every level-up past 20.
- Ability potency rises by rank: `rankMult(level)` adds 12% for every ten levels past 20.

**War AI**
- Each realm commander issues orders: `attack`, `defend`, `raid`, `carry`, `retrieve`, `patrol`.
- A warband works through the phases `travel`, `siege`, `assault`, `hold`.
- Keep doors are entities that let their owners pass. Relics are called "hallows" in game.

**Saves**
- Old saves must always keep loading.
- When you add fields, default them in `startGame` / `validSave` and include them in `coreKey`.

### Gotchas

- Grass and flowers are rebuilt when quality changes. Anything rebuilt at runtime must go back into the right group; see `regroupOutdoors`.
- Do not shadow common globals inside functions; a stray `P` in `gatherLights` once broke the build.
- Under SwiftShader, screenshots need a long timeout (300 s), and in-page timers lag behind wall time.

## Roadmap

| # | Work | Status |
|---|---|---|
| 1 | Level cap 50. Frontier, Barrow and dragon scale with the player past 20. Borderland camps for 20–40 with named champions. Two new abilities per class (20, 30). Ability ranks every 10 levels. 8-slot hotbar | Built; being tested |
| 2 | Lore and onboarding: prologue, Chronicle tab, milestone path with rewards, loading tips | Planned, version 6 |
| 3 | Working castles: gates swing open for their own side; stairs and ramps to wall walks and towers; walkable wall tops with parapets; guards walk to their posts and attackers climb | Planned, version 6 |
| 4 | Working houses: doors and shutters open and close; furnished interiors you can see through the windows and walk into | Planned, version 6 |
| 5 | Banner cloth that never clips into walls or vanishes | Planned, version 6 |
| 6 | Reactive world: felling and chopping trees, cutting and burning grass, craters, breakable and repairable walls, gates and houses; houses that burn and get rebuilt | Planned, version 7 |
| 7 | Gear wear: dirt, blood, wet, damage, durability, cleaning and repair | Planned, version 7 |
| 8 | Weather on everything: wet surfaces, settling snow, lightning strikes, sun drying and melting | Planned, version 7 |
| 9 | Visual pass on existing models and shaders | Planned, version 7 |
| 10 | Dominion: campaign victories and a reset | Planned, version 8 |
| 11 | Army orders shown and steerable (rally, attack or defend from the map) | Planned, version 8 |
| 12 | Realm gifts (passives and a realm ultimate) | Planned |
| 13 | Music, aurora, siege engines | Planned |

## History

- **Versions 1–4:**
  - The world and its three realms, towns, keeps and temples.
  - Classes and abilities; the war AI with warbands, sieges and hallows.
  - Horses, wildlife, Cinderwing, weather, and day and night.
  - The phone HUD.
- **Version 5:**
  - Loot in six grades that changes how you look, plus merchants and potions.
  - The Barrow: a dungeon with packs of the dead, a fire gallery, the warden's gate, and the Hollow King with his tomb-raising fight and hoard.
