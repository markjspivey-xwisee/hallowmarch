import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';
import { installNativeCompanionOwnerQaSession } from './native-companion-owner-session.mjs';

test('manual companion owner installer serializes in Chromium with actual shipped modules and no native I/O',
  { skip: !process.env.HM_PLAYWRIGHT_MODULE }, async () => {
    const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
    const assets = createPlayerBrowserAssets(); let unexpected = 0;
    const server = createServer((req, res) => {
      if (assets(req, res, new URL(req.url, 'http://fixture.example').pathname)) return;
      unexpected++; res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined });
    try {
      const page = await browser.newPage();
      await page.route('**/*', async route => {
        const url = new URL(route.request().url());
        assert.equal(url.origin, 'https://game.example');
        if (url.pathname === '/' || url.pathname === '/favicon.ico') { await route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline companion fixture</title>' }); return; }
        assert(url.pathname.startsWith('/gaming/identity/assets/'));
        const response = await fetch('http://127.0.0.1:' + server.address().port + url.pathname);
        assert(response.ok); await route.fulfill({ status: response.status, contentType: response.headers.get('content-type'), body: await response.text() });
      });
      await page.goto('https://game.example/');
      const status = await page.evaluate(installNativeCompanionOwnerQaSession, { enabled: true, run: 'offline-fixture',
        gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example',
        owner: { accountId: 'qa', subjectDid: 'did:web:identity.example:users:qa', podUrl: 'https://pods.example/qa/' },
        agentDid: 'did:web:identity.example:agents:root', agentPodUrl: 'https://pods.example/root/' });
      assert.equal(status.publicationAttempted, false); assert.equal(status.bodyPresent, false); assert.equal(status.requestPending, false);
      assert.equal(unexpected, 0); await page.evaluate(() => window.__hmNativeCompanionQa.close());
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  });
