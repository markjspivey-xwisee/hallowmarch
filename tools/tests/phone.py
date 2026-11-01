"""Phone layout: screenshots of the HUD and the kit screen at 390x780 with touch input."""
import asyncio, sys
import sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT, human_play
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=True, w=390, h=780)
        await page.evaluate("__hm.start({realm:1, cls:'priest', level:20})")
        await human_play(page)
        for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        await page.screenshot(path=OUT + 'phone_hud.png', timeout=300000)
        await page.evaluate("__hm.fn.openKit('kit')")
        for _ in range(2): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        await page.screenshot(path=OUT + 'phone_kit.png', timeout=300000)
        print('errors', await page.evaluate("__hm.errors"))
        await b.close()
asyncio.run(main())
