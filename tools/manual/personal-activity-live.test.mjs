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
  'exactPrivateCheckpoint', 'verifiedNativeDigest', 'ownerKeyAuthenticatedCheckpoint', 'exactPrivateLrsReadback', 'boundedExactConsent', 'sharingStopped', 'noAchievementClaims'].map(key => [key, true]));

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
  const digest = 'graph-nquads-sha256:' + 'a'.repeat(64);
  const head = { cid: 'fixture-cid', bindingCid: 'fixture-cid', descriptorUrl: 'https://pods.example/fixture.ttl',
    recordCid: digest, nativeRevision: 'fixture-native-revision-1', proofKind: 'owner-key-authenticated-checkpoint' };
  const opened = { head, digest, proofKind: 'owner-key-authenticated-checkpoint', record: { ownerDid: owner.subjectDid,
    save: { char: { x: { activity: profile.save(), learningDelivery: { schema: 'hallowmarch.gameplay-learning-delivery/v1', ownerDid: owner.subjectDid,
      characterId: owner.accountId, throughOrdinal: event.ordinal, acknowledgedCount: 1, pending: null } } } } } };
  const history = { ownerDid: owner.subjectDid, consents: [{ purpose: 'record-gameplay-activity', recipient: contract.write.target,
    taskId: 'hallowmarch-activity:' + owner.accountId + ':' + consentSession, sessionId: consentSession,
    issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 899000).toISOString(), revoked: true }] };
  const transport = { acct: { id: owner.accountId, nativeBound: true }, token: 'PRIVATE-BEARER', generation: 1, reload: false };
  const player = { alive: true }, game = { GAME: { started: true, player }, net: { NETWS: transport }, SAVE: { native: true, readConfirmed: true },
    activity: { snapshot: () => profile.snapshot() }, consulting: { status: { privateHistoryOpen: true, enabled: false, busy: false } },
    learningDelivery: { status: { enabled: false } } };
  const pinned = { game, player, transport, token: transport.token, generation: 1, ...owner, binding };
  const consultingProof = { sessionId: consentSession, taskId: 'urn:hallowmarch:play-session:' + consentSession };
  const consultingTrace = { verifiedFirst: consultingProof };
  const trace = { pinned, owner, writes: 1, stopped: true, ambiguous: false, startOrdinal: 0, gameplaySessionId: sessionId,
    consultingTrace, consultingProof, consentSessionId: consentSession, consentTaskId: 'hallowmarch-activity:' + owner.accountId + ':' + consentSession,
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
  { createNativePodClient: () => ({ connect: async () => {}, load: async ({ graphIri, checkpoint }) => {
    if (graphIri === 'urn:index') { assert.equal(checkpoint, undefined); return { record: {} }; }
    assert.equal(checkpoint, 'hallowmarch-character/v1'); return opened;
  }, currentHead: async ({ checkpoint }) => { assert.equal(checkpoint, 'hallowmarch-character/v1'); return head; }, close() {} }) },
  { playerProfileIndexGraphIri: async () => 'urn:index', validatePlayerProfileIndex: () => 'urn:character' },
  { createOwnerPerformanceConsultation: () => ({ connect: async () => {}, read: async () => history, close() {} }) },
  { gameplayActivityStatement }, { RelayMcpTransport }];
  const context = vm.createContext({ window: { __hm: game, __hmNativeHumanConsultingOwner: pinned, __hmNativePersonalActivityTrace: trace,
      __hmNativeHumanConsultingTrace: consultingTrace },
    location: { origin: gameOrigin }, AbortSignal, Date, JSON, Number, Object, Array, Set, crypto: { randomUUID: () => 'read-only-session' },
    fetch: async () => ({ ok: true, json: async () => ({ bound: true, verified: true, account: { id: owner.accountId }, binding }) }) });
  const read = vm.runInContext('(' + readPersonalActivityProof.toString() + ')', context);
  return { trace, event, lrs, opened, history, game, pinned, calls, context, read: () => read({ owner, relayOrigin, gameOrigin }, modules) };
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
test('unchanged binding CID cannot hide a changed native revision during readback', async () => {
  const f = readFixture(); f.opened.head = { ...f.opened.head, nativeRevision: 'a-new-revision-under-same-binding' };
  const result = await f.read(); assert.equal(result.sharingStopped, false); assert.deepEqual(f.calls, []);
});
test('consent read selects the captured coaching task/session among historical revoked sessions and other scopes', async () => {
  const f = readFixture(), current = f.history.consents[0];
  const earlier = { ...current, taskId: 'hallowmarch-activity:' + owner.accountId + ':earlier-coach-session', sessionId: 'earlier-coach-session',
    issuedAt: new Date(Date.now() - 600000).toISOString(), expiresAt: new Date(Date.now() - 300000).toISOString() };
  const gameplay = { ...current, taskId: 'hallowmarch-activity:' + owner.accountId + ':' + f.trace.gameplaySessionId,
    sessionId: f.trace.gameplaySessionId, revoked: false };
  f.history.consents.unshift(earlier, gameplay, { ...current, purpose: 'request-consultation' });
  f.history.consents.push({ ...current, recipient: 'https://other.example/own-subject' });
  const result = await f.read(); assert.equal(result.boundedExactConsent, true); assert.equal(result.sharingStopped, true);
  assert.equal(result.exactPrivateLrsReadback, true); assert.equal(f.calls.filter(name => name === 'act').length, 1);
});
for (const [label, mutate] of [
  ['duplicate exact current scope', f => { f.history.consents.push({ ...f.history.consents[0] }); }],
  ['historical session only', f => { f.history.consents[0].sessionId = 'historical-session'; f.history.consents[0].taskId = 'hallowmarch-activity:' + owner.accountId + ':historical-session'; }],
  ['same task with wrong session', f => { f.history.consents[0].sessionId = 'other-session'; }],
  ['same session with wrong task', f => { f.history.consents[0].taskId += ':other'; }],
  ['wrong current recipient', f => { f.history.consents[0].recipient += '/other'; }],
  ['wrong current purpose', f => { f.history.consents[0].purpose = 'request-consultation'; }],
  ['wrong history owner', f => { f.history.ownerDid = 'did:example:other-owner'; }],
  ['invalid timestamp bounds', f => { f.history.consents[0].issuedAt = 'unknown'; }],
  ['nonboolean withdrawal', f => { f.history.consents[0].revoked = 'true'; }],
]) test('current consent proof refuses ' + label + ' before any LRS read', async () => {
  const f = readFixture(); mutate(f); const result = await f.read();
  assert.equal(result.boundedExactConsent, false); assert.equal(result.sharingStopped, false); assert.deepEqual(f.calls, []);
});
test('a revoked historical consent cannot substitute for unrevoked current consent', async () => {
  const f = readFixture(); f.history.consents.push({ ...f.history.consents[0], sessionId: 'earlier', taskId: 'hallowmarch-activity:' + owner.accountId + ':earlier' });
  f.history.consents[0].revoked = false; const result = await f.read();
  assert.equal(result.boundedExactConsent, true); assert.equal(result.sharingStopped, false); assert.deepEqual(f.calls, []);
});

function controlFixture() {
  const f = readFixture(), priorMemo = f.trace.memo, clicks = [], elements = new Map();
  delete f.context.window.__hmNativePersonalActivityTrace;
  Object.assign(f.game.SAVE, { pending: null, nativeFlight: null,
    lastBody: JSON.stringify({ char: { x: { learningDelivery: { pending: { events: [f.event], contract: priorMemo.contract } } } } }) });
  Object.assign(f.game.GAME, { t: 100 }); f.game.UI = { modal: null }; f.pinned.player.combatUntil = 0;
  Object.assign(f.game.learningDelivery.status, { enabled: false, pending: false, busy: false });
  elements.set('march-learning-record', { textContent: 'Record for 15 minutes in your own pod. Chat and inventory are excluded.' });
  elements.set('menu', { hidden: true });
  elements.set('march-learning-enable', { hidden: false, disabled: false, click() { clicks.push('enable'); f.game.learningDelivery.status.enabled = true; } });
  elements.set('march-learning-stop', { hidden: false, disabled: false, click() { clicks.push('stop'); f.game.learningDelivery.status.enabled = false; } });
  f.context.document = { getElementById: id => elements.get(id), activeElement: { tagName: 'BODY' },
    hidden: false, hasFocus: () => true };
  f.context.performance = { now: () => 12345 }; f.context.URL = URL; f.context.location.href = gameOrigin + '/';
  const install = vm.runInContext('(' + installPersonalActivityObserver.toString() + ')', f.context);
  const control = vm.runInContext('(' + personalActivityControl.toString() + ')', f.context);
  install({ owner, gameOrigin, relayOrigin });
  const trace = f.context.window.__hmNativePersonalActivityTrace;
  return { ...f, trace, clicks, elements, control: action => control({ action, owner, gameOrigin }),
    write() { return f.context.fetch(relayOrigin + '/mcp', { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: {
      descriptor_url: priorMemo.contract.descriptorUrl, action_iri: priorMemo.contract.write.action,
      payload: { _signed_payload: JSON.stringify({ ...priorMemo.payload, agent_id: priorMemo.signer }) },
    } } }) }); },
  };
}
test('real observer captures the verified consulting session separately from gameplay session', () => {
  const f = controlFixture(); assert.equal(f.trace.consentSessionId, 'coaching-session');
  assert.notEqual(f.trace.consentSessionId, f.trace.gameplaySessionId);
  assert.equal(f.trace.consentTaskId, 'hallowmarch-activity:' + owner.accountId + ':coaching-session');
  f.control('enable'); f.control('input'); assert.deepEqual(f.clicks, ['enable']); assert.equal(f.trace.inputAttempted, true);
});
test('real Stop still clicks once after an unexpected second write and death without accepting the ambiguous proof', async () => {
  const f = controlFixture(); f.control('enable'); f.control('input'); await f.write(); await f.write();
  assert.equal(f.trace.writes, 2); assert.equal(f.trace.ambiguous, true); f.pinned.player.alive = false;
  f.control('stop'); assert.deepEqual(f.clicks, ['enable', 'stop']); assert.equal(f.trace.stopped, true);
  assert.equal(f.game.learningDelivery.status.enabled, false);
  assert.throws(() => f.control('stop'), { code: 'qa_activity_scope' });
  assert.throws(() => f.control('stopped'), { code: 'qa_activity_scope' });
  const read = vm.runInContext('(' + readPersonalActivityProof.toString() + ')', f.context);
  await assert.rejects(read({ owner, relayOrigin, gameOrigin }, []), { code: 'qa_activity_readback' });
  assert.equal(f.trace.writes, 2); assert.deepEqual(f.calls, []);
});
for (const [name, mutate] of [
  ['owner', f => { f.pinned.accountId = 'other-owner'; }],
  ['token', f => { f.game.net.NETWS.token = 'other-token'; }],
  ['generation', f => { f.game.net.NETWS.generation++; }],
  ['player identity', f => { f.game.GAME.player = { alive: true }; }],
  ['coaching proof identity', f => { f.trace.consultingTrace.verifiedFirst = { ...f.trace.consultingProof }; }],
  ['coaching session', f => { f.trace.consultingProof.sessionId = 'other-session'; }],
  ['closed journal', f => { f.game.consulting.status.privateHistoryOpen = false; }],
]) test('cleanup Stop refuses changed ' + name + ' even with ambiguous observations', () => {
  const f = controlFixture(); f.control('enable'); f.trace.ambiguous = true; mutate(f);
  assert.throws(() => f.control('stop'), { code: 'qa_activity_scope' });
  assert.deepEqual(f.clicks, ['enable']); assert.equal(f.trace.stopped, false);
});
for (const action of ['enable', 'input']) for (const fault of ['ambiguous', 'dead']) {
  test('real ' + action + ' remains strict after ' + fault, () => {
    const f = controlFixture(); if (action === 'input') f.control('enable');
    if (fault === 'ambiguous') f.trace.ambiguous = true; else f.pinned.player.alive = false;
    assert.throws(() => f.control(action), { code: 'qa_activity_scope' });
    assert.equal(f.trace.inputAttempted, false); assert.deepEqual(f.clicks, action === 'input' ? ['enable'] : []);
  });
}
test('unavailable Stop does not latch a false stop before its single click can happen', () => {
  const f = controlFixture(); f.control('enable'); f.elements.get('march-learning-stop').hidden = true;
  assert.throws(() => f.control('stop'), { code: 'qa_activity_scope' }); assert.equal(f.trace.stopped, false);
  f.elements.get('march-learning-stop').hidden = false; f.control('stop');
  assert.deepEqual(f.clicks, ['enable', 'stop']); assert.throws(() => f.control('stop'), { code: 'qa_activity_scope' });
});
test('independent proof remains strict for a dead player', async () => {
  const f = readFixture(); f.pinned.player.alive = false;
  await assert.rejects(f.read(), { code: 'qa_activity_readback' }); assert.deepEqual(f.calls, []);
});
for (const [label, mutate, flag] of [
  ['another body', f => { f.trace.memo.events[0].body.id = 'other-player'; }, 'genuineHumanOutcome'],
  ['older activity', f => { f.trace.startOrdinal = 1; }, 'futureActivityOnly'],
  ['unconfirmed intent', f => { f.trace.memo.intentConfirmed = false; }, 'intentConfirmedBeforeDelivery'],
  ['pending private marker', f => { f.opened.record.save.char.x.learningDelivery.pending = {}; }, 'exactPrivateCheckpoint'],
  ['unsigned native digest', f => { f.opened.digest = 'not-native'; }, 'verifiedNativeDigest'],
  ['binding CID without native revision', f => { delete f.opened.head.nativeRevision; }, 'ownerKeyAuthenticatedCheckpoint'],
  ['wrong record digest under stable binding', f => { f.opened.head.recordCid = 'graph-nquads-sha256:' + 'b'.repeat(64); }, 'verifiedNativeDigest'],
  ['another proof kind', f => { f.opened.proofKind = 'per-save-published-signature'; }, 'ownerKeyAuthenticatedCheckpoint'],
  ['another LRS statement', f => { f.lrs.object.id = 'urn:other'; }, 'exactPrivateLrsReadback'],
  ['broader consent', f => { f.history.consents[0].expiresAt = new Date(Date.now() + 1800000).toISOString(); }, 'boundedExactConsent'],
  ['not withdrawn', f => { f.history.consents[0].revoked = false; }, 'sharingStopped'],
]) test('independent reader refuses ' + label, async () => {
  const f = readFixture(); mutate(f); const result = await f.read(); assert.equal(result[flag], false);
});
