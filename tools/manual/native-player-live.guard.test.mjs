import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const runner = fileURLToPath(new URL('./native-player-live.mjs', import.meta.url));
function invoke(extra = {}) {
  // An invalid browser import makes a premature launch/import visible without
  // ever depending on a live service or a locally installed browser.
  const env = { PATH: process.env.PATH, HM_PLAYWRIGHT_MODULE: '/this-module-must-never-be-imported.mjs', ...extra };
  return spawnSync(process.execPath, [runner], { env, encoding: 'utf8', timeout: 5000 });
}
test('default and nonexact opt-in exit before any browser import', () => {
  for (const flag of [undefined, '0', 'true', 'yes']) {
    const result = invoke(flag === undefined ? {} : { HM_NATIVE_LIVE_TEST: flag });
    assert.equal(result.status, 0); assert.match(result.stdout, /^SKIP:/); assert.equal(result.stderr, '');
  }
});
test('explicit opt-in still refuses absent or ambiguous live origins before browser import', () => {
  for (const origins of [
    {},
    { HM_NATIVE_ORIGIN: 'http://game.example', HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' },
    { HM_NATIVE_ORIGIN: 'https://game.example/path', HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' },
    { HM_NATIVE_ORIGIN: 'https://game.example?token=do-not-log-this', HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' },
    { HM_NATIVE_ORIGIN: 'https://user:do-not-log-this@game.example', HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' },
    { HM_NATIVE_ORIGIN: 'https://game.example', HM_NATIVE_RELAY_ORIGIN: 'https://game.example' },
  ]) {
    const result = invoke({ HM_NATIVE_LIVE_TEST: '1', ...origins });
    assert.equal(result.status, 2); assert.equal(result.stdout, ''); assert.match(result.stderr, /^FAIL: configuration\./);
    assert(!result.stderr.includes('do-not-log-this')); assert(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));
  }
});
test('known debug/tracing flags are refused before a live browser can start', () => {
  for (const name of ['DEBUG', 'PWDEBUG', 'PW_TEST_TRACE', 'NODE_DEBUG']) {
    const result = invoke({ HM_NATIVE_LIVE_TEST: '1', HM_NATIVE_ORIGIN: 'https://game.example',
      HM_NATIVE_RELAY_ORIGIN: 'https://relay.example', [name]: '1' });
    assert.equal(result.status, 2); assert.match(result.stderr, /^FAIL: configuration\./);
    assert(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));
  }
});
test('a browser import failure emits only its fixed stage, never the raw module error', () => {
  const result = invoke({ HM_NATIVE_LIVE_TEST: '1', HM_NATIVE_ORIGIN: 'https://game.example',
    HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' });
  assert.equal(result.status, 1); assert.match(result.stderr, /^FAIL: native live QA at load-browser \[stage_failed\]\./);
  assert.equal(result.stdout, ''); assert(!result.stderr.includes('ERR_MODULE_NOT_FOUND'));
  assert(!result.stderr.includes('this-module-must-never-be-imported'));
});
test('failed boot reports its retained page without secrets and stalled cleanup cannot block context close', () => {
  const directory = mkdtempSync(join(tmpdir(), 'hm-qa-offline-'));
  const fixture = join(directory, 'fake-browser.mjs');
  try {
    // A pure in-process fake: no Playwright, game host, relay, socket or native
    // write. Unresolved evaluate reproduces a stalled software renderer.
    writeFileSync(fixture, `
      const page = { on() {}, url: () => 'https://game.example/?token=NEVER-LOG-THIS', isClosed: () => false,
        async goto() { throw new Error('secret URL NEVER-LOG-THIS'); }, evaluate: () => new Promise(() => {}) };
      let handler, closed = false;
      const context = { on(event, listener) { if (event === 'page') handler = listener; },
        async newPage() { handler(page); return page; }, pages: () => [page], close() { closed = true; return new Promise(() => {}); } };
      export const chromium = { async launch() { return { async newContext() { return context; },
        async close() { if (!closed) process.exitCode = 88; } }; } };
    `);
    const result = invoke({ HM_NATIVE_LIVE_TEST: '1', HM_NATIVE_ORIGIN: 'https://game.example',
      HM_NATIVE_RELAY_ORIGIN: 'https://relay.example', HM_PLAYWRIGHT_MODULE: fixture });
    assert.equal(result.error, undefined); assert.equal(result.status, 1);
    assert.match(result.stderr, /^FAIL: native live QA at initial-game-boot \[stage_failed\]\./);
    const report = result.stdout.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line))[0];
    assert.equal(report.kind, 'native_qa_boot'); assert.equal(report.boot, 'initial'); assert.equal(report.bootStep, 'navigation');
    assert.equal(report.count, 1); assert.equal(report.openCount, 1); assert.equal(report.pages[0].originClass, 'game');
    assert(!result.stdout.includes('NEVER-LOG-THIS')); assert(!result.stderr.includes('NEVER-LOG-THIS'));
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
