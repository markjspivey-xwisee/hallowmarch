import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { nativeCompanionOptIn, createNativeCompanionLiveQa } from './native-companion-live.mjs';
import { createNativeCompanionSigningBroker } from './native-companion-signing.mjs';

const configured = { HM_NATIVE_COMPANION_LIVE_TEST: '1', HM_NATIVE_LIVE_TEST: '1',
  HM_NATIVE_ORIGIN: 'https://game.example', HM_NATIVE_RELAY_ORIGIN: 'https://relay.example' };

test('companion opt-in is disabled unless its flag is exactly 1', () => {
  for (const value of [undefined, '', '0', 'true', 'yes', '01', ' 1', '1 ', 1, true]) {
    assert.equal(nativeCompanionOptIn({ ...configured, HM_NATIVE_COMPANION_LIVE_TEST: value }), false);
    // Inactive mode does not even inspect live configuration or secrets.
    assert.equal(nativeCompanionOptIn({ HM_NATIVE_COMPANION_LIVE_TEST: value, DEBUG: '1' }), false);
  }
  assert.equal(nativeCompanionOptIn(configured), true);
});

test('exact companion opt-in requires the separate native QA flag and clean HTTPS origins', () => {
  for (const flag of [undefined, '', '0', 'true', 1]) assert.throws(() => nativeCompanionOptIn({ ...configured, HM_NATIVE_LIVE_TEST: flag }),
    { code: 'qa_companion_opt_in' });
  for (const origins of [
    { HM_NATIVE_ORIGIN: undefined }, { HM_NATIVE_RELAY_ORIGIN: undefined },
    { HM_NATIVE_ORIGIN: 'http://game.example' }, { HM_NATIVE_RELAY_ORIGIN: 'http://relay.example' },
    { HM_NATIVE_ORIGIN: 'https://game.example/' }, { HM_NATIVE_ORIGIN: 'https://game.example/path' },
    { HM_NATIVE_ORIGIN: 'https://game.example?secret=DO_NOT_FORWARD' },
    { HM_NATIVE_RELAY_ORIGIN: 'https://user:DO_NOT_FORWARD@relay.example' },
    { HM_NATIVE_RELAY_ORIGIN: 'https://relay.example/#DO_NOT_FORWARD' },
    { HM_NATIVE_RELAY_ORIGIN: configured.HM_NATIVE_ORIGIN },
  ]) assert.throws(() => nativeCompanionOptIn({ ...configured, ...origins }),
    error => error.code === 'qa_companion_origin' && !error.message.includes('DO_NOT_FORWARD'));
});

test('every known debug or tracing flag disables an otherwise opted-in session', () => {
  for (const name of ['DEBUG', 'PWDEBUG', 'PW_TEST_TRACE', 'NODE_DEBUG']) {
    for (const value of ['1', '0', '*']) assert.throws(() => nativeCompanionOptIn({ ...configured, [name]: value }), { code: 'qa_companion_opt_in' });
    assert.equal(nativeCompanionOptIn({ ...configured, [name]: '' }), true);
  }
});

test('disabled constructors refuse before accessing signing, owner, HTTP or output ports', () => {
  let accesses = 0;
  const ownerPort = new Proxy({}, { get() { accesses++; throw Error('OWNER_PORT_MUST_NOT_BE_ACCESSED'); } });
  const forbidden = () => { accesses++; throw Error('PORT_MUST_NOT_BE_CALLED'); };
  for (const enabled of [undefined, false, '1', 1, 'true']) {
    assert.throws(() => createNativeCompanionLiveQa({ enabled, ownerPort, signNativeRequest: forbidden,
      request: forbidden, onStage: forbidden }), { code: 'qa_companion_opt_in' });
    assert.throws(() => createNativeCompanionSigningBroker({ enabled, writePublicRequest: forbidden }), { code: 'qa_companion_opt_in' });
  }
  assert.equal(accesses, 0);
});

test('live construction checks origins and ports without initiating a stage', () => {
  let calls = 0;
  const port = () => { calls++; throw Error('PORT_MUST_NOT_BE_CALLED'); };
  const options = { enabled: true, gameOrigin: configured.HM_NATIVE_ORIGIN, relayOrigin: configured.HM_NATIVE_RELAY_ORIGIN,
    expectedOwner: { accountId: 'fixture-account', subjectDid: 'did:web:identity.example:users:fixture', podUrl: 'https://pods.example/fixture/' },
    agentDid: 'did:web:identity.example:agents:fixture', agentPodUrl: 'https://pods.example/fixture-agent/',
    ownerPort: Object.fromEntries(['enterAndSpawn', 'publish', 'readback', 'register', 'localRevoke', 'ownerPodRevoke'].map(name => [name, port])),
    signNativeRequest: port, request: port, onStage: port };
  const qa = createNativeCompanionLiveQa(options);
  assert.equal(qa.status().stage, 'native-companion-discovery');
  assert.equal(qa.status().completed, 0);
  assert.equal(qa.status().hasKey, false);
  assert.equal(qa.status().hasAdmission, false);
  qa.close();
  assert.equal(qa.status().closed, true);
  assert.equal(calls, 0);
  assert.throws(() => createNativeCompanionLiveQa({ ...options, relayOrigin: options.gameOrigin }), { code: 'qa_companion_scope' });
  assert.throws(() => createNativeCompanionLiveQa({ ...options, ownerPort: {} }), { code: 'qa_companion_owner_port' });
  assert.throws(() => createNativeCompanionLiveQa({ ...options, signNativeRequest: null }), { code: 'qa_companion_signing_port' });
  assert.equal(calls, 0);
});

test('imports and manual signing do not read stdin, credential files or invoke network APIs', () => {
  const signingUrl = new URL('./native-companion-signing.mjs', import.meta.url).href;
  const liveUrl = new URL('./native-companion-live.mjs', import.meta.url).href;
  const moduleSources = [signingUrl, liveUrl, new URL('./native-live-stages.mjs', import.meta.url).href,
    new URL('../../server/gaming/native-agent-proof.js', import.meta.url).href,
    new URL('../../client/native-pod/owner-agent-grant-schema.mjs', import.meta.url).href];
  const script = `
    import fs from 'node:fs';
    import fsPromises from 'node:fs/promises';
    import net from 'node:net';
    import http from 'node:http';
    import https from 'node:https';
    import { syncBuiltinESMExports } from 'node:module';
    import { fileURLToPath } from 'node:url';
    import { generateKeyPairSync, randomBytes, randomUUID } from 'node:crypto';
    import assert from 'node:assert/strict';
    const forbidden = () => { throw Error('AUTONOMOUS_IO'); };
    Object.defineProperty(process, 'stdin', { configurable: true, get: forbidden });
    globalThis.fetch = forbidden;
    for (const module of [net, http, https]) {
      for (const name of ['connect', 'createConnection', 'request', 'get', 'createServer']) if (typeof module[name] === 'function') module[name] = forbidden;
    }
    // Node itself loads these five source modules through public filesystem
    // functions. Permit exactly those code files, never any credential path.
    const allowedSources = new Set(${JSON.stringify(moduleSources)}.map(fileURLToPath));
    const allowSourceRead = original => function(path, ...args) {
      const selected = path instanceof URL ? fileURLToPath(path) : String(path);
      if (!allowedSources.has(selected)) forbidden();
      return Reflect.apply(original, this, [path, ...args]);
    };
    for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) fs[name] = allowSourceRead(fs[name]);
    for (const name of ['readFile', 'open']) fsPromises[name] = allowSourceRead(fsPromises[name]);
    for (const name of ['writeFile', 'writeFileSync']) fs[name] = forbidden;
    fsPromises.writeFile = forbidden;
    syncBuiltinESMExports();
    const { createNativeCompanionSigningBroker } = await import(${JSON.stringify(signingUrl)});
    const { nativeCompanionOptIn } = await import(${JSON.stringify(liveUrl)});
    assert.equal(nativeCompanionOptIn({}), false);
    let output;
    const agentDid = 'did:web:identity.example:agents:fixture', agentPodUrl = 'https://pods.example/fixture/';
    const broker = createNativeCompanionSigningBroker({ enabled: true, agentDid, agentPodUrl, writePublicRequest: value => { output = value; } });
    const payload = { purpose: 'urn:interego:gaming:agent-admission:v1', applicationId: 'did:web:game.example', audience: 'https://game.example',
      challenge: randomBytes(32).toString('base64url'), grantId: 'urn:uuid:' + randomUUID(), grantDigest: randomBytes(32).toString('hex'),
      sessionPublicKeyJwk: generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' }) };
    const result = broker.signNativeRequest({ payload, expiresAt: Date.now() + 10000 });
    const envelope = { _signed_payload: JSON.stringify({ ...payload, agent_id: agentDid, subject_pod_url: agentPodUrl, timestamp: new Date().toISOString() }), _signature: '0x' + 'ab'.repeat(65) };
    assert.equal(broker.acceptLine(JSON.stringify({ kind: 'native_companion_signed_envelope', requestId: output.requestId, envelope })), true);
    assert.deepEqual(await result, envelope);
    broker.close();
    process.stdout.write('offline-only\\n');
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', script], {
    env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000,
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, 'offline-only\n');
  assert.equal(result.stderr, '');
});
