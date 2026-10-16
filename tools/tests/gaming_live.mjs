/** Authorized live software-verification play. Creates two real guest accounts
 * and performs bounded encounter actions; no personal learning consent is set.
 * Run: node tools/tests/gaming_live.mjs --authorize-live-play https://...app
 * HM_WS_PROXY / HM_PROXY_AGENT_MODULE support a restricted-network test host.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
const require = createRequire(new URL('../../server/package.json', import.meta.url));
const WebSocket = require('ws');
if (!process.argv.includes('--authorize-live-play')) throw new Error('Explicit --authorize-live-play is required: this creates real guest accounts and commits bounded game commands.');
const target = process.argv.find(value => /^https?:\/\//.test(value));
if (!target) throw new Error('A real game base URL is required.');
const base = new URL(target); if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) throw new Error('Invalid game base URL.');
base.pathname = '/'; base.search = ''; base.hash = '';
const manifest = await (await fetch(new URL('/gaming/manifest', base))).json();
assert.equal(manifest.enabled, true, 'Native expedition must be enabled'); assert.equal(manifest.transport?.durableAcknowledgements, true);
const health = await (await fetch(new URL('/health', base))).json(); assert.equal(health.ok, true);
let agent;
if (process.env.HM_WS_PROXY) {
  const module = process.env.HM_PROXY_AGENT_MODULE || 'https-proxy-agent';
  const { HttpsProxyAgent } = await import(module.startsWith('/') ? pathToFileURL(module).href : module);
  agent = new HttpsProxyAgent(process.env.HM_WS_PROXY);
}
const timings = [], clients = [], run = randomUUID();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function connect(name) {
  const url = new URL('/ws', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, agent ? { agent } : {}), pending = new Map();
  const client = { socket, pending, snapshot: null, version: -1, accountId: null, name };
  clients.push(client);
  let welcomeResolve, welcomeReject;
  const welcome = new Promise((resolve, reject) => { welcomeResolve = resolve; welcomeReject = reject; });
  const timer = setTimeout(() => welcomeReject(new Error('Live welcome timeout')), 30000);
  socket.on('open', () => socket.send(JSON.stringify({ t: 'hello', v: 1, room: 'gaming-software-verification' })));
  socket.on('error', welcomeReject);
  socket.on('message', bytes => {
    const message = JSON.parse(String(bytes));
    if (message.t === 'welcome') { client.accountId = message.acct.id; clearTimeout(timer); welcomeResolve(message); }
    if (message.t === 'denied') welcomeReject(new Error(message.why));
    if (message.t !== 'gaming') return;
    if (message.op === 'snapshot' && message.version >= client.version) { client.snapshot = message.state; client.version = message.version; }
    if (message.op === 'result') { const row = pending.get(message.requestId); if (!row) return; pending.delete(message.requestId); clearTimeout(row.timer); timings.push({ op: row.op, elapsedMs: Math.round(performance.now() - row.start), ok: message.ok }); message.ok ? row.resolve(message.result) : row.reject(Object.assign(new Error(message.error?.message || 'Game command failed'), { code: message.error?.code })); }
  });
  await welcome;
  socket.send(JSON.stringify({ t: 'slow', d: { n: name, dn: name, r: 0, faction: 0, cls: 'warrior', l: 1 } }));
  client.request = (op, payload = {}) => new Promise((resolve, reject) => {
    const requestId = `${run}:${randomUUID()}`, start = performance.now();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Live game request timeout')); }, 30000);
    pending.set(requestId, { resolve, reject, timer, op, start }); socket.send(JSON.stringify({ ...payload, t: 'gaming', op, requestId }));
  });
  client.command = (type, payload = {}) => client.request('command', { command: { ...payload, type, commandId: randomUUID(), roomId: manifest.roomId } });
  await client.request('enter');
  assert(client.snapshot?.entities?.[client.accountId], 'Entry must deliver a confirmed body');
  assert.notEqual(client.snapshot.consent?.enabled, true, 'Software-verification player learning export must remain off');
  return client;
}
async function until(predicate, message) { const deadline = Date.now() + 30000; while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(50); } }
try {
  const alice = await connect('Software verify A'), bob = await connect('Software verify B');
  await until(() => alice.snapshot.entities[bob.accountId] && bob.snapshot.entities[alice.accountId], 'Players did not receive each other');
  console.log('PASS two real authenticated guest connections share native confirmed state; learning consent off');
  await delay(400); // The server speed cap allows two paces after at least 334 ms.
  await alice.command('move', { entityId: alice.accountId, x: 0, z: 2 });
  await until(() => bob.snapshot.entities[alice.accountId].z === 2, 'Movement did not reach the second player');
  const before = alice.snapshot.entities['march-guardian'].hp;
  if (before > 0) { await alice.command('attack', { entityId: alice.accountId, targetId: 'march-guardian' }); await until(() => bob.snapshot.entities['march-guardian'].hp === before - Math.min(before, 10), 'Shared damage did not reach the second player'); console.log('PASS real server-owned damage reaches both clients'); }
  await assert.rejects(bob.command('move', { entityId: alice.accountId, x: 5, z: 5 }), error => error.code === 'entity_forbidden');
  assert.equal(alice.snapshot.entities[alice.accountId].x, 0); console.log('PASS another player cannot move this player body');
  const grantResult = await alice.request('grant', { request: { agentId: 'did:example:software-verification-coach', role: 'coach', entityId: alice.accountId, expiresAt: Date.now() + 60000, maxCommandsPerSecond: 2 }, commandId: randomUUID() });
  const grant = grantResult.result || grantResult;
  assert.match(grant.token, /^hmca_/);
  const observe = () => fetch(new URL('/gaming/agent/observe', base), { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${grant.token}` }, body: JSON.stringify({ entityId: alice.accountId }) });
  let response = await observe(); assert.equal(response.status, 200); const observation = await response.json(); assert(observation.result.entities); assert(!JSON.stringify(observation).includes('tokenHash')); assert.equal(observation.result.consent, undefined);
  await alice.request('revoke', { grantId: grant.grant.id, commandId: randomUUID() });
  response = await observe(); assert.equal(response.status, 403); console.log('PASS live companion capability observes redacted state and revocation takes effect');
  // If this bounded strike delivered the last hit, claim and reset to leave a
  // fresh encounter. Never reset another player's in-progress living guardian.
  if (before > 0 && before <= 10) { await alice.command('claimLoot', { entityId: alice.accountId, targetId: 'march-guardian' }); await alice.command('resetEncounter'); }
  await Promise.all([alice.request('leave'), bob.request('leave')]);
  const status = await (await fetch(new URL('/gaming/status', base))).json(); assert.equal(status.manifest.enabled, true); assert(status.metrics.version >= bob.version);
  console.log(JSON.stringify({ runId: run, testKind: 'actual-live-software-verification', base: base.origin, roomId: manifest.roomId, nativeVersion: status.metrics.version,
    commandRoundTripsMs: timings, serviceCommandMaxMs: status.metrics.maxCommandMs, serviceLastCommitMs: status.metrics.lastCommitMs, monitoring: status.monitoring, humanLearningExported: false }, null, 2));
} finally {
  for (const client of clients) { for (const row of client.pending.values()) clearTimeout(row.timer); client.socket.close(); }
}
