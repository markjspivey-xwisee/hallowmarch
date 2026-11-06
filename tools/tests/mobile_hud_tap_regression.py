"""Real touch completion receipts for the mobile HUD test driver, without WebGL."""
import unittest
import asyncio

from playwright.async_api import async_playwright

import mobile_hud


class MobileHudTapRegression(unittest.IsolatedAsyncioTestCase):
    async def test_dialog_close_finishes_before_followup_even_when_hud_click_flag_is_false(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, args=['--disable-gpu'])
            try:
                page = await browser.new_page(viewport={'width': 393, 'height': 660}, has_touch=True, is_mobile=True)
                await page.set_content('''<!doctype html>
                  <meta name="viewport" content="width=device-width,initial-scale=1">
                  <style>[hidden]{display:none!important}button{min-width:120px;min-height:48px;touch-action:manipulation}
                  #menu{position:fixed;inset:0;background:#ddd}#menu-close{position:absolute;top:20px;right:20px}</style>
                  <div id="hud"><button id="mobile-menu-toggle">Menu</button></div>
                  <div id="menu"><button id="menu-close">Back to game</button></div>
                  <div id="mobile-tray" hidden>Explore</div>''')
                await page.evaluate('''() => {
                  window.__hm={UI:{modal:null},guide2:{G2:{tap:{pending:false,until:0}}},hud:{HUDL:{},hudLayout(){}}};
                  window.tapEvents=[];
                  document.getElementById('menu-close').onclick=event=>{
                    tapEvents.push({type:'close-click',trusted:event.isTrusted});
                    setTimeout(()=>{document.getElementById('menu').hidden=true;tapEvents.push({type:'closed'});},80);
                  };
                  document.getElementById('mobile-menu-toggle').onclick=event=>{
                    tapEvents.push({type:'followup-click',trusted:event.isTrusted});
                    document.getElementById('mobile-tray').hidden=false;
                  };
                }''')
                await page.evaluate(mobile_hud.HELP)
                self.assertFalse(await page.evaluate('__hm.guide2.G2.tap.pending'))
                await mobile_hud.tap(page, '#menu-close', closes='#menu')
                self.assertFalse(await page.locator('#menu').is_visible(), 'the close action must finish before the next control is measured')
                receipt = await page.evaluate('window.__mobileTapClickReceipt')
                self.assertEqual(receipt, {'clicked': True, 'trusted': True})
                await mobile_hud.tap(page, '#mobile-menu-toggle')
                self.assertTrue(await page.locator('#mobile-tray').is_visible())
                self.assertEqual(await page.evaluate('tapEvents.map(event=>event.type)'),
                                 ['close-click', 'closed', 'followup-click'])
                self.assertTrue(await page.evaluate('tapEvents.filter(event=>event.type.endsWith("click")).every(event=>event.trusted)'))
                self.assertEqual(await page.evaluate('window.__mobileTapClickCleanup'), None)
            finally:
                await browser.close()

    async def test_hidden_sheet_does_not_finish_close_until_gameplay_controls_are_released(self):
        async with async_playwright() as playwright:
            browser = await playwright.chromium.launch(headless=True, args=['--disable-gpu'])
            try:
                page = await browser.new_page(viewport={'width': 393, 'height': 660}, has_touch=True, is_mobile=True)
                await page.set_content('''<!doctype html>
                  <meta name="viewport" content="width=device-width,initial-scale=1">
                  <style>[hidden]{display:none!important}button{min-width:120px;min-height:48px;touch-action:manipulation}
                  .mobile-modal-open #hud{visibility:hidden}#menu{position:fixed;inset:0;background:#ddd}
                  #menu-close{position:absolute;top:20px;right:20px}</style>
                  <body class="mobile-modal-open"><div id="hud" inert><button id="mobile-menu-toggle">Menu</button></div>
                  <div id="menu"><button id="menu-close">Back to game</button></div>
                  <div id="mobile-tray" hidden>Explore</div>''')
                await page.evaluate('''() => {
                  window.__hm={UI:{modal:'menu'},guide2:{G2:{tap:{pending:false,until:0}}},hud:{HUDL:{},hudLayout(){}}};
                  window.tapEvents=[];
                  document.getElementById('menu-close').onclick=event=>{
                    tapEvents.push({type:'close-click',trusted:event.isTrusted});
                    document.getElementById('menu').hidden=true;
                    window.releaseGameplayControls=()=>{
                      __hm.UI.modal=null;document.body.classList.remove('mobile-modal-open');document.getElementById('hud').inert=false;
                      tapEvents.push({type:'controls-released'});
                    };
                  };
                  document.getElementById('mobile-menu-toggle').onclick=event=>{
                    tapEvents.push({type:'followup-click',trusted:event.isTrusted});document.getElementById('mobile-tray').hidden=false;
                  };
                }''')
                await page.evaluate(mobile_hud.HELP)
                readiness_started = asyncio.Event()

                class ObservedPage:
                    """Observe the driver's readiness wait without releasing the UI early."""
                    def __getattr__(self, name):
                        return getattr(page, name)

                    async def wait_for_function(self, expression, **kwargs):
                        if 'mobile-modal-open' in expression and 'hud.inert' in expression:
                            readiness_started.set()
                        return await page.wait_for_function(expression, **kwargs)

                closing = asyncio.create_task(mobile_hud.tap(ObservedPage(), '#menu-close', closes='#menu'))
                waiting = asyncio.create_task(readiness_started.wait())
                try:
                    done, _ = await asyncio.wait([closing, waiting], timeout=15, return_when=asyncio.FIRST_COMPLETED)
                    self.assertTrue(done, 'close must reach completion or the gameplay-readiness boundary')
                    if closing in done:
                        await closing
                        self.assertTrue(await page.locator('#mobile-menu-toggle').is_visible(), 'hidden sheet alone must not finish the close while gameplay controls remain hidden')
                    self.assertTrue(readiness_started.is_set(), 'the driver must wait for gameplay control release')
                    self.assertFalse(closing.done(), 'a hidden sheet cannot finish the close while the UI is still modal')
                    self.assertFalse(await page.locator('#menu').is_visible())
                    self.assertFalse(await page.locator('#mobile-menu-toggle').is_visible())
                    await page.evaluate('releaseGameplayControls()')
                    await closing
                finally:
                    waiting.cancel()
                    if not closing.done():
                        await page.evaluate('releaseGameplayControls?.()')
                        await closing
                self.assertFalse(await page.locator('#menu').is_visible())
                self.assertTrue(await page.locator('#mobile-menu-toggle').is_visible(), 'hidden sheet alone does not prove the next control is ready')
                self.assertEqual(await page.evaluate('({modal:__hm.UI.modal,inert:document.getElementById("hud").inert})'),
                                 {'modal': None, 'inert': False})
                self.assertEqual(await page.evaluate('window.__mobileTapClickReceipt'), {'clicked': True, 'trusted': True})
                await mobile_hud.tap(page, '#mobile-menu-toggle')
                self.assertTrue(await page.locator('#mobile-tray').is_visible())
                self.assertEqual(await page.evaluate('tapEvents.map(event=>event.type)'),
                                 ['close-click', 'controls-released', 'followup-click'])
            finally:
                await browser.close()


if __name__ == '__main__':
    unittest.main()
