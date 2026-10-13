"""[balance8] The late game's fights weighed, and what a run of duels leaves behind (version 17).
usage: python3 tools/tests/balance8.py [risen] [vet] [drift] [levels=40,45,50] [bots=simple,skilled] [realms=0,1,2]
                                       [cls=warrior,archer,mage,priest] [reps=N] [vreps=N] [preps=N]
  risen    each calling, played by the simple and the skilled bot with fair gear and three healing draughts, against the
           top risen camp of a homeland at each level: the time to bring its champion down, whether the fighter fell,
           its lowest health, the draughts drunk, how often the champion broke the ground and how often that struck
  vet      what a veteran's boons and a worn name are worth: mirror duels of each calling's skilled bot against itself, one
           side carrying the thirty steps of boons (5% health, 5% harder, 10% power, 5% critical blows, 5% softer) and
           then a name as well (Legend of the March: 3% health, 3% harder), every other duel made the other way round
           (the side made first acts first); and the time each calling's skilled bot holds out against duels.py's pack
           with and without them. The boons are the player's alone in the game (10l_late.js): here they are given to a
           bot by the same numbers (its health, harm, power and critical blows, and the harm it takes), so many duels
           can be fought at once
  drift    [balance8] the skilled warrior's three pairings at 50 in fresh arenas, then the same after the run's clock has
           moved on (nothing fought meanwhile), then after a run of duels: what a run leaves behind
The page's own frame loop stops while it measures (nothing is drawn)."""
import json, asyncio, sys, os, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
from classes import BAL_JS

ARGS = sys.argv[1:]
def arg(k, d):
    return next((a.split('=', 1)[1] for a in ARGS if a.startswith(k + '=')), d)
LEVELS = [int(x) for x in arg('levels', '40,45,50').split(',')]
BOTS = arg('bots', 'simple,skilled').split(',')
REALMS = [int(x) for x in arg('realms', '0').split(',')]
CLS = arg('cls', 'warrior,archer,mage,priest').split(',')
REPS = int(arg('reps', '1'))
VREPS = int(arg('vreps', '24'))
PREPS = int(arg('preps', '3'))
FAILS = []

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

B8_JS = r"""
window.B8 = {
  H: __hm, F: __hm.fn, L: __hm.late,
  fresh(cls, lvl, realm = 0) {
    const H = this.H, F = this.F;
    if (H.GAME.player) F.newCharacter();
    H.start({ realm, cls, level: lvl });
    const P = H.GAME.player;
    H.bal.applyFairGear(P, lvl); P.hp = P.maxHp; P.power = P.maxPower;
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; H.fn.weatherAdvance(60);
    H.simulate(0.3);
    return P;
  },
  risen() { return this.H.CAMPS.filter((c) => this.L.late2RiseK(c) >= 0); },
  clearAround(x, z, r, keep) { for (const e of this.H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && !(keep && keep.has(e.id)) && Math.hypot(e.x - x, e.z - z) < r) { e.damagers = null; this.F.killEnt(e, null); this.F.removeEnt(e); } },
  // a fight: the player as a bot of this kind against the top risen camp of its homeland
  fight(cls, lvl, realm, kind) {
    const P = this.fresh(cls, lvl, realm), H = this.H, F = this.F, L = this.L.LATE2;
    const camp = this.risen().filter((c) => c.realm === P.faction).sort((a, b) => this.L.late2RiseK(b) - this.L.late2RiseK(a))[0];
    // the camp as it stands for a fighter of this level: its champion whole and its pack about it
    let C = F.getEnt(camp.eliteId); if (!C || !C.alive) { F.spawnMob(camp, true); C = F.getEnt(camp.eliteId); }
    const keep = new Set(camp.members); this.clearAround(camp.x, camp.z, 60, keep);
    H.bal6.cleanArena(camp.x, camp.z, 45, new Set());
    const a = Math.random() * 6.28; H.teleport(C.x + Math.cos(a) * 16, C.z + Math.sin(a) * 16);
    H.INV.potions = 3; P.hp = P.maxHp; P.power = P.maxPower; P.buffs.length = 0;
    const s0 = { ...L.stats };
    H.bal.botMake(P, kind, { x: camp.x, z: camp.z, r: 32 }); P.target = C.id;
    const foes = new Set(camp.members); let t = 0, champT = null, minHp = 1;
    for (; t < 180 && P.alive; t += 1) {
      H.simulate(1); minHp = Math.min(minHp, P.hp / P.maxHp); for (const id of camp.members) foes.add(id);
      if (!C.alive && champT == null) champT = t + 1;
      if (!P.target || !F.getEnt(P.target) || !F.getEnt(P.target).alive) { const n = [...foes].map(F.getEnt).filter((e) => e && e.alive && Math.hypot(e.x - P.x, e.z - P.z) < 40)[0]; if (n) P.target = n.id; else if (!C.alive) break; }
    }
    P.bot = null;
    const out = { cls, kind, lvl, realm, champ: C.name, clvl: C.level, champHp: Math.round(C.maxHp), champLeft: C.alive ? +(C.hp / C.maxHp).toFixed(2) : 0, php: Math.round(P.maxHp), champT, t, alive: P.alive, minHp: +minHp.toFixed(2), potions: 3 - H.INV.potions,
      wrath: L.stats.wrath - s0.wrath, hits: L.stats.wrathHits - s0.wrathHits, broken: (L.stats.broken || 0) - (s0.broken || 0), kinds: (L.stats.kinds || 0) - (s0.kinds || 0), rallies: L.stats.rallies - s0.rallies, errors: H.errors.length };
    if (P.alive) { P.hp = P.maxHp; }
    return out;
  },
  // the boons of thirty steps of veterancy and a worn name, given to a bot by their own numbers (10l_late.js: late2Stats,
  // late2HarmMult): health, power and critical blows on the body, harm dealt and taken through its measure
  vet(e, name) {
    const B = { hp: 0.05, dmg: 0.05, pow: 0.10, crit: 0.05, dr: 0.05 };
    const Nm = name ? { hp: 0.03, all: 0.03 } : { hp: 0, all: 0 };
    e.maxHp *= 1 + B.hp + Nm.hp; e.hp = e.maxHp;
    e.maxPower *= 1 + B.pow; e.power = e.maxPower;
    e.critBonus = (e.critBonus || 0) + B.crit;
    e.dmgMult *= 1 + B.dmg + Nm.all;
    e.drBase = 1 - (1 - e.drBase) * (1 - B.dr);
    e._vet = name ? 'name' : 'boons';
    return e;
  },
  // duels in arenas far apart, each arena a queue (duels.py's way): [cls, vetA ('', 'boons', 'name'), flip]
  queue(lvl, list) {
    CB.wipe();
    const S = CB.arenas(Math.min(9, list.length));
    this.S = S; this.lvl = lvl; this.Q = list.slice(); this.done = []; this.slots = S.map(() => null); this.nMade = 0;
    CB.A = [];
    for (let i = 0; i < S.length; i++) this.fill(i);
    return S.length;
  },
  fill(i) {
    if (!this.Q.length) { this.slots[i] = null; return; }
    const q = this.Q.shift(), s = this.S[i], lvl = this.lvl;
    // [cls, vet, n] (vet duels: the same calling on both sides, skilled) or [a, ka, b, kb, n] (any duel)
    const [a, ka, b, kb, n, v] = q.length === 3 ? [q[0], 'skilled', q[0], 'skilled', q[2], q[1]] : [q[0], q[1], q[2], q[3], q[4], ''];
    const bFirst = (this.nMade = this.nMade + 1) % 2 === 0; // the side made first acts first: every other duel the other way round
    const r0 = (Math.floor(n / 2)) % 3, r1 = (Math.floor(n / 2) + 1) % 3, ra = n % 2 ? r1 : r0, rb = n % 2 ? r0 : r1;
    let ua, ub;
    if (bFirst) { ub = CB.unit(rb, b, lvl, s.x + 9, s.z, kb, 18); ua = CB.unit(ra, a, lvl, s.x - 9, s.z, ka, 18); }
    else { ua = CB.unit(ra, a, lvl, s.x - 9, s.z, ka, 18); ub = CB.unit(rb, b, lvl, s.x + 9, s.z, kb, 18); }
    if (v) this.vet(ua, v === 'name');
    ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 18 };
    ua.target = ub.id; ub.target = ua.id;
    const D = { kind: 'duel', bot: ka, a: a + ':A', b: b + ':B', ua, ub, t0: this.H.GAME.t, c: q.length === 3 ? a : a + '-' + b + ':' + ka, v, arena: i };
    this.slots[i] = D; CB.A.push(D);
  },
  // [balance8] what a run leaves in its arenas and in the world: a look at each arena and at the lists
  snap(h0) {
    const H = this.H, F = this.F, S = CB.wide || [], W = F.W, N = H.nature.NATURE, C = H.cls.CLS;
    const ar = S.slice(0, 9).map((s, k) => {
      let blocked = 0, dh = 0, cells = 0;
      for (let dz = -20; dz <= 20; dz += 2) for (let dx = -20; dx <= 20; dx += 2) { if (dx * dx + dz * dz > 400) continue; cells++; if (!F.isWalkable(s.x + dx, s.z + dz)) blocked++; const h = F.heightAt(s.x + dx, s.z + dz); if (h0) dh = Math.max(dh, Math.abs(h - h0[k][cells - 1])); }
      const trees = W.trees.filter((t) => Math.hypot(t.x - s.x, t.z - s.z) < 30);
      return { blocked, dh: +dh.toFixed(2), trees: trees.length, felled: trees.filter((t) => t.felled).length, logs: trees.filter((t) => t.log).length, burning: trees.filter((t) => t.fire > 0).length };
    });
    return { t: Math.round(H.GAME.t), ar, ents: H.ENT.length, fires: H.dbg.FIRES.length, proj: H.bal.PROJ.length, arrows: C.arrows.length, snares: C.snares.length, grounds: C.grounds.length, runes: C.runes.length, steam: C.steam.length, ice: C.ice.length, grassFire: N.fire.size, craters: N.craters.length, felled: N.felled.length, loot: H.LOOT.length };
  },
  heights() { const F = this.F, S = CB.wide || []; return S.slice(0, 9).map((s) => { const L = []; for (let dz = -20; dz <= 20; dz += 2) for (let dx = -20; dx <= 20; dx += 2) { if (dx * dx + dz * dz > 400) continue; L.push(F.heightAt(s.x + dx, s.z + dz)); } return L; }); },
  step(sec, cap) {
    const H = this.H;
    for (let k = 0; k < sec; k++) {
      H.simulate(1); CB.breakFires(CB.breakR || 34);
      CB.status(cap);
      for (let i = 0; i < this.slots.length; i++) {
        const D = this.slots[i];
        if (!D || !D.res) continue;
        this.done.push({ c: D.c, v: D.v, win: D.res.win === D.a ? 1 : D.res.win === null ? 0.5 : 0, t: D.res.t, arena: D.arena });
        const gone = new Set([D.ua.id, D.ub.id]);
        for (const e of [D.ua, D.ub]) { e.damagers = null; if (e.alive) H.fn.killEnt(e, null); H.fn.removeEnt(e); }
        H.bal6.cleanArena(this.S[i].x, this.S[i].z, 36, gone);
        CB.wholeGrass(this.S[i].x, this.S[i].z, 36);
        this.fill(i);
      }
      CB.A = CB.A.filter((D) => !D.res);
      if (!this.slots.some(Boolean)) break;
    }
    return { open: this.slots.filter(Boolean).length + this.Q.length, done: this.done.length, errors: H.errors.length };
  },
  // the pack (classes.py's): each calling's skilled bot, with the boons or without, against the endless pack
  packs(lvl, rep) {
    CB.wipe();
    const S = CB.spots(8);
    CB.A = [];
    let i = 0;
    for (const v of ['', 'boons']) for (const c of CB.CLS) {
      const s = S[i++], u = CB.unit(rep % 3, c, lvl, s.x, s.z, 'skilled', 22);
      if (v) this.vet(u, false);
      const p = CB.pack(lvl, s.x + 11, s.z, u);
      CB.A.push({ kind: 'pack', bot: 'skilled', cls: c + ':' + (v || 'plain'), u, p, lvl, t0: this.H.GAME.t, hp0: u.maxHp });
    }
    return S.length;
  },
};
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        page.on('crash', lambda *_: (print('PAGE CRASHED (out of memory?)', flush=True), os._exit(3)))
        await page.set_viewport_size({'width': 320, 'height': 180})
        await page.evaluate("() => {" + BAL_JS + B8_JS + "; return 0; }")
        await page.evaluate("CB.arenas = (n) => CB.spotsWide(n, 80, true); CB.lastFall = true; CB.packOpen = true; window.requestAnimationFrame = () => 0; 0")
        T0 = time.time()

        if 'risen' in ARGS:
            rows = []
            for lvl in LEVELS:
                for realm in REALMS:
                    for cls in CLS:
                        for kind in BOTS:
                            for rep in range(REPS):
                                r = await page.evaluate(f"B8.fight('{cls}', {lvl}, {realm}, '{kind}')")
                                rows.append(r)
                                print(f"  {lvl} {cls:<8} {kind:<8} vs {r['champ']} ({r['clvl']}, {r['champHp']} health): " + (f"down in {r['champT']} s" if r['champT'] is not None else f"stands at {r['champLeft']:.0%} after {r['t']} s") + f", {'alive' if r['alive'] else 'FELL'}, lowest {r['minHp']:.0%}, draughts {r['potions']}, wrath {r['wrath']} (struck {r['hits']}, broken {r['broken']}), its own way {r['kinds']}, rallies {r['rallies']} [{time.time() - T0:.0f}s]", flush=True)
            # the table: each calling by bot and level
            print('\nrisen champions (time to bring the champion down, s; x: the fighter fell; -: the champion stood after 180 s)', flush=True)
            for kind in BOTS:
                for realm in REALMS:
                    print(f'  {kind} bot, realm {realm}: ' + '   '.join(f"{lvl}: " + ', '.join(f"{c[:3]} " + ('x' if not r['alive'] else '-' if r['champT'] is None else str(r['champT'])) for c in CLS for r in rows if r['cls'] == c and r['kind'] == kind and r['lvl'] == lvl and r['realm'] == realm) for lvl in LEVELS), flush=True)
            check(not any(r['errors'] for r in rows), 'no errors in the fights')
            if os.environ.get('HM_BAL'): pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps(rows, indent=0))

        if 'vet' in ARGS:
            lvl = 50
            await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: 0, cls: 'warrior', level: {lvl} }}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.GAME.player.hp = 1e9; H.GAME.player.maxHp = 1e9; const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; H.fn.weatherAdvance(60); return 0; }})()")
            specs = [[c, v, n] for c in CLS for v in ('', 'boons', 'name') for n in range(VREPS)]
            await page.evaluate(f"B8.queue({lvl}, {json.dumps(specs)})")
            last = 0
            while True:
                r = await page.evaluate("B8.step(10, 60)")
                if r['done'] - last >= 36 or not r['open']: last = r['done']; print(f"  vet duels: {r['done']}/{len(specs)} [{time.time() - T0:.0f}s]", flush=True)
                if not r['open']: break
            done = await page.evaluate("B8.done")
            print('\nmirror duels at 50, skilled against skilled (wins of the side with the boons; every other duel made the other way round)', flush=True)
            for c in CLS:
                cells = []
                for v in ('', 'boons', 'name'):
                    L = [d for d in done if d['c'] == c and d['v'] == v]
                    cells.append(f"{v or 'none'} {sum(d['win'] for d in L):g}/{len(L)} ({sum(d['t'] for d in L) / max(1, len(L)):.0f} s)")
                print(f'  {c:<8} ' + '   '.join(cells), flush=True)
            res = {}
            for rep in range(PREPS):
                await page.evaluate(f"B8.packs({lvl}, {rep}); 0")
                while True:
                    r = await page.evaluate("CB.run(10, 150)")
                    if not r['open']: break
                for x in await page.evaluate("CB.results()"):
                    res.setdefault(x['cls'], []).append(x['surv'])
            print('\nthe pack at 50 (skilled bot, seconds held, survivors of 150 s counted 1.5 times; median of ' + str(PREPS) + ')', flush=True)
            med = lambda v: sorted(v)[len(v) // 2]
            for c in CLS:
                a, bb = res.get(c + ':plain', []), res.get(c + ':boons', [])
                if a and bb: print(f'  {c:<8} none {med(a):.0f} s {sorted(round(x) for x in a)}   boons {med(bb):.0f} s {sorted(round(x) for x in bb)}', flush=True)
            if os.environ.get('HM_BAL'): pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps({'duels': done, 'pack': res}, indent=0))

        if 'drift' in ARGS:
            # [balance8] the skilled warrior's pairings at 50 in fresh arenas, then after a run of simple duels at 50 in the
            # same arenas, with a look at what the run left behind in each arena and in the world
            lvl = 50
            await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: 0, cls: 'warrior', level: {lvl} }}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.GAME.player.hp = 1e9; H.GAME.player.maxHp = 1e9; const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; H.fn.weatherAdvance(60); return 0; }})()")
            await page.evaluate("CB.arenas(9); window.B8H0 = B8.heights(); 0")
            D = int(arg('dreps', '48'))
            war = [[a, 'skilled', b, 'skilled', n] for (a, b) in (('warrior', 'archer'), ('warrior', 'mage'), ('warrior', 'priest')) for n in range(D)]
            simple = [[a, 'simple', b, 'simple', n] for (a, b) in (('warrior', 'archer'), ('warrior', 'mage'), ('warrior', 'priest'), ('archer', 'mage'), ('archer', 'priest'), ('mage', 'priest')) for n in range(D)]
            async def run(specs, label):
                await page.evaluate(f"B8.queue({lvl}, {json.dumps(specs)})")
                last = 0
                while True:
                    r = await page.evaluate("B8.step(10, 60)")
                    if r['done'] - last >= 72 or not r['open']: last = r['done']; print(f"  {label}: {r['done']}/{len(specs)} [{time.time() - T0:.0f}s]", flush=True)
                    if not r['open']: break
                return await page.evaluate("B8.done")
            def table(done, label):
                print(f'  {label}: ' + '   '.join(f"{c} {sum(d['win'] for d in done if d['c'] == c):g}/{sum(1 for d in done if d['c'] == c)}" for c in sorted({d['c'] for d in done})) + f"   all {sum(d['win'] for d in done):g}/{len(done)}", flush=True)
                by = {}
                for d in done: by.setdefault(d['arena'], []).append(d['win'])
                print('    by arena: ' + ', '.join(f"{k}: {sum(v):g}/{len(v)}" for k, v in sorted(by.items())), flush=True)
            print('  snap fresh', json.dumps(await page.evaluate("B8.snap(window.B8H0)")), flush=True)
            if 'nofresh' not in ARGS:
                table(await run(war, 'fresh: the skilled warrior'), 'fresh')
                print('  snap', json.dumps(await page.evaluate("B8.snap(window.B8H0)")), flush=True)
            await run(simple, 'simple duels of every pair')
            print('  snap after the simple duels', json.dumps(await page.evaluate("B8.snap(window.B8H0)")), flush=True)
            table(await run(war, 'after a run: the skilled warrior'), 'after a run')
            print('  snap', json.dumps(await page.evaluate("B8.snap(window.B8H0)")), flush=True)

        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs, f'no runtime errors {errs}')
        for l in logs[:5]: print(l)
        await b.close()
        print(f'\n{len(FAILS)} failures' + (': ' + '; '.join(FAILS) if FAILS else ''), flush=True)

asyncio.run(main())
