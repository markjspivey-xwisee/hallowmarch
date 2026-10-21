"""[net] The March shared (version 19): two or three pages of one browser in one room (the stand-in for the artifact's
room, db and user over a BroadcastChannel: src/00n_netstub.js), then the server (server/) with two clients.
Room (`room`): each page sees the others as bodies (realm, calling, level, name, look) moving where they move, with their
gaits and actions; a party (invite, answer, the party's frames, the map); chat (realm and party, a line with markup
shown as text, a realm's chat not heard by another realm); a fight between two players of different realms (the blow
settled by the struck page, the striker shown what landed, a kill told and paid); the shared war (a host, its keeps'
owners on every page, a follower's own capture told to the host); a page that joins late; the host leaving (the next
takes over, its body gone); the sizes and rates on the wire. `lossy` runs the stand-in with latency, jitter and drops.
`phone` takes the Players sheet and the party by touch on a phone's screen. `shots` takes pictures (960x540).
Server (`server`): starts server/server.js on a free port and two clients: a Node client (tools/tests/net_client.mjs) and
a page with ?server=: accounts (guest token, saved and presented again), the save held by the server, the presence relay
with interest management, a hit too far refused, a speed jump not relayed, the shared world persisted.
[companies] (`companies`): a local server and two pages (a desk's and a phone's, by taps) and headless players: an
account named from the sheet, a name refused, a company founded with its device and tinctures, a guest refused, an
invitation to a player who is away taken on her return (by a tap), the company's chat kept for her, a pledge counted
from the Season page's goods, the company's name on a member's nameplate and frame to the others, a muster forming one
party, the captain removing a member, the server stopped and started (the company read back, the pages linked again).
usage: python3 tools/tests/net.py [room] [three] [lossy] [phone] [server] [companies] [shots] [w=640 h=360]"""
import asyncio, json, sys, pathlib, time, os, random, subprocess, socket
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import human_play
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
KV = dict(a.split('=', 1) for a in ARGS if '=' in a)
PARTS = [a for a in ARGS if a in ('room', 'server', 'phone', 'perf', 'season', 'deployed', 'companies', 'weather')] or ['room']
THREE = 'three' in ARGS
LOSSY = 'lossy' in ARGS
SHOTS = 'shots' in ARGS
QUICK = 'quick' in ARGS  # perf: the picture only, no measures
W, H = int(KV.get('w', 960 if SHOTS else 640)), int(KV.get('h', 540 if SHOTS else 360))
OUT = hm.OUT
FAILS = []
T0 = time.time()

def check(ok, msg):
    print(('  ok   ' if ok else '  FAIL ') + msg, flush=True)
    if not ok: FAILS.append(msg)

def log(*a):
    print(f'[{time.time() - T0:6.1f}s]', *a, flush=True)

HOLD = """(() => { if (window.__rafWrapped) { window.__rafHold = true; return 0; } window.__rafWrapped = true; window.__rafHold = true; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); return 0; })()"""

# helpers in each page
HELP = r"""
window.NT = {
  H: window.__hm, get P() { return this.H.GAME.player; },
  calm(r = 140) { const H = this.H, P = this.P; for (const e of H.ENT) if (e !== P && e.role !== 'remote' && e.alive && e.kind !== 'door' && !e.siegeEngine && e.role !== 'villager' && e.role !== 'herald' && e.role !== 'merchant' && Math.hypot(e.x - P.x, e.z - P.z) < r) { e.alive = false; e.removeAt = H.GAME.t; } P.hp = P.maxHp; P.buffs.length = 0; P.casting = null; P.combatUntil = 0; return 0; },
  st() { return this.H.net.state(); },
  peerOf(name) { const s = this.H.net.state(); const p = s.peers.find((x) => x.name.startsWith(name)); return p ? p.peer : ''; },
  ghostOf(name) { const pe = this.peerOf(name); return pe ? this.H.net.ghost(pe) : null; },
  me() { const P = this.P; return { x: P.x, y: P.y, z: P.z, hp: P.hp, max: P.maxHp, alive: P.alive, rp: this.H.GAME.prog.rp, realm: P.faction, name: P.name }; },
  logHas(t) { return [...document.querySelectorAll('#log > div')].some((d) => d.textContent.includes(t)); },
  logLast(n = 6) { return [...document.querySelectorAll('#log > div')].slice(-n).map((d) => d.textContent); },
};
0"""

async def boot(ctx, cfg, name):
    page = await ctx.new_page()
    # Each multiplayer fixture page represents a different person's foreground
    # browser. Keep that focus model local to these pages; trusted input is still
    # required, and idle/diagnostic clients receive no automatic live lease.
    page._hm_human_focus = await ctx.new_cdp_session(page)
    await page._hm_human_focus.send('Emulation.setFocusEmulationEnabled', {'enabled': True})
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else (print('   ', name, m.text, flush=True) if m.text.startswith('NETLOG') else None))
    await page.add_init_script(f'window.__HM_NET = {json.dumps(cfg)};')
    three = hm.THREE_LOCAL.read_text()
    async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
    await page.route(hm.THREE_URL, three_route)
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    await page.route('https://fonts.googleapis.com/**', font_route)
    await page.route('https://fonts.gstatic.com/**', font_route)
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
    await page.route('http://hm.test/**', doc_route)
    await page.goto('http://hm.test/' + cfg.get('q', ''), wait_until='commit')
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
    await page.evaluate("__hm.fn.setQuality('low')")
    await page.evaluate(HOLD)
    await page.evaluate(HELP)
    log('booted', name)
    page._logs = logs
    page._name = name
    return page

async def start(page, realm, cls, level, name, x=None, z=None):
    await page.evaluate(f"""(() => {{ __hm.start({{ realm: {realm}, cls: '{cls}', level: {level}, name: '{name}' }}); __hm.UI.modal = null; for (const id of ['prologue', 'menu', 'dialog']) {{ const el = document.getElementById(id); if (el) el.hidden = true; }} return 0; }})()""")
    await human_play(page)
    if x is not None: await page.evaluate(f'__hm.teleport({x}, {z}); NT.calm(); 0')

async def step(pages, sec=0.1, n=1, frame=False):
    """each page a step at a time, in turn: the room's messages pass between the evaluates as in play"""
    for _ in range(n):
        for p in pages:
            await human_play(p)
            await p.evaluate(f'__hm.simulate({sec}); {"__hm.frame(" + str(sec) + ");" if frame else ""} 0')
        await asyncio.sleep(0.02)

async def until(pages, js_page, js, limit=20.0, sec=0.1):
    """step every page until js is true on js_page, or the limit (game seconds) runs out"""
    t = 0.0
    while t < limit:
        if await js_page.evaluate(js): return True
        await step(pages, sec)
        t += sec
    return bool(await js_page.evaluate(js))

async def shot(page, name):
    await human_play(page)
    await page.evaluate('__hm.UI.modal = __hm.UI.modal; __hm.frame(1/30); __hm.frame(1/30); 0')
    path = OUT / f'net_{name}.png'
    await page.screenshot(path=str(path), timeout=300000)
    log('saved', path)

async def room_part(p):
    rid = 'net-' + ''.join(random.choice('abcdefghijk') for _ in range(6))
    lossy = {'latency': 60, 'jitter': 40, 'drop': 0.05} if LOSSY else {}
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': W, 'height': H})
    A, B = await asyncio.gather(boot(ctx, {'room': rid, 'user': 'uAldwin', **lossy}, 'A'), boot(ctx, {'room': rid, 'user': 'uBrisa', **lossy}, 'B'))
    pages = [A, B]
    # A and B: Logres, side by side in Brackenford's plaza
    town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
    tx, tz = town
    await start(A, 0, 'warrior', 30, 'Aldwin', tx + 4, tz + 10)
    await start(B, 0, 'mage', 30, 'Brisa', tx - 4, tz + 10)
    log('started A and B')
    # the room: each sees the other
    ok = await until(pages, B, "NT.st().state === 'on' && NT.st().peers.some((p) => p.on && p.ghost)", 30)
    check(ok, 'B is in the room and has A as a body')
    ok = await until(pages, A, "NT.st().peers.some((p) => p.on && p.ghost)", 15)
    check(ok, 'A has B as a body')
    sA = await A.evaluate('NT.st()'); sB = await B.evaluate('NT.st()')
    gA = next((x for x in sB['peers'] if x['name'].startswith('Aldwin')), None)
    check(gA is not None and gA['realm'] == 0 and gA['cls'] == 'warrior' and gA['level'] == 30, f'B sees Aldwin: Logres warrior of 30 ({gA and (gA["realm"], gA["cls"], gA["level"])})')
    look = await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); const P2 = NT.P; return g ? { mask: g.look.mask, tab: g.look.tabard.map((v) => +v.toFixed(2)), scale: g.look.scale, kind: g.kind, role: g.role } : null; })()")
    lookA = await A.evaluate("(() => { const L = NT.P.look; return { mask: L.mask, tab: L.tabard.map((v) => +v.toFixed(2)), scale: L.scale }; })()")
    check(look and look['mask'] == lookA['mask'] and look['tab'] == lookA['tab'], f'his look is his own (mask {look and look["mask"]} vs {lookA["mask"]})')
    check(sA['isHost'] != sB['isHost'], f'one host: A {sA["isHost"]}, B {sB["isHost"]}')
    # A walks: B's body of A follows
    await A.evaluate("NT.P.yaw = 0; __hm.CAM.yaw = 0; __hm.INPUT.keys.add('KeyW'); 0")
    errs = []; amts = []
    for i in range(30):
        await step(pages, 0.1)
        if i > 6:
            a = await A.evaluate('NT.me()')
            g = await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); return g ? { x: g.x, z: g.z, amt: g.anim.amt, ph: g.anim.phase } : null; })()")
            if g: errs.append(((a['x'] - g['x']) ** 2 + (a['z'] - g['z']) ** 2) ** 0.5); amts.append(g['amt'])
    await A.evaluate("__hm.INPUT.keys.delete('KeyW'); 0")
    await step(pages, 0.1, 8)
    a = await A.evaluate('NT.me()'); g = await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); return g ? { x: g.x, z: g.z, amt: g.anim.amt } : null; })()")
    rest = ((a['x'] - g['x']) ** 2 + (a['z'] - g['z']) ** 2) ** 0.5 if g else 99
    med = sorted(errs)[len(errs) // 2] if errs else 99
    # drawn 120 ms behind the sender, a step of the test's or two late (the room's delivery comes between the evaluates),
    # and with the lossy room's 60 ms and its jitter a step more: at 7 m/s of the test's game time a step is 0.7 m
    lim = 3.6 if LOSSY else 2.5
    check(med < lim, f'A walking: B draws him within {med:.2f} m (median, under {lim}; the most {max(errs) if errs else 99:.2f} m; the delay is about two steps)')
    check(amts and max(amts) > 0.6, f'his legs walk (gait amount up to {max(amts) if amts else 0:.2f})')
    check(rest < 0.6, f'stopped, he stands where he stands ({rest:.2f} m)')
    # an action seen: A strikes, B sees the act
    acts = []
    await A.evaluate("__hm.fn.setAct(NT.P, 1, 0.8); 0") if False else await A.evaluate("NT.P.anim.act = 1; NT.P.anim.actT = 0; NT.P.anim.actDur = 1.2; 0")
    for i in range(10):
        await step(pages, 0.1)
        acts.append(await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); return g ? g.netAct : -1; })()"))
    check(any(1 <= x < 2 for x in acts), f'his strike is drawn on B (act values {[round(x, 2) for x in acts[:6]]})')
    # mounted
    await A.evaluate("__hm.fn.mountUp(NT.P, true); 0")
    ok = await until(pages, B, "(() => { const g = NT.ghostOf('Aldwin'); return !!(g && g.mount); })()", 6)
    check(ok, 'mounted on A, he rides on B')
    await A.evaluate("__hm.fn.dismount(NT.P); 0")
    ok = await until(pages, B, "(() => { const g = NT.ghostOf('Aldwin'); return !!(g && !g.mount); })()", 6)
    check(ok, 'and off again')
    # chat: realm, with markup shown as text
    peerB = await A.evaluate("NT.peerOf('Brisa')")
    await A.evaluate("__hm.net.chat('r', 'Well met <b>Brisa</b> & all'); 0")
    ok = await until(pages, B, "NT.logHas('Aldwin: Well met <b>Brisa</b> & all')", 6)
    check(ok, "B hears A's realm chat, its markup as text")
    nb = await B.evaluate("document.querySelectorAll('#log b').length")
    check(nb == 0, f'no markup from a chat line in the log ({nb} <b>)')
    # party
    await A.evaluate(f"__hm.net.invite('{peerB}'); 0")
    ok = await until(pages, B, "NT.st().invites.length > 0", 6)
    check(ok, "B gets A's invite")
    peerA = await B.evaluate("NT.peerOf('Aldwin')")
    await B.evaluate(f"__hm.net.answer('{peerA}', true); 0")
    ok = await until(pages, A, "(() => { const s = NT.st(); return s.party && s.peers.some((p) => p.name.startsWith('Brisa') && p.party === s.party); })()", 8)
    check(ok, "B joins A's party (the same party on A's page)")
    await A.evaluate('__hm.frame(1/30); __hm.frame(1/30); 0')
    ok = await until(pages, A, "(__hm.frame(1/30), !document.getElementById('netparty').hidden && document.querySelectorAll('#netparty .net-pm').length === 1)", 4)
    check(ok, "A's party frames show Brisa")
    await B.evaluate("__hm.net.chat('p', 'On your left'); 0")
    ok = await until(pages, A, "NT.logHas('[Party] Brisa: On your left')", 6)
    check(ok, 'party chat heard')
    # the land: a tree A fells falls on B's page too, A's fire lands there
    ti = await A.evaluate("(() => { const P = NT.P; let best = -1, bd = 1e9; for (const t of __hm.fn.W.trees) { if (t.felled || t.state !== 'stand') continue; const d = Math.hypot(t.x - P.x, t.z - P.z); if (d < bd) { bd = d; best = t.i; } } const t = __hm.fn.W.trees[best]; __hm.teleport(t.x - 2.2, t.z); NT.calm(); return best; })()")
    await step(pages, 0.1, 12)
    l0 = (await B.evaluate('NT.st()'))['stats'].get('landIn', 0)
    await A.evaluate(f"(() => {{ const t = __hm.fn.W.trees[{ti}]; __hm.nature.fellTree(t, 1, 0, 30, true); __hm.net.land('fell', [{ti}, 1, 0]); __hm.fn.fireLandsAt(t.x + 3, t.y, t.z + 3, 1.5, NT.P); return 0; }})()")
    ok = await until(pages, B, f"(() => {{ const t = __hm.fn.W.trees[{ti}]; return !!t.felled; }})()", 6)
    l1 = (await B.evaluate('NT.st()'))['stats'].get('landIn', 0)
    check(ok and l1 - l0 >= 2, f"the tree A fells falls on B's page, and A's fire lands there (tree {ti}, {l1 - l0} changes of the land heard)")
    await A.evaluate(f"__hm.teleport({tx + 4}, {tz + 10}); NT.calm(); 0")
    await step(pages, 0.1, 6)
    # the sizes and the rates
    sA = await A.evaluate('NT.st()')
    check(sA['lastFastBytes'] < 3800 and sA['slowBytes'] < 3800, f"what A sends fits presence (fast {sA['lastFastBytes']} B, profile {sA['slowBytes']} B)")
    log('A stats', json.dumps(sA['stats']))
    if SHOTS:
        await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); const P = NT.P; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); __hm.CAM.yaw = P.yaw + 0.55; __hm.CAM.pitch = 0.2; __hm.CAM.dist = __hm.CAM.targetDist = 5; NT.P.target = g.id; return 0; })()")
        await A.evaluate("__hm.net.chat('r', 'For Logres!'); 0")
        await until(pages, B, "NT.logHas('For Logres!')", 4)
        await shot(B, 'room_ally')  # at once: the line over his head lasts 7 s of the wall clock, a few steps here
        await A.evaluate("__hm.net.sheet(true); 0")
        await shot(A, 'room_sheet')
        await A.evaluate("__hm.net.sheet(false); 0")
    # a third page, late: an Eriu archer, a foe
    if THREE:
        Cp = await boot(ctx, {'room': rid, 'user': 'uCaelan', **lossy}, 'C')
        pages.append(Cp)
        await start(Cp, 1, 'archer', 30, 'Caelan', tx + 4, tz + 18)
        ok = await until(pages, Cp, "NT.st().peers.filter((p) => p.on && p.ghost).length >= 2", 20)
        check(ok, 'C joins late and has both as bodies at once')
        ok = await until(pages, A, "!!NT.ghostOf('Caelan')", 10)
        check(ok, 'A has C as a body')
        isFoe = await A.evaluate("__hm.fn.isEnemy(NT.P, NT.ghostOf('Caelan'))")
        allyB = await A.evaluate("__hm.fn.isEnemy(NT.P, NT.ghostOf('Brisa'))")
        npcFoe = await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const s = __hm.ENT.find((e) => e.role === 'villager' || e.role === 'guard' || e.role === 'soldier'); return s ? __hm.fn.isEnemy(s, g) : null; })()")
        check(isFoe and not allyB and not npcFoe, f'C is a foe to A, B is not, and the March\'s own leave C alone ({isFoe}, {allyB}, {npcFoe})')
        ok = await until(pages, Cp, "!NT.logHas('Aldwin: Well met')", 1)
        await A.evaluate("__hm.net.chat('r', 'Logres only'); 0")
        await step(pages, 0.1, 8)
        heard = await Cp.evaluate("NT.logHas('Logres only')")
        check(not heard, "Logres' realm chat is not heard by Eriu")
        # the fight: A strikes C
        await until(pages, A, "!!NT.ghostOf('Caelan')", 15)
        c0 = await Cp.evaluate('NT.me()')
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); if (g) NT.P.target = g.id; NT.P.hp = NT.P.maxHp; return 0; })()")
        await Cp.evaluate("NT.P.target = null; 0")
        hits = []
        for i in range(30):
            await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; if (!g) return 0; P.x = g.x - 1.6; P.z = g.z; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); P.target = g.id; return 0; })()")
            await step(pages, 0.1)
            hits.append(await Cp.evaluate('NT.P.hp'))
        c1 = await Cp.evaluate('NT.me()')
        sA = await A.evaluate('NT.st()'); sC = await Cp.evaluate('NT.st()')
        check(c1['hp'] < c0['hp'], f"A's blows land on C's own page (health {c0['hp']:.0f} to {c1['hp']:.0f}; {sA['stats']['hitsOut']} sent, {sC['stats']['hitsLanded']} landed, {sC['stats']['hitsRefused']} refused)")
        ok = await until(pages, A, "NT.logHas('You hit Caelan')", 4)
        check(ok, 'A is shown what landed')
        gh = await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); return g ? g.hp : -1; })()")
        check(abs(gh - c1['hp']) < c1['max'] * 0.12 + 5, f"C's health on A's page follows his own ({gh:.0f} vs {c1['hp']:.0f})")
        # a blow from too far is refused
        await A.evaluate("(() => { const P = NT.P; P.x += 200; return 0; })()")
        await step(pages, 0.1, 3)
        r0 = (await Cp.evaluate('NT.st()'))['stats']['hitsRefused']
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); if (g) __hm.fn.dealDamage(NT.P, g, 50, { kind: 'melee' }); return 0; })()")
        await step(pages, 0.1, 6)
        r1 = (await Cp.evaluate('NT.st()'))['stats']['hitsRefused']
        check(r1 > r0, f'a blow from 200 m is refused by the struck page ({r0} to {r1})')
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; if (g) { P.x = g.x - 1.6; P.z = g.z; } return 0; })()")
        # an interrupt across the net: C draws out a long spell, A breaks it on his page, C's page breaks it
        cid = await Cp.evaluate("(() => { const A5 = __hm.bal5.ABILITIES, id = Object.keys(A5).find((k) => A5[k].cast >= 1) || 'firebolt'; NT.P.casting = { id, t: 0, total: 30 }; return id; })()")
        ok = await until(pages, A, "(() => { const g = NT.ghostOf('Caelan'); return !!(g && g.casting); })()", 4)
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); if (g) __hm.bal.breakCast(g); return 0; })()")
        ok2 = await until(pages, Cp, "!NT.P.casting", 4)
        bi = (await Cp.evaluate('NT.st()'))['stats'].get('breaksIn', 0)
        check(ok and ok2 and bi >= 1, f"C's spell ({cid}) seen on A's page, broken there and so on C's own ({ok}, {ok2}, {bi})")
        await Cp.evaluate("NT.P.casting = null; 0")
        # the kill: C low, A finishes him
        rp0 = (await A.evaluate('NT.me()'))['rp']
        await Cp.evaluate("NT.P.hp = Math.max(1, NT.P.maxHp * 0.04); 0")
        for i in range(40):
            await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; if (g) { P.x = g.x - 1.6; P.z = g.z; P.target = g.id; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); } return 0; })()")
            await step(pages, 0.1)
            if not (await Cp.evaluate('NT.P.alive')): break
        dead = await until(pages, Cp, '!NT.P.alive', 4)
        check(dead, 'C falls to A')
        ok = await until(pages, A, "(() => { const g = NT.ghostOf('Caelan'); return !!g && !g.alive; })()", 6)
        check(ok, "C's body falls on A's page")
        ok = await until(pages, A, "NT.st().stats.kills > 0", 6)
        rp1 = (await A.evaluate('NT.me()'))['rp']
        check(ok and rp1 > rp0, f'the kill is told to A and paid ({rp0} to {rp1} realm points)')
        by = await Cp.evaluate("document.getElementById('death-by').textContent")
        check('Aldwin' in by, f'C is told who slew him ({by})')
        if SHOTS: await shot(A, 'room_kill')
        await Cp.evaluate("document.getElementById('btn-release').click(); 0")
        await step(pages, 0.1, 10)
        ok = await until(pages, A, "(() => { const g = NT.ghostOf('Caelan'); return !g || g.alive; })()", 8)
        check(ok, 'released, C stands again (or is far away at his muster)')
    # the shared war: the host's keeps on every page
    host = A if (await A.evaluate('NT.st().isHost')) else B
    fol = B if host is A else A
    k0 = await fol.evaluate('__hm.WAR.keeps.map((K) => K.realm)')
    # a keep the host's war takes
    ki = await host.evaluate("__hm.WAR.keeps.findIndex((K) => K.realm !== 2)")
    await host.evaluate(f"__hm.fn.captureKeep(__hm.WAR.keeps[{ki}], 2, null); 0")
    ok = await until(pages, fol, f"__hm.WAR.keeps[{ki}].realm === 2", 10)
    check(ok, f"a keep the host's war takes is taken on the follower's page too (keep {ki})")
    # a follower's own capture: held, told to the host, taken there
    kj = await fol.evaluate(f"(() => {{ const r = NT.P.faction; return __hm.WAR.keeps.findIndex((K, i) => K.realm !== r && i !== {ki}); }})()")
    await fol.evaluate(f"(() => {{ const K = __hm.WAR.keeps[{kj}]; __hm.teleport(K.site.x + 30, K.site.z); NT.calm(20); return 0; }})()")
    await step(pages, 0.1, 12)
    await fol.evaluate(f"__hm.fn.captureKeep(__hm.WAR.keeps[{kj}], NT.P.faction, NT.P); 0")
    held = await fol.evaluate(f"__hm.WAR.keeps[{kj}].realm === NT.P.faction")
    check(not held, "the follower's capture is held for the host's word")
    ok = await until(pages, host, f"__hm.WAR.keeps[{kj}].realm === 0", 10)
    check(ok, 'the host takes it (the player stands there)')
    ok = await until(pages, fol, f"__hm.WAR.keeps[{kj}].realm === 0", 10)
    check(ok, "and it comes back to the follower's page as the host's word")
    # the host leaves: the next takes over, its body goes
    hostName = await host.evaluate('NT.P.name')
    await host.close()
    pages.remove(host)
    ok = await until(pages, fol, "NT.st().isHost", 12)
    check(ok, f'{hostName} leaves; the follower keeps the shared war now')
    ok = await until(pages, fol, f"!NT.ghostOf('{hostName}')", 6)
    check(ok, f"{hostName}'s body is gone")
    for pg in pages:
        errs = await pg.evaluate('__hm.errors.slice()')
        check(not errs, f'{pg._name}: no errors ({errs[:2]})')
        for l in pg._logs[-5:]: print('   ', pg._name, l[:300])
    await b.close()

class NodeClient:
    """A scripted human protocol actor; diagnostic clients stay inactive by default."""
    def __init__(self, name): self.name = name; self.lines = []; self.proc = None
    async def start(self, url, token=''):
        self.proc = await asyncio.create_subprocess_exec('node', str(pathlib.Path(__file__).parent / 'net_client.mjs'), url, token, stdin=asyncio.subprocess.PIPE, stdout=asyncio.subprocess.PIPE)
        asyncio.get_event_loop().create_task(self._read())
    async def _read(self):
        while True:
            l = await self.proc.stdout.readline()
            if not l: break
            try: self.lines.append(json.loads(l))
            except Exception: pass
    async def cmd(self, o):
        if o.get('cmd') == 'hello': o = {**o, 'human': True}
        self.proc.stdin.write((json.dumps(o) + '\n').encode()); await self.proc.stdin.drain()
    async def wait(self, key, limit=8.0):
        t = time.time()
        while time.time() - t < limit:
            for l in reversed(self.lines):
                if key in l: return l[key]
            await asyncio.sleep(0.1)
        return None
    async def state(self):
        n = len(self.lines)
        await self.cmd({'cmd': 'state'})
        t = time.time()
        while time.time() - t < 5:
            for l in self.lines[n:]:
                if 'state' in l: return l['state']
            await asyncio.sleep(0.05)
        return None
    async def quit(self):
        try: await self.cmd({'cmd': 'quit'}); await asyncio.wait_for(self.proc.wait(), 3)
        except Exception:
            try: self.proc.kill()
            except ProcessLookupError: pass

def free_port():
    s = socket.socket(); s.bind(('127.0.0.1', 0)); p = s.getsockname()[1]; s.close(); return p

async def server_part(p):
    import tempfile, urllib.request
    port = free_port(); data = tempfile.mkdtemp(prefix='net_srv_', dir=str(OUT))
    root = pathlib.Path(__file__).resolve().parents[2]
    srv = subprocess.Popen(['node', str(root / 'server' / 'server.js')], env={**os.environ, 'PORT': str(port), 'HM_DATA': data, 'HM_INTEREST': '300'}, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    url = f'ws://127.0.0.1:{port}/ws'
    stats = lambda: json.loads(urllib.request.urlopen(f'http://127.0.0.1:{port}/stats', timeout=5).read())
    try:
        for _ in range(60):
            try: urllib.request.urlopen(f'http://127.0.0.1:{port}/health', timeout=2); break
            except Exception: await asyncio.sleep(0.25)
        log('server up on', port)
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        cfg = {'room': 'srv', 'user': 'uSrvA', 'noRoom': True, 'server': url}
        A = await boot(ctx, cfg, 'A')
        town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
        tx, tz = town
        k0 = await A.evaluate("__hm.SAVE.server === true")
        check(k0, 'the page asked the server for its save at boot')
        await start(A, 0, 'priest', 30, 'Aldwin', tx + 4, tz + 10)
        ok = await until([A], A, "NT.st().state === 'on' && NT.st().kind === 'ws'", 10)
        check(ok, 'the page is linked to the server (ws)')
        me = await A.evaluate('NT.me()')
        N1 = NodeClient('N1'); await N1.start(url)
        await N1.cmd({'cmd': 'hello', 'name': 'Nodric', 'realm': 1, 'cls': 'warrior', 'x': me['x'] + 6, 'z': me['z']})
        w1 = await N1.wait('welcome')
        check(w1 and w1['acct']['guest'] and w1['token'], f"a guest account and a token for the headless player ({w1 and w1['acct']['id']})")
        ok = await until([A], A, "!!NT.ghostOf('Nodric')", 12)
        check(ok, "the page has the headless player as a body")
        for i in range(12):
            await N1.cmd({'cmd': 'move', 'x': me['x'] + 6 + i * 0.5, 'z': me['z']})
            await step([A], 0.1)
        g = await A.evaluate("(() => { const g = NT.ghostOf('Nodric'); return g ? [g.x, g.z, g.anim.amt] : null; })()")
        check(g and abs(g[0] - (me['x'] + 11.5)) < 2.5, f"he walks on the page ({g and round(g[0] - me['x'], 2)} m east, gait {g and round(g[2], 2)})")
        # the server measures a pace by its own clock, so the page walks at the pace of the wall clock here
        # (stepped faster than that, its run reads 70 m/s and the server rightly drops it)
        async def rt(n):
            for _ in range(n):
                t0 = time.time(); await step([A], 0.1)
                await asyncio.sleep(max(0.0, 0.1 - (time.time() - t0)))
        await A.evaluate("__hm.INPUT.keys.add('KeyW'); 0")
        await rt(10)
        s1 = await N1.state()
        aname = next((v['name'] for v in s1['peers'].values() if v['name']), '')
        check(aname == 'Aldwin' and s1['got']['fast'] > 3, f"the headless player hears the page ({aname}, {s1['got']['fast']} states)")
        # interest: a player far off hears the page only now and then
        N2 = NodeClient('N2'); await N2.start(url)
        far = await A.evaluate('(() => { const T = __hm.REALMS[2].town; return [T.x, T.z]; })()')
        await N2.cmd({'cmd': 'hello', 'name': 'Farwen', 'realm': 2, 'cls': 'mage', 'x': far[0], 'z': far[1]})
        await N2.wait('welcome')
        await asyncio.sleep(0.5)
        n1a = next((v['n'] for v in (await N1.state())['peers'].values() if v['name'] == 'Aldwin'), 0)
        n2a = next((v['n'] for v in (await N2.state())['peers'].values() if v['name'] == 'Aldwin'), 0)
        for i in range(40):
            await A.evaluate(f"NT.P.yaw = {i} * 0.15; __hm.CAM.yaw = NT.P.yaw; 0")
            await rt(1)
        await A.evaluate("__hm.INPUT.keys.delete('KeyW'); 0")
        s1 = await N1.state(); s2 = await N2.state()
        n1 = next((v['n'] for v in s1['peers'].values() if v['name'] == 'Aldwin'), 0) - n1a
        n2 = next((v['n'] for v in s2['peers'].values() if v['name'] == 'Aldwin'), 0) - n2a
        check(n1 >= 8 and n2 <= max(4, n1 // 4), f"interest: the near player had {n1} states of the page, the far one {n2} (for its map)")
        # a blow over the server: landed, told back
        apeer = await A.evaluate('NT.st().self')
        hp0 = await A.evaluate('NT.P.hp')
        await N1.cmd({'cmd': 'ev', 'kind': 'hit', 'to': apeer, 'data': {'a': 120, 'c': 0, 'k': 'melee', 'pi': 0, 'dt': 0, 'ab': '', 'ar': '', 'el': '', 'pet': 0}})
        ok = await until([A], A, f"NT.P.hp < {hp0} - 1", 6)
        check(ok, 'a blow from the headless player lands on the page')
        await asyncio.sleep(0.6); await step([A], 0.1, 3)
        s1 = await N1.state()
        check(any(e[1][1] == 'hr' for e in s1['evs']), 'and what landed is told back to it')
        # a blow from the muster (a jump the server allows) is dropped: no reach is that long
        mu = await A.evaluate('(() => { const M = __hm.REALMS[1].musterSite; return [M.x, M.z]; })()')
        await N1.cmd({'cmd': 'move', 'x': mu[0], 'z': mu[1]})
        await asyncio.sleep(0.4)
        hf0 = stats()['hitsFar']
        await N1.cmd({'cmd': 'ev', 'kind': 'hit', 'to': apeer, 'data': {'a': 120, 'c': 0, 'k': 'arrow', 'pi': 0, 'dt': 0, 'ab': '', 'ar': '', 'el': '', 'pet': 0}})
        await asyncio.sleep(0.6)
        check(stats()['hitsFar'] > hf0, 'a blow from 300 m is dropped by the server')
        # a pace no body runs: not relayed
        pd0 = stats()['paceDropped']
        await N1.cmd({'cmd': 'move', 'x': mu[0] + 150, 'z': mu[1] + 150})
        await asyncio.sleep(0.5)
        check(stats()['paceDropped'] > pd0, 'a jump of 200 m to nowhere is not relayed')
        # the save held by the server, and read back by a new page with the same browser (its token)
        await A.evaluate('__hm.fn.saveNow(); 0')
        await asyncio.sleep(1.5)
        st = stats()
        check(st['saves'] >= 1, f"the page's save is held by the server ({st['saves']} saves)")
        world = st['rooms'][0]['world'] if st['rooms'] else None
        check(world and len(world['k']) == 6, f"the shared war kept by the server ({world and world['k']})")
        await A.close()
        A2 = await boot(ctx, cfg, 'A2')
        nm = await A2.evaluate("(() => { const s = __hm.SAVE.loaded; return s && s.char ? s.char.name : ''; })()")
        check(nm == 'Aldwin', f'a new page in the same browser reads its save back from the server ({nm})')
        errs = await A2.evaluate('__hm.errors.slice()')
        check(not errs, f'no errors ({errs[:2]})')
        # accounts: the guest's account named from the Players sheet (it keeps its character), a wrong password refused,
        # and the account signed in from another browser (another device): the page loads again with that character
        await start(A2, 0, 'priest', 30, 'Aldwin', tx + 4, tz + 10)
        ok = await until([A2], A2, "NT.st().state === 'on' && NT.st().kind === 'ws'", 30)
        await A2.evaluate("__hm.net.sheet(true); 0")
        await until([A2], A2, "(__hm.frame(1/30), !!document.getElementById('netacct-name'))", 10)
        has = await A2.evaluate("!!document.getElementById('netacct-name') && !document.getElementById('netsheet-acct').hidden")
        check(ok and has, f'the Players sheet offers to name the account (linked {ok}, fields {has})')
        await A2.fill('#netacct-name', 'Aldwinsson'); await A2.fill('#netacct-pass', 'hallow-pass-1')
        await A2.evaluate("document.querySelector('#netsheet-acct button[data-act=\"acct-claim\"]').click(); 0")  # (a click by script: Playwright's waits for two still frames, which SwiftShader's load can starve)
        ok = await until([A2], A2, "document.querySelector('#netsheet-acct .net-msg').textContent.startsWith('Your account is')", 10)
        st = stats()
        check(ok and st['claims'] == 1, f"the guest's account is named Aldwinsson ({st['claims']} named)")
        await A2.evaluate('__hm.fn.saveNow(); 0'); await asyncio.sleep(1.5)
        await N1.cmd({'cmd': 'raw', 'm': {'t': 'acct', 'op': 'login', 'name': 'Aldwinsson', 'pass': 'wrong-pass'}})
        r = await N1.wait('acct')
        check(r and not r['ok'], f"a wrong password is refused ({r and r.get('why')})")
        ctx2 = await b.new_context(viewport={'width': W, 'height': H})
        A3 = await boot(ctx2, {**cfg, 'user': 'uSrvB'}, 'A3')
        await start(A3, 1, 'archer', 30, 'Strangely', tx + 6, tz + 10)
        ok = await until([A3], A3, "NT.st().state === 'on' && NT.st().kind === 'ws'", 30)
        await A3.evaluate("__hm.net.sheet(true); 0")
        ok = await until([A3], A3, "(__hm.frame(1/30), !!document.getElementById('netacct-name'))", 10) and ok
        check(ok, 'another browser, linked to the server, is offered to sign in')
        await A3.fill('#netacct-name', 'aldwinsson'); await A3.fill('#netacct-pass', 'hallow-pass-1')
        await A3.evaluate("document.querySelector('#netsheet-acct button[data-act=\"acct-login\"]').click(); 0")
        try:
            await A3.wait_for_event('load', timeout=60000)
            await A3.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
            await A3.evaluate(HOLD); await A3.evaluate(HELP)
            nm = await A3.evaluate("(() => { const s = __hm.SAVE.loaded; return s && s.char ? s.char.name : ''; })()")
        except Exception as e:
            nm = f'({e})'[:120]
        st = stats()
        check(nm == 'Aldwin' and st['logins'] >= 1, f'signed in from another browser, the page loads again with that character ({nm}; {st["logins"]} sign-ins)')
        errs = await A3.evaluate('__hm.errors.slice()')
        check(not errs, f'no errors ({errs[:2]})')
        await N1.quit(); await N2.quit()
        await b.close()
    finally:
        srv.terminate()
        try: print('server says:', srv.communicate(timeout=3)[0][-600:])
        except Exception: srv.kill()

def http_json(url, method='GET', headers=None):
    import urllib.request
    req = urllib.request.Request(url, method=method, headers=headers or {}, data=b'' if method == 'POST' else None)
    return json.loads(urllib.request.urlopen(req, timeout=15).read())

async def season_part(p):
    """[net] the season (server/season.js, 14q_netseason.js): a page of Ériu linked to a local server whose season runs
    600 times as fast, and a headless player of its realm"""
    import tempfile
    port = free_port(); data = tempfile.mkdtemp(prefix='net_season_', dir=str(OUT))
    root = pathlib.Path(__file__).resolve().parents[2]
    env = {**os.environ, 'PORT': str(port), 'HM_DATA': data, 'HM_SEASON_SPEED': '30', 'HM_SEASON_STEP': '500', 'HM_SEASON_PUSH': '1500', 'HM_ADMIN': 'net-test-key'}
    srv = subprocess.Popen(['node', str(root / 'server' / 'server.js')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    base = f'http://127.0.0.1:{port}'; url = f'ws://127.0.0.1:{port}/ws'
    try:
        for _ in range(60):
            try: http_json(base + '/health'); break
            except Exception: await asyncio.sleep(0.25)
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        tctx = await b.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True)  # the page of Ériu is a phone: its taps are taps
        A = await boot(tctx, {'room': 'srv', 'user': 'uSeasonA', 'noRoom': True, 'server': url}, 'A')
        town = await A.evaluate('(() => { const T = __hm.REALMS[1].town; return [T.x, T.z]; })()')
        await start(A, 1, 'archer', 30, 'Eithne', town[0] + 4, town[1] + 10)
        ok = await until([A], A, "!!__hm.netseason.NETS.s", 20)
        check(ok, 'the page is told the season by the server')
        if not ok:
            print(await A.evaluate("JSON.stringify({ st: NT.st().state, kind: NT.st().kind, ws: __hm.net.NETWS.state, stats: __hm.net.NETWS.stats, errs: __hm.errors.slice(0, 3), ns: __hm.netseason.NETS.stats })"))
            raise RuntimeError('no season')
        s0 = await A.evaluate("(() => { const s = __hm.netseason.NETS.s; return { day: s.day, phase: s.phase, st: s.st, keeps: s.keeps.map((K) => K.r) }; })()")
        log('season', json.dumps(s0))
        await A.evaluate('__hm.frame(1/30); 0')
        line = await A.evaluate("(() => { __hm.guide2.updateWarPanel(); const e = document.querySelector('#war .ns-line'); return e ? e.textContent : ''; })()")
        check('Season' in line and 'day' in line, f'the war panel tells the season ({line!r})')
        # a player of the realm comes while the page plays: on its roster
        N1 = NodeClient('N1'); await N1.start(url)
        await N1.cmd({'cmd': 'hello', 'name': 'Nuala', 'realm': 1, 'cls': 'priest', 'x': town[0] - 200, 'z': town[1]})
        ok = await until([A], A, "!!(__hm.netseason.NETS.roster && __hm.netseason.NETS.roster.list.some((x) => x.n === 'Nuala' && x.on))", 30)
        check(ok, 'another player of the realm on the roster, on now')
        await A.evaluate("__hm.net.sheet(true); 0")
        sh = await A.evaluate("document.getElementById('netsheet').textContent")
        check('Nuala' in sh and 'today' in sh and 'The season' in sh, f"the Players sheet tells the realm's roster today ({sh[sh.find('today') - 30:sh.find('today') + 60]!r})")
        await A.evaluate("__hm.net.sheet(false); 0")
        # the Season page: bring timber, vote for a work
        await A.evaluate("__hm.fn.goodsAdd('log', 30, true); __hm.fn.goodsAdd('grain', 50, true); __hm.LORE.openChronicle('season'); 0")
        await A.evaluate('__hm.frame(1/30); 0')
        has = await A.evaluate("(() => [...document.querySelectorAll('.chron [data-ns]')].map((b) => b.dataset.ns))()")
        check('give:timber' in has and 'give:food' in has and any(h.startswith('project:') for h in has), f'the Season page offers to bring goods and vote ({has[:6]})')
        c0 = http_json(base + '/stats')['contribs']
        await A.tap('.chron [data-ns="give:timber"]', timeout=60000)
        ok = await until([A], A, "__hm.netseason.NETS.stats.contribs >= 1 && !__hm.netseason.NETS.busy", 15)
        logs = await A.evaluate("__hm.fn.goodsCount('log')")
        said = await A.evaluate("JSON.stringify([__hm.netseason.NETS.said, __hm.netseason.NETS.stats, __hm.netseason.NETS.s.st])")
        check(ok and http_json(base + '/stats')['contribs'] > c0 and logs == 0, f'timber brought from the packs to the realm by a tap (logs left {logs}; {said})')
        await asyncio.sleep(1.0); await A.evaluate("__hm.LORE.openChronicle('season'); 0"); await asyncio.sleep(1.0)
        await A.tap('.chron [data-ns="project:walls"]', timeout=60000)
        ok = await until([A], A, "__hm.netseason.NETS.stats.orders >= 1 && !__hm.netseason.NETS.busy", 15)
        pub = http_json(base + '/stats')
        check(ok and pub['orders'] >= 1, f"a vote for a work by a tap ({pub['orders']} orders)")
        # a keep taken in the live war is taken in the season (the page keeps the shared war)
        host = await A.evaluate('NT.st().isHost')
        check(host, 'the page keeps the shared war')
        # (in the season's muster a keep taken in the field is a skirmish: the season is stepped into its war first)
        http_json(base + '/admin?op=step&s=' + str(8 * 86400), 'POST', {'x-hm-admin': 'net-test-key'})
        await A.evaluate("(() => { const K = __hm.WAR.keeps[0]; __hm.fn.captureKeep(K, 1, null); return 0; })()")
        ok = False
        for _ in range(40):
            await step([A], 0.25)
            if http_json(base + '/season')['keeps'][0]['r'] == 1: ok = True; break
        check(ok, 'a keep taken in the live war is taken in the season')
        # the season takes a keep (as its armies would): the live war follows
        r = http_json(base + '/admin?op=keep&i=5&r=1', 'POST', {'x-hm-admin': 'net-test-key'})
        ok = await until([A], A, "__hm.WAR.keeps[5].realm === 1", 30)
        check(ok, f"a keep the season takes is taken in the live war ({r.get('keeps')})")
        # and the live war's own is not taken back by the season's next word
        await A.evaluate("__hm.fn.captureKeep(__hm.WAR.keeps[2], 2, null); 0")
        await step([A], 0.25, 12)
        kk = await A.evaluate("__hm.WAR.keeps.map((K) => K.realm)")
        check(kk[2] == 2, f'the live war keeps its own capture ({kk})')
        bad = await A.evaluate("(() => { const n = __hm.netseason.NETS.stats.msgs; __hm.netseason.msg({ t: 'season', s: { day: 'x', keeps: [{ r: 7 }], news: [[1, 0, '<img src=x onerror=alert(1)>']], st: { food: 'lots' } } }); return [n, __hm.netseason.NETS.s.news.map((L) => L[2])]; })()")
        await A.evaluate("__hm.LORE.openChronicle('season'); 0")
        inj = await A.evaluate("!!document.querySelector('.chron img')")
        check(not inj, 'what the server says is set as text')
        # regions: a page of Thule at Logres' first keep keeps that region's word; the shard's host (A, at home) follows it
        B = await boot(ctx, {'room': 'srv', 'user': 'uSeasonB', 'noRoom': True, 'server': url}, 'B')
        kx, kz = await A.evaluate('(() => { const S = __hm.WAR.keeps[0].site; return [S.x * 0.8, S.z * 0.8]; })()')
        await start(B, 2, 'warrior', 30, 'Hakon', kx, kz)
        ok = await until([A, B], B, "!!(__hm.net.NET.regions && __hm.net.NET.regions.h.f0 === __hm.net.NET.self)", 30)
        rg = await B.evaluate("JSON.stringify(__hm.net.NET.regions)")
        check(ok, f'the page at the keep keeps its region ({rg})')
        ok = await until([A, B], A, "!!(__hm.net.NET.regions && __hm.net.NET.regions.h.f0 && __hm.net.NET.regions.h.f0 !== __hm.net.NET.self) && NT.st().isHost", 20)
        check(ok, 'the shard\'s host (away in its homeland) is told so')
        await B.evaluate("__hm.fn.captureKeep(__hm.WAR.keeps[0], 2, null); 0")
        ok = await until([A, B], A, "__hm.WAR.keeps[0].realm === 2", 30)
        check(ok, "the region's keeper takes the keep: the shard's host has it from the server")
        ok = False
        for _ in range(30):
            if http_json(base + '/season')['keeps'][0]['r'] == 2: ok = True; break
            await step([A, B], 0.25)
        check(ok, 'and the season has it')
        await A.evaluate("__hm.fn.captureKeep(__hm.WAR.keeps[0], 1, null); 0")
        await step([A, B], 0.25, 8)
        k0 = await A.evaluate("__hm.WAR.keeps[0].realm")
        check(k0 == 2, f'a page that does not keep the region holds a capture there for its keeper ({k0})')
        errsB = await B.evaluate('__hm.errors.slice()')
        check(not errsB, f'B: no errors ({errsB[:2]})')
        await B.close()
        if SHOTS or True:
            await A.evaluate("__hm.LORE.openChronicle('season'); __hm.frame(1/30); 0")
            await A.evaluate("__hm.netseason.msg({ t: 'season', s: __hm.netseason.NETS.s && { ...JSON.parse(JSON.stringify(__hm.netseason.NETS.s)) } }); 0")
            info = await A.evaluate("(() => { const b = document.getElementById('menu-body'); const c = b.querySelector('.chron'); return [b.innerHTML.length, c ? c.innerHTML.length : -1, b.scrollHeight, b.clientHeight, (c ? c.textContent : b.textContent).slice(0, 200)]; })()")
            log('season page', info)
            await A.emulate_media(reduced_motion='reduce')  # the page fades in by the document's clock, which a slow SwiftShader page barely turns
            await A.evaluate("__hm.LORE.openChronicle('season'); 0")
            await asyncio.sleep(1.5)
            await shot(A, 'season_page')
        errs = await A.evaluate('__hm.errors.slice()')
        check(not errs, f'no errors ({errs[:2]})')
        await N1.quit()
        await b.close()
    finally:
        srv.terminate()
        try: print('server says:', srv.communicate(timeout=3)[0][-500:])
        except Exception: srv.kill()

async def companies_part(p):
    """[companies] companies on a local server (server/companies.js, 14r_companies.js)"""
    import tempfile
    port = free_port(); data = tempfile.mkdtemp(prefix='net_co_', dir=str(OUT))
    root = pathlib.Path(__file__).resolve().parents[2]
    env = {**os.environ, 'PORT': str(port), 'HM_DATA': data, 'HM_SEASON_SPEED': '1', 'HM_SEASON_STEP': '1000', 'HM_SEASON_PUSH': '3000', 'HM_ADMIN': 'net-test-key'}
    def srv_start():
        return subprocess.Popen(['node', str(root / 'server' / 'server.js')], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
    srv = srv_start()
    base = f'http://127.0.0.1:{port}'; url = f'ws://127.0.0.1:{port}/ws'
    async def srv_up():
        for _ in range(80):
            try: http_json(base + '/health'); return True
            except Exception: await asyncio.sleep(0.25)
        return False
    async def name_acct(pg, name):
        await pg.evaluate("__hm.net.sheet(true); 0")
        await until([pg], pg, "(__hm.frame(1/30), !!document.getElementById('netacct-name'))", 15)
        await pg.fill('#netacct-name', name); await pg.fill('#netacct-pass', 'company-pass-1')
        await pg.evaluate("document.querySelector('#netsheet-acct button[data-act=\"acct-claim\"]').click(); 0")
        return await until([pg], pg, "document.querySelector('#netsheet-acct .net-msg').textContent.startsWith('Your account is') && !!__hm.companies.CO.s && !__hm.companies.CO.s.guest", 15)
    CO_TXT = "(document.getElementById('netsheet-co') || {}).textContent || ''"
    try:
        await srv_up()
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': W, 'height': H})
        # Separate browser instances represent two humans with independent focus.
        phone_browser = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        tctx = await phone_browser.new_context(viewport={'width': 390, 'height': 780}, has_touch=True, is_mobile=True)  # Edda plays on a phone: her taps are taps
        A = await boot(ctx, {'room': 'srv', 'user': 'uCoA', 'noRoom': True, 'server': url}, 'A')
        town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
        await start(A, 0, 'warrior', 30, 'Corwen', town[0] + 4, town[1] + 10)
        ok = await until([A], A, "!!__hm.companies.CO.s && __hm.companies.CO.s.guest === true", 30)
        check(ok, 'a guest is told of companies (and that it is a guest)')
        await A.evaluate("__hm.net.sheet(true); 0")
        t = await A.evaluate(CO_TXT)
        check('named accounts' in t and not await A.evaluate("!!document.getElementById('co-name')"), f'the sheet offers a guest no founding: it names its account first ({t[:90]!r})')
        # a guest refused by the server too (a headless guest asks)
        G = NodeClient('G'); await G.start(url)
        await G.cmd({'cmd': 'hello', 'name': 'Wander', 'realm': 0, 'cls': 'mage', 'x': town[0], 'z': town[1]})
        await G.wait('welcome'); await asyncio.sleep(0.6)
        await G.cmd({'cmd': 'raw', 'm': {'t': 'co', 'op': 'found', 'q': 1, 'name': 'Wanderers', 'dev': 1, 'col': [0, 3]}})
        await asyncio.sleep(0.8)
        st = http_json(base + '/stats')['companies']
        check(st['n'] == 0 and st['refused'] >= 1, f"the server refuses a guest's company ({st})")
        tag = 'x' + str(int(time.time()) % 10000)
        ok = await name_acct(A, 'Corwen' + tag)
        check(ok, 'Corwen names his account from the sheet')
        await until([A], A, f"(__hm.frame(1/30), !!document.getElementById('co-name'))", 10)
        # a name refused, then the company founded with a device and tinctures (keys and clicks on a desk)
        await A.fill('#co-name', 'Kestrel Hold Guard')
        await A.evaluate("document.querySelector('#netsheet-co button[data-co=\"found\"]').click(); 0")
        ok = await until([A], A, "document.querySelector('#netsheet-co .co-msg').textContent.includes(\"March's own\")", 10)
        why = await A.evaluate("document.querySelector('#netsheet-co .co-msg').textContent")
        check(ok, f"a name of the March's own is refused ({why!r})")
        await A.evaluate("document.querySelector('#netsheet-co button[data-co=\"dev\"][data-i=\"2\"]').click(); document.querySelector('#netsheet-co button[data-co=\"col\"][data-k=\"1\"][data-i=\"3\"]').click(); 0")
        await A.fill('#co-name', 'The Iron Oath')
        await A.press('#co-name', 'Enter')
        ok = await until([A], A, "!!(__hm.companies.CO.s.co && __hm.companies.CO.s.co.n === 'The Iron Oath')", 10)
        co = await A.evaluate("(() => { const c = __hm.companies.CO.s.co; return c && [c.role, c.dev, c.col]; })()")
        check(ok and co == ['cap', 2, [0, 3]], f'Corwen founds The Iron Oath by the Enter key: a tower, gold on red ({co})')
        # a headless player of the realm with a named account joins (raw), and Edda is named on her phone, then goes away
        N1 = NodeClient('N1'); await N1.start(url)
        await N1.cmd({'cmd': 'hello', 'name': 'Nodric', 'realm': 0, 'cls': 'warrior', 'x': town[0] + 7, 'z': town[1] + 10})
        await N1.wait('welcome'); await asyncio.sleep(0.5)
        await N1.cmd({'cmd': 'raw', 'm': {'t': 'acct', 'op': 'claim', 'name': 'Nodric' + tag, 'pass': 'company-pass-1'}})
        await N1.wait('acct')
        B = await boot(tctx, {'room': 'srv', 'user': 'uCoB', 'noRoom': True, 'server': url}, 'B')
        await start(B, 0, 'priest', 30, 'Edda', town[0] + 6, town[1] + 12)
        await until([B], B, "!!__hm.companies.CO.s", 30)
        ok = await name_acct(B, 'Edda' + tag)
        check(ok, 'Edda names her account on her phone')
        await B.evaluate("__hm.fn.saveNow(); 0"); await asyncio.sleep(1.2)
        await B.close()
        # invited while away; the company speaks while she is away
        await A.fill('#co-inv', 'Edda' + tag)
        await A.evaluate("document.querySelector('#netsheet-co button[data-co=\"invite\"]').click(); 0")
        ok = await until([A], A, "document.querySelector('#netsheet-co .co-msg').textContent.startsWith('Invited')", 10)
        check(ok, 'Corwen invites Edda, who is away')
        await asyncio.sleep(0.5)
        await A.fill('#co-inv', 'Nodric' + tag); await A.press('#co-inv', 'Enter')
        await asyncio.sleep(1.2)
        await A.fill('#co-notice', 'We muster at Kestrel Hold on day 12'); await A.press('#co-notice', 'Enter')
        await asyncio.sleep(0.6)
        await A.fill('#co-say', 'To the hold at dusk, and bring stone. <img src=x onerror=alert(1)>'); await A.press('#co-say', 'Enter')
        ok = await until([A], A, "__hm.companies.CO.s.co.chat.some((L) => L[2].startsWith('To the hold at dusk')) && __hm.companies.CO.s.co.notice.x.startsWith('We muster')", 10)
        check(ok, 'the notice is set and the company spoken to')
        # Edda comes back (the same phone): the invitation and what was said are waiting; she joins by a tap
        B = await boot(tctx, {'room': 'srv', 'user': 'uCoB', 'noRoom': True, 'server': url}, 'B')
        await start(B, 0, 'priest', 30, 'Edda', town[0] + 6, town[1] + 12)
        ok = await until([B], B, "!!(__hm.companies.CO.s && __hm.companies.CO.s.invites.length)", 30)
        check(ok, 'on her return the invitation waits for her')
        badge = await B.evaluate("(() => { __hm.frame(1/30); const b = document.getElementById('btn-net'); return [b && !b.hidden, b && b.classList.contains('net-glow'), b && b.textContent]; })()")
        check(badge[0] and badge[1], f'the Players button shows and glows for it ({badge})')
        await B.tap('#mobile-menu-toggle', timeout=60000)
        check(await B.evaluate("__hm.UI.modal === 'mobile' && !document.getElementById('mobile-tray').hidden"), 'More opens the phone tools before Players is tapped')
        await B.tap('#mobile-tray-tabs [data-mobile-tab="social"]', timeout=60000)
        check(await B.evaluate("""__hm.UI.modal === 'mobile' && !document.getElementById('mobile-tray').hidden &&
          document.getElementById('mobile-tray').dataset.section === 'social' &&
          document.querySelector('[data-mobile-tab="social"]').getAttribute('aria-selected') === 'true'"""),
          'the Social tab opens by touch and keeps More visible before Players is tapped')
        await B.locator('#btn-net').scroll_into_view_if_needed(timeout=60000)
        await B.tap('#btn-net', timeout=60000)
        await until([B], B, "(__hm.frame(1/30), !!document.querySelector('#netsheet-co button[data-co=\"answer\"]'))", 10)
        await B.evaluate("document.querySelector('#netsheet-co button[data-co=\"answer\"][data-yes=\"1\"]').scrollIntoView(); 0")
        await B.tap('#netsheet-co button[data-co="answer"][data-yes="1"]', timeout=60000)
        ok = await until([B], B, "!!(__hm.companies.CO.s && __hm.companies.CO.s.co && __hm.companies.CO.s.co.n === 'The Iron Oath')", 15)
        check(ok, 'she joins The Iron Oath by a tap')
        chat = await B.evaluate("__hm.companies.CO.s.co.chat.map((L) => L[2])")
        logHad = await B.evaluate("NT.logHas('While') || NT.logHas('while you were away')")
        check(any(c.startswith('To the hold at dusk') for c in chat), f'the company\'s chat said while she was away is hers ({chat[-3:]})')
        inj = await B.evaluate("!!document.querySelector('#netsheet-co img, #log img')")
        check(not inj, 'a line with markup is shown as text')
        sh = await B.evaluate(CO_TXT)
        check('We muster at Kestrel Hold on day 12' in sh and 'Corwen' + tag in sh, f'the sheet shows the notice and the roster ({sh[:120]!r})')
        # Nodric (on now, without a page) answers his invitation
        ninv = next((l['company']['s']['invites'] for l in reversed(N1.lines) if 'company' in l and l['company'].get('s') and l['company']['s'].get('invites')), None)
        if ninv: await N1.cmd({'cmd': 'raw', 'm': {'t': 'co', 'op': 'answer', 'q': 3, 'id': ninv[0]['id'], 'yes': True}})
        ok = await until([A], A, "__hm.companies.CO.s.co.mem.length === 3", 10)
        check(bool(ninv) and ok, f"Nodric, on now, was told of his invitation at once and joins ({ninv and ninv[0]['n']})")
        # a pledge: the Season page's goods brought by Edda count for the company
        await A.evaluate("document.querySelector('#netsheet-co button[data-co=\"pledge\"][data-id=\"granary\"]').click(); 0")
        ok = await until([A], A, "__hm.companies.CO.s.co.pledge === 'granary'", 10)
        check(ok, 'Corwen pledges the company to the granary')
        await B.evaluate("__hm.net.sheet(false); __hm.fn.goodsAdd('log', 40, true); 0")
        r = await B.evaluate("__hm.netseason.giveAll('timber').then((r) => JSON.stringify(r))")
        ok = await until([A], A, "(__hm.net.NETWS && 0) || (__hm.companies.CO.s.co.pl.granary || 0) >= 40", 10)
        pts = await A.evaluate("JSON.stringify([__hm.companies.CO.s.co.pts, __hm.companies.CO.s.co.u, __hm.companies.CO.s.co.pl, __hm.companies.CO.s.co.mem.map((M) => [M.n, M.du])])")
        check(ok and '"co"' in r, f'40 timber brought by Edda count for the company and its pledge ({r[:160]}; {pts})')
        # the Season page's company lines
        await B.evaluate("__hm.LORE.openChronicle('season'); __hm.frame(1/30); 0")
        pg = await B.evaluate("(document.querySelector('#menu-body .chron') || {}).textContent || ''")
        check('Companies of Logres' in pg and 'The Iron Oath' in pg and 'pledged' in pg, 'the Season page tells the realm\'s companies and her own')
        await B.evaluate("__hm.UI.modal = null; document.getElementById('menu').hidden = true; 0")
        # the company's name on her nameplate and frame on Corwen's page
        ok = await until([A, B], A, "(() => { const g = NT.ghostOf('Edda'); return !!(g && __hm.companies.ofEnt(g)); })()", 20)
        await A.evaluate("__hm.net.sheet(false); (() => { const g = NT.ghostOf('Edda'); if (g) { __hm.GAME.player.target = g.id; } __hm.CAM.yaw = Math.atan2(-(g.x - NT.P.x), -(g.z - NT.P.z)); return 0; })()")
        for _ in range(3): await A.evaluate('__hm.frame(1/30); 0')
        npTxt = await A.evaluate("[...document.querySelectorAll('#nameplates .np')].filter((e) => e.style.display !== 'none').map((e) => e.textContent).join(' | ')")
        tf = await A.evaluate("document.getElementById('tf-sub').textContent")
        check(ok and 'The Iron Oath' in npTxt and 'The Iron Oath' in tf, f"the others see her company under her name and on her frame ({npTxt[:80]!r}; {tf!r})")
        if SHOTS:
            await shot(A, 'co_nameplate')
        # the muster: one party for those on
        await asyncio.sleep(0.5)
        await A.evaluate("__hm.net.sheet(true); document.querySelector('#netsheet-co button[data-co=\"muster\"]').click(); 0")
        ok = await until([A, B], B, "!!__hm.net.NET.party && __hm.net.NET.party.startsWith('co')", 15)
        same = await A.evaluate("__hm.net.NET.party") == await B.evaluate("__hm.net.NET.party")
        check(ok and same, 'Corwen musters the company: Edda is in his party')
        ok = await until([A, B], A, "(__hm.frame(1/30), !document.getElementById('netparty').hidden)", 10)
        check(ok, "the party's frames show on Corwen's screen")
        # the captain removes a member (Nodric, if he joined; else Edda after the restart)
        # the server stopped and started: everything read back, the pages linked again
        await A.evaluate('__hm.fn.saveNow(); 0'); await asyncio.sleep(0.8)
        srv.terminate()
        try: srv.communicate(timeout=5)
        except Exception: srv.kill()
        await step([A, B], 0.1, 5)
        srv = srv_start(); await srv_up()
        ok = await until([A, B], A, "__hm.net.NETWS.state === 'on' && !!(__hm.companies.CO.s && __hm.companies.CO.s.co)", 60)
        c2 = await A.evaluate("(() => { const c = __hm.companies.CO.s && __hm.companies.CO.s.co; return c && [c.n, c.mem.length, c.notice.x, c.pl.granary || 0, c.chat.length]; })()")
        check(ok and c2 and c2[0] == 'The Iron Oath' and c2[1] >= 2 and c2[2].startswith('We muster') and c2[3] >= 40, f'after the server restarts the company is read back and the page told it ({c2})')
        # the captain removes Edda: she is told
        eid = await A.evaluate("(() => { const M = __hm.companies.CO.s.co.mem.find((x) => x.n.startsWith('Edda')); return M ? M.id : ''; })()")
        await A.evaluate("__hm.net.sheet(true); 0"); await until([A], A, "(__hm.frame(1/30), true)", 0.2)
        await asyncio.sleep(0.5)
        await until([A, B], A, "!__hm.companies.CO.busy && !!document.querySelector('#netsheet-co button[data-co=\"remove\"]')", 20)
        await A.evaluate(f"(() => {{ const b = document.querySelector('#netsheet-co button[data-co=\"remove\"][data-who=\"{eid}\"]'); if (b) b.click(); return 0; }})()")
        ok = await until([A, B], B, "!!__hm.companies.CO.s && !__hm.companies.CO.s.co", 25)
        why = await A.evaluate("__hm.companies.CO.msg + ' / busy ' + __hm.companies.CO.busy")
        check(ok and eid, f'the captain removes Edda, and her page is told ({why})')
        ok = await until([A, B], A, "(() => { const g = NT.ghostOf('Edda'); return !!g && !__hm.companies.ofEnt(g); })()", 15)
        check(ok, 'and her nameplate no longer names the company')
        if SHOTS:
            await A.evaluate("__hm.net.sheet(true); 0")
            await A.emulate_media(reduced_motion='reduce'); await asyncio.sleep(1.0)
            await shot(A, 'co_sheet_desk')
            await B.evaluate("__hm.net.sheet(true); 0"); await B.emulate_media(reduced_motion='reduce'); await asyncio.sleep(1.0)
            await shot(B, 'co_sheet_phone')
        for pg in (A, B):
            errs = await pg.evaluate('__hm.errors.slice()')
            check(not errs, f'{pg._name}: no errors ({errs[:2]})')
        await N1.quit(); await G.quit()
        await phone_browser.close()
        await b.close()
    finally:
        srv.terminate()
        try: print('server says:', srv.communicate(timeout=3)[0][-400:])
        except Exception: srv.kill()

async def deployed_part(p):
    """[net] the deployed server (Railway, CLAUDE.md: Multiplayer): its health, the season played by asynchronous
    players (net_season.mjs against it), and two pages linked to it at once"""
    host = KV.get('host', 'march-production-f6d9.up.railway.app')
    h = http_json(f'https://{host}/health')
    check(h.get('ok'), f'the deployed server answers ({h})')
    r = subprocess.run(['node', str(pathlib.Path(__file__).with_name('net_season.mjs')), f'wss://{host}/ws'], capture_output=True, text=True, timeout=180)
    print(r.stdout[-1800:])
    check(r.returncode == 0, 'asynchronous players play the season on the deployed server')
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': W, 'height': H})
    url = f'wss://{host}/ws'
    A, B = await asyncio.gather(boot(ctx, {'room': 'dep', 'user': 'uDepA', 'noRoom': True, 'server': url, 'shard': 'net-test'}, 'A'), boot(ctx, {'room': 'dep', 'user': 'uDepB', 'noRoom': True, 'server': url, 'shard': 'net-test'}, 'B'))
    town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
    await start(A, 0, 'warrior', 30, 'Osric', town[0] + 4, town[1] + 10)
    await start(B, 0, 'priest', 30, 'Wynn', town[0] + 8, town[1] + 10)
    ok = await until([A, B], A, "NT.st().state === 'on' && !!NT.ghostOf('Wynn')", 40)
    check(ok, 'two pages on the deployed server see each other')
    ok = await until([A, B], B, "!!NT.ghostOf('Osric') && !!__hm.netseason.NETS.s", 30)
    check(ok, 'and both are told the season')
    rtt = await A.evaluate('__hm.net.NETWS.stats.rtt')
    log('round trip to the deployed server', rtt, 'ms')
    for pg in (A, B):
        errs = await pg.evaluate('__hm.errors.slice()')
        check(not errs, f'{pg._name}: no errors ({errs[:2]})')
    await b.close()

async def perf_part(p):
    """the cost of others drawn: one page alone, then with ten players walking round it (net_fake.js)"""
    rid = 'net-perf-' + ''.join(random.choice('abcdefghijk') for _ in range(5))
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': 640, 'height': 360})
    A = await boot(ctx, {'room': rid, 'user': 'uPerf'}, 'A')
    town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
    await start(A, 0, 'warrior', 30, 'Aldwin', town[0] + 4, town[1] + 12)
    log('started')
    await A.evaluate(pathlib.Path(__file__).with_name('net_fake.js').read_text())
    log('fakes ready')
    # each frame's JS apart from SwiftShader's drawing: the GPU drained first by a readPixels (as perf2.py does)
    ONE = "(() => { const H = __hm, gl = H.dbg.renderer.getContext(), px = new Uint8Array(4); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); const t0 = performance.now(); H.simulate(0.05); const t1 = performance.now(); H.frame(1/30); const t2 = performance.now(); return [t1 - t0, t2 - t1]; })()"
    async def MEAS_RUN():
        await human_play(A)
        await A.evaluate("(() => { const H = __hm; H.CAM.yaw = 0; H.CAM.pitch = 0.3; H.CAM.dist = H.CAM.targetDist = 9; return 0; })()")
        for _ in range(8): await A.evaluate(ONE); await asyncio.sleep(0.03)
        sims, frs, ri = [], [], []
        for i in range(40):
            a, b2 = await A.evaluate(ONE); sims.append(a); frs.append(b2)
            if i % 10 == 0: ri.append(await A.evaluate("(() => { const r = __hm.renderInfo(); return [r.calls, r.triangles]; })()"))
            await asyncio.sleep(0.03)
        st = await A.evaluate('NT.st()')
        med = lambda v: sorted(v)[len(v) // 2]
        return {'step': round(med(sims), 2), 'frame': round(med(frs), 2), 'calls': [r[0] for r in ri], 'tris': [r[1] for r in ri], 'ghosts': len([q for q in st['peers'] if q['ghost']]), 'down': st['stats']['downBytes'], 'recv': st['stats']['fastRecv']}
    await A.evaluate('NT.calm(); 0')
    if not QUICK:
        log('measuring alone')
        r0 = await MEAS_RUN()
        log('alone', json.dumps(r0))
    await A.evaluate("(() => { const P = __hm.GAME.player; for (let i = 0; i < 10; i++) NF.add({ name: 'Walker' + i, realm: i % 3, cls: ['warrior', 'archer', 'mage', 'priest'][i % 4], level: 30, x: P.x, z: P.z, walk: 'circle', cx: P.x, cz: P.z + 8, r: 6 + i, speed: 3 + (i % 3) * 1.5, ang: i }); return 0; })()")
    for _ in range(30): await A.evaluate('__hm.simulate(0.1); 0'); await asyncio.sleep(0.05)
    if not QUICK:
        r1 = await MEAS_RUN()
        log('ten others', json.dumps(r1))
        check(r1['ghosts'] == 10, f"ten others drawn as bodies ({r1['ghosts']})")
        check(r1['step'] < r0['step'] * 1.6 + 1.5, f"a step with ten others: {r1['step']} ms against {r0['step']} ms alone")
        check(r1['frame'] < r0['frame'] * 1.6 + 4, f"a frame with ten others: {r1['frame']} ms against {r0['frame']} ms alone (calls {r1['calls']} against {r0['calls']})")
        per = r1['down'] / max(1, r1['recv'])
        log(f"heard from ten walking players: {r1['recv']} updates, {per:.0f} B each (at ten a second each: {per * 100 / 1024:.1f} KB/s; here the stand-in's timers ran slower under SwiftShader's load)")
    if SHOTS:
        await A.set_viewport_size({'width': 960, 'height': 540})
        await A.evaluate("(() => { const H = __hm; H.CAM.mode = 'play'; H.CAM.pitch = 0.32; H.CAM.dist = H.CAM.targetDist = 14; H.CAM.yaw = 0; return 0; })()")
        for _ in range(4): await A.evaluate('__hm.simulate(0.05); 0')
        await shot(A, 'ten_others')
    errs = await A.evaluate('__hm.errors.slice()')
    check(not errs, f'no errors ({errs[:2]})')
    await A.evaluate('NF.stop()')
    await b.close()

WXJS = r"""window.WXT = {
  H: window.__hm, get W() { return this.H.weather2; },
  st(id) { const WX = this.W.WX; const c = id ? WX.cells.find((q) => q.id === id) : null;
    return { follow: !!WX.follow, n: WX.cells.length, net: WX.cells.filter((q) => q.net).length, own: WX.cells.filter((q) => !q.net && !q.gone).length, held: this.W.wxHeld(),
      c: c ? { x: c.x, z: c.z, s: c.s, fin: c.fin, age: c.age, net: !!c.net } : null, made: WX.stats.made, nwx: this.H.netwx ? this.H.netwx.NWX.stats : null }; },
  at(x, z) { const o = this.W.weatherAt(x, z, {}); return { storm: o.storm, rain: o.rain, cover: o.cover }; },
  publication() {
    const N = this.H.netwx.NWX, s = N.snap, ids = (cells) => cells.map((c) => c.id).sort((a, b) => a - b);
    return { live: ids(this.W.WX.cells), activeNet: ids(this.W.WX.cells.filter((c) => c.net && !c.gone)),
      received: N.last, snapshot: s ? { ids: s.c.map((c) => c[0]).sort((a, b) => a - b),
        word: s.k + ':' + s.c.length + ':' + (s.c[0] ? s.c[0][2] : '') } : null };
  },
};
0"""

async def weather_part(p):
    """[perf3] the weather shared: the host's systems on every page of the room (the same storm over the same place), eased
    in, no weather of the follower's own; the host leaving, the next keeps the sky"""
    rid = 'net-wx-' + ''.join(random.choice('abcdefghijk') for _ in range(6))
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': W, 'height': H})
    A = await boot(ctx, {'room': rid, 'user': 'uAldwin'}, 'A')
    town = await A.evaluate('(() => { const T = __hm.REALMS[0].town; return [T.x, T.z]; })()')
    tx, tz = town
    await start(A, 0, 'warrior', 30, 'Aldwin', tx + 4, tz + 10)
    for _ in range(10): await A.evaluate('__hm.simulate(0.2); 0'); await asyncio.sleep(0.1)
    B = await boot(ctx, {'room': rid, 'user': 'uBrisa'}, 'B')
    await start(B, 0, 'mage', 30, 'Brisa', tx - 4, tz + 10)
    pages = [A, B]
    for pg in pages:
        await pg.evaluate(WXJS)
    # the weather live on both (a new game's own: Always clear off, no test's fixed weather)
    for pg in pages: await pg.evaluate("(() => { const E = __hm.dbg.WEATHER; E.mode = 'auto'; if (E.next > 1e6) E.next = 60; __hm.weather2.release(); return 0; })()")
    held = [await pg.evaluate('WXT.W.wxHeld()') for pg in pages]
    check(held == [False, False], f'the weather is live on both pages ({held})')
    ok = await until(pages, B, "NT.st().peers.some((p) => p.on && p.ghost)", 40)
    hostA = (await A.evaluate('NT.st()'))['isHost']
    H_, F_ = (A, B) if hostA else (B, A)
    check(hostA or (await B.evaluate('NT.st()'))['isHost'], f'a host ({"A" if hostA else "B"})')
    own0 = await F_.evaluate('WXT.st()')
    log('follower before', json.dumps(own0))
    # a storm on the host's page, 220 m from the town
    sid = await H_.evaluate(f"(() => {{ const c = WXT.W.wxMake('storm', {tx + 220}, {tz}, {{ age: 120 }}); c.life = Math.max(c.life, 700); return c.id; }})()")
    ok = await until(pages, F_, f"(() => {{ const c = WXT.st({sid}).c; return !!c && !!c.net; }})()", 40, 0.25)
    check(ok, f'the follower has the host\'s storm (id {sid})')
    trail = []
    for i in range(36):
        await step(pages, 0.5)
        a = await H_.evaluate(f'WXT.st({sid})'); f = await F_.evaluate(f'WXT.st({sid})')
        if a['c'] and f['c']: trail.append((a['c'], f['c'], f['follow'], f['own']))
    if trail:
        last = trail[-1]
        d = ((last[0]['x'] - last[1]['x']) ** 2 + (last[0]['z'] - last[1]['z']) ** 2) ** 0.5
        check(d < 40, f'the same storm over the same place: {d:.1f} m apart after 18 s')
        check(abs(last[0]['age'] - last[1]['age']) < 8, f"its age the same ({last[0]['age']:.0f} s and {last[1]['age']:.0f} s)")
        ss = [t[1]['s'] for t in trail]
        check(ss[0] < ss[-1] - 0.2 and all(ss[i + 1] >= ss[i] - 0.02 for i in range(len(ss) - 1)), f'it fades in on the follower: s {ss[0]:.2f} .. {ss[-1]:.2f}')
        jumps = [(((trail[i + 1][1]['x'] - trail[i][1]['x']) ** 2 + (trail[i + 1][1]['z'] - trail[i][1]['z']) ** 2) ** 0.5) for i in range(len(trail) - 1)]
        check(max(jumps) < 25, f'nothing jumps: its largest move in a half second {max(jumps):.1f} m')
        check(all(t[2] for t in trail[-10:]), 'the follower follows')
    cx, cz = (trail[-1][0]['x'], trail[-1][0]['z']) if trail else (tx + 220, tz)
    wa = await H_.evaluate(f'WXT.at({cx}, {cz})'); wb = await F_.evaluate(f'WXT.at({cx}, {cz})')
    check(wa['storm'] > 0.4 and abs(wa['storm'] - wb['storm']) < 0.1 and abs(wa['rain'] - wb['rain']) < 0.12, f"the weather under it the same on both: storm {wa['storm']:.2f} / {wb['storm']:.2f}, rain {wa['rain']:.2f} / {wb['rain']:.2f}")
    fl = await F_.evaluate('WXT.st()')
    for _ in range(40): await step(pages, 0.5)
    # The simulation can advance 20 s before the profile's real-time send gate
    # opens. Wait for the actual current publication, without advancing weather
    # or changing the production clocks, rather than comparing different words.
    publication_at = time.monotonic()
    deadline = publication_at + 12
    applied = False
    while time.monotonic() < deadline:
        for pg in pages: await pg.evaluate('__hm.net.pump(0); 0')
        host_word = await H_.evaluate('WXT.publication()')
        follower_word = await F_.evaluate('WXT.publication()')
        snapshot = host_word['snapshot']
        applied = bool(snapshot and snapshot['ids'] == host_word['live']
                       and follower_word['received'] == snapshot['word']
                       and follower_word['activeNet'] == host_word['live'])
        if applied: break
        await asyncio.sleep(0.05)
    check(applied, f'the follower receives the current host publication within 12 real seconds '
          f'({time.monotonic() - publication_at:.2f}s): host {json.dumps(host_word)}, follower {json.dumps(follower_word)}')
    fl2 = await F_.evaluate('WXT.st()')
    check(fl2['own'] == 0, f"the follower's own systems gone, faded out ({own0['own']} at first, {fl2['own']} now), {fl2['net']} of the host's")
    hs = await H_.evaluate('WXT.st()')
    check(abs(hs['n'] - fl2['net']) <= 1, f"the same systems: the host {hs['n']}, the follower {fl2['net']}")
    nb = (await F_.evaluate('NT.st()'))['stats']
    log('follower stats', json.dumps(fl2['nwx']), 'profile bytes', nb.get('downBytes'))
    # the host leaves: the follower keeps the sky and goes on making it
    before = await F_.evaluate(f'WXT.st({sid})')
    await H_.close()
    pages2 = [F_]
    ok = await until(pages2, F_, 'NT.st().isHost', 40, 0.5)
    check(ok, 'the follower is the host once the other has gone')
    for _ in range(50): await step(pages2, 0.5)
    after = await F_.evaluate(f'WXT.st({sid})')
    check(not after['follow'] and after['c'] is not None, f"it keeps the storm and its own sky (following {after['follow']}, the storm {'there' if after['c'] else 'gone'})")
    errs = await F_.evaluate('__hm.errors.slice()')
    check(not errs, f'no errors ({errs[:2]})')
    await b.close()

async def main():
    async with async_playwright() as p:
        if 'room' in PARTS: await room_part(p)
        if 'server' in PARTS: await server_part(p)
        if 'perf' in PARTS: await perf_part(p)
        if 'season' in PARTS: await season_part(p)
        if 'companies' in PARTS: await companies_part(p)
        if 'deployed' in PARTS: await deployed_part(p)
        if 'weather' in PARTS: await weather_part(p)
    print(f'\n{len(FAILS)} failed in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

if __name__ == '__main__':
    asyncio.run(main())
