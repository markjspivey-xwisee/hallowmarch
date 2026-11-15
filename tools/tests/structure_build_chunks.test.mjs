import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parse } from 'acorn';
import { canonicalSignature } from './structure_canonical.mjs';
const structureReference=JSON.parse(readFileSync(new URL('fixtures/structure-build-c6ce-reference.json',import.meta.url),'utf8'));

test('canonical signatures preserve exact primitive values, property order and array holes',()=>{
  for(const [a,b]of[[{value:undefined},{}],[NaN,null],[NaN,Infinity],[Infinity,-Infinity],[-0,0],
    [1,1+Number.EPSILON],['\ud800','\ufffd'],[[,],[undefined]],[{a:1,b:2},{b:2,a:1}],[1n,1]])
    assert.notEqual(canonicalSignature(a),canonicalSignature(b));
  assert.equal(canonicalSignature({a:[-0,undefined,NaN,Infinity,'é\ud800']}),canonicalSignature({a:[-0,undefined,NaN,Infinity,'é\ud800']}));
});

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

function worker(mode,seed,sensitivity=false){
  const result=spawnSync(process.execPath,[fileURLToPath(new URL('structure_build.worker.mjs',import.meta.url)),mode,String(seed),...(sensitivity?['sensitivity']:[])],
    {encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
  assert.equal(result.status,0,result.error?.message||result.stderr||result.stdout);
  return JSON.parse(result.stdout.trim());
}
function sameCanonical(actual,expected,label){
  const differing=Object.keys(expected.sections).filter(key=>actual.sections[key]!==expected.sections[key]);
  assert.equal(actual.canonical,expected.canonical,label+'; differing canonical sections: '+JSON.stringify(differing.map(key=>({key,expected:expected.sections[key],actual:actual.sections[key]}))));
}

for(const seed of [7,19,503])test('seed '+seed+': exact structure geometry, materials, scene order, floors, collisions, gates, banners and RNG match pinned prior output',t=>{
  const prior=worker('prior',seed),resumed=worker('chunks',seed,seed===7);
  sameCanonical(resumed,prior,'complete canonical state and full RNG tape');
  if(seed===7){sameCanonical(worker('sync',seed),prior,'retained synchronous public API');
    assert.deepEqual(resumed.domains,{geometry:true,material:true,semantic:true,rng:true},'signatures must detect real changes in every protected domain');}
  t.diagnostic(JSON.stringify({seed,priorMs:prior.activeMs,activeMs:resumed.activeMs,maxResumeMs:resumed.maxResumeMs,steps:resumed.steps,
    meshes:resumed.meshes,castles:resumed.castles,floors:resumed.floors,houses:resumed.houses,seededStreams:resumed.seededStreams,
    seededCalls:resumed.seededCalls,unseededCalls:resumed.unseededCalls}));
});
