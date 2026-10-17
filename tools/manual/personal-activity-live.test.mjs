import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createPersonalActivityLiveQa, installPersonalActivityObserver, personalActivityControl,
  readPersonalActivityProof, disposePersonalActivityObserver } from './personal-activity-live.mjs';
import { guardHumanConsultingOwner } from './human-consulting-live.mjs';
import { createGameplayActivityProfile, gameplayActivityStatement } from '../../client/native-pod/gameplay-activity.mjs';

// Isolated test ports only. These fixtures never launch a browser or call a
// live service, and establish no real activity, retention or learner outcome.
const owner = { accountId: 'fixture-owner', subjectDid: 'did:example:owner', podUrl: 'https://pods.example/fixture-owner/' };
const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const flags = () => Object.fromEntries(['genuineHumanOutcome', 'futureActivityOnly', 'intentConfirmedBeforeDelivery',
  'exactPrivateCheckpoint', 'verifiedNativeDigest', 'exactPrivateLrsReadback', 'boundedExactConsent', 'sharingStopped', 'noAchievementClaims'].map(key => [key, true]));

function pageFixture({ unknownKey = false, failedRead = false, failedFence = false } = {}) {
  const events = []; let open = true, elapsed = 0, readFailed = failedRead;
  const page = { isClosed: () => false, locator(selector) { return {
    isVisible: async () => selector === '#menu' ? open : true,
    click: async () => { events.push('click:' + selector); if (selector === '#btn-resume') open = false; if (selector === '#btn-menu') open = true; },
    getAttribute: async () => '', waitFor: async () => {},
    fill() { throw Error('A questionnaire must not be used.'); },
  }; },
  async evaluate(fn, input) {
    if (fn === guardHumanConsultingOwner) { events.push('owner-check'); return true; }
    if (fn === installPersonalActivityObserver) { events.push('observer'); return true; }
    if (fn === disposePersonalActivityObserver) { events.push('dispose'); return true; }
    if (fn === personalActivityControl) { events.push('control:' + input.action); return { ready: elapsed >= 35000 }; }
    if (fn === readPersonalActivityProof) { events.push('private-read'); if (readFailed) { readFailed = false; throw Error('PRIVATE-RAW-ERROR'); } return flags(); }
    throw Error('Unexpected evaluation.');
  },
  waitForFunction: async () => events.push('real-product-wait'),
  waitForTimeout: async ms => { assert.equal(ms, 1000); elapsed += ms; events.push('one-second'); },
  bringToFront: async () => events.push('focus'),
  keyboard: { async press(key) { assert.equal(key, '1'); events.push('key:1'); if (unknownKey) throw Error('PRIVATE-INPUT-UNKNOWN'); } },
  };
  const qa = createPersonalActivityLiveQa({ getPage: () => page, getOwner: () => owner, gameOrigin, relayOrigin,
    checkpoint: async ({ kind }) => { events.push(kind); if (failedFence) throw Error('durable checkpoint failed'); } });
  return { qa, events };
}

test('personal activity helper import and construction perform no I/O', () => {
  const url = new URL('./personal-activity-live.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `globalThis.fetch=()=>{throw Error('IO')};Object.defineProperty(process,'stdin',{get(){throw Error('IO')}});await import(${JSON.stringify(url)});process.stdout.write('offline')`],
    { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'offline');
  let called = false; const forbidden = () => { called = true; };
  createPersonalActivityLiveQa({ getPage: forbidden, getOwner: forbidden, gameOrigin, relayOrigin, checkpoint: forbidden });
  assert.equal(called, false);
  assert.throws(() => createPersonalActivityLiveQa({ getPage: forbidden, getOwner: forbidden, gameOrigin, relayOrigin }), TypeError);
});
test('one future ability follows durable enable/input fences, then Stop, exact reads and real stopped waiting', async () => {
  const f = pageFixture(); await f.qa.run();
  assert.equal(f.qa.status().complete, true); assert.equal(f.qa.status().noAutomaticResend, true);
  const ordered = ['observer', 'activity-delivery-intent', 'control:enable', 'activity-input-intent', 'click:#btn-resume',
    'control:input', 'key:1', 'control:stop', 'private-read', 'control:stopped', 'dispose'];
  let position = -1; for (const event of ordered) { const next = f.events.indexOf(event); assert(next > position, event); position = next; }
  assert.equal(f.events.filter(e => e === 'one-second').length, 35);
  const count = f.events.length; await f.qa.run(); assert.equal(f.events.length, count);
  assert(!JSON.stringify(f.qa.status()).includes(owner.subjectDid));
});
test('failed enable fence never enables, while unknown input and private readback never repeat input or enable', async () => {
  const before = pageFixture({ failedFence: true }); await assert.rejects(before.qa.run()); assert(!before.events.includes('control:enable'));
  for (const fault of [{ unknownKey: true }, { failedRead: true }]) {
    const f = pageFixture(fault); await assert.rejects(f.qa.run(), error => !error.message.includes('PRIVATE'));
    assert.equal(f.qa.status().stopped, true);
    await f.qa.run();
    assert.equal(f.events.filter(e => e === 'key:1').length, 1);
    assert.equal(f.events.filter(e => e === 'control:enable').length, 1);
    assert.equal(f.events.filter(e => e === 'control:stop').length, 1);
  }
});

function readFixture() {
  const sessionId = 'cdb00ce9-1b12-4f32-b193-3383987b6f63', consentSession = 'coaching-session';
  const delegateDid = 'did:example:delegate', binding = { subjectDid: owner.subjectDid, podUrl: owner.podUrl, authenticatedAgentDid: delegateDid };
  const profile = createGameplayActivityProfile({ ownerDid: owner.subjectDid, characterId: owner.accountId, sessionId });
  profile.record({ type: 'ability.executed', body: { id: owner.accountId, kind: 'character' }, actor: { kind: 'human-input' }, object: { id: 'strike', kind: 'ability' }, result: { success: true } });
  const event = profile.save().recent[0], statement = gameplayActivityStatement(event, owner.subjectDid);
  const contract = { descriptorUrl: 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/affordance',
    write: { action: 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/write-own-subject-xapi-statements-signed', target: 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject', method: 'POST' },
    read: { action: 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/read-own-subject-xapi-statements-signed', target: 'https://foxxi-bridge.interego.xwisee.com/agent/xapi-statements/own-subject/read', method: 'POST' } };
  const head = { cid: 'fixture-cid', descriptorUrl: 'https://pods.example/fixture.ttl' };
  const opened = { head, digest: 'graph-nquads-sha256:' + 'a'.repeat(64), record: { ownerDid: owner.subjectDid,
    save: { char: { x: { activity: profile.save(), learningDelivery: { schema: 'hallowmarch.gameplay-learning-delivery/v1', ownerDid: owner.subjectDid,
      characterId: owner.accountId, throughOrdinal: event.ordinal, acknowledgedCount: 1, pending: null } } } } } };
  const history = { ownerDid: owner.subjectDid, consents: [{ purpose: 'record-gameplay-activity', recipient: contract.write.target,
    taskId: 'hallowmarch-activity:' + owner.accountId + ':' + consentSession, sessionId: consentSession,
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 899000).toISOString(), revoked: true }] };
  const transport = { acct: { id: owner.accountId, nativeBound: true }, token: 'PRIVATE-BEARER', generation: 1, reload: false };
  const player = {}, game = { GAME: { started: true, player }, net: { NETWS: transport }, SAVE: { native: true, readConfirmed: true },
    activity: { snapshot: () => profile.snapshot() }, learningDelivery: { status: { enabled: false } } };
  const pinned = { game, player, transport, token: transport.token, generation: 1, ...owner, binding };
  const trace = { pinned, owner, writes: 1, stopped: true, ambiguous: false, startOrdinal: 0, gameplaySessionId: sessionId,
    inputAttempted: true, before: { executed: 0, refused: 0 }, memo: { payload: { subject_did: owner.subjectDid, purpose: 'personal-performance', statements: [statement] },
      events: [event], contract, signer: delegateDid, intentConfirmed: true } };
  const lrs = { ...structuredClone(statement), authority: { objectType: 'Agent', name: 'fixture-LRS' }, stored: new Date().toISOString(), version: '1.0.3' };
  const calls = [];
  class RelayMcpTransport {
    connect() { return Promise.resolve({ granted: [] }); } setCredential() {}
    async callTool(name, input) {
      calls.push(name);
      if (name === 'get_pod_status') return { pod: owner.podUrl, identity: { did: owner.subjectDid }, sessionAgent: { did: delegateDid } };
      if (name === 'dereference') return { status: 'ok', affordances: [{ action: contract.read.action, target: contract.read.target, method: 'POST' }] };
      if (name === 'sign_request') return { _signed_payload: JSON.stringify({ ...input.payload, agent_id: delegateDid, subject_pod_url: owner.podUrl, timestamp: new Date().toISOString() }), _signature: 'fixture-signature' };
      if (name === 'act') return { status: 200, body: { ok: true, durable: true, subjectDid: owner.subjectDid, statement: lrs } };
      throw Error('No writes are allowed.');
    }
  }
  const modules = [{ createBrowserAccessCache: () => ({ get: async () => ({ expiresAt: Date.now() + 3600000,
    credential: { kind: 'relay-oauth-bearer', accessToken: 'PRIVATE-BEARER', refreshToken: null } }), close: async () => {} }) },
  { createNativePodClient: () => ({ connect: async () => {}, load: async ({ graphIri }) => graphIri === 'urn:index' ? { record: {} } : opened,
    currentHead: async () => head, close() {} }) },
  { playerProfileIndexGraphIri: async () => 'urn:index', validatePlayerProfileIndex: () => 'urn:character' },
  { createOwnerPerformanceConsultation: () => ({ connect: async () => {}, read: async () => history, close() {} }) },
  { gameplayActivityStatement }, { RelayMcpTransport }];
  const context = vm.createContext({ window: { __hm: game, __hmNativeHumanConsultingOwner: pinned, __hmNativePersonalActivityTrace: trace },
    location: { origin: gameOrigin }, AbortSignal, Date, JSON, Number, Object, Array, Set, crypto: { randomUUID: () => 'read-only-session' },
    fetch: async () => ({ ok: true, json: async () => ({ bound: true, verified: true, account: { id: owner.accountId }, binding }) }) });
  const read = vm.runInContext('(' + readPersonalActivityProof.toString() + ')', context);
  return { trace, event, lrs, opened, history, game, pinned, calls, read: () => read({ owner, relayOrigin, gameOrigin }, modules) };
}
test('independent reader verifies exact native checkpoint, own consent and actual LRS body without writes', async () => {
  const f = readFixture(), result = await f.read();
  for (const [key, value] of Object.entries(result)) assert.equal(value, true, key);
  assert.equal(f.calls.filter(name => name === 'act').length, 1);
  assert.deepEqual(f.calls, ['get_pod_status', 'dereference', 'sign_request', 'act']);
});
test('a concurrently advanced native character head requests only read polling before any LRS call', async () => {
  const f = readFixture(); f.opened.head = { ...f.opened.head, cid: 'a-new-owner-save' };
  const result = await f.read(); assert.deepEqual(Object.keys(result), ['sharingStopped']); assert.equal(result.sharingStopped, false);
  assert.deepEqual(f.calls, []);
});
for (const [label, mutate, flag] of [
  ['another body', f => { f.trace.memo.events[0].body.id = 'other-player'; }, 'genuineHumanOutcome'],
  ['older activity', f => { f.trace.startOrdinal = 1; }, 'futureActivityOnly'],
  ['unconfirmed intent', f => { f.trace.memo.intentConfirmed = false; }, 'intentConfirmedBeforeDelivery'],
  ['pending private marker', f => { f.opened.record.save.char.x.learningDelivery.pending = {}; }, 'exactPrivateCheckpoint'],
  ['unsigned native digest', f => { f.opened.digest = 'not-native'; }, 'verifiedNativeDigest'],
  ['another LRS statement', f => { f.lrs.object.id = 'urn:other'; }, 'exactPrivateLrsReadback'],
  ['broader consent', f => { f.history.consents[0].expiresAt = new Date(Date.now() + 1800000).toISOString(); }, 'boundedExactConsent'],
  ['not withdrawn', f => { f.history.consents[0].revoked = false; }, 'sharingStopped'],
]) test('independent reader refuses ' + label, async () => {
  const f = readFixture(); mutate(f); const result = await f.read(); assert.equal(result[flag], false);
});
