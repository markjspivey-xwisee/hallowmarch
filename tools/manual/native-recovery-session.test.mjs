import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { recoverNativeOwnerQa } from './native-recovery-session.mjs';
globalThis.self = globalThis; // Give the actual browser bundle its browser CSPRNG port.
const [{ createNativePodClient }, { createPlayerPodProfile }, { ClientKeyVault }] = await Promise.all([
  import('../../client/native-pod/client.mjs'), import('../../client/native-pod/profile.mjs'),
  import('../../client/native-pod/vendor/interego-browser.mjs'),
]);

function fixture({ restoreFailure, replacementFailure, readFailure, restoreGate, readGate, nativeConnected = true, registrationAttempt = false } = {}) {
  const owner = { accountId: 'qa-account', subjectDid: 'did:web:identity.example:users:qa', podUrl: 'https://pods.example/qa/' };
  const expected = { v: 1, qa: { run: 'fixture-run', privateMarker: 'NEVER-OUTPUT-PRIVATE-BODY' } };
  const recovery = { ciphertext: 'NEVER-OUTPUT-RECOVERY' }, passphrase = 'NEVER-OUTPUT-PASSPHRASE';
  const calls = { profile: 0, connect: 0, create: 0, restore: 0, reads: 0, cache: 0 };
  let key = false, profileState = 'connecting', transport;
  const profile = {
    status: () => ({ state: profileState, keyPresent: key, hasRecord: true, pending: false }),
    async connect() { calls.connect++; profileState = 'key_required'; return { keyPresent: false, hasRecord: true }; },
    async createKey() { calls.create++; throw Object.assign(Error('NEVER-OUTPUT-RAW-ERROR'), { code: replacementFailure || 'recovery_required' }); },
    async get() {
      calls.reads++;
      if (!key) throw Object.assign(Error('key required'), { code: 'key_required' });
      if (readGate) await readGate;
      if (readFailure) throw Object.assign(Error('NEVER-OUTPUT-RAW-ERROR'), { code: readFailure });
      return { exists: true, data: () => expected };
    },
    async restoreRecovery(file, phrase) {
      calls.restore++; assert.equal(file, recovery); assert.equal(phrase, passphrase);
      if (restoreGate) await restoreGate;
      if (registrationAttempt) await transport.callTool('register_agent', { secret: 'NEVER-OUTPUT-ARGS' });
      if (restoreFailure) { const code = restoreFailure; restoreFailure = null; profileState = code; throw Object.assign(Error('NEVER-OUTPUT-RAW-ERROR'), { code }); }
      key = true; profileState = 'ready';
    },
  };
  const native = { status: () => ({ connected: nativeConnected, pending: 0 }), async keyStatus() { return { keyPresent: key }; } };
  const modules = [{ createBrowserAccessCache: () => ({ async get() { calls.cache++; return {
    credential: { kind: 'relay-oauth-bearer', accessToken: 'NEVER-OUTPUT-TOKEN' }, expiresAt: Date.now() + 60000,
  }; } }) }, { createPlayerPodProfile: input => { input.createClient({}); calls.profile++; return profile; } },
  { createNativePodClient: input => { transport = input.transport; return native; } },
  { RelayMcpTransport: class { async callTool() { throw Error('A recovery write reached the network fixture.'); } } }];
  const context = vm.createContext({ console, Date, Set, Object, Promise, Error, JSON, AbortSignal,
    location: { host: 'game.example' }, localStorage: { getItem: () => 'NEVER-OUTPUT-APP-TOKEN' },
    __hm: { net: { NETWS: { token: 'NEVER-OUTPUT-APP-TOKEN', generation: 1, acct: { id: owner.accountId, nativeBound: true } } } },
    fetch: async () => ({ ok: true, json: async () => ({ verified: true, binding: owner, account: { id: owner.accountId } }) }),
  });
  const run = vm.runInContext('(' + recoverNativeOwnerQa.toString() + ')', context);
  const config = { run: 'fixture-run', owner, relayOrigin: 'https://relay.example', expected, recovery, passphrase };
  return { context, run: (extra = {}, overrideModules = modules) => run({ ...config, ...extra }, overrideModules), calls, owner, modules };
}

test('a failed registration after restore retains the original profile and recovery phase/code', async () => {
  const f = fixture({ restoreFailure: 'native_refused' });
  const first = await f.run();
  assert.equal(first.ok, false); assert.equal(first.step, 'key-restore'); assert.equal(first.code, 'native_refused');
  assert.equal(first.checked, true); assert.equal(first.busy, false);
  const second = await f.run(); assert.equal(second.ok, true); assert.equal(second.complete, true);
  assert.deepEqual(f.calls, { profile: 1, connect: 1, create: 1, restore: 2, reads: 2, cache: 1 });
  assert(!JSON.stringify([first, second]).includes('NEVER-OUTPUT'));
});
test('an exact-body native read refusal is distinct from key restoration and cannot report PASS', async () => {
  const f = fixture({ readFailure: 'invalid_proof' }); const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.step, 'exact-profile-readback'); assert.equal(result.code, 'invalid_proof');
  assert.equal(result.keyPresent, true); assert.equal(result.complete, false); assert.equal(result.profilePresent, true);
});
test('native failure while checking key replacement is retained rather than mislabeled as recovery absence', async () => {
  const f = fixture({ replacementFailure: 'native_unavailable' }); const result = await f.run();
  assert.equal(result.step, 'key-replacement-rejection'); assert.equal(result.code, 'native_unavailable');
  assert.equal(result.checked, false); assert.equal(f.calls.restore, 0); assert.equal(result.complete, false);
});
test('concurrent continuations do not duplicate a pending recovery operation', async () => {
  let release; const gate = new Promise(resolve => { release = resolve; });
  const f = fixture({ restoreGate: gate }); const first = f.run();
  while (f.calls.restore === 0) await new Promise(resolve => setImmediate(resolve));
  const second = await f.run(); assert.equal(second.ok, false); assert.equal(second.code, 'operation_busy');
  assert.equal(f.calls.restore, 1); release(); assert.equal((await first).complete, true);
});
test('retained recovery refuses an owner change and sanitizes unexpected native error strings', async () => {
  const f = fixture({ restoreFailure: 'NEVER-OUTPUT-TOKEN' }); const result = await f.run();
  assert.equal(result.code, 'operation_failed'); assert(!JSON.stringify(result).includes('NEVER-OUTPUT'));
  await assert.rejects(f.run({ owner: { ...f.owner, accountId: 'another-owner' } }), { code: 'qa_scope_mismatch' });
  assert.equal(f.calls.profile, 1); assert.equal(f.calls.restore, 1);
});
test('a stale disconnected client is refused by a read-only preflight before restore or registration', async () => {
  const f = fixture({ nativeConnected: false }); const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.step, 'recovery-readiness'); assert.equal(result.code, 'qa_recovery_not_ready');
  assert.equal(f.calls.restore, 0); assert.equal(result.connected, false);
});
test('recovery refuses a missing recipient registration before any native write is forwarded', async () => {
  const f = fixture({ registrationAttempt: true }); const result = await f.run();
  assert.equal(result.ok, false); assert.equal(result.step, 'key-restore'); assert.equal(result.code, 'qa_recovery_registration_required');
  assert.equal(result.tools.length, 1); assert.equal(result.tools[0].step, 'recipient-register');
  assert.equal(result.tools[0].outcome, 'refused'); assert(!JSON.stringify(result).includes('NEVER-OUTPUT'));
});
test('an actual NativePodError from the shipped profile/client retains its exact safe code and native read phase', async () => {
  const f = fixture();
  class ReadOnlyTransport {
    async connect(required) { return { granted: required }; }
    async callTool(name) {
      assert.equal(name, 'get_pod_status');
      return { pod: f.owner.podUrl, userId: 'qa', identity: { did: 'did:web:identity.example:users:another-owner' } };
    }
  }
  const result = await f.run({}, [f.modules[0], { createPlayerPodProfile }, { createNativePodClient }, { RelayMcpTransport: ReadOnlyTransport }]);
  assert.equal(result.ok, false); assert.equal(result.step, 'profile-connect'); assert.equal(result.code, 'owner_mismatch');
  assert.equal(result.profileState, 'owner_mismatch'); assert.equal(result.complete, false);
  assert.equal(result.tools.length, 1); assert.equal(result.tools[0].step, 'native-connect'); assert.equal(result.tools[0].outcome, 'returned');
  assert(!JSON.stringify(result).includes(f.owner.subjectDid)); assert(!JSON.stringify(result).includes(f.owner.podUrl));
});
test('owner or generation changes during restore/read cannot mark recovery complete', async () => {
  for (const during of ['restore', 'read']) {
    let release; const gate = new Promise(resolve => { release = resolve; });
    const f = fixture(during === 'restore' ? { restoreGate: gate } : { readGate: gate });
    const pending = f.run();
    while (during === 'restore' ? f.calls.restore === 0 : f.calls.reads < 2) await new Promise(resolve => setImmediate(resolve));
    if (during === 'restore') f.context.__hm.net.NETWS.acct = { id: 'another-owner', nativeBound: true };
    else f.context.__hm.net.NETWS.generation++;
    release(); const result = await pending;
    assert.equal(result.ok, false); assert.equal(result.code, 'qa_binding'); assert.equal(result.complete, false);
  }
});
test('a previously complete recovery still refuses a different current owner instead of returning a cached PASS', async () => {
  const f = fixture(); assert.equal((await f.run()).ok, true);
  f.context.__hm.net.NETWS.acct = { id: 'another-owner', nativeBound: true };
  const result = await f.run(); assert.equal(result.ok, false); assert.equal(result.code, 'qa_binding');
  assert.equal(result.complete, false);
  assert.equal(f.calls.restore, 1);
});
test('the shipped client wraps a blocked recipient write but preserves its exact diagnostic refusal without forwarding', async () => {
  const f = fixture(), relay = 'https://relay.example', passphrase = 'NEVER-OUTPUT-PASSPHRASE';
  const memory = () => { let record; return { async load() { return record || null; }, async create(_scope, candidate) { return record ||= candidate; } }; };
  const source = new ClientKeyVault(JSON.stringify(['interego-client-key/v1', relay, f.owner.subjectDid, 'qa']), memory(), globalThis.crypto);
  await source.create(); const recovery = await source.backup(passphrase), storage = memory(), forwarded = [];
  class ReadOnlyTransport {
    async connect(required) { return { granted: required }; }
    async callTool(name, input) {
      forwarded.push(name);
      if (name === 'get_pod_status') return { pod: f.owner.podUrl, userId: 'qa', identity: { did: f.owner.subjectDid }, sessionAgent: { did: 'did:web:identity.example:agents:qa-delegate' } };
      if (name === 'get_current_head') return { podUrl: f.owner.podUrl, urn: input.urn, head: { cid: 'fixture-cid', descriptorUrl: f.owner.podUrl + 'fixture-descriptor' } };
      if (name === 'get_descriptor' && input.url === f.owner.podUrl + 'agents') return { turtle: '' };
      throw Error('A forbidden native operation reached the offline fixture.');
    }
  }
  const result = await f.run({ recovery, passphrase }, [f.modules[0], { createPlayerPodProfile },
    { createNativePodClient: input => createNativePodClient({ ...input, keyStorage: storage }) }, { RelayMcpTransport: ReadOnlyTransport }]);
  assert.equal(result.ok, false); assert.equal(result.step, 'key-restore'); assert.equal(result.code, 'native_unavailable');
  assert.equal(result.tools.at(-1).step, 'recipient-register'); assert.equal(result.tools.at(-1).code, 'qa_recovery_registration_required');
  assert(!forwarded.includes('register_agent')); assert(!forwarded.includes('publish_context'));
  assert(!JSON.stringify(result).includes(recovery.ciphertext)); assert(!JSON.stringify(result).includes(passphrase));
});
