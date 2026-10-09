"""Compile every material at high, medium and low quality, outdoors and at night; print any shader errors."""
import asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup
from playwright.async_api import async_playwright
async def main():
    async with async_playwright() as p:
        b, page, logs = await setup(p, w=640, h=360)
        msgs = []
        page.on('console', lambda m: msgs.append(m.text) if m.type in ('error', 'warning') else None)
        for q in ['high', 'medium', 'low']:
            await page.evaluate(f"__hm.fn.setQuality('{q}')")
            if q == 'high': await page.evaluate("__hm.start({realm:0, cls:'warrior', level:15})")
            for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        await page.evaluate("__hm.setTod(2.1)")
        for _ in range(3): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")
        print('console:', [m[:400] for m in msgs][:6])
        print('errors', await page.evaluate("__hm.errors"))
        print('programs', await page.evaluate("__hm.renderInfo().programs"))
        print('bad programs', await page.evaluate("__hm.dbg.renderer.info.programs.filter(p => p.diagnostics && !p.diagnostics.runnable).map(p => p.name + ': ' + (p.diagnostics.fragmentShader.log || '') + (p.diagnostics.vertexShader.log || '')).map(s => s.slice(0, 300))"))
        await b.close()
asyncio.run(main())
