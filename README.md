# The Hallowmarch

An original three-realm war game for the browser. Three realms, **Logres**, **Ériu** and **Thule**, fight over one shared frontier. You choose a realm and a class, grow strong against the monsters of your homeland, then go to war. You march with the warbands, break keep gates and slay their lords, and carry off the enemy's hallows. Cinderwing the dragon also waits for you, and so does the Hollow King in the Barrow under the Lone Tree.

Everything is made in code: the terrain, castles, towns, people, beasts, sky and weather. There are no image or model files, and the whole game builds into one HTML file.

## Play

The current build is published as a Claude artifact. You can also build it yourself and open `hallowmarch.html` in a browser. It needs a network connection, because three.js and the fonts load from a CDN.

| Keys | |
|---|---|
| W A S D | Move relative to the camera. Shift to run, Space to jump |
| Mouse drag | Turn the camera. Right-drag also turns you. Scroll to zoom |
| Click | Target a creature, soldier, gate or friend |
| 1 – 6 | Abilities (1 – 8 from the next version) |
| Tab · F | Cycle enemies in front of you · target yourself |
| E | Use a portal stone, speak to the herald, take a hallow, open a chest |
| R | Whistle for your horse, or step down |
| I · Q | Gear and bags · drink a healing draught |
| M · L · H · Esc | Map · log · help · menu |

On phones and tablets the game shows a thumb joystick and touch buttons.

Progress saves to the artifact's private per-player database on claude.ai. Opened as a plain file, it saves to the browser's local storage.

## Build

```sh
python3 build.py      # writes hallowmarch.html
```

`build.py` joins `src/page.html` and every `src/NN_*.js` module, in filename order, into one `<script type="module">`.

## Test

The tests drive the real page in headless Chromium using SwiftShader WebGL, through the debug API `window.__hm`.

```sh
cd tools && npm install && cd ..                  # once: three.js for the test browser, eslint
pip install playwright && python3 -m playwright install chromium   # once, if Chromium is missing

tools/lint.sh                                     # build, then eslint the module script
python3 tools/tests/shaders.py                    # compile every shader at every quality level
python3 tools/tests/barrow.py                     # the dungeon, end to end
python3 tools/tests/phone.py                      # phone HUD screenshots -> tools/out/
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
| `tools/` | Test harness, tests, lint, war soak and a world-map dump |
| `CLAUDE.md` | Working notes for developers and AI agents: architecture, conventions, rules and roadmap |

## Ground rules

The game is original work. It takes the idea of three realms at war from the classic realm-versus-realm games, but it uses no names, classes, places, art or branding from any of them.
