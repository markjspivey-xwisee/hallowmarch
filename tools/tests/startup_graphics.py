#!/usr/bin/env python3
"""Direct-page graphics startup regression. Software WebGL is not GPU compatibility evidence."""
import asyncio, io, json, math, pathlib, sys, traceback
from PIL import Image, ImageStat
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
 window.__hmGraphicsTest = {lost:0, restored:0, creation:[], animationCallbacks:0, renderedFrames:0};
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
    counts_before = before['lifecycle']
    marker = await page.evaluate("""() => {
      window.__hmTestLossExtension = __hm.dbg.renderer.getContext().getExtension('WEBGL_lose_context');
      if (!window.__hmTestLossExtension) return {supported:false};
      const previous = JSON.parse(localStorage.getItem('hallowmarch.save.v1'));
      // Leave this progress unsaved: only the context-loss handler may persist it.
      __hm.GAME.prog.xp += 17;
      const expectedXP = Math.round(__hm.GAME.prog.xp);
      window.__hmTestLossExtension.loseContext();
      return {supported:true, previousXP:previous.char.xp, expectedXP};
    }""")
    check(marker['supported'], 'software browser supports actual context-loss injection')
    check(marker['expectedXP'] != marker['previousXP'],
          'context-loss test begins with unsaved character progress')
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
    check(await page.evaluate('JSON.parse(localStorage.getItem("hallowmarch.graphics.recovery.v1")).enabled === true'),
          'actual context loss remembers recovery for later browser launches')
    check(stopped['lost'] and stopped['startup']['lost'] and stopped['startup']['stopped'],
          'actual context loss latches stopped state')
    check(not stopped['ready'] and not stopped['gameReady'],
          'lost context is never reported ready')
    check(stopped['lifecycle']['lost'] > counts_before['lost'],
          'test observed an actual WebGL context-loss event')
    stored_after_loss = await page.evaluate("""async () => {
      await __hm.SAVE.chain;
      return localStorage.getItem('hallowmarch.save.v1');
    }""")
    saved_after_loss = json.loads(stored_after_loss)
    check(saved_after_loss['char']['xp'] == marker['expectedXP'],
          'context loss saves unsaved progress before clearing readiness')
    previous_save = json.loads(before['stored'])
    check(saved_after_loss['char']['name'] == previous_save['char']['name'] and
          saved_after_loss['char']['level'] == previous_save['char']['level'] and
          saved_after_loss['settings'] == previous_save['settings'],
          'loss save preserves the character and explicit graphics preference')
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
    check(later['stored'] == stored_after_loss, 'restoration preserves the loss-handler save')



async def title_canvas_pixels(page):
    startup = await page.evaluate('({...window.__hmStartup})')
    check(startup['titleSubmitted'] > 0 and
          startup['titleCompleted'] == startup['titleSubmitted'] and
          math.isfinite(startup['titleFenceWaitMs']) and startup['titleFenceWaitMs'] >= 0,
          'title readiness follows completed scene and post GPU fence')
    # Inspect the composited canvas itself, with all DOM text and panels hidden.
    # Render counts can belong to maps/offscreen targets; title UI can otherwise
    # make a black canvas screenshot look like a successful rendered world.
    style = await page.add_style_tag(content='body * { visibility: hidden !important; } #scene { visibility: visible !important; }')
    try:
        png = await page.locator('#scene').screenshot(
            path=str(hm.OUT / 'startup-safe-title-canvas.png'), timeout=120000)
    finally:
        await style.evaluate('node => node.remove()')
    image = Image.open(io.BytesIO(png)).convert('RGB')
    sample = image.resize((96, 54))
    stats = ImageStat.Stat(sample)
    colors = len(set(sample.getdata()))
    lit = sum(max(pixel) > 8 for pixel in sample.getdata()) / (sample.width * sample.height)
    check(lit > 0.1 and max(stats.stddev) > 2 and colors > 32,
          'actual title canvas contains nonblack spatially varied world pixels')
    (hm.OUT / 'startup-safe-title-pixels.json').write_text(json.dumps({
        'width': image.width, 'height': image.height, 'litFraction': lit,
        'sampleColors': colors, 'channelStddev': stats.stddev,
        'titleSubmitted': startup['titleSubmitted'],
        'titleCompleted': startup['titleCompleted'],
        'titleFenceWaitMs': startup['titleFenceWaitMs'],
    }, indent=2), encoding='utf-8')

async def safe_boot(browser):
    saved = {'v':1, 'char':None, 'settings':{'quality':'high', 'auto':True}, 'world':None,
             'startupRegression':'preserve-this-existing-save'}
    text = json.dumps(saved, separators=(',', ':'))
    init = 'localStorage.setItem("hallowmarch.save.v1", ' + json.dumps(text) + ');'
    ctx,page,errors,console_errors,navigations = await direct_page(browser,3840,2160,init=init)
    try:
        await page.goto(ORIGIN + '/?safe=1&server=', wait_until='commit', timeout=120000)
        await page.wait_for_function('window.__hm && window.__hm.ready', timeout=180000, polling=500)
        await page.evaluate("""() => {
          const renderer = __hm.dbg.renderer, render = renderer.render;
          renderer.render = function(...args) {
            window.__hmGraphicsTest.renderedFrames++;
            return render.apply(this, args);
          };
        }""")
        st = await page.evaluate(SNAPSHOT)
        check(await page.evaluate("document.characterSet === 'UTF-8'"), 'standalone title uses UTF-8')
        check(st['level']=='low' and st['auto'] is False and st['msaa']==0, 'safe startup selects low without MSAA')
        check(st['savedQuality']=='high', 'real save loader reads previous high preference')
        check(st['stored']==text, 'safe startup preserves stored save')
        check(st['webgl2'], 'safe startup creates a software WebGL 2 context')
        check(not st['errors'] and not errors and not console_errors, 'safe startup has no runtime errors')
        bounded_recovery(st, 'initial safe startup')
        check(st['startup']['phase'] == 'Ready' and bool(st['startup']['events']),
              'startup trace reports successful boot checkpoints')
        await expect(page.locator('#title')).to_be_visible()
        await page.wait_for_function("document.getElementById('loading').hidden || getComputedStyle(document.getElementById('loading')).display === 'none'", timeout=30000)
        await title_canvas_pixels(page)
        notice = page.locator('#graphics-recovery')
        await expect(notice).to_be_visible()
        standard = urlsplit(await notice.locator('a').evaluate('el => el.href'))
        check(('safe', '0') in parse_qsl(standard.query, keep_blank_values=True) and
              not any(k == 'gpuDiag' for k, _ in parse_qsl(standard.query)),
              'remembered recovery offers an explicit standard retry without diagnostic mode')
        check(await page.evaluate('JSON.parse(localStorage.getItem("hallowmarch.graphics.recovery.v1")).enabled === true'),
              'explicit reduced startup remembers the browser recovery choice')
        await page.screenshot(path=str(hm.OUT / 'startup-safe-title-4k.png'), timeout=120000)
        idle_before = await page.evaluate(SNAPSHOT)
        await page.wait_for_timeout(30000)
        stable = await page.evaluate(SNAPSHOT)
        bounded_recovery(stable, 'safe startup after 30 seconds')
        check(stable['ready'] and stable['gameReady'] and not stable['lost'] and
              stable['t'] == idle_before['t'] and
              stable['lifecycle']['renderedFrames'] == idle_before['lifecycle']['renderedFrames'],
              'safe title remains healthy without simulation or rendering for 30 seconds')
        check(stable['stored'] == text, 'idle title does not rewrite the previous save')
        check(stable['lifecycle']['lost'] == 0 and stable['lifecycle']['restored'] == 0,
              'safe startup has no context loss or restoration during observation')
        check(not stable['errors'] and not errors and not console_errors,
              '30-second safe startup observation has no runtime errors')
        (hm.OUT / 'startup-safe-30s.json').write_text(json.dumps(stable, indent=2), encoding='utf-8')
        await page.evaluate("__hm.start()")
        await page.bring_to_front()
        await page.keyboard.press('Shift')
        await page.evaluate("__hm.fn.openMenu('settings')")
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
        await page.bring_to_front()
        await page.keyboard.press('Shift')
        await context_loss(page, errors, console_errors, navigations)
    finally:
        await ctx.close()

async def recovery_sky_render(page, errors, console_errors):
    result = await page.evaluate("""async threeURL => {
      const THREE = await import(threeURL);
      const renderer = __hm.dbg.renderer, gl = renderer.getContext();
      let sky;
      __hm.dbg.scene.traverse(object => {
        if (object.material && object.material.name === 'Recovery sky') sky = object;
      });
      if (!sky) throw new Error('The actual recovery sky material was not selected.');
      const material = sky.material, fragment = material.fragmentShader;
      const heavy = /sampler|texture|fbm|hash|cloud|fwidth|dFdx|dFdy|floatBitsToUint|for\\s*\\(|while\\s*\\(/i;
      if (fragment.length >= 1600 || heavy.test(fragment)) {
        throw new Error('Recovery sky still supplies heavy fragment compiler input.');
      }
      if (!gl.getExtension('EXT_color_buffer_float')) {
        throw new Error('Float color readback is required to test finite sky output.');
      }
      const target = new THREE.WebGLRenderTarget(16,16,{
        type:THREE.FloatType,format:THREE.RGBAFormat,depthBuffer:false,stencilBuffer:false,
        minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,
      });
      const isolated = new THREE.Scene(), mesh = sky.clone(false);
      mesh.visible = true; mesh.frustumCulled = false; isolated.add(mesh);
      const saved = {
        target:renderer.getRenderTarget(),color:renderer.getClearColor(new THREE.Color()).clone(),
        alpha:renderer.getClearAlpha(),autoClear:renderer.autoClear,
        viewport:renderer.getViewport(new THREE.Vector4()).clone(),
        scissor:renderer.getScissor(new THREE.Vector4()).clone(),
        scissorTest:renderer.getScissorTest(),
        shaderError:renderer.debug.onShaderError,checkShaderErrors:renderer.debug.checkShaderErrors,
      };
      const samples = [];
      const waitForGpu = async () => {
        const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE,0);
        if (!sync) throw new Error('Sky readback completion fence could not be created.');
        gl.flush();
        const started = performance.now();
        try {
          while (true) {
            if (gl.isContextLost()) throw new Error('Sky render lost its WebGL context.');
            const status = gl.clientWaitSync(sync,0,0);
            if (status===gl.ALREADY_SIGNALED || status===gl.CONDITION_SATISFIED) return;
            if (status===gl.WAIT_FAILED || performance.now()-started>15000) {
              throw new Error('Sky render did not complete its GPU fence.');
            }
            await new Promise(resolve=>setTimeout(resolve,10));
          }
        } finally { if (!gl.isContextLost()) gl.deleteSync(sync); }
      };
      renderer.debug.checkShaderErrors = true;
      renderer.debug.onShaderError = (context,program,vertex,fragmentShader) => {
        throw new Error('Recovery sky shader failure: '+context.getProgramInfoLog(program)+' / '+
                        context.getShaderInfoLog(vertex)+' / '+context.getShaderInfoLog(fragmentShader));
      };
      try {
        for (const [name,time] of [['day',0.3],['night',2.1]]) {
          __hm.fn.applyTimeOfDay(time);
          renderer.setRenderTarget(target);renderer.setViewport(0,0,16,16);
          renderer.setScissorTest(false);renderer.setClearColor(0,0);renderer.clear(true,true,false);
          renderer.render(isolated,__hm.camera);
          await waitForGpu();
          const pixels = new Float32Array(16*16*4);
          renderer.readRenderTargetPixels(target,0,0,16,16,pixels);
          const error = gl.getError();
          if (error!==gl.NO_ERROR) throw new Error(name+' sky GL error: 0x'+error.toString(16));
          const rgb = [];
          for (let n=0;n<pixels.length;n+=4) rgb.push(pixels[n],pixels[n+1],pixels[n+2]);
          samples.push({name,finite:rgb.every(Number.isFinite),min:Math.min(...rgb),max:Math.max(...rgb),
                        mean:rgb.reduce((sum,x)=>sum+x,0)/rgb.length,
                        firstPixels:Array.from(pixels.slice(0,16)),fenceComplete:true});
        }
        const compilerSources = [];
        for (const entry of renderer.info.programs) {
          if (!entry.program) continue;
          for (const shader of gl.getAttachedShaders(entry.program) || []) {
            if (gl.getShaderParameter(shader,gl.SHADER_TYPE)!==gl.FRAGMENT_SHADER) continue;
            const text = gl.getShaderSource(shader) || '';
            if (text.includes('warmHorizon')) {
              compilerSources.push({length:text.length,source:text,
                                    linked:!!gl.getProgramParameter(entry.program,gl.LINK_STATUS)});
            }
          }
        }
        return {name:material.name,fragmentLength:fragment.length,compilerSources,samples,
                unchanged:material.fragmentShader===fragment,lost:gl.isContextLost()};
      } finally {
        renderer.debug.onShaderError = saved.shaderError;
        renderer.debug.checkShaderErrors = saved.checkShaderErrors;
        __hm.fn.applyTimeOfDay(__hm.tod.p);
        renderer.autoClear = saved.autoClear;
        if (!gl.isContextLost()) {
          renderer.setRenderTarget(saved.target);renderer.setClearColor(saved.color,saved.alpha);
          renderer.setViewport(saved.viewport);renderer.setScissor(saved.scissor);
          renderer.setScissorTest(saved.scissorTest);target.dispose();
        }
      }
    }""",hm.THREE_URL)
    check(result['name']=='Recovery sky' and result['fragmentLength']<1600 and result['unchanged'],
          'real sky render uses the selected small production recovery fragment')
    check(result['compilerSources'] and
          all(row['linked'] and row['length']<8192 and
              not any(token in row['source'] for token in
                      ('floatBitsToUint','cloudScreen','fbm(','hash12('))
              for row in result['compilerSources']),
          'actual linked sky compiler input excludes heavy procedural chunks')
    for sample in result['samples']:
        check(sample['fenceComplete'] and sample['finite'] and
              sample['min']>=0 and sample['max']<=8.01 and sample['mean']>0,
              sample['name']+' recovery sky renders finite nonblack float pixels')
    check(abs(result['samples'][0]['mean']-result['samples'][1]['mean'])>0.0001,
          'production time-of-day uniforms produce distinct day and night skies')
    check(not result['lost'] and not errors and not console_errors,
          'day and night recovery sky rendering has no shader, GL or runtime errors')
    (hm.OUT/'recovery-sky-day-night.json').write_text(json.dumps(result,indent=2),encoding='utf-8')


DIAGNOSTIC_SNAPSHOT = """() => {
 const d = window.__hmGpuDiagnostic;
 return {
  active:d.active,index:d.index,running:d.running,stopped:d.stopped,complete:d.complete,
  error:d.error,stages:d.stages,results:d.results,
  ready:__hm.ready,gameReady:__hm.GAME.ready,started:__hm.GAME.started,t:__hm.GAME.t,
  animationCallbacks:window.__hmGraphicsTest.animationCallbacks,
  lost:window.__hmGraphicsTest.lost,restored:window.__hmGraphicsTest.restored,
  errors:[...__hm.errors],startup:__hm.startup(),
  stored:localStorage.getItem('hallowmarch.save.v1')
 };
}"""


async def staged_diagnostic(browser):
    saved = {'v':1,'char':{'name':'Preserve Me','realm':0,'cls':'warrior','level':8,'xp':123},
             'settings':{'quality':'high','auto':True},'world':None,
             'diagnosticSentinel':'preserve-existing-progress'}
    original = json.dumps(saved,separators=(',',':'))
    init = 'localStorage.setItem("hallowmarch.save.v1", '+json.dumps(original)+');'
    ctx,page,errors,console_errors,navigations = await direct_page(browser,800,450,init=init)
    try:
        await page.goto(ORIGIN+'/?safe=1&gpuDiag=1&server=',wait_until='commit',timeout=120000)
        await page.wait_for_function('window.__hmGpuDiagnostic && window.__hmGpuDiagnostic.active',
                                     timeout=180000,polling=250)
        initial = await page.evaluate(DIAGNOSTIC_SNAPSHOT)
        check(not initial['stopped'] and not initial['running'] and initial['index']==0 and
              len(initial['results'])==0, 'diagnostic waits before its first selected stage')
        check(not initial['ready'] and not initial['gameReady'] and not initial['started'],
              'diagnostic never starts or reports the normal game ready')
        check(initial['startup']['proactivePrograms']==0,
              'diagnostic begins without whole-scene shader prewarming')
        await expect(page.locator('#gpu-diag')).to_be_visible()
        button = page.locator('#gpu-diag-next')
        await expect(button).to_be_enabled()
        await page.wait_for_timeout(1000)
        waiting = await page.evaluate(DIAGNOSTIC_SNAPSHOT)
        check(waiting['index']==0 and len(waiting['results'])==0 and
              waiting['t']==initial['t'] and
              waiting['animationCallbacks']==initial['animationCallbacks'],
              'diagnostic submits no automatic stage or game animation')
        expected = ['cube-default','cube-post','sky','terrain','grass','flowers','trees','water',
                    'structures','crowds','other','trail','decal','combined']
        check([row['id'] for row in initial['stages']]==expected,
              'diagnostic exposes all ordered pipeline and material families')
        for index, stage in enumerate(initial['stages']):
            await button.click(timeout=180000)
            await page.wait_for_function(
                'n => {const d=window.__hmGpuDiagnostic;return !d.running && (d.stopped || d.results.length>=n);}',
                arg=index+1,timeout=180000,polling=100)
            current = await page.evaluate(DIAGNOSTIC_SNAPSHOT)
            check(not current['stopped'], 'diagnostic stage '+stage['id']+' reports no failure: '+str(current['error']))
            check(current['index']==index+1 and len(current['results'])==index+1,
                  'manual stage '+stage['id']+' advances exactly once')
            receipt = current['results'][-1]
            check(receipt['id']==stage['id'] and receipt['completed'] and receipt['fenceComplete'],
                  stage['id']+' has a real completed GPU fence receipt')
            check(receipt['exercised']==(receipt['workCalls']>0),
                  stage['id']+' distinguishes family work from an empty successful fence')
            if stage['id'] in ('cube-default','cube-post','combined'):
                check(receipt['exercised'], stage['id']+' actually draws')
            check(not current['ready'] and not current['gameReady'] and not current['started'] and
                  current['t']==initial['t'], stage['id']+' keeps the game paused')
            check(current['stored']==original, stage['id']+' leaves existing saved data unchanged')
            await page.wait_for_timeout(100)
            idle = await page.evaluate(DIAGNOSTIC_SNAPSHOT)
            check(idle['index']==current['index'] and len(idle['results'])==len(current['results']) and
                  idle['animationCallbacks']==current['animationCallbacks'],
                  stage['id']+' does not automatically run another stage or frame')
        final = await page.evaluate(DIAGNOSTIC_SNAPSHOT)
        check(final['complete'] and not final['running'] and not final['stopped'],
              'diagnostic completes all selections without treating success as failure')
        await expect(button).to_be_disabled()
        check(not await page.evaluate('window.__hmGpuDiagnostic.runNext()'),
              'completed diagnostic refuses any further batch')
        check(final['lost']==0 and final['restored']==0 and not final['errors'] and
              not errors and not console_errors, 'diagnostic has no context loss or runtime errors')
        check(len(navigations)==1, 'diagnostic never reloads or navigates automatically')
        await recovery_sky_render(page,errors,console_errors)
        (hm.OUT/'gpu-diagnostic-results.json').write_text(json.dumps(final,indent=2),encoding='utf-8')
        await page.screenshot(path=str(hm.OUT/'gpu-diagnostic-desktop.png'),timeout=120000)
        target_before = final['startup']['target']
        await page.set_viewport_size({'width':390,'height':844})
        await page.wait_for_timeout(300)
        phone = await page.evaluate("""() => {
          const panel=document.getElementById('gpu-diag'),rect=panel.getBoundingClientRect();
          return {
            width:innerWidth,left:rect.left,right:rect.right,height:rect.height,
            scrollWidth:panel.scrollWidth,clientWidth:panel.clientWidth,
            scrollHeight:panel.scrollHeight,clientHeight:panel.clientHeight,
            overflow:getComputedStyle(panel).overflowY,target:__hm.startup().target,
            children:['gpu-diag-next','gpu-diag-status','gpu-diag-results'].map(id=>{
              const r=document.getElementById(id).getBoundingClientRect();
              return {id,left:r.left,right:r.right,width:r.width};
            })
          };
        }""")
        check(phone['width']==390 and phone['left']>=0 and phone['right']<=390 and phone['height']<=844,
              'diagnostic panel fits a phone viewport')
        check(phone['scrollWidth']<=phone['clientWidth']+1 and
              all(row['width']>0 and row['left']>=phone['left'] and row['right']<=phone['right']
                  for row in phone['children']), 'diagnostic controls, status and results fit horizontally')
        check(phone['overflow'] in ('auto','scroll') and phone['scrollHeight']>phone['clientHeight'],
              'long diagnostic results remain vertically scrollable on a phone')
        check(phone['target']==target_before, 'paused diagnostic resize submits no target reallocation')
        await page.screenshot(path=str(hm.OUT/'gpu-diagnostic-phone.png'),timeout=120000)
    finally:
        await ctx.close()


async def main():
    hm.OUT.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as p:
        browser = await p.chromium.launch(args=ARGS)
        try:
            await failed_creation(browser,'desktop',1280,720)
            await failed_creation(browser,'phone',390,844,True)
            await staged_diagnostic(browser)
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
