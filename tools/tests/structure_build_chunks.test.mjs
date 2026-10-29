import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { parse } from 'acorn';
import { structureFixture, structureReference } from './structure_build.fixture.mjs';

function normalized(node) {
  if(Array.isArray(node))return node.map(normalized).filter(value=>value!==null);
  if(!node||typeof node!=='object')return node;
  if(node.type==='ExpressionStatement'&&node.expression.type==='YieldExpression'&&!node.expression.delegate)return null;
  if(node.type==='YieldExpression'&&node.delegate)return normalized({...node.argument,callee:{...node.argument.callee,name:node.argument.callee.name.replace(/Chunks$/,'')}});
  const result={};for(const [key,value] of Object.entries(node))if(!['start','end','raw'].includes(key))result[key]=normalized(value);
  if(result.type==='FunctionDeclaration'){result.id.name=result.id.name.replace(/Chunks$/,'');result.generator=false;}
  if(['ForStatement','ForOfStatement','ForInStatement'].includes(result.type)&&result.body.type==='BlockStatement'
    &&result.body.body.length===1&&['ForStatement','ForOfStatement','ForInStatement'].includes(result.body.body[0].type))result.body=result.body.body[0];
  return result;
}

test('the emitted structure/castle generators differ from pinned prior builders only by wrapper delegation and yields',()=>{
  for(const [file,name]of[['04_props.js','buildStructures'],['04g_castles.js','buildCastles']]){
    const source=readFileSync(new URL('../../src/'+file,import.meta.url),'utf8');
    const current=parse(source,{ecmaVersion:'latest'}).body.find(node=>node.type==='FunctionDeclaration'&&node.id.name===name+'Chunks');
    const prior=parse(structureReference.functions[name],{ecmaVersion:'latest'}).body[0];
    assert.deepEqual(normalized(current),normalized(prior),name);
  }
});

for(const seed of [7,19,503])test('seed '+seed+': exact structure geometry, materials, scene order, floors, collisions, gates, banners and RNG match pinned prior output',async t=>{
  const prior=structureFixture({prior:true}),resumed=structureFixture();
  prior.api.buildWorld(seed);resumed.api.buildWorld(seed);
  const before=performance.now();assert.equal(prior.api.buildStructures(),undefined);const priorMs=performance.now()-before;
  const iterator=resumed.api.buildStructuresChunks();let state,steps=0,activeMs=0,maxResumeMs=0;
  const phases=[];
  do {const start=performance.now();state=iterator.next();const elapsed=performance.now()-start;activeMs+=elapsed;maxResumeMs=Math.max(maxResumeMs,elapsed);steps++;
    if(!state.done){phases.push(state.value);assert.equal(resumed.context.GAME.built,false);await new Promise(resolve=>setImmediate(resolve));}
  }while(!state.done);
  assert.equal(state.value,undefined);assert(steps>=30,'actual site/castle checkpoints must execute');
  assert.deepEqual(resumed.errors,[]);assert.deepEqual(prior.errors,[]);
  assert.equal(resumed.api.CASTLES.length,9);assert(resumed.api.FLOOR.list.length>1000);assert(resumed.scene.children.length>150);
  assert.deepEqual(resumed.snapshot(),prior.snapshot());
  if(seed===7){const sync=structureFixture();sync.api.buildWorld(seed);assert.equal(sync.api.buildStructures(),undefined);assert.deepEqual(sync.snapshot(),prior.snapshot());}
  const after=resumed.snapshot();assert.equal(iterator.next().done,true);assert.deepEqual(resumed.snapshot(),after,'a drained iterator cannot repeat construction effects');
  t.diagnostic(JSON.stringify({seed,priorMs,activeMs,maxResumeMs,steps,meshes:resumed.scene.children.length,castles:resumed.api.CASTLES.length,
    floors:resumed.api.FLOOR.list.length,houses:resumed.api.HOUSES.length,seededStreams:resumed.rng.length,unseededCalls:resumed.unseeded.length,phases}));
});
