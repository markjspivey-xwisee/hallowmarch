"""[look5] (version 17) The world looked at again with version 16's additions, and the phone's long pages: what was put
right, by number (the pictures are look.py's `look5` group: python3 tools/tests/look.py views=look5).
  camps: no camp's body stands inside what the camp stands round (its fire pit, a tent, the log, the rack, a rock), at 30
         and with the farthest camps risen (45): a risen champion was set down in its camp's fire
  wisps: every wisp is drawn in its own look's colour (a risen champion's ember red, the late wisps' pale, blue, green and
         violet), at its size
  hallow: holy ground's light is in the blades (the grass's uniforms filled for the ground near the camera, and emptied
         when it is gone)
  scaf: a house brought down by stones and being built back: its lift goes up only when the walls have risen to it
         (standards alone before, floors and ladder off), its people work along the walls (not at one spot), and once
         the walls stand high one of them climbs the ladder, works on the boards (its feet on them, hammering) and comes
         down again
  masons: a breached tower's masons go home from a foe and come out again once the keep is quiet (they came once a
         scaffold); the masons at work are saved and come back at their work (one at the foot, one up on the boards)
         after the save is read back
  map: two of your warbands at one place: their names laid out clear of each other (they were written over each other)
  hud: the HUD's layout pass reads the panels' sizes only when something changed (ResizeObserver, MutationObserver: no
         pass in seconds of nothing), a panel that loses a line keeps its place a while (the panel under it stays put),
         and the path tracker stays on an upright phone with the plant card, the class panel and the companion bar up
  pages: How to play and the War page on an upright phone (natural, now) at 390x780 and 360x640, a returning character's
         note about the folds and the notes' page
usage: python3 tools/tests/look5.py [only=camps,wisps,hallow,scaf,masons,map,hud,pages] [reload]"""
import asyncio, json, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = dict(a.split('=', 1) for a in sys.argv[1:] if '=' in a)
FLAGS = set(a for a in sys.argv[1:] if '=' not in a)
ONLY = set(ARGS['only'].split(',')) if 'only' in ARGS else None
FAILS = []
T0 = time.time()
def want(k): return ONLY is None or k in ONLY
def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)
async def ev(page, js, label=None):
    r = await page.evaluate(js)
    if label: print(label, json.dumps(r)[:1500], flush=True)
    return r

HELP = r"""
window.L5 = {
  H: __hm, F: __hm.fn,
  P() { return this.H.GAME.player; },
  calm(r = 90) { const H = this.H, P = this.P(); for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && !e.siegeEngine && H.fn.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp = 1e7; P.buffs.length = 0; P.casting = null; P.target = null; P.combatUntil = 0; return 0; },
  sim(s) { const H = this.H, m = H.UI.modal; H.UI.modal = null; H.simulate(s); H.UI.modal = m; return 0; },
  // every camp body standing inside a collider (look5InColl at a tenth of a metre: one pressed against it is not in it)
  inColl() { const H = this.H, out = []; for (const c of H.CAMPS) for (const id of c.members) { const e = H.fn.getEnt(id); if (e && e.alive && e.kind !== 'wisp' && H.look5.look5InColl(e.x, e.z, 0.1)) out.push({ camp: c.id, type: c.type, elite: !!e.elite, x: +e.x.toFixed(1), z: +e.z.toFixed(1) }); } return out; },
  lay() { const L = this.H.hud.HUDL; L.k = 0; L.t = 0; if (this.H.guide2) this.H.guide2.G2.tap.until = 0; this.H.hud.hudLayout(1); return 0; },
};
0;
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=True, w=390, h=780)
        page.set_default_timeout(600000)
        await ev(page, HELP)
        # the page's own frames held (only the frames a check asks for are drawn: SwiftShader is slow), as guide2.py does
        await ev(page, """(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
          window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); return 0; })()""")
        await ev(page, "(async () => { await __hm.start({ realm: 0, cls: 'priest', level: 30 }); __hm.setTod(0.45); __hm.dbg.WEATHER.mode = 'clear'; L5.calm(); L5.sim(0.5); __hm.GAME.prog.lore.seen.push('start'); __hm.LORE.state.queue.length = 0; __hm.frame(1/30); return 0; })()")
        print(f'started [{time.time() - T0:.0f}s]', flush=True)

        # ---- camps: nobody in the fire pit ----
        if want('camps'):
            r = await ev(page, "(() => ({ n: L5.H.CAMPS.reduce((a, c) => a + c.members.size, 0), inside: L5.inColl() }))()", 'camps at 30')
            check(not r['inside'], f"no camp body at 30 stands inside what its camp stands round ({len(r['inside'])} of {r['n']}: {r['inside'][:4]})")
            # (spawned many times over: every risen camp taken over and back, the champions most of all)
            r = await ev(page, """(() => { const H = L5.H, F = L5.F, out = { n: 0, inside: [] }; const P = H.GAME.player; P.x = H.REALMS[0].town.x; P.z = H.REALMS[0].town.z;
              for (let k = 0; k < 4; k++) { H.GAME.prog.level = k % 2 ? 30 : 45; F.rescaleWar(); for (const q of L5.inColl()) out.inside.push(q); }
              for (const c of H.CAMPS) if (c.elite) for (let k = 0; k < 6; k++) { const e = F.spawnMob(c, true); out.n++; if (H.look5.look5InColl(e.x, e.z, 0.1)) out.inside.push({ camp: c.id, type: c.type, champion: true }); c.members.delete(e.id); F.removeEnt(e); }
              H.GAME.prog.level = 45; F.rescaleWar(); return out; })()""", 'camps risen and back, champions spawned')
            check(not r['inside'], f"no body set down inside a camp's fire pit, tent or rack: camps risen at 45 and back at 30 twice, and {r['n']} champions set down ({r['inside'][:4]})")

        # ---- wisps in their own colours ----
        if want('wisps'):
            r = await ev(page, """(() => { const H = L5.H, ws = H.ENT.filter((e) => e.alive && e.kind === 'wisp'), cols = ws.map((e) => { const c = H.look5.look5WispCol(e); return { risen: !!e.l2risen, lvl: e.level, r: +c[0].toFixed(2), g: +c[1].toFixed(2), b: +c[2].toFixed(2), sc: +(e.scale || 1).toFixed(2) }; });
              const teal = (c) => Math.abs(c.r - 0.55) < 0.12 && Math.abs(c.g - 1.6) < 0.05 && Math.abs(c.b - 1.35) < 0.15;
              return { n: ws.length, risen: cols.filter((c) => c.risen), late: cols.filter((c) => !c.risen && !teal(c)).length, teal: cols.filter(teal).length, sample: cols.slice(0, 6) }; })()""", 'wisps')
            check(r['risen'] and all(c['r'] > c['g'] * 1.5 and c['sc'] > 1.2 for c in r['risen']), f"a risen wisp champion burns ember red and large ({r['risen']})")
            check(r['late'] > 0, f"the late wisps in their own lights, not one teal ({r['late']} of {r['n']} not teal)")

        # ---- holy ground's light in the grass ----
        if want('hallow'):
            r = await ev(page, """(() => { const H = L5.H, F = L5.F, P = L5.P(); L5.calm(); const C = H.cls; try { C.csOf(P).dev = 80; } catch (e) { /* */ } H.UI.modal = null;
              const ok = C.consecrate(P); H.simulate(0.6); H.frame(1/30); const U = H.dbg.U, a = { n: U.uHallowN.value, h: U.uHallow.value[0].toArray().map((v) => +v.toFixed(2)), c: U.uHallowC.value[0].toArray().map((v) => +v.toFixed(2)), at: [+P.x.toFixed(2), +P.z.toFixed(2)] };
              a.bad = H.dbg.renderer.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name); a.progs = H.dbg.renderer.info.programs.length;
              H.simulate(13); H.frame(1/30); a.after = U.uHallowN.value; H.UI.modal = 'menu'; return a; })()""", 'holy ground')
            check(not r['bad'], f"its disc and the grass drawn with it: no program that does not compile ({r['bad']}; {r['progs']} programs)")
            check(r['n'] == 1 and abs(r['h'][0] - r['at'][0]) < 0.6 and abs(r['h'][1] - r['at'][1]) < 0.6 and abs(r['h'][2] - 6.5) < 0.01 and r['h'][3] > 0.8, f"holy ground near the camera fills the grass's light: {r['h']} (the priest at {r['at']}), its colour {r['c'][:3]}")
            check(r['after'] == 0, 'and empties it when the ground is gone')

        # ---- a house's scaffold rising with the work, and a builder up on its boards ----
        if want('scaf'):
            r = await ev(page, """(() => { const H = L5.H, F = L5.F, Rb = H.rubble, S = H.REALMS[0].town; L5.calm();
              const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole' && h.residents && h.residents.length);
              hs.sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z)); const A = hs[0];
              H.war2.HCREW.off = true; H.batter.houseBreak(A, null); L5.sim(2); A.stT = 1e4; L5.sim(0.3);
              const Q = Rb.HSCAF.list.get(A), out = { num: A.num, st: A.state, lifts: Q && Q.lifts, res: A.residents.length };
              const look = () => ({ lv: Rb.houseRubbleLevel(A), n: Q.l4n, floors: Q.l3.floors.filter((f) => f.active).length, lad: Q.l3.ladders.filter((l) => !l.gone).length, key: Q.key });
              out.start = look();
              const full = (A.round ? A.wallH : A.wallH + A.rh) + 0.1, at = (lv) => lv / full * 0.6 * 70;
              A.stT = at(Q.lifts[0] - 0.8); L5.sim(0.2); out.mid = look();
              A.stT = at(Q.lifts[0] - 0.2); L5.sim(0.2); out.up = look();
              // the work along the walls: the spots its people took at the foot (each stint the next along its side)
              const id = A.residents[0], e = F.getEnt(id); out.spots = [];
              for (let k = 1; k <= 4; k++) { const s = Rb.houseScafWorkSpot(A, (id % 2) ? 1 : -1, k); if (s) out.spots.push([+s.x.toFixed(2), +s.z.toFixed(2)]); }
              // up on the boards once the walls stand high: watch its people for a while
              A.stT = at(Q.lifts[0] + 1.25); const st0 = { ...H.look5.LOOK5.stats }, seen = { up: 0, blows: 0, onBoards: 0, feet: [], hammer: 0, down: 0 }; let wasUp = false;
              H.UI.modal = null;
              for (let t = 0; t < 120 && A.state === 'scaffold' && !(seen.down && seen.hammer > 8); t += 0.25) {
                if (A.stT > at(full - 0.2)) A.stT = at(full - 0.6); // (the walls kept short of done: the work goes on)
                H.simulate(0.25);
                for (const rid of A.residents) { const b = F.getEnt(rid); if (!b || !b.alive) continue; const L = Q.l3.ladders.find((q) => q.k === 0); const on = b.y > L.wyb + 1 && !b.motion;
                  if (on) { seen.onBoards++; if (b.anim.act === 23) { seen.hammer++; seen.feet.push(+(b.y - F.floorAt(b.x, b.z, b.y + 0.3)).toFixed(3)); } wasUp = true; } else if (wasUp && b.y < L.wyb + 0.5 && !b.motion) { seen.down++; wasUp = false; } }
              }
              H.UI.modal = 'menu';
              const st1 = H.look5.LOOK5.stats; out.stats = { plans: st1.upPlans - st0.upPlans, climbed: st1.climbed - st0.climbed, blows: st1.boardBlows - st0.boardBlows };
              out.seen = { onBoards: seen.onBoards, hammer: seen.hammer, down: seen.down, feetMin: seen.feet.length ? Math.min(...seen.feet) : null, feetMax: seen.feet.length ? Math.max(...seen.feet) : null };
              out.errors = H.errors.slice(0, 3).map(String); return out; })()""", 'house scaffold')
            check(r['start']['n'] == 0 and r['start']['floors'] == 0 and r['start']['lad'] == 0, f"its scaffold's standards first: no lift up while the walls are low ({r['start']})")
            check(r['mid']['n'] == 0, f"none yet 0.8 m under the lift ({r['mid']})")
            check(r['up']['n'] >= 1 and r['up']['floors'] > 0 and r['up']['lad'] >= 1, f"the lift up as the walls come up to it: its boards floors and its ladder climbed ({r['up']})")
            check(len(set(map(tuple, r['spots']))) >= 2, f"the work at the foot moves along the wall from stint to stint ({r['spots']})")
            check(r['stats']['climbed'] >= 1 and r['seen']['hammer'] >= 4, f"once the walls stand high one of its people climbs the ladder and hammers on the boards ({r['stats']}, {r['seen']})")
            check(r['seen']['feetMin'] is not None and -0.05 <= r['seen']['feetMin'] and r['seen']['feetMax'] <= 0.05, f"standing on the boards while it hammers ({r['seen']['feetMin']} to {r['seen']['feetMax']} m over the floor under it)")
            check(r['seen']['down'] >= 1, f"and comes down again ({r['seen']['down']} times)")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the masons: again after a foe, and saved ----
        if want('masons'):
            r = await ev(page, """(() => { const H = L5.H, F = L5.F, L3 = H.look3, S = H.REALMS[0].keepSites[0], C = F.castles().find((q) => q.S === S), K = S.keepRef;
              const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T; const P = L5.P(); P.x = S.x + 120; P.z = S.z + 120; L5.calm();
              if (W.state === 'whole') { const src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', S.x + W.ox * 60, S.z + W.oz * 60, {}); src.hp = src.maxHp = 1e9; const p = { x: T.wx + W.ox * (T.RO + 0.2), z: T.wz + W.oz * (T.RO + 0.2) }; for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, p.x, p.z, 2.0, 4.4); F.removeEnt(src); }
              const out = { st0: W.state }; H.UI.modal = null;
              const mine = () => L3.MASON.list.filter((e) => !e.removed && e.alive && e.ai.mason && e.ai.mason.W === W);
              K.lastEnemyNear = -1e9; let t = 0;
              for (; t < 200 && !(mine().length >= 2 && mine().every((e) => e.ai.mason.st === 'work')); t++) { H.simulate(1); K.lastEnemyNear = -1e9; if (W.state === 'repair' && W.t > 0.6) W.t = 0.4; }
              out.first = { t, n: mine().length, sts: mine().map((e) => e.ai.mason.st), spawned: L3.MASON.stats.spawned };
              // a foe comes: home they go
              for (t = 0; t < 240 && mine().length; t++) { K.lastEnemyNear = H.GAME.t; H.simulate(1); if (W.state === 'repair' && W.t > 0.6) W.t = 0.4; }
              out.home = { t, n: mine().length };
              // quiet again: they come out again
              const s0 = L3.MASON.stats.spawned; K.lastEnemyNear = -1e9;
              for (t = 0; t < 200 && !(mine().length >= 2 && mine().every((e) => e.ai.mason.st === 'work')); t++) { H.simulate(1); K.lastEnemyNear = -1e9; if (W.state === 'repair' && W.t > 0.6) W.t = 0.4; }
              out.again = { t, n: mine().length, spawned: L3.MASON.stats.spawned - s0, sts: mine().map((e) => e.ai.mason.st), again: H.look5.LOOK5.stats.masonsAgain };
              // saved, taken away and read back: at their work again
              const part = H.fn.savePartsData('world'), d = part && part.masons; out.saved = d;
              for (const e of mine()) F.removeEnt(e); W.masonsFor = null;
              H.fn.savePartsLoad('world', { masons: d });
              H.simulate(0.5); const back = mine(), Ld = W.l3.ladders.find((q) => q.k === 0);
              out.back = back.map((e) => ({ st: e.ai.mason.st, up: e.ai.mason.up, dy: +(e.y - Ld.wyb).toFixed(2), foot: +Math.hypot(e.x - e.ai.mason.foot.x, e.z - e.ai.mason.foot.z).toFixed(2) }));
              H.UI.modal = 'menu'; K.lastEnemyNear = H.GAME.t + 1e6; out.errors = H.errors.slice(0, 3).map(String); return out; })()""", 'masons')
            check(r['first']['n'] >= 2, f"the masons come out to a breached tower's scaffold ({r['first']})")
            check(r['home']['n'] == 0, f"a foe near the keep: they go home ({r['home']})")
            check(r['again']['spawned'] >= 2 and r['again']['n'] >= 2, f"quiet again: they come out again ({r['again']}; they came once a scaffold)")
            check(r['saved'] and len(r['saved']) >= 1, f"the masons at work are saved ({r['saved']})")
            back = r['back']
            check(len(back) == 2 and any(q['up'] and q['dy'] > 1.5 for q in back) and any((not q['up']) and q['foot'] < 1.0 and q['st'] == 'work' for q in back), f"read back, they are at their work again: one on the boards, one at the foot ({back})")
            check(not r['errors'], f"no errors ({r['errors']})")

        # ---- the map: two bands' names at one place ----
        if want('map'):
            r = await ev(page, """(() => { const H = L5.H, F = L5.F, P = L5.P(), W = H.WAR, mine = W.warbands.filter((wb) => !wb.dead && wb.realm === P.faction && F.wbLeader(wb));
              if (mine.length < 2) return { skip: mine.length };
              const a = F.wbLeader(mine[0]), b = F.wbLeader(mine[1]); b.x = a.x + 0.5; b.z = a.z + 0.3;
              H.fn.toggleMap(true); H.frame(1/30);
              const lab = H.look4.MAPL.last, cv = document.getElementById('mapcanvas'), ctx = cv.getContext('2d'), S = cv.width;
              const m = H.look5.look5BandNames(ctx, S, P), at = [mine[0], mine[1]].map((wb) => m.get(wb));
              H.fn.toggleMap(false); return { at, bands: lab && lab.bands, S }; })()""", 'map')
            if r.get('skip') is None:
                a, b2 = r['at']
                check(a and b2 and (abs(a[0] - b2[0]) > 20 or abs(a[1] - b2[1]) > 8), f"two of your bands at one place: their names apart on the map ({a}, {b2})")
            else:
                print('  (fewer than two of your bands in the field: skipped)', r)

        # ---- the HUD: passes only on a change, held heights, the path tracker kept ----
        if want('hud'):
            r = await ev(page, """(() => { const H = L5.H, Hd = H.hud, L = Hd.HUDL, L5h = Hd.HUDL5; L5.lay(); for (let i = 0; i < 12; i++) H.frame(1/30);
              const p0 = L5h.passes, w0 = L5h.whys.length; for (let i = 0; i < 60; i++) H.frame(1/20); return { ro: !!L5h.ro, still: L5h.passes - p0, why: L5h.whys.slice(w0), key: L.key }; })()""", 'hud passes')
            # [v17] a pass asked for by a toast or a note laid out as it shows is a change too (the war's news came oftener once
            # war3's columns and pacts were cried: four toasts in the 3 s once): what must not come back is the pass on a timer
            unasked = [w for w in r['why'] if w != 'asked']
            check(r['ro'] and r['key'] == '' and 'timer' not in r['why'] and len(unasked) <= 3, f"the layout pass reads the panels only when one has changed (a ResizeObserver, a MutationObserver): {r['still']} passes in 3 s, for {r['why']} (it read every panel's size four times a second, and laid them out once a second besides)")
            r = await ev(page, """(() => { const H = L5.H, Hd = H.hud, L5h = Hd.HUDL5;
              // the rule itself: a panel that loses a line keeps its taller place until HUD_HOLD_T has gone by
              const a = Hd.hudHeld('#war', { x: 10, y: 10, w: 120, h: 80 }), b = Hd.hudHeld('#war', { x: 10, y: 10, w: 120, h: 60 }); const hold = L5h.hold.get('#war'); hold.until = -1; const c = Hd.hudHeld('#war', { x: 10, y: 10, w: 120, h: 60 }); L5h.hold.delete('#war');
              // in the HUD: a panel over another in the same column gains a line and loses it again
              // [look6] with no field note up: while one shows an upright phone lays the HUD out in the note's order, where the
              // class panel keeps its place and the path tracker over it moves aside instead (the check failed once in a full
              // run, #cls staying at 240, most likely so; run without the scenes before it, no note was up and it passed: `dg`)
              for (const d of [...document.querySelectorAll('#banners > *')]) d.parentNode.removeChild(d); H.LORE.state.queue.length = 0;
              L5.lay(); for (let i = 0; i < 3; i++) H.frame(1/30);
              const P = Hd.HUDL.placed.filter((q) => Hd.HUD_HOLD.has(q.sel)), pairs = [];
              for (const A of P) for (const B of P) if (A !== B && B.y > A.y + A.h - 2 && B.y - (A.y + A.h) < 40 && A.x < B.x + B.w && B.x < A.x + A.w) pairs.push([A.sel, B.sel]);
              if (!pairs.length) return { unit: [a.h, b.h, c.h], pairs: 0, placed: Hd.HUDL.placed.map((q) => q.sel + '@' + Math.round(q.y) + '+' + Math.round(q.h)) };
              const [sa, sb] = pairs[0], A = document.querySelector(sa), B = document.querySelector(sb), top = () => Math.round(B.getBoundingClientRect().top);
              const t0 = top(), x = document.createElement('div'); x.textContent = 'A line more'; x.style.cssText = 'height:34px';
              const ah = () => Math.round(A.getBoundingClientRect().height), dg = { note: !!document.querySelector('#banners > .lore-note:not(.hl-old)'), banners: document.getElementById('banners').className, a: A.className, b: B.className, ah0: ah() }; // [look6] what the HUD held when it failed
              A.appendChild(x); L5.lay(); H.frame(1/30); const t1 = top(), h0 = L5h.held; dg.ah1 = ah(); dg.a1 = A.className; dg.b1 = B.className;
              x.remove(); L5.lay(); H.frame(1/30); const t2 = top();
              return { unit: [a.h, b.h, c.h], pairs: pairs.length, pair: pairs[0], t0, t1, t2, held: L5h.held - h0, dg, placed: Hd.HUDL.placed.map((q) => q.sel + '@' + Math.round(q.y) + '+' + Math.round(q.h)) }; })()""", 'hud held')
            check(r['unit'] == [80, 80, 60], f"a panel that loses a line keeps its taller place until its hold runs out ({r['unit']})")
            if r.get('pairs'):
                check(r['t1'] > r['t0'] and r['t2'] == r['t1'] and r['held'] > 0, f"in the HUD: {r['pair'][0]} gains a line and loses it, {r['pair'][1]} under it moves down once and stays ({r['t0']} -> {r['t1']} -> {r['t2']})" + ('' if r['t1'] > r['t0'] else f" {r.get('dg')} {r.get('placed')}"))
            else:
                print('  (no two panels one over the other in this HUD: only the rule checked)', r.get('placed'))
            r = await ev(page, """(() => { const H = L5.H, P = L5.P(); const fc = document.getElementById('farmcard'), pb = document.getElementById('petbar');
              // the plant card and the companion bar up together (as a phone with a hound at a bed shows them)
              const show = (el, h) => { if (!el) return; el.hidden = false; el.style.display = 'block'; el.style.minHeight = h + 'px'; el.classList.add('on', 'show'); };
              show(fc, 190); show(pb, 120); for (let i = 0; i < 12; i++) H.frame(1/30); L5.lay(); H.frame(1/30);
              const lp = document.getElementById('lore-path'), r = lp.getBoundingClientRect();
              const out = { off: lp.classList.contains('hl-off'), top: Math.round(r.top), h: Math.round(r.height), placed: H.hud.HUDL.placed.map((q) => q.sel) };
              for (const el of [fc, pb]) { if (el) { el.style.display = ''; el.style.minHeight = ''; el.classList.remove('on', 'show'); } }
              return out; })()""", 'path tracker')
            check(not r['off'] and r['h'] > 10, f"the path tracker stays on an upright phone with the plant card and the companion bar up ({r})")

        # ---- the phone's pages ----
        if want('pages'):
            for (w, h) in [(390, 780), (360, 640)]:
                await page.set_viewport_size({'width': w, 'height': h})
                await page.wait_for_timeout(300)
                r = await ev(page, """(() => { const H = L5.H; H.fn.openMenu('help'); const body = document.getElementById('menu-body'), sheet = body.closest('.sheet');
                  const now = body.scrollHeight, vh = sheet.clientHeight;
                  // the page as it was (every control open, each system under its own heading): measured in place
                  const keep = body.innerHTML; body.innerHTML = H.look5.look5DeskHelpHTML(); const old = body.scrollHeight; body.innerHTML = keep;
                  H.LORE.openChronicle('war'); const st = H.guide2.G2.stats.pages.war || {}; const war = Math.round(document.querySelector('.chron-body').getBoundingClientRect().height);
                  const folds = [...document.querySelectorAll('.chron-body details.cf > summary')].map((q) => q.textContent.trim()).slice(0, 6);
                  return { vh, now, old, war, war0: st.h0, folds }; })()""", f'pages {w}x{h}')
                check(r['now'] <= r['vh'] * 1.05, f"{w}x{h}: How to play on one screen ({r['now']} px, the sheet {r['vh']}; as it was {r['old']})")  # [look6] at 360x640 too (it was 1.1 of its screens)
                check(r['war'] <= r['vh'] * 1.75, f"{w}x{h}: the War page folded in under 1.75 screens ({r['war']} px, the sheet {r['vh']}; natural {r['war0']}; folds {r['folds']})")
            await page.set_viewport_size({'width': 390, 'height': 780})
            r = await ev(page, """(() => { const H = L5.H, L = H.GAME.prog.lore; L.seen = L.seen.filter((x) => x !== 'l5fold'); const w0 = H.guide.GUIDE_WATCH.l5fold();
              for (const id of ['start', 'stones', 'needs', 'gear']) if (!L.seen.includes(id)) L.seen.push(id); const w1 = H.guide.GUIDE_WATCH.l5fold(); return { w0, w1, n: L.seen.length }; })()""", 'l5fold')
            check(r['w1'], f"a character given a few field notes is told the Chronicle folds and the notes have a page ({r})")

        errs = await ev(page, "__hm.errors.map(String).slice(0, 5)")
        check(not errs, f'no runtime errors {errs}')
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]', flush=True)
        await b.close()

asyncio.run(main())
