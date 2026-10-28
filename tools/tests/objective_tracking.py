"""Choose a later objective through the actual game on desk and phone, without earning its rewards.
All gameplay is synthetic in a local fixture; no identity, player pod or hosted world is used.
"""
import asyncio
import json
import pathlib
import sys

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from hmlib import setup, OUT
from playwright.async_api import async_playwright


async def main():
    failures = []
    async with async_playwright() as p:
        browser, page, errors = await setup(p, touch=True, w=390, h=780)
        try:
            await page.emulate_media(reduced_motion='reduce')
            # The local fixture needs no external services after its local assets loaded.
            await page.route('**/*', lambda route: route.abort())
            await page.evaluate("""(async () => {
              await __hm.start({realm:0,cls:'warrior',level:1});
              __hm.LORE.closePrologue();
              __hm.LORE.state.noteUntil=performance.now()+1e9;
              const raf=requestAnimationFrame.bind(window);
              window.requestAnimationFrame=cb=>raf(()=>{});
              return 0;
            })()""")
            for width, height in [(320, 740), (390, 780), (1280, 800)]:
                await page.set_viewport_size({'width': width, 'height': height})
                await page.evaluate("""(() => {
                  delete __hm.GAME.prog.lore.track;
                  __hm.GAME.prog.lore.done=[];
                  __hm.LORE.openChronicle('path');
                  return 0;
                })()""")
                before = await page.evaluate("JSON.stringify({xp:__hm.GAME.prog.xp,level:__hm.GAME.prog.level,gold:__hm.INV.gold,potions:__hm.INV.potions,done:__hm.GAME.prog.lore.done})")
                await page.locator('#menu-body details').last.locator('summary').click()
                await page.locator('[data-lore="track:cook"]').click()
                chosen = await page.evaluate("""(() => {
                  const li=document.querySelector('#menu-body .steps li.cur'), box=document.getElementById('menu-body');
                  return {next:__hm.LORE.pathNext().id,focus:document.activeElement===li,
                    hint:li.textContent,overflow:box.scrollWidth-box.clientWidth,
                    save:__hm.LORE.fn.loreSanitize(__hm.LORE.fn.loreSaveData()).track,
                    earned:JSON.stringify({xp:__hm.GAME.prog.xp,level:__hm.GAME.prog.level,gold:__hm.INV.gold,potions:__hm.INV.potions,done:__hm.GAME.prog.lore.done})};
                })()""")
                assert chosen['next'] == 'cook', chosen
                assert chosen['focus'], chosen
                assert 'Cook a meal' in chosen['hint'] and ('Hunt' in chosen['hint'] or 'cook your raw' in chosen['hint']), chosen
                assert chosen['overflow'] <= 1, chosen
                assert chosen['save'] == 'cook', chosen
                assert chosen['earned'] == before, chosen
                await page.screenshot(path=OUT + f'objective_tracking_{width}.png', timeout=300000)
                print(f'PASS {width}x{height}: later objective selected, instructions visible, focus retained, no rewards, no horizontal overflow', flush=True)
                await page.evaluate("__hm.UI.modal=null;document.getElementById('menu').hidden=true;__hm.frame(1/30);0")
                assert await page.locator('#lore-path').get_attribute('hidden') is None
                assert 'Cook a meal' in await page.locator('#lore-path').inner_text()
            assert not errors, errors
            print('PASS all objective tracking flows; no game errors', flush=True)
        except Exception as error:
            failures.append(str(error))
            print('FAIL', json.dumps(failures), flush=True)
            raise
        finally:
            await browser.close()


asyncio.run(main())
