import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
globalThis.self = globalThis;
const { ClientKeyVault, canonicalGraphDigest } = await import('./vendor/interego-browser.mjs');
const { createOwnerCheckpointStore, checkpointResourceUrl, CHECKPOINT_DIAGNOSTIC_STAGES, CHECKPOINT_DIAGNOSTIC_CHECKS } = await import('./checkpoint.mjs');
const OWNER = 'did:web:identity.example:users:alice', POD = 'https://pod.example/alice/';
const GRAPH = 'urn:graph:fixture:character', MODE = 'hallowmarch-character/v1';
function keyStorage() { const map = new Map(); return { load: async key => map.get(key) || null,
  create: async (key, value) => { if (!map.has(key)) map.set(key, value); return map.get(key); } }; }
async function fixture() {
  const storage = keyStorage(), vault = new ClientKeyVault('fixture-owner', storage, webcrypto);
  await vault.create(); let clock = Date.parse('2026-10-17T12:00:00Z'), revision = 0, writeMode = 'normal', publishMode = 'normal';
  const resources = new Map(), heads = new Map(), bindings = new Map(), writes = [], publications = [];
  function store(usingVault = vault) {
    return createOwnerCheckpointStore({ ownerDid: OWNER, podUrl: POD, vault: usingVault, crypto: webcrypto, now: () => clock,
      active() {}, registered() {}, validateRecord: value => structuredClone(value),
      resourceClient: resourceUrl => ({
        async ready() {},
        async read() { const value = resources.get(resourceUrl); return value ? { ...value, body: value.body.slice() } : { revision: null, body: null, contentType: null }; },
        async write(value) {
          writes.push({ resourceUrl, ...value, body: value.body.slice() });
          if (writeMode === 'before') throw Object.assign(Error('dropped before commit'), { code: 'TIMEOUT', writeMayHaveCommitted: true });
          const prior = resources.get(resourceUrl);
          if ((prior?.revision || null) !== value.expectedRevision) throw Object.assign(Error('CAS conflict'), { code: 'CONFLICT', writeMayHaveCommitted: false });
          const saved = { body: value.body.slice(), revision: 'native-revision-' + (++revision), contentType: value.contentType };
          resources.set(resourceUrl, saved);
          if (writeMode === 'after') throw Object.assign(Error('lost response'), { code: 'TIMEOUT', writeMayHaveCommitted: true });
          return { receipt: { revision: saved.revision }, readback: saved };
        },
      }),
      nativeHead: async graph => heads.get(graph) || null,
      async readBinding(graph, selected, strict) {
        const found = bindings.get(selected.descriptorUrl); assert(found); assert.equal(found.graphIri, graph);
        if (strict) assert.equal(found.record.schema, 'interego.client-owned-checkpoint-binding/v1');
        return structuredClone(found);
      },
      async prepareBinding({ graphIri, record, expectedHead }) {
        const operationId = webcrypto.randomUUID(), text = JSON.stringify(record);
        return { args: { graph_iri: graphIri, descriptor_id: 'urn:uuid:' + operationId, graph_content: JSON.stringify(await vault.seal(text)) },
          expectedHead: expectedHead || null, record, digest: canonicalGraphDigest(`<${graphIri}> <urn:fixture:binding> ${JSON.stringify(text)} .`) };
      },
      async publishBinding(plan) {
        publications.push(structuredClone(plan));
        if (publishMode === 'before') throw Error('binding request dropped');
        const graphIri = plan.args.graph_iri, prior = heads.get(graphIri);
        if ((prior?.cid || null) !== (plan.expectedHead?.cid || null)) throw Object.assign(Error('binding conflict'), { code: 'conflict' });
        const selected = { descriptorUrl: POD + 'context-graphs/' + plan.args.descriptor_id.slice(9) + '.ttl', cid: 'native-binding-' + plan.args.descriptor_id };
        heads.set(graphIri, selected); bindings.set(selected.descriptorUrl, { graphIri, head: selected, record: plan.record, digest: plan.digest });
        if (publishMode === 'after') throw Error('binding response lost');
      },
    });
  }
  return { store, vault, storage, resources, heads, bindings, writes, publications,
    advance: ms => { clock += ms; }, writeMode: mode => { writeMode = mode; }, publishMode: mode => { publishMode = mode; } };
}

test('600 realistic character saves keep one binding and one fixed encrypted resource with bounded rolling history', async () => {
  const f = await fixture(), s = f.store();
  let result = await s.save({ graphIri: GRAPH, mode: MODE, creating: true, record: { v: 1, payload: 's'.repeat(18000), count: 0 } });
  for (let count = 1; count < 600; count++) {
    f.advance(6000);
    result = await s.save({ graphIri: GRAPH, mode: MODE, expectedHead: result.head, record: { v: 1, payload: 's'.repeat(18000), count } });
    assert.equal(result.saved, true);
  }
  assert.equal(f.publications.length, 1); assert.equal(f.resources.size, 1); assert.equal(f.heads.size, 1);
  assert.equal(result.record.count, 599); assert.equal(result.head.cid, f.heads.get(GRAPH).cid);
  assert.notEqual(result.head.recordCid, result.head.cid); assert.equal(result.proofKind, 'owner-key-authenticated-checkpoint');
  const raw = [...f.resources.values()][0]; assert(raw.body.length < 100000);
  const opened = JSON.parse(await f.vault.open(JSON.parse(new TextDecoder().decode(raw.body))));
  assert(opened.history.length <= 12); assert(new TextEncoder().encode(JSON.stringify(opened.history)).length <= 32768);
  assert(opened.budget.reduce((sum, item) => sum + item.bytes, 0) < 128 * 1024 * 1024);
  assert(!new TextDecoder().decode(raw.body).includes('ssssssssss'));
});

test('same-key fresh client and encrypted recovery read exactly the current checkpoint without another binding', async () => {
  const f = await fixture(), result = await f.store().save({ graphIri: GRAPH, mode: MODE, creating: true, record: { v: 1, marker: 'exact current' } });
  const recovery = await f.vault.backup('twelve word recovery phrase');
  const recovered = new ClientKeyVault('fixture-owner', keyStorage(), webcrypto); await recovered.restore(recovery, 'twelve word recovery phrase');
  const found = await f.store(recovered).load(GRAPH, MODE);
  assert.deepEqual(found.record, result.record); assert.deepEqual(found.head, result.head); assert.equal(f.publications.length, 1);
});

test('two tabs preserve the winning native CAS and reject an old stable binding CID as an update baseline', async () => {
  const f = await fixture(), a = f.store(), b = f.store();
  const initial = await a.save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 0 } });
  const stale = await b.load(GRAPH, MODE);
  const winner = await a.save({ graphIri: GRAPH, mode: MODE, expectedHead: initial.head, record: { count: 1 } });
  assert.equal(winner.head.cid, stale.head.cid);
  await assert.rejects(b.save({ graphIri: GRAPH, mode: MODE, expectedHead: stale.head, record: { count: 999 } }), { code: 'conflict' });
  assert.equal((await b.load(GRAPH, MODE)).record.count, 1); assert.equal(f.publications.length, 1);
  const competing = await Promise.allSettled([a.save({ graphIri: GRAPH, mode: MODE, expectedHead: winner.head, record: { count: 2 } }),
    b.save({ graphIri: GRAPH, mode: MODE, expectedHead: winner.head, record: { count: 3 } })]);
  assert.equal(competing.filter(value => value.status === 'fulfilled' && value.value.saved).length, 1);
  assert.equal(competing.filter(value => value.status === 'rejected' && value.reason.code === 'conflict').length, 1);
  assert([2, 3].includes((await a.load(GRAPH, MODE)).record.count));
});

test('lost CAS acknowledgement is fenced and explicit retry preserves original bytes, nonce, operation and binding plan', async () => {
  const f = await fixture(), s = f.store(); f.writeMode('before');
  const pending = await s.save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 1 } });
  assert.equal(pending.saved, false); assert.equal((await s.confirm(pending.operationId)).saved, false);
  await assert.rejects(s.save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 2 } }), { code: 'confirmation_required' });
  assert.equal(f.writes.length, 1); f.writeMode('normal');
  const saved = await s.reconcile(GRAPH, MODE);
  assert.equal(saved.saved, true); assert.equal(saved.operationId, pending.operationId);
  assert.deepEqual(f.writes[0].body, f.writes[1].body); assert.equal(f.publications.length, 1);
});

test('committed lost CAS reply imports the original pending operation across a fresh client without a resend on load', async () => {
  const f = await fixture(), s = f.store(); f.writeMode('after');
  const pending = await s.save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 1 } });
  assert.equal(f.publications.length, 0); const fresh = f.store();
  await assert.rejects(fresh.load(GRAPH, MODE), { code: 'checkpoint_binding_pending', operationId: pending.operationId });
  assert.equal(f.writes.length, 1); assert.equal((await fresh.confirm(pending.operationId)).saved, false);
  f.writeMode('normal'); const saved = await fresh.reconcile(GRAPH, MODE);
  assert.equal(saved.saved, true); assert.equal(f.writes.length, 1); assert.equal(f.publications.length, 1);
});

test('interrupted legacy migration quarantines the exact original binding plan and never falls back to legacy progress', async () => {
  const f = await fixture(), legacyHead = { cid: 'legacy', descriptorUrl: POD + 'context-graphs/legacy.ttl' };
  f.heads.set(GRAPH, legacyHead); f.bindings.set(legacyHead.descriptorUrl, { graphIri: GRAPH, head: legacyHead, digest: 'legacy', record: { count: 1 } });
  assert.equal((await f.store().load(GRAPH, MODE)).record.count, 1);
  f.publishMode('before'); const pending = await f.store().save({ graphIri: GRAPH, mode: MODE, expectedHead: legacyHead, record: { count: 2 } });
  const fresh = f.store(); await assert.rejects(fresh.load(GRAPH, MODE), { code: 'checkpoint_binding_pending' });
  const original = f.publications[0]; f.publishMode('normal'); const saved = await fresh.reconcile(GRAPH, MODE);
  assert.equal(saved.operationId, pending.operationId); assert.equal(saved.record.count, 2);
  assert.deepEqual(f.publications[1], original); assert.equal(f.writes.length, 1);
  f.resources.clear(); await assert.rejects(f.store().load(GRAPH, MODE), { code: 'missing_checkpoint' });
});

test('wrong key, duplicate recipients, attacker sender, relabelled attacker ciphertext and body tampering all fail closed', async () => {
  const f = await fixture(); await f.store().save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 1 } });
  const resourceUrl = await checkpointResourceUrl(POD, GRAPH, webcrypto), original = f.resources.get(resourceUrl), envelope = JSON.parse(new TextDecoder().decode(original.body));
  const attacker = new ClientKeyVault('attacker', keyStorage(), webcrypto); await attacker.create();
  await assert.rejects(f.store(attacker).load(GRAPH, MODE), { code: 'invalid_checkpoint_sender' });
  const mutations = [value => value.wrappedKeys.push(value.wrappedKeys[0]), value => { value.wrappedKeys[0].senderPublicKey = 'X'.repeat(44); },
    value => { value.content.ciphertext = (value.content.ciphertext[0] === 'A' ? 'B' : 'A') + value.content.ciphertext.slice(1); }];
  for (const mutate of mutations) {
    const changed = structuredClone(envelope); mutate(changed); f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(changed)) });
    await assert.rejects(f.store().load(GRAPH, MODE), error => ['invalid_checkpoint_sender', 'cannot_decrypt'].includes(error.code));
  }
  const forged = await attacker.seal('attacker-authored', [await f.vault.publicKey()]);
  forged.wrappedKeys = forged.wrappedKeys.filter(key => key.recipientPublicKey === envelope.wrappedKeys[0].recipientPublicKey);
  forged.wrappedKeys[0].senderPublicKey = envelope.wrappedKeys[0].senderPublicKey;
  f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(forged)) });
  await assert.rejects(f.store().load(GRAPH, MODE), { code: 'cannot_decrypt' });
});

test('authenticated owner, graph, resource, key, mode and payload digest substitutions are refused across fresh clients', async () => {
  const f = await fixture(); await f.store().save({ graphIri: GRAPH, mode: MODE, creating: true, record: { count: 1 } });
  const resourceUrl = await checkpointResourceUrl(POD, GRAPH, webcrypto), original = f.resources.get(resourceUrl);
  const body = JSON.parse(await f.vault.open(JSON.parse(new TextDecoder().decode(original.body))));
  for (const key of ['ownerDid', 'podUrl', 'graphIri', 'resourceUrl', 'vaultPublicKey', 'mode', 'recordCid']) {
    const changed = { ...body, [key]: 'urn:foreign' };
    f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(await f.vault.seal(JSON.stringify(changed)))) });
    await assert.rejects(f.store().load(GRAPH, MODE), { code: 'invalid_checkpoint' });
  }
  f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode('{}') });
  await assert.rejects(f.store().load(GRAPH, MODE), { code: 'invalid_checkpoint_sender' });
});

test('validation diagnostics expose only a fixed stage and never the private record, ciphertext or owner key', async () => {
  const f = await fixture(); await f.store().save({ graphIri: GRAPH, mode: MODE, creating: true, record: { marker: 'PRIVATE DIAGNOSTIC FIXTURE' } });
  const resourceUrl = await checkpointResourceUrl(POD, GRAPH, webcrypto), original = f.resources.get(resourceUrl);
  const envelope = JSON.parse(new TextDecoder().decode(original.body)), body = JSON.parse(await f.vault.open(envelope));
  const rejectedAt = async (expected, expectedCheck) => {
    await assert.rejects(f.store().load(GRAPH, MODE), cause => {
      assert.equal(cause.checkpointStage, expected); assert(CHECKPOINT_DIAGNOSTIC_STAGES.includes(cause.checkpointStage));
      if (expectedCheck) assert.equal(cause.checkpointCheck, expectedCheck);
      if (cause.checkpointCheck) assert(CHECKPOINT_DIAGNOSTIC_CHECKS.includes(cause.checkpointCheck));
      const diagnostic = JSON.stringify(cause);
      for (const privateValue of ['PRIVATE DIAGNOSTIC FIXTURE', envelope.content.ciphertext, envelope.wrappedKeys[0].recipientPublicKey]) assert(!diagnostic.includes(privateValue));
      assert.deepEqual(Object.keys(cause).sort(), cause.checkpointCheck ? ['checkpointCheck', 'checkpointStage', 'code'] : ['checkpointStage', 'code']); return true;
    });
  };
  f.resources.set(resourceUrl, { ...original, revision: null }); await rejectedAt('headers');
  f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode('invalid JSON') }); await rejectedAt('envelope');
  const sender = structuredClone(envelope); sender.wrappedKeys[0].senderPublicKey = 'foreign';
  f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(sender)) }); await rejectedAt('owner-key');
  const tamper = structuredClone(envelope); tamper.content.ciphertext = 'A' + tamper.content.ciphertext.slice(1);
  if (tamper.content.ciphertext === envelope.content.ciphertext) tamper.content.ciphertext = 'B' + tamper.content.ciphertext.slice(1);
  f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(tamper)) }); await rejectedAt('decrypt');
  for (const [expected, expectedCheck, mutate] of [
    ['body-scope', 'schema', value => { value.schema = 'foreign'; }],
    ['body-scope', 'owner', value => { value.ownerDid = 'did:foreign'; }],
    ['body-scope', 'pod', value => { value.podUrl = 'https://foreign.example/'; }],
    ['body-scope', 'graph', value => { value.graphIri = 'urn:foreign'; }],
    ['body-scope', 'resource', value => { value.resourceUrl = 'https://foreign.example/'; }],
    ['body-scope', 'mode', value => { value.mode = 'foreign'; }],
    ['body-scope', 'key', value => { value.vaultPublicKey = 'foreign'; }],
    ['body-scope', 'operation', value => { value.operationId = null; }],
    ['body-scope', 'previous-revision', value => { value.previousRevision = 7; }],
    ['body-scope', 'time', value => { value.at = -1; }],
    ['body-scope', 'history-shape', value => { value.history = {}; }],
    ['body-scope', 'budget-shape', value => { value.budget = {}; }],
    ['body-scope', 'binding-schema', value => { value.binding.schema = 'foreign'; }],
    ['record-digest', 'record-digest', value => { value.record.marker = 'changed'; }],
    ['binding-plan', 'binding-value', value => { value.binding.resourceUrl = 'https://foreign.example/'; }],
    ['binding-plan', 'binding-digest', value => { value.bindingDigest = null; }],
    ['binding-plan', 'binding-graph', value => { value.bindingPlan.args.graph_iri = 'urn:foreign'; }],
    ['binding-plan', 'binding-plan-digest', value => { value.bindingPlan.digest = 'changed'; }],
    ['binding-plan', 'binding-record', value => { value.bindingPlan.record = null; }],
    ['binding-plan', 'binding-record-value', value => { value.bindingPlan.record.resourceUrl = 'https://foreign.example/'; }],
    ['budget', 'budget-entry', value => { value.budget[0].bytes = -1; }],
    ['history', 'history-entry', value => { value.history.push({ at: body.at, operationId: body.operationId, recordCid: 'changed', record: body.record }); }],
  ]) {
    const changed = structuredClone(body); mutate(changed);
    f.resources.set(resourceUrl, { ...original, body: new TextEncoder().encode(JSON.stringify(await f.vault.seal(JSON.stringify(changed)))) });
    await rejectedAt(expected, expectedCheck);
  }
});
