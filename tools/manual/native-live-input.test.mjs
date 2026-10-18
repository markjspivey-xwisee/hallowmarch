import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomBytes, generateKeyPairSync, randomUUID } from 'node:crypto';
import { createNativeLiveInput } from './native-live-input.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';

const tick = () => new Promise(resolve => setImmediate(resolve));
const agentDid = 'did:web:identity.example:agents:fixture', agentPodUrl = 'https://pods.example/fixture/';
const publicPayload = () => ({ purpose: 'urn:interego:gaming:agent-admission:v1', applicationId: 'did:web:game.example', audience: 'https://game.example',
  challenge: randomBytes(32).toString('base64url'), grantId: 'urn:uuid:' + randomUUID(), grantDigest: randomBytes(32).toString('hex'),
  sessionPublicKeyJwk: generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) });
test('one real readline routes the signing envelope while its manual command waits', async () => {
  const input = new PassThrough(), seen = []; let request, signingResult;
  const broker = createNativeCompanionSigningBroker({ enabled: true, agentDid, agentPodUrl,
    writePublicRequest: value => { request = value; } });
  const payload = publicPayload();
  const reader = createNativeLiveInput({ input, acceptProtocolLine: line => broker.acceptLine(line),
    async onCommand(command) { seen.push(command); signingResult = await broker.signNativeRequest({ payload, expiresAt: Date.now() + 10000 }); },
    onClose: () => broker.close() });
  input.write('continue\n'); await tick();
  assert.equal(reader.status().commandBusy, true); assert(request);
  const envelope = { _signed_payload: JSON.stringify({ ...payload, agent_id: agentDid, subject_pod_url: agentPodUrl,
    timestamp: new Date().toISOString() }), _signature: '0x' + 'ab'.repeat(65) };
  input.write(JSON.stringify({ kind: 'native_companion_signed_envelope', requestId: request.requestId, envelope }) + '\n');
  await tick();
  assert.deepEqual(signingResult, envelope); assert.deepEqual(seen, ['continue']); assert.equal(reader.status().commandBusy, false);
  input.write('finish\n'); await reader.waitForClose(); input.destroy();
});

test('mutating commands serialize without queuing; status remains available and arbitrary input is refused', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0, invalid = 0, errors = 0, closed = 0;
  const reader = createNativeLiveInput({ input, async onCommand(value) { seen.push(value);
    if (value !== 'status') await new Promise(resolve => { release = resolve; }); },
    onBusy: () => busy++, onInvalid: () => invalid++, onError: () => errors++, onClose: () => closed++ });
  input.write('retry\n'); await tick();
  input.write('continue\nstatus\n'); await tick();
  assert.equal(busy, 1); assert.deepEqual(seen, ['retry', 'status']);
  input.write('console.log("DO_NOT_EXECUTE_OR_LOG")\n'); input.write('x'.repeat(33000) + '\n'); await tick();
  assert.equal(invalid, 2); assert.equal(errors, 0);
  release(); await tick(); input.write('companion-restart-admission\n'); await tick();
  assert.deepEqual(seen, ['retry', 'status', 'companion-restart-admission']);
  release(); await tick(); input.write('oauth-retry-same-owner\n'); await tick();
  assert.equal(seen.at(-1), 'oauth-retry-same-owner');
  input.write('finish\n'); await reader.waitForClose();
  assert.equal(closed, 1); assert.equal(reader.status().closed, true); release(); input.destroy();
});

test('finish and EOF close a pending signer without waiting on the manual command', async () => {
  for (const finish of [true, false]) {
    const input = new PassThrough(); let rejected = false, errors = 0;
    const broker = createNativeCompanionSigningBroker({ enabled: true, agentDid, agentPodUrl, writePublicRequest() {} });
    const reader = createNativeLiveInput({ input, acceptProtocolLine: line => broker.acceptLine(line),
      async onCommand() { await broker.signNativeRequest({ payload: publicPayload(), expiresAt: Date.now() + 10000 }); },
      onClose() { broker.close(); rejected = true; }, onError: () => errors++ });
    input.write('continue\n'); await tick();
    assert.equal(broker.status().pending, true);
    if (finish) input.write('finish\n'); else input.end();
    await reader.waitForClose(); assert.equal(rejected, true); assert.equal(broker.status().closed, true);
    await tick(); assert.equal(errors, 1); input.destroy();
  }
});
test('native startup retry is a fixed serialized command and remains distinct from stage retry', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0;
  const reader = createNativeLiveInput({ input, async onCommand(value) { seen.push(value);
    if (value === 'native-startup-retry') await new Promise(resolve => { release = resolve; }); }, onBusy: () => busy++ });
  input.write('native-startup-retry\n'); await tick(); assert.equal(reader.status().commandBusy, true);
  input.write('retry\nstatus\n'); await tick(); assert.equal(busy, 1); assert.deepEqual(seen, ['native-startup-retry', 'status']);
  release(); await tick(); input.write('retry\n'); await tick(); assert.deepEqual(seen, ['native-startup-retry', 'status', 'retry']);
  input.write('finish\n'); await reader.waitForClose(); input.destroy();
});
test('native checkpoint read is a fixed serialized command and does not allow concurrent stage replay', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0;
  const reader = createNativeLiveInput({ input, async onCommand(value) { seen.push(value);
    if (value === 'native-checkpoint-read') await new Promise(resolve => { release = resolve; }); }, onBusy: () => busy++ });
  input.write('native-checkpoint-read\n'); await tick(); assert.equal(reader.status().commandBusy, true);
  input.write('retry\nstatus\n'); await tick(); assert.equal(busy, 1); assert.deepEqual(seen, ['native-checkpoint-read', 'status']);
  release(); await tick(); input.write('finish\n'); await reader.waitForClose(); input.destroy();
});
test('main-world public grant read is serialized while status stays available and never aliases stage retry', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0;
  const reader = createNativeLiveInput({ input, async onCommand(value) { seen.push(value);
    if (value === 'main-world-grant-read') await new Promise(resolve => { release = resolve; }); }, onBusy: () => busy++ });
  input.write('main-world-grant-read\n'); await tick(); assert.equal(reader.status().commandBusy, true);
  input.write('retry\nstatus\n'); await tick(); assert.equal(busy, 1); assert.deepEqual(seen, ['main-world-grant-read', 'status']);
  release(); await tick(); input.write('finish\n'); await reader.waitForClose(); input.destroy();
});
test('manual pause recovery is a fixed serialized command while status and signing replies remain routable', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0, protocol = 0;
  const reader = createNativeLiveInput({ input,
    acceptProtocolLine: line => { if (line === 'fixture-signing-reply') { protocol++; return true; } return false; },
    async onCommand(value) { seen.push(value); if (value === 'main-world-recover-pause') await new Promise(resolve => { release = resolve; }); },
    onBusy: () => busy++ });
  input.write('main-world-recover-pause\n'); await tick(); assert.equal(reader.status().commandBusy, true);
  input.write('continue\nstatus\nfixture-signing-reply\n'); await tick();
  assert.equal(busy, 1); assert.equal(protocol, 1); assert.deepEqual(seen, ['main-world-recover-pause', 'status']);
  release(); await tick(); input.write('continue\n'); await tick();
  assert.deepEqual(seen, ['main-world-recover-pause', 'status', 'continue']);
  input.write('finish\n'); await reader.waitForClose(); input.destroy();
});
test('consulting diagnostic remains available during a stage and recovery cannot run concurrently', async () => {
  const input = new PassThrough(), seen = []; let release, busy = 0;
  const reader = createNativeLiveInput({ input, async onCommand(value) { seen.push(value);
    if (value === 'continue') await new Promise(resolve => { release = resolve; }); }, onBusy: () => busy++ });
  input.write('continue\n'); await tick(); input.write('consulting-status\nconsulting-recover\n'); await tick();
  assert.deepEqual(seen, ['continue', 'consulting-status']); assert.equal(busy, 1);
  release(); await tick(); input.write('consulting-recover\n'); await tick();
  assert.equal(seen.at(-1), 'consulting-recover'); input.write('finish\n'); await reader.waitForClose(); input.destroy();
});
