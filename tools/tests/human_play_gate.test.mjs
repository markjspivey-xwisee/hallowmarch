import test from 'node:test';
import assert from 'node:assert/strict';
import { createHumanPlayGate } from '../../server/human-play.js';

function fixture() {
  let now = 1000, nextId = 1;
  const timers = new Map(), changes = [], ended = [];
  const gate = createHumanPlayGate({ clock: () => now, onChange: v => changes.push(v),
    onSessionEnd: c => ended.push(c),
    setTimer(fn, delay) { const id = nextId++; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimer(id) { timers.delete(id); } });
  const client = extra => ({ acct: {}, room: { diagnostic: false }, ...extra });
  function advance(ms) {
    now += ms;
    for (;;) {
      const due = [...timers].find(([, t]) => t.at <= now);
      if (!due) break;
      timers.delete(due[0]); due[1].fn();
    }
  }
  const frame = (n = 1, live = 1) => ({ on: 1, humanLive: live, humanActivity: n });
  return { gate, timers, changes, ended, client, advance, frame };
}
test('standby has no scheduled tasks or active humans', () => {
  const f = fixture();
  assert.equal(f.gate.count(), 0); assert.equal(f.timers.size, 0);
  f.advance(7 * 86400000); assert.equal(f.changes.length, 0);
});
test('agents, diagnostics, title frames and missing leases cannot wake work', () => {
  const f = fixture();
  for (const c of [f.client({ gamingAgent: {} }), f.client({ agent: true }), f.client({ bot: true }),
    f.client({ room: { diagnostic: true } }), f.client({ acct: { diagnostic: true } }), { room: {} }])
    assert.equal(f.gate.update(c, f.frame()), false);
  const c = f.client();
  for (const profile of [{ on: 1 }, { ...f.frame(), on: 0 }, f.frame(0), f.frame(Infinity), f.frame(1, 0)])
    assert.equal(f.gate.update(c, profile), false);
  assert.equal(f.timers.size, 0); assert.deepEqual(f.changes, []);
});
test('identical frames cannot renew the trusted input lease', () => {
  const f = fixture(), c = f.client();
  f.gate.update(c, f.frame(1)); assert.deepEqual(f.changes, [true]);
  for (let n = 0; n < 89; n++) { f.advance(1000); assert.equal(f.gate.update(c, f.frame(1)), true); }
  f.advance(1000);
  assert.equal(f.gate.isPlaying(c), false); assert.deepEqual(f.changes, [true, false]);
  assert.equal(f.timers.size, 0);
  assert.equal(f.gate.update(c, f.frame(1)), false);
  assert.equal(f.gate.update(c, f.frame(2)), true);
});
test('visibility withdrawal needs fresh input to reactivate', () => {
  const f = fixture(), c = f.client();
  f.gate.update(c, f.frame(4)); f.gate.update(c, f.frame(4, 0));
  assert.equal(f.gate.count(), 0);
  assert.equal(f.gate.update(c, f.frame(4)), false);
  assert.equal(f.gate.update(c, f.frame(5)), true);
});
test('one live human keeps the world active when another leaves', () => {
  const f = fixture(), a = f.client(), b = f.client();
  f.gate.update(a, f.frame()); f.gate.update(b, f.frame());
  f.gate.forget(a); assert.equal(f.gate.count(), 1); assert.deepEqual(f.changes, [true]);
  f.gate.forget(b); assert.equal(f.gate.count(), 0); assert.deepEqual(f.changes, [true, false]);
  assert.equal(f.ended.length, 2); assert.equal(f.timers.size, 0);
});
test('close ends every session and prevents another input from waking work', () => {
  const f = fixture(), c = f.client();
  f.gate.update(c, f.frame()); f.gate.close();
  assert.equal(f.gate.update(c, f.frame(2)), false);
  assert.equal(f.timers.size, 0); assert.deepEqual(f.changes, [true, false]);
});
