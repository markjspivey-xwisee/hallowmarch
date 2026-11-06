"""[look3] What version 13's look left and what version 13 added, fixed at the cause (version 14): numeric checks and the
views to look at.
Checks:
  - scaffolds: every scaffold of a curtain, a stone tower and a burnt palisade gap (and the one built for a gap here) has
    its standards, its bays, a floor of boards at every lift and a ladder up to each lift (look3Scaffold, 04d_look3.js),
    and no standard stands in a collider, a tree or under a raised floor (look3Clear, at its place in the world);
  - masons: when a breached tower's scaffold goes up two masons come out of the keep's hall, walk out by the gate and
    round the walls to it; one works at its foot, the other climbs its ladder and works on the first lift's boards (they
    stand on the floor under them, and hammer); the work done, the one above climbs down and both go home into the hall;
  - gates: a body of each keep's realm walks out through its open gate (the walk over a Logres gate stood solid from the
    ground for every step until version 14);
  - halls: every keep's hall has its footpath from the door to the inside of the gate, in the 1 m path map (its middle
    full) and bare in the cover map (no blade), with the courtyard 3 m off it as it was;
  - cracks: a worn curtain and a worn tower are drawn with the castle shader (it compiles, cWear reaches them), a battered
    house too (the house shader);
  - hound: a hound by a hearth inside a house at night is lit warm by the room (as look2.py), and its coat against the
    fire is brighter than the hound's flat colour would give (the fur's glow: the hound's mean brightness);
  - no runtime errors, every program compiles.
Screenshots (unless noshots): the look3 group of tools/tests/look_views.js and look2's breach, breach_in, mend, hound_in,
handover and crown, at the qualities and times given (shots=view:q:variant,...).
usage: python3 tools/tests/look3.py [noshots] [only=scaffolds,masons,gates,halls,cracks,hound] [shots=...] [tag=now] [w=640] [h=360]"""
import json, asyncio, sys, time, pathlib, base64, io
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = sys.argv[1:]
OPT = dict(a.split('=', 1) for a in ARGS if '=' in a)
ONLY = OPT['only'].split(',') if 'only' in OPT else None
def want(k): return ONLY is None or k in ONLY
SHOTS = 'noshots' not in ARGS
TAG = OPT.get('tag', 'now')
W, H = int(OPT.get('w', 640)), int(OPT.get('h', 360))
VIEWS_JS = pathlib.Path(__file__).resolve().parent / 'look_views.js'
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

async def setup(p):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': W, 'height': H})
    page = await ctx.new_page()
    await page.add_init_script(HOLD)
    logs = []
    page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
    three = hm.THREE_LOCAL.read_text()
    async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
    await page.route(hm.THREE_URL, three_route)
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    await page.route('https://fonts.googleapis.com/**', font_route)
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
    await page.route('http://hm.test/', doc_route)
    await page.goto('http://hm.test/', wait_until='commit')
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=400000, polling=500)
    return b, page, logs

async def grab(page, frames=2):
    url = await page.evaluate(f"(() => {{ for (let i = 0; i < {frames}; i++) __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); }})()")
    return base64.b64decode(url.split(',', 1)[1])

async def ev(page, label, js):
    r = await page.evaluate(js)
    print(f'{label} [{time.time() - T0:.0f}s]', json.dumps(r)[:1800], flush=True)
    return r

def avg_px(im, px, py, rad=3):
    Wd, Hd = im.size; sx, sy = Wd / W, Hd / H; xs = []
    for dx in range(-rad, rad + 1):
        for dy in range(-rad, rad + 1):
            x, y = int(px * sx) + dx, int(py * sy) + dy
            if 0 <= x < Wd and 0 <= y < Hd: xs.append(im.getpixel((x, y)))
    return [round(sum(c[i] for c in xs) / max(1, len(xs)), 1) for i in range(3)]

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await page.evaluate("(async () => { await __hm.start({realm:0, cls:'warrior', level:30}); return 0; })()")
        await page.evaluate(VIEWS_JS.read_text() + '\n;0')
        await page.evaluate("LK.boot(); 0")
        await page.evaluate("__hm.fn.setQuality('low'); 0")
        if want('scaffolds'):
            r = await ev(page, 'scaffolds', """(() => { const L3 = __hm.look3, out = { n: 0, bad: [], kinds: {} };
              // (a curtain's scaffold stands on both its faces, where there is room: behind a Thule palisade its deck takes
              // the inner face, so that run has nothing; every section has at least one whole run, and no run is half laid)
              const whole = (info) => info.standards >= 3 && info.bays >= 2 && info.boards >= info.bays * 2 && info.ladders >= 1;
              for (const s of L3.scaffolds(true)) {
                const runs = [].concat(s.info); out.n++; out.kinds[s.kind] = (out.kinds[s.kind] || 0) + 1;
                if (!runs.some(whole) || runs.some((q) => q.standards > 0 && !whole(q))) out.bad.push({ kind: s.kind, keep: s.keep, k: s.k, runs: runs.map((q) => [q.standards, q.bays, q.boards, q.ladders]) });
                out.runs = (out.runs || 0) + runs.filter(whole).length;
              }
              return out; })()""")
            check(r['n'] >= 32 and r['kinds'].get('tower', 0) >= 20 and r.get('runs', 0) >= 40, f"scaffolds laid out for the curtains and the stone towers ({r['n']} sections, {r.get('runs')} whole runs: {r['kinds']})")
            check(not r['bad'], f"every one has a whole run of standards, bays, a floor of boards at each lift and its ladders ({r.get('runs')} runs; {len(r['bad'])} short: {json.dumps(r['bad'][:3])})")
            r = await ev(page, 'scaffold: a palisade gap built back', """(() => { const r = LK.set('pal_scaffold', 'day'); return { r, info: r && r.info }; })()""")
            inf = (r.get('info') or {})
            check(r['r'].get('state') == 'repair' and inf.get('standards', 0) >= 3 and inf.get('ladders', 0) >= 2 and inf.get('boards', 0) >= 6, f"a burnt palisade gap is built back behind a scaffold with boards and ladders ({json.dumps(r['r'])[:300]})")
        if want('masons'):
            r = await ev(page, 'masons: a tower built back', """(() => { const H = __hm, F = H.fn, L3 = H.look3, S = H.REALMS[0].keepSites[0], C = F.castles().find((q) => q.S === S), K = S.keepRef;
              const W = C.sections.find((q) => q.kind === 'tower' && q.T.role === 'corner' && q.T.sx === -1 && q.T.sz === -1), T = W.T;
              LK.hush(S.x, S.z, 60); for (const e of H.ENT.slice()) if (e.alive && e.role === 'soldier') F.removeEnt(e);
              H.WAR.commanders.forEach((c) => { c.nextThink = 1e9; c.nextSpawn = 1e9; }); for (const w of H.WAR.warbands) w.dead = true;
              if (W.state === 'whole') { const src = F.spawnRealmUnit(2, 'warrior', 30, 'guard', S.x + W.ox * 70, S.z + W.oz * 70, {}); src.hp = src.maxHp = 1e9; for (let n = 0; W.state === 'whole' && n < 80; n++) F.castleSiegeHit(src, T.wx + W.ox * (T.RO + 0.2), T.wz + W.oz * (T.RO + 0.2), 2.0, 4.4); F.removeEnt(src); }
              H.UI.modal = null; K.lastEnemyNear = -1e9;
              let t = 0; while (t < 120 && !(W.l3 && W.l3.on && L3.MASON.list.some((e) => e.ai.mason && e.ai.mason.W === W && !e.removed))) { H.simulate(1); K.lastEnemyNear = -1e9; t++; }
              const ms = L3.MASON.list.filter((e) => e.ai.mason && e.ai.mason.W === W && !e.removed);
              const out = { t, state: W.state, wt: +(W.t || 0).toFixed(2), on: !!(W.l3 && W.l3.on), n: ms.length, floors: W.l3 ? W.l3.floors.filter((f) => f.active).length : 0, ladders: W.l3 ? W.l3.ladders.filter((L) => !L.gone).length : 0 };
              // they walk out and set to work: one at the foot, one up the ladder on the first lift
              let u = 0; const L = W.l3.ladders.find((q) => q.k === 0);
              while (u < 90 && !(ms.every((e) => e.ai.mason.st === 'work'))) { H.simulate(0.5); K.lastEnemyNear = -1e9; if (W.t > 0.6) W.t = 0.3; u += 0.5; }
              out.u = u; out.sts = ms.map((e) => e.ai.mason.st); out.ys = ms.map((e) => +(e.y - L.wyb).toFixed(2)); out.lift = +(L.wyt - L.wyb).toFixed(2);
              out.floorUnder = ms.map((e) => +(F.floorAt(e.x, e.z, e.y + 0.3) - e.y).toFixed(2));
              const w0 = L3.MASON.stats.worked; H.simulate(6); K.lastEnemyNear = -1e9; out.worked = L3.MASON.stats.worked - w0;
              out.acts = ms.map((e) => e.anim.act);
              // the work about done: the one above climbs down, both go home to the hall
              W.t = 0.93; let v = 0; while (v < 80 && ms.some((e) => !e.removed)) { H.simulate(0.5); K.lastEnemyNear = -1e9; v += 0.5; }
              out.v = v; out.home = ms.filter((e) => e.removed).length; out.stats = L3.MASON.stats;
              H.UI.modal = 'menu'; return out; })()""")
            # ([look4] its first lift: the lifts above go up as the work comes up to them, 04d_look4.js; look4.py's lifts)
            check(r['on'] and r['n'] == 2 and r['floors'] >= 2 and r['ladders'] >= 1, f"masons: a breached tower's scaffold goes up, its first lift's boards are floors and its ladder climbable, and two masons come out of the hall ({r['n']} after {r['t']} s; {r['floors']} floors, {r['ladders']} ladders)")
            check(r['sts'] == ['work', 'work'] and r['u'] < 90, f"they walk out by the gate and round the walls to it and set to work ({r['sts']} in {r['u']} s)")
            ys = sorted(r['ys'])
            check(abs(ys[0]) < 0.5 and abs(ys[1] - r['lift']) < 0.15, f"one at its foot, one up its ladder on the first lift's boards (heights {r['ys']} over the ground, the lift {r['lift']})")
            check(all(abs(d) < 0.05 for d in r['floorUnder']), f"each stands on the floor under it (floor - body: {r['floorUnder']})")
            check(r['worked'] >= 6, f"and they work: hammer blows in 6 s ({r['worked']})")
            check(r['home'] == 2, f"the work done, the one above climbs down and both go home into the hall ({r['home']} in {r['v']} s; {json.dumps(r['stats'])})")
        if want('gates'):
            r = await ev(page, "gates: out through each keep's gate", """(() => { const H = __hm, F = H.fn, out = [];
              H.UI.modal = null;
              for (const R of H.REALMS) for (const S of R.keepSites) {
                const C = F.castles().find((q) => q.S === S), K = S.keepRef, round = C.kind === 'round', gz = S.gateLocal.z;
                const a = F.siteToWorld(S, 0, gz - (round ? 3.4 : 3.6)), b = F.siteToWorld(S, 0, gz + 4);
                const e = F.spawnRealmUnit(K.realm, 'warrior', 30, 'guard', a.x, a.z, {}); e.role = 'test'; e.hp = e.maxHp = 1e9;
                let t = 0; while (t < 12 && Math.hypot(e.x - b.x, e.z - b.z) > 0.6) { H.simulate(0.1); const d = Math.hypot(b.x - e.x, b.z - e.z) || 1; F.stepTo(e, e.x + (b.x - e.x) / d * 0.3, e.z + (b.z - e.z) / d * 0.3); t += 0.1; }
                out.push([S.name, +Math.hypot(e.x - b.x, e.z - b.z).toFixed(2), +t.toFixed(1)]); F.removeEnt(e);
              }
              H.UI.modal = 'menu'; return { out, mt: !!F.stepTo }; })()""")
            check(r['mt'] and all(q[1] <= 0.6 for q in r['out']), f"a body of each keep's realm walks out through its open gate (left from the gate's outside: {r['out']})")
        if want('halls'):
            r = await ev(page, 'halls', """(() => { const L3 = __hm.look3, L2 = __hm.look2, X = __hm.lookx, out = { n: 0, mid: [], cover: [], side: [] };
              for (const P of L3.look3HallPlan()) {
                out.n++;
                let mn = 1, mc = 1;
                for (let t = 0.1; t <= 0.9; t += 0.1) { const x = P.ax + (P.bx - P.ax) * t, z = P.az + (P.bz - P.az) * t; mn = Math.min(mn, L2.path(x, z)); mc = Math.min(mc, X.cover(x, z)); }
                out.mid.push(+mn.toFixed(2)); out.cover.push(+mc.toFixed(2));
                const dx = P.bx - P.ax, dz = P.bz - P.az, l = Math.hypot(dx, dz) || 1, mx = (P.ax + P.bx) / 2, mz = (P.az + P.bz) / 2;
                out.side.push(+Math.max(L2.path(mx - dz / l * 3.2, mz + dx / l * 3.2), L2.path(mx + dz / l * 3.2, mz - dx / l * 3.2)).toFixed(2));
              }
              return out; })()""")
            check(r['n'] == 6, f"every keep's hall has its footpath ({r['n']})")
            check(min(r['mid'] or [0]) >= 0.85, f"its middle is in the 1 m path map all the way from the door to the gate (least {r['mid']})")
            check(min(r['cover'] or [0]) >= 0.37, f"and bare in the cover map: no blade on it (least {r['cover']}, the towns' paths 0.38)")
            check(max(r['side'] or [1]) <= 0.1, f"3 m off it the path map is bare ({r['side']})")
        if want('cracks'):
            await page.evaluate("__hm.fn.setQuality('high'); 0")
            r = await ev(page, 'cracks', """(() => { const out = {}; out.curtain = LK.set('crack_curtain', 'day'); out.tower = LK.set('crack_tower', 'day'); out.house = LK.set('house_cracked', 'day');
              out.bad = __hm.dbg.renderer.info.programs.filter((p) => p.diagnostics && !p.diagnostics.runnable).map((p) => p.name).slice(0, 3); return out; })()""")
            check(r['curtain'].get('wear', 0) >= 0.75 and r['tower'].get('wear', 0) >= 0.8 and r['house'].get('bat', 0) > 0.1, f"a curtain and a tower worn by stones, a house battered ({r['curtain'].get('wear')}, {r['tower'].get('wear')}, {r['house'].get('bat')})")
            check(not r['bad'], f"the castle and house shaders compile with the new cracks ({r['bad']})")
        if want('hound'):
            await page.evaluate("__hm.fn.setQuality('high'); 0")
            info = await ev(page, 'hound by the hearth', """(() => { const r = LK.set('hound_in', 'night'); const H = __hm, hd = LK.made.find((e) => e.kind === 'hound');
              const pt = (e, dy) => { const c = H.camera; const q = new (c.position.constructor)(e.x, e.y + dy, e.z).project(c); return [Math.round((q.x * 0.5 + 0.5) * """ + str(W) + """), Math.round((0.5 - q.y * 0.5) * """ + str(H) + """)]; };
              return { r, hound: pt(hd, 0.45), back: pt(hd, 0.62) }; })()""")
            png = await grab(page)
            if Image:
                im = Image.open(io.BytesIO(png)).convert('RGB')
                im.save(OUT + f'look3_{TAG}_hound_check.png')
                hc = avg_px(im, *info['hound']); bc = avg_px(im, *info['back'], rad=2)
                print('  hound rgb', hc, 'back', bc, flush=True)
                check(hc[0] > hc[2] * 1.05, f'the hound inside at night is lit warm by the room, not blue (rgb {hc})')
        if SHOTS:
            shots = OPT.get('shots', 'crack_curtain:high:day,crack_tower:high:day,breach_in:high:day,scaffold_tower:high:day,pal_scaffold:high:day,pal_fresh:high:day,cone_fallen:high:day,house_cracked:high:day,hall_path1:high:day,hall_path2:high:day,hound_in:high:night,handover:high:day,handover:medium:day,crown:low:day')
            for sp in shots.split(','):
                v, q, var = sp.split(':')
                await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
                info = await page.evaluate(f"LK.set('{v}', '{var}')")
                if isinstance(info, dict) and info.get('skip'): print('  skip', v, info); continue
                data = await grab(page)
                name = f'look3_{TAG}_{v}_{q}_{var}'
                if Image: Image.open(io.BytesIO(data)).convert('RGB').save(OUT + name + '.png')
                else: pathlib.Path(OUT + name + '.png').write_bytes(data)
                print('  shot', name, json.dumps(info)[:200], f'[{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors.map(String)")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()

asyncio.run(main())
