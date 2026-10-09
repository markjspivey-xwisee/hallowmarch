"""Hallowmarch harness: loads the page wrapped like the host does, serves three.js locally,
stubs web fonts, drives window.__hm, and takes screenshots.
usage: python3 tools/hm.py '{"w":1280,"h":720,"script":[["eval","..."],["shot","name"],["wait",500]]}'"""
import asyncio, json, sys, time, pathlib, os
from playwright.async_api import async_playwright

HERE = pathlib.Path(__file__).resolve().parent
HTML = pathlib.Path(os.environ.get('HM_HTML', HERE.parent / 'hallowmarch.html'))
THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js'
THREE_LOCAL = pathlib.Path(os.environ.get('HM_THREE', HERE / 'node_modules/three/build/three.module.min.js'))
OUT = pathlib.Path(os.environ.get('HM_OUT', HERE / 'out')); OUT.mkdir(exist_ok=True)

SKELETON = """<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<style>:root{padding-top:env(safe-area-inset-top,0px);padding-bottom:env(safe-area-inset-bottom,0px);color-scheme:light}body{margin:0;font:14px system-ui;background:#fafafa}img{max-width:100%}[hidden]{display:none!important}</style>
</head><body>%s</body></html>"""

async def run(spec):
    script = spec['script']
    w, h, dpr = spec.get('w', 1280), spec.get('h', 720), spec.get('dpr', 1)
    touch = spec.get('touch', False)
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        ctx = await b.new_context(viewport={'width': w, 'height': h}, device_scale_factor=dpr, has_touch=touch, is_mobile=touch)
        page = await ctx.new_page()
        logs = []
        page.on('console', lambda m: logs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: logs.append(f'[pageerror] {e}'))
        async def three_route(route):
            await route.fulfill(status=200, content_type='application/javascript', body=THREE_LOCAL.read_text(), headers={'Access-Control-Allow-Origin': '*'})
        await page.route(THREE_URL, three_route)
        async def font_route(route):
            await route.fulfill(status=200, content_type='text/css', body='')
        await page.route('https://fonts.googleapis.com/**', font_route)
        await page.route('https://fonts.gstatic.com/**', font_route)
        async def doc_route(route):
            body = HTML.read_text() if os.environ.get('HM_RAW') else SKELETON.replace('%s', HTML.read_text())
            await route.fulfill(status=200, content_type='text/html', body=body)
        await page.route('http://hm.test/', doc_route)
        t0 = time.time()
        await page.goto('http://hm.test/', wait_until='commit', timeout=120000)
        try:
            await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
        except Exception as e:
            print('READY TIMEOUT', e)
        print(f'ready in {time.time()-t0:.1f}s')
        def expand(steps):
            for st in steps:
                if st[0] == 'repeat':
                    for _ in range(st[1]):
                        yield from expand(st[2])
                else:
                    yield st
        for step in expand(script):
            kind = step[0]
            try:
                if kind == 'eval':
                    r = await page.evaluate(step[1])
                    if r is not None: print('eval ->', json.dumps(r, indent=None)[:4000])
                elif kind == 'shot':
                    path = OUT / f'{step[1]}.png'
                    await page.screenshot(path=str(path), timeout=300000)
                    print('saved', path)
                elif kind == 'mouse':
                    await page.mouse.move(step[1], step[2])
                elif kind == 'click':
                    await page.mouse.click(step[1], step[2], button=step[3] if len(step) > 3 else 'left')
                elif kind == 'tap':
                    await page.touchscreen.tap(step[1], step[2])
                elif kind == 'drag':
                    x0, y0, x1, y1 = step[1:5]
                    await page.mouse.move(x0, y0); await page.mouse.down()
                    for i in range(1, 9):
                        await page.mouse.move(x0 + (x1 - x0) * i / 8, y0 + (y1 - y0) * i / 8)
                    await page.mouse.up()
                elif kind == 'key':
                    await page.keyboard.press(step[1])
                elif kind == 'keydown':
                    await page.keyboard.down(step[1])
                elif kind == 'keyup':
                    await page.keyboard.up(step[1])
                elif kind == 'selector':
                    await page.click(step[1], timeout=20000)
                elif kind == 'wait':
                    await page.wait_for_timeout(step[1])
            except Exception as e:
                print('STEP FAILED', step[:2], e)
        for l in logs[-40:]:
            print(l)
        await b.close()

if __name__ == '__main__':
    arg = sys.argv[1]
    spec = json.loads(open(arg[1:]).read() if arg.startswith('@') else arg)
    asyncio.run(run(spec))
