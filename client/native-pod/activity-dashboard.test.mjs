import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeActivityDashboardData } from './activity-dashboard.mjs';

const context = 'urn:interego:gaming:activity:context', observation = 'urn:interego:gaming:activity:observation';
const statement = (index, extra = {}) => ({ id: 'fixture-' + index,
  verb: { id: 'urn:interego:gaming:activity:verb:ability.executed' },
  actor: { objectType: 'Agent', account: { homePage: 'https://identity.example', name: 'did:web:identity.example:owner' } },
  object: { objectType: 'Activity', id: 'urn:fixture:ability:1' },
  timestamp: '2026-10-27T12:00:' + String(index).padStart(2, '0') + '.000Z',
  context: { extensions: { [context]: { eventType: 'ability.executed', bodyKind: 'character', controllerKind: 'unattributed' } } },
  result: { success: true, extensions: { [observation]: { authority: 'owner-browser-observation', competencyStatus: 'not-assessed', historyOrdinal: index } } }, ...extra });

test('character-only and unavailable identities cannot surface account records or delivery acknowledgments', () => {
  for (const identityState of ['character-only', 'unavailable', 'invented']) {
    const data = normalizeActivityDashboardData({ identityState, account: { state: 'ready', statements: [statement(1)], summary: { total: 500 } },
      recording: { scoped: true, enabled: true, acknowledgedCount: 500, pendingCount: 2, pending: true, note: 'private other-scope note' } });
    assert.equal(data.account.state, 'idle'); assert.deepEqual(data.account.rows, []); assert.equal(data.account.total, null);
    assert.equal(data.recording.scoped, false); assert.equal(data.recording.enabled, false); assert.equal(data.recording.acknowledgedCount, null);
    assert.equal(data.recording.note, '');
  }
});

test('unscoped local delivery state cannot become a native account metric; zero remains distinct from unavailable', () => {
  const data = normalizeActivityDashboardData({ identityState: 'native', recording: { scoped: false, enabled: true, acknowledgedCount: 73 },
    account: { state: 'ready', summary: { total: 0, byVerb: [{ id: 'urn:interego:gaming:activity:verb:ability.executed', count: 0 }] }, coverage: { retainedCount: 0 } } });
  assert.equal(data.recording.acknowledgedCount, null); assert.equal(data.recording.enabled, false);
  assert.equal(data.account.total, 0); assert.equal(data.account.coverage.retainedCount, 0);
  assert.equal(data.account.counts[0].label, 'Used an ability');
  const invalid = normalizeActivityDashboardData({ identityState: 'native', local: { eventCount: -1 },
    recording: { scoped: true, acknowledgedCount: Infinity, pendingCount: '20', closedUnconfirmedCount: 1.2 },
    account: { state: 'error', summary: { total: Number.MAX_SAFE_INTEGER + 1 }, coverage: { retainedCount: NaN } } });
  assert.equal(invalid.local.eventCount, null); assert.equal(invalid.recording.acknowledgedCount, null);
  assert.equal(invalid.recording.pendingCount, null); assert.equal(invalid.recording.closedUnconfirmedCount, null);
  assert.equal(invalid.account.total, null); assert.equal(invalid.account.coverage.retainedCount, null);
});

test('local cumulative counts, recent details, account totals and retention coverage remain separate', () => {
  const events = Array.from({ length: 20 }, (_, index) => ({ id: 'urn:uuid:fixture-' + index, type: 'ability.executed', ordinal: index,
    observedAt: '2026-10-27T12:00:' + String(index).padStart(2, '0') + '.000Z', body: { kind: 'character' }, actor: { kind: 'unattributed' } }));
  const data = normalizeActivityDashboardData({ identityState: 'native', local: { eventCount: 900, history: { detailsDropped: 800, captureUnavailable: 4, coverage: { retainedEvents: 64 } },
    summary: { counters: { 'ability.executed': 900, 'invented.mastered': 40 } } }, events, statements: events.map((_, index) => statement(index)),
    recording: { scoped: true, acknowledgedCount: 70 }, account: { state: 'ready', statements: [statement(2), statement(1)], summary: { total: 700 }, coverage: { retainedCount: 32, completeHistory: false }, more: true } });
  assert.equal(data.local.eventCount, 900); assert.equal(data.local.rows.length, 16); assert.equal(data.local.retainedCount, 64);
  assert.equal(data.local.detailsDropped, 800); assert.equal(data.local.captureUnavailable, 4); assert.equal(data.local.counts.length, 1);
  assert.equal(data.recording.acknowledgedCount, 70); assert.equal(data.account.total, 700); assert.equal(data.account.rows.length, 2);
  assert.equal(data.account.coverage.retainedCount, 32); assert.equal(data.account.more, true);
  assert.ok(data.local.rows.every(row => !Object.hasOwn(row, 'delivered') && !Object.hasOwn(row, 'confirmed')));
  assert.equal(data.local.rows[0].statement.id, 'fixture-19');
});

test('timeline normalization preserves explicit unknown control and does not infer a successful game outcome', () => {
  const value = statement(1); delete value.result.success;
  const data = normalizeActivityDashboardData({ identityState: 'native', account: { state: 'ready', statements: [value] } });
  const row = data.account.rows[0]; assert.equal(row.label, 'Used an ability'); assert.equal(row.controller, 'Control unknown');
  assert.equal(row.quantity, null); assert.equal(row.refused, false); assert.ok(!Object.hasOwn(row, 'success'));
  assert.equal(data.account.total, null, 'a page length cannot stand in for an account total');
  value.object.id = 'urn:interego:gaming:activity:object:ability:shield%20bash';
  assert.equal(normalizeActivityDashboardData({ identityState: 'native', account: { state: 'ready', statements: [value] } }).account.rows[0].object, 'shield bash');
});

test('only known coverage fields reach the view; input and exact statement envelopes stay unchanged', () => {
  const original = statement(1), source = { identityState: 'native', characterName: '<img src=x onerror=alert(1)>',
    account: { state: 'ready', statements: [original], coverage: { retainedCount: 1, token: 'must-not-render', descriptor: 'private pointer' } },
    recording: { scoped: true, pending: true, pendingCount: 1, acknowledgedCount: 0, pendingEnvelope: { secret: 'must-not-render' } } };
  const saved = JSON.stringify(source), data = normalizeActivityDashboardData(source);
  assert.equal(JSON.stringify(source), saved); assert.equal(data.account.rows[0].statement, original);
  assert.ok(!Object.hasOwn(data.account.coverage, 'token')); assert.ok(!Object.hasOwn(data.account.coverage, 'descriptor'));
  assert.ok(!Object.hasOwn(data.recording, 'pendingEnvelope')); assert.equal(data.characterName, source.characterName);
});
