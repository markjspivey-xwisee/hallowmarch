/** Real renderer regression with synthetic records only. No account or game service is contacted. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const moduleUrl = process.env.HM_PLAYWRIGHT_MODULE
  ? pathToFileURL(resolve(process.env.HM_PLAYWRIGHT_MODULE))
  : new URL('../../tools/node_modules/playwright/index.mjs', import.meta.url);
const { chromium } = await import(moduleUrl);
const source = await readFile(new URL('./activity-dashboard.mjs', import.meta.url), 'utf8');
let browser;
test.before(async () => { browser = await chromium.launch({ headless: true }); });
test.after(async () => { await browser?.close(); });

const CONTEXT = 'urn:interego:gaming:activity:context', OBSERVATION = 'urn:interego:gaming:activity:observation';
function fixtureData() {
  const events = Array.from({ length: 20 }, (_, index) => ({
    id: 'urn:uuid:00000000-0000-4000-8000-' + String(index + 1).padStart(12, '0'),
    type: 'resource.gathered', ordinal: index + 1, observedAt: '2026-10-27T12:00:' + String(index).padStart(2, '0') + '.000Z',
    body: { id: 'synthetic-body', kind: 'character' }, actor: { kind: 'unattributed' },
    object: { id: index === 19 ? '<svg onload="window.__dashboardXss=true">' : 'Stone' },
    result: { quantity: index + 1 }, context: { party: false },
  }));
  const statements = events.map(event => ({
    id: event.id.slice(9), actor: { objectType: 'Agent', account: { homePage: 'https://identity.example', name: 'did:example:synthetic-owner' } },
    verb: { id: 'urn:interego:gaming:activity:verb:resource.gathered' },
    object: { objectType: 'Activity', id: 'urn:synthetic:stone', definition: { name: { en: 'Stone' } } },
    context: { registration: '00000000-0000-4000-8000-000000000099', extensions: { [CONTEXT]: {
      eventType: event.type, bodyKind: 'character', bodyId: 'synthetic-body', controllerKind: 'unattributed',
    } } },
    result: { extensions: { [OBSERVATION]: { authority: 'owner-browser-observation', competencyStatus: 'not-assessed', historyOrdinal: event.ordinal, quantity: event.result.quantity } } },
    timestamp: event.observedAt,
  }));
  const accountStatement = structuredClone(statements.at(-1));
  accountStatement.object.definition.name.en = 'Account A private detail';
  accountStatement.authority = { objectType: 'Agent', account: { homePage: 'https://foxxi.example', name: 'synthetic-record-service' } };
  accountStatement.stored = '2026-10-27T12:01:00.000Z'; accountStatement.version = '2.0.0';
  return { scopeKey: 'synthetic-account-a', characterName: '<img src=x onerror="window.__dashboardXss=true">', identityState: 'native',
    local: { revision: 1, eventCount: 900, lastEventAt: events.at(-1).observedAt,
      summary: { counters: { 'resource.gathered': 900 } }, history: { detailsDropped: 700, captureUnavailable: 2, coverage: { retainedEvents: 64 } } },
    events, statements, recording: { scoped: true, enabled: true, expiresAt: '2026-10-27T12:15:00.000Z', acknowledgedCount: 70, pendingCount: 0, closedUnconfirmedCount: 0 },
    account: { state: 'ready', statements: [accountStatement], summary: { total: 154, byVerb: [{ id: statements[0].verb.id, count: 154 }], saturated: false },
      coverage: { retainedCount: 12, prunedCount: 142, retentionMs: 3600000, completeHistory: false,
        retainedFrom: '2026-10-27T11:45:00.000Z', through: '2026-10-27T12:01:00.000Z' },
      more: true, checkedAt: '2026-10-27T12:02:00.000Z', note: 'PRIVATE_ACCOUNT_A' },
  };
}

async function mount(t, width) {
  const page = await browser.newPage({ viewport: { width, height: 850 } });
  t.after(() => page.close());
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{margin:0;padding:8px;font:16px/1.4 system-ui;background:#0b0d10;color:#efe6d3}main{max-width:960px;margin:auto;min-width:0}button,select{font:inherit}</style><main id="mount"></main>');
  await page.addScriptTag({ type: 'module', content: source + '\nwindow.mountActivityDashboard = mountActivityDashboard;' });
  await page.waitForFunction(() => typeof window.mountActivityDashboard === 'function');
  await page.evaluate(data => {
    window.__dashboardXss = false;
    window.calls = { refresh: 0, load: 0, more: 0, analyze: 0, manage: 0, inspect: 0 };
    window.dashboardData = data;
    window.dashboard = window.mountActivityDashboard(document.getElementById('mount'), {
      onRefresh: () => window.calls.refresh++, onLoadAccount: () => window.calls.load++, onMoreAccount: () => window.calls.more++,
      onAnalyze: () => window.calls.analyze++, onManageRecording: () => window.calls.manage++, onInspect: () => window.calls.inspect++,
    });
    window.dashboard.update(data);
  }, fixtureData());
  return { page, errors, requests };
}
async function update(page, change) {
  await page.evaluate(change => { Object.assign(window.dashboardData, change); window.dashboard.update(window.dashboardData); }, change);
}
async function cardValues(page) {
  return page.locator('.had-card').evaluateAll(cards => Object.fromEntries(cards.map(card => [card.querySelector('small').textContent, card.querySelector('strong').textContent])));
}
const noCalls = { refresh: 0, load: 0, more: 0, analyze: 0, manage: 0, inspect: 0 };

for (const width of [320, 390, 1280]) test(`activity dashboard keeps scope, privacy and keyboard behavior at ${width}px`, async t => {
  const { page, errors, requests } = await mount(t, width);
  const root = page.locator('[data-hm-activity-dashboard]');
  assert.deepEqual(await cardValues(page), { 'Observed with this character': '900', 'Recent details shown': '16', 'Optional recording': 'On' });
  assert.match(await root.innerText(), /Until /);
  assert.equal(await page.locator('img,svg,iframe').count(), 0, 'untrusted names and objects remain text');
  assert.equal(await page.evaluate(() => window.__dashboardXss), false);
  assert.deepEqual(await page.evaluate(() => window.calls), noCalls, 'mounting and first update invoke no actions');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.getByText('Control unknown', { exact: false }).count(), 16);

  const inspect = page.getByText('Inspect xAPI record', { exact: true }).first();
  await inspect.click();
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const focusKey = await inspect.getAttribute('data-focus-key');
  await inspect.focus();
  await page.evaluate(() => { window.dashboardData.local.eventCount++; window.dashboard.update(window.dashboardData); });
  assert.equal(await page.evaluate(() => document.activeElement.tagName), 'SUMMARY');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.focusKey), focusKey);
  assert.equal(await page.locator('details').filter({ has: page.locator(`[data-focus-key="${focusKey}"]`) }).getAttribute('open'), '');
  assert.deepEqual(await page.evaluate(() => window.calls), noCalls, 'live updates and disclosure toggles are read-only');

  await page.getByRole('tab', { name: 'This character', exact: true }).focus();
  for (const [key, label] of [['ArrowRight', 'Account record'], ['ArrowRight', 'This character'], ['End', 'Account record'], ['Home', 'This character'], ['ArrowLeft', 'Account record']]) {
    await page.keyboard.press(key);
    assert.equal(await page.getByRole('tab', { name: label, exact: true }).getAttribute('aria-selected'), 'true');
    assert.equal(await page.evaluate(() => document.activeElement.textContent), label);
  }
  assert.deepEqual(await cardValues(page), { 'Account observations': '154', 'Recent records retained': '12', 'Recent records shown': '1' });
  assert.match(await root.innerText(), /Detail retention: up to 60 minutes/);
  assert.match(await root.innerText(), /Earlier details pruned: 142/);
  const record = page.getByText('Inspect xAPI record', { exact: true }); await record.click();
  assert.deepEqual(JSON.parse(await root.locator('pre').textContent()), fixtureData().account.statements[0], 'inspection retains the exact returned xAPI envelope');
  assert.deepEqual(await page.evaluate(() => window.calls), noCalls);
  await page.getByRole('button', { name: 'Load more account records', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => window.calls), { ...noCalls, more: 1 }, 'continuation is explicit');

  await update(page, { account: { state: 'loading', statements: [], note: '' } });
  assert.match(await root.innerText(), /Reading your own account record/);
  assert.equal(await page.getByRole('button', { name: 'Loading account record…', exact: true }).isDisabled(), true);
  assert.equal(await root.locator('.had-event').count(), 0);
  await update(page, { account: { state: 'error', statements: [], note: 'Synthetic read unavailable. No activity was sent.' } });
  assert.match(await root.innerText(), /Synthetic read unavailable/);
  assert.doesNotMatch(await root.innerText(), /No observations are recorded/);
  await update(page, { account: { state: 'ready', statements: [], summary: { total: 0 }, coverage: { retainedCount: 0, prunedCount: 0 }, more: false } });
  assert.equal((await cardValues(page))['Account observations'], '0');
  assert.match(await root.innerText(), /No observations are recorded in the returned account profile/);
  assert.equal(await page.getByRole('button', { name: 'Load more account records', exact: true }).count(), 0);
  assert.deepEqual(await page.evaluate(() => window.calls), { ...noCalls, more: 1 }, 'state updates never trigger load or recording callbacks');

  await update(page, { account: fixtureData().account });
  await page.getByText('Inspect xAPI record', { exact: true }).click();
  assert.match(await root.innerText(), /Account A private detail/);
  await page.evaluate(() => { window.oldLoadButton = document.querySelector('[data-focus-key="load-account"]'); });
  await update(page, { scopeKey: 'synthetic-account-b', characterName: 'Another synthetic character', events: [], statements: [],
    local: { eventCount: 0, summary: { counters: {} }, history: {} }, recording: { scoped: false }, account: fixtureData().account });
  assert.equal(await page.getByRole('tab', { name: 'This character', exact: true }).getAttribute('aria-selected'), 'true');
  assert.doesNotMatch(await root.textContent(), /PRIVATE_ACCOUNT_A|Account A private detail|did:example:synthetic-owner/);
  assert.equal(await root.locator('details[open]').count(), 0, 'expanded private detail is reset with scope');
  await page.getByRole('tab', { name: 'Account record', exact: true }).click();
  assert.match(await root.innerText(), /Your account record has not been loaded/);
  await page.evaluate(() => window.oldLoadButton.click());
  assert.deepEqual(await page.evaluate(() => window.calls), { ...noCalls, more: 1 }, 'detached controls from the previous scope cannot invoke callbacks');

  await update(page, { identityState: 'character-only', account: fixtureData().account, recording: { scoped: true, enabled: true, acknowledgedCount: 999 } });
  assert.match(await root.innerText(), /Connect your native identity/);
  assert.doesNotMatch(await root.textContent(), /PRIVATE_ACCOUNT_A|Account A private detail/);
  assert.equal(await page.getByRole('button', { name: /Load account record|Refresh account record/ }).count(), 0);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
  assert.equal(await page.evaluate(() => window.__dashboardXss), false);
  assert.deepEqual(errors, []); assert.deepEqual(requests, [], 'the renderer performs no network requests');

  if (width === 1280 && process.env.HM_DASHBOARD_SCREENSHOT) {
    const preview = fixtureData().account; preview.note = 'Synthetic account preview';
    preview.statements[0].object.definition.name.en = 'Stone gathered · synthetic example';
    await update(page, { scopeKey: 'synthetic-preview', characterName: 'Elowen of Logres', identityState: 'native', account: preview });
    await update(page, { account: preview });
    await page.getByRole('tab', { name: 'Account record', exact: true }).click();
    const path = resolve(process.env.HM_DASHBOARD_SCREENSHOT); await mkdir(dirname(path), { recursive: true });
    await page.screenshot({ path, fullPage: true });
  }
});
