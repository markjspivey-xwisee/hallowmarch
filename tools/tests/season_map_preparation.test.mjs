// Actual-source CPU fixtures only. No WebGL renderer, browser, clock advance or game simulation.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parse} from 'acorn';
import * as THREE from '../node_modules/three/build/three.module.js';

const root=new URL('../../',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8').replace(/\r\n/g,'\n');
const sha=value=>createHash('sha256').update(value).digest('hex');
const oracle=JSON.parse(read('tools/tests/fixtures/season_map_7004.json'));
const source=read('src/05k_seasons.js'),world=read('src/01_world.js'),util=read('src/00_util.js');
const nodes=value=>parse(value,{ecmaVersion:'latest',sourceType:'script'}).body;
function declaration(value,name){
  const matches=nodes(value).filter(node=>node.type==='FunctionDeclaration'&&node.id.name===name
    ||node.type==='VariableDeclaration'&&node.declarations.some(item=>item.id.name===name));
  assert.equal(matches.length,1,name);return value.slice(matches[0].start,matches[0].end);
}
const tokens=value=>value.replace(/\/\*[\s\S]*?\*\//g,'').replace(/\/\/[^\n]*/g,'').replace(/\s+/g,'');
const bytes=value=>Buffer.from(value.buffer,value.byteOffset,value.byteLength);
const HN=513,N=HN*HN;
function heights(kind='waves'){
  const H=new Float32Array(N);
  for(let q=0;q<N;q++){
    const i=q%HN,j=(q/HN)|0;
    H[q]=kind==='flat'?6:kind==='threshold'?6+((q%5)-2)*2**-20
      :Math.sin(i*.031)*18+Math.cos(j*.043)*8+((i*71+j*13)%17)*.03;
    if(kind==='crater')H[q]-=Math.max(0,1-Math.hypot(i-260,j-251)/30)*12;
  }
  return H;
}
function fixture({baseline=false,H=heights(),bearings=[0,2.0943951023931953,4.1887902047863905],allocationFailure=false}={}){
  const allocations=[],textures=[],events=[],math=Object.create(Math),W={H},U={uSeasonMap:{value:{original:true}}};
  let stage='setup',api;
  const tracked=(T,name)=>new Proxy(T,{construct(target,args){
    if(allocationFailure&&stage==='prepare'&&name==='Uint32Array')throw Error('Injected optional allocation failure');
    const value=Reflect.construct(target,args);allocations.push({name,stage,buffer:value.buffer,bytes:value.byteLength});return value;
  }});
  class ActualTexture extends THREE.DataTexture{
    constructor(...args){
      events.push(['DataTexture',args[1],args[2],args[3],args[4],api.seas.warm.length,api.seas.lie.length,api.seas.bytes.length,U.uSeasonMap.value?.original===true]);
      super(...args);textures.push(this);
    }
  }
  const context=vm.createContext({Math:math,Array,Object,Number,ArrayBuffer,Float32Array:tracked(Float32Array,'Float32Array'),
    Uint32Array:tracked(Uint32Array,'Uint32Array'),Uint8Array:tracked(Uint8Array,'Uint8Array'),
    HALF:512,HN,HS:2,DUN_X0:1000,W,U,REALMS:bearings.map(bearing=>({bearing})),A2FL:{ground:0},GRAPHICS_STARTUP:{},
    THREE:{DataTexture:ActualTexture,RGBAFormat:THREE.RGBAFormat,UnsignedByteType:THREE.UnsignedByteType,LinearFilter:THREE.LinearFilter},
    dungeonCalls:0,dunFloorAt(x,z){context.dungeonCalls++;return (x-z)*.01;}});
  const shared=[...Object.values(oracle.helpers),oracle.bearing,oracle.height,oracle.realms,declaration(oracle.seasonSource,'SEAS')];
  if(baseline)shared.push(oracle.map);
  else{
    const selected=nodes(source).filter(node=>node.type==='FunctionDeclaration'&&(
      node.id.name.startsWith('seasonMapPreparation')||node.id.name.startsWith('seasonMapPrivate')
      ||['prepareSeasonMapChunks','seasonMapTakePrepared','seasonMapBuild'].includes(node.id.name))
      ||node.type==='VariableDeclaration'&&node.declarations.some(item=>item.id.name.startsWith('SEASON_MAP_')
      ||item.id.name.startsWith('seasonMapInput')||item.id.name.startsWith('seasonMapMath')
      ||item.id.name.startsWith('seasonMapArray')||item.id.name==='seasonMapPrepared'));
    shared.push(...selected.map(node=>source.slice(node.start,node.end)));
  }
  shared.push('globalThis.api={seas:SEAS,build:seasonMapBuild'+(baseline?'':',prepare:prepareSeasonMapChunks,inspect:()=>({prepared:seasonMapPrepared,active:seasonMapActive,generation:seasonMapPreparation})')+'};');
  vm.runInContext('"use strict";\n'+shared.join('\n'),context,{timeout:1000});api=context.api;
  return {api,context,W,U,math,allocations,textures,events,
    prepare(){stage='prepare';return api.prepare();},
    build(){stage='consume';api.seas.inited=true;api.build();return api.seas;},
    dispose(){textures.forEach(texture=>texture.dispose());}};
}
function drain(iterator){let result,steps=0;do{result=iterator.next();assert(++steps<20000,'Bounded fixture steps');}while(!result.done);return {value:result.value,steps};}
function rng(operation){
  const previous=Math.random,tape=[];let k=0;
  Math.random=()=>{const value=((Math.imul(++k,1664525)+1013904223)>>>0)/4294967296;tape.push(value);return value;};
  try{return {value:operation(),tape};}finally{Math.random=previous;}
}

test('original7004 map, terrain/realm/helper arithmetic and retained fallback are independently pinned',()=>{
  assert.equal(oracle.revision,'7004ae437e4ef881c74e48646948a9db578ff53d');
  assert.equal(oracle.seasonSourceSha256,'c2c2efebb068a6a171abb31e4945f179240e21d2ea44e2d098b1d9e962411294');
  assert.equal(sha(oracle.seasonSource),oracle.seasonSourceSha256);
  assert.equal(sha(world),oracle.sourceHashes['01_world.js']);assert.equal(sha(util),oracle.sourceHashes['00_util.js']);
  assert.equal(declaration(world,'heightAt'),oracle.height);assert.equal(declaration(world,'realmWeightsAt'),oracle.realms);
  for(const [name,body] of Object.entries(oracle.helpers))assert.equal(declaration(util,name),body,name);
  const original=oracle.map.slice(oracle.map.indexOf('  const R = SEAS.res, c = SEAS.cell;'));
  const current=declaration(source,'seasonMapBuild');assert.equal(current.slice(current.indexOf('  const R = SEAS.res, c = SEAS.cell;')),original);
  const start=source.indexOf('// Optional private numeric work.'),mapStart=source.indexOf('function seasonMapBuild()'),map=declaration(source,'seasonMapBuild');
  assert(start>=0&&mapStart>start);assert.equal(source.slice(0,start)+oracle.map+source.slice(mapStart+map.length),oracle.seasonSource);
});
test('private height and realm functions keep original arithmetic/grouping outside the explicitly excluded dungeon domain',()=>{
  const height=declaration(source,'seasonMapPrivateHeight').replace('seasonMapPrivateHeight(input,','heightAt(')
    .replaceAll('input.half','HALF').replaceAll('input.hs','HS').replaceAll('input.hn','HN').replaceAll('input.heights','W.H');
  assert.equal(tokens(height),tokens(oracle.height.replace('  if (x > DUN_X0) return dunFloorAt(x, z);\n','')));
  const realms=declaration(source,'seasonMapPrivateRealmWeights').replace('seasonMapPrivateRealmWeights(input,','realmWeightsAt(').replaceAll('input.realms','REALMS');
  assert.equal(tokens(realms),tokens(oracle.realms));
  const prep=declaration(source,'prepareSeasonMapChunks');
  assert(prep.includes('warm[q] = rw[0] * 1.2 - rw[2] * 6.5 - Math.max(0, h - 6) * 0.3;'));
  assert(prep.includes('Math.round(clamp((warm[q] + 30) / 40, 0, 1) * 255)'));
  assert(prep.indexOf('warm[q] =')<prep.indexOf('bytes[q * 4 + 1] ='));
});
for(const kind of ['flat','threshold','waves','crater'])test('every16384 warmth value/RGBA byte plus original texture and RNG tape matches '+kind,()=>{
  const H=heights(kind),before=fixture({baseline:true,H}),after=fixture({H:new Float32Array(H)});
  try{
    const original=rng(()=>before.build());
    const actual=rng(()=>{assert.equal(drain(after.prepare()).value,true);return after.build();});
    assert.equal(actual.value.warm.length,16384);assert.deepEqual(bytes(actual.value.warm),bytes(original.value.warm));
    assert.deepEqual(bytes(actual.value.bytes),bytes(original.value.bytes));assert.deepEqual(bytes(actual.value.lie),Buffer.alloc(16384*4));
    assert.deepEqual(actual.tape,original.tape);assert(actual.tape.length>0,'Actual r160 texture/source UUID draws retained');
    assert.deepEqual(after.events,before.events);assert.equal(after.textures.length,1);
    const texture=after.textures[0];assert.equal(actual.value.tex,texture);assert.equal(after.U.uSeasonMap.value,texture);assert.equal(texture.image.data,actual.value.bytes);
    assert.equal(texture.minFilter,THREE.LinearFilter);assert.equal(texture.magFilter,THREE.LinearFilter);assert.equal(texture.generateMipmaps,false);assert.equal(texture.version,1);
    assert.equal(after.context.GRAPHICS_STARTUP.seasonMap.consumed,true);
  }finally{before.dispose();after.dispose();}
});
test('changed ordered realm bearings still match the original for all warmth bits and bytes',()=>{
  const bearings=[-.2,1.91,4.37],before=fixture({baseline:true,bearings}),after=fixture({bearings});
  try{const a=before.build();assert.equal(drain(after.prepare()).value,true);const b=after.build();assert.deepEqual(bytes(a.warm),bytes(b.warm));assert.deepEqual(bytes(a.bytes),bytes(b.bytes));}
  finally{before.dispose();after.dispose();}
});
test('preparation never publishes SEAS/uniforms or consumes RNG; retained private buffers stay below2MiB',()=>{
  const f=fixture();try{
    const original=JSON.stringify(f.api.seas),uniform=f.U.uSeasonMap.value;
    const result=rng(()=>{const it=f.prepare();let step;do{step=it.next();assert.equal(JSON.stringify(f.api.seas),original);assert.equal(f.U.uSeasonMap.value,uniform);assert.equal(f.textures.length,0);}while(!step.done);return step.value;});
    assert.equal(result.value,true);assert.deepEqual(result.tape,[]);
    const cache=f.api.inspect().prepared,buffers=new Set([cache.bits.buffer,cache.warm.buffer,cache.bytes.buffer]);
    assert.equal(cache.input.heights.buffer,cache.bits.buffer);assert.equal([...buffers].reduce((sum,b)=>sum+b.byteLength,0),1183748);
    assert([...buffers].reduce((sum,b)=>sum+b.byteLength,0)<=2*1024*1024);
    assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.bytes,1183748);
  }finally{f.dispose();}
});
test('one unfinished owner excludes a second allocation set, cancellation releases it and a later generation can complete',()=>{
  const f=fixture();try{
    const first=f.prepare();assert.equal(first.next().done,false);const count=f.allocations.length,generation=f.api.inspect().generation;
    const refused=f.prepare().next();assert.equal(refused.done,true);assert.equal(refused.value,false);assert.equal(f.allocations.length,count);assert.equal(f.api.inspect().generation,generation);
    first.return();assert.equal(f.api.inspect().active,null);assert.equal(f.api.inspect().prepared,null);assert.equal(f.textures.length,0);
    assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.canceled,1);
    assert.equal(drain(f.prepare()).value,true);f.build();assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.consumed,true);
  }finally{f.dispose();}
});
test('a partial preparation cannot replace an ordinary live winner or change its original publication',()=>{
  const f=fixture();try{const partial=f.prepare();partial.next();const value=f.build(),texture=value.tex,warm=value.warm;assert.equal(drain(partial).value,false);
    assert.equal(f.api.seas.tex,texture);assert.equal(f.api.seas.warm,warm);assert.equal(f.textures.length,1);assert.equal(f.api.inspect().prepared,null);
  }finally{f.dispose();}
});
test('every in-place height bit is validated including equal-number signedzero and changed NaN payloads',()=>{
  for(const mode of ['ordinary','signedzero','nan-payload']){
    const H=new Float32Array(N);if(mode==='nan-payload')new Uint32Array(H.buffer)[21]=0x7fc00001;
    const f=fixture({H});try{
      assert.equal(drain(f.prepare()).value,true);
      if(mode==='ordinary')H[N-1]=3;else if(mode==='signedzero')new Uint32Array(H.buffer)[0]=0x80000000;else new Uint32Array(H.buffer)[21]=0x7fc00002;
      f.build();assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.consumed,false);assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.fallbacks,1);
      assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.stale,1);assert.equal(f.api.inspect().prepared,null);
    }finally{f.dispose();}
  }
});
test('height identity/dimensions/realm/helper/Math/uniform changes refuse cached adoption and retain synchronous fallback',()=>{
  const changes=[f=>{f.W.H=new Float32Array(f.W.H);},f=>{f.context.HALF=511;},f=>{f.context.HN=512;},f=>{f.context.HS=2.01;},
    f=>{f.context.DUN_X0=999;},f=>{f.api.seas.cell=7.99;},f=>{f.api.seas.res=127;},
    f=>{f.context.REALMS[0].bearing+=.1;},f=>{f.context.REALMS[1]={...f.context.REALMS[1]};},
    f=>{f.context.REALMS=[...f.context.REALMS];},f=>{vm.runInContext('heightAt=()=>4;',f.context);},
    f=>{f.math.hypot=(...args)=>Math.hypot(...args);},f=>{f.U.uSeasonMap={value:null};}];
  for(const change of changes){const f=fixture();try{assert.equal(drain(f.prepare()).value,true);change(f);f.build();
    assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.consumed,false);assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.fallbacks,1);assert.equal(f.textures.length,1);
  }finally{f.dispose();}}
});
test('terrain generation is a preparation shortcut, but unchanged complete bits still permit exact consumption',()=>{
  const f=fixture();try{assert.equal(drain(f.prepare()).value,true);f.context.A2FL.ground++;f.build();assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.consumed,true);}
  finally{f.dispose();}
  const g=fixture();try{const it=g.prepare();it.next();g.context.A2FL.ground++;assert.equal(drain(it).value,false);assert.equal(g.api.inspect().prepared,null);}
  finally{g.dispose();}
});
test('unsupported memory/domain/shared inputs and optional allocation errors fall back without early constructors',()=>{
  for(const change of [f=>{f.api.seas.res=512;f.api.seas.cell=1;},f=>{f.api.seas.cell=16;},
    f=>{f.W.H=new Float32Array(new SharedArrayBuffer(N*4));}]){
    const f=fixture();try{change(f);assert.equal(drain(f.prepare()).value,false);assert.equal(f.textures.length,0);assert.equal(f.api.inspect().prepared,null);}
    finally{f.dispose();}
  }
  const f=fixture({allocationFailure:true});try{assert.equal(drain(f.prepare()).value,false);assert.equal(f.api.inspect().active,null);f.build();assert.equal(f.textures.length,1);assert.equal(f.context.GRAPHICS_STARTUP.seasonMap.fallbacks,1);}
  finally{f.dispose();}
});
test('accessor bearing is not evaluated during optional preparation and season state/texture stay unpublished',()=>{
  const f=fixture();try{let reads=0;Object.defineProperty(f.context.REALMS[0],'bearing',{get(){reads++;return 0;},configurable:true});
    assert.equal(drain(f.prepare()).value,false);assert.equal(reads,0);assert.equal(f.api.seas.warm,null);assert.equal(f.api.seas.tex,null);assert.equal(f.textures.length,0);
  }finally{f.dispose();}
});
test('boot preparation follows saved-world release and diagnostic early-return while init/ice/settle stay literal',()=>{
  const main=read('src/13_main.js');assert(main.indexOf('applyWorldSave(save.world)')<main.indexOf('() => prepareSeasonMapChunks()'));
  assert(main.indexOf('if (await graphicsRunDiagnostic()) return;')<main.indexOf('() => prepareSeasonMapChunks()'));
  assert(main.indexOf('() => prepareGroundAOChunks()')<main.indexOf('() => prepareSeasonMapChunks()'));
  assert(main.indexOf('() => prepareSeasonMapChunks()')<main.indexOf('prepareTitleDraft(save)'));
  for(const name of ['seasonsInit','seasonLieStep','seasonIceBuild','seasonIceSettle','seasonSettle','seasonsFrame'])assert.equal(declaration(source,name),declaration(oracle.seasonSource,name),name);
});
