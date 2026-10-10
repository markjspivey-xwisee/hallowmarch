# Working notes for The Hallowmarch

Read this before changing anything. It covers what the game is, the owner's standing requirements, how the code fits together, how to test it, and what is planned. The same handoff is also kept in the owner's Interego pod as the graph `urn:graph:project:hallowmarch`, updated at each milestone.

- **Owner:** Mark (GitHub `markjspivey-xwisee`)
- **Repository:** https://github.com/markjspivey-xwisee/hallowmarch (private). Work on `main`, commit often, and push at each milestone.
- **Live build:** Claude artifact https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T, shared with anyone who has the link. It is published from the built `hallowmarch.html` with capabilities `{db:{}, user:{}}`. When you republish to that URL, omit `capabilities` so the stored set is kept.
- **Published:** Version 6 (level 50, lore, working castles and houses, the reactive land, weather on everything, gear wear, the readable and winnable war).
- **Next:** a visual pass, then music, the aurora and siege engines (see Roadmap).

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
10. **Nothing clips.** No grass, flower, prop, log or body pokes through a floor, wall, roof, stair or paving, anywhere in the world. People stand on what they stand on (floors, steps, platforms), never sunk into it. Check new content for this in general, not case by case (the 1 m cover map, `natClearSpot`, `natFallHits`).
11. **Bodies move like living things.** Feet stay planted while on the ground (the gait is foot-locked IK, `HUMAN_GAIT`; beasts plant by stride and leg length), limbs never move in slow motion against the ground speed, and creatures keep moving when they idle or fly (Cinderwing beats, glides with trims, banks, looks about).
12. **Real water.** Water is physical: you can wade and swim (people and animals), ponds and rivers work (rivers flow and carry you), it splashes and ripples, puts out fire, soaks gear, and can be drunk.
13. **Deep systems, easy to play, hard to master, balanced, wired into the realms.** The owner has asked for all of these; they are on the roadmap:
    - class systems with real depth: an elemental magic system that reacts to the world, and systems as deep for warriors, archers and priests, each with realm flavours;
    - animals: taming, pets, livestock, breeding with inherited traits;
    - survival: food and water, hunger and thirst (gentle);
    - farming and herb lore (botany), with plant breeding;
    - crafting (materials, workstations, recipes) and building (placed structures that burn, weather and are repaired);
    - fire for everyone: a burning brand from any fire sets roofs, trees and grass alight.

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
7. For lore and onboarding (prologue, Chronicle, path, notes), run `python3 tools/tests/lore.py`.
8. Each big system has its own test. Run the ones your change touches:
   - `castles.py`, `houses.py`, `nature.py` and `siege.py` (engines, breaches, sallies, the player's crew)
   - `weather.py`, `war.py` and `level50.py`
   - `merged.py`: a quick smoke test of the whole game after merging branches. It checks that every system comes up, runs a stormy war for a few minutes, and takes two screenshots.
   - `worldstate.py`: a busy land (felled, split and regrowing trees, cut and burning grass, a crater with loot in it, burning, ruined and rebuilding houses, breached, rebuilding and worn walls) is saved, the page reloaded with the same storage, and everything checked; then an old save and a damaged one. Prints the save sizes.
   - `animals.py`: taming a wolf step by step, commands and a hound fighting, taming and riding a wild horse, livestock producing, two generations of breeding, save and load; `animals.py shots` adds screenshots (hound, flock, cattle, hens, mare and foal, the animal card).
   - `gifts.py`: each realm's passive gifts by their numbers, each realm ultimate (effects, cooldown, key 9, HUD, a champion using it), the Chronicle page, the phone pad; screenshots of each ultimate.
9. In test scripts, a `page.evaluate` must never return `window.__hm` or a helper object that holds it. Playwright tries to serialise the whole game and stalls. End helper scripts with `;0`.

**Debug API (`window.__hm`, defined at the end of `13_main.js`):**

- `ready` and `errors`: the boot flag and every runtime error caught.
- `start({realm, cls, level})` starts a game. `realm` is 0 Logres, 1 Ériu or 2 Thule; `cls` is `warrior`, `archer`, `mage` or `priest`.
- `simulate(sec)` runs the fixed-step simulation and returns a war summary.
- `teleport(x, z)`, `setTod(p)` (time of day) and `look(yaw, pitch, dist)`.
- `frame()` renders one frame; `renderInfo()` returns draw calls, triangles and programs.
- `GAME`, `WAR`, `ENT`, `UI`, `CAM`, `DUN`, `INDOOR`, `BARROW`, `BARROW_STATE`, `INV`, `LOOT`.
- `dbg.*` exposes renderer internals; `fn.*` exposes most game functions.
- `LORE` (attached by `10c_lore.js`): `openPrologue`, `openChronicle(section)`, `complete(stepId)`, `check()` (one look at the world for steps and notes), `progress()`.
- `CW` (attached by `08g_campaign.js`): campaign state and test hooks. `nature` (attached by `05h_nature.js`): tree, grass and crater hooks.
- `gifts` (attached by `06c_gifts.js`): `GIFT`, `GIFT_DEF`, `giftHas`, `giftHarmMult`, `giftBuffAdjust`, `giftSpeedMult`, `useRealmGift`, `castGiftUlt`, `state()`. `land` (also attached there): `landSave`, `landApply`, `landKey`, `LAND.restored` (what the last load read back).
- Castles add `fn.castles()`, `fn.floorAt`, `fn.castleRoute`, `fn.castleSiegeHit` and `fn.CASTLE_PATCHED` (the building-shader anchors the castle patch found).

## Architecture

| Module | Role |
|---|---|
| `00_util.js` | Maths, noise and random helpers |
| `01_world.js` | World layout (realms, sites, lakes, navigation graph), heightfield, masks, colliders (`COLL`, `addBox`), `heightAt` / `isWalkable` / `zoneAt` |
| `02_render.js` | Renderer, `QUALITY_PRESETS`, shared uniforms `U`, `mat()` / `shareMat()`, GLSL chunks, sky, post-processing (bloom, light shafts) |
| `02b_nature_map.js` | The nature map: one texel per metre over the whole land for cut, burnt, burning and dug-up ground, uploaded to the GPU only where it changed |
| `03_terrain.js` | Terrain, water, grass, flowers, trails, decals |
| `04_props.js` | Building materials (`MAT` ids and the building shader), keeps, temples, doors, banners, relics, rocks, hero tree |
| `04b_town.js` | Towns: framed houses, roofs, chimneys, yards |
| `04c_trees.js` | Near-camera trees: bark, branches, leaf cards |
| `04d_barrow.js` | The Barrow: the surface mound and the dungeon grid and geometry; indoor mode (`INDOOR`, `setIndoor`, `travel`) |
| `04e_houses.js` | Working houses: two-layer walls with real openings, hinged doors and shutters, glazing, the house shader (patched from the building shader at anchors; it throws if one is missing), interactions, camera inside, fire (`igniteHouse`, `houseAt`, `fireLandsAt`), collapse to a ruin and rebuilding on a scaffold |
| `04f_rooms.js` | Furnished rooms: hearths and stoves with real fires, tables, benches, beds, shelves, barrels, rugs, lamps; furniture colliders; ruins and scaffolds |
| `04h_siege.js` | Siege engines: battering rams, mangonels and trebuchets built in code (their own charring shader patched from the building shader), built and crewed by warbands, pushed into range, worked (windlass, slings, counterweight), stones on real arcs that crack wall sections (`castleSiegeHit`) and batter gates; engines hacked apart or set alight (`siegeFireAt`); the commanders' choice of gate or breach, bands storming a breach, the garrison holding it (`ai.plug`) and sallying out of its gate (`ai.sally`); the player joining a crew or taking over an abandoned engine. Test hooks on `__hm.SIEGE` |
| `04g_castles.js` | Working castles: floors (`floorAt`, `floorSolidAt`), stairs, wall walks with crenellated parapets, open tower tops, gates with hinged leaves and portcullises (open for their own side, shut against enemies), garrison posts and walking routes (`castleRoute`), breachable and repairable wall sections (`castleSiegeHit`), crack and breach shader patches |
| `05a_rig.js` | Characters built in code: skinned humanoids and beasts |
| `05b_actors.js` | Instanced, vertex-animated crowds; particles; glows |
| `05c_beasts.js` | Wolves, boars and bears on a three-joint leg rig |
| `05d_fire.js` | Fires, braziers, flashes; `gatherLights` picks the point lights for each frame |
| `05e_weather.js` | Rain, storms and lightning, northern snow, mist |
| `05f_juice.js` | Slash trails, impact flashes, hit-stop |
| `05g_spells.js` | Spell visuals: terrain-draped ground marks (`spellDisc`: frost, holy circle, renewal, shockwave, cracks, scorch), lightning and tracer ribbons (`spellRibbon`), columns of light (`spellPillar`), spell weather (`spellEmitter`) |
| `05h_nature.js` | The reactive landscape: chopping and felling trees with real falls, stumps, logs, firewood and campfires; regrowth from saplings; burning trees (`igniteTree`); cut grass; grass fire that spreads with the wind and stops at roads and water (`igniteGrass`); craters that reshape the heightfield (`natureImpact`); lightning hook (`natureStrike`) |
| `05h_wear.js` | Weather on bodies (`e.wet`, `e.snow`, `e.dirt`, `e.blood`, `e.batter`; shelter from roofs and tree crowns, heat from fires); gear wear (`it.dur` 0–100, `it.dirt`, `it.blood`; `wearOnHit`, `repairAll`, `washGear` at wells, troughs and lakes); lightning on tall things near the player (`strikeNear`, `strikeAt`); drying and melting rates; `wearVisual` packs the actor shader's `iWear` |
| `05j_farmbeasts.js` | Farm beasts on the beast rig: sheep (fleece curls, shorn), cattle and bulls (horns, udder), pigs (snout), hounds (collar), wild and saddled horses; a second kit merged onto `buildBeast`; the beast shader patched at anchors (fleece 30, horn 31, udder 32, face 33, beak 29; coat patterns; a lying-down rest pose, act 9); the hen's own rig (planted legs, flapping wings, a bobbing, pecking head). Looks travel in `iColA.w` = scale + 4 × pattern + 16 × seed (`e.visCode`), the crowd in `e.crowd` |
| `06_data.js` | Classes, abilities, monsters, names, progression (`LEVEL_CAP`), realm ranks |
| `06b_items.js` | Item quality, slots, generation, stats, how gear looks |
| `06d_goods.js` | Goods: everything carried that is not gear (materials, food, drink, seeds, herbs, tools, building parts), kept by count in `INV.goods`, listed in the bags, dropped and picked up like loot, saved with the character. The shared catalogue of ids every system uses (`log`, `plank`, `stone`, `iron`, `hide`, `wool`, `meat_raw`, `bread`, `water`, `herb_*`, `seed_*`, `tool_*` …). Save parts: `registerSavePart('char' or 'world', key, { save, load, key })` |
| `06c_gifts.js` | Realm gifts: two passives per realm unlocked by realm rank (Logres Steadfast Lines and Unbroken, Ériu Wood-wise and Rain-blest, Thule Cold-blooded and Wound-fury) and a realm ultimate at realm rank 5 or level 30 (the Raised Standard, the Grey Hunt, the Iron Winter) on key 9, the round gift button and the phone pad; champions (keep lords, warband leaders) call it in big fights; the Chronicle's gifts page. Hooks: `dealDamage` asks `giftHarmMult`, `addBuff` asks `giftBuffAdjust`, `effectiveSpeed` asks `giftSpeedMult`; `buildHotbar` calls `giftHotbar`, `simStep` `updateGifts`, `tick` `drawGifts`, `startGame` `giftsOnStart` |
| `07_entities.js` | Entities (`makeEnt`, `ENT`), stats (`setupStats`), combat (`dealDamage`, `killEnt`), abilities, projectiles |
| `08_ai.js` | Monsters, garrisons, warbands, realm commanders, relics; `WAR` state |
| `08b_wildlife.js` | Deer, birds, bats, butterflies |
| `08c_dragon.js`, `08d_dragon_ai.js` | Cinderwing: the model and its behaviour |
| `08e_barrow.js` | The Barrow's dead: packs, flow-field pathing, the burning gallery, chests, the Hollow King fight |
| `08f_townlife.js` | Townsfolk's days: home at night, out by day, doors and shutters used for real, routes round the furniture, fleeing fires, rebuilding |
| `08g_campaign.js` | The campaign: commanders' plans with announced reasons (`planWar`, `announceOrder`), routes and order badges on the maps and nameplates, player orders to warbands from the map, claims (4 of 6 keeps for 5 min, or both enemy hallows for 4 min), renown, the long-war rules, victory, peace and reset, campaign history in the world save |
| `08h_animals.js` | Animals: taming (calm approach, liked food, trust per feeding, lost by rushing or striking), companions (role `animal`, `e.tame` records; follow along the player's trail, stay, guard, attack, call; bond levels; hurt ones come back), your own horse (`animalsRideLook`, `animalsQuickMount`, `animalsDismounted`), livestock in the town commons and paddocks you fence (gates, trough, rack, shed; grazing, feed, water, shelter; wool, milk, eggs, manure), breeding with inherited traits (coat, pattern alleles, size, temper, yield, speed, strength) over generations, the animal card and list (K), the companion bar, the herder's board, the Chronicle's Animals page, save part `char.x.animals`. Test hooks on `__hm.animals` |
| `09_player.js` | Input, camera, movement, targeting, interaction |
| `09b_mount.js` | Horses |
| `09c_loot.js` | Inventory, drops, merchants, potions; dropped goods go into the packs by count |
| `09d_brand.js` | Fire for everyone: take a burning brand from any fire (E), it is held up in the left hand (the torch bit, `WB.torch`), lights the way, sets roofs, trees and long grass alight (E), sets struck foes alight; water and rain put it out. `natureFireAim`: fire spells with nothing targeted aim at the tree or grass in front |
| `10_ui.js` | Title, HUD, maps, menus, nameplates, log, help |
| `10b_kit.js` | Equipment, bags and shop screen |
| `10c_lore.js` | Lore and onboarding: the prologue, the Chronicle menu tab, the path tracker and its rewards, field notes, loading tips. It makes its own styles and markup; `startGame` calls `loreOnStart`, `tick` calls `updateLore`, saves carry `char.lore` |
| `11_audio.js` | Synthesised sound effects and ambience (Web Audio) |
| `12_save.js` | Saves: `claude.use('db')` document `data/users/<uid>/save`, falling back to localStorage `hallowmarch.save.v1`; `validSave()` sanitises |
| `12b_worldstate.js` | The world remembers: `landSave()` writes `world.land` (felled trees, logs, stumps and saplings with their clocks; the nature map as 4-bit run-length tiles; burning grass; craters as height deltas in cm; burning, ruined and rebuilding houses; worn, breached and repairing walls; firewood piles) and `landApply()` restores it at boot. Also: loot settles when the ground moves under it, and the woodcutter's axe is in hand while chopping (`updateLand`) |
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
- Weather on a surface goes through the `GLSL_WEATHER` chunk in `02_render.js` (`wetAlbedo`, `wetSheen`, `rivulets`, `snowAmount`, `snowAlbedo`, `snowSparkle`), called with `uWet` and `uSnowCover` scaled by how sheltered the surface is; pass `gPL` as the heat so snow melts by fires. `uRain` is the rain falling right now (rings on the water). Characters take their own amounts from the `iWear` attribute; beasts from `iColB.w` (the hit flash in the fraction, wet and snow in whole sixteenths above it: `beastWx` in `05h_wear.js`, which now soaks and dries beasts as well).
- World maps every shader can read through `GLSL_WORLD` (built on the first frame by `updateCanopy` in `03_terrain.js`, 2 m texels unless noted):
  - `uCanopy`: rgb are the meadow's patches (`meadowPatch`: dry straw, lush clover, tall stands; ground, blades and flowers all use them), alpha is the tree-crown cover (`canopyAt`). The cover follows felled, burning, leafless and regrowing trees every 1.5 s. Ground and grass under crowns stay drier in rain, gather less snow and lie in a little shade.
  - `uGroundAO` (1 m): contact shade on the ground at the foot of walls, houses, gates, fences, props and posts, baked from `COLL` (`groundAO`).
  - Test hooks: `__hm.visual.canopy(x, z)`, `.meadow(x, z)`, `.groundAO(x, z)`, `.refresh()`.
- `meadowHeight` sets the turf height (short sward, taller stands, long in fields, trimmed by roads); flower heads ride on it. `GRASS_SEGS` gives each quality its bends per blade layer: medium and low spend their vertices on more, simpler blades.
- Fog is exponential height fog (`applyFog`): as thick as before at the camera's height, thinner up the slopes.
- The final composite grades by time of day: the `gSat` (vibrance), `gCon` (contrast about the mid tones) and `gWarm` keys in `TOD_KEYS`.

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
- Siege engines are entities of kind `door` with `siegeEngine` set (not actors, so nothing auto-targets them; defenders and sallies go for them on purpose). `python3 tools/campaign_soak.py 60 low` runs an AI-only campaign and reports how each one ended.
- Colliders marked `vert` block only at their own height range (walls below their top, parapets only up on the walk). `stepTo` passes the body's height to `resolveCollisions` and asks `castleStepBlocked` about stair sides and raised edges.

**Floors**
- `groundY(e)` and the player use `floorAt(x, z, y)`: the highest walkable surface at or one step (0.62 m) above `y`, else the ground. Floors are boxes, discs or ramps (wall walks, tower tops, stair treads, timber decks).
- NPCs never walk off a raised edge; the player can, and falls.

**Fire and the reactive world**
- Fire spells and the dragon's breath call `fireLandsAt` / `fireConeAt` (in `04e_houses.js`), which light roofs, trees and grass.
- Lightning calls `natureStrike(x, z)`. Use `igniteHouse(houseAt(x, z))`, `igniteTree(i)` and `igniteGrass(x, z, r)` to set things alight.
- Meteors, the leap strike and the dragon landing call `natureImpact`, which leaves craters. Meteors also call `castleSiegeHit`.
- The land is saved with the world (`world.land`, see `12b_worldstate.js`). Anything new that changes the land for longer than a minute should be added to `landSave` / `landApply`, with times saved as seconds left and every list capped.

**Indoors**
- `setIndoor(true)` hides the outdoor group, swaps the lighting and turns off shadows and light shafts.
- `regroupOutdoors()` runs every frame so that rebuilt grass stays in the outdoor group.
- Meshes that must stay visible in both modes set `userData.keep`.

**Entities**
- Factions: 0–2 are the realms, 3 is `FACTION_MONSTER`, 4 is `FACTION_NEUTRAL`.
- Roles scale stats through `ROLE_MULT`. Gear is applied in `setupStats`.
- Standing stat adjustments go in `e.tweak` (`hp`, `dmg`, `rangedRange`, `swing`, `meleeRange`, `speed`). `setupStats` reapplies them, so they survive a level change.
- `e.motion` moves a body by itself: `spin` (whirlwind) or `leap` (a parabola to a landing spot). `updateMotion` runs for the player and for NPCs.

**Animals** (`08h_animals.js`)
- Kept animals are entities with role `animal` and a record in `e.tame` (`owner` `player`, `town` or `wild`; `k` hound, pig, horse, deer, sheep, cattle, hen; `cmd` follow, stay, guard, attack, pen; traits in `tr`). `updateNPCs` hands them to `thinkAnimal`; hounds fight through `fightTarget` and `autoAttack` like soldiers (faction of the player); the others are `FACTION_NEUTRAL`.
- Which crowd draws a beast is `e.crowd || e.kind` (shorn sheep, bulls, saddled horses), and `e.visCode` rides above the scale in `iColA.w`; only the farm crowds (05j) decode it, so leave it 0 for the original crowds.
- Wild wolves and boars stay camp mobs until tamed (`ai.tameHold` pauses `thinkMob` while one eats from your hand); deer stay critters (`animalsSparesDeer`).
- Your own horse: `horseLook` asks `animalsRideLook`, `toggleMount` asks `animalsQuickMount`, `dismount` and `killEnt` hand the horse back through `animalsDismounted`; its speed trait scales `MOUNT_SPEED` (`animalsMountSpeed`).
- Pens are rectangles in their own frame with the gate on the front (+z); `anSegClear` clips paths against them exactly (thin fences slip between `segmentClear`'s samples).

**Scaling past 20**
- `warLevel()` is the player's level, clamped to 20–50.
- Realm units keep their offset from it in `e.wlOff`: soldiers −5 to 0, guards 0, lords +4, hallow-wardens +2, muster wardens +10. Gates are +2, and their HP scales with damage.
- Barrow monsters keep `e.baseLevel` plus `barrowBoost()`. The dragon is `max(24, warLevel + 4)`.
- `rescaleWar()` runs at game start and on every level-up past 20.
- Ability potency rises by rank: `rankMult(level)` adds 12% for every ten levels past 20.

**War AI**
- Each realm commander issues orders: `attack`, `defend`, `raid`, `carry`, `retrieve`, `patrol`, and `rally` (a band following the player). `commanderThink` hands planning to `planWar` in `08g_campaign.js`. Orders the player gave hold until done (`retask` skips them).
- A warband works through the phases `travel`, `siege`, `assault`, `hold`.
- Keep doors are entities that let their owners pass. Relics are called "hallows" in game.

**Saves**
- Old saves must always keep loading.
- When you add fields, default them in `startGame` / `validSave` and include them in `coreKey`.
- New systems keep their state in save parts (`registerSavePart`, 06d_goods.js): `s.char.x[key]` with the character, `s.world.x[key]` with the world; `load` gets `undefined` for an older save and must sanitise whatever it reads; `key` says what counts as a change worth writing.
- `coreKey` counts the land by what changed in it (`landKey`: felled trees, logs, craters, tiles, piles, house and wall states), never by its clocks, so regrowth alone does not cause writes. `char.gift` holds the realm ultimate's cooldown and is no reason to write either.
- A busy land (four trees down, a grass fire, five craters, three houses and three walls changed) adds about 10 KB; an untouched world adds 7 bytes.

### Gotchas

- Grass and flowers are rebuilt when quality changes. Anything rebuilt at runtime must go back into the right group; see `regroupOutdoors`.
- Do not shadow common globals inside functions; a stray `P` in `gatherLights` once broke the build.
- Under SwiftShader, screenshots need a long timeout (300 s), and in-page timers lag behind wall time.
- The building shader in `04_props.js` is patched by other modules at anchor strings. Keep these lines intact, or update the patches with them:
  - the houses patch, which throws at boot if an anchor is missing;
  - the castles patch at `void main(){` and `vec3 col = lightSurface(alb, n, vAO);`, which silently loses its cracks instead;
  - `alb *= 1.0 - 0.22 * uWet;`.
- The human crowd uses 15 of the 16 guaranteed vertex attributes. Pack new per-instance data into spare channels rather than adding attributes.

## Roadmap

| # | Work | Status |
|---|---|---|
| 1 | Level 50: scaling, borderland camps and champions, 8 new abilities, ranks, 8-slot hotbar | Done (version 6) |
| 2 | Lore and onboarding: prologue, Chronicle, path with rewards, field notes, tips | Done (version 6) |
| 3 | Working castles: gates, stairs, wall walks, parapets, garrison routes, breaches and repairs, banners | Done (version 6). Left: tower interiors and hatches, AI using breaches, defenders sallying out |
| 4 | Working houses: doors, shutters, glazing, furnished rooms, townsfolk's days, burning and rebuilding | Done (version 6). Left: one flaky morning check in `houses.py` |
| 5 | Reactive land: felling and regrowing trees, cut grass, grass and tree fire, craters | Done (version 6). Left: save the nature state, an axe model, loot following craters |
| 6 | Weather on everything and gear wear: wet, snow, drying, lightning strikes, durability, blood, mud, repair, washing | Done (version 6). Left: ground under tree crowns gets wet, beasts' own wetness |
| 7 | The war: readable, steerable orders and winnable campaigns | Done (version 6). Left: tune so more campaigns end by claims than by renown; hallow raids rarely succeed |
| 8 | Visual pass on existing models and shaders | Next |
| 9 | Realm gifts (passives and a realm ultimate); the land saved with the world, loot settling into craters, the woodcutter's axe | Merged (version 7) |
| 10 | Music, aurora, siege engines, the war AI using breaches and sallies, campaign tuning (claims over renown) | Merged (version 7). Left: tower interiors and hatches |
| 12 | Animation: foot-locked gaits for people and beasts, Cinderwing's flight | In progress (version 7) |
| 13 | No clipping: cover map, props and logs clear of walls, temple dais floors | In progress (version 7) |
| 14 | Fire for everyone: burning brands; fire spells aimed at trees and grass | In progress (version 7) |
| 15 | Water: swimming, wading, rivers with currents, splashes and ripples, drinking | Next |
| 16 | The keep's great hall: a working door into a hall with a war table, armourer's bench, basin and hearth | Planned |
| 17 | Class systems: elemental magic reacting to the world; warrior stances and momentum; archer draw and arrows; priest devotion and holy ground; realm flavours | Planned |
| 18 | Survival and crafting: hunger and thirst, foraging, hunting, fishing, cooking; materials, workstations, recipes | Planned |
| 19 | Farming and herb lore, plant breeding | Planned |
| 20 | Animals: taming, pets, livestock, breeding | Done on `feature/animals`. Left: swimming (needs `waterAt` from feature/water), pens from the building branch's fences |
| 21 | Building: placed structures | Planned |

## History

- **Versions 1–4:**
  - The world and its three realms, towns, keeps and temples.
  - Classes and abilities; the war AI with warbands, sieges and hallows.
  - Horses, wildlife, Cinderwing, weather, and day and night.
  - The phone HUD.
- **Version 5:**
  - Loot in six grades that changes how you look, plus merchants and potions.
  - The Barrow: a dungeon with packs of the dead, a fire gallery, the warden's gate, and the Hollow King with his tomb-raising fight and hoard.
- **Version 6:**
  - Level 50: the frontier, the Barrow and the dragon scale with the player; borderland camps with named champions; eight new abilities with real motion and effects; ability ranks.
  - Lore and onboarding: the prologue, the Chronicle, the path with rewards, field notes and tips.
  - Working castles: hinged gates, stairs, wall walks, parapets, garrison routes, breaches and repairs, banners that stay clear of walls.
  - Working houses: doors, shutters, glazing, furnished rooms, townsfolk's days, houses that burn and are rebuilt.
  - The reactive land: trees that are felled and regrow, cut grass, grass and tree fires, craters.
  - Weather on everything: wet, snow, drying and melting, lightning on tall things. Gear wear: durability, blood, mud, repair and washing.
  - The war: announced orders with reasons, routes on the maps, player command of warbands, campaigns that are won and reset.
