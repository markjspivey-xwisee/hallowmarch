import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';
import { RollingStorageWorker } from './rolling-storage-worker-client.js';
import { RollingMultiplayerStore } from './rolling-multiplayer-store.js';
import { realisticRollingWindow } from './rolling-history-scale-fixture.mjs';
const context=(owner='urn:worker:one',namespace='worker-test')=>({owner,namespace,resourceUrl:'https://native.example/game/gaming/head.json',
 now:10000000,maxStateBytes:512*1024,maxEventBytes:64*1024});
const empty=c=>({schema:'urn:hallowmarch:multiplayer-rolling-hour:v1',owner:c.owner,namespace:c.namespace,resourceUrl:c.resourceUrl,
 retentionMs:3600000,writtenAt:c.now,streams:[],checkpoints:[],receipts:[],writeBudget:[]});
function fixture(storageWorker) {
 let stored={revision:null,artifact:null},writes=0;const control={};
 const codec={createNativeByteArtifact:input=>structuredClone(input),readNativeByteArtifact:input=>structuredClone(input)};
 const nativeClient={ready:async()=>{},readHead:async()=>{throw Error('no legacy')},readArtifact:async()=>{},commit:async()=>{},
  atomicCheckpointSize:a=>a.bytes.length*2+32768,readAtomicCheckpoint:async()=>structuredClone(stored),
  commitAtomicCheckpoint:async(expected,artifact)=>{
   if(control.beforeWrite)await control.beforeWrite();
   assert.equal(expected,stored.revision);writes++;stored={revision:'sha256:'+String(writes).padStart(64,'0'),artifact:structuredClone(artifact)};
   return structuredClone(stored);
  }};
 const c=context(),store=new RollingMultiplayerStore({nativeClient,artifactCodec:codec,owner:c.owner,namespace:c.namespace,
  resourceUrl:c.resourceUrl,clock:()=>c.now,storageWorker});
 return {store,control,nativeClient,writes:()=>writes};
}
test('full authored storage work yields the main event loop and preserves every value',async t=>{
 const pool=new RollingStorageWorker({idleMs:10}),c=context();
 const doc=realisticRollingWindow({...c,now:c.now});
 const gaps=[];let previous=performance.now();
 const heartbeat=setInterval(()=>{const now=performance.now();gaps.push(now-previous);previous=now},10);
 try {
  const first=await pool.run('encode',{doc,context:c});
  const final=await pool.run('finish',{wire:first.wire,writeBudget:[{minute:Math.floor(c.now/60000),bytes:4096}],context:c,measured:first.measured});
  const restored=await pool.run('decode',{bytes:final.compressed,contentType:'application/vnd.interego.rolling-checkpoint-delta-v1+br',context:c});
  assert.deepEqual(restored,{...doc,writeBudget:[{minute:Math.floor(c.now/60000),bytes:4096}]});
  assert(gaps.length>20,'heartbeats ran during full-window storage work');
  const maximum=Math.max(...gaps);t.diagnostic(JSON.stringify({maxHeartbeatGapMs:Math.round(maximum),heartbeats:gaps.length}));
  assert(maximum<1000,'storage work cannot block the event loop for a second');
 } finally {clearInterval(heartbeat);pool.fail()}
});
test('interleaved owners and reads cannot exchange operation-local preparation',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),a=context(),b=context('urn:worker:two','another-worker-test');
 try {
  const first=await pool.run('encode',{doc:empty(a),context:a});
  const [,second]=await Promise.all([pool.run('validate',{doc:empty(b),context:b}),pool.run('encode',{doc:empty(b),context:b})]);
  const finished=await pool.run('finish',{wire:first.wire,writeBudget:[{minute:166,bytes:4096}],context:a,measured:first.measured});
  const restored=await pool.run('decode',{bytes:finished.compressed,contentType:'application/vnd.interego.rolling-checkpoint-delta-v1+br',context:a});
  assert.equal(restored.owner,a.owner);assert.equal(second.wire.current.owner,b.owner);
  await assert.rejects(pool.run('decode',{bytes:finished.compressed,contentType:'application/vnd.interego.rolling-checkpoint-delta-v1+br',context:b}),{code:'CORRUPT_DURABLE_STATE'});
 } finally {pool.fail()}
});
test('worker failure before preparation cannot dispatch a native write and permits settle',async()=>{
 const broken=new RollingStorageWorker({workerUrl:new URL('./missing-storage-worker-fixture.js',import.meta.url)});
 const f=fixture(broken);
 await assert.rejects(f.store.commit('score',{expectedVersion:0,state:{n:1},idempotencyKey:'first'}),{code:'DURABILITY_UNAVAILABLE'});
 assert.equal(f.writes(),0);assert.equal(f.store.pendingCommits,0);broken.fail();
});
test('worker failure and late old events do not reject a replacement generation',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),c=context();
 try {
  const job=pool.run('encode',{doc:empty(c),context:c}),old=pool.worker;
  pool.fail(old);await assert.rejects(job,{code:'DURABILITY_UNAVAILABLE'});
  const next=pool.run('validate',{doc:empty(c),context:c});
  pool.fail(old);pool.receive(old,{id:1,operation:'encode',ok:true,value:{}});
  assert.deepEqual(await next,empty(c));
 } finally {pool.fail()}
});
test('cancelled queued commit cannot overlap an active dispatched native write',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),f=fixture(pool);
 let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 f.control.beforeWrite=async()=>{entered();await wait};
 try {
  const first=f.store.commit('score',{expectedVersion:0,state:{n:1},idempotencyKey:'first'});
  await started;
  const controller=new AbortController();
  const next=f.store.commit('score',{expectedVersion:1,state:{n:2},idempotencyKey:'second',signal:controller.signal});
  controller.abort();await assert.rejects(next,{code:'OPERATION_ABORTED'});
  assert.equal(f.store.pendingCommits,1);assert.equal(f.writes(),0);
  release();await first;assert.equal(f.writes(),1);assert.equal(f.store.pendingCommits,0);
 } finally {release?.();pool.fail()}
});
