import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { createWorldAgentMcpHost, validateWorldAgentConnection } from './world-agent-mcp.mjs';
import { WorldAgentClientError } from './world-agent-client.mjs';

// Offline tool-protocol fixtures only. Actual deployed companion proof remains
// the native-player-live runner's responsibility.
const connection = { origin: 'https://game.example', applicationId: 'did:web:identity.example:users:march',
  agentDid: 'did:web:identity.example:agents:independent-agent', grantId: 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41',
  roomId: 'march', entityId: 'alice:companion:2fd428f0-d768-4ec7-9c52-f6c4e1cadce0', module: 'https://game.example/world/agent-client.mjs' };
const request = (id, method, params) => ({ jsonrpc: '2.0', id, method, ...(params ? { params } : {}) });
const call = (host, name, args = {}) => host.handle(request(4, 'tools/call', { name, arguments: args }));
async function initialize(host) {
  const r = await host.handle(request(1, 'initialize', { protocolVersion: '2025-06-18' }));
  assert.equal(r.result.serverInfo.name, 'hallowmarch-companion');
  assert.equal(await host.handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
}
function fixture(t) {
  const calls = []; let connected = false, closed = 0, failure = null;
  const host = createWorldAgentMcpHost({ connection, sign_request() { throw Error('native signer fixture is not invoked by stub client'); },
    createClient(options) {
      calls.push(['create', options]);
      return { async connect(scope) { calls.push(['connect', scope]); if (failure) throw failure; connected = true; return { connected }; },
        async observe() { calls.push(['observe']); if (failure) throw failure; return { authority: 'owner-page-observation', body: { id: connection.entityId } }; },
        async move(value) { calls.push(['move', value]); if (failure) throw failure; return { accepted: true, execution: 'owner-page-input-applied' }; },
        async attack(value) { calls.push(['attack', value]); return { accepted: true }; },
        async renew() { calls.push(['renew']); return { connected }; },
        status() { return { connected }; }, close() { connected = false; closed++; } };
    } });
  t.after(() => host.close());
  return { host, calls, closed: () => closed, fail: value => { failure = value; } };
}
test('public connection pins the reviewed origin/grant/companion and cannot select a bearer, human or remote executable', () => {
  assert.equal(validateWorldAgentConnection(connection).entityId, connection.entityId);
  for (const change of [{ entityId: 'alice' }, { accessToken: 'secret' }, { module: 'https://evil.example/signer.mjs' },
    { origin: 'http://game.example' }, { grantId: 'not-a-native-uuid' }, { entityId: connection.entityId + '\n' }]) {
    assert.throws(() => validateWorldAgentConnection({ ...connection, ...change }), /invalid_public_connection/);
  }
});
test('MCP initialization, listing and status never create a connection or sign; initialized notification alone cannot skip negotiation', async t => {
  const f = fixture(t);
  await f.host.handle({ jsonrpc: '2.0', method: 'notifications/initialized' });
  assert.equal((await call(f.host, 'march_connect')).error.code, -32000);
  await initialize(f.host);
  const list = await f.host.handle(request(2, 'tools/list'));
  assert.equal(list.result.tools.length, 7);
  assert(list.result.tools.every(tool => tool.inputSchema.additionalProperties === false));
  assert.equal((await call(f.host, 'march_status')).result.structuredContent.result.connected, false);
  assert.equal(f.calls.length, 0);
  const negotiated = await f.host.handle(request(5, 'initialize', { protocolVersion: '2025-11-25' }));
  assert.equal(negotiated.result.protocolVersion, '2025-06-18');
  const hinted = await f.host.handle(request(6, 'tools/call', { name: 'march_status', arguments: {}, _meta: { progressToken: 'client-progress' } }));
  assert.equal(hinted.result.structuredContent.result.connected, false);
});
test('model cannot change the host-pinned actor, grant, URL, module, or selected entity; real tool parameters pass to one client', async t => {
  const f = fixture(t); await initialize(f.host);
  for (const name of ['march_connect', 'march_observe', 'march_status']) {
    assert.equal((await call(f.host, name, { origin: 'https://evil.example' })).result.isError, true);
  }
  assert.equal(f.calls.length, 0);
  await call(f.host, 'march_connect');
  assert.deepEqual(f.calls.find(([n]) => n === 'connect')[1], { grantId: connection.grantId, roomId: connection.roomId, entityId: connection.entityId });
  const result = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  assert.equal(result.result.structuredContent.result.execution, 'owner-page-input-applied');
  assert.equal((await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200, entityId: 'alice' })).result.isError, true);
  await call(f.host, 'march_observe'); await call(f.host, 'march_renew');
  await call(f.host, 'march_attack', { targetId: 'actual-visible-target' });
  assert.equal(f.calls.filter(([n]) => n === 'move').length, 1);
  await call(f.host, 'march_disconnect'); assert.equal(f.closed(), 1);
  assert.equal((await call(f.host, 'march_observe')).result.isError, true);
});
test('uncertain input is reported once without secrets or automatic replay; native exceptions remain private', async t => {
  const f = fixture(t); await initialize(f.host); await call(f.host, 'march_connect');
  f.fail(new WorldAgentClientError('agent_operation_unconfirmed', { uncertain: true }));
  const r = await call(f.host, 'march_move', { dx: 1, dz: 0, durationMs: 200 });
  assert.equal(r.result.isError, true); assert.match(r.result.content[0].text, /Do not automatically resend/);
  assert.equal(f.calls.filter(([n]) => n === 'move').length, 1);
  f.fail(Object.assign(Error('private token should not appear'), { code: 'secret-native-envelope' }));
  const hidden = await call(f.host, 'march_observe');
  assert(!JSON.stringify(hidden).includes('private token')); assert(!JSON.stringify(hidden).includes('secret-native-envelope'));
  assert.match(hidden.result.content[0].text, /agent_tool_failed/);
});
test('standalone stdio entry starts with no network/signing, speaks actual JSON-RPC, and stops on stdin closure', async t => {
  const directory = await mkdtemp(join(tmpdir(), 'hm-agent-mcp-')); t.after(() => rm(directory, { recursive: true, force: true }));
  const config = join(directory, 'public.json'), signer = join(directory, 'native-signer.mjs');
  await writeFile(config, JSON.stringify(connection));
  await writeFile(signer, 'export function sign_request(){throw Error("signing must not run during initialization")};');
  const child = spawn(process.execPath, ['tools/agents/world-agent-mcp.mjs', '--connection', config, '--signer-module', signer],
    { cwd: new URL('../', import.meta.url), stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => child.kill());
  const responses = [], errors = []; let buffer = '';
  child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8'); child.stderr.on('data', data => errors.push(data));
  const gotStatus = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('stdio response timeout')), 5000);
    child.on('error', reject);
    child.stdout.on('data', data => { buffer += data; while (buffer.includes('\n')) {
      const at = buffer.indexOf('\n'); const response = JSON.parse(buffer.slice(0, at)); buffer = buffer.slice(at + 1); responses.push(response);
      if (response.id === 3) { clearTimeout(timer); resolve(); }
    } });
  });
  for (const message of [request(1, 'initialize', { protocolVersion: '2025-06-18' }),
    { jsonrpc: '2.0', method: 'notifications/initialized' }, request(2, 'tools/list'), request(3, 'tools/call', { name: 'march_status', arguments: {} })]) {
    child.stdin.write(JSON.stringify(message) + '\n');
  }
  await gotStatus;
  assert.equal(responses.find(r => r.id === 2).result.tools.length, 7);
  assert.equal(responses.find(r => r.id === 3).result.structuredContent.result.connected, false);
  assert.deepEqual(errors, []);
  const exited = new Promise(resolve => child.on('exit', resolve)); child.stdin.end(); assert.equal(await exited, 0);
});
