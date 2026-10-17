import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFile } from 'node:fs/promises';

const copy = value => JSON.parse(JSON.stringify(value));
const source = await readFile(new URL('../../src/14z_learningdelivery.js', import.meta.url), 'utf8');
function fixture({ unconfirmed = false, uncertain = false, unconfirmedAt = 0, afterWrite = null } = {}) {
  let clock = 1000000, profile = { eventCount: 3, pending: [{ id: 'old', ordinal: 3, sessionId: 'gameplay-session' }], recent: [] };
  const parts = {}, handlers = {}, calls = { opens: [], consents: [], revokes: [], writes: [], checks: 0, saves: 0 }, player = {};
  const scope = { native: true, characterId: 'character-one', body: player, token: 'current-token', identity: 'owner-one', generation: 1 };
  const journal = { grantConsent: async input => { calls.consents.push(copy(input)); }, revokeConsent: async input => { calls.revokes.push(copy(input)); } };
  const context = vm.createContext({ console, JSON, Map, Date: { now: () => clock },
    document: { hidden: false, addEventListener(name, fn) { handlers[name] = fn; } },
    window: { __hm: {}, addEventListener(name, fn) { handlers[name] = fn; } },
    GAME: { player }, SAVE: { native: true, pending: null, nativeFlight: null, lastBody: '' },
    NATIVE_PLAYER: { status: { bound: true, verified: true } }, GAME_ACTIVITY: { sessionId: 'gameplay-session' },
    activityScope: () => scope, activityCurrent: held => held.body === context.GAME.player && held.token === scope.token && held.generation === scope.generation,
    activityEnsure: () => ({ save: () => copy(profile) }),
    registerSavePart(where, name, part) { parts[name] = part; }, setInterval() {}, $: () => null,
    marchConsultingCanonical: value => JSON.stringify(value), MARCH_CONSULTING: { journal, sessionId: 'journal-session', current() {} },
    async saveNow() { calls.saves++; if (!unconfirmed && calls.saves !== unconfirmedAt) context.SAVE.lastBody = JSON.stringify({ char: { x: { learningDelivery: parts.learningDelivery.save() } } }); },
    marchConsultingOpenHistory: async () => {},
  });
  context.MARCH_CONSULTING.openLearning = async options => {
    calls.opens.push(options); let state = copy(options.state || { schema: 'test-delivery', throughOrdinal: options.startAfterOrdinal, pending: null }), closed = false;
    const current = () => { if (closed) throw new Error('Closed'); options.assertCurrent(); };
    return { connect: async () => { current(); }, close() { closed = true; },
      status: () => ({ pending: !!state.pending, throughOrdinal: state.throughOrdinal, purpose: 'record-gameplay-activity', recipient: 'https://foxxi.example/own-record', taskId: 'activity:character-one:journal-session' }),
      prepare(input) { current(); const events = input.filter(event => event.ordinal > Math.max(options.startAfterOrdinal, state.throughOrdinal)).slice(0, 20); return events.length ? { events } : null; },
      async deliver(prepared) {
        current(); const pending = { ...state, pending: { events: copy(prepared.events) } };
        state = pending; await options.commitState(pending); current(); calls.writes.push(copy(prepared.events));
        await afterWrite?.(calls.writes.length, context);
        if (uncertain) throw new Error('Activity unconfirmed');
        const confirmed = { ...state, throughOrdinal: prepared.events.at(-1).ordinal, pending: null };
        await options.commitState(confirmed); current(); state = confirmed;
      },
      async reconcile() { current(); calls.checks++; return { pending: !!state.pending }; },
      async closePending() { current(); const next = { ...state, throughOrdinal: state.pending.events.at(-1).ordinal,
        closedUnconfirmedCount: (state.closedUnconfirmedCount || 0) + state.pending.events.length, pending: null };
        await options.commitState(next); current(); state = next; return { closedUnconfirmed: true }; },
    };
  };
  vm.runInContext(source, context);
  return { context, calls, parts, handlers, api: context.window.__hm.learningDelivery,
    later: amount => { clock += amount; }, event: (ordinal, extra = {}) => { profile.eventCount = ordinal;
      const event = { id: 'event-' + ordinal, ordinal, sessionId: 'gameplay-session', ...extra }; profile.pending.push(event);
      context.marchLearningObserve({ recorded: true, event }); },
    archive: () => { profile.recent = profile.pending.slice(-16); profile.pending = []; },
    evaluate: code => vm.runInContext(code, context) };
}

test('ordinary gameplay makes no learning connection or writes until separately enabled', async () => {
  const f = fixture(); f.event(4); f.later(31000); await f.api.flush();
  assert.equal(f.calls.opens.length, 0); assert.equal(f.calls.consents.length, 0); assert.equal(f.calls.saves, 0); assert.equal(f.calls.writes.length, 0);
});

test('explicit activity consent starts after existing history and keeps gameplay and coaching sessions distinct', async () => {
  const f = fixture(); await f.api.enable();
  assert.equal(f.calls.opens.length, 1); assert.equal(f.calls.opens[0].gameplaySessionId, 'gameplay-session');
  assert.equal(f.calls.opens[0].characterId, 'character-one'); assert.equal(f.calls.opens[0].startAfterOrdinal, 3);
  assert.deepEqual(f.calls.consents, [{ accepted: true, purpose: 'record-gameplay-activity', recipient: 'https://foxxi.example/own-record', taskId: 'activity:character-one:journal-session', lifetimeMs: 900000 }]);
  f.event(4); await f.api.flush(); assert.equal(f.calls.writes.length, 0, 'bounded thirty-second batches');
  f.later(30000); await f.api.flush(); assert.deepEqual(f.calls.writes.map(list => list.map(event => event.id)), [['event-4']]);
  assert.equal(f.calls.saves, 2, 'exact pending intent and confirmed receipt are private character saves');
  assert.equal(f.parts.learningDelivery.save().pending, null);
});

test('an unconfirmed character save cannot produce an external activity write', async () => {
  const f = fixture({ unconfirmed: true }); await f.api.enable(); f.event(4); f.later(30000); await f.api.flush();
  assert.equal(f.calls.writes.length, 0); assert.equal(f.parts.learningDelivery.save().pending.events[0].id, 'event-4');
  assert.match(f.api.status.note, /awaiting its character save/); assert.equal(f.api.status.enabled, false);
});

test('a failed acknowledgment save retains the confirmed pre-send intent for read-only recovery', async () => {
  const f = fixture({ unconfirmedAt: 2 }); await f.api.enable(); f.event(4); f.later(30000); await f.api.flush();
  assert.equal(f.calls.writes.length, 1); assert.equal(f.parts.learningDelivery.save().pending.events[0].id, 'event-4');
  assert.equal(f.api.status.enabled, false); assert.equal(f.api.status.pending, true);
  f.later(30000); await f.api.flush(); assert.equal(f.calls.writes.length, 1);
});

test('hiding the game while an exact intent save completes keeps its marker and fences the external action', async () => {
  const f = fixture(); await f.api.enable(); f.event(4);
  f.context.saveNow = async () => {
    f.context.SAVE.lastBody = JSON.stringify({ char: { x: { learningDelivery: f.parts.learningDelivery.save() } } });
    f.context.document.hidden = true; f.handlers.visibilitychange();
  };
  f.later(30000); await f.api.flush();
  assert.equal(f.calls.writes.length, 0); assert.equal(f.parts.learningDelivery.save().pending.events[0].id, 'event-4');
  assert.equal(f.api.status.enabled, false);
});

test('reload retains exact unknown batch and never reconnects or resends it automatically', async () => {
  const first = fixture({ uncertain: true }); await first.api.enable(); first.event(4); first.later(30000); await first.api.flush();
  const saved = copy(first.parts.learningDelivery.save()); assert.equal(first.calls.writes.length, 1); assert.equal(first.api.status.enabled, false);
  const next = fixture(); next.parts.learningDelivery.load(saved); next.event(5); next.later(30000); await next.api.flush();
  assert.equal(next.calls.opens.length, 0); assert.equal(next.calls.writes.length, 0); assert.equal(next.api.status.pending, true);
  await next.api.enable(); assert.equal(next.api.status.enabled, false); assert.equal(next.calls.writes.length, 0);
  await next.api.reconcile(); assert.equal(next.calls.checks, 1); assert.equal(next.calls.writes.length, 0);
  assert.equal(next.api.status.enabled, false, 'read-only recovery never starts a recording session');
});

test('hiding the game, changing body or expiry stops activity transport', async () => {
  const hidden = fixture(); await hidden.api.enable(); hidden.event(4); hidden.context.document.hidden = true; hidden.handlers.visibilitychange(); hidden.later(30000); await hidden.api.flush();
  assert.equal(hidden.api.status.enabled, false); assert.equal(hidden.calls.writes.length, 0);
  const changed = fixture(); await changed.api.enable(); changed.event(4); changed.context.GAME.player = {}; changed.later(30000); await changed.api.flush(); assert.equal(changed.calls.writes.length, 0);
  const expired = fixture(); await expired.api.enable(); expired.event(4); expired.later(900001); await expired.api.flush();
  assert.equal(expired.api.status.enabled, false); assert.equal(expired.calls.writes.length, 0); assert.equal(expired.calls.revokes.length, 1);
});

test('stopping one bounded session revokes only activity consent and never starts live coaching', async () => {
  const f = fixture(); await f.api.enable(); await f.api.stop();
  assert.equal(f.api.status.enabled, false); assert.deepEqual(f.calls.revokes, [{ purpose: 'record-gameplay-activity', recipient: 'https://foxxi.example/own-record', taskId: 'activity:character-one:journal-session' }]);
  assert.equal(f.context.MARCH_CONSULTING.enabled, undefined); assert.equal(f.calls.writes.length, 0);
});

test('the private archive cannot remove observations from the independent bounded delivery queue', async () => {
  const f = fixture(); await f.api.enable();
  for (let ordinal = 4; ordinal <= 73; ordinal++) f.event(ordinal);
  f.archive(); f.later(30000); await f.api.flush();
  assert.deepEqual(f.calls.writes[0].map(event => event.ordinal), Array.from({ length: 20 }, (_, index) => index + 4));
  assert.equal(f.calls.writes.length, 3, 'at most three bounded batches per heartbeat');
  assert.equal(f.calls.writes.flat().length, 60);
  f.archive(); f.later(30000); await f.api.flush();
  assert.deepEqual(f.calls.writes[3].map(event => event.ordinal), Array.from({ length: 10 }, (_, index) => index + 64));
  assert.deepEqual(f.calls.writes.flat().map(event => event.ordinal), Array.from({ length: 70 }, (_, index) => index + 4));
});

test('a full observation buffer visibly pauses instead of silently skipping events', async () => {
  const f = fixture(); await f.api.enable();
  for (let ordinal = 4; ordinal <= 132; ordinal++) f.event(ordinal);
  assert.equal(f.api.status.enabled, false); assert.match(f.api.status.note, /detailed observations could not keep up/);
  f.later(30000); await f.api.flush(); assert.equal(f.calls.writes.length, 0);
});

test('Stop during the first batch prevents all later batches in the same heartbeat', async () => {
  const f = fixture({ afterWrite: async (count, context) => { if (count === 1) await context.window.__hm.learningDelivery.stop(); } });
  await f.api.enable(); for (let ordinal = 4; ordinal <= 73; ordinal++) f.event(ordinal);
  f.later(30000); await f.api.flush();
  assert.equal(f.calls.writes.length, 1); assert.equal(f.api.status.enabled, false);
  assert.equal(f.parts.learningDelivery.save().pending.events.length, 20);
});

test('events arriving while a batch awaits confirmation remain queued and are delivered once', async () => {
  let f;
  f = fixture({ afterWrite: async count => { if (count === 1) f.event(24); } });
  await f.api.enable(); for (let ordinal = 4; ordinal <= 23; ordinal++) f.event(ordinal);
  f.later(30000); await f.api.flush();
  assert.deepEqual(f.calls.writes.map(list => list.map(event => event.ordinal)), [Array.from({ length: 20 }, (_, index) => index + 4), [24]]);
});

test('Stop invalidates a busy native save immediately, before any external write', async () => {
  const f = fixture(); await f.api.enable(); f.event(4); let release;
  f.context.saveNow = () => new Promise(resolve => { release = () => {
    f.context.SAVE.lastBody = JSON.stringify({ char: { x: { learningDelivery: f.parts.learningDelivery.save() } } }); resolve();
  }; });
  f.later(30000); const flush = f.api.flush();
  while (!release) await new Promise(resolve => setImmediate(resolve));
  assert.equal(f.api.status.busy, true); await f.api.stop(); assert.equal(f.api.status.enabled, false);
  release(); await flush; assert.equal(f.calls.writes.length, 0);
  assert.equal(f.parts.learningDelivery.save().pending.events[0].id, 'event-4');
});

test('explicitly closing unknown records never resends or counts them as acknowledged', async () => {
  const f = fixture({ uncertain: true }); await f.api.enable(); f.event(4); f.later(30000); await f.api.flush();
  assert.equal(f.api.status.pending, true); await f.api.closeUnconfirmed();
  assert.equal(f.calls.writes.length, 1); assert.equal(f.api.status.pending, false); assert.equal(f.api.status.acknowledgedCount, 0);
  assert.equal(f.parts.learningDelivery.save().closedUnconfirmedCount, 1);
  assert.match(f.api.status.note, /arrival remains unknown/);
  await f.api.enable(); f.event(5); f.later(30000); await f.api.flush();
  assert.deepEqual(f.calls.writes.map(list => list.map(event => event.id)), [['event-4'], ['event-5']]);
});
