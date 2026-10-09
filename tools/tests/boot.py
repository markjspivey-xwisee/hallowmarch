"""Boot the page and print the first console errors; use this when __hm never becomes ready."""
import asyncio, sys
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
        page = await b.new_page(viewport={'width': 320, 'height': 180})
        msgs = []
        page.on('console', lambda m: msgs.append(f'[{m.type}] {m.text}'))
        page.on('pageerror', lambda e: msgs.append(f'[pageerror] {e}'))
        three = hm.THREE_LOCAL.read_text()
        async def three_route(route): await route.fulfill(status=200, content_type='application/javascript', body=three, headers={'Access-Control-Allow-Origin': '*'})
        await page.route(hm.THREE_URL, three_route)
        async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
        await page.route('https://fonts.googleapis.com/**', font_route)
        async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=hm.SKELETON.replace('%s', hm.HTML.read_text()))
        await page.route('http://hm.test/', doc_route)
        await page.goto('http://hm.test/', wait_until='commit')
        for i in range(60):
            await page.wait_for_timeout(2000)
            r = await page.evaluate("[!!(window.__hm && window.__hm.ready), document.getElementById('loadmsg') && document.getElementById('loadmsg').textContent]")
            if r[0]: break
        print(r)
        for m in msgs[:20]: print(m[:1500])
        await b.close()
asyncio.run(main())
