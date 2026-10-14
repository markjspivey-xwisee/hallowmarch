"""[look] The whole world as a player sees it: a gallery of fixed views of every kind of place and thing, at high, medium
and low, by day, at dusk and at night, in rain and snow and through the seasons, plus the checks that look for what
clips, floats or sinks anywhere in the world (not feature by feature).
usage: python3 tools/tests/look.py [views=a,b,...|group] [q=high,medium,low] [v=day,dusk,night,rain,snow,spring,autumn,winter]
                                   [tag=now] [w=640] [h=360] [noshots] [nochecks] [list]
       python3 tools/tests/look.py serve [w=640] [h=360] [q=high]   (boots once, then runs commands dropped in tools/out/look_cmd/)
  The views live in tools/tests/look_views.js (window.LK.views); `list` prints them by group. Groups: towns, keeps, sites,
  frontier, nature, water, mountains, bodies, barrow, dragon, all (default: all).
  Writes tools/out/look_<tag>_<view>_<q>_<variant>.png. Every view comes from a fixed camera (or the play camera behind the
  player, as a player sees it), the HUD hidden; v= variants are applied on top of each view: the time of day (day, dusk,
  night, dawn), the weather (rain, snow: a winter's snow lying, storm, mist) and the season (spring, summer, autumn, winter).
  Checks (unless nochecks; LK.check()): nothing a system placed stands inside something solid or floats or sinks
  (trees, rocks, outcrops, crags, forage plants, herbs, workstations, furniture, boats, beds and plants against colliders,
  floors, roads and water), people standing in the towns and keeps on their floors, no grass on a floor; no runtime errors.
  serve: each tools/out/look_cmd/<id>.json ({"js": "...", "shot": "name"?, "q": "low"?, "frames": 2?}) is run and answered in
  tools/out/look_cmd/<id>.out.json; {"reload": true} re-reads look_views.js; {"quit": true} ends it."""
import json, asyncio, sys, time, pathlib, base64, io, os
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from hmlib import OUT
from playwright.async_api import async_playwright
try:
    from PIL import Image
except ImportError:
    Image = None

ARGS = sys.argv[1:]
def opt(name, default=None):
    for a in ARGS:
        if a.startswith(name + '='): return a.split('=', 1)[1]
    return default
FLAGS = {a for a in ARGS if '=' not in a}
TAG = opt('tag', 'now')
W, H = int(opt('w', 640)), int(opt('h', 360))
QS = opt('q', 'high').split(',')
VARIANTS = opt('v', 'day').split(',')
VIEWS_JS = pathlib.Path(__file__).resolve().parent / 'look_views.js'
T0 = time.time()
FAILS = []
def check(cond, what):
    print(('  ok   ' if cond else '  FAIL ') + what, flush=True)
    if not cond: FAILS.append(what)

# Math.random seeded (the land and the war come out the same on every boot) and a hold on the game's own animation frames:
# while window.__rafHold is set the main loop waits, so only the frames asked for are drawn (SwiftShader is slow)
HOLD = """(() => { let s = 1234567; Math.random = () => { s |= 0; s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; })();
(() => { window.__rafHold = false; const raf = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = (cb) => raf((t) => { if (window.__rafHold) window.requestAnimationFrame(cb); else cb(t); }); })();"""

async def setup(p, w, h, touch=False):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
    page = await ctx.new_page()
    await page.add_init_script(HOLD)
    # [look7] others in the March: the stand-in room (00n_netstub.js), so look7's views can draw remote players (net_fake.js)
    if 'net' in FLAGS: await page.add_init_script("window.__HM_NET = { room: 'look7' };")
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
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=300000, polling=500)
    return b, page, logs

async def grab(page, path, frames=2):
    url = await page.evaluate(f"(() => {{ for (let i = 0; i < {frames}; i++) __hm.frame(1/30); return __hm.dbg.renderer.domElement.toDataURL('image/png'); }})()")
    data = base64.b64decode(url.split(',', 1)[1])
    if Image: Image.open(io.BytesIO(data)).convert('RGB').save(path)
    else: pathlib.Path(path).write_bytes(data)

async def start(page):
    await page.evaluate("__hm.start({realm:0, cls:'warrior', level:30}); 0")
    await page.evaluate(VIEWS_JS.read_text() + '\n;0')
    # the war gets going and the towns wake up, then the world holds still between the views
    await page.evaluate("LK.boot(); 0")

async def serve():
    cmd = OUT_DIR = pathlib.Path(str(OUT)) / 'look_cmd'
    cmd.mkdir(exist_ok=True)
    for f in cmd.glob('*'): f.unlink()
    q0 = opt('q', 'high')
    async with async_playwright() as p:
        b, page, logs = await setup(p, W, H)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await start(page)
        await page.evaluate(f"__hm.fn.setQuality('{q0}'); 0")
        print(f'started [{time.time() - T0:.0f}s]', flush=True)
        (cmd / 'READY').write_text('1')
        while True:
            jobs = sorted([f for f in cmd.glob('*.json') if not f.name.endswith('.out.json')], key=lambda f: f.stat().st_mtime)
            if not jobs:
                await asyncio.sleep(0.4); continue
            f = jobs[0]
            try: c = json.loads(f.read_text())
            except Exception as e:
                await asyncio.sleep(0.3)
                try: c = json.loads(f.read_text())
                except Exception: f.unlink(); continue
            f.unlink()
            out = {'id': f.stem}
            t = time.time()
            try:
                if c.get('quit'): (cmd / (f.stem + '.out.json')).write_text(json.dumps({'bye': 1})); break
                if c.get('reload'): await page.evaluate(VIEWS_JS.read_text() + '\n;0'); out['reloaded'] = True
                if c.get('vp'): await page.set_viewport_size({'width': c['vp'][0], 'height': c['vp'][1]}); await page.evaluate("__hm.frame(1/30); 0"); out['vp'] = c['vp']  # [look5] a phone's screen or a desk's
                if c.get('q'): await page.evaluate(f"__hm.fn.setQuality('{c['q']}'); 0")
                if c.get('js'): out['r'] = await page.evaluate(c['js'])
                if c.get('shot') and not (isinstance(out.get('r'), dict) and out['r'].get('skip')):
                    path = str(OUT) + '/' + c['shot'] + '.png'
                    await grab(page, path, c.get('frames', 2)); out['shot'] = path
                out['errors'] = await page.evaluate("__hm.errors.slice(-5).map(String)")
            except Exception as e:
                out['exc'] = str(e)[:2000]
            out['sec'] = round(time.time() - t, 1)
            out['logs'] = logs[-5:]
            (cmd / (f.stem + '.out.json')).write_text(json.dumps(out, indent=1)[:200000])
        await b.close()

async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, W, H)
        print(f'booted [{time.time() - T0:.0f}s]', flush=True)
        await start(page)
        groups = await page.evaluate("LK.groups()")
        if 'list' in FLAGS:
            for g, vs in groups.items(): print(f'{g}: {", ".join(vs)}')
            await b.close(); return
        sel = opt('views', 'all').split(',')
        views = []
        for s in sel:
            if s == 'all': views += [v for g in groups.values() for v in g]
            elif s in groups: views += groups[s]
            else: views.append(s)
        print(f'started [{time.time() - T0:.0f}s]; {len(views)} views x {len(QS)} qualities x {len(VARIANTS)} variants', flush=True)
        if 'nochecks' not in FLAGS:
            r = await page.evaluate("LK.check()")
            print('checks', json.dumps(r)[:3000], flush=True)
            for k, v in r['counts'].items():
                check(v == 0, f"{k}: {v}" + (f"  e.g. {json.dumps(r['examples'].get(k, [])[:3])}" if v else ''))
        if 'noshots' not in FLAGS:
            for q in QS:
                await page.evaluate(f"__hm.fn.setQuality('{q}'); 0")
                for v in views:
                    for var in VARIANTS:
                        try:
                            info = await page.evaluate(f"LK.set('{v}', '{var}')")
                        except Exception as e:
                            print(f'  view {v} {var} failed: {str(e)[:300]}', flush=True); continue
                        if info is None or (isinstance(info, dict) and info.get('skip')):
                            print(f'  skip {v} {var}', flush=True); continue
                        name = f'look_{TAG}_{v}_{q}_{var}'
                        await grab(page, OUT + name + '.png', 2)
                        ri = await page.evaluate("(() => { const r = __hm.renderInfo(); return [r.calls, r.triangles]; })()")
                        print(f'  shot {name} {json.dumps(info)[:300]} calls/tris {ri} [{time.time() - T0:.0f}s]', flush=True)
        errs = await page.evaluate("__hm.errors.map(String)")
        check(not errs, 'no runtime errors ' + json.dumps(errs)[:600])
        if logs: print('logs', logs[:4])
        print('FAILED:' if FAILS else 'ALL PASSED', FAILS, flush=True)
        await b.close()

asyncio.run(serve() if 'serve' in FLAGS else main())
