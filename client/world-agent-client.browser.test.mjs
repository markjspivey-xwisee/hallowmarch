import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicKey, verify } from 'node:crypto';
import { agentCommandMessage, agentSessionPossessionMessage } from '../server/gaming/native-agent-proof.js';
import { mainWorldAgentAffordances } from '../server/gaming/main-world-agents.js';

// No external traffic or production writes. Browser/WebCrypto interoperability
// against explicit discovery/native-admission/owner-page HTTP fixtures.
test('served module executes in Chromium and its real Ed25519 signatures match the server wire contract', async t => {
  assert(process.env.HM_PLAYWRIGHT_MODULE, 'Set HM_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
  const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.HM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HM_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const source = await readFile(new URL('./world-agent-client.mjs', import.meta.url), 'utf8');
  const origin = 'https://game.example', applicationId = 'did:web:identity.example:users:march';
  const agentDid = 'did:web:identity.example:agents:fixture-agent', grantId = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
  const sessionId = 'S'.repeat(43), scope = { roomId: 'march', entityId: 'alice', role: 'teammate', actions: ['observe', 'move'], maxCommandsPerSecond: 10 };
  let payload, key, completed = 0, commands = 0;
  const page = await browser.newPage();
  await page.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, origin, 'offline fixture only');
    assert.equal(request.headers().authorization, undefined);
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline SDK fixture</title>' });
    if (url.pathname === '/world/agent-client.mjs') return route.fulfill({ contentType: 'text/javascript', body: source });
    let value;
    if (url.pathname === '/gaming/manifest') value = { mainWorldAgents: { enabled: true, scope: 'main-world', applicationId, audience: origin, affordances: origin + '/world/native-agents' } };
    else if (url.pathname === '/world/native-agents') value = mainWorldAgentAffordances({ publicOrigin: origin, applicationId, enabled: true });
    else {
      assert.equal(request.method(), 'POST'); const body = request.postDataJSON();
      if (url.pathname.endsWith('/challenge')) {
        key = createPublicKey({ key: body.sessionPublicKeyJwk, format: 'jwk' });
        payload = { purpose: 'urn:interego:gaming:agent-admission:v1', applicationId, audience: origin, challenge: 'C'.repeat(43),
          grantId, grantDigest: 'd'.repeat(64), sessionPublicKeyJwk: body.sessionPublicKeyJwk };
        value = { ok: true, result: { challengeId: payload.challenge, payload, expiresAt: Date.now() + 30000 } };
      } else if (url.pathname.endsWith('/complete')) {
        assert(verify(null, Buffer.from(agentSessionPossessionMessage(payload)), key, Buffer.from(body.sessionSignature, 'base64url')));
        completed++;
        value = { ok: true, result: { sessionId, expiresAt: Date.now() + 10000,
          receipt: { applicationId, audience: origin, grantId, agentDid, scope }, authority: { scope: 'main-world', durable: true } } };
      } else if (url.pathname.endsWith('/command')) {
        assert.equal(body.sequence, 1); const command = body.command;
        assert(verify(null, Buffer.from(agentCommandMessage(sessionId, { sequence: body.sequence, at: body.at, method: 'POST', path: url.pathname,
          action: command.type, roomId: command.roomId, entityId: command.entityId, body: { command } })), key, Buffer.from(body.signature, 'base64url')));
        commands++; value = { ok: true, result: { accepted: true, execution: 'owner-page-input-applied', requestId: 'fixture-ack' } };
      } else assert.fail('Unexpected fixture operation: ' + url.pathname);
    }
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify(value) });
  });
  await page.goto(origin);
  const result = await page.evaluate(async ({ origin, applicationId, agentDid, grantId }) => {
    const { createWorldAgentClient } = await import('/world/agent-client.mjs');
    const client = createWorldAgentClient({ origin, applicationId, agentDid, sign_request: async ({ payload }) => ({
      _signature: '0x' + 'b'.repeat(130), _signed_payload: JSON.stringify({ ...payload, agent_id: agentDid,
        subject_pod_url: 'https://pod.example/agent/', timestamp: new Date().toISOString() }),
    }) });
    const connected = await client.connect({ grantId, roomId: 'march', entityId: 'alice' });
    const ack = await client.move({ dx: 1, dz: 0, durationMs: 100 }); client.close();
    return { connected: connected.connected, ack, closed: client.status().closed };
  }, { origin, applicationId, agentDid, grantId });
  assert.equal(result.connected, true); assert.equal(result.closed, true); assert.equal(result.ack.execution, 'owner-page-input-applied');
  assert.equal(completed, 1); assert.equal(commands, 1);
});

test('actual Agent access UI exposes only confirmed public connection fields and preserves button focus', async t => {
  assert(process.env.HM_PLAYWRIGHT_MODULE, 'Set HM_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
  const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.HM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HM_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const source = await readFile(new URL('../src/14w_worldagents.js', import.meta.url), 'utf8');
  const origin = 'https://game.example', applicationId = 'did:web:identity.example:users:march';
  const actor = 'did:web:identity.example:agents:fixture-agent', grantId = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
  const entityId = 'alice:companion:1647775c-22c7-4a79-8a45-d55cfe101b42';
  const record = { registered: true, reference: { grantId }, grant: { actor, applicationId, audience: origin, roomId: 'march', entityId,
    role: 'teammate', actions: ['observe', 'move', 'attack'], revoked: false, expiresAt: new Date(Date.now() + 600000).toISOString() } };
  const styles = (await readFile(new URL('../src/page.html', import.meta.url), 'utf8')).match(/<style>([\s\S]*?)<\/style>/)[1];
  const html = `<!doctype html><meta name="viewport" content="width=device-width, initial-scale=1"><style>${styles}</style><div id="menu" class="overlay"><div class="sheet"><div id="menu-body"><div id="world-agent-mount"></div></div></div></div><script>
    window.__HM_GAMING=${JSON.stringify({ mainWorldAgents: { enabled: true, applicationId, audience: origin, affordances: origin + '/world/native-agents' } })};
    window.__hm={};const GAME={started:true,player:{alive:true}},NETWS={acct:{id:'alice'},state:'on',worldRoom:'march',generation:1},UI={modal:'menu',menuTab:'companion'};
    const NATIVE_PLAYER={status:{bound:true,verified:true}},SAVE={native:true,readConfirmed:true},$=id=>document.getElementById(id),anCompanions=()=>[];
    const openPlayerIdentity=()=>{throw Error('No identity setup is allowed in this fixture')};
    const CLASSES={warrior:{name:'Warrior'}},PARTY_COMPANION={record:{role:'follow'}};
    let party={id:${JSON.stringify(entityId)},name:'Rowan',entity:{alive:true,cls:'warrior',removed:false}};
    const partyCompanionMember=()=>party,partyCompanionBodies=()=>party&&!party.entity.removed?[party]:[],partyCompanionStop=()=>{};
    const ENT=[],netWsSend=()=>true;
    Object.defineProperty(navigator,'clipboard',{value:{async writeText(value){window.copied=value}}});
    ${source}
    MAIN_WORLD_AGENTS.records.set(${JSON.stringify(grantId)},${JSON.stringify(record)});mainWorldAgentRender();
    window.fixture={render:mainWorldAgentRender,state:MAIN_WORLD_AGENTS,party,net:NETWS,game:GAME,
      noParty(){party=null;this.render()}};
  </script>`;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    assert.equal(route.request().url(), origin + '/', 'no native/game network writes');
    await route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto(origin);
  const details = page.locator('#world-agent-records details'); assert.equal(await details.count(), 1);
  assert.equal(await details.getAttribute('open'), null);
  await details.locator('summary').click();
  assert.equal(await page.getByRole('link', { name: 'Agent discovery', exact: true }).getAttribute('target'), '_blank');
  const value = JSON.parse(await details.locator('textarea').inputValue());
  assert.deepEqual(value, { origin, applicationId, agentDid: actor, grantId, roomId: 'march', entityId, module: origin + '/world/agent-client.mjs' });
  await details.getByRole('button', { name: 'Copy raw connection details', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.copied)), value);
  const focused = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#world-agent-records button')].find(b => b.textContent === 'Revoke access');
    button.focus(); fixture.render(); fixture.render();
    return document.activeElement === button && button.isConnected;
  });
  assert.equal(focused, true);
  assert.equal(await page.locator('#world-agent-advanced').getAttribute('open'), null);
  assert.match(await page.locator('#world-agent-controls').innerText(), /These built-in behaviors work without an LLM/);
  assert.match(await page.locator('#world-agent-advanced').textContent(), /Granting access does not connect a subscription or start an agent/);
  assert.match(await page.locator('#world-agent-connection').innerText(), /Access ready.*control paused/);
  for (const width of [320, 390, 844]) {
    await page.setViewportSize({ width, height: 844 });
    const geometry = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth > innerWidth + 1,
      font: parseFloat(getComputedStyle(document.querySelector('#world-agent-companion-name')).fontSize),
      targets: [...document.querySelectorAll('#world-agent-controls button,#world-agent-controls summary')].filter(el=>el.getClientRects().length).every(el=>el.getBoundingClientRect().height>=44) }));
    assert.equal(geometry.overflow, false); assert.equal(geometry.font, 16); assert.equal(geometry.targets, true);
  }
  await page.evaluate(() => { fixture.party.name='Ash'; fixture.render(); });
  assert.match(await page.locator('#world-agent-records').innerText(), /Ash/);
  await page.evaluate(({ grantId }) => { fixture.state.paused=false;fixture.state.allowed.add(fixture.party.id);fixture.state.records.get(grantId).lastCommandAt=Date.now();fixture.render(); }, { grantId });
  assert.match(await page.locator('#world-agent-records').innerText(), /Agent input received.*close this panel/);
  assert.doesNotMatch(await page.locator('#world-agent-records').innerText(), /connected|succeeded|completed/i);
  for (const [key,value,label] of [['worldPauseReason','Recovery pending','World recovery'],['reload',true,'Account reconnecting']]) {
    await page.evaluate(({key,value})=>{fixture.net[key]=value;fixture.render()}, {key,value});
    assert.match(await page.locator('#world-agent-records').innerText(), new RegExp(label));
    await page.evaluate(key=>{fixture.net[key]=false;fixture.render()},key);
  }
  await page.evaluate(() => { fixture.game.player.alive=false; fixture.render(); });
  assert.match(await page.locator('#world-agent-records').innerText(), /Your character has fallen.*paused/);
  await page.evaluate(() => { fixture.game.player.alive=true; fixture.render(); });
  await page.evaluate(() => { fixture.party.entity.alive=false; fixture.render(); });
  assert.equal(await details.count(), 0);
  assert.match(await page.locator('#world-agent-party').innerText(), /has fallen.*Revival is not available.*Dismiss/);
  assert.match(await page.locator('#world-agent-records').innerText(), /Companion fallen.*access unavailable/);
  assert.equal(await page.locator('#world-agent-resume').isDisabled(), true);
  await page.evaluate(() => { fixture.party.entity.alive=true;fixture.party.entity.removed=true;fixture.render(); });
  assert.equal(await details.count(), 0); assert.match(await page.locator('#world-agent-records').innerText(), /Companion unavailable/);
  await page.evaluate(({ grantId }) => { fixture.party.entity.removed=false;fixture.state.records.get(grantId).grant.roomId='old-room';fixture.render(); }, { grantId });
  assert.equal(await details.count(), 0); assert.match(await page.locator('#world-agent-records').innerText(), /Access unavailable in this March/);
  await page.evaluate(({ grantId }) => { fixture.state.records.get(grantId).grant.roomId='march';fixture.render(); }, { grantId });
  await page.evaluate(() => { fixture.party.entity.alive=true; fixture.net.state='off'; fixture.render(); });
  assert.match(await page.locator('#world-agent-records').innerText(), /Connection interrupted.*paused/);
  await page.evaluate(({ grantId }) => { fixture.net.state='on'; fixture.state.records.get(grantId).grant.expiresAt=new Date(0).toISOString(); fixture.render(); }, { grantId });
  assert.equal(await details.count(), 0); assert.match(await page.locator('#world-agent-records').innerText(), /Access expired/);
  for (const [phase,label] of [['publish','Waiting for pod confirmation'],['register','Waiting for game confirmation'],['stop','Stopping access'],['pod-revoke-pending','confirm pod revocation']]) {
    await page.evaluate(({ grantId,phase }) => { fixture.state.records.get(grantId).phase=phase; fixture.render(); }, { grantId,phase });
    assert.match(await page.locator('#world-agent-records').innerText(), new RegExp(label));
    assert.equal(await details.count(), 0);
  }
  await page.evaluate(({ grantId }) => { const r=fixture.state.records.get(grantId);r.phase='';r.grant.expiresAt=new Date(Date.now()+600000).toISOString(); fixture.party.id='alice:animal:7';fixture.render(); }, { grantId });
  assert.equal(await details.count(), 0); assert.match(await page.locator('#world-agent-records').innerText(), /Previous companion.*access unavailable/);
  await page.evaluate(({ grantId }) => { fixture.state.records.get(grantId).grant.entityId = 'alice:animal:7'; fixture.render(); }, { grantId });
  assert.equal(JSON.parse(await details.locator('textarea').inputValue()).entityId, 'alice:animal:7');
  await page.evaluate(({ grantId }) => { fixture.state.records.get(grantId).localRevoked = true; fixture.render(); }, { grantId });
  assert.equal(await details.count(), 0);
  await page.evaluate(() => fixture.noParty());
  assert.equal(await page.locator('#world-agent-party').innerText(), 'No companion yet. Add one to get started.');
  assert.equal(await page.locator('#world-agent-resume').isDisabled(), true);
  assert.deepEqual(errors, []);
});

test('actual death UI closes the active Players and chat surfaces and makes recovery keyboard reachable', async t => {
  assert(process.env.HM_PLAYWRIGHT_MODULE, 'Set HM_PLAYWRIGHT_MODULE to the installed Playwright index.mjs');
  const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.HM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HM_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const source = await readFile(new URL('../src/10_ui.js', import.meta.url), 'utf8');
  const net = await readFile(new URL('../src/14o_netui.js', import.meta.url), 'utf8');
  const pageSource = await readFile(new URL('../src/page.html', import.meta.url), 'utf8');
  const styles = pageSource.match(/<style>([\s\S]*?)<\/style>/)[1];
  const death = source.slice(source.indexOf('function uiDeath('), source.indexOf('/* herald */'));
  const sheetToggle = net.slice(net.indexOf('function netSheetToggle('), net.indexOf('// your account on the March'));
  const chatClose = net.slice(net.indexOf('function netChatClose('), net.indexOf('function netChatGo('));
  const deathMarkup = pageSource.slice(pageSource.indexOf('<div class="overlay" id="death"'), pageSource.indexOf('<div class="overlay" id="dialog"'));
  const html = `<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><style>${styles}</style>${deathMarkup}
    <div id="netchat"><input id="netchat-in" aria-label="Chat"></div>
    <div id="netsheet" class="overlay"><div class="sheet"><button id="background-action">Player action</button></div></div><script>
    const $=id=>document.getElementById(id),UI={modal:'net'},NETUI={open:true,chatOpen:true};
    const GAME={player:{x:0,z:0,faction:0}},R_RING=190,REALMS=[{name:'Logres',townName:'Home'}];
    const inDungeon=()=>false,buildBedSpot=()=>null;
    let released=0;function releasePlayer(){released++}
    ${sheetToggle}\n${chatClose}\n${death}
    window.fixture={die:uiDeath,state:()=>({modal:UI.modal,players:NETUI.open,chat:NETUI.chatOpen,released})};
    document.querySelector('#background-action').focus();
    </script>`;
  const page = await browser.newPage({ viewport: { width: 320, height: 568 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    assert.equal(route.request().url(), 'https://game.example/', 'offline UI fixture only');
    await route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto('https://game.example/');
  await page.evaluate(() => fixture.die('a foe'));
  assert.equal(await page.locator('#netsheet').isVisible(), false); assert.equal(await page.locator('#netchat').isVisible(), false);
  assert.equal(await page.locator('#death').isVisible(), true);
  assert.equal(await page.locator('#btn-release').evaluate(el => el === document.activeElement), true);
  assert.equal(await page.locator('#btn-release').textContent(), 'Release to Logres Muster');
  assert.deepEqual(await page.evaluate(() => fixture.state()), { modal: 'death', players: false, chat: false, released: 0 });
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('#death').isVisible(), false);
  assert.deepEqual(await page.evaluate(() => fixture.state()), { modal: null, players: false, chat: false, released: 1 });
  assert.deepEqual(errors, []);
});
