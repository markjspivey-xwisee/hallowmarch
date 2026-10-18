import test from 'node:test';
import assert from 'node:assert/strict';
import { createOwnerAgentDirectory } from './agent-directory.mjs';

const slug = 'u-pk-1234567890ab', ownerDid = 'did:web:identity.example:users:' + slug;
const webId = 'https://identity.example/users/' + slug + '/profile#me';
const podUrl = 'https://gate.example/' + slug + '/', internalPod = 'http://css.railway.internal:3456/' + slug + '/';
const sessionDid = 'did:web:identity.example:agents:hallowmarch-' + slug;
const chatgpt = 'did:web:identity.example:agents:chatgpt-' + slug, claude = 'did:web:identity.example:agents:claude-mobile-' + slug;
const relayUrl = 'https://relay.example', anchor = '0x0123456789abcdef0123456789abcdef01234567';
const clock = Date.parse('2026-10-18T02:00:00.000Z'), issued = '2026-10-18T01:00:00.000Z';
const binding = { subjectDid: ownerDid, webId, podUrl, authenticatedAgentDid: sessionDid };
const credential = { kind: 'relay-oauth-bearer', method: 'webauthn', accessToken: 'private-native-access-token-123456', expiresAt: clock + 60000 };
const copy = value => structuredClone(value);
function fixture({ scope = 'ReadWrite', statusChange = () => {}, verdictChange = () => {}, capabilities = ['get_pod_status', 'verify_agent'],
  call = null, config = {} } = {}) {
  const calls = [], grants = [], clears = []; let at = clock, statusReads = 0;
  const status = () => ({ pod: internalPod, userId: slug, identity: { did: ownerDid, webId }, webId,
    sessionAgent: { did: sessionDid }, agentsSource: 'identity-server',
    agents: [{ id: 'chatgpt-' + slug, did: chatgpt, label: 'ChatGPT', surface: 'chatgpt' },
      { id: 'claude-mobile-' + slug, did: claude, label: 'Claude', surface: 'claude-mobile' },
      { id: 'unregistered', did: 'did:web:identity.example:agents:unregistered', label: 'Not registered' }],
    registry: { owner: webId, agents: 3 }, delegationRegistry: { owner: webId, url: internalPod + 'agents', count: 3,
      rows: [{ agentId: chatgpt, scope, validFrom: issued }, { agentId: claude, scope: 'ReadOnly', label: 'Claude on my phone' },
        { agentId: podUrl + 'agents#browser-encryption-original', scope: 'ReadOnly' }] },
    // Unrelated status/private fields must never enter the public result.
    accessToken: 'PRIVATE_STATUS_TOKEN', recentNotifications: [{ resource: 'PRIVATE_RESOURCE' }], entries: [{ arbitrary: 'PRIVATE_GRAPH' }] });
  const verdict = did => ({ subjectPodUrl: podUrl, subject_pod_url: podUrl, subject_pod_name: slug, subject_pod_selected_by: 'pod_url',
    owner: webId, agent: did, valid: true, verified: true, trustLevel: 'CryptographicallyVerified', chainLength: 1, reason: null, scope,
    delegationChain: { anchored: true, length: 1, owner: webId, agent: did, scope },
    signing: { relayAnchor: anchor, credentialAnchor: anchor.toUpperCase().replace('0X', '0x'), credentialAgentId: did, canSignDelegatedRequests: true },
    enforcement: { enforced: true, scope, basis: 'signed-chain', chainReason: null, writeEligible: ['ReadWrite', 'PublishOnly'].includes(scope) } });
  const port = {
    async connect(required, probe) { calls.push({ name: 'connect', required: [...required], probe }); return { granted: capabilities }; },
    async callTool(name, args, options) {
      calls.push({ name, args: copy(args), options });
      assert.ok(['get_pod_status', 'verify_agent'].includes(name), 'directory must remain read-only');
      assert.equal(options.cache, false); assert.ok(options.signal instanceof AbortSignal);
      if (call) { const replacement = await call({ name, args, options, status, verdict }); if (replacement !== undefined) return replacement; }
      if (name === 'get_pod_status') { const value = status(); statusChange(value, ++statusReads); return value; }
      const value = verdict(args.agent_id); verdictChange(value); return value;
    },
    setCredential(value) { clears.push(copy(value)); },
  };
  let constructed = 0;
  const directory = createOwnerAgentDirectory({ binding, credential, relayUrl, now: () => at,
    createTransport(actualRelay, grant) { constructed++; assert.equal(actualRelay, relayUrl); grants.push(grant); return port; }, ...config });
  return { directory, calls, grants, clears, port, constructed: () => constructed, setTime(value) { at = value; } };
}
const expectedAgents = [{ did: chatgpt, label: 'ChatGPT', surface: 'chatgpt' }, { did: claude, label: 'Claude on my phone', surface: 'claude-mobile' }];

test('construction performs no I/O; list exposes only bounded registered metadata and does not select the browser agent', async () => {
  const f = fixture(); assert.equal(f.constructed(), 0); assert.deepEqual(f.calls, []);
  const result = await f.directory.list();
  assert.deepEqual(result, { ownerDid, podUrl, agents: expectedAgents });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.agents) && result.agents.every(Object.isFrozen));
  assert.equal(JSON.stringify(result).includes('PRIVATE'), false); assert.equal(JSON.stringify(result).includes(credential.accessToken), false);
  assert.equal(Object.hasOwn(result, 'selected'), false); assert.equal(Object.hasOwn(result, 'sessionAgent'), false);
  assert.deepEqual(f.calls.map(({ name }) => name), ['connect', 'get_pod_status']);
  assert.deepEqual(f.calls[0], { name: 'connect', required: ['get_pod_status', 'verify_agent'], probe: 'get_pod_status' });
  assert.notEqual(f.grants[0], credential); assert.equal(f.grants[0].refreshToken, null);
});

test('list re-reads the owner roster; registry-only labels need no provider inference or identity-list membership', async () => {
  const did = 'did:web:identity.example:agents:custom';
  const f = fixture({ statusChange(value, index) {
    value.agents = []; value.agentsSource = 'none';
    value.delegationRegistry.rows = index === 1 ? [{ agentId: did, scope: 'DiscoverOnly', label: 'My agent' }] : [];
    value.delegationRegistry.count = value.delegationRegistry.rows.length;
  } });
  assert.deepEqual((await f.directory.list()).agents, [{ did, label: 'My agent', surface: '' }]);
  assert.deepEqual((await f.directory.list()).agents, []); assert.equal(f.constructed(), 1);
  assert.equal(f.calls.filter(call => call.name === 'get_pod_status').length, 2);
});

test('identical identity metadata deduplicates while inactive, foreign-authority and non-agent registry entries stay out', async () => {
  const f = fixture({ statusChange(value) {
    value.agents.push(copy(value.agents[0]));
    value.delegationRegistry.rows.push({ agentId: 'did:web:identity.example:agents:revoked', scope: 'ReadWrite', revoked: true },
      { agentId: 'did:web:identity.example:agents:future', scope: 'ReadWrite', validFrom: '2026-10-19T00:00:00.000Z' },
      { agentId: 'did:web:identity.example:agents:expired', scope: 'ReadWrite', validUntil: '2026-10-18T01:59:59.000Z' },
      { agentId: 'did:web:another.example:agents:external', scope: 'ReadWrite' },
      { agentId: ownerDid, scope: 'ReadWrite' });
    value.delegationRegistry.count = value.delegationRegistry.rows.length;
  } });
  assert.deepEqual((await f.directory.list()).agents, expectedAgents);
});

for (const scope of ['ReadWrite', 'PublishOnly', 'ReadOnly', 'DiscoverOnly']) test('verify confirms exact native direct delegation without widening ' + scope, async () => {
  const f = fixture({ scope });
  assert.deepEqual(await f.directory.verify(chatgpt), { verified: true, ownerDid, podUrl, agent: expectedAgents[0] });
  assert.deepEqual(f.calls.map(call => call.name), ['connect', 'get_pod_status', 'verify_agent', 'get_pod_status']);
  assert.deepEqual(f.calls[2].args, { agent_id: chatgpt, pod_url: podUrl });
});

test('null-eliding native verdict projection retains all positive proof requirements', async () => {
  const f = fixture({ verdictChange(value) { delete value.reason; delete value.enforcement.chainReason; } });
  assert.equal((await f.directory.verify(chatgpt)).verified, true);
});

const ownerRefusals = [
  ['owner DID', value => { value.identity.did = 'did:web:identity.example:users:another'; }],
  ['session signer', value => { value.sessionAgent.did = chatgpt; }],
  ['pod', value => { value.pod = 'https://gate.example/another/'; }],
  ['owner slug', value => { value.userId = 'another'; }],
  ['identity WebID', value => { value.identity.webId = 'https://identity.example/users/another/profile#me'; }],
  ['top-level WebID', value => { value.webId = 'https://identity.example/users/another/profile#me'; }],
  ['registry owner', value => { value.registry.owner = 'https://identity.example/users/another/profile#me'; }],
];
for (const [label, statusChange] of ownerRefusals) test('foreign ' + label + ' refuses before candidate verification', async () => {
  const f = fixture({ statusChange }); await assert.rejects(f.directory.verify(chatgpt), { code: 'agent_directory_owner_mismatch' });
  assert.equal(f.calls.some(call => call.name === 'verify_agent'), false);
});

const rosterRefusals = [
  ['registry owner', value => { value.delegationRegistry.owner = 'https://identity.example/users/another/profile#me'; }],
  ['registry location', value => { value.delegationRegistry.url = 'https://foreign.example/' + slug + '/agents'; }],
  ['missing roster', value => { delete value.delegationRegistry; }],
  ['count mismatch', value => { value.delegationRegistry.count++; }],
  ['unknown scope', value => { value.delegationRegistry.rows[0].scope = 'Admin'; }],
  ['malformed revocation', value => { value.delegationRegistry.rows[0].revoked = 'false'; }],
  ['malformed date', value => { value.delegationRegistry.rows[0].validFrom = 'yesterday'; }],
  ['oversized label', value => { value.agents[0].label = 'x'.repeat(129); }],
  ['control in label', value => { value.agents[0].label = 'ChatGPT\nother'; }],
  ['credential in label', value => { value.agents[0].label = 'Bearer PRIVATE_TOKEN'; }],
  ['unbounded surface', value => { value.agents[0].surface = 'x'.repeat(65); }],
  ['unknown identity source', value => { value.agentsSource = 'inferred'; }],
];
for (const [label, statusChange] of rosterRefusals) test('malformed ' + label + ' refuses without returning a partial roster', async () => {
  const f = fixture({ statusChange }); await assert.rejects(f.directory.list(), { code: 'agent_directory_contract' });
});

test('ambiguous duplicate registry rows and conflicting identity labels are refused', async () => {
  for (const statusChange of [value => { value.delegationRegistry.rows.push(copy(value.delegationRegistry.rows[0])); value.delegationRegistry.count++; },
    value => { value.agents.push({ ...value.agents[0], label: 'Another identity' }); }]) {
    const f = fixture({ statusChange }); await assert.rejects(f.directory.list(), { code: 'agent_directory_ambiguous' });
  }
});

test('directory input is bounded before iterating provider or registry lists', async () => {
  for (const statusChange of [value => { value.agents = Array(129).fill(value.agents[0]); },
    value => { value.delegationRegistry.rows = Array(129).fill(value.delegationRegistry.rows[0]); value.delegationRegistry.count = 129; }]) {
    const f = fixture({ statusChange }); await assert.rejects(f.directory.list(), { code: 'agent_directory_capacity' });
  }
});

test('manual unknown or external identities cannot use own-roster verification or change its target', async () => {
  for (const did of ['did:web:identity.example:agents:unregistered', 'did:web:foreign.example:agents:agent', ownerDid, chatgpt + '\n']) {
    const f = fixture(); await assert.rejects(f.directory.verify(did), { code: 'agent_directory_not_registered' });
    assert.equal(f.calls.some(call => call.name === 'verify_agent'), false);
  }
});

const verdictRefusals = [
  ['foreign subject', value => { value.subjectPodUrl = value.subject_pod_url = 'https://foreign.example/' + slug + '/'; }],
  ['contradictory subject', value => { value.subject_pod_url = internalPod; }],
  ['wrong selector', value => { value.subject_pod_selected_by = 'default'; }],
  ['foreign slug', value => { value.subject_pod_name = 'another'; }],
  ['foreign owner', value => { value.owner = 'https://identity.example/users/another/profile#me'; }],
  ['foreign agent', value => { value.agent = claude; }],
  ['invalid', value => { value.valid = false; }],
  ['unverified', value => { value.verified = false; }],
  ['self asserted', value => { value.trustLevel = 'SelfAsserted'; }],
  ['revocation or expiry finding', value => { value.reason = 'Delegation expired PRIVATE_RAW_REASON'; }],
  ['indirect chain', value => { value.chainLength = value.delegationChain.length = 2; }],
  ['unanchored chain', value => { value.delegationChain.anchored = false; }],
  ['foreign chain owner', value => { value.delegationChain.owner = 'https://identity.example/users/another/profile#me'; }],
  ['foreign chain actor', value => { value.delegationChain.agent = claude; }],
  ['wrong scope', value => { value.scope = value.delegationChain.scope = 'ReadOnly'; }],
  ['registry-only fallback', value => { value.enforcement.basis = 'registry-only'; }],
  ['not enforced', value => { value.enforcement.enforced = false; }],
  ['enforcement scope mismatch', value => { value.enforcement.scope = 'ReadOnly'; }],
  ['unconfirmed chain', value => { value.enforcement.chainReason = 'PRIVATE_RAW_REASON'; }],
  ['foreign signing agent', value => { value.signing.credentialAgentId = claude; }],
  ['cannot sign', value => { value.signing.canSignDelegatedRequests = false; }],
  ['stale signing anchor', value => { value.signing.credentialAnchor = '0x' + 'f'.repeat(40); }],
  ['missing current anchor', value => { delete value.signing.relayAnchor; }],
];
for (const [label, verdictChange] of verdictRefusals) test('verify refuses ' + label + ' without repair, signing or permission changes', async () => {
  const f = fixture({ verdictChange }); const error = await f.directory.verify(chatgpt).then(() => null, error => error);
  assert.equal(error.code, 'agent_directory_unverified'); assert.equal(error.message.includes('PRIVATE'), false);
  assert.ok(f.calls.every(call => ['connect', 'get_pod_status', 'verify_agent'].includes(call.name)));
});

test('a delegation disappearing or changing during verification cannot produce a successful result', async () => {
  for (const change of [value => { value.delegationRegistry.rows.shift(); value.delegationRegistry.count--; },
    value => { value.delegationRegistry.rows[0].scope = 'ReadOnly'; },
    value => { value.delegationRegistry.rows[0].validFrom = '2026-10-18T01:30:00.000Z'; }]) {
    const f = fixture({ statusChange(value, read) { if (read === 2) change(value); } });
    await assert.rejects(f.directory.verify(chatgpt), { code: 'agent_directory_unverified' });
  }
});

test('credential expiry before or during a read clears native custody and returns no stale roster', async () => {
  const before = fixture(); before.setTime(credential.expiresAt);
  await assert.rejects(before.directory.list(), { code: 'needs_reauth' }); assert.equal(before.constructed(), 0);
  let during;
  during = fixture({ call({ name }) { if (name === 'get_pod_status') during.setTime(credential.expiresAt); } });
  await assert.rejects(during.directory.list(), { code: 'needs_reauth' });
  assert.equal(during.clears.at(-1).accessToken, ''); assert.equal(during.clears.at(-1).expiresAt, 0);
});

test('close fences late reads, aborts their signal and clears the transport credential without changing caller custody', async () => {
  let release, entered; const waiting = new Promise(resolve => { entered = resolve; });
  const f = fixture({ call: async ({ name, status }) => { if (name === 'get_pod_status') { entered(); await new Promise(resolve => { release = resolve; }); return status(); } } });
  const reading = f.directory.list(); await waiting;
  const signal = f.calls.at(-1).options.signal; f.directory.close(); f.directory.close(); assert.equal(signal.aborted, true);
  release(); await assert.rejects(reading, { code: 'agent_directory_closed' });
  await assert.rejects(f.directory.list(), { code: 'agent_directory_closed' });
  await assert.rejects(f.directory.verify(chatgpt), { code: 'agent_directory_closed' });
  assert.equal(f.clears.length, 1); assert.equal(f.clears[0].accessToken, ''); assert.equal(credential.accessToken, 'private-native-access-token-123456');
});

test('missing read capabilities and raw transport failures remain bounded and never cause setup writes', async () => {
  const missing = fixture({ capabilities: ['get_pod_status'] });
  await assert.rejects(missing.directory.list(), { code: 'agent_directory_capability_missing' });
  const failed = fixture({ call() { throw Error('PRIVATE_NATIVE_TOKEN unbounded service failure'); } });
  const error = await failed.directory.list().then(() => null, error => error);
  assert.equal(error.code, 'agent_directory_unavailable'); assert.equal(error.message.includes('PRIVATE'), false);
});

test('invalid owner, relay and credential configuration refuses without transport construction', () => {
  for (const config of [{ binding: { ...binding, subjectDid: 'did:example:owner' } }, { binding: { ...binding, webId: 'https://foreign.example/me#me' } },
    { binding: { ...binding, podUrl: 'https://gate.example/another/' } }, { binding: { ...binding, authenticatedAgentDid: chatgpt + '\n' } },
    { relayUrl: 'https://relay.example/' }, { relayUrl: 'http://relay.example' }, { credential: { ...credential, expiresAt: clock } },
    { credential: { ...credential, refreshToken: 'PRIVATE_REFRESH' } }, { credential: { ...credential, accessToken: 'bad token' } }]) {
    let creates = 0;
    assert.throws(() => createOwnerAgentDirectory({ binding, credential, relayUrl, now: () => clock, createTransport() { creates++; }, ...config }));
    assert.equal(creates, 0);
  }
});
