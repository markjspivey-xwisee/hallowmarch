import assert from 'node:assert/strict';
import test from 'node:test';
import { nativeLiveStages } from './native-live-stages.mjs';

test('failed publication retries its retained closure; successful registration is never replayed', async () => {
  let registrations = 0, creates = 0, confirms = 0, reads = 0;
  const retained = { pending: null };
  const plan = nativeLiveStages([
    { name: 'register', async run() { registrations++; } },
    { name: 'publish', async run() {
      if (!retained.pending) { creates++; retained.pending = 'original-operation'; throw new Error('Lost ack'); }
      assert.equal(retained.pending, 'original-operation'); confirms++;
    } },
    { name: 'readback', async run() { reads++; } },
  ]);
  await assert.rejects(plan.remaining());
  assert.deepEqual(plan.status(), { stage: 'publish', completed: 1, total: 3, complete: false, busy: false });
  await plan.next(); assert.equal(plan.status().complete, false); assert.equal(reads, 0);
  await plan.remaining(); await plan.remaining();
  assert.equal(plan.status().complete, true);
  assert.deepEqual([registrations, creates, confirms, reads], [1, 1, 1, 1]);
});
test('only a fixed unique callable plan is accepted and concurrent advancement is refused', async () => {
  assert.throws(() => nativeLiveStages([{ name: 'https://secret.example', run() {} }]));
  assert.throws(() => nativeLiveStages([{ name: 'same', run() {} }, { name: 'same', run() {} }]));
  let release;
  const plan = nativeLiveStages([{ name: 'wait', run: () => new Promise(resolve => { release = resolve; }) }]);
  const pending = plan.next(); await assert.rejects(plan.next(), { code: 'qa_plan_busy' }); release(); await pending;
});
