import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { prepareNativeOAuthRedirectCapture } from './native-oauth-redirect-capture.mjs';

const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example', state = 's'.repeat(43);
const redirect = gameOrigin + '/gaming/identity/callback?code=OFFLINE_SYNTHETIC&state=' + state;

test('offline Chromium captures before cross-origin navigation and returns the native Response unchanged',
  { skip: !process.env.HM_PLAYWRIGHT_MODULE, timeout: 30000 }, async () => {
    const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined });
    try {
      const page = await browser.newPage(); const receipts = []; let callbackSeen = false, unexpected = 0;
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        if (url.origin === relayOrigin && url.pathname === '/authorize') {
          return route.fulfill({ contentType: 'text/html', body: '<!doctype html><button id="proof">Proof</button>' });
        }
        if (url.origin === relayOrigin && url.pathname === '/oauth/verify' && route.request().method() === 'POST') {
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ redirect }) });
        }
        if (url.origin === gameOrigin && url.pathname === '/gaming/identity/callback') {
          assert.equal(receipts.length, 1); assert.equal(receipts[0].code, 'capture_complete');
          callbackSeen = true; return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline callback</title>' });
        }
        unexpected++; return route.abort();
      });
      await page.goto(relayOrigin + '/authorize');
      await prepareNativeOAuthRedirectCapture(page, { gameOrigin, relayOrigin, state, onReceipt: value => receipts.push(value) });
      await page.evaluate(() => {
        document.querySelector('#proof').onclick = async () => {
          const response = await fetch('/oauth/verify', { method: 'POST', body: '{}' });
          const value = await response.json(); location.href = value.redirect;
        };
      });
      await page.locator('#proof').click();
      await page.waitForURL(url => url.origin === gameOrigin && url.pathname === '/gaming/identity/callback');
      assert.equal(callbackSeen, true); assert.equal(unexpected, 0);
      assert.equal(receipts[0].redirectHash, createHash('sha256').update(redirect).digest('hex'));
      assert.deepEqual(Object.keys(receipts[0]).sort(), ['code', 'redirectHash', 'status']);
      await page.close();
    } finally { await browser.close(); }
  });

test('offline Chromium emits bounded fixed refusals while the original body remains consumable',
  { skip: !process.env.HM_PLAYWRIGHT_MODULE, timeout: 30000 }, async () => {
    const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined });
    const cases = [
      { body: '{', code: 'capture_json_invalid' },
      { body: JSON.stringify({ redirect, extra: true }), code: 'capture_shape_refused' },
      { body: JSON.stringify({ redirect: 'invalid-url' }), code: 'capture_url_refused' },
      { body: JSON.stringify({ redirect: redirect.replace(gameOrigin, 'https://foreign.example') }), code: 'capture_origin_refused' },
      { body: JSON.stringify({ redirect: redirect.replace('/callback?', '/other?') }), code: 'capture_path_refused' },
      { body: JSON.stringify({ redirect: redirect.replace(state, 'foreign-state') }), code: 'capture_state_refused' },
      { body: JSON.stringify({ redirect: redirect + '&extra=true' }), code: 'capture_query_refused' },
      { body: JSON.stringify({ redirect, padding: 'x'.repeat(9000) }), code: 'capture_body_oversize' },
      { body: JSON.stringify({ redirect, padding: 'x'.repeat(9000) }), code: 'capture_body_oversize', contentLength: true },
      { body: JSON.stringify({ redirect }), code: 'capture_native_refused', status: 503 },
    ];
    try {
      for (const item of cases) {
        const page = await browser.newPage(); const receipts = [];
        // Every navigation is fulfilled offline. The native response stream is
        // real browser Response/tee behavior, with no content-length by default.
        await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline relay</title>' }));
        await page.goto(relayOrigin + '/authorize');
        await page.evaluate(({ body, status = 200, contentLength }) => {
          globalThis.fetch = async () => new Response(new ReadableStream({ start(controller) {
            const bytes = new TextEncoder().encode(body);
            for (let at = 0; at < bytes.length; at += 1024) controller.enqueue(bytes.slice(at, at + 1024));
            controller.close();
          } }), { status, headers: contentLength ? { 'content-length': String(body.length) } : {} });
        }, item);
        await prepareNativeOAuthRedirectCapture(page, { gameOrigin, relayOrigin, state, onReceipt: value => receipts.push(value) });
        assert.equal(await page.evaluate(async expected => {
          const response = await fetch('/oauth/verify', { method: 'POST', body: '{}' });
          return await response.text() === expected;
        }, item.body), true);
        assert.equal(receipts.length, 1); assert.equal(receipts[0].code, item.code); assert.equal(receipts[0].redirectHash, null);
        assert(!JSON.stringify(receipts).includes('https:')); assert(!JSON.stringify(receipts).includes(state));
        await page.close();
      }
      const page = await browser.newPage(); const receipts = [];
      await page.route('**/*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html>' }));
      await page.goto(relayOrigin + '/authorize');
      await page.evaluate(() => { globalThis.fetch = async () => new Response('untouched'); });
      await prepareNativeOAuthRedirectCapture(page, { gameOrigin, relayOrigin, state, onReceipt: value => receipts.push(value) });
      assert.equal(await page.evaluate(async () => (await fetch('/other', { method: 'POST' })).text()), 'untouched');
      assert.equal(receipts.length, 0); await page.close();
    } finally { await browser.close(); }
  });
