"""The campaign: readable orders, the player's commands, victory and the reset.
Simulates the war in chunks and prints the orders, the standing and the countdowns until a realm wins and the
campaign resets; checks that orders are drawn on the map (screenshot), issues player orders and checks the
warband follows them, and screenshots the HUD panel and the victory screen. Screenshots go to tools/out/war_*.
usage: python3 tools/tests/war.py [low|medium|high] [phone] [final] [noshots]   (final: 960 x 540 screenshots)"""
import json, asyncio, sys, pathlib, time
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
SHOTS = 'noshots' not in ARGS
PHONE = 'phone' in ARGS
QUALITY = next((a for a in ARGS if a in ('low', 'medium', 'high')), 'low')
FAILS = []
T0 = time.time()

def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

async def ev(page, js):
    return await page.evaluate(js)

async def frames(page, n=1):
    for _ in range(n): await ev(page, "__hm.frame(1/30)")

async def shot(page, name, clip=None):
    if not SHOTS: return
    await frames(page, 1)
    await page.screenshot(path=OUT + name + '.png', timeout=300000, clip=clip)
    print(f'  shot {name} ({time.time() - T0:.0f}s)', flush=True)

STATE = "__hm.CW.state()"

MEDIAN = "const med = (wb, x, z) => { const d = __hm.fn.wbMembers(wb).map((m) => Math.hypot(m.x - x, m.z - z)).sort((a, b) => a - b); return d.length ? d[d.length >> 1] : 1e9; };"

async def chunk(page, sec):
    """simulate and report what the commanders did"""
    return await ev(page, f"""(() => {{
      const n0 = __hm.WAR.news.length, t0 = __hm.GAME.t;
      const s = __hm.simulate({sec});
      const c = __hm.CW.state();
      const news = __hm.WAR.news.filter((n) => n.t > t0).map((n) => Math.round(n.t) + ' ' + n.text);
      // three realms gathered at one keep (each with a band within 45 m of it)
      let three = 0;
      for (const K of __hm.WAR.keeps) {{
        const at = new Set(__hm.WAR.warbands.filter((w) => !w.dead).map((w) => [w, __hm.fn.wbLeader(w)]).filter(([w, L]) => L && Math.hypot(L.x - K.site.x, L.z - K.site.z) < 45).map(([w]) => w.realm));
        if (at.size === 3) three++;
      }}
      return {{ t: s.t, bad: s.nonFinite, errors: s.errors.length, c, bands: __hm.CW.bands().map((b) => `${{b.name}}: ${{b.order}} ${{b.what}} (${{b.why || '-'}}, ${{b.phase || '-'}}, ${{b.n}})`), news, three }};
    }})()""")

async def main(p):
    w, h = (390, 780) if PHONE else (960, 540) if 'final' in ARGS else (640, 360)
    print(f'war test, {QUALITY} quality, {w} x {h}{" touch" if PHONE else ""}', flush=True)
    b, page, logs = await setup(p, touch=PHONE, w=w, h=h)
    page.set_default_timeout(300000)
    await page.emulate_media(reduced_motion='reduce')  # screens appear at once, for steady screenshots
    await ev(page, f"__hm.fn.setQuality('{QUALITY}')")
    # a cheaper 3D view behind the interface being tested: the world renders at half resolution
    await ev(page, "(() => { __hm.quality.scale = 0.5; dispatchEvent(new Event('resize')); })()")
    await ev(page, "__hm.start({realm: 0, cls: 'warrior', level: 20})")
    await ev(page, "__hm.UI.modal = null; document.querySelectorAll('.overlay').forEach((o) => { if (o.id !== 'hud') o.hidden = true; })")
    # to the muster, on the frontier, where a rally can reach
    await ev(page, "(() => { const M = __hm.REALMS[0].musterSite; __hm.teleport(M.x + 4, M.z - 26); })()")
    check(await ev(page, "__hm.CW.cwCanCommand()"), 'a level 20 character may command')

    # ---- the commanders give orders, for reasons, in words ----
    r = await chunk(page, 90)
    orders = [n for n in r['news'] if 'Warband' in n]
    for n in orders[:8]: print('   ', n)
    check(len(orders) >= 4, f'commanders announce their orders in the news ({len(orders)} in 90 s)')
    check(all(' to ' in n or ' while ' in n or ' at ' in n or 'carries' in n or 'rides' in n for n in orders if 'marches on' in n), 'every march says why')
    named = await ev(page, "__hm.CW.bands().filter((b) => b.name.match(/(First|Second|Third|Fourth|Fifth) Warband/)).length")
    nb = await ev(page, "__hm.CW.bands().length")
    check(named == nb and nb >= 3, f'every band has a name ({named} of {nb})')
    log = await ev(page, "[...document.querySelectorAll('#log div')].map((d) => d.textContent).filter((t) => t.includes('Warband')).length")
    check(log >= 3, f'the orders reach the log ({log} lines)')

    # ---- the HUD panel ----
    await ev(page, "__hm.CAM.mode = 'play'; __hm.look(2.4, 0.42, 12)")
    await frames(page, 3)
    hud = await ev(page, "__hm.CW.hud()")
    check(bool(hud) and 'Campaign 1' in hud, f'the war panel shows the campaign ({hud})')
    await shot(page, 'war_hud_start')

    # ---- the map: routes, badges and the side panel ----
    my = await ev(page, "__hm.CW.bands(0)")
    check(len(my) >= 1, f'Logres has warbands in the field ({len(my)})')
    wb = my[0]
    await ev(page, f"__hm.fn.toggleMap(true); __hm.CW.CWUI.sel = {wb['id']}; __hm.fn.toggleMap(false); __hm.fn.toggleMap(true)")
    side = await ev(page, "document.querySelector('#mapside .cw-side') && document.querySelector('#mapside .cw-side').textContent")
    check(bool(side) and 'Warbands of Logres' in side and 'Orders for the' in side, 'the map lists our warbands and the orders for the chosen one')
    btns = await ev(page, "document.querySelectorAll('#mapside .cw-cmd').length")
    check(btns >= 5, f'order buttons: attack, defend, raid and rally ({btns})')
    # the routes are drawn: sample the map canvas around the chosen band's leader for its realm's colour
    drawn = await ev(page, """(() => {
      const cv = document.getElementById('mapcanvas'), ctx = cv.getContext('2d'), S = cv.width;
      const wb = __hm.WAR.warbands.find((w) => w.id === __hm.CW.CWUI.sel), L = __hm.fn.wbLeader(wb);
      const x = ((L.x + 400) / 800) * S, y = ((L.z + 400) / 800) * S;
      const d = ctx.getImageData(Math.max(0, x - 40), Math.max(0, y - 40), 80, 80).data;
      let gold = 0; for (let i = 0; i < d.length; i += 4) if (d[i] > 230 && d[i + 1] > 210 && d[i + 2] > 140 && d[i + 2] < 200) gold++;
      return gold;
    })()""")
    check(drawn > 20, f"the chosen band's route is drawn on the map ({drawn} highlighted pixels)")
    await shot(page, 'war_map')

    # ---- a player order: attack a keep, and the band goes there ----
    tgt = await ev(page, "(() => { const wb = __hm.WAR.warbands.find((w) => w.id === __hm.CW.CWUI.sel); const L = __hm.fn.wbLeader(wb); const ks = __hm.WAR.keeps.filter((K) => K.realm !== 0).sort((a, b) => Math.hypot(b.site.x - L.x, b.site.z - L.z) - Math.hypot(a.site.x - L.x, a.site.z - L.z)); return ks[ks.length - 1].id; })()")
    # click the keep on the map canvas, as a player would
    pt = await ev(page, f"(() => {{ const K = __hm.WAR.keeps[{tgt}]; const cv = document.getElementById('mapcanvas'), r = cv.getBoundingClientRect(); return [r.left + ((K.site.x + 400) / 800) * r.width, r.top + ((K.site.z + 400) / 800) * r.height]; }})()")
    await page.mouse.click(pt[0], pt[1])
    o = await ev(page, f"(() => {{ const wb = __hm.WAR.warbands.find((w) => w.id === {wb['id']}); return wb && wb.order ? {{ type: wb.order.type, keep: wb.order.keep ? wb.order.keep.id : null, mine: !!wb.order.byPlayer, msg: __hm.CW.CWUI.msg }} : null; }})()")
    check(o and o['type'] == 'attack' and o['keep'] == tgt and o['mine'], f'clicking an enemy keep on the map orders the chosen band to attack it ({o})')
    d0 = await ev(page, f"(() => {{ {MEDIAN} const wb = __hm.WAR.warbands.find((w) => w.id === {wb['id']}); const K = __hm.WAR.keeps[{tgt}]; return med(wb, K.site.x, K.site.z); }})()")
    await ev(page, "__hm.fn.toggleMap(false)")
    await ev(page, "__hm.simulate(45)")
    r2 = await ev(page, f"(() => {{ {MEDIAN} const wb = __hm.WAR.warbands.find((w) => w.id === {wb['id']}); if (!wb || wb.dead) return null; const K = __hm.WAR.keeps[{tgt}]; return {{ d: med(wb, K.site.x, K.site.z), type: wb.order && wb.order.type, mine: !!(wb.order && wb.order.byPlayer), phase: wb.order && wb.order.phase }}; }})()")
    check(r2 is not None and (r2['d'] < d0 - 30 or r2['d'] < 40) and (r2['type'] == 'attack' and r2['mine'] or r2['d'] < 40), f'the band marches on the keep and holds the order (from {d0:.0f} m to {r2 and r2["d"]:.0f} m, {r2})')
    said = await ev(page, "__hm.WAR.news.slice(-40).some((n) => n.text.includes('at your command'))")
    check(said, 'the order is cried as given at your command')

    # ---- rally to me ----
    my = await ev(page, "__hm.CW.bands(0)")
    rb = next((x for x in my if not x['mine']), my[0])
    msg = await ev(page, f"__hm.CW.playerOrder({rb['id']}, 'rally', -1)")
    print('   ', msg)
    d0 = await ev(page, f"(() => {{ {MEDIAN} const wb = __hm.WAR.warbands.find((w) => w.id === {rb['id']}); const P = __hm.GAME.player; return med(wb, P.x, P.z); }})()")
    await ev(page, "__hm.simulate(50)")
    r3 = await ev(page, f"(() => {{ {MEDIAN} const wb = __hm.WAR.warbands.find((w) => w.id === {rb['id']}); if (!wb || wb.dead) return null; const P = __hm.GAME.player; return {{ d: med(wb, P.x, P.z), type: wb.order && wb.order.type }}; }})()")
    check(r3 is not None and r3['type'] == 'rally' and (r3['d'] < d0 - 25 or r3['d'] < 20), f'a rallied band comes to the player (from {d0:.0f} m to {r3 and r3["d"]:.0f} m, the median soldier)')
    if r3 and r3['d'] < 30:
        await ev(page, "__hm.CAM.mode = 'play'; __hm.look(0.6, 0.35, 16)")
        await frames(page, 3)
        plate = await ev(page, "[...document.querySelectorAll('.np .cw-o')].filter((e) => e.style.display !== 'none' && e.closest('.np').style.display !== 'none').map((e) => e.textContent)")
        check(any('Rally' in t for t in plate), f"the captain's nameplate shows the order ({plate[:3]})")
        await shot(page, 'war_rally')
    rel = await ev(page, f"__hm.CW.playerOrder({rb['id']}, 'release', -1)")
    o = await ev(page, f"(() => {{ __hm.simulate(6); const wb = __hm.WAR.warbands.find((w) => w.id === {rb['id']}); return wb && wb.order ? {{ type: wb.order.type, mine: !!wb.order.byPlayer }} : null; }})()")
    check(o is not None and not o['mine'], f'handed back, the commander gives the band its own order again ({rel}; {o})')

    # ---- the long war, until a realm wins ----
    print('the campaign:', flush=True)
    won = None
    three_total = 0
    samples = 0
    for i in range(40):
        r = await chunk(page, 120)
        c = r['c']
        three_total += r['three']; samples += 1
        claims = ' '.join(f"{n}:{cl['k']}/{cl['h']}{'*' if cl['kOn'] or cl['hOn'] else ''}" for n, cl in zip('LET', c['claims']))
        print(f"  {c['el'] // 60:3d} min  keeps {c['keeps']}  hallows {c['hallows']}  renown {c['renown']}  claims {claims}  captures {c['story']['captures']}  three-way {r['three']}", flush=True)
        for n in [x for x in r['news'] if 'Warband' not in x][-5:]: print('       ', n)
        for n in [x for x in r['news'] if 'Warband' in x][-3:]: print('       ', n)
        check(r['bad'] == 0 and r['errors'] == 0, f'no errors or non-finite positions at {c["el"] // 60} min') if (r['bad'] or r['errors']) else None
        if c['state'] == 'peace' or c['history'] >= 1:
            won = c
            break
    check(won is not None, f'a realm wins the campaign ({won and won["how"]}, after {won and won["el"] // 60} minutes)')
    check(three_total <= samples // 4, f'three realms rarely meet at one keep ({three_total} of {samples} samples)')
    if won is None:
        await b.close(); return
    # the victory screen appears once no window is open
    await ev(page, "__hm.fn.toggleMap(false); __hm.UI.modal = null")
    await frames(page, 2)
    vic = await ev(page, "(() => { const o = document.getElementById('cw-victory'); return o && !o.hidden ? o.textContent : null; })()")
    check(bool(vic) and 'wins the March' in vic and 'Your part' in vic, "the victory screen tells the campaign's story")
    banner = await ev(page, "__hm.WAR.news.slice(-30).some((n) => /has won the .* campaign/.test(n.text))")
    check(banner, 'the victory is cried in the news')
    await shot(page, 'war_victory')
    reward = await ev(page, "(() => { const h = __hm.CW.CAMPAIGN.history[__hm.CW.CAMPAIGN.history.length - 1]; return { w: h.w, reward: h.reward || null, you: h.you }; })()")
    if reward['w'] == 0: check(reward['reward'] and reward['reward']['rp'] > 0, f"the winning realm's player is rewarded ({reward['reward']})")
    else: print(f"    (Logres did not win: no reward, as it should be: {reward['reward']})")
    await page.click('#cw-victory [data-cw="ok"]')
    check(await ev(page, "__hm.UI.modal") is None, 'Onward closes the victory screen')
    # the peace: bands go home; HUD shows the countdown
    st = await ev(page, "__hm.CW.bands().map((b) => b.order)")
    check(all(o in ('Withdraw', 'Retrieve', 'Carry') for o in st), f'in the peace every band turns for home ({set(st)})')
    await frames(page, 2)
    await ev(page, "(() => { for (let i = 0; i < 16; i++) __hm.frame(1/30); })()")
    hud = await ev(page, "__hm.CW.hud()")
    check('won the March' in hud, f'the HUD shows the peace ({hud})')
    await shot(page, 'war_hud_peace')
    # the reset
    await ev(page, "__hm.simulate(__hm.CW.CW.PEACE + 5)")
    c = await ev(page, STATE)
    home = await ev(page, "__hm.WAR.keeps.every((K) => K.realm === K.orig) && __hm.WAR.relics.every((r) => r.state === 'temple' && r.at === r.realm)")
    check(c['n'] == 2 and c['state'] == 'war' and home, f'after the peace the March resets: campaign {c["n"]}, keeps and hallows home ({home})')
    # saving: the record goes with the world, and old saves still load
    sv = await ev(page, "(() => { const s = __hm.fn.buildSave(); return s.world.campaign; })()")
    check(sv and sv['n'] == 2 and len(sv['hist']) == 1, f'the world save keeps the campaign record ({sv and len(sv["hist"])} past campaigns)')
    rt = await ev(page, "(() => { const d = __hm.CW.campaignSaveData(); __hm.CW.applyCampaignSave(JSON.parse(JSON.stringify(d))); __hm.CW.applyCampaignSave(undefined); __hm.CW.applyCampaignSave({ n: 'x', hist: [{ w: 9 }, null] }); return __hm.CW.CAMPAIGN.n; })()")
    check(rt >= 1, 'a missing or broken campaign record loads safely')
    errs = await ev(page, "__hm.errors.slice(0, 5)")
    check(not errs, f'no runtime errors ({errs})')
    for l in logs[:5]: print('  page:', l[:300])
    await b.close()

async def run():
    async with async_playwright() as p:
        await main(p)
    print(f'\n{len(FAILS)} failed' if FAILS else '\nall passed', f'({time.time() - T0:.0f}s)')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(run())
