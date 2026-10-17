import test from 'node:test';
import assert from 'node:assert/strict';
import { createMainWorldAgentTransport } from '../../server/gaming/main-world-agent-transport.js';

const uuid = '2fd428f0-d768-4ec7-9c52-f6c4e1cadce0', another = '7e6e27b5-8536-42c2-9a96-4766ea6261ab';
const body = (id, extra = {}) => ({ id, x: 1, y: 0, z: 2, hp: 100, maxHp: 100, allowed: true, ...extra });
function fixture() {
  let at = 10000;
  const messages = [], alice = { acct: { id: 'alice' }, room: { name: 'march' }, peer: 'alice-page', ws: { readyState: 1 }, native: true };
  const bob = { acct: { id: 'bob' }, room: alice.room, peer: 'bob-page', ws: { readyState: 1 }, native: true };
  const transport = createMainWorldAgentTransport({ now: () => at,
    principalFor: client => client.native ? 'did:web:owner.example:' + client.acct.id : null,
    send: (client, message) => messages.push({ client, message }) });
  const frame = (bodies, extra = {}, client = alice) => transport.frame(client, { paused: false, bodies, ...extra });
  return { alice, bob, transport, frame, messages, advance(ms) { at += ms; }, now: () => at };
}
test('actual transport exposes one own UUID humanoid alongside human without control of human', () => {
  const f = fixture(), id = 'alice:companion:' + uuid;
  assert.equal(f.frame([body('alice', { allowed: false }), body(id)]), true);
  assert.equal(f.transport.view('alice', 'march', id).body.kind, 'companion');
  assert.equal(f.transport.view('alice', 'march', 'alice'), null);
  assert.equal(f.transport.view('bob', 'march', id), null);
  assert.equal(f.transport.view('alice', 'other-room', id), null);
});
for (const id of ['bob:companion:' + uuid, 'alice:companion:not-a-uuid', 'alice:companion:' + uuid.toUpperCase(),
  'alice:companion:2fd428f0-d768-1ec7-9c52-f6c4e1cadce0', 'alice:companion:2fd428f0-d768-4ec7-1c52-f6c4e1cadce0',
  'alice:companion:' + uuid + ':extra', 'alice:companion:', 'alice:animal:foreign']) {
  test('actual transport refuses foreign or malformed companion scope: ' + id, () => {
    const f = fixture(); assert.equal(f.frame([body(id)]), false); assert.equal(f.transport.view('alice', 'march', id), null);
  });
}
test('actual transport refuses two UUID units and duplicate unit frames without replacing valid owner frame', () => {
  const f = fixture(), id = 'alice:companion:' + uuid;
  assert.equal(f.frame([body(id)]), true);
  assert.equal(f.frame([body(id), body('alice:companion:' + another)]), false);
  assert.equal(f.frame([body(id), body(id)]), false);
  assert.ok(f.transport.view('alice', 'march', id), 'refused frame does not erase known valid frame');
  assert.equal(f.transport.view('alice', 'march', 'alice:companion:' + another), null);
});
test('ordinary animal namespace remains supported and total frame count is bounded', () => {
  const f = fixture(); assert.equal(f.frame([body('alice:animal:123')]), true);
  assert.equal(f.frame(Array.from({ length: 18 }, (_, i) => body('alice:animal:' + i))), false);
});
test('no stale, paused, down, disconnected or unverified humanoid view yields command authority', () => {
  const f = fixture(), id = 'alice:companion:' + uuid;
  assert.equal(f.frame([body(id, { hp: 0 })]), true); assert.equal(f.transport.view('alice', 'march', id), null);
  f.frame([body(id)], { paused: true }); assert.equal(f.transport.view('alice', 'march', id), null);
  f.frame([body(id)]); f.advance(3001); assert.equal(f.transport.view('alice', 'march', id), null);
  f.frame([body(id)]); f.alice.ws.readyState = 3; assert.equal(f.transport.view('alice', 'march', id), null);
  f.alice.ws.readyState = 1; f.alice.native = false; assert.equal(f.frame([body(id)]), false);
  assert.equal(f.transport.view('alice', 'march', id), null);
});
test('companion dispatch addresses only exact body and owner page, and wrong owner cannot ACK', async t => {
  const f = fixture(), id = 'alice:companion:' + uuid;
  t.after(() => f.transport.close(f.alice));
  f.frame([body(id)]);
  const command = { type: 'move', roomId: 'march', entityId: id, commandId: 'proof-session:move-one', dx: 1, dz: 0, durationMs: 100 };
  const authorization = { grantId: 'grant-one', sessionId: 'proof-session', expiresAt: f.now() + 1000, isSessionActive: () => true };
  const promise = f.transport.dispatch('alice', command, authorization), sent = f.messages.find(row => row.message.op === 'command');
  assert.equal(sent.client, f.alice); assert.equal(sent.message.command.entityId, id);
  assert.equal(f.transport.result(f.bob, { requestId: sent.message.requestId, ok: true }), false);
  assert.equal(f.transport.result(f.alice, { requestId: sent.message.requestId, ok: true }), true);
  assert.equal((await promise).accepted, true);
  assert.throws(() => f.transport.dispatch('bob', command, authorization), { code: 'native_owner_page_unavailable' });
  assert.throws(() => f.transport.dispatch('alice', { ...command, entityId: 'bob:companion:' + uuid }, authorization), { code: 'native_owner_page_unavailable' });
});
