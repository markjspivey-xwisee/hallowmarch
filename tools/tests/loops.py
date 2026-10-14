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

def want(k): return (ONLY is None and k not in ('shots', 'phone', 'seasonshots')) or (ONLY is not None and k in ONLY) or (k in ('shots', 'phone') and ONLY is None and not NOSHOTS)
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
                    const list = Object.keys(g).filter((id) => L.LOOPS_WORTH[id] && L.LOOPS_WORTH[id][0] === s).map((id) => [id, g[id], 0]), fl = L.loopsSellOf(list);
                    S[s] = L.LT.target[s]; const a = L.loopsPay(0, s, units[s], fl); rp0 += a.rp; gold0 += a.gold;
                    S[s] = 0; const e = L.loopsPay(0, s, units[s], fl); rpE += e.rp; goldE += e.gold;
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
                check(q['gold'] >= q['sold'] and q['gold'] + q['rp'] > 1.4 * q['sold'] and q['goldShort'] + q['rpShort'] > 2 * q['sold'], f"at {lv} an hour's felling given to the realm is worth more than sold to a merchant ({q['gold']} gold + {q['rp']} rp, short {q['goldShort']} + {q['rpShort']}, against {q['sold']} gold)")
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
              const load = { ...c.load };
              H.simulate(20);
              // a band of Thule falls on it (Thule's stores looked at just before: the town's own work goes on meanwhile)
              const thule0 = { ...LO.r[2] };
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
            check(r['a']['iron'] >= 33 and r['a']['stone'] == 21, f"the stores read back ({r['a']['size']} bytes)")
            check(r['b']['iron'] == r['a']['iron'] and r['c']['ok'], f"an old save changes nothing, a damaged part loads sane ({r['c']})")

        if want('season'):
            print('SEASON', flush=True)
            # headless first: whole seasons stepped through 08m_realm.js alone in Node
            import subprocess
            nd = subprocess.run(['node', str(pathlib.Path(__file__).resolve().parent / 'loops_season.js'), 'seeds=6'], capture_output=True, text=True, timeout=1500)
            print(nd.stdout, flush=True)
            check(nd.returncode == 0, 'the season headless in Node (loops_season.js) passes')
            await ev(page, "__lt.quiet(); __lt.calm(); __hm.simulate(2); 0")
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), P = H.GAME.player;
              const sum = S.summary(0);
              const hud = H.loops.loopsHudLine();
              return { has: !!RS, phase: RS.phase, n: RS.n, keeps: RS.keeps.map((K) => K.h), live: RS.live, hud: hud.includes('season-hud') && /Season 1/.test(hud), clock: sum.clock, days: sum.days, json: JSON.stringify(RS).length };
            })()""")
            print('  ', r, flush=True)
            check(r['has'] and r['phase'] == 'muster' and r['live'] and r['keeps'] == [0, 0, 1, 1, 2, 2] and r['days'] == 42, f"a new game begins a season of 42 days in its muster, every keep its own ({r['clock']})")
            check(r['hud'], 'the war panel tells the season, its clock and the standing')
            # the muster's skirmishes: a keep taken in the live war is not taken in the season
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), K = H.WAR.keeps[2];
              H.fn.captureKeep(K, 0, null); H.simulate(1);
              const a = RS.keeps[2].h, live = K.realm;
              return { a, live };
            })()""")
            check(r['a'] == 1 and r['live'] == 0, f"in the muster a keep taken in the field stays its own in the season ({r})")
            # a delivery counts season points; a vote; gold given
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), L = H.loops, fn = H.fn;
              const sp0 = RS.realms[0].sp;
              fn.goodsAdd('stone', 60);
              const d = L.loopsDeliver('stone');
              const sp1 = RS.realms[0].sp;
              H.INV.gold = 1000;
              const g = S.seasonGiveGold(500), sp2 = RS.realms[0].sp, gold = H.INV.gold;
              const v = S.seasonVote('smithy'), votes = RS.realms[0].votes.smithy || 0, act = RS.realms[0].act;
              return { d: !!d, sp0, sp1, sp2, g, gold, v, votes, act };
            })()""")
            print('  ', r, flush=True)
            check(r['d'] and r['sp1'] > r['sp0'], f"a delivery to the quartermaster counts season points ({r['sp0']:.2f} to {r['sp1']:.2f})")
            check(r['g'] and r['gold'] == 500 and r['sp2'] > r['sp1'], 'gold given to the treasury counts too')
            check(r['v'] and (r['votes'] > 0 or r['act'] == 'smithy'), f"a voice for the next work is counted ({r['votes']}, at work {r['act']})")
            # the Chronicle's Season page and its buttons by a click
            r = await ev(page, r"""(async () => {
              const H = __hm; H.LORE.openChronicle('season');
              await new Promise((res) => setTimeout(res, 200));
              const body = document.getElementById('menu-body'), html = body.innerHTML;
              const btn = body.querySelector('[data-season^="gold:100"]');
              const g0 = H.INV.gold; if (btn) btn.click();
              await new Promise((res) => setTimeout(res, 100));
              const vb = body.querySelector('[data-season^="proj:"]');
              const ok = { page: /season of 42 days/.test(html) && html.includes('season-stand'), gold: g0 - H.INV.gold, vote: !!vb, wide: body.scrollWidth <= body.clientWidth + 2 };
              H.UI.modal = null; document.getElementById('menu').hidden = true;
              return ok;
            })()""")
            print('  ', r, flush=True)
            check(r['page'] and r['gold'] == 100 and r['vote'], f"the Chronicle's Season page, its gold given by a click, its votes ({r})")
            # the war: the season stepped on as if nobody had played eight days
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, sum = S.away(8 * 86400), RS = S.rs();
              H.simulate(1);
              const live = H.WAR.keeps.map((K) => K.realm), rs = RS.keeps.map((K) => K.h);
              return { phase: RS.phase, lines: sum.lines.length, first: sum.lines[1] || '', live, rs, ms: S.SEASONP.stats.offlineMs, food: H.loops.LOOPS.r[0].food, rsFood: RS.realms[0].s[0] };
            })()""")
            print('  ', r, flush=True)
            check(r['phase'] == 'war' and r['lines'] >= 2, f"eight days away: the war has begun, and you are told what happened ({r['lines'] - 1} lines, {r['ms']:.0f} ms)")
            check(r['live'] == r['rs'], f"the keeps in the field are as the season holds them ({r['live']})")
            check(abs(r['food'] - r['rsFood']) < 1, 'the stores are the season\'s')
            # in the war a keep taken in the field is taken in the season, and stays its taker's at the battle's end
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), fn = H.fn;
              const k = H.WAR.keeps.findIndex((K) => K.realm !== 0);
              const K = H.WAR.keeps[k], was = K.realm;
              fn.captureKeep(K, 0, null); H.simulate(1);
              const a = RS.keeps[k].h, stays = S.seasonKeepStays(K) || K.orig === 0;
              // the season's offensive in the field: its realm's bands go for the keep it named
              RS.offs.push({ r: 1, k: H.WAR.keeps.findIndex((Q) => Q.realm !== 1), at: RS.t, ann: RS.t - 86400, state: 'live', army: 0, res: '', liveUntil: RS.t + 3600 });
              const kk = RS.offs[RS.offs.length - 1].k, KK = H.WAR.keeps[kk];
              const C = [{ s: 10, o: { type: 'attack', keep: KK }, why: 'gate' }];
              S.seasonChoose({}, 1, C, { x: KK.site.x + 100, z: KK.site.z });
              const C2 = []; S.seasonChoose({}, KK.realm, C2, { x: 0, z: 0 });
              return { k, was, a, stays, s: C[0].s, why: C[0].why, brace: C2.length && C2[0].why };
            })()""")
            print('  ', r, flush=True)
            check(r['a'] == 0 and r['stays'], f"in the war a keep taken in the field is the taker's in the season ({r['k']}: {r['was']} to {r['a']})")
            check(r['why'] == 'offensive' and r['s'] >= 40 and r['brace'] == 'brace', "an offensive under way sends its realm's bands at the keep it named, and its holder's to brace it")
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), rel = H.WAR.relics[1];
              rel.state = 'temple'; rel.at = 0; rel.from = 0; rel.slot = 't0'; H.simulate(1.5);
              const a = RS.hallows[1];
              RS.hallows[1] = 1; S.apply();
              return { phase: RS.phase, a, back: rel.at, slot: rel.slot };
            })()""")
            check(r['a'] == 0 and r['back'] == 1 and r['slot'] == 'home', f"a hallow placed in a temple in the field is the season's, and the season's hallows are put where it holds them ({r})")
            r = await ev(page, r"""(() => { const H = __hm, S = H.season, RS = S.rs(), K = H.WAR.keeps[1], t0 = RS.keeps[1].tier;
              RS.keeps[1].tier = 2; const k2 = S.seasonGateK(K.door); RS.keeps[1].tier = t0; return { k2, k0: S.seasonGateK(K.door) }; })()""")
            check(abs(r['k2'] - 1 / 1.5) < 1e-6 and r['k0'] <= 1, f"walls raised two tiers in the season: the keep's gate and walls take a third less in the field ({r})")
            # saved, an absence of three days, loaded: stepped on and told; the title says it too
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, fn = H.fn;
              const d = JSON.parse(JSON.stringify(fn.savePartsData('world').realm));
              const t0 = d.rs.t; d.real -= 3 * 86400 * 1000;
              const title = S.seasonTitleText({ char: { realm: 0 }, world: { x: { realm: d } } });
              fn.savePartsLoad('world', Object.assign(fn.savePartsData('world'), { realm: d }));
              H.simulate(1);
              const RS = S.rs(), away = S.SEASONP.away;
              return { size: JSON.stringify(d).length, dt: RS.t - t0, told: !!away && away.el > 2.9 * 86400, title };
            })()""")
            print('  ', r, flush=True)
            check(r['dt'] > 2.9 * 86400 and r['told'], f"a save read back three days later runs the season on three days and tells it ({r['size']} bytes)")
            check('While you were away' in r['title'] and 'Season' in r['title'], f"the title tells the season and the time away ({r['title'][:140]})")
            # the reckoning passed while away: the season's winner told, and your realm's win paid and a deed of the veteran's
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = S.rs(), P = H.GAME.player;
              RS.realms[P.faction].sp += 1e5; // (your realm far ahead)
              const rp0 = H.GAME.prog.rp, sum = S.away(31 * 86400);
              return { phase: RS.phase, n: RS.n, last: S.SEASONP.you.last, won: S.SEASONP.you.won, rp: H.GAME.prog.rp - rp0, deed: H.late ? H.late.LATE2.d.season : null, name: H.late ? H.late.LATE2.names.includes('longwar') : null };
            })()""")
            print('  ', r, flush=True)
            check(r['last'] >= 1 and r['won'] >= 1 and r['rp'] >= 2500 and r['deed'] == 1 and r['name'], f"a season won while away: told, paid, a deed and the name of the Long War ({r})")
            r = await ev(page, r"""(() => { const H = __hm, fn = H.fn;
              fn.savePartsLoad('world', { realm: { rs: { v: 1, realms: 'x', keeps: [] }, real: 'q' } }); H.simulate(1);
              const a = H.season.rs(); const ok1 = !!a && a.phase === 'muster' && a.keeps.length === 6;
              fn.savePartsLoad('world', {}); H.simulate(1);
              const b = H.season.rs(); return { ok1, ok2: !!b && b.keeps.length === 6, errors: H.errors.slice(0, 3) }; })()""")
            check(r['ok1'] and r['ok2'] and not r['errors'], f"a damaged season loads as a fresh one, an old save (none) too ({r})")

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

        if want('phone'):
            print('PHONE (390x780, touch)', flush=True)
            await b.close()
            b, page, logs = await setup(p, touch=True, w=390, h=780)
            await ev(page, "(() => { __hm.start({ realm: 0, cls: 'priest', level: 14 }); __hm.UI.modal = null; return 0; })()")
            await ev(page, HELP)
            await ev(page, r"""(() => { const H = __hm, L = H.loops, LO = L.LOOPS, fn = H.fn, P = H.GAME.player, Q = H.REALMS[0].quartermaster; __lt.calm(); __lt.quiet();
              P.x = P.prevX = Q.x + 1.5; P.z = P.prevZ = Q.z; P.y = fn.heightAt(P.x, P.z);
              fn.goodsAdd('log', 20, true); fn.goodsAdd('stone', 12, true); fn.goodsAdd('bread', 9, true); fn.goodsAdd('wool', 6, true);
              LO.r[0].timber = 8; LO.r[0].iron = 2; H.simulate(0.5); return 0; })()""")
            # Use on the pad opens the quartermaster's stores (as touch_flows.py's stores flow taps it)
            await ev(page, "(() => { __hm.fn.playerInteract(); return 0; })()")
            await ev(page, "(() => { for (let i = 0; i < 3; i++) __hm.frame(1/30); return 0; })()")
            r = await ev(page, r"""(() => { const d = document.getElementById('dialog'), box = d ? d.getBoundingClientRect() : null, btns = [...document.querySelectorAll('#dlg-actions button')];
              const small = btns.filter((b) => { const q = b.getBoundingClientRect(); return q.height < 40 || q.width < 40; }).map((b) => b.textContent);
              const wide = [...document.querySelectorAll('#dialog *')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && (q.right > innerWidth + 1 || q.left < -1); }).length;
              return { title: document.getElementById('dlg-title').textContent, box: box && [Math.round(box.left), Math.round(box.top), Math.round(box.width), Math.round(box.height)], btns: btns.map((b) => b.textContent), small, wide, scroll: document.getElementById('dlg-body').scrollWidth > document.getElementById('dlg-body').clientWidth + 1 }; })()""")
            print('  ', r, flush=True)
            check('stores' in r['title'] and not r['small'] and not r['wide'] and not r['scroll'], f"the stores' dialog on an upright phone: every button 40 px, nothing past the screen's edge ({r['box']}, {len(r['btns'])} buttons)")
            if not NOSHOTS: await page.screenshot(path=OUT + 'loops_phone_stores.png', timeout=300000)
            await ev(page, "(() => { const b = document.querySelector('#dlg-actions button[data-lgive=\"timber\"]'); if (b) b.click(); __hm.fn.closeDialog && __hm.fn.closeDialog(); const d = document.getElementById('dialog'); if (d) d.hidden = true; __hm.UI.modal = null; return 0; })()")
            r = await ev(page, r"""(() => { const H = __hm; H.LORE.openChronicle('stores'); for (let i = 0; i < 3; i++) H.frame(1/30); const body = document.getElementById('menu-body');
              const wide = [...body.querySelectorAll('*')].filter((e) => { const q = e.getBoundingClientRect(); return q.width > 0 && q.right > innerWidth + 1; }).length;
              return { h: body.scrollHeight, sheet: body.clientHeight, wide, folds: body.querySelectorAll('details').length }; })()""")
            print('  ', r, flush=True)
            check(r['wide'] == 0, f"the Chronicle's Stores page fits an upright phone's width ({r['h']} px tall on a sheet of {r['sheet']}, {r['folds']} folds)")
            if not NOSHOTS: await page.screenshot(path=OUT + 'loops_phone_chron.png', timeout=300000)

        if want('shots'):
            print('SHOTS', flush=True)
            await b.close()
            b, page, logs = await setup(p, w=960, h=540)
            await ev(page, "__hm.fn.setQuality('medium'); 0")
            # the page's own frames held (each picture draws its own: a frame of the loop at medium over a new town took minutes)
            await ev(page, r"""(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
              window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); return 0; })()""")
            await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 20 }); __hm.UI.modal = null; return 0; })()")
            await ev(page, HELP)
            await ev(page, "(() => { __lt.calm(); __lt.full(); const K = __hm.WAR.keeps[0], S = __hm.loops.keep(0); S.timber = 2; S.food = 8; S.stone = 2; window.__lc = __hm.loops.loopsCarSend(0, K, true); __hm.setTod(0.95); __hm.dbg.WEATHER.mode = 'clear'; __hm.simulate(40); return 0; })()")
            async def shot(name, js):
                await ev(page, js)
                await ev(page, "(() => { const hud = document.getElementById('hud'); if (hud) hud.style.visibility = 'hidden'; for (let i = 0; i < 6; i++) __hm.frame(1/30); return 0; })()")
                await page.screenshot(path=OUT + name + '.png', timeout=300000)
                await ev(page, "(() => { const hud = document.getElementById('hud'); if (hud) hud.style.visibility = ''; return 0; })()")
                print('  shot', name, flush=True)
            # a cart on the road with its horse, carter and escort, from beside it
            await shot('loops_cart', r"""(() => { const c = __lc, h = __hm.fn.getEnt(c.horse), P = __hm.GAME.player; P.x = P.prevX = h.x + 40; P.z = P.prevZ = h.z + 40; __hm.UI.modal = 'menu'; __hm.CAM.mode = 'fixed';
              const mx = (c.ax + h.x) / 2, mz = (c.az + h.z) / 2, side = c.yaw + Math.PI / 2 + 0.55, cam = __hm.camera, gy = __hm.fn.heightAt(mx, mz);
              cam.position.set(mx + Math.sin(side) * 8.5, gy + 2.6, mz + Math.cos(side) * 8.5); cam.lookAt(mx, gy + 1.0, mz); return 0; })()""")
            # the stores yard behind Brackenford's quartermaster
            await shot('loops_yard', r"""(() => { const Y = __hm.loops.LOOPS.yards[0], Q = __hm.REALMS[0].quartermaster, cam = __hm.camera, gy = __hm.fn.heightAt(Y.x, Y.z), P = __hm.GAME.player; P.x = P.prevX = Q.x; P.z = P.prevZ = Q.z;
              const a = Math.atan2(Q.x - Y.x, Q.z - Y.z) + 0.35; cam.position.set(Y.x + Math.sin(a) * 10, gy + 3.2, Y.z + Math.cos(a) * 10); cam.lookAt(Y.x, gy + 0.9, Y.z); return 0; })()""")
            # a woodcutter at work
            ok = await ev(page, r"""(() => { const H = __hm, LO = H.loops.LOOPS; __hm.CAM.mode = 'play'; __hm.UI.modal = null; const P = H.GAME.player, T = H.REALMS[0].town; P.x = P.prevX = T.x + 3; P.z = P.prevZ = T.z + 3;
              const ws = LO.workers.map((id) => H.fn.getEnt(id)).filter((e) => e && e.ai.lj && e.ai.lj.realm === 0 && e.ai.lj.job === 'wood');
              for (const e of ws) e.ai.lj.next = 0;
              for (let k = 0; k < 120; k++) { H.simulate(1); const w = ws.find((e) => e.ai.plan && e.ai.plan.steps[e.ai.plan.i] && e.ai.plan.steps[e.ai.plan.i].k === 'lchop' && e.ai.plan.steps[e.ai.plan.i].n >= 1 && !e.ai.plan.steps[e.ai.plan.i].tree.felled); if (w) { window.__lw = w; return true; } }
              return false; })()""")
            if ok:
                await shot('loops_woodcutter', r"""(() => { const w = __lw, t = w.ai.plan.steps[w.ai.plan.i].tree, cam = __hm.camera, gy = __hm.fn.heightAt(w.x, w.z); __hm.UI.modal = 'menu'; __hm.CAM.mode = 'fixed';
                  const a = Math.atan2(w.x - t.x, w.z - t.z) + 1.2; cam.position.set(w.x + Math.sin(a) * 5, gy + 2.0, w.z + Math.cos(a) * 5); cam.lookAt((w.x + t.x) / 2, gy + 1.3, (w.z + t.z) / 2); return 0; })()""")
            check(ok, 'a woodcutter found at work for the picture')

        if want('seasonshots'):
            # [loops] the season as a player sees it: the Chronicle's Season page on a phone, the war panel's line on a desk
            print('SEASON SHOTS', flush=True)
            await b.close()
            for (w, h, touch, name) in ((390, 780, True, 'loops_season_phone'), (1280, 720, False, 'loops_season_desk')):
                b, page, logs = await setup(p, touch=touch, w=w, h=h)
                await page.emulate_media(reduced_motion='reduce') # (the Chronicle's sheet fades in by a CSS animation that a loaded headless page may not run)
                await ev(page, "__hm.fn.setQuality('low'); 0")
                await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 24 }); __hm.UI.modal = null; return 0; })()")
                await ev(page, HELP)
                await ev(page, "(() => { __lt.quiet(); __lt.calm(); __hm.simulate(2); __hm.season.away(9 * 86400); __hm.GAME.prog.rp = 60000; __hm.simulate(2); for (let i = 0; i < 4; i++) __hm.frame(1/30); return 0; })()")
                await page.wait_for_timeout(1500)
                await page.screenshot(path=OUT + name + '_hud.png', timeout=300000)
                vis = await ev(page, "(() => { const w = document.getElementById('war'); return !!w && w.offsetParent !== null && !w.classList.contains('hl-off'); })()")
                if vis:
                    bx = await ev(page, "(() => { const r = document.getElementById('war').getBoundingClientRect(); return { x: Math.max(0, r.x - 4), y: Math.max(0, r.y - 4), width: r.width + 8, height: r.height + 8 }; })()")
                    await page.screenshot(path=OUT + name + '_war.png', clip=bx, timeout=300000)
                await ev(page, "(() => { __hm.LORE.openChronicle('season'); return 0; })()")
                await page.wait_for_timeout(2500) # (the sheet fades in on the wall clock)
                await page.screenshot(path=OUT + name + '_page.png', timeout=300000)
                await ev(page, "(() => { const b = document.querySelector('#menu-body .season-proj'); if (b) b.scrollIntoView({ block: 'start', behavior: 'instant' }); return 0; })()")
                await page.wait_for_timeout(400)
                await page.screenshot(path=OUT + name + '_work.png', timeout=300000)
                wide = await ev(page, "(() => { const m = document.querySelector('#menu-body .chron-body'); return [m.scrollWidth, m.clientWidth]; })()")
                check(wide[0] <= wide[1] + 2, f'the Season page has no sideways overflow at {w}x{h} ({wide})')
                print('  shots', name, flush=True)
                if name.endswith('phone'): await b.close()

        errs = await ev(page, "__hm.errors.length")
        errlist = await ev(page, "__hm.errors.slice(0, 5).map((e) => String(e.msg || e).slice(0, 200))")
        check(errs == 0, f'no runtime errors ({errlist})')
        for l in logs[:5]: print('  ', l)
        await b.close()
    print(f"\n{len(FAILS)} failed in {round(time.time() - T0)} s", flush=True)
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
