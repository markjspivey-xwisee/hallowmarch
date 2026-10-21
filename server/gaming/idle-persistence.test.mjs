import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { createProgressiveOwnedState } from './progressive-owned-state.js';
import { AuthoritativeRoom } from './authority.js';
import { createHallowmarchDomain } from './hallowmarch.js';
import { createGamingRuntime } from './runtime.js';
import { createMainWorldAgents } from './main-world-agents.js';
import { makeSeason } from '../season.js';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

function fixture() {
  let saved = { version: 0, state: null }, calls = 0, failing = false;
  return { get calls() { return calls; }, set failing(value) { failing = value; },
    store: { owner: 'urn:test:human-idle', async load() { return structuredClone(saved); },
      async commit(id, input) { calls++; if (failing) throw new Error('offline');
        assert.equal(input.expectedVersion, saved.version);
        saved = { version: saved.version + 1, state: structuredClone(input.state) }; return structuredClone(saved); } } };
}

test('cold suspended owned state reads but never seeds or retries until live play', async () => {
  const f = fixture(), bridge = createProgressiveOwnedState({ store: f.store, streamId: 'test-world',
    owner: f.store.owner, active: false, checkpointIntervalMs: 10, retryIntervalMs: 10 });
  await bridge.start({ seed: () => ({ value: 1 }) }); await wait(35); assert.equal(f.calls, 0);
  bridge.setActive(true); await bridge.checkpoint(); assert.equal(f.calls, 1);
  bridge.capture({ value: 2 }); f.failing = true;
  await assert.rejects(bridge.suspend({ checkpoint: true, timeoutMs: 1000 }));
  const stopped = f.calls; await wait(45); assert.equal(f.calls, stopped, 'no failure retry while idle');
  f.failing = false; bridge.setActive(true); await bridge.checkpoint();
  assert.equal(f.calls, stopped + 1); await bridge.shutdown({ checkpoint: false });
});

test('idle shutdown does not flush an unconfirmed owned-state seed', async () => {
  const f = fixture(), bridge = createProgressiveOwnedState({ store: f.store, streamId: 'test-idle',
    owner: f.store.owner, active: false });
  await bridge.start({ seed: () => ({ value: 1 }) });
  await bridge.shutdown({ checkpoint: false }); assert.equal(f.calls, 0);
});

test('a suspended expedition refuses human and agent writes and seeds only after live activation', async () => {
  const f = fixture(), room = await new AuthoritativeRoom({ roomId: 'idle-room', store: f.store,
    domain: createHallowmarchDomain(), active: false }).open();
  assert.equal(f.calls, 0);
  const human = { playerId: 'human-1', realmId: '0', name: 'Human' };
  await assert.rejects(room.execute(human, { type: 'join', commandId: 'idle-join' }), { code: 'human_play_required' });
  await assert.rejects(room.execute({ kind: 'agent', token: 'some-token' },
    { type: 'move', commandId: 'idle-agent' }), { code: 'human_play_required' });
  assert.equal(f.calls, 0);
  room.setActive(true); await room.execute(human, { type: 'join', commandId: 'live-join' });
  assert.ok(f.calls >= 1);
  const saved = f.calls; room.setActive(false);
  await room.close({ checkpoint: false }); assert.equal(f.calls, saved);
});

test('realtime checkpoint failure stops retrying after the final bounded idle attempt', async () => {
  const f = fixture(), room = await new AuthoritativeRoom({ roomId: 'idle-realtime', store: f.store,
    domain: createHallowmarchDomain(), persistenceMode: 'realtime', checkpointIntervalMs: 10 }).open();
  await room.execute({ playerId: 'human-1', realmId: '0', name: 'Human' }, { type: 'join', commandId: 'join' });
  f.failing = true;
  await assert.rejects(room.suspend({ checkpoint: true, timeoutMs: 1000 }));
  const count = f.calls; await wait(45); assert.equal(f.calls, count);
  await room.close({ checkpoint: false });
});

test('runtime composes a suspended room without a startup write', async () => {
  const f = fixture(), replies = [];
  const game = createGamingRuntime({ store: f.store, active: false, send: (_, msg) => replies.push(msg) });
  await game.ready; assert.equal(f.calls, 0);
  await game.handle({ acct: { id: 'human-1' }, realm: 0 }, { op: 'enter', requestId: 'idle-enter' });
  assert.equal(replies.at(-1).error.code, 'human_play_required'); assert.equal(f.calls, 0);
  await game.shutdown({ checkpoint: false }); assert.equal(f.calls, 0);
});

test('live-only season startup never catches up elapsed offline days', () => {
  const here = fileURLToPath(new URL('../', import.meta.url)), src = path.resolve(here, '../src');
  const cfg = { here, src, seasonSpeed: 1, seasonStep: 5000, seasonSeed: 19,
    seasonLen: 28 * 86400, keeps: [], seasonLiveOnly: true };
  const empty = { read: (_, fallback) => fallback, write() { throw new Error('startup must not write'); } };
  const first = makeSeason(cfg, empty, { seasons: 0 });
  const kept = { ...structuredClone(first.RS), savedAt: Date.now() - 3 * 86400000 };
  const loaded = makeSeason(cfg, { ...empty, read: (name, fallback) => name === 'season.json' ? kept : fallback }, { seasons: 0 });
  assert.equal(loaded.RS.t, first.RS.t);
});

test('the bounded final checkpoint includes changes accepted behind an in-flight save', async () => {
  let saved = { version: 0, state: null }, calls = 0, release;
  const store = { owner: 'urn:test:leave', async load() { return structuredClone(saved); },
    async commit(id, input) { calls++; if (calls === 2) await new Promise(resolve => { release = resolve; });
      assert.equal(input.expectedVersion, saved.version);
      saved = { version: saved.version + 1, state: structuredClone(input.state) }; return structuredClone(saved); } };
  const bridge = createProgressiveOwnedState({ store, streamId: 'leave', active: false, checkpointIntervalMs: 10 });
  await bridge.start({ seed: () => ({ value: 0 }) }); bridge.setActive(true); await bridge.checkpoint();
  bridge.capture({ value: 1 }); const dispatched = bridge.checkpoint();
  bridge.capture({ value: 2 }); const final = bridge.suspend({ checkpoint: true, timeoutMs: 1000 });
  release(); await dispatched; await final;
  assert.equal(saved.state.value.value, 2); assert.equal(calls, 3);
  await wait(35); assert.equal(calls, 3); await bridge.shutdown({ checkpoint: false });
});

test('the separate main-world agent ledger neither seeds nor retries while suspended', async () => {
  const f = fixture(); let reads = 0;
  const ledger = await createMainWorldAgents({ store: f.store, active: false,
    accounts: { bindingForAccount: () => null }, applicationId: 'urn:test:world-agent', audience: 'https://game.example',
    nativeCore: { recoverMessageSigner() { throw new Error('No proof should run'); } },
    readOwnerGrantHead: async () => { reads++; throw new Error('No idle read'); },
    resolveAgentProof: async () => { reads++; throw new Error('No idle read'); },
    view() {}, dispatch() {}, stop() {} });
  await wait(35); assert.equal(f.calls, 0); assert.equal(reads, 0);
  await assert.rejects(ledger.register({accountId:'human'}, {})); assert.equal(f.calls, 0);
  await ledger.suspend({checkpoint:false}); await ledger.close({checkpoint:false});
  assert.equal(f.calls, 0); assert.equal(reads, 0);
});

test('explicit live shutdown preserves its final capture after the human gate turns inactive', async () => {
  const f = fixture(), bridge = createProgressiveOwnedState({ store: f.store, streamId: 'shutdown-live',
    active: false, checkpointIntervalMs: 10 });
  await bridge.start({ seed: () => ({ value: 0 }) }); bridge.setActive(true); await bridge.checkpoint();
  bridge.capture({ value: 3 }); bridge.setActive(false);
  await bridge.shutdown({ checkpoint: true, timeoutMs: 1000 });
  assert.equal((await f.store.load()).state.value.value, 3);
  const count=f.calls; await wait(35); assert.equal(f.calls, count);
});

test('explicit live expedition shutdown drains accepted commands after suspension', async () => {
  const f = fixture(), room = await new AuthoritativeRoom({ roomId:'live-shutdown', store:f.store,
    domain:createHallowmarchDomain(), persistenceMode:'realtime', checkpointIntervalMs:10 }).open();
  await room.execute({playerId:'human-1',realmId:'0',name:'Human'}, {type:'join',commandId:'join'});
  room.setActive(false); await room.close({checkpoint:true});
  assert.ok((await f.store.load()).state.entities['human-1']);
  assert.equal(room.persistenceStatus().pendingCommands, 0);
});

for (const mode of ['strict', 'realtime']) test(mode + ': explicit verified owner controls save while paused without waking gameplay', async () => {
  const f = fixture(), room = await new AuthoritativeRoom({roomId:'owner-controls-'+mode,store:f.store,
    domain:createHallowmarchDomain(),persistenceMode:mode,checkpointIntervalMs:10}).open();
  const owner = {playerId:'human-1',realmId:'0',name:'Human',verifiedDid:'did:web:identity.example:human'};
  await room.execute(owner,{type:'join',commandId:'join'}); await room.flushPersistence(); room.setActive(false);
  const grantId='urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
  await room.executeOwnerControl(owner,{type:'registerNativeCompanion',commandId:'register',grantId,
    graphIri:'urn:graph:interego:gaming:owner-agent-grant:1647775c-22c7-4a79-8a45-d55cfe101b41'});
  assert.equal(room.activityActive,false); assert.equal(room.checkpointTimer,null);
  await assert.rejects(room.executeOwnerControl(owner,{type:'move',commandId:'not-settings'}),{code:'native_owner_required'});
  await assert.rejects(room.execute(owner,{type:'move',commandId:'still-paused'}),{code:'human_play_required'});
  await assert.rejects(room.executeOwnerControl({...owner,verifiedDid:undefined},{type:'revokeNativeCompanion',commandId:'unverified',grantId}),{code:'native_owner_required'});
  await room.executeOwnerControl(owner,{type:'revokeNativeCompanion',commandId:'revoke',grantId});
  assert.equal((await f.store.load()).state.companions.nativeReferences[grantId].revoked,true);
  const count=f.calls; await wait(35); assert.equal(f.calls,count); assert.equal(room.activityActive,false);
  await room.close({checkpoint:false});
});
test('main-world explicit owner register/Stop remain bounded in standby; agents cannot use the exception', async () => {
  const saved = new Map(); let writes=0, proofReads=0, stops=0;
  const store = {owner:'urn:test:owner-control', async load(id){return structuredClone(saved.get(id)||{version:0,state:null});},
    async commit(id,input){writes++;const prior=saved.get(id)||{version:0,state:null};assert.equal(input.expectedVersion,prior.version);
      const next={version:prior.version+1,state:structuredClone(input.state)};saved.set(id,next);return structuredClone(next);}};
  const binding={subjectDid:'did:web:identity.example:human',podUrl:'https://pods.example/human/'};
  const owner={accountId:'human',binding}, grantId='urn:uuid:1647775c-22c7-4a79-8a45-d55cfe101b41';
  const ledger=await createMainWorldAgents({store,active:false,
    accounts:{bindingForAccount:id=>id==='human'?binding:null},applicationId:'urn:test:world-agent',audience:'https://game.example',
    nativeCore:{recoverMessageSigner(){throw new Error('No agent proof should run');}},
    readOwnerGrantHead:async()=>{proofReads++;throw new Error('No standby agent reads');},
    resolveAgentProof:async()=>{proofReads++;throw new Error('No standby agent reads');},
    view(){},dispatch(){throw new Error('No standby dispatch');},stop(){stops++;}});
  await ledger.register(owner,{grantId,graphIri:'urn:graph:interego:gaming:owner-agent-grant:1647775c-22c7-4a79-8a45-d55cfe101b41'});
  assert.equal(ledger.references(owner)[0].grantId,grantId);
  assert.throws(()=>ledger.challenge({grantId}),{code:'native_world_authority_unavailable'});
  await assert.rejects(ledger.register({accountId:'intruder',binding},{grantId,graphIri:'x'}),{code:'native_owner_required'});
  await ledger.revoke(owner,{grantId});
  assert.equal(ledger.references(owner)[0].revoked,true);assert.ok(stops>0);
  const count=writes;await wait(35);assert.equal(writes,count);assert.equal(proofReads,0);
  await ledger.close({checkpoint:false});assert.equal(writes,count);
});
