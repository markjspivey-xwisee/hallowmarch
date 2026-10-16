import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';
import { installNativeOwnerQaSession } from './native-owner-qa-session.mjs';

test('retained QA installer serializes in Chromium and imports actual allowlisted SDK assets without native I/O',
  { skip: !process.env.HM_PLAYWRIGHT_MODULE }, async () => {
    const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE).href);
    const assets = createPlayerBrowserAssets(); let unexpected = 0;
    const server = createServer((req, res) => {
      if (assets(req, res, new URL(req.url, 'http://fixture.example').pathname)) return;
      if (req.url === '/') { res.setHeader('Content-Type', 'text/html'); res.end('<!doctype html><title>QA installer fixture</title>'); return; }
      if (req.url !== '/favicon.ico') unexpected++;
      res.writeHead(404); res.end();
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const browser = await chromium.launch({ executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, headless: true });
    try {
      const page = await browser.newPage(); await page.goto('http://127.0.0.1:' + server.address().port);
      const config = { run: 'fixture', owner: { subjectDid: 'did:example:fixture', podUrl: 'https://pods.example/u-pk-fixture/', accountId: 'fixture' },
        relayOrigin: 'https://relay.example', expected: { qa: { run: 'fixture' } }, passphrase: 'fixture-passphrase' };
      const result = await page.evaluate(installNativeOwnerQaSession, config);
      assert.equal(result.profilePresent, false); assert.equal(result.keyStarted, false); assert.equal(result.complete, false);
      const diagnosis = await page.evaluate(() => window.__hmNativeQaSession.diagnose());
      assert.deepEqual(diagnosis, result); assert.equal(unexpected, 0);
      await page.evaluate(() => window.__hmNativeQaSession.close());
    } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
  });
