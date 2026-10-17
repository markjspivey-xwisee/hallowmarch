import test from 'node:test';
import assert from 'node:assert/strict';
import { installNativeQaCheckpointBinding } from './native-qa-checkpoint-binding.mjs';

function fixture({ fail = false } = {}) {
  let call; const events = [], frame = { url: () => 'https://game.example/?safe=1' };
  const page = { mainFrame: () => frame, async exposeBinding(name, handler) { assert.equal(name, '__hmNativeQaCheckpoint'); call = handler; } };
  const checkpoint = { recordRecovery(value) { if (fail) throw Error('NEVER-OUTPUT-FILESYSTEM-SECRET'); events.push({ kind: 'recovery', value }); },
    recordPublication(value) { if (fail) throw Error('NEVER-OUTPUT-FILESYSTEM-SECRET'); events.push({ kind: 'publication', value }); } };
  return { page, frame, events, checkpoint, invoke: (event, source = { page, frame }) => call(source, event) };
}
test('only fixed safe events from the owned game main frame reach the private writer', async () => {
  const f = fixture(); await installNativeQaCheckpointBinding({ page: f.page, gameOrigin: 'https://game.example', checkpoint: f.checkpoint });
  assert.deepEqual(await f.invoke({ kind: 'recovery', recovery: { ciphertext: 'synthetic-encrypted-file' } }), { ok: true });
  assert.deepEqual(await f.invoke({ kind: 'publication', recordKind: 'profile', graphIri: 'urn:graph:fixture', operationId: 'fixture-uuid', digest: 'fixture-digest' }), { ok: true });
  assert.equal(f.events.length, 2);
  for (const [event, source] of [
    [{ kind: 'publication', recordKind: 'profile', graphIri: 'urn:graph:fixture', operationId: 'fixture-uuid', digest: 'fixture-digest', token: 'NEVER-STORE' }, undefined],
    [{ kind: 'recovery', recovery: {} }, { page: {}, frame: f.frame }],
    [{ kind: 'recovery', recovery: {} }, { page: f.page, frame: { url: () => 'https://game.example' } }],
  ]) assert.deepEqual(await f.invoke(event, source), { ok: false, code: 'qa_checkpoint_failed' });
  assert.equal(f.events.length, 2);
});
test('private writer failures return only a fixed refusal and never acknowledge forwarding', async () => {
  const f = fixture({ fail: true }); await installNativeQaCheckpointBinding({ page: f.page, gameOrigin: 'https://game.example', checkpoint: f.checkpoint });
  const report = await f.invoke({ kind: 'recovery', recovery: { ciphertext: 'synthetic' } });
  assert.deepEqual(report, { ok: false, code: 'qa_checkpoint_failed' }); assert.equal(f.events.length, 0);
  assert(!JSON.stringify(report).includes('NEVER-OUTPUT'));
});
