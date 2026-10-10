"""[balance3] The duel scope: duels between the callings' bots, many at once, with what happened in each.
Every pair of callings (or the pairs named) fights `reps` duels at each level, realms rotated and swapped; up to
18 arenas fight at once (the world is stepped anyway, so more arenas a phase cost little). With `tap` each duel also
records, for both sides, the harm dealt by kind, the healing, the shields that absorbed blows, the parries, and the
share of the fight spent stunned, rooted, slowed, casting, holding a shield or a draw, and in reach of the foe.
usage: python3 tools/tests/duels.py [levels=10,30,50] [reps=12] [kind=skilled|simple|mastery|both]
                                    [pairs=warrior-priest,archer-priest] [tap] [trace=N] [cap=60]
  trace=N       a timeline of the first N duels (presses, blows, and a look at both sides each second)
  kind=mastery  each calling's skilled bot against its simple bot (reps each, sides flipped)
  HM_BAL=path   writes every duel as JSON
The fighters are made exactly as classes.py balance makes them (a player's measure, fair gear for the level)."""
import json, asyncio, sys, os, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
from classes import BAL_JS

ARGS = sys.argv[1:]
def arg(k, d):
    return next((a.split('=', 1)[1] for a in ARGS if a.startswith(k + '=')), d)
LEVELS = [int(x) for x in arg('levels', '10,30,50').split(',')]
REPS = int(arg('reps', '12'))
KIND = arg('kind', 'skilled')
CAP = int(arg('cap', '60'))
TAP = 'tap' in ARGS or any(a.startswith('trace=') for a in ARGS)
TRACE = int(arg('trace', '0'))
CL4 = ['warrior', 'archer', 'mage', 'priest']
PAIRS = [tuple(p.split('-')) for p in arg('pairs', '').split(',') if p] or [(CL4[i], CL4[j]) for i in range(4) for j in range(i + 1, 4)]

DS_JS = r"""
window.DS = {
  H: __hm, B: __hm.bal,
  // each duel's two sides keep a record: harm dealt by kind, healing, absorbed, parries, and time in each state
  rec(e) { return e._rec || (e._rec = { dealt: {}, heal: 0, healIn: 0, absorbed: 0, parries: 0, parried: 0, t: 0, stun: 0, root: 0, snare: 0, cast: 0, block: 0, draw: 0, reach: 0, pray: 0, casts: 0, cut: 0 }); },
  tapOn() {
    const B = this.B.BAL, me = this;
    B.tap = (src, dst, dmg, abs, opts) => {
      if (opts && opts.parry) { if (dst && dst.balance) me.rec(dst).parries++; if (src && src.balance) me.rec(src).parried++; return; }
      if (dmg < 0) { if (dst && dst.balance) { me.rec(dst).healIn -= dmg; if (src === dst) me.rec(dst).heal -= dmg; } return; }
      if (dst && dst.balance) me.rec(dst).absorbed += abs;
      // a blow from outside the duel (a passing soldier, a beast): it should not happen in a fair arena
      if (dst && dst.balance && dst._duel && src !== dst._duel.ua && src !== dst._duel.ub && src !== dst) { const R = me.rec(dst); R.foreign = (R.foreign || 0) + dmg + abs; R.foreignBy = (src && (src.role + ':' + (src.mobType || src.cls || src.kind))) || 'none'; }
      if (!src || !src.balance || src === dst || (src._duel && src._duel.res)) return;
      // what struck: the auto-attack, a drawn arrow, a wound or burn ticking, a ward biting back, or the last ability used
      const k = opts.auto ? 'auto' : opts.drawn != null ? 'draw' : opts.dot ? 'dot' : opts.reflect ? 'refl' : opts.snare ? 'snare' : (src._ab || opts.kind || 'other');
      const R = me.rec(src); R.dealt[k] = (R.dealt[k] || 0) + dmg + abs;
      if (me.traceIds && me.traceIds.has(src.id)) me.ev(src, `${k} ${Math.round(dmg + abs)}${opts.crit ? '!' : ''}`);
    };
    B.track = (e, dt) => {
      if (!e.balance || (e._duel && e._duel.res)) return; // a duel that is over counts no more
      const R = me.rec(e), H = me.H;
      R.t += dt;
      if (me.traceIds && me.traceIds.has(e.id)) {
        if (e.casting && e._trc !== e.casting) { e._trc = e.casting; me.ev(e, 'cast ' + e.casting.id); }
        if ((e._trT || 0) <= H.GAME.t) { e._trT = H.GAME.t + 1; const t = H.fn.getEnt(e.target); me.ev(e, `@ hp ${Math.round(100 * e.hp / e.maxHp)}% pw ${Math.round(e.power)} d ${t ? Math.hypot(t.x - e.x, t.z - e.z).toFixed(1) : '-'} [${e.buffs.filter((b) => b.until > H.GAME.t).map((b) => b.kind).join(',')}]${e.cs && e.cs.stance !== undefined && e.cls === 'warrior' ? ' st' + e.cs.stance + ' m' + (e.cs.mom || 0).toFixed(1) : ''}`); }
      }
      const has = (k) => e.buffs.some((b) => b.kind === k && b.until > H.GAME.t);
      if (has('stun')) R.stun += dt; else if (has('root')) R.root += dt;
      if (has('snare')) R.snare += dt;
      if (e.casting) { R.cast += dt; if (!e._castSeen) { e._castSeen = true; R.casts++; } } else if (e._castSeen) { e._castSeen = false; }
      if (e.bot && e.bot.cutAt != null && e.bot.cutAt !== e._cutSeen) { e._cutSeen = e.bot.cutAt; R.cut++; }
      const cs = e.cs;
      if (cs) { if (cs.blockOn) R.block += dt; if (cs.drawFrom >= 0) R.draw += dt; if (cs.praying) R.pray += dt; }
      const t = H.fn.getEnt(e.target);
      if (t && t.alive && Math.hypot(t.x - e.x, t.z - e.z) < (e.meleeRange || 2.6) + (t.radius || 0.45) + 0.4) R.reach += dt;
    };
    return 0;
  },
  tapOff() { this.B.BAL.tap = null; this.B.BAL.track = null; return 0; },
  // a timeline of the first n duels of a phase: every press, blow and a look each second
  ev(e, s) { const L = this.trace[e.id]; if (L && L.length < 400) L.push(`${(this.H.GAME.t - this.t0).toFixed(1)} ${e.cls}${e.bot ? e.bot.kind[1] : ''}${e.id} ${s}`); },
  traceOn(n) { this.trace = {}; this.traceIds = new Set(); this.t0 = this.H.GAME.t; for (const A of CB.A.slice(0, n)) for (const u of [A.ua, A.ub]) { this.trace[u.id] = []; this.traceIds.add(u.id); } return 0; },
  traceOut() { if (!this.trace) return []; const out = []; for (const A of CB.A) { if (!this.trace[A.ua.id]) continue; out.push({ a: A.a, b: A.b, win: A.res && A.res.win, ev: [...this.trace[A.ua.id], ...this.trace[A.ub.id]].sort((x, y) => parseFloat(x) - parseFloat(y)) }); } this.trace = null; this.traceIds = null; return out; },
  // duels: [[clsA, kindA, clsB, kindB, realmA, realmB, flip]] in as many arenas as there are
  setup(lvl, list) {
    CB.wipe();
    const S = CB.spots(list.length); if (S.length < list.length) throw new Error('only ' + S.length + ' arenas');
    CB.A = list.map(([a, ka, b, kb, ra, rb, flip], i) => {
      const s = S[i], f = flip ? -1 : 1;
      const ua = CB.unit(ra, a, lvl, s.x - 9 * f, s.z, ka, 18), ub = CB.unit(rb, b, lvl, s.x + 9 * f, s.z, kb, 18);
      ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 18 };
      ua.target = ub.id; ub.target = ua.id;
      const D = { kind: 'duel', bot: ka === kb ? ka : 'mastery', a: ka === kb ? a : a + ':' + ka, b: ka === kb ? b : b + ':' + kb, ua, ub, t0: this.H.GAME.t, ra, rb, arena: i };
      ua._duel = ub._duel = D;
      return D;
    });
    return CB.A.length;
  },
  results() {
    const pick = (R) => R ? { ...R, dealt: Object.fromEntries(Object.entries(R.dealt).map(([k, v]) => [k, Math.round(v)])), heal: Math.round(R.heal), healIn: Math.round(R.healIn), absorbed: Math.round(R.absorbed) } : null;
    return CB.A.map((A) => ({ ...A.res, ra: A.ra, rb: A.rb, arena: A.arena, hpA: Math.round(A.ua.maxHp), hpB: Math.round(A.ub.maxHp), ta: A.ua.bot.kind, tb: A.ub.bot.kind, A: pick(A.ua._rec), B: pick(A.ub._rec) }));
  },
};
"""

def spec_list(kind, reps):
    """[clsA, kindA, clsB, kindB, realmA, realmB, flip] for every duel of the run"""
    out = []
    if kind == 'mastery':
        for c in CL4:
            for i in range(reps):
                ra, rb, flip = i % 3, (i + 1) % 3, i % 2
                out.append([c, 'skilled', c, 'simple', ra, rb, flip])
        return out
    kinds = ['simple', 'skilled'] if kind == 'both' else [kind]
    for k in kinds:
        for a, b in PAIRS:
            for i in range(reps):
                r0, r1 = (i // 2) % 3, (i // 2 + 1) % 3
                ra, rb = (r1, r0) if i % 2 else (r0, r1)
                out.append([a, k, b, k, ra, rb, 0])
    return out

def table(rows):
    """wins of the row calling against the column calling, per bot kind"""
    for bot in sorted({r['bot'] for r in rows}):
        W = {}
        for r in rows:
            if r['bot'] != bot: continue
            for a, b in ((r['a'], r['b']), (r['b'], r['a'])):
                w = W.setdefault((a, b), [0, 0, []]); w[1] += 1; w[2].append(round(r['t']))
                w[0] += 1 if r['win'] == a else 0.5 if r['win'] is None else 0
        names = sorted({k[0] for k in W}, key=lambda c: (CL4.index(c.split(':')[0]), c))
        print(f'\n  {bot}: row beat column', flush=True)
        for a in names:
            tot = [sum(W[(a, b)][0] for b in names if (a, b) in W), sum(W[(a, b)][1] for b in names if (a, b) in W)]
            print(f'    {a:<16}' + '  '.join(f"{W[(a, b)][0]:>4g}/{W[(a, b)][1]:<3}" if (a, b) in W else '    -   ' for b in names) + f"   all {tot[0]:g}/{tot[1]} ({100 * tot[0] / max(1, tot[1]):.0f}%)", flush=True)
        for a in names:
            for b in names:
                if (a, b) in W and CL4.index(a.split(':')[0]) <= CL4.index(b.split(':')[0]) and a < b or (a, b) in W and a.split(':')[0] == b.split(':')[0] and a < b:
                    print(f'    times {a}-{b}: {sorted(W[(a, b)][2])}', flush=True)

def scope(rows):
    """what happened, on average, in each pairing: harm dealt per second by kind, healing, states"""
    G = {}
    for r in rows:
        if not r.get('A'): continue
        G.setdefault((r['a'], r['b']), []).append(r)
    for (a, b), L in G.items():
        print(f'\n  {a} vs {b} ({len(L)} duels, {sum(1 for r in L if r["win"] == a)}-{sum(1 for r in L if r["win"] == b)}, mean {sum(r["t"] for r in L) / len(L):.1f} s)', flush=True)
        for side, who, hp in (('A', a, 'hpA'), ('B', b, 'hpB')):
            T = sum(r['t'] for r in L) or 1
            dealt = {}
            for r in L:
                for k, v in r[side]['dealt'].items(): dealt[k] = dealt.get(k, 0) + v
            tot = sum(dealt.values())
            S = lambda k: sum(r[side][k] for r in L)
            hpm = sum(r[hp] for r in L) / len(L)
            parts = ', '.join(f'{k} {v / T:.0f}' for k, v in sorted(dealt.items(), key=lambda kv: -kv[1]) if v / T >= 1)
            fo = sum(r[side].get('foreign', 0) for r in L)
            print(f'    {who:<14} hp {hpm:.0f}  dps {tot / T:.0f} ({parts})  selfheal/s {S("heal") / T:.0f}  absorbed/s {S("absorbed") / T:.0f}  parries {S("parries")} parried {S("parried")}' + (f'  FOREIGN harm {fo:.0f} ({sum(1 for r in L if r[side].get("foreign"))} duels, by {[r[side].get("foreignBy") for r in L if r[side].get("foreign")][:3]})' if fo else ''), flush=True)
            st = {k: S(k) / T for k in ('stun', 'root', 'snare', 'cast', 'block', 'draw', 'reach', 'pray')}
            print(f'    {"":<14} stunned {st["stun"]:.0%} rooted {st["root"]:.0%} slowed {st["snare"]:.0%} casting {st["cast"]:.0%} shield {st["block"]:.0%} drawing {st["draw"]:.0%} praying {st["pray"]:.0%} in reach {st["reach"]:.0%}  casts {S("casts")} cut {S("cut")}', flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await page.set_viewport_size({'width': 320, 'height': 180})
        await page.evaluate("() => {" + BAL_JS + DS_JS + "; return 0; }")
        allrows = {}
        for lvl in LEVELS:
            await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: 0, cls: 'warrior', level: {lvl} }}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.GAME.player.hp = 1e9; H.GAME.player.maxHp = 1e9; const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; H.fn.weatherAdvance(60); return 0; }})()")  # [balance3] clear skies for every measure: rain damps fire and soaks foes for storms, and a run's weather moved its duels
            if TAP: await page.evaluate("DS.tapOn()")
            specs = spec_list(KIND, REPS)
            n = await page.evaluate("CB.spots(18).length")
            rows = []
            t0 = time.time()
            for i in range(0, len(specs), n):
                chunk = specs[i:i + n]
                await page.evaluate(f"DS.setup({lvl}, {json.dumps(chunk)}); 0")
                if TRACE and i == 0: await page.evaluate(f"DS.traceOn({TRACE})")
                while True:
                    r = await page.evaluate(f"CB.run(10, {CAP})")
                    if not r['open']: break
                rows += await page.evaluate("DS.results()")
                if TRACE and i == 0:
                    for T in await page.evaluate("DS.traceOut()"):
                        print(f"\n  trace {T['a']} vs {T['b']} (won by {T['win']})", flush=True)
                        for line in T['ev']: print('    ' + line, flush=True)
                print(f'  level {lvl}: {min(i + n, len(specs))}/{len(specs)} duels ({time.time() - t0:.0f}s)', flush=True)
            await page.evaluate("CB.wipe(); DS.tapOff()")
            allrows[lvl] = rows
            print(f'\nlevel {lvl}', flush=True)
            table(rows)
            if TAP: scope(rows)
            if os.environ.get('HM_BAL'): pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps(allrows, indent=0))
        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        print('errors', errs, flush=True)
        for l in logs[:5]: print(l)
        await b.close()

asyncio.run(main())
