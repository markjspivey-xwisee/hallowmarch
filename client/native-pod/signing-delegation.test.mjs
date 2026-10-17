import test from 'node:test';
import assert from 'node:assert/strict';
import { createNativeSigningDelegation } from './signing-delegation.mjs';

const slug = 'u-pk-1234567890ab', ownerDid = 'did:web:identity.example:users:' + slug;
const agentDid = 'did:web:identity.example:agents:browser-' + slug;
const webId = 'https://identity.example/users/' + slug + '/profile#me';
const podUrl = 'https://gate.example/' + slug + '/', internalPod = 'http://css.railway.internal:3456/' + slug + '/';
const anchor = '0x0123456789abcdef0123456789abcdef01234567', clock = Date.parse('2026-10-17T12:00:00.000Z');
const clone = value => structuredClone(value);
function fixture({ ready = false, scope = 'ReadWrite', capability = true, register = 'commit' } = {}) {
  let present = ready, registration = register;
  const calls = [], mutateStatus = [], mutateVerdict = [];
  const missing = () => 'No signed delegation credential found for ' + agentDid + ' on ' + internalPod;
  const makeStatus = () => ({ userId: slug, identity: { did: ownerDid, webId }, sessionAgent: { did: agentDid },
    pod: internalPod, webId, registry: { owner: webId, agents: 1 },
    delegationRegistry: { owner: webId, url: internalPod + 'agents', count: 1,
      rows: [{ agentId: agentDid, scope, validFrom: '2026-10-17T11:00:00.000Z' }] },
    ...(capability ? { capabilities: { register_agent_repair_only: true } } : {}) });
  const makeVerdict = () => ({ subjectPodUrl: podUrl, subject_pod_url: podUrl, subject_pod_name: slug, subject_pod_selected_by: 'pod_url',
    valid: present, verified: present, trustLevel: present ? 'CryptographicallyVerified' : 'SelfAsserted', chainLength: present ? 1 : 0,
    delegationChain: present ? { anchored: true, length: 1, owner: webId, agent: agentDid, scope } : null,
    reason: present ? null : missing(), owner: webId, agent: agentDid, ...(present ? { scope } : {}),
    enforcement: { enforced: true, scope, writeEligible: ['ReadWrite', 'PublishOnly'].includes(scope), basis: present ? 'signed-chain' : 'registry-only', chainReason: present ? null : missing() },
    signing: { relayAnchor: anchor, credentialAgentId: agentDid, credentialAnchor: present ? anchor.toUpperCase().replace('0X', '0x') : null, canSignDelegatedRequests: present } });
  const helper = createNativeSigningDelegation({ ownerDid, podUrl, agentDid, now: () => clock,
    async callTool(name, args) {
      calls.push({ name, args: clone(args) });
      if (name === 'get_pod_status') { const value = makeStatus(); for (const change of mutateStatus) change(value); return value; }
      if (name === 'verify_agent') { const value = makeVerdict(); for (const change of mutateVerdict) change(value); return value; }
      assert.equal(name, 'register_agent');
      assert.deepEqual(args, { agent_id: agentDid, pod_name: slug, repair_only: true });
      if (typeof registration === 'function') return registration(() => { present = true; });
      if (registration === 'lost-before') throw Error('private-native-token and arbitrary relay refusal');
      if (registration !== 'no-commit') present = true;
      if (registration === 'lost-after') throw Error('private-native-token and lost receipt');
      return { registered: false, repaired: true, repair_only: true, agent: agentDid, scope };
    } });
  return { helper, calls, mutateStatus, mutateVerdict, setPresent(value) { present = value; },
    setRegister(value) { registration = value; }, writes: () => calls.filter(call => call.name === 'register_agent').length };
}

test('construction has no I/O and status contains only booleans; invalid ownership configuration refuses', () => {
  const f = fixture(); assert.equal(f.calls.length, 0);
  assert.deepEqual(f.helper.status(), { verified: false, repairAttempted: false, repairPending: false, busy: false });
  for (const config of [{ ownerDid: 'did:example:owner' }, { podUrl: 'https://gate.example/another/' }, { agentDid: '' }, { now: false }]) {
    assert.throws(() => createNativeSigningDelegation({ ownerDid, podUrl, agentDid, callTool() {}, ...config }), { code: 'native_signing_configuration' });
  }
});

for (const scope of ['ReadWrite', 'PublishOnly']) test('already verified direct owner ' + scope + ' stays read-only and needs no repair capability', async () => {
  const f = fixture({ ready: true, scope, capability: false });
  assert.deepEqual(await f.helper.ensure(), { verified: true, repairAttempted: false, repairPending: false, busy: false });
  await f.helper.ensure(); assert.equal(f.writes(), 0);
  assert.deepEqual(f.calls.map(call => call.name), ['get_pod_status', 'verify_agent', 'get_pod_status', 'verify_agent']);
  assert.deepEqual(f.calls[1].args, { agent_id: agentDid, pod_url: podUrl });
});

for (const scope of ['ReadWrite', 'PublishOnly']) test('missing current principal credential repairs once without requesting authority changes: ' + scope, async () => {
  const f = fixture({ scope }); const result = await f.helper.ensure();
  assert.deepEqual(result, { verified: true, repairAttempted: true, repairPending: false, busy: false });
  assert.equal(f.writes(), 1); await f.helper.ensure(); assert.equal(f.writes(), 1);
  assert.deepEqual(f.calls.map(call => call.name).slice(0, 5), ['get_pod_status', 'verify_agent', 'register_agent', 'get_pod_status', 'verify_agent']);
});

test('missing repair-only capability refuses without old-relay fallback', async () => {
  const f = fixture({ capability: false });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_unavailable' }); assert.equal(f.writes(), 0);
});

test('native structured projection may omit null missing-credential and verified-reason fields without omitting positive proof', async () => {
  const f = fixture();
  f.mutateVerdict.push(value => {
    if (value.delegationChain === null) delete value.delegationChain;
    if (value.signing.credentialAnchor === null) delete value.signing.credentialAnchor;
    if (value.reason === null) delete value.reason;
    if (value.enforcement.chainReason === null) delete value.enforcement.chainReason;
  });
  assert.equal((await f.helper.ensure()).verified, true); assert.equal(f.writes(), 1);
  await f.helper.ensure(); assert.equal(f.writes(), 1);
  f.mutateVerdict.push(value => { delete value.signing.credentialAnchor; });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_delegation_required' }); assert.equal(f.writes(), 1);
});

for (const scope of ['ReadOnly', 'DiscoverOnly', 'Unknown']) test('narrow scope is never widened: ' + scope, async () => {
  const f = fixture({ scope }); await assert.rejects(f.helper.ensure(), { code: 'native_signing_delegation_required' });
  assert.equal(f.writes(), 0);
});

const statusRefusals = [
  ['foreign owner', value => { value.identity.did = 'did:web:identity.example:users:other'; }],
  ['foreign session agent', value => { value.sessionAgent.did = 'did:web:identity.example:agents:other'; }],
  ['foreign pod', value => { value.pod = 'https://gate.example/other/'; }],
  ['foreign registry owner', value => { value.delegationRegistry.owner = 'https://identity.example/users/other/profile#me'; }],
  ['revoked or absent live row', value => { value.delegationRegistry.rows = []; value.delegationRegistry.count = 0; }],
  ['explicit revoked row', value => { value.delegationRegistry.rows[0].revoked = true; }],
  ['future registry row', value => { value.delegationRegistry.rows[0].validFrom = '2026-10-18T00:00:00.000Z'; }],
  ['duplicate principal rows', value => { value.delegationRegistry.rows.push(clone(value.delegationRegistry.rows[0])); value.delegationRegistry.count++; }],
];
for (const [label, change] of statusRefusals) test(label + ' refuses before any repair', async () => {
  const f = fixture(); f.mutateStatus.push(change); await assert.rejects(f.helper.ensure()); assert.equal(f.writes(), 0);
});

const verdictRefusals = [
  ['foreign subject', value => { value.subjectPodUrl = value.subject_pod_url = 'https://gate.example/other/'; }],
  ['foreign credential subject', value => { value.signing.credentialAgentId = 'did:web:identity.example:agents:other'; }],
  ['legacy registered alias', value => { value.agent = value.signing.credentialAgentId = 'urn:agent:browser'; }],
  ['foreign owner', value => { value.owner = 'https://identity.example/users/other/profile#me'; }],
  ['missing parent credential', value => { value.reason = value.enforcement.chainReason = 'No signed delegation credential found for did:web:identity.example:agents:parent on ' + internalPod; }],
  ['arbitrary unanchorable credential', value => { value.reason = value.enforcement.chainReason = 'Sub-delegating agent other is not registered on ' + internalPod; }],
  ['revoked credential', value => { value.reason = value.enforcement.chainReason = "Agent " + agentDid + "'s delegation has been revoked"; }],
  ['expired credential', value => { value.reason = value.enforcement.chainReason = 'Delegation credential for ' + agentDid + ' expired'; }],
  ['unsigned credential', value => { value.reason = value.enforcement.chainReason = 'Delegation credential for ' + agentDid + ' is unsigned'; }],
  ['unknown signing anchor', value => { value.signing.relayAnchor = null; }],
  ['scope contradiction', value => { value.enforcement.scope = 'ReadOnly'; }],
  ['non-enforced registry', value => { value.enforcement.enforced = false; }],
  ['malformed trust level', value => { value.trustLevel = 'CryptographicallyVerified'; }],
];
for (const [label, change] of verdictRefusals) test(label + ' cannot trigger repair', async () => {
  const f = fixture(); f.mutateVerdict.push(change); await assert.rejects(f.helper.ensure(), { code: 'native_signing_delegation_required' }); assert.equal(f.writes(), 0);
});

for (const [label, change] of [
  ['stale relay anchor', value => { value.signing.credentialAnchor = '0x' + 'f'.repeat(40); value.signing.canSignDelegatedRequests = false; }],
  ['subdelegation', value => { value.chainLength = value.delegationChain.length = 2; }],
  ['unbound direct chain', value => { value.delegationChain.agent = 'did:web:identity.example:agents:other'; }],
  ['unanchored chain', value => { value.delegationChain.anchored = false; }],
]) test('an existing ' + label + ' is refused without rewriting its credential', async () => {
  const f = fixture({ ready: true }); f.mutateVerdict.push(change);
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_delegation_required' }); assert.equal(f.writes(), 0);
});

test('a lost ACK before commit fences all later writes, but later exact readback can confirm the original attempt', async () => {
  const f = fixture({ register: 'lost-before' });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_pending' });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_pending' }); assert.equal(f.writes(), 1);
  assert.deepEqual(f.helper.status(), { verified: false, repairAttempted: true, repairPending: true, busy: false });
  f.setPresent(true); assert.equal((await f.helper.ensure()).verified, true); assert.equal(f.writes(), 1);
});

test('a lost ACK after commit succeeds only from fresh verified chain and current-anchor readback', async () => {
  const f = fixture({ register: 'lost-after' }); assert.equal((await f.helper.ensure()).verified, true);
  assert.equal(f.writes(), 1); assert.equal(f.calls.filter(call => call.name === 'verify_agent').length, 2);
});

test('successful registration acknowledgement cannot replace full exact verification', async () => {
  const f = fixture({ register: 'no-commit' }); await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_pending' });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_pending' }); assert.equal(f.writes(), 1);
});

test('parallel setup calls share one dispatched repair and status reports the pending operation', async () => {
  let enter, release; const entered = new Promise(resolve => { enter = resolve; }), wait = new Promise(resolve => { release = resolve; });
  const f = fixture({ register: async commit => { enter(); await wait; commit(); return {}; } });
  const first = f.helper.ensure(), second = f.helper.ensure(); assert.equal(first, second); await entered;
  assert.deepEqual(f.helper.status(), { verified: false, repairAttempted: true, repairPending: true, busy: true });
  release(); assert.equal((await first).verified, true); await second; assert.equal(f.writes(), 1);
});

test('a later revoked registry clears prior ready status and never repairs it', async () => {
  const f = fixture({ ready: true }); await f.helper.ensure();
  f.mutateStatus.push(value => { value.delegationRegistry.rows = []; value.delegationRegistry.count = 0; });
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_delegation_required' }); assert.equal(f.helper.status().verified, false); assert.equal(f.writes(), 0);
});

test('transport exceptions expose only fixed code/message and boolean state', async () => {
  const helper = createNativeSigningDelegation({ ownerDid, podUrl, agentDid, async callTool() { throw Error('private-native-token secret'); } });
  await assert.rejects(helper.ensure(), error => {
    assert.equal(error.name, 'NativeSigningDelegationError'); assert.equal(error.code, 'native_signing_unavailable');
    assert(!String(error).includes('private-native-token')); return true;
  });
  assert(Object.values(helper.status()).every(value => typeof value === 'boolean'));
});

test('fixed native reauthentication code survives without raw exception text or a repair attempt', async () => {
  const helper = createNativeSigningDelegation({ ownerDid, podUrl, agentDid, async callTool() {
    throw Object.assign(Error('private-native-token expired'), { code: 'needs_reauth' });
  } });
  await assert.rejects(helper.ensure(), error => {
    assert.equal(error.name, 'NativeSigningDelegationError'); assert.equal(error.code, 'needs_reauth');
    assert(!String(error).includes('private-native-token')); return true;
  });
  assert.equal(helper.status().repairAttempted, false);
});

test('reauthentication after a dispatched repair preserves its unknown fence and resumes with readback only', async () => {
  const f = fixture();
  f.setRegister(async () => {
    f.mutateStatus.push(() => { throw Object.assign(Error('private-token expired after dispatch'), { code: 'needs_reauth' }); });
    throw Error('Lost repair acknowledgement');
  });
  await assert.rejects(f.helper.ensure(), { code: 'needs_reauth' });
  assert.equal(f.helper.status().repairPending, true); assert.equal(f.writes(), 1);
  f.mutateStatus.pop();
  await assert.rejects(f.helper.ensure(), { code: 'native_signing_repair_pending' }); assert.equal(f.writes(), 1);
  f.setPresent(true); assert.equal((await f.helper.ensure()).verified, true); assert.equal(f.writes(), 1);
});
