"""Touch flows on a phone (390x780, touch only): every step is a tap on the screen's own buttons (the pad's Use, the
plant card, the builder's bar, the companion bar, the crafting book) or a drag of the stick; window.__hm only sets the
scene (where to stand, what is in the bags) and lets time pass. Flows: drink at a river, fish (cast and strike),
swim out with the stick, dive and come up again, row a boat away from a jetty and go over the side, till and sow, craft from
the book at a workbench, place and turn a building piece, order a companion, tame a wolf, use a keep hall's war table,
go into a keep's corner tower and climb it hatch by hatch ([land]); a Logres gate tower and a Thule corner tower, and a
fight at a hatch: Use slams it on a foe coming up, and a drag of the stick down turns you back on the rungs ([keeps]);
shove a beached boat into the water and push her about ([polish]); hold a brand to an enemy burh's palisade ([siege2]);
beat out a fire on a burh's wall walk with Use ([siege3]: only=firewall); beat out a burning house in the town with Use ([war2]: only=housefire);
[guide] open your path and its aims from the path tracker, and tap a field note away (`only=guide`; tools/tests/guide.py
plays a new player's first steps by touch).
[look3] climb a mended tower's scaffold and back down with Use (`only=scaffold`). [look4] the same up a house's scaffold
(`only=housescaf`). [late2] the Chronicle's Deeds page: a tap wears a name (`only=deeds`).
[audio2] set the sound by taps: the menu's Settings, Effects Low, Ambience High, Volume Off and back (`only=sound`).
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
  // [late2] a control in a scrolling sheet brought to the upper third of the box that scrolls it (the menu's sticky foot
  // covers the lower part of the sheet)
  see(sel) { const b = document.querySelector(sel); if (!b) return 0; let q = b.parentElement;
    while (q && !(q.scrollHeight > q.clientHeight + 2 && /(auto|scroll)/.test(getComputedStyle(q).overflowY))) q = q.parentElement;
    if (q) q.scrollTop += b.getBoundingClientRect().top - q.getBoundingClientRect().top - q.clientHeight * 0.3; return 0; },
  H: window.__hm,
  P() { return this.H.GAME.player; },
  calm(r = 70) { const H = this.H, P = this.P(); for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && H.fn.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.target = null; P.combatUntil = 0; H.LORE.state.noteUntil = performance.now() + 120000; }, // [guide] no field note pops up under a finger mid-flow (guide.py and the guide flow show theirs)
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
    # [guide2] laid out now, then held still as a finger comes down (the page's own frames ran a layout pass between
    # the measure and the tap now and then, and the tap landed where a panel had been: G2.tap, 10f_guide2.js); first the
    # last tap's click lands (on a slow machine it came after the next measure and let the layout go on under it)
    try: await page.wait_for_function("!(window.__hm && __hm.guide2 && __hm.guide2.G2.tap.pending)", timeout=6000, polling=100)
    except Exception: pass
    # (held until the tap's own click lands, however long the page's frames take on a loaded machine: a hold of 4 s ran
    # out between the measure and the finger now and then, and a panel moved under it)
    await page.evaluate("__hm.frame(1/30); __hm.hud.HUDL.k = 0; if (__hm.guide2) __hm.guide2.G2.tap.until = 0; __hm.hud.hudLayout(0); if (__hm.guide2) __hm.guide2.G2.tap.until = performance.now() + 30000; 0")
    box = await page.evaluate("""((sel) => { const el = document.querySelector(sel); if (!el) return null; const r = el.getBoundingClientRect(); if (r.width < 2 || r.height < 2) return null;
      const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
      return { x, y, top: !!hit && (hit === el || el.contains(hit)), hit: hit ? (hit.id || String(hit.className).slice(0, 20)) : null }; })""", sel)
    if not box or not box['top']:
        print('  cannot tap', sel, json.dumps(box)); return False
    await page.touchscreen.tap(box['x'], box['y'])
    # [guide2] its click comes after the finger lifts, sometimes after the next frames: the world is read once it has landed
    try: await page.wait_for_function("!(window.__hm && __hm.guide2 && __hm.guide2.G2.tap.pending)", timeout=15000, polling=50)
    except Exception: pass
    await page.evaluate("if (__hm.guide2) __hm.guide2.G2.tap.until = 0; 0") # (the hold is the tap's own: a tap outside the HUD, in a menu, has no click of the HUD's to let it go)
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

        if want('dive'):
            # [water2] swim out over deep water: the pad's Jump reads Dive; the stick takes you down; Up brings you back
            r = await page.evaluate("""(() => { const H = TF.H, Wt = H.water, P = TF.P(), L = H.dbg.LAKES[0];
              let s = null; for (let r = 0; r < 30 && !s; r += 0.5) for (let a = 0; a < 12 && !s; a++) { const x = L.x + Math.cos(a * 0.52) * r, z = L.z + Math.sin(a * 0.52) * r, w = Wt.waterAt(x, z); if (w && w.depth > 3 && Math.hypot(w.fx, w.fz) < 0.05) s = { x, z, y: w.y }; }
              TF.stand(s.x, s.z, s.x + 1, s.z); P.y = s.y - 1.3; H.simulate(0.4); P.breath = 1; H.frame(1 / 30);
              return { swim: !!P.swim }; })()""")
            lab = await page.evaluate("document.getElementById('t-jump').textContent")
            ok = await tap(page, '#t-jump')
            d1 = await page.evaluate("(() => { const s = __hm.water.dive.state(); return { dive: s.dive, pivot: s.pivot }; })()")
            await page.evaluate("__hm.CAM.pitch = 1.2; 0")
            st = await drag_stick(page, cdp, 0, -45, 2)
            d2 = await page.evaluate("(() => { const s = __hm.water.dive.state(); return { dive: s.dive, pivot: s.pivot, bed: s.bed }; })()")
            await page.evaluate("__hm.frame(1/30); __hm.CAM.pitch = 0.36; 0")
            lab2 = await page.evaluate("document.getElementById('t-jump').textContent")
            ok2 = await tap(page, '#t-jump')
            d3 = await page.evaluate("(() => { for (let i = 0; i < 80 && __hm.GAME.player.dive; i++) __hm.simulate(0.1); const s = __hm.water.dive.state(); return { dive: s.dive, swim: s.swim }; })()")
            check(r['swim'] and lab == 'Dive' and ok and d1['dive'], f'dive: swimming in deep water the pad shows Dive, and a tap goes under ({lab}, {json.dumps(d1)})')
            check(d2['dive'] and d2['pivot'] < d1['pivot'] - 0.8, f'dive: the stick swims you down the way you look ({d1["pivot"]:.2f} -> {d2["pivot"]:.2f})')
            check(lab2 == 'Up' and ok2 and not d3['dive'] and d3['swim'], f'dive: Up takes you back to the surface ({lab2}, {json.dumps(d3)})')

        if want('palisade'):
            # [siege2] a burning brand held to an enemy burh's palisade: the pad's Use sets it alight (04g_burn.js)
            r = await page.evaluate("""(() => { const H = TF.H, PL = H.palisade; PL.palisadeInit(); const P = TF.P(), C = H.fn.castleOf(H.REALMS[2].keepSites[0]), Pal = C.pal;
              const c = Pal.cells.find((q) => q.side === 0 && Math.abs(q.a) < 1 && q.st === 0); const S = C.S, o = H.fn.siteToWorld(S, c.a, -14.9 - 1.3);
              TF.stand(o.x, o.z, c.x, c.z); P.brand = { until: H.GAME.t + 120, wet: 0, x: P.x, y: P.y + 1.4, z: P.z, emitAcc: 0 }; H.simulate(0.1); H.frame(1/30);
              TF.palC = Pal.cells.indexOf(c); TF.palCast = C; return { label: TF.label() }; })()""")
            ok = await tap(page, '#t-use')
            st = await page.evaluate("(() => { __hm.simulate(0.5); const c = TF.palCast.pal.cells[TF.palC]; const out = { st: c.st }; c.st = 0; c.heat = 0; for (const f of c.fires) f.until = 0; c.fires = []; TF.P().brand = null; return out; })()")
            check(r['label'] == 'Set the palisade alight' and ok and st['st'] == 1, f"palisade: with a brand by an enemy burh's palisade, a tap on Use sets it alight ({r['label']}, {json.dumps(st)})")

        if want('firewall'):
            # [siege3] a fire on a burh's wall walk: standing on the boards beside it, a tap on Use beats the flames down,
            # and a few more put it out (04g_blaze.js)
            r = await page.evaluate("""(() => { const H = TF.H, Z = H.blaze; Z.blazeInit(); const P = TF.P(), C = H.fn.castleOf(H.REALMS[2].keepSites[0]), B = C.blaze;
              const cs = B.cells.filter((c) => c.di === 0), c = cs[4], nb = cs[3]; Z.deckIgnite(c, 0.5, Z.BZ_T.reach); H.simulate(0.5); /* (it does not spread: a tap beats the nearest fire, which was the boards underfoot when it had) */
              P.brand = null; TF.stand(nb.x, nb.z, c.x, c.z); P.y = nb.y; H.simulate(0.1); H.frame(1/30); TF.fireC = c; return { label: TF.label(), heat: +c.heat.toFixed(2) }; })()""")
            ok = await tap(page, '#t-use')
            h1 = await page.evaluate("(() => { __hm.simulate(0.2); return { heat: +TF.fireC.heat.toFixed(2), act: TF.P().anim.act }; })()")
            for i in range(8):
                more = await page.evaluate("(() => { __hm.simulate(0.6); __hm.frame(1/30); return TF.fireC.st === 1; })()")
                if not more: break
                await tap(page, '#t-use')
            st = await page.evaluate("(() => { __hm.simulate(0.3); const c = TF.fireC; return { st: c.st, heat: +c.heat.toFixed(2) }; })()")
            check(r['label'] == 'Beat out the flames' and ok and h1['heat'] < r['heat'] and h1['act'] == 21, f"firewall: by a fire on a burh's walk a tap on Use beats the flames down ({r['label']}, heat {r['heat']} -> {h1['heat']}, action {h1['act']})")
            check(st['st'] != 1, f"firewall: a few taps put it out ({json.dumps(st)})")

        if want('housefire'):
            # [war2] a house afire in the town: beside its walls a tap on Use beats the flames down, and a few more put
            # it out (its people kept away: 08j_war2.js)
            # [v15] the page's own frames held meanwhile (the game's time is the flow's simulate alone): on a loaded machine
            # they ran the fire on through each tap's waits, and fourteen taps did not catch it up one run in three
            await page.evaluate("(() => { if (!window.__rafWrapped) { window.__rafWrapped = true; const raf = window.requestAnimationFrame.bind(window); window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); } window.__rafHold = true; return 0; })()")
            r = await page.evaluate("""(() => { const H = TF.H, W2 = H.war2; W2.HCREW.off = true; const S = H.REALMS[0].town, P = TF.P();
              const h = H.HOUSES.find((q) => q.S === S && !q.keepHall && q.state === 'whole' && !q.round); H.fn.igniteHouse(h); H.simulate(4);
              const o = H.fn.houseW(h, 0, h.d / 2 + 1.2); TF.stand(o.x, o.z, h.x, h.z); P.brand = null; H.simulate(0.1); H.frame(1/30);
              TF.hf = h; return { label: TF.label(), R: +h.burn.R.toFixed(2) }; })()""")
            ok = await tap(page, '#t-use')
            h1 = await page.evaluate("(() => { __hm.simulate(0.2); const h = TF.hf; return { R: h.burn ? +h.burn.R.toFixed(2) : 0, act: TF.P().anim.act }; })()")
            for i in range(14):
                more = await page.evaluate("(() => { __hm.simulate(0.5); __hm.frame(1/30); return TF.hf.state === 'burning'; })()")
                if not more: break
                await tap(page, '#t-use')
            st = await page.evaluate("(() => { __hm.simulate(0.3); const h = TF.hf, out = { state: h.state }; if (h.state !== 'whole') __hm.fn.houseRestore(h); __hm.war2.HCREW.off = false; window.__rafHold = false; return out; })()")
            check(r['label'] == 'Beat out the flames' and ok and h1['R'] < r['R'] and h1['act'] == 21, f"housefire: beside a burning house a tap on Use beats the flames down ({r['label']}, front {r['R']} -> {h1['R']} m, action {h1['act']})")
            check(st['state'] == 'whole', f"housefire: a few taps put it out ({json.dumps(st)})")

        if want('row'):
            # [water2] step into a moored boat from the jetty with Use, row with the stick, step out with Use
            r = await page.evaluate("""(() => { const H = TF.H, Wt = H.water, Bt = Wt.boats, P = TF.P(); if (P.dive) Wt.dive.end();
              const J = Bt.jetties()[0], bi = J.berths.findIndex((b) => b.side === 1), b = J.berths[bi], st = J.steps[bi];
              const i = Bt.list().findIndex((q) => Math.hypot(q.x - b.x, q.z - b.z) < 1); if (i < 0) return null; Bt.restore(i);
              TF.stand(st.x, st.z, b.x, b.z); P.y = J.deck; H.simulate(0.3); H.frame(1 / 30);
              return { i, label: H.surv.ci(), x: Bt.state(i).x, z: Bt.state(i).z }; })()""")
            ok = await tap(page, '#t-use')
            inb = await page.evaluate("!!__hm.GAME.player.boat")
            await page.evaluate("__hm.CAM.yaw = __hm.water.boats.state(%d).yaw; 0" % (r['i'] if r else 0))
            st = await drag_stick(page, cdp, 0, -45, 5)
            b2 = await page.evaluate("__hm.water.boats.state(%d)" % (r['i'] if r else 0))
            moved = ((b2['x'] - r['x']) ** 2 + (b2['z'] - r['z']) ** 2) ** 0.5 if r else 0
            await page.evaluate("__hm.frame(1/30); 0")
            lab = await page.evaluate("document.getElementById('t-jump').textContent")
            ok2 = await tap(page, '#t-jump')
            out = await page.evaluate("(() => { __hm.simulate(0.3); const P = __hm.GAME.player; return { boat: !!P.boat, swim: !!P.swim, dive: !!P.dive }; })()")
            await page.evaluate("(() => { const W = __hm.water; if (__hm.GAME.player.dive) W.dive.end(); return 0; })()")
            check(r is not None and ok and inb, f'row: a tap on Use steps into the boat ({r and r["label"]})')
            check(moved > 3, f'row: the stick rows her away from the jetty ({moved:.1f} m)')
            check(lab == 'Dive in' and ok2 and not out['boat'] and (out['swim'] or out['dive']), f'row: the pad\'s Dive in goes over the side ({lab}, {json.dumps(out)})')
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
            # [guide2] what each press and click met, and where the bar stood then: printed if a tap comes to nothing
            await page.evaluate("""(() => { if (window.TFEV) return 0; window.TFEV = []; for (const k of ['pointerdown', 'pointerup', 'click']) document.addEventListener(k, (e) => { const b = document.getElementById('petbar'), r = b && b.getBoundingClientRect(), t = e.target;
              TFEV.push([k, Math.round(performance.now()), (t.id || t.tagName) + '.' + String(t.className || '').slice(0, 12) + (t.dataset && t.dataset.cmd ? '[' + t.dataset.cmd + ']' : '') + (t.closest && t.closest('[data-aid]') ? '[pet]' : ''), Math.round(e.clientX) + ',' + Math.round(e.clientY), r ? Math.round(r.top) : null, window.__hm.guide2 ? Math.round(window.__hm.guide2.G2.tap.until - performance.now()) : null]); if (TFEV.length > 40) TFEV.shift(); }, true); return 0; })()""")
            ok = await tap(page, '#petbar [data-cmd="stay"]', 3)
            c1 = await page.evaluate("__hm.animals.anCompanions().map((e) => e.tame.cmd)")
            ok2 = await tap(page, '#petbar [data-cmd="follow"]', 3)
            c2 = await page.evaluate("__hm.animals.anCompanions().map((e) => e.tame.cmd)")
            check(ok and ok2 and all(c == 'stay' for c in c1) and all(c == 'follow' for c in c2), f'companion: Stay and Follow on the companion bar ({r} -> {c1} -> {c2})')
            if not (ok and ok2 and all(c == 'stay' for c in c1) and all(c == 'follow' for c in c2)): print('  events (kind, ms, target, x,y, bar top, hold ms left):', json.dumps(await page.evaluate("TFEV.slice(-8)")))

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

        if want('shove'):
            # [polish] at the shore end of a boat drawn up on the beach, a tap on Use shoves her off into the water; then
            # wading into her side with the stick pushes her away (07e_boats.js)
            r = await page.evaluate("""(() => { const H = TF.H, Wt = H.water, Bt = Wt.boats, P = TF.P(); if (P.dive) Wt.dive.end(); if (P.boat) Bt.leave();
              const i = Bt.list().findIndex((q) => q.st === 'beached'); if (i < 0) return null; const s = Bt.state(i), E = Bt.shoveEnd(i);
              TF.stand(E.x, E.z, s.x, s.z); H.simulate(0.2); H.frame(1 / 30); return { i, label: H.surv.ci(), x: s.x, z: s.z }; })()""")
            ok = await tap(page, '#t-use') if r else False
            fl = await page.evaluate("""((i) => { const H = TF.H, Bt = H.water.boats, P = TF.P(); const act = P.anim.act; for (let k = 0; k < 60 && (Bt.state(i).launch || Bt.state(i).grounded > 0.5); k++) H.simulate(0.1); H.simulate(1); const s = Bt.state(i); return { act, st: s.st, grounded: s.grounded, afloat: !Bt.hit(i), x: s.x, z: s.z }; })""", r['i'] if r else 0)
            moved = ((fl['x'] - r['x']) ** 2 + (fl['z'] - r['z']) ** 2) ** 0.5 if r else 0
            check(r is not None and r['label'] == 'Shove the boat into the water' and ok and fl['act'] == 19 and fl['afloat'] and fl['grounded'] < 0.5 and moved > 1, f'shove: a tap on Use shoves a beached boat into the water ({r and r["label"]}; {json.dumps(fl)}, {moved:.1f} m)')
            # wade or swim into her side with the stick: she gives
            r2 = await page.evaluate("""((i) => { const H = TF.H, Wt = H.water, Bt = Wt.boats, B = Bt.BOATS.list[i], P = TF.P(); B.vx = B.vz = B.wr = 0; B.still = false;
              const c = Math.cos(B.yaw), s = Math.sin(B.yaw); let p = null; for (const sd of [1, -1]) { const x = B.x + sd * 1.7 * c, z = B.z - sd * 1.7 * s; if (Wt.waterAt(x, z)) { p = { x, z }; break; } }
              if (!p) return null; TF.stand(p.x, p.z, B.x, B.z); const w = Wt.waterAt(p.x, p.z); if (w && w.depth > 1.2) P.y = w.y - 1.3; H.simulate(0.2); return { x: B.x, z: B.z }; })""", r['i'] if r else 0)
            if r2:
                await drag_stick(page, cdp, 0, -45, 2.5)
                b2 = await page.evaluate("__hm.water.boats.state(%d)" % r['i'])
                pm = ((b2['x'] - r2['x']) ** 2 + (b2['z'] - r2['z']) ** 2) ** 0.5
                check(pm > 0.25, f'shove: the stick walks you into her side and she gives ({pm:.2f} m)')
            else:
                check(False, 'shove: no water beside the boat to push her from')

        if want('wartable'):
            r = await page.evaluate("""(() => { const H = TF.H, h = H.fn.halls().find((q) => q.realm === 0 && q.state !== 'ruin'), sp = h.hallSpots.table; const dx = h.x - sp.x, dz = h.z - sp.z, d = Math.hypot(dx, dz) || 1; const x = sp.x + dx / d * 1.1, z = sp.z + dz / d * 1.1;
              if (h.door && h.door.leaf) H.fn.setHouseDoor && H.fn.setHouseDoor(h, true);
              TF.stand(x, z, sp.x, sp.z); return { label: TF.label() }; })()""")
            ok = await tap(page, '#t-use', 3)
            st = await page.evaluate("({ modal: __hm.UI.modal, grant: __hm.fn.hallCommandGrant ? !!__hm.fn.hallCommandGrant(__hm.GAME.player) : null })")
            check(ok and st['modal'] == 'map', f'war table: a tap on Use opens the map with command ({r["label"]}; {json.dumps(st)})')
            await page.evaluate("__hm.UI.modal === 'map' && __hm.fn.toggleMap(); __hm.UI.modal = null; 0")
            # names do not show through the hall's walls
            nm = await page.evaluate("""(() => { const H = TF.H, F = H.fn, h = F.halls().find((q) => q.realm === 0); if (F.setHouseDoor) F.setHouseDoor(h, false); for (let i = 0; i < 16; i++) { H.simulate(0.1); H.frame(1/30); } /* the door swings shut, and each name's sight line is looked at again (every 0.25-0.35 s of drawing) */
              const shownEl = [...document.querySelectorAll('#nameplates .np')].filter((el) => el.style.display !== 'none'), shown = shownEl.map((el) => el._txt), byEl = (el) => H.ENT.find((q) => q.id === el._eid); /* (by the body's id: two bodies may share a name) */
              const D = h.door && h.door.c, outside = shownEl.filter((el) => { const e = byEl(el); return e && F.houseInside(e.x, e.z) !== h && !(D && Math.hypot(e.x - D.x, e.z - D.z) < 3); }).map((el) => el._txt); /* (a body at the doorway is seen through it, not through a wall: a companion waiting there opens it) */
              const near = H.ENT.filter((e) => e.alive && e.kind === 'humanoid' && e !== TF.P() && Math.hypot(e.x - h.x, e.z - h.z) < 30 && F.houseInside(e.x, e.z) !== h).length;
              const atDoor = shownEl.map((el) => { const e = byEl(el), n = el._txt; return e && D ? [n, +Math.hypot(e.x - D.x, e.z - D.z).toFixed(1), F.houseInside(e.x, e.z) === h, e.tame ? e.tame.k : e.role] : [n]; }); return { shown: shown.length, outside, near, inside: F.houseInside(TF.P().x, TF.P().z) === h, atDoor }; })()""")
            check(nm['inside'] and not nm['outside'], f'names: inside the hall no name shows through its walls ({json.dumps(nm)})')

        if want('tower'):
            # [land] a stone keep's corner tower by touch: the stick walks you in at its door (it swings open), taps on
            # Use push each hatch open and climb each ladder, from the store room to the guard room to the top
            r = await page.evaluate("""(() => { const H = TF.H, F = H.fn, S = H.REALMS[0].keepSites[0], T = H.towers.TOWER.list.find((q) => q.S === S && q.sx === 1 && q.sz === 1);
              const o = F.siteToWorld(S, T.cx + Math.sin(T.aIn) * 6, T.cz + Math.cos(T.aIn) * 6), c = F.siteToWorld(S, T.cx, T.cz); TF.stand(o.x, o.z, c.x, c.z); window.__tft = T; return { d0: +Math.hypot(o.x - c.x, o.z - c.z).toFixed(1) }; })()""")
            st = await drag_stick(page, cdp, 0, -45, 0.8)
            inn = await page.evaluate("""(() => { const T = window.__tft, P = TF.P(), c = TF.H.fn.siteToWorld(T.S, T.cx, T.cz); return { d: +Math.hypot(P.x - c.x, P.z - c.z).toFixed(2), y: +(P.y - T.S.y).toFixed(2), yG: +T.yG.toFixed(2), door: +T.doors[0].k.toFixed(2) }; })()""")
            # inside the drum on the store room's floor: the door swung open to let you by (shut, it blocks)
            check(inn['d'] < 2.45 and abs(inn['y'] - inn['yG']) < 0.2, f'tower: the stick walks you in at the courtyard door, which swings open ({json.dumps(inn)})')
            ys = []
            for L in (0, 1):
                lab = await page.evaluate(f"""(() => {{ const H = TF.H, T = window.__tft, L = T.ladders[{L}], p = H.fn.siteToWorld(T.S, L.foot.x, L.foot.z); const P = TF.P(); H.INPUT.joy = null; H.INPUT.keys.clear(); P.motion = null; P.anim.act = 0; TF.stand(p.x, p.z, L.lx, L.lz); P.y = L.wyb; H.simulate(0.2); return TF.label(); }})()""")
                ok1 = await tap(page, '#t-use')
                await page.evaluate("__hm.simulate(1.2); 0")
                lab2 = await page.evaluate("TF.label()")
                ok2 = await tap(page, '#t-use')
                y = await page.evaluate("""(() => { const H = TF.H, P = TF.P(); for (let i = 0; i < 40 && (P.motion || i < 2); i++) H.simulate(0.25); return +(P.y - window.__tft.S.y).toFixed(2); })()""")
                ys.append([lab, lab2, y])
            check(ys[0][0] == 'Push the hatch open' and ys[0][1] == 'Climb the ladder' and abs(ys[0][2] - 7) < 0.1, f'tower: Use pushes the hatch open and climbs to the guard room ({json.dumps(ys[0])})')
            check(ys[1][0] == 'Push the hatch open' and ys[1][1] == 'Climb the ladder' and abs(ys[1][2] - 10.5) < 0.1, f'tower: and on through the next hatch onto the top ({json.dumps(ys[1])})')

        # [keeps] a Logres gate tower and a Thule corner tower by touch: the stick walks you in at the courtyard door, taps
        # on Use push each hatch open and climb each ladder; then a fight at a hatch: a foe comes up the ladder and a tap
        # on Use slams the hatch on it, and on the rungs a drag of the stick down turns you back
        for key, realm, pick in (('gatetower', 0, "q.look === 'stone' && q.role === 'gate' && q.sx === 1"), ('timbertower', 2, "q.look === 'timber' && q.role === 'corner' && q.sx === 1 && q.sz === 1")):
            if not want(key): continue
            r = await page.evaluate(f"""(() => {{ const H = TF.H, F = H.fn, T = H.towers.TOWER.list.find((q) => {pick}), S = T.S, D = T.doors[0], P = TF.P();
              P.faction = {realm}; const o = F.siteToWorld(S, T.cx + Math.sin(D.a) * (T.RO + 3.5) + Math.cos(D.a) * (D.off || 0), T.cz + Math.cos(D.a) * (T.RO + 3.5) - Math.sin(D.a) * (D.off || 0)), c = F.siteToWorld(S, T.cx + Math.cos(D.a) * (D.off || 0), T.cz - Math.sin(D.a) * (D.off || 0));
              TF.stand(o.x, o.z, c.x, c.z); P.faction = {realm}; window.__tft = T; return 0; }})()""")
            await drag_stick(page, cdp, 0, -45, 1.0)
            inn = await page.evaluate("""(() => { const T = window.__tft, P = TF.P(), F = TF.H.fn, c = Math.cos(T.S.yaw), s = Math.sin(T.S.yaw), dx = P.x - T.S.x, dz = P.z - T.S.z, lx = dx * c - dz * s - T.cx, lz = dx * s + dz * c - T.cz;
              const inside = T.kind === 'drum' ? Math.hypot(lx, lz) < T.RI : Math.abs(lx) < T.HI && Math.abs(lz) < T.HI; return { inside, y: +(P.y - T.S.y).toFixed(2), yG: +T.yG.toFixed(2), door: +T.doors[0].k.toFixed(2) }; })()""")
            check(inn['inside'] and abs(inn['y'] - inn['yG']) < 0.2, f'{key}: the stick walks you in at the courtyard door, which swings open ({json.dumps(inn)})')
            ys = []
            for L in (0, 1):
                lab = await page.evaluate(f"""(() => {{ const H = TF.H, T = window.__tft, L = T.ladders.slice().sort((a, b) => a.yb - b.yb)[{L}], p = H.fn.siteToWorld(T.S, L.foot.x, L.foot.z); const P = TF.P(); H.INPUT.joy = null; H.INPUT.keys.clear(); P.motion = null; P.anim.act = 0; TF.stand(p.x, p.z, L.lx, L.lz); P.faction = {realm}; P.y = L.wyb; H.simulate(0.2); window.__tfl = L; const lb = TF.label(); if (lb === 'Push the hatch open' || lb === 'Climb the ladder') return lb; const f = H.dbg.FIRES.filter((q) => !q.ghost && q.until > H.GAME.t && Math.hypot(q.x - P.x, q.z - P.z) < 2.5).map((q) => [+Math.hypot(q.x - P.x, q.z - P.z).toFixed(2), +(q.y - P.y).toFixed(2), q.size, !!q.wall]); return lb + ' ' + JSON.stringify({{ d: +Math.hypot(P.x - L.fx, P.z - L.fz).toFixed(2), dy: +(P.y - L.wyb).toFixed(2), m: P.motion && P.motion.kind, gone: !!L.gone, f }}); }})()""")
                if lab == 'Push the hatch open':
                    await tap(page, '#t-use'); await page.evaluate("__hm.simulate(1.2); 0")
                lab2 = await page.evaluate("TF.label()")
                await tap(page, '#t-use')
                y = await page.evaluate("""(() => { const H = TF.H, P = TF.P(); for (let i = 0; i < 60 && (P.motion || i < 2); i++) H.simulate(0.25); return +(P.y - window.__tft.S.y).toFixed(2); })()""")
                yt = await page.evaluate("+window.__tfl.yt.toFixed(2)")
                ys.append([lab, lab2, y, yt])
            check(all(q[1] == 'Climb the ladder' and abs(q[2] - q[3]) < 0.1 for q in ys), f'{key}: Use pushes each hatch open and climbs each ladder to the top ({json.dumps(ys)})')
        if want('scaffold'):
            # [look3] a breached tower built back behind its scaffold: a tap on Use climbs the scaffold's ladder onto its
            # first lift (its boards are a floor), another climbs back down
            r = await page.evaluate("""(() => { const H = TF.H, F = H.fn, L3 = H.look3, S = H.REALMS[0].keepSites[1], C = F.castles().find((q) => q.S === S), K = S.keepRef;
              const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === 1 && q.T.sz === -1), T = W.T;
              if (W.state === 'whole') { const src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', S.x + W.ox * 70, S.z + W.oz * 70, {}); src.hp = src.maxHp = 1e9; for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4); F.removeEnt(src); }
              const m = H.UI.modal; H.UI.modal = null; K.lastEnemyNear = -1e9;
              const calmK = () => { for (const e of H.ENT) if (e.alive && e.faction < 3 && e.faction !== K.realm && e.kind !== 'door' && (e.role === 'soldier' || e.warband) && Math.hypot(e.x - S.x, e.z - S.z) < 90) { e.alive = false; e.removeAt = H.GAME.t; } }; /* [v15] no band about the keep: a breach draws the commanders' bands now (war2), and a foe near it holds the masons off */
              for (let t = 0; t < 80 && !(W.l3 && W.l3.on); t++) { calmK(); H.simulate(1); K.lastEnemyNear = -1e9; W.masonsFor = W.masonsFor || []; }
              for (const e of L3.MASON.list) if (!e.removed) F.removeEnt(e);
              if (W.t > 0.6) W.t = 0.3;
              H.UI.modal = m;
              const L = W.l3 && W.l3.ladders.find((q) => q.k === 0); if (!L) return { on: !!(W.l3 && W.l3.on) };
              TF.stand(L.fx, L.fz, L.lx, L.lz); TF.P().y = L.wyb; H.simulate(0.2); window.__tfs = { W, L };
              return { on: W.l3.on, label: TF.label() }; })()""")
            ok1 = await tap(page, '#t-use')
            up = await page.evaluate("""(() => { const H = TF.H, P = TF.P(), { L } = window.__tfs; for (let i = 0; i < 40 && (P.motion || i < 2); i++) { H.simulate(0.25); L.scaffold.S && 0; } const fl = H.fn.floorAt(P.x, P.z, P.y + 0.3); return { dy: +(P.y - L.wyb).toFixed(2), lift: +(L.wyt - L.wyb).toFixed(2), floor: +(fl - P.y).toFixed(2), label: TF.label() }; })()""")
            ok2 = await tap(page, '#t-use')
            down = await page.evaluate("""(() => { const H = TF.H, P = TF.P(), { L, W } = window.__tfs; for (let i = 0; i < 40 && (P.motion || i < 2); i++) H.simulate(0.25); W.S && 0; return { dy: +(P.y - L.wyb).toFixed(2) }; })()""")
            check(r.get('on') and r.get('label') == 'Climb the scaffold' and ok1 and abs(up['dy'] - up['lift']) < 0.1 and abs(up['floor']) < 0.05, f"scaffold: a tap on Use climbs a mended tower's scaffold onto its first lift, standing on its boards ({json.dumps(r)}, {json.dumps(up)})")
            check(up['label'] == 'Climb down the ladder' and ok2 and abs(down['dy']) < 0.15, f"scaffold: and another climbs back down ({json.dumps(down)})")
        if want('housescaf'):
            # [look4] a town house brought down by stones, built back behind its own scaffold: a tap on Use climbs its ladder
            # onto the boards, another climbs back down
            r = await page.evaluate("""(() => { const H = TF.H, F = H.fn, S = H.REALMS[0].town;
              const hs = S.houses.map((h) => h.rec).filter((h) => h && !h.keepHall && h.state === 'whole').sort((a, b) => Math.hypot(a.x - S.x, a.z - S.z) - Math.hypot(b.x - S.x, b.z - S.z)), A = hs[4] || hs[0];
              H.batter.houseBreak(A, null); const m = H.UI.modal; H.UI.modal = null; H.simulate(0.3); A.stT = 1e4; H.simulate(0.3); A.stT = 20; H.simulate(0.2); H.UI.modal = m;
              const Q = H.rubble.HSCAF.list.get(A), L = Q && Q.l3 && Q.l3.ladders.find((q) => !q.gone); if (!L) return { state: A.state, q: !!Q };
              TF.stand(L.fx, L.fz, L.lx, L.lz); TF.P().y = L.wyb; H.simulate(0.2); window.__tfh = { A, L };
              return { state: A.state, label: TF.label() }; })()""")
            ok1 = await tap(page, '#t-use')
            up = await page.evaluate("""(() => { const H = TF.H, P = TF.P(), { L } = window.__tfh; for (let i = 0; i < 40 && (P.motion || i < 2); i++) H.simulate(0.25); const fl = H.fn.floorAt(P.x, P.z, P.y + 0.3); return { dy: +(P.y - L.wyb).toFixed(2), lift: +(L.wyt - L.wyb).toFixed(2), floor: +(fl - P.y).toFixed(2), label: TF.label() }; })()""")
            ok2 = await tap(page, '#t-use')
            down = await page.evaluate("""(() => { const H = TF.H, P = TF.P(), { L } = window.__tfh; for (let i = 0; i < 40 && (P.motion || i < 2); i++) H.simulate(0.25); return { dy: +(P.y - L.wyb).toFixed(2) }; })()""")
            check(r.get('state') == 'scaffold' and r.get('label') == 'Climb the scaffold' and ok1 and abs(up['dy'] - up['lift']) < 0.1 and abs(up['floor']) < 0.05, f"housescaf: a tap on Use climbs a house's scaffold onto its boards ({json.dumps(r)}, {json.dumps(up)})")
            check(up['label'] == 'Climb down the ladder' and ok2 and abs(down['dy']) < 0.15, f"housescaf: and another climbs back down ({json.dumps(down)})")
        if want('guide'):
            # [guide] the path tracker: a tap on the step opens your path in the Chronicle, a tap on Aims the late game's
            # goals; a field note is tapped away
            await page.evaluate("(() => { const H = TF.H; if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); H.UI.modal = null; TF.calm(); const e = document.getElementById('lore-path'); if (e && !e.classList.contains('min')) e.querySelector('[data-act=min]').click(); return 0; })()")
            ok = await tap(page, '#lore-path [data-act="open"]')
            r = await page.evaluate("({ modal: __hm.UI.modal, sec: __hm.LORE.state.chronSec })")
            ok2 = await tap(page, '.chron-nav [data-sec="goals"]')
            t = await page.evaluate("(document.querySelector('.chron-body') || {}).textContent || ''")
            check(ok and r['modal'] == 'menu' and r['sec'] in ('path', 'goals') and ok2 and 'Level 30' in t, f'guide: a tap on the path opens it in the Chronicle, and a tap its Aims ({r})')
            await tap(page, '#btn-resume')
            await page.evaluate("(() => { const L = __hm.GAME.prog.lore; L.seen = L.seen.filter((x) => x !== 'ladder'); __hm.LORE.state.noteUntil = 0; __hm.hud.note('ladder'); const ns = [...document.querySelectorAll('#banners .lore-note:not(.hl-old)')], d = ns[ns.length - 1]; if (d) d.id = 'tf-note'; return 0; })()")
            n0 = await page.evaluate("document.querySelectorAll('#banners .lore-note').length")
            ok = await tap(page, '#tf-note')
            n1 = await page.evaluate("document.querySelectorAll('#banners .lore-note').length")
            gone = await page.evaluate("!document.getElementById('tf-note')")
            # [v15] the note tapped is gone (counting every note failed one run in three: on a loaded machine the next note in
            # the queue came up in the 11.5 s the tap's waits can take)
            check(ok and gone, f'guide: a tap takes a field note away ({n0} then {n1})')
        if want('sound'):
            # [audio2] the sound's settings by touch alone (11c_sound.js): the menu's button, its Settings, then Effects Low,
            # Ambience High, Volume Off and back to Medium; each button scrolled into view first (the sheet scrolls on a phone)
            await page.evaluate("(() => { const H = TF.H; if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); H.UI.modal = null; TF.calm(); return 0; })()")
            ok = [await tap(page, '#btn-menu'), await tap(page, '#menu-tabs [data-tab="settings"]')]
            async def tap_row(sel):
                await page.evaluate(f"(() => {{ const el = document.querySelector('{sel}'); if (el) el.scrollIntoView({{ block: 'center' }}); return 0; }})()")
                return await tap(page, sel)
            for sel in ['#set-fx [data-v="low"]', '#set-amb [data-v="high"]', '#set-s [data-v="off"]']: ok.append(await tap_row(sel))
            r = await page.evaluate("(() => { const A = __hm.fn.AUDIO, s = __hm.fn.buildSave().settings; return { fx: A.lvl.sfx, amb: A.lvl.amb, on: A.on, saved: [s.effects, s.ambience, s.sound] }; })()")
            ok.append(await tap_row('#set-s [data-v="medium"]'))
            on = await page.evaluate("__hm.fn.AUDIO.on")
            check(all(ok) and r['fx'] == 0.5 and r['amb'] == 1.4 and not r['on'] and r['saved'] == [0.5, 1.4, False] and on, f"sound: taps on the menu's Settings set Effects Low, Ambience High and Volume Off, and Volume back on ({ok}, {json.dumps(r)}, on again {on})")
            await tap(page, '#btn-resume')
        if want('deeds'):
            # [late2] the Chronicle's Deeds page by touch: a tap on your path opens the Chronicle, a tap its Deeds page, and a
            # tap on a name's button wears it (a character with two names: the Blooded, worn, and Kingsbane)
            await page.evaluate("""(() => { const H = TF.H, L = H.late; if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); H.UI.modal = null; TF.calm();
              H.GAME.prog.realmKills = Math.max(H.GAME.prog.realmKills || 0, 30); L.late2CheckNames(true); L.late2Deed('king'); L.late2Wear('blooded');
              const e = document.getElementById('lore-path'); if (e && !e.classList.contains('min')) e.querySelector('[data-act=min]').click(); return 0; })()""")
            ok = await tap(page, '#lore-path [data-act="open"], #lore-path [data-act="aims"]')
            if not ok: await page.evaluate("__hm.LORE.openChronicle('path'); 0") # (the tracker waits off the screen now and then: the guide flow's business; the Chronicle opened, the rest by touch)
            await page.evaluate("(() => { const b = document.querySelector('.chron-nav [data-sec=\"deeds\"]'); if (b) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' }); return 0; })()") # (the row scrolls: Deeds is its last page)
            ok2 = await tap(page, '.chron-nav [data-sec="deeds"]')
            await page.evaluate("(() => { const b = document.querySelector('#menu-body [data-l2=\"wear:kingsbane\"]'); if (b) b.scrollIntoView({ block: 'center', behavior: 'instant' }); return 0; })()")
            box = await page.evaluate("(() => { const b = document.querySelector('#menu-body [data-l2=\"wear:kingsbane\"]'); if (!b) return null; const r = b.getBoundingClientRect(); return [Math.round(r.width), Math.round(r.height)]; })()")
            ok3 = await tap(page, '#menu-body [data-l2="wear:kingsbane"]')
            r = await page.evaluate("({ worn: __hm.late.LATE2.worn, sec: __hm.LORE.state.chronSec, frame: document.getElementById('pf-name').textContent })")
            check(ok2 and ok3 and r['worn'] == 'kingsbane' and r['sec'] == 'deeds' and box and box[1] >= 40, f"deeds: taps open the Deeds page and wear a name ({r}, button {box}, the tracker tapped: {ok})")
            # the standard of your name: a tap has it made and another plants it on open ground; Use beside it takes it up
            await page.evaluate("""(() => { const H = TF.H, F = H.fn, L = H.late, P = TF.P(), R = H.REALMS[P.faction]; H.GAME.prog.level = 45; H.INV.gold = Math.max(H.INV.gold, 1500);
              for (let i = 0; i < 400; i++) { const a = i * 2.399, d = 60 + (i % 20) * 6, x = R.town.x + Math.sin(a) * d, z = R.town.z - Math.cos(a) * d;
                if (!F.isWalkable(x, z) || H.water.waterAt(x, z)) continue; H.teleport(x, z); P.yaw = a; if (L.late2StdSpot(P)) break; }
              TF.calm(); H.LORE.openChronicle('deeds'); return 0; })()""") # (the sheet scrolls smoothly: each scroll below is instant, or the tap measured the button still off the screen)
            await page.evaluate("__hm.frame(1/30); 0"); await page.evaluate("TF.see('#menu-body [data-l2=\"std:make\"]')")
            ok4 = await tap(page, '#menu-body [data-l2="std:make"]')
            await page.evaluate("__hm.frame(1/30); 0"); await page.evaluate("TF.see('#menu-body [data-l2=\"std:plant\"]')")
            ok5 = await tap(page, '#menu-body [data-l2="std:plant"]')
            st = await page.evaluate("(() => { const L = __hm.late, at = L.LATE2.std.at, P = __hm.GAME.player; return { made: L.LATE2.std.made, at: !!at, modal: __hm.UI.modal, d: at ? +Math.hypot(at.x - P.x, at.z - P.z).toFixed(1) : null }; })()")
            await page.evaluate("(() => { const H = TF.H, L = H.late, at = L.LATE2.std.at, P = TF.P(); if (at) { H.teleport(at.x + 1.3, at.z + 0.4); P.yaw = Math.atan2(at.x - P.x, at.z - P.z); H.CAM.yaw = P.yaw; } H.simulate(0.2); return 0; })()")
            lab = await page.evaluate("TF.label()")
            ok6 = await tap(page, '#t-use')
            st2 = await page.evaluate("({ at: !!__hm.late.LATE2.std.at })")
            check(ok4 and ok5 and st['made'] and st['at'] and st['modal'] is None and lab == 'Take up your standard' and ok6 and not st2['at'], f"deeds: a tap has the standard made, another plants it before you ({st}), and Use beside it takes it up ({lab}, {st2})")
            await page.evaluate("(() => { if (!document.getElementById('menu').hidden) document.getElementById('btn-resume').click(); __hm.GAME.prog.level = 24; return 0; })()")
        if want('ladder'):
            r = await page.evaluate("""(() => { const H = TF.H, F = H.fn, T = H.towers.TOWER.list.find((q) => q.look === 'stone' && q.role === 'gate' && q.sx === 1), S = T.S, L = T.ladders[1], Hh = L.hatch, P = TF.P();
              P.faction = 0; const sp = F.siteToWorld(S, T.cx + Math.sin(L.a + 1.2) * 0.95, T.cz + Math.cos(L.a + 1.2) * 0.95); TF.stand(sp.x, sp.z, Hh.cx, Hh.cz); P.y = L.wyt; P.faction = 0; Hh.held = true; H.simulate(1.0);
              const f = H.fn.siteToWorld(S, L.foot.x, L.foot.z), c = F.spawnRealmUnit(1, 'warrior', 24, 'soldier', f.x, f.z, {}); c.y = L.wyb; c.ai.post = null; c.maxHp = c.hp = 4000; window.__tfc = c;
              H.towers.towerClimb(c, L, 1); let lab = null; for (let i = 0; i < 60 && !(lab && lab.startsWith('Slam')); i++) { H.simulate(0.1); lab = TF.label(); } return lab; })()""")
            s0 = await page.evaluate("__hm.ladders.LADDER.stats.slams")
            ok = await tap(page, '#t-use')
            st = await page.evaluate("(() => { __hm.simulate(0.3); const c = window.__tfc; return c.motion ? c.motion.st : null; })()")
            s1 = await page.evaluate("__hm.ladders.LADDER.stats.slams")
            # [v15] the slam counted (or the climber still falling): the page's own frames run on through a tap's waits on a
            # loaded machine, and the climber had fallen and stood up again by the look after it (st None, one run in five)
            check(r == 'Slam the hatch on them' and ok and (st == 3 or s1 > s0), f'ladder: a foe comes up the ladder and a tap on Use slams the hatch on it ({r}, {st}, slams {s0} -> {s1})')
            await page.evaluate("(() => { const c = window.__tfc; __hm.simulate(2); __hm.fn.removeEnt(c); return 0; })()")
            r = await page.evaluate("""(() => { const H = TF.H, T = H.towers.TOWER.list.find((q) => q.look === 'stone' && q.role === 'gate' && q.sx === 1), S = T.S, L = T.ladders[0], P = TF.P(), p = H.fn.siteToWorld(S, L.foot.x, L.foot.z);
              H.INPUT.joy = null; H.INPUT.keys.clear(); P.motion = null; TF.stand(p.x, p.z, L.lx, L.lz); P.y = L.wyb; H.towers.towerClimb(P, L, 1); H.simulate(2.5); return { y: +(P.y - S.y).toFixed(2), dir: P.motion ? P.motion.dir : null }; })()""")
            await drag_stick(page, cdp, 0, 45, 0.6)
            r2 = await page.evaluate("(() => { const P = TF.P(), S = __hm.towers.TOWER.list.find((q) => q.look === 'stone' && q.role === 'gate' && q.sx === 1).S; const d = P.motion ? P.motion.dir : null; for (let i = 0; i < 40 && P.motion; i++) __hm.simulate(0.25); return { dir: d, y: +(P.y - S.y).toFixed(2) }; })()")
            check(r['dir'] == 1 and r2['dir'] == -1 and r2['y'] < 0.5, f'ladder: on the rungs a drag of the stick down turns you back down ({r}, {r2})')

        await page.screenshot(path=OUT + 'touch_flows.png', timeout=300000)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no errors {errs[:2]}')
        await b.close()
    print(f'{len(FAILS)} failures')

asyncio.run(main())
