"""[balance2] Gear that keeps up to level 50: the item curve, the item levels of drops (camp mobs, champions, soldiers,
keep lords, Cinderwing), the Barrow's chest and the Hollow King's hoard, and the merchants at levels 20, 35 and 50;
a named masterwork against a drop of its grade and level; old saves' items still loading with their own levels; and
the late game as hard as before: per blow, how many blows a player in fair gear needs to fell a foe of the level and
how many the foe needs to fell the player, with the old curve (gear to item level 24, no late toughness) and the new
(gear at the level, gearLateHarm in 06e_gearcurve.js), for each calling against a garrison warrior and a keep lord at
20, 35 and 50, the Hollow King at 28 and Cinderwing at 50.
usage: python3 tools/tests/loot.py"""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup
from playwright.async_api import async_playwright

FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js, quiet=False):
    r = await page.evaluate(js)
    if not quiet: print(label, json.dumps(r)[:2000], flush=True)
    return r

HELP = r"""
window.LT = {
  H: __hm, F: __hm.fn, G: __hm.gear, B: __hm.bal,
  async fresh(cls, lvl) {
    const H = this.H, F = this.F;
    if (H.GAME.player) F.newCharacter();
    await H.start({ realm: 0, cls, level: lvl });
    const P = H.GAME.player;
    P.hp = P.maxHp;
    return P;
  },
  // the item levels of everything that falls from n deaths of a body like o
  drops(o, n) {
    const H = this.H, G = this.G, P = H.GAME.player, out = [];
    for (let i = 0; i < n; i++) {
      G.LOOT.length = 0;
      const e = { kind: 'humanoid', x: P.x + 3, z: P.z, y: P.y, scale: 1, alive: false, buffs: [], ...o };
      G.rollLoot(e);
      for (const L of G.LOOT) if (L.item && !L.item.goods && L.item.slot !== 'junk') out.push(L.item.lvl);
    }
    G.LOOT.length = 0;
    return out;
  },
  range(a) { return a.length ? [Math.min(...a), Math.max(...a), +(a.reduce((s, v) => s + v, 0) / a.length).toFixed(1), a.length] : null; },
  // per blow: the share of a foe's health one of the player's blows takes, and of the player's one of the foe's
  blows(P, foe, n = 240) {
    const F = this.F, G = this.G;
    let dealt = 0, taken = 0;
    const st = P.cs ? P.cs.stance : null;
    for (let i = 0; i < n; i++) {
      foe.hp = foe.maxHp; P.hp = P.maxHp; foe.buffs.length = 0; P.buffs.length = 0;
      dealt += F.dealDamage(P, foe, G.computeDamage(P, foe, 1).d, { dot: true });
      foe.hp = foe.maxHp; P.hp = P.maxHp;
      taken += F.dealDamage(foe, P, G.computeDamage(foe, P, 1).d, { dot: true });
    }
    foe.hp = foe.maxHp; P.hp = P.maxHp;
    const kill = foe.maxHp / (dealt / n), die = P.maxHp / (taken / n);
    return { kill: +kill.toFixed(1), die: +die.toFixed(1), ratio: +(die / kill).toFixed(3), php: Math.round(P.maxHp), fhp: Math.round(foe.maxHp) };
  },
  // a whole set, as the old curve gave it (item level 24 at the grade of the level) or the new (at the level)
  wear(P, lvl, old) {
    const H = this.H, F = this.F, G = this.G, B = this.B;
    const g = old ? B.fairGear(P.cls, Math.min(lvl, G.GEAR_OLD_CAP), G.fairGrade(lvl)) : B.fairGear(P.cls, lvl);
    H.INV.eq = g.eq; F.applyGear(); P.hp = P.maxHp;
    return g.tot;
  },
  foe(realm, cls, lvl, role) {
    const P = this.H.GAME.player, F = this.F;
    const e = F.spawnRealmUnit(realm, cls, lvl, role, P.x + 40, P.z + 40);
    delete e.wlOff; e.ai.post = { x: e.x, z: e.z, leash: 0 }; e.testFoe = true; e.ai.nextAbility = 1e12;
    F.setupStats(e); e.hp = e.maxHp;
    return e;
  },
  clear() { for (const e of this.H.ENT.slice()) if (e.testFoe) { e.damagers = null; if (e.alive) this.F.killEnt(e, null); this.F.removeEnt(e); } },
  async compare(cls, lvl, foeOf) {
    const G = this.G;
    const P = await this.fresh(cls, lvl);
    const foe = foeOf(P);
    const out = {};
    for (const old of [true, false]) {
      G.GEAR_LATE.on = !old;
      const tot = this.wear(P, lvl, old);
      out[old ? 'old' : 'new'] = { ...this.blows(P, foe), dmg: Math.round(tot.dmg), hp: Math.round(tot.hp), arm: Math.round(tot.arm) };
    }
    G.GEAR_LATE.on = true;
    out.k = +(out.new.ratio / out.old.ratio).toFixed(3);
    out.kill = +(out.new.kill / out.old.kill).toFixed(3);
    this.clear();
    return out;
  },
};
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.evaluate("() => {" + HELP + "; return 0; }")

        # ---- the curve ----
        r = await ev(page, 'curve', """(() => { const G = __hm.gear;
          return { scale: [10, 20, 24, 30, 36, 40, 50].map((l) => [l, +G.itemScale(l).toFixed(2)]), K: [10, 20, 24, 28, 30, 35, 40, 45, 50, 54].map((l) => [l, +G.gearK(l).d.toFixed(3), +G.gearK(l).h.toFixed(3)]),
            fair: [10, 20, 30, 40, 50].map((l) => { const t = __hm.bal.fairGear('warrior', l).tot; return [l, Math.round(t.dmg), Math.round(t.hp), Math.round(t.arm)]; }) }; })()""")
        sc = dict((l, v) for l, v in r['scale'])
        check(abs(sc[24] - 10.6) < 1e-6 and abs(sc[20] - 9.0) < 1e-6, 'the item curve to 24 is as it was (itemScale 24 = 10.6)')
        check(sc[30] > sc[24] and sc[50] > sc[36] > sc[30] and sc[50] < 2 * sc[24], f'past 24 an item grows more gently ({sc[24]} at 24, {sc[50]} at 50)')
        K = {l: (d, h) for l, d, h in r['K']}
        check(K[10] == (1, 1) and K[24] == (1, 1), 'no late toughness to item level 24')
        check(1 < K[30][0] < K[40][0] < K[50][0] and 1 < K[30][1] < K[40][1] < K[50][1] and K[54] == K[50], 'late toughness grows with the level and stops at 50')
        fair = {l: (d, h, a) for l, d, h, a in r['fair']}
        check(fair[50][2] <= 40 and fair[50][1] > fair[30][1] > fair[20][1], f'fair gear follows the level to 50 (armour {fair[50][2]} under its cap)')

        # ---- drops, hoards and merchants at 20, 35 and 50 ----
        table = {}
        for L in (20, 35, 50):
            r = await ev(page, f'drops {L}', f"""(async () => {{ const T = LT, H = T.H, G = T.G, P = await T.fresh('warrior', {L}); const M = H.FACTION_MONSTER, L = {L};
              const out = {{}};
              out.mob = T.range(T.drops({{ faction: M, mobType: 'bandit', role: 'mob', level: L }}, 60));
              out.champion = T.range(T.drops({{ faction: M, mobType: 'bandit', role: 'mob', level: L, elite: true }}, 12));
              out.soldier = T.range(T.drops({{ faction: 1, role: 'soldier', cls: 'warrior', level: L }}, 160));
              out.lord = T.range(T.drops({{ faction: 1, role: 'lord', cls: 'warrior', level: L + 4 }}, 12));
              out.dragon = T.range(T.drops({{ kind: 'dragon', faction: M, mobType: 'dragon', role: 'boss', level: Math.max(24, L + 4) }}, 6));
              // the Barrow: the burial chest and the Hollow King's hoard
              const chest = (id) => {{ const ch = H.DUN.chests.find((c) => c.id === id); ch.ready = true; ch.opened = false; G.LOOT.length = 0; G.openChest(ch); H.simulate(0.6); const l = G.LOOT.filter((x) => !x.item.goods).map((x) => x.item.lvl); G.LOOT.length = 0; return l; }};
              let crypt = [], vault = []; for (let i = 0; i < 4; i++) {{ crypt = crypt.concat(chest('crypt')); vault = vault.concat(chest('vault')); }}
              out.crypt = T.range(crypt); out.vault = T.range(vault);
              H.REALMS[0].stock = null; out.shop = T.range(G.merchantStock(H.REALMS[0]).items.map((it) => it.lvl));
              out.req = G.itemReq({{ lvl: Math.min(50, L + 3) }});
              return out; }})()""")
            table[L] = r
            near = lambda rg, lo, hi: rg is not None and rg[0] >= lo and rg[1] <= hi
            cap = lambda v: min(50, v)
            check(near(r['mob'], cap(L - 1), cap(L + 1)), f'level {L}: camp foes drop gear of about their level ({r["mob"]})')
            check(near(r['champion'], cap(L), cap(L + 2)) and r['champion'][2] > r['mob'][2] - (0.6 if L == 50 else 0), f'level {L}: a champion\'s spoils a level above it ({r["champion"]})')
            check(near(r['soldier'], cap(L - 1), cap(L + 1)), f'level {L}: a soldier\'s gear of its level ({r["soldier"]})')
            check(near(r['lord'], cap(L + 3), cap(L + 5)), f'level {L}: a keep lord\'s gear of its level ({r["lord"]})')
            check(near(r['dragon'], cap(L + 1), cap(L + 3)), f'level {L}: Cinderwing\'s hoard a little above you ({r["dragon"]})')
            check(near(r['crypt'], cap(L), cap(L)) and near(r['vault'], cap(L + 2), cap(L + 2)), f'level {L}: the burial chest at your level, the Hollow King\'s hoard two above ({r["crypt"]}, {r["vault"]})')
            check(near(r['shop'], cap(L), cap(L)), f'level {L}: merchants sell at your level ({r["shop"]})')
        print('\nitem levels (min, max, mean, n):')
        for L, r in table.items():
            print(f"  {L:>2}  " + '  '.join(f"{k} {v[0]}-{v[1]}" for k, v in r.items() if isinstance(v, list)), flush=True)

        # ---- a named masterwork against a drop of its grade and level ----
        r = await ev(page, 'masterwork', """(async () => { const T = LT, H = T.H, G = T.G, P = await T.fresh('warrior', 50); const D = H.depth;
          const out = {};
          for (const [id, slot] of [['mw_warrior', 'weapon'], ['mw_warrior2', 'chest'], ['mw_cloak', 'cloak']]) {
            const rec = D.DP_RECIPES ? D.DP_RECIPES.find((r) => r.id === id) : null;
            for (const q of [3, 4]) {
              let mw = 0, drop = 0, n = 0;
              for (let i = 0; i < 160; i++) {
                const it = G.makeItem({ cls: 'warrior', lvl: D.depthCraftLvl(rec), lvlCap: 50, q, slot });
                D.depthCraftGear(rec, it, 100);
                mw += G.itemScore(it); drop += G.itemScore(G.makeItem({ cls: 'warrior', lvl: 50, q, slot })); n++;
              }
              out[slot + q] = +(mw / drop).toFixed(3);
            }
          }
          return out; })()""")
        check(all(1.08 <= v <= 1.24 for k, v in r.items() if not k.startswith('cloak')), f'a named masterwork at 50 is 10-20% above a drop of its grade ({r})')

        # ---- old saves: items keep their own levels and stats ----
        r = await ev(page, 'old save', """(() => { const T = LT, H = T.H, G = T.G, F = T.F;
          if (H.GAME.player) F.newCharacter();
          const old = { id: 'iold1', slot: 'weapon', base: 'Longsword', vis: 'sword', q: 3, lvl: 22, st: { dmg: 17, crit: 2.5 }, cls: 'warrior', name: 'Keen Longsword of the Wolf' };
          const crafted = { id: 'iold2', slot: 'chest', base: 'Hauberk', vis: '', q: 4, lvl: 50, st: { arm: 20, hp: 28, pow: 9 }, cls: 'warrior', name: 'The Unbowed', mw: 1, dur: 80 };
          const junk = { id: 'jold', slot: 'junk', name: 'Troll Tooth', base: 'Trophy', q: 0, lvl: 40, n: 3, st: {} };
          G.startGame({ v: 1, name: 'Oldsave', realm: 0, cls: 'warrior', level: 46, xp: 0, rp: 0, gold: 500, potions: 2, bag: [crafted, junk, { slot: 'bogus' }], eq: { weapon: old } });
          const P = H.GAME.player, w = H.INV.eq.weapon, c = H.INV.bag.find((i) => i.id === 'iold2'), j = H.INV.bag.find((i) => i.slot === 'junk');
          return { w: w && [w.lvl, w.st.dmg, w.st.crit, w.q], c: c && [c.lvl, c.st.arm, c.st.hp, c.mw, c.dur], j: j && [j.lvl, j.n], bag: H.INV.bag.length, hp: Math.round(P.maxHp), ok: Number.isFinite(P.maxHp) && Number.isFinite(P.dmgMult) }; })()""")
        check(r['w'] == [22, 17, 2.5, 3] and r['c'] == [50, 20, 28, 1, 80] and r['j'] == [40, 3] and r['bag'] == 2 and r['ok'], 'an old save\'s gear loads with its own item levels and stats')

        # ---- the late game as hard as before ----
        print('\nper blow: blows to fell the foe (kill) and to be felled (die); ratio = die / kill; k = new ratio / old ratio')
        worst = 0
        for L in (20, 35, 50):
            for cls in ('warrior', 'archer', 'mage', 'priest'):
                for role in ('guard', 'lord'):
                    lv = L + (4 if role == 'lord' else 0)
                    r = await ev(page, '', f"LT.compare('{cls}', {L}, (P) => LT.foe(1, 'warrior', {lv}, '{role}'))", quiet=True)
                    worst = max(worst, abs(r['k'] - 1))
                    print(f"  {L:>2} {cls:<8} vs {role:<5} old kill {r['old']['kill']:>5} die {r['old']['die']:>5} ratio {r['old']['ratio']:.2f} (gear dmg {r['old']['dmg']} hp {r['old']['hp']} arm {r['old']['arm']})"
                          f" | new kill {r['new']['kill']:>5} die {r['new']['die']:>5} ratio {r['new']['ratio']:.2f} (gear dmg {r['new']['dmg']} hp {r['new']['hp']} arm {r['new']['arm']}) | k {r['k']}", flush=True)
                    check(abs(r['k'] - 1) < 0.1, f'level {L} {cls} against a {role}: the fight is as hard as before (k {r["k"]})')
        r = await ev(page, 'king 28', """(() => LT.compare('warrior', 28, (P) => { const H = LT.H; H.fn.rescaleWar(); const k = H.fn.getEnt(H.BARROW_STATE.king); return k; }))()""")
        check(abs(r['k'] - 1) < 0.1, f'the Hollow King at 28 as hard as before (k {r["k"]})')
        r = await ev(page, 'dragon 50', """(() => LT.compare('priest', 50, (P) => { const H = LT.H; H.fn.rescaleWar(); return H.ENT.find((e) => e.role === 'boss' && e.alive); }))()""")
        check(abs(r['k'] - 1) < 0.12, f'Cinderwing at 50 as hard as before (k {r["k"]})')

        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors ({errs[:2]})')
        for l in logs[:4]: print('  log', l)
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS)
        await b.close()
asyncio.run(main())
