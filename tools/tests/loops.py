"""[loops] The war runs on the land (version 19): each realm's stores, what the land gives them, what the war draws, and
what a player's own work is worth at levels 10, 30 and 50.
  measure  an hour of each kind of work against what it returns, at 10, 30 and 50: felling (a tree chopped and its log
           split, timed in the world), quarrying (a rock broken with a pick, timed), fishing, a paddock of sheep and
           cattle, hunting deer, farming a bed (grown and harvested in the world), and an hour of fighting (kills by
           the time to kill of the balance tables and the walk between pulls); each hour's goods sold to a merchant
           (version 18's only use for them) and given to the realm's stores (its pay at the target and at an empty
           store); printed as a table (`tools/out/loops_measure.json`)
  short    a realm short of each thing: a band musters thin and hungry (and its blows land softer), no engine without
           timber (a lesser one with less), a captain on foot without a horse, a keep's guard not replaced without food,
           a gate's and a breach's mending at a third of the pace without timber and stone, a house's too; and whole
           stores change nothing (version 18's war)
  caravan  a cart sent from Brackenford to a keep of Logres: on the roads with its horse, carter and escort, unloaded at
           the gate (the keep's stores filled), home again; a second one taken by a band of Thule (the cart lost, half
           its goods in Thule's stores); a keep taken with its stores
  deliver  the quartermaster's dialog by its buttons: goods given, realm points and gold paid (more for what the realm
           lacks), the stores and the campaign's renown up; a keep hall's stores; a horse of your own to the stables;
           the path's step
  workers  the woodcutters and the quarryman: out to a tree near the town, the tree felled (it falls as a felled tree
           does), timber into the stores; stone from a rock
  prices   no shop sells what a recipe makes for less than the making costs (its inputs at the merchant's price)
  draw     ten minutes of AI-only war: what each realm made and drew of each good, the time it was short, the carts sent,
           arrived and taken, the bands mustered thin, the engines built lesser or not at all
  save     the realms' and keeps' stores and a cart in flight saved and read back; an old save and a damaged part
  ui       the Chronicle's Stores page, the war panel's line, the field notes
  shots    a cart on the road with its escort (desk 960x540), the quartermaster's dialog, a woodcutter at work
usage: python3 tools/tests/loops.py [only=measure,short,...] [noshots] [q=low|medium|high]"""
import json, asyncio, sys, pathlib, time, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except Exception:
    Image = None

ARGS = sys.argv[1:]
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
NOSHOTS = 'noshots' in ARGS
QUALITY = next((a[2:] for a in ARGS if a.startswith('q=')), 'low')
FAILS = []
T0 = time.time()

def want(k): return (ONLY is None and k != 'shots') or (ONLY is not None and k in ONLY) or (k == 'shots' and ONLY is None and not NOSHOTS)
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js, arg=None): return await (page.evaluate(js, arg) if arg is not None else page.evaluate(js))

HELP = r"""(() => {
  const H = __hm, fn = H.fn, WAR = H.WAR, L = H.loops;
  window.__lt = {
    quiet() {
      const P = H.GAME.player, S = H.REALMS[P.faction].town;
      P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = fn.heightAt(P.x, P.z); P.hp = P.maxHp; P.alive = true;
    },
    calm() {
      for (const C of WAR.commanders) { C.nextThink = 1e9; C.nextSpawn = 1e9; }
      for (const e of H.ENT.slice()) if (e.role === 'soldier') fn.removeEnt(e);
      for (const w of WAR.warbands) w.dead = true;
      WAR.warbands.length = 0;
    },
    full() { for (let r = 0; r < 3; r++) for (const g of L.LOOPS_R) L.LOOPS.r[r][g] = L.LT.target[g]; for (let i = 0; i < WAR.keeps.length; i++) { const S = L.keep(i); for (const g of L.LOOPS_K) S[g] = L.LT.keepTarget[g]; } },
    // a standing grown tree near (x, z), not in a field
    tree(x, z, r) { let best = null, bd = 1e9; for (const t of fn.W.trees) { if (!L.natStanding(t) || t.fall || (t.grow ?? 1) < 0.95) continue; const d = Math.hypot(t.x - x, t.z - z); if (d < r && d < bd && fn.isWalkable(t.x + 1.4, t.z)) { bd = d; best = t; } } return best; },
    rock(x, z, r) { let best = null, bd = 1e9; fn.W.rocks.forEach((q, i) => { if (q.s < 0.6) return; const d = Math.hypot(q.x - x, q.z - z); if (d < r && d < bd) { bd = d; best = i; } }); return best; },
  };
})(); 0"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await ev(page, f"__hm.fn.setQuality('{QUALITY}'); 0")
        await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = null; return 0; })()")
        await ev(page, HELP)
        await ev(page, "__hm.simulate(1); 0")
        info = await ev(page, "(() => { const L = __hm.loops.LOOPS; return { inited: L.inited, workers: L.workers.length, r: L.r.map((S) => Math.round(S.food)), qm: __hm.REALMS.map((R) => !!R.quartermaster) }; })()")
        print('boot', round(time.time() - T0), 's', info, flush=True)
        check(info['inited'] and info['workers'] == 9 and all(info['qm']), f"the stores up, nine workers and three quartermasters ({info})")

        if want('prices'):
            print('PRICES', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, G = H.fn.GOODS, out = [];
              const buy = (id) => Math.max(1, Math.round((G[id] ? G[id].value : 1) * 2.5));
              const cost = (rec) => rec.need.reduce((a, [id, n]) => a + buy(id) * n, 0);
              // the merchant's provisions, the halls' stores and the farmers' and herders' lists (unit prices)
              const shops = [];
              for (const id of H.loops.PRICE_LISTS.prov) shops.push(['merchant', id, buy(id)]);
              for (const [id, n, p] of H.loops.PRICE_LISTS.hall) shops.push(['hall', id, p / n]);
              for (const [id, n, p] of H.loops.PRICE_LISTS.farm) shops.push(['farmer', id, p / n]);
              const recs = H.loops.RECIPES.filter((q) => q.make);
              for (const [shop, id, price] of shops) {
                const rr = recs.filter((q) => q.make[0] === id);
                if (!rr.length) continue;
                const q = rr.reduce((a, b) => (cost(a) / a.make[1] <= cost(b) / b.make[1] ? a : b)); // the cheapest way of making it
                const c = cost(q) / q.make[1]; out.push({ shop, id, price: +price.toFixed(2), make: +c.toFixed(2), recipe: q.id, ok: price >= c - 0.01 });
              }
              return out;
            })()""")
            for q in r: print(f"   {q['shop']:8s} {q['id']:14s} sells at {q['price']:6.2f}, making ({q['recipe']}) costs {q['make']:6.2f} {'ok' if q['ok'] else 'UNDER'}", flush=True)
            check(len(r) > 5 and all(q['ok'] for q in r), f"no shop sells a made good under its making cost ({sum(1 for q in r if not q['ok'])} of {len(r)} under)")

        if want('measure'):
            print('MEASURE', flush=True)
            # felling and quarrying timed in the world (the player's own jobs), then the hour worked out for each kind
            r = await ev(page, r"""(() => {
              const H = __hm, fn = H.fn, P = H.GAME.player, L = H.loops, out = {};
              const S = H.REALMS[0].town;
              fn.goodsAdd('tool_axe', 1, true); fn.goodsAdd('tool_pick', 1, true);
              // felling: three trees, each chopped then split (the axe in hand)
              const fell = [];
              for (let k = 0; k < 3; k++) {
                const t = __lt.tree(S.x + 60 * Math.cos(k * 2), S.z + 60 * Math.sin(k * 2), 90);
                if (!t) continue;
                P.x = P.prevX = t.x + 1.3; P.z = P.prevZ = t.z; P.y = fn.heightAt(P.x, P.z); P.target = null;
                const g0 = { ...H.INV.goods };
                L.natureStartJob(t);
                let s = 0; while (!t.felled && s < 40) { H.simulate(0.25); s += 0.25; }
                const tc = s;
                while (!(t.fall && t.fall.done) && s < 60) { H.simulate(0.25); s += 0.25; }
                // split: stand beside the log
                const ok = !!(t.fall && t.fall.done);
                if (ok) { const len = 2; P.x = P.prevX = t.x + t.fall.ux * len + t.fall.uz * 1.2; P.z = P.prevZ = t.z + t.fall.uz * len - t.fall.ux * 1.2; L.splitJob(t); }
                let s2 = 0; while (t.log && s2 < 30) { H.simulate(0.25); s2 += 0.25; }
                const got = {}; for (const id in H.INV.goods) { const d = (H.INV.goods[id] || 0) - (g0[id] || 0); if (d > 0) got[id] = d; }
                fell.push({ chop: tc, fall: s - tc, split: s2, got });
              }
              out.fell = fell;
              // quarrying: a rock broken with the pick (each rock gives three goes)
              const mine = [];
              for (let k = 0; k < 3; k++) {
                const i = __lt.rock(S.x + 80 * Math.cos(k * 2 + 1), S.z + 80 * Math.sin(k * 2 + 1), 160);
                if (i == null) continue;
                const R = fn.W.rocks[i];
                P.x = P.prevX = R.x + R.s * 0.8 + 0.8; P.z = P.prevZ = R.z; P.y = fn.heightAt(P.x, P.z);
                const g0 = { ...H.INV.goods };
                L.mineStart(i);
                let s = 0; while (H.surv.SURV.job && s < 20) { H.simulate(0.25); s += 0.25; }
                const got = {}; for (const id in H.INV.goods) { const d = (H.INV.goods[id] || 0) - (g0[id] || 0); if (d > 0) got[id] = d; }
                mine.push({ t: s, got });
              }
              out.mine = mine;
              return out;
            })()""")
            print('   felling', json.dumps(r['fell']), flush=True)
            print('   quarrying', json.dumps(r['mine']), flush=True)
            fells = [f for f in r['fell'] if f['got']]
            mines = [m for m in r['mine'] if m['got']]
            check(len(fells) >= 2 and len(mines) >= 2, f"felled {len(fells)} trees and broke {len(mines)} rocks in the world")
            # the hour of each kind of work, from these timings and the game's own rates
            avg = lambda xs: sum(xs) / max(1, len(xs))
            tree_s = avg([f['chop'] + f['fall'] + f['split'] for f in fells]) + 14  # the walk to the next tree (about 60 m apart in the woods by a town, at a run)
            tree_goods = {}
            for f in fells:
                for k, v in f['got'].items(): tree_goods[k] = tree_goods.get(k, 0) + v / len(fells)
            rock_s = avg([m['t'] for m in mines]) + 12
            rock_goods = {}
            for m in mines:
                for k, v in m['got'].items(): rock_goods[k] = rock_goods.get(k, 0) + v / len(mines)
            res = await ev(page, r"""((args) => {
              const H = __hm, L = H.loops, G = H.fn.GOODS, out = {};
              const sell = (id) => Math.max(1, Math.floor((G[id] ? G[id].value : 1) * 0.5));
              const per = (goods, k) => { const o = {}; for (const id in goods) o[id] = goods[id] * k; return o; };
              const hours = {
                felling: per(args.tree, 3600 / args.treeS),
                quarrying: per(args.rock, 3600 / args.rockS),
                fishing: { fish_raw: 3600 / 15.5 },                         // cast 0.7 s, wait 5-14 s, nibbles about 1.6 s, reel 0.9 s
                herding: { wool: 6 * 3 * 60 / 9.5, milk: 4 * 2 * 60 / 6.5 }, // six sheep sheared every 9.5 min, four cows milked every 6.5 (08h_animals.js)
                hunting: { meat_raw: 3600 / 55 * 3.5, hide: 3600 / 55 * 2, bone: 3600 / 55 * 1 }, // a deer found and brought down about every 55 s, a knife (09s_survival.js)
                farming: { grain: 6 * 24 * 1.7 },                           // six beds of grain worked through an hour (the bed measured below: about 1.7 a plant)
              };
              for (const lv of [10, 30, 50]) {
                const row = out[lv] = {};
                H.GAME.prog.level = lv;
                for (const k in hours) {
                  const g = hours[k];
                  let gold = 0, units = {}, rp0 = 0, gold0 = 0, rpE = 0, goldE = 0;
                  for (const id in g) { gold += sell(id) * g[id]; const w = L.LOOPS_WORTH[id]; if (w) units[w[0]] = (units[w[0]] || 0) + g[id] * w[1]; }
                  for (const s in units) {
                    const S = L.LOOPS.r[0], keep = S[s];
                    S[s] = L.LT.target[s]; const a = L.loopsPay(0, s, units[s]); rp0 += a.rp; gold0 += a.gold;
                    S[s] = 0; const e = L.loopsPay(0, s, units[s]); rpE += e.rp; goldE += e.gold;
                    S[s] = keep;
                  }
                  row[k] = { sold: Math.round(gold), units: Object.fromEntries(Object.entries(units).map(([a, b]) => [a, Math.round(b)])), rp: Math.round(rp0), gold: Math.round(gold0), rpShort: Math.round(rpE), goldShort: Math.round(goldE) };
                }
                // an hour of fighting: monsters of your level (20 x level experience, about 1.15 x level gold and a trophy one
                // in three), the time to kill of the balance tables (the skilled bots' median, about 7, 4 and 3 s at 10, 30
                // and 50) and 25 s between pulls (the walk, a breath); the war: a soldier of the enemy realms every 50 s
                const ttk = lv === 10 ? 7 : lv === 30 ? 4 : 3, kph = 3600 / (ttk + 25);
                const junk = 0.45 * (1.5 + 0.9 * lv);
                row.fighting = { kills: Math.round(kph), xp: Math.round(kph * 20 * lv), sold: Math.round(kph * (1.15 * lv + junk)), levels: +(kph * 20 * lv / (55 * Math.pow(lv, 1.55) + 40)).toFixed(2) };
                row.war = { kills: 72, rp: Math.round(72 * (10 + 2 * lv)), xp: Math.round(72 * 14 * lv), sold: Math.round(72 * 0.85 * lv) };
              }
              H.GAME.prog.level = 20;
              return out;
            })""", {'tree': tree_goods, 'treeS': tree_s, 'rock': rock_goods, 'rockS': rock_s})
            print(f"   a tree every {tree_s:.0f} s ({json.dumps({k: round(v, 1) for k, v in tree_goods.items()})}); a rock's go every {rock_s:.0f} s ({json.dumps({k: round(v, 2) for k, v in rock_goods.items()})})", flush=True)
            for lv in ['10', '30', '50']:
                row = res[lv]
                print(f"   level {lv}: fighting {row['fighting']['kills']} kills, {row['fighting']['xp']} xp ({row['fighting']['levels']} levels), {row['fighting']['sold']} gold; the war {row['war']['kills']} soldiers, {row['war']['rp']} rp, {row['war']['sold']} gold", flush=True)
                for k in ['felling', 'quarrying', 'fishing', 'herding', 'hunting', 'farming']:
                    q = row[k]
                    print(f"     {k:9s} sold {q['sold']:6d} gold | to the realm {json.dumps(q['units'])}: {q['rp']} rp + {q['gold']} gold at the target, {q['rpShort']} rp + {q['goldShort']} gold short", flush=True)
            pathlib.Path(OUT + 'loops_measure.json').write_text(json.dumps({'tree_s': tree_s, 'tree': tree_goods, 'rock_s': rock_s, 'rock': rock_goods, 'rows': res}, indent=1))
            r50 = res['50']
            for lv in ['10', '30', '50']:
                q = res[lv]['felling']
                check(q['gold'] + q['rp'] > 1.5 * q['sold'] and q['goldShort'] + q['rpShort'] > 3.5 * q['sold'], f"at {lv} an hour's felling given to the realm is worth more than sold to a merchant ({q['gold']} gold + {q['rp']} rp, short {q['goldShort']} + {q['rpShort']}, against {q['sold']} gold)")
            check(r50['felling']['rpShort'] > r50['war']['rp'] * 0.25, f"at 50 an hour's felling for a realm short of timber pays a good share of an hour of war's realm points ({r50['felling']['rpShort']} against {r50['war']['rp']})")

        if want('short'):
            print('SHORT', flush=True)
            await ev(page, "(() => { __lt.calm(); __lt.full(); __lt.quiet(); return 0; })()")
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn, WAR = H.WAR, out = {};
              // a band at the muster with the granaries full, then empty
              out.full = L.loopsMuster(1, 10);
              LO.r[1].food = 0;
              out.empty = L.loopsMuster(1, 10);
              const wb = { realm: 1 };
              LO.r[1].food = L.LT.target.food;
              // its soldiers hungry: a hungry blow against a fed one
              const a = fn.spawnRealmUnit(1, 'warrior', 30, 'soldier', 0, 0), d = fn.spawnRealmUnit(2, 'warrior', 30, 'soldier', 3, 0);
              out.hungryK = L.loopsHarmMult({ lHungry: H.GAME.t + 50 }, d);
              a.lHungry = H.GAME.t + 50; out.harmHungry = L.loopsHarmMult(a, d); a.lHungry = 0; out.harmFed = L.loopsHarmMult(a, d);
              fn.removeEnt(a); fn.removeEnt(d);
              // engines: the kind the timber raises
              out.treb = L.loopsEngineKind(2, 'trebuchet');
              LO.r[2].timber = 15; out.trebLow = L.loopsEngineKind(2, 'trebuchet');
              LO.r[2].timber = 2; out.none = L.loopsEngineKind(2, 'mangonel');
              LO.r[2].timber = L.LT.target.timber;
              // a captain's horse
              LO.r[0].horses = 1; const c1 = { faction: 0 }, c2 = { faction: 0 };
              out.horse1 = L.loopsHorseOk(c1); out.horse2 = L.loopsHorseOk(c2); LO.r[0].horses = 5;
              // a keep's guard with and without bread
              const K = WAR.keeps[0], S = L.keep(0);
              out.guardFed = L.loopsTrickleOk(K); S.food = 0; out.guardNone = L.loopsTrickleOk(K); S.food = 40;
              // a gate's and a breach's mending with and without the goods
              out.gate = L.loopsWork(K, 'gate', 1, 60); S.timber = 0; S.iron = 0; out.gateNone = L.loopsWork(K, 'gate', 1, 60); out.breachNone = L.loopsWork(K, 'breach', 1, 150);
              S.timber = 40; S.stone = 40; S.iron = 10; out.breach = L.loopsWork(K, 'breach', 1, 150);
              // a house in town
              const Hh = L.houses().find((q) => !q.keepHall);
              out.house = Hh ? L.loopsHouseWork(Hh, 1) : null; LO.r[0].timber = 0; LO.r[0].stone = 0; out.houseNone = Hh ? L.loopsHouseWork(Hh, 1) : null; LO.r[0].timber = 100; LO.r[0].stone = 100;
              // version 18's war: nothing drawn, nothing short
              LO.on = false; LO.r[1].food = 0; out.off = [L.loopsMuster(1, 10), L.loopsEngineKind(1, 'trebuchet'), L.loopsWork(K, 'gate', 1, 60), L.loopsHarmMult({ lHungry: H.GAME.t + 9 }, null)]; LO.on = true; LO.r[1].food = 200;
              return out;
            })()""")
            print('  ', json.dumps(r), flush=True)
            check(r['full'] == 10 and 4 <= r['empty'] <= 6, f"a band of 10 musters whole with food, {r['empty']} strong without")
            check(abs(r['harmHungry'] - 0.88) < 1e-6 and r['harmFed'] == 1, f"a hungry soldier's blows land at {r['harmHungry']} (fed: {r['harmFed']})")
            check(r['treb'] == 'trebuchet' and r['trebLow'] in ('mangonel', 'ram') and r['none'] is None, f"engines by the timber: {r['treb']}, {r['trebLow']} with 15, none with 2")
            check(r['horse1'] and not r['horse2'], "one horse in the stables: the first captain rides, the second walks")
            check(r['guardFed'] and not r['guardNone'], "a keep's guard comes with bread in its stores, none without")
            check(r['gate'] == 1 and abs(r['gateNone'] - 0.3) < 0.01 and abs(r['breachNone'] - 0.3) < 0.31 and r['breach'] == 1, f"mending at full pace with the goods, {r['gateNone']:.2f} without")
            check(r['house'] == 1 and r['houseNone'] is not None and r['houseNone'] < 0.5, f"a house built back at full pace with timber and stone, {r['houseNone']} without")
            check(r['off'] == [10, 'trebuchet', 1, 1], f"LOOPS.on false: version 18's war ({r['off']})")

        if want('caravan'):
            print('CARAVAN', flush=True)
            await ev(page, "(() => { __lt.calm(); __lt.full(); __lt.quiet(); __hm.war3.W3.pact = null; for (const K of __hm.WAR.keeps) if (K.realm !== K.orig) __hm.fn.captureKeep(K, K.orig, null); return 0; })()")
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, K = H.WAR.keeps[0], S = L.keep(0);
              S.food = 5; S.timber = 4; S.stone = 6; S.iron = 1;
              const c = L.loopsCarSend(0, K);
              window.__lc = c;
              return { ok: !!c, load: c ? c.load : null, route: c ? c.route.length : 0, ents: c ? [c.horse, c.carter, ...c.esc].map((id) => { const e = H.fn.getEnt(id); return e ? e.role : null; }) : [] };
            })()""")
            print('  sent', json.dumps(r), flush=True)
            check(r['ok'] and r['route'] >= 5 and r['ents'] == ['carthorse', 'carter', 'escort', 'escort'], f"a cart sent with its horse, carter and escort along {r['route']} road points")
            t = 0; st = None
            while t < 240:
                st = await ev(page, r"""(() => { __hm.simulate(5); const c = __lc, h = __hm.fn.getEnt(c.horse), K = __hm.WAR.keeps[0]; return { state: c.state, back: c.back, i: c.i, n: c.route.length, d: h ? Math.round(Math.hypot(h.x - K.nav.gate.x, h.z - K.nav.gate.z)) : -1, cart: c.ax != null ? Math.round(Math.hypot(c.ax - h.x, c.az - h.z) * 10) / 10 : null, food: Math.round(__hm.loops.keep(0).food) }; })()""")
                t += 5
                if st['back'] or st['state'] != 'road': break
            print(f"   after {t} s: {st}", flush=True)
            check(st['back'] and st['food'] > 20, f"the cart reached {('the gate' if st['back'] else 'nowhere')} in {t} s and unloaded (the keep's food {st['food']})")
            check(st['cart'] is not None and 2.4 < st['cart'] < 3.4, f"the cart behind its horse at the shafts' length ({st['cart']} m)")
            # a second cart, taken by a band of Thule
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn, K = H.WAR.keeps[1], S = L.keep(1);
              S.food = 3; S.timber = 3;
              const c = L.loopsCarSend(0, K, true); window.__lc2 = c;
              const thule0 = { ...LO.r[2] }, load = { ...c.load };
              H.simulate(20);
              // a band of Thule falls on it
              const h = fn.getEnt(c.horse), carter = fn.getEnt(c.carter);
              const foe = fn.spawnRealmUnit(2, 'warrior', 30, 'soldier', h.x + 4, h.z + 2);
              fn.dealDamage(foe, carter, carter.hp * 2, {});
              H.simulate(1);
              const took = {}; for (const g in thule0) took[g] = Math.round(LO.r[2][g] - thule0[g]);
              fn.removeEnt(foe);
              return { state: c.state, load, took, raided: LO.stats.raided, by: LO.stats.raidedBy };
            })()""")
            print('  raided', json.dumps(r), flush=True)
            check(r['state'] == 'wreck' and r['by'][2] >= 1 and all(r['load'][g] * 0.5 - 1 <= r['took'].get(g, 0) <= r['load'][g] * 0.5 + 4 for g in r['load']), f"a cart taken by Thule: wrecked, half its goods to Thule ({r['took']} of {r['load']})")
            # a keep taken with its stores
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, K = H.WAR.keeps[0], S = L.keep(0); S.food = 77;
              H.fn.captureKeep(K, 1, null); const s = { realm: K.realm, food: Math.round(L.keep(0).food) };
              H.fn.captureKeep(K, 0, null); return s;
            })()""")
            check(r['realm'] == 1 and 70 <= r['food'] <= 77, f"a keep taken with its stores ({r})")

        if want('deliver'):
            print('DELIVER', flush=True)
            await ev(page, "(() => { __lt.calm(); __lt.quiet(); return 0; })()")
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn, P = H.GAME.player, R = H.REALMS[0], Q = R.quartermaster;
              P.x = P.prevX = Q.x + 1.5; P.z = P.prevZ = Q.z; P.y = fn.heightAt(P.x, P.z);
              fn.goodsAdd('log', 20, true); fn.goodsAdd('firewood', 12, true); fn.goodsAdd('stone', 15, true);
              LO.r[0].timber = 5; LO.r[0].stone = L.LT.target.stone;
              const it = H.fn.playerInteract ? null : null;
              const lab = (() => { const o = []; return o; })();
              const rp0 = H.GAME.prog.rp, g0 = H.INV.gold, t0 = LO.r[0].timber, ren0 = H.CW ? null : null;
              return { rp0, g0, t0, qd: Math.round(Math.hypot(P.x - Q.x, P.z - Q.z) * 10) / 10 };
            })()""")
            # by its own prompt and the dialog's buttons
            await ev(page, "__hm.fn.playerInteract(); 0")
            dlg = await ev(page, "(() => ({ title: document.getElementById('dlg-title').textContent, btns: [...document.querySelectorAll('#dlg-actions button')].map((b) => b.textContent) }))()")
            print('  ', dlg, flush=True)
            check('stores' in dlg['title'] and any('timber' in t for t in dlg['btns']) and any('stone' in t for t in dlg['btns']), f"the quartermaster's dialog offers timber and stone ({dlg['title']})")
            await ev(page, "(() => { const b = document.querySelector('#dlg-actions button[data-lgive=\"timber\"]'); b.click(); return 0; })()")
            await ev(page, "(() => { const b = document.querySelector('#dlg-actions button[data-lgive=\"stone\"]'); b.click(); return 0; })()")
            r2 = await ev(page, r"""(() => { const H = __hm, LO = H.loops.LOOPS; return { rp: H.GAME.prog.rp, gold: H.INV.gold, timber: Math.round(LO.r[0].timber), logs: H.fn.goodsCount('log'), you: LO.you }; })()""")
            print('  ', r2, flush=True)
            got_rp = r2['rp'] - r['rp0']; got_g = r2['gold'] - r['g0']
            check(r2['logs'] == 0 and r2['timber'] >= r['t0'] + 22 and got_rp > 0 and got_g > 0, f"23 timber and 15 stone given: the stores up {r2['timber'] - r['t0']}, {got_rp} realm points and {got_g} gold")
            # the same timber to a full store pays less
            r3 = await ev(page, r"""(() => { const L = __hm.loops; L.LOOPS.r[0].timber = 5; const a = L.loopsPay(0, 'timber', 20); L.LOOPS.r[0].timber = 400; const b = L.loopsPay(0, 'timber', 20); return { short: a, full: b }; })()""")
            check(r3['short']['rp'] > 2 * r3['full']['rp'], f"timber pays more where it is short ({r3['short']['rp']} rp against {r3['full']['rp']})")
            # a horse of your own to the stables
            r4 = await ev(page, r"""(() => {
              const H = __hm, A = H.animals, P = H.GAME.player, L = H.loops;
              const rec = A.anRecord ? A.anRecord('horse', { owner: 'player' }) : null;
              if (!rec) return { skip: true };
              const e = A.anSpawn(rec, P.x + 3, P.z + 1);
              const h0 = L.LOOPS.r[0].horses, ok = L.loopsGiveHorse(e);
              return { ok, horses: L.LOOPS.r[0].horses - h0, gone: !!e.removed };
            })()""")
            print('   horse', r4, flush=True)
            check(r4.get('skip') or (r4['ok'] and r4['horses'] == 1 and r4['gone']), f"a horse of your own given to the stables ({r4})")
            r5 = await ev(page, "(() => { __hm.UI.modal = null; __hm.LORE.check(); return { deliver: __hm.LORE.progress().done.includes('deliver') }; })()")
            check(r5['deliver'], f"the path's step to supply the realm is taken ({r5})")
            await ev(page, "__hm.fn.closeDialog ? __hm.fn.closeDialog() : 0; __hm.UI.modal = null; 0")

        if want('yard'):
            print('YARD', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, P = H.GAME.player;
              const Ys = LO.yards.map((Y) => ({ r: Y.r, x: Math.round(Y.x), z: Math.round(Y.z), key: Y.key, mesh: !!Y.mesh }));
              const Y = LO.yards.find((q) => q.r === 1);
              LO.r[1].timber = L.LT.target.timber; LO.r[1].food = L.LT.target.food;
              H.frame(1 / 30); const k1 = Y.key;
              LO.r[1].timber = 5; H.frame(1 / 30); const k2 = Y.key;
              LO.r[1].timber = L.LT.target.timber;
              // a raid: Logres's player with a brand at Ériu's yard
              P.x = P.prevX = Y.x + 3.2; P.z = P.prevZ = Y.z; P.y = H.fn.heightAt(P.x, P.z); P.brand = { t: 99, until: H.GAME.t + 99 };
              const t0 = LO.r[1].timber; L.loopsYardIgnite(Y, P); const t1 = LO.r[1].timber;
              H.simulate(5); P.brand = null;
              return { Ys, k1, k2, lost: Math.round(t0 - t1), t0: Math.round(t0), burn: Y.burn > 0, char: +Y.char.toFixed(2) };
            })()""")
            print('  ', json.dumps(r), flush=True)
            check(len(r['Ys']) == 3 and all(y['mesh'] for y in r['Ys']), f"a stores yard in every town ({r['Ys']})")
            check(r['k1'] != r['k2'] and r['k2'][0] == '0', f"the yard shows the timber it holds (full {r['k1']}, near empty {r['k2']})")
            check(r['burn'] and abs(r['lost'] - 0.35 * r['t0']) < 2 and r['char'] > 0, f"an enemy's yard set alight: {r['lost']} of {r['t0']} timber gone, burning and charring")
            # heavy packs: on foot slower past 60, a horse of your own at your heels carries them
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, P = H.GAME.player, fn = H.fn;
              __lt.quiet(); P.mount = null; L.LADEN.t = -1;
              const k0 = L.loopsLadenK(P); fn.goodsAdd('log', 150, true); L.LADEN.t = -1; const k1 = L.loopsLadenK(P);
              const A = H.animals, rec = A.anRecord('horse', { owner: 'player' }); rec.cmd = 'follow'; const e = A.anSpawn(rec, P.x + 3, P.z + 1);
              L.LADEN.t = -1; const k2 = L.loopsLadenK(P);
              fn.goodsTake('log', 150); fn.removeEnt(e); rec.owner = 'gone'; L.LADEN.t = -1;
              return { k0, k1: +k1.toFixed(2), k2 };
            })()""")
            check(r['k0'] == 1 and r['k1'] < 0.9 and r['k2'] == 1, f"150 logs on foot slow you ({r['k1']}), your horse at your heels carries them ({r['k2']})")

        if want('workers'):
            print('WORKERS', flush=True)
            await ev(page, "(() => { __lt.calm(); __lt.quiet(); __hm.setTod(0.95); return 0; })()")
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn;
              const ws = LO.workers.map((id) => fn.getEnt(id)).filter((e) => e && e.ai.lj && e.ai.lj.realm === 0);
              for (const e of ws) e.ai.lj.next = 0;
              return ws.map((e) => ({ id: e.id, job: e.ai.lj.job }));
            })()""")
            felled0 = await ev(page, "__hm.loops.LOOPS.stats.felled")
            q0 = await ev(page, "__hm.loops.LOOPS.stats.quarried")
            t = 0
            while t < 240:
                s = await ev(page, "(() => { __hm.simulate(6); const S = __hm.loops.LOOPS.stats; return { felled: S.felled, quarried: S.quarried }; })()")
                t += 6
                if s['felled'] > felled0 and s['quarried'] > q0: break
            print(f"   after {t} s: {s}", flush=True)
            check(s['felled'] > felled0, f"a woodcutter of Brackenford felled a tree in {t} s")
            check(s['quarried'] > q0, f"the quarryman broke stone from a rock in {t} s")

        if want('draw'):
            print('DRAW (ten minutes of war)', flush=True)
            await ev(page, r"""(() => { const H = __hm, L = H.loops.LOOPS; for (const C of H.WAR.commanders) { C.nextThink = H.GAME.t + 1; C.nextSpawn = H.GAME.t + 2; }
              L.stats.drawn = [{}, {}, {}]; L.stats.made = [{}, {}, {}]; L.stats.shortT = [{}, {}, {}]; __lt.quiet(); return 0; })()""")
            for k in range(10):
                d = await ev(page, "(() => { __hm.simulate(60); const P = __hm.GAME.player; P.hp = P.maxHp; return Math.round(__hm.GAME.t); })()")
            r = await ev(page, r"""(() => { const L = __hm.loops.LOOPS, R = (o) => Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Math.round(v)])); return { made: L.stats.made.map(R), drawn: L.stats.drawn.map(R), short: L.stats.shortT.map(R), r: L.r.map(R), k: L.k.map(R), s: { thin: L.stats.thin, hungry: L.stats.hungry, noEngine: L.stats.noEngine, downgraded: L.stats.downgraded, footCaptains: L.stats.footCaptains, slowWork: Math.round(L.stats.slowWork), noGuard: L.stats.noGuard, caravans: L.stats.caravans, arrived: L.stats.arrived, raided: L.stats.raided, felled: L.stats.felled, quarried: L.stats.quarried }, errors: __hm.errors.length }; })()""")
            for i in range(3):
                print(f"   realm {i}: made {r['made'][i]}\n            drawn {r['drawn'][i]}\n            short (s) {r['short'][i]}\n            now {r['r'][i]}", flush=True)
            print('   keeps', r['k'], flush=True)
            print('   ', r['s'], flush=True)
            check(r['errors'] == 0, 'no runtime errors in ten minutes of war')
            check(r['s']['caravans'] >= 2, f"carts sent in ten minutes ({r['s']['caravans']}, {r['s']['arrived']} arrived, {r['s']['raided']} taken)")

        if want('save'):
            print('SAVE', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn;
              LO.r[1].iron = 33; L.keep(2).stone = 21;
              const d = fn.savePartsData('world');
              const data = JSON.parse(JSON.stringify(d.loops));
              LO.r[1].iron = 0; L.keep(2).stone = 0;
              fn.savePartsLoad('world', { loops: data });
              const a = { iron: LO.r[1].iron, stone: L.keep(2).stone, size: JSON.stringify(data).length };
              // an old save (no part): nothing changes; a damaged one: sane numbers
              fn.savePartsLoad('world', {});
              const b = { iron: LO.r[1].iron };
              fn.savePartsLoad('world', { loops: { v: 1, r: [['x', null, -5, 1e12], 7, null], k: 'no', c: [[9, 1], 'z'] } });
              const c = { food: LO.r[0].food, timber: LO.r[0].timber, stone: LO.r[0].stone, iron: LO.r[0].iron, ok: LO.r.every((S) => Object.values(S).every((v) => Number.isFinite(v) && v >= 0)) };
              return { a, b, c };
            })()""")
            print('  ', r, flush=True)
            check(r['a']['iron'] == 33 and r['a']['stone'] == 21, f"the stores read back ({r['a']['size']} bytes)")
            check(r['b']['iron'] == 33 and r['c']['ok'], f"an old save changes nothing, a damaged part loads sane ({r['c']})")

        if want('ui'):
            print('UI', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, L = H.loops, LO = L.LOOPS;
              LO.r[0].food = 3;
              const line = L.loopsHudLine();
              H.LORE.openChronicle('stores');
              const body = document.getElementById('menu-body');
              const t = body ? body.textContent : '';
              const out = { line, page: t.includes('quartermaster') && t.includes('Carts on the roads'), h: body ? body.scrollHeight : 0 };
              LO.r[0].food = 200;
              H.UI.modal = null; document.getElementById('menu').hidden = true;
              return out;
            })()""")
            print('  ', {k: (v[:120] if isinstance(v, str) else v) for k, v in r.items()}, flush=True)
            check('short of food' in r['line'] and r['page'], 'the war panel says a realm is short of food, and the Chronicle has its Stores page')

        if want('shots'):
            print('SHOTS', flush=True)
            await b.close()
            b, page, logs = await setup(p, w=960, h=540)
            await ev(page, "__hm.fn.setQuality('medium'); 0")
            await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = null; return 0; })()")
            await ev(page, HELP)
            await ev(page, "(() => { __lt.calm(); __lt.full(); const K = __hm.WAR.keeps[0], S = __hm.loops.keep(0); S.timber = 2; S.food = 8; S.stone = 2; window.__lc = __hm.loops.loopsCarSend(0, K, true); __hm.setTod(0.95); __hm.simulate(40); return 0; })()")
            for name, js in [('loops_cart', r"""(() => { const c = __lc, h = __hm.fn.getEnt(c.horse), P = __hm.GAME.player; P.x = P.prevX = h.x + 30; P.z = P.prevZ = h.z + 30; __hm.UI.modal = 'menu'; __hm.CAM.mode = 'fixed'; const yaw = c.yaw + 2.1; const cam = __hm.camera; cam.position.set(c.ax + Math.sin(yaw) * 9, __hm.fn.heightAt(c.ax, c.az) + 3.2, c.az + Math.cos(yaw) * 9); cam.lookAt(c.ax + (h.x - c.ax) * 0.4, __hm.fn.heightAt(c.ax, c.az) + 1.0, c.az + (h.z - c.az) * 0.4); return 0; })()""")]:
                await ev(page, js)
                await ev(page, "(() => { for (let i = 0; i < 6; i++) __hm.frame(1/30); return 0; })()")
                await page.screenshot(path=OUT + name + '.png', timeout=300000)
                print('  shot', name, flush=True)

        errs = await ev(page, "__hm.errors.length")
        errlist = await ev(page, "__hm.errors.slice(0, 5).map((e) => String(e.msg || e).slice(0, 200))")
        check(errs == 0, f'no runtime errors ({errlist})')
        for l in logs[:5]: print('  ', l)
        await b.close()
    print(f"\n{len(FAILS)} failed in {round(time.time() - T0)} s", flush=True)
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
