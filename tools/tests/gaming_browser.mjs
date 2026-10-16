/** Real Chromium/DOM/WebSocket usability check around the actual expedition
 * client and server runtime. The disk-backed store here is a TEST FIXTURE:
 * this check does not measure native Interego durability or production ping.
 * HM_CHROMIUM_EXECUTABLE and HM_PLAYWRIGHT_MODULE support external browsers.
 */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createGamingRuntime } from '../../server/gaming/runtime.js';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const require = createRequire(path.join(ROOT, 'server/package.json'));
const { WebSocketServer } = require('ws');
const playwrightModule = process.env.HM_PLAYWRIGHT_MODULE || 'playwright';
const { chromium } = await import(playwrightModule.startsWith('/') ? pathToFileURL(playwrightModule).href : playwrightModule);
const fixture = await fs.mkdtemp(path.join(tmpdir(), 'hm-gaming-browser-'));
const stateFile = path.join(fixture, 'state.json');
const realtime = process.env.HM_GAMING_TEST_REALTIME === '1';
let checkpointGate = null, releaseCheckpoint = () => {};
function holdCheckpoint() {
  let entered;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { releaseCheckpoint = resolve; });
  checkpointGate = { entered, held }; return started;
}
class DiskFixture {
  async load() { try { return JSON.parse(await fs.readFile(stateFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') return { version: 0, state: null }; throw error; } }
  async commit(id, request) {
    if (checkpointGate) { const gate = checkpointGate; checkpointGate = null; gate.entered(); await gate.held; }
    const previous = await this.load();
    if (previous.version !== request.expectedVersion) throw Object.assign(new Error('fixture conflict'), { code: 'VERSION_CONFLICT' });
    const next = { version: previous.version + 1, state: request.state };
    await fs.writeFile(stateFile + '.next', JSON.stringify(next)); await fs.rename(stateFile + '.next', stateFile);
    return this.load();
  }
}
const runtime = createGamingRuntime({ store: new DiskFixture(), persistenceMode: realtime ? 'realtime' : 'strict', send: (client, message) => { if (client.ws.readyState === 1) client.ws.send(JSON.stringify(message)); } });
await runtime.ready;
assert.equal(runtime.manifest().enabled, true);
const styles = readFileSync(path.join(ROOT, 'src/page.html'), 'utf8').match(/<style>([\s\S]*?)<\/style>/)[1];
const source = readFileSync(path.join(ROOT, 'src/14u_gaming.js'), 'utf8');
const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><title>Local expedition fixture verification</title><style>${styles}</style></head><body class="touch"><div id="menu"><div class="actions"></div></div><div id="mobile-tray-panel"></div><button id="mobile-menu-toggle">Menu</button><script>
window.__HM_GAMING=${JSON.stringify(runtime.manifest())};window.__hm={};
const UI={modal:null},IS_TOUCH=true,$=id=>document.getElementById(id);function closeMenu(){UI.modal=null}function mobileTray(){UI.modal=null}function mobileStopInput(){}
const NETWS={state:'opening',acct:null,generation:1,stats:{rtt:0},ws:new WebSocket(location.origin.replace('http','ws')+'/?name='+new URLSearchParams(location.search).get('name'))};
function netWsSend(message){if(NETWS.ws.readyState!==1)return false;NETWS.ws.send(JSON.stringify(message));return true}
NETWS.ws.onopen=()=>netWsSend({t:'hello'});NETWS.ws.onmessage=event=>{const message=JSON.parse(event.data);if(message.t==='welcome'){NETWS.state='on';NETWS.acct=message.acct}else gamingMsg(message)};
${source}</script></body></html>`;
const fullPage = process.env.HM_GAMING_FULL_PAGE ? readFileSync(path.join(ROOT, 'hallowmarch.html'), 'utf8') : null;
const server = http.createServer((req, res) => {
  let body = html;
  const name = new URL(req.url, 'http://fixture').searchParams.get('name');
  if (fullPage && name === 'alice') body = `<script>window.__HM_GAMING=${JSON.stringify(runtime.manifest())};window.__HM_NET_SERVER='ws://${req.headers.host}/?name=alice';</script>` + fullPage;
  res.writeHead(200, { 'content-type': 'text/html' }); res.end(body);
});
const wss = new WebSocketServer({ server });
wss.on('connection', (socket, req) => {
  const name = new URL(req.url, 'http://fixture').searchParams.get('name') || 'alice';
  const client = { ws: socket, acct: { id: name, name }, realm: 0 };
  socket.on('message', async data => { const message = JSON.parse(String(data)); if (message.t === 'hello') socket.send(JSON.stringify({ t: 'welcome', acct: client.acct, peer: name, token: 'local-fixture-' + name })); else if (message.t === 'load') socket.send(JSON.stringify({ t: 'save', d: null })); else if (message.t === 'save' || message.t === 'wipe') socket.send(JSON.stringify({ t: 'saved', ok: true })); else if (message.t === 'ping') socket.send(JSON.stringify({ t: 'pong', c: message.c })); else if (message.t === 'gaming') await runtime.handle(client, message); });
  socket.on('close', () => runtime.close(client));
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const launch = () => chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined,
  args: ['--no-sandbox', '--disable-dev-shm-usage', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', ...JSON.parse(process.env.HM_CHROMIUM_ARGS || '[]')] });
let contexts = [], browsers = [];
const errors = [];
try {
  const base = `http://127.0.0.1:${server.address().port}`;
  async function player(name, mobile) {
    const browser = await launch(); browsers.push(browser);
    const context = await browser.newContext({ viewport: mobile ? { width: 393, height: 852 } : { width: 1100, height: 850 }, hasTouch: mobile, isMobile: mobile }); contexts.push(context);
    const page = await context.newPage(); page.on('pageerror', error => errors.push(String(error)));
    if (fullPage && name === 'alice') await page.route('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js', route => route.fulfill({ contentType: 'application/javascript', body: readFileSync(process.env.HM_THREE_MODULE || path.join(ROOT, 'tools/node_modules/three/build/three.module.min.js'), 'utf8') }));
    await page.route('https://fonts.googleapis.com/**', route => route.fulfill({ contentType: 'text/css', body: '' }));
    if (name === 'alice' && !fullPage) await page.addInitScript(() => { window.GAME = { started: false, player: null }; });
    await page.goto(`${base}/?name=${name}&integrationTest=expedition`);
    if (name === 'alice' && !fullPage) {
      await page.waitForFunction(() => typeof NETWS !== 'undefined' && NETWS.state === 'on');
      await page.waitForTimeout(1100);
      assert.equal(await page.locator('#gaming-sheet').evaluate(el => el.hidden), true, 'Deep link must not cover fresh character creation');
      await page.evaluate(() => { window.GAME.started = true; window.GAME.player = { id: 'local-fixture-player' }; });
      console.log('PASS explicit diagnostic waits for a started character before opening its test encounter');
    }
    if (fullPage && name === 'alice') {
      await page.waitForFunction(() => window.__hm?.ready, undefined, { timeout: 180000 });
      await page.evaluate(() => { window.__hm.fn.setQuality('low'); window.__hm.start({ name: 'Alice', realm: 0 }); });
    }
    await page.waitForFunction(() => window.__hm.gaming.enabled && document.querySelector('#gaming-sheet').hidden === false);
    await page.locator('#gaming-enter').click();
    await page.waitForFunction(() => window.__hm.gaming.state.status === 'joined' && window.__hm.gaming.state.pending === 0);
    return page;
  }
  const alice = await player('alice', true), bob = await player('bob', false);
  await alice.waitForFunction(() => window.__hm.gaming.state.snapshot.entities.filter(e => e.kind === 'player').length === 2);
  assert.equal(await alice.locator('.gaming-marker').count(), 2);
  assert.match(await alice.locator('.gaming-selected strong').innerText(), /^You \+1$/);
  for (const [width, height] of [[393, 852], [393, 668], [320, 568], [852, 393]]) {
    await alice.setViewportSize({ width, height });
    await alice.locator('#gaming-sheet .sheet').evaluate(el => { el.scrollTop = 0; });
    const geometry = await alice.evaluate(() => {
      const sheet = document.querySelector('#gaming-sheet .sheet'), strike = document.querySelector('#gaming-attack'), close = document.querySelector('#gaming-close');
      const box = node => { const r = node.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return { w: r.width, h: r.height, hit: !!hit && (hit === node || node.contains(hit)), onScreen: r.y >= 0 && r.bottom <= innerHeight }; };
      return { width: innerWidth, overflow: document.documentElement.scrollWidth > innerWidth + 1 || sheet.scrollWidth > sheet.clientWidth + 1, strike: box(strike), close: box(close) };
    });
    assert.equal(geometry.overflow, false, JSON.stringify(geometry)); assert(geometry.close.hit && geometry.close.onScreen && geometry.close.h >= 44, JSON.stringify(geometry));
    // Landscape is scrollable; portrait combat must remain on the first screen.
    if (height > width) assert(geometry.strike.hit && geometry.strike.onScreen && geometry.strike.w >= 48, JSON.stringify(geometry));
    if (process.env.HM_GAMING_SCREENSHOTS) { await fs.mkdir(process.env.HM_GAMING_SCREENSHOTS, { recursive: true }); await alice.screenshot({ path: path.join(process.env.HM_GAMING_SCREENSHOTS, `expedition-${width}x${height}.png`), timeout: 180000 }); }
    console.log(`PASS expedition ${width}x${height}: no horizontal clipping; reachable close${height > width ? ' and strike' : ''}`);
  }
  await alice.setViewportSize({ width: 393, height: 852 }); await alice.locator('#gaming-sheet .sheet').evaluate(el => { el.scrollTop = 0; });
  let movementCheckpoint;
  if (realtime) { await runtime.room.flushPersistence(); movementCheckpoint = holdCheckpoint(); }
  for (let i = 1; i <= 2; i++) {
    await alice.locator('[data-gaming-dz="1"]').click();
    await alice.waitForFunction(z => window.__hm.gaming.state.snapshot.entities.find(e => e.id === 'alice').z === z, i);
    if (realtime) {
      await alice.waitForFunction(() => window.__hm.gaming.state.pending === 0 && window.__hm.gaming.state.liveSequence > window.__hm.gaming.state.durableSequence);
      await bob.waitForFunction(z => window.__hm.gaming.state.snapshot.entities.find(e => e.id === 'alice').z === z, i);
      assert.equal(await alice.locator('#gaming-save-status').innerText(), 'Live · Saving…');
      if (i === 1) await movementCheckpoint;
    }
    await alice.waitForTimeout(190);
  }
  if (realtime) {
    releaseCheckpoint();
    await alice.waitForFunction(() => window.__hm.gaming.state.liveSequence === window.__hm.gaming.state.durableSequence);
    assert.equal(await alice.locator('#gaming-save-status').innerText(), 'Live · Saved');
    console.log('PASS two players receive live movement while a background save is held; saved status follows its checkpoint');
  }
  await alice.locator('#gaming-arena').focus(); await alice.keyboard.press('Space');
  await bob.waitForFunction(() => window.__hm.gaming.state.snapshot.entities.find(e => e.kind === 'npc').hp === 90);
  await alice.waitForFunction(() => window.__hm.gaming.state.snapshot.entities.find(e => e.kind === 'npc').hp === 90);
  assert.equal(await alice.locator('.gaming-marker[data-kind="npc"] small').innerText(), '90/100');
  console.log('PASS real DOM actions and WebSocket snapshots agree across two browser players');
  for (let hp = 80; hp >= 0; hp -= 10) { await alice.waitForTimeout(720); await alice.locator('#gaming-attack').click(); await bob.waitForFunction(hp => window.__hm.gaming.state.snapshot.entities.find(e => e.kind === 'npc').hp === hp, hp); }
  let rewardCheckpoint;
  if (realtime) { await runtime.room.flushPersistence(); rewardCheckpoint = holdCheckpoint(); }
  await alice.getByRole('button', { name: 'Claim reward', exact: true }).click();
  await alice.waitForFunction(() => window.__hm.gaming.state.snapshot.rewards['guardian-token'] === 1);
  if (realtime) {
    await rewardCheckpoint;
    assert.match(await alice.locator('#gaming-reward-total').innerText(), /saving/);
    assert.equal(await alice.evaluate(() => window.__hm.gaming.state.persistence.pendingRewards), true);
    releaseCheckpoint();
    await alice.waitForFunction(() => !window.__hm.gaming.state.persistence.pendingRewards && window.__hm.gaming.state.pending === 0);
    assert.equal(await alice.locator('#gaming-reward-total').innerText(), '1 guardian-token');
    console.log('PASS reward preview remains labelled as saving until the durable checkpoint confirms it');
  }
  await alice.locator('#gaming-reset').click();
  await bob.waitForFunction(() => window.__hm.gaming.state.snapshot.entities.find(e => e.kind === 'npc').hp === 100 && window.__hm.gaming.state.snapshot.encounter.sequence === 2);
  assert.equal(await alice.locator('#gaming-reward-total').innerText(), '1 guardian-token');
  console.log('PASS guardian kill, unique reward and new encounter remain shared and confirmed');
  const agentSummary = alice.getByText('Bring your agent · teammate, pet or coach', { exact: true });
  await agentSummary.focus(); await alice.keyboard.press('Space');
  await alice.waitForFunction(() => [...document.querySelectorAll('#gaming-sheet summary')].find(el => el.textContent.startsWith('Bring your agent')).parentElement.open);
  console.log('PASS Space strikes from arena focus and preserves native accordion activation');
  await alice.locator('#gaming-spawn').click();
  await alice.waitForFunction(() => window.__hm.gaming.state.snapshot.entities.some(e => e.kind === 'companion'));
  const companion = await alice.evaluate(() => window.__hm.gaming.state.snapshot.entities.find(e => e.kind === 'companion').id);
  await alice.locator('#gaming-entity').selectOption(companion); await alice.locator('#gaming-agent').fill('did:example:my-agent');
  await alice.locator('#gaming-grant-form button').click();
  await alice.waitForFunction(() => document.querySelector('#gaming-token').value.startsWith('hmca_'));
  assert.equal(new URL(await alice.locator('#gaming-agent-discovery').getAttribute('href')).pathname, '/gaming/agents');
  await alice.locator('#gaming-token-copy').click();
  await alice.locator('#gaming-close').click(); assert.equal(await alice.locator('#gaming-token').inputValue(), '');
  console.log('PASS human companion grant flow returns a capability and closing clears it');
  assert.deepEqual(errors, []); console.log('PASS no browser errors (native storage outside this fixture check)');
} finally {
  releaseCheckpoint();
  await Promise.all(contexts.map(context => context.close())); await Promise.all(browsers.map(browser => browser.close())); wss.close(); await new Promise(resolve => server.close(resolve)); await fs.rm(fixture, { recursive: true, force: true });
}
