/** Real Chromium/IndexedDB/WebCrypto custody tests; synthetic access tokens, no remote calls. */
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { readFile } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';
if (!process.env.HM_PLAYWRIGHT_MODULE) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const root = path.dirname(fileURLToPath(import.meta.url));
const requests = [];
const server = http.createServer(async (req, res) => {
  requests.push({ method: req.method, url: req.url });
  if (req.url === '/') {
    res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Browser access cache verification</title><script type="module">
import {createBrowserAccessCache} from './access-cache.mjs';
window.createBrowserAccessCache=createBrowserAccessCache;
window.clock=1800000000000;
window.binding={relayUrl:'https://relay.example',ownerDid:'did:web:identity.example:users:alice',podUrl:'https://pod.example/alice/'};
window.cache=createBrowserAccessCache({now:()=>clock});
window.credential=()=>({kind:'relay-oauth-bearer',accessToken:'fixture-'+crypto.randomUUID()+crypto.randomUUID(),method:'webauthn',expiresAt:clock+60000,refreshToken:null,clientId:'fixture'});
window.hash=async text=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('');
window.db=async(name,stores,mode,run)=>new Promise((resolve,reject)=>{const request=indexedDB.open(name);request.onsuccess=()=>{const database=request.result;const tx=database.transaction(stores,mode);let value;run(tx,next=>{value=next});tx.oncomplete=()=>{database.close();resolve(value)};tx.onabort=()=>reject(Error('fixture db abort'))}});
window.gatedCrypto=method=>{let release,entered;const blocked=new Promise(resolve=>{entered=resolve}),gate=new Promise(resolve=>{release=resolve});let active=true;
return {blocked,release,host:{randomUUID:crypto.randomUUID.bind(crypto),getRandomValues:crypto.getRandomValues.bind(crypto),subtle:new Proxy(crypto.subtle,{get(target,key){if(key===method)return async(...args)=>{if(active){active=false;entered();await gate}return target[key](...args)};const value=target[key];return typeof value==='function'?value.bind(target):value}})}}};
window.loaded=true;
</script>`); return;
  }
  try {
    const filename = path.resolve(root, '.' + req.url);
    if (!filename.startsWith(root + path.sep) || !filename.endsWith('.mjs')) throw Error();
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(filename));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(); const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const url = 'http://127.0.0.1:' + server.address().port;
  await page.goto(url); await page.waitForFunction(() => window.loaded);
  const original = await page.evaluate(async () => {
    const secret = credential(); const info = await cache.put({...binding,credential:secret});
    const stored = await db('interego-browser-access-v1',['sessions','keys'],'readonly',(tx,done)=>{
      const s=tx.objectStore('sessions').getAll(),k=tx.objectStore('keys').getAll();let sessions,keys;
      const finish=()=>{if(sessions&&keys)done({sessions,keys})};s.onsuccess=()=>{sessions=s.result;finish()};k.onsuccess=()=>{keys=k.result;finish()};
    });
    return {hash:await hash(secret.accessToken),metadataOnly:!JSON.stringify(info).includes(secret.accessToken),
      encrypted:!JSON.stringify(stored).includes(secret.accessToken),extractable:stored.keys[0].wrappingKey.extractable,
      secretFields:Object.keys(stored.keys[0]),rows:(await cache.list({relayUrl:binding.relayUrl})).length};
  });
  assert(original.metadataOnly && original.encrypted); assert.equal(original.extractable, false); assert.equal(original.rows, 1);
  assert(!original.secretFields.includes('secretKey'));
  await page.reload(); await page.waitForFunction(() => window.loaded);
  assert.equal(await page.evaluate(async () => hash((await cache.get(binding)).credential.accessToken)), original.hash);
  console.log('PASS encrypted access session reload with actual IndexedDB nonextractable CryptoKey custody.');

  assert.deepEqual(await page.evaluate(async () => {
    const bob={...binding,ownerDid:'did:web:identity.example:users:bob',podUrl:'https://pod.example/bob/'};
    const other=await cache.get(bob),otherRelay=await cache.get({...binding,relayUrl:'https://other-relay.example'});
    let refreshRejected=false;try{await cache.put({...binding,credential:{...credential(),refreshToken:'fixture-not-retained'}})}catch(e){refreshRejected=e.code==='invalid_credential'}
    return {other,otherRelay,refreshRejected,stillPresent:!!await cache.get(binding)};
  }), {other:null,otherRelay:null,refreshRejected:true,stillPresent:true});
  console.log('PASS exact owner/pod/relay isolation and refusal of refresh-token custody.');

  assert.equal(await page.evaluate(async () => {
    await db('interego-browser-access-v1',['sessions'],'readwrite',(tx,done)=>{const s=tx.objectStore('sessions'),r=s.openCursor();r.onsuccess=()=>{const c=r.result;if(!c){done();return}const value=c.value;value.expiresAt+=3600000;c.update(value);done()}});
    return await cache.get(binding);
  }), null);
  assert.equal(await page.evaluate(async () => (await cache.list()).length), 0);
  console.log('PASS forged outer expiry cannot extend the encrypted credential lifetime.');

  assert.equal(await page.evaluate(async () => {
    await cache.put({...binding,credential:credential()});
    await db('interego-browser-access-v1',['sessions'],'readwrite',(tx,done)=>{const s=tx.objectStore('sessions'),r=s.openCursor();r.onsuccess=()=>{const c=r.result;const value=c.value;const ciphertext=value.envelope.content.ciphertext;value.envelope.content.ciphertext=(ciphertext[0]==='A'?'B':'A')+ciphertext.slice(1);c.update(value);done()}});
    return cache.get(binding);
  }), null);
  console.log('PASS ciphertext tampering refuses restoration without a plaintext fallback.');

  assert.deepEqual(await page.evaluate(async () => {
    await cache.put({...binding,credential:credential()});
    clock+=60001;const expired=await cache.get(binding);
    const count=await db('interego-browser-access-v1',['sessions','keys'],'readonly',(tx,done)=>{const s=tx.objectStore('sessions').count(),k=tx.objectStore('keys').count();let a,b;const finish=()=>{if(a!==undefined&&b!==undefined)done([a,b])};s.onsuccess=()=>{a=s.result;finish()};k.onsuccess=()=>{b=k.result;finish()}});
    return {expired,count};
  }), {expired:null,count:[0,0]});
  console.log('PASS expiry removes both cached envelope and wrapping-key record.');

  assert.deepEqual(await page.evaluate(async () => {
    const gate=gatedCrypto('encrypt'),slow=createBrowserAccessCache({now:()=>clock,crypto:gate.host});
    const work=slow.put({...binding,credential:credential()}).then(()=>({ok:true}),error=>({code:error.code}));
    await gate.blocked;await cache.forget(binding);gate.release();const result=await work;
    const count=await db('interego-browser-access-v1',['sessions','keys'],'readonly',(tx,done)=>{const s=tx.objectStore('sessions').count(),k=tx.objectStore('keys').count();let a,b;const finish=()=>{if(a!==undefined&&b!==undefined)done([a,b])};s.onsuccess=()=>{a=s.result;finish()};k.onsuccess=()=>{b=k.result;finish()}});
    await slow.close();return {result,count,loaded:await cache.get(binding)};
  }), {result:{code:'changed'},count:[0,0],loaded:null});
  console.log('PASS forgetting defeats an in-flight encrypted write across separate cache instances.');

  assert.equal(await page.evaluate(async () => {
    await cache.put({...binding,credential:credential()});const gate=gatedCrypto('decrypt'),slow=createBrowserAccessCache({now:()=>clock,crypto:gate.host});
    const work=slow.get(binding);await gate.blocked;await cache.forget(binding);gate.release();const result=await work;await slow.close();return result;
  }), null);
  console.log('PASS forgetting defeats an in-flight decryption before it can return an access token.');

  assert.equal(await page.evaluate(async () => {
    const gate=gatedCrypto('encrypt'),slow=createBrowserAccessCache({now:()=>clock,crypto:gate.host});
    const old=slow.put({...binding,credential:credential()}).then(()=>false,error=>error.code==='changed');await gate.blocked;
    const newer=credential();await cache.put({...binding,credential:newer});gate.release();const rejected=await old;
    const preserved=(await cache.get(binding)).credential.accessToken===newer.accessToken;await slow.close();return rejected&&preserved;
  }), true);
  console.log('PASS a superseded write cannot replace or delete a newer cached grant.');

  assert.deepEqual(await page.evaluate(async () => {
    await cache.forgetAll();const empty=(await cache.list()).length===0;await cache.close();let closed=false;
    try{await cache.get(binding)}catch(error){closed=error.code==='closed'}return{empty,closed};
  }), {empty:true,closed:true});
  assert.deepEqual(errors, []);
  assert(requests.every(request => request.method === 'GET'));
  console.log('PASS explicit forgetAll/close, no cache operation sent any network request.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
