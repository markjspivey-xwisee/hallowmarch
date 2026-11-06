// Standalone diagnostic smoke; never imported by the game's GPU tests.
// It creates no canvas/WebGL context and disables GPU for this DOM-only check.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';
import { chromiumSwitches } from '../node_modules/playwright-core/lib/server/chromium/chromiumSwitches.js';
import { installReadinessResponsivenessProbe, sampleTrustedReadinessInputs } from '../readiness_responsiveness.mjs';

const result = { startedAt: new Date().toISOString(), headless: true, chromiumSandbox: true,
  domOnly: true, gpuDisabled: true, args: ['--disable-gpu'], noCanvas: true, noFocusChanges: true,
  noAutomaticRetry: true, gameGpuPerformanceEvidence: false, errors: [] };
const output = new URL('../out/readiness-responsiveness-dom-smoke.json', import.meta.url);
const helper = await readFile(new URL('../readiness_responsiveness.mjs', import.meta.url));
result.helperSha256 = createHash('sha256').update(helper).digest('hex');
let server, browser;
const bounded = (promise, ms) => { let timer; return Promise.race([promise, new Promise((_, reject) => {
  timer = setTimeout(() => reject(Error('Owned DOM browser cleanup timed out.')), ms);
})]).finally(() => clearTimeout(timer)); };
try {
  const ignored = [...chromiumSwitches(false, 'msedge'), '--hide-scrollbars', '--mute-audio',
    '--blink-settings=primaryHoverType=2,availableHoverTypes=2,primaryPointerType=4,availablePointerTypes=4'];
  server = await chromium.launchServer({ host: '127.0.0.1', channel: 'msedge', headless: true, chromiumSandbox: true,
    ignoreDefaultArgs: ignored, args: result.args, timeout: 45000 });
  browser = await chromium.connect(server.wsEndpoint()); result.browserVersion = browser.version();
  const context = await browser.newContext({ viewport: { width: 640, height: 480 } });
  const page = await context.newPage(); page.on('pageerror', error => result.errors.push(error.message));
  await page.addInitScript(installReadinessResponsivenessProbe);
  await page.goto('data:text/html,<html><body><p>DOM-only startup probe smoke</p></body></html>', { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    window.gameInputSeen = [];
    for (const type of ['keydown', 'keyup']) {
      window.addEventListener(type, event => window.gameInputSeen.push({ type, code: event.code, trusted: event.isTrusted }), true);
      document.addEventListener(type, event => window.gameInputSeen.push({ type, code: event.code, trusted: event.isTrusted }), true);
    }
  });
  result.commands = await sampleTrustedReadinessInputs(page, { maxSamples: 1, intervalMs: 1, timeoutMs: 2000 });
  assert.equal(result.commands.timedOut, false); assert.equal(result.commands.samples.length, 1); assert(result.commands.samples[0].deliveredCommand);
  await page.waitForFunction(() => { const input = window.__readinessResponsive.snapshot().inputs[0]; return !!input && input.secondFrameOpportunityMs !== null; },
    null, { timeout: 10000 });
  result.observed = await page.evaluate(() => ({ probe: window.__readinessResponsive.stop(), gameInputSeen: window.gameInputSeen,
    hasFocus: document.hasFocus(), visibility: document.visibilityState, canvasCount: document.querySelectorAll('canvas').length }));
  const input = result.observed.probe.inputs[0];
  assert.equal(input.trusted, true); assert.equal(input.hidden, false); assert.equal(input.focused, true);
  assert(input.inputDelayMs !== null && input.inputDelayMs >= 0); assert(input.keyupAt !== null);
  assert(input.nextFrameOpportunityMs >= 0); assert(input.secondFrameOpportunityMs >= input.nextFrameOpportunityMs);
  assert.equal(result.observed.canvasCount, 0); assert.deepEqual(result.observed.gameInputSeen, []); assert.deepEqual(result.errors, []);
  result.ok = true;
} catch (error) { result.ok = false; result.failure = String(error.stack || error); }
finally {
  if (browser) await bounded(browser.close(), 10000).catch(error => { result.closeError = String(error); result.ok = false; });
  if (server) await bounded(server.close(), 5000).catch(async error => { result.closeError = String(error); result.ok = false; await server.kill(); });
  result.finishedAt = new Date().toISOString(); await mkdir(new URL('../out/', import.meta.url), { recursive: true });
  await writeFile(output, JSON.stringify(result, null, 2) + '\n');
}
console.log(JSON.stringify({ ok: result.ok, failure: result.failure, browser: result.browserVersion,
  input: result.observed?.probe.inputs[0], gameInputSeen: result.observed?.gameInputSeen, domOnly: true, gpuDisabled: true }));
if (!result.ok) process.exitCode = 1;
