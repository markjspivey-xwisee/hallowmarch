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
  const websocket = await fs.readFile(path.join(root, 'src/14p_netws.js'), 'utf8');
  const logout = websocket.slice(websocket.indexOf('async function netAcctOut()'), websocket.indexOf('// A remote reference'));
  // The footer registers world lore/debug globals outside this isolated UI host.
  // Keep the real UI functions; omit that unrelated module initialization only.
  const players = (await fs.readFile(path.join(root, 'src/14o_netui.js'), 'utf8')).split('Object.assign(FIELD_NOTES,')[0];
  const bound = view !== 'connect';
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Native identity UI verification</title><style>${styles}</style><body class="touch">${title}<div id="hud" hidden></div><script>
const $=id=>document.getElementById(id),IS_TOUCH=true;
const NETWS={token:${JSON.stringify(GAME_TOKEN)},host:location.host,acct:{id:'fixture-account',guest:false,name:'Fixture player',nativeBound:${bound}}};
const SAVE={native:${bound},backend:'local',loaded:null,pending:false,readConfirmed:${bound}};const GAME={started:false,player:null};
const NET={link:{kind:'ws'},peers:new Map(),party:null};const UI={modal:null};const BUILD={mode:false};
const identityCalls={retry:0,save:0};
const typing=()=>true,netServerUrl=()=>location.origin,netLinkWS=async()=>true,saveNow=async()=>{identityCalls.save++},validSave=value=>value;
${players}
${native}
${logout}
NATIVE_PLAYER.status={enabled:true,bound:${bound},verified:${bound},recordLinks:{},binding:${JSON.stringify(owner)}};
if(${bound}&&${JSON.stringify(view)}!=='players-uninitialized')NATIVE_PLAYER.profile={status:()=>({hasRecord:false,keyPresent:true,pending:false,linked:false}),retry:async()=>{identityCalls.retry++},exportRecovery:async()=>({}),close:()=>{}};
netUiOn();netAcctRender();nativePlayerRender();
if(${JSON.stringify(view)}.startsWith('players')){$('title').hidden=true;$('netsheet').hidden=false;NETUI.open=true;UI.modal='net'}
window.identityTest={ready:true,render(){nativePlayerRender()},changed(){NATIVE_PLAYER.state='saving';NATIVE_PLAYER.message='Native save status updated';nativePlayerRender()},
status:()=>({cacheInitialized:!!NATIVE_PLAYER.cache,profileInitialized:!!NATIVE_PLAYER.profile})};
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
      assert.equal(req.method, 'POST'); assert.equal(req.headers.authorization, 'Bearer ' + GAME_TOKEN);
      assert.deepEqual(JSON.parse(body), { ownerPodWriteAccess: true });
      if (url.pathname.endsWith('/start')) {
        if (startHold) { startHold.enter(); await startHold.wait; }
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ authorizationUrl: 'http://127.0.0.1:' + server.address().port + '/gaming/identity/finish' })); return;
      }
      if (claimMode === 'denied') { res.writeHead(403, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ error: 'fixture_claim_denied' })); return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ binding: owner, appSession: { token: APP_TOKEN, acct: claimMode === 'missing-account' ? undefined : { id: 'fixture-native-account' } }, nativeSession: {
        mcpUrl: 'https://relay.example/mcp', accessToken: claimMode === 'incomplete' ? undefined : NATIVE_TOKEN,
        expiresAt: new Date(Date.now() + (claimMode === 'expired' ? -1000 : 600000)).toISOString(),
      } })); return;
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
try {
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
  for(const mode of ['denied','incomplete','expired','missing-account'])await check('claim '+mode+' creates no false browser session',async()=>{
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
    await page.waitForFunction(()=>window.identityTest?.ready);assert.deepEqual(await page.evaluate(()=>identityCalls),{retry:0,save:0});
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
