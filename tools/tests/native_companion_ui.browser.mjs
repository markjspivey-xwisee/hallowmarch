/** Real game companion UI + owner cache + SDK publication in Chromium.
 * Native storage/proof and game authority are explicit network fixtures. */
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';
import { publicRecordFixture, binding } from '../../client/native-pod/public-record.fixture.mjs';
import { parseTrig } from '../../client/native-pod/vendor/interego-browser.mjs';
if (!process.env.HM_PLAYWRIGHT_MODULE) throw Error('Set HM_PLAYWRIGHT_MODULE.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await readFile(path.join(root, 'src/14u_gaming.js'), 'utf8'), identitySource = await readFile(path.join(root, 'src/14v_nativeidentity.js'), 'utf8');
const styles = (await readFile(path.join(root, 'src/page.html'), 'utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
const f = publicRecordFixture(), origin = 'https://game.example', refs = new Map(), gameRequests = [], events = [], browserErrors = [];
const actions = { register: origin + '/composed/party/register-owner-reference', revoke: origin + '/composed/party/stop-owner-access' };
let disabled = false, poisoned = false, denyOwner = false, registerDurable = false, revokeDurable = false;
let heldResponse = null;
const responseGates = [];
function holdResponse(stage) {
  let release, entered;
  const gate = { stage, wait: new Promise(resolve => { release = resolve; }), started: new Promise(resolve => { entered = resolve; }), entered: () => entered(), release: () => release() };
  responseGates.push(gate); heldResponse = gate; return gate;
}
async function responseBarrier(stage) {
  if (heldResponse?.stage !== stage) return;
  const gate = heldResponse; heldResponse = null; gate.entered(); await gate.wait;
}
const manifest = () => ({ enabled: true, requiresVerifiedPlayers: true, learningExportConfigured: false,
  nativeAgents: { enabled: !disabled, applicationId: 'did:key:zHallowmarchFixture', audience: origin, affordances: origin + '/gaming/native-agents', leaseMs: 10000 } });
function html() {
  return `<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover"><style>${styles}</style></head><body class="touch"><div id="menu"><div class="actions"></div></div><div id="mobile-tray-panel"></div><button id="mobile-menu-toggle">Menu</button><script>
window.__HM_GAMING=${JSON.stringify(manifest())};window.__hm={};window.refs=${JSON.stringify([...refs.values()])};window.legacyCalls=[];
const UI={modal:null},IS_TOUCH=true,$=id=>document.getElementById(id),GAME={started:true,player:{id:'alice'}},SAVE={native:true,readConfirmed:true,backend:'db'};
function closeMenu(){UI.modal=null}function mobileTray(){UI.modal=null}function mobileStopInput(){}
const NETWS={state:'on',acct:{id:'alice',nativeBound:true},host:'game.example',token:'game-fixture-app-token',generation:1,stats:{rtt:42},ws:{readyState:1}};
const entities=[{id:'alice',name:'Alice',kind:'player',ownerPlayerId:'alice',x:0,z:0,hp:100,maxHp:100},{id:'pet-body',name:'Companion',kind:'companion',ownerPlayerId:'alice',x:1,z:0,hp:100,maxHp:100},{id:'guard',kind:'npc',name:'Guardian',x:0,z:5,hp:100,maxHp:100}];
let version=1;function netWsSend(m){if(['grant','revoke'].includes(m.op))window.legacyCalls.push(m);setTimeout(()=>{gamingMsg({t:'gaming',op:'result',requestId:m.requestId,ok:true,result:{roomId:'expedition'}});if(['enter','observe'].includes(m.op))gamingMsg({t:'gaming',op:'snapshot',roomId:'expedition',version:version++,state:{entities,loot:[],grants:[],rewards:{},nativeReferences:window.refs}})},0);return true}
${source}
${identitySource}
const actualNativeRun=gamingNativeRun;gamingNativeRun=run=>{const task=actualNativeRun(run);window.lastNativeTask=task.then(()=>({settled:true}),error=>({settled:true,code:error.code}));return task;};
window.ready=(async()=>{NATIVE_PLAYER.status={enabled:true,verified:true,bound:true,binding:${JSON.stringify(binding)}};await nativePlayerModules();await NATIVE_PLAYER.cache.put({relayUrl:'https://relay.example',ownerDid:${JSON.stringify(binding.subjectDid)},podUrl:${JSON.stringify(binding.podUrl)},credential:${JSON.stringify(f.credential)}});await window.__hm.gaming.enter();gamingToggle(true);document.querySelector('#gaming-grant-form').closest('details').open=true;gamingNativeRender();})();
</script></body></html>`;
}
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    if (url.origin === 'https://relay.example') {
      assert.equal(request.headers().authorization, 'Bearer fixture-owner-bearer');
      const rpc = request.postDataJSON();
      if (rpc.params?.name === 'publish_context') events.push({ type: 'pod-publish', content: rpc.params.arguments.graph_content });
      try { const response = await f.mcpFetch(url.href, { body: request.postData() });
        await responseBarrier(rpc.params?.name === 'get_pod_status' ? 'connect' : rpc.params?.name === 'publish_context' ? 'publish' : 'other');
        await route.fulfill({ status: 200, headers: Object.fromEntries(response.headers), body: await response.text() }); }
      catch { await route.fulfill({ status: 503, body: 'Explicit native fixture unavailable' }); }
      return;
    }
    if (url.origin === 'https://pod.example') {
      assert.equal(request.headers().authorization, undefined);
      const response = await f.anonymousFetch(url.href, { credentials: 'omit' }); await route.fulfill({ status: response.status, body: await response.text() }); return;
    }
    assert.equal(url.origin, origin);
    if (url.pathname === '/') { await route.fulfill({ contentType: 'text/html', body: html() }); return; }
    if (url.pathname.startsWith('/gaming/identity/assets/')) {
      const relative = url.pathname.slice('/gaming/identity/assets/'.length);
      assert(!relative.includes('..'));
      await route.fulfill({ contentType: 'text/javascript', body: await readFile(path.join(root, 'client/native-pod', relative), 'utf8') }); return;
    }
    gameRequests.push({ path: url.pathname, authorization: request.headers().authorization, body: request.postDataJSON() });
    assert.equal(request.headers().authorization, 'Bearer game-fixture-app-token');
    if (url.pathname === '/gaming/identity/status') {
      await route.fulfill({ json: { enabled: true, verified: !denyOwner, bound: true, binding } }); return;
    }
    if (url.pathname === '/gaming/native-agents') {
      await route.fulfill({ json: { '@id': url.href, enabled: !disabled, applicationId: 'did:key:zHallowmarchFixture', audience: origin,
        operations: Object.entries(actions).map(([name, target]) => ({ 'iep:action': { '@id': 'urn:interego:gaming:native-agent:' + name },
          'hydra:method': 'POST', 'hydra:target': poisoned ? 'https://evil.example/steal' : target })) } }); return;
    }
    assert.equal(request.method(), 'POST'); assert.equal(request.headers().origin, origin);
    const body = request.postDataJSON();
    if (url.href === actions.register) {
      assert.deepEqual(Object.keys(body).sort(), ['grantId', 'graphIri']); events.push({ type: 'register' });
      const reference = { ...body, ownerPlayerId: 'alice', ownerDid: binding.subjectDid, registeredAt: Date.now(), revoked: false }; refs.set(body.grantId, reference);
      await responseBarrier('register');
      await route.fulfill({ json: { ok: true, result: { reference, authority: { roomId: 'expedition', version: 1, durable: registerDurable } } } }).catch(() => {}); return;
    }
    if (url.href === actions.revoke) {
      assert.deepEqual(Object.keys(body), ['grantId']); events.push({ type: 'game-stop' }); refs.get(body.grantId).revoked = true;
      await route.fulfill({ json: { ok: true, result: { grantId: body.grantId, revoked: true, authority: { durable: revokeDurable } } } }); return;
    }
    throw Error('Unexpected fixture game request');
  });
  const page = await context.newPage(); page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(origin); await page.evaluate(() => ready);
  await page.locator('#gaming-entity').selectOption('pet-body'); await page.locator('#gaming-agent').fill('did:web:identity.example:agents:chosen-pet'); await page.locator('#gaming-role').selectOption('pet');
  await page.locator('#gaming-grant-form button').click(); await page.waitForFunction(() => document.querySelector('#gaming-status').textContent.includes('Choose to make'));
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  f.setMode('pending'); await page.locator('#gaming-public-choice').check(); await page.locator('#gaming-grant-form button').click();
  await page.waitForFunction(() => document.querySelector('#gaming-native-note').textContent.includes('not confirmed public access'));
  assert.equal(gameRequests.filter(value => value.path === new URL(actions.register).pathname).length, 0); assert.equal(await page.locator('#gaming-grant-form button').isDisabled(), true);
  assert.equal(await page.locator('#gaming-token').inputValue(), '');
  f.release(); await page.getByRole('button', { name: 'Retry pod confirmation', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#gaming-status').textContent.includes('expedition has not confirmed'));
  assert.equal(await page.locator('#gaming-native-handoff').isVisible(), false); assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  registerDurable = true; await page.getByRole('button', { name: 'Retry registration', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#gaming-native-handoff').hidden === false);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  const grantId = await page.locator('#gaming-native-grant-id').inputValue(); assert.match(grantId, /^urn:uuid:/);
  assert.equal(await page.locator('#gaming-native-discovery').getAttribute('href'), origin + '/gaming/native-agents');
  const publication = f.calls.find(call => call.name === 'publish_context').args;
  assert(publication.graph_content.includes('pet-body')); assert(publication.graph_content.includes('chosen-pet')); assert(!f.calls.some(call => call.name === 'register_agent'));
  const value = parseTrig(publication.graph_content).subjects[0].properties.get('http://www.w3.org/1999/02/22-rdf-syntax-ns#value')[0];
  const grant = JSON.parse(value.value); assert.equal(grant.entityId, 'pet-body'); assert.equal(grant.roomId, 'expedition');
  assert.equal(grant.role, 'pet'); assert.equal(grant.maxCommandsPerSecond, 5); assert.equal(Date.parse(grant.expiresAt) - Date.parse(grant.notBefore), 900000);
  assert.deepEqual(grant.actions, ['observe', 'move', 'attack']);
  for (const [width, height] of [[390, 844], [320, 568], [844, 390]]) {
    await page.setViewportSize({ width, height }); await page.locator('#gaming-public-wrap').scrollIntoViewIfNeeded();
    const geometry = await page.evaluate(() => { const sheet = document.querySelector('#gaming-sheet .sheet'), input = document.querySelector('#gaming-agent'), label = document.querySelector('#gaming-public-wrap'), button = document.querySelector('#gaming-native-copy');
      return { overflow: sheet.scrollWidth > sheet.clientWidth + 1 || document.documentElement.scrollWidth > innerWidth + 1, font: parseFloat(getComputedStyle(input).fontSize), label: label.getBoundingClientRect().height, button: button.getBoundingClientRect().height }; });
    assert.equal(geometry.overflow, false); assert(geometry.font >= 16 && geometry.label >= 44 && geometry.button >= 44);
  }
  await page.reload(); await page.evaluate(() => ready); await page.locator('#gaming-native-refresh').click();
  await page.waitForFunction(() => document.querySelector('#gaming-native-note').textContent === 'Companion access checked against your pod.');
  assert.match(await page.locator('#gaming-grants').innerText(), /chosen-pet/); assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  f.setMode('pending'); await page.getByRole('button', { name: 'Revoke access', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#gaming-status').textContent.includes('not confirmed access is stopped'));
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
  revokeDurable = true; await page.getByRole('button', { name: 'Retry stopping access', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#gaming-native-note').textContent.includes('Access is stopped here.'));
  const stop = events.findIndex(event => event.type === 'game-stop'), lastPublish = events.map(event => event.type).lastIndexOf('pod-publish'); assert(stop >= 0 && stop < lastPublish);
  f.release(); await page.getByRole('button', { name: 'Retry pod confirmation', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#gaming-native-note').textContent.includes('stopped here and revoked in your pod'));
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 2);
  assert.equal(await page.evaluate(() => window.legacyCalls.length), 0); assert.equal(await page.locator('#gaming-token').inputValue(), '');
  assert.equal(await page.locator('#gaming-learning').textContent(), 'Learning export is unavailable on this server.');
  poisoned = true; await page.locator('#gaming-native-refresh').click(); await page.waitForFunction(() => document.querySelector('#gaming-status').textContent.includes('unavailable'));
  assert(!gameRequests.some(value => JSON.stringify(value).includes('fixture-owner-bearer')));
  assert(!gameRequests.some(value => value.body && Object.keys(value.body).some(key => !['grantId', 'graphIri'].includes(key))));
  denyOwner = true; poisoned = false; await page.locator('#gaming-native-refresh').click(); await page.waitForFunction(() => document.querySelector('#gaming-status').textContent.includes('Reconnect your identity'));
  disabled = true; await page.reload(); await page.evaluate(() => ready); assert.equal(await page.locator('#gaming-grant-form button').isDisabled(), true);
  assert.equal(await page.locator('#gaming-token-wrap').isVisible(), false); assert.deepEqual(browserErrors, []);
  disabled = false; denyOwner = false; poisoned = false; f.setMode('normal'); registerDurable = true;
  for (const stage of ['connect', 'publish', 'register']) {
    await page.reload(); await page.evaluate(() => ready);
    await page.locator('#gaming-entity').selectOption('pet-body'); await page.locator('#gaming-agent').fill('did:web:identity.example:agents:cancelled-pet');
    await page.locator('#gaming-public-choice').check();
    const registrationsBefore = events.filter(event => event.type === 'register').length;
    const publicationsBefore = f.calls.filter(call => call.name === 'publish_context').length;
    const gate = holdResponse(stage); await page.locator('#gaming-grant-form button').click(); await gate.started;
    const before = await page.evaluate(() => ({ opening: GAMING_NATIVE.opening.size, requests: GAMING_NATIVE.controllers.size, busy: GAMING_NATIVE.busy }));
    if (stage === 'connect') assert.equal(before.opening, 1);
    if (stage === 'register') assert.equal(before.requests, 1);
    assert.equal(before.busy, true);
    const cancelled = await page.evaluate(() => {
      gamingNativeForget(); return { blocked: GAMING_NATIVE.blocked, busy: GAMING_NATIVE.busy, client: GAMING_NATIVE.client,
        opening: GAMING_NATIVE.opening.size, requests: GAMING_NATIVE.controllers.size, pending: GAMING_NATIVE.operations.size,
        records: GAMING_NATIVE.records.size, handoff: GAMING_NATIVE.handoff, checked: document.querySelector('#gaming-public-choice').checked };
    });
    assert.deepEqual(cancelled, { blocked: true, busy: false, client: null, opening: 0, requests: 0, pending: 0, records: 0, handoff: null, checked: false });
    if (stage === 'register') assert.equal((await page.evaluate(() => window.lastNativeTask)).code, 'companion_cancelled', 'The game fetch must abort before its held response is released.');
    gate.release();
    assert.equal((await page.evaluate(() => window.lastNativeTask)).code, 'companion_cancelled');
    const after = await page.evaluate(() => ({ client: GAMING_NATIVE.client, records: GAMING_NATIVE.records.size, pending: GAMING_NATIVE.operations.size,
      handoff: GAMING_NATIVE.handoff, note: GAMING_NATIVE.note, disabled: document.querySelector('#gaming-grant-form button').disabled,
      visible: !document.querySelector('#gaming-native-handoff').hidden, error: GAMING.lastError }));
    assert.deepEqual(after, { client: null, records: 0, pending: 0, handoff: null, note: '', disabled: true, visible: false, error: '' });
    assert.equal(events.filter(event => event.type === 'register').length, registrationsBefore + (stage === 'register' ? 1 : 0));
    assert.equal(f.calls.filter(call => call.name === 'publish_context').length, publicationsBefore + (stage === 'connect' ? 0 : 1));
    assert.equal(await page.locator('#gaming-token').inputValue(), '');
  }
  assert.deepEqual(browserErrors, []);
  console.log('PASS native companion UI: explicit public choice, owner cache, discovered targets, exact private-body-free reference registration, pending confirmation without duplicate writes, reload from native references, local-stop-before-pod revocation, malformed discovery/fresh-owner refusal, unavailable no-legacy fallback, mobile geometry and honest learning availability. Proof/storage/authority are fixtures.');
  console.log('PASS queued logout cancellation: opening native connection, committed-but-unacknowledged public publication, and in-flight game registration cannot revive clients, return handoffs or promote stale receipts after gamingNativeForget; tracked game requests are aborted. Already transmitted native/server writes are not retracted.');
} finally { for (const gate of responseGates) gate.release(); await browser.close(); }
