/** "Continue as an Interego guest" on a phone: the shipping DOM, styles and source of
 * src/14w_generalguest.js, offline. A tap on the control starts one top-level visit. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { chromium } from '../node_modules/playwright/index.mjs';

const shell = readFileSync(new URL('../../src/page.html', import.meta.url), 'utf8');
const source = readFileSync(new URL('../../src/14w_generalguest.js', import.meta.url), 'utf8');
const ORIGIN = 'https://hm-guest.test';
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true, args: ['--disable-gpu'] }); });
test.after(async () => { await browser?.close(); });

async function page(t, manifest) {
  const context = await browser.newContext({ viewport: { width: 390, height: 780 }, hasTouch: true, isMobile: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  const requests = [];
  await context.route('**/*', route => {
    const url = route.request().url(); requests.push(route.request().method() + ' ' + url);
    if (url === ORIGIN + '/') return route.fulfill({ contentType: 'text/html', body: shell });
    if (url === ORIGIN + '/guest/general/start') return route.fulfill({ contentType: 'text/html', body: '<title>The start route</title>' });
    return route.abort();
  });
  const view = await context.newPage();
  await view.goto(ORIGIN + '/');
  await view.evaluate(([code, offered]) => {
    window.__HM_GAMING = offered ? { generalGuest: offered } : {};
    // The other ways in are present and enabled, as on a title that offers them.
    for (const id of ['loading-play-guest', 'loading-sign-in']) document.getElementById(id).disabled = false;
    const script = document.createElement('script');
    script.textContent = 'const $ = id => document.getElementById(id); const GAME = { started: false };'
      + 'const netServerUrl = () => "wss://" + location.host + "/ws";\n' + code;
    document.head.appendChild(script);
  }, [source, manifest]);
  return { view, requests };
}

test('the control is a 40 px tap target beside the other ways in, and a tap starts the visit', async t => {
  const { view, requests } = await page(t, { enabled: true, startPath: '/guest/general/start', sessionPath: '/guest/general/session' });
  const control = view.locator('#loading-general-guest');
  await control.waitFor({ state: 'visible' });
  assert.equal(await control.textContent(), 'Continue as an Interego guest');
  const box = await control.boundingBox(), others = await Promise.all(['#loading-play-guest', '#loading-sign-in'].map(id => view.locator(id).boundingBox()));
  assert.ok(box.height >= 40 && box.width >= 40, JSON.stringify(box));
  assert.ok(box.x >= 0 && box.x + box.width <= 390, 'nothing past the screen\'s edge');
  for (const other of others) {
    assert.ok(other && other.height >= 40, 'the other ways in keep their size');
    assert.ok(box.x >= other.x + other.width || other.x >= box.x + box.width || box.y >= other.y + other.height || other.y >= box.y + box.height, 'no control lies over another');
  }
  assert.equal(await view.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'no sideways overflow');
  await control.tap();
  await view.waitForURL(ORIGIN + '/guest/general/start');
  assert.equal(requests.filter(line => line === 'GET ' + ORIGIN + '/guest/general/start').length, 1);
});

test('the control stays hidden where the server does not offer the door', async t => {
  const { view } = await page(t, null);
  assert.equal(await view.locator('#loading-general-guest').isHidden(), true);
  assert.equal(await view.locator('#loading-general-guest-status').isHidden(), true);
});
