"""The class systems: warrior stances, momentum, blocks and parries; the archer's draw, arrows, hiding and snares;
the mage's elements, attunement and combos; the priest's devotion, holy ground and raising the fallen; and a
balance simulator (duels and monster packs at levels 10, 30 and 50, run through __hm.simulate).
usage: python3 tools/tests/classes.py [mech] [balance] [shots] [reps=N]
  mech     the mechanics checks (the default when nothing else is named)
  balance  the balance table: time to kill a standard foe, survival against a pack, and duels
  shots    screenshots of the new actions (960x540)
  HM_BAL=path writes the balance table there as JSON as well"""
import json, asyncio, sys, os, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'shots' in ARGS
BAL = 'balance' in ARGS
MECH = 'mech' in ARGS or not (BAL or SHOTS)
REPS = next((int(a.split('=')[1]) for a in ARGS if a.startswith('reps=')), 3)
SHOTQ = next((a.split('=')[1] for a in ARGS if a.startswith('q=')), 'medium')
FAILS = []
CONSOLE = []

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js, quiet=False):
    r = await page.evaluate(js)
    if not quiet: print(label, json.dumps(r)[:1800], flush=True)
    return r

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

# ------------------------------------------------------------------ balance
# Arenas on open ground in the homelands, far from camps and towns; every arena of a phase fights at once, since
# simulate() advances the whole world anyway. Units are garrison posts with a leash so they hold their ground.
BAL_JS = r"""
window.CB = {
  H: __hm, F: __hm.fn, CLS: ['warrior', 'archer', 'mage', 'priest'],
  // arenas within 160 m of one centre (creatures far from the player rest, so the player waits at the centre,
  // 45 m or more from every arena)
  spots(n) {
    const H = this.H, F = this.F;
    const towns = H.REALMS.map((R) => R.town);
    const good = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 285 || r > 492) return false;
      if (towns.some((T) => Math.hypot(T.x - x, T.z - z) < 100)) return false;
      const h0 = F.heightAt(x, z);
      for (let k = 0; k < 16; k++) { const b = k / 16 * Math.PI * 2; for (const rr of [4, 9, 14, 19]) { const xx = x + Math.sin(b) * rr, zz = z + Math.cos(b) * rr; if (!F.isWalkable(xx, zz) || Math.abs(F.heightAt(xx, zz) - h0) > 3.2 || F.heightAt(xx, zz) < -2.6) return false; } }
      if (H.ENT.some((e) => e.alive && !e.balance && e.role !== 'player' && e.kind !== 'door' && e.role !== 'critter' && e.faction !== H.FACTION_NEUTRAL && Math.hypot(e.x - x, e.z - z) < 42)) return false;
      if (H.CAMPS.some((c) => Math.hypot(c.x - x, c.z - z) < 56)) return false;
      return true;
    };
    if (this.cached && this.cached.length >= n) { H.teleport(this.centre.x, this.centre.z); return this.cached.slice(0, n); }
    let best = [];
    for (let cz = -460; cz <= 460; cz += 40) for (let cx = -460; cx <= 460; cx += 40) {
      const rc = Math.hypot(cx, cz); if (rc < 330 || rc > 460) continue;
      const out = [];
      for (let gz = cz - 165; gz <= cz + 165 && out.length < 14; gz += 12) for (let gx = cx - 165; gx <= cx + 165 && out.length < 14; gx += 12) {
        const d = Math.hypot(gx - cx, gz - cz); if (d < 42 || d > 165) continue;
        if (out.some((s) => Math.hypot(s.x - gx, s.z - gz) < 56)) continue;
        if (good(gx, gz)) out.push({ x: gx, z: gz });
      }
      if (out.length > best.length) { best = out; this.centre = { x: cx, z: cz }; }
      if (best.length >= 14) break;
    }
    this.cached = best;
    if (this.centre) H.teleport(this.centre.x, this.centre.z);
    return best.slice(0, n);
  },
  wipe() { for (const e of this.H.ENT.slice()) if (e.balance) { e.damagers = null; if (e.alive) this.F.killEnt(e, null); this.F.removeEnt(e); } },
  unit(realm, cls, lvl, x, z, leash = 14) {
    const e = this.F.spawnRealmUnit(realm, cls, lvl, 'guard', x, z);
    delete e.wlOff; e.ai.post = { x, z, leash }; e.balance = true; e.hp = e.maxHp; e.power = e.maxPower;
    return e;
  },
  dummy(realm, lvl, x, z) {
    const e = this.unit(realm, 'warrior', lvl, x, z, 0);
    e.testDummy = true; e.tweak = { swing: 1e6, hp: 8 }; this.F.setupStats(e); e.ai.nextAbility = 1e12; e.std = e.maxHp / 8;
    return e;
  },
  pack(lvl, x, z, target, only = null) {
    const out = [];
    for (const [type, n] of only ? [[only, 1]] : [['wolf', 3], ['bandit', 2]]) for (let i = 0; i < n; i++) {
      const camp = { type, lmin: lvl, lmax: lvl, x, z, r: 2.5, members: new Set() };
      const m = this.F.spawnMob(camp);
      m.balance = true; m.threat = new Map([[target.id, 5]]); m.target = target.id; m.ai.pulled = true;
      out.push(m);
    }
    return out;
  },
  // phase 1: each class against a standing dummy (time to kill) and against a pack (survival), all at once
  setup1(lvl) {
    this.wipe();
    // four arenas against the dummy, and as many pack fights as there is room for (two for each calling if possible)
    const S = this.spots(12); if (S.length < 8) throw new Error('only ' + S.length + ' arenas');
    this.A = [];
    const packs = S.length >= 12 ? 2 : 1;
    this.CLS.forEach((c, i) => {
      const s = S[i], u = this.unit(0, c, lvl, s.x, s.z), d = this.dummy(1, lvl, s.x + 11, s.z);
      u.target = d.id; this.A.push({ kind: 'ttk', cls: c, u, d, t0: this.H.GAME.t });
      for (let k = 0; k < packs; k++) {
        const s2 = S[4 + i * packs + k], u2 = this.unit(k, c, lvl, s2.x, s2.z), p = this.pack(lvl, s2.x + 9, s2.z, u2);
        this.A.push({ kind: 'pack', cls: c, u: u2, p, lvl, t0: this.H.GAME.t, hp0: u2.maxHp });
      }
    });
    return S.length;
  },
  // phase 2: duels, every pair of classes, realms as given
  setup2(lvl, swap) {
    this.wipe();
    const pairs = []; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([this.CLS[i], this.CLS[j]]);
    const S = this.spots(pairs.length); if (S.length < pairs.length) throw new Error('only ' + S.length + ' arenas');
    this.A = pairs.map(([a, b], i) => {
      const s = S[i], ra = swap ? 1 : 0, rb = swap ? 0 : 1;
      const ua = this.unit(ra, a, lvl, s.x - 8, s.z, 16), ub = this.unit(rb, b, lvl, s.x + 8, s.z, 16);
      ua.target = ub.id; ub.target = ua.id;
      return { kind: 'duel', a, b, ua, ub, t0: this.H.GAME.t };
    });
    return S.length;
  },
  status(cap) {
    const t = this.H.GAME.t;
    let open = 0;
    for (const A of this.A) {
      if (A.res) continue;
      const el = t - A.t0;
      if (A.kind === 'ttk') {
        const dealt = A.d.maxHp - Math.max(0, A.d.hp);
        if (!A.d.alive || el >= cap) A.res = { cls: A.cls, dps: dealt / Math.max(el, 0.1), ttk: A.d.std / Math.max(dealt / Math.max(el, 0.1), 1e-3), died: !A.u.alive };
      } else if (A.kind === 'pack') {
        // an endless pack: every fallen beast or outlaw is replaced two seconds later, so the time to die measures
        // how long the calling holds out (armour, healing, control and killing all count)
        for (let i = 0; i < A.p.length; i++) {
          const m = A.p[i];
          if (m.alive) continue;
          if (!m._gone) { m._gone = t; A.killed = (A.killed || 0) + 1; }
          else if (t - m._gone > 2 && A.u.alive) { const n = this.pack(A.lvl, A.u.x + 9, A.u.z, A.u, m.mobType)[0]; A.p[i] = n; }
        }
        if (!A.u.alive || el >= cap) A.res = { cls: A.cls, t: el, killed: A.killed || 0, surv: A.u.alive ? el * 1.5 : el };
      } else {
        if (!A.ua.alive || !A.ub.alive || el >= cap) A.res = { a: A.a, b: A.b, win: !A.ua.alive && A.ub.alive ? A.b : !A.ub.alive && A.ua.alive ? A.a : null, t: el, ha: A.ua.alive ? A.ua.hp / A.ua.maxHp : 0, hb: A.ub.alive ? A.ub.hp / A.ub.maxHp : 0 };
      }
      if (!A.res) open++;
    }
    return open;
  },
  run(sec, cap) { const H = this.H; let open = 1; for (let s = 0; s < sec && open; s += 1) { H.simulate(1); open = this.status(cap); } return { open, t: Math.round(H.GAME.t), errors: H.errors.length }; },
  results() { return this.A.map((A) => A.res); },
};
"""

def summarize(rows):
    """per class: mean TTK of a standard foe, mean survival against the pack, duel win rate"""
    out = {}
    for lvl, data in rows.items():
        cl = ['warrior', 'archer', 'mage', 'priest']
        ttk = {c: [] for c in cl}; surv = {c: [] for c in cl}; wins = {c: [0, 0] for c in cl}
        for r in data['p1']:
            if r is None: continue
            (ttk if 'ttk' in r else surv)[r['cls']].append(r['ttk'] if 'ttk' in r else r['surv'])
        for r in data['p2']:
            if r is None: continue
            for c in (r['a'], r['b']):
                wins[c][1] += 1
                if r['win'] == c: wins[c][0] += 1
                elif r['win'] is None: wins[c][0] += 0.5
        m = lambda v: sum(v) / len(v) if v else float('nan')
        T = {c: m(ttk[c]) for c in cl}; S = {c: m(surv[c]) for c in cl}
        tm = sum(T.values()) / 4; sm = sum(S.values()) / 4
        out[lvl] = {c: {'ttk': round(T[c], 1), 'ttk_dev': round(T[c] / tm - 1, 3), 'surv': round(S[c], 1), 'surv_dev': round(S[c] / sm - 1, 3), 'duel': f"{wins[c][0]:g}/{wins[c][1]}"} for c in cl}
    return out

def print_duels(rows):
    """wins of the row calling against the column calling, all levels together"""
    cl = ['warrior', 'archer', 'mage', 'priest']
    W = {(a, b): [0, 0] for a in cl for b in cl}
    for lvl, data in rows.items():
        for r in data['p2']:
            if not r: continue
            for a, b in ((r['a'], r['b']), (r['b'], r['a'])):
                W[(a, b)][1] += 1
                if r['win'] == a: W[(a, b)][0] += 1
                elif r['win'] is None: W[(a, b)][0] += 0.5
    if not any(v[1] for v in W.values()): return
    print('\nduels (row beat column):   ' + '  '.join(f'{c:>8}' for c in cl), flush=True)
    for a in cl: print(f'  {a:<24}' + '  '.join(f"{W[(a, b)][0]:>4g}/{W[(a, b)][1]:<3}" if a != b else '     -  ' for b in cl), flush=True)

def print_table(summary):
    print('\nlevel  class     TTK(s)  vs mean   survival(s)  vs mean   duels won', flush=True)
    for lvl, row in summary.items():
        for c, v in row.items():
            print(f"{lvl:>5}  {c:<8} {v['ttk']:>7}  {v['ttk_dev']*100:>+6.1f}%  {v['surv']:>11}  {v['surv_dev']*100:>+6.1f}%   {v['duel']}", flush=True)

async def balance(page):
    await page.evaluate("() => {" + BAL_JS + "; return 0; }")
    rows = {}
    for lvl in (10, 30, 50):
        await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: 0, cls: 'warrior', level: {lvl} }}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; return 0; }})()")
        p1, p2 = [], []
        for rep in range(REPS):
            t0 = time.time()
            await page.evaluate(f"CB.setup1({lvl}); 0")
            while True:
                r = await page.evaluate("CB.run(10, 90)")
                if not r['open']: break
            p1 += await page.evaluate("CB.results()")
            print(f'  level {lvl} rep {rep + 1}: ttk and pack done in {time.time() - t0:.0f}s', flush=True)
            for swap in ((False, True) if 'fast' not in ARGS else ()):
                t0 = time.time()
                await page.evaluate(f"CB.setup2({lvl}, {'true' if swap else 'false'}); 0")
                while True:
                    r = await page.evaluate("CB.run(10, 60)")
                    if not r['open']: break
                p2 += await page.evaluate("CB.results()")
                print(f'  level {lvl} rep {rep + 1}: duels{" (realms swapped)" if swap else ""} done in {time.time() - t0:.0f}s', flush=True)
        rows[lvl] = {'p1': p1, 'p2': p2}
    await page.evaluate("CB.wipe(); 0")
    s = summarize(rows)
    print_table(s)
    print_duels(rows)
    if os.environ.get('HM_BAL'):
        pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps({'summary': s, 'raw': rows}, indent=1))
    return s

# ------------------------------------------------------------------ mechanics
MECH_JS = r"""
window.T = {
  H: __hm, F: __hm.fn,
  spot(P) {
    const H = this.H, F = this.F;
    for (let i = 0; i < 1500; i++) {
      const a = (i * 2.399) % (Math.PI * 2), d = 40 + (i % 23) * 8;
      const x = P.x + Math.sin(a) * d, z = P.z + Math.cos(a) * d;
      let ok = true;
      for (let k = 0; k < 12 && ok; k++) { const b = k / 12 * Math.PI * 2; for (const r of [5, 12, 20, 26]) { const xx = x + Math.sin(b) * r, zz = z + Math.cos(b) * r; if (!F.isWalkable(xx, zz) || Math.abs(F.heightAt(xx, zz) - F.heightAt(x, z)) > 2.2 || F.heightAt(xx, zz) < -2.4) ok = false; } }
      if (!ok) continue;
      if (H.ENT.some((e) => e.alive && e !== P && !e.testFoe && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < 32)) continue;
      // for pictures: open ground with no trees or tall grass in the way
      if (this.open && H.cls && H.cls.treesNear(x, z, 16) > 0) continue;
      return { x, z };
    }
    throw new Error('no open ground found');
  },
  foe(realm, x, z, lvl, cls = 'warrior', leash = 4) {
    const e = this.F.spawnRealmUnit(realm, cls, lvl, 'guard', x, z);
    delete e.wlOff; e.ai.post = { x, z, leash }; e.testFoe = true;
    return e;
  },
  clearAround(x, z, r) { for (const e of this.H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && Math.hypot(e.x - x, e.z - z) < r) { e.damagers = null; this.F.killEnt(e, null); this.F.removeEnt(e); } },
  fresh(cls, lvl, realm = 0) {
    const H = this.H, F = this.F;
    for (const e of H.ENT.slice()) if (e.testFoe) { e.damagers = null; if (e.alive) F.killEnt(e, null); F.removeEnt(e); }
    if (H.GAME.player) F.newCharacter();
    H.start({ realm, cls, level: lvl });
    const P = H.GAME.player;
    const s = this.spot(P);
    H.teleport(s.x, s.z);
    this.clearAround(s.x, s.z, 40);
    P.hp = P.maxHp; P.power = P.maxPower;
    return P;
  },
  ahead(P, d, side = 0) { return { x: P.x + Math.sin(P.yaw) * d + Math.cos(P.yaw) * side, z: P.z + Math.cos(P.yaw) * d - Math.sin(P.yaw) * side }; },
};
"""

async def mechanics(page):
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'api', "(() => ({ cls: typeof __hm.cls, fns: __hm.cls ? Object.keys(__hm.cls).length : 0 }))()")
    check(r['cls'] == 'object' and r['fns'] > 10, 'the class systems are attached to __hm.cls')

    # ---- warrior: stances, momentum and the finisher, block and parry ----
    r = await ev(page, 'stances', """(() => { const P = T.fresh('warrior', 35, 1); const C = T.H.cls, F = T.F;
      const a = T.ahead(P, 2.2); const f = T.foe(2, a.x, a.z, 35); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6 }; F.setupStats(f);
      const out = {};
      for (const s of [0, 1, 2]) { C.setStance(P, s); C.csOf(P).stanceAt = -9; C.csOf(f).stance = 1; out['dealt' + s] = Math.round(C.classHarm(P, f, 100, { kind: 'melee' })); }
      C.setStance(P, 1);
      for (const s of [0, 1, 2]) { C.csOf(P).stance = s; out['taken' + s] = Math.round(C.classHarm(f, P, 100, { kind: 'arrow' })); }
      C.csOf(P).stance = 1; out.S = C.STANCES.map((x) => ({ out: x.out, taken: x.taken })); return out; })()""")
    S = r['S']
    check(r['dealt2'] == round(100 * S[2]['out']) > 100 and r['dealt0'] == round(100 * S[0]['out']) < 100 and r['dealt1'] == 100, f"fury deals more ({r['dealt2']}), guarded less ({r['dealt0']})")
    check(r['taken0'] == round(100 * S[0]['taken']) < 100 and r['taken2'] == round(100 * S[2]['taken']) > 100, f"guarded takes less harm ({r['taken0']}), fury more ({r['taken2']})")

    r = await ev(page, 'momentum', """(() => { const P = T.H.GAME.player, C = T.H.cls, F = T.F, H = T.H;
      const f = H.ENT.find((e) => e.testFoe && e.alive); f.testDummy = true; f.maxHp *= 20; f.hp = f.maxHp; P.target = f.id; P.yaw = Math.atan2(f.x - P.x, f.z - P.z);
      C.csOf(P).mom = 0; H.simulate(8); const mom = C.momOf(P);
      const hp0 = f.hp; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; C.csOf(P).mom = 4; C.csOf(P).momAt = H.GAME.t; // 4: below an Eriu champion's whirling feat
      const fin0 = C.CLS.stats.finishers; P.swingAt = H.GAME.t + 9;
      const why = F.useAbility(P, 'slash', f); const momSpent = C.csOf(P).mom; H.simulate(1.0);
      const finHit = Math.round(hp0 - f.hp);
      const bleed = f.buffs.some((b) => b.kind === 'bleed'), stun = f.buffs.some((b) => b.kind === 'stun'), sunder = f.buffs.some((b) => b.kind === 'sunder');
      for (const b of f.buffs) if (b.kind === 'bleed') b.until = 0; P.cds = {}; P.gcdUntil = 0; const hp1 = f.hp; F.useAbility(P, 'slash', f); H.simulate(0.5);
      return { mom, why, finHit, plainHit: Math.round(hp1 - f.hp), momAfter: momSpent, finishers: C.CLS.stats.finishers - fin0, style: C.weaponStyle(P), bleed, stun, sunder }; })()""")
    check(r['mom'] >= 2, f"blows that land build momentum ({r['mom']})")
    check(r['why'] is True and r['finishers'] == 1 and r['momAfter'] < 1, 'Slash with momentum is a finisher that spends it')
    check(r['finHit'] > r['plainHit'] * 1.4, f"the finisher strikes far harder ({r['finHit']} vs {r['plainHit']})")
    check(r['bleed'] if r['style'] == 'sword' else r['sunder'] if r['style'] == 'axe' else r['stun'], f"the {r['style']} leaves its mark")

    r = await ev(page, 'parry', """(() => { const P = T.H.GAME.player, C = T.H.cls, F = T.F, H = T.H;
      const f = H.ENT.find((e) => e.testFoe && e.alive); f.testDummy = true; P.target = null; P.buffs.length = 0; P.yaw = Math.atan2(f.x - P.x, f.z - P.z); P.hp = P.maxHp; P.endurance = 100; f.buffs.length = 0;
      const p0 = C.CLS.stats.parries;
      H.simulate(0.8); C.classHold(true); H.simulate(0.1);
      const parried = F.dealDamage(f, P, 100, { kind: 'melee' });
      const stunned = f.buffs.some((b) => b.kind === 'stun'), stagger = f.buffs.some((b) => b.kind === 'stagger');
      H.simulate(0.5);
      const blocked = F.dealDamage(f, P, 100, { kind: 'melee' });
      C.classHold(false); H.simulate(0.1); C.classHold(true);
      const flick = F.dealDamage(f, P, 100, { kind: 'melee' });
      C.classHold(false);
      const open = F.dealDamage(f, P, 100, { kind: 'melee' });
      P.yaw += Math.PI; C.classHold(true); H.simulate(0.6); const behind = F.dealDamage(f, P, 100, { kind: 'melee' }); C.classHold(false); P.yaw -= Math.PI;
      return { parried, stunned, stagger, parries: C.CLS.stats.parries - p0, blocked: Math.round(blocked), flick: Math.round(flick), open: Math.round(open), behind: Math.round(behind), win: C.parryWindow(P) }; })()""")
    check(r['parried'] == 0 and r['parries'] == 1, 'a shield raised just as the blow comes parries it')
    check(r['stunned'] and r['stagger'], 'the parried attacker is stunned and staggered')
    check(0 < r['blocked'] < r['open'] * 0.45, f"a held shield turns most of a blow ({r['blocked']} of {r['open']})")
    check(r['flick'] > 0, 'flicking the shield up and down does not parry')
    check(r['behind'] >= r['open'] * 0.9, 'the shield does not cover your back (balanced stance)')

    # ---- archer: the draw, arrows as goods, hiding, snares ----
    r = await ev(page, 'draw', """(() => { const P = T.fresh('archer', 30, 1); const C = T.H.cls, F = T.F, H = T.H;
      const a = T.ahead(P, 22); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 30 }; F.setupStats(f); f.testDummy = true; P.target = f.id; P.swingAt = 1e9;
      const shoot = (hold) => { C.startDraw(P); H.simulate(hold); const k = C.drawK(P); const hp0 = f.hp; C.releaseDraw(P, f); const A = C.CLS.arrows[C.CLS.arrows.length - 1]; const vy0 = A ? A.vy : 0; let vy1 = vy0;
        for (let i = 0; i < 40 && C.CLS.arrows.includes(A); i++) { vy1 = A.vy; H.simulate(0.05); }
        return { k: +k.toFixed(2), dmg: Math.round(hp0 - f.hp), fall: +(vy0 - vy1).toFixed(2) }; };
      const snap = [], full = [];
      for (let i = 0; i < 4; i++) { snap.push(shoot(0.15)); P.power = P.maxPower; full.push(shoot(1.3)); P.power = P.maxPower; }
      return { snap, full, drawn: C.CLS.stats.drawn }; })()""")
    sd = sum(x['dmg'] for x in r['snap']) / 4; fd = sum(x['dmg'] for x in r['full']) / 4
    check(all(x['k'] >= 0.99 for x in r['full']) and all(x['k'] < 0.2 for x in r['snap']), 'the draw takes time to reach full')
    check(fd > sd * 1.8, f"a full draw strikes far harder than a snap shot ({fd:.0f} vs {sd:.0f})")
    check(all(x['fall'] > 1.0 for x in r['full']), 'drawn arrows fly in an arc under gravity')
    check(sum(1 for x in r['full'] if x['dmg'] > 0) >= 3, 'full draws fly true')

    r = await ev(page, 'arrows', """(() => { const P = T.H.GAME.player, C = T.H.cls, F = T.F, H = T.H;
      const f = H.ENT.find((e) => e.testFoe && e.alive);
      const out = {};
      for (const k of ['broadhead', 'bodkin', 'fire', 'blunt']) {
        F.goodsAdd('arrows_' + k, 5, true); C.csOf(P).arrow = k; const n0 = F.goodsCount('arrows_' + k);
        f.buffs.length = 0; f.wet = 0; f.casting = { id: 'smite', t: 0, total: 9, targetId: P.id };
        P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; const why = F.useAbility(P, 'quickshot', f); H.simulate(1.2);
        out[k] = { why, used: n0 - F.goodsCount('arrows_' + k), bleed: f.buffs.some((b) => b.kind === 'bleed'), burn: f.buffs.some((b) => b.kind === 'burn'), snare: f.buffs.some((b) => b.kind === 'snare'), cast: !!f.casting };
      }
      C.csOf(P).arrow = 'plain';
      return out; })()""")
    check(all(r[k]['used'] == 1 for k in r), 'each special arrow is taken from the packs')
    check(r['broadhead']['bleed'], 'broadheads open a bleeding wound')
    check(r['fire']['burn'], 'fire arrows set the foe burning')
    check(r['blunt']['snare'] and not r['blunt']['cast'], 'blunt arrows stagger and break a spell')

    r = await ev(page, 'hiding', """(() => { const P = T.H.GAME.player, C = T.H.cls, F = T.F, H = T.H;
      let spot = null;
      for (let i = 0; i < 6000 && !spot; i++) { const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900; if (!F.isWalkable(x, z) || Math.hypot(x, z) < 290) continue; const pp = { x, z, y: F.heightAt(x, z) }; if (C.coverAt(pp) < 0.8) continue; if (H.ENT.some((e) => e.alive && e !== P && e.kind !== 'door' && e.role !== 'critter' && Math.hypot(e.x - x, e.z - z) < 30)) continue; spot = pp; }
      if (!spot) return { spot: null };
      for (const e of H.ENT.slice()) if (e.testFoe) { e.damagers = null; if (e.alive) F.killEnt(e, null); F.removeEnt(e); }
      H.teleport(spot.x, spot.z); P.combatUntil = -99; C.csOf(P).hideBreak = -9; P.target = null;
      H.simulate(2.5);
      const hidden = C.csOf(P).hidden, cover = C.csOf(P).cover;
      const a = T.ahead(P, 18); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 30 }; F.setupStats(f);
      H.simulate(1.0); const seen = f.target === P.id;
      const amb0 = C.CLS.stats.ambush; P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower;
      const hp0 = f.hp; F.useAbility(P, 'quickshot', f); H.simulate(1.0);
      return { spot: true, cover: +cover.toFixed(2), hidden, seen, ambush: C.CLS.stats.ambush - amb0, after: C.csOf(P).hidden, dmg: Math.round(hp0 - f.hp) }; })()""")
    if r.get('spot'):
        check(r['hidden'], f"keeping still in long grass hides an archer (cover {r['cover']})")
        check(not r['seen'], 'a foe 18 m away does not see a hidden archer')
        check(r['ambush'] == 1 and not r['after'], 'the first shot from cover is an ambush, and gives you away')
    else: check(False, 'found long grass to hide in')

    r = await ev(page, 'snare', """(() => { const P = T.fresh('archer', 12, 2); const C = T.H.cls, F = T.F, H = T.H;
      P.power = P.maxPower; const why = C.classTechnique(P); const S = C.CLS.snares[C.CLS.snares.length - 1];
      H.simulate(1.2);
      const f = T.foe(1, S.x + 3, S.z, 12, 'warrior', 0); f.ai.nextAbility = 1e9;
      for (let i = 0; i < 30 && !S.sprung; i++) { f.x += (S.x - f.x) * 0.25; f.z += (S.z - f.z) * 0.25; H.simulate(0.1); }
      return { why, sprung: !!S.sprung, root: f.buffs.some((b) => b.kind === 'root'), frozen: C.frozenOf(f), mesh: !!S.mesh }; })()""")
    check(r['why'] is True and r['mesh'], 'T lays a snare with its own model')
    check(r['sprung'] and (r['root'] or r['frozen']), 'a foe that steps on the snare is held fast')
    check(r['frozen'], 'a Thule snare freezes what it catches')

    # ---- mage: elements, combos, attunement, ice, steam ----
    r = await ev(page, 'elements', """(() => { const P = T.fresh('mage', 35, 0); const C = T.H.cls, F = T.F, H = T.H;
      const mk = (d, side = 0) => { const a = T.ahead(P, d, side); const f = T.foe(2, a.x, a.z, 35, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f); return f; };
      const f = mk(16); P.target = f.id; P.swingAt = 1e9;
      const out = {};
      const storm = (t) => { const hp0 = t.hp; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; C.csOf(P).att = { fire: 0, frost: 0, storm: 0 }; C.csOf(P).prev = null; F.useAbility(P, 'chain', t); H.simulate(1.6); return hp0 - t.hp; };
      let dry = 0, wet = 0; for (let i = 0; i < 3; i++) { f.wet = 0; dry += storm(f); f.wet = 1; wet += storm(f); } f.wet = 0; out.dry = Math.round(dry); out.wet = Math.round(wet);
      f.buffs.length = 0; f.wet = 0; out.hDry = Math.round(C.classHarm(P, f, 100, { kind: 'shock' })); f.wet = 1; out.hWet = Math.round(C.classHarm(P, f, 100, { kind: 'shock' })); f.wet = 0;
      f.buffs.length = 0; C.addChill(f, 3, P); out.frozen = C.frozenOf(f); const sh0 = C.CLS.stats.combos.shatter || 0; storm(f); out.shatter = (C.CLS.stats.combos.shatter || 0) - sh0; out.unfrozen = !C.frozenOf(f);
      f.buffs.length = 0; C.addChill(f, 1, P); const st0 = C.CLS.stats.combos.steam || 0;
      P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'firebolt', f); H.simulate(2.4);
      out.steam = (C.CLS.stats.combos.steam || 0) - st0; out.cloud = C.CLS.steam.length > 0; out.wetAfter = +(f.wet || 0).toFixed(2);
      f.buffs.length = 0; F.addBuff(f, 'burn', 1, 6, P.id); const ov0 = C.CLS.stats.combos.overload || 0; storm(f); out.overload = (C.CLS.stats.combos.overload || 0) - ov0; out.burnGone = !C.burningOf(f);
      f.buffs.length = 0; F.addBuff(f, 'burn', 1, 6, P.id); const q0 = C.CLS.stats.combos.quench || 0; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'frost', f); H.simulate(1.2);
      out.quench = (C.CLS.stats.combos.quench || 0) - q0;
      C.csOf(P).att = { fire: 0, frost: 0, storm: 0 };
      for (let i = 0; i < 3; i++) { P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; f.buffs.length = 0; F.useAbility(P, 'firebolt', f); H.simulate(1.7); }
      out.attFire = Math.round(C.attOf(P, 'fire')); out.attFrost = Math.round(C.attOf(P, 'frost'));
      for (const e of H.ENT) if (e.testFoe && e !== f && e.alive) { e.damagers = null; F.killEnt(e, null); }
      const g1 = mk(16, 14), g2 = mk(16, 28); f.buffs.length = 0;
      const hits = (wetv) => { for (const g of [f, g1, g2]) { g.wet = wetv; g.hp = g.maxHp; g.buffs.length = 0; } storm(f); return [f, g1, g2].filter((g) => g.hp < g.maxHp - 1).length; };
      out.chainDry = hits(0); out.chainWet = hits(1);
      return out; })()""")
    check(r['hWet'] >= r['hDry'] * 1.3 and r['wet'] > r['dry'], f"storm strikes harder through the wet ({r['hWet']} vs {r['hDry']}; chains {r['wet']} vs {r['dry']})")
    check(r['frozen'] and r['shatter'] == 1 and r['unfrozen'], 'three chills freeze; storm shatters the frozen')
    check(r['steam'] == 1 and r['cloud'] and r['wetAfter'] > 0.5, 'fire on the chilled bursts into steam that soaks')
    check(r['overload'] == 1, 'storm overloads the burning')
    check(r['quench'] == 1, 'frost quenches the burning')
    check(r['attFire'] >= 50 and r['attFrost'] < 10, f"casting charges the element's attunement ({r['attFire']})")
    check(r['chainWet'] > r['chainDry'], f"the storm arcs further through wet foes ({r['chainWet']} vs {r['chainDry']})")

    r = await ev(page, 'ice', """(() => { const H = T.H, F = T.F, C = H.cls, P = H.GAME.player;
      let best = null;
      for (let i = 0; i < 6000 && !best; i++) { const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900; if (F.heightAt(x, z) < -4.6 && !F.isWalkable(x, z) && F.heightAt(x + 3, z) < -4.6 && F.heightAt(x - 3, z) < -4.6) best = { x, z }; }
      if (!best) return { lake: false };
      const deepBefore = F.isWalkable(best.x, best.z);
      const s = C.freezeWater(best.x, best.z, 6, P);
      const walk = F.isWalkable(best.x, best.z), on = !!C.iceAt(best.x, best.z);
      H.teleport(best.x, best.z); P.y = -3.13; P.onGround = true; H.simulate(0.5);
      const stand = +(P.y - (-3.2)).toFixed(2);
      const n0 = C.CLS.ice.length; s.until = H.GAME.t + 0.5; H.simulate(1.0);
      return { lake: true, deepBefore, walk, on, stand, gone: C.CLS.ice.length < n0, mesh: !!s.mesh || s.dead }; })()""")
    if r.get('lake'):
        check(not r['deepBefore'] and r['walk'] and r['on'], 'frost turns deep water into walkable ice')
        check(abs(r['stand'] - 0.07) < 0.2, f"a body stands on the ice, not in the water ({r['stand']})")
        check(r['gone'], 'the ice melts away in time')
    else: check(False, 'found deep water to freeze')

    r = await ev(page, 'frostspell', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('mage', 35, 2);
      let best = null;
      for (let i = 0; i < 6000 && !best; i++) { const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900; if (F.heightAt(x, z) > -3.6 || !F.isWalkable(x, z)) continue; const sx = x + 10, sz = z; if (F.isWalkable(sx, sz) && F.heightAt(sx, sz) > -3.0) best = { x, z, sx, sz }; }
      if (!best) return { ok: false };
      H.teleport(best.sx, best.sz);
      const f = T.foe(1, best.x, best.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f);
      P.target = f.id; P.yaw = Math.atan2(f.x - P.x, f.z - P.z); const i0 = C.CLS.stats.ice;
      P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'frost', f); H.simulate(1.2);
      const r0 = C.CLS.runes.length; C.setFocus(P, 'frost'); P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; P.yaw += Math.PI; F.useAbility(P, 'blink', null);
      return { ok: true, ice: C.CLS.stats.ice - i0, runes: C.CLS.runes.length - r0 }; })()""")
    if r.get('ok'):
        check(r['ice'] >= 1, 'Frost Lance on a foe standing in water freezes the water round it')
        check(r['runes'] == 1, "a Thule mage's Blink lays a rune")

    # ---- priest: devotion, holy ground, smite the dead, raise the fallen, prayer ----
    r = await ev(page, 'priest', """(() => { const P = T.fresh('priest', 30, 1); const C = T.H.cls, F = T.F, H = T.H;
      const cs = C.csOf(P); cs.dev = 10;
      const ally = T.foe(1, P.x + 2, P.z, 30, 'warrior', 0); ally.hp = ally.maxHp * 0.3; ally.ai.nextAbility = 1e9;
      P.target = ally.id; P.power = P.maxPower; const d0 = C.devOf(P); F.useAbility(P, 'mend', ally); H.simulate(1.8);
      const devHeal = C.devOf(P) - d0;
      const mob = (type, d) => { const a = T.ahead(P, d); const camp = { type, lmin: 30, lmax: 30, x: a.x, z: a.z, r: 0.5, members: new Set() }; const m = F.spawnMob(camp); m.testFoe = true; m.tweak = { hp: 10, swing: 1e6 }; F.setupStats(m); m.home = { x: a.x, z: a.z, r: 0 }; return m; };
      const sk = mob('skeleton', 14), bd = mob('bandit', 14);
      const smite = (t) => { let s = 0; for (let i = 0; i < 4; i++) { const hp0 = t.hp; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'smite', t); H.simulate(1.9); s += hp0 - t.hp; } return s / 4; };
      const dSk = smite(sk), dBd = smite(bd);
      const hSk = C.classHarm(P, sk, 100, { kind: 'holy' }), hBd = C.classHarm(P, bd, 100, { kind: 'holy' });
      cs.dev = 60; cs.devAt = H.GAME.t; P.gcdUntil = 0; P.cds = {}; ally.hp = ally.maxHp * 0.3; const a0 = ally.hp;
      sk.x = P.x - 2; sk.z = P.z + 1; sk.home = { x: sk.x, z: sk.z, r: 0 }; const s0 = sk.hp;
      const g0 = C.CLS.stats.consecrated; const why = C.classTechnique(P); const ground = C.CLS.stats.consecrated - g0; const devSpent = Math.round(C.devOf(P)); H.simulate(3.2);
      return { devHeal: +devHeal.toFixed(1), dSk: Math.round(dSk), dBd: Math.round(dBd), hSk: Math.round(hSk), hBd: Math.round(hBd), why, ground, devAfter: devSpent, healed: Math.round(ally.hp - a0), burned: Math.round(s0 - sk.hp), slowed: sk.buffs.some((b) => b.kind === 'snare') }; })()""")
    check(r['devHeal'] > 3, f"healing builds devotion ({r['devHeal']})")
    check(r['hSk'] >= r['hBd'] * 1.5 and r['dSk'] > r['dBd'], f"holy light falls hardest on the dead ({r['hSk']} vs {r['hBd']}; smites {r['dSk']} vs {r['dBd']})")
    check(r['why'] is True and r['ground'] >= 1 and r['devAfter'] <= 40, 'T hallows the ground for 35 devotion')
    check(r['healed'] > 0 and r['burned'] > 0 and r['slowed'], 'holy ground heals allies and burns and slows the dead')

    r = await ev(page, 'raise', """(() => { const P = T.fresh('priest', 20, 0); const C = T.H.cls, F = T.F, H = T.H;
      const ally = T.foe(0, P.x + 3, P.z, 20, 'warrior', 0); ally.ai.nextAbility = 1e9;
      F.killEnt(ally, null); H.simulate(1);
      const cs = C.csOf(P); cs.dev = 90; cs.devAt = H.GAME.t;
      const why = C.classTechnique(P); const casting = !!P.casting; H.simulate(2.4);
      return { why, casting, alive: ally.alive, hp: +(ally.hp / ally.maxHp).toFixed(2), dev: Math.round(C.devOf(P)), raised: C.CLS.stats.raised }; })()""")
    check(r['why'] is True and r['casting'], 'T near a fallen friend begins to raise them')
    check(r['alive'] and r['hp'] > 0.3, 'the fallen rise again')

    r = await ev(page, 'pray', """(() => { const P = T.fresh('priest', 10, 2); const C = T.H.cls, H = T.H;
      const cs = C.csOf(P); cs.dev = 0; P.power = 10; C.classHold(true); H.simulate(3); const dev = C.devOf(P), act = P.anim.act;
      const pose = H.fn.getEnt ? (() => { return 0; })() : 0;
      C.classHold(false);
      return { dev: Math.round(dev), power: Math.round(P.power), praying: cs.praying }; })()""")
    check(r['dev'] >= 20 and not r['praying'], f"prayer builds devotion ({r['dev']})")

    # ---- saves keep the stance, the focus and the arrow ----
    r = await ev(page, 'save', """(() => { const P = T.fresh('warrior', 20, 0); const C = T.H.cls, F = T.F; C.setStance(P, 2);
      const s = F.buildSave(); const x = s.char ? s.char.x : s.x;
      const cls = x && x.cls; P.cs = null; F.savePartsLoad('char', { cls }); const after = C.csOf(P).stance;
      F.savePartsLoad('char', undefined); const old = C.csOf(P).stance;
      F.savePartsLoad('char', { cls: { st: 'x', fo: 7, ar: null, dv: 'NaN' } }); const bad = C.state(P);
      return { cls, after, old, bad }; })()""")
    check(r['cls'] is not None and r['after'] == 2, 'the stance is saved with the character')
    check(r['old'] == 1 and r['bad']['stance'] == 'balanced', 'older or broken saves load cleanly')

    # ---- the new visuals compile and draw: ice, a snare, a frozen shell, runes and holy ground ----
    await ev(page, 'visuals', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('mage', 35, 2);
      const a = T.ahead(P, 6); const f = T.foe(1, a.x, a.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.testDummy = true; C.addChill(f, 3, P);
      C.freezeWater(P.x + 3, P.z, 5, P); C.laySnare(P); C.layRune(P, P.x - 2, P.z + 2, 'storm'); C.csOf(P).dev = 0; C.steamAt(a.x, a.z, 4, P);
      const pr = T.foe(0, P.x - 3, P.z, 30, 'priest', 0); pr.cs = null; C.csOf(pr).dev = 90; C.csOf(pr).devAt = H.GAME.t; pr.level = 30; H.fn.useAbility(pr, 'consecrate', null);
      H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(P.x - 7, P.y + 5, P.z - 7); H.camera.lookAt(P.x, P.y, P.z); return 0; })()""", quiet=True)
    await frames(page, 4)
    r = await ev(page, 'programs', "(() => ({ bad: __hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name + ': ' + ((p.diagnostics.fragmentShader || {}).log || '') + ((p.diagnostics.vertexShader || {}).log || '')).map(s => s.slice(0, 300)), n: __hm.dbg.renderer.info.programs.length, frozen: __hm.cls.CLS.frozen.size, errors: __hm.errors.length }))()")
    check(not r['bad'], f"the new shaders compile {r['bad'][:2]}")
    check(not CONSOLE, f"no shader or console errors {CONSOLE[:2]}")
    await page.evaluate("__hm.UI.modal = null; __hm.CAM.mode = 'play'; 0")

    # ---- NPCs of every calling use their craft ----
    r = await ev(page, 'npcs', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('warrior', 30, 0); const s0 = JSON.parse(JSON.stringify(C.CLS.stats));
      const S = T.spot(P); const units = [];
      const cls = ['warrior', 'archer', 'mage', 'priest'];
      for (let i = 0; i < 8; i++) { const c = cls[Math.floor(i / 2)]; const u = T.foe(1 + (i % 2), S.x + (i % 2 ? 8 : -8), S.z + (Math.floor(i / 2) - 2) * 3, 30, c, 18); units.push(u); }
      H.teleport(S.x + 70, S.z); H.simulate(60);
      const s1 = C.CLS.stats, d = {};
      for (const k of ['parries', 'blocks', 'finishers', 'drawn', 'consecrated', 'runes', 'snared']) d[k] = s1[k] - s0[k];
      d.combos = Object.fromEntries(Object.keys(s1.combos).map((k) => [k, s1.combos[k] - (s0.combos[k] || 0)]));
      return { d, dead: units.filter((u) => !u.alive).length, errors: H.errors.length }; })()""")
    d = r['d']
    check(d['finishers'] > 0 and (d['blocks'] + d['parries']) > 0, f"NPC warriors use finishers and their shields ({d['finishers']}, {d['blocks']}+{d['parries']})")
    check(d['drawn'] > 0, f"NPC archers draw and loose ({d['drawn']})")
    check(sum(d['combos'].values()) > 0, f"NPC mages make combos ({d['combos']})")


# ------------------------------------------------------------------ screenshots
CAMJS = r"""window.CC = (x, y, z, tx, ty, tz) => { const H = __hm; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); };
// a side view of two bodies: from beside the line between them, looking at the point k of the way from a to b
window.CS = (a, b, off, up, k = 0.5, ly = 1.0) => { const mx = a.x + (b.x - a.x) * k, mz = a.z + (b.z - a.z) * k, dx = b.x - a.x, dz = b.z - a.z, L = Math.hypot(dx, dz) || 1; CC(mx - dz / L * off, Math.max(a.y, b.y) + up, mz + dx / L * off, mx, Math.max(a.y, b.y) + ly, mz); };
window.CB2 = (P, back, up, side, ly = 1.1) => { const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x - s * back + c * side, P.y + up, P.z - c * back - s * side, P.x + s * 2, P.y + ly, P.z + c * 2); };"""

ONLY = next((a.split('=')[1].split(',') for a in ARGS if a.startswith('only=')), None)
def want(name): return ONLY is None or name in ONLY

async def snap(page, name, n=3, hud=False):
    if not want(name): return
    await page.evaluate(f"document.getElementById('hud').style.visibility = '{'visible' if hud else 'hidden'}'; 0")
    await frames(page, n)
    t0 = time.time()
    try:
        await page.screenshot(path=OUT + 'cls_' + name + '.png', timeout=420000)
        print(f'  shot cls_{name} ({time.time() - t0:.0f}s)', flush=True)
    except Exception as err:
        print(f'  shot cls_{name} failed: {str(err)[:120]}', flush=True)

async def shots(page):
    await page.evaluate("() => {" + MECH_JS + CAMJS + "; T.open = true; return 0; }")
    await page.evaluate(f"__hm.fn.setQuality('{SHOTQ}'); __hm.setTod(0.55); 0")
    # a mage's ice on a pond: the mage stands out on it, a foe frozen beside
    r = await ev(page, 'ice-shot', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('mage', 35, 2);
      let best = null;
      for (let i = 0; i < 8000 && !best; i++) { const x = (Math.random() - 0.5) * 900, z = (Math.random() - 0.5) * 900; if (F.heightAt(x, z) > -3.9 || F.heightAt(x, z) < -5.5) continue; for (const a of [0, 1.57, 3.14, 4.71]) { const sx = x + Math.sin(a) * 9, sz = z + Math.cos(a) * 9; if (F.isWalkable(sx, sz) && F.heightAt(sx, sz) > -2.4) { best = { x, z, sx, sz }; break; } } }
      if (!best) return { ok: false };
      for (const e of H.ENT) if (e.alive && e.role !== 'player' && e.kind !== 'door' && Math.hypot(e.x - best.x, e.z - best.z) < 30) { e.damagers = null; F.killEnt(e, null); F.removeEnt(e); }
      C.freezeWater(best.x, best.z, 8, P); C.freezeWater(best.x + (best.sx - best.x) * 0.45, best.z + (best.sz - best.z) * 0.45, 5, P);
      H.teleport(best.x, best.z); P.y = -3.13; P.yaw = Math.atan2(best.sx - best.x, best.sz - best.z) + 2.4;
      const f = T.foe(1, best.x + 2.4, best.z + 1.2, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.y = -3.13; f.fixedY = -3.13; C.addChill(f, 3, P);
      H.simulate(1.2); P.setFocus = 0; C.setFocus(P, 'frost'); P.cs.att.frost = 80;
      H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
      CC(best.sx + (best.sx - best.x) * 0.25, F.heightAt(best.sx, best.sz) + 3.2, best.sz + (best.sz - best.z) * 0.25, best.x, -2.4, best.z);
      return { ok: true }; })()""")
    if r.get('ok'): await snap(page, 'ice', 1)
    # frost meets fire: a chilled foe struck by a firebolt bursts into steam
    await ev(page, 'steam-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 35, 0);
      const a = T.ahead(P, 9); const f = T.foe(1, a.x, a.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f); P.target = f.id; P.swingAt = 1e9;
      C.addChill(f, 2, P); P.power = P.maxPower; F.useAbility(P, 'firebolt', f); H.simulate(1.5);
      for (let i = 0; i < 30 && !C.CLS.steam.length; i++) H.simulate(0.05);
      H.simulate(0.35); CS(P, f, 7.5, 2.4, 0.8, 1.0); return { steam: C.CLS.steam.length }; })()""")
    await snap(page, 'steam', 1)
    # storm through wet foes in the rain
    await ev(page, 'storm-shot', """(() => { const H = T.H, F = T.F, C = H.cls, W = H.dbg.WEATHER; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 35, 1);
      W.mode = 'auto'; W.kind = 'storm'; W.next = 1e9; F.weatherAdvance ? F.weatherAdvance(40) : 0;
      const fs = [[10, -3], [13, 3], [16, -1], [19, 4]].map(([d, s]) => { const a = T.ahead(P, d, s); const f = T.foe(2, a.x, a.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f); f.wet = 1; return f; });
      P.target = fs[0].id; P.swingAt = 1e9; P.power = P.maxPower; F.useAbility(P, 'chain', fs[0]); H.simulate(1.35);
      CS(P, fs[1], 9, 3.2, 0.45, 1.2); return { n: fs.length }; })()""")
    await snap(page, 'storm', 1)
    await page.evaluate("(() => { const W = __hm.dbg.WEATHER; W.kind = 'clear'; if (__hm.fn.weatherAdvance) __hm.fn.weatherAdvance(60); return 0; })()")
    # a warrior's parry
    await ev(page, 'parry-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 2.0); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.testDummy = true; f.yaw = Math.atan2(P.x - f.x, P.z - f.z); P.target = null;
      H.simulate(0.8); C.classHold(true); H.simulate(0.05); F.dealDamage(f, P, 50, { kind: 'melee' });
      f.anim.act = 1; f.anim.actT = 0.3; f.anim.actDur = 0.6; H.simulate(0.1);
      const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x + c * 3.6 + s * 1.0, P.y + 1.7, P.z - s * 3.6 + c * 1.0, (P.x + f.x) / 2, P.y + 1.2, (P.z + f.z) / 2); return { act: P.anim.act, parries: C.CLS.stats.parries }; })()""")
    await snap(page, 'parry', 1)
    # an archer at full draw
    await ev(page, 'draw-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('archer', 30, 1);
      const a = T.ahead(P, 24); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; P.swingAt = 1e9;
      C.startDraw(P); H.simulate(1.4); const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x + c * 2.6 + s * 1.2, P.y + 1.6, P.z - s * 2.6 + c * 1.2, P.x + s * 0.3, P.y + 1.35, P.z + c * 0.3); return { k: C.drawK(P) }; })()""")
    await snap(page, 'draw', 1)
    await page.evaluate("(() => { const C = __hm.cls; C.CLS.hold = false; __hm.GAME.player.cs.drawFrom = -1; return 0; })()")
    # a priest's holy ground, kneeling at prayer within it
    await ev(page, 'holy-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('priest', 30, 0);
      for (const [d, s] of [[2.5, 2.5], [3.5, -2.2], [-1.5, 3.2]]) { const a = T.ahead(P, d, s); const u = T.foe(0, a.x, a.z, 30, 'warrior', 0); u.ai.nextAbility = 1e9; u.yaw = P.yaw + 0.4; u.hp = u.maxHp * 0.5; }
      const cs = C.csOf(P); cs.dev = 80; cs.devAt = H.GAME.t; P.gcdUntil = 0; C.classTechnique(P); H.simulate(1.0); C.startPrayer(P); H.simulate(1.2);
      for (const p of H.SPELL.pillars) p.age = p.dur; for (const d of H.SPELL.discs) if (d.on) d.age = Math.min(d.age + 1.5, d.dur - 0.5); H.frame(0.016);
      H.setTod(1.3); CB2(P, 6.5, 3.4, 4, 0.4); return { grounds: C.CLS.grounds.length }; })()""")
    await snap(page, 'holy', 1)
    await page.evaluate("__hm.setTod(0.55); 0")
    # a Thule mage's rune and an archer's snares, open and sprung
    await ev(page, 'rune-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('archer', 20, 2);
      P.power = P.maxPower; C.classTechnique(P); H.simulate(0.2); P.yaw += 1.4; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; C.classTechnique(P);
      const S = C.CLS.snares[C.CLS.snares.length - 1]; S.sprung = H.GAME.t; S.close = 1;
      const a = T.ahead(P, 4, -2.5); C.layRune(P, a.x, a.z, 'frost'); const b = T.ahead(P, 4.5, 2.5); C.layRune(P, b.x, b.z, 'fire');
      H.simulate(1.2); for (const d of H.SPELL.discs) if (d.on) d.age = Math.min(d.age + 1.5, d.dur - 0.5); H.frame(0.016); CB2(P, -0.5, 2.8, 2.2, -0.2); return { snares: C.CLS.snares.length, runes: C.CLS.runes.length }; })()""")
    await snap(page, 'rune_snare', 1)
    # the class panels on the HUD: a warrior with a finisher ready, a mage reading a frozen foe
    await ev(page, 'hud-w', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 6); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; C.setStance(P, 2); C.addMom(P, 4); return 0; })()""")
    await snap(page, 'hud_warrior', 1, True)
    await ev(page, 'hud-m', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 30, 1);
      const a = T.ahead(P, 10); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; C.attune(P, 'frost', 70); C.addChill(f, 3, P); return 0; })()""")
    await snap(page, 'hud_mage', 1, True)

async def main():
    async with async_playwright() as p:
        w, h = (960, 540) if SHOTS and 'big' in ARGS else (640, 360)
        b, page, logs = await setup(p, w=w, h=h)
        page.on('console', lambda m: CONSOLE.append(m.text[:300]) if m.type == 'error' else None)
        if BAL:
            await page.set_viewport_size({'width': 320, 'height': 180})
            await balance(page)
        if MECH:
            await mechanics(page)
        if SHOTS:
            await shots(page)
        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs, f'no runtime errors {errs[:2]}')
        for l in logs[:5]: print(l)
        await b.close()
    print('\nFAILED: ' + '; '.join(FAILS) if FAILS else '\nall checks passed', flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
