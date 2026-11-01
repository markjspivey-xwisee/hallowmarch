/** Isolated HTTPS browser ceremonies; no owner profile, live provider or character data. */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { createPlayerIdentityBridge } from '../../server/gaming/player-identity.js';
import { createPlayerBrowserAssets } from '../../server/gaming/player-browser-assets.js';

if (!process.env.HM_PLAYWRIGHT_MODULE) throw new Error('Set HM_PLAYWRIGHT_MODULE to the installed Playwright entry point.');
const { chromium } = await import(pathToFileURL(process.env.HM_PLAYWRIGHT_MODULE));
const GAME = 'https://identity-finish.test', RELAY = 'https://relay.example';
const GAME_TOKEN = 'fixture-original-game-session', APP_TOKEN = 'fixture-verified-app-session', ACCESS_TOKEN = 'fixture-native-access';
const owner = { userId: 'u-pk-existing', subjectDid: 'did:web:identity.example:users:u-pk-existing', podUrl: 'https://pod.example/u-pk-existing/' };
const HANDOFF_MS = 2_000, NAVIGATION_DELAY_MS = 2_500;
let browser;
before(async () => { browser = await chromium.launch({ headless: true, executablePath: process.env.HM_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] }); });
after(async () => { await browser?.close(); });

async function fixture(t, { legacy = false, delayFinish = false, delaySdk = false, declined = false, holdFinishAssets = false,
  ceremonyMode = 'valid', serverOwnerMismatch = false, foreignCeremonyOwner = false, invalidFailureEvidence } = {}) {
  const requests = [], events = [], faults = [], headers = [], cacheLocations = [];
  let releaseAssets, markAssetsHeld, released = false;
  const assetsGate = new Promise(resolve => { releaseAssets = resolve; });
  const assetsHeld = new Promise(resolve => { markAssetsHeld = resolve; });
  const releaseFinishAssets = () => { if (!released) { released = true; events.push('finish-assets:released'); releaseAssets(); } };
  const assets = createPlayerBrowserAssets();
  const bridge = createPlayerIdentityBridge({
    publicOrigin: GAME, identityOrigin: 'https://identity.example', metadataUrl: RELAY + '/.well-known/oauth-authorization-server',
    storeBases: ['https://pod.example/'], allowOwnerBrowserHandoff: true, successPath: '/gaming/identity/finish', handoffTtlMs: HANDOFF_MS,
    renderBrowserSuccess: (req, res) => assets(req, res, '/gaming/identity/finish'),
    authorizeGameAccount: async (req, body) => req.headers.authorization === 'Bearer ' + GAME_TOKEN && body?.ownerPodWriteAccess === true
      ? { accountId: 'existing-game-account', sessionId: GAME_TOKEN, ownerPodWriteAccess: true,
        ...(serverOwnerMismatch ? { expectedSubjectDid: 'did:web:identity.example:users:u-pk-other' } : {}) } : null,
    onVerified: async () => ({ appSession: { token: APP_TOKEN, acct: { id: 'existing-game-account' } } }),
    fetch: async input => {
      const url = String(input);
      if (url.endsWith('/.well-known/oauth-authorization-server')) return Response.json({ issuer: RELAY + '/', authorization_endpoint: RELAY + '/authorize',
        token_endpoint: RELAY + '/token', client_id_metadata_document_supported: true, response_types_supported: ['code'],
        code_challenge_methods_supported: ['S256'], token_endpoint_auth_methods_supported: ['none'], scopes_supported: ['mcp:read', 'mcp:write'] });
      if (url.endsWith('/.well-known/oauth-protected-resource')) return Response.json({ authorization_servers: [RELAY + '/'],
        affordances: [{ action: 'urn:iep:action:mcp:invoke', target: RELAY + '/mcp', method: 'POST' }] });
      if (url.endsWith('/token')) return Response.json({ token_type: 'Bearer', access_token: ACCESS_TOKEN, expires_in: 600, scope: 'mcp:write' });
      assert.equal(url, RELAY + '/mcp');
      return Response.json({ jsonrpc: '2.0', id: 1, result: { structuredContent: {
        identity: { userId: owner.userId, did: owner.subjectDid, webId: 'https://identity.example/users/' + owner.userId + '/profile#me' },
        pod: owner.podUrl, registry: { owner: 'https://identity.example/users/' + owner.userId + '/profile#me' },
        sessionAgent: { id: 'hallowmarch-' + owner.userId, did: 'did:web:identity.example:agents:hallowmarch-' + owner.userId, scope: 'ReadWrite' },
      } } });
    },
  });
  const server = http.createServer(async (req, res) => {
    try {
      const pathname = new URL(req.url, GAME).pathname;
      if (assets(req, res, pathname)) return;
      if (await bridge.handle(req, res)) return;
      res.writeHead(404); res.end();
    } catch { faults.push('fixture-handler-failed'); if (!res.headersSent) res.writeHead(500); res.end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  const context = await browser.newContext();
  t.after(async () => { releaseFinishAssets(); await context.close(); bridge.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); assert.deepEqual(faults, []); });
  await context.route(GAME + '/**', async route => {
    const req = route.request(), url = new URL(req.url());
    requests.push(url.pathname); events.push('request:' + url.pathname);
    if (url.pathname === '/gaming/identity/assets/access-cache.mjs') {
      const current = new URL(req.frame().url());
      cacheLocations.push(current.pathname === '/gaming/identity/finish' && current.search === '' && current.hash === '');
    }
    if (url.pathname === '/fixture') { await route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>Isolated game opener</title>' }); return; }
    if (holdFinishAssets && ['/gaming/identity/assets/finish.mjs', '/gaming/identity/assets/finish.css'].includes(url.pathname)) {
      markAssetsHeld(); await assetsGate;
    }
    if (delayFinish && url.pathname === '/gaming/identity/finish') await new Promise(resolve => setTimeout(resolve, NAVIGATION_DELAY_MS));
    if (delaySdk && url.pathname === '/gaming/identity/assets/vendor/interego-browser.mjs') await new Promise(resolve => setTimeout(resolve, NAVIGATION_DELAY_MS));
    const outgoing = { ...req.headers(), host: new URL(GAME).host };
    if (legacy && url.pathname === '/gaming/identity/callback') outgoing.accept = 'application/json';
    const response = await route.fetch({ url: base + url.pathname + url.search, headers: outgoing, maxRedirects: 0 });
    events.push('response:' + url.pathname + ':' + response.status());
    if (url.pathname === '/gaming/identity/callback') headers.push(response.headers());
    if (response.status() === 303) {
      // Keep Chromium on this isolated HTTPS route while retaining the real
      // server redirect and its cookies. This is also the explicit legacy control.
      const values = { ...response.headers(), 'content-type': 'text/html' }; delete values['content-length'];
      await route.fulfill({ status: 200, headers: values,
        body: '<script>location.replace(' + JSON.stringify(new URL(values.location, req.url()).href) + ')</script>' }); return;
    }
    if (invalidFailureEvidence && url.pathname === '/gaming/identity/callback') {
      const body = invalidFailureEvidence === 'proof'
        ? (await response.text()).replace(/(name="hallowmarch-identity-ceremony" content=")[^"]+/, '$1' + 'A'.repeat(43))
        : (await response.text()).replace('content="identity_authorization_declined"', 'content="__proto__"');
      await route.fulfill({ response, body }); return;
    }
    await route.fulfill({ response });
  });
  await context.route(RELAY + '/authorize**', async route => {
    const state = new URL(route.request().url()).searchParams.get('state');
    const target = GAME + '/gaming/identity/callback?state=' + state + (declined ? '&error=access_denied' : '&code=fixture-authorized-existing-owner');
    await route.fulfill({ status: 200, contentType: 'text/html', headers: { 'referrer-policy': 'no-referrer' }, body: '<script>location.replace(' + JSON.stringify(target) + ')</script>' });
  });
  const opener = await context.newPage(); await opener.goto(GAME + '/fixture');
  const popupEvent = context.waitForEvent('page');
  await opener.evaluate(async ({ gameToken, owner, ceremonyMode, foreignCeremonyOwner }) => {
    const start = await fetch('/gaming/identity/start', { method: 'POST', credentials: 'same-origin',
      headers: { Authorization: 'Bearer ' + gameToken, 'Content-Type': 'application/json' }, body: JSON.stringify({ ownerPodWriteAccess: true }) });
    if (!start.ok) throw new Error('Fixture start refused');
    const value = await start.json(), channel = 'fixture-finish-' + crypto.randomUUID();
    window.fixtureChannel = new BroadcastChannel(channel); window.fixtureMessages = [];
    window.fixtureChannel.onmessage = event => window.fixtureMessages.push(event.data.type);
    const popup = window.open('about:blank', '_blank');
    const ceremony = { token: gameToken, channel, host: location.host,
      browserCeremony: value.browserCeremony, expiresAt: Date.now() + (ceremonyMode === 'expired' ? -1 : 600_000),
      expectedAccountId: 'existing-game-account', expectedOwnerDid: foreignCeremonyOwner ? 'did:web:identity.example:users:u-pk-other' : owner.subjectDid, expectedPodUrl: owner.podUrl };
    popup.sessionStorage.setItem('hallowmarch.identity.ceremony.v1', ceremonyMode === 'malformed' ? '{' : JSON.stringify(ceremony));
    popup.location.replace(value.authorizationUrl);
  }, { gameToken: GAME_TOKEN, owner, ceremonyMode, foreignCeremonyOwner });
  const popup = await popupEvent;
  return { opener, popup, requests, events, headers, cacheLocations, context, bridge, assetsHeld, releaseFinishAssets };
}

async function confirmed(f) {
  await f.popup.waitForFunction(() => {
    const text = document.querySelector('#status')?.textContent || '';
    return text.startsWith('Connected.') || text.includes('Sign-in did not finish.') || text.includes('expired');
  }, undefined, { timeout: 10_000 });
  assert(f.events.includes('response:/gaming/identity/claim:200'),
    'Expected a successful bounded claim; observed ' + f.events.filter(value => value.startsWith('response:/gaming/identity/claim:')).join(','));
  await f.opener.waitForFunction(() => window.fixtureMessages.includes('hallowmarch-native-connected'), undefined, { timeout: 10_000 });
  assert.equal(await f.opener.evaluate(token => localStorage.getItem('hallowmarch.token.' + location.host) === token, APP_TOKEN), true);
  assert.equal(f.bridge.status().readyHandoffs, 0);
}

test('HTML callback claims directly without the delayed second document navigation', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { delayFinish: true }); await confirmed(f);
  assert(!f.requests.includes('/gaming/identity/finish'), 'HTML success must not require a second document navigation');
  assert(f.events.includes('response:/gaming/identity/callback:200'));
  assert(f.events.includes('response:/gaming/identity/claim:200'));
  assert.equal(f.headers[0]['referrer-policy'], 'no-referrer'); assert.equal(f.headers[0]['cache-control'], 'no-store');
  assert.match(f.headers[0]['content-security-policy'], /default-src 'none'/); assert.match(f.headers[0]['set-cookie'], /HttpOnly; SameSite=Lax; Max-Age=2/);
});

test('claim precedes a slow SDK import and callback query is removed before importing cache code', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { delaySdk: true }); await confirmed(f);
  const claim = f.events.indexOf('response:/gaming/identity/claim:200'), cache = f.events.indexOf('request:/gaming/identity/assets/access-cache.mjs');
  assert(claim >= 0 && cache > claim, 'Verify and consume the bounded handoff before loading browser cache/SDK');
  // Record only whether the URL was clean; never retain a callback query.
  assert.deepEqual(f.cacheLocations, [true]);
});

test('bounded claim succeeds before held finish JavaScript and CSS are released, then connects exactly once', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { holdFinishAssets: true });
  await f.assetsHeld;
  // Keep both external presentation assets unavailable beyond the real fixture
  // handoff lifetime. A claim after release cannot pass this server's guard.
  await new Promise(resolve => setTimeout(resolve, NAVIGATION_DELAY_MS));
  const claimedBeforeRelease = f.events.includes('response:/gaming/identity/claim:200');
  f.releaseFinishAssets();
  await f.popup.waitForFunction(() => {
    const text = document.querySelector('#status')?.textContent || '';
    return text.startsWith('Connected.') || text.includes('Sign-in did not finish.') || text.includes('expired');
  }, undefined, { timeout: 10_000 });
  assert.equal(claimedBeforeRelease, true,
    'Expected claim200 before releasing delayed finish assets; observed ' + f.events.filter(value => value.startsWith('response:/gaming/identity/claim:')).join(','));
  await confirmed(f);
  assert.equal(f.requests.filter(value => value === '/gaming/identity/claim').length, 1);
  assert(f.events.indexOf('response:/gaming/identity/claim:200') < f.events.indexOf('finish-assets:released'));
  assert.deepEqual(f.cacheLocations, [true]);
});

test('non-HTML redirect compatibility retains the same short one-use handoff expiry', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { legacy: true, delayFinish: true });
  await f.popup.waitForFunction(() => document.querySelector('#status')?.textContent === 'Sign-in did not finish. Your saved character has not been changed. Return to the game and try again.', undefined, { timeout: 10_000 });
  assert(f.events.includes('response:/gaming/identity/callback:303')); assert(f.events.includes('response:/gaming/identity/claim:404'));
  assert.equal(await f.opener.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), null);
  assert.deepEqual(await f.opener.evaluate(() => window.fixtureMessages), []); assert.equal(f.bridge.status().readyHandoffs, 0);
});

test('declined HTML callback clears consumed OAuth URL without claiming or caching a grant', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { declined: true });
  await f.popup.waitForFunction(() => document.querySelector('#status')?.textContent.includes('cancelled'), undefined, { timeout: 10_000 });
  assert.equal(new URL(f.popup.url()).pathname, '/gaming/identity/finish'); assert.equal(new URL(f.popup.url()).search, '');
  assert(!f.requests.includes('/gaming/identity/claim')); assert(!f.requests.includes('/gaming/identity/assets/access-cache.mjs'));
  assert.equal(await f.opener.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), null);
});

test('malformed and expired local ceremonies do not post a claim or import private cache code', { timeout: 20_000 }, async t => {
  for (const ceremonyMode of ['malformed', 'expired']) {
    const f = await fixture(t, { ceremonyMode });
    await f.popup.waitForFunction(() => !document.querySelector('#return')?.hidden, undefined, { timeout: 10_000 });
    assert.equal(new URL(f.popup.url()).pathname, '/gaming/identity/finish'); assert.equal(new URL(f.popup.url()).search, '');
    assert(!f.requests.includes('/gaming/identity/claim')); assert(!f.requests.includes('/gaming/identity/assets/access-cache.mjs'));
    assert.equal(await f.opener.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), null);
    assert.deepEqual(await f.opener.evaluate(() => window.fixtureMessages), []);
  }
});

test('server owner refusal and malformed failure evidence never claim or connect another identity', { timeout: 20_000 }, async t => {
  for (const options of [{ serverOwnerMismatch: true }, { declined: true, invalidFailureEvidence: 'proof' }, { declined: true, invalidFailureEvidence: 'code' }]) {
    const f = await fixture(t, options);
    await f.popup.waitForFunction(() => !document.querySelector('#return')?.hidden && location.search === '', undefined, { timeout: 10_000 });
    assert(!f.requests.includes('/gaming/identity/claim')); assert(!f.requests.includes('/gaming/identity/assets/access-cache.mjs'));
    assert.equal(await f.opener.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), null);
    if (!options.serverOwnerMismatch) assert.deepEqual(await f.opener.evaluate(() => window.fixtureMessages), []);
    assert.equal(f.bridge.status().readyHandoffs, 0);
  }
});

test('the claimed receipt must still match the original ceremony owner before SDK, cache or app-token writes', { timeout: 20_000 }, async t => {
  const f = await fixture(t, { foreignCeremonyOwner: true });
  await f.popup.waitForFunction(() => document.querySelector('#status')?.textContent.includes('another identity'), undefined, { timeout: 10_000 });
  assert(f.events.includes('response:/gaming/identity/claim:200'));
  assert.equal(f.requests.filter(value => value === '/gaming/identity/claim').length, 1);
  assert(!f.requests.includes('/gaming/identity/assets/access-cache.mjs')); assert(!f.requests.includes('/gaming/identity/assets/vendor/interego-browser.mjs'));
  assert.equal(await f.opener.evaluate(() => localStorage.getItem('hallowmarch.token.' + location.host)), null);
  assert.deepEqual(await f.opener.evaluate(() => window.fixtureMessages), []);
});
