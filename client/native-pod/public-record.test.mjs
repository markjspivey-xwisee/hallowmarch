import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createNativePublicRecordClient } from './public-record.mjs';
import { computeCid } from './vendor/interego-public-browser.mjs';
import { publicRecordFixture, webId, ownerDid, agentDid } from './public-record.fixture.mjs';
const input = { graphIri: 'urn:graph:public:test', graphContent: '<urn:graph:public:test> <urn:relation> "public relationship" .\n', publicData: true };
const sdk = process.env.INTEREGO_SDK_TEST_ROOT ? await import(pathToFileURL(resolve(process.env.INTEREGO_SDK_TEST_ROOT, 'packages/core/dist/index.js'))) : null;

test('public SDK bundle provenance pins unchanged Solid declaration closure and real CID primitive', async () => {
  const manifest = JSON.parse(await readFile(new URL('./vendor/interego-public-browser.manifest.json', import.meta.url)));
  const bytes = await readFile(new URL('./vendor/interego-public-browser.mjs', import.meta.url));
  assert.equal(manifest.revision, '87ee71626c015af3c1e7b9dac5579eff6899e8c1');
  assert.equal(manifest.sha256, createHash('sha256').update(bytes).digest('hex')); assert.equal(manifest.bytes, bytes.length);
  assert(manifest.declarationSlices[0].declarations.includes('digestedGraphRegion')); assert(!bytes.toString().includes('node:crypto'));
});
test('explicit public consent, native owner status, signed public readback, sole head and update CAS', async () => {
  const f = publicRecordFixture();
  assert.throws(() => createNativePublicRecordClient(f.options({ publicData: false })), { code: 'public_disclosure_required' });
  const client = f.client(); await client.connect();
  await assert.rejects(client.create({ ...input, publicData: undefined }), { code: 'public_disclosure_required' });
  const first = await client.create(input); assert.equal(first.saved, true); assert.equal(first.receipt.ownerDid, ownerDid);
  assert.equal(first.receipt.authorship.authority, 'relay-attestation'); assert.equal(first.receipt.visibility, 'public');
  const publication = f.calls.find(call => call.name === 'publish_context').args;
  assert.equal(publication.sign_authorship, true); assert.equal(publication.visibility, 'public'); assert(!('sealed_payload' in publication));
  assert.equal(publication.auto_supersede_prior, false); assert(!('if_match' in publication));
  const changed = await client.save({ ...input, graphContent: input.graphContent.replace('relationship', 'updated'), expectedHead: first.head });
  assert.equal(changed.saved, true); assert.equal(changed.receipt.cas, 'matched-prior-head');
  assert.equal(f.calls.filter(call => call.name === 'publish_context')[1].args.if_match, first.head.cid);
  await assert.rejects(client.save({ ...input, expectedHead: first.head }), { code: 'conflict' });
  await assert.rejects(client.create(input), { code: 'conflict' });
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 2);
  assert(f.publicCalls.length >= 4);
  for (const read of f.publicCalls) { assert.equal(read.init.credentials, 'omit'); assert.equal(read.init.redirect, 'error'); assert(!read.init.headers.Authorization); }
  assert(!f.calls.some(call => call.name === 'register_agent'));
});
test('publisher prepares only its current missing credential through the advertised repair-only mode', async () => {
  const f = publicRecordFixture({ nativeSigning: 'missing', repairAck: 'lost-after' }), client = f.client();
  await client.connect(); assert.equal((await client.create(input)).saved, true);
  await client.connect();
  assert.deepEqual(f.calls.filter(call => call.name === 'register_agent').map(call => call.args), [{ agent_id: agentDid, pod_name: 'alice', repair_only: true }]);
  assert(f.calls.findIndex(call => call.name === 'verify_agent') < f.calls.findIndex(call => call.name === 'register_agent'));
});
test('publisher refuses unsupported or unresolved repair without publishing or repeating the credential write', async () => {
  const old = publicRecordFixture({ nativeSigning: 'missing', repairCapability: false }), unavailable = old.client();
  await assert.rejects(unavailable.connect(), { code: 'native_signing_repair_unavailable' });
  assert(!old.calls.some(call => ['register_agent', 'publish_context'].includes(call.name)));
  const f = publicRecordFixture({ nativeSigning: 'missing', repairAck: 'lost-before' }), client = f.client();
  await assert.rejects(client.connect(), { code: 'native_signing_repair_pending' });
  await assert.rejects(client.connect(), { code: 'native_signing_repair_pending' });
  assert.equal(f.calls.filter(call => call.name === 'register_agent').length, 1);
  assert(!f.calls.some(call => call.name === 'publish_context'));
});
test('native relay attestation remains verifiable with an aggregate SelfAsserted trust report', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect();
  const saved = await client.create(input); assert.equal(saved.saved, true);
  const actual = f.records.get(saved.head.descriptorUrl).read.authorship;
  assert.equal(actual.effectiveTrustLevel, 'SelfAsserted'); assert.equal(actual.signatureAuthority, 'relay');
  assert.equal((await client.load(input)).receipt.authorship.authority, 'relay-attestation');
});
test('pending and lost acknowledgement require native confirmation with same operation and payload', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect();
  f.setMode('pending'); const pending = await client.create(input); assert.equal(pending.saved, false); assert.equal(pending.status, 'pending');
  await assert.rejects(client.create(input), { code: 'confirmation_required' });
  f.release(); const first = await client.confirm(pending.operationId); assert.equal(first.saved, true);
  f.setMode('throw-after'); const uncertain = await client.save({ ...input, expectedHead: first.head });
  assert.equal(uncertain.saved, false); assert.equal(uncertain.status, 'uncertain');
  assert.equal((await client.confirm(uncertain.operationId)).saved, true);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 2);
});
test('native null-head absence permits creation; arbitrary missing or contradictory heads do not', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); f.setMode('empty-head-no-forked');
  assert.equal(await client.currentHead(input), null); assert.equal((await client.create(input)).saved, true);
  for (const mode of ['missing-head', 'contradictory-head']) {
    const broken = publicRecordFixture(), reader = broken.client(); await reader.connect(); broken.setMode(mode);
    await assert.rejects(reader.currentHead(input)); await assert.rejects(reader.create(input));
    assert.equal(broken.calls.filter(call => call.name === 'publish_context').length, 0);
  }
});
test('actual native MCP structured-content projection may omit the explicit null head', { skip: !sdk }, async () => {
  const nativeAbsence = { urn: input.graphIri, podUrl: 'https://pod.example/alice/', head: null,
    message: 'No descriptor on this pod describes the requested urn.' };
  assert.equal(Object.hasOwn(sdk.toStructuredContent(nativeAbsence), 'head'), false);
  const f = publicRecordFixture({ projectMcpResult: sdk.toStructuredContent }), client = f.client(); await client.connect();
  assert.equal(await client.currentHead(input), null);
  const created = await client.create(input); assert.equal(created.saved, true);
  assert.equal((await client.load(input)).head.cid, created.head.cid);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
});
test('an explicit null head proves initial absence only with the native no-descriptor finding', async () => {
  for (const message of [undefined, 'Native head reply is unreadable.', 'All descriptors describing this urn are superseded; no current head.']) {
    const f = publicRecordFixture({ projectMcpResult(raw) {
      return raw.urn === input.graphIri ? { ...raw, head: null, forked: false, message } : raw;
    } }), client = f.client(); await client.connect();
    await assert.rejects(client.currentHead(input)); await assert.rejects(client.create(input));
    assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  }
});
test('projected absence refuses missing or contradictory native evidence before any publication', { skip: !sdk }, async () => {
  for (const mutation of [
    value => { delete value.message; },
    value => { value.message = 'Native head reply is unreadable.'; },
    value => { value.message = 'All descriptors describing this urn are superseded; no current head.'; value.forked = false; },
    value => { value.forked = true; },
    value => { value.heads = [{ descriptorUrl: 'https://pod.example/alice/context-graphs/other.ttl', cid: 'other-head' }]; },
  ]) {
    const f = publicRecordFixture({ projectMcpResult(raw) {
      const projected = sdk.toStructuredContent(raw); if (raw.urn === input.graphIri) mutation(projected); return projected;
    } }), client = f.client(); await client.connect();
    await assert.rejects(client.currentHead(input)); await assert.rejects(client.create(input));
    assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  }
});
test('native owner status authenticates the relay CSS alias when OAuth pod and named-head roots differ', async () => {
  const f = publicRecordFixture({ css: 'http://css.railway.internal:3456/' }), client = f.client(); await client.connect();
  assert.equal(await client.currentHead(input), null);
  const saved = await client.create(input); assert.equal(saved.saved, true);
  assert.equal((await client.load(input)).receipt.ownerDid, ownerDid);
  assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
});
test('CSS alias proof never admits an unadvertised host, different owner path or malformed storage base', async () => {
  const css = 'http://css.railway.internal:3456/';
  for (const alienPod of ['https://foreign.example/alice/', css + 'someone-else/']) {
    const f = publicRecordFixture({ css });
    const tx = { connect: async names => ({ granted: names }), callTool: async (name, args) => {
      const value = await f.dispatch(name, args);
      return name === 'get_current_head' ? { ...value, podUrl: alienPod } : value;
    } };
    const client = f.client({ transport: tx }); await client.connect();
    await assert.rejects(client.currentHead(input), { code: 'owner_mismatch' });
    await assert.rejects(client.create(input), { code: 'owner_mismatch' });
    assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 0);
  }
  for (const invalidCss of [css + 'some-prefix/', 'https://css.example/?token=unsafe', 'https://css.example/#foreign']) {
    const f = publicRecordFixture({ css: invalidCss }), client = f.client();
    await assert.rejects(client.connect()); assert.equal(client.status().connected, false);
  }
});
test('initial concurrent fork and stale updates fail closed without false publication acknowledgement', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); f.setMode('fork');
  const result = await client.create(input); assert.equal(result.saved, false); assert.equal(result.status, 'uncertain');
  await assert.rejects(client.confirm(result.operationId), { code: 'conflict' });
  assert.equal(client.status().pending, 1); assert.equal(f.calls.filter(call => call.name === 'publish_context').length, 1);
});
for (const [label, mutate] of [
  ['wrong owner', value => ({ ...value, turtle: value.turtle.replace(webId, 'https://identity.example/users/bob/profile#me') })],
  ['unsigned relay report', value => ({ ...value, authorship: { ...value.authorship, authorshipVerified: false } })],
  ['missing relay authority despite optimistic aggregate trust', value => ({ ...value, authorship: { ...value.authorship, signatureAuthority: undefined, effectiveTrustLevel: 'CryptographicallyVerified' } })],
  ['unclassified signer despite optimistic aggregate trust', value => ({ ...value, authorship: { ...value.authorship, signatureAuthority: 'unclassified', effectiveTrustLevel: 'CryptographicallyVerified' } })],
  ['foreign signer authority', value => ({ ...value, authorship: { ...value.authorship, signatureAuthority: 'agent' } })],
  ['unbound content', value => ({ ...value, authorship: { ...value.authorship, contentBinding: 'unbound' } })],
  ['slug-only location', value => ({ ...value, authorship: { ...value.authorship, descriptorBinding: { bound: true, basis: 'slug-only' } } })],
  ['private distribution', value => ({ ...value, turtle: value.turtle.replace('visibility "public"', 'visibility "private"') })],
  ['tampered payload', value => ({ ...value, graph: { ...value.graph, content: value.graph.content.replace('public relationship', 'forged relationship') } })],
  ['foreign payload URL', value => ({ ...value, graph: { ...value.graph, url: 'https://evil.example/graph.trig' } })],
]) test('public confirmation refuses ' + label, async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); f.mutateRead(mutate);
  const result = await client.create(input); assert.equal(result.saved, false); assert.equal(result.status, 'uncertain');
  await assert.rejects(client.confirm(result.operationId));
});
test('anonymous public readback must be byte-identical for descriptor and content-bound for payload', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); f.setMode('public-tamper');
  const result = await client.create(input); assert.equal(result.saved, false);
  f.setMode('normal'); assert.equal((await client.confirm(result.operationId)).saved, true);
});
test('valid descriptor CID does not substitute for owner, publisher or public distribution binding', async () => {
  for (const [rewrite, code] of [
    [text => text.replace(webId, 'https://identity.example/users/bob/profile#me'), 'invalid_proof'],
    [text => text.replace('iep:agentDid "did:web:identity.example:agents:browser-alice"', 'iep:agentDid "did:web:identity.example:agents:foreign"'), 'invalid_proof'],
    [text => text.replace('visibility "public"', 'visibility "private"'), 'public_distribution_required'],
  ]) {
    const f = publicRecordFixture(), client = f.client(); await client.connect(); const saved = await client.create(input);
    const stored = f.records.get(saved.head.descriptorUrl); stored.read.turtle = rewrite(stored.read.turtle);
    stored.selected.cid = computeCid(stored.read.turtle); f.heads.set(input.graphIri, stored.selected);
    await assert.rejects(client.load(input), { code });
  }
});
test('payload parsing is restricted to the SDK digested named graph; changing head during read refuses', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); const first = await client.create(input);
  const record = f.records.get(first.head.descriptorUrl); record.read.graph.content += '<urn:outside> <urn:p> "not part of the record" .\n';
  const loaded = await client.load(input); assert(!loaded.graphContent.includes('not part of the record'));
  f.afterRead(() => f.heads.set(input.graphIri, { ...first.head, cid: 'different-head' }));
  await assert.rejects(client.load(input), { code: 'conflict' });
});
test('public reader limits pending records and cannot complete after close', async () => {
  const f = publicRecordFixture(), client = f.client(); await client.connect(); f.setMode('throw-before');
  for (let index = 0; index < 8; index++) assert.equal((await client.create({ ...input, graphIri: input.graphIri + ':' + index })).saved, false);
  await assert.rejects(client.create({ ...input, graphIri: input.graphIri + ':ninth' }), { code: 'confirmation_required' });
  client.close(); await assert.rejects(client.load(input), { code: 'not_connected' }); assert.equal(client.status().pending, 0);
});
