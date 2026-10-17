import assert from 'node:assert/strict';
import test from 'node:test';
import { installNativeOwnerQaSession } from './native-owner-qa-session.mjs';

const owner = { subjectDid: 'did:example:qa', podUrl: 'https://pods.example/u-pk-qa/', accountId: 'qa-account' };
const config = { run: 'qa-run', owner, relayOrigin: 'https://relay.example', expected: { v: 1, qa: { run: 'qa-run', privateMarker: 'PRIVATE_BODY' } }, passphrase: 'PRIVATE_PASSPHRASE' };
function fixture({ registerFailure = false, lostAck = false, notFresh = false, checkpointReadError = null, readWire = false } = {}) {
  const count = { clients: 0, profiles: 0, keyCreates: 0, registrations: 0, exports: 0, sets: 0, publishes: 0, confirms: 0, links: 0, checkpointReads: 0 };
  let keyPresent = false, keyRegistered = false, saved = false, pending = false, linked = false, heldSave;
  class Transport {
    async callTool(name) {
      if (name === 'get_descriptor' && registerFailure) { registerFailure = false; return { error: 'PRIVATE_REASON_URL_TOKEN', code: 403 }; }
      if (name === 'register_agent') count.registrations++;
      return {};
    }
  }
  const createNativePodClient = ({ transport, fetch: nativeFetch }) => {
    count.clients++;
    return { async connect() {
        await transport.callTool('get_pod_status', {});
        await transport.callTool('get_current_head', { urn: 'urn:graph:hallowmarch:player-profile-index:fixture' });
        return { keyPresent, hasRecord: notFresh };
      },
      async registerKey() {
        const result = await transport.callTool('get_descriptor', { url: owner.podUrl + 'agents' });
        if (result.error) throw Object.assign(new Error('PRIVATE_TOKEN_IN_ERROR'), { code: 'native_refused' });
        await transport.callTool('register_agent', {}); keyRegistered = true;
      },
      async createKey() { count.keyCreates++; keyPresent = true; await this.registerKey(); },
      async keyStatus() { return { keyPresent, keyRegistered }; },
      async currentHead({ graphIri, checkpoint }) {
        count.checkpointReads++; assert.equal(graphIri, 'urn:graph:hallowmarch:player-profile:fixture');
        assert.equal(checkpoint, 'hallowmarch-character/v1');
        if (readWire) await nativeFetch(owner.podUrl + 'hallowmarch/checkpoints/' + 'a'.repeat(64) + '.json',
          { method: 'GET', headers: { Authorization: 'Bearer PRIVATE_NATIVE_BEARER' } });
        if (checkpointReadError) throw checkpointReadError;
        return { proofKind: 'owner-key-authenticated-checkpoint', nativeRevision: 'PRIVATE_REVISION_NOT_EMITTED' };
      },
      async publish() { count.publishes++; await transport.callTool('publish_context', { graph_iri: 'urn:graph:profile' }); },
      status: () => ({ pending: pending ? 1 : 0 }), close() {},
    };
  };
  const createPlayerPodProfile = input => {
    count.profiles++; const native = input.createClient(input); let state = 'connecting', profileKey = false;
    const finish = async () => { await input.request('/gaming/identity/record-link', { method: 'POST', body: {
      kind: 'character', graphIri: 'urn:graph:profile', descriptorUrl: 'https://pods.example/descriptor', cid: 'qa-cid' } }); linked = saved = true; state = 'saved'; };
    return { async connect() { const result = await native.connect(); profileKey = result.keyPresent;
        if (profileKey) await native.registerKey(); return result; },
      async createKey() { await native.createKey(); profileKey = true; },
      async exportRecovery() { count.exports++; return { encrypted: 'CIPHERTEXT_NOT_PRIVATE_KEY' }; },
      async set(save) { count.sets++; heldSave = save; await native.publish();
        if (lostAck) { pending = true; state = 'uncertain'; throw Object.assign(new Error('pending'), { code: 'pod_pending' }); }
        await finish(); },
      async retry() { count.confirms++; pending = false; await finish(); },
      async get() { return { exists: saved, data: () => heldSave }; },
      status: () => ({ state, keyPresent: profileKey, pending, hasRecord: saved || pending, indexed: saved, linked }), close() {},
    };
  };
  const modules = [{ createBrowserAccessCache: () => ({
    get: async () => ({ credential: { accessToken: 'PRIVATE_BEARER', expiresAt: Date.now() + 60000 }, expiresAt: Date.now() + 60000 }), close: async () => {},
  }) }, { createNativePodClient }, { createPlayerPodProfile,
    playerProfileGraphIri: async did => { assert.equal(did, owner.subjectDid); return 'urn:graph:hallowmarch:player-profile:fixture'; } }, { RelayMcpTransport: Transport }];
  return { modules, count };
}
async function withBrowserEnvironment(run) {
  const original = { fetch: globalThis.fetch, location: globalThis.location, localStorage: globalThis.localStorage };
  globalThis.location = { host: 'game.example' }; globalThis.localStorage = { getItem: () => 'APP_TOKEN' };
  globalThis.fetch = async (path, init) => {
    if (init.body) { assert(!init.body.includes('PRIVATE_BODY')); assert.equal(Object.keys(JSON.parse(init.body)).length, 4); }
    return { ok: true, json: async () => ({ verified: true, binding: owner, account: { id: owner.accountId } }) };
  };
  try { await run(); } finally {
    await globalThis.__hmNativeQaSession?.close(); delete globalThis.__hmNativeQaSession;
    for (const [key, value] of Object.entries(original)) { if (value === undefined) delete globalThis[key]; else globalThis[key] = value; }
  }
}
test('registration refusal retains original key/profile and emits fixed codes without sensitive details', async () => withBrowserEnvironment(async () => {
  const { modules, count } = fixture({ registerFailure: true });
  await installNativeOwnerQaSession(config, modules);
  const failed = await globalThis.__hmNativeQaSession.ensureSaved();
  assert.equal(failed.ok, false); assert.equal(failed.step, 'recipient-registry-read'); assert.equal(failed.code, 'native_refused');
  assert(failed.tools.some(value => value.step === 'owner-index-head'), 'head lookup uses native urn input, not publish graph_iri input');
  assert.equal(failed.tools.at(-1).numericCode, 403); assert.equal(failed.tools.at(-1).code, 'operation_failed');
  assert(!JSON.stringify(failed).includes('PRIVATE_'));
  const before = { ...count }; await globalThis.__hmNativeQaSession.diagnose(); assert.deepEqual(count, before);
  const complete = await globalThis.__hmNativeQaSession.ensureSaved(); assert.equal(complete.ok, true);
  assert.deepEqual([count.clients, count.profiles, count.keyCreates, count.sets, count.publishes, count.exports], [1, 1, 1, 1, 1, 1]);
}));
test('lost publication ack survives manual pause and retry without duplicate create or payload leak', async () => withBrowserEnvironment(async () => {
  const { modules, count } = fixture({ lostAck: true }); await installNativeOwnerQaSession(config, modules);
  const failed = await globalThis.__hmNativeQaSession.ensureSaved({ confirmationMs: 0 });
  assert.equal(failed.ok, false); assert.equal(failed.code, 'qa_confirmation_timeout'); assert.equal(failed.pending, true);
  await assert.rejects(installNativeOwnerQaSession({ ...config, owner: { ...owner, subjectDid: 'did:example:other' } }, modules), { code: 'qa_scope_mismatch' });
  await installNativeOwnerQaSession(config, modules);
  const complete = await globalThis.__hmNativeQaSession.ensureSaved(); assert.equal(complete.ok, true);
  assert.deepEqual([count.clients, count.profiles, count.keyCreates, count.sets, count.publishes, count.confirms], [1, 1, 1, 1, 1, 1]);
  assert.deepEqual(globalThis.__hmNativeQaSession.encryptedRecovery(), { encrypted: 'CIPHERTEXT_NOT_PRIVATE_KEY' });
}));
test('an existing owner record blocks this fresh-owner fixture permanently on retries', async () => withBrowserEnvironment(async () => {
  const { modules, count } = fixture({ notFresh: true }); await installNativeOwnerQaSession(config, modules);
  for (let i = 0; i < 2; i++) assert.equal((await globalThis.__hmNativeQaSession.ensureSaved()).code, 'qa_owner_not_fresh');
  assert.deepEqual([count.keyCreates, count.sets, count.publishes], [0, 0, 0]);
}));
test('explicit checkpoint read authenticates the original record without confirm, publication or new key and emits no payload', async () => withBrowserEnvironment(async () => {
  const { modules, count } = fixture(); await installNativeOwnerQaSession(config, modules);
  assert.equal((await globalThis.__hmNativeQaSession.checkpointRead()).code, 'not_connected');
  await globalThis.__hmNativeQaSession.ensureSaved(); const before = { ...count };
  const result = await globalThis.__hmNativeQaSession.checkpointRead();
  assert.deepEqual(result, { ok: true, found: true, checkpointVerified: true, hasNativeRevision: true });
  assert.deepEqual(count, { ...before, checkpointReads: before.checkpointReads + 1 });
  assert(!JSON.stringify(result).includes('PRIVATE'));
}));
test('checkpoint transport captures only actual method/status and preserves request', async () => withBrowserEnvironment(async () => {
  const { modules } = fixture({ readWire: true }); await installNativeOwnerQaSession(config, modules);
  await globalThis.__hmNativeQaSession.ensureSaved(); const originalFetch = globalThis.fetch;
  const response = { ok: false, status: 403, privateBody: 'PRIVATE_RESPONSE_BODY' };
  globalThis.fetch = async (url, init) => {
    assert.equal(url, owner.podUrl + 'hallowmarch/checkpoints/' + 'a'.repeat(64) + '.json');
    assert.equal(init.method, 'GET'); assert.equal(init.headers.Authorization, 'Bearer PRIVATE_NATIVE_BEARER'); return response;
  };
  try {
    await globalThis.__hmNativeQaSession.checkpointRead(); const report = globalThis.__hmNativeQaSession.status();
    const wire = report.tools.at(-1); assert.equal(wire.step, 'native-checkpoint-get'); assert.equal(wire.outcome, 'refused');
    assert.equal(wire.code, null); assert.equal(wire.numericCode, 403); assert(Number.isSafeInteger(wire.elapsedMs) && wire.elapsedMs >= 0);
    assert(!JSON.stringify(report).includes('PRIVATE'));
  } finally { globalThis.fetch = originalFetch; }
}));
for (const code of ['checkpoint_binding_pending', 'invalid_checkpoint', 'invalid_checkpoint_sender', 'INTEGRITY', 'HTTP']) {
  test('read-only checkpoint diagnosis preserves fixed ' + code + ' and safe HTTP status', async () => withBrowserEnvironment(async () => {
    const { modules, count } = fixture({ checkpointReadError: Object.assign(Error('PRIVATE_REASON_BODY_TOKEN'), { code, status: 401 }) });
    await installNativeOwnerQaSession(config, modules); await globalThis.__hmNativeQaSession.ensureSaved(); const before = { ...count };
    assert.deepEqual(await globalThis.__hmNativeQaSession.checkpointRead(), { ok: false, code, numericCode: 401, checkpointStage: null, checkpointCheck: null });
    assert.deepEqual(count, { ...before, checkpointReads: before.checkpointReads + 1 });
  }));
}
test('checkpoint diagnosis admits only fixed stage names and drops all other thrown fields', async () => withBrowserEnvironment(async () => {
  const { modules } = fixture({ checkpointReadError: Object.assign(Error('PRIVATE_REASON'), {
    code: 'invalid_checkpoint', checkpointStage: 'binding-plan', checkpointCheck: 'binding-record-value', body: 'PRIVATE_BODY', token: 'PRIVATE_TOKEN' }) });
  await installNativeOwnerQaSession(config, modules); await globalThis.__hmNativeQaSession.ensureSaved();
  assert.deepEqual(await globalThis.__hmNativeQaSession.checkpointRead(),
    { ok: false, code: 'invalid_checkpoint', numericCode: null, checkpointStage: 'binding-plan', checkpointCheck: 'binding-record-value' });
}));
test('unrecognized checkpoint check never escapes as diagnostic text', async () => withBrowserEnvironment(async () => {
  const { modules } = fixture({ checkpointReadError: Object.assign(Error('PRIVATE_REASON'), {
    code: 'invalid_checkpoint', checkpointStage: 'PRIVATE_STAGE', checkpointCheck: 'PRIVATE_KEY_BODY' }) });
  await installNativeOwnerQaSession(config, modules); await globalThis.__hmNativeQaSession.ensureSaved();
  assert.deepEqual(await globalThis.__hmNativeQaSession.checkpointRead(),
    { ok: false, code: 'invalid_checkpoint', numericCode: null, checkpointStage: null, checkpointCheck: null });
}));
