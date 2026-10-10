"""The callings on a phone: the class panel and the technique and hold buttons at 390x780 with touch input,
for each calling (screenshots cls_phone_<class>.png), plus a check that holding the touch button blocks or draws."""
import asyncio, sys, pathlib, json
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright

async def frames(page, n=3):
    for _ in range(n): await page.evaluate("new Promise(r=>requestAnimationFrame(()=>r()))")

async def main():
    fails = []
    async with async_playwright() as p:
        b, page, logs = await setup(p, touch=True, w=390, h=780)
        for cls, realm, lvl in (('warrior', 0, 30), ('archer', 1, 30), ('mage', 2, 30), ('priest', 1, 30)):
            await page.evaluate(f"(() => {{ const H = __hm; if (H.GAME.player) H.fn.newCharacter(); H.start({{ realm: {realm}, cls: '{cls}', level: {lvl} }}); return 0; }})()")
            await frames(page, 3)
            # the hold button really holds: press it, check the state, let go
            box = await page.evaluate("(() => { const b = document.querySelector('#tpad .cls-btn.hold'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width }; })()")
            if not box: fails.append(f'{cls}: no hold button'); continue
            await page.mouse.move(box['x'], box['y'])
            await page.evaluate("""(() => { const b = document.querySelector('#tpad .cls-btn.hold'); b.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 7, pointerType: 'touch' })); return 0; })()""")
            await page.evaluate("__hm.simulate(0.6); 0")
            st = await page.evaluate("__hm.cls.state()")
            print(cls, json.dumps(st))
            ok = st['block'] if cls == 'warrior' else st['draw'] > 0.2 if cls == 'archer' else st['praying'] if cls == 'priest' else True
            if not ok: fails.append(f'{cls}: holding the button did nothing')
            await frames(page, 2)
            await page.screenshot(path=OUT + f'cls_phone_{cls}.png', timeout=300000)
            await page.evaluate("""(() => { const b = document.querySelector('#tpad .cls-btn.hold'); b.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 7, pointerType: 'touch' })); return 0; })()""")
            # overlaps: the class panel must not cover the pad, the frames or the minimap
            ov = await page.evaluate("""(() => { const r = (s) => { const e = document.querySelector(s); if (!e || e.hidden || !e.offsetParent) return null; return e.getBoundingClientRect(); };
              const hit = (a, b) => a && b && a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
              const c = r('#cls'); const out = {};
              for (const s of ['#tpad', '#pf', '#tf', '#topright', '#tpad .cls-btn.tech', '#tpad .cls-btn.hold', '#tpad .gslot']) out[s] = hit(c, r(s));
              out.cls = c && [Math.round(c.left), Math.round(c.top), Math.round(c.width), Math.round(c.height)];
              out.vw = innerWidth; out.fits = c ? c.left >= 0 && c.right <= innerWidth : false; return out; })()""")
            print('  layout', json.dumps(ov))
            for k, v in ov.items():
                if k.startswith('#') and v: fails.append(f'{cls}: class panel overlaps {k}')
            if not ov['fits']: fails.append(f'{cls}: class panel runs off the screen')
        errs = await page.evaluate("__hm.errors.slice(0, 3)")
        if errs: fails.append(f'errors {errs}')
        await b.close()
    print('FAILED: ' + '; '.join(fails) if fails else 'all checks passed')
    sys.exit(1 if fails else 0)

asyncio.run(main())
