/** Real popup/cache/mobile DOM flow. Identity claim responses are explicit fixtures. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';
import { createPlayerIdentityBridge } from '../../server/gaming/player-identity.js';
import { retryNativeStartup } from '../../tools/manual/native-player-orchestration.mjs';
if (!process.env.HM_PLAYWRIGHT_MODULE) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_TOKEN = 'fixture-initiating-game-account-token';
const GUEST_TOKEN = 'fixture-explicit-fresh-transport-token';
const INVALID_TOKEN = 'fixture-invalid-old-game-proof';
const APP_TOKEN = 'fixture-native-game-app-session-token';
const NATIVE_TOKEN = 'fixture-native-relay-access-token-kept-only-in-browser-987654321';
const BROWSER_CEREMONY = 'browser-ceremony-fixture'.padEnd(43, 'x');
const CALLBACK_ORIGIN = 'https://identity-ui.test';
const owner = { userId: 'u-pk-fixture001', subjectDid: 'did:web:identity.example:users:u-pk-fixture001', podUrl: 'https://pod.example/u-pk-fixture001/' };
const calls = [], urls = [], consoleMessages = [], broadcastMessages = [];
let claimMode = 'success', startHold = null;
function gate() { let enter, release; return { entered: new Promise(resolve => { enter = resolve; }),
  wait: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() }; }
const assets = createPlayerBrowserAssets();
const callbackBridge = createPlayerIdentityBridge({
  publicOrigin: CALLBACK_ORIGIN, identityOrigin: 'https://identity.example',
  metadataUrl: 'https://relay.example/.well-known/oauth-authorization-server',
  storeBases: ['https://pod.example/'], allowOwnerBrowserHandoff: true,
  successPath: '/gaming/identity/finish',
  authorizeGameAccount: async req => {
    const fresh = req.headers.authorization === 'Bearer ' + GUEST_TOKEN;
    assert(fresh || req.headers.authorization === 'Bearer ' + GAME_TOKEN);
    return { accountId: fresh ? 'fixture-fresh-guest' : 'fixture-account', sessionId: fresh ? GUEST_TOKEN : GAME_TOKEN,
      ownerPodWriteAccess: true, ...(!fresh ? { expectedSubjectDid: owner.subjectDid + '-previous' } : {}) };
  },
  onVerified: async () => ({ appSession: { token: APP_TOKEN, acct: { id: 'fixture-native-account' } } }),
  fetch: async (input, init) => {
    const url = String(input);
    if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({
      issuer: 'https://relay.example/', authorization_endpoint: 'https://relay.example/authorize', token_endpoint: 'https://relay.example/token',
      response_types_supported: ['code'], code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'],
      client_id_metadata_document_supported: true, scopes_supported: ['mcp:read', 'mcp:write'],
    });
    if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({
      authorization_servers: ['https://relay.example/'], affordances: [{ action: 'urn:iep:action:mcp:invoke', target: 'https://relay.example/mcp', method: 'POST' }],
    });
    if (url.endsWith('/token')) return Response.json({ token_type: 'Bearer', access_token: NATIVE_TOKEN, scope: 'mcp:write', expires_in: 600 });
    assert.equal(url, 'https://relay.example/mcp'); assert.equal(new Headers(init.headers).get('authorization'), 'Bearer ' + NATIVE_TOKEN);
    return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {
      identity: { userId: owner.userId, did: owner.subjectDid, webId: 'https://identity.example/users/' + owner.userId + '/profile#me' },
      pod: owner.podUrl, registry: { owner: 'https://identity.example/users/' + owner.userId + '/profile#me' },
      sessionAgent: { id: 'hallowmarch-' + owner.userId, did: 'did:web:identity.example:agents:hallowmarch-' + owner.userId, scope: 'ReadWrite' },
    } } });
  },
});
async function fixturePage(view) {
  // Use actual game CSS, title markup, Players account renderer and native UI.
  const page = await fs.readFile(path.join(root, 'src/page.html'), 'utf8');
  const styles = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const title = page.slice(page.indexOf('<div id="title" hidden>'), page.indexOf('<div id="hud" hidden>'))
    .replace('<div id="title" hidden>', '<div id="title">');
  const native = await fs.readFile(path.join(root, 'src/14v_nativeidentity.js'), 'utf8');
  const titleSource = await fs.readFile(path.join(root, 'src/10_ui.js'), 'utf8');
  const titleDraftState = titleSource.match(/^let TITLE_DRAFT = null;[^\n]*$/m)?.[0];
  assert(titleDraftState, 'The identity fixture must retain the real private title-draft state.');
  const titleFlow = titleDraftState + '\n' + titleSource.slice(titleSource.indexOf('function titleEntryBlocked()'), titleSource.indexOf('function bindHUD()'));
  const titleRadioFlow = titleSource.slice(titleSource.indexOf('function menuRadioKey('), titleSource.indexOf('function menuReplacementBlocked('));
  const saves = await fs.readFile(path.join(root, 'src/12_save.js'), 'utf8');
  const nativeSaveStart = saves.indexOf('function nativeSavePending(');
  const nativeSaveEnd = saves.indexOf('// a slow heartbeat:', nativeSaveStart);
  assert(nativeSaveStart >= 0 && nativeSaveEnd > nativeSaveStart, 'The UI fixture must include the real native save functions.');
  const nativeSaves = saves.slice(nativeSaveStart, nativeSaveEnd);
  assert.match(nativeSaves, /function saveNow\(/, 'Live UI progress must exercise the real saveNow implementation.');
  const websocket = await fs.readFile(path.join(root, 'src/14p_netws.js'), 'utf8');
  const logout = websocket.slice(websocket.indexOf('async function netAcctOut()'), websocket.indexOf('// A remote reference'));
  // The footer registers world lore/debug globals outside this isolated UI host.
  // Keep the real UI functions; omit that unrelated module initialization only.
  const players = (await fs.readFile(path.join(root, 'src/14o_netui.js'), 'utf8')).split('Object.assign(FIELD_NOTES,')[0];
  const cold = view === 'connect-expired';
  const bound = view !== 'connect' && !cold;
  const live = view === 'players-reauth';
  const coldTransport = cold ? websocket.slice(0, websocket.indexOf('// Login keeps')) : '';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Native identity UI verification</title><style>${styles}</style><body class="touch">${title}<div id="hud" hidden></div><script>
const $=id=>document.getElementById(id),IS_TOUCH=true;
${coldTransport || `const NETWS={token:${JSON.stringify(GAME_TOKEN)},host:location.host,acct:{id:${JSON.stringify(live ? 'fixture-native-account' : 'fixture-account')},guest:false,name:'Fixture player',nativeBound:${bound}}};`}
const fixtureMemory={v:1,char:{name:'Kept in-memory character',n:9,inventory:['unsaved item']}};
const SAVE={native:${bound || cold},backend:'local',loaded:null,pending:${live} ? structuredClone(fixtureMemory):null,readConfirmed:${bound},chain:Promise.resolve(),nativeFlight:null,nativePaused:false,lastBody:'',lastCore:'',ref:null};
const GAME={started:${live},ready:true,player:${live}?{name:fixtureMemory.char.name}:null};
const NET={link:{kind:'ws'},peers:new Map(),party:null};const UI={modal:null,realm:0,cls:'warrior'};const BUILD={mode:false};
const REALMS=[{id:0,name:'Logres',color:'#c00'},{id:1,name:'Ériu',color:'#0c0'},{id:2,name:'Thule',color:'#00c'}];
const REALM_BLURB=['Fixture realm one','Fixture realm two','Fixture realm three'];
const CLASSES={warrior:{name:'Warrior',role:'Fighter',blurb:'Fixture calling',icon:'sword'},mage:{name:'Mage',role:'Caster',blurb:'Second fixture calling',icon:'staff'}};
const randomName=()=> 'New fixture recruit',emblemSvg=()=>'',iconSvg=()=>'',audioUnlock=()=>{},sfx=()=>{},realmRank=()=>3,seasonTitleText=()=>'';
const identityCalls={retry:0,save:0,load:0,reauthenticate:0,saved:[],entries:[],links:[],hellos:[],reloadMarker:crypto.randomUUID()};
const startGame=async(value,allowed)=>{if(allowed())identityCalls.entries.push(structuredClone(value))};
let resumeRelease=null,resumeGate=null,writeRelease=null,writeGate=null,reauthConflict=false;
let coldHelloHold=false;const coldHelloReplies=[];
const typing=()=>true,validSave=value=>value,loadSave=async()=>{identityCalls.load++;SAVE.readConfirmed=true};
${cold ? `window.__HM_NET_SERVER='ws://'+location.host+'/ws';
const netNote=()=>{},netStr=(value,n)=>String(value).slice(0,n);
window.WebSocket=class {constructor(){this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen?.({})})}
send(raw){const message=JSON.parse(raw);if(message.t!=='hello')return;identityCalls.hellos.push(message);const reply=()=>this.onmessage?.({data:JSON.stringify(message.token?{t:'denied',why:'native_signin_required'}:{t:'welcome',v:1,peer:'fixture-fresh-peer',token:${JSON.stringify(GUEST_TOKEN)},acct:{id:'fixture-fresh-guest',guest:true},world:{k:[]}})});if(message.token&&coldHelloHold)coldHelloReplies.push(reply);else queueMicrotask(reply)}
close(){this.readyState=3;this.onclose?.({code:1008,reason:'native_signin_required'})}};` : `const netServerUrl=()=>location.origin,netLinkWS=async()=>{identityCalls.links.push(NETWS.token);return true};`}
const CAPTURE={on:false},buildSave=()=>structuredClone(fixtureMemory),coreKey=value=>JSON.stringify(value),withTimeout=(promise,ms)=>Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(null),ms))]);
${nativeSaves}
if(!${live})saveNow=async()=>{identityCalls.save++};
${players}
${native}
${titleRadioFlow}
${titleFlow}
${logout}
NATIVE_PLAYER.status={enabled:true,bound:${bound},verified:${bound},recordLinks:{},binding:${JSON.stringify(owner)}};
if(${bound}&&${JSON.stringify(view)}!=='players-uninitialized')NATIVE_PLAYER.profile={status:()=>({hasRecord:${live},keyPresent:true,pending:false,linked:false}),retry:async()=>{identityCalls.retry++},exportRecovery:async()=>({}),close:()=>{},
reauthenticate:async()=>{identityCalls.reauthenticate++;if(resumeGate)await resumeGate;if(reauthConflict)throw Object.assign(Error('The original native head changed.'),{code:'conflict'});return{readConfirmed:true,keyPresent:true}},
set:async value=>{identityCalls.save++;identityCalls.saved.push(structuredClone(value));if(writeGate)await writeGate}};
SAVE.ref={set:value=>NATIVE_PLAYER.profile.set(value)};
netUiOn();netAcctRender();nativePlayerRender();
if(${JSON.stringify(view)}.startsWith('players')){$('title').hidden=true;$('netsheet').hidden=false;NETUI.open=true;UI.modal='net'}
window.identityTest={ready:true,render(){nativePlayerRender()},showTitle(save){setupTitle(save)},changed(){NATIVE_PLAYER.state='saving';NATIVE_PLAYER.message='Native save status updated';nativePlayerRender()},
async coldBoot(token=${JSON.stringify(GAME_TOKEN)}){localStorage.setItem('hallowmarch.token.'+location.host,token);return netLinkWS()},
holdColdHello(){coldHelloHold=true},releaseColdHellos(){coldHelloHold=false;for(const reply of coldHelloReplies.splice(0))reply()},
status:()=>(${live}?{cacheInitialized:!!NATIVE_PLAYER.cache,profileInitialized:!!NATIVE_PLAYER.profile,calls:identityCalls,memory:fixtureMemory,pending:SAVE.pending,paused:SAVE.nativePaused,token:NETWS.token,reload:NETWS.reload||false,message:NATIVE_PLAYER.message}:{cacheInitialized:!!NATIVE_PLAYER.cache,profileInitialized:!!NATIVE_PLAYER.profile}),
holdResume(){resumeGate=new Promise(resolve=>{resumeRelease=resolve})},releaseResume(){resumeRelease?.();resumeGate=null},conflict(){reauthConflict=true},
holdWrite(){writeGate=new Promise(resolve=>{writeRelease=resolve})},releaseWrite(){writeRelease?.();writeGate=null},progress(n){fixtureMemory.char.n=n;return saveNow()}};
</script></body>`;
}
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://fixture'); urls.push(req.url);
  try {
    if (assets(req, res, url.pathname)) return;
    if (url.pathname === '/' || url.pathname === '/fixture-ui') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(await fixturePage(url.searchParams.get('view') || 'connect')); return;
    }
    if (url.pathname === '/fixture-claim-authorize') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end('<!doctype html><title>Inert character-claim authorization fixture</title><p>Awaiting explicit owner authorization.</p>'); return;
    }
    if (claimMode.startsWith('callback-') && url.pathname === '/gaming/identity/callback') {
      await callbackBridge.handle(req, res); return;
    }
    if (['/gaming/identity/start', '/gaming/identity/claim'].includes(url.pathname)) {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ pathname: url.pathname, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) });
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body), { ownerPodWriteAccess: true });
      if (claimMode.startsWith('callback-')) {
        if (url.pathname.endsWith('/start') && startHold) { startHold.enter(); await startHold.wait; }
        await callbackBridge.handle(req, res, JSON.parse(body)); return;
      }
      if (claimMode.startsWith('fresh-') && req.headers.authorization !== 'Bearer ' + GUEST_TOKEN) {
        assert.equal(url.pathname,'/gaming/identity/start');
        assert.equal(req.headers.authorization,'Bearer '+(claimMode==='fresh-invalid'?INVALID_TOKEN:GAME_TOKEN));
        res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'game_account_required'}));return;
      }
      assert.equal(req.headers.authorization, 'Bearer ' + (claimMode.startsWith('fresh-')?GUEST_TOKEN:GAME_TOKEN));
      if (url.pathname.endsWith('/start')) {
        if (startHold) { startHold.enter(); await startHold.wait; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authorizationUrl: 'http://127.0.0.1:' + server.address().port + '/gaming/identity/finish', browserCeremony: BROWSER_CEREMONY })); return;
      }
      if (claimMode === 'denied') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture_claim_denied' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ binding: claimMode === 'foreign-owner' ? {...owner,subjectDid:owner.subjectDid+'-foreign'} : owner,
        appSession: { token: APP_TOKEN, acct: claimMode === 'missing-account' ? undefined : { id: claimMode === 'foreign-account' ? 'another-account' : 'fixture-native-account' } }, nativeSession: {
        mcpUrl: claimMode.startsWith('mcp-') ? ({'mcp-path':'https://relay.example/nested/mcp','mcp-query':'https://relay.example/mcp?private=1','mcp-fragment':'https://relay.example/mcp#private','mcp-userinfo':'https://alice:secret@relay.example/mcp','mcp-http':'http://relay.example/mcp'})[claimMode] : 'https://relay.example/mcp',
        accessToken: claimMode === 'incomplete' ? undefined : NATIVE_TOKEN,
        expiresAt: new Date(Date.now() + (claimMode === 'expired' ? -1000 : 600000)).toISOString(),
      } })); return;
    }
    if (url.pathname === '/gaming/identity/status') {
      assert.equal(req.headers.authorization,'Bearer '+APP_TOKEN);
      res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({enabled:true,bound:true,verified:true,account:{id:'fixture-native-account'},binding:owner,recordLinks:{}}));return;
    }
    res.writeHead(404); res.end();
  } catch { res.writeHead(500); res.end('Identity UI contract fixture refused request.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = 'http://127.0.0.1:' + server.address().port;
// A different real loopback port is a different origin. The old identity
// window deliberately retains its legacy target name after navigation.
const foreignRequests = [];
const foreignServer = http.createServer((req, res) => {
  foreignRequests.push(req.url);
  res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
  res.end('<!doctype html><title>Retained foreign identity fixture</title><script>window.name="hallowmarch-identity";window.retainedIdentityFixture=true;sessionStorage.setItem("foreign.fixture.marker","untouched")</script>');
});
await new Promise(resolve => foreignServer.listen(0, '127.0.0.1', resolve));
const foreignBase = 'http://127.0.0.1:' + foreignServer.address().port;
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
const failures = [];
async function check(name, run) { try { await run(); console.log('PASS ' + name); } catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  finally { if(startHold){startHold.release();startHold=null;} } }
async function contextForMobile(width = 390) {
  const context = await browser.newContext({ viewport: { width, height: 844 }, hasTouch: true, isMobile: true });
  await context.exposeFunction('__identityObservedBroadcast', data => broadcastMessages.push(data));
  await context.addInitScript(() => {
    const Native = window.BroadcastChannel;
    window.BroadcastChannel = class extends Native {
      constructor(name) { super(name); this.addEventListener('message', event => window.__identityObservedBroadcast({ channel: name, direction: 'received', data: event.data })); }
      postMessage(data) { window.__identityObservedBroadcast({ channel: this.name, direction: 'sent', data }); super.postMessage(data); }
    };
  });
  context.on('page', page => {
    page.on('console', message => consoleMessages.push(message.text()));
    page.on('pageerror', error => { consoleMessages.push(error.message); console.error('Fixture page error:',error.message); });
    page.on('request', request => urls.push(request.url()));
  });
  return context;
}
async function openFixture(context, view) {
  const page = await context.newPage(); await page.goto(base + '/fixture-ui?view=' + view);
  await page.waitForFunction(() => window.identityTest?.ready,undefined,{timeout:5000}); return page;
}
async function callbackFixture(view) {
  const context = await contextForMobile();
  context.setDefaultTimeout(10000);
  await context.route(CALLBACK_ORIGIN + '/**', async route => {
    const request = route.request(), url = new URL(request.url());
    const response = await route.fetch({ url: base + url.pathname + url.search, maxRedirects: 0,
      headers: { ...request.headers(), host: new URL(CALLBACK_ORIGIN).host } });
    if (response.status() === 303) {
      // A routed fixture uses a new navigation instead of letting Chromium
      // follow a fulfilled redirect outside the local HTTPS route.
      const headers = { ...response.headers(), 'content-type': 'text/html' }; delete headers['content-length'];
      await route.fulfill({ status: 200, headers, body: '<script>location.replace(' + JSON.stringify(new URL(headers.location, request.url()).href) + ')</script>' }); return;
    }
    await route.fulfill({ response });
  });
  await context.route('https://relay.example/authorize**', async route => {
    const state = new URL(route.request().url()).searchParams.get('state');
    await route.fulfill({ status: 200, contentType: 'text/html', body: '<script>location.replace(' + JSON.stringify(CALLBACK_ORIGIN + '/gaming/identity/callback?state=' + state + '&code=fixture-selected-existing-owner') + ')</script>' });
  });
  const page = await context.newPage(); await page.goto(CALLBACK_ORIGIN + '/fixture-ui?view=' + view);
  await page.waitForFunction(() => window.identityTest?.ready); return { context, page };
}
async function cached(page) {
  return page.evaluate(async owner => {
    const {createBrowserAccessCache}=await import('/gaming/identity/assets/access-cache.mjs');const cache=createBrowserAccessCache();
    const result=await cache.get({relayUrl:'https://relay.example',ownerDid:owner.subjectDid,podUrl:owner.podUrl});
    const entries=await cache.list();await cache.close();return {entries,result};
  }, owner);
}
async function prepareLive(page) {
  await page.evaluate(async({owner,token})=>{
    const {createBrowserAccessCache}=await import('/gaming/identity/assets/access-cache.mjs');
    NATIVE_PLAYER.cache=createBrowserAccessCache();NATIVE_PLAYER.module=Promise.resolve({});
    await NATIVE_PLAYER.cache.put({relayUrl:'https://relay.example',ownerDid:owner.subjectDid,podUrl:owner.podUrl,
      credential:{kind:'relay-oauth-bearer',method:'webauthn',accessToken:'previous-browser-only-access',expiresAt:Date.now()+600000,refreshToken:null}});
    localStorage.setItem('hallowmarch.token.'+location.host,token);window.originalProfile=NATIVE_PLAYER.profile;
  },{owner,token:GAME_TOKEN});
}
async function reconnectPopup(page) {
  const popup=page.waitForEvent('popup');
  await page.locator('#netsheet .native-player button').filter({hasText:'Reconnect identity'}).click();return popup;
}
async function retainedForeignPopup(page) {
  const opening = page.waitForEvent('popup', { timeout: 5000 });
  await page.evaluate(url => { window.retainedForeignIdentity = window.open(url, 'hallowmarch-identity', 'popup,width=520,height=760'); }, foreignBase + '/retained-identity');
  const popup = await opening;
  await popup.waitForFunction(() => window.retainedIdentityFixture === true);
  assert.equal(await popup.evaluate(() => window.name), 'hallowmarch-identity');
  return popup;
}
try {
  for (const width of [320, 390, 1280]) await check(width + 'px first-player title has one entry action and optional sign-in', async () => {
    const context = await contextForMobile(width), page = await openFixture(context, 'connect');
    const before = calls.length;
    await page.evaluate(() => {
      SAVE.native = true; SAVE.readConfirmed = false;
      NATIVE_PLAYER.status = { enabled: true, bound: false, provisionalPlay: { enabled: true } };
      identityTest.showTitle(null);
    });
    assert(await page.locator('#btn-begin').isEnabled());
    assert.equal(await page.locator('#btn-begin').innerText(), 'Play now');
    assert(await page.locator('#btn-continue').isHidden());
    assert(await page.locator('#character-create-fields').isVisible());
    assert.equal(await page.locator('#title button.primary:visible').count(), 1);
    assert(await page.locator('#title .native-player').getByRole('button', { name: 'I already have an identity', exact: true }).isVisible());
    await page.locator('#realm-pick [data-realm="0"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#realm-pick [data-realm="1"]').getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Home'); assert.equal(await page.locator('#realm-pick [data-realm="0"]').getAttribute('aria-checked'), 'true');
    await page.locator('#class-pick [data-cls="warrior"]').focus(); await page.keyboard.press('ArrowRight');
    assert.equal(await page.locator('#class-pick [data-cls="mage"]').getAttribute('aria-checked'), 'true');
    await page.keyboard.press('Home'); assert.equal(await page.locator('#class-pick [data-cls="warrior"]').getAttribute('aria-checked'), 'true');
    assert.equal(calls.length, before, 'rendering must never start sign-in, create a character or write a save');
    assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, entries: identityCalls.entries.length, loads: identityCalls.load })), { saves: 0, entries: 0, loads: 0 });
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await context.close();
  });
  for (const width of [320, 390, 1280]) await check(width + 'px verified returning title has one exact saved-character entry and keyboard-accessible optional controls', async () => {
    const context = await contextForMobile(width), page = await openFixture(context, 'title');
    const saved = { v: 1, char: { name: 'Kept fixture hero', realm: 1, cls: 'warrior', level: 15, xp: 7913, rp: 132, inventory: ['earned fixture item'] } };
    await page.evaluate(save => {
      SAVE.loaded = save; NATIVE_PLAYER.state = 'ready';
      NATIVE_PLAYER.profile.status = () => ({ hasRecord: true, keyPresent: true, pending: false });
      identityTest.showTitle(save);
    }, saved);
    assert.equal(await page.locator('#btn-begin').innerText(), 'Continue as Kept fixture hero');
    assert(await page.locator('#btn-begin').isEnabled()); assert(await page.locator('#btn-continue').isHidden());
    assert(await page.locator('#character-create-fields').isHidden());
    assert.equal(await page.locator('#title button.primary:visible').count(), 1);
    const details = page.locator('#title details.native-player-more'), summary = details.locator('summary');
    assert.equal(await details.getAttribute('open'), null);
    assert(await details.getByRole('button', { name: 'Reconnect identity', exact: true }).isHidden());
    await summary.focus(); await page.keyboard.press('Tab');
    assert(await page.locator('#btn-begin').evaluate(node => node === document.activeElement), 'closed identity controls must leave the keyboard path');
    await summary.focus(); await page.keyboard.press('Enter');
    assert(await details.getByRole('button', { name: 'Reconnect identity', exact: true }).isVisible());
    await page.keyboard.press('Tab');
    assert(await details.getByRole('button', { name: 'Reconnect identity', exact: true }).evaluate(node => node === document.activeElement));
    await details.getByRole('button', { name: 'Recovery options', exact: true }).click();
    const recovery = details.locator('.native-source-recovery'); await recovery.fill('fixture private recovery phrase');
    await page.evaluate(() => identityTest.changed());
    assert.equal(await recovery.inputValue(), 'fixture private recovery phrase');
    assert(await recovery.evaluate(node => node === document.activeElement), 'status refresh preserves the focused recovery field');
    assert(await details.evaluate(node => node.open), 'status refresh preserves an explicitly opened disclosure');
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    await page.locator('#btn-begin').click(); await page.waitForFunction(() => identityCalls.entries.length === 1);
    assert.deepEqual(await page.evaluate(() => identityCalls.entries[0]), { ...saved.char, fresh: false });
    assert.deepEqual(await page.evaluate(() => SAVE.loaded), saved, 'continuing must preserve the original save');
    assert.equal(await page.evaluate(() => identityCalls.save), 0, 'entry never substitutes an automatic identity/save operation');
    await context.close();
  });
  await check('expired access, unread connection and pending states surface recovery without authorizing entry', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      const save = { v: 1, char: { name: 'Unread fixture hero', realm: 0, cls: 'warrior', level: 8 } };
      SAVE.loaded = save; SAVE.readConfirmed = false;
      NATIVE_PLAYER.profile = null; NATIVE_PLAYER.state = 'native_signin_required';
      NATIVE_PLAYER.status.verified = false; identityTest.showTitle(save);
    });
    assert(await page.locator('#btn-begin').isDisabled()); assert(await page.locator('#btn-continue').isHidden());
    assert.equal(await page.locator('#title details.native-player-more').count(), 0);
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Reconnect identity');
    await page.evaluate(() => {
      NATIVE_PLAYER.status.verified = true; NATIVE_PLAYER.state = 'ready';
      NATIVE_PLAYER.profile = { status: () => ({ hasRecord: true, keyPresent: false, pending: false }) };
      nativePlayerRender();
    });
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Restore recovery file');
    assert(await page.locator('#title .native-source-recovery').isVisible(), 'missing held key exposes recovery without another hidden setup step');
    assert(await page.locator('#btn-begin').isDisabled());
    await page.evaluate(() => {
      NATIVE_PLAYER.status.verified = true; NATIVE_PLAYER.profile = { status: () => ({ hasRecord: true, keyPresent: true, pending: false }) };
      NATIVE_PLAYER.state = 'uncertain'; nativePlayerRender();
    });
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Retry connection');
    await page.evaluate(() => { NATIVE_PLAYER.busy = true; NATIVE_PLAYER.busyMessage = 'Opening your character…'; nativePlayerRender(); });
    assert(await page.locator('#btn-begin').isDisabled());
    assert.equal(await page.locator('#title .native-player button:enabled').count(), 0);
    assert.equal(await page.locator('#btn-begin').getAttribute('aria-busy'), 'true');
    assert.match(await page.locator('#save-note').innerText(), /Keep this page open/);
    assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length })), { saves: 0, loads: 0, entries: 0 });
    await context.close();
  });
  await check('expired temporary title preserves its exact owner, profile, key and deadline until an explicit choice', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'connect');
    await page.evaluate(() => {
      SAVE.native = true; SAVE.readConfirmed = false; SAVE.loaded = null;
      NATIVE_PLAYER.state = 'guest_expired'; NATIVE_PLAYER.status = { enabled: true, bound: false, provisional: true, provisionalPlay: { enabled: true } };
      const guest = { provisional: true, guestExpiresAt: Date.now() - 60000, keyId: 'fixture-retained-key' };
      NATIVE_PLAYER.provisional = { status: () => guest, claimProfile: () => null };
      window.retainedMenuState = { session: NATIVE_PLAYER.provisional, guest, token: NETWS.token, owner: NETWS.acct };
      identityTest.showTitle(null);
    });
    assert(await page.locator('#btn-begin').isDisabled());
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Open my saved character');
    assert(await page.locator('#title').getByRole('button', { name: 'Start a new character', exact: true }).isHidden());
    await page.locator('#title .native-player-alternatives > summary').click();
    assert(await page.locator('#title').getByRole('button', { name: 'Start a new character', exact: true }).isVisible());
    await page.evaluate(() => { identityTest.render(); identityTest.render(); });
    assert.deepEqual(await page.evaluate(() => ({ sameSession: retainedMenuState.session === NATIVE_PLAYER.provisional, sameKey: retainedMenuState.guest.keyId === NATIVE_PLAYER.provisional.status().keyId,
      sameDeadline: retainedMenuState.guest.guestExpiresAt === NATIVE_PLAYER.provisional.status().guestExpiresAt, sameOwner: retainedMenuState.owner === NETWS.acct, sameToken: retainedMenuState.token === NETWS.token,
      saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length })),
      { sameSession: true, sameKey: true, sameDeadline: true, sameOwner: true, sameToken: true, saves: 0, loads: 0, entries: 0 });
    assert.match(await page.locator('#title .native-player').innerText(), /Existing saves and browser keys are kept/);
    await context.close();
  });
  await check('owner mismatch and disconnected reads keep the original character intact and make reconnection an explicit choice', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      const save = { v: 1, char: { name: 'Original fixture hero', realm: 2, cls: 'warrior', level: 10, inventory: ['earned fixture item'] } };
      SAVE.loaded = save; SAVE.readConfirmed = true;
      NATIVE_PLAYER.profile.status = () => ({ hasRecord: true, keyPresent: true, pending: false });
      window.originalMenuState = { save, profile: NATIVE_PLAYER.profile, token: NETWS.token, owner: NETWS.acct };
      identityTest.showTitle(save);
      SAVE.readConfirmed = false; NETWS.state = 'off';
      NATIVE_PLAYER.authRefusal = { host: NETWS.host, token: NETWS.token, reason: 'native_owner_mismatch' };
      NATIVE_PLAYER.message = 'This sign-in belongs to a different account. Reconnect the original identity.';
      nativePlayerRender();
    });
    assert(await page.locator('#btn-begin').isDisabled());
    assert.equal(await page.locator('#title details.native-player-more').count(), 0);
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Reconnect identity');
    assert(await page.locator('#title').getByRole('button', { name: 'Sign in with a different account', exact: true }).isHidden());
    await page.locator('#title .native-player-alternatives > summary').click();
    assert(await page.locator('#title').getByRole('button', { name: 'Sign in with a different account', exact: true }).isVisible());
    assert.equal(await page.locator('#title').getByRole('button', { name: /^(Start a new character|Play with a new character)$/ }).count(), 0);
    assert.match(await page.locator('#title .native-player').innerText(), /Reconnect the original identity/);
    await page.evaluate(() => { identityTest.render(); identityTest.render(); });
    assert.deepEqual(await page.evaluate(() => ({ sameSave: originalMenuState.save === SAVE.loaded, sameProfile: originalMenuState.profile === NATIVE_PLAYER.profile,
      sameOwner: originalMenuState.owner === NETWS.acct, sameToken: originalMenuState.token === NETWS.token,
      saves: identityCalls.save, loads: identityCalls.load, links: identityCalls.links.length, entries: identityCalls.entries.length })),
      { sameSave: true, sameProfile: true, sameOwner: true, sameToken: true, saves: 0, loads: 0, links: 0, entries: 0 });
    await context.close();
  });
  await check('legacy and local titles use the same single visible entry without changing resume or new-character arguments', async () => {
    for (const backend of ['local', 'db']) {
      const context = await contextForMobile(), page = await openFixture(context, 'title');
      const saved = { v: 1, char: { name: 'Retained ' + backend + ' hero', realm: 2, cls: 'warrior', level: 19, xp: 13317, rp: 190, inventory: ['legacy earned item'] } };
      await page.evaluate(({ save, backend }) => {
        SAVE.native = false; SAVE.backend = backend; SAVE.loaded = save;
        NATIVE_PLAYER.status = { enabled: false }; NATIVE_PLAYER.profile = null; identityTest.showTitle(save);
      }, { save: saved, backend });
      assert(await page.locator('#btn-continue').isHidden()); assert(await page.locator('#btn-begin').isEnabled());
      assert.equal(await page.locator('#btn-begin').innerText(), 'Continue as ' + saved.char.name);
      assert.equal(await page.locator('#title button.primary:visible').count(), 1);
      assert.equal(await page.locator('#title .native-player').count(), 0);
      assert(await page.locator('#character-create-fields').isHidden());
      await page.locator('#btn-begin').click(); await page.waitForFunction(() => identityCalls.entries.length === 1);
      assert.deepEqual(await page.evaluate(() => identityCalls.entries[0]), { ...saved.char, fresh: false });
      assert.deepEqual(await page.evaluate(() => SAVE.loaded), saved);
      await page.evaluate(() => { identityTest.showTitle(null); document.getElementById('name-input').value = 'Explicit new fixture recruit'; });
      assert(await page.locator('#character-create-fields').isVisible()); assert(await page.locator('#continue').isHidden());
      assert.equal(await page.locator('#title button.primary:visible').count(), 1);
      await page.locator('#btn-begin').click(); await page.waitForFunction(() => identityCalls.entries.length === 2);
      assert.deepEqual(await page.evaluate(() => identityCalls.entries[1]), { v: 1, name: 'Explicit new fixtu', realm: 2, cls: 'warrior', level: 1, xp: 0, rp: 0, fresh: true });
      assert.equal(await page.evaluate(() => identityCalls.save), 0);
      await context.close();
    }
  });
  await check('native recovery, unread and expired states conceal creation without clearing a draft, then restore only a confirmed empty or fresh path', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'connect');
    await page.evaluate(() => identityTest.showTitle(null));
    await page.locator('#name-input').fill('Kept draft name');
    await page.locator('#realm-pick [data-realm="2"]').click();
    await page.locator('#class-pick [data-cls="mage"]').click();
    await page.evaluate(() => {
      SAVE.native = true; SAVE.readConfirmed = false;
      NATIVE_PLAYER.status = { enabled: true, bound: true, verified: true, recordLinks: { character: 'urn:fixture:existing-record' } };
      NATIVE_PLAYER.state = 'key_required';
      NATIVE_PLAYER.profile = { status: () => ({ hasRecord: true, keyPresent: false, pending: false }) };
      window.draftRecoveryProfile = NATIVE_PLAYER.profile; nativePlayerRender();
    });
    assert(await page.locator('#character-create-fields').isHidden()); assert(await page.locator('#btn-begin').isDisabled());
    assert.equal(await page.locator('#title button.primary:visible').innerText(), 'Restore recovery file');
    await page.evaluate(() => { nativePlayerRender(); nativePlayerRender(); });
    assert(await page.evaluate(() => NATIVE_PLAYER.profile === draftRecoveryProfile));
    await page.evaluate(() => { NATIVE_PLAYER.profile = null; NATIVE_PLAYER.state = 'uncertain'; nativePlayerRender(); });
    assert(await page.locator('#character-create-fields').isHidden());
    await page.evaluate(() => { NATIVE_PLAYER.state = 'guest_expired'; NATIVE_PLAYER.status = { enabled: true, bound: false, provisionalPlay: { enabled: true } }; nativePlayerRender(); });
    assert(await page.locator('#character-create-fields').isHidden()); assert(await page.locator('#btn-begin').isDisabled());
    await page.evaluate(() => {
      NATIVE_PLAYER.state = 'ready'; NATIVE_PLAYER.status = { enabled: true, bound: true, verified: true };
      NATIVE_PLAYER.profile = { status: () => ({ hasRecord: false, keyPresent: false, pending: false }) }; SAVE.readConfirmed = true; nativePlayerRender();
    });
    assert(await page.locator('#character-create-fields').isVisible()); assert(await page.locator('#btn-begin').isEnabled());
    assert.equal(await page.locator('#name-input').inputValue(), 'Kept draft name');
    assert.equal(await page.locator('#realm-pick [data-realm="2"]').getAttribute('aria-checked'), 'true');
    assert.equal(await page.locator('#class-pick [data-cls="mage"]').getAttribute('aria-checked'), 'true');
    await page.evaluate(() => {
      SAVE.loaded = { v: 1, char: null }; NATIVE_PLAYER.profile = { status: () => ({ hasRecord: true, keyPresent: true, pending: false }) };
      nativePlayerRender();
    });
    assert(await page.locator('#character-create-fields').isVisible(), 'a confirmed encrypted document with char:null is an empty character, not an unread record');
    assert(await page.locator('#btn-begin').isEnabled()); assert.equal(await page.locator('#name-input').inputValue(), 'Kept draft name');
    await page.evaluate(() => identityTest.showTitle(SAVE.loaded));
    assert(await page.locator('#character-create-fields').isVisible(), 'the explicit empty-title return must also permit creation');
    assert.deepEqual(await page.evaluate(() => SAVE.loaded), { v: 1, char: null });
    await page.locator('#name-input').fill('Kept draft name');
    await page.evaluate(() => {
      SAVE.readConfirmed = false; NATIVE_PLAYER.profile = null;
      NATIVE_PLAYER.status = { enabled: true, bound: false, provisionalPlay: { enabled: true } }; nativePlayerRender();
    });
    assert(await page.locator('#character-create-fields').isVisible()); assert(await page.locator('#btn-begin').isEnabled());
    assert.equal(await page.locator('#name-input').inputValue(), 'Kept draft name');
    assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length })), { saves: 0, loads: 0, entries: 0 });
    await context.close();
  });
  await check('locked title initially exposes only its required recovery action, then explicit alternatives retain draft and focus', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      SAVE.readConfirmed = false; NATIVE_PLAYER.state = 'key_required';
      NATIVE_PLAYER.profile.status = () => ({ hasRecord: true, keyPresent: false, pending: false }); nativePlayerRender();
    });
    const box = page.locator('#title .native-player'), alternatives = box.locator('details.native-player-alternatives');
    assert.deepEqual(await box.locator('button:visible:enabled').allTextContents(), ['Restore recovery file']);
    assert(await page.locator('#btn-begin').isDisabled()); assert(await alternatives.evaluate(node => !node.open));
    assert(await box.locator('.native-source-recovery').isVisible());
    assert.equal(await box.getByRole('button', { name: /^(Recovery options|Hide recovery options|Retry pod save)$/ }).count(), 0, 'forced recovery has no no-op toggle or duplicate read retry');
    assert(await box.getByRole('button', { name: 'Reconnect identity', exact: true }).isHidden());
    assert(await box.getByRole('button', { name: 'Retry connection', exact: true }).isHidden());
    await box.locator('.native-source-recovery').fill('Kept private fixture phrase');
    await alternatives.locator('summary').click();
    assert(await box.getByRole('button', { name: 'Reconnect identity', exact: true }).isVisible());
    assert(await box.getByRole('button', { name: 'Retry connection', exact: true }).isVisible());
    await box.getByRole('button', { name: 'Retry connection', exact: true }).focus();
    await page.evaluate(() => { NATIVE_PLAYER.message = 'Synthetic connection status changed'; nativePlayerRender(); });
    assert(await alternatives.evaluate(node => node.open));
    assert(await box.getByRole('button', { name: 'Retry connection', exact: true }).evaluate(node => node === document.activeElement));
    assert.equal(await box.locator('.native-source-recovery').inputValue(), 'Kept private fixture phrase');
    await box.locator('.native-source-recovery').focus();
    await page.evaluate(() => { NATIVE_PLAYER.message = 'Another synthetic status change'; nativePlayerRender(); });
    assert(await box.locator('.native-source-recovery').evaluate(node => node === document.activeElement));
    assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length })), { saves: 0, loads: 0, entries: 0 });
    await context.close();
  });
  await check('a retry moving between primary and closed alternatives preserves its exact focus or lands on the disclosure safely', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      SAVE.readConfirmed = false; window.fixtureKeyHeld = true;
      NATIVE_PLAYER.profile.status = () => ({ hasRecord: true, keyPresent: fixtureKeyHeld, pending: false }); nativePlayerRender();
    });
    const box = page.locator('#title .native-player'), alternatives = box.locator('details.native-player-alternatives');
    await box.getByRole('button', { name: 'Retry connection', exact: true }).focus();
    await page.evaluate(() => { fixtureKeyHeld = false; nativePlayerRender(); });
    assert(await alternatives.evaluate(node => !node.open));
    assert(await alternatives.locator('summary').evaluate(node => node === document.activeElement));
    assert(await box.getByRole('button', { name: 'Retry connection', exact: true }).isHidden());
    await alternatives.locator('summary').click(); await box.getByRole('button', { name: 'Retry connection', exact: true }).focus();
    await page.evaluate(() => { fixtureKeyHeld = true; nativePlayerRender(); });
    assert(await box.getByRole('button', { name: 'Retry connection', exact: true }).evaluate(node => node === document.activeElement));
    assert.equal(await box.locator('button.primary').innerText(), 'Retry connection');
    assert(await alternatives.evaluate(node => node.open));
    await context.close();
  });
  for (const boundary of ['owner', 'host']) await check(boundary + ' change closes recovery alternatives and clears prior recovery text without retargeting focus', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      SAVE.readConfirmed = false; NATIVE_PLAYER.profile.status = () => ({ hasRecord: true, keyPresent: false, pending: false }); nativePlayerRender();
    });
    const box = page.locator('#title .native-player'), alternatives = box.locator('details.native-player-alternatives');
    await box.locator('.native-source-recovery').fill('Prior owner private fixture phrase');
    await alternatives.locator('summary').click(); await box.locator('.native-source-recovery').focus();
    await page.evaluate(boundary => {
      if (boundary === 'owner') NETWS.acct = { id: 'different-fixture-owner' }; else NETWS.host = 'different-fixture-host.invalid';
      nativePlayerRender();
    }, boundary);
    assert(await alternatives.evaluate(node => !node.open));
    assert.equal(await box.locator('.native-source-recovery').inputValue(), '');
    assert(await box.locator('.native-player-status').evaluate(node => node === document.activeElement));
    assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length })), { saves: 0, loads: 0, entries: 0 });
    await context.close();
  });
  await check('claim-target key recovery stays visible while temporary refresh and reconnect choices are collapsed', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'title');
    await page.evaluate(() => {
      SAVE.readConfirmed = false; NATIVE_PLAYER.claimPendingResume = true;
      NATIVE_PLAYER.status = { ...NATIVE_PLAYER.status, bound: false, provisional: true, provisionalPlay: { enabled: true } };
      const target = { status: () => ({ hasRecord: true, keyPresent: false }) };
      NATIVE_PLAYER.provisional = { status: () => ({ provisional: true, claim: { targetAvailable: true } }), claimProfile: () => target };
      nativePlayerRender();
    });
    const box = page.locator('#title .native-player');
    assert(await box.locator('.native-target-recovery').isVisible());
    assert.deepEqual(await box.locator('button:visible:enabled').allTextContents(), ['Restore saved character']);
    assert(await box.getByRole('button', { name: 'Refresh temporary connection', exact: true }).isHidden());
    await box.locator('.native-target-recovery').fill('Kept target fixture phrase');
    await box.locator('.native-target-recovery').focus();
    await page.evaluate(() => { NATIVE_PLAYER.message = 'Target key is still required'; nativePlayerRender(); });
    assert.equal(await box.locator('.native-target-recovery').inputValue(), 'Kept target fixture phrase');
    assert(await box.locator('.native-target-recovery').evaluate(node => node === document.activeElement));
    assert(await page.locator('#btn-begin').isDisabled());
    await page.evaluate(() => {
      NATIVE_PLAYER.claimPendingResume = false; SAVE.readConfirmed = true;
      SAVE.loaded = { v: 1, char: { name: 'Playable fixture hero', realm: 0, cls: 'warrior', level: 3 } }; identityTest.showTitle(SAVE.loaded);
    });
    assert(await page.locator('#btn-begin').isEnabled(), 'claim-target recovery must not revoke play of the current confirmed character');
    assert.equal(await page.locator('#btn-begin').innerText(), 'Continue as Playable fixture hero');
    assert.deepEqual(await page.locator('#title button.primary:visible').allTextContents(), ['Restore saved character']);
    assert.equal(await box.locator('.native-target-recovery').inputValue(), 'Kept target fixture phrase');
    await context.close();
  });
  await check('verified foreign-owner callback explains refusal and only an explicit title action restores the selected existing owner', async () => {
    claimMode='callback-mismatch';const {context,page}=await callbackFixture('connect-expired');await prepareLive(page);await page.evaluate(()=>identityTest.coldBoot());
    await page.evaluate(()=>{SAVE.readConfirmed=true;SAVE.loaded={v:1,char:{name:'Original loaded character'}};window.originalLoaded=SAVE.loaded;
      NATIVE_PLAYER.profile={status:()=>({pending:false,keyPresent:true,hasRecord:true})};window.originalProfile=NATIVE_PLAYER.profile;
      NATIVE_PLAYER.status={...NATIVE_PLAYER.status,bound:true,verified:true};nativePlayerRender()});
    const claims=calls.filter(call=>call.pathname==='/gaming/identity/claim').length;
    const callback=context.waitForEvent('response',response=>new URL(response.url()).pathname==='/gaming/identity/callback');
    const opening=page.waitForEvent('popup');await page.locator('#title .native-player button').filter({hasText:'Reconnect identity'}).click();const popup=await opening;
    const response=await callback;assert.equal(response.status(),403);assert.equal(response.headers()['cache-control'],'no-store');
    await popup.locator('#return:not([hidden])').waitFor();await page.waitForFunction(()=>NATIVE_PLAYER.authRefusal?.reason==='native_owner_mismatch');
    assert.match(await popup.locator('#status').innerText(),/different account/);assert.equal(popup.url(),CALLBACK_ORIGIN+'/gaming/identity/finish');
    assert(!/fixture-selected-existing-owner|fixture-native-relay|u-pk-fixture001/.test(await response.text()));
    assert.equal(calls.filter(call=>call.pathname==='/gaming/identity/claim').length,claims);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),GAME_TOKEN);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    assert.deepEqual(await page.evaluate(()=>({hellos:identityCalls.hellos.length,sameLoaded:SAVE.loaded===originalLoaded,sameProfile:NATIVE_PLAYER.profile===originalProfile})),
      {hellos:1,sameLoaded:true,sameProfile:true});
    // A background retry may still be waiting for the refused transport's
    // welcome when the user explicitly switches accounts. Exercise the actual
    // opening promise rather than replacing netLinkWS with a test shortcut.
    await page.evaluate(()=>{identityTest.holdColdHello();void identityTest.coldBoot()});
    await page.waitForFunction(()=>identityCalls.hellos.length===2&&NETWS.state==='opening');
    const starts=calls.filter(call=>call.pathname==='/gaming/identity/start').length;
    startHold=gate();const fresh=page.locator('#title .native-player button').filter({hasText:'Sign in with a different account'});await fresh.waitFor();
    const freshOpening=page.waitForEvent('popup');await fresh.click();const freshPopup=await freshOpening;
    assert.notEqual(freshPopup,popup,'the explicit retry starts a fresh same-origin popup');
    await page.waitForFunction(()=>NETWS.acct?.id==='fixture-fresh-guest',undefined,{timeout:2500});
    await startHold.entered;
    assert.equal(calls.filter(call=>call.pathname==='/gaming/identity/start').length,starts+1,'the explicit switch starts a second identity ceremony');
    assert.deepEqual(await page.evaluate(()=>identityCalls.hellos.map(hello=>hello.token||null)),[GAME_TOKEN,GAME_TOKEN,null]);
    await page.evaluate(()=>identityTest.releaseColdHellos());
    assert.deepEqual(await page.evaluate(()=>({state:NETWS.state,token:NETWS.token,acct:NETWS.acct?.id})),
      {state:'on',token:GUEST_TOKEN,acct:'fixture-fresh-guest'},'the retired transport reply cannot revoke the fresh session');
    assert.deepEqual(await page.evaluate(()=>({token:NETWS.token,acct:NETWS.acct.id,read:SAVE.readConfirmed,switching:NATIVE_PLAYER.switching,
      sameLoaded:SAVE.loaded===originalLoaded,sameProfile:NATIVE_PLAYER.profile===originalProfile,begin:document.querySelector('#btn-begin').disabled,continue:document.querySelector('#btn-continue').disabled})),
      {token:GUEST_TOKEN,acct:'fixture-fresh-guest',read:false,switching:true,sameLoaded:true,sameProfile:true,begin:true,continue:true});
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    await page.evaluate(()=>{SAVE.readConfirmed=true;nativePlayerRender()});
    assert(await page.locator('#btn-begin').isDisabled());assert(await page.locator('#btn-continue').isDisabled());
    assert.equal(await page.locator('button').filter({hasText:'Download recovery file'}).count(),0);
    const closing=freshPopup.waitForEvent('close');startHold.release();startHold=null;await closing;await page.waitForFunction(()=>window.identityTest?.ready);
    assert.equal(popup.isClosed(),false,'the earlier refused ceremony is not reused or implicitly cancelled');
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),APP_TOKEN);
    assert.equal((await cached(page)).result.credential.accessToken,NATIVE_TOKEN);assert.equal((await cached(page)).result.ownerDid,owner.subjectDid);
    await context.close();
  });
  await check('verified owner mismatch during gameplay retains the character, save, key and app session without a switch action',async()=>{
    claimMode='callback-mismatch';const {context,page}=await callbackFixture('players-reauth');await prepareLive(page);
    const before=await page.evaluate(()=>identityTest.status()),opening=page.waitForEvent('popup');
    await page.locator('#netsheet .native-player button').filter({hasText:'Reconnect identity'}).click();const popup=await opening;
    await popup.locator('#return:not([hidden])').waitFor();await page.waitForFunction(()=>NATIVE_PLAYER.message.includes('different account'));
    const after=await page.evaluate(()=>identityTest.status());assert.deepEqual(after.pending,before.pending);assert.deepEqual(after.memory,before.memory);
    assert.equal(after.token,GAME_TOKEN);assert.equal(after.calls.reloadMarker,before.calls.reloadMarker);assert.equal(after.calls.reauthenticate,0);
    assert.equal(await page.evaluate(()=>NATIVE_PLAYER.authRefusal),null);assert.equal(await page.evaluate(()=>NATIVE_PLAYER.switching),false);
    assert.equal(await page.locator('button').filter({hasText:'Sign in with a different account'}).count(),0);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');await context.close();
  });
  for(const field of ['host','browserCeremony','expiresAt'])await check('callback failure with tampered '+field+' cannot notify the game or enable account switching',async()=>{
    claimMode='callback-mismatch';const {context,page}=await callbackFixture('connect-expired');await prepareLive(page);await page.evaluate(()=>identityTest.coldBoot());
    await context.addInitScript(field=>{if(location.pathname==='/gaming/identity/callback'){
      const key='hallowmarch.identity.ceremony.v1',ceremony=JSON.parse(sessionStorage.getItem(key));
      ceremony[field]=field==='expiresAt'?0:field==='host'?'other-game.example':'x'.repeat(43);sessionStorage.setItem(key,JSON.stringify(ceremony));
    }},field);
    const before=broadcastMessages.length,opening=page.waitForEvent('popup');await page.locator('#title .native-player button').filter({hasText:'I already have an identity'}).click();const popup=await opening;
    await popup.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('expired'));
    assert.match(await popup.locator('#status').innerText(),/expired/);
    assert.equal(popup.url(),CALLBACK_ORIGIN+'/gaming/identity/finish');
    assert.equal(await page.evaluate(()=>NATIVE_PLAYER.authRefusal),null);assert.equal(await page.evaluate(()=>NATIVE_PLAYER.switching),false);
    assert.equal(broadcastMessages.slice(before).filter(message=>message.direction==='sent').length,0);
    assert.equal(await page.locator('button').filter({hasText:'Sign in with a different account'}).count(),0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),GAME_TOKEN);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');await context.close();
  });
  await check('same-owner popup reauthentication preserves live memory and resumes only its latest save without reload',async()=>{
    claimMode='success';const context=await contextForMobile(),page=await openFixture(context,'players-reauth');await prepareLive(page);
    const before=await page.evaluate(()=>identityTest.status());await page.evaluate(()=>identityTest.holdResume());
    const popup=await reconnectPopup(page);
    await page.waitForFunction(()=>identityTest.status().calls.reauthenticate===1);
    await page.evaluate(()=>identityTest.progress(11));
    assert.equal((await page.evaluate(()=>identityTest.status())).calls.saved.length,0,'No body writes before readback');
    await page.evaluate(()=>identityTest.releaseResume());
    await page.waitForFunction(()=>identityTest.status().pending===null&&identityTest.status().calls.saved.length===1);
    const after=await page.evaluate(()=>identityTest.status());
    assert.equal(after.calls.reloadMarker,before.calls.reloadMarker);assert.equal(after.memory.char.n,11);
    assert.equal(after.memory.char.name,'Kept in-memory character');assert.equal(after.calls.saved[0].char.n,11);
    assert.deepEqual(after.calls.links,[APP_TOKEN]);assert.equal(after.token,APP_TOKEN);assert.equal(after.reload,false);
    assert.equal(await page.evaluate(()=>NATIVE_PLAYER.profile===window.originalProfile),true);
    assert.equal((await cached(page)).result.credential.accessToken,NATIVE_TOKEN);
    await popup.close().catch(()=>{});await context.close();
  });
  for(const mode of ['foreign-owner','foreign-account'])await check(mode+' popup cannot replace a playing owner, cache, token or pending progress',async()=>{
    claimMode=mode;const context=await contextForMobile(),page=await openFixture(context,'players-reauth');await prepareLive(page);
    const before=await page.evaluate(()=>identityTest.status());const popup=await reconnectPopup(page);
    await popup.waitForFunction(()=>document.querySelector('#status')?.textContent.includes('original identity'));
    const after=await page.evaluate(()=>identityTest.status());
    assert.equal(after.calls.reloadMarker,before.calls.reloadMarker);assert.equal(after.memory.char.n,9);assert.equal(after.pending.char.n,9);
    assert.equal(after.calls.reauthenticate,0);assert.equal(after.calls.saved.length,0);assert.equal(after.reload,false);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),GAME_TOKEN);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    await popup.close();await context.close();
  });
  await check('competing native readback keeps live progress and the original profile without a write or reload',async()=>{
    claimMode='success';const context=await contextForMobile(),page=await openFixture(context,'players-reauth');await prepareLive(page);
    const marker=(await page.evaluate(()=>identityTest.status())).calls.reloadMarker;await page.evaluate(()=>identityTest.conflict());
    const popup=await reconnectPopup(page);await page.waitForFunction(()=>identityTest.status().message.includes('head changed'));
    const after=await page.evaluate(()=>identityTest.status());assert.equal(after.calls.reloadMarker,marker);
    assert.equal(after.calls.saved.length,0);assert.equal(after.memory.char.n,9);assert.equal(after.pending.char.n,9);
    assert.equal(after.paused,true);assert.equal(after.reload,false);assert.equal(await page.evaluate(()=>NATIVE_PLAYER.profile===window.originalProfile),true);
    await popup.close().catch(()=>{});await context.close();
  });
  await check('native save bursts retain only the active body and newest progress',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'players-reauth');
    await page.evaluate(()=>{identityTest.holdWrite();void identityTest.progress(10)});
    await page.waitForFunction(()=>identityTest.status().calls.saved.length===1);
    await page.evaluate(()=>{for(let n=11;n<=40;n++)void identityTest.progress(n)});
    let state=await page.evaluate(()=>identityTest.status());assert.equal(state.calls.saved.length,1);assert.equal(state.pending.char.n,40);
    await page.evaluate(()=>identityTest.releaseWrite());await page.waitForFunction(()=>identityTest.status().pending===null);
    state=await page.evaluate(()=>identityTest.status());assert.deepEqual(state.calls.saved.map(save=>save.char.n),[10,40]);
    await context.close();
  });
  await check('legacy fixed-name popup reuse reproduces the foreign sessionStorage SecurityError', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'connect');
    try {
      const starts = calls.filter(call => call.pathname === '/gaming/identity/start').length;
      await retainedForeignPopup(page);
      const result = await page.evaluate(() => {
        const popup = window.open('about:blank', 'hallowmarch-identity', 'popup,width=520,height=760');
        try {
          popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', JSON.stringify({ fixture: true }));
          return { reused: popup === window.retainedForeignIdentity, error: null };
        } catch (error) { return { reused: popup === window.retainedForeignIdentity, error: error.name, message: error.message }; }
      });
      assert.equal(result.reused, true);
      assert.equal(result.error, 'SecurityError', 'the old WindowProxy remains foreign until its about:blank navigation completes');
      assert.match(result.message, /sessionStorage|cross-origin|Blocked a frame/i);
      assert.equal(calls.filter(call => call.pathname === '/gaming/identity/start').length, starts, 'the platform-only reproduction must not start an identity ceremony');
    } finally { await context.close(); }
  });
  await check('owner sign-in opens a fresh ceremony beside a retained foreign identity popup and completes the real finish', async () => {
    claimMode = 'success'; startHold = gate();
    const context = await contextForMobile(), page = await openFixture(context, 'connect');
    try {
      const retained = await retainedForeignPopup(page), retainedUrl = retained.url();
      const opening = page.waitForEvent('popup', { timeout: 5000 });
      await page.locator('#title .native-player').getByRole('button', { name: 'I already have an identity', exact: true }).click();
      const popup = await opening; await startHold.entered;
      assert.notEqual(popup, retained, 'each attempt needs its own initial same-origin window');
      assert.equal(retained.url(), retainedUrl);
      assert.equal(await retained.evaluate(() => sessionStorage.getItem('foreign.fixture.marker')), 'untouched');
      assert.equal(await retained.evaluate(() => sessionStorage.getItem('hallowmarch.identity.ceremony.v1')), null);
      const ceremony = await popup.evaluate(() => JSON.parse(sessionStorage.getItem('hallowmarch.identity.ceremony.v1')));
      assert.equal(ceremony.token, GAME_TOKEN); assert.equal(ceremony.host, new URL(base).host);
      assert.match(ceremony.channel, /^hallowmarch-owner-[0-9a-f-]{36}$/i);
      assert(ceremony.expiresAt > Date.now() && ceremony.expiresAt <= Date.now() + 10 * 60 * 1000);
      assert.deepEqual(Object.keys(ceremony).sort(), ['channel', 'expiresAt', 'host', 'token']);
      assert.deepEqual(await page.evaluate(() => ({ saves: identityCalls.save, loads: identityCalls.load, entries: identityCalls.entries.length, token: NETWS.token })),
        { saves: 0, loads: 0, entries: 0, token: GAME_TOKEN });
      const closing = popup.waitForEvent('close'); startHold.release(); startHold = null; await closing;
      await page.waitForFunction(() => window.identityTest?.ready);
      assert.equal((await cached(page)).result.credential.accessToken, NATIVE_TOKEN);
      assert.equal(await page.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), APP_TOKEN);
      assert(broadcastMessages.some(message => message.direction === 'received' && message.channel === ceremony.channel && message.data.type === 'hallowmarch-native-connected'));
      assert.equal(retained.url(), retainedUrl);
      assert.equal(await retained.evaluate(() => sessionStorage.getItem('foreign.fixture.marker')), 'untouched');
    } finally { await context.close(); }
  });
  await check('Keep my character seeds a separate owner-bound ceremony without replacing the retained character or key', async () => {
    const context = await contextForMobile(), page = await openFixture(context, 'connect');
    try {
      await page.evaluate(({ owner, authorizationUrl, browserCeremony }) => {
        const save = { v: 1, char: { name: 'Retained temporary fixture hero', realm: 1, cls: 'mage', level: 8, inventory: ['earned fixture item'] } };
        const key = { fingerprint: 'retained-fixture-character-key' };
        window.claimFixture = { prepare: 0, keyWrites: 0, recordWrites: 0, save, key };
        const refuseWrite = name => { claimFixture[name]++; throw Error('The authorization popup must not replace a character or key.'); };
        const profile = { status: () => ({ hasRecord: true, keyPresent: true, pending: false }),
          set: async () => refuseWrite('recordWrites'), createKey: async () => refuseWrite('keyWrites') };
        const session = { status: () => ({ provisional: true, guestExpiresAt: Date.now() + 600000, keyPresent: true, pending: false }),
          claimProfile: () => null, prepareClaim: async () => { claimFixture.prepare++; return { authorizationUrl, browserCeremony }; } };
        SAVE.native = true; SAVE.loaded = save; SAVE.readConfirmed = true; SAVE.pending = null;
        NATIVE_PLAYER.status = { enabled: true, bound: false, verified: true, provisional: true, provisionalPlay: { enabled: true }, binding: owner };
        NATIVE_PLAYER.state = 'ready'; NATIVE_PLAYER.profile = profile; NATIVE_PLAYER.provisional = session;
        claimFixture.profile = profile; claimFixture.session = session; claimFixture.account = NETWS.acct; claimFixture.token = NETWS.token;
        nativePlayerRender();
      }, { owner, authorizationUrl: base + '/fixture-claim-authorize', browserCeremony: BROWSER_CEREMONY });
      const retained = await retainedForeignPopup(page), retainedUrl = retained.url();
      const opening = page.waitForEvent('popup', { timeout: 5000 });
      await page.locator('#title .native-player').getByRole('button', { name: 'Keep my character', exact: true }).click();
      const popup = await opening;
      assert.notEqual(popup, retained);
      await popup.waitForURL(base + '/fixture-claim-authorize');
      const ceremony = await popup.evaluate(() => JSON.parse(sessionStorage.getItem('hallowmarch.identity.ceremony.v1')));
      assert.equal(ceremony.purpose, 'character-claim-target'); assert.equal(ceremony.expectedOwnerDid, owner.subjectDid);
      assert.equal(ceremony.browserCeremony, BROWSER_CEREMONY); assert.equal(ceremony.token, GAME_TOKEN); assert.equal(ceremony.host, new URL(base).host);
      assert.match(ceremony.channel, /^hallowmarch-claim-[0-9a-f-]{36}$/i);
      assert(ceremony.expiresAt > Date.now() && ceremony.expiresAt <= Date.now() + 10 * 60 * 1000);
      assert.deepEqual(Object.keys(ceremony).sort(), ['browserCeremony', 'channel', 'expectedOwnerDid', 'expiresAt', 'host', 'purpose', 'token']);
      await page.waitForFunction(() => !NATIVE_PLAYER.busy);
      assert.deepEqual(await page.evaluate(() => ({ prepare: claimFixture.prepare, keyWrites: claimFixture.keyWrites, recordWrites: claimFixture.recordWrites,
        sameSave: SAVE.loaded === claimFixture.save, sameProfile: NATIVE_PLAYER.profile === claimFixture.profile, sameSession: NATIVE_PLAYER.provisional === claimFixture.session,
        sameAccount: NETWS.acct === claimFixture.account, sameToken: NETWS.token === claimFixture.token, key: claimFixture.key.fingerprint,
        character: SAVE.loaded.char, flushes: identityCalls.save, entries: identityCalls.entries.length })),
        { prepare: 1, keyWrites: 0, recordWrites: 0, sameSave: true, sameProfile: true, sameSession: true, sameAccount: true, sameToken: true,
          key: 'retained-fixture-character-key', character: { name: 'Retained temporary fixture hero', realm: 1, cls: 'mage', level: 8, inventory: ['earned fixture item'] }, flushes: 1, entries: 0 });
      assert.equal((await cached(page)).entries.length, 0);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
      assert.equal(retained.url(), retainedUrl);
      assert.equal(await retained.evaluate(() => sessionStorage.getItem('foreign.fixture.marker')), 'untouched');
      assert.equal(await retained.evaluate(() => sessionStorage.getItem('hallowmarch.identity.ceremony.v1')), null);
    } finally { await context.close(); }
  });
  await check('real popup ceremony, same-game-token claim, encrypted cache and BroadcastChannel return', async () => {
    claimMode='success';startHold=gate();const context=await contextForMobile(),page=await openFixture(context,'connect');
    const popupPromise=page.waitForEvent('popup');await page.locator('#title .native-player button').first().click();
    const popup=await popupPromise;await startHold.entered;
    const ceremony=await popup.evaluate(()=>JSON.parse(sessionStorage.getItem('hallowmarch.identity.ceremony.v1')));
    assert.equal(ceremony.token,GAME_TOKEN);assert.equal(ceremony.host,new URL(base).host);assert(ceremony.expiresAt>Date.now());assert(ceremony.channel.startsWith('hallowmarch-owner-'));
    const closing=popup.waitForEvent('close');startHold.release();startHold=null;await closing;
    await page.waitForFunction(()=>window.identityTest?.ready);
    const restored=await cached(page);assert.equal(restored.result.credential.accessToken,NATIVE_TOKEN);assert(restored.result.expiresAt>Date.now());
    assert.equal(restored.result.credential.refreshToken,null);assert.equal(restored.result.credential.method,'webauthn');assert.equal(restored.entries.length,1);
    const stored=await page.evaluate(async()=>{
      const request=indexedDB.open('interego-browser-access-v1');const db=await new Promise(resolve=>request.onsuccess=()=>resolve(request.result));
      const tx=db.transaction(['sessions','keys']),s=tx.objectStore('sessions').getAll(),k=tx.objectStore('keys').getAll();
      const result=await new Promise(resolve=>{let a,b;const finish=()=>{if(a&&b)resolve({json:JSON.stringify(a),keyExtractable:b[0].wrappingKey.extractable})};s.onsuccess=()=>{a=s.result;finish()};k.onsuccess=()=>{b=k.result;finish()}});db.close();return result;
    });
    assert(!stored.json.includes(NATIVE_TOKEN));assert.equal(stored.keyExtractable,false);
    const local=await page.evaluate(()=>Object.fromEntries(Object.entries(localStorage)));
    assert.equal(local['hallowmarch.token.'+new URL(base).host],APP_TOKEN);assert.deepEqual(Object.keys(local),['hallowmarch.token.'+new URL(base).host]);assert(!JSON.stringify(local).includes(NATIVE_TOKEN));
    assert(broadcastMessages.some(message=>message.direction==='received'&&message.channel===ceremony.channel&&message.data.type==='hallowmarch-native-connected'));
    assert(calls.some(call=>call.pathname==='/gaming/identity/claim'&&call.authorization==='Bearer '+GAME_TOKEN));
    await context.close();
  });
  await check('cold expired session denied by the actual multiplayer handshake can authorize HTTP-only identity recovery',async()=>{
    claimMode='success';startHold=gate();const context=await contextForMobile(),page=await openFixture(context,'connect-expired');
    assert.equal(await page.evaluate(()=>identityTest.coldBoot()),null);
    assert.deepEqual(await page.evaluate(()=>({acct:NETWS.acct,token:NETWS.token,state:NETWS.state,hellos:identityCalls.hellos})),
      {acct:null,token:'',state:'off',hellos:[{t:'hello',v:1,token:GAME_TOKEN}]});
    const popupPromise=page.waitForEvent('popup');await page.locator('#title .native-player button').first().click();const popup=await popupPromise;await startHold.entered;
    const ceremony=await popup.evaluate(()=>JSON.parse(sessionStorage.getItem('hallowmarch.identity.ceremony.v1')));
    assert.equal(ceremony.token,GAME_TOKEN);assert.equal(ceremony.expectedAccountId,undefined);
    assert.deepEqual(await page.evaluate(()=>({acct:NETWS.acct,token:NETWS.token,hellos:identityCalls.hellos.length})),{acct:null,token:'',hellos:1});
    const closing=popup.waitForEvent('close');startHold.release();startHold=null;await closing;
    await page.waitForFunction(()=>window.identityTest?.ready);assert.equal((await cached(page)).result.credential.accessToken,NATIVE_TOKEN);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),APP_TOKEN);
    await context.close();
  });
  for(const mode of ['fresh-expired','fresh-invalid'])await check(mode+' proof needs an explicit title action before a fresh transport restores the original owner',async()=>{
    claimMode=mode;const previous=mode==='fresh-invalid'?INVALID_TOKEN:GAME_TOKEN;
    const context=await contextForMobile(),page=await openFixture(context,'connect-expired');
    await prepareLive(page);await page.evaluate(()=>{NETWS.token='';NETWS.acct=null});
    assert.equal(await page.locator('button').filter({hasText:'Start a fresh sign-in'}).count(),0);
    assert.equal(await page.evaluate(token=>identityTest.coldBoot(token),previous),null);
    const refusedPopup=page.waitForEvent('popup').then(popup=>popup.isClosed()?null:popup.waitForEvent('close'));
    await page.locator('#title .native-player button').filter({hasText:'I already have an identity'}).click();await refusedPopup;
    const fresh=page.locator('#title .native-player button').filter({hasText:'Start a fresh sign-in'});await fresh.waitFor();
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),previous);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    assert.equal(await page.evaluate(()=>identityCalls.hellos.length),1,'No automatic guest fallback');
    startHold=gate();
    await page.evaluate(()=>{SAVE.readConfirmed=true;SAVE.loaded={v:1,char:{name:'Original loaded character'}};window.originalLoaded=SAVE.loaded;
      NATIVE_PLAYER.profile={status:()=>({pending:false,keyPresent:true,hasRecord:true})};window.originalProfile=NATIVE_PLAYER.profile;
      NATIVE_PLAYER.status={...NATIVE_PLAYER.status,bound:true,verified:true};nativePlayerRender()});
    const popupPromise=page.waitForEvent('popup');await fresh.click();const popup=await popupPromise;await startHold.entered;
    assert.deepEqual(await page.evaluate(()=>({read:SAVE.readConfirmed,sameLoaded:SAVE.loaded===originalLoaded,sameProfile:NATIVE_PLAYER.profile===originalProfile,
      acct:NETWS.acct.id,token:NETWS.token,hellos:identityCalls.hellos.map(message=>message.token||null),begin:document.querySelector('#btn-begin').disabled,continue:document.querySelector('#btn-continue').disabled})),
      {read:false,sameLoaded:true,sameProfile:true,acct:'fixture-fresh-guest',token:GUEST_TOKEN,hellos:[previous,null],begin:true,continue:true});
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access','Fresh transport must not forget native cache');
    const closing=popup.waitForEvent('close');startHold.release();startHold=null;await closing;
    await page.waitForFunction(()=>window.identityTest?.ready);
    assert.equal((await cached(page)).result.ownerDid,owner.subjectDid);
    assert.equal((await cached(page)).result.credential.accessToken,NATIVE_TOKEN);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),APP_TOKEN);
    assert(broadcastMessages.some(message=>message.data.accountId==='fixture-native-account'&&message.data.ownerDid===owner.subjectDid));
    await context.close();
  });
  await check('fresh sign-in cannot clear an active character session or any pending native progress',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'players-reauth');await prepareLive(page);
    const before=await page.evaluate(()=>identityTest.status());
    await page.evaluate(()=>{NATIVE_PLAYER.authRefusal={host:NETWS.host,token:NETWS.token};nativePlayerRender();nativePlayerConnect(true)});
    assert.equal(await page.locator('button').filter({hasText:'Start a fresh sign-in'}).count(),0);
    let state=await page.evaluate(()=>identityTest.status());assert.equal(state.calls.reloadMarker,before.calls.reloadMarker);assert.equal(state.token,GAME_TOKEN);
    assert.equal(state.pending.char.n,9);assert.equal(state.memory.char.n,9);assert.equal(state.calls.links.length,0);
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    await page.evaluate(()=>{GAME.started=false;nativePlayerConnect(true)});
    state=await page.evaluate(()=>identityTest.status());assert.equal(state.token,GAME_TOKEN);assert.equal(state.pending.char.n,9);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),GAME_TOKEN);
    await context.close();
  });
  await check('fresh sign-in refuses an unresolved load and rechecks state while token forgetting is held',async()=>{
    claimMode='fresh-expired';const context=await contextForMobile(),page=await openFixture(context,'connect-expired');await prepareLive(page);
    await page.evaluate(()=>identityTest.coldBoot());
    const refused=page.waitForEvent('popup').then(popup=>popup.isClosed()?null:popup.waitForEvent('close'));
    await page.locator('#title .native-player button').filter({hasText:'I already have an identity'}).click();await refused;
    for(const blocked of ['loading','pending','nativeFlight','profilePending','wiping','started']){
      await page.evaluate(blocked=>{
        nativePlayerRender();
        if(blocked==='profilePending')NATIVE_PLAYER.profile={status:()=>({pending:true,keyPresent:true,hasRecord:true})};
        else if(blocked==='started')GAME.started=true;
        else SAVE[blocked]=blocked==='loading'?{settled:false}:{};
        nativePlayerConnect(true);
      },blocked);
      assert.deepEqual(await page.evaluate(()=>({token:localStorage.getItem('hallowmarch.token.'+location.host),hellos:identityCalls.hellos.length,switching:NATIVE_PLAYER.switching})),
        {token:GAME_TOKEN,hellos:1,switching:false});
      await page.evaluate(()=>{GAME.started=false;SAVE.loading=null;SAVE.pending=null;SAVE.nativeFlight=null;SAVE.wiping=false;NATIVE_PLAYER.profile=null;nativePlayerRender()});
    }
    await page.evaluate(()=>{window.privateReads=0;window.privateWrites=0;window.claude={use:async name=>name==='db'?{doc:()=>({
      get:()=>{privateReads++;return new Promise(resolve=>{window.releasePrivateRead=()=>resolve({exists:true,data:()=>({tokens:{[location.host]:'fixture-initiating-game-account-token'}})})})},
      set:async()=>{privateWrites++},
    })}:{id:async()=> 'fixture-user'}}});
    const opening=page.waitForEvent('popup');await page.locator('#title .native-player button').filter({hasText:'Start a fresh sign-in'}).click();const popup=await opening;
    await page.waitForFunction(()=>privateReads===1);
    await page.evaluate(()=>{SAVE.readConfirmed=true;SAVE.pending={char:{name:'Late current character'}};nativePlayerRender()});
    assert(await page.locator('#btn-begin').isDisabled());assert(await page.locator('#btn-continue').isDisabled());
    const closing=popup.waitForEvent('close');await page.evaluate(()=>releasePrivateRead());await closing;
    await page.waitForFunction(()=>!NATIVE_PLAYER.busy);
    assert.deepEqual(await page.evaluate(()=>({writes:privateWrites,hellos:identityCalls.hellos.length,token:localStorage.getItem('hallowmarch.token.'+location.host),pending:SAVE.pending.char.name,switching:NATIVE_PLAYER.switching})),
      {writes:0,hellos:1,token:GAME_TOKEN,pending:'Late current character',switching:true});
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');
    const loads=await page.evaluate(()=>identityCalls.load);await page.evaluate(()=>{SAVE.pending=null;nativePlayerRetryLoad();nativePlayerRecovery('fixture-passphrase');nativePlayerRestore({size:1},'fixture-passphrase');nativePlayerImport()});
    assert.equal(await page.evaluate(()=>identityCalls.load),loads);assert(await page.locator('#btn-begin').isDisabled());await context.close();
  });
  await check('stalled private token recovery closes its popup and quarantines the late storage result',async()=>{
    claimMode='fresh-expired';const context=await contextForMobile(),page=await openFixture(context,'connect-expired');await prepareLive(page);
    await page.evaluate(()=>{NETWS.token='';NETWS.acct=null});await page.evaluate(()=>identityTest.coldBoot());
    const refused=page.waitForEvent('popup').then(popup=>popup.isClosed()?null:popup.waitForEvent('close'));
    await page.locator('#title .native-player button').filter({hasText:'I already have an identity'}).click();await refused;
    await page.clock.install();
    await page.evaluate(()=>{window.privateReads=0;window.privateWrites=0;window.claude={use:async name=>name==='db'?{doc:()=>({
      get:()=>{privateReads++;return new Promise(resolve=>{window.releasePrivateRead=()=>resolve({exists:true,data:()=>({tokens:{[location.host]:'fixture-initiating-game-account-token'}})})})},
      set:async()=>{privateWrites++},
    })}:{id:async()=> 'fixture-user'}}});
    const opening=page.waitForEvent('popup');await page.locator('#title .native-player button').filter({hasText:'Start a fresh sign-in'}).click();const popup=await opening;
    await page.waitForFunction(()=>privateReads===1);const closed=popup.waitForEvent('close');await page.clock.fastForward(8001);await closed;
    await page.waitForFunction(()=>!NATIVE_PLAYER.busy&&NATIVE_PLAYER.message.includes('did not confirm in time'));
    assert.equal(await page.locator('#title .native-player button').filter({hasText:'Start a fresh sign-in'}).count(),1,'Explicit retry remains available');
    await page.evaluate(async()=>{releasePrivateRead();for(let n=0;n<10;n++)await Promise.resolve()});
    assert.deepEqual(await page.evaluate(()=>({writes:privateWrites,hellos:identityCalls.hellos.length,read:SAVE.readConfirmed,token:localStorage.getItem('hallowmarch.token.'+location.host)})),
      {writes:0,hellos:1,read:false,token:GAME_TOKEN});
    assert.equal((await cached(page)).result.credential.accessToken,'previous-browser-only-access');await context.close();
  });
  for(const mode of ['denied','incomplete','expired','missing-account','mcp-path','mcp-query','mcp-fragment','mcp-userinfo','mcp-http'])await check('claim '+mode+' creates no false browser session',async()=>{
    claimMode=mode;const context=await contextForMobile(),page=await openFixture(context,'connect');
    const before=broadcastMessages.length,popupPromise=page.waitForEvent('popup');await page.locator('#title .native-player button').first().click();const popup=await popupPromise;
    await popup.locator('#return:not([hidden])').waitFor();assert(!(await popup.locator('#status').innerText()).startsWith('Connected.'));
    assert.equal(await popup.evaluate(()=>sessionStorage.getItem('hallowmarch.identity.ceremony.v1')),null);
    assert((await cached(page)).result===null,'A failed claim must not cache a native credential');assert.equal((await cached(page)).entries.length,0);
    assert.equal(broadcastMessages.slice(before).filter(message=>message.direction==='sent').length,0);
    assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),null);
    const geometry=await popup.evaluate(()=>({width:innerWidth,scroll:document.documentElement.scrollWidth,button:document.querySelector('#return').getBoundingClientRect().height}));
    assert(geometry.scroll<=geometry.width+1);assert(geometry.button>=44);await context.close();
  });
  await check('finish without an initiating popup ceremony cannot claim or cache a session',async()=>{
    const context=await contextForMobile(),page=await context.newPage(),claims=calls.filter(call=>call.pathname==='/gaming/identity/claim').length;
    await page.goto(base+'/gaming/identity/finish');await page.locator('#return:not([hidden])').waitFor();
    assert((await page.locator('#status').innerText()).includes('expired'));
    assert.equal(calls.filter(call=>call.pathname==='/gaming/identity/claim').length,claims);
    assert.equal((await cached(page)).entries.length,0);assert.equal(await page.evaluate(()=>localStorage.length),0);await context.close();
  });
  await check('a tampered ceremony host cannot claim, cache or target another game token key',async()=>{
    claimMode='success';startHold=gate();const context=await contextForMobile(),page=await openFixture(context,'connect');
    const claims=calls.filter(call=>call.pathname==='/gaming/identity/claim').length,before=broadcastMessages.length;
    const popupPromise=page.waitForEvent('popup');await page.locator('#title .native-player button').first().click();const popup=await popupPromise;await startHold.entered;
    await popup.evaluate(()=>{const key='hallowmarch.identity.ceremony.v1',ceremony=JSON.parse(sessionStorage.getItem(key));ceremony.host='different-game.example';sessionStorage.setItem(key,JSON.stringify(ceremony))});
    startHold.release();startHold=null;await popup.locator('#return:not([hidden])').waitFor();
    assert((await popup.locator('#status').innerText()).includes('expired'));
    assert.equal(calls.filter(call=>call.pathname==='/gaming/identity/claim').length,claims);assert.equal((await cached(page)).entries.length,0);
    assert.equal(await page.evaluate(()=>localStorage.length),0);assert.equal(broadcastMessages.slice(before).filter(message=>message.direction==='sent').length,0);await context.close();
  });
  for(const view of ['title','players'])await check(view+' mobile native controls fit with 44px buttons, 16px input and retained entry',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,view),selector=view==='title'?'#title .native-player':'#netsheet .native-player';
    const box=page.locator(selector);assert.equal(await box.locator('input[type=password]').count(),0,'recovery setup is deferred until explicitly opened');
    await box.getByRole('button',{name:'Recovery options',exact:true}).click();await box.locator('input[type=password]').fill('a private recovery phrase');
    const geometry=await box.evaluate(node=>({width:innerWidth,scroll:document.documentElement.scrollWidth,box:node.getBoundingClientRect().width,
      buttons:[...node.querySelectorAll('button')].map(button=>({height:button.getBoundingClientRect().height,width:button.getBoundingClientRect().width})),
      inputSize:parseFloat(getComputedStyle(node.querySelector('input[type=password]')).fontSize)}));
    assert(geometry.scroll<=geometry.width+1,JSON.stringify(geometry));assert(geometry.box<=390);assert(geometry.buttons.every(button=>button.height>=44&&button.width>=44));assert(geometry.inputSize>=16,'recovery input must avoid iOS focus zoom');
    await page.evaluate(()=>identityTest.render());assert.equal(await box.locator('input[type=password]').inputValue(),'a private recovery phrase');
    await page.evaluate(()=>identityTest.changed());assert.equal(await box.locator('input[type=password]').inputValue(),'a private recovery phrase','normal save-status refresh must preserve entered recovery text');
    await context.close();
  });
  await check('unread private character blocks both entry buttons and offers a safe connection retry',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'title');
    await page.evaluate(()=>{SAVE.readConfirmed=false;NATIVE_PLAYER.state='key_required';nativePlayerRender()});
    assert(await page.locator('#btn-begin').isDisabled());assert(await page.locator('#btn-continue').isDisabled());
    assert.equal(await page.locator('#title .native-player button').filter({hasText:'Retry connection'}).count(),1);
    const before=await page.evaluate(()=>identityCalls.reloadMarker);
    await page.locator('#title .native-player').getByRole('button',{name:'Retry connection',exact:true}).click();
    await page.waitForFunction(()=>identityCalls.load===1);
    assert.equal(await page.evaluate(()=>identityCalls.reloadMarker),before,'startup retry must retain the browser and its held key');
    assert.deepEqual(await page.evaluate(()=>({retry:identityCalls.retry,save:identityCalls.save,load:identityCalls.load})),{retry:0,save:0,load:1});
    await context.close();
  });
  await check('playing retry preserves pending progress and never reloads the page',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'players');
    await page.evaluate(()=>{GAME.started=true;GAME.player={};SAVE.pending={privateProgress:'retained-in-memory'};NATIVE_PLAYER.state='pod_pending';nativePlayerRender()});
    const url=page.url(),box=page.locator('#netsheet .native-player');
    await box.getByRole('button',{name:'Recovery options',exact:true}).click();
    await box.getByRole('button',{name:'Retry pod save',exact:true}).click();
    await page.waitForFunction(()=>identityCalls.retry===1&&identityCalls.save===1);
    assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>SAVE.pending.privateProgress),'retained-in-memory');
    await context.close();
  });
  await check('retained QA startup action uses the real owner title retry without navigation or private publication',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'title');
    await page.evaluate(()=>{SAVE.readConfirmed=false;window.__hm={ready:true,GAME,SAVE,net:{NETWS},nativePlayerStatus:()=>({profileStatus:{pending:false}})};nativePlayerRender()});
    const marker=await page.evaluate(()=>identityCalls.reloadMarker);
    assert.deepEqual(await retryNativeStartup({page,expectedAccountId:'fixture-account',gameOrigin:base}),{kind:'native_startup_retry',clicked:true,alreadyConfirmed:false});
    await page.waitForFunction(()=>identityCalls.load===1);
    assert.equal(await page.evaluate(()=>identityCalls.reloadMarker),marker);
    assert.deepEqual(await page.evaluate(()=>({loads:identityCalls.load,writes:identityCalls.save,retries:identityCalls.retry})),{loads:1,writes:0,retries:0});
    await context.close();
  });
  await check('explicit logout clears an existing cache before profile/cache UI initialization',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'players-uninitialized');
    await page.evaluate(async owner=>{const {createBrowserAccessCache}=await import('/gaming/identity/assets/access-cache.mjs');const cache=createBrowserAccessCache();
      await cache.put({relayUrl:'https://relay.example',ownerDid:owner.subjectDid,podUrl:owner.podUrl,credential:{kind:'relay-oauth-bearer',accessToken:'fixture-cached-access-before-ui-initialization',method:'webauthn',expiresAt:Date.now()+600000,refreshToken:null}});await cache.close();},owner);
    assert.deepEqual(await page.evaluate(()=>identityTest.status()),{cacheInitialized:false,profileInitialized:false});
    assert.equal((await cached(page)).entries.length,1);await page.evaluate(token=>localStorage.setItem('hallowmarch.token.'+location.host,token),APP_TOKEN);
    const reloaded=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());await page.locator('#netsheet-acct [data-act="acct-out"]').click();await reloaded;
    await page.waitForFunction(()=>window.identityTest?.ready);
    assert.equal((await cached(page)).entries.length,0);assert.equal(await page.evaluate(()=>localStorage.getItem('hallowmarch.token.'+location.host)),null);await context.close();
  });
  assert(urls.every(url=>!url.includes(NATIVE_TOKEN)));assert(consoleMessages.every(message=>!message.includes(NATIVE_TOKEN)));
  assert(foreignRequests.every(url => !url.includes(GAME_TOKEN) && !url.includes(NATIVE_TOKEN)));
  assert(!urls.some(url=>/refresh_token|grant_type=refresh_token/.test(url)));
  if(failures.length)throw Error(JSON.stringify(failures));
  console.log('PASS native bearer absent from URLs/localStorage/console; no refresh exchange or live identity provisioning.');
} finally { callbackBridge.close();await browser.close();await Promise.all([new Promise(resolve=>server.close(resolve)),new Promise(resolve=>foreignServer.close(resolve))]); }
