import test from 'node:test';
import assert from 'node:assert/strict';
import { createAgentOwnSession, AGENT_OWN_SESSION_SURFACE } from './agent-own-session.mjs';
import { FOXXI_PLANNER_ACTION, FOXXI_PLANNER_DESCRIPTOR } from './foxxi-consulting.mjs';

const address = '0x1234567890abcdef1234567890abcdef12345678', id = 'u-eth-1234567890ab';
const ownerDid = 'did:web:identity.example:users:' + id;
const agentDid = 'did:web:identity.example:agents:interego-delegate-' + id;
const player = { subjectDid: 'did:web:identity.example:users:u-pk-player', podUrl: 'https://pod.example/u-pk-player/' };
const clock = Date.parse('2026-10-17T12:00:00Z');
const target = 'https://foxxi-bridge.interego.xwisee.com/agent/contextualize-and-plan';
function fixture(overrides = {}) {
  const calls = []; let identity = ownerDid, selectedAgent = agentDid, selectedPod = 'http://css.railway.internal:3456/' + id + '/', phase = 'normal';
  const signMessage = async message => { calls.push({ name: 'host-sign', message }); return 'native-host-signature'; };
  const transport = {
    async connect(required) { calls.push({ name: 'connect', required }); return { granted: required }; },
    async callTool(name, args) {
      calls.push({ name, args: structuredClone(args) });
      if (name === 'get_pod_status') return { userId: id, identity: { did: identity }, sessionAgent: { did: selectedAgent }, pod: selectedPod };
      if (name === 'get_current_head') return { urn: args.urn, podUrl: 'https://pod.example/' + id + '/', head: null };
      if (name === 'dereference') return { status: 'ok', affordances: [{ action: FOXXI_PLANNER_ACTION, method: 'POST', target }] };
      if (name === 'sign_request') return { _signature: 'native-envelope-signature', _signed_payload: JSON.stringify({ ...args.payload,
        agent_id: phase === 'foreign-signature' ? 'did:web:identity.example:agents:other' : agentDid,
        subject_pod_url: (phase === 'foreign-stamp' ? 'https://other.example/' : 'https://pod.example/') + id + '/', timestamp: new Date(clock).toISOString() }) };
      if (name === 'act') { const p = JSON.parse(args.payload._signed_payload); return { status: 200, body: JSON.stringify({
        classifiedBy: agentDid, diagnosis: { situationId: p.situation.id, method: 'classify-first', regimeSource: 'unclassified' },
        plan: { situationId: p.situation.id, selected: [], summary: 'The actual fixture service response.' } }) }; }
      throw Error('Unexpected native tool: ' + name);
    },
    setCredential(value) { calls.push({ name: 'clear-credential', value }); },
  };
  const nativeSignInWithWallet = async (...args) => { calls.push({ name: 'native-sign-in', args }); return {
    kind: 'relay-oauth-bearer', method: 'siwe', accessToken: 'private-native-token', refreshToken: 'private-native-refresh', clientId: 'native-client', expiresAt: clock + 3600000 }; };
  const host = createAgentOwnSession({ walletAddress: address, signMessage, nativeSignInWithWallet, humanBinding: player,
    relayUrl: 'https://relay.example', identityOrigin: 'https://identity.example', redirectUri: 'http://127.0.0.1:43210/callback', now: () => clock,
    createTransport: (relay, credential) => { calls.push({ name: 'transport', relay, credential }); return transport; }, ...overrides });
  return { host, calls, transport, signMessage, setOwner(value) { identity = value; }, setAgent(value) { selectedAgent = value; }, setPod(value) { selectedPod = value; }, setPhase(value) { phase = value; } };
}

test('construction has no I/O and native host sign-in proves a separate key-derived agent owner and pod', async () => {
  const f = fixture(); assert.equal(f.calls.length, 0); assert.equal(f.host.status().connected, false);
  const result = await f.host.connect(); assert.equal(result.ownerDid, ownerDid); assert.equal(result.agentDid, agentDid); assert.equal(result.keyCustody, 'agent-host');
  const native = f.calls.find(c => c.name === 'native-sign-in');
  assert.deepEqual(native.args.slice(0, 3), ['https://relay.example', 'https://identity.example', address]);
  assert.equal(native.args[3], f.signMessage); assert.equal(native.args[5], AGENT_OWN_SESSION_SURFACE);
  assert.equal(f.calls.find(c => c.name === 'transport').credential.refreshToken, null);
  assert.deepEqual(f.host.binding(), { subjectDid: ownerDid, authenticatedAgentDid: agentDid, podUrl: 'https://pod.example/' + id + '/' });
  assert(!JSON.stringify(result).includes('private-native')); assert.equal(f.calls.some(c => c.name === 'register_agent'), false);
});
test('the player wallet cannot be relabeled as an independent agent', () => {
  assert.throws(() => fixture({ humanBinding: { subjectDid: ownerDid, podUrl: 'https://pod.example/' + id + '/' } }), { code: 'separate_agent_identity_required' });
  assert.throws(() => fixture({ humanBinding: { ...player, podUrl: 'https://pod.example/' + id + '/' } }), { code: 'separate_agent_identity_required' });
  assert.throws(() => fixture({ humanBinding: { subjectDid: 'did:ethr:' + address, podUrl: 'https://pod.example/eth-1234567890ab/' } }), { code: 'separate_agent_identity_required' });
});
for (const field of ['owner', 'agent', 'pod']) test('native ' + field + ' substitution fails before any consultation or signature', async () => {
  const f = fixture();
  if (field === 'owner') f.setOwner(player.subjectDid);
  if (field === 'agent') f.setAgent('did:web:identity.example:agents:chatgpt-u-pk-player');
  if (field === 'pod') f.setPod('https://pod.example/u-pk-player/');
  await assert.rejects(f.host.connect(), { code: 'agent_owner_mismatch' });
  assert.equal(f.calls.some(c => ['sign_request', 'act'].includes(c.name)), false);
});
test('agent-owned private journal opens read-only with host key storage; no wallet or encryption key is minted', async () => {
  const f = fixture(); await f.host.connect(); const loads = [];
  const journal = f.host.createJournal({ sessionId: 'agent-work-1', keyStorage: {
    async load(scope) { loads.push(scope); return null; }, async create() { throw Error('Unexpected key mint'); } } });
  await journal.connect(); assert(loads.length > 0); assert(loads.every(scope => scope.includes(ownerDid) && !scope.includes(player.subjectDid)));
  assert.equal(journal.status().ownerDid, ownerDid);
  assert.equal(f.calls.some(c => ['register_agent', 'publish_context', 'act'].includes(c.name)), false);
  f.host.close(); await assert.rejects(journal.read());
});
test('a brought agent consults as its own performer through the existing journal consent and live Foxxi adapter', async () => {
  const f = fixture(); await f.host.connect(); let permitted = true;
  const journal = { async authorize(args) { if (!permitted) throw Error('consent withdrawn'); return { ...args, ownerDid, sessionId: 'agent-work-1', expiresAt: new Date(clock + 60000).toISOString() }; },
    async assertAuthorized() { if (!permitted) throw Error('consent withdrawn'); return true; } };
  const consultant = f.host.createConsultant({ journal, sessionId: 'agent-work-1' }); await consultant.connect();
  const preview = consultant.preparePlan({ task: { id: 'agent-task-1', desiredResult: 'Keep the controlled body alive.', observedResult: 'I selected an attack before checking health.', workContext: 'Choose the next safe bounded command.', constraints: ['Only the owner-granted body actions'] } });
  assert.deepEqual(preview.payload.situation.performer, { id: ownerDid, kind: 'agent' });
  const result = await consultant.requestPlan(preview); assert.equal(result.source.performerDid, ownerDid); assert.equal(result.source.classifiedBy, agentDid);
  assert.equal(result.foxxiPersonalRecordCreated, false);
  const act = f.calls.find(c => c.name === 'act'); assert.equal(act.args.descriptor_url, FOXXI_PLANNER_DESCRIPTOR);
  assert(!JSON.stringify(act).includes(player.subjectDid)); assert(!JSON.stringify(act).includes('private-native-token'));
  permitted = false; await assert.rejects(consultant.requestPlan(preview));
  f.host.close(); await assert.rejects(consultant.requestPlan(preview));
});
test('identity is rechecked immediately before gameplay proof signing, and a substituted envelope is refused', async () => {
  const f = fixture(); await f.host.connect();
  const signed = await f.host.signRequest({ payload: { purpose: 'game-admission', challenge: 'actual-host-challenge' } });
  assert.equal(JSON.parse(signed._signed_payload).agent_id, agentDid);
  f.setPhase('foreign-signature'); await assert.rejects(f.host.signRequest({ payload: { challenge: 'actual-challenge' } }), { code: 'agent_signature_mismatch' });
  f.setPhase('foreign-stamp'); await assert.rejects(f.host.signRequest({ payload: { challenge: 'actual-challenge' } }), { code: 'agent_signature_mismatch' });
  f.setOwner(player.subjectDid); const before = f.calls.filter(c => c.name === 'sign_request').length;
  await assert.rejects(f.host.signRequest({ payload: { challenge: 'actual-challenge' } }), { code: 'agent_owner_mismatch' });
  assert.equal(f.calls.filter(c => c.name === 'sign_request').length, before);
});
test('closing an in-flight native sign-in discards its late credential and reconnect never revives old child ports', async () => {
  let release; const waiting = new Promise(resolve => { release = resolve; });
  const f = fixture({ nativeSignInWithWallet: () => waiting });
  const started = f.host.connect(); f.host.close(); release({ kind: 'relay-oauth-bearer', method: 'siwe', accessToken: 'late-private-token', expiresAt: clock + 60000 });
  await assert.rejects(started, { code: 'agent_session_closed' }); assert.equal(f.calls.some(c => c.name === 'transport'), false);
  const g = fixture(); await g.host.connect(); const journal = { authorize() {}, assertAuthorized() {} };
  const old = g.host.createConsultant({ journal, sessionId: 'old-agent-work' });
  await g.host.reconnect(); await assert.rejects(old.connect()); assert.equal(g.calls.filter(c => c.name === 'native-sign-in').length, 2);
});

test('failed native authentication exposes no host secrets and accepts no expired or substituted grant kind', async () => {
  const f = fixture({ nativeSignInWithWallet: async () => { throw Error('host-private-key-must-not-escape'); } });
  await assert.rejects(f.host.connect(), error => error.code === 'agent_authentication_failed' && !error.message.includes('private-key'));
  for (const result of [
    { kind: 'identity-server-token', accessToken: 'private-native-token', method: 'siwe', expiresAt: clock + 60000 },
    { kind: 'relay-oauth-bearer', accessToken: 'private-native-token', method: 'siwe', expiresAt: clock - 1 },
  ]) {
    const g = fixture({ nativeSignInWithWallet: async () => result });
    await assert.rejects(g.host.connect(), { code: 'agent_authentication_required' });
    assert.equal(g.calls.some(c => c.name === 'transport'), false);
  }
});

test('native request signing rejects nonfinite data, caller identity stamps and oversize bodies before transport', async () => {
  const f = fixture(); await f.host.connect(); const before = f.calls.length;
  for (const payload of [{ measured: NaN }, { measured: Infinity }, { agent_id: agentDid }, { nested: { when: undefined } }, { text: 'x'.repeat(17000) }]) {
    await assert.rejects(f.host.signRequest({ payload }), { code: 'invalid_agent_request' });
  }
  assert.equal(f.calls.length, before);
});
