import test from 'node:test';
import assert from 'node:assert/strict';
import { assertConfirmedCheckpoint, checkDeploymentCheckpoint } from '../deploy-preflight.mjs';

const confirmed = () => ({ enabled: true, mode: 'native', scope: 'world-and-season', state: 'confirmed',
  fenced: false, durable: true, pendingSnapshots: 0, writing: false, backgroundCaptureDeferred: false,
  error: null, liveVersion: 7, confirmedLiveVersion: 7, confirmedVersion: 4 });
const health = (worldAuthority = confirmed(), players = 0) => ({ ok: true, players, worldAuthority });
function responses(values) {
  const paths = [];
  return { paths, fetchImpl: async url => {
    paths.push(url.pathname); const next = values.shift();
    if (!next) throw new Error('Unexpected extra request');
    return { ok: next.ok !== false, json: async () => next.body };
  } };
}
test('preflight requires a confirmed native checkpoint and rejects every pending or unsafe state', () => {
  assert.deepEqual(assertConfirmedCheckpoint(confirmed()), { liveVersion: 7, confirmedVersion: 4 });
  for (const change of [{ durable: false }, { pendingSnapshots: 1 }, { writing: true },
    { fenced: true }, { error: 'CHECKPOINT_UNCONFIRMED' }, { liveVersion: 8 },
    { state: 'delayed' }, { backgroundCaptureDeferred: true }, { confirmedVersion: 0 }, { mode: 'legacy' }]) {
    assert.throws(() => assertConfirmedCheckpoint({ ...confirmed(), ...change }), { code: 'DEPLOYMENT_CHECKPOINT_UNCONFIRMED' });
  }
});
test('preflight confirms the original idle process twice around the native checkpoint observation', async () => {
  const mock = responses([{ body: health() }, { body: confirmed() }, { body: health() }]);
  assert.deepEqual(await checkDeploymentCheckpoint('https://game.example', mock),
    { origin: 'https://game.example', liveVersion: 7, confirmedVersion: 4 });
  assert.deepEqual(mock.paths, ['/health', '/gaming/world-state', '/health']);
});
test('preflight blocks active humans, unavailable originals and a checkpoint changed during observation', async () => {
  const cases = [
    [{ body: health(confirmed(), 1) }],
    [{ ok: false }],
    [{ body: health() }, { body: { ...confirmed(), pendingSnapshots: 1 } }],
    [{ body: health() }, { body: confirmed() }, { body: health(confirmed(), 1) }],
    [{ body: health() }, { body: confirmed() }, { body: health({ ...confirmed(), liveVersion: 8, confirmedLiveVersion: 8 }) }],
  ];
  for (const values of cases) await assert.rejects(checkDeploymentCheckpoint('https://game.example', responses(values)),
    { code: 'DEPLOYMENT_CHECKPOINT_UNCONFIRMED' });
});
test('preflight rejects credential-bearing origins and permits explicit local test origins', async () => {
  await assert.rejects(checkDeploymentCheckpoint('https://user:secret@game.example'), { code: 'DEPLOYMENT_CHECKPOINT_UNCONFIRMED' });
  const mock = responses([{ body: health() }, { body: confirmed() }, { body: health() }]);
  await checkDeploymentCheckpoint('http://127.0.0.1:8787', mock);
  assert.equal(mock.paths.length, 3);
});
