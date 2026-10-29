/** Exact seeded PCM preparation. No Web Audio context, renderer, browser or services. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import vm from 'node:vm';
import {parse} from 'acorn';

const read=name=>readFileSync(new URL('../../'+name,import.meta.url),'utf8');
const sound=read('src/11c_sound.js'),util=read('src/00_util.js');
const prior=JSON.parse(read('tools/tests/fixtures/sound_buffers_185f20a.json'));
assert.equal(prior.revision,'185f20a919cc316f54e268ce82731b8098cf8ccf');
assert.equal(createHash('sha256').update(prior.sndBuf).digest('hex'),prior.sndBufSha256);
assert.equal(prior.sndBufSha256,'bf6b3ebefdfe0bacf423203f94604809b218f551e97a510d943b2267db82a9f3');
assert(util.includes(prior.clamp),'The independent original clamp remains the current arithmetic');
const names=['roofrain','lap','murmur','battle','crackle','roar'];
const wanted=new Set(['sndBufferChunks','sndBuf','sndBufferPreparation','prepareSoundBuffersChunks']);
const code=parse(sound,{ecmaVersion:'latest',sourceType:'module'}).body.filter(node=>
  node.type==='FunctionDeclaration'&&wanted.has(node.id.name)
  ||node.type==='VariableDeclaration'&&node.declarations.some(decl=>wanted.has(decl.id.name)))
  .map(node=>sound.slice(node.start,node.end)).join('\n');

function fixture({oracle=false,context=false,noConstructor=false,failAt=0,countWrites=false,forbidContext=false}={}){
  const stats={constructors:0,contextBuffers:0,contextReads:0,globalRandom:0,scratchWrites:0,allocations:[]};
  class PCM{
    constructor(channels,length,sampleRate){this.numberOfChannels=channels;this.length=length;this.sampleRate=sampleRate;
      this.duration=length/sampleRate;this.data=new Float32Array(length);stats.allocations.push(this);}
    getChannelData(channel){assert.equal(channel,0);return this.data;}
  }
  const Buffer=class {
    constructor({numberOfChannels,length,sampleRate}){
      stats.constructors++;if(failAt&&stats.constructors===failAt)throw Error('optional allocation failed');
      return new PCM(numberOfChannels,length,sampleRate);
    }
  };
  const ctx={createBuffer(channels,length,sr){stats.contextBuffers++;return new PCM(channels,length,sr);}};
  const AUDIO={};Object.defineProperty(AUDIO,'ctx',{get(){stats.contextReads++;
    if(forbidContext)throw Error('Preparation must not read a context');return context?ctx:null;}});
  const math=Object.create(Math);math.random=()=>{stats.globalRandom++;throw Error('No runtime RNG during seeded preparation');};
  const Scratch=countWrites?function(length){
    const target=new Float32Array(length);return new Proxy(target,{
      get(array,key){const value=Reflect.get(array,key,array);return typeof value==='function'?value.bind(array):value;},
      set(array,key,value){if(/^\d+$/.test(String(key)))stats.scratchWrites++;return Reflect.set(array,key,value,array);},
    });
  }:Float32Array;
  const state={AUDIO,SND:{bufs:{}},Math:math,AudioBuffer:noConstructor?undefined:Buffer,Float32Array:Scratch};
  Object.defineProperty(state,'AudioContext',{get(){throw Error('No AudioContext construction');}});
  const realm=vm.createContext(state);
  // Lexical calls match the built module; this fixture is an equality test, not a timing benchmark.
  vm.runInContext('(function(Math,AudioBuffer,Float32Array){\n'+prior.clamp+'\n'+(oracle?prior.sndBuf:code)
    +'\nglobalThis.api={sndBuf'+(oracle?'':',sndBufferChunks,prepareSoundBuffersChunks')+'};})(Math,AudioBuffer,Float32Array);',realm);
  return{api:realm.api,stats,state,cache:()=>state.SND.bufs,replace:cache=>{state.SND.bufs=cache;}};
}
function drain(work){let step=work.next(),turns=0;while(!step.done){assert(++turns<10000,'bounded generation');step=work.next();}return step.value;}
const bytes=buffer=>Buffer.from(buffer.getChannelData(0).buffer);
const expected=Object.fromEntries([...names,'unknown',''].map(name=>[name,fixture({oracle:true}).api.sndBuf(name)]));
function same(buffer,reference){
  assert.equal(buffer.numberOfChannels,reference.numberOfChannels);assert.equal(buffer.length,reference.length);
  assert.equal(buffer.sampleRate,reference.sampleRate);assert.equal(buffer.duration,reference.duration);
  assert.deepEqual(bytes(buffer),bytes(reference),'every PCM byte matches the independent original');
}
function untilAllocated(h,work,n=1){let step;for(let i=0;i<10000;i++){
  step=work.next();assert.equal(step.done,false,'private allocation precedes final publication');
  if(h.stats.allocations.length>=n)return;
}assert.fail('expected a bounded private allocation');}

for(const name of [...names,'unknown',''])for(const context of [false,true])test(`synchronous ${JSON.stringify(name)} preserves original PCM and ${context?'context':'standalone'} allocator`,()=>{
  const h=fixture({context}),value=h.api.sndBuf(name);same(value,expected[name]);
  assert.equal(h.cache()[name],value);assert.equal(h.api.sndBuf(name),value,'cached identity is unchanged');
  assert.equal(h.stats.allocations.length,1);assert.equal(h.stats.contextBuffers,Number(context));
  assert.equal(h.stats.constructors,Number(!context));assert.equal(h.stats.globalRandom,0);
});
test('all six prepared buffers publish only after the complete private batch',()=>{
  const h=fixture({forbidContext:true}),cache=h.cache(),work=h.api.prepareSoundBuffersChunks();
  let turns=0,step=work.next();
  while(!step.done){assert.equal(h.cache(),cache);assert.deepEqual(Object.keys(cache),[]);assert(++turns<10000);step=work.next();}
  assert.equal(step.value,true);assert.deepEqual(Object.keys(cache),names);assert.equal(h.stats.contextReads,0);
  assert.equal(h.stats.globalRandom,0);assert.equal(h.stats.constructors,6);
  assert.equal(h.stats.allocations.reduce((sum,b)=>sum+b.length*4,0),1816920);
  for(const name of names){same(cache[name],expected[name]);assert.equal(h.api.sndBuf(name),cache[name]);}
  assert.equal(h.stats.contextReads,0,'cache adoption never reaches the public allocator');
});
test('every preparation turn has at most 2048 original scratch stores, including long inner loops',()=>{
  const h=fixture({countWrites:true,forbidContext:true}),work=h.api.prepareSoundBuffersChunks();let turns=0,step;
  do{const before=h.stats.scratchWrites;step=work.next();assert(h.stats.scratchWrites-before<=2048);
    assert(++turns<10000);}while(!step.done);
  assert.equal(step.value,true);assert(turns>100);for(const name of names)same(h.cache()[name],expected[name]);
});
for(const allocations of [0,1,5,6])test(`cancellation after ${allocations} private buffers publishes nothing`,()=>{
  const h=fixture({forbidContext:true}),work=h.api.prepareSoundBuffersChunks(),cache=h.cache();
  if(allocations)untilAllocated(h,work,allocations);else assert.equal(work.next().done,false);
  assert.deepEqual(Object.keys(cache),[]);work.return();assert.equal(work.next().done,true);
  assert.equal(h.cache(),cache);assert.deepEqual(Object.keys(cache),[]);assert.equal(h.stats.contextReads,0);
});
test('a replaced cache invalidates a yielded batch without writing either cache',()=>{
  const h=fixture(),work=h.api.prepareSoundBuffersChunks(),old=h.cache();untilAllocated(h,work,2);
  const replacement={marker:{owner:'new cache'}};h.replace(replacement);
  assert.equal(drain(work),false);assert.deepEqual(Object.keys(old),[]);
  assert.deepEqual(Object.keys(replacement),['marker']);assert.equal(h.cache(),replacement);
});
test('a newer preparation supersedes an older yielded batch',()=>{
  const h=fixture(),old=h.api.prepareSoundBuffersChunks();untilAllocated(h,old);
  const latest=h.api.prepareSoundBuffersChunks();assert.equal(drain(latest),true);
  const winners=names.map(name=>h.cache()[name]);assert.equal(drain(old),false);
  assert.deepEqual(names.map(name=>h.cache()[name]),winners);
});
test('an existing public winner is retained without regeneration',()=>{
  const h=fixture(),winner=h.api.sndBuf('roofrain');assert.equal(drain(h.api.prepareSoundBuffersChunks()),true);
  assert.equal(h.cache().roofrain,winner);assert.equal(h.stats.allocations.length,6);
  for(const name of names)same(h.cache()[name],expected[name]);
});
test('a synchronous winner during an unfinished kernel wins final adoption',()=>{
  const h=fixture(),work=h.api.prepareSoundBuffersChunks();for(let i=0;i<5;i++)assert.equal(work.next().done,false);
  const winner=h.api.sndBuf('roofrain');assert.deepEqual(Object.keys(h.cache()),['roofrain']);
  assert.equal(drain(work),true);assert.equal(h.cache().roofrain,winner);assert.equal(h.stats.allocations.length,6);
  for(const name of names)same(h.cache()[name],expected[name]);
});
test('a synchronous winner after a private buffer completed is never overwritten',()=>{
  const h=fixture(),work=h.api.prepareSoundBuffersChunks();untilAllocated(h,work);
  const privateFirst=h.stats.allocations[0],winner=h.api.sndBuf('roofrain');assert.notEqual(winner,privateFirst);
  assert.equal(drain(work),true);assert.equal(h.cache().roofrain,winner);assert.equal(h.stats.allocations.length,7);
  for(const name of names)same(h.cache()[name],expected[name]);
});
test('removed same-cache winners do not publish undefined entries or an incomplete batch',()=>{
  const h=fixture();h.api.sndBuf('roofrain');const work=h.api.prepareSoundBuffersChunks();work.next();
  delete h.cache().roofrain;assert.equal(drain(work),false);assert.deepEqual(Object.keys(h.cache()),[]);
});
test('missing standalone constructor leaves the original context-backed API available',()=>{
  const h=fixture({noConstructor:true,context:true});assert.equal(drain(h.api.prepareSoundBuffersChunks()),false);
  assert.deepEqual(Object.keys(h.cache()),[]);assert.equal(h.stats.allocations.length,0);
  same(h.api.sndBuf('murmur'),expected.murmur);assert.equal(h.stats.contextBuffers,1);
});
test('optional constructor failure abandons every private buffer and normal sync fallback works',()=>{
  const h=fixture({failAt:3,context:true});assert.equal(drain(h.api.prepareSoundBuffersChunks()),false);
  assert.deepEqual(Object.keys(h.cache()),[]);assert.equal(h.stats.contextReads,0);
  assert.equal(h.stats.allocations.length,2);same(h.api.sndBuf('battle'),expected.battle);assert.equal(h.stats.contextBuffers,1);
});
test('preparing an already complete cache allocates nothing and preserves every identity',()=>{
  const h=fixture();assert.equal(drain(h.api.prepareSoundBuffersChunks()),true);
  const values=names.map(name=>h.cache()[name]);assert.equal(drain(h.api.prepareSoundBuffersChunks()),true);
  assert.equal(h.stats.allocations.length,6);assert.deepEqual(names.map(name=>h.cache()[name]),values);
});
