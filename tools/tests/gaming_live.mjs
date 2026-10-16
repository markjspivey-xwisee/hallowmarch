/** Authorized live software-verification play. Creates two real guest accounts
 * and performs bounded encounter actions; no personal learning consent is set.
 * Run: node tools/tests/gaming_live.mjs --authorize-live-play https://...app
 * Add --require-realtime --max-action-rtt-ms=500 to gate the progressive mode.
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
assert.equal(manifest.enabled, true, 'Native expedition must be enabled');
const realtime = manifest.transport?.persistenceMode === 'realtime';
assert.equal(manifest.transport?.durableAcknowledgements, !realtime, 'Manifest must distinguish live acceptance from durable acknowledgements');
if (realtime) assert.equal(manifest.transport.progressivePersistence, true);
if (process.argv.includes('--require-realtime')) assert.equal(realtime, true, 'This run requires the real-time authority');
const rttOption = process.argv.find(value => value.startsWith('--max-action-rtt-ms='));
const maxActionRttMs = rttOption ? Number(rttOption.slice('--max-action-rtt-ms='.length)) : null;
assert(maxActionRttMs === null || (Number.isFinite(maxActionRttMs) && maxActionRttMs > 0), 'Invalid action round-trip budget');
const health = await (await fetch(new URL('/health', base))).json(); assert.equal(health.ok, true);
let agent;
if (process.env.HM_WS_PROXY) {
  const module = process.env.HM_PROXY_AGENT_MODULE || 'https-proxy-agent';
  const { HttpsProxyAgent } = await import(module.startsWith('/') ? pathToFileURL(module).href : module);
  agent = new HttpsProxyAgent(process.env.HM_WS_PROXY);
}
const timings = [], propagation = [], clients = [], run = randomUUID();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const sequence = value => value?.liveSequence ?? value?.version ?? -1;
const durableSequence = value => value?.durableSequence ?? value?.persistence?.durableSequence ?? (realtime ? -1 : sequence(value));
function persistenceSample(value) {
  return { liveSequence: sequence(value), durableSequence: durableSequence(value),
    ...(Number.isSafeInteger(value?.durableVersion) ? { durableVersion: value.durableVersion } : {}),
    ...(value?.persistence ? { persistence: structuredClone(value.persistence) } : {}) };
}
async function connect(name) {
  const url = new URL('/ws', base); url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
  const socket = new WebSocket(url, agent ? { agent } : {}), pending = new Map();
  const client = { socket, pending, snapshot: null, version: -1, accountId: null, name, snapshotReceivedAt: 0 };
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
    if (message.op === 'snapshot' && sequence(message.state) >= client.version) { client.snapshot = message.state; client.version = sequence(message.state); client.snapshotReceivedAt = performance.now(); }
    if (message.op === 'result') {
      const row = pending.get(message.requestId); if (!row) return; pending.delete(message.requestId); clearTimeout(row.timer);
      timings.push({ op: row.op, ...(row.commandType ? { commandType: row.commandType } : {}), elapsedMs: Math.round(performance.now() - row.start), ok: message.ok,
        ...(message.ok && Number.isSafeInteger(sequence(message.result)) && sequence(message.result) >= 0 ? persistenceSample(message.result) : {}) });
      message.ok ? row.resolve(message.result) : row.reject(Object.assign(new Error(message.error?.message || 'Game command failed'), { code: message.error?.code }));
    }
  });
  await welcome;
  socket.send(JSON.stringify({ t: 'slow', d: { n: name, dn: name, r: 0, faction: 0, cls: 'warrior', l: 1 } }));
  client.request = (op, payload = {}) => new Promise((resolve, reject) => {
    const requestId = `${run}:${randomUUID()}`, start = performance.now();
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error('Live game request timeout')); }, 30000);
    pending.set(requestId, { resolve, reject, timer, op, start, commandType: payload.command?.type }); socket.send(JSON.stringify({ ...payload, t: 'gaming', op, requestId }));
  });
  client.command = (type, payload = {}) => client.request('command', { command: { ...payload, type, commandId: randomUUID(), roomId: manifest.roomId } });
  await client.request('enter');
  assert(client.snapshot?.entities?.[client.accountId], 'Entry must deliver a server-authoritative body');
  if (realtime) {
    assert.equal(client.snapshot.persistence?.mode, 'realtime');
    assert(Number.isSafeInteger(client.snapshot.liveSequence));
    assert(Number.isSafeInteger(client.snapshot.durableSequence));
    assert(client.snapshot.durableSequence <= client.snapshot.liveSequence, 'A checkpoint cannot lead live state');
  }
  assert.notEqual(client.snapshot.consent?.enabled, true, 'Software-verification player learning export must remain off');
  return client;
}
async function until(predicate, message) { const deadline = Date.now() + 30000; while (!predicate()) { if (Date.now() > deadline) throw new Error(message); await delay(50); } }
async function waitForCheckpoint(client, targetSequence) {
  if (!realtime) return { targetSequence, ...persistenceSample(client.snapshot), evidence: 'strict-durable-acknowledgement' };
  const started = performance.now(), deadline = Date.now() + 60000;
  while (durableSequence(client.snapshot) < targetSequence) {
    assert(Date.now() < deadline, 'The final live sequence did not receive a native checkpoint within sixty seconds');
    await client.request('observe');
    if (durableSequence(client.snapshot) < targetSequence) await delay(250);
  }
  assert(durableSequence(client.snapshot) <= sequence(client.snapshot));
  return { targetSequence, waitedMs: Math.round(performance.now() - started), ...persistenceSample(client.snapshot), evidence: 'server-reported-native-checkpoint', coldRecoveryVerified: false };
}
try {
  const alice = await connect('Software verify A'), bob = await connect('Software verify B');
  await until(() => alice.snapshot.entities[bob.accountId] && bob.snapshot.entities[alice.accountId], 'Players did not receive each other');
  console.log(`PASS two real authenticated guest connections share ${realtime ? 'live server-authoritative' : 'native confirmed'} state; learning consent off`);
  // Six paced one-unit steps exercise authority while a native checkpoint may
  // still be in flight. Each peer observation is the server's state, not prediction.
  for (const [x, z] of [[0, 1], [0, 2], [1, 2], [1, 1], [0, 1], [0, 2]]) {
    await delay(400);
    const started = performance.now();
    await alice.command('move', { entityId: alice.accountId, x, z });
    await until(() => bob.snapshot.entities[alice.accountId].x === x && bob.snapshot.entities[alice.accountId].z === z, 'Movement did not reach the second player');
    propagation.push({ commandType: 'move', elapsedMs: Math.max(0, Math.round(bob.snapshotReceivedAt - started)), ...persistenceSample(bob.snapshot) });
  }
  console.log('PASS six paced authoritative moves reach the second player');
  const before = alice.snapshot.entities['march-guardian'].hp;
  if (before > 0) {
    const started = performance.now();
    await alice.command('attack', { entityId: alice.accountId, targetId: 'march-guardian' });
    await until(() => bob.snapshot.entities['march-guardian'].hp === before - Math.min(before, 10), 'Shared damage did not reach the second player');
    propagation.push({ commandType: 'attack', elapsedMs: Math.max(0, Math.round(bob.snapshotReceivedAt - started)), ...persistenceSample(bob.snapshot) });
    console.log('PASS real server-owned damage reaches both clients');
  } else console.log('SKIP bounded attack: the shared guardian was already defeated; another player\'s encounter was preserved');
  const actionSamples = timings.filter(row => row.ok && ['move', 'attack'].includes(row.commandType)), orderedRtts = actionSamples.map(row => row.elapsedMs).sort((a, b) => a - b);
  const actionPerformance = { samples: actionSamples.length, moves: actionSamples.filter(row => row.commandType === 'move').length,
    attacks: actionSamples.filter(row => row.commandType === 'attack').length, medianMs: orderedRtts[Math.floor(orderedRtts.length / 2)],
    p95Ms: orderedRtts[Math.ceil(orderedRtts.length * .95) - 1], maxMs: orderedRtts.at(-1),
    progressiveLagObserved: actionSamples.some(row => row.liveSequence > row.durableSequence) };
  if (realtime) assert(actionPerformance.progressiveLagObserved, 'The real-time sample must expose live acceptance ahead of its checkpoint');
  if (maxActionRttMs !== null) assert(actionPerformance.maxMs <= maxActionRttMs, `Action round trips exceeded ${maxActionRttMs} ms: ${actionPerformance.maxMs} ms`);
  console.log('ACTION PERFORMANCE ' + JSON.stringify(actionPerformance));
  const actionCheckpoint = await waitForCheckpoint(alice, alice.version);
  console.log('PASS action sequence received its native checkpoint');
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
  const finalCheckpoint = await waitForCheckpoint(alice, alice.version);
  await Promise.all([alice.request('leave'), bob.request('leave')]);
  const status = await (await fetch(new URL('/gaming/status', base))).json(); assert.equal(status.manifest.enabled, true); assert(status.metrics.version >= bob.version);
  if (realtime) assert(durableSequence(status.metrics.persistence) >= finalCheckpoint.targetSequence, 'Public metrics must confirm the final checkpoint');
  console.log(JSON.stringify({ runId: run, testKind: 'actual-live-software-verification', base: base.origin, roomId: manifest.roomId,
    liveSequence: status.metrics.version, nativeVersion: status.metrics.persistence?.durableVersion ?? status.metrics.version,
    persistenceMode: realtime ? 'realtime' : 'strict', actionPerformance, commandRoundTripsMs: timings, peerPropagationMs: propagation,
    actionCheckpoint, finalCheckpoint, servicePersistence: status.metrics.persistence,
    serviceCommandMaxMs: status.metrics.maxCommandMs, serviceLastCommitMs: status.metrics.lastCommitMs, monitoring: status.monitoring, humanLearningExported: false }, null, 2));
} finally {
  for (const client of clients) { for (const row of client.pending.values()) clearTimeout(row.timer); client.socket.close(); }
}
