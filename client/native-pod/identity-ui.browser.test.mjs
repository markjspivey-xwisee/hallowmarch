/** Real popup/cache/mobile DOM flow. Identity claim responses are explicit fixtures. */
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';
if (!process.env.HM_PLAYWRIGHT_MODULE) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GAME_TOKEN = 'fixture-initiating-game-account-token';
const GUEST_TOKEN = 'fixture-explicit-fresh-transport-token';
const INVALID_TOKEN = 'fixture-invalid-old-game-proof';
const APP_TOKEN = 'fixture-native-game-app-session-token';
const NATIVE_TOKEN = 'fixture-native-relay-access-token-kept-only-in-browser-987654321';
const owner = { userId: 'u-pk-fixture001', subjectDid: 'did:web:identity.example:users:u-pk-fixture001', podUrl: 'https://pod.example/u-pk-fixture001/' };
const calls = [], urls = [], consoleMessages = [], broadcastMessages = [];
let claimMode = 'success', startHold = null;
function gate() { let enter, release; return { entered: new Promise(resolve => { enter = resolve; }),
  wait: new Promise(resolve => { release = resolve; }), enter: () => enter(), release: () => release() }; }
const assets = createPlayerBrowserAssets();
async function fixturePage(view) {
  // Use actual game CSS, title markup, Players account renderer and native UI.
  const page = await fs.readFile(path.join(root, 'src/page.html'), 'utf8');
  const styles = page.match(/<style>([\s\S]*?)<\/style>/)[1];
  const title = page.slice(page.indexOf('<div id="title" hidden>'), page.indexOf('<div id="hud" hidden>'))
    .replace('<div id="title" hidden>', '<div id="title">');
  const native = await fs.readFile(path.join(root, 'src/14v_nativeidentity.js'), 'utf8');
  const saves = await fs.readFile(path.join(root, 'src/12_save.js'), 'utf8');
  const nativeSaves = saves.slice(saves.indexOf('function nativeSavePending()'), saves.indexOf('// a slow heartbeat:'));
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
const NET={link:{kind:'ws'},peers:new Map(),party:null};const UI={modal:null};const BUILD={mode:false};
const identityCalls={retry:0,save:0,reauthenticate:0,saved:[],links:[],hellos:[],reloadMarker:crypto.randomUUID()};
let resumeRelease=null,resumeGate=null,writeRelease=null,writeGate=null,reauthConflict=false;
const typing=()=>true,validSave=value=>value;
${cold ? `window.__HM_NET_SERVER='ws://'+location.host+'/ws';
const netNote=()=>{},netStr=(value,n)=>String(value).slice(0,n);
window.WebSocket=class {constructor(){this.readyState=0;queueMicrotask(()=>{this.readyState=1;this.onopen?.({})})}
send(raw){const message=JSON.parse(raw);if(message.t!=='hello')return;identityCalls.hellos.push(message);queueMicrotask(()=>this.onmessage?.({data:JSON.stringify(message.token?{t:'denied',why:'native_signin_required'}:{t:'welcome',v:1,peer:'fixture-fresh-peer',token:${JSON.stringify(GUEST_TOKEN)},acct:{id:'fixture-fresh-guest',guest:true},world:{k:[]}})}))}
close(){this.readyState=3;this.onclose?.({code:1008,reason:'native_signin_required'})}};` : `const netServerUrl=()=>location.origin,netLinkWS=async()=>{identityCalls.links.push(NETWS.token);return true};`}
const CAPTURE={on:false},buildSave=()=>structuredClone(fixtureMemory),coreKey=value=>JSON.stringify(value),withTimeout=(promise,ms)=>Promise.race([promise,new Promise(resolve=>setTimeout(()=>resolve(null),ms))]);
${nativeSaves}
if(!${live})saveNow=async()=>{identityCalls.save++};
${players}
${native}
${logout}
NATIVE_PLAYER.status={enabled:true,bound:${bound},verified:${bound},recordLinks:{},binding:${JSON.stringify(owner)}};
if(${bound}&&${JSON.stringify(view)}!=='players-uninitialized')NATIVE_PLAYER.profile={status:()=>({hasRecord:${live},keyPresent:true,pending:false,linked:false}),retry:async()=>{identityCalls.retry++},exportRecovery:async()=>({}),close:()=>{},
reauthenticate:async()=>{identityCalls.reauthenticate++;if(resumeGate)await resumeGate;if(reauthConflict)throw Object.assign(Error('The original native head changed.'),{code:'conflict'});return{readConfirmed:true,keyPresent:true}},
set:async value=>{identityCalls.save++;identityCalls.saved.push(structuredClone(value));if(writeGate)await writeGate}};
SAVE.ref={set:value=>NATIVE_PLAYER.profile.set(value)};
netUiOn();netAcctRender();nativePlayerRender();
if(${JSON.stringify(view)}.startsWith('players')){$('title').hidden=true;$('netsheet').hidden=false;NETUI.open=true;UI.modal='net'}
window.identityTest={ready:true,render(){nativePlayerRender()},changed(){NATIVE_PLAYER.state='saving';NATIVE_PLAYER.message='Native save status updated';nativePlayerRender()},
async coldBoot(token=${JSON.stringify(GAME_TOKEN)}){localStorage.setItem('hallowmarch.token.'+location.host,token);return netLinkWS()},
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
    if (['/gaming/identity/start', '/gaming/identity/claim'].includes(url.pathname)) {
      let body = ''; for await (const chunk of req) body += chunk;
      calls.push({ pathname: url.pathname, method: req.method, authorization: req.headers.authorization, body: JSON.parse(body) });
      assert.equal(req.method, 'POST');
      assert.deepEqual(JSON.parse(body), { ownerPodWriteAccess: true });
      if (claimMode.startsWith('fresh-') && req.headers.authorization !== 'Bearer ' + GUEST_TOKEN) {
        assert.equal(url.pathname,'/gaming/identity/start');
        assert.equal(req.headers.authorization,'Bearer '+(claimMode==='fresh-invalid'?INVALID_TOKEN:GAME_TOKEN));
        res.writeHead(401,{'Content-Type':'application/json'});res.end(JSON.stringify({error:'game_account_required'}));return;
      }
      assert.equal(req.headers.authorization, 'Bearer ' + (claimMode.startsWith('fresh-')?GUEST_TOKEN:GAME_TOKEN));
      if (url.pathname.endsWith('/start')) {
        if (startHold) { startHold.enter(); await startHold.wait; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authorizationUrl: 'http://127.0.0.1:' + server.address().port + '/gaming/identity/finish' })); return;
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
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
const failures = [];
async function check(name, run) { try { await run(); console.log('PASS ' + name); } catch (error) { failures.push({ name, message: error.message }); console.error('FAIL ' + name + ': ' + error.message); }
  finally { if(startHold){startHold.release();startHold=null;} } }
async function contextForMobile() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
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
try {
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
    await page.locator('#title .native-player button').filter({hasText:'Connect identity'}).click();await refusedPopup;
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
  await check('stalled private token recovery closes its popup and quarantines the late storage result',async()=>{
    claimMode='fresh-expired';const context=await contextForMobile(),page=await openFixture(context,'connect-expired');await prepareLive(page);
    await page.evaluate(()=>{NETWS.token='';NETWS.acct=null});await page.evaluate(()=>identityTest.coldBoot());
    const refused=page.waitForEvent('popup').then(popup=>popup.isClosed()?null:popup.waitForEvent('close'));
    await page.locator('#title .native-player button').filter({hasText:'Connect identity'}).click();await refused;
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
    const box=page.locator(selector);await box.locator('input[type=password]').fill('a private recovery phrase');
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
    const navigation=page.waitForEvent('framenavigated',frame=>frame===page.mainFrame());
    await page.locator('#title .native-player button').filter({hasText:'Retry pod save'}).click();await navigation;
    await page.waitForFunction(()=>window.identityTest?.ready);assert.deepEqual(await page.evaluate(()=>({retry:identityCalls.retry,save:identityCalls.save})),{retry:0,save:0});
    await context.close();
  });
  await check('playing retry preserves pending progress and never reloads the page',async()=>{
    const context=await contextForMobile(),page=await openFixture(context,'players');
    await page.evaluate(()=>{GAME.started=true;GAME.player={};SAVE.pending={privateProgress:'retained-in-memory'};NATIVE_PLAYER.state='pod_pending';nativePlayerRender()});
    const url=page.url();await page.locator('#netsheet .native-player button').filter({hasText:'Retry pod save'}).click();
    await page.waitForFunction(()=>identityCalls.retry===1&&identityCalls.save===1);
    assert.equal(page.url(),url);assert.equal(await page.evaluate(()=>SAVE.pending.privateProgress),'retained-in-memory');
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
  assert(!urls.some(url=>/refresh_token|grant_type=refresh_token/.test(url)));
  if(failures.length)throw Error(JSON.stringify(failures));
  console.log('PASS native bearer absent from URLs/localStorage/console; no refresh exchange or live identity provisioning.');
} finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
