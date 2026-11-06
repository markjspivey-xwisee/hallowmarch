import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { fixture, drainMeasured } from './world_build.fixture.mjs';

for (const seed of [7, 19, 503]) test('seed ' + seed + ': resumable and synchronous worlds match pinned d722 arrays, objects, collisions and every seeded PRNG result', t => {
  const prior=fixture({prior:true}), resumed=fixture(), synchronous=fixture();
  const before=performance.now();assert.equal(prior.api.buildWorld(seed),prior.api.W);
  const priorWorldMs=performance.now()-before;
  const world=drainMeasured(resumed.api.buildWorldChunks(seed));
  assert.equal(world.value,resumed.api.W);assert(world.steps>250,'real row/work checkpoints, not one synchronous body');
  assert.equal(synchronous.api.buildWorld(seed),synchronous.api.W,'synchronous public API retains exact return identity');
  assert.deepEqual(resumed.snapshot(),prior.snapshot());assert.deepEqual(synchronous.snapshot(),prior.snapshot());
  for(const f of [prior,resumed,synchronous])f.addPlacedFixture();
  const mountainStart=performance.now();assert.equal(prior.api.mtnHeights(),undefined);const priorMountainMs=performance.now()-mountainStart;
  const mountain=drainMeasured(resumed.api.mtnHeightsChunks());assert.equal(mountain.value,undefined);assert(mountain.steps>1000);
  assert.equal(synchronous.api.mtnHeights(),undefined);
  assert.deepEqual(resumed.snapshot(),prior.snapshot());assert.deepEqual(synchronous.snapshot(),prior.snapshot());
  for(const f of [prior,resumed,synchronous])assert.deepEqual(f.errors,[]);
  assert(resumed.api.HTS.nChanged>10000,'the real mountain shaping ran');
  assert(resumed.api.COLL.circles.length>2000&&resumed.api.HOUSES.length>15,'real canonical physical records were constructed');
  t.diagnostic(JSON.stringify({seed,priorWorldMs,worldActiveMs:world.activeMs,worldMaxResumeMs:world.maxChunkMs,worldResumes:world.steps,
    priorMountainMs,mountainActiveMs:mountain.activeMs,mountainMaxResumeMs:mountain.maxChunkMs,mountainResumes:mountain.steps,
    changed:resumed.api.HTS.nChanged,rngStreams:resumed.rng.length,rngCalls:resumed.rng.reduce((count,stream)=>count+stream.values.length,0)}));
});

test('raw terrain and mountain field kernels bound deterministic sampled work per resume', () => {
  const f=fixture();let calls=0,maximum=0;
  const restore=f.api.probeRawHeight(()=>{calls++;});
  const iterator=f.api.buildWorldChunks(7);let result,total=0;
  do {calls=0;result=iterator.next();total+=calls;maximum=Math.max(maximum,calls);} while(!result.done);
  restore();assert.equal(total,513*513);assert(maximum<=1024&&maximum>0);
  let fieldCalls=0,fieldMaximum=0;const restoreField=f.api.probeField(()=>{fieldCalls++;});
  const field=f.api.htsFieldChunks(f.api.W.H);let fieldResult;
  do {fieldCalls=0;fieldResult=field.next();fieldMaximum=Math.max(fieldMaximum,fieldCalls);}while(!fieldResult.done);
  restoreField();assert(fieldMaximum<=1024&&fieldMaximum>0);
});

test('unrelated random/time work interleaved through real host tasks cannot perturb canonical generation', async () => {
  const prior=fixture({prior:true}),f=fixture();prior.api.buildWorld(19);
  async function run(iterator,building){let result;do{
    for(let count=0;count<128;count++){result=iterator.next();if(result.done)break;if(building)assert.equal(f.api.W.ready,false);}
    if(!result.done)await new Promise(resolve=>setImmediate(()=>{f.api.unrelatedHostWork();if(building)assert.equal(f.api.W.ready,false);resolve();}));
  }while(!result.done);return result.value;}
  assert.equal(await run(f.api.buildWorldChunks(19),true),f.api.W);assert.equal(f.api.W.ready,true);
  assert.deepEqual(f.snapshot(),prior.snapshot());
  for(const world of [prior,f])world.addPlacedFixture();
  prior.api.mtnHeights();assert.equal(await run(f.api.mtnHeightsChunks(),false),undefined);
  assert.deepEqual(f.snapshot(),prior.snapshot());assert.deepEqual(f.errors,[]);
  assert(f.hostState.pulses>20&&f.hostState.randomCalls>0&&f.hostState.seededCalls>0);
  assert(f.context.GAME.t>1000000,'host time actually advanced independently of construction');
});

test('abandoned work cannot mark the world ready, and a completed mountain pass cannot repeat its effects', () => {
  const cancelled=fixture(),iterator=cancelled.api.buildWorldChunks(7);iterator.next();iterator.return();assert.equal(cancelled.api.W.ready,false);
  const f=fixture();f.api.buildWorld(7);f.api.mtnHeights();const before=f.snapshot(),streams=f.rng.length;
  const repeated=f.api.mtnHeightsChunks().next();assert.equal(repeated.done,true);assert.equal(repeated.value,undefined);
  assert.equal(f.rng.length,streams);assert.deepEqual(f.snapshot(),before);assert.deepEqual(f.errors,[]);
});
