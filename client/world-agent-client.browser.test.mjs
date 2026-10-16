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
  const record = { registered: true, reference: { grantId }, grant: { actor, applicationId, audience: origin, roomId: 'march', entityId: 'alice',
    role: 'teammate', actions: ['observe', 'move', 'attack'], revoked: false, expiresAt: new Date(Date.now() + 600000).toISOString() } };
  const html = `<!doctype html><div id="netsheet"><div class="sheet"></div></div><script>
    window.__HM_GAMING=${JSON.stringify({ mainWorldAgents: { enabled: true, applicationId, audience: origin, affordances: origin + '/world/native-agents' } })};
    window.__hm={};const GAME={started:true,player:{alive:true}},NETWS={acct:{id:'alice'},state:'off',worldRoom:'march',generation:1},UI={modal:'net'};
    const NATIVE_PLAYER={status:{verified:true}},$=id=>document.getElementById(id),anCompanions=()=>[];
    Object.defineProperty(navigator,'clipboard',{value:{async writeText(value){window.copied=value}}});
    ${source}
    MAIN_WORLD_AGENTS.records.set(${JSON.stringify(grantId)},${JSON.stringify(record)});mainWorldAgentRender();
    window.fixture={render:mainWorldAgentRender,state:MAIN_WORLD_AGENTS};
  </script>`;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/*', async route => {
    assert.equal(route.request().url(), origin + '/', 'no native/game network writes');
    await route.fulfill({ contentType: 'text/html', body: html });
  });
  await page.goto(origin);
  const details = page.locator('#world-agent-records details'); assert.equal(await details.count(), 1);
  assert.equal(await page.getByRole('link', { name: 'Agent discovery', exact: true }).getAttribute('target'), '_blank');
  assert.equal(await details.getAttribute('open'), null);
  await details.locator('summary').click();
  const value = JSON.parse(await details.locator('textarea').inputValue());
  assert.deepEqual(value, { origin, applicationId, agentDid: actor, grantId, roomId: 'march', entityId: 'alice', module: origin + '/world/agent-client.mjs' });
  await details.getByRole('button', { name: 'Copy connection details', exact: true }).click();
  assert.deepEqual(await page.evaluate(() => JSON.parse(window.copied)), value);
  const focused = await page.evaluate(() => {
    const button = [...document.querySelectorAll('#world-agent-records button')].find(b => b.textContent === 'Revoke access');
    button.focus(); fixture.render(); fixture.render();
    return document.activeElement === button && button.isConnected;
  });
  assert.equal(focused, true);
  await page.evaluate(({ grantId }) => { fixture.state.records.get(grantId).grant.entityId = 'alice:animal:7'; fixture.render(); }, { grantId });
  assert.equal(JSON.parse(await details.locator('textarea').inputValue()).entityId, 'alice:animal:7');
  await page.evaluate(({ grantId }) => { fixture.state.records.get(grantId).localRevoked = true; fixture.render(); }, { grantId });
  assert.equal(await details.count(), 0); assert.deepEqual(errors, []);
});
