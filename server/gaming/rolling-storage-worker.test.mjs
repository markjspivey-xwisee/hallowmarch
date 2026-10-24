import test from 'node:test';
import assert from 'node:assert/strict';
import { setTimeout as delay, setImmediate as turn } from 'node:timers/promises';
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
 const gaps=[];let phase='encode',previous=performance.now();
 const stages=[];
 const run=async(operation,payload)=>{phase=operation;const start=performance.now();
  const pending=pool.run(operation,payload),dispatchMs=performance.now()-start;
  const value=await pending;stages.push({operation,dispatchMs:Math.round(dispatchMs),totalMs:Math.round(performance.now()-start)});
  // Include final response deserialization in the next heartbeat callback.
  await delay(20);return value;};
 const heartbeat=setInterval(()=>{const now=performance.now();gaps.push({phase,ms:now-previous});previous=now},10);
 try {
  const first=await run('encode',{doc,context:c});
  const final=await run('finish',{wire:first.wire,writeBudget:[{minute:Math.floor(c.now/60000),bytes:4096}],context:c,measured:first.measured});
  const restored=await run('decode',{bytes:final.compressed,contentType:'application/vnd.interego.rolling-checkpoint-delta-v1+br',context:c});
  clearInterval(heartbeat);
  assert.deepEqual(restored,{...doc,writeBudget:[{minute:Math.floor(c.now/60000),bytes:4096}]});
  assert(gaps.length>20,'heartbeats ran during full-window storage work');
  const maximum=Math.max(...gaps.map(g=>g.ms));t.diagnostic(JSON.stringify({maxHeartbeatGapMs:Math.round(maximum),heartbeats:gaps.length,stages,largestGaps:gaps.sort((a,b)=>b.ms-a.ms).slice(0,4)}));
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
 assert.equal(f.writes(),0);await turn();assert.equal(f.store.pendingCommits,0);await broken.fail();
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
  release();await first;await turn();assert.equal(f.writes(),1);assert.equal(f.store.pendingCommits,0);
 } finally {release?.();pool.fail()}
});

test('failed worker must finish termination before its job rejects or a replacement starts',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),c=context();
 let release,entered;const stopping=new Promise(r=>entered=r),wait=new Promise(r=>release=r);
 const first=pool.run('encode',{doc:empty(c),context:c}),old=pool.worker,terminate=old.terminate.bind(old);
 old.terminate=async()=>{entered();await wait;return terminate()};
 let rejected=false;
 const firstDone=assert.rejects(first,{code:'DURABILITY_UNAVAILABLE'}).then(()=>{rejected=true});
 pool.fail(old);await stopping;
 let completed=false;
 const next=pool.run('validate',{doc:empty(c),context:c}).then(v=>{completed=true;return v});
 await delay(30);
 assert.equal(rejected,false);assert.equal(completed,false);assert.equal(pool.worker,null);
 release();await firstDone;assert.deepEqual(await next,empty(c));await pool.fail();
});
test('an abort while CPU preparation is active retains the native permit until that preparation finishes',async()=>{
 const pool=new RollingStorageWorker({idleMs:10});
 let release,entered;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let paused=false;
 const controlled={run:async(operation,payload)=>{
  if(operation==='encode'&&!paused){paused=true;entered();await wait}return pool.run(operation,payload);
 }};
 const f=fixture(controlled),controller=new AbortController();
 try{
  const first=f.store.commit('score',{expectedVersion:0,state:{n:1},idempotencyKey:'active',signal:controller.signal});
  await started;controller.abort();
  const secondController=new AbortController();
  const second=f.store.commit('score',{expectedVersion:1,state:{n:2},idempotencyKey:'queued',signal:secondController.signal});
  secondController.abort();await assert.rejects(second,{code:'OPERATION_ABORTED'});
  assert.equal(f.store.pendingCommits,1);assert.equal(f.writes(),0);
  release();await first;await turn();assert.equal(f.writes(),1);assert.equal(f.store.pendingCommits,0);
 }finally{release?.();await pool.fail()}
});

test('queued worker payloads retain their original scope and bytes',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),a=context(),b=context('urn:worker:queued','queued-context'),doc=empty(b);
 try {
  const active=pool.run('encode',{doc:empty(a),context:a});
  const queued=pool.run('encode',{doc,context:b});
  doc.owner='urn:mutated';b.owner='urn:mutated';doc.streams.push({invalid:true});
  await active;const result=await queued;
  assert.equal(result.wire.current.owner,'urn:worker:queued');assert.deepEqual(result.wire.current.streams,[]);
 }finally{await pool.fail()}
});
test('unproven termination fences the CPU lane instead of starting a replacement',async()=>{
 const pool=new RollingStorageWorker({idleMs:10}),c=context();
 const first=pool.run('encode',{doc:empty(c),context:c}),old=pool.worker,terminate=old.terminate.bind(old);
 old.terminate=async()=>{await terminate();throw Error('unproven termination')};
 const failure=assert.rejects(first,{code:'DURABILITY_UNAVAILABLE'});
 pool.fail(old);await failure;await turn();
 assert.equal(pool.fenced,true);
 await assert.rejects(pool.run('validate',{doc:empty(c),context:c}),{code:'DURABILITY_UNAVAILABLE'});
 assert.equal(pool.worker,null);
});
