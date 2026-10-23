/** Temporary release acceptance: real deployed UI, no mocks or custody export. */
import fs from 'node:fs/promises';
import { chromium } from '../node_modules/playwright/index.mjs';

const preview = 'https://march-native-preview-production.up.railway.app/?safe=1';
const relayHealth = 'https://relay.interego.xwisee.com/health';
const expectedRelay = '0fe5e953769b316cb0dcf4f3650cdb162f446976';
const out = 'tools/out/release-browser-smoke';
const reports = [], network = [];
const noteNetwork = value => { if (network.length < 48) network.push(value); };
function endpoint(url) {
  try {
    const u = new URL(url);
    if (u.origin === new URL(preview).origin && u.pathname.startsWith('/gaming/identity/')) return u.pathname;
    if (u.origin === 'https://identity.interego.xwisee.com') return 'native-identity';
    if (u.origin === 'https://relay.interego.xwisee.com') return 'native-relay';
  } catch { /* not a relevant endpoint */ }
  return null;
}
let stage = 'relay-readiness', browser, page;
const ensure = (ok, code) => { if (!ok) throw new Error(code); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const pass = name => { reports.push({ check: name, passed: true }); console.log('PASS ' + name); };
function revisionPresent(value) {
  if (typeof value === 'string') return value.length >= 7 && (value === expectedRelay || expectedRelay.startsWith(value));
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(revisionPresent);
}
async function ready() {
  const until = Date.now() + 15 * 60_000;
  while (Date.now() < until) {
    try {
      const response = await fetch(relayHealth, { signal: AbortSignal.timeout(10_000), redirect: 'error' });
      if (response.ok && revisionPresent(await response.json())) return;
    } catch { /* Public health is polled without logging its payload or URL query. */ }
    await pause(15_000);
  }
  throw new Error('expected_relay_revision_not_ready');
}
async function settledSave() {
  await page.waitForFunction(() => {
    const h = window.__hm, status = h?.nativePlayerStatus?.();
    let last;
    try { last = JSON.parse(h?.SAVE.lastBody || 'null'); } catch { return false; }
    return status?.readConfirmed && status.profileStatus?.hasRecord && !status.profileStatus.pending
      && !h.SAVE.pending && !h.SAVE.nativeFlight && last?.char?.name === 'ReleaseQA';
  }, undefined, { timeout: 120_000 });
}
async function skipPrologue() {
  const skip = page.getByRole('button', { name: 'Skip the prologue', exact: true });
  if (await skip.isVisible()) await skip.click();
}
async function checkpointIdentity() {
  // Identifiers remain only in this ephemeral process, never logs/artifacts.
  return page.evaluate(() => ({
    character: window.__hm.SAVE.loaded?.nativePlay?.characterId,
    deadline: window.__hm.SAVE.loaded?.nativePlay?.guestExpiresAt
  }));
}
async function pauseAndSave() {
  await page.locator('#btn-menu').click();
  await page.waitForFunction(() => window.__hm?.UI.modal === 'menu'
    && window.__hm.net?.NETWS?.humanSuspended === true
    && !window.__hm.net.NETWS.pingTimer);
  await settledSave();
}
try {
  await fs.mkdir(out, { recursive: true });
  await ready(); pass('expected relay revision ready');
  stage = 'fresh-ui';
  browser = await chromium.launch({ headless: true, args: [
    '--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'
  ] });
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  page = await context.newPage();
  let popups = 0, pageErrors = 0;
  context.on('page', candidate => { if (candidate !== page) popups++; });
  page.on('pageerror', () => { pageErrors++; });
  page.on('response', async response => {
    const label = endpoint(response.url()); if (!label) return;
    const entry = { endpoint: label, method: response.request().method(), status: response.status() };
    noteNetwork(entry);
    if (entry.status >= 400) {
      try {
        const body = await response.json(), candidate = body?.error?.code || body?.error || body?.code;
        if (typeof candidate === 'string' && /^[a-z][a-z0-9_]{0,79}$/.test(candidate)) entry.code = candidate;
      } catch { /* never retain response bodies */ }
    }
  });
  page.on('requestfailed', request => {
    const label = endpoint(request.url());
    if (label) noteNetwork({ endpoint: label, method: request.method(), code: 'network_request_failed' });
  });
  await page.goto(preview, { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__hm?.ready
    && document.querySelector('#btn-begin')?.textContent.trim() === 'Play now'
    && !document.querySelector('#btn-begin').disabled, undefined, { timeout: 180_000 });
  await page.getByRole('textbox', { name: 'Character name', exact: true }).fill('ReleaseQA');
  await page.getByRole('button', { name: 'Play now', exact: true }).click();
  stage = 'guest-checkpoint';
  await page.waitForFunction(() => window.__hm?.GAME.started && window.__hm.GAME.player?.name === 'ReleaseQA'
    && window.__hm.nativePlayerStatus?.().readConfirmed, undefined, { timeout: 180_000 });
  await skipPrologue();
  const initial = await checkpointIdentity();
  ensure(typeof initial.character === 'string' && initial.character.length > 10, 'guest_character_id_missing');
  ensure(Number.isFinite(initial.deadline) && initial.deadline > Date.now()
    && initial.deadline <= Date.now() + 24 * 60 * 60_000 + 60_000, 'guest_fixed_deadline_invalid');
  pass('Play now confirmed a temporary native checkpoint and entered the named character');
  // Ordinary trusted gameplay input; no calls to game hooks or hidden state writes.
  await page.locator('#scene').click({ position: { x: 650, y: 430 } });
  await page.keyboard.down('w'); await pause(500); await page.keyboard.up('w');
  stage = 'active-shared-world';
  await page.waitForFunction(() => {
    const h = window.__hm, n = h?.net, w = n?.NETWS;
    return n?.NET.state === 'on' && n.NET.link?.connected?.() === true
      && w?.state === 'on' && w.ws?.readyState === 1 && w.acct?.nativeBound === true
      && w.humanSuspended === false && w.worldInitialized === true
      && !!w.activeWorldAdmission && !w.worldReloadRequired && !w.worldPauseReason
      && w.worldPersistence?.mode === 'native' && w.worldPersistence.confirmedVersion > 0;
  }, undefined, { timeout: 90_000 });
  pass('trusted gameplay input joined the authenticated live native shared world');
  stage = 'save-and-idle';
  await pauseAndSave();
  const sent = await page.evaluate(() => window.__hm.net.NETWS.stats.sent);
  await pause(3500);
  ensure(await page.evaluate(sent => window.__hm.net.NETWS.stats.sent === sent
    && window.__hm.net.NETWS.humanSuspended === true && !window.__hm.SAVE.pending, sent), 'idle_transport_or_save_continued');
  pass('ordinary menu pause confirmed the character save and suspended idle transport');
  stage = 'reload-same-character';
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => window.__hm?.ready && window.__hm.nativePlayerStatus?.().readConfirmed
    && window.__hm.SAVE.loaded?.char?.name === 'ReleaseQA'
    && !document.querySelector('#btn-continue')?.disabled, undefined, { timeout: 180_000 });
  const restored = await checkpointIdentity();
  ensure(restored.character === initial.character && restored.deadline === initial.deadline, 'reload_character_or_deadline_changed');
  ensure(await page.locator('#continue-desc').innerText().then(text => text.includes('ReleaseQA')), 'continue_character_label_missing');
  await page.getByRole('button', { name: 'Return to the march', exact: true }).click();
  await page.waitForFunction(() => window.__hm?.GAME.started && window.__hm.GAME.player?.name === 'ReleaseQA');
  await skipPrologue();
  pass('reload read the same native character and fixed expiry before returning to the realm');
  stage = 'keep-sheet-cancel';
  await page.locator('#btn-keep-character').click();
  await page.locator('#netsheet .sheet').waitFor({ state: 'visible' });
  ensure(await page.locator('#netsheet-acct .native-player').getByRole('button', { name: 'Keep my character', exact: true }).isVisible(),
    'keep_character_action_missing');
  await page.locator('#netsheet-close').click();
  ensure(await page.locator('#netsheet').isHidden(), 'keep_sheet_failed_to_close');
  ensure(popups === 0, 'unexpected_identity_popup');
  const afterCancel = await checkpointIdentity();
  ensure(afterCancel.character === initial.character && afterCancel.deadline === initial.deadline, 'cancel_changed_character');
  ensure(await page.evaluate(() => window.__hm.GAME.player?.name === 'ReleaseQA'), 'cancel_changed_active_character');
  pass('Keep my character sheet closed without authentication or character replacement');
  ensure(pageErrors === 0, 'unhandled_browser_error');
  // Canvas only: no identity sheet, storage, tokens, grants or private checkpoint body.
  await page.locator('#scene').screenshot({ path: out + '/public-world.png', timeout: 60_000 });
  await pauseAndSave();
  pass('final pause checkpoint confirmed; public world screenshot captured');
  await fs.writeFile(out + '/result.json', JSON.stringify({ passed: true, checks: reports }, null, 2));
} catch (error) {
  // Never print exception stacks, request headers, response bodies or browser storage.
  const code = /^[a-z0-9_]+$/.test(error?.message || '') ? error.message : 'browser_step_failed';
  let status = null, transport = null;
  try {
    status = await page?.evaluate(() => window.__hm?.nativePlayerStatus?.() || null);
    transport = await page?.evaluate(() => {
      const n = window.__hm?.net, w = n?.NETWS;
      return { state: w?.state, roomState: n?.NET.state, welcomed: !!w?.acct?.nativeBound,
        socketOpen: w?.ws?.readyState === 1, suspended: w?.humanSuspended === true,
        worldInitialized: w?.worldInitialized === true, admissionPresent: !!w?.activeWorldAdmission,
        worldPaused: !!w?.worldPauseReason, reloadRequired: w?.worldReloadRequired === true,
        worldMode: w?.worldPersistence?.mode, worldState: w?.worldPersistence?.state };
    });
  } catch { /* browser closed */ }
  await fs.mkdir(out, { recursive: true });
  await fs.writeFile(out + '/result.json', JSON.stringify({ passed: false, stage, code, status, transport, network, checks: reports }, null, 2));
  console.error(JSON.stringify({ failed: true, stage, code, status, transport, network }));
  process.exitCode = 1;
} finally {
  await browser?.close();
}
