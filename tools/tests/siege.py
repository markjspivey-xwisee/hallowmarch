"""Sieges, end to end through window.__hm:
a warband brings each engine kind to a keep (ram, mangonel, trebuchet): it is built, its crew walk it into range and
work it; the ram damages the gate; stones fly on their arcs and hit; wall sections crack and fall into a breach; the
band storms through the breach; the garrison holds the gap and sallies out of its gate at a lightly guarded engine
(the gate opens and shuts behind them); an engine is hacked apart, another set alight and burnt; the player joins a
crew and takes over an abandoned engine. Screenshots of every engine at work, a burning engine and a breach.
usage: python3 tools/tests/siege.py [noshots] [final] [quality] [only=ram|mangonel|trebuchet|sally|destroy|player|shots]"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
ONLY = next((a.split('=')[1] for a in ARGS if a.startswith('only=')), None)
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

async def frames(page, n=1):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name, js):
    if not SHOTS: return
    await page.evaluate(js)
    await frames(page, 2)
    await page.screenshot(path=OUT + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

def on(name): return not ONLY or ONLY == name

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, S: __hm.SIEGE,
  keep(realm, k) { return __hm.WAR.keeps.find((K) => K.orig === realm && K.site === __hm.REALMS[realm].keepSites[k]); },
  w(S, lx, lz) { return this.F.siteToWorld(S, lx, lz); },
  cam(x, y, z, tx, ty, tz) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld(); },
  // a camera beside an engine, in its own frame: (lx, ly, lz) from it, looking at (tx, ty, tz) in its frame
  camE(E, lx, ly, lz, tx, ty, tz) { const c = Math.cos(E.yaw), s = Math.sin(E.yaw), P = (x, z) => [E.x + x * c + z * s, E.z - x * s + z * c]; const [ax, az] = P(lx, lz), [bx, bz] = P(tx, tz); this.cam(ax, E.y + ly, az, bx, E.y + ty, bz); },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  E(id) { return this.S.siegeById(id); },
  eng(id) { return this.S.engines().find((q) => q.id === id) || null; },
  // run until a test passes (or time runs out): returns the seconds it took
  until(fn, max, step = 0.5) { let t = 0; while (t < max && !fn()) { this.H.simulate(step); t += step; } return t; },
  quiet() {
    const H = this.H;
    for (const e of H.ENT.slice()) if (e.role === 'soldier') this.F.removeEnt(e);
    for (const w of H.WAR.warbands) w.dead = true;
    H.WAR.commanders.forEach((C) => { C.nextThink = 1e9; C.nextSpawn = 1e9; });
    for (const E of this.S.SIEGE.engines.slice()) this.S.siegeRemove(E);
    H.simulate(0.2);
  },
  // the player somewhere out of the way (their presence keeps gates and garrisons honest)
  away() { const P = this.H.GAME.player, S = this.H.REALMS[P.faction].town; P.x = P.prevX = S.x + 3; P.z = P.prevZ = S.z + 3; P.y = this.F.heightAt(P.x, P.z); P.hp = P.maxHp; },
  sec(K, k) { return this.F.castleOf(K.site).sections[k]; },
};
"""

async def main():
    async with async_playwright() as p:
        w, h = (960, 540) if 'final' in ARGS else (640, 360)
        print('booting', flush=True)
        b, page, logs = await setup(p, w=w, h=h)
        page.set_default_timeout(600000)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await page.evaluate("() => {" + HELPERS + "; return 0; }")
        await ev(page, 'start', "(() => { __hm.start({ realm: 0, cls: 'mage', level: 30 }); __hm.UI.modal = null; __hm.setTod(0.55); __hm.simulate(0.5); T.quiet(); T.away(); return { errors: __hm.errors.length, keeps: __hm.WAR.keeps.length }; })()")

        # ---- 1. a battering ram: built, pushed to the gate, swung into it ----
        if on('ram'):
            r = await ev(page, 'ram: band', "(() => { T.quiet(); T.S.SIEGE.force = 'ram'; const K = T.keep(0, 0); const id = T.S.band(1, K.id, 95, 10); T.ram = id; const t = T.until(() => T.S.wb(id).siegeE, 40); const wb = T.S.wb(id); T.ramE = wb.siegeE; return { t, wb, eng: T.eng(wb.siegeE) }; })()")
            check(r['eng'] and r['eng']['kind'] == 'ram' and r['eng']['crew'] >= 3, 'a warband marching on a keep builds a battering ram, with a crew')
            r = await ev(page, 'ram: built and pushed', "(() => { const id = T.ramE; const t1 = T.until(() => T.eng(id).state !== 'build', 40); const a = T.eng(id); const t2 = T.until(() => T.eng(id).state === 'work', 60); return { t1, t2, a, b: T.eng(id), d: (() => { const E = T.E(id), K = T.keep(0, 0), g = T.S.siegeGatePoint(K.site); return +Math.hypot(E.x - g.x, E.z - g.z).toFixed(2); })() }; })()")
            check(r['a']['state'] == 'move' and r['b']['state'] == 'work' and abs(r['d'] - 3.98) < 0.3, 'its crew push it up to the gate on its wheels')
            if SHOTS:
                await shot(page, 'siege_ram_push', "(() => { const E = T.E(T.ramE); T.camE(E, 9, 4.5, 9, 0, 1.5, 1); })()")
            r = await ev(page, 'ram: hits', "(() => { const K = T.keep(0, 0), D = K.door, hp0 = D.hp, h0 = T.S.stats().ramHits; const psi = []; for (let i = 0; i < 24; i++) { __hm.simulate(0.25); psi.push(T.E(T.ramE).psi.toFixed(2)); } return { hp0: Math.round(hp0), hp: Math.round(D.hp), hits: T.S.stats().ramHits - h0, psi: psi.join(' ') }; })()")
            check(r['hits'] >= 1 and r['hp'] < r['hp0'], f"the ram swings on its slings and batters the gate ({r['hits']} blows, gate {r['hp0']} -> {r['hp']})")
            if SHOTS:
                await shot(page, 'siege_ram_gate', "(() => { const E = T.E(T.ramE); T.until(() => E.ph === 'swing' && E.psi > 0.05, 6, 0.05); T.camE(E, 7.5, 3.4, 1.2, 0, 1.4, 3.5); })()")
            r = await ev(page, 'ram: gate breaks', "(() => { const K = T.keep(0, 0); const t = T.until(() => !K.door.alive, 240); const wb = T.S.wb(T.ram); return { t, alive: K.door.alive, wb, eng: T.eng(T.ramE) }; })()")
            check(not r['alive'], f"the gate breaks under the ram and the band ({r['t']:.0f} s)")
            check(r['wb'] is None or r['wb']['phase'] in ('assault', 'hold') or r['wb']['dead'], 'and the band storms the court')

        # ---- 2. a mangonel: built back from the wall, rolled up, wound, thrown; the section cracks and falls ----
        for kind, keep in (('mangonel', (0, 1)), ('trebuchet', (1, 0))):
            if not on(kind): continue
            r = await ev(page, f'{kind}: band', f"(() => {{ T.quiet(); T.S.SIEGE.force = '{kind}'; const K = T.keep({keep[0]}, {keep[1]}); const id = T.S.band(({keep[0]} + 1) % 3, K.id, 95, 10); T.cat = id; const t = T.until(() => T.S.wb(id).siegeE, 40); const wb = T.S.wb(id); T.catE = wb.siegeE; return {{ t, wb, eng: T.eng(wb.siegeE) }}; }})()")
            check(r['eng'] and r['eng']['kind'] == kind and r['eng']['target'] and r['eng']['target']['W'] is not None, f'a warband builds a {kind} to breach a wall section')
            r = await ev(page, f'{kind}: built', f"(() => {{ const id = T.catE; const t1 = T.until(() => T.eng(id).state !== 'build', 60); const a = T.eng(id); const t2 = T.until(() => T.eng(id).state === 'work', 60); const E = T.E(id), W = E.target.W, f = T.S.siegeFace(W); return {{ t1, t2, a, b: T.eng(id), range: +Math.hypot(E.x - f.x, E.z - f.z).toFixed(1), wb: T.S.wb(T.cat) }}; }})()")
            check(r['b']['state'] == 'work', f"the {kind} is raised and set up {r['range']} m from the wall")
            check(r['wb'] and r['wb']['phase'] == 'bombard', 'the band stands guard by its engine')
            r = await ev(page, f'{kind}: shots', f"(() => {{ const id = T.catE, E = T.E(id), W = E.target.W; const s0 = T.S.stats(); const arms = []; let flying = 0; for (let i = 0; i < 160; i++) {{ __hm.simulate(0.25); if (i % 8 === 0) arms.push(E.arm.toFixed(2)); flying = Math.max(flying, T.S.SIEGE.stones.length); }} const s = T.S.stats(); return {{ shots: s.shots - s0.shots, hits: s.wallHits - s0.wallHits, flying, wear: +W.wear.toFixed(2), state: W.state, arms: arms.join(' ') }}; }})()")
            check(r['shots'] >= 2 and r['flying'] >= 1, f"the {kind} throws stones that fly on their arcs ({r['shots']} in 40 s)")
            check(r['hits'] >= 1 and (r['wear'] > 0 or r['state'] != 'whole'), f"stones strike the wall section and crack it (wear {r['wear']})")
            if SHOTS:
                if kind == 'mangonel':
                    await shot(page, 'siege_mangonel_wind', f"(() => {{ const E = T.E(T.catE); T.until(() => E.ph === 'load', 20, 0.1); T.camE(E, 6.5, 3.2, -6, 0, 1.4, 0); }})()")
                    await shot(page, 'siege_mangonel_throw', f"(() => {{ const E = T.E(T.catE); T.until(() => E.ph === 'throw', 20, 0.05); T.until(() => !E.loaded, 2, 0.02); __hm.simulate(0.04); T.camE(E, 7, 3.5, 3, 0, 2.4, 4); }})()")
                else:
                    await shot(page, 'siege_trebuchet_cocked', f"(() => {{ const E = T.E(T.catE); T.until(() => E.ph === 'load' && E.loaded, 30, 0.1); T.camE(E, 13, 5, -4, 0, 2.6, -0.5); }})()")
                    await shot(page, 'siege_trebuchet_throw', f"(() => {{ const E = T.E(T.catE); T.until(() => E.ph === 'throw', 10, 0.05); __hm.simulate(0.45, 0.025); T.camE(E, 14, 5.5, 2, 0, 4, 0); }})()")
                    await shot(page, 'siege_trebuchet_stone', f"(() => {{ const E = T.E(T.catE), W = E.target.W, f = T.S.siegeFace(W); T.until(() => T.S.SIEGE.stones.length > 0, 25, 0.05); __hm.simulate(0.9, 0.05); const mx = (E.x + f.x) / 2, mz = (E.z + f.z) / 2; const nx = (f.x - E.x), nz = (f.z - E.z), d = Math.hypot(nx, nz); T.cam(mx - nz / d * 38, E.y + 14, mz + nx / d * 38, mx, E.y + 8, mz); }})()")
            r = await ev(page, f'{kind}: breach', f"(() => {{ const E = T.E(T.catE), W = E.target.W; const t = T.until(() => W.state === 'breach', 420, 1); return {{ t, state: W.state, wear: +W.wear.toFixed(2), stats: T.S.stats(), wb: T.S.wb(T.cat) }}; }})()")
            check(r['state'] == 'breach', f"the section falls into a breach ({r['t']:.0f} s more)")
            if SHOTS and kind == 'mangonel':
                await shot(page, 'siege_breach', f"(() => {{ const E = T.E(T.catE), W = T.keep({keep[0]}, {keep[1]}) && T.F.castleOf(T.keep({keep[0]}, {keep[1]}).site).sections.find((q) => q.state === 'breach'), f = T.S.siegeFace(W); T.cam(W.wx + f.nx * 16 + W.wax * 8, W.C.S.y + 7, W.wz + f.nz * 16 + W.waz * 8, W.wx, W.C.S.y + 2.5, W.wz); }})()")
            r = await ev(page, f'{kind}: through the breach', f"(() => {{ const K = T.keep({keep[0]}, {keep[1]}), C = T.F.castleOf(K.site); let inside = 0, phases = new Set(); const t = T.until(() => {{ const wb = T.H.WAR.warbands.find((w) => w.id === T.cat); if (!wb || wb.dead) return true; if (wb.order) phases.add(wb.order.phase); inside = T.F.wbMembers(wb).filter((e) => {{ const dx = e.x - K.site.x, dz = e.z - K.site.z, c = Math.cos(K.site.yaw), s = Math.sin(K.site.yaw); const lx = dx * c - dz * s, lz = dx * s + dz * c; return Math.abs(lx) < 13.5 && Math.abs(lz) < 13.5; }}).length; return inside >= 2 || K.realm !== {keep[0]}; }}, 120, 0.5); return {{ t, inside, phases: [...phases], door: K.door.alive, realm: K.realm, plug: __hm.SIEGE.stats().plugs }}; }})()")
            check('breach' in r['phases'], 'the commander sends the band through the breach')
            check(r['inside'] >= 2 or r['realm'] != keep[0], f"attackers climb the rubble into the court ({r['inside']} inside, gate standing: {r['door']})")
            check(r['plug'] >= 1, 'the garrison runs to hold the breach')
            if SHOTS and kind == 'trebuchet':
                await shot(page, 'siege_breach_storm', f"(() => {{ const W = T.F.castleOf(T.keep({keep[0]}, {keep[1]}).site).sections.find((q) => q.state === 'breach'), f = T.S.siegeFace(W); T.cam(W.wx + f.nx * 14 - W.wax * 9, W.C.S.y + 8, W.wz + f.nz * 14 - W.waz * 9, W.wx, W.C.S.y + 1.5, W.wz); }})()")

        # ---- 3. a sally: the garrison opens its own gate at a lightly guarded engine, and shuts it behind them ----
        if on('sally'):
            r = await ev(page, 'sally', "(() => { T.quiet(); T.S.SIEGE.force = 'mangonel'; const K = T.keep(2, 1), C = T.F.castleOf(K.site), G0 = C.gate; __hm.fn.fillGarrison(K, true); const g = T.S.siegeGatePoint(K.site); const E = T.S.siegeCreate('mangonel', 0, g.x + g.nx * 40, g.z + g.nz * 40, Math.atan2(-g.nx, -g.nz), { C, gate: true }, { x: g.x + g.nx * 40, z: g.z + g.nz * 40 }); E.build = 1; E.state = 'work'; const crew = T.F.spawnRealmUnit(0, 'warrior', 20, 'guard', E.x + 2, E.z + 2); crew.ai.post = { x: crew.x, z: crew.z, leash: 6 }; T.sallyE = E.id; let opened = 0, out = 0, foes = 0; const t = T.until(() => { if (G0.open > 0.9) opened++; const party = [...K.guards].map(T.F.getEnt).filter((q) => q && q.ai.sally); out = Math.max(out, party.filter((q) => !__hm.fn.castleOf(K.site) || Math.hypot(q.x - g.x, q.z - g.z) > 9).length); return !E.ent.alive; }, 90, 0.25); const shut = T.until(() => G0.open < 0.05 && ![...K.guards].map(T.F.getEnt).some((q) => q && q.ai.sally), 60, 0.5); return { t, shut, opened, out, engine: E.ent.alive, gate: +G0.open.toFixed(2), sallies: T.S.stats().sallies, crewAlive: crew.alive }; })()")
            check(r['sallies'] >= 1 and r['opened'] > 0, 'the garrison sallies: its gate opens for it with a foe outside')
            check(r['out'] >= 2, f"the sally party goes out through the gate ({r['out']} out)")
            check(not r['engine'], f"and hacks the enemy engine apart ({r['t']:.0f} s)")
            check(r['gate'] < 0.05, 'then comes home, and the gate shuts behind it')

        # ---- 4. engines destroyed: hacked apart in melee, set alight by fire ----
        if on('destroy'):
            r = await ev(page, 'destroy: melee', "(() => { T.quiet(); const K = T.keep(1, 0), C = T.F.castleOf(K.site), g = T.S.siegeGatePoint(K.site); const E = T.S.siegeCreate('trebuchet', 2, g.x + g.nx * 60, g.z + g.nz * 60, Math.atan2(-g.nx, -g.nz), { C, gate: true }); E.build = 1; E.state = 'idle'; const foes = [0, 1, 2].map((i) => { const f = T.F.spawnRealmUnit(1, 'warrior', 30, 'guard', E.x + 4 + i, E.z + 4); f.ai.post = { x: E.x, z: E.z, leash: 12 }; return f; }); let t = 0; while (t < 90 && E.ent.alive) { for (const f of foes) if (f.alive) { f.target = E.ent.id; const d = Math.hypot(E.x - f.x, E.z - f.z); if (d > 3.5) T.F.stepTo(f, f.x + (E.x - f.x) / d * 0.3, f.z + (E.z - f.z) / d * 0.3); } __hm.simulate(0.1); t += 0.1; } for (const f of foes) T.F.removeEnt(f); return { t: +t.toFixed(1), alive: E.ent.alive, state: E.state }; })()")
            check(not r['alive'] and r['state'] == 'wreck', f"a trebuchet is hacked apart in melee and falls to a wreck ({r['t']} s)")
            r = await ev(page, 'destroy: fire', "(() => { const K = T.keep(1, 1), C = T.F.castleOf(K.site), g = T.S.siegeGatePoint(K.site); const E = T.S.siegeCreate('mangonel', 2, g.x + g.nx * 50, g.z + g.nz * 50, Math.atan2(-g.nx, -g.nz), { C, gate: true }); E.build = 1; E.state = 'idle'; T.burnE = E.id; T.F.fireLandsAt(E.x, E.y + 1, E.z, 3); const a = { state: E.state, burn: E.burn }; __hm.simulate(10); const b = { state: E.state, burn: +E.burn.toFixed(2), char: +E.mat.uniforms.uChar.value.toFixed(2), hp: Math.round(E.ent.hp) }; return { a, b }; })()")
            check(r['a']['state'] == 'burning', 'a fire spell landing on a mangonel sets it alight')
            check(r['b']['char'] > 0.3, f"the fire chars its timbers as it burns (char {r['b']['char']})")
            if SHOTS:
                await shot(page, 'siege_burning', "(() => { const E = T.E(T.burnE); __hm.setTod(1.75); T.camE(E, 7, 3.5, 5, 0, 1.4, 0); })()")
            r = await ev(page, 'destroy: burnt', "(() => { const E = T.E(T.burnE); const t = T.until(() => E.state === 'wreck', 60, 0.5); __hm.simulate(3); return { t, state: E.state, alive: E.ent.alive, burnt: T.S.stats().burnt }; })()")
            check(r['state'] == 'wreck' and not r['alive'] and r['burnt'] >= 1, 'it burns down and falls in')
            if SHOTS:
                await shot(page, 'siege_burnt', "(() => { const E = T.E(T.burnE); T.camE(E, 6, 3, 5, 0, 0.8, 0); })()")
            await page.evaluate("__hm.setTod(0.55)")

        # ---- 5. the player joins a crew, and takes over an abandoned engine ----
        if on('player'):
            r = await ev(page, 'player: join', "(() => { T.quiet(); const K = T.keep(1, 1), C = T.F.castleOf(K.site), W = C.sections[0], f = T.S.siegeFace(W); const x = f.x + f.nx * 44, z = f.z + f.nz * 44; const E = T.S.siegeCreate('mangonel', 0, x, z, Math.atan2(-f.nx, -f.nz), { C, W }); E.build = 1; E.state = 'work'; E.ph = 'wind'; T.pE = E.id; const P = __hm.GAME.player; P.x = P.prevX = E.x + 2.5; P.z = P.prevZ = E.z + 0.5; P.y = T.F.heightAt(P.x, P.z); __hm.UI.modal = null; const label = T.S.interaction(); __hm.fn.playerInteract(); const j = E.player; const s0 = E.shots; T.until(() => E.shots > s0, 40, 0.25); return { label, joined: j, shots: E.shots - s0, crew: E.crew.length, state: E.state }; })()")
            check(r['joined'] and r['shots'] >= 1, f"the player joins the crew of an engine alone and works it ({r['label']}; {r['shots']} shots)")
            r = await ev(page, 'player: leave', "(() => { const E = T.E(T.pE), P = __hm.GAME.player; __hm.INPUT.keys.add('KeyW'); __hm.CAM.yaw = E.yaw + Math.PI / 2; __hm.simulate(1.0); __hm.INPUT.keys.delete('KeyW'); __hm.simulate(0.2); return { player: E.player, d: +Math.hypot(P.x - E.x, P.z - E.z).toFixed(1) }; })()")
            check(not r['player'], 'walking away leaves the crew')
            r = await ev(page, 'player: take over', "(() => { const K = T.keep(0, 1), C = T.F.castleOf(K.site), W = C.sections[1], f = T.S.siegeFace(W); const x = f.x + f.nx * 44, z = f.z + f.nz * 44; const E = T.S.siegeCreate('mangonel', 2, x, z, Math.atan2(-f.nx, -f.nz), { C: T.F.castleOf(T.keep(1, 0).site), gate: true }); E.build = 1; E.state = 'idle'; const P = __hm.GAME.player; P.faction = 1; P.x = P.prevX = E.x + 2.5; P.z = P.prevZ = E.z; P.y = T.F.heightAt(P.x, P.z); const it = { label: T.S.interaction() }; __hm.fn.playerInteract(); const s0 = E.shots; T.until(() => E.shots > s0, 40, 0.25); const r = { label: it ? it.label : null, realm: E.realm, target: E.target ? E.target.C.S.name : null, state: E.state, shots: E.shots - s0 }; P.faction = 0; return r; })()")
            check(r['realm'] == 1 and r['shots'] >= 1, f"the player takes over an abandoned enemy engine and turns it on the enemy ({r['label']}, at {r['target']})")
            if SHOTS:
                await shot(page, 'siege_player_crew', "(() => { const E = T.E(T.pE), P = __hm.GAME.player; P.faction = 0; T.S.siegeJoin(E); T.until(() => E.ph === 'wind' && E.arm < 1.2, 12, 0.1); T.camE(E, 5, 2.8, -6.5, 0.5, 1.3, -1.5); })()")

        r = await ev(page, 'errors', "__hm.errors.slice(0, 5)")
        check(len(r) == 0, '__hm.errors is empty')
        print('logs', logs[:5])
        await b.close()
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'[{time.time() - T0:.0f}s]')

asyncio.run(main())
