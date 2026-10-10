# Working notes for The Hallowmarch

Read this before changing anything. It covers what the game is, the owner's standing requirements, how the code fits together, how to test it, and what is planned. The same handoff is also kept in the owner's Interego pod as the graph `urn:graph:project:hallowmarch`, updated at each milestone.

- **Owner:** Mark (GitHub `markjspivey-xwisee`)
- **Repository:** https://github.com/markjspivey-xwisee/hallowmarch (private). Work on `main`, commit often, and push at each milestone.
- **Live build:** Claude artifact https://claude.ai/artifact/QgnzHjUXkBKjCtHwb6H62T, shared with anyone who has the link. It is published from the built `hallowmarch.html` with capabilities `{db:{}, user:{}}`. When you republish to that URL, omit `capabilities` so the stored set is kept.
- **Published:** Version 8: real water (rivers, ponds, wading and swimming), the callings (stances and parries, the drawn bow, elemental magic, devotion), survival and crafting, farming and herb lore with plant breeding, animals (taming, companions, livestock, breeding), keep halls and building. It includes version 7: the visual pass, realm gifts, siege engines, music and the aurora, the saved land, foot-locked gaits and Cinderwing's flight, the cover map against clipping, and burning brands.
- **Next:** Version 9 (see Roadmap).

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
13. **Deep systems, easy to play, hard to master, balanced, wired into the realms.** All of these are built (version 8); keep them deep, balanced and wired into each other:
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
   - `integration.py`: how the version 8 systems fit together: nothing one system places (workstations, halls, paddocks, beds, plants, herbs, animals) stands in another's way or in the water; ice forms at a pond's own level and carries a body; drinking at a river fills the empty waterskins; recipes give their skins back; nothing is built on a tilled bed; three minutes with everything going.
   - `classes.py` (the callings: `mech` checks, `balance` table, `shots`) and `classes_phone.py` (the class panel and buttons on a phone). `classes.py balance` plays every calling with the simple and the skilled bot (`simple` or `skilled` alone; `levels=10,30,50`; `reps=N` for the dummy and the pack, `dreps=N` for the duels, `mreps=N` for the mastery duels; `HM_BAL=path` writes the JSON): the time to kill a standard foe (a level-matched garrison warrior), the time survived against an endless pack of three wolves and two outlaws of the level, their health and harm raised with the fighters' ability rank and gear (`rankMult`, and 8% at 20-39, 16% from 40) (capped at 150 s, a survivor scores 1.5 times), duels of every pair of callings (both on the same bot, realms swapped), and mastery duels (each calling's skilled bot against its simple bot). Fighters have a player's own measure (`ROLE_MULT.player`) and fair gear. TTK and survival are medians, so a stray arrow into a log does not swing the table.
   - `barrow.py` ends by sending each calling at level 28 with fair gear and three healing draughts against the Hollow King, the player played by the skilled bot.
   - `worldstate.py`: a busy land (felled, split and regrowing trees, cut and burning grass, a crater with loot in it, burning, ruined and rebuilding houses, breached, rebuilding and worn walls) is saved, the page reloaded with the same storage, and everything checked; then an old save and a damaged one. Prints the save sizes.
   - `water.py`: the world check (every river course has water, no dry pond beds, no road through deep water), wading and swimming numbers for the player, a soldier and a wolf, the current, the camera above water, no casting while swimming, a rider sliding off, fire out, drinking and the waterskin; `water.py shots [medium]` adds screenshots (shore, river, swimming, wake, wading).
   - `building.py [noshots] [hall|build]`: each realm's hall door, walking in, the war table's command grant (and an enemy keep's table until it is taken), the armourer, basin, hearth and stores; building: refused places, a foundation rising in stages, snapping and turning, a cottage with a door and a roof that keeps the rain off, a bed as the return point, fire spreading and falling in, repair, pulling down, a fence with a gate, save and load; screenshots of the halls, the war table, the ghost and the cottage.
   - `survival.py`: needs over simulated time by activity and their effects (never death), eating and drinking, a well and a lake, foraging and regrowth, a hunt's drops (more with a knife), fishing (too soon, in time, too late), cooking and a stew, a recipe at every station, a crafted pick and axe used, merchants, the Chronicle and help, the save (old and damaged too); screenshots of the HUD needs, a bush, a mushroom ring, fishing, the forge, the crafting book on a desk and a phone. `noshots` skips the pictures.
   - `farming.py`: the season cycle and its weather; tilling, sowing and growth through every stage; harvest yields; frost, drought, weeds; crossing two strains and the offspring's traits; seed saving raising the yield over generations; the herbal; trampling and fire; the townsfolk working the fields; save and load (old and damaged saves); screenshots of beds at each stage after rain, the plant card, a townsfolk harvest, a ripe field and a herb patch in shade. `noshots` skips the screenshots, `shotsonly` takes only them, `phone` adds the plant card on an upright phone with touch.
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
- `farm` (attached by `08h_farming.js`): `FARM`, `SEASON`, `seasonNow`, `setSeason(k)`, `farmTempAt`, `till(x, z, ang)`, `tillWhy(x, z)`, `sow(plotId, goodId)`, `step(dt)` (grow every bed by dt seconds), `harvest`, `saveSeed(plotId, slot)`, `newStrain(crop, traits)`, `plants`, `strips`, `herbs`, `learn`, `gather`, `dig`, `ctx()` (what the plant card shows and offers), `act(action)`, `save`, `load`.
- `CW` (attached by `08g_campaign.js`): campaign state and test hooks. `nature` (attached by `05h_nature.js`): tree, grass and crater hooks.
- `bal` (attached by `07c_balance.js`): `BAL`, `botMake`, `botStep`, `fairGear`, `applyFairGear(P, level)`, `ccAdjust`, `ccFactor`, `ccState`, `ccHudState`, `ccChampion`, `raiseOfferStep`, `raiseOfferAccept`, `raisePlayer`, `kingFresh()` (the Hollow King whole on his throne for a new fight). `BAL.log = []` records every press the bots make.
- `cls` (attached by `07b_classes.js`): the callings' state (`state(e)`, `CLS.stats`), stances, blocks, the draw, elements, devotion and their test hooks.
- `gifts` (attached by `06c_gifts.js`): `GIFT`, `GIFT_DEF`, `giftHas`, `giftHarmMult`, `giftBuffAdjust`, `giftSpeedMult`, `useRealmGift`, `castGiftUlt`, `state()`. `land` (also attached there): `landSave`, `landApply`, `landKey`, `LAND.restored` (what the last load read back).
- `surv` (`09s_survival.js`): `SURV`, `FORAGE`, `CRAFT` (`CRAFT.stations`), `RECIPES`, `needsEat`, `needsDrink`, `eatGood`, `drinkAt`, `fishStart`, `survCraftOnce`, `openCraft` and more. `animals` (`08h_animals.js`): `A` (the `ANIMALS` state: `list`, `pens`, `down`), `anTame`, `anCommand`, `anBirth`, `penHas`, `animalsSave` and more. `build` (`06k_build.js`): `BUILD`, `BP`, `buildPlace`, `bValidate`, `bLandWhy`, `buildFenceLine` and more; the halls on `fn.halls()`.
- `water` (`07b_swim.js`): `waterAt`, `state(id)` (depth, wading, swimming, soaked height, speed), `swimDims(id)`, `rivers()`, `ripple()`, `meshes()`, `tickWater(dt)` (the ripples without drawing the world), `splashAt`, `rippleDrop`, `swimAllowed`, `waterNear`, `RIVERS`, `PONDS`, `WATERGRID`.
- Castles add `fn.castles()`, `fn.floorAt`, `fn.castleRoute`, `fn.castleSiegeHit` and `fn.CASTLE_PATCHED` (the building-shader anchors the castle patch found).

## Architecture

| Module | Role |
|---|---|
| `00_util.js` | Maths, noise and random helpers |
| `01_world.js` | World layout (realms, sites, lakes, navigation graph), heightfield, masks, colliders (`COLL`, `addBox`), `heightAt` / `isWalkable` / `zoneAt` |
| `01b_water.js` | Where the water stands: a river per realm carved down its valley into its lake (`RIVERS`), ponds in the closed hollows (a priority flood; other hollows are filled, so there are no dry pond beds; `PONDS`), `WATERGRID` (surface, flow and white water per 2 m texel), `waterAt(x, z)`, deep water in `W.walk` (2), `swimPassable`, `deepWaterAt`, `riverAt` |
| `02c_water_map.js` | The water map every shader can read (`GLSL_WATER_MAP`: `waterMapAt`, `rippleAt`, `causticNet`); the ground under and beside the water (`GLSL_WATER_GROUND`, called by the terrain shader: bed of sand, silt or gravel with a wobble, caustics, beach, the wet band the waves lap); the ripple simulation round the player (`stepRipples`, `rippleDrop`: high 256², medium 128², low off) |
| `03b_water.js` | The water surface: one mesh over every lake, pond and river at its own heights (no overlaps), see-through with absorption by depth, flow-mapped waves downstream, white water where rivers fall, shore foam, sky, clouds and far shore mirrored, rain rings and the ripple field |
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
| `04k_hall.js` | The keep's great hall: each keep's hall is a house record of the keep site (`planKeepHalls`, run after every town so town house numbers stay stable; `H.keepHall`), drawn by the houses machinery in its realm's style (Logres stone under slate, Ériu a great roundhouse, Thule a log longhall with a long hearth), furnished by `keepHallLayout` (war table, armourer's bench, basin, great hearth, high seat, long tables, hangings, torches, weapon rack, stores). `hallOffers`: the war table opens the map and grants command (`cwCanCommand` asks `hallCommandGrant`) to anyone of the realm holding the keep, the armourer mends (`repairAll`) and cleans, the basin washes (`washGear`), the hearth dries and heals, the stores sell building goods. Banner poles before the door (`keepHallPoles`). Test hooks `__hm.fn.halls()`, `hallOf`, `hallCommandGrant` |
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
| `06k_build.js` | Building: placed structures (`BP`: foundation, plank/stone walls, doorway, window, thatch and shingle roofs, upper floor, stair, fence, gate, campfire, workbench, bed, chest) on a 3 m grid shared by a building (`bSnap`: frame of the nearest piece, cells and edges, heights from foundations and wall tops), refused off your realm's lands, near sites, camps, roads, water and on steep ground (`bValidate`, `bLandWhy`). Goods taken on placing, then raised with a hammer (`BUILD.work`, the piece's `uRise`); the piece shader is the building shader with rise, char/glow and shelter (`uPc.w` keeps rain and snow off what is under a roof). Real colliders (tag `build`, `c.build`) and floors (`addFloorBox`), doors/gates/shutters on pivots, roofs in `houseRoofOver` and the rain shader's roof list, fire (`buildFireAt`/`buildFireCone` from `fireLandsAt`/`fireConeAt`), spreading, falling to charred heaps (`bFall`), `bSupport` (nothing floats), repair at half cost, `buildDemolish` (half back), the cover map marked at runtime (`coverBox` + `COVER.tex.needsUpdate`). Bed = return point (`buildBedSpot` in `releasePlayer`). Save part `world.x.build`. For other systems: `buildFenceLine(x0, z0, x1, z1, { gateAt })`, `buildWorkbenchNear`, `buildHasRoof`, `buildPieces()`. Builder UI: G or the hammer button, `#buildbar`; test hooks `__hm.build` |
| `06s_survival.js` | Survival data: hunger and thirst (`SURV`, `NEEDS`; `needsEat(h)`, `needsDrink(t)` add 0..1 of a full need; `needsMult()` scales health, power and endurance regeneration in `updatePlayer`: well fed faster, hungry or thirsty slower, never death), skills that grow with use (`SURV.skill` craft, cook, fish, forage; `skillGain`), ward draughts (`survivalHarmMult` in `dealDamage`), the new goods (pasties, roast mushrooms, the cooking pot, potions, the four arrow goods if absent), the stations (`STATIONS`) and the book of recipes (`RECIPES`: `make`, `gear`, `act`; `cls`, `min`, `waste`, `pot`), gear odds by skill (`craftOdds`). Save part `char.x.surv` |
| `09s_survival.js` | Survival in the world: forage plants (`FORAGE`: berry bushes, mushroom and embercap rings, five herbs, nettles, the Logres orchard; one instanced foliage shader with wind, rain, snow, shadows; picked with E, regrowing, seasonal through `SEASON`, kept out of ponds and rivers), water (wells and troughs; `drinkAt` for any water: drink your fill, fill the empty waterskins), eating (`eatGood`, `quickEatDrink` on V and on the HUD bars), the hunt (`huntOnKill` from `grantKillRewards`; deer are `game` for the player in `isEnemy`; herds come back), cooking at any fire (`fireNear`, `cookAll`), fishing (`fishStart`, float, nibble, bite, strike; fish by realm and hour), the jobs on the cast bar (`SURV.job`), the needs on the HUD, merchants' provisions (`provisionsShopHTML`), the help and the Chronicle page (`chronLiving`). Hooks: `buildSurvival` at boot (before the grass), `survivalOnStart`, `updateSurvival`, `drawSurvival`, `survivalOffers`. Save part `world.x.forage` (picked plants and worked rocks, seconds left). Test hooks on `__hm.surv` |
| `09t_craft.js` | Crafting: workstations built in code with the building shader (forge and anvil, workbench, tanning rack, loom, bakehouse, alchemy table in each town; forge and workbench in each keep), placed by search clear of colliders, houses, floors, the townsfolk's ways and the garrison routes; their fires are real (`FIRES` with `station`); mining rocks (`rockNear`, `mineStart`); `survCraftOnce`, `craftStart` (timed, with the tool in hand: `craftHand`); the crafting book overlay (`openCraft`, key C; one column on phones) |
| `06c_gifts.js` | Realm gifts: two passives per realm unlocked by realm rank (Logres Steadfast Lines and Unbroken, Ériu Wood-wise and Rain-blest, Thule Cold-blooded and Wound-fury) and a realm ultimate at realm rank 5 or level 30 (the Raised Standard, the Grey Hunt, the Iron Winter) on key 9, the round gift button and the phone pad; champions (keep lords, warband leaders) call it in big fights; the Chronicle's gifts page. Hooks: `dealDamage` asks `giftHarmMult`, `addBuff` asks `giftBuffAdjust`, `effectiveSpeed` asks `giftSpeedMult`; `buildHotbar` calls `giftHotbar`, `simStep` `updateGifts`, `tick` `drawGifts`, `startGame` `giftsOnStart` |
| `07_entities.js` | Entities (`makeEnt`, `ENT`), stats (`setupStats`), combat (`dealDamage`, `killEnt`), abilities, projectiles |
| `07b_swim.js` | Bodies in water: wading (slower with depth, splashes and rings each step), swimming from chest depth (`waterFloorY`, `swimDims`, `waterSpeedMult`, `swimAllowed`; companions swim after you, townsfolk and posted guards never), standing on a mage's ice (`onIce`), the current carrying swimmers, no casting or shooting and no horse in deep water, fire put out, gear soaked to the waterline (`waterlinePack`), splashes (`splashAt`), the drink and wash offers at any water (`waterOffers`: drinking itself is survival's `drinkAt`), the empty waterskin (`waterskin_empty`) issued once, the sound of rivers, the Chronicle's water page (`chronWater`), `waterHelp`, test hooks (`__hm.water`) |
| `07b_classes.js` | The callings (`e.cs`): warrior stances, momentum and finishers, the shield and the parry, weapon styles; the archer's draw (ballistic arrows in `CLS.arrows`), arrow goods, hiding, snares, tracking; the mage's fire, frost and storm (attunement, focus, combos, chill and freeze, steam, ice sheets over water, runes, overcasting); the priest's devotion, prayer, holy ground, blessings, raising the fallen; realm flavours (`CLASS_REALM`), unlock levels (`CLASS_UNLOCK`); NPC use (`classNpc`, `npcClassStep`); save part `char.x.cls`. Hooks: `classHarm`/`classOnHit` in `dealDamage`, `classAbility` (this cast's view of an ability, maybe with a `custom` action) in `executeAbility`, `classSpeedMult`, `classActValue`, `classNoAuto`, `classAutoKind`, `classOnHeal`, `classSeen` (hidden archers, in `pickTarget` and creature aggro), `iceAt` in `isWalkable` |
| `07c_balance.js` | [balance] The balance of the callings. Bots that play a calling (`e.bot`, `botMake(e, 'simple' or 'skilled', home)`): an NPC bot has the role `bot` (no other think runs for it; `updateNPCs` still ticks its buffs, swings, power and footing) and is played by `botStep` from `npcClassStep`; the player with `P.bot` is played from `updateClasses` (the Hollow King check in `barrow.py`). The simple bot presses 1-8 in turn and lets the auto-attack run; the skilled one parries on the glint, spends momentum and changes stance (warrior), keeps range, kites, snares, picks arrows and draws fully (archer), plays the combos, minds attunement and blinks from blades (mage), heals early, keeps a renewal up, shields, hallows the ground, prays when safe and smites (priest). `fairGear(cls, level)`: a full set of the quality a soldier of that level wears (fine below 20, rare to 40, epic above). Diminishing returns on crowd control (`ccAdjust`, asked by `addBuff`): for players, bots and champions (`ccChampion`: camp champions, keep lords, hallow and muster wardens, warband leaders) a stun (a freeze counts as one), root or snare within 15 s of the last of its kind lasts half, then a quarter, then 6 s of immunity; a parry's stun goes through it for anyone (`{ ccAll: true }`); shown on the class panel (`classDrHud`). An allied priest near the fallen player offers to raise them (`raiseOfferStep`; the death screen's `#death-raise` beside the release): accepted, the priest walks over, prays if devotion is short, and raises you (`raisePlayer`). Tracked quarry on the minimap (`drawTrackedMinimap`). Test hooks on `__hm.bal` |
| `05j_classfx.js` | The callings' visuals and sounds: ice sheets (drawn at their own water's surface, `uWY`), iron snares, frozen shells, steam, arrows in flight and in the ground, the parry glint, `classSfx`; rune and holy-ground marks are disc kinds in `05g_spells.js`; guard, parry and kneel are actions 10–12 in `05a_rig.js` |
| `10d_classes_ui.js` | The class panel over the ability bar (a phone shows it under the frames), the technique (T) and hold (X) buttons on the phone pad, keys T / X (held) / Y (arrows), the Chronicle's Callings page, help lines, loading tips |
| `08_ai.js` | Monsters, garrisons, warbands, realm commanders, relics; `WAR` state |
| `08b_wildlife.js` | Deer, birds, bats, butterflies |
| `08c_dragon.js`, `08d_dragon_ai.js` | Cinderwing: the model and its behaviour |
| `08e_barrow.js` | The Barrow's dead: packs, flow-field pathing, the burning gallery, chests, the Hollow King fight |
| `08f_townlife.js` | Townsfolk's days: home at night, out by day, doors and shutters used for real, routes round the furniture, fleeing fires, rebuilding |
| `08h_farming.js` | Farming, herb lore and plant breeding. `SEASON` and `seasonNow()` (spring, summer, autumn, winter: two days each, 2.4 hours a year; read by foraging and anything seasonal), `seasonCold()` and `seasonWeatherOdds()` (05e_weather.js asks), `farmTempAt(x, z)`. Beds (`FARM.plots`, own `'p'`): tilled with a hoe or by hand, 4 x 6 slots, each slot one plant with traits (`FARM_TR`: yield, hardiness, drought, speed, colour, height); growth through stages by season, warmth, water (`P.moist` from rain, lost to sun and heat), light, weeds and soil (`P.fert`, tired by harvests, rested, beans and `manure`); frost (by hardiness), drought, trampling, storms laying tall crops flat, grass fire, craters. Strains (`FARM.strains`): seed lots as goods of their own (`seed_grain_s104`), made by keeping the seed of one ripe plant (its traits blended with its pollen parent's: plants of a kind in flower within 3 m cross); harvests give seed of the strain sown. The town fields (`W.fieldRects`, own `'t'`): strips with a `stand` (one crop, rotation, sowing windows) tilled, sown, weeded and harvested by Brackenford's farmers (`farmLife` and the `'farm'` plan step in 08f_townlife.js), or by the town itself when nobody is near enough to watch; the granary. Wild herbs (`FARM.herbs`, `FARM_HERBS`: eight kinds by habitat) examined into the herbal, gathered (they grow back), dug up (a knife lifts the root whole) and planted. The farmer's dialog (seed, hoe, knife, manure; buys produce). The plant card (`#farmcard`): what you look at, its traits and parentage, and the actions; E does the first. Hooks for others: `farmGrowAt(x, z, r, k)` (growth magic), `farmEatAt(x, z, r)` (grazing). Saves: world part `farm`, char part `herbal`. Test hooks on `__hm.farm` |
| `08i_farm_draw.js` | Farming drawn: every crop, weed and herb is a model built in code (`FARM_MODELS`, a near and a far model for each crop) whose parts grow out of their joints as the plant grows (`aPart`: kind, place along the part, the growth it appears at and is full at), one instanced mesh per kind with wind, wilting, nodding ripe ears, trampling, frost rime, snow, rain and char; flowers drop after flowering; night-glowing herbs. Beds are one merged furrowed soil mesh (ridges with the plants on their crests) whose shader reads each bed's state from a small texture (water, manure, ash, how far it is tilled, stubble, its crop's colour from afar). The dashed outline of a bed about to be tilled. Map patches (`drawFarmMap`) |
| `08g_campaign.js` | The campaign: commanders' plans with announced reasons (`planWar`, `announceOrder`), routes and order badges on the maps and nameplates, player orders to warbands from the map, claims (4 of 6 keeps for 5 min, or both enemy hallows for 4 min), renown, the long-war rules, victory, peace and reset, campaign history in the world save |
| `08h_animals.js` | Animals: taming (calm approach, liked food, trust per feeding, lost by rushing or striking), companions (role `animal`, `e.tame` records; follow along the player's trail, stay, guard, attack, call; bond levels; hurt ones come back), your own horse (`animalsRideLook`, `animalsQuickMount`, `animalsDismounted`), livestock in the town commons and paddocks you fence (gates, trough, rack, shed; grazing, feed, water, shelter; wool, milk, eggs, manure), breeding with inherited traits (coat, pattern alleles, size, temper, yield, speed, strength) over generations, the animal card and list (K), the companion bar, the herder's board, the Chronicle's Animals page, save part `char.x.animals`. Test hooks on `__hm.animals` |
| `09_player.js` | Input, camera, movement, targeting, interaction |
| `09b_mount.js` | Horses |
| `09c_loot.js` | Inventory, drops, merchants, potions; dropped goods go into the packs by count |
| `09d_brand.js` | Fire for everyone: take a burning brand from any fire (E), it is held up in the left hand (the torch bit, `WB.torch`), lights the way, sets roofs, trees and long grass alight (E), sets struck foes alight; water and rain put it out. `natureFireAim`: fire spells with nothing targeted aim at the tree or grass in front |
| `10_ui.js` | Title, HUD, maps, menus, nameplates, log, help |
| `10b_kit.js` | Equipment, bags and shop screen |
| `10c_lore.js` | Lore and onboarding: the prologue, the Chronicle menu tab (`CHRON_SECTIONS`, grouped into four parts by `CHRON_GROUPS`: The March, Your path, The war, Living; a page no part names goes under the first), the path tracker and its rewards, field notes, loading tips. It makes its own styles and markup; `startGame` calls `loreOnStart`, `tick` calls `updateLore`, saves carry `char.lore` |
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

**Water**
- `waterAt(x, z)` gives `{ y, depth, fx, fz }` (surface, depth over the ground, flow in m/s) or null. Lakes stand at `WATER_Y`; rivers fall along their course; ponds stand in their hollows at their own heights. Use it, never `WATER_Y`, to ask about water.
- `W.walk` is 0 walkable, 1 blocked, 2 deep water. `isWalkable` stays `=== 0`; `stepTo` uses `swimPassable` for a body with `e.swimOK` (the player always; people and beasts chasing something or getting out; never townsfolk or posted guards).
- A body in water has `e.wd` (depth), `e.wadeK`, `e.swim`, `e.swimK` (0..1, for the shaders), `e.wl` (how high it is soaked). `groundY` and the player float swimmers through `waterFloorY`. The actor shaders get swimming as a negative `iAnim.w` (death stays positive) and the soaked height in whole 5 cm steps of `iWear.x` (the fraction is the wetness).
- Anything that should ring the water calls `rippleDrop(x, z, r, depth)` or `splashAt(x, z, size)`; spells that leave an AoE mark on water splash by themselves.
- Drinking: at any lake, pond or river the water module offers the drink and survival's `drinkAt(spot, kind)` does it (you drink your fill and every `waterskin_empty` becomes a `water`). Drinking a `water` from the bags, or using one in a recipe, gives back a `waterskin_empty`. Dirty gear is washed first unless you are really thirsty; with a rod and no thirst, fishing comes first.
- A mage's ice (`freezeWater`, 07b_classes.js) lies at its water's own surface (`s.wy`) as a floor; `onIce` keeps bodies on it out of the water, and swimmers caught where it forms are lifted onto it.

**Buildings**
- Buildings are merged geometry with a per-vertex material id (`MAT` in `04_props.js`: stone 0 … rock 15, drystone 16).
- The building shader branches on that id. To add a surface type, add an id and a shader branch.

**Body actions** (`setAct(e, id, seconds)`; the humanoid shader's `atype`): 1 one-handed strike, 2 bow draw, 3 spellcasting, 4 a flinch, 5 using something (reach, pick, drink from a skin), 6 in the air, 7 whirlwind, 8 overhead smash, 9 leap strike, 10 guard, 11 parry, 12 kneel (07b_classes.js), 13 down on the haunches to reach the ground (picking, drinking at a lake; 09s_survival.js). Actions 7 and up own the whole body. Take the next free number for a new one.

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
- `setupStats` applies `e.gear` (the totals of `gearTotals`) for the player and for bots (`e.bot`), never for other NPCs.
- `e.motion` moves a body by itself: `spin` (whirlwind) or `leap` (a parabola to a landing spot). `updateMotion` runs for the player and for NPCs.

**Crowd control** ([balance], `07c_balance.js`)
- Every stun, root and snare passes `ccAdjust` in `addBuff` (after the realm gifts' `giftBuffAdjust`). Players, bots and champions (`ccChampion`) have diminishing returns per kind: full, half, a quarter within 15 s of the last, then 6 s immune (`e.ccdr`). A control refreshed by the same source while it still holds does not count again. Pass `{ ccAll: true }` as `addBuff`'s extra to put an ordinary body under the rule (a parry's stun does). A freeze is a stun: `addChill` asks `ccAdjust(e, 'stun', dur, 'frozen', true)` for champions (ordinary bodies keep the five seconds of thaw); the frozen buffs themselves come with the source `'frozen'` and are not counted twice. An immunity (the third control's, or Divine Shield's) holds for anyone.
- New controls should use these three buff kinds so the rule covers them.

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

**Farming**
- A bed's slots are 0.6 m apart; `slotPos(P, s)` is where a plant stands; `plotAt(x, z)`, `plotLocal`/`plotWorld` convert to the bed's furrows (u across, v along).
- Beds and strips go into the cover map (`farmCoverAll` at the end of `buildCoverMask`), so no grass grows through the soil; removing a bed rebuilds the cover map.
- Growth is stepped every half second in `updateFarming` (`FARM.speed` speeds it for tests); drawing refills the instances twice a second, when the camera moves 3 m or when `FARM.drawDirty` is set.

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
  - the building pieces' shader (`06k_build.js`, throws at boot if an anchor is missing): `attribute vec3 aCol;` and `vec4 w = modelMatrix * vec4(position, 1.0);` in the vertex shader, `uniform float uFlash, uWet, uSnowCover;`, `void main(){` and `vec3 col = lightSurface(alb, n, vAO);` in the fragment shader.
- Keep halls are houses (`H.keepHall`): code that walks `HOUSES` meets them too (fire, lightning, the cover map, the save). Tests that count town houses filter them out (`houses.py`).
- The human crowd uses 15 of the 16 guaranteed vertex attributes. Pack new per-instance data into spare channels rather than adding attributes.

## Roadmap

| # | Work | Status |
|---|---|---|
| 1 | Level 50: scaling, borderland camps and champions, 8 new abilities, ranks, 8-slot hotbar | Done (version 6) |
| 2 | Lore and onboarding: prologue, Chronicle, path with rewards, field notes, tips | Done (version 6). The Chronicle's 17 pages are grouped in four parts (version 8) |
| 3 | Working castles: gates, stairs, wall walks, parapets, garrison routes, breaches and repairs, banners | Done (version 6). Left: tower interiors and hatches |
| 4 | Working houses: doors, shutters, glazing, furnished rooms, townsfolk's days, burning and rebuilding | Done (version 6). Left: the night and morning checks in `houses.py` are flaky after a long run |
| 5 | Reactive land: felling and regrowing trees, cut grass, grass and tree fire, craters | Done (versions 6 and 7) |
| 6 | Weather on everything and gear wear: wet, snow, drying, lightning strikes, durability, blood, mud, repair, washing | Done (versions 6 and 7) |
| 7 | The war: readable, steerable orders and winnable campaigns | Done (version 6). Left: `siege.py`'s "the band stands guard by its engine" and breach checks fail now and then (they did before version 8 too) |
| 8 | Visual pass on existing models and shaders | Done (version 7) |
| 9 | Realm gifts (passives and a realm ultimate); the land saved with the world, loot settling into craters, the woodcutter's axe | Done (version 7) |
| 10 | Music, aurora, siege engines, the war AI using breaches and sallies, campaign tuning (claims over renown) | Done (version 7). Left: tower interiors and hatches |
| 12 | Animation: foot-locked gaits for people and beasts, Cinderwing's flight | Done (version 7) |
| 13 | No clipping: cover map, props and logs clear of walls, temple dais floors | Done (version 7); every version 8 system marks its footprints |
| 14 | Fire for everyone: burning brands; fire spells aimed at trees and grass | Done (version 7) |
| 15 | Water: swimming, wading, rivers with currents, ponds, splashes and ripples, drinking, waterskins | Done (version 8). Left: diving under, boats |
| 16 | The keep's great hall: a working door into a hall with a war table, armourer's bench, basin and hearth | Done (version 8) |
| 17 | Class systems: elemental magic reacting to the world; warrior stances and momentum; archer draw and arrows; priest devotion and holy ground; realm flavours | Done (version 8). Balanced in version 9 (see Balance of the callings) |
| 18 | Survival and crafting: hunger and thirst, foraging, hunting, fishing, cooking; materials, workstations, recipes | Done (version 8). Left: bushes and apple trees do not burn or fall; crafted gear stops at item level 24 |
| 19 | Farming and herb lore, plant breeding: seasons, beds, crops, weeds, soil, strains and crossing, town fields, wild herbs and the herbal | Done (version 8). Left: gardens in Ériu and Thule; the new herbs' powers in potions; seasonal colours of trees and grass |
| 20 | Animals: taming, pets, livestock, breeding | Done (version 8) |
| 21 | Building: placed structures | Done (version 8). Left: NPCs using built doors, more roof shapes (hips, lean-tos) |
| 22 | Version 9: balance of the callings; phones and performance (low quality draws over two million triangles in a town); seasons across the world (frozen lakes in Thule winters, autumn leaves); depth and polish of the new systems | Next |
| 22a | [balance] Balance and mastery of the callings: simple and skilled bots, the balance run with mastery duels, diminishing returns on stuns, roots and slows (parries cannot stun-lock), Divine Shield wards off control, a priest's offer to raise the fallen player, the steam burst, carved rune glyphs and tracked quarry on the minimap made to read, each calling at level 28 beats the Hollow King | Done (version 9, feature/balance). Left: see Balance of the callings |

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
- **Version 7:**
  - A visual pass: meadow, canopy and ground-shade maps, height fog, graded composite, better water, sky, trees and beasts.
  - Realm gifts and ultimates; the land saved with the world; loot settling into craters; the woodcutter's axe.
  - Siege engines (rams, mangonels, trebuchets), breaches stormed, plugged and sallied against; campaign tuning.
  - A procedural score, the northern lights and shooting stars.
  - Foot-locked gaits for people and beasts; Cinderwing flies, glides and banks.
  - The 1 m cover map: no grass, flower or log through floors, walls or paving; the temple dais fixed.
  - Burning brands from any fire; fire spells aimed at the tree or grass in front.
- **Version 8:**
  - Real water: a river per realm down its valley, ponds in the hollows, see-through water with ripples; wading and swimming for people and beasts; drinking and waterskins.
  - The callings: warrior stances, momentum, finishers, shield and parry; the archer's draw, arrow goods, hiding and snares; the mage's fire, frost and storm with attunement and combos, ice over water, runes; the priest's devotion, holy ground, blessings and raising the fallen; realm flavours; NPCs use all of it.
  - Survival and crafting: gentle hunger and thirst, foraging, hunting, fishing, cooking, workstations in every town and keep, a crafting book of about 55 recipes, skills that grow.
  - Farming and herb lore: seasons, tilled beds and crops through their stages, weeds and soil, plant breeding with strains, town fields worked by the townsfolk, wild herbs and the herbal.
  - Animals: taming wolves, boars, deer and wild horses; companions with orders; livestock in commons and paddocks; breeding with inherited traits.
  - Keep halls with war tables, armourers and hearths; building from goods: walls, doors, roofs, stairs, fences, beds and chests that burn and are repaired.
