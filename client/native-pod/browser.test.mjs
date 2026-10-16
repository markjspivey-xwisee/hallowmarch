/** Actual Chromium IndexedDB/WebCrypto/module reload; native HTTP contracts are fixtures. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const playwright = process.env.HM_PLAYWRIGHT_MODULE;
if (!playwright) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright module.');
const { chromium } = await import(pathToFileURL(playwright));
const root = path.dirname(fileURLToPath(import.meta.url));
const names = ['get_pod_status', 'get_current_head', 'get_descriptor', 'get_encrypted_graph', 'register_agent', 'publish_context'];
const ownerDid = 'did:web:identity.example:users:alice', pod = 'https://pod.example/alice/';
const agents = new Map(), heads = new Map(), records = new Map(); let n = 0;
const IEP = 'https://markjspivey-xwisee.github.io/interego/ns/iep#';
const fixtureErrors = [];
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/mcp') {
      assert.equal(req.headers.authorization, 'Bearer fixture-alice');
      let body = ''; for await (const chunk of req) body += chunk;
      const request = JSON.parse(body), args = request.params.arguments || {}; let payload;
      if (request.method === 'tools/list') payload = { tools: names.map(name => ({ name })) };
      else {
        const name = request.params.name;
        if (name === 'get_pod_status') payload = { pod, userId: 'alice', identity: { did: ownerDid }, sessionAgent: { did: 'did:web:identity.example:agents:session-alice' } };
        else if (name === 'register_agent') { agents.set(args.agent_id, args.encryption_public_key); payload = { agent: args.agent_id, scope: args.scope }; }
        else if (name === 'get_current_head') payload = { urn: args.urn, podUrl: pod, head: heads.get(args.urn) || null, message: 'Fixture head.' };
        else if (name === 'get_descriptor' && args.url === pod + 'agents') payload = { turtle: [...agents].map(([agent, key], i) => `<urn:agent:${i}> <${IEP}agentIdentity> <${agent}> ; <${IEP}encryptionPublicKey> "${key}" .`).join('\n') };
        else if (name === 'publish_context') {
          assert.equal(args.sealed_payload, true); assert(!args.graph_content.includes('private browser record'));
          if (args.if_match && args.if_match !== heads.get(args.graph_iri)?.cid) payload = { error: 'conflict', code: 412 };
          else {
            const head = { descriptorUrl: pod + 'context-graphs/' + (++n) + '.ttl', cid: 'fixture-cid-' + n };
            records.set(head.descriptorUrl, args); heads.set(args.graph_iri, head); payload = { status: 'published', published: true, descriptorUrl: head.descriptorUrl };
          }
        } else if (name === 'get_descriptor') payload = { turtle: `<urn:proof> <${IEP}contentHash> "${records.get(args.url).content_digest}" .`, authorship: { authorshipVerified: true, descriptorBinding: { bound: true } } };
        else if (name === 'get_encrypted_graph') payload = { url: args.url, encrypted: true, envelope: records.get(args.url).graph_content };
        else throw Error('Unexpected fixture tool');
        payload = { structuredContent: payload };
      }
      res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ jsonrpc: '2.0', id: request.id, result: payload })); return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'content-type': 'text/html' }); res.end(`<!doctype html><title>Native owner client verification</title><script type="module">
import {createNativePodClient} from './client.mjs';
import {createPlayerPodProfile} from './profile.mjs';
import {RelayMcpTransport} from './vendor/interego-browser.mjs';
const credential={kind:'relay-oauth-bearer',accessToken:'fixture-alice',method:'webauthn',expiresAt:Date.now()+3600000,refreshToken:null,clientId:'fixture'};
window.client=createNativePodClient({relayUrl:'https://relay.example',credential,ownerDid:${JSON.stringify(ownerDid)},podUrl:${JSON.stringify(pod)},transport:new RelayMcpTransport(location.origin,credential,fetch.bind(window))});
window.ready=client.connect();
window.bridgeRequests=[];
window.makeProfile=(options={})=>createPlayerPodProfile({binding:{subjectDid:${JSON.stringify(ownerDid)},podUrl:${JSON.stringify(pod)}},
relayUrl:'https://relay.example',credential,createClient:args=>createNativePodClient({...args,transport:new RelayMcpTransport(location.origin,credential,fetch.bind(window))}),
request:async(url,init)=>{if(options.noGameBridge)throw Error('Fixture game cache is unavailable');
if(url!=='/gaming/identity/record-link'||Object.keys(init.body).sort().join(',')!=='cid,descriptorUrl,graphIri,kind')throw Error('Private body reached game bridge');
window.bridgeRequests.push({url,...init});return{linked:true}}});
</script>`); return;
    }
    const filename = path.resolve(root, '.' + req.url);
    if (!filename.startsWith(root + path.sep) || !filename.endsWith('.mjs')) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/javascript' }); res.end(await readFile(filename));
  } catch (error) { fixtureErrors.push(error.message); res.writeHead(500); res.end('Native contract fixture refused request.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
const errors = [];
try {
  const context = await browser.newContext(), page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.waitForFunction(() => window.ready);
  assert.equal((await page.evaluate(() => ready)).keyPresent, false);
  const key = await page.evaluate(() => client.createKey());
  const saved = await page.evaluate(() => client.create({ record: { text: 'private browser record', v: 1 } }));
  assert.equal(saved.status, 'saved');
  const stored = await page.evaluate(async () => {
    const request = indexedDB.open('interego-client-keys-v1'); const db = await new Promise(resolve => request.onsuccess = () => resolve(request.result));
    const get = db.transaction('keys').objectStore('keys').getAll(); const values = await new Promise(resolve => get.onsuccess = () => resolve(get.result));
    db.close(); return { count: values.length, extractable: values[0].wrappingKey.extractable, ciphertextBytes: values[0].ciphertext.byteLength };
  });
  assert.deepEqual(stored, { count: 1, extractable: false, ciphertextBytes: 48 });
  await page.reload(); await page.waitForFunction(() => window.ready);
  assert.equal((await page.evaluate(() => ready)).keyPresent, true);
  assert.equal((await page.evaluate(() => client.registerKey())).publicKey, key.publicKey);
  assert.equal((await page.evaluate(graphIri => client.load({ graphIri }), saved.graphIri)).record.text, 'private browser record');
  const backup = await page.evaluate(() => client.exportRecovery('browser verification passphrase'));
  const fresh = await browser.newContext(), restored = await fresh.newPage();
  await restored.goto('http://127.0.0.1:' + server.address().port); await restored.waitForFunction(() => window.ready);
  assert.equal((await restored.evaluate(() => ready)).keyPresent, false);
  assert.equal((await restored.evaluate(backup => client.restoreRecovery(backup, 'browser verification passphrase'), backup)).publicKey, key.publicKey);
  assert.equal((await restored.evaluate(graphIri => client.load({ graphIri }), saved.graphIri)).record.v, 1);
  const profile = await page.evaluate(async () => {
    window.profile=makeProfile(); await profile.connect();
    await profile.set({v:1,char:{name:'private browser record in profile',level:1},n:17});
    return profile.status();
  });
  assert.equal(profile.indexed,true);assert(heads.has(profile.indexGraphIri));assert(heads.has(profile.profileGraphIri));
  const indexHead=heads.get(profile.indexGraphIri),graphCount=heads.size;
  const wireIndex=records.get(indexHead.descriptorUrl);assert.equal(wireIndex.sealed_payload,true);
  assert(!wireIndex.graph_content.includes(profile.profileGraphIri),'profile discovery target is also client-sealed');
  await page.reload();await page.waitForFunction(()=>window.ready);
  assert.equal(await page.evaluate(async()=>{window.profile=makeProfile({noGameBridge:true});const result=await profile.connect();
    const found=await profile.get();return result.hasRecord&&found.exists&&found.data().n===17&&bridgeRequests.length===0}),true);
  assert.deepEqual(heads.get(profile.indexGraphIri),indexHead);assert.equal(heads.size,graphCount,'reload never rewrites the index');
  const empty=await browser.newContext(), recoveryPage=await empty.newPage();
  await recoveryPage.goto('http://127.0.0.1:'+server.address().port);await recoveryPage.waitForFunction(()=>window.ready);
  const beforeRecovery=await recoveryPage.evaluate(async()=>{
    window.profile=makeProfile({noGameBridge:true});const connected=await profile.connect();let getCode,keyCode;
    try{await profile.get()}catch(error){getCode=error.code}try{await profile.createKey()}catch(error){keyCode=error.code}
    return{hasRecord:connected.hasRecord,keyPresent:connected.keyPresent,getCode,keyCode};
  });
  assert.deepEqual(beforeRecovery,{hasRecord:true,keyPresent:false,getCode:'key_required',keyCode:'recovery_required'});
  assert.equal(await recoveryPage.evaluate(async backup=>{
    await profile.restoreRecovery(backup,'browser verification passphrase');const found=await profile.get();
    return found.exists&&found.data().n===17&&found.data().char.name==='private browser record in profile'&&bridgeRequests.length===0;
  },backup),true);
  assert.deepEqual(heads.get(profile.indexGraphIri),indexHead);assert.equal(heads.size,graphCount);
  assert.deepEqual(errors, []);
  console.log('PASS Chromium: real IndexedDB CryptoKey custody, sealed profile + owner index, no-hint reload/discovery, key-required fresh browser, encrypted recovery without a game cache. Relay storage/authorship are explicit fixtures.');
} catch (error) { if (fixtureErrors.length) console.error('Contract fixture errors:', fixtureErrors); throw error; }
finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
