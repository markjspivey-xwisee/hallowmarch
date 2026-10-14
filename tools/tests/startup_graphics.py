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
    await page.add_init_script(TEST_LIFECYCLE)
    if init: await page.add_init_script(init)
    errors, console_errors, navigations = [], [], []
    page.on('crash', lambda: errors.append('PAGE CRASHED'))
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

TEST_LIFECYCLE = r"""(() => {
 window.__hmGraphicsTest = {lost:0, restored:0, creation:[], animationCallbacks:0};
 window.addEventListener('webglcontextlost', (event) => {
  if (event.target && event.target.id === 'scene') window.__hmGraphicsTest.lost++;
 }, true);
 window.addEventListener('webglcontextrestored', (event) => {
  if (event.target && event.target.id === 'scene') window.__hmGraphicsTest.restored++;
 }, true);
 window.addEventListener('webglcontextcreationerror', (event) => {
  window.__hmGraphicsTest.creation.push(String(event.statusMessage || ''));
 }, true);
 const raf = window.requestAnimationFrame;
 window.requestAnimationFrame = function(callback) {
  return raf.call(this, function(time) {
   window.__hmGraphicsTest.animationCallbacks++;
   return callback(time);
  });
 };
})();"""

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
        check(await page.evaluate("document.characterSet === 'UTF-8'"), name + ' uses UTF-8')
        if touch:
            layout = await page.evaluate("({width:innerWidth, panel:document.getElementById('nogl').getBoundingClientRect().width})")
            check(layout['width']==w and w-40 <= layout['panel'] <= w, name + ' uses device-width layout with readable recovery panel')
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

def bounded_recovery(st, label):
    startup = st['startup']
    check(startup['recovery'] and not startup['stopped'] and not startup['lost'],
          label + ' remains in active recovery mode without context loss')
    for kind in ('buffer', 'target'):
        w, h = startup[kind]
        check(w > 0 and h > 0 and max(w, h) <= 1280 and w * h <= 921600,
              label + ' bounds ' + kind + ' dimensions at a 4K viewport')
    check(startup['rtType'] == 1009, label + ' uses an unsigned byte scene target')
    check(startup['bloomTargets'] == 0 and not startup['raysEnabled'],
          label + ' allocates no bloom or ray targets')
    check(startup['weatherGpu'] and not any(startup['weatherGpu'].values()),
          label + ' disables weather GPU passes and their resources')
    check(not startup['legacyClouds'] and startup['rippleTargets'] == 0,
          label + ' disables legacy clouds and water ripple targets')
    check(st['msaa'] == 0, label + ' retains non-MSAA targets')
    check(startup['proactivePrograms'] == 0,
          label + ' avoids bulk scene and shadow shader prewarming')


SNAPSHOT = """() => {
 const renderer = __hm.dbg.renderer, gl = renderer.getContext();
 return {
  ready:__hm.ready, gameReady:__hm.GAME.ready,
  level:__hm.quality.level, auto:__hm.quality.auto, msaa:__hm.quality.msaa,
  errors:[...__hm.errors], lost:gl.isContextLost(),
  t:__hm.GAME.t, calls:__hm.renderInfo().calls,
  savedQuality:__hm.SAVE.loaded && __hm.SAVE.loaded.settings.quality,
  webgl2:renderer.capabilities.isWebGL2,
  stored:localStorage.getItem('hallowmarch.save.v1'),
  lifecycle:{...window.__hmGraphicsTest}, startup:__hm.startup()
 };
}"""


async def context_loss(page, errors, console_errors, navigations):
    before = await page.evaluate(SNAPSHOT)
    stored_before = before['stored']
    counts_before = before['lifecycle']
    supported = await page.evaluate("""() => {
      window.__hmTestLossExtension = __hm.dbg.renderer.getContext().getExtension('WEBGL_lose_context');
      if (!window.__hmTestLossExtension) return false;
      window.__hmTestLossExtension.loseContext();
      return true;
    }""")
    check(supported, 'software browser supports actual context-loss injection')
    await page.wait_for_function('window.__hmGraphicsTest.lost > 0', timeout=30000)
    panel = page.locator('#nogl')
    await expect(panel).to_be_visible()
    await expect(panel).to_have_attribute('role', 'alert')
    check(len((await panel.inner_text()).strip()) > 30,
          'context loss presents a readable diagnostic')
    check(await page.locator('#loading').evaluate("el => getComputedStyle(el).display === 'none'"),
          'context loss removes the loading veil')
    link = panel.locator('a')
    await expect(link).to_be_visible()
    retry = urlsplit(await link.evaluate('el => el.href'))
    check(('safe', '1') in parse_qsl(retry.query, keep_blank_values=True),
          'context loss offers manual recovery with safe URL')
    await page.wait_for_timeout(1000)
    stopped = await page.evaluate(SNAPSHOT)
    check(stopped['lost'] and stopped['startup']['lost'] and stopped['startup']['stopped'],
          'actual context loss latches stopped state')
    check(not stopped['ready'] and not stopped['gameReady'],
          'lost context is never reported ready')
    check(stopped['lifecycle']['lost'] > counts_before['lost'],
          'test observed an actual WebGL context-loss event')
    check(stopped['stored'] == stored_before, 'context loss preserves the latest saved game')
    await page.screenshot(path=str(hm.OUT / 'startup-context-lost.png'), timeout=120000)
    await page.evaluate('window.__hmTestLossExtension.restoreContext()')
    await page.wait_for_function('window.__hmGraphicsTest.restored > 0', timeout=30000)
    restored = await page.evaluate(SNAPSHOT)
    check(not restored['lost'] and restored['startup']['restored'] and restored['startup']['stopped'],
          'restoration leaves the recovery latch set')
    check(not restored['ready'] and not restored['gameReady'],
          'restoration does not restart released game resources')
    await expect(panel).to_be_visible()
    # Intentional loss may log one diagnostic. It must not cause a continuing error loop.
    settled_counts = (len(errors), len(console_errors), len(restored['errors']))
    await page.wait_for_timeout(5000)
    later = await page.evaluate(SNAPSHOT)
    check(later['t'] == restored['t'] and
          later['lifecycle']['animationCallbacks'] == restored['lifecycle']['animationCallbacks'],
          'stopped game schedules no continuing frames after restoration')
    check((len(errors), len(console_errors), len(later['errors'])) == settled_counts,
          'context loss does not cause repeated runtime errors')
    check(len(navigations) == 1, 'restoration does not automatically reload the page')
    check(later['stored'] == stored_before, 'restoration preserves saved game data')


async def safe_boot(browser):
    saved = {'v':1, 'char':None, 'settings':{'quality':'high', 'auto':True}, 'world':None,
             'startupRegression':'preserve-this-existing-save'}
    text = json.dumps(saved, separators=(',', ':'))
    init = 'localStorage.setItem("hallowmarch.save.v1", ' + json.dumps(text) + ');'
    ctx,page,errors,console_errors,navigations = await direct_page(browser,3840,2160,init=init)
    try:
        await page.goto(ORIGIN + '/?safe=1&server=', wait_until='commit', timeout=120000)
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
        st = await page.evaluate(SNAPSHOT)
        check(await page.evaluate("document.characterSet === 'UTF-8'"), 'standalone title uses UTF-8')
        check(st['level']=='low' and st['auto'] is False and st['msaa']==0, 'safe startup selects low without MSAA')
        check(st['savedQuality']=='high', 'real save loader reads previous high preference')
        check(st['stored']==text, 'safe startup preserves stored save')
        check(st['webgl2'] and st['calls']>0, 'safe startup renders with software WebGL 2')
        check(not st['errors'] and not errors and not console_errors, 'safe startup has no runtime errors')
        bounded_recovery(st, 'initial safe startup')
        check(st['startup']['phase'] == 'Ready' and bool(st['startup']['events']),
              'startup trace reports successful boot checkpoints')
        await expect(page.locator('#title')).to_be_visible()
        await page.wait_for_function("document.getElementById('loading').hidden || getComputedStyle(document.getElementById('loading')).display === 'none'", timeout=30000)
        await page.screenshot(path=str(hm.OUT / 'startup-safe-title-4k.png'), timeout=120000)
        await page.wait_for_timeout(30000)
        stable = await page.evaluate(SNAPSHOT)
        bounded_recovery(stable, 'safe startup after 30 seconds')
        check(stable['ready'] and stable['gameReady'] and not stable['lost'] and
              stable['t'] > st['t'] and
              stable['lifecycle']['animationCallbacks'] > st['lifecycle']['animationCallbacks'],
              'safe startup sustains rendered frames for 30 seconds')
        check(stable['lifecycle']['lost'] == 0 and stable['lifecycle']['restored'] == 0,
              'safe startup has no context loss or restoration during observation')
        check(not stable['errors'] and not errors and not console_errors,
              '30-second safe startup observation has no runtime errors')
        (hm.OUT / 'startup-safe-30s.json').write_text(json.dumps(stable, indent=2), encoding='utf-8')
        await page.evaluate("__hm.start(); __hm.fn.openMenu('settings')")
        persisted = await page.evaluate("""async () => {
          await __hm.fn.saveNow();
          const saved = JSON.parse(localStorage.getItem('hallowmarch.save.v1'));
          return {quality:saved.settings.quality, auto:saved.settings.auto, char:!!saved.char};
        }""")
        check(persisted['quality']=='high' and persisted['auto'] is True and persisted['char'],
              'game saves preserve previous graphics preference during recovery')
        await expect(page.locator('#set-q button')).to_have_count(3)
        await expect(page.locator('#set-q [data-v=low]')).to_have_attribute('aria-checked','true')
        check(await page.locator('#set-q [data-v=medium]').is_visible() and await page.locator('#set-q [data-v=high]').is_visible(),
              'safe startup keeps graphics controls available')
        await asyncio.wait_for(page.evaluate("__hm.fn.setQuality('medium')"), timeout=120)
        check(await page.evaluate("__hm.quality.level === 'medium' && __hm.quality.auto === false"), 'safe startup permits manual quality changes')
        explicit = await page.evaluate("""async () => {
          await __hm.fn.saveNow();
          const saved = JSON.parse(localStorage.getItem('hallowmarch.save.v1'));
          return {quality:saved.settings.quality, auto:saved.settings.auto};
        }""")
        check(explicit['quality']=='medium' and explicit['auto'] is False, 'explicit graphics change updates saved preference')
        bounded_recovery(await page.evaluate(SNAPSHOT), 'manual quality change in recovery')
        check(not await page.evaluate('__hm.errors') and not errors and not console_errors, 'manual quality change has no runtime errors')
        check(len(navigations)==1, 'safe startup has no automatic navigation')
        await context_loss(page, errors, console_errors, navigations)
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
