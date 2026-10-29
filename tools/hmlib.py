"""Shared setup for the Playwright tests: boots the built page in headless Chromium (SwiftShader WebGL)
with three.js served locally and web fonts stubbed, then waits for window.__hm.ready."""
import json, asyncio, sys, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
import hm
from playwright.async_api import async_playwright, TimeoutError as PlaywrightTimeoutError
OUT = str(hm.OUT) + '/'


async def wait_title_settled(page, timeout=180000):
    """Wait for the real staged title boundary; report a stopped pipeline immediately."""
    try:
        handle = await page.wait_for_function("""() => {
      const H=window.__hm, S=window.__hmStartup, title=document.getElementById('title');
      if(!H || !S)return false;
      if(S.stopped || S.titleError || H.errors.length) {
        return {error:S.titleError || H.errors.join('; ') || 'Title graphics stopped',
                stage:S.titleStage, failure:S.titleFailure || null};
      }
      if(!H.ready || !H.GAME.ready || (title && title.getAttribute('aria-busy')==='true'))return false;
      if(!(S.titleCompleted>0) || S.titleCompleted!==S.titleSubmitted ||
         !S.titleFinal || !S.titleFinal.completed || !S.titleFinal.fenceComplete)return false;
      return {error:null};
        }""", timeout=timeout, polling=100)
    except PlaywrightTimeoutError as error:
        try:
            state = await asyncio.wait_for(page.evaluate("""() => {
              const H=window.__hm,S=window.__hmStartup;
              return {ready:H?.ready,gameReady:H?.GAME.ready,hidden:document.hidden,
                stopped:S?.stopped,phase:S?.phase,stage:S?.titleStage,preparing:S?.titlePreparing,
                error:S?.titleError,errors:H?.errors.slice(0,5),failure:S?.titleFailure,
                submitted:S?.titleSubmitted,completed:S?.titleCompleted,
                preparations:S?.titlePreparations?.slice(-3).map(p=>({dependency:p.dependency,
                  outcome:p.outcome,eligibleJobs:p.eligibleJobs,preparedJobs:p.preparedJobs,
                  newPrograms:p.newPrograms,maxPending:p.maxPending,visibleMs:p.visibleMs,
                  waves:p.waves,tail:p.waveLatency?.slice(-2)}))};
            }"""), timeout=5)
        except Exception as diagnostic_error:
            state = {'unavailable': type(diagnostic_error).__name__}
        raise RuntimeError('Title did not settle within its unchanged deadline: '+json.dumps(state)) from error
    state = await handle.json_value()
    await handle.dispose()
    if state['error']:
        raise RuntimeError('Title graphics did not settle: '+json.dumps(state))

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
    await wait_title_settled(page)
    await page.evaluate("__hm.fn.setQuality('low')")
    await wait_title_settled(page)
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
