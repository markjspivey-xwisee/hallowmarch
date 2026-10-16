/** Real Chromium modules and SDK parsers/transport. Native ownership reports/storage are explicit fixtures. */
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { publicRecordFixture, binding } from './public-record.fixture.mjs';
if (!process.env.HM_PLAYWRIGHT_MODULE) throw Error('Set HM_PLAYWRIGHT_MODULE to installed Playwright.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
// Match native OAuth/get_current_head asymmetry: status.pod is identity's
// canonical URL, while named-head and publish use the relay's authenticated CSS.
const root = path.dirname(fileURLToPath(import.meta.url)), fixture = publicRecordFixture({ css: 'http://css.railway.internal:3456/' }), requests = [];
const input = { publicDisclosureAccepted: true, actor: 'did:web:identity.example:agents:companion', roomId: 'expedition', entityId: 'body-pet-alice',
  role: 'pet', actions: ['observe', 'move', 'attack'], maxCommandsPerSecond: 10, lifetimeMs: 600_000 };
const server = http.createServer(async (req, res) => {
  requests.push({ url: req.url, authorization: req.headers.authorization });
  try {
    if (req.url === '/mcp') {
      assert.equal(req.headers.authorization, 'Bearer fixture-owner-bearer');
      let body = ''; for await (const chunk of req) body += chunk;
      const response = await fixture.mcpFetch('fixture', { body });
      res.writeHead(200, Object.fromEntries(response.headers)); res.end(await response.text()); return;
    }
    if (req.url.startsWith('/public/')) {
      assert.equal(req.headers.authorization, undefined);
      const response = await fixture.anonymousFetch('https://pod.example/' + req.url.slice(8), { credentials: 'omit' });
      res.writeHead(response.status); res.end(await response.text()); return;
    }
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' }); res.end(`<!doctype html><title>Owner public gaming relationship fixture</title><script type="module">
import {createOwnerAgentGrants} from './owner-agent-grant.mjs';
import {RelayMcpTransport} from './vendor/interego-browser.mjs';
const credential={kind:'relay-oauth-bearer',accessToken:'fixture-owner-bearer',refreshToken:null,method:'webauthn',expiresAt:Date.now()+3600000};
const anonymousFetch=async(target,init)=>{const r=await fetch('/public'+new URL(target).pathname,init);return new Response(await r.arrayBuffer(),{status:r.status,headers:r.headers})};
window.grants=createOwnerAgentGrants({binding:${JSON.stringify(binding)},applicationId:'did:key:zHallowmarchFixture',audience:'https://game.example',
relayUrl:'https://relay.example',credential,fetch:anonymousFetch,transport:new RelayMcpTransport(location.origin,credential,fetch.bind(window))});
window.ready=grants.connect();
</script>`); return;
    }
    const filename = path.resolve(root, '.' + req.url);
    if (!filename.startsWith(root + path.sep) || !filename.endsWith('.mjs') || filename.includes('.test.') || filename.includes('.fixture.')) {
      res.writeHead(404); res.end(); return;
    }
    res.writeHead(200, { 'Content-Type': 'text/javascript' }); res.end(await readFile(filename));
  } catch { res.writeHead(503); res.end('Explicit native contract fixture unavailable.'); }
});
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
try {
  const context = await browser.newContext(), page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:' + server.address().port); await page.evaluate(() => ready);
  assert.equal(await page.evaluate(async input => { try { await grants.publish({ ...input, publicDisclosureAccepted: false }); } catch (error) { return error.code; } }, input), 'public_disclosure_required');
  const first = await page.evaluate(input => grants.publish(input), input);
  assert.equal(first.saved, true);
  const loaded = await page.evaluate(reference => grants.load(reference), first.reference); assert.equal(loaded.grant.actor, input.actor);
  assert.equal(loaded.grant.revoked, false); assert.equal(first.receipt.authorship.authority, 'relay-attestation');
  await page.reload(); await page.evaluate(() => ready);
  assert.equal((await page.evaluate(reference => grants.load(reference), first.reference)).grant.entityId, input.entityId);
  fixture.setMode('throw-after'); const uncertain = await page.evaluate(reference => grants.revoke(reference), first.reference);
  assert.equal(uncertain.saved, false); assert.equal(uncertain.status, 'uncertain'); assert(!uncertain.receipt);
  const revoked = await page.evaluate(operationId => grants.confirm(operationId), uncertain.operationId); assert.equal(revoked.saved, true);
  assert.equal((await page.evaluate(reference => grants.load(reference), first.reference)).grant.revoked, true);
  fixture.setMode('fork'); const fork = await page.evaluate(input => grants.publish(input), input); assert.equal(fork.saved, false);
  assert.equal(fixture.calls.filter(call => call.name === 'publish_context').length, 3);
  assert(!fixture.calls.some(call => call.name === 'register_agent'));
  assert.equal(await page.evaluate(() => localStorage.length + sessionStorage.length), 0);
  assert.equal((await context.cookies()).length, 0);
  assert(requests.filter(request => request.authorization).every(request => request.url === '/mcp'));
  assert.deepEqual(errors, []);
  console.log('PASS Chromium: explicit public choice, actual SDK JSON/SSE transport + native CID/RDF validators, reload, owner-grant CAS revocation, lost acknowledgement confirmation, fork refusal, no browser persistence or delegated pod permission. Native proof/storage reports are fixtures.');
} finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
