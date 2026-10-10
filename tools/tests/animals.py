"""Animals (08h_animals.js, 05j_farmbeasts.js): taming a wolf into a hound step by step (calm approach, food, trust
that falls when you rush or strike); commands (follow round obstacles, stay, guard, attack, call) and a hound fighting
and gaining bond levels; taming a wild horse and riding it in its own coat and pace; livestock in the town common
giving wool, milk, eggs and manure over simulated time; a breeding pair's young growing up with inherited traits over
two generations; save and load (and an old and a damaged save); screenshots of a hound following the player, a flock
grazing, cattle, hens, a mare with her foal, and the animal card.
usage: python3 tools/tests/animals.py [shots]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
SHOTS = 'shots' in sys.argv
FAILS = []
T0 = time.time()
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HELPERS = """(() => {
  const H = __hm, A = H.animals, F = H.fn;
  window.__an = {
    H, A, F,
    P: () => H.GAME.player,
    sum: (e) => A.sum(e),
    near(e, d) { const P = H.GAME.player; const a = Math.random() * 6.283; const x = e.x + Math.cos(a) * d, z = e.z + Math.sin(a) * d; H.teleport(x, z); return [x, z]; },
    wild(kind) { const P = H.GAME.player; let best = null, bd = 1e12; for (const e of H.ENT) { if (A.anWildKind(e) !== kind) continue; const d = (e.x - P.x) ** 2 + (e.z - P.z) ** 2; if (d < bd) { bd = d; best = e; } } return best; },
    mine: (k) => A.anMine().filter((e) => !k || e.tame.k === k),
    // stand still beside a wild creature until it settles, then feed it
    feed(e) { const T = A.anTrust(e); for (let i = 0; i < 40 && T.settle < 1; i++) H.simulate(0.25); T.last = -99; A.anOffer(e); return T.n; },
  };
  return 0; })()"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if SHOTS else 640, h=540 if SHOTS else 360)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("__hm.start({ realm: 0, cls: 'warrior', level: 12 }); __hm.dbg.WEATHER.mode = 'clear'; 0")
        await page.evaluate(HELPERS)
        r = await page.evaluate("""(() => { const { H, A } = __an; const o = {};
          o.pens = A.A.pens.map((p) => p.owner);
          o.kinds = {}; for (const e of A.A.list) { const k = e.tame.k + ':' + e.tame.owner; o.kinds[k] = (o.kinds[k] || 0) + 1; }
          o.crowds = ['sheep', 'sheepShorn', 'cattle', 'bull', 'pig', 'hound', 'horseWild', 'horseTack', 'hen'].filter((k) => !__hm.renderInfo().per.beasts[k]);
          o.missing = A.A.list.length ? 0 : 1;
          return o; })()""")
        print('world', json.dumps(r))
        check(r['pens'].count('town') == 3, 'each town has its common pasture')
        check(r['kinds'].get('sheep:town', 0) >= 15 and r['kinds'].get('cattle:town', 0) >= 6 and r['kinds'].get('hen:town', 0) >= 12, 'flocks of sheep, cattle and hens in the commons')
        check(r['kinds'].get('horse:wild', 0) >= 12, 'herds of wild horses on the open downs')
        check(not r['crowds'], f'every farm beast has its crowd {r["crowds"]}')

        # ---- taming a wolf, step by step ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {}; const P = __an.P();
          const w = __an.wild('hound'); o.found = !!w; if (!w) return o;
          o.wolf = w.name; o.wid = w.id;
          F.goodsAdd('meat_raw', 12, true);
          __an.near(w, 3.2); w.ai.tameHold = H.GAME.t + 3;
          // too soon: it is wary
          const T = A.anTrust(w); T.settle = 0; A.anOffer(w); o.waryRefused = T.n === 0;
          o.n1 = __an.feed(w);
          o.n2 = __an.feed(w);
          // ride at it: it takes fright and trusts you less
          F.mountUp(P); H.simulate(0.3); o.afterRush = T.n; F.dismount(P);
          H.simulate(1);
          __an.near(w, 3.0); H.simulate(0.3); P.combatUntil = 0;
          let k = 0; while (H.ENT.includes(w) && k++ < 8) { P.combatUntil = 0; __an.feed(w); }
          o.tamed = !H.ENT.includes(w) || w.removed;
          const hd = __an.mine('hound')[0]; o.hound = hd ? __an.sum(hd) : null;
          o.need = T.need; o.meatLeft = F.goodsCount('meat_raw');
          // strike a boar you were winning over: all its trust is gone
          const bo = __an.wild('pig');
          if (bo) { F.goodsAdd('apple', 4, true); __an.near(bo, 3); H.simulate(0.2); const T2 = A.anTrust(bo); __an.feed(bo); o.boarTrust = T2.n; F.dealDamage(P, bo, 1); H.simulate(0.2); o.struck = T2.n; bo.threat = null; bo.ai.evade = true; P.combatUntil = 0; H.simulate(1); }
          return o; })()""")
        print('tame', json.dumps(r))
        check(r.get('found'), 'a wild wolf to tame')
        check(r.get('waryRefused'), 'a wary wolf will not take food until it settles')
        check(r.get('n1') == 1 and r.get('n2') == 2, 'each feeding builds trust')
        check(r.get('afterRush') == 1, 'riding at it costs trust')
        check(r.get('boarTrust') == 1 and r.get('struck') == 0, 'striking a creature loses all its trust')
        h = r.get('hound') or {}
        check(r.get('tamed') and h.get('k') == 'hound' and h.get('owner') == 'player' and h.get('cmd') == 'follow' and h.get('faction') == 0, 'the wolf becomes your hound and follows you')

        # ---- commands: follow round obstacles, stay, call, guard, attack and fight ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {}; const P = __an.P(); const hd = __an.mine('hound')[0];
          // walk away from it: it keeps up
          const x0 = hd.x, z0 = hd.z; H.teleport(P.x + 18, P.z + 6); for (let i = 0; i < 12; i++) H.simulate(0.5);
          o.follow = Math.hypot(hd.x - P.x, hd.z - P.z);
          // stay
          A.anCommand(hd, 'stay'); const sx = hd.x, sz = hd.z; H.teleport(P.x + 20, P.z - 10); H.simulate(5);
          o.stay = Math.hypot(hd.x - sx, hd.z - sz);
          // call: it comes at once
          A.anCommand(hd, 'call'); H.simulate(6); o.call = Math.hypot(hd.x - P.x, hd.z - P.z); o.cmd = hd.tame.cmd;
          // a foe: set the hound on it
          const camp = H.CAMPS.find((c) => c.type === 'boar' && c.realm === 0);
          const foe = F.spawnMob(camp); foe.x = foe.prevX = P.x + 8; foe.z = foe.prevZ = P.z; foe.y = F.heightAt(foe.x, foe.z); foe.home = { x: foe.x, z: foe.z, r: 6 };
          F.setPlayerTarget(foe); A.anCommand(hd, 'attack');
          const hp0 = foe.hp; let t = 0; while (t < 30 && foe.alive) { H.simulate(0.5); t += 0.5; }
          o.bit = foe.damagers && foe.damagers.has(hd.id); o.foeDead = !foe.alive; o.hp0 = Math.round(hp0); o.t = t;
          o.xp = hd.tame.xp; o.cmdAfter = hd.tame.cmd;
          // bond levels from a run of kills
          A.A.list.includes(hd); const before = hd.tame.lvl; hd.tame.xp = 0;
          for (let i = 0; i < 6; i++) { const f2 = F.spawnMob(camp); f2.level = 6; F.setupStats(f2); f2.x = f2.prevX = P.x + 8; f2.z = f2.prevZ = P.z + 1; f2.home = { x: f2.x, z: f2.z, r: 6 }; F.setPlayerTarget(f2); A.anCommand(hd, 'attack'); let tt = 0; while (tt < 25 && f2.alive) { H.simulate(0.5); tt += 0.5; } }
          o.lvl = [before, hd.tame.lvl];
          // guard: anything coming near the spot is bitten
          A.anCommand(hd, 'guard'); const g = F.spawnMob(camp); g.x = g.prevX = hd.x + 6; g.z = g.prevZ = hd.z; g.home = { x: g.x, z: g.z, r: 4 };
          g.threat = new Map([[hd.id, 5]]); g.combatUntil = H.GAME.t + 6;
          H.simulate(4); o.guardTarget = hd.target === g.id || !g.alive || (g.damagers && g.damagers.has(hd.id));
          A.anCommand(hd, 'follow');
          o.hound = __an.sum(hd);
          return o; })()""")
        print('commands', json.dumps(r))
        check(r['follow'] < 5, f'the hound keeps up when you walk away ({r["follow"]:.1f} m)')
        check(r['stay'] < 2.6, f'told to stay, it stays ({r["stay"]:.1f} m)')
        check(r['call'] < 5 and r['cmd'] == 'follow', 'called, it comes to you')
        check(r['bit'] and r['foeDead'], f'set on a foe, the hound fights it down ({r["t"]} s)')
        check(r['xp'] > 0 and r['cmdAfter'] == 'follow', 'it learns from the fight and goes back to following')
        check(r['lvl'][1] > r['lvl'][0], f'a run of fights raises its bond level {r["lvl"]}')
        check(r['guardTarget'], 'on guard, it goes for a foe near its post')

        # ---- a wild horse: tame it and ride it ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {}; const P = __an.P();
          const hz = __an.wild('horse'); o.found = !!hz; if (!hz) return o;
          F.goodsAdd('apple', 10, true);
          __an.near(hz, 3.0); hz.ai.flee = null;
          const T = A.anTrust(hz); o.need = T.need;
          let k = 0; while (hz.tame.owner === 'wild' && k++ < 10) { P.combatUntil = 0; __an.near(hz, 3.0); hz.ai.flee = null; __an.feed(hz); }
          o.owner = hz.tame.owner; o.crowd = hz.crowd; o.coat = hz.tame.tr.coat;
          o.coatB = hz.look.colB;
          // R beside it: into the saddle, with its own coat and pace
          hz.tame.tr.speed = 1.2;
          __an.near(hz, 2); P.combatUntil = 0; H.UI.modal = null; F.toggleMount();
          o.mounted = !!P.mount; o.mCrowd = P.mount && P.mount.crowd; o.mCoat = P.mount && P.mount.coat; o.entGone = !H.ENT.includes(hz);
          // ride: faster than the realm's horse by its speed trait
          const x0 = P.x; H.INPUT.keys.add('KeyW'); H.simulate(2); H.INPUT.keys.delete('KeyW'); o.rode = Math.hypot(P.x - x0, 0) + 0;
          F.dismount(P);
          const back = __an.mine('horse')[0]; o.back = back ? __an.sum(back) : null; o.backDist = back ? Math.hypot(back.x - P.x, back.z - P.z) : -1;
          return o; })()""")
        print('horse', json.dumps(r))
        check(r.get('found'), 'a wild horse to tame')
        check(r.get('owner') == 'player' and r.get('crowd') == 'horseTack', 'the wild horse is yours, saddled')
        check(r.get('mounted') and r.get('mCrowd') == 'horseTack' and r.get('mCoat') == r.get('coat') and r.get('entGone'), 'R beside it puts you in its saddle, in its own coat')
        check(r.get('back') and r.get('backDist') < 4, 'stepping down leaves it standing beside you')

        # ---- livestock: buy, keep in the common, collect over simulated time ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {}; const P = __an.P();
          const pen = A.A.pens.find((p) => p.owner === 'town' && p.realm === 0);
          H.INV.gold = 500;
          for (const [k, s] of [['sheep', 'f'], ['cattle', 'f'], ['hen', 'f'], ['hen', 'f']]) A.anBuy(k, s, pen, A.AKIND[k].price[1]);
          o.gold = H.INV.gold;
          const mine = A.anMine().filter((e) => A.AKIND[e.tame.k].live);
          for (const e of mine) { e.tame.prod = { wool: 0, milk: 0, egg: 0 }; e.tame.mood = 0.9; e.tame.tr.yield = 1.2; }
          H.teleport(pen.gateOut.x + 4, pen.gateOut.z + 4);
          const eggs0 = A.A.eggsLaid || 0;
          for (let i = 0; i < 10; i++) { H.simulate(50); for (const e of mine) e.tame.mood = Math.max(e.tame.mood, 0.8); }
          o.inPen = mine.filter((e) => A.penHas(pen, e.x, e.z)).length; o.n = mine.length;
          const ewe = mine.find((e) => e.tame.k === 'sheep'), cow = mine.find((e) => e.tame.k === 'cattle');
          o.wool = ewe.tame.prod.wool; o.milk = cow.tame.prod.milk; o.crowd = ewe.crowd;
          o.eggs = (A.A.eggsLaid || 0) - eggs0;
          F.goodsAdd('tool_shears', 1, true);
          const w0 = F.goodsCount('wool'), m0 = F.goodsCount('milk');
          A.anShear(ewe); A.anMilk(cow);
          o.gotWool = F.goodsCount('wool') - w0; o.gotMilk = F.goodsCount('milk') - m0; o.shorn = ewe.crowd;
          o.manure = pen.manure;
          // a paddock of your own
          F.goodsAdd('fence_kit', 1, true);
          let spot = null;
          for (let a = 0; a < 6.28 && !spot; a += 0.4) for (let d = 30; d < 90 && !spot; d += 10) { const x = pen.x + Math.cos(a) * d, z = pen.z + Math.sin(a) * d; if (!A.penSiteOk(x, z, 0, 6, 4.5)) spot = [x, z]; }
          o.spot = !!spot;
          if (spot) {
            // stand so the paddock-to-be lies in front of you
            H.teleport(spot[0], spot[1] + 6.7); P.yaw = Math.PI; A.anMarkStart();
            const S = A.anMarkSpot(); o.markOk = !A.penSiteOk(S.x, S.z, S.yaw, S.hw, S.hd);
            const own = A.anMarkConfirm(); o.built = !!own && own.owner === 'player';
            if (own) {
              A.anCommand(ewe, 'pen', own); o.eweFrom = Math.round(Math.hypot(ewe.x - own.x, ewe.z - own.z)); let i = 0; for (; i < 24 && !A.penHas(own, ewe.x, ewe.z); i++) H.simulate(5); o.eweT = i * 5; o.eweAt = Math.round(Math.hypot(ewe.x - own.x, ewe.z - own.z)); o.eweIn = A.penHas(own, ewe.x, ewe.z);
              o.colliders = own.colliders.length;
            }
          }
          return o; })()""")
        print('livestock', json.dumps(r))
        check(r['gold'] == 500 - 25 - 45 - 12 and r['n'] == 4, "stock is bought at the herder's board")
        check(r['inPen'] == r['n'], 'the bought stock stays in the common')
        check(r['wool'] >= 1 and r['milk'] >= 1 and r['eggs'] >= 2, f'over time: a full fleece, milk, eggs ({r["eggs"]})')
        check(r['gotWool'] >= 2 and r['gotMilk'] >= 1 and r['shorn'] == 'sheepShorn', 'shearing gives wool (and a shorn sheep), milking gives milk')
        check(r['manure'] > 1, 'manure builds up in the pen')
        check(r.get('built') and r.get('colliders', 0) >= 8, 'a paddock of your own, fenced, with a trough, rack and shed')
        check(r.get('eweIn'), f'sent to the paddock, the ewe walks in through the gate ({r.get("eweFrom")} m in {r.get("eweT")} s)')

        # ---- breeding over two generations ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {}; const P = __an.P();
          const pen = A.A.pens.find((p) => p.owner === 'town' && p.realm === 0);
          const mk = (sex, y) => { const rec = A.anRecord('sheep', { owner: 'player', sex, cmd: 'pen', pen: pen.id }); rec.tr.yield = y; rec.tr.al = sex === 'm' ? [1, 1] : [0, 2]; rec.mood = 1; rec.hunger = 1; rec.breedAt = 0; const c = pen.x, d = pen.z; return A.anSpawn(rec, c + (sex === 'm' ? 1 : -1), d); };
          const ram = mk('m', 1.5), ewe = mk('f', 1.45);
          let t = 0; while (!ewe.tame.preg && t < 120) { ram.tame.mood = ewe.tame.mood = 1; ram.tame.hunger = ewe.tame.hunger = 1; ewe.x = ram.x + 1; ewe.z = ram.z; H.simulate(2); t += 2; }
          o.paired = !!ewe.tame.preg; o.sire = ewe.tame.preg && ewe.tame.preg.sire.name === ram.tame.name;
          if (ewe.tame.preg) ewe.tame.preg.left = 1;
          H.simulate(3);
          const kids = A.A.list.filter((e) => e.tame && e.tame.ma && e.tame.ma.aid === ewe.tame.aid);
          o.kids = kids.map((e) => __an.sum(e));
          if (!kids.length) return o;
          const k0 = kids[0];
          o.s0 = k0.scale; o.adultScale = A.anScale({ ...k0.tame, age: 1e6 });
          k0.tame.age = A.AKIND.sheep.grow * 0.5; H.simulate(2); o.s1 = k0.scale;
          // grown: the young pair with a mate of their own generation
          for (const e of kids) e.tame.age = A.AKIND.sheep.grow + 1;
          H.simulate(2);
          o.grown = kids.every((e) => A.anAdult(e.tame));
          // a second generation: a grown lamb with a fresh mate
          const g1 = kids[0];
          const mate = A.anSpawn(A.anRecord('sheep', { owner: 'player', sex: g1.tame.sex === 'm' ? 'f' : 'm', cmd: 'pen', pen: pen.id, gen: 1, tr: A.anInherit(ram.tame.tr, ewe.tame.tr) }), g1.x + 1, g1.z);
          const fem = g1.tame.sex === 'f' ? g1 : mate, male = fem === g1 ? mate : g1;
          fem.tame.breedAt = 0; fem.tame.preg = null;
          t = 0; while (!fem.tame.preg && t < 120) { for (const e of [fem, male]) { e.tame.mood = 1; e.tame.hunger = 1; } fem.x = male.x + 1; fem.z = male.z; H.simulate(2); t += 2; }
          if (fem.tame.preg) fem.tame.preg.left = 1;
          H.simulate(3);
          const g2 = A.A.list.filter((e) => e.tame && e.tame.ma && e.tame.ma.aid === fem.tame.aid);
          o.g2 = g2.map((e) => __an.sum(e));
          // selection: the mean yield of many young of two high-yield parents stays high; of two poor ones, low
          const hi = [], lo = [];
          for (let i = 0; i < 200; i++) { hi.push(A.anInherit(ram.tame.tr, ewe.tame.tr).yield); lo.push(A.anInherit({ ...ram.tame.tr, yield: 0.7 }, { ...ewe.tame.tr, yield: 0.75 }).yield); }
          o.meanHi = hi.reduce((a, b) => a + b) / hi.length; o.meanLo = lo.reduce((a, b) => a + b) / lo.length;
          // dappled shows only from both parents; patched from either
          let dap = 0, pat = 0; for (let i = 0; i < 400; i++) { const t2 = A.anInherit({ ...ewe.tame.tr, al: [2, 2] }, { ...ram.tame.tr, al: [2, 0] }); if (A.anExpress(t2.al) === 2) dap++; const t3 = A.anInherit({ ...ewe.tame.tr, al: [1, 1] }, { ...ram.tame.tr, al: [0, 0] }); if (A.anExpress(t3.al) === 1) pat++; }
          o.dap = dap / 400; o.pat = pat / 400;
          // the card shows the traits and the parentage
          A.openAnimalCard(g2[0] || kids[0]); const body = document.getElementById('dlg-body').innerHTML;
          o.card = body.includes('sire') && body.includes('dam') && body.includes('Yield') && body.includes('Generation');
          window.__cardId = (g2[0] || kids[0]).id;
          return o; })()""")
        print('breeding', json.dumps(r)[:1500])
        check(r.get('paired') and r.get('sire'), 'a fed, content ram and ewe pair')
        kids = r.get('kids') or []
        check(len(kids) >= 1 and all(k['age'] < 10 and k['gen'] == 1 and k['ma'] and k['pa'] for k in kids), f'young are born with their dam and sire ({len(kids)})')
        check(kids and r['s0'] < r['s1'] < r['adultScale'] + 1e-6 and r['s0'] < 0.6 * r['adultScale'], f'the young grow: {r.get("s0")} -> {r.get("s1")} -> {r.get("adultScale")}')
        check(r.get('grown'), 'and grow up')
        check(kids and all(abs(k['tr']['yield'] - 1.475) < 0.25 for k in kids), 'the young inherit yield near their parents')
        g2 = r.get('g2') or []
        check(len(g2) >= 1 and all(k['gen'] == 2 for k in g2), f'a second generation ({len(g2)})')
        check(r.get('meanHi', 0) > 1.35 and r.get('meanLo', 9) < 0.85, f'breeding the best makes better stock (means {r.get("meanHi", 0):.2f} vs {r.get("meanLo", 0):.2f})')
        check(0.35 < r.get('dap', 0) < 0.65 and r.get('pat', 0) > 0.9, f'patterns pass on as hidden traits (dappled {r.get("dap")}, patched {r.get("pat")})')
        check(r.get('card'), 'the animal card shows traits, generation, dam and sire')

        if SHOTS:
            # the page's own frame loop stops here (see SHOT_SETUP); one frame behind the card
            await page.evaluate("(() => { if (!window.__rafOrig) { window.__rafOrig = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; } __hm.frame(1 / 30); return 0; })()")
            await page.screenshot(path=OUT + 'animals_card.png', timeout=300000)
            print('shot animals_card.png', flush=True)
        await page.evaluate("__an.A.openAnimals(); 0")
        r = await page.evaluate("""(() => { const b = document.getElementById('dlg-body').innerHTML; document.getElementById('dialog').hidden = true; __hm.UI.modal = null; __hm.animals.A.dlg = false; return { list: (b.match(/an-item/g) || []).length }; })()""")
        check(r['list'] >= 6, f'the animals list (K) shows your animals ({r["list"]})')

        # ---- save and load ----
        r = await page.evaluate("""(() => { const { H, A, F } = __an; const o = {};
          const before = A.anMine().map((e) => __an.sum(e)).sort((a, b) => a.aid - b.aid);
          const s = F.buildSave(); const json = JSON.stringify(s); o.size = json.length; o.partSize = JSON.stringify(s.char.x.animals).length;
          const data = JSON.parse(json).char.x;
          A.animalsLoad(undefined); o.oldSave = A.anMine().length + A.A.pens.filter((p) => p.owner === 'player').length;
          F.savePartsLoad('char', data);
          const after = A.anMine().map((e) => __an.sum(e)).sort((a, b) => a.aid - b.aid);
          o.n = [before.length, after.length];
          o.same = before.every((b, i) => after[i] && after[i].name === b.name && after[i].k === b.k && after[i].sex === b.sex && after[i].gen === b.gen && Math.abs(after[i].tr.yield - b.tr.yield) < 0.002 && JSON.stringify(after[i].tr.coat) === JSON.stringify(b.tr.coat) && (after[i].ma || {}).name === (b.ma || {}).name);
          o.pens = A.A.pens.filter((p) => p.owner === 'player').length;
          o.hound = !!A.anMine().find((e) => e.tame.k === 'hound');
          // a damaged save
          A.animalsLoad({ v: 1, list: [{ k: 'sheep', n: '<b>x</b>', s: 'q', tr: { coat: ['a', 2, 3], size: 99 }, c: 'dance', x: 'nan' }, { k: 'dragon' }, null, 7], pens: [{ x: 'no' }, { x: 3, z: 4, hw: 999 }] });
          const bad = A.anMine().map((e) => __an.sum(e)); o.bad = bad.length; o.badName = bad[0] && bad[0].name; o.badSize = bad[0] && bad[0].tr.size;
          F.savePartsLoad('char', data);
          o.errors = H.errors.slice();
          return o; })()""")
        print('save', json.dumps(r))
        check(r['n'][0] == r['n'][1] and r['same'], f'your animals come back from the save with their names, traits and parentage ({r["n"]})')
        check(r['pens'] >= 1 and r['hound'], 'paddocks and companions come back too')
        check(r['oldSave'] == 0, 'an old save without animals loads cleanly')
        check(r['bad'] == 1 and '<' not in (r['badName'] or '') and r['badSize'] <= 1.3, 'a damaged save is cleaned')
        print(f'save part {r["partSize"]} bytes of {r["size"]}')

        if SHOTS:
            await shots(page)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()

SHOT_SETUP = """(() => { const { H, A, F } = __an;
  H.setTod(0.42); H.dbg.WEATHER.mode = 'clear';
  // the page's own frame loop is stopped so that under software WebGL each picture costs one frame, drawn here
  if (!window.__rafOrig) { window.__rafOrig = window.requestAnimationFrame; window.requestAnimationFrame = () => 0; }
  window.__view = (x, y, z, tx, ty, tz) => { H.UI.modal = 'menu'; document.getElementById('menu').hidden = true; document.getElementById('hud').hidden = true; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); H.frame(1 / 30); };
  window.__live = (s) => { H.UI.modal = null; H.CAM.mode = 'play'; document.getElementById('hud').hidden = false; H.simulate(s); };
  return 0; })()"""

async def shots(page):
    await page.evaluate(SHOT_SETUP)
    # a hound following the player across the downs
    await page.evaluate("""(() => { const { H, A, F } = __an; const P = __an.P(); const hd = A.anMine().find((e) => e.tame.k === 'hound');
      A.anCommand(hd, 'follow'); for (const e of A.anMine()) if (e !== hd && e.tame.cmd === 'follow') A.anCommand(e, 'stay');
      H.INPUT.keys.add('KeyW'); __live(3); H.INPUT.keys.delete('KeyW');
      const y = F.heightAt(P.x, P.z); const a = P.yaw + 2.3;
      __view(P.x + Math.sin(a) * 6, y + 2.4, P.z + Math.cos(a) * 6, (P.x + hd.x) / 2, y + 0.7, (P.z + hd.z) / 2); return 0; })()""")
    await page.screenshot(path=OUT + 'animals_hound.png', timeout=300000)
    print('shot animals_hound.png', flush=True)
    # the flock grazing in the common, cattle and hens
    for name, kind, d, h, th in [('animals_flock', 'sheep', 7.5, 2.4, 0.4), ('animals_cattle', 'cattle', 10, 2.8, 0.9), ('animals_hens', 'hen', 1.4, 0.55, 0.2)]:
        await page.evaluate("""(([kind, d, h, th]) => { const { H, A, F } = __an; const pen = A.A.pens.find((p) => p.owner === 'town' && p.realm === 0);
          __live(4);
          const list = A.A.list.filter((e) => e.tame.pen === pen.id && e.tame.k === kind && e.alive);
          let cx = 0, cz = 0; const ref = kind === 'hen' ? list.slice(0, 1) : list; for (const e of ref) { cx += e.x / ref.length; cz += e.z / ref.length; }
          const P = __an.P(); const a = Math.atan2(cx - pen.x, cz - pen.z) + 0.9;
          const x = cx + Math.sin(a) * d, z = cz + Math.cos(a) * d;
          __view(x, F.heightAt(x, z) + h, z, cx, F.heightAt(cx, cz) + th, cz); return 0; })(%s)""" % json.dumps([kind, d, h, th]))
        await page.screenshot(path=OUT + name + '.png', timeout=300000)
        print('shot', name + '.png', flush=True)
    # a mare with her foal
    await page.evaluate("""(() => { const { H, A, F } = __an; const P = __an.P();
      const pen = A.A.pens.find((p) => p.owner === 'town' && p.realm === 0);
      const x0 = pen.gateOut.x + 10, z0 = pen.gateOut.z + 8;
      const mare = A.anSpawn(A.anRecord('horse', { owner: 'player', sex: 'f', cmd: 'stay' }), x0, z0);
      mare.tame.stay = { x: mare.x, z: mare.z };
      const foal = A.anSpawn(A.anRecord('horse', { owner: 'player', sex: 'm', age: 120, cmd: 'stay', ma: { aid: mare.tame.aid, name: mare.tame.name }, tr: A.anInherit(mare.tame.tr, mare.tame.tr) }), x0 + 1.6, z0 + 0.6);
      foal.tame.stay = { x: foal.x, z: foal.z };
      __live(2);
      const a = 2.0, cx = (mare.x + foal.x) / 2, cz = (mare.z + foal.z) / 2;
      __view(cx + Math.sin(a) * 6.5, F.heightAt(cx, cz) + 2.0, cz + Math.cos(a) * 6.5, cx, F.heightAt(cx, cz) + 1.0, cz); return 0; })()""")
    await page.screenshot(path=OUT + 'animals_mare_foal.png', timeout=300000)
    print('shot animals_mare_foal.png', flush=True)

asyncio.run(main())
