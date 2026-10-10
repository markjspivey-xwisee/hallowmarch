"""Touch flows on a phone (390x780, touch only): every step is a tap on the screen's own buttons (the pad's Use, the
plant card, the builder's bar, the companion bar, the crafting book) or a drag of the stick; window.__hm only sets the
scene (where to stand, what is in the bags) and lets time pass. Flows: drink at a river, fish (cast and strike),
swim out with the stick, till and sow, craft from the book at a workbench, place and turn a building piece, order a
companion, tame a wolf, use a keep hall's war table, go into a keep's corner tower and climb it hatch by hatch ([land]).
usage: python3 tools/tests/touch_flows.py [only=fish,build,...]"""
import asyncio, json, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT.get('only', '').split(',') if 'only' in OPT else None
FAILS = []
def check(ok, msg):
    print(('PASS ' if ok else 'FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)

HELP = r"""
window.TF = {
  H: window.__hm,
  P() { return this.H.GAME.player; },
  calm(r = 70) { const H = this.H, P = this.P(); for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && H.fn.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.target = null; P.combatUntil = 0; },
  stand(x, z, fx, fz) { const H = this.H, P = this.P(); if (H.fn.closeDialog && !document.getElementById('dialog').hidden) H.fn.closeDialog(); for (const id of ['craft', 'mapov']) { const el = document.getElementById(id); if (el && !el.hidden && id === 'craft') H.surv.closeCraft(); } H.teleport(x, z); P.yaw = Math.atan2(fx - x, fz - z); H.CAM.yaw = P.yaw; H.UI.modal = null; H.CAM.mode = 'play'; this.calm(); H.simulate(0.1); return 0; },
  // a dry spot on the Logres river's bank, facing the water
  bank() {
    const W = this.H.water, Rv = W.RIVERS.find((r) => r.realm === 0) || W.RIVERS[0];
    for (let i = Math.floor(Rv.pts.length * 0.5); i < Rv.pts.length - 1; i++) {
      const a = Rv.pts[i], b = Rv.pts[i + 1], tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1, nx = -tz / l, nz = tx / l;
      for (let d = 2; d < 14; d += 0.5) { const x = a.x + nx * d, z = a.z + nz * d; if (!W.waterAt(x, z) && this.H.fn.isWalkable(x, z)) return { x, z, wx: a.x, wz: a.z }; }
    }
    return null;
  },
  label() { const it = this.H.fn.currentInteraction && this.H.fn.currentInteraction(); return it ? it.label : null; },
  // turn (and if need be walk on) until the building piece may go where you look, as a player would
  faceBuild() {
    const H = this.H, B = H.build, P = this.P(), town = H.perf.SITES.find((s) => s.kind === 'town' && s.realm === 0);
    const good = () => { H.simulate(0.1); H.frame(1/30); const M = B.BUILD.mode; return M && M.sn && M.sn.ok; };
    if (good()) return 0;
    for (let r = 90; r < 260; r += 8) for (let a = 0; a < 6.28; a += 0.3) {
      const x = town.x + Math.cos(a) * r, z = town.z + Math.sin(a) * r;
      if (r > 90 || a > 0) { if (!H.fn.isWalkable(x, z) || B.bLandWhy(x, z, P)) continue; H.teleport(x, z); this.calm(); }
      for (let q = 0; q < 8; q++) { P.yaw = q / 8 * 6.283; H.CAM.yaw = P.yaw; if (good()) return 1; }
    }
    return -1;
  },
};
0;
"""

async def tap(page, sel, frames=2):
    """a finger on the middle of what the screen shows for sel (it must be the topmost thing there)"""
    await page.evaluate("__hm.frame(1/30); __hm.hud.HUDL.k = 0; __hm.hud.hudLayout(0); 0")
    box = await page.evaluate("""((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, top: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id || String(hit.className).slice(0, 20)) : null }; })""", sel)
    if not box or not box['top']:
        print('  cannot tap', sel, json.dumps(box)); return False
    await page.touchscreen.tap(box['x'], box['y'])
    for _ in range(frames): await page.evaluate("__hm.frame(1/30); 0")
    return True

async def drag_stick(page, cdp, dx, dy, secs):
    """press the left of the screen, drag the stick, hold it while the world runs, let go"""
    x0, y0 = 90, 600
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchStart', 'touchPoints': [{'x': x0, 'y': y0, 'id': 1}]})
    await page.evaluate("__hm.frame(1/30); 0")
    for k in range(1, 5):
        await cdp.send('Input.dispatchTouchEvent', {'type': 'touchMove', 'touchPoints': [{'x': x0 + dx * k / 4, 'y': y0 + dy * k / 4, 'id': 1}]})
    # the world runs while the finger holds the stick: note whether the body ever swam on the way
    st = await page.evaluate(f"""(() => {{ const H = __hm, P = H.GAME.player, x0 = P.x, z0 = P.z; let swim = false, wd = 0;
      for (let i = 0; i < {secs} * 10; i++) {{ H.simulate(0.1); swim = swim || !!P.swim; wd = Math.max(wd, P.wd || 0); }}
      return {{ moved: Math.round(Math.hypot(P.x - x0, P.z - z0) * 10) / 10, swim, wd: Math.round(wd * 100) / 100, joy: H.INPUT.joy ? 1 : 0 }}; }})()""")
    await cdp.send('Input.dispatchTouchEvent', {'type': 'touchEnd', 'touchPoints': []})
    await page.evaluate("__hm.frame(1/30); 0")
    return st

def want(name): return ONLY is None or name in ONLY

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=True, w=390, h=780)
        cdp = await page.context.new_cdp_session(page)
        await page.evaluate("__hm.start({realm:0, cls:'warrior', level:24}); __hm.setTod(0.5); __hm.dbg.WEATHER.mode = 'clear'; 0")
        await page.evaluate(HELP)
        # the loading veil fades on the wall clock: the first tap waits for it
        await page.wait_for_function("() => { const l = document.getElementById('loading'); return !l || l.hidden || getComputedStyle(l).pointerEvents === 'none'; }", timeout=60000)
        touch = await page.evaluate("document.body.classList.contains('touch')")
        check(touch, 'the phone plays by touch (the pad shows)')

        if want('drink'):
            r = await page.evaluate("""(() => { const b = TF.bank(); if (!b) return null; TF.stand(b.x, b.z, b.wx, b.wz); TF.H.surv.SURV.thirst = 0.25; TF.H.fn.goodsTake && 0; return { b, t0: TF.H.surv.SURV.thirst }; })()""")
            ok = await tap(page, '#t-use')
            await page.evaluate("__hm.simulate(4); 0")
            t1 = await page.evaluate("__hm.surv.SURV.thirst")
            check(r and ok and t1 > r['t0'] + 0.2, f'drink: a tap on Use at the river drinks your fill (thirst {r and r["t0"]} -> {t1:.2f})')

        if want('fish'):
            r = await page.evaluate("""(() => { const b = TF.bank(); TF.stand(b.x, b.z, b.wx, b.wz); TF.H.surv.SURV.thirst = 1; TF.H.surv.SURV.hunger = 1; TF.H.fn.goodsAdd('tool_rod', 1, true); return 0; })()""")
            await tap(page, '#t-use')
            ph = await page.evaluate("(() => { const F = __hm.surv.SURV.fish; return F ? F.phase : null; })()")
            got = await page.evaluate("""(() => { const S = __hm.surv.SURV; for (let i = 0; i < 400 && S.fish && S.fish.phase !== 'bite'; i++) __hm.simulate(0.1); return S.fish ? S.fish.phase : null; })()""")
            before = await page.evaluate("Object.entries(__hm.INV.goods || {}).filter(([k]) => k.startsWith('fish')).reduce((a, [, n]) => a + n, 0)")
            await tap(page, '#t-use')
            await page.evaluate("__hm.simulate(4); 0")
            after = await page.evaluate("Object.entries(__hm.INV.goods || {}).filter(([k]) => k.startsWith('fish')).reduce((a, [, n]) => a + n, 0)")
            check(ph is not None, f'fish: a tap on Use casts the line ({ph})')
            check(got == 'bite' and after > before, f'fish: a tap at the bite strikes and lands a fish ({got}, fish {before} -> {after})')

        if want('swim'):
            await page.evaluate("""(() => { const b = TF.bank(); TF.stand(b.x, b.z, b.wx, b.wz); return 0; })()""")
            st = await drag_stick(page, cdp, 0, -45, 6)
            check(st['swim'] or st['wd'] > 0.5, f'swim: the stick walks you into the river until you swim ({json.dumps(st)})')
            await page.evaluate("(() => { const b = TF.bank(); TF.stand(b.x, b.z, b.wx, b.wz); return 0; })()")

        if want('farm'):
            r = await page.evaluate("""(() => { const H = TF.H, F = H.farm, fn = H.fn, P = TF.P();
              fn.goodsAdd('tool_hoe', 1, true); fn.goodsAdd('seed_grain', 12, true);
              // open meadow of your own realm, clear of the town and the roads
              const town = H.perf.SITES.find((s) => s.kind === 'town' && s.realm === 0);
              let spot = null;
              for (let r = 70; r < 160 && !spot; r += 6) for (let a = 0; a < 6.28 && !spot; a += 0.35) { const x = town.x + Math.cos(a) * r, z = town.z + Math.sin(a) * r; if (fn.isWalkable(x, z) && !F.tillWhy(x, z)) spot = { x, z }; }
              if (!spot) return null;
              TF.stand(spot.x - 1.5, spot.z, spot.x + 3, spot.z); H.simulate(0.4);
              return { spot, plots: F.FARM.plots.length }; })()""")
            await page.evaluate("for (let i = 0; i < 4; i++) __hm.frame(1/10); 0")
            ok = await tap(page, '#farmcard .fc-acts .btn.primary')
            await page.evaluate("__hm.simulate(6); for (let i = 0; i < 4; i++) __hm.frame(1/10); 0")
            n1 = await page.evaluate("__hm.farm.FARM.plots.length")
            check(r and ok and n1 > r['plots'], f"farm: the plant card's first button tills a bed ({r and r["plots"]} -> {n1})")
            lab = await page.evaluate("(() => { const b = document.querySelector('#farmcard .fc-acts .btn.primary'); return b ? b.textContent : null; })()")
            ok2 = await tap(page, '#farmcard .fc-acts .btn.primary')
            await page.evaluate("__hm.simulate(4); 0")
            sown = await page.evaluate("(() => { const L = __hm.farm.FARM.plots; const P = L[L.length - 1]; return P ? P.plants.filter((q) => q && q.crop).length : 0; })()")
            check(ok2 and sown > 0, f'farm: then it sows ("{lab}", {sown} plants)')

        if want('craft'):
            r = await page.evaluate("""(() => { const H = TF.H, S = H.surv.CRAFT.stations.find((q) => q.kind === 'workbench' && q.realm === 0) || H.surv.CRAFT.stations.find((q) => q.kind === 'workbench') || H.surv.CRAFT.stations[0];
              const fn = H.fn; fn.goodsAdd('log', 10, true); fn.goodsAdd('plank', 10, true); fn.goodsAdd('nail', 10, true); fn.goodsAdd('iron', 6, true); fn.goodsAdd('hide', 6, true);
              const a = S.yaw || 0; const x = S.x + Math.sin(a) * 1.8, z = S.z + Math.cos(a) * 1.8; TF.stand(x, z, S.x, S.z);
              return { kind: S.kind, label: TF.label() }; })()""")
            ok = await tap(page, '#t-use', 4)
            modal = await page.evaluate("__hm.UI.modal")
            goods0 = await page.evaluate("JSON.stringify(__hm.INV.goods)")
            btn = await page.evaluate("(() => { const b = [...document.querySelectorAll('#craft button[data-n]')].find((q) => !q.disabled && q.offsetParent); if (!b) return null; b.setAttribute('data-tf', '1'); return b.textContent.trim().slice(0, 40); })()")
            ok2 = btn and await tap(page, '#craft button[data-tf="1"]', 2)
            # close the book as a finger would (its own close button, else Esc's way), then let the work finish
            closed = await tap(page, '#craft-close', 2)
            await page.evaluate("(() => { if (__hm.UI.modal === 'craft') __hm.surv.closeCraft(); __hm.simulate(12); return 0; })()")
            check(closed, 'craft: the book closes with its own button')
            goods1 = await page.evaluate("JSON.stringify(__hm.INV.goods)")
            check(ok and modal == 'craft', f'craft: a tap on Use at the {r["kind"]} opens the crafting book ({r["label"]}, modal {modal})')
            check(bool(ok2) and goods1 != goods0, f'craft: a tap on a recipe makes it ("{btn}")')

        if want('build'):
            r = await page.evaluate("""(() => { const H = TF.H, B = H.build, fn = H.fn, P = TF.P();
              fn.goodsAdd('tool_hammer', 1, true); fn.goodsAdd('stone', 20, true); fn.goodsAdd('plank', 20, true); fn.goodsAdd('log', 20, true); fn.goodsAdd('nail', 20, true);
              const town = H.perf.SITES.find((s) => s.kind === 'town' && s.realm === 0);
              let spot = null;
              for (let r = 90; r < 220 && !spot; r += 8) for (let a = 0; a < 6.28 && !spot; a += 0.3) { const x = town.x + Math.cos(a) * r, z = town.z + Math.sin(a) * r; if (fn.isWalkable(x, z) && !B.bLandWhy(x, z, P)) spot = { x, z }; }
              if (!spot) return null;
              TF.stand(spot.x, spot.z, spot.x + 1, spot.z + 3); return { n: B.BUILD.pieces.length }; })()""")
            ok = await tap(page, '#btn-build', 3)
            ok1 = await tap(page, '#buildbar [data-piece="found"]', 2)
            # the piece goes where you look: turn (and if need be walk on) until it may go there, as a player would
            await page.evaluate("TF.faceBuild()")
            rot0 = await page.evaluate("__hm.build.BUILD.mode ? __hm.build.BUILD.mode.rot : -1")
            ok2 = await tap(page, '#buildbar [data-b="rot"]', 2)
            rot1 = await page.evaluate("__hm.build.BUILD.mode ? __hm.build.BUILD.mode.rot : -1")
            await page.evaluate("TF.faceBuild()") # the turned piece may meet a tree where the first did not
            ok3 = await tap(page, '#buildbar [data-b="place"]', 3)
            n1 = await page.evaluate("__hm.build.BUILD.pieces.length") # a piece set down stands as a plan until it is built
            check(r and ok and ok1 and ok2 and rot1 != rot0, f'build: the hammer button opens the bar, a piece is picked and Turn turns it ({rot0} -> {rot1})')
            check(ok3 and r and n1 > r['n'], f'build: Place sets it down ({r and r["n"]} -> {n1} pieces)')
            await tap(page, '#buildbar [data-b="done"]', 2)

        if want('companion'):
            r = await page.evaluate("""(() => { const H = TF.H, A = H.animals, P = TF.P(); TF.stand(P.x, P.z, P.x + 1, P.z); TF.calm(); if (!A.anCompanions().length) A.anSpawn(A.anRecord('hound', { owner: 'player', cmd: 'follow' }), P.x + 1.5, P.z + 1); return A.anCompanions().map((e) => e.tame.cmd); })()""")
            await page.evaluate("for (let i = 0; i < 10; i++) __hm.frame(1/30); 0")
            ok = await tap(page, '#petbar [data-cmd="stay"]', 3)
            c1 = await page.evaluate("__hm.animals.anCompanions().map((e) => e.tame.cmd)")
            ok2 = await tap(page, '#petbar [data-cmd="follow"]', 3)
            c2 = await page.evaluate("__hm.animals.anCompanions().map((e) => e.tame.cmd)")
            check(ok and ok2 and all(c == 'stay' for c in c1) and all(c == 'follow' for c in c2), f'companion: Stay and Follow on the companion bar ({r} -> {c1} -> {c2})')

        if want('tame'):
            r = await page.evaluate("""(() => { const H = TF.H, A = H.animals, fn = H.fn, P = TF.P();
              let w = null, bd = 1e12; for (const e of H.ENT) { if (A.anWildKind(e) !== 'hound') continue; const d = (e.x - P.x) ** 2 + (e.z - P.z) ** 2; if (d < bd) { bd = d; w = e; } }
              if (!w) return null;
              fn.goodsAdd('meat_raw', 14, true);
              const x = w.x - 3, z = w.z; H.teleport(x, z); P.yaw = Math.atan2(w.x - x, w.z - z); H.CAM.yaw = P.yaw; P.combatUntil = 0; w.ai.tameHold = H.GAME.t + 4;
              window.__tfw = w; return { id: w.id, n0: A.anCompanions().length }; })()""")
            tamed = False; taps = 0
            for k in range(10):
                await page.evaluate("""(() => { const H = TF.H, A = H.animals, w = window.__tfw, P = TF.P(); if (!w || !H.ENT.includes(w)) return 0; const T = A.anTrust(w); for (let i = 0; i < 40 && T.settle < 1; i++) H.simulate(0.25); T.last = -99; P.combatUntil = 0; const d = Math.hypot(w.x - P.x, w.z - P.z); if (d > 3.4) { H.teleport(w.x - 2.6, w.z); P.yaw = Math.atan2(w.x - P.x, w.z - P.z); } return 0; })()""")
                await tap(page, '#t-use', 1); taps += 1
                await page.evaluate("__hm.simulate(1.5); 0")
                n = await page.evaluate("__hm.animals.anCompanions().length")
                if r and n > r['n0']: tamed = True; break
            check(r and tamed, f'tame: taps on Use offering meat win a wolf over ({taps} taps)')

        if want('wartable'):
            r = await page.evaluate("""(() => { const H = TF.H, h = H.fn.halls().find((q) => q.realm === 0 && q.state !== 'ruin'), sp = h.hallSpots.table; const dx = h.x - sp.x, dz = h.z - sp.z, d = Math.hypot(dx, dz) || 1; const x = sp.x + dx / d * 1.1, z = sp.z + dz / d * 1.1;
              if (h.door && h.door.leaf) H.fn.setHouseDoor && H.fn.setHouseDoor(h, true);
              TF.stand(x, z, sp.x, sp.z); return { label: TF.label() }; })()""")
            ok = await tap(page, '#t-use', 3)
            st = await page.evaluate("({ modal: __hm.UI.modal, grant: __hm.fn.hallCommandGrant ? !!__hm.fn.hallCommandGrant(__hm.GAME.player) : null })")
            check(ok and st['modal'] == 'map', f'war table: a tap on Use opens the map with command ({r["label"]}; {json.dumps(st)})')
            await page.evaluate("__hm.UI.modal === 'map' && __hm.fn.toggleMap(); __hm.UI.modal = null; 0")
            # names do not show through the hall's walls
            nm = await page.evaluate("""(() => { const H = TF.H, F = H.fn, h = F.halls().find((q) => q.realm === 0); if (F.setHouseDoor) F.setHouseDoor(h, false); for (let i = 0; i < 6; i++) { H.simulate(0.1); H.frame(1/30); }
              const shown = [...document.querySelectorAll('#nameplates .np')].filter((el) => el.style.display !== 'none').map((el) => el._txt);
              const outside = shown.filter((n) => { const e = H.ENT.find((q) => q.name === n && q.alive); return e && F.houseInside(e.x, e.z) !== h; });
              const near = H.ENT.filter((e) => e.alive && e.kind === 'humanoid' && e !== TF.P() && Math.hypot(e.x - h.x, e.z - h.z) < 30 && F.houseInside(e.x, e.z) !== h).length;
              return { shown: shown.length, outside, near, inside: F.houseInside(TF.P().x, TF.P().z) === h }; })()""")
            check(nm['inside'] and not nm['outside'], f'names: inside the hall no name shows through its walls ({json.dumps(nm)})')

        if want('tower'):
            # [land] a stone keep's corner tower by touch: the stick walks you in at its door (it swings open), taps on
            # Use push each hatch open and climb each ladder, from the store room to the guard room to the top
            r = await page.evaluate("""(() => { const H = TF.H, F = H.fn, S = H.REALMS[0].keepSites[0], T = H.towers.TOWER.list.find((q) => q.S === S && q.sx === 1 && q.sz === 1);
              const o = F.siteToWorld(S, T.cx + Math.sin(T.aIn) * 6, T.cz + Math.cos(T.aIn) * 6), c = F.siteToWorld(S, T.cx, T.cz); TF.stand(o.x, o.z, c.x, c.z); window.__tft = T; return { d0: +Math.hypot(o.x - c.x, o.z - c.z).toFixed(1) }; })()""")
            st = await drag_stick(page, cdp, 0, -45, 3)
            inn = await page.evaluate("""(() => { const T = window.__tft, P = TF.P(), c = TF.H.fn.siteToWorld(T.S, T.cx, T.cz); return { d: +Math.hypot(P.x - c.x, P.z - c.z).toFixed(2), y: +(P.y - T.S.y).toFixed(2), door: +T.doors[0].k.toFixed(2) }; })()""")
            check(inn['d'] < 2.4 and inn['door'] > 0.5, f'tower: the stick walks you in at the courtyard door, which swings open ({json.dumps(inn)})')
            ys = []
            for L in (0, 1):
                lab = await page.evaluate(f"""(() => {{ const H = TF.H, T = window.__tft, L = T.ladders[{L}], p = H.fn.siteToWorld(T.S, L.foot.x, L.foot.z); TF.stand(p.x, p.z, L.lx, L.lz); const P = TF.P(); P.y = L.wyb; H.simulate(0.2); return TF.label(); }})()""")
                ok1 = await tap(page, '#t-use')
                await page.evaluate("__hm.simulate(1.2); 0")
                lab2 = await page.evaluate("TF.label()")
                ok2 = await tap(page, '#t-use')
                y = await page.evaluate("""(() => { const H = TF.H, P = TF.P(); for (let i = 0; i < 40 && (P.motion || i < 2); i++) H.simulate(0.25); return +(P.y - window.__tft.S.y).toFixed(2); })()""")
                ys.append([lab, lab2, y])
            check(ys[0][0] == 'Push the hatch open' and ys[0][1] == 'Climb the ladder' and abs(ys[0][2] - 7) < 0.1, f'tower: Use pushes the hatch open and climbs to the guard room ({json.dumps(ys[0])})')
            check(ys[1][0] == 'Push the hatch open' and ys[1][1] == 'Climb the ladder' and abs(ys[1][2] - 10.5) < 0.1, f'tower: and on through the next hatch onto the top ({json.dumps(ys[1])})')

        await page.screenshot(path=OUT + 'touch_flows.png', timeout=300000)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no errors {errs[:2]}')
        await b.close()
    print(f'{len(FAILS)} failures')

asyncio.run(main())
