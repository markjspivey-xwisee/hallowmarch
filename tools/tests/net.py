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
usage: python3 tools/tests/net.py [room] [three] [lossy] [phone] [server] [shots] [w=640 h=360]"""
import asyncio, json, sys, pathlib, time, os, random, subprocess, socket
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright

ARGS = sys.argv[1:]
KV = dict(a.split('=', 1) for a in ARGS if '=' in a)
PARTS = [a for a in ARGS if a in ('room', 'server', 'phone')] or ['room']
THREE = 'three' in ARGS
LOSSY = 'lossy' in ARGS
SHOTS = 'shots' in ARGS
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
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}') if m.type in ('error',) else None)
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
    if x is not None: await page.evaluate(f'__hm.teleport({x}, {z}); NT.calm(); 0')

async def step(pages, sec=0.1, n=1, frame=False):
    """each page a step at a time, in turn: the room's messages pass between the evaluates as in play"""
    for _ in range(n):
        for p in pages:
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
    check(med < 2.5, f'A walking: B draws him within {med:.2f} m (median; the most {max(errs) if errs else 99:.2f} m; the delay is about a step)')
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
    # the sizes and the rates
    sA = await A.evaluate('NT.st()')
    check(sA['lastFastBytes'] < 3800 and sA['slowBytes'] < 3800, f"what A sends fits presence (fast {sA['lastFastBytes']} B, profile {sA['slowBytes']} B)")
    log('A stats', json.dumps(sA['stats']))
    if SHOTS:
        await B.evaluate("(() => { const g = NT.ghostOf('Aldwin'); const P = NT.P; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); __hm.CAM.yaw = P.yaw; __hm.CAM.pitch = 0.25; __hm.CAM.dist = __hm.CAM.targetDist = 6; NT.P.target = g.id; return 0; })()")
        await A.evaluate("__hm.net.chat('r', 'For Logres!'); 0")
        await step(pages, 0.1, 6)
        await shot(B, 'room_ally')
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
        c0 = await Cp.evaluate('NT.me()')
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); NT.P.target = g.id; NT.P.hp = NT.P.maxHp; return 0; })()")
        await Cp.evaluate("NT.P.target = null; 0")
        hits = []
        for i in range(30):
            await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; P.x = g.x - 1.6; P.z = g.z; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); P.target = g.id; return 0; })()")
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
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); __hm.fn.dealDamage(NT.P, g, 50, { kind: 'melee' }); return 0; })()")
        await step(pages, 0.1, 6)
        r1 = (await Cp.evaluate('NT.st()'))['stats']['hitsRefused']
        check(r1 > r0, f'a blow from 200 m is refused by the struck page ({r0} to {r1})')
        await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; P.x = g.x - 1.6; P.z = g.z; return 0; })()")
        # the kill: C low, A finishes him
        rp0 = (await A.evaluate('NT.me()'))['rp']
        await Cp.evaluate("NT.P.hp = Math.max(1, NT.P.maxHp * 0.04); 0")
        for i in range(40):
            await A.evaluate("(() => { const g = NT.ghostOf('Caelan'); const P = NT.P; if (g) { P.x = g.x - 1.6; P.z = g.z; P.target = g.id; P.yaw = Math.atan2(g.x - P.x, g.z - P.z); } return 0; })()")
            await step(pages, 0.1)
            if not (await Cp.evaluate('NT.P.alive')): break
        dead = not (await Cp.evaluate('NT.P.alive'))
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
    """a headless player (net_client.mjs) driven by JSON lines"""
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
        except Exception: self.proc.kill()

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
        s1 = await N1.state()
        aname = next((v['name'] for v in s1['peers'].values() if v['name']), '')
        check(aname == 'Aldwin' and s1['got']['fast'] > 3, f"the headless player hears the page ({aname}, {s1['got']['fast']} states)")
        # interest: a player far off hears the page only now and then
        N2 = NodeClient('N2'); await N2.start(url)
        far = await A.evaluate('(() => { const T = __hm.REALMS[2].town; return [T.x, T.z]; })()')
        await N2.cmd({'cmd': 'hello', 'name': 'Farwen', 'realm': 2, 'cls': 'mage', 'x': far[0], 'z': far[1]})
        await N2.wait('welcome')
        await asyncio.sleep(0.5)
        for i in range(40): await step([A], 0.1)
        s1 = await N1.state(); s2 = await N2.state()
        n1 = next((v['n'] for v in s1['peers'].values() if v['name'] == 'Aldwin'), 0)
        n2 = next((v['n'] for v in s2['peers'].values() if v['name'] == 'Aldwin'), 0)
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
        await N1.quit(); await N2.quit()
        await b.close()
    finally:
        srv.terminate()
        try: print('server says:', srv.communicate(timeout=3)[0][-600:])
        except Exception: srv.kill()

async def main():
    async with async_playwright() as p:
        if 'room' in PARTS: await room_part(p)
        if 'server' in PARTS: await server_part(p)
    print(f'\n{len(FAILS)} failed in {time.time() - T0:.0f}s')
    for f in FAILS: print('  FAIL', f)
    sys.exit(1 if FAILS else 0)

asyncio.run(main())
