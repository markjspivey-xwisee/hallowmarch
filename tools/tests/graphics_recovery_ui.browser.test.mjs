/** Real recovery functions and shell CSS, exercised without a 3D context. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const shell = await readFile(new URL('../../src/page.html', import.meta.url), 'utf8');
const render = await readFile(new URL('../../src/02_render.js', import.meta.url), 'utf8');
const style = [...shell.matchAll(/<style\b[^>]*>([\s\S]*?)<\/style>/g)].map(match => match[1]).join('\n');
const title = shell.slice(shell.indexOf('<div id="title" hidden>'), shell.indexOf('<div id="hud" hidden>'));
const overlays = shell.slice(shell.indexOf('<div class="overlay" id="mobile-tray"'), shell.indexOf('<section id="nogl"'));
const failure = shell.match(/<(p|section) id="nogl"[^>]*>[\s\S]*?<\/\1>/)[0];
const extract = name => { const at = render.indexOf('function ' + name + '('); assert(at >= 0); return render.slice(at, render.indexOf('\n}', at) + 2); };
const functions = ['graphicsRecoveryURL', 'graphicsRecoveryNotice', 'graphicsFailureTakeover', 'graphicsStartFailure']
  .filter(name => render.includes('function '+name+'(')).map(extract).join('\n');
const mobile = await readFile(new URL('../../src/10q_mobile.js', import.meta.url), 'utf8');
const lore = await readFile(new URL('../../src/10c_lore.js', import.meta.url), 'utf8');
const ui = await readFile(new URL('../../src/10_ui.js', import.meta.url), 'utf8');
const player = await readFile(new URL('../../src/09_player.js', import.meta.url), 'utf8');
const gaming = await readFile(new URL('../../src/14u_gaming.js', import.meta.url), 'utf8');
const block = (source, start, end, offset = 0) => { const at=source.indexOf(start,offset); assert(at>=0); const to=source.indexOf(end,at); assert(to>at); return source.slice(at,to+end.length); };
const modalKeys = block(mobile, "document.addEventListener('keydown'", '\n  });', mobile.indexOf('// These are modal game screens'));
const prologueKeys = block(lore, "window.addEventListener('keydown'", '\n}, true);', lore.indexOf("// the prologue's keys come first"));
const menuKeys = block(ui, "$('menu').addEventListener('keydown'", '\n});');
const contextLost = block(render, "canvas.addEventListener('webglcontextlost'", '\n});');
const playerKeys = block(player, "window.addEventListener('keydown'", '\n});');
const playerControlKeys = player.slice(player.indexOf('const typing ='), player.indexOf('function cancelPlayerInput('));
const failureKeyDelegate = render.includes("window.addEventListener('keydown', (event)")
  ? block(render, "window.addEventListener('keydown', (event)", '\n}, true);') : '';
const gamingKeys = block(gaming, "addEventListener('keydown', event => {", '\n  }, true);');
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath));
const screenshotDirectory = process.env.HM_GRAPHICS_UI_OUT;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const screenshot = async (page, name) => { if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, name+'.png') }); };
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, width, height, touch = false, earlyFailure = false) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  const visits = [], errors = [];
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${style}</style><div id="loading"></div><canvas id="scene"></canvas>${title}<div id="hud" hidden><button>World action</button></div>${overlays}
    <div id="lore-pro" hidden><button>Next page</button></div><div class="overlay" id="netsheet" hidden><button>Players</button></div>
    <div class="overlay" id="gaming-sheet" hidden><button>Expedition action</button></div>
    <div id="netchat" hidden><input aria-label="Chat"></div>${failure}
    <script>let BOOT_SAFE=false,GRAPHICS_CONTEXT_LOST=false,GRAPHICS_START_MESSAGE='';
      ${functions}
      ${failureKeyDelegate}
      ${earlyFailure ? "graphicsStartFailure(new Error('Early context creation failed'));" : ''}
      const UI={modal:null}, LORE={pro:{}}, GAME={ready:true,started:true};
      const canvas=document.getElementById('scene'), $=id=>document.getElementById(id), effects=[];
      const GRAPHICS_STARTUP={phase:'Ready',lost:0,stopped:false};
      function graphicsRememberRecovery(){effects.push('remember');}
      function graphicsCheckpoint(){effects.push('checkpoint');}
      function netHumanInput(){} function prologueGo(){effects.push('prologue advanced');}
      function closePrologue(){effects.push('prologue closed');}
      const INPUT={keys:new Set()};
      function onEscape(){effects.push('game Escape');}
      function toggleMap(){effects.push('game Map');} function toggleKit(){effects.push('game Kit');}
      function playerUseSlot(){effects.push('game ability');}
      const GAMING={open:false,status:'joined'}, overlay=$('gaming-sheet');
      const addEventListener=window.addEventListener.bind(window);
      function gamingToggle(){effects.push('gaming closed');} function gamingRun(fn){fn();}
      function gamingMove(){effects.push('gaming move');} function gamingAttack(){effects.push('gaming attack');}
      ${playerControlKeys}
      ${playerKeys}
      ${prologueKeys}
      ${modalKeys}
      ${menuKeys}
      ${gamingKeys}
      ${contextLost}
      window.recoveryUI={notice(){BOOT_SAFE=true;document.getElementById('loading').hidden=true;document.getElementById('title').hidden=false;graphicsRecoveryNotice();},
        fail({safe=false,lost=false,message='',browserMessage='',heading='Graphics stopped'}){
          BOOT_SAFE=safe;GRAPHICS_CONTEXT_LOST=lost;GRAPHICS_START_MESSAGE=browserMessage;
          graphicsStartFailure(new Error(message),heading);
        },
        openModal(modal){
          UI.modal=modal;
          const id=modal==='map'?'mapov':modal==='prologue'?'lore-pro':modal==='net'?'netsheet':modal==='gaming'?'gaming-sheet':modal;
          GAMING.open=modal==='gaming';
          document.getElementById(id).hidden=false;
          document.getElementById('hud').hidden=false;
          window.__hm={UI,GAME,ready:true,fn:{saveNow(){effects.push('save:'+GAME.ready+':'+window.__hm.ready);}}};
        },
        lose(){canvas.dispatchEvent(new Event('webglcontextlost',{cancelable:true}));},
        state(){return {effects:effects.slice(),modal:UI.modal,ready:GAME.ready,stateReady:window.__hm?.ready};}
      };
    </script>`;
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { visits.push(route.request().url()); return route.fulfill({ contentType: 'text/html', body: html }); });
  await page.goto('http://graphics-ui.test/?server=wss%3A%2F%2Frelay.example%2Fws&tag=a&tag=b&safe=1&gpuDiag=1#return');
  await page.evaluate(() => { localStorage.setItem('hallowmarch.save.v1', 'character-sentinel'); localStorage.setItem('other', 'keep'); });
  return { page, visits, errors };
}

async function target(page, selector) {
  return page.locator(selector).evaluate(element => {
    const r = element.getBoundingClientRect(), x = r.x + r.width / 2, y = r.y + r.height / 2;
    const hit = document.elementFromPoint(x, y), style = getComputedStyle(element);
    return { x, y, width: r.width, height: r.height, hit: !!hit && (hit === element || element.contains(hit)),
      pointerEvents: style.pointerEvents, outlineStyle: style.outlineStyle, outlineWidth: parseFloat(style.outlineWidth) };
  });
}

for (const [width, height, touch] of [[320, 740, true], [390, 780, true], [1280, 800, false]]) {
  test(`standard retry has an actual 44px hit target and navigates once at ${width}x${height}`, async t => {
    const { page, visits, errors } = await fixture(t, width, height, touch);
    await page.evaluate(() => { recoveryUI.notice(); recoveryUI.notice(); });
    const link = page.locator('#graphics-recovery a'), box = await target(page, '#graphics-recovery a');
    assert(box.hit && box.width >= 44 && box.height >= 44, JSON.stringify(box));
    assert.equal(await page.locator('#graphics-recovery').count(), 1);
    assert.equal(await link.evaluate(element => !!element.closest('#title .card-foot')), true);
    await link.focus();
    const focused = await target(page, '#graphics-recovery a');
    assert.notEqual(focused.outlineStyle, 'none'); assert(focused.outlineWidth >= 2);
    await screenshot(page, 'reduced-notice-'+width);
    const expected = new URL(page.url()); expected.searchParams.set('safe', '0'); expected.searchParams.delete('gpuDiag');
    assert.equal(await link.getAttribute('href'), expected.href);
    await Promise.all([page.waitForURL(expected.href), touch ? page.touchscreen.tap(box.x, box.y) : link.click()]);
    assert.equal(page.url(), expected.href); assert.equal(visits.length, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('hallowmarch.save.v1')), 'character-sentinel');
    assert.equal(await page.evaluate(() => localStorage.getItem('other')), 'keep');
    assert.deepEqual(errors, []);
  });
}

const diagnostic = 'Title shader could not link: '+JSON.stringify({ material:'ShaderMaterial', materialId:6, programLog:'driver details 0x0502 '.repeat(80) });
const states = [
  { name: 'standard shader failure', safe: false, lost: false, message: diagnostic, retry: 'Try reduced graphics', mode: '1' },
  { name: 'reduced shader failure', safe: true, lost: false, message: diagnostic, retry: 'Retry reduced graphics', mode: '1', already: true },
  { name: 'lost standard context', safe: false, lost: true, message: 'Graphics stopped during Drawing the first view.', retry: 'Try reduced graphics', mode: '1' },
  { name: 'lost reduced context', safe: true, lost: true, message: 'Graphics stopped during Drawing the first view.', retry: 'Retry reduced graphics', mode: '1', already: true },
  { name: 'disabled browser graphics', safe: false, lost: false, browserMessage: 'GL_VENDOR = Disabled, GL_RENDERER = Disabled; BindToCurrentSequence failed', retry: 'Retry loading', mode: '0', unavailable: true },
  { name: 'disabled browser binding in reduced mode', safe: true, lost: false, browserMessage: 'BindToCurrentSequence failed', retry: 'Retry loading', mode: '1', unavailable: true },
  { name: 'unsupported browser', safe: false, lost: false, message: 'WebGL 2 is not available in this browser.', retry: 'Retry loading', mode: '0', unsupported: true },
];
for (const state of states) test(state.name+' gives a readable narrow-screen recovery and optional exact diagnostic', async t => {
  const { page, visits, errors } = await fixture(t, 320, 560, true);
  await page.evaluate(safe => { const url=new URL(location.href);url.searchParams.set('safe',safe?'1':'0');history.replaceState(null,'',url); }, state.safe);
  await page.evaluate(state => recoveryUI.fail(state), state);
  const panel = page.locator('#nogl'), details = panel.locator('details');
  assert.equal(await panel.getAttribute('role'), 'alert');
  assert.equal(await page.locator('#loading').isVisible(), false);
  assert.equal(await details.count(), 1, 'Raw diagnostics must have an optional disclosure.');
  assert.equal(await details.getAttribute('open'), null);
  const visible = await panel.innerText();
  if (['standard shader failure','reduced shader failure','disabled browser graphics'].includes(state.name)) await screenshot(page, state.name.replaceAll(' ','-'));
  assert(!visible.includes('ShaderMaterial') && !visible.includes('0x0502') && !visible.includes('BindToCurrentSequence'), visible);
  assert.match(visible, /saved character is kept/);
  if (state.already) assert.match(visible, /Reduced graphics were already active/);
  if (state.unavailable) {
    assert.match(visible, /Browser graphics are unavailable/);
    assert.match(visible, /cannot restore a disabled browser graphics connection/);
  }
  if (state.unsupported) assert.match(visible, /does not provide the graphics features/);
  const retry = panel.locator('a'), summary = details.locator('summary');
  assert.equal(await retry.innerText(), state.retry);
  const expected = new URL(page.url()); expected.searchParams.set('safe', state.mode); expected.searchParams.delete('gpuDiag');
  assert.equal(await retry.getAttribute('href'), expected.href);
  for (const selector of ['#nogl a', '#nogl summary']) {
    const box = await target(page, selector);
    assert(box.hit && box.width >= 44 && box.height >= 44, selector+' '+JSON.stringify(box));
  }
  await summary.focus(); await page.keyboard.press('Enter');
  assert.equal(await details.getAttribute('open'), '');
  assert.equal(await details.locator('pre').innerText(), state.browserMessage || state.message);
  const geometry = await panel.evaluate(element => { const r = element.getBoundingClientRect(); return { left:r.left, right:r.right, top:r.top, bottom:r.bottom, horizontal:element.scrollWidth-element.clientWidth }; });
  assert(geometry.left >= 0 && geometry.right <= 320 && geometry.top >= 0 && geometry.bottom <= 560 && geometry.horizontal <= 1, JSON.stringify(geometry));
  await retry.focus(); const focused = await target(page, '#nogl a');
  assert.notEqual(focused.outlineStyle, 'none'); assert(focused.outlineWidth >= 2);
  assert.equal(visits.length, 1, 'Showing an error/disclosure must never reload or restart graphics.');
  assert.equal(await page.evaluate(() => localStorage.getItem('hallowmarch.save.v1')), 'character-sentinel');
  assert.deepEqual(errors, []);
  await Promise.all([page.waitForURL(expected.href), retry.press('Enter')]);
  assert.equal(page.url(),expected.href);assert.equal(visits.length,2,'keyboard retry performs one explicit navigation');
  assert.equal(await page.evaluate(() => localStorage.getItem('hallowmarch.save.v1')), 'character-sentinel');
});

for (const modal of ['kit', 'map', 'dialog', 'death', 'net', 'menu', 'prologue', 'gaming']) {
  test(`graphics failure takes keyboard ownership from the actual ${modal} handlers`, async t => {
    const { page, visits, errors } = await fixture(t, 390, 780);
    await page.evaluate(modal => { recoveryUI.openModal(modal); recoveryUI.lose(); }, modal);
    const state = await page.evaluate(() => recoveryUI.state());
    assert.equal(state.modal, null, 'The obsolete game modal must release keyboard ownership.');
    assert.equal(state.ready, false); assert.equal(state.stateReady, false);
    assert.deepEqual(state.effects.slice(0,3), ['remember','checkpoint','save:true:true'], 'Capture the save before clearing readiness.');
    assert.deepEqual(await page.locator('#title, #hud, .overlay, #lore-pro, #netchat').evaluateAll(nodes => nodes.filter(node => !node.hidden || !node.inert).map(node => node.id)), []);
    assert.deepEqual(await page.locator('body > :not(#nogl)').evaluateAll(nodes => nodes.filter(node => !node.inert).map(node => node.id || node.tagName)), []);
    const retry = page.locator('#nogl a'), summary = page.locator('#nogl summary');
    await assert.doesNotReject(() => retry.waitFor({state:'visible'}));
    assert.equal(await retry.evaluate(node => node===document.activeElement), true);
    await page.keyboard.press('Tab'); assert.equal(await summary.evaluate(node => node===document.activeElement), true);
    await page.keyboard.press('Tab'); assert.equal(await retry.evaluate(node => node===document.activeElement), true);
    await page.keyboard.press('Shift+Tab'); assert.equal(await summary.evaluate(node => node===document.activeElement), true);
    await page.keyboard.press('Enter'); assert.equal(await page.locator('#nogl details').getAttribute('open'), '');
    for (const key of ['Escape','i','m','1','w','ArrowUp']) await page.keyboard.press(key);
    assert.deepEqual((await page.evaluate(() => recoveryUI.state())).effects, state.effects, 'Recovery must not invoke gameplay shortcuts or prologue actions.');
    await page.keyboard.press('Tab'); assert.equal(await retry.evaluate(node => node===document.activeElement), true);
    const href = await retry.getAttribute('href');
    await Promise.all([page.waitForURL(href), page.keyboard.press('Enter')]);
    assert.equal(page.url(), href); assert.equal(visits.length, 2);
    assert.equal(await page.evaluate(() => localStorage.getItem('hallowmarch.save.v1')), 'character-sentinel');
    assert.deepEqual(errors, []);
  });
}

test('early renderer failure takes over before UI initialization without touching a temporal dead zone', async t => {
  const { page, errors } = await fixture(t, 320, 560, false, true);
  assert.equal(await page.locator('#nogl').isVisible(), true);
  assert.equal(await page.evaluate(() => typeof window.__hm), 'undefined');
  assert.equal(await page.locator('#nogl a').evaluate(node => node===document.activeElement), true);
  await page.keyboard.press('Shift+Tab');
  assert.equal(await page.locator('#nogl summary').evaluate(node => node===document.activeElement), true);
  await page.keyboard.press('Tab');
  assert.equal(await page.locator('#nogl a').evaluate(node => node===document.activeElement), true);
  assert.deepEqual(errors, []);
});
