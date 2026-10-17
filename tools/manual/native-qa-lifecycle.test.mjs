/** Offline checkpoint ordering fixtures; no browser or external calls. */
import assert from 'node:assert/strict';
import test from 'node:test';
import { createMainWorldLiveQa } from './main-world-live.mjs';
import { createHumanConsultingLiveQa, guardHumanConsultingOwner } from './human-consulting-live.mjs';

test('failed durable grant intent prevents every grant form mutation and publication click', async () => {
  let mutations = 0, intents = 0;
  const control = { isVisible: async () => true, waitFor: async () => {},
    selectOption: async () => { mutations++; }, fill: async () => { mutations++; },
    check: async () => { mutations++; }, click: async () => { mutations++; } };
  const page = { isClosed: () => false, url: () => 'https://game.example/',
    locator: () => control, getByRole: () => ({ isVisible: async () => false }),
    waitForFunction: async () => {},
    evaluate: async fn => fn.toString().includes('async')
      ? { id: 'synthetic-body', roomId: 'native-qa-offline', x: 0, z: 0 } : true };
  const qa = createMainWorldLiveQa({ config: { agentDid: 'did:fixture:agent' }, getPage: () => page,
    checkpoint: async event => { assert.equal(event.kind, 'main-world-grant-intent'); intents++; throw Error('private checkpoint refused'); } });
  await qa.next();
  await assert.rejects(qa.next(), /private checkpoint refused/);
  assert.equal(intents, 1); assert.equal(mutations, 0); assert.equal(qa.status().completed, 1);
  qa.close();
});

test('failed durable coaching intent prevents the one actual request click', async () => {
  let intents = 0, requests = 0;
  const page = { isClosed: () => false,
    evaluate: async (fn, input) => {
      if (fn === guardHumanConsultingOwner) { if (input.action === 'request') requests++; return true; }
      if (input?.goal) return { healthPercent: 100 };
    },
    waitForFunction: async () => {}, locator: () => ({ isVisible: async () => true,
      waitFor: async () => {}, fill: async () => {}, check: async () => {}, click: async () => {} }) };
  const qa = createHumanConsultingLiveQa({ getPage: () => page,
    getOwner: () => ({ accountId: 'fixture-account', subjectDid: 'did:fixture:owner', podUrl: 'https://pod.example/owner/' }),
    gameOrigin: 'https://game.example', relayOrigin: 'https://relay.example', run: 'offline-checkpoint',
    checkpoint: async event => { assert.equal(event.kind, 'coaching-delivery-intent'); intents++; throw Error('private checkpoint refused'); } });
  await assert.rejects(qa.run(), /private checkpoint refused/);
  assert.equal(intents, 1); assert.equal(requests, 0); assert.equal(qa.status().requestClicked, false);
});
