"""Survival and crafting (06s_survival.js, 09s_survival.js, 09t_craft.js): hunger and thirst fall over simulated time,
faster running than resting, and change how fast health comes back (never killing); eating, drinking and the quick
key; wells, troughs and lakes; berry bushes, mushroom rings and apple trees picked and growing back; a hunt's drops
(more with a knife); fishing from cast to catch, a strike too soon and one too late; cooking at a fire, a stew in a
pot; recipes at every station; a crafted pick and axe used; merchants' provisions; the Chronicle and help; needs,
skills and the picked land through a save and back, an old save and a damaged one. Screenshots: the needs on the
HUD, a berry bush and a mushroom ring, fishing, the forge, the crafting book on a desk and on a phone.
usage: python3 tools/tests/survival.py [noshots]"""
import json, asyncio, sys, pathlib, time, base64
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
SHOTS = 'noshots' not in sys.argv
ONLY_SHOTS = 'shotsonly' in sys.argv
PICK = next((a[5:].split(',') for a in sys.argv if a.startswith('only=')), None) # only=bush,fishing: just those pictures
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HELPERS = """
window.T = {
  H: __hm, S: __hm.surv, F: __hm.fn,
  P() { return __hm.GAME.player; },
  sim(s) { __hm.simulate(s); },
  // stand at (x, z) facing (fx, fz), out of combat
  stand(x, z, fx, fz) { const P = this.P(); P.x = P.prevX = x; P.z = P.prevZ = z; P.y = __hm.fn.heightAt(x, z); if (fx !== undefined) P.yaw = Math.atan2(fx - x, fz - z); P.combatUntil = -99; P.target = null; P.mount = null; __hm.surv.SURV.lx = null; },
  label() { const it = __hm.fn.playerInteract && window.__hmCI ? window.__hmCI() : null; return it; },
  cam(x, y, z, tx, ty, tz) { const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
};
;0"""

async def ev(page, name, js):
    t = time.time()
    r = await page.evaluate(js)
    print(f'[{name} {time.time() - t:.1f}s]', json.dumps(r)[:1500], flush=True)
    return r

# the page's own frame loop is slowed while pictures are taken (SwiftShader on a busy machine): frames are drawn here
SLOW_RAF = "window.requestAnimationFrame = () => 0;0" # the loop stops; each picture is one frame drawn here
# a view of the world is read straight from the canvas after drawing it (no wait for the compositor on a busy machine)
async def shot(page, name, js, frames=1):
    if PICK and name not in PICK: return
    await page.evaluate(js + ';0')
    for _ in range(frames - 1): await page.evaluate('__hm.frame(0.1);0')
    url = await page.evaluate("(() => { __hm.frame(0.1); return document.getElementById('scene').toDataURL('image/png'); })()")
    path = OUT + f'survival_{name}.png'
    pathlib.Path(path).write_bytes(base64.b64decode(url.split(',', 1)[1]))
    print('saved', path, flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if SHOTS else 640, h=540 if SHOTS else 360)
        await page.evaluate("__hm.start({ realm: 0, cls: 'archer', level: 12 }); __hm.UI.modal = null; 0")
        await page.evaluate(HELPERS)
        # currentInteraction is not exported: read the prompt the HUD shows (updateHUD runs in frame())
        await page.evaluate("window.__hmCI = () => __hm.surv.ci();0")

        if ONLY_SHOTS:
            await page.evaluate("""(() => { const P = T.P(), F = T.F; let shore = null;
              for (const L of T.H.dbg.LAKES || []) { for (let a = 0; a < 6.28 && !shore; a += 0.2) for (let r = L.r * 0.6; r < L.r * 1.6; r += 0.5) { const x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r; if (F.heightAt(x, z) > -3.0 && F.heightAt(x, z) < -1.5 && F.isWalkable(x, z)) { T.stand(x, z); if (T.S.shoreNear(P)) { shore = { x, z }; break; } } } if (shore) break; }
              window.__shore = shore; F.goodsAdd('tool_rod', 1, true); })();0""")
        # ---- the world: plants and stations ----
        if not ONLY_SHOTS:
          await checks(page)
        if SHOTS:
          await shots(page)
        await b.close()
        if SHOTS and (not PICK or 'phone' in PICK):
          await phone(p)
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')

async def checks(page):
        r = await ev(page, 'world', """(() => { const S = T.S;
          const kinds = {}; for (const p of S.FORAGE.list) kinds[p.k] = (kinds[p.k] || 0) + 1;
          const st = {}; for (const s of S.CRAFT.stations) st[s.kind] = (st[s.kind] || 0) + 1;
          const fires = T.H.dbg.FIRES.filter((f) => f.station).length;
          return { kinds, st, sites: S.CRAFT.stations.map((s) => s.site.name), fires, hud: !!document.getElementById('needs'), errs: T.H.errors.slice(0, 3) }; })()""")
        check(all(r['kinds'].get(k, 0) >= n for k, n in [('bush', 100), ('mush', 30), ('ember', 8), ('heal', 20), ('mana', 15), ('frost', 15), ('storm', 15), ('nettle', 30), ('apple', 8)]), 'plants of every kind grow in the world')
        check(r['st'].get('forge', 0) >= 6 and r['st'].get('workbench', 0) >= 6 and all(r['st'].get(k, 0) >= 3 for k in ['tanning', 'loom', 'oven', 'alchemy']), f'every town has its six stations and keeps a forge and a workbench {r["st"]}')
        check(r['fires'] >= 9, 'the forges, ovens and stills burn with real fires')
        check(r['hud'], 'the needs are on the HUD')

        # ---- needs over time, by activity ----
        r = await ev(page, 'needs', """(() => { const S = T.S, P = T.P(), N = S.NEEDS, I = T.H.INPUT;
          N.speed = 30; const out = {};
          // along the road from the town toward the muster: open going
          const R = T.H.REALMS[0], town = R.town, mu = R.musterSite, ux = (mu.x - town.x), uz = (mu.z - town.z), L = Math.hypot(ux, uz);
          const sx = town.x + ux / L * 45, sz = town.z + uz / L * 45;
          const run = (keys, secs) => { S.SURV.hunger = S.SURV.thirst = 0.9; T.stand(sx, sz); P.endurance = 100; T.H.CAM.yaw = Math.atan2(ux, uz); for (const k of keys) I.keys.add(k); T.sim(secs); I.keys.clear(); out.moved = (out.moved || []).concat(Math.round(Math.hypot(P.x - sx, P.z - sz))); return [0.9 - S.SURV.hunger, 0.9 - S.SURV.thirst]; };
          out.rest = run([], 12); out.walk = run(['KeyW'], 12); out.sprint = run(['KeyW', 'ShiftLeft'], 12);
          N.speed = 1;
          // what the needs do: health back while resting, fed against starving
          const regen = (h, t) => { T.stand(sx, sz); S.SURV.hunger = h; S.SURV.thirst = t; P.hp = P.maxHp * 0.55; P.combatUntil = -99; const a = P.hp; T.sim(3); return (P.hp - a) / P.maxHp; };
          out.fed = regen(0.9, 0.9); out.ok = regen(0.4, 0.4); out.low = regen(0.15, 0.6); out.empty = regen(0.0, 0.0);
          out.mult = [S.needsMult().hp, S.needsState().key, S.needsState().label];
          // never death: empty needs for a long while
          S.SURV.hunger = S.SURV.thirst = 0; P.hp = P.maxHp; N.speed = 50; T.sim(30); N.speed = 1;
          out.alive = [P.alive, P.hp >= P.maxHp * 0.99];
          out.warned = [...document.querySelectorAll('#log div')].map((d) => d.textContent).filter((t) => /starving|parched|hungry|thirsty/i.test(t)).slice(-3);
          return out; })()""")
        rest, walk, sprint = r['rest'], r['walk'], r['sprint']
        check(0 < rest[0] < walk[0] < sprint[0] and 0 < rest[1] < walk[1] < sprint[1], f'hunger and thirst fall slowly at rest, faster walking, fastest running {rest} {walk} {sprint}')
        check(walk[0] < 0.15 and walk[1] < 0.2, f'at 30x speed, 12 s of walking (6 minutes of play) costs well under a fifth of either need (moved {r["moved"]} m)')
        check(r['fed'] > r['ok'] > r['low'] > r['empty'] > 0, f'well fed heals fastest, hungry slower, starving slowest, but still heals {r["fed"]:.3f} {r["ok"]:.3f} {r["low"]:.3f} {r["empty"]:.3f}')
        check(r['alive'] == [True, True], 'empty needs never hurt or kill')
        check(len(r['warned']) >= 1, f'a gentle warning in the log {r["warned"]}')

        # ---- eating and drinking ----
        r = await ev(page, 'eat', """(() => { const S = T.S, F = T.F; const out = {};
          out.pack = [F.goodsCount('bread'), F.goodsCount('apple'), F.goodsCount('water')]; T.H.INV.goods = {}; // a new character's pack for the road; then empty packs
          F.goodsAdd('bread', 2, true); F.goodsAdd('water', 2, true); F.goodsAdd('meat_raw', 1, true);
          S.SURV.hunger = 0.3; S.SURV.thirst = 0.6;
          out.eat = S.eatGood('bread'); out.h = S.SURV.hunger; out.bread = F.goodsCount('bread');
          S.SURV.thirst = 0.2; S.SURV.hunger = 0.9; out.quick = S.quickEatDrink(); out.t = S.SURV.thirst; out.water = F.goodsCount('water');
          S.SURV.hunger = 1; S.SURV.thirst = 1; out.full = S.eatGood('bread');
          // the bags: food has an Eat button, drink a Drink button
          F.openKit(); const html = document.getElementById('kit-right').innerHTML; out.btns = [html.includes('data-gooduse="bread"'), /Drink/.test(html), html.includes('kit-craft'), html.includes('kit-eat')];
          S.SURV.hunger = 0.5; document.querySelector('[data-gooduse="bread"]').click(); out.viaBags = S.SURV.hunger; F.closeKit();
          // V eats too
          S.SURV.hunger = 0.4; F.goodsAdd('apple', 1, true); window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyV' })); out.viaV = S.SURV.hunger;
          return out; })()""")
        check(r['pack'] == [2, 2, 3], f'a new character sets out with bread, apples and water {r["pack"]}')
        check(r['eat'] and abs(r['h'] - 0.7) < 0.01 and r['bread'] == 1, 'eating a loaf fills 40% of hunger and uses it up')
        check(r['quick'] and r['t'] > 0.6 and r['water'] == 1, 'the quick key drinks when thirst is the bigger need')
        check(r['full'] is False, 'nothing is eaten when full')
        check(all(r['btns']), 'the bags have Eat and Drink buttons, and Eat or drink and Crafting under the bags')
        check(r['viaBags'] > 0.85 and r['viaV'] > 0.4, 'eating from the bags and with V')

        # ---- water: a well and a lake ----
        r = await ev(page, 'water', """(() => { const S = T.S, F = T.F, P = T.P(); const out = {};
          const w = S.wellSpots().find((q) => q.kind === 'well' && Math.hypot(q.x - T.H.REALMS[0].town.x, q.z - T.H.REALMS[0].town.z) < 60);
          T.stand(w.x + 1.6, w.z, w.x, w.z); S.SURV.thirst = 0.3; F.goodsTake('water', F.goodsCount('water'));
          out.label = __hmCI(); F.playerInteract(); T.sim(1.6); out.t = S.SURV.thirst; out.skins = F.goodsCount('water');
          // a lake: walk the edge of the nearest one
          let shore = null;
          for (const L of T.H.dbg.LAKES || []) { for (let a = 0; a < 6.28 && !shore; a += 0.2) for (let r = L.r * 0.6; r < L.r * 1.6; r += 0.5) { const x = L.x + Math.sin(a) * r, z = L.z + Math.cos(a) * r; if (F.heightAt(x, z) > -3.0 && F.heightAt(x, z) < -1.5 && F.isWalkable(x, z)) { T.stand(x, z); if (S.shoreNear(P)) { shore = { x, z }; break; } } } if (shore) break; }
          out.shore = !!shore;
          if (shore) { S.SURV.thirst = 0.4; F.goodsTake('water', F.goodsCount('water')); out.lakeLabel = __hmCI(); F.playerInteract(); T.sim(2); out.lakeT = S.SURV.thirst; out.lakeSkins = F.goodsCount('water'); window.__shore = shore; }
          return out; })()""")
        check(r['label'] and 'Drink from the well' in r['label'], f'at the well: "{r["label"]}"')
        check(r['t'] > 0.99 and r['skins'] == 8, 'drinking at the well slakes thirst and fills eight waterskins')
        check(r['shore'] and r.get('lakeLabel') and 'lake' in r['lakeLabel'] and r['lakeT'] > 0.99 and r['lakeSkins'] == 8, f'at a lake shore: "{r.get("lakeLabel")}", drink and fill')

        # ---- foraging and regrowth ----
        r = await ev(page, 'forage', """(() => { const S = T.S, F = T.F, P = T.P(); const out = {};
          const near = (k) => S.FORAGE.list.filter((p) => p.k === k).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
          for (const k of ['bush', 'mush', 'apple', 'heal']) {
            const p = near(k), K = S.FORAGE_KINDS[k];
            T.stand(p.x + K.r * p.s + 0.6, p.z, p.x, p.z);
            const before = F.goodsCount(K.good), label = __hmCI();
            F.playerInteract(); T.sim(1.6);
            out[k] = { label, got: F.goodsCount(K.good) - before, ripe: p.ripe, again: __hmCI() };
            p.at = T.H.GAME.t + 6; T.sim(4); out[k].mid = Math.round(p.ripe * 100) / 100; T.sim(4); out[k].back = p.ripe;
          }
          out.skill = S.SURV.skill.forage;
          return out; })()""")
        for k, verb in [('bush', 'Pick berries'), ('mush', 'Gather the mushrooms'), ('apple', 'Pick apples'), ('heal', 'Pick woundwort')]:
            q = r[k]
            check(q['label'] == verb and q['got'] >= 2 and q['ripe'] == 0, f'{k}: "{q["label"]}" gives {q["got"]} and leaves it bare')
            check(q['again'] != verb and q['back'] == 1, f'{k}: it grows back (half way {q["mid"]}, then whole)')
        check(r['skill'] > 0, 'foraging is a skill that grows')

        # ---- the hunt ----
        r = await ev(page, 'hunt', """(() => { const S = T.S, F = T.F, P = T.P(), H = T.H; const out = {};
          const deer = H.ENT.find((e) => (e.kind === 'deer' || e.kind === 'stag') && e.alive);
          out.game = !!deer.game; out.enemy = F.isEnemy(P, deer);
          const drops = (e) => H.LOOT.filter((L) => L.item.goods && Math.hypot(L.x - e.x, L.z - e.z) < 4).reduce((o, L) => { o[L.item.goods] = (o[L.item.goods] || 0) + L.item.n; return o; }, {});
          H.LOOT.length = 0; F.goodsTake('tool_knife', F.goodsCount('tool_knife'));
          F.dealDamage(P, deer, 1e6); T.sim(0.5); out.deer = drops(deer);
          // a wolf with a knife in the pack
          F.goodsAdd('tool_knife', 1, true);
          const w = H.ENT.find((e) => e.kind === 'wolf' && e.alive); H.LOOT.length = 0; F.dealDamage(P, w, 1e6); T.sim(0.5); out.wolf = drops(w);
          return out; })()""")
        check(r['game'] and r['enemy'], 'deer are game the player can hunt')
        check(r['deer'].get('meat_raw', 0) >= 2 and r['deer'].get('hide', 0) >= 1 and r['deer'].get('bone', 0) >= 1, f'a deer leaves meat, a hide and bone {r["deer"]}')
        check(r['wolf'].get('meat_raw', 0) >= 2 and r['wolf'].get('hide', 0) >= 2, f'a wolf skinned with a knife gives more {r["wolf"]}')

        # ---- fishing ----
        r = await ev(page, 'fish', """(() => { const S = T.S, F = T.F, P = T.P(); const out = {};
          const sh = window.__shore; T.stand(sh.x, sh.z); const sp0 = S.fishSpot(P); if (sp0) P.yaw = Math.atan2(sp0.x - P.x, sp0.z - P.z);
          out.noRod = __hmCI();
          F.goodsAdd('tool_rod', 1, true); out.label = __hmCI();
          F.playerInteract(); out.cast = S.SURV.fish && S.SURV.fish.phase; out.pose = !!P.fishing;
          // a strike too soon frightens the fish
          T.sim(1.0); out.wait = S.SURV.fish.phase; S.fishStrike(); out.soon = S.SURV.fish.phase;
          // wait for the bite and strike
          let n = 0; while (S.SURV.fish && S.SURV.fish.phase !== 'bite' && n++ < 120) T.sim(0.25);
          out.bite = S.SURV.fish && S.SURV.fish.phase; out.strikeLabel = __hmCI();
          const before = F.goodsCount('fish_raw'); F.playerInteract(); T.sim(1.6);
          out.caught = F.goodsCount('fish_raw') - before; out.after = S.SURV.fish && S.SURV.fish.phase; out.skill = S.SURV.skill.fish;
          // a bite missed: it gets away and the float goes back out
          F.playerInteract(); n = 0; while (S.SURV.fish && S.SURV.fish.phase !== 'bite' && n++ < 120) T.sim(0.25);
          T.sim(S.SURV.fish.win + 0.2); out.missed = S.SURV.fish && S.SURV.fish.phase;
          out.kinds = [...new Set(Array.from({ length: 60 }, () => S.fishRoll(sh.x, sh.z).name))];
          S.fishStop(null); out.stopped = !S.SURV.fish && !P.fishing;
          return out; })()""")
        check(r['noRod'] != 'Fish here' and r['label'] == 'Fish here', f'with a rod at the water: "{r["label"]}" (and not without one)')
        check(r['cast'] == 'cast' and r['pose'], 'the line is cast, the rod held up')
        check(r['wait'] == 'wait' and r['soon'] == 'wait', 'a strike too soon frightens the fish back to waiting')
        check(r['bite'] == 'bite' and r['strikeLabel'] == 'Strike!', 'a bite comes, and the prompt says "Strike!"')
        check(r['caught'] >= 1 and r['skill'] > 0, f'struck in time, the fish is caught ({r["caught"]} raw fish)')
        check(r['missed'] == 'wait', 'a bite left too long gets away and the float goes back to waiting')
        check(len(r['kinds']) >= 2 and r['stopped'], f'different fish by place and time {r["kinds"]}')

        # ---- cooking at a fire ----
        r = await ev(page, 'cook', """(() => { const S = T.S, F = T.F, P = T.P(); const out = {};
          const f = T.H.dbg.FIRES.filter((q) => !q.station && !q.ghost && !q.indoor && q.until === Infinity && q.size < 0.7).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
          T.stand(f.x + Math.sin(0.3) * 1.6, f.z + Math.cos(0.3) * 1.6, f.x, f.z);
          let fire = S.fireNear(P); if (!fire) { for (let a = 0; a < 6.3 && !fire; a += 0.4) { T.stand(f.x + Math.sin(a) * 1.7, f.z + Math.cos(a) * 1.7, f.x, f.z); fire = S.fireNear(P); } }
          out.fire = !!fire;
          F.goodsTake('meat_raw', F.goodsCount('meat_raw')); F.goodsTake('fish_raw', F.goodsCount('fish_raw')); F.goodsTake('meat_cooked', F.goodsCount('meat_cooked'));
          F.goodsAdd('meat_raw', 3, true);
          out.label = __hmCI(); F.playerInteract(); out.job = S.SURV.job && S.SURV.job.kind;
          T.sim(9); out.cooked = F.goodsCount('meat_cooked'); out.raw = F.goodsCount('meat_raw');
          // a stew wants a pot: without one at a campfire it is refused, with one it is made
          F.goodsAdd('meat_raw', 1, true); F.goodsAdd('mushrooms', 2, true); F.goodsAdd('water', 1, true);
          const camp = { x: P.x, y: P.y, z: P.z, size: 1, until: 1e9 };
          out.noPot = S.craftBlock(S.RECIPE_BY_ID.stew_hunter, { fire: camp });
          F.goodsAdd('tool_pot', 1, true); out.stew = S.survCraftOnce(S.RECIPE_BY_ID.stew_hunter, { fire: camp }); out.stews = F.goodsCount('stew');
          out.cook = S.SURV.skill.cook;
          return out; })()""")
        check(r['fire'] and r['label'] and r['label'].startswith('Cook your raw meat'), f'at a brazier: "{r["label"]}"')
        check(r['job'] == 'cook' and r['cooked'] >= 3 and r['raw'] == 0, 'cooking turns every piece of raw meat into roast meat')
        check(r['noPot'] and 'pot' in r['noPot'] and r['stew'] and r['stews'] >= 2, 'a stew needs a pot or a hearth; with a pot it is made')
        check(r['cook'] > 0, 'cooking is a skill that grows')

        # ---- every station's recipes ----
        r = await ev(page, 'stations', """(() => { const S = T.S, F = T.F, P = T.P(), H = T.H; const out = {};
          const town = H.REALMS[0].town;
          const at = (kind) => S.CRAFT.stations.filter((s) => s.kind === kind).sort((a, b) => Math.hypot(a.x - town.x, a.z - town.z) - Math.hypot(b.x - town.x, b.z - town.z))[0];
          S.SURV.skill.craft = 30;
          const make = (kind, rid, give, n = 1) => {
            const st = at(kind); T.stand(st.fx, st.fz, st.x, st.z);
            for (const [id, k] of give) F.goodsAdd(id, k, true);
            const label = __hmCI();
            F.playerInteract(); const open = H.UI.modal === 'craft' && document.getElementById('craft-list').innerHTML.includes('data-rec="' + rid + '"');
            const rec = S.RECIPE_BY_ID[rid];
            const potions = H.INV.potions, bag = H.INV.bag.length, have = rec.make ? F.goodsCount(rec.make[0]) : 0;
            const row = document.querySelector('#craft [data-rec="' + rid + '"]'); if (row) row.click();
            const mk = document.querySelector('#craft [data-make="' + rid + '"]'); if (mk) mk.click();
            const started = S.SURV.job && S.SURV.job.kind === 'craft';
            S.closeCraft();
            T.sim(rec.time * n + 1.5);
            return { label, open, started, made: rec.make ? F.goodsCount(rec.make[0]) - have : rec.gear ? H.INV.bag.length - bag : H.INV.potions - potions };
          };
          out.workbench = make('workbench', 'planks', [['log', 1]]);
          out.forge = make('forge', 'smelt', [['iron_ore', 2], ['firewood', 1]]);
          out.pick = make('forge', 'tool_pick', [['iron', 2], ['stick', 1]]);
          out.tanning = make('tanning', 'leather', [['hide', 1]]);
          out.loom = make('loom', 'nettle_cloth', [['fibre', 4]]);
          out.oven = make('oven', 'bread', [['flour', 1], ['water', 1]]);
          H.INV.potions = 0; out.alchemy = make('alchemy', 'draught', [['herb_heal', 2], ['water', 1]]);
          F.goodsAdd('arrows_broadhead', 0, true);
          out.arrows = make('workbench', 'arrows_broadhead', [['stick', 2], ['feather', 2], ['flint', 1]]);
          out.coat = make('tanning', 'coat', [['leather', 4], ['fibre', 2]]);
          const it = H.INV.bag[H.INV.bag.length - 1]; out.coatItem = it && [it.slot, it.base, it.q, it.lvl];
          // a batch: three planks' worth of logs at once
          F.goodsAdd('log', 3, true); const st = at('workbench'); T.stand(st.fx, st.fz, st.x, st.z); const pl = F.goodsCount('plank');
          S.craftStart(S.RECIPE_BY_ID.planks, 3, { station: st }); T.sim(12); out.batch = F.goodsCount('plank') - pl;
          // somewhere a recipe cannot be made
          out.away = S.craftBlock(S.RECIPE_BY_ID.smelt, {});
          out.skill = Math.round(S.SURV.skill.craft * 10) / 10;
          out.odds = [S.craftOdds(0).map(Math.round), S.craftOdds(100).map(Math.round)];
          return out; })()""")
        for k, verb in [('workbench', 'Work at the workbench'), ('forge', 'Work at the forge'), ('pick', 'Work at the forge'), ('tanning', 'Work at the tanning rack'), ('loom', 'Weave at the loom'), ('oven', 'Use the bakehouse'), ('alchemy', 'Use the alchemy table'), ('arrows', 'Work at the workbench'), ('coat', 'Work at the tanning rack')]:
            q = r[k]
            check(q['label'] == verb and q['open'] and q['started'] and q['made'] >= 1, f'{k}: "{q["label"]}" opens its recipes and makes {q["made"]}')
        check(r['coatItem'] and r['coatItem'][0] == 'chest' and r['coatItem'][1] == 'Leather Coat', f'a crafted leather coat is real gear {r["coatItem"]}')
        check(r['batch'] >= 9, f'a batch of three logs makes nine planks or more ({r["batch"]})')
        check(r['away'] and 'forge' in r['away'], f'away from a forge, smelting is refused: "{r["away"]}"')
        check(r['odds'][0][3] < r['odds'][1][3] and r['odds'][1][1] < r['odds'][0][1], 'skill shifts the odds toward better grades')

        # ---- a crafted tool used: the pick at a rock, the axe at a tree ----
        r = await ev(page, 'tools', """(() => { const S = T.S, F = T.F, P = T.P(), H = T.H; const out = {};
          const town = H.REALMS[0].town;
          const rocks = F.W.rocks.map((q, i) => [q, i]).filter(([q]) => q.s >= 0.8 && F.isWalkable(q.x + q.s + 0.9, q.z)).sort((a, b) => Math.hypot(a[0].x - town.x, a[0].z - town.z) - Math.hypot(b[0].x - town.x, b[0].z - town.z));
          const before = ['stone', 'flint', 'iron_ore'].map((id) => F.goodsCount(id));
          out.has = F.goodsHave('tool_pick'); out.tool = false;
          // two rocks, three times each: then they are worked out
          for (const [rk] of rocks.slice(0, 2)) {
            T.stand(rk.x + rk.s * 0.8 + 0.7, rk.z, rk.x, rk.z);
            out.label = out.label || __hmCI();
            for (let k = 0; k < 3; k++) { F.playerInteract(); T.sim(0.1); out.tool = out.tool || (P.look.mask & F.WB.axe) > 0; T.sim(3.4); }
            out.worked = (out.worked || []).concat(__hmCI());
          }
          out.got = ['stone', 'flint', 'iron_ore'].map((id, i) => F.goodsCount(id) - before[i]);
          out.weaponBack = (P.look.mask & F.WB.bow) > 0 && !(P.look.mask & F.WB.axe);
          // the axe: a tree takes fewer blows
          const N = T.H.nature;
          const tr = F.W.trees.filter((t) => Math.hypot(t.x - P.x, t.z - P.z) < 400).sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0];
          T.stand(tr.x + 1.2, tr.z, tr.x, tr.z);
          F.goodsTake('tool_axe', F.goodsCount('tool_axe')); F.playerInteract(); const n0 = N && N.NATURE && N.NATURE.job ? N.NATURE.job.need : null; T.sim(0.1);
          if (N && N.NATURE) N.NATURE.job = null;
          F.goodsAdd('tool_axe', 1, true); T.stand(tr.x + 1.2, tr.z, tr.x, tr.z); F.playerInteract(); const n1 = N && N.NATURE && N.NATURE.job ? N.NATURE.job.need : null;
          if (N && N.NATURE) N.NATURE.job = null;
          out.blows = [n0, n1];
          return out; })()""")
        check(r['has'] and r['label'] == 'Mine the rock', f'with a pick at a rock: "{r["label"]}"')
        check(r['tool'] and r['got'][0] >= 6 and r['got'][1] + r['got'][2] >= 1, f'mining with the pick in hand breaks out stone, flint and ore {r["got"]}')
        check(all(w != 'Mine the rock' for w in r['worked']), f'a rock is worked out after three goes {r["worked"]}')
        check(r['weaponBack'], "the archer's bow is back in hand after the work")
        check(r['blows'][0] and r['blows'][1] and r['blows'][1] < r['blows'][0], f'a woodsman\'s axe fells a tree in fewer blows {r["blows"]}')

        # ---- merchants ----
        r = await ev(page, 'merchant', """(() => { const S = T.S, F = T.F, H = T.H; const out = {};
          const m = H.REALMS[0].merchant; T.stand(m.x + Math.sin(m.yaw) * 2, m.z + Math.cos(m.yaw) * 2, m.x, m.z);
          H.INV.gold = 500; F.openKit('shop'); const html = document.getElementById('kit-left').innerHTML;
          out.shop = [html.includes('Provisions'), html.includes('data-sbuy="bread"'), html.includes('data-ssell=')];
          const b0 = F.goodsCount('bread'), g0 = H.INV.gold; document.querySelector('[data-sbuy="bread"][data-n="5"]').click(); out.bought = [F.goodsCount('bread') - b0, g0 - H.INV.gold];
          const g1 = H.INV.gold, s0 = F.goodsCount('stone'); document.querySelector('[data-ssell="stone"]').click(); out.sold = [s0 - F.goodsCount('stone'), H.INV.gold - g1];
          F.closeKit();
          return out; })()""")
        check(all(r['shop']), 'the merchant sells provisions and tools and buys goods')
        check(r['bought'][0] == 5 and r['bought'][1] > 0 and r['sold'][0] == 1 and r['sold'][1] > 0, f'buying bread and selling stone {r["bought"]} {r["sold"]}')

        # ---- the Chronicle and the help ----
        r = await ev(page, 'lore', """(() => { const F = T.F, H = T.H; const out = {};
          H.UI.modal = null; F.openMenu('chronicle'); H.LORE && (H.LORE.state.chronSec = 'living'); document.querySelector('.chron-nav [data-sec="living"]').click();
          out.chron = document.getElementById('menu-body').innerHTML.includes('Hunger and thirst');
          document.querySelector('#menu-tabs [data-tab="help"]').click(); out.help = document.getElementById('menu-body').innerHTML.includes('Food, water and crafting');
          document.getElementById('btn-resume').click();
          return out; })()""")
        check(r['chron'] and r['help'], 'the Chronicle has "Living off the land" and the help explains food, water and crafting')

        # ---- the save: needs, skills, wards; the picked land ----
        r = await ev(page, 'save', """(() => { const S = T.S, F = T.F, H = T.H; const out = {};
          S.SURV.hunger = 0.42; S.SURV.thirst = 0.61; S.SURV.skill.craft = 33.3; S.SURV.skill.fish = 7;
          const p = S.FORAGE.list.find((q) => q.k === 'bush'); p.ripe = 1; S.forageTake(p);
          const s = JSON.parse(JSON.stringify(F.buildSave()));
          out.char = s.char.x.surv; out.world = !!(s.world.x && s.world.x.forage && s.world.x.forage.p.some((e) => e[0] === p.i));
          S.SURV.hunger = 1; S.SURV.thirst = 1; S.SURV.skill.craft = 0; p.ripe = 1;
          F.savePartsLoad('char', s.char.x); F.savePartsLoad('world', s.world.x);
          out.back = [S.SURV.hunger, S.SURV.thirst, S.SURV.skill.craft, S.SURV.skill.fish, p.ripe < 1];
          F.savePartsLoad('char', undefined); out.old = [S.SURV.hunger, S.SURV.thirst, S.SURV.skill.craft];
          F.savePartsLoad('char', { surv: { h: 'x', t: 7, sk: { craft: -5, cook: 'q', fish: 1e9 }, w: 'nope' } }); out.bad = [S.SURV.hunger, S.SURV.thirst, S.SURV.skill.craft, S.SURV.skill.cook, S.SURV.skill.fish];
          F.savePartsLoad('world', { forage: { p: [[1e9, 4], 'x', [0, 'y']], r: [[-1, 2, 3]] } }); out.badWorld = S.FORAGE.list.every((q) => q.ripe === 1 || q === S.FORAGE.list[0]);
          return out; })()""")
        check(r['char'] and abs(r['char']['h'] - 0.42) < 0.01 and r['world'], 'needs, skills and the picked bush are saved')
        check(abs(r['back'][0] - 0.42) < 0.01 and abs(r['back'][1] - 0.61) < 0.01 and abs(r['back'][2] - 33.3) < 0.1 and r['back'][3] == 7 and r['back'][4], f'and come back on load {r["back"]}')
        check(r['old'] == [0.8, 0.8, 0], 'an old save starts fed enough, unskilled')
        check(r['bad'] == [0.8, 1, 0, 0, 100] and r['badWorld'], f'a damaged save is cleaned {r["bad"]}')

        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')

async def shots(page):
        if True:
            await page.evaluate("__hm.fn.setQuality('low'); __hm.setTod(0.55); __hm.dbg.WEATHER.mode = 'clear';0")
            await page.evaluate(SLOW_RAF)
            # the needs on the HUD, in play
            if not PICK or 'hud' in PICK:
              await page.evaluate("""(() => { const S = T.S, H = T.H, P = T.P(); const t = H.REALMS[0].town; T.stand(t.x + 18, t.z + 22); H.UI.modal = null; H.CAM.mode = 'play'; H.look(P.yaw + 2.6, 0.32, 7); S.SURV.hunger = 0.62; S.SURV.thirst = 0.21; })()""")
              for _ in range(3): await page.evaluate('__hm.frame(0.1);0') # the path tracker settles under the taller player frame
              await page.screenshot(path=OUT + 'survival_hud.png', timeout=600000); print('saved hud', flush=True)
            # a berry bush and a mushroom ring
            await shot(page, 'bush', """(() => { const S = T.S, P = T.P(); const p = S.FORAGE.list.filter((q) => q.k === 'bush').sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; p.ripe = 1; S.FORAGE.dirty = true; T.stand(p.x + 40, p.z + 40); T.cam(p.x + 2.2, p.y + 1.3, p.z + 1.6, p.x, p.y + 0.45, p.z); })()""")
            await shot(page, 'mushrooms', """(() => { const S = T.S, P = T.P(); const p = S.FORAGE.list.filter((q) => q.k === 'mush').sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z))[0]; p.ripe = 1; S.FORAGE.dirty = true; T.stand(p.x + 40, p.z + 40); T.cam(p.x + 1.7, p.y + 1.0, p.z + 1.2, p.x, p.y + 0.05, p.z); })()""")
            # fishing at the lake
            await shot(page, 'fishing', """(() => { const S = T.S, F = T.F, P = T.P(), sh = window.__shore; T.stand(sh.x, sh.z); const sp = S.fishSpot(P); P.combatUntil = -99; S.fishStart(sp); S.SURV.fish.phase = 'wait'; S.SURV.fish.t = 0; S.SURV.fish.wait = 1e9; const yaw = P.yaw; T.cam(P.x - Math.sin(yaw) * 1.5 + Math.cos(yaw) * 4.5, P.y + 2.4, P.z - Math.cos(yaw) * 1.5 - Math.sin(yaw) * 4.5, P.x + Math.sin(yaw) * 3, P.y + 1.0, P.z + Math.cos(yaw) * 3); })()""", 1)
            await page.evaluate("T.S.fishStop(null);0")
            # the forge in Logres
            await shot(page, 'forge', """(() => { const S = T.S, H = T.H; const t = H.REALMS[0].town; const st = S.CRAFT.stations.filter((s) => s.kind === 'forge').sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))[0]; const sx = Math.cos(st.yaw), sz = -Math.sin(st.yaw), fx = Math.sin(st.yaw), fz = Math.cos(st.yaw); T.stand(st.x + sx * 1.0 + fx * 1.25, st.z + sz * 1.0 + fz * 1.25, st.x + sx * 0.72 + fx * 0.22, st.z + sz * 0.72 + fz * 0.22); T.P().yaw = Math.atan2(-fx, -fz); const a = st.yaw - 0.5; T.cam(st.x + Math.sin(a) * 5.0, st.y + 2.2, st.z + Math.cos(a) * 5.0, st.x, st.y + 1.0, st.z); })()""")
            # the crafting book
            if PICK and 'craft' not in PICK: return
            await page.evaluate("""(() => { const S = T.S, H = T.H; H.UI.modal = null; H.CAM.mode = 'play'; const t = H.REALMS[0].town; const st = S.CRAFT.stations.filter((s) => s.kind === 'forge').sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))[0]; T.stand(st.fx, st.fz, st.x, st.z); const F = T.F; F.goodsAdd('iron', 4, true); F.goodsAdd('stick', 3, true); F.goodsAdd('iron_ore', 3, true); S.openCraft('forge', st); S.CRAFT.ui.sel = 'tool_pick'; S.renderCraft(); })();0""")
            for _ in range(1): await page.evaluate('__hm.frame(0.1);0')
            await page.screenshot(path=OUT + 'survival_craft.png', timeout=600000); print('saved craft', flush=True)

async def phone(p):
        if True:
            # the crafting book and the needs on a phone
            b, page, logs = await setup(p, touch=True, w=390, h=844)
            await page.evaluate(SLOW_RAF)
            await page.evaluate("__hm.start({ realm: 1, cls: 'mage', level: 14 }); __hm.UI.modal = null; 0")
            await page.evaluate(HELPERS)
            await page.evaluate("""(() => { const S = T.S, H = T.H; const t = H.REALMS[1].town; const st = S.CRAFT.stations.filter((s) => s.kind === 'loom').sort((a, b) => Math.hypot(a.x - t.x, a.z - t.z) - Math.hypot(b.x - t.x, b.z - t.z))[0]; T.stand(st.fx, st.fz, st.x, st.z); S.SURV.hunger = 0.7; S.SURV.thirst = 0.18; T.F.goodsAdd('fibre', 9, true); T.F.goodsAdd('linen', 2, true); H.fn.setQuality('low'); })();0""")
            for _ in range(1): await page.evaluate('__hm.frame(0.1);0')
            await page.screenshot(path=OUT + 'survival_phone_hud.png', timeout=600000); print('saved phone hud', flush=True)
            r = await ev(page, 'phonehud', """(() => { const H = T.H, P = T.P(); const foe = H.ENT.find((e) => e.alive && e.faction === H.FACTION_MONSTER); P.target = foe ? foe.id : null; H.UI.frame = 30; H.frame(0.05); const pf = document.getElementById('pf').getBoundingClientRect(), tf = document.getElementById('tf').getBoundingClientRect(), nd = document.getElementById('needs').getBoundingClientRect(); P.target = null; return { pfBottom: pf.bottom, tfTop: tf.top, needs: [nd.width, nd.height], inside: nd.bottom <= pf.bottom + 1 }; })()""")
            check(r['tfTop'] >= r['pfBottom'] - 1 and r['inside'] and r['needs'][0] > 120, f'on a phone the needs row fits in the player frame and the target frame sits below it {r}')
            r = await ev(page, 'phone', """(() => { const S = T.S; const pr = document.getElementById('prompt-t').textContent; document.getElementById('t-use').click(); const open = T.H.UI.modal === 'craft'; const card = document.getElementById('craft-card').getBoundingClientRect(), list = document.getElementById('craft-list').getBoundingClientRect(); const sheet = document.querySelector('#craft .sheet').getBoundingClientRect(); return { pr, open, fits: sheet.width <= 390 && list.width > 300, stacked: card.top >= list.bottom - 1 }; })()""")
            check(r['open'] and r['fits'] and r['stacked'], f'on a phone the Use button opens the loom\'s book, one column that fits ({r["pr"]})')
            await page.screenshot(path=OUT + 'survival_phone_craft.png', timeout=600000); print('saved phone craft', flush=True)
            errs = await page.evaluate("__hm.errors")
            check(not errs, f'no runtime errors on the phone {errs[:2]}')
            await b.close()
asyncio.run(main())
