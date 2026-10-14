"""[season2] The season felt in the field (version 20): the season's armies as bands of the live war, both ways.
  field    an army of Thule marching on a Logres keep (RS, 08m_realm.js) comes onto the field as a band when the player
           stands by the keep: its realm, its number scaled, its order the season's; RS holds it (onField) and steps it no
           further; soldiers killed in the field are its losses in RS; the player gone far, it is folded back where it
           stood; the player back, it comes again with what is left; the keep taken in the field, taken in RS
  offense  an offensive announced and marching on its day: the war panel, the herald's word and the Season page say where;
           its band comes onto the field by the keep; cut down to the last soldier, the offensive is beaten off in RS
           (the defender's points)
  ui       the Season page's section, the map's pennants, the field notes
  shots    the band of the season before a keep (960x540) and the map with its pennant
usage: python3 tools/tests/season2.py [only=field,offense,ui,shots] [noshots]"""
import asyncio, sys, pathlib, time, base64
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
ONLY = next((a[5:].split(',') for a in ARGS if a.startswith('only=')), None)
NOSHOTS = 'noshots' in ARGS
FAILS = []
T0 = time.time()
def want(k): return (ONLY is None and (k != 'shots' or not NOSHOTS)) or (ONLY is not None and k in ONLY)
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)
async def ev(page, js): return await page.evaluate(js)

HELP = r"""(() => {
  const H = __hm, fn = H.fn, WAR = H.WAR, S2 = H.season2;
  window.__s2 = {
    rs() { return H.season.rs(); },
    to(x, z) { const P = H.GAME.player; P.x = P.prevX = x; P.z = P.prevZ = z; P.y = fn.heightAt(x, z); P.hp = P.maxHp; P.alive = true; },
    keepNear(k, d) { const s = WAR.keeps[k].site, a = Math.atan2(s.x, s.z); this.to(s.x + Math.sin(a) * d, s.z + Math.cos(a) * d); },
    town() { const t = H.REALMS[0].town; this.to(t.x + 3, t.z + 3); },
    calm() { for (const C of WAR.commanders) { C.nextThink = 1e9; C.nextSpawn = 1e9; } for (const e of H.ENT.slice()) if (e.role === 'soldier' && !(e.warband && e.warband.season)) fn.removeEnt(e); for (const w of WAR.warbands) if (!w.season) w.dead = true; },
    step(n) { for (let i = 0; i < n; i++) { H.simulate(1); } },
    army(id) { return this.rs().armies.find((A) => A.id === id) || null; },
    band(id) { const B = S2.S2.bands.get(id); return B ? B.wb : null; },
    live(id) { const w = this.band(id); return w ? fn.wbMembers(w) : []; },
  };
})(); 0"""

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 30 }); __hm.UI.modal = null; return 0; })()")
        await ev(page, HELP)
        await ev(page, "__hm.simulate(1); 0")
        # the season into its war (the muster is its first week), the live war quiet, the player a hardy one
        r = await ev(page, r"""(() => { const H = __hm, S = H.season; S.away(8 * 86400); __s2.town(); H.simulate(2); const RS = __s2.rs(); RS.armies.length = 0; RS.offs.length = 0; __s2.calm(); return { phase: RS.phase, live: RS.live, war: H.CW.CAMPAIGN.state }; })()""")
        print('boot', round(time.time() - T0), 's', r, flush=True)
        check(r['phase'] == 'war' and r['live'], f"the season is at war and the page lives it ({r})")

        if want('field'):
            print('FIELD', flush=True)
            # Thule musters an army against a Logres keep: an officer's order
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = __s2.rs(), R = RS.realms[2];
              R.lev = 40; R.aim = 0;
              const ok = H.season.realmSimOrder(RS, 2, { type: 'muster' }, { name: 'test', rank: 9 });
              const A = RS.armies.find((q) => q.r === 2 && q.k === 0);
              return { ok, id: A && A.id, n: A && A.n, kind: A && A.kind, p: A && A.p };
            })()""")
            check(r['ok'] and r['id'], f"Thule's officer musters an army against the Logres keep west ({r})")
            aid = r['id']; n0 = r['n']
            # far from the player: it stays a number on the road; RS steps it
            r = await ev(page, f"""(() => {{ __s2.town(); __s2.step(3); const A = __s2.army({aid}); return {{ on: !!(A && A.onField), band: !!__s2.band({aid}), p: A.p }}; }})()""")
            check(not r['on'] and not r['band'], f"far from the player it is the season's alone ({r})")
            # the player at the keep: the army comes onto the field as a band of Thule, its number scaled
            r = await ev(page, f"""(() => {{
              const H = __hm, fn = H.fn; __s2.keepNear(0, 60); __s2.step(3);
              const A = __s2.army({aid}), wb = __s2.band({aid}), m = __s2.live({aid}), L = wb && fn.wbLeader(wb);
              return {{ on: !!(A && A.onField), who: A && A.onField && A.onField.who, band: !!wb, realm: wb && wb.realm, n: m.length, size: H.season2.s2Size({{ n: A.n, off: 0 }}),
                order: wb && wb.order && wb.order.type, keep: wb && wb.order && wb.order.keep && wb.order.keep.id, name: wb && H.season2.s2Name(wb, true), inList: H.WAR.warbands.includes(wb),
                d: L ? Math.round(Math.hypot(L.x - H.GAME.player.x, L.z - H.GAME.player.z)) : -1, sides: m.every((e) => e.faction === 2 && e.alive) }};
            }})()""")
            print('  ', r, flush=True)
            check(r['band'] and r['on'] and r['who'] == 'page' and r['realm'] == 2 and r['sides'], f"by its keep the army comes onto the field: a band of Thule held by the page ({r['n']} soldiers, {r['d']} m off)")
            check(r['n'] == r['size'] and 3 <= r['n'] <= 12, f"its number scaled to the live war's ({n0:.0f} in the season, {r['n']} here)")
            check(r['order'] == 'attack' and r['keep'] == 0 and r['inList'], f"its order the season's: on the keep ({r['order']} {r['keep']}), a band of the war like any other")
            check('army of the season' in (r['name'] or ''), f"named as the season's ({r['name']})")
            # never two of one army: RS steps it no further while it is on the field
            r = await ev(page, f"""(() => {{ const RS = __s2.rs(), A = __s2.army({aid}), p0 = A.p, s0 = A.state; const T = JSON.parse(JSON.stringify(RS)); T.armies.forEach((q) => {{ q.onField = q.onField; }}); __hm.season.realmSimStep(T, 120); const B = T.armies.find((q) => q.id === {aid}); const U = JSON.parse(JSON.stringify(RS)); __hm.season.realmSimStep(U, 3 * 3600); const C = U.armies.find((q) => q.id === {aid}); return {{ p0, p1: B ? B.p : -1, s1: B ? B.state : 'gone', n1: B ? B.n : -1, n0: A.n, on: !!(B && B.onField), stale: C ? !C.onField && C.p > p0 : true }}; }})()""")
            check(abs(r['p1'] - r['p0']) < 1e-9 and r['n1'] == r['n0'] and r['on'], f"while it is on the field the season does not move it ({r})")
            check(r['stale'], 'an army whose page says nothing for longer than RSM.field.stale is folded back and marches on by the numbers')
            # soldiers killed in the field: its losses in RS
            r = await ev(page, f"""(() => {{
              const H = __hm, fn = H.fn, P = H.GAME.player, m = __s2.live({aid}), A = __s2.army({aid}), n0 = A.n;
              const kill = Math.floor(m.length / 2);
              for (const e of m.slice(0, kill)) fn.killEnt(e, P);
              __s2.step(2);
              const B = __s2.army({aid});
              return {{ kill, of: m.length, n0, n1: B ? B.n : -1, left: __s2.live({aid}).length }};
            }})()""")
            check(r['n1'] < r['n0'] - 1 and abs(r['n1'] - r['n0'] * r['left'] / r['of']) < 1.5, f"{r['kill']} of its {r['of']} killed in the field: the army in the season {r['n0']:.1f} to {r['n1']:.1f}")
            # the player far away: folded back where it stood, its bodies gone
            r = await ev(page, f"""(() => {{ const A0 = __s2.army({aid}), p0 = A0.p; __s2.town(); __s2.step(4); const A = __s2.army({aid}); return {{ band: !!__s2.band({aid}), on: !!(A && A.onField), n: A && A.n, p: A && A.p, p0, bodies: __hm.ENT.filter((e) => e.alive && e.warband && e.warband.season && e.warband.season.id === {aid}).length }}; }})()""")
            check(not r['band'] and not r['on'] and r['bodies'] == 0, f"the player far away: it is folded back into the season, no body left ({r})")
            # back by the keep: it comes again with what is left
            r = await ev(page, f"""(() => {{ __s2.keepNear(0, 60); __s2.step(3); const A = __s2.army({aid}); return {{ band: !!__s2.band({aid}), n: __s2.live({aid}).length, rs: A && A.n, size: __hm.season2.s2Size({{ n: A.n, off: 0 }}) }}; }})()""")
            check(r['band'] and r['n'] == r['size'], f"back by the keep it comes again with what is left ({r})")
            # the keep taken in the field by Thule: taken in RS, the army home into its garrison, the band holds it
            r = await ev(page, f"""(() => {{
              const H = __hm, fn = H.fn, RS = __s2.rs(), K = H.WAR.keeps[0], wb = __s2.band({aid}), cap0 = RS.stats.captures;
              fn.captureKeep(K, 2, null); __s2.step(2);
              const A = __s2.army({aid});
              return {{ rs: RS.keeps[0].h, gone: !A, g: RS.keeps[0].g, released: wb && !wb.season, alive: wb ? fn.wbMembers(wb).length : 0, won: H.season2.S2.stats.won }};
            }})()""")
            check(r['rs'] == 2 and r['gone'] and r['released'] and r['alive'] > 0, f"the keep taken in the field is taken in the season, the army gone home into its garrison, the band holds it ({r})")
            await ev(page, "(() => { const H = __hm; H.fn.captureKeep(H.WAR.keeps[0], 0, null); __s2.calm(); __s2.step(1); return 0; })()")

        if want('offense'):
            print('OFFENSE', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, S = H.season, RS = __s2.rs(); __s2.town(); __s2.calm(); RS.keeps.forEach((K) => { K.h = K.home; K.siege = null; K.g = 8; }); S.apply(); RS.armies.length = 0; RS.offs.length = 0;
              RS.realms[1].lev = 40; RS.realms[1].proj.engines = 2;
              RS.offs.push({ r: 1, k: 1, at: Math.round(RS.t + 3600), ann: Math.round(RS.t), state: 'planned', army: 0, res: '', liveUntil: 0 });
              __s2.step(2);
              const hud = S.seasonHudLine(), war = S.seasonWarText(0), page = S.chronSeason();
              return { hud: /offensive on .* marches in/.test(hud), war, page: /The armies of the season/.test(page) && /offensive on/.test(page) };
            })()""")
            check(r['hud'] and r['page'], f"an offensive an hour off: the war panel and the Season page say where and when ({r})")
            # its day: the army marches from Ériu's muster with its engines; the player at the keep named
            r = await ev(page, r"""(() => {
              const H = __hm, RS = __s2.rs(); RS.t += 3601; __s2.step(2);
              const O = RS.offs.find((q) => q.r === 1 && q.k === 1), A = RS.armies.find((q) => q.id === O.army);
              __s2.keepNear(1, 70); __s2.step(3);
              const wb = A && __s2.band(A.id), sp = RS.realms[0].sp;
              return { state: O.state, id: A && A.id, n: A && A.n, eng: A && A.eng, band: !!wb, size: wb ? H.fn.wbMembers(wb).length : 0, name: wb ? H.season2.s2Name(wb, true) : '', why: wb && wb.order && wb.order.why, hud: H.season.seasonHudLine(), sp };
            })()""")
            print('  ', {k: v for k, v in r.items() if k != 'hud'}, flush=True)
            check(r['state'] == 'siege' and r['id'] and r['band'] and 'offensive' in r['name'] and r['why'] == 'offensive', f"on its day the offensive marches and comes onto the field by its keep ({r['size']} soldiers for {r['n']:.0f}, {r['eng']} engines)")
            check('s2-line' in r['hud'] and 'offensive' in r['hud'], 'the war panel tells the offensive on the field')
            oid = r['id']; sp0 = r['sp']
            r = await ev(page, f"""(() => {{ const H = __hm, fn = H.fn, P = H.GAME.player, RS = __s2.rs(); for (const e of __s2.live({oid})) fn.killEnt(e, P); __s2.step(2); const O = RS.offs.find((q) => q.army === {oid}); return {{ res: O && O.res, state: O && O.state, gone: !__s2.army({oid}), sp: RS.realms[0].sp }}; }})()""")
            check(r['res'] == 'held' and r['gone'] and r['sp'] >= sp0 + 8.9, f"cut down to the last soldier the offensive is beaten off in the season: Logres {sp0:.1f} to {r['sp']:.1f} points ({r})")

        if want('ui'):
            print('UI', flush=True)
            r = await ev(page, r"""(() => {
              const H = __hm, RS = __s2.rs(); __s2.calm(); RS.keeps.forEach((K) => { K.h = K.home; K.siege = null; K.g = 8; }); H.season.apply(); RS.armies.length = 0;
              RS.realms[2].lev = 40; RS.realms[2].aim = 1;
              H.season.realmSimOrder(RS, 2, { type: 'muster' }, { name: 'test', rank: 9 });
              __s2.keepNear(1, 60); __s2.step(3);
              H.LORE.check && H.LORE.check(); __s2.step(1);
              const seen = (H.GAME.prog.lore && H.GAME.prog.lore.seen) || {};
              H.LORE.openChronicle('season');
              const body = document.getElementById('menu-body'), html = body.innerHTML;
              return { sec: /The armies of the season/.test(html), list: body.querySelectorAll('.s2-list li').length, btn: !!body.querySelector('[data-s2="map"]'), wide: [...body.querySelectorAll('.s2-list li, [data-s2]')].every((e) => e.getBoundingClientRect().right <= body.getBoundingClientRect().right + 2), field: H.season2.S2.fieldNear };
            })()""")
            check(r['sec'] and r['list'] >= 1 and r['btn'] and r['wide'], f"the Season page's section with the armies and the map's button ({r})")
            check(r['field'], 'a field note waits for an army of the season near')
            r = await ev(page, r"""(() => { const H = __hm; document.querySelector('[data-s2="map"]').click(); return { modal: H.UI.modal, open: !document.getElementById('mapov').hidden }; })()""")
            check(r['modal'] == 'map' and r['open'], f"its button opens the map ({r})")

        if want('shots') and not NOSHOTS:
            print('SHOTS', flush=True)
            await ev(page, "(() => { const H = __hm; H.fn.toggleMap(false); H.UI.modal = null; return 0; })()")
            await b.close()
            b, page, logs2 = await setup(p, w=960, h=540)
            logs += logs2
            await ev(page, "(() => { __hm.start({ realm: 0, cls: 'warrior', level: 30 }); __hm.UI.modal = null; return 0; })()")
            await ev(page, HELP)
            await ev(page, r"""(() => { const H = __hm, S = H.season; H.fn.setQuality('medium'); S.away(8 * 86400); __s2.town(); H.simulate(2); const RS = __s2.rs(); RS.armies.length = 0; __s2.calm(); RS.realms[2].lev = 40; RS.realms[2].aim = 0; S.realmSimOrder(RS, 2, { type: 'muster' }, { name: 'test', rank: 9 }); __s2.keepNear(0, 70); __s2.step(3); return 0; })()""")
            # the band marching in, seen from behind the player toward it
            await ev(page, r"""(() => { const H = __hm, fn = H.fn, P = H.GAME.player; for (let i = 0; i < 20; i++) H.simulate(1); const B = [...H.season2.S2.bands.values()][0], L = fn.wbLeader(B.wb); const y = Math.atan2(L.x - P.x, L.z - P.z); H.look(y + Math.PI, 0.18, 9); H.setTod(0.42); for (let i = 0; i < 4; i++) H.frame(); return 0; })()""")
            await page.screenshot(path=str(OUT / 'season2_band.png'), timeout=300000)
            await ev(page, "(() => { __hm.fn.toggleMap(true); return 0; })()")
            await page.screenshot(path=str(OUT / 'season2_map.png'), timeout=300000)
            print('  shots: season2_band.png season2_map.png', flush=True)

        errs = await ev(page, "__hm.errors.slice(0, 5)")
        check(not errs and not [l for l in logs if 'pageerror' in l], f"no runtime errors ({errs} {logs[:3]})")
        await b.close()
    print(f"{'all passed' if not FAILS else str(len(FAILS)) + ' failed'} ({round(time.time() - T0)} s)", flush=True)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
