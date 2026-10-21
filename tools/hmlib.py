"""Shared setup for the Playwright tests: boots the built page in headless Chromium (SwiftShader WebGL)
with three.js served locally and web fonts stubbed, then waits for window.__hm.ready."""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import hm
from playwright.async_api import async_playwright
OUT = str(hm.OUT) + '/'

async def setup(p, touch=False, w=800, h=450, init=None):
    b = await p.chromium.launch(args=['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'])
    ctx = await b.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
    page = await ctx.new_page()
    if init: await page.add_init_script(init)  # [war3] a script before the page's own (perf.py budget: Math.random seeded, the frames held)
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
    await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
    await page.evaluate("__hm.fn.setQuality('low')")
    return b, page, logs

async def human_play(page):
    """Give an active-play fixture one real, trusted browser interaction.

    Call this after programmatic character/scene setup and before active simulation
    workloads. Pressing and releasing Shift provides real input without moving or attacking. There
    is no repeating input or product override: title, menu, hidden and idle checks
    should keep using page.evaluate without this explicit test-operator action.
    """
    await page.bring_to_front()
    await page.keyboard.press('Shift')
