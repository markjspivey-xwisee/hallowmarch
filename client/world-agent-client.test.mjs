import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createWorldAgentClient } from './world-agent-client.mjs';
import { createMainWorldAgents, WORLD_AGENT_PATHS, mainWorldAgentAffordances } from '../server/gaming/main-world-agents.js';
import { createMainWorldAgentTransport } from '../server/gaming/main-world-agent-transport.js';

// Explicit offline fixtures: native identity recovery, pod head, CAS store,
// network and owner page. Real WebCrypto Ed25519 keys/signatures are checked by
// the actual server proof implementation. This is not a live gameplay claim.
const origin = 'https://game.example', applicationId = 'did:web:identity.example:users:march';
const agentDid = 'did:ethr:0x' + 'a'.repeat(40), ownerDid = 'did:web:identity.example:users:alice';
const grantId = 'urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
const config = { grantId, roomId: 'march', entityId: 'alice' };
const graphIri = 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9);
const clone = value => structuredClone(value);
async function fixture(t) {
  let time = Date.parse('2026-10-16T12:00:00Z'), nativeReads = 0, paused = false;
  const requests = [], dispatches = [], keys = [], binding = { subjectDid: ownerDid, podUrl: 'https://pod.example/alice/' };
  const owner = { acct: { id: 'alice' }, room: { name: 'march' }, peer: 'fixture-owner-connection', ws: { readyState: 1 } };
  const transport = createMainWorldAgentTransport({ now: () => time, principalFor: () => ownerDid,
    send(client, message) {
      if (message.op === 'command') {
        dispatches.push(clone(message));
        queueMicrotask(() => transport.result(client, { requestId: message.requestId, ok: true }));
      }
    } });
  const frame = () => transport.frame(owner, { paused,
    bodies: [{ id: 'alice', name: 'Fixture character', x: 1, y: 0, z: 2, hp: 100, maxHp: 100, allowed: true }],
    targets: [{ id: 'foe:42', name: 'Fixture target', x: 1, y: 0, z: 3, hp: 40, maxHp: 40 }] });
  frame();
  const accounts = { bindingForAccount: id => id === 'alice' ? binding : null };
  const receipts = new Map(), streams = new Map();
  const authority = await createMainWorldAgents({ store: { owner: applicationId, async load(id) { return clone(streams.get(id) || { version: 0, state: null }); },
    async commit(id, input) {
      const key = id + ':' + input.idempotencyKey;
      if (receipts.has(key)) return clone(receipts.get(key));
      const prior = streams.get(id) || { version: 0, state: null };
      assert.equal(input.expectedVersion, prior.version);
      const state = { version: prior.version + 1, state: clone(input.state) };
      streams.set(id, state); receipts.set(key, clone(state)); return clone(state);
    } }, accounts, applicationId, audience: origin, ...transport, now: () => time,
    nativeCore: { recoverMessageSigner(message, signature) { assert.match(message, /^sha256:[a-f0-9]{64}$/);
      assert.equal(signature, '0x' + 'b'.repeat(130)); return agentDid.slice(9); } },
    readOwnerGrantHead: async () => { nativeReads++; return { grant: { schema: 'interego.gaming.owner-agent-grant/v1', id: grantId,
      issuer: ownerDid, actor: agentDid, applicationId, audience: origin, roomId: 'march', entityId: 'alice', role: 'teammate',
      actions: ['observe', 'move', 'attack'], maxCommandsPerSecond: 20, revoked: false,
      notBefore: '2026-10-16T11:59:59.000Z', expiresAt: '2026-10-16T12:30:00.000Z' }, ownerPodUrl: binding.podUrl,
    descriptorUrl: binding.podUrl + 'context-graphs/head.ttl', graphIri, cid: 'bafy-explicit-fixture', contentDigest: 'a'.repeat(64), observedAt: time }; },
    resolveAgentProof: async () => { nativeReads++; return { agentDid, podUrl: 'https://pod.example/agent/', mode: 'independent-key',
      signerDid: agentDid, observedAt: time, expiresAt: time + 300000 }; } });
  await authority.register({ accountId: 'alice', binding }, { grantId, graphIri });
  let transform = (url, value) => value, network = null;
  const fetch = async (url, options) => {
    assert.equal(options.credentials, 'omit'); assert.equal(options.redirect, 'error'); assert.equal(options.cache, 'no-store');
    assert.equal(options.headers.Authorization, undefined);
    const body = options.body ? JSON.parse(options.body) : null;
    requests.push({ url, method: options.method, body });
    if (network) await network(url, body);
    let value;
    if (url === origin + '/gaming/manifest') value = { mainWorldAgents: { enabled: true, scope: 'main-world', applicationId, audience: origin, affordances: origin + '/world/native-agents' } };
    else if (url === origin + '/world/native-agents') value = mainWorldAgentAffordances({ publicOrigin: origin, applicationId, enabled: true });
    else {
      const op = Object.entries(WORLD_AGENT_PATHS).find(([, path]) => origin + path === url)?.[0];
      assert(op && !['register', 'revoke'].includes(op));
      try { value = { ok: true, result: await authority[op](body) }; }
      catch (error) { return Response.json({ error: error.code || 'fixture_refusal' }, { status: 403 }); }
    }
    return Response.json(transform(url, clone(value)));
  };
  let signCalls = 0, signer = null;
  const sign_request = async ({ payload }, context) => {
    signCalls++;
    if (signer) return signer(payload, context);
    return { _signature: '0x' + 'b'.repeat(130), _signed_payload: JSON.stringify({ ...payload, agent_id: agentDid,
      subject_pod_url: 'https://pod.example/agent/', timestamp: new Date(time).toISOString() }) };
  };
  const crypto = { randomUUID: () => webcrypto.randomUUID(), subtle: new Proxy(webcrypto.subtle, {
    get(target, key) { if (key === 'generateKey') return async (...args) => {
      assert.equal(args[1], false); const result = await target.generateKey(...args); keys.push(result); return result;
    }; const value = Reflect.get(target, key); return typeof value === 'function' ? value.bind(target) : value; },
  }) };
  const client = createWorldAgentClient({ origin, applicationId, agentDid, sign_request, fetch, crypto, now: () => time });
  t.after(async () => { client.close(); transport.close(owner); await authority.close(); });
  return { client, requests, dispatches, keys, authority, frame, owner, binding,
    pause() { paused = true; frame(); }, advance(ms) { time += ms; frame(); }, reads: () => nativeReads, signCalls: () => signCalls,
    transform(fn) { transform = fn; }, network(fn) { network = fn; }, signer(fn) { signer = fn; }, time: () => time };
}

test('reusable client signs admission, real command/observation/renewal proofs and keeps its key non-extractable', async t => {
  const f = await fixture(t);
  const connected = await f.client.connect(config); assert.equal(connected.connected, true);
  assert.equal(f.keys[0].privateKey.extractable, false);
  await assert.rejects(webcrypto.subtle.exportKey('jwk', f.keys[0].privateKey));
  const reads = f.reads(), observation = await f.client.observe(); assert.equal(observation.state.body.id, config.entityId);
  assert.equal(observation.state.targets[0].id, 'foe:42');
  const ack = await f.client.move({ dx: 1, dz: 0, durationMs: 200 });
  assert.deepEqual(Object.keys(ack).sort(), ['accepted', 'execution', 'requestId']); assert.equal(ack.execution, 'owner-page-input-applied');
  await f.client.attack({ targetId: observation.state.targets[0].id }); assert.equal(f.reads(), reads);
  await f.client.renew(); assert.equal(f.reads(), reads + 2);
  assert.deepEqual(f.requests.filter(r => r.body?.sequence).map(r => r.body.sequence), [1, 2, 3, 4]);
  assert.equal(f.signCalls(), 1); assert.equal(f.requests.filter(r => r.url.endsWith('/complete')).length, 1);
  const status = JSON.stringify(f.client.status());
  for (const secret of ['privateKey', 'sessionId', '_signed_payload', '_signature', 'accessToken', 'refreshToken']) assert(!status.includes(secret));
  assert.equal(f.dispatches.length, 2); assert(Object.isFrozen(observation));
});

test('concurrent LLM tool calls serialize one shared strict sequence and snapshot their inputs', async t => {
  const f = await fixture(t); await f.client.connect(config);
  const input = { dx: 1, dz: 0, durationMs: 100 }, move = f.client.move(input); input.dx = -1;
  await Promise.all([move, f.client.observe(), f.client.renew(), f.client.attack({ targetId: 'foe:42' })]);
  assert.deepEqual(f.requests.filter(r => r.body?.sequence).map(r => r.body.sequence), [1, 2, 3, 4]);
  assert.equal(f.dispatches[0].command.dx, 1);
});

test('near-expiry tool call renews before signing gameplay input; expired lease needs fresh admission', async t => {
  const f = await fixture(t); await f.client.connect(config); f.advance(8500);
  await f.client.move({ dx: 0, dz: 1, durationMs: 50 });
  const calls = f.requests.filter(r => r.body?.sequence);
  assert(calls[0].url.endsWith('/renew')); assert(calls[1].url.endsWith('/command'));
  assert.deepEqual(calls.map(r => r.body.sequence), [1, 2]); f.advance(10001);
  await assert.rejects(f.client.observe(), { code: 'agent_connection_required' }); assert.equal(f.client.status().connected, false);
});

test('discovery pins application, audience, main-world action and exact HTTPS target before signing', async t => {
  const cases = [
    value => { value.audience = 'https://other.example'; },
    value => { value.applicationId = 'did:web:attacker.example'; },
    value => { value.operations.find(o => o['iep:action']['@id'].endsWith(':command'))['hydra:target'] = 'https://other.example/world/control'; },
    value => { value.operations.find(o => o['iep:action']['@id'].endsWith(':command'))['hydra:target'] += '?token=credential'; },
    value => { value.operations.find(o => o['iep:action']['@id'].endsWith(':command'))['hydra:method'] = 'GET'; },
    value => { value.operations.push(clone(value.operations.find(o => o['iep:action']['@id'].endsWith(':command')))); },
    value => { value.scope = 'integration-harness'; },
  ];
  for (const mutate of cases) await t.test('reject altered descriptor', async st => {
    const f = await fixture(st); f.transform((url, value) => { if (url.endsWith('/world/native-agents')) mutate(value); return value; });
    await assert.rejects(f.client.connect(config)); assert.equal(f.signCalls(), 0);
    assert.equal(f.requests.filter(r => r.method === 'POST').length, 0);
  });
});

test('challenge substitution is refused before native signing; wrong signed identity never completes', async t => {
  await t.test('substituted holder key', async st => {
    const f = await fixture(st); f.transform((url, value) => { if (url.endsWith('/challenge')) value.result.payload.sessionPublicKeyJwk.x = 'A'.repeat(43); return value; });
    await assert.rejects(f.client.connect(config), { code: 'invalid_agent_challenge' }); assert.equal(f.signCalls(), 0);
  });
  await t.test('wrong bound identity', async st => {
    const f = await fixture(st); f.signer(payload => ({ _signature: '0x' + 'b'.repeat(130), _signed_payload: JSON.stringify({ ...payload,
      agent_id: 'did:web:identity.example:agents:other', subject_pod_url: 'https://pod.example/other/', timestamp: new Date(f.time()).toISOString() }) }));
    await assert.rejects(f.client.connect(config), { code: 'native_envelope_binding_rejected' });
    assert.equal(f.requests.filter(r => r.url.endsWith('/complete')).length, 0);
  });
});

test('admission cannot substitute selected body or claim an unconfirmed native receipt', async t => {
  for (const mutate of [value => { value.result.receipt.scope.entityId = 'bob'; }, value => { value.result.authority.durable = false; }]) {
    await t.test('reject invalid admission', async st => {
      const f = await fixture(st); f.transform((url, value) => { if (url.endsWith('/complete')) mutate(value); return value; });
      await assert.rejects(f.client.connect(config), { code: 'invalid_agent_admission' }); assert.equal(f.client.status().connected, false);
    });
  }
});

test('invalid bounded inputs do not send requests or destroy an otherwise valid connection', async t => {
  const f = await fixture(t); await f.client.connect(config); const before = f.requests.length;
  for (const input of [{ dx: 2, dz: 0, durationMs: 200 }, { dx: 1, dz: 1, durationMs: 200 }, { dx: 1, dz: 0, durationMs: 501 },
    { dx: NaN, dz: 0, durationMs: 100 }, { dx: 1, dz: 0, durationMs: 200, entityId: 'bob' }]) await assert.rejects(f.client.move(input));
  await assert.rejects(f.client.attack({ targetId: 'foe:42', inventory: {} }));
  await assert.rejects(f.client.attack({ targetId: '../private' }));
  assert.equal(f.requests.length, before); assert.equal(f.client.status().connected, true);
});

test('lost command response never retries; a remote paused page refuses input and drops lease', async t => {
  await t.test('ambiguous network', async st => {
    const f = await fixture(st); await f.client.connect(config);
    // Lose the response AFTER the real authority dispatched and the fixture
    // owner page acknowledged input. A new command would duplicate that input.
    f.transform((url, value) => { if (url.endsWith('/command')) throw new Error('fixture lost response with private detail'); return value; });
    await assert.rejects(f.client.move({ dx: 1, dz: 0, durationMs: 100 }), { code: 'agent_operation_unconfirmed', uncertain: true });
    assert.equal(f.requests.filter(r => r.url.endsWith('/command')).length, 1); assert.equal(f.client.status().connected, false);
    assert.equal(f.dispatches.length, 1);
    await assert.rejects(f.client.observe(), { code: 'agent_connection_required' });
  });
  await t.test('owner paused', async st => {
    const f = await fixture(st); await f.client.connect(config); f.pause();
    await assert.rejects(f.client.move({ dx: 1, dz: 0, durationMs: 100 }), { code: 'agent_request_refused' });
    assert.equal(f.dispatches.length, 0); assert.equal(f.client.status().connected, false);
  });
});

test('execution acknowledgements and observations cannot smuggle achievements or private fields', async t => {
  for (const [suffix, mutate, call, code] of [
    ['/command', value => { value.result.execution = 'verified-kill'; }, c => c.move({ dx: 1, dz: 0, durationMs: 100 }), 'invalid_agent_execution_ack'],
    ['/observe', value => { value.result.state.privateInventory = ['fixture-private']; }, c => c.observe(), 'invalid_agent_observation'],
  ]) await t.test(suffix, async st => {
    const f = await fixture(st); await f.client.connect(config);
    f.transform((url, value) => { if (url.endsWith(suffix)) mutate(value); return value; });
    await assert.rejects(call(f.client), { code }); assert.equal(f.client.status().connected, false);
  });
});

test('close aborts an in-flight native callback and cannot resurrect a lease', async t => {
  const f = await fixture(t); let entered; const started = new Promise(resolve => { entered = resolve; });
  f.signer(() => { entered(); return new Promise(() => {}); });
  const connecting = f.client.connect(config); await started; f.client.close();
  await assert.rejects(connecting, { code: 'agent_client_closed' }); assert.equal(f.client.status().closed, true);
  assert.equal(f.requests.filter(r => r.url.endsWith('/complete')).length, 0);
  await assert.rejects(f.client.observe(), { code: 'agent_client_closed' });
});

test('runtime configuration does not accept non-HTTPS origins or an owner bearer port', () => {
  for (const value of ['http://game.example', origin + '/', origin + '/private', 'https://owner:secret@game.example']) {
    assert.throws(() => createWorldAgentClient({ origin: value, applicationId, agentDid, sign_request() {} }), { code: 'invalid_agent_configuration' });
  }
});
