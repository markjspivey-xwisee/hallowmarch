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
const failure = shell.match(/<(p|section) id="nogl"[^>]*>[\s\S]*?<\/\1>/)[0];
const extract = name => { const at = render.indexOf('function ' + name + '('); assert(at >= 0); return render.slice(at, render.indexOf('\n}', at) + 2); };
const functions = ['graphicsRecoveryURL', 'graphicsRecoveryNotice', 'graphicsStartFailure'].map(extract).join('\n');
const playwrightPath = process.env.HM_PLAYWRIGHT_MODULE || fileURLToPath(new URL('../node_modules/playwright/index.mjs', import.meta.url));
const { chromium } = await import(pathToFileURL(playwrightPath));
const screenshotDirectory = process.env.HM_GRAPHICS_UI_OUT;
if (screenshotDirectory) await mkdir(screenshotDirectory, { recursive: true });
const screenshot = async (page, name) => { if (screenshotDirectory) await page.screenshot({ path: join(screenshotDirectory, name+'.png') }); };
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'], executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined }); });
test.after(async () => { await browser?.close(); });

async function fixture(t, width, height, touch = false) {
  const page = await browser.newPage({ viewport: { width, height }, hasTouch: touch, isMobile: touch });
  page.setDefaultTimeout(5000);
  t.after(() => page.close());
  const visits = [], errors = [];
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <style>${style}</style><div id="loading"></div>${title}${failure}
    <script>let BOOT_SAFE=false,GRAPHICS_CONTEXT_LOST=false,GRAPHICS_START_MESSAGE='';
      ${functions}
      window.recoveryUI={notice(){BOOT_SAFE=true;document.getElementById('loading').hidden=true;document.getElementById('title').hidden=false;graphicsRecoveryNotice();},
        fail({safe=false,lost=false,message='',browserMessage='',heading='Graphics stopped'}){
          BOOT_SAFE=safe;GRAPHICS_CONTEXT_LOST=lost;GRAPHICS_START_MESSAGE=browserMessage;
          graphicsStartFailure(new Error(message),heading);
        }};
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
