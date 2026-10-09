"""Weather on everything and gear that wears, end to end through window.__hm:
rain soaks the town, the keeps and the people (and not the people under a roof); snow settles on roofs, trees and
shoulders in the north; a storm's lightning strikes a tree and a roof near the player (bolt, scorch, fire, damage and
a stun); the sun dries things faster than an overcast night; fighting wears gear down and spatters it with blood,
roads muddy it, broken gear gives no stats, a merchant mends it, and a lake or a town well washes it clean; wear is
saved with the items. Screenshots: a wet town, a wet keep, wet people, snow on roofs and trees, snowy people, a strike,
the fire after, muddy and bloodied gear, the kit and the merchant's repair row.
usage: python3 tools/tests/weather.py [noshots] [small] [quality]   (quality: high, medium or low; default medium)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
QUALITY = next((a for a in ARGS if a in ('high', 'medium', 'low')), 'medium')
SMALL = 'small' in ARGS  # 640x360 for quick functional runs; screenshots want the default 960x540
SKIP = set(next((a[5:].split(',') for a in ARGS if a.startswith('skip=')), []))  # shots to leave out, e.g. skip=rain_town,rain_keep
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1200], flush=True)
    return r

async def frames(page, n=1):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def shot(page, name, js='0'):
    if not SHOTS or name in SKIP: return
    await page.evaluate(js)
    await frames(page, 2)
    await page.screenshot(path=OUT + 'weather_' + name + '.png', timeout=300000)
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

HELPERS = r"""
window.T = {
  H: __hm, F: __hm.fn, W: __hm.dbg.WEATHER,
  // force a kind of weather and let the sky and the surfaces settle into it
  weather(kind, sec) {
    const W = this.W;
    W.mode = 'auto'; W.kind = kind; W.next = 1e9;
    return this.F.weatherAdvance(sec);
  },
  // a fixed camera at (x, y, z) looking at (tx, ty, tz)
  cam(x, y, z, tx, ty, tz) {
    const H = this.H;
    H.UI.modal = 'menu'; H.CAM.mode = 'fixed';
    document.getElementById('hud').style.visibility = 'hidden'; // a clean view of the world
    H.camera.position.set(x, y, z); H.camera.lookAt(tx, ty, tz); H.camera.updateMatrixWorld();
  },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; document.getElementById('hud').style.visibility = ''; },
  // move the player and bring the camera along (the sky follows the camera)
  go(x, z) { const H = this.H; H.teleport(x, z); const P = H.GAME.player; H.camera.position.set(P.x, P.y + 5, P.z + 7); H.camera.updateMatrixWorld(); return P; },
  P() { return this.H.GAME.player; },
  // the nearest standing house to (x, z)
  house(x, z) { let b = null, bd = 1e9; for (const h of this.H.HOUSES) { const d = (h.x - x) ** 2 + (h.z - z) ** 2; if (h.state === 'whole' && d < bd) { bd = d; b = h; } } return b; },
  // the nearest tree to (x, z) at least rmin away
  tree(x, z, rmin = 0) { const T = this.F.W.trees; let b = -1, bd = 1e9; for (let i = 0; i < T.length; i++) { const d = (T[i].x - x) ** 2 + (T[i].z - z) ** 2; if (d >= rmin * rmin && d < bd) { bd = d; b = i; } } return b; },
  // some townsfolk and soldiers to look at, placed around a point
  crowd(x, z, n = 4) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const a = i / n * 6.283, e = this.F.spawnRealmUnit(0, ['warrior', 'archer', 'mage', 'priest'][i % 4], 20, 'guard', x + Math.cos(a) * 2.2, z + Math.sin(a) * 2.2);
      e.ai.post = { x: e.x, z: e.z, yaw: a + 3.14 }; e.yaw = a + 3.14;
      out.push(e);
    }
    return out;
  },
};
0;
"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360) if SMALL else await setup(p, w=960, h=540)
        print(f'ready [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate(HELPERS)
        await page.evaluate(f"__hm.fn.setQuality('{QUALITY}')")
        await ev(page, 'start', "__hm.start({realm:0, cls:'warrior', level:20}), __hm.setTod(0.45), __hm.UI.modal = null, Object.keys(__hm.INV.eq)")
        town = await ev(page, 'town', "(() => { const S = __hm.REALMS[0].town; return { x: S.x, z: S.z, y: S.y, yaw: S.yaw, props: (S.props || []).length, wells: __hm.fn.wellSpots().length }; })()")
        check(town['wells'] >= 1, 'towns have wells or troughs to wash at')

        # ---------------- rain ----------------
        H = await ev(page, 'house', "(() => { const S = __hm.REALMS[0].town, h = T.house(S.x, S.z); T.go(h.x + 9, h.z + 9); return { x: h.x, z: h.z, y: h.y, top: h.top, w: h.w || h.Rr, yaw: Math.atan2(h.s, h.c) }; })()")
        await ev(page, 'rain', "T.weather('rain', 70)")
        # a guard out in the rain, one inside a house
        r = await ev(page, 'soak', f"""(() => {{
          const P = T.go({H['x']} + 9, {H['z']} + 9);
          const out = T.crowd(P.x + 3, P.z + 3, 4);
          const inside = __hm.fn.spawnRealmUnit(0, 'archer', 20, 'guard', {H['x']}, {H['z']}); inside.ai.post = {{ x: inside.x, z: inside.z, yaw: 0 }};
          window.__crowd = out; window.__inside = inside;
          __hm.simulate(30);
          return {{ wet: __hm.dbg.WEATHER.wet, player: P.wet, out: out.map((e) => +(e.wet || 0).toFixed(2)), inside: +(inside.wet || 0).toFixed(2), sky: __hm.fn.skyOver(inside), errors: __hm.errors.length }};
        }})()""")
        check(r['wet'] > 0.7, 'the world is wet after a minute of rain')
        check(r['player'] > 0.6 and min(r['out']) > 0.6, 'people out in the rain are soaked')
        check(r['inside'] < 0.05 and r['sky'] == 0, 'someone under a roof stays dry')
        await shot(page, 'rain_town', f"T.cam({H['x']} + 14, {H['y']} + 5.5, {H['z']} + 12, {H['x']}, {H['y']} + 2.5, {H['z']})")
        K = await ev(page, 'keep', "(() => { const S = __hm.WAR.keeps[0].site; return { x: S.x, z: S.z, y: S.y, yaw: S.yaw }; })()")
        await shot(page, 'rain_keep', f"(() => {{ const S = {json.dumps(K)}; const fx = Math.sin(S.yaw), fz = Math.cos(S.yaw); T.cam(S.x + fx * 34 + fz * 14, S.y + 9, S.z + fz * 34 - fx * 14, S.x, S.y + 6, S.z); }})()")
        await shot(page, 'rain_people', "(() => { const P = T.P(); T.cam(P.x + 6.5, P.y + 2.4, P.z + 6.0, P.x + 2.5, P.y + 1.1, P.z + 2.5); })()")

        # ---------------- drying: sun against an overcast night ----------------
        r = await ev(page, 'dry', """(() => {
          const W = T.W, F = T.F, P = T.P();
          W.kind = 'clear'; W.next = 1e9;
          __hm.setTod(2.1); F.applyTimeOfDay(2.1); W.overcast = 1; W.raining = 0; W.storm = 0; W.wet = 1;
          for (let i = 0; i < 60; i++) { F.applyTimeOfDay(2.1); W.overcast = 1; W.raining = 0; F.weatherAdvance(0.5); }
          const night = 1 - W.wet;
          __hm.setTod(0.45); W.overcast = 0; W.wet = 1;
          for (let i = 0; i < 60; i++) { F.applyTimeOfDay(0.45); W.overcast = 0; W.raining = 0; F.weatherAdvance(0.5); }
          const day = 1 - W.wet;
          P.wet = 1; __hm.simulate(20);
          return { night: +night.toFixed(3), day: +day.toFixed(3), playerAfter20s: +P.wet.toFixed(2) };
        })()""")
        check(r['day'] > r['night'] * 1.8, 'surfaces dry much faster in sunshine than on an overcast night')
        check(r['playerAfter20s'] < 0.95, 'a soaked body dries in the sun')

        # ---------------- snow in the north ----------------
        S2 = await ev(page, 'north', "(() => { const S = __hm.REALMS[2].town; const h = T.house(S.x, S.z); const P = T.go(h.x + 8, h.z + 8); window.__crowd2 = T.crowd(P.x + 2.5, P.z + 2.5, 4); return { x: h.x, z: h.z, y: h.y, px: P.x, pz: P.z, py: P.y }; })()")
        r = await ev(page, 'snow', "(() => { __hm.setTod(0.45); const w = T.weather('rain', 100); __hm.simulate(40); return { ...w, player: +T.P().snow.toFixed(2), crowd: __crowd2.map((e) => +(e.snow || 0).toFixed(2)) }; })()")
        check(r['snowing'] > 0.5 and r['snow'] > 0.6, 'precipitation falls as snow in the north and settles')
        check(r['player'] > 0.4, 'snow settles on a body standing out in it')
        await shot(page, 'snow_roofs', f"T.cam({S2['x']} + 15, {S2['y']} + 7, {S2['z']} + 13, {S2['x']}, {S2['y']} + 2.5, {S2['z']})")
        tr = await ev(page, 'snowtree', f"(() => {{ const i = T.tree({S2['px']}, {S2['pz']}, 6); const t = __hm.fn.W.trees[i]; return {{ i, x: t.x, z: t.z, y: t.y, s: t.s, kind: t.kind }}; }})()")
        await shot(page, 'snow_tree', f"T.cam({tr['x']} + 9, {tr['y']} + 5, {tr['z']} + 9, {tr['x']}, {tr['y']} + 4.5, {tr['z']})")
        await shot(page, 'snow_people', f"T.cam({S2['px']} + 6, {S2['py']} + 2.6, {S2['pz']} + 5.5, {S2['px']} + 2.2, {S2['py']} + 1.1, {S2['pz']} + 2.2)")
        r = await ev(page, 'melt', "(() => { const P = T.P(); const W = T.W; W.kind = 'clear'; T.F.weatherAdvance(30); const before = P.snow; __hm.simulate(30); return { before: +before.toFixed(2), after: +P.snow.toFixed(2), world: +W.snow.toFixed(2) }; })()")
        check(r['after'] < r['before'], 'snow melts off a body in the sun')

        # ---------------- storm: lightning on a tree and on a roof ----------------
        r = await ev(page, 'storm', f"""(() => {{
          const S = __hm.REALMS[0].town, h = T.house(S.x, S.z);
          T.go(h.x + 10, h.z + 10);
          T.weather('storm', 40);
          const P = T.P(), F = T.F;
          const i = T.tree(P.x, P.z, 10), t = F.W.trees[i];
          const fires0 = __hm.dbg.FIRES.length;
          // put a soldier right under the tree
          const vic = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', t.x + 1.2, t.z + 0.6); vic.ai.post = {{ x: vic.x, z: vic.z, yaw: 0 }};
          __hm.simulate(0.05);
          const hp0 = vic.hp;
          const a = F.strikeAt({{ kind: 'tree', i, x: t.x, z: t.z, y: t.y + 8 * t.s, gy: t.y, w: 1 }});
          const stunned = F.hasBuff(vic, 'stun');
          const b = F.strikeAt({{ kind: 'house', H: h, x: h.x, z: h.z, y: h.y + h.top, gy: h.y, w: 1 }});
          // and one picked the way the storm picks them
          const c = F.strikeNear(P.x, P.z);
          window.__strike = {{ i, tx: t.x, tz: t.z, ty: t.y, ts: t.s, hx: h.x, hz: h.z, hy: h.y }};
          return {{ tree: a, house: b, near: c, houseState: h.state, fires: __hm.dbg.FIRES.length - fires0, victimHurt: vic.hp < hp0, stunned, bolts: __hm.dbg.WEATHER.bolts.length }};
        }})()""")
        check(r['tree']['lit'], 'a struck tree catches fire')
        check(r['houseState'] == 'burning', 'a struck roof catches fire')
        check(r['victimHurt'] and r['stunned'], 'someone under the struck tree is hurt and stunned')
        check(r['bolts'] >= 2, 'the bolts are drawn')
        await shot(page, 'storm_strike', """(() => { const s = __strike, F = T.F, P = T.P();
          F.strikeAt({ kind: 'tree', i: s.i, x: s.tx, z: s.tz, y: s.ty + 8 * s.ts, gy: s.ty, w: 1 });
          // hold the bolt on screen while the slow software renderer draws the shot
          const W = __hm.dbg.WEATHER; W.bolts[W.bolts.length - 1].t = -4; W.flash = 1;
          // look at the struck tree from the open ground where the player stands
          const dx = P.x - s.tx, dz = P.z - s.tz, d = Math.hypot(dx, dz) || 1;
          T.cam(s.tx + dx / d * 20, s.ty + 7, s.tz + dz / d * 20, s.tx, s.ty + 6, s.tz); })()""")
        await ev(page, 'burn', "__hm.simulate(6), T.W.bolts.length")
        await shot(page, 'storm_fire', "(() => { const s = __strike; T.cam(s.hx + 16, s.hy + 7, s.hz + 15, s.hx, s.hy + 3, s.hz); })()")
        await ev(page, 'calm', "T.weather('clear', 5), __hm.simulate(2), 0")

        # ---------------- gear: wear, blood, mud, breaking, mending, washing ----------------
        r = await ev(page, 'fight', """(() => {
          T.play();
          const P = T.P(), F = T.F, INV = __hm.INV;
          const S = __hm.REALMS[0].town; T.go(S.x + 20, S.z + 6);
          const foe = F.spawnRealmUnit(1, 'warrior', 20, 'soldier', P.x + 1.5, P.z);
          foe.maxHp = foe.hp = 1e9;
          const d0 = Object.fromEntries(Object.entries(INV.eq).map(([s, it]) => [s, F.itemDur(it)]));
          for (let i = 0; i < 120; i++) { F.dealDamage(P, foe, 10, { kind: 'melee' }); F.dealDamage(foe, P, P.maxHp * 0.01, { kind: 'melee' }); P.hp = P.maxHp; }
          const d1 = Object.fromEntries(Object.entries(INV.eq).map(([s, it]) => [s, +F.itemDur(it).toFixed(1)]));
          foe.hp = 0; F.killEnt(foe, P);
          return { d0, d1, weaponBlood: INV.eq.weapon.blood || 0, chestBlood: (INV.eq.chest && INV.eq.chest.blood) || 0 };
        })()""")
        check(r['d1']['weapon'] < r['d0']['weapon'] and any(r['d1'][s] < r['d0'][s] for s in r['d1'] if s != 'weapon'), 'fighting wears the weapon and the armour down')
        check(r['weaponBlood'] > 0.3, 'melee spatters the weapon with blood')
        r = await ev(page, 'mud', """(() => {
          const P = T.P(), F = T.F, INV = __hm.INV;
          T.W.wet = 1;
          // walk the road out of town
          const S = __hm.REALMS[0].town;
          let best = null;
          for (let a = 0; a < 6.283; a += 0.05) for (let r = 8; r < 60; r += 2) { const x = S.x + Math.cos(a) * r, z = S.z + Math.sin(a) * r; const k = F.sampleGrid(F.W.road, x, z); if (k > 0.8 && F.isWalkable(x, z) && (!best || k > best.k)) best = { x, z, k, a }; }
          T.go(best.x, best.z); T.W.kind = 'clear'; T.W.snowing = 0; T.W.raining = 0; P.snow = 0; T.W.wet = 1;
          const d0 = (INV.eq.legs && INV.eq.legs.dirt) || P.dirt || 0;
          __hm.INPUT.keys.add('KeyW');
          for (let i = 0; i < 12; i++) { P.yaw = __hm.CAM.yaw = best.a + (i % 2 ? 3.14 : 0); __hm.simulate(2.5); }
          __hm.INPUT.keys.delete('KeyW');
          const d1 = (INV.eq.legs && INV.eq.legs.dirt) || P.dirt || 0;
          return { road: best.k, d0, d1: +d1.toFixed(3), vis: F.wearVisual(P, [0, 0, 0, 0]).map((v) => +v.toFixed(2)) };
        })()""")
        check(r['d1'] > r['d0'] + 0.03, 'walking a wet road muddies boots and hems')
        await shot(page, 'gear_worn', "(() => { const P = T.P(), INV = __hm.INV; for (const s of ['chest', 'head', 'legs']) if (INV.eq[s]) INV.eq[s].dur = 22; INV.eq.weapon.blood = 0.9; if (INV.eq.chest) INV.eq.chest.blood = 0.7; if (INV.eq.legs) INV.eq.legs.dirt = 0.8; P.dirt = 0.8; P.wet = 0; P.yaw = 0.6; T.F.applyGear(); T.cam(P.x + Math.sin(0.6) * 3.2 + 0.6, P.y + 1.6, P.z + Math.cos(0.6) * 3.2, P.x, P.y + 1.0, P.z); })()")
        r = await ev(page, 'break', """(() => {
          const P = T.P(), F = T.F, INV = __hm.INV;
          F.applyGear(); const hp0 = P.maxHp, arm0 = F.gearTotals(INV.eq).arm;
          F.wearItem(INV.eq.chest, 500);
          const hp1 = P.maxHp, arm1 = F.gearTotals(INV.eq).arm;
          T.F.updateWear(0.6);
          const warn = document.getElementById('pf-gear');
          return { hp0, hp1, arm0, arm1, broken: F.itemDur(INV.eq.chest) === 0, warn: warn && !warn.hidden ? warn.textContent : null };
        })()""")
        check(r['broken'] and r['arm1'] < r['arm0'] and r['hp1'] < r['hp0'], 'broken gear stops granting its stats')
        check(bool(r['warn']), 'the player frame warns that gear is broken')
        await shot(page, 'kit', "T.play(), T.F.openKit('kit'), 0")
        r = await ev(page, 'save', """(() => {
          const s = T.F.buildSave(), c = s.char.eq.chest;
          const back = __hm.fn.validSave ? 1 : 0;
          return { packed: { dur: c.dur, blood: c.blood }, weapon: s.char.eq.weapon };
        })()""")
        check(r['packed']['dur'] == 0 and r['packed']['blood'] > 0, 'durability and blood are saved with the item')
        # the merchant mends it all
        r = await ev(page, 'repair', """(() => {
          T.F.closeKit(); const F = T.F, INV = __hm.INV, P = T.P();
          const m = __hm.REALMS[0].merchant; __hm.teleport(m.x + Math.sin(m.yaw) * 2.2, m.z + Math.cos(m.yaw) * 2.2);
          INV.gold = 5000;
          const cost = F.repairAllCost();
          F.openKit('shop');
          return { cost, shop: __hm.UI.kitMode, row: !!document.getElementById('kit-repair') };
        })()""")
        check(r['shop'] == 'shop' and r['row'] and r['cost'] > 0, 'the merchant offers to mend the gear')
        await shot(page, 'shop')
        r = await ev(page, 'mended', """(() => {
          const F = T.F, INV = __hm.INV, P = T.P(); const g0 = INV.gold;
          document.getElementById('kit-repair').click();
          const durs = Object.values(INV.eq).map((it) => F.itemDur(it));
          F.closeKit();
          return { paid: g0 - INV.gold, min: Math.min(...durs), arm: F.gearTotals(INV.eq).arm };
        })()""")
        check(r['paid'] > 0 and r['min'] == 100, 'repairing restores every piece for gold')
        # wash at the well, then in a lake
        r = await ev(page, 'well', """(() => {
          const F = T.F, INV = __hm.INV, P = T.P();
          const w = F.wellSpots().find((s) => s.kind === 'well') || F.wellSpots()[0];
          __hm.teleport(w.x + 1.6, w.z + 0.4); __hm.simulate(0.2);
          const label = F.currentInteraction() && F.currentInteraction().label;
          if (label && label.startsWith('Wash')) F.currentInteraction().act();
          return { label, dirt: F.kitDirt() };
        })()""")
        check(r['label'] and r['label'].startswith('Wash') and r['dirt'] < 0.01, 'washing at a town well cleans the gear')
        r = await ev(page, 'lake', """(() => {
          const F = T.F, INV = __hm.INV, P = T.P();
          INV.eq.weapon.blood = 0.9; if (INV.eq.legs) INV.eq.legs.dirt = 0.9; P.dirt = 0.9;
          const L = __hm.dbg.LAKES[0];
          let spot = null;
          for (let r = L.r * 1.2; r > 2 && !spot; r -= 0.5) for (let a = 0; a < 6.283 && !spot; a += 0.2) { const x = L.x + Math.cos(a) * r, z = L.z + Math.sin(a) * r; if (F.heightAt(x, z) < -3.7 && F.isWalkable(x, z)) spot = { x, z }; }
          if (!spot) return { spot: null };
          __hm.teleport(spot.x, spot.z); __hm.simulate(6);
          return { spot, depth: -3.2 - F.heightAt(spot.x, spot.z), dirt: F.kitDirt(), wet: P.wet };
        })()""")
        check(r.get('spot') is not None and r['dirt'] < 0.05 and r['wet'] > 0.9, 'wading in a lake washes the gear and soaks the wearer')

        # ---------------- other qualities compile and run ----------------
        for q in ['high', 'low']:
            await page.evaluate(f"__hm.fn.setQuality('{q}')")
            await ev(page, 'q ' + q, "T.weather('rain', 5), __hm.frame(0.05), T.weather('storm', 5), __hm.frame(0.05), __hm.renderInfo().programs")
        bad = await ev(page, 'bad programs', "__hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name)")
        check(not bad, 'every shader program compiles')
        errs = await ev(page, 'errors', "__hm.errors")
        check(not errs, '__hm.errors is empty')
        for l in logs[:10]: print(l[:400])
        await b.close()
    print(f'{len(FAILS)} failed' if FAILS else 'all passed', f'[{time.time() - T0:.0f}s]')
    for f in FAILS: print('  -', f)

asyncio.run(main())
