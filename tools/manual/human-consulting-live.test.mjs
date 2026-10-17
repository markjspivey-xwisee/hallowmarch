import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { createHumanConsultingLiveQa, guardHumanConsultingOwner, installHumanConsultingObserver,
  disposeHumanConsultingObserver, readHumanConsultingPlan, inspectHumanConsultingFollowup } from './human-consulting-live.mjs';
import { createFoxxiConsultant, FOXXI_PLANNER_ACTION } from '../../client/native-pod/foxxi-consulting.mjs';

// All accounts, plans, native ports and pages in this file are isolated test
// fixtures. No browser, network, credential store or live service is invoked.
const gameOrigin = 'https://game.example', relayOrigin = 'https://relay.example';
const owner = { accountId: 'owner', subjectDid: 'did:example:owner', podUrl: 'https://pods.example/owner/' };
const descriptor = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan/affordance';
const action = 'https://relay.interego.xwisee.com/ns/iep/action/foxxi/contextualize-and-plan-signed';
const passFlags = () => Object.fromEntries(['automaticObservedContext', 'attributedLiveResponse', 'exactPrivatePlan', 'exactObservation',
  'verifiedNativeDigest', 'ownerKeyAuthenticatedCheckpoint', 'boundedExactConsent', 'noAchievementClaims', 'singleDeliveryAttempt', 'intentConfirmedBeforeDelivery'].map(key => [key, true]));

const followupFlags = () => Object.fromEntries(['realElapsedFollowup', 'changedOutcome', 'automaticFollowup',
  'distinctSituation', 'exactSecondPrivatePlan', 'twoDeliveries'].map(key => [key, true]));
function fakePage({ failedRead = false, checkpointFailure = false, automaticFollowup = false, unknownKey = false,
  followupFenceFailure = false, outcomeFailure = false, secondFailure = false } = {}) {
  const events = []; let menuOpen = false, privacyOpen = false, readFails = failedRead, failCheckpoint = checkpointFailure, elapsed = 0;
  const page = { isClosed: () => false,
    locator(selector) { return {
      async isVisible() { events.push('visible:' + selector); return selector === '#menu' ? menuOpen : selector !== '#netsheet'; },
      async click() { events.push('click:' + selector); if (selector === '#btn-menu') menuOpen = true; if (selector === '#btn-resume') menuOpen = false; if (selector === '#march-coach-options > summary') privacyOpen = !privacyOpen; },
      async waitFor() { events.push('wait:' + selector); },
      async getAttribute(name) { assert.equal(name, 'open'); return privacyOpen ? '' : null; },
      fill() { throw Error('No questionnaire is allowed.'); },
    }; },
    async evaluate(fn, input) {
      if (fn === guardHumanConsultingOwner) { events.push('guard:' + input.action); return true; }
      if (fn === installHumanConsultingObserver) { events.push('observe'); return true; }
      if (fn === disposeHumanConsultingObserver) { events.push('dispose'); return true; }
      if (fn === inspectHumanConsultingFollowup) {
        events.push('followup:' + input.action);
        if (input.action === 'begin') elapsed = 0;
        if (input.action === 'arm') assert.ok(elapsed >= 120000);
        if (input.action === 'outcome' && outcomeFailure) throw Error('No actual outcome.');
        return { ready: elapsed >= 120000 };
      }
      if (fn === readHumanConsultingPlan) {
        events.push('read:' + input.withdrawn + (input.planIndex === 1 ? ':second' : ''));
        if (readFails) { readFails = false; throw Error('PRIVATE-ERROR-MUST-NOT-ESCAPE'); }
        if (input.planIndex === 1 && secondFailure) throw Error('Unknown second plan.');
        return { ...passFlags(), ...(input.planIndex === 1 ? { ...followupFlags(), singleDeliveryAttempt: false } : {}), sharingStopped: input.withdrawn };
      }
      throw Error('Unexpected browser evaluation.');
    },
    async waitForFunction(predicate) { events.push(predicate.toString().includes('hasPrivatePlan') ? 'wait:plan' : 'wait:activity'); },
    async waitForTimeout(ms) { assert.ok(ms <= 1000); elapsed += ms; events.push('read-only-wait'); },
    async bringToFront() { events.push('focus'); },
    keyboard: { async press(key) { assert.equal(key, '1'); events.push('key:1'); if (unknownKey) throw Error('Unknown input acknowledgement.'); } },
  };
  const qa = createHumanConsultingLiveQa({ getPage: () => page, getOwner: () => owner, gameOrigin, relayOrigin, run: 'existing-fixture',
    automaticFollowup,
    async checkpoint(value) { assert.ok(['coaching-delivery-intent', 'coaching-followup-intent'].includes(value.kind)); events.push(value.kind === 'coaching-delivery-intent' ? 'checkpoint' : 'checkpoint:followup');
      if (value.kind === 'coaching-followup-intent' && followupFenceFailure || failCheckpoint) { failCheckpoint = false; throw Error('checkpoint unavailable'); } } });
  return { qa, events };
}
test('importing helper performs no browser, network or stdin activity', () => {
  const url = new URL('./human-consulting-live.mjs', import.meta.url).href;
  const result = spawnSync(process.execPath, ['--input-type=module', '--eval', `
    const forbidden=()=>{throw Error('IO_MUST_NOT_RUN')}; globalThis.fetch=forbidden;
    Object.defineProperty(process,'stdin',{get:forbidden});
    const module=await import(${JSON.stringify(url)});
    if(typeof module.createHumanConsultingLiveQa!=='function')throw Error('missing helper');
    process.stdout.write('offline import only\\n');
  `], { env: { PATH: process.env.PATH }, encoding: 'utf8', timeout: 5000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'offline import only\n');
});
test('construction requires explicit safe scope and never calls page/owner ports', () => {
  let calls = 0; const port = () => { calls++; throw Error('Do not access.'); };
  const base = { getPage: port, getOwner: port, gameOrigin, relayOrigin, run: 'fixture' };
  for (const override of [{ gameOrigin: 'http://game.example' }, { gameOrigin: gameOrigin + '/' }, { gameOrigin: gameOrigin + '?secret=PRIVATE' },
    { relayOrigin: gameOrigin }, { relayOrigin: 'https://secret:PRIVATE@relay.example' }, { run: undefined }, { getPage: undefined }]) {
    assert.throws(() => createHumanConsultingLiveQa({ ...base, ...override }), TypeError);
  }
  assert.equal(createHumanConsultingLiveQa(base).status().complete, false); assert.equal(calls, 0);
});
test('fakePage follows real Chronicle selectors, local guidance, exact disclosure, fence, one enable and native readback before stop', async () => {
  const f = fakePage(); await f.qa.run();
  assert.equal(f.qa.status().complete, true); assert.equal(f.qa.status().localGuidance, true);
  const expected = ['guard:check', 'observe', 'visible:#netsheet', 'visible:#menu', 'click:#btn-menu', 'click:#menu-tabs [data-tab="chronicle"]',
    'click:.chron-nav [data-grp="you"]', 'click:.chron-nav [data-sec="coach"]', 'wait:#march-coach-milestones', 'wait:activity',
    'guard:local', 'click:#march-coach-options > summary', 'guard:disclosure', 'checkpoint', 'guard:enable',
    'wait:plan', 'visible:#march-consulting-result', 'guard:check', 'read:false', 'guard:withdraw', 'read:true', 'dispose'];
  assert.deepEqual(f.events, expected); await f.qa.run(); assert.deepEqual(f.events, expected, 'completed run does not act again');
  assert.equal(JSON.stringify(f.qa.status()).includes(owner.subjectDid), false);
});
test('failed readback stops sharing and retained retry performs reads without another enable, request or fixture', async () => {
  const f = fakePage({ failedRead: true });
  await assert.rejects(f.qa.run(), error => error.code === 'qa_human_stage_failed' && !error.message.includes('PRIVATE'));
  assert.equal(f.qa.status().stopped, true); assert.equal(f.qa.status().complete, false);
  await f.qa.run(); assert.equal(f.qa.status().complete, true);
  assert.equal(f.events.filter(x => x === 'guard:enable').length, 1); assert.equal(f.events.filter(x => x === 'checkpoint').length, 1);
  assert.equal(f.events.filter(x => x === 'guard:withdraw').length, 1); assert.ok(f.events.includes('read:true'));
});
test('failed durable intent checkpoint never enables; retained local retry does not close disclosure or replace observer', async () => {
  const f = fakePage({ checkpointFailure: true }); await assert.rejects(f.qa.run());
  assert.equal(f.qa.status().enableClicked, false); assert.equal(f.events.includes('guard:enable'), false);
  await f.qa.run(); assert.equal(f.qa.status().complete, true);
  assert.equal(f.events.filter(x => x === 'observe').length, 1); assert.equal(f.events.filter(x => x === 'click:#march-coach-options > summary').length, 1);
});
test('concurrent callers share the same retained helper flight', async () => {
  const f = fakePage(); const one = f.qa.run(), two = f.qa.run(); assert.equal(one, two); await one;
  assert.equal(f.events.filter(x => x === 'guard:enable').length, 1);
});
test('optional fakePage followup waits 120 one-second chunks, fences before Resume, inputs once, reads second then withdraws', async () => {
  const f = fakePage({ automaticFollowup: true }); await f.qa.run();
  const order = ['read:false', 'followup:begin', 'checkpoint:followup', 'followup:arm', 'click:#btn-resume', 'focus',
    'followup:input', 'key:1', 'followup:outcome', 'read:false:second', 'guard:withdraw', 'read:true:second'];
  let previous = -1; for (const event of order) { const index = f.events.indexOf(event); assert.ok(index > previous, event); previous = index; }
  const waits = f.events.slice(f.events.indexOf('followup:begin'), f.events.indexOf('checkpoint:followup')).filter(item => item === 'read-only-wait');
  assert.equal(waits.length, 120); assert.equal(f.events.filter(item => item === 'key:1').length, 1);
  assert.equal(f.events.filter(item => item === 'guard:enable').length, 1);
  assert.equal(f.qa.status().singleDeliveryAttempt, false);
  for (const key of Object.keys(followupFlags())) assert.equal(f.qa.status()[key], true, key);
  await f.qa.run(); assert.equal(f.events.filter(item => item === 'key:1').length, 1);
});
test('failed followup durable fence keeps menu open, never inputs and stops; retained retry cannot create another session', async () => {
  const f = fakePage({ automaticFollowup: true, followupFenceFailure: true });
  await assert.rejects(f.qa.run()); await assert.rejects(f.qa.run(), { code: 'qa_human_followup_stopped' });
  assert.equal(f.events.includes('click:#btn-resume'), false); assert.equal(f.events.includes('key:1'), false);
  assert.equal(f.events.filter(item => item === 'guard:enable').length, 1); assert.equal(f.events.filter(item => item === 'guard:withdraw').length, 1);
});
for (const fault of ['unknownKey', 'outcomeFailure', 'secondFailure']) test('uncertain optional ' + fault + ' stops and never repeats ordinary input on retained retry', async () => {
  const f = fakePage({ automaticFollowup: true, [fault]: true }); await assert.rejects(f.qa.run());
  assert.equal(f.qa.status().stopped, true);
  try { await f.qa.run(); } catch { /* Read-only verification may still fail. */ }
  assert.equal(f.events.filter(item => item === 'key:1').length, 1);
  assert.equal(f.events.filter(item => item === 'guard:enable').length, 1); assert.equal(f.events.filter(item => item === 'guard:withdraw').length, 1);
});

function browserFixture({ observed = true } = {}) {
  const clicks = [], status = { bound: true, verified: true, account: { id: owner.accountId }, binding: { subjectDid: owner.subjectDid, podUrl: owner.podUrl, authenticatedAgentDid: 'did:example:human-delegate' } };
  const snapshot = { current: { id: 'milestone:combat', title: 'Survive a first fight', desiredResult: 'Complete an observed fight safely', observedResult: 'No fight outcome observed',
    workContext: 'Actual owner-browser gameplay observations for milestone:combat.', interventions: [{ id: 'combat-guide', title: 'Read the combat guide' }] }, revision: 1 };
  const metrics = { healthPercent: 100, level: 1, creatureDefeats: 0, deaths: 0, activePlaySeconds: 1, nearbyHostiles: 0, ownedCompanions: 0 };
  const contextObservation = { observationLevel: 'owner-browser', capturedAt: new Date().toISOString(), metrics };
  const constraints = ['Use the existing character and separate party companion.', 'Offer a small practical intervention. Missing evidence stays unknown.', 'Do not infer motivation, knowledge, mastery or a cause from an outcome alone.'];
  const workContext = snapshot.current.workContext + '\nMilestone: ' + snapshot.current.id + ' (' + snapshot.current.title + ')';
  const payload = { situation: { id: 'urn:hallowmarch:consultation:2fd428f0-d768-4ec7-9c52-f6c4e1cadce0', competency: snapshot.current.desiredResult,
    workContext: workContext + '\nConstraints (game-defined): ' + JSON.stringify(constraints) + '\nDesired result (game milestone criterion): ' + snapshot.current.desiredResult
      + '\nOwner-browser observations, not server-verified outcomes: ' + JSON.stringify(contextObservation),
    observed: snapshot.current.title + ': ' + snapshot.current.observedResult, performer: { id: owner.subjectDid, kind: 'human' }, modalStatus: 'Hypothetical', provenance: 'owner-browser-observed-gameplay' } };
  snapshot.summary = { bodyObservations: [{ bodyId: owner.accountId, kind: 'character', counters: {} }] };
  const game = { GAME: { started: true, t: 10, player: { alive: true, combatUntil: 0 } }, UI: { modal: 'menu' }, SAVE: { native: true, readConfirmed: true, pending: null, nativeFlight: null, lastBody: '' },
    net: { NETWS: { acct: { id: owner.accountId, nativeBound: true }, token: 'PRIVATE-APP-TOKEN', generation: 1, reload: false } },
    consulting: { status: { enabled: false, connected: false, privateHistoryOpen: false, reviewed: false, busy: false } },
    activity: { snapshot: () => structuredClone(snapshot) }, fn: { buildSave: () => ({ char: { x: { coachDelivery: { pending: null } } } }) } };
  const disclosure = 'Live Foxxi coaching shares only your current milestone and a small gameplay summary. Chat, inventory contents and other players’ private records are excluded. Enable a 15-minute live coaching session to keep its plans privately in your pod. You can stop sharing at any time.';
  const elements = new Map([
    ['#menu', { hidden: false }],
    ['#march-coach-milestones', { textContent: snapshot.current.title }], ['#march-coach-interventions', { querySelector: () => ({}) }],
    ['#march-coach-options', { open: true, textContent: disclosure }], ['#march-coach-preview', { textContent: JSON.stringify(payload) }],
    ['#march-consulting-connect', { disabled: false, hidden: false, textContent: 'Enable live coaching · 15 minutes', click() { clicks.push('enable'); game.consulting.status.enabled = true; } }],
    ['#march-consulting-withdraw', { disabled: false, hidden: false, click() { clicks.push('withdraw'); game.consulting.status.enabled = false; } }],
  ]);
  let afterFetch = null, fetchCalls = 0, disconnected = false, elapsed = 0, focused = true;
  const fetchResult = Promise.resolve({ ok: true });
  const c = vm.createContext({ window: { __hm: game }, location: { origin: gameOrigin, host: 'game.example', href: gameOrigin + '/' },
    localStorage: { getItem: () => 'PRIVATE-APP-TOKEN' }, AbortSignal, Date, URL, JSON, Object, Array, Map, Set, Number, Math,
    crypto: { randomUUID: () => '7e6e27b5-8536-42c2-9a96-4766ea6261ab' },
    performance: { now: () => elapsed },
    document: { body: {}, hidden: false, hasFocus: () => focused, activeElement: { tagName: 'BUTTON' }, querySelector: selector => elements.get(selector) || null, getElementById: id => elements.get('#' + id) || null },
    MutationObserver: class { constructor(fn) { this.fn = fn; } observe() {} disconnect() { disconnected = true; } },
    fetch: async () => { fetchCalls++; afterFetch?.(); return { ok: true, json: async () => structuredClone(status) }; },
  });
  const fn = value => vm.runInContext('(' + value.toString() + ')', c);
  const guard = fn(guardHumanConsultingOwner), install = fn(installHumanConsultingObserver), dispose = fn(disposeHumanConsultingObserver), read = fn(readHumanConsultingPlan), followup = fn(inspectHumanConsultingFollowup);
  if (observed) c.window.__hmNativeHumanConsultingTrace = { localVerified: false, coachingCalls: 0, deliveries: 0, enableClicked: false };
  return { c, game, snapshot, status, elements, clicks, guard, install, dispose, read, followup, payload, constraints, contextObservation,
    elapse(ms) { elapsed += ms; }, focus(value) { focused = value; },
    fetchCalls: () => fetchCalls, afterFetch(fn) { afterFetch = fn; }, disconnected: () => disconnected, fetchResult,
    async pin() { await guard({ owner, gameOrigin, initialize: true }); } };
}
test('actual owner guard requires an already read-confirmed human character before native status I/O', async () => {
  for (const mutation of [f => { f.game.SAVE.readConfirmed = false; }, f => { f.game.SAVE.native = false; },
    f => { f.game.GAME.started = false; }, f => { f.game.GAME.player.alive = false; }, f => { f.game.net.NETWS.acct.nativeBound = false; }]) {
    const f = browserFixture(); mutation(f); await assert.rejects(f.pin(), { code: 'qa_human_owner_changed' }); assert.equal(f.fetchCalls(), 0);
  }
});
for (const change of ['token', 'generation', 'account', 'delegate', 'player', 'read-confirmed']) {
  test('actual guard refuses original human scope changed across await: ' + change, async () => {
    const f = browserFixture(); await f.pin();
    f.afterFetch(() => { if (change === 'token') f.game.net.NETWS.token = 'OTHER'; if (change === 'generation') f.game.net.NETWS.generation++;
      if (change === 'account') f.game.net.NETWS.acct.id = 'other'; if (change === 'delegate') f.status.binding.authenticatedAgentDid = 'did:example:other';
      if (change === 'player') f.game.GAME.player = { alive: true }; if (change === 'read-confirmed') f.game.SAVE.readConfirmed = false; });
    await assert.rejects(f.guard({ owner, gameOrigin, action: 'enable' }), { code: 'qa_human_owner_changed' }); assert.deepEqual(f.clicks, []);
  });
}
test('actual local guard refuses any prior live connection, coaching calls, questionnaire or pending save', async () => {
  for (const mutate of [f => { f.game.consulting.status.enabled = true; }, f => { f.game.consulting.status.privateHistoryOpen = true; },
    f => { f.c.window.__hmNativeHumanConsultingTrace.coachingCalls = 1; }, f => { f.game.SAVE.pending = {}; },
    f => { f.game.SAVE.nativeFlight = Promise.resolve(); }, f => { f.elements.set('#march-consulting-goal', {}); }]) {
    const f = browserFixture(); await f.pin(); mutate(f);
    await assert.rejects(f.guard({ owner, gameOrigin, action: 'local' }), { code: 'qa_human_local_guidance' }); assert.deepEqual(f.clicks, []);
  }
});
test('actual disclosure guard checks 15-minute exact scope and clicks Enable at most once', async () => {
  const f = browserFixture(); await f.pin(); await f.guard({ owner, gameOrigin, action: 'local' });
  const original = f.elements.get('#march-coach-options').textContent;
  f.elements.get('#march-coach-options').textContent = original.replace('15-minute', '24-hour');
  await assert.rejects(f.guard({ owner, gameOrigin, action: 'enable' }), { code: 'qa_human_disclosure' }); assert.deepEqual(f.clicks, []);
  f.elements.get('#march-coach-options').textContent = original;
  await f.guard({ owner, gameOrigin, action: 'enable' }); assert.deepEqual(f.clicks, ['enable']);
  f.game.consulting.status.enabled = false;
  await assert.rejects(f.guard({ owner, gameOrigin, action: 'enable' }), { code: 'qa_human_single_click' }); assert.deepEqual(f.clicks, ['enable']);
});
test('transparent observer captures actual DOM context, confirms native intent and forwards the identical fetch result', async () => {
  const f = browserFixture({ observed: false }); let forwarded;
  const original = (...args) => { forwarded = args; return f.fetchResult; }; f.c.fetch = original;
  f.game.SAVE.lastBody = JSON.stringify({ char: { x: { coachDelivery: { pending: { id: f.payload.situation.id, stage: 'intent' } } } } });
  f.install({ relayOrigin });
  const input = [relayOrigin + '/mcp', { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: { descriptor_url: descriptor, action_iri: action,
    payload: { _signed_payload: 'PRIVATE-NATIVE-ENVELOPE', _signature: 'PRIVATE-SIGNATURE' } } } }) }];
  assert.equal(f.c.fetch(...input), f.fetchResult); assert.equal(forwarded[0], input[0]); assert.equal(forwarded[1], input[1]);
  const trace = f.c.window.__hmNativeHumanConsultingTrace;
  assert.equal(trace.deliveries, 1); assert.equal(trace.intentConfirmed, true); assert.equal(trace.memo.payload.situation.id, f.payload.situation.id);
  assert.equal(JSON.stringify(trace).includes('PRIVATE-NATIVE-ENVELOPE'), false); assert.equal(JSON.stringify(trace).includes('PRIVATE-SIGNATURE'), false);
  f.dispose(); assert.equal(f.c.fetch, original); assert.equal(f.disconnected(), true);
});
test('observer never labels an unconfirmed or second delivery as confirmed and stores no signed envelope', () => {
  const f = browserFixture({ observed: false }); f.c.fetch = () => f.fetchResult; f.install({ relayOrigin });
  const input = { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: { descriptor_url: descriptor, action_iri: action } } }) };
  f.c.fetch(relayOrigin, input); assert.equal(f.c.window.__hmNativeHumanConsultingTrace.intentConfirmed, false);
  f.game.SAVE.lastBody = JSON.stringify({ char: { x: { coachDelivery: { pending: { id: f.payload.situation.id, stage: 'intent' } } } } });
  f.c.fetch(relayOrigin, input); assert.equal(f.c.window.__hmNativeHumanConsultingTrace.deliveries, 2);
  assert.equal(f.c.window.__hmNativeHumanConsultingTrace.intentConfirmed, false);
});

async function followupFixture() {
  const f = browserFixture({ observed: false }); await f.pin(); f.install({ relayOrigin, automaticFollowup: true });
  Object.assign(f.c.window.__hmNativeHumanConsultingTrace, { deliveries: 1, verifiedFirst: { taskId: 'first-task' } });
  f.game.consulting.status.enabled = true;
  return { ...f, inspect(action) { return f.followup({ owner, gameOrigin, action }); }, resume() { f.elements.get('#menu').hidden = true; f.game.UI.modal = null; } };
}
test('actual VM followup guard uses real performance elapsed, keeps Coach open and refuses premature arm/input', async () => {
  const f = await followupFixture(); f.inspect('begin'); f.elapse(119999);
  assert.equal(f.inspect('wait').ready, false); assert.throws(() => f.inspect('arm'), { code: 'qa_human_followup_guard' });
  f.elapse(1); assert.equal(f.inspect('wait').ready, true); f.inspect('arm');
  assert.throws(() => f.inspect('input'), { code: 'qa_human_followup_guard' }); f.resume();
  f.inspect('input'); assert.throws(() => f.inspect('input'), { code: 'qa_human_followup_guard' });
  assert.equal(f.c.window.__hmNativeHumanConsultingTrace.followup.elapsed, 120000);
  assert.equal(f.snapshot.summary.bodyObservations[0].counters['ability.executed'], undefined, 'guard never records gameplay');
});
test('actual VM followup refuses hidden menu during real waiting or changed original owner', async () => {
  const f = await followupFixture(); f.inspect('begin'); f.resume();
  assert.throws(() => f.inspect('wait'), { code: 'qa_human_followup_guard' });
  const g = await followupFixture(); g.inspect('begin'); g.game.net.NETWS.generation++;
  assert.throws(() => g.inspect('wait'), { code: 'qa_human_followup_guard' });
});
for (const condition of ['focus', 'combat', 'typing', 'dead']) test('actual VM optional input refuses ' + condition, async () => {
  const f = await followupFixture(); f.inspect('begin'); f.elapse(120000); f.inspect('arm'); f.resume();
  if (condition === 'focus') f.focus(false); if (condition === 'combat') f.game.GAME.player.combatUntil = 11;
  if (condition === 'typing') f.c.document.activeElement.tagName = 'INPUT'; if (condition === 'dead') f.game.GAME.player.alive = false;
  assert.throws(() => f.inspect('input'), { code: 'qa_human_followup_guard' });
  assert.equal(f.c.window.__hmNativeHumanConsultingTrace.followup.inputAttempted, false);
});
test('actual VM changed outcome requires the original human body, not companion counters or a global total', async () => {
  const f = await followupFixture(); f.inspect('begin'); f.elapse(120000); f.inspect('arm'); f.resume(); f.inspect('input');
  const trace = f.c.window.__hmNativeHumanConsultingTrace; trace.deliveries = 2; trace.memos = [{}, {}];
  f.snapshot.summary.bodyObservations.push({ bodyId: 'owner:companion:fixture', kind: 'owned-unit', counters: { 'ability.executed': 99 } });
  assert.throws(() => f.inspect('outcome'), { code: 'qa_human_followup_guard' });
  f.snapshot.summary.bodyObservations[0].counters['ability.refused'] = 1; f.inspect('outcome');
  assert.equal(trace.followup.changedOutcome, true);
});
test('actual observer retains two independent passive payloads and exact intents; duplicate/third delivery is refused', async () => {
  const f = browserFixture({ observed: false }); await f.pin(); f.c.fetch = () => f.fetchResult; f.install({ relayOrigin, automaticFollowup: true });
  const tx = { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: { descriptor_url: descriptor, action_iri: action } } }) };
  const deliver = () => { f.game.SAVE.lastBody = JSON.stringify({ char: { x: { coachDelivery: { pending: { id: f.payload.situation.id, stage: 'intent' } } } } }); f.c.fetch(relayOrigin, tx); };
  deliver(); const trace = f.c.window.__hmNativeHumanConsultingTrace, first = trace.memo;
  trace.followup = { inputAttempted: true };
  f.payload.situation.id = 'urn:hallowmarch:consultation:36a071a2-7aa3-44cb-92e8-da223248fb12';
  f.snapshot.summary.bodyObservations[0].counters['ability.executed'] = 1;
  f.elements.get('#march-coach-preview').textContent = JSON.stringify(f.payload); deliver();
  assert.equal(trace.memos.length, 2); assert.notEqual(trace.memos[0].payload.situation.id, trace.memos[1].payload.situation.id);
  assert.equal(trace.memo, first); assert.equal(trace.memos[0].humanOutcome.executed, 0); assert.equal(trace.memos[1].humanOutcome.executed, 1);
  assert.deepEqual([...trace.intents], [true, true]); assert.equal(trace.ambiguous, false);
  deliver(); assert.equal(trace.ambiguous, true); assert.equal(trace.deliveries, 3); assert.equal(trace.memos.length, 2);
});
test('optional observer refuses an unsolicited second situation before the durable input fence', async () => {
  const f = browserFixture({ observed: false }); await f.pin(); f.c.fetch = () => f.fetchResult; f.install({ relayOrigin, automaticFollowup: true });
  const tx = { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: { descriptor_url: descriptor, action_iri: action } } }) };
  f.c.fetch(relayOrigin, tx); f.payload.situation.id += ':unexpected';
  f.elements.get('#march-coach-preview').textContent = JSON.stringify(f.payload); f.c.fetch(relayOrigin, tx);
  assert.equal(f.c.window.__hmNativeHumanConsultingTrace.ambiguous, true);
  assert.equal(f.c.window.__hmNativeHumanConsultingTrace.memos.length, 1);
});

async function readFixture() {
  const f = browserFixture(); await f.pin();
  const taskId = 'urn:hallowmarch:play-session:fixture-session';
  const response = { source: { descriptorUrl: descriptor, performerDid: owner.subjectDid, performerKind: 'human', signatureAuthority: 'relay-delegated' },
    service: { action, target: 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan' },
    response: { classifiedBy: f.status.binding.authenticatedAgentDid, diagnosis: { situationId: f.payload.situation.id }, plan: { situationId: f.payload.situation.id, summary: 'An isolated fixture plan', selected: [] } },
    competencyClaims: [], foxxiPersonalRecordCreated: false };
  const observation = { id: 'observation-fixture', ownerDid: owner.subjectDid, performerKind: 'human', competencyStatus: 'not-assessed',
    task: { id: taskId, observedResult: f.payload.situation.observed, desiredResult: 'Develop effective play through observed Hallowmarch activity and practical support.',
      workContext: 'Hallowmarch play-session coaching for the authenticated player and their separate party companion.', constraints: f.constraints },
    evidence: [{ kind: 'owner-browser-observation', performerDid: owner.subjectDid, at: f.contextObservation.capturedAt, metrics: f.contextObservation.metrics }] };
  const history = { ownerDid: owner.subjectDid, observations: [observation], consultations: [{ id: 'consultation-fixture', ownerDid: owner.subjectDid,
    observationId: observation.id, response, service: response.service, competencyStatus: 'not-assessed', epistemicStatus: 'service-response-unvalidated-effect' }], consents: [], evaluations: [] };
  for (const [purpose, recipient] of [['retain-observations', owner.podUrl], ['request-consultation', response.service.target]]) history.consents.push({
    purpose, recipient, taskId, sessionId: 'actual-human-session', issuedAt: new Date(Date.now() - 1000).toISOString(), expiresAt: new Date(Date.now() + 300000).toISOString(), revoked: false });
  Object.assign(f.c.window.__hmNativeHumanConsultingTrace, { localVerified: true, enableClicked: true, deliveries: 1, intentConfirmed: true,
    memo: { payload: f.payload, focus: Object.fromEntries(['id', 'title', 'desiredResult', 'workContext'].map(key => [key, f.snapshot.current[key]])),
      expectedObservedResult: f.payload.situation.observed, constraints: f.constraints, observedContext: f.contextObservation } });
  f.elements.set('#march-consulting-result', { dataset: { resultKey: JSON.stringify(response.response) } });
  f.game.consulting.status.enabled = true;
  const digest = 'graph-nquads-sha256:' + 'a'.repeat(64);
  const head = { descriptorUrl: owner.podUrl + 'context-graphs/fixture.ttl', cid: 'bafyfixture', bindingCid: 'bafyfixture',
    recordCid: digest, nativeRevision: 'fixture-native-revision-1', proofKind: 'owner-key-authenticated-checkpoint' }, graphIri = 'urn:graph:interego:performance-consultation:fixture';
  const clients = [], tools = []; let mutate = null;
  const modules = [
    { createBrowserAccessCache: () => ({ get: async () => ({ credential: { accessToken: 'PRIVATE-NATIVE-TOKEN', expiresAt: Date.now() + 900000 } }), close: async () => {} }) },
    { createOwnerPerformanceConsultation: options => { const client = options.createClient({}); return { connect: () => client.connect(), read: async () => structuredClone(history), status: () => ({ graphIri }), close() {} }; } },
    { FOXXI_PLANNER_DESCRIPTOR: descriptor, FOXXI_PLANNER_ACTION: action },
    { createNativePodClient: options => { const client = { connect: async () => {}, currentHead: async ({ checkpoint }) => { assert.equal(checkpoint, 'hallowmarch-performance-consultation/v1'); return structuredClone(head); },
      load: async ({ checkpoint }) => { assert.equal(checkpoint, 'hallowmarch-performance-consultation/v1'); mutate?.(); return { graphIri, head: structuredClone(head), record: structuredClone(history), digest,
        proofKind: 'owner-key-authenticated-checkpoint', operationId: 'fixture-native-operation' }; }, close() {} };
      clients.push({ client, transport: options.transport }); return client; } },
    { RelayMcpTransport: class { async connect() { return {}; } setCredential() {} async callTool(name) { tools.push(name); return {}; } } },
  ];
  return { ...f, head, history, response, clients, tools, modules, mutate(fn) { mutate = fn; },
    invoke(withdrawn = false, planIndex = 0) { return f.read({ owner, relayOrigin, gameOrigin, withdrawn, planIndex }, modules); } };
}
test('independent native readback verifies exact human observation, response, digest and two scoped consents using read-only ports', async () => {
  const f = await readFixture(), result = await f.invoke();
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { ...passFlags(), sharingStopped: false });
  assert.equal(f.clients.length, 2);
  await assert.rejects(async () => f.clients[0].transport.callTool('publish_context', {}), { code: 'qa_human_read_only' });
  await assert.rejects(async () => f.clients[1].transport.callTool('register_agent', {}), { code: 'qa_human_read_only' });
  assert.deepEqual(f.tools, []); assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
});
async function secondReadFixture() {
  const f = await readFixture(); assert.equal((await f.invoke()).exactPrivatePlan, true);
  const trace = f.c.window.__hmNativeHumanConsultingTrace, first = trace.memo, second = structuredClone(first);
  second.payload.situation.id = 'urn:hallowmarch:consultation:36a071a2-7aa3-44cb-92e8-da223248fb12';
  second.observedContext.capturedAt = new Date(Date.parse(first.observedContext.capturedAt) + 120000).toISOString();
  second.payload.situation.workContext = second.payload.situation.workContext.slice(0, second.payload.situation.workContext.indexOf('\nOwner-browser observations, not server-verified outcomes: '))
    + '\nOwner-browser observations, not server-verified outcomes: ' + JSON.stringify(second.observedContext);
  second.humanOutcome = { executed: 1, refused: 0 };
  trace.automaticFollowup = true; trace.memos = [first, second]; trace.deliveries = 2; trace.intents = [true, true]; trace.intentConfirmed = false;
  trace.followup = { elapsed: 120000, armed: true, inputAttempted: true, changedOutcome: true, before: { executed: 0, refused: 0 } };
  const observation = structuredClone(f.history.observations[0]); observation.id = 'observation-second';
  observation.evidence[0].at = second.observedContext.capturedAt;
  const consultation = structuredClone(f.history.consultations[0]); consultation.id = 'consultation-second'; consultation.observationId = observation.id;
  consultation.response.response.plan.situationId = second.payload.situation.id; consultation.response.response.diagnosis.situationId = second.payload.situation.id;
  consultation.response.response.plan.summary = 'A distinct isolated second plan';
  f.history.observations.push(observation); f.history.consultations.push(consultation);
  f.elements.get('#march-consulting-result').dataset.resultKey = JSON.stringify(consultation.response.response);
  return { ...f, trace, second, observation, consultation };
}
test('actual readback independently verifies second distinct encrypted-journal fixture record in the same broad task and consent session', async () => {
  const f = await secondReadFixture(), result = await f.invoke(false, 1);
  for (const [key, value] of Object.entries(result)) assert.equal(value, key !== 'singleDeliveryAttempt' && key !== 'sharingStopped', key);
  assert.equal(f.clients.length, 4, 'each readback opens independent read-only clients');
  assert.equal(f.trace.verifiedFirst.observationId, 'observation-fixture');
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false);
  f.game.consulting.status.enabled = false; for (const scope of f.history.consents) scope.revoked = true;
  assert.equal((await f.invoke(true, 1)).sharingStopped, true);
});
for (const [name, change, flag] of [
  ['other broad task', f => { f.observation.task.id += ':other'; for (const scope of f.history.consents) scope.taskId = f.observation.task.id; }, 'automaticFollowup'],
  ['other consent session', f => { for (const scope of f.history.consents) scope.sessionId = 'other-session'; }, 'automaticFollowup'],
  ['reused observation', f => { f.observation.id = f.trace.verifiedFirst.observationId; f.consultation.observationId = f.observation.id; f.history.observations.shift(); }, 'distinctSituation'],
  ['too-short elapsed', f => { f.trace.followup.elapsed = 119999; }, 'realElapsedFollowup'],
  ['no actual human outcome delta', f => { f.second.humanOutcome.executed = 0; }, 'changedOutcome'],
  ['missing second native intent', f => { f.trace.intents[1] = false; }, 'intentConfirmedBeforeDelivery'],
  ['first response relabeled second', f => { f.elements.get('#march-consulting-result').dataset.resultKey = JSON.stringify(f.response.response); }, 'exactSecondPrivatePlan'],
  ['first native record disappeared', f => { f.history.consultations.shift(); }, 'exactSecondPrivatePlan'],
  ['first native observation changed', f => { f.history.observations[0].task.observedResult = 'Different retained outcome'; }, 'exactSecondPrivatePlan'],
]) test('second native readback cannot pass ' + name, async () => {
  const f = await secondReadFixture(); change(f); assert.equal((await f.invoke(false, 1))[flag], false);
});
test('extra second-situation consultation or third delivery never verifies bounded automatic followup', async () => {
  const f = await secondReadFixture(); f.history.consultations.push(structuredClone(f.consultation));
  await assert.rejects(f.invoke(false, 1), { code: 'qa_human_plan_ambiguous' });
  const g = await secondReadFixture(); g.trace.deliveries = 3;
  assert.equal((await g.invoke(false, 1)).twoDeliveries, false);
  g.trace.ambiguous = true; await assert.rejects(g.invoke(false, 1), { code: 'qa_human_owner_changed' });
});
test('native withdrawal readback requires both exact consents revoked and live sharing disabled', async () => {
  const f = await readFixture(); f.history.consents[0].revoked = true; f.game.consulting.status.enabled = false;
  assert.equal((await f.invoke(true)).sharingStopped, false); f.history.consents[1].revoked = true;
  assert.equal((await f.invoke(true)).sharingStopped, true);
});
for (const [name, mutate, flag] of [
  ['wrong displayed plan', f => { f.elements.get('#march-consulting-result').dataset.resultKey = JSON.stringify({ plan: { summary: 'different' } }); }, 'exactPrivatePlan'],
  ['wrong native delegate', f => { f.response.response.classifiedBy = 'did:example:independent-agent'; }, 'attributedLiveResponse'],
  ['agent relabeled human', f => { f.history.observations[0].performerKind = 'agent'; }, 'exactObservation'],
  ['unbounded consent', f => { f.history.consents[0].expiresAt = new Date(Date.now() + 1800000).toISOString(); }, 'boundedExactConsent'],
  ['different consent session', f => { f.history.consents[0].sessionId = 'other'; }, 'boundedExactConsent'],
  ['achievement claim', f => { f.response.competencyClaims.push({ achieved: true }); }, 'noAchievementClaims'],
  ['missing native intent', f => { f.c.window.__hmNativeHumanConsultingTrace.intentConfirmed = false; }, 'intentConfirmedBeforeDelivery'],
  ['stable binding CID without revision', f => { delete f.head.nativeRevision; }, 'ownerKeyAuthenticatedCheckpoint'],
  ['substituted record CID', f => { f.head.recordCid = 'graph-nquads-sha256:' + 'b'.repeat(64); }, 'verifiedNativeDigest'],
  ['a different proof kind', f => { f.head.proofKind = 'per-save-published-signature'; }, 'ownerKeyAuthenticatedCheckpoint'],
]) test('native readback refuses to pass ' + name, async () => { const f = await readFixture(); mutate(f); assert.equal((await f.invoke())[flag], false); });
test('native scope changing during readback never yields successful verification', async () => {
  const f = await readFixture(); f.mutate(() => { f.game.net.NETWS.generation++; });
  await assert.rejects(f.invoke(), { code: 'qa_human_owner_changed' });
});
test('changed native head permits only withdrawal read polling; initial plan verification still fails closed', async () => {
  const f = await readFixture();
  f.modules[3].createNativePodClient = () => ({ connect: async () => {}, currentHead: async () => ({ descriptorUrl: 'head-one', cid: 'one' }),
    load: async () => ({ graphIri: 'fixture', head: { descriptorUrl: 'head-two', cid: 'two' }, record: structuredClone(f.history) }), close() {} });
  await assert.rejects(f.invoke(), { code: 'qa_human_readback_changed' });
  assert.deepEqual(JSON.parse(JSON.stringify(await f.invoke(true))), { sharingStopped: false });
});
test('stable binding CID with changed native revision cannot pass independent journal verification', async () => {
  const f = await readFixture(); let reads = 0;
  f.modules[3].createNativePodClient = () => ({ connect: async () => {},
    currentHead: async ({ checkpoint }) => {
      assert.equal(checkpoint, 'hallowmarch-performance-consultation/v1');
      return { ...structuredClone(f.head), nativeRevision: ++reads % 2 ? 'fixture-native-revision-1' : 'fixture-native-revision-2' };
    },
    load: async ({ checkpoint }) => {
      assert.equal(checkpoint, 'hallowmarch-performance-consultation/v1');
      return { graphIri: 'fixture', head: structuredClone(f.head), record: structuredClone(f.history),
        digest: f.head.recordCid, proofKind: f.head.proofKind, operationId: 'fixture-native-operation' };
    }, close() {} });
  await assert.rejects(f.invoke(), { code: 'qa_human_readback_changed' });
  reads = 0;
  assert.deepEqual(JSON.parse(JSON.stringify(await f.invoke(true))), { sharingStopped: false });
});
test('actual Foxxi adapter strict focus mapping agrees with passive helper capture and stable private task', async () => {
  const f = browserFixture({ observed: false });
  const client = createFoxxiConsultant({ binding: f.status.binding, relayUrl: relayOrigin, sessionId: 'fixture-session',
    journal: { authorize() {}, assertAuthorized() {} }, transport: {
      async connect(required) { return { granted: required }; },
      async callTool(name) {
        if (name === 'get_pod_status') return { identity: { did: owner.subjectDid }, sessionAgent: { did: f.status.binding.authenticatedAgentDid }, pod: owner.podUrl, userId: 'owner' };
        if (name === 'dereference') return { status: 'ok', affordances: [{ action: FOXXI_PLANNER_ACTION, method: 'POST', target: 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan' }] };
        throw Error('This contract test must not sign or deliver.');
      },
    } });
  try {
    await client.connect();
    const focus = Object.fromEntries(['id', 'title', 'desiredResult', 'workContext'].map(key => [key, f.snapshot.current[key]]));
    const task = { id: 'urn:hallowmarch:play-session:fixture-session', desiredResult: 'Develop effective play through observed Hallowmarch activity and practical support.',
      workContext: 'Hallowmarch play-session coaching for the authenticated player and their separate party companion.', observedResult: f.payload.situation.observed, constraints: f.constraints };
    const prepared = client.preparePlan({ task, focus, context: f.contextObservation, taskOrigin: 'observed-gameplay', observationId: '2fd428f0-d768-4ec7-9c52-f6c4e1cadce0' });
    assert.deepEqual(JSON.parse(JSON.stringify(prepared.payload)), f.payload);
    f.elements.get('#march-coach-preview').textContent = JSON.stringify(prepared.payload);
    f.install({ relayOrigin });
    f.c.fetch(relayOrigin, { body: JSON.stringify({ method: 'tools/call', params: { name: 'act', arguments: { descriptor_url: descriptor, action_iri: action } } }) });
    const memo = JSON.parse(JSON.stringify(f.c.window.__hmNativeHumanConsultingTrace.memo));
    assert.deepEqual(memo.focus, focus); assert.equal(memo.expectedObservedResult, task.observedResult);
    assert.equal(prepared.taskId, task.id); assert.notEqual(prepared.payload.situation.competency, task.workContext);
    assert.equal(prepared.payload.situation.competency, focus.desiredResult);
  } finally { client.close(); }
});
