import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCompanionRunnerConfig, createNativeCompanionRunner, nativeCompanionFailureCode } from './native-companion-runner.mjs';

const env = { HM_NATIVE_LIVE_TEST: '1', HM_NATIVE_COMPANION_LIVE_TEST: '1', HM_NATIVE_ORIGIN: 'https://game.example',
  HM_NATIVE_RELAY_ORIGIN: 'https://relay.example', HM_NATIVE_COMPANION_AGENT_DID: 'did:web:identity.example:agents:fixture',
  HM_NATIVE_COMPANION_AGENT_POD_URL: 'https://pods.example/fixture/' };
test('optional runner configuration requires exact opt-in and public canonical agent scope', () => {
  assert.equal(nativeCompanionRunnerConfig({}), null);
  assert.equal(nativeCompanionRunnerConfig({ HM_NATIVE_COMPANION_LIVE_TEST: 'true', DEBUG: '1' }), null);
  assert.deepEqual(nativeCompanionRunnerConfig(env), { agentDid: env.HM_NATIVE_COMPANION_AGENT_DID, agentPodUrl: env.HM_NATIVE_COMPANION_AGENT_POD_URL });
  assert.equal(nativeCompanionRunnerConfig({ ...env, HM_NATIVE_COMPANION_DIAGNOSTIC_PUBLIC_REFERENCE: '1' }).publicReferenceDiagnostics, true);
  for (const extra of [ { HM_NATIVE_COMPANION_AGENT_DID: undefined }, { HM_NATIVE_COMPANION_AGENT_DID: 'did:web:identity.example:users:fixture' },
    { HM_NATIVE_COMPANION_AGENT_DID: ' did:web:identity.example:agents:fixture' }, { HM_NATIVE_COMPANION_AGENT_POD_URL: undefined },
    { HM_NATIVE_COMPANION_AGENT_POD_URL: 'http://private.internal/fixture/' }, { HM_NATIVE_COMPANION_AGENT_POD_URL: 'https://pods.example/fixture' },
    { HM_NATIVE_COMPANION_AGENT_POD_URL: 'https://pods.example/fixture/?token=DO_NOT_LOG' },
    { HM_NATIVE_COMPANION_AGENT_POD_URL: 'https://user:DO_NOT_LOG@pods.example/fixture/' },
  ]) assert.throws(() => nativeCompanionRunnerConfig({ ...env, ...extra }), e => e.code === 'qa_companion_agent_configuration' && !e.message.includes('DO_NOT_LOG'));
});

function fixture(selectedEnv = env) {
  const calls = [], owner = { accountId: 'fixture-account', subjectDid: 'did:web:identity.example:users:fixture', podUrl: 'https://pods.example/human/' };
  let complete = false, factories = 0, attempts = 0, options;
  const page = { isClosed: () => false, async evaluate(fn, arg) {
    calls.push({ fn: fn.name, arg });
    if (fn.name === 'installNativeCompanionOwnerQaSession') return {};
    if (fn.name === 'nativeCompanionBrowserRequest') return { ok: true, status: 200, url: arg.url, value: { ok: true } };
    if (typeof arg === 'string') return { method: arg };
    return { step: 'public-scoped-grant', publicationPending: true, code: 'qa_companion_publication_pending',
      nativeCode: 'owner_mismatch', nativePendingCount: 1, nativePendingGrants: 1,
      credential: 'DO_NOT_RETURN', unexpected: 'DO_NOT_RETURN' };
  } };
  const held = { status: () => ({ stage: 'native-companion-public-grant', complete: false }),
    async next() { attempts++; if (attempts === 1) throw Error('uncertain publication'); return 'confirmed'; },
    remaining() { return this.next(); }, restartAdmission: () => 'restarted', close() { calls.push({ closed: true }); } };
  const runner = createNativeCompanionRunner({ config: nativeCompanionRunnerConfig(selectedEnv), run: 'fixture-run',
    gameOrigin: env.HM_NATIVE_ORIGIN, relayOrigin: env.HM_NATIVE_RELAY_ORIGIN, getOwner: () => owner, getPage: () => page,
    privateQaComplete: () => complete, signNativeRequest() {}, createQa(value) { options = value; factories++; return held; } });
  return { runner, calls, owner, page, setComplete() { complete = true; }, get factories() { return factories; }, get options() { return options; } };
}
test('all private stages must pass before browser installation; an uncertain grant retains its original QA/client', async () => {
  const f = fixture(); await assert.rejects(f.runner.next(), { code: 'qa_companion_private_qa_required' });
  assert.equal(f.calls.length, 0); assert.equal(f.factories, 0);
  f.setComplete(); await assert.rejects(f.runner.remaining()); assert.equal(f.factories, 1);
  assert.equal(await f.runner.next(), 'confirmed'); assert.equal(f.factories, 1);
  assert.equal(f.calls.filter(c => c.fn === 'installNativeCompanionOwnerQaSession').length, 1);
  assert.deepEqual(f.options.expectedOwner, f.owner); assert.equal(f.options.agentDid, env.HM_NATIVE_COMPANION_AGENT_DID);
  assert.equal(f.runner.restartAdmission(), 'restarted'); f.runner.close();
  await assert.rejects(f.runner.remaining(), { code: 'qa_companion_closed' });
});

test('owner calls stay in the same recovered page and public transport excludes native credentials', async () => {
  const f = fixture(); f.setComplete(); await assert.rejects(f.runner.next());
  assert.deepEqual(await f.options.ownerPort.publish(), { method: 'publish' });
  const result = await f.options.request('https://game.example/discovered-command', { method: 'POST', headers: { Accept: 'application/json' },
    body: '{"public":"challenge"}', credentials: 'same-origin', signal: new AbortController().signal, ignored: 'DO_NOT_RETURN' });
  assert.deepEqual(await result.json(), { ok: true });
  const selected = f.calls.at(-1).arg;
  assert.deepEqual(Object.keys(selected.init).sort(), ['body', 'cache', 'credentials', 'headers', 'method', 'redirect']);
  assert.equal(selected.init.credentials, 'omit'); assert(!JSON.stringify(selected).includes('DO_NOT_RETURN'));
  const status = await f.runner.ownerStatus();
  assert.equal(status.publicationPending, true); assert.equal(status.code, 'qa_companion_publication_pending');
  assert.equal(status.nativeCode, 'owner_mismatch'); assert.equal(status.nativePendingCount, 1); assert.equal(status.nativePendingGrants, 1);
  assert(!JSON.stringify(status).includes('DO_NOT_RETURN')); f.runner.close();
});
test('owner diagnostic forwarding drops foreign codes and out-of-range counts', async () => {
  const f = fixture(); f.setComplete(); await assert.rejects(f.runner.next());
  f.page.evaluate = async () => ({ nativeCode: 'DO_NOT_RETURN', nativePendingCount: 100000, nativePendingGrants: 'DO_NOT_RETURN' });
  const result = await f.runner.ownerStatus(); assert.equal(result.nativeCode, null); assert.equal(result.nativePendingCount, null);
  assert.equal(result.nativePendingGrants, null); assert(!JSON.stringify(result).includes('DO_NOT_RETURN')); f.runner.close();
});
test('only explicitly enabled, attempted, strictly shaped public references leave owner diagnostics', async () => {
  const grantId = 'urn:uuid:00000000-0000-4000-8000-000000000001';
  const reference = { grantId, graphIri: 'urn:graph:interego:gaming:owner-agent-grant:' + grantId.slice(9) };
  for (const enabled of [false, true]) {
    const f = fixture({ ...env, ...(enabled ? { HM_NATIVE_COMPANION_DIAGNOSTIC_PUBLIC_REFERENCE: '1' } : {}) });
    f.setComplete(); await assert.rejects(f.runner.next());
    f.page.evaluate = async () => ({ publicationAttempted: true, publicReference: { ...reference, ignored: 'DO_NOT_RETURN' } });
    const result = await f.runner.ownerStatus(); assert.equal(Object.hasOwn(result, 'publicReference'), enabled);
    if (enabled) assert.deepEqual(result.publicReference, reference);
    assert(!JSON.stringify(result).includes('DO_NOT_RETURN'));
    f.page.evaluate = async () => ({ publicationAttempted: true, publicReference: { grantId, graphIri: 'https://foreign.example/DO_NOT_RETURN' } });
    assert.equal(Object.hasOwn(await f.runner.ownerStatus(), 'publicReference'), false); f.runner.close();
  }
});

test('failure diagnostics use a fixed allowlist and never echo arbitrary codes', () => {
  assert.equal(nativeCompanionFailureCode({ code: 'qa_companion_signature_binding' }), 'qa_companion_signature_binding');
  assert.equal(nativeCompanionFailureCode({ code: 'qa_companion_DO_NOT_LOG' }), null);
  assert.equal(nativeCompanionFailureCode({ message: 'DO_NOT_LOG' }), null);
});
