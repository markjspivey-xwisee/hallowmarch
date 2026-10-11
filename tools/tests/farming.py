"""Farming, herb lore and plant breeding (08h_farming.js, 08i_farm_draw.js): the season cycle and its weather; tilling,
sowing, growth through every stage with simulated time and weather; harvest yields; frost damage; drought; weeds;
crossing two strains and the offspring's traits; seed saving raising yield over generations; the herbal; trampling and
fire; the town fields worked by the townsfolk; save and load (and old and damaged saves); screenshots.
usage: python3 tools/tests/farming.py [noshots | shotsonly] [phone] [final]  (final: 960 x 540 at medium quality)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
SHOTS = 'noshots' not in sys.argv
ONLYSHOTS = 'shotsonly' in sys.argv
FINAL = 'final' in sys.argv  # 960 x 540 at medium quality for the final pictures
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

# a bed on open meadow in Logres, away from the town fields: found by asking the game where tilling is allowed
FIND_BED = """(() => { const F = __hm.farm, R = __hm.REALMS[0];
  for (let a = 0; a < 64; a++) for (const d of [110, 130, 150, 95]) {
    const x = R.town.x + Math.cos(a * 0.4) * d, z = R.town.z + Math.sin(a * 0.4) * d;
    let ok = true;
    for (let u = -3; u <= 3 && ok; u += 1.5) for (let v = -6; v <= 6 && ok; v += 1.5) if (F.tillWhy(x + u, z + v)) ok = false;
    if (ok) return [x, z];
  }
  return null; })()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if FINAL else 640, h=540 if FINAL else 360)
        await page.evaluate("__hm.start({ realm: 0, cls: 'warrior', level: 12 })")
        await page.evaluate("__hm.dbg.WEATHER.mode = 'clear'; document.getElementById('hud').hidden = false;0")
        if ONLYSHOTS:
            await shots(page)
            errs = await page.evaluate("__hm.errors")
            check(not errs, f'no runtime errors after the shots {errs[:2]}')
            print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
            await b.close()
            return

        # ---- the seasons ----
        r = await page.evaluate("""(() => { const F = __hm.farm, out = {};
          out.names = [0.1, 0.35, 0.6, 0.85].map((k) => { F.setSeason(k); return F.seasonNow().name; });
          F.setSeason(0.875); out.coldWinter = F.seasonCold(); out.tWinter = F.seasonNow().temp;
          F.setSeason(0.375); out.coldSummer = F.seasonCold(); out.tSummer = F.seasonNow().temp;
          const base = [0.46, 0.24, 0.17, 0.07, 0.06];
          out.odds = [0.1, 0.35, 0.6, 0.85].map((k) => { F.setSeason(k); const o = F.seasonWeatherOdds(base); return [o.reduce((a, b) => a + b, 0), o[0], o[2], o[4]]; });
          // temperature: Thule colder than Logres, night colder than day
          F.setSeason(0.3); const R = __hm.REALMS;
          __hm.setTod(0.5); __hm.frame(); const day = F.farmTempAt(R[0].town.x, R[0].town.z), thule = F.farmTempAt(R[2].town.x, R[2].town.z);
          __hm.setTod(2.0); __hm.frame(); const night = F.farmTempAt(R[0].town.x, R[0].town.z);
          out.temps = [day, thule, night];
          // the clock runs with the game: a few seconds of play move it on
          F.setSeason(0.2499); __hm.simulate(30); out.turned = F.seasonNow().name;
          __hm.setTod(0.5); __hm.frame();
          return out; })()""")
        print('season', json.dumps(r))
        check(r['names'] == ['Spring', 'Summer', 'Autumn', 'Winter'], 'the year runs spring, summer, autumn, winter')
        check(r['coldWinter'] > 0.4 and r['coldSummer'] == 0 and r['tWinter'] < 2 and r['tSummer'] > 17, 'winter is cold enough to snow in the south, summer warm')
        check(all(abs(o[0] - 1) < 1e-6 for o in r['odds']) and r['odds'][1][1] > r['odds'][0][1] and r['odds'][0][2] > r['odds'][1][2] and r['odds'][2][3] > r['odds'][1][3], 'the weather odds follow the season (dry summer, wet spring, misty autumn)')
        check(r['temps'][1] < r['temps'][0] - 4 and r['temps'][2] < r['temps'][0] - 4, 'Thule and the night are colder')
        check(r['turned'] == 'Summer', 'the season turns as the game runs')

        # ---- tilling by the player, with a hoe and by hand ----
        bed = await page.evaluate(FIND_BED)
        check(bed is not None, 'open meadow found for a bed')
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, out = {{}};
          const R = H.REALMS[0];
          out.road = F.tillWhy(R.nav.h1.x, R.nav.h1.z); out.town = F.tillWhy(R.town.x + 5, R.town.z);
          const [x, z] = {json.dumps(bed)};
          out.meadow = F.tillWhy(x, z);
          // no hoe, no seed: no prompt to till
          H.teleport(x, z - 6); H.GAME.player.yaw = 0; H.simulate(0.2); H.frame();
          out.ctxNone = F.ctx();
          H.fn.goodsAdd('tool_hoe', 1, true); H.fn.goodsAdd('seed_grain', 40, true); H.fn.goodsAdd('seed_flax', 30, true); H.fn.goodsAdd('seed_turnip', 30, true);
          H.simulate(0.2); H.frame();
          out.ctx = F.ctx();
          out.started = F.act('till'); out.job = F.job();
          H.simulate(8); out.after = F.job();
          out.plots = F.FARM.plots.filter((P) => P.own === 'p').length;
          return out; }})()""")
        print('till', json.dumps(r))
        check(r['road'] and r['town'] and r['meadow'] is None, 'roads and the town cannot be tilled; meadow can')
        check(r['ctxNone'] is None, 'without a hoe or seed nothing nags you to till')
        check(r['ctx'] and r['ctx']['type'] == 'till' and r['ctx']['actions'][:1] == ['till'], 'with a hoe the plant card offers to till a bed')
        check(r['started'] and r['job']['kind'] == 'till' and r['after'] is None and r['plots'] == 1, 'tilling is a few swings of the hoe and leaves a bed')

        # ---- sowing and growing through every stage with simulated weather ----
        r = await page.evaluate("""(() => { const H = __hm, F = H.farm, W = H.dbg.WEATHER, out = {};
          const P = F.FARM.plots.find((Q) => Q.own === 'p');
          out.sown = F.sow(P.id, 'seed_grain'); out.left = H.fn.goodsCount('seed_grain');
          F.setSeason(0.3); H.setTod(0.5); H.frame();
          P.weeds = 0;
          const stages = new Set(), timeline = [];
          for (let i = 0; i < 600; i++) {
            // a day of rain now and then
            W.raining = (i % 40) < 6 ? 1 : 0; W.snowing = 0;
            F.step(5); P.weeds = 0;
            const g = F.plants(P.id).filter((q) => q).map((q) => q.g);
            const avg = g.reduce((a, b) => a + b, 0) / g.length;
            stages.add(['seed', 'sprout', 'leaf', 'heading', 'flower', 'ripening', 'ripe'][[0.06, 0.2, 0.5, 0.72, 0.84, 1, 9].findIndex((e) => avg < e)]);
            if (i % 50 === 0) timeline.push([i * 5, +avg.toFixed(2), +P.moist.toFixed(2)]);
            if (g.every((v) => v >= 1)) { out.ripeAt = i * 5; break; }
          }
          W.raining = 0;
          out.stages = [...stages]; out.timeline = timeline;
          out.ctx = (() => { H.teleport(P.x - P.bx * 0 - P.ax * (P.hd + 0.5), P.z - P.az * (P.hd + 0.5)); H.GAME.player.yaw = P.ang; H.simulate(0.1); H.frame(); return F.ctx(); })();
          out.bed = P.id;
          return out; })()""")
        print('grow', json.dumps(r))
        check(r['sown'] == 24 and r['left'] == 16, 'sowing a bed takes a seed for each of its 24 slots')
        check(r['stages'] == ['seed', 'sprout', 'leaf', 'heading', 'flower', 'ripening', 'ripe'], 'the crop grows through every stage: seed, sprout, leaf, heading, flower, ripening, ripe')
        check(r.get('ripeAt') and 600 < r['ripeAt'] < 2600, f"grain ripens in summer in a reasonable time ({r.get('ripeAt')} s)")
        check(r['ctx'] and r['ctx']['type'] == 'plot' and r['ctx']['actions'][0] == 'harvest' and 'saveseed' in r['ctx']['actions'], 'a ripe bed offers the harvest first, and keeping the seed of a plant')
        BED = r['bed']

        # ---- shots of the bed at each stage are taken at the end; harvest ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, out = {{}};
          const g0 = H.fn.goodsCount('grain'), s0 = H.fn.goodsCount('seed_grain'), t0 = H.fn.goodsCount('thatch');
          const P = F.plot({BED}); out.fert0 = P.fert;
          out.got = F.harvest({BED});
          out.grain = H.fn.goodsCount('grain') - g0; out.seed = H.fn.goodsCount('seed_grain') - s0; out.thatch = H.fn.goodsCount('thatch') - t0;
          out.fert1 = P.fert; out.empty = F.plants({BED}).every((q) => !q);
          return out; }})()""")
        print('harvest', json.dumps(r))
        check(30 <= r['grain'] <= 75 and 20 <= r['seed'] <= 50, f"a bed of grain gives grain and seed back ({r['grain']} grain, {r['seed']} seed)")
        check(r['thatch'] > 0 and r['fert1'] < r['fert0'] - 0.1 and r['empty'], 'straw for thatch too; the harvest tires the soil and clears the bed')

        # ---- frost: a hard frost kills tender flax, turnips stand it ----
        r = await page.evaluate("""(() => { const H = __hm, F = H.farm, out = {};
          const R = H.REALMS[0];
          // two beds in the cold of a Logres winter night
          let spot = null;
          for (let a = 0; a < 80 && !spot; a++) { const x = R.town.x + Math.cos(a * 0.37) * (90 + a), z = R.town.z + Math.sin(a * 0.37) * (90 + a); if (!F.tillWhy(x, z) && !F.tillWhy(x + 3, z) && !F.tillWhy(x + 3, z + 4) && !F.tillWhy(x, z + 4)) spot = [x, z]; }
          const a = F.till(spot[0], spot[1], 0), b = F.till(spot[0] + 3.2, spot[1], 0);
          F.sow(a, 'seed_flax'); F.sow(b, 'seed_turnip');
          for (const id of [a, b]) for (const q of F.plot(id).plants) if (q) q.g = 0.4;
          F.setSeason(0.88); H.setTod(2.0); H.frame();
          out.temp = F.farmTempAt(spot[0], spot[1]);
          for (let i = 0; i < 40; i++) F.step(5);
          const alive = (id) => F.plants(id).filter((q) => q && !q.dead).length;
          out.flax = alive(a); out.turnip = alive(b); out.bitten = F.plants(b).filter((q) => q && q.bite > 0.5).length;
          F.FARM.plots.splice(F.FARM.plots.indexOf(F.plot(a)), 1); F.FARM.plots.splice(F.FARM.plots.indexOf(F.plot(b)), 1);
          H.setTod(0.5); H.frame();
          return out; })()""")
        print('frost', json.dumps(r))
        check(r['temp'] < -3, f"a winter night is a frost ({r['temp']:.1f}°C)")
        check(r['flax'] <= 2 and r['turnip'] >= 18, f"the frost kills the tender flax ({r['flax']} left: a hardy one may live, as breeding for hardiness needs) and the hardy turnips live ({r['turnip']} of 24)")

        # ---- drought: a dry bed in a hot summer wilts and dies; a dryland strain lasts longer ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, W = H.dbg.WEATHER, out = {{}};
          const P = F.plot({BED});
          const dry = F.newStrain('grain', {{ d: 0.95 }}, 3, 0.02), wet = F.newStrain('grain', {{ d: 0.05 }}, 3, 0.02);
          H.fn.goodsAdd(dry, 12, true); H.fn.goodsAdd(wet, 12, true);
          F.sow(P.id, dry, 12); F.sow(P.id, wet, 12);
          for (const q of P.plants) if (q) q.g = 0.4;
          F.setSeason(0.38); H.setTod(0.5); H.frame(); W.raining = 0; W.overcast = 0;
          P.moist = 0.5; out.moist = [];
          for (let i = 0; i < 160; i++) {{ F.step(10); if (i % 20 === 0) out.moist.push(+P.moist.toFixed(2)); }}
          const pl = F.plants(P.id);
          const stat = (st) => {{ const l = pl.filter((q) => q && q.st === st); return [l.filter((q) => !q.dead).length, +(l.reduce((a, q) => a + q.hp, 0) / l.length).toFixed(2), +(l.reduce((a, q) => a + q.wilt, 0) / l.length).toFixed(2)]; }};
          out.dry = stat(H.fn.GOODS[dry].farmStrain); out.wet = stat(H.fn.GOODS[wet].farmStrain);
          out.parched = P.moist;
          // rain brings it back
          W.raining = 1; F.step(30); out.rained = P.moist; W.raining = 0;
          P.plants.fill(null);
          return out; }})()""")
        print('drought', json.dumps(r))
        check(r['parched'] < 0.05 and r['rained'] > 0.6, 'a hot dry summer parches a bed; rain soaks it again')
        check(r['wet'][1] < r['dry'][1] and r['wet'][2] > 0.3, f"the plants wilt and die of thirst, the thirsty strain first (dryland {r['dry']}, thirsty {r['wet']})")

        # ---- weeds ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, out = {{}};
          const P = F.plot({BED}); P.weeds = 0; P.moist = 0.6; P.fert = 0.8;
          F.setSeason(0.1);
          for (let i = 0; i < 60; i++) F.step(10);
          out.weeds = P.weeds;
          const C = F.FARM_CROPS.grain, tr = F.FARM.strains.c_grain.tr;
          P.weeds = 0; const clean = F.grow(C, P, tr, 14); P.weeds = 1; const choked = F.grow(C, P, tr, 14);
          out.slow = choked / clean;
          // pull them: the job
          H.teleport(P.x - P.ax * (P.hd + 0.5), P.z - P.az * (P.hd + 0.5)); H.GAME.player.yaw = P.ang; H.simulate(0.1); H.frame();
          out.ctx = F.ctx(); out.act = F.act('weed'); H.simulate(5); out.after = P.weeds;
          return out; }})()""")
        print('weeds', json.dumps(r))
        check(r['weeds'] > 0.4, f"weeds come up in a bed through the spring ({r['weeds']:.2f})")
        check(r['slow'] < 0.6, 'weeds slow the crop down')
        check(r['ctx'] and 'weed' in r['ctx']['actions'] and r['act'] and r['after'] < 0.02, 'pulling the weeds clears the bed')

        # ---- crossing two strains; the offspring's traits ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, W = H.dbg.WEATHER, out = {{}};
          const P = F.plot({BED});
          // a second bed beside the first
          const Q = F.plot(F.till(P.x + P.bx * (P.hw * 2 + 0.4), P.z + P.bz * (P.hw * 2 + 0.4), P.ang));
          const A = F.newStrain('grain', {{ y: 0.9, h: 0.1, c: 0.05, ht: 0.3 }}, 2, 0.02), B = F.newStrain('grain', {{ y: 0.2, h: 0.95, c: 0.95, ht: 0.7 }}, 2, 0.02);
          H.fn.goodsAdd(A, 24, true); H.fn.goodsAdd(B, 24, true);
          P.plants.fill(null); Q.plants.fill(null); P.weeds = Q.weeds = 0; P.moist = Q.moist = 0.7; P.fert = Q.fert = 0.9;
          F.sow(P.id, A); F.sow(Q.id, B);
          F.setSeason(0.3); H.setTod(0.5); H.frame();
          for (let i = 0; i < 400; i++) {{ W.raining = (i % 30) < 4 ? 1 : 0; F.step(5); P.weeds = Q.weeds = 0; if (P.plants.every((q) => q && q.g >= 1) && Q.plants.every((q) => q && q.g >= 1)) break; }}
          W.raining = 0;
          const sA = H.fn.GOODS[A].farmStrain, sB = H.fn.GOODS[B].farmStrain;
          const pl = F.plants(P.id);
          out.crossed = pl.filter((q) => q && q.pol === sB).length; out.selfed = pl.filter((q) => q && q.pol === sA).length;
          // keep the seed of a crossed plant next to the other bed
          const s = pl.findIndex((q) => q && q.pol === sB);
          const mum = pl[s].tr;
          const S = F.saveSeed(P.id, s);
          out.child = S; out.mum = mum;
          out.ripe = pl.filter((q) => q && q.g >= 1).length;
          out.Q = Q.id; out.sA = sA; out.sB = sB;
          return out; }})()""")
        print('cross', json.dumps(r)[:900])
        check(r['ripe'] >= 20 and r['crossed'] >= 2, f"plants in flower beside another strain cross ({r['crossed']} crossed, {r['selfed']} selfed)")
        c = r['child'] or {}
        ok = c and c.get('pa') == r['sA'] and c.get('pb') == r['sB'] and c.get('gen') == 3
        check(ok, 'the kept seed is a new strain a generation on, with both parents recorded')
        if ok:
            check(0.45 <= c['tr']['c'] <= 0.62 and 0.45 <= c['tr']['h'] <= 0.62 and c['tr']['y'] > 0.5, f"the offspring's traits fall between the parents' (colour {c['tr']['c']:.2f}, hardiness {c['tr']['h']:.2f}, yield {c['tr']['y']:.2f})")
        Q = r['Q']

        # ---- seed saving over generations raises the yield ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, W = H.dbg.WEATHER, out = {{ gens: [] }};
          const P = F.plot({BED}), Q = F.plot({Q});
          Q.plants.fill(null); P.plants.fill(null);
          let good = 'seed_grain';
          F.setSeason(0.3); H.setTod(0.5); H.frame();
          for (let gen = 0; gen < 5; gen++) {{
            H.fn.goodsAdd(good, 30, true);
            P.plants.fill(null); P.fert = 0.9; P.moist = 0.7; P.weeds = 0;
            F.sow(P.id, good);
            for (let i = 0; i < 400; i++) {{ W.raining = (i % 30) < 4 ? 1 : 0; F.step(5); P.weeds = 0; if (P.plants.every((q) => q && q.g >= 1)) break; }}
            const pl = F.plants(P.id);
            const ys = pl.map((q) => q.tr.y);
            out.gens.push([+(ys.reduce((a, b) => a + b, 0) / ys.length).toFixed(3), F.FARM.strains[pl[0].st].gen]);
            // the best plant (a breeder who has watched the whole bed knows it)
            let best = 0, bv = -1;
            P.plants.forEach((q, s) => {{ if (q.tr.y > bv) {{ bv = q.tr.y; best = s; }} }});
            const S = F.saveSeed(P.id, best);
            good = S.good;
          }}
          W.raining = 0;
          return out; }})()""")
        print('generations', json.dumps(r))
        g = r['gens']
        check(len(g) == 5 and g[-1][0] > g[0][0] + 0.1 and g[-1][1] >= 4, f"keeping the seed of the best plant raises the strain's yield over generations ({[x[0] for x in g]})")

        # ---- the herbal: examine, gather, dig, plant ----
        r = await page.evaluate("""(() => { const H = __hm, F = H.farm, out = {};
          const herbs = F.herbs();
          out.kinds = [...new Set(herbs.map((h) => h.k))].length;
          const i = herbs.findIndex((h) => h.k === 'herb_heal' && h.gone === 0);
          const h = herbs[i];
          H.teleport(h.x - 1.2, h.z); H.GAME.player.yaw = Math.PI / 2; H.simulate(0.1); H.frame();
          out.ctx0 = F.ctx(); out.knew = F.knows('herb_heal');
          out.study = F.act('study'); H.simulate(4); out.knows = F.knows('herb_heal');
          H.frame(); out.ctx1 = F.ctx();
          const n0 = H.fn.goodsCount('herb_heal'), r0 = F.herbs().filter((x) => x.regrow > 0).length; out.gather = F.act('gather'); H.simulate(3); out.got = H.fn.goodsCount('herb_heal') - n0;
          out.regrow = F.herbs().filter((x) => x.regrow > 0).length - r0;
          H.fn.goodsAdd('tool_knife', 1, true);
          const j = herbs.findIndex((x, k) => k !== i && x.k === 'herb_heal' && x.gone === 0);
          out.dug = F.dig(j); out.roots = H.fn.goodsCount('root_heal');
          return out; })()""")
        r2 = await page.evaluate("""(() => { const H = __hm; H.LORE.openChronicle('herbal'); const html = document.getElementById('menu-body').innerHTML; const ok = html.includes('Woundwort') && html.includes('Unknown herb'); H.LORE.openChronicle('fields'); const ok2 = document.getElementById('menu-body').innerHTML.includes('Breeding better plants'); document.getElementById('menu').hidden = true; H.UI.modal = null; return ok && ok2; })()""")
        print('herbal', json.dumps(r), r2)
        check(r['kinds'] == 8, 'eight kinds of wild herb grow in their own places')
        check(r['ctx0'] and r['ctx0']['actions'] == ['study'] and not r['knew'], 'an unknown herb can only be examined')
        check(r['knows'] and r['ctx1'] and r['ctx1']['actions'][0] == 'gather' and 'dig' in r['ctx1']['actions'], 'examining it writes it into the herbal; then it can be gathered or dug up')
        check(r['got'] >= 1 and r['regrow'] > 0, 'gathering gives the herb, and the plant grows back')
        check(r['dug'] == 'root_heal' and r['roots'] == 1, 'with a knife the root comes up whole')
        check(r2, 'the Chronicle has a Fields page, and a Herbal listing the known herb and the unknown ones')

        # ---- trampling and fire ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, out = {{}};
          const P = F.plot({BED}); P.plants.fill(null); H.fn.goodsAdd('seed_grain', 30, true); F.sow(P.id, 'seed_grain');
          for (const q of P.plants) q.g = 0.6;
          // walk straight across the bed
          const pl = H.GAME.player;
          H.teleport(P.x - P.bx * (P.hw + 1), P.z - P.bz * (P.hw + 1)); H.simulate(0.3);
          for (let k = 0; k <= 30; k++) {{ const t = k / 30; pl.x = P.x + P.bx * (-P.hw - 1 + t * (2 * P.hw + 2)); pl.z = P.z + P.bz * (-P.hw - 1 + t * (2 * P.hw + 2)); H.simulate(0.1); }}
          out.trod = F.plants(P.id).filter((q) => q && q.trod > 0.2).length;
          H.teleport(P.x + 20, P.z + 20);
          const W = H.dbg.WEATHER; W.raining = 0; W.wet = 0; W.snow = 0; H.dbg.U.uWet.value = 0; H.dbg.U.uSnowCover.value = 0;
          return out; }})()""")
        fire = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, P = F.plot({BED});
          // the nature map's fire, started on the bed itself
          const cells = []; for (let k = 0; k < 12; k++) {{ const u = (Math.random() - 0.5) * 2 * P.hw, v = (Math.random() - 0.5) * 2 * P.hd; cells.push([P.x + u * P.bx + v * P.ax, P.z + u * P.bz + v * P.az]); }}
          let lit = 0; for (const [x, z] of cells) lit += H.nature && H.nature.igniteGrass ? H.nature.igniteGrass(x, z, 0.6, 1) : 0;
          for (let i = 0; i < 40; i++) H.simulate(0.5);
          return {{ lit, burnt: F.plants({BED}).filter((q) => q && q.char).length, char: P.char }}; }})()""")
        print('trample', json.dumps(r), 'fire', json.dumps(fire))
        check(r['trod'] >= 2, f"walking through a bed tramples the plants in its path ({r['trod']})")
        if fire['lit']:
            check(fire['burnt'] >= 3, f"a grass fire burns the crop in a bed ({fire['burnt']} burnt)")
        else:
            print('  (no grass fire hook on __hm.nature; fire is checked through the nature map in merged.py)')

        # ---- the town fields: the townsfolk at work ----
        r = await page.evaluate("""(() => { const H = __hm, F = H.farm, out = {};
          const S = F.FARM.plots.filter((P) => P.own === 't');
          out.n = S.length; out.slots = S.reduce((a, P) => a + P.valid.reduce((x, v) => x + v, 0), 0);
          // ripen the strip nearest the town and watch the farmers bring it in
          const R = H.REALMS[0];
          S.sort((a, b) => Math.hypot(a.x - R.town.x, a.z - R.town.z) - Math.hypot(b.x - R.town.x, b.z - R.town.z));
          const P = S[0], T = P.stand;
          T.phase = 'sown'; T.crop = 'grain'; T.g = 1; T.hp = 1; T.dead = false; T.task = null; T.p = 0; T.worker = null; T.ripeT = 0; // (ripe since now: a stand left ripe 1800 s rots, and the seasons set earlier in this test may have left it ripe that long)
          out.burnt0 = P.dmg.filter((v) => v >= 2).length; P.dmg.fill(0); P.weeds = 0; P.char = 0; // (the grass fire earlier in this test may have reached this strip: it is about the harvest, not the fire)
          for (const Q of S.slice(1)) { Q.stand.task = null; Q.stand.phase = 'sown'; Q.stand.g = 0.3; Q.stand.hp = 1; Q.stand.dead = false; Q.stand.worker = null; Q.weeds = 0; }
          // the farmers free to work (out of doors, nothing else in hand)
          for (const id of F.farmers()) { const e = H.fn.getEnt(id); if (e && e.ai.fieldHand) { e.ai.plan = null; e.ai.visitUntil = 0; e.ai.nextVisit = H.GAME.t + 999; e.ai.lifeWait = 0; e.ai.farmNext = 0; } }
          F.setSeason(0.45); H.setTod(0.5); H.frame();
          H.teleport(P.x + 8, P.z + 8); H.frame();
          const PL = H.GAME.player;
          if (!PL.alive) { PL.alive = true; PL.hp = PL.maxHp; H.UI.modal = null; document.getElementById('death').hidden = true; }
          out.player = [PL.alive, Math.round(PL.x), Math.round(PL.z), Math.round(Math.hypot(PL.x - P.x, PL.z - P.z))];
          out.farmers0 = F.farmers().map((id) => { const e = H.fn.getEnt(id); return e ? [e.name, e.alive, e.ai.fieldHand, e.ai.plan ? e.ai.plan.steps.map((s) => s.k).join(',') + '@' + e.ai.plan.i + ':' + e.ai.plan.t.toFixed(1) : null, Math.round(Math.hypot(e.x - P.x, e.z - P.z)), Math.round(Math.hypot(e.x - PL.x, e.z - PL.z)), e.buffs.map((b) => b.kind).join()] : null; });
          const gran0 = F.FARM.granary.grain || 0; out.granAll0 = JSON.stringify(F.FARM.granary);
          out.track = [];
          let worked = 0, seenWorker = null;
          for (let i = 0; i < 140; i++) {
            H.simulate(1); if (i % 10 === 0) H.frame();
            if (T.worker != null) { seenWorker = T.worker; const e = H.fn.getEnt(T.worker); if (e && Math.hypot(e.x - P.x, e.z - P.z) < P.rad + 2) worked++; }
            if (i % 20 === 0) out.track.push([i, T.task, +T.p.toFixed(2), T.worker != null, P.valid.reduce((a, v, q) => a + (v && P.dmg[q] < 2 ? 1 : 0), 0), +P.fert.toFixed(2), +P.weeds.toFixed(2), T.hp]); // (and how many of its plants still stand to be brought in)
            if (T.phase === 'stubble') break;
          }
          out.phase = T.phase; out.worked = worked; out.worker = seenWorker;
          out.farmers1 = F.farmers().map((id) => { const e = H.fn.getEnt(id); return e ? [e.name, e.alive, e.ai.plan ? e.ai.plan.steps.map((s) => s.k).join(',') + '@' + e.ai.plan.i + ':' + e.ai.plan.t.toFixed(1) : null, Math.round(Math.hypot(e.x - P.x, e.z - P.z))] : null; });
          out.player1 = [PL.alive, Math.round(Math.hypot(PL.x - P.x, PL.z - P.z))];
          out.granary = (F.FARM.granary.grain || 0) - gran0; out.gran = [gran0, F.FARM.granary.grain || 0, T.hp, T.dead, T.crop]; out.granAll1 = JSON.stringify(F.FARM.granary); out.fertNow = [P.fert, P.weeds, P.valid.reduce((a, v, q) => a + (v && P.dmg[q] < 2 ? 1 : 0), 0)];
          out.act = seenWorker != null ? H.fn.getEnt(seenWorker).ai.farmer : null;
          return out; })()""")
        print('town', json.dumps(r))
        check(r['n'] >= 8 and r['slots'] > 3000, f"the Logres fields are laid out in strips ({r['n']} strips, {r['slots']} plants' room)")
        check(r['worker'] is not None and r['act'] and r['worked'] > 10, 'a farmer of the town walks out and works the ripe strip')
        check(r['phase'] == 'stubble' and r['granary'] > 200, f"the strip is harvested into the town's granary (+{r['granary']})")

        # ---- save and load; an old save; a damaged one ----
        r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, out = {{}};
          const P = F.plot({BED}); P.plants.fill(null); H.fn.goodsAdd('seed_turnip', 30, true); F.sow(P.id, 'seed_turnip');
          P.plants[3].g = 0.77; P.plants[3].pol = {{ st: 'c_turnip', tr: {{ ...P.plants[3].tr }}, self: true }};
          const s = H.fn.buildSave();
          const json = JSON.stringify(s);
          out.size = json.length; out.farmSize = JSON.stringify(s.world.x.farm).length; out.herbal = s.char.x.herbal;
          const before = {{ plots: F.FARM.plots.filter((Q) => Q.own === 'p').map((Q) => [Q.x.toFixed(1), Q.z.toFixed(1), Q.plants.filter((q) => q).length]), strains: Object.keys(F.FARM.strains).length, season: F.seasonNow().k.toFixed(3), g3: P.plants[3].g.toFixed(3), tr3: JSON.stringify(P.plants[3].tr), strips: F.strips().map((t) => t.phase + t.crop).join() }};
          // wipe and load back
          const back = JSON.parse(json);
          F.FARM.plots.filter((Q) => Q.own === 'p').forEach((Q) => F.FARM.plots.splice(F.FARM.plots.indexOf(Q), 1));
          F.setSeason(0.9);
          H.fn.savePartsLoad('world', back.world.x);
          const P2 = F.FARM.plots.find((Q) => Q.own === 'p' && Math.abs(Q.x - P.x) < 0.2 && Math.abs(Q.z - P.z) < 0.2);
          const after = {{ plots: F.FARM.plots.filter((Q) => Q.own === 'p').map((Q) => [Q.x.toFixed(1), Q.z.toFixed(1), Q.plants.filter((q) => q).length]), strains: Object.keys(F.FARM.strains).length, season: F.seasonNow().k.toFixed(3), g3: P2 && P2.plants[3].g.toFixed(3), tr3: P2 && JSON.stringify(P2.plants[3].tr), strips: F.strips().map((t) => t.phase + t.crop).join() }};
          out.same = JSON.stringify([before.plots, before.strains, before.season, before.strips]) === JSON.stringify([after.plots, after.strains, after.season, after.strips]);
          out.g = [before.g3, after.g3];
          out.trDiff = (() => {{ const a = JSON.parse(before.tr3), b = JSON.parse(after.tr3); return Math.max(...Object.keys(a).map((k) => Math.abs(a[k] - b[k]))); }})();
          out.pol = P2 && P2.plants[3].pol && P2.plants[3].pol.self;
          // the herbal with the character
          H.fn.savePartsLoad('char', back.char.x); out.knows = F.knows('herb_heal');
          // an old save: no farm record at all leaves the land as it is
          const n0 = F.FARM.plots.length; H.fn.savePartsLoad('world', {{}}); out.old = F.FARM.plots.length === n0;
          H.fn.savePartsLoad('char', {{}}); out.oldChar = !F.knows('herb_heal');
          // a damaged one
          let err = null;
          try {{ F.load({{ v: 1, t: 'x', st: [['s9', 'nope'], 5, null, ['s12', 'grain', 'a', 'b', 'zz', 3, null, 9]], pl: [[1, 2, 3, 'x', -4, 900, null, 'w', 'q', '0|x|y|z|grain|nope|AAAAAA||||1|2;99|1|1|1|grain|c_grain|||'], 'bad', [NaN, 5]], tw: [[9, 99, -5, 'x', 7, 1e9]], hb: [[-1, 5, 5], [3, 'x', 1e9]], gr: {{ grain: 'x', nothing: 5 }} }}); }} catch (e) {{ err = String(e); }}
          out.damaged = err; out.after = F.FARM.plots.filter((Q) => Q.own === 'p').map((Q) => Q.plants.filter((q) => q).length);
          out.finite = F.FARM.plots.every((Q) => Number.isFinite(Q.x) && Number.isFinite(Q.z) && Number.isFinite(Q.fert) && (!Q.plants || Q.plants.every((q) => !q || (Number.isFinite(q.g) && Number.isFinite(q.hp)))));
          out.key = JSON.stringify(F.key(F.save())).length;
          return out; }})()""")
        print('save', json.dumps(r))
        check(r['same'] and r['g'][0] == r['g'][1] and r['trDiff'] < 0.01 and r['pol'], 'beds, plants with their traits and pollen, strains, the season and the town strips come back from a save')
        check(r['knows'] and r['old'] and r['oldChar'], 'the herbal comes back with the character; an older save without farming loads cleanly')
        check(r['damaged'] is None and r['finite'], 'a damaged farm record is cleaned on load')
        check(r['farmSize'] < 12000, f"the farm record is compact ({r['farmSize']} bytes)")

        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print(f'[{time.time() - T0:.0f}s] numeric checks done', flush=True)

        if SHOTS:
            await shots(page)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors after the shots {errs[:2]}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()

async def shot(page, name, cam, look, tod=0.7, hud=False):
    await page.evaluate(f"""(() => {{ const H = __hm; H.setTod({tod}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; document.getElementById('hud').hidden = {'false' if hud else 'true'};
      const c = H.camera; c.position.set({cam[0]}, {cam[1]}, {cam[2]}); c.lookAt({look[0]}, {look[1]}, {look[2]}); c.updateMatrixWorld();
      H.farm.FARM.drawDirty = true; H.frame(1 / 60); }})()""")
    await page.screenshot(path=OUT + name, timeout=600000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

async def shots(page):
    await page.evaluate(f"__hm.fn.setQuality('{'medium' if FINAL else 'low'}')")
    # a bed of each crop at its stages, side by side, after rain, on fresh ground in the glens of Eriu
    r = await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm, W = H.dbg.WEATHER;
      const R = H.REALMS[1];
      let spot = null;
      for (let a = 0; a < 160 && !spot; a++) {{ const x = R.town.x + Math.cos(a * 0.29) * (70 + a * 0.6), z = R.town.z + Math.sin(a * 0.29) * (70 + a * 0.6); let ok = true; for (let u = -1; u <= 18 && ok; u += 2) for (let v = -3; v <= 3 && ok; v += 1.5) if (F.tillWhy(x + u, z + v)) ok = false; if (ok) spot = [x, z]; }}
      const [x, z] = spot, ids = [];
      const crops = ['seed_grain', 'seed_flax', 'seed_beans', 'seed_cabbage', 'seed_turnip', 'seed_grain'];
      const gs = [0.16, 0.4, 0.66, 0.8, 0.93, 1.0];
      F.setSeason(0.35);
      for (let k = 0; k < 6; k++) {{ const id = F.till(x + k * 3.0, z, 0); H.fn.goodsAdd(crops[k], 30, true); F.sow(id, crops[k]); for (const q of F.plot(id).plants) q.g = Math.min(1, gs[k] + (Math.random() - 0.5) * 0.04); F.plot(id).weeds = k === 2 ? 0.5 : 0.05; F.plot(id).moist = 0.9; ids.push(id); }}
      W.mode = 'auto'; W.kind = 'clear'; W.wet = 0.85; H.dbg.U.uWet.value = 0.85; W.raining = 0;
      H.teleport(x + 7, z - 7);
      window.__farmShot = ids;
      return {{ x, z, y: H.fn.heightAt(x + 7, z) }}; }})()""")
    x, z, y = r['x'], r['z'], r['y']
    await shot(page, 'farm_stages.png', [x + 7.5, y + 2.4, z - 6.0], [x + 7.5, y + 0.2, z + 0.5])
    await shot(page, 'farm_wet_bed.png', [x - 1.6, y + 1.5, z - 3.0], [x + 0.9, y + 0.05, z + 0.4])
    # the plant card over a ripe bed (the world paused, the card kept up for the picture)
    await page.evaluate(f"""(() => {{ const H = __hm, F = H.farm; H.dbg.WEATHER.wet = 0; H.dbg.U.uWet.value = 0;
      const P = F.plot(window.__farmShot[5]);
      H.UI.modal = null; H.CAM.mode = 'play';
      H.teleport(P.x - P.ax * (P.hd + 0.4), P.z - P.az * (P.hd + 0.4)); H.GAME.player.yaw = P.ang; H.simulate(0.1);
      F.FARM.clock.ui = 0; H.frame(1 / 30); F.FARM.cardForce = true; }})()""")
    pp = await page.evaluate("(() => { const H = __hm, P = H.GAME.player; return [P.x, P.y, P.z, P.yaw]; })()")
    import math
    await shot(page, 'farm_card.png', [pp[0] - math.sin(pp[3]) * 3.6, pp[1] + 2.6, pp[2] - math.cos(pp[3]) * 3.6], [pp[0] + math.sin(pp[3]) * 2, pp[1] + 0.4, pp[2] + math.cos(pp[3]) * 2], hud=True)
    await page.evaluate("__hm.farm.FARM.cardForce = false; document.getElementById('hud').hidden = true;0")
    # a ripe town field with a farmer at the harvest
    r = await page.evaluate("""(() => { const H = __hm, F = H.farm;
      const S = F.FARM.plots.filter((P) => P.own === 't');
      const R = H.REALMS[0];
      S.sort((a, b) => Math.hypot(a.x - R.town.x, a.z - R.town.z) - Math.hypot(b.x - R.town.x, b.z - R.town.z));
      F.setSeason(0.45);
      for (const P of S) { const T = P.stand; T.phase = 'sown'; T.crop = P.id % 5 === 0 ? 'flax' : 'grain'; T.g = 1; T.hp = 1; T.dead = false; T.task = null; T.worker = null; P.weeds = 0; P.dmg.fill(0); P.char = 0; }
      const P = S[1]; P.stand.task = 'harvest'; P.stand.p = 0.3; P.stand.workT = H.GAME.t;
      H.UI.modal = null; H.CAM.mode = 'play'; H.setTod(0.95); H.frame();
      H.teleport(P.x + 12, P.z + 12);
      for (const id of F.farmers()) { const e = H.fn.getEnt(id); if (e && e.ai.fieldHand) { e.ai.plan = null; e.ai.visitUntil = 0; e.ai.nextVisit = H.GAME.t + 999; e.ai.lifeWait = 0; e.ai.farmNext = 0; } }
      let e = null;
      for (let i = 0; i < 90; i++) { H.simulate(1); if (P.stand.worker != null) { e = H.fn.getEnt(P.stand.worker); if (e && Math.hypot(e.x - P.x, e.z - P.z) < P.rad && P.stand.p > 0.34) break; } }
      return { x: P.x, z: P.z, ax: P.ax, az: P.az, ex: e ? e.x : P.x, ez: e ? e.z : P.z, eyaw: e ? e.yaw : 0, worker: !!e, p: P.stand.p, y: H.fn.heightAt(P.x, P.z) }; })()""")
    print('  town harvest', r)
    ex, ez, ey = r['ex'], r['ez'], r['eyaw']
    await shot(page, 'farm_town_harvest.png', [ex + math.sin(ey) * 4.5 + 2, r['y'] + 2.0, ez + math.cos(ey) * 4.5 + 2], [ex, r['y'] + 0.7, ez], tod=0.95)
    await shot(page, 'farm_ripe_field.png', [r['x'] + r['ax'] * 14 + 6, r['y'] + 16, r['z'] + r['az'] * 14 + 6], [r['x'] - r['ax'] * 6, r['y'], r['z'] - r['az'] * 6], tod=0.95)
    # a herb patch in shade
    r = await page.evaluate("""(() => { const H = __hm, F = H.farm; const h = F.herbs().find((x) => x.k === 'herb_moon' && x.gone === 0) || F.herbs()[0];
      F.setSeason(0.3); const near = F.herbs().filter((x) => Math.hypot(x.x - h.x, x.z - h.z) < 6).length; H.UI.modal = null; H.teleport(h.x + 2, h.z + 2); H.simulate(0.2); return { x: h.x, z: h.z, y: H.fn.heightAt(h.x, h.z), near, k: h.k }; })()""")
    print('  herb patch', r)
    await shot(page, 'farm_herbs_shade.png', [r['x'] + 1.5, r['y'] + 1.0, r['z'] + 1.3], [r['x'], r['y'] + 0.15, r['z']], tod=0.6)

async def phone():
    # the plant card and the prompt on a phone held upright, with touch
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=True, w=390, h=780)
        await page.evaluate("__hm.start({ realm: 0, cls: 'priest', level: 8 })")
        r = await page.evaluate("""(() => { const H = __hm, F = H.farm; H.dbg.WEATHER.mode = 'clear'; H.setTod(0.6);
          const R = H.REALMS[0]; let spot = null;
          for (let a = 0; a < 120 && !spot; a++) { const x = R.town.x + Math.cos(a * 0.31) * (95 + a * 0.4), z = R.town.z + Math.sin(a * 0.31) * (95 + a * 0.4); let ok = true; for (let u = -2; u <= 2 && ok; u += 1) for (let v = -3; v <= 3 && ok; v += 1.5) if (F.tillWhy(x + u, z + v)) ok = false; if (ok) spot = [x, z]; }
          const id = F.till(spot[0], spot[1], 0); H.fn.goodsAdd('seed_cabbage', 30, true); F.sow(id, 'seed_cabbage'); const P = F.plot(id); for (const q of P.plants) q.g = 0.85;
          H.teleport(P.x, P.z - P.hd - 0.4); H.GAME.player.yaw = 0; H.look(Math.PI, 0.55, 6); H.simulate(0.2);
          F.FARM.clock.ui = 0; for (let i = 0; i < 4; i++) H.frame(1 / 30);
          const el = document.getElementById('farmcard'), rc = el.getBoundingClientRect(), pf = document.getElementById('pf').getBoundingClientRect();
          return { on: el.classList.contains('on'), card: [rc.left, rc.top, rc.width, rc.height], pf: [pf.left, pf.top, pf.width, pf.height], prompt: document.getElementById('prompt').classList.contains('on'), vw: innerWidth }; })()""")
        print('phone', json.dumps(r))
        c, f = r['card'], r['pf']
        check(r['on'] and c[0] >= 0 and c[0] + c[2] <= r['vw'] + 1, 'on a phone the plant card shows, inside the screen')
        check(c[1] >= f[1] + f[3] - 1 or c[0] >= f[0] + f[2] - 1, 'and clear of the player frame')
        if SHOTS:
            await page.screenshot(path=OUT + "farm_phone.png", timeout=600000)
            print('  shot farm_phone.png', flush=True)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors on the phone {errs[:2]}')
        await b.close()

asyncio.run(main())
if 'phone' in sys.argv:
    asyncio.run(phone())
    print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
