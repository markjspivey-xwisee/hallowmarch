"""Real touch completion receipts for the mobile HUD test driver, without WebGL."""
import unittest

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
                  window.__hm={guide2:{G2:{tap:{pending:false,until:0}}},hud:{HUDL:{},hudLayout(){}}};
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


if __name__ == '__main__':
    unittest.main()
