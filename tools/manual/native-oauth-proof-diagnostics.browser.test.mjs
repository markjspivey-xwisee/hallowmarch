import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { installNativeOAuthProofDiagnostics } from './native-oauth-proof-diagnostics.mjs';

test('owned popup diagnostics observe intercepted challenge refusal and preserve unknown in-flight work', {
  skip: !process.env.HM_PLAYWRIGHT_MODULE,
}, async () => {
  const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
  const browser = await chromium.launch({ headless: true }); let release;
  const pending = new Promise(resolve => { release = resolve; });
  try {
    const context = await browser.newContext();
    await context.route('**/*', async route => {
      if (route.request().url() === 'https://relay.example/') return route.fulfill({ contentType: 'text/html',
        body: '<!doctype html><input id="uid-userid"><button>Sign in</button><div id="uid-status"></div><div id="pk-status"></div>' });
      if (route.request().url() === 'https://identity.example/challenges') {
        if (route.request().postData() === 'hold') { await pending; return route.abort(); }
        return route.fulfill({ status: 404, contentType: 'application/json',
          headers: { 'Access-Control-Allow-Origin': 'https://relay.example' },
          body: '{"title":"No passkey is registered for that identifier","private":"MUST_NOT_CAPTURE"}' });
      }
      return route.abort();
    });
    const page = await context.newPage(); await page.goto('https://relay.example/');
    await page.evaluate(installNativeOAuthProofDiagnostics, { identityOrigin: 'https://identity.example' });
    const report = await page.evaluate(async () => {
      const response = await fetch('https://identity.example/challenges', { method: 'POST' });
      const value = await response.json();
      const element = document.getElementById('uid-status'); element.className = 'status err'; element.textContent = value.title;
      return { status: response.status, privateBodyPreserved: value.private === 'MUST_NOT_CAPTURE' };
    });
    assert.deepEqual(report, { status: 404, privateBodyPreserved: true });
    await page.waitForFunction(() => !window.__hmNativeProofDiagnostics.status().challengeInFlight);
    const refused = await page.evaluate(() => window.__hmNativeProofDiagnostics.status());
    assert.equal(refused.challengeRequests, 1); assert.equal(refused.challengeStatus, 404);
    assert.equal(refused.uiCode, 'challenge_refused'); assert.equal(refused.credentialInFlight, false);
    assert.equal(refused.uidFieldPresent, true); assert.equal(refused.signInPresent, true);
    assert.equal(JSON.stringify(refused).includes('MUST_NOT_CAPTURE'), false);
    await page.evaluate(() => { void fetch('https://identity.example/challenges', { method: 'POST', body: 'hold' }).catch(() => {}); });
    await page.waitForFunction(() => window.__hmNativeProofDiagnostics.status().challengeInFlight);
    const blocked = await page.evaluate(() => window.__hmNativeProofDiagnostics.status());
    assert.equal(blocked.challengeRequests, 2); assert.equal(blocked.challengeStatus, null);
    assert.equal(blocked.challengeInFlight, true, 'unknown pending work is never called a settled refusal');
    release();
    await page.waitForFunction(() => !window.__hmNativeProofDiagnostics.status().challengeInFlight);
    await context.close();
  } finally { release(); await browser.close(); }
});
