import test from 'node:test';
import assert from 'node:assert/strict';
import { checkpointRecoveryEligible, retainedCheckpointReleaseRecovery } from './native-checkpoint-recovery.mjs';
function guard() { return { plan: { stage: 'sealed-profile-create-and-link', completed: 2, busy: false, complete: false },
  session: { pending: true, nativePendingCount: 1, indexed: false, linked: false, busy: false, setStarted: true, keyReady: true, checkpointWriteCount: 1 },
  evidence: { knownCommitted: true, originalWriteMatched: true, cipherDigest: 'sha256:' + 'a'.repeat(64), recipientKeyHash: 'b'.repeat(64), storedBytes: 7942 },
  episode: { reserved: true, failed: false, closed: false, stages: [] }, laterStarted: false }; }
test('release recovery requires the exact known committed initial bootstrap and no later action', () => {
  assert.equal(checkpointRecoveryEligible(guard()), true);
  for (const mutate of [g => { g.plan.completed = 3; }, g => { g.session.pending = false; }, g => { g.session.nativePendingCount = 2; },
    g => { g.session.indexed = true; }, g => { g.session.linked = true; }, g => { g.session.keyReady = false; },
    g => { g.session.checkpointWriteCount = 2; }, g => { g.evidence.originalWriteMatched = false; },
    g => { g.evidence.cipherDigest = 'invalid'; }, g => { g.evidence.recipientKeyHash = ''; },
    g => { g.episode.stages.push('coaching-delivery-intent'); }, g => { g.laterStarted = true; }]) {
    const g = guard(); mutate(g); assert.equal(checkpointRecoveryEligible(g), false);
  }
});
test('failed preflight never reloads; a thrown reload is retained and never repeated on recovery retry', async () => {
  let reads = 0, reloads = 0, recovered = 0, failPreflight = true;
  const qa = retainedCheckpointReleaseRecovery({ eligible: async () => true, preflight: async () => { reads++; if (failPreflight) throw Error('refused'); },
    markDocument: async () => 'original-document', reload: async () => { reloads++; throw Error('uncertain navigation'); },
    waitDocument: async marker => assert.equal(marker, 'original-document'), recover: async () => { recovered++; } });
  await assert.rejects(qa.run()); assert.equal(reloads, 0); failPreflight = false;
  await assert.rejects(qa.run()); assert.equal(reloads, 1); await qa.run(); await qa.run();
  assert.equal(reads, 2); assert.equal(reloads, 1); assert.equal(recovered, 1); assert.equal(qa.status().complete, true);
});
test('failed native recovery retains the new document and original recovery closure for an explicit retry', async () => {
  const events = []; let fail = true;
  const qa = retainedCheckpointReleaseRecovery({ eligible: async () => true, preflight: async () => events.push('preflight'),
    markDocument: async () => 'doc', reload: async () => events.push('reload'), waitDocument: async () => events.push('document'),
    recover: async () => { events.push('recover'); if (fail) { fail = false; throw Error('pending'); } } });
  await assert.rejects(qa.run()); await qa.run(); assert.deepEqual(events, ['preflight', 'reload', 'document', 'recover', 'recover']);
});
