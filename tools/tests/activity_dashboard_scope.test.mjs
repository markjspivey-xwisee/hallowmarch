import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
import { normalizeActivityDashboardData } from '../../client/native-pod/activity-dashboard.mjs';

const source = readFileSync(new URL('../../src/14y_activitydashboard.js', import.meta.url), 'utf8');
const owner = 'did:example:owner';
function fixture() {
  let selected = { identity: 'account-a', ownerDid: owner, characterId: 'char-a', native: true, generation: 1, podUrl: 'https://pod.example/a/', body: {} };
  const counters = { activityEnsure: 0, recording: 0, writes: 0, destroys: 0, queries: 0 };
  let resolveStatus;
  const delayed = new Promise(resolve => { resolveStatus = resolve; });
  const GAME_ACTIVITY = { scope: selected, profile: { save: () => ({ recent: [] }), snapshot: () => ({ revision: 1, eventCount: 7, history: {}, summary: {} }) } };
  const MARCH_LEARNING = { stored: null, delivery: null, enabledUntil: 0, busy: false, blocked: false };
  const context = vm.createContext({ window: { __hm: {}, addEventListener() {} }, document: { hidden: false, addEventListener() {} },
    setInterval() {}, GAME: { player: { name: 'Synthetic character' } }, GAME_ACTIVITY, MARCH_LEARNING,
    activityScope: () => selected, activityCurrent: scope => scope === selected, activityEnsure() { counters.activityEnsure++; throw Error('Must not initialize'); },
    nativePlayerRequest: () => { counters.queries++; return delayed; },
    NATIVE_PLAYER: { status: { binding: { subjectDid: owner, podUrl: selected.podUrl, authenticatedAgentDid: 'did:example:agent' } } },
    marchConsultingCanonical: value => JSON.stringify(value), UI: { modal: 'menu', menuTab: 'progress' }, LORE: {},
    $() { return null; }, Date, Number, JSON });
  vm.runInContext(source + '\nglobalThis.H = { state: ACTIVITY_DASHBOARD_UI, data: activityDashboardData, recording: activityDashboardRecording, read: activityDashboardReadAccount, invalidate: activityDashboardInvalidate };', context);
  const H = context.H;
  Object.assign(H.state, { opened: true, scopeKey: JSON.stringify([selected.identity, selected.generation, true, owner, selected.podUrl]),
    host: { isConnected: true, replaceChildren() {} }, view: { update() {}, destroy() { counters.destroys++; } } });
  return { H, context, counters, GAME_ACTIVITY, MARCH_LEARNING, resolveStatus, select(value) { selected = value; }, scope: () => selected };
}

test('dashboard snapshots read only the initialized active character and never start tracking or recording', () => {
  const f = fixture(), data = f.H.data();
  assert.equal(data.local.eventCount, 7); assert.equal(data.identityState, 'native');
  f.GAME_ACTIVITY.scope = { ...f.scope(), identity: 'other-character' };
  assert.equal(f.H.data().local, null);
  assert.equal(f.counters.activityEnsure, 0); assert.equal(f.counters.queries, 0); assert.equal(f.counters.writes, 0);
});

test('foreign and malformed delivery journals cannot appear as this player’s confirmations', () => {
  const f = fixture();
  f.MARCH_LEARNING.stored = { schema: 'hallowmarch.gameplay-learning-delivery/v1', ownerDid: 'did:example:someone-else', characterId: 'char-a', throughOrdinal: 12, pending: null, acknowledgedCount: 99 };
  assert.equal(f.H.recording(f.scope()).scoped, false);
  f.MARCH_LEARNING.stored.ownerDid = owner; f.MARCH_LEARNING.stored.acknowledgedCount = Infinity;
  assert.equal(f.H.recording(f.scope()).scoped, false);
  f.MARCH_LEARNING.stored.acknowledgedCount = 3; f.MARCH_LEARNING.stored.closedUnconfirmedCount = 2;
  const data = f.H.recording(f.scope()); assert.equal(data.scoped, true); assert.equal(data.acknowledgedCount, 3);
  assert.equal(data.closedUnconfirmedCount, 2); assert.equal(data.enabled, false);
  f.MARCH_LEARNING.delivery = { status: () => ({ ownerDid: owner, characterId: 'char-a', acknowledgedCount: 3, connected: true }) };
  f.MARCH_LEARNING.enabledUntil = Date.now() + 10000;
  f.MARCH_LEARNING.scope = { ...f.scope() };
  assert.equal(f.H.recording(f.scope()).enabled, false, 'A stale same-owner connection cannot show recording as active');
});

test('an unreadable recording journal shows attention with unknown confirmation counts, rather than a fresh empty journal', () => {
  const f = fixture();
  Object.assign(f.context.NATIVE_PLAYER.status, { verified: true, bound: true });
  f.MARCH_LEARNING.blocked = true;
  f.MARCH_LEARNING.note = 'A previous activity record could not be read. It has not been sent again.';
  const before = JSON.stringify(f.MARCH_LEARNING), recording = f.H.recording(f.scope());
  assert.equal(recording.scoped, true); assert.equal(recording.blocked, true); assert.equal(recording.enabled, false);
  assert.equal(recording.acknowledgedCount, null); assert.equal(recording.pendingCount, null); assert.equal(recording.closedUnconfirmedCount, null);
  assert.match(recording.note, /confirmation counts are unavailable/);
  const view = normalizeActivityDashboardData({ identityState: 'native', recording }).recording;
  assert.equal(view.blocked, true); assert.equal(view.scoped, true);
  assert.equal(view.acknowledgedCount, null); assert.equal(view.pendingCount, null); assert.equal(view.closedUnconfirmedCount, null);
  assert.equal(JSON.stringify(f.MARCH_LEARNING), before, 'reading does not repair or replace the corrupt journal');
  assert.equal(f.counters.queries, 0); assert.equal(f.counters.writes, 0); assert.equal(f.counters.activityEnsure, 0);
  f.MARCH_LEARNING.blocked = false;
  const fresh = f.H.recording(f.scope());
  assert.equal(fresh.acknowledgedCount, 0); assert.equal(fresh.pendingCount, 0); assert.equal(fresh.closedUnconfirmedCount, 0);
});

test('a response from a closed dashboard cannot erase the newly opened scope', async () => {
  const f = fixture(), request = f.H.read(false);
  assert.equal(f.counters.queries, 1);
  f.H.invalidate();
  const nextAccount = { state: 'ready', statements: [{ id: 'new-scope-record' }] };
  f.H.state.account = nextAccount;
  f.H.state.view = { update() {}, destroy() { f.counters.destroys++; } };
  const destroys = f.counters.destroys;
  f.resolveStatus({ verified: true, bound: true, binding: { subjectDid: owner } });
  await request;
  assert.equal(f.H.state.account, nextAccount); assert.equal(f.counters.destroys, destroys);
});
