import test from 'node:test';
import assert from 'node:assert/strict';
import { createMainWorldLiveQa, mainWorldLiveMotionEvidence } from './main-world-live.mjs';

const uuid = 'b311cc62-f50a-471a-965d-413c36954669';
const observation = () => ({ ownerId: 'owner-1', bodyId: 'owner-1:companion:' + uuid, confirmedCommands: 8,
  elapsedMs: 5100, gameElapsed: 1.4, humanInputObserved: true, overlappingInputObserved: true,
  companionMeters: .69, humanMeters: .42, peerBodyId: uuid, peerSeen: 3, peerCompanionMeters: .68 });

test('constructing the fixed companion proof plan performs no I/O or live mutation', () => {
  const qa = createMainWorldLiveQa({ config: {}, getPage() { throw Error('must remain lazy'); }, signNativeRequest() { throw Error('no signing'); } });
  assert.equal(qa.status().total, 8); assert.equal(qa.status().completed, 0); assert.equal(qa.status().stage, 'actual-main-game-entry');
  assert.equal(qa.status().separateCompanion, false); assert.equal(qa.status().nativeCompanionSave, false);
  assert.equal(qa.status().companionReloaded, false); qa.close();
});

test('movement evidence distinguishes simultaneous real human and companion bodies with peer projection', () => {
  const result = mainWorldLiveMotionEvidence(observation());
  assert.equal(result.distinctCompanion, true); assert.equal(result.simultaneousInput, true); assert.equal(result.ordinaryClock, true);
  assert.equal(result.confirmedCommands, 8); assert.equal(result.movedMeters, .69); assert.equal(result.humanMovedMeters, .42);
  assert.equal(result.sameOwnerMultiConnection, true);
  assert(!JSON.stringify(result).includes(uuid), 'Safe evidence does not expose a private body identity');
});

test('human possession, autonomous-only movement, ack-only commands and wrong peer bodies cannot pass', () => {
  const invalid = [
    { bodyId: 'owner-1' }, { bodyId: 'another-owner:companion:' + uuid }, { bodyId: 'owner-1:companion:invalid' },
    { confirmedCommands: 7 }, { elapsedMs: 200 }, { gameElapsed: 0 }, { humanInputObserved: false },
    { overlappingInputObserved: false }, { humanMeters: 0 }, { companionMeters: 0 }, { companionMeters: 100 },
    { peerSeen: 0 }, { peerCompanionMeters: 0 }, { peerBodyId: 'another-companion' },
  ];
  for (const patch of invalid) assert.throws(() => mainWorldLiveMotionEvidence({ ...observation(), ...patch }));
});
