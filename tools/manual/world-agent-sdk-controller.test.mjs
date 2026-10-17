import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createWorldAgentSdkController, worldAgentControllerBrowserFetch } from './world-agent-sdk-controller.mjs';

const config = { enabled: true, origin: 'https://game.example', applicationId: 'did:web:identity.example:users:march',
  agentDid: 'did:web:identity.example:agents:fixture', agentPodUrl: 'https://pod.example/fixture/',
  grantId: 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41', roomId: 'march', entityId: 'alice', dx: 1, dz: 0 };
function fixture(options = {}) {
  let time = 0, closed = false, moves = 0, observations = 0, factory = null;
  const events = [], sent = [], calls = [], inputs = [];
  const client = { async connect(input) { calls.push('connect'); assert.deepEqual(input, { grantId: config.grantId, roomId: config.roomId, entityId: config.entityId }); },
    status: () => ({ connected: !closed, scope: { actions: ['move', 'observe'], maxCommandsPerSecond: options.rate ?? 3 } }),
    async observe() { observations++; calls.push('observe'); return { authority: 'owner-page-observation', roomId: config.roomId, entityId: config.entityId,
      state: { body: { id: config.entityId, x: observations === 1 ? 0 : options.stationary ? 0 : 2, y: 0, z: 0 },
        targets: [{ id: 'fixture-other-not-exported', name: 'fixture-private-not-exported' }] } }; },
    async move(input) { moves++; calls.push('move'); inputs.push(input); sent.push({ at: time, ...input });
      if (moves === options.failAt) throw Object.assign(new Error('fixture-sensitive-message'), { code: 'agent_operation_unconfirmed', uncertain: true });
      return { accepted: true, execution: 'owner-page-input-applied', requestId: 'fixture-session-not-exported' }; },
    close() { closed = true; },
  };
  const controller = createWorldAgentSdkController({ config: { ...config }, now: () => time,
    createClient(input) { factory = input; return client; },
    createBroker() { return { signNativeRequest() {}, acceptLine: () => false, close() {} }; },
    writePublic: event => events.push(event), wait: async ms => { time += ms; options.onWait?.(); } });
  return { controller, events, sent, calls, inputs, factory: () => factory, moves: () => moves, observations: () => observations };
}
test('eight fresh bounded SDK inputs are paced and export only own-body poses plus counters', async () => {
  const f = fixture(), result = await f.controller.run();
  assert.equal(f.moves(), 8); assert.equal(f.observations(), 2); assert.equal(result.acknowledgedCommands, 8); assert.equal(result.horizontalDisplacement, 2);
  assert.equal(new Set(f.inputs).size, 8); // Every SDK call receives a new value; the real SDK supplies a fresh UUID.
  assert(f.sent.every(input => input.durationMs === 500 && input.dx === 1 && input.dz === 0));
  assert(f.sent[0].at >= 400);
  for (let i = 1; i < f.sent.length; i++) assert(f.sent[i].at - f.sent[i - 1].at >= 400);
  assert.deepEqual(f.calls, ['connect', 'observe', ...Array(8).fill('move'), 'observe']);
  const outward = JSON.stringify(f.events);
  for (const secret of ['fixture-sensitive', 'fixture-other', 'fixture-private', 'fixture-session', 'privateKey', 'accessToken', 'Authorization']) assert(!outward.includes(secret));
  assert.equal(f.controller.status().closed, true); await assert.rejects(f.controller.run());
});
test('zero measured displacement remains zero; controller never fabricates movement success', async () => {
  const f = fixture({ stationary: true }), result = await f.controller.run();
  assert.equal(result.horizontalDisplacement, 0); assert.equal(result.verifiedCombatOutcome, false);
});
test('any uncertain input permanently stops remaining commands and never retries admission or input', async () => {
  const f = fixture({ failAt: 3 });
  await assert.rejects(f.controller.run(), { code: 'agent_operation_unconfirmed', uncertain: true });
  assert.equal(f.moves(), 3); assert.equal(f.observations(), 1); assert.equal(f.controller.status().acknowledgedCommands, 2);
  assert.equal(f.events.at(-1).outcome, 'unknown'); assert.equal(f.calls.filter(call => call === 'connect').length, 1);
  await assert.rejects(f.controller.run()); assert.equal(f.moves(), 3);
});
test('grant rate below three commands/second is refused before observation or movement', async () => {
  const f = fixture({ rate: 2 }); await assert.rejects(f.controller.run(), { code: 'controller_rate_or_actions_refused' });
  assert.equal(f.moves(), 0); assert.equal(f.observations(), 0);
});
test('closing while paced stops before sending the next SDK input', async () => {
  let f; f = fixture({ onWait: () => f.controller.close() });
  await assert.rejects(f.controller.run(), { code: 'controller_closed' }); assert.equal(f.moves(), 0);
});
test('configuration requires opt-in and rejects credentials, old command IDs, different scopes and invalid direction', () => {
  for (const input of [{ ...config, enabled: false }, { ...config, ownerToken: 'not-read' }, { ...config, sessionId: 'old' },
    { ...config, commandId: 'old' }, { ...config, dx: 1, dz: 1 }, { ...config, origin: 'http://game.example' },
    { ...config, agentPodUrl: 'https://pod.example/fixture/?private=not-read' }]) assert.throws(() => createWorldAgentSdkController({ config: input }));
});
test('browser fetch port refuses private owner endpoints, outside origins and bearer headers before evaluating', async () => {
  let evaluated = false;
  const fetch = worldAgentControllerBrowserFetch({ page: { evaluate() { evaluated = true; } }, origin: config.origin });
  for (const [url, options] of [
    [config.origin + '/world/native-agent/register', { method: 'POST', headers: {} }],
    [config.origin + '/world/native-agents/owner', { method: 'GET', headers: {} }],
    ['https://other.example/world/native-agent/command', { method: 'POST', headers: {} }],
    [config.origin + '/world/native-agent/command', { method: 'POST', headers: { Authorization: 'not-read' } }],
  ]) await assert.rejects(fetch(url, options));
  assert.equal(evaluated, false);
});
test('CLI without exact authorization flags refuses without network or sensitive output', () => {
  const result = spawnSync(process.execPath, ['tools/manual/world-agent-sdk-controller.mjs'], { cwd: new URL('../../', import.meta.url), encoding: 'utf8' });
  assert.equal(result.status, 1); assert.equal(result.stdout, ''); assert.equal(result.stderr, '');
});

test('SDK cancellation promptly fails the browser port without a second evaluation or retry', async () => {
  let evaluations = 0;
  const fetch = worldAgentControllerBrowserFetch({ origin: config.origin, page: { evaluate() { evaluations++; return new Promise(() => {}); } } });
  const controller = new AbortController();
  const pending = fetch(config.origin + '/gaming/manifest', { method: 'GET', headers: {}, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'agent_operation_unconfirmed', uncertain: true }); assert.equal(evaluations, 1);
  await assert.rejects(fetch(config.origin + '/gaming/manifest', { method: 'GET', headers: {}, signal: controller.signal }));
  assert.equal(evaluations, 1);
});

test('blank-browser fetch port uses ordinary bounded same-origin fetch without game boot or owner cookies', {
  skip: !process.env.HM_PLAYWRIGHT_MODULE,
}, async t => {
  const { chromium } = await import(process.env.HM_PLAYWRIGHT_MODULE);
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'],
    ...(process.env.HM_CHROMIUM_EXECUTABLE ? { executablePath: process.env.HM_CHROMIUM_EXECUTABLE } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext(), page = await context.newPage(); let calls = 0;
  await context.route('**/*', async route => {
    const request = route.request(), url = new URL(request.url());
    assert.equal(url.origin, config.origin); assert.equal(request.headers().authorization, undefined); assert.equal(request.headers().cookie, undefined);
    if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Offline blank fixture</title>' });
    assert.equal(url.pathname, '/gaming/manifest'); assert.equal(request.method(), 'GET'); calls++;
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ fixture: 'public-response' }) });
  });
  await page.goto(config.origin + '/');
  const fetch = worldAgentControllerBrowserFetch({ page, origin: config.origin });
  const result = await fetch(config.origin + '/gaming/manifest', { method: 'GET', headers: { Accept: 'application/json' } });
  assert.deepEqual(await result.json(), { fixture: 'public-response' }); assert.equal(calls, 1);
  assert.equal(await page.locator('canvas').count(), 0); assert.equal((await context.cookies()).length, 0);
});
