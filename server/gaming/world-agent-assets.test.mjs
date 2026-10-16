import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorldAgentAssets } from './world-agent-assets.js';

test('the advertised public agent module serves fixed source with safe method and cache handling', () => {
  const handle = createWorldAgentAssets();
  const request = (pathname, method = 'GET') => {
    const result = {};
    result.handled = handle({ method }, { writeHead(status, headers) { Object.assign(result, { status, headers }); },
      end(body) { result.body = body; } }, pathname);
    return result;
  };
  const module = request('/world/agent-client.mjs');
  assert.equal(module.status, 200);
  assert.match(module.headers['Content-Type'], /javascript/);
  assert.equal(module.headers['Cache-Control'], 'no-store');
  assert.equal(module.headers['X-Content-Type-Options'], 'nosniff');
  assert.match(String(module.body), /export function createWorldAgentClient/);
  assert.equal(request('/world/agent-client.mjs', 'HEAD').body, undefined);
  assert.equal(request('/world/agent-client.mjs', 'POST').status, 405);
  assert.equal(request('/world/agent-client.test.mjs').handled, false);
  assert.equal(request('/world/../server/server.js').handled, false);
});
