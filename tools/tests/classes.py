"""The class systems: warrior stances, momentum, blocks and parries; the archer's draw, arrows, hiding and snares;
the mage's elements, attunement and combos; the priest's devotion, holy ground and raising the fallen; and a
balance simulator (duels and monster packs at levels 10, 30 and 50, run through __hm.simulate).
usage: python3 tools/tests/classes.py [mech] [balance] [shots] [reps=N]
  mech     the mechanics checks (the default when nothing else is named)
  balance  the balance table: time to kill a standard foe, survival against a pack, and duels
  shots    screenshots of the new actions (960x540)
  HM_BAL=path writes the balance table there as JSON as well
  [balance3] together: both bots' dummies and packs fight in one phase (16 arenas) when the land has room; nopack,
  noduel, reps=N, dreps=N, mreps=N, levels=10,30,50 as before
  [balance6] b6: the rules of version 14 by number (also in mech); shots only=ward: a mage's ward keeping its spell
  [balance7] b7: the rules of version 15 by number (also in mech): the archers' realm ways on their own ground"""
import json, asyncio, sys, os, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'shots' in ARGS
BAL = 'balance' in ARGS
MECH = 'mech' in ARGS or not (BAL or SHOTS or 'b3' in ARGS or 'b4' in ARGS or 'b5' in ARGS or 'b6' in ARGS or 'b7' in ARGS)
REPS = next((int(a.split('=')[1]) for a in ARGS if a.startswith('reps=')), 3)
# [balance] duels are short and noisy: they get more repetitions of their own (dreps=N)
DREPS = next((int(a.split('=')[1]) for a in ARGS if a.startswith('dreps=')), REPS * 3)
MREPS = next((int(a.split('=')[1]) for a in ARGS if a.startswith('mreps=')), DREPS)
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
# [balance] Two bots per calling (07c_balance.js): the simple one presses 1-8 in order and lets the auto-attack run,
# the skilled one plays the calling well. Each fighter is a 'bot' with a player's own measure (ROLE_MULT.player) and
# fair gear for the level (fairGear: fine below 20, rare to 40, epic above; item level up to 24). Arenas on open
# ground in the homelands, far from camps and towns; every arena of a phase fights at once, since simulate()
# advances the whole world anyway.
BAL_JS = r"""
window.CB = {
  H: __hm, F: __hm.fn, B: __hm.bal, CLS: ['warrior', 'archer', 'mage', 'priest'],
  // arenas within 170 m of one centre (creatures far from the player rest, so the player waits at the centre)
  spots(n) {
    const H = this.H, F = this.F;
    const towns = H.REALMS.map((R) => R.town);
    const good = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 285 || r > 492) return false;
      if (towns.some((T) => Math.hypot(T.x - x, T.z - z) < 100)) return false;
      const h0 = F.heightAt(x, z);
      for (let k = 0; k < 16; k++) { const b = k / 16 * Math.PI * 2; for (const rr of [4, 9, 14, 19]) { const xx = x + Math.sin(b) * rr, zz = z + Math.cos(b) * rr; if (!F.isWalkable(xx, zz) || Math.abs(F.heightAt(xx, zz) - h0) > 3.2 || F.heightAt(xx, zz) < -2.6) return false; } }
      const wa = H.water && H.water.waterAt; // [balance6] no water to kite into (a swimmer cannot shoot or cast)
      if (wa) for (let k = 0; k < 16; k++) { const b = k / 16 * Math.PI * 2; for (const rr of [0, 8, 16, 24]) { const w = wa(x + Math.sin(b) * rr, z + Math.cos(b) * rr); if (w && w.depth > 0.25) return false; } }
      // [balance6] and open ground: in a grove of thirty trees the pack's beasts and outlaws stuck on the trunks while an
      // archer shot them down, and it outlasted every pack at every level (the pack's arenas only: the duels keep theirs)
      if (this.packOpen && H.cls && H.cls.treesNear && H.cls.treesNear(x, z, 22) > 2) return false;
      if (H.ENT.some((e) => e.alive && !e.balance && e.role !== 'player' && e.kind !== 'door' && e.role !== 'critter' && e.faction !== H.FACTION_NEUTRAL && Math.hypot(e.x - x, e.z - z) < 42)) return false;
      if (H.CAMPS.some((c) => Math.hypot(c.x - x, c.z - z) < 56)) return false;
      return true;
    };
    if (this.cached && this.cached.length >= n) { H.teleport(this.centre.x, this.centre.z); this.fireBreak = this.cached.slice(0, n); this.breakR = 25; return this.cached.slice(0, n); } // [balance6] a firebreak round these too
    let best = [];
    for (let cz = -460; cz <= 460; cz += 40) for (let cx = -460; cx <= 460; cx += 40) {
      const rc = Math.hypot(cx, cz); if (rc < 330 || rc > 460) continue;
      const out = [];
      for (let gz = cz - 170; gz <= cz + 170 && out.length < 18; gz += 10) for (let gx = cx - 170; gx <= cx + 170 && out.length < 18; gx += 10) {
        const d = Math.hypot(gx - cx, gz - cz); if (d < 40 || d > (this.packOpen ? 140 : 170)) continue; // [balance6] the pack spawns 11 m out and the fighter kites: within 170 m of the player, where beasts do not rest
        if (out.some((s) => Math.hypot(s.x - gx, s.z - gz) < 52)) continue;
        if (good(gx, gz)) out.push({ x: gx, z: gz });
      }
      if (out.length > best.length) { best = out; this.centre = { x: cx, z: cz }; }
      if (best.length >= 18) break;
    }
    this.cached = best;
    if (this.centre) H.teleport(this.centre.x, this.centre.z);
    this.fireBreak = best.slice(0, n); this.breakR = 25; // [balance6]
    return best.slice(0, n);
  },
  // [balance6] arenas for duels, far apart: a duel is fought by bots alone, and a bot does not rest far from the player
  // (only mobs, townsfolk and critters do), so its arenas may lie anywhere on the homelands' open ground. 52 m apart
  // (spots), one arena's meteors, stray arrows and burning grass reached its neighbours: a mage's meteor struck a duel
  // next door in 5 to 8 pairings a run, and the skilled bots stepped out of their neighbours' fire 688 times in a run of
  // mastery duels at 30 (none in a mirror run alone), which decided the mirrors. `gap` apart, and a firebreak round each
  // (fireBreak), nothing from one reaches another
  spotsWide(n, gap = this.wideGap || 90, open = this.wideOpen) {
    const H = this.H, F = this.F;
    const key = gap + ':' + n + (open ? ':open' : '');
    if (this.wideKey === key && this.wide) { H.teleport(this.centre ? this.centre.x : this.wide[0].x, this.centre ? this.centre.z : this.wide[0].z); this.fireBreak = this.wide.slice(0, n); this.breakR = 34; return this.wide.slice(0, n); }
    const towns = H.REALMS.map((R) => R.town);
    const good = (x, z) => {
      const r = Math.hypot(x, z);
      if (r < 285 || r > 492) return false;
      if (towns.some((T) => Math.hypot(T.x - x, T.z - z) < 100)) return false;
      const h0 = F.heightAt(x, z);
      for (let k = 0; k < 16; k++) { const b = k / 16 * Math.PI * 2; for (const rr of [4, 9, 14, 19, 24]) { const xx = x + Math.sin(b) * rr, zz = z + Math.cos(b) * rr; if (!F.isWalkable(xx, zz) || Math.abs(F.heightAt(xx, zz) - h0) > 3.2 || F.heightAt(xx, zz) < -2.6) return false; } }
      // no water a fighter could kite or tumble into (a swimmer cannot shoot or cast): a skilled archer kited by a priest
      // to an arena's rim dealt nothing in 8 duels of 48 at 30
      const wa = H.water && H.water.waterAt;
      if (wa) for (let k = 0; k < 24; k++) { const b = k / 24 * Math.PI * 2; for (const rr of [0, 6, 12, 18, 24, 30, 36]) { const w = wa(x + Math.sin(b) * rr, z + Math.cos(b) * rr); if (w && w.depth > 0.25) return false; } }
      if (H.ENT.some((e) => e.alive && !e.balance && e.role !== 'player' && e.kind !== 'door' && e.role !== 'critter' && e.faction !== H.FACTION_NEUTRAL && Math.hypot(e.x - x, e.z - z) < 50)) return false;
      if (H.CAMPS.some((c) => Math.hypot(c.x - x, c.z - z) < 60)) return false;
      // [balance7] open ground: no more than two trees within 20 m of the middle and six within 30 m (four of version 14's
      // eleven arenas had 8 to 34 within 20 m: a rush stopped at a trunk and a bow kited round them, and what the fire and
      // the meteors felled there stayed felled for the rest of the run)
      if (open && H.cls && H.cls.treesNear && (H.cls.treesNear(x, z, 20) > 2 || H.cls.treesNear(x, z, 30) > 6)) return false;
      return true;
    };
    // candidates on a 10 m grid, taken greedily, each `gap` from those already taken
    const cand = [];
    for (let gz = -490; gz <= 490; gz += 10) for (let gx = -490; gx <= 490; gx += 10) if (good(gx, gz)) cand.push({ x: gx, z: gz });
    const out = [];
    for (const c of cand) { if (out.length >= Math.max(n, 18)) break; if (!out.some((s) => Math.hypot(s.x - c.x, s.z - c.z) < gap)) out.push(c); }
    this.wide = out; this.wideKey = key;
    this.fireBreak = out.slice(0, n); this.breakR = 34;
    // the player waits at the middle of the old arenas (a far camera spares the renderer nothing, nothing is drawn)
    if (this.centre) H.teleport(this.centre.x, this.centre.z); else H.teleport(out[0].x, out[0].z);
    return out.slice(0, n);
  },
  // [balance6] the firebreak: grass burning more than `r` from every arena's middle is put out (a fire spread up to 37 m
  // from where it was lit in still air and twice that downwind, into the next arena)
  breakFires(r = 34) {
    const B = this.fireBreak;
    if (!B || !B.length || !this.H.bal6) return 0;
    const n = this.H.bal6.breakFires(B, r);
    this.firesBroken = (this.firesBroken || 0) + n;
    return n;
  },
  // [balance7] the meadow made whole round an arena: its cut, burnt and thrown-up ground grows back at once (a duel's
  // fire burnt the grass, and the next duels there were fought on ash: no grass to catch, no cover to hide in). On
  // fresh grass a fire arrow or a firebolt lights it, and a skilled bot steps out of the flames; on ash nothing burns.
  // The warrior won 30 of 48 duels against a mage at 50 in fresh arenas and 11.5 late in a run whose arenas had burnt.
  grassWhole: true,
  wholeGrass(x, z, r = 36) {
    const N = this.H.nature; if (!N || !N.NAT || !this.grassWhole) return 0;
    const NAT = N.NAT, D = NAT.data, R = NAT.res;
    const i0 = Math.max(1, Math.floor(x - r + 512)), i1 = Math.min(R - 2, Math.floor(x + r + 512)), j0 = Math.max(1, Math.floor(z - r + 512)), j1 = Math.min(R - 2, Math.floor(z + r + 512));
    let n = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = i - 511.5 - x, dz = j - 511.5 - z; if (dx * dx + dz * dz > r * r) continue;
      const o = (j * R + i) * 4; if (D[o + 2]) continue; // (a fire still burning: cleanArena puts it out first)
      if (D[o] || D[o + 1] || D[o + 3]) { D[o] = 0; D[o + 1] = 0; D[o + 3] = 0; n++; }
    }
    if (n) { const d = NAT.dirty; NAT.dirty = d ? [Math.min(d[0], i0), Math.min(d[1], j0), Math.max(d[2], i1), Math.max(d[3], j1)] : [i0, j0, i1, j1]; }
    this.grassMade = (this.grassMade || 0) + n;
    return n;
  },
  wipe() {
    const gone = new Set();
    for (const e of this.H.ENT.slice()) if (e.balance) { gone.add(e.id); e.damagers = null; if (e.alive) this.F.killEnt(e, null); this.F.removeEnt(e); }
    // [balance5] and the ground made whole: a meteor's bowl or a leap's dent from the last fighters, its rim in the line of
    // fire, decided the next duels there (a skilled archer won 23 of 24 against a priest at 50 in a fresh arena, none late
    // in the full table)
    if (this.H.bal5 && this.H.bal5.flattenCraters) this.craters = (this.craters || 0) + this.H.bal5.flattenCraters();
    // [balance3] and what they left in the arenas: armed snares (90 s), runes (30 s), holy ground, steam, ice and arrows
    // and bolts still in flight would strike the next fighters there
    const C = this.H.cls.CLS, t = this.H.GAME.t;
    for (const L of [C.snares, C.runes, C.grounds, C.steam]) for (const q of L) if (gone.has(q.owner) || gone.has(q.src)) q.until = Math.min(q.until, t - 1);
    for (const q of C.ice) if (q.until > t) q.until = t - 1;
    for (let i = C.arrows.length - 1; i >= 0; i--) if (gone.has(C.arrows[i].src)) C.arrows.splice(i, 1);
    const P = this.B.PROJ; for (let i = P.length - 1; i >= 0; i--) if (gone.has(P[i].src)) P.splice(i, 1);
    for (const s of this.fireBreak || []) this.wholeGrass(s.x, s.z, 36); // [balance7] and the meadow whole again
  },
  // a fighter: a bot of the calling, a player's measure, fair gear for the level
  unit(realm, cls, lvl, x, z, kind, r = 16) {
    const e = this.F.spawnRealmUnit(realm, cls, lvl, 'bot', x, z);
    e.tweak = { hp: 1.1, dmg: 1.25 };
    e.gear = this.B.fairGear(cls, lvl).tot;
    this.B.botMake(e, kind, { x, z, r });
    this.F.setupStats(e); e.hp = e.maxHp; e.power = e.maxPower; e.balance = true;
    return e;
  },
  dummy(realm, lvl, x, z) {
    const e = this.F.spawnRealmUnit(realm, 'warrior', lvl, 'guard', x, z);
    delete e.wlOff; e.ai.post = { x, z, leash: 0 }; e.balance = true;
    e.testDummy = true; e.tweak = { swing: 1e6, hp: 8 }; this.F.setupStats(e); e.ai.nextAbility = 1e12; e.std = e.maxHp / 8; e.hp = e.maxHp;
    return e;
  },
  // [balance2] grow: the seconds the fight has lasted; each newcomer is 1% stronger for each (health and harm), so a
  // fighter who kills as fast as the pack comes back still falls in the end (an endless pack of the same strength gave
  // a fighter either about 30 s or the whole 150 s, and the median of three swung between them)
  pack(lvl, x, z, target, only = null, grow = 0) {
    const out = [];
    for (const [type, n] of only ? [[only, 1]] : [['wolf', 3], ['bandit', 2]]) for (let i = 0; i < n; i++) {
      const camp = { type, lmin: lvl, lmax: lvl, x, z, r: 2.5, members: new Set() };
      const m = this.F.spawnMob(camp);
      // the pack keeps pace with what a fighter of the level brings: ability ranks and better gear
      const rk = this.F.rankMult(lvl), gq = lvl < 20 ? 1 : lvl < 40 ? 1.08 : 1.16;
      const g = 1 + 0.01 * grow;
      m.tweak = { hp: rk * gq * g, dmg: rk * gq * g }; this.F.setupStats(m);
      m.balance = true; m.threat = new Map([[target.id, 5]]); m.target = target.id; m.ai.pulled = true;
      // [balance2] the pack's home is the arena, so it does not give up the chase (a mob 42 m from home goes back) when
      // the fighter tumbles or kites to the arena's far side: it measured leashing, not survival, for archers
      if (target.bot && target.bot.home) m.home = { x: target.bot.home.x, z: target.bot.home.z, r: 2.5 };
      out.push(m);
    }
    return out;
  },
  // phase 1: each calling against a standing dummy (time to kill) and against an endless pack (survival)
  setup1(lvl, kinds, rep = 0) {
    this.wipe();
    const need = kinds.length * 8;
    if (!this.packOpen) { this.packOpen = true; this.cached = null; } // [balance6] open ground for the time to kill and the pack
    const S = this.spots(need); if (S.length < need) throw new Error('only ' + S.length + ' arenas');
    this.A = [];
    let i = 0;
    for (const kind of kinds) this.CLS.forEach((c) => {
      const R = rep % 3, s = S[i++], u = this.unit(R, c, lvl, s.x - 6, s.z, kind), d = this.dummy((R + 1) % 3, lvl, s.x + 6, s.z);
      u.target = d.id; this.A.push({ kind: 'ttk', bot: kind, cls: c, u, d, t0: this.H.GAME.t });
      const s2 = S[i++], u2 = this.unit(R, c, lvl, s2.x, s2.z, kind, 22), p = this.pack(lvl, s2.x + 11, s2.z, u2);
      this.A.push({ kind: 'pack', bot: kind, cls: c, u: u2, p, lvl, t0: this.H.GAME.t, hp0: u2.maxHp });
    });
    return S.length;
  },
  // phase 2: duels, every pair of callings, both on the same bot, realms as given
  setup2(lvl, swap, kinds, rep = 0) {
    this.wipe();
    const pairs = []; for (let i = 0; i < 4; i++) for (let j = i + 1; j < 4; j++) pairs.push([this.CLS[i], this.CLS[j]]);
    const need = pairs.length * kinds.length;
    const S = this.spotsWide(need); if (S.length < need) throw new Error('only ' + S.length + ' arenas'); // [balance6] duels far apart
    this.A = [];
    let i = 0;
    for (const kind of kinds) for (const [a, b] of pairs) {
      const r0 = rep % 3, r1 = (rep + 1) % 3, s = S[i++], ra = swap ? r1 : r0, rb = swap ? r0 : r1;
      const ua = this.unit(ra, a, lvl, s.x - 9, s.z, kind, 18), ub = this.unit(rb, b, lvl, s.x + 9, s.z, kind, 18);
      ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 18 };
      ua.target = ub.id; ub.target = ua.id;
      this.A.push({ kind: 'duel', bot: kind, a, b, ua, ub, t0: this.H.GAME.t });
    }
    return S.length;
  },
  // phase 3: mastery, each calling's skilled bot against its own simple bot
  setup3(lvl, rep = 0) {
    this.wipe();
    const S = this.spotsWide(4); if (S.length < 4) throw new Error('only ' + S.length + ' arenas'); // [balance6] duels far apart
    this.A = this.CLS.map((c, i) => {
      const s = S[i], ra = rep % 3, rb = (rep + 1) % 3, flip = rep % 2;
      const ua = this.unit(flip ? rb : ra, c, lvl, s.x + (flip ? 9 : -9), s.z, 'skilled', 18), ub = this.unit(flip ? ra : rb, c, lvl, s.x + (flip ? -9 : 9), s.z, 'simple', 18);
      ua.bot.home = ub.bot.home = { x: s.x, z: s.z, r: 18 };
      ua.target = ub.id; ub.target = ua.id;
      return { kind: 'duel', bot: 'mastery', a: c + ':skilled', b: c + ':simple', ua, ub, t0: this.H.GAME.t };
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
        if (!A.d.alive || el >= Math.min(cap, 60)) A.res = { bot: A.bot, cls: A.cls, dps: dealt / Math.max(el, 0.1), ttk: A.d.std / Math.max(dealt / Math.max(el, 0.1), 1e-3), died: !A.u.alive, diag: { d: +Math.hypot(A.u.x - A.d.x, A.u.z - A.d.z).toFixed(1), pw: Math.round(A.u.power), cast: A.u.casting ? A.u.casting.id : '', next: +(A.u.bot.next - t).toFixed(1), tgt: A.u.target === A.d.id, swim: !!A.u.swim, hp: +(A.u.hp / A.u.maxHp).toFixed(2), stun: A.u.buffs.map((b) => b.kind).join(','), el: Math.round(el) } };
      } else if (A.kind === 'pack') {
        // an endless pack: every fallen beast or outlaw is replaced two seconds later, so the time to die measures
        // how long the calling holds out (armour, healing, control and killing all count)
        for (let i = 0; i < A.p.length; i++) {
          const m = A.p[i];
          if (m.alive) {
            // [balance2] the pack keeps its quarry: hidden out of its sight (an Eriu archer hides while it walks), the
            // fighter was simply forgotten and "survived" for ever
            if (A.u.alive && m.target !== A.u.id) { m.target = A.u.id; if (m.threat) m.threat.set(A.u.id, 5); m.ai.pulled = true; }
            continue;
          }
          if (!m._gone) { m._gone = t; A.killed = (A.killed || 0) + 1; }
          else if (t - m._gone > 2 && A.u.alive) { const n = this.pack(A.lvl, A.u.bot.home.x + 11, A.u.bot.home.z, A.u, m.mobType, el)[0]; A.p[i] = n; }
        }
        if (!A.u.alive || el >= cap) A.res = { bot: A.bot, cls: A.cls, t: el, killed: A.killed || 0, surv: A.u.alive ? el * 1.5 : el };
      } else {
        // [balance6] both fallen within the second the run looks: the one that fell last won (arrows and bolts in flight
        // and burns kill after their shooter: in a mirror of archers at 10, 10 duels of 24 were scored as draws)
        const both = !A.ua.alive && !A.ub.alive && this.lastFall, da = A.ua.deadAt || 0, db = A.ub.deadAt || 0; // (CB.lastFall: duels.py lastfall)
        if (!A.ua.alive || !A.ub.alive || el >= cap) A.res = { bot: A.bot, a: A.a, b: A.b, win: both ? (Math.abs(da - db) > 0.02 ? (da > db ? A.a : A.b) : null) : !A.ua.alive && A.ub.alive ? A.b : !A.ub.alive && A.ua.alive ? A.a : null, t: el, ha: A.ua.alive ? A.ua.hp / A.ua.maxHp : 0, hb: A.ub.alive ? A.ub.hp / A.ub.maxHp : 0 };
      }
      if (!A.res) open++;
    }
    return open;
  },
  run(sec, cap) { const H = this.H; let open = 1; for (let s = 0; s < sec && open; s += 1) { if (this.flat && H.bal5) H.bal5.flattenCraters(); H.simulate(1); if (!this.noBreak) this.breakFires(this.breakR || 25); open = this.status(cap); } return { open, t: Math.round(H.GAME.t), errors: H.errors.length }; }, // [balance6] the firebreak each second // [balance5] flat: every crater undone each second (the mage's own meteor's bowl shields its foe from its bolts)
  results() { return this.A.map((A) => A.res); },
};
"""

CL4 = ['warrior', 'archer', 'mage', 'priest']
def summarize(rows, bot):
    """per calling: median time to kill a standard foe, median survival against the pack, duel win rate (draws count half)"""
    out = {}
    for lvl, data in rows.items():
        ttk = {c: [] for c in CL4}; surv = {c: [] for c in CL4}; wins = {c: [0, 0] for c in CL4}
        for r in data['p1']:
            if r is None or r.get('bot') != bot: continue
            (ttk if 'ttk' in r else surv)[r['cls']].append(r['ttk'] if 'ttk' in r else r['surv'])
        for r in data['p2']:
            if r is None or r.get('bot') != bot: continue
            for c in (r['a'], r['b']):
                wins[c][1] += 1
                if r['win'] == c: wins[c][0] += 1
                elif r['win'] is None: wins[c][0] += 0.5
        m = lambda v: sorted(v)[len(v) // 2] if len(v) % 2 else (sum(sorted(v)[len(v) // 2 - 1:len(v) // 2 + 1]) / 2 if v else float('nan'))
        T = {c: m(ttk[c]) for c in CL4}; S = {c: m(surv[c]) for c in CL4}
        tm = sum(T.values()) / 4; sm = sum(S.values()) / 4
        out[lvl] = {c: {'ttk': round(T[c], 1), 'ttk_dev': round(T[c] / tm - 1, 3), 'surv': round(S[c], 1), 'surv_dev': round(S[c] / sm - 1, 3),
                        'duel': f"{wins[c][0]:g}/{wins[c][1]}", 'win': round(wins[c][0] / max(1, wins[c][1]), 3), 'n': len(ttk[c])} for c in CL4}
    return out

def print_duels(rows, bot):
    """wins of the row calling against the column calling, all levels together"""
    W = {(a, b): [0, 0] for a in CL4 for b in CL4}
    for lvl, data in rows.items():
        for r in data['p2']:
            if not r or r.get('bot') != bot: continue
            for a, b in ((r['a'], r['b']), (r['b'], r['a'])):
                W[(a, b)][1] += 1
                if r['win'] == a: W[(a, b)][0] += 1
                elif r['win'] is None: W[(a, b)][0] += 0.5
    if not any(v[1] for v in W.values()): return
    print(f'\n{bot} duels (row beat column):   ' + '  '.join(f'{c:>8}' for c in CL4), flush=True)
    for a in CL4: print(f'  {a:<24}' + '  '.join(f"{W[(a, b)][0]:>4g}/{W[(a, b)][1]:<3}" if a != b else '     -  ' for b in CL4), flush=True)

def print_table(summary, bot):
    print(f'\n{bot} bot\nlevel  class     TTK(s)  vs mean   survival(s)  vs mean   duels won  (win rate)', flush=True)
    for lvl, row in summary.items():
        for c, v in row.items():
            print(f"{lvl:>5}  {c:<8} {v['ttk']:>7}  {v['ttk_dev']*100:>+6.1f}%  {v['surv']:>11}  {v['surv_dev']*100:>+6.1f}%   {v['duel']:>9}  ({v['win']*100:.0f}%)", flush=True)

KINDS = [k for k in ('simple', 'skilled') if k in ARGS] or ['simple', 'skilled']
LEVELS = next(([int(x) for x in a.split('=')[1].split(',')] for a in ARGS if a.startswith('levels=')), [10, 30, 50])
async def balance(page):
    await page.evaluate("() => {" + BAL_JS + "; return 0; }")
    await page.evaluate("CB.packOpen = true; 0")  # [balance6] the time to kill and the pack on open ground within 140 m of the player
    if 'wooded' not in ARGS: await page.evaluate("CB.wideOpen = true; CB.wideGap = 80; 0")  # [balance7] the duels on open ground, 80 m apart (duels.py's arenas)
    if 'flat' in ARGS: await page.evaluate("CB.flat = true; 0")  # [balance5] no crater lasts a second (a probe of what the craters cost)
    rows = {}
    for lvl in LEVELS:
        await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: 0, cls: 'warrior', level: {lvl} }}); H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.GAME.player.hp = 1e9; H.GAME.player.maxHp = 1e9; const W = H.dbg.WEATHER; W.mode = 'clear'; W.kind = 'clear'; H.fn.weatherAdvance(60); return 0; }})()")  # [balance3] clear skies for every measure: rain damps fire and soaks foes for storms, and a run's weather moved its duels
        p1, p2 = [], []
        # [balance3] together: both bots' dummies and packs in one phase when there are arenas for all of them (the world
        # is stepped anyway, so it takes half the time)
        both = 'together' in ARGS and len(KINDS) == 2 and await page.evaluate(f"CB.spots({8 * len(KINDS)}).length") >= 8 * len(KINDS)
        for rep in range(max(REPS, DREPS)):
          if both and 'nopack' not in ARGS and rep < REPS:
                t0 = time.time()
                await page.evaluate(f"CB.setup1({lvl}, {json.dumps(KINDS)}, {rep}); 0")
                while True:
                    r = await page.evaluate("CB.run(10, 150)")
                    if not r['open']: break
                p1 += await page.evaluate("CB.results()")
                print(f'  level {lvl} rep {rep + 1} both: ttk and pack done in {time.time() - t0:.0f}s', flush=True)
          for kind in KINDS:
            kinds = f"['{kind}']"
            if not both and 'nopack' not in ARGS and rep < REPS:
                t0 = time.time()
                await page.evaluate(f"CB.setup1({lvl}, {kinds}, {rep}); 0")
                while True:
                    r = await page.evaluate("CB.run(10, 150)")
                    if not r['open']: break
                p1 += await page.evaluate("CB.results()")
                print(f'  level {lvl} rep {rep + 1} {kind}: ttk and pack done in {time.time() - t0:.0f}s', flush=True)
            for swap in ((False, True) if 'noduel' not in ARGS and rep < DREPS else ()):
                t0 = time.time()
                await page.evaluate(f"CB.setup2({lvl}, {'true' if swap else 'false'}, {kinds}, {rep}); 0")
                while True:
                    r = await page.evaluate("CB.run(10, 60)")
                    if not r['open']: break
                p2 += await page.evaluate("CB.results()")
                print(f'  level {lvl} rep {rep + 1} {kind}: duels{" (realms swapped)" if swap else ""} done in {time.time() - t0:.0f}s', flush=True)
        p3 = []
        for rep in range(MREPS if len(KINDS) == 2 else 0):
            await page.evaluate(f"CB.setup3({lvl}, {rep}); 0")
            while True:
                r = await page.evaluate("CB.run(10, 60)")
                if not r['open']: break
            p3 += await page.evaluate("CB.results()")
        if p3: print(f'  level {lvl}: mastery duels done', flush=True)
        rows[lvl] = {'p1': p1, 'p2': p2, 'p3': p3}
        if os.environ.get('HM_BAL'):
            pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps({'raw': rows}, indent=1))
    await page.evaluate("CB.wipe(); 0")
    out = {}
    for bot in KINDS:
        s = summarize(rows, bot)
        print_table(s, bot)
        print_duels(rows, bot)
        out[bot] = s
    # mastery pays: the skilled bot against the simple one of the same calling
    if any(rows[l].get('p3') for l in rows):
        print('\nmastery: skilled against simple, the same calling (wins of the skilled bot)', flush=True)
        for lvl in rows:
            M = {c: [0, 0] for c in CL4}
            for r in rows[lvl].get('p3', []):
                if not r: continue
                c = r['a'].split(':')[0]; M[c][1] += 1
                M[c][0] += 1 if r['win'] == r['a'] else 0.5 if r['win'] is None else 0
            print(f'  {lvl:>3}  ' + '  '.join(f"{c} {M[c][0]:g}/{M[c][1]}" for c in CL4), flush=True)
            for c in CL4: out.setdefault('mastery', {}).setdefault(lvl, {})[c] = M[c]
    st = await page.evaluate("JSON.stringify(__hm.bal.BAL.stats)")
    print('bot stats', st, flush=True)
    if os.environ.get('HM_BAL'):
        pathlib.Path(os.environ['HM_BAL']).write_text(json.dumps({'summary': out, 'raw': rows}, indent=1))
    return out

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
      // [balance] a shield on the arm turns a blow now and then: the most of a few blows is the stance's own measure
      for (const s of [0, 1, 2]) { C.setStance(P, s); C.csOf(P).stanceAt = -9; C.csOf(f).stance = 1; out['dealt' + s] = Math.max(...Array.from({ length: 12 }, () => Math.round(C.classHarm(P, f, 100, { kind: 'melee' })))); }
      C.setStance(P, 1);
      for (const s of [0, 1, 2]) { C.csOf(P).stance = s; out['taken' + s] = Math.max(...Array.from({ length: 12 }, () => Math.round(C.classHarm(f, P, 100, { kind: 'arrow' })))); }
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
      // (the plain blow: the least of three, so a critical strike among them does not stand for a plain one)
      let plain = Infinity; for (let k = 0; k < 3; k++) { for (const b of f.buffs) if (b.kind === 'bleed') b.until = 0; C.csOf(P).mom = 0; P.cds = {}; P.gcdUntil = 0; const hp1 = f.hp; F.useAbility(P, 'slash', f); H.simulate(0.5); plain = Math.min(plain, hp1 - f.hp); }
      return { mom, why, finHit, plainHit: Math.round(plain), momAfter: momSpent, finishers: C.CLS.stats.finishers - fin0, style: C.weaponStyle(P), bleed, stun, sunder }; })()""")
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
      const open = Math.max(F.dealDamage(f, P, 100, { kind: 'melee' }), F.dealDamage(f, P, 100, { kind: 'melee' }), F.dealDamage(f, P, 100, { kind: 'melee' })); P.hp = P.maxHp; // [balance] the most of three: a lowered shield turns a blow now and then
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

    # ---- [balance] diminishing returns on control, the parry's stun, the freeze, the raise offer, tracked quarry ----
    r = await ev(page, 'dr', """(() => { const P = T.fresh('warrior', 30, 0); const H = T.H, F = T.F, B = H.bal, C = H.cls;
      const a = T.ahead(P, 3); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6 }; F.setupStats(f);
      const dur = (e, kind, src, d = 2) => { e.buffs = e.buffs.filter((b) => b.kind !== kind); F.addBuff(e, kind, 1, d, src); const b = e.buffs.find((q) => q.kind === kind && q.src === src); return b ? +(b.until - H.GAME.t).toFixed(2) : 0; };
      const out = {};
      out.stuns = [dur(P, 'stun', 101), dur(P, 'stun', 102), dur(P, 'stun', 103), dur(P, 'stun', 104)];
      out.hud = B.ccHudState(P).map((q) => q.cat + ':' + q.k + (q.immune ? 'i' : ''));
      F.addBuff(P, 'root', 1, 2, 201); const r1 = P.buffs.find((q) => q.kind === 'root').until; F.addBuff(P, 'root', 1, 2, 201); out.refreshSame = B.ccState(P, 'root').n;
      P.buffs.length = 0; H.simulate(7); out.afterImmune = dur(P, 'stun', 105);
      P.buffs.length = 0; H.simulate(16); out.afterWindow = dur(P, 'stun', 106);
      out.npc = [dur(f, 'stun', 301), dur(f, 'stun', 302), dur(f, 'stun', 303), dur(f, 'stun', 304)];
      // a parry's stun shrinks on anyone, so parries cannot stun-lock
      f.buffs.length = 0; const ps = [];
      for (let i = 0; i < 4; i++) { P.buffs.length = 0; P.yaw = Math.atan2(f.x - P.x, f.z - P.z); C.csOf(P).blockDown = -9; C.setBlock(P, false); C.csOf(P).blockDown = -9; C.classHold(true); H.simulate(0.05); F.dealDamage(f, P, 50, { kind: 'melee' }); const b = f.buffs.find((q) => q.kind === 'stun'); ps.push(b ? +(b.until - H.GAME.t).toFixed(2) : 0); C.classHold(false); f.buffs.length = 0; H.simulate(0.6); }
      out.parry = ps;
      // a freeze is a stun under the same rule for players
      P.buffs.length = 0; P.ccdr = null; const fz = [];
      for (let i = 0; i < 4; i++) { P.buffs = P.buffs.filter((b) => b.kind !== 'frozen' && b.kind !== 'stun' && b.kind !== 'chill'); C.addChill(P, 3, f); const b = P.buffs.find((q) => q.kind === 'frozen'); fz.push(b ? +(b.until - H.GAME.t).toFixed(2) : 0); }
      out.freeze = fz; P.buffs.length = 0;
      return out; })()""")
    st = r['stuns']
    check(abs(st[0] - 2) < 0.06 and abs(st[1] - 1) < 0.06 and abs(st[2] - 0.5) < 0.06 and st[3] == 0, f"repeated stuns on a player last full, half, a quarter, then not at all ({st})")
    check(any(h.startswith('stun:0') and h.endswith('i') for h in r['hud']), f"the class panel's state shows the immunity ({r['hud']})")
    check(r['refreshSame'] == 1, 'a control refreshed by the same source does not count again')
    check(abs(r['afterImmune'] - 2) < 0.06 and abs(r['afterWindow'] - 2) < 0.06, f"after the immunity the stun takes full hold again ({r['afterImmune']}, {r['afterWindow']})")
    check(all(abs(x - 2) < 0.06 for x in r['npc']), f"an ordinary soldier has no diminishing returns ({r['npc']})")
    pa = r['parry']
    check(pa[0] > 0.8 and 0 < pa[1] < pa[0] * 0.6 and pa[3] == 0, f"repeated parries stun less and less, then not at all ({pa})")
    fz = r['freeze']
    check(fz[0] > 1.4 and 0.6 < fz[1] < 0.9 and fz[3] == 0, f"a player frozen again and again thaws sooner, then cannot be frozen ({fz})")

    r = await ev(page, 'raise-offer', """(() => { const P = T.fresh('archer', 24, 1); const H = T.H, F = T.F, B = H.bal;
      const pr = T.foe(1, P.x + 9, P.z + 3, 22, 'priest', 18); pr.ai.nextAbility = 1e9; pr.combatUntil = -99;
      F.killEnt(P, null); H.simulate(1.5);
      const offer = !!B.BAL.offer, shown = !document.getElementById('death-raise').hidden, who = document.getElementById('death-raise-who').textContent;
      document.getElementById('btn-raise').click();
      let t = 0; for (; t < 20 && !P.alive; t += 0.5) H.simulate(0.5);
      return { offer, shown, who, alive: P.alive, hp: +(P.hp / P.maxHp).toFixed(2), t, modal: H.UI.modal, deathHidden: document.getElementById('death').hidden, near: +Math.hypot(pr.x - P.x, pr.z - P.z).toFixed(1) }; })()""")
    check(r['offer'] and r['shown'] and 'priest' in r['who'], f"an allied priest close by offers to raise the fallen player ({r['who']})")
    check(r['alive'] and 0.3 < r['hp'] < 0.6 and r['deathHidden'], f"accepted, the priest comes over and raises the player ({r['t']} s, {r['hp']*100:.0f}% health, priest {r['near']} m away)")

    r = await ev(page, 'tracked', """(() => { const P = T.fresh('archer', 20, 0); const H = T.H, F = T.F, C = H.cls;
      const a = T.ahead(P, 16); const f = T.foe(2, a.x, a.z, 20, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f);
      P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'cripple', f); H.simulate(1.2);
      const tracked = f.buffs.some((b) => b.kind === 'tracked' && b.src === P.id);
      H.frame(0.016); const n0 = H.errors.length;
      const R = C.layRune(P, P.x + 2, P.z + 2, 'fire');
      return { tracked, errors: H.errors.length - n0, cut: !!R.cut, glow: !!R.disc }; })()""")
    check(r['tracked'] and r['errors'] == 0, 'a crippled foe is tracked and marked on the minimap')
    check(r['cut'] and r['glow'], 'a rune is laid as a dark cut with a glow over it')

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



# ------------------------------------------------------------------ [balance3] the rules of version 11
B3 = ('b3' in ARGS) or MECH
B4 = ('b4' in ARGS) or MECH  # [balance4]
B5 = ('b5' in ARGS) or MECH  # [balance5]
B6 = ('b6' in ARGS) or MECH  # [balance6]
B7 = ('b7' in ARGS) or MECH  # [balance7]
async def balance3(page):
    """pursuit, frost holds, one rush, half-piercing bodkins and Deadeye, the dazzle, the shield wall, the wound and a
    priest's own healing by rank, and NPC warriors walling against a bow"""
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'pursuit', """(() => { const P = T.fresh('warrior', 20, 0); const H = T.H, F = T.F;
      const a = T.ahead(P, 18); const f = T.foe(2, a.x, a.z, 20, 'archer', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9;
      P.target = f.id; P.cds.charge = H.GAME.t + 9; const c0 = P.cds.charge - H.GAME.t;
      F.dealDamage(f, P, 10, { kind: 'arrow' }); const c1 = P.cds.charge - H.GAME.t;
      F.dealDamage(f, P, 10, { kind: 'fire' }); const c2 = P.cds.charge - H.GAME.t;
      F.dealDamage(f, P, 10, { kind: 'melee' }); const c3 = P.cds.charge - H.GAME.t;
      F.dealDamage(f, P, 10, { dot: true }); const c4 = P.cds.charge - H.GAME.t;
      P.hp = P.maxHp; return { c0: +c0.toFixed(2), c1: +c1.toFixed(2), c2: +c2.toFixed(2), c3: +c3.toFixed(2), c4: +c4.toFixed(2), desc: H.fn.ABILITIES ? '' : '' }; })()""")
    # [balance4] pursuit is set aside (PURSUIT_CD 0): it stood in for a Charge that never rushed
    check(abs(r['c0'] - r['c1']) < 0.05 and abs(r['c1'] - r['c2']) < 0.05, f"arrows and bolts no longer bring Charge sooner: it rushes now ({r['c0']} -> {r['c1']} -> {r['c2']})")
    check(abs(r['c2'] - r['c3']) < 0.05 and abs(r['c3'] - r['c4']) < 0.05, 'nor a blade or a burning wound')

    r = await ev(page, 'frost-holds', """(() => { const H = T.H, F = T.F, B3 = H.bal3; const out = {};
      for (const ml of [20, 30]) {
        const P = T.fresh('warrior', 30, 0); const a = T.ahead(P, 3); const m = T.foe(2, a.x, a.z, ml, 'mage', 0); m.ai.nextAbility = 1e9; m.swingAt = 1e9;
        const fa = T.ahead(P, 15); const t = T.foe(1, fa.x, fa.z, 30, 'warrior', 0); t.ai.nextAbility = 1e9; t.swingAt = 1e9;
        H.simulate(0.1); // the spatial grid knows where everyone is now
        H.cls.csOf(m).focus = 'frost'; m.cds = {}; m.gcdUntil = 0; m.power = m.maxPower; const why = F.useAbility(m, 'nova', null);
        const rooted = P.buffs.some((b) => b.kind === 'root' && b.frost);
        P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower;
        out['m' + ml] = { why, d: +Math.hypot(m.x - P.x, m.z - P.z).toFixed(1), buffs: P.buffs.map((b) => b.kind).join(','), rooted, deep: B3.deepFrostHeld(P), leap: B3.canUse(P, 'leap', t), charge: B3.canUse(P, 'charge', t) };
      }
      // a blizzard: no Charge or Leap out of it
      const P = T.fresh('warrior', 30, 0); const fa = T.ahead(P, 15); const t = T.foe(1, fa.x, fa.z, 30, 'warrior', 0); t.ai.nextAbility = 1e9;
      F.addBuff(P, 'snare', 0.4, 2, 999, { blizzard: true }); P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower;
      out.bliz = { leap: B3.canUse(P, 'leap', t), charge: B3.canUse(P, 'charge', t) };
      return out; })()""")
    check(r['m20']['rooted'] and r['m20']['leap'] == 'held' and r['m20']['charge'] is None, f"a frost root holds against Leap Strike, a Charge still tears free ({r['m20']})")
    check(r['m30']['rooted'] and r['m30']['deep'] and r['m30']['leap'] == 'held' and r['m30']['charge'] == 'held', f"a seasoned mage's frost holds against Charge too ({r['m30']})")
    check(r['bliz']['leap'] == 'held' and r['bliz']['charge'] == 'held', f"no Charge or Leap Strike out of a blizzard ({r['bliz']})")

    r = await ev(page, 'rush', """(() => { const H = T.H, F = T.F; const P = T.fresh('warrior', 30, 0);
      const fa = T.ahead(P, 15); const t = T.foe(1, fa.x, fa.z, 30, 'warrior', 0); t.ai.nextAbility = 1e9; t.swingAt = 1e9; P.target = t.id;
      P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; const w1 = F.useAbility(P, 'charge', t); const leapCd = (P.cds.leap || 0) - H.GAME.t;
      H.simulate(1); const P2 = T.fresh('warrior', 30, 0); const fb = T.ahead(P2, 15); const t2 = T.foe(1, fb.x, fb.z, 30, 'warrior', 0); t2.ai.nextAbility = 1e9; t2.swingAt = 1e9;
      P2.cds = {}; P2.gcdUntil = 0; P2.power = P2.maxPower; const w2 = F.useAbility(P2, 'leap', t2); const chCd = (P2.cds.charge || 0) - H.GAME.t;
      const P3 = T.fresh('warrior', 20, 0); const fc = T.ahead(P3, 15); const t3 = T.foe(1, fc.x, fc.z, 20, 'warrior', 0); t3.ai.nextAbility = 1e9; P3.cds = {}; P3.gcdUntil = 0; P3.power = P3.maxPower;
      F.useAbility(P3, 'charge', t3); const low = (P3.cds.leap || 0) - H.GAME.t;
      H.simulate(1.2); return { w1, leapCd: +leapCd.toFixed(1), w2, chCd: +chCd.toFixed(1), low: +low.toFixed(1), share: H.bal7 ? H.bal7.B7T.rushShare : 10 }; })()""")
    check(r['w1'] is True and r['leapCd'] >= r['share'] - 0.1 and r['w2'] is True and r['chCd'] >= r['share'] - 0.1, f"Charge and Leap Strike are one rush ({r['leapCd']} s, {r['chCd']} s; [balance7] the share {r['share']} s)")
    check(r['low'] <= 0, 'below Leap Strike a Charge holds nothing back')

    r = await ev(page, 'pierce', """(() => { const H = T.H, F = T.F; const P = T.fresh('archer', 50, 0);
      const a = T.ahead(P, 10); const f = T.foe(2, a.x, a.z, 50, 'warrior', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.testDummy = true; f.drBase = 0.5; f.maxHp *= 50; f.hp = f.maxHp;
      const hit = (opts) => { let s = 0; for (let i = 0; i < 40; i++) { const hp0 = f.hp; F.dealDamage(P, f, 100, opts); s += hp0 - f.hp; f.hp = f.maxHp; } return s / 40; };
      f.buffs.length = 0; f.cs = null;
      const plain = hit({ kind: 'arrow' }), half = hit({ kind: 'arrow', pierce: H.bal3.BODKIN_PIERCE }), full = hit({ kind: 'arrow', pierce: true });
      return { plain: Math.round(plain), half: Math.round(half), full: Math.round(full) }; })()""")
    check(abs(r['half'] / max(1, r['plain']) - 1.5) < 0.12 and abs(r['full'] / max(1, r['plain']) - 2) < 0.15, f"half a piercing goes through half the armour ({r['plain']}, {r['half']}, {r['full']} against armour 0.5)")

    r = await ev(page, 'dazzle', """(() => { const H = T.H, F = T.F, C = H.cls, B3 = H.bal3; const out = {};
      for (const pl of [10, 30, 50]) {
        const P = T.fresh('warrior', pl, 0); const a = T.ahead(P, 2.2); const pr = T.foe(2, a.x, a.z, pl, 'priest', 0); pr.ai.nextAbility = 1e9; pr.swingAt = 1e9;
        F.dealDamage(pr, P, 5, { kind: 'holy' }); const b = P.buffs.find((q) => q.kind === 'dazzle');
        // the dazzled warrior swings: some blows miss
        let miss = 0; const N = 400; for (let i = 0; i < N; i++) { if (C.classHarm(P, pr, 100, { kind: 'melee' }) === 0) miss++; }
        // and raises the shield just as the priest's mace comes: a parry only below rank II
        P.yaw = Math.atan2(pr.x - P.x, pr.z - P.z); C.csOf(P).blockDown = -9; C.classHold(true); H.simulate(0.05);
        const p0 = C.CLS.stats.parries; F.dealDamage(pr, P, 50, { kind: 'melee' }); const parried = C.CLS.stats.parries - p0; C.classHold(false);
        F.dealDamage(pr, P, 5, { kind: 'holy', holy: true }); const ground = P.buffs.filter((q) => q.kind === 'dazzle').length;
        out[pl] = { v: b ? +b.value.toFixed(2) : 0, dur: b ? +(b.until - H.GAME.t).toFixed(1) : 0, miss: +(miss / N).toFixed(2), parried, dazzled: B3.dazzled(P) };
        P.hp = P.maxHp;
      }
      return out; })()""")
    for lv, want in ((10, 0.15), (30, 0.18), (50, 0.24)):  # [balance4] 0.15 to 0.24 (version 11: 0.05, 0.17, 0.35)
        q = r[str(lv)]
        check(abs(q['v'] - want) < 0.01 and q['dur'] >= 2.9, f"holy light dazzles a level {lv} foe ({q['v']} for {q['dur']} s)")
        check(abs(q['miss'] - want) < 0.07, f"a dazzled warrior misses about {want:.0%} of its blows at level {lv} ({q['miss']})")
    check(r['10']['parried'] == 0 and r['30']['parried'] == 0 and r['50']['parried'] == 0, f"a dazzled warrior cannot parry, at every rank now ([balance4]: {r['10']['parried']}, {r['30']['parried']}, {r['50']['parried']})")

    r = await ev(page, 'wall', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('warrior', 20, 0); const out = {};
      for (const st of [0, 1]) { C.setStance(P, st); C.csOf(P).stanceAt = -9; P.buffs.length = 0; C.classHold(true); H.simulate(0.1); out['s' + st] = +(H.bal3.effectiveSpeed(P) / P.speed).toFixed(2); C.classHold(false); H.simulate(0.6); }
      // an NPC warrior, guarded, walls against an archer out of reach
      const a = T.ahead(P, 3); const w = T.foe(2, a.x, a.z, 30, 'warrior', 30); w.ai.nextAbility = 1e9; const b = T.ahead(P, 25); const ar = T.foe(0, b.x, b.z, 30, 'archer', 0); ar.ai.nextAbility = 1e9; ar.swingAt = 1e9;
      w.target = ar.id; C.csOf(w).stance = 0; w.cds.charge = H.GAME.t + 30; w.cds.leap = H.GAME.t + 30; P.x += 60; H.simulate(0.4);
      out.npcWall = C.csOf(w).blockOn; out.wantNear = H.bal3.npcWallWanted(w, ar);
      return out; })()""")
    check(r['s0'] >= 0.99 and abs(r['s1'] - 0.55) < 0.03, f"guarded, a warrior walks at full pace behind a raised shield ([balance4]; balanced {r['s1']}, guarded {r['s0']})")
    check(r['npcWall'], f"an NPC warrior raises a shield wall against a bow out of reach ({r})")

    r = await ev(page, 'wound', """(() => { const H = T.H, F = T.F, B = H.bal; const out = {};
      for (const lv of [20, 30, 50]) { const P = T.fresh('archer', lv, 0); out[lv] = { wound: B.woundOf(P), self: +B.priestSelf({ level: lv }).toFixed(3) }; }
      return out; })()""")
    check(r['20']['wound'] == 0.3 and r['30']['wound'] == 0.3 and r['50']['wound'] == 0.3, f"a broadhead's wound: 30% at every rank ([balance5]: 45% from rank II before) ({r})")
    check(abs(r['20']['self'] - 0.76) < 0.01 and abs(r['30']['self'] * 1.12 - 0.55) < 0.01 and abs(r['50']['self'] * 1.36 - 0.55) < 0.01, f"a priest's own healing: 76% ([balance5] 70%, [balance6] 76%), then a steady 55% of rank I's from rank II ({r['20']['self']}, {r['30']['self']}, {r['50']['self']})")
    errs = await page.evaluate("__hm.errors.slice(0, 3)")
    check(not errs, f'no runtime errors in the [balance3] checks {errs[:2]}')

async def balance4(page):
    """[balance4] Charge rushes (and stops at a snare in its path, waits for its footing, holds Shield Bash back), not on a
    horse or in the water; Mend weighs the wound; a priest in its own column mends as its own wounds do; Rallying Cry's
    heal does not grow with rank; a volley falls over a raised shield; a dazzled warrior cannot parry at rank I; the
    realm's way can be set aside for a measure (plainCalling)"""
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'rush', """(() => { const H = T.H, F = T.F; const P = T.fresh('warrior', 20, 0);
      const a = T.ahead(P, 18); const f = T.foe(2, a.x, a.z, 20, 'mage', 0); /* (not a bow: an archer slips one blade in seven) */ f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 20 }; F.setupStats(f);
      H.simulate(0.1); P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; const d0 = Math.hypot(f.x - P.x, f.z - P.z), hp0 = f.hp;
      const r = F.useAbility(P, 'charge', f); const trail = [];
      for (let i = 0; i < 6; i++) { H.simulate(0.2); trail.push(+Math.hypot(f.x - P.x, f.z - P.z).toFixed(1)); }
      const landed = H.bal4.RUSH.stats.arrived; const harm = Math.round(hp0 - f.hp);
      // the footing and the shield arm: right after the rush, abilities wait and Shield Bash waits longer
      const P2 = T.fresh('warrior', 20, 0); const b = T.ahead(P2, 14); const f2 = T.foe(2, b.x, b.z, 20, 'warrior', 0); f2.ai.nextAbility = 1e9; f2.swingAt = 1e9; f2.tweak = { hp: 20 }; F.setupStats(f2);
      H.simulate(0.1); P2.cds = {}; P2.gcdUntil = 0; P2.power = P2.maxPower; F.useAbility(P2, 'charge', f2);
      let t = 0; while (P2.motion && t < 3) { H.simulate(0.05); t += 0.05; }
      const footing = F.useAbility ? H.bal.canUse(P2, 'slash', f2) : null; H.simulate(1.05); const after = H.bal.canUse(P2, 'slash', f2), bash = H.bal.canUse(P2, 'bash', f2);
      return { r, d0: +d0.toFixed(1), trail, harm, footing, after, bash, rushT: +t.toFixed(2) }; })()""")
    check(r['r'] is True and r['trail'][-1] < 3.2 and r['trail'][0] < r['d0'] - 2, f"Charge rushes the warrior to the foe ({r['d0']} m -> {r['trail']})")
    check(r['harm'] > 0, f"and strikes it as it lands ({r['harm']} harm)")
    check(r['footing'] == 'cooldown' and r['after'] is None and r['bash'] == 'cooldown', f"its abilities wait for its footing, Shield Bash longer ({r['footing']}, then {r['after']}; bash {r['bash']})")
    r = await ev(page, 'rush-snare', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('warrior', 20, 0);
      const a = T.ahead(P, 20); const ar = T.foe(2, a.x, a.z, 20, 'archer', 0); ar.ai.nextAbility = 1e9; ar.swingAt = 1e9; ar.yaw = Math.atan2(P.x - ar.x, P.z - ar.z);
      H.simulate(0.1); C.laySnare(ar); H.simulate(1.2); const S = C.CLS.snares[C.CLS.snares.length - 1];
      // on the rush's way: half way between them (a snare at the bow's feet lies inside the rush's reach, where it stops)
      S.x = (P.x + ar.x) / 2; S.z = (P.z + ar.z) / 2; S.y = F.floorAt ? F.floorAt(S.x, S.z, P.y + 0.3) : S.y; if (S.mesh) S.mesh.position.set(S.x, S.y, S.z);
      P.target = ar.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'charge', ar);
      for (let i = 0; i < 30 && P.motion; i++) H.simulate(0.05);
      return { sprung: !!S.sprung, caught: S.caught === P.id, rooted: P.buffs.some((b) => b.kind === 'root' && b.until > H.GAME.t), d: +Math.hypot(ar.x - P.x, ar.z - P.z).toFixed(1), toSnare: +Math.hypot(S.x - P.x, S.z - P.z).toFixed(1) }; })()""")
    check(r['caught'] and r['rooted'] and r['d'] > 2.0, f"a snare in the rush's path catches the warrior and holds it there ({r})")
    # [balance4] a foe walking away is reached on the step that closes on it (the rush ran at its heels for 1.9 s), and
    # until Leap Strike the blow slows it by 45% for 3 s; from Leap Strike's level it does not slow
    r = await ev(page, 'rush-flee', """(() => { const H = T.H, F = T.F; const out = {};
      for (const lv of [20, 30]) { const P = T.fresh('warrior', lv, 0); const a = T.ahead(P, 14); const f = T.foe(2, a.x, a.z, lv, 'archer', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 20, speed: 0.01 }; F.setupStats(f);
        H.simulate(0.1); P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; f.buffs.length = 0;
        const L = Math.hypot(f.x - P.x, f.z - P.z), ux = (f.x - P.x) / L, uz = (f.z - P.z) / L; let t = 0;
        F.useAbility(P, 'charge', f);
        while (P.motion && t < 2.5) { f.x += ux * 0.3; f.z += uz * 0.3; H.simulate(0.05); t += 0.05; }
        H.simulate(0.25); const sl = f.buffs.find((b) => b.kind === 'snare' && b.until > H.GAME.t);
        out[lv] = { t: +t.toFixed(2), d: +Math.hypot(f.x - P.x, f.z - P.z).toFixed(1), slow: sl ? +sl.value.toFixed(2) : 0, slowFor: sl ? +(sl.until - H.GAME.t).toFixed(1) : 0 }; }
      return out; })()""")
    check(r['20']['t'] < 1.3 and r['20']['d'] < 3.6, f"a rush reaches a foe walking away from it at 6 m/s ({r['20']})")
    rse = await page.evaluate("__hm.bal4.RUSH_SLOW_EARLY")  # [balance6] 40% for 2.5 s (45% for 3 s)
    check(abs(r['20']['slow'] - rse[0]) < 0.01 and r['20']['slowFor'] > rse[1] - 0.6, f"until Leap Strike the rush's blow slows by {rse[0]:.0%} for {rse[1]} s ({r['20']})")
    late = await page.evaluate("!!(__hm.bal7 && __hm.bal7.B7T.chargeSlowLate)")  # [balance7] its blow slows at every level now
    check((abs(r['30']['slow'] - rse[0]) < 0.01) if late else r['30']['slow'] == 0, f"from Leap Strike's level the rush's blow {'slows as below it ([balance7])' if late else 'does not slow'} ({r['30']})")
    # [balance4] a skilled priest of rank I holds its mace from a warrior's guard; from rank II it swings
    r = await ev(page, 'hold-mace', """(() => { const H = T.H; const out = {};
      for (const lv of [10, 30]) { const P = T.fresh('warrior', lv, 0); const a = T.ahead(P, 2.5); const pr = T.F.spawnRealmUnit(2, 'priest', lv, 'bot', a.x, a.z); pr.testFoe = true; H.bal.botMake(pr, 'skilled'); pr.target = P.id; H.simulate(0.6); out[lv] = !!(pr.bot && pr.bot.holdMace); }
      return out; })()""")
    check(r['10'] is True and r['30'] is False, f"a skilled priest of rank I holds its mace from a warrior's guard, not from rank II ({r})")
    r = await ev(page, 'rush-why', """(() => { const H = T.H; const P = T.fresh('warrior', 20, 0); const A = { dash: true, id: 'charge' };
      const out = { foot: H.bal4.rushWhy(P, A, null) }; P.mount = {}; out.mounted = H.bal4.rushWhy(P, A, null); P.mount = null; P.swim = true; out.swim = H.bal4.rushWhy(P, A, null); P.swim = false;
      // a posted guard rushes only at a foe within its leash of its post
      const a = T.ahead(P, 16); const g = T.foe(2, a.x, a.z, 20, 'warrior', 4); out.post = H.bal4.rushWhy(g, A, P); g.ai.post.leash = 20; out.near = H.bal4.rushWhy(g, A, P); return out; })()""")
    check(r['foot'] is None and r['mounted'] == 'mounted' and r['swim'] == 'swimming', f"no rush on a horse or in the water ({r})")
    check(r['post'] == 'post' and r['near'] is None, f"a guard at its post rushes only at a foe within its leash ({r})")
    r = await ev(page, 'mend', """(() => { const H = T.H, F = T.F, C = H.cls; const out = {};
      for (const k of [0.95, 0.75, 0.4]) { const P = T.fresh('priest', 20, 0); C.csOf(P).dev = 0; P.hp = P.maxHp * k; P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0; const h0 = P.hp;
        F.useAbility(P, 'mend', P); H.simulate(1.7); out[k] = +((P.hp - h0) / P.maxHp).toFixed(3); }
      out.wound = [0.95, 0.75, 0.4].map((k) => +H.bal4.mendWound({ hp: k, maxHp: 1 }).toFixed(2)); return out; })()""")
    check(r['0.4'] > 0.25 and r['0.75'] < r['0.4'] * 0.8 and r['0.95'] <= 0.05 + 1e-3, f"Mend weighs the wound: a deep one mends in full, a light one less, a scratch little ({r})")
    r = await ev(page, 'pillar-self', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('priest', 30, 0); C.csOf(P).dev = 0;
      const a = T.ahead(P, 2.5); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9;
      H.simulate(0.1); P.hp = P.maxHp * 0.3; P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0; F.useAbility(P, 'pillar', f);
      // the column's heal lands at once; the rest of the climb is the body's own mending (measure the one step it lands in)
      let jump = 0; for (let i = 0; i < 50; i++) { const h = P.hp; H.simulate(0.05); jump = Math.max(jump, P.hp - h); }
      return { healed: +(jump / P.maxHp).toFixed(3), want: +(0.3 * H.fn.rankMult(30) * H.bal.priestSelf(P)).toFixed(3) }; })()""")
    check(abs(r['healed'] - r['want']) < 0.03, f"a priest in its own Pillar of Dawn mends as its own wounds do ({r})")
    r = await ev(page, 'rally', """(() => { const H = T.H, F = T.F, C = H.cls; const out = {};
      for (const lv of [20, 30, 50]) { const P = T.fresh('warrior', lv, 0); C.setStance(P, 1); P.hp = P.maxHp * 0.3; const h0 = P.hp; P.power = P.maxPower; P.cds = {}; P.gcdUntil = 0; F.useAbility(P, 'rally', P); out[lv] = +((P.hp - h0) / P.maxHp).toFixed(3); }
      return out; })()""")
    check(all(abs(v - 0.35) < 0.01 for v in r.values()), f"Rallying Cry heals 35% (balanced) at every rank ({r})")
    r = await ev(page, 'volley-shield', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 15); const ar = T.foe(2, a.x, a.z, 30, 'archer', 0); ar.ai.nextAbility = 1e9; ar.swingAt = 1e9; P.yaw = Math.atan2(ar.x - P.x, ar.z - P.z);
      C.setStance(P, 0); C.csOf(P).stanceAt = -9; C.classHold(true); H.simulate(0.1); C.csOf(P).blockAt = -9;
      const arrow = C.classHarm(ar, P, 100, { kind: 'arrow' }), volley = C.classHarm(ar, P, 100, { kind: 'aoe' }); C.classHold(false);
      return { arrow: Math.round(arrow), volley: Math.round(volley) }; })()""")
    check(r['arrow'] < 30 and r['volley'] > 60, f"a raised shield turns an arrow but not a volley falling from above ({r})")
    r = await ev(page, 'plain', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('warrior', 20, 2); const a = T.ahead(P, 2); const f = T.foe(1, a.x, a.z, 20, 'warrior', 0); f.ai.nextAbility = 1e9;
      C.setStance(P, 2); P.hp = P.maxHp * 0.25; let s0 = 0, s1 = 0; for (let i = 0; i < 200; i++) s0 += C.classHarm(P, f, 100, { kind: 'melee', dot: true }); P.plainCalling = true; for (let i = 0; i < 200; i++) s1 += C.classHarm(P, f, 100, { kind: 'melee', dot: true }); P.plainCalling = false; P.hp = P.maxHp;
      return { berserk: +(s0 / 200).toFixed(1), plain: +(s1 / 200).toFixed(1) }; })()""")
    check(r['berserk'] > r['plain'] * 1.05, f"a measure can set the realm's way aside: a Thule warrior's Berserk against the plain calling ({r})")
    errs = await page.evaluate("__hm.errors.slice(0, 3)")
    check(not errs, f'no runtime errors in the [balance4] checks {errs[:2]}')


async def balance5(page):
    """[balance5] Holy Fire flares a caster's spell away (not a steadfast one) within 10 m; every Renewal on yourself
    steadies; Whirlwind heals in the press; the realm's ways evened out"""
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'flare', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('priest', 20, 0);
      const a = T.ahead(P, 8); const m = T.foe(2, a.x, a.z, 20, 'mage', 0); m.ai.nextAbility = 1e9; m.swingAt = 1e9; H.simulate(0.1);
      const out = {};
      // a mage in the middle of a firebolt close by: Holy Fire breaks it
      m.cds = {}; m.gcdUntil = 0; m.power = m.maxPower; F.useAbility(m, 'firebolt', P); H.simulate(0.3); out.casting = !!m.casting;
      P.target = m.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; out.r = F.useAbility(P, 'holyfire', m); out.broken = !m.casting;
      // one beyond the flare's reach keeps its spell
      const a3 = T.ahead(P, 16, -5); const m3 = T.foe(2, a3.x, a3.z, 20, 'mage', 0); m3.ai.nextAbility = 1e9; m3.swingAt = 1e9; H.simulate(0.1);
      m3.cds = {}; m3.gcdUntil = 0; m3.power = m3.maxPower; F.useAbility(m3, 'firebolt', P); H.simulate(0.3); P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'holyfire', m3); out.far = !!m3.casting; m3.casting = null;
      // a priest steadfast from its own Renewal keeps its spell
      const a2 = T.ahead(P, 6, 3); const q = T.foe(2, a2.x, a2.z, 20, 'priest', 0); q.ai.nextAbility = 1e9; q.swingAt = 1e9; H.simulate(0.1);
      q.cds = {}; q.gcdUntil = 0; q.power = q.maxPower; q.hp = q.maxHp * 0.6; F.useAbility(q, 'renew', q); out.steady = H.fn.hasBuff(q, 'steadfast');
      q.gcdUntil = 0; F.useAbility(q, 'mend', q); H.simulate(0.2); P.cds = {}; P.gcdUntil = 0; F.useAbility(P, 'holyfire', q); out.kept = !!q.casting;
      // a second Renewal while the first still mends does not steady
      H.simulate(4.5); const q2 = q.buffs.some((b) => b.kind === 'steadfast' && b.until > H.GAME.t); q.cds = {}; q.gcdUntil = 0; q.casting = null; F.useAbility(q, 'renew', q); out.stale = q.buffs.some((b) => b.kind === 'steadfast' && b.until > H.GAME.t); out.q2 = q2;
      // and one cast after the last has run its course does
      H.simulate(9); q.cds = {}; q.gcdUntil = 0; F.useAbility(q, 'renew', q); out.fresh = q.buffs.some((b) => b.kind === 'steadfast' && b.until > H.GAME.t);
      out.stats = H.bal5.BAL5.stats; return out; })()""")
    check(r['casting'] and r['r'] is True and r['broken'], f"Holy Fire flares a mage's firebolt away ({r})")
    check(r['far'], f"a mage beyond the flare's reach keeps its spell ({r['far']})")
    check(r['steady'] and r['kept'], f"a priest steadfast from its own Renewal keeps its Mend through the flare ({r})")
    check(not r['q2'] and r['stale'] and r['fresh'], f"every Renewal on yourself steadies for 4 s (the fresh Renewal's rule was tried and set aside) ({r})")
    r = await ev(page, 'wound', """(() => { const H = T.H, F = T.F; const P = T.fresh('archer', 20, 0);
      const a = T.ahead(P, 14); const q = T.foe(2, a.x, a.z, 20, 'priest', 0); q.ai.nextAbility = 1e9; q.swingAt = 1e9; H.simulate(0.1);
      P.target = q.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; H.cls.csOf(P).arrow = 'plain'; F.useAbility(P, 'cripple', q); H.simulate(1.2);
      const w = q.buffs.find((b) => b.kind === 'wound' && b.until > H.GAME.t); q.hp = q.maxHp * 0.5; const h0 = q.hp; H.bal5.healEnt(q, q, 100);
      return { wound: w ? +w.value.toFixed(2) : 0, left: w ? +(w.until - H.GAME.t).toFixed(1) : 0, healed: Math.round(q.hp - h0) }; })()""")
    check(abs(r['wound'] - 0.3) < 0.01 and r['left'] > 3 and abs(r['healed'] - 70) <= 1, f"a crippling arrow's wound (a plain arrow): healing on it takes 30% less while it slows ({r})")
    r = await ev(page, 'whirl', """(() => { const H = T.H, F = T.F; const out = {};
      for (const n of [1, 4]) { const P = T.fresh('warrior', 30, 0); H.simulate(0.1);
        for (let i = 0; i < n; i++) { const a = T.ahead(P, 2.2, (i - (n - 1) / 2) * 1.4); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 20 }; F.setupStats(f); }
        H.simulate(0.1); P.hp = P.maxHp * 0.4; const h0 = P.hp; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'whirl', P); H.simulate(1.0);
        out[n] = +((P.hp - h0) / P.maxHp).toFixed(3); }
      return out; })()""")
    check(r['1'] >= 0.035 and abs(r['4'] - r['1'] - 0.12) < 0.03, f"Whirlwind gives back 2% for each foe each of its two cuts strikes (one foe, four: {r}; the rest is the body's own mending over the second)")
    r = await ev(page, 'realms', """(() => { const H = T.H, F = T.F, C = H.cls; const out = {};
      for (const R of [0, 1, 2]) { const P = T.fresh('archer', 20, R); C.csOf(P).drawFrom = H.GAME.t; H.simulate(0.6); out['draw' + R] = +C.drawK(P).toFixed(2); C.csOf(P).drawFrom = -1; }
      out.A = H.bal5.ARCHER_REALM; out.text = C.CLASS_REALM.archer.map((q) => q.text.slice(0, 40)); return out; })()""")
    ld = r['A']['logresDraw']  # [balance6] 0.92 (0.85): the check reads the measure
    if await page.evaluate("!!__hm.bal7"):  # [balance7] the Logres way is an edge from a perch only (classes.py b7 checks it there)
        check(abs(r['draw0'] - r['draw1']) < 0.02 and abs(r['draw1'] - r['draw2']) < 0.02, f"on the ground a Logres archer draws as the others do ([balance7]: from a perch a quarter sooner) ({r['draw0']}, {r['draw1']}, {r['draw2']})")
    else:
        check(abs(r['draw0'] / max(1e-6, r['draw1']) - 1 / ld) < 0.06 and abs(r['draw1'] - r['draw2']) < 0.02, f"a Logres archer draws {round((1 - ld) * 100)}% sooner ({r['draw0']}, {r['draw1']}, {r['draw2']})")
    errs = await page.evaluate("__hm.errors.slice(0, 3)")
    check(not errs, f'no runtime errors in the [balance5] checks {errs[:2]}')

async def balance6(page):
    """[balance6] renewing by rote costs power; a mage's ward keeps its spell from a breaking blow; a skilled archer takes
    a priest for a blade at its throat only at its mace; the Well of Eriu heals beside the Renewal"""
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'rote', """(() => { const H = T.H, F = T.F; const P = T.fresh('priest', 30, 0); const out = {};
      const cost = () => { P.cds = {}; P.gcdUntil = 0; const p0 = P.power; F.useAbility(P, 'renew', P); return Math.round(p0 - P.power); };
      P.power = P.maxPower; out.first = cost(); H.simulate(1); out.again = cost(); H.simulate(9.5); out.spent = cost();
      out.steady = H.fn.hasBuff(P, 'steadfast'); out.base = H.bal5.ABILITIES.renew.cost; out.K = H.bal6.RENEW_ROTE_K; out.next = H.bal6.STEADY_NEXT; return out; })()""")
    check(r['first'] == r['base'] and r['again'] == r['base'] * r['K'] and r['spent'] == r['base'] and r['steady'] and not r['next'], f"renewing yourself while your last Renewal still mends costs twice the power; renewing after it has run out, the usual; steadfast as before ({r})")
    r = await ev(page, 'misc', """(() => { const H = T.H, B6 = H.bal6, t = H.GAME.t; const out = {};
      out.mage = [10, 30, 40, 50].map((l) => +H.bal4.mageRankK({ level: l }).toFixed(2));
      const w = { cds: { charge: t + 16 } }; B6.rushHeld(w); out.held = +(w.cds.charge - t).toFixed(2);
      out.slow = H.bal4.RUSH_SLOW_EARLY; return out; })()""")
    check(str(r['mage']) == '[1, 1.12, 1.14, 1.16]', f"a seasoned mage's spells: 12% from rank II, 2% more a rank after ({r['mage']})")
    check(abs(r['held'] - 8) < 0.01, f"a Charge held on its way comes round in half its wait ({r['held']} s of 16)")
    r = await ev(page, 'ward', """(() => { const H = T.H, F = T.F; const P = T.fresh('mage', 30, 0); const out = {};
      P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'ward', P); H.simulate(0.1);
      const w = () => { const b = P.buffs.find((q) => q.kind === 'shield' && q.src === P.id && q.until > H.GAME.t); return b ? b.value : 0; };
      const a = T.ahead(P, 15); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 20 }; F.setupStats(f); H.simulate(0.05);
      const w0 = w(); P.gcdUntil = 0; P.target = f.id; F.useAbility(P, 'firebolt', f); H.simulate(0.2); out.casting = !!P.casting;
      out.broke = H.bal.breakCast(P); out.kept = !!P.casting; out.left = +(w() / w0).toFixed(2);
      P.casting = null; P.buffs = P.buffs.filter((b) => b.kind !== 'shield' && b.kind !== 'eward'); P.gcdUntil = 0; P.cds = {}; F.useAbility(P, 'firebolt', f); H.simulate(0.2);
      out.bare = H.bal.breakCast(P) && !P.casting; return out; })()""")
    check(r['casting'] and not r['broke'] and r['kept'] and abs(r['left'] - 0.75) < 0.02, f"a mage's ward keeps its spell from a breaking blow and loses a quarter of what it holds ({r})")
    check(r['bare'], f"without the ward the blow breaks the spell ({r['bare']})")
    r = await ev(page, 'presser', """(() => { const H = T.H, F = T.F; const P = T.fresh('archer', 30, 0); const out = {};
      H.bal.botMake(P, 'skilled', null);
      const a = T.ahead(P, 8); const q = T.foe(2, a.x, a.z, 30, 'priest', 0); q.ai.nextAbility = 1e9; q.target = P.id; H.simulate(0.05); q.target = P.id;
      out.far = !H.bal6.archerPresser(P, 9);
      q.x = P.x + Math.sin(P.yaw) * 2.6; q.z = P.z + Math.cos(P.yaw) * 2.6; q.target = P.id; out.near = !!H.bal6.archerPresser(P, 9);
      const b2 = T.ahead(P, 7, 3); const w = T.foe(2, b2.x, b2.z, 30, 'warrior', 0); w.target = P.id; out.blade = H.bal6.archerPresser(P, 9) === q || !!H.bal6.archerPresser(P, 9);
      P.bot = null; return out; })()""")
    check(r['far'] and r['near'] and r['blade'], f"a skilled archer takes a priest for a blade at its throat only at its mace, a warrior within 9 m ({r})")
    r = await ev(page, 'well', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('priest', 20, 1); const out = {};
      /* devotion fades from its last gain: a long run's clock had faded it to nothing */
      C.csOf(P).dev = 60; C.csOf(P).devAt = H.GAME.t; C.csOf(P).devTick = H.GAME.t; P.hp = P.maxHp * 0.5; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'renew', P); H.simulate(0.05);
      const hots = P.buffs.filter((b) => b.kind === 'hot' && b.until > H.GAME.t);
      out.n = hots.length; out.src = hots.map((b) => b.src === P.id ? 'renew' : String(b.src)); out.well = +(hots.filter((b) => b.src === 'well').reduce((a, b) => a + b.value, 0) / P.maxHp).toFixed(4);
      const h0 = P.hp; H.simulate(3.02); out.healed = +((P.hp - h0) / P.maxHp).toFixed(3); return out; })()""")
    check(r['n'] == 2 and 'well' in r['src'] and 'renew' in r['src'] and abs(r['well'] - 0.012) < 0.002, f"the Well of Eriu heals beside the Renewal, not merged into it ({r})")
    errs = await page.evaluate("__hm.errors.slice(0, 3)")
    check(not errs, f'no runtime errors in the [balance6] checks {errs[:2]}')

async def balance7(page):
    """[balance7] the archers' realm ways are edges on their own ground: Logres from a wall or a perch, Eriu among trees,
    Thule in the cold; elsewhere an archer of the realm shoots as a plain one"""
    await page.evaluate("() => {" + MECH_JS + "; return 0; }")
    r = await ev(page, 'logres', """(() => { const H = T.H, F = T.F, B7 = H.bal7; const out = {};
      const P = T.fresh('archer', 30, 0); out.ground = { draw: B7.archerDrawK(P), high: B7.archerHighK(P), wind: B7.archerWindK(P) };
      const y0 = P.y; P.fixedY = y0 + 4; P.y = y0 + 4; out.perch = { draw: B7.archerDrawK(P), high: B7.archerHighK(P) };
      const Q = T.fresh('archer', 30, 1); Q.fixedY = Q.y + 4; Q.y = Q.fixedY; out.eriuPerch = B7.archerDrawK(Q); Q.fixedY = null;
      const L = T.fresh('archer', 8, 0); L.fixedY = L.y + 4; L.y = L.fixedY; out.young = B7.archerDrawK(L); L.fixedY = null;
      return out; })()""")
    check(r['ground']['draw'] == 1 and r['ground']['high'] == 1 and r['ground']['wind'] == 1, f"a Logres archer on the ground draws and shoots as a plain one ({r['ground']})")
    check(abs(r['perch']['draw'] - 0.75) < 1e-6 and abs(r['perch']['high'] - 1.2) < 1e-6, f"from a perch it reaches full draw a quarter sooner and strikes 20% harder ({r['perch']})")
    check(r['eriuPerch'] == 1 and r['young'] == 1, f"not an archer of Eriu, nor one below the realm's way's level ({r['eriuPerch']}, {r['young']})")
    r = await ev(page, 'eriu', """(() => { const H = T.H, F = T.F, B7 = H.bal7, C = H.cls; const out = {};
      const P = T.fresh('archer', 30, 1); out.open = { trees: B7.archerTrees(P), hide: B7.archerHideT(P), walk: B7.archerHideWalk(P), amb: B7.archerAmbushK(P) };
      // among trees: two or more standing within 7 m
      const near = H.seasons.treesNear(P.x, P.z, 500); let spot = null;
      for (const t of near) { if (C.treesNear(t.x + 1.6, t.z, 7) >= 3 && F.isWalkable(t.x + 1.6, t.z)) { spot = t; break; } }
      if (!spot) return { open: out.open, none: true };
      H.teleport(spot.x + 1.6, spot.z); H.simulate(0.3); P.combatUntil = 0;
      out.woods = { trees: B7.archerTrees(P), hide: B7.archerHideT(P), walk: B7.archerHideWalk(P), amb: B7.archerAmbushK(P) };
      // hiding there: standing still, it is hidden within a second
      H.simulate(1.0); out.hidden = C.csOf(P).hidden; out.cover = +C.csOf(P).cover.toFixed(2);
      const Q = T.fresh('archer', 30, 0); H.teleport(spot.x + 1.6, spot.z); H.simulate(0.3); Q.combatUntil = 0; H.simulate(1.0); out.logresHidden = C.csOf(Q).hidden; H.simulate(1.0); out.logresLater = C.csOf(Q).hidden;
      return out; })()""")
    check(r['open']['hide'] == 1.5 and r['open']['walk'] == 1.2 and r['open']['amb'] == 1.5, f"an Eriu archer in the open hides as any archer does ({r['open']})")
    check(not r.get('none') and r['woods']['trees'] >= 2 and r['woods']['hide'] == 0.75 and r['woods']['walk'] > 4 and abs(r['woods']['amb'] - 1.8) < 1e-6, f"among trees it hides in half the time, walks hidden and strikes 80% harder from hiding ({r.get('woods')})")
    check(r.get('hidden') and not r.get('logresHidden') and r.get('logresLater'), f"there it is hidden within a second, a Logres archer only after 1.5 s ({r.get('hidden')}, {r.get('logresHidden')}, {r.get('logresLater')}; cover {r.get('cover')})")
    r = await ev(page, 'thule', """(() => { const H = T.H, F = T.F, B7 = H.bal7, C = H.cls; const out = {}; const k0 = H.farm.SEASON.k;
      const snare = (P) => { const a = T.ahead(P, 1.2); C.laySnare(P); H.simulate(1.2); const S = C.CLS.snares[C.CLS.snares.length - 1]; const f = T.foe(1, S.x, S.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.x = S.x; f.z = S.z; H.simulate(0.2);
        const root = f.buffs.find((b) => b.kind === 'root' && b.src === P.id); return { caught: S.caught === f.id, root: root ? +(root.until - H.GAME.t + 0.2).toFixed(2) : 0, frozen: !!C.frozenOf(f) }; };
      // the south in spring by day: warm (Thule's own lands are cold most of the year: its edge there)
      const P = T.fresh('archer', 30, 2); H.setTod(0.5); const Lt = H.REALMS[0].town; let warm = null;
      for (let i = 0; i < 400 && !warm; i++) { const a = i * 2.4, d = 40 + (i % 20) * 6, x = Lt.x + Math.sin(a) * d, z = Lt.z + Math.cos(a) * d; if (F.isWalkable(x, z) && !B7.archerColdAt(x, z)) warm = { x, z }; }
      if (warm) H.teleport(warm.x, warm.z); H.simulate(0.2); out.home = B7.archerColdAt(H.REALMS[2].town.x, H.REALMS[2].town.z);
      out.warm = { cold: B7.archerColdAt(P.x, P.z), wind: B7.archerWindK(P), snare: snare(P) };
      // the dead of winter in Thule's own lands: the snow lies and the air bites
      H.farm.setSeason(3); H.seasons.seasonSettle(); H.setTod(0.0); H.simulate(0.5);
      const Rm = H.REALMS[2].town; let spot = null;
      for (let i = 0; i < 400 && !spot; i++) { const a = i * 2.4, d = 30 + (i % 20) * 6, x = Rm.x + Math.sin(a) * d, z = Rm.z + Math.cos(a) * d; if (F.isWalkable(x, z) && B7.archerColdAt(x, z)) spot = { x, z }; }
      if (spot) { const Q = T.fresh('archer', 30, 2); H.teleport(spot.x, spot.z); H.simulate(0.3); out.coldPlace = { lie: +H.seasons.lie(Q.x, Q.z).toFixed(2), cold: B7.archerColdAt(Q.x, Q.z), wind: B7.archerWindK(Q), snare: snare(Q) };
        const L = T.fresh('archer', 30, 0); H.teleport(spot.x, spot.z); H.simulate(0.3); out.logresCold = { wind: B7.archerWindK(L), snare: snare(L) }; }
      H.farm.setSeason(k0); H.seasons.seasonSettle(); H.setTod(0.45);
      return out; })()""")
    check(not r['warm']['cold'] and r['warm']['wind'] == 1 and r['warm']['snare']['caught'] and abs(r['warm']['snare']['root'] - 3.5) < 0.25 and not r['warm']['snare']['frozen'], f"a Thule archer in the warm: the wind moves its arrows and its snare holds as any other ({r['warm']})")
    cp = r.get('coldPlace')
    check(bool(cp) and cp['cold'] and cp['wind'] == 0 and cp['snare']['caught'] and abs(cp['snare']['root'] - 4.5) < 0.25 and cp['snare']['frozen'], f"in the cold the wind does not move its arrows and its snare freezes what it catches and holds it 4.5 s ({cp})")
    lc = r.get('logresCold')
    check(bool(lc) and lc['wind'] == 1 and lc['snare']['caught'] and not lc['snare']['frozen'] and abs(lc['snare']['root'] - 3.5) < 0.25, f"a Logres archer there shoots and snares as a plain one ({lc})")
    # the rules: Charge every 12 s at 50 with its slowing blow, one rush of B7T.rushShare s, plain shafts by rank, Mend on a scratch, the texts
    r = await ev(page, 'rules7', """(() => { const H = T.H, F = T.F, B7 = H.bal7; const out = { share: B7.B7T.rushShare };
      const P = T.fresh('warrior', 50, 0); const a = T.ahead(P, 15); const f = T.foe(1, a.x, a.z, 50, 'mage', 0); f.ai.nextAbility = 1e9; f.swingAt = 1e9; f.tweak = { hp: 40 }; F.setupStats(f);
      H.simulate(0.1); P.target = f.id; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower;
      out.used = F.useAbility(P, 'charge', f); out.chargeCd = +((P.cds.charge || 0) - H.GAME.t).toFixed(1); out.leapCd = +((P.cds.leap || 0) - H.GAME.t).toFixed(1);
      H.simulate(1.6); const sl = f.buffs.find((b) => b.kind === 'snare' && b.src === P.id); out.slow = sl ? +sl.value.toFixed(2) : 0;
      out.plain = [20, 30, 40, 50].map((lv) => +B7.plainArrowK({ level: lv }).toFixed(2));
      out.scratch = +H.bal4.mendWound({ hp: 95, maxHp: 100 }).toFixed(3); out.half = +H.bal4.mendWound({ hp: 50, maxHp: 100 }).toFixed(3);
      out.leapText = H.bal5.ABILITIES.leap.desc.includes('holds the other back ' + out.share + ' s'); out.chargeText = H.bal5.ABILITIES.charge.desc.includes('every 12 s');
      return out; })()""")
    check(r['used'] is True and abs(r['chargeCd'] - 12) < 0.3 and r['leapCd'] >= r['share'] - 0.1 and r['leapCd'] <= r['share'] + 0.3, f"at 50 Charge comes round in 12 s and holds Leap Strike back {r['share']} s ({r['chargeCd']} s, {r['leapCd']} s)")
    check(abs(r['slow'] - 0.4) < 0.01, f"at 50 its landing blow slows the foe by 40% ({r['slow']})")
    check(r['plain'] == [1, 1.05, 1.1, 1.15], f"plain shafts strike 5% harder a rank past the first ({r['plain']})")
    check(abs(r['scratch'] - 0.235) < 0.01 and r['half'] == 1, f"Mend on a scratch: a sixth of its measure and more as the wound deepens, all of it from half health ({r['scratch']} at 95%, {r['half']} at 50%)")
    check(r['leapText'] and r['chargeText'], f"the tooltips name the rush share and Charge's wait ({r['leapText']}, {r['chargeText']})")
    errs = await page.evaluate("__hm.errors.slice(0, 3)")
    check(not errs, f'no runtime errors in the [balance7] checks {errs[:2]}')

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
    r = {'ok': False}
    if want('ice'): r = await ev(page, 'ice-shot', """(() => { const H = T.H, F = T.F, C = H.cls; const P = T.fresh('mage', 35, 2);
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
    if want('steam'): await ev(page, 'steam-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 35, 0);
      const a = T.ahead(P, 9); const f = T.foe(1, a.x, a.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f); P.target = f.id; P.swingAt = 1e9;
      // [balance] the camera first: a burst's particles are only thrown near the camera
      CS(P, f, 7.5, 2.4, 0.8, 1.0); H.frame(0.016);
      C.addChill(f, 2, P); P.power = P.maxPower; F.useAbility(P, 'firebolt', f); H.simulate(1.5);
      for (let i = 0; i < 30 && !C.CLS.steam.length; i++) H.simulate(0.05);
      for (let i = 0; i < 6; i++) { H.simulate(0.05); H.frame(0.05); }
      CS(P, f, 7.5, 2.4, 0.8, 1.0); return { steam: C.CLS.steam.length }; })()""")
    await snap(page, 'steam', 2)
    # storm through wet foes in the rain
    if want('storm'): await ev(page, 'storm-shot', """(() => { const H = T.H, F = T.F, C = H.cls, W = H.dbg.WEATHER; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 35, 1);
      W.mode = 'auto'; W.kind = 'storm'; W.next = 1e9; F.weatherAdvance ? F.weatherAdvance(40) : 0;
      const fs = [[10, -3], [13, 3], [16, -1], [19, 4]].map(([d, s]) => { const a = T.ahead(P, d, s); const f = T.foe(2, a.x, a.z, 33, 'warrior', 0); f.ai.nextAbility = 1e9; f.tweak = { swing: 1e6, hp: 20 }; F.setupStats(f); f.wet = 1; return f; });
      P.target = fs[0].id; P.swingAt = 1e9; P.power = P.maxPower; F.useAbility(P, 'chain', fs[0]); H.simulate(1.35);
      CS(P, fs[1], 9, 3.2, 0.45, 1.2); return { n: fs.length }; })()""")
    await snap(page, 'storm', 1)
    await page.evaluate("(() => { const W = __hm.dbg.WEATHER; W.kind = 'clear'; if (__hm.fn.weatherAdvance) __hm.fn.weatherAdvance(60); return 0; })()")
    # a warrior's parry
    if want('parry'): await ev(page, 'parry-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 2.0); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; f.testDummy = true; f.yaw = Math.atan2(P.x - f.x, P.z - f.z); P.target = null;
      H.simulate(0.8); C.classHold(true); H.simulate(0.05); F.dealDamage(f, P, 50, { kind: 'melee' });
      f.anim.act = 1; f.anim.actT = 0.3; f.anim.actDur = 0.6; H.simulate(0.1);
      const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x + c * 3.6 + s * 1.0, P.y + 1.7, P.z - s * 3.6 + c * 1.0, (P.x + f.x) / 2, P.y + 1.2, (P.z + f.z) / 2); return { act: P.anim.act, parries: C.CLS.stats.parries }; })()""")
    await snap(page, 'parry', 1)
    # an archer at full draw
    if want('draw'): await ev(page, 'draw-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('archer', 30, 1);
      const a = T.ahead(P, 24); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; P.swingAt = 1e9;
      C.startDraw(P); H.simulate(1.4); const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x + c * 2.6 + s * 1.2, P.y + 1.6, P.z - s * 2.6 + c * 1.2, P.x + s * 0.3, P.y + 1.35, P.z + c * 0.3); return { k: C.drawK(P) }; })()""")
    await snap(page, 'draw', 1)
    await page.evaluate("(() => { const C = __hm.cls; C.CLS.hold = false; if (__hm.GAME.player && __hm.GAME.player.cs) __hm.GAME.player.cs.drawFrom = -1; return 0; })()")
    # a priest's holy ground, kneeling at prayer within it
    if want('holy'): await ev(page, 'holy-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('priest', 30, 0);
      for (const [d, s] of [[2.5, 2.5], [3.5, -2.2], [-1.5, 3.2]]) { const a = T.ahead(P, d, s); const u = T.foe(0, a.x, a.z, 30, 'warrior', 0); u.ai.nextAbility = 1e9; u.yaw = P.yaw + 0.4; u.hp = u.maxHp * 0.5; }
      const cs = C.csOf(P); cs.dev = 80; cs.devAt = H.GAME.t; P.gcdUntil = 0; C.classTechnique(P); H.simulate(1.0); C.startPrayer(P); H.simulate(1.2);
      for (const p of H.SPELL.pillars) p.age = p.dur; for (const d of H.SPELL.discs) if (d.on) d.age = Math.min(d.age + 1.5, d.dur - 0.5); H.frame(0.016);
      H.setTod(1.3); CB2(P, 6.5, 3.4, 4, 0.4); return { grounds: C.CLS.grounds.length }; })()""")
    await snap(page, 'holy', 1)
    await page.evaluate("__hm.setTod(0.55); 0")
    # a Thule mage's rune and an archer's snares, open and sprung
    if want('rune_snare'): await ev(page, 'rune-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('archer', 20, 2);
      P.power = P.maxPower; C.classTechnique(P); H.simulate(0.2); P.yaw += 1.4; P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; C.classTechnique(P);
      const S = C.CLS.snares[C.CLS.snares.length - 1]; S.sprung = H.GAME.t; S.close = 1;
      const a = T.ahead(P, 4, -2.5); C.layRune(P, a.x, a.z, 'frost'); const b = T.ahead(P, 4.5, 2.5); C.layRune(P, b.x, b.z, 'fire');
      H.simulate(1.2); for (const d of H.SPELL.discs) if (d.on) d.age = Math.min(d.age + 1.5, d.dur - 0.5); H.frame(0.016); CB2(P, 2.6, 5.2, 0.6, -0.4); return { snares: C.CLS.snares.length, runes: C.CLS.runes.length }; })() // [balance] framed wider: the runes' carved glyphs and the snares together""")
    await snap(page, 'rune_snare', 1)
    # the class panels on the HUD: a warrior with a finisher ready, a mage reading a frozen foe
    if want('hud_warrior'): await ev(page, 'hud-w', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 6); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; C.setStance(P, 2); C.addMom(P, 4); return 0; })()""")
    await snap(page, 'hud_warrior', 1, True)
    if want('hud_mage'): await ev(page, 'hud-m', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 30, 1);
      const a = T.ahead(P, 10); const f = T.foe(2, a.x, a.z, 30, 'warrior', 0); f.ai.nextAbility = 1e9; P.target = f.id; C.attune(P, 'frost', 70); C.addChill(f, 3, P); return 0; })()""")
    await snap(page, 'hud_mage', 1, True)
    # [balance3] a shield wall: a guarded warrior walking on behind a raised shield toward an archer, arrows coming in
    if want('shieldwall'): await ev(page, 'wall-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('warrior', 30, 0);
      const a = T.ahead(P, 20); const ar = T.foe(2, a.x, a.z, 30, 'archer', 0); ar.ai.nextAbility = 1e9; ar.yaw = Math.atan2(P.x - ar.x, P.z - ar.z); P.target = ar.id;
      C.setStance(P, 0); C.csOf(P).stanceAt = -9; P.cds.charge = H.GAME.t + 30; P.cds.leap = H.GAME.t + 30; C.classHold(true);
      for (let i = 0; i < 12; i++) { const d = Math.hypot(ar.x - P.x, ar.z - P.z); P.yaw = Math.atan2(ar.x - P.x, ar.z - P.z); P.x += (ar.x - P.x) / d * 0.35; P.z += (ar.z - P.z) / d * 0.35; H.simulate(0.05); }
      if (ar.alive) H.cls.looseArrow(ar, 1, P);
      H.simulate(0.15);
      const s = Math.sin(P.yaw), c = Math.cos(P.yaw); CC(P.x + c * 3.4 - s * 1.6, P.y + 1.8, P.z - s * 3.4 - c * 1.6, P.x + s * 3, P.y + 1.2, P.z + c * 3);
      return { block: C.csOf(P).blockOn, stance: C.csOf(P).stance, pace: +(H.bal3.effectiveSpeed(P) / P.speed).toFixed(2) }; })()""")
    await snap(page, 'shieldwall', 1)
    await page.evaluate("(() => { __hm.cls.classHold(false); return 0; })()")
    # [balance3] holy light dazzles: a priest's smite lands on a warrior, a burst of light about its head
    if want('dazzle'): await ev(page, 'dazzle-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('priest', 30, 0);
      const a = T.ahead(P, 6.5); const w = T.foe(2, a.x, a.z, 30, 'warrior', 0); w.ai.nextAbility = 1e9; P.target = w.id; P.swingAt = 1e9;
      const hold = () => { w.x = a.x; w.z = a.z; w.yaw = Math.atan2(P.x - w.x, P.z - w.z); w.swingAt = 1e9; }; // the warrior held where it stands, facing the priest
      hold(); CS(P, w, 4.4, 1.3, 0.6, 1.45); H.frame(0.016);
      P.power = P.maxPower; F.useAbility(P, 'smite', w); for (let i = 0; i < 60 && !w.buffs.some((b) => b.kind === 'dazzle'); i++) { H.simulate(0.05); hold(); }
      for (let i = 0; i < 8; i++) { H.simulate(0.04); hold(); H.frame(0.04); }
      CS(P, w, 4.4, 1.3, 0.6, 1.45); return { dazzle: w.buffs.filter((b) => b.kind === 'dazzle').map((b) => +b.value.toFixed(2)), motes: H.bal3.BAL3.dazzledIds.size }; })()""")
    await snap(page, 'dazzle', 1)
    # [balance4] Charge rushes: a warrior halfway along its rush at a mage, shield raised across its body, dust behind
    if want('rush'): await ev(page, 'rush-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 30, 0);
      const a = T.ahead(P, 20); const w = T.foe(2, a.x, a.z, 30, 'warrior', 0); w.ai.nextAbility = 1e9; w.swingAt = 1e9; P.swingAt = 1e9; P.target = w.id;
      w.ai.post.leash = 40; /* [balance6] a guard at its post rushes only within its leash ([balance4]): this one's reaches the mage */
      H.simulate(0.2); CS(P, w, 7.5, 1.6, 0.5, 1.1); H.frame(0.016);
      w.cds = {}; w.gcdUntil = 0; w.power = w.maxPower; w.target = P.id; const r = F.useAbility(w, 'charge', P);
      for (let i = 0; i < 12 && w.motion; i++) { H.simulate(0.05); H.frame(0.05); }
      CS(P, w, 7.5, 1.6, 0.5, 1.1); return { r, d: +Math.hypot(w.x - P.x, w.z - P.z).toFixed(1), act: w.anim.act, rush: !!(w.motion && w.motion.rush) }; })()""")
    await snap(page, 'rush', 1)
    # [balance5] holy ground dazzles the foes on it: a warrior standing on a priest's hallowed ground, motes of light about
    # its head, the ground's glow under both
    if want('hallow'): await ev(page, 'hallow-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('priest', 30, 0);
      const a = T.ahead(P, 3.2); const w = T.foe(2, a.x, a.z, 30, 'warrior', 0); w.ai.nextAbility = 1e9; P.target = w.id; P.swingAt = 1e9;
      const hold = () => { w.x = a.x; w.z = a.z; w.yaw = Math.atan2(P.x - w.x, P.z - w.z); w.swingAt = 1e9; };
      hold(); CS(P, w, 4.6, 1.5, 0.55, 1.3); H.frame(0.016);
      C.csOf(P).dev = 60; P.cds = {}; P.gcdUntil = 0; const r = C.consecrate(P);
      for (let i = 0; i < 60 && !w.buffs.some((b) => b.kind === 'dazzle' && b.src === 'hallow'); i++) { H.simulate(0.05); hold(); H.frame(0.05); }
      // the frames keep pace with the world (a simulated stretch leaves the frames' clock behind: the column of light laid
      // with the ground stood at its brightest over the priest), and the column's second is let pass
      for (let i = 0; i < 30; i++) { H.simulate(0.05); hold(); H.frame(0.05); }
      CS(P, w, 4.6, 1.5, 0.55, 1.3); return { r, dazzle: w.buffs.filter((b) => b.kind === 'dazzle').map((b) => b.src + ':' + b.value.toFixed(2)), grounds: C.CLS.grounds.length }; })()""")
    await snap(page, 'hallow', 1)
    # [balance6] the ward keeps the spell: a mage behind its Arcane Ward in the middle of a firebolt, a breaking blow taken
    # by the ward (its ring flares, "Warded" over its head), the spell still in its hands
    if want('ward'): await ev(page, 'ward-shot', """(() => { const H = T.H, F = T.F, C = H.cls; H.UI.modal = null; H.CAM.mode = 'play'; const P = T.fresh('mage', 30, 1);
      const a = T.ahead(P, 12); const w = T.foe(2, a.x, a.z, 30, 'warrior', 0); w.ai.nextAbility = 1e9; w.swingAt = 1e9; P.swingAt = 1e9; P.target = w.id;
      w.tweak = { hp: 20, speed: 0.01 }; F.setupStats(w); H.simulate(0.1); CS(P, w, 6, 1.6, 0.3, 1.2); H.frame(0.016);
      P.cds = {}; P.gcdUntil = 0; P.power = P.maxPower; F.useAbility(P, 'ward', P); for (let i = 0; i < 4; i++) { H.simulate(0.05); H.frame(0.05); }
      P.gcdUntil = 0; F.useAbility(P, 'firebolt', w); for (let i = 0; i < 6; i++) { H.simulate(0.05); H.frame(0.05); }
      const broke = H.bal.breakCast(P); H.frame(0.016);
      /* both in the frame (the warrior stood out of it) */
      CS(P, w, 9.5, 1.8, 0.5, 1.2); return { broke, casting: !!P.casting, kept: H.bal6.BAL6.stats.wardKept || 0 }; })()""")
    if want('ward'):
        # of the HUD only the cast bar (the spell runs on) and the word over the mage ("Warded"): the whole HUD covered the
        # scene at 640x360
        await page.evaluate("document.getElementById('hud').style.visibility = 'hidden'; for (const id of ['castbar', 'floaters']) document.getElementById(id).style.visibility = 'visible'; 0")
        await frames(page, 1)
        try:
            t0 = time.time(); await page.screenshot(path=OUT + 'cls_ward.png', timeout=420000); print(f'  shot cls_ward ({time.time() - t0:.0f}s)', flush=True)
        except Exception as err:
            print(f'  shot cls_ward failed: {str(err)[:120]}', flush=True)
        await page.evaluate("for (const id of ['castbar', 'floaters']) document.getElementById(id).style.visibility = ''; 0")

async def main():
    async with async_playwright() as p:
        w, h = (960, 540) if SHOTS and 'big' in ARGS else (640, 360)
        b, page, logs = await setup(p, w=w, h=h)
        page.on('console', lambda m: CONSOLE.append(m.text[:300]) if m.type == 'error' else None)
        if BAL:
            await page.set_viewport_size({'width': 320, 'height': 180})
            if not (MECH or B3 or SHOTS) and 'loop' not in ARGS: await page.evaluate("window.requestAnimationFrame = () => 0; 0")  # [balance4] nothing is drawn: the frame loop stops
            await balance(page)
        if MECH:
            await mechanics(page)
        if B3:
            await balance3(page)  # [balance3]
        if B4:
            await balance4(page)  # [balance4]
        if B5:
            await balance5(page)  # [balance5]
        if B6:
            await balance6(page)  # [balance6]
        if B7:
            await balance7(page)  # [balance7]
        if SHOTS:
            await shots(page)
        errs = await page.evaluate("__hm.errors.slice(0, 5)")
        check(not errs, f'no runtime errors {errs[:2]}')
        for l in logs[:5]: print(l)
        await b.close()
    print('\nFAILED: ' + '; '.join(FAILS) if FAILS else '\nall checks passed', flush=True)
    sys.exit(1 if FAILS else 0)

if __name__ == '__main__':  # [balance3] tools/tests/duels.py borrows the arenas
    asyncio.run(main())
