"""The seasons across the whole world (02d_season.js, 05k_seasons.js): each season's curves and uniforms; the colour of
a broadleaf crown, the meadow and its flowers through the year read off the screen; bare winter crowns in the canopy
map while the pines keep theirs; snow lying by temperature (Thule and the heights all winter, the south on cold nights,
gone in the spring thaw) and the weather agreeing (rain in a Thule summer, snow in its winter); Thule's lake frozen in
winter (walked across, a wolf trotting over it, no splash, fishing through a hole) and swum in summer, the southern
lakes and the rivers never frozen; the gardens of Eriu and Thule worked by their townsfolk; no tree in any field or
garden; fewer birds in winter, butterflies and fireflies only in their seasons; the field notes and the Chronicle.
Screenshots: the same Logres orchard and meadow in all four seasons, an Eriu glen in autumn, a frozen Thule lake in
winter with the player on it, a garden in Eriu and one in Thule.
usage: python3 tools/tests/seasons.py [noshots] [final]   (final: 960 x 540 at medium quality)"""
import json, asyncio, sys, pathlib, time, base64, math
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright
FAILS = []
T0 = time.time()
SHOTS = 'noshots' not in sys.argv
FINAL = 'final' in sys.argv
ONLY = [a[5:] for a in sys.argv if a.startswith('only=')]
def want(name): return not ONLY or name in ONLY[0].split(',')

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1500], flush=True)
    return r

HELPERS = r"""
window.ST = {
  H: __hm, F: __hm.fn,
  safe() { const H = this.H, P = H.GAME.player; P.maxHp = Math.max(P.maxHp, 1e6); P.hp = P.maxHp; P.combatUntil = -99;
    for (const e of H.ENT) if (e !== P && e.alive && e.kind !== 'door' && this.F.isEnemy(P, e) && Math.hypot(e.x - P.x, e.z - P.z) < 70) { e.alive = false; e.removeAt = H.GAME.t; } },
  season(k) { const H = this.H; H.farm.setSeason(k); H.seasons.seasonSettle(); H.frame(1 / 60); },
  cam(c, l) { const H = this.H; H.UI.modal = 'menu'; H.CAM.mode = 'fixed'; document.getElementById('hud').hidden = true;
    const cm = H.camera; cm.position.set(c[0], c[1], c[2]); cm.lookAt(l[0], l[1], l[2]); cm.updateMatrixWorld(); },
  // the mean colour of a part of the picture (fractions of the canvas), after rendering a couple of frames
  probe(r) { const H = this.H; H.dbg.WEATHER.wet = 0; H.dbg.U.uWet.value = 0; H.frame(1 / 60); H.frame(1 / 60);
    const src = H.dbg.renderer.domElement, w = src.width, h = src.height;
    const c2 = document.createElement('canvas'); c2.width = w; c2.height = h; const g = c2.getContext('2d'); g.drawImage(src, 0, 0);
    const x0 = Math.floor(r[0] * w), y0 = Math.floor(r[1] * h), d = g.getImageData(x0, y0, Math.max(1, Math.floor(r[2] * w) - x0), Math.max(1, Math.floor(r[3] * h) - y0)).data;
    let R = 0, G = 0, B = 0, n = 0; for (let i = 0; i < d.length; i += 4) { R += d[i]; G += d[i + 1]; B += d[i + 2]; n++; }
    return [+(R / n).toFixed(1), +(G / n).toFixed(1), +(B / n).toFixed(1)]; },
  play() { this.H.UI.modal = null; this.H.CAM.mode = 'play'; },
  walk(yaw, sec, step = 0.5) { const H = this.H, P = H.GAME.player, path = [];
    P.yaw = yaw; H.CAM.yaw = yaw; H.UI.modal = null; H.INPUT.keys.add('KeyW');
    for (let t = 0; t < sec; t += step) { P.yaw = yaw; H.simulate(step); const w = H.water.waterAt(P.x, P.z); path.push([+P.x.toFixed(1), +P.z.toFixed(1), +P.y.toFixed(2), P.swim ? 1 : 0, w ? +w.y.toFixed(2) : null]); }
    H.INPUT.keys.delete('KeyW'); return path; },
};
0;
"""

PICK = next((a[6:].split(',') for a in sys.argv if a.startswith('shots=')), None)  # shots=thule_ice,garden_eriu: just those pictures
async def canvas_shot(page, name, js):
    if not SHOTS or (PICK and not any(k in name for k in PICK)): return
    await page.evaluate(js)
    url = await page.evaluate("(() => { __hm.frame(1 / 60); return __hm.dbg.renderer.domElement.toDataURL('image/png'); })()")
    pathlib.Path(OUT + name).write_bytes(base64.b64decode(url.split(',', 1)[1]))
    print('  shot', name, f'[{time.time() - T0:.0f}s]', flush=True)

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=960 if FINAL else 640, h=540 if FINAL else 360)
        await page.evaluate("__hm.start({ realm: 0, cls: 'warrior', level: 20 })")
        await page.evaluate("__hm.dbg.WEATHER.mode = 'clear'; __hm.simulate(0.2); __hm.frame(); 0")
        await page.evaluate(HELPERS)
        await page.evaluate("ST.safe(); 0")

        if want('curves'):
            # ---- the year's curves and the uniforms every shader reads ----
            r = await ev(page, 'curves', """(() => { const out = {};
              for (const [n, k] of [['spring', 0.11], ['summer', 0.42], ['autumn', 0.66], ['winter', 0.875]]) { ST.season(k); out[n] = __hm.seasons.uniforms(); }
              return out; })()""")
            sp, su, au, wi = r['spring'], r['summer'], r['autumn'], r['winter']
            check(sp['A'][0] > 0.9 and su['A'][1] > 0.9 and au['A'][2] > 0.9 and wi['A'][3] > 0.9, 'each season weighs in its own time')
            check(sp['B'][2] > 0.8 and su['B'][2] < 0.01 and wi['B'][2] < 0.01, 'the fruit trees blossom in spring only')
            check(au['B'][0] > 0.9 and su['B'][0] < 0.01 and sp['B'][0] < 0.01, 'the broadleaves turn in autumn')
            check(wi['B'][1] > 0.99 and su['B'][1] < 0.01 and sp['B'][1] < 0.3 and 0.05 < au['B'][1] < 0.6, 'bare in winter, in leaf in summer, falling in autumn')
            check(su['C'][0] > 0.95 and sp['C'][0] > 0.6 and wi['C'][0] < 0.01 and au['C'][0] < 0.35, 'flowers by season (none in winter)')
            check(su['C'][1] > 0.6 and sp['C'][1] < 0.01 and wi['C'][1] < 0.01, 'the summer gold on the dry turf')
            check(wi['C'][2] > 8 and su['C'][2] < -6, 'the snow line comes down in winter and goes up in summer')
            check(au['D'][0] > 0.9 and sp['D'][0] < 0.01 and wi['D'][0] < 0.1, 'apples from late summer through autumn')
            check(au['D'][1] > 0.8 and su['D'][1] < 0.01 and wi['D'][1] < 0.01, 'leaves drifting down in autumn only')

        oak = None
        if want('canopy') or want('colours') or SHOTS:
            # ---- the canopy map: bare broadleaf crowns in winter, the pines keep theirs ----
            r = await ev(page, 'canopy', """(() => { const H = __hm, S = H.seasons, R = H.REALMS;
              const oak = S.treesNear(R[0].town.x, R[0].town.z, 200, 'oak').find((t) => t.d > 70);
              const pine = S.treesNear(R[2].town.x, R[2].town.z, 200, 'pine').find((t) => t.d > 70);
              const at = (k) => { ST.season(k); H.visual.refresh(); return [H.visual.canopy(oak.x, oak.z), H.visual.canopy(pine.x, pine.z), S.seasonCrownK({ kind: 'oak' }), S.seasonCrownK({ kind: 'pine' })]; };
              return { oak, pine, summer: at(0.4), winter: at(0.9), spring: at(0.2) }; })()""")
            check(r['summer'][0] > 0.6 and r['winter'][0] < r['summer'][0] * 0.45, f"an oak's crown leaves the canopy map bare in winter ({r['summer'][0]:.2f} -> {r['winter'][0]:.2f})")
            check(abs(r['winter'][1] - r['summer'][1]) < 0.05 and r['winter'][3] == 1, 'a pine keeps its crown all year')
            check(r['spring'][0] > 0.6, 'the crowns come back in spring')
            oak = r['oak']

        if want('colours'):
            # ---- colours on the screen: a broadleaf crown and the meadow through the year ----
            r = await ev(page, 'colours', f"""(() => {{ const H = __hm, o = {json.dumps(oak)};
              H.setTod(0.55); H.teleport(o.x + 30, o.z + 30);
              const c = [o.x - 8.5, o.y + 4.6 * o.s, o.z - 8.5], l = [o.x, o.y + 4.4 * o.s, o.z];
              // the meadow: an open patch near the oak, seen from above
              let mx = o.x + 14, mz = o.z - 14;
              for (let a = 0; a < 40; a++) {{ const x = o.x + Math.cos(a) * (12 + a), z = o.z + Math.sin(a) * (12 + a); if (H.visual.canopy(x, z) < 0.02 && H.visual.meadow(x, z)) {{ mx = x; mz = z; break; }} }}
              const my = H.fn.heightAt(mx, mz);
              const out = {{}};
              for (const [n, k] of [['spring', 0.12], ['summer', 0.45], ['autumn', 0.66], ['winter', 0.88]]) {{
                ST.season(k); H.visual.refresh(); H.dbg.WEATHER.snow = 0;
                ST.cam(c, l); const crown = ST.probe([0.4, 0.3, 0.6, 0.55]);
                ST.cam([mx, my + 1.7, mz - 2.2], [mx, my, mz + 1.5]); const turf = ST.probe([0.3, 0.45, 0.7, 0.95]);
                out[n] = {{ crown, turf }};
              }}
              return out; }})()""")
            g = lambda c: c[1] / max(1, c[0] + c[1] + c[2])   # greenness
            warm = lambda c: c[0] / max(1, c[1])              # red over green
            check(warm(r['autumn']['crown']) > warm(r['summer']['crown']) + 0.15, f"the oak's crown turns from green to gold and rust ({r['summer']['crown']} -> {r['autumn']['crown']})")
            check(g(r['summer']['crown']) > g(r['winter']['crown']) + 0.03, f"the bare winter crown shows little green ({r['winter']['crown']})")
            check(warm(r['summer']['turf']) > warm(r['spring']['turf']) + 0.04, f"the meadow goes from spring green to summer gold ({r['spring']['turf']} -> {r['summer']['turf']})")
            check(warm(r['autumn']['turf']) > warm(r['spring']['turf']) + 0.06 and g(r['autumn']['turf']) < g(r['spring']['turf']), f"tawny in autumn ({r['autumn']['turf']})")
            check(g(r['winter']['turf']) < g(r['spring']['turf']), f"dormant in winter ({r['winter']['turf']})")

        if want('snow'):
            # ---- snow lying by temperature, and the weather agreeing ----
            r = await ev(page, 'snow', """(() => { const H = __hm, S = H.seasons, R = H.REALMS, W = H.dbg.WEATHER, out = {};
              // the highest ground in Logres's home lands
              let hx = 0, hz = 0, hh = -1e9;
              for (let a = 0; a < 200; a++) { const x = R[0].town.x + Math.cos(a * 0.7) * (40 + a), z = R[0].town.z + Math.sin(a * 0.7) * (40 + a); const h = H.fn.heightAt(x, z); if (S.realmAt(x, z) === 0 && h > hh) { hh = h; hx = x; hz = z; } }
              out.high = [Math.round(hx), Math.round(hz), +hh.toFixed(1)];
              H.setTod(0.5); ST.season(0.88);
              out.winterDay = { thule: S.lie(R[2].town.x, R[2].town.z), logres: S.lie(R[0].town.x, R[0].town.z), high: S.lie(hx, hz), temps: S.temps(R[0].town.x, R[0].town.z) };
              H.setTod(2.05); H.frame(); S.step(240);
              out.winterNight = { logres: S.lie(R[0].town.x, R[0].town.z), eriu: S.lie(R[1].town.x, R[1].town.z) };
              H.setTod(0.55); H.frame(); S.step(600);
              out.nextDay = { logres: S.lie(R[0].town.x, R[0].town.z) };
              ST.season(0.2); out.spring = { thule: S.lie(R[2].town.x, R[2].town.z), high: S.lie(hx, hz) };
              ST.season(0.42); out.summer = { thule: S.lie(R[2].town.x, R[2].town.z), high: S.lie(hx, hz) };
              // the weather: rain in a Thule summer, snow in its winter
              H.teleport(R[2].town.x + 20, R[2].town.z + 20); ST.cam([R[2].town.x + 20, H.fn.heightAt(R[2].town.x + 20, R[2].town.z + 20) + 3, R[2].town.z + 20], [R[2].town.x, 0, R[2].town.z]);
              W.mode = 'auto'; W.kind = 'rain'; W.next = 999; W.raining = 1;
              H.setTod(0.5); ST.season(0.42); for (let i = 0; i < 4; i++) H.frame(0.2); out.thuleSummer = { snowing: W.snowing, label: W.label };
              ST.season(0.88); W.raining = 1; for (let i = 0; i < 4; i++) H.frame(0.2); out.thuleWinter = { snowing: W.snowing, label: W.label, cover: H.dbg.U.uSnowCover.value };
              W.mode = 'clear'; W.kind = 'clear'; W.raining = 0; W.snowing = 0; W.snow = 0; W.wet = 0;
              return out; })()""")
            wd, wn = r['winterDay'], r['winterNight']
            check(wd['thule'] > 0.8, f"snow lies on Thule all winter ({wd['thule']:.2f})")
            check(r['high'][2] < 18 or wd['high'] > 0.5, f"and on the high ground ({r['high']}, {wd['high']:.2f})")
            check(wd['logres'] < 0.25, f"the south is green on a winter's day ({wd['logres']:.2f})")
            check(wn['logres'] > 0.35, f"and white after a cold winter night ({wn['logres']:.2f})")
            check(r['nextDay']['logres'] < wn['logres'] - 0.2, f"melting again by day ({r['nextDay']['logres']:.2f})")
            check(r['spring']['thule'] < 0.05 and r['summer']['thule'] < 0.01, 'the spring thaw clears Thule')
            check(abs(wd['temps']['map'] - wd['temps']['farm']) < 2.5, f"the season map agrees with farmTempAt ({wd['temps']})")
            check(r['thuleSummer']['snowing'] < 0.15, f"rain, not snow, in a Thule summer ({r['thuleSummer']})")
            check(r['thuleWinter']['snowing'] > 0.6, f"snow in a Thule winter ({r['thuleWinter']})")

        if want('ice'):
            # ---- the lakes: Thule's frozen in winter, walked across; swum in summer; the south and the rivers open ----
            r = await ev(page, 'ice', """(() => { const H = __hm, S = H.seasons, out = {};
              ST.season(0.9); ST.play();
              out.frozen = S.frozen();
              const L = S.lakes().find((q) => q.realm === 2), Ls = S.lakes().find((q) => q.realm === 0);
              out.lake = L;
              out.centre = S.ice(L.x, L.z); out.south = S.ice(Ls.x, Ls.z);
              // a river above its lake
              const rv = H.water.rivers ? H.water.rivers() : null; out.rivers = rv ? rv.length : null;
              let riverIce = 0, rn = 0;
              for (const Rv of H.water.RIVERS) for (let i = 4; i < Rv.pts.length * 0.6; i += 3) { const q = Rv.pts[i]; if (q.surf > -3.0) { riverIce = Math.max(riverIce, S.seasonIceAt(q.x, q.z)); rn++; } }
              out.riverIce = riverIce; out.riverPts = rn;
              return out; })()""")
            L = r['lake']
            fz = r['frozen']
            check(fz['lake'][2] > 80 and fz['lake'][0] == 0 and fz['lake'][1] == 0, f"Thule's lake freezes in winter, the southern lakes do not ({fz})")
            check(all(t[1] > 8 for t in fz['tarns'] if t[0] != 2), f"in the south only the high tarns freeze ({fz['tarns']})")
            check(r['centre']['thick'] > 0.6 and r['centre']['y'] is not None and abs(r['centre']['y'] - r['centre']['water'] - 0.05) < 0.02, f"thick ice at the lake's middle, a floor at the water's surface ({r['centre']})")
            check(r['riverPts'] > 3 and r['riverIce'] < 0.05, f"the rivers keep flowing ({r['riverIce']:.2f} over {r['riverPts']} points)")
            # walk straight across the frozen lake
            r = await ev(page, 'walk', f"""(() => {{ const H = __hm, P = H.GAME.player, L = {json.dumps(L)};
              const x0 = L.x - L.r * 0.8, z0 = L.z; H.teleport(x0, z0); ST.safe(); H.simulate(1.6);
              const lifted = {{ swim: P.swim, y: +P.y.toFixed(2), wy: H.water.waterAt(P.x, P.z) ? +H.water.waterAt(P.x, P.z).y.toFixed(2) : null }};
              const path = ST.walk(Math.PI / 2, 7);
              let splash = H.water.splashAt(L.x, L.z, 1);
              return {{ lifted, path, splash, walkable: H.fn.isWalkable(L.x, L.z) }}; }})()""")
            path = r['path']
            onIce = [q for q in path if q[4] is not None]
            check(not r['lifted']['swim'] and r['lifted']['wy'] is not None and abs(r['lifted']['y'] - r['lifted']['wy'] - 0.05) < 0.08, f"set down on the ice: standing on it, not swimming ({r['lifted']})")
            check(len(onIce) >= 6 and all(q[3] == 0 and q[2] > q[4] - 0.05 for q in onIce), f"walked {len(onIce)} steps over the ice, never in the water")
            check(path[-1][0] - path[0][0] > 15, f"and across it ({path[0][:2]} -> {path[-1][:2]})")
            check(r['splash'] is False and r['walkable'], 'no splash on the ice, and the lake is walkable ground for everyone')
            # a wolf set down on the ice stands on it, and trots home across it (it is walkable ground)
            r = await ev(page, 'wolf', f"""(() => {{ const H = __hm, L = {json.dumps(L)};
              const e = H.ENT.find((q) => q.alive && q.kind === 'wolf' && !q.tame);
              if (!e) return {{ none: true }};
              e.faction = H.FACTION_NEUTRAL; e.target = null;
              e.x = e.prevX = L.x + 3; e.z = e.prevZ = L.z + 3; e.y = H.fn.heightAt(e.x, e.z);
              const path = [];
              for (let i = 0; i < 12; i++) {{ H.simulate(0.5); const w = H.water.waterAt(e.x, e.z); path.push([+e.x.toFixed(1), +e.z.toFixed(1), +e.y.toFixed(2), e.swim ? 1 : 0, w ? +w.y.toFixed(2) : null]); }}
              return {{ path }}; }})()""")
            if not r.get('none'):
                wp = [q for q in r['path'][1:] if q[4] is not None]
                check(len(wp) > 0 and all(q[3] == 0 and q[2] > q[4] - 0.1 for q in wp), f"a wolf on the ice stands and walks on it, never swims ({wp[:3]})")
            # fishing through a hole in the ice
            r = await ev(page, 'fish', f"""(() => {{ const H = __hm, P = H.GAME.player, L = {json.dumps(L)}, S = H.surv;
              H.teleport(L.x, L.z); H.simulate(1.2); H.fn.goodsAdd('tool_rod', 1, true); P.yaw = 0.3; H.simulate(0.1);
              const sp = S.fishSpot ? S.fishSpot(P) : null;
              if (sp) S.fishStart(sp);
              H.frame(); H.simulate(0.6); H.frame();
              const hole = H.seasons.SEAS.hole;
              const out = {{ spot: sp, fishing: !!S.SURV.fish, hole: hole ? hole.visible : null }};
              if (S.SURV.fish) S.fishStop && S.fishStop('');
              return out; }})()""")
            check(r['spot'] is not None and r['spot'].get('hole') and r['fishing'] and r['hole'], f"fishing through a hole in the ice ({r})")
            # the same lake in summer: water you swim in
            r = await ev(page, 'summer lake', f"""(() => {{ const H = __hm, P = H.GAME.player, S = H.seasons, L = {json.dumps(L)};
              ST.season(0.42);
              const fr = S.frozen();
              H.teleport(L.x - L.r * 0.8, L.z); H.simulate(1.0);
              const path = ST.walk(Math.PI / 2, 5);
              return {{ frozen: fr.walkable, ice: S.ice(L.x, L.z), path }}; }})()""")
            check(sum(r['frozen']) == 0 and r['ice']['y'] is None, 'no ice anywhere in summer')
            check(any(q[3] == 1 for q in r['path']), "in summer the lake is water you swim in")
            # the thaw: thin at the edges first
            r = await ev(page, 'thaw', f"""(() => {{ const H = __hm, S = H.seasons, L = {json.dumps(L)}, out = [];
              for (const k of [0.04, 0.09, 0.12, 0.15]) {{ ST.season(k); let edge = 0, n = 0; for (let a = 0; a < 24; a++) {{ for (let d = L.r * 1.2; d > 2; d -= 0.5) {{ const x = L.x + Math.cos(a / 24 * 6.283) * d, z = L.z + Math.sin(a / 24 * 6.283) * d; const w = H.water.waterAt(x, z); if (w && w.depth > 0.15) {{ edge += S.seasonIceAt(x, z); n++; break; }} }} }}
                out.push([k, +(edge / Math.max(1, n)).toFixed(2), +S.seasonIceAt(L.x, L.z).toFixed(2)]); }}
              return out; }})()""")
            check(any(q[1] < q[2] - 0.15 for q in r), f"in the spring thaw the ice goes at the shallow edges first ({r})")
            check(r[-1][2] < 0.3, 'and by mid spring the lake is open')

        if want('gardens'):
            # ---- the gardens of Eriu and Thule, worked by their townsfolk; no trees in any field ----
            r = await ev(page, 'gardens', """(() => { const H = __hm, F = H.farm, S = H.seasons, out = {};
              out.fields = S.fields(); out.orchard = !!H.surv.FORAGE.orchard; out.trees = S.trees();
              const strips = F.FARM.plots.filter((P) => P.own === 't');
              out.strips = [0, 1, 2].map((r) => strips.filter((P) => P.stand.town === r).length);
              out.rot = [1, 2].map((r) => { const P = strips.find((q) => q.stand.town === r); return P ? (P.rotList || []).join(',') : null; });
              out.farmers = F.farmers().map((id) => H.fn.getEnt(id)).filter((e) => e).map((e) => [e.farmTown, e.ai.fieldHand ? 1 : 0]);
              return out; })()""")
            check(r['strips'][1] >= 2 and r['strips'][2] >= 2, f"gardens in Eriu and Thule ({r['strips']} strips)")
            check('herb_heal' in (r['rot'][0] or '') and set((r['rot'][1] or '').split(',')) <= {'turnip', 'cabbage'}, f"herbs and vegetables in Eriu, turnips and cabbages in Thule ({r['rot']})")
            check(all(f['trees'] == 0 for f in r['fields']), f"no tree stands in a field or garden ({[f['trees'] for f in r['fields']]})")
            check(r['orchard'] and r['trees'] > 2000, f"the trees moved off the fields went back into the woods: the Logres orchard still has its place ({r['orchard']}, {r['trees']} trees)")
            check(any(f[0] == 1 and f[1] for f in r['farmers']) and any(f[0] == 2 and f[1] for f in r['farmers']), f"gardeners in Eriu and Thule ({r['farmers']})")
            for realm in (1, 2):
                r = await ev(page, f'gardener {realm}', f"""(() => {{ const H = __hm, F = H.farm, R = H.REALMS[{realm}];
                  F.setSeason(0.08); H.setTod(0.5, 'fixed');
                  const P = F.FARM.plots.filter((q) => q.own === 't' && q.stand.town === {realm}).sort((a, b) => Math.hypot(a.x - R.town.x, a.z - R.town.z) - Math.hypot(b.x - R.town.x, b.z - R.town.z))[0];
                  const T = P.stand; T.phase = 'fallow'; T.task = 'till'; T.p = 0; T.worker = null; T.workT = H.GAME.t;
                  H.teleport(P.x + 10, P.z + 10); ST.safe(); ST.play();
                  for (const id of F.farmers()) {{ const e = H.fn.getEnt(id); if (e && e.farmTown === {realm} && e.ai.fieldHand) {{ e.ai.plan = null; e.ai.visitUntil = 0; e.ai.nextVisit = H.GAME.t + 999; e.ai.lifeWait = 0; e.ai.farmNext = 0; }} }}
                  let worker = null, dmin = 1e9;
                  for (let i = 0; i < 90 && !(T.phase === 'tilled'); i++) {{ H.simulate(1); if (T.worker != null) {{ worker = T.worker; const e = H.fn.getEnt(T.worker); if (e) dmin = Math.min(dmin, Math.hypot(e.x - P.x, e.z - P.z)); }} }}
                  const e = worker != null ? H.fn.getEnt(worker) : null;
                  const pens = (H.animals && H.animals.A ? H.animals.A.pens : []).filter((q) => Math.hypot(q.x - R.town.x, q.z - R.town.z) < 120).map((q) => [Math.round(q.x), Math.round(q.z), Math.round(q.hw), Math.round(q.hd)]);
                  return {{ phase: T.phase, task: T.task, p: +T.p.toFixed(2), worker, town: e ? e.farmTown : null, dmin: +dmin.toFixed(1), at: e ? [+e.x.toFixed(1), +e.z.toFixed(1)] : null, plot: [+P.x.toFixed(1), +P.z.toFixed(1), +P.ang.toFixed(2), P.hw, P.hd], town0: [R.town.x, R.town.z], pens }}; }})()""")
                check(r['worker'] is not None and r['town'] == realm and r['dmin'] < 6, f"a townsfolk of {['', 'Eriu', 'Thule'][realm]} walks out to work the garden ({r})")

        if want('life'):
            # ---- life by season ----
            r = await ev(page, 'life', """(() => { const H = __hm, S = H.seasons, out = {};
              H.setTod(0.5); ST.season(0.88); out.birdsWinter = S.seasonBirdK(); H.setTod(2.05); H.frame(); out.fliesWinter = H.dbg.U.uSeasonD.value.z;
              ST.season(0.4); H.setTod(2.05); H.frame(); out.fliesSummer = H.dbg.U.uSeasonD.value.z; H.setTod(0.5); H.frame(); out.birdsSummer = S.seasonBirdK(); out.butterflySummer = H.dbg.U.uSeasonC.value.x;
              ST.season(0.88); out.butterflyWinter = H.dbg.U.uSeasonC.value.x;
              return out; })()""")
            check(r['birdsWinter'] < r['birdsSummer'] - 0.4, f"fewer birds in winter ({r['birdsWinter']:.2f} of {r['birdsSummer']:.2f})")
            check(r['fliesSummer'] > 0.5 and r['fliesWinter'] < 0.01, 'fireflies on summer nights only')
            check(r['butterflySummer'] > 0.9 and r['butterflyWinter'] < 0.01, 'butterflies and flowers in the warm seasons only')

        if want('notes'):
            # ---- players know: the field notes and the Chronicle ----
            r = await ev(page, 'notes', """(() => { const H = __hm, P = H.GAME.player, out = {}, R = H.REALMS;
              ST.season(0.9); H.teleport(R[2].town.x + 6, R[2].town.z + 6); ST.play(); H.setTod(0.5);
              for (let i = 0; i < 6; i++) { H.simulate(0.3); H.frame(1 / 30); }
              const seen = (H.GAME.prog.lore.seen || []).concat(H.LORE.queue || []);
              out.snow = seen.includes('snowlies'); out.ice = seen.includes('lakeice');
              H.LORE.openChronicle('fields');
              const el = document.querySelector('.chron-body, #chronicle, .chron') || document.body;
              out.page = /The year on the land/.test(document.body.innerHTML) && /lakes and ponds of Thule/.test(document.body.innerHTML);
              H.UI.modal = null; const m = document.getElementById('menu'); if (m) m.hidden = true;
              return out; })()""")
            check(r['snow'] and r['ice'], f"field notes for the snow and the frozen lakes ({r})")
            check(r['page'], "the Chronicle's Fields page tells of the year")

        if SHOTS: await shots(page, oak)
        errs = await page.evaluate("__hm.errors")
        check(not errs, f'no runtime errors {errs[:2]}')
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, f'[{time.time() - T0:.0f}s]')
        await b.close()

async def shots(page, oak):
    q = 'medium' if FINAL else 'low'
    await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
    # the Logres orchard and the meadow before it, the same view in every season
    r = await page.evaluate("""(() => { const H = __hm, R = H.REALMS[0], O = H.surv.FORAGE.orchard || { x: R.town.x + 70, z: R.town.z };
      const dx = R.town.x - O.x, dz = R.town.z - O.z, d = Math.hypot(dx, dz) || 1;
      const cx = O.x - (dx / d) * 22 + (dz / d) * 6, cz = O.z - (dz / d) * 22 - (dx / d) * 6;
      return { O, cam: [cx, H.fn.heightAt(cx, cz) + 3.2, cz], look: [O.x, H.fn.heightAt(O.x, O.z) + 2.0, O.z] }; })()""")
    for name, k in [('spring', 0.1), ('summer', 0.44), ('autumn', 0.66), ('winter', 0.88)]:
        await canvas_shot(page, f'seasons_orchard_{name}.png', f"""(() => {{ const H = __hm; ST.season({k}); H.setTod({0.62 if name != 'winter' else 0.5});
          H.teleport({r['O']['x']} + 40, {r['O']['z']} + 40); H.visual.refresh(); H.dbg.WEATHER.snow = 0;
          ST.cam({json.dumps(r['cam'])}, {json.dumps(r['look'])}); for (let i = 0; i < 2; i++) H.frame(1 / 30); }})()""")
    # winter dawn in the south after a cold night: the meadow white with frost and a little snow
    await canvas_shot(page, 'seasons_orchard_winter_dawn.png', f"""(() => {{ const H = __hm; ST.season(0.88); H.setTod(2.05); H.frame(); H.seasons.step(300); H.setTod(2.85);
      ST.cam({json.dumps(r['cam'])}, {json.dumps(r['look'])}); for (let i = 0; i < 2; i++) H.frame(1 / 30); }})()""")
    # an Eriu glen in autumn: broadleaves turning, leaves drifting
    await canvas_shot(page, 'seasons_eriu_autumn.png', """(() => { const H = __hm, S = H.seasons, R = H.REALMS[1];
      const t = S.treesNear(R.town.x, R.town.z, 220).filter((q) => q.kind !== 'pine' && q.d > 60);
      let best = t[0], bn = 0;
      for (const q of t.slice(0, 80)) { const n = t.filter((o) => Math.hypot(o.x - q.x, o.z - q.z) < 18).length; if (n > bn) { bn = n; best = q; } }
      ST.season(0.67); H.setTod(0.7); H.teleport(best.x + 30, best.z + 30); H.visual.refresh();
      const cx = best.x - 16, cz = best.z - 12; ST.cam([cx, H.fn.heightAt(cx, cz) + 2.2, cz], [best.x, best.y + 3, best.z]);
      for (let i = 0; i < 2; i++) H.frame(1 / 30); })()""")
    # the frozen lake of Thule in winter, the player walking on it
    await canvas_shot(page, 'seasons_thule_ice.png', """(() => { const H = __hm, S = H.seasons, P = H.GAME.player;
      const L = S.lakes().find((q) => q.realm === 2);
      ST.season(0.9); H.setTod(0.45); ST.play(); H.teleport(L.x - 4, L.z - 3); ST.safe(); H.simulate(1.2);
      H.INPUT.keys.add('KeyW'); P.yaw = 0.6; H.simulate(0.6); H.INPUT.keys.delete('KeyW');
      ST.cam([L.x - 16, P.y + 4.5, L.z - 14], [P.x, P.y + 0.8, P.z]); for (let i = 0; i < 2; i++) H.frame(1 / 30); })()""")
    # the gardens: Eriu's herbs and greens, Thule's turnips and cabbages, in summer
    for realm, name in [(1, 'eriu'), (2, 'thule')]:
        await canvas_shot(page, f'seasons_garden_{name}.png', f"""(() => {{ const H = __hm, F = H.farm, R = H.REALMS[{realm}];
          ST.season(0.4); H.setTod(0.6);
          const S = F.FARM.plots.filter((q) => q.own === 't' && q.stand.town === {realm});
          const crops = {json.dumps(['herb_heal', 'beans', 'cabbage', 'herb_mana'] if realm == 1 else ['turnip', 'cabbage', 'turnip', 'cabbage'])};
          S.forEach((P, i) => {{ const T = P.stand; T.phase = 'sown'; T.crop = crops[i % crops.length]; T.g = 0.75 + 0.05 * (i % 3); T.hp = 1; T.dead = false; T.task = null; P.weeds = 0; P.dmg.fill(0); }});
          F.FARM.drawDirty = true;
          const P = S[0]; H.teleport(P.x + 14, P.z + 14);
          const cx = P.x - P.ax * 9 + P.bx * 6, cz = P.z - P.az * 9 + P.bz * 6;
          ST.cam([cx, H.fn.heightAt(cx, cz) + 4.5, cz], [P.x, P.y + 0.3, P.z]); for (let i = 0; i < 2; i++) H.frame(1 / 30); }})()""")

asyncio.run(main())
