import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createNativeQaPasskey } from './native-virtual-passkey.mjs';

const sample = () => ({ credentialId: 'c3ludGhldGljLWlk', privateKey: 'SYNTHETIC_RAM_KEY', rpId: 'relay.example',
  userHandle: 'c3ludGhldGljLXVzZXI=', isResidentCredential: true, signCount: 1 });
function pageFixture() {
  const client = new EventEmitter(); let credentials = [], reads = 0;
  client.send = async (method, args) => {
    if (method === 'WebAuthn.addVirtualAuthenticator') return { authenticatorId: 'owned-fixture' };
    if (method === 'WebAuthn.addCredential') { credentials = [structuredClone(args.credential)]; return {}; }
    if (method === 'WebAuthn.getCredentials') { reads++; return { credentials }; }
    return {};
  };
  return { page: { context: () => ({ newCDPSession: async () => client }) }, reads: () => reads,
    emit(value, asserted = false, authenticatorId = 'owned-fixture') {
      credentials = [structuredClone(value)];
      client.emit(asserted ? 'WebAuthn.credentialAsserted' : 'WebAuthn.credentialAdded', { authenticatorId, credential: value });
    },
    stored(value) { credentials = value; },
  };
}

test('delayed native key events are awaited before any credential read and imports are not assertions', async () => {
  const keeper = createNativeQaPasskey(), first = pageFixture();
  const attached = await keeper.attach(first.page, { register: true });
  let complete = false;
  const waiting = attached.waitForCredential().then(() => { complete = true; });
  await new Promise(setImmediate);
  assert.equal(complete, false); assert.equal(first.reads(), 0); assert.equal(keeper.credential(), null);
  first.emit(sample()); await waiting; await attached.sync();
  assert.equal(first.reads(), 1); assert.equal(keeper.status().assertions, 0);
  const next = pageFixture(), nextAttached = await keeper.attach(next.page);
  complete = false; const assertion = nextAttached.waitForCredential().then(() => { complete = true; });
  next.emit(sample()); await new Promise(setImmediate);
  assert.equal(complete, false, 'copying the original credential cannot stand in for an assertion');
  next.emit({ ...sample(), signCount: 2 }, true); await assertion;
  assert.equal(keeper.credential().signCount, 2); assert.equal(keeper.status().assertions, 1); keeper.close();
});

test('the retained credential is detached and wrong authenticator events cannot replace it', async () => {
  const keeper = createNativeQaPasskey(), f = pageFixture(); await keeper.attach(f.page, { register: true });
  f.emit(sample()); const returned = keeper.credential(); returned.privateKey = 'CHANGED_COPY';
  assert.equal(keeper.credential().privateKey === sample().privateKey, true);
  f.emit({ ...sample(), privateKey: 'FOREIGN_KEY' }, false, 'another-authenticator');
  assert.equal(keeper.status().failed, false);
  const status = JSON.stringify(keeper.status());
  for (const value of Object.values(sample())) if (typeof value === 'string') assert.equal(status.includes(value), false);
  await assert.rejects(keeper.attach(f.page, { register: true }), { code: 'qa_oauth_passkey_sync_refused' }); keeper.close();
});

test('foreign credential IDs, keys, owners and counter regression fail closed with fixed diagnostics', async () => {
  for (const changed of [{ credentialId: 'foreign' }, { privateKey: 'FOREIGN_KEY' }, { rpId: 'foreign.example' },
    { userHandle: 'foreign' }, { isResidentCredential: false }, { signCount: 0 }, { signCount: 0xffffffff + 1 }]) {
    const keeper = createNativeQaPasskey(), f = pageFixture(), attached = await keeper.attach(f.page, { register: true });
    f.emit(sample()); f.stored([{ ...sample(), ...changed }]);
    await assert.rejects(attached.sync(), { code: 'qa_oauth_passkey_sync_refused' });
    assert.equal(keeper.status().failed, true); assert.throws(keeper.credential, { code: 'qa_oauth_passkey_sync_refused' }); keeper.close();
  }
});

test('a refused assertion remains diagnosable and a missing event has a bounded fixed timeout', async t => {
  const keeper = createNativeQaPasskey(), first = pageFixture(); await keeper.attach(first.page, { register: true }); first.emit(sample());
  const f = pageFixture(), attached = await keeper.attach(f.page), pending = attached.waitForCredential();
  f.emit({ ...sample(), privateKey: 'FOREIGN_KEY' }, true);
  await assert.rejects(pending, { code: 'qa_oauth_passkey_sync_refused' }); assert.equal(keeper.status().failed, true); keeper.close();
  const other = createNativeQaPasskey(), page = pageFixture(), waiting = await other.attach(page.page, { register: true });
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const expired = assert.rejects(waiting.waitForCredential({ timeoutMs: 100 }), { code: 'qa_oauth_passkey_event_pending' });
  t.mock.timers.tick(100); await expired; assert.equal(page.reads(), 0); other.close();
});

test('closing the retained passkey immediately releases a pending event wait', async () => {
  const keeper = createNativeQaPasskey(), f = pageFixture(), attached = await keeper.attach(f.page, { register: true });
  const stopped = assert.rejects(attached.waitForCredential(), { code: 'qa_oauth_passkey_sync_refused' });
  keeper.close(); await stopped;
  assert.deepEqual(keeper.status(), { present: false, assertions: 0, failed: false });
});
