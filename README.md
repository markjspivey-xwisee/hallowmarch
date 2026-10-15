# The Hallowmarch

An original three-realm war game for the browser. Three realms, **Logres**, **Ériu** and **Thule**, fight over one shared frontier. You choose a realm and a class, grow strong against the monsters of your homeland, then go to war. You march with the warbands, break keep gates and slay their lords, and carry off the enemy's hallows. Cinderwing the dragon also waits for you, and so does the Hollow King in the Barrow under the Lone Tree.

Everything is made in code: the terrain, castles, towns, people, beasts, sky and weather. There are no image or model files, and the whole game builds into one HTML file.

## Play

[Play the persistent March](https://march-production-f6d9.up.railway.app/). The server runs the realm season while players are away and keeps accounts, saves and companies. Choose a realm and a calling, then help your realm through fighting, deliveries and shared works.

You can also build the game yourself and open `hallowmarch.html` in a browser. A standalone page runs its own world and saves in browser storage. It needs a network connection, because three.js and the fonts load from a CDN. The separately published Claude artifact remains version 19 until it is republished.

| Keys | |
|---|---|
| W A S D | Move relative to the camera. Shift to run, Space to jump |
| Mouse drag | Turn the camera. Right-drag also turns you. Scroll to zoom |
| Click | Target a creature, soldier, gate or friend |
| 1 – 8 | Abilities |
| Tab · F | Cycle enemies in front of you · target yourself |
| E | Use a portal stone, speak to the herald, take a hallow, open a chest |
| R | Whistle for your horse, or step down |
| I · Q | Gear and bags · drink a healing draught |
| M · L · H · Esc | Map · log · help · menu |
| P · U | Players and companies · dive while swimming |

On phones and tablets, drag on the movement side to walk and use the opposite thumb for combat. **Inventory**, **Skills**, **Map**, and **Menu** are always visible: at the bottom in portrait and between the status panel and minimap in wide landscape. Inventory opens your gear and bags directly; Skills opens your learned abilities, upcoming unlocks and class controls. Menu has Explore, Skills, Social and Options tabs, including handedness and larger controls/text. Browser tabs use the browser's safe viewport; installed/fullscreen play retains notch and home-indicator insets.

On the server, sign in to keep your character across devices. The Players panel includes persistent companies within your realm: membership, ranks, chat, notices and support for shared works. The season's armies enter the live war near players and their losses return to the season; deliveries help your realm without letting a large roster alone decide the result.

The Claude artifact uses its private per-player database. A plain file uses browser storage.

## Build

```sh
python3 build.py      # writes hallowmarch.html
```

`build.py` joins `src/page.html` and every `src/NN_*.js` module, in filename order, into one `<script type="module">`.

## Test

The tests drive the real page in headless Chromium using SwiftShader WebGL, through the debug API `window.__hm`.

```sh
npm ci --prefix tools                            # three.js for the test browser, eslint
npm ci --prefix server                           # server tests and local hosting
pip install playwright && python3 -m playwright install chromium   # once, if Chromium is missing

bash tools/lint.sh                                # build, then eslint the module script
node --test tools/tests/companies_regression.mjs tools/tests/fieldarmies_regression.mjs
node tools/tests/net_companies.mjs                # actual socket and persistence checks
node tools/tests/wasm_lp.js n=4000 seed=1 time      # JS/WASM paths and fallback
node tools/tests/loops_season.js seeds=12          # season participation measures
python3 tools/tests/net.py companies weather       # browser/server flows
python3 tools/tests/season2.py                     # live field armies
python3 tools/tests/perf.py low medium high render budget
python3 tools/tests/perf2.py long minutes=60       # heap, buffers and scene growth
python3 tools/tests/shaders.py                    # compile every shader at every quality level
python3 tools/tests/barrow.py                     # the dungeon, end to end
python3 tools/tests/phone.py                      # phone HUD screenshots -> tools/out/
python3 tools/tests/mobile_navigation.py          # real touch navigation, dialogs and browser viewport sizing
python3 tools/soak.py 10                          # ten minutes of simulated war
python3 tools/hm.py '{"script":[["eval","__hm.start({realm:0,cls:\"warrior\",level:20})"],["shot","hello"]]}'
```

## Layout

| Path | What it holds |
|---|---|
| `src/page.html` | Page shell: CSS, HUD and menu markup |
| `src/00–05*.js` | World, rendering, terrain, buildings, trees, the Barrow, characters, fire, weather and effects |
| `src/06–08*.js` | Game data, items, entities and combat, war AI, wildlife, the dragon, and the Barrow's monsters |
| `src/09–13*.js` | Player, horses, loot, UI, kit screen, audio, saves, and the main loop |
| `src/14*.js` | Multiplayer, accounts, realm season, companies and shared weather |
| `server/` | Persistent accounts, saves, companies, season and WebSocket service |
| `tools/` | Test harness, tests, lint, war soak and a world-map dump |
| `CLAUDE.md` | Working notes for developers and AI agents: architecture, conventions, rules and roadmap |

## Ground rules

The game is original work. It takes the idea of three realms at war from the classic realm-versus-realm games, but it uses no names, classes, places, art or branding from any of them.
