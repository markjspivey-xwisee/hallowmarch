#!/usr/bin/env python3
"""Direct-page graphics startup regression. Software WebGL is not GPU compatibility evidence."""
import asyncio, json, pathlib, sys, traceback
from urllib.parse import parse_qsl, urlencode, urlsplit
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
import hm
from playwright.async_api import async_playwright, expect
ORIGIN = 'http://hm.test'
REASON = 'Web page caused context loss and was blocked'
ARGS = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist']

def check(ok, label):
    if not ok:
        raise AssertionError(label)
    print('check', label, 'PASS', flush=True)

async def direct_page(browser, w, h, touch=False, init=None):
    ctx = await browser.new_context(viewport={'width': w, 'height': h}, has_touch=touch, is_mobile=touch)
    page = await ctx.new_page()
    page.set_default_timeout(30000)
    if init: await page.add_init_script(init)
    errors, console_errors, navigations = [], [], []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.on('console', lambda msg: console_errors.append(msg.text) if msg.type == 'error' else None)
    page.on('framenavigated', lambda frame: navigations.append(frame.url) if frame == page.main_frame else None)
    three, html = hm.THREE_LOCAL.read_text(encoding='utf-8'), hm.HTML.read_text(encoding='utf-8')
    async def three_route(route):
        await route.fulfill(status=200, content_type='application/javascript', body=three,
                            headers={'Access-Control-Allow-Origin': '*'})
    async def font_route(route): await route.fulfill(status=200, content_type='text/css', body='')
    async def doc_route(route): await route.fulfill(status=200, content_type='text/html', body=html)
    await page.route(hm.THREE_URL, three_route)
    await page.route('https://fonts.googleapis.com/**', font_route)
    await page.route('https://fonts.gstatic.com/**', font_route)
    await page.route(ORIGIN + '/**', doc_route)
    return ctx, page, errors, console_errors, navigations

FAIL_CONTEXT = r"""(() => {
 const original = HTMLCanvasElement.prototype.getContext;
 window.__hmWebglRequests = 0;
 HTMLCanvasElement.prototype.getContext = function(kind, ...args) {
  if (['webgl2', 'webgl', 'experimental-webgl'].includes(kind)) {
   window.__hmWebglRequests++;
   const event = new Event('webglcontextcreationerror');
   Object.defineProperty(event, 'statusMessage', {value: 'Web page caused context loss and was blocked'});
   this.dispatchEvent(event); return null;
  }
  return original.call(this, kind, ...args);
 };
})();"""

async def failed_creation(browser, name, w, h, touch=False):
    ctx, page, errors, console_errors, navigations = await direct_page(browser, w, h, touch, FAIL_CONTEXT)
    try:
        params = [('server', 'wss://example.invalid/ws?room=one&mode=two'),
                  ('shard', 'graphics recovery'), ('tag', 'a'), ('tag', 'b'), ('safe', '0')]
        url = ORIGIN + '/?' + urlencode(params) + '#return'
        await page.goto(url, wait_until='commit', timeout=120000)
        panel = page.locator('#nogl')
        await expect(panel).to_be_visible()
        await expect(panel).to_have_attribute('role', 'alert')
        await expect(panel).to_contain_text('Graphics could not start')
        await expect(panel.locator('span').filter(has_text=REASON)).to_have_text(REASON)
        check(await page.locator('#loading').evaluate("el => getComputedStyle(el).display === 'none'"),
              name + ' hides loading after graphics failure')
        check(not await page.evaluate('Boolean(window.__hm && window.__hm.ready)'),
              name + ' does not report failed renderer as ready')
        link = panel.locator('a')
        await expect(link).to_be_visible()
        target = urlsplit(await link.evaluate('el => el.href'))
        check(parse_qsl(target.query, keep_blank_values=True) == [(k, '1' if k == 'safe' else v) for k,v in params],
              name + ' retry preserves server and repeated query values')
        check(target.scheme + '://' + target.netloc == ORIGIN and target.path == '/' and target.fragment == 'return',
              name + ' retry remains on same page and preserves fragment')
        requests = await page.evaluate('window.__hmWebglRequests')
        await page.wait_for_timeout(1000)
        check(requests > 0 and await page.evaluate('window.__hmWebglRequests') == requests,
              name + ' has no automatic context retry')
        check(len(navigations) == 1 and page.url == url, name + ' has no automatic navigation')
        await page.screenshot(path=str(hm.OUT / ('startup-failure-' + name + '.png')), timeout=120000)
    finally:
        await ctx.close()

async def safe_boot(browser):
    saved = {'v':1, 'char':None, 'settings':{'quality':'high', 'auto':True}, 'world':None,
             'startupRegression':'preserve-this-existing-save'}
    text = json.dumps(saved, separators=(',', ':'))
    init = 'localStorage.setItem("hallowmarch.save.v1", ' + json.dumps(text) + ');'
    ctx,page,errors,console_errors,navigations = await direct_page(browser,800,450,init=init)
    try:
        await page.goto(ORIGIN + '/?safe=1&server=', wait_until='commit', timeout=120000)
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
        st = await page.evaluate("""() => ({
          level:__hm.quality.level, auto:__hm.quality.auto, msaa:__hm.quality.msaa, errors:[...__hm.errors],
          savedQuality:__hm.SAVE.loaded && __hm.SAVE.loaded.settings.quality,
          webgl2:__hm.dbg.renderer.capabilities.isWebGL2, calls:__hm.renderInfo().calls,
          stored:localStorage.getItem('hallowmarch.save.v1')
        })""")
        check(st['level']=='low' and st['auto'] is False and st['msaa']==0, 'safe startup selects low without MSAA')
        check(st['savedQuality']=='high', 'real save loader reads previous high preference')
        check(st['stored']==text, 'safe startup preserves stored save')
        check(st['webgl2'] and st['calls']>0, 'safe startup renders with software WebGL 2')
        check(not st['errors'] and not errors and not console_errors, 'safe startup has no runtime errors')
        await expect(page.locator('#title')).to_be_visible()
        await page.wait_for_function("document.getElementById('loading').hidden || getComputedStyle(document.getElementById('loading')).display === 'none'", timeout=30000)
        await page.screenshot(path=str(hm.OUT / 'startup-safe-title.png'), timeout=120000)
        await page.evaluate("__hm.fn.openMenu('settings')")
        await expect(page.locator('#set-q button')).to_have_count(3)
        await expect(page.locator('#set-q [data-v=low]')).to_have_attribute('aria-checked','true')
        check(await page.locator('#set-q [data-v=medium]').is_visible() and await page.locator('#set-q [data-v=high]').is_visible(),
              'safe startup keeps graphics controls available')
        await asyncio.wait_for(page.evaluate("__hm.fn.setQuality('medium')"), timeout=120)
        check(await page.evaluate("__hm.quality.level === 'medium' && __hm.quality.auto === false"), 'safe startup permits manual quality changes')
        check(not await page.evaluate('__hm.errors') and not errors and not console_errors, 'manual quality change has no runtime errors')
        check(len(navigations)==1, 'safe startup has no automatic navigation')
    finally:
        await ctx.close()

async def main():
    hm.OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        try:
            await failed_creation(browser,'desktop',1280,720)
            await failed_creation(browser,'phone',390,844,True)
            await safe_boot(browser)
        finally:
            await browser.close()
    print('check startup graphics regression PASS', flush=True)

if __name__ == '__main__':
    try: asyncio.run(main())
    except Exception:
        print('FAIL startup graphics regression', flush=True)
        traceback.print_exc()
        sys.exit(1)
